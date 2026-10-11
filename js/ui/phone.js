import * as THREE from 'three';
import { fmtMoney } from '../career/economy.js';
import { makeCanvas, canvasTexture, roundRect } from '../core/canvas.js';

const APPS = [
  ['map', '🗺️', 'Map'], ['jobs', '💼', 'Jobs'], ['contacts', '📞', 'Contacts'], ['bank', '🏦', 'Bank'],
  ['messages', '💬', 'Messages'], ['records', '🏆', 'Records'], ['camera', '📷', 'Camera'], ['settings', '⚙️', 'Settings'],
];

/**
 * The phone (Tab). It doesn't pause the game: using it while driving is a
 * bad idea (and the police agree). Also drives the dash-mounted phone screen.
 */
export class Phone {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.app = 'home';
    this.zoom = 1;
    this.pan = new THREE.Vector2();
    this.el = document.createElement('div');
    this.el.id = 'phone';
    this.el.className = 'hidden';
    document.getElementById('app').appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => {
      if (this.app === 'map') {
        this.zoom = Math.min(6, Math.max(0.6, this.zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
        this.drawMap();
        e.preventDefault();
      }
    }, { passive: false });
    // dash mount screen
    this.mountCanvas = makeCanvas(256, 448);
    this.mountTex = this.mountCanvas ? canvasTexture(this.mountCanvas) : null;
  }

