import { clamp, lerp, smoothstep, table, approach } from '../core/util.js';

const RPM = 60 / (2 * Math.PI);

/**
 * Engine + clutch + gearbox for combustion cars, or motor + reduction gear for EVs.
 *
 * The clutch is solved implicitly: each step we compute the torque that would
 * bring engine speed and gearbox input speed together, then clamp it to what
 * the clutch can hold. That one trick gives stable lock-up, slip on launch,
 * stalls, burnouts and rev-matched downshifts without special cases.
 */
export class Powertrain {
  constructor(spec) {
    this.spec = spec;
    this.ev = spec.type === 'ev';
    this.omega = 0;
    this.rpm = 0;
    this.gear = 0; // -1 reverse, 0 neutral, 1..n
    this.selector = 'P'; // automatic selector P R N D (manual uses N/R/1..n)
    this.auto = spec.auto !== false;
    this.running = false;
    this.cranking = false;
    this.crankTime = 0;
    this.crankNeeded = 0.7;
    this.clutch = 0;
    this.shiftTimer = 0;
    this.pendingGear = 0;
    this.sinceShift = 10;
    this.boost = 0;
    this.throttle = 0; // effective (after idle control / cuts)
    this.load = 0; // 0..1 how hard the engine works (for sound)
    this.torque = 0;
    this.wheelTorque = 0;
    this.limiterTimer = 0;
    this.fuel = spec.tank ?? 55;
    this.temp = 22;
    this.health = 1;
    this.radiator = 1;
    this.oilLeak = 0;
    this.misfire = false;
    this.events = [];
    this.lastThrottle = 0;
    this.popTimer = 0;
    this.revMatch = true;
    this.fuelScale = 1;
    this.infiniteFuel = false;
    this.overrun = 0;
  }

  get gearCount() {
    return this.ev ? 1 : this.spec.gears.length;
  }

  ratio(gear = this.gear) {
    const s = this.spec;
    if (this.ev) return gear === 0 ? 0 : gear < 0 ? -s.final : s.final;
    if (gear === 0) return 0;
    if (gear < 0) return -s.reverse * s.final;
    return s.gears[gear - 1] * s.final;
  }

  // ---------- ignition ----------
  startCrank() {
    if (this.running) return;
    this.cranking = true;
    this.crankTime = 0;
    // damaged/cold engines take longer, may not catch
    this.crankNeeded = 0.55 + Math.random() * 0.35 + (1 - this.health) * 1.5;
    this.events.push({ type: 'crank' });
  }
  stopCrank() {
    if (this.cranking) this.events.push({ type: 'crankEnd' });
    this.cranking = false;
  }
  shutOff() {
    if (this.running) this.events.push({ type: 'shutoff' });
    this.running = false;
    this.cranking = false;
  }

  maxTorqueAt(rpm) {
    const s = this.spec;
    if (this.ev) {
      const w = Math.max(rpm / RPM, 1);
      return Math.min(s.maxTorque, s.maxPower / w);
    }
    return table(s.torque, rpm);
  }

  // ---------- gear changes ----------
  shiftTo(g) {
    if (this.ev) {
      this.gear = g;
      return;
    }
    const n = this.spec.gears.length;
    g = clamp(g, -1, n);
    if (g === this.gear || this.shiftTimer > 0) return;
    this.pendingGear = g;
    this.shiftTimer = this.spec.shiftTime;
    this.sinceShift = 0;
    this.events.push({ type: 'shift', up: g > this.gear });
  }
  shiftUp() {
    this.shiftTo(this.shiftTimer > 0 ? this.pendingGear + 1 : this.gear + 1);
  }
  shiftDown() {
    this.shiftTo(this.shiftTimer > 0 ? this.pendingGear - 1 : this.gear - 1);
  }

  /** Automatic selector (P/R/N/D). */
  setSelector(sel) {
    if (this.selector === sel) return;
    this.selector = sel;
    if (sel === 'P' || sel === 'N') this.shiftTo(0);
    else if (sel === 'R') this.shiftTo(-1);
    else if (sel === 'D' && this.gear <= 0) this.shiftTo(1);
    if (this.ev) this.gear = sel === 'R' ? -1 : sel === 'D' ? 1 : 0;
    this.events.push({ type: 'selector', sel });
  }

