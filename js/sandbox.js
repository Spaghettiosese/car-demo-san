import * as THREE from 'three';
import { Car } from './vehicle/car.js';
import { configForBody, DEFAULT_CONFIG } from './vehicle/specs.js';
import { PathDriver, DerbyDriver, FleeDriver } from './ai/racer.js';
import { Driver, randomPlate } from './ai/traffic.js';
import { cityRoute } from './activities/events.js';

function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    /* storage unavailable */
  }
}

const _f = new THREE.Vector3();

export const PRESETS = {
  noon: { name: '☀ Sunny noon', hour: 12.5, weather: 'clear' },
  golden: { name: '🌅 Golden hour', hour: 18.6, weather: 'clear' },
  dawnfog: { name: '🌫 Foggy dawn', hour: 6.3, weather: 'fog' },
  rainnight: { name: '🌧 Rainy night', hour: 23, weather: 'rain' },
  storm: { name: '⛈ Storm', hour: 16, weather: 'storm' },
  snow: { name: '❄ Snow', hour: 10, weather: 'snow' },
  midnight: { name: '🌙 Clear midnight', hour: 0.5, weather: 'clear' },
};

/**
 * Sandbox tools: AI with a chosen behaviour, black ice, a traffic-jam maker,
 * weather/time presets, spectating any NPC, and saved scenarios.
 */
export class Sandbox {
  constructor(game) {
    this.game = game;
    this.ai = [];
    this.ramps = [];
    this.ice = [];
    this.jams = [];
    this.spectating = null;
    this.banner = null;
  }

  ahead(d, side = 0) {
    const car = this.game.player.car;
    car.body.axis(2, _f);
    _f.y = 0;
    _f.normalize();
    return car.body.position.clone().addScaledVector(_f, d).add(new THREE.Vector3(-_f.z, 0, _f.x).multiplyScalar(side));
  }

  makeCar(body, paint) {
    const g = this.game;
    const cfg = { ...configForBody(body, DEFAULT_CONFIG), paint, plate: randomPlate(), livery: 'none' };
    const car = new Car(g, cfg, { npc: true });
    g.addCar(car);
    car.phys.pt.running = true;
    car.phys.pt.setSelector('D');
    car.physicsActive = true;
    return car;
  }

