// La barra de abajo.
//
// Todo lo que hay aqui ya estaba en el juego y solo se alcanzaba con una tecla
// que habia que haber leido en la portada y recordado: [ y ] para el sol, P para
// el reloj, V para volar, E, Q y X para hablar. Y la portada se borra del DOM
// 700 ms despues de entrar, asi que a los dos minutos de partida no habia forma
// de saber que hacia la Q. Eso no es una interfaz, es una lista de curiosidades
// sobre el programa.
//
// Asi que: una barra abajo, siempre ahi, con lo que merece la pena tocar -que
// hora es, en que dia del ano estamos y que tiempo hace- y un panel de ayuda que
// ya no se va. Las teclas siguen funcionando todas y van impresas al lado de su
// mando, para que la barra las ENSENE en vez de sustituirlas.
//
// DOM sobre el lienzo y no dibujado en el HUD, por lo mismo: deslizadores, foco,
// hover y accesibilidad salen gratis aqui, y sobre un <canvas> habria que
// reinventarlos todos.

import { ESTADOS } from './clima.js';

export const BAR_H = 52;      // px; el HUD mantiene su texto por encima

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Primer dia de cada estacion, para los cuatro botones de salto. Son los mismos
// cortes que usa estacionDe() en clima.js.
const SALTOS = [['invierno', 20], ['primavera', 105], ['verano', 200], ['otono', 290]];

// Un simbolo por estado, para que la barra diga el tiempo sin leerla. Estan
// elegidos MIRANDOLOS pintados a 16 px y no por lo que significan en la tabla
// Unicode: el paraguas ☂ existe en la fuente pero a este tamano se lee como una
// flecha, asi que la lluvia lleva ☔, que se distingue.
const SIMBOLO = {
  despejado: '☀', nubes: '☁', cubierto: '☁', niebla: '≋',
  lluvia: '☔', tormenta: '☔', nieve: '❄',
};

export class Barra {
  constructor({ cielo, misiones }) {
    this.cielo = cielo;
    this.misiones = misiones;
    this.abierto = null;

    const el = document.createElement('div');
    el.id = 'bar';
    el.innerHTML = `
      <button class="chip" id="c-tiempo"><span class="ico">◐</span><span class="lbl"></span><kbd>P</kbd></button>
      <button class="chip" id="c-clima"><span class="ico" id="c-clima-ico">☁</span><span class="lbl"></span></button>
      <div class="grow"></div>
      <button class="chip" id="c-misterios"><span class="ico">✦</span><span class="lbl"></span></button>
      <button class="chip" id="c-saber"><span class="ico">✎</span><span class="lbl"></span></button>
      <button class="chip" id="c-ayuda"><span class="ico">?</span><span class="lbl">ayuda</span></button>`;
    document.body.appendChild(el);
    this.el = el;

    const paneles = document.createElement('div');
    paneles.id = 'paneles';
    document.body.appendChild(paneles);
    this.paneles = paneles;

    this._panelTiempo();
    this._panelClima();
    this._panelSaber();
    this._panelMisterios();
    this._panelAyuda();

    el.querySelector('#c-tiempo').onclick = () => this.alternar('tiempo');
    el.querySelector('#c-clima').onclick = () => this.alternar('clima');
    el.querySelector('#c-ayuda').onclick = () => this.alternar('ayuda');
    el.querySelector('#c-misterios').onclick = () => this.alternar('misterios');
    // Con cartela por leer, el chip la abre; sin ella, es el interruptor del
    // modo. Es un solo boton porque es una sola cosa: lo que se sabe del sitio.
    el.querySelector('#c-saber').onclick = () => {
      if (this.misiones.educativo && this.misiones.cartela) {
        this.alternar('saber');
        return;
      }
      this.misiones.educativo = !this.misiones.educativo;
      if (!this.misiones.educativo) this.misiones.cartela = null;
      this.cerrar();
      this.repintar();
    };

    // La barra se queda su propio teclado. Sin esto, arrastrar el deslizador de
    // la hora con las flechas tambien anda por el pueblo, y cada letra tecleada
    // dentro de un panel se cuela en el manejador de movimiento.
    for (const ev of ['keydown', 'keyup']) {
      el.addEventListener(ev, (e) => e.stopPropagation());
      paneles.addEventListener(ev, (e) => e.stopPropagation());
    }
    // Pulsar el mundo cierra lo que hubiera abierto.
    addEventListener('pointerdown', (e) => {
      if (!el.contains(e.target) && !paneles.contains(e.target)) this.cerrar();
    });
    // Con el raton capturado ningun clic llega al DOM. En vez de dejar que el
    // jugador pulse y no pase nada, la barra se apaga y lo dice: Esc lo suelta.
    document.addEventListener('pointerlockchange', () => {
      const presa = !!document.pointerLockElement;
      el.classList.toggle('presa', presa);
      if (presa) this.cerrar();
      this.repintar();
    });

    this.repintar();
  }

