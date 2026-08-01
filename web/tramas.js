// Generador de encargos.
//
// Todo lo demas en este pueblo ya era procedural -el terreno, las casas, los
// arboles, los 220 vecinos y su charla- menos la mision, que estaba escrita a
// mano y era SIEMPRE la misma: cantero, aguador, Monasterio, cantero. Se veia
// entera en cuatro minutos y ya no habia juego.
//
// Un encargo = una FORMA (el arco: quien te manda, cuantas patas tiene) + un
// TEMA (de que va) + huecos rellenados con los oficios que hay VIVOS ahora
// mismo y con los sitios con nombre de verdad que trae OSM. 10 formas x 8 temas
// x 8 oficios x 69 sitios da mas combinaciones que partidas va a jugar nadie,
// y sale de unas cien lineas de plantilla.
//
// Y no se acaban: se pide el encargo numero n cuando se ha cerrado el n-1, en
// vez de fabricar tres al arrancar y dejar la partida sin nada que hacer.
//
// Determinista a partir de `semilla`: con ?seed=1234 vuelve a salir la misma
// ristra. Sin eso un generador no se puede depurar ni contar a nadie.
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

const MIN_ORIGEN = 120;   // m: menos que esto no es un viaje
const MIN_ENTRE = 150;    // m entre dos destinos del mismo encargo, o no se anda
const MARGEN = 60;        // m que hay que andar de mas para no nacer ya llegando

// --- formas ------------------------------------------------------------------
//
// 'pedir' te lo encarga A, 'recado' lo recibe B, 'ir' es llegar al siguiente
// sitio, 'cerrar' es volver con A. La cuarta empieza en frio: llegas al pueblo
// habiendo oido algo y buscas a quien preguntarle.
//
// El arco es estructura pura: no gasta ni una linea de texto, asi que es el eje
// mas barato para que dos encargos del mismo tema no se anden igual. La unica
// regla es que 'pedir' y 'cerrar' -que resuelve la MISMA persona- nunca queden
// pegados, o el segundo se cerraria sin moverse del sitio.
const FORMAS = [
  ['pedir', 'recado', 'cerrar'],
  ['pedir', 'ir', 'cerrar'],
  ['pedir', 'ir', 'recado', 'cerrar'],
  ['ir', 'pedir', 'ir'],
  ['pedir', 'ir', 'ir', 'cerrar'],
  ['pedir', 'recado', 'ir', 'cerrar'],
  ['ir', 'pedir', 'recado', 'cerrar'],
  ['ir', 'pedir', 'ir', 'cerrar'],
  ['pedir', 'ir', 'recado'],
  ['pedir', 'recado', 'ir'],
];

