import { hablar, indicaciones } from './dialogos.js';
import { generarEncargos } from './tramas.js';

// Misiones y dialogos: capa fina sobre npcs.js, dialogos.js y world.js.
// Se dibuja en el mismo canvas 2D que el minimapa (minimap.js), mismo pergamino
// y tinta, para que HUD y minimapa lean como una sola pieza.
//
// Nada de THREE aqui: solo se necesitan distancias 2D (x,z), que se sacan a
// mano de player.pos sin arrastrar la dependencia.

const TALK_RANGE = 4.0;      // metros para que aparezca el aviso "E - hablar"
const LINE_MAX = 46;         // caracteres por linea a 10px monospace, a ojo

const PARCHMENT = 'rgba(41, 33, 22, 0.92)';
const INK_FRAME = 'rgb(153, 128, 77)';
const INK_TEXT = 'rgb(214, 196, 158)';
const INK_NAME = 'rgb(255, 217, 102)';
const INK_DIM = 'rgb(153, 128, 77)';

export class Misiones {
  // `semilla` y `origen` (donde aparece el jugador) son lo que necesita el
  // generador de tramas.js; los pasos ya vienen hechos y aqui solo se recorren.
  constructor(world, vida, lugares, semilla = 1, origen = null) {
    this.world = world;
    this.vida = vida;
    this.lugares = lugares;
    this.semilla = semilla >>> 0 || 1;

    const centro = origen || { x: world.data.size_m[0] / 2,
      z: world.data.size_m[1] / 2 };
    this.pasos = generarEncargos(this.semilla, lugares, vida, centro);

    this.paso = 0;              // indice en this.pasos; al final, no queda nada
    this.cerca = null;          // npc mas cercano este fotograma, o null
    this.dialogo = null;        // { lineas, i } mientras hay bocadillo abierto
    this.pendienteAvance = false;
    this.veces = new Map();     // id del vecino -> conversaciones tenidas
    this.hora = 12;             // la pone main.js desde el ciclo de dia y noche

    console.log(`misiones: semilla ${this.semilla}, ${this.pasos.length} pasos`,
      this.pasos.map((p) => p.objetivo));
  }

  // El paso en curso, o undefined si ya no queda nada por hacer.
  get actual() { return this.pasos[this.paso]; }

  update(dt, player) {
    this.cerca = null;
    if (this.dialogo) return;   // con el dialogo abierto no hace falta buscar mas

    // El paso "reach" se resuelve solo, pero eso ya no impide seguir buscando
    // con quien hablar: por el camino al sitio hay gente.
    if (this.actual && this.actual.reach) this._comprobarLlegada(player);
    if (this.dialogo) return;

    if (!this.vida || typeof this.vida.cercano !== 'function') return;
    try {
      this.cerca = this.vida.cercano(player.pos, TALK_RANGE);
    } catch {
      this.cerca = null;        // vida.cercano no debe poder tumbar el juego
    }
  }

  // Contexto que necesita dialogos.js. Se arma aqui porque es quien sabe por
  // que paso de la mision vamos.
  _ctx(npc) {
    const q = this.actual;
    return {
      hora: this.hora,
      paso: this.paso,
      veces: this.veces.get(npc.id) || 0,
      lugares: this.lugares,
      world: this.world,
      oficioBuscado: (q && q.oficio) || null,
      buscarOficio: (of, pos) => (this.vida.buscarOficio
        ? this.vida.buscarOficio(of, pos) : null),
    };
  }

  // Si este vecino es justo el que espera el paso en curso. La ficha de npcs.js
  // ya trae el oficio suelto, asi que basta compararlo: antes habia que buscar la
  // palabra dentro del nombre porque `tipo` valia 'vecino' para los 220.
  _esObjetivo(npc) {
    const q = this.actual;
    return !!(q && q.oficio && npc && npc.oficio === q.oficio);
  }

  _abrir(lineas, avanza = false) {
    if (!lineas || !lineas.length) return;
    this.dialogo = { lineas, i: 0 };
    this.pendienteAvance = avanza;
  }

  _contar(npc) {
    this.veces.set(npc.id, (this.veces.get(npc.id) || 0) + 1);
  }

  // E: hablar. Con CUALQUIERA, no solo con el objetivo de la mision.
  interactuar() {
    // Dialogo abierto: E avanza linea a linea; en la ultima, cierra y avanza mision.
    if (this.dialogo) {
      this.dialogo.i++;
      if (this.dialogo.i >= this.dialogo.lineas.length) {
        this.dialogo = null;
        if (this.pendienteAvance) { this.paso++; this.pendienteAvance = false; }
      }
      return;
    }
    if (!this.cerca) return;

    // Si es justo a quien busca la mision, manda el guion del encargo.
    if (this._esObjetivo(this.cerca)) {
      this._contar(this.cerca);
      this._abrir(this.actual.dialogo, true);
      return;
    }
    // Si no, charla procedural. Un pueblo de 220 vecinos mudos no es un pueblo.
    this._contar(this.cerca);
    this._abrir(hablar(this.cerca, this._ctx(this.cerca)));
  }

