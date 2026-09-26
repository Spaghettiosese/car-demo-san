import * as THREE from 'three';
import { buildTuning } from './specs.js';
import { VehiclePhysics } from './vehiclePhysics.js';
import { buildCarModel } from './carBuilder.js';
import { clamp, lerp, damp } from '../core/util.js';

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One vehicle in the world: physics + model + electrical systems + damage.
 * Player cars and NPCs are the same class; only the controller differs.
 */
export class Car {
  constructor(game, cfg, opts = {}) {
    this.id = NEXT_ID++;
    this.game = game;
    this.cfg = { ...cfg };
    this.opts = opts;
    this.npc = !!opts.npc;
    this.police = !!opts.police;
    this.isPlayer = false;
    this.tuning = buildTuning(this.cfg);
    this.phys = new VehiclePhysics(this.tuning);
    this.body = this.phys.body;
    this.model = buildCarModel(this.cfg, this.tuning, opts);
    this.root = this.model.root;
    this.root.userData.car = this;
    this.controller = null;
    this.impacts = [];
    this.scrape = 0;
    this.scrapePoint = new THREE.Vector3();
    this.scrapeNormal = new THREE.Vector3();
    this.lastImpact = 0;
    this.lastImpactBy = null;
    this.hitBy = new Map();
    this.age = 0;
    this.physicsActive = true; // false = kinematic "rail" LOD for far traffic
    this.visible = true;
    this.fuelLeak = 0;
    this.onFire = 0;
    this.smoke = 0;
    this.wrecked = false;
    this.sirenOn = false;
    this.lightsFlash = 0;
    this.hazardAuto = false;
    this.accel = new THREE.Vector3();
    this.prevVel = new THREE.Vector3();
    this.gforce = new THREE.Vector3();
    this.lastDeformUpdate = 0;
    this.pendingDeform = false;
    this.brakeHeat = [0, 0, 0, 0];
    this.sys = {
      ignition: 'off', // off | acc | on
      headlights: 0, // 0 off, 1 parking, 2 low
      high: false,
      flash: 0,
      indicator: 'none', // none | left | right
      hazard: false,
      blink: 0,
      blinkOn: false,
      indArmed: false,
      wipers: 0, // 0 off, 1 intermittent, 2 low, 3 high
      wiperAngle: 0,
      wiperDir: 1,
      wiperPause: 0,
      washer: 0,
      horn: false,
      window: 0,
      windowTarget: 0,
      dome: false,
      seatbelt: !opts.player,
      defrost: false,
      radio: 0,
      reverseLights: false,
      brakeLights: false,
    };
    this.computeBounds();
  }

  get position() {
    return this.body.position;
  }
  get speed() {
    return this.phys.speed;
  }
  get forwardSpeed() {
    return this.phys.forwardSpeed;
  }
  get engineRunning() {
    return this.phys.pt.running;
  }

  /** Local AABB (body frame) from the current deformed hull. */
  computeBounds() {
    const h = this.model.hull;
    const com = this.model.com;
    const min = (this.boundsMin ||= new THREE.Vector3());
    const max = (this.boundsMax ||= new THREE.Vector3());
    min.set(1e9, 1e9, 1e9);
    max.set(-1e9, -1e9, -1e9);
    for (let i = 0; i < h.length; i += 3) {
      const x = h[i] - com.x, y = h[i + 1] - com.y, z = h[i + 2] - com.z;
      if (x < min.x) min.x = x;
      if (y < min.y) min.y = y;
      if (z < min.z) min.z = z;
      if (x > max.x) max.x = x;
      if (y > max.y) max.y = y;
      if (z > max.z) max.z = z;
    }
    // hull points sit on the skin, pad slightly
    min.x -= 0.02; max.x += 0.02; min.z -= 0.02; max.z += 0.02;
    this.radius = Math.max(max.length(), min.length()) + 0.1;
    if (!this.hullLocal || this.hullLocal.length !== h.length) this.hullLocal = new Float32Array(h.length);
    for (let i = 0; i < h.length; i += 3) {
      this.hullLocal[i] = h[i] - com.x;
      this.hullLocal[i + 1] = h[i + 1] - com.y;
      this.hullLocal[i + 2] = h[i + 2] - com.z;
    }
  }

