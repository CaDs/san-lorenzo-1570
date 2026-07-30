// Generador de encargos.
//
// Todo lo demas en este pueblo ya era procedural -el terreno, las casas, los
// arboles, los 220 vecinos y su charla- menos la mision, que estaba escrita a
// mano y era SIEMPRE la misma: cantero, aguador, Monasterio, cantero. Se veia
// entera en cuatro minutos y ya no habia juego.
//
// Un encargo = una FORMA (el arco: quien te manda, cuantas patas tiene) + un
// TEMA (de que va) + huecos rellenados con los oficios que hay VIVOS ahora
// mismo y con los sitios con nombre de verdad que trae OSM. 4 formas x 8 temas
// x 8 oficios x 69 sitios da mas combinaciones que partidas va a jugar nadie,
// y sale de unas cien lineas de plantilla.
//
// Determinista a partir de `semilla`: con ?seed=1234 vuelve a salir el mismo
// encargo. Sin eso un generador no se puede depurar ni contar a nadie.
//
// Nada de THREE ni de npcs.js aqui: solo (x,z) y texto. Asi esto se puede
// probar con node (ver quests.test.mjs).

import { rumbo, distancia, pasos } from './lugares.js';
import { mezcla } from './dialogos.js';

// Mismo orden y mismos nombres que ROLES en npcs.js. Se repite la lista en vez
// de importarla porque npcs.js arrastra THREE y esto se prueba fuera del
// navegador; quests.test.mjs comprueba que las dos listas no se separen.
const OFICIOS = ['aguador', 'herrero', 'fraile', 'pastora', 'panadera',
  'cantero', 'pescadero', 'tejedora'];

const FEMENINO = new Set(['pastora', 'panadera', 'tejedora']);

const MIN_ORIGEN = 180;   // m: un sitio mas cerca que esto se "alcanza" al nacer
const MIN_ENTRE = 150;    // m entre dos destinos del mismo encargo, o no se anda

// --- formas ------------------------------------------------------------------
//
// 'pedir' te lo encarga A, 'recado' lo recibe B, 'ir' es llegar al siguiente
// sitio, 'cerrar' es volver con A. La cuarta empieza en frio: llegas al pueblo
// habiendo oido algo y buscas a quien preguntarle.
const FORMAS = [
  ['pedir', 'recado', 'cerrar'],
  ['pedir', 'ir', 'cerrar'],
  ['pedir', 'ir', 'recado', 'cerrar'],
  ['ir', 'pedir', 'ir'],
];

