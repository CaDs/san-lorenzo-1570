// El grafo de audio. Lo unico de todo el proyecto que toca Web Audio: la
// decision de QUE suena vive en ambiente.js, que es puro y tiene su test.
//
// Cero ficheros de audio, por lo mismo que no hay ni una textura: todo se
// sintetiza. Una campana de bronce son ocho osciladores y una envolvente.
//
// El AudioContext se crea DENTRO del clic de la portada y no antes. Fuera de un
// gesto del usuario el navegador lo devuelve suspendido y no arranca nunca, y
// eso se presenta como "el codigo corre, no da error y no suena", que es el peor
// fallo posible de diagnosticar.

import { tocaCampana, mezclar, pulsoGrillo } from './ambiente.js';

// Los parciales de una campana de bronce, en proporcion a la nota nominal. No
// son armonicos -1, 2, 3...- y ahi esta todo: lo que hace que una campana suene
// a campana y no a flauta es que la tercera parcial cae en una tercera MENOR
// (1,2) y no mayor, que es el "tierce" que le da el color grave y triste al que
// llaman minor-third bell. Los nombres son los de la afinacion de campanas:
//
//   hum (0,5) · prime (1) · tierce (1,2) · quint (1,5) · nominal (2)
//
// y por encima, las que se van pronto y forman el golpe.
const PARCIALES = [
  // [ratio, ganancia, segundos de caida]
  [0.50, 0.55, 9.0],    // hum: es la que queda sonando cuando ya no hay nada
  [1.00, 0.45, 6.0],
  [1.19, 0.40, 4.5],    // tierce, la tercera menor
  [1.50, 0.28, 3.2],
  [2.00, 0.34, 2.6],    // nominal, la nota que uno diria que es
  [2.55, 0.16, 1.4],
  [3.01, 0.12, 0.9],
  [4.18, 0.09, 0.5],    // el brillo del badajo, se va en medio segundo
];

// La campana grande de una iglesia de pueblo no es aguda. 196 Hz es un sol
// grave, y con el hum una octava por debajo el peso lo pone esa.
const NOTA = 196;

// Tres golpes por hora del oficio. Cuantos golpes daba cada hora en concreto no
// lo se, y no se inventa: tres son suficientes para que se oiga desde el otro
// lado del pueblo y para saber que han dado las horas, que es lo que se pide.
const GOLPES = 3;
const ENTRE_GOLPES = 2.6;

// Las capas continuas. Cada una es ruido blanco en bucle por un pasabanda: la
// frecuencia central y la Q son TODO lo que las distingue, y con eso salen desde
// el viento hasta la lluvia en la teja. Es el patron de tokyo/web/sound.js, que
// resuelve un ambiente entero en 310 lineas sin un solo fichero de audio.
//
//   [freq, Q, tope de ganancia]
const CAPAS = {
  viento: [260, 0.55, 1.0],      // grave y ancho: es aire, no silbido
  lluvia: [1400, 0.6, 1.0],      // la central se mueve con la intensidad
  teja: [2400, 1.3, 1.0],        // el agua del alero, mas aguda y mas estrecha
  ventisca: [320, 0.8, 1.0],     // en una nevada gorda lo que se oye es el aire
  bullicio: [520, 1.5, 1.0],     // voces sin palabras: banda media, sin picos
  lumbre: [2600, 2.4, 1.0],      // chisporroteo de antorcha
};

// Las de bicho no son ruido: son un tono con la amplitud modulada, que es
// literalmente como suena un estridulo. Grillo y chicharra son dos especies
// distintas y suenan distinto, no la misma con otro nombre.
//   [portadora, Q del filtro, tipo de onda]
const BICHOS = {
  grillo: [4400, 6.0, 'triangle'],     // Gryllus campestris, tardes de mayo a agosto
  chicharra: [5200, 3.0, 'sawtooth'],  // Cicada orni, mediodia de julio en la encina
};

