import * as THREE from 'three';
import { BODIES } from './specs.js';
import { pchip, clamp, lerp } from '../core/util.js';
import { makeCanvas, canvasTexture, cachedTexture, roundRect } from '../core/canvas.js';
import { DeformLattice } from './deform.js';
import { buildWheel } from './wheels.js';

// Ring layout: P0 (bottom centre) .. P10 (top centre) on the +x side, mirrored on -x.
const HALF = 11;
const FULL = 21; // j = 0..20, j = 10 is the top centre

// ------------------------------------------------------------------ profile
const profiles = new Map();
export function getProfile(bodyId) {
  if (profiles.has(bodyId)) return profiles.get(bodyId);
  const b = BODIES[bodyId];
  const f = { top: pchip(b.top), belt: pchip(b.belt), bottom: pchip(b.bottom), hw: pchip(b.hw), gh: pchip(b.gh) };
  const zR = -b.L / 2, zF = b.L / 2;
  const Ra = b.R + 0.075;
  const Z = b.zones;
  const archY = (z) => {
    let y = -1;
    for (const az of b.axles) {
      const d = z - az;
      if (Math.abs(d) < Ra) y = Math.max(y, b.R + Math.sqrt(Ra * Ra - d * d));
    }
    return y;
  };
  function ring(z, out = new Float64Array(HALF * 2)) {
    const hwz = f.hw(z);
    const bt = f.belt(z);
    let yb = Math.max(f.bottom(z), archY(z));
    if (yb > bt - 0.08) yb = bt - 0.08;
    const tp = f.top(z);
    const ch = tp - bt;
    const inGh = z > Z.deck - 0.03 && z < Z.cowl + 0.03;
    const ghw = inGh ? Math.min(f.gh(z), hwz * 0.9) : hwz * 0.86;
    const bed = Z.bed && z > Z.bed[0] && z < Z.bed[1];
    let k = 0;
    const put = (x, y) => {
      out[k++] = x;
      out[k++] = y;
    };
    put(0, yb + 0.02);
    put(hwz * 0.8, yb);
    put(hwz * 0.965, yb + Math.min(0.05, (bt - yb) * 0.15));
    put(hwz, yb + (bt - yb) * 0.4);
    put(hwz * 0.995, yb + (bt - yb) * 0.8);
    put(hwz * 0.955, bt - 0.01);
    if (bed) {
      put(hwz * 0.925, bt + 0.005);
      put(hwz * 0.9, tp);
      put(hwz * 0.6, tp);
      put(hwz * 0.3, tp);
      put(0, tp);
    } else {
      const c = Math.max(ch, 0);
      const sill = hwz * 0.915;
      put(sill, bt + c * 0.03 + 0.004);
      put(lerp(sill, ghw, 0.55), bt + c * 0.55);
      put(ghw, bt + c * 0.93);
      put(ghw * 0.5, tp - c * 0.01);
      put(0, tp);
    }
    return out;
  }
  const hwMax = Math.max(...b.hw.map((p) => p[1]));
  const hMax = Math.max(...b.top.map((p) => p[1]), ...b.belt.map((p) => p[1]));
  const prof = { b, f, zR, zF, Ra, ring, archY, hwMax, hMax, L: b.L };
  profiles.set(bodyId, prof);
  return prof;
}

function inRanges(z, ranges) {
  for (const r of ranges) if (z >= r[0] && z <= r[1]) return true;
  return false;
}

function doorOf(b, z) {
  for (const k in b.doors) {
    const r = b.doors[k];
    if (z >= r[0] && z <= r[1]) return k; // 'FL' | 'RL'
  }
  return null;
}

