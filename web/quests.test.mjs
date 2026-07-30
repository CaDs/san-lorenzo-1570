// Comprobacion del generador de encargos: `node web/quests.test.mjs`.
//
// No hay navegador aqui, asi que se prueba tramas.js -que no importa THREE- con
// un pueblo y un vecindario de mentira. Lo que tiene que quedar claro es que
// NINGUNA semilla produzca un encargo imposible: sin destino, con dos pasos
// seguidos que resuelva la misma persona, o con un hueco {sitio} sin rellenar.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { generarEncargos, OFICIOS } from './tramas.js';
import { distancia } from './lugares.js';

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
const vida = { buscarOficio: (of) => (of === 'fraile' ? null : { oficio: of }) };

let pasos = 0, formas = new Set(), temas = new Set();
for (let semilla = 1; semilla <= 300; semilla++) {
  const enc = generarEncargos(semilla, lugares, vida, origen);
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
    // solo, sin moverse del sitio.
    const ant = enc[i - 1];
    if (ant && p.oficio && ant.oficio) {
      assert.notStrictEqual(p.oficio, ant.oficio, `${donde}: dos veces seguidas`);
    }
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
assert.deepStrictEqual(generarEncargos(7, lugares, vida, origen),
  generarEncargos(7, lugares, vida, origen));
// Y semillas distintas, encargos distintos: si esto falla, no hay variedad.
assert.notDeepStrictEqual(generarEncargos(7, lugares, vida, origen),
  generarEncargos(8, lugares, vida, origen));

// La lista de oficios esta copiada de npcs.js (que arrastra THREE y no se puede
// importar aqui). Si alguien anade un oficio alli, que salte aqui y no en un
// objetivo que nunca se puede cumplir.
const roles = readFileSync(new URL('./npcs.js', import.meta.url), 'utf8')
  .match(/const ROLES = \[([^\]]*)\]/)[1]
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
assert.deepStrictEqual(OFICIOS, roles, 'OFICIOS y ROLES se han separado');

console.log(`OK: 300 semillas, ${pasos} pasos, arcos de ${[...formas].sort()}`
  + ` pasos, ${temas.size} frases distintas`);
