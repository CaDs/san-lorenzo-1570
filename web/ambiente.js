// Que deberia oirse, en numeros. Este fichero NO toca Web Audio: entra el
// mundo -hora, dia, donde estas, que tiempo hace, cuanta gente hay fuera- y
// salen ganancias de 0 a 1. El grafo de audio va aparte, en sonido.js.
//
// El reparto es el mismo que ya hay entre clima.js (puro, con su test de node) y
// daynight.js (el que toca THREE), y aqui vale doble: el sonido no se revisa
// leyendo el codigo ni mirando una captura. Si la decision de que suena vive en
// una funcion pura, se comprueba con `make sonido` y no hace falta oir nada para
// saber que a las tres de la madrugada en la dehesa no suena el bullicio del
// pueblo.
//
// Dos cosas mandan sobre todo lo demas y estan aqui, no en el grafo:
//
//   - Nada de escalones. Todo lo que abre y cierra pasa por una rampa suave. Un
//     salto de ganancia se oye como un click, y las ventanas de horas y de
//     estaciones son escalones si no se suavizan a mano.
//   - Las capas suman en POTENCIA, no en amplitud, porque son ruidos no
//     correlados. Lo que no puede pasarse es hypot(...ganancias), no la suma.

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// La misma rampa de clima.js: smoothstep, con derivada cero en los dos extremos.
// Es lo que evita el click.
export function suave(de, a, x) {
  const t = clamp((x - de) / (a - de), 0, 1);
  return t * t * (3 - 2 * t);
}

// Ventana sobre el reloj de 24 h, con bordes suaves y sin costura a medianoche.
// El intervalo puede cruzar las doce (los grillos van de 21 a 5).
export function franja(hora, de, a, borde = 1) {
  const mod = (x) => ((x % 24) + 24) % 24;
  const ancho = mod(a - de);
  let p = mod(hora - de);
  // Fuera de la ventana p vale casi 24; se pasa a negativo para que la rampa de
  // entrada tenga por donde subir. El corte se pone en mitad del hueco, que es
  // donde las dos rampas ya valen cero y no hay salto.
  if (p > (ancho + 24) * 0.5) p -= 24;
  return suave(-borde, 0, p) * suave(ancho + borde, ancho, p);
}

// --- el sol, sin THREE ----------------------------------------------------------
//
// La misma astronomia que directionToSun() en daynight.js, pero sin vectores:
// aqui solo hacen falta el seno de la altura -para saber si es de dia- y las dos
// horas en que cruza el horizonte, que son las que anclan las horas canonicas.

const LAT = 40.5915;                       // San Lorenzo

function declinacion(dia) {
  return (23.44 * Math.PI / 180) * Math.sin(TAU * (dia - 81) / 365);
}

export function senoSol(dia, hora, lat = LAT) {
  const f = lat * Math.PI / 180, d = declinacion(dia);
  const h = (hora - 12) * 15 * Math.PI / 180;
  return clamp(Math.sin(d) * Math.sin(f) + Math.cos(d) * Math.cos(f) * Math.cos(h), -1, 1);
}

// Orto y ocaso en horas locales. El coseno del angulo horario del orto sale de
// igualar la altura a cero; en esta latitud nunca se sale de [-1, 1], pero se
// recorta igual porque un acos de 1.0001 devuelve NaN y un NaN en una ganancia
// envenena ese AudioParam para siempre.
export function ortoOcaso(dia, lat = LAT) {
  const f = lat * Math.PI / 180, d = declinacion(dia);
  const c = clamp(-Math.tan(d) * Math.tan(f), -1, 1);
  const H = Math.acos(c) * 180 / Math.PI / 15;
  return [12 - H, 12 + H];
}

// --- el calendario --------------------------------------------------------------
//
// El domingo no se labra, y para saber que dia es hace falta un ancla de verdad.
// El pueblo es de hacia 1570 y Espana no cambia al calendario gregoriano hasta
// octubre de 1582, asi que la cuenta es juliana, con la regla de bisiestos sin la
// excepcion del siglo. El ancla se comprueba en el test contando dias hacia atras
// desde el jueves 4 de octubre de 1582 -el ultimo dia juliano de Espana, al que
// siguio el viernes 15-: sale que el 1 de enero de 1570 cayo en domingo.
const SEMANA_1570 = 0;                     // 0 = domingo

export function diaSemana(dia) {
  return (SEMANA_1570 + dia - 1) % 7;
}

