import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, vuela } from './world.js';
import { DayNight } from './daynight.js';
import { Sonido } from './sonido.js';
import { Barra } from './ui.js';
import { Player } from './player.js';
import { Minimap } from './minimap.js';
import { Vida } from './npcs.js';
import { Misiones } from './quests.js';
import { Lugares } from './lugares.js';

// Pixel art, pero fino. Antes el lienzo era 480x270 fijo y el navegador lo
// estiraba: a pantalla completa cada pixel salia del tamano de una uña y todo
// se leia a bloques. Ahora se elige un factor ENTERO de escala para acercarse a
// ALTO_OBJETIVO lineas: el pixel sigue siendo cuadrado y nitido -que es lo que
// hace que esto sea pixel art y no una imagen borrosa- pero cabe cuatro veces
// mas detalle, y ademas el lienzo llena la ventana en vez de recortarse a 16:9.
const ALTO_OBJETIVO = 540;

function calcularResolucion() {
  const escala = Math.max(1, Math.round(window.innerHeight / ALTO_OBJETIVO));
  return {
    w: Math.ceil(window.innerWidth / escala),
    h: Math.ceil(window.innerHeight / escala),
    escala,
  };
}

let { w: W, h: H } = calcularResolucion();

// Punto de aparicion: la Plaza de la Constitucion. Fijo, para poder comparar
// capturas.
//
// Esta vez el punto SI sale de OSM: la plaza es la way 26236121, setenta y cinco
// metros de norte a sur a 1040 m de cota, libre de edificios. El centro es la
// media de sus siete nodos. Se mira al sur, que es hacia donde baja la plaza y
// por donde asoma el Monasterio.
//
// Antes se aparecia en la lonja, pegado a la fachada: se veia el Monasterio y
// nada mas, y para eso ya esta el titulo. Empezar en la plaza es empezar en el
// pueblo, con gente alrededor -es de las calles con mas paso- y con la casa
// grande a un minuto andando.
const SPAWN = { x: 1287, z: 1066, yaw: Math.PI };

// Godot: tonemap ACES con blanco 4.0, glow intensidad 0.9 / fuerza 0.85 /
// umbral 1.0. ponytail: estos cuatro son el mando del revelado.
// El ACES de Godot llevaba blanco 4.0, que comprime los medios mucho mas que el
// de three. La exposicion compensa esa diferencia de revelado.
const EXPOSURE = 0.7;
const BLOOM_STRENGTH = 0.85;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 1.0;

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
// ?dia=800 o ?dia=0 no tienen que dejar el calendario en un sitio imposible.
const clampDia = (d) => (Number.isFinite(d) ? Math.min(365, Math.max(1, Math.round(d))) : 300);

const canvas = document.getElementById('vista');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(W, H, false);       // false: el CSS manda en el tamano visible
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
// fov vertical 68 y far 3000. Con el lienzo ya
// no atado a 16:9, el fov vertical se mantiene y el horizontal lo da la ventana.
// El plano lejano llega a 12 km porque ahora hay sierra que ver: Abantos esta a
// 1,7 km y la Machota a 4. El cercano sube de 0,05 a 0,2 m para no perder
// precision de profundidad al estirar el otro -lo que manda es la razon entre
// los dos, y asi se queda como estaba-; a 20 cm de la cara no hay nada, que el
// jugador choca contra las fachadas mucho antes.
const camera = new THREE.PerspectiveCamera(68, W / H, 0.2, 12000);

const world = await World.load();
scene.add(world);

// La semilla manda sobre los encargos (tramas.js) y sobre el tiempo que hace
// (clima.js): sin ?seed= cada partida trae otra cosa, y con ?seed=1234 se repite
// para poder contarla o depurarla. Va antes que el cielo porque el cielo la
// necesita para sortear el tiempo.
const semilla = q.has('seed') ? (num('seed', 1) >>> 0)
  : (1 + Math.floor(Math.random() * 999999));

const cielo = new DayNight(scene, world, world.data.lat, semilla);
if (q.has('hour')) { cielo.hour = num('hour', 21.5); cielo.paused = true; }
// ?dia= es el dia del ano, de 1 a 365. Es el mando de las estaciones: el sol de
// enero es el de enero, y el tiempo se sortea con los pesos de ese mes.
if (q.has('dia')) cielo.dayOfYear = clampDia(num('dia', 300));
// ?clima=nieve impone un estado. Con nombre y no con un numero, que es lo que
// alguien escribe de verdad.
if (q.has('clima')) cielo.climaForzado = q.get('clima');
cielo.apply();