// ------------------------------------------------------------------ loft
function buildLoft(prof, simple) {
  const { b, zR, zF, Ra, ring } = prof;
  const Z = b.zones;
  const zs = [];
  const step = simple ? 0.085 : 0.05;
  for (let z = zR; z < zF; z += step) zs.push(z);
  zs.push(zF);
  const extra = [Z.cowl, Z.roofF, Z.roofR, Z.deck, zF - 0.3, zR + 0.3, zF - 0.12, zR + 0.1];
  for (const e of [0.012, 0.03, 0.055]) extra.push(zR + e, zF - e);
  if (Z.bed) extra.push(Z.bed[0], Z.bed[1], Z.bed[0] - 0.01, Z.bed[1] + 0.01);
  for (const k in b.doors) extra.push(...b.doors[k]);
  for (const r of b.sideGlass) extra.push(...r);
  for (const az of b.axles) for (const f of [-1, -0.97, -0.85, -0.65, -0.35, 0, 0.35, 0.65, 0.85, 0.97, 1]) extra.push(az + f * Ra);
  for (const e of extra) if (e > zR && e < zF) zs.push(e);
  zs.sort((a, c) => a - c);
  const stations = [];
  for (const z of zs) if (!stations.length || z - stations[stations.length - 1] > 0.008) stations.push(z);
  if (stations[stations.length - 1] < zF - 1e-3) stations.push(zF);

  const n = stations.length;
  const pos = new Float32Array(n * FULL * 3);
  const uv = new Float32Array(n * FULL * 2);
  const half = new Float64Array(HALF * 2);
  for (let i = 0; i < n; i++) {
    const z = stations[i];
    ring(z, half);
    for (let j = 0; j < FULL; j++) {
      const h = j <= 10 ? j : 20 - j;
      const x = half[h * 2] * (j <= 10 ? 1 : -1);
      const y = half[h * 2 + 1];
      const id = i * FULL + j;
      pos[id * 3] = x;
      pos[id * 3 + 1] = y;
      pos[id * 3 + 2] = z;
      uv[id * 2] = (z - zR) / b.L;
      uv[id * 2 + 1] = j / 20;
    }
  }

  const parts = {};
  const add = (name, a, c, d) => {
    (parts[name] || (parts[name] = [])).push(a, c, d);
  };
  const hasTrunk = !Z.bed && Z.deck > zR + 0.15;
  const classify = (zm, seg, side) => {
    const bed = Z.bed && zm > Z.bed[0] - 0.02 && zm < Z.bed[1] + 0.02;
    if (seg === 0) return 'under';
    if (zm > zF - 0.3 && seg <= 4) return 'bumperF';
    if (zm < zR + 0.3 && seg <= 4) return 'bumperR';
    if (seg >= 6) {
      if (bed) return 'body';
      if (zm > Z.cowl) return zm < zF - 0.12 && seg >= 6 ? 'hood' : 'body';
      if (zm < Z.deck) return hasTrunk && zm > zR + 0.1 ? 'trunk' : 'body';
      if (seg >= 8) {
        if (zm > Z.roofF) return 'windshield';
        if (zm < Z.roofR) return 'rearGlass';
        return 'body';
      }
      if (inRanges(zm, b.sideGlass)) {
        const d = doorOf(b, zm);
        if (d && !simple) return 'win' + d[0] + side;
        return 'glassQ';
      }
      return 'body';
    }
    if (seg >= 2 && !simple) {
      const d = doorOf(b, zm);
      if (d) return 'door' + d[0] + side;
    }
    return 'body';
  };
  for (let i = 0; i < n - 1; i++) {
    const zm = (stations[i] + stations[i + 1]) / 2;
    for (let j = 0; j < FULL - 1; j++) {
      const seg = j < 10 ? j : 19 - j;
      const side = j < 10 ? 'L' : 'R';
      const name = classify(zm, seg, side);
      const a = i * FULL + j, bb = (i + 1) * FULL + j, c = (i + 1) * FULL + j + 1, d = i * FULL + j + 1;
      add(name, a, c, bb);
      add(name, a, d, c);
    }
  }
  // end caps (triangulated outline of the first / last ring)
  const capParts = { F: 'bumperF', R: 'bumperR' };
  for (const [end, i] of [['R', 0], ['F', n - 1]]) {
    const contour = [];
    const idx = [];
    for (let j = 0; j < FULL - 1; j++) {
      const id = i * FULL + j;
      contour.push(new THREE.Vector2(pos[id * 3], pos[id * 3 + 1]));
      idx.push(id);
    }
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      const [p0, p1, p2] = [idx[t[0]], idx[t[1]], idx[t[2]]];
      // orient caps outward (+z for front, -z for rear)
      const ax = pos[p1 * 3] - pos[p0 * 3], ay = pos[p1 * 3 + 1] - pos[p0 * 3 + 1];
      const bx = pos[p2 * 3] - pos[p0 * 3], by = pos[p2 * 3 + 1] - pos[p0 * 3 + 1];
      const nz = ax * by - ay * bx;
      const want = end === 'F' ? 1 : -1;
      if (nz * want > 0) add(capParts[end], p0, p1, p2);
      else add(capParts[end], p0, p2, p1);
    }
  }
  return { stations, pos, uv, parts };
}

function compactPart(loft, indices) {
  const map = new Map();
  const P = [], U = [], I = [];
  for (const g of indices) {
    let k = map.get(g);
    if (k === undefined) {
      k = P.length / 3;
      map.set(g, k);
      P.push(loft.pos[g * 3], loft.pos[g * 3 + 1], loft.pos[g * 3 + 2]);
      U.push(loft.uv[g * 2], loft.uv[g * 2 + 1]);
    }
    I.push(k);
  }
  return { positions: new Float32Array(P), uvs: new Float32Array(U), indices: I };
}

// ------------------------------------------------------------------ surface helpers
function pointInHalfRing(half, x, y) {
  // polygon P0..P10 closed along x = 0
  let inside = false;
  for (let i = 0, j = HALF - 1; i < HALF; j = i++) {
    const xi = half[i * 2], yi = half[i * 2 + 1], xj = half[j * 2], yj = half[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** z of the car's skin at (x, y), searching from the front (dir=1) or rear (dir=-1). */
export function skinZ(prof, x, y, dir) {
  const key = `${x.toFixed(3)}:${y.toFixed(3)}:${dir}`;
  if (!prof.skin) prof.skin = new Map();
  if (prof.skin.has(key)) return prof.skin.get(key);
  const z = skinZSearch(prof, x, y, dir);
  prof.skin.set(key, z);
  return z;
}

function skinZSearch(prof, x, y, dir) {
  const half = new Float64Array(HALF * 2);
  const ax = Math.abs(x);
  const step = 0.01;
  let prevZ = dir > 0 ? prof.zF + 0.01 : prof.zR - 0.01;
  for (let z = dir > 0 ? prof.zF : prof.zR; dir > 0 ? z > prof.zR : z < prof.zF; z -= dir * step) {
    prof.ring(z, half);
    if (pointInHalfRing(half, ax, y)) return (z + prevZ) / 2;
    prevZ = z;
  }
  return dir > 0 ? prof.zF : prof.zR;
}

// ------------------------------------------------------------------ materials
export function paintMaterial(color, finish, npc, map) {
  const c = new THREE.Color(color);
  const common = { color: map ? 0xffffff : c, map: map || null };
  if (npc) {
    const m = {
      gloss: [0.1, 0.32], metallic: [0.55, 0.3], pearl: [0.4, 0.28], matte: [0.1, 0.72], chrome: [1, 0.08],
    }[finish] || [0.3, 0.35];
    return new THREE.MeshStandardMaterial({ ...common, metalness: m[0], roughness: m[1], envMapIntensity: 1.0 });
  }
  const opts = {
    gloss: { metalness: 0.05, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.03 },
    metallic: { metalness: 0.6, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.03 },
    pearl: { metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.7, iridescenceIOR: 1.4 },
    matte: { metalness: 0.15, roughness: 0.78, clearcoat: 0 },
    chrome: { metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 },
  }[finish] || {};
  return new THREE.MeshPhysicalMaterial({ ...common, ...opts, envMapIntensity: 1.1 });
}

const shared = new Map();
function sharedMaterial(key, make) {
  if (!shared.has(key)) shared.set(key, make());
  return shared.get(key);
}
export const MATS = {
  trim: () => sharedMaterial('trim', () => new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.55, metalness: 0.2 })),
  under: () => sharedMaterial('under', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide })),
  chrome: () => sharedMaterial('chrome', () => new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.08, metalness: 1 })),
  liner: () => sharedMaterial('liner', () => new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.95, metalness: 0, side: THREE.BackSide })),
  mirror: () => sharedMaterial('mirrorglass', () => new THREE.MeshStandardMaterial({ color: 0xaab4c0, roughness: 0.02, metalness: 1 })),
  arch: () => sharedMaterial('arch', () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1, side: THREE.BackSide })),
};

