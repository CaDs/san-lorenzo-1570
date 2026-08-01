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

// Nombres que podian existir con las obras del Monasterio en marcha. Se mira el
// principio del nombre, que en OSM es el tipo de sitio ("Casa de...", "Ermita
// de...", "Cuartel de..."). Ojo con "Antiguo Palacio de Godoy": ese "antiguo" es
// de ahora, el palacio es de 1790, y por eso el prefijo no se admite.
const DE_EPOCA = /^(el |la |los |las )?(real(es)? |primera |segunda |tercera |gran )?(monasterio|casas?|casita|iglesia|ermita|convento|capilla|hospital|palacio|puente|fuente|molino|huerta|galer[ií]a|jard[ií]n|torre|corral|posada|mes[oó]n|fonda|horno|herrer[ií]a|lonja|cantera|cuartel|mercado|san |santa )/i;

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

    // --- los que se pueden nombrar en 1570
    //
    // OSM nombra el pueblo de HOY: entre la Casa de la Reina y la Galeria de
    // convalecientes hay un Ahorramas, un BM y el Centro Cultural. Un vecino
    // mandando a un caminante al supermercado rompe la epoca de golpe, asi que
    // los encargos y las indicaciones solo usan esta lista.
    //
    // Es una lista BLANCA a proposito: los nombres modernos que puedan aparecer
    // manana si se recorta otra vez el mapa no se cuelan por descuido. De 69
    // sitios pasan unos 27, que siguen siendo mas destinos de los que se ven en
    // una partida.
    this.antiguos = this.sitios.filter((s) => DE_EPOCA.test(s.nombre));
    if (this.antiguos.length < 4) this.antiguos = this.sitios;   // por si acaso

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

  // Un sitio con nombre al azar pero estable para quien pregunte. De los de
  // epoca: a este lo nombra un vecino en voz alta.
  alAzar(semilla) {
    if (!this.antiguos.length) return null;
    return this.antiguos[Math.abs(semilla) % this.antiguos.length];
  }

  // Sin tildes a los dos lados. Los nombres de OSM las llevan -"Iglesia de San
  // Bernabe" es "Bernabé"- y quien busca desde el codigo escribe sin ellas, que
  // es la norma de este proyecto. Con la comparacion cruda, buscar('San Bernabe')
  // devolvia null y la campana se quedaba sin campanario: el fallo no daba error
  // ni aviso, simplemente no sonaba desde ningun sitio.
  //
  // Se quitan solo para COMPARAR. Lo que se lee en pantalla sale del nombre de
  // OSM tal cual, con su tilde y su ene.
  buscar(texto) {
    const t = sinTildes(texto);
    return this.sitios.find((s) => sinTildes(s.nombre).includes(t)) || null;
  }
}

// La ene con virgulilla NO es una e con tilde: se descompone en n + virgulilla y
// hay que volver a componerla, o "Peñalara" casaria con "Penalara" y el pueblo
// acabaria buscando sitios que no son. Por eso se recompone con NFC al final.
export function sinTildes(s) {
  return s.normalize('NFD')
    .replace(/[\u0300-\u0302\u0308]/g, '')   // agudo, grave, circunflejo, dieresis
    .normalize('NFC')
    .toLowerCase();
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
