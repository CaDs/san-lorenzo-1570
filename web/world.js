import * as THREE from 'three';
import { crearArboleda } from './trees.js';
import { Precipitacion } from './lluvia.js';
import { Humo } from './humo.js';
import { muestrear } from './ambiente.js';

// Construye el terreno y los edificios de San Lorenzo desde data/build/.
// Sistema de coordenadas:
//   X = Este - origin_utm[0], Z = Norte maximo - Norte (o sea +Z al sur),
//   Y = altitud sobre el nivel del mar. 1 unidad = 1 metro real (UTM 30N).
//
// Diferencia con Godot que hay que tener presente al leer: alli la cara frontal
// va en sentido horario, aqui en antihorario. Cada triangulo sale con los dos
// ultimos vertices intercambiados respecto del original.

const DATA = '../data/build/';

// Escala medieval. OSM describe el pueblo de hoy: bloques de 4 a 6 plantas de
// 3 m. Un caserio medieval son 1 a 3 alturas escasas.
const STOREY_H = 2.6;
const MAX_STOREYS = 3;
const STOREY_DIV = 3.2;

const ROOF_PITCH = 0.92;
const ROOF_MAX = 4.6;
const EAVES = 0.45;
// Vuelo del alero en una cubierta de patio, por dentro y por fuera.
const ALERO_PATIO = 0.9;
const PASO_SONDA = 2.0;         // m entre sondas al medir el vuelo de un faldon
const VUELO_MAX = 1.0;          // m de faldon sobre el vacio que se toleran

const MON_WALL_H = 15.0;
const MON_TOWER_W = 12.0;
// Estas cotas se subieron al meter la parrilla: con las crujias a 28 m, los
// chapiteles de 30 asomaban dos metros y la silueta se perdia. Ahora los
// remates vuelven a mandar sobre la masa, que es como se lee El Escorial.
const MON_TOWER_H = 36.0;
const MON_SPIRE_H = 12.0;
const MON_DRUM_R = 11.0;
const MON_DRUM_H = 36.0;
const MON_DOME_H = 50.0;
const MON_BELL_W = 8.0;
const MON_BELL_H = 40.0;
const MON_SLATE = [0.070, 0.075, 0.098];
const MON_PAVING = [0.115, 0.112, 0.104];   // granito del suelo de los patios

// La parrilla de San Lorenzo. Lo que hace reconocible al Monasterio desde el
// aire no son las torres, es la reticula de patios. Se levanta encima de la tapa
// de la muralla: asi la tapa pasa a hacer de suelo de los patios y no hay que
// recortar la huella real de OSM, que viene mellada por donde los jardines.
const MON_GRID_U = 4;          // patios a lo largo del eje mayor
const MON_GRID_V = 3;
const MON_WING_W = 14.0;       // ancho de la cruja entre patios
const MON_WING_H = 7.0;        // altura de la cruja sobre la tapa
const MON_WING_ROOF = 6.0;     // altura de la cumbrera sobre la cruja
const MON_INSET = 5.0;         // margen contra el borde teorico del rectangulo
const MON_LANTERN_R = 3.4;     // linternilla del cimborrio
const MON_LANTERN_H = 7.0;

const GROUND_FLAT = [0.058, 0.065, 0.052];
const GROUND_STEEP = [0.105, 0.102, 0.115];
const ROOF_THATCH = [0.115, 0.086, 0.052];
const ROOF_TILE = [0.105, 0.062, 0.045];
const CHIMNEY_STONE = [0.083, 0.080, 0.077];   // sillar de chimenea, mas oscuro que STONE_GRAY
const ROAD_MUD = [0.108, 0.092, 0.072];
const ROAD_MAX_W = 6.5;

const TORCH_SPACING = 30.0;
const TORCH_HEIGHT = 2.6;
// Antorchas visibles hay miles, pero luces reales solo estas: se reasignan a las
// mas cercanas. En Godot era por el agrupador de luces; aqui porque cada luz
// que entra en la escena recompila el shader de todos los materiales.
const LIGHT_POOL = 40;
const LIGHT_RADIUS = 70.0;
// ponytail: la atenuacion de Godot (energia 5, alcance 13, exponente 1.8) no
// tiene equivalente exacto en three, que va a inversa del cuadrado. Estos dos
// son el mando: TORCH_DECAY mas bajo = charco de luz mas largo.
// Godot daba energia 5, alcance 13 y exponente 1.8, o sea (1 - d/13)^1.8. three
// va a I/d^decay con corte suave en `distance`. Ajustado a ojo contra la captura
// de referencia: con decay 2 el charco se apaga demasiado pronto, con 1.5 se
// desborda y las fachadas salen blancas.
const TORCH_INTENSITY = 8.0;
const TORCH_DECAY = 1.1;
const TORCH_RANGE = 13.0;

const OCC_CELL = 10.0;
const TREE_GRID = 11.0;
const TREE_LINE = 1080.0;
const WELL_COUNT = 8;
const CART_COUNT = 14;
const STACK_COUNT = 260;
const TRUNK_BROWN = [0.065, 0.048, 0.034];
const WOOD_DARK = [0.082, 0.060, 0.038];
const STONE_GRAY = [0.150, 0.146, 0.140];

const TAU = Math.PI * 2;

// --- ayudantes numericos, con la misma semantica que en GDScript --------------

const fract = (x) => x - Math.floor(x);
const hash = (a, b) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function smoothstep(from, to, x) {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// El atrezzo de Godot usa RandomNumberGenerator con semilla 1387 (PCG32).
// Reproducirlo bit a bit no aporta nada, pero determinista si tiene que ser: el
// pueblo debe salir igual en cada arranque. xorshift32 con la misma semilla.
function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  return {
    randf: () => next() / 4294967296,
    randi_range: (a, b) => a + (next() % (b - a + 1)),
  };
}

// Acumulador de malla: posicion, normal y color por vertice, sin indices.
// A esta escala la memoria da igual y el codigo sale mucho mas corto.
class Soup {
  constructor() { this.v = []; this.n = []; this.c = []; }

