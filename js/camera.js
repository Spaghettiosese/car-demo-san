import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from './core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

export const CAMERA_MODES = ['chase', 'far', 'cockpit', 'hood', 'bumper', 'orbit', 'tv'];
export const CAMERA_NAMES = { chase: 'Chase', far: 'Chase (far)', cockpit: 'Cockpit', hood: 'Hood', bumper: 'Bumper', orbit: 'Cinematic', tv: 'TV / trackside', free: 'Free (photo)', foot: 'On foot' };

export class CameraRig {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.mode = 'chase';
    this.car = null;
    this.yaw = 0;
    this.pitch = 0.18;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.userTimer = 0;
    this.dist = 6.2;
    this.distTarget = 6.2;
    this.lookYaw = 0; // cockpit free-look
    this.lookPitch = -0.05;
    this.head = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.shake = 0;
    this.shakeT = 0;
    this.fovBase = 62;
    this.cockpitFov = 72;
    this.tvPos = new THREE.Vector3();
    this.tvTimer = 0;
    this.freePos = new THREE.Vector3();
    this.freeYaw = 0;
    this.freePitch = 0;
    this.lookBack = false;
    this.pos = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.initialized = false;
    this.zoom = 0;
  }

  setMode(m) {
    this.mode = m;
    this.initialized = false;
    this.lookYaw = 0;
    this.lookPitch = m === 'cockpit' ? -0.06 : 0;
    this.tvTimer = 0;
    if (m === 'free') {
      this.freePos.copy(this.camera.position);
      _e.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.freeYaw = _e.y;
      this.freePitch = _e.x;
    }
  }

  next() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  addShake(a) {
    this.shake = Math.min(1.5, this.shake + a);
  }

  get interior() {
    return this.mode === 'cockpit';
  }

  update(dt, input) {
    const cam = this.camera;
    const car = this.car;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.shakeT += dt;
    if (this.mode === 'free') return this.updateFree(dt, input);
    if (!car) return;
    const b = car.body;
    const pos = b.position;
    const carYaw = Math.atan2(b.R[2], b.R[8]);
    const speed = car.speed;
    const vel = b.velocity;
    const m = input.mouse;
    const look = input.look();
    if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      this.distTarget = clamp(this.distTarget + m.wheel * 0.6, 3.5, 16);
      const baseDist = far ? 9.5 : 6.2;
      const dist = (this.distTarget / 6.2) * baseDist + Math.min(speed * 0.02, 1.2);
      const height = far ? 2.9 : 1.85;
      // follow the direction of travel a bit when sliding / reversing
      let target = carYaw;
      if (speed > 3) {
        const velYaw = Math.atan2(vel.x, vel.z);
        const fwd = car.forwardSpeed;
        if (fwd > 2) target = carYaw + wrapAngle(velYaw - carYaw) * 0.45;
      }
      if (this.lookBack) target += Math.PI;
      if (!this.initialized) {
        this.yaw = target;
        this.initialized = true;
        this.pos.copy(pos);
      }
      // user orbit (mouse drag / right stick)
      if (m.down[0] || m.down[2] || Math.abs(look.x) > 0 || Math.abs(look.y) > 0) {
        this.orbitYaw -= m.dx * 0.005 + look.x * dt * 2.5;
        this.orbitPitch = clamp(this.orbitPitch + m.dy * 0.004 + look.y * dt * 1.5, -0.25, 1.0);
        this.userTimer = 1.8;
      }
      this.userTimer -= dt;
      if (this.userTimer <= 0) {
        this.orbitYaw = damp(this.orbitYaw, 0, 2.5, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 2.5, dt);
      }
      this.yaw += wrapAngle(target - this.yaw) * Math.min(1, dt * (this.lookBack ? 30 : 5.5));
      const yaw = this.yaw + this.orbitYaw;
      const pitch = 0.16 + this.orbitPitch + (far ? 0.06 : 0);
      this.smoothTarget.lerp(pos, 1 - Math.exp(-dt * 25));
      if (this.smoothTarget.distanceToSquared(pos) > 25) this.smoothTarget.copy(pos);
      const desired = _v.set(
        this.smoothTarget.x - Math.sin(yaw) * Math.cos(pitch) * dist,
        this.smoothTarget.y + height + Math.sin(pitch) * dist * 0.6,
        this.smoothTarget.z - Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      // don't clip into buildings
      const origin = _v2.set(pos.x, pos.y + 1.2, pos.z);
      const dir = desired.clone().sub(origin);
      const len = dir.length();
      dir.normalize();
      const hit = this.game.world.raycast(origin, dir, len, (bx) => bx.max.y > 2);
      if (hit < len) desired.copy(origin).addScaledVector(dir, Math.max(1.2, hit - 0.4));
      const g = this.game.world.groundAt(desired.x, desired.z, desired.y, { y: 0 });
      if (desired.y < g.y + 0.4) desired.y = g.y + 0.4;
      cam.position.copy(desired);
      cam.up.set(0, 1, 0);
      _v2.set(pos.x + Math.sin(yaw) * 2, pos.y + 0.9, pos.z + Math.cos(yaw) * 2);
      cam.lookAt(_v2);
      cam.fov = damp(cam.fov, this.fovBase + Math.min(speed * 0.28, 22), 3, dt);
      cam.near = 0.2;
    } else if (this.mode === 'cockpit') {
      // head on springs: g-forces push it around
      const g = car.gforce;
      const target = _v.set(-g.x * 0.0035, -g.y * 0.002 - 0.0, -g.z * 0.004);
      target.clampLength(0, 0.09);
      const k = 90, c = 13;
      this.headVel.addScaledVector(target.sub(this.head), k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
      this.head.addScaledVector(this.headVel, dt);
      // mouse look (pointer lock) / right stick
      if (m.locked || m.down[2]) {
        this.lookYaw = clamp(this.lookYaw - m.dx * 0.0022, -2.4, 2.4);
        this.lookPitch = clamp(this.lookPitch - m.dy * 0.0022, -1.1, 0.9);
      }
      if (look.x || look.y) {
        this.lookYaw = clamp(this.lookYaw - look.x * dt * 2.5, -2.4, 2.4);
        this.lookPitch = clamp(this.lookPitch - look.y * dt * 1.5, -1.1, 0.9);
      }
      if (this.lookBack) this.lookYaw = damp(this.lookYaw, 2.4, 12, dt);
      else if (!m.locked && !m.down[2] && !look.x && !look.y) {
        this.lookYaw = damp(this.lookYaw, 0, 3, dt);
        this.lookPitch = damp(this.lookPitch, -0.06, 3, dt);
      }
      // look into corners a little
      const steerLook = -car.phys.steerAngle * 0.35;
      const seat = car.model.seat;
      const eye = _v2.copy(seat).sub(car.model.com).add(this.head);
      eye.y += 0.02;
      b.toWorldPoint(eye, cam.position);
      // camera looks down -z, car forward is +z: turn around by PI
      _e.set(this.lookPitch, this.lookYaw + steerLook + Math.PI, 0, 'YXZ');
      _q.setFromEuler(_e);
      cam.quaternion.copy(b.quaternion).multiply(_q);
      // subtle road/engine vibration
      const vib = (car.engineRunning ? 0.0006 : 0) + Math.min(speed, 40) * 0.00003;
      cam.position.x += (Math.random() - 0.5) * vib;
      cam.position.y += (Math.random() - 0.5) * vib;
      const zoom = m.down[1] ? 30 : 0;
      this.zoom = damp(this.zoom, zoom, 8, dt);
      cam.fov = damp(cam.fov, this.cockpitFov - this.zoom + Math.min(speed * 0.08, 6), 4, dt);
      cam.near = 0.05;
    } else if (this.mode === 'hood' || this.mode === 'bumper') {
      const prof = car.model.prof;
      const Z = prof.b.zones;
      const p = this.mode === 'hood'
        ? _v2.set(0, prof.f.top(Z.cowl + 0.45) + 0.28, Z.cowl + 0.45)
        : _v2.set(0, 0.55, prof.zF + 0.05);
      p.sub(car.model.com);
      b.toWorldPoint(p, cam.position);
      if (this.lookBack) {
        _q.setFromAxisAngle(UP, Math.PI);
        cam.quaternion.copy(b.quaternion).multiply(_q);
      } else cam.quaternion.copy(b.quaternion);
      // camera looks down -z, car forward is +z
      _q.setFromAxisAngle(UP, Math.PI);
      cam.quaternion.multiply(_q);
      cam.fov = damp(cam.fov, 70 + Math.min(speed * 0.2, 14), 3, dt);
      cam.near = 0.1;
    } else if (this.mode === 'orbit') {
      this.orbitYaw += dt * 0.25;
      const d = 7 + Math.sin(this.shakeT * 0.2) * 1.5;
      cam.position.set(pos.x + Math.sin(this.orbitYaw) * d, pos.y + 1.2 + Math.sin(this.shakeT * 0.3) * 0.6, pos.z + Math.cos(this.orbitYaw) * d);
      const hit = this.game.world.raycast(_v.set(pos.x, pos.y + 1, pos.z), _v2.copy(cam.position).sub(_v).normalize(), d, (bx) => bx.max.y > 2);
      if (hit < d) cam.position.copy(_v).addScaledVector(_v2, hit - 0.4);
      cam.lookAt(pos.x, pos.y + 0.6, pos.z);
      cam.fov = damp(cam.fov, 45, 2, dt);
      cam.near = 0.2;
    } else if (this.mode === 'tv') {
      this.tvTimer -= dt;
      const d = this.tvPos.distanceTo(pos);
      const blocked = this.game.world.blocked(this.tvPos.x, this.tvPos.z, pos.x, pos.z, 3);
      if (this.tvTimer <= 0 || d > 90 || blocked) {
        // place the camera ahead of the car, off to the side
        const ahead = vel.lengthSq() > 4 ? vel.clone().normalize() : _v.set(Math.sin(carYaw), 0, Math.cos(carYaw));
        const side = new THREE.Vector3(-ahead.z, 0, ahead.x).multiplyScalar(Math.random() < 0.5 ? 8 : -8);
        this.tvPos.copy(pos).addScaledVector(ahead, 30 + speed * 1.2).add(side);
        this.tvPos.y = pos.y + 1.2 + Math.random() * 3;
        this.tvTimer = 7;
      }
      cam.position.copy(this.tvPos);
      cam.lookAt(pos.x, pos.y + 0.5, pos.z);
      cam.fov = damp(cam.fov, clamp(900 / Math.max(d, 10), 12, 60), 3, dt);
      cam.near = 0.3;
    }
    // shake
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * (this.mode === 'cockpit' ? 0.04 : 0.12);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.3;
    }
    cam.updateProjectionMatrix();
  }

  updateFree(dt, input) {
    const cam = this.camera;
    const m = input.mouse;
    if (m.locked || m.down[0] || m.down[2]) {
      this.freeYaw -= m.dx * 0.0025;
      this.freePitch = clamp(this.freePitch - m.dy * 0.0025, -1.5, 1.5);
    }
    const speed = (input.key('ShiftLeft') ? 40 : 12) * dt;
    _e.set(this.freePitch, this.freeYaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    const f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    if (input.key('KeyW')) this.freePos.addScaledVector(f, speed);
    if (input.key('KeyS')) this.freePos.addScaledVector(f, -speed);
    if (input.key('KeyD')) this.freePos.addScaledVector(r, speed);
    if (input.key('KeyA')) this.freePos.addScaledVector(r, -speed);
    if (input.key('KeyE')) this.freePos.y += speed;
    if (input.key('KeyQ')) this.freePos.y -= speed;
    this.freePos.y = Math.max(0.3, this.freePos.y);
    cam.position.copy(this.freePos);
    cam.fov = damp(cam.fov, clamp(55 - m.wheel * 5, 20, 90), 5, dt);
    cam.near = 0.1;
    cam.updateProjectionMatrix();
  }
}
