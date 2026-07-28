#!/usr/bin/env python3
"""Servidor estatico de desarrollo, sin cache.

`python3 -m http.server` responde 304 a los modulos ES, y Chrome se los guarda
con mucha alegria: se edita world.js, se recarga, y sigue corriendo el shader
viejo. Media hora depurando algo que ya estaba arreglado. Esto manda
Cache-Control: no-store en todo.

Uso: python3 tools/serve.py [puerto]
"""
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
    print(f'http://localhost:{puerto}/web/')
    HTTPServer(('', puerto), partial(SinCache)).serve_forever()
