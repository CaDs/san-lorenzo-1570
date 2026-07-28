import * as THREE from 'three';

// Poblacion andante de San Lorenzo: vecinos por la red de calles, animales
// sueltos por el pueblo. Puerto libre, no viene de Godot (world.js si).
// Mismo sistema de coordenadas que world.js: X=Este, Z=Sur, Y=altitud, 1u=1m.
//
// Enfoque de rendimiento: un puñado de InstancedMesh (una por pieza de cuerpo:
// cabeza, torso, brazo izq/dcha, pierna izq/dcha, capa; y lo equivalente para
// cada animal), en vez de un Group por bicho. Así el coste de dibujar 60
// vecinos + ~50 animales son ~19 draw calls, no ~300. Solo se recalcula la
// matriz de instancia de lo que cae dentro de RANGE metros de la camara; lo
// de fuera se queda congelado con su ultima matriz (no hace falta que un
// pastor lejano se mueva si no se ve el detalle).

const RANGE = 120.0;
const RANGE2 = RANGE * RANGE;
const TAU = Math.PI * 2;

const N_VILLAGERS = 220;
const N_DOGS = 30;
const N_SHEEP = 60;
const N_CHICKENS = 70;
const N_BIRDS = 24;

// xorshift32 determinista, mismo estilo que rngFrom de world.js (no se
// importa: cada archivo tiene su propia copia, es media docena de lineas).
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

// Paleta lino/lana/cuero, en lineal (nunca cerca de 1.0: el juego tonemapea
// ACES al atardecer y un albedo claro se quema).
const SKIN = [0.19, 0.13, 0.10];
const LIMB = [0.085, 0.062, 0.045];
const CLOAK = [0.050, 0.045, 0.055];
const ROLES = ['aguador', 'herrero', 'fraile', 'pastora', 'panadera', 'cantero', 'pescadero', 'tejedora'];
const ROLE_COL = [
  [0.16, 0.14, 0.10], [0.11, 0.09, 0.08], [0.13, 0.12, 0.14],
  [0.18, 0.12, 0.09], [0.20, 0.16, 0.10], [0.12, 0.11, 0.10],
  [0.10, 0.13, 0.15], [0.17, 0.10, 0.08],
];
// Pelo: negro, castano, canoso, pelirrojo apagado. Multiplican al blanco del
// material, asi que son el color final.
const PELO = [
  [0.045, 0.035, 0.030], [0.075, 0.050, 0.032],
  [0.150, 0.140, 0.130], [0.110, 0.058, 0.030],
];
// Sombrero y apero por oficio, en el orden de ROLES. El fraile lleva capucha
// oscura; la pastora, cayado; el cantero, mazo.
const HAT_COL = [
  [0.10, 0.09, 0.07], [0.08, 0.07, 0.06], [0.055, 0.050, 0.048],
  [0.14, 0.11, 0.07], [0.16, 0.14, 0.10], [0.09, 0.08, 0.07],
  [0.10, 0.10, 0.11], [0.13, 0.09, 0.07],
];
const TOOL_COL = [
  [0.075, 0.055, 0.035], [0.055, 0.055, 0.060], [0.070, 0.050, 0.035],
  [0.085, 0.062, 0.040], [0.075, 0.055, 0.035], [0.060, 0.058, 0.058],
  [0.070, 0.052, 0.038], [0.080, 0.058, 0.038],
];
const HAT_P = [0.55, 0.35, 1.0, 0.85, 0.75, 0.65, 0.5, 0.6];
const TOOL_P = [0.9, 0.6, 0.15, 0.9, 0.35, 0.85, 0.5, 0.3];

const DOG_COL = [0.10, 0.075, 0.05];
const SHEEP_COL = [0.20, 0.19, 0.17];
const CHICKEN_COL = [0.21, 0.17, 0.12];
const BIRD_COL = [0.06, 0.06, 0.07];

// --- geometria de piezas -------------------------------------------------
// `translate` hornea el punto de giro dentro de la malla: si el pivote de una
// pierna tiene que quedar en la cadera, se corre la caja hacia abajo en la
// propia geometria y la matriz de instancia solo pone la cadera en su sitio
// y gira. Asi no hace falta un Group por hueso.
function box(w, h, d, ox = 0, oy = 0, oz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(ox, oy, oz);
  return g;
}

// Miembro o tronco: prisma de N lados que se estrecha de arriba abajo.
//
// Lo que hacia que los vecinos parecieran de Minecraft NO eran las
// proporciones -ya estaban en 6,5 cabezas- ni el numero de triangulos: eran las
// normales duras de BoxGeometry, que dan tres escalones planos de luz por
// miembro, y la seccion constante. CylinderGeometry ya trae las normales
// promediadas alrededor del cilindro, asi que no hace falta escribir nada:
// basta con dejar de usar cajas. Es la misma leccion que trees.js.
//
// `d` aplasta la seccion: un brazo es mas ancho que hondo, no un tubo.
function miembro(rArriba, rAbajo, h, lados, d = 1, ox = 0, oy = 0, oz = 0) {
  const g = new THREE.CylinderGeometry(rArriba, rAbajo, h, lados, 1);
  if (d !== 1) g.scale(1, 1, d);
  g.translate(ox, oy, oz);
  return g;
}

