import * as THREE from 'three';

// Jugador a pie.
// WASD anda, Shift corre, espacio salta, Esc suelta el raton, V alterna modo
// libre. En vuelo: W/S adelante y atras, A ladea, E sube, D baja.
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
const GRAVITY = 18.0;             // mas dura que la real: en la calle un salto
const JUMP = 5.4;                 // lunar se lee como un fallo, no como salto


export class Player {
  constructor(camera, world, canvas) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0;
    this.free = false;
    this.keys = new Set();
    this.pos = new THREE.Vector3();
    this.vy = 0;                    // 0 = pisando el suelo; si no, salto en curso

    // El indice de fachadas ya no se construye aqui: vive en world.js, porque
    // ahora lo usan dos -esta colision y la costura del grafo de calles- y dos
    // indices del mismo dato es como se acaba con dos que no dicen lo mismo.

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyV') this.free = !this.free;
      // Sin esto el espacio hace scroll de la pagina bajo el lienzo.
      if (e.code === 'Space') e.preventDefault();
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
    this.vy = 0;
    this.pos.set(x, this.world.heightAt(x, z) + EYE_HEIGHT, z);
    this.yaw = yaw;
    this.sync();
  }

  // Cierto si un cilindro de radio RADIUS en (x, z) toca alguna fachada. Un paso
  // bajo edificio no cuenta, y de eso se encarga world.chocaEdificio: OSM trae
  // soportales, calles que cruzan por debajo de una casa y escaleras que salen
  // por un arco, todo con tunnel=building_passage, y el juego los tiraba. Con la
  // via borrada y el edificio de encima macizo, el hueco por el que se pasa de
  // verdad era un muro, y habia calles que no llevaban a ninguna parte.
  blocked(x, z) {
    return this.world.chocaEdificio(x, z, RADIUS);
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
    // La gravedad de Godot servia para posarlo en el terreno; ahora ademas
    // sostiene el salto. Fuera de el la cota sigue siendo la del suelo exacto,
    // asi que andar por la cuesta no arrastra ningun error acumulado.
    const suelo = this.world.heightAt(this.pos.x, this.pos.z) + EYE_HEIGHT;
    if (this.vy === 0 && this.pos.y <= suelo && k.has('Space')) this.vy = JUMP;
    if (this.vy !== 0) {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= suelo) { this.pos.y = suelo; this.vy = 0; }
    } else {
      this.pos.y = suelo;
    }
    this.sync();
  }

  sync() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

