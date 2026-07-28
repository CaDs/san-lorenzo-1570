// Los sitios del pueblo, con su nombre de verdad.
//
// OpenStreetMap sabe como se llaman la Iglesia de San Bernabe, el Ayuntamiento,
// el Real Coliseo Carlos III o el Camino de Abantos. Ese nombre llega hasta
// data/build/world.json (campos `n` y `a`, ver tools/prep.py) y aqui se ordena
// para que un vecino pueda mandarte a un sitio en vez de soltarte un rumbo.
//
// Nada de esto necesita datos nuevos: 69 edificios y 331 calles con nombre ya
// venian en la descarga de Overpass; el pipeline los tiraba.

const CELDA = 40.0;              // m por celda del indice de calles
const PASO_M = 0.75;             // lo que anda un hombre de una zancada

// En este mundo +X es el este y +Z el SUR (Z = norte maximo - norte), asi que
// el norte es -Z. Equivocarse aqui manda a todo el mundo al lado contrario.
const VIENTOS = ['el norte', 'el nordeste', 'el este', 'el sudeste',
  'el sur', 'el sudoeste', 'el oeste', 'el noroeste'];

// Un puñado de sitios se merecen articulo y trato propio. El resto sale con el
// nombre tal cual lo escribio OSM.
const ARTICULO = /^(el|la|los|las) /i;

export class Lugares {
  constructor(world) {
    this.world = world;
    this.sitios = [];
    this.calles = new Map();      // celda -> [{n, p}]

    const d = world.data;

    // --- edificios con nombre
    d.buildings.forEach((b, i) => {
      if (!b.n) return;
      const c = centroide(b.p);
      this.sitios.push({
        nombre: b.n,
        clase: b.a || 'edificio',
        x: c[0], z: c[1],
        area: area(b.p),
        idx: i,
      });
    });

    // --- el Monasterio, por si OSM no lo hubiera nombrado: es la huella mayor
    // con muchisima ventaja (35.771 m2; el segundo no llega a 6.300).
    const mi = world.biggestFootprint();
    const mb = d.buildings[mi];
    if (mb && !mb.n) {
      const c = centroide(mb.p);
      this.sitios.push({ nombre: 'el Monasterio', clase: 'monastery',
        x: c[0], z: c[1], area: area(mb.p), idx: mi });
    }
    this.monasterio = this.sitios.find((s) => /monasterio/i.test(s.nombre))
      || this.sitios.slice().sort((a, b) => b.area - a.area)[0];

    // --- indice de calles con nombre, por celdas, para saber por donde vas
    for (const r of d.roads) {
      if (!r.n) continue;
      for (let i = 0; i < r.p.length; i += 2) {
        const k = clave(r.p[i], r.p[i + 1]);
        let l = this.calles.get(k);
        if (!l) this.calles.set(k, l = []);
        l.push({ n: r.n, x: r.p[i], z: r.p[i + 1] });
      }
    }

    console.log(`lugares: ${this.sitios.length} sitios con nombre,`
      + ` ${new Set([...this.calles.values()].flat().map((c) => c.n)).size} calles`);
  }

  // El sitio con nombre mas cercano, si hay alguno a tiro.
  cerca(pos, max = 70) {
    let mejor = null, dm = max * max;
    for (const s of this.sitios) {
      const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2;
      if (d < dm) { dm = d; mejor = s; }
    }
    return mejor;
  }

  // Por que calle vas. Barrido de las nueve celdas de alrededor, no de los
  // 1743 tramos: esto se llama al hablar, pero no cuesta nada dejarlo barato.
  calleEn(pos, max = 25) {
    let mejor = null, dm = max * max;
    const cx = Math.floor(pos.x / CELDA), cz = Math.floor(pos.z / CELDA);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const l = this.calles.get(`${cx + dx},${cz + dz}`);
        if (!l) continue;
        for (const c of l) {
          const d = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2;
          if (d < dm) { dm = d; mejor = c.n; }
        }
      }
    }
    return mejor;
  }

  // Un sitio con nombre al azar pero estable para quien pregunte.
  alAzar(semilla) {
    if (!this.sitios.length) return null;
    return this.sitios[Math.abs(semilla) % this.sitios.length];
  }

  buscar(texto) {
    const t = texto.toLowerCase();
    return this.sitios.find((s) => s.nombre.toLowerCase().includes(t)) || null;
  }
}

// --- geometria y lenguaje -----------------------------------------------

export function rumbo(desde, hasta) {
  const dx = hasta.x - desde.x, dz = hasta.z - desde.z;
  // 0 = norte (-Z), creciendo hacia el este (+X).
  const a = Math.atan2(dx, -dz);
  const i = Math.round(a / (Math.PI / 4) + 8) % 8;
  return VIENTOS[i];
}

export function distancia(desde, hasta) {
  return Math.hypot(hasta.x - desde.x, hasta.z - desde.z);
}

// Distancia en pasos, redondeada a algo que un vecino diria en voz alta. Nadie
// dice "a trescientos cuarenta y siete pasos".
export function pasos(metros) {
  const p = metros / PASO_M;
  if (p < 30) return 'aqui al lado';
  if (p < 120) return `a unos ${Math.round(p / 10) * 10} pasos`;
  if (p < 700) return `a unos ${Math.round(p / 50) * 50} pasos`;
  return 'lejos, buena caminata';
}

// "cuesta arriba" sale gratis del terreno y ancla la frase al sitio real.
export function cuesta(world, desde, hasta) {
  const dh = world.heightAt(hasta.x, hasta.z) - world.heightAt(desde.x, desde.z);
  if (dh > 12) return ', y es todo cuesta arriba';
  if (dh < -12) return ', cuesta abajo';
  return '';
}

export function conArticulo(nombre) {
  return ARTICULO.test(nombre) ? nombre : `${nombre}`;
}

function centroide(p) {
  let x = 0, z = 0;
  for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; }
  return [x / (p.length / 2), z / (p.length / 2)];
}

function area(p) {
  let s = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    s += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(s) / 2;
}

function clave(x, z) {
  return `${Math.floor(x / CELDA)},${Math.floor(z / CELDA)}`;
}
