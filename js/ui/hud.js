import * as THREE from 'three';
import { clamp, KMH, MPH } from '../core/util.js';
import { CITY, roadCoord, CITY_HALF, PG } from '../world/city.js';
import { CAMERA_NAMES } from '../camera.js';

const $ = (id) => document.getElementById(id);

/** DOM/canvas HUD: speedometer, minimap, damage, location, messages, telemetry. */
export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.speedo = $('speedo').getContext('2d');
    this.mini = $('minimap').getContext('2d');
    this.dmg = $('damage-canvas').getContext('2d');
    this.toastsEl = $('toasts');
    this.promptEl = $('prompt');
    this.hoverEl = $('hover-label');
    this.crossEl = $('crosshair');
    this.bigEl = $('bigmsg');
    this.telemetryEl = $('telemetry');
    this.radioEl = $('radio-display');
    this.camEl = $('cam-name');
    this.wantedEl = $('wanted');
    this.wantedBar = $('wanted-bar');
    this.timerEl = $('timer-box');
    this.ttEl = $('tell-tales');
    this.streetEl = $('loc-street');
    this.subEl = $('loc-sub');
    this.hurtEl = $('hurt');
    this.speechLayer = $('speech-layer');
    this.bigTimer = 0;
    this.radioTimer = 0;
    this.camTimer = 0;
    this.lastStreet = '';
    this.frame = 0;
    this.telemetry = false;
    this.mapCache = null;
    this.speech = [];
    this.tt = {};
    for (const [k, label, cls] of [['ind', '◀ ▶', 'g'], ['high', 'HIGH', 'b'], ['lights', 'LIGHTS', 'g'], ['abs', 'ABS', 'y'], ['tcs', 'TCS', 'y'], ['hand', 'P-BRAKE', 'r'], ['engine', 'ENGINE', 'r'], ['temp', 'TEMP', 'r'], ['fuel', 'FUEL', 'y'], ['belt', 'BELT', 'r']]) {
      const d = document.createElement('div');
      d.className = 'tt ' + cls;
      d.textContent = label;
      this.ttEl.appendChild(d);
      this.tt[k] = d;
    }
    this.buildMapCache();
  }

  show(v) {
    this.el.classList.toggle('hidden', !v);
  }

  // ------------------------------------------------------------ messages
  toast(text, kind = 'info', time = 3.2) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.innerHTML = text;
    this.toastsEl.appendChild(d);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => {
      d.style.transition = 'opacity 0.4s';
      d.style.opacity = '0';
      setTimeout(() => d.remove(), 450);
    }, time * 1000);
  }
  big(text, small = '', time = 3) {
    this.bigEl.querySelector('.big').textContent = text;
    this.bigEl.querySelector('.small').innerHTML = small;
    this.bigEl.classList.add('show');
    this.bigTimer = time;
  }
  prompt(html) {
    if (!html) {
      this.promptEl.style.display = 'none';
      return;
    }
    this.promptEl.innerHTML = html;
    this.promptEl.style.display = 'block';
  }
  hover(html) {
    if (!html) {
      this.hoverEl.style.display = 'none';
      this.crossEl.classList.remove('active');
      return;
    }
    this.hoverEl.innerHTML = html;
    this.hoverEl.style.display = 'block';
    this.crossEl.classList.add('active');
  }
  crosshair(v) {
    this.crossEl.style.display = v ? 'block' : 'none';
  }
  radio(text) {
    this.radioEl.textContent = text;
    this.radioEl.classList.add('show');
    this.radioTimer = 3;
  }
  camName(mode) {
    this.camEl.textContent = '📷 ' + (CAMERA_NAMES[mode] || mode);
    this.camEl.classList.add('show');
    this.camTimer = 1.8;
  }
  hurt(a) {
    this.hurtEl.style.opacity = String(clamp(a, 0, 1));
  }
  /** Floating speech bubble over a world position. */
  say(obj, text, kind = '', time = 2.5) {
    const d = document.createElement('div');
    d.className = 'speech ' + kind;
    d.textContent = text;
    this.speechLayer.appendChild(d);
    this.speech.push({ obj, el: d, t: time });
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    this.frame++;
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) this.bigEl.classList.remove('show');
    }
    if (this.radioTimer > 0 && (this.radioTimer -= dt) <= 0) this.radioEl.classList.remove('show');
    if (this.camTimer > 0 && (this.camTimer -= dt) <= 0) this.camEl.classList.remove('show');
    this.updateSpeech(dt);
    const car = g.player.car;
    const focus = g.player.focus;
    // location
    if (this.frame % 15 === 0) {
      const name = g.city.streetName(focus);
      if (name !== this.lastStreet) {
        this.streetEl.textContent = name;
        this.lastStreet = name;
      }
      const h = g.env.hour;
      const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      const w = { clear: '☀ Clear', cloudy: '☁ Cloudy', rain: '🌧 Rain', storm: '⛈ Storm', fog: '🌫 Fog' }[g.env.weather];
      this.subEl.textContent = `San Demo · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${w}`;
    }
    const inCar = !!car && g.player.mode === 'car';
    const cockpit = g.cam.mode === 'cockpit';
    const showGauges = inCar && (!cockpit || g.settings.hudInCockpit);
    $('hud-br').style.display = showGauges ? 'block' : 'none';
    this.ttEl.style.display = showGauges ? 'flex' : 'none';
    if (showGauges) this.drawSpeedo(car);
    if (inCar) this.updateTellTales(car);
    if (this.frame % 2 === 0) this.drawMinimap(focus, g.player.heading);
    if (inCar && this.frame % 10 === 0) this.drawDamage(car);
    $('damage-canvas').style.display = inCar ? 'block' : 'none';
    if (this.telemetry && inCar && this.frame % 3 === 0) this.drawTelemetry(car);
  }

  updateSpeech(dt) {
    const cam = this.game.camera;
    const v = new THREE.Vector3();
    const w = innerWidth, h = innerHeight;
    for (let i = this.speech.length - 1; i >= 0; i--) {
      const s = this.speech[i];
      s.t -= dt;
      if (s.t <= 0 || !s.obj) {
        s.el.remove();
        this.speech.splice(i, 1);
        continue;
      }
      v.copy(s.obj.position || s.obj);
      v.y += 2.2;
      const d = v.distanceTo(cam.position);
      v.project(cam);
      if (v.z > 1 || d > 70) {
        s.el.style.display = 'none';
        continue;
      }
      s.el.style.display = 'block';
      s.el.style.left = ((v.x + 1) / 2) * w + 'px';
      s.el.style.top = ((1 - v.y) / 2) * h + 'px';
      s.el.style.opacity = String(Math.min(1, s.t * 2));
    }
  }

  updateTellTales(car) {
    const s = car.sys;
    const pt = car.phys.pt;
    const set = (k, on) => this.tt[k].classList.toggle('on', !!on);
    set('ind', s.blinkOn);
    set('high', s.high && s.headlights === 2);
    set('lights', s.headlights > 0);
    set('abs', car.phys.absActive || !car.tuning.assists.abs);
    set('tcs', car.phys.tcsActive);
    set('hand', car.phys.input.handbrake > 0 || car.phys.parkBrake);
    set('engine', pt.health < 0.5 || (car.electrics && !pt.running));
    set('temp', pt.temp > 112);
    set('fuel', pt.fuel < 6);
    set('belt', !s.seatbelt && car.speed > 3);
  }

  // ------------------------------------------------------------ speedometer
  drawSpeedo(car) {
    const ctx = this.speedo;
    const W = 250, cx = 125, cy = 125;
    ctx.clearRect(0, 0, W, W);
    const units = this.game.settings.units;
    const speed = Math.abs(car.forwardSpeed) * (units === 'mph' ? MPH : KMH);
    const pt = car.phys.pt;
    const maxRpm = pt.ev ? pt.spec.maxRPM : pt.spec.redline * 1.15;
    const rpm = pt.rpm;
    // outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, 112, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,12,15,0.72)';
    ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // rpm arc
    ctx.lineWidth = 10;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, 100, a0, a1);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();
    const f = clamp(rpm / maxRpm, 0, 1);
    const red = pt.ev ? 1 : pt.spec.redline / maxRpm;
    ctx.beginPath();
    ctx.arc(cx, cy, 100, a0, a0 + (a1 - a0) * Math.min(f, red));
    ctx.strokeStyle = pt.limiterTimer > 0 ? '#ff4a4a' : '#ff6a1f';
    ctx.stroke();
    if (f > red) {
      ctx.beginPath();
      ctx.arc(cx, cy, 100, a0 + (a1 - a0) * red, a0 + (a1 - a0) * f);
      ctx.strokeStyle = '#ff2a2a';
      ctx.stroke();
    }
    // redline marker
    if (!pt.ev) {
      ctx.beginPath();
      ctx.arc(cx, cy, 108, a0 + (a1 - a0) * red, a1);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ff3030';
      ctx.stroke();
    }
    // ticks
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const step = pt.ev ? 2000 : 1000;
    for (let r = 0; r <= maxRpm; r += step) {
      const a = a0 + (a1 - a0) * (r / maxRpm);
      ctx.fillText(String(r / 1000), cx + Math.cos(a) * 82, cy + Math.sin(a) * 82);
    }
    // speed
    ctx.fillStyle = '#eef1f5';
    ctx.font = '800 58px sans-serif';
    ctx.fillText(String(Math.round(speed)), cx, cy - 4);
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = '#9aa3ad';
    ctx.fillText(units === 'mph' ? 'MPH' : 'KM/H', cx, cy + 30);
    // gear
    let gear;
    if (pt.auto) gear = pt.selector === 'D' ? (pt.ev ? 'D' : 'D' + pt.gear) : pt.selector;
    else gear = pt.gear < 0 ? 'R' : pt.gear === 0 ? 'N' : String(pt.gear);
    ctx.font = '800 26px sans-serif';
    ctx.fillStyle = pt.shiftTimer > 0 ? '#ff6a1f' : '#eef1f5';
    ctx.fillText(gear, cx, cy + 62);
    // boost gauge
    if (pt.spec.turbo) {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, 118, Math.PI * 0.35, Math.PI * 0.65);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 118, Math.PI * 0.65, Math.PI * 0.65 - Math.PI * 0.3 * pt.boost, true);
      ctx.strokeStyle = '#37c8ff';
      ctx.stroke();
    }
    // fuel & temp bars
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(cx - 60, cy + 84, 50, 4);
    ctx.fillRect(cx + 10, cy + 84, 50, 4);
    ctx.fillStyle = pt.fuel < 6 ? '#ff4a4a' : '#9ad06a';
    ctx.fillRect(cx - 60, cy + 84, 50 * clamp(pt.fuel / 55, 0, 1), 4);
    ctx.fillStyle = pt.temp > 112 ? '#ff4a4a' : '#37c8ff';
    ctx.fillRect(cx + 10, cy + 84, 50 * clamp((pt.temp - 40) / 90, 0, 1), 4);
    ctx.font = '600 9px sans-serif';
    ctx.fillStyle = '#9aa3ad';
    ctx.fillText(pt.ev ? 'BATT' : 'FUEL', cx - 35, cy + 96);
    ctx.fillText('TEMP', cx + 35, cy + 96);
    if (!pt.running) {
      ctx.fillStyle = pt.cranking ? '#ffc233' : '#ff6a1f';
      ctx.font = '700 11px sans-serif';
      ctx.fillText(pt.cranking ? 'CRANKING…' : 'ENGINE OFF', cx, cy - 46);
    }
  }

  // ------------------------------------------------------------ minimap
  buildMapCache() {
    // static map image covering the whole playable area
    const S = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const ext = { x0: -CITY_HALF - 60, x1: PG.x1 + 20, z0: -CITY_HALF - 200, z1: CITY_HALF + 200 };
    const size = Math.max(ext.x1 - ext.x0, ext.z1 - ext.z0);
    ext.x1 = ext.x0 + size;
    ext.z1 = ext.z0 + size;
    const sc = S / size;
    this.mapExt = ext;
    this.mapScale = sc;
    const X = (x) => (x - ext.x0) * sc, Z = (z) => (z - ext.z0) * sc;
    ctx.fillStyle = '#1d2a1c';
    ctx.fillRect(0, 0, S, S);
    const city = this.game.city;
    // blocks
    for (const b of city.blocks) {
      ctx.fillStyle = { park: '#2f5a2a', downtown: '#3a3f48', midtown: '#353941', residential: '#33363b', gas: '#4a3a2a', garage: '#5a3a1a', police: '#23324f', parking: '#2c2f33', construction: '#4d4231', plaza: '#454545' }[b.type] || '#333';
      ctx.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    }
    // buildings
    ctx.fillStyle = 'rgba(120,130,145,0.55)';
    for (const bx of city.world.boxes) {
      if (bx.kind !== 'building') continue;
      ctx.fillRect(X(bx.min.x), Z(bx.min.z), (bx.max.x - bx.min.x) * sc, (bx.max.z - bx.min.z) * sc);
    }
    // roads
    ctx.fillStyle = '#6b7079';
    for (let k = 0; k < CITY.N; k++) {
      const c0 = roadCoord(k);
      ctx.fillRect(X(-CITY_HALF), Z(c0 - CITY.RW / 2), CITY_HALF * 2 * sc, CITY.RW * sc);
      ctx.fillRect(X(c0 - CITY.RW / 2), Z(-CITY_HALF), CITY.RW * sc, CITY_HALF * 2 * sc);
    }
    // proving grounds
    ctx.fillStyle = '#4a4e55';
    ctx.fillRect(X(PG.x0 - 12), Z(PG.z0), (PG.x1 - PG.x0 + 12) * sc, (PG.z1 - PG.z0) * sc);
    ctx.fillStyle = '#7f858f';
    for (const r of city.world.ramps) ctx.fillRect(X(r.cx) - 3, Z(r.cz) - 3, 6, 6);
    // labels
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    for (const b of city.blocks) if (b.label) ctx.fillText(b.label, X((b.x0 + b.x1) / 2), Z((b.z0 + b.z1) / 2));
    ctx.fillText('PROVING GROUNDS', X((PG.x0 + PG.x1) / 2), Z(PG.z0 + 30));
    this.mapCache = c;
  }

  worldToMap(x, z) {
    return [(x - this.mapExt.x0) * this.mapScale, (z - this.mapExt.z0) * this.mapScale];
  }

  drawMinimap(pos, heading) {
    const ctx = this.mini;
    const S = 200;
    const g = this.game;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#12161a';
    ctx.fillRect(0, 0, S, S);
    const speed = g.player.car ? g.player.car.speed : 0;
    const zoom = clamp(1.6 - speed * 0.012, 0.9, 1.6); // map px per metre (screen)
    ctx.translate(S / 2, S / 2);
    // rotate so heading points up. Heading yaw 0 = +z; on the map +z is down.
    ctx.rotate(Math.PI + heading);
    const [mx, mz] = this.worldToMap(pos.x, pos.z);
    const k = zoom / this.mapScale;
    ctx.scale(k, k);
    ctx.drawImage(this.mapCache, -mx, -mz);
    ctx.scale(1 / k, 1 / k);
    // dynamic markers
    const dot = (x, z, color, r = 3.5) => {
      const dx = (x - pos.x) * zoom, dz = (z - pos.z) * zoom;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(dx, dz, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const t = performance.now() / 1000;
    for (const c of g.cars) {
      if (c === g.player.car || c.removed) continue;
      if (Math.abs(c.body.position.x - pos.x) > 160 || Math.abs(c.body.position.z - pos.z) > 160) continue;
      if (c.police) dot(c.body.position.x, c.body.position.z, c.sirenOn ? (Math.floor(t * 4) % 2 ? '#ff3b3b' : '#3b7bff') : '#7aa8ff', 4.5);
      else if (c.controller && c.controller.rage) dot(c.body.position.x, c.body.position.z, '#ff8a2a', 4);
      else dot(c.body.position.x, c.body.position.z, 'rgba(220,220,220,0.7)', 2.5);
    }
    // waypoint + route
    if (g.gps && g.gps.route) {
      ctx.strokeStyle = 'rgba(80,190,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      g.gps.route.forEach((p, i) => {
        const dx = (p.x - pos.x) * zoom, dz = (p.z - pos.z) * zoom;
        if (i === 0) ctx.moveTo(dx, dz);
        else ctx.lineTo(dx, dz);
      });
      ctx.stroke();
      const w = g.gps.target;
      dot(w.x, w.z, '#50beff', 6);
    }
    ctx.restore();
    // player arrow
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = '#ff6a1f';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // north marker
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.PI + heading);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -S / 2 + 12);
    ctx.restore();
  }

  drawFullMap(canvas, playerPos, heading) {
    const ctx = canvas.getContext('2d');
    const S = canvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapCache, 0, 0, S, S);
    const toC = (x, z) => {
      const [mx, mz] = this.worldToMap(x, z);
      return [(mx / this.mapCache.width) * S, (mz / this.mapCache.height) * S];
    };
    const g = this.game;
    if (g.gps && g.gps.route) {
      ctx.strokeStyle = 'rgba(80,190,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      g.gps.route.forEach((p, i) => {
        const [x, y] = toC(p.x, p.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    for (const c of g.cars) {
      if (c.removed || c === g.player.car) continue;
      const [x, y] = toC(c.body.position.x, c.body.position.z);
      ctx.fillStyle = c.police ? '#5b8cff' : 'rgba(230,230,230,0.6)';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    const [px, py] = toC(playerPos.x, playerPos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading);
    ctx.fillStyle = '#ff6a1f';
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(7, -7);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    this.fullMapToWorld = (cxp, cyp) => {
      const mx = (cxp / S) * this.mapCache.width, my = (cyp / S) * this.mapCache.height;
      return new THREE.Vector3(mx / this.mapScale + this.mapExt.x0, 0, my / this.mapScale + this.mapExt.z0);
    };
  }

  // ------------------------------------------------------------ damage view
  drawDamage(car) {
    const ctx = this.dmg;
    ctx.clearRect(0, 0, 84, 150);
    const d = car.damageSummary();
    const col = (v) => {
      const r = Math.round(80 + 175 * clamp(v * 1.6, 0, 1));
      const gr = Math.round(210 - 170 * clamp(v * 1.3, 0, 1));
      return `rgb(${r},${gr},70)`;
    };
    ctx.fillStyle = 'rgba(10,12,15,0.7)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, 84, 150, 10) : ctx.rect(0, 0, 84, 150);
    ctx.fill();
    // body outline
    ctx.fillStyle = col(d.body);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(22, 16, 40, 112, 12) : ctx.rect(22, 16, 40, 112);
    ctx.fill();
    // glass
    ctx.fillStyle = 'rgba(20,30,40,0.8)';
    ctx.fillRect(27, 42, 30, 14);
    ctx.fillRect(27, 92, 30, 10);
    // wheels FL FR RL RR (front at top); left side of car on the right of the icon? keep driver's view: left = left
    const pos = [[12, 30], [62, 30], [12, 100], [62, 100]];
    d.wheels.forEach((v, i) => {
      ctx.fillStyle = v >= 1 ? '#111' : col(v);
      ctx.fillRect(pos[i][0], pos[i][1], 10, 20);
      if (v >= 1) {
        ctx.strokeStyle = '#ff4a4a';
        ctx.strokeRect(pos[i][0], pos[i][1], 10, 20);
      }
    });
    // engine
    ctx.fillStyle = col(d.engine);
    ctx.fillRect(34, 20, 16, 14);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '600 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DAMAGE', 42, 142);
  }

  drawTelemetry(car) {
    const el = this.telemetryEl;
    const p = car.phys;
    const pt = p.pt;
    const g = car.gforce;
    const w = p.wheels;
    const f = (v, n = 0) => v.toFixed(n).padStart(6);
    let html = `<b>TELEMETRY</b> (F3)\n`;
    html += `speed ${f(car.speed * 3.6)} km/h   rpm ${f(pt.rpm)}\n`;
    html += `gear  ${f(pt.gear)}   clutch ${f(pt.clutch, 2)}  boost ${f(pt.boost, 2)}\n`;
    html += `thr ${f(p.input.throttle, 2)} brk ${f(p.input.brake, 2)} steer ${f(p.input.steer, 2)}\n`;
    html += `g lat ${f(-g.x / 9.81, 2)}  long ${f(g.z / 9.81, 2)}  vert ${f(g.y / 9.81, 2)}\n`;
    html += `engine ${f(pt.health * 100)}%  temp ${f(pt.temp)}°C  fuel ${f(pt.fuel, 1)} L\n`;
    html += `physics ${this.game.physics.stats.ms.toFixed(2)} ms · ${this.game.physics.stats.substeps} substeps · fps ${this.game.fps.toFixed(0)}\n`;
    html += `wheel  load(N)  slip  ratio  angle° susp\n`;
    for (const wh of w) {
      html += `${wh.id}  ${wh.detached ? '   —   OFF' : `${f(wh.load)} ${f(wh.slip, 2)} ${f(wh.slipRatio, 2)} ${f((wh.slipAngle * 180) / Math.PI, 1)} ${f((wh.sMax - wh.s) * 100, 0)}`}\n`;
    }
    el.innerHTML = `<pre style="margin:0">${html}</pre>`;
  }
}
