import * as THREE from 'three';
import { RigidBody } from '../physics/body.js';
import { Powertrain } from './powertrain.js';
import { tireGain } from './tire.js';
import { clamp, valueNoise } from '../core/util.js';

const VMIN = 1.2; // m/s floor for slip denominators (keeps low speed stable)
const AIR = 1.225;
const SAMPLES = [-0.62, 0, 0.62];

const LEFT = new THREE.Vector3();
const UP = new THREE.Vector3();
const FWD = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _g = { y: 0, nx: 0, ny: 1, nz: 0, mat: null };

class Wheel {
  constructor(d, com) {
    this.id = d.id;
    this.front = d.front;
    this.left = d.left;
    this.steer = d.steer;
    this.share = d.share;
    this.radius = d.radius;
    this.rimRadius = d.rimRadius;
    this.width = d.width;
    this.sStatic = d.sStatic;
    this.L0 = d.L0;
    this.sMax = d.sMax;
    this.sMin = d.sMin;
    this.k = d.k;
    this.cBump = d.cBump;
    this.cRebound = d.cRebound;
    this.inertia = d.inertia;
    this.brake = d.brake;
    this.center = d.center.clone();
    this.hp = new THREE.Vector3(d.center.x, d.center.y + d.sStatic, d.center.z).sub(com);
    this.hp0 = this.hp.clone();
    this.staticLoad = 0;
    this.reset();
  }

  reset() {
    this.s = this.sStatic;
    this.sPrev = this.sStatic;
    this.sHit = this.sMax;
    this.omega = 0;
    this.spin = 0;
    this.yaw = 0;
    this.toe = 0;
    this.camber = 0;
    this.bend = 0;
    this.contact = false;
    this.load = 0;
    this.force = 0;
    this.slip = 0;
    this.slipRatio = 0;
    this.slipAngle = 0;
    this.slideVel = 0;
    this.fx = 0;
    this.fy = 0;
    this.kLong = 0;
    this.mu = 1;
    this.vx = 0;
    this.vy = 0;
    this.vden = VMIN;
    this.driveT = 0;
    this.detached = false;
    this.flat = 0;
    this.rNow = this.radius;
    this.mat = null;
    this.cp = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.hpWorld = new THREE.Vector3();
    this.fwdRaw = new THREE.Vector3();
    this.f = new THREE.Vector3();
    this.sd = new THREE.Vector3();
    this.worldPos = new THREE.Vector3();
    this.impact = 0; // suspension hit strength this frame (for sounds)
    this.hp.copy(this.hp0);
  }
}

/**
 * Raycast vehicle: rigid chassis, 4 independent spring/damper corners with
 * anti-roll bars, a combined-slip tire model per wheel, and a powertrain
 * driving the wheels through open / limited-slip / locked differentials.
 */
export class VehiclePhysics {
  constructor(tuning) {
    this.t = tuning;
    this.body = new RigidBody(tuning.mass, tuning.inertia);
    this.body.angularDamping = 0.05;
    this.wheels = tuning.wheels.map((d) => new Wheel(d, tuning.com));
    this.pt = new Powertrain(tuning.powertrain);
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.steerAngle = 0;
    this.wet = 0;
    this.tcsCut = 0;
    this.absActive = false;
    this.tcsActive = false;
    this.parkBrake = false;
    this.gripScale = 1;
    this.grounded = 0;
    this.airTime = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.trackF = Math.abs(this.wheels[0].hp.x) * 2;
    const g = 9.81;
    const fw = (tuning.com.z - tuning.dims.zR) / tuning.dims.WB;
    for (const w of this.wheels) w.staticLoad = (tuning.mass * g * (w.front ? fw : 1 - fw)) / 2;
    this.tanAPeak = Math.tan(tuning.tire.aPeak);
  }

  /** Put the car at rest on the ground at (x, groundY, z) facing yaw (0 = +z). */
  resetTo(x, groundY, z, yaw) {
    const b = this.body;
    const t = this.t;
    b.position.set(x, groundY + t.com.y + (this.wheels[0].sStatic - 0.24) + 0.02, z);
    b.quaternion.setFromAxisAngle(_a.set(0, 1, 0), yaw);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.sleeping = false;
    b.updateDerived();
    for (const w of this.wheels) {
      const keepDetached = w.detached;
      const toe = w.toe, bend = w.bend, flat = w.flat, hp = w.hp.clone();
      w.reset();
      w.detached = keepDetached;
      w.toe = toe;
      w.bend = bend;
      w.flat = flat;
      w.hp.copy(hp);
    }
  }

