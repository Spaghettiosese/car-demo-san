import * as THREE from 'three';
import { clamp, approach, lerp } from './core/util.js';

const _v = new THREE.Vector3();

/**
 * Turns raw input into car controls: keyboard steering smoothing + speed
 * sensitivity, optional counter-steer assist, automatic reverse, manual shifting.
 */
export class PlayerDriver {
  constructor(game) {
    this.game = game;
    this.revHold = 0;
    this.steer = 0;
  }

  update(car, dt, input) {
    const s = this.game.settings;
    const d = input.drive();
    const pt = car.phys.pt;
    const inp = car.phys.input;
    const v = car.speed;
    const fwd = car.forwardSpeed;
    // ignition helpers
    if (!pt.running && !pt.cranking && d.throttle > 0.3 && s.autoIgnition && !car.wrecked && pt.energyFrac > 0 && !pt.hydrolocked) car.startEngine();

    // ---- clutch (realistic mode: you work it; otherwise it's automatic) ----
    pt.manualClutch = s.clutch === 'manual' && !pt.auto && !pt.ev;
    const pedal = d.clutch;
    // keyboard: quick to press, gentle to release so launches are possible
    pt.clutchPedal = pedal > pt.clutchPedal ? Math.min(pedal, pt.clutchPedal + dt * 8) : Math.max(pedal, pt.clutchPedal - dt * (pedal > 0.01 ? 6 : 1.6));

    // ---- steering ----
    let target;
    if (d.wheel) {
      // real steering wheel: map the rim angle 1:1 (calibrated range)
      const range = (s.wheelLock || s.wheelRange || 900) / 2;
      const lock = 424; // the cockpit wheel turns 7.4 rad (~424 deg) to full lock
      // calibration maps the measured left/centre/right axis values to -1/0/1
      let ax = input.padAxes[0] || 0;
      const cal = s.wheelCal;
      if (cal && cal.max !== cal.min) ax = ax < cal.center ? (ax - cal.center) / Math.max(1e-3, cal.center - cal.min) : (ax - cal.center) / Math.max(1e-3, cal.max - cal.center);
      target = clamp(ax * (range / lock), -1, 1);
    } else if (d.analog) {
      const sens = 1 / (1 + v * 0.02);
      target = d.steer * lerp(1, sens, s.steerAssist ? 0.8 : 0.3);
    } else {
      const sens = 1 / (1 + v * 0.048);
      target = d.steer * (s.steerAssist ? sens : Math.max(sens, 0.55));
    }
    if (s.steerAssist && fwd > 4) {
      // counter-steer: point the front wheels along the direction of travel when the rear slides
      car.body.toLocalDir(car.body.velocity, _v);
      const beta = Math.atan2(_v.x, Math.max(_v.z, 0.1));
      const counter = clamp(-beta * 1.4 / car.tuning.maxSteer, -0.8, 0.8);
      if (Math.abs(beta) > 0.05) target = clamp(target + counter * (d.steer === 0 ? 1 : 0.5), -1, 1);
    }
    let rate = d.analog || d.wheel ? 12 : Math.abs(target) > Math.abs(this.steer) && Math.sign(target) === Math.sign(this.steer || target) ? 2.6 : 5.5;
    // self-centring: the tyres' aligning torque pulls the wheel straight faster at speed
    if (!d.analog && !d.wheel && d.steer === 0) rate *= 0.6 + clamp(v / 18, 0, 1) * 0.8 + Math.abs(car.phys.selfAlign) * 2;
    this.steer = d.wheel ? target : approach(this.steer, target, rate * dt);
    inp.steer = this.steer;

    // ---- throttle / brake / gears ----
    let thr = d.throttle, brk = d.brake;
    if (pt.auto) {
      if (pt.running && (pt.selector === 'P' || pt.selector === 'N') && thr > 0.05) pt.setSelector('D');
      if (pt.selector === 'D' || pt.selector === 'P') {
        if (brk > 0.3 && thr < 0.05 && Math.abs(fwd) < 0.8) {
          this.revHold += dt;
          if (this.revHold > 0.35 && pt.running) {
            pt.setSelector('R');
            this.revHold = 0;
          }
        } else this.revHold = 0;
      } else if (pt.selector === 'R') {
        if (thr > 0.3 && brk < 0.05 && fwd > -0.8) {
          this.revHold += dt;
          if (this.revHold > 0.2) {
            pt.setSelector('D');
            this.revHold = 0;
          }
        } else this.revHold = 0;
      }
      if (pt.selector === 'R') {
        const t = thr;
        thr = brk;
        brk = t;
      }
    } else {
      // H-pattern: number keys pick a gear directly
      const talking = this.game?.police?.stop; // number keys answer the officer during a traffic stop
      if (!talking) for (let g = 1; g <= 7; g++) if (input.pressed('gear' + g) && g <= pt.gearCount) pt.shiftTo(g);
      if (input.pressed('gearR')) {
        if (fwd > 2) this.game.toast?.('Too fast for reverse');
        else pt.shiftTo(-1);
      }
      if (input.pressed('gearN')) pt.shiftTo(0);
      if (input.pressed('shiftUp')) pt.shiftUp();
      if (input.pressed('shiftDown')) {
        if (pt.gear === 1 && Math.abs(fwd) > 3) pt.shiftDown();
        else if (pt.gear <= 1) pt.shiftTo(pt.gear - 1);
        else pt.shiftDown();
      }
    }
    if (pt.auto && (input.pressed('shiftUp') || input.pressed('shiftDown')) && pt.selector === 'D') {
      // tiptronic-style request: switch to manual mode on the fly
      pt.auto = false;
      pt.selector = 'M';
      if (input.pressed('shiftUp')) pt.shiftUp();
      else pt.shiftDown();
      this.game.toast?.('Manual shifting (Z / X). Press again with T to return to auto.');
    }
    // cruise control (PI on speed) and speed limiter
    const ext = car.ext;
    if (ext) {
      const cr = ext.cruise;
      if (cr.on && pt.running) {
        const e = cr.speed - fwd;
        this.cruiseI = clamp((this.cruiseI || 0) + e * dt, -20, 40);
        const auto = clamp(0.12 * e + 0.025 * this.cruiseI, 0, 1);
        if (thr < auto) thr = auto;
      } else this.cruiseI = 0;
      const lim = ext.limiter;
      if (lim.on && fwd > lim.speed - 1.5) thr = Math.min(thr, clamp((lim.speed - fwd) * 0.35, 0, 1));
    }
    inp.throttle = thr;
    inp.brake = brk;
    // rumble: wheelspin / slides, ABS pulses, curbs and bumps
    if (input.pad && s.rumble !== false) {
      this.rumbleT = (this.rumbleT || 0) - dt;
      if (this.rumbleT <= 0) {
        this.rumbleT = 0.06;
        let slip = 0, bump = 0;
        for (const w of car.phys.wheels) {
          if (!w.contact) continue;
          slip = Math.max(slip, clamp((w.slideVel - 2) / 10, 0, 1));
          bump = Math.max(bump, w.impact * 6);
        }
        const abs = car.phys.absActive ? 0.5 : 0;
        const hit = clamp(car.lastImpact / 12, 0, 1);
        input.rumble(Math.max(hit, bump * 0.6, abs), Math.max(slip * 0.5, abs * 0.6, (pt.rpm / (pt.spec.redline || 7000)) * 0.08), 80);
      }
    }
    inp.handbrake = input.down('handbrake') ? 1 : 0;
    // hold the car when stopped with the engine off
    car.phys.parkBrake = (!pt.running && v < 0.5 && thr < 0.05) || !!car.parkLever;
  }
}