// --- temas -------------------------------------------------------------------
//
// `A` es el oficio que encarga y `B` el que recibe el recado: son PREFERENCIAS,
// no obligaciones. Si a esa hora no anda ningun fraile por la calle se cambia
// por otro oficio vivo, que es mejor que un objetivo imposible.
//
// `cuando` es opcional y filtra por estacion y por tiempo. Los ocho de siempre
// NO lo llevan, y esa es justamente la garantia de que nunca te quedas sin
// encargo: la lista filtrada tiene siempre al menos ocho temas dentro, se mire
// el dia que se mire. La regla que hay que respetar al anadir es "no le pongas
// `cuando` a un tema que ya existe", no "pon un remedio por si acaso": un
// remedio para un caso que no puede pasar es una rama que nadie vuelve a leer.
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
      ['Se nos han roto dos cantaros contra la piedra esta mañana.',
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
        'Dile al herrero que los quiero recalzados para mañana al alba.'],
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
        'Bien labrada, esta piedra dura mil años. Acuerdate de eso.'],
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
      ['Menos mal. Mañana amaso menos y no me sobra medio horno.',
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
    llegada: 'Desde aqui se oye tocar: un golpe seco, sin cola. Suena a leña, no a bronce.',
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
        'Lo que no se venda hoy mañana ni regalado. Avisa en el horno.'],
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
        'Frescas de esta mañana, no lo olvides.'],
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

  // --- los que solo salen cuando toca --------------------------------------
  //
  // Estos SI llevan `cuando`. Son la razon de que enero no se juegue igual que
  // agosto: no es el mismo encargo con otra luz, es otro encargo.
  {
    id: 'carretas',
    A: 'cantero', B: 'pastora',
    cuando: { clima: ['nieve'], cubierta: 0.25 },
    motivo: 'la nieve ha cortado el camino de los carros de la piedra',
    pedir: [
      ['Con este palmo de nieve los bueyes no suben la cuesta cargados.',
        'Sube hasta {sitio} y mira si se puede rodear por arriba.'],
      ['Tres carros parados desde el alba y la obra sin sillares que labrar.',
        'Alguien que conozca el monte tiene que decirnos por donde se pasa.'],
    ],
    recado: [
      ['Yo subo con el ganado y se por donde se pasa y por donde no.',
        'Por la vereda de arriba se puede, pero de uno en uno y sin carga.'],
      ['Con nieve el monte cambia: lo llano engaña y la vaguada se traga un buey.',
        'Que esperen al deshielo, es lo que digo yo y lo que dira el tiempo.'],
    ],
    llegada: 'La rodada se pierde bajo la nieve. Mas arriba no ha pasado nadie hoy.',
    cerrar: [
      ['De uno en uno y sin carga, entonces. Menos es nada.',
        'La piedra esperara. Lleva ahi un millon de años, no tiene prisa.'],
      ['Pues a descargar y subir a lomos, que el plazo no entiende de nieve.',
        'Anda con Dios, y no bajes por donde has subido.'],
    ],
  },
  {
    id: 'helada',
    A: 'cantero', B: 'fraile',
    cuando: { helada: true },
    motivo: 'la helada ha reventado la cal recien puesta',
    pedir: [
      ['La cal no fragua bajo cero: se hiela el agua dentro y revienta la junta.',
        'Lo puesto esta semana habra que picarlo. Que lo sepan en {sitio}.'],
      ['Mira la junta: se desmorona con la uña. Eso es hielo, no mala mano.',
        'Ve a decirlo, y que nadie mande levantar mas hasta que temple.'],
    ],
    recado: [
      ['¿Picar lo puesto? Su Majestad pregunta cada mes por que no sube la obra.',
        'Se lo escribire. Y rezare, que contra la escarcha es lo unico que tengo.'],
      ['Ya lo dijo el maestro: de noviembre a marzo no se asienta sillar.',
        'Nadie hace caso hasta que revienta. Ve con Dios.'],
    ],
    llegada: 'Escarcha en las juntas y un cubo de agua con costra. Aqui no ha fraguado nada.',
    cerrar: [
      ['Ya lo sabia yo. Al menos ahora esta dicho y no es culpa mia.',
        'En marzo se levanta el doble. El invierno se pierde y punto.'],
      ['Que pare la obra, entonces. Es lo suyo, aunque cueste decirlo.',
        'La piedra aguanta. La cal no. Acuerdate de eso.'],
    ],
  },
  {
    id: 'siega',
    A: 'panadera', B: 'pastora',
    cuando: { estacion: ['verano'] },
    motivo: 'se siega en el ejido y no hay brazos, que estan todos en la obra',
    pedir: [
      ['La mies se pasa mientras los hombres cobran jornal cargando granito.',
        'Si el grano se pierde, en invierno no hay pan. Habla en {sitio}.'],
      ['Cuatro segadores para todo el ejido, y el trigo ya se vence solo.',
        'Busca quien tenga gente y ganas. Se paga lo que pida.'],
    ],
    recado: [
      ['Yo bajo el ganado despues de la siega y lo meto en el rastrojo.',
        'Puedo mandar a los zagales dos dias. Mas no, que las ovejas no esperan.'],
    ],
    llegada: 'Trigo alto y vencido, y cuatro hoces para todo esto. No llegan.',
    cerrar: [
      ['Dos dias de zagales. Con eso salvo la mitad, que es mas que nada.',
        'Este año el pan sale caro. Aviso desde ya.'],
      ['Bendita sea. Mañana amaso con harina de este año.',
        'Guardame un pan, te lo has ganado.'],
    ],
  },
  {
    id: 'riada',
    A: 'aguador', B: 'cantero',
    cuando: { clima: ['lluvia', 'tormenta'] },
    motivo: 'el arroyo baja crecido y se ha llevado el paso',
    pedir: [
      ['El arroyo se ha comido las piedras del vado en una noche.',
        'Sin paso no hay agua ni cal en la obra. Mira como esta por {sitio}.'],
      ['Baja turbio y con ramas. Asi no se llena un cantaro ni se cruza.',
        'Que lo vea quien sepa de piedra, antes de que se lleve algo mas.'],
    ],
    recado: [
      ['Un vado se rehace en un dia si hay sillares de desecho. Y los hay.',
        'Mandare a los peones cuando afloje. Con el agua asi no se trabaja.'],
      ['Ya se llevo el de abajo hace dos años. Y volvera a llevarselo.',
        'Se pone y se vuelve a poner. Es lo que tiene vivir junto a un arroyo.'],
    ],
    llegada: 'El agua pasa por encima del vado y arrastra ramas. Aqui no cruza nadie.',
    cerrar: [
      ['Con sillares de desecho, dices. Pues que sirvan de algo los rotos.',
        'En cuanto baje, se pone. Gracias por el recado.'],
      ['Lo que yo digo: el que manda es el arroyo, no Su Majestad.',
        'Que no te pille en el vado, caminante.'],
    ],
  },
  {
    id: 'lena',
    A: 'fraile', B: 'pastora',
    cuando: { estacion: ['otoño'] },
    motivo: 'no hay leña cortada para el invierno',
    pedir: [
      ['Estamos en octubre y la lenera esta a medias. Aqui se hiela hasta el vino.',
        'Alguien que conozca el monte sabra donde queda roble caido por {sitio}.'],
      ['Los peones duermen fuera y el invierno de esta sierra no es de broma.',
        'Sin leña, en enero se reza tiritando. Busca quien nos guie al monte.'],
    ],
    recado: [
      ['Roble caido hay, y de sobra, del viento de septiembre.',
        'Pero es monte del Rey. Que lo pidan por escrito o no cortan nada.'],
    ],
    llegada: 'Roble caido de la ventisca de septiembre, y nadie lo ha tocado.',
    cerrar: [
      ['Por escrito, otra vez. Todo en este sitio acaba en un pliego.',
        'Lo pedire. Y mientras, que quemen ramon, que Dios aprieta pero no ahoga.'],
      ['Hay leña, entonces. Con eso me basta para dormir tranquilo.',
        'Que no te falte lumbre este invierno, caminante.'],
    ],
  },
];