// Cono para sombreros y capuchas.
function cono(r, h, lados, ox = 0, oy = 0, oz = 0) {
  const g = new THREE.ConeGeometry(r, h, lados, 1);
  g.translate(ox, oy, oz);
  return g;
}

// --- vecino: proporciones -------------------------------------------------
const V_LEG_H = 0.85, V_LEG_W = 0.14, V_LEG_D = 0.16, V_HIP_X = 0.09;
const V_TORSO_W = 0.42, V_TORSO_H = 0.55, V_TORSO_D = 0.22;
const V_ARM_H = 0.52, V_ARM_W = 0.11, V_ARM_D = 0.13, V_SHO_X = 0.20;
const V_HEAD = 0.26;
const V_SHOULDER_Y = V_LEG_H + V_TORSO_H;      // 1.40
const V_TORSO_Y = V_LEG_H + V_TORSO_H * 0.5;   // 1.125
const V_HEAD_Y = V_SHOULDER_Y + 0.02 + V_HEAD * 0.5; // ~1.55
const V_CLOAK_H = 0.75, V_CLOAK_D = 0.06;

// --- perro: proporciones (cuadrupedo pequeno) -----------------------------
const D_LEG_H = 0.32, D_LEG_W = 0.07, D_LEG_D = 0.08, D_HIP_X = 0.09;
const D_BODY_W = 0.24, D_BODY_H = 0.26, D_BODY_L = 0.55;
const D_FRONT_Z = 0.20, D_BACK_Z = -0.20;
const D_BODY_Y = D_LEG_H + D_BODY_H * 0.5;
const D_HEAD = 0.18;

// --- oveja / cabra ---------------------------------------------------------
const S_BODY_W = 0.42, S_BODY_H = 0.48, S_BODY_L = 0.65, S_LEG_H = 0.42;
const S_BODY_Y = S_LEG_H + S_BODY_H * 0.5;
const S_NECK_Y = S_BODY_Y + S_BODY_H * 0.2;   // pivote del cabeceo al pacer
const S_HEAD = 0.20;

// --- gallina -----------------------------------------------------------
const C_BODY_W = 0.16, C_BODY_H = 0.18, C_BODY_L = 0.22, C_LEG_H = 0.12;
const C_BODY_Y = C_LEG_H + C_BODY_H * 0.5;
const C_NECK_Y = C_BODY_Y + C_BODY_H * 0.35;  // pivote del picoteo
const C_HEAD = 0.09;

// --- pajaro (silueta plana, solo se ve de lejos) ---------------------------
const B_BODY = 0.14, B_WING = 0.22;

// matrices y vectores de escritura, reusados en el bucle caliente
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function setInst(mesh, idx, x, y, z, yaw, tiltX = 0, tiltZ = 0, scale = 1) {
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _s.setScalar(scale);
  _m.compose(_p.set(x, y, z), _q, _s);
  mesh.setMatrixAt(idx, _m);
}

// Grafo de calles: nodos = vertices de world.data.roads, aristas = pares
// consecutivos. Los extremos que caen a menos de `cell` metros comparten
// nodo, asi tramos que en OSM son objetos distintos quedan conectados.
// Cada nodo tambien recuerda si toca una calle `r.l` (alumbrada/transitada):
// es lo que luego usa el reparto de vecinos para no esparcirlos por igual
// sobre todo el termino, sino apretarlos donde esta el pueblo de verdad.
function buildGraph(roads) {
  const cell = 4.0;
  const grid = new Map();
  const nodes = [];
  const adj = [];
  const key = (cx, cz) => cx * 100000 + cz;

  function findOrAdd(x, z) {
    const cx = Math.round(x / cell), cz = Math.round(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const l = grid.get(key(cx + dx, cz + dz));
        if (!l) continue;
        for (const i of l) {
          const ddx = nodes[i].x - x, ddz = nodes[i].z - z;
          if (ddx * ddx + ddz * ddz < cell * cell) return i;
        }
      }
    }
    const idx = nodes.length;
    nodes.push({ x, z, lit: false });
    adj.push([]);
    const k = key(cx, cz);
    let l = grid.get(k);
    if (!l) grid.set(k, l = []);
    l.push(idx);
    return idx;
  }

  for (const r of roads) {
    const flat = r.p;
    const n = flat.length / 2;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const idx = findOrAdd(flat[i * 2], flat[i * 2 + 1]);
      if (r.l) nodes[idx].lit = true;
      if (prev >= 0 && prev !== idx) {
        if (!adj[prev].includes(idx)) adj[prev].push(idx);
        if (!adj[idx].includes(prev)) adj[idx].push(prev);
      }
      prev = idx;
    }
  }

  return { nodes, adj };
}

// Centroide de un poligono de edificio (coordenadas planas x,z intercaladas).
function centroid(flat) {
  let cx = 0, cz = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) { cx += flat[i * 2]; cz += flat[i * 2 + 1]; }
  return [cx / n, cz / n];
}