const player = new Player(camera, world, canvas);
player.spawn(num('x', SPAWN.x), num('z', SPAWN.z), num('yaw', SPAWN.yaw));

// Vecindario y misiones. `vida` va antes: `misiones` le pregunta con quien se
// puede hablar.
const vida = new Vida(world);
scene.add(...vida.objetos);
// `lugares` sabe como se llaman las calles y los edificios de verdad; `misiones`
// se lo pasa a los dialogos para que un vecino pueda mandarte a un sitio.
const lugares = new Lugares(world);
// El punto de aparicion entra en el generador de encargos para que no ponga un
// destino a veinte pasos del jugador.
const misiones = new Misiones(world, vida, lugares, semilla, player.pos, cielo.clima);

const hud = document.getElementById('hud');
hud.width = W; hud.height = H;
const hudCtx = hud.getContext('2d');
const minimapa = new Minimap(hud, world, lugares);

// E habla, Q pregunta el camino. En modo libre E es "subir", asi que ahi no
// interrumpe el vuelo.
addEventListener('keydown', (e) => {
  if (player.free) return;
  if (e.code === 'KeyE') misiones.interactuar();
  else if (e.code === 'KeyQ') misiones.indicaciones();
  // X deja la conversacion. No Esc: cuando el raton esta capturado, Escape lo
  // suelta el navegador y la pagina no llega a ver la pulsacion.
  else if (e.code === 'KeyX') misiones.saltar();
});

const composer = new EffectComposer(renderer);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H),
  BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Al redimensionar se recalcula el factor entero: si el usuario pasa a pantalla
// completa el pixel no se estira, se recalcula cuantos caben.
addEventListener('resize', () => {
  const r = calcularResolucion();
  W = r.w; H = r.h;
  renderer.setSize(W, H, false);
  composer.setSize(W, H);      // ya redimensiona cada pase, bloom incluido
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  hud.width = W; hud.height = H;
});

// `reloj` se declara ANTES de la portada: esta llama a paso() para dibujar un
// fotograma, y con un `let` mas abajo el acceso caeria en la zona muerta.
let reloj = 0;

// La barra de mandos. Se construye oculta y sale al entrar al pueblo.
const sonido = new Sonido({ world, lugares, cielo, vida });
const barra = new Barra({ cielo, misiones, sonido, world });
let ticBarra = 0;

// La portada esta puesta desde el HTML, asi que el titulo se ve desde el primer
// instante y el mundo se levanta detras. Antes se descubria al final y eran
// siete segundos de "cargando" en minusculas sobre negro, que es justo la peor
// primera impresion posible.
const portada = document.getElementById('portada');
// El pueblo se ve detras del titulo; el HUD no, que ahi todavia no se juega.
hud.style.visibility = 'hidden';
paso(1 / 60);                    // un fotograma detras del titulo (ver `reloj`)
document.getElementById('estado').textContent = 'pulsa para entrar';
// La semilla, a la vista: es la unica forma de volver a jugar unos encargos que
// hayan salido buenos, o de contar cuales salieron mal (?seed=...).
document.getElementById('sub').innerHTML
  += ` &middot; encargos n.<sup>o</sup> ${semilla}`;
portada.addEventListener('click', () => {
  portada.classList.add('fuera');
  hud.style.visibility = 'visible';
  barra.verEn(true);               // la barra sale al entrar, no sobre el titulo
  // El AudioContext, aqui dentro y en ningun otro sitio: fuera de un gesto del
  // usuario el navegador lo devuelve suspendido y no arranca jamas.
  sonido.arrancar();
  // En algunos contextos (extensiones, iframes) el bloqueo de puntero lanza.
  // Que no se pueda capturar el raton no es motivo para no entrar al juego.
  try { canvas.requestPointerLock(); } catch { /* se entra igual */ }
  setTimeout(() => portada.remove(), 700);
}, { once: true });

Object.assign(window, { THREE, scene, camera, world, player, cielo, renderer,
  vida, misiones, lugares, barra, sonido });

