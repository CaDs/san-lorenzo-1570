// Los veinticinco misterios.
//
// Esto NO es el modo saber. Alli va lo que esta documentado y lleva fuente al
// pie; aqui va lo que se cuenta, que es otra cosa y no se puede mezclar sin
// estropear las dos. Son leyenda y tradicion oral: lo que se decia en las obras
// y lo que se sigue diciendo en el pueblo, sin dar por cierto nada.
//
// La mitad son cosas y la otra mitad son personas. Las cosas se examinan
// acercandose; a las personas se les habla, y entonces sueltan lo suyo en vez de
// la charla de su oficio.
//
// Se reparten por semilla y no estan clavados: dos partidas no esconden lo mismo
// en el mismo sitio. Pero SI se anclan a lugares con nombre de OSM, que es lo
// que evita que un misterio aparezca en mitad de un prado a doscientos metros de
// nada y no lo encuentre nadie en la vida.

import { mezcla } from './dialogos.js';
import { OFICIOS } from './tramas.js';

// `pista` es lo que se lee en la lista mientras no lo has encontrado: tiene que
// picar sin resolverlo. `texto` es lo que se lee al encontrarlo.
export const MISTERIOS = [
  // --- cosas ---------------------------------------------------------------
  {
    id: 'marcas', tipo: 'objeto', nombre: 'Las marcas de los canteros',
    pista: 'Dicen que la piedra esta firmada, si sabes donde mirar.',
    texto: 'En el sillar hay grabada una figura pequeña: una cruz con un rabo, '
      + 'como una llave. Cada cuadrilla marca lo suyo para que le paguen por '
      + 'pieza. Este cantero no sabe escribir su nombre y aun asi lleva '
      + 'cuatrocientos años firmando.',
  },
  {
    id: 'galerias', tipo: 'objeto', nombre: 'La boca que no lleva a ninguna parte',
    pista: 'Un hueco en el suelo por el que baja aire y no sube.',
    texto: 'Una boca de desague, o eso parece. Cae aire frio hacia dentro y no '
      + 'vuelve. Entre los peones se cuenta que las galerias de la casa siguen '
      + 'bajando mucho despues de donde acaban los planos, y que una de ellas da '
      + 'a una puerta que no conviene abrir.',
  },
  {
    id: 'campana', tipo: 'objeto', nombre: 'La campana que suena a leña',
    pista: 'Suena, pero no como debe.',
    texto: 'Un golpe seco, sin cola. La rajadura no se ve por fuera. Los viejos '
      + 'dicen que se rajo sola la noche que murio un peon en el andamio, y que '
      + 'desde entonces no da la hora bien: siempre se adelanta un poco.',
  },
  {
    id: 'silla', tipo: 'objeto', nombre: 'La silla en la roca',
    pista: 'Alguien se sento aqui a mirar como crecia una montaña.',
    texto: 'Unos escalones y un asiento labrados en el granito, mirando a la '
      + 'obra. Se dice que el Rey sube a sentarse aqui a ver como sube la '
      + 'fabrica, y que se esta horas sin hablar con nadie. Nadie lo ha visto '
      + 'subir. Todos saben que se sienta ahi.',
  },
  {
    id: 'reliquias', tipo: 'objeto', nombre: 'El arcon que llego de noche',
    pista: 'Un arcon que descargaron sin que lo viera nadie.',
    texto: 'Un arcon ferrado, precintado, con el sello de la casa. Llego de '
      + 'madrugada y lo metieron cuatro frailes sin decir palabra. Se cuenta que '
      + 'el Rey esta juntando huesos de santo por miles para blindar la casa, y '
      + 'que no le parecen bastantes.',
  },
  {
    id: 'sombra', tipo: 'objeto', nombre: 'La sombra que sobra',
    pista: 'A mediodia el reloj de sol marca lo que no toca.',
    texto: 'El gnomon proyecta la sombra dos dedos a la izquierda de donde '
      + 'deberia. El cantero jura que lo trazo bien. Los frailes dicen que la '
      + 'hora de esta casa no es la del mundo y que ya se ajustara sola.',
  },
  {
    id: 'agua', tipo: 'objeto', nombre: 'El pilon que nunca se hiela',
    pista: 'Hiela todo el pueblo menos un sitio.',
    texto: 'Con escarcha en las tejas y en los cantaros, este pilon sigue '
      + 'liquido. El aguador dice que el agua baja caliente de dentro del monte. '
      + 'El fraile dice que no se hiela porque se bendijo. El pilon no dice nada.',
  },
  {
    id: 'piedra', tipo: 'objeto', nombre: 'La piedra que no encaja',
    pista: 'Un sillar puesto del reves, y nadie lo cambia.',
    texto: 'Un sillar girado, con la cara buena hacia dentro. Rompe la hilada y '
      + 'se ve desde la calle. Se cuenta que lo dejaron asi a proposito: que una '
      + 'obra perfecta ofende, y que hay que dejar siempre un error a la vista '
      + 'para que no se enfade quien mira desde arriba.',
  },
  {
    id: 'mano', tipo: 'objeto', nombre: 'La mano en la argamasa',
    pista: 'Alguien dejo la mano puesta antes de que fraguara.',
    texto: 'Una huella de mano abierta, pequeña, en la junta. De un chico de los '
      + 'que suben el agua, quiza. Los peones no la pican: dicen que la casa '
      + 'necesita que alguien la haya tocado con la mano desnuda, y que si se '
      + 'borra hay que poner otra.',
  },
  {
    id: 'lobo', tipo: 'objeto', nombre: 'Las huellas de la dehesa',
    pista: 'Mas anchas que las de un perro, y no van a ninguna parte.',
    texto: 'Huellas en el barro, anchas, con las uñas marcadas. Vienen del monte '
      + 'y se paran aqui: no siguen, no dan la vuelta, no entran en ningun '
      + 'sitio. Simplemente se acaban.',
  },
  {
    id: 'carro', tipo: 'objeto', nombre: 'El carro que no llego',
    pista: 'Cargado de piedra, parado desde hace semanas.',
    texto: 'Un carro con el eje partido y la carga puesta, comido de zarza. Lo '
      + 'dejaron ahi el dia que se despeno la yunta. Nadie lo descarga y nadie '
      + 'lo mueve: el capataz dijo que se moviera y a la semana siguiente se '
      + 'partio una pierna, y desde entonces no lo ha vuelto a decir.',
  },
  {
    id: 'ventana', tipo: 'objeto', nombre: 'La ventana que da a un muro',
    pista: 'Tiene reja, tiene marco, y detras no hay nada.',
    texto: 'Una ventana enrejada a media altura, y al asomarse: piedra maciza a '
      + 'un palmo. O sobro en la traza, o hay una estancia que se tapio con algo '
      + 'dentro. Los que llevan mas años aqui prefieren la primera explicacion.',
  },
  {
    id: 'moneda', tipo: 'objeto', nombre: 'La moneda bajo el umbral',
    pista: 'Algo brilla en la junta del escalon.',
    texto: 'Un real de plata metido de canto en la junta, bajo el umbral. Se '
      + 'pone al levantar una casa para que no falte el pan dentro. Sacarla trae '
      + 'lo contrario, asi que ahi sigue y ahi seguira.',
  },
  {
    id: 'pedrin', tipo: 'objeto', nombre: 'La cruz del camino de Abantos',
    pista: 'Monte arriba, donde la senda se parte, hay un majano con algo clavado.',
    texto: 'Dos maderos atados, clavados en un majano de piedras, donde el '
      + 'camino de la cumbre se parte en dos. Los que suben a por leña le echan '
      + 'una piedra al pasar. Dicen que se puso por un niño que subio detras del '
      + 'ganado y al que se le echo la noche encima, y que quien no le deje su '
      + 'piedra oye llamar a alguien cuando ya no hay nadie.',
  },
  // --- personas ------------------------------------------------------------
  {
    id: 'aullido', tipo: 'persona', oficio: 'pastora',
    nombre: 'La que oye al perro todas las noches',
    pista: 'Alguien duerme mal desde hace meses.',
    texto: 'Todas las noches, entre las doce y las dos. No es un perro de casa: '
      + 'un perro de casa calla cuando le gritas. Este contesta.',
  },
  {
    id: 'peon', tipo: 'persona', oficio: 'cantero',
    nombre: 'El que cuenta lo que vio en el andamio',
    pista: 'Uno que dejo de trabajar de noche y no explica por que.',
    texto: 'Subi a por la escoda que me habia dejado y habia alguien arriba, de '
      + 'negro, mirando la obra desde el borde. Le hable. Se giro despacio. '
      + 'Baje sin la escoda y no he vuelto a subir de noche.',
  },
  {
    id: 'cuenta', tipo: 'persona', oficio: 'fraile',
    nombre: 'El que lleva la cuenta de lo que no cuadra',
    pista: 'Alguien lleva un libro que no enseña a nadie.',
    texto: 'Llevo la cuenta de las piedras que entran y de las que se asientan, '
      + 'y no me sale. Faltan. Pocas, pero faltan todos los meses, y llevo asi '
      + 'cuatro años. No se las lleva nadie: yo he mirado.',
  },
  {
    id: 'hierro', tipo: 'persona', oficio: 'herrero',
    nombre: 'El que forjo algo que no le encargaron',
    pista: 'A alguien le pidieron una pieza rara.',
    texto: 'Me trajeron un dibujo y me dijeron: esto, en hierro, y no preguntes. '
      + 'Ni reja ni cerradura ni herramienta. Lo hice, cobre y me calle. Aun '
      + 'sueño con la forma que tenia.',
  },
  {
    id: 'pan', tipo: 'persona', oficio: 'panadera',
    nombre: 'La que amasa de mas todos los viernes',
    pista: 'Alguien hace mas pan del que vende.',
    texto: 'Dejo dos hogazas en el poyete de fuera cada viernes y a la mañana no '
      + 'estan. Mi madre lo hacia y su madre tambien. Nadie me ha dicho nunca '
      + 'para quien son, y yo no pregunto.',
  },
  {
    id: 'pozo', tipo: 'persona', oficio: 'aguador',
    nombre: 'El que no saca agua de un pozo',
    pista: 'Hay un pozo del que nadie bebe.',
    texto: 'De ese no. No es que este seco ni malo: es que el cubo baja mas de '
      + 'lo que debe. Lo medi con soga y no le encontre el fondo, y desde '
      + 'entonces cargo de la fuente aunque me cueste el doble de camino.',
  },
  {
    id: 'telar', tipo: 'persona', oficio: 'tejedora',
    nombre: 'La que tejio un pano que no era para nadie',
    pista: 'Un encargo que nadie vino a recoger.',
    texto: 'Nueve varas de pano negro, sin ribete, y las medidas de un hombre '
      + 'alto. Lo pagaron por delante. Lleva tres años doblado en el arca, y '
      + 'cada vez que lo saco a airear esta como el primer dia.',
  },
  {
    id: 'rio', tipo: 'persona', oficio: 'pescadero',
    nombre: 'El que dejo de pescar en un tramo',
    pista: 'Hay un recodo del arroyo donde ya no echa nadie el aparejo.',
    texto: 'Sacaba buenas truchas de ahi. Un dia saque otra cosa y la volvi a '
      + 'echar sin mirarla dos veces. Desde entonces subo doscientos pasos mas '
      + 'arriba, y no me importa el camino.',
  },
  {
    id: 'vieja', tipo: 'persona', oficio: 'pastora',
    nombre: 'La que sabe lo que habia antes',
    pista: 'Alguien se acuerda de esto cuando no habia nada.',
    texto: 'Yo subia el ganado aqui cuando esto era monte y no habia mas que '
      + 'jaras y un corral. Vinieron, midieron, y en un año habia mil hombres. '
      + 'De lo que habia antes ya no queda quien se acuerde, salvo yo, y yo me '
      + 'estoy acabando.',
  },
  {
    id: 'nino', tipo: 'persona', oficio: 'panadera',
    nombre: 'La que cuenta lo del niño de la obra',
    pista: 'Falta alguien y nadie lo dice en voz alta.',
    texto: 'Habia un chico que subia el agua a los andamios. Un dia no vino y no '
      + 'lo busco nadie, porque no era de aqui. Yo le guardaba pan. Sigo '
      + 'guardandolo, por si acaso.',
  },
  {
    id: 'plano', tipo: 'persona', oficio: 'cantero',
    nombre: 'El que vio un plano de mas',
    pista: 'Alguien vio una traza que no era la que se labra.',
    texto: 'Vi un pliego encima de la mesa del maestro con la planta entera, y '
      + 'tenia una crujia que aqui no se esta levantando. Se lo dije. Me contesto '
      + 'que mirara mi sillar y me dejara de papeles.',
  },
  {
    id: 'sacristan', tipo: 'persona', oficio: 'fraile',
    nombre: 'El que cierra y vuelve a encontrar abierto',
    pista: 'Alguien echa la llave y a la mañana no esta echada.',
    texto: 'Cierro yo, con mi llave, y soy el unico que la tiene. Tres veces en '
      + 'lo que va de año me la he encontrado abierta al alba, y con las velas '
      + 'consumidas hasta abajo, como si alguien hubiera velado toda la noche.',
  },
];