  // --- paneles -------------------------------------------------------------

  panel(id, html) {
    const p = document.createElement('div');
    p.className = 'panel';
    p.id = `p-${id}`;
    p.innerHTML = html;
    this.paneles.appendChild(p);
    return p;
  }

  _panelTiempo() {
    // La hora va en deslizador porque lo mejor del ciclo es arrastrarlo y ver
    // como el sol se lleva por delante las antorchas.
    this.pTiempo = this.panel('tiempo', `
      <div class="fila"><b>hora</b><span class="grande" id="t-reloj">--:--</span></div>
      <input type="range" id="t-hora" min="0" max="2399" step="1">
      <div class="fila marcas"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <div class="fila">
        <button class="mini" data-h="7.5">alba</button>
        <button class="mini" data-h="13">mediodia</button>
        <button class="mini" data-h="18.5">ocaso</button>
        <button class="mini" data-h="22">noche</button></div>
      <div class="fila"><button class="mini" id="t-correr"></button></div>
      <div class="fila"><b>dia del ano</b><span id="t-fecha"></span></div>
      <input type="range" id="t-dia" min="1" max="365" step="1">
      <div class="fila" id="t-estaciones"></div>
      <div class="nota">El sol sale y se pone donde toca para esta latitud y este
        dia: nueve horas de luz en enero y quince en junio.</div>`);

    this.elHora = this.pTiempo.querySelector('#t-hora');
    this.elHora.oninput = () => {
      this.cielo.hour = this.elHora.value / 100;
      this.cielo.paused = true;
      this.cielo.apply();
      this.repintar();
    };
    this.elDia = this.pTiempo.querySelector('#t-dia');
    this.elDia.oninput = () => {
      this.cielo.dayOfYear = +this.elDia.value;
      this.cielo.apply();
      this.repintar();
    };
    this.pTiempo.querySelector('#t-correr').onclick = () => {
      this.cielo.paused = !this.cielo.paused;
      this.repintar();
    };
    for (const b of this.pTiempo.querySelectorAll('[data-h]')) {
      b.onclick = () => {
        this.cielo.hour = +b.dataset.h;
        this.cielo.paused = true;
        this.cielo.apply();
        this.repintar();
      };
    }
    // Saltos de estacion: el deslizador de 365 posiciones vale para afinar, pero
    // "quiero ver esto nevado" tiene que ser un boton, no puntería.
    const est = this.pTiempo.querySelector('#t-estaciones');
    est.innerHTML = SALTOS
      .map(([n, d]) => `<button class="mini" data-dia="${d}">${n}</button>`).join('');
    for (const b of est.querySelectorAll('[data-dia]')) {
      b.onclick = () => {
        this.cielo.dayOfYear = +b.dataset.dia;
        this.cielo.apply();
        this.repintar();
      };
    }
  }

  _panelClima() {
    // Automatico primero y luego los siete estados en orden de cuanta agua
    // llevan, para que la rejilla se lea como un dial de raso a nevada.
    const botones = ['auto', ...ESTADOS.map((e) => e.key)]
      .map((k) => `<button class="mini" data-clima="${k}" id="w-${k}">${
        k === 'auto' ? 'automatico' : ESTADOS.find((e) => e.key === k).nombre
      }</button>`).join('');
    this.pClima = this.panel('clima', `
      <div class="fila"><b>tiempo</b><span id="w-modo"></span></div>
      <div class="rejilla">${botones}</div>
      <div class="nota" id="w-nota"></div>`);
    for (const b of this.pClima.querySelectorAll('[data-clima]')) {
      b.onclick = () => {
        this.cielo.climaForzado = b.dataset.clima === 'auto' ? null : b.dataset.clima;
        this.cielo.apply();
        this.repintar();
      };
    }
  }