function paso(dt) {
  reloj += dt;
  player.update(dt);
  cielo.update(dt, player.pos);
  world.update(dt, reloj, player.pos);
  // Con lluvia o con frio hay menos gente en la calle. El suelo de 0,3 no es
  // decoracion: con 220 vecinos y ocho oficios salen unos 27 de cada uno, y por
  // debajo de ahi un encargo puede pedir un oficio del que no quede nadie fuera.
  // ponytail: el que se mete en casa se hunde de golpe cuatro metros. Con el
  // tiempo cambiando poco a poco cruzan el umbral de uno en uno y no se nota,
  // pero si alguna vez se ve el salto, la salida es meterlos solo cuando estan
  // fuera de camara, no interpolar la altura.
  const cl = cielo.clima;
  vida.fuera = Math.max(0.3, 1 - 0.55 * cl.lluvia - 0.55 * cl.nieve - 0.30 * cl.frio);
  vida.update(dt, reloj, player.pos);
  misiones.hora = cielo.hour;      // los saludos cambian con la hora del dia
  vida.hora = cielo.hour;          // y el rey solo se aparece de medianoche a las dos
  misiones.clima = cl;             // y hay encargos que solo salen con nieve o helada
  misiones.update(dt, player);
  sonido.update(dt, player.pos, player.yaw);
  composer.render();
  minimapa.draw(player.pos, player.yaw);
  misiones.dibujar(hudCtx, W, H);      // despues del minimapa: no lo pisa
  // El reloj de la barra corre solo, asi que hay que repintarla; medio segundo
  // sobra y evita reescribir el DOM sesenta veces por segundo para nada.
  ticBarra -= dt;
  if (ticBarra <= 0) { barra.tic(); ticBarra = 0.5; }
  window.__frames = (window.__frames || 0) + 1;
}

// Avanza N fotogramas con paso fijo y dibuja.
// Lo llama la captura de pruebas, que corre en una pestana oculta donde
// requestAnimationFrame no dispara.
window.__step = (n = 1) => { for (let i = 0; i < n; i++) paso(1 / 60); return window.__frames; };