function glassMaterial(tint, npc) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.02, 0.03, 0.04),
    roughness: 0.04,
    metalness: 0.2,
    transparent: true,
    opacity: npc ? 0.72 + tint * 0.2 : 0.22 + tint * 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.6,
  });
}

// ------------------------------------------------------------------ textures
function lightTexture(kind) {
  return cachedTexture('light:' + kind, 128, 64, (ctx, w, h) => {
    if (kind === 'head') {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#9aa3ad');
      g.addColorStop(1, '#3c4148');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (const cx of [w * 0.3, w * 0.68]) {
        const rg = ctx.createRadialGradient(cx, h / 2, 2, cx, h / 2, h * 0.36);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.5, '#dfe6ee');
        rg.addColorStop(1, '#6d7680');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(cx, h / 2, h * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(w * 0.06, h * 0.84, w * 0.88, 4); // DRL strip
    } else {
      ctx.fillStyle = '#5a0508';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#c0141c' : '#ff2a2a';
        ctx.fillRect(4, 6 + i * 11, w - 8, 6);
      }
    }
  });
}

function grilleTexture() {
  return cachedTexture('grille', 128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2c2e';
    ctx.lineWidth = 2;
    for (let x = -h; x < w + h; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.moveTo(x + h, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
}

export function plateTexture(text) {
  const c = makeCanvas(256, 64);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1e6';
  roundRect(ctx, 2, 2, 252, 60, 8);
  ctx.fill();
  ctx.strokeStyle = '#1d3b7a';
  ctx.lineWidth = 3;
  roundRect(ctx, 5, 5, 246, 54, 6);
  ctx.stroke();
  ctx.fillStyle = '#1d3b7a';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SAN DEMO', 128, 17);
  ctx.fillStyle = '#16181c';
  ctx.font = 'bold 34px monospace';
  ctx.fillText(String(text || '').slice(0, 8).toUpperCase(), 128, 52);
  return canvasTexture(c);
}

// ------------------------------------------------------------------ livery
/** Paint the body texture. u = along the car (rear->front), v = ring index / 20. */
export function paintLivery(ctx, W, H, cfg, prof, opts = {}) {
  const b = prof.b;
  const u = (z) => ((z - prof.zR) / b.L) * W;
  const y = (v) => (1 - v) * H;
  const base = opts.base || cfg.paint;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const accent = cfg.accent || '#111';
  const livery = opts.livery || cfg.livery;
  // subtle metallic flake noise
  if (!opts.simple) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 6;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  const Z = b.zones;
  const sideRows = (v0, v1) => [[y(v1), y(v0) - y(v1)], [y(1 - v0), y(1 - v1) - y(1 - v0)]];
  if (livery === 'stripes') {
    ctx.fillStyle = accent;
    for (const off of [-0.045, 0.02]) ctx.fillRect(0, y(0.5 + off + 0.025), W, (0.025 * H));
  } else if (livery === 'side') {
    ctx.fillStyle = accent;
    for (const [yy, hh] of sideRows(0.24, 0.265)) ctx.fillRect(u(prof.zR + 0.3), yy, u(prof.zF - 0.35) - u(prof.zR + 0.3), hh);
  } else if (livery === 'twotone') {
    ctx.fillStyle = accent;
    ctx.fillRect(u(Z.deck), y(0.64), u(Z.cowl) - u(Z.deck), (0.28 * H));
    for (const [yy, hh] of sideRows(0.0, 0.1)) ctx.fillRect(0, yy, W, hh);
  } else if (livery === 'checker') {
    const s = H * 0.03;
    for (const [yy] of sideRows(0.12, 0.18)) {
      for (let x = 0, i = 0; x < W; x += s, i++) {
        for (let r = 0; r < 2; r++) {
          ctx.fillStyle = (i + r) % 2 ? '#111' : '#f2f2f2';
          ctx.fillRect(x, yy + r * s, s, s);
        }
      }
    }
  } else if (livery === 'flames') {
    const colors = ['#ffd21e', '#ff7a12', '#e0200f'];
    for (const [side, flip] of [[0, false], [1, true]]) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = colors[c];
        ctx.beginPath();
        const x0 = u(prof.zF - 0.05);
        const vMid = side ? 0.78 : 0.22;
        ctx.moveTo(x0, y(vMid + (flip ? -1 : 1) * 0.08));
        for (let k = 0; k < 6; k++) {
          const xx = x0 - (k + 1) * (W * 0.07) * (1 - c * 0.18);
          const vv = vMid + (flip ? -1 : 1) * (k % 2 ? 0.07 : -0.02) * (1 - c * 0.25);
          ctx.quadraticCurveTo(xx + W * 0.03, y(vMid), xx, y(vv));
        }
        ctx.lineTo(x0, y(vMid - (flip ? -1 : 1) * 0.08));
        ctx.fill();
      }
    }
    // hood flames
    ctx.fillStyle = '#ff7a12';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      const vv = 0.42 + k * 0.04;
      ctx.moveTo(u(prof.zF - 0.1), y(vv));
      ctx.quadraticCurveTo(u(Z.cowl + 0.3), y(vv + 0.03), u(Z.cowl + 0.1 + k * 0.05), y(vv + 0.015));
      ctx.quadraticCurveTo(u(Z.cowl + 0.4), y(vv - 0.01), u(prof.zF - 0.1), y(vv - 0.02));
      ctx.fill();
    }
  } else if (livery === 'police') {
    // black nose/tail, white doors, blue stripe
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(0, 0, u(Z.deck + 0.2), H);
    ctx.fillRect(u(Z.cowl - 0.1), 0, W - u(Z.cowl - 0.1), H);
    ctx.fillRect(0, y(0.62), W, 0.24 * H); // roof & top black
    ctx.fillStyle = '#1f4fd1';
    for (const [yy, hh] of sideRows(0.2, 0.235)) ctx.fillRect(0, yy, W, hh);
    drawSideText(ctx, W, H, prof, 'POLICE', '#0c0d10', 0.26, 0.4);
  } else if (livery === 'taxi') {
    for (const [yy] of sideRows(0.3, 0.34)) {
      const s = H * 0.02;
      for (let x = u(Z.deck), i = 0; x < u(Z.cowl); x += s, i++) {
        for (let r = 0; r < 2; r++) {
          ctx.fillStyle = (i + r) % 2 ? '#111' : '#f2f2f2';
          ctx.fillRect(x, yy + r * s, s, s);
        }
      }
    }
    drawSideText(ctx, W, H, prof, 'TAXI', '#111', 0.16, 0.28);
  }
  if (livery === 'racing' || opts.number) {
    drawSideText(ctx, W, H, prof, String(opts.number || 42), '#111', 0.14, 0.4, true);
  }
  // panel gaps
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, H / 300);
  const line = (x0, y0, x1, y1) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (const k in b.doors) {
    const [z0, z1] = b.doors[k];
    for (const [v0, v1] of [[0.1, 0.3], [0.7, 0.9]]) {
      line(u(z0), y(v0), u(z0), y(v1));
      line(u(z1), y(v0), u(z1), y(v1));
    }
  }
  if (Z.cowl < prof.zF - 0.3) {
    line(u(Z.cowl), y(0.3), u(Z.cowl), y(0.7));
    line(u(Z.cowl), y(0.3), u(prof.zF - 0.12), y(0.3));
    line(u(Z.cowl), y(0.7), u(prof.zF - 0.12), y(0.7));
  }
  if (!Z.bed && Z.deck > prof.zR + 0.15) {
    line(u(Z.deck), y(0.3), u(Z.deck), y(0.7));
  }
  // fuel door
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.strokeRect(u(prof.b.axles[1] + 0.45), y(0.765), W * 0.02, H * 0.03);
}

