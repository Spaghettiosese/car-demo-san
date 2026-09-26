import * as THREE from 'three';

/**
 * Tyre marks as one ring-buffered ribbon mesh. Each wheel keeps its last
 * point; while sliding, a quad is appended from the last point to the new one.
 */
export class Skidmarks {
  constructor(scene, max = 6000) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.cursor = 0;
    this.used = 0;
    this.trails = new Map();
    this.dirty = false;
    this._side = new THREE.Vector3();
  }

  /** Call every frame for each wheel. intensity 0 ends the current trail. */
  add(key, p, dir, width, intensity, color = [0.02, 0.02, 0.02]) {
    let t = this.trails.get(key);
    if (intensity <= 0.02) {
      if (t) t.active = false;
      return;
    }
    if (!t) {
      t = { last: new THREE.Vector3(), lastL: new THREE.Vector3(), lastR: new THREE.Vector3(), active: false, a: 0 };
      this.trails.set(key, t);
    }
    const side = this._side.set(-dir.z, 0, dir.x).normalize().multiplyScalar(width / 2);
    const L = p.clone().add(side);
    const R = p.clone().sub(side);
    L.y = R.y = p.y + 0.015;
    if (!t.active) {
      t.active = true;
      t.last.copy(p);
      t.lastL.copy(L);
      t.lastR.copy(R);
      t.a = intensity;
      return;
    }
    if (t.last.distanceToSquared(p) < 0.09) return;
    if (t.last.distanceToSquared(p) > 4) {
      t.last.copy(p);
      t.lastL.copy(L);
      t.lastR.copy(R);
      return;
    }
    const i = this.cursor;
    const P = this.pos, C = this.col;
    const set = (v, k, a) => {
      P[(i * 4 + k) * 3] = v.x;
      P[(i * 4 + k) * 3 + 1] = v.y;
      P[(i * 4 + k) * 3 + 2] = v.z;
      C[(i * 4 + k) * 4] = color[0];
      C[(i * 4 + k) * 4 + 1] = color[1];
      C[(i * 4 + k) * 4 + 2] = color[2];
      C[(i * 4 + k) * 4 + 3] = a;
    };
    const a1 = Math.min(0.75, intensity);
    set(t.lastL, 0, t.a);
    set(t.lastR, 1, t.a);
    set(L, 2, a1);
    set(R, 3, a1);
    t.a = a1;
    t.last.copy(p);
    t.lastL.copy(L);
    t.lastR.copy(R);
    this.cursor = (this.cursor + 1) % this.max;
    this.used = Math.min(this.max, this.used + 1);
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.used * 6);
  }

  clear() {
    this.col.fill(0);
    this.used = 0;
    this.cursor = 0;
    this.dirty = true;
  }
}
