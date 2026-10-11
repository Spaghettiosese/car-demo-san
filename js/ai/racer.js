import * as THREE from 'three';
import { clamp, lerp, wrapAngle } from '../core/util.js';
import { CITY } from '../world/city.js';
import { nearestNode } from './gps.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Catmull-Rom resample of control points into an evenly spaced polyline. */
export function smoothPath(points, spacing = 2, closed = false) {
  const P = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(P, closed, 'centripetal', 0.5);
  const len = curve.getLength();
  const n = Math.max(2, Math.round(len / spacing));
  const out = curve.getSpacedPoints(n);
  if (closed) out.pop();
  return out;
}

/**
 * A driver that follows a racing line as fast as its tyres allow:
 * curvature-limited speed profile with a backward braking pass, pure-pursuit
 * steering, overtaking offsets around slower cars, and reset-on-track.
 */
export class PathDriver {
  constructor(game, car, path, opts = {}) {
    this.game = game;
    this.car = car;
    car.controller = this;
    this.closed = !!opts.closed;
    this.skill = opts.skill ?? 0.9; // fraction of the grip limit used
    this.aggression = opts.aggression ?? 0.5;
    this.offset = 0;
    this.offsetTarget = opts.laneOffset || 0;
    this.baseOffset = opts.laneOffset || 0;
    this.i = 0;
    this.lap = 0;
    this.progress = 0; // total distance travelled along the path
    this.stuck = 0;
    this.reverseT = 0;
    this.finished = false;
    this.ignoreLights = true;
    this.speedScale = 1;
    this.keepAwake = true;
    this.setPath(path);
  }

