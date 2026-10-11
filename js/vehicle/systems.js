import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Everything a car does besides moving: the 12 V electrical system, fire,
 * the driver's health, the trip computer, automatic lights and wipers,
 * climate control, cruise control and speed limiter, locks and alarm,
 * slow mechanical decay (fatigue, service intervals) and the odd failure.
 */
export class CarSystems {
  constructor(car) {
    this.car = car;
    this.battery = 0.9; // 12 V state of charge
    this.volts = 12.5;
    this.amps = 0;
    this.trip = { a: 0, b: 0, fuelA: 0, inst: 0, avg: 0, range: 0, t: 0 };
    this.odo = 0; // km
    this.serviceAt = 3000; // km at which the next oil service is due
    this.fire = 0; // 0..1 fire size
    this.fireAt = null; // 'engine' | 'rear'
    this.burnt = false;
    this.driver = { health: 1, blur: 0, ring: 0, lastHit: 0 };
    this.fatigue = 0;
    this.locked = false;
    this.alarm = 0;
    this.hornStuck = false;
    this.exhaustDrag = false;
    this.lightAim = 0; // radians of droop from front damage
    this.elecFault = 0; // 0..1 flicker probability
    this.flicker = false;
    this.dirt = 0;
    this.cruise = { on: false, speed: 0 };
    this.limiter = { on: false, speed: 0 };
    this.lowFuelChimed = false;
    this.fuelNeedle = car.phys.pt.energyFrac;
    this.prevImpact = 0;
    this.landT = 0;
  }

  get electricsOk() {
    return this.battery > 0.04 && !this.car.electricsDead;
  }

  /** Called every frame from Car.update. */
  update(dt, game) {
    const car = this.car;
    const pt = car.phys.pt;
    const s = car.sys;
    const env = game.env;
    this.updateAuto(dt, env);
    this.updateElectrical(dt);
    this.updateFire(dt, game);
    // alarm: hazards + pulsing horn
    if (this.alarm > 0) {
      this.alarm -= dt;
      const on = Math.floor(this.alarm * 2.5) % 2 === 0;
      s.hazard = this.alarm > 0;
      s.horn = on && this.alarm > 0;
      if (this.alarm <= 0) {
        s.hazard = false;
        s.horn = false;
      }
    }
    if (s.blinkFob > 0) s.blinkFob -= dt;
    if (!car.isPlayer) return;
    this.updateTrip(dt);
    this.updateDecay(dt, game);
    // cruise control / limiter disengage on brake or clutch
    if (this.cruise.on && (car.phys.input.brake > 0.1 || pt.clutchPedal > 0.5 || !pt.running)) {
      this.cruise.on = false;
      game.toast?.('Cruise control off');
    }
    // stuck horn after a big front hit
    if (this.hornStuck && !s.hornOverride) s.horn = true;
    // low fuel chime
    const f = pt.energyFrac;
    if (f < 0.1 && !this.lowFuelChimed && pt.running) {
      this.lowFuelChimed = true;
      game.audio?.chime?.('fuel');
      game.toast?.(pt.ev ? 'Battery low — find a charger' : 'Low fuel', 'warn');
    }
    if (f > 0.15) this.lowFuelChimed = false;
    // the fuel needle lags (fuel sloshing / damping)
    this.fuelNeedle += (f - this.fuelNeedle) * Math.min(1, dt * 0.6);
    // driver recovers slowly
    const d = this.driver;
    d.health = Math.min(1, d.health + dt * 0.004);
    d.blur = Math.max(0, d.blur - dt * 0.12);
    d.ring = Math.max(0, d.ring - dt * 0.15);
  }

  /** Automatic headlights and wipers, climate side effects. */
  updateAuto(dt, env) {
    const s = this.car.sys;
    const dark = env.night > 0.3 || env.fogAmount > 0.55 || env.rain > 0.65;
    s.lightLevel = s.headlights === 3 ? (dark ? 2 : env.night > 0.15 ? 1 : 0) : s.headlights;
    if (this.flicker) s.lightLevel = 0;
    s.wiperSpeed = s.wipers === 4 ? (env.rain < 0.04 ? 0 : env.rain < 0.3 ? 1 : env.rain < 0.7 ? 2 : 3) : s.wipers;
    const pt = this.car.phys.pt;
    pt.acLoad = s.ac && pt.running ? 9 : 0;
  }

