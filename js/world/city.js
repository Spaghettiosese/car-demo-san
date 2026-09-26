import * as THREE from 'three';
import { MATERIALS } from '../physics/world.js';
import { mulberry32, clamp, lerp } from '../core/util.js';
import {
  asphaltTexture, sidewalkTexture, grassTexture, dirtTexture, concreteTexture, roofTexture,
  facadeTextures, FACADES, shopTexture, signTexture,
} from './textures.js';

export const CITY = {
  N: 7, // roads per axis
  PITCH: 110,
  RW: 14, // road width (2 lanes each way)
  LANE: 3.5,
  SW: 4.5, // sidewalk width
  CURB: 0.15,
};
const { N, PITCH, RW, LANE, SW, CURB } = CITY;
export const roadCoord = (k) => (k - (N - 1) / 2) * PITCH;
export const CITY_HALF = roadCoord(N - 1) + RW / 2;

const AVENUES = ['Harbor Ave', 'Maple Ave', 'Mission Ave', 'Central Ave', 'Oak Ave', 'Sunset Blvd', 'Canyon Rd'];
const STREETS = ['1st St', '2nd St', '3rd St', 'Main St', '5th St', '6th St', '7th St'];

export const PG = { x0: CITY_HALF + 12, x1: CITY_HALF + 430, z0: -320, z1: 320 }; // proving grounds

/** Collects quads per material index into one merged BufferGeometry. */
class MeshBuilder {
  constructor(nMats = 1) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = Array.from({ length: nMats }, () => []);
    this.color = null;
  }
  quad(a, b, c, d, n, uvs, mat = 0) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nrm.push(n[0], n[1], n[2]);
    for (const t of uvs) this.uv.push(t[0], t[1]);
    this.idx[mat].push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Axis-aligned box with world-scaled UVs. uScale/vScale = metres per texture repeat. */
  box(x0, y0, z0, x1, y1, z1, opts = {}) {
    const { side = 0, top = side, bottom = -1, uS = 1, vS = 1, uOff = 0, vOff = 0, topS = uS } = opts;
    const w = x1 - x0, d = z1 - z0, h = y1 - y0;
    const v0 = (y0 + vOff) / vS, v1 = (y1 + vOff) / vS;
    // +z face
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[uOff / uS, v0], [(uOff + w) / uS, v0], [(uOff + w) / uS, v1], [uOff / uS, v1]], side);
    // -z face
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[uOff / uS, v0], [(uOff + w) / uS, v0], [(uOff + w) / uS, v1], [uOff / uS, v1]], side);
    // +x face
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[uOff / uS, v0], [(uOff + d) / uS, v0], [(uOff + d) / uS, v1], [uOff / uS, v1]], side);
    // -x face
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[uOff / uS, v0], [(uOff + d) / uS, v0], [(uOff + d) / uS, v1], [uOff / uS, v1]], side);
    if (top >= 0) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / topS, z1 / topS], [x1 / topS, z1 / topS], [x1 / topS, z0 / topS], [x0 / topS, z0 / topS]], top);
    if (bottom >= 0) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], bottom);
    void h;
  }
  /** Flat horizontal quad (y) with world UVs. */
  flat(x0, z0, x1, z1, y, uS = 1, mat = 0) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [[x0 / uS, z1 / uS], [x1 / uS, z1 / uS], [x1 / uS, z0 / uS], [x0 / uS, z0 / uS]], mat);
  }
  /** Flat quad along a direction (for road markings), centred at (cx,cz). */
  strip(cx, cz, dx, dz, len, width, y, mat = 0) {
    const hx = (dx * len) / 2, hz = (dz * len) / 2;
    const sx = (-dz * width) / 2, sz = (dx * width) / 2;
    this.quad([cx - hx - sx, y, cz - hz - sz], [cx - hx + sx, y, cz - hz + sz], [cx + hx + sx, y, cz + hz + sz], [cx + hx - sx, y, cz + hz - sz], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], mat);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const all = [];
    let start = 0;
    this.idx.forEach((list, m) => {
      if (!list.length) return;
      for (const i of list) all.push(i);
      g.addGroup(start, list.length, m);
      start += list.length;
    });
    g.setIndex(all);
    g.computeBoundingSphere();
    return g;
  }
}

export class City {
  constructor(scene, world, seed = 1337) {
    this.scene = scene;
    this.world = world;
    this.rng = mulberry32(seed);
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.nodes = [];
    this.segments = [];
    this.blocks = [];
    this.locations = {};
    this.parkingSpots = [];
    this.buildingMats = [];
    this.nightMats = [];
    this.wetMats = [];
    this.time = 0;
    this.signalPhaseLen = [15, 3, 1.5, 15, 3, 1.5];
  }

  build() {
    this.buildGraph();
    this.planBlocks();
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildProvingGrounds();
    this.buildBoundary();
    return this;
  }

