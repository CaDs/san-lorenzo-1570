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
const MPP = 1.0;                  // metros por pixel del lienzo del casco
const VIEW_M = 128.0;             // 128 m en 128 px = 1 texel por pixel de pantalla
// Y el de la sierra, que es otro pergamino y no el mismo estirado. A 6 m por
// pixel los 14 x 12 km caben en 2.350 x 2.017, menos memoria que el del casco, y
// a esa escala se ve el trazado de un camino, que es para lo que sirve. Estirar
// el del casco a la sierra serian 170 millones de pixeles, y bajar el casco a
// 6 m dejaria el pueblo en manchas: por eso son dos.
const MPP_SIERRA = 6.0;
const VIEW_SIERRA = 900.0;        // se abarca mas campo, que fuera hay mas que andar
const BOX_REF = 64;               // el recuadro medido sobre el diseno de 480x270
const ALTO_REF = 270;

const PARCHMENT = 'rgba(41, 33, 22, 0.92)';
const INK_ROAD = 'rgb(133, 110, 69)';
const INK_HOUSE = 'rgb(79, 62, 40)';
const INK_FRAME = 'rgb(153, 128, 77)';
const INK_PLAYER = 'rgb(255, 217, 102)';

export class Minimap {
  constructor(canvas, world, lugares) {
    this.canvas = canvas;
    this.world = world;
    // Para poner el nombre de la calle debajo de las coordenadas: "1287, 1066"
    // dice donde exactamente y "Plaza de la Constitucion" dice donde a secas, y
    // hacen falta las dos cosas para contar donde esta algo.
    this.lugares = lugares;
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

    // --- el pergamino de la sierra ------------------------------------------
    //
    // Antes el mapa acababa en el recorte del casco y la ventana se frenaba en el
    // borde: en cuanto pasabas de z = 2100 la flecha se despegaba del centro y
    // acababa fuera del recuadro. Con la sierra abierta y la Silla a 1,5 km
    // fuera, eso pasa constantemente.
    if (world.sierra) {
      const si = world.sInfo;
      this.sx0 = si.x0; this.sz0 = si.z0;
      this.sw = Math.floor(si.w * si.res / MPP_SIERRA);
      this.sh = Math.floor(si.h * si.res / MPP_SIERRA);
      const os = new OffscreenCanvas(this.sw, this.sh);
      const gs = os.getContext('2d');
      gs.fillStyle = PARCHMENT;
      gs.fillRect(0, 0, this.sw, this.sh);
      const aX = (x) => (x - this.sx0) / MPP_SIERRA;
      const aZ = (z) => (z - this.sz0) / MPP_SIERRA;

      gs.strokeStyle = INK_ROAD;
      gs.lineCap = 'round';
      gs.lineWidth = 1.2;
      for (const r of (w.sendas || [])) {
        gs.beginPath();
        gs.moveTo(aX(r.p[0]), aZ(r.p[1]));
        for (let i = 2; i < r.p.length; i += 2) gs.lineTo(aX(r.p[i]), aZ(r.p[i + 1]));
        gs.stroke();
      }
      // Y las calles del casco encima, mas gruesas: desde el monte lo que se
      // busca en el mapa es por donde se vuelve al pueblo.
      gs.lineWidth = 1.8;
      for (const r of w.roads) {
        if (r.w < 5.0) continue;
        gs.beginPath();
        gs.moveTo(aX(r.p[0]), aZ(r.p[1]));
        for (let i = 2; i < r.p.length; i += 2) gs.lineTo(aX(r.p[i]), aZ(r.p[i + 1]));
        gs.stroke();
      }
      // El caserio, como mancha. A 6 m por pixel una casa es un punto, asi que se
      // pintan todas de una tacada y lo que se lee es la forma del pueblo.
      gs.fillStyle = INK_HOUSE;
      gs.beginPath();
      for (const b of w.buildings) {
        gs.moveTo(aX(b.p[0]), aZ(b.p[1]));
        for (let i = 2; i < b.p.length; i += 2) gs.lineTo(aX(b.p[i]), aZ(b.p[i + 1]));
        gs.closePath();
      }
      gs.fill();
      this.texSierra = os;
    }

    console.log(`minimapa ${this.w}x${this.h} px`
      + (this.texSierra ? ` + sierra ${this.sw}x${this.sh}` : '')
      + ` en ${Math.round(performance.now() - t0)} ms`);
  }

