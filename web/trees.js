import * as THREE from 'three';

// Arboleda procedural para San Lorenzo. Sustituye a las cajas y piramides de
// `addTrees()` en world.js (Minecraft con hojas) por troncos que afinan hacia
// arriba, ramas y una copa de bultos solapados con normales suaves -- lo que
// distingue una copa de follaje de un cristal facetado no es el numero de
// triangulos, es que la luz se degrade sobre ellos en vez de saltar de cara
// en cara.
//
// Con ~8500 arboles en el mapa NO se puede tener una geometria por arbol: se
// hornea un catalogo pequeno de arquetipos (encina y pino) y cada uno se pinta
// de una sola tacada con InstancedMesh, variando posicion/giro/escala/tono por
// instancia. El presupuesto de triangulos lo manda el numero de arquetipos y
// sus lados, no el numero de arboles.

// El verde va codificado en la RAZON G/R, y no es decoracion: el shader saca de
// ese solo numero si una hoja se apolva en agosto, si se pone ocre en noviembre y
// si se le queda la nieve encima. Los cuatro cajones estan separados de sobra:
//
//   tronco 0.74  ·  caduca 1.26-1.30  ·  perenne de hoja 1.48  ·  conifera 1.63+
//
const OAK_GREEN = [0.062, 0.092, 0.048];      // encina, 1.48
const MELOJO_GREEN = [0.070, 0.088, 0.040];   // melojo, 1.26 - caduca
const ASH_GREEN = [0.066, 0.086, 0.046];      // fresno, 1.30 - caduca
const PINE_GREEN = [0.046, 0.075, 0.044];     // pino, 1.63
const JUNIPER_GREEN = [0.038, 0.064, 0.036];  // enebro, 1.68
const BROOM_GREEN = [0.052, 0.095, 0.032];    // piorno, 1.83
const TRUNK_BROWN = [0.065, 0.048, 0.034];

const TAU = Math.PI * 2;
// Cuantos ejemplares distintos se hornean de cada especie. Con 4 ya no se lee la
// repeticion andando; el coste es geometria, no instancias.
const N_VAR = 4;

const fract = (x) => x - Math.floor(x);
const hash = (a, b) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1e-6; return [v[0] / l, v[1] / l, v[2] / l]; };

// xorshift32 determinista, igual criterio que world.js: mismo bosque en cada
// arranque. Aqui solo sirve para plantar los arquetipos, nunca para colocar
// arboles (eso lo decide `placements`, que ya viene determinista de fuera).
function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  return { randf: () => next() / 4294967296 };
}

// Acumulador de malla sin indices: posicion, normal y color por vertice.
// Copia reducida de la `Soup` de world.js -- este fichero no importa nada de
// world.js a proposito, solo `three`.
class Soup {
  constructor() { this.v = []; this.n = []; this.c = []; }

  // Cara con normal plana (madera: tronco y ramas quieren aristas duras).
  // `dentro` es un punto interior, para orientar la cara hacia fuera.
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

  // Cara con una normal distinta por vertice (follaje: la copa tiene que leer
  // como un volumen blando, no como un poliedro). El orden a,b,c ya viene
  // orientado hacia fuera por quien la llama.
  pushSmooth(a, b, c, na, nb, nc, col) {
    this.v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    for (let i = 0; i < 3; i++) this.c.push(col[0], col[1], col[2]);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.v, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// Tronco o rama: cilindro afinado de `p0` (radio r0) a `p1` (radio r1), con
// `sides` caras. Sin tapas -- el extremo de abajo se entierra en el suelo, el
// de arriba lo tapa la copa o el extremo de la rama siguiente.
function addFrustum(soup, p0, p1, r0, r1, sides, col) {
  const ax = norm(sub(p1, p0));
  const ref = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const right = norm(cross(ref, ax));
  const fwd = cross(ax, right);
  const dentro = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  const ring = (p, r) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = TAU * i / sides, c = Math.cos(a), s = Math.sin(a);
      pts.push([
        p[0] + (right[0] * c + fwd[0] * s) * r,
        p[1] + (right[1] * c + fwd[1] * s) * r,
        p[2] + (right[2] * c + fwd[2] * s) * r,
      ]);
    }
    return pts;
  };
  const r0pts = ring(p0, r0), r1pts = ring(p1, r1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    soup.tri(r0pts[i], r0pts[j], r1pts[i], dentro, col);
    soup.tri(r0pts[j], r1pts[j], r1pts[i], dentro, col);
  }
}

