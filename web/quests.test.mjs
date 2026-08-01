// Comprobacion del generador de encargos: `node web/quests.test.mjs`.
//
// No hay navegador aqui, asi que se prueba tramas.js -que no importa THREE- con
// un pueblo y un vecindario de mentira. Lo que tiene que quedar claro es que
// NINGUNA semilla produzca un encargo imposible: sin destino, con dos pasos
// seguidos que resuelva la misma persona, o con un hueco {sitio} sin rellenar.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { siguienteEncargo, OFICIOS, LLEGADA } from './tramas.js';
import { distancia } from './lugares.js';

// Encadena `cuantos` encargos como lo hace quests.js: uno detras de otro, cada
// uno sabiendo el oficio con el que acabo el anterior.
function cadena(semilla, cuantos, lugares, vida, origen, clima = null) {
  const out = [];
  for (let n = 0; n < cuantos; n++) {
    const ultimo = out[out.length - 1];
    const e = siguienteEncargo(semilla, n, lugares, vida, origen,
      (ultimo && ultimo.oficio) || null, clima);
    if (!e) break;
    out.push(...e);
  }
  return out;
}

// Pueblo de mentira: 40 sitios repartidos en 2 km, con huellas de todo tamano.
const lugares = {
  antiguos: Array.from({ length: 40 }, (_, i) => ({
    nombre: `Sitio ${i}`,
    x: (i * 137) % 2000,
    z: (i * 311) % 2000,
    area: 200 + (i % 7) * 5000,
  })),
};
const origen = { x: 1000, z: 1000 };
// Vecindario donde falta un oficio a proposito: el generador tiene que apanarse.
// La ficha trae `id` y `pos` como la de verdad (npcs.js), que es lo que usan los
// misterios de persona para atarse a un vecino concreto.
const vida = {
  // El id depende del punto desde el que se busca, como en el juego: el vecino
  // que sale es el mas cercano, asi que preguntar desde otro sitio da otro.
  buscarOficio: (of, p) => (of === 'fraile' ? null
    : { id: `vecino${of}${Math.round((p.x + p.z) / 97)}`, oficio: of, nombre: of,
      pos: { x: p.x, z: p.z } }),
};

// Un paso queda pendiente de una PERSONA, no de un oficio: el mismo par
// (encargo, rol) lo resuelve el mismo vecino. Es la clave que usa quests.js.
const clave = (p) => `${p.encargo}:${p.rol}`;

let pasos = 0, formas = new Set(), temas = new Set();
for (let semilla = 1; semilla <= 300; semilla++) {
  const enc = cadena(semilla, 3, lugares, vida, origen);
  assert.ok(enc.length >= 3, `semilla ${semilla}: se queda sin pasos`);
  pasos += enc.length;
  formas.add(enc.length);

  enc.forEach((p, i) => {
    const donde = `semilla ${semilla} paso ${i}`;
    // Un paso o pide hablar con un oficio, o pide llegar a un sitio. Nunca ni.
    assert.ok(!!p.oficio !== !!p.reach, `${donde}: ni oficio ni destino`);
    if (p.oficio) {
      assert.ok(OFICIOS.includes(p.oficio), `${donde}: oficio raro ${p.oficio}`);
      assert.notStrictEqual(p.oficio, 'fraile', `${donde}: fraile, y no hay`);
    }
    if (p.reach) {
      assert.ok(p.radio >= 25 && p.radio <= 90, `${donde}: radio ${p.radio}`);
      // Lejos de donde aparece el jugador, contando su radio de llegada: si no,
      // el paso se cerraria solo antes de que se lo encarguen.
      assert.ok(distancia(origen, p.reach) >= p.radio + 60, `${donde}: destino pegado`);
      assert.ok(distancia(origen, p.reach) >= 120, `${donde}: destino a un paso`);
    }
    // Dos pasos seguidos que resuelva el mismo vecino: el segundo se cerraria
    // solo, sin moverse del sitio. Ahora se mira por hueco y no solo por oficio,
    // que es lo que de verdad ata a una persona.
    const ant = enc[i - 1];
    if (ant && p.oficio && ant.oficio) {
      assert.notStrictEqual(p.oficio, ant.oficio, `${donde}: dos veces seguidas`);
      assert.notStrictEqual(clave(p), clave(ant), `${donde}: mismo hueco pegado`);
    }
    // Todo paso de hablar tiene hueco y el trozo de objetivo que se sustituye
    // por el nombre; si no, el HUD nunca diria con quien hay que volver.
    if (p.oficio) {
      assert.ok(p.rol === 'A' || p.rol === 'B', `${donde}: rol ${p.rol}`);
      assert.ok(p.objetivo.includes(p.quien), `${donde}: sin hueco de nombre`);
    }
    assert.ok(Number.isInteger(p.encargo), `${donde}: sin numero de encargo`);
    // Objetivo y dialogo, sin huecos de plantilla sin rellenar.
    assert.ok(p.objetivo && p.objetivo.length > 10, `${donde}: sin objetivo`);
    assert.ok(p.dialogo.length >= 1, `${donde}: sin dialogo`);
    for (const [, txt] of p.dialogo) {
      assert.ok(txt && !txt.includes('{'), `${donde}: hueco sin rellenar: ${txt}`);
      temas.add(txt);
    }
  });
}

