import * as THREE from 'three';
import { clamp, mulberry32, KMH } from '../core/util.js';
import { roadCoord, CITY } from '../world/city.js';
import { fmtMoney } from '../career/economy.js';
import { PathDriver, smoothPath } from '../ai/racer.js';

const _v = new THREE.Vector3();
const _l = new THREE.Vector3();
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);

/**
 * Things that happen while just driving around: drift and near-miss combos,
 * airtime, stunt jumps, speed traps and speed cameras, hubcaps, photo spots,
 * red-light street races, and the recap after a police chase.
 */
export class FreeRoam {
  constructor(game) {
    this.game = game;
    this.drift = null;
    this.driftTotal = 0;
    this.near = { combo: 0, t: 0, cd: new Map() };
    this.air = { t: 0, from: null, jump: null };
    this.el = document.createElement('div');
    this.el.id = 'combo';
    document.getElementById('hud').appendChild(this.el);
    this.flashEl = document.createElement('div');
    this.flashEl.id = 'cam-flash';
    document.getElementById('app').appendChild(this.flashEl);
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.buildJumps();
    this.buildTraps();
    this.buildCameras();
    this.buildHubcaps();
    this.buildPhotoSpots();
    this.pursuit = null;
    this.street = null;
  }

  get career() {
    return this.game.career;
  }

