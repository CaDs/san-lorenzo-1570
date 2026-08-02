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

// 220 sobre 3,6 km2 con el filtro de 120 m dejaban el pueblo casi deshabitado:
// en la calle mas concurrida se cruzaba uno cada veinte segundos. San Lorenzo en
// 1570 es una obra con miles de peones alrededor de un caserio, o sea justo lo
// contrario. Con 460 y el peso de arranque mucho mas cargado al nucleo, el centro
// tiene gente y el termino no se queda vacio.
const N_VILLAGERS = 460;
// Y los del monte: pastores y cabreros que no pisan el pueblo. No andan por el
// grafo de calles -alli arriba no hay calles-, sino a la querencia de su rebano.
const N_PASTORES = 16;
// El rey usa la ultima ranura de la malla de vecinos.
const IDX_REY = N_VILLAGERS + N_PASTORES;
const N_DOGS = 30;
const N_SHEEP = 96;
const N_CHICKENS = 70;
const N_CATS = 34;
const N_COWS = 40;
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
// Indices de ROLES con nombre de mujer. Es la misma particion que FEMENINO en
// tramas.js, dicha en indices porque aqui el oficio se guarda como numero.
const FEM_ROL = new Set([3, 4, 7]);
// Nombre de pila, del santoral que se usaba aqui en el XVI. Hace falta porque un
// encargo puede pedir que vuelvas con QUIEN te lo dio, y "Cantero" lo llevan 27
// de los 220: sin nombre, el objetivo lo cierra el primero con el mismo sombrero.
const NOMBRES = [
  ['Bartolome', 'Anton', 'Rodrigo', 'Gil', 'Pedro', 'Lucas', 'Cristobal',
    'Sancho', 'Diego', 'Alonso', 'Martin', 'Bernardo', 'Tomas', 'Blas',
    'Andres', 'Julian'],
  ['Catalina', 'Ines', 'Mencia', 'Juana', 'Beatriz', 'Ursula', 'Marina',
    'Isabel', 'Aldonza', 'Leonor', 'Teresa', 'Brigida'],
];
// Segundo apellido de andar por casa, para que no haya dos del mismo oficio con
// el mismo nombre: 27 canteros no caben en 16 nombres. Con esto caben 96.
const APODOS = [
  ['', 'el Mozo', 'el Viejo', 'de Abantos', 'el Tuerto', 'de la Fuente'],
  ['', 'la Moza', 'la Vieja', 'de Abantos', 'la Roja', 'de la Fuente'],
];

// `k` es el numero de orden DENTRO del oficio, no el id global: asi el reparto
// de nombres se agota oficio por oficio y no se repite ninguno entre canteros.
function nombreDe(role, k) {
  const g = FEM_ROL.has(role) ? 1 : 0;
  const pila = NOMBRES[g][k % NOMBRES[g].length];
  const apodo = APODOS[g][Math.floor(k / NOMBRES[g].length) % APODOS[g].length];
  const n = apodo ? `${pila} ${apodo}` : pila;
  return role === 2 ? `fray ${n}` : n;      // 2 = fraile
}
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

// El rey viste de negro con la gorguera blanca. En lineal y sin llegar al cero
// absoluto: un negro puro se come el relieve y a la luz de la luna es una silueta
// plana. Y el blanco, lejos del 1.0, que el juego tonemapea ACES y se quemaria.
const REY_NEGRO = [0.030, 0.028, 0.034];
const REY_BLANCO = [0.62, 0.61, 0.58];
// El perro de la leyenda es negro. Multiplica al color de perro, asi que va bajo.
const PERRO_NEGRO = 0.22;

const DOG_COL = [0.10, 0.075, 0.05];
const SHEEP_COL = [0.20, 0.19, 0.17];
const CHICKEN_COL = [0.21, 0.17, 0.12];
const BIRD_COL = [0.06, 0.06, 0.07];
// Gato de pueblo: pardo, atigrado, negro y blanco sucio. Multiplican al color
// base, que es el del material.
const CAT_COL = [0.13, 0.10, 0.075];
const CAT_TONO = [
  [1.0, 1.0, 1.0], [0.55, 0.55, 0.6], [1.35, 1.25, 1.15], [0.30, 0.28, 0.30],
];
// Vaca serrana: parda oscura, y alguna berrenda.
const COW_COL = [0.115, 0.075, 0.050];
const COW_TONO = [
  [1.0, 1.0, 1.0], [0.62, 0.55, 0.52], [1.30, 1.20, 1.10], [0.85, 0.88, 0.92],
];

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

// --- gato (mas bajo y mas largo que el perro, y con rabo) -------------------
const T_LEG_H = 0.16, T_LEG_W = 0.045, T_LEG_D = 0.05, T_HIP_X = 0.055;
const T_BODY_W = 0.13, T_BODY_H = 0.14, T_BODY_L = 0.34;
const T_FRONT_Z = 0.12, T_BACK_Z = -0.12;
const T_BODY_Y = T_LEG_H + T_BODY_H * 0.5;
const T_HEAD = 0.11;
// El rabo tieso es lo que hace que un bulto de cuatro cajas se lea como gato.
const T_TAIL_H = 0.26, T_TAIL_W = 0.035;

// --- vaca ------------------------------------------------------------------
const W_LEG_H = 0.72, W_LEG_W = 0.13, W_LEG_D = 0.14, W_HIP_X = 0.20;
const W_BODY_W = 0.62, W_BODY_H = 0.76, W_BODY_L = 1.55;
const W_FRONT_Z = 0.55, W_BACK_Z = -0.55;
const W_BODY_Y = W_LEG_H + W_BODY_H * 0.5;
const W_HEAD = 0.34;
const W_NECK_Y = W_BODY_Y + W_BODY_H * 0.12;

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

