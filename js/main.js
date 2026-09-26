import * as THREE from 'three';
import { Input } from './input.js';
import { StaticWorld } from './physics/world.js';
import { PhysicsSystem } from './physics/physicsSystem.js';
import { City, CITY } from './world/city.js';
import { Props } from './world/props.js';
import { Environment } from './world/environment.js';
import { FX } from './fx/particles.js';
import { Skidmarks } from './fx/skidmarks.js';
import { DebrisSystem } from './fx/debris.js';
import { Car } from './vehicle/car.js';
import { DEFAULT_CONFIG, configForBody } from './vehicle/specs.js';
import { paintLivery } from './vehicle/carBuilder.js';
import { CameraRig, CAMERA_MODES } from './camera.js';
import { PlayerDriver } from './player.js';
import { HUD } from './ui/hud.js';
import { clamp, lerp, KMH } from './core/util.js';

export const DEFAULT_SETTINGS = {
  quality: 'high',
  resScale: 1,
  shadows: true,
  bloom: true,
  traffic: 26,
  parked: 18,
  cops: true,
  copAggression: 1,
  damage: 1,
  slowmo: true,
  units: 'kmh',
  sensitivity: 1,
  steerAssist: true,
  autoIgnition: true,
  hudInCockpit: false,
  cockpitFov: 72,
  masterVolume: 0.8,
  engineVolume: 1,
  sfxVolume: 1,
  radioVolume: 0.55,
  timeScale: 1,
  startHour: 16.5,
  startWeather: 'clear',
  showSpeech: true,
  newsVoice: true,
  invertY: false,
};