// Cuantas casas hay a menos de R metros de un punto, con una rejilla de 20 m
// para no comparar cada nodo contra los 3545 edificios uno a uno. Sirve para
// distinguir el casco del pueblo (calle alumbrada Y rodeada de casas) de un
// camino de monte que tambien viene marcado `lit` en los datos pero por el
// que no vive nadie: r.l por si solo no basta, la mitad de los nodos de
// calle del mapa son "alumbrados" y estan repartidos por todo el termino.
function buildDensity(buildings) {
  const CELL = 20, R = 30;
  const grid = new Map();
  const key = (cx, cy) => cx * 100000 + cy;
  const cs = [];
  for (const b of buildings) {
    const [cx, cz] = centroid(b.p);
    cs.push(cx, cz);
    const k = key(Math.floor(cx / CELL), Math.floor(cz / CELL));
    let l = grid.get(k);
    if (!l) grid.set(k, l = []);
    l.push(cs.length / 2 - 1);
  }
  const span = Math.ceil(R / CELL) + 1;
  return (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let c = 0;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const l = grid.get(key(cx + dx, cz + dy));
        if (!l) continue;
        for (const i of l) {
          const bx = cs[i * 2], bz = cs[i * 2 + 1];
          if ((bx - x) * (bx - x) + (bz - z) * (bz - z) < R * R) c++;
        }
      }
    }
    return c;
  };
}

export class Vida {
  constructor(world) {
    this.world = world;
    const { nodes, adj } = buildGraph(world.data.roads);
    this.nodes = nodes;
    this.adj = adj;

    // Peso de arranque por nodo: calles alumbradas y con casas alrededor
    // pesan mucho mas (^1.5 para que el nucleo tire fuerte sin dejar el
    // termino vacio), las calles sin luz se quedan con un peso minimo fijo
    // -presencia real, pero minoritaria- en vez de cero.
    const density = buildDensity(world.data.buildings);
    this.nodeW = nodes.map((nd) => (nd.lit ? (density(nd.x, nd.z) + 1) ** 1.5 : 0.15));
    this.nodeWTotal = this.nodeW.reduce((a, b) => a + b, 0);

    this._objetos = [];
    this.ent = [];
    this._t = 0; // reloj de simulacion, lo actualiza update(); writeX() lo usa para el bamboleo

    this.buildVillagers();
    this.buildDogs();
    this.buildSheep();
    this.buildChickens();
    this.buildBirds();

    // Primera colocacion: todas las matrices, no solo las cercanas (la
    // camara aun no existe en el constructor).
    for (const w of this.villagers) this.writeVillager(w);
    for (const d of this.dogs) this.writeDog(d);
    for (const s of this.sheep) this.writeSheep(s);
    for (const c of this.chickens) this.writeChicken(c);
    for (const b of this.birds) this.writeBird(b);
    for (const mesh of this._objetos) mesh.instanceMatrix.needsUpdate = true;

    console.log(`vida: ${this.villagers.length} vecinos | ${this.dogs.length} perros`
      + ` | ${this.sheep.length} ovejas | ${this.chickens.length} gallinas`
      + ` | ${this.birds.length} pajaros | ${nodes.length} nodos de calle`);
  }

  get objetos() { return this._objetos; }

  // -- construccion ---------------------------------------------------

  addPart(mesh, name) {
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // se mueven por todo el pueblo; culling manual por RANGE ya recorta el update
    this._objetos.push(mesh);
    return mesh;
  }

  matPlain(col) {
    return new THREE.MeshLambertMaterial({ color: new THREE.Color(col[0], col[1], col[2]) });
  }

  // Nodo de arranque por ruleta ponderada con this.nodeW (ver constructor):
  // barrido lineal sobre ~6500 nodos, pero solo se llama una vez por bicho al
  // nacer (unos 250 en total), no en el bucle caliente, asi que no hace falta
  // busqueda binaria ni tabla de alias.
  pickSpawnNode(rng) {
    const target = rng.randf() * this.nodeWTotal;
    let acc = 0;
    for (let i = 0; i < this.nodeW.length; i++) {
      acc += this.nodeW[i];
      if (acc >= target) return i;
    }
    return this.nodeW.length - 1;
  }

