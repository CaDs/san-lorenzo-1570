// Comprobacion del clima: `node web/clima.test.mjs`.
//
// Lo que tiene que quedar claro son tres cosas. Que es determinista, o `?seed=`
// no vale de nada. Que no da saltos, que es el fallo que este diseno PUEDE tener
// de verdad: el tiempo se sortea en bloques de seis horas y en la frontera entre
// dos bloques la lluvia podria arrancar de golpe. Y que el reparto se parece al
// de la sierra de verdad, porque si no esto no es San Lorenzo, es un clima de
// videojuego con nieve cuando apetece.
//
// Las cifras contra las que se compara salen de la serie de la estacion del
// Monasterio (1028 m) que hay en la cabecera de clima.js.

import assert from 'node:assert';
import { clima, climaFijo, estacionDe, mesDe, ESTADOS } from './clima.js';

const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// --- determinista ---------------------------------------------------------------

for (let i = 0; i < 1000; i++) {
  const dia = 1 + (i * 7) % 365;
  const hora = (i * 0.37) % 24;
  assert.deepStrictEqual(clima(7, dia, hora), clima(7, dia, hora),
    `dia ${dia} hora ${hora}: no repite`);
}
// Y semillas distintas dan tiempos distintos, o no habria variedad.
let iguales = 0;
for (let d = 1; d <= 365; d++) if (clima(7, d, 12).estado === clima(8, d, 12).estado) iguales++;
assert.ok(iguales < 300, `dos semillas dan el mismo tiempo ${iguales} dias de 365`);

// --- sin saltos -----------------------------------------------------------------
//
// Un ano entero a pasos de 0,05 h (3 minutos). El salto grande solo puede estar
// en el cambio de bloque, que es cada seis horas, asi que este barrido lo pisa
// 1460 veces.

let saltoMax = 0, dondeMax = '';
for (let d = 1; d <= 365; d++) {
  for (let h = 0; h < 23.95; h += 0.05) {
    const a = clima(3, d, h), b = clima(3, d, h + 0.05);
    for (const campo of ['lluvia', 'nieve', 'nublado']) {
      const s = Math.abs(b[campo] - a[campo]);
      if (s > saltoMax) { saltoMax = s; dondeMax = `dia ${d} hora ${h.toFixed(2)} ${campo}`; }
    }
  }
}
assert.ok(saltoMax < 0.05, `salto de ${saltoMax.toFixed(3)} en ${dondeMax}`);

// --- el reparto se parece al de la sierra ----------------------------------------
//
// 60 semillas x 365 dias x 4 bloques. Se cuenta como cuenta un observador: dias
// en los que ha pasado algo, no bloques, que es lo que dice la serie.

const SEMILLAS = 60;
const dias = { precip: new Array(12).fill(0), nieve: new Array(12).fill(0),
  tormenta: new Array(12).fill(0), niebla: new Array(12).fill(0),
  helada: new Array(12).fill(0), cubierta: new Array(12).fill(0) };

for (let s = 1; s <= SEMILLAS; s++) {
  for (let d = 0; d < 365; d++) {
    const m = mesDe(d);
    let precip = false, nieve = false, tormenta = false, niebla = false;
    let helada = false, cubierta = false;
    for (const h of [3, 9, 15, 21]) {
      const c = clima(s, d, h);
      if (c.estado === 'lluvia' || c.estado === 'tormenta' || c.estado === 'nieve') precip = true;
      if (c.estado === 'nieve') nieve = true;
      if (c.estado === 'tormenta') tormenta = true;
      if (c.estado === 'niebla') niebla = true;
      if (c.helada) helada = true;
      if (c.cubierta > 0.15) cubierta = true;
    }
    if (precip) dias.precip[m]++;
    if (nieve) dias.nieve[m]++;
    if (tormenta) dias.tormenta[m]++;
    if (niebla) dias.niebla[m]++;
    if (helada) dias.helada[m]++;
    if (cubierta) dias.cubierta[m]++;
  }
}

const alAno = (k) => dias[k].reduce((a, b) => a + b, 0) / SEMILLAS;
const alMes = (k, m) => dias[k][m] / SEMILLAS;

// Margen ancho a proposito: esto no es un ajuste de curva, es "que se parezca".
// Si algun dia alguien cambia CIELO_SECO o los pesos y se le va la mano, salta.
const cerca = (real, obtenido, tol, que) => assert.ok(
  Math.abs(obtenido - real) <= tol,
  `${que}: la sierra tiene ${real} y sale ${obtenido.toFixed(1)} (tolerancia ${tol})`);