  placeAt(x, y, z, yaw) {
    this.phys.resetTo(x, y, z, yaw);
    this.prevVel.set(0, 0, 0);
    this.syncVisual(0);
  }

  // ------------------------------------------------------------------ systems
  startEngine() {
    const pt = this.phys.pt;
    if (pt.running) return;
    if (this.sys.ignition === 'off') this.sys.ignition = 'on';
    if (pt.auto && pt.selector !== 'P' && pt.selector !== 'N') pt.setSelector('P');
    pt.startCrank();
  }
  stopEngine() {
    this.phys.pt.shutOff();
    this.sys.ignition = 'off';
    if (this.phys.pt.auto) this.phys.pt.setSelector('P');
  }
  toggleEngine() {
    if (this.phys.pt.running || this.phys.pt.cranking) this.stopEngine();
    else this.startEngine();
  }
  cycleIgnition() {
    // key positions: off -> acc -> on(+crank) ; running -> off
    const s = this.sys;
    if (this.phys.pt.running) {
      this.stopEngine();
      return 'off';
    }
    if (s.ignition === 'off') s.ignition = 'acc';
    else if (s.ignition === 'acc') {
      s.ignition = 'on';
      this.game.audio?.chime?.('ignition');
    } else this.startEngine();
    return s.ignition;
  }
  get electrics() {
    return this.sys.ignition !== 'off' || this.phys.pt.running;
  }
  cycleHeadlights() {
    this.sys.headlights = (this.sys.headlights + 1) % 3;
    return this.sys.headlights;
  }
  setIndicator(dir) {
    const s = this.sys;
    s.indicator = s.indicator === dir ? 'none' : dir;
    s.blink = 0;
    s.indArmed = false;
  }
  toggleHazard() {
    this.sys.hazard = !this.sys.hazard;
    this.sys.blink = 0;
  }
  cycleWipers() {
    this.sys.wipers = (this.sys.wipers + 1) % 4;
    return this.sys.wipers;
  }

  // ------------------------------------------------------------------ damage
  /** Called by the physics system for every contact impulse (world space). */
  registerImpact(point, dirIntoCar, jn, other, slide, kind) {
    if (jn <= 0) return;
    this.impacts.push({ p: point.clone(), n: dirIntoCar.clone(), j: jn, other, slide: slide || 0, kind: kind || 'static' });
  }

  processImpacts(dt) {
    const list = this.impacts;
    if (!list.length) return;
    const clusters = [];
    for (const im of list) {
      let c = null;
      for (const cl of clusters) {
        if (cl.p.distanceToSquared(im.p) < 0.8 * 0.8 && cl.other === im.other) {
          c = cl;
          break;
        }
      }
      if (!c) {
        c = { p: im.p.clone(), n: new THREE.Vector3(), j: 0, other: im.other, kind: im.kind, slide: 0, count: 0 };
        clusters.push(c);
      }
      c.j += im.j;
      c.n.addScaledVector(im.n, im.j);
      c.p.lerp(im.p, im.j / c.j);
      c.slide = Math.max(c.slide, im.slide);
      c.count++;
    }
    list.length = 0;
    const settings = this.game.settings || {};
    const dmgMul = this.invulnerable ? 0 : settings.damage ?? 1;
    for (const c of clusters) {
      if (c.n.lengthSq() < 1e-8) continue;
      c.n.normalize();
      const dv = c.j / this.tuning.mass;
      if (dv < 0.6) continue;
      this.lastImpact = Math.max(this.lastImpact, dv);
      if (c.other) {
        this.lastImpactBy = c.other;
        this.hitBy.set(c.other.id, (this.hitBy.get(c.other.id) || 0) + dv);
      }
      this.game.onImpact?.(this, c.p, c.n, dv, c.other, c.kind);
      const threshold = 1.6;
      if (dv > threshold && dmgMul > 0) {
        const strength = (dv - threshold) * dmgMul;
        this.applyDamage(c.p, c.n, strength, dv);
      }
    }
  }