// --- los que tienen un sitio y no se mueven de el -----------------------------
//
// Un misterio anclado a un sitio con nombre CUALQUIERA es lo que ponia la Silla
// de Felipe II en la lonja del Monasterio, y eso no tiene arreglo por mucho que
// el texto sea bueno: la Silla es un pedrusco concreto en un cerro concreto, a
// dos kilometros largos al sur, y ponerla en la lonja es lo mismo que poner el
// Monasterio en la dehesa.
//
// Las coordenadas salen de OSM y estan pasadas a EPSG:25830 y de ahi al mundo
// (x = Este - 401500, z = 4495100 - Norte). Las dos caen FUERA del recorte del
// casco, que es justo el motivo de que hubiera que traer la sierra: sin ella no
// habia suelo donde ponerlas.
const ANCLAS = {
  // node/285895835 - 40,56854 N, 4,15254 O. 1,5 km al sur del borde del pueblo.
  silla: { x: 939, z: 3599, sitio: 'la Silla de Felipe II' },
  // node/6286271279 - 40,60047 N, 4,15807 O, en la ladera de Abantos. La cruz
  // que hay hoy es de hace un siglo largo, no de 1570; lo que se pone aqui es el
  // cruce de caminos donde esta, que si es de siempre, y la costumbre del majano.
  pedrin: { x: 518, z: 49, sitio: 'el camino de Abantos' },
};