  /**
   * Automatic gearbox. Decisions use the rpm implied by ground speed (not
   * wheel speed), so wheelspin doesn't cause gear hunting; sitting on the
   * limiter for a while still short-shifts to calm the spin.
   */
  autoShift(throttle, groundOmega, grounded, dt) {
    if (!this.auto || this.ev || this.selector !== 'D' || this.shiftTimer > 0 || this.gear < 1) return;
    const s = this.spec;
    const n = s.gears.length;
    this.limiterHold = this.rpm > s.redline * 0.97 ? (this.limiterHold || 0) + dt : 0;
    const groundRpm = Math.abs(groundOmega * this.ratio()) * RPM;
    const upAt = lerp(s.redline * 0.4, s.redline * 0.95, smoothstep(0.1, 0.9, throttle));
    if (this.gear < n && grounded && this.sinceShift > 0.45 && (groundRpm > upAt || this.limiterHold > 1.2)) {
      this.shiftTo(this.gear + 1);
      this.lastUp = true;
      return;
    }
    if (this.gear > 1) {
      const lower = Math.abs(groundOmega * this.ratio(this.gear - 1)) * RPM;
      const downAt = lerp(s.idle * 1.6, s.redline * 0.55, throttle * throttle);
      const wait = this.lastUp ? 1.1 : 0.4;
      if (groundRpm < downAt && lower < s.redline * 0.8 && this.sinceShift > wait) {
        this.shiftTo(this.gear - 1);
        this.lastUp = false;
      }
    }
  }

  /**
   * Advance one physics step.
   * @param drivenOmega weighted average spin of the driven wheels (rad/s)
   * @param S sum(share^2 / Ieff) over driven wheels (1/(kg m^2))
   * @returns torque delivered to the driven wheels (sum)
   */
  update(dt, throttleIn, drivenOmega, S, grounded, groundOmega = drivenOmega) {
    this.groundOmega = groundOmega;
    const s = this.spec;
    this.sinceShift += dt;
    if (this.events.length > 32) this.events.length = 0;
    return this.ev ? this.updateEV(dt, throttleIn, drivenOmega) : this.updateICE(dt, throttleIn, drivenOmega, S, grounded);
  }

  updateEV(dt, throttleIn, drivenOmega) {
    const s = this.spec;
    const r = this.ratio();
    this.omega = Math.abs(drivenOmega * s.final);
    this.rpm = this.omega * RPM;
    this.boost = 0;
    if (!this.running || r === 0) {
      this.throttle = 0;
      this.load = 0;
      this.wheelTorque = 0;
      return 0;
    }
    const thr = throttleIn * (0.4 + 0.6 * this.health);
    let t = thr * this.maxTorqueAt(this.rpm);
    if (this.rpm > s.maxRPM) t = 0;
    // regen braking when coasting
    const regen = throttleIn < 0.02 ? -Math.sign(drivenOmega * Math.sign(r)) * Math.min(90, this.omega * 0.35) : 0;
    this.throttle = thr;
    this.load = Math.abs(t) / s.maxTorque;
    this.torque = t;
    this.wheelTorque = t * r + regen * Math.abs(r);
    return this.wheelTorque;
  }

