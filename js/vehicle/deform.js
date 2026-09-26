import * as THREE from 'three';
import { clamp } from '../core/util.js';

/**
 * Node-beam soft body used for crash deformation (BeamNG-style, but coarse).
 *
 * A lattice of nodes spans the car; neighbouring nodes (26-neighbourhood) are
 * joined by beams. An impact shoves nearby nodes inward, the beam network is
 * relaxed with those nodes pinned so the dent spreads through the structure,
 * overstrained beams take a permanent set (plastic yield), then the pins are
 * released so the metal springs back a little.
 *
 * Every mesh vertex, hull collision point and suspension mount is bound to the
 * lattice with trilinear free-form deformation, so the whole car (and its
 * handling) follows the dent.
 */
export class DeformLattice {
  constructor(min, max, nx, ny, nz, hardnessFn) {
    this.min = min.clone();
    this.max = max.clone();
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
    this.NX = NX;
    this.NY = NY;
    this.NZ = NZ;
    const n = NX * NY * NZ;
    this.count = n;
    this.rest = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 3);
    this.hard = new Float32Array(n);
    this.pinned = new Uint8Array(n);
    this.target = new Float32Array(n * 3);
    this.active = new Uint8Array(n);
    const size = new THREE.Vector3().subVectors(max, min);
    this.size = size;
    const p = new THREE.Vector3();
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const id = this.index(i, j, k);
          p.set(min.x + (size.x * i) / nx, min.y + (size.y * j) / ny, min.z + (size.z * k) / nz);
          this.rest[id * 3] = this.pos[id * 3] = p.x;
          this.rest[id * 3 + 1] = this.pos[id * 3 + 1] = p.y;
          this.rest[id * 3 + 2] = this.pos[id * 3 + 2] = p.z;
          this.hard[id] = hardnessFn ? hardnessFn(p) : 1;
        }
    const beams = [];
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const a = this.index(i, j, k);
          for (let dk = -1; dk <= 1; dk++)
            for (let dj = -1; dj <= 1; dj++)
              for (let di = -1; di <= 1; di++) {
                const ii = i + di, jj = j + dj, kk = k + dk;
                if (ii < 0 || jj < 0 || kk < 0 || ii >= NX || jj >= NY || kk >= NZ) continue;
                const b = this.index(ii, jj, kk);
                if (b <= a) continue;
                beams.push(a, b);
              }
        }
    this.beams = new Int32Array(beams);
    this.beamCount = beams.length / 2;
    this.beamRest = new Float32Array(this.beamCount);
    this.beamRest0 = new Float32Array(this.beamCount);
    for (let b = 0; b < this.beamCount; b++) {
      const l = this.dist(this.beams[b * 2], this.beams[b * 2 + 1]);
      this.beamRest[b] = this.beamRest0[b] = l;
    }
    this.version = 0;
    this.maxDisp = Math.min(size.x, size.z) * 0.42;
    this.totalDamage = 0;
  }

  index(i, j, k) {
    return i + this.NX * (j + this.NY * k);
  }

  dist(a, b) {
    const p = this.pos;
    const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  reset() {
    this.pos.set(this.rest);
    this.beamRest.set(this.beamRest0);
    this.version++;
    this.totalDamage = 0;
  }

  /** Precompute trilinear cell + fractions for an array of xyz points. */
  bind(points) {
    const count = points.length / 3;
    const cell = new Int32Array(count);
    const frac = new Float32Array(count * 3);
    const { min, size, nx, ny, nz } = this;
    for (let v = 0; v < count; v++) {
      let u = ((points[v * 3] - min.x) / size.x) * nx;
      let w = ((points[v * 3 + 1] - min.y) / size.y) * ny;
      let t = ((points[v * 3 + 2] - min.z) / size.z) * nz;
      const i = clamp(Math.floor(u), 0, nx - 1);
      const j = clamp(Math.floor(w), 0, ny - 1);
      const k = clamp(Math.floor(t), 0, nz - 1);
      cell[v] = this.index(i, j, k);
      frac[v * 3] = clamp(u - i, 0, 1);
      frac[v * 3 + 1] = clamp(w - j, 0, 1);
      frac[v * 3 + 2] = clamp(t - k, 0, 1);
    }
    return { cell, frac, count };
  }

  /**
   * out = rest + displacement (+ crumple noise proportional to displacement).
   * `offset` is subtracted afterwards (e.g. a hinge pivot).
   */
  apply(binding, rest, out, crumple = 0, offset = null) {
    const { cell, frac, count } = binding;
    const P = this.pos, R = this.rest;
    const sx = 1, sy = this.NX, sz = this.NX * this.NY;
    const ox = offset ? offset.x : 0, oy = offset ? offset.y : 0, oz = offset ? offset.z : 0;
    for (let v = 0; v < count; v++) {
      const c = cell[v];
      const fx = frac[v * 3], fy = frac[v * 3 + 1], fz = frac[v * 3 + 2];
      let dx = 0, dy = 0, dz = 0;
      for (let corner = 0; corner < 8; corner++) {
        const cx = corner & 1, cy = (corner >> 1) & 1, cz = (corner >> 2) & 1;
        const w = (cx ? fx : 1 - fx) * (cy ? fy : 1 - fy) * (cz ? fz : 1 - fz);
        if (w === 0) continue;
        const n = (c + cx * sx + cy * sy + cz * sz) * 3;
        dx += (P[n] - R[n]) * w;
        dy += (P[n + 1] - R[n + 1]) * w;
        dz += (P[n + 2] - R[n + 2]) * w;
      }
      if (crumple > 0) {
        const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (m > 0.06) {
          // cheap per-vertex hash -> wrinkles grow with the size of the dent
          const h1 = Math.sin(v * 12.9898 + rest[v * 3] * 78.233) * 43758.5453;
          const h2 = Math.sin(v * 39.3468 + rest[v * 3 + 2] * 11.135) * 24634.6345;
          const h3 = Math.sin(v * 73.156 + rest[v * 3 + 1] * 52.235) * 12345.6789;
          const k = crumple * Math.min(m - 0.06, 0.35);
          dx += (h1 - Math.floor(h1) - 0.5) * k;
          dy += (h2 - Math.floor(h2) - 0.5) * k;
          dz += (h3 - Math.floor(h3) - 0.5) * k;
        }
      }
      out[v * 3] = rest[v * 3] + dx - ox;
      out[v * 3 + 1] = rest[v * 3 + 1] + dy - oy;
      out[v * 3 + 2] = rest[v * 3 + 2] + dz - oz;
    }
  }

  displacementAt(p, out) {
    const b = this.bind([p.x, p.y, p.z]);
    const tmp = new Float32Array(3);
    this.apply(b, new Float32Array([p.x, p.y, p.z]), tmp);
    return out.set(tmp[0] - p.x, tmp[1] - p.y, tmp[2] - p.z);
  }

  /**
   * Dent the structure.
   * @param p     impact point (design space)
   * @param dir   unit direction the metal is pushed (design space, into the car)
   * @param depth metres of crush at the centre (before hardness)
   * @param radius size of the contact patch
   * @returns energy-ish measure of how much the lattice moved
   */
  impact(p, dir, depth, radius) {
    const P = this.pos, n = this.count;
    const r2 = radius * radius;
    const act = this.active;
    act.fill(0);
    this.pinned.fill(0);
    let moved = 0;
    const reach = (radius * 2.6) ** 2;
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - p.x, dy = P[i * 3 + 1] - p.y, dz = P[i * 3 + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach) continue;
      act[i] = 1;
      const w = Math.exp(-d2 / r2);
      if (w < 0.08) continue;
      const push = (depth * w) / this.hard[i];
      let tx = P[i * 3] + dir.x * push;
      let ty = P[i * 3 + 1] + dir.y * push;
      let tz = P[i * 3 + 2] + dir.z * push;
      // limit total displacement from rest
      const rx = tx - this.rest[i * 3], ry = ty - this.rest[i * 3 + 1], rz = tz - this.rest[i * 3 + 2];
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (rl > this.maxDisp) {
        const s = this.maxDisp / rl;
        tx = this.rest[i * 3] + rx * s;
        ty = this.rest[i * 3 + 1] + ry * s;
        tz = this.rest[i * 3 + 2] + rz * s;
      }
      moved += Math.abs(tx - P[i * 3]) + Math.abs(ty - P[i * 3 + 1]) + Math.abs(tz - P[i * 3 + 2]);
      this.target[i * 3] = tx;
      this.target[i * 3 + 1] = ty;
      this.target[i * 3 + 2] = tz;
      this.pinned[i] = 1;
    }
    if (moved < 1e-4) return 0;
    for (let i = 0; i < n; i++) {
      if (!this.pinned[i]) continue;
      P[i * 3] = this.target[i * 3];
      P[i * 3 + 1] = this.target[i * 3 + 1];
      P[i * 3 + 2] = this.target[i * 3 + 2];
    }
    this.relax(10, true);
    this.yieldBeams();
    this.pinned.fill(0);
    this.relax(3, true);
    this.version++;
    this.totalDamage += moved;
    return moved;
  }

  relax(iterations, activeOnly) {
    const P = this.pos, B = this.beams, RL = this.beamRest, H = this.hard, act = this.active, pin = this.pinned;
    for (let it = 0; it < iterations; it++) {
      for (let b = 0; b < this.beamCount; b++) {
        const a = B[b * 2], c = B[b * 2 + 1];
        if (activeOnly && !act[a] && !act[c]) continue;
        const wa = pin[a] || (activeOnly && !act[a]) ? 0 : 1 / H[a];
        const wc = pin[c] || (activeOnly && !act[c]) ? 0 : 1 / H[c];
        const ws = wa + wc;
        if (ws === 0) continue;
        const dx = P[c * 3] - P[a * 3], dy = P[c * 3 + 1] - P[a * 3 + 1], dz = P[c * 3 + 2] - P[a * 3 + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = ((len - RL[b]) / len) * 0.55 / ws;
        P[a * 3] += dx * diff * wa;
        P[a * 3 + 1] += dy * diff * wa;
        P[a * 3 + 2] += dz * diff * wa;
        P[c * 3] -= dx * diff * wc;
        P[c * 3 + 1] -= dy * diff * wc;
        P[c * 3 + 2] -= dz * diff * wc;
      }
    }
  }

  yieldBeams() {
    const B = this.beams, RL = this.beamRest, act = this.active;
    for (let b = 0; b < this.beamCount; b++) {
      const a = B[b * 2], c = B[b * 2 + 1];
      if (!act[a] && !act[c]) continue;
      const len = this.dist(a, c);
      const strain = (len - RL[b]) / RL[b];
      if (Math.abs(strain) > 0.015) RL[b] += (len - RL[b]) * 0.85;
    }
  }

  /** Mean displacement of nodes near p (design space) - used for component damage. */
  localCrush(p, radius) {
    const P = this.pos, R = this.rest;
    let sum = 0, wsum = 0;
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const dx = R[i * 3] - p.x, dy = R[i * 3 + 1] - p.y, dz = R[i * 3 + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 * 4) continue;
      const w = Math.exp(-d2 / r2);
      const mx = P[i * 3] - R[i * 3], my = P[i * 3 + 1] - R[i * 3 + 1], mz = P[i * 3 + 2] - R[i * 3 + 2];
      sum += Math.sqrt(mx * mx + my * my + mz * mz) * w;
      wsum += w;
    }
    return wsum > 0 ? sum / wsum : 0;
  }
}
