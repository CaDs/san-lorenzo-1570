import * as THREE from 'three';

// Ciclo de dia y noche.
//
// El sol no gira en un plano: se calcula su posicion real para la latitud del
// pueblo y el dia del ano, asi que en octubre sale tarde por el sudeste y se
// pone pronto, y el mediodia no llega al cenit. La luna se coloca opuesta al
// sol, que es donde esta una luna llena de verdad.
//
// Teclas: [ y ] mueven una hora, P pausa el reloj.

const SUN_HIGH = [1.0, 0.96, 0.90];
const SUN_LOW = [1.0, 0.42, 0.16];
const MOON = [0.56, 0.68, 1.0];

const NIGHT_TOP = [0.016, 0.020, 0.042];
const NIGHT_HOR = [0.062, 0.068, 0.105];
const DAY_TOP = [0.145, 0.275, 0.60];
const DAY_HOR = [0.60, 0.68, 0.78];
const DUSK_HOR = [0.72, 0.32, 0.16];
const NIGHT_GROUND = [0.008, 0.009, 0.014];
const DAY_GROUND = [0.16, 0.15, 0.13];

const AMB_NIGHT = [0.34, 0.42, 0.62];
const AMB_DAY = [0.54, 0.56, 0.62];
const FOG_NIGHT = [0.055, 0.065, 0.098];
const FOG_DAY = [0.52, 0.58, 0.66];

// La sombra direccional es lo que se rompio en Godot web, asi que aqui va
// explicita y a mano. SHADOW_HALF es el semilado en metros de la caja ortografica
// que sigue al jugador: mas grande alcanza mas lejos y pierde nitidez.
// ponytail: una sola cascada en vez de las 4 de Godot. Si hiciera falta sombra
// de monte a lo lejos, CSM de three/addons; para una calle de pueblo sobra esto.
const SHADOW_HALF = 200.0;
const SHADOW_MAP = 2048;
// Terreno de 5 m por triangulo: sin este sesgo sale acne y la dehesa entera se
// vuelve negra, que es justo el fallo que trajo el puerto aqui.
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.12;

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