// --- las horas del oficio -------------------------------------------------------
//
// Los jeronimos se definen por las ocho horas del coro, asi que esto no es
// adorno: es lo mas caracteristico de quien vivia ahi. Y eran horas TEMPORALES:
// el trecho de luz partido en doce, asi que la hora tercia de enero no cae a la
// misma hora de reloj que la de junio. Eso es exactamente lo que el juego ya
// calcula con el orto y el ocaso reales.
export function horasCanonicas(dia, lat = LAT) {
  const [orto, ocaso] = ortoOcaso(dia, lat);
  const h = (ocaso - orto) / 12;           // una hora temporal
  return [
    ['maitines', 2.0],                     // de madrugada, esta si va a reloj
    ['laudes', orto],
    ['prima', orto + h],
    ['tercia', orto + 3 * h],
    ['sexta', orto + 6 * h],
    ['nona', orto + 9 * h],
    ['visperas', orto + 11 * h],
    ['completas', ocaso + 0.6],
  ];
}

// Devuelve el nombre de la hora que se acaba de cruzar, o null. Se dispara por
// cruce, no por proximidad, o con el reloj corriendo sonaria en cada fotograma.
//
// Y si el salto es grande -arrastrar el deslizador de la hora en la barra- suena
// SOLO la ultima cruzada. Sin esto, mover el deslizador de las seis a las seis
// encadena doce campanadas seguidas.
//
// El intervalo es (antes, ahora], abierto por la izquierda, y eso NO es un
// detalle: sexta cae en las 12,00 clavadas, y con el intervalo cerrado por los
// dos lados la campana sonaba dos veces seguidas porque mod(12,05 - 12) sale
// 0,04999...  y el paso del reloj sale 0,05000...1. Un aserto de ocho campanadas
// al dia lo caza; a oido, no.
export function tocaCampana(antes, ahora, dia, lat = LAT) {
  // Y el modulo se escribe asi, no como ((x % 24) + 24) % 24: sexta sale de una
  // division y vale 12,000000000000002, o sea 2e-15 por encima de las doce en
  // punto. Sumarle 24 a ese 2e-15 no cabe en un double, redondea a 24 clavado, y
  // el resto acaba siendo 0: la campana se caia por el aserto de "p > 0" y sexta
  // no sonaba NINGUN dia del ano. Aqui solo se corrige lo negativo.
  const mod = (x) => { const y = x % 24; return y < 0 ? y + 24 : y; };
  const salto = mod(ahora - antes);
  if (salto <= 0 || salto > 12) return null;
  let mejor = null, mejorP = -1;
  for (const [nombre, h] of horasCanonicas(dia, lat)) {
    const p = mod(h - antes);              // cuanto se avanzo hasta llegar a ella
    if (p > 0 && p <= salto && p > mejorP) { mejor = nombre; mejorP = p; }
  }
  return mejor;
}

// --- la obra --------------------------------------------------------------------
//
// La helada no calla la obra: la cambia. La cal no fragua bajo cero, asi que el
// ASIENTO de silleria para -no se sienta piedra sobre un mortero que se va a
// helar- pero la LABRA sigue, el cantero a cubierto sacando piedra en seco, que
// es lo que se hacia en invierno para tener obra hecha en primavera. En una
// manana de helada de enero se oyen los mazos y no se oyen las cabrias ni las
// voces del tajo.
//
// La jornada sale del sol de verdad y no de una regla estacional: de media hora
// despues del amanecer a media antes del ocaso, con parada al mediodia. En enero
// hay nueve horas de luz y en junio quince, asi que el invierno se oye solo.
export function trabajaLaObra(dia, hora, clima, lat = LAT) {
  if (diaSemana(dia) === 0) return { asiento: 0, labra: 0 };
  const [orto, ocaso] = ortoOcaso(dia, lat);
  const medio = (orto + ocaso) / 2;
  const jornada = franja(hora, orto + 0.5, ocaso - 0.5, 0.4)
    * (1 - 0.85 * franja(hora, medio - 0.1, medio + 0.9, 0.3));
  return {
    asiento: jornada * (1 - suave(1.5, -0.5, clima.temp)),
    labra: jornada,
  };
}

// --- los grillos son un termometro ----------------------------------------------
//
// Ley de Dolbear, 1897: el grillo de campo late mas deprisa cuanto mas calor
// hace, y de forma bastante lineal. Cuesta una linea y hace que una noche de
// agosto y una de mayo no suenen igual.
export function pulsoGrillo(temp) {
  return Math.max(0.5, 2.4 + 0.30 * (temp - 10));
}

