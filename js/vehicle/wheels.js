import * as THREE from 'three';
import { cachedTexture } from '../core/canvas.js';

export const WHEEL_STYLES = {
  fivespoke: { name: '5-spoke', spokes: 5, width: 0.34 },
  split: { name: 'Split 7', spokes: 7, width: 0.26, split: true },
  mesh: { name: 'Mesh', spokes: 10, width: 0.13 },
  deepdish: { name: 'Deep dish', spokes: 6, width: 0.22, dish: true },
  turbine: { name: 'Turbine', spokes: 14, width: 0.1, twist: 0.35 },
  steel: { name: 'Steelie', spokes: 0, holes: 8 },
  offroad: { name: 'Beadlock', spokes: 8, width: 0.28, beadlock: true },
};

const geoCache = new Map();

function tireTexture() {
  return cachedTexture('tire', 64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1b1b1c';
    ctx.fillRect(0, 0, w, h);
    // sidewall shade
    ctx.fillStyle = '#232324';
    ctx.fillRect(0, 0, w, h * 0.3);
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
    // tread blocks
    ctx.fillStyle = '#0d0d0e';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, h * (0.36 + i * 0.08), w, 3);
    ctx.fillRect(w * 0.45, h * 0.32, 5, h * 0.36);
    ctx.strokeStyle = '#2c2c2d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.22);
    ctx.lineTo(w, h * 0.22);
    ctx.moveTo(0, h * 0.78);
    ctx.lineTo(w, h * 0.78);
    ctx.stroke();
  }, { repeat: [28, 1] });
}

function tireGeometry(R, rimR, width) {
  const key = `tire:${R.toFixed(3)}:${rimR.toFixed(3)}:${width.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const hw = width / 2;
  const sw = R - rimR;
  const pts = [
    [rimR - 0.005, -hw * 0.82],
    [rimR + sw * 0.25, -hw * 1.02],
    [rimR + sw * 0.7, -hw * 1.04],
    [R - 0.025, -hw * 0.97],
    [R - 0.004, -hw * 0.8],
    [R, -hw * 0.5],
    [R, 0],
    [R, hw * 0.5],
    [R - 0.004, hw * 0.8],
    [R - 0.025, hw * 0.97],
    [rimR + sw * 0.7, hw * 1.04],
    [rimR + sw * 0.25, hw * 1.02],
    [rimR - 0.005, hw * 0.82],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 36);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X
  geoCache.set(key, g);
  return g;
}

function rimFaceGeometry(style, rimR) {
  const key = `rim:${style}:${rimR.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = WHEEL_STYLES[style] || WHEEL_STYLES.fivespoke;
  const outer = rimR * 0.97;
  const hub = rimR * 0.27;
  const inner = rimR * (s.dish ? 0.72 : s.beadlock ? 0.8 : 0.88);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  if (s.spokes > 0) {
    const n = s.spokes;
    const spokeFrac = s.width;
    for (let i = 0; i < n; i++) {
      const a0 = ((i + spokeFrac / 2) / n) * Math.PI * 2;
      const a1 = ((i + 1 - spokeFrac / 2) / n) * Math.PI * 2;
      const tw = s.twist || 0;
      const hole = new THREE.Path();
      const r0 = hub + 0.012;
      hole.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      hole.lineTo(Math.cos(a0 + tw) * inner, Math.sin(a0 + tw) * inner);
      hole.absarc(0, 0, inner, a0 + tw, a1 + tw, false);
      hole.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
      hole.absarc(0, 0, r0, a1, a0, true);
      if (s.split) {
        // split each gap with a thin extra spoke
        const am = (a0 + a1) / 2;
        const h1 = new THREE.Path();
        const w = 0.03;
        h1.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
        h1.lineTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
        h1.absarc(0, 0, inner, a0, am - w, false);
        h1.lineTo(Math.cos(am - w) * r0, Math.sin(am - w) * r0);
        h1.absarc(0, 0, r0, am - w, a0, true);
        const h2 = new THREE.Path();
        h2.moveTo(Math.cos(am + w) * r0, Math.sin(am + w) * r0);
        h2.lineTo(Math.cos(am + w) * inner, Math.sin(am + w) * inner);
        h2.absarc(0, 0, inner, am + w, a1, false);
        h2.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
        h2.absarc(0, 0, r0, a1, am + w, true);
        shape.holes.push(h1, h2);
      } else shape.holes.push(hole);
    }
  } else {
    const n = s.holes || 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * rimR * 0.58, Math.sin(a) * rimR * 0.58, rimR * 0.11, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 2,
    curveSegments: 20,
  });
  g.rotateY(Math.PI / 2); // extrude +z -> +x (outward for a left wheel)
  geoCache.set(key, g);
  return g;
}

