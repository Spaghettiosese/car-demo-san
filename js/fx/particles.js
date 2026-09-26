import * as THREE from 'three';
import { cachedTexture } from '../core/canvas.js';

const VERT = /* glsl */ `
attribute float size;
attribute vec4 pcolor;
attribute float rot;
varying vec4 vColor;
varying float vRot;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(size * uScale / max(-mvPosition.z, 0.1), 600.0);
  vColor = pcolor;
  vRot = rot;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
varying float vRot;
#include <fog_pars_fragment>
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
  vec4 t = texture2D(map, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

function smokeTex() {
  return cachedTexture('p-smoke', 64, 64, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
        const d = Math.sqrt(dx * dx + dy * dy);
        const n = 0.75 + 0.25 * Math.sin(x * 0.7 + Math.sin(y * 0.5) * 2) * Math.cos(y * 0.6);
        const a = Math.max(0, 1 - d) ** 1.6 * n;
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    ctx.putImageData(img, 0, 0);
  }, { linear: true });
}
function sparkTex() {
  return cachedTexture('p-spark', 32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { linear: true });
}

class Pool {
  constructor(max, texture, blending, scene) {
    this.max = max;
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture }, uScale: { value: 400 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.mat.uniforms.map.value = texture;
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    // simulation state
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.cursor = 0;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 1, grav = 0, rotV = 0) {
    let i;
    if (this.count < this.max) i = this.count++;
    else {
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
    }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    for (let k = 0; k < 4; k++) {
      this.c0[i * 4 + k] = c0[k];
      this.c1[i * 4 + k] = c1[k];
    }
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.rot[i] = Math.random() * 6.28;
    this.rotV[i] = rotV;
  }

  update(dt, groundFn) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const t = this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.grav[i] > 0 && this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
      this.rot[i] += this.rotV[i] * dt;
    }
    this.count = n;
    if (this.cursor >= n) this.cursor = 0;
    const g = this.geo;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.rot.needsUpdate = true;
    void groundFn;
  }

  copy(from, to) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
    }
    for (let k = 0; k < 4; k++) {
      this.col[to * 4 + k] = this.col[from * 4 + k];
      this.c0[to * 4 + k] = this.c0[from * 4 + k];
      this.c1[to * 4 + k] = this.c1[from * 4 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.size[to] = this.size[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.rot[to] = this.rot[from];
    this.rotV[to] = this.rotV[from];
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

/** Tumbling glass shards (instanced). */
class Shards {
  constructor(scene, max = 400) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.03, 0.005, 0, 0.012, 0.028, 0]), 3));
    g.computeVertexNormals();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xcfe6f0, metalness: 0.9, roughness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.max = max;
    this.items = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
  }
  emit(p, v) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ p: p.clone(), v: v.clone(), r: new THREE.Vector3(rnd(0, 6), rnd(0, 6), rnd(0, 6)), w: new THREE.Vector3(rnd(-15, 15), rnd(-15, 15), rnd(-15, 15)), life: 0, max: rnd(6, 14), rest: false, sc: rnd(0.6, 1.6) });
  }
  update(dt, groundAt) {
    const items = this.items;
    let k = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.life += dt;
      if (it.life > it.max) continue;
      if (!it.rest) {
        it.v.y -= 9.81 * dt;
        it.p.addScaledVector(it.v, dt);
        it.r.addScaledVector(it.w, dt);
        const gy = groundAt ? groundAt(it.p.x, it.p.z, it.p.y) : 0;
        if (it.p.y < gy + 0.005) {
          it.p.y = gy + 0.005;
          it.v.y *= -0.25;
          it.v.x *= 0.5;
          it.v.z *= 0.5;
          it.w.multiplyScalar(0.4);
          if (it.v.lengthSq() < 0.05) {
            it.rest = true;
            it.r.x = Math.PI / 2;
          }
        }
      }
      items[k++] = it;
    }
    items.length = k;
    for (let i = 0; i < k; i++) {
      const it = items[i];
      this.e.set(it.r.x, it.r.y, it.r.z);
      this.q.setFromEuler(this.e);
      const fade = it.life > it.max - 1 ? it.max - it.life : 1;
      this.s.setScalar(it.sc * Math.max(0.01, fade));
      this.m.compose(it.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** All particle effects in the game. */
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new Pool(3500, smokeTex(), THREE.NormalBlending, scene);
    this.glow = new Pool(2500, sparkTex(), THREE.AdditiveBlending, scene);
    this.shards = new Shards(scene);
    this.groundAt = null;
    this.quality = 1;
  }

  setScale(px) {
    this.smoke.mat.uniforms.uScale.value = px;
    this.glow.mat.uniforms.uScale.value = px;
  }

  update(dt) {
    this.smoke.update(dt);
    this.glow.update(dt);
    this.shards.update(dt, this.groundAt);
  }

  tireSmoke(p, v, amount, tint = [0.85, 0.85, 0.85]) {
    if (Math.random() > amount * this.quality) return;
    const a = Math.min(0.55, 0.15 + amount * 0.35);
    this.smoke.emit(p.x + rnd(-0.1, 0.1), p.y + 0.12, p.z + rnd(-0.1, 0.1), v.x * 0.3 + rnd(-0.6, 0.6), rnd(0.4, 1.3), v.z * 0.3 + rnd(-0.6, 0.6), rnd(1.8, 3.6), 0.6, rnd(3, 5.5), [tint[0], tint[1], tint[2], a], [tint[0], tint[1], tint[2], 0], 0.9, -0.15, rnd(-0.5, 0.5));
  }

  dust(p, v, color, amount) {
    if (Math.random() > amount * this.quality) return;
    this.smoke.emit(p.x, p.y + 0.1, p.z, v.x * 0.2 + rnd(-0.8, 0.8), rnd(0.3, 1.2), v.z * 0.2 + rnd(-0.8, 0.8), rnd(1.2, 2.5), 0.5, rnd(2, 3.5), [color[0], color[1], color[2], 0.45], [color[0], color[1], color[2], 0], 1.2, 0.1, rnd(-0.4, 0.4));
  }

  spray(p, v, amount) {
    if (Math.random() > amount * this.quality) return;
    this.smoke.emit(p.x, p.y + 0.1, p.z, v.x * 0.5 + rnd(-0.5, 0.5), rnd(0.5, 1.5), v.z * 0.5 + rnd(-0.5, 0.5), rnd(0.5, 1.0), 0.4, rnd(1.5, 2.5), [0.75, 0.8, 0.85, 0.28], [0.8, 0.85, 0.9, 0], 2.5, 1.5, 0);
  }

  exhaust(p, dir, amount, dark = 0) {
    if (Math.random() > amount * this.quality) return;
    const c = 0.6 - dark * 0.5;
    this.smoke.emit(p.x, p.y, p.z, dir.x * 1.5 + rnd(-0.2, 0.2), dir.y + rnd(0.1, 0.4), dir.z * 1.5 + rnd(-0.2, 0.2), rnd(0.8, 1.6), 0.12, rnd(0.8, 1.6), [c, c, c, 0.14 + dark * 0.3], [c, c, c, 0], 1.5, -0.2, 0.3);
  }

  engineSmoke(p, v, amount, steam) {
    if (Math.random() > amount * this.quality) return;
    const c = steam ? [0.9, 0.9, 0.9] : [0.12, 0.12, 0.12];
    const a = steam ? 0.35 : 0.6;
    this.smoke.emit(p.x + rnd(-0.3, 0.3), p.y, p.z + rnd(-0.3, 0.3), v.x * 0.6 + rnd(-0.3, 0.3), rnd(1, 2.4), v.z * 0.6 + rnd(-0.3, 0.3), rnd(1.5, 3), 0.4, rnd(2.5, 4.5), [c[0], c[1], c[2], a], [c[0], c[1], c[2], 0], 1, -0.4, rnd(-0.6, 0.6));
  }

  sparks(p, n, v, count) {
    for (let i = 0; i < count * this.quality; i++) {
      const s = rnd(2, 8);
      this.glow.emit(p.x, p.y, p.z, v.x * 0.7 + n.x * s + rnd(-3, 3), v.y * 0.3 + Math.abs(n.y) * s + rnd(0.5, 4), v.z * 0.7 + n.z * s + rnd(-3, 3), rnd(0.15, 0.55), rnd(0.06, 0.12), 0.02, [6, 3.2, 1.0, 1], [3, 0.6, 0.1, 0], 1.5, 9.81, 0);
    }
  }

  flame(p, dir, big) {
    const n = big ? 12 : 6;
    for (let i = 0; i < n * this.quality; i++) {
      const sp = rnd(3, big ? 9 : 6);
      this.glow.emit(p.x, p.y, p.z, dir.x * sp + rnd(-0.4, 0.4), dir.y * sp + rnd(-0.2, 0.4), dir.z * sp + rnd(-0.4, 0.4), rnd(0.05, big ? 0.18 : 0.1), rnd(0.25, 0.45), 0.05, [6, 2.6, 0.6, 1], [4, 0.4, 0.05, 0], 4, -1, rnd(-3, 3));
    }
  }

  fire(p, amount) {
    if (Math.random() > amount * this.quality) return;
    this.glow.emit(p.x + rnd(-0.4, 0.4), p.y, p.z + rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(1.5, 3), rnd(-0.3, 0.3), rnd(0.4, 0.9), rnd(0.6, 1.1), 0.1, [5, 1.8, 0.4, 0.9], [2, 0.3, 0.05, 0], 1.5, -1, rnd(-2, 2));
    if (Math.random() < 0.4) this.smoke.emit(p.x, p.y + 1, p.z, rnd(-0.3, 0.3), rnd(1.5, 3), rnd(-0.3, 0.3), rnd(2, 4), 1, 5, [0.08, 0.08, 0.08, 0.6], [0.1, 0.1, 0.1, 0], 0.6, -0.3, 0.3);
  }

  glass(p, count, color) {
    const c = color ? [color.r * 2, color.g * 2, color.b * 2] : [1.5, 1.7, 1.9];
    for (let i = 0; i < count * this.quality; i++) {
      this.glow.emit(p.x, p.y, p.z, rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2), rnd(0.4, 0.9), 0.05, 0.03, [c[0], c[1], c[2], 1], [c[0], c[1], c[2], 0], 0.5, 9.81, 0);
    }
  }

  glassBurst(points, vel) {
    const v = new THREE.Vector3();
    for (const p of points) {
      for (let k = 0; k < 3; k++) {
        v.set(vel.x * 0.7 + rnd(-2.5, 2.5), vel.y * 0.3 + rnd(0.5, 3), vel.z * 0.7 + rnd(-2.5, 2.5));
        this.shards.emit(p, v);
      }
      this.glow.emit(p.x, p.y, p.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), 0.5, 0.06, 0.02, [2, 2.2, 2.4, 1], [1, 1, 1, 0], 0.5, 9.81, 0);
    }
  }

  impactDust(p, amount) {
    for (let i = 0; i < 6 * amount * this.quality; i++) {
      this.smoke.emit(p.x, p.y, p.z, rnd(-1.5, 1.5), rnd(0.2, 1.5), rnd(-1.5, 1.5), rnd(0.8, 1.8), 0.4, rnd(1.5, 2.8), [0.55, 0.52, 0.48, 0.35], [0.6, 0.58, 0.55, 0], 2, 0.2, rnd(-1, 1));
    }
  }

  water(p, dirY = 1, amount = 1) {
    for (let i = 0; i < 3 * amount * this.quality; i++) {
      this.smoke.emit(p.x + rnd(-0.1, 0.1), p.y, p.z + rnd(-0.1, 0.1), rnd(-0.8, 0.8), dirY * rnd(9, 13), rnd(-0.8, 0.8), rnd(1.4, 2.2), 0.3, rnd(1.2, 2.2), [0.75, 0.82, 0.9, 0.5], [0.8, 0.85, 0.9, 0], 0.3, 9.81, 0);
    }
  }
}