function load(key, def) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ? { ...def, ...v } : { ...def };
  } catch (e) {
    return { ...def };
  }
}
export function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    /* storage unavailable */
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  constructor() {
    this.settings = load('sandemo.settings', DEFAULT_SETTINGS);
    this.carConfig = load('sandemo.car', DEFAULT_CONFIG);
    this.state = 'loading';
    this.cars = [];
    this.timeScale = 1;
    this.slowmoTimer = 0;
    this.fps = 60;
    this.player = { mode: 'car', car: null, focus: new THREE.Vector3(), heading: 0, onFoot: null };
    this.gps = null;
    this.stats = { crashes: 0, topSpeed: 0, distance: 0, fines: 0, bestDrag: null };
  }

  async init(progress = () => {}) {
    const canvas = document.getElementById('view');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.settings.resScale);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.settings.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 3500);
    this.scene.add(this.camera);
    this.input = new Input(canvas);
    progress(0.1, 'Surveying the city…');
    await tick();

    this.world = new StaticWorld();
    this.env = new Environment(renderer, this.scene);
    this.env.setTime(this.settings.startHour);
    this.env.setWeather(this.settings.startWeather);
    this.env.timeScale = (1 / 60) * this.settings.timeScale;
    this.city = new City(this.scene, this.world).build();
    progress(0.35, 'Planting trees and lamp posts…');
    await tick();
    this.fx = new FX(this.scene);
    this.fx.groundAt = (x, z, y) => this.world.groundAt(x, z, y + 0.5, { y: 0 }).y;
    this.skids = new Skidmarks(this.scene);
    this.debris = new DebrisSystem(this.scene, this.world);
    this.debris.onHit = (it, v) => this.audio?.debrisHit?.(it, v);
    this.props = new Props(this, this.city);
    this.props.build();
    this.physics = new PhysicsSystem(this.world);
    this.physics.props = this.props;
    this.physics.debris = this.debris;
    progress(0.55, 'Tuning engines…');
    await tick();

    this.cam = new CameraRig(this.camera, this);
    this.driver = new PlayerDriver(this);
    this.hud = new HUD(this);
    await this.initOptional(progress);
    this.spawnPlayer(this.carConfig);
    progress(0.95, 'Warming up tyres…');
    await tick();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // warm up shader compilation
    this.renderer.compile(this.scene, this.camera);
    this.last = performance.now();
    this.state = 'menu';
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /** Systems that are loaded if present (audio, AI, cockpit, menus, post). */
  async initOptional(progress) {
    const tryImport = async (path) => {
      try {
        return await import(path);
      } catch (e) {
        console.error('Failed to load', path, e);
        return null;
      }
    };
    const post = await tryImport('./post.js');
    if (post) this.post = new post.PostFX(this.renderer, this.scene, this.camera, this.settings);
    const audio = await tryImport('./audio/audio.js');
    if (audio) this.audio = new audio.AudioEngine(this);
    progress(0.65, 'Teaching drivers the road rules…');
    const traffic = await tryImport('./ai/traffic.js');
    if (traffic) this.traffic = new traffic.TrafficManager(this);
    const police = await tryImport('./ai/police.js');
    if (police) this.police = new police.PoliceManager(this);
    const interior = await tryImport('./vehicle/interior.js');
    if (interior) this.interiorModule = interior;
    const foot = await tryImport('./onfoot.js');
    if (foot) this.onFoot = new foot.OnFoot(this);
    progress(0.8, 'Polishing the showroom…');
    const garage = await tryImport('./ui/garage.js');
    if (garage) this.garage = new garage.Garage(this);
    const menus = await tryImport('./ui/menus.js');
    if (menus) this.menus = new menus.Menus(this);
    const gps = await tryImport('./ai/gps.js');
    if (gps) this.gpsModule = gps;
    if (this.traffic) this.traffic.init();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.settings.resScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.fx.setScale(h * this.renderer.getPixelRatio() * 0.9);
  }

  // ------------------------------------------------------------ player
  spawnPlayer(cfg, where) {
    const old = this.player.car;
    let pos, yaw;
    if (old && !where) {
      pos = old.body.position.clone();
      yaw = Math.atan2(old.body.R[2], old.body.R[8]);
    }
    if (old) this.removeCar(old);
    const car = new Car(this, cfg, { player: true });
    car.isPlayer = true;
    car.sys.seatbelt = false;
    this.scene.add(car.root);
    if (where) {
      pos = where.pos;
      yaw = where.yaw;
    }
    if (!pos) {
      // start on Main St heading toward downtown, engine off
      const s = this.city.segments.find((sg) => sg.from.i === 1 && sg.from.j === 3 && sg.to.i === 2 && sg.to.j === 3);
      pos = this.city.lanePoint(s, 1, 30);
      yaw = Math.atan2(s.dir.x, s.dir.z);
    }
    const g = this.world.groundAt(pos.x, pos.z, 5, { y: 0 });
    car.placeAt(pos.x, g.y, pos.z, yaw);
    this.cars.unshift(car);
    this.player.car = car;
    this.player.mode = 'car';
    this.cam.car = car;
    if (this.interiorModule) this.interior = new this.interiorModule.Interior(this, car);
    this.audio?.setPlayerCar?.(car);
    car.sys.headlights = this.env.night > 0.3 ? 2 : 0;
    return car;
  }

  addCar(car) {
    this.scene.add(car.root);
    this.cars.push(car);
  }

  removeCar(car) {
    car.removed = true;
    car.dispose();
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    this.audio?.removeCar?.(car);
    if (this.interior && this.interior.car === car) {
      this.interior.dispose();
      this.interior = null;
    }
  }

  toast(text, kind, time) {
    this.hud.toast(text, kind, time);
  }

  repaintLivery(car) {
    const l = car.model.livery;
    if (!l) return;
    paintLivery(l.ctx, l.W, l.H, car.cfg, car.model.prof);
    l.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ events from cars/physics
  onImpact(car, p, n, dv, other, kind) {
    const isPlayer = car === this.player.car;
    if (dv > 2.5) {
      if (kind === 'car' || kind === 'building' || kind === 'wall' || kind === 'pillar' || kind === 'signal' || kind === 'lamp' || kind === 'ground') {
        if (dv > 4) this.fx.sparks(p, n, car.body.velocity, Math.min(40, dv * 2));
      }
      if (kind === 'building' || kind === 'wall') this.fx.impactDust(p, Math.min(2, dv / 8));
      if (!(other && other.id < car.id)) this.audio?.impact?.(p, dv, kind, car);
    }
    if (isPlayer) {
      this.cam.addShake(Math.min(1.2, dv * 0.045));
      if (dv > 6) this.hud.hurt(Math.min(0.9, dv / 25));
      if (dv > 5) this.stats.crashes++;
      if (dv > 16 && this.settings.slowmo && this.slowmoTimer <= 0) this.startSlowmo(1.6);
      this.interior?.onImpact?.(dv, p);
      if (dv > 12 && !car.sys.seatbelt) this.cam.addShake(0.8);
    }
    if (other && other.isPlayer && dv > 1.5) car.controller?.onHitByPlayer?.(dv);
    if (car.isPlayer && other && dv > 1.5) other.controller?.onHitByPlayer?.(dv);
    this.police?.onImpact?.(car, other, dv, kind);
  }

  onPartEvent(car, part, what) {
    if (car !== this.player.car) {
      if (what === 'detached' || what === 'wheelOff') this.audio?.clunk?.(car, 0.8);
      return;
    }
    const names = { hood: 'Hood', trunk: 'Trunk', doorFL: 'Driver door', doorFR: 'Passenger door', doorRL: 'Rear door', doorRR: 'Rear door', bumperF: 'Front bumper', bumperR: 'Rear bumper' };
    if (what === 'detached' && part) this.toast(`${names[part.name] || part.name} fell off`, 'warn');
    if (what === 'loose' && part && part.name === 'hood') this.toast('Hood latch broken', 'warn');
    if (what === 'wheelOff') this.toast('You lost a wheel!', 'warn');
    if (what === 'engineDead') this.toast('Engine destroyed. <kbd>Backspace</kbd> to repair', 'warn', 5);
    this.audio?.clunk?.(car, 1);
  }

  onGlass(car, part, lp, shattered) {
    this.audio?.glass?.(car, shattered ? 1 : 0.35);
    if (car === this.player.car) this.interior?.onGlass?.(part, lp, shattered);
  }

  onPropHit(item, speed, point) {
    this.audio?.propHit?.(item, speed, point);
    this.police?.onPropHit?.(item);
  }

  onWiperCycle(car) {
    if (car === this.player.car) this.audio?.wiper?.();
  }

  startSlowmo(t) {
    this.slowmoTimer = t;
  }

  // ------------------------------------------------------------ main loop
  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 1 / 20);
    this.fps = lerp(this.fps, 1 / dt, 0.05);
    try {
      this.update(dt);
      this.render(dt);
    } catch (e) {
      console.error(e);
      if (!this._errShown) {
        this._errShown = true;
        this.hud?.toast('Error: ' + e.message, 'warn', 8);
      }
    }
    this.input.endFrame();
  }

  update(dt) {
    const input = this.input;
    input.poll();
    this.menus?.update?.(dt);
    if (this.state === 'menu') {
      this.menuBackground(dt);
      return;
    }
    if (this.state === 'garage') {
      this.garage?.update(dt);
      return;
    }
    if (this.state === 'pause' || this.state === 'map') {
      if (this.state === 'map') this.hud.drawFullMap(document.getElementById('map-canvas'), this.player.focus, this.player.heading);
      if (input.pressed('pause') || (this.state === 'map' && input.pressed('map'))) this.menus?.closeAll();
      return;
    }
    if (this.state !== 'play') return;
    this.handleGlobalKeys();

    // slow motion
    let sim = dt;
    if (this.slowmoTimer > 0) {
      this.slowmoTimer -= dt;
      this.timeScale = lerp(this.timeScale, 0.22, 0.2);
    } else this.timeScale = lerp(this.timeScale, this.manualSlowmo ? 0.3 : 1, 0.1);
    sim *= this.timeScale;

    const pc = this.player.car;
    if (this.player.mode === 'car' && pc) {
      this.driver.update(pc, dt, input);
      this.carKeys(pc);
    } else if (this.player.mode === 'foot' && pc) {
      // abandoned car: nobody at the wheel
      pc.phys.input.throttle = 0;
      pc.phys.input.steer *= 0.9;
    }
    this.traffic?.update(sim);
    this.police?.update(sim);
    this.physics.step(sim, this.cars);
    for (const c of this.cars) c.processImpacts(sim);
    for (const c of this.cars) {
      if (c.physicsActive) c.update(sim, this.physics.time);
      else c.syncVisual(sim, this.physics.time);
    }
    if (this.player.mode === 'foot') this.onFoot?.update(sim, input);
    this.debris.update(sim);
    this.city.update(sim);
    this.props.update(sim, this.camera.position);
    this.carEffects(sim);
    this.fx.update(sim);
    this.skids.update();

    // focus & environment
    if (this.player.mode === 'car' && pc) {
      this.player.focus.copy(pc.body.position);
      this.player.heading = Math.atan2(pc.body.R[2], pc.body.R[8]);
      this.stats.topSpeed = Math.max(this.stats.topSpeed, pc.speed);
      this.stats.distance += pc.speed * sim;
    } else if (this.onFoot) {
      this.player.focus.copy(this.onFoot.position);
      this.player.heading = this.onFoot.yaw;
    }
    this.env.update(dt * (this.settings.timeScale > 0 ? 1 : 0), this.player.focus, this.camera.position);
    const night = this.env.night;
    this.city.setNight(night);
    this.props.setNight(night);
    this.city.setWetness(this.env.wetness);
    for (const c of this.cars) c.phys.wet = this.env.wetness;
    this.city.hillsMat.color.setRGB(0.32, 0.38, 0.25).multiplyScalar(0.25 + 0.75 * (1 - night));

    // camera
    this.cam.lookBack = input.down('lookBack');
    if (this.player.mode === 'foot' && this.onFoot) this.onFoot.updateCamera(dt, input);
    else this.cam.update(dt, input);
    this.env.sky.position.copy(this.camera.position);
    if (this.player.mode === 'car') this.interior?.update(dt, input);
    this.audio?.update(dt);
    this.gpsUpdate(dt);
    this.hud.update(dt);
    this.hurtFade(dt);
  }

  hurtFade(dt) {
    const el = document.getElementById('hurt');
    const o = parseFloat(el.style.opacity || '0');
    if (o > 0) el.style.opacity = String(Math.max(0, o - dt * 0.8));
  }

  handleGlobalKeys() {
    const input = this.input;
    if (input.pressed('pause')) {
      this.menus?.openPause();
      return;
    }
    if (input.pressed('help')) this.menus?.toggleHelp();
    if (input.pressed('telemetry')) {
      this.hud.telemetry = !this.hud.telemetry;
      this.hud.telemetryEl.classList.toggle('hidden', !this.hud.telemetry);
    }
    if (input.pressed('map')) this.menus?.openMap();
    if (input.pressed('slowmo')) {
      this.manualSlowmo = !this.manualSlowmo;
      this.toast(this.manualSlowmo ? 'Slow motion ON' : 'Slow motion OFF');
    }
    if (input.pressed('photo')) {
      if (this.cam.mode === 'free') {
        this.cam.setMode(this.prevCamMode || 'chase');
        this.input.enabled = true;
      } else {
        this.prevCamMode = this.cam.mode;
        this.cam.setMode('free');
        this.toast('Photo mode: WASD + mouse, Q/E up/down, Shift fast. F2 to exit.');
      }
    }
    if (input.pressed('radio')) this.audio?.nextStation?.();
    if (input.pressed('enterExit')) this.toggleOnFoot();
  }

  carKeys(car) {
    const input = this.input;
    if (this.cam.mode === 'free') return;
    const s = car.sys;
    if (input.pressed('camera')) {
      const m = this.cam.next();
      this.hud.camName(m);
      if (m !== 'cockpit') this.input.unlock();
    }
    if (input.pressed('ignition')) {
      if (car.phys.pt.running || car.phys.pt.cranking) car.stopEngine();
      else car.startEngine();
    }
    if (input.pressed('lights')) {
      const m = car.cycleHeadlights();
      this.toast(['Lights off', 'Parking lights', 'Headlights on'][m]);
      this.audio?.click?.();
    }
    if (input.pressed('highBeam')) {
      s.high = !s.high;
      this.audio?.click?.();
    }
    if (input.pressed('indLeft')) {
      car.setIndicator('left');
      this.audio?.click?.();
    }
    if (input.pressed('indRight')) {
      car.setIndicator('right');
      this.audio?.click?.();
    }
    if (input.pressed('hazard')) {
      car.toggleHazard();
      this.audio?.click?.();
    }
    if (input.pressed('wipers')) {
      const w = car.cycleWipers();
      this.toast(['Wipers off', 'Wipers: intermittent', 'Wipers: low', 'Wipers: high'][w]);
    }
    s.horn = input.down('horn');
    if (input.pressed('siren') && car.police) car.sirenOn = !car.sirenOn;
    if (input.keyPressed('KeyT')) {
      const pt = car.phys.pt;
      pt.auto = !pt.auto;
      pt.selector = pt.auto ? 'D' : 'M';
      if (!pt.auto && pt.gear < 1) pt.shiftTo(1);
      this.toast(pt.auto ? 'Automatic gearbox' : 'Manual gearbox: <kbd>X</kbd>/<kbd>Shift</kbd> up, <kbd>Z</kbd> down');
    }
    if (input.pressed('repair')) {
      car.repair();
      this.toast('Car repaired', 'good');
      this.audio?.repair?.();
    }
    // hold R to reset / flip
    if (input.down('reset')) {
      this.resetHold = (this.resetHold || 0) + 1 / 60;
      if (this.resetHold > 0.5) {
        this.resetHold = -10;
        this.recoverCar(car);
      }
    } else this.resetHold = 0;
  }

  recoverCar(car) {
    const p = car.body.position;
    const yaw = Math.atan2(car.body.R[2], car.body.R[8]);
    let pos = p.clone();
    let y = yaw;
    // if on the road network, snap to the nearest lane
    const nl = this.city.nearestLane(p);
    if (nl && this.city.onRoad(p.x, p.z)) {
      pos = this.city.lanePoint(nl.seg, nl.lane, nl.dist);
      y = Math.atan2(nl.seg.dir.x, nl.seg.dir.z);
    }
    const g = this.world.groundAt(pos.x, pos.z, p.y + 3, { y: 0 });
    car.placeAt(pos.x, g.y + 0.3, pos.z, y);
    this.toast('Car recovered');
  }

  toggleOnFoot() {
    if (!this.onFoot) return;
    if (this.player.mode === 'car') {
      if (this.player.car.speed > 4) {
        this.toast('Slow down before getting out');
        return;
      }
      this.onFoot.exitCar(this.player.car);
    } else this.onFoot.tryEnter();
  }

  // ------------------------------------------------------------ per-car visual effects
  carEffects(dt) {
    const cam = this.camera.position;
    const wet = this.env.wetness;
    for (const car of this.cars) {
      if (!car.physicsActive || car.removed) continue;
      const d2 = car.body.position.distanceToSquared(cam);
      if (d2 > 160 * 160) continue;
      const near = d2 < 70 * 70;
      const v = car.body.velocity;
      car.phys.wheels.forEach((w, i) => {
        const key = car.id * 4 + i;
        if (!w.contact || w.detached) {
          this.skids.add(key, null, null, 0, 0);
          return;
        }
        const mat = w.mat ? w.mat.name : 'asphalt';
        const loose = mat === 'grass' || mat === 'dirt';
        const slide = w.slideVel;
        let skid = 0;
        if (w.slip > 1.1 && slide > 2.5) skid = clamp((w.slip - 1.1) * 0.35, 0, 1) * clamp((slide - 2.5) / 6, 0, 1);
        if (w.flat > 0 && car.speed > 3) skid = Math.max(skid, 0.25);
        if (loose && car.speed > 2) skid = Math.max(skid, 0.25 + skid);
        const dir = w.f;
        this.skids.add(key, w.cp, dir, w.width, skid * (wet > 0.5 ? 0.4 : 1), loose ? [0.18, 0.13, 0.08] : [0.02, 0.02, 0.02]);
        if (!loose && slide > 6 && w.slip > 1.4 && near) this.fx.tireSmoke(w.cp, v, clamp((slide - 6) / 12, 0.1, 1) * (1 - wet * 0.7) * dt * 60 * 0.5);
        if (loose && car.speed > 4 && near) this.fx.dust(w.cp, v, w.mat.dust || [0.5, 0.45, 0.35], clamp(car.speed / 20 + slide / 10, 0, 1) * dt * 40);
        if (wet > 0.3 && car.speed > 7 && near) this.fx.spray(w.cp, v, wet * clamp(car.speed / 25, 0, 1) * dt * 50);
      });
      // exhaust
      const pt = car.phys.pt;
      const ex = car.model.details.exhausts;
      if (near && ex.length) {
        const dirW = car.body.toWorldDir(_v2.set(0, 0.2, -1), new THREE.Vector3());
        for (const e of ex) {
          const wp = car.body.toWorldPoint(_v.copy(e).sub(car.model.com), new THREE.Vector3());
          if (pt.running) this.fx.exhaust(wp, dirW, (0.05 + pt.throttle * 0.25) * dt * 60 * (this.env.hour < 8 ? 2 : 1), pt.health < 0.4 ? 1 : 0);
        }
        for (const ev of pt.events) {
          if (ev.type === 'pop') {
            const e = ex[Math.floor(Math.random() * ex.length)];
            const wp = car.body.toWorldPoint(_v.copy(e).sub(car.model.com), new THREE.Vector3());
            this.fx.flame(wp, dirW, ev.big);
          }
        }
      }
      // engine smoke / steam
      if (car.smoke > 0.02 && near) {
        const b = car.model.prof.b;
        const hp = car.body.toWorldPoint(_v.set(0, b.head.y + 0.35, b.zones.cowl + 0.5).sub(car.model.com), new THREE.Vector3());
        this.fx.engineSmoke(hp, v, car.smoke * dt * 60 * 0.6, pt.health > 0.35);
      }
      if (car.scrape > 2 && near) this.fx.sparks(car.scrapePoint, car.scrapeNormal, v, Math.min(6, car.scrape * 0.3) * dt * 60);
      if (car.fuelLeak > 0.3 && car.speed > 1 && Math.random() < 0.1) this.skids.add(car.id * 4 + 99, car.body.position.clone().setY(0.01), v.clone().normalize(), 0.3, 0.6, [0.05, 0.04, 0.03]);
      // audio events consumed by the audio engine; clear here
      if (car !== this.player.car) pt.events.length = 0;
    }
  }

  // ------------------------------------------------------------ GPS
  setWaypoint(p) {
    if (!p) {
      this.gps = null;
      this.toast('Waypoint cleared');
      return;
    }
    this.gps = { target: p.clone(), route: null, timer: 0 };
    this.toast('GPS waypoint set', 'info');
  }
  gpsUpdate(dt) {
    if (!this.gps) return;
    this.gps.timer -= dt;
    if (this.gps.timer <= 0 && this.gpsModule) {
      this.gps.timer = 1;
      this.gps.route = this.gpsModule.route(this.city, this.player.focus, this.gps.target);
    }
    if (this.player.focus.distanceTo(this.gps.target) < 15) {
      this.toast('You have arrived', 'good');
      this.gps = null;
    }
  }

  // ------------------------------------------------------------ menu background
  menuBackground(dt) {
    this.menuT = (this.menuT || 0) + dt;
    const car = this.player.car;
    this.traffic?.update(dt);
    this.physics.step(dt, this.cars);
    for (const c of this.cars) c.processImpacts(dt);
    for (const c of this.cars) {
      if (c.physicsActive) c.update(dt, this.physics.time);
      else c.syncVisual(dt, this.physics.time);
    }
    this.city.update(dt);
    this.props.update(dt, this.camera.position);
    this.fx.update(dt);
    this.skids.update();
    const p = car.body.position;
    const a = this.menuT * 0.12 + 0.6;
    this.camera.position.set(p.x + Math.sin(a) * 7.5, p.y + 1.5 + Math.sin(this.menuT * 0.2) * 0.5, p.z + Math.cos(a) * 7.5);
    this.camera.lookAt(p.x, p.y + 0.3, p.z);
    this.camera.fov = 42;
    this.camera.near = 0.2;
    this.camera.updateProjectionMatrix();
    this.env.update(dt * 0.3, p, this.camera.position);
    this.env.sky.position.copy(this.camera.position);
    const night = this.env.night;
    this.city.setNight(night);
    this.props.setNight(night);
    this.city.setWetness(this.env.wetness);
    this.audio?.update?.(dt);
  }

  // ------------------------------------------------------------ state changes
  startDriving() {
    this.state = 'play';
    this.hud.show(true);
    if (!this.startedOnce) {
      this.startedOnce = true;
      this.cam.setMode('cockpit');
      this.hud.camName('cockpit');
      setTimeout(() => {
        this.hud.toast('Welcome to <b>San Demo</b>. Click the key (or press <kbd>I</kbd>) to start the engine.', 'info', 7);
        this.hud.toast('<kbd>C</kbd> cameras · <kbd>F1</kbd> controls · <kbd>Esc</kbd> sandbox menu', 'info', 7);
      }, 600);
    }
    this.audio?.resume?.();
  }

  render(dt) {
    if (this.post && this.settings.bloom) this.post.render(dt, this);
    else this.renderer.render(this.scene, this.camera);
    this.interior?.renderMirrors?.(this.renderer);
  }
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

// ------------------------------------------------------------ boot
const loading = document.getElementById('loading');
const bar = loading.querySelector('.fill');
const msg = loading.querySelector('.msg');
const game = new Game();
window.game = game;
game
  .init((p, m) => {
    bar.style.width = `${Math.round(p * 100)}%`;
    if (m) msg.textContent = m;
  })
  .then(() => {
    bar.style.width = '100%';
    loading.classList.add('done');
    game.menus?.openMain();
    if (!game.menus) game.startDriving();
    window.__ready = true;
  })
  .catch((e) => {
    console.error(e);
    msg.textContent = 'Failed to start: ' + e.message;
    window.__ready = true;
  });
