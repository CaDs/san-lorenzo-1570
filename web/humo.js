import * as THREE from 'three';

// Humo de chimenea: la senal de "aqui vive alguien" que falta con las 1400
// chimeneas frias del caserio. Un unico InstancedMesh de un quad, orientado a
// camara en el vertex shader (nada de rotar Object3D en la CPU), con
// posicion/tamano/opacidad por instancia recalculados cada frame -- no hay
// fisica real, cada particula recorre un ciclo determinista en el tiempo.

const CULL_RADIUS = 140;      // metros: fuera de esto ni se calcula la pluma
// ponytail: techo de plumas simultaneas. Con 1400 chimeneas en el mapa y solo
// las que caen dentro de CULL_RADIUS compitiendo por este cupo, en la practica
// nunca se llena salvo plantado en medio del pueblo; si algun dia hace falta
// mas, subir esto (y MAX_INSTANCES con ello).
const MAX_CHIMNEYS = 120;
const PARTICLES = 5;          // billboards por pluma, repartidos en el ciclo de vida
const MAX_INSTANCES = MAX_CHIMNEYS * PARTICLES;

const LIFE = 3.4;             // s: cuanto tarda una particula en apagarse
const RISE = 1.35;            // m/s de ascenso
const DRIFT = 0.55;           // m/s de deriva lateral (viento fijo por particula)

const fract = (x) => x - Math.floor(x);
const hash = (a, b) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);

// Gris calido, en LINEAL. Con ACES a exposicion 0.7 y bloom activo, cualquier
// canal que se acerque a 1.0 se dispara a blanco puro; 0.10-0.30 es el rango
// que pide la consigna y aqui se queda bien dentro.
const SMOKE_COLOR = [0.20, 0.185, 0.165];

