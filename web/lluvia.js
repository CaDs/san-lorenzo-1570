import * as THREE from 'three';
import { mezcla } from './dialogos.js';

// Lluvia y nieve.
//
// Las gotas NO pasan por la CPU. Es un cuadrado instanciado, una caja de ellos
// que viaja con la camara, y la caida se calcula en el shader de vertices a
// partir del tiempo modulo la altura de la caja: no hay actualizacion por
// particula, ni reserva de memoria, ni array que recorrer. Tres mil estrias
// cuestan una llamada de dibujo y un uniform.
//
// Aqui NO se copia el patron de humo.js, que es el otro sistema de particulas
// del proyecto, y conviene decir por que: humo.js recalcula cada particula en la
// CPU cada fotograma, lo cual esta bien con 600 y es un disparate con 3000 y
// subiendo. Y la caida es una funcion cerrada del tiempo, asi que hacerla a mano
// seria escribir 3000 matrices por fotograma para conseguir exactamente lo mismo.
//
// La NIEVE es este mismo sistema con otro valor de un uniform, no un segundo
// sistema, y eso vale la pena en vez de duplicar la clase. Un copo se distingue
// de una gota en cuatro cosas medibles y las cuatro estan a un mix() de
// distancia:
//
//   cae unas quince veces mas despacio
//   no cae recto: vaga de lado mientras baja
//   es un disco blando, no una estria dura
//   mira del todo a la camara, mientras que la gota se queda vertical
//
// Como es un uniform, un chubasco puede volverse aguanieve y volver moviendo un
// numero, y la transicion sale gratis.

const ESTRIAS = 3000;
const CAJA = 70.0;            // lado de la columna de precipitacion que te sigue
const CAJA_H = 42.0;
const CAIDA = 24.0;           // m/s. La lluvia de verdad cae a unos 9; esto se lee mejor
const LARGO = 0.85;

// La gota no es gris: es del color de la luz que le da. Dejarla casi blanca y
// que la tinten la niebla y el cielo de detras es lo que sale bien; una gota con
// color propio parece un fallo.
const GOTA = [0.55, 0.60, 0.68];
const COPO = [0.86, 0.89, 0.95];