// Misma semilla, mismo encargo: es lo que hace que ?seed= sirva de algo.
assert.deepStrictEqual(cadena(7, 3, lugares, vida, origen),
  cadena(7, 3, lugares, vida, origen));
// Y semillas distintas, encargos distintos: si esto falla, no hay variedad.
assert.notDeepStrictEqual(cadena(7, 3, lugares, vida, origen),
  cadena(8, 3, lugares, vida, origen));

// --- la cadena larga ---------------------------------------------------------
//
// Los encargos ya no son tres: se pide uno nuevo cada vez que se acaba el
// anterior, asi que la partida de verdad es esta, no la de arriba. 500 seguidos
// con una sola semilla es donde salen las derivas que 300 partidas de tres
// encargos no ven: un generador que se queda sin sitios, una costura que empieza
// a repetir oficio, un numero de encargo que deja de subir.
const larga = cadena(1, 500, lugares, vida, origen);
assert.strictEqual(larga[larga.length - 1].encargo, 499,
  'la cadena se corta antes de los 500 encargos');

// La forma de cada encargo, leida de los pasos: 'i' es llegar a un sitio, y 'A'
// y 'B' son los dos huecos de persona. Cada FORMAS da una cadena distinta.
const arcos = new Map();
const frases = new Set();
larga.forEach((p, i) => {
  const ant = larga[i - 1];
  arcos.set(p.encargo, (arcos.get(p.encargo) || '') + (p.reach ? 'i' : p.rol));
  assert.ok(p.dialogo.length >= 1, `largo ${i}: sin dialogo`);
  for (const [, txt] of p.dialogo) {
    assert.ok(txt && !txt.includes('{'), `largo ${i}: hueco sin rellenar: ${txt}`);
    frases.add(txt);
  }
  if (ant && p.oficio && ant.oficio) {
    assert.notStrictEqual(p.oficio, ant.oficio, `largo ${i}: dos veces seguidas`);
  }
  // El numero de encargo sube de uno en uno y nunca se repite hacia atras: es la
  // mitad de la clave con la que quests.js recuerda con quien hay que volver, y
  // si se reciclara, un encargo heredaria el vecino de otro anterior.
  if (ant) {
    assert.ok(p.encargo === ant.encargo || p.encargo === ant.encargo + 1,
      `largo ${i}: encargo ${ant.encargo} -> ${p.encargo}`);
  }
});
// Ningun arco puede acabar con los dos huecos de persona pegados: 'AA' o 'BB'
// serian dos pasos que resuelve el mismo vecino sin moverse del sitio.
const formasVistas = new Set(arcos.values());
for (const forma of formasVistas) {
  assert.ok(!/AA|BB/.test(forma), `arco con dos pasos pegados: ${forma}`);
}
// Y en 500 encargos tienen que haber salido todos los arcos que hay escritos.
// Si esto baja, es que se ha colado un arco que el generador nunca elige.
assert.strictEqual(formasVistas.size, 10,
  `solo ${formasVistas.size} arcos distintos: ${[...formasVistas].sort()}`);

