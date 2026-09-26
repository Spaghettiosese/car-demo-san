import * as THREE from 'three';
import { BODIES, PLAYER_BODIES, ENGINES, TURBOS, PAINT_PRESETS, DEFAULT_CONFIG, configForBody, buildTuning, estimateStats } from '../vehicle/specs.js';
import { buildCarModel } from '../vehicle/carBuilder.js';
import { TIRES } from '../vehicle/tire.js';
import { WHEEL_STYLES } from '../vehicle/wheels.js';
import { save } from '../main.js';
import { VehiclePhysics } from '../vehicle/vehiclePhysics.js';
import { StaticWorld } from '../physics/world.js';
import { clamp, damp } from '../core/util.js';

const $ = (id) => document.getElementById(id);

/** Showroom + customisation UI. */
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
    // back wall with light strips
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
    // studio reflections: bright softboxes around the car
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

  open(from) {
    const g = this.game;
    this.from = from;
    this.cfg = { ...g.carConfig };
    if (from !== 'menu' && g.player.car) this.cfg = { ...g.player.car.cfg };
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
    if (this.model) this.turntable.rotation.y = 0;
    const cam = this.camera;
    cam.aspect = innerWidth / innerHeight;
    cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, 0.9 + Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    cam.lookAt(0, 0.75, 0);
    cam.updateProjectionMatrix();
    this.game.audio?.update?.(dt);
  }

  // ------------------------------------------------------------ UI
  render() {
    const c = this.cfg;
    const b = BODIES[c.body];
    const st = { ...estimateStats(c), ...this.measure(c) };
    const units = this.game.settings.units;
    const tabs = [['body', 'Body'], ['paint', 'Paint'], ['wheels', 'Wheels'], ['engine', 'Engine'], ['handling', 'Handling'], ['extras', 'Extras']];
    this.ui.innerHTML = `
      <div class="gtitle"><div class="n">${b.name}</div><div class="k">${b.kind} · ${ENGINES[c.engine].name}${c.turbo !== 'none' && c.engine !== 'ev' ? ' · ' + TURBOS[c.turbo].name : ''}</div></div>
      <div class="stats">
        <div class="stat"><div class="v">${st.hp}</div><div class="l">hp</div></div>
        <div class="stat"><div class="v">${st.torque}</div><div class="l">Nm</div></div>
        <div class="stat"><div class="v">${st.mass}</div><div class="l">kg</div></div>
        <div class="stat"><div class="v">${st.zeroTo100}s</div><div class="l">0-100 km/h</div></div>
        <div class="stat"><div class="v">${units === 'mph' ? Math.round(st.vmax / 1.609) : st.vmax}</div><div class="l">top ${units === 'mph' ? 'mph' : 'km/h'}</div></div>
        <div class="stat"><div class="v">${c.drivetrain.toUpperCase()}</div><div class="l">drive</div></div>
      </div>
      <div class="gbuttons">
        <button class="btn primary small" data-a="drive">✔ Drive</button>
        <button class="btn small" data-a="reset">Reset</button>
        <button class="btn small" data-a="back">Cancel</button>
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
      this.cfg = { ...configForBody(this.cfg.body, DEFAULT_CONFIG), paint: this.cfg.paint, plate: this.cfg.plate };
      this.changed(true);
    };
    this.bind();
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

  row(l, ctl) {
    return `<div class="row"><label>${l}</label><div class="ctl">${ctl}</div></div>`;
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
        this.row('Accent colour', `<input type="color" value="${c.accent}" data-color="accent">`),
        this.row('Window tint', this.slider('tint', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)),
      ].join('');
    }
    if (this.tab === 'wheels') {
      return [
        this.row('Rim style', this.seg('wheelStyle', Object.entries(WHEEL_STYLES).map(([k, v]) => [k, v.name]))),
        this.row('Rim size', this.seg('wheelSize', [16, 17, 18, 19, 20, 21].map((s) => [s, s + '"']))),
        this.row('Rim colour', `<input type="color" value="${c.wheelColor}" data-color="wheelColor">`),
        `<div class="swatches" style="margin:4px 0 12px">${['#c9ccd1', '#2a2b2e', '#d4af37', '#8a8d93', '#ffffff', '#b01e23', '#1f4fa8', '#ff6a1f'].map((p) => `<div class="swatch" style="background:${p}" data-wheel="${p}"></div>`).join('')}</div>`,
        this.row('Tyres', this.seg('tire', Object.entries(TIRES).map(([k, v]) => [k, v.name]))),
      ].join('');
    }
    if (this.tab === 'engine') {
      const ev = c.engine === 'ev';
      return [
        this.row('Engine', this.seg('engine', Object.entries(ENGINES).map(([k, v]) => [k, v.name.replace('Dual-motor ', '')]))),
        ev ? '' : this.row('Forced induction', this.seg('turbo', [['none', 'Naturally aspirated'], ['small', 'Small turbo'], ['big', 'Big turbo']])),
        this.row('ECU tune', this.seg('tune', [[0, 'Stock'], [1, 'Stage 1'], [2, 'Stage 2'], [3, 'Stage 3']])),
        ev ? '' : this.row('Gearbox', this.seg('gearbox', [['auto', 'Automatic'], ['manual', 'Manual']])),
        this.row('Drivetrain', this.seg('drivetrain', [['fwd', 'FWD'], ['rwd', 'RWD'], ['awd', 'AWD']])),
        this.row('Differential', this.seg('diff', [['open', 'Open'], ['lsd', 'Limited slip'], ['locked', 'Locked']])),
        ev ? '' : this.row('Exhaust', this.seg('exhaust', [['stock', 'Stock'], ['sport', 'Sport'], ['straight', 'Straight pipe']])),
        ev ? '' : this.row('Anti-lag (pops & bangs)', this.seg('antilag', [[false, 'Off'], [true, 'On']])),
      ].join('');
    }
    if (this.tab === 'handling') {
      return [
        this.row('Ride height', this.slider('rideHeight', -0.06, 0.1, 0.01, (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} cm`)),
        this.row('Spring stiffness', this.slider('springs', 0.6, 1.8, 0.05, (v) => `${Math.round(v * 100)}%`)),
        this.row('Damping', this.slider('dampers', 0.6, 1.8, 0.05, (v) => `${Math.round(v * 100)}%`)),
        this.row('Anti-roll bars', this.slider('antiRoll', 0, 2.5, 0.1, (v) => `${Math.round(v * 100)}%`)),
        this.row('Brake bias (front)', this.slider('brakeBias', 0.5, 0.8, 0.01, (v) => `${Math.round(v * 100)}%`)),
        this.row('Weight reduction', this.seg('weightReduction', [[0, 'None'], [1, 'Light'], [2, 'Stripped']])),
        this.row('ABS', this.seg('abs', [[true, 'On'], [false, 'Off']])),
        this.row('Traction control', this.seg('tcs', [[true, 'On'], [false, 'Off']])),
      ].join('');
    }
    return [
      this.row('Spoiler', this.seg('spoiler', [['none', 'None'], ['lip', 'Lip'], ['wing', 'Wing'], ['gt', 'GT wing']])),
      this.row('Underglow', this.seg('underglow', [['none', 'Off'], ['#ff2bd6', 'Pink'], ['#2bb8ff', 'Blue'], ['#39ff6a', 'Green'], ['#ff5a1f', 'Orange'], ['#b04bff', 'Purple']])),
      this.row('Headlights', this.seg('headlights', [['halogen', 'Halogen'], ['xenon', 'Xenon'], ['blue', 'Ice blue'], ['yellow', 'Yellow']])),
      this.row('Horn', this.seg('horn', [['normal', 'Single'], ['dual', 'Dual tone'], ['high', 'High'], ['truck', 'Truck'], ['melody', 'La Cucaracha']]) + ` <button class="btn small" data-a="horn">Test</button>`),
      this.row('Licence plate', `<input type="text" maxlength="8" value="${c.plate}" data-text="plate">`),
    ].join('');
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
    g.carConfig = { ...this.cfg };
    save('sandemo.car', g.carConfig);
    this.close();
    const where = this.from === 'menu' ? null : this.from === 'shop' ? g.city.locations.garage : undefined;
    if (this.from === 'menu') {
      if (g.player.car) g.removeCar(g.player.car);
      g.player.car = null;
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