export class Precipitacion extends THREE.Group {
  constructor() {
    super();
    this.name = 'Precipitacion';
    this.cantidad = 0.0;        // lluvia: 0 seco, 1 diluvio
    this.nieve = 0.0;           // nieve: 0 nada, 1 ventisca

    // InstancedBufferGeometry, y TIENE que serlo: colgar InstancedBufferAttribute
    // de un PlaneGeometry normal compila, enlaza, se ejecuta, no da ningun error
    // y dibuja exactamente UNA gota, porque nadie le ha dicho al renderer que
    // hay tres mil. Los atributos instanciados se leen entonces como atributos
    // de vertice corrientes y el sistema entero se convierte en un solo cuadrado.
    //
    // Seis centimetros de ancho, no dos. El lienzo no llega a mil pixeles de
    // ancho con un campo de 68 grados: a diez metros, una estria de 2 cm es un
    // quinto de pixel, el rasterizador la tira y la lluvia es invisible.
    const plano = new THREE.PlaneGeometry(0.06, LARGO);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plano.index;
    geo.attributes.position = plano.attributes.position;
    geo.instanceCount = ESTRIAS;

    // Siembra determinista con el mezclador de la casa. El original usaba
    // Math.random() aqui; en este proyecto todo sale de una semilla, y aunque a
    // la lluvia no se le vea la diferencia, un Math.random suelto es una puerta
    // abierta para el siguiente que copie el patron.
    const offset = new Float32Array(ESTRIAS * 3);
    const velocidad = new Float32Array(ESTRIAS);
    const u = (i, c) => mezcla(i, c, 0x11004) / 4294967296;
    for (let i = 0; i < ESTRIAS; i++) {
      offset[i * 3] = (u(i, 1) - 0.5) * CAJA;
      offset[i * 3 + 1] = u(i, 2) * CAJA_H;
      offset[i * 3 + 2] = (u(i, 3) - 0.5) * CAJA;
      velocidad[i] = 0.75 + u(i, 4) * 0.5;
    }
    geo.setAttribute('aoffset', new THREE.InstancedBufferAttribute(offset, 3));
    geo.setAttribute('avel', new THREE.InstancedBufferAttribute(velocidad, 1));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        tiempo: { value: 0 },
        cantidad: { value: 0 },
        origen: { value: new THREE.Vector3() },
        colorGota: { value: new THREE.Color(...GOTA) },
        colorCopo: { value: new THREE.Color(...COPO) },
        viento: { value: new THREE.Vector2(0.18, 0.06) },
        nieve: { value: 0 },
      },
      vertexShader: `
        attribute vec3 aoffset;
        attribute float avel;
        uniform float tiempo;
        uniform float cantidad;
        uniform float nieve;
        uniform vec3 origen;
        uniform vec2 viento;
        varying float vFade;
        varying vec2 vUV;
        void main() {
          // La columna va anclada a la camara y CUADRADA A METROS ENTEROS. El
          // redondeo importa: sin el, el campo entero se desliza contigo y la
          // lluvia se lee como quieta, que es el fallo que delata a estos
          // sistemas.
          vUV = position.xy;
          vec3 base = floor(origen) + aoffset;
          // Un copo tarda unas quince veces mas en bajar que una gota.
          float vel = mix(${CAIDA.toFixed(1)}, 1.6, nieve) * avel;
          float cae = mod(base.y - tiempo * vel, ${CAJA_H.toFixed(1)});
          vec3 p = vec3(base.x, floor(origen.y) + cae - ${(CAJA_H * 0.35).toFixed(1)}, base.z);
          p.xz += viento * cae * mix(1.0, 2.6, nieve);

          // La nieve vaga. Dos senos desfasados en la horizontal, escalados por
          // lo que ya ha caido, para que no haya dos copos con el mismo camino y
          // ninguno baje recto. Es lo unico que separa a la nieve de la lluvia
          // blanca.
          float ph = avel * 53.7 + aoffset.x + aoffset.z;
          p.x += nieve * (sin(tiempo * 0.7 + ph) + 0.5 * sin(tiempo * 1.9 + ph * 2.3)) * 1.6;
          p.z += nieve * (cos(tiempo * 0.6 + ph * 1.7) + 0.5 * cos(tiempo * 2.1 + ph)) * 1.6;

          // La lluvia solo gira sobre la vertical, para que una estria siga
          // siendo una estria vertical: un cuadrado que mire del todo a la
          // camara se convierte en un punto cuando miras hacia arriba. La nieve
          // quiere justo ese punto, asi que ella si gira del todo.
          vec3 aCam = normalize(cameraPosition - p);
          vec3 der = normalize(cross(vec3(0.0, 1.0, 0.0), aCam));
          vec3 arribaLluvia = normalize(vec3(-viento.x, 1.0, -viento.y));
          vec3 arribaNieve = normalize(cross(aCam, der));
          vec3 arriba = normalize(mix(arribaLluvia, arribaNieve, nieve));
          // El copo es corto y ancho donde la gota es larga y fina.
          vec2 tam = vec2(mix(1.0, 3.4, nieve), mix(1.0, 0.16, nieve));
          tam *= mix(1.0, 0.7 + avel * 0.9, nieve);
          vec3 mundo = p + der * position.x * tam.x + arriba * position.y * tam.y;

          // Cuando afloja se RALEA, no se acorta. Una gota que encoge parece un
          // fallo de dibujado; una gota que no esta parece menos lluvia.
          float densidad = max(cantidad, nieve);
          vFade = step(1.0 - densidad, fract(avel * 91.7));
          gl_Position = projectionMatrix * viewMatrix * vec4(mundo, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 colorGota;
        uniform vec3 colorCopo;
        uniform float cantidad;
        uniform float nieve;
        varying float vFade;
        varying vec2 vUV;
        void main() {
          if (vFade < 0.5) discard;
          // La gota es una astilla de borde duro. El copo es un disco blando, y
          // lo blando importa mas que la forma: un cuadrado blanco de borde duro
          // es un pixel muerto, uno difuminado es nieve.
          float r = length(vec2(vUV.x / 0.03, vUV.y / 0.425));
          float blando = 1.0 - smoothstep(0.25, 1.0, r);
          float a = mix(0.5 * cantidad, blando * 0.85 * nieve, nieve);
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(colorGota, colorCopo, nieve), a);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    // No hay nada que recortar: la caja va con la camara, asi que siempre esta
    // delante. Dejar el recorte puesto solo sirve para que el volumen envolvente,
    // que se calculo en el origen, la haga desaparecer.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.add(this.mesh);
  }

  update(t, camPos) {
    const u = this.mat.uniforms;
    u.tiempo.value = t;
    u.origen.value.copy(camPos);
    u.cantidad.value = this.cantidad;
    u.nieve.value = this.nieve;
    // La nieve se mezcla en ADITIVO como la lluvia solo mientras es poca; una
    // ventisca en aditivo se vuelve una pasta blanca. En normal, una nevada
    // gorda se sigue leyendo como muchos copos sueltos.
    const modo = this.nieve > 0.35 ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (this.mat.blending !== modo) {
      this.mat.blending = modo;
      this.mat.needsUpdate = true;
    }
    this.mesh.visible = this.cantidad > 0.02 || this.nieve > 0.02;
  }
}