  // La cartela, aqui y no plantada sobre el juego. Un panel se abre porque lo
  // abres tu, se lee entero y se cierra: un cartel que aparece solo y tapa un
  // tercio de la pantalla mientras andas es lo contrario de eso.
  _panelSaber() {
    this.pSaber = this.panel('saber', `
      <div class="fila"><b id="k-titulo"></b></div>
      <div id="k-texto"></div>
      <div class="nota" id="k-fuente"></div>
      <div class="fila"><button class="mini" id="k-visto">ya lo he leido</button></div>`);
    this.pSaber.querySelector('#k-visto').onclick = () => {
      this.misiones.cartelaLeida();
      this.cerrar();
      this.repintar();
    };
  }

  // Los 25. Los encontrados con su nombre y su texto; los que faltan, como
  // renglon en blanco con la pista, que es lo que hace que la lista pique en vez
  // de ser un marcador. Nada de senalarlos en el minimapa: entonces no son
  // misterios, son recados con chincheta.
  _panelMisterios() {
    this.pMisterios = this.panel('misterios', `
      <div class="fila"><b>misterios</b><span id="x-cuenta"></span></div>
      <div id="x-recien"></div>
      <div id="x-lista" class="lista"></div>`);
  }

  _panelAyuda() {
    // Esto es la razon numero uno de que exista la barra: la lista de teclas
    // estaba solo en la portada, y la portada se va.
    this.panel('ayuda', `
      <div class="fila"><b>teclas</b></div>
      <div><kbd>WASD</kbd> andar · <kbd>Mayus</kbd> correr · <kbd>espacio</kbd> saltar</div>
      <div><kbd>raton</kbd> mirar · <kbd>Esc</kbd> soltar el raton</div>
      <div><kbd>E</kbd> hablar con quien tengas al lado, y seguir la conversacion</div>
      <div><kbd>Q</kbd> preguntarle el camino al encargo que lleves</div>
      <div><kbd>X</kbd> dejar la conversacion. Alejarse andando tambien la corta</div>
      <div><kbd>[</kbd> <kbd>]</kbd> mover el sol una hora · <kbd>P</kbd> parar el reloj</div>
      <div><kbd>V</kbd> vuelo libre: <kbd>W</kbd> <kbd>S</kbd> avanzar ·
        <kbd>A</kbd> ladear · <kbd>E</kbd> subir · <kbd>D</kbd> bajar</div>
      <div class="fila"><b>saber</b></div>
      <div>Con <b>✎ saber</b> puesto, los vecinos cuentan lo que su oficio puede
        saber estando aqui en 1570, y en los sitios saltan cartelas con el dato
        historico y su fuente. <kbd>X</kbd> retira la cartela.</div>
      <div class="nota">Para tocar esta barra hace falta soltar el raton con
        <kbd>Esc</kbd>. Los encargos no se acaban: cuando cierras uno te dan otro.</div>`);
  }

  // --- abrir y cerrar --------------------------------------------------------