  // Anade un triangulo orientando la cara hacia fuera del solido. `dentro` es un
  // punto interior. Emite en antihorario, que es lo que quiere WebGL.
  tri(a, b, c, dentro, col) {
    const nx = (c[1] - a[1]) * (b[2] - a[2]) - (c[2] - a[2]) * (b[1] - a[1]);
    const ny = (c[2] - a[2]) * (b[0] - a[0]) - (c[0] - a[0]) * (b[2] - a[2]);
    const nz = (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    let n = [nx / len, ny / len, nz / len];
    const cx = (a[0] + b[0] + c[0]) / 3 - dentro[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - dentro[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - dentro[2];
    // Godot emitiria [a,b,c]; en antihorario eso es [a,c,b], y al reves.
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) {
      n = [-n[0], -n[1], -n[2]];
      this.push(a, b, c, n, col);
    } else {
      this.push(a, c, b, n, col);
    }
  }

  push(a, b, c, n, col) {
    this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) {
      this.n.push(n[0], n[1], n[2]);
      this.c.push(col[0], col[1], col[2]);
    }
  }

  get empty() { return this.v.length === 0; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.v, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// Caja orientada con color por vertice. `b` es una matriz 3x3 por columnas
// [bx, by, bz], que permite vuelco ademas de giro (las ruedas lo necesitan).
function boxCol(soup, o, he, b, col) {
  const sc = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
  const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const ax = sc(b[0], he[0]), ay = sc(b[1], he[1]), az = sc(b[2], he[2]);
  for (const f of [[ax, ay, az], [ay, az, ax], [az, ax, ay]]) {
    for (const s of [1, -1]) {
      const fn = sc(f[0], s), e1 = f[1], e2 = f[2];
      soup.tri(sub(sub(add(o, fn), e1), e2), sub(add(add(o, fn), e1), e2),
        add(add(add(o, fn), e1), e2), o, col);
      soup.tri(sub(sub(add(o, fn), e1), e2), add(add(add(o, fn), e1), e2),
        add(sub(add(o, fn), e1), e2), o, col);
    }
  }
}

// Piramide orientada (tejadillos de pozo).
function pyrCol(soup, o, hw, h, b, col) {
  const apex = [o[0], o[1] + h, o[2]];
  const e = [
    [b[0][0] * hw + b[2][0] * hw, b[0][1] * hw + b[2][1] * hw, b[0][2] * hw + b[2][2] * hw],
    [b[0][0] * hw - b[2][0] * hw, b[0][1] * hw - b[2][1] * hw, b[0][2] * hw - b[2][2] * hw],
    [-b[0][0] * hw - b[2][0] * hw, -b[0][1] * hw - b[2][1] * hw, -b[0][2] * hw - b[2][2] * hw],
    [-b[0][0] * hw + b[2][0] * hw, -b[0][1] * hw + b[2][1] * hw, -b[0][2] * hw + b[2][2] * hw],
  ];
  const at = (i) => [o[0] + e[i][0], o[1] + e[i][1], o[2] + e[i][2]];
  for (let i = 0; i < 4; i++) {
    soup.tri(at(i), at((i + 1) % 4), apex, [o[0], o[1] - 1, o[2]], col);
  }
}

const yawBasis = (a) => [
  [Math.cos(a), 0, -Math.sin(a)], [0, 1, 0], [Math.sin(a), 0, Math.cos(a)],
];

// Adaptador para reusar boxCol/pyrCol (que solo saben escribir en un Soup) al
// escribir en el flujo plano de muros. boxCol solo llama a `soup.tri(...)`, que
// a su vez llama a `this.push(...)`: basta con tomar prestado Soup.prototype.tri
// y darle un `push` que aterrice en wall.v/n/uv (con ainfo en vez de color).
function wallSoup(wall) {
  return {
    tri: Soup.prototype.tri,
    push(a, b, c, n, ainfo) {
      for (const p of [a, b, c]) wall.v.push(p[0], p[1], p[2]);
      for (let i = 0; i < 3; i++) {
        wall.n.push(n[0], n[1], n[2]);
        wall.uv.push(ainfo[0], ainfo[1], ainfo[2]);
      }
    },
  };
}

// Puerta a nivel de calle: un marco que sobresale un poco del muro, suficiente
// para que la silueta lea "casa con puerta" y no "caja lisa". No se recorta un
// hueco real -remallar alrededor de un agujero por casa no compensa a esta
// escala (3545 casas)-, se marca en el flujo de muros con el mismo (seed,
// suelo) de la casa para que el shader de fachada la trate como piedra propia.
// ponytail: la arista se elige por semilla, no por cercania real a una calle;
// cruzar cada muro contra this.data.roads encarece el build para un detalle
// que a 960x540 se ve pero no se mide.
function addDoor(poly, suelo, seed, wall) {
  const n = poly.length;
  if (n < 3) return;
  const ei = Math.floor(fract(seed * 3.7) * n) % n;
  const p = poly[ei], q = poly[(ei + 1) % n];
  const ex = q[0] - p[0], ez = q[1] - p[1];
  const el = Math.hypot(ex, ez);
  if (el < 1.4) return;                        // pared demasiado corta para puerta
  const nx = -ez / el, nz = ex / el;            // normal saliente, igual criterio que extrudeRing
  const tx = ex / el, tz = ez / el;
  const bw = 1.1, dh = 2.1, dp = 0.10;
  const mid = [(p[0] + q[0]) * 0.5, (p[1] + q[1]) * 0.5];
  const o = [mid[0] + nx * dp * 0.5, suelo + dh * 0.5, mid[1] + nz * dp * 0.5];
  const b = [[tx, 0, tz], [0, 1, 0], [nx, 0, nz]];
  boxCol(wallSoup(wall), o, [bw * 0.5, dh * 0.5, dp * 0.5], b, [seed, suelo, 0]);
}

// --- shaders -----------------------------------------------------------------

// Fachada medieval procedural, puerto de wall.gdshader. La malla de casas no
// trae UVs de textura: `ainfo` lleva (semilla de la casa, cota de su suelo).
// Se injerta en un MeshLambertMaterial en vez de escribir un shader completo,
// asi las sombras, la niebla y las 40 antorchas siguen funcionando gratis.
const WALL_COMMON = `
  varying vec3 vInfo;
  varying vec3 vWPos;
  varying vec3 vWNorm;
`;

const WALL_FRAG = `
  const vec3 plaster = vec3(0.285, 0.262, 0.212);
  const vec3 stone   = vec3(0.150, 0.148, 0.140);
  const vec3 timber  = vec3(0.062, 0.045, 0.030);
  const vec3 shutter = vec3(0.070, 0.050, 0.032);
  const vec3 hearth  = vec3(1.0, 0.50, 0.16);
  // El caserio y el Monasterio miden distinto: 2.6 m de planta y vanos de 2.4 m
  // en las casas, 4.2 y 4.0 en el Monasterio, cuyos huecos ademas no se sortean
  // -van todos, en reticula- porque eso es justo lo que se lee de El Escorial.
  // El Escorial real tiene 2600 ventanas, pero a 480x270 una fachada de 200 m
  // con vanos de 4 m son 50 huecos de pixel y medio: se leen como ruido, no como
  // ventanas. El vano va a 6.5 m para que cada hueco ocupe algo.
  const float storey_h = 2.6, mon_storey_h = 5.0;
  const float bay_w = 2.4, mon_bay_w = 6.5;
  const float window_ratio = 0.38;
  const float lit_ratio = 0.30, mon_lit_ratio = 0.12;
  uniform float glow;
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(41.317, 289.107))) * 43758.5453);
  }
`;

function wallMaterial() {
  // Las fachadas son un plano sin grosor ni cara interior: con FrontSide se
  // esfuman en cuanto se las mira desde dentro. three.js ya invierte la normal
  // en la cara trasera, asi que el interior sale oscuro, que es lo que se busca.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  mat.userData.glow = { value: 2.6 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.glow = mat.userData.glow;
    shader.vertexShader = 'attribute vec3 ainfo;\n' + WALL_COMMON + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vInfo = ainfo;
      vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vWNorm = normalize(mat3(modelMatrix) * normal);
    `);
    shader.fragmentShader = WALL_COMMON + WALL_FRAG + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      float seed = vInfo.x;
      float mon = step(0.5, vInfo.z);             // 1 = Monasterio
      float lh = vWPos.y - vInfo.y;               // altura sobre su propio suelo
      float vertical = 1.0 - step(0.55, abs(vWNorm.y));
      // Coordenada a lo largo del muro: la normal girada 90 grados en XZ.
      float u = vWPos.x * vWNorm.z - vWPos.z * vWNorm.x;

      vec3 base = mix(stone, plaster, step(0.30, seed));
      float plinto = mix(0.9 + seed * 0.7, 2.2, mon);
      base = mix(base, stone, step(lh, plinto));

      float sh = mix(storey_h, mon_storey_h, mon);
      float bw = mix(bay_w, mon_bay_w, mon);
      float st = lh / sh;
      float fs = fract(st);
      float fu = fract(u / bw);
      float viga = 0.0;
      if (seed > 0.52 && lh > plinto) {
        float horiz = 1.0 - smoothstep(0.035, 0.085, min(fs, 1.0 - fs));
        float vert = 1.0 - smoothstep(0.035, 0.085, min(fu, 1.0 - fu));
        viga = max(horiz, vert);
      }

      vec2 cell = vec2(floor(u / bw), floor(st));
      // En el caserio el hueco se sortea; en el Monasterio existe siempre.
      float existe = mix(step(1.0 - window_ratio, hash21(cell + seed * 13.0)), 1.0, mon)
              * vertical * step(plinto, lh);
      // Los del Monasterio son mas estrechos y con recerco de granito claro.
      float w0 = mix(0.36, 0.40, mon), w1 = mix(0.64, 0.60, mon);
      float h0 = mix(0.30, 0.26, mon), h1 = mix(0.70, 0.68, mon);
      float win = step(w0, fu) * step(fu, w1)
              * step(h0, fs) * step(fs, h1) * existe;
      float marco = (step(w0 - 0.05, fu) * step(fu, w1 + 0.05)
              * step(h0 - 0.04, fs) * step(fs, h1 + 0.04) * existe - win) * mon;
      float lit = step(1.0 - mix(lit_ratio, mon_lit_ratio, mon), hash21(cell + 5.7)) * win;

      vec3 wcol = mix(base, timber, viga * vertical);
      wcol = mix(wcol, shutter, win);
      wcol = mix(wcol, stone * 1.55, marco);      // recerco de las ventanas
      // Grano grueso. En el Monasterio es sillar de granito, cuatro veces mayor
      // que el del caserio: al tamano de la casa tambien centellearia de lejos.
      // Grano de dos escalas. El de 0.33 m se calibro para un lienzo de 480x270,
      // donde era casi subpixel; a 540 lineas y con la fachada a dos metros se
      // leia como un alicatado de baldosas gordas. La capa fina rompe el bloque
      // sin quitarle el aire de mamposteria a la gruesa.
      float granoGrueso = hash21(floor(vec2(u, lh) * mix(3.0, 0.75, mon)));
      float granoFino = hash21(floor(vec2(u, lh) * mix(14.0, 5.0, mon)) + 31.7);
      wcol *= 0.90 + 0.13 * granoGrueso + 0.09 * granoFino;
      diffuseColor.rgb *= wcol;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      'totalEmissiveRadiance = hearth * lit * glow;');
  };
  return mat;
}

// Ruido de valor barato (hash + bilineal), compartido por terreno y tejados.
// Nada de simplex: a 960x540 esto no se distingue y sale mas barato de compilar.
const NOISE_GLSL = `
  float hashN(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hashN(i), b = hashN(i + vec2(1.0, 0.0));
    float c = hashN(i + vec2(0.0, 1.0)), d = hashN(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
`;

// Detalle de terreno por FRAGMENTO. El color por vertice ya da la pendiente y
// el moteado grueso, pero a una muestra cada 5 m eso son facetas enormes a
// 960x540. Dos octavas de ruido barato -0.5 m y 4 m- rompen la faceta sin
// tocar el color base, mas un empuje extra hacia roca en pendiente fina que el
// vertice, a 5 m de resolucion, no puede ver.
// `roca` a 0 desactiva la mezcla hacia granito: en la calle no hay ladera, y
// el tinte azulado de la roca ensuciaba la tierra pisada.
function terrainMaterial(roca = 1.0, uClima) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uClima = uClima;
    shader.fragmentShader = 'uniform vec2 uClima;\n' + shader.fragmentShader;
    shader.vertexShader = 'varying vec3 vTPos;\nvarying vec3 vTNorm;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vTPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vTNorm = normalize(mat3(modelMatrix) * normal);
    `);
    shader.fragmentShader = `varying vec3 vTPos;\nvarying vec3 vTNorm;\n${NOISE_GLSL}`
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      float nFine = valueNoise(vTPos.xz * 2.0);     // ~0.5 m
      float nCoarse = valueNoise(vTPos.xz * 0.25);  // ~4 m
      float detail = (nFine - 0.5) * 0.30 + (nCoarse - 0.5) * 0.15;   // combinado, +-15% aprox
      diffuseColor.rgb *= 1.0 + clamp(detail, -0.15, 0.15);
      // Pendiente fina hacia roca: el vertice ya mezcla GROUND_STEEP cada 5 m,
      // esto solo afina el borde de esa mezcla a escala de metro.
      float slopeFine = 1.0 - vTNorm.y;
      vec3 rockTint = vec3(1.55, 1.48, 1.70) * (0.85 + 0.3 * nFine);
      diffuseColor.rgb *= mix(vec3(1.0), rockTint,
          smoothstep(0.30, 0.65, slopeFine) * 0.35 * ${roca.toFixed(2)});
    `);
    // OJO CON EL SITIO: la estacion va DESPUES de <color_fragment>, no en
    // <map_fragment> como el ruido de arriba. En el fragmento de three el orden
    // es map_fragment y luego color_fragment, y color_fragment hace
    // `diffuseColor *= vColor`. Todo lo que hay arriba es multiplicativo y por
    // eso le da igual el orden; una MEZCLA no: pintaba el suelo de blanco y
    // acto seguido el color de vertice del terreno -que es casi negro- lo
    // devolvia a pardo. Se veia como que el uniforme no llegaba, y llegaba.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // El pasto de agosto, que es la senal de estacion mas visible del termino.
      // Va en el shader y no rehorneando el atributo de color porque el terreno
      // son mas de 400.000 vertices con el color ya cocido por pendiente.
      diffuseColor.rgb = mix(diffuseColor.rgb,
          diffuseColor.rgb * vec3(1.45, 1.20, 0.62), uClima.x);

      // La nieve cuaja por COTA, no en todo a la vez. La linea baja segun cuanta
      // hay: con poca solo se blanquean las cumbres y el pueblo, a 1030, sigue
      // pardo, que es lo que pasa la mayoria de las veces que nieva aqui. Y no
      // cuaja en lo vertical.
      //
      // El primer factor -"que HAYA nieve"- faltaba, y no se veia: sin nieve la
      // linea se queda en 1350 m y el terreno del pueblo llega a 1334, asi que
      // nunca daba. Al meter la sierra, que sube a 1756, Abantos amanecio nevado
      // un 15 de julio. El fallo llevaba ahi desde el primer dia, esperando a que
      // el mundo tuviera una cumbre.
      float linea = 1350.0 - uClima.y * 500.0;
      float cuaja = smoothstep(0.0, 0.10, uClima.y)
                  * smoothstep(linea, linea + 120.0, vTPos.y)
                  * smoothstep(0.35, 0.75, vTNorm.y);
      diffuseColor.rgb = mix(diffuseColor.rgb,
          vec3(0.52, 0.55, 0.60) * (0.90 + 0.20 * nFine), cuaja);
    `);
  };
  return mat;
}

// Estriado de tejado por FRAGMENTO: hiladas de teja a lo largo de la pendiente,
// grano fibroso mas grueso para la paja. Se distingue por el color de vertice
// ya existente (la proporcion es invariante al *= de brillo que aplican
// gableRoof/slateRoof, asi que sirve de "textura" barata sin atributo nuevo).
function roofMaterial(uClima) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uClima = uClima;
    shader.fragmentShader = 'uniform vec2 uClima;\n' + shader.fragmentShader;
    shader.vertexShader = 'varying vec3 vRPos;\nvarying vec3 vRNorm;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vRPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vRNorm = normalize(mat3(modelMatrix) * normal);
    `);
    shader.fragmentShader = `varying vec3 vRPos;\nvarying vec3 vRNorm;\n${NOISE_GLSL}`
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      float pitch = 1.0 - abs(vRNorm.y);      // 0 = plano (enlosado de patio), 1 = muy inclinado
      if (pitch > 0.12) {
        // La proporcion G/R y B/R del color de vertice no cambia aunque se
        // escale por brillo: sirve para distinguir paja/teja/pizarra sin
        // atributo nuevo. Pizarra y enlosado van juntos por su B/R alto.
        float ratioGR = vColor.g / max(vColor.r, 1e-4);
        float ratioBR = vColor.b / max(vColor.r, 1e-4);
        float esPizarra = step(0.6, ratioBR);
        float esPaja = step(0.65, ratioGR) * (1.0 - esPizarra);
        vec2 slopeDir = normalize(vec2(vRNorm.x, vRNorm.z) + vec2(1e-4));
        float along = dot(vRPos.xz, slopeDir) + vRPos.y;
        if (esPaja > 0.5) {
          // grano fibroso, grueso: paja atada en manojos, no en hiladas rectas
          float across = dot(vRPos.xz, vec2(-slopeDir.y, slopeDir.x));
          float grain = hashN(floor(vec2(along * 0.6, across * 1.3)));
          diffuseColor.rgb *= 0.86 + 0.28 * grain;
        } else {
          // hiladas de teja/pizarra corridas a lo largo de la pendiente
          float hilada = fract(along * 1.6);
          float curso = 1.0 - smoothstep(0.08, 0.20, min(hilada, 1.0 - hilada));
          diffuseColor.rgb *= 1.0 - curso * 0.14;
        }
      }
    `);
    // Igual que en el terreno: la nieve va DESPUES de <color_fragment>, o el
    // color de vertice del tejado la borra justo despues de pintarla.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Aqui no hay termino de cota: si nieva en el pueblo, nieva en todos los
      // tejados del pueblo. Lo que manda es la pendiente, que de un faldon muy
      // inclinado se cae, y la orientacion: la cara que mira al sur se deshiela
      // antes y por eso aguanta menos.
      float pitchN = 1.0 - abs(vRNorm.y);
      float cuajaN = smoothstep(0.75, 0.30, pitchN) * smoothstep(0.45, 0.85, uClima.y);
      cuajaN *= 0.75 + 0.25 * smoothstep(0.2, -0.6, vRNorm.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.60, 0.63, 0.69), cuajaN);
    `);
  };
  return mat;
}

// Llama de antorcha. Sin luz, color plano por encima de 1.0 para que el bloom lo
// convierta en resplandor: es el `unshaded` de flame.gdshader. La fase sale de
// un atributo por instancia, asi que las miles de antorchas no titilan a la vez.
function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { energy: { value: 3.0 }, time: { value: 0 } },
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aphase;
      varying float vPhase;
      varying float vUp;
      #include <common>
      void main() {
        vPhase = aphase;
        vUp = position.y;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float energy;
      uniform float time;
      varying float vPhase;
      varying float vUp;
      const vec3 fire = vec3(1.0, 0.52, 0.16);
      const vec3 core = vec3(1.0, 0.86, 0.55);
      void main() {
        // Dos senos de periodo distinto: no se repite de forma reconocible.
        float f = 0.70 + 0.30 * sin(time * 7.9 + vPhase * 41.0)
                * sin(time * 3.3 + vPhase * 17.0);
        vec3 col = mix(fire, core, clamp(vUp * 4.0 + 0.5, 0.0, 1.0));
        gl_FragColor = vec4(col * energy * f, 1.0);
      }
    `,
  });
}

// --- el mundo ----------------------------------------------------------------

export class World extends THREE.Group {
  static async load() {
    const data = await fetch(DATA + 'world.json').then((r) => r.json());
    const [dem, sier] = await Promise.all([
      fetch(DATA + 'terrain.bin').then((r) => r.arrayBuffer()),
      // La sierra es opcional a proposito: sin ella el pueblo sigue siendo el
      // pueblo, solo que rodeado de nada. Un fichero de 1 MB que no cargue no
      // puede dejar el juego en negro.
      data.sierra
        ? fetch(DATA + data.sierra.file).then((r) => r.arrayBuffer()).catch(() => null)
        : null,
    ]);
    return new World(data, new Float32Array(dem), sier && new Float32Array(sier));
  }

