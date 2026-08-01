# Los modulos

Detalle tecnico de `web/`. Para jugar, ver el README de la raiz.

## Por que Three.js y no Godot

El proyecto empezo en Godot. Su export web obliga al renderizador Compatibility,
cuyo sesgo de sombra direccional no es accesible, y con un terreno de 5 m por
triangulo eso es acne de sombra: la dehesa entera salia negra, de dia y de noche.
Aqui la camara de sombra y su sesgo son tres lineas propias. De paso, 700 KB de
JavaScript en vez de 49 MB de wasm+pck.

## Los datos

`data/build/world.json` y `terrain.bin` son lo unico que el juego descarga. El
navegador los lee tal cual: `fetch` y `new Float32Array(buffer)`. Los produce
`tools/prep.py` desde el MDT del IGN y OpenStreetMap; ver ATTRIBUTION.md.

## Ficheros

| aqui | que es |
|---|---|
| `world.js` | terreno, caserio, Monasterio, calles, antorchas y atrezzo |
| `daynight.js` | ciclo solar real por latitud, cielo procedural, estrellas, sombras |
| `player.js` | andar, correr, volar, colision contra fachadas |
| `minimap.js` | pergamino de esquina |
| `trees.js` | arquetipos de encina y pino, instanciados |
| `npcs.js` | vecinos, perros, gatos, vacas, ovejas, gallinas, pajaros y el rey |
| `quests.js` | el hilo del encargo en curso y el pergamino de dialogo |
| `tramas.js` | generador de encargos: formas, temas y huecos |
| `clima.js` | el tiempo que hace, como funcion pura de semilla, dia y hora |
| `ui.js` | la barra de abajo: hora, dia del ano, tiempo, misterios y ayuda |
| `lluvia.js` | lluvia y nieve, una sola malla instanciada |
| `historia.js` | lo documentado, con su fuente por dato (modo saber) |
| `misterios.js` | los 25 de leyenda, repartidos por semilla |
| `humo.js` | humo de las chimeneas |
| `main.js` | camara, revelado, portada y bucle |
| `lugares.js` | los sitios con su nombre real, rumbos y distancias |
| `dialogos.js` | lo que dicen los vecinos |

## Resolucion

El lienzo no es fijo: se elige un factor de escala ENTERO para acercarse a 540
lineas y se ajusta a la ventana. El pixel sigue siendo cuadrado -sin eso esto no
es pixel art, es una imagen borrosa- pero cabe cuatro veces mas detalle que en
los 480x270 de la version Godot, y no hay bandas negras. Se recalcula al
redimensionar; el minimapa y el HUD escalan con el mismo factor entero.

## Parametros de URL

| | |
|---|---|
| `?hour=21.5` | congela el reloj a esa hora, para comparar capturas |
| `?x=&z=&yaw=` | punto de aparicion; por defecto la lonja del Monasterio |
| `?test` | comprobacion ejecutable del jugador; el veredicto va a la consola |

`window.__step(n)` avanza n fotogramas con paso fijo y dibuja: en una pestana
oculta `requestAnimationFrame` no dispara, asi que sin esto no hay captura
reproducible desde un script.

## El Monasterio

Muralla perimetral sobre su huella real de OSM, y ademas:

- **La parrilla.** Reticula de 4x3 patios levantada sobre la tapa de la muralla,
  con crujias de cubierta a dos aguas de pizarra entre ellos. La tapa deja de ser
  cubierta y pasa a hacer de enlosado del fondo de los patios, que es lo que
  evita tener que recortar la huella real de OSM (viene mellada por los jardines).
- **Ventanas en reticula.** El shader de fachada tiene modo Monasterio: los
  huecos no se sortean como en el caserio, van todos, alineados, con recerco de
  granito claro y menos lumbre encendida dentro. `ainfo` paso de vec2 a vec3 para
  llevar la bandera.
- **Torres de esquina metidas a medida.** Media torre de retranqueo no bastaba:
  la torre es un cuadrado orientado con el eje largo y las esquinas del Monasterio
  van achaflanadas, asi que la esquina exterior asomaba 3,2 m por fuera de la
  muralla, con 36 m de fachada debajo. Ahora se mete de medio en medio metro hasta
  que las cuatro esquinas de su base pisan la huella. Las crujias ya se recortaban
  bien: de los 94 triangulos de pizarra del Monasterio, los 14 que se salian eran
  todos de las torres.
