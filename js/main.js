import * as THREE from 'three';
import { Input } from './input.js';
import { StaticWorld } from './physics/world.js';
import { PhysicsSystem } from './physics/physicsSystem.js';
import { City, CITY } from './world/city.js';
import { Terrain } from './world/terrain.js';
import { Coast } from './world/coast.js';
import { Career } from './career/career.js';
import { Props } from './world/props.js';
import { Environment } from './world/environment.js';
import { FX } from './fx/particles.js';
import { Skidmarks } from './fx/skidmarks.js';
import { DebrisSystem } from './fx/debris.js';
import { Car } from './vehicle/car.js';
import { DEFAULT_CONFIG, configForBody } from './vehicle/specs.js';
import { paintLivery } from './vehicle/carBuilder.js';
import { beamTexture } from './world/textures.js';
import { CameraRig, CAMERA_MODES } from './camera.js';
import { PlayerDriver } from './player.js';
import { HUD } from './ui/hud.js';
import { PhotoMode } from './ui/photo.js';
import { Sandbox } from './sandbox.js';
import { Ambient } from './world/ambient.js';
import { Tutorial } from './career/tutorial.js';
import { Replay } from './replay.js';
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
  pedestrians: 1,
  // v2 options
  dynamicRes: false,
  viewDistance: 1,
  treeDensity: 1,
  chaseDist: 1,
  chaseHeight: 1,
  chaseStiffness: 1,
  reduceShake: false,
  rearPip: false,
  hudScale: 1,
  colorBlind: false,
  subtitles: false,
  speedo: 'analog',
  speedLimitSign: true,
  perfGraph: false,
  npcVoices: false,
  gpsVoice: true,
  assistPreset: 'realistic',
  holdLookBack: true,
  holdRun: true,
  autoWeather: true,
  trafficByTime: true,
  services: true,
  mirrors: 'all',
  autoReplay: true,
  wheelLock: 900,
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
const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _s4 = new THREE.Vector3();
const _c4 = new THREE.Color();
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
    progress(0.25, 'Raising the mountains…');
    await tick();
    this.terrain = new Terrain(this.scene, this.world, this.city).build();
    this.world.terrain = this.terrain;
    this.city.outsideName = (p) => {
      const pr = this.coast?.pier;
      if (pr && Math.abs(p.x - pr.x) < pr.w && p.z > pr.z0 && p.z < pr.z1 && p.y > 0.5) return 'Pier';
      return this.terrain.regionName(p);
    };
    progress(0.35, 'Planting trees and lamp posts…');
    await tick();
    this.fx = new FX(this.scene);
    this.fx.groundAt = (x, z, y) => this.world.groundAt(x, z, y + 0.5, { y: 0 }).y;
    this.skids = new Skidmarks(this.scene);
    this.debris = new DebrisSystem(this.scene, this.world);
    this.debris.onHit = (it, v) => this.audio?.debrisHit?.(it, v);
    this.props = new Props(this, this.city);
    this.props.build();
    this.coast = new Coast(this).build();
    Object.assign(this.city.locations, this.coast.locations, { lookout: { pos: this.terrain.lookout.pos.clone(), yaw: this.terrain.lookout.yaw, name: 'Demo Peak' } });
    this.physics = new PhysicsSystem(this.world);
    this.physics.props = this.props;
    this.physics.debris = this.debris;
    progress(0.55, 'Tuning engines…');
    await tick();

    this.cam = new CameraRig(this.camera, this);
    this.initCarLights();
    this.driver = new PlayerDriver(this);
    this.hud = new HUD(this);
    await this.initOptional(progress);
    this.replay = new Replay(this);
    this.photo = new PhotoMode(this);
    this.sandbox = new Sandbox(this);
    this.ambient = new Ambient(this);
    this.tutorial = new Tutorial(this);
    this.spawnPlayer(this.carConfig);
    progress(0.95, 'Warming up tyres…');
    await tick();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applyViewDistance();
    this.applyHudPrefs();
    this.terrain?.setTreeDensity?.(this.settings.treeDensity);
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
    if (audio) {
      this.audio = new audio.AudioEngine(this);
      // thunder rolls in after the flash, delayed by the strike's distance
      this.env.onThunder = (d) => this.audio.thunder(d);
    }
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
    const peds = await tryImport('./ai/pedestrians.js');
    if (peds) this.peds = new peds.Pedestrians(this);
    const svc = await tryImport('./ai/services.js');
    if (svc) this.services = new svc.Services(this);
    const dealer = await tryImport('./ui/dealer.js');
    if (dealer) this.dealer = new dealer.Dealer(this);
    const phone = await tryImport('./ui/phone.js');
    if (phone) this.phone = new phone.Phone(this);
    const fr = await tryImport('./activities/freeroam.js');
    if (fr) this.freeroam = new fr.FreeRoam(this);
    const am = await tryImport('./activities/manager.js');
    const ev = await tryImport('./activities/events.js');
    if (am && ev) this.activities = new am.ActivityManager(this, ev.buildEvents(this));
  }

  /** A fixed pool of real lights (no shader recompiles): player headlights + police strobes. */
  initCarLights() {
    this.headlights = [0, 1].map(() => {
      const l = new THREE.SpotLight(0xfff1d6, 0, 90, 0.42, 0.55, 1.4);
      l.castShadow = false;
      this.scene.add(l);
      this.scene.add(l.target);
      return l;
    });
    this.strobes = [new THREE.PointLight(0xff2020, 0, 40, 1.2), new THREE.PointLight(0x2050ff, 0, 40, 1.2)];
    for (const l of this.strobes) this.scene.add(l);
    // fake headlight pools for traffic at night
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: new THREE.Color(1, 0.92, 0.78), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, opacity: 0.7 });
    const bg = new THREE.PlaneGeometry(9, 22);
    bg.rotateX(-Math.PI / 2);
    bg.translate(0, 0, 11);
    this.beams = new THREE.InstancedMesh(bg, beamMat, 64);
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 2;
    this.scene.add(this.beams);
  }

  updateCarLights() {
    const car = this.player.car;
    const night = this.env.night;
    const [L, R] = this.headlights;
    if (car && car.electrics && car.sys.lightLevel === 2) {
      const high = car.sys.high || car.sys.flash > 0;
      const droop = car.ext ? car.ext.lightAim : 0;
      const dim = car.ext ? clamp((car.ext.volts - 10.2) / 2, 0.15, 1) : 1;
      const units = car.model.lights.head;
      [L, R].forEach((l, i) => {
        const u = units[i];
        if (!u || u.broken) {
          l.intensity = 0;
          return;
        }
        car.body.toWorldPoint(_v.copy(u.mesh.position).add(u.group.position).sub(car.model.com).setZ(u.mesh.position.z + 0.15 - car.model.com.z), l.position);
        const aim = _v2.set(u.side * 0.25 + droop * u.side * 20, (high ? 1.0 : 0.05) - droop * (high ? 70 : 26), high ? 70 : 26).sub(car.model.com);
        aim.x += u.mesh.position.x;
        car.body.toWorldPoint(aim, l.target.position);
        l.intensity = (high ? 900 : 420) * (0.35 + night * 0.65) * dim;
        l.distance = high ? 140 : 75;
        l.angle = high ? 0.36 : 0.5;
        l.color.set(car.model.lights.headColor);
      });
    } else {
      L.intensity = 0;
      R.intensity = 0;
    }
    // police strobes: nearest cruiser with its siren on
    let cop = null, bd = 90 * 90;
    for (const c of this.cars) {
      if (!c.police || !c.sirenOn || c.removed) continue;
      const d = c.body.position.distanceToSquared(this.camera.position);
      if (d < bd) {
        bd = d;
        cop = c;
      }
    }
    const t = this.physics.time;
    if (cop) {
      const lb = cop.model.details.lightbar;
      const p = cop.body.toWorldPoint(_v.copy(lb ? lb.group.position : new THREE.Vector3(0, 1.5, 0)).sub(cop.model.com), _v);
      const ph = (t * 3.2) % 1;
      this.strobes[0].position.copy(p).add(_v2.set(0, 1.6, 0));
      this.strobes[1].position.copy(p).add(_v2.set(0, 1.6, 0));
      const k = 14 * (0.3 + night * 0.7);
      this.strobes[0].intensity = ph < 0.5 ? k : 0;
      this.strobes[1].intensity = ph >= 0.5 ? k : 0;
    } else this.strobes[0].intensity = this.strobes[1].intensity = 0;
    // traffic beam pools
    let n = 0;
    if (night > 0.3) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      for (const c of this.cars) {
        if (n >= 64) break;
        if (c === car || c.removed || c.sys.headlights !== 2 || !c.headlightOk(1) && !c.headlightOk(-1)) continue;
        if (c.body.position.distanceToSquared(this.camera.position) > 140 * 140) continue;
        const yaw = Math.atan2(c.body.R[2], c.body.R[8]);
        q.setFromAxisAngle(_v2.set(0, 1, 0), yaw);
        const fwd = _v.set(Math.sin(yaw), 0, Math.cos(yaw));
        const pos = c.body.position.clone().addScaledVector(fwd, c.boundsMax.z);
        pos.y = this.world.groundAt(pos.x, pos.z, pos.y, { y: 0 }).y + 0.02;
        m.compose(pos, q, one);
        this.beams.setMatrixAt(n++, m);
      }
    }
    this.beams.count = n;
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.material.opacity = 0.55 * night;
  }

  /** View distance: LOD ranges, tree culling, camera far plane and fog. */
  applyViewDistance() {
    const k = this.settings.viewDistance || 1;
    if (this.terrain) this.terrain.viewK = k;
    this.camera.far = 3500 * k;
    this.camera.updateProjectionMatrix();
    this.env.fogScale = 1 / k;
  }

  /** HUD scale and the colour-blind palette. */
  applyHudPrefs() {
    const s = this.settings;
    document.documentElement.style.setProperty('--hud-scale', s.hudScale || 1);
    document.body.classList.toggle('cb', !!s.colorBlind);
  }

  /** Assist presets: Arcade (everything on, forgiving), Realistic, Sim (all off). */
  applyAssistPreset(car, announce = false) {
    if (!car) return;
    const p = this.settings.assistPreset || 'realistic';
    const a = car.tuning.assists;
    if (p === 'arcade') Object.assign(a, { abs: true, tcs: true, esc: true });
    else if (p === 'realistic') Object.assign(a, { abs: car.cfg.abs !== false, tcs: car.cfg.tcs !== false, esc: true });
    else Object.assign(a, { abs: false, tcs: false, esc: false });
    this.settings.steerAssist = p !== 'sim';
    car.phys.arcade = p === 'arcade' ? 1.12 : 1; // a little extra grip in Arcade
    if (announce) this.toast(`Assists: ${p[0].toUpperCase() + p.slice(1)}`, 'info', 2);
  }

  /** Dynamic resolution: trade pixels for a steady frame rate (~16-22 ms target). */
  updateDynRes(ms) {
    if (!this.settings.dynamicRes) {
      if (this.dynScale !== 1) {
        this.dynScale = 1;
        this.resize();
      }
      return;
    }
    this.dynAvg = lerp(this.dynAvg || ms, ms, 0.05);
    this.dynT = (this.dynT || 0) + ms / 1000;
    if (this.dynT < 1) return;
    this.dynT = 0;
    const before = this.dynScale || 1;
    if (this.dynAvg > 22) this.dynScale = Math.max(0.55, before - 0.07);
    else if (this.dynAvg < 15.5) this.dynScale = Math.min(1, before + 0.05);
    if (this.dynScale !== before) this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.settings.resScale * (this.dynScale || 1));
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
    this.applyAssistPreset(car);
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
      if (kind === 'building' && dv > 5) this.smashShopWindow(p, dv, car);
      if (dv > 8) this.ambient?.onNoise(p, Math.min(2, dv / 12));
      if (!(other && other.id < car.id)) this.audio?.impact?.(p, dv, kind, car);
    }
    if (isPlayer && kind === 'wall' && this.city.crashWall && p.x > this.city.crashWall.x - 6 && dv > 4 && !this.wallMsgT) {
      this.wallMsgT = true;
      setTimeout(() => (this.wallMsgT = false), 2500);
      this.hud.big(`${Math.round(this.prevPlayerKmh || dv * 3.6)} km/h`, `Crash test · Δv ${(dv * 3.6).toFixed(0)} km/h · ${(dv / 9.81 / 0.08).toFixed(0)} g peak (est.)`, 3.5);
    }
    if (isPlayer) {
      this.cam.addShake(Math.min(1.2, dv * 0.045));
      if (dv > 6) this.hud.hurt(Math.min(0.9, dv / 25));
      if (dv > 5) this.stats.crashes++;
      if (dv > 16 && this.settings.slowmo && this.slowmoTimer <= 0) this.startSlowmo(1.6);
      if (car === this.player.car && this.physics.time - (car.placedT ?? -9) > 1.5) this.replay?.onCrash(dv);
      this.interior?.onImpact?.(dv, p);
      if (dv > 12 && !car.sys.seatbelt) this.cam.addShake(0.8);
    }
    // parked cars have alarms
    if (car.parked && car.ext && dv > 1.2 && !(car.ext.alarm > 0)) car.ext.alarm = 18;
    if (other && other.isPlayer && dv > 1.5) car.controller?.onHitByPlayer?.(dv);
    if (car.isPlayer && other && dv > 1.5) other.controller?.onHitByPlayer?.(dv);
    this.police?.onImpact?.(car, other, dv, kind);
  }

  toggleCruise(car) {
    const cr = car.ext.cruise;
    const pt = car.phys.pt;
    if (cr.on) {
      cr.on = false;
      this.toast('Cruise control off');
    } else if (car.forwardSpeed > 8 && pt.running) {
      cr.on = true;
      cr.speed = car.forwardSpeed;
      this.toast(`Cruise set: <b>${this.fmtSpeed(cr.speed)}</b> (<kbd>=</kbd>/<kbd>-</kbd> to adjust)`);
    } else if (cr.speed > 8 && car.forwardSpeed > 5 && pt.running) {
      cr.on = true;
      this.toast(`Cruise resume: <b>${this.fmtSpeed(cr.speed)}</b>`);
    } else this.toast('Cruise control works above 30 km/h');
    this.audio?.click?.();
  }

  /** Fade to black, run fn, fade back in. */
  fadeTo(fn, ms = 700) {
    const fade = document.getElementById('fade');
    fade.style.opacity = '1';
    setTimeout(() => {
      fn();
      setTimeout(() => (fade.style.opacity = '0'), 150);
    }, ms);
  }

  fmtSpeed(ms) {
    return this.settings.units === 'mph' ? `${Math.round(ms * 2.237)} mph` : `${Math.round(ms * 3.6)} km/h`;
  }

  /** Toasts and side effects for the player's powertrain / chassis events (before audio consumes them). */
  carEvents(car) {
    if (!car) return;
    for (const e of car.phys.pt.events) {
      if (e.type === 'grind') this.toast(e.broken ? 'That gear is broken!' : 'Grind! Use the clutch (<kbd>Ctrl</kbd>)', 'warn', 1.5);
      else if (e.type === 'overrev') this.toast('Over-rev! You money-shifted the engine', 'warn', 2);
      else if (e.type === 'click') this.toast('Click… click… The battery is flat', 'warn', 3);
      else if (e.type === 'ready') this.toast('READY', 'good', 1.2);
      else if (e.type === 'evFault') this.toast('Battery depleted — the car will not start', 'warn', 3);
      else if (e.type === 'stall' && !e.fuel && !car.phys.pt.auto) this.toast('Stalled', 'warn', 1.2);
    }
    for (const e of car.phys.events) {
      if (e.type === 'blowout') {
        this.toast('Blowout!', 'warn', 2);
        this.audio?.impact?.(car.body.position, 6, 'tyre', car);
        this.cam.addShake(0.4);
      }
    }
    car.phys.events.length = 0;
    // NPC chassis events are not interesting
    for (const c of this.cars) if (c !== car) c.phys.events.length = 0;
  }

  onCarEvent(car, what) {
    const mine = car === this.player.car;
    if (what === 'fire') {
      if (mine) this.toast('🔥 Your car is on fire! Get out (<kbd>F</kbd>)', 'warn', 5);
      this.fireDept?.call?.(car);
    }
    if (what === 'fireOut' && mine) this.toast('Fire is out', 'good');
    if (what === 'burnt' && mine) this.toast('The car burned out', 'warn', 4);
  }

  onExplosion(car, p) {
    this.fx.sparks(p, new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 80);
    for (let i = 0; i < 6; i++) this.fx.fire(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 2);
    this.fx.impactDust(p, 3);
    this.audio?.explosion?.(p);
    const d = this.camera.position.distanceTo(p);
    this.cam.addShake(Math.max(0, 1.5 - d / 40));
    // shove everything nearby
    for (const c of this.cars) {
      if (c === car || c.removed) continue;
      const off = c.body.position.clone().sub(p);
      const r = off.length();
      if (r > 14) continue;
      off.y += 2;
      off.normalize().multiplyScalar(c.body.mass * (14 - r) * 0.6);
      c.body.applyImpulse(off, c.body.position);
      c.body.sleeping = false;
    }
    for (const pd of this.peds?.list || []) {
      if (pd.pos.distanceTo(p) < 12 && pd.state !== 'down') this.peds.knockDown(pd, car, pd.pos.clone().sub(p).setY(0).normalize().multiplyScalar(8), 6);
    }
    if (this.player.mode === 'foot' && this.onFoot && this.onFoot.position.distanceTo(p) < 10) this.hud.hurt(0.8);
    if (car === this.player.car && this.player.mode === 'car') car.ext.hurt(0.7, this, 'explosion');
  }

  /** Unbelted driver goes through the windshield. */
  onEjected(car, dv) {
    if (car !== this.player.car || !this.onFoot) return;
    this.toast('You went through the windshield. Wear your seatbelt.', 'warn', 5);
    this.onFoot.eject?.(car, dv);
    car.ext.hurt(0.45, this, 'ejected');
  }

  onBlackout(car, cause) {
    this.toast('You blacked out…', 'warn', 4);
    this.hud.blackout?.(3);
    this.career?.onBlackout?.(cause);
    setTimeout(() => {
      if (car.ext) {
        car.ext.driver.health = 0.5;
        car.ext.driver.out = false;
      }
    }, 3000);
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
    if (what === 'hydrolock') this.toast('Engine hydrolocked: it sucked in water', 'warn', 5);
    if (what === 'shorted') this.toast('The electrics shorted out', 'warn', 4);
    this.audio?.clunk?.(car, 1);
  }

  onGlass(car, part, lp, shattered) {
    this.audio?.glass?.(car, shattered ? 1 : 0.35);
    if (car === this.player.car) this.interior?.onGlass?.(part, lp, shattered);
  }

  onPursuitEnd(how, stars) {
    this.freeroam?.pursuitEnd?.(how, stars);
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
    this.frameMs = (now - (this.prevNow || now)) || dt * 1000;
    this.prevNow = now;
    this.updateDynRes(this.frameMs);
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
    if (this.state === 'replay') {
      this.replay.update(dt);
      this.audio?.update(dt);
      this.hud.updateExtras?.(dt);
      return;
    }
    if (this.state === 'card') {
      if (input.pressed('pause')) this.activities?.closeCard();
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
    const photo = this.cam.mode === 'free';
    if (photo && this.settings.photoPause !== false) sim = 0;
    if (this.sandbox?.spectating && pc) {
      // spectating an NPC: your own car waits with the brake on
      pc.phys.input.throttle = 0;
      pc.phys.input.brake = 1;
      if (input.pressed('enterExit')) this.sandbox.stopSpectate();
    } else if (this.player.mode === 'car' && pc && !photo) {
      this.driver.update(pc, dt, input);
      this.carKeys(pc, dt);
      if (this.crash) this.updateCrashTest(pc, dt);
    } else if (pc && (photo || this.player.mode === 'foot')) {
      // abandoned car: nobody at the wheel
      pc.phys.input.throttle = 0;
      pc.phys.input.steer *= 0.9;
    }
    if (sim > 0) {
      const wind = this.env.wind;
      if (wind) for (const c of this.cars) if (c.physicsActive) c.phys.wind.copy(wind);
      this.traffic?.update(sim);
      this.services?.update(sim);
      this.sandbox?.update(sim);
      this.tutorial?.update(sim);
      this.peds?.update(sim);
      this.police?.update(sim);
      this.physics.step(sim, this.cars);
      for (const c of this.cars) c.processImpacts(sim);
      for (const c of this.cars) {
        if (c.physicsActive) c.update(sim, this.physics.time);
        else c.syncVisual(sim, this.physics.time);
      }
      if (this.player.mode === 'foot') this.onFoot?.update(sim, input);
      this.debris.update(sim);
      this.replay?.record(sim);
      this.replay?.tickPending(dt);
    } else this.peds?.render?.();
    this.city.update(sim);
    this.terrain.update(sim, this.camera.position, this.env.wind);
    this.coast.update(sim, this.env.night);
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
    this.terrain.setWetness(this.env.wetness);
    this.coast.setWetness(this.env.wetness);
    this.ambient?.update(sim);
    this.coast.setNight(night);
    for (const c of this.cars) {
      c.phys.wet = this.env.wetness;
      c.phys.snow = this.env.snowCover || 0;
    }
    this.city.hillsMat.color.setRGB(0.32, 0.38, 0.25).multiplyScalar(0.25 + 0.75 * (1 - night));
    this.fx.setAmbient(0.1 + 0.87 * (1 - night));

    this.updateCarLights();
    // distance LOD for cars
    const cp = this.camera.position;
    for (const c of this.cars) c.setLod(c === pc && this.cam.mode !== 'free' ? 0 : c.body.position.distanceTo(cp));
    // camera
    this.cam.lookBack = input.held('lookBack', this.settings.holdLookBack !== false);
    if (this.player.mode === 'foot' && this.onFoot) this.onFoot.updateCamera(dt, input);
    else this.cam.update(dt, input);
    this.env.sky.position.copy(this.camera.position);
    if (this.player.mode === 'car') this.interior?.update(dt, input);
    this.carEvents(pc);
    this.career?.update(dt);
    this.phone?.update(dt);
    this.dealer?.update(dt);
    this.freeroam?.update(dt);
    this.activities?.update(dt);
    if (input.pressed('restart')) this.activities?.restart();
    this.audio?.update(dt);
    this.gpsUpdate(dt);
    this.zones(dt);
    this.hud.update(dt);
    this.hurtFade(dt);
    this.prevPlayerKmh = pc ? pc.speed * KMH : 0;
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
    if (input.pressed('photo')) this.togglePhoto();
    if (input.pressed('replay')) this.replay?.start();
    if (this.cam.mode === 'free' && this.photo?.active) {
      this.photo.update();
      if (input.keyPressed('Enter')) this.photo.snap();
    }
    if (input.pressed('radio')) this.audio?.nextStation?.();
    if (input.pressed('enterExit') && !this.sandbox?.spectating) this.toggleOnFoot();
  }

  /**
   * Crash Test (sandbox): like a real test, the car is towed to speed on a cable,
   * released 8 m before the Proving Grounds wall, and we report what happened.
   */
  crashTest(kmh) {
    const car = this.player.car;
    const w = this.city.crashWall;
    if (!car || !w || this.activities?.current) return;
    if (this.player.mode !== 'car') this.onFoot?.forceEnter?.();
    car.repair();
    const v = kmh / 3.6;
    car.placeAt(w.x - 70, 0, 0, Math.PI / 2);
    car.body.velocity.set(v, 0, 0);
    for (const wh of car.phys.wheels) wh.omega = v / wh.radius;
    const pt = car.phys.pt;
    car.sys.ignition = 'on';
    pt.running = true;
    if (pt.auto) pt.setSelector('D');
    car.sys.seatbelt = true;
    this.crash = { v, kmh, state: 'tow', t: 0, peakG: 0, impactV: 0, cam: this.cam.mode };
    if (this.replay) this.replay.lastAuto = performance.now(); // the report matters more than an automatic replay here
    this.cam.setMode('tv');
    this.cam.initialized = false;
    this.toast(`Crash test at ${this.fmtSpeed(v)} — hands off!`, 'info', 2);
  }

  updateCrashTest(car, dt) {
    const c = this.crash;
    const w = this.city.crashWall;
    const p = car.body.position;
    const inp = car.phys.input;
    c.t += dt;
    inp.throttle = 0;
    inp.brake = 0;
    inp.handbrake = 0;
    // keep it on the centre line
    car.body.toLocalPoint(_v.set(p.x + 30, p.y, 0), _v);
    inp.steer = clamp(-_v.x * 0.12, -0.3, 0.3);
    if (c.state === 'tow') {
      // the tow cable holds the speed exactly
      const vel = car.body.velocity;
      vel.x += (c.v - vel.x) * Math.min(1, dt * 8);
      if (p.x > w.x - 8 - 2.5) {
        c.state = 'free';
        if (this.settings.slowmo) this.startSlowmo(1.4);
      }
    } else if (c.state === 'free') {
      c.impactV = Math.max(c.impactV, car.body.velocity.x);
      if (car.lastImpact > 3 || car.body.velocity.x < c.v * 0.5) {
        c.state = 'impact';
        c.t = 0;
      }
    } else if (c.state === 'impact') {
      c.peakG = Math.max(c.peakG, car.gforce.length() / 9.81);
      if (c.t > 2.5) this.crashReport(car);
    }
    if (c.t > 20) this.crash = null; // safety
  }

  crashReport(car) {
    const c = this.crash;
    this.crash = null;
    const d = car.damageSummary();
    const lat = car.model.lattice;
    let crumple = 0;
    for (let i = 0; i < lat.pos.length; i += 3) crumple = Math.max(crumple, Math.hypot(lat.pos[i] - lat.rest[i], lat.pos[i + 1] - lat.rest[i + 1], lat.pos[i + 2] - lat.rest[i + 2]));
    const off = car.phys.wheels.filter((wh) => wh.detached).length;
    const health = car.ext.driver.health;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const injury = health > 0.9 ? 'unhurt' : health > 0.6 ? 'bruised' : health > 0.3 ? 'injured' : 'critical';
    const rating = Math.max(0, 5 - Math.round((1 - health) * 5 + (c.peakG > 60 ? 1 : 0)));
    this.hud.notify(`💥 Crash test · ${this.fmtSpeed(c.v)}`,
      `Impact ${this.fmtSpeed(c.impactV)} · peak ${Math.round(c.peakG)} g · crumple ${crumple.toFixed(2)} m<br>Body ${pct(d.body)} · engine ${pct(d.engine)}${off ? ` · ${off} wheel${off > 1 ? 's' : ''} off` : ''} · glass ${d.glass.filter((x) => x >= 1).length} broken<br>Airbag ${this.interior?.airbag > 0 ? 'deployed' : 'not deployed'} · occupant ${injury} · ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} safety`, '', 14);
    this.cam.setMode(c.cam || 'chase');
  }

  /** Driving into a storefront breaks the window: glass everywhere, a hole left behind. */
  smashShopWindow(p, dv, car) {
    const w = this.city.shopWindowAt(p);
    if (!w) return;
    const smashed = (this.smashed ||= []);
    if (smashed.some((q) => Math.hypot(q.x - w.x, q.z - w.z) < 2.5)) return;
    if (smashed.length > 60) smashed.shift().m.removeFromParent();
    // the hole: a dark, jagged decal with shards around the edge
    const tex = (this.smashTex ||= smashTexture());
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4 }));
    m.position.set(w.x, Math.max(1.4, Math.min(p.y + 0.4, 2.6)), w.z);
    m.rotation.y = Math.atan2(w.nx, w.nz);
    this.scene.add(m);
    smashed.push({ x: w.x, z: w.z, m });
    const at = new THREE.Vector3(w.x, m.position.y, w.z);
    this.fx.glass(at, 40 + Math.min(60, dv * 4));
    this.audio?.glass?.(car, 1);
    if (car === this.player.car) {
      this.police?.offense?.('property');
      this.career?.charge?.(Math.round(400 + dv * 30), 'Smashed shop window', false, true);
      this.toast('💥 You went through a shop window!', 'warn', 2.5);
    }
  }

  /** Photo mode: free camera, sim paused. Pass on=true/false to force a state. */
  togglePhoto(on = this.cam.mode !== 'free') {
    if (!on && this.cam.mode === 'free') {
      this.cam.setMode(this.prevCamMode || 'chase');
      this.input.enabled = true;
      this.photo?.close();
    } else if (on && this.cam.mode !== 'free') {
      this.prevCamMode = this.cam.mode;
      this.cam.setMode('free');
      this.photo?.open();
      this.toast('Photo mode: WASD + mouse to fly, Q/E up/down, Shift fast. Enter saves a PNG, F2 exits.', 'info', 4);
    }
  }

  carKeys(car, dt = 1 / 60) {
    const input = this.input;
    if (this.cam.mode === 'free') return;
    if (input.pressed('seatbelt')) {
      car.sys.seatbelt = !car.sys.seatbelt;
      this.audio?.buckle?.(car.sys.seatbelt);
      this.toast(car.sys.seatbelt ? 'Seatbelt fastened' : 'Seatbelt off', 'info', 1.2);
    }
    const s = car.sys;
    const pt = car.phys.pt;
    const ext = car.ext;
    if (input.pressed('flash')) {
      s.flash = 0.35;
      this.traffic?.onPlayerFlash?.(car);
    }
    if (input.down('flash')) s.flash = Math.max(s.flash, 0.1);
    if (input.pressed('fog')) {
      const f = car.cycleFog();
      this.toast(['Fog lights off', 'Front fog lights', 'Front + rear fog lights'][f]);
      this.audio?.click?.();
    }
    if (input.pressed('driveMode')) {
      const order = ['eco', 'normal', 'sport'];
      pt.mode = order[(order.indexOf(pt.mode) + 1) % 3];
      this.toast(`Drive mode: <b>${pt.mode.toUpperCase()}</b>`);
      this.audio?.click?.();
    }
    if (input.pressed('regen') && pt.ev) {
      pt.regenLevel = (pt.regenLevel + 1) % 4;
      this.toast(`Regenerative braking: <b>${['off', 'low', 'medium', 'high (one-pedal)'][pt.regenLevel]}</b>`);
    }
    if (input.pressed('cruise') && ext) this.toggleCruise(car);
    if (ext && (input.pressed('cruiseUp') || input.pressed('cruiseDown'))) {
      const step = (this.settings.units === 'mph' ? 5 / 2.237 : 5 / 3.6) * (input.pressed('cruiseUp') ? 1 : -1);
      const tgt = ext.cruise.on ? ext.cruise : ext.limiter.on ? ext.limiter : null;
      if (tgt) {
        tgt.speed = Math.max(5, tgt.speed + step);
        this.toast(`${tgt === ext.cruise ? 'Cruise' : 'Limiter'}: <b>${this.fmtSpeed(tgt.speed)}</b>`);
      }
    }
    if (input.pressed('limiter') && ext) {
      const l = ext.limiter;
      l.on = !l.on;
      if (l.on) l.speed = Math.max(car.forwardSpeed, 50 / 3.6);
      this.toast(l.on ? `Speed limiter: <b>${this.fmtSpeed(l.speed)}</b> (<kbd>=</kbd>/<kbd>-</kbd>)` : 'Speed limiter off');
      this.audio?.click?.();
    }
    // seat adjustment
    if (input.down('seatUp')) s.seatH = Math.min(0.08, s.seatH + dt * 0.08);
    if (input.down('seatDown')) s.seatH = Math.max(-0.08, s.seatH - dt * 0.08);
    if (input.down('seatFwd')) s.seatZ = Math.min(0.12, s.seatZ + dt * 0.1);
    if (input.down('seatBack')) s.seatZ = Math.max(-0.12, s.seatZ - dt * 0.1);
    if (input.pressed('camera')) {
      const m = this.cam.next();
      this.hud.camName(m);
      if (!this.cam.interior) this.input.unlock();
    }
    if (input.pressed('ignition')) {
      if (car.phys.pt.running || car.phys.pt.cranking) car.stopEngine();
      else car.startEngine();
    }
    if (input.pressed('lights')) {
      const m = car.cycleHeadlights();
      this.toast(['Lights off', 'Parking lights', 'Headlights on', 'Headlights: AUTO'][m]);
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
      this.toast(['Wipers off', 'Wipers: intermittent', 'Wipers: low', 'Wipers: high', 'Wipers: AUTO (rain sensor)'][w]);
    }
    s.horn = input.down('horn') || !!(ext && ext.hornStuck);
    if (input.pressed('siren') && car.police) car.sirenOn = !car.sirenOn;
    if (input.keyPressed('KeyT')) {
      const pt = car.phys.pt;
      pt.auto = !pt.auto;
      pt.selector = pt.auto ? 'D' : 'M';
      if (!pt.auto && pt.gear < 1) pt.shiftTo(1);
      this.toast(pt.auto ? 'Automatic gearbox' : 'Manual gearbox: <kbd>X</kbd>/<kbd>Shift</kbd> up, <kbd>Z</kbd> down');
    }
    if (input.pressed('repair')) {
      if (this.career) this.toast('Repairs cost money in Career: visit San Demo Customs or call a mechanic on your phone (<kbd>Tab</kbd>)', 'warn', 4);
      else {
        car.repair();
        this.toast('Car repaired', 'good');
        this.audio?.repair?.();
      }
    }
    // hold R to reset / flip
    if (input.down('reset')) {
      this.resetHold = (this.resetHold || 0) + dt;
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
  /** Oil / coolant / fuel stains on the road (visual side of world.slicks). */
  onLeak(car, p, kind) {
    if (!this.stains) {
      const geo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      this.stains = new THREE.InstancedMesh(geo, mat, 96);
      this.stains.count = 0;
      this.stains.frustumCulled = false;
      this.stains.setColorAt(0, new THREE.Color());
      this.scene.add(this.stains);
      this.stainN = 0;
    }
    const i = this.stainN++ % 96;
    const r = car.speed < 2 ? 0.9 + Math.random() * 0.6 : 0.35 + Math.random() * 0.3;
    const y = this.world.groundAt(p.x, p.z, p.y, { y: 0 }).y + 0.015;
    _m4.compose(_v.set(p.x + (Math.random() - 0.5) * 0.6, y, p.z + (Math.random() - 0.5) * 0.6), _q4.setFromAxisAngle(_v2.set(0, 1, 0), Math.random() * 6), _s4.set(r, 1, r * (0.7 + Math.random() * 0.6)));
    this.stains.setMatrixAt(i, _m4);
    this.stains.setColorAt(i, _c4.set(kind === 'coolant' ? 0x1f7a3a : 0x0a0908));
    this.stains.count = Math.min(96, this.stainN);
    this.stains.instanceMatrix.needsUpdate = true;
    this.stains.instanceColor.needsUpdate = true;
  }

  carEffects(dt) {
    const cam = this.camera.position;
    const wet = this.env.wetness;
    for (const car of this.cars) {
      if (!car.physicsActive || car.removed) continue;
      const d2 = car.body.position.distanceToSquared(cam);
      if (d2 > 160 * 160) continue;
      const near = d2 < 70 * 70;
      const v = car.body.velocity;
      // a dragging exhaust throws sparks and scrapes
      if (car.ext && car.ext.exhaustDrag && car.speed > 3 && car.phys.grounded >= 3 && near) {
        const tail = _v.set(car.boundsMin.x * 0.4, car.boundsMin.y + 0.05, car.boundsMin.z + 0.4);
        car.body.toWorldPoint(tail, tail);
        tail.y = this.world.groundAt(tail.x, tail.z, tail.y + 0.3, { y: 0 }).y + 0.03;
        if (Math.random() < dt * 30) this.fx.sparks(tail, _v2.set(0, 1, 0), v, 3);
        car.scrape = Math.max(car.scrape, 2.5);
      }
      car.phys.wheels.forEach((w, i) => {
        const key = car.id * 4 + i;
        if (!w.contact || w.detached) {
          this.skids.add(key, null, null, 0, 0);
          return;
        }
        const mat = w.mat ? w.mat.name : 'asphalt';
        const loose = !!(w.mat && w.mat.loose);
        const slide = w.slideVel;
        let skid = 0;
        if (w.slip > 1.1 && slide > 2.5) skid = clamp((w.slip - 1.1) * 0.35, 0, 1) * clamp((slide - 2.5) / 6, 0, 1);
        if (w.flat > 0 && car.speed > 3) skid = Math.max(skid, 0.25);
        if (loose && car.speed > 2) skid = Math.max(skid, 0.25 + skid);
        const dir = w.f;
        this.skids.add(key, w.cp, dir, w.width, skid * (wet > 0.5 ? 0.4 : 1), loose ? [0.18, 0.13, 0.08] : [0.02, 0.02, 0.02]);
        if (!loose && slide > 6 && w.slip > 1.4 && near) this.fx.tireSmoke(w.cp, v, clamp((slide - 6) / 12, 0.1, 1) * (1 - wet * 0.7) * dt * 60 * 0.5);
        const sand = loose && w.mat.name === 'sand';
        if (loose && (car.speed > 4 || (sand && slide > 2)) && near) this.fx.dust(w.cp, v, w.mat.dust || [0.5, 0.45, 0.35], clamp(car.speed / 20 + slide / 10, 0, 1) * dt * 40 * (sand ? 2.6 : 1));
        // sand: a rooster tail thrown up behind spinning tyres
        if (sand && slide > 3 && near) this.fx.dust(w.cp.clone().setY(w.cp.y + 0.25), _v.copy(v).multiplyScalar(-0.3).setY(3 + slide * 0.2), w.mat.dust, clamp(slide / 12, 0, 1) * dt * 50);
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
    this.peds?.update(dt);
    this.physics.step(dt, this.cars);
    for (const c of this.cars) c.processImpacts(dt);
    for (const c of this.cars) {
      if (c.physicsActive) c.update(dt, this.physics.time);
      else c.syncVisual(dt, this.physics.time);
    }
    this.city.update(dt);
    this.terrain.update(dt, this.camera.position);
    this.coast.update(dt, this.env.night);
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
    this.terrain.setWetness(this.env.wetness);
    this.coast.setWetness(this.env.wetness);
    this.coast.setNight(night);
    this.audio?.update?.(dt);
  }

  // ------------------------------------------------------------ state changes
  /** Career: spawn the current garage car and go. */
  startCareer(slot, fresh) {
    this.menus?.clear?.();
    this.career = fresh ? Career.fresh(this, slot) : Career.load(this, slot) || Career.fresh(this, slot);
    this.mode = 'career';
    this.police?.clearAll?.();
    if (this.police) this.police.heat = 0;
    this.spawnCareerCar(this.career.car, this.city.locations.garage);
    this.startDriving();
    if (fresh) this.tutorial?.start?.();
  }

  spawnCareerCar(entry, where) {
    const car = this.spawnPlayer(entry.cfg, where);
    car.careerId = entry.id;
    this.career.p.current = entry.id;
    this.career.restoreCar(car, entry);
    return car;
  }

  startFreeRoam() {
    this.menus?.clear?.();
    if (this.career) this.career.save();
    this.career = null;
    this.mode = 'free';
    if (this.player.car) this.removeCar(this.player.car);
    this.player.car = null;
    this.spawnPlayer(this.carConfig);
    this.startDriving();
  }

  /** Back to the main menu (saves the career). */
  quitToMenu() {
    if (this.career) this.career.save();
    this.activities?.abort?.();
    this.menus?.openMain();
  }

  startDriving() {
    this.state = 'play';
    this.hud.show(true);
    if (!this.startedOnce) {
      this.startedOnce = true;
      this.cam.setMode('cockpit');
      this.hud.camName('cockpit');
      setTimeout(() => {
        this.hud.toast('Welcome to <b>San Demo</b>. Click the key (or press <kbd>I</kbd>) to start the engine.', 'info', 7);
        this.hud.toast(`<kbd>C</kbd> cameras · <kbd>F1</kbd> controls · <kbd>Tab</kbd> phone · <kbd>Esc</kbd> ${this.career ? 'pause' : 'sandbox menu'}`, 'info', 7);
      }, 600);
    }
    this.audio?.resume?.();
  }

  render(dt) {
    const garage = this.state === 'garage' && this.garage;
    const scene = garage ? this.garage.scene : this.scene;
    const cam = garage ? this.garage.camera : this.camera;
    if (this.post && (this.settings.bloom || this.photo?.active)) this.post.render(dt, this, scene, cam);
    else this.renderer.render(scene, cam);
    if (!garage && this.player.mode === 'car') this.interior?.renderMirrors?.(this.renderer);
    this.hud.pipShown = false;
    if (!garage) this.hud.renderPip?.(this.renderer);
    const pf = document.getElementById('pip-frame');
    if (pf && !this.hud.pipShown) {
      pf.style.display = 'none';
      document.body.classList.remove('pip');
    }
  }

  // ------------------------------------------------------------ interaction zones & proving grounds
  zones(dt) {
    const car = this.player.car;
    const input = this.input;
    let prompt = null;
    if (this.player.mode !== 'car' || !car) return;
    const p = car.body.position;
    const kmh = car.speed * KMH;
    const city = this.city;
    // customs shop
    const gz = city.garageZone;
    if (gz && p.x > gz.x0 && p.x < gz.x1 && p.z > gz.z0 && p.z < gz.z1 && car.speed < 1.5) {
      prompt = this.career ? '<kbd>Enter</kbd> San Demo Customs — repairs, service, parts & paint' : '<kbd>Enter</kbd> San Demo Customs — repair & customize';
      if (input.keyPressed('Enter')) {
        if (!this.career) {
          car.repair();
          car.phys.pt.refill();
        }
        this.garage?.open('shop');
        return;
      }
    }
    // San Demo Motors
    const dz = this.dealer?.zone(car, input);
    if (dz) {
      prompt = dz;
      if (input.keyPressed('Enter')) {
        this.dealer.open();
        return;
      }
    }
    // car wash: roll through slowly
    const cw = city.carWash;
    if (cw && p.x > cw.x0 && p.x < cw.x1 && p.z > cw.z0 && p.z < cw.z1) {
      cw.spin = 0.5;
      if (car.speed > 3.5) prompt = 'Car wash: slow down to a crawl';
      else if (!this.washing) prompt = this.career ? '<kbd>Enter</kbd> Wash the car — $25' : '<kbd>Enter</kbd> Wash the car';
      if (!this.washing && car.speed <= 3.5 && input.keyPressed('Enter') && (!this.career || this.career.charge(25, 'Car wash'))) this.washing = 3;
      if (this.washing > 0) {
        this.washing -= dt;
        cw.spin = 1;
        prompt = 'Washing… 🫧';
        if (this.washing <= 0) {
          this.washing = 0;
          car.ext.wash();
          this.toast('Squeaky clean ✨', 'good', 2);
        }
      }
    } else if (this.washing > 0) this.washing = 0;
    // fuel pumps (combustion) and fast chargers (EV)
    if (car.speed < 1) {
      const pt = car.phys.pt;
      const spots = pt.ev ? city.chargers || [] : city.pumps || [];
      const wrong = pt.ev ? city.pumps || [] : city.chargers || [];
      for (const w of wrong) if (Math.hypot(p.x - w.x, p.z - w.z) < 3.8) prompt = pt.ev ? 'This is a fuel pump — EV chargers are on the west side' : 'That is an EV charger';
      for (const pump of spots) {
        if (Math.hypot(p.x - pump.x, p.z - pump.z) >= 3.8) continue;
        const frac = pt.energyFrac;
        const unitTxt = pt.ev ? `${Math.round(frac * 100)}%` : `${pt.fuel.toFixed(1)} / ${pt.tank} L`;
        const price = pt.ev ? 0.45 : 1.7;
        if (frac >= 0.995) prompt = pt.ev ? 'Battery full' : 'Tank full';
        else if (!pt.ev && !car.sys.fuelDoor) {
          prompt = '<kbd>Enter</kbd> Open the fuel door';
          if (input.keyPressed('Enter')) {
            car.sys.fuelDoor = true;
            this.audio?.click?.();
          }
        } else {
          prompt = `Hold <kbd>Enter</kbd> to ${pt.ev ? 'charge' : 'refuel'} (${unitTxt})${this.career ? ` · ${pt.ev ? '$0.45/kWh' : '$1.70/L'}` : ''}`;
          if (input.key('Enter')) {
            if (pt.running && !pt.ev) prompt = 'Turn the engine off first (<kbd>I</kbd>)';
            else {
              const rate = pt.ev ? dt * 2.2 : dt * 9; // kWh/s (sped up) or L/s
              const before = pt.ev ? pt.soc : pt.fuel;
              if (pt.ev) pt.soc = Math.min(pt.battery, pt.soc + rate);
              else pt.fuel = Math.min(pt.tank, pt.fuel + rate);
              const added = (pt.ev ? pt.soc : pt.fuel) - before;
              if (this.career && added > 0 && !this.career.charge(added * price, pt.ev ? 'Charging' : 'Fuel', true)) {
                if (pt.ev) pt.soc = before;
                else pt.fuel = before;
                prompt = 'Not enough money';
              }
              this.fuelingT = 0.4;
            }
          }
        }
        break;
      }
    }
    if (this.fuelingT > 0) {
      this.fuelingT -= dt;
      if (this.fuelingT <= 0) this.career?.flushReceipt?.();
    }
    // drag strip timing
    const ds = city.dragStrip;
    const drag = (this.drag ||= { state: 'idle', t: 0 });
    const onStrip = ds && !this.activities?.current && Math.abs(p.x - ds.x) < 7 && p.z > ds.start - 12 && p.z < ds.quarter + 30;
    if (onStrip) {
      if (drag.state === 'idle' && p.z < ds.start && p.z > ds.start - 12 && car.speed < 0.5) {
        drag.state = 'armed';
      }
      if (drag.state === 'armed') {
        prompt = 'Drag strip: launch when ready — quarter mile';
        if (p.z >= ds.start) {
          drag.state = 'run';
          drag.t = 0;
          drag.split = null;
        }
      } else if (drag.state === 'run') {
        drag.t += dt;
        if (!drag.split && kmh >= 100) drag.split = drag.t;
        this.timerBox(`⏱ ${drag.t.toFixed(2)} s · ${Math.round(kmh)} km/h${drag.split ? ` · 0-100 ${drag.split.toFixed(2)} s` : ''}`);
        if (p.z >= ds.quarter) {
          drag.state = 'idle';
          const best = !this.stats.bestDrag || drag.t < this.stats.bestDrag;
          if (best) this.stats.bestDrag = drag.t;
          this.hud.big(`${drag.t.toFixed(2)} s`, `Quarter mile · trap ${Math.round(kmh)} km/h${drag.split ? ` · 0-100 in ${drag.split.toFixed(2)} s` : ''}${best ? ' · NEW BEST' : ''}`, 4);
          setTimeout(() => this.timerBox(null), 4000);
        }
      }
    } else if (drag.state !== 'idle') {
      drag.state = 'idle';
      this.timerBox(null);
    }
    // skid pad lateral g
    const sp = city.skidpad;
    if (sp) {
      const d = Math.hypot(p.x - sp.x, p.z - sp.z);
      if (Math.abs(d - sp.r) < 10 && car.speed > 5) {
        this.skidT = 1;
        this.timerBox(`Skid pad · lateral ${(Math.abs(car.gforce.x) / 9.81).toFixed(2)} g · ${Math.round(kmh)} km/h`);
      } else if (this.skidT > 0 && (this.skidT -= dt) <= 0) this.timerBox(null);
    }
    this.lastKmh = kmh;
    this.hud.prompt(prompt || this.activityPrompt || null);
  }

  timerBox(text) {
    const el = document.getElementById('timer-box');
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = text;
  }
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

// ------------------------------------------------------------ boot
const loading = document.getElementById('loading');
const bar = loading.querySelector('.fill');
const msg = loading.querySelector('.msg');
// a tip on the loading screen, changing every few seconds
const LOAD_TIPS = [
  'Click the key in the cockpit (or press I) to start the engine. EVs need the brake held.',
  'Flash your hazards (J) after a mistake: other drivers accept the apology.',
  'Wanted? A respray at San Demo Customs makes the police lose your description.',
  'Hide in the car wash or the customs workshop to cool off a pursuit.',
  'Seatbelt (cockpit buckle) or you may fly through the windshield.',
  'Stunt jumps, speed traps and 25 hubcaps are hidden all over the map.',
  'Tab opens your phone: map, jobs, contacts, bank and the camera.',
  'F5 shows a replay of the last 30 seconds. F2 is photo mode.',
  'Cold tyres have less grip. Warm them up before you push.',
  'Stop signs mean stop: rolling through one is a ticket.',
];
const tipEl = document.getElementById('load-tip');
let tipI = Math.floor(Math.random() * LOAD_TIPS.length);
const showTip = () => tipEl && (tipEl.textContent = '💡 ' + LOAD_TIPS[tipI++ % LOAD_TIPS.length]);
showTip();
const tipTimer = setInterval(showTip, 3500);
const game = new Game();
window.game = game;
window.__THREE = THREE;
game
  .init((p, m) => {
    bar.style.width = `${Math.round(p * 100)}%`;
    if (m) msg.textContent = m;
  })
  .then(() => {
    bar.style.width = '100%';
    clearInterval(tipTimer);
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

function smashTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 208;
  const x = c.getContext('2d');
  const cx = 128, cy = 110;
  // jagged hole
  x.fillStyle = 'rgba(6,8,10,0.92)';
  x.beginPath();
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2, r = 55 + Math.random() * 45;
    x.lineTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r);
  }
  x.fill();
  // radial cracks in the remaining glass
  x.strokeStyle = 'rgba(230,240,250,0.8)';
  x.lineWidth = 1.4;
  for (let k = 0; k < 18; k++) {
    const a = Math.random() * Math.PI * 2;
    let px = cx + Math.cos(a) * 70, py = cy + Math.sin(a) * 60;
    x.beginPath();
    x.moveTo(px, py);
    for (let j = 0; j < 4; j++) {
      px += Math.cos(a + (Math.random() - 0.5)) * 14;
      py += Math.sin(a + (Math.random() - 0.5)) * 12;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
