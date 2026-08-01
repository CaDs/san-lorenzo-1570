// El clima de esta sierra.
//
// El pueblo estaba congelado en un solo dia: daynight.js calcula la posicion
// solar de verdad a partir del dia del ano, pero ese dia estaba clavado en el
// 300 y no se podia mover. La maquinaria para tener las cuatro estaciones ya
// estaba escrita y no se usaba.
//
// Esto NO es una clase con estado. Es una funcion pura de (semilla, dia, hora),
// y esa es la decision de diseno que manda sobre todo lo demas: `?hour=14&dia=20`
// tiene que dar un mundo correcto EN EL PRIMER FOTOGRAMA. Un integrador con
// memoria -acumular lluvia, suavizar hacia un objetivo, contar cuanto lleva
// asi- deja el clima donde estuviera cuando te teletransportas en el tiempo, y
// entonces el panel de la barra miente durante el primer minuto. Con funcion
// pura cualquier instante es consultable y no hay nada que sincronizar.
//
// Nada de THREE aqui: son tablas y aritmetica. Asi lo puede importar tramas.js
// -que se prueba con node- y asi se puede probar esto mismo (clima.test.mjs).

import { mezcla } from './dialogos.js';

// --- lo que de verdad hace el tiempo aqui -------------------------------------
//
// Serie de la estacion del Monasterio de San Lorenzo, a 1028 m: precipitacion
// desde 1946, temperatura desde 1973. Los pesos de cada estado NO se escriben a
// mano: se derivan de esta tabla. Asi el numero que hay que discutir es el
// observado, que se puede contrastar con la fuente, y no un peso inventado por
// mi que nadie sabe de donde sale.
//
// Fuente: Meteosierra / AEMET, estacion Monasterio de San Lorenzo de El Escorial.
// https://meteosierra.com/climatologia/sistema-central/san-lorenzo-de-el-escorial/
//
// Lo que estos numeros corrigen de lo que uno supondria:
//   - Las heladas son 30 al ano, no las 60-80 que parece que toquen a 1030 m.
//   - Las tormentas son de MAYO y JUNIO, no de agosto: julio y agosto son los
//     meses secos del ano (2,8 y 3,5 dias de precipitacion) y no hay de que.
//   - La niebla son 59 dias al ano, con el pico en noviembre, diciembre y enero.
//     Es el meteoro mas frecuente de todos despues de la lluvia, y aqui es el
//     mas rentable de tener: hay un edificio de 200 m al que tragarse.
//   - El mes mas lluvioso es noviembre (110 mm), no diciembre ni enero.
const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const OBSERVADO = {
  //          E     F     M     A     M     J     J     A     S     O     N     D
  precip: [10.7, 10.7, 11.0, 12.1, 10.8, 6.7, 3.5, 2.8, 6.2, 10.7, 11.1, 11.2],
  nieve: [4.0, 4.7, 2.5, 1.6, 0.3, 0.0, 0.0, 0.0, 0.0, 0.2, 1.4, 2.7],
  tormenta: [0.0, 0.1, 0.5, 1.4, 3.5, 3.8, 3.3, 2.2, 3.0, 0.9, 0.2, 0.0],
  niebla: [8.5, 6.6, 5.5, 5.6, 4.4, 1.8, 0.8, 0.4, 1.6, 6.5, 8.6, 8.9],
  // Temperatura media, media de las maximas y media de las minimas.
  tMedia: [5.7, 6.4, 8.6, 10.4, 13.8, 19.9, 23.4, 23.3, 19.5, 14.0, 9.0, 6.7],
  tMax: [9.2, 10.2, 12.9, 15.0, 18.8, 25.6, 29.5, 29.2, 25.0, 18.4, 12.7, 10.3],
  tMin: [2.2, 2.6, 4.2, 5.8, 8.8, 14.1, 17.1, 17.3, 14.0, 9.5, 5.2, 3.2],
};

