import { hablar, indicaciones } from './dialogos.js';
import { siguienteEncargo } from './tramas.js';
import { BAR_H } from './ui.js';
import { CARTELAS } from './historia.js';
import { repartir } from './misterios.js';

// Misiones y dialogos: capa fina sobre npcs.js, dialogos.js y world.js.
// Se dibuja en el mismo canvas 2D que el minimapa (minimap.js), mismo pergamino
// y tinta, para que HUD y minimapa lean como una sola pieza.
//
// Nada de THREE aqui: solo se necesitan distancias 2D (x,z), que se sacan a
// mano de player.pos sin arrastrar la dependencia.

const TALK_RANGE = 4.0;      // metros para que aparezca el aviso "E - hablar"
const DROP_RANGE = 9.0;      // metros a los que se corta una conversacion andando
// Un misterio de objeto se ve desde algo mas lejos que a quien se le habla: son
// cosas del paisaje -un sillar, un pilon, un carro-, no gente con la que hay que
// ponerse al lado.
const MISTERIO_RANGE = 7.0;
// A 10px monospace un caracter mide 6 px de ancho. Se usa solo como respaldo:
// lo normal es medirlo, que hay monoespaciadas mas anchas y mas estrechas.
const CHAR_W = 0.6;

const PARCHMENT = 'rgba(41, 33, 22, 0.92)';
const INK_FRAME = 'rgb(153, 128, 77)';
const INK_TEXT = 'rgb(214, 196, 158)';
const INK_NAME = 'rgb(255, 217, 102)';
const INK_DIM = 'rgb(153, 128, 77)';

export class Misiones {
  // `semilla` y `origen` (donde aparece el jugador) son lo que necesita el
  // generador de tramas.js.
  constructor(world, vida, lugares, semilla = 1, origen = null, clima = null) {
    this.world = world;
    this.vida = vida;
    this.lugares = lugares;
    this.semilla = semilla >>> 0 || 1;
    // Punto desde el que se miden los destinos. Se queda fijo en donde aparece
    // el jugador, y no se mueve con el, porque medir desde donde este ahora
    // haria que el encargo dependiera de por donde has andado y ?seed= dejaria
    // de repetir la partida. Con 69 sitios repartidos en 3,6 km da igual.
    this.origen = origen || { x: world.data.size_m[0] / 2,
      z: world.data.size_m[1] / 2 };

    this.pasos = [];            // pasos de todos los encargos, en fila
    this.nEncargo = 0;          // cuantos se han pedido ya al generador
    this.agotado = false;       // el generador no da mas: no insistir cada frame
    this.paso = 0;              // indice en this.pasos
    this.cerca = null;          // npc mas cercano este fotograma, o null
    this.dialogo = null;        // { lineas, i } mientras hay bocadillo abierto
    this.pendienteAvance = false;
    this.veces = new Map();     // id del vecino -> conversaciones tenidas
    // "encargo:rol" -> { id, nombre } del vecino que resolvio ese hueco. Es lo
    // que hace que volver sea volver CON ALGUIEN.
    this.quien = new Map();
    this.hora = 12;             // la pone main.js desde el ciclo de dia y noche
    // Idem, pero llega ya puesto: el primer encargo se arma aqui abajo, y sin
    // esto una partida que empieza nevando no podria traer el encargo de la nieve.
    this.clima = clima;
    this.educativo = false;     // lo enciende la barra
    this.cartela = null;        // la que toque por donde estas, o null
    this.cartelasVistas = new Set();

    // Los 25 misterios. No son encargos y no dan ninguno: estan puestos por el
    // pueblo y se encuentran o no se encuentran.
    this.misterios = repartir(this.semilla, lugares, vida);
    this.hallados = new Set();
    this.misterio = null;       // el que tienes al lado sin encontrar, o null
    this.recien = null;         // el que acabas de encontrar, para ensenarlo

    this._masEncargos();
  }

  // El misterio que tienes al lado y no has encontrado. Los de objeto por
  // cercania; los de persona, cuando el vecino que tienes delante es el suyo.
  _buscarMisterio(player) {
    let cerca = null, mejor = MISTERIO_RANGE * MISTERIO_RANGE;
    for (const m of this.misterios) {
      if (this.hallados.has(m.id)) continue;
      // El de persona no se "encuentra" andando: hay que hablarle. Si se
      // resolviera por cercania, cruzarse con el en la calle bastaria y no
      // habria nada que hacer.
      if (m.tipo === 'persona') continue;
      const dx = player.pos.x - m.x, dz = player.pos.z - m.z;
      const d = dx * dx + dz * dz;
      if (d < mejor) { mejor = d; cerca = m; }
    }
    return cerca;
  }

