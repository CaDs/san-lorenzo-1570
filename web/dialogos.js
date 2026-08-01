// Lo que dicen los vecinos. Generador puro: no guarda estado, se le pregunta y
// devuelve lineas [quien, que dice].
//
// Antes de esto, hablar con alguien que no fuera el objetivo de la mision no
// hacia absolutamente nada: `interactuar()` se iba de vacio y el aviso ni
// aparecia. Con 220 vecinos por la calle eso es un pueblo de figurantes.
//
// La eleccion es DETERMINISTA a partir del id del vecino, su oficio, el paso de
// la mision y cuantas veces has hablado ya con el. Asi cada vecino tiene voz
// propia -el mismo herrero dice siempre lo mismo primero- pero insistir da
// conversacion nueva en vez de un bucle.
//
// Epoca: anos setenta del siglo XVI, con las obras del Monasterio en marcha.

import { rumbo, distancia, pasos, cuesta } from './lugares.js';
import { VOCES } from './historia.js';

// Oficios de nombre femenino: "un pastora" no lo dice nadie. Va aqui suelto en
// vez de importarlo de tramas.js porque es tramas.js quien importa esto, y no al
// reves; quests.test.mjs vigila que la lista de oficios no se separe.
const UNA = new Set(['pastora', 'panadera', 'tejedora']);

// --- por oficio ---------------------------------------------------------

const OFICIO = {
  aguador: [
    'Dos viajes llevo desde la fuente y el dia no ha hecho mas que empezar.',
    'El agua buena baja de Abantos. La del pilon de abajo sabe a rana.',
    'En la obra beben mas que trabajan, y mira que trabajan.',
    'Cantaro roto, jornal perdido. Y van tres este mes.',
  ],
  herrero: [
    'Todo el dia calzando mulas para los carros de la piedra.',
    'Si el fuelle aguanta hasta san Miguel, doy el ano por bueno.',
    'Herraduras, clavos, grapas para los sillares. No doy abasto.',
    'El hierro no miente: o esta a punto o te quema. Como las personas.',
  ],
  fraile: [
    'Dios te guarde, caminante. Aqui rezamos y levantamos piedra, por ese orden.',
    'La obra no es para nosotros: es para los que vengan en trescientos anos.',
    'Su Majestad quiere el coro acabado antes que la cupula. Paciencia.',
    'He visto planos que no entiendo y he firmado gastos que no alcanzo.',
  ],
  pastora: [
    'Subo el ganado a la dehesa al alba y lo bajo antes de que oscurezca.',
    'Anoche aullaron por el monte. No he pegado ojo.',
    'Con tanto cantero y tanto carro, las ovejas ya no saben por donde ir.',
    'La hierba de arriba es mejor, pero el lobo tambien lo sabe.',
  ],
  panadera: [
    'El horno se enciende antes que el sol y se apaga despues que el.',
    'Doscientas hogazas diarias se van a la obra. Doscientas.',
    'Si te levantas temprano te guardo un pan de los buenos.',
    'Harina cara, lena cara, y el pan al mismo precio. Echa cuentas.',
  ],
  cantero: [
    'Venimos de la cantera de la Herreria, arrastrando granito.',
    'Cada sillar pesa lo que tres bueyes. De dia al sol, de noche a las hogueras.',
    'La piedra de aqui es dura y agradecida: bien labrada dura mil anos.',
    'Se me han gastado dos punteros esta semana. La sierra no perdona.',
  ],
  pescadero: [
    'Truchas de los arroyos de la sierra, frescas de esta manana.',
    'En viernes vendo el doble y duermo la mitad.',
    'Lo que no se vende hoy, manana ni regalado.',
    'Antes bajaba a Madrid a vender. Ahora Madrid sube aqui a comprar.',
  ],
  tejedora: [
    'Lana de la sierra, hilada en casa. No hay mejor abrigo para este frio.',
    'Con la obra hay trabajo: mantas, sayas, capotes para los peones.',
    'El telar suena todo el dia. Ya no lo oigo, como quien no oye el rio.',
    'Tino con cascara de nuez y con roble. Los colores de aqui.',
  ],
};

// --- de todos -----------------------------------------------------------

