#!/usr/bin/env bash
# Descarga DEM (IGN WCS) y edificios/viario (Overpass) para Ring A.
# Idempotente: no re-descarga lo que ya existe. Borra data/raw para forzar.
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/bbox.sh
mkdir -p data/raw

DEM_W=$(( (X1-X0)/DEM_RES ));   DEM_H=$(( (Y1-Y0)/DEM_RES ))

fetch() { # nombre destino url
  if [ -s "$2" ]; then echo "  = $1 (cache)"; return; fi
  echo -n "  > $1 ... "
  curl -sfS --max-time 300 -A "$UA" -o "$2.part" "$3" && mv "$2.part" "$2"
  echo "$(du -h "$2" | cut -f1)"
}

echo "Ring A: ${X0}-${X1} E, ${Y0}-${Y1} N (EPSG:25830)"

fetch "DEM ${DEM_W}x${DEM_H} @${DEM_RES}m" data/raw/dem.tif \
  "https://servicios.idee.es/wcs-inspire/mdt?service=WCS&version=2.0.1&request=GetCoverage&coverageId=Elevacion25830_5&subset=x($X0,$X1)&subset=y($Y0,$Y1)&format=image/tiff"

overpass() { # nombre destino consulta
  if [ -s "$2" ]; then echo "  = $1 (cache)"; return; fi
  echo -n "  > $1 ... "
  curl -sfS --max-time 300 -A "$UA" -X POST https://overpass-api.de/api/interpreter \
    --data-urlencode "data=[out:json][timeout:280];$3" -o "$2.part" && mv "$2.part" "$2"
  echo "$(du -h "$2" | cut -f1)"
}

overpass "Edificios" data/raw/buildings.json \
  "(way[\"building\"]($LAT0,$LON0,$LAT1,$LON1);relation[\"building\"]($LAT0,$LON0,$LAT1,$LON1););out body geom;"

# Sin area=* ni las vias en obras: solo ejes por los que se pueda andar.
overpass "Viario" data/raw/roads.json \
  "way[\"highway\"][\"highway\"!~\"^(proposed|construction|raceway|bus_guideway)\$\"][\"area\"!=\"yes\"]($LAT0,$LON0,$LAT1,$LON1);out body geom;"

echo "OK -> data/raw/"