  constructor(data, heights, sierra) {
    super();
    const t0 = performance.now();
    this.data = data;
    this.heights = heights;
    this.demW = data.dem.w;
    this.demH = data.dem.h;
    this.resM = data.size_m[0] / this.demW;
    // El relieve de alrededor: 14 x 12 km a 25 m, solo cota. Es lo que pone
    // Abantos donde se ve desde media sierra y lo que hace que el pueblo deje de
    // acabarse en una mesa lisa a 3,6 km.
    this.sierra = sierra && data.sierra
      && sierra.length === data.sierra.w * data.sierra.h ? sierra : null;
    this.sInfo = this.sierra ? data.sierra : null;
    if (heights.length !== this.demW * this.demH) {
      throw new Error('el heightmap no cuadra con dem.w/h');
    }

    this.night = 1.0;
    // El portador del clima: (seco, nieve). `seco` es cuanto ha amarilleado el
    // pasto y `nieve` cuanta hay cuajada. Un solo objeto uniform compartido por
    // el terreno, los tejados y las copas, igual que `userData.glow` reparte la
    // luz de las ventanas: escribir aqui llega a los tres materiales sin tener
    // que rehornear los 400.000 vertices de color del terreno ni las geometrias
    // de arbol, que llevan el color cocido dentro.
    this.uClima = { value: new THREE.Vector2(0, 0) };
    this.lampPos = [];
    this.antorchaCerca = null;
    this.pool = [];
    this.nextPoolUpdate = 0;
    this.chimeneas = [];       // remates de chimenea, los llena gableRoof() al vuelo

    // Rejillas de ocupacion: donde hay casas y donde calles.
    this.occB = new Set();
    this.occR = new Set();

    this.add(this.terrainNode());
    if (this.sierra) this.add(this.sierraNode());
    // Antes de levantar los muros: buildingNodes() necesita saber por donde
    // pasa una calle para abrirle el soportal en vez de tapiarlo.
    this.buildFachadas();
    this.buildPasos();
    this.add(...this.buildingNodes());
    this.add(this.roadsNode());
    this.addTorches();

    this.buildOccupancy();
    this.add(this.propsNode());
    this.addTrees();

    this.humo = new Humo(this.chimeneas);
    this.add(this.humo.objeto);

    this.precip = new Precipitacion();
    this.add(this.precip);

    // Solo las mallas. Si esto tocase tambien a las luces del pool, cada
    // antorcha pediria su mapa de sombra cubico y el shader se pasa de
    // samplers: MAX_TEXTURE_IMAGE_UNITS(16) y no compila nada.
    for (const o of this.children) {
      if (o.isMesh && !o.userData.sinSombra) { o.castShadow = true; o.receiveShadow = true; }
    }
    this.flames.castShadow = false;   // el shader de la llama no escribe profundidad util
    this.humo.objeto.castShadow = false;
    this.humo.objeto.receiveShadow = false;   // humo transparente: recibir sombra solo da artefactos

    console.log(`mundo listo: ${data.buildings.length} casas | ${data.roads.length} tramos`
      + ` | ${this.lampPos.length} antorchas | malla ${Math.round(performance.now() - t0)} ms`);
  }