  alternar(id) {
    const antes = this.abierto;
    this.cerrar();
    if (antes === id) return;
    this.abierto = id;
    const p = this.paneles.querySelector(`#p-${id}`);
    p.classList.add('on');
    const chip = this.el.querySelector(`#c-${id}`);
    chip.classList.add('active');
    // Anclado bajo el chip que lo abrio, y metido dentro de la ventana para que
    // uno abierto desde la derecha no se salga por el borde.
    const r = chip.getBoundingClientRect();
    p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8))}px`;
    this.repintar();
  }

  cerrar() {
    this.abierto = null;
    for (const p of this.paneles.querySelectorAll('.panel')) p.classList.remove('on');
    for (const c of this.el.querySelectorAll('.chip')) c.classList.remove('active');
  }

  verEn(on) {
    this.el.classList.toggle('on', on);
    if (!on) this.cerrar();
  }

  // --- etiquetas ---------------------------------------------------------------
  //
  // Todo lo visible se vuelve a leer del estado vivo, asi que una sola llamada
  // arregla tanto un valor que ha cambiado solo como uno que se acaba de tocar.
  repintar() {
    const c = this.cielo;
    const hh = Math.floor(c.hour);
    const mm = Math.floor((c.hour - hh) * 60);
    const reloj = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const fecha = fechaDe(c.dayOfYear);
    const clima = c.clima || { nombre: '—' };

    const q = (s) => this.el.querySelector(s);
    q('#c-tiempo .lbl').textContent = `${reloj}  ·  ${fecha}`;
    q('#c-clima .lbl').textContent = clima.nombre;
    q('#c-clima-ico').textContent = SIMBOLO[clima.estado] || '☁';
    const saber = this.misiones && this.misiones.educativo;
    const cartela = saber && this.misiones.cartela;
    // Con cartela por leer el chip lo dice, y ese es todo el aviso que hace
    // falta: el HUD ya pone una linea con el titulo abajo a la izquierda.
    q('#c-saber .lbl').textContent = cartela ? 'cartela' : (saber ? 'saber: si' : 'saber: no');
    q('#c-saber').classList.toggle('active', !!saber);
    if (cartela) {
      const P2 = (x) => this.paneles.querySelector(x);
      P2('#k-titulo').textContent = cartela.titulo;
      P2('#k-texto').textContent = cartela.texto;
      P2('#k-fuente').textContent = `Fuente: ${cartela.fuente}`;
    }

    const P = (s) => this.paneles.querySelector(s);
    P('#t-reloj').textContent = reloj;
    P('#t-correr').textContent = c.paused ? 'reanudar el reloj' : 'parar el reloj';
    P('#t-fecha').textContent = fecha;
    // Mientras se arrastra un deslizador no se le pisa el valor, o da tirones.
    if (document.activeElement !== this.elHora) {
      this.elHora.value = Math.round(c.hour * 100);
    }
    if (document.activeElement !== this.elDia) this.elDia.value = c.dayOfYear;
    for (const b of this.pTiempo.querySelectorAll('[data-dia]')) {
      b.classList.toggle('on', clima.estacion === b.textContent);
    }

    const M = this.misiones;
    if (M) {
      const total = M.misterios.length;
      q('#c-misterios .lbl').textContent = `${M.hallados.size}/${total}`;
      q('#c-misterios').classList.toggle('active', !!M.recien);
      const P3 = (x) => this.paneles.querySelector(x);
      P3('#x-cuenta').textContent = `${M.hallados.size} de ${total}`;
      P3('#x-recien').innerHTML = M.recien
        ? `<div class="hallado"><b>${M.recien.nombre}</b><div>${M.recien.texto}</div></div>`
        : '';
      P3('#x-lista').innerHTML = M.misterios.map((m) => (M.hallados.has(m.id)
        ? `<div class="visto">✦ ${m.nombre}</div>`
        : `<div class="porver">· ${m.pista}</div>`)).join('');
    }

    P('#w-modo').textContent = c.climaForzado ? 'impuesto' : 'automatico';
    P('#w-nota').textContent = c.climaForzado
      ? 'Fijado a mano. Vuelve a automatico para que lo decida la estacion.'
      : `Lo sortea la epoca del ano con los datos de la sierra: en ${fecha
        .replace(/^\d+ de /, '')} manda esto.`;
    for (const b of this.pClima.querySelectorAll('[data-clima]')) {
      const on = b.dataset.clima === 'auto'
        ? !c.climaForzado
        : c.climaForzado === b.dataset.clima;
      b.classList.toggle('on', on);
    }
  }

  // Una vez cada medio segundo sobra: lo unico que se mueve solo es el reloj.
  tic() { if (this.el.classList.contains('on')) this.repintar(); }
}

// El dia del ano como fecha de verdad. "15 de enero" dice por que hay nieve;
// "dia 15" no dice absolutamente nada.
function fechaDe(dia) {
  let d = Math.max(1, Math.min(365, Math.round(dia)));
  for (let m = 0; m < 12; m++) {
    if (d <= DIAS_MES[m]) return `${d} de ${MESES[m]}`;
    d -= DIAS_MES[m];
  }
  return `31 de diciembre`;
}