export class Humo {
  // chimeneas: Array<[x, y, z]> remates de chimenea en metros de mundo.
  constructor(chimeneas) {
    this.chim = chimeneas;

    const geo = new THREE.PlaneGeometry(1, 1);
    const aScale = new Float32Array(MAX_INSTANCES);
    const aRot = new Float32Array(MAX_INSTANCES);
    const aOpacity = new Float32Array(MAX_INSTANCES);
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(aRot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1).setUsage(THREE.DynamicDrawUsage));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      uniforms: {
        color: { value: new THREE.Color(SMOKE_COLOR[0], SMOKE_COLOR[1], SMOKE_COLOR[2]) },
        // ponytail: no hay referencia a la escena/niebla aqui (World.update no
        // la pasa y main.js no se toca), asi que se aproxima con el color de
        // FOG_NIGHT de daynight.js -- el humo se ve sobre todo de noche, que es
        // justo cuando esta aproximacion es mas ajustada. Si hiciera falta el
        // ciclo dia/noche exacto, pasar this.fog.color desde World.update().
        fogColor: { value: new THREE.Color(0.055, 0.065, 0.098) },
        fogDensity: { value: 0.0013 },
      },
      vertexShader: `
        attribute float aScale;
        attribute float aRot;
        attribute float aOpacity;
        varying float vOpacity;
        varying vec2 vUv2;
        varying float vFogDepth;
        void main() {
          vUv2 = uv;
          vOpacity = aOpacity;
          // Centro de la particula: solo traslacion, nada de giro/escala en la
          // matriz de instancia (eso lo llevan aScale/aRot para la orientacion
          // a camara, que se construye aqui abajo).
          vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // Columnas de viewMatrix = ejes derecha/arriba de la camara en mundo,
          // porque la inversa de una rotacion es su traspuesta. Asi el quad
          // siempre mira a camara sin tocar su Object3D desde la CPU.
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(aRot), s = sin(aRot);
          vec2 p = position.xy;
          vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * aScale;
          vec3 worldPos = center + camRight * rp.x + camUp * rp.y;
          vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
          vFogDepth = -viewPos.z;
          gl_Position = projectionMatrix * viewPos;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform vec3 fogColor;
        uniform float fogDensity;
        varying float vOpacity;
        varying vec2 vUv2;
        varying float vFogDepth;
        void main() {
          // Mancha redonda, no un cuadrado con bordes duros.
          float d = length(vUv2 - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d) * vOpacity;
          if (a < 0.01) discard;
          // FogExp2 a mano: mismo criterio que THREE.FogExp2 (daynight.js),
          // para que el humo no desentone contra la niebla a distancia.
          float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          vec3 col = mix(color, fogColor, fogFactor);
          gl_FragColor = vec4(col, a);
        }
      `,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_INSTANCES);
    this.mesh.frustumCulled = false;   // el centro de cada instancia se mueve cada frame
    this.mesh.count = 0;               // nada activo hasta el primer update()
    this.mesh.name = 'Humo';

    this._m = new THREE.Matrix4();
    // ponytail: par [d2, indice] reconstruido cada frame en vez de buffers
    // tipados reciclados. Con el filtro de CULL_RADIUS aplicado antes, la
    // lista que se ordena de verdad son unas pocas decenas de items, no las
    // 1400 chimeneas; si el profiler algun dia se queja, aqui es donde tocaria
    // pasar a Float32Array/Int32Array reutilizados.
    this._cerca = [];
  }

  get objeto() { return this.mesh; }

  // noche: 0 = pleno dia, 1 = noche cerrada.
  update(dt, t, camPos, noche) {
    if (this.chim.length === 0 || noche < 0.03) {
      // ponytail: de dia casi no hay lumbre encendida; en vez de una pluma
      // casi invisible, se apaga del todo y nos ahorramos el resto del metodo.
      this.mesh.count = 0;
      return;
    }

    const R2 = CULL_RADIUS * CULL_RADIUS;
    const cerca = this._cerca;
    cerca.length = 0;
    for (let i = 0; i < this.chim.length; i++) {
      const c = this.chim[i];
      const dx = c[0] - camPos.x, dy = c[1] - camPos.y, dz = c[2] - camPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R2) cerca.push([d2, i]);
    }
    cerca.sort((a, b) => a[0] - b[0]);
    const activas = Math.min(cerca.length, MAX_CHIMNEYS);

    const geo = this.mesh.geometry;
    const aScale = geo.attributes.aScale.array;
    const aRot = geo.attributes.aRot.array;
    const aOpacity = geo.attributes.aOpacity.array;

    let k = 0;
    for (let a = 0; a < activas; a++) {
      const c = this.chim[cerca[a][1]];
      const idx = cerca[a][1];
      for (let p = 0; p < PARTICLES; p++) {
        // Fase determinista por chimenea+particula (sin Math.random): el
        // mismo hogar humea siempre igual entre partidas.
        const seed = hash(idx * 7.13 + p * 1.913, idx * 3.71 + p * 0.53);
        const periodo = LIFE * PARTICLES;         // reparte las PARTICLES en el ciclo
        const edad = (t + seed * periodo) % periodo;
        if (edad >= LIFE) {
          // Fuera de su banda: esta "en cola" para el siguiente ciclo, oculta.
          aOpacity[k] = 0;
          k++;
          continue;
        }
        const vida = edad / LIFE;                 // 0 nace, 1 se disuelve
        const angDeriva = seed * Math.PI * 2;
        const x = c[0] + Math.cos(angDeriva) * DRIFT * edad;
        const y = c[1] + RISE * edad;
        const z = c[2] + Math.sin(angDeriva) * DRIFT * edad;
        this._m.makeTranslation(x, y, z);
        this.mesh.setMatrixAt(k, this._m);
        aScale[k] = (0.45 + vida * 1.7) * (0.65 + 0.4 * seed);
        aRot[k] = seed * 6.283 + t * 0.15;
        // Entra rapido, sale despacio; y de dia (noche baja) casi no se ve.
        const fade = Math.min(vida * 4.0, 1.0) * (1.0 - vida);
        aOpacity[k] = fade * (0.12 + 0.55 * noche);
        k++;
      }
    }

    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.aScale.needsUpdate = true;
    geo.attributes.aRot.needsUpdate = true;
    geo.attributes.aOpacity.needsUpdate = true;
  }
}