  // Los pasos bajo edificio y los tuneles, en segmentos sueltos y listos para
  // preguntarles si un punto cae dentro.
  //
  // Sin esto, recuperarlos en los datos no habria servido de nada: la via
  // volveria al mapa y al grafo de los vecinos, pero el jugador seguiria dandose
  // contra el edificio de encima, que es solido de arriba abajo. Hay que
  // vaciarle el hueco por donde de verdad se pasa.
  // Todo tramo de calle que discurra POR DENTRO de una huella es un paso.
  //
  // Empezo siendo solo lo que OSM etiqueta -tunnel, covered, bridge- y no
  // bastaba, porque una calle en OSM viene partida en varias vias y la etiqueta
  // la lleva UNA. La calle Capilla son tres tramos y solo el de en medio dice
  // `covered=yes`; la Grimaldi igual; la avenida de Juan de Borbon son seis y
  // solo uno dice `building_passage`. Se abria el metro y medio etiquetado y
  // seguia tapiado lo de antes y lo de despues, que es el mismo soportal bajo el
  // mismo edificio.
  //
  // Asi que la regla es geometrica y no de etiqueta: si el eje de una calle
  // cartografiada cae dentro de una huella, por ahi se pasa. A esta escala nadie
  // dibuja una calle atravesando un edificio macizo por descuido; o hay soportal
  // o la huella esta dibujada por encima de la calle, y en los dos casos la
  // calle es de verdad y el muro no.
  //
  // Lo unico que abre de mas es el vial de servicio que entra en una nave, y
  // colarse en un almacen es mucho menos grave que una calle del centro que
  // muere contra una pared.
  buildPasosPorDentro() {
    let tramos = 0;
    for (const r of this.data.roads) {
      // `c` = cerrada a mano en prep.py. Es un vial de servicio que muere dentro
      // de una nave: la regla lo abriria y no debe, que un almacen no es calle.
      if (r.c) continue;
      const f = r.p;
      const semi = Math.max(2.0, r.w * 0.5 + 0.6);
      for (let i = 2; i < f.length; i += 2) {
        const x1 = f[i - 2], z1 = f[i - 1], x2 = f[i], z2 = f[i + 1];
        const L = Math.hypot(x2 - x1, z2 - z1);
        if (L < 0.01) continue;
        // Se sondea cada dos metros y se guarda el trozo continuo que este
        // dentro, no el segmento entero: una calle que solo roza una esquina no
        // tiene por que abrirse de punta a punta.
        const n = Math.max(1, Math.round(L / 2));
        let ini = -1;
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const dentro = this.dentroDeFachada(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t);
          if (dentro && ini < 0) ini = k;
          if ((!dentro || k === n) && ini >= 0) {
            const t0 = ini / n, t1 = (dentro ? k : k - 1) / n;
            this.pasos.push({
              x1: x1 + (x2 - x1) * t0, z1: z1 + (z2 - z1) * t0,
              x2: x1 + (x2 - x1) * t1, z2: z1 + (z2 - z1) * t1, semi,
            });
            tramos++;
            ini = -1;
          }
        }
      }
    }
    return tramos;
  }

  // Si el punto cae DENTRO de alguna huella (sin margen). No usa chocaEdificio
  // porque esa consulta ya descuenta los pasos, y aqui se esta construyendo la
  // lista de pasos: se morderia la cola.
  dentroDeFachada(x, z) {
    for (const poly of this.fachadasCerca(x, z)) {
      if (poly.pasa) continue;
      if (!dentroDe(poly, x, z)) continue;
      const q = poly.patios;
      let enPatio = false;
      if (q) for (const h of q) if (dentroDe(h, x, z)) enPatio = true;
      if (!enPatio) return true;
    }
    return false;
  }

  buildPasos() {
    this.pasos = [];
    for (const r of this.data.roads) {
      if (!r.t) continue;
      // Un poco mas ancho que la via: el soportal real tiene mas luz que la
      // linea que lo representa, y quedarse corto es volver a atascarlo.
      const semi = Math.max(2.0, r.w * 0.5 + 0.6);
      for (let i = 2; i < r.p.length; i += 2) {
        this.pasos.push({
          x1: r.p[i - 2], z1: r.p[i - 1], x2: r.p[i], z2: r.p[i + 1], semi,
        });
      }
    }
    const etiquetados = this.pasos.length;
    const geometricos = this.buildPasosPorDentro();
    console.log(`pasos: ${etiquetados} por etiqueta de OSM`
      + ` + ${geometricos} por geometria (calle dentro de huella)`);
  }

  // Indice de fachadas para chocar contra ellas. Vivia en player.js, que se
  // construia su propia rejilla de poligonos; se sube aqui porque ahora hay dos
  // clientes -la colision del jugador y la costura del grafo de calles- y tener
  // dos copias del mismo indice es como se acaba con dos que no dicen lo mismo.
  buildFachadas() {
    this.fachadas = new Map();
    for (const b of this.data.buildings) {
      const flat = b.p;
      const n = flat.length / 2;
      if (n < 3) continue;
      const poly = [];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        poly.push(flat[i * 2], flat[i * 2 + 1]);
        x0 = Math.min(x0, flat[i * 2]); x1 = Math.max(x1, flat[i * 2]);
        z0 = Math.min(z0, flat[i * 2 + 1]); z1 = Math.max(z1, flat[i * 2 + 1]);
      }
      // Todas entran en el indice, tambien las que no frenan: la prueba de
      // cubiertas colgadas de ?test lo usa para saber si un triangulo de tejado
      // esta sobre su huella, y sacar de aqui a las 37 marquesinas dejaba sus
      // propios tejados volando sobre nada. `pasa` marca la exencion, y la mira
      // solo la colision.
      poly.pasa = !!b.x;
      poly.patios = b.q || null;
      for (let cy = (z0 / OCC_CELL) | 0; cy <= (z1 / OCC_CELL | 0); cy++) {
        for (let cx = (x0 / OCC_CELL) | 0; cx <= (x1 / OCC_CELL | 0); cx++) {
          const k = cx * 100000 + cy;
          let l = this.fachadas.get(k);
          if (!l) this.fachadas.set(k, l = []);
          l.push(poly);
        }
      }
    }
  }

  // Las huellas candidatas alrededor de (x,z): las de su celda y las ocho
  // vecinas. La usan la colision y la prueba de cubiertas colgadas de ?test.
  fachadasCerca(x, z) {
    const cx = (x / OCC_CELL) | 0, cy = (z / OCC_CELL) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const l = this.fachadas.get((cx + dx) * 100000 + (cy + dy));
        if (l) out.push(...l);
      }
    }
    return out;
  }

  // Si una capsula de radio `r` en (x,z) toca una fachada. Un paso bajo edificio
  // no cuenta: por ahi se pasa aunque haya casa encima.
  chocaEdificio(x, z, r) {
    for (const poly of this.fachadasCerca(x, z)) {
      // Lo que OSM marca por encima de la calle o sin arrancar del suelo se
      // dibuja pero no frena: marquesinas, techos sobre pies y pasarelas. Una
      // de ellas cortaba 56 m de la calle Floridablanca.
      if (poly.pasa) continue;
      if (tocaPoligono(poly, x, z, r)) return !this.enPaso(x, z);
    }
    return false;
  }

  // Si entre dos puntos hay edificio de por medio. Se muestrea la recta contra
  // las fachadas de verdad y NO contra la rejilla de ocupacion: esa marca la
  // celda entera de 10 m, y como las calles van pegadas a las casas daba por
  // tapadas 2793 de las 7465 aristas de calle que ya existian. O sea que no
  // servia para nada.
  hayEdificioEntre(x1, z1, x2, z2) {
    const d = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.ceil(d / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.chocaEdificio(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, 0.6)) return true;
    }
    return false;
  }

  // Si (x,z) cae dentro de un paso. Son dos docenas de segmentos y ademas solo
  // se pregunta cuando ya se ha chocado con algo, asi que un barrido lineal
  // sobra: no hace falta rejilla para esto.
  enPaso(x, z) {
    for (const p of this.pasos) {
      const dx = p.x2 - p.x1, dz = p.z2 - p.z1;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - p.x1) * dx + (z - p.z1) * dz) / len2 : 0;
      t = Math.min(1, Math.max(0, t));
      const ex = x - (p.x1 + dx * t), ez = z - (p.z1 + dz * t);
      if (ex * ex + ez * ez <= p.semi * p.semi) return true;
    }
    return false;
  }

  // Enciende o apaga hogares y antorchas. 0 = pleno dia, 1 = noche cerrada.
  setNight(f) {
    this.night = Math.min(Math.max(f, 0), 1);
    this.wallMat.userData.glow.value = 2.6 * this.night;
    this.flameMat.uniforms.energy.value = 3.0 * this.night;
  }

  // El tiempo que hace, repartido a quien lo pinta. Lo llama daynight.js desde
  // apply(), que es quien lo sabe. Escribir el uniform llega de una vez al
  // terreno, a los tejados y a las copas.
  setClima(c) {
    this.clima = c;
    this.uClima.value.set(c.seco, c.cubierta);
    this.precip.cantidad = c.lluvia;
    this.precip.nieve = c.nieve;
    // Las chimeneas tiran de noche... y cuando hace frio. En enero se enciende a
    // mediodia, que es medio pueblo humeando a la hora de comer. Antes esto solo
    // miraba la noche y el pueblo de invierno estaba tan apagado como el de julio.
    this.humoFrio = c.frio;
  }

  update(dt, t, camPos) {
    this.flameMat.uniforms.time.value = t;
    // Lo que enciende la lumbre es la noche O el frio, lo que mande de los dos.
    this.humo.update(dt, t, camPos, Math.max(this.night, (this.humoFrio || 0) * 0.85));
    this.precip.update(t, camPos);

    // El fuego no es una bombilla: cada antorcha late con su propia fase.
    for (let k = 0; k < this.pool.length; k++) {
      const l = this.pool[k];
      if (l.userData.on) {
        const f = 0.74 + 0.26 * Math.sin(t * 7.7 + k * 2.31) * Math.sin(t * 3.1 + k * 1.07);
        l.intensity = TORCH_INTENSITY * this.night * f;
      }
    }

    this.nextPoolUpdate -= dt;
    if (this.nextPoolUpdate > 0 && this.pool[0].userData.placed) return;
    this.nextPoolUpdate = 0.2;
    this.pool[0].userData.placed = true;

    // Las 40 luces reales se reasignan a las antorchas mas cercanas. Nunca se
    // quitan de la escena: en three eso recompilaria todos los shaders.
    const cerca = [];
    for (let i = 0; i < this.lampPos.length; i++) {
      const p = this.lampPos[i];
      const d = (p[0] - camPos.x) ** 2 + (p[1] - camPos.y) ** 2 + (p[2] - camPos.z) ** 2;
      if (d < LIGHT_RADIUS * LIGHT_RADIUS) cerca.push([d, i]);
    }
    cerca.sort((a, b) => a[0] - b[0]);
    // La mas cercana, para el chisporroteo. Un solo panner, no cuarenta: se oye a
    // ocho metros, asi que treinta y nueve estarian siempre por debajo del umbral.
    this.antorchaCerca = cerca.length ? this.lampPos[cerca[0][1]] : null;

    for (let k = 0; k < this.pool.length; k++) {
      const l = this.pool[k];
      if (k < cerca.length && this.night > 0.01) {
        const p = this.lampPos[cerca[k][1]];
        l.position.set(p[0], p[1], p[2]);
        l.userData.on = true;
        // Se enciende aqui mismo: si se dejase al parpadeo del fotograma
        // siguiente, cada reasignacion daria un fotograma a oscuras.
        l.intensity = TORCH_INTENSITY * this.night;
      } else {
        l.userData.on = false;
        l.intensity = 0;
      }
    }
  }

  // Altitud en cualquier punto (x, z) del mundo.
  //
  // Interpola sobre el mismo par de triangulos con el que se dibuja el terreno,
  // no de forma bilineal: asi las calles y las farolas se posan exactamente en
  // la superficie visible. Con una bilineal el error llega a medio metro en
  // cuesta y las calles se entierran.
  // Cuanto se mete un punto dentro del recorte del casco. Negativo fuera.
  dentroDelCasco(x, z) {
    const [sx, sz] = this.data.size_m;
    return Math.min(x, sx - x, z, sz - z);
  }

  // La cota de la sierra, bilineal. Fuera de sus 14 x 12 km se repite el borde,
  // que es lo mismo que hace el heightmap fino y evita un acantilado al infinito.
  alturaSierra(x, z) {
    const s = this.sInfo;
    const fx = Math.min(Math.max((x - s.x0) / s.res - 0.5, 0), s.w - 1.001);
    const fz = Math.min(Math.max((z - s.z0) / s.res - 0.5, 0), s.h - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const a = this.sierra[j * s.w + i], b = this.sierra[j * s.w + i + 1];
    const c = this.sierra[(j + 1) * s.w + i], d = this.sierra[(j + 1) * s.w + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  heightAt(x, z) {
    // Fuera del casco manda la sierra, y en los 60 m de dentro del borde se
    // funden las dos. Sin la banda hay un escalon de un par de metros justo en
    // el limite -mismo terreno, muestreado a 5 m y a 25- y eso, andando, es un
    // bordillo invisible por el que se tropieza.
    if (this.sierra) {
      const d = this.dentroDelCasco(x, z);
      if (d < 60) {
        const gruesa = this.alturaSierra(x, z);
        if (d <= 0) return gruesa;
        const t = d / 60, f = t * t * (3 - 2 * t);
        return gruesa + (this.finaAt(x, z) - gruesa) * f;
      }
    }
    return this.finaAt(x, z);
  }

  finaAt(x, z) {
    const { heights, demW, demH, resM } = this;
    const fx = Math.min(Math.max(x / resM - 0.5, 0), demW - 1.001);
    const fz = Math.min(Math.max(z / resM - 0.5, 0), demH - 1.001);
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const h00 = heights[j * demW + i];
    const h10 = heights[j * demW + i + 1];
    const h01 = heights[(j + 1) * demW + i];
    const h11 = heights[(j + 1) * demW + i + 1];
    // La diagonal del quad va de (i+1,j) a (i,j+1), o sea tx + tz = 1.
    if (tx + tz <= 1) return h00 + tx * (h10 - h00) + tz * (h01 - h00);
    return h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  }

  // Normal del terreno, para que las calles en cuesta se iluminen como la ladera.
  normalAt(x, z) {
    const d = this.resM;
    const v = [this.heightAt(x - d, z) - this.heightAt(x + d, z), 2 * d,
      this.heightAt(x, z - d) - this.heightAt(x, z + d)];
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  terrainNode() {
    const { demW, demH, resM, heights } = this;
    const n = demW * demH;
    const verts = new Float32Array(n * 3);
    const norms = new Float32Array(n * 3);
    const cols = new Float32Array(n * 3);

    for (let j = 0; j < demH; j++) {
      for (let i = 0; i < demW; i++) {
        const k = j * demW + i;
        // +0.5: las muestras del DEM van en el centro del pixel, no en la esquina
        verts[k * 3] = (i + 0.5) * resM;
        verts[k * 3 + 1] = heights[k];
        verts[k * 3 + 2] = (j + 0.5) * resM;

        const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, demW - 1);
        const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, demH - 1);
        const dhdx = (heights[j * demW + i1] - heights[j * demW + i0]) / ((i1 - i0) * resM);
        const dhdz = (heights[j1 * demW + i] - heights[j0 * demW + i]) / ((j1 - j0) * resM);
        const len = Math.hypot(dhdx, 1, dhdz);
        const ny = 1 / len;
        norms[k * 3] = -dhdx / len;
        norms[k * 3 + 1] = ny;
        norms[k * 3 + 2] = -dhdz / len;

        // El color va por pendiente: lo llano se lee como tierra, la ladera
        // como roca. Sustituye a la ortofoto, que ya no pega con el estilo.
        const c = lerp3(GROUND_FLAT, GROUND_STEEP, smoothstep(0.12, 0.55, 1 - ny));
        // Moteado determinista: sin el, lo llano se lee como una sabana lisa.
        const r = 0.88 + 0.24 * hash(i, j);
        cols[k * 3] = c[0] * r;
        cols[k * 3 + 1] = c[1] * r;
        cols[k * 3 + 2] = c[2] * r;
      }
    }

    const idx = new Uint32Array((demW - 1) * (demH - 1) * 6);
    let k = 0;
    for (let j = 0; j < demH - 1; j++) {
      for (let i = 0; i < demW - 1; i++) {
        const a = j * demW + i;
        idx[k] = a; idx[k + 1] = a + demW; idx[k + 2] = a + 1;
        idx[k + 3] = a + 1; idx[k + 4] = a + demW; idx[k + 5] = a + demW + 1;
        k += 6;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));

    const mesh = new THREE.Mesh(g, terrainMaterial(1.0, this.uClima));
    mesh.name = 'Terreno';
    return mesh;
  }

  // La sierra de alrededor: 564 x 484 muestras a 25 m, con el casco recortado.
  //
  // El recorte del hueco cuadra SIN resto porque los cuatro bordes del Ring A
  // caen justo encima de una linea de la rejilla de 25 m (eso lo comprueba
  // prep.py con un assert). Si no cuadrase, quedaria un diente de sierra de
  // hasta 25 m por el que se veria el cielo desde dentro del pueblo.
  //
  // Los vertices que caen DENTRO del casco no se tiran: se bajan un par de
  // metros y se les da la cota fina. Eso hace dos cosas de una: el anillo de
  // cuadros que cruza el borde queda escondido debajo del terreno bueno en vez
  // de pelearse con el por el z-buffer, y de paso tapa la franja de 2,5 m que el
  // terreno fino nunca llego a cubrir -sus muestras van al centro del pixel, o
  // sea que empieza en 2,5 y no en 0- y por la que hasta ahora se veia el vacio.
  sierraNode() {
    const s = this.sInfo, H = this.sierra;
    const n = s.w * s.h;
    const verts = new Float32Array(n * 3);
    const norms = new Float32Array(n * 3);
    const cols = new Float32Array(n * 3);
    const OCULTO = 30;              // m dentro del casco a partir de los cuales no se dibuja

    for (let j = 0; j < s.h; j++) {
      for (let i = 0; i < s.w; i++) {
        const k = j * s.w + i;
        const x = s.x0 + (i + 0.5) * s.res;
        const z = s.z0 + (j + 0.5) * s.res;
        const dentro = this.dentroDelCasco(x, z);
        let y = H[k];
        if (dentro > 0) {
          // Cota fina menos un hundimiento que crece deprisa: a 3 m del borde ya
          // esta 2,4 m por debajo, o sea fuera de la vista y sin z-fighting.
          y = this.finaAt(x, z) - Math.min(dentro, 3) * 0.8;
        }
        verts[k * 3] = x; verts[k * 3 + 1] = y; verts[k * 3 + 2] = z;

        const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, s.w - 1);
        const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, s.h - 1);
        const dhdx = (H[j * s.w + i1] - H[j * s.w + i0]) / ((i1 - i0) * s.res);
        const dhdz = (H[j1 * s.w + i] - H[j0 * s.w + i]) / ((j1 - j0) * s.res);
        const len = Math.hypot(dhdx, 1, dhdz);
        const ny = 1 / len;
        norms[k * 3] = -dhdx / len; norms[k * 3 + 1] = ny; norms[k * 3 + 2] = -dhdz / len;

        // Mismo criterio que el terreno fino: lo llano se lee como tierra y la
        // ladera como roca. A 25 m por muestra una ladera de sierra sale mas
        // tendida de lo que es, asi que la pendiente se lee antes.
        const c = lerp3(GROUND_FLAT, GROUND_STEEP, smoothstep(0.06, 0.34, 1 - ny));
        const r = 0.88 + 0.24 * hash(i, j);
        cols[k * 3] = c[0] * r; cols[k * 3 + 1] = c[1] * r; cols[k * 3 + 2] = c[2] * r;
      }
    }

    const idx = [];
    for (let j = 0; j < s.h - 1; j++) {
      for (let i = 0; i < s.w - 1; i++) {
        const x = s.x0 + (i + 1) * s.res, z = s.z0 + (j + 1) * s.res;
        // El cuadro entero bien metido en el casco: no se dibuja.
        if (this.dentroDelCasco(x, z) > OCULTO + s.res) continue;
        const a = j * s.w + i;
        idx.push(a, a + s.w, a + 1, a + 1, a + s.w, a + s.w + 1);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();

    const mesh = new THREE.Mesh(g, terrainMaterial(1.0, this.uClima));
    mesh.name = 'Sierra';
    // Ni proyecta ni recibe sombra. La caja de sombra sigue al jugador con 200 m
    // de semilado: meter 14 km dentro no anade una sola sombra util y en cambio
    // obliga a recorrer medio millon de triangulos por fotograma para el mapa.
    mesh.userData.sinSombra = true;
    console.log(`sierra: ${s.w}x${s.h} a ${s.res} m | ${idx.length / 3} triangulos`
      + ` | cota ${s.min.toFixed(0)}-${s.max.toFixed(0)} m`);
    return mesh;
  }

  buildingNodes() {
    const wall = { v: [], n: [], uv: [] };
    // Donde una calle cruza la fachada, el muro arranca a la altura del dintel.
    const abrirPaso = (x, z) => (this.enPaso(x, z)
      ? this.heightAt(x, z) + ALTO_PASO : null);
    const roof = new Soup();
    const monIdx = this.biggestFootprint();

    this.data.buildings.forEach((b, k) => {
      const flat = b.p;
      const n = flat.length / 2;
      if (n < 3) return;

      let poly = [];
      for (let i = 0; i < n; i++) poly.push([flat[i * 2], flat[i * 2 + 1]]);

      // OSM no garantiza el sentido de giro: se normaliza por area con signo.
      let area2 = 0;
      for (let i = 0; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        area2 += p[0] * q[1] - q[0] * p[1];
      }
      if (area2 > 0) poly.reverse();

      // OSM repite vertices. Una arista de longitud cero no tiene normal, y eso
      // deja sin bisectriz al anillo metido de la cubierta.
      for (let i = poly.length - 1; i >= 0 && poly.length > 3; i--) {
        const q = poly[(i + 1) % poly.length];
        if (Math.hypot(poly[i][0] - q[0], poly[i][1] - q[1]) < 1e-6) poly.splice(i, 1);
      }

      // Semilla estable por casa: decide material, huecos y tipo de cubierta.
      let seed = fract(Math.sin(flat[0] * 0.7321 + flat[1] * 1.3177) * 43758.5453);
      // Una nave de 600 m2 no se levanta con entramado de madera.
      if (Math.abs(area2) * 0.5 > 600) seed *= 0.28;

      const base = b.b;
      const suelo = base + (b.t - base - b.h);
      const plantas = Math.min(Math.max(Math.round(b.h / STOREY_DIV), 1), MAX_STOREYS);
      const top = suelo + plantas * STOREY_H + seed * 0.45;

      if (k === monIdx) {
        this.monastery(poly, base, suelo, wall, roof, abrirPaso);
        return;
      }
      extrudeRing(poly, base, top, [seed, suelo, 0], wall, abrirPaso);

      // Con patio, la cubierta va en anillo y el patio se queda abierto. 97
      // casas del pueblo lo tienen y hasta ahora se rellenaban macizas, que es
      // lo que tapiaba las sendas que cruzan la Casa de la Compaña.
      const huecos = (b.q || []).map(aPuntos).filter((h) => h.length >= 3);
      if (huecos.length) {
        for (const h of huecos) {
          // Los muros del patio miran hacia DENTRO del patio, o sea al reves
          // que la fachada: se extruye el anillo al reves.
          extrudeRing([...h].reverse(), base, top, [seed, suelo, 0], wall, abrirPaso);
        }
        const col = mul(seed < 0.45 ? ROOF_THATCH : ROOF_TILE,
          0.82 + 0.36 * fract(seed * 7.13));
        if (patioRoof(poly, huecos, top, 1.4 + seed * 1.2, col, roof)) {
          addDoor(poly, suelo, seed, wall);
          return;
        }
        // Si el anillo no se deja meter hacia dentro -planta muy estrecha o
        // vertices repetidos-, se cae a la cubierta de siempre: mejor un patio
        // tapado que una casa sin tejado.
      }
      gableRoof(poly, top, seed, roof, this.chimeneas);
      addDoor(poly, suelo, seed, wall);
    });

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wall.v, 3));
    wg.setAttribute('normal', new THREE.Float32BufferAttribute(wall.n, 3));
    wg.setAttribute('ainfo', new THREE.Float32BufferAttribute(wall.uv, 3));
    this.wallMat = wallMaterial();
    const walls = new THREE.Mesh(wg, this.wallMat);
    walls.name = 'Muros';

    const roofs = new THREE.Mesh(roof.geometry(), roofMaterial(this.uClima));
    roofs.name = 'Cubiertas';
    return [walls, roofs];
  }

  // Puntos del eje a intervalos regulares de arco. Con `keepCorners` se anaden
  // ademas los vertices originales, que es lo que evita que una curva se corte.
  walk(flat, step, keepCorners) {
    const out = [];
    const n = flat.length / 2;
    if (n < 2) return out;
    let carry = keepCorners ? 0 : step * 0.5;
    let prev = [flat[0], flat[1]];
    if (keepCorners) out.push(prev);
    for (let i = 1; i < n; i++) {
      const cur = [flat[i * 2], flat[i * 2 + 1]];
      const seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      if (seg < 0.01) continue;
      const dir = [(cur[0] - prev[0]) / seg, (cur[1] - prev[1]) / seg];
      let t = carry < step ? step - carry : 0;
      while (t <= seg) {
        out.push([prev[0] + dir[0] * t, prev[1] + dir[1] * t]);
        t += step;
      }
      carry = fract((carry + seg) / step) * step;
      if (keepCorners) out.push(cur);
      prev = cur;
    }
    return out;
  }

  roadsNode() {
    const v = [], nn = [], cc = [];
    for (const r of this.data.roads) {
      const pts = this.walk(r.p, 3.0, true);
      if (pts.length < 2) continue;
      const half = Math.min(r.w, ROAD_MAX_W) * 0.5;
      // Cada clase de via se levanta un poco mas: en los cruces se solapan y
      // sin este escalon pelean por el mismo pixel.
      const lift = 0.06 + r.z * 0.012;

      const izq = [], der = [];
      for (let i = 0; i < pts.length; i++) {
        let dir;
        if (i === 0) dir = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
        else if (i === pts.length - 1) dir = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
        else dir = [pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]];
        let dl = Math.hypot(dir[0], dir[1]);
        if (dl < 1e-4) { dir = [1, 0]; dl = 1; }
        const off = [-dir[1] / dl * half, dir[0] / dl * half];
        const a = [pts[i][0] + off[0], pts[i][1] + off[1]];
        const b = [pts[i][0] - off[0], pts[i][1] - off[1]];
        izq.push([a[0], this.heightAt(a[0], a[1]) + lift, a[1]]);
        der.push([b[0], this.heightAt(b[0], b[1]) + lift, b[1]]);
      }

      for (let i = 0; i < pts.length - 1; i++) {
        // Godot: [izq0, der0, izq1, der0, der1, izq1]. Invertido para antihorario.
        for (const p of [izq[i], izq[i + 1], der[i], der[i], izq[i + 1], der[i + 1]]) {
          v.push(p[0], p[1], p[2]);
          const nr = this.normalAt(p[0], p[2]);
          nn.push(nr[0], nr[1], nr[2]);
          const m = 0.84 + 0.32 * fract(Math.sin(p[0] * 3.71 + p[2] * 8.13) * 43758.5453);
          cc.push(ROAD_MUD[0] * m, ROAD_MUD[1] * m, ROAD_MUD[2] * m);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    // Las calles comparten el material del terreno. Sin esto la tierra pisada
    // -que es justo lo que se tiene delante todo el rato- era la unica
    // superficie del pueblo sin grano, una lamina marron lisa entre fachadas
    // con textura y monte con textura.
    const mesh = new THREE.Mesh(g, terrainMaterial(0.55, this.uClima));
    mesh.name = 'Calles';
    return mesh;
  }

  // Antorchas de poste a lo largo de las vias transitadas. Sustituyen al
  // alumbrado publico: mas bajas, mas juntas al muro y de luz corta.
  addTorches() {
    const postes = [];
    for (const r of this.data.roads) {
      if (!r.l) continue;
      const pts = this.walk(r.p, TORCH_SPACING, false);
      let lado = 1;
      for (let i = 0; i < pts.length; i++) {
        const ref = i > 0 ? pts[i - 1] : (pts.length > 1 ? pts[1] : pts[0]);
        let dir = [pts[i][0] - ref[0], pts[i][1] - ref[1]];
        let dl = Math.hypot(dir[0], dir[1]);
        if (dl < 1e-4) { dir = [1, 0]; dl = 1; }
        const ancho = Math.min(r.w, ROAD_MAX_W);
        const k = (ancho * 0.5 + 0.5) * lado / dl;
        const p = [pts[i][0] - dir[1] * k, pts[i][1] + dir[0] * k];
        postes.push([p[0], this.heightAt(p[0], p[1]), p[1]]);
        lado = -lado;                          // alternar lado de la calle
      }
    }

    const posteMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.052, 0.040, 0.028) });
    this.flameMat = flameMaterial();

    const postes_m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.11, TORCH_HEIGHT, 0.11), posteMat, postes.length);
    const llamas_m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.17, 0.26, 0.17), this.flameMat, postes.length);
    const m = new THREE.Matrix4();
    const phase = new Float32Array(postes.length);
    for (let i = 0; i < postes.length; i++) {
      const p = postes[i];
      m.makeTranslation(p[0], p[1] + TORCH_HEIGHT * 0.5, p[2]);
      postes_m.setMatrixAt(i, m);
      m.makeTranslation(p[0], p[1] + TORCH_HEIGHT + 0.16, p[2]);
      llamas_m.setMatrixAt(i, m);
      phase[i] = fract(Math.sin(i * 12.9898) * 43758.5453);
      this.lampPos.push([p[0], p[1] + TORCH_HEIGHT + 0.1, p[2]]);
    }
    llamas_m.geometry.setAttribute('aphase', new THREE.InstancedBufferAttribute(phase, 1));
    postes_m.name = 'Postes';
    llamas_m.name = 'Llamas';
    llamas_m.frustumCulled = false;
    this.flames = llamas_m;
    this.add(postes_m, llamas_m);

    // Las luces reales no se crean por antorcha: se reciclan desde el pool.
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.58, 0.24), 0,
        TORCH_RANGE, TORCH_DECAY);
      l.userData.on = false;
      this.add(l);
      this.pool.push(l);
    }
  }

  // Marca en dos rejillas que celdas pisan casas y cuales calles. Es lo que
  // permite plantar un arbol o dejar un carro sin caer encima de nada.
  buildOccupancy() {
    const key = (cx, cy) => cx * 100000 + cy;
    for (const b of this.data.buildings) {
      const flat = b.p;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < flat.length; i += 2) {
        x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]);
        z0 = Math.min(z0, flat[i + 1]); z1 = Math.max(z1, flat[i + 1]);
      }
      for (let cy = (z0 / OCC_CELL) | 0; cy <= (z1 / OCC_CELL | 0); cy++) {
        for (let cx = (x0 / OCC_CELL) | 0; cx <= (x1 / OCC_CELL | 0); cx++) {
          this.occB.add(key(cx, cy));
        }
      }
    }
    for (const r of this.data.roads) {
      for (const p of this.walk(r.p, OCC_CELL * 0.8, true)) {
        this.occR.add(key((p[0] / OCC_CELL) | 0, (p[1] / OCC_CELL) | 0));
      }
    }
    this.buildUrbanidad();
  }

  // Cuanto pueblo hay alrededor, de 0 en la dehesa a 1 en Floridablanca. Lo usa
  // el sonido: en el campo manda el viento y en la calle el bullicio.
  //
  // Se precalcula entera al cargar y no se consulta al vuelo. Las dos decisiones
  // que la hacen servir:
  //
  //   - Casa 1,0 y calle 0,6. Una calle sin casas a los lados es menos pueblo que
  //     una con ellas, y el camino de la dehesa no puede sonar a plaza.
  //   - Desenfoque de caja de 5x5 celdas, separable: dos pasadas de 1D en vez de
  //     una de 25 muestras. Eso convierte la rejilla de "aqui hay una casa" en
  //     "cuanto pueblo hay en 50 m a la redonda", que es lo que se oye.
  buildUrbanidad() {
    const w = this.urbW = Math.ceil(this.data.size_m[0] / OCC_CELL);
    const h = this.urbH = Math.ceil(this.data.size_m[1] / OCC_CELL);
    let a = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = i * 100000 + j;
        a[j * w + i] = this.occB.has(k) ? 1.0 : (this.occR.has(k) ? 0.6 : 0);
      }
    }
    const R = 2;                                     // 5x5: 25 m de radio efectivo
    const paso = (src, dst, ancho, alto, horizontal) => {
      for (let j = 0; j < alto; j++) {
        for (let i = 0; i < ancho; i++) {
          let sum = 0;
          for (let d = -R; d <= R; d++) {
            // El borde repite la ultima celda en vez de contar cero: si no, el
            // pueblo se apaga solo al acercarse al limite del mapa.
            const q = Math.min(Math.max((horizontal ? i : j) + d, 0),
              (horizontal ? ancho : alto) - 1);
            sum += horizontal ? src[j * ancho + q] : src[q * ancho + i];
          }
          dst[j * ancho + i] = sum / (2 * R + 1);
        }
      }
    };
    const b = new Float32Array(w * h);
    paso(a, b, w, h, true);
    paso(b, a, w, h, false);
    this.urb = a;
  }

  urbanidad(x, z) {
    return muestrear(this.urb, this.urbW, this.urbH, OCC_CELL, x, z);
  }

  // Libre de casas Y de calles en la celda y las ocho vecinas.
  freeAround(x, z) {
    const cx = (x / OCC_CELL) | 0, cy = (z / OCC_CELL) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = (cx + dx) * 100000 + (cy + dy);
        if (this.occB.has(k) || this.occR.has(k)) return false;
      }
    }
    return true;
  }

  // Pozos, carros y lena: una sola malla estatica con color por vertice.
  propsNode() {
    const soup = new Soup();
    const rng = rngFrom(1387);              // mismo pueblo en cada arranque

    // --- pozos, en el borde de vias anchas alumbradas, lejos unos de otros
    const spots = [];
    const candidatos = [];
    for (const r of this.data.roads) {
      if (!r.l || r.w < 5.0) continue;
      const pts = this.walk(r.p, 40.0, false);
      for (let i = 0; i < pts.length; i++) {
        const ref = i > 0 ? pts[i - 1] : pts[i];
        let dir = [pts[i][0] - ref[0], pts[i][1] - ref[1]];
        let dl = Math.hypot(dir[0], dir[1]);
        if (dl < 1e-4) { dir = [1, 0]; dl = 1; }
        const k = (Math.min(r.w, ROAD_MAX_W) * 0.5 + 2.2) / dl;
        candidatos.push([pts[i][0] - dir[1] * k, pts[i][1] + dir[0] * k]);
      }
    }
    for (let i = candidatos.length - 1; i > 0; i--) {
      const j = rng.randi_range(0, i);
      [candidatos[i], candidatos[j]] = [candidatos[j], candidatos[i]];
    }

    let pozos = 0;
    for (const c of candidatos) {
      if (pozos >= WELL_COUNT) break;
      if (this.occB.has(((c[0] / OCC_CELL) | 0) * 100000 + ((c[1] / OCC_CELL) | 0))) continue;
      if (spots.some((s) => (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 < 150 * 150)) continue;
      spots.push(c);
      pozos++;
      const y = this.heightAt(c[0], c[1]);
      const yaw = rng.randf() * TAU;
      const b = yawBasis(yaw);
      for (let i = 0; i < 8; i++) {           // brocal: ocho sillares en anillo
        const a = yaw + TAU * i / 8;
        const p = [c[0] + Math.cos(a) * 1.05, c[1] + Math.sin(a) * 1.05];
        boxCol(soup, [p[0], y + 0.42, p[1]], [0.34, 0.42, 0.18], yawBasis(-a), STONE_GRAY);
      }
      // Cuatro postes, no dos: el tejadillo debe leerse apoyado y no flotando
      // sobre el brocal.
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const pp = [c[0] + (b[0][0] * ax + b[2][0] * az) * 1.05,
          c[1] + (b[0][2] * ax + b[2][2] * az) * 1.05];
        boxCol(soup, [pp[0], y + 1.15, pp[1]], [0.07, 1.15, 0.07], b, WOOD_DARK);
      }
      pyrCol(soup, [c[0], y + 2.25, c[1]], 1.5, 0.95, b, WOOD_DARK);
    }

    // --- carros arrimados a los caminos
    let carros = 0;
    for (const c of candidatos) {
      if (carros >= CART_COUNT) break;
      if (this.occB.has(((c[0] / OCC_CELL) | 0) * 100000 + ((c[1] / OCC_CELL) | 0))) continue;
      if (spots.some((s) => (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 < 45 * 45)) continue;
      spots.push(c);
      carros++;
      const y = this.heightAt(c[0], c[1]);
      // Vuelco leve y determinista: un carro parado siempre en plano se lee
      // como caja: con una rueda mas hundida que la otra la silueta deja de
      // ser un prisma recto.
      const b = tiltX(yawBasis(rng.randf() * TAU), (rng.randf() - 0.5) * 0.16);
      const g = [c[0], y, c[1]];
      const at = (lx, ly, lz) => [
        g[0] + b[0][0] * lx + b[1][0] * ly + b[2][0] * lz,
        g[1] + b[0][1] * lx + b[1][1] * ly + b[2][1] * lz,
        g[2] + b[0][2] * lx + b[1][2] * ly + b[2][2] * lz];
      boxCol(soup, at(0, 0.78, 0), [0.62, 0.06, 1.05], b, WOOD_DARK);
      for (const lado of [-1, 1]) {
        boxCol(soup, at(0.58 * lado, 0.98, 0), [0.05, 0.16, 1.05], b, WOOD_DARK);
        // rueda: dos cajas cruzadas 45 grados = silueta octogonal
        const wo = at(0.70 * lado, 0.46, 0.15);
        boxCol(soup, wo, [0.055, 0.46, 0.46], b, TRUNK_BROWN);
        boxCol(soup, wo, [0.055, 0.46, 0.46], tiltX(b, Math.PI / 4), TRUNK_BROWN);
        // varas al frente, caidas hacia el suelo
        boxCol(soup, at(0.34 * lado, 0.42, -1.65), [0.04, 0.04, 0.72],
          tiltX(b, 0.32), WOOD_DARK);
      }
    }

    // --- lena contra las fachadas, en la cara exterior de un muro largo
    let lenas = 0, intentos = 0;
    const bs = this.data.buildings;
    while (lenas < STACK_COUNT && intentos < STACK_COUNT * 8) {
      intentos++;
      const flat = bs[rng.randi_range(0, bs.length - 1)].p;
      const n = flat.length / 2;
      if (n < 4) continue;
      const i = rng.randi_range(0, n - 1);
      const p = [flat[i * 2], flat[i * 2 + 1]];
      const q = [flat[((i + 1) % n) * 2], flat[((i + 1) % n) * 2 + 1]];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < 4.0) continue;
      // normal exterior del muro, con el mismo criterio de giro que los muros
      let area2 = 0;
      for (let j = 0; j < n; j++) {
        area2 += flat[j * 2] * flat[((j + 1) % n) * 2 + 1]
               - flat[((j + 1) % n) * 2] * flat[j * 2 + 1];
      }
      const e = [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
      const out = area2 > 0 ? [e[1], -e[0]] : [-e[1], e[0]];
      const m = [(p[0] + q[0]) * 0.5 + out[0] * 0.62, (p[1] + q[1]) * 0.5 + out[1] * 0.62];
      const y = this.heightAt(m[0], m[1]);
      const esc = 0.8 + rng.randf() * 0.5;
      // Tres troncos, no una caja: seccion octogonal por el mismo truco que
      // las ruedas del carro (dos cajas cruzadas 45 grados), dos abajo y uno
      // encajado encima. A la distancia de juego una caja lisa se leia como
      // ladrillo, no como lena.
      const wb = yawBasis(Math.atan2(e[1], e[0]));
      const logCol = mul(TRUNK_BROWN, 0.85 + rng.randf() * 0.3);
      const logLen = 0.60 * esc, logR = 0.17 * esc;
      const bz = wb[2];
      for (const [dz, dyy] of [[-logR * 1.05, 0], [logR * 1.05, 0], [0, logR * 1.7]]) {
        const lo = [m[0] + bz[0] * dz, y + logR + dyy, m[1] + bz[2] * dz];
        boxCol(soup, lo, [logLen * 0.5, logR, logR], wb, logCol);
        boxCol(soup, lo, [logLen * 0.5, logR, logR], tiltX(wb, Math.PI / 4), logCol);
      }
      lenas++;
    }

    console.log(`vida: ${pozos} pozos | ${carros} carros | ${lenas} pilas de leña`);
    const mesh = new THREE.Mesh(soup.geometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.name = 'Atrezzo';
    return mesh;
  }

  // Encinar en la dehesa, pinar monte arriba. Dos InstancedMesh de mallas
  // unitarias escaladas por instancia; el color por instancia da la variedad.
  // ponytail: los arboles no tienen colision, igual que en Godot.
  addTrees() {
    const sx = this.data.size_m[0], sz = this.data.size_m[1];
    const sitios = [];

    for (let gx = TREE_GRID * 0.5; gx < sx; gx += TREE_GRID) {
      for (let gz = TREE_GRID * 0.5; gz < sz; gz += TREE_GRID) {
        const h1 = hash(gx, gz);
        const h2 = fract(h1 * 137.719);
        const x = gx + (h1 - 0.5) * TREE_GRID * 0.9;
        const z = gz + (h2 - 0.5) * TREE_GRID * 0.9;
        if (!this.freeAround(x, z)) continue;
        const nrm = this.normalAt(x, z);
        if (nrm[1] < 0.55) continue;                   // roquedo pelado
        const y = this.heightAt(x, z);
        // Manchas de bosque por ruido gordo: claros y golpes de arboleda, mas
        // espeso monte arriba (pinar) que en la dehesa (encinas sueltas).
        const mancha = Math.sin(x * 0.0093 + 2.1) * Math.sin(z * 0.0117 + 0.7);
        const pinar = y > TREE_LINE;
        const dens = pinar ? (mancha > 0.1 ? 0.55 : 0.20) : (mancha > 0.25 ? 0.30 : 0.09);
        const h3 = fract(h2 * 91.173);
        if (h3 > dens) continue;
        const esc = 0.8 + fract(h3 * 57.13) * 0.5;
        const yaw = h1 * TAU;
        // Solo la SIEMBRA vive aqui: que forma tiene un arbol lo decide
        // trees.js. Antes esto eran cajas y conos escalados y se veia.
        sitios.push({ x, y, z, yaw, esc, pinar: pinar && h3 < dens * 0.8, tono: h2 });
      }
    }

    const arboles = crearArboleda(sitios, this.uClima);
    this.add(...arboles);
    const pinos = sitios.filter((s) => s.pinar).length;
    console.log(`vida: ${sitios.length} arboles (${pinos} pinos) en`
      + ` ${arboles.length} mallas`);
  }

  // Indice de la huella mas grande del mapa: el Monasterio, con mucha ventaja
  // (35.771 m2; el segundo baja de 6.300).
  biggestFootprint() {
    let bestI = -1, bestA = 0;
    this.data.buildings.forEach((b, k) => {
      const flat = b.p;
      const n = flat.length / 2;
      let a = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
      }
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); bestI = k; }
    });
    return bestI;
  }

  // El Monasterio sobre su huella real: muralla perimetral, tapa de pizarra,
  // chapitel en cada esquina del rectangulo orientado, cimborrio octogonal con
  // cupula y dos torres de campanas.
  monastery(poly, base, suelo, wall, roof, abrirPaso) {
    // 0.05 = piedra vista, 1 = modo Monasterio (reticula de huecos) en el shader
    const uv = [0.05, suelo, 1];
    const top = suelo + MON_WALL_H;
    // La muralla tambien se abre por donde cruza una calle. Es la que separa la
    // lonja de los jardincillos, asi que sin esto el paso se anda pero se ve
    // tapiado, que es lo peor de los dos mundos.
    extrudeRing(poly, base, top, uv, wall, abrirPaso);

    // Tapa plana sobre toda la huella. Ya no es la cubierta: es el enlosado que
    // se ve en el fondo de los patios, con las crujias levantadas encima.
    const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const p = t.map((i) => [poly[i][0], top, poly[i][1]]);
      // El triangulador no garantiza el sentido: se orienta hacia arriba.
      const cross = (p[1][0] - p[0][0]) * (p[2][2] - p[0][2])
                  - (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]);
      const o = cross < 0 ? [p[0], p[1], p[2]] : [p[0], p[2], p[1]];
      roof.push(o[0], o[1], o[2], [0, 1, 0], MON_PAVING);
    }

    // Rectangulo orientado de la huella: los ejes donde van torres y cupula.
    let u = [1, 0], best = -1;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const e = [poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]];
      const l = Math.hypot(e[0], e[1]);
      if (l > best) { best = l; u = [e[0] / l, e[1] / l]; }
    }
    const v = [-u[1], u[0]];
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const p of poly) {
      const du = p[0] * u[0] + p[1] * u[1], dv = p[0] * v[0] + p[1] * v[1];
      umin = Math.min(umin, du); umax = Math.max(umax, du);
      vmin = Math.min(vmin, dv); vmax = Math.max(vmax, dv);
    }
    const c = [u[0] * (umin + umax) * 0.5 + v[0] * (vmin + vmax) * 0.5,
      u[1] * (umin + umax) * 0.5 + v[1] * (vmin + vmax) * 0.5];

    // Chapiteles en las cuatro esquinas. La huella real no llega al rectangulo
    // teorico en todas ellas, asi que cada torre se ancla al vertice real mas
    // cercano a la esquina y se mete hacia dentro. Arranca de `base`, bajo tierra:
    // apoyada en `suelo` flotaria en el lado cuesta abajo.
    //
    // Media torre de retranqueo no basta: la torre es un CUADRADO orientado con
    // el eje largo y las esquinas del Monasterio van achaflanadas, asi que su
    // esquina exterior seguia asomando 3,2 m por fuera de la muralla, con 36 m de
    // fachada debajo y el chapitel encima. Se mete hasta que las cuatro esquinas
    // de la base pisan la huella, comprobandolo, en vez de fiarse de una cuenta.
    const hw = MON_TOWER_W * 0.5;
    for (const su of [umin, umax]) {
      for (const sv of [vmin, vmax]) {
        const esq = [u[0] * su + v[0] * sv, u[1] * su + v[1] * sv];
        let pv = poly[0], dmin = Infinity;
        for (const p of poly) {
          const d = (p[0] - esq[0]) ** 2 + (p[1] - esq[1]) ** 2;
          if (d < dmin) { dmin = d; pv = p; }
        }
        const dc = Math.hypot(c[0] - pv[0], c[1] - pv[1]) || 1;
        const hacia = [(c[0] - pv[0]) / dc, (c[1] - pv[1]) / dc];
        const base4 = (t) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) =>
          [pv[0] + hacia[0] * t + (u[0] * a + v[0] * b) * hw,
            pv[1] + hacia[1] * t + (u[1] * a + v[1] * b) * hw]);
        let met = hw;
        for (let k = 0; k < 24; k++) {
          if (base4(met).every(([x, z]) => vuela(poly, x, z) === 0)) break;
          met += 0.5;                 // hasta 12 m mas adentro, medio metro cada vez
        }
        tower([pv[0] + hacia[0] * met, pv[1] + hacia[1] * met],
          u, hw, base, suelo + MON_TOWER_H, MON_SPIRE_H, uv, wall, roof);
      }
    }

    // La parrilla: crujias con cubierta de pizarra dejando patios entre medias.
    this.monasteryWings(poly, u, v, umin, umax, vmin, vmax, top, uv, wall, roof);

    // Cimborrio: tambor octogonal + cupula, corrido en el eje largo como el real.
    const dc = [c[0] + u[0] * 10, c[1] + u[1] * 10];
    const oct = [];
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i + 0.5) / 8;
      oct.push([dc[0] + Math.cos(a) * MON_DRUM_R, dc[1] + Math.sin(a) * MON_DRUM_R]);
    }
    extrudeRing(oct, top - 0.5, suelo + MON_DRUM_H, uv, wall);
    pyramid(oct, suelo + MON_DRUM_H, suelo + MON_DOME_H, MON_SLATE, roof);

    // Linternilla sobre la cupula: pequena, pero es lo que remata la silueta y
    // sin ella el cimborrio se lee como un cucurucho.
    const lin = [];
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i + 0.5) / 8;
      lin.push([dc[0] + Math.cos(a) * MON_LANTERN_R, dc[1] + Math.sin(a) * MON_LANTERN_R]);
    }
    const linY = suelo + MON_DOME_H - 1.5;
    extrudeRing(lin, linY, linY + MON_LANTERN_H, uv, wall);
    pyramid(lin, linY + MON_LANTERN_H, linY + MON_LANTERN_H + 3.0, MON_SLATE, roof);

    // Torres de campanas flanqueando la basilica, al otro lado del cimborrio.
    for (const lado of [-1, 1]) {
      tower([c[0] - u[0] * 16 + v[0] * 20 * lado, c[1] - u[1] * 16 + v[1] * 20 * lado],
        u, MON_BELL_W * 0.5, base, suelo + MON_BELL_H, MON_SPIRE_H, uv, wall, roof);
    }
  }

  // Crujias de la parrilla. Se reparte el rectangulo orientado en MON_GRID_U x
  // MON_GRID_V patios; lo que queda entre ellos son bandas, y cada banda lleva
  // muro con ventanas y cubierta a dos aguas. Las bandas se cruzan y se solapan
  // en los encuentros: por dentro no se ve, y evita tener que unir poligonos.
  monasteryWings(poly, u, v, umin, umax, vmin, vmax, top, uv, wall, roof) {
    const u0 = umin + MON_INSET, u1 = umax - MON_INSET;
    const v0 = vmin + MON_INSET, v1 = vmax - MON_INSET;
    // Posicion del eje de cada banda: los extremos y los tabiques entre patios.
    const ejes = (a, b, n) => {
      const paso = (b - a) / n;
      return Array.from({ length: n + 1 }, (_, i) => a + paso * i);
    };
    const eu = ejes(u0 + MON_WING_W * 0.5, u1 - MON_WING_W * 0.5, MON_GRID_U);
    const ev = ejes(v0 + MON_WING_W * 0.5, v1 - MON_WING_W * 0.5, MON_GRID_V);
    const hw = MON_WING_W * 0.5;

    const mundo = (a, b) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b];
    const emitir = (su0, su1, sv0, sv1) => {
      const rect = [[su0, sv0], [su1, sv0], [su1, sv1], [su0, sv1]]
        .map(([a, b]) => mundo(a, b));
      extrudeRing(rect, top - 0.5, top + MON_WING_H, uv, wall);
      slateRoof(rect, top + MON_WING_H, MON_WING_ROOF, roof);
    };

    // La huella real del Monasterio no llena su rectangulo orientado (35.770 m2
    // de 44.229), asi que una banda tirada de lado a lado se sale por los
    // chaflanes y queda colgada en el aire fuera de la muralla. Se trocea a lo
    // largo, se descartan los trozos que pisan fuera y los que quedan se emiten
    // en tiradas seguidas, para no dejar hastiales enfrentados por dentro.
    const banda = (su0, su1, sv0, sv1, enU) => {
      const [a0, a1] = enU ? [su0, su1] : [sv0, sv1];
      const nT = Math.max(1, Math.round((a1 - a0) / (MON_WING_W * 2)));
      const paso = (a1 - a0) / nT;
      const trozo = (i, e0, e1) => (enU
        ? [a0 + paso * (i + e0), a0 + paso * (i + e1), sv0, sv1]
        : [su0, su1, a0 + paso * (i + e0), a0 + paso * (i + e1)]);
      let ini = -1;
      for (let i = 0; i <= nT; i++) {
        const t = i < nT ? trozo(i, 0, 1) : null;
        const dentro = t && [[t[0], t[2]], [t[1], t[2]], [t[1], t[3]], [t[0], t[3]]]
          .every(([a, b]) => { const p = mundo(a, b); return vuela(poly, p[0], p[1]) === 0; });
        if (dentro && ini < 0) ini = i;
        else if (!dentro && ini >= 0) { emitir(...trozo(ini, 0, i - ini)); ini = -1; }
      }
    };

    for (const e of eu) banda(e - hw, e + hw, v0, v1, false);   // crujias transversales
    for (const e of ev) banda(u0, u1, e - hw, e + hw, true);    // crujias longitudinales
  }
}