  buildVillagers() {
    const n = N_VILLAGERS;
    const rng = rngFrom(4177);

    // Cabeza: mas ancha en el craneo que en la mandibula, con casquete de pelo.
    // A 60 px el nacimiento del pelo dice mas que cualquier cara pintada.
    this.vHead = this.addPart(new THREE.InstancedMesh(
      miembro(V_HEAD * 0.50, V_HEAD * 0.40, V_HEAD, 8, 0.92, 0, V_HEAD_Y, 0),
      this.matPlain(SKIN), n), 'VecinoCabeza');
    this.vHair = this.addPart(new THREE.InstancedMesh(
      miembro(V_HEAD * 0.46, V_HEAD * 0.53, V_HEAD * 0.42, 8, 0.94,
        0, V_HEAD_Y + V_HEAD * 0.32, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), n), 'VecinoPelo');
    // Torso: hombros anchos, cintura estrecha. La conicidad es lo que quita el
    // aire de armario ropero.
    this.vTorso = this.addPart(new THREE.InstancedMesh(
      miembro(V_TORSO_W * 0.50, V_TORSO_W * 0.38, V_TORSO_H, 8, 0.56, 0, V_TORSO_Y, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), n), 'VecinoTorso');
    // Brazos, piernas y capa giran (bamboleo del paso): el pivote de giro es
    // siempre el origen local de la geometria, asi que aqui solo va el
    // desplazamiento RELATIVO al hombro/cadera (lateral, y de frente-atras).
    // La altura absoluta del hombro/cadera se suma en writeVillager(), en la
    // posicion de la matriz, no en la geometria.
    // Muneca al 60 % del hombro, tobillo al 65 % del muslo.
    const brazo = (sx) => miembro(V_ARM_W * 0.5, V_ARM_W * 0.30, V_ARM_H, 6, 1.15,
      sx * V_SHO_X, -V_ARM_H * 0.5, 0);
    const pierna = (sx) => miembro(V_LEG_W * 0.5, V_LEG_W * 0.33, V_LEG_H, 6, 1.1,
      sx * V_HIP_X, -V_LEG_H * 0.5, 0);
    this.vArmL = this.addPart(new THREE.InstancedMesh(brazo(-1), this.matPlain(LIMB), n), 'VecinoBrazoI');
    this.vArmR = this.addPart(new THREE.InstancedMesh(brazo(1), this.matPlain(LIMB), n), 'VecinoBrazoD');
    this.vLegL = this.addPart(new THREE.InstancedMesh(pierna(-1), this.matPlain(LIMB), n), 'VecinoPiernaI');
    this.vLegR = this.addPart(new THREE.InstancedMesh(pierna(1), this.matPlain(LIMB), n), 'VecinoPiernaD');
    this.vCloak = this.addPart(new THREE.InstancedMesh(box(V_TORSO_W * 1.05, V_CLOAK_H, V_CLOAK_D, 0, -V_CLOAK_H * 0.5, -(V_TORSO_D * 0.5 + V_CLOAK_D * 0.5)), this.matPlain(CLOAK), n), 'VecinoCapa');
    // Sombrero y herramienta: escala 0 para quien no los lleve, el mismo truco
    // que ya usaba la capa. A 40 px un sombrero identifica el oficio mejor que
    // el cuerpo entero.
    this.vHat = this.addPart(new THREE.InstancedMesh(
      cono(V_HEAD * 0.60, V_HEAD * 0.46, 7, 0, V_HEAD_Y + V_HEAD * 0.46, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), n), 'VecinoSombrero');
    this.vTool = this.addPart(new THREE.InstancedMesh(
      box(0.045, 0.85, 0.045, V_SHO_X + 0.01, -0.24, 0.10),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), n), 'VecinoApero');

    // instanceColor: antes solo variaba el torso y los 220 vecinos compartian
    // piel, pelo, miembros y capa. Un ejercito de clones se nota.
    const colTorso = new Float32Array(n * 3);
    const colPelo = new Float32Array(n * 3);
    const colPiel = new Float32Array(n * 3);
    const colHat = new Float32Array(n * 3);
    const colTool = new Float32Array(n * 3);

