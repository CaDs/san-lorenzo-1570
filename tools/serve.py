#!/usr/bin/env python3
"""Servidor estatico de desarrollo, sin cache.

`python3 -m http.server` responde 304 a los modulos ES, y Chrome se los guarda
con mucha alegria: se edita world.js, se recarga, y sigue corriendo el shader
viejo. Media hora depurando algo que ya estaba arreglado. Esto manda
Cache-Control: no-store en todo.

Uso: python3 tools/serve.py [puerto]
"""
import errno
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class SinCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_header(self, keyword, value):
        # SimpleHTTPRequestHandler manda Last-Modified y con el vuelve el 304.
        if keyword == 'Last-Modified':
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        pass                      # el log de cada .js no aporta nada


if __name__ == '__main__':
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # Primero se abre el puerto y DESPUES se anuncia la direccion. Al contrario,
    # con un servidor de otra sesion todavia escuchando en el 8000, `make dev`
    # imprimia la URL, se caia con "Address already in use" y devolvia el prompt:
    # parecia que no hacia nada, y la pestana del navegador seguia servida por el
    # servidor viejo, asi que tampoco se notaba ahi.
    try:
        httpd = HTTPServer(('', puerto), partial(SinCache))
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        print(f'el puerto {puerto} ya esta ocupado, seguramente por otro '
              f'`make dev`.\nquien lo tiene:  lsof -nP -iTCP:{puerto} -sTCP:LISTEN'
              f'\nsoltarlo:        kill $(lsof -t -iTCP:{puerto} -sTCP:LISTEN)'
              f'\no servir en otro: make dev PORT={puerto + 1}', file=sys.stderr)
        sys.exit(1)
    # flush: Python solo escribe por lineas cuando la salida es un terminal. Con
    # `make dev` volcado a un fichero, o en la consola integrada de un editor, la
    # linea se quedaba en el buffer hasta que el servidor muriera: estaba
    # levantado y no decia nada. "make dev no hace nada" era esto.
    print(f'http://localhost:{puerto}/web/', flush=True)
    httpd.serve_forever()
