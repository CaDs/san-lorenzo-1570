// Comprobacion del mezclador: `node web/ambiente.test.mjs`, o `make sonido`.
//
// El sonido no se revisa mirando una captura, asi que esta es la unica forma de
// saber si lo que suena tiene sentido. Cuatro cosas, por orden de lo que duele:
//
//   1. Ninguna ganancia es NaN, nunca. Un NaN envenena ese AudioParam para
//      siempre y el sintoma es una capa que se calla y no vuelve, sin un error
//      en consola. Es el aserto mas valioso de todos.
//   2. Nada de escalones. Es el fallo que este diseno PUEDE tener: las ventanas
//      de horas y de estaciones son escalones si no se suavizan, y un escalon de
//      ganancia se oye como un click.
//   3. No satura. Los ruidos no correlados suman en potencia, o sea hypot, no
//      suma. Se arregla bajando ganancias, no metiendo un compresor que lo tape.
//   4. Que cada capa suene cuando debe: los mazos no de noche, los grillos no en
//      enero, el bullicio del pueblo no a las tres de la madrugada en la dehesa.

import assert from 'node:assert';
import {
  mezclar, tocaCampana, horasCanonicas, trabajaLaObra, ortoOcaso, senoSol,
  diaSemana, pulsoGrillo, muestrear, franja,
} from './ambiente.js';
import { clima, climaFijo, ESTADOS } from './clima.js';

const CAPAS = Object.keys(mezclar({ dia: 100, hora: 12, urbanidad: 0.5, clima: clima(1, 100, 12) }));

// --- 1. ni un NaN ---------------------------------------------------------------

let n = 0;
for (let d = 1; d <= 365; d += 1) {
  for (let h = 0; h < 24; h += 0.25) {
    for (const u of [0, 0.5, 1]) {
      for (const e of ESTADOS) {
        const g = mezclar({ dia: d, hora: h, urbanidad: u, fuera: 0.7, clima: climaFijo(e.key, d, h) });
        for (const k of CAPAS) {
          assert.ok(Number.isFinite(g[k]) && g[k] >= 0 && g[k] <= 1,
            `dia ${d} hora ${h} u ${u} ${e.key}: ${k} = ${g[k]}`);
        }
        n++;
      }
    }
  }
}
console.log(`sin NaN en ${n} combinaciones`);

// --- 2. nada de escalones -------------------------------------------------------

// La hora, a paso fino, que es donde estan las ventanas del reloj.
let saltoH = 0, dondeH = '';
for (const d of [15, 105, 196, 288]) {
  for (const e of ESTADOS) {
    let prev = null;
    for (let h = 0; h <= 24.001; h += 0.05) {
      const g = mezclar({ dia: d, hora: h % 24, urbanidad: 0.5, fuera: 0.7, clima: climaFijo(e.key, d, 12) });
      if (prev) {
        for (const k of CAPAS) {
          const s = Math.abs(g[k] - prev[k]);
          if (s > saltoH) { saltoH = s; dondeH = `${k} dia ${d} ${e.key} hora ${h.toFixed(2)}`; }
        }
      }
      prev = g;
    }
  }
}
assert.ok(saltoH < 0.03, `salto de ${saltoH.toFixed(4)} al mover la hora: ${dondeH}`);

// Y el paso de un dia al siguiente, que es a medianoche y no a las nueve de la
// manana: el reloj del juego llega a las 23:59 del dia d y sigue en las 00:00 del
// d+1. Comprobar la continuidad a una hora fija seria mentir, porque el domingo y
// la anomalia de temperatura del dia SI cambian de golpe -y a esa hora no se
// labra ni cantan los grillos, asi que no se oyen-. Lo que tiene que ser continuo
// es el camino que recorre el juego.
//
// El tiempo se congela a los dos lados del cruce a proposito: la temperatura de
// clima.js lleva una anomalia POR DIA y por tanto salta a medianoche, y eso no es
// cosa de este fichero. Lo que se comprueba aqui son las ventanas de ESTE
// fichero -las estaciones y el domingo-; del salto de temperatura se encarga el
// setTargetAtTime de sonido.js, que es donde toca.
let saltoD = 0, dondeD = '';
for (let d = 1; d <= 365; d++) {
  const sig = d === 365 ? 1 : d + 1;
  const c = climaFijo('despejado', d, 0);
  const a = mezclar({ dia: d, hora: 23.99, urbanidad: 0.5, fuera: 0.7, clima: c });
  const b = mezclar({ dia: sig, hora: 0, urbanidad: 0.5, fuera: 0.7, clima: c });
  for (const k of CAPAS) {
    const s = Math.abs(a[k] - b[k]);
    if (s > saltoD) { saltoD = s; dondeD = `${k} dia ${d} -> ${sig}`; }
  }
}
assert.ok(saltoD < 0.03, `salto de ${saltoD.toFixed(4)} al pasar de medianoche: ${dondeD}`);

