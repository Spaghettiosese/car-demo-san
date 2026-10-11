import * as THREE from 'three';
import { Car } from '../vehicle/car.js';
import { configForBody, DEFAULT_CONFIG } from '../vehicle/specs.js';
import { clamp, lerp, smoothstep, wrapAngle } from '../core/util.js';
import { CITY } from '../world/city.js';
import { nearestNode, nodePath, segmentBetween } from './gps.js';

const LANE = CITY.LANE;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export const INSULTS = [
  'LEARN TO DRIVE!', 'ARE YOU BLIND?!', 'WHO GAVE YOU A LICENSE?!', 'GET OFF THE ROAD!', 'UNBELIEVABLE!',
  "I'M CALLING MY LAWYER!", 'MOVE IT!', 'NICE DRIVING, GENIUS!', 'YOU SCRATCHED MY CAR!', 'SERIOUSLY?!', 'GREEN MEANS GO!',
];
const SHAKEN = ['Are you insane?!', 'My neck...', "I'm calling the cops!", 'Oh come ON.', 'Did you see that?!'];
const HONK_LINES = ['Come on!', "It's green!", 'Hello?!', 'Move!', 'Any day now...'];
const NPC_COLORS = ['#e8e8ea', '#e8e8ea', '#f4f4f2', '#101114', '#101114', '#1a1c20', '#6b6f76', '#9aa0a8', '#6b6f76', '#b01e23', '#1f4fa8', '#27313d', '#2b7a3c', '#c8a26b', '#3b2a1e', '#d9d4c7', '#7a1a1a', '#0fa3b1', '#5c6e8a', '#f2b90c'];

function npcConfig(rnd) {
  const r = rnd();
  const body = r < 0.36 ? 'sedan' : r < 0.55 ? 'hatch' : r < 0.7 ? 'suv' : r < 0.78 ? 'pickup' : r < 0.86 ? 'van' : r < 0.93 ? 'coupe' : 'muscle';
  const cfg = configForBody(body, DEFAULT_CONFIG);
  cfg.paint = NPC_COLORS[Math.floor(rnd() * NPC_COLORS.length)];
  cfg.finish = rnd() < 0.5 ? 'metallic' : 'gloss';
  cfg.wheelStyle = ['fivespoke', 'steel', 'mesh', 'split'][Math.floor(rnd() * 4)];
  cfg.wheelColor = rnd() < 0.6 ? '#b9bdc4' : '#2a2b2e';
  cfg.wheelSize = 16 + Math.floor(rnd() * 3);
  cfg.tire = body === 'suv' || body === 'pickup' ? 'offroad' : 'street';
  cfg.livery = 'none';
  cfg.spoiler = 'none';
  cfg.tint = 0.6;
  cfg.exhaust = 'stock';
  cfg.plate = randomPlate(rnd);
  cfg.abs = true;
  cfg.tcs = true;
  return cfg;
}

export function randomPlate(rnd = Math.random) {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return `${L[Math.floor(rnd() * 23)]}${L[Math.floor(rnd() * 23)]}${L[Math.floor(rnd() * 23)]} ${Math.floor(rnd() * 900 + 100)}`;
}

const L_PLATE_GEO = new THREE.PlaneGeometry(0.28, 0.28);
let _lMat = null;
function lPlateMat() {
  if (_lMat) return _lMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#d0021b';
  x.font = 'bold 54px Arial';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('L', 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _lMat = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.6 });
  return _lMat;
}
const ARGUE = ['You hit MY car!', 'Are you serious?!', 'Insurance details. NOW.', 'Watch where you\'re going!', 'This is a new car!', 'Unbelievable.'];
const CONFRONT = ['GET OUT OF THE CAR!', 'You think that was funny?!', 'Yeah, you! Roll the window down!', 'I\'ve got your plate number!', 'Say that to my face!'];

/** Pick a driving style for a new NPC (drunks only appear late at night). */
export function pickPersona(game, rnd = Math.random) {
  const night = game.env.night > 0.6;
  const r = rnd();
  if (night && r < 0.06) return 'drunk';
  if (r < 0.13) return 'learner';
  if (r < 0.21) return 'elderly';
  if (r < 0.3) return 'racer';
  return 'normal';
}

// ================================================================== driver
export class Driver {
  constructor(car, mgr, opts = {}) {
    this.car = car;
    this.mgr = mgr;
    this.game = mgr.game;
    this.city = mgr.game.city;
    car.controller = this;
    this.pts = [];
    this.i0 = 0;
    this.sCar = 0;
    const r = Math.random;
    this.speedFactor = opts.speedFactor ?? 0.85 + r() * 0.28;
    this.aggression = opts.aggression ?? r();
    this.patience = 2 + (1 - this.aggression) * 5;
    this.headway = 1.0 + (1 - this.aggression) * 0.6;
    this.state = 'drive';
    this.anger = 0;
    this.honkCd = 0;
    this.blocked = 0;
    this.stuck = 0;
    this.reverseT = 0;
    this.rageT = 0;
    this.shakenT = 0;
    this.speechCd = 0;
    this.steerCmd = 0;
    this.kinV = 0;
    this.wantLane = 0;
    this.leader = null;
    this.leaderGap = 999;
    this.plan = new Map(); // seg.id -> { next, turn, lane }
    this.laneChange = null;
    this.overtake = 0;
    this.hornType = null;
    this.persona = 'normal';
    this.accelMul = 1;
    this.weave = 0;
    this.yieldT = 0;
    this.yieldShift = 0;
    this.stopPass = null;
    this.dpCd = 60 + r() * 120;
    this.argueCd = 0;
    this.rageMode = 'tail';
    this.rageModeT = 6;
  }

  /** Driving style: normal, learner, elderly, racer (boy-racer) or drunk (only at night). */
  setPersona(kind) {
    const r = Math.random;
    this.persona = kind;
    this.accelMul = 1;
    this.weave = 0;
    if (kind === 'learner') Object.assign(this, { speedFactor: 0.68 + r() * 0.08, aggression: 0, headway: 2.2, patience: 9, accelMul: 0.6 });
    else if (kind === 'elderly') Object.assign(this, { speedFactor: 0.7 + r() * 0.08, aggression: 0.1, headway: 1.9, patience: 10, accelMul: 0.55 });
    else if (kind === 'racer') Object.assign(this, { speedFactor: 1.2 + r() * 0.12, aggression: 0.85 + r() * 0.15, headway: 0.55, patience: 1.2, accelMul: 1.6 });
    else if (kind === 'drunk') Object.assign(this, { speedFactor: 0.85 + r() * 0.4, aggression: 0.6, headway: 0.9, patience: 2, accelMul: 1.2, weave: 0.8 + r() * 0.8 });
    else {
      this.speedFactor = 0.85 + r() * 0.28;
      this.aggression = r();
      this.patience = 2 + (1 - this.aggression) * 5;
      this.headway = 1.0 + (1 - this.aggression) * 0.6;
    }
    // learners wear an L plate on the roof
    const car = this.car;
    if (kind === 'learner' && !car.lPlate) {
      const m = new THREE.Mesh(L_PLATE_GEO, lPlateMat());
      m.position.set(0, car.boundsMax.y + 0.16, 0);
      car.root.add(m);
      car.lPlate = m;
    }
    if (car.lPlate) car.lPlate.visible = kind === 'learner';
    if (kind === 'racer') this.hornType = 'high';
  }