// Rotacion de Rodrigues sobre un eje aleatorio (determinista via `rng`).
// Cada bulto de copa gira distinto, asi las caras del octaedro nunca se
// alinean entre bultos vecinos y no se lee un diamante compuesto.
function randRot(rng) {
  const theta = rng.randf() * Math.PI, phi = rng.randf() * TAU, ang = rng.randf() * TAU;
  const axis = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return (v) => {
    const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
    const c = cross(axis, v);
    return [
      v[0] * ca + c[0] * sa + axis[0] * d * (1 - ca),
      v[1] * ca + c[1] * sa + axis[1] * d * (1 - ca),
      v[2] * ca + c[2] * sa + axis[2] * d * (1 - ca),
    ];
  };
}

const OCT_V = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const OCT_F = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];

// Bulto de follaje: octaedro (8 triangulos, barato) con radio de cada vertice
// tocado +-15% y una rotacion propia, sombreado con normal por vertice
// promediada entre las caras que lo comparten -- eso es lo que lo hace leer
// como una bola de hojas y no como un cristal. Un icosaedro se veria mas
// redondo todavia, pero al presupuesto pedido (8-14 bultos por arquetipo)
// esto ya rompe la silueta de piramide sin gastar el doble de triangulos.
function addBlob(soup, center, r, squashY, rot, rng, col) {
  const P = OCT_V.map((v) => {
    const jr = 0.85 + rng.randf() * 0.3;             // +-15% de radio, determinista
    const local = rot([v[0] * r * jr, v[1] * r * squashY * jr, v[2] * r * jr]);
    return [center[0] + local[0], center[1] + local[1], center[2] + local[2]];
  });
  const vN = P.map(() => [0, 0, 0]);
  const faces = [];
  for (const f of OCT_F) {
    let [i, j, k] = f;
    const a = P[i], b = P[j], c = P[k];
    let n = cross(sub(b, a), sub(c, a));
    const mx = (a[0] + b[0] + c[0]) / 3 - center[0];
    const my = (a[1] + b[1] + c[1]) / 3 - center[1];
    const mz = (a[2] + b[2] + c[2]) / 3 - center[2];
    if (n[0] * mx + n[1] * my + n[2] * mz < 0) { [j, k] = [k, j]; n = [-n[0], -n[1], -n[2]]; }
    n = norm(n);
    vN[i][0] += n[0]; vN[i][1] += n[1]; vN[i][2] += n[2];
    vN[j][0] += n[0]; vN[j][1] += n[1]; vN[j][2] += n[2];
    vN[k][0] += n[0]; vN[k][1] += n[1]; vN[k][2] += n[2];
    faces.push([i, j, k]);
  }
  for (let i = 0; i < vN.length; i++) vN[i] = norm(vN[i]);
  for (const [i, j, k] of faces) soup.pushSmooth(P[i], P[j], P[k], vN[i], vN[j], vN[k], col);
}

// Nube de bultos dentro de un elipsoide alrededor de `center`. `thetaMin/Max`
// acotan la elevacion (radianes) -- asi la encina puede rellenar por debajo
// del eje del tronco y el pino solo por encima. `conic` > 0 encoge el radio y
// el desplazamiento horizontal segun se sube en elevacion, para la copa en
// forma de sombrilla del pino; a 0 la nube es una bola irregular.
function addCanopy(soup, rng, center, Rx, Ry, Rz, n, thetaMin, thetaMax, rFracMin, rFracMax, conic, baseCol) {
  const span = thetaMax - thetaMin || 1;
  for (let i = 0; i < n; i++) {
    const theta = thetaMin + rng.randf() * span;
    const phi = rng.randf() * TAU;
    const d = 0.3 + rng.randf() * 0.7;
    const tap = 1 - conic * (theta - thetaMin) / span;
    const ct = Math.cos(theta), st = Math.sin(theta);
    const pos = [
      center[0] + Math.cos(phi) * ct * Rx * d * tap,
      center[1] + st * Ry * d,
      center[2] + Math.sin(phi) * ct * Rz * d * tap,
    ];
    const r = Rx * (rFracMin + rng.randf() * (rFracMax - rFracMin)) * tap;
    const squash = 0.75 + rng.randf() * 0.3;
    const tono = 0.78 + rng.randf() * 0.4;
    addBlob(soup, pos, r, squash, randRot(rng), rng, mul(baseCol, tono));
  }
}