// Y la urbanidad, que es la que se cruza andando. 10 m de celda a 3 m/s son tres
// segundos: cualquier escalon aqui se oye como un corte al doblar una esquina.
let saltoU = 0;
for (const [d, h] of [[15, 9], [196, 22], [288, 14]]) {
  let prev = null;
  for (let u = 0; u <= 1.0001; u += 0.01) {
    const g = mezclar({ dia: d, hora: h, urbanidad: u, fuera: 0.7, clima: climaFijo('nubes', d, h) });
    if (prev) for (const k of CAPAS) saltoU = Math.max(saltoU, Math.abs(g[k] - prev[k]));
    prev = g;
  }
}
assert.ok(saltoU < 0.03, `salto de ${saltoU.toFixed(4)} al cruzar la urbanidad`);
console.log(`saltos maximos: hora ${saltoH.toFixed(4)}  dia ${saltoD.toFixed(4)}  urbanidad ${saltoU.toFixed(4)}`);

// --- 3. no satura ---------------------------------------------------------------

let pico = 0, dondeP = '';
for (let d = 1; d <= 365; d += 1) {
  for (let h = 0; h < 24; h += 0.5) {
    for (const u of [0, 0.35, 0.7, 1]) {
      for (const e of ESTADOS) {
        const g = mezclar({ dia: d, hora: h, urbanidad: u, fuera: 1, clima: climaFijo(e.key, d, h) });
        const p = Math.hypot(...CAPAS.map((k) => g[k]));
        if (p > pico) { pico = p; dondeP = `dia ${d} hora ${h} u ${u} ${e.key}`; }
      }
    }
  }
}
assert.ok(pico < 0.6, `la mezcla llega a ${pico.toFixed(3)} en potencia: ${dondeP}`);
console.log(`pico de potencia ${pico.toFixed(3)} (${dondeP})`);

// --- 4. que suene lo que toca ---------------------------------------------------

// Las tres de la madrugada en la dehesa, sin tiempo: viento y nada mas.
{
  const g = mezclar({ dia: 288, hora: 3, urbanidad: 0, fuera: 0.2, clima: climaFijo('despejado', 288, 3) });
  assert.ok(g.viento > 0.02, 'de noche en la dehesa no sopla ni el viento');
  for (const k of ['bullicio', 'pajaros', 'asiento', 'labra', 'fragua', 'lluvia', 'teja', 'lumbre', 'chicharra']) {
    assert.ok(g[k] < 0.005, `a las 3 en la dehesa suena ${k} a ${g[k].toFixed(3)}`);
  }
}

// El pueblo se oye en el pueblo y no en el campo.
for (const d of [15, 105, 196, 288]) {
  const c = climaFijo('nubes', d, 12);
  const calle = mezclar({ dia: d, hora: 12, urbanidad: 1, fuera: 1, clima: c });
  const campo = mezclar({ dia: d, hora: 12, urbanidad: 0, fuera: 1, clima: c });
  assert.ok(calle.bullicio > 4 * campo.bullicio + 0.05, `dia ${d}: el campo suena a pueblo`);
  assert.ok(campo.ganado > calle.ganado, `dia ${d}: hay mas ganado en la calle que en el campo`);
  assert.ok(campo.viento > calle.viento, `dia ${d}: las casas no cortan el viento`);
}

// Mas lluvia nunca puede sonar a menos.
{
  let prev = -1;
  for (const key of ['despejado', 'nubes', 'cubierto', 'lluvia', 'tormenta']) {
    const g = mezclar({ dia: 105, hora: 12, urbanidad: 0.5, fuera: 1, clima: climaFijo(key, 105, 12) });
    assert.ok(g.lluvia >= prev, `${key} suena a menos lluvia que el estado anterior`);
    prev = g.lluvia;
  }
}

