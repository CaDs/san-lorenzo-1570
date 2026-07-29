import * as THREE from 'three';

// Jugador a pie.
// WASD anda, Shift corre, Esc suelta el raton, V alterna modo libre.
// En vuelo: W/S adelante y atras, A ladea, E sube, D baja.
//
// Godot resolvia la colision con un CharacterBody3D contra la malla completa del
// terreno y de las fachadas. Aqui no hay motor de fisica y tampoco hace falta:
// el suelo es una funcion analitica (heightAt) y las fachadas son los mismos
// poligonos de OSM. Sale mas corto Y mas exacto que la capsula contra trimesh.

const WALK = 3.4;                 // m/s, paso humano
const RUN = 7.0;
const SENSITIVITY = 0.0022;
const EYE_HEIGHT = 1.6;
const RADIUS = 0.35;              // el mismo de la capsula de Godot
const OCC_CELL = 10.0;

export class Player {
  constructor(camera, world, canvas) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0;
    this.free = false;
    this.keys = new Set();
    this.pos = new THREE.Vector3();

    // Indice de fachadas por celda, para no probar 3545 casas en cada paso.
    this.grid = new Map();
    world.data.buildings.forEach((b) => {
      const flat = b.p;
      const n = flat.length / 2;
      if (n < 3) return;
      const poly = [];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        poly.push(flat[i * 2], flat[i * 2 + 1]);
        x0 = Math.min(x0, flat[i * 2]); x1 = Math.max(x1, flat[i * 2]);
        z0 = Math.min(z0, flat[i * 2 + 1]); z1 = Math.max(z1, flat[i * 2 + 1]);
      }
      for (let cy = (z0 / OCC_CELL) | 0; cy <= (z1 / OCC_CELL | 0); cy++) {
        for (let cx = (x0 / OCC_CELL) | 0; cx <= (x1 / OCC_CELL | 0); cx++) {
          const k = cx * 100000 + cy;
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, l = []);
          l.push(poly);
        }
      }
    });

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyV') this.free = !this.free;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = Math.min(Math.max(this.pitch - e.movementY * SENSITIVITY, -1.4), 1.4);
    });
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.world.heightAt(x, z) + EYE_HEIGHT, z);
    this.yaw = yaw;
    this.sync();
  }

  // Huellas candidatas alrededor de (x, z): las de su celda y las ocho vecinas.
  cerca(x, z) {
    const cx = (x / OCC_CELL) | 0, cy = (z / OCC_CELL) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const l = this.grid.get((cx + dx) * 100000 + (cy + dy));
        if (l) out.push(...l);
      }
    }
    return out;
  }

  // Cierto si un cilindro de radio RADIUS en (x, z) toca alguna fachada.
  blocked(x, z) {
    for (const poly of this.cerca(x, z)) if (hits(poly, x, z, RADIUS)) return true;
    return false;
  }

  update(dt) {
    const k = this.keys;
    const ix = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const iy = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;

    if (this.free) {
      // Vuela siguiendo la mirada, sin gravedad ni colision. En vuelo D deja de
      // ladear: E sube y D baja.
      const f = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
      const r = new THREE.Vector3(1, 0, 0).applyEuler(this.camera.rotation);
      const dir = new THREE.Vector3()
        .addScaledVector(f, -iy)
        .addScaledVector(r, -(k.has('KeyA') ? 1 : 0));
      if (dir.lengthSq() > 0) dir.normalize();
      dir.y += (k.has('KeyE') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
      this.pos.addScaledVector(dir, speed * 12 * dt);
      this.sync();
      return;
    }

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let dx = cy * ix + sy * iy;
    let dz = -sy * ix + cy * iy;
    const l = Math.hypot(dx, dz);
    if (l > 0) {
      dx = dx / l * speed * dt;
      dz = dz / l * speed * dt;
      // Deslizamiento contra la fachada: si el paso entero no cabe, se intenta
      // cada eje por separado. Es lo que hacia move_and_slide sin el motor.
      const { x, z } = this.pos;
      if (!this.blocked(x + dx, z + dz)) { this.pos.x += dx; this.pos.z += dz; }
      else if (!this.blocked(x + dx, z)) this.pos.x += dx;
      else if (!this.blocked(x, z + dz)) this.pos.z += dz;
    }
    // La gravedad de Godot solo servia para posarlo en el terreno; esto es eso.
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z) + EYE_HEIGHT;
    this.sync();
  }

  sync() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

// Punto contra poligono con margen: dentro, o a menos de `r` de alguna arista.
function hits(poly, x, z, r) {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1];
    const xj = poly[j * 2], zj = poly[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    // distancia al segmento i-j
    const ex = xj - xi, ez = zj - zi;
    const ll = ex * ex + ez * ez;
    const t = ll > 0 ? Math.min(Math.max(((x - xi) * ex + (z - zi) * ez) / ll, 0), 1) : 0;
    const px = xi + ex * t - x, pz = zi + ez * t - z;
    if (px * px + pz * pz < r * r) return true;
  }
  return inside;
}