  // Q: pedir el camino. Funciona con cualquier vecino y, si hay mision viva,
  // orienta hacia ella.
  indicaciones() {
    if (this.dialogo || !this.cerca) return;
    this._contar(this.cerca);
    this._abrir(indicaciones(this.cerca, this._ctx(this.cerca)));
  }

  // Un paso "reach" se resuelve solo, comprobando distancia cada fotograma desde
  // dibujar/update; aqui lo miramos justo antes de pintar para no duplicar logica.
  _comprobarLlegada(player) {
    const q = this.actual;
    if (!q || !q.reach || this.dialogo) return;
    const dx = player.pos.x - q.reach.x;
    const dz = player.pos.z - q.reach.z;
    if (dx * dx + dz * dz <= q.radio * q.radio) {
      this.dialogo = { lineas: q.dialogo, i: 0 };
      this.pendienteAvance = true;
    }
  }

  // Todo el HUD se midio sobre el lienzo de 480x270 del principio. Ahora el
  // lienzo se adapta a la ventana, asi que se escala por un factor ENTERO igual
  // que el minimapa: con 10px fijos el texto salia a media altura y no se leia.
  dibujar(ctx, W, H) {
    if (!this.world) return;
    const k = Math.max(1, Math.round(H / 270));
    // El objetivo va abajo del todo, justo donde se planta el bocadillo: con el
    // dialogo abierto se veia el texto medio tapado por el marco.
    if (this.dialogo) this._pintarDialogo(ctx, W, H, k);
    else { this._pintarObjetivo(ctx, W, H, k); this._pintarAviso(ctx, W, H, k); }
  }

  _pintarObjetivo(ctx, W, H, k) {
    const q = this.actual;
    const texto = q ? q.objetivo : 'Sin mas encargos por esta noche.';
    ctx.font = `${10 * k}px monospace`;
    ctx.fillStyle = INK_DIM;
    ctx.fillText(texto, 8 * k, H - 8 * k);
  }

  // El aviso sale con CUALQUIERA que tengas al lado. Antes solo aparecia con el
  // objetivo de la mision, asi que 219 de los 220 vecinos parecian decorado.
  _pintarAviso(ctx, W, H, k) {
    if (!this.cerca) return;
    const nombre = this.cerca.nombre || this.cerca.tipo || 'alguien';
    const esObjetivo = this._esObjetivo(this.cerca);
    const esVecino = this.cerca.tipo === 'vecino';

    ctx.font = `${10 * k}px monospace`;
    ctx.textAlign = 'center';
    // Al que busca la mision se le marca en dorado; al resto, en tinta apagada.
    ctx.fillStyle = esObjetivo ? INK_NAME : INK_DIM;
    const aviso = esVecino
      ? `E hablar con ${nombre}${esObjetivo ? ' *' : ''}   ·   Q preguntar el camino`
      : `E - mirar ${nombre.toLowerCase()}`;
    ctx.fillText(aviso, W * 0.5, H - 24 * k);
    ctx.textAlign = 'left';
  }

  _pintarDialogo(ctx, W, H, k) {
    const { lineas, i } = this.dialogo;
    const [nombre, texto] = lineas[i];
    ctx.font = `${10 * k}px monospace`;
    const envueltas = envolver(ctx, texto, LINE_MAX);

    const boxH = (20 + envueltas.length * 12 + 12) * k;
    const boxW = Math.min(W - 24 * k, 420 * k);
    const x0 = (W - boxW) * 0.5, y0 = H - boxH - 12 * k;

    ctx.fillStyle = PARCHMENT;
    ctx.fillRect(x0, y0, boxW, boxH);
    ctx.strokeStyle = INK_FRAME;
    ctx.lineWidth = k;
    ctx.strokeRect(x0 + 0.5 * k, y0 + 0.5 * k, boxW - k, boxH - k);

    let y = y0 + 14 * k;
    if (nombre) {
      ctx.fillStyle = INK_NAME;
      ctx.fillText(nombre, x0 + 10 * k, y);
      y += 14 * k;
    }
    ctx.fillStyle = INK_TEXT;
    for (const linea of envueltas) {
      ctx.fillText(linea, x0 + 10 * k, y);
      y += 12 * k;
    }
    ctx.fillStyle = INK_DIM;
    ctx.fillText('E - seguir', x0 + boxW - 68 * k, y0 + boxH - 6 * k);
  }
}

// --- ayudantes ----------------------------------------------------------------

// Envuelve `texto` a lineas de como mucho `max` caracteres, partiendo por
// palabras. Nada de medir con ctx.measureText: a 10px monospace el ancho de
// caracter es fijo, y esto evita reflow por fuente no cargada aun.
function envolver(ctx, texto, max) {
  const palabras = texto.split(' ');
  const out = [];
  let linea = '';
  for (const p of palabras) {
    const cand = linea ? linea + ' ' + p : p;
    if (cand.length > max && linea) {
      out.push(linea);
      linea = p;
    } else {
      linea = cand;
    }
  }
  if (linea) out.push(linea);
  return out;
}