  // ------------------------------------------------------------ road graph
  buildGraph() {
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const deg = (i > 0) + (i < N - 1) + (j > 0) + (j < N - 1);
        this.nodes.push({ id: j * N + i, i, j, x: roadCoord(i), z: roadCoord(j), deg, signal: deg >= 3, offset: ((i * 3 + j * 5) % 7) * 3.3, out: [] });
      }
    const node = (i, j) => this.nodes[j * N + i];
    this.node = node;
    const addSeg = (a, b) => {
      const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const axis = Math.abs(dir.x) > 0.5 ? 'x' : 'z';
      const name = axis === 'z' ? AVENUES[a.i] : STREETS[a.j];
      const perimeter = axis === 'z' ? a.i === 0 || a.i === N - 1 : a.j === 0 || a.j === N - 1;
      const s = {
        id: this.segments.length,
        from: a,
        to: b,
        dir,
        right,
        axis,
        name,
        limit: perimeter ? 60 / 3.6 : 50 / 3.6,
        start: new THREE.Vector3(a.x, 0, a.z).addScaledVector(dir, RW / 2),
        end: new THREE.Vector3(b.x, 0, b.z).addScaledVector(dir, -RW / 2),
        length: PITCH - RW,
        stopDist: PITCH - RW - 3.2, // distance from start to the stop line
        reverse: null,
      };
      this.segments.push(s);
      a.out.push(s);
      return s;
    };
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = node(i, j);
        if (i < N - 1) {
          const b = node(i + 1, j);
          const s1 = addSeg(a, b), s2 = addSeg(b, a);
          s1.reverse = s2;
          s2.reverse = s1;
        }
        if (j < N - 1) {
          const b = node(i, j + 1);
          const s1 = addSeg(a, b), s2 = addSeg(b, a);
          s1.reverse = s2;
          s2.reverse = s1;
        }
      }
  }

  /** Position on a lane: lane 0 = inner (next to the centre line), 1 = outer. */
  lanePoint(seg, lane, dist, out = new THREE.Vector3()) {
    const off = LANE * (lane + 0.5);
    return out.copy(seg.start).addScaledVector(seg.dir, dist).addScaledVector(seg.right, off);
  }

  /** Signal for a segment arriving at its `to` node. */
  signalFor(seg) {
    const n = seg.to;
    if (!n.signal) return 'green';
    const total = this.signalPhaseLen.reduce((a, b) => a + b, 0);
    let t = (this.time + n.offset) % total;
    let phase = 0;
    while (t > this.signalPhaseLen[phase]) {
      t -= this.signalPhaseLen[phase];
      phase++;
    }
    const zGreen = phase === 0, zYellow = phase === 1, xGreen = phase === 3, xYellow = phase === 4;
    if (seg.axis === 'z') return zGreen ? 'green' : zYellow ? 'yellow' : 'red';
    return xGreen ? 'green' : xYellow ? 'yellow' : 'red';
  }

  /** Time until this approach's signal changes (for AI "can I make it"). */
  signalRemaining(seg) {
    const n = seg.to;
    if (!n.signal) return 99;
    const total = this.signalPhaseLen.reduce((a, b) => a + b, 0);
    let t = (this.time + n.offset) % total;
    let phase = 0;
    while (t > this.signalPhaseLen[phase]) {
      t -= this.signalPhaseLen[phase];
      phase++;
    }
    return this.signalPhaseLen[phase] - t;
  }

  update(dt) {
    this.time += dt;
  }

  /** Nearest lane position to p. Returns { seg, lane, dist, lateral, d2 }. */
  nearestLane(p, heading = null) {
    let best = null;
    for (const s of this.segments) {
      const rx = p.x - s.start.x, rz = p.z - s.start.z;
      const along = rx * s.dir.x + rz * s.dir.z;
      if (along < -2 || along > s.length + 2) continue;
      const lat = rx * s.right.x + rz * s.right.z;
      if (lat < -0.5 || lat > RW / 2 + 0.5) continue; // must be on this direction's half
      let score = Math.abs(lat - LANE * (lat > LANE ? 1.5 : 0.5));
      if (heading) {
        const dot = heading.x * s.dir.x + heading.z * s.dir.z;
        if (dot < 0.3) continue;
        score -= dot;
      }
      if (!best || score < best.score) best = { seg: s, lane: lat > LANE ? 1 : 0, dist: clamp(along, 0, s.length), lateral: lat, score };
    }
    return best;
  }

  /** Road name at a position (nearest road centre line). */
  streetName(p) {
    let best = null, bd = 1e9;
    for (let k = 0; k < N; k++) {
      const c = roadCoord(k);
      const dx = Math.abs(p.x - c), dz = Math.abs(p.z - c);
      if (dx < bd && Math.abs(p.z) < CITY_HALF + 5) { bd = dx; best = AVENUES[k]; }
      if (dz < bd && Math.abs(p.x) < CITY_HALF + 5) { bd = dz; best = STREETS[k]; }
    }
    if (p.x > PG.x0 - 2 && p.x < PG.x1 && p.z > PG.z0 && p.z < PG.z1) return 'Proving Grounds';
    if (bd > RW / 2 + SW + 2) {
      const b = this.blockAt(p.x, p.z);
      if (b && b.label) return b.label;
      if (!b) return 'Outskirts';
    }
    return best || 'Outskirts';
  }

  blockAt(x, z) {
    for (const b of this.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    return null;
  }

  onRoad(x, z) {
    if (Math.abs(x) > CITY_HALF || Math.abs(z) > CITY_HALF) return false;
    for (let k = 0; k < N; k++) {
      const c = roadCoord(k);
      if (Math.abs(x - c) < RW / 2 || Math.abs(z - c) < RW / 2) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ layout
  planBlocks() {
    const special = {
      '1,4': 'park', '4,1': 'gas', '1,1': 'garage', '4,4': 'police', '0,2': 'parking', '5,3': 'construction', '3,0': 'plaza',
    };
    for (let bj = 0; bj < N - 1; bj++)
      for (let bi = 0; bi < N - 1; bi++) {
        const x0 = roadCoord(bi) + RW / 2, x1 = roadCoord(bi + 1) - RW / 2;
        const z0 = roadCoord(bj) + RW / 2, z1 = roadCoord(bj + 1) - RW / 2;
        const ci = Math.abs(bi - 2.5), cj = Math.abs(bj - 2.5);
        const ring = Math.max(ci, cj);
        let type = ring < 1 ? 'downtown' : ring < 2 ? 'midtown' : 'residential';
        type = special[`${bi},${bj}`] || type;
        const labels = { park: 'Liberty Park', gas: 'Fuel Stop', garage: 'San Demo Customs', police: 'Police HQ', parking: 'Parking Lot', construction: 'Construction Site', plaza: 'Civic Plaza' };
        this.blocks.push({ bi, bj, x0, x1, z0, z1, type, label: labels[type] || null, flat: ['gas', 'garage', 'police', 'parking', 'construction'].includes(type) });
      }
  }

  // ------------------------------------------------------------ ground
  buildGround() {
    const world = this.world;
    // grass everywhere except under the paved city and proving grounds (no overlapping planes)
    const gmat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, color: 0x9aa58a });
    const gb = new MeshBuilder(1);
    const F = 3000, H = CITY_HALF;
    gb.flat(-F, -F, -H, F, 0, 5);
    gb.flat(PG.x1, -F, F, F, 0, 5);
    gb.flat(-H, H, H, F, 0, 5);
    gb.flat(-H, -F, H, -H, 0, 5);
    gb.flat(H, PG.z1, PG.x1, F, 0, 5);
    gb.flat(H, -F, PG.x1, PG.z0, 0, 5);
    const ground = new THREE.Mesh(gb.build(), gmat);
    ground.receiveShadow = true;
    this.group.add(ground);
    world.baseMaterial = (x, z) => {
      if (Math.abs(x) <= CITY_HALF + 1 && Math.abs(z) <= CITY_HALF + 1) return MATERIALS.asphalt;
      if (x > PG.x0 - 14 && x < PG.x1 && z > PG.z0 && z < PG.z1) return MATERIALS.asphalt;
      return MATERIALS.grass;
    };
    // asphalt under the whole city + proving grounds
    const asphalt = asphaltTexture();
    const amat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, metalness: 0, color: 0xffffff });
    this.roadMat = amat;
    this.wetMats.push({ mat: amat, dry: 0.92, wet: 0.25, dryColor: new THREE.Color(0xffffff), wetColor: new THREE.Color(0x9a9ca0) });
    const mb = new MeshBuilder(1);
    mb.flat(-CITY_HALF, -CITY_HALF, CITY_HALF, CITY_HALF, 0, 9);
    mb.flat(CITY_HALF, PG.z0, PG.x1, PG.z1, 0, 9);
    const m = new THREE.Mesh(mb.build(), amat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ------------------------------------------------------------ road markings
  buildRoads() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b21e, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mb = new MeshBuilder(2);
    const y = 0.012;
    const done = new Set();
    for (const s of this.segments) {
      const key = Math.min(s.id, s.reverse.id);
      const mid = s.start.clone().add(s.end).multiplyScalar(0.5);
      if (!done.has(key)) {
        done.add(key);
        // double yellow centre line
        for (const o of [-0.12, 0.12]) mb.strip(mid.x + s.right.x * o, mid.z + s.right.z * o, s.dir.x, s.dir.z, s.length - 7, 0.1, y, 1);
      }
      // dashed lane divider (per direction)
      for (let d = 6; d < s.length - 8; d += 9) {
        const p = s.start.clone().addScaledVector(s.dir, d + 1.5).addScaledVector(s.right, LANE);
        mb.strip(p.x, p.z, s.dir.x, s.dir.z, 3, 0.12, y, 0);
      }
      // edge line
      const e = mid.clone().addScaledVector(s.right, RW / 2 - 0.35);
      mb.strip(e.x, e.z, s.dir.x, s.dir.z, s.length - 7, 0.12, y, 0);
      // stop line + crosswalk at the far end
      if (s.to.signal || s.to.deg >= 3) {
        const sp = s.start.clone().addScaledVector(s.dir, s.stopDist).addScaledVector(s.right, RW / 4);
        mb.strip(sp.x, sp.z, s.right.x, s.right.z, RW / 2 - 0.2, 0.45, y, 0);
        for (let k = 0; k < 7; k++) {
          const cp = s.end.clone().addScaledVector(s.dir, -1.6).addScaledVector(s.right, -RW / 2 + 1 + k * 2);
          mb.strip(cp.x, cp.z, s.dir.x, s.dir.z, 2.6, 0.9, y, 0);
        }
      }
    }
    const m = new THREE.Mesh(mb.build(), [white, yellow]);
    m.receiveShadow = true;
    this.group.add(m);
    this.markingsMats = [white, yellow];
    this.wetMats.push({ mat: white, dry: 0.7, wet: 0.2, dryColor: new THREE.Color(0xe8e6de), wetColor: new THREE.Color(0xbcbab2) });
  }

  // ------------------------------------------------------------ blocks
  buildBlocks() {
    const world = this.world;
    const sw = sidewalkTexture();
    const swMat = new THREE.MeshStandardMaterial({ map: sw, roughness: 0.9, color: 0xffffff });
    this.wetMats.push({ mat: swMat, dry: 0.9, wet: 0.35, dryColor: new THREE.Color(0xffffff), wetColor: new THREE.Color(0xb0b0b0) });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.85 });
    const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
    const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 1 });
    const concMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 });
    const slabs = new MeshBuilder(4); // 0 sidewalk top, 1 curb sides, 2 grass, 3 dirt
    // facades: one material per style (+ roof)
    const styles = FACADES;
    const fb = new MeshBuilder(styles.length + 1);
    const shops = new MeshBuilder(2);
    const detail = new MeshBuilder(3); // 0 concrete, 1 dark trim, 2 accent
    const rnd = this.rng;
    const TILE_W = 12.8, TILE_H = 14;

    const addBuilding = (x0, z0, x1, z1, h, style, opts = {}) => {
      const base = opts.base ?? CURB;
      const si = styles.indexOf(style);
      const uOff = Math.floor(rnd() * 4) * 3.2;
      fb.box(x0, base, z0, x1, base + h, z1, { side: si, top: styles.length, uS: TILE_W, vS: TILE_H, uOff, vOff: -base, topS: 6 });
      world.addBox(x0, 0, z0, x1, base + h, z1, { kind: 'building', mat: MATERIALS.concrete });
      // rooftop clutter
      const n = Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const w = 2 + rnd() * 4, d = 2 + rnd() * 4;
        const cx = lerp(x0 + w, x1 - w, rnd()), cz = lerp(z0 + d, z1 - d, rnd());
        detail.box(cx - w / 2, base + h, cz - d / 2, cx + w / 2, base + h + 1.2 + rnd() * 2, cz + d / 2, { side: 0, top: 0, uS: 4, vS: 4 });
      }
      // parapet
      if (h > 10) {
        const t = 0.3;
        detail.box(x0, base + h, z0, x1, base + h + 0.9, z0 + t, { side: 1, top: 1 });
        detail.box(x0, base + h, z1 - t, x1, base + h + 0.9, z1, { side: 1, top: 1 });
        detail.box(x0, base + h, z0, x0 + t, base + h + 0.9, z1, { side: 1, top: 1 });
        detail.box(x1 - t, base + h, z0, x1, base + h + 0.9, z1, { side: 1, top: 1 });
      }
      // storefront band on street-facing sides
      if (opts.shops) {
        for (const face of opts.shops) {
          const hS = 4.2, o = 0.25;
          const off = rnd() * 8;
          if (face === 'n') shops.quad([x0, base, z1 + o], [x1, base, z1 + o], [x1, base + hS, z1 + o], [x0, base + hS, z1 + o], [0, 0, 1], [[off, 0], [off + (x1 - x0) / 60, 0], [off + (x1 - x0) / 60, 1], [off, 1]], 0);
          if (face === 's') shops.quad([x1, base, z0 - o], [x0, base, z0 - o], [x0, base + hS, z0 - o], [x1, base + hS, z0 - o], [0, 0, -1], [[off, 0], [off + (x1 - x0) / 60, 0], [off + (x1 - x0) / 60, 1], [off, 1]], 0);
          if (face === 'e') shops.quad([x1 + o, base, z1], [x1 + o, base, z0], [x1 + o, base + hS, z0], [x1 + o, base + hS, z1], [1, 0, 0], [[off, 0], [off + (z1 - z0) / 60, 0], [off + (z1 - z0) / 60, 1], [off, 1]], 0);
          if (face === 'w') shops.quad([x0 - o, base, z0], [x0 - o, base, z1], [x0 - o, base + hS, z1], [x0 - o, base + hS, z0], [-1, 0, 0], [[off, 0], [off + (z1 - z0) / 60, 0], [off + (z1 - z0) / 60, 1], [off, 1]], 0);
          // awning
          const aw = 1.6;
          if (face === 'n') detail.box(x0 + 1, base + hS - 0.2, z1, x1 - 1, base + hS, z1 + aw, { side: 2, top: 2 });
          if (face === 's') detail.box(x0 + 1, base + hS - 0.2, z0 - aw, x1 - 1, base + hS, z0, { side: 2, top: 2 });
          if (face === 'e') detail.box(x1, base + hS - 0.2, z0 + 1, x1 + aw, base + hS, z1 - 1, { side: 2, top: 2 });
          if (face === 'w') detail.box(x0 - aw, base + hS - 0.2, z0 + 1, x0, base + hS, z1 - 1, { side: 2, top: 2 });
        }
      }
    };
    this.addBuilding = addBuilding;

    for (const b of this.blocks) {
      const { x0, x1, z0, z1 } = b;
      // sidewalk ring / slab
      if (!b.flat) {
        slabs.box(x0, 0, z0, x1, CURB, z1, { side: 1, top: b.type === 'park' ? 2 : 0, uS: 3, vS: 3, topS: 3 });
        world.addSlab(x0, z0, x1, z1, CURB, b.type === 'park' ? MATERIALS.grass : MATERIALS.concrete);
        if (b.type === 'park') {
          // paved ring around the park
          for (const [a0, c0, a1, c1] of [[x0, z0, x1, z0 + SW], [x0, z1 - SW, x1, z1], [x0, z0 + SW, x0 + SW, z1 - SW], [x1 - SW, z0 + SW, x1, z1 - SW]]) {
            slabs.flat(a0, c0, a1, c1, CURB + 0.004, 3, 0);
            world.addSlab(a0, c0, a1, c1, CURB + 0.004, MATERIALS.concrete);
          }
        }
      } else {
        // flat lot at road level with a sidewalk ring broken by driveways
        const gaps = this.driveways(b);
        const ring = [
          ['s', x0, z0, x1, z0 + SW],
          ['n', x0, z1 - SW, x1, z1],
          ['w', x0, z0 + SW, x0 + SW, z1 - SW],
          ['e', x1 - SW, z0 + SW, x1, z1 - SW],
        ];
        for (const [side, a0, c0, a1, c1] of ring) {
          const along = side === 's' || side === 'n' ? [a0, a1] : [c0, c1];
          let cur = along[0];
          const sideGaps = gaps.filter((g) => g.side === side).sort((p, q) => p.from - q.from);
          const pieces = [];
          for (const g of sideGaps) {
            if (g.from > cur) pieces.push([cur, g.from]);
            cur = g.to;
          }
          if (cur < along[1]) pieces.push([cur, along[1]]);
          for (const [f, t] of pieces) {
            const r = side === 's' || side === 'n' ? [f, c0, t, c1] : [a0, f, a1, t];
            slabs.box(r[0], 0, r[1], r[2], CURB, r[3], { side: 1, top: 0, uS: 3, vS: 3, topS: 3 });
            world.addSlab(r[0], r[1], r[2], r[3], CURB, MATERIALS.concrete);
          }
        }
        b.gaps = gaps;
      }
      this.fillBlock(b, addBuilding, detail, slabs);
    }

    // meshes
    const slabMesh = new THREE.Mesh(slabs.build(), [swMat, curbMat, grassMat, dirtMat]);
    slabMesh.receiveShadow = true;
    this.group.add(slabMesh);
    const facadeMats = styles.map((st) => {
      const t = facadeTextures(st);
      const m = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissive,
        emissive: new THREE.Color(1, 0.92, 0.75),
        emissiveIntensity: 0,
        roughness: st === 'glass' ? 0.15 : 0.85,
        metalness: st === 'glass' ? 0.6 : 0.02,
        envMapIntensity: st === 'glass' ? 1.2 : 0.5,
      });
      this.nightMats.push({ mat: m, max: st === 'glass' ? 1.6 : 1.3 });
      return m;
    });
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 });
    const bmesh = new THREE.Mesh(fb.build(), [...facadeMats, roofMat]);
    bmesh.castShadow = true;
    bmesh.receiveShadow = true;
    this.group.add(bmesh);
    this.buildingMesh = bmesh;
    const shopMat = new THREE.MeshStandardMaterial({ map: shopTexture(), emissiveMap: shopTexture(), emissive: new THREE.Color(1, 0.95, 0.85), emissiveIntensity: 0.1, roughness: 0.4 });
    shopMat.map.wrapS = THREE.RepeatWrapping;
    this.nightMats.push({ mat: shopMat, max: 1.1, min: 0.08 });
    const shopMesh = new THREE.Mesh(shops.build(), [shopMat]);
    shopMesh.receiveShadow = true;
    this.group.add(shopMesh);
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x8c2b2b, roughness: 0.8 });
    const dmesh = new THREE.Mesh(detail.build(), [concMat, new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.8 }), awningMat]);
    dmesh.castShadow = true;
    dmesh.receiveShadow = true;
    this.group.add(dmesh);
  }

  /** Driveway gaps for flat lots: { side, from, to } along that side. */
  driveways(b) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const w = 12;
    const g = [];
    const sideTowardCity = (b.bi <= 2 ? 'e' : 'w');
    g.push({ side: b.bj <= 2 ? 'n' : 's', from: cx - w / 2 - 20, to: cx + w / 2 - 20 });
    g.push({ side: b.bj <= 2 ? 'n' : 's', from: cx - w / 2 + 20, to: cx + w / 2 + 20 });
    g.push({ side: sideTowardCity, from: cz - w / 2, to: cz + w / 2 });
    return g;
  }

  /** Buildings and features for one block. */
  fillBlock(b, addBuilding, detail, slabs) {
    const rnd = this.rng;
    const world = this.world;
    const ix0 = b.x0 + SW, ix1 = b.x1 - SW, iz0 = b.z0 + SW, iz1 = b.z1 - SW;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    b.props = [];
    const styleFor = (type) => {
      if (type === 'downtown') return ['glass', 'glass', 'modern', 'office'][Math.floor(rnd() * 4)];
      if (type === 'midtown') return ['office', 'modern', 'brick', 'apartment'][Math.floor(rnd() * 4)];
      return ['brick', 'apartment', 'apartment', 'brick', 'modern'][Math.floor(rnd() * 5)];
    };
    if (b.type === 'downtown') {
      const splitX = rnd() < 0.5;
      const halves = splitX
        ? [[ix0 + 3, iz0 + 3, cx - 2, iz1 - 3], [cx + 2, iz0 + 3, ix1 - 3, iz1 - 3]]
        : [[ix0 + 3, iz0 + 3, ix1 - 3, cz - 2], [ix0 + 3, cz + 2, ix1 - 3, iz1 - 3]];
      for (const [a0, c0, a1, c1] of halves) {
        const h = 45 + rnd() * 95;
        const style = styleFor('downtown');
        // podium + tower
        addBuilding(a0, c0, a1, c1, 9, 'modern', {});
        const inset = 4 + rnd() * 5;
        addBuilding(a0 + inset, c0 + inset, a1 - inset, c1 - inset, h, style, {});
        if (rnd() < 0.5) {
          const i2 = inset + 5;
          addBuilding(a0 + i2, c0 + i2, a1 - i2, c1 - i2, h + 12 + rnd() * 20, style, {});
        }
      }
      return;
    }
    if (b.type === 'midtown' || b.type === 'residential') {
      const mid = b.type === 'midtown';
      const depthR = mid ? [20, 30] : [13, 20];
      const hR = mid ? [16, 48] : [7, 18];
      const D = depthR[0] + rnd() * (depthR[1] - depthR[0]);
      const sides = [
        { f: 'n', along: [ix0, ix1], fixed: [iz1 - D, iz1] },
        { f: 's', along: [ix0, ix1], fixed: [iz0, iz0 + D] },
        { f: 'e', along: [iz0 + D, iz1 - D], fixed: [ix1 - D, ix1] },
        { f: 'w', along: [iz0 + D, iz1 - D], fixed: [ix0, ix0 + D] },
      ];
      for (const s of sides) {
        let a = s.along[0];
        while (a < s.along[1] - 6) {
          let w = 14 + rnd() * 18;
          if (s.along[1] - (a + w) < 10) w = s.along[1] - a;
          const gap = rnd() < 0.12 && w < s.along[1] - a - 1;
          if (!gap) {
            const h = hR[0] + rnd() * (hR[1] - hR[0]);
            const style = styleFor(b.type);
            const shopsFace = mid || rnd() < 0.5 ? [s.f] : null;
            if (s.f === 'n' || s.f === 's') addBuilding(a, s.fixed[0], a + w, s.fixed[1], h, style, { shops: shopsFace });
            else addBuilding(s.fixed[0], a, s.fixed[1], a + w, h, style, { shops: shopsFace });
          }
          a += w + (gap ? 0 : 0.01);
        }
      }
      return;
    }
    if (b.type === 'park') {
      this.locations.park = { pos: new THREE.Vector3(cx, 0, b.z0 - RW / 2 - 1), yaw: 0, name: 'Liberty Park' };
      // fountain
      detail.box(cx - 5, CURB, cz - 5, cx + 5, CURB + 0.7, cz + 5, { side: 0, top: 0, uS: 3, vS: 3 });
      world.addBox(cx - 5, 0, cz - 5, cx + 5, CURB + 0.7, cz + 5, { kind: 'wall' });
      detail.box(cx - 0.6, CURB, cz - 0.6, cx + 0.6, CURB + 2.5, cz + 0.6, { side: 0, top: 0 });
      b.fountain = new THREE.Vector3(cx, CURB + 2.5, cz);
      // paths
      slabs.flat(cx - 1.5, iz0, cx + 1.5, iz1, CURB + 0.006, 3, 3);
      slabs.flat(ix0, cz - 1.5, ix1, cz + 1.5, CURB + 0.006, 3, 3);
      b.trees = [];
      for (let k = 0; k < 40; k++) {
        const x = lerp(ix0 + 3, ix1 - 3, rnd()), z = lerp(iz0 + 3, iz1 - 3, rnd());
        if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
        b.trees.push([x, z]);
      }
      return;
    }
    if (b.type === 'plaza') {
      detail.box(cx - 7, CURB, cz - 7, cx + 7, CURB + 0.6, cz + 7, { side: 0, top: 0, uS: 3, vS: 3 });
      world.addBox(cx - 7, 0, cz - 7, cx + 7, CURB + 0.6, cz + 7, { kind: 'wall' });
      detail.box(cx - 1, CURB + 0.6, cz - 1, cx + 1, CURB + 6, cz + 1, { side: 0, top: 0 });
      world.addBox(cx - 1, 0, cz - 1, cx + 1, CURB + 6, cz + 1, { kind: 'wall' });
      b.fountain = new THREE.Vector3(cx, CURB + 0.9, cz);
      addBuilding(ix0, iz1 - 20, ix1, iz1, 22, 'office', { shops: ['s'] });
      b.trees = [];
      for (let k = 0; k < 8; k++) b.trees.push([cx + Math.cos(k * 0.785) * 18, cz + Math.sin(k * 0.785) * 18]);
      return;
    }
    // ---- flat lots ----
    const lot = new MeshBuilder(1);
    if (b.type === 'gas') {
      this.locations.gas = { pos: new THREE.Vector3(cx, 0, cz + 4), yaw: Math.PI / 2, name: 'Fuel Stop' };
      // canopy on 4 pillars
      const cw = 30, cd = 18;
      detail.box(cx - cw / 2, 5.2, cz - cd / 2, cx + cw / 2, 6.0, cz + cd / 2, { side: 2, top: 1 });
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = cx + px * (cw / 2 - 2), z = cz + pz * (cd / 2 - 2);
        detail.box(x - 0.3, 0, z - 0.3, x + 0.3, 5.2, z + 0.3, { side: 0, top: 0 });
        world.addBox(x - 0.3, 0, z - 0.3, x + 0.3, 5.2, z + 0.3, { kind: 'pillar' });
      }
      this.pumps = [];
      for (let k = 0; k < 3; k++) {
        const x = cx - 9 + k * 9, z = cz;
        detail.box(x - 1.2, 0, z - 0.4, x + 1.2, 0.25, z + 0.4, { side: 0, top: 0 });
        detail.box(x - 0.4, 0.25, z - 0.3, x + 0.4, 1.9, z + 0.3, { side: 2, top: 1 });
        world.addBox(x - 1.2, 0, z - 0.4, x + 1.2, 1.9, z + 0.4, { kind: 'pump' });
        this.pumps.push(new THREE.Vector3(x, 0, z + 3), new THREE.Vector3(x, 0, z - 3));
      }
      addBuilding(ix0 + 10, iz1 - 16, ix1 - 10, iz1 - 2, 5, 'modern', { base: 0, shops: ['s'] });
      this.signBoard(cx + 30, cz - 32, 'FUEL STOP', '#c21f1f', 8);
    } else if (b.type === 'garage') {
      this.locations.garage = { pos: new THREE.Vector3(cx, 0, cz - 8), yaw: Math.PI, name: 'San Demo Customs' };
      // workshop with an open bay facing south
      const gx0 = ix0 + 12, gx1 = ix1 - 12, gz0 = cz - 4, gz1 = iz1 - 6;
      addBuilding(gx0, gz1 - 2, gx1, gz1, 9, 'brick', { base: 0 });
      addBuilding(gx0, gz0, gx0 + 2, gz1, 9, 'brick', { base: 0 });
      addBuilding(gx1 - 2, gz0, gx1, gz1, 9, 'brick', { base: 0 });
      detail.box(gx0, 8.5, gz0, gx1, 9, gz1, { side: 1, top: 1 });
      world.addBox(gx0, 8.5, gz0, gx1, 9, gz1, { kind: 'roof' });
      this.garageZone = { x0: gx0 + 2, x1: gx1 - 2, z0: gz0, z1: gz1 - 2 };
      this.signBoard(cx, gz0 - 0.2, 'SAN DEMO CUSTOMS', '#1d1d1d', 10, 7, true);
    } else if (b.type === 'police') {
      this.locations.police = { pos: new THREE.Vector3(cx + 20, 0, cz - 20), yaw: 0, name: 'Police HQ' };
      addBuilding(ix0 + 6, iz1 - 28, ix1 - 6, iz1 - 4, 16, 'office', { base: 0 });
      this.signBoard(cx, iz1 - 28.2, 'SDPD', '#0f2a66', 7, 12, true);
      for (let k = 0; k < 6; k++) this.parkingSpots.push({ pos: new THREE.Vector3(ix0 + 12 + k * 6, 0, iz1 - 36), yaw: Math.PI, police: true });
    } else if (b.type === 'parking') {
      this.locations.parking = { pos: new THREE.Vector3(cx, 0, cz), yaw: 0, name: 'Parking Lot' };
      for (let row = 0; row < 4; row++)
        for (let k = 0; k < 12; k++) {
          const x = ix0 + 6 + k * 6.2, z = iz0 + 10 + row * 20;
          lot.strip(x - 3.1, z, 0, 1, 5.5, 0.15, 0.011, 0);
          if (rnd() < 0.45) this.parkingSpots.push({ pos: new THREE.Vector3(x, 0, z), yaw: row % 2 ? 0 : Math.PI });
        }
    } else if (b.type === 'construction') {
      this.locations.construction = { pos: new THREE.Vector3(cx, 0, cz), yaw: 0, name: 'Construction Site' };
      // dirt ground with jumps
      slabs.flat(ix0, iz0, ix1, iz1, 0.006, 4, 3);
      world.addSlab(ix0, iz0, ix1, iz1, 0.006, MATERIALS.dirt);
      this.ramp(cx - 15, cz - 10, 0, 7, 12, 0, 2.2, 'dirt');
      this.ramp(cx + 15, cz + 12, Math.PI, 7, 10, 0, 1.6, 'dirt');
      this.ramp(cx, cz + 25, Math.PI / 2, 6, 9, 0, 1.2, 'dirt');
      // half-built frame
      for (let k = 0; k < 4; k++) {
        const x = ix0 + 10 + k * 8;
        detail.box(x - 0.3, 0, iz1 - 12, x + 0.3, 14, iz1 - 11.4, { side: 1, top: 1 });
        world.addBox(x - 0.3, 0, iz1 - 12, x + 0.3, 14, iz1 - 11.4, { kind: 'pillar' });
      }
      detail.box(ix0 + 9, 13.6, iz1 - 12.2, ix0 + 35, 14.2, iz1 - 11.2, { side: 1, top: 1 });
      b.cones = true;
    }
    if (lot.pos.length) {
      const m = new THREE.Mesh(lot.build(), this.markingsMats[0]);
      this.group.add(m);
    }
  }

  signBoard(x, z, text, bg, w = 8, h = 6, flat = false) {
    const t = signTexture(text, bg);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    m.position.set(x, flat ? h : h, z);
    if (flat) m.rotation.y = Math.PI;
    this.group.add(m);
    this.nightMats.push({ mat: m.material, max: 1.2, min: 0.25 });
    if (!flat) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h, 8), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.4 }));
      pole.position.set(x, h / 2, z);
      this.group.add(pole);
      this.world.addCylinder(x, z, 0.2, 0, h, { kind: 'pole' });
    }
  }

  /** Visible + physical ramp. */
  ramp(cx, cz, yaw, width, length, h0, h1, mat = 'concrete') {
    const r = this.world.addRamp(cx, cz, yaw, width, length, h0, h1, mat === 'dirt' ? MATERIALS.dirt : mat === 'metal' ? MATERIALS.metal : MATERIALS.concrete);
    const g = new THREE.BufferGeometry();
    const hw = width / 2, hl = length / 2;
    // wedge: top slope, two side triangles, back wall
    const P = [
      [-hw, h0, -hl], [hw, h0, -hl], [hw, h1, hl], [-hw, h1, hl], // top
      [-hw, 0, -hl], [-hw, 0, hl], [hw, 0, hl], [hw, 0, -hl],
    ];
    const pos = [];
    const uv = [];
    const tri = (a, b, c, ua, ub, uc) => {
      pos.push(...P[a], ...P[b], ...P[c]);
      uv.push(...ua, ...ub, ...uc);
    };
    tri(0, 3, 2, [0, 0], [0, length / 3], [width / 3, length / 3]);
    tri(0, 2, 1, [0, 0], [width / 3, length / 3], [width / 3, 0]);
    // sides
    tri(4, 5, 3, [0, 0], [length / 3, 0], [length / 3, h1 / 3]);
    tri(4, 3, 0, [0, 0], [length / 3, h1 / 3], [0, h0 / 3]);
    tri(7, 1, 2, [0, 0], [0, h0 / 3], [length / 3, h1 / 3]);
    tri(7, 2, 6, [0, 0], [length / 3, h1 / 3], [length / 3, 0]);
    // back
    tri(5, 6, 2, [0, 0], [width / 3, 0], [width / 3, h1 / 3]);
    tri(5, 2, 3, [0, 0], [width / 3, h1 / 3], [0, h1 / 3]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const tex = mat === 'dirt' ? dirtTexture() : concreteTexture();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, color: mat === 'metal' ? 0x8a9099 : 0xffffff, metalness: mat === 'metal' ? 0.6 : 0 }));
    m.position.set(cx, 0, cz);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    // the high back edge is a wall
    if (h1 > 0.6) {
      const bx = cx + Math.sin(yaw) * hl, bz = cz + Math.cos(yaw) * hl;
      const ex = Math.abs(Math.cos(yaw)) * hw + Math.abs(Math.sin(yaw)) * 0.3;
      const ez = Math.abs(Math.sin(yaw)) * hw + Math.abs(Math.cos(yaw)) * 0.3;
      this.world.addBox(bx - ex, 0, bz - ez, bx + ex, h1 - 0.35, bz + ez, { kind: 'ramp' });
    }
    return r;
  }

  // ------------------------------------------------------------ proving grounds
  buildProvingGrounds() {
    const { x0, x1, z0, z1 } = PG;
    const cx = (x0 + x1) / 2;
    this.locations.proving = { pos: new THREE.Vector3(x0 + 25, 0, 0), yaw: Math.PI / 2, name: 'Proving Grounds' };
    // jumps
    this.ramp(x0 + 70, -120, Math.PI / 2, 8, 14, 0, 2.4);
    this.ramp(x0 + 120, -120, -Math.PI / 2, 8, 14, 0, 2.4);
    this.ramp(x0 + 90, 60, Math.PI / 2, 10, 26, 0, 5.5, 'metal');
    this.ramp(cx + 40, 60, -Math.PI / 2, 10, 30, 0, 4.5, 'metal');
    this.ramp(x0 + 60, 180, 0, 6, 8, 0, 1.2);
    this.ramp(x0 + 60, 205, 0, 6, 8, 0, 1.2);
    this.ramp(x0 + 60, 230, 0, 6, 8, 0, 1.2);
    // side-tilt ramp (two-wheel stunts)
    this.ramp(x0 + 160, 200, Math.PI / 2, 3, 12, 0, 1.3);
    // crash test wall
    const wx = x1 - 30;
    const mb = new MeshBuilder(1);
    mb.box(wx, 0, -40, wx + 4, 4, 40, { side: 0, top: 0, uS: 4, vS: 4 });
    world_addWall(this.world, wx, -40, wx + 4, 40, 4);
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 });
    const wall = new THREE.Mesh(mb.build(), [wallMat]);
    wall.castShadow = wall.receiveShadow = true;
    this.group.add(wall);
    this.crashWall = { x: wx, z0: -40, z1: 40 };
    // skid pad ring + drag strip lines
    const lines = new MeshBuilder(1);
    const pad = { x: cx + 10, z: -150, r: 35 };
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2, a2 = ((k + 1) / 64) * Math.PI * 2;
      const mx = pad.x + Math.cos((a + a2) / 2) * pad.r, mz = pad.z + Math.sin((a + a2) / 2) * pad.r;
      lines.strip(mx, mz, -Math.sin((a + a2) / 2), Math.cos((a + a2) / 2), (2 * Math.PI * pad.r) / 64, 0.3, 0.012, 0);
    }
    this.skidpad = pad;
    const dragX = x1 - 80;
    for (const o of [-4, 4]) lines.strip(dragX + o, 0, 0, 1, z1 - z0 - 40, 0.25, 0.012, 0);
    lines.strip(dragX, z0 + 40, 1, 0, 8, 0.6, 0.013, 0);
    lines.strip(dragX, z0 + 40 + 402, 1, 0, 8, 0.6, 0.013, 0);
    this.dragStrip = { x: dragX, start: z0 + 40, quarter: z0 + 40 + 402 };
    const lm = new THREE.Mesh(lines.build(), this.markingsMats[0]);
    this.group.add(lm);
    this.signBoard(x0 + 10, -20, 'PROVING GROUNDS', '#b8620b', 12);
    this.signBoard(dragX - 8, z0 + 38, 'DRAG STRIP', '#222', 8);
  }

  buildBoundary() {
    const L = 1300;
    for (const [a0, c0, a1, c1] of [[-L, -L - 5, L, -L], [-L, L, L, L + 5], [-L - 5, -L, -L, L], [L, -L, L + 5, L]]) this.world.addBox(a0, 0, c0, a1, 20, c1, { kind: 'wall' });
    // distant hills (visual only)
    const hills = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x51603f, roughness: 1, flatShading: true });
    const rnd = mulberry32(99);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const r = 1500 + rnd() * 400;
      const h = 80 + rnd() * 220;
      const m = new THREE.Mesh(new THREE.ConeGeometry(180 + rnd() * 200, h, 7), mat);
      m.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
      m.rotation.y = rnd() * 6;
      hills.add(m);
    }
    this.group.add(hills);
    this.hillsMat = mat;
  }

  /** Street-level spawn positions for traffic or the player. */
  randomLaneSpot(rnd = Math.random) {
    const s = this.segments[Math.floor(rnd() * this.segments.length)];
    const lane = rnd() < 0.5 ? 0 : 1;
    const d = 8 + rnd() * (s.length - 30);
    return { seg: s, lane, dist: d, pos: this.lanePoint(s, lane, d), yaw: Math.atan2(s.dir.x, s.dir.z) };
  }

  /** Is there a building or obstacle blocking the line of sight between two points? */
  lineOfSight(a, b) {
    return !this.world.blocked(a.x, a.z, b.x, b.z, 3);
  }

  setNight(f) {
    for (const n of this.nightMats) n.mat.emissiveIntensity = (n.min || 0) + f * (n.max - (n.min || 0));
  }

  setWetness(w) {
    for (const e of this.wetMats) {
      e.mat.roughness = lerp(e.dry, e.wet, w);
      e.mat.color.copy(e.dryColor).lerp(e.wetColor, w);
      e.mat.envMapIntensity = 0.3 + w * 1.2;
    }
  }
}

function world_addWall(world, x0, z0, x1, z1, h) {
  world.addBox(x0, 0, z0, x1, h, z1, { kind: 'wall', mat: MATERIALS.concrete });
}
