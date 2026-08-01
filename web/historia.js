// Lo que se puede aprender aqui de verdad.
//
// El juego pasa hacia 1570, con las obras del Monasterio en marcha, y eso da una
// fecha muy concreta con la que trabajar: Juan Bautista de Toledo lleva tres anos
// muerto, Juan de Herrera anda en la obra pero todavia no tiene la direccion
// principal, el convento se termina el ano que viene, la basilica no ha empezado
// y el pueblo NO EXISTE.
//
// De ahi salen los dos canales, y la razon de que sean dos:
//
//   VOCES     lo que ese oficio puede saber estando alli en 1570. Un cantero
//             sabe de que cantera baja su piedra y quien es el obrero mayor.
//   CARTELAS  lo que nadie de 1570 puede decir: que la obra acabara en 1584, que
//             a esto se le llamara estilo herreriano, que la UNESCO lo declarara
//             Patrimonio de la Humanidad en 1984. Eso va en cartela de museo,
//             fuera de la ficcion, con su fuente al pie.
//
// La regla: si un dato lleva fecha, nombre propio o cifra, va con `fuente`. El
// test comprueba que no haya ni uno sin ella. Un modo que se llama educativo no
// puede permitirse un "creo que fue por 1562": esa fecha, sin ir mas lejos,
// aparece en fuentes secundarias, y la buena -la primera piedra- es el 23 de
// abril de 1563.

const PN = 'Patrimonio Nacional y Ayuntamiento de San Lorenzo de El Escorial';
const WK = 'Real Monasterio de San Lorenzo de El Escorial, cronologia contrastada';
const AYTO = 'Ayuntamiento de San Lorenzo de El Escorial, historia del municipio';

// --- cartelas -------------------------------------------------------------------
//
// `sitio` es un trozo del nombre de un lugar de OSM: la cartela salta al
// acercarse a el. Sin `sitio`, la cartela puede salir en cualquier parte.
export const CARTELAS = [
  {
    id: 'primera-piedra',
    sitio: 'Monasterio',
    titulo: 'La primera piedra',
    texto: 'Se puso el 23 de abril de 1563. Cuando andas por aqui lleva siete '
      + 'años de obra y le quedan veintiuno: la fabrica no se da por acabada '
      + 'hasta el 13 de septiembre de 1584.',
    fuente: PN,
  },
  {
    id: 'san-quintin',
    sitio: 'Monasterio',
    titulo: 'Por que San Lorenzo',
    texto: 'Felipe II vencio en San Quintin el 10 de agosto de 1557, dia de san '
      + 'Lorenzo. De ahi el nombre, y de ahi la planta: el santo murio asado en '
      + 'una parrilla, y en parrilla esta trazado el edificio, con sus crujias '
      + 'por barrotes y las torres por pies.',
    fuente: WK,
  },
  {
    id: 'arquitectos',
    sitio: 'Monasterio',
    titulo: 'Quien lo traza',
    texto: 'Juan Bautista de Toledo, arquitecto real desde el 15 de julio de '
      + '1559, dio la traza y murio el 19 de mayo de 1567. Juan de Herrera '
      + 'estaba en la obra desde febrero de 1563 y tomo la direccion en 1572. '
      + 'Al modo de construir que sale de aqui se le llamara herreriano, pero '
      + 'eso es un nombre que pone la posteridad, no ellos.',
    fuente: WK,
  },
  {
    id: 'villacastin',
    sitio: 'Monasterio',
    titulo: 'El obrero mayor',
    texto: 'Fray Antonio de Villacastin (h. 1512 - 3 de marzo de 1603), '
      + 'jeronimo, llego en 1562 para dirigir la obra y siguio en ella cuarenta '
      + 'años. No era arquitecto: era un aparejador que aprendio el oficio con '
      + 'un maestro cantero en Toledo. Dejo escritas unas Memorias.',
    fuente: 'Memorias de fray Antonio de Villacastin, ed. Julian Zarco Cuevas',
  },
  {
    id: 'medidas',
    sitio: 'Monasterio',
    titulo: 'Lo que mide',
    texto: '33.327 metros cuadrados de planta, 205 por 162 metros, y 95 metros '
      + 'de altura desde el suelo de la iglesia. Esta a 1.028 metros sobre el '
      + 'mar, que es la altitud que explica el frio que hace.',
    fuente: WK,
  },
  {
    id: 'orden-obras',
    sitio: 'Monasterio',
    titulo: 'Lo que hay hecho hacia 1570',
    texto: 'El convento se termina en 1571. La casa del rey se empieza en 1572 '
      + 'y la basilica en 1574, y no se cierra hasta 1586. Asi que lo que ves '
      + 'levantado no es ni la mitad de lo que sera.',
    fuente: AYTO,
  },
  {
    id: 'unesco',
    sitio: 'Monasterio',
    titulo: 'Cuatro siglos despues',
    texto: 'El Monasterio y el Real Sitio son Monumento Historico-Artistico '
      + 'desde 1931 y Patrimonio de la Humanidad de la UNESCO desde 1984.',
    fuente: 'Ministerio de Cultura, bienes inscritos en 1984',
  },
  // La cartela mas importante de todas, y la que mas cuesta poner.
  {
    id: 'el-pueblo-no-existe',
    sitio: null,
    titulo: 'Aviso: el pueblo que estas pisando',
    texto: 'En 1570 San Lorenzo no existia. Aqui habia un paraje de monte y '
      + 'pastos que colonizaron pobladores segovianos en el siglo XII para su '
      + 'ganado, y el pueblo nacio despues, de la propia obra y de las dos '
      + 'Casas de Oficios que mando levantar Felipe II. Este juego dibuja los '
      + '3.545 edificios que OpenStreetMap conoce del pueblo de HOY, con sus '
      + 'calles y sus nombres de hoy: el Monasterio esta donde esta de verdad y '
      + 'el terreno es el del IGN, pero el caserio que lo rodea es de otros '
      + 'siglos. Se dice aqui en vez de dejar que parezca lo que no es.',
    fuente: AYTO,
  },
];

