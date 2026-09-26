import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { Radio } from './radio.js';

// ------------------------------------------------------------------ synthesis helpers
const ENGINE_PROFILES = {
  i4: { pattern: [1, 0.9, 1, 0.92], f: [165, 440, 900], a: [1, 0.55, 0.2], noise: 0.28, jitter: 0.01, decay: 90 },
  v6: { pattern: [1, 0.86, 0.95, 0.9, 1, 0.85], f: [130, 380, 760], a: [1, 0.6, 0.25], noise: 0.22, jitter: 0.012, decay: 75 },
  v8: { pattern: [1, 0.55, 0.95, 0.7, 1, 0.5, 0.9, 0.78], f: [88, 245, 520], a: [1, 0.7, 0.3], noise: 0.32, jitter: 0.03, decay: 55 },
  i6: { pattern: [1, 0.96, 1, 0.95, 1, 0.97], f: [150, 520, 1100], a: [1, 0.5, 0.25], noise: 0.18, jitter: 0.006, decay: 95 },
};

function engineBuffer(ctx, profile, cyl, rpm, onLoad) {
  const sr = ctx.sampleRate;
  const cycleTime = 120 / rpm;
  const cycles = Math.max(4, Math.round(1.2 / cycleTime));
  const dur = cycleTime * cycles;
  const len = Math.round(dur * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const P = ENGINE_PROFILES[profile] || ENGINE_PROFILES.v6;
  let seed = rpm * 7 + (onLoad ? 3 : 1) + cyl;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pulses = cycles * cyl;
  const pulseLen = Math.min(Math.round(0.035 * sr), Math.round((dur / pulses) * sr * 3));
  const load = onLoad ? 1 : 0.45;
  for (let p = 0; p < pulses; p++) {
    const k = p % cyl;
    const t0 = ((p + (rnd() - 0.5) * P.jitter * cyl) / pulses) * len;
    const amp = P.pattern[k % P.pattern.length] * (0.85 + rnd() * 0.3) * load;
    const ph = rnd() * 6.28;
    const decay = P.decay * (onLoad ? 1 : 1.4) * (rpm / 3000) ** 0.3;
    for (let n = 0; n < pulseLen; n++) {
      const t = n / sr;
      const env = Math.exp(-t * decay) * (1 - Math.exp(-t * 3000));
      const v =
        Math.sin(6.283 * P.f[0] * t) * P.a[0] +
        Math.sin(6.283 * P.f[1] * t + ph) * P.a[1] * (onLoad ? 1 : 0.6) +
        Math.sin(6.283 * P.f[2] * t + ph * 2) * P.a[2] * (onLoad ? 1 : 0.4) +
        (rnd() * 2 - 1) * P.noise * (onLoad ? 1 : 0.5);
      const idx = (Math.floor(t0) + n) % len;
      d[idx] += v * env * amp;
    }
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] = (d[i] / peak) * 0.9;
  return buf;
}

function noiseBuffer(ctx, secs = 2, color = 'white') {
  const len = Math.round(ctx.sampleRate * secs);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else d[i] = w;
  }
  return b;
}

function crunchBuffer(ctx, seedN, kind = 'metal') {
  const sr = ctx.sampleRate;
  const dur = kind === 'glass' ? 1.4 : 0.9;
  const len = Math.round(sr * dur);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  let seed = 1234 + seedN * 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'glass') {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (rnd() * 2 - 1) * Math.exp(-t * 18) * 0.5;
    }
    for (let k = 0; k < 90; k++) {
      const t0 = Math.pow(rnd(), 1.8) * (dur - 0.15);
      const f = 2500 + rnd() * 6000;
      const a = 0.15 + rnd() * 0.35;
      const dec = 40 + rnd() * 80;
      const s = Math.floor(t0 * sr);
      for (let n = 0; n < sr * 0.1 && s + n < len; n++) {
        const t = n / sr;
        d[s + n] += Math.sin(6.283 * f * t) * Math.exp(-t * dec) * a;
      }
    }
  } else {
    const modes = [];
    for (let k = 0; k < 7; k++) modes.push({ f: 180 + rnd() * 1800, a: 0.2 + rnd() * 0.5, dec: 6 + rnd() * 16, ph: rnd() * 6 });
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let v = (rnd() * 2 - 1) * Math.exp(-t * 14) * 0.9;
      // low thump
      v += Math.sin(6.283 * (55 - t * 30) * t) * Math.exp(-t * 12) * 1.2;
      for (const m of modes) v += Math.sin(6.283 * m.f * t + m.ph) * m.a * Math.exp(-t * m.dec) * 0.45;
      // crumple crackle
      if (rnd() < 0.004 * Math.exp(-t * 4)) v += (rnd() * 2 - 1) * 2;
      d[i] = v;
    }
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak;
  return b;
}