export class Sonido {
  constructor({ world, lugares, cielo, vida }) {
    this.vida = vida;
    this.world = world;
    this.lugares = lugares;
    this.cielo = cielo;
    this.ctx = null;
    this.on = true;
    this.vol = 0.7;
    this.estado = 'sin arrancar';
    this.horaAntes = cielo.hour;
    this.ultima = null;              // que hora del oficio sono la ultima vez
    this.capas = {};
    this.bichos = {};
    this.proximo = { pajaros: 0, ganado: 0, fragua: 0, obra: 0 };
    this.g = {};                     // la ultima mezcla, para que la vea la barra
  }

  // Cuatro segundos de ruido blanco, UNO para todas las capas. Con semilla, no
  // con Math.random: asi el ambiente es el mismo en cada partida y un render
  // offline sale identico muestra a muestra, que es lo que permite comprobarlo.
  ruido() {
    if (this._ruido) return this._ruido;
    const n = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let x = 987654321;
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      d[i] = x / 2147483648 - 1;
    }
    this._ruido = buf;
    return buf;
  }

  // Fuente en bucle -> pasabanda -> ganancia -> master. Se crea UNA vez y no se
  // para nunca: lo que se mueve luego es la ganancia, que arranca en cero.
  capa(freq, Q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ruido();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = Q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start();
    return { src, bp, g };
  }

  // Un bicho: portadora por un pasabanda estrecho, y la amplitud modulada por
  // otro oscilador. La frecuencia de esa modulacion es el PULSO, y en el grillo
  // sale de la temperatura -ley de Dolbear-, no de un numero puesto a mano.
  bicho(freq, Q, tipo) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = tipo; o.frequency.value = freq;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = Q;
    // El modulador escribe SOBRE la ganancia: mod.gain marca la profundidad y el
    // valor base de am.gain el punto medio. Con base 0 el estridulo es total.
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 3;
    const prof = ctx.createGain();
    prof.gain.value = 0;
    lfo.connect(prof); prof.connect(am.gain);
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(bp); bp.connect(am); am.connect(g); g.connect(this.master);
    o.start(); lfo.start();
    return { o, bp, am, lfo, prof, g };
  }

  // Un golpe corto: mazo en la piedra, martillo en el yunque, pico de pajaro.
  // Todo lo transitorio lleva su stop(), sin excepcion.
  golpecito(freq, dur, vol, tipo = 'triangle') {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(vol, t + 0.005);
    e.gain.setTargetAtTime(0, t + 0.005, dur / 3);
    o.connect(e); e.connect(this.master);
    o.start(t); o.stop(t + dur + 0.2);
  }

  // Dentro del gesto del usuario, no antes. Ver la cabecera.
  arrancar() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.estado = 'sin audio'; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? this.vol : 0;
    this.master.connect(this.ctx.destination);

    // El campanario es el del Monasterio, no el de la parroquia: las horas del
    // oficio son las de los jeronimos, y ademas es lo que se ve y se oye desde
    // media sierra. San Bernabe queda de respaldo por si el nombre no estuviera
    // en los datos: lo que no puede pasar es que no suene desde ningun sitio.
    //
    // 45 m por encima del suelo. Las torres del Monasterio pasan de los 70, pero
    // colgar la fuente en la punta la aleja de mas y la campana se oye lejana
    // estando debajo. Esto es una altura de oido, no una medida.
    const s = this.lugares.buscar('Monasterio') || this.lugares.buscar('San Bernabe');
    this.torre = s
      ? { x: s.x, y: this.world.heightAt(s.x, s.z) + 45, z: s.z }
      : null;

    this.panCampana = this.ctx.createPanner();
    Object.assign(this.panCampana, {
      panningModel: 'equalpower',    // 'hrtf' es una convolucion por fuente y
      distanceModel: 'inverse',      // asume auriculares; esto son los altavoces
      refDistance: 40,               // del portatil
      rolloffFactor: 0.85,
      maxDistance: 3000,
    });
    this.panCampana.connect(this.master);
    if (this.torre) this.enPunto(this.panCampana, this.torre);

    for (const k in CAPAS) this.capas[k] = this.capa(CAPAS[k][0], CAPAS[k][1]);
    for (const k in BICHOS) this.bichos[k] = this.bicho(...BICHOS[k]);

    this.estado = this.ctx.state === 'running' ? 'sonando' : 'bloqueado';
    // Safari devuelve el contexto suspendido aun dentro del gesto.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => { this.estado = 'sonando'; });
    }
  }

  // La interfaz moderna es positionX.value; Safari tardo anos en tenerla y
  // durante ese tiempo solo habia setPosition(). Se prueban las dos.
  enPunto(nodo, p) {
    if (nodo.positionX) {
      nodo.positionX.value = p.x; nodo.positionY.value = p.y; nodo.positionZ.value = p.z;
    } else nodo.setPosition(p.x, p.y, p.z);
  }

  // Un golpe de campana. Los nodos se crean aqui -no hay otra forma de hacer un
  // sonido que empieza y acaba- pero TODOS llevan su stop(): un oscilador que no
  // se para no se recoge nunca, y a los diez minutos de campanadas habria miles
  // vivos. Ese es el coste de verdad de Web Audio, no el numero de capas.
  golpe(cuando, fuerza = 1) {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0.30 * fuerza;
    bus.connect(this.panCampana);

    for (const [ratio, g, caida] of PARCIALES) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = NOTA * ratio;
      const e = ctx.createGain();
      // Ataque de 4 ms: a cero clavado da un click, y con mas de una centesima
      // el golpe deja de ser un golpe y suena a que alguien sube un fader.
      e.gain.setValueAtTime(0, cuando);
      e.gain.linearRampToValueAtTime(g, cuando + 0.004);
      // Caida exponencial, que es como se va la energia de un metal. El
      // setTargetAtTime nunca llega a cero, asi que la constante de tiempo es la
      // caida partida por tres y el stop se pone al final.
      e.gain.setTargetAtTime(0, cuando + 0.004, caida / 3);
      o.connect(e); e.connect(bus);
      o.start(cuando);
      o.stop(cuando + caida + 0.3);
    }

    // El badajo: un chasquido de ruido muy corto por encima de todo. Sin el, los
    // senos solos suenan a organo; con el, a metal golpeado.
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Ruido con semilla: el mismo badajo en cada campanada y en cada partida, y
    // ademas hace que un render offline salga identico muestra a muestra.
    let x = 22222;
    for (let i = 0; i < d.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      d[i] = (x / 2147483648 - 1) * (1 - i / d.length) ** 3;
    }
    n.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = 0.10 * fuerza;
    n.connect(bp); bp.connect(ng); ng.connect(bus);
    n.start(cuando);
    n.stop(cuando + 0.06);
  }

  // Toda la hora del oficio: tres golpes espaciados, programados de una vez. Se
  // programan en el reloj del audio, no con setTimeout: un setTimeout llega
  // cuando el navegador puede, y en un fotograma largo la campanada se descoloca
  // veinte milisegundos y se oye.
  tanir() {
    const t0 = this.ctx.currentTime + 0.05;
    for (let i = 0; i < GOLPES; i++) {
      // El primer golpe es el fuerte; los siguientes, algo menos, que es como
      // suena alguien tirando de una soga y no una maquina.
      this.golpe(t0 + i * ENTRE_GOLPES, i === 0 ? 1 : 0.82 - i * 0.04);
    }
  }

  update(dt, pos, yaw) {
    if (!this.ctx || this.ctx.state !== 'running') return;

    // El oyente. La orientacion importa: sin ella la campana suena centrada
    // aunque la tengas a la espalda, y entonces el paneo no vale de nada.
    const l = this.ctx.listener;
    const f = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = f.x; l.forwardY.value = 0; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(f.x, 0, f.z, 0, 1, 0);
    }

    const hora = this.cielo.hour;
    const c = tocaCampana(this.horaAntes, hora, this.cielo.dayOfYear);
    this.horaAntes = hora;
    if (c) { this.ultima = c; this.tanir(); }

    // --- el ambiente ---------------------------------------------------------
    //
    // Lo que suena y cuanto lo decide ambiente.js, que es puro y esta probado.
    // Aqui solo se mueven ganancias, y todas con setTargetAtTime: un salto seco
    // en una ganancia se oye como un click, y la urbanidad cambia mientras andas.
    const cl = this.cielo.clima;
    const g = mezclar({
      dia: this.cielo.dayOfYear, hora,
      urbanidad: this.world.urbanidad ? this.world.urbanidad(pos.x, pos.z) : 0,
      fuera: this.vida ? this.vida.fuera : 1,
      clima: cl,
    });
    this.g = g;
    const t = this.ctx.currentTime;
    const V = this.vol;
    for (const k in this.capas) {
      this.capas[k].g.gain.setTargetAtTime(g[k] * V, t, 0.35);
    }
    // La lluvia no solo sube de volumen: sube de tono. Un chispeo es agudo y fino
    // y un aguacero es ancho y grave, y con la central quieta las dos suenan igual
    // de fuerte y ninguna suena a lluvia.
    this.capas.lluvia.bp.frequency.setTargetAtTime(2600 - 1700 * cl.lluvia, t, 0.5);

    // Los bichos. El pulso del grillo sale de la temperatura de verdad.
    const bg = { grillo: g.grillo, chicharra: g.chicharra };
    for (const k in this.bichos) {
      const b = this.bichos[k];
      b.g.gain.setTargetAtTime(bg[k] * V, t, 0.6);
      b.prof.gain.setTargetAtTime(0.5, t, 0.3);
      b.am.gain.setTargetAtTime(0.5, t, 0.3);
    }
    this.bichos.grillo.lfo.frequency.setTargetAtTime(pulsoGrillo(cl.temp), t, 1.0);
    this.bichos.chicharra.lfo.frequency.setTargetAtTime(46, t, 1.0);

    // --- lo que pasa a ratos -------------------------------------------------
    //
    // Pajaros, ganado, fragua y mazos no son capas: son sucesos. La ganancia de
    // ambiente.js se lee aqui como FRECUENCIA -mas ganancia, mas seguido- y no
    // como volumen, que es lo que hace que un pajaro suene a pajaro y no a
    // zumbido continuo. Los nodos se crean en el suceso, no en el fotograma, y
    // cada uno se para solo.
    this.suceso('pajaros', dt, g.pajaros, 0.9, () => {
      const f = 2400 + 1800 * Math.random();
      this.golpecito(f, 0.07 + Math.random() * 0.06, 0.05 + g.pajaros, 'sine');
    });
    this.suceso('ganado', dt, g.ganado, 7.0, () => {
      this.golpecito(190 + 60 * Math.random(), 0.55, 0.10 + g.ganado, 'sawtooth');
    });
    this.suceso('fragua', dt, g.fragua, 1.1, () => {
      this.golpecito(1900 + 400 * Math.random(), 0.28, 0.05 + g.fragua, 'square');
    });
    // La obra: la labra es el mazo a cubierto y el asiento la cabria y el tajo.
    // Con helada suena la primera y no la segunda, y eso se oye.
    this.suceso('obra', dt, g.labra + g.asiento, 0.7, () => {
      const asiento = Math.random() < g.asiento / Math.max(g.labra + g.asiento, 1e-6);
      this.golpecito(asiento ? 320 : 880, asiento ? 0.35 : 0.13,
        0.06 + g.labra, 'triangle');
    });
  }

  // Cuenta atras por suceso. `cada` son los segundos entre golpes con la
  // ganancia a tope; con la ganancia a cero no dispara nunca en vez de disparar
  // muy de tarde en tarde, que es lo que dejaba un mazo suelto a las tres de la
  // madrugada.
  suceso(nombre, dt, ganancia, cada, hacer) {
    if (ganancia < 0.004) { this.proximo[nombre] = 0; return; }
    this.proximo[nombre] -= dt;
    if (this.proximo[nombre] > 0) return;
    // El intervalo se sortea alrededor del que toca: a intervalo fijo, cuatro
    // pajaros seguidos suenan a metronomo.
    this.proximo[nombre] = (cada / ganancia) * (0.5 + Math.random());
    hacer();
  }

  silencio(v) {
    this.on = v;
    if (this.master) {
      this.master.gain.setTargetAtTime(v ? this.vol : 0, this.ctx.currentTime, 0.05);
    }
  }

  volumen(v) {
    this.vol = v;
    if (this.master && this.on) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }
}
