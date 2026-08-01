#!/usr/bin/env python3
"""Convierte los datos crudos del IGN/OSM a algo que el navegador lee directo.

Salidas en data/build/:
  terrain.bin   - heightmap float32 plano, filas N->S, sin cabecera
  world.json    - metadatos, edificios y viario en coordenadas locales (metros),
                  con el nombre de OSM cuando lo hay

Sin dependencias de python: todo el trabajo geoespacial lo hacen los CLI de GDAL.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, BUILD = f"{ROOT}/data/raw", f"{ROOT}/data/build"

# Se leen de tools/bbox.sh para no duplicar la definicion del area.
def load_bbox():
    src = open(f"{ROOT}/tools/bbox.sh").read()
    g = {k: int(v) for k, v in re.findall(r"^export (X0|X1|Y0|Y1|DEM_RES)=(\d+)", src, re.M)}
    for line in src.splitlines():
        m = re.match(r"export X0=(\d+) X1=(\d+) Y0=(\d+) Y1=(\d+)", line)
        if m:
            g.update(zip(("X0", "X1", "Y0", "Y1"), map(int, m.groups())))
    m = re.search(r"export SX0=(\d+) SX1=(\d+) SY0=(\d+) SY1=(\d+)", src)
    g.update(zip(("SX0", "SX1", "SY0", "SY1"), map(int, m.groups())))
    m = re.search(r"export LAT0=([-\d.]+) LON0=([-\d.]+) LAT1=([-\d.]+) LON1=([-\d.]+)", src)
    g.update(zip(("LAT0", "LON0", "LAT1", "LON1"), map(float, m.groups())))
    return g

B = load_bbox()
X0, X1, Y0, Y1 = B["X0"], B["X1"], B["Y0"], B["Y1"]
SX0, SX1, SY0, SY1 = B["SX0"], B["SX1"], B["SY0"], B["SY1"]

def sh(cmd, **kw):
    r = subprocess.run(cmd, text=True, capture_output=True, **kw)
    if r.returncode:
        sys.exit(f"fallo: {' '.join(cmd[:2])}\n{r.stderr.strip()[:800]}")
    return r.stdout

# ---------------------------------------------------------------- altura
FLOOR_M = 3.0                      # altura tipica de planta
FALLBACK = {"garage": 2.5, "shed": 2.5, "hut": 2.5, "carport": 2.5,
            "house": 6.0, "detached": 6.0, "bungalow": 4.0, "terrace": 7.0,
            "apartments": 12.0, "church": 15.0, "public": 10.0}

def height_of(tags):
    lv = tags.get("building:levels")
    plantas = None
    if lv:
        m = re.match(r"\s*([\d.]+)", lv)
        # `building:levels=0` tampoco es un dato: es la casilla puesta a cero.
        # El Ayuntamiento de San Lorenzo lo trae asi, y con height=0 ademas, de
        # modo que se quedaba plano contra el suelo por partida doble.
        if m and float(m.group(1)) >= 1:
            plantas = float(m.group(1)) * FLOOR_M

    h = tags.get("height")
    if h:
        m = re.match(r"\s*([\d.]+)", h)          # "12", "12 m", "12.5m"
        if m:
            v = float(m.group(1))
            # Un `height` por debajo de metro y medio en un edificio que ADEMAS
            # declara plantas no es una altura: es la casilla sin rellenar. En
            # este pueblo hay 38 asi, y el guion se las creia: la Iglesia de San
            # Bernabe -tres plantas segun OSM, y la de la campana rajada del
            # encargo- se dibujaba de UN CENTIMETRO, igual que San Lorenzo
            # Martir, el Centro Cultural y un bloque de seis alturas.
            #
            # Por debajo de MEDIO metro no se respeta ni aunque no haya plantas:
            # un cero no es una altura en ningun caso. Con eso salen tambien el
            # Ayuntamiento, la Plaza de Toros y la Casa de los Doctores, que
            # traen height=0 a secas y estaban igual de aplastados.
            #
            # Entre medio metro y metro y medio sin plantas SI se respeta: hay
            # dos huellas de 0,75 y 1,0 m que son de verdad lo que dicen -un
            # pretil y una tapia- y subirlas a la altura por defecto seria
            # plantar un edificio de ocho metros donde hay un murete.
            if v >= 1.5 or (plantas is None and v >= 0.5):
                return v
    if plantas is not None:
        return plantas
    return FALLBACK.get(tags.get("building"), 8.0)

# ------------------------------------------------- osm -> geojson -> utm
def sin_choque(tags):
    """1 si la huella NO debe frenar a nadie a ras de suelo.

    Se sigue dibujando: lo que cambia es la colision. Son cosas que en OSM estan
    marcadas como que no arrancan del suelo y que aqui, al aplastarlo todo a
    cota cero, se convertian en muros:

      layer > 0        Estructuras por ENCIMA de la calle. La que cortaba 56 m
                       de la calle Floridablanca -la peor de todas- es un
                       way con height=2 y layer=1: una marquesina sobre la calle
                       peatonal, no un edificio en medio.
      building=roof    Un techo sobre pies. Por definicion se pasa por debajo.
      min_height >= 2  Lo mismo dicho con numeros: la fabrica empieza a esa
                       altura y debajo no hay nada.

    Son 33 de 3545. No es una heuristica: es leer lo que OSM ya dice y que este
    guion tiraba.
    """
    try:
        if int(float(tags.get("layer", 0))) > 0:
            return 1
    except ValueError:
        pass
    if tags.get("building") == "roof":
        return 1
    try:
        if float(tags.get("min_height", 0)) >= 2.0:
            return 1
    except ValueError:
        pass
    return 0


# Vias que NO abren paso aunque la geometria diga que si.
#
# La regla que de verdad destapo las calles del entorno de la lonja es geometrica
# y esta en world.js: si el eje de una calle cae dentro de una huella, por ahi se
# pasa. Es la buena, y por eso no se toca. Pero abre de mas en un caso concreto y
# conocido, y para eso esta esta lista: para cerrarlo a mano en vez de debilitar
# la regla por un caso.
# `c` gana SIEMPRE, tanto sobre la regla geometrica como sobre la etiqueta de
# OSM. Antes solo callaba a la primera, y por eso una via con tunnel=yes seguia
# abriendo el muro aunque estuviera en esta lista.
CERRADOS = {
    # Vial de servicio que MUERE dentro de una nave industrial: sus dos extremos
    # no enlazan con otras vias, asi que no lleva a ninguna parte. Un almacen no
    # es una calle, y poder entrar en el no arregla ningun recorrido.
    206563461,
    # La PUERTA PRINCIPAL del Monasterio, con tunnel=building_passage. Y OSM
    # tiene razon: es un paso de verdad por debajo de un edificio, con su nodo de
    # entrada etiquetado como tal, y son dieciseis metros de arco a traves de un
    # muro de varios metros de grueso.
    #
    # Se cierra porque el Monasterio NO TIENE INTERIOR en este juego. Abrir esa
    # puerta no lleva a un patio ni a un zaguan: lleva al vacio de dentro de la
    # caja, y desde la lonja se veia un agujero negro en mitad de la fachada. El
    # dia que haya interior, esta linea se borra y la puerta vuelve sola.
    889493543,
}

# Y lo contrario: vias que SI son paso aunque no lo diga ni la etiqueta ni la
# geometria. Van por id de OSM y no por coordenada, que las coordenadas se mueven
# al cambiar el encuadre.
#
# El criterio para entrar aqui es doble y hay que cumplir los dos: que la via sea
# DE PASO -sus dos extremos enlazan con otras vias- y que ni OSM ni la geometria
# den ninguna otra explicacion.
#
# Si alguna vez se arreglan en OSM, estas lineas sobran y se borran.
PASOS_A_MANO = {
    # Senda que cruza un `building=yes` de 0,75 m de alto. El pretil es real y
    # por eso se respeta su altura (ver height_of), pero la senda tambien lo es y
    # esta cartografiada atravesandolo: OSM se contradice consigo mismo y aqui
    # gana la senda, que es la que lleva a alguna parte.
    1201512394,
    # Vial de servicio entre dos bloques de pisos, con cero hueco libre: es el
    # portalon que da al patio de manzana. En OSM la via esta y el arco no.
    29279219,
    # Calle Floridablanca. Es peatonal y de paso, y le quedan tres metros
    # comidos por la esquina de una huella.
    29329563,
}


def rings(el):
    """[(exterior, [agujeros...]), ...] en [(lon,lat),...].

    Los agujeros SE USAN. Antes se tiraban -"(v1)", decia el comentario- y eso
    rellenaba macizos los 98 edificios con patio del pueblo: el Monasterio con
    sus 16 patios, la Casa de la Reina, la Tercera Casa de Oficios, el
    Ayuntamiento y hasta la Plaza de Toros. No era solo feo desde arriba: las
    sendas que cruzan el patio de la Casa de la Compaña quedaban tapiadas, y esas
    cinco eran la mitad de las calles cortadas que quedaban en el pueblo.
    """
    if el["type"] == "way":
        g = el.get("geometry")
        return [([(p["lon"], p["lat"]) for p in g], [])] if g else []
    # Solo `outer` y el rol vacio son contorno. Los otros dos roles que aparecen
    # aqui NO son edificios: `part` son los 170 building:part -detalle 3D de un
    # mismo edificio, que como poligono suelto duplicaria la geometria- y
    # `outline` son 2 contornos de una relacion que ya viene por otro lado.
    # Meterlos subia el pueblo de 3545 casas a 3716 sin que hubiera ni una mas.
    fuera, dentro = [], []
    for mem in el.get("members", []):
        if not mem.get("geometry"):
            continue
        rol = mem.get("role", "")
        if rol == "inner":
            dentro.append([(p["lon"], p["lat"]) for p in mem["geometry"]])
        elif rol in ("outer", ""):
            fuera.append([(p["lon"], p["lat"]) for p in mem["geometry"]])
    if not fuera:
        return []
    # Con varios exteriores se le dan los agujeros al primero y los demas van
    # sueltos: una relacion con dos cuerpos y un patio en cada uno es rarisima, y
    # repartirlos por contencion costaria mas que lo que arregla.
    return [(fuera[0], dentro)] + [(f, []) for f in fuera[1:]]

print("1/5 leyendo OSM ...", flush=True)
osm = json.load(open(f"{RAW}/buildings.json"))
feats = []
for el in osm["elements"]:
    tags = el.get("tags", {})
    for r, agujeros in rings(el):
        if len(r) < 4:
            continue
        if r[0] != r[-1]:
            r.append(r[0])
        huecos = []
        for a in agujeros:
            if len(a) < 4:
                continue
            if a[0] != a[-1]:
                a.append(a[0])
            huecos.append(a)
        # El nombre viaja hasta world.json: OSM sabe como se llaman la Iglesia
        # de San Bernabe, el Ayuntamiento o el Real Coliseo, y sin eso los
        # vecinos del juego solo pueden decir "hacia el nordeste" en vez de
        # mandarte a un sitio con nombre.
        feats.append({"type": "Feature",
                      "properties": {"h": height_of(tags),
                                     "n": tags.get("name", ""),
                                     "i": el.get("id", 0),
                                     "x": sin_choque(tags),
                                     "a": tags.get("amenity", "")},
                      "geometry": {"type": "Polygon",
                                   "coordinates": [r] + huecos}})
print(f"    {len(feats)} poligonos")

os.makedirs(BUILD, exist_ok=True)
tmp4326, tmp25830 = f"{BUILD}/_b4326.geojson", f"{BUILD}/_b25830.geojson"
json.dump({"type": "FeatureCollection", "features": feats}, open(tmp4326, "w"))

print("2/5 reproyectando a EPSG:25830 ...", flush=True)
if os.path.exists(tmp25830):
    os.remove(tmp25830)
sh(["ogr2ogr", "-f", "GeoJSON", "-s_srs", "EPSG:4326", "-t_srs", "EPSG:25830", tmp25830, tmp4326])
utm = json.load(open(tmp25830))

# ------------------------------------------------------- cota del suelo
# Un edificio en cuesta se hunde o flota si se apoya en un solo punto: se
# extruye desde el vertice mas bajo del contorno hasta el mas alto + altura.
print("3/5 muestreando el DEM en cada vertice ...", flush=True)

# El bbox pedido a Overpass es lat/lon; reproyectado a UTM no da el mismo
# rectangulo, asi que parte de los edificios cae fuera del raster.
def clamp(x, y, e=3.0):
    return min(max(x, X0 + e), X1 - e), min(max(y, Y0 + e), Y1 - e)

polys, pts, fuera = [], [], 0
for f in utm["features"]:
    ring = f["geometry"]["coordinates"][0]
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    if not (X0 <= cx <= X1 and Y0 <= cy <= Y1):
        fuera += 1
        continue
    idx = (len(pts), len(pts) + len(ring))
    pts.extend(clamp(x, y) for x, y in ring)
    polys.append({"h": f["properties"]["h"], "ring": ring, "idx": idx,
                  "holes": f["geometry"]["coordinates"][1:],
                  "n": f["properties"].get("n", ""),
                  "i": f["properties"].get("i", 0),
                  "x": f["properties"].get("x", 0),
                  "a": f["properties"].get("a", "")})
print(f"    {fuera} fuera del area, {len(polys)} dentro")

stdin = "\n".join(f"{x} {y}" for x, y in pts)
raw = sh(["gdallocationinfo", "-geoloc", "-valonly", f"{RAW}/dem.tif"], input=stdin)
vals = [float(v) if v.strip() else 0.0 for v in raw.splitlines()]
assert len(vals) == len(pts), f"DEM devolvio {len(vals)} valores para {len(pts)} puntos"

# ------------------------------------------------------------- heightmap
# EHdr = raster crudo sin cabecera embebida: float32 plano, orden de filas
# N->S. El navegador lo lee tal cual como Float32Array, sin perder precision
# (un PNG de 16 bits lo degradaria a escalones visibles en 453 m de rango).
print("4/5 generando heightmap float32 ...", flush=True)
info = json.loads(sh(["gdalinfo", "-json", "-stats", f"{RAW}/dem.tif"]))
band = info["bands"][0]
hmin, hmax = float(band["minimum"]), float(band["maximum"])
dem_w, dem_h = info["size"]
sh(["gdal_translate", "-q", "-ot", "Float32", "-of", "EHdr",
    f"{RAW}/dem.tif", f"{BUILD}/terrain.bil"])
os.replace(f"{BUILD}/terrain.bil", f"{BUILD}/terrain.bin")
for junk in ("terrain.hdr", "terrain.bil.aux.xml", "terrain.prj", "terrain.stx"):
    if os.path.exists(f"{BUILD}/{junk}"):
        os.remove(f"{BUILD}/{junk}")
assert os.path.getsize(f"{BUILD}/terrain.bin") == dem_w * dem_h * 4

# ---------------------------------------------------------------- la sierra
# El mismo tratamiento para el relieve de alrededor, a 25 m en vez de 5. Solo
# cota: ni casas ni calles, que a dos kilometros no se ven y a cambio
# multiplicarian por diez lo que hay que cargar.
#
# El origen se da ya en coordenadas del mundo -X hacia el este desde la esquina
# SO del casco, Z hacia el sur desde su borde norte- y sale negativo por los dos
# lados, que es justo lo que se busca: la sierra empieza 5,5 km al oeste y 5 km
# al norte del recorte del pueblo.
print("4b/5 generando la sierra ...", flush=True)
si = json.loads(sh(["gdalinfo", "-json", "-stats", f"{RAW}/dem_sierra.tif"]))
sband = si["bands"][0]
smin, smax = float(sband["minimum"]), float(sband["maximum"])
sw, shh = si["size"]
sh(["gdal_translate", "-q", "-ot", "Float32", "-of", "EHdr",
    f"{RAW}/dem_sierra.tif", f"{BUILD}/sierra.bil"])
os.replace(f"{BUILD}/sierra.bil", f"{BUILD}/sierra.bin")
for junk in ("sierra.hdr", "sierra.bil.aux.xml", "sierra.prj", "sierra.stx"):
    if os.path.exists(f"{BUILD}/{junk}"):
        os.remove(f"{BUILD}/{junk}")
assert os.path.getsize(f"{BUILD}/sierra.bin") == sw * shh * 4
res_s = (SX1 - SX0) // sw
# El recorte del pueblo tiene que caer en una linea de la rejilla de la sierra,
# o el hueco que se le abre deja un diente de sierra de hasta 25 m por el que se
# ve el cielo desde dentro del pueblo.
for v in (X0 - SX0, X1 - SX0, SY1 - Y1, SY1 - Y0):   # margenes N y S incluidos
    assert v % res_s == 0, f"el Ring A no cuadra con la rejilla de la sierra: {v} % {res_s}"

# ------------------------------------------------------------------ viario
# Los ejes salen sin cota: el juego los posa sobre el terreno al cargar, asi
# que no hay que muestrear el DEM aqui.
ROAD_W = {
    "motorway": 14.0, "motorway_link": 8.0, "trunk": 12.0, "trunk_link": 7.0,
    "primary": 10.0, "primary_link": 6.0, "secondary": 8.5, "secondary_link": 6.0,
    "tertiary": 7.0, "tertiary_link": 5.0, "unclassified": 6.0, "residential": 6.0,
    "living_street": 5.5, "pedestrian": 5.0, "service": 4.0, "track": 3.0,
    "cycleway": 2.5, "footway": 2.2, "path": 1.8, "steps": 1.6, "ladder": 1.2,
}

print("5/6 leyendo viario ...", flush=True)
rd = json.load(open(f"{RAW}/roads.json"))
rfeats = []
for el in rd["elements"]:
    tags = el.get("tags", {})
    geom = el.get("geometry")
    if not geom or len(geom) < 2:
        continue
    # Las vias que pasan por debajo -o por encima- de un edificio se TIRABAN, y
    # eso dejaba calles sin salida: el edificio se sigue dibujando macizo, asi
    # que al borrar la via el hueco por el que se pasa de verdad se volvia muro.
    #
    # OSM lo dice de tres maneras distintas y hay que escucharlas todas, que es
    # lo que no se hacia:
    #   tunnel=yes / building_passage   19 vias: soportales, sendas que cruzan
    #                                   bajo una casa, escaleras que salen por un
    #                                   arco, y dos avenidas enteras.
    #   covered=yes                      2 vias: la calle Capilla y la calle
    #                                   Grimaldi, que van cubiertas de verdad.
    #   bridge=yes                      10 vias: van por encima. Aqui el viario
    #                                   no tiene cota propia, asi que en planta
    #                                   pisan lo que haya debajo; dejarlas
    #                                   bloqueadas seria cortar un puente.
    #
    # Se quedan, marcadas con `t`, para dos cosas: que el grafo de calles siga
    # conectado -si no, los vecinos no pueden ir de un lado al otro del pueblo- y
    # que la colision sepa que por ahi SI se pasa aunque haya un edificio encima.
    paso = 1 if (tags.get("tunnel") in ("yes", "building_passage")
                 or tags.get("covered") == "yes"
                 or tags.get("bridge") == "yes"
                 or el.get("id") in PASOS_A_MANO) else 0
    # Y lo cerrado a mano no se abre por nada. Sin esta linea `c` solo callaba a
    # la regla geometrica y la etiqueta de OSM seguia mandando: la puerta del
    # Monasterio estaba en CERRADOS y se abria igual.
    if el.get("id") in CERRADOS:
        paso = 0
    kind = tags.get("highway", "service")
    w = ROAD_W.get(kind, 4.0)
    if "width" in tags:
        m = re.match(r"\s*([\d.]+)", tags["width"])
        if m:
            w = max(1.2, min(20.0, float(m.group(1))))
    # OSM dice si la via esta alumbrada; cuando calla, se decide por anchura.
    lit = tags.get("lit")
    lit = (lit not in ("no", "disused")) if lit else (w >= 4.0)
    rfeats.append({"type": "Feature",
                   "properties": {"w": w, "lit": int(lit), "z": min(int(w / 3.0), 4),
                                  "t": paso, "id": el.get("id", 0),
                                  "c": 1 if el.get("id") in CERRADOS else 0,
                                  "n": tags.get("name", "")},
                   "geometry": {"type": "LineString",
                                "coordinates": [(p["lon"], p["lat"]) for p in geom]}})

tmpr4326, tmpr25830 = f"{BUILD}/_r4326.geojson", f"{BUILD}/_r25830.geojson"
json.dump({"type": "FeatureCollection", "features": rfeats}, open(tmpr4326, "w"))
if os.path.exists(tmpr25830):
    os.remove(tmpr25830)
sh(["ogr2ogr", "-f", "GeoJSON", "-s_srs", "EPSG:4326", "-t_srs", "EPSG:25830",
    tmpr25830, tmpr4326])

SX, SZ = X1 - X0, Y1 - Y0
roads, total_m, cortadas = [], 0.0, 0
for f in json.load(open(tmpr25830))["features"]:
    pts = []
    for x, y in f["geometry"]["coordinates"]:
        p = (round(x - X0, 2), round(Y1 - y, 2))
        if pts and abs(p[0] - pts[-1][0]) < 0.05 and abs(p[1] - pts[-1][1]) < 0.05:
            continue
        pts.append(p)

    # Overpass devuelve la via entera aunque solo un nodo caiga en el bbox, asi
    # que hay ejes que se van kilometros fuera del terreno. Se parten en tramos
    # y se conserva solo lo que pisa el mapa.
    runs, run = [], []
    for p in pts:
        if 0.0 <= p[0] <= SX and 0.0 <= p[1] <= SZ:
            run.append(p)
        else:
            if len(run) >= 2:
                runs.append(run)
            run = []
    if len(run) >= 2:
        runs.append(run)
    if len(runs) != 1 or len(runs[0]) != len(pts):
        cortadas += 1

    prop = f["properties"]
    for r in runs:
        flat = []
        for i, p in enumerate(r):
            if i:
                total_m += ((p[0] - r[i - 1][0]) ** 2 + (p[1] - r[i - 1][1]) ** 2) ** 0.5
            flat += [p[0], p[1]]
        # El id de OSM viaja hasta el juego. Son 18 KB sobre un repositorio que
        # ya lleva un heightmap binario, y es lo que permite senalar una calle
        # concreta sin describirla: cuando una via sale mal, se mira en OSM por
        # su id y se arregla alli, o se le pone excepcion aqui por id y no por
        # coordenada, que las coordenadas cambian al mover el encuadre.
        r_out = {"w": prop["w"], "l": prop["lit"], "z": prop["z"],
                 "i": prop["id"], "p": flat}
        if prop.get("t"):
            r_out["t"] = 1
        if prop.get("c"):
            r_out["c"] = 1
        # Al partir una via en tramos el nombre se repite en cada uno. Es lo
        # que se quiere: cualquier tramo sabe decir por que calle va.
        if prop.get("n"):
            r_out["n"] = prop["n"]
        roads.append(r_out)
print(f"    {len(roads)} tramos, {total_m / 1000:.1f} km, "
      f"{sum(r['l'] for r in roads)} alumbrados, {cortadas} recortadas al borde, "
      f"{sum(r.get('t', 0) for r in roads)} pasos bajo edificio o tunel")

# --------------------------------------------------------------- salida
print("6/6 escribiendo world.json ...", flush=True)
out = []
for p in polys:
    a, b = p["idx"]
    zs = vals[a:b]
    base = min(zs) - 2.0                      # falda de 2 m para tapar la cuesta
    top = max(zs) + p["h"]
    flat = []
    for x, y in p["ring"][:-1]:               # sin repetir el vertice de cierre
        flat += [round(x - X0, 2), round(Y1 - y, 2)]   # -> X, Z locales
    # h = altura real del edificio segun OSM, aparte de t: permite exagerar la
    # verticalidad sin tocar la falda que se adapta a la cuesta.
    # El id de OSM viaja tambien aqui, por lo mismo que en el viario: cuando
    # una huella tapa una calle hay que poder mirarla en OSM sin describirla.
    b_out = {"b": round(base, 2), "t": round(top, 2),
             "h": round(p["h"], 2), "i": p.get("i", 0), "p": flat}
    # Los patios, en el mismo sistema local. Solo los llevan 98 de 3545, asi que
    # el resto no engorda world.json con listas vacias.
    if p.get("holes"):
        b_out["q"] = [[c for x, y in h[:-1]
                       for c in (round(x - X0, 2), round(Y1 - y, 2))]
                      for h in p["holes"] if len(h) >= 4]
    if p.get("x"):
        b_out["x"] = 1
    # Solo los 71 edificios con nombre cargan el campo; los otros 3474 no
    # engordan world.json con comillas vacias.
    if p["n"]:
        b_out["n"] = p["n"]
    if p["a"]:
        b_out["a"] = p["a"]
    out.append(b_out)

# ------------------------------------------------------- sendas de la sierra
# Los caminos del monte, para que Abantos y las Machotas no sean laderas peladas
# sin por donde subir. Solo geometria: ni anchura por tipo ni alumbrado ni grafo.
# Los vecinos no salen del casco, asi que esto es paisaje y no viario.
#
# Lo que cae DENTRO del casco se tira entero: ahi ya estan las mismas vias con su
# anchura de verdad, y dibujarlas dos veces deja dos cintas superpuestas peleando
# por el z-buffer.
print("5b/6 leyendo las sendas de la sierra ...", flush=True)
pfeats = []
for el in json.load(open(f"{RAW}/paths_sierra.json"))["elements"]:
    geom = el.get("geometry") or []
    if len(geom) < 2:
        continue
    pfeats.append({"type": "Feature", "properties": {"k": el["tags"].get("highway")},
                   "geometry": {"type": "LineString",
                                "coordinates": [(p["lon"], p["lat"]) for p in geom]}})
tmpp4326, tmpp25830 = f"{BUILD}/_p4326.geojson", f"{BUILD}/_p25830.geojson"
json.dump({"type": "FeatureCollection", "features": pfeats}, open(tmpp4326, "w"))
if os.path.exists(tmpp25830):
    os.remove(tmpp25830)
sh(["ogr2ogr", "-f", "GeoJSON", "-s_srs", "EPSG:4326", "-t_srs", "EPSG:25830",
    tmpp25830, tmpp4326])

# Una pista forestal es mas ancha que una senda de cabras, y se nota subiendo.
SENDA_W = {"track": 3.0, "bridleway": 2.2, "path": 1.6}
sendas, sm = [], 0.0
SX0w, SZ0w = SX0 - X0, Y1 - SY1                  # esquina NO de la sierra, en mundo
SXw, SZw = SX1 - SX0, SY1 - SY0
for f in json.load(open(tmpp25830))["features"]:
    pts = []
    for x, y in f["geometry"]["coordinates"]:
        pt = (round(x - X0, 1), round(Y1 - y, 1))
        if pts and abs(pt[0] - pts[-1][0]) < 1.0 and abs(pt[1] - pts[-1][1]) < 1.0:
            continue                              # 1 m: al monte no le hace falta mas
        pts.append(pt)
    # Se parte en tramos: dentro de la sierra Y fuera del casco.
    runs, run = [], []
    for pt in pts:
        enSierra = (SX0w <= pt[0] <= SX0w + SXw) and (SZ0w <= pt[1] <= SZ0w + SZw)
        enCasco = (0 <= pt[0] <= X1 - X0) and (0 <= pt[1] <= Y1 - Y0)
        if enSierra and not enCasco:
            run.append(pt)
        else:
            if len(run) >= 2:
                runs.append(run)
            run = []
    if len(run) >= 2:
        runs.append(run)
    w = SENDA_W.get(f["properties"]["k"], 1.6)
    for r in runs:
        flat = []
        for i, pt in enumerate(r):
            if i:
                sm += ((pt[0] - r[i - 1][0]) ** 2 + (pt[1] - r[i - 1][1]) ** 2) ** 0.5
            flat += [pt[0], pt[1]]
        sendas.append({"w": w, "p": flat})
for f in (tmpp4326, tmpp25830):
    os.remove(f)
print(f"    {len(sendas)} tramos de senda, {sm / 1000:.1f} km")

world = {
    "origin_utm": [X0, Y0], "epsg": 25830,
    "size_m": [X1 - X0, Y1 - Y0],
    "lat": round((B["LAT0"] + B["LAT1"]) / 2, 4),   # para la posicion del sol
    "dem": {"file": "terrain.bin", "w": dem_w, "h": dem_h, "min": hmin, "max": hmax},
    "sierra": {"file": "sierra.bin", "w": sw, "h": shh, "res": res_s,
               "x0": SX0 - X0, "z0": Y1 - SY1, "min": smin, "max": smax},
    "buildings": out,
    "roads": roads,
    "sendas": sendas,
}
json.dump(world, open(f"{BUILD}/world.json", "w"))
for f in (tmp4326, tmp25830, tmpr4326, tmpr25830):
    os.remove(f)

print(f"\nOK  {len(out)} edificios | {len(roads)} tramos de calle | "
      f"terreno {dem_w}x{dem_h} ({X1-X0}x{Y1-Y0} m) | cota {hmin:.0f}-{hmax:.0f} m\n"
      f"    sierra {sw}x{shh} a {res_s} m ({SX1-SX0}x{SY1-SY0} m) | cota {smin:.0f}-{smax:.0f} m\n"
      f"    {len(sendas)} tramos de senda por el monte, {sm/1000:.1f} km")
