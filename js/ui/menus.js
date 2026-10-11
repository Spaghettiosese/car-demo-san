import * as THREE from 'three';
import { save, DEFAULT_SETTINGS } from '../main.js';
import { Car } from '../vehicle/car.js';
import { configForBody, DEFAULT_CONFIG, BODIES } from '../vehicle/specs.js';
import { randomPlate } from '../ai/traffic.js';
import { WEATHERS } from '../world/environment.js';
import { listSlots, deleteProfile, levelProgress } from '../career/profile.js';
import { ACHIEVEMENTS } from '../career/achievements.js';
import { fmtMoney } from '../career/economy.js';
import { BINDINGS, REBINDABLE, rebind, resetBindings, keyLabel } from '../input.js';

const root = () => document.getElementById('menu-root');

export const TIPS = [
  'Tip: in the cockpit, click the key twice for the bulb check, a third time to crank.',
  'Tip: wear your seatbelt. Unbelted drivers can go through the windshield.',
  'Tip: cold tyres have less grip. Slicks need heat to work.',
  'Tip: leave the lights on with the engine off and the battery will go flat. Jump-start from another car.',
  'Tip: driving into the sea hydrolocks the engine. Cars float for a while before they sink.',
  'Tip: hard braking down the canyon cooks the brakes. Watch for fade.',
  'Tip: oil leaks leave slippery puddles behind you.',
  'Tip: a dirty car can be washed at the car wash on Harbor Ave.',
  'Tip: escaping the police in Career pays out. Getting busted costs an impound fee.',
  'Tip: hold B with the window open to lean out and look back.',
  'Tip: cruise control (O) and the speed limiter (U) keep you clear of speed cameras.',
  'Tip: EVs start with the brake held. Regen level is on /.',
];