  get rpm() {
    return this.pt.rpm;
  }

  step(dt, world, gravity) {
    const b = this.body;
    if (b.sleeping) return;
    const t = this.t;
    const tire = t.tire;
    const input = this.input;
    b.axis(0, LEFT);
    b.axis(1, UP);
    b.axis(2, FWD);

    // ---------------- steering (Ackermann) ----------------
    const delta = clamp(input.steer, -1, 1) * t.maxSteer;
    this.steerAngle = delta;
    let yawL = 0, yawR = 0;
    if (Math.abs(delta) > 1e-4) {
      const WB = t.dims.WB;
      const Rt = WB / Math.tan(Math.abs(delta));
      const inner = Math.atan(WB / Math.max(Rt - this.trackF / 2, 0.5));
      const outer = Math.atan(WB / (Rt + this.trackF / 2));
      if (delta > 0) {
        yawR = -inner;
        yawL = -outer;
      } else {
        yawL = inner;
        yawR = outer;
      }
    }

    // ---------------- contacts & suspension compression ----------------
    let grounded = 0;
    const upY = UP.y;
    for (const w of this.wheels) {
      w.impact = 0;
      if (w.detached) {
        w.contact = false;
        w.force = 0;
        w.load = 0;
        continue;
      }
      const wobble = w.bend ? Math.sin(w.spin) * w.bend : 0;
      w.yaw = (w.steer ? (w.left ? yawL : yawR) : 0) + w.toe + wobble * 0.4;
      b.toWorldPoint(w.hp, w.hpWorld);
      _a.set(Math.sin(w.yaw), 0, Math.cos(w.yaw));
      b.toWorldDir(_a, w.fwdRaw);
      w.rNow = w.radius * (1 - 0.3 * w.flat);
      const R = w.rNow;
      w.contact = false;
      if (upY > 0.25) {
        let fx = w.fwdRaw.x, fz = w.fwdRaw.z;
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
        const o = w.hpWorld;
        let best = -1e9;
        for (let k = 0; k < 3; k++) {
          const off = SAMPLES[k] * R;
          const sx = o.x + fx * off, sz = o.z + fz * off;
          world.groundAt(sx, sz, o.y, _g);
          const rough = _g.mat.rough ? (valueNoise(sx * 2.7, sz * 2.7) - 0.5) * 2 * _g.mat.rough : 0;
          const hc = _g.y + rough + Math.sqrt(R * R - off * off);
          if (hc > best + 1e-4 || k === 1 && hc > best - 1e-4) {
            best = hc;
            w.normal.set(_g.nx, _g.ny, _g.nz);
            w.mat = _g.mat;
          }
        }
        const sHit = (o.y - best) / upY;
        w.sHit = sHit;
        if (sHit < w.sMax) {
          w.contact = true;
          grounded++;
        }
      }
      if (w.contact) {
        const sEff = Math.max(w.sHit, w.sMin);
        w.s = sEff;
      } else {
        w.s = Math.min(w.sMax, w.s + dt * 1.5);
      }
    }
    this.grounded = grounded;
    this.airTime = grounded === 0 ? this.airTime + dt : 0;

    // spring + damper + bump stop
    for (const w of this.wheels) {
      if (!w.contact) {
        w.force = 0;
        w.sPrev = w.s;
        continue;
      }
      const x = w.L0 - w.s;
      const xdot = (w.sPrev - w.s) / dt;
      w.sPrev = w.s;
      let F = w.k * Math.max(x, 0) + (xdot > 0 ? w.cBump : w.cRebound) * xdot;
      if (w.sHit < w.sMin) {
        const pen = Math.min(w.sMin - w.sHit, 0.15);
        F += w.k * 8 * pen + w.cBump * 2 * Math.max(xdot, 0);
        w.impact = Math.max(w.impact, pen);
      }
      w.force = F;
    }
    // anti-roll bars
    for (let axle = 0; axle < 2; axle++) {
      const l = this.wheels[axle * 2], r = this.wheels[axle * 2 + 1];
      if (l.detached || r.detached) continue;
      const xl = l.contact ? l.L0 - l.s : 0;
      const xr = r.contact ? r.L0 - r.s : 0;
      const f = t.antiRoll[axle] * (xl - xr);
      if (l.contact) l.force += f;
      if (r.contact) r.force -= f;
    }
    const maxF = t.mass * 9.81 * 3.5;
    for (const w of this.wheels) {
      if (!w.contact) continue;
      w.force = clamp(w.force, 0, maxF);
      w.load = w.force;
      _a.copy(UP).multiplyScalar(w.force);
      b.applyForce(_a, w.hpWorld);
    }

    // ---------------- tire state before drive update ----------------
    const wetMul = 1 - this.wet * (1 - tire.wet);
    for (const w of this.wheels) {
      if (!w.contact) {
        w.kLong = 0;
        continue;
      }
      const R = w.rNow;
      // contact point = bottom of the wheel
      w.cp.copy(w.hpWorld).addScaledVector(UP, -(w.s + R));
      const n = w.normal;
      w.f.copy(w.fwdRaw).addScaledVector(n, -w.fwdRaw.dot(n)).normalize();
      w.sd.crossVectors(n, w.f);
      b.pointVelocity(w.cp, _v);
      w.vx = _v.dot(w.f);
      w.vy = _v.dot(w.sd);
      const surf = w.mat || { grip: 1 };
      let grip = surf.grip;
      if (tire.offroad && surf.grip < 0.9) grip = Math.min(0.95, grip + 0.22);
      const ls = clamp(1 - tire.loadSens * (w.load / w.staticLoad - 1), 0.7, 1.15);
      w.mu = tire.mu * grip * wetMul * ls * this.gripScale * (1 - 0.45 * w.flat);
      w.vden = Math.max(Math.abs(w.vx), VMIN);
      const sx = (w.omega * R - w.vx) / w.vden / tire.kPeak;
      const sy = w.vy / w.vden / this.tanAPeak;
      const s = Math.hypot(sx, sy);
      const gain = tireGain(s, tire.falloff);
      w.fx0 = w.mu * w.load * gain * sx;
      w.kLong = (w.mu * w.load * gain * R) / (w.vden * tire.kPeak);
    }

    // ---------------- powertrain ----------------
    let drivenOmega = 0, S = 0, groundOmega = 0;
    for (const w of this.wheels) {
      if (w.share <= 0 || w.detached) continue;
      drivenOmega += w.share * w.omega;
      groundOmega += w.share * (w.contact ? w.vx / w.rNow : w.omega);
      S += (w.share * w.share) / (w.inertia + dt * w.rNow * w.kLong);
    }
    const thr = clamp(input.throttle, 0, 1) * (1 - this.tcsCut);
    const T = this.pt.update(dt, thr, drivenOmega, S || 1, grounded > 0, groundOmega);
    const parked = this.pt.selector === 'P' && this.pt.auto;

    // ---------------- wheel spin + tire forces ----------------
    this.absActive = false;
    let maxSpin = 0;
    for (const w of this.wheels) {
      if (w.detached) continue;
      const R = w.rNow;
      let Tb = clamp(input.brake, 0, 1) * t.brakes.max * w.brake;
      if (!w.front) Tb += clamp(input.handbrake, 0, 1) * t.brakes.handbrake;
      if (this.parkBrake && !w.front) Tb += t.brakes.handbrake * 1.5;
      if (parked && w.share > 0) Tb += 6000;
      if (t.assists.abs && input.brake > 0.1 && w.contact && Math.abs(w.vx) > 2.5) {
        const sr = (w.omega * R - w.vx) / w.vden;
        if (sr * Math.sign(w.vx) < -tire.kPeak * 1.25) {
          Tb *= 0.2;
          this.absActive = true;
        }
      }
      const Td = w.share > 0 ? T * w.share : 0;
      w.driveT = Td;
      if (w.contact) {
        const Tr = (0.012 + (w.mat ? w.mat.drag : 0) + w.flat * 0.04) * w.load * R;
        const Ieff = w.inertia + dt * R * w.kLong;
        let om = w.omega + (dt * (Td - R * w.fx0)) / Ieff;
        const cap = (dt * (Tb + Tr)) / Ieff;
        if (Math.abs(om) <= cap) om = 0;
        else om -= Math.sign(om) * cap;
        w.omega = om;
      } else {
        let om = w.omega + (dt * Td) / w.inertia;
        const cap = (dt * (Tb + 2)) / w.inertia;
        if (Math.abs(om) <= cap) om = 0;
        else om -= Math.sign(om) * cap;
        w.omega = om;
      }
    }
    // differentials
    this.applyDiff(0, 1, dt);
    this.applyDiff(2, 3, dt);
    if (t.diff !== 'open' && this.wheels[0].share > 0 && this.wheels[2].share > 0) {
      // AWD centre coupling
      const f = this.wheels[0], r = this.wheels[2];
      const avgF = (this.wheels[0].omega + this.wheels[1].omega) / 2;
      const avgR = (this.wheels[2].omega + this.wheels[3].omega) / 2;
      const d = (avgR - avgF) * (1 - Math.exp(-dt * 12)) * 0.5;
      this.wheels[0].omega += d; this.wheels[1].omega += d;
      this.wheels[2].omega -= d; this.wheels[3].omega -= d;
      void f; void r;
    }

    for (const w of this.wheels) {
      if (w.detached) continue;
      w.spin += w.omega * dt;
      if (!w.contact) {
        w.slip = 0;
        w.fx = w.fy = 0;
        w.slideVel = 0;
        continue;
      }
      const R = w.rNow;
      const slipV = w.omega * R - w.vx;
      const sx = slipV / w.vden / tire.kPeak;
      const sy = w.vy / w.vden / this.tanAPeak;
      const s = Math.hypot(sx, sy);
      const gain = tireGain(s, tire.falloff);
      w.fx = w.mu * w.load * gain * sx;
      w.fy = -w.mu * w.load * gain * sy;
      w.slip = s;
      w.slipRatio = slipV / w.vden;
      w.slipAngle = Math.atan2(w.vy, Math.abs(w.vx) + 0.01);
      w.slideVel = Math.hypot(slipV, w.vy);
      if (w.share > 0) {
        // excess spin speed beyond what the tyre needs for peak grip
        const dir = Math.sign(w.omega || 1);
        const excess = slipV * dir - Math.max(Math.abs(w.vx) * tire.kPeak * 1.3, 0.3);
        if (excess > maxSpin) maxSpin = excess;
      }
      _a.copy(w.f).multiplyScalar(w.fx).addScaledVector(w.sd, w.fy);
      _b.copy(w.cp).addScaledVector(UP, t.rollCenter);
      b.applyForce(_a, _b);
    }

    // traction control
    const cutTarget = t.assists.tcs && input.throttle > 0.1 ? clamp(maxSpin / 1.5, 0, 0.85) : 0;
    this.tcsCut += (cutTarget - this.tcsCut) * Math.min(1, dt * (cutTarget > this.tcsCut ? 25 : 6));
    this.tcsActive = this.tcsCut > 0.05;

    // ---------------- aerodynamics ----------------
    const v = b.velocity;
    const sp = v.length();
    this.speed = sp;
    this.forwardSpeed = v.dot(FWD);
    if (sp > 0.5) {
      _a.copy(v).multiplyScalar(-0.5 * AIR * t.aero.cdA * sp);
      _b.copy(b.position).addScaledVector(UP, 0.15);
      b.applyForce(_a, _b);
      const vf = this.forwardSpeed;
      const down = 0.5 * AIR * t.aero.clA * vf * vf;
      if (down > 1) {
        const bal = t.aero.balance;
        _c.set(0, 0, t.dims.zF - t.com.z);
        b.toWorldPoint(_c, _b);
        _a.copy(UP).multiplyScalar(-down * bal);
        b.applyForce(_a, _b);
        _c.set(0, 0, t.dims.zR - t.com.z);
        b.toWorldPoint(_c, _b);
        _a.copy(UP).multiplyScalar(-down * (1 - bal));
        b.applyForce(_a, _b);
      }
    }

    b.integrateVelocity(dt, gravity);
  }

  applyDiff(i, j, dt) {
    const a = this.wheels[i], c = this.wheels[j];
    if (a.share <= 0 || a.detached || c.detached) return;
    const mode = this.t.diff;
    if (mode === 'open') return;
    const avg = (a.omega * a.inertia + c.omega * c.inertia) / (a.inertia + c.inertia);
    const f = mode === 'locked' ? 1 : 1 - Math.exp(-dt * 30);
    a.omega += (avg - a.omega) * f;
    c.omega += (avg - c.omega) * f;
  }

  /** Update wheel world positions for rendering (call after integratePosition). */
  updateWheelPoses() {
    const b = this.body;
    b.axis(1, UP);
    for (const w of this.wheels) {
      b.toWorldPoint(w.hp, w.hpWorld);
      w.worldPos.copy(w.hpWorld).addScaledVector(UP, -w.s);
    }
  }
}
