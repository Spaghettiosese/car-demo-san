import * as THREE from 'three';
import { clamp, damp } from './core/util.js';

const _v = new THREE.Vector3();
const _l = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _g = { y: 0 };
const _boxes = [];
const _cyls = [];
const R = 0.35;
const EYE = 1.65;

/** First-person walking: get out, look at the damage, steal another car. */
export class OnFoot {
  constructor(game) {
    this.game = game;
    this.position = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.bob = 0;
    this.nearCar = null;
  }

  exitCar(car) {
    const g = this.game;
    // step out on the driver's side
    const seat = car.model.seat;
    const side = new THREE.Vector3(car.boundsMax.x + 0.55, 0, seat.z - car.model.com.z + 0.2);
    car.body.toWorldPoint(side, this.position);
    const gy = g.world.groundAt(this.position.x, this.position.z, this.position.y + 1, _g).y;
    // if blocked (e.g. against a wall), try the other side
    if (g.world.raycast(car.body.position.clone().setY(1), this.position.clone().sub(car.body.position).setY(0).normalize(), car.boundsMax.x + 0.6) < car.boundsMax.x + 0.5) {
      side.x = -side.x;
      car.body.toWorldPoint(side, this.position);
    }
    this.position.y = gy;
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(car.body.R[2], car.body.R[8]) + Math.PI / 2;
    this.pitch = -0.1;
    const pt = car.phys.pt;
    if (pt.auto) pt.setSelector('P');
    car.parkLever = true;
    car.phys.input.throttle = 0;
    car.phys.input.brake = 0;
    const door = car.model.parts.doorFL;
    if (door && door.state !== 'detached') {
      door.userOpen = true;
      setTimeout(() => (door.userOpen = false), 1400);
    }
    g.audio?.door?.(true);
    g.player.mode = 'foot';
    g.cam.mode = 'foot';
    g.hud.camName('foot');
    g.hud.crosshair(true);
    g.hud.hover(null);
    if (car.model.details.driver) car.model.details.driver.visible = false;
    g.toast('On foot. <kbd>F</kbd> near a car to get in. Try walking around your wreck.');
  }

  /** Enter the car you're looking at / closest to. */
  tryEnter() {
    const car = this.findCar();
    if (!car) {
      this.game.toast('No car close enough');
      return;
    }
    this.enter(car);
  }

