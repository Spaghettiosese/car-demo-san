import * as THREE from 'three';
import { Car } from '../vehicle/car.js';
import { configForBody, DEFAULT_CONFIG } from '../vehicle/specs.js';
import { Driver, randomPlate } from './traffic.js';
import { nearestNode, nodePath } from './gps.js';
import { clamp, KMH } from '../core/util.js';
import { CITY } from '../world/city.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

const OFFENSES = {
  speeding: { heat: 1, fine: 150, text: 'Speeding' },
  redlight: { heat: 1, fine: 200, text: 'Running a red light' },
  reckless: { heat: 1, fine: 250, text: 'Reckless driving' },
  hit: { heat: 1, fine: 400, text: 'Hit and run' },
  property: { heat: 0.5, fine: 150, text: 'Destroying public property' },
  assault: { heat: 1.5, fine: 1000, text: 'Ramming a police vehicle' },
  carjack: { heat: 2, fine: 2000, text: 'Grand theft auto' },
  evading: { heat: 1, fine: 800, text: 'Evading police' },
};

function copConfig(heavy) {
  const cfg = configForBody(heavy ? 'suv' : 'sedan', DEFAULT_CONFIG);
  Object.assign(cfg, {
    paint: '#f4f4f4', livery: 'police', finish: 'gloss', engine: 'v8', turbo: heavy ? 'none' : 'small', tune: 2, drivetrain: heavy ? 'awd' : 'rwd',
    wheelStyle: 'steel', wheelColor: '#1d1d1f', tire: 'sport', plate: 'SDPD ' + Math.floor(10 + Math.random() * 89), exhaust: 'sport', abs: true, tcs: true,
  });
  return cfg;
}

// ================================================================== cop AI
export class CopDriver extends Driver {
  constructor(car, mgr, police) {
    super(car, mgr, { speedFactor: 1.0, aggression: 0.8 });
    this.police = police;
    this.mode = 'patrol';
    this.routeT = 0;
    this.routeTarget = null;
    this.pitSide = Math.random() < 0.5 ? 1 : -1;
    this.car.hornType = 'dual';
  }

  // cops don't get road rage: hitting one is an offense instead
  startRage() {
    this.anger = 0;
    this.police.offense('assault', true);
  }
  onHitByPlayer(dv) {
    if (dv > 1.5) this.police.offense('assault', true);
    if (this.speechCd <= 0) this.say('HEY! That\'s a police vehicle!', 'cop');
  }
  onPlayerHonk() {}