function clickBuffer(ctx, f, dur = 0.02) {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * dur);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    d[i] = (Math.sin(6.283 * f * t) * 0.6 + (Math.random() * 2 - 1) * 0.4) * Math.exp(-t * 300);
  }
  return b;
}

// ------------------------------------------------------------------ engine voice (player)
class PlayerEngine {
  constructor(audio, car) {
    this.audio = audio;
    const ctx = audio.ctx;
    this.car = car;
    const spec = car.phys.pt.spec;
    this.ev = spec.type === 'ev';
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.8;
    this.shaper = ctx.createWaveShaper();
    this.setDrive(car.cfg.exhaust === 'straight' ? 3 : car.cfg.exhaust === 'sport' ? 1.8 : 1);
    this.shaper.connect(this.filter);
    this.filter.connect(this.out);
    this.out.connect(audio.engineBus);
    this.sources = [];
    if (!this.ev) {
      const profile = spec.sound || 'v6';
      const cyl = spec.cylinders || 6;
      this.bands = [900, 2800, 5600];
      for (const rpm of this.bands) {
        for (const on of [true, false]) {
          const key = `${profile}:${cyl}:${rpm}:${on}`;
          let buf = audio.bufCache.get(key);
          if (!buf) {
            buf = engineBuffer(ctx, profile, cyl, rpm, on);
            audio.bufCache.set(key, buf);
          }
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const g = ctx.createGain();
          g.gain.value = 0;
          src.connect(g);
          g.connect(this.shaper);
          src.start(0, Math.random() * buf.duration);
          this.sources.push({ src, g, rpm, on });
        }
      }
    } else {
      // electric motor: two tonal layers + inverter whine
      for (const [mult, type, gain] of [[1, 'sine', 0.5], [2.02, 'triangle', 0.18], [6.1, 'sine', 0.05]]) {
        const o = ctx.createOscillator();
        o.type = type;
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g);
        g.connect(this.shaper);
        o.start();
        this.sources.push({ osc: o, g, mult, base: gain });
      }
    }
    // turbo whistle
    this.turbo = null;
    if (spec.turbo) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g);
      g.connect(audio.engineBus);
      o.start();
      const n = ctx.createBufferSource();
      n.buffer = audio.noise;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3500;
      bp.Q.value = 3;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      n.connect(bp);
      bp.connect(ng);
      ng.connect(audio.engineBus);
      n.start();
      this.turbo = { o, g, ng };
    }
    // gear whine
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineG = ctx.createGain();
    this.whineG.gain.value = 0;
    this.whine.connect(this.whineG);
    this.whineG.connect(audio.engineBus);
    this.whine.start();
    // starter motor
    this.starter = ctx.createOscillator();
    this.starter.type = 'sawtooth';
    this.starter.frequency.value = 150;
    this.starterG = ctx.createGain();
    this.starterG.gain.value = 0;
    const sLfo = ctx.createOscillator();
    sLfo.frequency.value = 9;
    const sLfoG = ctx.createGain();
    sLfoG.gain.value = 0.5;
    sLfo.connect(sLfoG);
    const sAm = ctx.createGain();
    sAm.gain.value = 0.5;
    sLfoG.connect(sAm.gain);
    const sF = ctx.createBiquadFilter();
    sF.type = 'lowpass';
    sF.frequency.value = 900;
    this.starter.connect(sF);
    sF.connect(sAm);
    sAm.connect(this.starterG);
    this.starterG.connect(audio.engineBus);
    this.starter.start();
    sLfo.start();
    this.extra = [this.whine, this.starter, sLfo];
  }

  setDrive(k) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    this.shaper.curve = curve;
  }

  update(dt, interior) {
    const ctx = this.audio.ctx;
    const t = ctx.currentTime;
    const pt = this.car.phys.pt;
    const rpm = Math.max(pt.rpm, 1);
    const running = pt.running;
    const vol = this.audio.game.settings.engineVolume;
    const exhaust = this.car.cfg.exhaust;
    const loud = exhaust === 'straight' ? 1.35 : exhaust === 'sport' ? 1.1 : 0.85;
    const load = clamp(pt.throttle * 1.1, 0, 1);
    if (!this.ev) {
      // crossfade rpm bands
      const b = this.bands;
      let w0 = 0, w1 = 0, w2 = 0;
      if (rpm <= b[0]) w0 = 1;
      else if (rpm <= b[1]) { const f = (rpm - b[0]) / (b[1] - b[0]); w0 = Math.cos(f * Math.PI / 2); w1 = Math.sin(f * Math.PI / 2); }
      else if (rpm <= b[2]) { const f = (rpm - b[1]) / (b[2] - b[1]); w1 = Math.cos(f * Math.PI / 2); w2 = Math.sin(f * Math.PI / 2); }
      else w2 = 1;
      const ws = [w0, w1, w2];
      for (const s of this.sources) {
        const bi = b.indexOf(s.rpm);
        const lw = s.on ? 0.35 + 0.65 * load : 0.65 * (1 - load) + 0.2;
        s.g.gain.setTargetAtTime(ws[bi] * lw, t, 0.03);
        s.src.playbackRate.setTargetAtTime(clamp(rpm / s.rpm, 0.25, 3), t, 0.02);
      }
      const level = running ? (0.55 + 0.45 * load) * loud : pt.cranking || rpm > 150 ? 0.25 * clamp(rpm / 400, 0, 1) : 0;
      this.out.gain.setTargetAtTime(level * vol * (pt.misfire ? 0.3 : 1), t, pt.misfire ? 0.005 : 0.04);
      const bright = interior ? 700 + rpm * 0.35 + load * 900 : 1400 + rpm * 0.9 + load * 3000;
      this.filter.frequency.setTargetAtTime(Math.min(bright, 16000), t, 0.05);
    } else {
      const f = rpm / 60;
      for (const s of this.sources) {
        s.osc.frequency.setTargetAtTime(20 + f * s.mult * 2.2, t, 0.03);
        s.g.gain.setTargetAtTime(running ? s.base * (0.25 + 0.75 * Math.min(1, pt.load + rpm / 16000)) : 0, t, 0.05);
      }
      this.out.gain.setTargetAtTime(running ? 0.5 * vol : 0, t, 0.05);
      this.filter.frequency.setTargetAtTime(interior ? 3000 : 9000, t, 0.1);
    }
    if (this.turbo) {
      const b = pt.boost;
      this.turbo.o.frequency.setTargetAtTime(1800 + b * 5200 + rpm * 0.2, t, 0.05);
      this.turbo.g.gain.setTargetAtTime(b * b * 0.045 * vol, t, 0.05);
      this.turbo.ng.gain.setTargetAtTime(b * 0.03 * vol, t, 0.05);
    }
    const gearF = (rpm / 60) * 23;
    this.whine.frequency.setTargetAtTime(gearF, t, 0.05);
    this.whineG.gain.setTargetAtTime(running && pt.gear !== 0 ? 0.006 * vol * (0.3 + load) : 0, t, 0.1);
    this.starterG.gain.setTargetAtTime(pt.cranking ? 0.18 * vol : 0, t, 0.03);
    this.starter.frequency.setTargetAtTime(120 + pt.rpm * 0.15, t, 0.05);
  }

  dispose() {
    for (const s of this.sources) {
      try {
        (s.src || s.osc).stop();
      } catch (e) { /* already stopped */ }
    }
    for (const o of this.extra) try { o.stop(); } catch (e) { /* */ }
    if (this.turbo) try { this.turbo.o.stop(); } catch (e) { /* */ }
    this.out.disconnect();
  }
}