// --- reparto ---------------------------------------------------------------

const RADIO = 26;    // m alrededor del sitio con nombre donde puede caer

// Coloca los 25. Determinista a partir de la semilla.
//
// Los de OBJETO se anclan a un sitio con nombre y se apartan un poco de su
// centro; los de PERSONA se atan a un vecino concreto del oficio que toque, con
// el mismo mecanismo con el que un encargo recuerda con quien hay que volver.
//
// Anclarlos a sitios con nombre no es un capricho: repartidos a boleo por 3,6
// km, la mitad caeria en la dehesa y no los encontraria nadie. Asi caen donde ya
// hay algo que mirar.
export function repartir(semilla, lugares, vida) {
  const sitios = (lugares && lugares.antiguos) || [];
  const out = [];
  const usados = new Set();       // sitios ya ocupados por un misterio de objeto
  const usadosNpc = new Set();    // vecinos que ya guardan uno

  MISTERIOS.forEach((m, i) => {
    const u = (c) => mezcla(semilla, 0x4d15, i * 8 + c) / 4294967296;

    if (m.tipo === 'persona') {
      // Un vecino de ese oficio. Se pide el mas cercano a un punto sorteado, que
      // es la unica forma de elegir uno concreto con la interfaz que hay.
      const punto = sitios.length
        ? sitios[Math.floor(u(0) * sitios.length)]
        : { x: 0, z: 0 };
      // El oficio es una PREFERENCIA, no una condicion. Si de ese no queda
      // nadie -porque llueve y se han metido en casa, o porque el sorteo no dio
      // ninguno- se busca en otro: una leyenda que cuenta una pastora la puede
      // contar una panadera. Sin este respaldo el misterio no se coloca, y
      // entonces el contador dice 23 de 25 y los dos que faltan no existen, que
      // es la peor forma posible de que algo este roto.
      // Y ademas tiene que ser un vecino DISTINTO de los ya usados. Sin esto,
      // los dos misterios de fraile se ataban al mismo fraile -buscarOficio
      // devuelve el mas cercano al punto, y dos puntos parecidos dan el mismo
      // vecino-, y entonces el segundo solo salia hablandole por segunda vez,
      // sin que nada lo indicara. Se prueban otros puntos y, si no, otros oficios.
      let f = null;
      for (let k = 0; k < 24 && !f; k++) {
        const of = k < 6 ? m.oficio
          : OFICIOS[Math.floor(u(1 + (k % 6)) * OFICIOS.length) % OFICIOS.length];
        const desde = sitios.length
          ? sitios[Math.floor(u(2 + k) * sitios.length)]
          : punto;
        const cand = vida && vida.buscarOficio ? vida.buscarOficio(of, desde) : null;
        if (cand && !usadosNpc.has(cand.id)) f = cand;
      }
      if (!f) return;                     // no hay vecindario: no hay misterio
      usadosNpc.add(f.id);
      // Solo el id. No hace falta guardar donde esta: a una persona se la
      // encuentra hablandole, no acercandose, y ademas anda por el pueblo, asi
      // que la posicion de ahora no vale para nada dentro de dos minutos.
      out.push({ ...m, npcId: f.id });
      return;
    }

    // Los que tienen sitio de verdad no entran en el sorteo.
    const fijo = ANCLAS[m.id];
    if (fijo) {
      out.push({ ...m, sitio: fijo.sitio, x: fijo.x, z: fijo.z });
      return;
    }

    if (!sitios.length) return;
    // Dos misterios en el mismo sitio se pisan: se busca otro.
    let sitio = null;
    for (let t = 0; t < 12 && !sitio; t++) {
      const s = sitios[Math.floor(u(t) * sitios.length)];
      if (!usados.has(s.nombre)) sitio = s;
    }
    if (!sitio) sitio = sitios[Math.floor(u(0) * sitios.length)];
    usados.add(sitio.nombre);
    const a = u(5) * Math.PI * 2;
    const r = 8 + u(6) * RADIO;
    out.push({ ...m, sitio: sitio.nombre,
      x: sitio.x + Math.cos(a) * r, z: sitio.z + Math.sin(a) * r });
  });

  return out;
}