// El grafo se suelda a 4 m, y en OSM hay finales de calle que se quedan a cinco
// o a ocho de la siguiente: no es que no se pase, es que nadie puso el nodo. Eso
// dejaba trozos de calle aislados donde los vecinos entraban y no salian, y
// donde `buscarOficio` podia mandarte a hablar con alguien que no llega nunca.
//
// Se cosen solo los huecos CORTOS y solo si entre los dos puntos no hay
// edificio: coser de mas seria abrir un atajo a traves de una casa, que es peor
// que dejar el trozo suelto. Los huecos largos -de quince metros para arriba- se
// dejan como estan, que esos si son calles separadas de verdad.
const COSER_MAX = 11.0;

function coserTrozos(nodes, adj, world) {
  const grupo = new Array(nodes.length).fill(-1);
  const grupos = [];
  for (let i = 0; i < nodes.length; i++) {
    if (grupo[i] >= 0) continue;
    const g = grupos.length, pila = [i], miembros = [];
    grupo[i] = g;
    while (pila.length) {
      const v = pila.pop();
      miembros.push(v);
      for (const u of adj[v]) if (grupo[u] < 0) { grupo[u] = g; pila.push(u); }
    }
    grupos.push(miembros);
  }
  if (grupos.length < 2) return 0;

  // Del mas pequeno al mas grande: se cose cada trozo al primero que le quede a
  // tiro, sin volver a calcular los grupos. Con catorce trozos no hace falta
  // mas finura.
  grupos.sort((a, b) => a.length - b.length);
  let cosidos = 0;
  for (let k = 0; k < grupos.length - 1; k++) {
    const gr = grupos[k];
    let mejor = COSER_MAX, a = -1, b = -1;
    for (const i of gr) {
      for (let j = 0; j < nodes.length; j++) {
        if (grupo[j] === grupo[i]) continue;
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        if (d >= mejor) continue;
        if (world.hayEdificioEntre(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z)) continue;
        mejor = d; a = i; b = j;
      }
    }
    if (a < 0) continue;
    adj[a].push(b);
    adj[b].push(a);
    const viejo = grupo[a], nuevo = grupo[b];
    for (let i = 0; i < grupo.length; i++) if (grupo[i] === viejo) grupo[i] = nuevo;
    cosidos++;
  }
  if (cosidos) console.log(`calles: ${cosidos} trozos sueltos cosidos a la red`);
  return cosidos;
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
    coserTrozos(nodes, adj, world);

    // Peso de arranque por nodo: calles alumbradas y con casas alrededor
    // pesan mucho mas (^1.5 para que el nucleo tire fuerte sin dejar el
    // termino vacio), las calles sin luz se quedan con un peso minimo fijo
    // -presencia real, pero minoritaria- en vez de cero.
    const density = buildDensity(world.data.buildings);
    // ^2.4 en vez de ^1.5. Con 1.5 los 460 vecinos salian bastante repartidos por
    // todo el termino y el centro no se notaba; el exponente es lo unico que
    // decide cuanto tira el nucleo, y subirlo concentra sin dejar el resto vacio.
    this.nodeW = nodes.map((nd) => (nd.lit ? (density(nd.x, nd.z) + 1) ** 2.4 : 0.15));
    this.nodeWTotal = this.nodeW.reduce((a, b) => a + b, 0);

    this._objetos = [];
    this.ent = [];
    this._t = 0; // reloj de simulacion, lo actualiza update(); writeX() lo usa para el bamboleo
    // Que fraccion del vecindario anda por la calle. Lo baja el tiempo que hace,
    // desde main.js. A 1 estan todos fuera, que es como nacio esto.
    this.fuera = 1;

    this.buildVillagers();
    this.buildDogs();
    this.buildRey();
    this.buildSheep();
    this.buildCats();
    this.buildCows();
    this.buildChickens();
    this.buildBirds();
    this.buildSenal();

    // Primera colocacion: todas las matrices, no solo las cercanas (la
    // camara aun no existe en el constructor).
    for (const w of this.villagers) this.writeVillager(w);
    for (const d of this.dogs) this.writeDog(d);
    for (const s of this.sheep) this.writeSheep(s);
    for (const c of this.cats) this.writeCat(c);
    for (const c of this.cows) this.writeCow(c);
    for (const c of this.chickens) this.writeChicken(c);
    for (const b of this.birds) this.writeBird(b);
    for (const mesh of this._objetos) mesh.instanceMatrix.needsUpdate = true;

    console.log(`vida: ${this.villagers.length} vecinos | ${this.dogs.length} perros`
      + ` | ${this.cats.length} gatos | ${this.cows.length} vacas`
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
    // Una instancia mas que vecinos: la ultima es el rey, que usa el mismo
    // cuerpo pero con sus colores y siempre con capa y sombrero. Sale mas corto
    // que darle mallas propias y ademas se mueve con el mismo writeVillager().
    // Vecinos + pastores del monte + el rey, que va el ultimo.
    const n = N_VILLAGERS + N_PASTORES + 1;
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
    const porOficio = new Array(ROLES.length).fill(0);   // para repartir nombres
    for (let i = 0; i < N_VILLAGERS; i++) {
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
        nombre: nombreDe(role, porOficio[role]++),
        // Orden en el que se meten en casa cuando llueve o hiela. Fijo por
        // vecino y sacado del mismo rng, para que sean siempre los mismos.
        calle: rng.randf(),
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

    // --- los del monte -----------------------------------------------------
    //
    // Pastores y cabreros, arriba, donde no hay calles. Usan el mismo cuerpo y el
    // mismo dialogo -o sea que se les puede hablar y dan encargos como cualquier
    // vecino- pero no andan por el grafo: se mueven a la querencia de un punto
    // fijo, que es su majada, igual que las ovejas.
    //
    // El sitio se sortea en un anillo alrededor del pueblo y se acepta solo si
    // esta fuera del casco, por encima de los 1050 m y en cuesta llevadera: un
    // pastor en un roquedo de 40 grados no es un pastor, es un accidente.
    this.pastores = [];
    if (this.world.sierra) {
      const W = this.world;
      for (let k = 0; k < N_PASTORES; k++) {
        const i = N_VILLAGERS + k;
        let sitio = null;
        for (let t = 0; t < 200 && !sitio; t++) {
          const ang = rng.randf() * TAU;
          const r = 600 + rng.randf() * 1500;
          const x = 1800 + Math.cos(ang) * r, z = 1050 + Math.sin(ang) * r;
          if (W.dentroDelCasco(x, z) > -40) continue;
          const y = W.heightAt(x, z);
          if (y < 1050 || y > 1650) continue;
          if (W.normalAt(x, z)[1] < 0.80) continue;
          sitio = [x, z];
        }
        if (!sitio) continue;
        // 3 = pastora. Es el oficio que el juego ya tiene para esto, con sus
        // frases y sus encargos.
        const role = 3;
        colTorso.set(ROLE_COL[role], i * 3);
        const tono = 0.80 + rng.randf() * 0.42;
        colPiel.set([tono, tono * 0.98, tono * 0.96], i * 3);
        colPelo.set(PELO[rng.randi_range(0, PELO.length - 1)], i * 3);
        colHat.set(HAT_COL[role], i * 3);
        colTool.set(TOOL_COL[role], i * 3);
        const w = {
          id: i, tipo: 'vecino', role, monte: true,
          nombre: nombreDe(role, porOficio[role]++),
          // Arriba no se meten en casa: no la tienen a mano. `calle` a 0 los deja
          // fuera con cualquier tiempo, que es lo que hace un pastor.
          calle: 0,
          home: sitio, target: [sitio[0], sitio[1]], t: 1, paused: rng.randf() * 5,
          speed: 0.7 + rng.randf() * 0.4,
          phase: rng.randf() * TAU,
          cloak: 1,                       // arriba hace frio siempre
          hat: 1,
          tool: 1,                        // el cayado
          talla: 0.92 + rng.randf() * 0.15,
          pos: new THREE.Vector3(sitio[0], 0, sitio[1]),
          yaw: rng.randf() * TAU,
          walking: 0,
          rng,
        };
        this.pastores.push(w);
        this.villagers.push(w);
        this.ent.push(w);
      }
    }
    // El rey, en la ultima instancia. De negro entero, que es como vestia y como
    // se le pinta siempre; el contraste lo pone la gorguera, que va en su propia
    // malla porque no hay ninguna pieza del vecino que sirva de cuello.
    colTorso.set(REY_NEGRO, IDX_REY * 3);
    colPiel.set([0.86, 0.84, 0.80], IDX_REY * 3);    // palido, y a la luna mas
    colPelo.set([0.055, 0.045, 0.040], IDX_REY * 3);
    colHat.set(REY_NEGRO, IDX_REY * 3);
    colTool.set([0, 0, 0], IDX_REY * 3);             // no lleva apero

    this.vTorso.instanceColor = new THREE.InstancedBufferAttribute(colTorso, 3);
    this.vHead.instanceColor = new THREE.InstancedBufferAttribute(colPiel, 3);
    this.vHair.instanceColor = new THREE.InstancedBufferAttribute(colPelo, 3);
    this.vHat.instanceColor = new THREE.InstancedBufferAttribute(colHat, 3);
    this.vTool.instanceColor = new THREE.InstancedBufferAttribute(colTool, 3);

    // La gorguera: un disco blanco justo bajo la barbilla. Es lo unico claro que
    // lleva encima y por eso se le reconoce de lejos.
    this.vGorguera = this.addPart(new THREE.InstancedMesh(
      miembro(V_HEAD * 0.62, V_HEAD * 0.62, 0.07, 10, 1,
        0, V_HEAD_Y - V_HEAD * 0.52, 0),
      this.matPlain(REY_BLANCO), 1), 'ReyGorguera');
  }

  // El rey y su perro.
  //
  // No es de ningun encargo y no da ninguno: solo se aparece, y si se le habla
  // contesta con acertijos. Sale de MEDIANOCHE a las dos, que es cuando la
  // leyenda pone al perro negro aullando entre los andamios de la obra -a ese lo
  // atraparia el padre Villacastin la noche del 21 de junio de 1577, siete anos
  // despues de esto, y resulto ser el sabueso perdido del marques de las Navas-.
  //
  // Anda por la lonja y el entorno del Monasterio y no por todo el pueblo: no
  // usa el grafo de calles, sino un paseo corto alrededor de un punto, que es lo
  // que hace un hombre que sale a dar vueltas y no uno que va a algun sitio.
  buildRey() {
    const rng = rngFrom(1527);        // el ano en que nacio
    const c = this.lonja();
    this.rey = {
      id: IDX_REY, tipo: 'rey', role: -1, nombre: 'El hombre de negro',
      centro: c, pos: new THREE.Vector3(c.x, 0, c.z),
      destino: null, paused: 0, speed: 0.9, phase: 0, yaw: 0, walking: 0,
      talla: 1.02, hat: 1, cloak: 1, tool: 0, calle: -1, rng,
    };
    this.perroRey = {
      id: N_DOGS, tipo: 'perronegro', nombre: 'Un perro negro',
      pos: new THREE.Vector3(c.x + 1.5, 0, c.z), yaw: 0, walking: 0,
      phase: 0, rng,
    };
    this.ent.push(this.rey, this.perroRey);
  }

  // Centro del paseo: delante del Monasterio. Se saca de la huella mas grande,
  // igual que hace world.js para saber cual es el Monasterio.
  lonja() {
    let mejor = null, area = -1;
    for (const b of this.world.data.buildings) {
      const f = b.p;
      let a = 0;
      for (let i = 0; i < f.length; i += 2) {
        const j = (i + 2) % f.length;
        a += f[i] * f[j + 1] - f[j] * f[i + 1];
      }
      a = Math.abs(a) * 0.5;
      if (a > area) { area = a; mejor = b; }
    }
    if (!mejor) return { x: 1215, z: 1390 };
    let cz = 0, minX = Infinity;
    const n = mejor.p.length / 2;
    for (let i = 0; i < mejor.p.length; i += 2) {
      minX = Math.min(minX, mejor.p[i]);
      cz += mejor.p[i + 1];
    }
    // A PONIENTE de la huella, que es donde esta la lonja: la explanada llana y
    // libre de edificios delante de la fachada principal, la misma en la que
    // aparece el jugador. Al sur del centro, ademas, que es de donde se lee la
    // fachada entera en perspectiva en vez de como un muro.
    return { x: minX - 40, z: cz / n + 63 };
  }

  buildDogs() {
    // Una mas: el perro del rey. Comparten malla y material, asi que el negro
    // se consigue con color por instancia -antes no habia ninguno y los 30
    // perros del pueblo eran el mismo perro-.
    const n = N_DOGS + 1;
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

    // Todos a 1 (el color del material) menos el ultimo, que es el negro.
    const colPerro = new Float32Array(n * 3).fill(1);
    colPerro.set([PERRO_NEGRO, PERRO_NEGRO, PERRO_NEGRO * 1.1], N_DOGS * 3);
    for (const m of [this.dBody, this.dHead, this.dFL, this.dFR, this.dBL, this.dBR]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(colPerro, 3);
    }

    this.dogs = [];
    for (let i = 0; i < N_DOGS; i++) {
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

  // Gatos. Andan por el grafo de calles como los perros, pero mas despacio y
  // parandose mas: un gato de pueblo no va a ninguna parte con prisa. Mismo
  // esqueleto de cajas que el perro, mas bajo y mas largo, y con el rabo tieso,
  // que es lo que hace que cuatro cajas se lean como gato y no como perro chico.
  buildCats() {
    const n = N_CATS;
    const rng = rngFrom(7717);
    const mat = this.matPlain(CAT_COL);
    this.tBody = this.addPart(new THREE.InstancedMesh(box(T_BODY_W, T_BODY_H, T_BODY_L, 0, T_BODY_Y, 0), mat, n), 'GatoCuerpo');
    this.tHead = this.addPart(new THREE.InstancedMesh(box(T_HEAD, T_HEAD, T_HEAD, 0, T_BODY_Y + T_BODY_H * 0.25, T_BODY_L * 0.5 + T_HEAD * 0.35), mat, n), 'GatoCabeza');
    this.tTail = this.addPart(new THREE.InstancedMesh(box(T_TAIL_W, T_TAIL_H, T_TAIL_W, 0, T_TAIL_H * 0.5, -T_BODY_L * 0.5), mat, n), 'GatoRabo');
    const pata = (sx, sz) => box(T_LEG_W, T_LEG_H, T_LEG_D, sx * T_HIP_X, -T_LEG_H * 0.5, sz);
    this.tFL = this.addPart(new THREE.InstancedMesh(pata(-1, T_FRONT_Z), mat, n), 'GatoPataDI');
    this.tFR = this.addPart(new THREE.InstancedMesh(pata(1, T_FRONT_Z), mat, n), 'GatoPataDD');
    this.tBL = this.addPart(new THREE.InstancedMesh(pata(-1, T_BACK_Z), mat, n), 'GatoPataTI');
    this.tBR = this.addPart(new THREE.InstancedMesh(pata(1, T_BACK_Z), mat, n), 'GatoPataTD');

    const col = new Float32Array(n * 3);
    this.cats = [];
    for (let i = 0; i < n; i++) {
      col.set(CAT_TONO[rng.randi_range(0, CAT_TONO.length - 1)], i * 3);
      const node = this.pickSpawnNode(rng);
      const c = {
        id: i, tipo: 'gato',
        node, target: node, t: 0, prev: -1, paused: rng.randf() * 6,
        speed: 1.1 + rng.randf() * 0.7,
        phase: rng.randf() * TAU,
        pos: new THREE.Vector3(this.nodes[node].x, 0, this.nodes[node].z),
        yaw: rng.randf() * TAU,
        walking: 0,
        rng,
      };
      this.cats.push(c);
      this.ent.push(c);
    }
    for (const m of [this.tBody, this.tHead, this.tTail, this.tFL, this.tFR, this.tBL, this.tBR]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    }
  }

  // Vacas. Pastan en el campo, no en la calle: se siembran lejos de cualquier
  // fachada, que es lo que las saca del casco sin tener que buscar prados en los
  // datos. Llevan patas, al contrario que las ovejas: a este tamano una vaca sin
  // patas es un armario en un prado.
  buildCows() {
    const n = N_COWS;
    const rng = rngFrom(3313);
    const mat = this.matPlain(COW_COL);
    // Cuerpo y cabeza en prisma tumbado, no en caja. Es la misma leccion que ya
    // esta escrita arriba para los vecinos y para los arboles: lo que hace que
    // un bicho parezca de Minecraft no son las proporciones, son las normales
    // duras de BoxGeometry, que dan tres escalones planos de luz. En un perro de
    // medio metro se perdona; en una vaca de metro y medio, no. Las patas siguen
    // siendo cajas: a ese grosor no se distingue y sale mas barato.
    const tumbado = (g) => { g.rotateX(Math.PI / 2); return g; };
    this.wBody = this.addPart(new THREE.InstancedMesh(
      tumbado(miembro(W_BODY_W * 0.5, W_BODY_W * 0.46, W_BODY_L, 8,
        W_BODY_H / W_BODY_W)).translate(0, W_BODY_Y, 0), mat, n), 'VacaCuerpo');
    this.wHead = this.addPart(new THREE.InstancedMesh(
      tumbado(miembro(W_HEAD * 0.36, W_HEAD * 0.5, W_HEAD * 1.3, 6, 0.85))
        .translate(0, 0, W_BODY_L * 0.5 + W_HEAD * 0.4), mat, n), 'VacaCabeza');
    const pata = (sx, sz) => box(W_LEG_W, W_LEG_H, W_LEG_D, sx * W_HIP_X, -W_LEG_H * 0.5, sz);
    this.wFL = this.addPart(new THREE.InstancedMesh(pata(-1, W_FRONT_Z), mat, n), 'VacaPataDI');
    this.wFR = this.addPart(new THREE.InstancedMesh(pata(1, W_FRONT_Z), mat, n), 'VacaPataDD');
    this.wBL = this.addPart(new THREE.InstancedMesh(pata(-1, W_BACK_Z), mat, n), 'VacaPataTI');
    this.wBR = this.addPart(new THREE.InstancedMesh(pata(1, W_BACK_Z), mat, n), 'VacaPataTD');

    const sx = this.world.data.size_m[0], sz = this.world.data.size_m[1];
    const col = new Float32Array(n * 3);
    this.cows = [];
    for (let i = 0; i < n; i++) {
      col.set(COW_TONO[rng.randi_range(0, COW_TONO.length - 1)], i * 3);
      // Un prado es sitio libre CON sitio libre alrededor. Se sondea un anillo
      // de ocho puntos a 35 m y se exige que todos esten despejados: sin eso las
      // vacas salen en los corrales del casco viejo, que no es donde pasta una
      // vaca. No vale `chocaEdificio(x, z, 35)`, que solo mira las nueve celdas
      // de diez metros de alrededor y se le escapa lo que hay a treinta y cinco.
      let home = null;
      for (let t = 0; t < 80 && !home; t++) {
        const x = rng.randf() * sx, z = rng.randf() * sz;
        if (!this.world.freeAround(x, z)) continue;
        let despejado = true;
        for (let k = 0; k < 8 && despejado; k++) {
          const a = k * TAU / 8;
          despejado = this.world.freeAround(x + Math.cos(a) * 35, z + Math.sin(a) * 35);
        }
        if (despejado) home = [x, z];
      }
      if (!home) home = this.freeNear(sx * 0.5, sz * 0.5, 60, rng, 20) || [sx * 0.5, sz * 0.5];
      const c = {
        id: i, tipo: 'vaca',
        home, pos: new THREE.Vector3(home[0], 0, home[1]),
        target: [home[0], home[1]], t: 1, paused: rng.randf() * 8,
        speed: 0.28 + rng.randf() * 0.16,
        phase: rng.randf() * TAU,
        yaw: rng.randf() * TAU,
        walking: 0,
        rng,
      };
      this.cows.push(c);
      this.ent.push(c);
    }
    for (const m of [this.wBody, this.wHead, this.wFL, this.wFR, this.wBL, this.wBR]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    }
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
      // Un tercio del rebano sube al monte, con su pastor. Un pastor sin ovejas
      // es un hombre parado en una ladera, y era exactamente lo que se veia.
      let home = null;
      const conPastor = this.pastores && this.pastores.length && i % 3 === 0;
      if (conPastor) {
        const pas = this.pastores[(i / 3 | 0) % this.pastores.length];
        home = [pas.home[0] + (rng.randf() - 0.5) * 34,
          pas.home[1] + (rng.randf() - 0.5) * 34];
      }
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

  // La senal que va sobre la cabeza de quien espera el encargo.
  //
  // Con 476 vecinos por la calle, "vuelve con Anton el cantero" es un problema de
  // buscar a Wally: el nombre esta escrito abajo pero delante hay doce sombreros
  // iguales. Un cono dorado que gira despacio resuelve los ultimos veinte metros,
  // que es donde de verdad se pierde el tiempo.
  //
  // Va como InstancedMesh de una sola instancia, y no como Mesh, porque el
  // constructor recorre `_objetos` marcando `instanceMatrix.needsUpdate` y un
  // Mesh pelado no lo tiene. Una instancia no cuesta nada y encaja con todo lo
  // que ya hay montado.
  //
  // MeshBasicMaterial a proposito: no lo toca la luz. Una senal que se apaga de
  // noche no es una senal, y de noche es cuando mas falta hace distinguir a
  // alguien entre doce siluetas oscuras.
  buildSenal() {
    const g = new THREE.ConeGeometry(0.17, 0.34, 4);
    g.rotateX(Math.PI);                       // la punta, hacia la cabeza
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.72, 0.28),
      fog: false,                              // se ve igual de lejos y con niebla
    });
    this.senal = this.addPart(new THREE.InstancedMesh(g, m, 1), 'Senal');
    // Ni proyecta ni recibe: es un simbolo, no un objeto del pueblo.
    this.senal.castShadow = false;
    this.senal.receiveShadow = false;
    // A quien senalar. Lo pone quests.js cada fotograma; null la apaga.
    this.senalado = null;
  }

  // -- escritura de matrices --------------------------------------------

  // `dentro` = se ha metido en casa por el tiempo que hace: se escribe bajo el
  // terreno en vez de dejarlo quieto a la vista.
  writeVillager(w, dentro = false) {
    const world = this.world;
    const y0 = world.heightAt(w.pos.x, w.pos.z) - (dentro ? 4 : 0);
    const amp = w.walking && !dentro ? 0.55 : 0;
    const ph = w.phase + this._t;
    // Andar de persona, no de muneco: las piernas mandan, los brazos van al
    // 40 % y desfasados, y el cuerpo bota un poco al doble de frecuencia
    // -es el paso, cada zancada sube y baja-. Antes era un solo seno con
    // brazos y piernas a la misma amplitud, que es lo que delata a un
    // automata a cualquier distancia.
    const swP = Math.sin(ph) * amp;                    // piernas
    const swB = Math.sin(ph - 0.45) * amp * 0.40;      // brazos
    const bote = w.walking && !dentro ? Math.abs(Math.sin(ph)) * 0.025 : 0;
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

  writeDog(d, dentro = false) {
    const world = this.world;
    const y = world.heightAt(d.pos.x, d.pos.z) - (dentro ? 4 : 0);
    const amp = d.walking && !dentro ? 0.6 : 0;
    const ph = d.phase + this._t * 2.2;
    const s1 = Math.sin(ph) * amp, s2 = -s1;
    setInst(this.dBody, d.id, d.pos.x, y, d.pos.z, d.yaw);
    setInst(this.dHead, d.id, d.pos.x, y, d.pos.z, d.yaw);
    setInst(this.dFL, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s1);
    setInst(this.dBR, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s1);
    setInst(this.dFR, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s2);
    setInst(this.dBL, d.id, d.pos.x, y + D_LEG_H, d.pos.z, d.yaw, s2);
    if (!dentro) d.pos.y = y;
  }

  writeCat(c) {
    const y = this.world.heightAt(c.pos.x, c.pos.z);
    const amp = c.walking ? 0.55 : 0;
    const ph = c.phase + this._t * 3.2;
    const s1 = Math.sin(ph) * amp, s2 = -s1;
    setInst(this.tBody, c.id, c.pos.x, y, c.pos.z, c.yaw);
    setInst(this.tHead, c.id, c.pos.x, y, c.pos.z, c.yaw);
    // El rabo ondea aunque el gato este quieto, que es la mitad de lo que hace
    // un gato quieto.
    setInst(this.tTail, c.id, c.pos.x, y + T_BODY_Y, c.pos.z, c.yaw,
      -0.35 + 0.18 * Math.sin(this._t * 1.9 + c.phase), 0);
    setInst(this.tFL, c.id, c.pos.x, y + T_LEG_H, c.pos.z, c.yaw, s1);
    setInst(this.tBR, c.id, c.pos.x, y + T_LEG_H, c.pos.z, c.yaw, s1);
    setInst(this.tFR, c.id, c.pos.x, y + T_LEG_H, c.pos.z, c.yaw, s2);
    setInst(this.tBL, c.id, c.pos.x, y + T_LEG_H, c.pos.z, c.yaw, s2);
    c.pos.y = y;
  }

  writeCow(c) {
    const y = this.world.heightAt(c.pos.x, c.pos.z);
    const amp = c.walking ? 0.38 : 0;
    const ph = c.phase + this._t * 1.5;
    const s1 = Math.sin(ph) * amp, s2 = -s1;
    // Pastando baja la cabeza casi al suelo; andando la lleva alta.
    const pace = c.walking ? 0 : 0.62 + 0.08 * Math.sin(this._t * 0.7 + c.phase);
    setInst(this.wBody, c.id, c.pos.x, y, c.pos.z, c.yaw);
    setInst(this.wHead, c.id, c.pos.x, y + W_NECK_Y, c.pos.z, c.yaw, pace);
    setInst(this.wFL, c.id, c.pos.x, y + W_LEG_H, c.pos.z, c.yaw, s1);
    setInst(this.wBR, c.id, c.pos.x, y + W_LEG_H, c.pos.z, c.yaw, s1);
    setInst(this.wFR, c.id, c.pos.x, y + W_LEG_H, c.pos.z, c.yaw, s2);
    setInst(this.wBL, c.id, c.pos.x, y + W_LEG_H, c.pos.z, c.yaw, s2);
    c.pos.y = y;
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

  // -- el rey ---------------------------------------------------------------

  // De medianoche a las dos. Fuera de esa franja no esta: no se aleja ni se
  // desvanece, sencillamente no ha estado nunca.
  get horaDelRey() {
    const h = this.hora;
    return h >= 0 && h < 2;
  }

  stepRey(dt) {
    const r = this.rey, d = this.perroRey;
    const RADIO = 55;
    if (r.paused > 0) {
      r.paused -= dt;
      r.walking = 0;
    } else if (!r.destino) {
      // Otro punto del paseo, dentro del radio. Un rey que sale a dar vueltas
      // no va a ningun sitio: va y vuelve. Se descartan los puntos que caen
      // dentro de un edificio: aparecerse es una cosa y atravesar la fachada del
      // Monasterio es otra, y la segunda se lee como un fallo, no como leyenda.
      for (let intento = 0; intento < 8 && !r.destino; intento++) {
        const a = r.rng.randf() * TAU, rad = 12 + r.rng.randf() * RADIO;
        const x = r.centro.x + Math.cos(a) * rad;
        const z = r.centro.z + Math.sin(a) * rad;
        if (!this.world.chocaEdificio(x, z, 0.8)) r.destino = { x, z };
      }
      if (!r.destino) r.paused = 2;      // rodeado: se queda parado un rato
    } else {
      const dx = r.destino.x - r.pos.x, dz = r.destino.z - r.pos.z;
      const l = Math.hypot(dx, dz);
      if (l < 0.6) { r.destino = null; r.paused = 1.5 + r.rng.randf() * 4; r.walking = 0; }
      else {
        const paso = Math.min(l, r.speed * dt);
        r.pos.x += dx / l * paso;
        r.pos.z += dz / l * paso;
        r.yaw = Math.atan2(dx, dz);
        r.walking = 1;
      }
    }
    r.phase += dt * 4.0 * r.walking;

    // El perro va detras y a un lado, y llega tarde: se queda mirando cosas.
    const atras = 1.6, lado = 0.9;
    const bx = r.pos.x - Math.sin(r.yaw) * atras - Math.cos(r.yaw) * lado;
    const bz = r.pos.z - Math.cos(r.yaw) * atras + Math.sin(r.yaw) * lado;
    const ddx = bx - d.pos.x, ddz = bz - d.pos.z;
    const dl = Math.hypot(ddx, ddz);
    if (dl > 0.25) {
      const paso = Math.min(dl, (r.speed * 1.6) * dt);
      d.pos.x += ddx / dl * paso;
      d.pos.z += ddz / dl * paso;
      d.yaw = Math.atan2(ddx, ddz);
      d.walking = 1;
    } else d.walking = 0;
    d.phase += dt * 7.0 * d.walking;
  }

  // -- bucle principal ----------------------------------------------------

  update(dt, t, camPos) {
    this._t = t;
    let nV = 0, nD = 0, nS = 0, nC = 0, nB = 0, nT = 0, nW = 0;
    // La res mas cercana, para colgar de ella el panner del ganado: una vaca a
    // 40 m se oye desde el campo y no desde Floridablanca.
    let mejorGanado = Infinity;
    this.ganadoCerca = null;

    for (const w of this.villagers) {
      const dx = w.pos.x - camPos.x, dz = w.pos.z - camPos.z, dy = w.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      // Con lluvia o con frio hay menos gente fuera. `w.calle` es fijo por
      // vecino, asi que los que se meten en casa son siempre los mismos y el
      // reparto no parpadea cada vez que arrecia.
      //
      // Y hay que ESCRIBIRLOS, no solo saltarlos: setInst escribe en una ranura
      // fija por vecino, asi que uno que se salta se queda con su ultima matriz
      // -o sea plantado en mitad de la calle sin mover los pies-. Hundido bajo
      // el terreno no se ve, y volver a salir es una linea.
      if (w.calle > this.fuera) { this.writeVillager(w, true); nV++; continue; }
      // El del monte no tiene calle por la que ir: se mueve a la querencia de su
      // majada, con el mismo paso que una oveja pero con mas radio.
      if (w.monte) { this.stepWander(w, dt, 22, 6); this.writeVillager(w); nV++; continue; }
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
      const d2 = dx * dx + dz * dz;
      if (d2 < mejorGanado) { mejorGanado = d2; this.ganadoCerca = s.pos; }
    }
    for (const c of this.cats) {
      const dx = c.pos.x - camPos.x, dz = c.pos.z - camPos.z, dy = c.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      // Se para mucho mas que el perro: 0.9 de pausa contra 0.15, y a la mitad
      // de velocidad punta. Un gato cruza la calle y se sienta.
      this.stepGraphWalker(c, dt, 0.9, 2.2);
      this.writeCat(c);
      nT++;
    }
    for (const c of this.cows) {
      const dx = c.pos.x - camPos.x, dz = c.pos.z - camPos.z, dy = c.pos.y - camPos.y;
      if (dx * dx + dy * dy + dz * dz > RANGE2) continue;
      // Radio de pasto mas grande que el de la oveja y pausas mas largas.
      this.stepWander(c, dt, 11, 9);
      this.writeCow(c);
      nW++;
      const d2v = dx * dx + dz * dz;
      if (d2v < mejorGanado) { mejorGanado = d2v; this.ganadoCerca = c.pos; }
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
      this._grupos = { Vecino: [], Perro: [], Oveja: [], Gallina: [], Pajaro: [],
        Gato: [], Vaca: [] };
      for (const m of this._objetos) {
        for (const k of Object.keys(this._grupos)) {
          if (m.name.startsWith(k)) this._grupos[k].push(m);
        }
      }
    }
    const marcar = (lista) => {
      for (const m of lista) m.instanceMatrix.needsUpdate = true;
    };
    // El rey. Se escribe siempre que sea su hora, este cerca o lejos: es uno
    // solo y ahorrarse su matriz no ahorra nada.
    if (this.horaDelRey) {
      this.stepRey(dt);
      this.writeVillager(this.rey);
      setInst(this.vGorguera, 0, this.rey.pos.x,
        this.world.heightAt(this.rey.pos.x, this.rey.pos.z), this.rey.pos.z,
        this.rey.yaw, 0, 0, this.rey.talla);
      this.writeDog(this.perroRey);
      nV++; nD++;
    } else {
      // Fuera de su hora se hunde, igual que el vecino que se mete en casa.
      this.writeVillager(this.rey, true);
      setInst(this.vGorguera, 0, 0, -50, 0, 0, 0, 0, 0);
      this.perroRey.pos.y = -50;
      this.writeDog(this.perroRey, true);
      nV++; nD++;
    }
    this.vGorguera.instanceMatrix.needsUpdate = true;

    // Lo que el sonido necesita saber del mundo vivo. No son los totales del
    // pueblo: son los que han pasado el filtro de RANGE2, o sea los que estan lo
    // bastante cerca como para oirse. La cuenta ya estaba hecha para saber que
    // grupos hay que repintar; solo faltaba dejarla a mano.
    this.cerca = { vecinos: nV, perros: nD, ovejas: nS, gallinas: nC, gatos: nT, vacas: nW };

    // La senal, sobre la cabeza del senalado. Gira despacio y sube y baja: quieta
    // se confunde con un remate del caserio, y girando se lee como aviso.
    const sen = this.senalado;
    if (sen && sen.pos && !(sen.calle > this.fuera)) {
      const talla = sen.talla || 1;
      const y = this.world.heightAt(sen.pos.x, sen.pos.z)
        + V_HEAD_Y * talla + 0.45 + Math.sin(this._t * 2.2) * 0.07;
      setInst(this.senal, 0, sen.pos.x, y, sen.pos.z, this._t * 0.9, 0, 0, 1);
    } else {
      setInst(this.senal, 0, 0, -50, 0, 0, 0, 0, 0);
    }
    this.senal.instanceMatrix.needsUpdate = true;

    if (nV) marcar(this._grupos.Vecino);
    if (nD) marcar(this._grupos.Perro);
    if (nS) marcar(this._grupos.Oveja);
    if (nC) marcar(this._grupos.Gallina);
    if (nB) marcar(this._grupos.Pajaro);
    if (nT) marcar(this._grupos.Gato);
    if (nW) marcar(this._grupos.Vaca);
  }

  // El primero que caiga dentro de maxDist, para el dialogo del jugador.
  // Barrido lineal sobre this.ent (~400 entidades con los conteos actuales):
  // cuesta lo mismo con maxDist=3.5 que con maxDist=1000, es un dot product
  // y una comparacion por bicho, no una consulta espacial. No hace falta
  // rejilla aqui salvo que ent crezca a miles.
  cercano(pos, maxDist = 3.5) {
    let best = null, bestD = maxDist * maxDist;
    for (const e of this.ent) {
      // Fuera de su hora, el rey y su perro no estan: no basta con hundirlos,
      // porque `pos` sigue siendo el del paseo y se les hablaria a ciegas.
      if ((e.tipo === 'rey' || e.tipo === 'perronegro') && !this.horaDelRey) continue;
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
    const nombre = e.tipo === 'vecino' ? e.nombre
      : e.tipo === 'rey' ? e.nombre
      : e.tipo === 'perronegro' ? 'Un perro negro'
      : e.tipo === 'perro' ? 'Perro'
      : e.tipo === 'gato' ? 'Gato'
      : e.tipo === 'vaca' ? 'Vaca'
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
    const e = this.entOficio(oficio, pos);
    return e ? this.ficha(e) : null;
  }

  // La misma busqueda pero devolviendo la entidad viva y no su ficha. La ficha
  // vale para hablar; para colgarle una senal de la cabeza hacen falta la talla y
  // el resto del bicho.
  entOficio(oficio, pos) {
    const r = ROLES.indexOf(oficio);
    if (r < 0) return null;
    let best = null, bestD = Infinity;
    for (const v of this.villagers) {
      if (v.role !== r) continue;
      // Y no vale el que se ha metido en casa. Sin esta linea, un dia de lluvia
      // las indicaciones te mandan hacia alguien que esta cuatro metros bajo
      // tierra: es el mismo fallo por otro camino, y por eso el arreglo va aqui
      // y no solo en el bucle de dibujado.
      if (v.calle > this.fuera) continue;
      const d = (v.pos.x - pos.x) ** 2 + (v.pos.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // La entidad detras de un id de ficha ("vecino137"). `quien` guarda ese id y el
  // nombre, que es lo justo para no envejecer; esto lo vuelve a atar al vecino de
  // carne y hueso cuando hace falta senalarlo.
  entPorFicha(id) {
    if (!id) return null;
    for (const e of this.ent) if (`${e.tipo}${e.id}` === id) return e;
    return null;
  }

  // Un vecino concreto por su id de ficha. Lo pide el encargo que manda volver
  // con quien te lo dio: hay que poder decir por donde anda ESE, no el de su
  // oficio que tengas mas cerca, que es otra persona.
  buscarId(id) {
    for (const v of this.villagers) {
      if (`${v.tipo}${v.id}` === id) return this.ficha(v);
    }
    return null;
  }
}