// Cuanto ha amarilleado el pasto, por mes. Es la senal de estacion mas visible
// del termino -mas que los arboles, que aqui son de hoja perenne- y sigue al
// regimen de lluvias de arriba con retraso: junio con 36 mm ya lo agosta, julio
// y agosto con 15 y 17 lo dejan pajizo, y las lluvias de octubre (99 mm) lo
// vuelven a levantar en unas semanas. Los valores son criterio, el calendario
// que siguen no.
const SECO = [0.05, 0.05, 0.00, 0.00, 0.10, 0.45, 0.85, 1.00, 0.85, 0.40, 0.10, 0.05];

// Reparto del cielo cuando NO precipita ni hay niebla: despejado, nubes,
// cubierto. Esto SI es criterio y no dato -la serie no da nubosidad media-, asi
// que va marcado como tal: veranos de meseta despejados, inviernos repartidos.
const CIELO_SECO = [
  [0.40, 0.33, 0.27], [0.40, 0.34, 0.26], [0.40, 0.36, 0.24], [0.36, 0.38, 0.26],
  [0.40, 0.38, 0.22], [0.60, 0.30, 0.10], [0.72, 0.24, 0.04], [0.72, 0.24, 0.04],
  [0.58, 0.30, 0.12], [0.44, 0.34, 0.22], [0.38, 0.34, 0.28], [0.38, 0.34, 0.28],
];

// --- los estados --------------------------------------------------------------
//
// `nublado` mata el sol y las estrellas; `niebla` es un multiplicador sobre la
// densidad de la niebla que ya existe en daynight.js. Son ejes separados porque
// la niebla de estancamiento de aqui viene con el cielo tapado pero tambien se
// levanta a media manana dejando un dia raso, y la tormenta de junio tapa el
// cielo entero sin quitar visibilidad horizontal.
export const ESTADOS = [
  { key: 'despejado', nombre: 'despejado', lluvia: 0, nieve: 0, nublado: 0.05, niebla: 1.0 },
  { key: 'nubes', nombre: 'nubes', lluvia: 0, nieve: 0, nublado: 0.40, niebla: 1.2 },
  { key: 'cubierto', nombre: 'cubierto', lluvia: 0, nieve: 0, nublado: 0.92, niebla: 1.8 },
  // A densidad x9 el Monasterio desaparece a unos 150 m, que es lo que hace en
  // noviembre desde la carretera de la estacion.
  { key: 'niebla', nombre: 'niebla', lluvia: 0, nieve: 0, nublado: 0.85, niebla: 9.0 },
  { key: 'lluvia', nombre: 'lluvia', lluvia: 0.70, nieve: 0, nublado: 0.95, niebla: 3.0 },
  { key: 'tormenta', nombre: 'tormenta', lluvia: 1.00, nieve: 0, nublado: 1.00, niebla: 3.6 },
  { key: 'nieve', nombre: 'nieve', lluvia: 0, nieve: 0.60, nublado: 0.97, niebla: 4.0 },
];

const I_NUBES = 1, I_NIEBLA = 3, I_LLUVIA = 4, I_TORMENTA = 5, I_NIEVE = 6;

// La tormenta de tarde es de tarde. Sin esta puerta salen tormentas a las cuatro
// de la manana, que aqui no pasa: son de calor y revientan entre las dos y las
// nueve. Se dobla el peso en los bloques que si valen para que la puerta no
// reduzca a la mitad los 18,9 dias de tormenta al ano que hay que reproducir.
const BLOQUES_TORMENTA = [false, false, true, true];

// --- estaciones ----------------------------------------------------------------

const ESTACIONES = [
  { nombre: 'invierno', desde: 335, hasta: 79 },
  { nombre: 'primavera', desde: 79, hasta: 171 },
  { nombre: 'verano', desde: 171, hasta: 265 },
  { nombre: 'otoño', desde: 265, hasta: 335 },
];