function drawSideText(ctx, W, H, prof, text, color, v0, v1, number = false) {
  const b = prof.b;
  const zc = number ? (b.doors.FL[0] + b.doors.FL[1]) / 2 : (b.axles[0] + b.axles[1]) / 2 + 0.1;
  const x = ((zc - prof.zR) / b.L) * W;
  const hh = (v1 - v0) * H;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(hh * 0.85)}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (number) {
    for (const vy of [(1 - (v0 + v1) / 2) * H, ((v0 + v1) / 2) * H]) {
      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath();
      ctx.arc(x, vy, hh * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = color;
  }
  // left side (+x): mirrored
  ctx.save();
  ctx.translate(x, (1 - (v0 + v1) / 2) * H);
  ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
  // right side
  ctx.fillText(text, x, ((v0 + v1) / 2) * H);
  ctx.restore();
}

const npcLiveries = new Map();
function sharedLivery(bodyId, cfg, prof) {
  const key = `${bodyId}:${cfg.livery}:${cfg.livery === 'police' || cfg.livery === 'taxi' ? cfg.paint : ''}`;
  if (npcLiveries.has(key)) return npcLiveries.get(key);
  const c = makeCanvas(512, 256);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const white = cfg.livery !== 'police' && cfg.livery !== 'taxi';
  paintLivery(ctx, 512, 256, cfg, prof, { base: white ? '#ffffff' : cfg.paint, simple: true, livery: white ? 'none' : cfg.livery });
  const t = canvasTexture(c);
  npcLiveries.set(key, t);
  return t;
}

// ------------------------------------------------------------------ parts
const HINGES = {
  hood: { axis: 'x', sign: -1, max: 1.25 },
  trunk: { axis: 'x', sign: 1, max: 1.35 },
  doorFL: { axis: 'y', sign: -1, max: 1.15 },
  doorRL: { axis: 'y', sign: -1, max: 1.15 },
  doorFR: { axis: 'y', sign: 1, max: 1.15 },
  doorRR: { axis: 'y', sign: 1, max: 1.15 },
  bumperF: { axis: 'z', sign: 1, max: 0.5 },
  bumperR: { axis: 'z', sign: -1, max: 0.5 },
};

export class Part {
  constructor(name, geo, rest, pivot, material, parent) {
    this.name = name;
    this.rest = rest; // design-space positions
    this.pivot = pivot.clone();
    this.group = new THREE.Group();
    this.group.position.copy(pivot);
    parent.add(this.group);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
    this.binding = null;
    this.health = 1;
    this.state = 'ok'; // ok | loose | open | detached | shattered
    this.angle = 0;
    this.angVel = 0;
    this.hinge = HINGES[name] || null;
    this.center = new THREE.Vector3();
    const n = rest.length / 3;
    for (let i = 0; i < n; i++) this.center.x += rest[i * 3], this.center.y += rest[i * 3 + 1], this.center.z += rest[i * 3 + 2];
    this.center.multiplyScalar(1 / Math.max(n, 1));
    this.userOpen = false; // doors/hood opened on purpose
    this.children = [];
  }

  deform(lattice, crumple) {
    if (!this.binding) this.binding = lattice.bind(this.rest);
    const attr = this.mesh.geometry.attributes.position;
    lattice.apply(this.binding, this.rest, attr.array, crumple, this.pivot);
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }

  setAngle(a) {
    this.angle = a;
    if (!this.hinge) return;
    const ax = this.hinge.axis;
    this.group.rotation.set(ax === 'x' ? a : 0, ax === 'y' ? a : 0, ax === 'z' ? a : 0);
  }
}

// ------------------------------------------------------------------ main builder
/**
 * Build a car model from a customisation config.
 * @param cfg customisation (see DEFAULT_CONFIG)
 * @param tuning result of buildTuning(cfg)
 * @param opts { npc: bool, police: bool, taxi: bool }
 */
export function buildCarModel(cfg, tuning, opts = {}) {
  const npc = !!opts.npc;
  const simple = npc;
  const prof = getProfile(cfg.body);
  const b = prof.b;
  const root = new THREE.Group();
  root.name = 'car';
  const design = new THREE.Group();
  design.position.copy(tuning.com).multiplyScalar(-1);
  // ride height: body sits higher relative to wheels
  root.add(design);

  // lattice spanning the car
  const lmin = new THREE.Vector3(-prof.hwMax - 0.06, -0.02, prof.zR - 0.06);
  const lmax = new THREE.Vector3(prof.hwMax + 0.06, prof.hMax + 0.06, prof.zF + 0.06);
  const Z = b.zones;
  const beltMid = pchip(b.belt)(0);
  const hardness = (p) => {
    let h = 1;
    const cabin = p.z < Z.cowl + 0.1 && p.z > (Z.bed ? Z.bed[1] : Z.deck) - 0.15;
    if (cabin) h = p.y > beltMid + 0.2 ? 1.5 : 2.4;
    if (p.z > Z.cowl + 0.2 && p.z < prof.zF - 0.35 && Math.abs(p.x) < 0.5 && p.y > 0.2 && p.y < beltMid - 0.1) h = 3.6;
    if (p.z > prof.zF - 0.3 || p.z < prof.zR + 0.3) h *= 0.75;
    if (p.y < 0.35) h *= 1.3; // floor pan / rails
    return h;
  };
  const lattice = new DeformLattice(lmin, lmax, 4, 3, Math.max(8, Math.round(b.L / 0.42)), hardness);

  // livery / paint
  let livery = null;
  let paintMap = null;
  if (!npc) {
    const c = makeCanvas(1024, 512);
    if (c) {
      const ctx = c.getContext('2d');
      paintLivery(ctx, 1024, 512, cfg, prof);
      paintMap = canvasTexture(c);
      livery = { canvas: c, ctx, tex: paintMap, W: 1024, H: 512 };
    }
  } else {
    paintMap = sharedLivery(cfg.body, cfg, prof);
  }
  const paint = paintMaterial(npc && cfg.livery !== 'police' && cfg.livery !== 'taxi' ? cfg.paint : '#ffffff', cfg.finish, npc, paintMap);
  if (npc && paintMap && cfg.livery !== 'police' && cfg.livery !== 'taxi') paint.color.set(cfg.paint);
  const glass = glassMaterial(cfg.tint ?? 0.3, npc);

  const loft = buildLoft(prof, simple);
  const parts = {};
  const glassParts = {};
  const allParts = [];
  const matFor = (name) => {
    if (name === 'under') return MATS.under();
    if (name === 'windshield' || name === 'rearGlass' || name === 'glassQ' || name.startsWith('win')) return glass;
    return paint;
  };
  const pivotFor = (name, rest) => {
    const f = prof.f;
    if (name === 'hood') return new THREE.Vector3(0, f.top(Z.cowl) + 0.01, Z.cowl);
    if (name === 'trunk') return new THREE.Vector3(0, f.top(Z.deck) + 0.01, Z.deck);
    if (name.startsWith('door')) {
      const d = b.doors[name[4] + 'L'];
      const s = name[5] === 'L' ? 1 : -1;
      return new THREE.Vector3(s * f.hw(d[1]) * 0.96, f.belt(d[1]) - 0.1, d[1]);
    }
    if (name === 'bumperF') return new THREE.Vector3(prof.hwMax * 0.85, 0.5, prof.zF - 0.15);
    if (name === 'bumperR') return new THREE.Vector3(-prof.hwMax * 0.85, 0.5, prof.zR + 0.15);
    return new THREE.Vector3();
  };
  // doors first so windows can attach to them
  const names = Object.keys(loft.parts).sort((a, c) => (a.startsWith('door') ? -1 : 0) - (c.startsWith('door') ? -1 : 0));
  for (const name of names) {
    const cp = compactPart(loft, loft.parts[name]);
    let parentGroup = design;
    let pivot = pivotFor(name, cp.positions);
    let isWin = name.startsWith('win');
    if (isWin) {
      const door = parts['door' + name[3] + name[4]];
      if (door) {
        parentGroup = door.group;
        pivot = door.pivot;
      }
    }
    const geo = new THREE.BufferGeometry();
    const local = cp.positions.slice();
    for (let i = 0; i < local.length; i += 3) {
      local[i] -= pivot.x;
      local[i + 1] -= pivot.y;
      local[i + 2] -= pivot.z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(local, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(cp.uvs, 2));
    geo.setIndex(cp.indices);
    geo.computeVertexNormals();
    const part = new Part(name, geo, cp.positions, pivot, matFor(name), parentGroup);
    if (isWin && parentGroup !== design) {
      // the window's pivot is the door's, but its group must not re-offset
      part.group.position.set(0, 0, 0);
      parts['door' + name[3] + name[4]].children.push(part);
    }
    if (matFor(name) === glass) {
      part.mesh.castShadow = false;
      part.mesh.renderOrder = 2;
      glassParts[name] = part;
    }
    parts[name] = part;
    allParts.push(part);
  }
  // interior liner (inside of the shell), shares geometry so dents show inside
  if (!npc) {
    for (const name of ['body', 'doorFL', 'doorFR', 'doorRL', 'doorRR', 'hood', 'trunk']) {
      const p = parts[name];
      if (!p) continue;
      const liner = new THREE.Mesh(p.mesh.geometry, MATS.liner());
      liner.receiveShadow = true;
      p.group.add(liner);
      p.liner = liner;
    }
  } else if (parts.body) {
    parts.body.mesh.material = paint;
  }

  // wheel arch liners
  for (const az of b.axles) {
    for (const s of [1, -1]) {
      const g = new THREE.CylinderGeometry(prof.Ra - 0.01, prof.Ra - 0.01, 0.34, 16, 1, true, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, MATS.arch());
      const hw = prof.f.hw(az);
      m.position.set(s * (hw - 0.2), b.R, az);
      parts.body.group.add(m);
    }
  }

  // ---------------- lights ----------------
  const lights = buildLights(cfg, prof, design, parts, npc);

  // ---------------- details ----------------
  const details = buildDetails(cfg, prof, design, parts, tuning, npc, opts);

  // ---------------- wheels ----------------
  const wheels = tuning.wheels.map((w) => {
    const wh = buildWheel({
      radius: w.radius,
      rimRadius: Math.min(w.rimRadius, w.radius - 0.07),
      width: w.width,
      style: cfg.wheelStyle,
      color: cfg.wheelColor,
      left: w.left,
      caliperColor: npc ? '#505358' : cfg.body === 'coupe' || cfg.tune > 1 ? '#c8161d' : '#6a6d72',
      shared: npc,
    });
    root.add(wh.group);
    return wh;
  });

  // ---------------- hull collision points ----------------
  const hullRest = [];
  const half = new Float64Array(HALF * 2);
  const hz = [prof.zR + 0.03, prof.zR + 0.4, b.axles[1], (b.axles[1] + 0) / 2, 0, b.axles[0] / 2, b.axles[0], prof.zF - 0.4, prof.zF - 0.03];
  for (const z of hz) {
    prof.ring(z, half);
    for (const h of [1, 3, 5]) for (const s of [1, -1]) hullRest.push(half[h * 2] * s, half[h * 2 + 1], z);
    if (z > Z.roofR - 0.05 && z < Z.roofF + 0.05 && !(Z.bed && z < Z.bed[1])) {
      for (const s of [1, -1]) hullRest.push(half[8 * 2] * s, half[8 * 2 + 1], z);
    }
    if (z === hz[0] || z === hz[hz.length - 1]) {
      hullRest.push(0, half[3 * 2 + 1], z);
      hullRest.push(0, half[5 * 2 + 1], z);
    }
  }
  // roof centre points (rollovers)
  for (const z of [Z.roofR, (Z.roofF + Z.roofR) / 2, Z.roofF]) hullRest.push(0, prof.f.top(z), z);
  const hullRestArr = new Float32Array(hullRest);
  const hullBinding = lattice.bind(hullRestArr);
  const hull = hullRestArr.slice();

  const seat = new THREE.Vector3(b.seat.x, b.seat.y, b.seat.z);

  const model = {
    cfg,
    prof,
    root,
    design,
    parts,
    allParts,
    glassParts,
    lattice,
    livery,
    paint,
    glass,
    lights,
    details,
    wheels,
    hullRest: hullRestArr,
    hullBinding,
    hull,
    seat,
    com: tuning.com.clone(),
    npc,
    deformVersion: 0,
  };
  model.applyDeformation = () => {
    for (const p of allParts) if (p.state !== 'detached' && p.state !== 'shattered') p.deform(lattice, npc ? 0.06 : 0.08);
    lattice.apply(hullBinding, hullRestArr, hull, 0);
    for (const l of lights.all) l.deform(lattice);
    model.deformVersion = lattice.version;
  };
  root.traverse((o) => {
    if (o.isMesh && o.castShadow === undefined) o.castShadow = true;
  });
  return model;
}

// ------------------------------------------------------------------ lights
class LightUnit {
  constructor(mesh, mat, group, restCenter) {
    this.mesh = mesh;
    this.mat = mat;
    this.group = group;
    this.rest = restCenter.clone();
    this.base = mesh.position.clone();
    this.broken = false;
    this.binding = null;
  }
  deform(lattice) {
    if (!this.binding) this.binding = lattice.bind([this.rest.x, this.rest.y, this.rest.z]);
    const out = new Float32Array(3);
    lattice.apply(this.binding, new Float32Array([this.rest.x, this.rest.y, this.rest.z]), out);
    this.mesh.position.set(this.base.x + out[0] - this.rest.x, this.base.y + out[1] - this.rest.y, this.base.z + out[2] - this.rest.z);
  }
}

function lampGeometry(w, h, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, h / 2 - 0.001, w / 2 - 0.001);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -d / 2);
  // planar UVs 0..1 on the face
  const uv = g.attributes.uv;
  const p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return g;
}