const CONTROLS = [
  ['Driving', [
    ['Throttle / brake / reverse', 'W / S  or  ↑ / ↓'], ['Steer', 'A / D  or  ← / →'], ['Handbrake', 'Space'],
    ['Shift up / down (manual)', 'X or Shift / Z'], ['Toggle auto / manual gearbox', 'T'], ['Start / stop engine', 'I'],
    ['Horn', 'H'], ['Headlights (off / parking / on)', 'L'], ['High beams', 'K'], ['Indicators', 'Q / E'], ['Hazards', 'J'], ['Wipers', 'V'],
    ['Look back (lean out with the window open)', 'B'], ['Look left / right', '[ / ]'], ['Reset / flip car (hold)', 'R'], ['Repair (Free Roam)', 'Backspace'], ['Police siren (cop cars)', 'G'],
    ['Clutch (realistic clutch setting)', 'L-Ctrl'], ['Pick a gear (manual)', '1-7, ` reverse, 0 neutral'], ['Flash to pass', 'Y'], ['Fog lights', '.'],
    ['Cruise control set / cancel', 'O'], ['Cruise / limiter speed', '= / -'], ['Speed limiter', 'U'], ['Drive mode Eco / Normal / Sport', ','], ['EV regen level', '/'],
    ['Seat height / position', 'PgUp PgDn / Home End'],
  ]],
  ['Camera & world', [
    ['Cycle camera', 'C'], ['Cockpit: look around', 'Mouse (click to grab)'], ['Cockpit: use a control', 'Left click'], ['Cockpit: zoom', 'Hold middle mouse'],
    ['Chase cam orbit / zoom', 'Drag mouse / wheel'], ['Photo mode', 'F2'], ['Slow motion', '\\'], ['Map & GPS waypoint', 'M'], ['Next radio station', 'N'],
    ['Get out / get in a car', 'F'], ['Garage / refuel (in zone)', 'Enter'], ['Telemetry', 'F3'], ['Pause menu', 'Esc'],
    ['Phone', 'Tab'], ['Replay', 'F5'], ['Hide HUD', 'F6'], ['Restart event', 'F4'], ['Cockpit FOV', 'Mouse wheel (cockpit)'],
  ]],
  ['On foot', [['Walk / run', 'WASD / Shift'], ['Jump', 'Space'], ['Enter nearest car', 'F'], ['Extinguisher / jump start / interact', 'E'], ['Key fob: lock / unlock', 'K']]],
  ['Gamepad', [['Throttle / brake', 'RT / LT'], ['Steer', 'Left stick'], ['Look', 'Right stick'], ['Handbrake', 'A'], ['Gears', 'LB / RB'], ['Camera', 'Y'], ['Horn', 'X'], ['Lights / wipers / indicators', 'D-pad']]],
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.helpEl = document.getElementById('help');
    this.mapEl = document.getElementById('map-full');
    this.buildHelp();
    const mc = document.getElementById('map-canvas');
    // drag to pan, wheel to zoom, click to set a waypoint
    const toCanvas = (e) => {
      const r = mc.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * mc.width, ((e.clientY - r.top) / r.height) * mc.height, mc.width / r.width];
    };
    let drag = null;
    mc.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = toCanvas(e);
      this.game.hud.fullMapZoom?.(Math.pow(1.2, -Math.sign(e.deltaY)), x, y);
    }, { passive: false });
    mc.addEventListener('pointerdown', (e) => {
      if (e.button === 0) drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      const k = toCanvas(e)[2];
      this.game.hud.fullMapPan?.(dx * k, dy * k);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    window.addEventListener('pointerup', () => setTimeout(() => (drag = null), 0));
    mc.addEventListener('mouseup', (e) => {
      if (e.button === 0 && drag && drag.moved) return;
      const [x, y] = toCanvas(e);
      const g = this.game;
      if (e.button === 2) g.setWaypoint(null);
      else if (g.hud.fullMapToWorld) {
        // clicking near an event or service icon snaps the GPS to it
        const w = g.hud.fullMapToWorld(x, y);
        const near = (g.activities?.defs || []).filter((d) => d.start && !d.hidden).map((d) => ({ name: d.name, pos: d.start }))
          .concat(Object.values(g.city.locations).map((l) => ({ name: l.name, pos: l.pos })))
          .map((o) => ({ ...o, d: Math.hypot(o.pos.x - w.x, o.pos.z - w.z) }))
          .sort((a, b) => a.d - b.d)[0];
        if (near && near.d < 30) {
          g.setWaypoint(near.pos.clone());
          g.toast(`GPS: ${near.name}`, 'info', 2);
        } else g.setWaypoint(w);
      }
    });
    mc.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mapEl.addEventListener('mousedown', (e) => {
      if (e.target === this.mapEl) this.closeAll();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && (this.game.state === 'pause' || this.game.state === 'map') && !this.justOpened) {
        e.preventDefault();
      }
    });
  }

  clear() {
    root().innerHTML = '';
  }

  el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  // ------------------------------------------------------------ main menu
  openMain() {
    const g = this.game;
    g.state = 'menu';
    g.hud.show(false);
    g.input.unlock();
    this.clear();
    const slots = listSlots();
    const last = slots.filter((x) => !x.empty).sort((p, q) => (q.playtime || 0) - (p.playtime || 0))[0];
    const m = this.el(`
      <div class="menu main">
        <div class="side">
          <div class="title">SAN<span>.</span>DEMO</div>
          <div class="subtitle">DRIVING SANDBOX · CAREER · TECH DEMO</div>
          ${last ? `<button class="btn primary" data-a="continue">▶  Continue career <span style="float:right;font-size:13px;opacity:0.8">Slot ${last.slot} · LV ${last.level} · ${fmtMoney(last.money)}</span></button>` : ''}
          <button class="btn ${last ? '' : 'primary'}" data-a="career">🏁  Career</button>
          <button class="btn" data-a="free">🌆  Free Roam sandbox</button>
          <button class="btn" data-a="garage">🔧  Free Roam garage</button>
          <button class="btn" data-a="settings">⚙  Settings</button>
          <button class="btn" data-a="keys">🎮  Controls &amp; key bindings</button>
          <button class="btn" data-a="about">ℹ  About &amp; credits</button>
          <div class="foot">
            <b>Career</b>: start with a tired hatchback and $1,500. Earn money from jobs, races and stunts, buy cars and parts, and pay for fuel, repairs and fines.<br>
            <b>Free Roam</b>: everything unlocked, free repairs, the sandbox menu.<br>
            <span class="tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</span>
          </div>
        </div>
      </div>`);
    m.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      g.audio?.resume?.();
      g.audio?.click?.();
      if (a === 'continue') {
        this.clear();
        g.startCareer(last.slot, false);
      } else if (a === 'career') this.openCareerSlots();
      else if (a === 'free') {
        this.clear();
        g.startFreeRoam();
      } else if (a === 'garage') {
        this.clear();
        g.career = null;
        g.mode = 'free';
        g.garage?.open('menu');
      } else if (a === 'settings') this.openSettings(() => this.openMain());
      else if (a === 'keys') this.openKeys(() => this.openMain());
      else if (a === 'about') this.openAbout();
    });
    root().appendChild(m);
  }

  /** Career save slots: continue, start new (with an in-page confirm when overwriting), delete. */
  openCareerSlots(confirm = null) {
    const g = this.game;
    this.clear();
    const slots = listSlots();
    const fmtTime = (s) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.72)"><div class="panel">
      <h2>Career</h2>
      <div class="slots">${slots.map((sl) => `
        <div class="slot ${sl.empty ? 'empty' : ''}">
          <div class="h">Slot ${sl.slot}</div>
          ${sl.empty ? '<div class="i">Empty</div>' : `<div class="i">Level ${sl.level} · ${fmtMoney(sl.money)} · ${sl.cars} car${sl.cars === 1 ? '' : 's'}<br>Day ${sl.day} · played ${fmtTime(sl.playtime)}</div>`}
          ${confirm && confirm.slot === sl.slot ? `<div class="confirm">${confirm.kind === 'delete' ? 'Delete this save for good?' : 'Overwrite this save with a new career?'}
              <button class="btn small primary" data-c="${confirm.kind}" data-slot="${sl.slot}">Yes</button><button class="btn small" data-c="cancel">No</button></div>` : `
          <div class="b">
            ${sl.empty ? `<button class="btn small primary" data-new="${sl.slot}">New career</button>` : `<button class="btn small primary" data-load="${sl.slot}">Continue</button><button class="btn small" data-new="${sl.slot}">New</button><button class="btn small" data-del="${sl.slot}">Delete</button>`}
          </div>`}
        </div>`).join('')}</div>
      <button class="btn small" data-a="back">Back</button></div></div>`);
    p.querySelector('[data-a=back]').onclick = () => this.openMain();
    p.querySelectorAll('[data-load]').forEach((b) => (b.onclick = () => {
      this.clear();
      g.startCareer(+b.dataset.load, false);
    }));
    p.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => {
      const slot = +b.dataset.new;
      if (!slots.find((x) => x.slot === slot).empty) return this.openCareerSlots({ slot, kind: 'new' });
      this.clear();
      g.startCareer(slot, true);
    }));
    p.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => this.openCareerSlots({ slot: +b.dataset.del, kind: 'delete' })));
    p.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.c;
      if (k === 'cancel') return this.openCareerSlots();
      const slot = +b.dataset.slot;
      if (k === 'delete') {
        deleteProfile(slot);
        return this.openCareerSlots();
      }
      this.clear();
      g.startCareer(slot, true);
    }));
    root().appendChild(p);
  }

  /** Key rebinding (click an action, then press a key). */
  openKeys(back) {
    const g = this.game;
    this.clear();
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.72)"><div class="panel">
      <h2>Controls &amp; key bindings</h2>
      <p style="color:#9aa3ad;margin-top:-6px">Click a binding, then press the new key. Esc cancels.</p>
      <div class="keys">${Object.entries(REBINDABLE).map(([k, label]) => `<div class="krow"><span>${label}</span><button class="btn small" data-key="${k}">${(BINDINGS[k] || []).map(keyLabel).join(' / ')}</button></div>`).join('')}</div>
      <div style="margin-top:14px"><button class="btn small" data-a="reset">Reset to defaults</button><button class="btn small" data-a="cheat">Full controls list</button><button class="btn small primary" data-a="back">Done</button></div></div></div>`);
    p.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => {
      b.textContent = 'press a key…';
      b.classList.add('primary');
      g.input.captureNext = (code) => {
        if (code !== 'Escape') rebind(b.dataset.key, code);
        this.openKeys(back);
      };
    }));
    p.querySelector('[data-a=reset]').onclick = () => {
      resetBindings();
      this.openKeys(back);
    };
    p.querySelector('[data-a=cheat]').onclick = () => this.toggleHelp(true);
    p.querySelector('[data-a=back]').onclick = () => back();
    root().appendChild(p);
  }

  openAbout() {
    this.clear();
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.7)"><div class="panel">
      <h2>About SAN DEMO</h2>
      <p style="line-height:1.6;color:#cfd5dc">A driving sandbox built from scratch in the browser with three.js. Nothing is pre-made: the cars, the city, the hills, the textures and every sound are generated in code.</p>
      <ul style="line-height:1.7;color:#cfd5dc">
        <li><b>Vehicle physics</b>: a rigid-body chassis on four raycast spring/damper corners, a combined-slip tyre model with temperature, wear and pressure, and an engine → clutch → gearbox → differential powertrain with a real clutch pedal, turbo lag, launch control and an EV mode.</li>
        <li><b>Soft-body damage</b>: a node-and-beam lattice with plastic yield. Panels fall off, glass shatters, wheels break, engines seize, fluids leak, fires start and fuel tanks explode.</li>
        <li><b>World</b>: a city with traffic lights and pedestrians, a mountain canyon road, a coast highway, a port with a freighter and cranes, a beach, a pier and the sea.</li>
        <li><b>AI</b>: traffic that obeys signals and loses its temper, police who ticket or chase you, pedestrians who dodge, race rivals, derby drivers and fleeing suspects.</li>
        <li><b>Career</b>: money, XP, a dealership, priced parts, insurance, loans, licence points, jobs, races and achievements.</li>
      </ul>
      <h3 style="margin:18px 0 6px">Credits</h3>
      <p style="line-height:1.6;color:#9aa3ad">Design, code, physics, procedural art and audio: generated for this demo with Claude.<br>Rendering: <b>three.js r160</b> (MIT licence). Fonts: system fonts. No third-party models, textures or sounds are used.<br>Thanks for playing — wear your seatbelt.</p>
      <button class="btn small" data-a="back">Back</button></div></div>`);
    p.querySelector('[data-a=back]').onclick = () => this.openMain();
    root().appendChild(p);
  }

  // ------------------------------------------------------------ pause / sandbox
  openPause(tab = 'world') {
    const g = this.game;
    if (g.state !== 'play') return;
    g.state = 'pause';
    g.input.unlock();
    this.renderPause(tab);
  }

  renderPause(tab) {
    const g = this.game;
    this.clear();
    const career = !!g.career;
    const tabs = career ? [['career', 'Career'], ['car', 'Car'], ['settings', 'Settings'], ['stats', 'Stats']] : [['world', 'World'], ['sandbox', 'Sandbox'], ['car', 'Car'], ['settings', 'Settings'], ['stats', 'Stats']];
    if (career && (tab === 'world' || tab === 'sandbox')) tab = 'career';
    const act = g.activities?.current;
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.55)"><div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2>Paused${career ? ' · Career' : ' · Free Roam'}</h2>
      <div><button class="btn small primary" data-a="resume">Resume (Esc)</button>${act ? '<button class="btn small" data-a="restart">Restart event</button><button class="btn small" data-a="quitev">Quit event</button>' : ''}${career ? '' : '<button class="btn small" data-a="garage">Garage</button>'}<button class="btn small" data-a="controls">Controls</button><button class="btn small" data-a="menu">${career ? 'Save &amp; quit' : 'Main menu'}</button></div></div>
      <div class="tabs">${tabs.map(([k, n]) => `<div class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${n}</div>`).join('')}</div>
      <div class="content"></div></div></div>`);
    p.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => this.renderPause(t.dataset.tab)));
    p.querySelector('[data-a=resume]').onclick = () => this.closeAll();
    const gb = p.querySelector('[data-a=garage]');
    if (gb) gb.onclick = () => {
      this.clear();
      g.garage?.open('pause');
    };
    const rb = p.querySelector('[data-a=restart]');
    if (rb) rb.onclick = () => {
      this.closeAll();
      g.activities.restart();
    };
    const qb = p.querySelector('[data-a=quitev]');
    if (qb) qb.onclick = () => {
      this.closeAll();
      g.activities.abort(true);
    };
    p.querySelector('[data-a=controls]').onclick = () => this.openKeys(() => this.renderPause(tab));
    p.querySelector('[data-a=menu]').onclick = () => {
      g.hud.show(false);
      g.quitToMenu();
    };
    const c = p.querySelector('.content');
    if (tab === 'career') this.careerTab(c);
    if (tab === 'world') this.worldTab(c);
    if (tab === 'sandbox') this.sandboxTab(c);
    if (tab === 'car') this.carTab(c);
    if (tab === 'settings') this.settingsRows(c);
    if (tab === 'stats') this.statsTab(c);
    root().appendChild(p);
  }

  careerTab(c) {
    const g = this.game;
    const ca = g.career;
    const p = ca.p;
    const pr = levelProgress(p.xp);
    const unlocked = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
    const medals = Object.values(p.events);
    const m = (n) => medals.filter((e) => e.medal === n).length;
    c.innerHTML = `
      <div class="cgrid">
        <div class="ccard"><div class="l">Level</div><div class="v">${pr.level}</div><div class="s">${pr.into} / ${pr.need} XP</div></div>
        <div class="ccard"><div class="l">Money</div><div class="v">${fmtMoney(p.money)}</div><div class="s">${ca.debt ? 'Debt ' + fmtMoney(ca.debt) : 'No debt'}</div></div>
        <div class="ccard"><div class="l">Licence</div><div class="v">${p.licence.points}/12</div><div class="s">${ca.suspended ? '<b style="color:#ff7070">SUSPENDED</b>' : 'points'}</div></div>
        <div class="ccard"><div class="l">Medals</div><div class="v">🥇${m(3)} 🥈${m(2)} 🥉${m(1)}</div><div class="s">${Object.keys(p.events).length} events tried</div></div>
        <div class="ccard"><div class="l">Day</div><div class="v">${p.day}</div><div class="s">${Math.floor(p.playtime / 60)} min played</div></div>
        <div class="ccard"><div class="l">Garage</div><div class="v">${p.garage.length}</div><div class="s">car${p.garage.length === 1 ? '' : 's'} owned</div></div>
      </div>
      ${this.row('Insurance', `<span style="color:#9aa3ad">${fmtMoney(ca.premium())}/day · pays 60% of repairs over $250</span> <button class="btn small ${p.insurance.active ? 'primary' : ''}" data-a="ins">${p.insurance.active ? 'Insured ✔' : 'Buy cover'}</button>`)}
      ${this.row('Bank loan', `<span style="color:#9aa3ad">Up to ${fmtMoney(ca.loanLimit())} · 12% fee · repaid over 5 days</span> <button class="btn small" data-a="loan">Borrow $5,000</button>`)}
      <h3 style="margin:16px 0 8px">Achievements · ${unlocked}/${ACHIEVEMENTS.length}</h3>
      <div class="achs">${ACHIEVEMENTS.map((a) => `<div class="ach ${p.achievements[a.id] ? 'on' : ''}"><b>${p.achievements[a.id] ? '🏆' : '🔒'} ${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>`;
    c.querySelector('[data-a=ins]').onclick = () => {
      ca.setInsurance(!p.insurance.active);
      this.renderPause('career');
    };
    c.querySelector('[data-a=loan]').onclick = () => {
      const got = ca.borrow(5000);
      g.toast(got ? `Borrowed ${fmtMoney(got)}` : 'Loan limit reached', got ? 'good' : 'warn');
      this.renderPause('career');
    };
  }

  row(label, ctl) {
    return `<div class="row"><label>${label}</label><div class="ctl">${ctl}</div></div>`;
  }

  seg(name, options, current) {
    return `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(current) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  bindSeg(c, name, fn) {
    const s = c.querySelector(`[data-seg="${name}"]`);
    if (!s) return;
    s.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        s.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        fn(b.dataset.v);
        this.game.audio?.click?.();
      };
    });
  }

  worldTab(c) {
    const g = this.game;
    const s = g.settings;
    c.innerHTML = [
      this.row('Time of day', `<input type="range" min="0" max="24" step="0.1" value="${g.env.hour.toFixed(1)}" data-r="hour"><span data-o="hour">${fmtHour(g.env.hour)}</span>`),
      this.row('Time speed', this.seg('tscale', [[0, 'Frozen'], [1, '1×'], [5, '5×'], [30, '30×']], s.timeScale)),
      this.row('Weather', this.seg('weather', WEATHERS.map((w) => [w, w[0].toUpperCase() + w.slice(1)]), g.env.weather)),
      this.row('Traffic density', `<input type="range" min="0" max="45" step="1" value="${s.traffic}" data-r="traffic"><span data-o="traffic">${s.traffic}</span>`),
      this.row('Police', this.seg('cops', [[1, 'On'], [0, 'Off']], s.cops ? 1 : 0)),
      this.row('Road rage', this.seg('rage', [[1, 'On'], [0, 'Off']], s.roadRage === false ? 0 : 1)),
      this.row('Damage', this.seg('damage', [[0, 'Off'], [0.5, 'Light'], [1, 'Realistic'], [2, 'Brittle']], s.damage)),
      this.row('Crash slow-motion', this.seg('slowmo', [[1, 'On'], [0, 'Off']], s.slowmo ? 1 : 0)),
      this.row('Reset world', `<button class="btn small" data-a="resetworld">Repair props, clear debris & skid marks</button>`),
    ].join('');
    const hour = c.querySelector('[data-r=hour]');
    hour.oninput = () => {
      g.env.setTime(parseFloat(hour.value));
      c.querySelector('[data-o=hour]').textContent = fmtHour(g.env.hour);
      g.env.envTimer = 0;
    };
    this.bindSeg(c, 'tscale', (v) => {
      s.timeScale = +v;
      g.env.timeScale = (1 / 60) * s.timeScale;
      g.env.frozen = s.timeScale === 0;
      this.saveSettings();
    });
    this.bindSeg(c, 'weather', (v) => g.env.setWeather(v));
    const tr = c.querySelector('[data-r=traffic]');
    tr.oninput = () => (c.querySelector('[data-o=traffic]').textContent = tr.value);
    tr.onchange = () => {
      s.traffic = +tr.value;
      g.traffic?.setDensity(s.traffic);
      this.saveSettings();
    };
    this.bindSeg(c, 'cops', (v) => {
      s.cops = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'rage', (v) => {
      s.roadRage = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'damage', (v) => {
      s.damage = +v;
      this.saveSettings();
    });
    this.bindSeg(c, 'slowmo', (v) => {
      s.slowmo = v === '1';
      this.saveSettings();
    });
    c.querySelector('[data-a=resetworld]').onclick = () => {
      g.props.reset();
      g.debris.clear();
      g.skids.clear();
      g.toast('World reset', 'good');
    };
  }

  sandboxTab(c) {
    const g = this.game;
    const locs = g.city.locations;
    c.innerHTML = [
      this.row('Your car', `<button class="btn small" data-a="repair">Repair</button><button class="btn small" data-a="flip">Flip / recover</button><button class="btn small" data-a="refuel">Refuel</button><button class="btn small" data-a="invuln">${g.player.car?.invulnerable ? 'Damage: OFF' : 'Damage: ON'}</button>`),
      this.row('Teleport', Object.entries(locs).map(([k, l]) => `<button class="btn small" data-tp="${k}">${l.name}</button>`).join('')),
      this.row('Crash test (Proving Grounds wall)', [30, 50, 64, 80, 120, 160].map((v) => `<button class="btn small" data-ct="${v}">${g.fmtSpeed ? g.fmtSpeed(v / 3.6) : v + ' km/h'}</button>`).join('')),
      this.row('Spawn in front of you', `<button class="btn small" data-sp="ramp">Ramp</button><button class="btn small" data-sp="car">Parked car</button><button class="btn small" data-sp="wall">Car wall (3)</button><button class="btn small" data-sp="cones">Cones</button><button class="btn small" data-sp="barrels">Barrels</button>`),
      this.row('Chaos', `<button class="btn small" data-a="launch">Launch me</button><button class="btn small" data-a="carrain">Car rain</button><button class="btn small" data-a="ragenear">Anger nearest driver</button>`),
      this.row('Wanted level', [0, 1, 2, 3, 4, 5].map((n) => `<button class="btn small" data-w="${n}">${n ? '★'.repeat(n) : 'Clear'}</button>`).join('')),
      this.row('Gravity', this.seg('grav', [[9.81, 'Earth'], [3.71, 'Mars'], [1.62, 'Moon']], -g.physics.gravity.y)),
      this.row('Slow motion', this.seg('slow', [[0, 'Off'], [1, 'On']], g.manualSlowmo ? 1 : 0)),
    ].join('');
    const car = g.player.car;
    const act = {
      repair: () => car.repair(),
      flip: () => g.recoverCar(car),
      refuel: () => (car.phys.pt.fuel = 55),
      invuln: () => {
        car.invulnerable = !car.invulnerable;
        this.renderPause('sandbox');
      },
      launch: () => {
        car.body.sleeping = false;
        car.body.velocity.y += 14;
        car.body.angularVelocity.set(Math.random() * 3 - 1.5, Math.random() * 2, Math.random() * 3 - 1.5);
        this.closeAll();
      },
      carrain: () => {
        this.closeAll();
        this.carRain();
      },
      ragenear: () => {
        const d = g.traffic?.drivers.filter((x) => x.state === 'drive').sort((a, b) => a.car.body.position.distanceTo(car.body.position) - b.car.body.position.distanceTo(car.body.position))[0];
        if (d) {
          d.car.physicsActive = true;
          d.aggression = 1;
          d.startRage();
        }
        this.closeAll();
      },
    };
    c.querySelectorAll('[data-a]').forEach((b) => {
      if (act[b.dataset.a]) b.onclick = () => {
        act[b.dataset.a]();
        g.audio?.click?.();
      };
    });
    c.querySelectorAll('[data-tp]').forEach((b) => (b.onclick = () => {
      const l = locs[b.dataset.tp];
      const p = l.pos;
      if (g.player.mode === 'foot') g.onFoot?.forceEnter?.();
      g.player.car.placeAt(p.x, g.world.groundAt(p.x, p.z, 5, { y: 0 }).y, p.z, l.yaw);
      g.cam.initialized = false;
      this.closeAll();
    }));
    c.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => {
      this.spawn(b.dataset.sp);
      this.closeAll();
    }));
    c.querySelectorAll('[data-ct]').forEach((b) => (b.onclick = () => {
      this.closeAll();
      g.crashTest(+b.dataset.ct);
    }));
    c.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => {
      const n = +b.dataset.w;
      const pol = g.police;
      if (!pol) return;
      if (n === 0) pol.heat = 0;
      else {
        g.settings.cops = true;
        pol.heat = n;
        pol.evade = 0;
        pol.startPursuit(null, n === 1);
      }
      this.closeAll();
    }));
    this.bindSeg(c, 'grav', (v) => g.physics.gravity.set(0, -v, 0));
    this.bindSeg(c, 'slow', (v) => (g.manualSlowmo = v === '1'));
  }

  spawn(kind) {
    const g = this.game;
    const car = g.player.car;
    const b = car.body;
    const fwd = new THREE.Vector3();
    b.axis(2, fwd);
    fwd.y = 0;
    fwd.normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    const at = (d, side = 0) => b.position.clone().addScaledVector(fwd, d).add(new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(side));
    if (kind === 'ramp') {
      const p = at(28);
      g.city.ramp(p.x, p.z, yaw, 7, 14, 0, 2.6, 'metal');
    } else if (kind === 'car' || kind === 'wall') {
      const n = kind === 'wall' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const cfg = configForBody(['sedan', 'suv', 'hatch', 'van', 'pickup'][Math.floor(Math.random() * 5)], DEFAULT_CONFIG);
        cfg.paint = ['#e8e8ea', '#101114', '#1f4fa8', '#b01e23', '#6b6f76'][Math.floor(Math.random() * 5)];
        cfg.livery = 'none';
        cfg.spoiler = 'none';
        cfg.plate = randomPlate();
        const c = new Car(g, cfg, { npc: true });
        const p = at(22, (i - (n - 1) / 2) * 2.3);
        c.placeAt(p.x, g.world.groundAt(p.x, p.z, 5, { y: 0 }).y, p.z, yaw + Math.PI / 2);
        c.body.sleeping = true;
        c.parked = true;
        g.addCar(c);
      }
    } else if (kind === 'cones' || kind === 'barrels') {
      for (let i = 0; i < (kind === 'cones' ? 10 : 9); i++) {
        const p = kind === 'cones' ? at(18 + i * 4, (i % 2 ? 1.5 : -1.5)) : at(20 + Math.floor(i / 3) * 0.7, (i % 3) * 0.7 - 0.7);
        const it = g.props.add(kind === 'cones' ? 'cone' : 'barrel', p.x, p.z, 0, g.world.groundAt(p.x, p.z, 5, { y: 0 }).y);
        // spawn as a loose physics object right away
        g.props.breakItem(it, null, p, new THREE.Vector3(), 0);
      }
    }
  }

  carRain() {
    const g = this.game;
    const car = g.player.car;
    let n = 0;
    const drop = () => {
      if (n++ >= 8 || g.state !== 'play') return;
      const cfg = configForBody(['sedan', 'hatch', 'suv', 'coupe', 'van'][n % 5], DEFAULT_CONFIG);
      cfg.paint = `hsl(${Math.random() * 360},60%,45%)`;
      cfg.paint = '#' + new THREE.Color(cfg.paint).getHexString();
      cfg.livery = 'none';
      cfg.spoiler = 'none';
      cfg.plate = randomPlate();
      const c = new Car(g, cfg, { npc: true });
      const p = car.body.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));
      c.placeAt(p.x, 18 + Math.random() * 10, p.z, Math.random() * 6);
      c.body.angularVelocity.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      c.parked = true;
      g.addCar(c);
      setTimeout(drop, 350);
    };
    drop();
  }

  carTab(c) {
    const g = this.game;
    const car = g.player.car;
    if (!car) return;
    const pt = car.phys.pt;
    c.innerHTML = [
      this.row('Model', `${car.model.prof.b.name} · ${car.model.prof.b.kind}`),
      this.row('Engine', `${pt.spec.name}${pt.spec.turbo ? ' + ' + pt.spec.turbo.name : ''} · health ${Math.round(pt.health * 100)}% · ${Math.round(pt.temp)}°C`),
      this.row('Fuel', `${pt.fuel.toFixed(1)} L`),
      this.row('Gearbox', this.seg('gb', [['auto', 'Automatic'], ['manual', 'Manual']], pt.auto ? 'auto' : 'manual')),
      this.row('ABS / TCS', this.seg('abs', [[1, 'ABS on'], [0, 'ABS off']], car.tuning.assists.abs ? 1 : 0) + this.seg('tcs', [[1, 'TCS on'], [0, 'TCS off']], car.tuning.assists.tcs ? 1 : 0)),
      this.row('Steering assist', this.seg('sa', [[1, 'On'], [0, 'Off']], g.settings.steerAssist ? 1 : 0)),
      this.row('Damage', `Body ${Math.round(car.damageSummary().body * 100)}% · wheels off: ${car.phys.wheels.filter((w) => w.detached).length}`),
    ].join('') + `<h3 class="dmg-h">Damage report</h3>${g.hud.damageReport ? g.hud.damageReport(car) : ''}`;
    this.bindSeg(c, 'gb', (v) => {
      pt.auto = v === 'auto';
      pt.selector = pt.auto ? 'D' : 'M';
      if (!pt.auto && pt.gear < 1) pt.shiftTo(1);
    });
    this.bindSeg(c, 'abs', (v) => (car.tuning.assists.abs = v === '1'));
    this.bindSeg(c, 'tcs', (v) => (car.tuning.assists.tcs = v === '1'));
    this.bindSeg(c, 'sa', (v) => {
      g.settings.steerAssist = v === '1';
      this.saveSettings();
    });
  }

  statsTab(c) {
    const st = this.game.stats;
    c.innerHTML = [
      this.row('Distance driven', `${(st.distance / 1000).toFixed(2)} km`),
      this.row('Top speed', `${Math.round(st.topSpeed * 3.6)} km/h`),
      this.row('Crashes', `${st.crashes}`),
      this.row('Fines paid', `$${st.fines}`),
      this.row('Police escapes', `${st.escapes || 0}`),
      this.row('Best quarter mile (drag strip)', st.bestDrag ? `${st.bestDrag.toFixed(2)} s` : '—'),
    ].join('');
  }

  // ------------------------------------------------------------ settings
  openSettings(back) {
    this.clear();
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.6)"><div class="panel"><h2>Settings</h2><div class="content"></div><button class="btn small" data-a="back">Back</button></div></div>`);
    this.settingsRows(p.querySelector('.content'));
    p.querySelector('[data-a=back]').onclick = back;
    root().appendChild(p);
  }

  settingsRows(c, tab = this.settingsTab || 'graphics') {
    const g = this.game;
    const s = g.settings;
    this.settingsTab = tab;
    const TABS = [['graphics', 'Graphics'], ['camera', 'Camera'], ['hud', 'HUD'], ['audio', 'Audio'], ['driving', 'Driving'], ['world', 'World']];
    const onoff = (k, key) => this.seg(k, [[1, 'On'], [0, 'Off']], s[key] ? 1 : 0);
    const slider = (name, min, max, step, val, fmt) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-r="${name}"><span data-o="${name}">${fmt(val)}</span>`;
    const pct = (v) => `${Math.round(v * 100)}%`;
    let rows = [];
    if (tab === 'graphics') rows = [
      this.row('Graphics preset', this.seg('q', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality)),
      this.row('Resolution scale', slider('res', 0.5, 1, 0.05, s.resScale, pct)),
      this.row('Dynamic resolution (holds the frame rate)', onoff('dynres', 'dynamicRes')),
      this.row('View distance', slider('view', 0.5, 1.5, 0.05, s.viewDistance, pct)),
      this.row('Tree density', slider('trees', 0, 1, 0.05, s.treeDensity, pct)),
      this.row('Shadows', onoff('shadows', 'shadows')),
      this.row('Bloom & grading', onoff('bloom', 'bloom')),
      this.row('Live mirrors', this.seg('mirrors', [['off', 'Off'], ['rear', 'Rear only'], ['all', 'Rear + side']], s.mirrors)),
    ];
    else if (tab === 'camera') rows = [
      this.row('Cockpit FOV', slider('fov', 55, 95, 1, s.cockpitFov, (v) => `${v}°`)),
      this.row('Chase camera distance', slider('cdist', 0.6, 1.8, 0.05, s.chaseDist, pct)),
      this.row('Chase camera height', slider('cheight', 0.5, 2, 0.05, s.chaseHeight, pct)),
      this.row('Chase camera stiffness', slider('cstiff', 0.3, 2.5, 0.05, s.chaseStiffness, pct)),
      this.row('Mouse sensitivity', slider('sens', 0.2, 3, 0.05, s.sensitivity, pct)),
      this.row('Invert mouse Y', onoff('invy', 'invertY')),
      this.row('Reduce camera shake', onoff('shake', 'reduceShake')),
      this.row('Rear-view picture-in-picture (chase cam)', onoff('pip', 'rearPip')),
      this.row('Automatic crash replays', onoff('autorep', 'autoReplay')),
    ];
    else if (tab === 'hud') rows = [
      this.row('Units', this.seg('units', [['kmh', 'km/h'], ['mph', 'mph']], s.units)),
      this.row('Speedometer style', this.seg('speedo', [['analog', 'Analog'], ['digital', 'Digital'], ['minimal', 'Minimal']], s.speedo)),
      this.row('HUD scale', slider('hudscale', 0.7, 1.4, 0.05, s.hudScale, pct)),
      this.row('Colour-blind friendly palette', onoff('cb', 'colorBlind')),
      this.row('Speed-limit sign', onoff('limit', 'speedLimitSign')),
      this.row('Speedometer in cockpit', onoff('hudc', 'hudInCockpit')),
      this.row('Speech bubbles', onoff('speech', 'showSpeech')),
      this.row('Subtitles (radio, speech, GPS)', onoff('subs', 'subtitles')),
      this.row('Frame-time graph', onoff('perf', 'perfGraph')),
    ];
    else if (tab === 'audio') rows = [
      this.row('Master volume', slider('master', 0, 1, 0.05, s.masterVolume, pct)),
      this.row('Engine volume', slider('engine', 0, 1.5, 0.05, s.engineVolume, pct)),
      this.row('Effects volume', slider('sfx', 0, 1.5, 0.05, s.sfxVolume, pct)),
      this.row('Radio volume', slider('radio', 0, 1, 0.05, s.radioVolume, pct)),
      this.row('Radio news voice', onoff('voice', 'newsVoice')),
      this.row('Spoken NPC lines (browser voice)', onoff('npcv', 'npcVoices')),
      this.row('Spoken GPS directions', onoff('gpsv', 'gpsVoice')),
    ];
    else if (tab === 'driving') rows = [
      this.row('Assist preset', this.seg('preset', [['arcade', 'Arcade'], ['realistic', 'Realistic'], ['sim', 'Sim']], s.assistPreset)),
      this.row('Steering assist', onoff('assist', 'steerAssist')),
      this.row('Auto-start engine on throttle', onoff('autoign', 'autoIgnition')),
      this.row('Look back', this.seg('holdlb', [[1, 'Hold'], [0, 'Toggle']], s.holdLookBack ? 1 : 0)),
      this.row('Sprint on foot', this.seg('holdrun', [[1, 'Hold'], [0, 'Toggle']], s.holdRun ? 1 : 0)),
      this.row('Steering wheel rotation', slider('lock', 270, 1080, 30, s.wheelLock, (v) => `${v}°`) + `<button class="btn small" data-a="calib">Calibrate wheel</button>`),
    ];
    else if (tab === 'world') rows = [
      this.row('Weather changes over time', onoff('autow', 'autoWeather')),
      this.row('Traffic follows the clock (rush hours)', onoff('tbt', 'trafficByTime')),
      this.row('Emergency services & breakdowns', onoff('svc', 'services')),
      this.row('Reset all settings', `<button class="btn small" data-a="reset">Defaults</button>`),
    ];
    c.innerHTML = `<div class="stabs">${TABS.map(([k, n]) => `<button data-st="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div><div class="srows">${rows.join('')}</div>`;
    c.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => this.settingsRows(c, b.dataset.st)));
    const range = (name, key, fmt, apply) => {
      const r = c.querySelector(`[data-r=${name}]`);
      if (!r) return;
      r.oninput = () => {
        s[key] = parseFloat(r.value);
        const o = c.querySelector(`[data-o=${name}]`);
        if (o && fmt) o.textContent = fmt(s[key]);
        apply?.();
        this.saveSettings();
      };
    };
    range('res', 'resScale', pct, () => g.resize());
    range('view', 'viewDistance', pct, () => g.applyViewDistance?.());
    range('trees', 'treeDensity', pct, () => g.terrain?.setTreeDensity?.(s.treeDensity));
    range('fov', 'cockpitFov', (v) => `${v}°`, () => (g.cam.cockpitFov = s.cockpitFov));
    range('cdist', 'chaseDist', pct);
    range('cheight', 'chaseHeight', pct);
    range('cstiff', 'chaseStiffness', pct);
    range('sens', 'sensitivity', pct);
    range('hudscale', 'hudScale', pct, () => g.applyHudPrefs?.());
    range('master', 'masterVolume', pct);
    range('engine', 'engineVolume', pct);
    range('sfx', 'sfxVolume', pct);
    range('radio', 'radioVolume', pct);
    range('lock', 'wheelLock', (v) => `${v}°`);
    const flag = (k, key, after) => this.bindSeg(c, k, (v) => {
      s[key] = v === '1';
      after?.();
      this.saveSettings();
    });
    this.bindSeg(c, 'q', (v) => {
      s.quality = v;
      if (v === 'low') Object.assign(s, { shadows: false, bloom: false, resScale: 0.7, traffic: 14, viewDistance: 0.7, treeDensity: 0.5, mirrors: 'rear' });
      if (v === 'medium') Object.assign(s, { shadows: true, bloom: true, resScale: 0.85, traffic: 20, viewDistance: 0.9, treeDensity: 0.8, mirrors: 'rear' });
      if (v === 'high') Object.assign(s, { shadows: true, bloom: true, resScale: 1, traffic: 26, viewDistance: 1, treeDensity: 1, mirrors: 'all' });
      this.applyGraphics();
      this.saveSettings();
      this.settingsRows(c, 'graphics');
    });
    flag('shadows', 'shadows', () => this.applyGraphics());
    flag('bloom', 'bloom');
    flag('dynres', 'dynamicRes', () => g.resize());
    this.bindSeg(c, 'mirrors', (v) => {
      s.mirrors = v;
      this.saveSettings();
    });
    flag('invy', 'invertY');
    flag('shake', 'reduceShake');
    flag('pip', 'rearPip');
    flag('autorep', 'autoReplay');
    this.bindSeg(c, 'units', (v) => {
      s.units = v;
      this.saveSettings();
    });
    this.bindSeg(c, 'speedo', (v) => {
      s.speedo = v;
      this.saveSettings();
    });
    flag('cb', 'colorBlind', () => g.applyHudPrefs?.());
    flag('limit', 'speedLimitSign');
    flag('hudc', 'hudInCockpit');
    flag('speech', 'showSpeech');
    flag('subs', 'subtitles');
    flag('perf', 'perfGraph');
    flag('voice', 'newsVoice');
    flag('npcv', 'npcVoices');
    flag('gpsv', 'gpsVoice');
    this.bindSeg(c, 'preset', (v) => {
      s.assistPreset = v;
      g.applyAssistPreset?.(g.player.car, true);
      this.saveSettings();
      this.settingsRows(c, 'driving');
    });
    flag('assist', 'steerAssist');
    flag('autoign', 'autoIgnition');
    flag('holdlb', 'holdLookBack');
    flag('holdrun', 'holdRun');
    flag('autow', 'autoWeather');
    flag('tbt', 'trafficByTime');
    flag('svc', 'services', () => !s.services && g.services?.clear());
    const calib = c.querySelector('[data-a=calib]');
    if (calib) calib.onclick = () => this.calibrateWheel(c);
    const reset = c.querySelector('[data-a=reset]');
    if (reset) reset.onclick = () => {
      Object.assign(s, DEFAULT_SETTINGS);
      this.applyGraphics();
      g.applyHudPrefs?.();
      this.saveSettings();
      this.settingsRows(c, tab);
    };
  }

  /** Steering wheel calibration: turn fully left, fully right, then centre. */
  calibrateWheel(c) {
    const g = this.game;
    const steps = ['Turn the wheel fully LEFT and hold it', 'Now fully RIGHT', 'Now let it go to the centre'];
    const read = () => {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      return pads.length ? pads[0].axes[0] : null;
    };
    if (read() === null) {
      g.toast('No wheel or gamepad found. Plug it in and press any button on it first.', 'warn', 4);
      return;
    }
    const cal = {};
    let k = 0;
    const panel = this.el(`<div class="calib"><div class="t"></div><button class="btn small primary">Next</button></div>`);
    c.appendChild(panel);
    const show = () => (panel.querySelector('.t').textContent = `Step ${k + 1}/3: ${steps[k]}`);
    show();
    panel.querySelector('button').onclick = () => {
      const v = read() ?? 0;
      if (k === 0) cal.min = v;
      else if (k === 1) cal.max = v;
      else cal.center = v;
      k++;
      if (k < 3) return show();
      g.settings.wheelCal = cal;
      this.saveSettings();
      panel.remove();
      g.toast(`Wheel calibrated (${cal.min.toFixed(2)} … ${cal.max.toFixed(2)})`, 'good');
    };
  }

  applyGraphics() {
    const g = this.game;
    const s = g.settings;
    g.renderer.shadowMap.enabled = s.shadows;
    g.env.sun.castShadow = s.shadows;
    g.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    g.resize();
    g.traffic?.setDensity(s.traffic);
  }

  saveSettings() {
    save('sandemo.settings', this.game.settings);
  }

  // ------------------------------------------------------------ help / map
  buildHelp() {
    this.helpEl.innerHTML = `<div class="panel"><h2>Controls</h2><div class="help-grid">${CONTROLS.map(([h, rows]) => `<h3>${h}</h3>${rows.map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('')}`).join('')}</div><p style="color:#9aa3ad;margin-top:16px">In the cockpit, point the crosshair at the key, stalks, light knob, hazard button, radio screen, gear lever, handbrake, seatbelt buckle, door handle, window switch, glovebox, sun visor or dome light and click them.</p><button class="btn small" data-a="close">Close (F1)</button></div>`;
    this.helpEl.querySelector('[data-a=close]').onclick = () => this.toggleHelp(false);
    this.helpEl.addEventListener('mousedown', (e) => {
      if (e.target === this.helpEl) this.toggleHelp(false);
    });
  }

  toggleHelp(v) {
    const show = v ?? this.helpEl.classList.contains('hidden');
    this.helpEl.classList.toggle('hidden', !show);
    if (show) this.game.input.unlock();
  }

  openMap() {
    const g = this.game;
    if (g.hud.mapView) g.hud.mapView.x = null; // re-centre on the player
    g.state = 'map';
    g.input.unlock();
    this.mapEl.classList.remove('hidden');
  }

  closeAll() {
    const g = this.game;
    this.clear();
    this.mapEl.classList.add('hidden');
    this.helpEl.classList.add('hidden');
    if (g.state === 'pause' || g.state === 'map') g.state = 'play';
    g.hud.show(true);
  }

  update() {
    // Esc closes overlays (handled here because the game loop skips input in menus)
    const g = this.game;
    if (!this.helpEl.classList.contains('hidden') && g.input.keyPressed('Escape')) {
      this.toggleHelp(false);
      g.input.pressedSet.delete('Escape');
    }
  }
}

function fmtHour(h) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export { BODIES };