export function estacionDe(dia) {
  const d = ((Math.floor(dia) % 365) + 365) % 365;
  for (const e of ESTACIONES) {
    const dentro = e.desde < e.hasta
      ? (d >= e.desde && d < e.hasta)
      : (d >= e.desde || d < e.hasta);
    if (dentro) return e.nombre;
  }
  return 'primavera';
}

// El mes (0..11) de un dia del ano. Aproximado y a proposito: la serie es
// mensual, y afinar el reparto de dias por mes no cambia ni un peso.
export function mesDe(dia) {
  const d = ((Math.floor(dia) % 365) + 365) % 365;
  let acc = 0;
  for (let m = 0; m < 12; m++) {
    acc += DIAS_MES[m];
    if (d < acc) return m;
  }
  return 11;
}

// El pasto seco, interpolado entre los centros de mes para que el paso de julio
// a agosto no sea un escalon en el color de media sierra.
export function secoDe(dia) {
  const d = ((dia % 365) + 365) % 365;
  // Centro de cada mes en dias del ano, y donde cae `d` entre dos centros.
  let centro = 0;
  for (let m = 0; m < 12; m++) {
    const c = centro + DIAS_MES[m] / 2;
    const prev = m === 0 ? -DIAS_MES[11] / 2 : centro - DIAS_MES[m - 1] / 2;
    if (d < c) {
      const t = (d - prev) / (c - prev);
      return SECO[(m + 11) % 12] + (SECO[m] - SECO[(m + 11) % 12]) * t;
    }
    centro += DIAS_MES[m];
  }
  return SECO[11];
}

// --- de dias observados a peso por bloque --------------------------------------

// Un observador apunta "hoy ha nevado", no "ha nevado en el bloque de las 12".
// Si cada uno de los 4 bloques del dia tira por su cuenta con probabilidad p, la
// probabilidad de que el dia entero tenga al menos uno es 1-(1-p)^4. Se invierte
// eso para pasar de los dias al mes que da la serie al peso que necesita el dado.
function pBloque(diasAlMes, mes) {
  const d = Math.min(Math.max(diasAlMes, 0) / DIAS_MES[mes], 0.999);
  return 1 - Math.pow(1 - d, 0.25);
}

// Pesos de los 7 estados para un mes, derivados de OBSERVADO. Se calcula una vez
// al cargar: son 12 vectores de 7 numeros y no cambian nunca.
const PESOS = Array.from({ length: 12 }, (_, m) => {
  const nieve = pBloque(OBSERVADO.nieve[m], m);
  const tormenta = pBloque(OBSERVADO.tormenta[m], m);
  // La columna de precipitacion incluye los dias de nieve y los de tormenta, asi
  // que la lluvia a secas es lo que queda al descontarlos. Con la columna de
  // >1 mm esto se iba a negativo en julio -3,3 dias de tormenta y solo 2,2 de
  // lluvia apreciable, porque la tormenta de verano descarga poco o nada-, de
  // ahi que la tabla guarde la de >0 mm.
  const lluvia = pBloque(
    OBSERVADO.precip[m] - OBSERVADO.nieve[m] - OBSERVADO.tormenta[m], m);
  const niebla = pBloque(OBSERVADO.niebla[m], m);
  const resto = Math.max(0, 1 - nieve - tormenta - lluvia - niebla);
  const [desp, nub, cub] = CIELO_SECO[m];
  return [resto * desp, resto * nub, resto * cub, niebla, lluvia, tormenta, nieve];
});

// --- el dado --------------------------------------------------------------------
//
// Mismos canales que tramas.js y por la misma razon: si dos decisiones comparten
// contador, la posicion de una depende de lo que haya gastado la otra y lo que
// se recorre de la tabla del mezclador es una diagonal en vez de una fila. Alli
// se vio de lejos -de 3618 llegadas, la mas repetida salia 1013 veces y la menos
// 258, con 603 de media- y aqui pasaria igual.
const CANAL_ESTADO = 0x63;
const CANAL_TEMP = 0x64;