  /** Deform + break parts. p/n in world space, n = direction the metal is pushed. */
  applyDamage(p, n, strength, dv) {
    const m = this.model;
    const com = m.com;
    const lp = this.body.toLocalPoint(p, _v).add(com); // design space
    const ln = this.body.toLocalDir(n, _v2).normalize();
    const depth = Math.min(0.045 * strength, 0.65);
    const radius = clamp(0.35 + strength * 0.025, 0.35, 0.8);
    const moved = m.lattice.impact(lp, ln, depth, radius);
    if (moved > 0) this.pendingDeform = true;
    this.damageComponents(lp, ln, strength, dv, radius);
  }

  damageComponents(lp, ln, strength, dv, radius) {
    const m = this.model;
    const prof = m.prof;
    const b = prof.b;
    // body panels
    for (const part of m.allParts) {
      if (part.state === 'detached' || part.state === 'shattered') continue;
      const d = part.center.distanceTo(lp);
      const reach = part.name.startsWith('bumper') ? 1.1 : 1.0;
      if (d > reach + radius) continue;
      const fall = 1 - clamp((d - radius * 0.5) / (reach + radius), 0, 1);
      const isGlass = m.glassParts[part.name];
      const hit = strength * fall;
      if (isGlass) {
        part.health -= hit * 0.09;
        if (part.health < 0.72 && part.state === 'ok') this.crackGlass(part, lp);
        if (part.health < 0.2 || (dv > 16 && fall > 0.7)) this.shatterGlass(part);
      } else if (part.hinge) {
        part.health -= hit * (part.name.startsWith('bumper') ? 0.05 : 0.035);
        if (part.health < 0.55 && part.state === 'ok') {
          part.state = 'loose';
          this.game.onPartEvent?.(this, part, 'loose');
        }
        if (part.health < 0.08 && dv > 7) this.detachPart(part, ln);
      }
    }
    // lights
    for (const l of m.lights.all) {
      if (l.broken) continue;
      if (l.rest.distanceTo(lp) < radius + 0.25 && dv > 3) {
        l.broken = true;
        l.mat.emissiveIntensity = 0;
        l.mat.color.multiplyScalar(0.35);
        l.mesh.scale.multiplyScalar(0.97);
        this.game.fx?.glass(this.body.toWorldPoint(_v3.copy(l.rest).sub(m.com), new THREE.Vector3()), 6, l.mat.color);
        this.game.audio?.glass?.(this, 0.4);
      }
    }
    // mirrors
    for (const mr of m.details.mirrors) {
      if (!mr.attached) continue;
      if (mr.rest.distanceTo(lp) < radius + 0.35 && dv > 2.5) this.detachMirror(mr, ln);
    }
    // wheels / suspension
    this.phys.wheels.forEach((w, i) => {
      if (w.detached) return;
      const wc = _v3.set(w.center.x, w.center.y, w.center.z);
      const d = wc.distanceTo(lp);
      if (d > 0.9) return;
      const s = strength * (1 - d / 0.9);
      if (s > 2) {
        w.bend = Math.min(0.12, w.bend + s * 0.004);
        w.toe += (Math.random() - 0.5) * s * 0.006 + (ln.x * (w.left ? 1 : -1)) * s * 0.002;
        w.toe = clamp(w.toe, -0.2, 0.2);
        w.camber = clamp(w.camber + (Math.random() - 0.3) * s * 0.01, -0.25, 0.25);
      }
      if (s > 5 && Math.random() < 0.3) w.flat = 1;
      if (s > 11 || (s > 8 && Math.random() < 0.25)) this.detachWheel(i);
    });
    // engine / radiator (front, centre)
    const eng = _v3.set(0, 0.55, b.zones.cowl + 0.6);
    const pt = this.phys.pt;
    const de = eng.distanceTo(lp);
    if (de < 1.3) {
      const crush = m.lattice.localCrush(eng, 0.5);
      pt.health = Math.min(pt.health, clamp(1 - Math.max(0, crush - 0.06) * 3.2, 0, 1));
      const rad = m.lattice.localCrush(_v3.set(0, 0.55, prof.zF - 0.25), 0.4);
      pt.radiator = Math.min(pt.radiator, clamp(1 - Math.max(0, rad - 0.04) * 4, 0, 1));
      if (pt.health <= 0.02 && pt.running) {
        pt.shutOff();
        this.game.onPartEvent?.(this, null, 'engineDead');
      }
    }
    // fuel tank (rear, low)
    const tank = _v3.set(0, 0.35, b.axles[1] - 0.2);
    if (tank.distanceTo(lp) < 1.0 && strength > 9) this.fuelLeak = Math.min(1, this.fuelLeak + strength * 0.02);
  }

