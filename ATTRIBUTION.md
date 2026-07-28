# Procedencia y licencias de los datos

El código de este repositorio es MIT (ver `LICENSE`), pero **los datos que lo
alimentan no son míos y no son MIT**. Esto no es cortesía: son condiciones de uso
que hay que respetar y mantener si se redistribuye el proyecto.

## Edificios y viario — OpenStreetMap

`data/build/world.json` contiene las huellas de 3545 edificios, 1743 tramos de
calle y sus nombres, derivados de OpenStreetMap mediante la API de Overpass
(ver `tools/fetch.sh`).

> © Colaboradores de OpenStreetMap

Licencia: **Open Database License (ODbL) 1.0** — https://opendatacommons.org/licenses/odbl/

Conviene entender qué implica, porque no es una licencia permisiva al uso:

- `world.json` es una **base de datos derivada** de OSM. La cláusula de
  compartir-igual de la ODbL le alcanza: si se distribuye una versión modificada
  de esos datos, hay que hacerlo bajo ODbL.
- La atribución debe ser visible para quien use el resultado, no sólo estar
  enterrada en un repositorio.

## Modelo digital del terreno — IGN / CNIG

`data/build/terrain.bin` es un mapa de alturas float32 derivado del MDT de 5 m
del Instituto Geográfico Nacional, servido por el CNIG vía WCS INSPIRE
(`servicios.idee.es`, capa `Elevacion25830_5`).

> © Instituto Geográfico Nacional de España

Licencia: **CC BY 4.0**, conforme a las condiciones de uso del CNIG —
https://www.ign.es/web/ign/portal/qsm-cnig

## three.js

`web/vendor/three/` es una copia sin modificar de three.js r185.

> Copyright © 2010-2025 three.js authors — licencia MIT

https://github.com/mrdoob/three.js/blob/dev/LICENSE

## Lo que NO viene de fuera

Todo lo demás —el caserío medieval, el Monasterio, los árboles, los vecinos, los
diálogos, el ciclo de día y noche— se genera por procedimiento a partir de esas
tres fuentes. No hay modelos, texturas ni audio de terceros en el repositorio.