// --- temas -------------------------------------------------------------------
//
// `A` es el oficio que encarga y `B` el que recibe el recado: son PREFERENCIAS,
// no obligaciones. Si a esa hora no anda ningun fraile por la calle se cambia
// por otro oficio vivo, que es mejor que un objetivo imposible.
//
// Huecos: {A} {B} {sitio} {rumbo} {pasos}. Epoca: anos setenta del XVI, con las
// obras del Monasterio en marcha.
const TEMAS = [
  {
    id: 'lobos',
    A: 'pastora', B: 'fraile',
    motivo: 'anoche aullaron lobos en la dehesa',
    pedir: [
      ['No he pegado ojo: anoche aullaron por el monte, y no era un perro.',
        'Si vas hacia {sitio}, mira si han bajado hasta las majadas.'],
      ['Me falta una oveja desde el alba y las demas no quieren subir.',
        'Algo hay arriba. Da una vuelta por {sitio} y me lo cuentas.'],
    ],
    recado: [
      ['Lobos otra vez. Rezare por el ganado, que es lo que se me da bien.',
        'Al capataz habra que decirselo, que los peones duermen fuera.'],
    ],
    llegada: 'Huellas en el barro, mas anchas que las de un perro. Y nadie a la vista.',
    cerrar: [
      ['Con que huellas... no seria la primera vez que bajan en noche sin luna.',
        'Recogere el ganado antes de que oscurezca. Dios te lo pague.'],
      ['Ya me lo temia. Esta noche duermen todas en el corral.',
        'Has hecho mas de lo que se le pide a un caminante.'],
    ],
  },
  {
    id: 'agua',
    A: 'cantero', B: 'aguador',
    motivo: 'la argamasa se esta quedando sin agua',
    pedir: [
      ['La cal esta cuajando seca y sin agua no se asienta ni un sillar.',
        'Avisa al aguador antes de que el sol pegue de veras.'],
      ['Se nos han roto dos cantaros contra la piedra esta manana.',
        'Sin agua, aqui hoy no se levanta nada. Busca quien la traiga.'],
    ],
    recado: [
      ['¿De la obra vienes? Ya voy, ya voy, que no tengo mas que dos brazos.',
        'La buena baja de Abantos; la del pilon de abajo sabe a rana.'],
    ],
    llegada: 'El pilon esta a media altura y el agua llega turbia. Alguien ha revuelto el fondo.',
    cerrar: [
      ['Bien hecho. Con agua, la cal agarra; sin ella, esto es un monton de piedras.',
        'Vuelve cuando quieras, que aqui siempre hay algo que cargar.'],
      ['Ya lo he visto llegar con los cantaros. Se te debe una.',
        'Que San Lorenzo te guarde el camino.'],
    ],
  },
  {
    id: 'hierro',
    A: 'cantero', B: 'herrero',
    motivo: 'se han gastado los punteros de labrar la piedra',
    pedir: [
      ['Dos punteros me he comido esta semana. El granito no perdona.',
        'Dile al herrero que los quiero recalzados para manana al alba.'],
      ['La sierra viene mellada de la cantera de la Herreria.',
        'Sin hierro a punto, el sillar sale torcido. Busca al herrero.'],
    ],
    recado: [
      ['Traeme el hierro y para el alba lo tienes. Si el fuelle aguanta.',
        'Todo el dia calzando mulas y grapando sillares: no doy abasto.'],
    ],
    llegada: 'Un carro de piedra atascado, y la rueda con el aro suelto. Tambien eso es hierro.',
    cerrar: [
      ['Con la herramienta a punto se labra el doble. Buen recado.',
        'Bien labrada, esta piedra dura mil anos. Acuerdate de eso.'],
      ['Ya me lo ha mandado con el chico. Se agradece.',
        'Anda con Dios, caminante.'],
    ],
  },
  {
    id: 'pan',
    A: 'panadera', B: 'cantero',
    motivo: 'la obra se come doscientas hogazas al dia',
    pedir: [
      ['Doscientas hogazas diarias se van a la obra. Doscientas.',
        'El reparto de {sitio} no ha venido a por lo suyo. Ve a ver.'],
      ['Se me enfria el pan mientras espero a que bajen a buscarlo.',
        'Avisa en la obra, que el horno no se enciende dos veces.'],
    ],
    recado: [
      ['¿Pan? Aqui se come de pie y sin quitarse el polvo.',
        'Mandare a dos peones. Con hambre no se arrastra granito.'],
    ],
    llegada: 'Nadie a esta hora, y el pan del dia anterior sin recoger sobre la tabla.',
    cerrar: [
      ['Menos mal. Manana amaso menos y no me sobra medio horno.',
        'Si te levantas temprano te guardo un pan de los buenos.'],
      ['Ya han bajado a por el. Tu recado ha valido mas que mis gritos.',
        'Que no te falte pan en el camino.'],
    ],
  },
  {
    id: 'campana',
    A: 'fraile', B: 'herrero',
    motivo: 'la campana de San Bernabe suena rajada',
    pedir: [
      ['La campana suena a cazuela desde el domingo. Rajada, me temo.',
        'Que la vea quien entiende de metal, y luego pasate por {sitio}.'],
      ['Sin campana el pueblo no sabe cuando rezar ni cuando comer.',
        'Busca al herrero y traeme lo que diga.'],
    ],
    recado: [
      ['Rajada esta, y eso no se suelda: se funde otra vez de nuevo.',
        'Cobre y estano, y un horno que aqui no tenemos. Malas noticias llevas.'],
    ],
    llegada: 'Desde aqui se oye tocar: un golpe seco, sin cola. Suena a lena, no a bronce.',
    cerrar: [
      ['Fundirla de nuevo... Su Majestad paga cupulas, no campanas.',
        'Rezaremos con la voz, que sale gratis. Gracias, caminante.'],
      ['Lo que me temia. Lo pondre en la cuenta de gastos y que Dios provea.',
        'Ve en paz.'],
    ],
  },
  {
    id: 'pano',
    A: 'tejedora', B: 'pastora',
    motivo: 'los peones pasan la noche al raso y sin capote',
    pedir: [
      ['El telar suena todo el dia y aun asi no salen capotes bastantes.',
        'Me falta lana. Habla con quien sube el ganado a la dehesa.'],
      ['Los peones duermen fuera y este frio de sierra mata.',
        'Sin lana no hay mantas. Busca a la pastora, anda.'],
    ],
    recado: [
      ['Lana tengo, pero esquilar ahora es dejarlas desnudas para el invierno.',
        'Dile que le doy la de las viejas. Algo es algo.'],
    ],
    llegada: 'Cuatro capotes tendidos y todos remendados dos veces. Aqui hace falta pano nuevo.',
    cerrar: [
      ['Con esa lana tengo para seis mantas. Menos es nada.',
        'Tino con cascara de nuez y con roble: los colores de aqui.'],
      ['Bien. Esta noche alguien dormira caliente por tu recado.',
        'Vuelve si necesitas abrigo.'],
    ],
  },
  {
    id: 'truchas',
    A: 'pescadero', B: 'panadera',
    motivo: 'el viernes hay que dar de comer a toda la obra',
    pedir: [
      ['Viernes, y con truchas de los arroyos de la sierra hasta arriba.',
        'Lo que no se venda hoy manana ni regalado. Avisa en el horno.'],
      ['Media obra come de vigilia y nadie ha venido a encargarme nada.',
        'Ve a por quien reparte, que el pescado no espera.'],
    ],
    recado: [
      ['Truchas y pan van bien. Le mando dos hogazas y hacemos cuentas.',
        'De viernes vendo el doble y duermo la mitad. Como el.'],
    ],
    llegada: 'Cestas vacias apiladas y olor a rio. El reparto ya paso por aqui.',
    cerrar: [
      ['Cerrado el trato. Hoy no tiro ni una trucha.',
        'La proxima vez te guardo la mejor del cesto.'],
      ['Con eso salvo el dia. Gracias, y anda con Dios.',
        'Frescas de esta manana, no lo olvides.'],
    ],
  },
  {
    id: 'pliego',
    A: 'fraile', B: 'cantero',
    motivo: 'hay un pliego de Su Majestad esperando firma',
    pedir: [
      ['Ha llegado pliego de la corte y aqui nadie sabe leer la traza.',
        'Que lo vea quien labra: pasa por {sitio} y busca al cantero.'],
      ['He firmado gastos que no alcanzo y planos que no entiendo.',
        'Llevale esto a la obra y que digan si es posible.'],
    ],
    recado: [
      ['Su Majestad quiere el coro antes que la cupula. Y la piedra pesa igual.',
        'Se puede, si nos manda mas brazos. Diselo tal cual.'],
    ],
    llegada: 'Los andamios trepan sobre la piedra recien puesta. A esta hora solo hay guardia.',
    cerrar: [
      ['Mas brazos... Lo pondre por escrito y que decida Madrid.',
        'Dios te guarde, caminante. Aqui rezamos y levantamos piedra, por ese orden.'],
      ['Entonces se puede. Con eso me basta para responder al correo.',
        'Ve en paz, y no te pierdas al bajar.'],
    ],
  },
];