// --- la rejilla de urbanidad ----------------------------------------------------
//
// Muestreo bilineal entre los CENTROS de las cuatro celdas vecinas, no lectura de
// la celda. Ahi esta el requisito y no es un detalle: leer la celda da un escalon
// de 10 m que andando a 3 m/s se cruza en tres segundos, y eso se oye como un
// corte. Vive aqui, y no en world.js, para que la continuidad que importa se
// compruebe con node contra una rejilla de mentira.
export function muestrear(rej, ancho, alto, celda, x, z) {
  const fx = clamp(x / celda - 0.5, 0, ancho - 1.001);
  const fz = clamp(z / celda - 0.5, 0, alto - 1.001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
  const a = rej[j * ancho + i], b = rej[j * ancho + i + 1];
  const c = rej[(j + 1) * ancho + i], d = rej[(j + 1) * ancho + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// --- la mezcla ------------------------------------------------------------------
//
// env = { dia, hora, urbanidad, fuera, clima }  ->  ganancias por capa.
//
// `urbanidad` es 0 en la dehesa y 1 en la calle de Floridablanca; `fuera` es el
// mismo numero que ya usan los vecinos para quedarse en casa cuando llueve.
export function mezclar(env) {
  const c = env.clima;
  const dia = env.dia, hora = env.hora, lat = env.lat ?? LAT;
  const u = clamp(env.urbanidad ?? 0, 0, 1);
  const fuera = clamp(env.fuera ?? 1, 0, 1);

  const s = senoSol(dia, hora, lat);
  const deDia = suave(-0.05, 0.16, s);
  const deNoche = suave(0.10, -0.10, s);

  // La nieve fresca es un absorbente poroso, y lo que sorprende de un pueblo
  // nevado es lo callado que esta. La que CAE anade un susurro; la del suelo tira
  // de toda la mezcla hacia abajo. `cubierta` ya trae tres dias de inercia.
  const mudo = 1 - 0.45 * clamp(c.cubierta ?? 0, 0, 1);
  // La niebla no cambia el volumen, amortigua lo lejano. `niebla` va de 1
  // (despejado) a 9 (el Monasterio desaparece a 150 m).
  const lejos = 1 / (1 + 0.075 * ((c.niebla ?? 1) - 1));

  const primavera = franja(((dia + 365 - 60) % 365) * 24 / 365, 0, 5.5, 1.2);
  const verano = franja(((dia + 365 - 152) % 365) * 24 / 365, 0, 6.0, 1.5);
  const obra = trabajaLaObra(dia, hora, c, lat);

  const g = {
    // Siempre. A 1030 m en ladera abierta el viento es medio ambiente, y meterse
    // entre casas lo corta.
    viento: (0.085 + 0.075 * c.frio + 0.070 * c.nublado) * (1 - 0.35 * u),
    lluvia: 0.26 * c.lluvia,
    // El agua de los aleros solo existe donde hay tejados. Es la unica agua
    // corriente honesta que tiene este pueblo: no hay datos de arroyos.
    teja: 0.17 * c.lluvia * u,
    // Lo que se oye en una nevada gorda es el aire, no los copos.
    ventisca: 0.20 * suave(0.30, 0.70, c.nieve),

    pajaros: 0.11 * deDia * (1 - c.lluvia) * (1 - 0.35 * u) * (0.55 + 0.45 * primavera),
    // Gryllus campestris, las tardes de mayo a agosto, y callan con el fresco.
    grillo: 0.10 * deNoche * verano * suave(11, 17, c.temp) * (1 - 0.6 * u),
    // Cicada orni canta en la encina, a pleno mediodia de julio y por encima de
    // 24 grados. No es el grillo con otro nombre: es otro bicho y otra hora.
    chicharra: 0.09 * deDia * verano * suave(24, 28, c.temp) * (1 - u)
      * franja(hora, 12, 18, 1.5),

    bullicio: 0.19 * u * fuera * deDia,
    ganado: 0.13 * (1 - u) ** 2 * deDia * lejos,
    lumbre: 0.09 * u * deNoche,
    fragua: 0.10 * u * deDia * franja(hora, 7, 19, 1),

    // La obra esta DONDE esta. Sin el factor de urbanidad los mazos se oian
    // igual de fuerte desde la Silla de Felipe II, a dos kilometros y medio del
    // tajo, que desde la lonja: el sonido decia que la cantera te rodeaba.
    asiento: 0.13 * obra.asiento * lejos * u,
    labra: 0.10 * obra.labra * lejos * u,
  };
  for (const k in g) g[k] = clamp(g[k] * mudo, 0, 1);
  return g;
}