  update(dt) {
    const car = this.car;
    if (car.removed) return;
    if (this.mode === 'patrol' || this.mode === 'return') {
      car.sirenOn = false;
      if (this.state === 'wrecked' || this.state === 'offroad') return super.update(dt);
      if (this.state !== 'drive') this.rejoin();
      return super.update(dt);
    }
    car.sys.headlights = 2;
    car.sys.ignition = 'on';
    if (!car.phys.pt.running && !car.wrecked) {
      car.phys.pt.running = true;
      car.phys.pt.omega = 100;
    }
    if (!car.physicsActive) {
      car.physicsActive = true;
      car.body.sleeping = false;
    }
    const up = car.body.R[4];
    if (car.wrecked || up < 0.3) {
      this.wreckT = (this.wreckT || 0) + dt;
      if (this.wreckT > 3) {
        car.sirenOn = true;
        this.setInputs(0, 1, 0);
        return;
      }
    } else this.wreckT = 0;
    car.sirenOn = true;
    const player = this.police.targetCar();
    if (!player) return;
    if (this.mode === 'roadblock') {
      this.setInputs(0, 1, 0);
      car.phys.parkBrake = true;
      return;
    }
    car.phys.parkBrake = false;
    const pp = player.body.position;
    const pv = player.body.velocity;
    const me = car.body.position;
    const dist = me.distanceTo(pp);
    player.body.axis(2, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    if (this.mode === 'pullover') {
      // follow behind at a respectful distance, stop behind the player
      const target = _v.copy(pp).addScaledVector(_fwd, -9);
      const want = player.speed < 1 ? Math.max(0, (me.distanceTo(target) - 1) * 0.8) : clamp(player.speed + (dist - 12) * 0.3, 0, 35);
      this.steerTo(target, want, dt, true);
      if (player.speed < 1 && me.distanceTo(target) < 3) this.setInputs(0, 0.6, 0);
      return;
    }
    // pursuit
    const heat = this.police.heat;
    let target;
    if (dist > 75 && this.game.city.onRoad(me.x, me.z)) {
      // route along the streets when far away
      this.routeT -= dt;
      if (this.routeT <= 0 || !this.routeTarget) {
        this.routeT = 1.2;
        const a = nearestNode(this.game.city, me);
        const b = nearestNode(this.game.city, pp);
        const path = nodePath(this.game.city, a, b);
        const next = path.length > 1 && me.distanceTo(_v2.set(path[0].x, me.y, path[0].z)) < 12 ? path[1] : path[0];
        this.routeTarget = new THREE.Vector3(next.x, 0, next.z);
      }
      target = this.routeTarget;
    } else {
      const lead = clamp(dist / 30, 0.2, 1.2);
      target = _v.copy(pp).addScaledVector(pv, lead);
      if (heat >= 3 && dist < 18 && player.speed > 8) {
        // PIT: aim at the rear quarter panel
        target.addScaledVector(_fwd, -1.8).addScaledVector(_right, this.pitSide * 1.2);
      } else if (heat < 3 && dist < 14) {
        // box in without ramming: sit on the bumper
        target.addScaledVector(_fwd, -8);
      }
    }
    const aggressive = heat >= 3;
    const want = dist < 20 ? player.speed + (aggressive ? 7 : 2) : 48;
    this.steerTo(target, want, dt, true);
    if (this.honkCd <= 0 && dist < 25 && Math.random() < 0.01) {
      this.honkCd = 3;
      this.honk(0.4, true);
    }
    if (this.speechCd <= 0 && dist < 25) this.say(['PULL OVER!', 'STOP THE VEHICLE!', 'SDPD! STOP!', 'You are under arrest!'][Math.floor(Math.random() * 4)], 'cop');
  }
}

// ================================================================== police system
export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.cops = [];
    this.evade = 0;
    this.busted = 0;
    this.pulloverT = 0;
    this.pursuitT = 0;
    this.seenT = 0;
    this.offenses = [];
    this.lastSeg = null;
    this.lastDist = 0;
    this.cooldown = 0;
    this.spikes = [];
    this.roadblockT = 0;
    this.offenseCd = {};
    this.dispatchT = 0;
  }

  get enabled() {
    return this.game.settings.cops;
  }

  targetCar() {
    const g = this.game;
    if (g.player.mode === 'car') return g.player.car;
    return g.onFoot ? { body: { position: g.onFoot.position, velocity: new THREE.Vector3(), axis: (i, o) => o.set(Math.sin(g.onFoot.yaw), 0, Math.cos(g.onFoot.yaw)) }, speed: 0 } : null;
  }

  makeCop(heavy, pos, yaw) {
    const g = this.game;
    const car = new Car(g, copConfig(heavy), { npc: true, police: true });
    car.phys.gripScale = 1.08;
    car.placeAt(pos.x, 0, pos.z, yaw);
    car.phys.pt.running = true;
    car.phys.pt.setSelector('D');
    car.phys.pt.gear = 1;
    g.addCar(car);
    const d = new CopDriver(car, g.traffic || { game: g }, this);
    this.cops.push(d);
    return d;
  }

  spawnPatrols() {
    const g = this.game;
    const want = 3;
    let tries = 0;
    while (this.cops.filter((c) => c.mode === 'patrol').length < want && tries++ < 20) {
      const s = g.city.randomLaneSpot();
      if (s.pos.distanceTo(g.player.focus) < 60) continue;
      const d = this.makeCop(false, s.pos, s.yaw);
      d.placeOnLane(s.seg, s.lane, s.dist);
      d.car.physicsActive = s.pos.distanceTo(g.player.focus) < 150;
    }
  }

  /** Reinforcements arrive from out of view near the player. */
  dispatch(n, heavy = false) {
    const g = this.game;
    const target = this.targetCar();
    if (!target) return;
    for (let k = 0; k < n; k++) {
      let spot = null;
      for (let i = 0; i < 40; i++) {
        const s = g.city.randomLaneSpot();
        const d = s.pos.distanceTo(target.body.position);
        if (d < 90 || d > 220) continue;
        if (g.traffic && g.traffic.visible(s.pos)) continue;
        spot = s;
        break;
      }
      if (!spot) continue;
      const cop = this.makeCop(heavy, spot.pos, spot.yaw);
      cop.mode = 'pursuit';
      cop.car.physicsActive = true;
      cop.placeOnLane(spot.seg, spot.lane, spot.dist);
    }
  }

  clearAll() {
    for (const c of this.cops) this.game.removeCar(c.car);
    this.cops.length = 0;
    this.heat = 0;
    for (const s of this.spikes) s.mesh.parent?.remove(s.mesh);
    this.spikes.length = 0;
  }

  // ------------------------------------------------------------ offenses
  /** Is any cop able to see the player right now? Returns the closest one. */
  seeingCop(range = 90) {
    const t = this.targetCar();
    if (!t) return null;
    const p = t.body.position;
    let best = null, bd = range;
    for (const c of this.cops) {
      if (c.car.removed) continue;
      const d = c.car.body.position.distanceTo(p);
      if (d > bd) continue;
      if (this.game.world.blocked(c.car.body.position.x, c.car.body.position.z, p.x, p.z, 3)) continue;
      best = c;
      bd = d;
    }
    // parked cruisers at the station also count
    for (const pc of this.game.traffic?.parked || []) {
      if (!pc.police) continue;
      const d = pc.body.position.distanceTo(p);
      if (d < Math.min(bd, 50)) return best || { car: pc, parked: true };
    }
    return best;
  }

  offense(type, force = false) {
    if (!this.enabled) return;
    if ((this.offenseCd[type] || 0) > 0) return;
    const cop = force ? this.cops[0] || true : this.seeingCop();
    if (!cop) return;
    this.offenseCd[type] = type === 'speeding' ? 12 : 6;
    const o = OFFENSES[type];
    this.offenses.push(type);
    const before = this.heat;
    if (this.heat === 0) {
      this.heat = 1;
      this.startPursuit(cop.car ? cop : null, true);
      this.game.toast(`🚨 ${o.text} — police: <b>pull over!</b>`, 'warn', 4);
    } else {
      this.heat = Math.min(5, this.heat + o.heat);
      if (Math.floor(this.heat) > Math.floor(before)) this.game.toast(`🚨 ${o.text} — wanted level ${Math.floor(this.heat)}`, 'warn');
    }
    this.evade = 0;
  }

  startPursuit(copDriver, pullover) {
    const cop = copDriver && copDriver.mode ? copDriver : this.cops.slice().sort((a, b) => a.car.body.position.distanceTo(this.game.player.focus) - b.car.body.position.distanceTo(this.game.player.focus))[0];
    if (!cop) {
      this.dispatch(1);
      const c = this.cops[this.cops.length - 1];
      if (c) c.mode = pullover ? 'pullover' : 'pursuit';
      return;
    }
    cop.mode = pullover ? 'pullover' : 'pursuit';
    cop.car.physicsActive = true;
    this.pulloverT = 0;
    this.pursuitT = 0;
  }

  witness(npcCar, what) {
    if (what === 'hit') this.offense('hit');
  }

  onImpact(car, other, dv, kind) {
    const g = this.game;
    if (!this.enabled) return;
    const pc = g.player.car;
    if (car === pc && other && other.police && dv > 1.5) {
      // player hit a cop (or got PIT'd)
      if (this.heat === 0) this.offense('assault', true);
      else if (this.heat >= 1 && !this.ramCd) {
        this.heat = Math.min(5, this.heat + 0.5);
        this.ramCd = 3;
      }
    }
  }

  onPropHit(item) {
    if (item.kind === 'lamp' || item.kind === 'hydrant' || item.kind === 'mailbox') this.offense('property');
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    for (const k in this.offenseCd) this.offenseCd[k] -= dt;
    if (this.ramCd) this.ramCd = Math.max(0, this.ramCd - dt);
    if (!this.enabled) {
      if (this.cops.length) this.clearAll();
      this.updateHud();
      return;
    }
    if (g.state === 'play') this.spawnPatrols();
    const target = this.targetCar();
    // cops' AI + LOD (patrol cars share traffic LOD rules)
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      const d = c.car.body.position.distanceTo(g.player.focus);
      if (c.mode === 'patrol') {
        if (!c.car.physicsActive && d < 150) {
          c.car.physicsActive = true;
          const yaw = Math.atan2(c.car.body.R[2], c.car.body.R[8]);
          c.car.body.velocity.set(Math.sin(yaw) * c.kinV, 0, Math.cos(yaw) * c.kinV);
        } else if (c.car.physicsActive && d > 190 && c.state === 'drive') {
          c.car.physicsActive = false;
          c.kinV = Math.max(0, c.car.forwardSpeed);
        }
        if (d > 360) {
          g.removeCar(c.car);
          this.cops.splice(i, 1);
          continue;
        }
      }
      c.update(dt);
    }
    if (g.state !== 'play' || !target) {
      this.updateHud();
      return;
    }
    this.detectOffenses(dt, target);
    this.updatePursuit(dt, target);
    this.updateSpikes(dt);
    this.updateHud();
  }

  detectOffenses(dt, t) {
    const g = this.game;
    if (g.player.mode !== 'car') return;
    const car = t;
    const p = car.body.position;
    car.body.axis(2, _fwd);
    const nl = g.city.nearestLane(p, _fwd);
    if (nl) {
      // speeding
      const limit = nl.seg.limit;
      if (car.speed > limit + 25 / 3.6) this.offense('speeding');
      // red light: crossing the stop line on red
      if (this.lastSeg === nl.seg && this.lastDist < nl.seg.stopDist && nl.dist >= nl.seg.stopDist + 0.3 && g.city.signalFor(nl.seg) === 'red' && car.speed > 3) this.offense('redlight');
      this.lastSeg = nl.seg;
      this.lastDist = nl.dist;
    } else {
      // no lane in our direction: are we on the wrong side of a road?
      const any = g.city.nearestLane(p);
      if (any && car.speed > 6 && g.city.onRoad(p.x, p.z)) {
        this.wrongWay = (this.wrongWay || 0) + dt;
        if (this.wrongWay > 3) this.offense('reckless');
      } else this.wrongWay = 0;
      this.lastSeg = null;
    }
  }

  updatePursuit(dt, t) {
    const g = this.game;
    if (this.heat <= 0) {
      for (const c of this.cops) if (c.mode !== 'patrol') {
        c.mode = 'patrol';
        c.rejoin();
      }
      return;
    }
    const p = t.body.position;
    const lvl = Math.floor(this.heat);
    const pursuers = this.cops.filter((c) => c.mode === 'pursuit' || c.mode === 'pullover');
    // pull-over: stop near the cop for a ticket
    if (lvl === 1 && pursuers.some((c) => c.mode === 'pullover')) {
      const cop = pursuers.find((c) => c.mode === 'pullover');
      const d = cop.car.body.position.distanceTo(p);
      if (t.speed < 1.2 && d < 25) {
        this.pulloverT += dt;
        this.bustProgress = this.pulloverT / 3;
        if (this.pulloverT > 3) return this.ticket(cop);
      } else {
        this.pulloverT = Math.max(0, this.pulloverT - dt);
        this.pursuitT += dt;
        if (this.pursuitT > 14 || (t.speed > 25 && d > 40)) {
          // ignoring the cop = evading
          this.heat = 2;
          cop.mode = 'pursuit';
          g.toast('🚨 Evading police — wanted level 2', 'warn');
        }
      }
    }
    // escalation: dispatch more units
    const want = [0, 1, 2, 3, 5, 6][lvl];
    this.dispatchT -= dt;
    if (pursuers.length < want && this.dispatchT <= 0) {
      this.dispatchT = 4;
      const idle = this.cops.find((c) => c.mode === 'patrol' && c.car.body.position.distanceTo(p) < 300);
      if (idle) {
        idle.mode = 'pursuit';
        idle.car.physicsActive = true;
      } else this.dispatch(1, lvl >= 5);
    }
    for (const c of this.cops) if (c.mode === 'pullover' && lvl >= 2) c.mode = 'pursuit';
    // roadblocks & spikes at level 4+
    this.roadblockT -= dt;
    if (lvl >= 4 && this.roadblockT <= 0 && g.player.mode === 'car') {
      this.roadblockT = 40;
      this.roadblock(t);
    }
    // evasion: out of sight of every cop
    const seen = this.seeingCop(lvl >= 3 ? 130 : 110);
    if (seen && !seen.parked) {
      this.evade = Math.max(0, this.evade - dt * 2);
      this.lastSeen = p.clone();
    } else this.evade += dt;
    const evadeNeed = 8 + lvl * 3;
    this.evadeProgress = this.evade / evadeNeed;
    if (this.evade > evadeNeed) {
      this.heat = 0;
      this.evade = 0;
      g.hud.big('ESCAPED', 'You lost the cops', 2.5);
      g.stats.escapes = (g.stats.escapes || 0) + 1;
      for (const c of this.cops) if (c.mode !== 'patrol') {
        c.mode = 'patrol';
        c.rejoin();
      }
      return;
    }
    // busted: stopped (or wrecked) with a cop right there
    if (lvl >= 2) {
      const close = pursuers.some((c) => c.car.body.position.distanceTo(p) < 9);
      const stuck = t.speed < 2 || (g.player.mode === 'car' && g.player.car.wrecked);
      if (close && stuck) {
        this.busted += dt;
        this.bustProgress = this.busted / 4;
        if (this.busted > 4) this.bust();
      } else {
        this.busted = Math.max(0, this.busted - dt * 1.5);
        this.bustProgress = this.busted / 4;
      }
    }
  }

  ticket(cop) {
    const g = this.game;
    const o = OFFENSES[this.offenses[this.offenses.length - 1] || 'speeding'];
    const fine = o.fine;
    g.stats.fines += fine;
    g.hud.big('TICKET', `${o.text} — $${fine} fine. Drive safe.`, 3.5);
    cop.say('Have a nice day. Slow down.', 'cop');
    this.heat = 0;
    this.offenses.length = 0;
    this.pulloverT = 0;
    this.bustProgress = 0;
    this.offenseCd.speeding = 20;
    setTimeout(() => {
      if (cop.car.removed) return;
      cop.mode = 'patrol';
      cop.rejoin();
    }, 2500);
  }

  bust() {
    const g = this.game;
    const fine = 500 + Math.floor(this.heat) * 750;
    g.stats.fines += fine;
    this.heat = 0;
    this.busted = 0;
    this.bustProgress = 0;
    this.offenses.length = 0;
    g.hud.big('BUSTED', `Fine: $${fine}. Your car was towed to Police HQ.`, 4);
    g.audio?.clunk?.(null, 1);
    const fade = document.getElementById('fade');
    fade.style.opacity = '1';
    setTimeout(() => {
      // tow to the police station
      for (const c of this.cops) {
        c.mode = 'patrol';
        c.rejoin();
      }
      const loc = g.city.locations.police;
      if (g.player.mode === 'foot') g.onFoot?.forceEnter?.();
      const car = g.player.car;
      car.repair();
      const p = loc.pos;
      car.placeAt(p.x, 0, p.z, loc.yaw);
      car.stopEngine();
      g.cam.initialized = false;
      fade.style.opacity = '0';
    }, 1400);
  }

  roadblock(t) {
    const g = this.game;
    t.body.axis(2, _fwd);
    // find the segment ahead of the player and block it ~150 m ahead
    const nl = g.city.nearestLane(t.body.position, _fwd);
    if (!nl) return;
    let seg = nl.seg;
    let ahead = seg.length - nl.dist;
    if (ahead < 60) {
      const outs = seg.to.out.filter((s) => Math.abs(seg.dir.x * s.dir.z - seg.dir.z * s.dir.x) < 0.5 && s !== seg.reverse);
      if (!outs.length) return;
      seg = outs[0];
      ahead = 0;
    }
    const d = ahead > 0 ? Math.min(seg.length - 20, nl.dist + 90) : seg.length * 0.5;
    const mid = g.city.lanePoint(seg, 0, d);
    const yaw = Math.atan2(seg.right.x, seg.right.z);
    for (const lane of [0, 1]) {
      const p = g.city.lanePoint(seg, lane, d);
      const cop = this.makeCop(true, p, yaw + (lane ? 0.4 : -0.4));
      cop.mode = 'roadblock';
      cop.car.physicsActive = true;
      cop.car.sirenOn = true;
      setTimeout(() => {
        if (!cop.car.removed) cop.mode = 'pursuit';
      }, 25000);
    }
    // spike strip a bit before the roadblock
    const sp = g.city.lanePoint(seg, 0, d - 25);
    const a = sp.clone().addScaledVector(seg.right, -0.5);
    const b = sp.clone().addScaledVector(seg.right, CITY.RW / 2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CITY.RW / 2 + 0.5, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.5 }));
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.position.y = 0.03;
    mesh.rotation.y = Math.atan2(seg.dir.x, seg.dir.z);
    g.scene.add(mesh);
    this.spikes.push({ a, b, mesh, t: 45 });
    g.toast('🚧 Roadblock ahead!', 'warn');
    void mid;
  }

  updateSpikes(dt) {
    const g = this.game;
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t -= dt;
      if (s.t <= 0) {
        s.mesh.parent?.remove(s.mesh);
        this.spikes.splice(i, 1);
        continue;
      }
      for (const car of g.cars) {
        if (car.police || !car.physicsActive) continue;
        if (car.body.position.distanceToSquared(s.mesh.position) > 100) continue;
        for (const w of car.phys.wheels) {
          if (!w.contact || w.flat) continue;
          // distance from the contact point to the strip segment
          const abx = s.b.x - s.a.x, abz = s.b.z - s.a.z;
          const t = clamp(((w.cp.x - s.a.x) * abx + (w.cp.z - s.a.z) * abz) / (abx * abx + abz * abz), 0, 1);
          const dx = w.cp.x - (s.a.x + abx * t), dz = w.cp.z - (s.a.z + abz * t);
          if (dx * dx + dz * dz < 0.3 * 0.3) {
            w.flat = 1;
            if (car === g.player.car) g.toast('💥 Spike strip! Tyre punctured', 'warn');
            g.audio?.noiseBurst?.(1.2, { gain: 0.3, type: 'highpass', freq: 2000 });
          }
        }
      }
    }
  }

  updateHud() {
    const el = document.getElementById('wanted');
    const bar = document.getElementById('wanted-bar');
    const lvl = Math.floor(this.heat);
    const key = `${lvl}:${this.enabled}`;
    if (this.hudKey !== key) {
      this.hudKey = key;
      el.innerHTML = this.enabled && lvl > 0 ? Array.from({ length: 5 }, (_, i) => `<span class="${i < lvl ? 'on' : ''}">★</span>`).join('') : '';
      el.classList.toggle('flash', lvl > 0);
    }
    if (lvl > 0) {
      bar.style.display = 'block';
      const fill = bar.querySelector('.fill');
      const label = bar.querySelector('span');
      if ((this.bustProgress || 0) > 0.05) {
        fill.style.width = `${clamp(this.bustProgress, 0, 1) * 100}%`;
        fill.style.background = lvl === 1 ? 'linear-gradient(90deg,#52d273,#8ff0a8)' : 'linear-gradient(90deg,#ff4a4a,#ff9090)';
        label.textContent = lvl === 1 ? 'PULLING OVER…' : 'BUSTED…';
      } else {
        fill.style.width = `${clamp(this.evadeProgress || 0, 0, 1) * 100}%`;
        fill.style.background = 'linear-gradient(90deg,#37c8ff,#7ee2ff)';
        label.textContent = (this.evadeProgress || 0) > 0.02 ? 'EVADING…' : lvl === 1 ? 'STOP THE CAR TO PULL OVER' : 'IN PURSUIT';
      }
    } else bar.style.display = 'none';
  }
}

export { OFFENSES, KMH };
