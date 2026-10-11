import * as THREE from 'three';
import { MATERIALS } from '../physics/world.js';
import { clamp, lerp, smoothstep, mulberry32, valueNoise } from '../core/util.js';
import { makeCanvas, canvasTexture } from '../core/canvas.js';
import { CITY_HALF, PG } from './city.js';
import { asphaltTexture, signTexture, dirtTexture } from './textures.js';

/**
 * The countryside around San Demo: a heightmap with hills, a mountain range
 * to the north crossed by a twisting canyon road, a coast highway that loops
 * around the proving grounds, a beach and the sea to the south.
 *
 * Physics samples a 2 m height grid bilinearly (exactly what the mesh shows),
 * with road surfaces flattened into it and a signed road-edge distance grid
 * for sharp asphalt/gravel/grass borders.
 */
export const HALF = 1280;
const RES = 2;
const NG = (HALF * 2) / RES + 1; // grid points per axis
export const SEA_LEVEL = -1.4;
export const HARBOR = { x0: -CITY_HALF, x1: 130, z0: CITY_HALF, z1: 520 };
export const DEALER = { x0: 252, x1: 336, z0: 346, z1: 408 };

const FLAT = [
  { x0: -CITY_HALF, x1: CITY_HALF, z0: -CITY_HALF, z1: CITY_HALF, mat: MATERIALS.asphalt },
  { x0: CITY_HALF - 1, x1: PG.x1, z0: PG.z0, z1: PG.z1, mat: MATERIALS.asphalt },
  { ...HARBOR, mat: MATERIALS.concrete },
  { ...DEALER, mat: MATERIALS.concrete },
];

/** Material codes stored in the grid. */
const M = [null, MATERIALS.grass, MATERIALS.dirt, MATERIALS.rock, MATERIALS.sand, MATERIALS.asphalt, MATERIALS.gravel, MATERIALS.concrete];
const GRASS = 1, DIRT = 2, ROCK = 3, SAND = 4;

function rectDist(r, x, z) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

function fbm(x, z, oct) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += valueNoise(x * f + i * 17.3, z * f - i * 9.1) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
function ridged(x, z, oct) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(valueNoise(x * f + i * 5.7, z * f + i * 3.3) * 2 - 1);
    s += v * v * a;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

/** Where the land meets the sea (z of the shoreline for a given x). */
export function shoreZ(x) {
  if (x >= HARBOR.x0 && x <= HARBOR.x1) return HARBOR.z1;
  return 572 + 26 * Math.sin(x * 0.0061) + 12 * Math.sin(x * 0.017 + 2);
}