// ?test: comprobacion ejecutable del jugador y de las cubiertas.
//   A) andar en cuatro rumbos recorre lo que debe y nunca se hunde en el terreno
//   B) una fachada frena de verdad
//   C) ningun tejado ni chimenea se queda colgado sobre el vacio
//   D) el salto sube lo que debe y devuelve al suelo
// El muro de (B) se localiza a partir de los datos, no del punto de aparicion.
if (q.has('test')) {
  const lineas = [];
  let hundimiento = 0;
  const andar = (segundos) => {
    for (let i = 0; i < segundos * 60; i++) {
      paso(1 / 60);
      hundimiento = Math.max(hundimiento,
        world.heightAt(player.pos.x, player.pos.z) - (player.pos.y - 1.6));
    }
  };

  player.keys.add('KeyW');
  for (let rumbo = 0; rumbo < 4; rumbo++) {
    player.spawn(SPAWN.x, SPAWN.z, rumbo * Math.PI / 2);
    const ini = player.pos.clone();
    andar(4);
    lineas.push(`  rumbo ${rumbo * 90}: ${Math.hypot(player.pos.x - ini.x,
      player.pos.z - ini.z).toFixed(1)} m recorridos`);
  }

  // Las fachadas mas largas del pueblo, con su normal saliente. Se prueban
  // muchas y no solo la mayor: una sola fachada no distingue "las paredes
  // frenan" de "esa pared frena".
  const fachadas = [];
  for (const b of world.data.buildings) {
    const flat = b.p, n = flat.length / 2;
    if (n < 3) continue;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let p = [flat[i * 2], flat[i * 2 + 1]], r = [flat[j * 2], flat[j * 2 + 1]];
      if (area > 0) [p, r] = [r, p];              // mismo criterio de giro que los muros
      const l = Math.hypot(r[0] - p[0], r[1] - p[1]);
      if (l < 8) continue;
      const e = [(r[0] - p[0]) / l, (r[1] - p[1]) / l];
      const nor = [-e[1], e[0]];
      fachadas.push({ l, nor, pos: [(p[0] + r[0]) * 0.5 + nor[0] * 3, (p[1] + r[1]) * 0.5 + nor[1] * 3] });
    }
  }
  fachadas.sort((a, b) => b.l - a.l);
  const muestra = fachadas.slice(0, 120);
  let avance = 0, coladas = 0;
  for (const f of muestra) {
    // adelante = (-sin y, -cos y); para mirar a -normal hace falta atan2(nx, nz)
    player.spawn(f.pos[0], f.pos[1], Math.atan2(f.nor[0], f.nor[1]));
    const iniMuro = player.pos.clone();
    andar(4);
    const d = Math.hypot(player.pos.x - iniMuro.x, player.pos.z - iniMuro.z);
    avance = Math.max(avance, d);
    if (d > 4.0) coladas++;
  }
  player.keys.delete('KeyW');

  // D) El salto: un toque de espacio sube ~0.81 m (v^2/2g con 5.4 y 18) y
  // devuelve al jugador al suelo antes de un segundo.
  player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
  const suelo0 = player.pos.y;
  player.keys.add('Space');
  paso(1 / 60);
  player.keys.delete('Space');
  let vuelo = 0;
  for (let i = 0; i < 60; i++) { paso(1 / 60); vuelo = Math.max(vuelo, player.pos.y - suelo0); }
  const posado = Math.abs(player.pos.y - suelo0) < 0.01;

  // C) Cada TRIANGULO de la malla de cubiertas tiene que caer sobre alguna
  // huella, o como mucho a un alero de ella. Es la comprobacion del faldon
  // flotante.
  //
  // Se miran el baricentro y los puntos medios de los lados, no solo los tres
  // vertices. Medir vertices dejaba pasar el fallo que importa: el abanico de la
  // piramide tenia todos sus vertices dentro de la huella y sus triangulos
  // cruzando el patio de una planta en L, hasta 20 m de tejado sobre el vacio con
  // esta prueba en verde. Un triangulo se ve por su superficie, no por sus
  // esquinas, y hay que medirlo donde se ve.
  const vc = world.getObjectByName('Cubiertas').geometry.getAttribute('position');
  const fuera = (x, z) => {
    let d = Infinity;
    for (const flat of world.fachadasCerca(x, z)) {
      const p = [];
      for (let j = 0; j < flat.length; j += 2) p.push([flat[j], flat[j + 1]]);
      d = Math.min(d, vuela(p, x, z));
      if (d === 0) break;
    }
    return d === Infinity ? 0 : d;
  };
  let colgados = 0, peor = 0, sondas = 0;
  for (let i = 0; i + 2 < vc.count; i += 3) {
    const t = [0, 1, 2].map((k) => [vc.getX(i + k), vc.getZ(i + k)]);
    const puntos = [[(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3],
      ...t, ...[[0, 1], [1, 2], [2, 0]].map(([a, b]) =>
        [(t[a][0] + t[b][0]) / 2, (t[a][1] + t[b][1]) / 2])];
    for (const [x, z] of puntos) {
      sondas++;
      const d = fuera(x, z);
      // El peor se guarda SIEMPRE, aunque no llegue al umbral: si solo se mirase
      // lo que pasa de 2.5 m, la medida se queda en cero -como ahora- y deja de
      // avisar de lo que empeore por debajo hasta que ya se ve desde la calle.
      peor = Math.max(peor, d);
      if (d > 2.5) colgados++;
    }
  }
  const pctColgados = 100 * colgados / sondas;

  // Los limites discriminan: medido asi, con la piramide en abanico esto daba
  // 0.166% de sondas colgadas y 17.8 m en el peor triangulo; ahora da 0.000% y
  // 2.4 m, que es el alero (0.45) mas la holgura que se le permite al rectangulo
  // de cubierta (1.0), no un tejado en el aire. El limite del PEOR importa tanto
  // como el porcentaje: ocho triangulos de 836.000 no mueven el tanto por ciento
  // y sin embargo uno solo, si vuela 20 m, se ve desde la calle.
  const ok = hundimiento < 0.5 && coladas === 0 && pctColgados < 0.01 && peor < 3.0
    && vuelo > 0.6 && vuelo < 1.2 && posado;
  const informe = [...lineas,
    `hundimiento maximo bajo el terreno: ${hundimiento.toFixed(2)} m (limite 0.50)`,
    `contra ${muestra.length} fachadas desde 3.0 m: se cuelan ${coladas}`
    + ` (avance maximo ${avance.toFixed(2)} m de 13.6 m libres, limite 4.0)`,
    `cubierta colgada sobre el vacio: ${pctColgados.toFixed(3)}% de ${sondas} sondas`
    + ` (baricentro, vertices y puntos medios de cada triangulo) a mas de 2.5 m de`
    + ` una fachada; la peor sonda vuela ${peor.toFixed(1)} m (limites 0.01% y 3.0 m)`,
    `salto: sube ${vuelo.toFixed(2)} m (limites 0.60-1.20) y ${posado ? 'vuelve al suelo' : 'NO vuelve al suelo'}`,
    `RESULTADO: ${ok ? 'OK' : 'FALLO'}`].join('\n');
  console.log(informe);
  window.__test = { ok, informe };
} else {
  arrancarBucle();
}

function arrancarBucle() {
let ultimo = performance.now();
function frame(ahora) {
  frame.id = requestAnimationFrame(frame);
  const dt = Math.min((ahora - ultimo) / 1000, 0.1);
  ultimo = ahora;
  paso(dt);
}
requestAnimationFrame(frame);
}