// Cubierta a dos aguas de pizarra sobre un rectangulo, con la cumbrera en el
// lado largo. Es el gableRoof del caserio sin alero, sin sorteo de material y
// con la altura mandada desde fuera.
function slateRoof(rect, y0, alto, roof) {
  const lado = (i, j) => Math.hypot(rect[j][0] - rect[i][0], rect[j][1] - rect[i][1]);
  // rect llega en orden, asi que 0-1 y 1-2 son los dos lados perpendiculares.
  const largoEnU = lado(0, 1) >= lado(1, 2);
  const m = (i, j) => [(rect[i][0] + rect[j][0]) * 0.5, (rect[i][1] + rect[j][1]) * 0.5];
  // Los dos extremos de la cumbrera, en el centro de los lados cortos.
  const [c0, c1] = largoEnU ? [m(0, 3), m(1, 2)] : [m(0, 1), m(2, 3)];
  const r0 = [c0[0], y0 + alto, c0[1]];
  const r1 = [c1[0], y0 + alto, c1[1]];
  const p = rect.map((q) => [q[0], y0, q[1]]);
  const dentro = [(p[0][0] + p[2][0]) * 0.5, y0 - 1, (p[0][2] + p[2][2]) * 0.5];

  if (largoEnU) {
    roof.tri(p[0], p[1], r1, dentro, MON_SLATE);
    roof.tri(p[0], r1, r0, dentro, MON_SLATE);
    roof.tri(p[2], p[3], r0, dentro, MON_SLATE);
    roof.tri(p[2], r0, r1, dentro, MON_SLATE);
    roof.tri(p[1], p[2], r1, dentro, MON_SLATE);
    roof.tri(p[3], p[0], r0, dentro, MON_SLATE);
  } else {
    roof.tri(p[1], p[2], r1, dentro, MON_SLATE);
    roof.tri(p[1], r1, r0, dentro, MON_SLATE);
    roof.tri(p[3], p[0], r0, dentro, MON_SLATE);
    roof.tri(p[3], r0, r1, dentro, MON_SLATE);
    roof.tri(p[2], p[3], r1, dentro, MON_SLATE);
    roof.tri(p[0], p[1], r0, dentro, MON_SLATE);
  }
}