    this.villagers = [];
    for (let i = 0; i < n; i++) {
      const role = rng.randi_range(0, ROLES.length - 1);
      colTorso.set(ROLE_COL[role], i * 3);
      const tono = 0.80 + rng.randf() * 0.42;      // moreno de sierra a mas claro
      colPiel.set([tono, tono * 0.98, tono * 0.96], i * 3);
      colPelo.set(PELO[rng.randi_range(0, PELO.length - 1)], i * 3);
      colHat.set(HAT_COL[role], i * 3);
      colTool.set(TOOL_COL[role], i * 3);
      const node = this.pickSpawnNode(rng);
      const w = {
        id: i, tipo: 'vecino', role,
        node, target: node, t: 0, prev: -1, paused: 0.4,
        speed: 1.15 + rng.randf() * 0.5,
        phase: rng.randf() * TAU,
        cloak: rng.randf() < 0.4 ? 1 : 0,
        // El fraile lleva capucha siempre; los demas, sombrero segun oficio.
        hat: (role === 2 || rng.randf() < HAT_P[role]) ? 1 : 0,
        tool: rng.randf() < TOOL_P[role] ? 1 : 0,
        // Estatura: setInst ya aceptaba `scale` y los vecinos no lo usaban.
        talla: 0.92 + rng.randf() * 0.15,
        pos: new THREE.Vector3(this.nodes[node].x, 0, this.nodes[node].z),
        yaw: rng.randf() * TAU,
        walking: 0,
        rng,
      };
      this.pickTarget(w);
      this.villagers.push(w);
      this.ent.push(w);
    }
    this.vTorso.instanceColor = new THREE.InstancedBufferAttribute(colTorso, 3);
    this.vHead.instanceColor = new THREE.InstancedBufferAttribute(colPiel, 3);
    this.vHair.instanceColor = new THREE.InstancedBufferAttribute(colPelo, 3);
    this.vHat.instanceColor = new THREE.InstancedBufferAttribute(colHat, 3);
    this.vTool.instanceColor = new THREE.InstancedBufferAttribute(colTool, 3);
  }

  buildDogs() {
    const n = N_DOGS;
    const rng = rngFrom(9931);
    const mat = this.matPlain(DOG_COL);
    this.dBody = this.addPart(new THREE.InstancedMesh(box(D_BODY_W, D_BODY_H, D_BODY_L, 0, D_BODY_Y, 0), mat, n), 'PerroCuerpo');
    this.dHead = this.addPart(new THREE.InstancedMesh(box(D_HEAD, D_HEAD, D_HEAD, 0, D_BODY_Y + D_BODY_H * 0.3, D_BODY_L * 0.5 + D_HEAD * 0.4), mat, n), 'PerroCabeza');
    // Igual que las piernas del vecino: geometria solo con el desplazamiento
    // relativo (lateral + adelante/atras), la altura del anca la pone
    // writeDog() en la posicion de la matriz, que es donde pivota el giro.
    this.dFL = this.addPart(new THREE.InstancedMesh(box(D_LEG_W, D_LEG_H, D_LEG_D, -D_HIP_X, -D_LEG_H * 0.5, D_FRONT_Z), mat, n), 'PerroPataDI');
    this.dFR = this.addPart(new THREE.InstancedMesh(box(D_LEG_W, D_LEG_H, D_LEG_D, D_HIP_X, -D_LEG_H * 0.5, D_FRONT_Z), mat, n), 'PerroPataDD');
    this.dBL = this.addPart(new THREE.InstancedMesh(box(D_LEG_W, D_LEG_H, D_LEG_D, -D_HIP_X, -D_LEG_H * 0.5, D_BACK_Z), mat, n), 'PerroPataTI');
    this.dBR = this.addPart(new THREE.InstancedMesh(box(D_LEG_W, D_LEG_H, D_LEG_D, D_HIP_X, -D_LEG_H * 0.5, D_BACK_Z), mat, n), 'PerroPataTD');

    this.dogs = [];
    for (let i = 0; i < n; i++) {
      // Mismo reparto ponderado que los vecinos: al pesar por casas
      // cercanas, los perros de pueblo salen ya agrupados junto a las
      // fachadas sin necesitar una regla aparte.
      const node = this.pickSpawnNode(rng);
      const d = {
        id: i, tipo: 'perro',
        node, target: node, t: 0, prev: -1, paused: 0.2,
        speed: 2.2 + rng.randf() * 1.0,
        phase: rng.randf() * TAU,
        pos: new THREE.Vector3(this.nodes[node].x, 0, this.nodes[node].z),
        yaw: rng.randf() * TAU,
        walking: 0,
        rng,
      };
      this.pickTarget(d);
      this.dogs.push(d);
      this.ent.push(d);
    }
  }

  // Punto libre de casas y calles cerca de `cx,cz`, con reintentos. Se usa
  // para ovejas (dehesa) y gallinas (junto a las casas).
  freeNear(cx, cz, radius, rng, tries) {
    for (let k = 0; k < tries; k++) {
      const x = cx + (rng.randf() - 0.5) * 2 * radius;
      const z = cz + (rng.randf() - 0.5) * 2 * radius;
      if (this.world.freeAround(x, z)) return [x, z];
    }
    return null;
  }

  buildSheep() {
    const n = N_SHEEP;
    const rng = rngFrom(5531);
    const mat = this.matPlain(SHEEP_COL);
    this.sBody = this.addPart(new THREE.InstancedMesh(box(S_BODY_W, S_BODY_H, S_BODY_L, 0, S_BODY_Y, 0), mat, n), 'OvejaCuerpo');
    // La cabeza cabecea (tiltX): pivote en el cuello, no en el suelo, igual
    // que brazos/piernas del vecino. Solo lleva el offset relativo.
    this.sHead = this.addPart(new THREE.InstancedMesh(box(S_HEAD, S_HEAD, S_HEAD, 0, 0, S_BODY_L * 0.5 + S_HEAD * 0.3), mat, n), 'OvejaCabeza');

    const sx = this.world.data.size_m[0], sz = this.world.data.size_m[1];
    this.sheep = [];
    for (let i = 0; i < n; i++) {
      // ponytail: en vez de buscar dehesa real, se sortea el mapa entero y se
      // filtra con freeAround (deja fuera casas y calles); techo: si hiciera
      // falta agruparlas en un prado concreto, sembrar cerca de un punto fijo.
      let home = null;
      for (let t = 0; t < 40 && !home; t++) {
        home = this.freeNear(rng.randf() * sx, rng.randf() * sz, 1, rng, 1);
      }
      if (!home) home = [sx * 0.5, sz * 0.5];
      const s = {
        id: i, tipo: 'oveja',
        home, pos: new THREE.Vector3(home[0], 0, home[1]),
        target: [home[0], home[1]], t: 1, paused: rng.randf() * 4,
        speed: 0.35 + rng.randf() * 0.2,
        phase: rng.randf() * TAU,
        yaw: rng.randf() * TAU,
        walking: 0,
        rng,
      };
      this.sheep.push(s);
      this.ent.push(s);
    }
  }

  buildChickens() {
    const n = N_CHICKENS;
    const rng = rngFrom(6103);
    const mat = this.matPlain(CHICKEN_COL);
    this.cBody = this.addPart(new THREE.InstancedMesh(box(C_BODY_W, C_BODY_H, C_BODY_L, 0, C_BODY_Y, 0), mat, n), 'GallinaCuerpo');
    this.cHead = this.addPart(new THREE.InstancedMesh(box(C_HEAD, C_HEAD, C_HEAD, 0, 0, C_BODY_L * 0.5 + C_HEAD * 0.3), mat, n), 'GallinaCabeza');

    const bs = this.world.data.buildings;
    this.chickens = [];
    for (let i = 0; i < n; i++) {
      const b = bs[rng.randi_range(0, bs.length - 1)];
      const [cx, cz] = centroid(b.p);
      let home = this.freeNear(cx, cz, 4, rng, 20) || [cx, cz];
      const c = {
        id: i, tipo: 'gallina',
        home, pos: new THREE.Vector3(home[0], 0, home[1]),
        target: [home[0], home[1]], t: 1, paused: rng.randf() * 2,
        speed: 0.5 + rng.randf() * 0.3,
        phase: rng.randf() * TAU,
        yaw: rng.randf() * TAU,
        walking: 0,
        rng,
      };
      this.chickens.push(c);
      this.ent.push(c);
    }
  }

  buildBirds() {
    const n = N_BIRDS;
    const rng = rngFrom(7717);
    const mat = this.matPlain(BIRD_COL);
    this.bBody = this.addPart(new THREE.InstancedMesh(box(B_BODY * 0.4, B_BODY * 0.3, B_BODY, 0, 0, 0), mat, n), 'PajaroCuerpo');
    this.bWingL = this.addPart(new THREE.InstancedMesh(box(B_WING, 0.02, B_BODY * 0.5, -B_WING * 0.5, 0, 0), mat, n), 'PajaroAlaI');
    this.bWingR = this.addPart(new THREE.InstancedMesh(box(B_WING, 0.02, B_BODY * 0.5, B_WING * 0.5, 0, 0), mat, n), 'PajaroAlaD');

    const bs = this.world.data.buildings;
    this.birds = [];
    for (let i = 0; i < n; i++) {
      const b = bs[rng.randi_range(0, bs.length - 1)];
      const [cx, cz] = centroid(b.p);
      const bd = {
        id: i, tipo: 'pajaro',
        cx, cz, r: 6 + rng.randf() * 7, h: (b.t || 0) + 5 + rng.randf() * 4,
        a: rng.randf() * TAU, speed: 0.4 + rng.randf() * 0.3,
        phase: rng.randf() * TAU,
        pos: new THREE.Vector3(cx, 0, cz),
        yaw: 0,
        rng,
      };
      this.birds.push(bd);
      this.ent.push(bd);
    }
  }

  // -- grafo: caminar de nodo en nodo ----------------------------------

  pickTarget(w) {
    const neigh = this.adj[w.node];
    if (neigh.length === 0) { w.target = w.node; w.t = 0; return; }
    let choices = neigh.filter((x) => x !== w.prev);
    if (choices.length === 0) choices = neigh;
    w.prev = w.node;
    w.target = choices[w.rng.randi_range(0, choices.length - 1)];
    w.t = 0;
  }

  stepGraphWalker(w, dt, pauseChance, pauseMax) {
    if (w.paused > 0) {
      w.paused -= dt;
      if (w.paused <= 0) this.pickTarget(w);
    } else {
      const a = this.nodes[w.node], b = this.nodes[w.target];
      const dx = b.x - a.x, dz = b.z - a.z;
      const dist = Math.hypot(dx, dz) || 1;
      w.t += (w.speed * dt) / dist;
      if (w.t >= 1) {
        w.t = 1;
        w.node = w.target;
        if (w.rng.randf() < pauseChance) w.paused = 0.5 + w.rng.randf() * pauseMax;
        else this.pickTarget(w);
      }
    }
    const a = this.nodes[w.node], b = this.nodes[w.target];
    const x = a.x + (b.x - a.x) * w.t, z = a.z + (b.z - a.z) * w.t;
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx * dx + dz * dz > 1e-6) w.yaw = Math.atan2(dx, dz);
    w.pos.x = x; w.pos.z = z;
    w.walking = w.paused <= 0 ? 1 : 0;
  }

  // Deambular libre para ovejas y gallinas: sin grafo, un punto objetivo a
  // poca distancia de `home`, con pausas para pacer/picotear.
  stepWander(w, dt, radius, pauseMax) {
    if (w.paused > 0) {
      w.paused -= dt;
      if (w.paused <= 0) {
        const p = this.freeNear(w.home[0], w.home[1], radius, w.rng, 6) || w.home;
        w.target = p; w.t = 0;
      }
      return;
    }
    const dx = w.target[0] - w.pos.x, dz = w.target[1] - w.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) { w.paused = w.rng.randf() * pauseMax; w.walking = 0; return; }
    const step = Math.min(dist, w.speed * dt);
    w.pos.x += (dx / dist) * step;
    w.pos.z += (dz / dist) * step;
    w.yaw = Math.atan2(dx, dz);
    w.walking = 1;
  }

  // -- escritura de matrices --------------------------------------------

  writeVillager(w) {
    const world = this.world;
    const y0 = world.heightAt(w.pos.x, w.pos.z);
    const amp = w.walking ? 0.55 : 0;
    const ph = w.phase + this._t;
    // Andar de persona, no de muneco: las piernas mandan, los brazos van al
    // 40 % y desfasados, y el cuerpo bota un poco al doble de frecuencia
    // -es el paso, cada zancada sube y baja-. Antes era un solo seno con
    // brazos y piernas a la misma amplitud, que es lo que delata a un
    // automata a cualquier distancia.
    const swP = Math.sin(ph) * amp;                    // piernas
    const swB = Math.sin(ph - 0.45) * amp * 0.40;      // brazos
    const bote = w.walking ? Math.abs(Math.sin(ph)) * 0.025 : 0;
    const y = y0 + bote;
    const t = w.talla;

    setInst(this.vHead, w.id, w.pos.x, y, w.pos.z, w.yaw, 0, 0, t);
    setInst(this.vHair, w.id, w.pos.x, y, w.pos.z, w.yaw, 0, 0, t);
    setInst(this.vTorso, w.id, w.pos.x, y, w.pos.z, w.yaw, 0, 0, t);
    setInst(this.vHat, w.id, w.pos.x, y, w.pos.z, w.yaw, 0, 0, w.hat ? t : 0);
    // Brazos y capa giran desde el hombro, piernas desde la cadera: la
    // posicion de la matriz es el pivote real, la geometria solo trae el
    // desplazamiento lateral (ver comentario en buildVillagers).
    const hombro = y + V_SHOULDER_Y * t, cadera = y + V_LEG_H * t;
    setInst(this.vArmL, w.id, w.pos.x, hombro, w.pos.z, w.yaw, -swB, 0, t);
    setInst(this.vArmR, w.id, w.pos.x, hombro, w.pos.z, w.yaw, swB, 0, t);
    setInst(this.vLegL, w.id, w.pos.x, cadera, w.pos.z, w.yaw, swP, 0, t);
    setInst(this.vLegR, w.id, w.pos.x, cadera, w.pos.z, w.yaw, -swP, 0, t);
    setInst(this.vCloak, w.id, w.pos.x, hombro, w.pos.z, w.yaw, swB * 0.5, 0,
      w.cloak ? t : 0);
    // El apero cuelga del brazo derecho y se mueve con el.
    setInst(this.vTool, w.id, w.pos.x, hombro, w.pos.z, w.yaw, swB, 0,
      w.tool ? t : 0);
    w.pos.y = y0;
  }

  writeDog(d) {
    const world = this.world;
    const y = world.heightAt(d.pos.x, d.pos.z);
    const amp = d.walking ? 0.6 : 0;
    const ph = d.phase + this._t * 2.2;
    const s1 = Math.sin(ph) * amp, s2 = -s1;
    setInst(this.dBody, d.id, d.pos.x, y, d.pos.z, d.yaw);
    setInst(this.dHead, d.id, d.pos.x, y, d.pos.z, d.yaw);
    setInst(this.dFL, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s1);
    setInst(this.dBR, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s1);
    setInst(this.dFR, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s2);
    setInst(this.dBL, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s2);
    d.pos.y = y;
  }

  writeSheep(s) {
    const world = this.world;
    const y = world.heightAt(s.pos.x, s.pos.z);
    // sin patas animadas (ponytail: quietas, pastando; si algun dia hace
    // falta el paso habria que anadir el mismo InstancedMesh de patas del perro)
    const graze = s.walking ? 0 : 0.35 + 0.1 * Math.sin(this._t * 1.3 + s.phase);
    setInst(this.sBody, s.id, s.pos.x, y, s.pos.z, s.yaw);
    setInst(this.sHead, s.id, s.pos.x, y + S_NECK_Y, s.pos.z, s.yaw, graze);
    s.pos.y = y;
  }

  writeChicken(c) {
    const world = this.world;
    const y = world.heightAt(c.pos.x, c.pos.z);
    const peck = c.walking ? 0 : Math.max(0, Math.sin(this._t * 5 + c.phase)) * 0.9;
    setInst(this.cBody, c.id, c.pos.x, y, c.pos.z, c.yaw);
    setInst(this.cHead, c.id, c.pos.x, y + C_NECK_Y, c.pos.z, c.yaw, peck);
    c.pos.y = y;
  }

  writeBird(b) {
    const y = b.h + Math.sin(this._t * 0.7 + b.phase) * 0.6;
    const flap = Math.sin(this._t * 9 + b.phase) * 0.5;
    setInst(this.bBody, b.id, b.pos.x, y, b.pos.z, b.yaw);
    setInst(this.bWingL, b.id, b.pos.x, y, b.pos.z, b.yaw, 0, flap);
    setInst(this.bWingR, b.id, b.pos.x, y, b.pos.z, b.yaw, 0, -flap);
    b.pos.y = y;
  }

  // -- bucle principal ----------------------------------------------------

  update(dt, t, camPos) {
    this._t = t;
    let nV = 0, nD = 0, nS = 0, nC = 0, nB = 0;

    for (const w of this.villagers) {
      const dx = w.pos.x - camPos.x, dz = w.pos.z - camPos.z, dy = w.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      this.stepGraphWalker(w, dt, 0.3, 3.0);
      this.writeVillager(w);
      nV++;
    }
    for (const d of this.dogs) {
      const dx = d.pos.x - camPos.x, dz = d.pos.z - camPos.z, dy = d.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      this.stepGraphWalker(d, dt, 0.15, 1.5);
      this.writeDog(d);
      nD++;
    }
    for (const s of this.sheep) {
      const dx = s.pos.x - camPos.x, dz = s.pos.z - camPos.z, dy = s.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      this.stepWander(s, dt, 6, 5);
      this.writeSheep(s);
      nS++;
    }
    for (const c of this.chickens) {
      const dx = c.pos.x - camPos.x, dz = c.pos.z - camPos.z, dy = c.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      this.stepWander(c, dt, 3, 3);
      this.writeChicken(c);
      nC++;
    }
    for (const b of this.birds) {
      const dx = b.pos.x - camPos.x, dz = b.pos.z - camPos.z;
      if (dx * dx + dz * dz > RANGE2) continue;
      b.a += b.speed * dt / Math.max(b.r, 1);
      b.pos.x = b.cx + Math.cos(b.a) * b.r;
      b.pos.z = b.cz + Math.sin(b.a) * b.r;
      b.yaw = Math.atan2(-Math.sin(b.a), Math.cos(b.a));
      this.writeBird(b);
      nB++;
    }

    // Se marca sucio por GRUPO, no todo. La bandera en si es barata, pero lo
    // que cuesta es lo que dispara: three vuelve a subir el buffer entero de
    // matrices a la GPU. Con 220 vecinos de 7 piezas son ~100 KB por
    // fotograma regalados cuando no hay nadie cerca y no se ha movido nada.
    if (!this._grupos) {
      this._grupos = { Vecino: [], Perro: [], Oveja: [], Gallina: [], Pajaro: [] };
      for (const m of this._objetos) {
        for (const k of Object.keys(this._grupos)) {
          if (m.name.startsWith(k)) this._grupos[k].push(m);
        }
      }
    }
    const marcar = (lista) => {
      for (const m of lista) m.instanceMatrix.needsUpdate = true;
    };
    if (nV) marcar(this._grupos.Vecino);
    if (nD) marcar(this._grupos.Perro);
    if (nS) marcar(this._grupos.Oveja);
    if (nC) marcar(this._grupos.Gallina);
    if (nB) marcar(this._grupos.Pajaro);
  }

  // El primero que caiga dentro de maxDist, para el dialogo del jugador.
  // Barrido lineal sobre this.ent (~400 entidades con los conteos actuales):
  // cuesta lo mismo con maxDist=3.5 que con maxDist=1000, es un dot product
  // y una comparacion por bicho, no una consulta espacial. No hace falta
  // rejilla aqui salvo que ent crezca a miles.
  cercano(pos, maxDist = 3.5) {
    let best = null, bestD = maxDist * maxDist;
    for (const e of this.ent) {
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z, dy = e.pos.y - pos.y;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return null;
    return this.ficha(best);
  }

  // Ficha de una entidad para quien la vaya a hacer hablar. Antes esto devolvia
  // solo {id, tipo, nombre, pos} y el oficio habia que adivinarlo buscando la
  // palabra dentro de `nombre`; ahora va suelto y con el id numerico, que es lo
  // que usan los dialogos para elegir frase de forma estable.
  ficha(e) {
    const nombre = e.tipo === 'vecino' ? cap(ROLES[e.role])
      : e.tipo === 'perro' ? 'Perro'
      : e.tipo === 'oveja' ? 'Oveja'
      : e.tipo === 'gallina' ? 'Gallina' : 'Pajaro';
    return {
      id: `${e.tipo}${e.id}`,
      num: e.id,
      tipo: e.tipo,
      role: e.role,
      oficio: e.tipo === 'vecino' ? ROLES[e.role] : e.tipo,
      nombre,
      pos: e.pos,
    };
  }

  // El vecino VIVO de ese oficio mas cercano a un punto. Como andan por el
  // pueblo, la indicacion que da un vecino apunta a donde esta el otro ahora,
  // no a donde aparecio al cargar la partida.
  buscarOficio(oficio, pos) {
    const r = ROLES.indexOf(oficio);
    if (r < 0) return null;
    let best = null, bestD = Infinity;
    for (const v of this.villagers) {
      if (v.role !== r) continue;
      const d = (v.pos.x - pos.x) ** 2 + (v.pos.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best ? this.ficha(best) : null;
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