  toggle(v) {
    const g = this.game;
    this.open = v ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) {
      g.input.unlock();
      this.app = 'home';
      this.render();
      g.audio?.click?.();
    }
  }

  go(app) {
    this.app = app;
    this.render();
    this.game.audio?.click?.();
  }

  render() {
    const g = this.game;
    const ca = g.career;
    const h = g.env.hour;
    const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const unread = ca ? ca.p.messages.filter((m) => !m.read).length : 0;
    let body = '';
    if (this.app === 'home') {
      body = `<div class="apps">${APPS.map(([k, ic, n]) => `<div class="app" data-app="${k}"><div class="ic">${ic}${k === 'messages' && unread ? `<i>${unread}</i>` : ''}</div><div>${n}</div></div>`).join('')}</div>
        ${ca ? `<div class="wid"><b>${fmtMoney(ca.money)}</b> · Level ${ca.level}<br><span>Day ${ca.p.day} · licence ${ca.p.licence.points}/12</span></div>` : '<div class="wid">Free Roam<br><span>Career apps work in Career mode</span></div>'}`;
    } else if (this.app === 'map') {
      body = `<canvas id="phone-map" width="300" height="420"></canvas><div class="pbtns"><button data-z="1">＋</button><button data-z="-1">－</button><button data-wp="clear">Clear GPS</button></div><div class="note">Tap the map to set a GPS waypoint. Wheel / ＋－ to zoom.</div>
        <div class="legend"><span class="lg" style="--c:#ffd36a">● Events</span><span class="lg" style="--c:#4cd964">● Services</span><span class="lg" style="--c:#50beff">● Waypoint</span></div>`;
    } else if (this.app === 'jobs') {
      const list = g.activities ? g.activities.list() : [];
      body = `<div class="list">${list.map((a) => `<div class="li" data-ev="${a.id}"><b>${a.icon || '🏁'} ${a.name}</b><span>${a.blurb}</span><span class="r">${a.medal ? ['', '🥉', '🥈', '🥇'][a.medal] : ''} ${a.locked ? '🔒 LV ' + a.level : fmtMoney(a.reward || 0)}</span></div>`).join('') || '<div class="note">No jobs available.</div>'}</div><div class="note">Tap an event to set GPS to it.</div>`;
    } else if (this.app === 'contacts') {
      const c = [
        ['tow', '🚛', 'Big Earl\'s Towing', ca ? (ca.p.insurance.active ? 'Free with insurance' : '$250 to Customs') : 'Tow to Customs'],
        ['mechanic', '🔧', 'Roadside mechanic', ca ? '$400 + parts, on the spot' : 'Fix it here'],
        ['taxi', '🚕', 'Downtown Taxi', 'Ride to your garage'],
        ['insurer', '🛡️', 'Demo Mutual Insurance', ca ? (ca.p.insurance.active ? 'You are covered' : 'Buy cover') : '—'],
        ['police', '🚔', 'SDPD non-emergency', 'Report yourself?'],
      ];
      body = `<div class="list">${c.map(([k, ic, n, d]) => `<div class="li" data-call="${k}"><b>${ic} ${n}</b><span>${d}</span></div>`).join('')}</div>`;
    } else if (this.app === 'bank') {
      if (!ca) body = '<div class="note">Bank works in Career mode.</div>';
      else {
        const pending = g.police?.pendingFine || 0;
        body = `<div class="wid big">${fmtMoney(ca.money)}<br><span>${ca.debt ? 'Loans: ' + fmtMoney(ca.debt) : 'No loans'}</span></div>
          ${pending ? `<button class="pbtn" data-pay="fine">Pay outstanding fine ${fmtMoney(pending)}</button>` : ''}
          <div class="list small">${ca.p.bank.slice().reverse().slice(0, 40).map((t) => `<div class="tx"><span>D${t.day} · ${t.label}</span><b class="${t.amount < 0 ? 'neg' : 'pos'}">${t.amount < 0 ? '-' : '+'}${fmtMoney(Math.abs(t.amount))}</b></div>`).join('')}</div>`;
      }
    } else if (this.app === 'messages') {
      if (!ca) body = '<div class="note">No messages in Free Roam.</div>';
      else {
        body = `<div class="list">${ca.p.messages.map((m) => `<div class="msg ${m.read ? '' : 'new'}"><b>${m.from}</b><span>${m.text}</span><i>Day ${m.day}</i></div>`).join('') || '<div class="note">No messages.</div>'}</div>`;
        ca.p.messages.forEach((m) => (m.read = true));
      }
    } else if (this.app === 'records') {
      const rec = g.activities ? g.activities.records() : [];
      body = `<div class="list small">${rec.map((r) => `<div class="tx"><span>${r.name}</span><b>${r.best}</b></div>`).join('') || '<div class="note">Set some records first.</div>'}</div>`;
    } else if (this.app === 'camera') {
      body = `<div class="note">Opens photo mode (F2): free camera, filters, exposure, time of day, save a PNG.</div><button class="pbtn" data-photo="1">Open photo mode</button>`;
    } else if (this.app === 'settings') {
      const s = g.settings;
      body = `<div class="list">
        <div class="li" data-set="units"><b>Units</b><span>${s.units === 'mph' ? 'mph / miles' : 'km/h / km'}</span></div>
        <div class="li" data-set="clutch"><b>Clutch</b><span>${s.clutch === 'manual' ? 'Manual (you work it)' : 'Automatic'}</span></div>
        <div class="li" data-set="autoIgnition"><b>Auto-ignition</b><span>${s.autoIgnition ? 'On' : 'Off (use the key)'}</span></div>
        <div class="li" data-set="cops"><b>Police</b><span>${s.cops ? 'On' : 'Off'}</span></div>
        <div class="li" data-set="showSpeech"><b>Speech bubbles</b><span>${s.showSpeech ? 'On' : 'Off'}</span></div>
      </div>`;
    }
    this.el.innerHTML = `<div class="frame"><div class="bar"><span>${clock}</span><span>📶 🔋</span></div>
      <div class="screen">${this.app !== 'home' ? `<div class="top"><button data-back="1">‹</button><b>${(APPS.find((a) => a[0] === this.app) || [])[2] || ''}</b></div>` : ''}${body}</div>
      <div class="home" data-home="1"></div></div>`;
    this.bind();
    if (this.app === 'map') this.drawMap();
  }

  bind() {
    const g = this.game;
    const q = (sel) => this.el.querySelectorAll(sel);
    q('[data-app]').forEach((e) => (e.onclick = () => this.go(e.dataset.app)));
    q('[data-back],[data-home]').forEach((e) => (e.onclick = () => this.go('home')));
    q('[data-z]').forEach((e) => (e.onclick = () => {
      this.zoom = Math.min(6, Math.max(0.6, this.zoom * (+e.dataset.z > 0 ? 1.4 : 0.7)));
      this.drawMap();
    }));
    q('[data-wp]').forEach((e) => (e.onclick = () => {
      g.setWaypoint(null);
      this.drawMap();
    }));
    q('[data-ev]').forEach((e) => (e.onclick = () => {
      const a = g.activities?.byId(e.dataset.ev);
      if (a && a.start) {
        g.setWaypoint(a.start.clone ? a.start.clone() : new THREE.Vector3(a.start.x, 0, a.start.z));
        g.toast(`GPS set: ${a.name}`);
      }
    }));
    q('[data-call]').forEach((e) => (e.onclick = () => this.call(e.dataset.call)));
    q('[data-pay]').forEach((e) => (e.onclick = () => {
      g.police?.payFine?.();
      this.render();
    }));
    q('[data-photo]').forEach((e) => (e.onclick = () => {
      this.toggle(false);
      g.togglePhoto?.(true);
    }));
    q('[data-set]').forEach((e) => (e.onclick = () => {
      const k = e.dataset.set;
      const s = g.settings;
      if (k === 'units') s.units = s.units === 'mph' ? 'kmh' : 'mph';
      else if (k === 'clutch') s.clutch = s.clutch === 'manual' ? 'auto' : 'manual';
      else s[k] = !s[k];
      g.menus?.saveSettings?.();
      this.render();
    }));
    const mc = this.el.querySelector('#phone-map');
    if (mc) mc.onclick = (ev) => {
      const r = mc.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * mc.width;
      const y = ((ev.clientY - r.top) / r.height) * mc.height;
      g.setWaypoint(this.mapToWorld(x, y));
      this.drawMap();
    };
  }

  // ------------------------------------------------------------ map app
  drawMap() {
    const g = this.game;
    const cv = this.el.querySelector('#phone-map');
    if (!cv || !g.hud.mapCache) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const hud = g.hud;
    const f = g.player.focus;
    const k = this.zoom * 0.32; // screen px per metre
    this.view = { cx: f.x, cz: f.z, k };
    ctx.fillStyle = '#0d1114';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    const [mx, mz] = hud.worldToMap(f.x, f.z);
    const s = k / hud.mapScale;
    ctx.scale(s, s);
    ctx.drawImage(hud.mapCache, -mx, -mz);
    ctx.restore();
    const P = (x, z) => [W / 2 + (x - f.x) * k, H / 2 + (z - f.z) * k];
    const dot = (x, z, col, r = 5, label) => {
      const [px, py] = P(x, z);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      if (label && this.zoom > 1.2) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '10px sans-serif';
        ctx.fillText(label, px + 7, py + 3);
      }
    };
    // services
    const L = g.city.locations;
    for (const k2 of ['garage', 'gas', 'dealer', 'police', 'hospital', 'harbor', 'lookout', 'beach', 'pier', 'lighthouse', 'proving']) if (L[k2]) dot(L[k2].pos.x, L[k2].pos.z, '#4cd964', 4, L[k2].name);
    if (g.city.carWash) dot(g.city.carWash.x, g.city.carWash.z, '#4cd964', 4, 'Car wash');
    // events
    for (const a of g.activities ? g.activities.list() : []) if (a.start) dot(a.start.x, a.start.z, a.locked ? '#777' : '#ffd36a', 4, a.name);
    if (g.gps?.target) dot(g.gps.target.x, g.gps.target.z, '#50beff', 6);
    // player arrow
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-g.player.heading + Math.PI);
    ctx.fillStyle = '#ff6a1f';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(-6, 7);
    ctx.fill();
    ctx.restore();
  }

  mapToWorld(x, y) {
    const v = this.view;
    return new THREE.Vector3(v.cx + (x - 150) / v.k, 0, v.cz + (y - 210) / v.k);
  }

  // ------------------------------------------------------------ contacts
  call(who) {
    const g = this.game;
    const ca = g.career;
    const car = g.player.car;
    const say = (t) => g.toast(t, 'info', 4);
    // nobody comes out to help you dodge the law or skip an event
    if (who === 'tow' || who === 'taxi' || who === 'mechanic') {
      const name = who === 'tow' ? 'Earl' : who === 'taxi' ? 'Dispatch' : 'The mechanic';
      if ((g.police?.heat || 0) > 0) return say(`${name}: "Not while the cops are on you. Call me when it's quiet."`);
      if (g.activities?.current) return say(`${name}: "Finish what you're doing first." (quit the event from the pause menu)`);
    }
    if (who === 'tow') {
      if (!car) return;
      if (ca && !ca.p.insurance.active && !ca.charge(250, 'Tow truck')) return say('Earl: "Cash up front, pal." (not enough money)');
      this.toggle(false);
      say('Earl is on his way…');
      g.fadeTo?.(() => {
        if (g.player.mode === 'foot') g.onFoot?.forceEnter?.();
        const loc = g.city.locations.garage;
        g.player.car.placeAt(loc.pos.x, 0, loc.pos.z, loc.yaw);
        g.player.car.stopEngine();
        g.cam.initialized = false;
        say('Towed to San Demo Customs.');
        ca?.unlock('towed');
      });
    } else if (who === 'mechanic') {
      if (!car) return;
      const pt = car.phys.pt;
      const parts = Math.round((1 - pt.health) * 1500 + car.phys.wheels.filter((w) => w.flat || w.detached).length * 220 + (car.ext.battery < 0.3 ? 120 : 0));
      const bill = 400 + parts;
      if (ca && !ca.charge(bill, 'Roadside mechanic')) return say('The mechanic wants ' + fmtMoney(bill) + '. You can\'t afford it.');
      this.toggle(false);
      g.fadeTo?.(() => {
        // gets you going again: engine, wheels, battery, fluids, fire. Not the bodywork.
        pt.health = Math.max(pt.health, 0.85);
        pt.hydrolocked = false;
        pt.oil = Math.max(pt.oil, 0.8);
        pt.coolant = 1;
        pt.oilLeak = 0;
        car.ext.battery = Math.max(car.ext.battery, 0.8);
        car.ext.fire = 0;
        car.electricsDead = false;
        car.flood = 0;
        for (const w of car.phys.wheels) w.flat = 0;
        if (car.phys.wheels.some((w) => w.detached)) car.repair({ keepTyres: true });
        say(ca ? `Mechanic fixed you up: ${fmtMoney(bill)}` : 'Mechanic fixed you up.');
      });
    } else if (who === 'taxi') {
      const loc = g.city.locations.garage;
      const d = g.player.focus.distanceTo(loc.pos);
      const fare = Math.round(40 + d * 0.4);
      if (ca && !ca.charge(fare, 'Taxi fare')) return say('Not enough money for a taxi.');
      this.toggle(false);
      g.fadeTo?.(() => {
        if (g.player.mode === 'foot') g.onFoot?.forceEnter?.();
        g.player.car.placeAt(loc.pos.x, 0, loc.pos.z, loc.yaw);
        g.cam.initialized = false;
        say(ca ? `Taxi to your garage: ${fmtMoney(fare)}. Your car was delivered there.` : 'Back at the garage.');
      });
    } else if (who === 'insurer') {
      if (!ca) return say('Demo Mutual only covers Career drivers.');
      ca.setInsurance(!ca.p.insurance.active);
      this.render();
    } else if (who === 'police') {
      const heat = g.police?.heat || 0;
      say(heat ? '"We know where you are."' : '"SDPD, how can we help? …Hello?"');
    }
  }

  // ------------------------------------------------------------ dash mount
  drawMount() {
    const c = this.mountCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    const g = this.game;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, 256, 448);
    const car = g.player.car;
    if (!car || !car.electrics) {
      this.mountTex.needsUpdate = true;
      return;
    }
    ctx.fillStyle = '#0d1520';
    roundRect(ctx, 8, 8, 240, 432, 22);
    ctx.fill();
    const h = g.env.hour;
    ctx.fillStyle = '#e8edf2';
    ctx.font = '700 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`, 128, 76);
    // GPS turn arrow
    const nav = g.gpsNav;
    if (nav) {
      ctx.save();
      ctx.translate(128, 190);
      ctx.rotate(nav.turn);
      ctx.fillStyle = '#50beff';
      ctx.beginPath();
      ctx.moveTo(0, -46);
      ctx.lineTo(30, -6);
      ctx.lineTo(10, -6);
      ctx.lineTo(10, 40);
      ctx.lineTo(-10, 40);
      ctx.lineTo(-10, -6);
      ctx.lineTo(-30, -6);
      ctx.fill();
      ctx.restore();
      ctx.font = '700 24px sans-serif';
      ctx.fillText(nav.dist, 128, 270);
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#9aa3ad';
      ctx.fillText((nav.street || '').slice(0, 20), 128, 296);
    } else {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#9aa3ad';
      ctx.fillText('No route', 128, 200);
    }
    const ca = g.career;
    const m = ca && ca.p.messages.find((x) => !x.read);
    if (m) {
      ctx.fillStyle = '#1b2633';
      roundRect(ctx, 20, 330, 216, 92, 14);
      ctx.fill();
      ctx.fillStyle = '#ffd36a';
      ctx.font = '700 15px sans-serif';
      ctx.fillText(m.from.slice(0, 22), 128, 356);
      ctx.fillStyle = '#c6ccd3';
      ctx.font = '13px sans-serif';
      ctx.fillText(m.text.slice(0, 28), 128, 380);
      ctx.fillText(m.text.slice(28, 56), 128, 398);
    }
    this.mountTex.needsUpdate = true;
  }

  update(dt) {
    const g = this.game;
    if (g.input.pressed('phone')) this.toggle();
    if (this.open && this.app === 'map') {
      this.mapT = (this.mapT || 0) - dt;
      if (this.mapT <= 0) {
        this.mapT = 0.25;
        this.drawMap();
      }
    }
    // texting & driving
    if (this.open && g.player.mode === 'car' && g.player.car && g.player.car.speed > 6) g.police?.offense?.('phone');
    this.mountT = (this.mountT || 0) - dt;
    if (this.mountT <= 0) {
      this.mountT = 0.2;
      if (g.cam.interior) this.drawMount();
    }
  }
}
