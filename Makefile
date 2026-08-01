PORT ?= 8000

.PHONY: dev test tramas clima data

# El juego no se compila: son ficheros sueltos que sirve cualquier servidor
# estatico. Se sirve la raiz porque web/ lee ../data/build/.
dev:
	@python3 tools/serve.py $(PORT)

# Comprobacion ejecutable del jugador (gravedad y colision contra fachadas).
# El veredicto sale en la consola del navegador.
test:
	@echo "abre http://localhost:$(PORT)/web/?test y mira la consola"
	@python3 tools/serve.py $(PORT)

# El generador de encargos no necesita navegador: 300 semillas contra un pueblo
# de mentira, comprobando que ninguna produzca un encargo imposible, mas una
# cadena de 500 encargos seguidos, que es como se juega desde que no se acaban.
tramas:
	@node web/quests.test.mjs

# El clima tampoco necesita navegador. Comprueba que es determinista, que no da
# saltos en la frontera de los bloques de seis horas y -lo que de verdad importa-
# que el reparto se parece al de la serie del Monasterio: si esto se va, lo que
# hay dentro deja de ser San Lorenzo y pasa a ser un clima de videojuego.
clima:
	@node web/clima.test.mjs

# Regenera data/build/ desde data/raw/. Necesita GDAL y, si data/raw/ no esta,
# conexion para descargarlo. Los datos generados ya vienen en el repositorio:
# esto solo hace falta para cambiar de pueblo o de encuadre (tools/bbox.sh).
data:
	@bash tools/fetch.sh
	@python3 tools/prep.py