  // Da uno por encontrado y lo deja listo para ensenarlo en la barra.
  hallar(m) {
    if (!m || this.hallados.has(m.id)) return false;
    this.hallados.add(m.id);
    this.recien = m;
    this.misterio = null;
    console.log(`misterios: ${this.hallados.size}/${this.misterios.length} - ${m.nombre}`);
    return true;
  }

  // Lo llama la barra al cerrar la ficha del recien encontrado.
  misterioLeido() { this.recien = null; }

  // Las cartelas se resuelven una vez, no cada fotograma: `lugares.buscar` es un
  // barrido sobre los sitios con nombre y esto se llamaria sesenta veces por
  // segundo para nada.
  _sitiosCartela() {
    if (this._cartelaSitios) return this._cartelaSitios;
    this._cartelaSitios = CARTELAS.map((c) => ({
      cartela: c,
      sitio: c.sitio && this.lugares.buscar ? this.lugares.buscar(c.sitio) : null,
    }));
    return this._cartelaSitios;
  }

  // Da la cartela por leida. La llama la barra al cerrarla, no una tecla: si la
  // has abierto, la has visto.
  cartelaLeida() {
    if (!this.cartela) return;
    this.cartelasVistas.add(this.cartela.id);
    this.cartela = null;
  }

  // La cartela de donde estas. Se busca la primera sin ver, para que acercarse
  // al Monasterio no muestre siempre la misma de las seis que hay puestas ahi.
  _buscarCartela(player) {
    if (!this.educativo) return null;
    let suelta = null;
    for (const { cartela, sitio } of this._sitiosCartela()) {
      if (!sitio) {
        // Sin sitio: sale una vez, en cuanto se enciende el modo.
        if (!suelta && !this.cartelasVistas.has(cartela.id)) suelta = cartela;
        continue;
      }
      const dx = player.pos.x - sitio.x, dz = player.pos.z - sitio.z;
      const r = Math.min(140, Math.max(45, Math.sqrt(sitio.area || 900)));
      if (dx * dx + dz * dz > r * r) continue;
      if (!this.cartelasVistas.has(cartela.id)) return cartela;
    }
    return suelta;
  }

  // El paso en curso, o undefined si ya no queda nada por hacer.
  get actual() { return this.pasos[this.paso]; }

  // Un encargo mas al final de la fila. Se llama al arrancar y cada vez que se
  // acaba el anterior, asi que los encargos no se terminan: el numero de encargo
  // sube y la semilla de cada uno sale de mezcla(semilla, n), que es determinista.
  //
  // La fila no se poda. Son ~200 bytes por paso: una sesion de doscientos
  // encargos son unos cientos de KB, y guardarlos entera deja el historial
  // completo por si algun dia se quiere enseñar.
  _masEncargos() {
    if (this.agotado) return;
    const ultimo = this.pasos[this.pasos.length - 1];
    // El tiempo que hace entra en el generador: hay temas que solo salen con
    // nieve, con helada o en verano. Y por eso ?seed= ya no reproduce la ristra
    // entera, solo los mismos candidatos: cual sale depende de cuando cierres el
    // anterior. La promesa buena es "misma semilla y misma epoca, mismo encargo".
    const e = siguienteEncargo(this.semilla, this.nEncargo, this.lugares,
      this.vida, this.origen, (ultimo && ultimo.oficio) || null, this.clima);
    if (!e) { this.agotado = true; return; }
    this.nEncargo++;
    this.pasos.push(...e);
    console.log(`misiones: encargo ${this.nEncargo} (semilla ${this.semilla})`,
      e.map((p) => p.objetivo));
  }