// Bits altos y no `% n`: `mezcla` acaba en una multiplicacion, que solo arrastra
// los acarreos hacia arriba, asi que los bits de abajo son los que menos se mueven.
function unidad(semilla, canal, k) {
  return mezcla(semilla, canal, k) / 4294967296;
}

// Que estado toca en un bloque de 6 h. `bloque` es global y creciente, asi que
// dos dias distintos del mismo mes no comparten tirada.
function estadoDe(semilla, bloque) {
  const dia = Math.floor(bloque / 4);
  const franja = bloque - dia * 4;
  const w = PESOS[mesDe(dia)].slice();

  // La puerta de la tormenta, redistribuida para no perder frecuencia anual.
  if (BLOQUES_TORMENTA[franja]) w[I_TORMENTA] *= 2;
  else { w[I_NUBES] += w[I_TORMENTA]; w[I_TORMENTA] = 0; }

  let total = 0;
  for (const x of w) total += x;
  let r = unidad(semilla, CANAL_ESTADO, bloque) * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return ESTADOS[i];
  }
  return ESTADOS[0];
}

// --- temperatura -----------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;

function suave(de, a, x) {
  const t = clamp((x - de) / (a - de), 0, 1);
  return t * t * (3 - 2 * t);
}

// Temperatura en grados. Media del mes + onda diaria + anomalia del dia.
//
// La anomalia hace falta y no es adorno: sin ella, la minima de enero seria
// SIEMPRE 2,2 grados -la media de las minimas- y entonces o hiela todos los dias
// o no hiela ninguno. Lo que hay que reproducir son 9 heladas en enero de 31
// dias, y eso solo sale si unos dias son mas frios que otros.
function temperatura(semilla, dia, hora, nublado) {
  const m = mesDe(dia);
  const media = OBSERVADO.tMedia[m];
  // Con el cielo tapado el dia no se calienta ni la noche se enfria: la nube
  // aplana la onda diaria, y es justo por eso que las heladas caen en noche rasa.
  const amp = (OBSERVADO.tMax[m] - OBSERVADO.tMin[m]) * (1 - 0.45 * nublado);
  // Maximo a las 16, minimo a las 4.
  const onda = Math.cos(TAU * (hora - 16) / 24) * amp * 0.5;
  const anomalia = (unidad(semilla, CANAL_TEMP, Math.floor(dia)) - 0.5) * 9.0;
  // Enfriamiento por radiacion: la noche rasa pierde calor al cielo y la nublada
  // no. Es lo que pone la escarcha en el suelo, y ata la helada al estado del
  // cielo en vez de dejarla como un sorteo aparte.
  const esNoche = (Math.cos(TAU * (hora - 3) / 24) + 1) * 0.5;
  const raso = -2.2 * (1 - nublado) * esNoche;
  return media + onda + anomalia + raso;
}

// --- nieve cuajada ----------------------------------------------------------------

// Cuanta nieve hay en el suelo, 0..1. Es lo unico con inercia, y se resuelve
// MIRANDO HACIA ATRAS en vez de acumulando: se recorren los tres ultimos dias
// sumando lo que cayo y restando lo que se derritio. Doce hashes por llamada, y
// la funcion sigue siendo pura, que es lo que permite saltar a cualquier fecha.
//
// La serie da 17,5 dias de nevada al ano y solo 8,9 con el suelo cubierto: aqui
// la nieve cuaja la mitad de las veces y se va pronto. El deshielo esta calibrado
// contra ese par de numeros.
const BLOQUES_ATRAS = 12;