  draw(pos, yaw) {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // El recuadro crece con el lienzo: a 540 lineas ocupa lo mismo en pantalla
    // que ocupaba a 270, no la mitad.
    const k = Math.max(1, Math.round(this.canvas.height / ALTO_REF));
    const BOX = BOX_REF * k;
    const margen = 6 * k;

    // Que pergamino toca. Fuera del casco -y con un margen, para no cambiar de
    // escala justo al pisar la raya- manda el de la sierra. Sin el, la ventana se
    // frenaba en el borde del casco y la flecha se salia del recuadro.
    const [sx, sz] = this.world.data.size_m;
    const fuera = pos.x < -40 || pos.x > sx + 40 || pos.z < -40 || pos.z > sz + 40;
    const enSierra = fuera && !!this.texSierra;
    const tex = enSierra ? this.texSierra : this.tex;
    const mpp = enSierra ? MPP_SIERRA : MPP;
    const vista = enSierra ? VIEW_SIERRA : VIEW_M;
    const tw = enSierra ? this.sw : this.w, th = enSierra ? this.sh : this.h;
    const ox = enSierra ? this.sx0 : 0, oz = enSierra ? this.sz0 : 0;

    const half = vista / mpp * 0.5;
    // En el borde del mundo la ventana se frena y la flecha se descentra, en vez
    // de ensenar vacio fuera del lienzo.
    const cx = Math.min(Math.max((pos.x - ox) / mpp, half), tw - half);
    const cz = Math.min(Math.max((pos.z - oz) / mpp, half), th - half);

    const x0 = this.canvas.width - BOX - margen, y0 = margen;
    c.imageSmoothingEnabled = false;
    c.drawImage(tex, cx - half, cz - half, half * 2, half * 2, x0, y0, BOX, BOX);
    c.strokeStyle = INK_FRAME;
    c.lineWidth = 1;
    c.strokeRect(x0 + 0.5, y0 + 0.5, BOX - 1, BOX - 1);

    // Flecha con el rumbo real. En el mapa +y de pantalla es +z del mundo.
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ang = Math.atan2(fz, fx) + Math.PI * 0.5;   // el triangulo base apunta a -y
    const px = x0 + ((pos.x - ox) / mpp - cx + half) / (half * 2) * BOX;
    const py = y0 + ((pos.z - oz) / mpp - cz + half) / (half * 2) * BOX;
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

    // --- donde estas, en numeros ---------------------------------------------
    //
    // Debajo del mapa, para poder DECIR donde pasa algo. Son las coordenadas del
    // mundo tal cual: X al este desde la esquina suroeste del recorte y Z al SUR
    // desde su borde norte, en metros. Fuera del casco salen negativas o pasan de
    // 3600, y eso esta bien: la sierra empieza ahi.
    //
    // Y son las mismas que aceptan ?x= y ?z= al arrancar, asi que leer una
    // captura y plantarse en el sitio es copiar dos numeros. Por eso van con la
    // coma y el espacio, en ese formato y no en otro.
    //
    // La caja se ajusta al TEXTO y no al ancho del mapa, y la letra es la mas
    // pequena que se lee: esto se mira de reojo dos veces por partida y no tiene
    // por que ocupar como el mapa.
    const fuente = 5 * k, alto = 7 * k, pad = 2 * k;
    const calle = this.lugares && this.lugares.calleEn ? this.lugares.calleEn(pos) : null;
    // Fuera del casco se dice la escala. Un mapa que cambia de escala sin avisar
    // desorienta mas que no tenerlo.
    const lineas = [`${Math.round(pos.x)}, ${Math.round(pos.z)}  ${Math.round(pos.y)} m`];
    if (calle) lineas.push(calle);
    else if (enSierra) lineas.push('el monte');
    c.font = `${fuente}px monospace`;
    let ancho = 0;
    for (const l of lineas) ancho = Math.max(ancho, c.measureText(l).width);
    const bw = ancho + pad * 2, bh = alto * lineas.length + pad;
    const bx = x0 + BOX - bw, by = y0 + BOX + 2 * k;
    c.fillStyle = PARCHMENT;
    c.fillRect(bx, by, bw, bh);
    c.strokeStyle = INK_FRAME;
    c.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    lineas.forEach((l, i) => {
      // La calle, mas apagada: lo que se copia son los numeros.
      c.fillStyle = i ? INK_FRAME : INK_PLAYER;
      c.fillText(l, bx + pad, by + pad + alto * (i + 0.75));
    });
  }
}