  update(dt, player) {
    this.cerca = null;
    // Se pide el siguiente cuando se ha agotado la fila, no antes: generarlo
    // tarde es lo que permite que no se acaben nunca.
    if (this.paso >= this.pasos.length) this._masEncargos();
    // Andarse lejos deja la conversacion. Antes el dialogo seguia abierto pasara
    // lo que pasara: se podia cruzar el pueblo entero leyendo lo que decia un
    // aguador que habia quedado a doscientos metros.
    if (this.dialogo) {
      this._comprobarDistancia(player);
      if (this.dialogo) return;   // sigue abierto: no hace falta buscar mas
    }

    // El paso "reach" se resuelve solo, pero eso ya no impide seguir buscando
    // con quien hablar: por el camino al sitio hay gente.
    if (this.actual && this.actual.reach) this._comprobarLlegada(player);
    if (this.dialogo) return;

    // La cartela del sitio, si el modo educativo esta puesto. Va despues del
    // dialogo para que no tape un bocadillo abierto.
    this.cartela = this._buscarCartela(player);
    this.misterio = this._buscarMisterio(player);

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
      // El sitio al que manda el paso, si el paso es llegar a un sitio. Sin
      // esto, preguntar el camino durante el unico paso que es camino contestaba
      // con el Monasterio y un sitio al azar, teniendo el objetivo en pantalla.
      destino: (q && q.reach) || null,
      atado: this._atado(q),
      educativo: this.educativo,
      buscarOficio: (of, pos) => (this.vida.buscarOficio
        ? this.vida.buscarOficio(of, pos) : null),
      buscarId: (id) => (this.vida.buscarId ? this.vida.buscarId(id) : null),
    };
  }

  // Hueco de un paso: el mismo par (encargo, rol) lo resuelve la misma persona.
  _clave(q) { return `${q.encargo}:${q.rol}`; }

  // A quien espera el paso en curso, si ya se sabe: { id, nombre }, o null si
  // todavia vale cualquiera de ese oficio.
  _atado(q) {
    return (q && q.rol) ? this.quien.get(this._clave(q)) || null : null;
  }

  // Si este vecino es justo el que espera el paso en curso.
  //
  // Con el oficio no basta: hay 220 vecinos y ocho oficios, o sea unos 27 de
  // cada uno andando por la calle. "Vuelve con el cantero" lo cerraba el primer
  // cantero con el que te cruzaras, que casi nunca era el que te lo encargo, y
  // asi el viaje que arma el generador -sitios lejanos, distancias minimas- lo
  // resolvia la estadistica de sombreros. Desde que se apunta QUIEN resolvio el
  // hueco, el paso que cierra pide a esa persona.
  _esObjetivo(npc) {
    const q = this.actual;
    if (!q || !q.oficio || !npc || npc.oficio !== q.oficio) return false;
    const atado = this._atado(q);
    return !atado || atado.id === npc.id;
  }

  // `npc` es con quien se habla, si es con alguien: la ficha de npcs.js trae la
  // posicion VIVA del vecino, asi que sirve para saber si te has ido -o si se ha
  // ido el-, sin copiar coordenadas que envejecen.
  _abrir(lineas, avanza = false, npc = null) {
    if (!lineas || !lineas.length) return;
    this.dialogo = { lineas, i: 0, npc };
    this.pendienteAvance = avanza;
  }

  // Se corta la conversacion sin darla por hecha: te has ido a media frase, asi
  // que el paso de la mision sigue pendiente y se puede volver a hablar.
  _comprobarDistancia(player) {
    const npc = this.dialogo.npc;
    if (!npc || !npc.pos) return;
    const dx = player.pos.x - npc.pos.x, dz = player.pos.z - npc.pos.z;
    if (dx * dx + dz * dz > DROP_RANGE * DROP_RANGE) {
      this.dialogo = null;
      this.pendienteAvance = false;
    }
  }

  // X: dejar la conversacion. Al contrario que irse andando, esto SI la da por
  // hecha si era la de la mision: es "ya lo he leido, sigamos", no "me voy". Y
  // ademas hace falta que cuente, porque la narracion de llegar a un sitio se
  // vuelve a abrir sola mientras sigas dentro del radio: cancelarla sin avanzar
  // seria un bucle en el que la tecla no hace nada.
  saltar() {
    if (!this.dialogo) return;
    this.dialogo = null;
    if (this.pendienteAvance) { this.paso++; this.pendienteAvance = false; }
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
    // Examinar lo que tengas al lado. Va DESPUES del dialogo abierto y ANTES de
    // buscar con quien hablar: si hay un vecino delante manda el vecino, que
    // hablar con alguien es mas urgente que mirar una piedra.
    if (!this.cerca && this.misterio) {
      const m = this.misterio;
      if (this.hallar(m)) {
        this._abrir([['', m.texto]], false, null);
        return;
      }
    }
    if (!this.cerca) return;

    // Si este vecino guarda uno de los 25, lo suelta lo PRIMERO, antes incluso
    // que el encargo. Al reves no vale: si ademas es a quien te manda el encargo
    // -que pasa a menudo, porque los dos salen del mismo vecindario-, la rama
    // del encargo se lo comia y el misterio no aparecia hasta que volvieras a
    // hablarle por casualidad. Asi no se pierde nada: el paso del encargo no
    // avanza y sigue ahi para la siguiente pulsacion.
    const suyo = this.misterios.find(
      (m) => m.tipo === 'persona' && m.npcId === this.cerca.id
        && !this.hallados.has(m.id));
    if (suyo) {
      this._contar(this.cerca);
      this.hallar(suyo);
      this._abrir([[this.cerca.nombre, suyo.texto]], false, this.cerca);
      return;
    }

    // Si es justo a quien busca la mision, manda el guion del encargo. Y se
    // apunta quien fue: el paso que cierre este mismo hueco le buscara a el.
    if (this._esObjetivo(this.cerca)) {
      const q = this.actual;
      if (q.rol && !this.quien.has(this._clave(q))) {
        this.quien.set(this._clave(q),
          { id: this.cerca.id, nombre: this.cerca.nombre });
      }
      this._contar(this.cerca);
      this._abrir(q.dialogo, true, this.cerca);
      return;
    }
    // Si no, charla procedural. Un pueblo de 220 vecinos mudos no es un pueblo.
    this._contar(this.cerca);
    this._abrir(hablar(this.cerca, this._ctx(this.cerca)), false, this.cerca);
  }

  // Q: pedir el camino. Funciona con cualquier vecino y, si hay mision viva,
  // orienta hacia ella.
  indicaciones() {
    if (this.dialogo || !this.cerca) return;
    this._contar(this.cerca);
    this._abrir(indicaciones(this.cerca, this._ctx(this.cerca)), false, this.cerca);
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
    // La barra de mandos ocupa los ultimos BAR_H pixeles de la VENTANA, y este
    // lienzo esta escalado: se convierte a coordenadas de lienzo antes de
    // restarlo. Sin esto el objetivo y el bocadillo se pintan detras de la barra
    // y no se leen, que es donde llevaban toda la vida pintandose.
    const alto = H - Math.round(BAR_H * (H / (innerHeight || H)));
    // El objetivo va abajo del todo, justo donde se planta el bocadillo: con el
    // dialogo abierto se veia el texto medio tapado por el marco.
    if (this.dialogo) this._pintarDialogo(ctx, W, alto, k);
    else this._pintarAviso(ctx, W, alto, k, this._pintarObjetivo(ctx, W, alto, k));
  }


  // El objetivo en palabras. En cuanto se sabe QUIEN resolvio el hueco, se le
  // llama por su nombre: "vuelve con el cantero" no vale de nada con 27
  // canteros por la calle, "vuelve con Anton el cantero" si. Al fraile no se le
  // repite el oficio, que ya lo lleva delante del nombre.
  _textoObjetivo() {
    const q = this.actual;
    if (!q) return this.agotado ? 'Sin mas encargos por esta noche.'
      : 'Preguntando por el pueblo a ver que hace falta...';
    const at = this._atado(q);
    if (!at) return q.objetivo;
    const nombre = at.nombre.startsWith('fray ') ? at.nombre
      : `${at.nombre} ${q.quien}`;
    return q.objetivo.replace(q.quien, nombre);
  }

  // Devuelve la altura que ha ocupado, para que el aviso se plante encima y no
  // debajo de un objetivo de dos lineas.
  //
  // Los objetivos ya no estan escritos a mano: los arma tramas.js con el nombre
  // real del sitio, y "Busca al pescadero: dicen que el viernes hay que dar de
  // comer a toda la obra" se salia por la derecha de la ventana. Se parte por
  // palabras a lo que quepa DE VERDAD, medido, no a 46 caracteres a ojo.
  _pintarObjetivo(ctx, W, H, k) {
    ctx.font = `${10 * k}px monospace`;
    const ancho = cabenChars(ctx, W - 16 * k, k);
    const lineas = envolver(this._textoObjetivo(), ancho);
    // Si hay cartela por leer, se anuncia en UNA linea y se lee donde se leen
    // las cosas largas: en la barra. Antes se plantaba el texto entero en un
    // panelon que tapaba un tercio de la pantalla y salia sin pedirlo, que es
    // justo lo contrario de lo que quiere alguien que esta andando.
    const desdeCartela = lineas.length;
    if (this.cartela) {
      lineas.push(...envolver(`✎ cartela: ${this.cartela.titulo}`, ancho));
    }
    // El misterio no se anuncia por su nombre: eso lo resolveria de lejos. Solo
    // se dice que ahi hay algo, y el nombre se sabe al examinarlo.
    if (this.misterio && !this.cerca) {
      lineas.push(...envolver('✦ aqui hay algo   ·   E examinarlo', ancho));
    }
    lineas.forEach((linea, i) => {
      ctx.fillStyle = i >= desdeCartela ? INK_NAME : INK_DIM;
      ctx.fillText(linea, 8 * k, H - 8 * k - (lineas.length - 1 - i) * 12 * k);
    });
    return lineas.length * 12 * k;
  }

  // El aviso sale con CUALQUIERA que tengas al lado. Antes solo aparecia con el
  // objetivo de la mision, asi que 219 de los 220 vecinos parecian decorado.
  _pintarAviso(ctx, W, H, k, alto) {
    if (!this.cerca) return;
    const nombre = this.cerca.nombre || this.cerca.tipo || 'alguien';
    const esObjetivo = this._esObjetivo(this.cerca);
    const esVecino = this.cerca.tipo === 'vecino';

    ctx.font = `${10 * k}px monospace`;
    ctx.textAlign = 'center';
    // Al que busca la mision se le marca en dorado; al resto, en tinta apagada.
    ctx.fillStyle = esObjetivo ? INK_NAME : INK_DIM;
    // El oficio va junto al nombre: desde que los vecinos se llaman de alguna
    // manera, "hablar con Anton" ya no dice si es el cantero que buscas. Al
    // fraile no, que ya lo lleva delante del nombre.
    const quien = esVecino && !nombre.startsWith('fray ')
      ? `${nombre}, ${this.cerca.oficio}` : nombre;
    const aviso = esVecino
      ? `E hablar con ${quien}${esObjetivo ? ' *' : ''}   ·   Q preguntar el camino`
      : `E - mirar ${nombre.toLowerCase()}`;
    // En una ventana estrecha este aviso tampoco cabe de una pieza: mismo trato.
    const lineas = envolver(aviso, cabenChars(ctx, W - 16 * k, k));
    lineas.forEach((linea, i) => {
      ctx.fillText(linea, W * 0.5,
        H - 16 * k - alto - (lineas.length - 1 - i) * 12 * k);
    });
    ctx.textAlign = 'left';
  }

  _pintarDialogo(ctx, W, H, k) {
    const { lineas, i } = this.dialogo;
    const [nombre, texto] = lineas[i];
    ctx.font = `${10 * k}px monospace`;
    // El ancho del bocadillo manda sobre el corte de linea, y no al contrario:
    // con la ventana estrecha el marco se encogia y el texto seguia a 46
    // caracteres, saliendose por los dos lados.
    const boxW = Math.min(W - 24 * k, 420 * k);
    const envueltas = envolver(texto, cabenChars(ctx, boxW - 20 * k, k));

    const boxH = (20 + envueltas.length * 12 + 12) * k;
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
    // Las dos teclas, a la derecha del marco. Antes solo se anunciaba "E seguir",
    // asi que no habia forma de saber que se podia dejar a medias.
    ctx.fillStyle = INK_DIM;
    ctx.textAlign = 'right';
    ctx.fillText('E seguir  ·  X dejarlo', x0 + boxW - 10 * k, y0 + boxH - 6 * k);
    ctx.textAlign = 'left';
  }
}

// --- ayudantes ----------------------------------------------------------------

// Cuantos caracteres caben en `px`. Se mide, porque "monospace" es la que haya
// puesto el sistema y no todas tienen el mismo paso; si la fuente no esta lista
// todavia, measureText devuelve 0 y se cae al ancho nominal en vez de a NaN.
function cabenChars(ctx, px, k) {
  const w = ctx.measureText('0123456789').width / 10 || CHAR_W * 10 * k;
  return Math.max(8, Math.floor(px / w));
}

// Envuelve `texto` a lineas de como mucho `max` caracteres, partiendo por
// palabras.
function envolver(texto, max) {
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