// Narracion generica al llegar a un sitio, para que dos encargos con el mismo
// tema no describan igual dos sitios distintos.
const LLEGADA = [
  'Esto es {sitio}. A esta hora no hay mas que polvo y el eco de los mazos del dia.',
  'Ya estas en {sitio}. Huele a granito recien partido y a leña.',
  '{sitio}. Un carro descargado a medias y nadie a quien preguntar.',
  'Has llegado a {sitio}. El Monasterio se ve desde aqui, tapando media sierra.',
  '{sitio}, y el camino real de Madrid pasando ahi al lado.',
  'Esto de aqui es {sitio}. Se oye el agua bajar de Abantos.',
];

// --- generacion --------------------------------------------------------------

// Los pasos del encargo numero `n`, o null si no hay manera de armarlo. Se pide
// uno cada vez, cuando se acaba el anterior, y no tres de golpe al arrancar: asi
// los encargos no se terminan nunca.
//
// La semilla de cada uno sigue siendo mezcla(semilla, n, intento), que es lo que
// era, de modo que ?seed= sigue dando la misma partida que antes: lo unico que
// cambia es que ahora hay encargo numero 4.
//
// `oficioPrevio` es el oficio del ultimo paso del encargo anterior. En la costura
// entre dos encargos manda la misma regla que dentro de uno: si el que cierra el
// anterior tiene el oficio del que encarga el siguiente, el vecino que tienes
// delante te da los dos y no has andado.
export function siguienteEncargo(semilla, n, lugares, vida, origen,
  oficioPrevio = null, clima = null) {
  // Varios intentos: si los huecos no se pueden rellenar (no hay oficios vivos,
  // no hay sitios lejanos) se prueba con otra tirada antes de rendirse.
  for (let t = 0; t < 6; t++) {
    const e = unEncargo(mezcla(semilla, n, t), lugares, vida, origen, n, clima);
    if (e && (!e[0].oficio || e[0].oficio !== oficioPrevio)) return e;
  }
  return null;
}

