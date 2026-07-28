import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { DayNight } from './daynight.js';
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

// Punto de aparicion, en el casco viejo. Fijo, para poder comparar capturas.
const SPAWN = { x: 1343, z: 802, yaw: 2.1946 };

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
const camera = new THREE.PerspectiveCamera(68, W / H, 0.05, 3000);

const world = await World.load();
scene.add(world);

const cielo = new DayNight(scene, world, world.data.lat);
if (q.has('hour')) { cielo.hour = num('hour', 21.5); cielo.paused = true; cielo.apply(); }

const player = new Player(camera, world, canvas);
player.spawn(num('x', SPAWN.x), num('z', SPAWN.z), num('yaw', SPAWN.yaw));

// Vecindario y misiones. `vida` va antes: `misiones` le pregunta con quien se
// puede hablar.
const vida = new Vida(world);
scene.add(...vida.objetos);
// `lugares` sabe como se llaman las calles y los edificios de verdad; `misiones`
// se lo pasa a los dialogos para que un vecino pueda mandarte a un sitio.
const lugares = new Lugares(world);
const misiones = new Misiones(world, vida, lugares);

const hud = document.getElementById('hud');
hud.width = W; hud.height = H;
const hudCtx = hud.getContext('2d');
const minimapa = new Minimap(hud, world);

// E habla, Q pregunta el camino. En modo libre E es "subir", asi que ahi no
// interrumpe el vuelo.
addEventListener('keydown', (e) => {
  if (player.free) return;
  if (e.code === 'KeyE') misiones.interactuar();
  else if (e.code === 'KeyQ') misiones.indicaciones();
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

// La portada esta puesta desde el HTML, asi que el titulo se ve desde el primer
// instante y el mundo se levanta detras. Antes se descubria al final y eran
// siete segundos de "cargando" en minusculas sobre negro, que es justo la peor
// primera impresion posible.
const portada = document.getElementById('portada');
// El pueblo se ve detras del titulo; el HUD no, que ahi todavia no se juega.
hud.style.visibility = 'hidden';
paso(1 / 60);                    // un fotograma detras del titulo (ver `reloj`)
document.getElementById('estado').textContent = 'pulsa para entrar';
portada.addEventListener('click', () => {
  portada.classList.add('fuera');
  hud.style.visibility = 'visible';
  // En algunos contextos (extensiones, iframes) el bloqueo de puntero lanza.
  // Que no se pueda capturar el raton no es motivo para no entrar al juego.
  try { canvas.requestPointerLock(); } catch { /* se entra igual */ }
  setTimeout(() => portada.remove(), 700);
}, { once: true });

Object.assign(window, { THREE, scene, camera, world, player, cielo, renderer,
  vida, misiones, lugares });

function paso(dt) {
  reloj += dt;
  player.update(dt);
  cielo.update(dt, player.pos);
  world.update(dt, reloj, player.pos);
  vida.update(dt, reloj, player.pos);
  misiones.hora = cielo.hour;      // los saludos cambian con la hora del dia
  misiones.update(dt, player);
  composer.render();
  minimapa.draw(player.pos, player.yaw);
  misiones.dibujar(hudCtx, W, H);      // despues del minimapa: no lo pisa
  window.__frames = (window.__frames || 0) + 1;
}

// Avanza N fotogramas con paso fijo y dibuja.
// Lo llama la captura de pruebas, que corre en una pestana oculta donde
// requestAnimationFrame no dispara.
window.__step = (n = 1) => { for (let i = 0; i < n; i++) paso(1 / 60); return window.__frames; };

// ?test: comprobacion ejecutable del jugador.
//   A) andar en cuatro rumbos recorre lo que debe y nunca se hunde en el terreno
//   B) una fachada frena de verdad
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

  // fachada mas larga del pueblo, con la normal saliente
  let mejor = 0, pos = [0, 0], nor = [1, 0];
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
      if (l > mejor) {
        mejor = l;
        const e = [(r[0] - p[0]) / l, (r[1] - p[1]) / l];
        nor = [-e[1], e[0]];
        pos = [(p[0] + r[0]) * 0.5 + nor[0] * 3, (p[1] + r[1]) * 0.5 + nor[1] * 3];
      }
    }
  }
  // adelante = (-sin y, -cos y); para mirar a -normal hace falta atan2(nx, nz)
  player.spawn(pos[0], pos[1], Math.atan2(nor[0], nor[1]));
  const iniMuro = player.pos.clone();
  andar(4);
  player.keys.delete('KeyW');
  const avance = Math.hypot(player.pos.x - iniMuro.x, player.pos.z - iniMuro.z);

  const ok = hundimiento < 0.5 && avance < 4.0;
  const informe = [...lineas,
    `hundimiento maximo bajo el terreno: ${hundimiento.toFixed(2)} m (limite 0.50)`,
    `contra fachada desde 3.0 m: avanza ${avance.toFixed(2)} m de 13.6 m libres (limite 4.0)`,
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
