import * as THREE from 'three';
import { clamp, lerp } from './core/util.js';

const HZ = 30;
const SECS = 30;
const FRAMES = HZ * SECS;
const MAXCARS = 16;
// floats per car per frame: pos3 quat4 + 4 wheels x (s, spin, yaw) + flags
const STRIDE = 7 + 12 + 2;
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Replay: a ring buffer of the last 30 s (car poses and wheels at 30 Hz,
 * body deformation snapshots twice a second for damaged cars). Playback
 * freezes the simulation, scrubs the recorded frames with chase, trackside,
 * cinematic or free cameras, then restores the live state exactly.
 */
export class Replay {
  constructor(game) {
    this.game = game;
    this.buf = new Float32Array(FRAMES * MAXCARS * STRIDE);
    this.slots = new Array(MAXCARS).fill(null); // car per slot
    this.frameCars = new Array(FRAMES); // slot mask per frame
    this.frameAbs = new Int32Array(FRAMES); // absolute frame number per ring slot
    this.total = 0;
    this.head = 0; // next frame index
    this.count = 0;
    this.acc = 0;
    this.snaps = []; // { frame, car, pos: Float32Array }
    this.snapT = 0;
    this.active = false;
    this.t = 0;
    this.speed = 1;
    this.playing = true;
    this.camMode = 'chase';
    this.el = null;
  }

  // ------------------------------------------------------------ recording
  record(dt) {
    if (this.active) return;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = Math.min(this.acc - 1 / HZ, 1 / HZ);
    const g = this.game;
    const focus = g.player.focus;
    const pc = g.player.car;
    // keep slots for cars near the player (the player first)
    for (let i = 0; i < MAXCARS; i++) {
      const c = this.slots[i];
      if (c && (c.removed || (c !== pc && c.body.position.distanceTo(focus) > 220))) this.slots[i] = null;
    }
    const want = g.cars.filter((c) => !c.removed && (c === pc || c.body.position.distanceTo(focus) < 160)).sort((a, b) => (a === pc ? -1 : b === pc ? 1 : a.body.position.distanceToSquared(focus) - b.body.position.distanceToSquared(focus)));
    for (const c of want) {
      if (this.slots.includes(c)) continue;
      const free = this.slots.indexOf(null);
      if (free < 0) break;
      this.slots[free] = c;
    }
    const f = this.head;
    this.frameAbs[f] = this.total;
    const mask = [];
    for (let i = 0; i < MAXCARS; i++) {
      const c = this.slots[i];
      if (!c) continue;
      mask.push(i, c);
      const o = (f * MAXCARS + i) * STRIDE;
      const b = this.buf, p = c.body.position, q = c.body.quaternion;
      b[o] = p.x; b[o + 1] = p.y; b[o + 2] = p.z;
      b[o + 3] = q.x; b[o + 4] = q.y; b[o + 5] = q.z; b[o + 6] = q.w;
      const ws = c.phys.wheels;
      for (let k = 0; k < 4; k++) {
        const w = ws[k];
        b[o + 7 + k * 3] = w ? w.s : 0;
        b[o + 8 + k * 3] = w ? w.spin : 0;
        b[o + 9 + k * 3] = w ? w.yaw : 0;
      }
      b[o + 19] = (c.sys.brakeLight || c.phys.input.brake > 0.1 ? 1 : 0) + (c.sirenOn ? 2 : 0);
      b[o + 20] = c.speed;
    }
    this.frameCars[f] = mask;
    // deformation snapshots for cars whose body changed
    this.snapT -= 1 / HZ;
    if (this.snapT <= 0) {
      this.snapT = 0.5;
      for (const c of this.slots) {
        if (!c) continue;
        const lat = c.model.lattice;
        if (lat.version === c._snapVer) continue;
        c._snapVer = lat.version;
        this.snaps.push({ frame: this.total, car: c, pos: lat.pos.slice() });
      }
      // drop snapshots that fell out of the window (keep the newest older one per car as a base)
      const oldest = this.total - FRAMES;
      this.snaps = this.snaps.filter((s, i, arr) => s.frame >= oldest || !arr.some((o, j) => j > i && o.car === s.car && o.frame <= oldest));
    }
    this.head = (f + 1) % FRAMES;
    this.count = Math.min(FRAMES, this.count + 1);
    this.total++;
  }