function placeOnSkin(prof, mesh, x0, x1, y, h, dir) {
  const zc = skinZ(prof, (x0 + x1) / 2, y, dir);
  const za = skinZ(prof, x0, y, dir);
  const zb = skinZ(prof, x1, y, dir);
  const zt = skinZ(prof, (x0 + x1) / 2, y + h * 0.4, dir);
  const zbm = skinZ(prof, (x0 + x1) / 2, y - h * 0.4, dir);
  mesh.position.set((x0 + x1) / 2, y, zc - dir * 0.012);
  const yaw = Math.atan2(zb - za, x1 - x0);
  const pitch = Math.atan2(zt - zbm, h * 0.8);
  mesh.rotation.set(pitch * dir, -yaw, 0, 'YXZ');
  if (dir < 0) mesh.rotation.y += Math.PI;
  return new THREE.Vector3((x0 + x1) / 2, y, zc);
}

function buildLights(cfg, prof, design, parts, npc) {
  const b = prof.b;
  const headColor = { halogen: 0xfff1d6, xenon: 0xeef4ff, blue: 0xbcd4ff, yellow: 0xffe08a }[cfg.headlights] || 0xfff1d6;
  const all = [];
  const out = { all, head: [], tail: [], indF: [], indR: [], reverse: [], brake3: null, headColor };
  const bodyGroup = parts.bumperF ? parts.body.group : design;
  const headTex = lightTexture('head');
  const tailTex = lightTexture('tail');
  for (const s of [1, -1]) {
    // headlight
    const hd = b.head;
    const w = hd.x1 - hd.x0;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, map: headTex, emissive: new THREE.Color(headColor), emissiveMap: headTex, emissiveIntensity: 0, roughness: 0.1, metalness: 0.4 });
    const m = new THREE.Mesh(lampGeometry(w, hd.h, 0.08, 0.035), mat);
    const x0 = s * hd.x0, x1 = s * hd.x1;
    const c = placeOnSkin(prof, m, s > 0 ? x0 : x1, s > 0 ? x1 : x0, hd.y, hd.h, 1);
    bodyGroup.add(m);
    const u = new LightUnit(m, mat, bodyGroup, c);
    u.side = s;
    out.head.push(u);
    all.push(u);
    // front indicator (amber, below/outboard)
    const imat = new THREE.MeshStandardMaterial({ color: 0xffa640, emissive: new THREE.Color(0xff8a00), emissiveIntensity: 0, roughness: 0.2 });
    const im = new THREE.Mesh(lampGeometry(0.1, 0.04, 0.05, 0.015), imat);
    const ix0 = s * (hd.x1 - 0.12), ix1 = s * (hd.x1 - 0.02);
    const ic = placeOnSkin(prof, im, s > 0 ? ix0 : ix1, s > 0 ? ix1 : ix0, hd.y - hd.h * 0.5 - 0.035, 0.04, 1);
    bodyGroup.add(im);
    const iu = new LightUnit(im, imat, bodyGroup, ic);
    iu.side = s;
    out.indF.push(iu);
    all.push(iu);
    // tail light
    const tl = b.tail;
    const tw = tl.x1 - tl.x0;
    const tmat = new THREE.MeshStandardMaterial({ color: 0x8a0d10, map: tailTex, emissive: new THREE.Color(0xff1010), emissiveMap: tailTex, emissiveIntensity: 0, roughness: 0.15, metalness: 0.2 });
    const tm = new THREE.Mesh(lampGeometry(tw, tl.h, 0.07, 0.03), tmat);
    const tc = placeOnSkin(prof, tm, s > 0 ? s * tl.x0 : s * tl.x1, s > 0 ? s * tl.x1 : s * tl.x0, tl.y, tl.h, -1);
    bodyGroup.add(tm);
    const tu = new LightUnit(tm, tmat, bodyGroup, tc);
    tu.side = s;
    out.tail.push(tu);
    all.push(tu);
    // rear indicator + reverse (small, inboard)
    const rimat = new THREE.MeshStandardMaterial({ color: 0xffa640, emissive: new THREE.Color(0xff8a00), emissiveIntensity: 0, roughness: 0.2 });
    const rim = new THREE.Mesh(lampGeometry(0.09, Math.min(0.05, tl.h * 0.45), 0.05, 0.012), rimat);
    const ry = tl.y - tl.h * 0.5 - 0.04;
    const rc = placeOnSkin(prof, rim, s > 0 ? s * (tl.x1 - 0.1) : s * tl.x1 + 0.0, s > 0 ? s * tl.x1 : s * (tl.x1 - 0.1), ry, 0.05, -1);
    bodyGroup.add(rim);
    const ru = new LightUnit(rim, rimat, bodyGroup, rc);
    ru.side = s;
    out.indR.push(ru);
    all.push(ru);
    const rvmat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, roughness: 0.2 });
    const rv = new THREE.Mesh(lampGeometry(0.08, Math.min(0.05, tl.h * 0.45), 0.05, 0.012), rvmat);
    const rvc = placeOnSkin(prof, rv, s > 0 ? s * (tl.x0) : s * (tl.x0 + 0.09), s > 0 ? s * (tl.x0 + 0.09) : s * tl.x0, ry, 0.05, -1);
    bodyGroup.add(rv);
    const rvu = new LightUnit(rv, rvmat, bodyGroup, rvc);
    rvu.side = s;
    out.reverse.push(rvu);
    all.push(rvu);
  }
  // third brake light on top of the rear window
  if (!b.zones.bed) {
    const z = b.zones.roofR - 0.02;
    const y = prof.f.top(z) - 0.01;
    const bm = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: new THREE.Color(0xff0000), emissiveIntensity: 0 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.03), bm);
    m.position.set(0, y, z);
    design.add(m);
    out.brake3 = { mesh: m, mat: bm };
  }
  return out;
}