  /** Spawn an AI car near the player with a behaviour: racer, derby, flee or rage. */
  spawnAI(kind) {
    const g = this.game;
    const pc = g.player.car;
    if (!pc) return;
    pc.body.axis(2, _f);
    const yaw = Math.atan2(_f.x, _f.z);
    const p = this.ahead(kind === 'flee' ? 25 : 18, 4);
    const paint = { racer: '#ff2bd6', derby: '#d11f2a', flee: '#2b7a3c', rage: '#101114' }[kind] || '#888';
    const body = { racer: 'coupe', derby: 'pickup', flee: 'muscle', rage: 'sedan' }[kind] || 'sedan';
    const car = this.makeCar(body, paint);
    const gy = g.world.groundAt(p.x, p.z, p.y + 20, { y: 0 }).y;
    car.placeAt(p.x, gy, p.z, yaw);
    let drv;
    if (kind === 'racer') {
      // laps of a downtown circuit, flat out
      const path = cityRoute([[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]);
      drv = new PathDriver(g, car, path, { closed: true, skill: 0.95, aggression: 0.7 });
      // start on the circuit at the point nearest to you, facing along it
      const pp = pc.body.position;
      let i0 = path.reduce((bi, q, i) => (q.distanceToSquared(pp) < path[bi].distanceToSquared(pp) ? i : bi), 0);
      // a little further along so it doesn't spawn on top of you
      while (path[i0].distanceTo(pp) < 14) i0 = (i0 + 1) % path.length;
      const a = path[i0], b = path[(i0 + 2) % path.length];
      car.placeAt(a.x, 0, a.z, Math.atan2(b.x - a.x, b.z - a.z));
      drv.i = i0;
      drv.lapsInfinite = true;
    } else if (kind === 'derby') drv = new DerbyDriver(g, car, [pc, car]);
    else if (kind === 'flee') drv = new FleeDriver(g, car, pc);
    else {
      drv = new Driver(car, g.traffic);
      drv.aggression = 0.95;
      drv.anger = 1;
      const nl = g.city.nearestLane(car.body.position);
      if (nl) drv.placeOnLane(nl.seg, nl.lane, nl.dist);
      g.traffic.drivers.push(drv);
      drv.startRage();
    }
    car.raceName = kind;
    this.ai.push({ car, drv, kind, own: kind !== 'rage' });
    g.toast(`Spawned a ${kind} AI`, 'info', 2);
  }

  /** Slippery black ice on the road ahead. */
  blackIce() {
    const g = this.game;
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let k = 0; k < 4; k++) {
      const p = this.ahead(25 + k * 16, (k % 2 ? 1 : -1) * 1.5);
      const r = 3 + Math.random() * 2.5;
      const gy = g.world.groundAt(p.x, p.z, p.y + 10, { y: 0 }).y;
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, gy + 0.02, p.z);
      g.scene.add(m);
      const sl = g.world.addSlick(p.x, p.z, r, 'ice');
      this.ice.push({ m, sl, x: p.x, z: p.z, r });
    }
    g.toast('❄ Black ice ahead!', 'info', 2);
  }

  /** A breakdown blocking both lanes ahead, with a queue of traffic stacked up behind it. */
  trafficJam() {
    const g = this.game;
    const pc = g.player.car;
    const nl = g.city.nearestLane(pc.body.position, pc.body.axis(2, _f));
    if (!nl) {
      g.toast('Find a city street first', 'warn', 2);
      return;
    }
    const seg = nl.seg;
    const d0 = Math.min(seg.length - 10, nl.dist + 70);
    const blockers = [];
    for (const lane of [0, 1]) {
      const p = g.city.lanePoint(seg, lane, d0);
      const c = this.makeCar(lane ? 'van' : 'sedan', lane ? '#d9d4c7' : '#7a1a1a');
      c.placeAt(p.x, 0, p.z, Math.atan2(seg.dir.x, seg.dir.z) + (lane ? 0.25 : -0.2));
      c.sys.hazard = true;
      c.sys.ignition = 'acc';
      c.phys.pt.running = false;
      c.parked = true;
      c.body.sleeping = true;
      blockers.push(c);
    }
    // the queue
    let n = 0;
    for (let k = 1; k <= 6; k++)
      for (const lane of [0, 1]) {
        const d = d0 - k * 8.5;
        if (d < 4) continue;
        const p = g.city.lanePoint(seg, lane, d);
        if (pc.body.position.distanceTo(p) < 6) continue;
        const c = this.makeCar(['sedan', 'hatch', 'suv'][(k + lane) % 3], ['#e8e8ea', '#1f4fa8', '#6b6f76', '#101114'][(k * 2 + lane) % 4]);
        c.placeAt(p.x, 0, p.z, Math.atan2(seg.dir.x, seg.dir.z));
        const drv = new Driver(c, g.traffic);
        drv.setPersona('normal');
        drv.placeOnLane(seg, lane, d);
        g.traffic.drivers.push(drv);
        n++;
      }
    this.jams.push({ blockers, t: 75 });
    g.toast(`🚗🚗🚗 Traffic jam: a breakdown and ${n} cars stuck behind it (clears in 75 s)`, 'info', 3);
  }

  preset(key) {
    const g = this.game;
    const p = PRESETS[key];
    if (!p) return;
    g.env.setTime(p.hour);
    g.env.setWeather(p.weather);
    g.settings.startWeather = p.weather;
    g.toast(p.name, 'info', 2);
  }

  // ------------------------------------------------------------ spectating
  spectate(next = 1) {
    const g = this.game;
    const list = g.cars.filter((c) => !c.removed && c !== g.player.car && c.controller && c.body.position.distanceTo(g.player.focus) < 400);
    if (!list.length) {
      g.toast('No NPC cars nearby', 'warn', 2);
      return;
    }
    list.sort((a, b) => a.body.position.distanceToSquared(g.player.focus) - b.body.position.distanceToSquared(g.player.focus));
    const i = this.spectating ? list.indexOf(this.spectating) : -1;
    this.spectating = list[(i + next + list.length) % list.length];
    g.cam.car = this.spectating;
    if (g.cam.interior || g.cam.mode === 'free') g.cam.setMode('chase');
    g.cam.initialized = false;
    if (!this.banner) {
      this.banner = document.createElement('div');
      this.banner.id = 'spectate';
      document.getElementById('hud').appendChild(this.banner);
    }
    this.banner.classList.remove('hidden');
  }

  stopSpectate() {
    const g = this.game;
    this.spectating = null;
    g.cam.car = g.player.car;
    g.cam.initialized = false;
    if (this.banner) this.banner.classList.add('hidden');
  }

  // ------------------------------------------------------------ scenarios
  saveScenario(slot) {
    const g = this.game;
    const pc = g.player.car;
    if (!pc) return;
    const sc = {
      v: 1,
      saved: new Date().toISOString(),
      car: { ...pc.cfg },
      pos: pc.body.position.toArray(),
      yaw: Math.atan2(pc.body.R[2], pc.body.R[8]),
      hour: g.env.hour,
      weather: g.env.weather,
      traffic: g.settings.traffic,
      cops: g.settings.cops,
      ramps: this.ramps,
      ice: this.ice.map((i) => [i.x, i.z, i.r]),
      ai: this.ai.filter((a) => !a.car.removed).map((a) => ({ kind: a.kind, pos: a.car.body.position.toArray(), yaw: Math.atan2(a.car.body.R[2], a.car.body.R[8]) })),
    };
    save(`sandemo.scenario.${slot}`, sc);
    g.toast(`💾 Scenario ${slot} saved`, 'good', 2);
  }

  static listScenarios() {
    return [1, 2, 3].map((k) => {
      try {
        const s = JSON.parse(localStorage.getItem(`sandemo.scenario.${k}`));
        return s ? { slot: k, saved: s.saved, car: s.car.body } : { slot: k };
      } catch (e) {
        return { slot: k };
      }
    });
  }

  loadScenario(slot) {
    const g = this.game;
    let sc = null;
    try {
      sc = JSON.parse(localStorage.getItem(`sandemo.scenario.${slot}`));
    } catch (e) {
      sc = null;
    }
    if (!sc) {
      g.toast(`Scenario ${slot} is empty`, 'warn', 2);
      return;
    }
    this.clear();
    g.police?.clearAll?.();
    g.settings.traffic = sc.traffic;
    g.settings.cops = sc.cops;
    g.traffic?.setDensity(sc.traffic);
    g.env.setTime(sc.hour);
    g.env.setWeather(sc.weather);
    g.carConfig = { ...sc.car };
    g.spawnPlayer(g.carConfig, { pos: new THREE.Vector3(...sc.pos), yaw: sc.yaw });
    for (const r of sc.ramps || []) this.addRamp(...r);
    for (const [x, z, r] of sc.ice || []) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.02, transparent: true, opacity: 0.32, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, g.world.groundAt(x, z, 30, { y: 0 }).y + 0.02, z);
      g.scene.add(m);
      this.ice.push({ m, sl: g.world.addSlick(x, z, r, 'ice'), x, z, r });
    }
    for (const a of sc.ai || []) {
      this.spawnAI(a.kind);
      const last = this.ai[this.ai.length - 1];
      if (last) last.car.placeAt(a.pos[0], a.pos[1] - 0.6, a.pos[2], a.yaw);
    }
    g.toast(`📂 Scenario ${slot} loaded`, 'good', 2);
  }

  addRamp(x, z, yaw, w, l, h0, h1, mat) {
    this.game.city.ramp(x, z, yaw, w, l, h0, h1, mat);
    this.ramps.push([x, z, yaw, w, l, h0, h1, mat]);
  }

  clear() {
    const g = this.game;
    for (const a of this.ai) {
      if (!a.car.removed) g.removeCar(a.car);
      if (!a.own) {
        const i = g.traffic.drivers.indexOf(a.drv);
        if (i >= 0) g.traffic.drivers.splice(i, 1);
      }
    }
    this.ai.length = 0;
    for (const i of this.ice) {
      g.scene.remove(i.m);
      const k = g.world.slicks.indexOf(i.sl);
      if (k >= 0) g.world.slicks.splice(k, 1);
    }
    this.ice.length = 0;
    for (const j of this.jams) for (const b of j.blockers) if (!b.removed) g.removeCar(b);
    this.jams.length = 0;
    this.stopSpectate();
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    for (let i = this.ai.length - 1; i >= 0; i--) {
      const a = this.ai[i];
      if (a.car.removed || a.car.body.position.distanceTo(g.player.focus) > 450) {
        if (!a.car.removed) g.removeCar(a.car);
        this.ai.splice(i, 1);
        continue;
      }
      if (a.own) a.drv.update(dt);
      if (a.kind === 'racer' && a.drv.finished) a.drv.finished = false;
    }
    for (let i = this.jams.length - 1; i >= 0; i--) {
      const j = this.jams[i];
      j.t -= dt;
      if (j.t <= 0) {
        // the tow trucks finally showed up
        for (const b of j.blockers) if (!b.removed) g.removeCar(b);
        this.jams.splice(i, 1);
        g.toast('The jam is clearing', 'info', 2);
      }
    }
    const s = this.spectating;
    if (s) {
      if (s.removed) return this.stopSpectate();
      g.cam.car = s;
      const d = s.controller;
      const what = d?.persona ? `${d.persona} · ${d.state}` : d?.constructor?.name?.replace('Driver', '').toLowerCase() || 'parked';
      const html = `👁 Spectating <b>${s.model.prof.b.name}</b> (${s.cfg.plate}) · ${what} · ${g.fmtSpeed(s.speed)} &nbsp; <kbd>[</kbd> <kbd>]</kbd> next · <kbd>F</kbd> back to your car`;
      if (html !== this.bannerHtml) this.banner.innerHTML = this.bannerHtml = html;
      if (g.input.pressed('lookLeft')) this.spectate(-1);
      if (g.input.pressed('lookRight')) this.spectate(1);
    }
  }
}