// ------------------------------------------------------------------ positional voices for NPCs
class NpcVoice {
  constructor(audio) {
    const ctx = audio.ctx;
    this.audio = audio;
    this.panner = audio.makePanner(6, 1.3);
    this.src = ctx.createBufferSource();
    this.src.buffer = audio.npcEngineBuf;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1200;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.src.connect(this.filter);
    this.filter.connect(this.g);
    this.g.connect(this.panner);
    this.panner.connect(audio.worldBus);
    this.src.start(0, Math.random());
    this.car = null;
  }
  update(t) {
    const c = this.car;
    if (!c || c.removed) {
      this.g.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    const pt = c.phys.pt;
    const p = c.body.position;
    this.audio.setPannerPos(this.panner, p);
    const rpm = c.physicsActive ? pt.rpm : 900 + c.speed * 60;
    this.src.playbackRate.setTargetAtTime(clamp(rpm / 2800, 0.25, 2.6), t, 0.05);
    const on = pt.running || !c.physicsActive;
    this.g.gain.setTargetAtTime(on ? 0.25 + pt.throttle * 0.35 : 0, t, 0.08);
    this.filter.frequency.setTargetAtTime(600 + rpm * 0.5 + pt.throttle * 1500, t, 0.1);
  }
}

class Siren {
  constructor(audio) {
    const ctx = audio.ctx;
    this.audio = audio;
    this.panner = audio.makePanner(12, 1.0);
    this.osc = ctx.createOscillator();
    this.osc.type = 'square';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sawtooth';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.osc.connect(f);
    this.osc2.connect(f);
    f.connect(this.g);
    this.g.connect(this.panner);
    this.panner.connect(audio.worldBus);
    this.osc.start();
    this.osc2.start();
    this.car = null;
    this.phase = Math.random() * 10;
    this.mode = 0;
    this.modeT = 0;
  }
  update(dt, t) {
    const c = this.car;
    const on = c && !c.removed && c.sirenOn;
    this.g.gain.setTargetAtTime(on ? 0.16 : 0, t, 0.05);
    if (!on) return;
    this.audio.setPannerPos(this.panner, c.body.position);
    this.modeT -= dt;
    if (this.modeT <= 0) {
      this.mode = (this.mode + 1) % 3;
      this.modeT = this.mode === 0 ? 5 : this.mode === 1 ? 3 : 1.6;
    }
    this.phase += dt;
    let f;
    if (this.mode === 0) f = 950 + Math.sin(this.phase * 1.6) * 450; // wail
    else if (this.mode === 1) f = 950 + Math.sin(this.phase * 22) * 420; // yelp
    else f = 700 + ((this.phase * 14) % 1) * 900; // hi-lo phaser
    this.osc.frequency.setTargetAtTime(f, t, 0.01);
    this.osc2.frequency.setTargetAtTime(f * 1.005, t, 0.01);
  }
}

// ------------------------------------------------------------------ engine
export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.bufCache = new Map();
    this.ready = false;
    this.playerEngine = null;
    this.npcVoices = [];
    this.sirens = [];
    this.hornVoices = new Map();
    this.assignTimer = 0;
    this.indicatorPhase = false;
    this.lastBlink = false;
    this.pendingCar = null;
  }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        return;
      }
      this.setup();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setup() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.game.settings.masterVolume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.game.settings.sfxVolume;
    this.sfxBus.connect(this.master);
    // world sounds pass through a filter that closes when you're inside the car
    this.worldFilter = ctx.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.worldFilter.frequency.value = 20000;
    this.worldBus = ctx.createGain();
    this.worldBus.connect(this.worldFilter);
    this.worldFilter.connect(this.sfxBus);
    this.noise = noiseBuffer(ctx, 3, 'white');
    this.pink = noiseBuffer(ctx, 3, 'pink');
    this.brown = noiseBuffer(ctx, 3, 'brown');
    this.crunches = [0, 1, 2, 3].map((i) => crunchBuffer(ctx, i, 'metal'));
    this.glassBuf = [0, 1].map((i) => crunchBuffer(ctx, i + 7, 'glass'));
    this.tick = clickBuffer(ctx, 2600, 0.015);
    this.tock = clickBuffer(ctx, 1900, 0.018);
    this.npcEngineBuf = engineBuffer(ctx, 'v6', 6, 2800, true);
    // continuous layers
    this.road = this.loopNoise(this.brown, 'lowpass', 260, 0.7, this.sfxBus);
    this.wind = this.loopNoise(this.pink, 'bandpass', 700, 0.6, this.sfxBus);
    this.squeal = this.loopNoise(this.noise, 'bandpass', 1300, 6, this.sfxBus);
    this.squeal2 = this.loopNoise(this.noise, 'bandpass', 2100, 8, this.sfxBus);
    this.rumble = this.loopNoise(this.brown, 'lowpass', 500, 0.7, this.sfxBus);
    this.scrape = this.loopNoise(this.noise, 'bandpass', 3200, 3, this.sfxBus);
    this.rainL = this.loopNoise(this.pink, 'highpass', 1200, 0.5, this.master);
    this.city = this.loopNoise(this.brown, 'lowpass', 400, 0.5, this.worldBus);
    this.flap = this.loopNoise(this.brown, 'lowpass', 180, 1, this.sfxBus);
    for (let i = 0; i < 5; i++) this.npcVoices.push(new NpcVoice(this));
    for (let i = 0; i < 3; i++) this.sirens.push(new Siren(this));
    // player horn
    this.horn = this.makeHorn(this.game.player.car?.cfg.horn || 'dual', this.sfxBus);
    this.radio = new Radio(this);
    this.ready = true;
    if (this.game.player.car) this.setPlayerCar(this.game.player.car);
  }

  loopNoise(buf, type, freq, q, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(0, Math.random() * 2);
    return { src, f, g };
  }

  makePanner(ref = 5, roll = 1.2) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 400;
    return p;
  }

  setPannerPos(p, v) {
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(v.x, t, 0.02);
      p.positionY.setTargetAtTime(v.y, t, 0.02);
      p.positionZ.setTargetAtTime(v.z, t, 0.02);
    } else p.setPosition(v.x, v.y, v.z);
  }

  makeHorn(type, dest, panner) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2800;
    const freqs = { normal: [440], dual: [405, 510], truck: [185, 233, 277], melody: [523], high: [620, 780] }[type] || [405, 510];
    const oscs = freqs.map((fr) => {
      const o = ctx.createOscillator();
      o.type = type === 'truck' ? 'sawtooth' : 'square';
      o.frequency.value = fr;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(g);
    g.connect(panner || dest);
    if (panner) panner.connect(dest);
    return { g, oscs, type, freqs, t: 0, note: 0 };
  }

  setPlayerCar(car) {
    if (!this.ready) return;
    this.playerEngine?.dispose();
    this.playerEngine = new PlayerEngine(this, car);
    if (this.horn) {
      this.horn.oscs.forEach((o) => o.stop());
      this.horn.g.disconnect();
    }
    this.horn = this.makeHorn(car.cfg.horn || 'dual', this.sfxBus);
  }

  removeCar(car) {
    for (const v of this.npcVoices) if (v.car === car) v.car = null;
    for (const s of this.sirens) if (s.car === car) s.car = null;
  }

  // ------------------------------------------------------------ one-shots
  play(buf, { gain = 1, rate = 1, pos = null, dest = null, ref = 6, filter = null } = {}) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = src;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    if (pos) {
      const p = this.makePanner(ref, 1.1);
      this.setPannerPos(p, pos);
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      }
      g.connect(p);
      p.connect(dest || this.worldBus);
    } else g.connect(dest || this.sfxBus);
    src.start();
    return src;
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, dest = null, slide = 0, attack = 0.005 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, { gain = 0.3, type = 'bandpass', freq = 2000, q = 1, pos = null, dest = null } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    if (pos) {
      const p = this.makePanner(6, 1.1);
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      }
      g.connect(p);
      p.connect(dest || this.worldBus);
    } else g.connect(dest || this.sfxBus);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  impact(p, dv, kind, car) {
    if (!this.ready) return;
    const g = clamp(dv / 18, 0.08, 1.4);
    const player = car && car.isPlayer;
    const buf = this.crunches[Math.floor(Math.random() * this.crunches.length)];
    this.play(buf, { gain: g * 1.1, rate: 0.75 + Math.random() * 0.4 - dv * 0.004, pos: player ? null : p, dest: player ? this.sfxBus : null });
    if (dv > 8) this.noiseBurst(0.25, { gain: g * 0.5, type: 'lowpass', freq: 180, pos: player ? null : p });
  }
  glass(car, amount) {
    if (!this.ready) return;
    this.play(this.glassBuf[Math.floor(Math.random() * 2)], { gain: 0.5 * amount + 0.1, rate: 0.9 + Math.random() * 0.25, pos: car && !car.isPlayer ? car.body.position : null });
  }
  clunk(car, a = 0.6) {
    if (!this.ready) return;
    this.tone(90, 0.18, { type: 'triangle', gain: 0.3 * a, slide: -40 });
    this.noiseBurst(0.12, { gain: 0.25 * a, type: 'lowpass', freq: 600, pos: car && !car.isPlayer ? car.body.position : null });
  }
  debrisHit(it, v) {
    if (!this.ready) return;
    if (this.game.camera.position.distanceTo(it.body.position) > 80) return;
    const rubber = it.mat === 'rubber';
    this.noiseBurst(rubber ? 0.15 : 0.2, { gain: clamp(v / 10, 0.05, 0.5), type: 'bandpass', freq: rubber ? 250 : 900 + Math.random() * 1500, q: rubber ? 1 : 6, pos: it.body.position });
  }
  propHit(item, speed, p) {
    if (!this.ready) return;
    const metal = item.kind === 'lamp' || item.kind === 'hydrant' || item.kind === 'meter' || item.kind === 'mailbox' || item.kind === 'barrel';
    const pos = new THREE.Vector3(item.x, 0.5, item.z);
    if (metal) this.play(this.crunches[2], { gain: clamp(speed / 20, 0.15, 0.9), rate: 1.3, pos });
    else this.noiseBurst(0.25, { gain: 0.35, type: 'bandpass', freq: item.kind === 'cone' ? 500 : 900, q: 2, pos });
    if (item.kind === 'hydrant') this.noiseBurst(2.5, { gain: 0.4, type: 'highpass', freq: 1500, pos });
  }
  click() {
    if (this.ready) this.play(this.tick, { gain: 0.5 });
  }
  keyTurn() {
    if (!this.ready) return;
    this.play(this.tock, { gain: 0.6, rate: 0.7 });
    setTimeout(() => this.play(this.tick, { gain: 0.4, rate: 0.8 }), 60);
  }
  chime(kind) {
    if (!this.ready) return;
    if (kind === 'belt') {
      this.tone(1050, 0.35, { gain: 0.08 });
      setTimeout(() => this.tone(1050, 0.35, { gain: 0.08 }), 400);
    } else this.tone(880, 0.5, { gain: 0.07 });
  }
  buckle(on) {
    if (!this.ready) return;
    this.play(this.tick, { gain: 0.8, rate: on ? 0.6 : 0.45 });
    this.noiseBurst(0.08, { gain: 0.15, type: 'highpass', freq: 3000 });
  }
  ratchet() {
    if (!this.ready) return;
    for (let i = 0; i < 5; i++) setTimeout(() => this.play(this.tick, { gain: 0.35, rate: 0.5 }), i * 45);
  }
  door(open) {
    if (!this.ready) return;
    if (open) this.play(this.tock, { gain: 0.8, rate: 0.35 });
    else {
      this.tone(70, 0.2, { type: 'triangle', gain: 0.5, slide: -30 });
      this.noiseBurst(0.15, { gain: 0.3, type: 'lowpass', freq: 500 });
    }
  }
  windowMotor() {
    if (!this.ready) return;
    this.tone(160, 1.2, { type: 'sawtooth', gain: 0.03, slide: 20 });
  }
  wiper() {
    if (!this.ready) return;
    this.tone(95, 0.35, { type: 'sawtooth', gain: 0.02 });
    this.noiseBurst(0.12, { gain: 0.03, type: 'bandpass', freq: 1800, q: 4 });
  }
  washer() {
    if (!this.ready) return;
    this.noiseBurst(0.8, { gain: 0.06, type: 'highpass', freq: 2500 });
  }
  airbag() {
    if (!this.ready) return;
    this.noiseBurst(0.35, { gain: 1, type: 'lowpass', freq: 900 });
    this.tone(60, 0.3, { type: 'sine', gain: 0.8, slide: -30 });
    // ears ringing
    this.tone(4200, 3.5, { type: 'sine', gain: 0.03, attack: 0.2 });
  }
  repair() {
    if (!this.ready) return;
    [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, { gain: 0.08 }), i * 90));
  }
  thunder(dist) {
    if (!this.ready) return;
    this.noiseBurst(3 + dist, { gain: clamp(1 / (dist + 0.4), 0.2, 0.9), type: 'lowpass', freq: 160 + 200 / (dist + 0.5), dest: this.master });
  }
  pop(big) {
    if (!this.ready) return;
    this.noiseBurst(big ? 0.09 : 0.05, { gain: big ? 0.7 : 0.35, type: 'lowpass', freq: big ? 900 : 1500 });
    this.tone(big ? 70 : 110, 0.08, { type: 'square', gain: big ? 0.25 : 0.1, slide: -40 });
  }
  blowoff(a) {
    if (!this.ready) return;
    this.noiseBurst(0.35 + a * 0.2, { gain: 0.08 + a * 0.15, type: 'bandpass', freq: 2600, q: 1.5 });
  }
  gearClunk() {
    if (!this.ready) return;
    this.play(this.tock, { gain: 0.25, rate: 0.5 });
  }
  /** NPC horn from a car (positional), dur seconds. */
  hornAt(car, dur = 0.4, angry = false) {
    if (!this.ready || car.removed) return;
    if (car.body.position.distanceTo(this.game.camera.position) > 120) return;
    const ctx = this.ctx;
    const panner = this.makePanner(8, 1.1);
    this.setPannerPos(panner, car.body.position);
    if (panner.positionX) {
      panner.positionX.value = car.body.position.x;
      panner.positionY.value = car.body.position.y;
      panner.positionZ.value = car.body.position.z;
    }
    const types = ['dual', 'normal', 'high', 'dual', 'truck'];
    const h = this.makeHorn(car.hornType || types[car.id % types.length], this.worldBus, panner);
    const t = ctx.currentTime;
    h.g.gain.setValueAtTime(0, t);
    h.g.gain.linearRampToValueAtTime(0.13, t + 0.01);
    if (angry) {
      // honk-honk-hooonk
      h.g.gain.setValueAtTime(0.13, t + 0.18);
      h.g.gain.linearRampToValueAtTime(0, t + 0.2);
      h.g.gain.setValueAtTime(0, t + 0.3);
      h.g.gain.linearRampToValueAtTime(0.13, t + 0.31);
      h.g.gain.setValueAtTime(0.13, t + 0.3 + dur);
      h.g.gain.linearRampToValueAtTime(0, t + 0.32 + dur);
      dur += 0.35;
    } else {
      h.g.gain.setValueAtTime(0.13, t + dur);
      h.g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    }
    h.oscs.forEach((o) => o.stop(t + dur + 0.1));
  }

  // radio proxies
  nextStation() { this.radio?.next(); }
  prevStation() { this.radio?.prev(); }
  toggleRadio() { this.radio?.toggle(); }

  // ------------------------------------------------------------ per frame
  update(dt) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const game = this.game;
    const s = game.settings;
    this.master.gain.setTargetAtTime(game.state === 'pause' ? s.masterVolume * 0.3 : s.masterVolume, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(s.sfxVolume, t, 0.1);
    // listener = camera
    const cam = game.camera;
    const L = ctx.listener;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, t, 0.01);
      L.positionY.setTargetAtTime(cam.position.y, t, 0.01);
      L.positionZ.setTargetAtTime(cam.position.z, t, 0.01);
      L.forwardX.setTargetAtTime(f.x, t, 0.01);
      L.forwardY.setTargetAtTime(f.y, t, 0.01);
      L.forwardZ.setTargetAtTime(f.z, t, 0.01);
      L.upX.setTargetAtTime(u.x, t, 0.01);
      L.upY.setTargetAtTime(u.y, t, 0.01);
      L.upZ.setTargetAtTime(u.z, t, 0.01);
    } else {
      L.setPosition(cam.position.x, cam.position.y, cam.position.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    const car = game.player.car;
    const inCar = game.player.mode === 'car' && car;
    const interior = inCar && game.cam.mode === 'cockpit';
    const windowOpen = car ? Math.max(car.sys.window, car.model.parts.winFL?.state === 'shattered' ? 1 : 0, car.model.parts.windshield?.state === 'shattered' ? 1 : 0) : 1;
    const closed = interior ? 1 - windowOpen * 0.8 : 0;
    this.worldFilter.frequency.setTargetAtTime(lerp(20000, 1400, closed), t, 0.1);
    const menu = game.state === 'menu' || game.state === 'garage';

    if (this.playerEngine && car) {
      if (this.playerEngine.car !== car) this.setPlayerCar(car);
      this.playerEngine.update(dt, interior);
      this.engineBus.gain.setTargetAtTime(menu ? 0.35 : game.player.mode === 'foot' ? 0.6 : 1, t, 0.1);
      // powertrain events
      for (const ev of car.phys.pt.events) {
        if (ev.type === 'pop') this.pop(ev.big);
        else if (ev.type === 'blowoff') this.blowoff(ev.amount);
        else if (ev.type === 'shift') this.gearClunk();
        else if (ev.type === 'start') this.tone(60, 0.4, { type: 'sawtooth', gain: 0.05, slide: 40 });
        else if (ev.type === 'stall') this.clunk(car, 0.3);
      }
      car.phys.pt.events.length = 0;
      // tires
      let squeal = 0, rough = 0, bumps = 0;
      for (const w of car.phys.wheels) {
        if (!w.contact) continue;
        const loose = w.mat && (w.mat.name === 'grass' || w.mat.name === 'dirt');
        const sq = clamp((w.slip - 1.0) * 0.6, 0, 1) * clamp((w.slideVel - 1.5) / 6, 0, 1);
        if (loose) rough = Math.max(rough, sq + car.speed / 30);
        else squeal = Math.max(squeal, sq);
        bumps = Math.max(bumps, w.impact);
      }
      const wet = game.env.wetness;
      const tv = s.sfxVolume;
      this.squeal.g.gain.setTargetAtTime(squeal * 0.22 * (1 - wet * 0.8) * car.tuning.tire.squeal, t, 0.04);
      this.squeal2.g.gain.setTargetAtTime(squeal * 0.1 * (1 - wet * 0.8), t, 0.04);
      this.squeal.f.frequency.setTargetAtTime(1100 + Math.sin(t * 7) * 120 + squeal * 250, t, 0.05);
      this.rumble.g.gain.setTargetAtTime(clamp(rough, 0, 1) * 0.25, t, 0.05);
      const sp = car.speed;
      this.road.g.gain.setTargetAtTime(clamp(sp / 40, 0, 1) * (interior ? 0.28 : 0.18) + (wet > 0.3 ? clamp(sp / 30, 0, 1) * wet * 0.15 : 0), t, 0.1);
      this.road.f.frequency.setTargetAtTime(wet > 0.3 ? 900 : 260, t, 0.2);
      this.wind.g.gain.setTargetAtTime(clamp((sp * sp) / 2500, 0, 1) * (interior ? 0.08 + windowOpen * 0.25 : 0.2), t, 0.1);
      this.scrape.g.gain.setTargetAtTime(clamp(car.scrape / 10, 0, 1) * 0.35, t, 0.03);
      const flat = car.phys.wheels.some((w) => w.flat > 0 && !w.detached);
      this.flap.g.gain.setTargetAtTime(flat ? clamp(sp / 15, 0, 1) * 0.3 : 0, t, 0.05);
      if (flat) this.flap.f.frequency.setTargetAtTime(60 + sp * 4, t, 0.1);
      if (bumps > 0.02 && (this.bumpCd || 0) <= 0) {
        this.tone(55, 0.14, { type: 'sine', gain: clamp(bumps * 6, 0.1, 0.6), slide: -20 });
        this.bumpCd = 0.12;
      }
      this.bumpCd = (this.bumpCd || 0) - dt;
      void tv;
      // horn
      const hornOn = inCar && car.sys.horn;
      this.updateHorn(this.horn, hornOn, dt);
      if (hornOn && !this.hornWasOn) game.traffic?.onPlayerHorn?.();
      this.hornWasOn = hornOn;
      // indicator relay
      const blink = car.sys.blinkOn;
      if ((car.sys.indicator !== 'none' || car.sys.hazard) && blink !== this.lastBlink) this.play(blink ? this.tick : this.tock, { gain: interior ? 0.35 : 0.1 });
      this.lastBlink = blink;
    }
    // rain & city ambience
    const env = game.env;
    this.rainL.g.gain.setTargetAtTime(env.rain * (interior ? 0.18 : 0.12), t, 0.3);
    this.rainL.f.frequency.setTargetAtTime(interior ? 600 : 1200, t, 0.3);
    this.city.g.gain.setTargetAtTime(0.05 + (1 - env.night) * 0.04, t, 0.5);
    // NPC voices: nearest cars
    this.assignTimer -= dt;
    if (this.assignTimer <= 0) {
      this.assignTimer = 0.4;
      const cp = cam.position;
      const cand = game.cars.filter((c) => c !== car && !c.removed && c.body.position.distanceToSquared(cp) < 90 * 90).sort((a, b) => a.body.position.distanceToSquared(cp) - b.body.position.distanceToSquared(cp));
      this.npcVoices.forEach((v, i) => (v.car = cand[i] || null));
      const cops = cand.filter((c) => c.police && c.sirenOn);
      const farCops = game.cars.filter((c) => c.police && c.sirenOn && !cops.includes(c));
      const allCops = [...cops, ...farCops];
      this.sirens.forEach((sv, i) => (sv.car = allCops[i] || null));
    }
    for (const v of this.npcVoices) v.update(t);
    for (const sv of this.sirens) sv.update(dt, t);
    this.radio?.update(dt, interior, inCar);
  }

  updateHorn(h, on, dt) {
    const t = this.ctx.currentTime;
    if (h.type === 'melody' && on) {
      // "La Cucaracha"-style jingle
      const seq = [392, 392, 392, 523, 659, 392, 392, 392, 523, 659];
      h.t += dt;
      const idx = Math.floor(h.t / 0.14) % seq.length;
      h.oscs[0].frequency.setTargetAtTime(seq[idx], t, 0.005);
    } else h.t = 0;
    h.g.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.012);
  }
}