/** Terrain height before roads are cut in. */
function naturalHeight(x, z) {
  let d = Infinity;
  for (const r of FLAT) d = Math.min(d, rectDist(r, x, z));
  // coastal plain south of the city
  d = Math.min(d, Math.max(0, 420 - z));
  const ramp = smoothstep(18, 230, d);
  let h = 0;
  if (ramp > 0) {
    const hills = 14 + 26 * (fbm(x * 0.0024, z * 0.0024, 5) - 0.45) * 2;
    const mk = smoothstep(-330, -1060, z);
    const mount = mk > 0 ? mk * (95 + 85 * ridged(x * 0.0028 + 3, z * 0.0028, 4)) : 0;
    h = Math.max(0, hills + mount) * ramp;
  }
  if (d > 4) h += (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 1.4 * smoothstep(4, 40, d); // small undulation
  const s = z - shoreZ(x);
  // boundary ridge (land sides)
  const edge = smoothstep(980, 1240, Math.max(Math.abs(x), -z)) * (1 - smoothstep(-200, 0, s));
  if (edge > 0) h += edge * (150 + 40 * fbm(x * 0.01, z * 0.01, 2));
  // beach and seabed
  if (s > -60) {
    if (x >= HARBOR.x0 - 2 && x <= HARBOR.x1 + 2) {
      if (s > 0) h = -9;
    } else if (s < -35) h = lerp(h, 0.2, smoothstep(-60, -35, s));
    else if (s < 0) h = lerp(0.2, SEA_LEVEL - 0.5, smoothstep(-35, 0, s));
    else h = lerp(SEA_LEVEL - 0.5, -9, smoothstep(0, 140, s));
  }
  return h;
}

// ------------------------------------------------------------------ roads
const ROADS = [
  {
    id: 'canyon',
    name: 'Canyon Rd',
    hw: 4.0,
    centre: 'double',
    pts: [[110, -337], [110, -372], [117, -420], [150, -470], [230, -520], [290, -590], [292, -660], [242, -706], [160, -714], [72, -692], [2, -716], [-34, -782], [-10, -852], [55, -906], [72, -966], [22, -1012], [-70, -1024], [-160, -1004], [-250, -966], [-330, -906], [-382, -820], [-452, -736], [-540, -652], [-592, -546], [-582, -440], [-522, -362], [-482, -282], [-470, -196], [-434, -132], [-382, -111], [-337, -110]],
  },
  {
    id: 'coast',
    name: 'Coast Hwy',
    hw: 4.6,
    centre: 'dashed',
    pts: [[220, 337], [220, 372], [240, 420], [318, 446], [480, 455], [640, 452], [792, 432], [880, 382], [918, 282], [906, 120], [918, -60], [906, -240], [862, -370], [772, -424], [620, -430], [470, -414], [330, -398], [248, -384], [222, -366], [220, -337]],
  },
  {
    id: 'trail',
    name: 'Forest Trail',
    hw: 3.0,
    centre: 'none',
    surface: 'dirt',
    grade: 0.14,
    smooth: 18,
    pts: [[-487, -238], [-530, -236], [-590, -222], [-648, -178], [-700, -96], [-752, -22], [-842, 34], [-918, 128], [-905, 236], [-836, 316], [-772, 372], [-744, 440], [-728, 500]],
  },
];

function catmull(points, spacing) {
  const P = points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal', 0.5);
  const n = Math.max(2, Math.round(curve.getLength() / spacing));
  return curve.getSpacedPoints(n);
}

function smoothArr(a, r) {
  const n = a.length, out = new Float32Array(n);
  let s = 0, c = 0;
  // running box filter
  for (let i = 0; i < Math.min(r, n); i++) { s += a[i]; c++; }
  for (let i = 0; i < n; i++) {
    const add = i + r, rem = i - r - 1;
    if (add < n) { s += a[add]; c++; }
    if (rem >= 0) { s -= a[rem]; c--; }
    out[i] = s / c;
  }
  return out;
}

export class Terrain {
  constructor(scene, world, city) {
    this.scene = scene;
    this.world = world;
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.H = new Float32Array(NG * NG);
    this.mat = new Uint8Array(NG * NG);
    this.edge = new Float32Array(NG * NG).fill(99); // signed distance to the nearest road edge
    this.roads = [];
    this.chunks = [];
    this.wetMats = [];
    this.locations = {};
    this.time = 0;
    this.half = HALF;
    this.seaLevel = SEA_LEVEL;
  }

  /** Human name for a place outside the city grid. */
  regionName(p) {
    const H = HARBOR;
    if (p.x >= H.x0 && p.x <= H.x1 && p.z >= H.z0 - 2 && p.z <= H.z1 + 40) return 'Port of San Demo';
    if (this.waterAt(p.x, p.z) > -Infinity && p.y < SEA_LEVEL + 3) return 'San Demo Bay';
    if (this.lookout && Math.hypot(p.x - this.lookout.pos.x, p.z - this.lookout.pos.z) < 45) return 'Demo Peak Lookout';
    if (this.edgeAt(p.x, p.z) < 6) {
      const r = this.nearestRoad(p.x, p.z);
      if (r && r.dist < r.road.hw + 8) return r.road.name;
    }
    if (this.isSand(p.x, p.z)) return 'Demo Beach';
    if (p.z < -560) return 'Demo Mountains';
    if (p.x < -420) return 'West Hills';
    if (p.x > 790) return 'East Hills';
    if (p.z > 380) return 'Coastal Flats';
    return 'Outskirts';
  }

  isSand(x, z) {
    return z - shoreZ(x) > -46 && !(x >= HARBOR.x0 && x <= HARBOR.x1 && z >= HARBOR.z0 - 2);
  }

  build() {
    this.buildHeights();
    this.buildRoads();
    this.buildLookout();
    this.classify();
    this.buildMesh();
    this.buildRoadMeshes();
    this.buildGuardrails();
    this.buildTrees();
    this.buildSea();
    this.buildSigns();
    return this;
  }

  // ------------------------------------------------------------ height grid
  buildHeights() {
    const H = this.H;
    // natural heights at 4 m, bilinearly upsampled (fbm is the expensive part)
    const C = (NG - 1) / 2 + 1;
    const coarse = new Float32Array(C * C);
    for (let j = 0; j < C; j++)
      for (let i = 0; i < C; i++) coarse[j * C + i] = naturalHeight(-HALF + i * 4, -HALF + j * 4);
    for (let j = 0; j < NG; j++)
      for (let i = 0; i < NG; i++) {
        const ci = i >> 1, cj = j >> 1;
        const fi = (i & 1) * 0.5, fj = (j & 1) * 0.5;
        const i1 = Math.min(C - 1, ci + 1), j1 = Math.min(C - 1, cj + 1);
        const a = coarse[cj * C + ci], b = coarse[cj * C + i1], c = coarse[j1 * C + ci], d = coarse[j1 * C + i1];
        H[j * NG + i] = lerp(lerp(a, b, fi), lerp(c, d, fi), fj);
      }
    // the shoreline needs full resolution so the beach is smooth
    for (let j = 0; j < NG; j++) {
      const z = -HALF + j * RES;
      if (z < 380) continue;
      for (let i = 0; i < NG; i++) {
        if (!(i & 1) && !(j & 1)) continue;
        const x = -HALF + i * RES;
        if (Math.abs(z - shoreZ(x)) < 90) H[j * NG + i] = naturalHeight(x, z);
      }
    }
    // the flat zones are exactly level
    for (const r of FLAT) this.fillRect(r.x0, r.z0, r.x1, r.z1, 0);
  }

  fillRect(x0, z0, x1, z1, h) {
    const i0 = Math.max(0, Math.ceil((x0 + HALF) / RES)), i1 = Math.min(NG - 1, Math.floor((x1 + HALF) / RES));
    const j0 = Math.max(0, Math.ceil((z0 + HALF) / RES)), j1 = Math.min(NG - 1, Math.floor((z1 + HALF) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.H[j * NG + i] = h;
  }

  rawHeight(x, z) {
    const fx = clamp((x + HALF) / RES, 0, NG - 1.001), fz = clamp((z + HALF) / RES, 0, NG - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.H, k = j * NG + i;
    return lerp(lerp(H[k], H[k + 1], u), lerp(H[k + NG], H[k + NG + 1], u), v);
  }

  // ------------------------------------------------------------ roads
  buildRoads() {
    const H = this.H;
    const best = new Float32Array(NG * NG).fill(1e9); // distance to the closest road centre
    const target = new Float32Array(NG * NG);
    this.roadId = new Uint8Array(NG * NG);
    for (const [ri, def] of ROADS.entries()) {
      const pts = catmull(def.pts, 1);
      const n = pts.length;
      const nat = new Float32Array(n);
      for (let i = 0; i < n; i++) nat[i] = this.rawHeight(pts[i].x, pts[i].z);
      // smooth, pin the ends to the city, limit the grade, smooth again
      const sm = def.smooth || 45;
      let h = smoothArr(smoothArr(nat, sm), sm);
      const pin = (i) => {
        const p = pts[i];
        return FLAT.some((r) => rectDist(r, p.x, p.z) < 6);
      };
      for (let i = 0; i < n; i++) if (pin(i)) h[i] = 0;
      const g = def.grade || 0.095;
      for (let i = 1; i < n; i++) h[i] = clamp(h[i], h[i - 1] - g, h[i - 1] + g);
      for (let i = n - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - g, h[i + 1] + g);
      // branch roads meet the road they join at the same height
      for (const end of [0, n - 1]) {
        const pe = pts[end];
        for (const other of this.roads) {
          let bd = 400, by = null;
          for (const q of other.pts) {
            const d2 = (q.x - pe.x) ** 2 + (q.z - pe.z) ** 2;
            if (d2 < bd) {
              bd = d2;
              by = q.y;
            }
          }
          if (by !== null) {
            h[end] = by;
            const dir = end === 0 ? 1 : -1;
            for (let k = 1; k < n; k++) {
              const i = end + dir * k, pi = i - dir;
              const lim = clamp(h[i], h[pi] - g, h[pi] + g);
              if (lim === h[i]) break;
              h[i] = lim;
            }
          }
        }
      }
      h = smoothArr(h, 12);
      for (let i = 0; i < n; i++) if (pin(i)) h[i] = 0;
      for (let i = 0; i < n; i++) pts[i].y = h[i];
      // tangents / right vectors (car convention: right = (-dz, 0, dx))
      const dir = [], right = [], s = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        dir.push(d);
        right.push(new THREE.Vector3(-d.z, 0, d.x));
        if (i) s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      }
      const road = { ...def, pts, dir, right, s, length: s[n - 1], h };
      this.roads.push(road);
      // rasterize: nearest road centre per grid point
      const R = def.hw + 34;
      for (let k = 0; k < n; k++) {
        const p = pts[k];
        const i0 = Math.max(0, Math.floor((p.x - R + HALF) / RES)), i1 = Math.min(NG - 1, Math.ceil((p.x + R + HALF) / RES));
        const j0 = Math.max(0, Math.floor((p.z - R + HALF) / RES)), j1 = Math.min(NG - 1, Math.ceil((p.z + R + HALF) / RES));
        for (let j = j0; j <= j1; j++) {
          const gz = -HALF + j * RES - p.z;
          for (let i = i0; i <= i1; i++) {
            const gx = -HALF + i * RES - p.x;
            const d = Math.sqrt(gx * gx + gz * gz);
            const idx = j * NG + i;
            // compare by distance to the edge so the wider road wins at junctions
            if (d - def.hw < best[idx]) {
              best[idx] = d - def.hw;
              target[idx] = p.y;
              this.roadId[idx] = ri + 1;
            }
          }
        }
      }
    }
    // blend terrain toward the road surface with cut/fill slopes
    for (let idx = 0; idx < NG * NG; idx++) {
      const e = best[idx];
      if (e > 40) continue;
      this.edge[idx] = e;
      const nat = H[idx];
      const dh = target[idx] - nat; // >0: fill (road above ground)
      const bank = clamp(2.5 + Math.abs(dh) * (dh > 0 ? 1.5 : 0.85), 2.5, 32);
      const w = 1 - smoothstep(1.6, 1.6 + bank, e);
      H[idx] = lerp(nat, target[idx], w);
    }
    for (const r of FLAT) this.fillRect(r.x0, r.z0, r.x1, r.z1, 0);
  }

  /** Nearest point on any road: { road, i, dist, side } (side > 0 = right of travel). */
  nearestRoad(x, z) {
    let best = null;
    for (const r of this.roads) {
      const P = r.pts;
      for (let i = 0; i < P.length; i += 3) {
        const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2;
        if (!best || d < best.d2) best = { road: r, i, d2: d };
      }
    }
    if (!best) return null;
    const r = best.road;
    for (let i = Math.max(0, best.i - 3); i <= Math.min(r.pts.length - 1, best.i + 3); i++) {
      const d = (r.pts[i].x - x) ** 2 + (r.pts[i].z - z) ** 2;
      if (d < best.d2) { best.d2 = d; best.i = i; }
    }
    const p = r.pts[best.i], rt = r.right[best.i];
    return { road: r, i: best.i, dist: Math.sqrt(best.d2), side: (x - p.x) * rt.x + (z - p.z) * rt.z };
  }

  // ------------------------------------------------------------ materials
  classify() {
    const H = this.H, Mt = this.mat;
    for (let j = 0; j < NG; j++) {
      const z = -HALF + j * RES;
      for (let i = 0; i < NG; i++) {
        const x = -HALF + i * RES;
        const idx = j * NG + i;
        const hx = H[j * NG + Math.min(NG - 1, i + 1)] - H[j * NG + Math.max(0, i - 1)];
        const hz = H[Math.min(NG - 1, j + 1) * NG + i] - H[Math.max(0, j - 1) * NG + i];
        const slope = Math.hypot(hx, hz) / (2 * RES);
        const h = H[idx];
        const s = z - shoreZ(x);
        let m = GRASS;
        const n = valueNoise(x * 0.03, z * 0.03);
        if (s > -46) m = SAND;
        else if (slope > 0.62 || h > 175) m = ROCK;
        else if (slope > 0.36 || n > 0.78) m = DIRT;
        Mt[idx] = m;
      }
    }
  }

  /** Physics query. Fills out.y / normal / mat. */
  sample(x, z, out) {
    // paved flat zones: city, proving grounds, harbor
    for (let k = 0; k < FLAT.length; k++) {
      const r = FLAT[k];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
        out.y = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.mat = r.mat;
        return out;
      }
    }
    const fx = (x + HALF) / RES, fz = (z + HALF) / RES;
    if (fx < 0 || fz < 0 || fx >= NG - 1 || fz >= NG - 1) {
      out.y = -9; out.nx = 0; out.ny = 1; out.nz = 0; out.mat = MATERIALS.sand;
      return out;
    }
    const i = fx | 0, j = fz | 0;
    const u = fx - i, v = fz - j;
    const H = this.H, k = j * NG + i;
    const a = H[k], b = H[k + 1], c = H[k + NG], d = H[k + NG + 1];
    out.y = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    const dx = ((b - a) * (1 - v) + (d - c) * v) / RES;
    const dz = ((c - a) * (1 - u) + (d - b) * u) / RES;
    const inv = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    out.nx = -dx * inv; out.ny = inv; out.nz = -dz * inv;
    const E = this.edge;
    const e = (E[k] * (1 - u) + E[k + 1] * u) * (1 - v) + (E[k + NG] * (1 - u) + E[k + NG + 1] * u) * v;
    if (e < 1.4) {
      const rid = this.roadId[(u < 0.5 ? i : i + 1) + (v < 0.5 ? j : j + 1) * NG];
      const dirt = rid && this.roads[rid - 1].surface === 'dirt';
      out.mat = e < 0 ? (dirt ? MATERIALS.dirt : MATERIALS.asphalt) : MATERIALS.gravel;
    }
    else out.mat = M[this.mat[(u < 0.5 ? i : i + 1) + (v < 0.5 ? j : j + 1) * NG]] || MATERIALS.grass;
    return out;
  }

  heightAt(x, z) {
    return this.sample(x, z, _s).y;
  }

  /** Water surface height at (x, z), or -Infinity where there is no water. */
  waterAt(x, z) {
    if (z < 380) return -Infinity;
    return this.heightAt(x, z) < SEA_LEVEL ? SEA_LEVEL : -Infinity;
  }

  // ------------------------------------------------------------ terrain mesh
  buildMesh() {
    const detail = detailTexture();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 });
    this.material = mat;
    this.wetMats.push({ mat, dry: 0.96, wet: 0.45, dryColor: new THREE.Color(0xffffff), wetColor: new THREE.Color(0xa8aaa6) });
    const CH = 256, NC = (HALF * 2) / CH;
    const lods = [4, 16, 32];
    for (let cj = 0; cj < NC; cj++)
      for (let ci = 0; ci < NC; ci++) {
        const x0 = -HALF + ci * CH, z0 = -HALF + cj * CH;
        // skip chunks entirely under the city / proving ground pavement
        if (FLAT.slice(0, 2).some((r) => x0 >= r.x0 && x0 + CH <= r.x1 && z0 >= r.z0 && z0 + CH <= r.z1)) continue;
        const chunk = { cx: x0 + CH / 2, cz: z0 + CH / 2, meshes: [], lod: -1 };
        for (const step of lods) {
          const m = new THREE.Mesh(this.chunkGeometry(x0, z0, CH, step), mat);
          m.receiveShadow = step === 4;
          m.visible = false;
          m.matrixAutoUpdate = false;
          m.updateMatrix();
          this.group.add(m);
          chunk.meshes.push(m);
        }
        this.chunks.push(chunk);
      }
  }

  chunkGeometry(x0, z0, size, step) {
    const n = size / step + 1;
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    const g = (x, z) => this.rawHeight(x, z);
    const c = new THREE.Color();
    const hidden = (x, z, m) => FLAT.some((r) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        let y = g(x, z);
        if (FLAT.some((r) => x >= r.x0 - 0.01 && x <= r.x1 + 0.01 && z >= r.z0 - 0.01 && z <= r.z1 + 0.01)) y = Math.min(y, -0.08);
        pos.push(x, y, z);
        const e = Math.max(RES, step);
        const nx = g(x - e, z) - g(x + e, z), nz = g(x, z - e) - g(x, z + e);
        const l = Math.hypot(nx, 2 * e, nz);
        nrm.push(nx / l, (2 * e) / l, nz / l);
        this.vertexColor(x, z, y, (2 * e) / l, c);
        col.push(c.r, c.g, c.b);
        uv.push(x / 7, z / 7);
      }
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
        if (hidden(cx, cz, step)) continue;
        const a = j * n + i, b = a + n, cc = a + 1, d = b + 1;
        idx.push(a, b, cc, cc, b, d);
      }
    // skirts hide the cracks between neighbouring LODs
    const drop = step * 0.6 + 1;
    const edges = [
      Array.from({ length: n }, (_, i) => i),
      Array.from({ length: n }, (_, i) => (n - 1) * n + i),
      Array.from({ length: n }, (_, j) => j * n),
      Array.from({ length: n }, (_, j) => j * n + n - 1),
    ];
    const flip = [true, false, false, true];
    edges.forEach((e, ei) => {
      const base = pos.length / 3;
      for (const v of e) {
        pos.push(pos[v * 3], pos[v * 3 + 1] - drop, pos[v * 3 + 2]);
        nrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
        uv.push(uv[v * 2], uv[v * 2 + 1]);
      }
      for (let k = 0; k < e.length - 1; k++) {
        const a = e[k], b = e[k + 1], a2 = base + k, b2 = base + k + 1;
        if (flip[ei]) idx.push(a, a2, b, b, a2, b2);
        else idx.push(a, b, a2, b, b2, a2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  vertexColor(x, z, y, ny, out) {
    const S = THREE.SRGBColorSpace;
    const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(ny, 0.05);
    const n1 = valueNoise(x * 0.012, z * 0.012), n2 = valueNoise(x * 0.07 + 5, z * 0.07);
    const s = z - shoreZ(x);
    // grass: lush in the lowlands, drier and yellower up the mountain
    const dry = smoothstep(30, 140, y) * 0.65 + n1 * 0.35;
    const v = 0.88 + n2 * 0.24;
    out.setRGB(lerp(0.33, 0.52, dry) * v, lerp(0.45, 0.5, dry) * v, lerp(0.2, 0.27, dry) * v, S);
    // dirt patches and steep ground
    const dirt = Math.max(smoothstep(0.3, 0.48, slope), smoothstep(0.72, 0.85, valueNoise(x * 0.03, z * 0.03)) * 0.8);
    if (dirt > 0) out.lerp(_c.setRGB(0.47, 0.38, 0.28, S), dirt);
    const rock = Math.max(smoothstep(0.52, 0.8, slope), smoothstep(160, 200, y));
    if (rock > 0) out.lerp(_c.setRGB(0.42 + n2 * 0.08, 0.39 + n2 * 0.07, 0.35 + n2 * 0.06, S), rock);
    // road shoulders
    const e = this.edgeAt(x, z);
    if (e < 3) out.lerp(_c.setRGB(0.45, 0.43, 0.4, S), 1 - smoothstep(1, 3, e));
    // sand, wet sand and seabed
    if (s > -56) {
      const sand = smoothstep(-56, -42, s);
      _c.setRGB(0.8, 0.72, 0.56, S);
      if (y < SEA_LEVEL + 0.6) _c.lerp(_c2.setRGB(0.6, 0.53, 0.4, S), smoothstep(SEA_LEVEL + 0.6, SEA_LEVEL - 0.2, y));
      if (y < SEA_LEVEL - 0.5) _c.lerp(_c2.setRGB(0.2, 0.33, 0.33, S), smoothstep(SEA_LEVEL - 0.5, -8, y));
      out.lerp(_c, sand);
    }
  }

  edgeAt(x, z) {
    const fx = clamp((x + HALF) / RES, 0, NG - 1), fz = clamp((z + HALF) / RES, 0, NG - 1);
    return this.edge[Math.round(fz) * NG + Math.round(fx)];
  }

  // ------------------------------------------------------------ road meshes
  buildRoadMeshes() {
    const tex = asphaltTexture();
    const amat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.wetMats.push({ mat: amat, dry: 0.9, wet: 0.22, dryColor: new THREE.Color(0xffffff), wetColor: new THREE.Color(0x9a9ca0) });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b21e, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.wetMats.push({ mat: white, dry: 0.7, wet: 0.2, dryColor: new THREE.Color(0xe8e6de), wetColor: new THREE.Color(0xbcbab2) });
    const dmat = new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 1, color: 0xc8b9a2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.wetMats.push({ mat: dmat, dry: 1, wet: 0.5, dryColor: new THREE.Color(0xc8b9a2), wetColor: new THREE.Color(0x7d7062) });
    for (const r of this.roads) {
      const { pts, right, s, hw } = r;
      const n = pts.length;
      const dirt = r.surface === 'dirt';
      // ribbon (sampled from the physics surface so wheels and mesh agree)
      const offs = [-hw - 0.4, -hw, -hw * 0.5, 0, hw * 0.5, hw, hw + 0.4];
      const pos = [], uv = [], idx = [];
      const step = 2;
      let rows = 0;
      for (let i = 0; i < n; i += step) {
        const p = pts[i], rt = right[i];
        for (let k = 0; k < offs.length; k++) {
          const x = p.x + rt.x * offs[k], z = p.z + rt.z * offs[k];
          const y = (Math.abs(offs[k]) <= hw ? p.y : this.rawHeight(x, z)) + 0.035;
          pos.push(x, y, z);
          uv.push((offs[k] + hw) / 6, s[i] / 6);
        }
        rows++;
      }
      const W = offs.length;
      for (let j = 0; j < rows - 1; j++)
        for (let k = 0; k < W - 1; k++) {
          const a = j * W + k, b = a + 1, c = a + W, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      fixWinding(geo);
      const mesh = new THREE.Mesh(geo, dirt ? dmat : amat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (dirt) continue;
      // markings
      const wb = [], yb = [];
      const strip = (arr, i0, i1, off, w) => {
        for (let i = i0; i < i1; i += 1) {
          const p = pts[i], q = pts[i + 1], rt = right[i], rq = right[i + 1];
          const y0 = p.y + 0.05, y1 = q.y + 0.05;
          const a = [p.x + rt.x * (off - w), y0, p.z + rt.z * (off - w)];
          const b = [p.x + rt.x * (off + w), y0, p.z + rt.z * (off + w)];
          const c = [q.x + rq.x * (off + w), y1, q.z + rq.z * (off + w)];
          const d = [q.x + rq.x * (off - w), y1, q.z + rq.z * (off - w)];
          arr.push(...a, ...b, ...c, ...a, ...c, ...d);
        }
      };
      const st = 8, en = n - 9;
      for (const side of [-1, 1]) strip(wb, st, en, side * (hw - 0.35), 0.075);
      if (r.centre === 'double') {
        for (const o of [-0.13, 0.13]) strip(yb, st, en, o, 0.055);
      } else {
        for (let i = st; i < en - 4; i += 12) strip(yb, i, Math.min(en, i + 5), 0, 0.07);
      }
      for (const [arr, m] of [[wb, white], [yb, yellow]]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        g.computeVertexNormals();
        fixWinding(g);
        this.group.add(new THREE.Mesh(g, m));
      }
    }
  }

  // ------------------------------------------------------------ guardrails
  buildGuardrails() {
    const posts = [];
    const rails = [];
    for (const r of this.roads) {
      if (r.surface === 'dirt') continue;
      const { pts, right, hw } = r;
      const n = pts.length;
      for (const side of [-1, 1]) {
        const flags = new Uint8Array(n);
        for (let i = 30; i < n - 30; i += 2) {
          const p = pts[i], rt = right[i];
          let drop = 0;
          for (const o of [hw + 4, hw + 8]) drop = Math.max(drop, p.y - this.rawHeight(p.x + rt.x * o * side, p.z + rt.z * o * side));
          if (drop > 1.6) flags[i] = 1;
        }
        // close small gaps and drop short runs
        for (let i = 0; i < n; i++) if (flags[i]) for (let k = 2; k <= 14; k += 2) if (flags[i + k]) { for (let q = 1; q < k; q++) flags[i + q] = 1; break; }
        let runStart = -1;
        for (let i = 0; i <= n; i++) {
          const on = i < n && flags[i];
          if (on && runStart < 0) runStart = i;
          if (!on && runStart >= 0) {
            if (i - runStart >= 14) rails.push({ r, side, a: Math.max(30, runStart - 6), b: Math.min(n - 31, i + 6) });
            runStart = -1;
          }
        }
      }
    }
    const beamPos = [];
    for (const run of rails) {
      const { r, side, a, b } = run;
      const off = side * (r.hw + 0.9);
      for (let i = a; i <= b; i++) {
        const p = r.pts[i], rt = r.right[i];
        const x = p.x + rt.x * off, z = p.z + rt.z * off;
        if ((i - a) % 2 === 0) {
          posts.push(x, p.y, z);
          this.world.addCylinder(x, z, 0.24, p.y - 0.8, p.y + 0.85, { kind: 'rail', mat: MATERIALS.metal });
        }
        if (i < b) {
          const q = r.pts[i + 1], rq = r.right[i + 1];
          const x2 = q.x + rq.x * off, z2 = q.z + rq.z * off;
          for (const [y0, y1] of [[0.48, 0.8]]) {
            const a0 = [x, p.y + y0, z], a1 = [x, p.y + y1, z], b0 = [x2, q.y + y0, z2], b1 = [x2, q.y + y1, z2];
            beamPos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
          }
        }
      }
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xb7bcc2, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(beamPos, 3));
    g.computeVertexNormals();
    const beam = new THREE.Mesh(g, steel);
    beam.castShadow = true;
    this.group.add(beam);
    const pg = new THREE.BoxGeometry(0.12, 1.0, 0.16);
    pg.translate(0, 0.3, 0);
    const im = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.6, roughness: 0.5 }), posts.length / 3);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < posts.length / 3; i++) {
      m4.makeTranslation(posts[i * 3], posts[i * 3 + 1], posts[i * 3 + 2]);
      im.setMatrixAt(i, m4);
    }
    im.castShadow = true;
    this.group.add(im);
    this.railCount = posts.length / 3;
  }

  // ------------------------------------------------------------ lookout
  buildLookout() {
    const r = this.roads[0];
    let hi = 0;
    for (let i = 0; i < r.pts.length; i++) if (r.pts[i].y > r.pts[hi].y) hi = i;
    const p = r.pts[hi], rt = r.right[hi], d = r.dir[hi];
    // the side facing the city (south / +z)
    const side = rt.z > 0 ? 1 : -1;
    const c = new THREE.Vector3(p.x + rt.x * side * (r.hw + 10), p.y, p.z + rt.z * side * (r.hw + 10));
    const yaw = Math.atan2(d.x, d.z);
    // flatten a 34 x 20 pad (local axes: along road, away from road)
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const R = 34;
    const i0 = Math.floor((c.x - R + HALF) / RES), i1 = Math.ceil((c.x + R + HALF) / RES);
    const j0 = Math.floor((c.z - R + HALF) / RES), j1 = Math.ceil((c.z + R + HALF) / RES);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * RES - c.x, z = -HALF + j * RES - c.z;
        const u = x * sin + z * cos; // along road
        const v = (x * cos - z * sin) * -1; // across
        const du = Math.max(0, Math.abs(u) - 17), dv = Math.max(0, Math.abs(v) - 10);
        const e = Math.hypot(du, dv);
        const idx = j * NG + i;
        const w = 1 - smoothstep(0, 9, e);
        this.H[idx] = lerp(this.H[idx], p.y, w);
        if (e < 0.5) this.edge[idx] = Math.min(this.edge[idx], -0.5);
      }
    this.lookout = { pos: c.clone(), yaw, side, roadIndex: hi, view: new THREE.Vector3(c.x + rt.x * side * 30, p.y, c.z + rt.z * side * 30) };
    this.locations.lookout = this.lookout;
    // low stone wall on the far edge, benches, binoculars and a sign
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b847a, roughness: 0.9 });
    const along = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const out = new THREE.Vector3(rt.x * side, 0, rt.z * side);
    for (let k = -16; k <= 16; k += 2) {
      const wx = c.x + along.x * k + out.x * 10, wz = c.z + along.z * k + out.z * 10;
      this.world.addCylinder(wx, wz, 0.55, p.y - 1, p.y + 0.7, { kind: 'wall', mat: MATERIALS.concrete });
    }
    const asph = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.wetMats.push({ mat: asph, dry: 0.9, wet: 0.22, dryColor: new THREE.Color(0xffffff), wetColor: new THREE.Color(0x9a9ca0) });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(20, 34).rotateX(-Math.PI / 2), asph);
    pad.position.set(c.x, p.y + 0.03, c.z);
    pad.rotation.y = yaw;
    pad.receiveShadow = true;
    this.group.add(pad);
    const wallW = new THREE.Mesh(new THREE.BoxGeometry(34, 0.75, 0.6), stone);
    wallW.position.set(c.x + out.x * 10, p.y + 0.37, c.z + out.z * 10);
    wallW.rotation.y = Math.atan2(out.x, out.z);
    wallW.castShadow = wallW.receiveShadow = true;
    this.group.add(wallW);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 });
    for (const k of [-8, 0, 8]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.5), wood);
      b.position.set(c.x + along.x * k + out.x * 7.5, p.y + 0.48, c.z + along.z * k + out.z * 7.5);
      b.rotation.y = Math.atan2(out.x, out.z);
      this.group.add(b);
    }
    // coin binoculars
    const bin = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3f6e5a, metalness: 0.5, roughness: 0.4 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.2, 8), metal);
    post.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), metal);
    head.position.y = 1.3;
    bin.add(post, head);
    bin.position.set(c.x + along.x * 4 + out.x * 9, p.y, c.z + along.z * 4 + out.z * 9);
    bin.rotation.y = Math.atan2(out.x, out.z);
    this.group.add(bin);
    this.lookoutSign = [c.x - along.x * 14 - out.x * 6, c.z - along.z * 14 - out.z * 6, p.y, yaw + Math.PI / 2];
  }

  // ------------------------------------------------------------ trees & rocks
  buildTrees() {
    const rnd = mulberry32(4242);
    const pines = [], rounds = [], rocks = [];
    for (let k = 0; k < 26000 && pines.length + rounds.length < 4200; k++) {
      const x = -HALF + 20 + rnd() * (HALF * 2 - 40), z = -HALF + 20 + rnd() * (HALF * 2 - 40);
      if (FLAT.some((r) => rectDist(r, x, z) < 22)) continue;
      if (z - shoreZ(x) > -70) continue;
      const e = this.edgeAt(x, z);
      if (e < 5) continue;
      this.sample(x, z, _s);
      if (_s.ny < 0.86 || _s.mat === MATERIALS.sand) {
        if (_s.ny < 0.8 && rnd() < 0.15) rocks.push([x, _s.y, z, 0.8 + rnd() * 2.4]);
        continue;
      }
      // forests in noise patches, denser up the hills
      const f = fbm(x * 0.006, z * 0.006, 3);
      if (f < 0.52 - smoothstep(0, 80, _s.y) * 0.1 && rnd() > 0.08) continue;
      const sc = 0.75 + rnd() * 0.7;
      const t = [x, _s.y, z, sc, rnd() * 6.28, 0];
      (_s.y > 40 || rnd() < 0.55 ? pines : rounds).push(t);
      if (e < 40 || rnd() < 0.5) {
        this.world.addCylinder(x, z, 0.32 * sc, _s.y - 1, _s.y + 6, { kind: 'tree', mat: MATERIALS.wood });
        t[5] = 1; // solid: always drawn, whatever the tree-density setting
      }
    }
    // trunk + crown merged into one vertex-coloured geometry per species
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    const pine = mergeGeos([[trunk, 0x5a4330], [coneAt(2.2, 4.2, 2.2), 0x3b5f35], [coneAt(1.7, 3.4, 4.0), 0x42683a], [coneAt(1.1, 2.6, 5.6), 0x4a7240]]);
    const ball = new THREE.IcosahedronGeometry(2.3, 1);
    ball.scale(1, 0.9, 1);
    ball.translate(0, 3.6, 0);
    const round = mergeGeos([[trunk, 0x5a4330], [ball, 0x5a7d38]]);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.treeMat = treeMat; // snow frosts it
    // trees sway in the wind (vertex shader: bend increases with height)
    this.windUniforms = { uWindT: { value: 0 }, uWind: { value: new THREE.Vector2() } };
    treeMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.windUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindT; uniform vec2 uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          float bend = max(0.0, position.y - 1.0) * 0.012;
          float ph = uWindT * 1.7 + ip.x * 0.11 + ip.z * 0.07;
          transformed.x += uWind.x * bend * (0.6 + 0.4 * sin(ph));
          transformed.z += uWind.y * bend * (0.6 + 0.4 * sin(ph * 1.3 + 1.0));`);
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const inst = (geo, mat, list, shadow) => {
      list.sort((a, b) => b[5] - a[5]); // solid trees first, so density cuts only decorative ones
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      im.userData.full = list.length;
      im.userData.solid = list.filter((t) => t[5]).length;
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t[4] || 0);
        sv.setScalar(t[3]);
        pv.set(t[0], t[1] - 0.2, t[2]);
        m4.compose(pv, q, sv);
        im.setMatrixAt(i, m4);
      });
      im.count = list.length;
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      return im;
    };
    // one batch per 320 m cell so they are frustum / distance culled
    const CELL = 320;
    const cells = new Map();
    const put = (t, kind) => {
      const k = `${Math.floor(t[0] / CELL)},${Math.floor(t[2] / CELL)}`;
      if (!cells.has(k)) cells.set(k, { pine: [], round: [], cx: (Math.floor(t[0] / CELL) + 0.5) * CELL, cz: (Math.floor(t[2] / CELL) + 0.5) * CELL });
      cells.get(k)[kind].push(t);
    };
    pines.forEach((t) => put(t, 'pine'));
    rounds.forEach((t) => put(t, 'round'));
    this.treeCells = [];
    for (const c of cells.values()) {
      const meshes = [];
      if (c.pine.length) meshes.push(inst(pine, treeMat, c.pine, true));
      if (c.round.length) meshes.push(inst(round, treeMat, c.round, true));
      this.treeCells.push({ cx: c.cx, cz: c.cz, meshes });
    }
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.scale(1, 0.6, 1.2);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 0.95, flatShading: true });
    const rockList = rocks.map((r) => [r[0], r[1] + r[3] * 0.25, r[2], r[3], rnd() * 6]);
    inst(rockGeo, rockMat, rockList, true);
    for (const r of rocks) if (r[3] > 1.4) this.world.addCylinder(r[0], r[2], r[3] * 0.8, r[1] - 1, r[1] + r[3] * 0.6, { kind: 'rock', mat: MATERIALS.rock });
    this.treeCount = pines.length + rounds.length;
  }

  // ------------------------------------------------------------ sea
  buildSea() {
    const nmap = waterNormalTexture();
    nmap.repeat.set(300, 300);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d4d5c, roughness: 0.07, metalness: 0.05, normalMap: nmap, normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true, opacity: 0.86, depthWrite: false, envMapIntensity: 1.2,
    });
    const geo = new THREE.PlaneGeometry(9000, 6000);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, SEA_LEVEL, 380 + 3000);
    const sea = new THREE.Mesh(geo, mat);
    sea.renderOrder = 2;
    this.group.add(sea);
    this.sea = sea;
    this.seaMat = mat;
    // the deep beyond the heightmap
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b2129 }));
    deep.position.y = -12;
    this.group.add(deep);
    // surf: a foam band along the beach
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    const fp = [];
    for (let x = -HALF; x < HALF; x += 4) {
      if (x >= HARBOR.x0 - 4 && x <= HARBOR.x1 + 4) continue;
      const z0 = this.findShore(x), z1 = this.findShore(x + 4);
      const w = 1.6;
      fp.push(x, SEA_LEVEL + 0.03, z0 - w, x, SEA_LEVEL + 0.03, z0 + w, x + 4, SEA_LEVEL + 0.03, z1 + w);
      fp.push(x, SEA_LEVEL + 0.03, z0 - w, x + 4, SEA_LEVEL + 0.03, z1 + w, x + 4, SEA_LEVEL + 0.03, z1 - w);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.computeVertexNormals();
    fixWinding(fg);
    this.foam = new THREE.Mesh(fg, foamMat);
    this.foam.renderOrder = 3;
    this.group.add(this.foam);
  }

  /** z where the heightmap crosses sea level for a given x. */
  findShore(x) {
    let z = shoreZ(x) - 40;
    while (z < shoreZ(x) + 60 && this.rawHeight(x, z) > SEA_LEVEL) z += 0.5;
    return z;
  }

  // ------------------------------------------------------------ signs
  sign(x, z, y, text, bg, w = 8, yaw = 0, h = 3.2) {
    const t = signTexture(text, bg);
    const mat = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.2, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
    m.position.set(x, y + h, z);
    m.rotation.y = yaw;
    this.group.add(m);
    this.city?.nightMats?.push({ mat, max: 1.0, min: 0.2 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const px = x + Math.cos(yaw) * s * w * 0.35, pz = z - Math.sin(yaw) * s * w * 0.35;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, h, 6), poleMat);
      pole.position.set(px, y + h / 2 - 0.4, pz);
      this.group.add(pole);
      this.world.addCylinder(px, pz, 0.12, y - 1, y + h, { kind: 'pole' });
    }
  }

  buildSigns() {
    if (this.lookoutSign) {
      const [x, z, y, yaw] = this.lookoutSign;
      this.sign(x, z, y, 'DEMO PEAK LOOKOUT', '#2e5d3a', 9, yaw, 2.8);
    }
    for (const r of this.roads) {
      for (const end of [0, 1]) {
        const i = end ? r.pts.length - 40 : 40;
        const p = r.pts[i], rt = r.right[i], d = r.dir[i];
        const sgn = end ? -1 : 1;
        // on the right-hand verge, facing traffic leaving the city
        const off = r.hw + 3;
        const x = p.x + rt.x * off * sgn, z = p.z + rt.z * off * sgn;
        const yaw = Math.atan2(d.x * sgn, d.z * sgn) + Math.PI;
        const label = r.id === 'canyon' ? 'CANYON RD · DEMO PEAK' : r.id === 'trail' ? 'FOREST TRAIL · 4x4 ONLY' : 'COAST HWY · BEACH';
        this.sign(x, z, this.rawHeight(x, z), label, r.id === 'canyon' ? '#1c6b3a' : r.id === 'trail' ? '#6b4a1c' : '#1b4f8a', 7, yaw, 2.6);
      }
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, camPos, wind) {
    this.time += dt;
    if (this.windUniforms) {
      this.windUniforms.uWindT.value = this.time;
      if (wind) this.windUniforms.uWind.value.set(wind.x, wind.z);
    }
    if (this.seaMat) {
      this.seaMat.normalMap.offset.set(this.time * 0.004, this.time * 0.0025);
      this.foam.material.opacity = 0.22 + 0.16 * Math.sin(this.time * 0.9);
    }
    const vk = this.viewK || 1;
    if (this.treeCells)
      for (const c of this.treeCells) {
        const vis = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < 820 * vk;
        for (const m of c.meshes) m.visible = vis;
      }
    // LOD by distance from the camera
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) / vk;
      const lod = d < 420 ? 0 : d < 1100 ? 1 : 2;
      if (lod !== c.lod) {
        if (c.lod >= 0) c.meshes[c.lod].visible = false;
        c.meshes[lod].visible = true;
        c.lod = lod;
      }
    }
  }

  /** Tree density setting: hide a share of the decorative (non-solid) trees. */
  setTreeDensity(k) {
    for (const c of this.treeCells || []) for (const m of c.meshes) {
      const { full, solid } = m.userData;
      m.count = Math.max(solid, Math.round(solid + (full - solid) * k));
    }
  }

  setWetness(w) {
    for (const e of this.wetMats) {
      e.mat.roughness = lerp(e.dry, e.wet, w);
      e.mat.color.copy(e.dryColor).lerp(e.wetColor, w);
    }
  }
}

const _s = { y: 0, nx: 0, ny: 1, nz: 0, mat: null };
const _c = new THREE.Color();
const _c2 = new THREE.Color();

function coneAt(r, h, y) {
  const g = new THREE.ConeGeometry(r, h, 7);
  g.translate(0, y, 0);
  return g;
}

/** Merge [geometry, colour] pairs into one non-indexed, vertex-coloured geometry. */
function mergeGeos(list) {
  const pos = [], nrm = [], col = [];
  const c = new THREE.Color();
  for (const [g0, hex] of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    c.setHex(hex).convertSRGBToLinear();
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Make every triangle face up (for ribbons built without caring about winding). */
function fixWinding(geo) {
  const p = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
  const tri = idx ? idx.length / 3 : p.length / 9;
  for (let t = 0; t < tri; t++) {
    const ia = idx ? idx[t * 3] : t * 3, ib = idx ? idx[t * 3 + 1] : t * 3 + 1, ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = p[ia * 3], az = p[ia * 3 + 2];
    const bx = p[ib * 3], bz = p[ib * 3 + 2];
    const cx = p[ic * 3], cz = p[ic * 3 + 2];
    // y component of (b-a) x (c-a)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny < 0) {
      if (idx) { const tmp = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = tmp; }
      else for (let k = 0; k < 3; k++) { const tmp = p[ib * 3 + k]; p[ib * 3 + k] = p[ic * 3 + k]; p[ic * 3 + k] = tmp; }
    }
  }
  geo.computeVertexNormals();
}

/** Neutral, tileable grain multiplied over the terrain vertex colours. */
function detailTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(77);
  const blob = (x, y, r, a, v) => {
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        ctx.fillStyle = `rgba(${v},${v},${v},${a})`;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, 6.283);
        ctx.fill();
      }
  };
  for (let i = 0; i < 260; i++) blob(rnd() * S, rnd() * S, 6 + rnd() * 22, 0.08, rnd() < 0.5 ? 160 : 250);
  for (let i = 0; i < 2600; i++) blob(rnd() * S, rnd() * S, 0.6 + rnd() * 1.6, 0.35, rnd() < 0.5 ? 140 : 255);
  return canvasTexture(c, { repeat: [1, 1] });
}

function waterNormalTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = (x, y) => {
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
    return Math.sin(a * 3 + b * 2) * 0.5 + Math.sin(a * 7 - b * 5) * 0.25 + Math.sin(a * 13 + b * 11) * 0.12 + Math.sin(-a * 4 + b * 9) * 0.2;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const k = (y * S + x) * 4;
      img.data[k] = 128 + dx * 60;
      img.data[k + 1] = 128 + dy * 60;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
