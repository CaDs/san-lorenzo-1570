# San Lorenzo

Un paseo por San Lorenzo de El Escorial hacia 1570, cuando el Monasterio estaba
en obras. El pueblo no es inventado: el terreno sale del modelo digital del IGN y
las casas y las calles de OpenStreetMap, con sus trazados y sus nombres reales.
Encima de esa base se levanta un caserío medieval procedural.

Corre en el navegador. No hay que compilar nada.

```
make dev        # http://localhost:8000/web/
```

## Teclas

| | |
|---|---|
| `WASD` | andar · `Mayus` correr |
| ratón | mirar · `Esc` soltar el puntero |
| `E` | hablar con quien tengas al lado |
| `Q` | preguntarle el camino |
| `[` `]` | mover el sol · `P` parar el reloj |
| `V` | vuelo libre, para ver el pueblo desde arriba |

## Qué hay

- **El pueblo real**: 3545 edificios y 162 km de viario sobre un terreno de
  3,6 × 2,1 km muestreado cada 5 m, entre los 881 y los 1334 m de altitud.
- **El Monasterio** sobre su huella verdadera, con la parrilla de patios, las
  ventanas en retícula, los chapiteles, el cimborrio y la linternilla.
- **Ciclo de día y noche** con la posición solar real para la latitud del pueblo
  (40,59° N) y el día del año, cielo procedural, estrellas y luna.
- **220 vecinos** de ocho oficios recorriendo las calles, con perros, ovejas,
  gallinas y pájaros. Se puede hablar con todos.
- **Encargos** anclados al sitio: la cantera de la Herrería, el aguador y el
  camino real a Madrid, las obras del Monasterio, los lobos de la dehesa.
- Antorchas, humo de chimenea, y un minimapa en pergamino.

Todo se genera de forma determinista: el pueblo sale igual en cada arranque.

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
```

## Licencia y procedencia de los datos

El código va bajo [MIT](LICENSE). **Los datos tienen sus propias condiciones y
exigen atribución**: ver [ATTRIBUTION.md](ATTRIBUTION.md).