  updateElectrical(dt) {
    const car = this.car;
    const s = car.sys;
    const pt = car.phys.pt;
    if (car.electricsDead) {
      this.amps = 0;
      this.volts = 0;
      pt.starterPower = 0;
      return;
    }
    const on = s.ignition !== 'off' || pt.running;
    let load = 0;
    if (on) load += 6;
    if (s.lightLevel >= 1) load += 3;
    if (s.lightLevel >= 2) load += 10;
    if (s.high) load += 8;
    if (s.fog) load += 5 * s.fog;
    if (s.ignition !== 'off' && s.radio !== false) load += 3;
    if (s.wiperSpeed) load += 3 + s.wiperSpeed;
    if (s.hazard || s.indicator !== 'none') load += 2;
    if (s.dome) load += 1;
    if (s.fan) load += s.fan * 3;
    if (s.rearDefrost) load += 14;
    if (pt.cranking && !pt.ev) load += 160;
    if (car.sirenOn) load += 8;
    // alternator (or the EV's DC-DC converter)
    let charge = 0;
    if (pt.running) charge = pt.ev ? 90 : pt.rpm > 1100 ? 70 : 35;
    this.amps = charge - load;
    // 60 Ah battery, sped up x30 so neglect shows up within minutes
    this.battery = clamp(this.battery + (this.amps * dt * 30) / (60 * 3600), 0, 1);
    this.volts = 11.6 + this.battery * 1.2 + (pt.running ? 1.6 : 0) - (pt.cranking ? 1.8 : 0);
    pt.starterPower = clamp((this.battery - 0.08) / 0.45, 0, 1);
    // electrical damage: flickering lights and dash
    this.flicker = this.elecFault > 0 && Math.random() < this.elecFault * dt * 8;
  }

  /** Engine-bay and fuel fires. */
  updateFire(dt, game) {
    const car = this.car;
    const pt = car.phys.pt;
    if (this.fire <= 0) {
      // ignition sources: leaking fuel + sparks, cooked engine
      if (car.fuelLeak > 0.25 && car.scrape > 4 && Math.random() < dt * 0.5) this.ignite('rear', game);
      if (pt.temp > 140 && pt.health < 0.3 && Math.random() < dt * 0.05) this.ignite('engine', game);
      return;
    }
    if (this.burnt) {
      this.fire = Math.max(0, this.fire - dt * 0.02);
      if (Math.random() < dt * 20) {
        _v.set(0, 0.9, 0);
        car.body.toWorldPoint(_v, _v2);
        game.fx?.engineSmoke?.(_v2, car.body.velocity, 0.6, false);
      }
      return;
    }
    const extinguishing = this.extinguish > 0;
    this.extinguish = Math.max(0, (this.extinguish || 0) - dt);
    if (extinguishing) this.fire = Math.max(0, this.fire - dt * 0.28);
    else this.fire = Math.min(1, this.fire + dt * (car.submerged > 0.3 ? -0.5 : 0.022));
    if (this.fire <= 0) {
      this.fireAt = null;
      game.onCarEvent?.(car, 'fireOut');
      return;
    }
    // where the flames are
    const prof = car.model.prof;
    const z = this.fireAt === 'rear' ? prof.zR + 0.5 : prof.zF - 0.7;
    _v.set(0, 0.75, z).sub(car.model.com);
    car.body.toWorldPoint(_v, _v2);
    if (Math.random() < dt * 60) game.fx?.fire?.(_v2, this.fire * 1.4);
    if (Math.random() < dt * 30) game.fx?.engineSmoke?.(_v2, car.body.velocity, 0.4 + this.fire, false);
    // damage
    pt.health = Math.max(0, pt.health - dt * this.fire * 0.04);
    if (pt.health <= 0.02 && pt.running) pt.shutOff();
    this.charring = Math.min(1, (this.charring || 0) + dt * this.fire * 0.03);
    car.model.setChar?.(this.charring);
    if (this.fire > 0.5 && Math.random() < dt * 0.3) {
      // tyres and glass give up
      const w = car.phys.wheels[Math.floor(Math.random() * 4)];
      if (w && !w.detached) w.flat = 1;
      const glass = Object.values(car.model.glassParts).filter((g) => g.state !== 'shattered');
      if (glass.length && Math.random() < 0.4) car.shatterGlass(glass[Math.floor(Math.random() * glass.length)]);
    }
    if (car.isPlayer && game.player.mode === 'car') this.hurt(dt * this.fire * 0.12, game, 'fire');
    // big fires with fuel aboard can explode
    if (this.fire >= 1 && !this.exploded) {
      if (pt.fuel > 4 && Math.random() < 0.65) this.explode(game);
      else this.burnOut(game);
    }
  }