- **Linternilla** sobre la cupula del cimborrio.
- Chapiteles, cimborrio y torres de campanas dimensionados para que la silueta
  mande sobre la masa de las crujias, que llegan a 28 m.

Los vanos van a 6.5 m y las plantas a 5.0, no a las medidas reales. Una fachada
de 200 m con vanos de 4 m son 50 huecos de pixel y medio a esta resolucion, y se
leen como ruido en vez de como ventanas.

## El pueblo vivo

- **Arboles** (`trees.js`): 4233 arboles en 9 arquetipos instanciados. Tronco
  acampanado, ramas y copa de racimos con normales promediadas. Lo que hace que
  se lean como follaje y no como cristales es el suavizado de normales, no el
  numero de triangulos: 144 por encina, 118 por pino.
- **Vecinos** (`npcs.js`): 220 vecinos recorren el grafo de calles, con 30
  perros, 60 ovejas, 70 gallinas y 24 pajaros. La siembra se pondera por
  densidad de edificios sobre las calles alumbradas, no uniformemente: repartir
  a voleo por los 3600x2100 m dejaba al vecino mas cercano a 82 m del punto de
  aparicion y el pueblo parecia deshabitado. Solo se simula lo que esta a menos
  de 120 m de la camara.
- **Cubiertas** (`world.js`): dos aguas sobre el rectangulo orientado de la
  planta cuando ese rectangulo la representa, y cuatro aguas truncadas sobre la
  huella real -faldon hasta un anillo metido hacia dentro, y ese anillo tapado
  con su triangulacion de orejas- cuando no. La decision se toma sondeando el
  rectangulo cada 2 m: por las cuatro esquinas no se ve el entrante de una planta
  en L, que es donde salian los tejados flotando. La piramide en abanico que se
  usaba antes para las cuatro aguas se sale sola en cuanto la planta es concava:
  sus TRIANGULOS cruzan el patio aunque todos sus vertices esten en la huella.
  Medido en vuelo de la peor sonda: 17,8 m antes, 2,4 m ahora -el alero (0,45) mas
  la holgura que se le permite al rectangulo (1,0)-, y ni una sonda pasa de 2,5 m
  (`?test`).
- **Encargos** (`tramas.js` + `quests.js`): procedurales y **sin fin**. Un
  encargo es una FORMA (diez arcos de tres o cuatro pasos: quien te manda, a
  donde vas, quien recibe el recado) mas un TEMA (ocho: los lobos de la dehesa,
  el agua de la argamasa, la campana rajada de San Bernabe, el pliego de Su
  Majestad...) con los huecos rellenados con los oficios que estan VIVOS y con
  los 28 sitios de epoca de OSM. No se generan tres al arrancar: se pide el
  siguiente cuando se acaba el anterior, con la semilla `mezcla(semilla, n)`, asi
  que la partida no se queda sin encargos y `?seed=1234` sigue devolviendo los
  mismos, que es lo unico que hace depurable un generador. Los destinos se
  filtran por nombre -OSM nombra el pueblo de hoy, y un vecino de 1570 no manda a
  nadie al Ahorramas- y se exige que esten a mas del punto de aparicion que su
  propio radio de llegada, o se darian por alcanzados antes de que te los
  encarguen; con los 180 m fijos de antes, aparecer en la lonja dejaba fuera al
  Monasterio, que cae a 159 m.
- **Encargos de temporada** (`tramas.js`): cinco temas llevan `cuando` y solo
  salen si toca -la nieve que corta el camino de los carros de piedra, la helada
  que revienta la cal recien puesta (la cal no fragua bajo cero, y por eso la
  obra paraba en invierno), la siega, la riada que se lleva el vado, la lena
  antes del invierno-. Se filtra ANTES de tirar el dado, no despues: el dado usa
  los bits altos sobre la longitud de la lista y es insesgado para cualquier
  numero de temas, mientras que sortear y descartar obligaria a repetir tiradas,
  que es justo lo que sesga. Y **no hay remedio para el caso de que el filtro se
  quede sin temas**, porque no puede pasar: los ocho de siempre no llevan
  `cuando`, asi que la lista nunca baja de ocho. La regla al anadir es "no le
  pongas `cuando` a un tema que ya existe"; un remedio para un caso imposible es
  una rama que nadie vuelve a leer. El test recorre las 56 combinaciones de epoca
  y tiempo y comprueba tambien que cada tema de temporada salga donde toca y
  **no salga fuera**: una etiqueta que no filtra nada es una etiqueta que sobra.