// --- que el dado no se sesgue ------------------------------------------------
//
// Cada decision del generador tira de su canal. Cuando compartian contador, la
// frase de llegada quedaba amarrada al arco -que elige el mismo dado- y de 3618
// llegadas la mas repetida salia 1013 veces y la menos 258, con 603 de media.
// Con nueve tiradas por partida eso no se veia; con encargos que no se acaban,
// la variedad es lo unico que hay, asi que se cuenta.
const cuenta = new Map(LLEGADA.map((t) => [t, 0]));
for (const p of cadena(3, 2000, lugares, vida, origen)) {
  if (!p.reach) continue;
  for (const [, txt] of p.dialogo) {
    for (const t of LLEGADA) {
      if (txt === t.replaceAll('{sitio}', p.reach.nombre)) {
        cuenta.set(t, cuenta.get(t) + 1);
      }
    }
  }
}
const total = [...cuenta.values()].reduce((a, b) => a + b, 0);
const esperado = total / LLEGADA.length;
// Desviacion tipica de una binomial: con 4 de margen no salta por casualidad,
// pero un dado amarrado a otra decision se va mucho mas lejos que eso.
const sigma = Math.sqrt(total * (1 / LLEGADA.length) * (1 - 1 / LLEGADA.length));
for (const [t, v] of cuenta) {
  assert.ok(Math.abs(v - esperado) < 4 * sigma,
    `frase de llegada sesgada: ${v} veces de ${Math.round(esperado)}`
    + ` (+-${Math.round(4 * sigma)}) -- ${t.slice(0, 40)}`);
}

// --- encargos segun el tiempo que hace ----------------------------------------
//
// Hay temas que solo salen con nieve, con helada o en verano. Lo que hay que
// comprobar es que NINGUNA combinacion de epoca y tiempo deje al jugador sin
// encargo, y que los temas de temporada salgan cuando toca y NO salgan fuera:
// una etiqueta que no filtra nada es una etiqueta que sobra.

const ESTACIONES = ['invierno', 'primavera', 'verano', 'otono'];
const ESTADOS_CLIMA = ['despejado', 'nubes', 'cubierto', 'niebla', 'lluvia',
  'tormenta', 'nieve'];

const vistos = new Map();      // id de tema -> Set de "estacion/estado" donde salio
let combinaciones = 0;

for (const estacion of ESTACIONES) {
  for (const estado of ESTADOS_CLIMA) {
    for (const helada of [false, true]) {
      combinaciones++;
      const clima = { estacion, estado, helada, cubierta: estado === 'nieve' ? 0.8 : 0 };
      for (let semilla = 1; semilla <= 25; semilla++) {
        const enc = cadena(semilla, 4, lugares, vida, origen, clima);
        assert.ok(enc.length >= 3,
          `${estacion}/${estado}${helada ? '/helada' : ''} semilla ${semilla}:`
          + ' se queda sin encargos');
        for (const p of enc) {
          assert.ok(p.dialogo.length >= 1, 'paso sin dialogo');
          for (const [, txt] of p.dialogo) {
            assert.ok(txt && !txt.includes('{'), `hueco sin rellenar: ${txt}`);
          }
        }
        // De que tema es cada encargo, por el motivo, que es lo unico del tema
        // que llega al paso ya montado.
        for (const p of enc) {
          if (!p.objetivo.includes('dicen que ')) continue;
          const motivo = p.objetivo.split('dicen que ')[1];
          if (!vistos.has(motivo)) vistos.set(motivo, new Set());
          vistos.get(motivo).add(`${estacion}/${estado}${helada ? '/helada' : ''}`);
        }
      }
    }
  }
}

// Los temas de temporada tienen que aparecer, y solo donde toca.
const dondeSale = (trozo) => {
  for (const [motivo, set] of vistos) if (motivo.includes(trozo)) return set;
  return null;
};
const nieve = dondeSale('la nieve ha cortado');
assert.ok(nieve, 'el encargo de la nieve no sale nunca');
for (const d of nieve) {
  assert.ok(d.includes('/nieve'), `el encargo de la nieve sale en ${d}`);
}
const siega = dondeSale('se siega en el ejido');
assert.ok(siega, 'el encargo de la siega no sale nunca');
for (const d of siega) {
  assert.ok(d.startsWith('verano/'), `el encargo de la siega sale en ${d}`);
}
const helada = dondeSale('la helada ha reventado');
assert.ok(helada, 'el encargo de la helada no sale nunca');
for (const d of helada) {
  assert.ok(d.includes('/helada'), `el encargo de la helada sale en ${d}`);
}
const lena = dondeSale('no hay lena cortada');
assert.ok(lena, 'el encargo de la lena no sale nunca');
for (const d of lena) assert.ok(d.startsWith('otono/'), `la lena sale en ${d}`);