// La obra: nunca de noche, nunca en domingo, y con helada se labra pero no se
// asienta -la cal no fragua bajo cero-.
for (let d = 1; d <= 365; d++) {
  for (let h = 0; h < 24; h += 0.5) {
    const c = clima(3, d, h);
    const o = trabajaLaObra(d, h, c);
    if (senoSol(d, h) < -0.05) assert.ok(o.labra < 0.01, `dia ${d} hora ${h}: se labra de noche`);
    if (diaSemana(d) === 0) assert.ok(o.labra === 0 && o.asiento === 0, `dia ${d}: se trabaja en domingo`);
    if (c.temp <= -1) assert.ok(o.asiento < 0.01, `dia ${d} hora ${h}: se asienta silleria a ${c.temp} grados`);
    assert.ok(o.asiento <= o.labra + 1e-9, `dia ${d} hora ${h}: se asienta mas de lo que se labra`);
  }
}
// Y que la helada no lo apague TODO: una manana de enero bajo cero tiene que
// oirse a mazo. Si esto falla, se ha vuelto al silencio, que era lo peor.
{
  let conMazo = 0;
  for (let d = 1; d <= 90; d++) {
    for (let h = 7.5; h <= 10; h += 0.5) {
      const c = clima(3, d, h);
      const o = trabajaLaObra(d, h, c);
      if (c.helada && o.labra > 0.5 && o.asiento < 0.1) conMazo++;
    }
  }
  assert.ok(conMazo > 0, 'ninguna manana de helada con labra: la obra se calla en vez de cambiar');
  console.log(`mananas de helada con mazo pero sin asiento: ${conMazo}`);
}

// Los grillos, en su sitio: noches de verano y no en enero.
for (const d of [15, 46, 350]) {
  for (let h = 0; h < 24; h += 0.5) {
    const g = mezclar({ dia: d, hora: h, urbanidad: 0, clima: climaFijo('despejado', d, h) });
    assert.ok(g.grillo < 0.005, `dia ${d} hora ${h}: grillos en invierno`);
  }
}
{
  const g = mezclar({ dia: 196, hora: 23, urbanidad: 0, clima: climaFijo('despejado', 196, 23) });
  assert.ok(g.grillo > 0.02, 'una noche de julio sin grillos');
  assert.ok(g.chicharra < 0.005, 'chicharras a las once de la noche');
  const m = mezclar({ dia: 196, hora: 15, urbanidad: 0, clima: { ...climaFijo('despejado', 196, 15), temp: 30 } });
  assert.ok(m.chicharra > 0.02, 'un mediodia de julio a 30 grados sin chicharras');
}

// La obra se oye en la obra. Es lo que se le olvida a una mezcla por zonas:
// una fuente que existe en un sitio concreto no puede sonar igual en el campo.
for (const d of [15, 105, 196, 288]) {
  const c = clima(3, d, 11);
  const calle = mezclar({ dia: d, hora: 11, urbanidad: 1, fuera: 1, clima: c });
  const campo = mezclar({ dia: d, hora: 11, urbanidad: 0, fuera: 1, clima: c });
  assert.ok(campo.labra < 0.005 && campo.asiento < 0.005,
    `dia ${d}: los mazos se oyen en el campo a ${campo.labra.toFixed(3)}`);
  assert.ok(campo.fragua < 0.005, `dia ${d}: la fragua se oye en el campo`);
  if (calle.labra > 0) assert.ok(calle.labra > campo.labra, `dia ${d}: la obra no se oye en la obra`);
}

// Los pajaros callan bajo lluvia fuerte.
for (const d of [105, 196]) {
  const g = mezclar({ dia: d, hora: 11, urbanidad: 0.3, clima: climaFijo('tormenta', d, 11) });
  assert.ok(g.pajaros < 0.005, `dia ${d}: pajaros en plena tormenta`);
}

// Ley de Dolbear: el grillo es un termometro.
assert.ok(Math.abs(pulsoGrillo(20) - pulsoGrillo(10) - 3.0) < 1e-9, 'el grillo no late con la temperatura');
assert.ok(pulsoGrillo(-5) > 0, 'pulso de grillo negativo');

// --- la campana -----------------------------------------------------------------