cerca(107.4, alAno('precip'), 18, 'dias de precipitacion al ano');
cerca(17.5, alAno('nieve'), 7, 'dias de nevada al ano');
cerca(18.9, alAno('tormenta'), 8, 'dias de tormenta al ano');
cerca(59.2, alAno('niebla'), 18, 'dias de niebla al ano');
cerca(30.4, alAno('helada'), 14, 'dias de helada al ano');
cerca(8.9, alAno('cubierta'), 6, 'dias con el suelo nevado al ano');

// Y el reparto POR MES, que es lo que de verdad hace que enero no sea agosto.
cerca(3.5, alMes('precip', 6), 3, 'dias de precipitacion en julio');
cerca(11.1, alMes('precip', 10), 5, 'dias de precipitacion en noviembre');
cerca(3.8, alMes('tormenta', 5), 3, 'dias de tormenta en junio');
cerca(8.9, alMes('niebla', 11), 5, 'dias de niebla en diciembre');
cerca(9.0, alMes('helada', 0), 5, 'dias de helada en enero');

// Nada de nieve en verano, por muy alto que este esto.
for (const m of [5, 6, 7, 8]) {
  assert.strictEqual(dias.nieve[m], 0, `nieva en el mes ${m + 1}`);
}

// --- las puertas -------------------------------------------------------------------

// La tormenta es de tarde. De madrugada no hay ninguna.
for (let s = 1; s <= 40; s++) {
  for (let d = 0; d < 365; d++) {
    for (const h of [1, 4, 7, 10]) {
      assert.notStrictEqual(clima(s, d, h).estado, 'tormenta',
        `tormenta a las ${h} (semilla ${s}, dia ${d})`);
    }
  }
}

// La nieve del suelo se va sola. Se recorre el ano buscando suelo cubierto y se
// comprueba que una semana despues, si no ha vuelto a nevar, no queda nada. El
// barrido tiene que incluir el invierno: entre marzo y octubre casi no hay nieve
// cuajada, asi que mirar solo ahi no comprobaba absolutamente nada.
let comprobadas = 0;
for (let s = 1; s <= 30; s++) {
  for (let d = 0; d < 355; d++) {
    if (clima(s, d, 12).cubierta <= 0.15) continue;
    let volvio = false;
    for (let k = 1; k <= 7; k++) {
      for (const h of [3, 9, 15, 21]) if (clima(s, d + k, h).nieve > 0) volvio = true;
    }
    if (volvio) continue;
    assert.ok(clima(s, d + 7, 12).cubierta < 0.05,
      `semilla ${s} dia ${d}: la nieve sigue ahi una semana despues sin nevar`);
    comprobadas++;
  }
}
assert.ok(comprobadas > 0, 'no se ha comprobado ni un deshielo');

// --- estaciones y forzado ------------------------------------------------------------

assert.strictEqual(estacionDe(15), 'invierno');
assert.strictEqual(estacionDe(105), 'primavera');
assert.strictEqual(estacionDe(195), 'verano');
assert.strictEqual(estacionDe(290), 'otono');
assert.strictEqual(estacionDe(340), 'invierno');
assert.strictEqual(estacionDe(370), estacionDe(5), 'el ano no da la vuelta');

// Forzar pasa por el mismo constructor de salida, asi que tiene que traer los
// mismos campos que el automatico. Si alguien anade un campo y se olvida de uno
// de los dos caminos, esto lo caza.
const auto = clima(1, 100, 12);
for (const e of ESTADOS) {
  const fijo = climaFijo(e.key, 100, 12);
  assert.deepStrictEqual(Object.keys(fijo).sort(), Object.keys(auto).sort(),
    `climaFijo('${e.key}') no trae los mismos campos que el automatico`);
  assert.strictEqual(fijo.estado, e.key);
}
assert.ok(climaFijo('nieve', 100, 12).cubierta > 0.5,
  'nieve forzada en julio y el suelo verde');
assert.strictEqual(climaFijo('loquesea', 100, 12), null);

console.log(`OK: ${SEMILLAS} anos de clima | precipitacion ${alAno('precip').toFixed(0)}`
  + ` dias (real 107) | nieve ${alAno('nieve').toFixed(0)} (18)`
  + ` | tormenta ${alAno('tormenta').toFixed(0)} (19)`
  + ` | niebla ${alAno('niebla').toFixed(0)} (59)`
  + ` | helada ${alAno('helada').toFixed(0)} (30)`
  + ` | suelo nevado ${alAno('cubierta').toFixed(0)} (9)`);
console.log(`OK: salto maximo entre dos instantes ${saltoMax.toFixed(4)}`);