// Las siete especies, cada una en una linea. Lo que las separa a ojo es la
// proporcion tronco/copa y donde empieza la copa, no el numero de triangulos:
//
//   encina   tronco corto y grueso, copa mas ancha que alta, empieza baja
//   melojo   el roble de esta ladera: mas alto que la encina y mas erguido, con
//            la copa irregular y el tronco torcido, que es como sale el rebollo
//   fresno   de vaguada: alto, delgado, copa estrecha y alta
//   resinero pino de media ladera, tronco largo y desnudo, copa en sombrilla
//   albar    el de arriba: mas estrecho y mas erguido que el resinero
//   enebro   matorral arboreo, casi sin tronco, muy oscuro y compacto
//   piorno   ni tronco ni copa: una mata baja. Es lo que hay por encima de 1700
//
// `blobs` es el presupuesto de bultos de la copa y por tanto casi todo el coste.
// Los del monte llevan menos que los del pueblo a proposito: a un kilometro no se
// distingue una copa de doce bultos de una de cinco, y son 15.000 arboles.
const ESPECIES = {
  encina: { trunkH: [2.3, 1.0], rBase: [0.34, 0.08], rMidF: 0.55, flare: 0.18,
    lean: 0.7, ramas: 4, ramaT: [0.35, 0.5], ramaR: [1.0, 0.8], ramaSube: [0.3, 0.5],
    crownY: 0.85, R: [2.3, 0.6], Ry: [1.5, 0.3], blobs: 12, theta: [-0.85, 1.05],
    rFrac: [0.32, 0.5], conic: 0, col: OAK_GREEN, lados: 6 },
  melojo: { trunkH: [3.4, 1.4], rBase: [0.30, 0.07], rMidF: 0.5, flare: 0.14,
    lean: 1.0, ramas: 4, ramaT: [0.45, 0.45], ramaR: [1.1, 0.9], ramaSube: [0.5, 0.7],
    crownY: 0.95, R: [2.1, 0.7], Ry: [1.8, 0.4], blobs: 11, theta: [-0.6, 1.15],
    rFrac: [0.30, 0.48], conic: 0, col: MELOJO_GREEN, lados: 6 },
  fresno: { trunkH: [5.0, 1.6], rBase: [0.24, 0.05], rMidF: 0.45, flare: 0.10,
    lean: 0.4, ramas: 3, ramaT: [0.6, 0.3], ramaR: [0.8, 0.6], ramaSube: [0.7, 0.6],
    crownY: 0.92, R: [1.7, 0.5], Ry: [2.0, 0.5], blobs: 10, theta: [-0.35, 1.2],
    rFrac: [0.28, 0.46], conic: 0.15, col: ASH_GREEN, lados: 5 },
  resinero: { trunkH: [6.5, 3.0], rBase: [0.22, 0.05], rMidF: 0.4, flare: 0.06,
    lean: 0.3, ramas: 3, ramaT: [0.55, 0.3], ramaR: [0.6, 0.4], ramaSube: [0.15, 0],
    crownY: 0.88, R: [1.5, 0.4], Ry: [1.2, 0.3], blobs: 10, theta: [-0.3, 1.2],
    rFrac: [0.30, 0.5], conic: 0.5, col: PINE_GREEN, lados: 5 },
  albar: { trunkH: [7.5, 3.0], rBase: [0.20, 0.04], rMidF: 0.38, flare: 0.05,
    lean: 0.2, ramas: 3, ramaT: [0.65, 0.25], ramaR: [0.5, 0.35], ramaSube: [0.2, 0],
    crownY: 0.90, R: [1.2, 0.3], Ry: [1.4, 0.3], blobs: 9, theta: [-0.15, 1.25],
    rFrac: [0.28, 0.46], conic: 0.6, col: PINE_GREEN, lados: 5 },
  enebro: { trunkH: [0.9, 0.5], rBase: [0.16, 0.05], rMidF: 0.6, flare: 0.2,
    lean: 0.4, ramas: 2, ramaT: [0.4, 0.4], ramaR: [0.4, 0.3], ramaSube: [0.3, 0.3],
    crownY: 1.4, R: [1.0, 0.35], Ry: [1.3, 0.35], blobs: 7, theta: [-0.5, 1.25],
    rFrac: [0.32, 0.5], conic: 0.35, col: JUNIPER_GREEN, lados: 5 },
  piorno: { trunkH: [0.25, 0.15], rBase: [0.10, 0.04], rMidF: 0.7, flare: 0.3,
    lean: 0.2, ramas: 0, ramaT: [0, 0], ramaR: [0, 0], ramaSube: [0, 0],
    crownY: 1.8, R: [0.85, 0.3], Ry: [0.5, 0.2], blobs: 6, theta: [-0.9, 0.9],
    rFrac: [0.38, 0.6], conic: 0, col: BROOM_GREEN, lados: 4 },
};

