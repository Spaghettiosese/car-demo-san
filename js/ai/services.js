import * as THREE from 'three';
import { Car } from '../vehicle/car.js';
import { configForBody, DEFAULT_CONFIG } from '../vehicle/specs.js';
import { clamp } from '../core/util.js';
import { CITY } from '../world/city.js';
import { Driver, randomPlate } from './traffic.js';
import { nearestNode } from './gps.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();

const UNIT_CFG = {
  ambulance: () => ({ ...configForBody('van', DEFAULT_CONFIG), paint: '#f4f4f0', livery: 'side', accent: '#d11f2a', plate: 'SDGH ' + Math.floor(10 + Math.random() * 89), horn: 'high', finish: 'gloss' }),
  fire: () => ({ ...configForBody('van', DEFAULT_CONFIG), paint: '#c8102e', livery: 'side', accent: '#f2f2f2', plate: 'SDFD ' + Math.floor(10 + Math.random() * 89), horn: 'truck', finish: 'gloss', wheelColor: '#e8e8e8' }),
  tow: () => ({ ...configForBody('pickup', DEFAULT_CONFIG), paint: '#f2b90c', livery: 'side', accent: '#111111', plate: 'TOW ' + Math.floor(100 + Math.random() * 899), horn: 'truck', finish: 'gloss', engine: 'v8' }),
};
const NAMES = { ambulance: '🚑 Ambulance', fire: '🚒 Fire crew', tow: '🛻 Tow truck' };

/**
 * City services that respond to what happens in the sandbox: an ambulance for
 * people left lying on the road, a fire crew for burning cars, a tow truck for
 * wrecks. Plus the odd broken-down car with its hood up at the kerb.
 * Units drive through traffic on a route (others pull over for the sirens).
 */
export class Services {
  constructor(game) {
    this.game = game;
    this.units = [];
    this.scanT = 2;
    this.breakdowns = [];
    this.breakT = 40;
    this.jets = [];
  }

  // ------------------------------------------------------------ dispatch
  spawnUnit(kind, scene, target) {
    const g = this.game;
    const city = g.city;
    let spot = null;
    for (let k = 0; k < 60 && !spot; k++) {
      const s = city.randomLaneSpot();
      const d = s.pos.distanceTo(scene);
      if (d < (k < 40 ? 110 : 60) || d > (k < 40 ? 240 : 320)) continue;
      if (k < 40 && g.traffic?.visible(s.pos)) continue;
      if (g.cars.some((c) => c.body.position.distanceToSquared(s.pos) < 12 * 12)) continue;
      spot = s;
    }
    if (!spot) return null;
    const car = new Car(g, UNIT_CFG[kind](), { npc: true });
    g.addCar(car);
    car.placeAt(spot.pos.x, 0, spot.pos.z, spot.yaw);
    car.phys.pt.running = true;
    car.phys.pt.setSelector('D');
    car.physicsActive = true;
    car.service = kind;
    car.sirenOn = kind !== 'tow';
    car.sys.headlights = 2;
    const drv = new Driver(car, g.traffic || { game: g });
    drv.speedFactor = kind === 'tow' ? 1.05 : 1.35;
    drv.aggression = 0.5;
    drv.headway = 0.8;
    // follow the shortest route to the scene (set before the lane path is built)
    drv.routeGoal = nearestNode(city, scene);
    drv.placeOnLane(spot.seg, spot.lane, spot.dist);
    const u = { kind, car, drv, state: 'enroute', scene: scene.clone(), target, t: 0, crew: [] };
    this.units.push(u);
    if (car.body.position.distanceTo(g.player.focus) < 400) g.hud.notify?.(NAMES[kind], kind === 'tow' ? 'On the way to clear a wreck' : 'Responding with sirens — pull over!', '', 4);
    return u;
  }

  active(kind) {
    return this.units.some((u) => u.kind === kind);
  }

