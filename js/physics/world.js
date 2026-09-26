import * as THREE from 'three';

/** Surface materials: grip multiplier, roughness (vertical noise, m), rolling drag, sound kind. */
export const MATERIALS = {
  asphalt: { id: 0, name: 'asphalt', grip: 1.0, rough: 0.0, drag: 0.0, sound: 'road', dust: null },
  concrete: { id: 1, name: 'concrete', grip: 0.95, rough: 0.002, drag: 0.0, sound: 'road', dust: null },
  grass: { id: 2, name: 'grass', grip: 0.62, rough: 0.012, drag: 0.012, sound: 'grass', dust: [0.35, 0.42, 0.22] },
  dirt: { id: 3, name: 'dirt', grip: 0.7, rough: 0.02, drag: 0.018, sound: 'dirt', dust: [0.55, 0.45, 0.32] },
  metal: { id: 4, name: 'metal', grip: 0.85, rough: 0.0, drag: 0.0, sound: 'metal', dust: null },
  wood: { id: 5, name: 'wood', grip: 0.8, rough: 0.004, drag: 0.004, sound: 'wood', dust: null },
};

const CELL = 16;
const key = (ix, iz) => ((ix + 4096) << 13) ^ (iz + 4096);

/**
 * All static collision geometry of the map:
 *  - slabs:     raised flat areas (sidewalks, blocks, platforms), only affect ground height
 *  - ramps:     inclined planes
 *  - boxes:     solid AABBs (buildings, walls, barriers); their tops are drivable
 *  - cylinders: poles/trees (may be breakable props)
 */
export class StaticWorld {
  constructor() {
    this.cells = new Map();
    this.boxes = [];
    this.slabs = [];
    this.ramps = [];
    this.cylinders = [];
    this.baseMaterial = (x, z) => MATERIALS.asphalt;
    this.baseHeight = -0.0;
    this.bounds = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
    this._stamp = 1;
  }

  _cell(ix, iz, create) {
    const k = key(ix, iz);
    let c = this.cells.get(k);
    if (!c && create) {
      c = { boxes: [], slabs: [], ramps: [], cylinders: [] };
      this.cells.set(k, c);
    }
    return c;
  }