  // ------------------------------------------------------------ setup
  buildJumps() {
    const g = this.game;
    const W = g.world;
    const city = g.city;
    // two new ramps: along the quay road between the cranes, and a dune kicker on the beach
    city.ramp(-28, 500, Math.PI / 2, 7, 12, 0, 1.6, 'metal');
    const T = g.terrain;
    const bx = 650, bz = T.findShore(650) - 36, by = T.rawHeight(bx, bz);
    city.ramp(bx, bz, 0, 8, 14, by, by + 2.2, 'dirt');
    const names = ['Rookie Ramp', 'Double Trouble', 'Metal Mountain', 'The Big One', 'Kicker', 'Site Jump', 'Harbor Leap', 'Dune Launcher', 'Back Lot Hop', 'Tabletop'];
    this.jumps = W.ramps.filter((r) => r.h1 >= 1.5 && r.h1 > r.h0).slice(0, 8).map((r, i) => ({
      id: `J${i + 1}`,
      name: names[i] || `Jump ${i + 1}`,
      r,
      lip: V(r.cx + r.dx * r.hl, r.cz + r.dz * r.hl, r.h1),
      dir: V(r.dx, r.dz),
      target: 15 + r.h1 * 6,
    }));
    // little flags at each lip
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xffd60a });
    for (const j of this.jumps) {
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), flagMat);
        f.position.set(j.lip.x + -j.dir.z * s * (j.r.hw + 0.6), j.lip.y + 1.2, j.lip.z + j.dir.x * s * (j.r.hw + 0.6));
        this.group.add(f);
      }
    }
  }

  buildTraps() {
    const g = this.game;
    const T = g.terrain;
    const coast = T.roads.find((r) => r.id === 'coast');
    const canyon = T.roads.find((r) => r.id === 'canyon');
    const trail = T.roads.find((r) => r.id === 'trail');
    const at = (r, i) => ({ x: r.pts[i].x, z: r.pts[i].z, y: r.pts[i].y });
    this.traps = [
      { id: 'T1', name: 'Harbor Ave', x: roadCoord(0), z: 0 },
      { id: 'T2', name: '7th St', x: 0, z: roadCoord(6) },
      { id: 'T3', name: 'Drag Strip', x: g.city.dragStrip.x, z: g.city.dragStrip.quarter },
      { id: 'T4', name: 'Coast Hwy East', ...at(coast, Math.floor(coast.pts.length * 0.42)) },
      { id: 'T5', name: 'Beach Boulevard', ...at(coast, Math.floor(coast.pts.length * 0.18)) },
      { id: 'T6', name: 'Canyon Straight', ...at(canyon, 90) },
      { id: 'T7', name: 'Quay Road', x: -100, z: 497 },
      { id: 'T8', name: 'Forest Trail', ...at(trail, Math.floor(trail.pts.length * 0.5)) },
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
    const lens = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    for (const t of this.traps) {
      const gy = g.world.groundAt(t.x, t.z, (t.y || 0) + 30, { y: 0 }).y;
      t.y = gy;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), mat);
      pole.position.set(t.x + 8, gy + 2, t.z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.7), mat);
      box.position.set(t.x + 8, gy + 4.1, t.z);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.1, 10), lens);
      l.position.set(t.x + 7.74, gy + 4.1, t.z);
      l.rotation.y = -Math.PI / 2;
      this.group.add(pole, box, l);
      t.cd = 0;
    }
  }

  buildCameras() {
    const g = this.game;
    // fixed enforcement cameras on city streets: limit + 15 km/h earns a ticket in the post
    this.cameras = [
      { x: roadCoord(3) + 7, z: roadCoord(1) + 40, limit: 50 },
      { x: roadCoord(1) - 40, z: roadCoord(3) - 7, limit: 50 },
      { x: roadCoord(5) + 7, z: roadCoord(4) - 40, limit: 50 },
      { x: roadCoord(6) + 7, z: roadCoord(2) + 30, limit: 60 },
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.4 });
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 });
    for (const c of this.cameras) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.5, 6), mat);
      pole.position.set(c.x, CITY.CURB + 2.25, c.z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.9), yel);
      box.position.set(c.x, CITY.CURB + 4.6, c.z);
      const flash = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 }));
      flash.position.set(c.x, CITY.CURB + 4.3, c.z + 0.46);
      this.group.add(pole, box, flash);
      g.world.addCylinder(c.x, c.z, 0.15, 0, 4.5, { kind: 'pole' });
      c.flash = flash;
      c.cd = 0;
    }
  }

  buildHubcaps() {
    const g = this.game;
    const rnd = mulberry32(77);
    this.hubcaps = [];
    const T = g.terrain;
    const spots = [];
    // a mix: city alleys and corners, the port, the beach, the hills, the canyon, the trail
    for (let k = 0; k < 9; k++) {
      const b = g.city.blocks[Math.floor(rnd() * g.city.blocks.length)];
      spots.push(V(b.x0 + 3 + rnd() * (b.x1 - b.x0 - 6), b.z0 + 2));
    }
    spots.push(V(-300, 480), V(20, 470), V(100, 360), V(-200, 505));
    for (const r of T.roads) for (let k = 0; k < 3; k++) {
      const i = Math.floor((0.15 + rnd() * 0.7) * r.pts.length);
      const p = r.pts[i], rt = r.right[i];
      const s = rnd() < 0.5 ? -1 : 1;
      spots.push(V(p.x + rt.x * s * (r.hw + 2.5), p.z + rt.z * s * (r.hw + 2.5)));
    }
    spots.push(V(T.lookout.pos.x, T.lookout.pos.z), V(500, T.findShore(500) - 15), V(g.coast.pier.x, g.coast.pier.z1 - 4, g.coast.pier.top));
    const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.05, 16);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe0e4e8, metalness: 1, roughness: 0.15, emissive: 0x332a10, emissiveIntensity: 0.4 });
    spots.slice(0, 25).forEach((p, i) => {
      const gy = p.y || g.world.groundAt(p.x, p.z, 300, { y: 0 }).y;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, gy + 0.7, p.z);
      this.group.add(m);
      this.hubcaps.push({ id: `H${i + 1}`, pos: m.position.clone(), mesh: m });
    });
    this.syncHubcaps();
  }

  syncHubcaps() {
    const got = new Set(this.career ? this.career.p.collected : this.freeCollected || []);
    for (const h of this.hubcaps) h.mesh.visible = !got.has(h.id);
  }

  buildPhotoSpots() {
    const g = this.game;
    const L = g.city.locations;
    const T = g.terrain;
    this.photos = [
      { id: 'P1', name: 'City from Demo Peak', at: T.lookout.pos.clone(), look: V(0, 0, 0) },
      { id: 'P2', name: 'The lighthouse', at: g.coast.lighthouse.pos.clone().add(V(40, 0, -40)), look: g.coast.lighthouse.pos.clone() },
      { id: 'P3', name: 'End of the pier', at: V(g.coast.pier.x, g.coast.pier.z1 - 6, g.coast.pier.top), look: V(g.coast.pier.x, g.coast.pier.z1 + 200) },
      { id: 'P4', name: 'Cranes at dusk', at: V(-150, 470), look: V(-150, 500, 30) },
      { id: 'P5', name: 'Downtown towers', at: V(0, 0), look: V(0, -100, 60) },
      { id: 'P6', name: 'Proving Grounds', at: L.proving.pos.clone(), look: V(560, 0) },
    ];
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    if (g.state !== 'play') return;
    const car = g.player.car;
    const inCar = g.player.mode === 'car' && car;
    if (inCar) {
      if (g.settings.freeScoring !== false || this.forceDrift) this.updateDrift(car, dt);
      this.updateNear(car, dt);
      this.updateAir(car, dt);
      this.updateTraps(car, dt);
      this.updateCameras(car, dt);
      this.updateStreetRace(car, dt);
    }
    this.updateHubcaps(dt);
    this.updatePhoto(dt);
    this.updatePursuit(dt);
    this.drawCombo();
  }

  updateDrift(car, dt) {
    const ph = car.phys;
    car.body.toLocalDir(car.body.velocity, _l);
    const beta = Math.atan2(_l.x, Math.max(_l.z, 0.1));
    const v = car.speed;
    const drifting = ph.grounded >= 3 && v > 8 && Math.abs(beta) > 0.26 && Math.abs(beta) < 1.6 && car.forwardSpeed > 4;
    if (drifting) {
      if (!this.drift) this.drift = { score: 0, mult: 1, idle: 0, chain: 0 };
      const d = this.drift;
      if (d.idle > 0.2) {
        // a new drift chained onto the last one
        d.mult = Math.min(5, d.mult + 0.5);
        d.chain++;
      }
      d.idle = 0;
      d.score += dt * v * Math.abs(beta) * 57.3 * 0.5;
      d.angle = Math.abs(beta) * 57.3;
    } else if (this.drift) {
      this.drift.idle += dt;
      if (this.drift.idle > 2.5) this.bankDrift();
    }
    // hitting anything kills the combo
    if (this.drift && car.lastImpact > 2) {
      this.drift = null;
      this.comboMsg = { text: 'COMBO LOST', t: 1.2, bad: true };
    }
  }

  bankDrift() {
    const d = this.drift;
    if (!d) return;
    this.drift = null;
    const pts = Math.round(d.score * d.mult);
    if (pts < 200) return;
    this.driftTotal += pts;
    this.comboMsg = { text: `DRIFT +${pts.toLocaleString()}`, t: 1.6 };
    const ca = this.career;
    if (ca) {
      ca.p.stats.bestDrift = Math.max(ca.p.stats.bestDrift, pts);
      if (!this.game.activities?.current) ca.earn(Math.round(pts / 150), 'Drift combo', pts / 120);
    }
  }

  updateNear(car, dt) {
    const g = this.game;
    const n = this.near;
    n.t = Math.max(0, n.t - dt);
    if (n.t <= 0 && n.combo) {
      if (this.career && n.combo > 0 && !g.activities?.current) this.career.earn(25 * n.combo * n.combo, `${n.combo}x near miss`, 15 * n.combo);
      n.combo = 0;
    }
    if (car.speed < 12) return;
    for (const c of g.cars) {
      if (c === car || c.removed || c.parked) continue;
      const cp = c.body.position;
      if (Math.abs(cp.x - car.body.position.x) > 9 || Math.abs(cp.z - car.body.position.z) > 9) continue;
      car.body.toLocalPoint(cp, _l);
      const rel = _v.copy(car.body.velocity).sub(c.body.velocity).length();
      const lat = Math.abs(_l.x) - (car.boundsMax.x + c.boundsMax.x);
      if (Math.abs(_l.z) < 2.2 && lat > 0.05 && lat < 1.1 && rel > 12) {
        const last = n.cd.get(c.id) || 0;
        if (performance.now() - last < 3000) continue;
        n.cd.set(c.id, performance.now());
        n.combo++;
        n.t = 3;
        this.comboMsg = { text: `NEAR MISS ×${n.combo}`, t: 1.2 };
        if (this.career) this.career.p.stats.nearMisses++;
        g.audio?.whoosh?.(c);
      }
    }
  }

  updateAir(car, dt) {
    const g = this.game;
    const a = this.air;
    const ph = car.phys;
    if (ph.grounded === 0 && !(car.submerged > 0)) {
      if (a.t === 0) {
        a.from = car.body.position.clone();
        // took off from a stunt jump lip?
        a.jump = null;
        for (const j of this.jumps) {
          const d = Math.hypot(a.from.x - j.lip.x, a.from.z - j.lip.z);
          const v = car.body.velocity;
          const along = (v.x * j.dir.x + v.z * j.dir.z) / Math.max(1, Math.hypot(v.x, v.z));
          if (d < 8 && along > 0.7 && car.speed > 12) {
            a.jump = j;
            if (g.settings.slowmo) g.startSlowmo?.(1.2);
            g.hud.big(j.name.toUpperCase(), 'Stunt jump!', 1.2);
          }
        }
      }
      a.t += dt;
    } else if (a.t > 0) {
      // touched down: judge the landing over the next 0.6 s (impacts arrive a frame or two later)
      const dist = a.from ? Math.hypot(car.body.position.x - a.from.x, car.body.position.z - a.from.z) : 0;
      a.landing = { t: 0.6, dist, airT: a.t, jump: a.jump, maxImp: car.lastImpact, splash: (car.submerged || 0) > 0 };
      a.t = 0;
      a.jump = null;
    }
    const L = a.landing;
    if (L) {
      L.t -= dt;
      L.maxImp = Math.max(L.maxImp, car.lastImpact);
      if ((car.submerged || 0) > 0) L.splash = true;
      if (L.t <= 0) {
        a.landing = null;
        const clean = !car.wrecked && (L.splash || (L.maxImp < 20 && car.body.R[4] > 0.5));
        if (L.airT > 0.9 && clean) {
          const pts = Math.round(L.airT * L.airT * 300 + L.dist * 10);
          this.comboMsg = { text: `${L.splash ? 'SPLASH! ' : ''}AIR ${L.airT.toFixed(1)} s · ${L.dist.toFixed(1)} m`, t: 1.6 };
          const ca = this.career;
          if (ca) {
            ca.p.stats.airTime = Math.max(ca.p.stats.airTime, L.airT);
            ca.p.stats.bestJump = Math.max(ca.p.stats.bestJump, L.dist);
            if (!g.activities?.current) ca.earn(Math.round(pts / 40), 'Airtime', pts / 30);
          }
        }
        if (L.jump) this.landJump(L.jump, L.dist, clean);
      }
    }
  }

  landJump(j, dist, clean) {
    const g = this.game;
    const ca = this.career;
    const store = ca ? ca.p.jumps : (this.freeJumps ||= {});
    const best = store[j.id] || 0;
    if (!clean) {
      g.hud.big(`${dist.toFixed(1)} m`, 'Crashed the landing — doesn\'t count', 2.2);
      return;
    }
    const pass = dist >= j.target;
    if (dist > best) store[j.id] = dist;
    g.hud.big(`${dist.toFixed(1)} m`, `${j.name} · ${pass ? 'cleared!' : `target ${j.target.toFixed(0)} m`}${dist > best ? ' · NEW RECORD' : ` · best ${best.toFixed(1)} m`}`, 2.6);
    if (ca && pass && best < j.target) ca.earn(400, `Stunt jump: ${j.name}`, 150);
    else if (ca && dist > best) ca.earn(Math.round((dist - best) * 10), `Jump record: ${j.name}`, 40);
  }

  updateTraps(car, dt) {
    const g = this.game;
    const p = car.body.position;
    for (const t of this.traps) {
      t.cd -= dt;
      if (t.cd > 0) continue;
      if (Math.hypot(p.x - t.x, p.z - t.z) < 9 && Math.abs(p.y - t.y) < 4) {
        t.cd = 4;
        const kmh = car.speed * KMH;
        if (kmh < 40) continue;
        const ca = this.career;
        const store = ca ? ca.p.traps : (this.freeTraps ||= {});
        const best = store[t.id] || 0;
        g.hud.big(`${Math.round(g.settings.units === 'mph' ? kmh / 1.609 : kmh)} ${g.settings.units === 'mph' ? 'mph' : 'km/h'}`, `Speed trap · ${t.name}${kmh > best ? ' · NEW RECORD' : ` · best ${Math.round(best)}`}`, 2);
        g.audio?.beep?.(1400);
        if (kmh > best) {
          store[t.id] = kmh;
          if (ca) ca.earn(Math.round(Math.max(0, kmh - best) * 4), `Speed trap: ${t.name}`, 30);
        }
      }
    }
  }

  updateCameras(car, dt) {
    const g = this.game;
    const p = car.body.position;
    for (const c of this.cameras) {
      c.cd -= dt;
      c.flash.material.emissiveIntensity = Math.max(0, c.flash.material.emissiveIntensity - dt * 20);
      if (c.cd > 0) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) < 14) {
        const kmh = car.speed * KMH;
        if (kmh > c.limit + 15) {
          c.cd = 6;
          c.flash.material.emissiveIntensity = 12;
          this.flashEl.classList.remove('on');
          void this.flashEl.offsetWidth;
          this.flashEl.classList.add('on');
          g.audio?.shutter?.();
          const fine = Math.round(80 + (kmh - c.limit) * 4);
          if (this.career && !g.activities?.current?.def.closed) {
            g.police.pendingFine = (g.police.pendingFine || 0) + fine;
            g.toast(`📸 Speed camera: ${Math.round(kmh)} in a ${c.limit} zone. Fine ${fmtMoney(fine)} (pay on your phone)`, 'warn', 4);
            this.career.message('SD Traffic Enforcement', `Your vehicle (${car.cfg.plate}) was recorded at ${Math.round(kmh)} km/h in a ${c.limit} km/h zone. Fine: ${fmtMoney(fine)}. Pay within one day to avoid the late fee.`);
          } else g.toast(`📸 Flash! ${Math.round(kmh)} km/h in a ${c.limit} zone`, 'warn', 2.5);
        }
      }
    }
  }

  updateHubcaps(dt) {
    const g = this.game;
    const p = g.player.mode === 'car' && g.player.car ? g.player.car.body.position : g.onFoot?.position;
    if (!p) return;
    const t = performance.now() / 1000;
    for (const h of this.hubcaps) {
      if (!h.mesh.visible) continue;
      h.mesh.rotation.y = t * 2.5;
      h.mesh.position.y = h.pos.y + Math.sin(t * 2 + h.pos.x) * 0.12;
      if (p.distanceToSquared(h.pos) < 3.2 * 3.2) {
        h.mesh.visible = false;
        const ca = this.career;
        const list = ca ? ca.p.collected : (this.freeCollected ||= []);
        if (!list.includes(h.id)) list.push(h.id);
        g.hud.big('HUBCAP', `${list.length}/25 found`, 1.8);
        g.audio?.chime?.('pickup');
        if (ca) ca.earn(150, 'Hubcap', 40);
      }
    }
  }

  updatePhoto(dt) {
    const g = this.game;
    if (g.cam.mode !== 'free') return;
    const cam = g.camera;
    const f = cam.getWorldDirection(_v);
    let spot = null;
    for (const s of this.photos) {
      if (cam.position.distanceTo(s.at) > 45) continue;
      const to = s.look.clone().sub(cam.position).normalize();
      if (to.dot(f) > 0.85) spot = s;
    }
    this.photoSpot = spot;
  }

  /** Photo mode "snap": rewards scenic spots. */
  snap() {
    const s = this.photoSpot;
    const g = this.game;
    if (!s) return false;
    const ca = this.career;
    const done = ca ? ca.p.photos : (this.freePhotos ||= {});
    if (!done[s.id]) {
      done[s.id] = 1;
      g.toast(`📷 Photo challenge: ${s.name}!`, 'good', 3);
      if (ca) ca.earn(300, `Photo: ${s.name}`, 120);
    }
    return true;
  }

  // ------------------------------------------------------------ street races at red lights
  updateStreetRace(car, dt) {
    const g = this.game;
    const sr = this.street;
    if (sr && sr.state === 'race') return this.runStreetRace(car, dt);
    if (g.activities?.current) return;
    if (sr && sr.state === 'offer') {
      sr.t -= dt;
      g.activityPrompt = `🏎️ ${sr.name} is revving at you — <kbd>Y</kbd> flash to accept a race to ${sr.destName}`;
      if (g.input.pressed('flash')) this.startStreetRace(car);
      else if (sr.t <= 0 || sr.npc.removed) this.street = null;
      return;
    }
    // stopped at a red light next to another car? sometimes they want to race
    this.offerCd = (this.offerCd || 25) - dt;
    if (this.offerCd > 0 || car.speed > 0.5) return;
    const nl = g.city.nearestLane(car.body.position, car.body.axis(2, _v));
    if (!nl || nl.seg.stopDist - nl.dist > 14 || g.city.signalFor(nl.seg) !== 'red') return;
    const npc = g.cars.find((c) => c !== car && !c.removed && c.controller && c.controller.lane !== undefined && c.speed < 0.5 && c.body.position.distanceTo(car.body.position) < 6);
    if (!npc) return;
    this.offerCd = 60;
    if (Math.random() > 0.55) return;
    // finish line: three blocks straight ahead
    let seg = nl.seg;
    for (let k = 0; k < 3; k++) {
      const next = seg.to.out.find((s) => s.dir.dot(seg.dir) > 0.9);
      if (!next) break;
      seg = next;
    }
    const fin = V(seg.end.x + seg.right.x * 3.5, seg.end.z + seg.right.z * 3.5);
    this.street = { state: 'offer', t: 7, npc, fin, destName: seg.name, name: ['A boy-racer', 'A guy in a backwards cap', 'A bored teenager', 'Someone with a loud exhaust'][Math.floor(Math.random() * 4)], seg0: nl.seg };
    g.audio?.revAt?.(npc);
    npc.lightsFlash = 0.4;
  }

  startStreetRace(car) {
    const g = this.game;
    const sr = this.street;
    const npc = sr.npc;
    // take the NPC out of traffic and put it on a racing line to the finish
    const i = g.traffic?.drivers.indexOf(npc.controller);
    if (i >= 0) g.traffic.drivers.splice(i, 1);
    const path = smoothPath([npc.body.position.clone(), sr.fin, sr.fin.clone().addScaledVector(sr.seg0.dir, 40)], 2);
    const d = new PathDriver(g, npc, path, { skill: 0.9 + Math.random() * 0.08 });
    d.frozen = true;
    sr.driver = d;
    sr.state = 'race';
    sr.count = 3;
    sr.t = 0;
    g.hud.big('STREET RACE', `First to ${sr.destName}. Wait for green!`, 2);
  }

  runStreetRace(car, dt) {
    const g = this.game;
    const sr = this.street;
    const d = sr.driver;
    const sig = g.city.signalFor(sr.seg0);
    if (d.frozen && sig === 'green') d.frozen = false;
    d.update(dt);
    sr.t += dt;
    g.hud.navArrow(sr.fin, 'Finish');
    const me = car.body.position.distanceTo(sr.fin), them = sr.npc.body.position.distanceTo(sr.fin);
    g.hud.objective({ title: 'STREET RACE', text: me < them ? 'You\'re ahead!' : 'Catch them!', big: `${Math.round(me)} m` });
    if (me < 10 || them < 10 || sr.t > 60) {
      const won = me < 10 && them >= 10;
      g.hud.big(won ? 'YOU WIN' : 'YOU LOSE', won ? 'Street cred +1' : 'Better luck next time', 2.5);
      if (won && this.career) this.career.earn(350, 'Street race', 120);
      g.hud.objective(null);
      g.hud.navArrow(null);
      // the NPC rejoins traffic after cooling off
      sr.npc.controller = null;
      g.traffic?.adopt?.(sr.npc);
      this.street = null;
    }
  }

  // ------------------------------------------------------------ pursuit recap
  updatePursuit(dt) {
    const g = this.game;
    const pol = g.police;
    if (!pol) return;
    if (pol.heat > 0) {
      if (!this.pursuit) this.pursuit = { t: 0, top: 0, maxStars: 0, copsWrecked: 0, start: g.player.focus.clone(), dist: 0 };
      const p = this.pursuit;
      p.t += dt;
      const car = g.player.car;
      if (car && g.player.mode === 'car') {
        p.top = Math.max(p.top, car.speed);
        p.dist += car.speed * dt;
      }
      p.maxStars = Math.max(p.maxStars, Math.floor(pol.heat));
      p.copsWrecked = pol.cops.filter((c) => c.car.wrecked).length;
    }
  }

  pursuitEnd(how, stars) {
    const p = this.pursuit;
    this.pursuit = null;
    if (!p || p.t < 8) return;
    const g = this.game;
    const units = g.settings.units === 'mph';
    g.hud.notify(how === 'escaped' ? '🚨 Pursuit recap — ESCAPED' : '🚨 Pursuit recap — BUSTED',
      `${Math.floor(p.t / 60)}:${String(Math.floor(p.t % 60)).padStart(2, '0')} · ${p.maxStars}★ max · top ${Math.round(p.top * (units ? 2.237 : 3.6))} ${units ? 'mph' : 'km/h'} · ${(p.dist / 1000).toFixed(1)} km · ${p.copsWrecked} cruisers wrecked`, how === 'escaped' ? 'ach' : '', 8);
    void stars;
  }

  // ------------------------------------------------------------ HUD
  drawCombo() {
    const lines = [];
    if (this.drift && this.drift.score > 50) lines.push(`<div class="c drift"><b>${Math.round(this.drift.score).toLocaleString()}</b> ×${this.drift.mult.toFixed(1)}<span>DRIFT ${Math.round(this.drift.angle || 0)}°</span></div>`);
    if (this.near.combo > 0) lines.push(`<div class="c near">NEAR MISS ×${this.near.combo}<i style="width:${(this.near.t / 3) * 100}%"></i></div>`);
    if (this.comboMsg) {
      this.comboMsg.t -= 1 / 60;
      if (this.comboMsg.t <= 0) this.comboMsg = null;
      else lines.push(`<div class="c msg ${this.comboMsg.bad ? 'bad' : ''}">${this.comboMsg.text}</div>`);
    }
    const html = lines.join('');
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
