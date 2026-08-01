import * as THREE from 'three';
import { clima, climaFijo } from './clima.js';

// Ciclo de dia y noche, y el tiempo que hace.
//
// El sol no gira en un plano: se calcula su posicion real para la latitud del
// pueblo y el dia del ano, asi que en octubre sale tarde por el sudeste y se
// pone pronto, y el mediodia no llega al cenit. La luna se coloca opuesta al
// sol, que es donde esta una luna llena de verdad.
//
// El dia del ano estuvo clavado en el 300 desde el principio, o sea que toda esa
// cuenta astronomica servia para un solo dia de finales de octubre. Ahora corre,
// y con el corre el clima: esta clase es la duena de las dos cosas porque el
// clima no tiene ninguna entrada que esta no tuviera ya -dia y hora- y toda su
// salida cae sobre cosas que esta ya escribe: la niebla, el sol, el ambiente y
// los colores del cielo. Un modulo aparte seria un objeto mas que instanciar,
// cablear y sincronizar con este mismo reloj.
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

// Hacia donde tira todo cuando el cielo se tapa. Un dia cubierto de sierra es
// gris plano, sin azul arriba y sin naranja en el horizonte.
const NUBE_DIA = [0.46, 0.48, 0.51];
const NUBE_NOCHE = [0.038, 0.042, 0.052];

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
  constructor(scene, world, lat = 40.59, semilla = 1) {
    this.world = world;
    this.lat = lat;
    this.semilla = semilla >>> 0 || 1;
    this.hour = 21.5;
    // Un minuto de reloj de verdad por cada hora del pueblo. Estaba en 480 s -o
    // sea el dia entero en ocho minutos-, y con las campanas puestas eso son ocho
    // horas del oficio en ocho minutos: una campanada por minuto, que cansa en
    // dos vueltas. A 1440 s se tane cada tres minutos largos y el dia sigue
    // pasando lo bastante deprisa como para ver anochecer sin esperar. Y quien
    // quiera otra cosa tiene el deslizador de la barra y ?hour=.
    this.daySeconds = 1440.0;
    this.dayOfYear = 300;        // finales de octubre, que es como nacio esto
    this.paused = false;
    // null = el tiempo que toque; una clave de ESTADOS = el que se ha impuesto
    // desde la barra o con ?clima=.
    this.climaForzado = null;
    this.clima = null;           // lo rellena apply()

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
      // El calendario avanza cuando el reloj da la vuelta. Con daySeconds = 480
      // un ano son 48 h de juego, asi que esto es por correccion y no por
      // jugabilidad: las estaciones se ven por la barra o con ?dia=. No tocar
      // daySeconds para acelerarlo, que el ciclo diurno esta calibrado y es lo
      // que se mira; el mando para eso seria otro.
      const h = this.hour + 24 * dt / this.daySeconds;
      if (h >= 24) this.dayOfYear = (this.dayOfYear % 365) + 1;
      this.hour = mod(h, 24);
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
    // El clima primero, que de el dependen la luz, la niebla y el cielo. Forzado
    // y automatico salen del mismo constructor, asi que no puede haber un campo
    // que solo rellene uno de los dos caminos.
    const c = this.climaForzado
      ? climaFijo(this.climaForzado, this.dayOfYear, this.hour, this.semilla)
      : clima(this.semilla, this.dayOfYear, this.hour);
    this.clima = c;
    const nub = c.nublado;

    const toSun = this.directionToSun();
    const s = toSun.y;                        // seno de la elevacion solar
    // De dia y de noche, y guardados: el sonido los quiere para no repetir la
    // misma cuenta astronomica, y son exactamente los mismos numeros con los que
    // se enciende el sol y se apagan las estrellas. Dos sistemas con dos ideas
    // distintas de cuando anochece es el fallo que se ve -o se oye- al ocaso.
    const dia = this.dia = smoothstep(-0.05, 0.16, s);
    const noche = this.noche = smoothstep(0.10, -0.10, s);
    // Pico en el horizonte, tanto al alba como al ocaso. Se apaga con las nubes:
    // sin esto un ocaso de lluvia sale igual de naranja que uno raso, que seria
    // lo mas raro de ver de todo esto. El sol no tine el horizonte a traves de un
    // cielo cubierto porque no llega.
    const crep = clamp(1 - Math.abs(s) / 0.20, 0, 1) * (1 - nub);

    // La luz viaja al reves que la direccion al sol.
    this.sun.userData.dir = toSun;
    // Bajo cubierto la directa casi desaparece, y las sombras se ablandan solas
    // al irse. No se toca castShadow ni autoUpdate: ver el aviso de mas abajo.
    this.sun.intensity = 2.6 * dia * (1 - 0.85 * nub);
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

    // El cielo tapado se va a gris: se pierde el azul de arriba y el naranja del
    // horizonte, que es de lo que se compone un dia cubierto de sierra.
    const gris = lerp3(NUBE_NOCHE, NUBE_DIA, dia);
    const conNubes = (col) => lerp3(col, gris, nub * 0.85);

    const hor = lerp3(lerp3(NIGHT_HOR, DAY_HOR, dia), DUSK_HOR, crep * 0.8);
    const u = this.skyMat.uniforms;
    u.topColor.value.setRGB(...conNubes(lerp3(NIGHT_TOP, DAY_TOP, dia)),
      THREE.LinearSRGBColorSpace);
    u.horizonColor.value.setRGB(...conNubes(hor), THREE.LinearSRGBColorSpace);
    u.groundHorizon.value.setRGB(...conNubes(hor), THREE.LinearSRGBColorSpace);
    u.groundBottom.value.setRGB(...lerp3(NIGHT_GROUND, DAY_GROUND, dia),
      THREE.LinearSRGBColorSpace);
    u.sunColor.value.setRGB(...sunCol, THREE.LinearSRGBColorSpace);
    u.sunDir.value.copy(toSun);
    u.moonDir.value.copy(toSun).negate();      // la luna, opuesta al sol
    u.sunEnergy.value = dia * (1 - nub);
    // Apaga estrellas y luna bajo las nubes sin tocar ni una linea de SKY_FRAG:
    // el shader ya las multiplica por `noche`, asi que basta con mentirle.
    u.noche.value = noche * (1 - nub);

    this.ambient.color.setRGB(...lerp3(AMB_NIGHT, AMB_DAY, dia), THREE.LinearSRGBColorSpace);
    // Godot suma la ambiental como color * energia * albedo. three la pasa por
    // BRDF_Lambert, que divide entre PI. Sin este factor la sombra sale tres
    // veces mas oscura que en el original y el pueblo de dia parece de noche.
    //
    // Con nubes sube: lo que se pierde en directa se gana en relleno, que es
    // justo lo que hace que un dia cubierto no tenga sombras pero se vea.
    this.ambient.intensity = (0.5 + (0.95 - 0.5) * dia) * (1 + 0.35 * nub) * Math.PI;

    this.fog.color.setRGB(
      ...conNubes(lerp3(lerp3(FOG_NIGHT, FOG_DAY, dia), DUSK_HOR, crep * 0.5)),
      THREE.LinearSRGBColorSpace);
    // La niebla de estancamiento de esta sierra no es bruma: son 59 dias al ano
    // y con el multiplicador de 9 el Monasterio desaparece a unos 150 m, que es
    // lo que hace en noviembre visto desde la carretera de la estacion.
    // Dos regimenes que antes eran uno solo, y por eso no se podian tener los
    // dos: aire limpio y niebla de estancamiento.
    //
    // Con el pueblo solo, a 3,6 km de lado, nunca se miraba mas alla de kilometro
    // y medio, asi que 0,0013 con aire limpio no molestaba. Con la sierra puesta
    // esa densidad borra Abantos ENTERO: a 1,7 km deja pasar el 0,8% de la luz.
    // Un dia raso de sierra se ve la cumbre, y ahora se ve.
    //
    // Pero el multiplicador de niebla iba lineal, y bajando la base a la quinta
    // parte los 59 dias de niebla del ano se quedaban en bruma de nada. Va al
    // cuadrado largo: con niebla 9 el Monasterio vuelve a desaparecer a unos
    // 150 m -que es lo que hace en noviembre desde la carretera de la estacion- y
    // con 1 el aire esta limpio. Entre medias, la lluvia deja ver 700 m.
    this.fog.density = (0.00040 + (0.00022 - 0.00040) * dia) * Math.pow(c.niebla, 1.75);

    // Se encienden un poco antes de que anochezca del todo, como en la vida.
    this.world.setNight(smoothstep(0.16, -0.02, s));
    // Y el tiempo, que es quien pinta el pasto seco, la nieve y el humo.
    if (this.world.setClima) this.world.setClima(c);
  }
}

function mod(a, n) { return ((a % n) + n) % n; }
