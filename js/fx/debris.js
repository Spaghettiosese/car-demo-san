import * as THREE from 'three';
import { RigidBody, resolveContact } from '../physics/body.js';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _l = new THREE.Vector3();
const _a = new THREE.Vector3();
const _g = { y: 0, nx: 0, ny: 1, nz: 0, mat: null };
const _boxes = [];
const _out = { vn: 0, jn: 0, slide: 0 };
const GRAV = new THREE.Vector3(0, -9.81, 0);

/**
 * Loose objects with real rigid-body physics: detached panels, wheels that
 * roll away, knocked-over street furniture. Each is a RigidBody with a small
 * cloud of contact points (box corners, or a ring for wheels).
 */
export class DebrisSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = [];
    this.max = 70;
    this.onHit = null; // (item, speed) -> sound
  }

  _add(holder, body, points, opts) {
    const item = {
      holder,
      body,
      points,
      radius: opts.radius,
      life: 0,
      maxLife: opts.maxLife ?? 240,
      kind: opts.kind || 'part',
      mat: opts.mat || 'metal',
      restitution: opts.restitution ?? 0.2,
      friction: opts.friction ?? 0.6,
      onGround: false,
      lastHit: 0,
    };
    this.items.push(item);
    if (this.items.length > this.max) {
      const old = this.items.shift();
      this.removeItem(old);
    }
    return item;
  }

  /** Detach an Object3D (keeps its world transform) and simulate it. */
  spawnFromObject(obj, vel, mass, opts = {}) {
    obj.updateWorldMatrix(true, true);
    obj.userData.origParent = obj.parent;
    obj.userData.origPosition = obj.position.clone();
    obj.userData.origQuaternion = obj.quaternion.clone();
    const box = new THREE.Box3();
    // bounding box in the object's own frame
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    obj.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      bb.applyMatrix4(m);
      box.union(bb);
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.2, -0.2, -0.2), new THREE.Vector3(0.2, 0.2, 0.2));
    const centerLocal = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.06, 0.06, 0.06));
    const holder = new THREE.Group();
    const wq = obj.getWorldQuaternion(new THREE.Quaternion());
    holder.position.copy(centerLocal).applyMatrix4(obj.matrixWorld);
    holder.quaternion.copy(wq);
    this.scene.add(holder);
    holder.attach(obj);
    const inertia = new THREE.Vector3(
      (mass / 12) * (size.y * size.y + size.z * size.z),
      (mass / 12) * (size.x * size.x + size.z * size.z),
      (mass / 12) * (size.x * size.x + size.y * size.y),
    );
    const body = new RigidBody(mass, inertia);
    body.position.copy(holder.position);
    body.quaternion.copy(wq);
    body.velocity.copy(vel);
    body.angularVelocity.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    body.linearDamping = 0.02;
    body.angularDamping = 0.3;
    body.updateDerived();
    const hs = size.clone().multiplyScalar(0.5);
    const pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(new THREE.Vector3(sx * hs.x, sy * hs.y, sz * hs.z));
    // face centres help flat panels slide instead of teetering on corners
    pts.push(new THREE.Vector3(0, -hs.y, 0), new THREE.Vector3(0, hs.y, 0));
    return this._add(holder, body, pts, { radius: hs.length(), ...opts, obj });
  }

  spawnWheel(group, vel, spin, radius, width) {
    const item = this.spawnFromObject(group, vel, 22, { kind: 'wheel', mat: 'rubber', restitution: 0.35, friction: 0.9 });
    // replace box points with a tyre ring (local x = axle)
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const s of [-0.5, 0.5]) pts.push(new THREE.Vector3(s * width, Math.cos(a) * radius, Math.sin(a) * radius));
    }
    // ring is around the holder centre; holder is at the wheel's bbox centre which is ~the hub
    item.points = pts;
    item.radius = radius;
    const I = 22 * radius * radius * 0.6;
    item.body.setMass(22, new THREE.Vector3(I, I * 0.55, I * 0.55));
    item.body.angularVelocity.copy(spin);
    item.body.angularDamping = 0.02;
    return item;
  }

  removeItem(item) {
    this.scene.remove(item.holder);
    item.removed = true;
  }

  /** Put a detached object back (repair). */
  reclaim(obj) {
    const i = this.items.findIndex((it) => it.holder.children.includes(obj));
    if (i >= 0) {
      const it = this.items[i];
      this.items.splice(i, 1);
      this.scene.remove(it.holder);
    }
    const parent = obj.userData.origParent;
    if (parent) {
      parent.add(obj);
      obj.position.copy(obj.userData.origPosition);
      obj.quaternion.copy(obj.userData.origQuaternion);
    }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.holder);
    this.items.length = 0;
  }

  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 180)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const it of this.items) {
        const b = it.body;
        if (b.sleeping) continue;
        b.integrateVelocity(h, GRAV);
        this.collideWorld(it, h);
        b.integratePosition(h);
        if (b.velocity.lengthSq() < 0.004 && b.angularVelocity.lengthSq() < 0.01 && it.onGround) {
          b.sleepTimer += h;
          if (b.sleepTimer > 1) b.sleeping = true;
        } else b.sleepTimer = 0;
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      it.lastHit = Math.max(0, it.lastHit - dt);
      it.holder.position.copy(it.body.position);
      it.holder.quaternion.copy(it.body.quaternion);
      if (it.life > it.maxLife || it.body.position.y < -50) {
        this.removeItem(it);
        this.items.splice(i, 1);
      }
    }
  }

  collideWorld(it, h) {
    const b = it.body;
    const world = this.world;
    it.onGround = false;
    const r = it.radius;
    world.query(b.position.x - r, b.position.z - r, b.position.x + r, b.position.z + r, _boxes);
    let hit = 0;
    for (const lp of it.points) {
      b.toWorldPoint(lp, _p);
      world.groundAt(_p.x, _p.z, _p.y + 0.4, _g);
      if (_p.y < _g.y) {
        _n.set(_g.nx, _g.ny, _g.nz);
        const d = _g.y - _p.y;
        const jn = resolveContact(b, null, _p, _n, d, it.restitution, it.friction, h, _out);
        if (d > 0.02) b.position.addScaledVector(_n, (d - 0.02) * 0.5);
        it.onGround = true;
        hit = Math.max(hit, -_out.vn);
        void jn;
      }
      for (const bx of _boxes) {
        if (_p.x <= bx.min.x || _p.x >= bx.max.x || _p.z <= bx.min.z || _p.z >= bx.max.z || _p.y <= bx.min.y || _p.y >= bx.max.y - 0.2) continue;
        let d = _p.x - bx.min.x;
        _n.set(-1, 0, 0);
        let v = bx.max.x - _p.x;
        if (v < d) { d = v; _n.set(1, 0, 0); }
        v = _p.z - bx.min.z;
        if (v < d) { d = v; _n.set(0, 0, -1); }
        v = bx.max.z - _p.z;
        if (v < d) { d = v; _n.set(0, 0, 1); }
        if (d > 1) continue;
        resolveContact(b, null, _p, _n, d, 0.25, 0.5, h, _out);
        b.position.addScaledVector(_n, d * 0.5);
        hit = Math.max(hit, -_out.vn);
      }
    }
    if (hit > 2.5 && it.lastHit <= 0 && this.onHit) {
      it.lastHit = 0.15;
      this.onHit(it, hit);
    }
  }

  /** Debris vs a car (sphere vs the car's box). */
  collideCar(car, h) {
    const cb = car.body;
    const min = car.boundsMin, max = car.boundsMax;
    for (const it of this.items) {
      const b = it.body;
      const rr = car.radius + it.radius;
      if (b.position.distanceToSquared(cb.position) > rr * rr) continue;
      cb.toLocalPoint(b.position, _l);
      const cx = Math.max(min.x, Math.min(max.x, _l.x));
      const cy = Math.max(min.y, Math.min(max.y, _l.y));
      const cz = Math.max(min.z, Math.min(max.z, _l.z));
      _a.set(_l.x - cx, _l.y - cy, _l.z - cz);
      const d = _a.length();
      const r = Math.min(it.radius, 0.45);
      if (d >= r || d < 1e-5) continue;
      _n.copy(_a).multiplyScalar(1 / d);
      cb.toWorldDir(_n, _n); // from car to debris
      _p.set(cx, cy, cz);
      cb.toWorldPoint(_p, _p);
      b.sleeping = false;
      resolveContact(b, cb, _p, _n, r - d, 0.2, 0.4, h, _out);
      b.position.addScaledVector(_n, (r - d) * 0.8);
    }
  }
}