  // ------------------------------------------------------------ path building
  placeOnLane(seg, lane, dist) {
    this.pts.length = 0;
    this.i0 = 0;
    this.sCar = 0;
    this.plan.clear();
    this.bSeg = seg;
    this.bLane = lane;
    this.bDist = dist;
    this.bOffset = LANE * (lane + 0.5);
    this.decide(seg, lane);
    this.extend(100);
  }

  /** Choose where to go after this segment. */
  decide(seg, lane) {
    if (this.plan.has(seg.id)) return this.plan.get(seg.id);
    let outs = seg.to.out.filter((s) => s !== seg.reverse && !s.closed);
    if (!outs.length) outs = seg.to.out.filter((s) => s !== seg.reverse);
    let pick = null;
    if (this.routeGoal) {
      // heading somewhere: re-plan at every junction (cheap on a 7x7 grid), no U-turns
      if (seg.to !== this.routeGoal) {
        const path = nodePath(this.city, seg.to, this.routeGoal);
        pick = outs.find((s) => s.to === path[1]) || null;
        if (!pick) {
          const gx = this.routeGoal.x, gz = this.routeGoal.z;
          pick = outs.slice().sort((a, b) => Math.hypot(a.to.x - gx, a.to.z - gz) - Math.hypot(b.to.x - gx, b.to.z - gz))[0] || null;
        }
      }
    } else if (this.forcedRoute && this.forcedRoute.length) {
      const nxt = this.forcedRoute[0];
      pick = outs.find((s) => s.to === nxt) || null;
    }
    if (!pick) {
      const weighted = outs.map((s) => {
        const cr = seg.dir.x * s.dir.z - seg.dir.z * s.dir.x;
        const turn = Math.abs(cr) < 0.5 ? 'straight' : cr > 0 ? 'right' : 'left';
        return { s, turn, w: turn === 'straight' ? 0.55 : turn === 'right' ? 0.25 : 0.2 };
      });
      if (!weighted.length) weighted.push({ s: seg.reverse, turn: 'uturn', w: 1 });
      let tot = weighted.reduce((a, b) => a + b.w, 0) * Math.random();
      for (const w of weighted) {
        tot -= w.w;
        if (tot <= 0) {
          pick = w.s;
          break;
        }
      }
      pick = pick || weighted[0].s;
    }
    const cr = seg.dir.x * pick.dir.z - seg.dir.z * pick.dir.x;
    const turn = pick === seg.reverse ? 'uturn' : Math.abs(cr) < 0.5 ? 'straight' : cr > 0 ? 'right' : 'left';
    const p = { next: pick, turn, lane: turn === 'right' ? 1 : turn === 'left' || turn === 'uturn' ? 0 : lane };
    this.plan.set(seg.id, p);
    return p;
  }

  pushPt(x, z, seg, kind, stop = null) {
    const last = this.pts[this.pts.length - 1];
    const s = last ? last.s + Math.hypot(x - last.x, z - last.z) : this.sCar;
    this.pts.push({ x, z, s, seg, kind, stop });
  }

