import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from './core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);
const _g = { y: 0, nx: 0, ny: 1, nz: 0, mat: null };

export const CAMERA_MODES = ['chase', 'far', 'cockpit', 'helmet', 'hood', 'bumper', 'wheel', 'drone', 'heli', 'orbit', 'director', 'tv'];
export const CAMERA_NAMES = {
  chase: 'Chase', far: 'Chase (far)', cockpit: 'Cockpit', helmet: 'Helmet', hood: 'Hood', bumper: 'Bumper', wheel: 'Wheel cam',
  drone: 'Drone', heli: 'News helicopter', orbit: 'Cinematic orbit', director: 'Director (auto cuts)', tv: 'TV / trackside',
  free: 'Free (photo)', foot: 'On foot', replay: 'Replay',
};

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
    this.headRoll = 0;
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
    this.drone = new THREE.Vector3();
    this.droneVel = new THREE.Vector3();
    this.heli = new THREE.Vector3();
    this.director = { shot: 'chase', t: 0, pos: new THREE.Vector3(), side: 1 };
    this.lean = 0;
  }

  setMode(m) {
    this.mode = m;
    this.initialized = false;
    this.lookYaw = 0;
    this.lookPitch = m === 'cockpit' || m === 'helmet' ? -0.06 : 0;
    this.tvTimer = 0;
    this.director.t = 0;
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
    const k = this.game.settings.reduceShake ? 0.3 : 1;
    this.shake = Math.min(1.5, this.shake + a * k);
  }

  /** Cameras that sit inside the car (show the interior, hide the driver). */
  get interior() {
    return this.mode === 'cockpit' || this.mode === 'helmet';
  }

  /** Keep a camera point above the terrain / ground. */
  clampGround(p, h = 0.4) {
    const g = this.game.world.groundAt(p.x, p.z, p.y, _g);
    if (p.y < g.y + h) p.y = g.y + h;
    return p;
  }

  update(dt, input) {
    const cam = this.camera;
    const car = this.car;
    const S = this.game.settings;
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
    const mode = this.mode === 'director' ? this.directorShot(dt, pos, vel, carYaw, speed) : this.mode;
    if (mode === 'chase' || mode === 'far') {
      const far = mode === 'far';
      this.distTarget = clamp(this.distTarget + m.wheel * 0.6, 3.5, 16);
      const baseDist = (far ? 9.5 : 6.2) * (S.chaseDist || 1);
      const dist = (this.distTarget / 6.2) * baseDist + Math.min(speed * 0.02, 1.2);
      const height = (far ? 2.9 : 1.85) * (S.chaseHeight || 1);
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
        this.orbitYaw -= m.dx * 0.005 * (S.sensitivity || 1) + look.x * dt * 2.5;
        this.orbitPitch = clamp(this.orbitPitch + m.dy * 0.004 * (S.invertY ? -1 : 1) * (S.sensitivity || 1) + look.y * dt * 1.5, -0.25, 1.0);
        this.userTimer = 1.8;
      }
      this.userTimer -= dt;
      if (this.userTimer <= 0) {
        this.orbitYaw = damp(this.orbitYaw, 0, 2.5, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 2.5, dt);
      }
      const stiff = S.chaseStiffness || 1;
      this.yaw += wrapAngle(target - this.yaw) * Math.min(1, dt * (this.lookBack ? 30 : 5.5 * stiff));
      const yaw = this.yaw + this.orbitYaw;
      const pitch = 0.16 + this.orbitPitch + (far ? 0.06 : 0);
      this.smoothTarget.lerp(pos, 1 - Math.exp(-dt * 25 * stiff));
      if (this.smoothTarget.distanceToSquared(pos) > 25) this.smoothTarget.copy(pos);
      const desired = _v.set(
        this.smoothTarget.x - Math.sin(yaw) * Math.cos(pitch) * dist,
        this.smoothTarget.y + height + Math.sin(pitch) * dist * 0.6,
        this.smoothTarget.z - Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      this.collide(pos, desired, 1.2);
      cam.position.copy(desired);
      cam.up.set(0, 1, 0);
      _v2.set(pos.x + Math.sin(yaw) * 2, pos.y + 0.9, pos.z + Math.cos(yaw) * 2);
      cam.lookAt(_v2);
      cam.fov = damp(cam.fov, this.fovBase + Math.min(speed * 0.28, 22), 3, dt);
      cam.near = 0.2;
    } else if (mode === 'cockpit' || mode === 'helmet') {
      const helmet = mode === 'helmet';
      // head on springs: g-forces push it around, road bumps jolt it
      const g = car.gforce;
      const target = _v.set(-g.x * 0.0035, -g.y * 0.002, -g.z * 0.004);
      target.clampLength(0, 0.09);
      const k = 90, c = 13;
      this.headVel.addScaledVector(target.sub(this.head), k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
      let bump = 0;
      for (const w of car.phys.wheels) bump = Math.max(bump, w.impact);
      if (bump > 0.004) this.headVel.y += bump * (S.reduceShake ? 4 : 14);
      this.head.addScaledVector(this.headVel, dt);
      // look: mouse (pointer lock) / right stick / keys
      const sens = 0.0022 * (S.sensitivity || 1);
      if (m.locked || m.down[2]) {
        this.lookYaw = clamp(this.lookYaw - m.dx * sens, -2.4, 2.4);
        this.lookPitch = clamp(this.lookPitch - m.dy * sens * (S.invertY ? -1 : 1), -1.1, 0.9);
      }
      if (look.x || look.y) {
        this.lookYaw = clamp(this.lookYaw - look.x * dt * 2.5, -2.4, 2.4);
        this.lookPitch = clamp(this.lookPitch - look.y * dt * 1.5, -1.1, 0.9);
      }
      const keyLook = input.down('lookLeft') ? 1.35 : input.down('lookRight') ? -1.35 : null;
      // lean out of the open window to look back
      const windowOpen = car.sys.window > 0.6;
      const leaning = this.lookBack && windowOpen;
      this.lean = damp(this.lean, leaning ? 1 : 0, 6, dt);
      if (this.lookBack) this.lookYaw = damp(this.lookYaw, leaning ? 2.75 : 2.4, 12, dt);
      else if (keyLook !== null) this.lookYaw = damp(this.lookYaw, keyLook, 10, dt);
      else if (!m.locked && !m.down[2] && !look.x && !look.y) {
        this.lookYaw = damp(this.lookYaw, 0, 3, dt);
        this.lookPitch = damp(this.lookPitch, -0.06, 3, dt);
      }
      // look into corners a little (helmet cams roll with the g-forces)
      const steerLook = -car.phys.steerAngle * (helmet ? 0.5 : 0.35);
      this.headRoll = damp(this.headRoll, helmet ? clamp(g.x * 0.012, -0.12, 0.12) : 0, 6, dt);
      const seat = car.model.seat;
      const eye = _v2.copy(seat).sub(car.model.com).add(this.head);
      eye.y += 0.02 + (car.sys.seatH || 0) + (helmet ? 0.03 : 0);
      eye.z += car.sys.seatZ || 0;
      eye.x += this.lean * 0.42;
      eye.y += this.lean * 0.06;
      b.toWorldPoint(eye, cam.position);
      // camera looks down -z, car forward is +z: turn around by PI
      _e.set(this.lookPitch, this.lookYaw + steerLook + Math.PI, this.headRoll, 'YXZ');
      _q.setFromEuler(_e);
      cam.quaternion.copy(b.quaternion).multiply(_q);
      // engine vibration at firing frequency + road texture
      const pt = car.phys.pt;
      if (!S.reduceShake) {
        const fire = pt.running && !pt.ev ? (pt.rpm / 60) * ((pt.spec.cylinders || 4) / 2) : 0;
        const amp = pt.running && !pt.ev ? 0.00035 + (pt.load || 0) * 0.0004 + (pt.rpm < (pt.spec.idle || 800) * 1.2 ? 0.0004 : 0) : 0;
        const road = Math.min(speed, 40) * 0.000022;
        cam.position.y += Math.sin(this.shakeT * fire * Math.PI * 2) * amp + (Math.random() - 0.5) * road;
        cam.position.x += Math.sin(this.shakeT * fire * Math.PI * 1.3 + 1) * amp * 0.5 + (Math.random() - 0.5) * road * 0.6;
      }
      // mouse wheel adjusts the cockpit FOV
      if (m.wheel && !m.down[1]) {
        S.cockpitFov = clamp((S.cockpitFov || 72) + m.wheel * 2, 50, 100);
        this.cockpitFov = S.cockpitFov;
        this.game.toast?.(`Cockpit FOV ${S.cockpitFov}°`, 'info', 0.8);
      }
      const zoom = m.down[1] ? 30 : 0;
      this.zoom = damp(this.zoom, zoom, 8, dt);
      cam.fov = damp(cam.fov, (helmet ? this.cockpitFov - 8 : this.cockpitFov) - this.zoom + Math.min(speed * 0.08, 6), 4, dt);
      cam.near = 0.05;
    } else if (mode === 'hood' || mode === 'bumper') {
      const prof = car.model.prof;
      const Z = prof.b.zones;
      const p = mode === 'hood'
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
    } else if (mode === 'wheel') {
      // low on the flank behind the front wheel, looking forward along the car
      const prof = car.model.prof;
      const side = this.director.side || 1;
      const p = _v2.set(side * (prof.hwMax + 0.08), 0.38, prof.b.axles[0] - 0.9).sub(car.model.com);
      b.toWorldPoint(p, cam.position);
      this.clampGround(cam.position, 0.15);
      const t = _v3.set(side * (prof.hwMax - 0.2), 0.3, this.lookBack ? prof.zR - 6 : prof.zF + 6).sub(car.model.com);
      if (this.lookBack) p.set(side * (prof.hwMax + 0.08), 0.38, prof.b.axles[1] + 0.9).sub(car.model.com);
      if (this.lookBack) b.toWorldPoint(p, cam.position);
      b.toWorldPoint(t, t);
      cam.up.set(0, 1, 0);
      cam.lookAt(t);
      cam.fov = damp(cam.fov, 68, 3, dt);
      cam.near = 0.05;
    } else if (mode === 'drone') {
      // a lazy drone that follows from above and behind, mouse to orbit
      if (!this.initialized) {
        this.drone.set(pos.x - Math.sin(carYaw) * 14, pos.y + 9, pos.z - Math.cos(carYaw) * 14);
        this.droneVel.set(0, 0, 0);
        this.initialized = true;
      }
      if (m.down[0] || m.down[2]) {
        this.orbitYaw -= m.dx * 0.005 * (S.sensitivity || 1);
        this.orbitPitch = clamp(this.orbitPitch + m.dy * 0.004 * (S.sensitivity || 1) * (S.invertY ? -1 : 1), -0.4, 0.8);
      }
      this.distTarget = clamp(this.distTarget + m.wheel * 1.2, 5, 40);
      const yaw = carYaw + this.orbitYaw + (this.lookBack ? Math.PI : 0);
      const d = 8 + this.distTarget;
      const want = _v.set(pos.x - Math.sin(yaw) * d, pos.y + 7 + this.orbitPitch * 10, pos.z - Math.cos(yaw) * d);
      this.droneVel.addScaledVector(want.sub(this.drone), dt * 2.2).multiplyScalar(Math.max(0, 1 - dt * 2.4));
      this.drone.addScaledVector(this.droneVel, dt);
      this.clampGround(this.drone, 2);
      cam.position.copy(this.drone);
      cam.position.y += Math.sin(this.shakeT * 1.7) * 0.05;
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + 0.5, pos.z);
      cam.fov = damp(cam.fov, 55, 2, dt);
      cam.near = 0.3;
    } else if (mode === 'heli') {
      // news chopper circling high above, long lens
      if (!this.initialized) {
        this.heli.set(pos.x + 60, pos.y + 55, pos.z + 30);
        this.initialized = true;
      }
      const t = this.shakeT * 0.08;
      const want = _v.set(pos.x + Math.cos(t) * 70, pos.y + 55, pos.z + Math.sin(t) * 70);
      this.heli.lerp(want, 1 - Math.exp(-dt * 0.6));
      this.clampGround(this.heli, 30);
      cam.position.copy(this.heli);
      cam.position.x += Math.sin(this.shakeT * 3.1) * 0.15;
      cam.position.y += Math.sin(this.shakeT * 2.3) * 0.12;
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y, pos.z);
      const d = this.heli.distanceTo(pos);
      cam.fov = damp(cam.fov, clamp(1400 / d, 8, 40), 2, dt);
      cam.near = 1;
    } else if (mode === 'orbit') {
      this.orbitYaw += dt * 0.25;
      const d = 7 + Math.sin(this.shakeT * 0.2) * 1.5;
      cam.position.set(pos.x + Math.sin(this.orbitYaw) * d, pos.y + 1.2 + Math.sin(this.shakeT * 0.3) * 0.6, pos.z + Math.cos(this.orbitYaw) * d);
      this.collide(pos, cam.position, 1);
      cam.lookAt(pos.x, pos.y + 0.6, pos.z);
      cam.fov = damp(cam.fov, 45, 2, dt);
      cam.near = 0.2;
    } else if (mode === 'tv') {
      this.tvTimer -= dt;
      const d = this.tvPos.distanceTo(pos);
      const blocked = this.game.world.blocked(this.tvPos.x, this.tvPos.z, pos.x, pos.z, 3);
      if (this.tvTimer <= 0 || d > 90 || blocked) {
        // place the camera ahead of the car, off to the side
        const ahead = vel.lengthSq() > 4 ? vel.clone().normalize() : _v.set(Math.sin(carYaw), 0, Math.cos(carYaw));
        const side = new THREE.Vector3(-ahead.z, 0, ahead.x).multiplyScalar(Math.random() < 0.5 ? 8 : -8);
        this.tvPos.copy(pos).addScaledVector(ahead, 30 + speed * 1.2).add(side);
        this.tvPos.y = pos.y + 1.2 + Math.random() * 3;
        this.clampGround(this.tvPos, 1.2);
        this.tvTimer = 7;
      }
      cam.position.copy(this.tvPos);
      cam.lookAt(pos.x, pos.y + 0.5, pos.z);
      cam.fov = damp(cam.fov, clamp(900 / Math.max(d, 10), 12, 60), 3, dt);
      cam.near = 0.3;
    }
    // shake
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * (this.interior ? 0.04 : 0.12);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.3;
    }
    cam.updateProjectionMatrix();
  }

  /** Pull a camera in toward the target if a building or hill is in the way. */
  collide(target, desired, minDist) {
    const origin = _v3.set(target.x, target.y + 1.2, target.z);
    const dir = _v2.copy(desired).sub(origin);
    const len = dir.length();
    if (len < 0.01) return;
    dir.multiplyScalar(1 / len);
    let hit = this.game.world.raycast(origin, dir, len, (bx) => bx.max.y > 2);
    // terrain: march along the ray
    for (let t = 1; t < Math.min(hit, len); t += 0.75) {
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      if (this.game.world.groundAt(px, pz, py + 50, _g).y > py - 0.2) {
        hit = Math.max(minDist, t - 0.5);
        break;
      }
    }
    if (hit < len) desired.copy(origin).addScaledVector(dir, Math.max(minDist, hit - 0.4));
    this.clampGround(desired, 0.4);
  }

  /** Automatic camera director: cuts between shots every few seconds. */
  directorShot(dt, pos, vel, carYaw, speed) {
    const d = this.director;
    d.t -= dt;
    if (d.t <= 0) {
      const shots = speed > 8 ? ['chase', 'wheel', 'tv', 'drone', 'far', 'heli', 'bumper'] : ['orbit', 'drone', 'tv', 'chase', 'wheel'];
      let next = shots[Math.floor(Math.random() * shots.length)];
      if (next === d.shot) next = shots[(shots.indexOf(next) + 1) % shots.length];
      d.shot = next;
      d.side = Math.random() < 0.5 ? 1 : -1;
      d.t = 4 + Math.random() * 4;
      this.initialized = false;
      this.tvTimer = 0;
    }
    return d.shot;
  }

  updateFree(dt, input) {
    const cam = this.camera;
    const m = input.mouse;
    const S = this.game.settings;
    if (m.locked || m.down[0] || m.down[2]) {
      this.freeYaw -= m.dx * 0.0025 * (S.sensitivity || 1);
      this.freePitch = clamp(this.freePitch - m.dy * 0.0025 * (S.sensitivity || 1) * (S.invertY ? -1 : 1), -1.5, 1.5);
    }
    const speed = (input.key('ShiftLeft') ? 40 : 12) * dt;
    _e.set(this.freePitch, this.freeYaw, this.freeRoll || 0, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    const f = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    if (input.key('KeyW')) this.freePos.addScaledVector(f, speed);
    if (input.key('KeyS')) this.freePos.addScaledVector(f, -speed);
    if (input.key('KeyD')) this.freePos.addScaledVector(r, speed);
    if (input.key('KeyA')) this.freePos.addScaledVector(r, -speed);
    if (input.key('KeyE')) this.freePos.y += speed;
    if (input.key('KeyQ')) this.freePos.y -= speed;
    this.clampGround(this.freePos, 0.3);
    cam.position.copy(this.freePos);
    this.freeFov = clamp((this.freeFov || 55) + m.wheel * 3, 12, 100);
    cam.fov = damp(cam.fov, this.freeFov, 5, dt);
    cam.near = 0.1;
    cam.updateProjectionMatrix();
  }
}

export { lerp };