  /** Look for incidents near the player every couple of seconds. */
  scan() {
    const g = this.game;
    const focus = g.player.focus;
    if (g.settings.services === false || g.state !== 'play') return;
    // burning cars
    if (!this.active('fire')) {
      const burning = g.cars.find((c) => !c.removed && c.ext && c.ext.fire > 0.04 && !c.ext.burnt && !c.fireCalled && c.body.position.distanceTo(focus) < 280);
      if (burning) {
        burning.fireCalled = true;
        this.spawnUnit('fire', burning.body.position, burning);
      }
    }
    // people lying hurt in the road
    if (!this.active('ambulance') && g.peds) {
      const hurt = g.peds.list.find((p) => p.state === 'down' && p.hurt > 0.8 && !p.ambulance && p.pos.distanceTo(focus) < 260);
      if (hurt) {
        hurt.ambulance = true;
        hurt.timer = Math.max(hurt.timer, 60); // stays down until help arrives
        this.spawnUnit('ambulance', hurt.pos, hurt);
      }
    }
    // wrecks blocking the road
    if (!this.active('tow') && g.traffic) {
      const wreck = g.traffic.drivers.find((d) => d.state === 'wrecked' && (d.wreckT || 0) > 15 && !d.car.towed && !d.car.towCalled && !d.car.ext?.fire && d.car.body.position.distanceTo(focus) < 220);
      if (wreck) {
        wreck.car.towCalled = true;
        this.spawnUnit('tow', wreck.car.body.position, wreck.car);
      }
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 2;
      this.scan();
    }
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.car.removed || (u.car.wrecked && u.state !== 'leave')) {
        this.finish(u, true);
        this.units.splice(i, 1);
        continue;
      }
      u.t += dt;
      if (this.updateUnit(u, dt) === 'done') {
        this.finish(u, false);
        this.units.splice(i, 1);
      }
    }
    this.updateJets(dt);
    this.updateBreakdowns(dt);
  }

  updateUnit(u, dt) {
    const g = this.game;
    const car = u.car;
    const p = car.body.position;
    const tgtPos = u.target && u.target.body ? u.target.body.position : u.target && u.target.pos ? u.target.pos : u.scene;
    const d = Math.hypot(p.x - tgtPos.x, p.z - tgtPos.z);
    if (u.state === 'enroute') {
      u.drv.update(dt);
      if (d < 42) u.state = 'approach';
      if (u.t > 150) return 'done'; // gave up (stuck)
      return null;
    }
    if (u.state === 'approach') {
      const stopAt = u.kind === 'tow' ? 7 : 9;
      u.drv.steerTo(tgtPos, clamp((d - stopAt) * 0.6, 0, 9), dt, true);
      if (d < stopAt + 1.5 || (u.t > 40 && car.speed < 0.5 && d < 25)) {
        u.state = 'onscene';
        u.t = 0;
        car.sys.hazard = true;
        if (u.kind === 'ambulance') car.sirenOn = false;
        this.arrive(u, tgtPos);
      }
      return null;
    }
    if (u.state === 'onscene') {
      u.drv.setInputs(0, 1, 0);
      return this.onScene(u, dt, tgtPos);
    }
    if (u.state === 'leave') {
      if (u.drv.state === 'drive' || u.drv.state === 'offroad') u.drv.update(dt);
      else u.drv.rejoin();
      if (u.towing) this.carryTow(u);
      const far = p.distanceTo(g.player.focus);
      if (far > 230 || (u.t > 25 && far > 120 && !g.traffic?.visible(p)) || u.t > 120) return 'done';
    }
    return null;
  }

  arrive(u, at) {
    const g = this.game;
    if (!g.peds) return;
    const car = u.car;
    const side = car.body.toWorldPoint(new THREE.Vector3(car.boundsMax.x + 0.8, 0, -0.5), new THREE.Vector3());
    const uniform = u.kind === 'ambulance' ? 'medic' : u.kind === 'fire' ? 'fire' : null;
    const n = u.kind === 'ambulance' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const goal = at.clone().add(_v.set((k ? -1 : 1) * 0.9, 0, 0.6));
      if (u.kind === 'fire') goal.copy(at).lerp(side, 0.55);
      if (u.kind === 'tow') goal.copy(car.body.toWorldPoint(new THREE.Vector3(0, 0, -car.boundsMax.z - 1.4), new THREE.Vector3()));
      u.crew.push(g.peds.spawnScripted(side.clone().add(_v.set(k * 0.6, 0, 0)), { goal, face: u.target || at, uniform, speed: 2.2 }));
    }
  }

  onScene(u, dt, at) {
    const g = this.game;
    if (u.kind === 'ambulance') {
      // medics treat the patient, then load them up
      if (u.t > 8 && u.target && u.target.pos && !u.loaded) {
        u.loaded = true;
        g.peds?.removePed(u.target);
        for (const c of u.crew) {
          c.goal.copy(u.car.body.position);
          c.state = 'goto';
        }
      }
      if (u.t > 12) return this.depart(u);
    } else if (u.kind === 'fire') {
      const t = u.target;
      if (u.t > 2 && u.t < 9 && t && t.ext) {
        t.ext.extinguish = 0.5;
        this.jet(u.crew[0] ? u.crew[0].pos : u.car.body.position, t.body.position);
      }
      if (u.t > 10 || (t && t.ext && t.ext.fire <= 0 && u.t > 4)) return this.depart(u);
    } else if (u.kind === 'tow') {
      if (u.t > 5 && !u.towing && u.target && !u.target.removed) {
        // hook up the wreck: it leaves traffic and rides on the truck's hook
        const w = u.target;
        w.towed = true;
        w.physicsActive = false;
        const tr = g.traffic;
        if (tr && w.controller) {
          const i = tr.drivers.indexOf(w.controller);
          if (i >= 0) tr.drivers.splice(i, 1);
        }
        w.controller = null;
        w.sys.hazard = false;
        u.towing = w;
        g.audio?.ratchet?.();
        for (const c of u.crew) {
          c.goal.copy(u.car.body.position);
          c.state = 'goto';
        }
      }
      if (u.towing) this.carryTow(u);
      if (u.t > 8) return this.depart(u);
    }
    return null;
  }

  depart(u) {
    for (const c of u.crew) this.game.peds?.removePed(c);
    u.crew.length = 0;
    u.state = 'leave';
    u.t = 0;
    u.car.sys.hazard = false;
    u.car.sirenOn = false;
    u.drv.routeGoal = null;
    u.drv.rejoin();
    return null;
  }

  /** The wreck hangs off the tow truck's hook, front wheels lifted. */
  carryTow(u) {
    const tr = u.car, w = u.towing;
    if (!w || w.removed) return;
    tr.body.axis(2, _f);
    const back = tr.boundsMax.z + w.boundsMax.z + 0.6;
    w.body.position.copy(tr.body.position).addScaledVector(_f, -back);
    w.body.position.y = tr.body.position.y + 0.25;
    _q.setFromAxisAngle(_v.set(1, 0, 0), -0.12);
    w.body.quaternion.copy(tr.body.quaternion).multiply(_q);
    w.body.velocity.copy(tr.body.velocity);
    w.body.angularVelocity.set(0, 0, 0);
    w.body.updateDerived();
  }

  finish(u, aborted) {
    const g = this.game;
    for (const c of u.crew) g.peds?.removePed(c);
    if (u.towing && !u.towing.removed) g.removeCar(u.towing);
    else if (aborted && u.target && u.target.body) u.target.towCalled = u.target.fireCalled = false;
    if (!u.car.removed) g.removeCar(u.car);
  }

  // ------------------------------------------------------------ water jet
  jet(from, to) {
    let j = this.jets.find((x) => x.life > 0 && x.from.distanceTo(from) < 1);
    if (!j) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.25, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.45, depthWrite: false }));
      this.game.scene.add(m);
      j = { m, from: from.clone(), life: 0 };
      this.jets.push(j);
    }
    j.life = 0.2;
    const a = _v.copy(from).setY(from.y + 1.2);
    const b = to.clone().setY(to.y + 0.6);
    const len = a.distanceTo(b);
    j.m.position.copy(a).lerp(b, 0.5);
    j.m.scale.set(1, len, 1);
    j.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    j.m.material.opacity = 0.35 + Math.random() * 0.2;
  }

  updateJets(dt) {
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.life -= dt;
      if (j.life <= 0) {
        this.game.scene.remove(j.m);
        j.m.geometry.dispose();
        this.jets.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------ breakdowns
  /** A car broken down at the kerb with its hood up and the driver staring at the engine. */
  updateBreakdowns(dt) {
    const g = this.game;
    const focus = g.player.focus;
    for (let i = this.breakdowns.length - 1; i >= 0; i--) {
      const b = this.breakdowns[i];
      if (b.car.removed || b.car.isPlayer || b.car.body.position.distanceTo(focus) > 320) {
        if (b.ped) g.peds?.removePed(b.ped);
        if (!b.car.removed && !b.car.isPlayer) g.removeCar(b.car);
        this.breakdowns.splice(i, 1);
      } else if (b.ped && b.ped.shoutCd <= 0 && b.ped.pos.distanceTo(g.camera.position) < 25 && Math.random() < dt * 0.2) {
        g.peds.shout(b.ped, ['Come on, not again…', 'Anyone got jumper cables?', 'It was making a funny noise…', 'Great. Just great.'][Math.floor(Math.random() * 4)]);
      }
    }
    this.breakT -= dt;
    if (this.breakT > 0 || this.breakdowns.length >= 1 || g.state !== 'play' || g.settings.services === false) return;
    this.breakT = 60 + Math.random() * 60;
    const city = g.city;
    for (let k = 0; k < 30; k++) {
      const s = city.randomLaneSpot();
      const d0 = s.pos.distanceTo(focus);
      if (d0 < 90 || d0 > 220 || g.traffic?.visible(s.pos)) continue;
      const dist = 20 + Math.random() * (s.seg.length - 45);
      const pos = city.lanePoint(s.seg, 1, dist).addScaledVector(s.seg.right, 0.9);
      if (g.cars.some((c) => c.body.position.distanceToSquared(pos) < 14 * 14)) continue;
      const cfg = configForBody(['sedan', 'hatch', 'suv', 'van'][Math.floor(Math.random() * 4)], DEFAULT_CONFIG);
      cfg.paint = ['#8a8f96', '#6b1d1d', '#2a3b52', '#d9d4c7', '#3b3b3b'][Math.floor(Math.random() * 5)];
      cfg.finish = 'gloss';
      cfg.plate = randomPlate();
      const car = new Car(g, cfg, { npc: true });
      g.addCar(car);
      car.placeAt(pos.x, 0, pos.z, s.yaw);
      car.body.sleeping = true;
      car.parked = true;
      car.brokenDown = true;
      car.sys.ignition = 'acc';
      car.sys.hazard = true;
      const hood = car.model.parts.hood;
      if (hood) hood.userOpen = true;
      const front = car.body.toWorldPoint(new THREE.Vector3(0.3, 0, car.boundsMax.z + 0.7), new THREE.Vector3());
      const ped = g.peds?.spawnScripted(front, { goal: front, face: car });
      this.breakdowns.push({ car, ped });
      return;
    }
  }

  clear() {
    for (const u of this.units) this.finish(u, true);
    this.units.length = 0;
    for (const b of this.breakdowns) {
      if (b.ped) this.game.peds?.removePed(b.ped);
      if (!b.car.removed && !b.car.isPlayer) this.game.removeCar(b.car);
    }
    this.breakdowns.length = 0;
  }
}

export { CITY };
