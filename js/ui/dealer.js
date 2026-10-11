import * as THREE from 'three';
import { BODIES, ENGINES, DEFAULT_CONFIG, configForBody, estimateStats } from '../vehicle/specs.js';
import { CAR_PRICES, fmtMoney } from '../career/economy.js';
import { Car } from '../vehicle/car.js';
import { DEALER } from '../world/terrain.js';
import { signTexture } from '../world/textures.js';
import { randomPlate } from '../ai/traffic.js';

const PAINTS = ['#b01e23', '#e8e8ea', '#101114', '#1f4fa8', '#f2b90c', '#2b7a3c', '#6b6f76', '#ff6a13'];

/** San Demo Motors: the lot on the coastal flats, the showroom UI, test drives. */
export class Dealer {
  constructor(game) {
    this.game = game;
    this.lot = DEALER;
    this.pos = new THREE.Vector3(262, 0, 377);
    this.display = [];
    this.testDrive = null;
    this.build();
  }

  get catalogue() {
    return Object.entries(CAR_PRICES).filter(([k]) => BODIES[k]).sort((a, b) => a[1].price - b[1].price);
  }

  build() {
    const g = this.game;
    const L = this.lot;
    const scene = g.scene;
    const group = new THREE.Group();
    scene.add(group);
    // forecourt (a flat zone in the terrain)
    const y = 0;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(L.x1 - L.x0, L.z1 - L.z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa9a7a2, roughness: 0.85 }));
    pad.position.set((L.x0 + L.x1) / 2, 0.005, (L.z0 + L.z1) / 2);
    pad.receiveShadow = true;
    group.add(pad);
    // painted bays
    const white = new THREE.MeshBasicMaterial({ color: 0xf0f0f0 });
    for (let k = 0; k < 7; k++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 6).rotateX(-Math.PI / 2), white);
      line.position.set(L.x0 + 30 + k * 7.5, y + 0.01, L.z1 - 9);
      group.add(line);
    }
    // glass showroom
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fb4c8, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.45 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.4, metalness: 0.7 });
    const sx0 = L.x0 + 26, sx1 = L.x1 - 4, sz0 = L.z0 + 2, sz1 = L.z0 + 22;
    const box = new THREE.Mesh(new THREE.BoxGeometry(sx1 - sx0, 7, sz1 - sz0), glass);
    box.position.set((sx0 + sx1) / 2, y + 3.5, (sz0 + sz1) / 2);
    group.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(sx1 - sx0 + 2, 0.6, sz1 - sz0 + 2), frame);
    roof.position.set((sx0 + sx1) / 2, y + 7.3, (sz0 + sz1) / 2);
    roof.castShadow = true;
    group.add(roof);
    for (const x of [sx0, (sx0 + sx1) / 2, sx1])
      for (const z of [sz0, sz1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), frame);
        col.position.set(x, y + 3.5, z);
        group.add(col);
      }
    g.world.addBox(sx0, 0, sz0, sx1, 7.6, sz1, { kind: 'building' });
    const signTex = signTexture('SAN DEMO MOTORS', '#7a1010');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.4), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.3 }));
    sign.position.set((sx0 + sx1) / 2, y + 8.6, sz1 + 1.05);
    group.add(sign);
    g.city.nightMats.push({ mat: sign.material, min: 0.3, max: 1.3 });
    // bunting flags strung across the lot
    const flagGeo = new THREE.ConeGeometry(0.25, 0.5, 3);
    const flagCols = [0xff3b30, 0xffcc00, 0x34c759, 0x007aff];
    for (let i = 0; i < 24; i++) {
      const f = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: flagCols[i % 4] }));
      const t = i / 23;
      f.position.set(L.x0 + 2 + t * (L.x1 - L.x0 - 4), y + 5.5 - Math.sin(t * Math.PI) * 1.2, L.z1 - 1);
      f.rotation.z = Math.PI;
      group.add(f);
    }
    this.group = group;
    g.city.locations.dealer = { pos: this.pos.clone(), yaw: Math.PI / 2, name: 'San Demo Motors' };
    // display cars in front of the showroom (one per model, parked)
    const cat = this.catalogue;
    cat.slice(0, 8).forEach(([body], i) => {
      const cfg = { ...configForBody(body, DEFAULT_CONFIG), paint: PAINTS[i % PAINTS.length], plate: 'FOR SALE', finish: 'metallic' };
      const c = new Car(g, cfg, { npc: true });
      g.addCar(c);
      const x = L.x0 + 33.75 + (i % 7) * 7.5, z = L.z1 - 9;
      if (i >= 7) c.placeAt(L.x0 + 12, y, L.z0 + 14, 0.5);
      else c.placeAt(x, y, z, Math.PI);
      c.parked = true;
      c.dealer = body;
      c.sys.headlights = 0;
      c.body.sleeping = true;
      this.display.push(c);
    });
  }

  /** In the lot, slowly: offer to go inside. */
  zone(car, input) {
    const L = this.lot;
    const p = car.body.position;
    if (p.x < L.x0 || p.x > L.x1 || p.z < L.z0 || p.z > L.z1) return null;
    if (this.testDrive) return '<kbd>Enter</kbd> Return the test-drive car';
    if (car.speed > 2) return null;
    return '<kbd>Enter</kbd> San Demo Motors — buy, sell &amp; test drive';
  }

  // ------------------------------------------------------------ showroom UI (uses the garage studio)
  open() {
    const g = this.game;
    if (this.testDrive) return this.endTestDrive(false);
    const gar = g.garage;
    this.idx = this.idx || 0;
    this.paint = this.paint || 0;
    gar.from = 'dealer';
    g.state = 'garage';
    g.hud.show(false);
    g.input.unlock();
    gar.ui.classList.remove('hidden');
    this.show();
  }

  current() {
    const [body, info] = this.catalogue[this.idx];
    return { body, info, cfg: { ...configForBody(body, DEFAULT_CONFIG), paint: PAINTS[this.paint], plate: randomPlate(), finish: 'metallic' } };
  }

  show() {
    const g = this.game;
    const gar = g.garage;
    const ca = g.career;
    const { body, info, cfg } = this.current();
    const b = BODIES[body];
    gar.cfg = cfg;
    gar.rebuild();
    const st = { ...estimateStats(cfg), ...gar.measure(cfg) };
    const owned = ca ? ca.p.garage.filter((e) => e.cfg.body === body).length : 0;
    const locked = ca && info.level > ca.level;
    const afford = ca ? ca.money >= info.price : true;
    const deposit = Math.round(info.price * 0.2);
    const canFinance = ca && !locked && !afford && ca.money >= deposit && ca.loanLimit() - ca.debt >= info.price - deposit;
    gar.ui.innerHTML = `
      <div class="gtitle"><div class="n">${b.name}</div><div class="k">${b.kind} · ${ENGINES[cfg.engine].name} · ${cfg.drivetrain.toUpperCase()}</div>
        <div class="k" style="font-size:26px;font-weight:800;color:${locked ? '#ff8a7a' : '#8fe39a'};margin-top:10px">${fmtMoney(info.price)}${locked ? ` · 🔒 Level ${info.level}` : ''}</div>
        ${ca ? `<div class="k">You have ${fmtMoney(ca.money)}${owned ? ` · you own ${owned}` : ''}</div>` : ''}</div>
      <div class="stats">
        <div class="stat"><div class="v">${st.hp}</div><div class="l">hp</div></div>
        <div class="stat"><div class="v">${st.torque}</div><div class="l">Nm</div></div>
        <div class="stat"><div class="v">${st.mass}</div><div class="l">kg</div></div>
        <div class="stat"><div class="v">${st.zeroTo100}s</div><div class="l">0-100 km/h</div></div>
        <div class="stat"><div class="v">${st.vmax}</div><div class="l">top km/h</div></div>
      </div>
      <div class="gbuttons">
        <button class="btn small" data-d="prev">◀</button>
        <button class="btn small" data-d="next">▶</button>
        <button class="btn small" data-d="paint">🎨 Colour</button>
        ${ca ? `<button class="btn small primary" data-d="buy" ${locked || !afford ? 'disabled' : ''}>Buy · ${fmtMoney(info.price)}</button>` : ''}
        ${canFinance ? `<button class="btn small" data-d="finance">Finance · ${fmtMoney(deposit)} down</button>` : ''}
        <button class="btn small" data-d="test" ${locked ? 'disabled' : ''}>Test drive</button>
        <button class="btn small" data-d="leave">Leave</button>
      </div>
      <div class="gpanel">
        <div class="tabs"><div class="tab active">Showroom</div></div>
        <div class="gcontent">
          ${this.catalogue.map(([k, v], i) => `<button class="btn ${i === this.idx ? 'primary' : ''}" data-pick="${i}"><b>${BODIES[k].name}</b> <span style="float:right">${fmtMoney(v.price)}</span><br><span style="font-size:12px;opacity:0.75">${BODIES[k].kind}${ca && v.level > ca.level ? ` · 🔒 LV ${v.level}` : ''}</span></button>`).join('')}
          ${ca ? `<h3 style="margin:16px 0 6px">Sell a car</h3>${ca.p.garage.map((e) => `<div class="carrow"><div><b>${BODIES[e.cfg.body]?.name}</b> <span class="plate">${e.cfg.plate}</span><br><span class="note">${Math.round((e.odometer || 0) / 1000)} km · offer ${fmtMoney(Math.round(ca.value(e) * 0.6 / 50) * 50)}</span></div>${e.id === ca.p.current || ca.p.garage.length < 2 ? '<span class="note">in use</span>' : `<button class="btn small" data-sell="${e.id}">Sell</button>`}</div>`).join('')}` : '<p class="note">Free Roam: test-drive anything. Buying needs a Career.</p>'}
        </div>
      </div>`;
    const q = (s) => gar.ui.querySelector(s);
    q('[data-d=prev]').onclick = () => {
      this.idx = (this.idx + this.catalogue.length - 1) % this.catalogue.length;
      this.show();
    };
    q('[data-d=next]').onclick = () => {
      this.idx = (this.idx + 1) % this.catalogue.length;
      this.show();
    };
    q('[data-d=paint]').onclick = () => {
      this.paint = (this.paint + 1) % PAINTS.length;
      this.show();
    };
    gar.ui.querySelectorAll('[data-pick]').forEach((el) => (el.onclick = () => {
      this.idx = +el.dataset.pick;
      this.show();
    }));
    gar.ui.querySelectorAll('[data-sell]').forEach((el) => (el.onclick = () => {
      const got = ca.sellCar(el.dataset.sell);
      if (got) g.toast(`Sold for ${fmtMoney(got)}`, 'good');
      this.show();
    }));
    const buy = q('[data-d=buy]');
    if (buy) buy.onclick = () => this.buy(cfg, info.price, false);
    const fin = q('[data-d=finance]');
    if (fin) fin.onclick = () => this.buy(cfg, info.price, true);
    q('[data-d=test]').onclick = () => this.startTestDrive(cfg);
    q('[data-d=leave]').onclick = () => this.close();
    g.audio?.click?.();
  }

  buy(cfg, price, finance) {
    const g = this.game;
    const ca = g.career;
    if (finance) {
      const deposit = Math.round(price * 0.2);
      ca.borrow(price - deposit);
    }
    const e = ca.buyCar(cfg, price);
    if (!e) {
      g.toast('Not enough money', 'warn');
      return;
    }
    g.toast(`You bought the ${BODIES[cfg.body].name}! It's waiting on the lot.`, 'good', 4);
    ca.message('San Demo Motors', `Congratulations on your new ${BODIES[cfg.body].name}! ${finance ? 'Your finance repayments start tomorrow.' : ''} Drive safe.`);
    if (g.player.car) ca.storeCar(g.player.car);
    ca.p.current = e.id;
    this.close(false);
    g.spawnCareerCar(e, { pos: new THREE.Vector3(this.lot.x0 + 10, 0, this.lot.z1 - 6), yaw: Math.PI / 2 });
  }

  close(back = true) {
    const g = this.game;
    g.garage.close();
    g.state = 'play';
    g.hud.show(true);
    void back;
  }

  // ------------------------------------------------------------ test drives
  startTestDrive(cfg) {
    const g = this.game;
    const ca = g.career;
    if (ca && g.player.car) ca.storeCar(g.player.car);
    this.testDrive = { t: 150, prevCfg: g.player.car ? { ...g.player.car.cfg } : null };
    this.close(false);
    const car = g.spawnPlayer(cfg, { pos: new THREE.Vector3(this.lot.x0 + 10, 0, this.lot.z1 - 6), yaw: Math.PI / 2 });
    car.testDrive = true;
    car.phys.pt.refill(1);
    g.toast('Test drive: 2:30 on the clock. Bring it back to the lot in one piece.', 'info', 5);
  }

  update(dt) {
    const td = this.testDrive;
    const g = this.game;
    if (!td) return;
    td.t -= dt;
    const m = Math.max(0, Math.floor(td.t / 60)), s = Math.max(0, Math.floor(td.t % 60));
    g.hud.objective({ title: 'TEST DRIVE', big: `${m}:${String(s).padStart(2, '0')}`, text: 'Return to San Demo Motors (Enter in the lot).' });
    g.hud.navArrow(this.pos, 'Dealer');
    if (td.t <= 0) this.endTestDrive(true);
  }

  endTestDrive(late) {
    const g = this.game;
    const ca = g.career;
    const car = g.player.car;
    let bill = 0;
    if (car && ca) {
      const d = car.damageSummary();
      bill = Math.round((d.body * 6000 + d.engine * 4000 + (late ? 300 : 0)) / 10) * 10;
      if (bill > 0) ca.charge(bill, 'Test drive damage', false, true);
    }
    this.testDrive = null;
    g.hud.objective(null);
    g.hud.navArrow(null);
    const where = { pos: new THREE.Vector3(this.lot.x0 + 10, 0, this.lot.z1 - 6), yaw: Math.PI / 2 };
    if (ca) g.spawnCareerCar(ca.car, where);
    else g.spawnPlayer(g.carConfig, where);
    g.toast(bill ? `Test drive over. Damage &amp; late fees: ${fmtMoney(bill)}` : 'Thanks for the test drive!', bill ? 'warn' : 'good', 4);
  }
}
