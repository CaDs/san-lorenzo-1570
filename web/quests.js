import { hablar, indicaciones } from './dialogos.js';

// Misiones y dialogos: capa fina sobre npcs.js, dialogos.js y world.js.
// Se dibuja en el mismo canvas 2D que el minimapa (minimap.js), mismo pergamino
// y tinta, para que HUD y minimapa lean como una sola pieza.
//
// Nada de THREE aqui: solo se necesitan distancias 2D (x,z), que se sacan a
// mano de player.pos sin arrastrar la dependencia.

const TALK_RANGE = 4.0;      // metros para que aparezca el aviso "E - hablar"
const REACH_RANGE = 90.0;    // el Monasterio es enorme; su centro cae dentro
                              // de los muros, así que "llegar" solo pide acercarse
const LINE_MAX = 46;         // caracteres por linea a 10px monospace, a ojo

const PARCHMENT = 'rgba(41, 33, 22, 0.92)';
const INK_FRAME = 'rgb(153, 128, 77)';
const INK_TEXT = 'rgb(214, 196, 158)';
const INK_NAME = 'rgb(255, 217, 102)';
const INK_DIM = 'rgb(153, 128, 77)';

// --- contenido: cadena de 4 misiones ancladas al San Lorenzo real -----------
//
// tipoNpc: el `tipo` que devuelve vida.cercano() para el vecino que hace falta.
// No conozco el vocabulario exacto de npcs.js, asi que se compara sin mayusculas
// y por "incluye", no por igualdad estricta: mas tolerante si el tipo real es
// "cantero_1" o "Cantero".
const QUESTS = [
  {
    id: 'cantero',
    tipoNpc: 'cantero',
    objetivo: 'Busca al cantero: hay obra en la Herreria.',
    dialogo: [
      ['Cantero', 'Buenas noches tenga. Venimos de la cantera de la Herreria,'
        + ' arrastrando granito para las trazas del Monasterio.'],
      ['Cantero', 'Cada sillar pesa lo que tres bueyes. De dia al sol, de'
        + ' noche a la luz de las hogueras: la obra no para.'],
      ['Cantero', 'Si vas para las obras, avisa al aguador. Sin agua para'
        + ' la sed y la argamasa, aqui no se asienta ni una piedra.'],
    ],
  },
  {
    id: 'aguador',
    tipoNpc: 'aguador',
    objetivo: 'Lleva el aviso del cantero al aguador.',
    dialogo: [
      ['Aguador', 'Vengo del arroyo con los cantaros a cuestas. El camino'
        + ' real a Madrid pasa justo por donde mas pesa la cuesta.'],
      ['Aguador', '¿El cantero te manda? Dile que hoy no falta el agua.'],
      ['Aguador', 'Pero anoche, subiendo por la dehesa, oi aullar. Los lobos'
        + ' bajan cuando el frio aprieta. Sube tu mismo a ver las obras del'
        + ' Monasterio y llevale la nueva al prior.'],
    ],
  },
  {
    id: 'monasterio',
    reach: true,
    objetivo: 'Acercate a las obras del Monasterio.',
    dialogo: [
      ['', 'Los andamios trepan sobre la piedra recien puesta. A esta hora'
        + ' solo quedan los canteros de guardia y el eco de los mazos'
        + ' del dia.'],
      ['', 'Ni rastro de lobos por aqui: pero el aullido del aguador no'
        + ' era cuento. Mejor volver y avisar al cantero.'],
    ],
  },
  {
    id: 'cierre',
    tipoNpc: 'cantero',
    objetivo: 'Vuelve con el cantero y cuentale lo que viste.',
    dialogo: [
      ['Cantero', 'Con que lobos en la dehesa... no seria la primera vez'
        + ' que bajan hasta las majadas en una noche sin luna.'],
      ['Cantero', 'Se lo dire al capataz al alba. Tu ya has hecho mas de lo'
        + ' que se le pide a un caminante. Que San Lorenzo te guarde.'],
    ],
  },
];

export class Misiones {
  constructor(world, vida, lugares) {
    this.world = world;
    this.vida = vida;
    this.lugares = lugares;

    this.paso = 0;              // indice en QUESTS; QUESTS.length = mision terminada
    this.cerca = null;          // npc mas cercano este fotograma, o null
    this.dialogo = null;        // { lineas, i } mientras hay bocadillo abierto
    this.pendienteAvance = false;
    this.veces = new Map();     // id del vecino -> conversaciones tenidas
    this.hora = 12;             // la pone main.js desde el ciclo de dia y noche

    // El Monasterio lo localiza lugares.js con el mismo criterio (la huella
    // mayor). Antes se recalculaba aqui una segunda vez, palabra por palabra.
    const m = lugares && lugares.monasterio;
    this.monasterioPos = m ? [m.x, m.z] : [world.data.size_m[0] / 2,
      world.data.size_m[1] / 2];
  }

  update(dt, player) {
    this.cerca = null;
    if (this.dialogo) return;   // con el dialogo abierto no hace falta buscar mas

    // El paso "reach" se resuelve solo, pero eso ya no impide seguir buscando
    // con quien hablar: por el camino al Monasterio hay gente.
    const q = QUESTS[this.paso];
    if (q && q.reach) this._comprobarLlegada(player);
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
    const q = QUESTS[this.paso];
    return {
      hora: this.hora,
      paso: this.paso,
      veces: this.veces.get(npc.id) || 0,
      lugares: this.lugares,
      world: this.world,
      oficioBuscado: q && !q.reach ? q.tipoNpc : null,
      buscarOficio: (of, pos) => (this.vida.buscarOficio
        ? this.vida.buscarOficio(of, pos) : null),
    };
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

    const q = QUESTS[this.paso];
    // Si es justo a quien busca la mision, manda el guion escrito.
    if (q && !q.reach && coincideTipo(this.cerca, q.tipoNpc)) {
      this._contar(this.cerca);
      this._abrir(q.dialogo, true);
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
    const q = QUESTS[this.paso];
    if (!q || !q.reach || this.dialogo) return;
    const dx = player.pos.x - this.monasterioPos[0];
    const dz = player.pos.z - this.monasterioPos[1];
    if (dx * dx + dz * dz <= REACH_RANGE * REACH_RANGE) {
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
    const q = QUESTS[this.paso];
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
    const q = QUESTS[this.paso];
    const esObjetivo = q && !q.reach && coincideTipo(this.cerca, q.tipoNpc);
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

// npcs.js devuelve `tipo: 'vecino'` para TODOS los vecinos y guarda el oficio en
// el nombre ("Cantero", "Aguador"). Mirar solo `tipo` no encontraria nunca al
// cantero y la cadena de misiones no arrancaria, asi que se buscan los dos
// campos -y `role`, por si alguna version lo expone- antes de decidir.
function coincideTipo(npc, esperado) {
  if (!npc || !esperado) return false;
  const heno = `${npc.tipo || ''} ${npc.nombre || ''} ${npc.role || ''}`.toLowerCase();
  return heno.includes(esperado);
}

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