function cylinderX(r0, r1, len, seg, open) {
  const key = `cyl:${r0}:${r1}:${len}:${seg}:${open}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1, open);
  g.rotateZ(Math.PI / 2);
  geoCache.set(key, g);
  return g;
}

const matCache = new Map();
function sharedMat(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}

/**
 * Wheel assembly. Structure:
 *   group (hub carrier: position, steer, camber)
 *     spin (rotates with the wheel): tyre, rim face, barrel, disc, nut
 *     caliper (doesn't spin)
 * Right-side wheels are mirrored so the rim face points outward.
 */
export function buildWheel(opts) {
  const { radius, rimRadius, width, style, color, left, caliperColor, shared } = opts;
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const tireMat = sharedMat('tire', () => {
    const map = tireTexture();
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.92, metalness: 0 });
  });
  const tire = new THREE.Mesh(tireGeometry(radius, rimRadius, width), tireMat);
  tire.castShadow = true;
  spin.add(tire);

  const rimMat = shared
    ? sharedMat(`rim:${color}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.28 }))
    : new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.25 });
  const face = new THREE.Mesh(rimFaceGeometry(style, rimRadius), rimMat);
  face.position.x = width * 0.28;
  face.castShadow = true;
  spin.add(face);
  const s = WHEEL_STYLES[style] || WHEEL_STYLES.fivespoke;
  if (s.dish || s.beadlock) {
    const lip = new THREE.Mesh(cylinderX(rimRadius * 0.99, rimRadius * 0.99, 0.05, 28, true), sharedMat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.12, side: THREE.DoubleSide })));
    lip.position.x = width * 0.34;
    spin.add(lip);
  }
  const barrelMat = sharedMat('barrel', () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }));
  const barrel = new THREE.Mesh(cylinderX(rimRadius * 0.98, rimRadius * 0.98, width * 0.8, 24, true), barrelMat);
  spin.add(barrel);
  const nutMat = sharedMat('nut', () => new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 }));
  const nut = new THREE.Mesh(cylinderX(rimRadius * 0.12, rimRadius * 0.14, 0.05, 12, false), nutMat);
  nut.position.x = width * 0.3 + 0.02;
  spin.add(nut);
  const discMat = shared
    ? sharedMat('disc', () => new THREE.MeshStandardMaterial({ color: 0x77797d, metalness: 0.8, roughness: 0.45 }))
    : new THREE.MeshStandardMaterial({ color: 0x77797d, metalness: 0.8, roughness: 0.4, emissive: new THREE.Color(1, 0.25, 0.02), emissiveIntensity: 0 });
  const disc = new THREE.Mesh(cylinderX(rimRadius * 0.78, rimRadius * 0.78, 0.028, 28, false), discMat);
  disc.position.x = width * 0.05;
  spin.add(disc);
  const calMat = sharedMat(`caliper:${caliperColor}`, () => new THREE.MeshStandardMaterial({ color: caliperColor, metalness: 0.3, roughness: 0.45 }));
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, rimRadius * 0.45, rimRadius * 0.3), calMat);
  caliper.position.set(width * 0.1, rimRadius * 0.55, -rimRadius * 0.25);
  caliper.rotation.x = 0.5;
  group.add(caliper);
  if (!left) group.scale.x = -1;
  return { group, spin, tire, face, disc, discMat, radius };
}
