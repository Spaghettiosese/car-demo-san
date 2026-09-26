import * as THREE from 'three';
import { resolveContact } from './body.js';

const GRAVITY = new THREE.Vector3(0, -9.81, 0);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _l = new THREE.Vector3();
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _g = { y: 0, nx: 0, ny: 1, nz: 0, mat: null };
const _boxes = [];
const _cyls = [];
const _out = { vn: 0, jn: 0, slide: 0 };

/**
 * Steps every active car: vehicle forces, then contacts (ground, buildings,
 * poles, other cars, debris), then position integration. Contact impulses are
 * reported to the cars for the damage model.
 */
export class PhysicsSystem {
  constructor(world) {
    this.world = world;
    this.gravity = GRAVITY.clone();
    this.maxSub = 1 / 240;
    this.time = 0;
    this.props = null; // prop system (breakable street furniture)
    this.debris = null;
    this.stats = { substeps: 0, ms: 0 };
  }

  step(dt, cars) {
    const t0 = performance.now();
    const n = Math.max(1, Math.ceil(dt / this.maxSub - 1e-6));
    const h = dt / n;
    const active = cars.filter((c) => c.physicsActive && !c.removed);
    for (const c of active) if (c.body.sleeping && c.phys.input.throttle > 0.01) c.body.sleeping = false;
    for (let s = 0; s < n; s++) {
      for (const c of active) {
        if (c.body.sleeping) continue;
        c.phys.step(h, this.world, this.gravity);
      }
      for (const c of active) if (!c.body.sleeping) this.collideStatic(c, h);
      this.collideCars(active, h);
      if (this.props) for (const c of active) if (!c.body.sleeping) this.props.collideCar(c, h);
      if (this.debris) for (const c of active) if (!c.body.sleeping) this.debris.collideCar(c, h);
      for (const c of active) {
        if (c.body.sleeping) continue;
        c.body.integratePosition(h);
        this.sleepCheck(c, h);
      }
      this.time += h;
    }
    this.stats.substeps = n;
    this.stats.ms = performance.now() - t0;
  }

  sleepCheck(c, h) {
    // only driverless cars (parked, abandoned) may sleep
    if (c.isPlayer || (c.controller && c.controller.state !== 'wrecked')) return;
    const b = c.body;
    const inp = c.phys.input;
    if (b.velocity.lengthSq() < 0.01 && b.angularVelocity.lengthSq() < 0.01 && inp.throttle < 0.01 && c.phys.grounded >= 3) {
      b.sleepTimer += h;
      if (b.sleepTimer > 1.5) {
        b.sleeping = true;
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
      }
    } else b.sleepTimer = 0;
  }