// Vuelco sobre el eje X local de la base (ruedas y varas de los carros).
function tiltX(b, ang) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return [
    b[0],
    [b[1][0] * ca + b[2][0] * sa, b[1][1] * ca + b[2][1] * sa, b[1][2] * ca + b[2][2] * sa],
    [-b[1][0] * sa + b[2][0] * ca, -b[1][1] * sa + b[2][1] * ca, -b[1][2] * sa + b[2][2] * ca],
  ];
}

// Extruye un anillo en planta entre dos cotas, con las caras hacia fuera.
// Acepta el anillo en cualquier sentido de giro: normaliza dentro.
// Alto libre de un soportal y grosor minimo del dintel que queda encima.
const ALTO_PASO = 3.6;
const DINTEL_MIN = 0.7;

// `abrir(x, z)` es opcional y devuelve NULL o la cota del dintel. Donde da una
// cota, la fachada arranca ahi en vez de en la base, y lo que queda encima es el
// dintel del soportal. Es lo que convierte "se puede pasar" en "se ve por donde".
//
// Devuelve una COTA y no un booleano por un motivo que costo una pasada: el
// dintel no puede medirse desde `base`. La base de una huella es su vertice mas
// bajo, y en el Monasterio -205 x 162 m en cuesta- eso queda metros bajo tierra,
// asi que base + 3,6 seguia siendo subterraneo y el hueco se abria donde no se
// ve. La cota tiene que salir del terreno EN ESE PUNTO.
//
// Hacia falta: abrir la colision sin abrir la geometria deja al jugador
// atravesando un muro macizo como un fantasma, que se lee peor que el muro.
function extrudeRing(ring, base, top, uv, wall, abrir = null) {
  let poly = ring;
  const n = poly.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  if (area2 > 0) poly = poly.slice().reverse();

  const quad = (p, q, y0, y1, nx, nz) => {
    if (y1 - y0 < 1e-3) return;
    const p0 = [p[0], y0, p[1]], p1 = [q[0], y0, q[1]];
    const p2 = [q[0], y1, q[1]], p3 = [p[0], y1, p[1]];
    // Godot: [p0,p2,p1, p0,p3,p2]. Invertido para antihorario.
    for (const t of [p0, p1, p2, p0, p2, p3]) {
      wall.v.push(t[0], t[1], t[2]);
      wall.n.push(nx, 0, nz);
      wall.uv.push(uv[0], uv[1], uv[2]);
    }
  };

  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const ex = q[0] - p[0], ez = q[1] - p[1];
    const el = Math.hypot(ex, ez);
    if (el < 1e-3) continue;
    const nx = -ez / el, nz = ex / el;

    if (!abrir) { quad(p, q, base, top, nx, nz); continue; }

    // Se recorre la arista a medio metro y se agrupan los tramos seguidos que
    // esten abiertos o cerrados: asi un soportal de tres metros sale de un solo
    // hueco y no de seis rendijas.
    const pasos = Math.max(1, Math.ceil(el / 0.5));
    const en = (k) => [p[0] + ex * (k / pasos), p[1] + ez * (k / pasos)];
    const abre = (k) => abrir(p[0] + ex * ((k + 0.5) / pasos),
      p[1] + ez * ((k + 0.5) / pasos));
    let ini = 0, estado = abre(0);
    for (let k = 1; k <= pasos; k++) {
      const e = k < pasos ? abre(k) : null;
      // Se corta el tramo al cambiar de abierto a cerrado o al revés, y siempre
      // al llegar al final de la arista.
      if ((e === null) === (estado === null) && k < pasos) continue;
      let y0 = base;
      if (estado !== null) {
        // Con un edificio tan bajo que el soportal lo dejaria sin fachada, se
        // levanta entero: mejor tapiado que un muro flotando sobre nada.
        y0 = top - estado < DINTEL_MIN ? base : Math.max(base, estado);
      }
      quad(en(ini), en(k), y0, top, nx, nz);
      ini = k; estado = e;
    }
  }
}