// El mismo constructor para las siete. Antes eran dos funciones casi identicas
// -buildEncina y buildPino- que solo se diferenciaban en los numeros; ahora los
// numeros estan en la tabla de arriba y esto es uno solo.
function buildArbol(esp, idx, barato = false) {
  const e = ESPECIES[esp];
  const soup = new Soup();
  const rng = rngFrom(idx * 9781 + 17 + esp.length * 733);

  const trunkH = e.trunkH[0] + rng.randf() * e.trunkH[1];
  const rBase = e.rBase[0] + rng.randf() * e.rBase[1];
  const rFlare = rBase * (1.5 + e.flare);
  const rMid = rBase * e.rMidF;
  const leanX = (rng.randf() - 0.5) * e.lean, leanZ = (rng.randf() - 0.5) * e.lean;
  const pFlare = [leanX * 0.15, trunkH * e.flare, leanZ * 0.15];
  const pTop = [leanX, trunkH, leanZ];
  addFrustum(soup, [0, 0, 0], pFlare, rFlare, rBase, e.lados, TRUNK_BROWN);
  addFrustum(soup, pFlare, pTop, rBase, rMid, e.lados, TRUNK_BROWN);

  const nRamas = barato ? 0 : e.ramas;
  for (let i = 0; i < nRamas; i++) {
    const t = e.ramaT[0] + rng.randf() * e.ramaT[1];
    const start = [
      pFlare[0] + (pTop[0] - pFlare[0]) * t,
      pFlare[1] + (pTop[1] - pFlare[1]) * t,
      pFlare[2] + (pTop[2] - pFlare[2]) * t,
    ];
    const az = TAU * i / nRamas + rng.randf() * 0.6;
    const reach = e.ramaR[0] + rng.randf() * e.ramaR[1];
    const end = [start[0] + Math.cos(az) * reach,
      start[1] + e.ramaSube[0] + rng.randf() * e.ramaSube[1],
      start[2] + Math.sin(az) * reach];
    addFrustum(soup, start, end, rMid * 0.55, rMid * 0.12, 3, TRUNK_BROWN);
  }

  const crownC = [pTop[0], trunkH * e.crownY, pTop[2]];
  const Rx = e.R[0] + rng.randf() * e.R[1], Rz = e.R[0] + rng.randf() * e.R[1];
  const Ry = e.Ry[0] + rng.randf() * e.Ry[1];
  // La copa del monte lleva dos tercios de bultos. A la mitad se veian las caras
  // del octaedro: desde abajo, una copa de cinco bultos gordos lee como cuatro
  // cuadrados pegados, y por el monte se anda igual que por el pueblo.
  const n = barato ? Math.max(5, Math.round(e.blobs * 0.65)) : e.blobs;
  addCanopy(soup, rng, crownC, Rx, Ry, Rz, n, e.theta[0], e.theta[1],
    e.rFrac[0], e.rFrac[1], e.conic, e.col);
  return soup.geometry();
}

// UN material para las nueve mallas, no uno por malla. Antes cada arquetipo se
// hacia el suyo, o sea nueve materiales y nueve programas compilados para pintar
// exactamente lo mismo.
//
// El problema de tintar por estacion es que el color va horneado por vertice
// -tronco y copa en la misma geometria- y el tinte por instancia ya esta gastado
// en luminosidad, a proposito, para no virar el tronco hacia verde. La salida es
// la que roofMaterial() ya usa para distinguir paja de teja: la PROPORCION G/R
// del color de vertice, que no cambia aunque se escale el brillo.
//
//   encina 0.092/0.062 = 1.48    pino 0.075/0.046 = 1.63    tronco = 0.74
//
// Separacion de sobra para sacar tres cosas distintas de un solo numero.
function materialArbol(uClima) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uClima = uClima;
    shader.vertexShader = 'varying vec3 vANorm;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vANorm = normalize(mat3(modelMatrix) * normal);
    `);
    shader.fragmentShader = 'uniform vec3 uClima;\nvarying vec3 vANorm;\n'
      + shader.fragmentShader;
    // DESPUES de <color_fragment>, no en <map_fragment>: es ahi donde three
    // multiplica por el color de vertice, y una mezcla puesta antes se borra
    // sola en cuanto llega esa multiplicacion.
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Cuatro cajones sacados de un solo numero, la razon G/R del color de
      // vertice: tronco 0.74, caduca 1.26-1.30, encina 1.48, conifera 1.63+.
      float razon = vColor.g / max(vColor.r, 1e-4);
      float esHoja = step(1.10, razon);
      float esCaduca = esHoja * (1.0 - step(1.38, razon));
      float esPino = step(1.55, razon);

      // La encina es PERENNIFOLIA y el pino tambien. Lo que les pasa al final del
      // verano seco es que la hoja queda polvorienta y grisacea: un desvio de
      // tono corto, no una defoliacion.
      float mustia = esHoja * (1.0 - esPino) * uClima.x;
      diffuseColor.rgb = mix(diffuseColor.rgb,
          diffuseColor.rgb * vec3(1.16, 1.06, 0.84), mustia);

      // Y el melojo SI se pone ocre, que es la estampa de La Herreria en
      // noviembre y la razon de que la gente suba a verlo. Aqui decia que en esta
      // sierra no hay otono de colores y era verdad mientras solo hubiera encinas
      // y pinos; con el melojar plantado deja de serlo. El rebollo ademas es
      // MARCESCENTE: se pone ocre y no suelta la hoja hasta la primavera, asi que
      // no hay rama pelada en enero.
      diffuseColor.rgb = mix(diffuseColor.rgb,
          vec3(0.098, 0.062, 0.024) * (0.85 + 0.4 * razon), esCaduca * uClima.z);

      // Nieve en la copa, solo en lo que mira hacia arriba. Un pinar nevado es
      // LA imagen del invierno en esta sierra y cuesta estas dos lineas.
      float cuajaA = esHoja * smoothstep(0.25, 0.8, vANorm.y)
                   * smoothstep(0.35, 0.8, uClima.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.61, 0.67), cuajaA * 0.85);
    `);
  };
  return mat;
}

