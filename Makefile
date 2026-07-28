PORT ?= 8000

.PHONY: dev test data

# El juego no se compila: son ficheros sueltos que sirve cualquier servidor
# estatico. Se sirve la raiz porque web/ lee ../data/build/.
dev:
	@python3 tools/serve.py $(PORT)

# Comprobacion ejecutable del jugador (gravedad y colision contra fachadas).
# El veredicto sale en la consola del navegador.
test:
	@echo "abre http://localhost:$(PORT)/web/?test y mira la consola"
	@python3 tools/serve.py $(PORT)

# Regenera data/build/ desde data/raw/. Necesita GDAL y, si data/raw/ no esta,
# conexion para descargarlo. Los datos generados ya vienen en el repositorio:
# esto solo hace falta para cambiar de pueblo o de encuadre (tools/bbox.sh).
data:
	@bash tools/fetch.sh
	@python3 tools/prep.py