const SALUDO_DIA = [
  'Buenos dias nos de Dios.',
  'Dios te guarde.',
  'Buen dia, forastero.',
  'A la paz de Dios.',
];

const SALUDO_TARDE = [
  'Buenas tardes tenga.',
  'Dios te guarde, que ya cae el sol.',
  'Buenas nos las de Dios.',
];

const SALUDO_NOCHE = [
  'Buenas noches, y con tiento por la calle.',
  'A estas horas solo andamos los que no tenemos remedio.',
  'Dios te guarde. Mal momento para pasear.',
  'Con la noche cerrada, arrimate a las antorchas.',
];

const RUMOR = [
  'Dicen que Su Majestad vendra a ver la obra antes del invierno.',
  'Cuentan que hay lobos bajando a las majadas. Yo no los he visto.',
  'El camino real a Madrid esta imposible desde las lluvias.',
  'Los frailes andan revueltos con lo del coro.',
  'En la Herreria han abierto cantera nueva. Mas piedra, mas carros.',
  'Anoche se oyeron mazos hasta bien entrada la madrugada.',
  'Hay quien dice que la obra no se acabara en nuestra vida. Ni en la de nadie.',
  'Ha llegado gente de Toledo a labrar piedra. Buenos oficiales, dicen.',
  'Con tanto forastero ya no conozco a la mitad del pueblo.',
];

const QUEJA = [
  'Y todo por un jornal que no da para el invierno.',
  'Pero no me hagas mucho caso, que hablo por hablar.',
  'En fin, cada uno con lo suyo.',
  'Asi llevamos desde que empezo la obra.',
];

const DESPEDIDA = [
  'Anda con Dios.',
  'Que San Lorenzo te guarde.',
  'Sigue tu camino, que yo tengo faena.',
  'Vete con Dios, forastero.',
];

const ANIMAL = {
  // El de la leyenda. No es un perro de pueblo: no se acerca, no olfatea y no
  // se tumba. Grune, ladra y no aparta la mirada.
  perronegro: [
    'Grune sin levantar la cabeza. No deja de mirarte ni un momento.',
    'Un ladrido seco, uno solo, y el eco tarda demasiado en volver.',
    'Ensena los dientes. Los peones de la obra dicen que le brillan los ojos.',
    'Se planta entre tu y el hombre de negro, y grune mas hondo.',
    'No ladra. Espera. Es peor.',
  ],
  gato: ['Te mira desde lo alto de una tapia y no se digna a bajar.',
    'Se estira, te da la espalda con toda intencion y se va.',
    'Sentado en mitad de la calle, se lava una pata sin prisa ninguna.',
    'Se mete por un hueco por el que no cabes tu y desaparece.',
    'Un gato pardo de granero. No hay raton que dure una semana por aqui.'],
  vaca: ['Levanta la cabeza, te mira masticando y vuelve a lo suyo.',
    'Huele a establo y a hierba pisada. Ni se aparta.',
    'Rumia. Es lo unico que va a hacer en toda la tarde.',
    'De las pardas de la sierra, hechas al frio y a subir cuestas.'],
  perro: ['El perro te olfatea las botas, decide que no eres nadie y sigue.',
    'Menea el rabo un momento y se va tras otra cosa.',
    'Te mira, bosteza y se tumba.'],
  oveja: ['La oveja te mira sin dejar de rumiar.',
    'Da dos pasos, se lo piensa, y vuelve a la hierba.'],
  gallina: ['La gallina se aparta dando saltitos y sigue picoteando.',
    'Escarba, te ignora, escarba otra vez.'],
  pajaro: ['Levanta el vuelo antes de que te acerques.',
    'Un pajaro pasa alto y se pierde tras los tejados.'],
};

// --- utilidades ---------------------------------------------------------