  crackGlass(part, lp) {
    part.state = 'cracked';
    this.game.onGlass?.(this, part, lp, false);
    const tint = this.model.glass;
    if (!part.crackMat) {
      part.crackMat = tint.clone();
      part.crackMat.color.setRGB(0.25, 0.27, 0.3);
      part.crackMat.opacity = Math.min(0.9, tint.opacity + 0.25);
      part.crackMat.roughness = 0.4;
    }
    part.mesh.material = part.crackMat;
  }

  shatterGlass(part) {
    if (part.state === 'shattered') return;
    part.state = 'shattered';
    part.mesh.visible = false;
    // spawn glass shards along the window
    const pos = part.mesh.geometry.attributes.position;
    const pts = [];
    const wp = new THREE.Vector3();
    part.mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < Math.min(pos.count, 40); i++) {
      const k = Math.floor(Math.random() * pos.count);
      wp.fromBufferAttribute(pos, k).applyMatrix4(part.mesh.matrixWorld);
      pts.push(wp.clone());
    }
    this.game.fx?.glassBurst(pts, this.body.velocity);
    this.game.onGlass?.(this, part, null, true);
  }

  detachPart(part, dir) {
    if (part.state === 'detached') return;
    part.state = 'detached';
    for (const ch of part.children) ch.state = 'detached';
    const debris = this.game.debris;
    if (debris) {
      part.group.updateWorldMatrix(true, true);
      const vel = this.body.pointVelocity(part.group.getWorldPosition(_v), new THREE.Vector3());
      const kick = this.body.toWorldDir(dir, new THREE.Vector3()).multiplyScalar(-2 - Math.random() * 2);
      kick.y += 2 + Math.random() * 2;
      debris.spawnFromObject(part.group, vel.add(kick), part.name.startsWith('door') ? 22 : part.name === 'hood' ? 16 : 9);
    } else part.group.visible = false;
    this.game.onPartEvent?.(this, part, 'detached');
  }

  detachMirror(mr, dir) {
    mr.attached = false;
    const debris = this.game.debris;
    if (debris) {
      mr.group.updateWorldMatrix(true, true);
      const vel = this.body.pointVelocity(mr.group.getWorldPosition(_v), new THREE.Vector3());
      vel.y += 1.5;
      debris.spawnFromObject(mr.group, vel, 1.2);
    } else mr.group.visible = false;
    this.game.audio?.clunk?.(this, 0.4);
  }

  detachWheel(i) {
    const w = this.phys.wheels[i];
    if (w.detached) return;
    w.detached = true;
    const wv = this.model.wheels[i];
    const debris = this.game.debris;
    if (debris) {
      wv.group.updateWorldMatrix(true, true);
      const vel = this.body.pointVelocity(wv.group.getWorldPosition(_v), new THREE.Vector3());
      const spin = new THREE.Vector3(w.omega, 0, 0);
      this.body.toWorldDir(spin, spin);
      debris.spawnWheel(wv.group, vel, spin, w.radius, w.width);
    } else wv.group.visible = false;
    this.game.onPartEvent?.(this, null, 'wheelOff');
  }

  repair() {
    const m = this.model;
    const debris = this.game.debris;
    m.lattice.reset();
    for (const p of m.allParts) {
      p.health = 1;
      if (p.state === 'detached' && p.group.userData.origParent) {
        if (debris) debris.reclaim(p.group);
        else p.group.userData.origParent.add(p.group);
      }
      p.group.visible = true;
      if (m.glassParts[p.name]) p.mesh.material = m.glass;
      p.state = 'ok';
      p.mesh.visible = true;
      p.userOpen = false;
      p.setAngle(0);
      p.angVel = 0;
    }
    for (const l of m.lights.all) {
      if (l.broken) {
        l.broken = false;
        l.mat.color.multiplyScalar(1 / 0.35);
        l.mesh.scale.multiplyScalar(1 / 0.97);
      }
    }
    for (const mr of m.details.mirrors) {
      if (!mr.attached) {
        mr.attached = true;
        if (debris && mr.group.userData.origParent) debris.reclaim(mr.group);
        mr.group.visible = true;
      }
    }
    this.phys.wheels.forEach((w, i) => {
      w.bend = 0;
      w.toe = 0;
      w.camber = 0;
      w.flat = 0;
      w.hp.copy(w.hp0);
      if (w.detached) {
        w.detached = false;
        const wv = m.wheels[i];
        if (debris && wv.group.userData.origParent) debris.reclaim(wv.group);
        else m.root.add(wv.group);
        wv.group.visible = true;
      }
    });
    const pt = this.phys.pt;
    pt.health = 1;
    pt.radiator = 1;
    pt.temp = Math.min(pt.temp, 90);
    this.fuelLeak = 0;
    this.onFire = 0;
    this.wrecked = false;
    m.applyDeformation();
    this.computeBounds();
    if (m.livery) this.game.repaintLivery?.(this);
  }

  /** 0..1 overall damage for the HUD. */
  damageSummary() {
    const m = this.model;
    let parts = 0, n = 0;
    for (const p of m.allParts) {
      if (m.glassParts[p.name] || p.name === 'under') continue;
      parts += p.state === 'detached' ? 1 : 1 - clamp(p.health, 0, 1);
      n++;
    }
    const body = clamp(m.lattice.totalDamage / 25, 0, 1);
    return {
      body: clamp(body * 0.7 + (parts / Math.max(n, 1)) * 0.6, 0, 1),
      engine: 1 - this.phys.pt.health,
      wheels: this.phys.wheels.map((w) => (w.detached ? 1 : clamp(w.bend * 6 + Math.abs(w.toe) * 3 + w.flat * 0.5, 0, 1))),
      glass: Object.values(m.glassParts).map((p) => (p.state === 'shattered' ? 1 : p.state === 'cracked' ? 0.5 : 0)),
    };
  }

  // ------------------------------------------------------------------ per frame
  update(dt, time) {
    this.age += dt;
    const s = this.sys;
    const pt = this.phys.pt;
    // g-forces (local)
    const v = this.body.velocity;
    if (dt > 0) {
      _v.copy(v).sub(this.prevVel).multiplyScalar(1 / dt);
      this.prevVel.copy(v);
      this.body.toLocalDir(_v, _v2);
      this.gforce.lerp(_v2, Math.min(1, dt * 12));
    }
    // deformation mesh refresh (throttled)
    if (this.pendingDeform && time - this.lastDeformUpdate > 0.05) {
      this.pendingDeform = false;
      this.lastDeformUpdate = time;
      this.model.applyDeformation();
      this.computeBounds();
      // suspension mounts follow the crushed structure
      for (const w of this.phys.wheels) {
        const hpDesign = _v.copy(w.hp0).add(this.model.com);
        const d = this.model.lattice.displacementAt(hpDesign, _v2);
        w.hp.copy(w.hp0).add(d.clampLength(0, 0.22));
      }
    }
    // indicator blink & self-cancel
    s.blink += dt;
    const period = 0.7;
    s.blinkOn = (s.indicator !== 'none' || s.hazard) && s.blink % period < period * 0.5;
    if (s.indicator !== 'none' && !s.hazard) {
      const st = this.phys.input.steer;
      const into = s.indicator === 'right' ? st : -st;
      if (into > 0.3) s.indArmed = true;
      if (s.indArmed && into < 0.06) {
        s.indicator = 'none';
        s.indArmed = false;
      }
    }
    // wipers
    if (s.wipers > 0 || s.wiperAngle > 0.001) {
      const speed = s.wipers === 3 ? 4.4 : 2.6;
      if (s.wiperPause > 0) s.wiperPause -= dt;
      else {
        s.wiperAngle += s.wiperDir * speed * dt;
        if (s.wiperAngle >= 1) {
          s.wiperAngle = 1;
          s.wiperDir = -1;
        } else if (s.wiperAngle <= 0) {
          s.wiperAngle = 0;
          s.wiperDir = 1;
          if (s.wipers === 1) s.wiperPause = 2.2;
          if (s.wipers === 0) s.wiperDir = 0;
          this.game.onWiperCycle?.(this);
        }
      }
      if (s.wipers > 0 && s.wiperDir === 0) s.wiperDir = 1;
    }
    if (s.washer > 0) s.washer -= dt;
    // windows
    s.window = damp(s.window, s.windowTarget, 3, dt);
    // brake heat
    const inp = this.phys.input;
    for (let i = 0; i < 4; i++) {
      const w = this.phys.wheels[i];
      const work = inp.brake * Math.abs(w.omega) * (w.front ? 1 : 0.6) * 0.004;
      this.brakeHeat[i] = clamp(this.brakeHeat[i] + work * dt * 60 - this.brakeHeat[i] * 0.08 * dt, 0, 1);
    }
    // fuel leak & fire
    if (this.fuelLeak > 0) pt.fuel = Math.max(0, pt.fuel - this.fuelLeak * 0.05 * dt);
    // engine smoke level
    this.smoke = pt.health < 0.6 ? (0.6 - pt.health) / 0.6 : 0;
    if (pt.radiator < 0.8 && pt.running) this.smoke = Math.max(this.smoke, 0.25 * (1 - pt.radiator));
    this.wrecked = pt.health <= 0.02 || this.phys.wheels.filter((w) => w.detached).length >= 2;
    this.lastImpact = Math.max(0, this.lastImpact - dt * 20);
    this.animateParts(dt);
    this.syncVisual(dt, time);
  }

  animateParts(dt) {
    const m = this.model;
    const b = this.body;
    // local acceleration / wind drive loose panels
    const fwdSpeed = this.phys.forwardSpeed;
    const acc = this.gforce;
    for (const p of m.allParts) {
      if (!p.hinge || p.state === 'detached') continue;
      const h = p.hinge;
      let target = 0;
      let torque = 0;
      if (p.userOpen) target = h.max * 0.9;
      if (p.state === 'loose') {
        if (p.name.startsWith('door')) torque = -acc.z * 0.5 * (p.name.endsWith('L') ? 1 : 1) + (Math.random() - 0.5) * 2;
        else if (p.name === 'hood') torque = fwdSpeed > 12 ? fwdSpeed * fwdSpeed * 0.02 : -2;
        else if (p.name === 'trunk') torque = -acc.z * 0.3 - 1.5;
        else torque = -1.5 + Math.abs(acc.y) * 0.2;
      }
      if (p.state === 'loose' || p.userOpen) {
        const spring = p.userOpen ? 30 : p.name.startsWith('bumper') ? 25 : 0.5;
        const rest = p.name.startsWith('bumper') ? h.max * (1 - p.health) : target;
        let a = p.angle * h.sign;
        p.angVel += (torque + (rest - a) * spring - p.angVel * 3) * dt;
        a += p.angVel * dt;
        if (a < 0) {
          a = 0;
          if (p.angVel < -3) this.game.audio?.clunk?.(this, Math.min(1, -p.angVel * 0.08));
          p.angVel *= -0.3;
        }
        if (a > h.max) {
          a = h.max;
          p.angVel *= -0.2;
        }
        p.setAngle(a * h.sign);
        // hood flying off at speed
        if (p.name === 'hood' && a > h.max * 0.95 && fwdSpeed > 30 && p.health < 0.3) this.detachPart(p, new THREE.Vector3(0, -1, 0));
      } else if (p.angle !== 0) {
        const a = damp(p.angle, 0, 8, dt);
        p.setAngle(Math.abs(a) < 1e-3 ? 0 : a);
      }
    }
    void b;
  }

  syncVisual(dt, time = 0) {
    const b = this.body;
    const root = this.root;
    root.position.copy(b.position);
    root.quaternion.copy(b.quaternion);
    this.phys.updateWheelPoses();
    const m = this.model;
    // wheels (root-local)
    this.phys.wheels.forEach((w, i) => {
      if (w.detached) return;
      const wv = m.wheels[i];
      wv.group.position.set(w.hp.x, w.hp.y - w.s, w.hp.z);
      const bend = w.bend ? Math.sin(w.spin) * w.bend : 0;
      const camber = (w.camber + bend) * (w.left ? 1 : -1);
      wv.group.rotation.set(0, w.yaw, camber, 'YZX');
      wv.spin.rotation.x = w.spin;
      const flat = 1 - 0.18 * w.flat;
      wv.spin.scale.set(1, flat, 1);
      if (wv.discMat.emissiveIntensity !== undefined && !this.npc) wv.discMat.emissiveIntensity = Math.max(0, this.brakeHeat[i] - 0.35) * 3;
    });
    this.updateLights(time);
    // wipers
    const wa = this.sys.wiperAngle;
    for (const [i, wp] of m.details.wipers.entries()) wp.rotation.y = -wa * 1.45 * (i === 0 ? 1 : 1);
    // police bar
    if (m.details.lightbar) {
      const lb = m.details.lightbar;
      if (this.sirenOn) {
        const ph = (time * 3.2) % 1;
        const strobe = ((time * 14) | 0) % 2;
        lb.red.emissiveIntensity = ph < 0.5 ? 4 * strobe + 1 : 0.1;
        lb.blue.emissiveIntensity = ph >= 0.5 ? 4 * strobe + 1 : 0.1;
      } else {
        lb.red.emissiveIntensity = 0;
        lb.blue.emissiveIntensity = 0;
      }
    }
  }

  updateLights(time) {
    const s = this.sys;
    const m = this.model;
    const L = m.lights;
    const el = this.electrics;
    const inp = this.phys.input;
    const pt = this.phys.pt;
    s.brakeLights = el && inp.brake > 0.05;
    s.reverseLights = el && pt.gear < 0;
    const headOn = el && s.headlights === 2;
    const flash = s.flash > 0 || this.lightsFlash > 0;
    const high = (s.high && headOn) || flash;
    for (const u of L.head) {
      if (u.broken) continue;
      u.mat.emissiveIntensity = high ? 5 : headOn ? 3.2 : s.headlights === 1 || (el && pt.running) ? 0.5 : 0;
    }
    const tailBase = s.headlights >= 1 ? 1.0 : 0;
    for (const u of L.tail) {
      if (u.broken) continue;
      u.mat.emissiveIntensity = s.brakeLights ? 4.5 : tailBase;
    }
    if (L.brake3) L.brake3.mat.emissiveIntensity = s.brakeLights ? 4 : 0;
    const ind = s.blinkOn;
    for (const u of [...L.indF, ...L.indR]) {
      if (u.broken) continue;
      const side = u.side > 0 ? 'left' : 'right';
      const on = ind && (s.hazard || s.indicator === side);
      u.mat.emissiveIntensity = on ? 4 : 0;
    }
    for (const u of L.reverse) if (!u.broken) u.mat.emissiveIntensity = s.reverseLights ? 3 : 0;
    if (s.flash > 0) s.flash -= 1 / 60;
    if (this.lightsFlash > 0) this.lightsFlash -= 1 / 60;
    void time;
  }

  /** Is the headlight on this side still working? (for the player's real spotlights) */
  headlightOk(side) {
    const u = this.model.lights.head.find((h) => h.side === side);
    return u && !u.broken;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose?.();
    });
  }
}