  get duration() {
    return this.count / HZ;
  }

  // ------------------------------------------------------------ playback
  start(opts = {}) {
    const g = this.game;
    if (this.active || this.count < HZ) {
      if (!this.active) g.toast('Nothing to replay yet', 'info', 1.5);
      return;
    }
    this.active = true;
    this.prevState = g.state;
    g.state = 'replay';
    this.t = opts.from != null ? clamp(opts.from, 0, this.duration) : 0;
    this.end = opts.to != null ? opts.to : this.duration;
    this.speed = opts.speed || 1;
    this.playing = true;
    this.auto = !!opts.auto;
    this.camMode = opts.cam || 'chase';
    this.prevCam = g.cam.mode;
    // live state to restore afterwards
    this.live = g.cars.filter((c) => !c.removed).map((c) => ({
      c, pos: c.body.position.clone(), q: c.body.quaternion.clone(), vel: c.body.velocity.clone(), ang: c.body.angularVelocity.clone(),
      wheels: c.phys.wheels.map((w) => [w.s, w.spin, w.yaw, w.omega]), lat: c.model.lattice.pos.slice(), ver: c.model.lattice.version, sleeping: c.body.sleeping,
    }));
    this.target = g.player.car;
    this.buildUi();
    g.hud.show(false);
    this.trackCam = null;
    this.apply(true);
  }

