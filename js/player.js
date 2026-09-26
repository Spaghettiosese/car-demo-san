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
    if (!pt.running && !pt.cranking && d.throttle > 0.3 && s.autoIgnition && !car.wrecked && pt.fuel > 0) car.startEngine();

    // ---- steering ----
    let target;
    if (d.analog) {
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
    const rate = d.analog ? 10 : Math.abs(target) > Math.abs(this.steer) && Math.sign(target) === Math.sign(this.steer || target) ? 2.6 : 5.5;
    this.steer = approach(this.steer, target, rate * dt);
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
    inp.throttle = thr;
    inp.brake = brk;
    inp.handbrake = input.down('handbrake') ? 1 : 0;
    // hold the car when stopped with the engine off
    car.phys.parkBrake = (!pt.running && v < 0.5 && thr < 0.05) || !!car.parkLever;
  }
}
