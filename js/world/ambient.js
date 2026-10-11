import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from '../core/util.js';
import { roadCoord } from './city.js';
import { shoreZ, SEA_LEVEL } from './terrain.js';
import { glowTexture } from './textures.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// weather that changes by itself (when the setting is on): a small Markov chain
const NEXT = {
  clear: [['clear', 0.45], ['cloudy', 0.55]],
  cloudy: [['clear', 0.4], ['rain', 0.4], ['fog', 0.1], ['cloudy', 0.1]],
  rain: [['cloudy', 0.5], ['storm', 0.25], ['rain', 0.25]],
  storm: [['rain', 0.85], ['cloudy', 0.15]],
  fog: [['clear', 0.5], ['cloudy', 0.5]],
  snow: [['cloudy', 0.6], ['snow', 0.4]],
};
const WEATHER_TEXT = { clear: '☀ The skies are clearing', cloudy: '☁ Clouds are rolling in', rain: '🌧 Rain is starting', storm: '⛈ A storm is coming', fog: '🌫 Fog is settling in', snow: '❄ It\'s snowing' };

const ADS = [
  { bg: '#1d1d1d', fg: '#ff6a1f', title: 'SAN DEMO CUSTOMS', sub: 'We fix what you broke. Probably.' },
  { bg: '#c21f1f', fg: '#fff', title: 'FUEL STOP', sub: 'Unleaded $1.70 · EV fast charge' },
  { bg: '#2e7fd1', fg: '#fff', title: 'SPARKLE WASH', sub: 'Drive in dirty. Drive out shiny. $25' },
  { bg: '#101820', fg: '#ffd60a', title: 'SAN DEMO MOTORS', sub: '0% finance on every car*' },
  { bg: '#2b7a3c', fg: '#fff', title: 'VISIT DEMO PEAK', sub: 'The best view of the city' },
  { bg: '#6d1b7b', fg: '#fff', title: 'PISTONS vs ROCKETS', sub: 'Tonight 8 PM · San Demo Arena' },
  { bg: '#0b0b0b', fg: '#e8e8e8', title: '97.9 SAN DEMO TALK', sub: 'News & traffic on the nines' },
];

/**
 * The world's ambient life: weather that changes over time, snow, a rainbow
 * after rain, shooting stars, animated billboards, flags in the wind, bird
 * flocks over the park, boats on the bay, airliners and a news helicopter,
 * and fireworks over the harbor at night.
 */