// ------------------------------------------------------------------ details
function buildDetails(cfg, prof, design, parts, tuning, npc, opts) {
  const b = prof.b;
  const f = prof.f;
  const Z = b.zones;
  const d = { mirrors: [], exhausts: [], wipers: [], plateTex: null, lightbar: null, underglow: null, driver: null };
  const bodyGroup = parts.body.group;
  // grille
  const gw = b.head.x0 * 2 - 0.08;
  const gy = b.head.y - 0.02;
  const gz = skinZ(prof, 0, gy, 1);
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(gw, b.head.h * 1.25), new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.6, metalness: 0.4 }));
  grille.position.set(0, gy, gz + 0.004);
  const pz = skinZ(prof, 0, gy + 0.1, 1);
  grille.rotation.x = -Math.atan2(pz - gz, 0.1) * 0.6;
  (parts.bumperF ? parts.bumperF.group : design).add(grille);
  grille.position.sub(parts.bumperF ? parts.bumperF.pivot : new THREE.Vector3());
  // plates
  const plateTex = plateTexture(cfg.plate || 'SAN 42');
  d.plateTex = plateTex;
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, metalness: 0.2 });
  for (const [dir, part] of [[1, 'bumperF'], [-1, 'bumperR']]) {
    const y = dir > 0 ? f.bottom(prof.zF - 0.1) + 0.12 : Math.min(b.tail.y - 0.12, f.bottom(prof.zR + 0.1) + 0.2);
    const z = skinZ(prof, 0, y, dir);
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.13), plateMat);
    pm.position.set(0, y, z + dir * 0.012);
    if (dir < 0) pm.rotation.y = Math.PI;
    const p = parts[part];
    if (p) {
      pm.position.sub(p.pivot);
      p.group.add(pm);
    } else design.add(pm);
  }
  // side mirrors (on the front doors)
  const doorF = b.doors.FL;
  for (const s of [1, -1]) {
    const z = doorF[1] - 0.12;
    const y = f.belt(z) + 0.08;
    const x = s * (f.hw(z) * 0.93 + 0.1);
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.1), npc ? parts.body.mesh.material : parts.body.mesh.material);
    housing.castShadow = true;
    const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.095), MATS.mirror());
    glassM.position.set(0, 0, -0.051);
    glassM.rotation.y = Math.PI;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), MATS.trim());
    arm.position.set(-s * 0.1, -0.03, 0.01);
    g.add(housing, glassM, arm);
    g.position.set(x, y, z);
    const door = parts['doorF' + (s > 0 ? 'L' : 'R')];
    if (door) {
      g.position.sub(door.pivot);
      door.group.add(g);
    } else design.add(g);
    d.mirrors.push({ group: g, glass: glassM, side: s, rest: new THREE.Vector3(x, y, z), attached: true, door });
  }
  // exhausts
  const nEx = cfg.exhaust === 'straight' ? 2 : cfg.exhaust === 'sport' ? 2 : 1;
  const exY = Math.max(0.22, f.bottom(prof.zR + 0.15) + 0.02);
  for (let i = 0; i < nEx; i++) {
    const s = nEx === 1 ? -1 : i === 0 ? 1 : -1;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12, 1, true), MATS.chrome());
    tip.rotation.x = Math.PI / 2;
    tip.position.set(s * prof.hwMax * 0.55, exY, prof.zR + 0.03);
    design.add(tip);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    inner.position.set(tip.position.x, exY, prof.zR + 0.06);
    inner.rotation.y = Math.PI;
    design.add(inner);
    d.exhausts.push(new THREE.Vector3(tip.position.x, exY, prof.zR - 0.05));
  }
  // spoiler
  if (cfg.spoiler !== 'none' && !Z.bed && cfg.body !== 'van') {
    const zt = prof.zR + 0.22;
    const yt = f.top(zt);
    const g = new THREE.Group();
    const w = prof.hwMax * (cfg.spoiler === 'lip' ? 1.5 : 1.75);
    const paintMat = parts.body.mesh.material;
    if (cfg.spoiler === 'lip') {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.12), paintMat);
      lip.rotation.x = -0.25;
      lip.position.y = 0.02;
      g.add(lip);
    } else {
      const h = cfg.spoiler === 'gt' ? 0.3 : 0.17;
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.quadraticCurveTo(0.12, 0.05, 0.3, 0.02);
      wingShape.lineTo(0.3, 0.0);
      wingShape.quadraticCurveTo(0.12, 0.015, 0, -0.012);
      const wg = new THREE.ExtrudeGeometry(wingShape, { depth: w, bevelEnabled: false });
      wg.rotateY(-Math.PI / 2);
      wg.translate(w / 2, 0, 0.12);
      const wing = new THREE.Mesh(wg, cfg.spoiler === 'gt' ? MATS.trim() : paintMat);
      wing.position.y = h;
      wing.rotation.x = 0.12;
      g.add(wing);
      for (const s of [1, -1]) {
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.08), MATS.trim());
        up.position.set(s * w * 0.32, h / 2, 0);
        g.add(up);
        if (cfg.spoiler === 'gt') {
          const ep = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.14, 0.34), MATS.trim());
          ep.position.set(s * w / 2, h + 0.02, 0.0);
          g.add(ep);
        }
      }
    }
    g.position.set(0, yt, zt);
    const trunk = parts.trunk;
    if (trunk) {
      g.position.sub(trunk.pivot);
      trunk.group.add(g);
    } else design.add(g);
    d.spoiler = g;
  }
  // police light bar / taxi sign
  if (opts.police) {
    const z = (Z.roofF + Z.roofR) / 2 + 0.1;
    const y = f.top(z);
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.26), MATS.trim());
    g.add(base);
    const red = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: new THREE.Color(0xff1020), emissiveIntensity: 0, transparent: true, opacity: 0.92 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x000055, emissive: new THREE.Color(0x2050ff), emissiveIntensity: 0, transparent: true, opacity: 0.92 });
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.22), red);
    l.position.set(0.28, 0.07, 0);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.22), blue);
    r.position.set(-0.28, 0.07, 0);
    g.add(l, r);
    g.position.set(0, y + 0.02, z);
    design.add(g);
    d.lightbar = { group: g, red, blue };
    // push bar
    const pb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.06), MATS.trim());
    pb.position.set(0, b.head.y - 0.1, skinZ(prof, 0, b.head.y - 0.1, 1) + 0.08);
    (parts.bumperF ? parts.bumperF.group : design).add(pb);
    if (parts.bumperF) pb.position.sub(parts.bumperF.pivot);
  }
  if (opts.taxi) {
    const z = (Z.roofF + Z.roofR) / 2;
    const y = f.top(z);
    const tex = cachedTexture('taxisign', 128, 32, (ctx, w, h) => {
      ctx.fillStyle = '#ffd21e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#111';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', w / 2, 25);
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 }));
    m.position.set(0, y + 0.08, z);
    design.add(m);
    d.taxiSign = m;
  }
  // underglow
  if (cfg.underglow && cfg.underglow !== 'none') {
    const tex = cachedTexture('glow', 64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(prof.hwMax * 3.2, b.L * 1.25),
      new THREE.MeshBasicMaterial({ color: cfg.underglow, map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.03, 0);
    m.renderOrder = 3;
    design.add(m);
    d.underglow = m;
  }
  // driver (visible through the windows)
  {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: npc ? ['#f1c7a5', '#c68e62', '#8d5a3b', '#5a3a24', '#e8b894'][Math.floor(Math.random() * 5)] : '#d9a57e', roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: npc ? new THREE.Color().setHSL(Math.random(), 0.4, 0.35) : '#2b3a55', roughness: 0.9 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skin);
    head.scale.set(0.9, 1.1, 1);
    head.position.set(0, 0.0, 0);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.104, 10, 6, 0, Math.PI * 2, 0, 1.6), new THREE.MeshStandardMaterial({ color: npc ? ['#1b1410', '#3b2718', '#8a6a3a', '#111', '#666'][Math.floor(Math.random() * 5)] : '#20150e', roughness: 1 }));
    hair.position.y = 0.02;
    hair.rotation.x = -0.4;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.22), shirt);
    torso.position.set(0, -0.36, -0.05);
    g.add(head, hair, torso);
    g.position.set(b.seat.x, b.seat.y, b.seat.z);
    design.add(g);
    d.driver = g;
    d.driverHead = head;
  }
  // wipers (visual)
  {
    const z = Z.cowl + 0.03;
    const y = f.top(Z.cowl) + 0.02;
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.32 - 0.08, y, z - 0.02);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.02), MATS.trim());
      blade.position.x = -0.27;
      pivot.add(blade);
      design.add(pivot);
      // tilt to lie on the windshield
      const slope = Math.atan2(f.top(Z.cowl - 0.25) - f.top(Z.cowl), 0.25);
      pivot.rotation.order = 'XYZ';
      pivot.rotation.x = slope;
      pivot.userData.slope = slope;
      d.wipers.push(pivot);
    }
  }
  return d;
}
