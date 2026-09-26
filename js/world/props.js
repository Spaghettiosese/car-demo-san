import * as THREE from 'three';
import { CITY, roadCoord } from './city.js';
import { mulberry32 } from '../core/util.js';
import { glowTexture } from './textures.js';

const { RW, LANE } = CITY;

// kind: mass (kg), breakAt (m/s closing speed), dent (effective mass felt by the car), radius, height
const KINDS = {
  lamp: { mass: 140, breakAt: 4.5, dent: 700, r: 0.16, h: 8 },
  tree: { mass: 0, breakAt: Infinity, dent: 0, r: 0.3, h: 3 },
  hydrant: { mass: 90, breakAt: 3.5, dent: 450, r: 0.22, h: 0.8 },
  trash: { mass: 18, breakAt: 0.3, dent: 30, r: 0.3, h: 1.0 },
  bench: { mass: 45, breakAt: 1.5, dent: 110, r: 0.55, h: 0.9 },
  mailbox: { mass: 40, breakAt: 2, dent: 130, r: 0.3, h: 1.2 },
  meter: { mass: 14, breakAt: 1.5, dent: 60, r: 0.12, h: 1.3 },
  cone: { mass: 3, breakAt: 0, dent: 4, r: 0.22, h: 0.75 },
  barrier: { mass: 30, breakAt: 0.5, dent: 80, r: 0.6, h: 1.0 },
  barrel: { mass: 22, breakAt: 0, dent: 50, r: 0.32, h: 0.9 },
  signal: { mass: 0, breakAt: Infinity, dent: 0, r: 0.2, h: 6 },
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, ...opts });
}

/** Geometry templates: list of [geometry, material, matrix] per kind. */
function templates() {
  const T = {};
  const m4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  const poleMat = mat(0x3c4046, { metalness: 0.7, roughness: 0.45 });
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: new THREE.Color(1, 0.85, 0.6), emissiveIntensity: 0, roughness: 0.3 });
  T.lamp = [
    [new THREE.CylinderGeometry(0.09, 0.14, 8, 8), poleMat, m4(0, 4, 0)],
    [new THREE.BoxGeometry(0.12, 0.12, 2.2), poleMat, m4(0, 7.9, 1.05)],
    [new THREE.BoxGeometry(0.45, 0.14, 0.7), poleMat, m4(0, 7.85, 2.1)],
    [new THREE.BoxGeometry(0.38, 0.04, 0.6), lampHeadMat, m4(0, 7.77, 2.1)],
  ];
  T.lampHeadMat = lampHeadMat;
  const trunk = mat(0x5a4332, { metalness: 0, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.95, flatShading: true });
  T.tree = [
    [new THREE.CylinderGeometry(0.16, 0.26, 3.2, 7), trunk, m4(0, 1.6, 0)],
    [new THREE.IcosahedronGeometry(2.2, 1), leaves, m4(0, 4.2, 0)],
    [new THREE.IcosahedronGeometry(1.6, 1), leaves, m4(0.6, 5.4, 0.3)],
  ];
  const red = mat(0xb3261e, { metalness: 0.4 });
  T.hydrant = [
    [new THREE.CylinderGeometry(0.15, 0.18, 0.65, 10), red, m4(0, 0.33, 0)],
    [new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red, m4(0, 0.65, 0)],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8), red, m4(0, 0.45, 0, 0, 0, Math.PI / 2)],
  ];
  T.trash = [
    [new THREE.CylinderGeometry(0.28, 0.24, 0.95, 12, 1, true), mat(0x2f4f3a, { side: THREE.DoubleSide }), m4(0, 0.48, 0)],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), mat(0x1c2a20), m4(0, 0.97, 0)],
  ];
  const wood = mat(0x7a5634, { metalness: 0, roughness: 0.9 });
  const iron = mat(0x222428);
  T.bench = [
    [new THREE.BoxGeometry(1.6, 0.06, 0.45), wood, m4(0, 0.45, 0)],
    [new THREE.BoxGeometry(1.6, 0.4, 0.05), wood, m4(0, 0.75, -0.2)],
    [new THREE.BoxGeometry(0.06, 0.45, 0.45), iron, m4(-0.7, 0.22, 0)],
    [new THREE.BoxGeometry(0.06, 0.45, 0.45), iron, m4(0.7, 0.22, 0)],
  ];
  const blue = mat(0x1d4fa0, { metalness: 0.5 });
  T.mailbox = [
    [new THREE.BoxGeometry(0.5, 0.8, 0.45), blue, m4(0, 0.75, 0)],
    [new THREE.CylinderGeometry(0.225, 0.225, 0.5, 12, 1, false, 0, Math.PI), blue, m4(0, 1.15, 0, 0, 0, Math.PI / 2)],
    [new THREE.BoxGeometry(0.06, 0.35, 0.06), iron, m4(-0.18, 0.17, -0.15)],
    [new THREE.BoxGeometry(0.06, 0.35, 0.06), iron, m4(0.18, 0.17, 0.15)],
  ];
  T.meter = [
    [new THREE.CylinderGeometry(0.04, 0.05, 1.1, 6), iron, m4(0, 0.55, 0)],
    [new THREE.BoxGeometry(0.18, 0.28, 0.14), mat(0x777b80, { metalness: 0.8 }), m4(0, 1.22, 0)],
  ];
  const orange = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  T.cone = [
    [new THREE.ConeGeometry(0.17, 0.7, 10), orange, m4(0, 0.38, 0)],
    [new THREE.CylinderGeometry(0.105, 0.125, 0.12, 10, 1, true), white, m4(0, 0.4, 0)],
    [new THREE.BoxGeometry(0.4, 0.04, 0.4), orange, m4(0, 0.02, 0)],
  ];
  T.barrier = [
    [new THREE.BoxGeometry(1.2, 0.2, 0.06), orange, m4(0, 0.85, 0)],
    [new THREE.BoxGeometry(1.2, 0.2, 0.06), white, m4(0, 0.55, 0)],
    [new THREE.BoxGeometry(0.06, 1.0, 0.06), iron, m4(-0.5, 0.5, 0)],
    [new THREE.BoxGeometry(0.06, 1.0, 0.06), iron, m4(0.5, 0.5, 0)],
  ];
  T.barrel = [
    [new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), mat(0x2463a8, { metalness: 0.6, roughness: 0.4 }), m4(0, 0.45, 0)],
    [new THREE.TorusGeometry(0.3, 0.02, 6, 16), iron, m4(0, 0.3, 0, Math.PI / 2)],
    [new THREE.TorusGeometry(0.3, 0.02, 6, 16), iron, m4(0, 0.62, 0, Math.PI / 2)],
  ];
  return T;
}

