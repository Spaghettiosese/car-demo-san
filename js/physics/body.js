import * as THREE from 'three';

const _r = new THREE.Vector3();
const _t = new THREE.Vector3();

/**
 * 3D rigid body with a diagonal body-space inertia tensor.
 * Rotation and world inverse inertia are cached as row-major 3x3 arrays so
 * the hot paths (wheel and contact solvers) stay allocation-free.
 */
export class RigidBody {
  constructor(mass, inertia) {
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.inertia = inertia.clone();
    this.invInertia = new THREE.Vector3(
      mass > 0 ? 1 / inertia.x : 0,
      mass > 0 ? 1 / inertia.y : 0,
      mass > 0 ? 1 / inertia.z : 0,
    );
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();
    this.R = new Float64Array(9);
    this.Iw = new Float64Array(9);
    this.linearDamping = 0.0;
    this.angularDamping = 0.02;
    this.sleeping = false;
    this.sleepTimer = 0;
    this.updateDerived();
  }

  setMass(mass, inertia) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.inertia.copy(inertia);
    this.invInertia.set(1 / inertia.x, 1 / inertia.y, 1 / inertia.z);
    this.updateDerived();
  }

  updateDerived() {
    const q = this.quaternion;
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const R = this.R;
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
    R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
    R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
    const ix = this.invInertia.x, iy = this.invInertia.y, iz = this.invInertia.z;
    const Iw = this.Iw;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        Iw[i * 3 + j] = R[i * 3] * ix * R[j * 3] + R[i * 3 + 1] * iy * R[j * 3 + 1] + R[i * 3 + 2] * iz * R[j * 3 + 2];
      }
    }
  }

  // ---- frame conversions ----
  toWorldDir(v, out = new THREE.Vector3()) {
    const R = this.R;
    const x = v.x, y = v.y, z = v.z;
    return out.set(R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z);
  }
  toLocalDir(v, out = new THREE.Vector3()) {
    const R = this.R;
    const x = v.x, y = v.y, z = v.z;
    return out.set(R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z);
  }
  toWorldPoint(v, out = new THREE.Vector3()) {
    this.toWorldDir(v, out);
    return out.add(this.position);
  }
  toLocalPoint(v, out = new THREE.Vector3()) {
    _t.copy(v).sub(this.position);
    return this.toLocalDir(_t, out);
  }
  /** Column i of the rotation matrix = the body's local axis i in world space. */
  axis(i, out = new THREE.Vector3()) {
    const R = this.R;
    return out.set(R[i], R[3 + i], R[6 + i]);
  }

  mulIw(v, out) {
    const I = this.Iw;
    const x = v.x, y = v.y, z = v.z;
    return out.set(I[0] * x + I[1] * y + I[2] * z, I[3] * x + I[4] * y + I[5] * z, I[6] * x + I[7] * y + I[8] * z);
  }

  pointVelocity(worldPoint, out = new THREE.Vector3()) {
    _r.copy(worldPoint).sub(this.position);
    out.crossVectors(this.angularVelocity, _r);
    return out.add(this.velocity);
  }

  applyForce(f, worldPoint) {
    this.force.add(f);
    if (worldPoint) {
      _r.copy(worldPoint).sub(this.position);
      _t.crossVectors(_r, f);
      this.torque.add(_t);
    }
  }

  applyImpulse(j, worldPoint) {
    if (this.invMass === 0) return;
    this.velocity.addScaledVector(j, this.invMass);
    _r.copy(worldPoint).sub(this.position);
    _t.crossVectors(_r, j);
    this.mulIw(_t, _t);
    this.angularVelocity.add(_t);
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  /** Inverse effective mass seen by an impulse along n applied at p. */
  invMassAt(worldPoint, n) {
    if (this.invMass === 0) return 0;
    _r.copy(worldPoint).sub(this.position);
    _t.crossVectors(_r, n);
    this.mulIw(_t, _t);
    _t.cross(_r);
    return this.invMass + _t.dot(n);
  }

  /** Semi-implicit Euler, split so contacts can be solved between the two halves. */
  integrateVelocity(dt, gravity) {
    if (this.invMass === 0 || this.sleeping) {
      this.force.set(0, 0, 0);
      this.torque.set(0, 0, 0);
      return;
    }
    const v = this.velocity;
    v.x += (this.force.x * this.invMass + gravity.x) * dt;
    v.y += (this.force.y * this.invMass + gravity.y) * dt;
    v.z += (this.force.z * this.invMass + gravity.z) * dt;
    this.mulIw(this.torque, _t);
    this.angularVelocity.addScaledVector(_t, dt);
    if (this.linearDamping) v.multiplyScalar(1 - this.linearDamping * dt);
    if (this.angularDamping) this.angularVelocity.multiplyScalar(1 - this.angularDamping * dt);
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }

  integratePosition(dt) {
    if (this.invMass === 0 || this.sleeping) return;
    const v = this.velocity;
    // keep things sane after absurd impacts
    const w2 = this.angularVelocity.lengthSq();
    if (w2 > 900) this.angularVelocity.multiplyScalar(30 / Math.sqrt(w2));
    const v2 = v.lengthSq();
    if (v2 > 250 * 250) v.multiplyScalar(250 / Math.sqrt(v2));
    this.position.addScaledVector(v, dt);
    const q = this.quaternion;
    const w = this.angularVelocity;
    const hx = 0.5 * dt * w.x, hy = 0.5 * dt * w.y, hz = 0.5 * dt * w.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.x += hx * qw + hy * qz - hz * qy;
    q.y += -hx * qz + hy * qw + hz * qx;
    q.z += hx * qy - hy * qx + hz * qw;
    q.w += -hx * qx - hy * qy - hz * qz;
    q.normalize();
    this.updateDerived();
  }

  integrate(dt, gravity) {
    this.integrateVelocity(dt, gravity);
    this.integratePosition(dt);
  }

  kineticEnergy() {
    const l = this.toLocalDir(this.angularVelocity, _t);
    return (
      0.5 * this.mass * this.velocity.lengthSq() +
      0.5 * (this.inertia.x * l.x * l.x + this.inertia.y * l.y * l.y + this.inertia.z * l.z * l.z)
    );
  }
}