- **Un encargo lo cierra QUIEN te lo dio** (`quests.js`): hay 220 vecinos y ocho
  oficios, o sea unos 27 canteros por la calle. "Vuelve con el cantero" lo
  cerraba el primero con el que te cruzaras, casi nunca el que te lo encargo, y
  asi el viaje que arma el generador -sitios lejanos, distancias minimas- lo
  resolvia la estadistica de sombreros. Ahora se apunta quien resolvio cada hueco
  del encargo y el paso que cierra le busca a el. Para eso los vecinos tienen
  nombre de pila, repartido de forma que no haya dos iguales dentro de un oficio:
  atar el objetivo a alguien que no se distingue de otros veintiseis no seria un
  encargo, seria una caza.
- **El dado va por canales** (`tramas.js`): cada decision -arco, tema, oficio,
  sitio, cada bolsa de frases- tira de su propio contador. Con un contador
  compartido, la tirada que elige una frase caia en una posicion u otra segun
  cuantas hubieran gastado las decisiones anteriores, que las tira el mismo dado:
  la frase quedaba amarrada al arco. De 3618 llegadas, la mas repetida salia 1013
  veces y la menos 258, con 603 de media. Con nueve tiradas por partida no se
  veia; con encargos que no se acaban, la variedad es lo unico que hay.
  `make tramas` prueba 300 semillas, una cadena de 500 encargos seguidos y el
  reparto del dado, todo sin navegador.
- **La conversacion se puede dejar** (`quests.js`): `X` la cierra, y alejarse
  andando mas de 9 m la corta sola. Antes el bocadillo no tenia salida -solo
  ofrecia "E seguir"- y seguia abierto pasara lo que pasara: se podia cruzar el
  pueblo leyendo lo que decia un aguador que habia quedado doscientos metros
  atras. Las dos formas de salir no son la misma cosa: `X` es "ya lo he leido" y
  da el paso de la mision por hecho, irse andando es "me voy" y lo deja
  pendiente. `X` tiene que contar, ademas, porque la narracion de llegar a un
  sitio se reabre sola mientras sigas dentro del radio, y cancelarla sin avanzar
  seria un bucle con la tecla sin efecto. No se usa `Esc` para esto: con el raton
  capturado, el navegador se lo queda para soltarlo y la pagina no llega a verlo.
- **Conversacion** (`dialogos.js` + `lugares.js`): se puede hablar con los 220,
  no solo con el objetivo de la mision. Cada vecino tiene frases de su oficio,
  saludo segun la hora y rumores; la eleccion es determinista por vecino, asi
  que el mismo herrero suena siempre igual, pero insistir da conversacion nueva.
  Con `Q` dan indicaciones reales -rumbo, distancia en pasos y el nombre
  autentico de la calle o del edificio, sacados de OSM-. Si el paso de la mision
  es llegar a un sitio, apuntan a ese sitio: era el unico paso que es andar y era
  el unico en el que preguntar el camino no servia de nada, que contestaba con el
  Monasterio y un sitio al azar teniendo el objetivo en pantalla. Si el paso es
  hablar con alguien, apuntan a esa persona -a ELLA, no al de su oficio que este
  mas cerca, que es otra- donde este AHORA.
- **La barra de abajo** (`ui.js`): los mandos vivian todos en una tecla que habia
  que haber leido en la portada y recordado, y la portada se borra del DOM 700 ms
  despues de entrar: a los dos minutos de partida no habia forma de saber que
  hacia la `Q`. La barra lleva la hora, el dia del ano, el tiempo que hace y un
  panel de ayuda que ya no se va, y cada mando ensena al lado su tecla en vez de
  sustituirla. Es DOM y no lienzo a proposito: deslizadores, foco y hover salen
  gratis ahi y habria que reinventarlos sobre un `<canvas>`. Para tocarla hay que
  soltar el raton con `Esc`, y mientras esta capturado la barra se apaga sola,
  que es mejor que dejar pulsar y que no pase nada.
