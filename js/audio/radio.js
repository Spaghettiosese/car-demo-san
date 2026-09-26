import { clamp } from '../core/util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/**
 * Car radio with procedurally composed stations. Notes are scheduled a little
 * ahead on the audio clock, so music keeps perfect time even at low frame rates.
 */
export class Radio {
  constructor(audio) {
    this.audio = audio;
    const ctx = (this.ctx = audio.ctx);
    this.on = true;
    this.index = 0;
    this.nextTime = 0;
    this.step = 0;
    this.bar = 0;
    this.songTimer = 0;
    this.song = '';
    this.talkTimer = 3;
    this.speaking = false;
    // output: station -> reverb send -> "car speaker" EQ -> volume
    this.bus = ctx.createGain();
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 70;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 9000;
    this.vol = ctx.createGain();
    this.vol.gain.value = 0;
    this.bus.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.vol);
    this.vol.connect(audio.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.4);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.28;
    this.verbSend.connect(this.verb);
    this.verb.connect(this.bus);
    this.stations = [
      { name: 'NIGHT DRIVE', freq: '101.5 FM', kind: 'synth', bpm: 100, songs: ['Neon Overdrive', 'Midnight Chrome', 'Sunset on 7th', 'Afterburner Hearts', 'Grid Runner', 'Vapor Lights'] },
      { name: 'LO-FI BEATS', freq: '88.2 FM', kind: 'lofi', bpm: 78, songs: ['rainy windshield', 'late bus home', 'coffee & traffic', 'parking lot dreams', 'slow lane'] },
      { name: 'SAN DEMO TALK', freq: '97.9 FM', kind: 'talk', bpm: 90, songs: ['News & traffic on the nines'] },
      { name: 'CLASSICS', freq: '105.1 FM', kind: 'classic', bpm: 70, songs: ['Waltz for a Crumple Zone', 'Nocturne in Gridlock', 'Sonata for Four Wheels'] },
    ];
    this.pickSong();
  }

  get station() {
    return this.stations[this.index];
  }

  impulse(secs) {
    const ctx = this.ctx;
    const len = Math.round(ctx.sampleRate * secs);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }

  pickSong() {
    this.song = pick(this.station.songs);
    this.songTimer = 90 + Math.random() * 60;
    this.seed = Math.floor(Math.random() * 1000);
  }

  next() {
    this.index = (this.index + 1) % this.stations.length;
    this.changed();
  }
  prev() {
    this.index = (this.index + this.stations.length - 1) % this.stations.length;
    this.changed();
  }
  toggle() {
    this.on = !this.on;
    if (!this.on) this.stopTalk();
    this.audio.game.hud.radio(this.on ? `📻 ${this.station.freq} · ${this.station.name}` : '📻 Radio off');
  }
  changed() {
    this.on = true;
    this.stopTalk();
    this.nextTime = 0;
    this.step = 0;
    this.pickSong();
    this.talkTimer = 1.5;
    // static burst when tuning
    this.audio.noiseBurst(0.25, { gain: 0.08, type: 'bandpass', freq: 2500, q: 0.5, dest: this.bus });
    this.audio.game.hud.radio(`📻 ${this.station.freq} · ${this.station.name} — ${this.song}`);
  }

  stationInfo() {
    if (!this.on) return { name: 'OFF', freq: '', song: '' };
    return { name: this.station.name, freq: this.station.freq, song: this.song };
  }

  stopTalk() {
    if (window.speechSynthesis && this.speaking) window.speechSynthesis.cancel();
    this.speaking = false;
  }

  update(dt, interior, inCar) {
    const game = this.audio.game;
    const car = game.player.car;
    const powered = this.on && car && (car.electrics || car.sys.ignition === 'acc') && game.state !== 'menu' && game.state !== 'garage';
    const t = this.ctx.currentTime;
    const target = powered ? game.settings.radioVolume * (inCar ? (interior ? 0.5 : 0.22) : 0.08) : 0;
    this.vol.gain.setTargetAtTime(target, t, 0.15);
    this.lp.frequency.setTargetAtTime(interior ? 9000 : 1600, t, 0.2);
    if (!powered) {
      this.nextTime = 0;
      this.stopTalk();
      return;
    }
    this.songTimer -= dt;
    if (this.songTimer <= 0) {
      this.pickSong();
      if (interior) game.hud.radio(`📻 ${this.station.name} — ${this.song}`);
    }
    const st = this.station;
    if (st.kind === 'talk') this.updateTalk(dt);
    const stepDur = 60 / st.bpm / 4;
    if (this.nextTime < t) this.nextTime = t + 0.05;
    while (this.nextTime < t + 0.2) {
      this.scheduleStep(st, this.step, this.nextTime, stepDur);
      let d = stepDur;
      if (st.kind === 'lofi') d = this.step % 2 === 0 ? stepDur * 1.24 : stepDur * 0.76; // swing
      this.nextTime += d;
      this.step++;
    }
  }

  // ------------------------------------------------------------ voices
  note(time, freq, dur, { type = 'sawtooth', gain = 0.1, attack = 0.005, release = 0.1, cutoff = 4000, q = 1, detune = 0, send = 0.2, env = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(cutoff, time);
    if (env) f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * env), time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + attack);
    g.gain.setValueAtTime(gain, time + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, time + dur + release);
    o.connect(f);
    f.connect(g);
    g.connect(this.bus);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.verbSend);
    }
    o.start(time);
    o.stop(time + dur + release + 0.05);
  }

  kick(time, gain = 0.5) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, time);
    o.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    o.connect(g);
    g.connect(this.bus);
    o.start(time);
    o.stop(time + 0.4);
  }

  noiseHit(time, dur, freq, type, gain, send = 0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.bus);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.verbSend);
    }
    src.start(time, Math.random() * 2);
    src.stop(time + dur + 0.05);
  }

  piano(time, freq, dur, gain = 0.08) {
    this.note(time, freq, dur, { type: 'triangle', gain, attack: 0.004, release: dur * 0.8, cutoff: 3500, env: 0.3, send: 0.35 });
    this.note(time, freq * 2, dur * 0.5, { type: 'sine', gain: gain * 0.3, attack: 0.004, release: dur * 0.4, cutoff: 6000, send: 0.2 });
  }

  // ------------------------------------------------------------ station patterns
  scheduleStep(st, step, time, sd) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    if (st.kind === 'synth') {
      const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
      const ch = prog[bar % 4];
      if (s16 % 4 === 0) this.kick(time, 0.45);
      if (s16 === 4 || s16 === 12) this.noiseHit(time, 0.25, 1800, 'bandpass', 0.25, 0.6);
      if (s16 % 2 === 0) this.noiseHit(time, 0.04, 8000, 'highpass', 0.05);
      if (s16 % 2 === 0) this.note(time, NOTE(ch[0] - 24), sd * 1.6, { type: 'sawtooth', gain: 0.08, cutoff: 900, env: 0.3, send: 0 });
      const arp = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2] + 12, ch[1] + 12, ch[2], ch[1]];
      this.note(time, NOTE(arp[s16 % 8] + 12), sd * 0.9, { type: 'square', gain: 0.025, cutoff: 2600, env: 0.4, send: 0.4 });
      if (s16 === 0) for (const n of ch) this.note(time, NOTE(n), sd * 16, { type: 'sawtooth', gain: 0.018, attack: 0.6, release: 0.8, cutoff: 1400, detune: (Math.random() - 0.5) * 16, send: 0.5 });
      // lead phrase every other 4 bars
      if (Math.floor(bar / 4) % 2 === 1 && s16 % 4 === 0 && Math.random() < 0.7) {
        const scale = [69, 72, 74, 76, 79, 81];
        this.note(time, NOTE(pick(scale)), sd * (Math.random() < 0.3 ? 8 : 4), { type: 'sawtooth', gain: 0.03, cutoff: 3000, attack: 0.02, release: 0.3, detune: 7, send: 0.6 });
      }
    } else if (st.kind === 'lofi') {
      const prog = [[62, 65, 69, 72, 76], [55, 59, 62, 65, 69], [60, 64, 67, 71, 74], [57, 60, 64, 67, 71]]; // Dm9 G13 Cmaj9 Am9
      const ch = prog[bar % 4];
      const kickPat = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
      if (kickPat[s16]) this.kick(time, 0.4);
      if (s16 === 4 || s16 === 12) this.noiseHit(time, 0.18, 1400, 'bandpass', 0.18, 0.3);
      if (s16 % 2 === 0) this.noiseHit(time, 0.03, 7000, 'highpass', 0.035);
      if (s16 === 0 || s16 === 10) for (const n of ch) this.note(time + Math.random() * 0.02, NOTE(n - 12), sd * 7, { type: 'sine', gain: 0.03, attack: 0.02, release: 0.6, cutoff: 1800, send: 0.3 });
      if (s16 === 0 || s16 === 8) this.note(time, NOTE(ch[0] - 24), sd * 6, { type: 'sine', gain: 0.12, cutoff: 500, send: 0 });
      if (Math.random() < 0.3) this.noiseHit(time, 0.01, 3000, 'highpass', 0.02); // vinyl crackle
      if (s16 % 4 === 2 && Math.random() < 0.35) this.note(time, NOTE(pick(ch) + 12), sd * 2, { type: 'triangle', gain: 0.02, cutoff: 2500, send: 0.5 });
    } else if (st.kind === 'classic') {
      const prog = [[62, 66, 69], [57, 61, 64], [59, 62, 66], [54, 57, 61], [55, 59, 62], [50, 54, 57], [55, 59, 62], [57, 61, 64]];
      const ch = prog[Math.floor(step / 12) % prog.length];
      const s12 = step % 12;
      if (s12 === 0) this.piano(time, NOTE(ch[0] - 12), sd * 10, 0.08);
      if (s12 === 4 || s12 === 8) for (const n of ch.slice(1)) this.piano(time, NOTE(n), sd * 3, 0.035);
      if (s12 % 2 === 1 && Math.random() < 0.6) this.piano(time, NOTE(pick(ch) + 12), sd * 2, 0.03);
    } else if (st.kind === 'talk') {
      // soft music bed under the talk
      if (s16 === 0 && bar % 2 === 0) for (const n of [60, 64, 67]) this.note(time, NOTE(n), sd * 30, { type: 'sine', gain: this.speaking ? 0.008 : 0.02, attack: 1, release: 1, cutoff: 1200, send: 0.5 });
    }
  }

  // ------------------------------------------------------------ talk radio
  updateTalk(dt) {
    this.talkTimer -= dt;
    if (this.talkTimer > 0 || this.speaking) return;
    this.talkTimer = 16 + Math.random() * 14;
    const line = this.newsLine();
    this.audio.game.hud.radio(`📻 “${line}”`);
    const synth = window.speechSynthesis;
    if (synth && this.audio.game.settings.newsVoice) {
      try {
        const u = new SpeechSynthesisUtterance(line);
        u.rate = 1.05;
        u.pitch = 0.95;
        u.volume = clamp(this.audio.game.settings.radioVolume * 1.2, 0, 1);
        this.speaking = true;
        u.onend = u.onerror = () => (this.speaking = false);
        synth.speak(u);
      } catch (e) {
        this.speaking = false;
      }
    }
  }

  newsLine() {
    const g = this.audio.game;
    const car = g.player.car;
    const h = g.env.hour;
    const time = `${Math.floor(h) % 12 || 12}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} ${h < 12 ? 'A M' : 'P M'}`;
    const street = g.hud.lastStreet || 'downtown';
    const color = colorName(car ? car.cfg.paint : '#888');
    const model = car ? car.model.prof.b.name : 'car';
    const heat = g.police ? g.police.heat : 0;
    const lines = [];
    if (heat >= 1) lines.push(`Breaking news: police are pursuing a ${color} ${model} near ${street}. Drivers, please pull over and let them through.`);
    if (heat >= 3) lines.push(`That pursuit is still going on ${street}. Our helicopter reports the suspect is driving like they've never heard of brakes.`);
    if (g.stats.crashes > 3) lines.push(`Traffic update: multiple collisions reported around ${street}. If you see a ${color} ${model}, maybe give it some room.`);
    const w = g.env.weather;
    lines.push(
      `It's ${time} here on San Demo Talk, ninety-seven point nine.`,
      w === 'rain' || w === 'storm' ? `Weather: wet roads all over town. Increase your following distance, and yes, that means you.` : w === 'fog' ? `Visibility is poor this morning with thick fog. Turn your headlights on.` : `Weather: ${w === 'cloudy' ? 'grey skies' : 'clear skies'} over San Demo. Great day for a drive.`,
      `This hour brought to you by San Demo Customs. We fix what you broke. Probably.`,
      `The Proving Grounds east of town are open all day. Jumps, a crash wall, and a drag strip. Your insurance is not invited.`,
      `Reminder from the San Demo Police: the speed limit in the city is fifty. It is not a suggestion.`,
      `Sports: the San Demo Pistons lost again last night. Coach says the team is, quote, rebuilding.`,
      `Traffic on Main Street is moving well. Watch for the lights at Central Avenue.`,
      `A listener asks: is it legal to honk at a pigeon? Legally, yes. Morally, we'll let you decide.`,
      `Fuel prices are steady at the Fuel Stop. Pull up to a pump and hold E to fill up.`,
    );
    return pick(lines);
  }
}

function colorName(hex) {
  const c = parseInt(hex.replace('#', ''), 16);
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 50) return 'black';
  if (min > 200) return 'white';
  if (max - min < 25) return max > 140 ? 'silver' : 'grey';
  if (r > g && r > b) return g > 120 ? (g > 180 ? 'yellow' : 'orange') : b > 120 ? 'pink' : 'red';
  if (g > r && g > b) return 'green';
  if (b > r && b > g) return r > 100 ? 'purple' : g > 150 ? 'teal' : 'blue';
  return 'colourful';
}