// Narracion generica al llegar a un sitio, para que dos encargos con el mismo
// tema no describan igual dos sitios distintos.
const LLEGADA = [
  'Esto es {sitio}. A esta hora no hay mas que polvo y el eco de los mazos del dia.',
  'Ya estas en {sitio}. Huele a granito recien partido y a lena.',
  '{sitio}. Un carro descargado a medias y nadie a quien preguntar.',
  'Has llegado a {sitio}. El Monasterio se ve desde aqui, tapando media sierra.',
  '{sitio}, y el camino real de Madrid pasando ahi al lado.',
  'Esto de aqui es {sitio}. Se oye el agua bajar de Abantos.',
];

// --- generacion --------------------------------------------------------------

// Devuelve la lista PLANA de pasos de `cuantos` encargos seguidos. Se generan de
// golpe al arrancar y no sobre la marcha: asi la partida entera depende de una
// sola semilla y se puede repetir.
export function generarEncargos(semilla, lugares, vida, origen, cuantos = 3) {
  const out = [];
  for (let i = 0; i < cuantos; i++) {
    // Varios intentos por encargo: si los huecos no se pueden rellenar (no hay
    // oficios vivos, no hay sitios lejanos) se prueba con otra tirada antes de
    // rendirse, en vez de dejar la partida sin mision.
    for (let t = 0; t < 6; t++) {
      const e = unEncargo(mezcla(semilla, i, t), lugares, vida, origen);
      // En la costura entre dos encargos manda la misma regla que dentro de uno:
      // si el que cierra el anterior es del mismo oficio que el que encarga el
      // siguiente, el vecino que tienes delante te da los dos y no has andado.
      const previo = out.length ? out[out.length - 1].oficio : null;
      if (e && (!e[0].oficio || e[0].oficio !== previo)) { out.push(...e); break; }
    }
  }
  return out;
}

