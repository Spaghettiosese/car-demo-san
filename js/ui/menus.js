import * as THREE from 'three';
import { save, DEFAULT_SETTINGS } from '../main.js';
import { Car } from '../vehicle/car.js';
import { configForBody, DEFAULT_CONFIG, BODIES } from '../vehicle/specs.js';
import { randomPlate } from '../ai/traffic.js';
import { WEATHERS } from '../world/environment.js';

const root = () => document.getElementById('menu-root');

const CONTROLS = [
  ['Driving', [
    ['Throttle / brake / reverse', 'W / S  or  ↑ / ↓'], ['Steer', 'A / D  or  ← / →'], ['Handbrake', 'Space'],
    ['Shift up / down (manual)', 'X or Shift / Z'], ['Toggle auto / manual gearbox', 'T'], ['Start / stop engine', 'I'],
    ['Horn', 'H'], ['Headlights (off / parking / on)', 'L'], ['High beams', 'K'], ['Indicators', 'Q / E'], ['Hazards', 'J'], ['Wipers', 'V'],
    ['Look back', 'B'], ['Reset / flip car (hold)', 'R'], ['Repair (sandbox)', 'Backspace'], ['Police siren (cop cars)', 'G'],
  ]],
  ['Camera & world', [
    ['Cycle camera', 'C'], ['Cockpit: look around', 'Mouse (click to grab)'], ['Cockpit: use a control', 'Left click'], ['Cockpit: zoom', 'Hold middle mouse'],
    ['Chase cam orbit / zoom', 'Drag mouse / wheel'], ['Photo mode', 'F2'], ['Slow motion', '\\'], ['Map & GPS waypoint', 'M'], ['Next radio station', 'N'],
    ['Get out / get in a car', 'F'], ['Garage / refuel (in zone)', 'Enter'], ['Telemetry', 'F3'], ['Sandbox menu', 'Esc'],
  ]],
  ['On foot', [['Walk / run', 'WASD / Shift'], ['Jump', 'Space'], ['Enter nearest car', 'F']]],
  ['Gamepad', [['Throttle / brake', 'RT / LT'], ['Steer', 'Left stick'], ['Look', 'Right stick'], ['Handbrake', 'A'], ['Gears', 'LB / RB'], ['Camera', 'Y'], ['Horn', 'X'], ['Lights / wipers / indicators', 'D-pad']]],
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.helpEl = document.getElementById('help');
    this.mapEl = document.getElementById('map-full');
    this.buildHelp();
    const mc = document.getElementById('map-canvas');
    mc.addEventListener('mousedown', (e) => {
      const r = mc.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * mc.width;
      const y = ((e.clientY - r.top) / r.height) * mc.height;
      if (e.button === 2) this.game.setWaypoint(null);
      else if (this.game.hud.fullMapToWorld) this.game.setWaypoint(this.game.hud.fullMapToWorld(x, y));
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
    const m = this.el(`
      <div class="menu main">
        <div class="side">
          <div class="title">SAN<span>.</span>DEMO</div>
          <div class="subtitle">DRIVING SANDBOX · TECH DEMO</div>
          <button class="btn primary" data-a="drive">▶  Drive</button>
          <button class="btn" data-a="garage">🔧  Garage & customization</button>
          <button class="btn" data-a="settings">⚙  Settings</button>
          <button class="btn" data-a="controls">🎮  Controls</button>
          <button class="btn" data-a="about">ℹ  About this demo</button>
          <div class="foot">
            Soft-body damage · raycast tyre physics · living traffic with road rage · police pursuits · interactive cockpit.<br>
            Tip: start in the cockpit and click the key to start the engine. Headphones recommended.
          </div>
        </div>
      </div>`);
    m.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      g.audio?.resume?.();
      g.audio?.click?.();
      if (a === 'drive') {
        this.clear();
        g.startDriving();
      } else if (a === 'garage') {
        this.clear();
        g.garage?.open('menu');
      } else if (a === 'settings') this.openSettings(() => this.openMain());
      else if (a === 'controls') this.toggleHelp(true);
      else if (a === 'about') this.openAbout();
    });
    root().appendChild(m);
  }

  openAbout() {
    this.clear();
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.7)"><div class="panel">
      <h2>About SAN DEMO</h2>
      <p style="line-height:1.6;color:#cfd5dc">A driving sandbox built from scratch in the browser with three.js. Nothing is pre-made: the cars, the city, the textures and every sound are generated in code.</p>
      <ul style="line-height:1.7;color:#cfd5dc">
        <li><b>Vehicle physics</b>: a rigid-body chassis on four raycast spring/damper corners with anti-roll bars, a combined-slip tyre model, and an engine → clutch → gearbox → differential powertrain (open / limited-slip / locked, FWD / RWD / AWD, turbo lag, EV).</li>
        <li><b>Soft-body damage</b>: a node-and-beam lattice with plastic yield deforms the body mesh, collision hull and suspension mounts. Panels come loose and fall off, glass cracks and shatters, wheels bend or break off, and engines and radiators fail.</li>
        <li><b>City</b>: 36 blocks with timed traffic lights, breakable street furniture, a park, gas station, customs shop, police HQ and a proving grounds with jumps, a skid pad, a crash wall and a drag strip.</li>
        <li><b>AI</b>: lane-following drivers that keep their distance, obey signals, yield, honk, and sometimes lose their temper. Police issue tickets or chase you, with pursuit levels up to roadblocks and spike strips.</li>
        <li><b>Audio</b>: synthesized engines per cylinder layout, turbo and backfires, tyre squeal, crashes, positional horns and sirens, and a radio with four generated stations.</li>
      </ul>
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
    const tabs = [['world', 'World'], ['sandbox', 'Sandbox'], ['car', 'Car'], ['settings', 'Settings'], ['stats', 'Stats']];
    const p = this.el(`<div class="menu" style="background:rgba(4,6,8,0.55)"><div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2>Paused</h2>
      <div><button class="btn small primary" data-a="resume">Resume (Esc)</button><button class="btn small" data-a="garage">Garage</button><button class="btn small" data-a="controls">Controls</button><button class="btn small" data-a="menu">Main menu</button></div></div>
      <div class="tabs">${tabs.map(([k, n]) => `<div class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${n}</div>`).join('')}</div>
      <div class="content"></div></div></div>`);
    p.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => this.renderPause(t.dataset.tab)));
    p.querySelector('[data-a=resume]').onclick = () => this.closeAll();
    p.querySelector('[data-a=garage]').onclick = () => {
      this.clear();
      g.garage?.open('pause');
    };
    p.querySelector('[data-a=controls]').onclick = () => this.toggleHelp(true);
    p.querySelector('[data-a=menu]').onclick = () => {
      g.hud.show(false);
      this.openMain();
    };
    const c = p.querySelector('.content');
    if (tab === 'world') this.worldTab(c);
    if (tab === 'sandbox') this.sandboxTab(c);
    if (tab === 'car') this.carTab(c);
    if (tab === 'settings') this.settingsRows(c);
    if (tab === 'stats') this.statsTab(c);
    root().appendChild(p);
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
    ].join('');
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

  settingsRows(c) {
    const g = this.game;
    const s = g.settings;
    c.innerHTML = `<div class="grid2"><div>${[
      this.row('Graphics preset', this.seg('q', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality)),
      this.row('Resolution scale', `<input type="range" min="0.5" max="1" step="0.05" value="${s.resScale}" data-r="res"><span data-o="res">${Math.round(s.resScale * 100)}%</span>`),
      this.row('Shadows', this.seg('shadows', [[1, 'On'], [0, 'Off']], s.shadows ? 1 : 0)),
      this.row('Bloom & grading', this.seg('bloom', [[1, 'On'], [0, 'Off']], s.bloom ? 1 : 0)),
      this.row('Cockpit FOV', `<input type="range" min="55" max="95" step="1" value="${s.cockpitFov}" data-r="fov"><span data-o="fov">${s.cockpitFov}°</span>`),
      this.row('Units', this.seg('units', [['kmh', 'km/h'], ['mph', 'mph']], s.units)),
      this.row('Speedometer in cockpit', this.seg('hudc', [[1, 'Show'], [0, 'Hide']], s.hudInCockpit ? 1 : 0)),
      this.row('Speech bubbles', this.seg('speech', [[1, 'On'], [0, 'Off']], s.showSpeech ? 1 : 0)),
    ].join('')}</div><div>${[
      this.row('Master volume', `<input type="range" min="0" max="1" step="0.05" value="${s.masterVolume}" data-r="master">`),
      this.row('Engine volume', `<input type="range" min="0" max="1.5" step="0.05" value="${s.engineVolume}" data-r="engine">`),
      this.row('Effects volume', `<input type="range" min="0" max="1.5" step="0.05" value="${s.sfxVolume}" data-r="sfx">`),
      this.row('Radio volume', `<input type="range" min="0" max="1" step="0.05" value="${s.radioVolume}" data-r="radio">`),
      this.row('Radio news voice', this.seg('voice', [[1, 'On'], [0, 'Off']], s.newsVoice ? 1 : 0)),
      this.row('Steering assist', this.seg('assist', [[1, 'On'], [0, 'Off']], s.steerAssist ? 1 : 0)),
      this.row('Auto-start engine on throttle', this.seg('autoign', [[1, 'On'], [0, 'Off']], s.autoIgnition ? 1 : 0)),
      this.row('Reset all settings', `<button class="btn small" data-a="reset">Defaults</button>`),
    ].join('')}</div></div>`;
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
    range('res', 'resScale', (v) => `${Math.round(v * 100)}%`, () => g.resize());
    range('fov', 'cockpitFov', (v) => `${v}°`, () => (g.cam.cockpitFov = s.cockpitFov));
    range('master', 'masterVolume');
    range('engine', 'engineVolume');
    range('sfx', 'sfxVolume');
    range('radio', 'radioVolume');
    this.bindSeg(c, 'q', (v) => {
      s.quality = v;
      if (v === 'low') Object.assign(s, { shadows: false, bloom: false, resScale: 0.7, traffic: 14 });
      if (v === 'medium') Object.assign(s, { shadows: true, bloom: true, resScale: 0.85, traffic: 20 });
      if (v === 'high') Object.assign(s, { shadows: true, bloom: true, resScale: 1, traffic: 26 });
      this.applyGraphics();
      this.saveSettings();
      this.settingsRows(c);
    });
    this.bindSeg(c, 'shadows', (v) => {
      s.shadows = v === '1';
      this.applyGraphics();
      this.saveSettings();
    });
    this.bindSeg(c, 'bloom', (v) => {
      s.bloom = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'units', (v) => {
      s.units = v;
      this.saveSettings();
    });
    this.bindSeg(c, 'hudc', (v) => {
      s.hudInCockpit = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'speech', (v) => {
      s.showSpeech = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'voice', (v) => {
      s.newsVoice = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'assist', (v) => {
      s.steerAssist = v === '1';
      this.saveSettings();
    });
    this.bindSeg(c, 'autoign', (v) => {
      s.autoIgnition = v === '1';
      this.saveSettings();
    });
    c.querySelector('[data-a=reset]').onclick = () => {
      Object.assign(s, DEFAULT_SETTINGS);
      this.applyGraphics();
      this.saveSettings();
      this.settingsRows(c);
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