  stop() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    for (const s of this.live) {
      const c = s.c;
      if (c.removed) continue;
      c.body.position.copy(s.pos);
      c.body.quaternion.copy(s.q);
      c.body.velocity.copy(s.vel);
      c.body.angularVelocity.copy(s.ang);
      c.body.sleeping = s.sleeping;
      c.body.updateDerived();
      s.wheels.forEach((v, k) => {
        const w = c.phys.wheels[k];
        if (!w) return;
        [w.s, w.spin, w.yaw, w.omega] = v;
        w.sPrev = w.s;
      });
      const lat = c.model.lattice;
      lat.pos.set(s.lat);
      lat.version = s.ver + 1;
      c.model.applyDeformation();
      c.syncVisual(0);
    }
    this.live = null;
    g.state = this.prevState === 'replay' ? 'play' : this.prevState || 'play';
    g.cam.car = g.player.car;
    g.cam.setMode(this.prevCam || 'chase');
    g.cam.initialized = false;
    g.hud.show(true);
    if (this.el) this.el.classList.add('hidden');
  }

  /** Ring index for playback time t (0 = oldest recorded frame). */
  indexAt(t) {
    const fi = clamp(t * HZ, 0, this.count - 1);
    const base = (this.head - this.count + FRAMES) % FRAMES;
    const i0 = Math.floor(fi);
    return { a: (base + i0) % FRAMES, b: (base + Math.min(this.count - 1, i0 + 1)) % FRAMES, k: fi - i0, abs: this.frameAbs[(base + i0) % FRAMES] };
  }

  apply(force) {
    const { a, b, k, abs } = this.indexAt(this.t);
    const ma = this.frameCars[a] || [];
    const mb = this.frameCars[b] || [];
    const buf = this.buf;
    for (let m = 0; m < ma.length; m += 2) {
      const slot = ma[m], c = ma[m + 1];
      if (c.removed) continue;
      const oa = (a * MAXCARS + slot) * STRIDE;
      const hasB = mb.includes(c) && mb[mb.indexOf(c) - 1] === slot;
      const ob = hasB ? (b * MAXCARS + slot) * STRIDE : oa;
      c.body.position.set(lerp(buf[oa], buf[ob], k), lerp(buf[oa + 1], buf[ob + 1], k), lerp(buf[oa + 2], buf[ob + 2], k));
      _q1.set(buf[oa + 3], buf[oa + 4], buf[oa + 5], buf[oa + 6]);
      _q2.set(buf[ob + 3], buf[ob + 4], buf[ob + 5], buf[ob + 6]);
      c.body.quaternion.copy(_q1).slerp(_q2, k);
      // velocity from the recording (for cameras and motion blur-free chase smoothing)
      c.body.velocity.set((buf[ob] - buf[oa]) * HZ, (buf[ob + 1] - buf[oa + 1]) * HZ, (buf[ob + 2] - buf[oa + 2]) * HZ);
      c.body.updateDerived();
      for (let w = 0; w < 4; w++) {
        const wh = c.phys.wheels[w];
        if (!wh) continue;
        wh.s = lerp(buf[oa + 7 + w * 3], buf[ob + 7 + w * 3], k);
        wh.spin = buf[oa + 8 + w * 3];
        wh.yaw = lerp(buf[oa + 9 + w * 3], buf[ob + 9 + w * 3], k);
      }
      c.sys.brakeLightReplay = buf[oa + 19] % 2 >= 1;
      // body deformation: the latest snapshot at or before this frame
      let snap = null;
      for (const s of this.snaps) if (s.car === c && s.frame <= abs && (!snap || s.frame > snap.frame)) snap = s;
      if (snap && (force || c._replaySnap !== snap)) {
        c._replaySnap = snap;
        c.model.lattice.pos.set(snap.pos);
        c.model.applyDeformation();
      }
      c.syncVisual(0, this.t);
    }
  }

  update(dt) {
    const g = this.game;
    if (!this.active) return;
    const input = g.input;
    if (input.keyPressed('Escape') || input.pressed('replay')) return this.stop();
    if (input.keyPressed('Space')) this.playing = !this.playing;
    if (input.keyPressed('ArrowLeft')) this.t = Math.max(0, this.t - 2);
    if (input.keyPressed('ArrowRight')) this.t = Math.min(this.end, this.t + 2);
    if (input.keyPressed('KeyC')) this.cycleCam();
    if (this.playing) this.t += dt * this.speed;
    if (this.t >= this.end) {
      if (this.auto) return this.stop();
      this.t = this.end;
      this.playing = false;
    }
    this.apply(false);
    this.updateCamera(dt);
    this.uiN = (this.uiN || 0) + 1;
    this.updateUi(this.uiN % 15 === 0);
  }

  cycleCam() {
    const modes = ['chase', 'trackside', 'cinematic', 'free'];
    this.camMode = modes[(modes.indexOf(this.camMode) + 1) % modes.length];
    this.trackCam = null;
    if (this.camMode === 'free') this.game.cam.setMode('free');
    else if (this.game.cam.mode === 'free') this.game.cam.setMode('chase');
    this.updateUi(true);
  }

  updateCamera(dt) {
    const g = this.game;
    const car = this.target;
    const cam = g.camera;
    if (this.camMode === 'free') {
      g.cam.update(dt, g.input);
      return;
    }
    if (!car || car.removed) return;
    const p = car.body.position;
    const v = car.body.velocity;
    if (this.camMode === 'chase') {
      g.cam.car = car;
      if (g.cam.mode !== 'chase') g.cam.setMode('chase');
      g.cam.update(dt, g.input);
      return;
    }
    if (this.camMode === 'trackside') {
      // a fixed camera beside the road ahead; jump to the next one once the car is past
      const sp = Math.hypot(v.x, v.z);
      if (!this.trackCam || this.trackCam.distanceTo(p) > 55 || (sp > 1 && _v.copy(p).sub(this.trackCam).dot(_w.set(v.x, 0, v.z)) > 0 && this.trackCam.distanceTo(p) > 18)) {
        const dir = sp > 1 ? _w.set(v.x, 0, v.z).normalize() : car.body.axis(2, _w);
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.random() < 0.5 ? 7 : -7);
        this.trackCam = p.clone().addScaledVector(dir, 22 + sp * 0.6).add(side);
        const gy = g.world.groundAt(this.trackCam.x, this.trackCam.z, this.trackCam.y + 30, { y: 0 }).y;
        this.trackCam.y = gy + 1.4 + Math.random() * 1.5;
      }
      cam.position.copy(this.trackCam);
      cam.lookAt(p.x, p.y + 0.6, p.z);
      cam.fov = lerp(cam.fov, clamp(40 - this.trackCam.distanceTo(p) * 0.2, 18, 40), 0.1);
      cam.updateProjectionMatrix();
      return;
    }
    // cinematic: slow orbit, low and wide
    this.orbit = (this.orbit || 0) + dt * 0.35;
    cam.position.set(p.x + Math.cos(this.orbit) * 9, p.y + 1.1 + Math.sin(this.orbit * 0.6) * 0.6, p.z + Math.sin(this.orbit) * 9);
    cam.lookAt(p.x, p.y + 0.5, p.z);
    cam.fov = lerp(cam.fov, 50, 0.1);
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ UI
  buildUi() {
    if (!this.el) {
      const el = document.createElement('div');
      el.id = 'replay';
      el.innerHTML = `<div class="rtop"><b>● REPLAY</b><span class="rt"></span></div>
        <input type="range" min="0" max="1000" value="0" class="scrub">
        <div class="rbtn"><button data-r="back">⏪</button><button data-r="play">⏸</button><button data-r="fwd">⏩</button>
        <span class="sep"></span>${[0.25, 0.5, 1, 2].map((s) => `<button data-s="${s}">${s}×</button>`).join('')}
        <span class="sep"></span>${['chase', 'trackside', 'cinematic', 'free'].map((m) => `<button data-c="${m}">${m}</button>`).join('')}
        <span class="sep"></span><button data-r="cars">Next car</button><button data-r="exit">Exit (F5)</button></div>`;
      document.getElementById('app').appendChild(el);
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      const scrub = el.querySelector('.scrub');
      scrub.oninput = () => {
        this.t = (scrub.value / 1000) * this.end;
        this.playing = false;
        this.apply(false);
      };
      el.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => {
        this.speed = +b.dataset.s;
        this.updateUi(true);
      }));
      el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => {
        this.camMode = b.dataset.c;
        this.trackCam = null;
        if (this.camMode === 'free') this.game.cam.setMode('free');
        else if (this.game.cam.mode === 'free') this.game.cam.setMode('chase');
        this.updateUi(true);
      }));
      el.querySelector('[data-r=play]').onclick = () => {
        if (this.t >= this.end) this.t = 0;
        this.playing = !this.playing;
      };
      el.querySelector('[data-r=back]').onclick = () => (this.t = Math.max(0, this.t - 3));
      el.querySelector('[data-r=fwd]').onclick = () => (this.t = Math.min(this.end, this.t + 3));
      el.querySelector('[data-r=exit]').onclick = () => this.stop();
      el.querySelector('[data-r=cars]').onclick = () => {
        // follow another recorded car
        const cars = this.slots.filter((c) => c && !c.removed);
        const i = cars.indexOf(this.target);
        this.target = cars[(i + 1) % cars.length] || this.target;
        this.game.cam.initialized = false;
      };
      this.el = el;
    }
    this.el.classList.remove('hidden');
    this.game.input.unlock();
    this.updateUi(true);
  }

  updateUi(full) {
    const el = this.el;
    if (!el) return;
    el.querySelector('.rt').textContent = `${this.t.toFixed(1)} / ${this.end.toFixed(1)} s · ${this.speed}× · ${this.camMode}${this.auto ? ' · crash replay' : ''}`;
    el.querySelector('.scrub').value = String(Math.round((this.t / Math.max(0.01, this.end)) * 1000));
    el.querySelector('[data-r=play]').textContent = this.playing ? '⏸' : '▶';
    if (full) {
      el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', +b.dataset.s === this.speed));
      el.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === this.camMode));
    }
  }

  /** A big crash: play it back automatically in slow motion from the trackside. */
  onCrash(dv) {
    const g = this.game;
    if (!g.settings.autoReplay || this.active || g.activities?.current || dv < 22 || this.count < HZ * 3) return;
    if ((this.lastAuto || 0) > performance.now() - 20000) return;
    this.lastAuto = performance.now();
    this.pending = 1.4; // let the wreck settle first
  }

  tickPending(dt) {
    if (this.pending === undefined || this.pending === null) return;
    this.pending -= dt;
    if (this.pending > 0) return;
    this.pending = null;
    const d = this.duration;
    this.start({ from: Math.max(0, d - 5), to: d, speed: 0.4, auto: true, cam: 'trackside' });
  }
}