  updateICE(dt, throttleIn, drivenOmega, S, grounded) {
    const s = this.spec;
    // --- starter ---
    if (this.cranking) {
      this.crankTime += dt;
      if (this.fuel > 0 && this.health > 0.02 && this.crankTime > this.crankNeeded) {
        this.running = true;
        this.cranking = false;
        this.events.push({ type: 'start' });
      } else if (this.crankTime > 6) this.stopCrank();
    }
    // --- shifting ---
    this.autoShift(throttleIn, this.groundOmega, grounded, dt);
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= s.shiftTime * 0.5 && this.gear !== this.pendingGear) this.gear = this.pendingGear;
      if (this.shiftTimer < 0) this.shiftTimer = 0;
    }
    const shifting = this.shiftTimer > 0;
    const r = this.ratio();
    const inputOmega = drivenOmega * r;
    const idle = s.idle;
    const rpm = this.omega * RPM;

    // --- throttle, idle control, limiter, misfire ---
    let thr = throttleIn;
    if (shifting) thr *= 0.15; // lift while the clutch is open
    const curve = Math.max(this.maxTorqueAt(Math.max(rpm, 400)), 1);
    const friction = s.friction[0] + (s.friction[1] * rpm) / 1000;
    const pumping = s.peakTorque * 0.07 * (rpm / s.redline);
    if (this.running) {
      const idleThr = clamp((friction + pumping * 0.5) / curve + (idle - rpm) * 0.0012, 0, 0.45);
      thr = Math.max(thr, idleThr);
    }
    if (this.limiterTimer > 0) {
      this.limiterTimer -= dt;
      thr = 0;
    } else if (rpm > s.limiter) {
      this.limiterTimer = 0.07;
      this.events.push({ type: 'limiter' });
      thr = 0;
    }
    this.misfire = false;
    if (this.running && this.health < 0.45 && Math.random() < (0.45 - this.health) * 0.5 * dt * 60) {
      thr *= 0.2;
      this.misfire = true;
    }
    if (!this.running) thr = 0;

    // --- turbo ---
    if (s.turbo) {
      const tb = s.turbo;
      const spool = smoothstep(tb.spoolStart, tb.spoolFull, rpm);
      const target = thr * spool;
      const rate = target > this.boost ? 1 / tb.lag : 3.5;
      const before = this.boost;
      this.boost += (target - this.boost) * Math.min(1, rate * dt);
      if (this.lastThrottle > 0.6 && throttleIn < 0.2 && before > 0.45) this.events.push({ type: 'blowoff', amount: before });
    }
    const boostMul = s.turbo ? 1 + this.boost * s.turbo.gain : 1;
    const powerMul = (0.3 + 0.7 * Math.pow(this.health, 0.7)) * s.tune;

    let Te = thr * curve * boostMul * powerMul - (friction + pumping * (1 - thr)) * Math.sign(this.omega || 1);
    if (this.cranking && rpm < 320) Te += 45;
    this.torque = Te;

    // --- clutch ---
    let target = 0;
    if (r !== 0 && !shifting) {
      const wheelRpm = Math.abs(inputOmega) * RPM;
      if (wheelRpm > idle * 1.02) target = 1;
      else target = smoothstep(idle * 0.9, idle + 450 + 1300 * throttleIn, rpm);
      if (!this.running) target = 0;
    }
    const clutchRate = shifting ? 30 : target > this.clutch ? (this.sinceShift < 1 ? 14 : 5) : 20;
    this.clutch = approach(this.clutch, target, clutchRate * dt);

    const Ie = s.inertia;
    let Tc = 0;
    if (r !== 0 && this.clutch > 0) {
      const num = this.omega - inputOmega + (Te * dt) / Ie;
      const den = dt / Ie + r * r * dt * S;
      Tc = num / den;
      const cap = s.clutchMax * this.clutch;
      if (Tc > cap) Tc = cap;
      else if (Tc < -cap) Tc = -cap;
    }
    this.omega += ((Te - Tc) * dt) / Ie;
    // rev-match blip while the clutch is open during a downshift
    if (shifting && this.revMatch && this.running && this.gear >= 1) {
      const target = Math.abs(drivenOmega * this.ratio(this.pendingGear));
      if (target > this.omega) this.omega += (target - this.omega) * Math.min(1, dt * 18);
    }
    if (this.omega < 0) this.omega = 0;
    this.rpm = this.omega * RPM;
    if (this.running && this.rpm < 280) {
      this.running = false;
      this.events.push({ type: 'stall' });
    }

    // --- overrun pops & backfires ---
    if (this.running && throttleIn < 0.05 && this.lastThrottle > 0.5 && this.rpm > s.redline * 0.55) this.overrun = 0.6 + Math.random() * 0.5;
    if (this.overrun > 0) {
      this.overrun -= dt;
      this.popTimer -= dt;
      if (this.popTimer <= 0 && throttleIn < 0.1 && this.rpm > s.redline * 0.35) {
        this.popTimer = 0.04 + Math.random() * 0.12;
        const chance = s.antilag ? 0.8 : 0.35 * s.popiness;
        if (Math.random() < chance) this.events.push({ type: 'pop', big: Math.random() < 0.25 });
      }
    }

    // --- fuel & temperature ---
    if (this.running && !this.infiniteFuel) {
      this.fuel -= (0.0003 + 0.0025 * thr) * (this.rpm / 1000) * dt * this.fuelScale * (s.displacement / 3);
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.running = false;
        this.events.push({ type: 'stall', fuel: true });
      }
    }
    const heat = this.running ? 88 + (1 - this.radiator) * 75 + thr * (this.rpm / s.redline) * 10 : 22;
    this.temp += (heat - this.temp) * dt * (this.running ? 0.05 : 0.01);
    if (this.temp > 128 && this.running) {
      this.health = Math.max(0, this.health - dt * 0.012);
      if (this.health === 0) {
        this.running = false;
        this.events.push({ type: 'seize' });
      }
    }

    this.throttle = thr;
    this.load = clamp(Te / (s.peakTorque * boostMul), 0, 1);
    this.lastThrottle = throttleIn;
    this.wheelTorque = Tc * r * s.efficiency;
    return this.wheelTorque;
  }
}