  findCar() {
    let best = null, bd = 3.6;
    for (const c of this.game.cars) {
      if (c.removed) continue;
      c.body.toLocalPoint(this.position.clone().setY(c.body.position.y), _l);
      const dx = Math.max(Math.abs(_l.x) - c.boundsMax.x, 0), dz = Math.max(Math.abs(_l.z) - c.boundsMax.z, 0);
      const d = Math.hypot(dx, dz);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  forceEnter() {
    if (this.game.player.mode === 'foot') this.enter(this.game.player.car);
  }

  enter(car) {
    const g = this.game;
    const old = g.player.car;
    if (car !== old) {
      // carjacking
      const drv = car.controller;
      if (drv) {
        if (g.traffic) {
          const i = g.traffic.drivers.indexOf(drv);
          if (i >= 0) g.traffic.drivers.splice(i, 1);
        }
        if (g.police) {
          const i = g.police.cops.indexOf(drv);
          if (i >= 0) g.police.cops.splice(i, 1);
        }
        car.controller = null;
        g.hud.say(car.body.position, ['HEY! MY CAR!', 'THIEF!', 'Somebody call the police!'][Math.floor(Math.random() * 3)], 'angry', 3);
        g.police?.offense?.('carjack');
      } else if (car.police) g.police?.offense?.('carjack', true);
      if (car.parked) car.parked = false;
      if (old) {
        old.isPlayer = false;
        old.parkLever = true;
        old.sys.hazard = false;
        if (old.model.details.driver) old.model.details.driver.visible = false;
      }
      car.isPlayer = true;
      car.physicsActive = true;
      car.body.sleeping = false;
      car.sys.seatbelt = false;
      car.sirenOn = false;
      g.player.car = car;
      g.cam.car = car;
      if (g.interior) g.interior.dispose();
      g.interior = g.interiorModule ? new g.interiorModule.Interior(g, car) : null;
      g.audio?.setPlayerCar?.(car);
      g.toast(car.police ? 'You stole a police car! <kbd>G</kbd> toggles the siren.' : `You took the ${car.model.prof.b.name}.`, car.police ? 'warn' : 'info');
    }
    car.parkLever = false;
    if (car.model.details.driver) car.model.details.driver.visible = true;
    const door = car.model.parts.doorFL;
    if (door && door.state !== 'detached') {
      door.userOpen = true;
      setTimeout(() => (door.userOpen = false), 900);
    }
    g.audio?.door?.(false);
    g.player.mode = 'car';
    g.cam.setMode('cockpit');
    g.hud.camName('cockpit');
  }

  update(dt, input) {
    const g = this.game;
    const world = g.world;
    const m = input.mouse;
    if (!m.locked && m.clicked[0]) input.lock();
    // look
    if (m.locked || m.down[2]) {
      this.yaw -= m.dx * 0.0022 * g.settings.sensitivity;
      this.pitch = clamp(this.pitch - m.dy * 0.0022 * g.settings.sensitivity, -1.45, 1.45);
    }
    const look = input.look();
    this.yaw -= look.x * dt * 2.6;
    this.pitch = clamp(this.pitch - look.y * dt * 2, -1.45, 1.45);
    // move
    const fwd = (input.key('KeyW') || input.key('ArrowUp') ? 1 : 0) - (input.key('KeyS') || input.key('ArrowDown') ? 1 : 0);
    const str = (input.key('KeyD') || input.key('ArrowRight') ? 1 : 0) - (input.key('KeyA') || input.key('ArrowLeft') ? 1 : 0);
    const pad = input.pad ? { x: input.padAxes[0] || 0, y: -(input.padAxes[1] || 0) } : { x: 0, y: 0 };
    let mx = str + (Math.abs(pad.x) > 0.15 ? pad.x : 0), mz = fwd + (Math.abs(pad.y) > 0.15 ? pad.y : 0);
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = input.key('ShiftLeft') ? 6.5 : 3.2;
    // camera forward is -z rotated by yaw
    const sx = -Math.sin(this.yaw), sz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (sx * mz + rx * mx) * speed, tz = (sz * mz + rz * mx) * speed;
    const accel = this.onGround ? 12 : 2;
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.z = damp(this.vel.z, tz, accel, dt);
    if (this.onGround && (input.keyPressed('Space') || input.padPressed('jump'))) {
      this.vel.y = 5;
      this.onGround = false;
    }
    this.vel.y -= 9.81 * dt;
    this.position.addScaledVector(this.vel, dt);
    // ground (step up small ledges like curbs)
    const gy = world.groundAt(this.position.x, this.position.z, this.position.y + 0.45, _g).y;
    if (this.position.y <= gy) {
      this.position.y = gy;
      if (this.vel.y < -12) g.hud.hurt(0.5);
      this.vel.y = 0;
      this.onGround = true;
    } else this.onGround = this.position.y - gy < 0.05;
    // walls & poles
    const p = this.position;
    world.query(p.x - 1, p.z - 1, p.x + 1, p.z + 1, _boxes, _cyls);
    for (const b of _boxes) {
      if (p.y + 1.7 < b.min.y || p.y > b.max.y - 0.4) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx, dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < R) {
        if (d > 1e-5) {
          p.x = cx + (dx / d) * R;
          p.z = cz + (dz / d) * R;
        } else {
          // inside: push out along the shortest axis
          const ex = [p.x - b.min.x, b.max.x - p.x, p.z - b.min.z, b.max.z - p.z];
          const i = ex.indexOf(Math.min(...ex));
          if (i === 0) p.x = b.min.x - R;
          else if (i === 1) p.x = b.max.x + R;
          else if (i === 2) p.z = b.min.z - R;
          else p.z = b.max.z + R;
        }
      }
    }
    for (const c of _cyls) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const rr = R + c.r;
      if (d < rr && d > 1e-5) {
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
      }
    }
    // cars: solid, and dangerous
    for (const car of g.cars) {
      if (car.removed) continue;
      if (car.body.position.distanceToSquared(p) > (car.radius + 1) ** 2) continue;
      car.body.toLocalPoint(_v.copy(p).setY(car.body.position.y), _l);
      const min = car.boundsMin, max = car.boundsMax;
      const cx = clamp(_l.x, min.x, max.x), cz = clamp(_l.z, min.z, max.z);
      const dx = _l.x - cx, dz = _l.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (p.y > car.body.position.y + max.y - 0.1) {
        // standing on the roof
        continue;
      }
      let nx, nz;
      if (d > 1e-5) {
        nx = dx / d;
        nz = dz / d;
      } else {
        nx = _l.x > 0 ? 1 : -1;
        nz = 0;
      }
      const push = R - d;
      _l.x += nx * push;
      _l.z += nz * push;
      car.body.toWorldPoint(_l, _v);
      p.x = _v.x;
      p.z = _v.z;
      const cv = car.body.velocity;
      if (cv.length() > 5) {
        // hit by a car
        this.vel.set(cv.x * 0.8, 3 + cv.length() * 0.15, cv.z * 0.8);
        this.onGround = false;
        g.hud.hurt(Math.min(1, cv.length() / 15));
        g.cam.addShake(0.8);
        g.audio?.clunk?.(null, 1);
        if (car.controller && car.controller.say) car.controller.say(['WATCH IT!', 'Get off the road!', 'Oh no oh no oh no'][Math.floor(Math.random() * 3)], 'angry');
      }
    }
    // prompt for nearby cars
    const near = this.findCar();
    this.nearCar = near;
    if (near) {
      const own = near === g.player.car;
      g.hud.prompt(`<kbd>F</kbd> ${own ? 'Get in' : near.police ? 'Steal the police car' : near.controller ? 'Carjack this ' + near.model.prof.b.name : 'Get in this ' + near.model.prof.b.name}`);
    } else g.hud.prompt(null);
  }

  updateCamera(dt, input) {
    const cam = this.game.camera;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * hs * 2.2;
    const bobY = this.onGround ? Math.sin(this.bob) * 0.04 * Math.min(1, hs / 3) : 0;
    cam.position.set(this.position.x, this.position.y + EYE + bobY, this.position.z);
    _e.set(this.pitch, this.yaw, Math.sin(this.bob * 0.5) * 0.006 * Math.min(1, hs / 3), 'YXZ');
    cam.quaternion.setFromEuler(_e);
    cam.fov = damp(cam.fov, 72, 4, dt);
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    void input;
  }
}