  _insert(list, item, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) this._cell(ix, iz, true)[list].push(item);
  }

  _remove(list, item, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const c = this._cell(ix, iz, false);
        if (!c) continue;
        const i = c[list].indexOf(item);
        if (i >= 0) c[list].splice(i, 1);
      }
  }

  addSlab(minX, minZ, maxX, maxZ, top, mat = MATERIALS.concrete) {
    const s = { minX, minZ, maxX, maxZ, top, mat };
    this.slabs.push(s);
    this._insert('slabs', s, minX, minZ, maxX, maxZ);
    return s;
  }

  /** Box from min/max corners. `kind` is used by gameplay (building, wall, barrier...). */
  addBox(minX, minY, minZ, maxX, maxY, maxZ, opts = {}) {
    const b = {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
      mat: opts.mat || MATERIALS.concrete,
      kind: opts.kind || 'building',
      ref: opts.ref || null,
      stamp: 0,
    };
    this.boxes.push(b);
    this._insert('boxes', b, minX, minZ, maxX, maxZ);
    return b;
  }

  removeBox(b) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
    this._remove('boxes', b, b.min.x, b.min.z, b.max.x, b.max.z);
  }

  /** Ramp rising from h0 at its start to h1 at its end, along heading `yaw` (0 = +z). */
  addRamp(cx, cz, yaw, width, length, h0, h1, mat = MATERIALS.concrete) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const r = {
      cx, cz, dx, dz, hw: width / 2, hl: length / 2, h0, h1, mat,
      slope: (h1 - h0) / length,
      stamp: 0,
    };
    const ext = Math.hypot(width, length) / 2;
    this.ramps.push(r);
    this._insert('ramps', r, cx - ext, cz - ext, cx + ext, cz + ext);
    return r;
  }

  addCylinder(x, z, radius, y0, y1, opts = {}) {
    const c = { x, z, r: radius, y0, y1, kind: opts.kind || 'pole', ref: opts.ref || null, mat: opts.mat || MATERIALS.metal, stamp: 0 };
    this.cylinders.push(c);
    this._insert('cylinders', c, x - radius, z - radius, x + radius, z + radius);
    return c;
  }

  removeCylinder(c) {
    const i = this.cylinders.indexOf(c);
    if (i >= 0) this.cylinders.splice(i, 1);
    this._remove('cylinders', c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  }

  /**
   * Ground height under (x, z), ignoring anything more than `step` above yRef
   * (so the street under a bridge or the road next to a rooftop still works).
   * Fills `out` with y, normal and material.
   */
  groundAt(x, z, yRef, out, step = 0.05) {
    let y = this.baseHeight;
    let mat = this.baseMaterial(x, z);
    let nx = 0, ny = 1, nz = 0;
    const c = this._cell(Math.floor(x / CELL), Math.floor(z / CELL), false);
    const lim = yRef + step;
    if (c) {
      const slabs = c.slabs;
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.top <= lim && s.top > y) {
          y = s.top;
          mat = s.mat;
        }
      }
      const boxes = c.boxes;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= lim && b.max.y > y) {
          y = b.max.y;
          mat = b.mat;
          nx = 0; ny = 1; nz = 0;
        }
      }
      const ramps = c.ramps;
      for (let i = 0; i < ramps.length; i++) {
        const r = ramps[i];
        const lx = x - r.cx, lz = z - r.cz;
        const u = lx * r.dx + lz * r.dz;
        const s = lx * r.dz - lz * r.dx;
        if (u >= -r.hl && u <= r.hl && s >= -r.hw && s <= r.hw) {
          const h = r.h0 + (u + r.hl) * r.slope;
          if (h <= lim && h > y) {
            y = h;
            mat = r.mat;
            const inv = 1 / Math.sqrt(1 + r.slope * r.slope);
            nx = -r.slope * r.dx * inv;
            ny = inv;
            nz = -r.slope * r.dz * inv;
          }
        }
      }
    }
    out.y = y;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.mat = mat;
    return out;
  }

  /** Collect boxes/cylinders overlapping an XZ rectangle (deduplicated). */
  query(minX, minZ, maxX, maxZ, boxesOut, cylOut) {
    const stamp = ++this._stamp;
    boxesOut.length = 0;
    if (cylOut) cylOut.length = 0;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const c = this._cell(ix, iz, false);
        if (!c) continue;
        for (const b of c.boxes) {
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if (b.max.x < minX || b.min.x > maxX || b.max.z < minZ || b.min.z > maxZ) continue;
          boxesOut.push(b);
        }
        if (cylOut)
          for (const cy of c.cylinders) {
            if (cy.stamp === stamp) continue;
            cy.stamp = stamp;
            cylOut.push(cy);
          }
      }
    return boxesOut;
  }

  /**
   * Ray vs boxes (slab test). Returns distance to first hit or maxDist.
   * Used by the camera to avoid clipping into buildings and by AI feelers.
   */
  raycast(origin, dir, maxDist, filter) {
    const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
    const list = this.query(Math.min(origin.x, ex) - 1, Math.min(origin.z, ez) - 1, Math.max(origin.x, ex) + 1, Math.max(origin.z, ez) + 1, _rayBoxes);
    let best = maxDist;
    for (const b of list) {
      if (filter && !filter(b)) continue;
      const t = rayAABB(origin, dir, b.min, b.max, best);
      if (t !== null && t < best) best = t;
    }
    return best;
  }

  /** 2D line-of-sight check against boxes taller than minHeight. */
  blocked(ax, az, bx, bz, minHeight = 2) {
    _o.set(ax, 1.2, az);
    _d.set(bx - ax, 0, bz - az);
    const len = _d.length();
    if (len < 0.01) return false;
    _d.multiplyScalar(1 / len);
    const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), _rayBoxes);
    for (const b of list) {
      if (b.max.y < minHeight) continue;
      if (rayAABB(_o, _d, b.min, b.max, len) !== null) return true;
    }
    return false;
  }
}

const _rayBoxes = [];
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export function rayAABB(o, d, min, max, maxT) {
  let tmin = 0, tmax = maxT;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const mn = a === 0 ? min.x : a === 1 ? min.y : min.z;
    const mx = a === 0 ? max.x : a === 1 ? max.y : max.z;
    if (Math.abs(da) < 1e-9) {
      if (oa < mn || oa > mx) return null;
    } else {
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
