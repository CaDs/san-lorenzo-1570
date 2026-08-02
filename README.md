# San Lorenzo

Un paseo por San Lorenzo de El Escorial hacia 1570, cuando el Monasterio estaba
en obras. El pueblo no es inventado: el terreno sale del modelo digital del IGN y
las casas y las calles de OpenStreetMap, con sus trazados y sus nombres reales.
Encima de esa base se levanta un caserío medieval procedural.

## Jugar

**[cads.github.io/san-lorenzo-1570](https://cads.github.io/san-lorenzo-1570/)**

Corre en el navegador y no hay que instalar ni compilar nada. Para trastear con
el codigo, en local:

```
make dev        # http://localhost:8000/web/
```

## Teclas

| | |
|---|---|
| `WASD` | andar · `Mayus` correr · `espacio` saltar |
| ratón | mirar · `Esc` soltar el puntero |
| `E` | hablar con quien tengas al lado · seguir la conversacion |
| `Q` | preguntarle el camino |
| `X` | dejar la conversacion (o alejarse andando, que la corta igual) |
| `[` `]` | mover el sol · `P` parar el reloj |
| barra | hora, día del año y tiempo que hace (suelta el ratón con `Esc`) |
| `V` | vuelo libre, para ver el pueblo desde arriba |
| | en vuelo: `W` `S` avanzar · `A` ladear · `E` subir · `D` bajar |

## Qué hay

- **El pueblo real**: 3545 edificios y 162 km de viario sobre un terreno de
  3,6 × 2,1 km muestreado cada 5 m, entre los 881 y los 1334 m de altitud.
- **El Monasterio** sobre su huella verdadera, con la parrilla de patios, las
  ventanas en retícula, los chapiteles, el cimborrio y la linternilla.
- **Ciclo de día y noche** con la posición solar real para la latitud del pueblo
  (40,59° N) y el día del año, cielo procedural, estrellas y luna. El día del año
  corre, así que el sol de enero es el de enero: 26° a mediodía y nueve horas de
  luz, contra los 73° y las quince de junio.
- **El tiempo que hace**, sorteado con los datos reales de la estación del
  Monasterio: despejado, nubes, cubierto, niebla, lluvia, tormenta y nieve, con
  las probabilidades de cada mes. Se puede fijar a mano desde la barra o con
  `?clima=niebla`, y la época con `?dia=15`.
- **460 vecinos** de ocho oficios recorriendo las calles, con perros, gatos,
  ovejas, gallinas y pájaros; y vacas paciendo en los campos, lejos del casco.
  Más 16 pastores en el monte, que no bajan al pueblo. Se puede hablar con todos.
- **Encargos procedurales y sin fin**: se pide uno nuevo cada vez que se cierra
  el anterior, armados con los oficios que andan por la calle y los sitios con
  nombre real de OSM —los lobos de la dehesa, el agua de la argamasa, la campana
  rajada de San Bernabé—. Quien te lo encarga es quien te lo cierra: los vecinos
  tienen nombre y el pueblo tiene veintisiete canteros. La semilla se ve en la
  portada y se repite con `?seed=`.
- **Y encargos que solo salen cuando toca**: la nieve que corta el camino de los
  carros de piedra, la helada que revienta la cal recién puesta, la siega de
  agosto, la riada que se lleva el vado, la leña antes del invierno. En enero no
  se juega a lo mismo que en agosto.
- **Modo saber**, opcional: los vecinos cuentan lo que su oficio puede saber
  estando allí en 1570, y en los sitios saltan cartelas con el dato histórico y
  **su fuente al pie**. Incluida la que avisa de que en 1570 el pueblo no
  existía: aquí había monte y pastos, y el caserío que ves es el de hoy.
- **Un hombre de negro** pasea la lonja de medianoche a las dos, con un perro
  negro detrás. No da encargos y contesta con acertijos: es la leyenda del perro
  negro de El Escorial, el que aullaba entre los andamios.
- **La sierra alrededor**: 14 × 12 km de relieve del IGN, de Abantos (1753 m) por
  el norte a la Silla de Felipe II por el sur, con 700 km de sendas y pistas
  reales de OSM. Se puede subir andando.
- **Siete especies de árbol** repartidas por cota y por solana: fresneda en las
  vaguadas de La Herrería, melojar en la ladera, encinar con enebro en las
  solanas secas, piornal por encima de los 1700 m. Y **dos montes**, con un
  interruptor en la barra: el melojar de 1570 y el pinar de hoy, que es una
  repoblación de 1892-1914 y por tanto no estaba.
- **Sonido**, todo sintetizado y sin un solo fichero de audio: viento, lluvia,
  agua en la teja, ventisca, bullicio, grillos y chicharras, con la mezcla atada
  a dónde estás, qué hora es y qué tiempo hace. Los animales suenan solo si
  están cerca de verdad, y la campana del Monasterio da las ocho horas del
  oficio, que son **horas temporales**: tercia cae a las 8:16 en junio y a las
  9:44 en diciembre.
- **26 misterios** escondidos por el término, unos objetos y otros personas. Los
  que tienen sitio de verdad están en su sitio de verdad.
- Antorchas, humo de chimenea, y un minimapa en pergamino.

Todo se genera de forma determinista: el pueblo sale igual en cada arranque, y
el tiempo y los encargos igual con la misma semilla. Con un matiz honesto: desde
que hay encargos de temporada, cuál te toca depende también de en qué época lo
pidas, así que la promesa exacta es **misma semilla y misma época, mismo
encargo**.

## Cómo está hecho

Three.js, vendorizado en `web/vendor/`. Sin bundler, sin `npm install`, sin paso
de compilación: son ficheros sueltos que sirve cualquier servidor estático. El
detalle de cada módulo está en [`web/README.md`](web/README.md).

El lienzo se dibuja a ~540 líneas con un factor de escala **entero** y se estira
al tamaño de la ventana, que es lo que mantiene el píxel cuadrado en vez de
convertirlo en una imagen borrosa.

## Regenerar los datos

`data/build/` ya viene en el repositorio, así que para jugar no hace falta. Para
cambiar de pueblo o de encuadre, edita `tools/bbox.sh` y:

```
make data       # descarga IGN + Overpass y reconstruye data/build/
```

Necesita `curl` y los ejecutables de GDAL (`ogr2ogr`, `gdal_translate`,
`gdalinfo`, `gdallocationinfo`). No hay dependencias de Python.

## Comprobación

```
make test       # abre web/?test: el jugador anda, no se hunde y las fachadas frenan
make tramas     # 300 semillas y 500 encargos seguidos: ningun objetivo imposible
make clima      # 60 años de tiempo: se parece al de la sierra de verdad
make sonido     # que la campana toque ocho veces y ninguna ganancia salga NaN
make casas      # las 3.545 casas: ninguna enterrada, ningun muro en el aire
```

Los cuatro de node corren sin navegador y en un par de segundos, que es lo que
hace que se corran. `make casas` en particular existe porque los fallos de
geometría —una casa enterrada, una fachada sin planta baja— eran medibles y se
medían a mano *después* de verlos en una captura.

## Licencia y procedencia de los datos

El código va bajo [MIT](LICENSE). **Los datos tienen sus propias condiciones y
exigen atribución**: ver [ATTRIBUTION.md](ATTRIBUTION.md).