- **Clima y estaciones** (`clima.js` + `daynight.js`): `dayOfYear` alimentaba la
  declinacion solar desde el principio pero estaba clavado en el 300, asi que
  toda esa cuenta astronomica servia para un solo dia de finales de octubre.
  Suelto, el sol sale y se pone donde toca: 26,0 grados a mediodia en el
  solsticio de invierno y 72,8 en el de verano, con dias de 9,1 h y 14,9 h.
  El clima es una **funcion pura** de (semilla, dia, hora) y no una clase con
  estado, porque `?hour=14&dia=20` tiene que dar un mundo correcto en el primer
  fotograma y un integrador con memoria se queda donde estuviera. Los pesos de
  cada estado no estan escritos a mano: se derivan de la serie de la estacion del
  Monasterio (1028 m, precipitacion desde 1946) que va en la cabecera del modulo.
  Sobre 60 anos simulados salen 102 dias de precipitacion (107 reales), 18
  nevadas (17,5), 19 tormentas (18,9), 58 dias de niebla (59,2) y 26 heladas
  (30,4). `make clima` lo comprueba sin navegador.
- **Estacion en el terreno, los tejados y los arboles** (`world.js` + `trees.js`):
  el color va horneado por vertice -mas de 400.000 en el terreno, y en los
  arboles tronco y copa en la misma geometria-, asi que rehornear al cambiar de
  estacion no es viable. Se hace con **un uniform compartido** dentro del
  `onBeforeCompile` que esos materiales ya tenian. Dos avisos que costaron un
  rato:
  1. La mezcla va DESPUES de `<color_fragment>`, no en `<map_fragment>`. En el
     fragmento de three el orden es uno y luego el otro, y `color_fragment` hace
     `diffuseColor *= vColor`: todo lo que habia escrito antes era multiplicativo
     y por eso le daba igual el orden, pero una MEZCLA puesta ahi se borra sola.
     Se veia exactamente como que el uniform no llegaba, y llegaba.
  2. Para separar hoja de tronco sin atributo nuevo se usa la **proporcion G/R**
     del color de vertice, que es invariante al tinte de luminosidad por
     instancia que ya existia: encina 1,48, pino 1,63, tronco 0,74. Es el mismo
     truco con el que `roofMaterial()` distingue la paja de la teja. De paso, las
     nueve mallas de arbol pasan de nueve materiales a uno.
  La nieve cuaja **por cota**: la linea baja segun cuanta hay, asi que con poca
  solo blanquea las cumbres y el pueblo, a 1030 m, sigue pardo, que es lo que
  pasa la mayoria de las veces que nieva aqui. Y la encina es **perennifolia**:
  no pierde la hoja, asi que aqui no hay otono de colores. Lo que amarillea es el
  pasto, de junio a septiembre, que es la senal de estacion de verdad del termino.
- **Lluvia y nieve** (`lluvia.js`): las gotas NO pasan por la CPU. Un cuadrado
  instanciado, una caja de 3000 que viaja con la camara **cuadrada a metros
  enteros** -sin ese redondeo el campo se desliza contigo y la lluvia se lee como
  quieta- y la caida calculada en el shader de vertices a partir del tiempo
  modulo la altura de la caja. Aqui no se copia el patron de `humo.js` a
  proposito: humo recalcula cada particula en la CPU, lo cual esta bien con 600 y
  es un disparate con 3000. La **nieve es el mismo sistema con otro uniform**, no
  un segundo sistema: cae quince veces mas despacio, vaga de lado con dos senos
  desfasados, es un disco blando y gira del todo hacia la camara. Cuatro `mix()`.
  Medido: 130 llamadas de dibujo pasan a 131, y una tormenta cuesta unos 2 ms.
  Tiene que ser `InstancedBufferGeometry`: colgar los atributos de un
  `PlaneGeometry` normal compila, enlaza, no da error y dibuja UNA gota.
- **Menos gente con mal tiempo** (`npcs.js`): no habia ni una condicion sobre la
  hora ni sobre el tiempo en 850 lineas. Ahora `w.calle` -fijo por vecino, para
  que se metan siempre los mismos y el reparto no parpadee- se compara con
  `vida.fuera`. De 220 en la calle se baja a 141 con lluvia y a 98 con tormenta.
  Va en **tres** sitios y el tercero es el que importa: hay que escribirlos
  hundidos y no solo saltarlos (`setInst` escribe en ranura fija, asi que uno
  saltado se queda plantado en la calle sin mover los pies), y `buscarOficio()`
  tiene que descartarlos tambien, o un dia de lluvia las indicaciones te mandan
  hacia alguien que esta cuatro metros bajo tierra.
