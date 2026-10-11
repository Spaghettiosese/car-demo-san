import * as THREE from 'three';
import { PathDriver, DerbyDriver, FleeDriver, smoothPath } from '../ai/racer.js';
import { Car } from '../vehicle/car.js';
import { configForBody, DEFAULT_CONFIG } from '../vehicle/specs.js';
import { CITY, roadCoord } from '../world/city.js';
import { RIVALS } from './manager.js';
import { clamp, KMH } from '../core/util.js';
import { MATERIALS } from '../physics/world.js';

const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const fmtTime = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`);
const fmtPts = (v) => Math.round(v).toLocaleString('en-US');
const _v = new THREE.Vector3();

// ------------------------------------------------------------ helpers
/** Progress of any car along a polyline (metres), for positions and rubber-banding. */
class Tracker {
  constructor(path, closed = false) {
    this.path = path;
    this.closed = closed;
    this.s = new Float32Array(path.length);
    for (let i = 1; i < path.length; i++) this.s[i] = this.s[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    this.length = this.s[path.length - 1] + (closed ? path[path.length - 1].distanceTo(path[0]) : 0);
    this.i = 0;
    this.lap = 0;
  }
  update(p) {
    const P = this.path, n = P.length;
    let best = this.i, bd = Infinity;
    for (let k = -4; k <= 14; k++) {
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
    if (this.closed && best > this.i + n / 2) this.lap--;
    this.i = best;
    this.off = Math.sqrt(bd);
    return this.lap * this.length + this.s[best];
  }
}

/** Points along the city road network through a list of [i, j] nodes, on the right side. */
function cityRoute(nodes, offset = 3.4) {
  const raw = nodes.map(([i, j]) => V(roadCoord(i), roadCoord(j)));
  const pts = smoothPath(raw, 2);
  return pts.map((p, i, arr) => {
    const q = arr[Math.min(arr.length - 1, i + 1)], r = arr[Math.max(0, i - 1)];
    const dx = q.x - r.x, dz = q.z - r.z;
    const l = Math.hypot(dx, dz) || 1;
    return V(p.x - (dz / l) * offset, p.z + (dx / l) * offset);
  });
}

/** Points from a terrain road (with heights), optionally a sub-range and lane offset. */
function roadRoute(game, id, from = 0, to = Infinity, offset = 2, step = 2) {
  const r = game.terrain.roads.find((q) => q.id === id);
  const out = [];
  const end = Math.min(r.pts.length - 1, to);
  for (let i = Math.max(0, from); i <= end; i += step) {
    const p = r.pts[i], rt = r.right[i];
    out.push(V(p.x + rt.x * offset, p.z + rt.z * offset, p.y));
  }
  return out;
}

function yawAt(path, i) {
  const a = path[Math.max(0, i)], b = path[Math.min(path.length - 1, i + 2)];
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** Put the player at a pose (with a quick fade). */
function place(ctx, pos, yaw) {
  const g = ctx.game;
  if (g.player.mode === 'foot') g.onFoot?.forceEnter?.();
  const car = g.player.car;
  const gy = g.world.groundAt(pos.x, pos.z, (pos.y || 0) + 30, { y: 0 }).y;
  car.placeAt(pos.x, gy, pos.z, yaw);
  car.ext.cruise.on = false;
  if (!car.phys.pt.running) car.startEngine();
  g.cam.initialized = false;
  ctx.startPos = car.body.position.clone();
}

function rivalCfg(i, diff) {
  const bodies = diff.reward > 1 ? ['coupe', 'muscle', 'coupe', 'sedan'] : diff.reward < 1 ? ['hatch', 'sedan', 'hatch', 'van'] : ['sedan', 'coupe', 'muscle', 'hatch'];
  const cols = ['#d11f2a', '#1f4fa8', '#f2b90c', '#2b7a3c', '#e8e8ea', '#6d1b7b'];
  return { ...configForBody(bodies[i % bodies.length], DEFAULT_CONFIG), paint: cols[i % cols.length], tune: diff.reward > 1 ? 2 : 1, tire: 'sport', livery: 'racing', plate: `RACE ${i + 1}` };
}

function spawnRivals(ctx, path, n, opts = {}) {
  const g = ctx.game;
  const rivals = [...RIVALS].sort(() => Math.random() - 0.5);
  for (let k = 0; k < n; k++) {
    const cfg = rivalCfg(k, ctx.diff);
    const car = new Car(g, cfg, { npc: true });
    g.addCar(car);
    const gi = 6 + Math.floor((k + 1) / 2) * 5;
    const p = path[Math.min(path.length - 1, gi)];
    const side = k % 2 ? -1 : 1;
    const yaw = yawAt(path, gi);
    const px = p.x + Math.cos(yaw) * side * 2.6, pz = p.z - Math.sin(yaw) * side * 2.6;
    const gy = g.world.groundAt(px, pz, (p.y || 0) + 30, { y: 0 }).y;
    car.placeAt(px, gy, pz, yaw);
    const rival = rivals[k];
    const drv = new PathDriver(g, car, path, { closed: !!opts.closed, skill: ctx.diff.skill * rival.skill, aggression: rival.aggression, laneOffset: side * 1.5 });
    drv.rival = rival;
    drv.frozen = true;
    car.raceName = rival.name;
    ctx.cars.push(car);
    ctx.drivers.push(drv);
  }
}

/** Checkpoint progression for the player. Returns true when the last one is passed. */
function checkpoints(ctx, radius = 11) {
  const g = ctx.game;
  const car = g.player.car;
  const cps = ctx.checkpoints;
  const c = cps[ctx.cp];
  if (!c) return true;
  const p = car.body.position;
  if (Math.hypot(p.x - c.x, p.z - c.z) < radius) {
    ctx.cp++;
    g.audio?.beep?.(1200);
    g.activities.showGates(cps, ctx.cp, radius);
    if (ctx.cp >= cps.length) return true;
  }
  g.hud.navArrow(cps[ctx.cp], `CP ${ctx.cp + 1}/${cps.length}`);
  return false;
}

function raceSetup(ctx, path, opts) {
  const g = ctx.game;
  ctx.path = path;
  ctx.closed = !!opts.closed;
  ctx.laps = opts.laps || 0;
  ctx.tracker = new Tracker(path, ctx.closed);
  place(ctx, path[2], yawAt(path, 2));
  spawnRivals(ctx, path, opts.rivals ?? 3, opts);
  const every = opts.cpEvery || 30;
  const cps = [];
  const total = ctx.closed ? path.length * ctx.laps : path.length;
  for (let k = every; k < total; k += every) {
    const p = path[k % path.length];
    cps.push({ x: p.x, z: p.z, y: p.y, yaw: yawAt(path, k % path.length) + Math.PI / 2 });
  }
  const last = path[ctx.closed ? 3 : path.length - 1];
  cps.push({ x: last.x, z: last.z, y: last.y, yaw: yawAt(path, ctx.closed ? 3 : path.length - 3) + Math.PI / 2 });
  ctx.checkpoints = cps;
  ctx.cp = 0;
  g.activities.showGates(cps, 0, 11);
  ctx.playerProgress = () => ctx.tracker.update(g.player.car.body.position);
  ctx.positions = () => {
    const me = ctx.playerProgress();
    const list = [{ name: 'You', progress: ctx.finishedAt ? 1e9 - ctx.finishedAt : me, me: true }];
    for (const d of ctx.drivers) list.push({ name: d.rival.name, progress: d.finishedAt ? 1e9 - d.finishedAt : d.progress || 0 });
    list.sort((a, b) => b.progress - a.progress);
    return list;
  };
}

function raceUpdate(ctx) {
  const g = ctx.game;
  const total = ctx.closed ? ctx.tracker.length * ctx.laps : ctx.tracker.length;
  for (const d of ctx.drivers) {
    if (!d.finishedAt && (d.progress || 0) >= total - 6) {
      d.finishedAt = ctx.t;
      d.finished = !ctx.closed;
    }
  }
  if (ctx.closed) ctx.lap = Math.max(0, ctx.tracker.lap);
  const done = checkpoints(ctx);
  const ahead = ctx.drivers.filter((d) => d.finishedAt).length;
  const pos = ctx.positions().findIndex((r) => r.me) + 1;
  g.hud.objective({ title: ctx.def.name, big: fmtTime(ctx.t), text: `Position ${pos}/${ctx.drivers.length + 1}${ctx.laps ? ` · lap ${Math.min(ctx.laps, ctx.lap + 1)}/${ctx.laps}` : ''}` });
  if (done) {
    ctx.finishedAt = ctx.t;
    ctx.place = ahead + 1;
    ctx.score = ctx.place;
    ctx.timeScore = ctx.t + (ctx.falseStart ? 2 : 0);
    ctx.summary = `Time ${fmtTime(ctx.timeScore)} · finished P${ctx.place} of ${ctx.drivers.length + 1}`;
    return 'done';
  }
  return null;
}

function raceDef(o) {
  return {
    ai: true,
    closed: o.closedCourse ?? true,
    scoreLabel: 'Position',
    format: (v) => `P${v}`,
    lowerIsBetter: true,
    medals: { gold: 1, silver: 2, bronze: 3 },
    medalText: (m) => ['', '3rd', '2nd', '1st'][m],
    xp: 220,
    color: 0xff4d4d,
    ...o,
    setup(ctx) {
      raceSetup(ctx, o.path(ctx.game), o);
    },
    update(ctx) {
      return raceUpdate(ctx);
    },
  };
}

/** Solo time trial along a path with checkpoints (and a ghost). */
function trialDef(o) {
  return {
    ghost: true,
    closed: true,
    lowerIsBetter: true,
    scoreLabel: 'Time',
    format: fmtTime,
    xp: 180,
    color: 0x37c8ff,
    ...o,
    setup(ctx) {
      const g = ctx.game;
      const path = o.path(g);
      ctx.path = path;
      place(ctx, path[1], yawAt(path, 1));
      const cps = [];
      for (let k = o.cpEvery || 40; k < path.length - 4; k += o.cpEvery || 40) cps.push({ x: path[k].x, z: path[k].z, y: path[k].y, yaw: yawAt(path, k) + Math.PI / 2 });
      const e = path[path.length - 1];
      cps.push({ x: e.x, z: e.z, y: e.y, yaw: yawAt(path, path.length - 3) + Math.PI / 2 });
      ctx.checkpoints = cps;
      ctx.cp = 0;
      g.activities.showGates(cps, 0, 11);
    },
    update(ctx) {
      const g = ctx.game;
      const done = checkpoints(ctx);
      g.hud.objective({ title: o.name, big: fmtTime(ctx.t), text: `Checkpoint ${Math.min(ctx.cp + 1, ctx.checkpoints.length)}/${ctx.checkpoints.length}${ctx.ghost ? ' · racing your ghost' : ''}` });
      if (done) {
        ctx.score = ctx.t + (ctx.falseStart ? 2 : 0);
        return 'done';
      }
      if (ctx.t > (o.timeLimit || 600)) {
        ctx.failReason = 'Out of time';
        return 'fail';
      }
      return null;
    },
  };
}

/** A pedestrian-ish spot on a sidewalk near a point. */
function sidewalkSpot(g, near, minD, maxD) {
  for (let k = 0; k < 40; k++) {
    const b = g.city.blocks[Math.floor(Math.random() * g.city.blocks.length)];
    const side = Math.floor(Math.random() * 4);
    const t = 0.15 + Math.random() * 0.7;
    const x = side === 0 ? b.x0 + 1.5 : side === 1 ? b.x1 - 1.5 : b.x0 + (b.x1 - b.x0) * t;
    const z = side === 2 ? b.z0 + 1.5 : side === 3 ? b.z1 - 1.5 : b.z0 + (b.z1 - b.z0) * t;
    const d = Math.hypot(x - near.x, z - near.z);
    if (d >= minD && d <= maxD) {
      // the kerb-side stopping point on the road next to it
      const rx = side === 0 ? -5 : side === 1 ? 5 : 0, rz = side === 2 ? -5 : side === 3 ? 5 : 0;
      return { walk: V(x, z), stop: V(x + rx, z + rz), name: b.label || g.city.streetName(V(x + rx, z + rz)) };
    }
  }
  return { walk: V(near.x + 100, near.z), stop: V(near.x + 100, near.z), name: 'Downtown' };
}

/** A beacon showing a pickup/drop-off point. */
function beacon(ctx, pos, color = 0x4cd964) {
  const g = ctx.game;
  if (ctx.beacon) g.activities.group.remove(ctx.beacon);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 30, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const gy = g.world.groundAt(pos.x, pos.z, 50, { y: 0 }).y;
  m.position.set(pos.x, gy + 15, pos.z);
  g.activities.group.add(m);
  ctx.beacon = m;
}
function clearBeacon(ctx) {
  if (ctx.beacon) ctx.game.activities.group.remove(ctx.beacon);
  ctx.beacon = null;
}

/** Ride comfort from accelerations and bumps (taxis, freight, ambulances). */
function comfort(ctx, car, dt, gLimit = 0.45) {
  const a = car.gforce;
  const lat = Math.hypot(a.x, a.z) / 9.81;
  const over = Math.max(0, lat - gLimit);
  const hit = car.lastImpact > 2 ? car.lastImpact * 0.02 : 0;
  ctx.comfort = clamp((ctx.comfort ?? 1) - (over * 0.35 + hit) * dt * 6, 0, 1);
  return ctx.comfort;
}

/** Swap the player into a special car for the event; restored afterwards. */
function lendCar(ctx, cfg, pos, yaw) {
  const g = ctx.game;
  if (g.career && g.player.car) g.career.storeCar(g.player.car);
  ctx.ownCfg = g.player.car ? { ...g.player.car.cfg } : null;
  const car = g.spawnPlayer(cfg, { pos, yaw });
  car.lent = true;
  car.ext.battery = 1;
  car.phys.pt.refill(1);
  car.startEngine();
  ctx.lent = car;
  ctx.startPos = car.body.position.clone();
  return car;
}
function returnCar(ctx) {
  const g = ctx.game;
  if (!ctx.lent) return;
  const p = ctx.lent.body.position.clone();
  const yaw = Math.atan2(ctx.lent.body.R[2], ctx.lent.body.R[8]);
  if (g.career) g.spawnCareerCar(g.career.car, ctx.returnTo || { pos: p, yaw });
  else g.spawnPlayer(g.carConfig, ctx.returnTo || { pos: p, yaw });
  // your own car is waiting with the engine idling
  const car = g.player.car;
  if (car && !car.phys.pt.running && !car.wrecked) {
    car.sys.ignition = 'on';
    car.phys.pt.running = true;
    car.phys.pt.omega = 90;
  }
  ctx.lent = null;
}

// ------------------------------------------------------------ the events
export function buildEvents(game) {
  const city = game.city;
  const T = game.terrain;
  const L = city.locations;
  const pg = city.locations.proving.pos;
  const skid = city.skidpad;
  const drag = city.dragStrip;
  const hospital = L.hospital ? L.hospital.pos.clone() : V(55, -224.8);
  const lot = L.parking ? L.parking.pos : V(-275, -55);
  const events = [];

  // ---------------- jobs ----------------
  events.push({
    id: 'taxi', name: 'Taxi Shift', icon: '🚕', job: true, level: 1, color: 0xffd60a,
    start: V(roadCoord(3) + 5, roadCoord(3) - 30), blurb: 'Pick up 3 fares. Smooth driving = big tips.',
    desc: 'Pick up passengers waiting at the kerb and drive them to their destination. They pay by distance and tip for a smooth, quick ride. Hard braking, big kerbs and crashes cost you stars.',
    reward: { gold: 900, silver: 650, bronze: 400 }, medals: { gold: 13, silver: 10, bronze: 6 }, scoreLabel: 'Stars', format: (v) => `${v}★`, xp: 200,
    countdown: false, falseStart: false,
    setup(ctx) {
      ctx.fare = 0;
      ctx.fares = 3;
      ctx.stars = 0;
      ctx.earned = 0;
      this.next(ctx);
    },
    next(ctx) {
      const g = ctx.game;
      const spot = sidewalkSpot(g, g.player.focus, 60, 220);
      ctx.pick = spot;
      ctx.stage = 'pickup';
      ctx.timer = 70;
      beacon(ctx, spot.stop, 0xffd60a);
    },
    update(ctx, dt) {
      const g = ctx.game;
      const car = g.player.car;
      const p = car.body.position;
      ctx.timer -= dt;
      if (ctx.stage === 'pickup') {
        g.hud.navArrow(ctx.pick.stop, 'Fare');
        g.hud.objective({ title: `TAXI · fare ${ctx.fare + 1}/${ctx.fares}`, text: `Pick up at ${ctx.pick.name}. Stop at the kerb.`, big: `${Math.max(0, Math.ceil(ctx.timer))} s` });
        if (p.distanceTo(ctx.pick.stop) < 7 && car.speed < 1) {
          const dest = sidewalkSpot(g, p, 260, 650);
          ctx.dest = dest;
          ctx.stage = 'ride';
          ctx.comfort = 1;
          ctx.rideT = 0;
          ctx.rideDist = p.distanceTo(dest.stop);
          ctx.timer = 40 + ctx.rideDist / 9;
          beacon(ctx, dest.stop, 0x4cd964);
          g.audio?.door?.(false);
          g.hud.say(car.body.position, ['To ' + dest.name + ', please.', 'I\'m late! Step on it — carefully.', 'Take me to ' + dest.name + '.'][Math.floor(Math.random() * 3)], 'ped', 3);
        }
        if (ctx.timer < 0) this.next(ctx);
      } else {
        ctx.rideT += dt;
        const c = comfort(ctx, car, dt);
        g.hud.navArrow(ctx.dest.stop, 'Drop-off');
        g.hud.objective({ title: `TAXI · fare ${ctx.fare + 1}/${ctx.fares}`, text: `To ${ctx.dest.name}`, big: `${'★'.repeat(Math.round(c * 5))}${'☆'.repeat(5 - Math.round(c * 5))}`, bar: Math.max(0, ctx.timer) / (40 + ctx.rideDist / 9), barColor: '#ffd60a' });
        if (p.distanceTo(ctx.dest.stop) < 8 && car.speed < 1) {
          const stars = Math.round(c * 5) - (ctx.timer < 0 ? 1 : 0);
          const fare = Math.round(20 + ctx.rideDist * 0.18);
          const tip = Math.round(fare * Math.max(0, stars - 2) * 0.15);
          ctx.stars += Math.max(0, stars);
          ctx.earned += fare + tip;
          g.toast(`Fare ${fare}$ + tip ${tip}$ · ${'★'.repeat(Math.max(0, stars))}`, 'good', 3);
          if (stars >= 5) g.career?.unlock('clean');
          ctx.fare++;
          if (ctx.fare >= ctx.fares) {
            ctx.score = ctx.stars;
            ctx.summary = `Fares and tips: $${ctx.earned}`;
            return 'done';
          }
          this.next(ctx);
        }
      }
      return null;
    },
    payout: (ctx, base) => base + ctx.earned,
    cleanup: clearBeacon,
  });

  events.push({
    id: 'courier', name: 'Courier Run', icon: '📦', job: true, level: 1, color: 0x8e6b3a,
    start: V(-249, 368), blurb: 'Deliver 4 parcels across town against the clock.',
    desc: 'Load up at the Pier 1 Logistics depot and drop four parcels at addresses around the city. Each drop adds time. Faster runs pay more.',
    reward: { gold: 1100, silver: 800, bronze: 500 }, medals: { gold: 200, silver: 260, bronze: 340 }, lowerIsBetter: true, scoreLabel: 'Time', format: fmtTime, xp: 220,
    countdown: false, falseStart: false,
    setup(ctx) {
      const g = ctx.game;
      ctx.drops = [];
      let from = V(-110, 340);
      for (let k = 0; k < 4; k++) {
        const s = sidewalkSpot(g, from, 180, 420);
        ctx.drops.push(s);
        from = s.stop;
      }
      ctx.k = 0;
      ctx.left = 75;
      beacon(ctx, ctx.drops[0].stop, 0xc9a26b);
    },
    update(ctx, dt) {
      const g = ctx.game;
      const car = g.player.car;
      ctx.left -= dt;
      const d = ctx.drops[ctx.k];
      g.hud.navArrow(d.stop, `Drop ${ctx.k + 1}/4`);
      g.hud.objective({ title: 'COURIER RUN', big: `${Math.max(0, ctx.left).toFixed(1)} s`, text: `Parcel ${ctx.k + 1}/4 → ${d.name}. Stop at the kerb.` });
      if (car.body.position.distanceTo(d.stop) < 8 && car.speed < 1.5) {
        ctx.k++;
        g.audio?.beep?.(1100);
        if (ctx.k >= 4) {
          ctx.score = ctx.t;
          return 'done';
        }
        ctx.left += 25 + car.body.position.distanceTo(ctx.drops[ctx.k].stop) / 14;
        beacon(ctx, ctx.drops[ctx.k].stop, 0xc9a26b);
      }
      if (ctx.left <= 0) {
        ctx.failReason = 'Out of time — the customer refused the late parcel';
        return 'fail';
      }
      return null;
    },
    cleanup: clearBeacon,
  });

  events.push({
    id: 'freight', name: 'Fragile Freight', icon: '🥚', job: true, level: 2, color: 0x80d0ff,
    start: V(-60, 490), blurb: 'Carry a crate of glassware to the construction site. Gently.',
    desc: 'A crate of crystal glassware from the port to the construction site. Cornering, braking and bumps over 0.45 g crack the cargo; a crash destroys it. You are paid for what arrives intact.',
    reward: { gold: 1600, silver: 1100, bronze: 600 }, medals: { gold: 90, silver: 70, bronze: 45 }, scoreLabel: 'Cargo intact', format: (v) => `${Math.round(v)}%`, xp: 260,
    countdown: false, falseStart: false,
    setup(ctx) {
      const b = city.blocks.find((q) => q.type === 'construction');
      ctx.dest = V((b.x0 + b.x1) / 2, b.z0 - 5);
      ctx.comfort = 1;
      ctx.limit = 300;
      beacon(ctx, ctx.dest, 0x80d0ff);
    },
    update(ctx, dt) {
      const g = ctx.game;
      const car = g.player.car;
      const c = comfort(ctx, car, dt, 0.45);
      if (car.lastImpact > 5) ctx.comfort = Math.max(0, ctx.comfort - 0.4);
      g.hud.navArrow(ctx.dest, 'Site');
      g.hud.objective({ title: 'FRAGILE FREIGHT', big: `${Math.round(c * 100)}% intact`, text: `Lateral ${(Math.hypot(car.gforce.x, car.gforce.z) / 9.81).toFixed(2)} g (limit 0.45 g) · ${Math.ceil(ctx.limit - ctx.t)} s`, bar: c, barColor: c > 0.7 ? '#4cd964' : c > 0.4 ? '#ffb020' : '#ff3b30' });
      if (car.body.position.distanceTo(ctx.dest) < 10 && car.speed < 1) {
        ctx.score = c * 100;
        return 'done';
      }
      if (c <= 0.02) {
        ctx.failReason = 'The cargo is ruined';
        return 'fail';
      }
      if (ctx.t > ctx.limit) {
        ctx.failReason = 'Too slow';
        return 'fail';
      }
      return null;
    },
    payout: (ctx, base) => base * (ctx.score / 100),
    cleanup: clearBeacon,
  });

  events.push({
    id: 'ambulance', name: 'Ambulance Run', icon: '🚑', job: true, lend: true, level: 3, color: 0xff3b30,
    start: hospital.clone(), blurb: 'Rush a patient to San Demo General. Fast but smooth.',
    desc: 'Take the ambulance, pick up the patient and bring them to the hospital. Time matters, but so does the ride: the medics hate hard hits.',
    reward: { gold: 1500, silver: 1000, bronze: 600 }, medals: { gold: 80, silver: 60, bronze: 35 }, scoreLabel: 'Patient score', format: (v) => `${Math.round(v)}`, xp: 260,
    countdown: false, falseStart: false, failOnWreck: true,
    setup(ctx) {
      const g = ctx.game;
      lendCar(ctx, { ...configForBody('van', DEFAULT_CONFIG), paint: '#f4f4f0', livery: 'side', accent: '#d11f2a', plate: 'SDGH 1', horn: 'high' }, V(hospital.x - 8, hospital.z), Math.PI / 2);
      g.player.car.police = false;
      ctx.returnTo = { pos: V(hospital.x - 14, hospital.z), yaw: Math.PI / 2 };
      // a downed pedestrian is the patient if there is one; otherwise a random address
      const down = g.peds?.list.find((p) => p.state === 'down');
      ctx.patient = down ? { stop: down.pos.clone(), name: 'the injured pedestrian', ped: down } : sidewalkSpot(g, hospital, 250, 500);
      ctx.stage = 'pickup';
      ctx.limit = 150;
      beacon(ctx, ctx.patient.stop, 0xff3b30);
    },
    update(ctx, dt) {
      const g = ctx.game;
      const car = g.player.car;
      car.sirenOn = true;
      if (ctx.stage === 'pickup') {
        g.hud.navArrow(ctx.patient.stop, 'Patient');
        g.hud.objective({ title: 'AMBULANCE', text: `Pick up ${ctx.patient.name}`, big: `${Math.ceil(ctx.limit - ctx.t)} s` });
        if (car.body.position.distanceTo(ctx.patient.stop) < 8 && car.speed < 1) {
          ctx.stage = 'ride';
          ctx.comfort = 1;
          if (ctx.patient.ped) g.peds.list.splice(g.peds.list.indexOf(ctx.patient.ped), 1);
          beacon(ctx, hospital, 0xff3b30);
        }
      } else {
        const c = comfort(ctx, car, dt, 0.55);
        g.hud.navArrow(hospital, 'Hospital');
        g.hud.objective({ title: 'AMBULANCE', text: 'To San Demo General', big: `${Math.ceil(ctx.limit - ctx.t)} s`, bar: c, barColor: '#ff3b30' });
        if (car.body.position.distanceTo(hospital) < 9 && car.speed < 1) {
          ctx.score = clamp(c * 60 + Math.max(0, ctx.limit - ctx.t) * 0.4, 0, 100);
          return 'done';
        }
      }
      if (ctx.t > ctx.limit) {
        ctx.failReason = 'The patient didn\'t make it in time';
        return 'fail';
      }
      return null;
    },
    cleanup(ctx) {
      clearBeacon(ctx);
      if (ctx.game.player.car) ctx.game.player.car.sirenOn = false;
      returnCar(ctx);
    },
  });

  events.push({
    id: 'valet', name: 'Valet Parking', icon: '🅿️', job: true, lend: true, level: 2, color: 0xb04bff,
    start: V(roadCoord(2) + 20, roadCoord(2) + 7), blurb: 'Park a customer\'s sports car. Not a scratch.',
    desc: 'Take a guest\'s very expensive coupe from the hotel to the parking lot and park it straight in the marked bay. Speed, alignment and damage are scored.',
    reward: { gold: 900, silver: 650, bronze: 350 }, medals: { gold: 85, silver: 65, bronze: 40 }, scoreLabel: 'Valet score', format: (v) => `${Math.round(v)}`, xp: 180,
    countdown: false, falseStart: false,
    setup(ctx) {
      const g = ctx.game;
      const start = V(roadCoord(2) + 20, roadCoord(2) + 10);
      lendCar(ctx, { ...configForBody('coupe', DEFAULT_CONFIG), paint: '#d4af37', finish: 'pearl', tune: 2, plate: 'RICH 1', wheelStyle: 'mesh' }, start, Math.PI / 2);
      ctx.returnTo = { pos: V(start.x - 8, start.z), yaw: Math.PI / 2 };
      const spot = g.city.parkingSpots?.find((s) => !s.police) || { pos: lot, yaw: 0 };
      ctx.bay = { pos: (spot.pos || spot).clone ? (spot.pos || spot).clone() : V(lot.x, lot.z), yaw: spot.yaw || 0 };
      // clear whatever is parked in the bay
      for (const c of g.cars) if (c !== g.player.car && c.parked && c.body.position.distanceTo(ctx.bay.pos) < 3) c.placeAt(ctx.bay.pos.x + 400, 0, ctx.bay.pos.z, 0);
      beacon(ctx, ctx.bay.pos, 0xb04bff);
      ctx.dmg0 = 0;
    },
    update(ctx) {
      const g = ctx.game;
      const car = g.player.car;
      const p = car.body.position;
      const d = Math.hypot(p.x - ctx.bay.pos.x, p.z - ctx.bay.pos.z);
      const yaw = Math.atan2(car.body.R[2], car.body.R[8]);
      let dy = Math.abs(((yaw - ctx.bay.yaw) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2);
      g.hud.navArrow(ctx.bay.pos, 'Bay');
      g.hud.objective({ title: 'VALET', big: `${(90 - ctx.t).toFixed(0)} s`, text: `Park in the bay. ${d < 12 ? `Offset ${d.toFixed(1)} m · angle ${Math.round(dy * 57.3)}°` : ''} Stop with the parking brake (Space) to finish.` });
      if (d < 2.2 && car.speed < 0.3 && (car.phys.input.handbrake > 0 || car.parkLever)) {
        const dmg = car.damageSummary().body;
        ctx.score = clamp(100 - d * 18 - dy * 57.3 * 0.9 - dmg * 300 - Math.max(0, ctx.t - 25) * 0.8, 0, 100);
        ctx.summary = `Offset ${d.toFixed(2)} m · angle ${Math.round(dy * 57.3)}° · ${ctx.t.toFixed(1)} s${dmg > 0.01 ? ` · damage ${Math.round(dmg * 100)}%` : ''}`;
        return 'done';
      }
      if (ctx.t > 90) {
        ctx.failReason = 'The guest is furious: too slow';
        return 'fail';
      }
      return null;
    },
    cleanup(ctx) {
      clearBeacon(ctx);
      returnCar(ctx);
    },
  });

  // ---------------- races ----------------
  events.push(raceDef({
    id: 'sprint', name: 'Downtown Sprint', icon: '🏁', level: 1, closedCourse: false,
    start: V(roadCoord(3) + 3.4, roadCoord(0) + 14), blurb: 'Street race through downtown traffic. Police may join in.',
    desc: 'An illegal street race through live traffic: four drivers, seven corners, red lights optional. If the police see you speeding, they will join in.',
    reward: { gold: 1200, silver: 700, bronze: 400 }, rivals: 3, cpEvery: 25,
    path: () => cityRoute([[3, 0], [3, 2], [4, 2], [4, 4], [2, 4], [2, 6], [5, 6]]),
  }));
  events.push(raceDef({
    id: 'canyon', name: 'Canyon Run', icon: '⛰️', level: 3,
    start: V(110 + 2, -350), blurb: 'Up Canyon Rd to Demo Peak against three rivals.',
    desc: 'A closed-road race up the canyon: hairpins, cliffs and guardrails all the way to the lookout. Watch the brakes on the way back down.',
    reward: { gold: 2600, silver: 1500, bronze: 800 }, rivals: 3, cpEvery: 60, xp: 320,
    path: (g) => roadRoute(g, 'canyon', 8, g.terrain.lookout.roadIndex, 2),
  }));
  events.push(raceDef({
    id: 'harbor', name: 'Harbor Circuit', icon: '⚓', level: 2,
    start: V(-150, 392), blurb: '3 laps around the container yard and under the cranes.',
    desc: 'Three laps of the port: a fast run along the quay under the cranes and tight aisles between the container stacks.',
    reward: { gold: 1800, silver: 1100, bronze: 600 }, rivals: 3, closed: true, laps: 3, cpEvery: 40, xp: 260,
    path: () => smoothPath([V(-150, 392), V(40, 392), V(58, 410), V(58, 480), V(40, 497), V(-150, 497), V(-172, 482), V(-175, 410)], 2, true),
  }));

  // drag strip duel
  events.push({
    id: 'drag', name: 'Quarter Mile Duel', icon: '🚦', level: 1, ai: true, closed: true, color: 0xff6a1f,
    start: V(drag.x - 4, drag.start - 6), blurb: 'One rival, 402 metres, perfect launch.',
    desc: 'Line up on the drag strip against a local hero. The lights count down; launch on green. First to the quarter-mile line wins.',
    reward: { gold: 900, silver: 500, bronze: 250 }, medals: { gold: 12.5, silver: 14, bronze: 16 }, lowerIsBetter: true, scoreLabel: 'Elapsed time', format: (v) => `${v.toFixed(3)} s`, xp: 150,
    setup(ctx) {
      const g = ctx.game;
      place(ctx, V(drag.x - 4, drag.start - 3), 0);
      const path = [];
      for (let z = drag.start - 3; z < drag.quarter + 80; z += 2) path.push(V(drag.x + 4, z));
      const car = new Car(g, { ...rivalCfg(2, ctx.diff), body: 'muscle', engine: 'v8' }, { npc: true });
      g.addCar(car);
      car.placeAt(drag.x + 4, 0, drag.start - 3, 0);
      const rival = RIVALS[Math.floor(Math.random() * RIVALS.length)];
      const d = new PathDriver(g, car, path, { skill: 1 });
      d.rival = rival;
      d.frozen = true;
      ctx.cars.push(car);
      ctx.drivers.push(d);
      ctx.react = null;
    },
    onGo(ctx) {
      ctx.goT = performance.now();
    },
    update(ctx) {
      const g = ctx.game;
      const car = g.player.car;
      const z = car.body.position.z;
      if (ctx.react == null && car.forwardSpeed > 0.5) ctx.react = ctx.t;
      const rv = ctx.cars[0];
      if (!ctx.rivalT && rv.body.position.z >= drag.quarter) ctx.rivalT = ctx.t;
      g.hud.objective({ title: 'QUARTER MILE', big: `${ctx.t.toFixed(2)} s`, text: `${Math.round(car.speed * KMH)} km/h${ctx.react != null ? ` · reaction ${ctx.react.toFixed(3)} s` : ''}`, bar: clamp((z - drag.start) / 402, 0, 1) });
      if (z >= drag.quarter) {
        ctx.score = ctx.t + (ctx.falseStart ? 2 : 0);
        ctx.place = ctx.rivalT && ctx.rivalT < ctx.t ? 2 : 1;
        ctx.summary = `${ctx.place === 1 ? 'You won!' : 'Beaten by ' + ctx.drivers[0].rival.name} · trap speed ${Math.round(car.speed * KMH)} km/h · reaction ${(ctx.react || 0).toFixed(3)} s`;
        return 'done';
      }
      if (ctx.t > 40) return 'fail';
      return null;
    },
    medalFor(ctx, score) {
      if (ctx.place !== 1) return score <= 16 ? 1 : 0;
      return score <= 12.5 ? 3 : score <= 14 ? 2 : 1;
    },
  });

  // ---------------- time trials ----------------
  events.push(trialDef({
    id: 'coastTT', name: 'Coast Highway Time Trial', icon: '🌊', level: 2,
    start: V(222, 356), blurb: 'The full coast highway loop, flat out. Beat your ghost.',
    desc: 'Around the proving grounds via the beach and the east hills, back into the city from the north. Your best run is saved as a ghost.',
    reward: { gold: 2000, silver: 1200, bronze: 700 }, medals: { gold: 95, silver: 110, bronze: 130 }, cpEvery: 60,
    path: (g) => roadRoute(g, 'coast', 6, Infinity, 2.2),
  }));
  events.push(trialDef({
    id: 'hillclimb', name: 'Canyon Hill-climb', icon: '⏱️', level: 4,
    start: V(124, -446), blurb: 'Solo time attack to the summit.',
    desc: 'Just you, the clock and your ghost, from the canyon entrance to the Demo Peak lookout.',
    reward: { gold: 2400, silver: 1500, bronze: 800 }, medals: { gold: 95, silver: 110, bronze: 130 }, cpEvery: 70,
    path: (g) => roadRoute(g, 'canyon', 120, g.terrain.lookout.roadIndex, 0),
  }));
  events.push(trialDef({
    id: 'rally', name: 'Forest Rally Stage', icon: '🌲', level: 3, color: 0x8bc34a,
    start: V(-497, -239), blurb: 'Gravel stage through the West Hills to the lighthouse.',
    desc: 'A dirt rally stage: crests, cambers and loose surface all the way down to the coast. All-terrain tyres and AWD help.',
    reward: { gold: 2200, silver: 1400, bronze: 700 }, medals: { gold: 75, silver: 90, bronze: 110 }, cpEvery: 50,
    path: (g) => roadRoute(g, 'trail', 6, Infinity, 0),
  }));

  // ---------------- skills ----------------
  events.push({
    id: 'drift', name: 'Drift Trial', icon: '💨', level: 2, closed: true, color: 0xff2bd6,
    start: V(skid.x - skid.r - 6, skid.z), blurb: '90 seconds on the skid pad. Angle, speed, combos.',
    desc: 'Score drift points on the skid pad: hold big angles at speed and chain drifts together for a multiplier. Hitting anything ends the combo.',
    reward: { gold: 1200, silver: 800, bronze: 400 }, medals: { gold: 30000, silver: 18000, bronze: 8000 }, scoreLabel: 'Points', format: fmtPts, xp: 200,
    setup(ctx) {
      place(ctx, V(skid.x - skid.r, skid.z - 8), 0);
      ctx.game.freeroam.forceDrift = true;
      ctx.base = ctx.game.freeroam.driftTotal;
    },
    update(ctx) {
      const g = ctx.game;
      const fr = g.freeroam;
      const pts = fr.driftTotal - ctx.base + (fr.drift ? fr.drift.score * fr.drift.mult : 0);
      g.hud.objective({ title: 'DRIFT TRIAL', big: fmtPts(pts), text: `${Math.ceil(90 - ctx.t)} s left${fr.drift ? ` · combo ×${fr.drift.mult.toFixed(1)}` : ''}` });
      if (ctx.t >= 90) {
        fr.bankDrift();
        ctx.score = fr.driftTotal - ctx.base;
        return 'done';
      }
      return null;
    },
    cleanup(ctx) {
      ctx.game.freeroam.forceDrift = false;
    },
  });

  events.push({
    id: 'slalom', name: 'Slalom', icon: '🔶', level: 1, closed: true, color: 0xff9500,
    start: V(pg.x + 70, -278), blurb: 'Weave the 12-cone slalom. +1 s per cone hit.',
    desc: 'Weave left and right through the line of cones at the proving grounds and through the finish gate. Every cone knocked over costs a second.',
    reward: { gold: 700, silver: 450, bronze: 250 }, medals: { gold: 19, silver: 23, bronze: 28 }, lowerIsBetter: true, scoreLabel: 'Time', format: (v) => `${v.toFixed(2)} s`, xp: 140,
    setup(ctx) {
      const g = ctx.game;
      const x = pg.x + 70;
      place(ctx, V(x - 4, -285), 0);
      ctx.gates = [];
      for (let k = 0; k < 12; k++) ctx.gates.push({ x: x + (k % 2 ? -3.5 : 3.5), z: -260 + k * 18 });
      ctx.finishZ = -260 + 12 * 18;
      ctx.hits0 = g.props.coneHits || 0;
      ctx.k = 0;
      ctx.missed = 0;
      g.activities.showGates([{ x, z: ctx.finishZ, yaw: Math.PI / 2 }], 0, 9);
    },
    update(ctx) {
      const g = ctx.game;
      const p = g.player.car.body.position;
      const gate = ctx.gates[ctx.k];
      if (gate && p.z > gate.z) {
        // must pass on the correct side of each cone
        const side = gate.x > pg.x + 70 ? 1 : -1;
        if ((p.x - (pg.x + 70)) * side > 0) ctx.missed++;
        ctx.k++;
      }
      const hits = (g.props.coneHits || 0) - ctx.hits0;
      g.hud.objective({ title: 'SLALOM', big: `${(ctx.t + hits + ctx.missed * 2).toFixed(2)} s`, text: `Cones hit ${hits} · gates missed ${ctx.missed} (+2 s each)` });
      if (p.z > ctx.finishZ) {
        ctx.score = ctx.t + hits + ctx.missed * 2 + (ctx.falseStart ? 2 : 0);
        ctx.summary = `Raw ${ctx.t.toFixed(2)} s · ${hits} cones · ${ctx.missed} missed`;
        return 'done';
      }
      if (ctx.t > 60) return 'fail';
      return null;
    },
    cleanup(ctx) {
      ctx.game.props.resetCones?.();
    },
  });

  events.push({
    id: 'eco', name: 'Eco Challenge', icon: '🍃', level: 1, color: 0x4cd964, closed: false,
    start: (L.gas ? L.gas.pos.clone().add(V(0, 12)) : V(110, -110)), blurb: 'Fuel Stop to the beach on as little fuel as possible.',
    desc: 'Drive from the Fuel Stop to Demo Beach within 4 minutes using as little fuel (or charge) as you can. Smooth throttle, early upshifts, Eco mode and coasting all help.',
    reward: { gold: 800, silver: 550, bronze: 300 }, medals: { gold: 7, silver: 9, bronze: 12 }, lowerIsBetter: true, scoreLabel: 'Consumption', format: (v) => `${v.toFixed(1)} /100km`, xp: 160,
    countdown: false, falseStart: false,
    setup(ctx) {
      const car = ctx.game.player.car;
      ctx.dest = L.beach ? L.beach.pos.clone() : V(420, 452);
      car.ext.resetTrip('a');
      beacon(ctx, ctx.dest, 0x4cd964);
    },
    update(ctx) {
      const g = ctx.game;
      const car = g.player.car;
      const tr = car.ext.trip;
      g.hud.navArrow(ctx.dest, 'Beach');
      g.hud.objective({ title: 'ECO CHALLENGE', big: `${tr.avg.toFixed(1)} ${car.phys.pt.ev ? 'kWh' : 'L'}/100km`, text: `Now ${tr.inst.toFixed(1)} · ${Math.ceil(240 - ctx.t)} s left` });
      if (car.body.position.distanceTo(ctx.dest) < 25 && car.speed < 2) {
        ctx.score = tr.avg * (car.phys.pt.ev ? 0.45 : 1);
        return 'done';
      }
      if (ctx.t > 240) {
        ctx.failReason = 'Too slow';
        return 'fail';
      }
      return null;
    },
    cleanup: clearBeacon,
  });

  // ---------------- demolition derby ----------------
  events.push({
    id: 'derby', name: 'Demolition Derby', icon: '💥', level: 2, closed: true, color: 0xff3b30,
    start: V(pg.x + 140, 150), blurb: 'Six cars, one arena. Last car running wins.',
    desc: 'A walled arena at the proving grounds and five drivers with nothing to lose. Disable them before they disable you. Your car takes real damage (in Career, so does your repair bill).',
    reward: { gold: 2000, silver: 1100, bronze: 500 }, scoreLabel: 'Placing', format: (v) => `P${v}`, lowerIsBetter: true, medals: { gold: 1, silver: 2, bronze: 3 }, medalText: (m) => ['', '3rd', '2nd', 'Winner'][m], xp: 300,
    failOnWreck: false,
    setup(ctx) {
      const g = ctx.game;
      const c = V(pg.x + 140, 220);
      const R = 34;
      ctx.arena = { c, R };
      // temporary wall of concrete blocks
      ctx.walls = [];
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 });
      const geo = new THREE.BoxGeometry(4.2, 1.4, 1.2);
      for (let k = 0; k < 52; k++) {
        const a = (k / 52) * Math.PI * 2;
        const x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R;
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 0.7, z);
        m.rotation.y = -a + Math.PI / 2;
        g.scene.add(m);
        ctx.walls.push(m, g.world.addCylinder(x, z, 1.5, 0, 1.4, { kind: 'wall', mat: MATERIALS.concrete }));
      }
      place(ctx, V(c.x - R + 6, c.z), Math.PI / 2);
      const rivals = [g.player.car];
      for (let k = 0; k < 5; k++) {
        const a = ((k + 1) / 6) * Math.PI * 2 + Math.PI;
        const cfg = { ...configForBody(['sedan', 'van', 'pickup', 'hatch', 'suv'][k], DEFAULT_CONFIG), paint: ['#d11f2a', '#f2b90c', '#2b7a3c', '#1f4fa8', '#ff6a13'][k], livery: 'racing', plate: `DERBY ${k + 1}` };
        const car = new Car(g, cfg, { npc: true });
        g.addCar(car);
        car.placeAt(c.x + Math.cos(a) * (R - 6), 0, c.z + Math.sin(a) * (R - 6), Math.atan2(-Math.cos(a), -Math.sin(a)));
        rivals.push(car);
        ctx.cars.push(car);
        const d = new DerbyDriver(g, car, rivals);
        d.frozen = true;
        d.rival = { name: ['Crusher', 'Rust Bucket', 'Mad Max', 'Bumper Cars Betty', 'The Fridge'][k] };
        ctx.drivers.push(d);
      }
      ctx.idle = new Map();
      ctx.out = [];
      ctx.positions = () => {
        const list = [{ name: 'You', me: true, progress: g.player.car.derbyOut ? -1 : 1 }];
        for (const d of ctx.drivers) list.push({ name: d.rival.name + (d.car.derbyOut ? ' ✖' : ''), progress: d.car.derbyOut ? -1 : 0.5 });
        return list.sort((a, b) => b.progress - a.progress);
      };
    },
    update(ctx, dt) {
      const g = ctx.game;
      const all = [g.player.car, ...ctx.cars];
      for (const car of all) {
        if (car.derbyOut) continue;
        // out if wrecked, or stuck/immobile for 10 s
        const idle = car.speed < 0.8 ? (ctx.idle.get(car) || 0) + dt : 0;
        ctx.idle.set(car, idle);
        if (car.wrecked || idle > 10 || car.body.position.distanceTo(ctx.arena.c) > ctx.arena.R + 15) {
          car.derbyOut = true;
          ctx.out.push(car);
          if (car.controller) car.controller.out = true;
          if (car !== g.player.car) g.toast(`${car.controller?.rival?.name || 'A car'} is out!`, 'info', 2);
        }
      }
      const alive = all.filter((c) => !c.derbyOut);
      g.hud.objective({ title: 'DEMOLITION DERBY', big: `${alive.length} left`, text: g.player.car.derbyOut ? 'You are out.' : 'Ram the others. Stay mobile!' });
      if (g.player.car.derbyOut || alive.length <= 1) {
        ctx.place = g.player.car.derbyOut ? alive.length + 1 + ctx.out.slice(ctx.out.indexOf(g.player.car) + 1).length : 1;
        ctx.score = ctx.place;
        if (ctx.place === 1) g.career?.unlock('derby');
        ctx.summary = `${ctx.out.length} cars knocked out`;
        return 'done';
      }
      return null;
    },
    cleanup(ctx) {
      const g = ctx.game;
      for (const w of ctx.walls || []) {
        if (w.isMesh) g.scene.remove(w);
        else g.world.removeCylinder(w);
      }
      if (g.player.car) g.player.car.derbyOut = false;
    },
  });

  // ---------------- police ----------------
  events.push({
    id: 'copduty', name: 'Cop Duty', icon: '🚓', lend: true, level: 3, color: 0x2f7bff,
    start: L.police ? L.police.pos.clone().add(V(-6, 6)) : V(110, 110), blurb: 'Drive a cruiser and stop three fleeing suspects.',
    desc: 'Ride along with the SDPD: take a cruiser, chase the suspects dispatch sends you after, and stop them (box them in or disable their car). Siren on G.',
    reward: { gold: 2400, silver: 1500, bronze: 800 }, medals: { gold: 3, silver: 2, bronze: 1 }, scoreLabel: 'Arrests', format: (v) => `${v}/3`, xp: 320,
    countdown: false, falseStart: false, failOnWreck: false,
    setup(ctx) {
      const g = ctx.game;
      const pos = L.police.pos.clone();
      lendCar(ctx, { ...configForBody('sedan', DEFAULT_CONFIG), livery: 'police', paint: '#ffffff', plate: 'SDPD 12', engine: 'v8', tune: 1 }, pos, L.police.yaw);
      g.player.car.police = true;
      g.player.car.sirenOn = true;
      ctx.returnTo = { pos: pos.clone().add(V(8, 0)), yaw: L.police.yaw };
      ctx.arrests = 0;
      ctx.suspect = null;
      ctx.wait = 3;
      g.police && (g.police.paused = true);
    },
    spawnSuspect(ctx) {
      const g = ctx.game;
      const me = g.player.car.body.position;
      let best = null;
      for (const d of g.traffic?.drivers || []) {
        const c = d.car;
        const dist = c.body.position.distanceTo(me);
        if (dist > 120 && dist < 320 && c.physicsActive !== undefined) {
          best = c;
          break;
        }
      }
      if (!best) return;
      const drv = best.controller;
      const i = g.traffic.drivers.indexOf(drv);
      if (i >= 0) g.traffic.drivers.splice(i, 1);
      best.physicsActive = true;
      const f = new FleeDriver(g, best, g.player.car);
      f.skill = 0.78 + Math.random() * 0.15;
      ctx.suspect = best;
      ctx.drivers.push(f);
      ctx.stopT = 0;
      g.hud.big('DISPATCH', `Suspect in a ${best.model.prof.b.name} (${best.cfg.plate}) — stop them!`, 3);
      g.audio?.radioChatter?.();
    },
    update(ctx, dt) {
      const g = ctx.game;
      if (!ctx.suspect) {
        ctx.wait -= dt;
        g.hud.objective({ title: 'COP DUTY', big: `${ctx.arrests}/3`, text: 'Waiting for dispatch…' });
        if (ctx.wait <= 0) this.spawnSuspect(ctx);
        if (ctx.t > 300) return ctx.arrests ? ((ctx.score = ctx.arrests), 'done') : 'fail';
        return null;
      }
      const s = ctx.suspect;
      const d = s.body.position.distanceTo(g.player.car.body.position);
      if (s.speed < 2 && d < 14) ctx.stopT += dt;
      else ctx.stopT = Math.max(0, ctx.stopT - dt);
      g.hud.navArrow(s.body.position, 'Suspect');
      g.hud.objective({ title: 'COP DUTY', big: `${ctx.arrests}/3`, text: `Suspect ${Math.round(d)} m away${ctx.stopT > 0 ? ` · arresting ${Math.round((ctx.stopT / 3) * 100)}%` : ''}`, bar: ctx.stopT / 3, barColor: '#2f7bff' });
      if (ctx.stopT >= 3 || s.wrecked) {
        ctx.arrests++;
        g.toast('Suspect in custody! 👮', 'good', 2.5);
        const idx = ctx.drivers.findIndex((x) => x.car === s);
        if (idx >= 0) ctx.drivers.splice(idx, 1);
        ctx.cars.push(s);
        ctx.suspect = null;
        ctx.wait = 4;
        if (ctx.arrests >= 3) {
          ctx.score = 3;
          return 'done';
        }
      }
      if (d > 600) {
        g.toast('The suspect got away', 'warn');
        const idx = ctx.drivers.findIndex((x) => x.car === s);
        if (idx >= 0) ctx.drivers.splice(idx, 1);
        ctx.cars.push(s);
        ctx.suspect = null;
        ctx.wait = 4;
      }
      if (ctx.t > 300) {
        ctx.score = ctx.arrests;
        return ctx.arrests ? 'done' : 'fail';
      }
      return null;
    },
    cleanup(ctx) {
      const g = ctx.game;
      g.police && (g.police.paused = false);
      returnCar(ctx);
    },
  });

  events.push({
    id: 'heatrun', name: 'Heat Run', icon: '🔥', level: 3, color: 0xff2d55, closed: false,
    start: city.locations.construction ? city.locations.construction.pos.clone().add(V(0, 30)) : V(220, 0), blurb: 'Start with 3 stars. Survive 2 minutes.',
    desc: 'Someone tipped off the cops: you start with a 3-star wanted level. Stay free for two minutes, or lose them completely for a bonus.',
    reward: { gold: 2600, silver: 1600, bronze: 900 }, medals: { gold: 120, silver: 90, bronze: 60 }, scoreLabel: 'Survived', format: (v) => `${Math.round(v)} s`, xp: 320,
    countdown: false, falseStart: false, failOnWreck: false,
    setup(ctx) {
      const g = ctx.game;
      if (!g.settings.cops) g.settings.cops = true;
      g.police.heat = 3;
      g.police.startPursuit?.(null, false);
      g.police.dispatch?.(3, false);
      ctx.busted0 = g.police.bustCount || 0;
    },
    update(ctx) {
      const g = ctx.game;
      const busted = (g.police.bustCount || 0) > ctx.busted0;
      g.hud.objective({ title: 'HEAT RUN', big: `${Math.max(0, 120 - ctx.t).toFixed(0)} s`, text: g.police.heat > 0 ? `${'★'.repeat(Math.floor(g.police.heat))} wanted` : 'You lost them!' });
      if (busted) {
        ctx.failReason = 'Busted';
        return 'fail';
      }
      if (ctx.t >= 120 || (g.police.heat <= 0 && ctx.t > 20)) {
        ctx.score = ctx.t >= 120 ? 120 : ctx.t + 60;
        ctx.summary = g.police.heat <= 0 ? 'You shook them off completely (+60 s bonus)' : 'Still wanted — lose them!';
        return 'done';
      }
      return null;
    },
  });

  return events;
}

export { Tracker, cityRoute, roadRoute, fmtTime };