// Si un tema tiene sentido con el tiempo que hace. Un tema sin `cuando` vale
// siempre, que es lo que hace imposible quedarse sin ninguno.
function valeAhora(tema, clima) {
  const c = tema.cuando;
  if (!c) return true;
  if (!clima) return false;      // sin saber el tiempo, solo valen los de siempre
  if (c.estacion && !c.estacion.includes(clima.estacion)) return false;
  if (c.clima && !c.clima.includes(clima.estado)) return false;
  if (c.cubierta !== undefined && clima.cubierta < c.cubierta) return false;
  if (c.helada && !clima.helada) return false;
  return true;
}

function unEncargo(s, lugares, vida, origen, n, clima) {
  const dado = hacerDado(s);
  const forma = elige(FORMAS, dado, CANAL.forma);
  // Se filtra ANTES de tirar, no despues. El dado usa los bits altos sobre la
  // longitud de la lista y es insesgado para cualquier n, asi que una lista de
  // longitud variable no lo rompe; sortear y luego descartar si, porque habria
  // que volver a tirar y las tiradas repetidas son las que sesgan.
  const posibles = TEMAS.filter((t) => valeAhora(t, clima));
  const tema = elige(posibles, dado, CANAL.tema);

  const A = oficioVivo(tema.A, vida, origen, dado, null);
  const B = oficioVivo(tema.B, vida, origen, dado, A);
  if (!A || !B) return null;

  // Siempre se saca al menos un sitio: aunque la forma no tenga paso 'ir', las
  // plantillas pueden nombrarlo ("pasa por {sitio}").
  const cuantos = Math.max(1, forma.filter((k) => k === 'ir').length);
  // Buscar sitio es un bucle que descarta y vuelve a tirar, asi que gasta un
  // numero de tiradas que depende de la semilla. Da igual: va por su canal y no
  // desplaza las tiradas de nadie.
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
    // `tema.llegada` cuenta lo que hay que ver -las huellas de lobo, el pilon
    // turbio- y eso pasa UNA vez. En un arco con dos 'ir' se leia igual en los
    // dos sitios, que son sitios distintos.
    const primeraLlegada = iSitio === 0;
    if (kind === 'ir') iSitio++;
    const quien = kind === 'recado' ? B : A;
    const voz = (lineas) => lineas.map((t) => [cap(quien), rellena(t, sitio)]);

    // `rol` y `encargo` son lo que permite atar un paso a la PERSONA que lo
    // resolvio: 'pedir' y 'cerrar' son los dos rol 'A' del mismo encargo, asi
    // que el que cierra tiene que ser el mismo vecino que te lo encargo, no
    // cualquiera de los 27 de su oficio. `quien` es el trozo del objetivo que se
    // sustituye por su nombre en cuanto se sabe cual es.
    //
    // Los objetivos se escriben con "con" y "para", que no se contraen: "vuelve
    // con el cantero" y "vuelve con Anton el cantero" valen los dos, mientras
    // que "vuelve a el cantero" no vale ninguno de los dos.
    switch (kind) {
      case 'pedir':
        return {
          oficio: A, rol: 'A', encargo: n, quien: el(A),
          objetivo: `Habla con ${el(A)}: dicen que ${tema.motivo}.`,
          dialogo: voz(elige(tema.pedir, dado, CANAL.pedir)),
        };
      case 'recado':
        return {
          oficio: B, rol: 'B', encargo: n, quien: el(B),
          objetivo: `El recado es para ${el(B)}.`,
          dialogo: voz(elige(tema.recado, dado, CANAL.recado)),
        };
      case 'ir':
        return {
          reach: sitio,
          radio: radioDe(sitio),
          encargo: n,
          objetivo: `Acercate a ${sitio.nombre}.`,
          dialogo: primeraLlegada
            ? [['', rellena(tema.llegada, sitio)],
              ['', rellena(elige(LLEGADA, dado, CANAL.llegada), sitio)]]
            : [['', rellena(elige(LLEGADA, dado, CANAL.llegada), sitio)]],
        };
      default:
        return {
          oficio: A, rol: 'A', encargo: n, quien: el(A),
          objetivo: `Vuelve con ${el(A)} y cuentale lo que has visto.`,
          dialogo: voz(elige(tema.cerrar, dado, CANAL.cerrar)),
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
  const inicio = dado(OFICIOS.length, CANAL.oficio);
  for (let i = 0; i < OFICIOS.length; i++) {
    const of = OFICIOS[(inicio + i) % OFICIOS.length];
    if (hay(of)) return of;
  }
  return null;
}

// Radio para dar por alcanzado un sitio, sacado de su huella: el Monasterio son
// 35.771 m2 y su centro cae dentro de los muros, asi que "llegar" es acercarse;
// una ermita con 90 m de radio se daria por alcanzada desde la calle de al lado.
function radioDe(sitio) {
  return Math.min(90, Math.max(25, Math.sqrt(sitio.area || 400)));
}

// `n` sitios con nombre, lejos del punto de partida y lejos entre si: un destino
// a treinta pasos no es un viaje, y uno pegado al jugador se daria por alcanzado
// en el primer fotograma, antes de que le hayan encargado nada.
//
// La distancia minima al punto de partida se mide contra el RADIO de cada sitio,
// no con un numero fijo: con 180 m para todos, aparecer en la lonja dejaba fuera
// al Monasterio -a 159 m, y con 90 m de radio- que es justo el sitio al que uno
// manda a un caminante en este pueblo.
function sitiosLejanos(lugares, dado, origen, n) {
  const todos = (lugares && lugares.antiguos) || [];
  if (!todos.length) return [];
  const out = [];
  // Dos pasadas: la primera con las distancias que interesan, la segunda sin
  // ellas, para no quedarse sin encargo en un pueblo pequeno.
  for (const exigir of [true, false]) {
    for (let t = 0; out.length < n && t < 80; t++) {
      const s = todos[dado(todos.length, CANAL.sitio)];
      if (out.includes(s)) continue;
      if (exigir) {
        if (distancia(origen, s) < Math.max(MIN_ORIGEN, radioDe(s) + MARGEN)) continue;
        if (out.some((o) => distancia(o, s) < MIN_ENTRE)) continue;
      }
      out.push(s);
    }
    if (out.length >= n) break;
  }
  return out;
}

// --- ayudantes ---------------------------------------------------------------

// Dado con estado sobre el mismo mezclador que los dialogos, y determinista: no
// hace falta otro generador aleatorio en el proyecto.
//
// Cada decision tira de SU canal, con su propia cuenta. Con un solo contador
// compartido, la tirada que elige una frase caia en una posicion u otra segun
// cuantas hubieran gastado las decisiones anteriores... que las tira el mismo
// dado. O sea que la frase quedaba amarrada al arco que hubiera salido antes, y
// lo que se recorria de la tabla del mezclador era una diagonal en vez de una
// fila. Se veia de lejos: de 3618 llegadas, la frase mas repetida salia 1013
// veces y la menos 258, cuando lo uniforme son 603.
//
// Con 9 tiradas por partida esto no se notaba. Con encargos que no se acaban, la
// variedad ES el juego, asi que si.
const CANAL = {
  forma: 1, tema: 2, oficio: 3, sitio: 4,
  pedir: 5, recado: 6, cerrar: 7, llegada: 8,
};

function hacerDado(semilla) {
  const gastado = new Map();
  return (n, canal) => {
    const i = gastado.get(canal) || 0;
    gastado.set(canal, i + 1);
    // Bits altos y no `% n`: `mezcla` acaba en una multiplicacion, y una
    // multiplicacion solo arrastra los acarreos hacia arriba, asi que los bits
    // de abajo -que es donde mira el modulo- son los que menos se mueven.
    return Math.floor((mezcla(semilla, canal, i) / 4294967296) * n);
  };
}

function elige(lista, dado, canal) { return lista[dado(lista.length, canal)]; }

function el(of) { return `${FEMENINO.has(of) ? 'la' : 'el'} ${of}`; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// LLEGADA sale fuera solo para que quests.test.mjs pueda contar cuantas veces
// cae cada frase: es el sitio donde antes se veia el dado sesgado.
export { OFICIOS, LLEGADA };
