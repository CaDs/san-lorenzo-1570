// Minimapa de esquina: pergamino con las calles y el caserio en tinta.
// Sobre canvas 2D.
//
// Norte arriba, fijo; la flecha del jugador es la que gira. El lienzo se pinta
// UNA vez al cargar desde world.json; cada fotograma solo se recorta la ventana
// alrededor del jugador, que es gratis.
//
// Godot rellenaba las casas con un test de punto en poligono pixel a pixel.
// Aqui lo hace fill() del canvas, que es la misma figura por la via nativa.

// A 540 lineas el pergamino se dibuja al doble de resolucion que antes: con 2 m
// por pixel se veia el mapa a bloques justo cuando el resto dejo de verse asi.
const MPP = 1.0;                  // metros por pixel del lienzo
const VIEW_M = 128.0;             // 128 m en 128 px = 1 texel por pixel de pantalla
const BOX_REF = 64;               // el recuadro medido sobre el diseno de 480x270
const ALTO_REF = 270;

const PARCHMENT = 'rgba(41, 33, 22, 0.92)';
const INK_ROAD = 'rgb(133, 110, 69)';
const INK_HOUSE = 'rgb(79, 62, 40)';
const INK_FRAME = 'rgb(153, 128, 77)';
const INK_PLAYER = 'rgb(255, 217, 102)';

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.ctx = canvas.getContext('2d');

    const t0 = performance.now();
    const w = world.data;
    this.w = Math.floor(w.size_m[0] / MPP);
    this.h = Math.floor(w.size_m[1] / MPP);
    const off = new OffscreenCanvas(this.w, this.h);
    const g = off.getContext('2d');
    g.fillStyle = PARCHMENT;
    g.fillRect(0, 0, this.w, this.h);

    g.strokeStyle = INK_ROAD;
    g.lineCap = 'round';
    for (const r of w.roads) {
      // Anchos en metros, no en pixeles: al bajar MPP el trazo debe cubrir lo
      // mismo sobre el terreno, no encogerse a la mitad.
      g.lineWidth = (r.w < 5.0 ? 2.0 : 6.0) / MPP;
      g.beginPath();
      g.moveTo(r.p[0] / MPP, r.p[1] / MPP);
      for (let i = 2; i < r.p.length; i += 2) g.lineTo(r.p[i] / MPP, r.p[i + 1] / MPP);
      g.stroke();
    }

    g.fillStyle = INK_HOUSE;
    g.beginPath();
    for (const b of w.buildings) {
      g.moveTo(b.p[0] / MPP, b.p[1] / MPP);
      for (let i = 2; i < b.p.length; i += 2) g.lineTo(b.p[i] / MPP, b.p[i + 1] / MPP);
      g.closePath();
    }
    g.fill();

    this.tex = off;
    console.log(`minimapa ${this.w}x${this.h} px en ${Math.round(performance.now() - t0)} ms`);
  }

  draw(pos, yaw) {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // El recuadro crece con el lienzo: a 540 lineas ocupa lo mismo en pantalla
    // que ocupaba a 270, no la mitad.
    const k = Math.max(1, Math.round(this.canvas.height / ALTO_REF));
    const BOX = BOX_REF * k;
    const margen = 6 * k;
    const half = VIEW_M / MPP * 0.5;
    // En el borde del mundo la ventana se frena y la flecha se descentra, en vez
    // de ensenar vacio fuera del lienzo.
    const cx = Math.min(Math.max(pos.x / MPP, half), this.w - half);
    const cz = Math.min(Math.max(pos.z / MPP, half), this.h - half);

    const x0 = this.canvas.width - BOX - margen, y0 = margen;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.tex, cx - half, cz - half, half * 2, half * 2, x0, y0, BOX, BOX);
    c.strokeStyle = INK_FRAME;
    c.lineWidth = 1;
    c.strokeRect(x0 + 0.5, y0 + 0.5, BOX - 1, BOX - 1);

    // Flecha con el rumbo real. En el mapa +y de pantalla es +z del mundo.
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ang = Math.atan2(fz, fx) + Math.PI * 0.5;   // el triangulo base apunta a -y
    const px = x0 + (pos.x / MPP - cx + half) / (half * 2) * BOX;
    const py = y0 + (pos.z / MPP - cz + half) / (half * 2) * BOX;
    c.save();
    c.translate(px, py);
    c.rotate(ang);
    c.scale(k, k);
    c.fillStyle = INK_PLAYER;
    c.beginPath();
    c.moveTo(0, -3.5); c.lineTo(2.5, 2.5); c.lineTo(-2.5, 2.5);
    c.closePath();
    c.fill();
    c.restore();

    // En el dorado de la flecha: en tinta de marco se fundia con las calles.
    c.fillStyle = INK_PLAYER;
    c.font = `${8 * k}px monospace`;
    c.fillText('N', x0 + BOX * 0.5 - 2 * k, y0 + 10 * k);
  }
}
