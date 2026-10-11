import * as THREE from 'three';
import { CITY, roadCoord } from '../world/city.js';
import { clamp, lerp, wrapAngle } from '../core/util.js';

const { N, RW } = CITY;
const INSET = 2.2; // walking line from the block edge
const SHIRTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400, 0x7f8c8d, 0xe84393];
const PANTS = [0x2c3e50, 0x1b2631, 0x5d4037, 0x34495e, 0x212121, 0x6d6875, 0x3d5a80];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
const HAIR = [0x2b1d0e, 0x4a3222, 0x0f0f0f, 0x8c6239, 0xd8c08a, 0x9a9a9a];
const SHOUTS = ['Hey!', 'Watch it!', 'Are you crazy?!', 'Slow down!', 'Idiot!', 'Whoa!', 'Learn to drive!', 'I have a family!'];
const TYPES = [
  { kind: 'walker', speed: [1.2, 1.55], w: 0.5 },
  { kind: 'jogger', speed: [2.6, 3.2], w: 0.14 },
  { kind: 'dog', speed: [1.1, 1.4], w: 0.12 },
  { kind: 'texter', speed: [0.95, 1.15], w: 0.14 },
  { kind: 'elderly', speed: [0.7, 0.9], w: 0.1 },
];

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _l = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Sidewalk pedestrians. Each block has a walking loop around its sidewalk;
 * at signalled corners people wait for the walk phase and use the zebra
 * crossings. They dodge cars, react to horns, and can be knocked over
 * (which the police take very seriously).
 */
export class Pedestrians {
  constructor(game) {
    this.game = game;
    this.city = game.city;
    this.list = [];
    this.max = 60;
    this.rng = Math.random;
    this.buildGraph();
    this.buildMeshes();
    this.hitCount = 0;
  }