  ignite(where, game) {
    if (this.fire > 0 || this.burnt) return;
    this.fire = 0.08;
    this.fireAt = where;
    game.onCarEvent?.(this.car, 'fire');
  }

  explode(game) {
    const car = this.car;
    this.exploded = true;
    const b = car.body;
    b.applyImpulse(_v.set((Math.random() - 0.5) * 2, 7 + Math.random() * 3, (Math.random() - 0.5) * 2).multiplyScalar(b.mass), _v2.copy(b.position).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, -0.4, (Math.random() - 0.5) * 2)));
    // blow panels off
    for (const p of car.model.allParts) if (p.hinge && Math.random() < 0.6) car.detachPart(p, new THREE.Vector3(0, -1, 0));
    for (const g of Object.values(car.model.glassParts)) car.shatterGlass(g);
    game.onExplosion?.(car, b.position.clone());
    this.burnOut(game);
  }

  burnOut(game) {
    const car = this.car;
    this.burnt = true;
    this.fire = 0.6;
    car.phys.pt.health = 0;
    car.phys.pt.shutOff();
    car.electricsDead = true;
    car.wrecked = true;
    this.charring = 1;
    car.model.setChar?.(1);
    for (const w of car.phys.wheels) w.flat = 1;
    game.onCarEvent?.(car, 'burnt');
  }

  /** Trip computer: distance, instant and average consumption, range. */
  updateTrip(dt) {
    const car = this.car;
    const pt = car.phys.pt;
    const km = (car.speed * dt) / 1000;
    const t = this.trip;
    t.a += km;
    t.b += km;
    this.odo += km;
    t.t += dt;
    const flow = pt.fuelFlow * (pt.ev ? 1 : 1); // L/s or kW
    const used = pt.ev ? (flow * dt) / 3600 : flow * dt;
    t.fuelA += Math.max(0, used);
    const per100 = car.speed > 1 ? (pt.ev ? (flow / (car.speed * 3.6)) * 100 : (flow * 3600) / (car.speed * 3.6) * 100) : 0;
    t.inst += (per100 - t.inst) * Math.min(1, dt * 2);
    t.avg = t.a > 0.05 ? (t.fuelA / t.a) * 100 : 0;
    const left = pt.ev ? pt.soc : pt.fuel;
    t.range = t.avg > 0.5 ? (left / t.avg) * 100 : left * (pt.ev ? 6 : 12);
  }

  resetTrip(which) {
    if (which === 'a') {
      this.trip.a = 0;
      this.trip.fuelA = 0;
    } else this.trip.b = 0;
  }

  /** Fatigue from hard landings, service intervals, dirt. */
  updateDecay(dt, game) {
    const car = this.car;
    const ph = car.phys;
    // hard landings slowly bend the structure: suspension geometry drifts
    if (ph.grounded === 0) this.landT += dt;
    else {
      if (this.landT > 0.6) {
        const hit = Math.max(...ph.wheels.map((w) => w.impact));
        if (hit > 0.05) {
          this.fatigue = Math.min(1, this.fatigue + hit * 0.25 * Math.min(2, this.landT));
          for (const w of ph.wheels) {
            if (w.detached) continue;
            w.camber = clamp(w.camber + (Math.random() - 0.5) * this.fatigue * 0.004, -0.25, 0.25);
            w.toe = clamp(w.toe + (Math.random() - 0.5) * this.fatigue * 0.002, -0.2, 0.2);
          }
          if (this.fatigue > 0.5 && Math.random() < 0.2) game.toast?.('Repeated hard landings are bending the chassis', 'warn');
        }
      }
      this.landT = 0;
    }
    // dirt builds up off-road and in the rain
    const loose = ph.wheels.some((w) => w.contact && w.mat && w.mat.loose);
    this.dirt = clamp(this.dirt + dt * car.speed * (loose ? 0.0006 : 0.00002) * (1 + game.env.wetness * 3), 0, 1);
    car.model.setDirt?.(this.dirt);
    if (this.odo > this.serviceAt && !this.serviceWarned) {
      this.serviceWarned = true;
      game.toast?.('Service due: oil change (Customs)', 'warn');
    }
    // overdue service slowly wears the engine
    if (this.odo > this.serviceAt + 500 && car.phys.pt.running) car.phys.pt.health = Math.max(0.3, car.phys.pt.health - dt * 0.00005);
  }

  service() {
    const pt = this.car.phys.pt;
    pt.oil = 1;
    pt.coolant = 1;
    this.serviceAt = this.odo + 3000;
    this.serviceWarned = false;
  }

  /** The driver takes a hit. */
  hurt(amount, game, cause) {
    const d = this.driver;
    if (this.car.invulnerable || amount <= 0) return;
    d.health = Math.max(0, d.health - amount);
    d.blur = Math.min(1, d.blur + amount * 2.5);
    if (cause !== 'fire') d.ring = Math.min(1, d.ring + amount * 2);
    game.hud?.hurt?.(Math.min(1, amount * 4));
    if (d.health <= 0 && !d.out) {
      d.out = true;
      game.onBlackout?.(this.car, cause);
    }
  }

  /** Crash consequences for the occupant (from Car.processImpacts). */
  onImpact(dv, localP, game) {
    const car = this.car;
    if (!car.isPlayer || dv < 7) return;
    const frontal = localP.z > car.model.prof.zF * 0.4;
    const belted = car.sys.seatbelt;
    const airbag = frontal && dv > 13;
    let dmg = (dv - 7) * 0.035 * (belted ? 0.45 : 1.6) * (airbag && belted ? 0.6 : 1);
    if (car.tuning.rollCage) dmg *= 0.7;
    this.hurt(dmg, game, 'crash');
    // unbelted + violent frontal stop: out through the windshield
    const ws = car.model.parts.windshield;
    if (!belted && frontal && (dv > 24 || (dv > 17 && ws && ws.state === 'shattered'))) {
      if (ws) car.shatterGlass(ws);
      game.onEjected?.(car, dv);
    }
    // collateral failures
    if (frontal && dv > 12) {
      if (Math.random() < 0.25) this.hornStuck = true;
      this.lightAim = Math.min(0.15, this.lightAim + (dv - 12) * 0.006);
      if (Math.random() < 0.3) this.elecFault = Math.min(1, this.elecFault + 0.15);
      if (dv > 15 && Math.random() < 0.4) car.phys.rackDamage = Math.min(1, car.phys.rackDamage + 0.3);
      if (dv > 15) car.phys.rackOffset = clamp(car.phys.rackOffset + (Math.random() - 0.5) * 0.04, -0.06, 0.06);
      const pt = car.phys.pt;
      if (Math.random() < 0.3) pt.oilLeak = Math.min(0.02, pt.oilLeak + 0.004);
      if (pt.health < 0.15 && Math.random() < 0.3) this.ignite('engine', game);
    }
    if (localP.y < -0.15 && dv > 6 && Math.random() < 0.3) this.exhaustDrag = true;
    if (dv > 14 && Math.random() < 0.2) car.phys.pt.brokenGears.add(1 + Math.floor(Math.random() * car.phys.pt.gearCount));
  }

  repair() {
    this.fire = 0;
    this.fireAt = null;
    this.burnt = false;
    this.exploded = false;
    this.charring = 0;
    this.car.model.setChar?.(0);
    this.hornStuck = false;
    this.exhaustDrag = false;
    this.lightAim = 0;
    this.elecFault = 0;
    this.fatigue = 0;
    this.battery = Math.max(this.battery, 0.8);
    this.driver.out = false;
    const pt = this.car.phys.pt;
    pt.oil = Math.max(pt.oil, 0.9);
    pt.coolant = 1;
    pt.oilLeak = 0;
    pt.coolantLeak = 0;
    pt.brokenGears.clear();
    this.car.phys.rackDamage = 0;
    this.car.phys.rackOffset = 0;
  }

  wash() {
    this.dirt = 0;
    this.car.model.setDirt?.(0);
  }
}

export { smoothstep };