/**
 * Street furniture, trees and traffic signals.
 */
export class Props {
  constructor(game, city) {
    this.game = game;
    this.city = city;
    this.world = city.world;
    this.scene = game.scene;
    this.T = templates();
    this.items = [];
    this.byKind = {};
    this.meshes = {};
    this.rng = mulberry32(4242);
    this.fountains = [];
    this.pools = null;
    this.night = 0;
  }

  add(kind, x, z, yaw = 0, y = 0) {
    const k = KINDS[kind];
    const it = { kind, x, y, z, yaw, idx: 0, broken: false, def: k };
    it.idx = (this.byKind[kind] ||= []).push(it) - 1;
    this.items.push(it);
    if (k.r > 0) it.cyl = this.world.addCylinder(x, z, k.r, y, y + k.h, { kind, ref: k.mass > 0 ? { breakable: true, item: it } : null });
    return it;
  }

  build() {
    const city = this.city;
    const rnd = this.rng;
    // street lamps, trees and furniture along every block edge that faces a road
    for (const b of city.blocks) {
      const sides = [
        { x0: b.x0, x1: b.x1, z: b.z0, n: [0, -1] },
        { x0: b.x0, x1: b.x1, z: b.z1, n: [0, 1] },
        { z0: b.z0, z1: b.z1, x: b.x0, n: [-1, 0] },
        { z0: b.z0, z1: b.z1, x: b.x1, n: [1, 0] },
      ];
      const base = b.flat ? CITY.CURB : CITY.CURB;
      for (const s of sides) {
        const horiz = s.z !== undefined;
        const a0 = horiz ? s.x0 : s.z0, a1 = horiz ? s.x1 : s.z1;
        const yaw = Math.atan2(s.n[0], s.n[1]); // arm points to the road
        const inGap = (a) => (b.gaps || []).some((g) => g.side === (horiz ? (s.n[1] < 0 ? 's' : 'n') : s.n[0] < 0 ? 'w' : 'e') && a > g.from - 2 && a < g.to + 2);
        for (let a = a0 + 14; a < a1 - 10; a += 30) {
          if (inGap(a)) continue;
          const x = horiz ? a : s.x - s.n[0] * 0.8, z = horiz ? s.z - s.n[1] * 0.8 : a;
          this.add('lamp', x, z, yaw, base);
        }
        if (b.type === 'residential' || b.type === 'midtown' || b.type === 'plaza') {
          for (let a = a0 + 29; a < a1 - 10; a += 30) {
            if (inGap(a) || rnd() < 0.2) continue;
            const x = horiz ? a : s.x - s.n[0] * 1.6, z = horiz ? s.z - s.n[1] * 1.6 : a;
            this.add('tree', x, z, rnd() * 6, base);
          }
        }
        if (!b.flat || true) {
          if (rnd() < 0.8) {
            const a = a0 + 8 + rnd() * (a1 - a0 - 16);
            if (!inGap(a)) this.add('hydrant', horiz ? a : s.x - s.n[0] * 0.6, horiz ? s.z - s.n[1] * 0.6 : a, 0, base);
          }
          if (rnd() < 0.7) {
            const a = rnd() < 0.5 ? a0 + 3 : a1 - 3;
            this.add('trash', horiz ? a : s.x - s.n[0] * 1.2, horiz ? s.z - s.n[1] * 1.2 : a, 0, base);
          }
          if (b.type === 'midtown' && rnd() < 0.8) {
            for (let a = a0 + 20; a < a1 - 20; a += 12 + rnd() * 10) {
              if (inGap(a)) continue;
              this.add('meter', horiz ? a : s.x - s.n[0] * 0.5, horiz ? s.z - s.n[1] * 0.5 : a, yaw, base);
            }
          }
          if ((b.type === 'midtown' || b.type === 'downtown' || b.type === 'plaza') && rnd() < 0.6) {
            const a = a0 + 20 + rnd() * (a1 - a0 - 40);
            if (!inGap(a)) this.add('bench', horiz ? a : s.x - s.n[0] * 3, horiz ? s.z - s.n[1] * 3 : a, yaw + Math.PI, base);
          }
          if (rnd() < 0.3) {
            const a = a0 + 12 + rnd() * (a1 - a0 - 24);
            if (!inGap(a)) this.add('mailbox', horiz ? a : s.x - s.n[0] * 0.8, horiz ? s.z - s.n[1] * 0.8 : a, yaw, base);
          }
        }
      }
      if (b.trees) for (const [x, z] of b.trees) this.add('tree', x, z, rnd() * 6, CITY.CURB);
      if (b.fountain) this.fountains.push({ p: b.fountain, t: 0 });
      if (b.cones) {
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        for (let k = 0; k < 14; k++) this.add('cone', cx - 30 + k * 4, cz - 30, 0, 0.01);
        for (let k = 0; k < 6; k++) this.add('barrier', cx + 25, cz - 20 + k * 1.3, Math.PI / 2, 0.01);
        for (let k = 0; k < 8; k++) this.add('barrel', cx - 35 + (k % 4) * 0.7, cz + 20 + Math.floor(k / 4) * 0.7, 0, 0.01);
      }
    }
    // proving grounds: slalom cones, barrel pyramid at the crash wall
    const pg = city.locations.proving;
    if (pg) {
      const x0 = pg.pos.x + 30;
      for (let k = 0; k < 12; k++) this.add('cone', x0 + 40, -260 + k * 18, 0, 0);
      for (let k = 0; k < 10; k++) this.add('cone', x0 + 40 + (k % 2 ? 3 : -3), -40 + k * 14, 0, 0);
      const wx = city.crashWall.x - 6;
      let n = 0;
      for (let row = 0; row < 4; row++)
        for (let k = 0; k < 4 - row; k++) {
          this.add('barrel', wx, 20 + k * 0.66 + row * 0.33 - 1, 0, row * 0.9 + 0.01);
          n++;
        }
      for (let k = 0; k < 10; k++) this.add('barrier', wx - 1, -30 + k * 1.3, Math.PI / 2, 0);
      void n;
    }
    this.buildInstances();
    this.buildSignals();
  }