// El calendario juliano, contra un dato que se puede comprobar: el ultimo dia
// del calendario juliano en Espana fue el jueves 4 de octubre de 1582, y al dia
// siguiente ya era viernes 15. 1582 es bisiesto tambien en juliano.
{
  const bisiesto = (y) => y % 4 === 0;                    // regla juliana, sin la excepcion del siglo
  let d = 0;                                               // dias transcurridos desde el 1/1/1570
  for (let y = 1570; y < 1582; y++) d += bisiesto(y) ? 366 : 365;
  d += 31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30 + (4 - 1);   // 1582 no es bisiesto: 1582 % 4 = 2
  assert.strictEqual(d % 7, 4, `la cuenta de dias hasta el 4/10/1582 da ${d % 7} y no 4`);
  assert.strictEqual(diaSemana(1), 0, 'el 1 de enero de 1570 no sale domingo');
  assert.strictEqual((diaSemana(1) + d) % 7, 4, 'el 4 de octubre de 1582 no cae en jueves');
}

// Ocho campanadas al dia, ni una mas ni una menos, en los 365 dias del ano.
for (let d = 1; d <= 365; d++) {
  const suenan = [];
  let antes = 0;
  for (let i = 1; i <= 480; i++) {                        // paso de 3 minutos
    const h = i * 24 / 480;
    const c = tocaCampana(antes, h % 24, d);
    if (c) suenan.push(c);
    antes = h % 24;
  }
  assert.strictEqual(suenan.length, 8, `dia ${d}: ${suenan.length} campanadas (${suenan.join(', ')})`);
  assert.strictEqual(new Set(suenan).size, 8, `dia ${d}: alguna hora suena dos veces`);
}

// Laudes al amanecer, en los 365 dias. Es lo que hace que en enero suene a otra
// hora que en junio, y por el mismo motivo por el que sonaba distinto de verdad.
for (let d = 1; d <= 365; d++) {
  const [orto] = ortoOcaso(d);
  const laudes = horasCanonicas(d).find(([n]) => n === 'laudes')[1];
  assert.ok(Math.abs(laudes - orto) < 1e-9, `dia ${d}: laudes no cae en el orto`);
  const tercia = horasCanonicas(d).find(([n]) => n === 'tercia')[1];
  assert.ok(tercia > orto && tercia < 12, `dia ${d}: tercia a las ${tercia}`);
}
// Y que las horas temporales de verdad se muevan: tercia de junio y de diciembre
// no pueden caer a la misma hora de reloj.
{
  const t6 = horasCanonicas(172).find(([n]) => n === 'tercia')[1];
  const t12 = horasCanonicas(355).find(([n]) => n === 'tercia')[1];
  assert.ok(t12 - t6 > 1.0, `tercia se mueve solo ${(t12 - t6).toFixed(2)} h entre junio y diciembre`);
  console.log(`tercia: ${t6.toFixed(2)} en junio, ${t12.toFixed(2)} en diciembre`);
}

// Arrastrar el deslizador de la hora de punta a punta suena UNA vez, no doce.
assert.strictEqual(tocaCampana(6, 18, 196), 'nona', 'un salto grande encadena campanadas');
assert.strictEqual(tocaCampana(12, 12, 196), null, 'sin avanzar el reloj y suena la campana');

// --- la rejilla de urbanidad ----------------------------------------------------

// Bilineal contra una rejilla de mentira: continua, y sin salirse por los bordes.
{
  const W = 8, H = 6, C = 10;
  const rej = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) rej[j * W + i] = (i + j) % 2;
  let prev = null, salto = 0;
  for (let x = -50; x < W * C + 50; x += 0.2) {
    const v = muestrear(rej, W, H, C, x, 27);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `muestrear en x=${x} da ${v}`);
    if (prev !== null) salto = Math.max(salto, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(salto < 0.05, `la rejilla salta ${salto.toFixed(3)} en 0,2 m: no es bilineal`);
  // En el centro de una celda devuelve su valor exacto, o el desenfoque estaria
  // desplazado media celda y el pueblo sonaria 5 m corrido.
  assert.ok(Math.abs(muestrear(rej, W, H, C, 25, 25) - rej[2 * W + 2]) < 1e-6, 'la rejilla va corrida');
}

// La franja circular no tiene costura a medianoche.
{
  let prev = franja(24 - 0.001, 21, 5), salto = 0;
  for (let h = 0; h < 24; h += 0.01) {
    const v = franja(h, 21, 5);
    salto = Math.max(salto, Math.abs(v - prev));
    prev = v;
  }
  // El techo es la pendiente de la propia rampa: un smoothstep de un borde de 1 h
  // sube como mucho 1,5 por hora, o sea 0,015 en un paso de 0,01 h. Cualquier cosa
  // por encima ya no es la rampa, es la costura.
  assert.ok(salto < 0.016, `franja salta ${salto.toFixed(3)}: costura a medianoche`);
}

console.log('ambiente: todo en verde');
