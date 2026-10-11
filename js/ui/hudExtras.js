import * as THREE from 'three';
import { clamp, KMH, MPH } from '../core/util.js';

/**
 * HUD additions: speedometer styles, a speed-limit sign, turn-by-turn GPS with
 * spoken prompts, subtitles, a frame-time graph, a telemetry trace, the
 * damage report and the rear-view picture-in-picture.
 */

// speed limits on the out-of-town roads (km/h)
const ROAD_LIMITS = { coast: 90, canyon: 70, trail: 50 };
const _v = new THREE.Vector3();

export function installHudExtras(HUD) {
  const P = HUD.prototype;
  const analog = P.drawSpeedo;

  P.setupExtras = function () {
    const hud = document.getElementById('hud');
    const mk = (id, cls = '') => {
      let e = document.getElementById(id);
      if (!e) {
        e = document.createElement('div');
        e.id = id;
        if (cls) e.className = cls;
        hud.appendChild(e);
      }
      return e;
    };
    this.limitEl = mk('limit-sign', 'hidden');
    this.turnEl = mk('turn', 'hidden');
    this.subsEl = mk('subs');
    this.perfCv = document.createElement('canvas');
    this.perfCv.id = 'perf';
    this.perfCv.width = 180;
    this.perfCv.height = 60;
    hud.appendChild(this.perfCv);
    this.perfHist = new Float32Array(120);
    this.perfI = 0;
    this.trace = { thr: new Float32Array(160), brk: new Float32Array(160), steer: new Float32Array(160), i: 0 };
    this.subs = [];
    this.turnSaid = { idx: -1, far: false, near: false };
  };

  // ------------------------------------------------------------ speedometer styles
  P.drawSpeedo = function (car) {
    const style = this.game.settings.speedo || 'analog';
    if (style === 'analog') return analog.call(this, car);
    const ctx = this.speedo;
    const W = 250;
    ctx.clearRect(0, 0, W, W);
    // the analog dial shares this context: reset what it leaves behind
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';
    const units = this.game.settings.units;
    const speed = Math.abs(car.forwardSpeed) * (units === 'mph' ? MPH : KMH);
    const pt = car.phys.pt;
    const maxRpm = pt.ev ? pt.spec.maxRPM : pt.spec.redline * 1.15;
    const r = clamp(pt.rpm / maxRpm, 0, 1);
    const gear = pt.ev ? (pt.selector === 'R' ? 'R' : 'D') : pt.auto ? (pt.selector === 'D' ? `D${pt.gear}` : pt.selector) : pt.gear <= 0 ? (pt.gear === 0 ? 'N' : 'R') : String(pt.gear);
    const red = !pt.ev && pt.rpm > pt.spec.redline * 0.96;
    if (style === 'digital') {
      ctx.fillStyle = 'rgba(10,12,15,0.72)';
      roundRect(ctx, 20, 70, 210, 130, 18);
      ctx.fill();
      // segmented rev bar
      const segs = 24;
      for (let k = 0; k < segs; k++) {
        const on = k / segs < r;
        const hot = k / segs > (pt.ev ? 2 : pt.spec.redline / maxRpm);
        ctx.fillStyle = on ? (hot ? '#ff3b30' : k / segs > 0.7 ? '#ffcc00' : '#37c8ff') : 'rgba(255,255,255,0.08)';
        ctx.fillRect(32 + k * 7.9, 82, 6, 14);
      }
      ctx.fillStyle = '#fff';
      ctx.font = '800 64px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(speed)), 172, 165);
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillStyle = '#9aa3ad';
      ctx.fillText(units === 'mph' ? 'MPH' : 'KM/H', 172, 184);
      ctx.textAlign = 'center';
      ctx.font = '800 34px system-ui, sans-serif';
      ctx.fillStyle = red ? '#ff3b30' : '#ff6a1f';
      ctx.fillText(gear, 204, 160);
    } else {
      // minimal: just the number and a thin rev line
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 54px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      ctx.fillText(String(Math.round(speed)), 210, 190);
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(gear, 210, 140);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(90, 204, 120, 4);
      ctx.fillStyle = red ? '#ff3b30' : '#fff';
      ctx.fillRect(90, 204, 120 * r, 4);
    }
  };

  // ------------------------------------------------------------ per frame
  P.updateExtras = function (dt) {
    const g = this.game;
    const s = g.settings;
    const car = g.player.car;
    const inCar = !!car && g.player.mode === 'car';
    // frame-time graph
    this.perfHist[this.perfI++ % this.perfHist.length] = (g.frameMs || dt * 1000);
    this.perfCv.style.display = s.perfGraph ? 'block' : 'none';
    if (s.perfGraph && this.frame % 4 === 0) this.drawPerf();
    // speed-limit sign
    if (this.frame % 12 === 0) this.updateLimit(car, inCar && s.speedLimitSign && g.cam.mode !== 'free' && (!g.cam.interior || s.hudInCockpit));
    // turn-by-turn
    if (this.frame % 6 === 0) this.updateTurn(inCar);
    // subtitles
    for (let i = this.subs.length - 1; i >= 0; i--) if ((this.subs[i].t -= dt) <= 0) this.subs.splice(i, 1);
    const html = s.subtitles ? this.subs.map((x) => `<div><b>${x.who}</b> ${x.text}</div>`).join('') : '';
    if (html !== this.subsHtml) {
      this.subsEl.innerHTML = html;
      this.subsHtml = html;
    }
  };

  P.subtitle = function (who, text, time = 3.5) {
    if (!this.game.settings.subtitles) return;
    if (this.subs.length && this.subs[this.subs.length - 1].text === text) return;
    this.subs.push({ who, text, t: time });
    if (this.subs.length > 3) this.subs.shift();
  };

  P.drawPerf = function () {
    const c = this.perfCv.getContext('2d');
    const W = 180, H = 60, n = this.perfHist.length;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(10,12,15,0.7)';
    c.fillRect(0, 0, W, H);
    // 16.7 ms and 33 ms guides
    c.strokeStyle = 'rgba(255,255,255,0.15)';
    for (const ms of [16.7, 33.3]) {
      const y = H - (ms / 50) * H;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
    }
    let sum = 0, max = 0;
    for (let k = 0; k < n; k++) {
      const v = this.perfHist[(this.perfI + k) % n];
      sum += v;
      max = Math.max(max, v);
      const h = clamp(v / 50, 0, 1) * H;
      c.fillStyle = v > 33 ? '#ff3b30' : v > 17.5 ? '#ffcc00' : '#4cd964';
      c.fillRect((k / n) * W, H - h, W / n + 0.5, h);
    }
    c.fillStyle = '#fff';
    c.font = '700 11px monospace';
    c.fillText(`${(sum / n).toFixed(1)}ms avg ${Math.min(999, max).toFixed(0)} max`, 4, 12);
    const ph = this.game.physics?.stats;
    if (ph) c.fillText(`phys ${ph.ms.toFixed(1)}ms res ${Math.round((this.game.dynScale || 1) * 100)}%`, 4, 25);
  };

  P.updateLimit = function (car, show) {
    const el = this.limitEl;
    if (!show) {
      el.classList.add('hidden');
      return;
    }
    const g = this.game;
    const p = car.body.position;
    let limit = null;
    const nl = g.city.nearestLane(p, car.body.axis(2, _v));
    if (nl && Math.abs(nl.lateral) < 9) limit = Math.round(nl.seg.limit * 3.6);
    else if (g.terrain) {
      const r = g.terrain.nearestRoad?.(p.x, p.z);
      if (r && Math.abs(r.side) < r.road.hw + 2 && r.dist < 14) limit = ROAD_LIMITS[r.road.id] || 80;
    }
    if (!limit) {
      el.classList.add('hidden');
      return;
    }
    const mph = g.settings.units === 'mph';
    const shown = mph ? Math.round(limit / 1.609 / 5) * 5 : limit;
    const over = car.speed * 3.6 > limit + 8;
    el.classList.remove('hidden');
    el.classList.toggle('over', over);
    if (el.textContent !== String(shown)) el.textContent = shown;
  };

  // ------------------------------------------------------------ turn by turn
  P.updateTurn = function (inCar) {
    const g = this.game;
    const el = this.turnEl;
    const route = g.gps && g.gps.route;
    if (!route || route.length < 2 || !inCar) {
      el.classList.add('hidden');
      this.turnSaid.idx = -1;
      g.gpsNav = null;
      return;
    }
    const p = g.player.focus;
    // nearest route point, then the first real bend after it
    let ni = 0, nd = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = (route[i].x - p.x) ** 2 + (route[i].z - p.z) ** 2;
      if (d < nd) {
        nd = d;
        ni = i;
      }
    }
    let turn = null, dist = Math.sqrt(nd);
    for (let i = Math.max(1, ni + 1); i < route.length - 1; i++) {
      const a = route[i - 1], b = route[i], c = route[i + 1];
      dist += Math.hypot(b.x - a.x, b.z - a.z);
      const a1 = Math.atan2(b.x - a.x, b.z - a.z), a2 = Math.atan2(c.x - b.x, c.z - b.z);
      let da = a2 - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > 0.6) {
        turn = { i, dir: da > 0 ? 'left' : 'right', at: b, sharp: Math.abs(da) > 2.2 };
        break;
      }
    }
    const end = route[route.length - 1];
    const units = g.settings.units === 'mph';
    const fmt = (m) => (units ? (m > 300 ? `${(m / 1609).toFixed(1)} mi` : `${Math.round(m * 1.094 / 10) * 10} yd`) : m > 950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
    let icon, text;
    if (!turn) {
      const d = Math.hypot(end.x - p.x, end.z - p.z);
      icon = '🏁';
      text = `${fmt(d)} · destination`;
      g.gpsNav = { turn: 0, dist: fmt(d), street: 'Destination' };
      if (d < 120 && this.turnSaid.idx !== 'end') {
        this.turnSaid.idx = 'end';
        this.speakGps('Your destination is ahead.');
      }
    } else {
      // the turn is at the bend point, so the sign shows "left" in the driver's frame
      const street = g.city.streetName(_v.set(turn.at.x + (route[turn.i + 1].x - turn.at.x) * 0.5, 0, turn.at.z + (route[turn.i + 1].z - turn.at.z) * 0.5));
      icon = turn.sharp ? '↶' : turn.dir === 'left' ? '↰' : '↱';
      text = turn.sharp ? `${fmt(dist)} · make a U-turn` : `${fmt(dist)} · ${turn.dir} onto <b>${street}</b>`;
      // the dash-mounted phone shows the same instruction (its arrow points up for straight on)
      g.gpsNav = { turn: turn.sharp ? Math.PI : turn.dir === 'left' ? -Math.PI / 2 : Math.PI / 2, dist: fmt(dist), street: turn.sharp ? 'U-turn' : street };
      if (this.turnSaid.idx !== turn.i) this.turnSaid = { idx: turn.i, far: false, near: false };
      if (!this.turnSaid.far && dist < 220 && dist > 90) {
        this.turnSaid.far = true;
        this.speakGps(turn.sharp ? 'When possible, make a U-turn.' : `In ${units ? `${Math.round(dist * 1.094 / 50) * 50} yards` : `${Math.round(dist / 50) * 50} metres`}, turn ${turn.dir} onto ${street}.`);
      }
      if (!this.turnSaid.near && dist < 45) {
        this.turnSaid.near = true;
        this.speakGps(turn.sharp ? 'Make a U-turn.' : `Turn ${turn.dir}.`);
      }
    }
    el.classList.remove('hidden');
    const html = `<i>${icon}</i><span>${text}</span>`;
    if (html !== this.turnHtml) {
      el.innerHTML = html;
      this.turnHtml = html;
    }
  };

  P.speakGps = function (text) {
    this.game.audio?.say?.(text);
    this.subtitle('🧭 GPS', text, 3);
  };

  // ------------------------------------------------------------ telemetry trace
  P.drawTrace = function (car) {
    const t = this.trace;
    const inp = car.phys.input;
    const n = t.thr.length;
    t.thr[t.i % n] = inp.throttle;
    t.brk[t.i % n] = inp.brake;
    t.steer[t.i % n] = inp.steer;
    t.i++;
    let cv = this.traceCv;
    if (!cv) {
      cv = this.traceCv = document.createElement('canvas');
      cv.width = 320;
      cv.height = 80;
      cv.style.cssText = 'display:block;margin-top:6px;border-radius:6px';
    }
    if (cv.parentNode !== this.telemetryEl) this.telemetryEl.appendChild(cv);
    const c = cv.getContext('2d');
    const W = 320, H = 80;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, 0, W, H);
    const line = (arr, col, mid) => {
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      c.beginPath();
      for (let k = 0; k < n; k++) {
        const v = arr[(t.i + k) % n];
        const y = mid ? H / 2 - v * (H / 2 - 4) : H - 4 - v * (H - 8);
        if (k) c.lineTo((k / (n - 1)) * W, y);
        else c.moveTo(0, y);
      }
      c.stroke();
    };
    line(t.thr, '#4cd964');
    line(t.brk, '#ff3b30');
    line(t.steer, '#37c8ff', true);
    c.fillStyle = '#ddd';
    c.font = '10px monospace';
    c.fillText('throttle', 4, 11);
    c.fillStyle = '#ff8a80';
    c.fillText('brake', 64, 11);
    c.fillStyle = '#7fdcff';
    c.fillText('steer', 106, 11);
  };

  // ------------------------------------------------------------ damage report
  P.damageReport = function (car) {
    const d = car.damageSummary();
    const pt = car.phys.pt;
    const pc = (x) => `${Math.round(clamp(x, 0, 1) * 100)}%`;
    const bar = (x, label) => {
      const v = clamp(x, 0, 1);
      const col = this.game.settings.colorBlind ? (v > 0.6 ? '#e69f00' : v > 0.25 ? '#f0e442' : '#56b4e9') : v > 0.6 ? '#ff3b30' : v > 0.25 ? '#ffcc00' : '#4cd964';
      return `<div class="dr"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%;background:${col}"></b></i><em>${pc(v)}</em></div>`;
    };
    // front to rear, with readable names
    const ORDER = ['bumperF', 'hood', 'fenderFL', 'fenderFR', 'doorFL', 'doorFR', 'doorRL', 'doorRR', 'body', 'trunk', 'spoiler', 'bumperR'];
    const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : 50);
    const parts = car.model.allParts.filter((p) => !car.model.glassParts[p.name] && p.name !== 'under').sort((a, b) => rank(a.name) - rank(b.name));
    const pname = (n) => ({ body: 'Body shell', hood: 'Hood', trunk: 'Trunk', bumperF: 'Front bumper', bumperR: 'Rear bumper', doorFL: 'Door, front left', doorFR: 'Door, front right', doorRL: 'Door, rear left', doorRR: 'Door, rear right', fenderFL: 'Fender, front left', fenderFR: 'Fender, front right', mirrorL: 'Mirror L', mirrorR: 'Mirror R', spoiler: 'Spoiler' }[n] || n[0].toUpperCase() + n.slice(1));
    const wheels = car.phys.wheels.map((w) => `${w.id}: ${w.detached ? '<b class="bad">OFF</b>' : `${w.flat ? '<b class="bad">flat</b> · ' : ''}bend ${(w.bend * 100).toFixed(0)}% · toe ${(w.toe * 57.3).toFixed(1)}° · wear ${Math.round((w.wear || 0) * 100)}% · ${Math.round(w.temp || 0)}°C`}`).join('<br>');
    const fluids = [];
    if (car.fuelLeak > 0.05) fluids.push('fuel leak');
    if ((pt.oilLeak || 0) > 0.001) fluids.push('oil leak');
    if ((pt.coolantLeak || 0) > 0.001 || pt.radiator < 0.6) fluids.push('coolant leak');
    if (pt.brokenGears?.size) fluids.push(`gearbox: lost ${[...pt.brokenGears].sort().map((g) => `${g}${['', 'st', 'nd', 'rd'][g] || 'th'}`).join(', ')}`);
    return `<div class="dmg-report">
      ${bar(d.body, 'Body')}${bar(d.engine, 'Engine')}${bar(1 - (pt.oil ?? 1), 'Oil level loss')}${bar(clamp((pt.temp - 90) / 50, 0, 1), 'Overheating')}
      ${bar(d.glass.reduce((a, b) => a + b, 0) / Math.max(1, d.glass.length), 'Glass')}
      <div class="sub">Panels</div>${parts.map((p) => bar(p.state === 'detached' ? 1 : 1 - clamp(p.health, 0, 1), pname(p.name) + (p.state === 'detached' ? ' (gone)' : p.state === 'loose' ? ' (loose)' : ''))).join('')}
      <div class="sub">Wheels & suspension</div><div class="wl">${wheels}</div>
      ${car.phys.rackDamage ? `<div class="sub">Steering rack offset ${(car.phys.rackOffset * 57.3).toFixed(1)}°</div>` : ''}
      ${fluids.length ? `<div class="sub bad">⚠ ${fluids.join(' · ')}</div>` : ''}
    </div>`;
  };

  // ------------------------------------------------------------ rear-view picture-in-picture
  P.renderPip = function (renderer) {
    const g = this.game;
    const car = g.player.car;
    const mode = g.cam.mode;
    if (!g.settings.rearPip || !car || g.player.mode !== 'car' || g.cam.interior || mode === 'free' || g.state !== 'play') return;
    if (!this.pipCam) this.pipCam = new THREE.PerspectiveCamera(48, 3, 0.3, 400);
    const cam = this.pipCam;
    car.body.toWorldPoint(_v.set(0, car.boundsMax.y + 0.2, car.boundsMin.z - 0.3), cam.position);
    cam.quaternion.copy(car.body.quaternion);
    cam.rotateY(Math.PI);
    cam.rotateX(-0.08);
    cam.updateMatrixWorld();
    const el = renderer.domElement;
    const W = el.clientWidth, H = el.clientHeight;
    const w = Math.round(Math.min(380, W * 0.3)), h = Math.round(w / 3);
    const x = Math.round((W - w) / 2), y = H - h - 14;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const sky = g.env.sky;
    sky.position.copy(cam.position);
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.render(g.scene, cam);
    renderer.shadowMap.autoUpdate = auto;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    sky.position.copy(g.camera.position);
    let frame = document.getElementById('pip-frame');
    if (!frame) {
      frame = document.createElement('div');
      frame.id = 'pip-frame';
      frame.innerHTML = '<span>REAR</span>';
      document.getElementById('hud').appendChild(frame);
    }
    // the frame lives in the (zoomed) HUD; the picture is in raw screen pixels
    const z = this.game.settings.hudScale || 1;
    frame.style.cssText = `left:${x / z}px;top:${14 / z}px;width:${w / z}px;height:${h / z}px;display:block`;
    this.pipShown = true;
    document.body.classList.add('pip');
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