// Mezclador sin sin(): las semillas son enteros y crecen, y fract(sin(x)) se
// degrada. Es el mismo escarmiento que el cielo estrellado de daynight.js.
export function mezcla(...n) {
  let h = 2166136261;
  for (const v of n) {
    h ^= (v | 0) + 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Avalancha final, y hace falta de verdad. Sin ella el ULTIMO argumento apenas
  // movia los bits de arriba: solo pasa por una multiplicacion, y una
  // multiplicacion arrastra los acarreos hacia arriba pero no hacia abajo, asi
  // que subir el ultimo argumento de 1 en 1 movia el resultado un 3% en vez del
  // 33% que separa a dos numeros al azar. Medido: dos tiradas seguidas caian en
  // el mismo cubo de siete el 91,2% de las veces, cuando lo normal es el 14,3%.
  //
  // Eso es justo como se usa esto en todas partes -mezcla(semilla, canal, i) con
  // la i corriendo-, y explica que dos llegadas del mismo encargo se narraran
  // casi siempre igual y que la lluvia saliera apelotonada en pocos dias en vez
  // de repartida. Tres rondas de xor-desplazamiento y multiplicacion lo reparten
  // todo, y es el remate estandar de este tipo de mezclador.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

// `semilla` llega de mezcla(), que devuelve un uint32. Ojo con el
// desplazamiento: en JS `>>` es CON SIGNO, asi que a partir de 2^31 devuelve
// negativo, el modulo tambien y lista[negativo] es undefined. De ahi salian
// lineas de dialogo en blanco. Se usa `>>>` arriba y aqui se blinda ademas.
function elige(lista, semilla) {
  return lista[Math.abs(semilla | 0) % lista.length];
}

function saludoPorHora(hora, semilla) {
  if (hora >= 6 && hora < 13) return elige(SALUDO_DIA, semilla);
  if (hora >= 13 && hora < 20.5) return elige(SALUDO_TARDE, semilla);
  return elige(SALUDO_NOCHE, semilla);
}

// --- lo que se puede pedir ----------------------------------------------

// Charla normal: saludo, algo de su oficio y, de vez en cuando, un rumor.
export function hablar(npc, ctx) {
  if (npc.tipo !== 'vecino') return observar(npc, ctx);

  const s = mezcla(npc.num, ctx.veces, ctx.paso);
  const of = OFICIO[npc.oficio] || OFICIO.aguador;
  const lineas = [];

  lineas.push([npc.nombre, saludoPorHora(ctx.hora, s)]);
  lineas.push([npc.nombre, elige(of, s >>> 3)]);

  // A la tercera frase se alterna entre rumor y queja, para que insistir con el
  // mismo vecino no de siempre la misma conversacion.
  if ((s >>> 7) % 3 === 0) {
    lineas.push([npc.nombre, elige(QUEJA, s >>> 11)]);
  } else {
    lineas.push([npc.nombre, elige(RUMOR, s >>> 11)]);
  }

  // Modo educativo: una frase mas, de las que ESE oficio puede saber estando
  // aqui en 1570. Lo que nadie de 1570 puede decir -que la obra acaba en 1584,
  // que a esto se le llamara herreriano- no va en boca de nadie: va en cartela.
  if (ctx.educativo && VOCES[npc.oficio]) {
    lineas.push([npc.nombre, elige(VOCES[npc.oficio], mezcla(npc.num, ctx.veces, 5))]);
  }

  if (ctx.veces >= 2) lineas.push([npc.nombre, elige(DESPEDIDA, s >>> 17)]);
  return lineas;
}

// Animales: una linea de observacion. Mejor eso que el silencio de antes.
export function observar(npc, ctx) {
  if (npc.tipo === 'rey') return hablarRey(npc, ctx);
  const bolsa = ANIMAL[npc.tipo];
  if (!bolsa) return [['', 'No hay nadie con quien hablar aqui.']];
  return [['', elige(bolsa, mezcla(npc.num, ctx.veces))]];
}

// El hombre de negro.
//
// No da encargos ni los recibe, y no dice quien es. Las frases son suyas de
// verdad -o de lo que se le atribuye- y de lo que le rodea: la victoria de San
// Quintin el dia de san Lorenzo, la parrilla del martirio, las reliquias que
// junto para blindar la casa, y el perro que segun la leyenda aullaba de noche
// entre los andamios. Quien las ate, lo sabra; a quien no le diga nada, se habra
// cruzado con un hombre raro a medianoche, que tambien esta bien.
const REY = [
  'Esta casa no la levanto yo. La levanta el que la ha de habitar cuando yo no este.',
  'Se gano en su dia, y en su dia se paga. Lo que se promete en una batalla se debe.',
  'Una parrilla. Le pareceria a alguien mal augurio. A mi me parece justicia.',
  'Cuento las piedras y no me salen. Cuento los anos y tampoco.',
  'Hay quien dice que mis galerias llegan a una puerta que no conviene abrir.',
  'Mil setecientas reliquias no bastan. Dos mil, quiza.',
  'Se ha soltado. Todas las noches se suelta, y todas las noches aullan los peones.',
  'No le tengas miedo. O tenselo, que a mi tampoco me hace caso.',
  'De aqui no sale nadie sin dejar algo. Yo dejo esto.',
  'Preguntame manana. Manana no estare.',
];

function hablarRey(npc, ctx) {
  return [[npc.nombre, elige(REY, mezcla(npc.num, ctx.veces, 0x1527))]];
}

// Indicaciones: a donde cae un sitio, con rumbo, distancia y cuesta. Si la
// mision pide un oficio concreto, se orienta hacia ese oficio; si no, hacia
// donde este el jugador mirando de menos: el Monasterio o un sitio con nombre.
export function indicaciones(npc, ctx) {
  if (npc.tipo !== 'vecino') return observar(npc, ctx);

  const s = mezcla(npc.num, ctx.veces, 77);
  const lineas = [];
  const yo = npc.pos;

  // 0) Si la mision manda a un SITIO, es lo unico que interesa. Antes este caso
  // no existia: el unico paso que es andar era el unico en el que preguntar el
  // camino no servia de nada, y contestaba con el Monasterio y un sitio al azar.
  if (ctx.destino) {
    lineas.push([npc.nombre,
      `${ctx.destino.nombre} queda hacia ${rumbo(yo, ctx.destino)},`
      + ` ${pasos(distancia(yo, ctx.destino))}`
      + `${cuesta(ctx.world, yo, ctx.destino)}.`]);
    return lineas;
  }

  // 1) Si hay mision viva que pida un oficio, eso es lo que interesa. Y si ya se
  // sabe con QUIEN hay que hablar, se busca a ese, no al de su oficio que este
  // mas cerca: son personas distintas y mandar al equivocado es peor que callar.
  if (ctx.oficioBuscado) {
    const otro = (ctx.atado && ctx.buscarId(ctx.atado.id))
      || ctx.buscarOficio(ctx.oficioBuscado, yo);
    if (otro) {
      const calle = ctx.lugares.calleEn(otro.pos);
      const donde = calle ? ` por ${calle}` : '';
      const quien = ctx.atado ? otro.nombre
        : `${UNA.has(ctx.oficioBuscado) ? 'Una' : 'Un'} ${ctx.oficioBuscado}`;
      lineas.push([npc.nombre,
        `${quien} andaba${donde}, hacia ${rumbo(yo, otro.pos)},`
        + ` ${pasos(distancia(yo, otro.pos))}.`]);
      return lineas;
    }
    lineas.push([npc.nombre,
      `No he visto ${UNA.has(ctx.oficioBuscado) ? 'ninguna' : 'ningun'}`
      + ` ${ctx.oficioBuscado} hoy. Prueba por la obra.`]);
  }

  // 2) Si no, se orienta con el Monasterio, que se ve desde media sierra.
  const mon = ctx.lugares.monasterio;
  if (mon) {
    lineas.push([npc.nombre,
      `El Monasterio queda hacia ${rumbo(yo, mon)}, ${pasos(distancia(yo, mon))}`
      + `${cuesta(ctx.world, yo, mon)}.`]);
  }

  // 3) Y se remata con otro sitio con nombre, distinto por vecino.
  const otro = ctx.lugares.alAzar(mezcla(npc.num, 31));
  if (otro && otro !== mon) {
    lineas.push([npc.nombre,
      `Si buscas ${otro.nombre}, tira hacia ${rumbo(yo, otro)},`
      + ` ${pasos(distancia(yo, otro))}.`]);
  }

  // 4) Donde estas ahora mismo, que ubica mas que cualquier rumbo.
  const aqui = ctx.lugares.calleEn(yo);
  if (aqui) lineas.push([npc.nombre, `Esto de aqui es ${aqui}.`]);
  else if (!lineas.length) lineas.push([npc.nombre, elige(DESPEDIDA, s)]);

  return lineas;
}