// Cuanto vuela un punto por fuera de un anillo en planta: 0 si cae dentro, y si
// no la distancia a la fachada mas cercana. Es el `hits` de player.js con el
// margen a la salida en vez de a la entrada; alli decide si frena al jugador,
// aqui si un faldon o una chimenea se quedan colgados sobre el vacio.
export function vuela(poly, x, z) {
  let dentro = false, dist = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z)
      && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) dentro = !dentro;
    const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez;
    const t = ll > 0 ? Math.min(Math.max(((x - a[0]) * ex + (z - a[1]) * ez) / ll, 0), 1) : 0;
    dist = Math.min(dist, Math.hypot(a[0] + ex * t - x, a[1] + ez * t - z));
  }
  return dentro ? 0 : dist;
}

// Un punto seguro dentro de un anillo cualquiera: baricentro del triangulo mas
// grande de su triangulacion. El centroide del anillo no vale, en una planta en
// L se sale del edificio.
// Un array plano [x,z,x,z,...] a [[x,z],...].
function aPuntos(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

function dentroDe(poly, x, z) {
  const n = poly.length / 2;
  let dentro = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1];
    const xj = poly[j * 2], zj = poly[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) dentro = !dentro;
  }
  return dentro;
}

function cercaDeArista(poly, x, z, r) {
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1];
    const xj = poly[j * 2], zj = poly[j * 2 + 1];
    const ex = xj - xi, ez = zj - zi;
    const ll = ex * ex + ez * ez;
    const t = ll > 0 ? Math.min(Math.max(((x - xi) * ex + (z - zi) * ez) / ll, 0), 1) : 0;
    const px = xi + ex * t - x, pz = zi + ez * t - z;
    if (px * px + pz * pz < r * r) return true;
  }
  return false;
}

// Punto contra huella con holgura. Venia de player.js con el nombre `hits`; se
// sube aqui con el indice y se le anaden los patios.
//
// La parte solida es lo que esta dentro del contorno Y FUERA de todos los
// patios, mas un margen `r` alrededor de cualquier arista -tambien las del
// patio, que son muro por dentro-. Sin el margen se podria colar por la esquina
// de un patio; sin descontar el patio, un edificio con patio es un bloque
// macizo, que es como estaban los 97 del pueblo.
function tocaPoligono(poly, x, z, r) {
  if (cercaDeArista(poly, x, z, r)) return true;
  const q = poly.patios;
  if (q) for (const h of q) if (cercaDeArista(h, x, z, r)) return true;
  if (!dentroDe(poly, x, z)) return false;
  if (q) for (const h of q) if (dentroDe(h, x, z)) return false;
  return true;
}

// Cubierta de un edificio con patio, en anillo. No se le meten agujeros a
// gableRoof y hay razon: esa lleva dentro demasiada logica ganada a golpes
// -faldones colgados, plantas en L, chaflanes, la rejilla de sondeo en metros- y
// abrirle un hueco es la manera de perderla toda. Esta es aparte y no la toca.
//
// La forma es un faldon que sube desde el alero exterior, otro que sube desde el
// alero del patio, y una banda plana donde se encuentran. Sale de meter hacia
// dentro los dos anillos con insetRing, que ya existe, y de taparlo con el
// triangulador de three, que YA acepta agujeros: el Monasterio le pasa una lista
// vacia desde el principio.
//
// ponytail: es una cubierta a la mansarda, no un anillo a dos aguas con su
// caballete siguiendo el eje medio de la crujia. A la distancia a la que se ve
// esto -desde la calle y desde el monte- no se distingue; si algun dia se mira
// desde arriba de cerca, lo que falta es el eje medio.
function patioRoof(poly, huecos, top, alto, col, roof) {
  const fuera = insetRing(poly, ALERO_PATIO);
  if (!fuera) return false;
  const dentro = huecos.map((h) => insetRing(h, -ALERO_PATIO)).filter(Boolean);
  if (dentro.length !== huecos.length) return false;

  // Faldon exterior: del alero de fuera al anillo metido, subiendo.
  faldon(poly, fuera, top, top + alto, col, roof);
  // Faldon del patio: del alero del patio a su anillo, subiendo tambien. El
  // patio se cubre desde dentro, que es lo que hace que llueva al fondo y no
  // sobre el tejado.
  for (let i = 0; i < huecos.length; i++) {
    faldon(huecos[i], dentro[i], top, top + alto, col, roof);
  }

  // Y la banda de arriba, plana, con los patios como agujeros.
  const contorno = fuera.map((p) => new THREE.Vector2(p[0], p[1]));
  const agujeros = dentro.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contorno, agujeros);
  } catch {
    return false;             // anillo que se cruza: mejor sin cubierta que con una aleta
  }
  const todos = [...fuera, ...dentro.flat()];
  for (const t of tris) {
    const p = t.map((i) => [todos[i][0], top + alto, todos[i][1]]);
    // El triangulador no garantiza el sentido: se orienta hacia arriba, igual
    // que la tapa del Monasterio.
    const cruz = (p[1][0] - p[0][0]) * (p[2][2] - p[0][2])
               - (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]);
    const o = cruz < 0 ? [p[0], p[1], p[2]] : [p[0], p[2], p[1]];
    roof.push(o[0], o[1], o[2], [0, 1, 0], col);
  }
  return true;
}

// Un faldon entre dos anillos con el mismo numero de vertices: dos triangulos
// por arista, con la normal calculada del propio quad.
function faldon(abajo, arriba, y0, y1, col, roof) {
  const n = abajo.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [abajo[i][0], y0, abajo[i][1]];
    const b = [abajo[j][0], y0, abajo[j][1]];
    const c = [arriba[j][0], y1, arriba[j][1]];
    const d = [arriba[i][0], y1, arriba[i][1]];
    // Un punto por debajo del faldon sirve de "dentro" para orientar la cara:
    // el tejado mira hacia arriba y hacia fuera del solido.
    const bajo = [(a[0] + c[0]) * 0.5, y0 - 6, (a[2] + c[2]) * 0.5];
    roof.tri(a, b, c, bajo, col);
    roof.tri(a, c, d, bajo, col);
  }
}

function safeInterior(poly) {
  const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  let best = null, bestA = -1;
  for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const [a, b, c] = t.map((i) => poly[i]);
    const A = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (A > bestA) { bestA = A; best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; }
  }
  return best;
}