// Una malla instanciada por arquetipo: color por vertice ya horneado en la
// geometria (tronco vs copa), tinte por instancia SOLO en luminosidad para no
// virar el tono del tronco hacia verde. Atributo crudo en vez de
// `setColorAt`: ese aplica conversion sRGB y aqui todo va en lineal, igual
// que el resto de world.js.
function instancedFromList(geo, list, name, mat) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  const cols = new Float32Array(list.length * 3);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    q.setFromAxisAngle(axisY, p.yaw);
    m.compose(pos.set(p.x, p.y, p.z), q, scl.set(p.esc, p.esc, p.esc));
    mesh.setMatrixAt(i, m);
    const f = 0.8 + p.tono * 0.5;      // mismo criterio que el resto del atrezzo
    cols[i * 3] = f; cols[i * 3 + 1] = f; cols[i * 3 + 2] = f;
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
  mesh.name = name;
  return mesh;
}

// placements: {x,y,z,yaw,esc,esp,epoca,barato,tono}. El ejemplar lo decide un
// hash de la posicion, no `tono` ni el orden de llegada: asi dos arboles vecinos
// casi nunca comparten silueta exacta aunque el bosque entero sea determinista.
//
// Antes de esto el arquetipo lo decidia un booleano `pinar`, o sea que el mundo
// entero era encina o pino. Ahora la especie viene decidida de fuera, en world.js,
// por cota y por solana, que es como se reparten de verdad en esta sierra.
export function crearArboleda(placements, uClima) {
  const mat = materialArbol(uClima);
  // Se hornea SOLO lo que se va a plantar. Las siete especies por dos calidades
  // por cuatro ejemplares serian 56 geometrias, y en una partida normal la mitad
  // no llega a usarse nunca.
  const cache = new Map();
  const geoDe = (esp, barato, k) => {
    const clave = `${esp}${barato ? 'M' : 'P'}${k}`;
    if (!cache.has(clave)) cache.set(clave, buildArbol(esp, k, barato));
    return cache.get(clave);
  };

  // Un cubo por (especie, calidad, ejemplar, epoca). La epoca es lo que permite
  // encender el melojar de 1570 o el pinar de hoy sin volver a plantar nada.
  const cubos = new Map();
  for (const p of placements) {
    const esp = p.esp || 'encina';
    const k = Math.min(N_VAR - 1, (hash(p.x * 0.91 + esp.length, p.z * 1.19) * N_VAR) | 0);
    const clave = `${esp}|${p.barato ? 1 : 0}|${k}|${p.epoca || 'comun'}`;
    if (!cubos.has(clave)) cubos.set(clave, []);
    cubos.get(clave).push(p);
  }

  const out = [];
  for (const [clave, lista] of cubos) {
    const [esp, barato, k, epoca] = clave.split('|');
    const m = instancedFromList(geoDe(esp, barato === '1', +k), lista,
      `${esp}${k}${barato === '1' ? '-monte' : ''}`, mat);
    m.userData.epoca = epoca;
    out.push(m);
  }
  return out;
}