// Y sin saber el tiempo -que es como arranca una partida antes del primer
// fotograma- solo pueden salir los de siempre, nunca uno de temporada.
const sinClima = cadena(5, 40, lugares, vida, origen, null);
for (const p of sinClima) {
  if (!p.objetivo.includes('dicen que ')) continue;
  const m = p.objetivo.split('dicen que ')[1];
  assert.ok(!m.includes('la nieve ha cortado') && !m.includes('se siega'),
    `sin clima ha salido un tema de temporada: ${m}`);
}

// --- los 25 misterios ---------------------------------------------------------
//
// Se reparten por semilla, asi que lo que hay que comprobar es que se reparten
// TODOS -uno que no se coloque no lo encuentra nadie y la lista nunca llega a 25-,
// que dos no caen en el mismo sitio y que cada uno trae su pista y su texto.

const { MISTERIOS, repartir } = await import('./misterios.js');

assert.strictEqual(MISTERIOS.length, 25, `hay ${MISTERIOS.length} misterios, no 25`);
for (const m of MISTERIOS) {
  assert.ok(m.id && m.nombre && m.pista && m.texto, `misterio incompleto: ${m.id}`);
  assert.ok(m.tipo === 'objeto' || m.tipo === 'persona', `tipo raro: ${m.tipo}`);
  // La pista no puede decir el nombre: entonces no es pista, es la respuesta.
  const palabras = m.nombre.toLowerCase().split(' ').filter((p) => p.length > 5);
  for (const p of palabras) {
    assert.ok(!m.pista.toLowerCase().includes(p),
      `la pista de "${m.nombre}" ya lo dice: contiene "${p}"`);
  }
  if (m.tipo === 'persona') {
    assert.ok(OFICIOS.includes(m.oficio), `${m.id}: oficio raro ${m.oficio}`);
  }
}

let sitiosMax = 0;
for (let semilla = 1; semilla <= 200; semilla++) {
  const puestos = repartir(semilla, lugares, vida);
  assert.strictEqual(puestos.length, 25,
    `semilla ${semilla}: solo se colocan ${puestos.length} de 25`);
  const objetos = puestos.filter((m) => m.tipo === 'objeto');
  const sitios = new Set(objetos.map((m) => m.sitio));
  assert.strictEqual(sitios.size, objetos.length,
    `semilla ${semilla}: dos misterios en el mismo sitio`);
  sitiosMax = Math.max(sitiosMax, sitios.size);
}
// Misma semilla, mismo reparto; semillas distintas, reparto distinto.
assert.deepStrictEqual(repartir(7, lugares, vida), repartir(7, lugares, vida));
assert.notDeepStrictEqual(repartir(7, lugares, vida), repartir(8, lugares, vida));

// La lista de oficios esta copiada de npcs.js (que arrastra THREE y no se puede
// importar aqui). Si alguien anade un oficio alli, que salte aqui y no en un
// objetivo que nunca se puede cumplir.
const roles = readFileSync(new URL('./npcs.js', import.meta.url), 'utf8')
  .match(/const ROLES = \[([^\]]*)\]/)[1]
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
assert.deepStrictEqual(OFICIOS, roles, 'OFICIOS y ROLES se han separado');

console.log(`OK: 300 semillas, ${pasos} pasos, arcos de ${[...formas].sort()}`
  + ` pasos, ${temas.size} frases distintas`);
console.log(`OK: cadena de 500 encargos, ${larga.length} pasos,`
  + ` ${formasVistas.size} arcos, ${frases.size} frases distintas`);
console.log(`OK: ${total} llegadas repartidas entre ${LLEGADA.length} frases,`
  + ` ${[...cuenta.values()].sort((a, b) => a - b).join('/')}`);
console.log(`OK: ${combinaciones} combinaciones de epoca y tiempo x 25 semillas,`
  + ` ninguna deja sin encargo | ${vistos.size} motivos distintos`);
console.log(`OK: 25 misterios repartidos en 200 semillas, hasta ${sitiosMax} sitios`
  + ' distintos, ninguna pista se delata sola');