  // ------------------------------------------------------------ graph
  buildGraph() {
    const city = this.city;
    this.loops = [];
    for (const b of city.blocks) {
      const y = b.flat ? 0 : CITY.CURB;
      const pts = [
        new THREE.Vector3(b.x0 + INSET, y, b.z0 + INSET),
        new THREE.Vector3(b.x1 - INSET, y, b.z0 + INSET),
        new THREE.Vector3(b.x1 - INSET, y, b.z1 - INSET),
        new THREE.Vector3(b.x0 + INSET, y, b.z1 - INSET),
      ];
      this.loops.push({ b, pts, cross: [[], [], [], []] });
    }
    const loopAt = (bi, bj) => this.loops.find((l) => l.b.bi === bi && l.b.bj === bj);
    // corner k of block (bi,bj): 0 = (x0,z0) 1 = (x1,z0) 2 = (x1,z1) 3 = (x0,z1)
    for (const L of this.loops) {
      const { bi, bj } = L.b;
      const corners = [[bi, bj], [bi + 1, bj], [bi + 1, bj + 1], [bi, bj + 1]]; // node at each corner
      corners.forEach(([ni, nj], k) => {
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) return;
        const node = city.node(ni, nj);
        if (!node.signal) return;
        // across the avenue at x = node.x (to the block on the other side in x)
        const dx = k === 1 || k === 2 ? 1 : -1;
        const other = loopAt(bi + dx, bj);
        if (other) {
          const ok = k === 1 ? 0 : k === 2 ? 3 : k === 0 ? 1 : 2;
          L.cross[k].push({ to: other, k: ok, axis: 'z', node });
        }
        // across the street at z = node.z
        const dz = k === 2 || k === 3 ? 1 : -1;
        const other2 = loopAt(bi, bj + dz);
        if (other2) {
          const ok = k === 2 ? 1 : k === 3 ? 0 : k === 1 ? 2 : 3;
          L.cross[k].push({ to: other2, k: ok, axis: 'x', node });
        }
      });
    }
  }

  /** May a pedestrian start crossing a road of this axis at this node now? */
  walkSignal(node, axis) {
    const city = this.city;
    const total = city.signalPhaseLen.reduce((a, b) => a + b, 0);
    let t = (city.time + node.offset) % total;
    let phase = 0;
    while (t > city.signalPhaseLen[phase]) {
      t -= city.signalPhaseLen[phase];
      phase++;
    }
    const remaining = city.signalPhaseLen[phase] - t;
    // crossing a z-axis road is safe while x-axis traffic has green (z is red)
    const want = axis === 'z' ? 3 : 0;
    return phase === want && remaining > 5;
  }

  // ------------------------------------------------------------ meshes
  buildMeshes() {
    const max = 90;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const mk = (geo, count = max) => {
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.castShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      this.game.scene.add(im);
      return im;
    };
    const torso = new THREE.BoxGeometry(0.4, 0.58, 0.22);
    const head = new THREE.IcosahedronGeometry(0.115, 1);
    const hair = new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const leg = new THREE.BoxGeometry(0.15, 0.82, 0.16);
    leg.translate(0, -0.41, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.62, 0.11);
    arm.translate(0, -0.3, 0);
    const dogBody = new THREE.BoxGeometry(0.24, 0.26, 0.62);
    const dogHead = new THREE.BoxGeometry(0.18, 0.18, 0.24);
    this.im = {
      torso: mk(torso), head: mk(head), hair: mk(hair),
      legL: mk(leg), legR: mk(leg), armL: mk(arm), armR: mk(arm),
      dog: mk(dogBody, 30), dogHead: mk(dogHead, 30),
    };
    // a small pool of floating speech labels
    this.bubbles = [];
  }

  // ------------------------------------------------------------ spawning
  spawnNear(center, rnd = Math.random) {
    const near = this.loops.filter((L) => {
      const b = L.b;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      return Math.hypot(cx - center.x, cz - center.z) < 190;
    });
    if (!near.length) return null;
    const L = near[Math.floor(rnd() * near.length)];
    const k = Math.floor(rnd() * 4);
    const a = L.pts[k], b = L.pts[(k + 1) % 4];
    const f = rnd();
    const pos = a.clone().lerp(b, f);
    if (pos.distanceTo(center) < 25 && this.game.state === 'play') return null; // don't pop in under the player's nose
    let r = rnd(), type = TYPES[0];
    for (const t of TYPES) {
      if (r < t.w) { type = t; break; }
      r -= t.w;
    }
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const ped = {
      pos,
      vel: new THREE.Vector3(),
      yaw: 0,
      kind: type.kind,
      speed: lerp(type.speed[0], type.speed[1], rnd()),
      loop: L,
      k: (k + 1) % 4,
      dir: 1,
      target: b.clone(),
      state: 'walk',
      phase: rnd() * 6,
      timer: 0,
      fall: 0,
      spin: 0,
      shirt: type.kind === 'jogger' ? pick([0xff4757, 0x2ed573, 0x1e90ff, 0xffa502]) : pick(SHIRTS),
      pants: type.kind === 'jogger' ? 0x1e1e1e : pick(PANTS),
      skin: pick(SKIN),
      hair: type.kind === 'elderly' ? 0xcfcfcf : pick(HAIR),
      height: type.kind === 'elderly' ? 0.94 : 0.95 + rnd() * 0.1,
      look: 0,
      shoutCd: 0,
      crossing: null,
      dog: type.kind === 'dog' ? { pos: pos.clone().add(new THREE.Vector3(0.8, 0, 0)), yaw: 0, phase: 0 } : null,
      hurt: 0,
    };
    if (rnd() < 0.5) {
      // walk the loop the other way
      ped.dir = -1;
      ped.k = k;
      ped.target.copy(a);
    }
    this.list.push(ped);
    return ped;
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    const focus = g.player.focus;
    const inCity = Math.abs(focus.x) < 420 && Math.abs(focus.z) < 420;
    const target = inCity ? Math.round(this.max * (g.settings.pedestrians ?? 1) * this.densityFactor()) : 0;
    // despawn far away, spawn up to target
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d = p.pos.distanceTo(focus);
      if (d > 300 || (d > 230 && p.state !== 'down')) this.list.splice(i, 1);
    }
    let guard = 0;
    while (this.list.length < target && guard++ < 6) this.spawnNear(focus);
    for (const p of this.list) this.updatePed(p, dt);
    this.render();
  }

  densityFactor() {
    const h = this.game.env.hour ?? 12;
    const rain = this.game.env.rain || 0;
    // busy at lunch and evening, quiet late at night, fewer in the rain
    const day = h < 6 ? 0.15 : h < 8 ? 0.6 : h < 21 ? 1 : h < 23 ? 0.55 : 0.25;
    return day * (1 - rain * 0.5);
  }

  updatePed(p, dt) {
    const g = this.game;
    p.shoutCd -= dt;
    if (p.state === 'down') {
      // knocked over: tumble, then lie there, then get up
      p.vel.y -= 9.81 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const gy = this.groundY(p.pos);
      if (p.pos.y <= gy) {
        p.pos.y = gy;
        p.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
        p.vel.y = 0;
      }
      p.spin *= Math.max(0, 1 - dt * 2);
      p.yaw += p.spin * dt;
      p.fall = Math.min(1, p.fall + dt * 4);
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = 'getup';
        p.timer = 1.2;
      }
      return;
    }
    if (p.state === 'getup') {
      p.fall = Math.max(0, p.fall - dt * 1.2);
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = 'walk';
        this.shout(p, SHOUTS[Math.floor(Math.random() * SHOUTS.length)]);
        p.speed *= 1.6; // storms off
      }
      return;
    }
    if (p.state === 'dive') {
      p.vel.y -= 9.81 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const gy = this.groundY(p.pos);
      if (p.pos.y <= gy) {
        p.pos.y = gy;
        p.vel.set(0, 0, 0);
      }
      p.fall = Math.min(0.85, p.fall + dt * 5);
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = 'getup';
        p.timer = 1;
      }
      this.dodgeCars(p, dt);
      return;
    }
    // ---- walking / waiting / crossing ----
    let speed = p.speed;
    if (p.state === 'wait') {
      speed = 0;
      p.timer -= dt;
      if (this.walkSignal(p.crossing.node, p.crossing.axis) || p.timer < -40) {
        p.state = 'cross';
        p.target.copy(p.crossing.to.pts[p.crossing.k]);
      }
    }
    if (p.state === 'cross') speed = Math.max(p.speed, 1.3) * (p.hurry ? 2.2 : 1);
    if (p.state === 'flee') {
      speed = 3.6;
      p.timer -= dt;
      if (p.timer <= 0) p.state = 'walk';
    }
    const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3 && p.state !== 'wait') this.arrive(p);
    else if (speed > 0) {
      const want = Math.atan2(dx, dz);
      p.yaw += wrapAngle(want - p.yaw) * Math.min(1, dt * 8);
      const step = Math.min(d, speed * dt);
      p.pos.x += (dx / d) * step;
      p.pos.z += (dz / d) * step;
      p.phase += step * (p.kind === 'jogger' || speed > 2 ? 3.2 : 4.2);
    }
    p.pos.y = this.groundY(p.pos);
    if (p.fall > 0) p.fall = Math.max(0, p.fall - dt * 2);
    if (p.look > 0) p.look -= dt;
    if (p.dog) this.updateDog(p, dt);
    this.dodgeCars(p, dt);
  }

  arrive(p) {
    const L = p.loop;
    if (p.state === 'cross') {
      // now on the other block
      p.loop = p.crossing.to;
      p.k = p.crossing.k;
      p.crossing = null;
      p.hurry = false;
      p.state = 'walk';
      p.justCrossed = true;
    }
    const L2 = p.loop;
    // at corner p.k: maybe cross (not straight back again)
    const opts = L2.cross[p.k];
    const just = p.justCrossed;
    p.justCrossed = false;
    if (!just && opts && opts.length && Math.random() < 0.4 && p.state === 'walk') {
      const c = opts[Math.floor(Math.random() * opts.length)];
      p.crossing = c;
      p.state = 'wait';
      p.timer = 0;
      // wait at the curb edge facing the road
      return;
    }
    void L;
    p.k = (p.k + p.dir + 4) % 4;
    p.target.copy(L2.pts[p.k]);
  }

  updateDog(p, dt) {
    const dg = p.dog;
    // trots a little ahead and to the side of the owner
    _v.set(Math.sin(p.yaw) * 0.9 + Math.cos(p.yaw) * 0.5, 0, Math.cos(p.yaw) * 0.9 - Math.sin(p.yaw) * 0.5);
    const tx = p.pos.x + _v.x, tz = p.pos.z + _v.z;
    const dx = tx - dg.pos.x, dz = tz - dg.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const step = Math.min(d, (p.speed + d * 2) * dt);
      dg.pos.x += (dx / d) * step;
      dg.pos.z += (dz / d) * step;
      dg.yaw += wrapAngle(Math.atan2(dx, dz) - dg.yaw) * Math.min(1, dt * 10);
      dg.phase += step * 9;
    }
    dg.pos.y = p.pos.y;
  }

  groundY(pos) {
    return this.game.world.groundAt(pos.x, pos.z, pos.y + 0.4, _g).y;
  }

  /** Look for cars about to hit us; dive away or get knocked over. */
  dodgeCars(p, dt) {
    const g = this.game;
    for (const c of g.cars) {
      if (c.removed) continue;
      const cp = c.body.position;
      const dx = p.pos.x - cp.x, dz = p.pos.z - cp.z;
      if (dx * dx + dz * dz > 20 * 20) continue;
      // contact?
      c.body.toLocalPoint(_p.set(p.pos.x, p.pos.y + 0.9, p.pos.z), _l);
      const mn = c.boundsMin, mx = c.boundsMax;
      const pad = 0.28;
      if (_l.x > mn.x - pad && _l.x < mx.x + pad && _l.z > mn.z - pad && _l.z < mx.z + pad && _l.y > mn.y - 1 && _l.y < mx.y + 0.5) {
        c.body.pointVelocity(_p, _v);
        const rel = Math.hypot(_v.x - p.vel.x, _v.z - p.vel.z);
        if (rel > 1.8 && p.state !== 'down') this.knockDown(p, c, _v, rel);
        else if (p.state !== 'down') {
          // shoved: step out of the way
          const l = Math.hypot(dx, dz) || 1;
          p.pos.x += (dx / l) * 0.05;
          p.pos.z += (dz / l) * 0.05;
          if (p.shoutCd <= 0 && c.isPlayer) this.shout(p, 'Hey! Watch it!');
        }
        continue;
      }
      if (p.state === 'dive' || p.state === 'down' || p.state === 'getup') continue;
      // predicted near miss: dive
      const v = c.body.velocity;
      const sp = Math.hypot(v.x, v.z);
      if (sp < 4) continue;
      const alert = p.kind === 'texter' ? 0.35 : 0.75; // texters notice late
      const fx = cp.x + v.x * alert, fz = cp.z + v.z * alert;
      // closest approach along the segment car -> predicted
      const sx = fx - cp.x, sz = fz - cp.z;
      const t = clamp(((p.pos.x - cp.x) * sx + (p.pos.z - cp.z) * sz) / (sx * sx + sz * sz), 0, 1);
      const qx = cp.x + sx * t - p.pos.x, qz = cp.z + sz * t - p.pos.z;
      if (qx * qx + qz * qz < 2.0 * 2.0) {
        // jump perpendicular to the car's path, away from it
        const side = Math.sign(-qx * sz + qz * sx) || 1;
        const nx = (-sz / Math.hypot(sx, sz)) * side, nz = (sx / Math.hypot(sx, sz)) * side;
        const agile = p.kind === 'elderly' ? 1.8 : p.kind === 'jogger' ? 4.5 : 3.6;
        p.vel.set(-nx * agile, 1.6, -nz * agile);
        p.state = 'dive';
        p.timer = 0.9;
        p.yaw = Math.atan2(-nx, -nz);
        if (c.isPlayer) {
          this.shout(p, ['Whoa!', 'Are you crazy?!', 'AAAH!', 'Watch out!'][Math.floor(Math.random() * 4)]);
          g.activities?.onNearMissPed?.(p);
        }
      }
    }
  }

  knockDown(p, car, vel, rel) {
    const g = this.game;
    p.state = 'down';
    p.fall = 0.2;
    p.vel.set(vel.x * 0.75 + (Math.random() - 0.5) * 2, 1.5 + rel * 0.18, vel.z * 0.75 + (Math.random() - 0.5) * 2);
    p.spin = (Math.random() - 0.5) * rel;
    p.hurt = clamp(rel / 14, 0, 1);
    p.timer = 3 + rel * 0.4;
    p.crossing = null;
    if (p.hurt > 0.8) p.timer = 30; // stays down a long time (an ambulance may come)
    g.audio?.thump?.(p.pos, Math.min(1, rel / 12));
    if (rel > 4) car.registerImpact(_p.copy(p.pos).setY(p.pos.y + 0.7), _v.copy(vel).normalize().negate(), car.body.mass * Math.min(2.4, rel * 0.12), null, 0, 'ped');
    if (car.isPlayer) {
      this.hitCount++;
      g.stats.pedsHit = (g.stats.pedsHit || 0) + 1;
      g.police?.offense?.('pedestrian');
      g.onPedHit?.(p, rel);
      // bystanders scream and scatter
      for (const o of this.list) {
        if (o === p || o.state === 'down') continue;
        if (o.pos.distanceTo(p.pos) < 18) {
          o.state = 'flee';
          o.timer = 4;
          o.target.set(o.pos.x + (o.pos.x - p.pos.x) * 2, o.pos.y, o.pos.z + (o.pos.z - p.pos.z) * 2);
          if (Math.random() < 0.3) this.shout(o, 'Somebody call 911!');
        }
      }
    }
  }

  /** Player honked. */
  onHorn(car) {
    for (const p of this.list) {
      const d = p.pos.distanceTo(car.body.position);
      if (d > 28) continue;
      p.look = 2;
      if (p.state === 'cross') p.hurry = true;
      if (d < 15 && p.shoutCd <= 0 && Math.random() < 0.35) this.shout(p, ['Alright, alright!', 'Easy!', 'What?!', 'Rude.'][Math.floor(Math.random() * 4)]);
    }
  }

  shout(p, text) {
    p.shoutCd = 4;
    const g = this.game;
    if (!g.settings.showSpeech || p.pos.distanceTo(g.camera.position) > 60) return;
    g.hud?.say?.(p.pos, text, 'ped', 2.4);
    g.audio?.voice?.(text, p.pos, 'ped');
  }

  /** Pedestrians standing on the road near a position (for traffic AI). */
  onRoadNear(pos, r = 55) {
    const out = [];
    for (const p of this.list) {
      if (p.state !== 'cross' && p.state !== 'down' && p.state !== 'dive' && p.state !== 'getup' && p.state !== 'flee') continue;
      if (Math.abs(p.pos.x - pos.x) > r || Math.abs(p.pos.z - pos.z) > r) continue;
      out.push(p);
    }
    return out;
  }

  // ------------------------------------------------------------ render
  render() {
    const I = this.im;
    let n = 0, nd = 0;
    const cam = this.game.camera.position;
    for (const p of this.list) {
      if (p.pos.distanceToSquared(cam) > 160 * 160) continue;
      if (n >= 90) break;
      const h = p.height;
      // root: position, yaw, and fall (rotate about the feet, falling backwards)
      _e.set(-p.fall * Math.PI * 0.5, p.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.pos.x, p.pos.y, p.pos.z), _q, _s.set(h, h, h));
      const walk = p.state === 'walk' || p.state === 'cross' || p.state === 'flee' ? Math.sin(p.phase) : 0;
      const swing = walk * (p.kind === 'jogger' || p.state === 'flee' ? 0.75 : 0.45);
      const bob = Math.abs(Math.cos(p.phase)) * 0.03;
      const lean = p.kind === 'elderly' ? 0.18 : p.kind === 'texter' ? 0.1 : p.kind === 'jogger' ? 0.12 : 0;
      this.part(I.torso, n, _m, 0, 1.12 + bob, 0, lean, 0, p.shirt);
      const lookYaw = p.look > 0 ? 0.6 * Math.sin(p.look * 2) : 0;
      this.part(I.head, n, _m, 0, 1.55 + bob, lean * 0.6, 0, lookYaw, p.skin);
      this.part(I.hair, n, _m, 0, 1.58 + bob, lean * 0.6 - 0.01, 0, lookYaw, p.hair);
      this.part(I.legL, n, _m, 0.1, 0.84 + bob, 0, swing, 0, p.pants);
      this.part(I.legR, n, _m, -0.1, 0.84 + bob, 0, -swing, 0, p.pants);
      const texting = p.kind === 'texter' && p.state === 'walk';
      this.part(I.armL, n, _m, 0.26, 1.38 + bob, lean * 0.5, texting ? -1.1 : -swing * 0.9, 0, p.shirt);
      this.part(I.armR, n, _m, -0.26, 1.38 + bob, lean * 0.5, p.state === 'down' ? 1.4 : -1 * -swing * 0.9, 0, p.shirt);
      n++;
      if (p.dog && nd < 30) {
        const dg = p.dog;
        _q.setFromAxisAngle(_v.set(0, 1, 0), dg.yaw);
        _m2.compose(_p.set(dg.pos.x, dg.pos.y + 0.36 + Math.abs(Math.sin(dg.phase)) * 0.03, dg.pos.z), _q, _s.set(1, 1, 1));
        I.dog.setMatrixAt(nd, _m2);
        I.dog.setColorAt(nd, _c.setHex(p.hair === 0x0f0f0f ? 0x8a6a3a : 0x3a2a1a));
        _m.makeTranslation(0, 0.12, 0.38);
        I.dogHead.setMatrixAt(nd, _m.premultiply(_m2));
        I.dogHead.setColorAt(nd, _c.setHex(0x2a1d12));
        nd++;
      }
    }
    for (const k of ['torso', 'head', 'hair', 'legL', 'legR', 'armL', 'armR']) {
      I[k].count = n;
      I[k].instanceMatrix.needsUpdate = true;
      if (I[k].instanceColor) I[k].instanceColor.needsUpdate = true;
    }
    I.dog.count = I.dogHead.count = nd;
    I.dog.instanceMatrix.needsUpdate = I.dogHead.instanceMatrix.needsUpdate = true;
    if (I.dog.instanceColor) I.dog.instanceColor.needsUpdate = true;
    if (I.dogHead.instanceColor) I.dogHead.instanceColor.needsUpdate = true;
  }

  part(im, i, root, x, y, z, rx, ry, color) {
    _e.set(rx, ry, 0, 'YXZ');
    _q.setFromEuler(_e);
    _m2.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    _m2.premultiply(root);
    im.setMatrixAt(i, _m2);
    im.setColorAt(i, _c.setHex(color));
  }

  clear() {
    this.list.length = 0;
    this.render();
  }
}

const _g = { y: 0, nx: 0, ny: 1, nz: 0, mat: null };
void roadCoord;
void RW;