  buildInstances() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (const kind in this.byKind) {
      const list = this.byKind[kind];
      const parts = this.T[kind];
      const meshes = parts.map(([geo, material, local]) => {
        const im = new THREE.InstancedMesh(geo, material, list.length);
        im.castShadow = kind !== 'cone';
        im.receiveShadow = true;
        list.forEach((it, i) => {
          const scale = kind === 'tree' ? 0.8 + ((i * 7919) % 100) / 200 : 1;
          s.setScalar(scale);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
          p.set(it.x, it.y, it.z);
          m.compose(p, q, s).multiply(local);
          im.setMatrixAt(i, m);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        return im;
      });
      this.meshes[kind] = meshes;
    }
    // warm light pools under street lamps (visible at night)
    const lamps = this.byKind.lamp || [];
    const pmat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(1.0, 0.72, 0.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const pg = new THREE.PlaneGeometry(14, 14);
    pg.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(pg, pmat, lamps.length);
    lamps.forEach((it, i) => {
      const hx = it.x + Math.sin(it.yaw) * 2.1, hz = it.z + Math.cos(it.yaw) * 2.1;
      m.makeTranslation(hx, 0.03, hz);
      pools.setMatrixAt(i, m);
    });
    pools.renderOrder = 2;
    this.scene.add(pools);
    this.pools = pools;
    this.poolMat = pmat;
  }

  // ---------------------------------------------------------------- signals
  buildSignals() {
    const city = this.city;
    const heads = [];
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.16, 6.2, 8);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 1);
    const headGeo = new THREE.BoxGeometry(0.4, 1.05, 0.3);
    const lampGeo = new THREE.SphereGeometry(0.12, 10, 8);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.6, metalness: 0.4 });
    const yel = new THREE.MeshStandardMaterial({ color: 0x3b3a1f, roughness: 0.6, metalness: 0.4 });
    const approaches = [];
    for (const s of city.segments) if (s.to.signal) approaches.push(s);
    const poles = new THREE.InstancedMesh(poleGeo, dark, approaches.length);
    const arms = new THREE.InstancedMesh(armGeo, dark, approaches.length);
    const hMesh = new THREE.InstancedMesh(headGeo, yel, approaches.length * 2);
    const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), approaches.length * 6);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const tmp = new THREE.Vector3();
    approaches.forEach((s, i) => {
      const n = s.to;
      const c = new THREE.Vector3(n.x, 0, n.z);
      const corner = c.clone().addScaledVector(s.dir, -(RW / 2 + 1.3)).addScaledVector(s.right, RW / 2 + 1.3);
      m.compose(tmp.set(corner.x, CITY.CURB + 3.1, corner.z), q.identity(), one);
      poles.setMatrixAt(i, m);
      this.world.addCylinder(corner.x, corner.z, 0.2, 0, 6.3, { kind: 'signal' });
      // mast arm over the lanes (toward -right)
      const armLen = RW / 2 + 1.3 - LANE * 0.5;
      const armMid = corner.clone().addScaledVector(s.right, -armLen / 2);
      const yaw = Math.atan2(s.right.x, s.right.z);
      q.setFromAxisAngle(up, yaw);
      m.compose(tmp.set(armMid.x, CITY.CURB + 6, armMid.z), q, new THREE.Vector3(1, 1, armLen));
      arms.setMatrixAt(i, m);
      // heads face oncoming traffic (-dir)
      const headYaw = Math.atan2(-s.dir.x, -s.dir.z);
      const hq = new THREE.Quaternion().setFromAxisAngle(up, headYaw);
      const hp1 = corner.clone().addScaledVector(s.right, -armLen + 0.4);
      hp1.y = CITY.CURB + 5.35;
      const hp2 = corner.clone().addScaledVector(s.dir, 0.25);
      hp2.y = CITY.CURB + 2.9;
      [hp1, hp2].forEach((hp, k) => {
        m.compose(hp, hq, one);
        hMesh.setMatrixAt(i * 2 + k, m);
        for (let l = 0; l < 3; l++) {
          const lp = hp.clone().addScaledVector(s.dir, -0.16);
          lp.y += 0.32 - l * 0.32;
          m.compose(lp, hq, one);
          lamps.setMatrixAt(i * 6 + k * 3 + l, m);
        }
      });
      heads.push({ seg: s, base: i * 6, state: null });
    });
    for (const im of [poles, arms, hMesh, lamps]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = im !== lamps;
      this.scene.add(im);
    }
    lamps.setColorAt(0, new THREE.Color());
    this.signalLamps = lamps;
    this.signalHeads = heads;
    this.updateSignals(true);
  }

  updateSignals(force) {
    const colors = {
      red: [new THREE.Color(6, 0.15, 0.08), new THREE.Color(0.08, 0.06, 0.02), new THREE.Color(0.02, 0.06, 0.03)],
      yellow: [new THREE.Color(0.1, 0.02, 0.02), new THREE.Color(6, 3.6, 0.2), new THREE.Color(0.02, 0.06, 0.03)],
      green: [new THREE.Color(0.1, 0.02, 0.02), new THREE.Color(0.08, 0.06, 0.02), new THREE.Color(0.2, 5, 1.6)],
    };
    let dirty = false;
    for (const h of this.signalHeads) {
      const st = this.city.signalFor(h.seg);
      if (st === h.state && !force) continue;
      h.state = st;
      dirty = true;
      for (let k = 0; k < 2; k++) for (let l = 0; l < 3; l++) this.signalLamps.setColorAt(h.base + k * 3 + l, colors[st][l]);
    }
    if (dirty) this.signalLamps.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- breaking
  /** A car touched a breakable pole-like prop. Returns true if it broke (car passes through). */
  hitPole(cy, car, point, normal, vrel) {
    const it = cy.ref.item;
    if (it.broken) return true;
    const k = it.def;
    const closing = -vrel;
    if (closing < k.breakAt) return false;
    this.breakItem(it, car, point, normal, closing);
    return true;
  }

  breakItem(it, car, point, normal, closing) {
    const k = it.def;
    it.broken = true;
    cy_remove(this.world, it);
    // hide instance
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const im of this.meshes[it.kind]) {
      im.setMatrixAt(it.idx, zero);
      im.instanceMatrix.needsUpdate = true;
    }
    if (it.kind === 'lamp' && this.pools) {
      this.pools.setMatrixAt(it.idx, zero);
      this.pools.instanceMatrix.needsUpdate = true;
    }
    // the car feels the hit
    if (car) {
      const J = Math.min(k.dent * closing, car.tuning.mass * closing * 0.6);
      const jv = normal.clone().multiplyScalar(J);
      car.body.applyImpulse(jv, point);
      car.registerImpact(point, normal, J, null, 0, it.kind);
    }
    // spawn the physical object
    const g = new THREE.Group();
    for (const [geo, material, local] of this.T[it.kind]) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.applyMatrix4(local);
      mesh.castShadow = true;
      g.add(mesh);
    }
    g.position.set(it.x, it.y, it.z);
    g.rotation.y = it.yaw;
    this.scene.add(g);
    const vel = car ? car.body.velocity.clone().multiplyScalar(car.tuning.mass / (car.tuning.mass + k.mass) * 1.05) : new THREE.Vector3();
    vel.y += 1 + Math.random() * 2 * Math.min(1, closing / 10);
    const debris = this.game.debris;
    if (debris) {
      const item = debris.spawnFromObject(g, vel, k.mass, { kind: it.kind, maxLife: 400 });
      if (it.kind === 'lamp') item.body.angularVelocity.multiplyScalar(0.3);
      if (car && item) {
        // tip it over in the direction of travel
        const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), car.body.velocity).normalize();
        item.body.angularVelocity.addScaledVector(axis, Math.min(6, closing * 0.35));
      }
    }
    if (it.kind === 'hydrant') this.fountains.push({ p: new THREE.Vector3(it.x, it.y + 0.2, it.z), t: 40, geyser: true });
    this.game.onPropHit?.(it, closing, point);
  }

  update(dt, camPos) {
    this.updateSignals(false);
    const fx = this.game.fx;
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      if (camPos && f.p.distanceToSquared(camPos) > 150 * 150) continue;
      if (f.geyser) {
        f.t -= dt;
        fx?.water(f.p, 1, 1.4);
        if (f.t <= 0) this.fountains.splice(i, 1);
      } else if (Math.random() < 0.5) fx?.water(f.p, 0.55, 0.5);
    }
  }

  setNight(f) {
    this.night = f;
    if (this.T.lampHeadMat) this.T.lampHeadMat.emissiveIntensity = f * 6;
    if (this.poolMat) this.poolMat.opacity = f * 0.55;
  }

  reset() {
    // restore broken props (sandbox "reset world")
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (const it of this.items) {
      if (!it.broken) continue;
      it.broken = false;
      it.cyl = this.world.addCylinder(it.x, it.z, it.def.r, it.y, it.y + it.def.h, { kind: it.kind, ref: { breakable: true, item: it } });
      this.T[it.kind].forEach(([, , local], k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
        m.compose(new THREE.Vector3(it.x, it.y, it.z), q, s).multiply(local);
        this.meshes[it.kind][k].setMatrixAt(it.idx, m);
        this.meshes[it.kind][k].instanceMatrix.needsUpdate = true;
      });
      if (it.kind === 'lamp' && this.pools) {
        m.makeTranslation(it.x + Math.sin(it.yaw) * 2.1, 0.03, it.z + Math.cos(it.yaw) * 2.1);
        this.pools.setMatrixAt(it.idx, m);
        this.pools.instanceMatrix.needsUpdate = true;
      }
    }
    this.fountains = this.fountains.filter((f) => !f.geyser);
  }

  collideCar() {}
}

function cy_remove(world, it) {
  if (it.cyl) world.removeCylinder(it.cyl);
  it.cyl = null;
}

export { KINDS, roadCoord };