  extend(ahead) {
    let guard = 0;
    while ((this.pts.length < 2 || this.pts[this.pts.length - 1].s - this.sCar < ahead) && guard++ < 6) {
      const seg = this.bSeg;
      const plan = this.decide(seg, this.bLane);
      const from = this.bOffset;
      const to = LANE * (plan.lane + 0.5);
      const d0 = this.bDist;
      let stopAdded = false;
      for (let d = d0; d <= seg.length + 0.01; d += 3) {
        const f = smoothstep(d0 + 4, d0 + 28, d);
        const off = lerp(from, to, f);
        const x = seg.start.x + seg.dir.x * d + seg.right.x * off;
        const z = seg.start.z + seg.dir.z * d + seg.right.z * off;
        let stop = null;
        if (!stopAdded && d >= seg.stopDist - 1.5 && seg.to.deg >= 3) {
          stop = seg;
          stopAdded = true;
        }
        this.pushPt(x, z, seg, 'lane', stop);
      }
      // turn through the intersection
      const nx = plan.next;
      const nLane = plan.turn === 'uturn' ? 0 : plan.lane;
      const offB = LANE * (nLane + 0.5);
      const ax = seg.end.x + seg.right.x * to, az = seg.end.z + seg.right.z * to;
      const bx = nx.start.x + nx.right.x * offB, bz = nx.start.z + nx.right.z * offB;
      let cx, cz;
      if (plan.turn === 'straight') {
        cx = (ax + bx) / 2;
        cz = (az + bz) / 2;
      } else if (plan.turn === 'uturn') {
        cx = seg.end.x + seg.dir.x * 8;
        cz = seg.end.z + seg.dir.z * 8;
      } else {
        const t = (bx - ax) * seg.dir.x + (bz - az) * seg.dir.z;
        cx = ax + seg.dir.x * t;
        cz = az + seg.dir.z * t;
      }
      const n = plan.turn === 'straight' ? 4 : 8;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
        const z = (1 - t) * (1 - t) * az + 2 * (1 - t) * t * cz + t * t * bz;
        this.pushPt(x, z, null, plan.turn === 'straight' ? 'cross' : 'turn');
      }
      this.bSeg = nx;
      this.bLane = nLane;
      this.bDist = 0;
      this.bOffset = offB;
      if (this.forcedRoute && this.forcedRoute.length && this.forcedRoute[0] === nx.to) this.forcedRoute.shift();
      else if (this.forcedRoute && this.forcedRoute.length && nx.from === this.forcedRoute[0]) this.forcedRoute.shift();
    }
  }

  /** Advance the tracked position along the path. */
  track(p) {
    const pts = this.pts;
    let best = this.i0, bd = Infinity;
    const end = Math.min(pts.length - 1, this.i0 + 12);
    for (let i = Math.max(0, this.i0 - 2); i <= end; i++) {
      const d = (pts[i].x - p.x) ** 2 + (pts[i].z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.i0 = best;
    // project onto segment best -> best+1
    const a = pts[best], b = pts[Math.min(best + 1, pts.length - 1)];
    const sx = b.x - a.x, sz = b.z - a.z;
    const L2 = sx * sx + sz * sz || 1;
    const t = clamp(((p.x - a.x) * sx + (p.z - a.z) * sz) / L2, 0, 1);
    this.sCar = a.s + (b.s - a.s) * t;
    this.offPath = Math.sqrt(bd);
    // drop old points
    if (this.i0 > 12) {
      pts.splice(0, this.i0 - 4);
      this.i0 = 4;
    }
    this.extend(100);
  }

  pointAt(s, out) {
    const pts = this.pts;
    let i = this.i0;
    while (i < pts.length - 2 && pts[i + 1].s < s) i++;
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 0;
    out.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
    out.tx = b.x - a.x;
    out.tz = b.z - a.z;
    out.seg = a.seg || b.seg;
    return out;
  }

  /** Current road segment (the one the car is on or approaching). */
  get currentSeg() {
    const p = this.pts[this.i0];
    if (p && p.seg) return p.seg;
    for (let i = this.i0; i < this.pts.length; i++) if (this.pts[i].seg) return this.pts[i].seg;
    return null;
  }

  // ------------------------------------------------------------ perception
  findLeader() {
    const car = this.car;
    const me = car.body.position;
    const pts = this.pts;
    let best = null, bestGap = 999, bestV = 0;
    const myHalf = car.boundsMax.z;
    const cars = this.mgr.game.cars;
    const iEnd = Math.min(pts.length - 1, this.i0 + 22);
    for (const c of cars) {
      if (c === car || c.removed) continue;
      const cp = c.body.position;
      const dx = cp.x - me.x, dz = cp.z - me.z;
      if (dx * dx + dz * dz > 55 * 55) continue;
      // nearest path point ahead
      let bi = -1, bd = 3.0 * 3.0;
      for (let i = this.i0; i <= iEnd; i++) {
        const d = (pts[i].x - cp.x) ** 2 + (pts[i].z - cp.z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi < 0) continue;
      const lat = Math.sqrt(bd);
      const halfW = c.boundsMax.x;
      if (lat > 1.1 + halfW) continue;
      const gap = pts[bi].s - this.sCar - myHalf - c.boundsMax.z;
      if (gap < -1.5) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = c;
        const tx = pts[Math.min(bi + 1, pts.length - 1)].x - pts[bi].x;
        const tz = pts[Math.min(bi + 1, pts.length - 1)].z - pts[bi].z;
        const tl = Math.hypot(tx, tz) || 1;
        bestV = (c.body.velocity.x * tx + c.body.velocity.z * tz) / tl;
      }
    }
    // pedestrians on the road (crossing, knocked down, diving)
    const peds = this.mgr.game.peds;
    if (peds)
      for (const p of peds.onRoadNear(me, 45)) {
        let bi = -1, bd = 2.2 * 2.2;
        for (let i = this.i0; i <= iEnd; i++) {
          const d = (pts[i].x - p.pos.x) ** 2 + (pts[i].z - p.pos.z) ** 2;
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        if (bi < 0) continue;
        const gap = pts[bi].s - this.sCar - myHalf - 1.2;
        if (gap > -1 && gap < bestGap) {
          bestGap = Math.max(0, gap);
          best = null;
          bestV = 0;
          this.pedAhead = p;
        }
      }
    this.leader = best;
    this.leaderGap = bestGap;
    this.leaderV = bestV;
  }

  /** Distance to the next stop line where we must stop (red / yellow / yield), or Infinity. */
  stopLineGap(v) {
    const pts = this.pts;
    for (let i = this.i0; i < pts.length; i++) {
      const p = pts[i];
      const d = p.s - this.sCar;
      if (d > 70) break;
      if (!p.stop) continue;
      const seg = p.stop;
      if (d < -0.5) continue;
      const sig = this.city.signalFor(seg);
      const gap = d - this.car.boundsMax.z;
      // emergency vehicles on a call treat lights as advisory (but slow through the junction)
      if (this.car.sirenOn) return sig === 'red' && gap < 12 && v > 7 ? gap + 8 : Infinity;
      if (sig === 'stop') return this.stopSign(seg, gap, v);
      if (sig === 'red' && gap > -0.8) return gap;
      if (sig === 'yellow') {
        const brakeDist = (v * v) / (2 * 4);
        if (gap > brakeDist - 1) return gap;
      }
      // left turns yield to oncoming traffic
      const plan = this.plan.get(seg.id);
      if (plan && plan.turn === 'left' && gap < 30 && this.oncoming(seg)) return gap;
      return Infinity;
    }
    return Infinity;
  }

  /** All-way stop: stop at the line, then go in order of arrival once the junction is clear. */
  stopSign(seg, gap, v) {
    if (this.stopPass === seg) return Infinity;
    const node = seg.to;
    const city = this.city;
    const q = (node.queue ||= new Map());
    if (gap < (this.car.physicsActive ? 3.4 : 4.4) && v < 0.4) { // IDM keeps ~2.2 m to the line
      if (!q.has(this.car)) q.set(this.car, city.time);
      const t0 = q.get(this.car);
      if (city.time - t0 < 0.9) return gap;
      // first come, first served among cars still waiting here
      for (const [c, t] of q) {
        if (c === this.car) continue;
        if (c.removed || city.time - t > 40 || c.body.position.distanceTo(_v.set(node.x, 0, node.z)) > 16) {
          q.delete(c);
          continue;
        }
        if (t < t0 - 0.05) return gap;
      }
      // anything moving in the box?
      const half = CITY.RW / 2 + 1;
      for (const c of this.game.cars) {
        if (c === this.car || c.removed) continue;
        const p = c.body.position;
        if (Math.abs(p.x - node.x) < half && Math.abs(p.z - node.z) < half && c.speed > 0.8) return gap;
      }
      q.delete(this.car);
      this.stopPass = seg;
      return Infinity;
    }
    return gap;
  }

  oncoming(seg) {
    const node = seg.to;
    for (const c of this.game.cars) {
      if (c === this.car || c.removed) continue;
      const rx = c.body.position.x - node.x, rz = c.body.position.z - node.z;
      const along = rx * seg.dir.x + rz * seg.dir.z;
      const lat = rx * seg.right.x + rz * seg.right.z;
      if (along > -2 && along < 45 && lat < 0.5 && lat > -CITY.RW / 2) {
        const vv = -(c.body.velocity.x * seg.dir.x + c.body.velocity.z * seg.dir.z);
        if (vv > 1.5 || (along < 8 && vv > 0.3)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ control
  update(dt) {
    const car = this.car;
    if (car.removed) return;
    this.honkCd -= dt;
    this.speechCd -= dt;
    this.anger = Math.max(0, this.anger - dt * 0.012);
    const env = this.game.env;
    car.sys.headlights = env.night > 0.35 || env.fogAmount > 0.5 ? 2 : 0;
    car.sys.wipers = env.rain > 0.2 ? (env.rain > 0.7 ? 3 : 2) : 0;
    car.sys.ignition = 'on';
    if (!car.phys.pt.running && !car.phys.pt.cranking && !car.wrecked && this.state !== 'wrecked') {
      car.phys.pt.running = true;
      car.phys.pt.omega = 80;
    }
    if (car.phys.pt.selector !== 'D' && car.phys.pt.selector !== 'R') car.phys.pt.setSelector('D');
    if (!car.physicsActive) return this.kinematic(dt);
    // flipped / wrecked
    const up = car.body.R[4];
    if (car.wrecked || up < 0.3) {
      this.wreckT = (this.wreckT || 0) + dt;
      if (this.wreckT > 2.5 && this.state !== 'wrecked') {
        this.state = 'wrecked';
        car.sys.hazard = true;
      }
    } else this.wreckT = 0;
    if (this.state === 'wrecked') {
      this.setInputs(0, 1, 0);
      return;
    }
    // a fender bender with another NPC: both stop and argue
    this.argueCd -= dt;
    const other = car.lastImpactBy;
    if (car.lastImpact > 3 && other && other !== this.game.player.car && other.controller instanceof Driver && this.argueCd <= 0 && this.state === 'drive') {
      this.startArgue(other);
      if (other.controller.state === 'drive' && other.controller.argueCd <= 0) other.controller.startArgue(car);
    }
    if (this.state === 'argue') return this.updateArgue(dt);
    if (this.state === 'dpark') {
      // double-parked delivery: hazards on, engine running
      this.dpT -= dt;
      car.sys.hazard = true;
      this.setInputs(0, 1, 0);
      if (this.dpT <= 0) {
        car.sys.hazard = false;
        this.state = 'drive';
      }
      return;
    }
    if (this.state === 'rage' || this.state === 'confront') return this.updateRage(dt);
    if (this.state === 'shaken') {
      this.shakenT -= dt;
      this.setInputs(0, 0.8, 0);
      car.sys.hazard = true;
      if (this.shakenT <= 0) {
        car.sys.hazard = false;
        this.rejoin();
      }
      return;
    }
    if (this.state === 'offroad') return this.updateOffroad(dt);
    this.drive(dt);
  }

  setInputs(throttle, brake, steer) {
    const inp = this.car.phys.input;
    inp.throttle = throttle;
    inp.brake = brake;
    inp.steer = steer;
    inp.handbrake = 0;
  }

  /** Normal lane driving: pure pursuit steering + IDM speed. */
  drive(dt) {
    const car = this.car;
    const b = car.body;
    const p = b.position;
    this.track(p);
    if (this.offPath > 6) {
      this.state = 'offroad';
      return;
    }
    const v = Math.max(0, car.forwardSpeed);
    const seg = this.currentSeg;
    const limit = (seg ? seg.limit : 50 / 3.6) * this.speedFactor * (this.game.env.wetness > 0.5 ? 0.85 : 1);
    // curvature ahead
    let vCurve = limit;
    const pts = this.pts;
    for (let i = this.i0 + 1; i < Math.min(pts.length - 1, this.i0 + 14); i++) {
      const a = pts[i - 1], c = pts[i], n = pts[i + 1];
      const a1 = Math.atan2(c.x - a.x, c.z - a.z), a2 = Math.atan2(n.x - c.x, n.z - c.z);
      const ds = Math.max(0.5, (n.s - a.s) / 2);
      const k = Math.abs(wrapAngle(a2 - a1)) / ds;
      if (k > 0.01) {
        const vAllowed = Math.sqrt(2.6 + this.aggression * 1.2) / Math.sqrt(k);
        const dist = Math.max(0, c.s - this.sCar - 2);
        vCurve = Math.min(vCurve, Math.sqrt(vAllowed * vAllowed + 2 * 2.5 * dist));
      }
    }
    let v0 = Math.max(3, Math.min(limit, vCurve));
    // speed bumps: slow to a crawl
    for (const bp of this.city.bumps || []) {
      const dx = bp.x - p.x, dz = bp.z - p.z;
      if (dx * dx + dz * dz < 22 * 22 && (dx * b.velocity.x + dz * b.velocity.z) > 0) v0 = Math.min(v0, this.persona === 'racer' ? 8 : 4.5);
    }
    // pull over for sirens
    if ((this.frame || 0) % 10 === 0) this.checkSirens();
    if (this.yieldT > 0) {
      this.yieldT -= dt;
      v0 = Math.min(v0, 2.2);
    }
    this.yieldShift += ((this.yieldT > 0 ? 2.2 : 0) - this.yieldShift) * Math.min(1, dt * 1.5);
    // a delivery van may double-park for a while
    this.dpCd -= dt;
    if (this.dpCd <= 0) {
      this.dpCd = 90 + Math.random() * 120;
      if (car.cfg.body === 'van' && this.persona === 'normal' && v > 4 && this.bLane === 1 && seg && !car.sirenOn && seg.stopDist - (this.bDist || 0) > 30) {
        this.state = 'dpark';
        this.dpT = 14 + Math.random() * 12;
      }
    }
    // leader & stop line
    if ((this.frame = (this.frame || 0) + 1) % 2 === 0) this.findLeader();
    const stopGap = this.stopLineGap(v);
    let gap = this.leaderGap, vL = this.leaderV || 0;
    if (stopGap < gap) {
      gap = stopGap;
      vL = 0;
    }
    // IDM
    const a = 2.2 * this.accelMul, bb = 3.2, s0 = 2.2;
    let acc = a * (1 - Math.pow(v / v0, 4));
    if (gap < 80) {
      const dv = v - vL;
      const sStar = s0 + Math.max(0, v * this.headway + (v * dv) / (2 * Math.sqrt(a * bb)));
      acc -= a * (sStar / Math.max(gap, 0.3)) ** 2;
    }
    acc = clamp(acc, -9, a);
    // speed controller
    const target = clamp(v + acc * 0.6, 0, v0);
    let thr = 0, brk = 0;
    if (acc < -0.4 || target < v - 0.3) brk = clamp(-acc / 7 + (v - target) * 0.08, 0, 1);
    else thr = clamp((target - v) * 0.3 + (acc > 0 ? 0.12 : 0) + 0.05, 0, 0.85);
    if (target < 0.2 && v < 0.5) {
      thr = 0;
      brk = 0.45;
    }
    // drunks tap the brakes for no reason
    if (this.persona === 'drunk' && Math.random() < dt * 0.06) this.tapT = 0.5;
    if (this.tapT > 0) {
      this.tapT -= dt;
      thr = 0;
      brk = Math.max(brk, 0.55);
    }
    // pure pursuit
    const Ld = clamp(3.5 + v * 0.45, 4.5, 16);
    this.pointAt(this.sCar + Ld, _v);
    // lateral offsets: yielding to the kerb, drunken weaving
    const lat = this.yieldShift + (this.weave ? Math.sin(this.city.time * 0.55 + car.id) * this.weave : 0);
    if (lat) {
      const tl = Math.hypot(_v.tx, _v.tz) || 1;
      _v.x += (-_v.tz / tl) * lat;
      _v.z += (_v.tx / tl) * lat;
    }
    b.toLocalPoint(_v.setY(p.y), _v2);
    const L2 = _v2.x * _v2.x + _v2.z * _v2.z;
    const kappa = (2 * _v2.x) / Math.max(L2, 1);
    const delta = Math.atan(car.tuning.dims.WB * kappa);
    const steer = clamp(-delta / car.tuning.maxSteer, -1, 1);
    this.steerCmd += (steer - this.steerCmd) * Math.min(1, dt * 10);
    this.setInputs(thr, brk, this.steerCmd);
    if (this.stopPass && Math.hypot(p.x - this.stopPass.to.x, p.z - this.stopPass.to.z) > 22 && this.currentSeg !== this.stopPass) this.stopPass = null;
    // indicators ahead of turns
    this.updateIndicators();
    // honking / patience / stuck
    this.social(dt, v, target, stopGap);
    if (thr > 0.3 && v < 0.3) {
      this.stuck += dt;
      if (this.stuck > 4) {
        this.reverseT = 1.8;
        this.stuck = 0;
      }
    } else this.stuck = Math.max(0, this.stuck - dt);
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      car.phys.pt.setSelector('R');
      this.setInputs(0.5, 0, -this.steerCmd);
      if (this.reverseT <= 0) car.phys.pt.setSelector('D');
    }
  }

  updateIndicators() {
    const car = this.car;
    const pts = this.pts;
    let dir = 'none';
    for (let i = this.i0; i < pts.length; i++) {
      const p = pts[i];
      if (p.s - this.sCar > 38) break;
      if (p.kind === 'turn' || (p.seg && p.stop)) {
        const seg = p.seg || p.stop;
        const plan = seg ? this.plan.get(seg.id) : null;
        if (plan && (plan.turn === 'left' || plan.turn === 'right')) dir = plan.turn;
        if (p.kind === 'turn') break;
      }
    }
    if (car.sys.indicator !== dir) {
      car.sys.indicator = dir;
      car.sys.indArmed = false;
    }
  }

  /** Honk when blocked, react to the player's driving. */
  social(dt, v, target, stopGap) {
    const car = this.car;
    const player = this.game.player.car;
    if (!player) return;
    const leaderIsPlayer = this.leader === player;
    if (leaderIsPlayer && v < 1 && player.speed < 1 && this.leaderGap < 14 && stopGap > this.leaderGap) {
      this.blocked += dt;
      if (this.blocked > this.patience && this.honkCd <= 0) {
        const angry = this.blocked > this.patience * 2.5;
        this.honk(angry ? 0.9 : 0.25, angry);
        this.honkCd = angry ? 1.4 : 2.5;
        this.anger = Math.min(1, this.anger + 0.06);
        if (this.speechCd <= 0 && Math.random() < 0.5) this.say(angry ? INSULTS[Math.floor(Math.random() * INSULTS.length)] : HONK_LINES[Math.floor(Math.random() * HONK_LINES.length)], angry ? 'angry' : '');
      }
      // go around after a while
      if (this.blocked > 10 && !this.overtakeTried) {
        this.overtakeTried = true;
        this.overtakeAround();
      }
    } else if (this.leader && this.leader !== player && v < 1 && this.leader.speed < 0.5 && this.leaderGap < 14 && stopGap > this.leaderGap && !this.city.signalFor(this.currentSeg || this.bSeg).startsWith('r')) {
      // stuck behind a stopped NPC (double-parked van, breakdown, argument): honk, then go around
      this.blocked += dt;
      if (this.blocked > this.patience + 1 && this.honkCd <= 0) {
        this.honk(this.blocked > 8 ? 0.8 : 0.3, this.blocked > 8);
        this.honkCd = 3 + Math.random() * 2;
        if (this.speechCd <= 0 && Math.random() < 0.3) this.say(HONK_LINES[Math.floor(Math.random() * HONK_LINES.length)]);
      }
      if (this.blocked > 5 && !this.overtakeTried) {
        this.overtakeTried = true;
        this.overtakeAround();
      }
    } else {
      this.blocked = Math.max(0, this.blocked - dt * 2);
      if (this.blocked === 0) this.overtakeTried = false;
    }
    // hard braking because of the player -> long honk
    if (leaderIsPlayer && this.leaderGap < 8 && v > 6 && this.honkCd <= 0) {
      this.honk(1.1, false);
      this.honkCd = 3;
      this.anger = Math.min(1, this.anger + 0.12);
      if (this.speechCd <= 0) this.say(INSULTS[Math.floor(Math.random() * INSULTS.length)], 'angry');
    }
    // wrong-way player coming at us
    const pp = player.body.position, me = car.body.position;
    const dx = pp.x - me.x, dz = pp.z - me.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 45 * 45 && this.honkCd <= 0 && player.speed > 5) {
      car.body.axis(2, _fwd);
      const ahead = (dx * _fwd.x + dz * _fwd.z) / Math.sqrt(d2);
      const pv = player.body.velocity;
      const headOn = (pv.x * _fwd.x + pv.z * _fwd.z) / Math.max(player.speed, 0.1);
      if (ahead > 0.93 && headOn < -0.8) {
        car.lightsFlash = 0.8;
        this.honk(0.9, true);
        this.honkCd = 3;
      }
    }
    if (this.anger > 0.65 && this.aggression > 0.45 && this.game.settings.roadRage !== false) this.startRage();
  }

  /** Emergency vehicles approaching with sirens: slow down and move over to the kerb. */
  checkSirens() {
    const car = this.car;
    if (car.sirenOn) return;
    const me = car.body.position;
    for (const c of this.game.cars) {
      if (c === car || c.removed || !c.sirenOn || c.speed < 3) continue;
      _v2.copy(c.body.position).sub(me);
      const d = _v2.length();
      if (d > 50) continue;
      // closing in on us?
      const closing = -(_v2.x * (c.body.velocity.x - car.body.velocity.x) + _v2.z * (c.body.velocity.z - car.body.velocity.z)) / Math.max(d, 1);
      if (closing > 1 || d < 15) {
        this.yieldT = 3;
        return;
      }
    }
  }

  startArgue(other) {
    // emergency crews and police don't stop to argue
    if (this.car.service || this.car.police || other.service || other.police) return;
    this.state = 'argue';
    this.argueT = 7 + Math.random() * 6;
    this.argueCd = 40;
    this.argueWith = other;
    this.car.sys.hazard = true;
    this.speechCd = Math.random() * 1.5;
  }

  updateArgue(dt) {
    const car = this.car;
    this.argueT -= dt;
    this.setInputs(0, 1, 0);
    if (this.speechCd <= 0) this.say(ARGUE[Math.floor(Math.random() * ARGUE.length)], 'angry');
    if (this.honkCd <= 0 && Math.random() < dt * 0.6) {
      this.honk(0.5, true);
      this.honkCd = 3;
    }
    if (this.argueT <= 0 || car.wrecked) {
      car.sys.hazard = false;
      this.rejoin();
    }
  }

  /** The player flashed the hazards: an apology (or a thank-you). */
  onApology() {
    if (this.state === 'rage' || this.state === 'confront') {
      this.anger = 0;
      this.say(['Apology accepted.', 'Fine. Whatever.', 'Just be careful next time!'][Math.floor(Math.random() * 3)]);
      this.endConfront();
      this.rejoin();
      return true;
    }
    if (this.anger > 0.15) {
      this.anger = 0;
      if (this.speechCd <= 0) this.say(['👍', 'No worries.', 'All good.'][Math.floor(Math.random() * 3)]);
      return true;
    }
    return false;
  }

  honk(dur, angry) {
    this.game.audio?.hornAt?.(this.car, dur, angry);
    this.car.sys.horn = true;
    setTimeout(() => (this.car.sys.horn = false), dur * 1000);
  }

  say(text, kind = '') {
    if (!this.game.settings.showSpeech) return;
    if (this.car.body.position.distanceTo(this.game.camera.position) > 60) return;
    this.speechCd = 4;
    this.game.hud.say(this.car.body.position, text, kind, 2.6);
  }

  overtakeAround() {
    // switch to the other lane of the current segment
    const seg = this.currentSeg;
    if (!seg) return;
    const plan = this.plan.get(seg.id);
    if (!plan) return;
    const other = plan.lane === 0 ? 1 : 0;
    // rebuild path from here in the other lane
    const d = clamp((this.car.body.position.x - seg.start.x) * seg.dir.x + (this.car.body.position.z - seg.start.z) * seg.dir.z, 0, seg.length);
    this.plan.set(seg.id, { ...plan, lane: other, turn: plan.turn === 'straight' ? 'straight' : plan.turn });
    if (plan.turn !== 'straight') {
      // can't turn from the wrong lane: go straight instead
      this.plan.delete(seg.id);
      const outs = seg.to.out.filter((s) => s !== seg.reverse);
      const straight = outs.find((s) => Math.abs(seg.dir.x * s.dir.z - seg.dir.z * s.dir.x) < 0.5) || outs[0];
      this.plan.set(seg.id, { next: straight, turn: 'straight', lane: other });
    }
    this.pts.length = 0;
    this.i0 = 0;
    this.bSeg = seg;
    this.bLane = other;
    this.bDist = Math.min(seg.length, d + 2);
    const lat = (this.car.body.position.x - seg.start.x) * seg.right.x + (this.car.body.position.z - seg.start.z) * seg.right.z;
    this.bOffset = lat;
    this.sCar = 0;
    this.extend(80);
  }

  /** The player hit us. */
  onHitByPlayer(dv) {
    if (this.state === 'wrecked') return;
    this.anger = Math.min(1, this.anger + 0.12 + dv * 0.06);
    if (this.honkCd <= 0) {
      this.honk(1.2, true);
      this.honkCd = 2;
    }
    if (this.speechCd <= 0) this.say(dv > 5 && this.aggression < 0.45 ? SHAKEN[Math.floor(Math.random() * SHAKEN.length)] : INSULTS[Math.floor(Math.random() * INSULTS.length)], 'angry');
    if (this.anger > 0.55 && this.aggression > 0.45 && this.game.settings.roadRage !== false) this.startRage();
    else if (dv > 4 && this.state === 'drive') {
      this.state = 'shaken';
      this.shakenT = 5 + Math.random() * 5;
    }
    this.game.police?.witness?.(this.car, 'hit');
  }

  onPlayerHonk() {
    if (this.state !== 'drive') return;
    this.anger = Math.min(1, this.anger + 0.05);
    if (Math.random() < 0.4 && this.honkCd <= 0) {
      this.honkCd = 2;
      setTimeout(() => this.honk(0.5, this.anger > 0.4), 400 + Math.random() * 400);
    }
    if (this.speechCd <= 0 && Math.random() < 0.5) this.say(['Relax!', 'Calm down!', 'What?!', "I'm going, I'm going!"][Math.floor(Math.random() * 4)], this.anger > 0.4 ? 'angry' : '');
  }

  // ------------------------------------------------------------ road rage
  startRage() {
    if (this.state === 'rage' || this.state === 'confront') return;
    this.state = 'rage';
    this.rageT = 25 + Math.random() * 25;
    this.say('THAT\'S IT!', 'angry');
    this.game.toast?.('A driver is enraged and coming after you!', 'warn');
    this.car.sys.indicator = 'none';
  }

  updateRage(dt) {
    const car = this.car;
    const player = this.game.player.car;
    this.rageT -= dt;
    if (this.state === 'confront') return this.updateConfront(dt);
    if (!player || this.rageT <= 0 || car.body.position.distanceTo(player.body.position) > 140 || (this.game.police && this.game.police.heat >= 2)) {
      this.anger = 0.2;
      this.say('Hmph.', '');
      this.rejoin();
      return;
    }
    const pp = player.body.position;
    const pv = player.body.velocity;
    const d = car.body.position.distanceTo(pp);
    player.body.axis(2, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    const rel = _v2.copy(car.body.position).sub(pp);
    const ahead = rel.dot(_fwd); // > 0: we are in front of the player
    // both stopped close together: get out and have a word
    if (player.speed < 0.8 && car.speed < 0.8 && d < 14 && this.game.player.mode === 'car') {
      this.stillT = (this.stillT || 0) + dt;
      if (this.stillT > 2 && this.game.peds) return this.startConfront(player);
    } else this.stillT = 0;
    // pick a tactic: tailgate, overtake and cut in, brake-check, ram
    this.rageModeT -= dt;
    if (this.rageModeT <= 0) {
      if (this.rageMode === 'tail' && player.speed > 9) {
        this.rageMode = 'pass';
        this.rageModeT = 9;
      } else {
        this.rageMode = 'tail';
        this.rageModeT = 6 + Math.random() * 6;
      }
    }
    let target, want;
    if (this.rageMode === 'pass') {
      // overtake on the left, then swing in front
      target = _v.copy(pp).addScaledVector(pv, 0.6).addScaledVector(_fwd, 12).addScaledVector(_right, ahead > 3 ? 0 : -3.5);
      want = player.speed + 7;
      if (ahead > 7 && Math.abs(rel.dot(_right)) < 1.6) {
        this.rageMode = 'brake';
        this.rageModeT = 0.9;
        this.say(['HOW DO YOU LIKE IT?!', 'BRAKE CHECK!', 'HA!'][Math.floor(Math.random() * 3)], 'angry');
      }
    } else if (this.rageMode === 'brake') {
      // slam the brakes right in front of the player
      this.setInputs(0, 1, this.steerCmd * 0.5);
      car.lightsFlash = 0.2;
      if (this.rageModeT <= 0.05) {
        this.rageMode = 'tail';
        this.rageModeT = 6 + Math.random() * 6;
      }
      return;
    } else {
      // tailgate behind the player, or ram when slow and close
      const ram = d < 14 && (player.speed < 6 || Math.random() < 0.002 * this.aggression * 60 * dt);
      target = _v.copy(pp).addScaledVector(pv, 0.5);
      if (!ram) target.addScaledVector(_fwd, -7);
      want = ram ? player.speed + 8 : clamp(player.speed + (d - 8) * 0.4, 0, 30);
    }
    this.steerTo(target, want, dt, true);
    if (this.honkCd <= 0) {
      this.honk(0.3 + Math.random() * 0.8, true);
      this.honkCd = 0.8 + Math.random() * 1.8;
      car.lightsFlash = 0.4;
    }
    if (this.speechCd <= 0 && d < 30) this.say(INSULTS[Math.floor(Math.random() * INSULTS.length)], 'angry');
  }

  /** Stop, get out, walk to the player's window and shout. */
  startConfront(player) {
    const g = this.game;
    const car = this.car;
    this.state = 'confront';
    this.setInputs(0, 1, 0);
    car.phys.parkBrake = true;
    car.body.toWorldPoint(_v.set(car.boundsMax.x + 0.6, 0, 0.3), _v);
    const goal = player.body.toWorldPoint(new THREE.Vector3(player.boundsMax.x + 0.8, 0, 0.2), new THREE.Vector3());
    this.confrontPed = g.peds.spawnScripted(_v.clone(), { goal, face: player, speed: 1.9, gesture: true });
    this.confrontT = 14;
    this.bangT = 2;
    g.audio?.door?.(true);
  }

  updateConfront(dt) {
    const g = this.game;
    const car = this.car;
    const ped = this.confrontPed;
    const player = g.player.car;
    this.setInputs(0, 1, 0);
    this.confrontT -= dt;
    if (!ped || !g.peds.list.includes(ped)) return this.endConfront(true);
    if (ped.state === 'down' || ped.state === 'getup') return; // somebody ran them over...
    const gone = !player || player.body.position.distanceTo(ped.pos) > 18 || g.player.mode !== 'car';
    if (!ped.returning && (gone || this.confrontT <= 0)) {
      ped.returning = true;
      ped.gesture = false;
      ped.goal = car.body.toWorldPoint(new THREE.Vector3(car.boundsMax.x + 0.6, 0, 0.3), new THREE.Vector3());
      ped.state = 'goto';
      g.peds.shout(ped, gone ? (g.player.mode === 'car' ? 'Yeah, drive away!' : 'Yeah, that\'s what I thought.') : 'Idiot.');
    }
    if (ped.returning) {
      if (ped.state === 'idle') this.endConfront(true);
      return;
    }
    if (ped.state === 'idle') {
      this.bangT -= dt;
      if (ped.shoutCd <= 0) g.peds.shout(ped, CONFRONT[Math.floor(Math.random() * CONFRONT.length)]);
      if (this.bangT <= 0) {
        // bang on the window
        this.bangT = 2.5 + Math.random() * 2;
        g.audio?.thump?.(ped.pos, 0.5);
        if (player === g.player.car) g.cam.addShake?.(0.15);
      }
    }
  }

  endConfront(rejoin = false) {
    const g = this.game;
    if (this.confrontPed) g.peds?.removePed?.(this.confrontPed);
    if (this.confrontPed) g.audio?.door?.(false);
    this.confrontPed = null;
    this.car.phys.parkBrake = false;
    if (rejoin) {
      this.anger = 0.3;
      this.rejoin();
    }
  }

  /** Drive toward a point off the lane network, avoiding buildings. */
  steerTo(target, want, dt, avoid = true) {
    const car = this.car;
    const b = car.body;
    const p = b.position;
    b.toLocalPoint(_v2.copy(target).setY(p.y), _v2);
    let ang = Math.atan2(_v2.x, _v2.z); // + = target on the left
    const v = car.forwardSpeed;
    let speed = want;
    if (avoid) {
      const L = 6 + Math.abs(v) * 0.8;
      b.axis(2, _fwd);
      _fwd.y = 0;
      _fwd.normalize();
      const origin = _v.copy(p).addScaledVector(_fwd, car.boundsMax.z * 0.8);
      origin.y = 0.8;
      const probe = (a) => {
        const d = _right.set(_fwd.x * Math.cos(a) + _fwd.z * Math.sin(a), 0, -_fwd.x * Math.sin(a) + _fwd.z * Math.cos(a));
        return this.game.world.raycast(origin, d, L, (bx) => bx.max.y > 0.6);
      };
      const c = probe(0), l = probe(0.45), r = probe(-0.45);
      if (c < L * 0.95 || l < L * 0.6 || r < L * 0.6) {
        const push = (1 - c / L) * 1.3;
        ang += l > r ? push : -push;
        speed = Math.min(speed, 4 + c * 0.9);
      }
    }
    // target behind: slow down and swing around
    if (Math.abs(ang) > 1.6) speed = Math.min(speed, 6);
    let steer = clamp(-ang * 1.8, -1, 1);
    let thr = clamp((speed - v) * 0.35 + 0.1, 0, 1), brk = 0;
    if (v > speed + 2) {
      thr = 0;
      brk = clamp((v - speed) * 0.15, 0, 1);
    }
    // stuck against something: reverse out
    if (thr > 0.4 && Math.abs(v) < 0.5) {
      this.stuck += dt;
      if (this.stuck > 1.5) {
        this.reverseT = 1.2;
        this.stuck = 0;
      }
    } else this.stuck = Math.max(0, this.stuck - dt);
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      car.phys.pt.setSelector('R');
      this.setInputs(0.6, 0, -steer);
      if (this.reverseT <= 0) car.phys.pt.setSelector('D');
      return;
    }
    if (car.phys.pt.selector === 'R') car.phys.pt.setSelector('D');
    this.steerCmd += (steer - this.steerCmd) * Math.min(1, dt * 8);
    this.setInputs(thr, brk, this.steerCmd);
  }

  /** Off the lane network: drive back to the nearest lane, then resume. */
  updateOffroad(dt) {
    const nl = this.city.nearestLane(this.car.body.position);
    if (!nl) {
      // outside the city: head for the nearest intersection
      const n = nearestNode(this.city, this.car.body.position);
      this.steerTo(_v.set(n.x, 0, n.z), 8, dt, true);
      return;
    }
    const target = this.city.lanePoint(nl.seg, nl.lane, Math.min(nl.seg.length, nl.dist + 10));
    this.steerTo(target, 7, dt, true);
    if (Math.abs(nl.lateral - LANE * (nl.lane + 0.5)) < 1.5) this.rejoin();
  }

  rejoin() {
    this.car.sys.hazard = false;
    const car = this.car;
    car.body.axis(2, _fwd);
    const nl = this.city.nearestLane(car.body.position, _fwd) || this.city.nearestLane(car.body.position);
    if (!nl) {
      this.state = 'offroad';
      return;
    }
    this.state = 'drive';
    this.placeOnLane(nl.seg, nl.lane, nl.dist);
    this.track(car.body.position);
  }

  // ------------------------------------------------------------ LOD: kinematic driving
  kinematic(dt) {
    const car = this.car;
    if (this.state !== 'drive') {
      this.rejoin();
      if (this.state !== 'drive') return;
    }
    // simple speed control with leader/stop line
    if ((this.frame = (this.frame || 0) + 1) % 4 === 0) this.findLeader();
    const seg = this.currentSeg;
    const v0 = (seg ? seg.limit : 13.9) * this.speedFactor;
    const stopGap = this.stopLineGap(this.kinV);
    const gap = Math.min(this.leaderGap, stopGap);
    let target = v0;
    if (gap < 40) target = Math.min(target, Math.max(0, (gap - 3) * 0.7));
    const turnAhead = this.pts.slice(this.i0, this.i0 + 6).some((p) => p.kind === 'turn');
    if (turnAhead) target = Math.min(target, 6);
    this.kinV += clamp(target - this.kinV, -6 * dt, 2 * dt);
    this.sCar += this.kinV * dt;
    // keep i0 in sync
    while (this.i0 < this.pts.length - 2 && this.pts[this.i0 + 1].s < this.sCar) this.i0++;
    if (this.i0 > 12) {
      this.pts.splice(0, this.i0 - 4);
      this.i0 = 4;
    }
    this.extend(100);
    const p = this.pointAt(this.sCar, _v);
    const yaw = Math.atan2(p.tx, p.tz);
    const b = car.body;
    const gy = this.game.world.groundAt(p.x, p.z, 2, { y: 0 }).y;
    b.position.set(p.x, gy + car.tuning.com.y, p.z);
    b.quaternion.setFromAxisAngle(UP, yaw);
    b.velocity.set(Math.sin(yaw) * this.kinV, 0, Math.cos(yaw) * this.kinV);
    b.angularVelocity.set(0, 0, 0);
    b.updateDerived();
    for (const w of car.phys.wheels) {
      w.omega = this.kinV / w.radius;
      w.spin += w.omega * dt;
      w.s = w.sStatic;
      w.yaw = 0;
    }
    car.phys.speed = this.kinV;
    car.phys.forwardSpeed = this.kinV;
    car.phys.input.brake = target < this.kinV - 0.5 ? 0.5 : 0;
    car.phys.pt.rpm = 800 + this.kinV * 120;
    this.updateIndicators();
  }
}

// ================================================================== manager
export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.drivers = [];
    this.parked = [];
    this.spawnTimer = 0;
    this.rnd = Math.random;
  }

  init() {
    const g = this.game;
    // parked cars (asleep until something hits them)
    for (const spot of g.city.parkingSpots) {
      if (this.parked.length >= (spot.police ? 99 : g.settings.parked)) continue;
      const cfg = npcConfig(this.rnd);
      let opts = { npc: true };
      if (spot.police) {
        Object.assign(cfg, configForBody('sedan', cfg), { paint: '#f4f4f4', livery: 'police', engine: 'v8', finish: 'gloss', wheelStyle: 'steel', wheelColor: '#222222', plate: 'SDPD ' + Math.floor(10 + this.rnd() * 89) });
        opts = { npc: true, police: true };
      }
      const car = new Car(g, cfg, opts);
      car.placeAt(spot.pos.x, 0, spot.pos.z, spot.yaw);
      car.body.sleeping = true;
      car.parked = true;
      g.addCar(car);
      this.parked.push(car);
    }
    this.setDensity(g.settings.traffic);
  }

  setDensity(n) {
    const g = this.game;
    while (this.drivers.length > n) {
      const d = this.drivers.pop();
      g.removeCar(d.car);
    }
    let tries = 0;
    while (this.drivers.length < n && tries++ < n * 4) this.spawnDriver(true);
  }

  makeNpc(taxi) {
    const cfg = npcConfig(this.rnd);
    if (taxi) Object.assign(cfg, configForBody('sedan', cfg), { paint: '#f2c21b', livery: 'taxi', engine: 'i4', drivetrain: 'fwd', finish: 'gloss' });
    return new Car(this.game, cfg, { npc: true, taxi });
  }

  /** Spawn (or recycle) a driver somewhere near the player, preferably out of view. */
  spawnDriver(initial, recycle = null) {
    const g = this.game;
    const focus = g.player.focus;
    let spot = null;
    for (let k = 0; k < 30; k++) {
      const s = g.city.randomLaneSpot(this.rnd);
      const d = s.pos.distanceTo(focus);
      const minD = initial ? 25 : 130;
      const maxD = initial ? 320 : 320;
      if (d < minD || d > maxD) continue;
      if (!initial && this.visible(s.pos)) continue;
      if (g.cars.some((c) => c.body.position.distanceToSquared(s.pos) < 14 * 14)) continue;
      spot = s;
      break;
    }
    if (!spot) return null;
    let car = recycle;
    if (!car) {
      car = this.makeNpc(this.rnd() < 0.08);
      g.addCar(car);
    } else if (car.model.lattice.totalDamage > 0 || car.wrecked) car.repair();
    car.placeAt(spot.pos.x, 0, spot.pos.z, spot.yaw);
    car.phys.pt.running = true;
    car.phys.pt.setSelector('D');
    car.phys.pt.gear = 1;
    car.phys.pt.omega = 90;
    car.sys.hazard = false;
    car.sys.ignition = 'on';
    const drv = recycle ? car.controller : new Driver(car, this);
    drv.setPersona(car.cfg.body === 'van' ? 'normal' : pickPersona(g, this.rnd));
    drv.state = 'drive';
    drv.anger = 0;
    drv.kinV = 8;
    drv.placeOnLane(spot.seg, spot.lane, spot.dist);
    car.physicsActive = car.body.position.distanceTo(focus) < 150;
    if (car.physicsActive) {
      car.body.velocity.set(Math.sin(spot.yaw) * 8, 0, Math.cos(spot.yaw) * 8);
      for (const w of car.phys.wheels) w.omega = 8 / w.radius;
    }
    if (!recycle) this.drivers.push(drv);
    return drv;
  }

  /** Hand a car that an activity borrowed back to normal traffic on the nearest lane. */
  adopt(car) {
    const g = this.game;
    if (!car || car.removed) return;
    const nl = g.city.nearestLane(car.body.position, car.body.axis(2, _v));
    if (!nl) return;
    let drv = car.controller instanceof Driver ? car.controller : null;
    if (!drv) {
      drv = new Driver(car, this);
      car.controller = drv;
    }
    drv.state = 'drive';
    drv.anger = 0;
    drv.kinV = Math.max(0, car.forwardSpeed);
    drv.placeOnLane(nl.seg, nl.lane, nl.dist);
    if (!this.drivers.includes(drv)) this.drivers.push(drv);
  }

  visible(p) {
    const cam = this.game.camera;
    _v.copy(p).sub(cam.position);
    const d = _v.length();
    if (d > 260) return false;
    cam.getWorldDirection(_v2);
    if (_v.dot(_v2) / d < 0.35) return false;
    return !this.game.world.blocked(cam.position.x, cam.position.z, p.x, p.z, 4);
  }

  update(dt) {
    const g = this.game;
    const focus = g.player.focus;
    for (const d of this.drivers) {
      const car = d.car;
      const dist = car.body.position.distanceTo(focus);
      // physics LOD with hysteresis
      if (!car.physicsActive && dist < 150) {
        car.physicsActive = true;
        car.body.sleeping = false;
        const v = d.kinV;
        const yaw = Math.atan2(car.body.R[2], car.body.R[8]);
        car.body.velocity.set(Math.sin(yaw) * v, 0, Math.cos(yaw) * v);
        for (const w of car.phys.wheels) {
          w.omega = v / w.radius;
          w.contact = true;
          w.s = w.sPrev = w.sStatic;
        }
        car.phys.pt.omega = 120;
      } else if (car.physicsActive && dist > 190 && d.state === 'drive' && car.body.R[4] > 0.8 && d.offPath < 3) {
        car.physicsActive = false;
        d.kinV = Math.max(0, car.forwardSpeed);
      }
      d.update(dt);
      // recycle far away / hopeless cars (unless a tow truck has claimed the wreck)
      const hopeless = d.state === 'wrecked' && dist > 90 && !this.visible(car.body.position) && !car.towed;
      if ((dist > 340 || hopeless) && d.state !== 'rage' && d.state !== 'confront' && !car.towed) {
        this.spawnDriver(false, car) || (car.physicsActive = false);
      }
    }
    // parked cars wake up when hit; keep them asleep otherwise
    this.spawnTimer -= dt;
    this.updateDensity(dt);
    this.updatePullOut(dt);
    // the player flashing the hazards = sorry / thank you
    const pc = g.player.car;
    const hz = !!(pc && g.player.mode === 'car' && pc.sys.hazard);
    if (hz && !this.prevHazard) this.onPlayerHazard(pc);
    this.prevHazard = hz;
  }

  /** Traffic follows the clock: rush hours are busy, nights are quiet. */
  densityFactor() {
    const h = this.game.env.hour ?? 12;
    if (h < 5) return 0.3;
    if (h < 6.5) return 0.5;
    if (h < 9.5) return 1.3; // morning rush
    if (h < 16) return 0.9;
    if (h < 19) return 1.35; // evening rush
    if (h < 22) return 0.75;
    return 0.45;
  }

  updateDensity(dt) {
    const g = this.game;
    this.densityT = (this.densityT || 0) - dt;
    if (this.densityT > 0) return;
    this.densityT = 2.5;
    const want = Math.round(g.settings.traffic * (g.settings.trafficByTime === false ? 1 : this.densityFactor()));
    const focus = g.player.focus;
    if (this.drivers.length > want + 1) {
      // retire someone far away and out of sight
      const i = this.drivers.findIndex((d) => d.state === 'drive' && d.car.body.position.distanceTo(focus) > 160 && !this.visible(d.car.body.position));
      if (i >= 0) {
        const d = this.drivers[i];
        this.drivers.splice(i, 1);
        g.removeCar(d.car);
      }
    } else if (this.drivers.length < want) this.spawnDriver(false);
  }

  /** Now and then a parked car (not a police one) gets a driver and pulls out into traffic. */
  updatePullOut(dt) {
    const g = this.game;
    this.pullT = (this.pullT ?? 20) - dt;
    if (this.pullT > 0 || g.state !== 'play') return;
    this.pullT = 25 + Math.random() * 35;
    const focus = g.player.focus;
    const cand = this.parked.filter((c) => !c.removed && !c.police && !c.wrecked && !c.isPlayer && !(c.ext && c.ext.alarm > 0) && c.body.position.distanceTo(focus) > 35 && c.body.position.distanceTo(focus) < 140 && c.model.lattice.totalDamage < 1);
    if (!cand.length) return;
    const car = cand[Math.floor(Math.random() * cand.length)];
    this.parked.splice(this.parked.indexOf(car), 1);
    car.parked = false;
    car.body.sleeping = false;
    car.physicsActive = true;
    car.sys.ignition = 'on';
    car.phys.pt.running = true;
    car.phys.pt.setSelector('D');
    car.sys.headlights = g.env.night > 0.35 ? 2 : 0;
    const drv = new Driver(car, this);
    drv.setPersona(pickPersona(g));
    drv.state = 'offroad'; // finds its way out of the bay to the nearest lane
    car.sys.indicator = 'left';
    this.drivers.push(drv);
  }

  onPlayerHazard(pc) {
    let calmed = 0;
    for (const d of this.drivers) {
      if (d.car.body.position.distanceTo(pc.body.position) > 45) continue;
      if (d.onApology()) calmed++;
    }
    if (calmed) this.game.toast('🙏 Apology accepted', 'good', 2);
  }

  onPlayerHorn() {
    const player = this.game.player.car;
    if (!player) return;
    player.body.axis(2, _fwd);
    for (const d of this.drivers) {
      const rel = _v.copy(d.car.body.position).sub(player.body.position);
      const dist = rel.length();
      if (dist < 30 && rel.dot(_fwd) / dist > 0.5) d.onPlayerHonk();
    }
  }
}