  /** Hull points vs ground/boxes, car box vs poles. */
  collideStatic(car, h) {
    const b = car.body;
    const world = this.world;
    const hull = car.hullLocal;
    const r = car.radius;
    const px = b.position.x, pz = b.position.z;
    world.query(px - r, pz - r, px + r, pz + r, _boxes, _cyls);
    // lowest possible hull point: skip ground tests when clearly airborne above flat ground
    let scraped = 0;
    for (let i = 0; i < hull.length; i += 3) {
      _l.set(hull[i], hull[i + 1], hull[i + 2]);
      b.toWorldPoint(_l, _p);
      // ground / slabs / ramps
      world.groundAt(_p.x, _p.z, _p.y + 0.45, _g);
      if (_p.y < _g.y) {
        const depth = _g.y - _p.y;
        _n.set(_g.nx, _g.ny, _g.nz);
        const jn = resolveContact(b, null, _p, _n, depth, 0.12, 0.45, h, _out);
        if (depth > 0.05) b.position.addScaledVector(_n, (depth - 0.05) * 0.5);
        if (jn > 0) {
          car.registerImpact(_p, _n, jn, null, _out.slide, 'ground');
          if (_out.slide > 2 && _out.slide > scraped) {
            scraped = _out.slide;
            car.scrapePoint.copy(_p);
            car.scrapeNormal.copy(_n);
          }
        }
      }
      // buildings / walls
      for (let k = 0; k < _boxes.length; k++) {
        const bx = _boxes[k];
        if (_p.x <= bx.min.x || _p.x >= bx.max.x || _p.z <= bx.min.z || _p.z >= bx.max.z || _p.y <= bx.min.y || _p.y >= bx.max.y) continue;
        // skip tops shallow enough to be "ground" (handled above)
        const dTop = bx.max.y - _p.y;
        if (dTop < 0.3) continue;
        let d = _p.x - bx.min.x;
        _n.set(-1, 0, 0);
        let v = bx.max.x - _p.x;
        if (v < d) { d = v; _n.set(1, 0, 0); }
        v = _p.z - bx.min.z;
        if (v < d) { d = v; _n.set(0, 0, -1); }
        v = bx.max.z - _p.z;
        if (v < d) { d = v; _n.set(0, 0, 1); }
        if (d > 1.5) continue; // deep inside: ignore (spawned inside, will be pushed by others)
        const jn = resolveContact(b, null, _p, _n, d, 0.1, 0.5, h, _out);
        b.position.addScaledVector(_n, Math.max(0, d - 0.01) * 0.6);
        if (jn > 0) {
          car.registerImpact(_p, _n, jn, null, _out.slide, bx.kind);
          if (_out.slide > 2 && _out.slide > scraped) {
            scraped = _out.slide;
            car.scrapePoint.copy(_p);
            car.scrapeNormal.copy(_n);
          }
        }
      }
    }
    car.scrape = scraped;
    // poles and trees: vertical cylinders vs the car's local box
    if (_cyls.length) {
      const min = car.boundsMin, max = car.boundsMax;
      for (const cy of _cyls) {
        if (cy.broken) continue;
        _a.set(cy.x, b.position.y, cy.z);
        b.toLocalPoint(_a, _l);
        const cx = Math.max(min.x, Math.min(max.x, _l.x));
        const cz = Math.max(min.z, Math.min(max.z, _l.z));
        const dx = _l.x - cx, dz = _l.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= cy.r * cy.r) continue;
        const inside = d2 < 1e-8;
        let nlx, nlz, depth;
        if (inside) {
          // centre inside the box: push out along the smallest axis
          const ex = Math.min(_l.x - min.x, max.x - _l.x), ez = Math.min(_l.z - min.z, max.z - _l.z);
          if (ex < ez) { nlx = _l.x - min.x < max.x - _l.x ? 1 : -1; nlz = 0; depth = ex + cy.r; }
          else { nlz = _l.z - min.z < max.z - _l.z ? 1 : -1; nlx = 0; depth = ez + cy.r; }
        } else {
          const d = Math.sqrt(d2);
          nlx = -dx / d;
          nlz = -dz / d;
          depth = cy.r - d;
        }
        // contact point on the car skin (local) at mid height
        _c.set(cx, Math.max(min.y + 0.25, Math.min(max.y - 0.3, 0)), cz);
        b.toWorldPoint(_c, _p);
        _n.set(nlx, 0, nlz);
        b.toWorldDir(_n, _n);
        _n.y = 0;
        _n.normalize();
        if (cy.ref && cy.ref.breakable && !cy.broken) {
          // breakable pole: only a bump for the car, the prop system handles the rest
          const vrel = b.pointVelocity(_p, _a).dot(_n);
          if (this.props && this.props.hitPole(cy, car, _p, _n, vrel)) continue;
        }
        const jn = resolveContact(b, null, _p, _n, depth, 0.08, 0.3, h, _out);
        b.position.addScaledVector(_n, Math.max(0, depth - 0.01) * 0.5);
        if (jn > 0) car.registerImpact(_p, _n, jn, null, _out.slide, cy.kind);
      }
    }
  }

  collideCars(cars, h) {
    const n = cars.length;
    for (let i = 0; i < n; i++) {
      const A = cars[i];
      for (let j = i + 1; j < n; j++) {
        const B = cars[j];
        if (A.body.sleeping && B.body.sleeping) continue;
        const rr = A.radius + B.radius;
        if (A.body.position.distanceToSquared(B.body.position) > rr * rr) continue;
        this.collidePair(A, B, h);
        this.collidePair(B, A, h);
      }
    }
  }

  /** A's hull points against B's box. */
  collidePair(A, B, h) {
    const hull = A.hullLocal;
    const bA = A.body, bB = B.body;
    const min = B.boundsMin, max = B.boundsMax;
    for (let i = 0; i < hull.length; i += 3) {
      _l.set(hull[i], hull[i + 1], hull[i + 2]);
      bA.toWorldPoint(_l, _p);
      bB.toLocalPoint(_p, _a);
      if (_a.x <= min.x || _a.x >= max.x || _a.y <= min.y || _a.y >= max.y || _a.z <= min.z || _a.z >= max.z) continue;
      let d = _a.x - min.x;
      _n.set(-1, 0, 0);
      let v = max.x - _a.x;
      if (v < d) { d = v; _n.set(1, 0, 0); }
      v = _a.z - min.z;
      if (v < d) { d = v; _n.set(0, 0, -1); }
      v = max.z - _a.z;
      if (v < d) { d = v; _n.set(0, 0, 1); }
      v = max.y - _a.y;
      if (v < d) { d = v; _n.set(0, 1, 0); }
      v = _a.y - min.y;
      if (v < d) { d = v; _n.set(0, -1, 0); }
      bB.toWorldDir(_n, _n); // from B into A
      const wake = bB.sleeping;
      const jn = resolveContact(bA, bB, _p, _n, d, 0.12, 0.35, h, _out);
      // positional separation shared by mass
      const wA = bA.invMass, wB = bB.invMass;
      const corr = Math.max(0, d - 0.01) * 0.4 / (wA + wB);
      bA.position.addScaledVector(_n, corr * wA);
      bB.position.addScaledVector(_n, -corr * wB);
      if (wake) bB.sleeping = false;
      if (jn > 0) {
        A.registerImpact(_p, _n, jn, B, _out.slide, 'car');
        _c.copy(_n).negate();
        B.registerImpact(_p, _c, jn, A, _out.slide, 'car');
      }
    }
  }
}
