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
| `npcs.js` | vecinos, perros, ovejas, gallinas y pajaros |
| `quests.js` | el hilo del encargo en curso y el pergamino de dialogo |
| `tramas.js` | generador de encargos: formas, temas y huecos |
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
| `?x=&z=&yaw=` | punto de aparicion |
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
- **Encargos** (`tramas.js` + `quests.js`): procedurales. Un encargo es una
  FORMA (cuatro arcos de tres o cuatro pasos: quien te manda, a donde vas, quien
  recibe el recado) mas un TEMA (ocho: los lobos de la dehesa, el agua de la
  argamasa, la campana rajada de San Bernabe, el pliego de Su Majestad...) con
  los huecos rellenados con los oficios que estan VIVOS y con los 28 sitios de
  epoca de OSM. Se generan tres seguidos al arrancar, a partir de una semilla que
  se ve en la portada: `?seed=1234` devuelve los mismos, que es lo unico que hace
  depurable un generador. Los destinos se filtran por nombre -OSM nombra el
  pueblo de hoy, y un vecino de 1570 no manda a nadie al Ahorramas- y salen a mas
  de 180 m del punto de aparicion, o se darian por alcanzados antes de que te los
  encarguen. `make tramas` prueba 300 semillas sin navegador.
- **Conversacion** (`dialogos.js` + `lugares.js`): se puede hablar con los 220,
  no solo con el objetivo de la mision. Cada vecino tiene frases de su oficio,
  saludo segun la hora y rumores; la eleccion es determinista por vecino, asi
  que el mismo herrero suena siempre igual, pero insistir da conversacion nueva.
  Con `Q` dan indicaciones reales -rumbo, distancia en pasos y el nombre
  autentico de la calle o del edificio, sacados de OSM-, y si hay mision viva
  apuntan al vecino del oficio que buscas, donde este AHORA.
- **Humo** (`humo.js`): las 1302 chimeneas tiran de noche. Carteles orientados a
  camara en el shader de vertices, recortados a las 120 chimeneas mas cercanas.

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