function cuajada(semilla, bloque) {
  let c = 0;
  for (let k = BLOQUES_ATRAS; k >= 0; k--) {
    const b = bloque - k;
    if (b < 0) continue;
    const e = estadoDe(semilla, b);
    const dia = Math.floor(b / 4);
    const hora = (b - dia * 4) * 6 + 3;
    const frio = suave(11, -1, temperatura(semilla, dia, hora, e.nublado));
    // Deshiela deprisa en cuanto templa, y casi nada si sigue helando.
    c = Math.max(0, c - (0.05 + 0.55 * (1 - frio)));
    // Y solo cuaja si el suelo esta frio: nevar sobre suelo a diez grados no
    // deja nada, que es la mitad de las nevadas de marzo.
    c = Math.min(1, c + e.nieve * frio * 1.1);
  }
  return c;
}

// --- la respuesta ------------------------------------------------------------------

function salida(estado, semilla, dia, hora, bloque) {
  const t = temperatura(semilla, dia, hora, estado.nublado);
  return {
    dia,
    estado: estado.key,
    nombre: estado.nombre,
    lluvia: estado.lluvia,
    nieve: estado.nieve,
    nublado: estado.nublado,
    niebla: estado.niebla,
    cubierta: cuajada(semilla, bloque),
    seco: secoDe(dia),
    temp: t,
    frio: suave(11, -2, t),
    helada: t <= 0,
    estacion: estacionDe(dia),
  };
}

// Un estado impuesto a mano desde la barra o por `?clima=`. Pasa por el mismo
// constructor de salida que el automatico: no hay dos caminos de codigo, asi que
// no puede haber un campo que solo se rellene por uno de los dos.
export function climaFijo(key, dia, hora, semilla = 1) {
  const e = ESTADOS.find((x) => x.key === key);
  if (!e) return null;
  const bloque = Math.floor(dia) * 4 + Math.floor(clamp(hora, 0, 23.999) / 6);
  const out = salida(e, semilla, dia, hora, bloque);
  // Si te empenas en poner nieve, hay nieve en el suelo: mirar los tres dias de
  // atras diria que no ha nevado y dejaria el pueblo verde bajo la nevada. Y a
  // 0,9 y no a 0,75 porque la cota a la que cuaja baja con la cantidad: con 0,75
  // la linea de nieve se queda por encima del pueblo y solo se blanquea el monte,
  // que no es lo que espera nadie que acaba de pulsar "nieve".
  if (e.nieve > 0) out.cubierta = Math.max(out.cubierta, 0.9);
  return out;
}

// El clima en un instante. Determinista: misma semilla, mismo dia y misma hora,
// mismo tiempo, se llegue cuando se llegue.
export function clima(semilla, dia, hora) {
  const h = clamp(hora, 0, 23.999);
  const d = Math.floor(dia);
  const franja = Math.floor(h / 6);
  const bloque = d * 4 + franja;

  const actual = estadoDe(semilla, bloque);
  const siguiente = estadoDe(semilla, bloque + 1);
  // Las ultimas dos horas del bloque van cambiando hacia el siguiente. Sin esto
  // la lluvia arranca y para de golpe cada seis horas, que es lo unico que
  // delata que detras hay una rejilla; y no hace falta easing con memoria, que
  // es lo que impediria saltar de fecha.
  //
  // Dos horas y no hora y media porque con hora y media el cambio mas brusco
  // posible -de seco a tormenta- da 0,0499 por cada 0,05 h, y el limite que se
  // comprueba es 0,05: pasaba raspando y habria acabado fallando solo.
  const f = suave(0.667, 1.0, (h - franja * 6) / 6);

  const a = salida(actual, semilla, d, h, bloque);
  if (f <= 0) return a;
  const b = salida(siguiente, semilla, d, h, bloque + 1);

  a.lluvia = lerp(a.lluvia, b.lluvia, f);
  a.nieve = lerp(a.nieve, b.nieve, f);
  a.nublado = lerp(a.nublado, b.nublado, f);
  a.niebla = lerp(a.niebla, b.niebla, f);
  // El nombre no se interpola: a mitad de camino se pasa a decir el que viene.
  if (f > 0.5) { a.estado = b.estado; a.nombre = b.nombre; }
  return a;
}
