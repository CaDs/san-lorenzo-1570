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

const OAK_GREEN = [0.062, 0.092, 0.048];
const PINE_GREEN = [0.046, 0.075, 0.044];
const TRUNK_BROWN = [0.065, 0.048, 0.034];

const TAU = Math.PI * 2;
const N_OAK = 5;    // encina: 4-6 pedidos, con 5 ya rompe la repeticion a ojo
const N_PINE = 4;

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

// Encina: tronco corto y grueso con ensanche de raiz, copa densa que empieza
// baja (mas ancha que alta -- la encina real es asi, no una pina vertical).
function buildEncina(idx) {
  const soup = new Soup();
  const rng = rngFrom(idx * 9781 + 17);

  const trunkH = 2.3 + rng.randf() * 1.0;
  const rBase = 0.34 + rng.randf() * 0.08;
  const rFlare = rBase * 1.55;                        // ensanche de raiz
  const rMid = rBase * 0.55;
  const flareH = trunkH * 0.18;
  const leanX = (rng.randf() - 0.5) * 0.7, leanZ = (rng.randf() - 0.5) * 0.7;
  const pFlare = [leanX * 0.15, flareH, leanZ * 0.15];
  const pTop = [leanX, trunkH, leanZ];
  addFrustum(soup, [0, 0, 0], pFlare, rFlare, rBase, 6, TRUNK_BROWN);
  addFrustum(soup, pFlare, pTop, rBase, rMid, 6, TRUNK_BROWN);

  for (let i = 0; i < 4; i++) {                       // 4 ramas, arrancan bajas
    const t = 0.35 + rng.randf() * 0.5;
    const start = [
      pFlare[0] + (pTop[0] - pFlare[0]) * t,
      pFlare[1] + (pTop[1] - pFlare[1]) * t,
      pFlare[2] + (pTop[2] - pFlare[2]) * t,
    ];
    const az = TAU * i / 4 + rng.randf() * 0.6;
    const reach = 1.0 + rng.randf() * 0.8;
    const end = [start[0] + Math.cos(az) * reach, start[1] + 0.3 + rng.randf() * 0.5, start[2] + Math.sin(az) * reach];
    addFrustum(soup, start, end, rMid * 0.55, rMid * 0.12, 3, TRUNK_BROWN);
  }

  const crownC = [pTop[0], trunkH * 0.85, pTop[2]];
  const Rx = 2.3 + rng.randf() * 0.6, Rz = 2.3 + rng.randf() * 0.6, Ry = 1.5 + rng.randf() * 0.3;
  addCanopy(soup, rng, crownC, Rx, Ry, Rz, 12, -0.85, 1.05, 0.32, 0.5, 0, OAK_GREEN);
  return soup.geometry();
}

// Pino: tronco recto y alto, desnudo hasta el tercio superior, copa estrecha
// y algo conica -- forma de sombrilla, nunca la bola de la encina.
function buildPino(idx) {
  const soup = new Soup();
  const rng = rngFrom(idx * 3413 + 51);

  const trunkH = 6.5 + rng.randf() * 3.0;
  const rBase = 0.22 + rng.randf() * 0.05;
  const rFlare = rBase * 1.5;
  const rMid = rBase * 0.4;
  const flareH = trunkH * 0.06;
  const leanX = (rng.randf() - 0.5) * 0.3, leanZ = (rng.randf() - 0.5) * 0.3;
  const pFlare = [leanX * 0.1, flareH, leanZ * 0.1];
  const pTop = [leanX, trunkH, leanZ];
  addFrustum(soup, [0, 0, 0], pFlare, rFlare, rBase, 5, TRUNK_BROWN);
  addFrustum(soup, pFlare, pTop, rBase, rMid, 5, TRUNK_BROWN);

  for (let i = 0; i < 3; i++) {                       // ramas solo en el tercio alto
    const t = 0.55 + rng.randf() * 0.3;
    const start = [
      pFlare[0] + (pTop[0] - pFlare[0]) * t,
      pFlare[1] + (pTop[1] - pFlare[1]) * t,
      pFlare[2] + (pTop[2] - pFlare[2]) * t,
    ];
    const az = TAU * i / 3 + rng.randf() * 0.6;
    const reach = 0.6 + rng.randf() * 0.4;
    const end = [start[0] + Math.cos(az) * reach, start[1] + 0.15, start[2] + Math.sin(az) * reach];
    addFrustum(soup, start, end, rMid * 0.5, rMid * 0.1, 3, TRUNK_BROWN);
  }

  const crownC = [pTop[0], trunkH * 0.88, pTop[2]];
  const Rx = 1.5 + rng.randf() * 0.4, Rz = 1.5 + rng.randf() * 0.4, Ry = 1.2 + rng.randf() * 0.3;
  addCanopy(soup, rng, crownC, Rx, Ry, Rz, 10, -0.3, 1.2, 0.30, 0.5, 0.5, PINE_GREEN);
  return soup.geometry();
}

// Una malla instanciada por arquetipo: color por vertice ya horneado en la
// geometria (tronco vs copa), tinte por instancia SOLO en luminosidad para no
// virar el tono del tronco hacia verde. Atributo crudo en vez de
// `setColorAt`: ese aplica conversion sRGB y aqui todo va en lineal, igual
// que el resto de world.js.
function instancedFromList(geo, list, name) {
  const mesh = new THREE.InstancedMesh(
    geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
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

// placements: {x,y,z,yaw,esc,pinar,tono}. El arquetipo lo decide un hash de
// la posicion, no `tono` ni el orden de llegada: asi dos arboles vecinos casi
// nunca comparten silueta exacta aunque el bosque entero sea determinista.
export function crearArboleda(placements) {
  const oakGeo = Array.from({ length: N_OAK }, (_, i) => buildEncina(i));
  const pineGeo = Array.from({ length: N_PINE }, (_, i) => buildPino(i));
  const oakList = Array.from({ length: N_OAK }, () => []);
  const pineList = Array.from({ length: N_PINE }, () => []);

  for (const p of placements) {
    if (p.pinar) {
      pineList[Math.min(N_PINE - 1, (hash(p.x * 1.31, p.z * 0.77) * N_PINE) | 0)].push(p);
    } else {
      oakList[Math.min(N_OAK - 1, (hash(p.x * 0.91, p.z * 1.19) * N_OAK) | 0)].push(p);
    }
  }

  const out = [];
  oakGeo.forEach((g, i) => { if (oakList[i].length) out.push(instancedFromList(g, oakList[i], `Encina${i}`)); });
  pineGeo.forEach((g, i) => { if (pineList[i].length) out.push(instancedFromList(g, pineList[i], `Pino${i}`)); });
  return out;
}