- **Los 25 misterios** (`misterios.js`): leyenda y tradicion oral, que es lo
  contrario del modo saber y por eso van aparte: alli va lo documentado y con
  fuente, aqui lo que se cuenta. Trece son cosas -se examinan acercandose- y doce
  son personas, que lo sueltan al hablarles en vez de su charla de oficio. Se
  reparten por semilla pero ANCLADOS a sitios con nombre: a boleo por 3,6 km la
  mitad caeria en la dehesa y no los encontraria nadie.
  Dos cosas que costaron: cada misterio de persona tiene que atarse a un vecino
  DISTINTO -`buscarOficio` devuelve el mas cercano, y con dos misterios del mismo
  oficio salia el mismo vecino, asi que el segundo solo aparecia hablandole por
  segunda vez sin que nada lo indicara-; y el misterio se comprueba ANTES que el
  encargo, porque si no, cuando el vecino era ademas el objetivo del encargo -que
  pasa a menudo, los dos salen del mismo vecindario- la rama del encargo se lo
  comia. El test comprueba que las 25 pistas no digan el nombre de su propio
  misterio: una pista que se delata no es una pista.
- **Modo saber** (`historia.js`): opcional, se enciende en la barra. El juego pasa
  hacia 1570 y esa fecha es muy concreta: Juan Bautista de Toledo lleva tres anos
  muerto, Herrera anda en la obra pero no toma la direccion hasta 1572, el
  convento se cierra en 1571 y la basilica no ha empezado. De ahi salen **dos
  canales**, y son dos por una razon: un cantero de 1570 sabe de que cantera baja
  su piedra y quien es el obrero mayor, pero no sabe que la obra acabara en 1584
  ni dice "herreriano". Lo que ese oficio puede saber va en su voz; lo que nadie
  de 1570 puede decir va en **cartela**, fuera de la ficcion, con la fuente al pie.
  Todo dato con fecha, nombre o cifra lleva `fuente`, y el modulo lo comprueba al
  cargarse. Hacia falta: la fecha de la primera piedra aparece como 1562 en
  fuentes secundarias y la buena es el **23 de abril de 1563**.
  Una de las cartelas dice que **en 1570 el pueblo no existia**: aqui habia monte
  y pastos, y el caserio que dibuja el juego son los 3.545 edificios que OSM
  conoce del pueblo de HOY. Se dice en vez de dejar que parezca lo que no es.
