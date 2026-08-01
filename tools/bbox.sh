# Ring A - casco urbano de San Lorenzo de El Escorial. EPSG:25830 (UTM 30N, metros).
# Origen del mundo = esquina SW. X = Este-X0, Z = Norte maximo - Norte.
export X0=401500 X1=405100 Y0=4493000 Y1=4495100
export LAT0=40.582 LON0=-4.163 LAT1=40.601 LON1=-4.122
export DEM_RES=5      # m/px  -> 720 x 420
export UA="san-lorenzo/1.0 (+https://github.com/amra/san-lorenzo)"

# Ring B - la sierra de alrededor. Solo relieve: ni casas ni calles, que a dos
# kilometros no se distinguen y a cambio multiplican por diez lo que hay que
# cargar. Llega a Abantos por el norte (1753 m, la cima que se ve desde todo el
# pueblo) y baja al sur hasta la Silla de Felipe II, que es de donde miraba el
# Rey la obra y estaba fuera del recorte por 1,5 km.
#
# Los cuatro bordes son multiplos de 50 Y ademas dejan los del Ring A justo
# encima de una linea de la rejilla: (401500-396000)/50 = 110 clavado, y lo mismo
# los otros tres. Eso hace que el hueco del casco urbano se recorte SIN resto y
# el terreno fino y el grueso se toquen vertice con vertice.
export SX0=396000 SX1=410100 SY0=4488000 SY1=4500100
export SIERRA_RES=25   # m/px -> 564 x 484
export SLAT0=40.5362 SLON0=-4.2280 SLAT1=40.6469 SLON1=-4.0633