export class Ambient {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.rnd = mulberry32(2024);
    this.weatherT = 240 + Math.random() * 180;
    this.buildSnow();
    this.buildRainbow();
    this.buildShootingStar();
    this.buildBillboards();
    this.buildFlags();
    this.buildBirds();
    this.buildBoats();
    this.buildPlane();
    this.buildFireworks();
    this.planeT = 40 + Math.random() * 60;
    this.starT = 10;
    this.newsT = 120 + Math.random() * 120;
    this.prevRain = 0;
  }

  // ------------------------------------------------------------ weather
  updateWeather(dt) {
    const g = this.game;
    const env = g.env;
    if (!g.settings.autoWeather || g.activities?.current) return;
    this.weatherT -= dt;
    if (this.weatherT > 0) return;
    this.weatherT = 240 + Math.random() * 300;
    let list = NEXT[env.weather] || NEXT.clear;
    // morning fog is more likely, snow only follows snow
    if (env.weather === 'clear' && env.hour > 4.5 && env.hour < 8.5 && Math.random() < 0.35) list = [['fog', 1]];
    let r = Math.random(), next = list[0][0];
    for (const [w, p] of list) {
      if (r < p) {
        next = w;
        break;
      }
      r -= p;
    }
    if (next === env.weather) return;
    env.setWeather(next);
    g.toast(WEATHER_TEXT[next] || next, 'info', 3);
  }

  // ------------------------------------------------------------ snow
  buildSnow() {
    const n = 12000, box = 70;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * box;
      pos[i * 3 + 1] = Math.random() * box * 0.6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * box;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: box }, uWind: { value: new THREE.Vector2() }, uAlpha: { value: 0 }, uBright: { value: 1 } },
      vertexShader: `uniform vec3 uCam; uniform float uTime, uBox; uniform vec2 uWind; attribute float seed; varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * (0.9 + seed * 0.7), uBox * 0.6);
          p.x += sin(uTime * (0.6 + seed) + seed * 40.0) * 0.6 + uWind.x * uTime * 0.25;
          p.z += cos(uTime * (0.5 + seed) + seed * 17.0) * 0.6 + uWind.y * uTime * 0.25;
          p.xz = mod(p.xz - uCam.xz + uBox * 0.5, uBox) + uCam.xz - uBox * 0.5;
          p.y += uCam.y - uBox * 0.18;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp((1.1 + seed * 1.5) * 90.0 / -mv.z, 1.0, 7.0);
          vA = clamp(1.0 - (-mv.z) / (uBox * 0.6), 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uAlpha, uBright; varying float vA;
        void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(vec3(uBright), sqrt(1.0 - d * 4.0) * uAlpha * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.snowPts = new THREE.Points(geo, this.snowMat);
    this.snowPts.frustumCulled = false;
    this.snowPts.visible = false;
    this.snowPts.renderOrder = 6;
    this.scene.add(this.snowPts);
    this.snowColor = new THREE.Color(1.9, 1.92, 2.0);
  }

  updateSnow(dt, cam) {
    const g = this.game;
    const env = g.env;
    const s = env.snow || 0;
    this.snowPts.visible = s > 0.02;
    if (this.snowPts.visible) {
      const u = this.snowMat.uniforms;
      u.uTime.value += dt;
      u.uCam.value.copy(cam);
      u.uAlpha.value = s * 0.85;
      u.uBright.value = 0.35 + (1 - env.night) * 0.75;
      if (env.wind) u.uWind.value.set(env.wind.x, env.wind.z);
    }
    // a white blanket on the roads, sidewalks and hills
    const cover = env.snowCover || 0;
    if (cover > 0.01 || this.lastCover > 0.01) {
      for (const e of g.city.wetMats) e.mat.color.lerp(this.snowColor, cover * 0.62);
      if (g.terrain?.material) g.terrain.material.color.setRGB(1, 1, 1).lerp(this.snowColor, cover * 0.75);
      // frosted trees and white roofs
      if (g.terrain?.treeMat) g.terrain.treeMat.color.setRGB(1, 1, 1).lerp(this.snowColor, cover * 0.45);
      for (const m of g.city.roofMats || []) m.color.setRGB(1, 1, 1).lerp(this.snowColor, cover * 0.7);
    }
    this.lastCover = cover;
  }

  // ------------------------------------------------------------ rainbow
  buildRainbow() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    const bands = ['#ff0000', '#ff8000', '#ffff00', '#00ff40', '#0080ff', '#4000ff', '#8000ff'];
    const r0 = 200;
    for (let k = 0; k < bands.length; k++) {
      x.strokeStyle = bands[k];
      x.globalAlpha = 0.55;
      x.lineWidth = 7;
      x.beginPath();
      x.arc(256, 256, r0 + 40 - k * 6, 0, Math.PI * 2);
      x.stroke();
    }
    x.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.rainbow = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.rainbow.visible = false;
    this.rainbow.renderOrder = -1;
    this.scene.add(this.rainbow);
    this.rainbowT = 0;
  }

  updateRainbow(dt, cam) {
    const env = this.game.env;
    // the rain just stopped while the sun is out
    if (this.prevRain > 0.25 && env.rain < 0.25 && env.sunDir.y > 0.08 && env.sunDir.y < 0.7) this.rainbowT = 100;
    this.prevRain = env.rain;
    if (this.rainbowT <= 0) {
      this.rainbow.visible = false;
      return;
    }
    this.rainbowT -= dt;
    const fade = clamp(Math.min(this.rainbowT / 20, (100 - this.rainbowT) / 8), 0, 1) * clamp((0.6 - env.cloud) * 2.5, 0.2, 1);
    this.rainbow.visible = fade > 0.01;
    // centred on the anti-solar point, far away
    const anti = _v.copy(env.sunDir).negate();
    this.rainbow.position.copy(cam).addScaledVector(anti, 1400);
    this.rainbow.lookAt(cam);
    this.rainbow.material.opacity = fade * 0.55;
  }

  // ------------------------------------------------------------ shooting stars
  buildShootingStar() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.star = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.star.frustumCulled = false;
    this.scene.add(this.star);
    this.starLife = 0;
  }

  updateShootingStar(dt, cam) {
    const env = this.game.env;
    this.starT -= dt;
    if (this.starT <= 0 && env.night > 0.85 && env.cloud < 0.5) {
      this.starT = 8 + Math.random() * 25;
      const a = Math.random() * Math.PI * 2, el = 0.5 + Math.random() * 0.5;
      this.starFrom = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(1500);
      const d = new THREE.Vector3(Math.random() - 0.5, -0.4 - Math.random() * 0.3, Math.random() - 0.5).normalize();
      this.starDir = d.multiplyScalar(600 + Math.random() * 500);
      this.starLife = 0.8;
    }
    if (this.starLife <= 0) {
      this.star.material.opacity = 0;
      return;
    }
    this.starLife -= dt;
    const k = 1 - this.starLife / 0.8;
    const head = _v.copy(this.starFrom).addScaledVector(this.starDir, k).add(cam);
    const tail = head.clone().addScaledVector(this.starDir, -0.18);
    const p = this.star.geometry.attributes.position;
    p.setXYZ(0, head.x, head.y, head.z);
    p.setXYZ(1, tail.x, tail.y, tail.z);
    p.needsUpdate = true;
    this.star.material.opacity = Math.sin(k * Math.PI) * 0.9;
  }

  // ------------------------------------------------------------ billboards
  buildBillboards() {
    const R = roadCoord;
    const spots = [
      [R(6) + 18, R(3) - 40, -Math.PI / 2], // east entrance (coast highway)
      [R(0) - 18, R(2), Math.PI / 2], // west side
      [R(2) + 40, R(0) - 14, 0], // north
      [R(4) - 30, R(6) + 16, Math.PI], // south, toward the harbor
    ];
    this.boards = [];
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
    spots.forEach(([x, z, yaw], i) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 192;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.6 });
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5), mat);
      panel.position.y = 9;
      const back = new THREE.Mesh(new THREE.BoxGeometry(12.4, 4.9, 0.3), frameMat);
      back.position.set(0, 9, -0.17);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 7, 10), frameMat);
      pole.position.y = 3.5;
      g.add(panel, back, pole);
      const gy = this.game.world.groundAt(x, z, 40, { y: 0 }).y;
      g.position.set(x, gy, z);
      g.rotation.y = yaw;
      this.scene.add(g);
      this.game.world.addCylinder(x, z, 0.35, gy, gy + 7, { kind: 'pole' });
      const b = { c, ctx: c.getContext('2d'), tex, mat, ad: i % ADS.length, t: 2 + Math.random() * 3, g };
      this.boards.push(b);
      this.drawBoard(b); // never a blank panel, even before it animates
    });
  }

  drawBoard(b) {
    const x = b.ctx;
    const ad = ADS[b.ad];
    const W = 512, H = 192, t = b.t;
    x.fillStyle = ad.bg;
    x.fillRect(0, 0, W, H);
    // sliding stripe
    x.fillStyle = 'rgba(255,255,255,0.06)';
    const sx = ((t * 120) % (W + 200)) - 200;
    x.beginPath();
    x.moveTo(sx, 0);
    x.lineTo(sx + 80, 0);
    x.lineTo(sx - 40, H);
    x.lineTo(sx - 120, H);
    x.fill();
    // title pops in
    const k = clamp(t / 0.5, 0, 1);
    x.fillStyle = ad.fg;
    x.font = `900 ${Math.round(46 * (0.6 + 0.4 * k))}px Arial`;
    x.textAlign = 'center';
    x.globalAlpha = k;
    x.fillText(ad.title, W / 2, 88);
    x.globalAlpha = clamp((t - 0.6) / 0.5, 0, 1);
    x.font = '600 24px Arial';
    x.fillText(ad.sub, W / 2, 130);
    x.globalAlpha = 1;
    // ticker of chasing lights along the bottom
    for (let i = 0; i < 32; i++) {
      x.fillStyle = (i + Math.floor(t * 8)) % 4 === 0 ? ad.fg : 'rgba(255,255,255,0.15)';
      x.fillRect(8 + i * 15.6, H - 18, 9, 6);
    }
    b.tex.needsUpdate = true;
  }

  updateBillboards(dt, cam) {
    const night = this.game.env.night;
    // real time, so the ads keep playing in photo mode and replays (where the sim is paused)
    const now = performance.now() / 1000;
    const rdt = Math.min(0.25, now - (this.boardClock ?? now));
    this.boardClock = now;
    this.boardT = (this.boardT || 0) - rdt;
    const redraw = this.boardT <= 0;
    if (redraw) this.boardT = 0.1;
    for (const b of this.boards) {
      b.t += rdt;
      if (b.t > 6) {
        b.t = 0;
        b.ad = (b.ad + 1) % ADS.length;
      }
      b.mat.emissiveIntensity = 0.2 + night * 1.1;
      if (redraw && b.g.position.distanceToSquared(cam) < 600 * 600) this.drawBoard(b);
    }
  }

  // ------------------------------------------------------------ flags
  buildFlags() {
    const g = this.game;
    const L = g.city.locations;
    const spots = [];
    const plaza = g.city.blocks.find((b) => b.type === 'plaza');
    if (plaza) {
      const cx = (plaza.x0 + plaza.x1) / 2, cz = (plaza.z0 + plaza.z1) / 2;
      spots.push([cx - 12, cz + 14, '#1f4fa8'], [cx, cz + 14, '#c21f1f'], [cx + 12, cz + 14, '#2b7a3c']);
    }
    spots.push([-60, 512, '#f2b90c']);
    if (g.terrain?.lookout) spots.push([g.terrain.lookout.pos.x + 6, g.terrain.lookout.pos.z + 6, '#ff6a1f']);
    if (L.dealer) spots.push([L.dealer.pos.x + 20, L.dealer.pos.z - 8, '#ffd60a']);
    this.flags = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.8, roughness: 0.3 });
    for (const [x, z, col] of spots) {
      const gy = g.world.groundAt(x, z, 400, { y: 0 }).y;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 8), poleMat);
      pole.position.set(x, gy + 4.5, z);
      this.scene.add(pole);
      g.world.addCylinder(x, z, 0.08, gy, gy + 9, { kind: 'pole' });
      const geo = new THREE.PlaneGeometry(2.6, 1.6, 14, 8);
      geo.translate(1.3, 0, 0);
      const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.8 }));
      flag.position.set(x, gy + 8.1, z);
      this.scene.add(flag);
      this.flags.push({ flag, base: geo.attributes.position.array.slice(), phase: Math.random() * 6 });
    }
  }

  updateFlags(dt, cam) {
    const env = this.game.env;
    const w = env.wind || _v.set(1, 0, 0);
    const ws = Math.hypot(w.x, w.z);
    const yaw = Math.atan2(w.x, w.z) - Math.PI / 2;
    const t = this.game.physics.time;
    for (const f of this.flags) {
      if (f.flag.position.distanceToSquared(cam) > 220 * 220) continue;
      f.flag.rotation.y = lerp(f.flag.rotation.y, yaw, Math.min(1, dt * 0.8));
      const pos = f.flag.geometry.attributes.position;
      const a = pos.array, b = f.base;
      const amp = clamp(0.08 + ws * 0.05, 0.08, 0.5);
      const droop = clamp(1 - ws / 6, 0, 1);
      for (let i = 0; i < a.length; i += 3) {
        const u = b[i] / 2.6; // 0 at the pole, 1 at the free end
        a[i + 2] = Math.sin(b[i] * 2.4 - t * (3 + ws * 0.6) + f.phase) * amp * u;
        a[i + 1] = b[i + 1] - droop * u * u * 0.9;
        a[i] = b[i] * (1 - droop * 0.25 * u);
      }
      pos.needsUpdate = true;
      f.flag.geometry.computeVertexNormals();
    }
  }

  // ------------------------------------------------------------ birds
  buildBirds() {
    const geo = new THREE.BufferGeometry();
    // body + two wings, the tips at y > 0 so scaling y flaps them
    const v = new Float32Array([
      0, 0, 0.25, -0.05, 0, -0.25, 0.05, 0, -0.25,
      0, 0, 0.1, 0, 0, -0.1, 0.45, 0.12, 0,
      0, 0, 0.1, -0.45, 0.12, 0, 0, 0, -0.1,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const n = 26;
    this.birds = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x1b1d20, side: THREE.DoubleSide }), n);
    this.birds.frustumCulled = false;
    this.scene.add(this.birds);
    this.birdData = Array.from({ length: n }, () => ({ r: 6 + Math.random() * 14, a: Math.random() * 6.28, h: Math.random() * 6, sp: 0.4 + Math.random() * 0.3, ph: Math.random() * 6 }));
    const park = this.game.city.blocks.find((b) => b.type === 'park');
    this.flockHome = park ? new THREE.Vector3((park.x0 + park.x1) / 2, 0, (park.z0 + park.z1) / 2) : new THREE.Vector3();
    this.flock = this.flockHome.clone();
    this.scatter = 0;
  }

  onNoise(p, loud = 1) {
    if (p.distanceTo(this.flock) < 70 * loud) this.scatter = 10;
  }

  updateBirds(dt, cam) {
    const env = this.game.env;
    const night = env.night > 0.7 || env.rain > 0.5;
    this.birds.visible = !night && this.flock.distanceToSquared(cam) < 400 * 400;
    if (!this.birds.visible) return;
    const t = this.game.physics.time;
    this.scatter = Math.max(0, this.scatter - dt);
    const pc = this.game.player.car;
    if (pc && pc.sys.horn) this.onNoise(pc.body.position, 1);
    // the flock centre wanders around the park
    this.flock.x = this.flockHome.x + Math.sin(t * 0.07) * 30;
    this.flock.z = this.flockHome.z + Math.cos(t * 0.05) * 25;
    const up = 18 + this.scatter * 3;
    this.birdData.forEach((b, i) => {
      b.a += dt * b.sp * (1 + this.scatter * 0.15);
      const r = b.r * (1 + this.scatter * 0.12);
      const x = this.flock.x + Math.cos(b.a) * r, z = this.flock.z + Math.sin(b.a) * r;
      const y = up + b.h + Math.sin(t * 0.6 + b.ph) * 1.5;
      const yaw = Math.atan2(-Math.sin(b.a), Math.cos(b.a));
      _q.setFromEuler(_e.set(0, yaw, Math.sin(b.a) * 0.2));
      const flap = Math.sin(t * (9 + this.scatter) + b.ph);
      _m.compose(_v.set(x, y, z), _q, _s.set(1, flap, 1));
      this.birds.setMatrixAt(i, _m);
    });
    this.birds.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ boats
  buildBoats() {
    const hullW = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
    const hullB = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.5 });
    const hull = (L, W, H, mat) => {
      const shape = new THREE.Shape();
      shape.moveTo(-W / 2, -L / 2);
      shape.lineTo(W / 2, -L / 2);
      shape.lineTo(W / 2, L * 0.25);
      shape.quadraticCurveTo(W * 0.35, L * 0.5, 0, L / 2);
      shape.quadraticCurveTo(-W * 0.35, L * 0.5, -W / 2, L * 0.25);
      shape.lineTo(-W / 2, -L / 2);
      const g = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, H * 0.7, 0);
      return new THREE.Mesh(g, mat);
    };
    const make = (kind) => {
      const g = new THREE.Group();
      if (kind === 'sail') {
        g.add(hull(9, 2.6, 1.2, hullW));
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 11, 6), hullW);
        mast.position.set(0, 6, 0.6);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1.2, 0.5, 0, 11, 0.6, 0, 1.4, -3.6]), 3));
        sg.computeVertexNormals();
        const sail = new THREE.Mesh(sg, sailMat);
        g.add(mast, sail);
      } else if (kind === 'speed') {
        g.add(hull(6.5, 2.2, 0.9, hullB));
        const ws = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), glass);
        ws.position.set(0, 1.2, 0.8);
        ws.rotation.x = -0.5;
        g.add(ws);
      } else {
        g.add(hull(12, 3.6, 1.8, red));
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3), hullW);
        cab.position.set(0, 2.4, -1.5);
        g.add(cab);
      }
      g.traverse((o) => o.isMesh && (o.castShadow = true));
      return g;
    };
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.boats = [
      { kind: 'sail', cx: 300, rx: 260, rz: 120, off: 260, sp: 0.012 },
      { kind: 'speed', cx: -320, rx: 300, rz: 90, off: 180, sp: 0.045 },
      { kind: 'fish', cx: 900, rx: 380, rz: 160, off: 420, sp: 0.008 },
    ].map((b) => {
      const mesh = make(b.kind);
      this.scene.add(mesh);
      const wake = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 22), wakeMat);
      wake.rotation.x = -Math.PI / 2;
      this.scene.add(wake);
      return { ...b, mesh, wake, a: Math.random() * 6.28 };
    });
  }

  updateBoats(dt, cam) {
    const t = this.game.physics.time;
    for (const b of this.boats) {
      b.a += dt * b.sp;
      const x = b.cx + Math.cos(b.a) * b.rx;
      const z = shoreZ(b.cx) + b.off + Math.sin(b.a) * b.rz;
      const dx = -Math.sin(b.a) * b.rx, dz = Math.cos(b.a) * b.rz;
      const yaw = Math.atan2(dx, dz);
      b.mesh.position.set(x, SEA_LEVEL - 0.35 + Math.sin(t * 1.3 + b.cx) * 0.15, z);
      b.mesh.rotation.set(Math.sin(t * 0.9 + b.cx) * 0.04, yaw, Math.sin(t * 0.7) * (b.kind === 'sail' ? 0.12 : 0.04), 'YXZ');
      const behind = b.kind === 'speed' ? 13 : 9;
      b.wake.position.set(x - Math.sin(yaw) * behind, SEA_LEVEL + 0.02, z - Math.cos(yaw) * behind);
      b.wake.rotation.z = -yaw;
      b.wake.visible = b.mesh.position.distanceToSquared(cam) < 900 * 900;
      b.wake.material.opacity = b.kind === 'speed' ? 0.4 : 0.15;
    }
  }

  // ------------------------------------------------------------ flyovers
  buildPlane() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.4, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 34, 12), white);
    body.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(36, 0.4, 5), white);
    wing.position.z = 1;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3), white);
    tail.position.z = -15;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 4), white);
    fin.position.set(0, 3, -15);
    this.navL = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false }));
    this.navL.position.set(-18, 0, 1);
    this.navR = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: 0x20ff40, fog: false }));
    this.navR.position.set(18, 0, 1);
    this.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    this.strobe.position.set(0, 1.8, -2);
    g.add(body, wing, tail, fin, this.navL, this.navR, this.strobe);
    g.visible = false;
    this.scene.add(g);
    this.plane = g;
    this.planeLeg = null;
  }

  updateFlyovers(dt, cam) {
    const g = this.game;
    this.planeT -= dt;
    if (!this.planeLeg && this.planeT <= 0) {
      const a = Math.random() * Math.PI * 2;
      const from = new THREE.Vector3(cam.x + Math.cos(a) * 2600, 330 + Math.random() * 120, cam.z + Math.sin(a) * 2600);
      const to = new THREE.Vector3(cam.x - Math.cos(a + 0.3) * 2600, from.y, cam.z - Math.sin(a + 0.3) * 2600);
      this.planeLeg = { from, to, t: 0, dur: from.distanceTo(to) / 75 };
      this.plane.visible = true;
    }
    if (this.planeLeg) {
      const L = this.planeLeg;
      L.t += dt;
      const k = L.t / L.dur;
      this.plane.position.copy(L.from).lerp(L.to, k);
      this.plane.lookAt(L.to);
      const blink = Math.floor(L.t * 1.2) % 2 === 0;
      this.navL.visible = this.navR.visible = blink;
      this.strobe.visible = Math.floor(L.t * 3) % 6 === 0;
      g.audio?.jetRumble?.(this.plane.position, k < 1);
      if (k >= 1) {
        this.planeLeg = null;
        this.plane.visible = false;
        this.planeT = 90 + Math.random() * 150;
        g.audio?.jetRumble?.(this.plane.position, false);
      }
    }
    // a TV news helicopter circles downtown now and then
    this.newsT -= dt;
    if (this.newsT <= 0 && !this.news && g.env.night < 0.5) {
      import('../ai/heli.js').then(({ PoliceHeli }) => {
        if (this.news) return;
        // one news helicopter, reused for every flight
        const h = (this.newsHeli ||= new PoliceHeli(g, { color: 0xc8102e, searchlight: false, quiet: true }));
        h.active = true;
        h.leaving = false;
        h.pos.set(cam.x + 500, 140, cam.z + 300);
        h.vel.set(0, 0, 0);
        h.root.visible = true;
        this.news = { h, t: 70 };
        g.hud.notify?.('📺 Channel 9 SkyCam', 'The news helicopter is over downtown', '', 3);
      });
      this.newsT = 240 + Math.random() * 240;
    }
    if (this.news) {
      const n = this.news;
      n.t -= dt;
      if (n.t <= 0 && !n.h.leaving) n.h.leave();
      const pc = g.player.car;
      const watch = g.police && g.police.heat > 0 && pc ? pc.body.position : _v.set(0, 60, 0);
      n.h.update(dt, n.h.leaving ? null : watch);
      if (!n.h.active) this.news = null;
    }
  }

  // ------------------------------------------------------------ fireworks
  buildFireworks() {
    const max = 2400;
    const geo = new THREE.BufferGeometry();
    this.fwPos = new Float32Array(max * 3);
    this.fwCol = new Float32Array(max * 3);
    this.fwVel = new Float32Array(max * 3);
    this.fwLife = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.fwPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.fwCol, 3));
    this.fw = new THREE.Points(geo, new THREE.PointsMaterial({ size: 4.5, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true }));
    this.fw.frustumCulled = false;
    this.fw.visible = false;
    this.scene.add(this.fw);
    this.fwI = 0;
    this.fwBurstT = 0;
    this.fwDay = -1;
  }

  burst(at) {
    const n = 140;
    const col = new THREE.Color().setHSL(Math.random(), 1, 0.6).multiplyScalar(2.2);
    const sp = 18 + Math.random() * 14;
    for (let k = 0; k < n; k++) {
      const i = this.fwI++ % this.fwLife.length;
      this.fwPos.set([at.x, at.y, at.z], i * 3);
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const s = sp * (0.85 + Math.random() * 0.3);
      this.fwVel.set([Math.cos(a) * r * s, u * s, Math.sin(a) * r * s], i * 3);
      this.fwCol.set([col.r, col.g, col.b], i * 3);
      this.fwLife[i] = 2 + Math.random() * 0.8;
    }
    const g = this.game;
    const d = at.distanceTo(g.camera.position);
    setTimeout(() => g.audio?.noiseBurst?.(1.2, { gain: Math.min(0.6, 160 / (d + 60)), type: 'lowpass', freq: 220 }), (d / 343) * 1000);
  }

  updateFireworks(dt, cam) {
    const g = this.game;
    const env = g.env;
    // a short show over the harbor every night at nine
    const showtime = env.hour > 21 && env.hour < 21.35 && env.weather !== 'storm' && env.weather !== 'rain';
    const harbor = _v.set(-110, 0, 640);
    const near = harbor.distanceTo(cam) < 1800;
    if (showtime && near && !this.showOn) g.toast('🎆 Fireworks over the harbor!', 'info', 3);
    this.showOn = showtime && near;
    if (showtime && near) {
      this.fwBurstT -= dt;
      if (this.fwBurstT <= 0) {
        this.fwBurstT = 0.6 + Math.random() * 1.2;
        this.burst(new THREE.Vector3(-110 + (Math.random() - 0.5) * 160, 90 + Math.random() * 60, 640 + (Math.random() - 0.5) * 80));
      }
    }
    let alive = 0;
    for (let i = 0; i < this.fwLife.length; i++) {
      if (this.fwLife[i] <= 0) continue;
      alive++;
      this.fwLife[i] -= dt;
      const o = i * 3;
      this.fwVel[o + 1] -= 9.81 * 0.35 * dt;
      const drag = Math.max(0, 1 - dt * 1.2);
      this.fwVel[o] *= drag;
      this.fwVel[o + 1] *= drag;
      this.fwVel[o + 2] *= drag;
      this.fwPos[o] += this.fwVel[o] * dt;
      this.fwPos[o + 1] += this.fwVel[o + 1] * dt;
      this.fwPos[o + 2] += this.fwVel[o + 2] * dt;
      const f = Math.max(0, this.fwLife[i] / 2.4);
      this.fwCol[o] *= 0.985;
      this.fwCol[o + 1] *= 0.985;
      this.fwCol[o + 2] *= 0.985;
      if (this.fwLife[i] <= 0) this.fwPos[o + 1] = -9999;
      void f;
    }
    this.fw.visible = alive > 0;
    if (alive) {
      this.fw.geometry.attributes.position.needsUpdate = true;
      this.fw.geometry.attributes.color.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const cam = this.game.camera.position;
    this.updateWeather(dt);
    this.updateSnow(dt, cam);
    this.updateRainbow(dt, cam);
    this.updateShootingStar(dt, cam);
    this.updateBillboards(dt, cam);
    this.updateFlags(dt, cam);
    this.updateBirds(dt, cam);
    this.updateBoats(dt, cam);
    this.updateFlyovers(dt, cam);
    this.updateFireworks(dt, cam);
  }
}