// Cubierta a cuatro aguas sobre una planta cualquiera: faldon desde la fachada
// hasta un anillo metido hacia dentro y mas alto, y ese anillo tapado con su
// propia triangulacion. Devuelve donde plantar la chimenea.
//
// Antes esto era una piramide: un abanico de triangulos desde un punto interior
// hasta cada arista de la fachada. En una planta concava el abanico CRUZA el
// entrante -el triangulo que va de una arista al vertice del otro ala pasa por
// encima del patio- y ahi el tejado se ve flotando. Y no lo cazaba nadie: todos
// los VERTICES del abanico estan en la huella o dentro de ella, asi que ?test,
// que medía vertices, lo daba por bueno mientras se veia desde la calle. Vuelo
// peor del abanico: 20,2 m. Con faldon y tapa: 2,2 m, y solo tres casas pasan
// de 1 m.
//
// La tapa se triangula con orejas (ShapeUtils), que cubre exactamente el anillo
// y ni un metro mas, sea concavo o no. Ahi esta la diferencia con el abanico.
function hipRoof(poly, top, alto, col, roof) {
  // Metido proporcional al tamano de la planta, con tope: una casa de pueblo no
  // tiene 3 m de faldon, y una nave grande sin tope se queda sin tapa.
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const base = Math.max(0.8, Math.min(2.5, Math.sqrt(Math.abs(area) * 0.5) * 0.12));

  // En una planta estrecha el anillo metido se cruza consigo mismo, asi que se
  // prueba cada vez menos hasta que salga uno limpio. Si ninguno vale (49 casas
  // de 3545, las mas delgadas) la tapa se pone plana sobre la propia huella: un
  // terrado no queda tan bien como un tejado, pero no cuelga sobre nada.
  let anillo = null;
  for (const f of [1, 0.6, 0.35, 0.2, 0.1]) {
    anillo = insetRing(poly, base * f);
    if (anillo) break;
  }
  const plano = !anillo;
  if (plano) anillo = poly.map((p) => p.slice());

  const y1 = top + (plano ? alto * 0.35 : alto);
  const dentro = [0, top - 1.0, 0];
  for (const p of anillo) { dentro[0] += p[0] / anillo.length; dentro[2] += p[1] / anillo.length; }

  // Faldon: un par de triangulos por fachada, de la linea de cornisa al anillo.
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const a = [poly[i][0], top, poly[i][1]], b = [poly[j][0], top, poly[j][1]];
    const c = [anillo[j][0], y1, anillo[j][1]], e = [anillo[i][0], y1, anillo[i][1]];
    roof.tri(a, b, c, dentro, col);
    roof.tri(a, c, e, dentro, col);
  }

  // Tapa.
  const contour = anillo.map((p) => new THREE.Vector2(p[0], p[1]));
  const tapa = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const t of tapa) {
    const [a, b, c] = t.map((i) => [anillo[i][0], y1, anillo[i][1]]);
    roof.tri(a, b, c, dentro, col);
  }

  // Chimenea: sobre la tapa -a su altura, que baja si ha salido plana- y en un
  // punto interior de verdad, no en el centroide del anillo (en una L se sale).
  const c = safeInterior(anillo);
  return c ? [c[0], y1, c[1]] : null;
}

// Si el anillo se cruza consigo mismo. O(n2) sobre pares de aristas no vecinas,
// y solo se llama para el punado de plantas que no admiten anillo metido.
function seCruza(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;        // aristas vecinas por el cierre
      if (cortan(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

function cortan(a, b, c, d) {
  const s = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = s(a, b, c), d2 = s(a, b, d), d3 = s(c, d, a), d4 = s(c, d, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Anillo metido `t` metros por la bisectriz de cada vertice. Devuelve null si el
// resultado no sirve: o algun vertice se ha salido de la huella, o una arista se
// ha dado la vuelta -senal de que el anillo se cruza consigo mismo y la tapa
// saldria hecha un nudo-.
function insetRing(poly, t) {
  const n = poly.length;
  const norma = (v) => { const l = Math.hypot(v[0], v[1]); return l > 1e-9 ? [v[0] / l, v[1] / l] : null; };
  // El sentido de giro ya viene normalizado, pero no cuesta nada probar los dos y
  // quedarse con el que mete el anillo hacia dentro.
  for (const signo of [1, -1]) {
    const out = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
      const e0 = norma([p[0] - a[0], p[1] - a[1]]), e1 = norma([b[0] - p[0], b[1] - p[1]]);
      if (!e0 || !e1) { ok = false; break; }      // vertice repetido de OSM
      const n0 = [-e0[1] * signo, e0[0] * signo], n1 = [-e1[1] * signo, e1[0] * signo];
      const bis = norma([n0[0] + n1[0], n0[1] + n1[1]]) || n1;
      // 1/sen(medio angulo): en una esquina hay que ir mas lejos para meterse `t`.
      const cos = n0[0] * n1[0] + n0[1] * n1[1];
      const escala = Math.min(1 / Math.max(Math.sqrt((1 + cos) * 0.5), 0.35), 2.9);
      out.push([p[0] + bis[0] * t * escala, p[1] + bis[1] * t * escala]);
    }
    if (!ok) continue;
    if (!out.every(([x, z]) => vuela(poly, x, z) === 0)) continue;
    const derechas = out.every((_, i) => {
      const j = (i + 1) % n;
      const e0 = [poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]];
      const e1 = [out[j][0] - out[i][0], out[j][1] - out[i][1]];
      return e0[0] * e1[0] + e0[1] * e1[1] > 0;
    });
    // La arista invertida es la senal barata, pero no basta: en un zigzag el
    // anillo se cruza con aristas que no son vecinas y todas siguen "derechas".
    // Triangular un anillo cruzado da triangulos por fuera, y ahi estaba el peor
    // faldon del pueblo (12,4 m sobre una nave en zigzag de 23 vertices).
    if (derechas && !seCruza(out)) return out;
  }
  return null;
}

// Piramide de base poligonal, para chapiteles, la cupula y la linternilla.
// `cumbre` fuerza el vertice en planta; sin el se usa el centroide, que
// en un anillo concavo puede caer fuera.
function pyramid(ring, y0, y1, col, roof, cumbre) {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  if (cumbre) { cx = cumbre[0]; cz = cumbre[1]; }
  const apex = [cx, y1, cz];
  const dentro = [cx, y0 - 1, cz];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    roof.tri([p[0], y0, p[1]], [q[0], y0, q[1]], apex, dentro, col);
  }
}

// Torre cuadrada con chapitel de pizarra.
function tower(c, u, hw, y0, y1, spire, uv, wall, roof) {
  const v = [-u[1], u[0]];
  const sq = [
    [c[0] + (u[0] + v[0]) * hw, c[1] + (u[1] + v[1]) * hw],
    [c[0] + (u[0] - v[0]) * hw, c[1] + (u[1] - v[1]) * hw],
    [c[0] - (u[0] + v[0]) * hw, c[1] - (u[1] + v[1]) * hw],
    [c[0] - (u[0] - v[0]) * hw, c[1] - (u[1] - v[1]) * hw],
  ];
  extrudeRing(sq, y0, y1, uv, wall);
  pyramid(sq, y1, y1 + spire, MON_SLATE, roof);
}

// Cubierta a dos aguas sobre el rectangulo orientado del contorno.
//
// La cumbrera va paralela a la fachada mas larga, que es como se levanta de
// verdad. El rectangulo sale de proyectar el contorno sobre esa direccion, asi
// que siempre lo contiene y lo que sobra queda de alero volado.
//
// Cuando el rectangulo se pasa de la huella (plantas en L y similares: una de
// cada cinco casas, y las peores llegan a 3,5x) ese sobrante son metros de
// faldon sin muro debajo, que se leen como un tejado flotando. En ese caso se
// cambia a cuatro aguas sobre la huella real, que no puede salirse.
// ponytail: el abanico de faldones sale del interior seguro, no de un esqueleto
// recto; en un anillo no estrellado algun pano se pasa un poco. Sobra para 3545
// casas vistas desde la calle.
function gableRoof(poly, top, seed, roof, chimneys) {
  // Un anillo que se cruza consigo mismo no tiene dentro ni fuera, y cualquier
  // cubierta sobre el sale por donde le parece: el peor faldon colgado del pueblo
  // -12,8 m- era una tapia dibujada asi en OSM, con 23 vertices, 0,0 m de altura y
  // una arista final que cruzaba las otras veintidos. Sin cubierta se ve mejor que
  // con una aleta en el aire.
  if (seCruza(poly)) return;

  const n = poly.length;
  let u = [1, 0], masLarga = -1;
  for (let i = 0; i < n; i++) {
    const e = [poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]];
    const l = Math.hypot(e[0], e[1]);
    if (l > masLarga) { masLarga = l; u = [e[0] / l, e[1] / l]; }
  }
  const v = [-u[1], u[0]];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const p of poly) {
    const du = p[0] * u[0] + p[1] * u[1], dv = p[0] * v[0] + p[1] * v[1];
    umin = Math.min(umin, du); umax = Math.max(umax, du);
    vmin = Math.min(vmin, dv); vmax = Math.max(vmax, dv);
  }
  let areaPoly = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    areaPoly += p[0] * q[1] - q[0] * p[1];
  }
  areaPoly = Math.abs(areaPoly) * 0.5;
  const largo = Math.max(umax - umin, vmax - vmin);
  // Dos avisos de que el rectangulo no representa la planta: que sobre area, y
  // que alguna de sus esquinas caiga lejos de la fachada. El segundo pilla los
  // chaflanes, que apenas mueven el area y sin embargo dejan metros de faldon en
  // el aire. Con los dos, 47% de las casas pasan a cuatro aguas y solo quedan 99
  // con mas de 2 m de vuelo (eran 1626); solo con el area harian falta el 63%.
  // El rectangulo con alero se sondea con una REJILLA, no por las cuatro
  // esquinas: un entrante en mitad de un lado -una planta en L, una U- deja las
  // cuatro esquinas pegadas a la fachada y aun asi 6 m de faldon en el aire. Las
  // doce peores casas del pueblo eran exactamente ese caso, y ninguna pasaba de
  // 1,25 de sobra de area, asi que los dos avisos anteriores no las veian.
  // La rejilla se mide en METROS, no en un numero fijo de sondas por lado: con
  // 9x9 en una nave de 60 m quedan 7 m entre sonda y sonda y un entrante mas
  // estrecho que eso se cuela entero. A 2 m no se cuela.
  const U0 = umin - EAVES, U1 = umax + EAVES, V0 = vmin - EAVES, V1 = vmax + EAVES;
  const nu = Math.min(40, Math.max(5, Math.ceil((U1 - U0) / PASO_SONDA)));
  const nv = Math.min(40, Math.max(5, Math.ceil((V1 - V0) / PASO_SONDA)));
  let aCuatroAguas = false;
  for (let i = 0; i < nu && !aCuatroAguas; i++) {
    for (let j = 0; j < nv; j++) {
      const su = U0 + (U1 - U0) * (i + 0.5) / nu;
      const sv = V0 + (V1 - V0) * (j + 0.5) / nv;
      if (vuela(poly, u[0] * su + v[0] * sv, u[1] * su + v[1] * sv) > VUELO_MAX) {
        aCuatroAguas = true; break;
      }
    }
  }

  let col = seed < 0.45 ? ROOF_THATCH : ROOF_TILE;
  col = mul(col, 0.82 + 0.36 * fract(seed * 7.13));

  // Punto donde se planta la chimenea, ya en coordenadas de mundo.
  let cx, cy, cz;

  if (aCuatroAguas) {
    // Sin alero: el faldon arranca en la linea de fachada. Volarlo pediria
    // desplazar el anillo hacia fuera, y es justo lo que sobra aqui.
    const ancho = areaPoly / Math.max(largo, 1e-3);   // anchura media de la planta
    const alto = Math.min(ancho * 0.5 * ROOF_PITCH, ROOF_MAX);
    const cumbre = hipRoof(poly, top, alto, col, roof);
    if (!cumbre) return;
    [cx, cy, cz] = cumbre;
  } else {
    umin -= EAVES; umax += EAVES; vmin -= EAVES; vmax += EAVES;

    const alto = Math.min((vmax - vmin) * 0.5 * ROOF_PITCH, ROOF_MAX);
    const vmid = (vmin + vmax) * 0.5;
    const pt = (su, sv, y) => [u[0] * su + v[0] * sv, y, u[1] * su + v[1] * sv];

    const a = pt(umin, vmin, top), b = pt(umax, vmin, top);
    const c = pt(umax, vmax, top), d = pt(umin, vmax, top);
    const r0 = pt(umin, vmid, top + alto), r1 = pt(umax, vmid, top + alto);
    const dentro = pt((umin + umax) * 0.5, vmid, top - 1.0);

    roof.tri(a, b, r1, dentro, col);            // faldon 1
    roof.tri(a, r1, r0, dentro, col);
    roof.tri(c, d, r0, dentro, col);            // faldon 2
    roof.tri(c, r0, r1, dentro, col);
    roof.tri(b, c, r1, dentro, col);            // hastiales
    roof.tri(d, a, r0, dentro, col);

    const ct = 0.25 + fract(seed * 5.0) * 0.5;    // posicion a lo largo de la cumbrera
    cx = r0[0] + (r1[0] - r0[0]) * ct;
    cy = r0[1] + (r1[1] - r0[1]) * ct;
    cz = r0[2] + (r1[2] - r0[2]) * ct;
    // Aun con el rectangulo ajustado la cumbrera puede cruzar un entrante de la
    // planta: ahi la chimenea quedaria colgada en el aire.
    if (vuela(poly, cx, cz) > 0) return;
  }

  // Chimenea: subconjunto determinista (~40% de las casas, por semilla), pila
  // que afina en dos tramos, plantada en la cumbrera. Sin esto el caserio se
  // lee como prismas puros; con una en cuatro tejados ya rompe la silueta.
  if (seed > 0.60) {
    const cb = [[u[0], 0, u[1]], [0, 1, 0], [-u[1], 0, u[0]]];
    const chimCol = mul(CHIMNEY_STONE, 0.85 + 0.3 * fract(seed * 11.0));
    boxCol(roof, [cx, cy - 0.25, cz], [0.40, 0.55, 0.40], cb, chimCol);
    boxCol(roof, [cx, cy + 0.65, cz], [0.26, 0.35, 0.26], cb, chimCol);
    // Remate del segundo tramo (centro cy+0.65, semialto 0.35): de ahi sale el humo.
    if (chimneys) chimneys.push([cx, cy + 1.0, cz]);
  }
}