function unEncargo(s, lugares, vida, origen) {
  const dado = hacerDado(s);
  const forma = elige(FORMAS, dado);
  const tema = elige(TEMAS, dado);

  const A = oficioVivo(tema.A, vida, origen, dado, null);
  const B = oficioVivo(tema.B, vida, origen, dado, A);
  if (!A || !B) return null;

  // Siempre se saca al menos un sitio: aunque la forma no tenga paso 'ir', las
  // plantillas pueden nombrarlo ("pasa por {sitio}").
  const cuantos = Math.max(1, forma.filter((k) => k === 'ir').length);
  const sitios = sitiosLejanos(lugares, dado, origen, cuantos);
  if (!sitios.length) return null;

  const rellena = (txt, sitio) => txt
    .replaceAll('{A}', el(A)).replaceAll('{B}', el(B))
    .replaceAll('{sitio}', sitio.nombre)
    .replaceAll('{rumbo}', rumbo(origen, sitio))
    .replaceAll('{pasos}', pasos(distancia(origen, sitio)));

  let iSitio = 0;
  return forma.map((kind) => {
    const sitio = sitios[Math.min(iSitio, sitios.length - 1)];
    if (kind === 'ir') iSitio++;
    const quien = kind === 'recado' ? B : A;
    const voz = (lineas) => lineas.map((t) => [cap(quien), rellena(t, sitio)]);

    switch (kind) {
      case 'pedir':
        return {
          oficio: A,
          objetivo: `Busca ${al(A)}: dicen que ${tema.motivo}.`,
          dialogo: voz(elige(tema.pedir, dado)),
        };
      case 'recado':
        return {
          oficio: B,
          objetivo: `Lleva el recado ${al(B)}.`,
          dialogo: voz(elige(tema.recado, dado)),
        };
      case 'ir':
        return {
          reach: sitio,
          // El radio sale de la huella: el Monasterio son 35.771 m2 y su centro
          // cae dentro de los muros, asi que "llegar" es acercarse; una ermita
          // con 90 m de radio se daria por alcanzada desde la calle de al lado.
          radio: Math.min(90, Math.max(25, Math.sqrt(sitio.area || 400))),
          objetivo: `Acercate a ${sitio.nombre}.`,
          dialogo: [['', rellena(tema.llegada, sitio)],
            ['', rellena(elige(LLEGADA, dado), sitio)]],
        };
      default:
        return {
          oficio: A,
          objetivo: `Vuelve ${al(A)} y cuentale lo que has visto.`,
          dialogo: voz(elige(tema.cerrar, dado)),
        };
    }
  });
}

// El oficio preferido del tema si hay alguno vivo y no es el que ya usa el otro
// hueco; si no, el primero vivo de la lista barajada.
function oficioVivo(preferido, vida, origen, dado, distintoDe) {
  const hay = (of) => of !== distintoDe
    && (!vida || !vida.buscarOficio || !!vida.buscarOficio(of, origen));
  if (hay(preferido)) return preferido;
  const inicio = dado(OFICIOS.length);
  for (let i = 0; i < OFICIOS.length; i++) {
    const of = OFICIOS[(inicio + i) % OFICIOS.length];
    if (hay(of)) return of;
  }
  return null;
}

// `n` sitios con nombre, lejos del punto de partida y lejos entre si: un destino
// a treinta pasos no es un viaje, y uno pegado al jugador se daria por alcanzado
// en el primer fotograma, antes de que le hayan encargado nada.
function sitiosLejanos(lugares, dado, origen, n) {
  const todos = (lugares && lugares.antiguos) || [];
  if (!todos.length) return [];
  const out = [];
  // Dos pasadas: la primera con las distancias que interesan, la segunda sin
  // ellas, para no quedarse sin encargo en un pueblo pequeno.
  for (const exigir of [true, false]) {
    for (let t = 0; out.length < n && t < 80; t++) {
      const s = todos[dado(todos.length)];
      if (out.includes(s)) continue;
      if (exigir) {
        if (distancia(origen, s) < MIN_ORIGEN) continue;
        if (out.some((o) => distancia(o, s) < MIN_ENTRE)) continue;
      }
      out.push(s);
    }
    if (out.length >= n) break;
  }
  return out;
}

// --- ayudantes ---------------------------------------------------------------

// Tirada de dado con estado, sobre el mismo mezclador que los dialogos: cada
// llamada consume una tirada, asi que el orden de las decisiones fija el
// encargo. No hace falta otro generador aleatorio en el proyecto.
function hacerDado(semilla) {
  let k = 0;
  return (n) => Math.abs(mezcla(semilla, k++) | 0) % n;
}

function elige(lista, dado) { return lista[dado(lista.length)]; }

function el(of) { return `${FEMENINO.has(of) ? 'la' : 'el'} ${of}`; }
function al(of) { return FEMENINO.has(of) ? `a la ${of}` : `al ${of}`; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export { OFICIOS };
