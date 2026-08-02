// Comprobacion del asiento de las casas: `node web/casas.test.mjs`, o `make casas`.
//
// Corre contra las 3.545 casas de VERDAD, no contra un pueblo de mentira, porque
// los fallos que esto tiene que cazar salen de la forma del terreno y no de la
// logica: una casa larga cruzada en una ladera, una huella con un lomo en medio,
// un `base` de OSM que en una cuesta fuerte queda por encima del suelo.
//
// Los cuatro asertos son cuatro fallos que ya pasaron y que se midieron a mano
// DESPUES de verlos en una captura. Escritos aqui, el siguiente lo caza un `make`
// en dos segundos.
//
// Cada medida imprime su PEOR caso aunque pase. Una medida que se queda en cero
// deja de avisar de lo que empeora por debajo del umbral hasta que ya se ve desde
// la calle; es el mismo criterio que la prueba de cubiertas colgadas de ?test.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { asiento, cotasDeHuella, muestreador, MAX_STOREYS, STOREY_H } from './casas.js';

const BUILD = new URL('../data/build/', import.meta.url);
const mundo = JSON.parse(readFileSync(new URL('world.json', BUILD), 'utf8'));
const crudo = readFileSync(new URL(mundo.dem.file, BUILD));
// El .bin es un Float32Array plano tal cual, sin cabecera: se lee prestado del
// Buffer, sin copiar los 1,2 MB.
const heights = new Float32Array(crudo.buffer, crudo.byteOffset,
  crudo.byteLength / 4);
assert.strictEqual(heights.length, mundo.dem.w * mundo.dem.h,
  'el heightmap no cuadra con dem.w/h');

const heightAt = muestreador(heights, mundo.dem.w, mundo.dem.h,
  mundo.size_m[0] / mundo.dem.w);

// --- 1. ninguna casa enterrada ---------------------------------------------
//
// El muro tiene que asomar por TODOS lados. Si `top` queda por debajo del terreno
// en algun punto de la huella, ahi la casa es un tejado saliendo de la tierra.
// Con el suelo anclado al terreno mas bajo -que se probo un rato- fallaban 116 y
// la peor por 16,7 m.

let peorEnterrada = -Infinity, dondeEnt = 0, nEnt = 0;
// --- 2. ningun muro en el aire ---------------------------------------------
let peorVuelo = -Infinity, dondeVuelo = 0, nVuelo = 0;
// --- 3. ninguna franja ciega -----------------------------------------------
//
// La cota desde la que mide el sombreador va por vertice y sale del terreno bajo
// ese mismo vertice, asi que por construccion no puede despegarse. Lo que se
// comprueba es que el muro llegue de verdad desde ahi hasta arriba: si `top`
// quedara por debajo del suelo local, ese trozo de fachada no tendria ni zocalo
// ni hiladas ni huecos.
let peorCiega = -Infinity, dondeCiega = 0, nCiega = 0;
// --- 4. plantas y alturas posibles -----------------------------------------
let minAlto = Infinity, maxAlto = -Infinity;

for (const b of mundo.buildings) {
  const flat = b.p;
  if (flat.length < 6) continue;
  const a = asiento(flat, heightAt, b);

  const enterrada = a.sueloMax - a.top;              // >0 = el terreno tapa el muro
  if (enterrada > peorEnterrada) { peorEnterrada = enterrada; dondeEnt = b.i; }
  if (enterrada > -0.5) nEnt++;

  const vuelo = a.base - a.sueloMin;                 // >0 = el muro no llega al suelo
  if (vuelo > peorVuelo) { peorVuelo = vuelo; dondeVuelo = b.i; }
  if (vuelo > 0) nVuelo++;

  // Alto de fachada a la vista en el punto mas alto de la huella: lo que le
  // queda al sombreador para pintar plantas.
  const aLaVista = a.top - a.sueloMax;
  if (-aLaVista > peorCiega) { peorCiega = -aLaVista; dondeCiega = b.i; }
  if (aLaVista < STOREY_H * 0.9) nCiega++;

  assert.ok(a.plantas >= 1 && a.plantas <= MAX_STOREYS,
    `casa ${b.i}: ${a.plantas} plantas`);
  const alto = a.top - a.base;
  minAlto = Math.min(minAlto, alto);
  maxAlto = Math.max(maxAlto, alto);
}

assert.ok(peorEnterrada <= 0,
  `casa ${dondeEnt}: el terreno tapa el muro por ${peorEnterrada.toFixed(1)} m`
  + ` (${nEnt} casas a menos de medio metro de estarlo)`);
assert.ok(peorVuelo <= 0,
  `casa ${dondeVuelo}: el muro arranca ${peorVuelo.toFixed(1)} m por encima del suelo`);
assert.ok(nCiega === 0,
  `${nCiega} casas con menos de una planta de fachada a la vista; la peor,`
  + ` ${dondeCiega}, se queda en ${(-peorCiega).toFixed(1)} m`);

// El alto total incluye lo enterrado, asi que el techo es generoso a proposito:
// lo que se vigila es que no haya una torre de veinte plantas por un `h` raro de
// OSM, no el detalle.
assert.ok(maxAlto < 60, `hay una casa de ${maxAlto.toFixed(0)} m de muro`);
assert.ok(minAlto > 1.0, `hay una casa de ${minAlto.toFixed(1)} m de muro`);

// --- 5. determinista --------------------------------------------------------
for (const b of mundo.buildings.slice(0, 200)) {
  assert.deepStrictEqual(asiento(b.p, heightAt, b), asiento(b.p, heightAt, b),
    `casa ${b.i}: el asiento no repite`);
}

// --- 6. el muestreo de aristas sirve para algo ------------------------------
//
// Si solo se miraran los vertices, una casa con un lomo en medio daria un
// desnivel menor del que tiene. Se comprueba que en el pueblo real eso pasa de
// verdad, o el `porArista` seria adorno.
let ganan = 0, masDesnivel = 0;
for (const b of mundo.buildings) {
  const soloVertices = cotasDeHuella(b.p, heightAt, 1);
  const conAristas = cotasDeHuella(b.p, heightAt, 4);
  const d = (conAristas.max - conAristas.min) - (soloVertices.max - soloVertices.min);
  if (d > 0.25) ganan++;
  masDesnivel = Math.max(masDesnivel, d);
}
assert.ok(ganan > 0, 'muestrear las aristas no cambia nada: sobra');

console.log(`OK: ${mundo.buildings.length} casas`
  + ` | ninguna enterrada (la mas justa, ${dondeEnt}, saca ${(-peorEnterrada).toFixed(1)} m)`
  + ` | ningun muro en el aire (el mas justo, ${dondeVuelo}, entierra ${(-peorVuelo).toFixed(1)} m)`
  + ` | fachada a la vista minima ${(-peorCiega).toFixed(1)} m`
  + ` | muro de ${minAlto.toFixed(1)} a ${maxAlto.toFixed(0)} m`);
console.log(`OK: muestrear las aristas descubre desnivel en ${ganan} huellas,`
  + ` hasta ${masDesnivel.toFixed(1)} m que los vertices no ven`);
