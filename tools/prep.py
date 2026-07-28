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
    m = re.search(r"export LAT0=([-\d.]+) LON0=([-\d.]+) LAT1=([-\d.]+) LON1=([-\d.]+)", src)
    g.update(zip(("LAT0", "LON0", "LAT1", "LON1"), map(float, m.groups())))
    return g

B = load_bbox()
X0, X1, Y0, Y1 = B["X0"], B["X1"], B["Y0"], B["Y1"]

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
    h = tags.get("height")
    if h:
        m = re.match(r"\s*([\d.]+)", h)          # "12", "12 m", "12.5m"
        if m:
            return float(m.group(1))
    lv = tags.get("building:levels")
    if lv:
        m = re.match(r"\s*([\d.]+)", lv)
        if m:
            return float(m.group(1)) * FLOOR_M
    return FALLBACK.get(tags.get("building"), 8.0)

# ------------------------------------------------- osm -> geojson -> utm
def rings(el):
    """Anillos exteriores en [(lon,lat),...]. Los agujeros se ignoran (v1)."""
    if el["type"] == "way":
        return [[(p["lon"], p["lat"]) for p in el["geometry"]]] if el.get("geometry") else []
    out = []
    for mem in el.get("members", []):
        if mem.get("role") in ("outer", "") and mem.get("geometry"):
            out.append([(p["lon"], p["lat"]) for p in mem["geometry"]])
    return out

print("1/5 leyendo OSM ...", flush=True)
osm = json.load(open(f"{RAW}/buildings.json"))
feats = []
for el in osm["elements"]:
    tags = el.get("tags", {})
    for r in rings(el):
        if len(r) < 4:
            continue
        if r[0] != r[-1]:
            r.append(r[0])
        # El nombre viaja hasta world.json: OSM sabe como se llaman la Iglesia
        # de San Bernabe, el Ayuntamiento o el Real Coliseo, y sin eso los
        # vecinos del juego solo pueden decir "hacia el nordeste" en vez de
        # mandarte a un sitio con nombre.
        feats.append({"type": "Feature",
                      "properties": {"h": height_of(tags),
                                     "n": tags.get("name", ""),
                                     "a": tags.get("amenity", "")},
                      "geometry": {"type": "Polygon", "coordinates": [r]}})
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
                  "n": f["properties"].get("n", ""),
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

# ------------------------------------------------------------------ viario
# Los ejes salen sin cota: el juego los posa sobre el terreno al cargar, asi
# que no hay que muestrear el DEM aqui.
ROAD_W = {
    "motorway": 14.0, "motorway_link": 8.0, "trunk": 12.0, "trunk_link": 7.0,
    "primary": 10.0, "primary_link": 6.0, "secondary": 8.5, "secondary_link": 6.0,
    "tertiary": 7.0, "tertiary_link": 5.0, "unclassified": 6.0, "residential": 6.0,
    "living_street": 5.5, "pedestrian": 5.0, "service": 4.0, "track": 3.0,
    "cycleway": 2.5, "footway": 2.2, "path": 1.8, "steps": 1.6,
}

print("5/6 leyendo viario ...", flush=True)
rd = json.load(open(f"{RAW}/roads.json"))
rfeats = []
for el in rd["elements"]:
    tags = el.get("tags", {})
    geom = el.get("geometry")
    if not geom or len(geom) < 2 or tags.get("tunnel") in ("yes", "building_passage"):
        continue
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
        r_out = {"w": prop["w"], "l": prop["lit"], "z": prop["z"], "p": flat}
        # Al partir una via en tramos el nombre se repite en cada uno. Es lo
        # que se quiere: cualquier tramo sabe decir por que calle va.
        if prop.get("n"):
            r_out["n"] = prop["n"]
        roads.append(r_out)
print(f"    {len(roads)} tramos, {total_m / 1000:.1f} km, "
      f"{sum(r['l'] for r in roads)} alumbrados, {cortadas} recortadas al borde")

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
    b_out = {"b": round(base, 2), "t": round(top, 2),
             "h": round(p["h"], 2), "p": flat}
    # Solo los 71 edificios con nombre cargan el campo; los otros 3474 no
    # engordan world.json con comillas vacias.
    if p["n"]:
        b_out["n"] = p["n"]
    if p["a"]:
        b_out["a"] = p["a"]
    out.append(b_out)

world = {
    "origin_utm": [X0, Y0], "epsg": 25830,
    "size_m": [X1 - X0, Y1 - Y0],
    "lat": round((B["LAT0"] + B["LAT1"]) / 2, 4),   # para la posicion del sol
    "dem": {"file": "terrain.bin", "w": dem_w, "h": dem_h, "min": hmin, "max": hmax},
    "buildings": out,
    "roads": roads,
}
json.dump(world, open(f"{BUILD}/world.json", "w"))
for f in (tmp4326, tmp25830, tmpr4326, tmpr25830):
    os.remove(f)

print(f"\nOK  {len(out)} edificios | {len(roads)} tramos de calle | "
      f"terreno {dem_w}x{dem_h} ({X1-X0}x{Y1-Y0} m) | cota {hmin:.0f}-{hmax:.0f} m")