  setPath(path) {
    this.path = path;
    const n = path.length;
    this.s = new Float32Array(n);
    for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1] + path[i].distanceTo(path[i - 1]);
    this.length = this.s[n - 1] + (this.closed ? path[n - 1].distanceTo(path[0]) : 0);
    this.computeSpeeds();
    this.i = 0;
  }

  computeSpeeds() {
    const P = this.path, n = P.length;
    const mu = this.car.tuning.tire.mu * (this.car.phys.gripScale || 1);
    const g = 9.81;
    const vmax = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = P[(i - 2 + n) % n], b = P[i], c = P[(i + 2) % n];
      if (!this.closed && (i < 2 || i > n - 3)) {
        vmax[i] = 80;
        continue;
      }
      const a1 = Math.atan2(b.x - a.x, b.z - a.z), a2 = Math.atan2(c.x - b.x, c.z - b.z);
      const ds = Math.max(1, a.distanceTo(b) + b.distanceTo(c));
      const k = Math.abs(wrapAngle(a2 - a1)) / ds;
      vmax[i] = k > 1e-4 ? Math.min(80, Math.sqrt((mu * g * 0.88) / k)) : 80;
    }
    // braking pass (twice for closed loops)
    const brake = mu * g * 0.75;
    for (let pass = 0; pass < (this.closed ? 2 : 1); pass++) {
      for (let i = n - 2 + (this.closed ? 1 : 0); i >= 0; i--) {
        const j = (i + 1) % n;
        const ds = P[i].distanceTo(P[j]);
        vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[j] * vmax[j] + 2 * brake * ds));
      }
    }
    this.vmax = vmax;
  }

  /** Nearest path index around the current one. */
  track() {
    const P = this.path, n = P.length;
    const p = this.car.body.position;
    let best = this.i, bd = Infinity;
    for (let k = -3; k <= 12; k++) {
      let j = this.i + k;
      if (this.closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      const d = (P[j].x - p.x) ** 2 + (P[j].z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (this.closed && best < this.i - n / 2) this.lap++;
    this.i = best;
    this.offPath = Math.sqrt(bd);
    this.progress = this.lap * this.length + this.s[best];
  }

  pointAhead(dist, out) {
    const P = this.path, n = P.length;
    let j = this.i;
    let acc = 0;
    while (acc < dist) {
      const nj = this.closed ? (j + 1) % n : Math.min(n - 1, j + 1);
      if (nj === j) break;
      acc += P[j].distanceTo(P[nj]);
      j = nj;
    }
    out.copy(P[j]);
    const nj = this.closed ? (j + 1) % n : Math.min(n - 1, j + 1);
    const dx = P[nj].x - P[j].x, dz = P[nj].z - P[j].z;
    const l = Math.hypot(dx, dz) || 1;
    out.tx = dx / l;
    out.tz = dz / l;
    out.idx = j;
    return out;
  }

  setInputs(t, b, s, hb = 0) {
    const inp = this.car.phys.input;
    inp.throttle = t;
    inp.brake = b;
    inp.steer = s;
    inp.handbrake = hb;
  }

  /** Called each frame. */
  update(dt) {
    const car = this.car;
    if (car.removed) return;
    car.sys.ignition = 'on';
    car.physicsActive = true;
    car.body.sleeping = false;
    const pt = car.phys.pt;
    if (!pt.running && !car.wrecked) {
      pt.running = true;
      pt.omega = 100;
    }
    if (pt.selector !== 'D' && this.reverseT <= 0) pt.setSelector('D');
    if (this.frozen) {
      this.setInputs(0, 1, 0);
      return;
    }
    if (this.finished) {
      this.setInputs(0, 0.6, 0);
      return;
    }
    this.track();
    const v = Math.max(0, car.forwardSpeed);
    // overtaking: shift laterally around slower cars ahead
    this.avoid(dt);
    this.offset += (this.offsetTarget - this.offset) * Math.min(1, dt * 1.5);
    const Ld = clamp(5 + v * 0.42, 6, 26);
    const tp = this.pointAhead(Ld, _v);
    const sideX = -tp.tz, sideZ = tp.tx; // right of travel (offset > 0 = right)
    tp.x += sideX * this.offset;
    tp.z += sideZ * this.offset;
    car.body.toLocalPoint(_v2.set(tp.x, car.body.position.y, tp.z), _v2);
    const L2 = _v2.x * _v2.x + _v2.z * _v2.z;
    const kappa = (2 * _v2.x) / Math.max(L2, 1);
    const delta = Math.atan(car.tuning.dims.WB * kappa);
    let steer = clamp(-delta / car.tuning.maxSteer, -1, 1);
    // target speed: min over a short look-ahead window
    let target = 80;
    const n = this.path.length;
    const look = Math.ceil((v * 0.6 + 6) / 2);
    for (let k = 0; k < look; k++) {
      let j = this.i + k;
      j = this.closed ? j % n : Math.min(n - 1, j);
      target = Math.min(target, this.vmax[j]);
    }
    target *= this.skill * this.speedScale;
    if (this.targetCap) target = Math.min(target, this.targetCap);
    if (!this.closed && this.i >= n - 2) target = 0;
    let thr = 0, brk = 0;
    if (v < target - 0.5) thr = clamp((target - v) * 0.25 + 0.4, 0, 1);
    else if (v > target + 0.8) brk = clamp((v - target) * 0.18, 0, 1);
    else thr = 0.3;
    // countersteer if the rear steps out
    car.body.toLocalDir(car.body.velocity, _fwd);
    const beta = Math.atan2(_fwd.x, Math.max(_fwd.z, 0.5));
    if (Math.abs(beta) > 0.12 && v > 6) {
      steer = clamp(steer - beta * 1.2, -1, 1);
      thr *= 0.6;
    }
    // stuck / off track recovery
    if (thr > 0.5 && v < 1) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    const flipped = car.body.R[4] < 0.3;
    if (flipped) this.flipT = (this.flipT || 0) + dt;
    else this.flipT = 0;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      pt.setSelector('R');
      this.setInputs(0.6, 0, -steer);
      if (this.reverseT <= 0) pt.setSelector('D');
      return;
    }
    if (this.stuck > 1.8) {
      this.stuck = 0;
      this.reverseT = 1.3;
      this.resets = (this.resets || 0) + 1;
    }
    if (this.flipT > 2.5 || this.offPath > 25 || (this.resets || 0) > 3) this.resetOnTrack();
    this.steerCmd = (this.steerCmd || 0) + (steer - (this.steerCmd || 0)) * Math.min(1, dt * 12);
    this.setInputs(thr, brk, this.steerCmd);
  }

  avoid(dt) {
    const car = this.car;
    const p = car.body.position;
    car.body.axis(2, _fwd);
    let blockL = 0, blockR = 0, ahead = null;
    for (const c of this.game.cars) {
      if (c === car || c.removed) continue;
      const rx = c.body.position.x - p.x, rz = c.body.position.z - p.z;
      const along = rx * _fwd.x + rz * _fwd.z;
      if (along < 0 || along > 28) continue;
      const lat = rx * -_fwd.z + rz * _fwd.x; // > 0 = to our right
      if (Math.abs(lat) > 6) continue;
      const closing = car.forwardSpeed - c.body.velocity.dot(_fwd);
      if (closing < 1 && along > 8) continue;
      if (Math.abs(lat - this.offset) < 2.4) ahead = c;
      if (lat > 0) blockR++;
      else blockL++;
    }
    if (ahead) {
      this.offsetTarget = this.baseOffset + (blockR <= blockL ? 3.2 : -3.2);
      this.avoidT = 1.2;
    } else if ((this.avoidT = (this.avoidT || 0) - dt) <= 0) this.offsetTarget = this.baseOffset;
  }

  resetOnTrack() {
    const car = this.car;
    const P = this.path;
    const j = Math.max(0, this.i - 2);
    const a = P[j], b = P[Math.min(P.length - 1, j + 1)];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const g = this.game.world.groundAt(a.x, a.z, 50, { y: 0 });
    car.placeAt(a.x, g.y + 0.2, a.z, yaw);
    car.phys.pt.running = true;
    car.phys.pt.setSelector('D');
    this.stuck = 0;
    this.flipT = 0;
    this.resets = 0;
    this.reverseT = 0;
  }
}

/** Demolition derby: pick the nearest rival and drive through it. */
export class DerbyDriver {
  constructor(game, car, rivals) {
    this.game = game;
    this.car = car;
    car.controller = this;
    this.rivals = rivals;
    this.target = null;
    this.retarget = 0;
    this.reverseT = 0;
    this.stuck = 0;
    this.keepAwake = true;
    this.out = false;
    this.aggro = 0.7 + Math.random() * 0.3;
  }
  update(dt) {
    const car = this.car;
    if (car.removed) return;
    car.physicsActive = true;
    car.body.sleeping = false;
    car.sys.ignition = 'on';
    const pt = car.phys.pt;
    if (!pt.running && !car.wrecked && !this.out) {
      pt.running = true;
      pt.omega = 100;
    }
    if (this.out || this.frozen) {
      car.phys.input.throttle = 0;
      car.phys.input.brake = this.frozen ? 1 : 0.3;
      return;
    }
    this.retarget -= dt;
    if (!this.target || this.target.removed || this.target.derbyOut || this.retarget <= 0) {
      this.retarget = 3 + Math.random() * 3;
      let best = null, bd = Infinity;
      for (const r of this.rivals) {
        if (r === car || r.removed || r.derbyOut) continue;
        const d = r.body.position.distanceTo(car.body.position) * (0.7 + Math.random() * 0.6);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      this.target = best;
    }
    if (!this.target) {
      car.phys.input.throttle = 0;
      return;
    }
    const tp = _v.copy(this.target.body.position).addScaledVector(this.target.body.velocity, 0.4);
    car.body.toLocalPoint(tp.setY(car.body.position.y), _v2);
    const ang = Math.atan2(_v2.x, _v2.z);
    const v = car.forwardSpeed;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      pt.setSelector('R');
      car.phys.input.throttle = 0.8;
      car.phys.input.brake = 0;
      car.phys.input.steer = clamp(ang * 1.5, -1, 1);
      if (this.reverseT <= 0) pt.setSelector('D');
      return;
    }
    if (pt.selector !== 'D') pt.setSelector('D');
    if (Math.abs(v) < 1 && car.phys.input.throttle > 0.5) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 1.2 || (Math.abs(ang) > 2.2 && _v2.length() < 14)) {
      this.reverseT = 1 + Math.random();
      this.stuck = 0;
    }
    car.phys.input.steer = clamp(-ang * 2, -1, 1);
    car.phys.input.throttle = clamp(0.5 + this.aggro * 0.5 - Math.abs(ang) * 0.2, 0.3, 1);
    car.phys.input.brake = 0;
    car.phys.input.handbrake = Math.abs(ang) > 1.2 && v > 8 ? 1 : 0;
  }
}