// --- voces ------------------------------------------------------------------------
//
// Lo que cada oficio puede saber estando alli. Nada de fechas de despues de 1570
// ni palabras que no existian: aqui nadie dice "herreriano" ni "Renacimiento".
export const VOCES = {
  fraile: [
    'Somos jeronimos. Su Majestad nos trajo a guardar la casa y a decir el oficio, '
      + 'y de la obra manda fray Antonio, que lleva aqui desde el principio.',
    'Se llama San Lorenzo por la batalla de San Quintin, que se gano en su dia. '
      + 'Por eso la planta es una parrilla: el santo murio asado en una.',
    'El convento se cierra el año que viene, si Dios quiere. Lo demas -la casa '
      + 'del rey, la iglesia grande- esta por empezar.',
  ],
  cantero: [
    'El granito sale de aqui al lado. No hay que traerlo de ninguna parte, y esa '
      + 'es media razon de que la casa se plante en este monte y no en otro.',
    'El maestro Juan Bautista murio hace tres años. Ahora traza el señor Herrera, '
      + 'que vino a la obra el mismo año que se puso la primera piedra.',
    'Un sillar bien labrado no necesita casi mortero: se asienta por su peso y '
      + 'por su cara. Lo que mata a un muro es la junta, no la piedra.',
    'De noviembre a marzo no se asienta sillar. La cal no fragua con hielo: se '
      + 'congela el agua dentro y revienta la junta.',
  ],
  aguador: [
    'El agua buena baja de Abantos. Con mil bocas en la obra y la cal bebiendo '
      + 'mas que los hombres, no hay pilon que aguante.',
  ],
  herrero: [
    'Punteros, escodas y cunas. Aqui el hierro no se gasta: se come. El granito '
      + 'se lleva por delante dos herramientas por semana y hombre.',
  ],
  panadera: [
    'La obra come. Eso es lo que nadie cuenta de una obra asi: antes que piedra '
      + 'hace falta pan, y antes que pan, quien lo amase.',
  ],
  pastora: [
    'Esto era monte y pasto antes que nada. Los de Segovia subieron el ganado '
      + 'aqui hace cuatrocientos años y desde entonces no ha sido otra cosa.',
    'El monte es del Rey. Para cortar un roble caido hace falta papel, aunque '
      + 'lleve dos años pudriendose.',
  ],
  pescadero: [
    'Viernes y vigilias. Con un convento al lado y la obra entera comiendo de '
      + 'pescado la mitad del año, no doy abasto con las truchas de la sierra.',
  ],
  tejedora: [
    'Capotes. Los peones duermen fuera y aqui a mil metros el invierno no '
      + 'perdona. Tino con cascara de nuez y con roble, que es lo que hay.',
  ],
};

// Comprobacion barata que se ejecuta al importar: cada cartela con su fuente.
// Vale mas que un test aparte, porque el fallo salta en cuanto se carga el
// modulo y no cuando a alguien se le ocurre pasar las pruebas.
for (const c of CARTELAS) {
  if (!c.fuente || !c.titulo || !c.texto) {
    throw new Error(`cartela sin fuente o sin texto: ${c.id}`);
  }
}