- **Calles obstruidas** (`tools/prep.py` + `world.js` + `player.js`): habia calles
  sin salida, y no era que a OSM le faltara el dato: era que **este guion tiraba
  el dato**. Tres reglas, ninguna heuristica, todas leyendo lo que OSM ya dice:
  1. `tunnel=yes` / `tunnel=building_passage` (19 vias), `covered=yes` (2: la
     calle Capilla y la calle Grimaldi) y `bridge=yes` (10) se **descartaban
     enteras**, mientras el edificio de encima se seguia dibujando macizo. Al
     borrar la via, el hueco por el que se pasa de verdad se volvia un muro.
     Ahora se conservan marcadas con `t` y `world.enPaso()` las vacia de la
     colision.
  2. `layer > 0`, `building=roof` y `min_height >= 2` marcan lo que no arranca
     del suelo: 37 huellas que se siguen **dibujando** pero no frenan. Una de
     ellas -un `height=2, layer=1`, o sea una marquesina sobre la calle
     peatonal- cortaba **56 m de la calle Floridablanca**, que era el peor
     atasco del pueblo.
  3. Los ids de OSM de vias y edificios viajan hasta `world.json`. Son 60 KB y
     valen cada byte: cuando una calle sale mal se mira en OSM por su id en vez
     de describirla, que es como se ha encontrado todo esto.
  4. Y la que de verdad las abre todas, que es **geometrica y no de etiqueta**:
     si el eje de una calle cartografiada cae DENTRO de una huella, por ahi se
     pasa. Hizo falta porque las etiquetas no bastan: en OSM una calle viene
     partida en varias vias y la etiqueta la lleva UNA. La calle Capilla son
     tres tramos y solo el de en medio dice `covered=yes`; la Grimaldi igual; la
     avenida de Juan de Borbon son seis y solo uno dice `building_passage`. Se
     abria el trozo etiquetado y seguia tapiado lo de antes y lo de despues, que
     es el mismo soportal bajo el mismo edificio.
     A esta escala nadie dibuja una calle atravesando un edificio macizo por
     descuido: o hay soportal, o la huella esta dibujada por encima de la calle,
     y en los dos casos la calle es de verdad y el muro no. El precio son 55 de
     3411 huellas macizas con el centro pisable, y son justo las que tienen una
     calle por dentro.
     Y abrir la colision NO basta: hay que abrir tambien la GEOMETRIA, o el
     jugador cruza un muro macizo como un fantasma, que se lee peor que el muro.
     `extrudeRing()` acepta un `abrir(x, z)` que devuelve la cota del dintel:
     donde una calle cruza la fachada, el muro arranca ahi en vez de en la base y
     queda un soportal de 3,6 m de alto libre.
     Dos cosas que costaron una pasada cada una. El dintel **no** puede medirse
     desde `base`: la base de una huella es su vertice mas bajo, y en el
     Monasterio -205 x 162 m en cuesta- eso cae metros bajo tierra, asi que
     `base + 3,6` seguia siendo subterraneo y el hueco se abria donde no se ve.
     Sale del terreno EN ESE PUNTO. Y la muralla del Monasterio se malla aparte
     en `monastery()`, que llamaba a `extrudeRing` sin el `abrir`: era justo la
     que separa la lonja de los jardincillos.
     La regla abre de mas en UN caso, y ese va cerrado a mano en `CERRADOS`
     (prep.py): un vial de servicio que muere dentro de una nave industrial. Sus
     dos extremos no enlazan con nada, asi que no lleva a ninguna parte y poder
     entrar no arregla ningun recorrido. Se cierra el caso en vez de debilitar la
     regla por el.

  Cuidado con la exencion del punto 2: las huellas siguen en el indice de
  fachadas y solo se saltan al CHOCAR. Sacarlas del indice dejo sus propios
  tejados volando sobre nada y tumbo la prueba de cubiertas colgadas de `?test`,
  con 26 m de vuelo en la peor sonda.

- **Patios de manzana** (`tools/prep.py` + `world.js`): `rings()` decia en su
  propio docstring *"los agujeros se ignoran (v1)"*, y eso rellenaba macizos los
  **97 edificios con patio** del pueblo -307 patios en total: el Monasterio con
  16, la Casa de la Reina, la Tercera Casa de Oficios, el Ayuntamiento, la Plaza
  de Toros-. No era solo feo desde arriba: las cuatro sendas empedradas que
  cruzan el patio de la Casa de la Compaña estaban tapiadas.
  Los anillos `inner` viajan ahora hasta el juego en `q`. A la cubierta NO se le
  meten agujeros a `gableRoof`: esa lleva dentro demasiada logica ganada a golpes
  -faldones colgados, plantas en L, chaflanes, la rejilla de sondeo en metros- y
  abrirle un hueco es la manera de perderla toda. Los edificios con patio llevan
  `patioRoof()`, aparte: dos faldones que suben desde los aleros de fuera y del
  patio, y una banda plana donde se encuentran, reusando `insetRing()` y el
  triangulador de three, que **ya acepta agujeros** (el Monasterio le pasaba una
  lista vacia desde el principio).
  Cuidado con el rol de los miembros de una relacion: solo `outer` y el vacio son
  contorno. Meter tambien `part` -los 170 `building:part`, que son detalle 3D del
  mismo edificio- subia el pueblo de 3545 casas a 3716 sin que hubiera ni una mas.

  De **15 vias cortadas se paso a CERO**, y el grafo de calles de 18 trozos
  sueltos y 172 nodos aislados a 9 y 72.

  El indice de fachadas subio de `player.js` a `world.js` al haber dos clientes,
  y `player.js` se quedo en 123 lineas de las 169 que tenia.
- **Costura del grafo de calles** (`npcs.js`): el grafo suelda nodos a 4 m y en
  OSM hay finales de calle que se quedan a cinco o a ocho de la siguiente. Eso
  dejaba trozos aislados donde un vecino entraba y no salia, y donde
  `buscarOficio()` podia mandarte a hablar con alguien que no llega nunca. Se
  cosen solo los huecos de menos de 11 m **y solo si entre los dos puntos no hay
  fachada**: coser de mas seria abrir un atajo a traves de una casa, que es peor
  que dejar el trozo suelto. Recuperar los pasos reconecto 81 nodos y la costura
  otros 19: de 18 trozos sueltos y 172 nodos aislados se paso a 9 y 72.
  El test de la fachada tiene que ser el poligono de verdad y NO la rejilla de
  ocupacion: esa marca celdas de 10 m, y como las calles van pegadas a las casas
  daba por tapadas 2793 de las 7465 aristas que ya existian.
