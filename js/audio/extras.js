import * as THREE from 'three';
import { clamp } from '../core/util.js';
import { shoreZ } from '../world/terrain.js';

/**
 * Extra sound design on top of the core AudioEngine: one-shots used by the
 * activities and on-foot systems, mechanical details (EV hum, fuel pump,
 * fan run-on, exhaust tick, brake squeal, bump-stop clunks, damage rattles,
 * rod knock, gear grind), and the outdoor ambience (sea, gulls, birds,
 * wind gusts, rain on the roof, district beds). All synthesized.
 */

const _v = new THREE.Vector3();
const RELAY = { hatch: 1.15, sedan: 1, coupe: 1.06, muscle: 0.78, van: 0.86, pickup: 0.74, suv: 0.9, wagon: 0.95, classic: 0.7, truck: 0.66, supercar: 1.2 };

export function installExtras(AudioEngine) {
  const P = AudioEngine.prototype;

  /** Called at the end of setup(): continuous layers for the extras. */
  P.setupExtras = function () {
    const ctx = this.ctx;
    // EV pedestrian warning hum: two detuned tones with a slow wobble
    this.evHum = ctx.createGain();
    this.evHum.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 700;
    hf.Q.value = 0.8;
    this.evOscs = [430, 646].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
      return o;
    });
    hf.connect(this.evHum);
    this.evHum.connect(this.sfxBus);
    // fuel pump prime / radiator fan / extinguisher / sea / wind gusts / sand hiss / gravel
    this.pumpL = this.loopNoise(this.pink, 'bandpass', 210, 3, this.sfxBus);
    this.fanL = this.loopNoise(this.pink, 'bandpass', 380, 1.3, this.sfxBus);
    this.extL = this.loopNoise(this.noise, 'highpass', 2600, 0.7, this.sfxBus);
    this.seaL = this.loopNoise(this.brown, 'lowpass', 520, 0.6, this.worldBus);
    this.surfL = this.loopNoise(this.pink, 'bandpass', 1500, 0.4, this.worldBus);
    this.gustL = this.loopNoise(this.pink, 'bandpass', 320, 0.5, this.sfxBus);
    this.sandL = this.loopNoise(this.pink, 'lowpass', 1300, 0.5, this.sfxBus);
    this.gravelL = this.loopNoise(this.noise, 'bandpass', 2300, 1.4, this.sfxBus);
    // brake squeal: a thin tone with vibrato
    this.squealT = ctx.createOscillator();
    this.squealT.type = 'sine';
    this.squealT.frequency.value = 3600;
    this.squealG = ctx.createGain();
    this.squealG.gain.value = 0;
    this.squealT.connect(this.squealG);
    this.squealG.connect(this.sfxBus);
    this.squealT.start();
    this.ex = { ign: 'off', running: false, runT: 0, tickT: 0, fanRun: 0, primeT: 0, knockAt: 0, rattleT: 0, dmgT: 0, dmg: 0, birdT: 3, gullT: 2, dropT: 0, chimeT: 0, crowdT: 4, camPrev: new THREE.Vector3(), camVel: new THREE.Vector3() };
  };

  // ------------------------------------------------------------ one-shots
  P.beep = function (freq = 1000) {
    if (!this.ready) return;
    this.tone(freq, 0.12, { type: 'square', gain: 0.05 });
  };
  P.shutter = function () {
    if (!this.ready) return;
    this.noiseBurst(0.035, { gain: 0.35, type: 'highpass', freq: 3500 });
    this.play(this.tick, { gain: 0.6, rate: 0.7 });
    setTimeout(() => this.play(this.tick, { gain: 0.4, rate: 0.55 }), 90);
  };
  P.extinguisher = function (on) {
    if (!this.ready) return;
    this.extL.g.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.05);
  };
  /** A car whooshing past (near misses). */
  P.whoosh = function (car) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f);
    f.connect(g);
    if (car && car.body) {
      const p = this.makePanner(6, 1);
      this.setPannerPos(p, car.body.position);
      g.connect(p);
      p.connect(this.worldBus);
    } else g.connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + 0.8);
  };
  /** A body hitting the car (pedestrians). */
  P.thump = function (pos, a = 0.5) {
    if (!this.ready) return;
    this.tone(85, 0.2, { type: 'sine', gain: 0.5 * a, slide: -35 });
    this.noiseBurst(0.14, { gain: 0.35 * a, type: 'lowpass', freq: 420, pos });
  };
  P.splash = function (car, a = 0.5) {
    if (!this.ready) return;
    const pos = car && !car.isPlayer ? car.body.position : null;
    this.noiseBurst(0.9 + a * 0.8, { gain: 0.25 + a * 0.5, type: 'lowpass', freq: 700, pos });
    this.noiseBurst(0.5 + a * 0.4, { gain: 0.12 + a * 0.25, type: 'highpass', freq: 2200, pos });
  };
  /** A street racer revving at you. */
  P.revAt = function (car) {
    if (!this.ready || !car) return;
    const ctx = this.ctx;
    const p = this.makePanner(7, 1.1);
    this.setPannerPos(p, car.body.position);
    p.connect(this.worldBus);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    f.connect(p);
    const t = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const t0 = t + k * 0.75;
      o.frequency.setValueAtTime(55, t0);
      o.frequency.exponentialRampToValueAtTime(190, t0 + 0.3);
      o.frequency.exponentialRampToValueAtTime(60, t0 + 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.35, t0 + 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + 0.72);
      o.connect(g);
      g.connect(f);
      o.start(t0);
      o.stop(t0 + 0.75);
    }
  };
  /** Key fob chirp from the car (locked: two chirps). */
  P.fob = function (car, locked) {
    if (!this.ready || !car) return;
    const n = locked ? 2 : 1;
    for (let k = 0; k < n; k++) setTimeout(() => {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(2300, t);
      o.frequency.linearRampToValueAtTime(2600, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      const p = this.makePanner(5, 1);
      this.setPannerPos(p, car.body.position);
      o.connect(g);
      g.connect(p);
      p.connect(this.worldBus);
      o.start(t);
      o.stop(t + 0.15);
    }, k * 160);
  };
  P.explosion = function (pos) {
    if (!this.ready) return;
    const d = pos ? pos.distanceTo(this.game.camera.position) : 10;
    const a = clamp(30 / (d + 10), 0.15, 1.2);
    this.noiseBurst(2.8, { gain: a, type: 'lowpass', freq: 260, dest: this.master });
    this.noiseBurst(0.6, { gain: a * 0.6, type: 'bandpass', freq: 900, q: 0.6, dest: this.master });
    this.tone(48, 1.2, { type: 'sine', gain: a * 0.9, slide: -25, dest: this.master });
    // crackle as debris lands
    for (let k = 0; k < 8; k++) setTimeout(() => this.noiseBurst(0.06, { gain: a * 0.15, type: 'bandpass', freq: 1500 + Math.random() * 2500, q: 4, pos }), 600 + Math.random() * 1800);
  };
  /** A short burst of police radio: squelch, garbled speech, squelch. */
  P.radioChatter = function (dest = null, gain = 0.12) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const out = ctx.createBiquadFilter();
    out.type = 'bandpass';
    out.frequency.value = 1700;
    out.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = gain;
    out.connect(g);
    g.connect(dest || this.sfxBus);
    const t = ctx.currentTime;
    const squelch = (at) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.5, at);
      sg.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      s.connect(sg);
      sg.connect(out);
      s.start(at, Math.random());
      s.stop(at + 0.15);
    };
    squelch(t);
    // syllables: buzzy formant blips
    let at = t + 0.15;
    const n = 6 + Math.floor(Math.random() * 10);
    for (let k = 0; k < n; k++) {
      const dur = 0.06 + Math.random() * 0.12;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110 + Math.random() * 60, at);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(600 + Math.random() * 1600, at);
      f.frequency.linearRampToValueAtTime(600 + Math.random() * 1600, at + dur);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, at);
      og.gain.linearRampToValueAtTime(0.9, at + 0.01);
      og.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(f);
      f.connect(og);
      og.connect(out);
      o.start(at);
      o.stop(at + dur + 0.02);
      at += dur + (Math.random() < 0.2 ? 0.12 : 0.02);
    }
    squelch(at + 0.05);
    this.tone(1400, 0.08, { gain: 0.03, dest: g });
  };
  /** NPC speech: the browser voice if allowed, otherwise a muttering murmur. */
  P.voice = function (text, pos, kind = '') {
    if (!this.ready) return;
    const s = this.game.settings;
    const synth = window.speechSynthesis;
    if (s.npcVoices && synth && pos && pos.distanceTo(this.game.camera.position) < 30 && !synth.speaking) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.15;
        u.pitch = kind === 'ped' ? 1.1 : 0.85;
        u.volume = clamp(s.sfxVolume * 0.6, 0, 1);
        synth.speak(u);
        return;
      } catch (e) {
        /* fall through to the murmur */
      }
    }
    const ctx = this.ctx;
    const p = this.makePanner(4, 1.4);
    if (pos) this.setPannerPos(p, pos);
    p.connect(pos ? this.worldBus : this.sfxBus);
    const words = clamp(Math.round(text.length / 6), 2, 8);
    let at = ctx.currentTime;
    const base = kind === 'ped' ? 190 + Math.random() * 60 : 120 + Math.random() * 40;
    for (let k = 0; k < words * 2; k++) {
      const dur = 0.07 + Math.random() * 0.1;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), at);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(500 + Math.random() * 1500, at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.2, at + 0.015);
      g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(f);
      f.connect(g);
      g.connect(p);
      o.start(at);
      o.stop(at + dur + 0.02);
      at += dur + (k % 2 ? 0.06 : 0.015);
    }
  };
  /** Turn-by-turn and other short spoken prompts (GPS). */
  P.say = function (text) {
    const synth = window.speechSynthesis;
    if (!synth || !this.game.settings.gpsVoice) return;
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.volume = clamp(this.game.settings.sfxVolume, 0, 1);
      synth.speak(u);
    } catch (e) {
      /* no speech available */
    }
  };
  P.applyVolumes = function () {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.game.settings.masterVolume, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.game.settings.sfxVolume, t, 0.05);
  };
  P.grind = function () {
    if (!this.ready) return;
    this.noiseBurst(0.35, { gain: 0.35, type: 'bandpass', freq: 2400, q: 2 });
    this.tone(180, 0.3, { type: 'sawtooth', gain: 0.12, slide: 60 });
  };
  P.gull = function (pos) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const p = this.makePanner(10, 1);
    this.setPannerPos(p, pos);
    p.connect(this.worldBus);
    let at = ctx.currentTime;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 1600 + Math.random() * 500;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.linearRampToValueAtTime(f0 * 1.25, at + 0.06);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + 0.42);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2200;
      f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.25, at + 0.04);
      g.gain.linearRampToValueAtTime(0, at + 0.45);
      o.connect(f);
      f.connect(g);
      g.connect(p);
      o.start(at);
      o.stop(at + 0.5);
      at += 0.5 + Math.random() * 0.2;
    }
  };
  P.bird = function (pos) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const p = this.makePanner(8, 1.2);
    this.setPannerPos(p, pos);
    p.connect(this.worldBus);
    let at = ctx.currentTime;
    const n = 3 + Math.floor(Math.random() * 6);
    const base = 2600 + Math.random() * 2400;
    for (let k = 0; k < n; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const dur = 0.05 + Math.random() * 0.09;
      const f0 = base * (0.85 + Math.random() * 0.35);
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.4 : 0.7), at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.06, at + 0.01);
      g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g);
      g.connect(p);
      o.start(at);
      o.stop(at + dur + 0.02);
      at += dur + 0.03 + Math.random() * 0.08;
    }
  };
  P.cricket = function (pos) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const p = this.makePanner(6, 1.4);
    this.setPannerPos(p, pos);
    p.connect(this.worldBus);
    let at = ctx.currentTime;
    for (let k = 0; k < 6; k++) {
      const o = ctx.createOscillator();
      o.frequency.value = 4600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.025, at + 0.005);
      g.gain.linearRampToValueAtTime(0, at + 0.03);
      o.connect(g);
      g.connect(p);
      o.start(at);
      o.stop(at + 0.04);
      at += 0.06;
    }
  };

  // ------------------------------------------------------------ per frame
  P.updateExtras = function (dt) {
    const ex = this.ex;
    if (!ex) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = this.game;
    const cam = g.camera;
    const car = g.player.car;
    const inCar = g.player.mode === 'car' && car;
    const interior = inCar && g.cam.interior;
    const menu = g.state === 'menu' || g.state === 'garage';
    // camera velocity (for Doppler)
    if (dt > 0) ex.camVel.copy(cam.position).sub(ex.camPrev).divideScalar(dt);
    if (ex.camVel.lengthSq() > 4000) ex.camVel.set(0, 0, 0); // teleports
    ex.camPrev.copy(cam.position);

    let evHum = 0, pump = 0, fan = 0, brakeSq = 0, sand = 0, gravel = 0;
    if (car && !menu) {
      const pt = car.phys.pt;
      const ign = car.sys.ignition;
      const sp = car.speed;
      // EV hum below 30 km/h
      if (pt.ev && (pt.running || pt.ready)) evHum = clamp(1 - sp / 8.3, 0, 1) * clamp(sp / 0.4, 0.25, 1) * (interior ? 0.025 : 0.06);
      for (const o of this.evOscs) o.detune.setTargetAtTime(Math.sin(t * 3) * 12 + sp * 30, t, 0.1);
      // fuel pump primes for ~1.6 s when the key reaches ON
      if (ign === 'on' && ex.ign !== 'on' && !pt.running && !pt.ev) ex.primeT = 1.6;
      if (ign === 'start' && ex.ign !== 'start' && !pt.ev) ex.primeT = Math.max(ex.primeT, 0.5);
      ex.ign = ign;
      if (ex.primeT > 0) {
        ex.primeT -= dt;
        pump = (interior ? 0.09 : 0.03) * clamp(ex.primeT * 3, 0, 1);
      }
      // run-on fan and exhaust ticking after shutdown
      if (pt.running) {
        ex.runT += dt;
        if (pt.temp > 100) fan = 0.06;
      } else if (ex.running && !pt.ev) {
        // just shut off
        if (ex.runT > 15) ex.tickT = 30;
        if (pt.temp > 92 || ex.runT > 60) ex.fanRun = 25;
        ex.runT = 0;
      }
      ex.running = pt.running;
      if (ex.fanRun > 0 && !pt.running) {
        ex.fanRun -= dt;
        fan = Math.max(fan, 0.07 * clamp(ex.fanRun / 3, 0, 1));
      }
      if (ex.tickT > 0 && !pt.running) {
        ex.tickT -= dt;
        if (Math.random() < dt * (0.6 + ex.tickT * 0.12)) {
          car.body.toWorldPoint(_v.set(0, 0.3, -car.tuning.dims.L / 2), _v);
          this.play(this.tick, { gain: 0.25 + Math.random() * 0.2, rate: 0.6 + Math.random() * 0.5, pos: interior ? null : _v.clone() });
        }
      }
      // brake squeal at walking pace
      const inp = car.phys.input;
      if (pt.running || sp > 0.3) {
        const sq = sp > 0.4 && sp < 4.5 && inp.brake > 0.2 && !car.phys.pt.ev ? 1 : sp > 0.4 && sp < 4.5 && inp.brake > 0.2 ? 0.6 : 0;
        const bh = car.phys.brakeHeat;
        const hot = bh ? clamp(Math.max(...bh) / 300, 0, 1) : 0;
        brakeSq = sq * (car.squealy ?? (car.squealy = Math.random() < 0.5 ? 1 : 0.15)) * (0.02 + hot * 0.04) * clamp(inp.brake, 0, 1);
      }
      this.squealT.frequency.setTargetAtTime(3400 + Math.sin(t * 31) * 90 + (car.id % 5) * 120, t, 0.02);
      // tyre surfaces
      let gr = 0, sa = 0;
      for (const w of car.phys.wheels) {
        if (!w.contact || !w.mat) continue;
        if (w.mat.name === 'sand') sa = Math.max(sa, 1);
        else if (w.mat.name === 'gravel' || w.mat.name === 'dirt') gr = Math.max(gr, 1);
        // bump stop clunk
        if (w.s >= w.sMax * 0.97 && w.impact > 0.03 && (ex.clunkCd || 0) <= 0) {
          this.clunk(car, clamp(w.impact * 8, 0.3, 1));
          ex.clunkCd = 0.3;
        }
      }
      ex.clunkCd = (ex.clunkCd || 0) - dt;
      sand = sa * clamp(sp / 12, 0, 1) * 0.22;
      gravel = gr * clamp(sp / 15, 0, 1) * 0.12;
      if (gr && sp > 3 && Math.random() < dt * sp * 0.8) this.noiseBurst(0.03, { gain: 0.05 + Math.random() * 0.06, type: 'bandpass', freq: 1800 + Math.random() * 2600, q: 5 });
      // damage rattles over bumps
      ex.dmgT -= dt;
      if (ex.dmgT <= 0) {
        ex.dmgT = 0.5;
        ex.dmg = car.damageSummary().body;
      }
      if (ex.dmg > 0.15 && sp > 2) {
        const bumps = car.phys.wheels.reduce((m, w) => Math.max(m, w.impact || 0), 0);
        if (Math.random() < dt * ex.dmg * (3 + bumps * 300 + sp * 0.2)) this.noiseBurst(0.05 + Math.random() * 0.06, { gain: 0.04 + ex.dmg * 0.1, type: 'bandpass', freq: 1200 + Math.random() * 3000, q: 6 });
      }
      // rod knock on a damaged engine, scheduled on the audio clock
      if (pt.running && !pt.ev && pt.health < 0.6) {
        const period = Math.max(1 / 30, 120 / Math.max(600, pt.rpm));
        if (ex.knockAt < t) ex.knockAt = t + 0.02;
        while (ex.knockAt < t + 0.12) {
          if (Math.random() < 0.6 + (0.6 - pt.health)) {
            const src = ctx.createBufferSource();
            src.buffer = this.tock;
            src.playbackRate.value = 0.45;
            const kg = ctx.createGain();
            kg.gain.value = (0.6 - pt.health) * (interior ? 0.9 : 0.5) * (0.4 + pt.throttle * 0.6);
            src.connect(kg);
            kg.connect(this.engineBus);
            src.start(ex.knockAt);
          }
          ex.knockAt += period;
        }
      }
      // key-in-ignition chime when the door opens with the key on
      if (ex.chimeT > 0) {
        ex.chimeT -= dt;
        if (Math.floor((ex.chimeT + dt) * 2.5) !== Math.floor(ex.chimeT * 2.5)) this.tone(1170, 0.25, { gain: 0.05 });
      }
    }
    // tinnitus after a hard knock: a high whine and muffled surroundings, fading out
    const drv = car && car.ext ? car.ext.driver : null;
    const ring = drv && inCar ? drv.ring || 0 : 0;
    if (!this.tinn && ring > 0.05) {
      const o = ctx.createOscillator();
      o.frequency.value = 4100;
      const tg = ctx.createGain();
      tg.gain.value = 0;
      o.connect(tg);
      tg.connect(this.master);
      o.start();
      this.tinn = tg;
    }
    if (this.tinn) this.tinn.gain.setTargetAtTime(ring * 0.035, t, 0.2);
    if (ring > 0.2) this.worldFilter.frequency.setTargetAtTime(600 + (1 - ring) * 6000, t, 0.2);
    this.evHum.gain.setTargetAtTime(evHum, t, 0.1);
    this.pumpL.g.gain.setTargetAtTime(pump, t, 0.05);
    this.fanL.g.gain.setTargetAtTime(fan, t, 0.4);
    this.squealG.gain.setTargetAtTime(brakeSq, t, 0.05);
    this.sandL.g.gain.setTargetAtTime(sand, t, 0.08);
    this.gravelL.g.gain.setTargetAtTime(gravel, t, 0.08);

    // ---- outdoor ambience around the camera
    const env = g.env;
    const T = g.terrain;
    const cp = cam.position;
    const outside = interior ? 0.35 : 1;
    // the sea: distance to the shoreline (and the harbour basin)
    let seaD = 1e9;
    if (T) seaD = Math.max(0, shoreZ(cp.x) - cp.z);
    const sea = menu ? 0 : clamp(1 - seaD / 180, 0, 1);
    const swell = 0.55 + 0.45 * Math.sin(t * 0.85) * Math.sin(t * 0.31 + 1);
    this.seaL.g.gain.setTargetAtTime(sea * 0.16 * swell * outside, t, 0.3);
    this.surfL.g.gain.setTargetAtTime(sea * 0.05 * Math.max(0, swell - 0.5) * 2 * outside, t, 0.2);
    // wind gusts (heard more on foot / with the window down)
    const ws = env.windSpeed || 0;
    const winOpen = car ? car.sys.window : 1;
    const gustK = interior ? 0.1 + winOpen * 0.5 : 1;
    this.gustL.g.gain.setTargetAtTime(menu ? 0 : clamp((ws - 2) / 14, 0, 1) * 0.12 * gustK * (0.6 + 0.4 * Math.sin(t * 0.7)), t, 0.4);
    this.gustL.f.frequency.setTargetAtTime(260 + ws * 18, t, 0.5);
    // rain drumming on the roof
    if (interior && env.rain > 0.05 && !(car.convertible && car.sys.roofOpen)) {
      ex.dropT -= dt;
      const rate = env.rain * 45;
      while (ex.dropT <= 0) {
        ex.dropT += 1 / rate;
        this.noiseBurst(0.02, { gain: 0.015 + Math.random() * 0.03, type: 'bandpass', freq: 2500 + Math.random() * 4000, q: 3 });
      }
    }
    if (!menu && env.rain < 0.1) {
      const day = env.night < 0.5;
      // seagulls near the water
      ex.gullT -= dt;
      if (ex.gullT <= 0) {
        ex.gullT = 4 + Math.random() * 8;
        if (sea > 0.2 && day) this.gull(_v.set(cp.x + (Math.random() - 0.5) * 80, cp.y + 15 + Math.random() * 15, cp.z + (Math.random() - 0.2) * 80).clone());
      }
      // birdsong in parks and the countryside by day, crickets at night
      ex.birdT -= dt;
      if (ex.birdT <= 0) {
        ex.birdT = 2 + Math.random() * 5;
        const inCity = Math.abs(cp.x) < 390 && Math.abs(cp.z) < 390;
        const park = g.city.blocks.find((b) => b.type === 'park' && cp.x > b.x0 - 20 && cp.x < b.x1 + 20 && cp.z > b.z0 - 20 && cp.z < b.z1 + 20);
        const green = park || (!inCity && sea < 0.3);
        if (green) {
          const p = _v.set(cp.x + (Math.random() - 0.5) * 50, cp.y + 4 + Math.random() * 6, cp.z + (Math.random() - 0.5) * 50).clone();
          if (day) this.bird(p);
          else this.cricket(p);
        }
      }
    }
    // downtown: the odd distant horn or siren on the city bed
    ex.crowdT -= dt;
    if (ex.crowdT <= 0) {
      ex.crowdT = 6 + Math.random() * 10;
      const downtown = Math.abs(cp.x) < 170 && Math.abs(cp.z) < 170;
      if (downtown && !menu && Math.random() < 0.6) {
        const far = _v.set(cp.x + (Math.random() - 0.5) * 300, 2, cp.z + (Math.random() - 0.5) * 300).clone();
        if (Math.random() < 0.7) this.noiseBurst(0.25, { gain: 0.05, type: 'bandpass', freq: 450 + Math.random() * 120, q: 8, pos: far });
        else this.tone(800 + Math.random() * 200, 1.2, { gain: 0.012, slide: 300 });
      }
    }
  };

  /** Helicopter rotor: thudding noise (amplitude-modulated at blade pass), positional. */
  P.heliRotor = function (pos, dist, on) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!this.heli) {
      if (!on) return;
      const src = ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG);
      lfoG.connect(am.gain);
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = this.makePanner(25, 0.8);
      src.connect(f);
      f.connect(am);
      am.connect(g);
      g.connect(p);
      p.connect(this.worldBus);
      src.start();
      lfo.start();
      this.heli = { src, lfo, g, p };
    }
    this.setPannerPos(this.heli.p, pos);
    this.heli.g.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.3);
  };

  /** A distant airliner: a low roar that follows the plane across the sky. */
  P.jetRumble = function (pos, on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (!this.jet) {
      if (!on) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.brown;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 260;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const p = this.makePanner(200, 0.6);
      src.connect(f);
      f.connect(g);
      g.connect(p);
      p.connect(this.worldBus);
      src.start();
      this.jet = { g, p };
    }
    this.setPannerPos(this.jet.p, pos);
    this.jet.g.gain.setTargetAtTime(on ? 0.5 : 0, t, 1.5);
  };

  /** Relay sound for the player's indicators: each body has its own click. */
  P.relay = function (car, on, interior) {
    if (car.phys.pt.ev) this.tone(on ? 1900 : 1500, 0.03, { gain: interior ? 0.05 : 0.015 });
    else this.play(on ? this.tick : this.tock, { gain: interior ? 0.35 : 0.1, rate: RELAY[car.cfg.body] || 1 });
  };

  /** Doppler factor for a source moving at vel relative to the listener. */
  P.doppler = function (pos, vel) {
    const ex = this.ex;
    if (!ex) return 1;
    const cp = this.game.camera.position;
    _v.copy(pos).sub(cp);
    const d = _v.length();
    if (d < 1) return 1;
    _v.divideScalar(d);
    const vs = vel.x * _v.x + vel.y * _v.y + vel.z * _v.z; // source moving away > 0
    const vl = ex.camVel.x * _v.x + ex.camVel.y * _v.y + ex.camVel.z * _v.z; // listener moving toward source > 0
    return clamp((343 + vl) / (343 + vs), 0.7, 1.4);
  };
}
