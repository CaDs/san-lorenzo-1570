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

import { tocaCampana } from './ambiente.js';

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

export class Sonido {
  constructor({ world, lugares, cielo }) {
    this.world = world;
    this.lugares = lugares;
    this.cielo = cielo;
    this.ctx = null;
    this.on = true;
    this.vol = 0.7;
    this.estado = 'sin arrancar';
    this.horaAntes = cielo.hour;
    this.ultima = null;              // que hora del oficio sono la ultima vez
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