function smoothstep(from, to, x) {
  const t = clamp((x - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Cielo procedural equivalente al ProceduralSkyMaterial de Godot: dos degradados
// (cielo y suelo) que se encuentran en el horizonte, con la misma curva.
const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
  }
`;

const SKY_FRAG = `
  uniform vec3 topColor, horizonColor, groundHorizon, groundBottom, sunColor;
  uniform vec3 sunDir, moonDir;
  uniform float sunEnergy, noche, tiempo;
  varying vec3 vDir;
  const float SKY_CURVE = 0.12;
  const float GROUND_CURVE = 0.02;

  // Nada de fract(sin(dot(...))) aqui: las celdas del cielo llegan a +-340, el
  // producto escalar se va a decenas de miles y el sin() en float32 pierde
  // precision hasta devolver casi lo mismo siempre. Resultado: cielo sin
  // estrellas. Este mezclador no pasa por sin() y aguanta enteros grandes.
  float hash31(vec3 p) {
    vec3 q = fract(p * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Estrellas: se trocea la esfera celeste en celdas y en unas pocas se enciende
  // un punto. Se sortea el brillo ademas de la existencia, para que el cielo no
  // salga con todas iguales, que es lo que delata a un cielo falso.
  float estrellas(vec3 d) {
    vec3 q = floor(d * 340.0);
    float h = hash31(q);
    float existe = smoothstep(0.9972, 0.9995, h);
    float brillo = 0.35 + 0.65 * hash31(q + 7.13);
    // Centelleo lento y desfasado por estrella.
    float guino = 0.75 + 0.25 * sin(tiempo * 1.7 + h * 90.0);
    return existe * brillo * guino;
  }
`
+ `
  void main() {
    vec3 d = normalize(vDir);
    float c = abs(acos(clamp(d.y, -1.0, 1.0)) - 1.5707963) / 1.5707963;
    vec3 sky = mix(horizonColor, topColor,
                   clamp(1.0 - pow(1.0 - c, 1.0 / SKY_CURVE), 0.0, 1.0));
    vec3 ground = mix(groundHorizon, groundBottom,
                      clamp(1.0 - pow(1.0 - c, 1.0 / GROUND_CURVE), 0.0, 1.0));
    vec3 col = mix(ground, sky, step(0.0, d.y));

    // Estrellas solo de noche, solo por encima del horizonte y apagandose cerca
    // de el, donde en la realidad se las come la bruma.
    float alto = smoothstep(0.02, 0.30, d.y);
    col += vec3(0.86, 0.90, 1.0) * estrellas(d) * noche * alto;

    // Luna: disco mas ancho y blando que el sol, con un halo corto alrededor.
    float angL = degrees(acos(clamp(dot(d, moonDir), -1.0, 1.0)));
    col += vec3(0.62, 0.70, 0.92) * noche
         * (1.6 * (1.0 - smoothstep(0.0, 1.6, angL))
            + 0.10 * (1.0 - smoothstep(1.6, 9.0, angL)));

    // Disco solar, como el sun_angle_max de Godot.
    float ang = degrees(acos(clamp(dot(d, sunDir), -1.0, 1.0)));
    col += sunColor * sunEnergy * (1.0 - smoothstep(0.0, 4.0, ang));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class DayNight {
  constructor(scene, world, lat = 40.59) {
    this.world = world;
    this.lat = lat;
    this.hour = 21.5;
    this.daySeconds = 480.0;     // lo que dura un dia completo en tiempo real
    this.dayOfYear = 300;        // finales de octubre
    this.paused = false;

    this.sun = new THREE.DirectionalLight(0xffffff, 0);
    this.moon = new THREE.DirectionalLight(0xffffff, 0);
    for (const l of [this.sun, this.moon]) {
      l.castShadow = true;
      l.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
      const c = l.shadow.camera;
      c.left = -SHADOW_HALF; c.right = SHADOW_HALF;
      c.top = SHADOW_HALF; c.bottom = -SHADOW_HALF;
      c.near = 1; c.far = 4000;
      c.updateProjectionMatrix();     // sin esto la caja sigue siendo la de 10 m
      l.shadow.bias = SHADOW_BIAS;
      l.shadow.normalBias = SHADOW_NORMAL_BIAS;
      scene.add(l, l.target);
    }

    this.ambient = new THREE.AmbientLight(0xffffff, 0.5 * Math.PI);
    scene.add(this.ambient);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color() },
        horizonColor: { value: new THREE.Color() },
        groundHorizon: { value: new THREE.Color() },
        groundBottom: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        moonDir: { value: new THREE.Vector3(0, -1, 0) },
        sunEnergy: { value: 0 },
        noche: { value: 1 },
        tiempo: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.fog = new THREE.FogExp2(0x000000, 0.0013);
    scene.fog = this.fog;

    addEventListener('keydown', (e) => {
      if (e.code === 'BracketLeft') { this.hour = mod(this.hour - 1, 24); this.apply(); }
      else if (e.code === 'BracketRight') { this.hour = mod(this.hour + 1, 24); this.apply(); }
      else if (e.code === 'KeyP') this.paused = !this.paused;
    });

    this.apply();
  }

  update(dt, camPos) {
    // El centelleo corre aunque el reloj este parado: con ?hour= congelado el
    // cielo seguia vivo y es lo que se quiere para mirar una noche fija.
    this.skyMat.uniforms.tiempo.value += dt;
    if (!this.paused) {
      this.hour = mod(this.hour + 24 * dt / this.daySeconds, 24);
      this.apply();
    }
    // El cielo y la caja de sombra viajan con la camara.
    this.sky.position.copy(camPos);
    this.sky.scale.setScalar(2500);
    for (const l of [this.sun, this.moon]) {
      l.target.position.copy(camPos);
      l.target.updateMatrixWorld();
      l.position.copy(camPos).addScaledVector(l.userData.dir, 1500);
    }
  }

  // Vector unitario que apunta del suelo al sol. +X este, -Z norte, +Y arriba.
  directionToSun() {
    const lat = this.lat * Math.PI / 180;
    const decl = (23.44 * Math.PI / 180) * Math.sin(TAU * (this.dayOfYear - 81) / 365);
    const h = (this.hour - 12) * 15 * Math.PI / 180;
    const sinEl = clamp(Math.sin(decl) * Math.sin(lat)
      + Math.cos(decl) * Math.cos(lat) * Math.cos(h), -1, 1);
    const el = Math.asin(sinEl);
    const az = Math.atan2(-Math.sin(h),
      Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(h));   // desde el norte
    return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el),
      -Math.cos(el) * Math.cos(az));
  }

  apply() {
    const toSun = this.directionToSun();
    const s = toSun.y;                        // seno de la elevacion solar
    const dia = smoothstep(-0.05, 0.16, s);
    const noche = smoothstep(0.10, -0.10, s);
    // Pico en el horizonte, tanto al alba como al ocaso.
    const crep = clamp(1 - Math.abs(s) / 0.20, 0, 1);

    // La luz viaja al reves que la direccion al sol.
    this.sun.userData.dir = toSun;
    this.sun.intensity = 2.6 * dia;
    const sunCol = lerp3(SUN_HIGH, SUN_LOW, clamp(1 - s / 0.30, 0, 1));
    this.sun.color.setRGB(...sunCol, THREE.LinearSRGBColorSpace);
    // castShadow y autoUpdate no se tocan nunca. Cambiar castShadow recompila
    // todos los shaders; y apagar autoUpdate deja el sampler de sombra apuntando
    // a una textura que aun no existe, que en Metal devuelve NaN y tine de negro
    // TODO el fragmento, luz ambiente incluida. Dos mapas de 2048 salen mas
    // baratos que uno de 4096 y ahorran ese campo de minas.
    //
    // ponytail: la luna repinta su mapa a mediodia con intensidad cero, o sea
    // media escena dibujada para nada durante medio ciclo. Se arregla con
    // `if (l.shadow.map) l.shadow.autoUpdate = activa;` -la guarda evita el NaN
    // porque el mapa ya existe-, pero eso hay que MIRARLO en pantalla antes de
    // darlo por bueno: el modo de fallo de esta linea es el pueblo entero a
    // oscuras, y ya paso una vez.

    this.moon.userData.dir = toSun.clone().negate();
    this.moon.intensity = 0.8 * noche;
    this.moon.color.setRGB(...MOON, THREE.LinearSRGBColorSpace);

    const hor = lerp3(lerp3(NIGHT_HOR, DAY_HOR, dia), DUSK_HOR, crep * 0.8);
    const u = this.skyMat.uniforms;
    u.topColor.value.setRGB(...lerp3(NIGHT_TOP, DAY_TOP, dia), THREE.LinearSRGBColorSpace);
    u.horizonColor.value.setRGB(...hor, THREE.LinearSRGBColorSpace);
    u.groundHorizon.value.setRGB(...hor, THREE.LinearSRGBColorSpace);
    u.groundBottom.value.setRGB(...lerp3(NIGHT_GROUND, DAY_GROUND, dia),
      THREE.LinearSRGBColorSpace);
    u.sunColor.value.setRGB(...sunCol, THREE.LinearSRGBColorSpace);
    u.sunDir.value.copy(toSun);
    u.moonDir.value.copy(toSun).negate();      // la luna, opuesta al sol
    u.sunEnergy.value = dia;
    u.noche.value = noche;

    this.ambient.color.setRGB(...lerp3(AMB_NIGHT, AMB_DAY, dia), THREE.LinearSRGBColorSpace);
    // Godot suma la ambiental como color * energia * albedo. three la pasa por
    // BRDF_Lambert, que divide entre PI. Sin este factor la sombra sale tres
    // veces mas oscura que en el original y el pueblo de dia parece de noche.
    this.ambient.intensity = (0.5 + (0.95 - 0.5) * dia) * Math.PI;

    this.fog.color.setRGB(...lerp3(lerp3(FOG_NIGHT, FOG_DAY, dia), DUSK_HOR, crep * 0.5),
      THREE.LinearSRGBColorSpace);
    this.fog.density = 0.0013 + (0.00075 - 0.0013) * dia;

    // Se encienden un poco antes de que anochezca del todo, como en la vida.
    this.world.setNight(smoothstep(0.16, -0.02, s));
  }
}

function mod(a, n) { return ((a % n) + n) % n; }