- **El hombre de negro** (`npcs.js` + `dialogos.js`): de **medianoche a las dos**
  pasea por la lonja un hombre vestido de negro con gorguera blanca y sombrero,
  con un perro negro detras. No da encargos ni los recibe, no dice quien es y
  contesta con acertijos; el perro grune y ladra. Es la leyenda del perro negro
  de El Escorial, que segun se cuenta aullaba de noche entre los andamios de la
  obra y aterrorizaba a los peones: el padre Villacastin y otros tres monjes lo
  atraparon la noche del 21 de junio de **1577** -siete anos despues de cuando
  pasa esto- y resulto ser el sabueso perdido del marques de las Navas.
  Reusa el cuerpo del vecino como **una instancia mas** de las mismas mallas, con
  sus colores; la gorguera va aparte porque ninguna pieza del vecino sirve de
  cuello, y el perro necesito color por instancia, que los 30 del pueblo no lo
  tenian y eran el mismo perro. La lonja no se escribe a mano: sale de la huella
  mas grande, 40 m a poniente de su cara oeste, y da **exactamente** el punto de
  aparicion del jugador que se habia elegido a ojo.
- **Gatos y vacas** (`npcs.js`): 34 gatos por el grafo de calles, como los
  perros pero parandose seis veces mas -un gato cruza la calle y se sienta- y con
  el rabo tieso, que es lo que hace que cuatro cajas se lean como gato y no como
  perro chico. 26 vacas en el campo: para sembrarlas se exige que un anillo de
  ocho sondas a 35 m este TODO despejado, que es lo que las saca del casco sin
  buscar prados en los datos. Salen a 95 m de la fachada mas cercana, y la
  mediana a mas de 120.
  No vale `chocaEdificio(x, z, 35)` para eso: solo mira las nueve celdas de diez
  metros de alrededor y se le escapa lo que hay a treinta y cinco.
  El cuerpo de la vaca va en prisma tumbado y no en caja, que es la misma leccion
  que ya esta escrita para los vecinos y para los arboles: lo que hace que un
  bicho parezca de Minecraft son las normales duras de `BoxGeometry`. En un perro
  de medio metro se perdona; en una vaca de metro y medio, no.
- **Humo** (`humo.js`): las 1302 chimeneas tiran de noche, y tambien cuando hace
  frio: en enero se enciende a mediodia. Carteles orientados a camara en el
  shader de vertices, recortados a las 120 chimeneas mas cercanas.

## Los vecinos

Cuerpo procedural instanciado: 10 InstancedMesh (cabeza, pelo, torso, dos
brazos, dos piernas, capa, sombrero, apero), 220 instancias cada una, ~230
triangulos por vecino y 50.600 en total.

Lo que los hacia parecer de Minecraft no eran las proporciones -ya estaban en
6,5 cabezas- ni el numero de triangulos: eran las normales duras de
`BoxGeometry`, que dan tres escalones planos de luz por miembro, y la seccion
constante. `CylinderGeometry` trae las normales promediadas de serie, asi que
bastaba con dejar de usar cajas. Es la misma leccion que `trees.js`.

Se descarto meter modelos rigged: a 540 lineas un vecino mide 30-70 px, un
personaje de 13.000 triangulos serian ~190 triangulos por pixel visible, y
`InstancedMesh` no sabe hacer skinning -220 personajes con esqueleto son ~660
llamadas de dibujo entre color y las dos pasadas de sombra, contra 10-.

## Limitaciones conocidas

- Una sola cascada de sombra, 200 m alrededor del jugador. A lo lejos hay luz
  pero no sombra proyectada.
- Sin SSAO: cuesta un pase entero y a esta resolucion no se echa de menos.
- Las ovejas y las gallinas no mueven las patas, solo el cuerpo y la cabeza.
- La luna repinta su mapa de sombra tambien a mediodia, con intensidad cero.
  Esta anotado en `daynight.js` con el arreglo, pendiente de comprobar en
  pantalla: su modo de fallo es el pueblo entero a oscuras.