const _n = new THREE.Vector3();
const _vr = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _j = new THREE.Vector3();

/**
 * Resolve one contact between A and B (B may be null = static world).
 * `normal` points from B into A. Returns the normal impulse magnitude.
 */
export function resolveContact(A, B, point, normal, depth, restitution, friction, dt, out) {
  A.pointVelocity(point, _va);
  if (B) B.pointVelocity(point, _vb);
  else _vb.set(0, 0, 0);
  _vr.copy(_va).sub(_vb);
  const vn = _vr.dot(normal);
  let jn = 0;
  const kA = A.invMassAt(point, normal);
  const kB = B ? B.invMassAt(point, normal) : 0;
  const k = kA + kB;
  if (k <= 0) return 0;
  // Bias pushes bodies apart when they overlap (Baumgarte, capped so impacts don't explode)
  const bias = Math.min(Math.max(depth - 0.01, 0) * 0.25 / dt, 3);
  if (vn < bias) {
    const e = vn < -1.5 ? restitution : 0;
    jn = (-(1 + e) * vn + bias) / k;
    if (jn < 0) jn = 0;
    _j.copy(normal).multiplyScalar(jn);
    A.applyImpulse(_j, point);
    if (B) {
      _j.negate();
      B.applyImpulse(_j, point);
    }
    // friction
    A.pointVelocity(point, _va);
    if (B) B.pointVelocity(point, _vb);
    _vr.copy(_va).sub(_vb);
    const vn2 = _vr.dot(normal);
    _tan.copy(_vr).addScaledVector(normal, -vn2);
    const vt = _tan.length();
    if (vt > 1e-4) {
      _tan.multiplyScalar(1 / vt);
      const kt = A.invMassAt(point, _tan) + (B ? B.invMassAt(point, _tan) : 0);
      let jt = vt / kt;
      const maxF = friction * jn;
      if (jt > maxF) jt = maxF;
      _j.copy(_tan).multiplyScalar(-jt);
      A.applyImpulse(_j, point);
      if (B) {
        _j.negate();
        B.applyImpulse(_j, point);
      }
      if (out) out.slide = vt;
    }
  }
  if (out) {
    out.vn = vn;
    out.jn = jn;
  }
  return jn;
}
