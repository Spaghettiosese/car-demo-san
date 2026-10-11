import * as THREE from 'three';
import { BODIES, PLAYER_BODIES, ENGINES, TURBOS, PAINT_PRESETS, DEFAULT_CONFIG, configForBody, buildTuning, estimateStats } from '../vehicle/specs.js';
import { buildCarModel } from '../vehicle/carBuilder.js';
import { TIRES } from '../vehicle/tire.js';
import { WHEEL_STYLES } from '../vehicle/wheels.js';
import { save } from '../main.js';
import { VehiclePhysics } from '../vehicle/vehiclePhysics.js';
import { StaticWorld } from '../physics/world.js';
import { clamp, table } from '../core/util.js';
import { upgradeCost, fmtMoney, partLevel } from '../career/economy.js';

const $ = (id) => document.getElementById(id);
const TUNING_KEYS = ['tirePressure', 'camber', 'toe', 'finalMul', 'gearSpacing', 'lsdPreload', 'boost', 'brakeBias', 'springs', 'dampers', 'antiRoll', 'rideHeight', 'abs', 'tcs'];
const TYRE_PRICES = { street: 120, sport: 220, slick: 380, offroad: 250 };

/** Showroom + customisation UI (free in Free Roam, priced in Career). */
export class Garage {
  constructor(game) {
    this.game = game;
    this.ui = $('garage-ui');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
    this.yaw = 0.7;
    this.pitch = 0.18;
    this.dist = 8;
    this.tab = 'body';
    this.model = null;
    this.buildStudio();
    this.ui.addEventListener('mousedown', (e) => e.stopPropagation());
    const canvas = document.getElementById('view');
    canvas.addEventListener('mousedown', (e) => {
      if (this.game.state === 'garage') this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => (this.drag = null));
    window.addEventListener('mousemove', (e) => {
      if (!this.drag || this.game.state !== 'garage') return;
      this.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.pitch = clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, 0.02, 0.9);
      this.drag = { x: e.clientX, y: e.clientY };
      this.idle = 0;
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.game.state === 'garage') this.dist = clamp(this.dist + Math.sign(e.deltaY) * 0.6, 4.5, 14);
    });
  }

  buildStudio() {
    const s = this.scene;
    s.background = new THREE.Color(0x0c0e11);
    s.fog = new THREE.Fog(0x0c0e11, 18, 40);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x121417, roughness: 0.55, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    this.turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.4, metalness: 0.6 }));
    this.turntable.position.y = 0.04;
    this.turntable.receiveShadow = true;
    s.add(this.turntable);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.65, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.4) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    s.add(ring);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 12, 64, 1, true, Math.PI * 0.6, Math.PI * 0.8), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.9, side: THREE.BackSide }));
    wall.position.y = 6;
    s.add(wall);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.62 + i * (Math.PI * 0.76 / 6);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.4) }));
      strip.position.set(Math.sin(a) * 15.8, 5, Math.cos(a) * 15.8);
      strip.lookAt(0, 5, 0);
      s.add(strip);
    }
    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x202020, 0.6));
    const key = new THREE.SpotLight(0xffffff, 520, 40, 0.55, 0.7, 2);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    s.add(key);
    const rim = new THREE.SpotLight(0xa8c8ff, 500, 40, 0.6, 0.7, 2);
    rim.position.set(-7, 6, -6);
    s.add(rim);
    const fill = new THREE.PointLight(0xffd2a8, 60, 20, 2);
    fill.position.set(-4, 2.5, 5);
    s.add(fill);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x101216);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const box = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3.2), side: THREE.DoubleSide }));
      box.position.set(Math.cos(a) * 10, 5, Math.sin(a) * 10);
      box.lookAt(0, 0, 0);
      envScene.add(box);
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), side: THREE.DoubleSide }));
    top.position.y = 9;
    top.rotation.x = Math.PI / 2;
    envScene.add(top);
    const pm = new THREE.PMREMGenerator(this.game.renderer);
    s.environment = pm.fromScene(envScene, 0.03).texture;
  }

  get career() {
    return this.game.career;
  }

  open(from) {
    const g = this.game;
    this.from = from;
    if (g.tutorial?.active) g.tutorial.sawGarage = true;
    const live = from !== 'menu' && g.player.car;
    if (this.career) {
      this.entry = this.career.car;
      this.cfg = { ...(live ? g.player.car.cfg : this.entry.cfg) };
      this.tab = from === 'shop' ? 'service' : 'paint';
    } else {
      this.entry = null;
      this.cfg = { ...(live ? g.player.car.cfg : g.carConfig) };
      this.tab = from === 'shop' ? 'service' : 'body';
    }
    this.cfg = { ...DEFAULT_CONFIG, ...this.cfg };
    this.original = { ...this.cfg };
    g.state = 'garage';
    g.hud.show(false);
    g.input.unlock();
    this.ui.classList.remove('hidden');
    this.rebuild();
    this.render();
    g.audio?.resume?.();
  }

  close() {
    this.ui.classList.add('hidden');
    this.ui.innerHTML = '';
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model = null;
    }
  }

  rebuild() {
    if (this.model) this.scene.remove(this.model.root);
    const t = buildTuning(this.cfg);
    const m = buildCarModel(this.cfg, t, {});
    m.root.position.set(0, t.com.y + 0.08 + this.cfg.rideHeight, 0);
    m.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    t.wheels.forEach((w, i) => {
      m.wheels[i].group.position.set(w.center.x - t.com.x, w.center.y - t.com.y - this.cfg.rideHeight, w.center.z - t.com.z);
    });
    for (const l of m.lights.head) l.mat.emissiveIntensity = 2.5;
    for (const l of m.lights.tail) l.mat.emissiveIntensity = 1.2;
    if (m.details.driver) m.details.driver.visible = false;
    this.scene.add(m.root);
    this.model = m;
    this.tuning = t;
  }

  update(dt) {
    this.idle = (this.idle || 0) + dt;
    if (this.idle > 3 && !this.drag) this.yaw += dt * 0.15;
    const cam = this.camera;
    cam.aspect = innerWidth / innerHeight;
    cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, 0.9 + Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    cam.lookAt(0, 0.75, 0);
    cam.updateProjectionMatrix();
    // underglow modes preview
    const ug = this.model?.details.underglow;
    if (ug) {
      const t = performance.now() / 1000;
      if (this.cfg.underglowMode === 'pulse') ug.material.opacity = 0.45 + 0.45 * Math.sin(t * 3);
      else if (this.cfg.underglowMode === 'rainbow') ug.material.color.setHSL((t * 0.15) % 1, 1, 0.55);
    }
    this.game.audio?.update?.(dt);
  }

  // ------------------------------------------------------------ pricing
  quote() {
    if (!this.career) return { items: [], total: 0, level: 1 };
    return upgradeCost(this.original, this.cfg, this.entry.parts);
  }

  // ------------------------------------------------------------ UI
  render() {
    const c = this.cfg;
    const b = BODIES[c.body];
    const st = { ...estimateStats(c), ...this.measure(c) };
    const units = this.game.settings.units;
    const ca = this.career;
    const q = this.quote();
    const tooHigh = ca ? q.items.filter((i) => i.level > ca.level) : [];
    const broke = ca && q.total > ca.money;
    const tabs = [
      ['service', 'Service'],
      ...(ca ? [['cars', 'My cars']] : [['body', 'Body']]),
      ['paint', 'Paint'], ['wheels', 'Wheels'], ['engine', 'Engine'], ['tuning', 'Tuning'], ['kit', 'Body kit'], ['interior', 'Interior'], ['extras', 'Extras'], ['setups', 'Setups'], ['dyno', 'Dyno'],
    ];
    const live = this.from !== 'menu' && this.game.player.car;
    const entry = this.entry;
    this.ui.innerHTML = `
      <div class="gtitle"><div class="n">${b.name}</div><div class="k">${b.kind} · ${ENGINES[c.engine].name}${c.turbo !== 'none' && c.engine !== 'ev' ? ' · ' + TURBOS[c.turbo].name : ''}${entry ? ` · ${Math.round((entry.odometer || 0) / 1000 + (live ? live.ext.odo : 0)).toLocaleString()} km` : ''}</div>
        ${ca ? `<div class="k" style="color:#8fe39a;font-weight:700;margin-top:8px">${fmtMoney(ca.money)} · Level ${ca.level}</div>` : ''}</div>
      <div class="stats">
        <div class="stat"><div class="v">${st.hp}</div><div class="l">hp</div></div>
        <div class="stat"><div class="v">${st.torque}</div><div class="l">Nm</div></div>
        <div class="stat"><div class="v">${st.mass}</div><div class="l">kg</div></div>
        <div class="stat"><div class="v">${st.zeroTo100}s</div><div class="l">0-100 km/h</div></div>
        <div class="stat"><div class="v">${units === 'mph' ? Math.round(st.vmax / 1.609) : st.vmax}</div><div class="l">top ${units === 'mph' ? 'mph' : 'km/h'}</div></div>
        <div class="stat"><div class="v">${c.drivetrain.toUpperCase()}</div><div class="l">drive</div></div>
      </div>
      ${ca && q.items.length ? `<div class="gquote"><div class="h">Order</div>${q.items.map((i) => `<div class="li ${i.level > ca.level ? 'lock' : ''}"><span>${i.name}${i.level > ca.level ? ` 🔒 LV ${i.level}` : ''}</span><b>${fmtMoney(i.price)}</b></div>`).join('')}<div class="li tot"><span>Total</span><b>${fmtMoney(q.total)}</b></div></div>` : ''}
      <div class="gbuttons">
        <button class="btn primary small" data-a="drive" ${tooHigh.length || broke ? 'disabled' : ''}>${ca ? (q.total ? `✔ Buy & fit · ${fmtMoney(q.total)}` : '✔ Done') : '✔ Drive'}</button>
        <button class="btn small" data-a="reset">${ca ? 'Undo changes' : 'Reset'}</button>
        <button class="btn small" data-a="back">${ca ? 'Leave' : 'Cancel'}</button>
        ${tooHigh.length ? '<span class="warn">Level too low for some parts</span>' : broke ? '<span class="warn">Not enough money</span>' : ''}
      </div>
      <div class="gpanel">
        <div class="tabs">${tabs.map(([k, n]) => `<div class="tab ${k === this.tab ? 'active' : ''}" data-tab="${k}">${n}</div>`).join('')}</div>
        <div class="gcontent">${this.tabHtml()}</div>
      </div>`;
    this.ui.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => {
      this.tab = t.dataset.tab;
      this.render();
    }));
    this.ui.querySelector('[data-a=drive]').onclick = () => this.apply();
    this.ui.querySelector('[data-a=back]').onclick = () => this.cancel();
    this.ui.querySelector('[data-a=reset]').onclick = () => {
      if (ca) this.cfg = { ...this.original };
      else this.cfg = { ...configForBody(this.cfg.body, DEFAULT_CONFIG), paint: this.cfg.paint, plate: this.cfg.plate };
      this.changed(true);
    };
    this.bind();
    if (this.tab === 'dyno') this.drawDyno();
  }

  /** Run the real physics on a flat test track for honest 0-100 and top speed numbers. */
  measure(cfg) {
    const key = JSON.stringify(cfg);
    this.measured ||= new Map();
    if (this.measured.has(key)) return this.measured.get(key);
    const world = (this.testWorld ||= new StaticWorld());
    const v = new VehiclePhysics(buildTuning(cfg));
    v.resetTo(0, 0, 0, 0);
    v.pt.running = true;
    v.pt.setSelector('D');
    v.pt.auto = true;
    v.pt.omega = 90;
    if (v.pt.ev) v.pt.gear = 1;
    const g = new THREE.Vector3(0, -9.81, 0);
    const dt = 1 / 120;
    let t100 = null, last = 0, vmax = 0;
    for (let i = 0; i < 120 * 70; i++) {
      v.input.throttle = 1;
      v.step(dt, world, g);
      v.body.integratePosition(dt);
      const kmh = v.speed * 3.6;
      if (t100 === null && kmh >= 100) t100 = i * dt;
      if (i % 240 === 0) {
        if (i > 1200 && kmh - last < 0.4) break;
        last = kmh;
      }
      vmax = Math.max(vmax, kmh);
    }
    const r = { zeroTo100: t100 ? t100.toFixed(1) : '—', vmax: Math.round(vmax) };
    this.measured.set(key, r);
    return r;
  }

  row(l, ctl, note = '') {
    return `<div class="row"><label>${l}${note ? `<br><span class="note">${note}</span>` : ''}</label><div class="ctl">${ctl}</div></div>`;
  }
  seg(key, opts) {
    return `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(this.cfg[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }
  slider(key, min, max, step, fmt) {
    (this.fmts ||= {})[key] = fmt;
    return `<input type="range" min="${min}" max="${max}" step="${step}" value="${this.cfg[key]}" data-key="${key}"><span data-out="${key}">${fmt(this.cfg[key])}</span>`;
  }
  tabHtml() {
    const c = this.cfg;
    const ca = this.career;
    if (this.tab === 'service') return this.serviceHtml();
    if (this.tab === 'cars') return this.carsHtml();
    if (this.tab === 'body') {
      return PLAYER_BODIES.map((id) => {
        const b = BODIES[id];
        return `<button class="btn ${c.body === id ? 'primary' : ''}" data-body="${id}"><b>${b.name}</b><br><span style="font-size:12px;opacity:0.75">${b.kind} · ${ENGINES[b.defaults.engine].name} · ${b.defaults.drivetrain.toUpperCase()}</span></button>`;
      }).join('');
    }
    if (this.tab === 'paint') {
      return [
        this.row('Colour', `<input type="color" value="${c.paint}" data-color="paint">`),
        `<div class="swatches" style="margin:8px 0 12px">${PAINT_PRESETS.map((p) => `<div class="swatch ${p === c.paint ? 'on' : ''}" style="background:${p}" data-paint="${p}"></div>`).join('')}</div>`,
        this.row('Finish', this.seg('finish', [['gloss', 'Gloss'], ['metallic', 'Metallic'], ['pearl', 'Pearl'], ['matte', 'Matte'], ['chrome', 'Chrome']])),
        this.row('Livery', this.seg('livery', [['none', 'None'], ['stripes', 'Racing stripes'], ['side', 'Side stripe'], ['twotone', 'Two-tone'], ['checker', 'Checker'], ['flames', 'Flames'], ['racing', 'Race number'], ['police', 'Police'], ['taxi', 'Taxi']])),
        this.row('Two-tone paint', this.seg('twoTone', [['none', 'Off'], ['roof', 'Contrast roof'], ['lower', 'Contrast lower body']])),
        this.row('Accent colour', `<input type="color" value="${c.accent}" data-color="accent">`, 'stripes, two-tone, kits'),
        this.row('Race number decal', `<input type="text" maxlength="3" value="${c.raceNumber || ''}" data-text="raceNumber" placeholder="none">`),
        this.row('Window tint', this.slider('tint', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)),
        this.row('Smoked tail lights', this.seg('smokedTails', [[false, 'Off'], [true, 'Smoked']])),
        ca ? `<p class="note">Paint work is billed as one job by the paint shop. The order panel shows the live price.</p>` : '',
      ].join('');
    }
    if (this.tab === 'wheels') {
      return [
        this.row('Rim style', this.seg('wheelStyle', Object.entries(WHEEL_STYLES).map(([k, v]) => [k, v.name]))),
        this.row('Rim size', this.seg('wheelSize', [16, 17, 18, 19, 20, 21].map((s) => [s, s + '"']))),
        this.row('Rim colour', `<input type="color" value="${c.wheelColor}" data-color="wheelColor">`),
        `<div class="swatches" style="margin:4px 0 12px">${['#c9ccd1', '#2a2b2e', '#d4af37', '#8a8d93', '#ffffff', '#b01e23', '#1f4fa8', '#ff6a1f'].map((p) => `<div class="swatch" style="background:${p}" data-wheel="${p}"></div>`).join('')}</div>`,
        this.row('Tyres', this.seg('tire', Object.entries(TIRES).map(([k, v]) => [k, v.name]))),
        this.row('Tyre width', this.seg('tireWidth', [[-1, 'Narrow'], [0, 'Stock'], [1, 'Wide']]), 'wide: more grip, more drag'),
        this.row('Wheel spacers', this.seg('wheelOffset', [[0, 'None'], [0.015, '15 mm'], [0.03, '30 mm']]), 'wider track, more stable'),
        this.row('Brake calipers', `<input type="color" value="${c.caliperColor || '#c0392b'}" data-color="caliperColor">`),
      ].join('');
    }
    if (this.tab === 'engine') {
      const ev = c.engine === 'ev';
      return [
        this.row('Engine', this.seg('engine', Object.entries(ENGINES).map(([k, v]) => [k, v.name.replace('Dual-motor ', '')]))),
        ev ? '' : this.row('Forced induction', this.seg('turbo', [['none', 'Naturally aspirated'], ['small', 'Small turbo'], ['big', 'Big turbo']])),
        ev || c.turbo === 'none' ? '' : this.row('Boost controller', this.slider('boost', 0.6, 1.35, 0.05, (v) => `${Math.round(v * 100)}%`), 'more boost, more lag'),
        this.row('ECU tune', this.seg('tune', [[0, 'Stock'], [1, 'Stage 1'], [2, 'Stage 2'], [3, 'Stage 3']])),
        ev ? '' : this.row('Gearbox', this.seg('gearbox', [['auto', 'Automatic'], ['manual', 'Manual']])),
        this.row('Drivetrain', this.seg('drivetrain', [['fwd', 'FWD'], ['rwd', 'RWD'], ['awd', 'AWD']])),
        this.row('Differential', this.seg('diff', [['open', 'Open'], ['lsd', 'Limited slip'], ['locked', 'Locked']])),
        ev ? '' : this.row('Exhaust', this.seg('exhaust', [['stock', 'Stock'], ['sport', 'Sport'], ['straight', 'Straight pipe']])),
        ev ? '' : this.row('Exhaust tips', this.seg('exhaustTip', [['round', 'Round'], ['dual', 'Dual'], ['quad', 'Quad'], ['square', 'Square']])),
        ev ? '' : this.row('Anti-lag (pops & bangs)', this.seg('antilag', [[false, 'Off'], [true, 'On']])),
        this.row('Big brake kit', this.seg('brakeKit', [[false, 'Stock'], [true, 'Fitted']]), '+22% brake torque, less fade'),
      ].join('');
    }
    if (this.tab === 'tuning') {
      return [
        `<p class="note">Tyre pressure is free to change. Alignment, final drive, gear set and LSD changes need the part or service once.</p>`,
        this.row('Tyre pressure', this.slider('tirePressure', 1.6, 3.0, 0.05, (v) => `${v.toFixed(2)} bar`), 'low: grip &amp; heat · high: less rolling drag'),
        this.row('Camber', this.slider('camber', -4, 1, 0.1, (v) => `${v.toFixed(1)}°`), 'negative: more cornering grip'),
        this.row('Toe', this.slider('toe', -0.5, 0.5, 0.05, (v) => `${v > 0 ? 'in ' : v < 0 ? 'out ' : ''}${Math.abs(v).toFixed(2)}°`), 'out: sharper turn-in · in: stability'),
        this.row('Final drive', this.slider('finalMul', 0.82, 1.25, 0.01, (v) => `${v < 1 ? 'longer ' : v > 1 ? 'shorter ' : ''}${v.toFixed(2)}×`), 'short: acceleration · long: top speed'),
        c.engine === 'ev' ? '' : this.row('Gear spacing', this.slider('gearSpacing', 0.7, 1.25, 0.01, (v) => `${v < 1 ? 'close ' : v > 1 ? 'wide ' : ''}${v.toFixed(2)}`)),
        c.diff === 'lsd' ? this.row('LSD preload', this.slider('lsdPreload', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`), 'more lock: traction, more push') : '',
        this.row('Ride height', this.slider('rideHeight', -0.06, 0.1, 0.01, (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} cm`)),
        this.row('Spring stiffness', this.slider('springs', 0.6, 1.8, 0.05, (v) => `${Math.round(v * 100)}%`)),
        this.row('Damping', this.slider('dampers', 0.6, 1.8, 0.05, (v) => `${Math.round(v * 100)}%`)),
        this.row('Anti-roll bars', this.slider('antiRoll', 0, 2.5, 0.1, (v) => `${Math.round(v * 100)}%`)),
        this.row('Brake bias (front)', this.slider('brakeBias', 0.5, 0.8, 0.01, (v) => `${Math.round(v * 100)}%`)),
        this.row('Weight reduction', this.seg('weightReduction', [[0, 'None'], [1, 'Light'], [2, 'Stripped']])),
        this.row('ABS', this.seg('abs', [[true, 'On'], [false, 'Off']])),
        this.row('Traction &amp; stability control', this.seg('tcs', [[true, 'On'], [false, 'Off']])),
      ].join('');
    }
    if (this.tab === 'kit') {
      return [
        this.row('Body kit', this.seg('bodyKit', [['stock', 'Stock'], ['sport', 'Sport'], ['aero', 'Aero']]), 'splitter, skirts, diffuser: downforce'),
        this.row('Spoiler', this.seg('spoiler', [['none', 'None'], ['lip', 'Lip'], ['wing', 'Wing'], ['gt', 'GT wing']])),
        this.row('Hood scoop', this.seg('hoodScoop', [[false, 'Off'], [true, 'Fitted']])),
        this.row('Fender flares', this.seg('flares', [[false, 'Off'], [true, 'Fitted']]), 'wider track'),
      ].join('');
    }
    if (this.tab === 'interior') {
      return [
        this.row('Steering wheel', this.seg('wheelStyleInterior', [['stock', 'Stock'], ['sport', 'Suede sport'], ['classic', 'Wood classic']])),
        this.row('Seats', this.seg('seats', [['stock', 'Comfort'], ['bucket', 'Bucket seats']]), 'buckets save 15 kg'),
        this.row('Gauges', this.seg('gauges', [['analog', 'Analog'], ['digital', 'Digital']])),
        this.row('Interior colour', `<input type="color" value="${c.interiorColor || '#2b2521'}" data-color="interiorColor">`),
        this.row('Roll cage', this.seg('rollCage', [[false, 'None'], [true, 'Welded-in cage']]), '+35 kg, much stiffer cabin in crashes'),
      ].join('');
    }
    if (this.tab === 'setups') {
      const list = ca ? this.entry.setups || [] : (this.freeSetups ||= this.loadFreeSetups());
      return `<p class="note">Save the tuning values (pressures, alignment, gearing, suspension, brakes) under a name and switch between them.</p>
        <div class="row"><label>Name</label><div class="ctl"><input type="text" maxlength="18" placeholder="e.g. Canyon" data-setup-name><button class="btn small primary" data-a="saveSetup">Save current</button></div></div>
        ${list.length ? list.map((s, i) => `<div class="row"><label>${s.name}</label><div class="ctl"><button class="btn small" data-load-setup="${i}">Load</button><button class="btn small" data-del-setup="${i}">Delete</button></div></div>`).join('') : '<p class="note">No saved setups yet.</p>'}`;
    }
    if (this.tab === 'dyno') {
      return `<p class="note">Engine output at the crank across the rev range (boost and tune included).</p><canvas id="dyno" width="360" height="230" style="width:100%;background:#0b0e12;border-radius:10px"></canvas><div id="dyno-peak" class="note"></div>`;
    }
    return [
      this.row('Underglow', this.seg('underglow', [['none', 'Off'], ['#ff2bd6', 'Pink'], ['#2bb8ff', 'Blue'], ['#39ff6a', 'Green'], ['#ff5a1f', 'Orange'], ['#b04bff', 'Purple']])),
      c.underglow !== 'none' ? this.row('Underglow mode', this.seg('underglowMode', [['steady', 'Steady'], ['pulse', 'Pulse'], ['rainbow', 'Rainbow']])) : '',
      this.row('Headlights', this.seg('headlights', [['halogen', 'Halogen'], ['xenon', 'Xenon'], ['blue', 'Ice blue'], ['yellow', 'Yellow']])),
      this.row('Horn', this.seg('horn', [['normal', 'Single'], ['dual', 'Dual tone'], ['high', 'High'], ['truck', 'Truck'], ['melody', 'La Cucaracha']]) + ` <button class="btn small" data-a="horn">Test</button>`),
      this.row('Licence plate', `<input type="text" maxlength="8" value="${c.plate}" data-text="plate">`),
    ].join('');
  }

  // ------------------------------------------------------------ service & cars
  serviceHtml() {
    const g = this.game;
    const car = g.player.car;
    if (!car || this.from === 'menu') return '<p class="note">Bring the car to San Demo Customs for service.</p>';
    const ca = this.career;
    const pt = car.phys.pt;
    const dmg = car.damageSummary();
    const quote = ca ? ca.repairQuote(car) : { full: 0, pay: 0, covered: 0 };
    const worn = car.phys.wheels.map((w) => Math.round(w.wear * 100));
    const tyre = TYRE_PRICES[car.cfg.tire] || 150;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const due = car.ext.odo > car.ext.serviceAt;
    const free = !ca;
    return `
      <div class="svc">
        <div class="sv"><span>Body</span><b>${pct(1 - dmg.body)}</b></div>
        <div class="sv"><span>Engine</span><b>${pct(pt.health)}</b></div>
        <div class="sv"><span>Oil</span><b>${pct(pt.oil)}</b></div>
        <div class="sv"><span>Coolant</span><b>${pct(pt.coolant)}</b></div>
        <div class="sv"><span>Battery</span><b>${pct(car.ext.battery)}</b></div>
        <div class="sv"><span>Tyres worn</span><b>${worn.join('/')}%</b></div>
      </div>
      ${this.row('Full repair', `<button class="btn small primary" data-svc="repair">${free ? 'Repair (free)' : quote.full ? `Repair · ${fmtMoney(quote.pay)}` : 'Nothing to fix'}</button>`, ca && quote.covered ? `insurance pays ${fmtMoney(quote.covered)}` : ca && !ca.p.insurance.active ? 'no insurance (buy cover in the pause menu)' : '')}
      ${this.row('Oil change &amp; fluids', `<button class="btn small" data-svc="oil">${free ? 'Service' : fmtMoney(80)}</button>`, due ? '<b style="color:#ffb020">service due</b>' : `next at ${Math.round(car.ext.serviceAt)} km`)}
      ${this.row(`New tyres (${TIRES[car.cfg.tire]?.name || ''})`, `<button class="btn small" data-svc="tyres">${free ? 'Fit new' : fmtMoney(tyre * 4)}</button>`)}
      ${this.row('Battery charge', `<button class="btn small" data-svc="battery">${free ? 'Charge' : fmtMoney(40)}</button>`)}
      ${this.row('Wash &amp; wax', `<button class="btn small" data-svc="wash">${free ? 'Wash' : fmtMoney(25)}</button>`, `dirt ${pct(car.ext.dirt)}`)}`;
  }

  carsHtml() {
    const ca = this.career;
    const g = this.game;
    return `<p class="note">Your cars. Switching swaps the car out here at the shop.</p>${ca.p.garage.map((e) => {
      const cur = e.id === ca.p.current;
      const km = Math.round((e.odometer || 0) / 1000 + (cur && g.player.car ? g.player.car.ext.odo : 0));
      const cond = Math.round((e.engine ?? 1) * 100);
      return `<div class="carrow ${cur ? 'cur' : ''}"><div><b>${BODIES[e.cfg.body]?.name || e.cfg.body}</b> <span class="plate">${e.cfg.plate}</span><br><span class="note">${km.toLocaleString()} km · engine ${cond}% · worth ${fmtMoney(ca.value(e))}</span></div>
        ${cur ? '<span class="note">driving</span>' : `<button class="btn small" data-switch="${e.id}">Drive</button>`}</div>`;
    }).join('')}<p class="note">Buy and sell cars at San Demo Motors (on the map).</p>`;
  }

  service(kind) {
    const g = this.game;
    const car = g.player.car;
    const ca = this.career;
    const pay = (amount, label) => {
      if (!ca) return true;
      if (ca.charge(amount, label)) return true;
      g.toast('Not enough money', 'warn');
      return false;
    };
    if (kind === 'repair') {
      const q = ca ? ca.repairQuote(car) : { pay: 0, covered: 0, full: 0 };
      if (ca && !q.full) return;
      if (!pay(q.pay, 'Repairs')) return;
      if (ca && q.covered) ca.claim();
      car.repair({ keepTyres: true });
      g.audio?.repair?.();
    } else if (kind === 'oil') {
      if (!pay(80, 'Oil service')) return;
      car.ext.service();
    } else if (kind === 'tyres') {
      if (!pay((TYRE_PRICES[car.cfg.tire] || 150) * 4, 'New tyres')) return;
      for (const w of car.phys.wheels) {
        w.wear = 0;
        w.flat = 0;
        w.temp = 38;
      }
    } else if (kind === 'battery') {
      if (!pay(40, 'Battery charge')) return;
      car.ext.battery = 1;
    } else if (kind === 'wash') {
      if (!pay(25, 'Car wash')) return;
      car.ext.wash();
    }
    g.toast('Done', 'good', 1.2);
    ca?.save();
    this.render();
  }

  switchCar(id) {
    const g = this.game;
    const ca = this.career;
    const e = ca.p.garage.find((x) => x.id === id);
    if (!e) return;
    if (g.player.car) ca.storeCar(g.player.car);
    ca.p.current = id;
    this.close();
    g.spawnCareerCar(e, g.city.locations.garage);
    g.state = 'play';
    g.hud.show(true);
    g.toast(`Now driving the ${BODIES[e.cfg.body]?.name || e.cfg.body}`, 'good');
    ca.save();
  }

  // ------------------------------------------------------------ setups & dyno
  loadFreeSetups() {
    try {
      return JSON.parse(localStorage.getItem('sandemo.setups') || '[]');
    } catch (e) {
      return [];
    }
  }
  saveSetup(name) {
    const s = { name: name || `Setup ${Date.now() % 1000}`, values: Object.fromEntries(TUNING_KEYS.map((k) => [k, this.cfg[k]])) };
    if (this.career) (this.entry.setups ||= []).push(s);
    else {
      this.freeSetups.push(s);
      try {
        localStorage.setItem('sandemo.setups', JSON.stringify(this.freeSetups));
      } catch (e) {
        /* ignore */
      }
    }
    this.career?.save();
    this.render();
  }
  setupList() {
    return this.career ? this.entry.setups || [] : this.freeSetups || [];
  }

  drawDyno() {
    const cv = document.getElementById('dyno');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const t = buildTuning(this.cfg);
    const p = t.powertrain;
    const W = cv.width, H = cv.height, pad = 30;
    ctx.clearRect(0, 0, W, H);
    const maxR = p.type === 'ev' ? p.maxRPM : p.limiter;
    const pts = [];
    let maxT = 0, maxP = 0, pkT = 0, pkP = 0, pkTr = 0, pkPr = 0;
    for (let r = 800; r <= maxR; r += 100) {
      let tq;
      if (p.type === 'ev') tq = Math.min(p.maxTorque, p.maxPower / ((r * 2 * Math.PI) / 60));
      else {
        tq = table(p.torque, r);
        if (p.turbo) tq *= 1 + p.turbo.gain * clamp((r - p.turbo.spoolStart) / (p.turbo.spoolFull - p.turbo.spoolStart), 0, 1);
      }
      tq *= p.tune;
      const hp = (tq * r * 2 * Math.PI) / 60 / 745.7;
      pts.push([r, tq, hp]);
      if (tq > maxT) [maxT, pkT, pkTr] = [tq, tq, r];
      if (hp > maxP) [maxP, pkP, pkPr] = [hp, hp, r];
    }
    const top = Math.max(maxT, maxP) * 1.12;
    const X = (r) => pad + ((r - 800) / (maxR - 800)) * (W - pad * 1.5);
    const Y = (v) => H - pad - (v / top) * (H - pad * 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#7f8a96';
    ctx.font = '11px sans-serif';
    for (let r = 1000; r <= maxR; r += p.type === 'ev' ? 4000 : 1000) {
      ctx.beginPath();
      ctx.moveTo(X(r), Y(0));
      ctx.lineTo(X(r), Y(top));
      ctx.stroke();
      ctx.fillText(String(r / 1000) + 'k', X(r) - 6, H - 10);
    }
    const plot = (idx, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[idx])) : ctx.moveTo(X(q[0]), Y(q[idx]))));
      ctx.stroke();
    };
    plot(1, '#37c8ff');
    plot(2, '#ff6a1f');
    ctx.fillStyle = '#37c8ff';
    ctx.fillText('Torque (Nm)', pad, 16);
    ctx.fillStyle = '#ff6a1f';
    ctx.fillText('Power (hp)', pad + 90, 16);
    const peak = document.getElementById('dyno-peak');
    if (peak) peak.textContent = `Peak ${Math.round(pkP)} hp @ ${pkPr} rpm · ${Math.round(pkT)} Nm @ ${pkTr} rpm`;
  }

  bind() {
    const ui = this.ui;
    ui.querySelectorAll('[data-body]').forEach((b) => (b.onclick = () => {
      const keep = { paint: this.cfg.paint, finish: this.cfg.finish, plate: this.cfg.plate, wheelStyle: this.cfg.wheelStyle, wheelColor: this.cfg.wheelColor, horn: this.cfg.horn };
      this.cfg = { ...configForBody(b.dataset.body, this.cfg), ...keep };
      this.changed(true);
    }));
    ui.querySelectorAll('.seg[data-key]').forEach((s) => {
      s.querySelectorAll('button').forEach((btn) => (btn.onclick = () => {
        const key = s.dataset.key;
        let v = btn.dataset.v;
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (!isNaN(+v) && key !== 'underglow' && v !== '') v = +v;
        this.cfg[key] = v;
        if (key === 'engine' && v === 'ev') this.cfg.turbo = 'none';
        this.changed(true);
      }));
    });
    ui.querySelectorAll('input[type=range][data-key]').forEach((r) => {
      r.oninput = () => {
        this.cfg[r.dataset.key] = parseFloat(r.value);
        const o = ui.querySelector(`[data-out=${r.dataset.key}]`);
        if (o && this.fmts[r.dataset.key]) o.textContent = this.fmts[r.dataset.key](parseFloat(r.value));
        this.changed(false);
      };
      r.onchange = () => this.changed(true);
    });
    ui.querySelectorAll('input[type=color]').forEach((i) => {
      i.oninput = () => {
        this.cfg[i.dataset.color] = i.value;
        this.changed(false);
      };
      i.onchange = () => this.changed(true);
    });
    ui.querySelectorAll('[data-paint]').forEach((s) => (s.onclick = () => {
      this.cfg.paint = s.dataset.paint;
      this.changed(true);
    }));
    ui.querySelectorAll('[data-wheel]').forEach((s) => (s.onclick = () => {
      this.cfg.wheelColor = s.dataset.wheel;
      this.changed(true);
    }));
    ui.querySelectorAll('[data-text]').forEach((i) => {
      i.oninput = () => {
        this.cfg[i.dataset.text] = i.value.toUpperCase();
      };
      i.onchange = () => this.changed(true);
    });
    ui.querySelectorAll('[data-svc]').forEach((b) => (b.onclick = () => this.service(b.dataset.svc)));
    ui.querySelectorAll('[data-switch]').forEach((b) => (b.onclick = () => this.switchCar(b.dataset.switch)));
    const ss = ui.querySelector('[data-a=saveSetup]');
    if (ss) ss.onclick = () => this.saveSetup(ui.querySelector('[data-setup-name]').value.trim());
    ui.querySelectorAll('[data-load-setup]').forEach((b) => (b.onclick = () => {
      const s = this.setupList()[+b.dataset.loadSetup];
      if (s) Object.assign(this.cfg, s.values);
      this.changed(true);
    }));
    ui.querySelectorAll('[data-del-setup]').forEach((b) => (b.onclick = () => {
      this.setupList().splice(+b.dataset.delSetup, 1);
      if (!this.career) {
        try {
          localStorage.setItem('sandemo.setups', JSON.stringify(this.freeSetups));
        } catch (e) {
          /* ignore */
        }
      } else this.career.save();
      this.render();
    }));
    const horn = ui.querySelector('[data-a=horn]');
    if (horn) horn.onclick = () => this.testHorn();
  }

  changed(rebuildUi) {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuild(), rebuildUi ? 0 : 120);
    if (rebuildUi) this.render();
    this.game.audio?.click?.();
  }

  testHorn() {
    const a = this.game.audio;
    if (!a || !a.ready) return;
    const h = a.makeHorn(this.cfg.horn, a.sfxBus);
    const t = a.ctx.currentTime;
    h.g.gain.setValueAtTime(0.12, t);
    if (this.cfg.horn === 'melody') {
      const seq = [392, 392, 392, 523, 659];
      seq.forEach((f, i) => h.oscs[0].frequency.setValueAtTime(f, t + i * 0.14));
      h.g.gain.setValueAtTime(0, t + 0.75);
    } else h.g.gain.setValueAtTime(0, t + 0.6);
    h.oscs.forEach((o) => o.stop(t + 1));
  }

  apply() {
    const g = this.game;
    const ca = this.career;
    if (ca) {
      const q = this.quote();
      if (q.items.some((i) => i.level > ca.level) || q.total > ca.money) return;
      if (q.total) {
        ca.charge(q.total, 'Customs: parts & paint');
        ca.p.stats.partsBought += q.items.length;
      }
      for (const i of q.items) if (i.key !== 'paint' && !this.entry.parts.includes(i.key)) this.entry.parts.push(i.key);
      const changed = JSON.stringify(this.cfg) !== JSON.stringify(this.original);
      const repainted = this.cfg.paint !== this.original.paint || this.cfg.livery !== this.original.livery;
      this.entry.cfg = { ...this.cfg };
      this.close();
      if (repainted) g.police?.onRespray?.();
      if (changed && g.player.car) {
        ca.storeCar(g.player.car);
        this.entry.cfg = { ...this.cfg };
        g.spawnCareerCar(this.entry, this.from === 'shop' ? g.city.locations.garage : undefined);
        g.toast(q.total ? `Fitted · ${fmtMoney(q.total)}` : 'Setup applied', 'good');
      }
      ca.save();
      g.state = 'play';
      g.hud.show(true);
      return;
    }
    const repainted = g.carConfig && (this.cfg.paint !== g.carConfig.paint || this.cfg.livery !== g.carConfig.livery);
    g.carConfig = { ...this.cfg };
    save('sandemo.car', g.carConfig);
    this.close();
    if (repainted && this.from !== 'menu') g.police?.onRespray?.();
    const where = this.from === 'menu' ? null : this.from === 'shop' ? g.city.locations.garage : undefined;
    if (this.from === 'menu') {
      if (g.player.car) g.removeCar(g.player.car);
      g.player.car = null;
      g.mode = 'free';
      g.spawnPlayer(g.carConfig);
      g.startDriving();
    } else {
      g.spawnPlayer(g.carConfig, where);
      g.state = 'play';
      g.hud.show(true);
      g.toast('Enjoy your new ride!', 'good');
    }
  }

  cancel() {
    const g = this.game;
    this.close();
    if (this.from === 'menu') g.menus?.openMain();
    else {
      g.state = 'play';
      g.hud.show(true);
    }
  }
}