/**
 * A suspect fleeing through the streets: picks intersections that lead away
 * from the pursuer and races along them, ignoring red lights.
 */
export class FleeDriver extends PathDriver {
  constructor(game, car, pursuer) {
    const pts = FleeDriver.routeFrom(game, car.body.position, pursuer.body.position, null);
    super(game, car, pts, { skill: 0.82 });
    this.pursuer = pursuer;
    this.node = null;
    this.replan = 0;
  }
  static routeFrom(game, from, away, prevNode) {
    const city = game.city;
    let n = nearestNode(city, from);
    const pts = [from.clone()];
    let prev = prevNode;
    for (let k = 0; k < 4; k++) {
      pts.push(new THREE.Vector3(n.x, 0, n.z));
      const outs = n.out.filter((s) => !prev || s.to !== prev);
      let best = outs[0], bs = -Infinity;
      for (const s of outs) {
        const d = Math.hypot(s.to.x - away.x, s.to.z - away.z) + Math.random() * 60;
        if (d > bs) {
          bs = d;
          best = s;
        }
      }
      prev = n;
      n = best.to;
    }
    pts.push(new THREE.Vector3(n.x, 0, n.z));
    // keep to the right lane
    return smoothPath(pts, 2).map((p, i, arr) => {
      const q = arr[Math.min(arr.length - 1, i + 1)], r = arr[Math.max(0, i - 1)];
      const dx = q.x - r.x, dz = q.z - r.z;
      const l = Math.hypot(dx, dz) || 1;
      return new THREE.Vector3(p.x - (dz / l) * 1.75, 0, p.z + (dx / l) * 1.75);
    });
  }
  update(dt) {
    this.replan -= dt;
    if (this.path && (this.i > this.path.length - 30 || this.replan <= 0)) {
      this.replan = 6;
      const pts = FleeDriver.routeFrom(this.game, this.car.body.position, this.pursuer.body.position, null);
      this.setPath(pts);
      this.i = 0;
    }
    super.update(dt);
    if (this.game.audio && Math.random() < 0.003) this.game.audio.hornAt(this.car, 0.4, true);
  }
}

export { CITY };
