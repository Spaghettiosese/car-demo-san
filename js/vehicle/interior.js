import * as THREE from 'three';
import { makeCanvas, canvasTexture, roundRect } from '../core/canvas.js';
import { clamp, damp, lerp, KMH, MPH } from '../core/util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const ray = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

function mat(color, rough = 0.8, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

/**
 * The player's cockpit: modelled interior, live gauges, clickable controls,
 * mirrors, windshield rain/cracks/fog, airbag. Built for any body style from
 * its seat/cowl/beltline dimensions.
 */
export class Interior {
  constructor(game, car) {
    this.game = game;
    this.car = car;
    this.group = new THREE.Group();
    car.model.design.add(this.group);
    this.clickables = [];
    this.hovered = null;
    this.t = 0;
    this.sweep = 0; // gauge self-test on ignition
    this.lastIgnition = car.sys.ignition;
    this.airbag = 0;
    this.fog = 0.0;
    this.drops = [];
    this.cracks = [];
    this.gloveOpen = false;
    this.visor = false;
    this.mirrorFrame = 0;
    this.chimeTimer = 0;
    this.build();
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.mirrorRT?.dispose();
    for (const m of this.sideMirrors || []) {
      m.rt.dispose();
      m.glass.material = m.orig;
    }
  }

  /** The door mirrors get live views (their own cameras and render targets). */
  buildSideMirrors() {
    this.sideMirrors = [];
    for (const d of this.car.model.details.mirrors || []) {
      const rt = new THREE.WebGLRenderTarget(256, 144, { type: THREE.HalfFloatType });
      rt.texture.repeat.x = -1; // a mirror image
      rt.texture.offset.x = 1;
      const cam = new THREE.PerspectiveCamera(34, 256 / 144, 0.3, 160);
      const mat = new THREE.MeshBasicMaterial({ map: rt.texture });
      const orig = d.glass.material;
      d.glass.material = mat;
      this.sideMirrors.push({ d, rt, cam, mat, orig, glass: d.glass, idx: d.side > 0 ? 0 : 1 });
    }
  }

  get prof() {
    return this.car.model.prof;
  }

  // ---------------------------------------------------------------- build
  build() {
    const car = this.car;
    const prof = this.prof;
    const b = prof.b;
    const f = prof.f;
    const Z = b.zones;
    const seat = b.seat;
    const sx = seat.x, sy = seat.y, sz = seat.z;
    const g = this.group;
    const dark = mat(0x1b1c1f, 0.85);
    const soft = mat(0x26272b, 0.95);
    const trim = mat(0x3a3b40, 0.5, 0.3);
    const alu = mat(0x9ea3aa, 0.3, 0.9);
    const leather = mat(new THREE.Color(car.cfg.interiorColor || '#2b2521').getHex(), 0.7);
    this.mats = { dark, soft, trim, alu, leather };
    const cowlY = f.top(Z.cowl);
    const dashTop = Math.min(cowlY - 0.02, sy - 0.2);
    const hwCab = f.hw(sz + 0.5) * 0.9;

    // ---- dashboard (extruded side profile, spans the cabin) ----
    const dz = Z.cowl - 0.02;
    const shape = new THREE.Shape();
    const back = sz + 0.62;
    shape.moveTo(dz, dashTop - 0.02);
    shape.lineTo(dz, dashTop - 0.5);
    shape.lineTo(back + 0.05, sy - 0.78);
    shape.lineTo(back - 0.02, sy - 0.62);
    shape.quadraticCurveTo(back - 0.03, sy - 0.38, back + 0.06, sy - 0.33);
    shape.quadraticCurveTo(back + 0.25, dashTop + 0.02, dz, dashTop - 0.02);
    const dash = new THREE.ExtrudeGeometry(shape, { depth: hwCab * 2, bevelEnabled: false, curveSegments: 10 });
    dash.rotateY(-Math.PI / 2); // shape x(z) -> world z, extrude -> world x
    // rotateY(-90deg) maps (x, y, z) -> (-z, y, x): profile x becomes car z, extrusion spans car x
    dash.translate(hwCab, 0, 0);
    const dashMesh = new THREE.Mesh(dash, soft);
    dashMesh.receiveShadow = true;
    g.add(dashMesh);
    this.dash = dashMesh;

    // instrument hood + cluster
    const clusterPos = new THREE.Vector3(sx, sy - 0.22, sz + 0.72);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 20, 1, true, -Math.PI / 2, Math.PI), dark);
    hood.rotation.z = Math.PI / 2;
    hood.rotation.y = 0;
    hood.scale.set(1, 1, 0.55);
    hood.position.set(sx, clusterPos.y + 0.02, clusterPos.z + 0.06);
    g.add(hood);
    this.clusterCanvas = makeCanvas(1024, 384);
    this.clusterCtx = this.clusterCanvas.getContext('2d');
    this.clusterTex = canvasTexture(this.clusterCanvas);
    this.clusterMat = new THREE.MeshBasicMaterial({ map: this.clusterTex, toneMapped: true });
    const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.158), this.clusterMat);
    cluster.position.copy(clusterPos);
    cluster.rotation.set(0.35, Math.PI, 0);
    g.add(cluster);
    this.cluster = cluster;
    this.tripPage = 0;
    this.clickable([cluster], (hit) => {
      const right = hit && hit.uv && hit.uv.x > 0.5;
      return right ? 'Trip computer: <b>reset</b> trip' : 'Trip computer: <b>next page</b>';
    }, (hit) => {
      const right = hit && hit.uv && hit.uv.x > 0.5;
      if (right) {
        const page = this.tripPage % 8;
        this.car.ext.resetTrip(page === 1 ? 'b' : 'a');
        this.game.toast(`Trip ${page === 1 ? 'B' : 'A'} reset`);
      } else this.tripPage = (this.tripPage + 1) % 8;
      this.game.audio?.click?.();
    });

    // ---- steering column + wheel ----
    const wheelCenter = new THREE.Vector3(sx, sy - 0.33, sz + 0.5);
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.copy(wheelCenter);
    this.wheelPivot.rotation.x = -0.38; // tilt toward the driver
    g.add(this.wheelPivot);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.36, 10), dark);
    column.rotation.x = Math.PI / 2;
    column.position.set(0, 0, 0.2);
    this.wheelPivot.add(column);
    this.wheel = new THREE.Group();
    this.wheelPivot.add(this.wheel);
    const style = car.cfg.wheelStyleInterior || 'stock';
    const rimR = style === 'sport' ? 0.17 : style === 'classic' ? 0.2 : 0.185;
    const rimMat = style === 'classic' ? mat(0x6b4a2e, 0.45) : style === 'sport' ? mat(0x1a1a1a, 0.95) : leather;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, style === 'sport' ? 0.022 : style === 'classic' ? 0.012 : 0.018, 10, 40), rimMat);
    this.wheel.add(rim);
    if (style === 'sport') {
      // top-dead-centre stripe
      const tdc = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.046), mat(0xff6a1f, 0.6));
      tdc.position.set(0, rimR, 0);
      this.wheel.add(tdc);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.05, 20), dark);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    const logoTex = makeLogo();
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshStandardMaterial({ map: logoTex, metalness: 0.8, roughness: 0.3 }));
    logo.position.z = -0.027;
    logo.rotation.y = Math.PI;
    this.wheel.add(logo);
    for (const a of [Math.PI / 2 + 0.2, -Math.PI / 2 - 0.2, Math.PI * 1.5 + Math.PI]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(rimR - 0.05, 0.028, 0.012), dark);
      sp.position.set(Math.cos(a) * (rimR / 2 + 0.03), Math.sin(a) * (rimR / 2 + 0.03), 0);
      sp.rotation.z = a;
      this.wheel.add(sp);
    }
    this.hornPad = hub;
    this.clickable([hub, logo], () => 'Horn', () => this.honkClick(), { hold: true });
    // hands at 9 and 3
    const skin = mat(0x2d2a28, 0.9);
    this.hands = [];
    for (const s of [1, -1]) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skin);
      h.scale.set(1.1, 1.5, 0.9);
      this.wheel.add(h);
      h.position.set(s * rimR, 0, -0.01);
      this.hands.push(h);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1, 8), mat(0x2b3a55, 0.9));
      g.add(arm);
      h.userData.arm = arm;
      h.userData.shoulder = new THREE.Vector3(sx + s * 0.2, sy - 0.25, sz - 0.05);
    }

    // ---- stalks ----
    const stalkL = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.17, 8), dark);
    stalkL.rotation.z = Math.PI / 2 - 0.15;
    stalkL.position.set(0.12, 0.02, 0.1);
    this.wheelPivot.add(stalkL);
    const stalkR = stalkL.clone();
    stalkR.rotation.z = -Math.PI / 2 + 0.15;
    stalkR.position.set(-0.12, 0.02, 0.1);
    this.wheelPivot.add(stalkR);
    this.stalkL = stalkL;
    this.stalkR = stalkR;
    const tipL = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.04, 10), trim);
    tipL.position.y = 0.09;
    stalkL.add(tipL);
    const tipR = tipL.clone();
    stalkR.add(tipR);
    this.clickable([stalkL], (hit) => (this.stalkLocal(stalkL, hit) ? 'Indicator: <b>right</b> ▶' : 'Indicator: <b>left</b> ◀'), (hit) => {
      this.car.setIndicator(this.stalkLocal(stalkL, hit) ? 'right' : 'left');
      this.game.audio?.click?.();
    });
    this.clickable([tipL], () => 'High beams (<kbd>K</kbd>)', () => {
      this.car.sys.high = !this.car.sys.high;
      this.game.audio?.click?.();
    });
    this.clickable([stalkR], () => `Wipers: <b>${['off', 'intermittent', 'low', 'high'][this.car.sys.wipers]}</b> (<kbd>V</kbd>)`, () => {
      this.car.cycleWipers();
      this.game.audio?.click?.();
    });
    this.clickable([tipR], () => 'Windshield washer', () => {
      this.car.sys.washer = 1.2;
      this.game.audio?.washer?.();
    });

    // ---- ignition key (right of the column) ----
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16), alu);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(-0.11, -0.06, 0.18);
    this.wheelPivot.add(barrel);
    this.key = new THREE.Group();
    this.key.position.set(-0.11, -0.06, 0.16);
    const keyHead = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.012), mat(0x111111, 0.4));
    keyHead.position.z = -0.03;
    const keyBlade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.022, 0.03), alu);
    keyBlade.position.z = -0.01;
    const fob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat(0xff6a1f, 0.4));
    fob.position.set(0, -0.04, -0.035);
    this.key.add(keyHead, keyBlade, fob);
    this.wheelPivot.add(this.key);
    if (car.phys.pt.ev) {
      // EVs have a START/STOP button instead of a key
      this.key.visible = false;
      barrel.visible = false;
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 20), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: new THREE.Color(0.2, 0.6, 1), emissiveIntensity: 0.3, roughness: 0.4 }));
      btn.rotation.x = Math.PI / 2;
      btn.position.set(-0.11, -0.06, 0.17);
      this.wheelPivot.add(btn);
      this.startBtn = btn;
      this.clickable([btn], () => {
        const pt = this.car.phys.pt;
        if (pt.running) return 'Power: <b>OFF</b>';
        return 'START (hold the brake <kbd>S</kbd>)';
      }, () => {
        const pt = this.car.phys.pt;
        if (pt.running) this.car.stopEngine();
        else if (this.car.phys.input.brake < 0.3 && this.game.input.drive().brake < 0.3) this.game.toast('Press the brake pedal to start');
        else this.car.startEngine();
        this.game.audio?.click?.();
      });
    }
    this.clickable([keyHead, keyBlade, barrel, fob], () => {
      const pt = this.car.phys.pt;
      if (pt.running) return 'Ignition: <b>turn off</b> engine';
      if (pt.cranking) return 'Cranking…';
      const s = this.car.sys.ignition;
      return s === 'off' ? 'Ignition: <b>ACC</b> (radio)' : s === 'acc' ? 'Ignition: <b>ON</b> (dash lights)' : 'Ignition: <b>START</b> engine';
    }, () => {
      const st = this.car.cycleIgnition();
      this.game.audio?.keyTurn?.();
      if (st === 'off') this.game.toast('Engine off');
    });

    // ---- light switch knob (dash, left of the wheel) ----
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.025, 16), trim);
    knob.rotation.x = Math.PI / 2 + 0.3;
    knob.position.set(sx + 0.3, sy - 0.36, sz + 0.66);
    g.add(knob);
    const knobMark = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, 0.004), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    knobMark.position.set(0, 0.015, -0.012);
    knob.add(knobMark);
    this.lightKnob = knob;
    this.clickable([knob, knobMark], () => `Headlights: <b>${['off', 'parking', 'on', 'AUTO'][this.car.sys.headlights]}</b> (<kbd>L</kbd>)`, () => {
      this.car.cycleHeadlights();
      this.game.audio?.click?.();
    });
    // fog light button next to the knob
    this.fogBtn = this.button(g, sx + 0.3, sy - 0.42, sz + 0.66, 0.035, 0.02, 0x2a2a2a, [0.3, 1, 0.4], () => `Fog lights: <b>${['off', 'front', 'front + rear'][this.car.sys.fog]}</b> (<kbd>.</kbd>)`, () => this.car.cycleFog());
    // hood release lever under the dash
    const hoodLever = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.06), mat(0x222222, 0.6));
    hoodLever.position.set(sx + 0.36, sy - 0.72, sz + 0.62);
    g.add(hoodLever);
    this.clickable([hoodLever], () => 'Hood release', () => {
      const hood = this.car.model.parts.hood;
      if (hood && hood.state !== 'detached') {
        hood.userOpen = !hood.userOpen;
        this.game.audio?.clunk?.(this.car, 0.4);
        if (hood.userOpen) this.game.toast('Hood unlatched — it will fly up if you drive fast!', 'warn');
      }
    });
    // trunk & fuel door releases on the floor by the seat
    this.trunkBtn = this.button(g, sx + 0.33, sy - 0.62, sz + 0.05, 0.03, 0.015, 0x333333, null, () => 'Trunk release', () => {
      const t = this.car.model.parts.trunk;
      if (t && t.state !== 'detached') t.userOpen = !t.userOpen;
      this.game.audio?.clunk?.(this.car, 0.3);
    });
    this.fuelBtn = this.button(g, sx + 0.33, sy - 0.62, sz - 0.02, 0.03, 0.015, 0x333333, null, () => `Fuel door: <b>${this.car.sys.fuelDoor ? 'open' : 'closed'}</b>`, () => {
      this.car.sys.fuelDoor = !this.car.sys.fuelDoor;
      this.game.audio?.click?.();
    });
    // cruise control stalk (lower right of the column)
    const cstalk = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.11, 8), mat(0x222222, 0.6));
    cstalk.rotation.z = -Math.PI / 2 + 0.5;
    cstalk.position.set(-0.11, -0.04, 0.12);
    this.wheelPivot.add(cstalk);
    this.clickable([cstalk], () => {
      const cr = this.car.ext.cruise;
      return cr.on ? `Cruise: <b>${this.game.fmtSpeed(cr.speed)}</b> — click to cancel` : 'Cruise control: set (<kbd>O</kbd>)';
    }, () => this.game.toggleCruise(this.car));
    // choke knob on carburettor cars
    if (car.phys.pt.spec.carb) {
      const choke = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), mat(0xd8d2c0, 0.5));
      choke.rotation.x = Math.PI / 2;
      choke.position.set(sx + 0.2, sy - 0.45, sz + 0.66);
      g.add(choke);
      this.chokeKnob = choke;
      this.clickable([choke], () => `Choke: <b>${this.car.phys.pt.choke > 0.5 ? 'pulled out' : 'in'}</b> (cold starts)`, () => {
        const pt = this.car.phys.pt;
        pt.choke = pt.choke > 0.5 ? 0 : 1;
        this.game.audio?.click?.();
      });
    }

    // ---- centre stack: hazard, screen, climate ----
    const stackZ = sz + 0.66;
    const hazard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a1111, emissive: new THREE.Color(1, 0.1, 0.05), emissiveIntensity: 0 }));
    hazard.position.set(0, sy - 0.25, stackZ + 0.02);
    hazard.rotation.x = 0.35;
    g.add(hazard);
    this.hazardBtn = hazard;
    this.clickable([hazard], () => 'Hazard lights (<kbd>J</kbd>)', () => {
      this.car.toggleHazard();
      this.game.audio?.click?.();
    });
    this.screenCanvas = makeCanvas(512, 320);
    this.screenCtx = this.screenCanvas.getContext('2d');
    this.screenTex = canvasTexture(this.screenCanvas);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    screen.position.set(0, sy - 0.36, stackZ - 0.02);
    screen.rotation.set(0.25, Math.PI, 0);
    g.add(screen);
    this.screen = screen;
    this.clickable([screen], (hit) => {
      const uv = hit && hit.uv;
      if (!uv) return 'Radio';
      if (uv.y < 0.3) return uv.x < 0.33 ? 'Radio: <b>previous</b>' : uv.x < 0.66 ? 'Radio: <b>on / off</b>' : 'Radio: <b>next</b>';
      return 'Radio (<kbd>N</kbd> next station)';
    }, (hit) => {
      const uv = hit && hit.uv;
      const a = this.game.audio;
      if (!a) return;
      if (uv && uv.y < 0.3) {
        if (uv.x < 0.33) a.prevStation?.();
        else if (uv.x < 0.66) a.toggleRadio?.();
        else a.nextStation?.();
      } else a.nextStation?.();
      this.game.audio?.click?.();
    });
    // climate panel with a defrost button
    const climate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.02), dark);
    climate.position.set(0, sy - 0.47, stackZ - 0.05);
    climate.rotation.x = -0.2;
    g.add(climate);
    const defrost = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.012), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color(1, 0.55, 0.1), emissiveIntensity: 0 }));
    defrost.position.set(-0.06, 0, -0.013);
    climate.add(defrost);
    this.defrostBtn = defrost;
    this.clickable([defrost], () => `Windshield defrost: <b>${this.car.sys.defrost ? 'on' : 'off'}</b>`, () => {
      this.car.sys.defrost = !this.car.sys.defrost;
      this.game.audio?.click?.();
    });
    const cy = sy - 0.47, cz = stackZ - 0.065;
    this.rearDefBtn = this.button(climate, 0.06, 0, -0.013, 0.045, 0.028, 0x333333, [1, 0.55, 0.1], () => `Rear window defrost: <b>${this.car.sys.rearDefrost ? 'on' : 'off'}</b>`, () => (this.car.sys.rearDefrost = !this.car.sys.rearDefrost), true);
    this.acBtn = this.button(climate, 0, 0, -0.013, 0.04, 0.028, 0x333333, [0.2, 0.7, 1], () => `A/C: <b>${this.car.sys.ac ? 'on' : 'off'}</b> (dries the air, loads the engine)`, () => (this.car.sys.ac = !this.car.sys.ac), true);
    // fan and temperature knobs
    const knobGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.02, 16);
    knobGeo.rotateX(Math.PI / 2);
    this.fanKnob = new THREE.Mesh(knobGeo, trim);
    this.fanKnob.position.set(0.09, cy - 0.045, cz);
    this.tempKnob = new THREE.Mesh(knobGeo, trim);
    this.tempKnob.position.set(-0.09, cy - 0.045, cz);
    for (const k of [this.fanKnob, this.tempKnob]) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.014, 0.003), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mark.position.set(0, 0.01, -0.011);
      k.add(mark);
      g.add(k);
    }
    this.clickable([this.fanKnob], () => `Fan: <b>${['off', '1', '2', '3'][this.car.sys.fan]}</b>`, () => {
      this.car.sys.fan = (this.car.sys.fan + 1) % 4;
      this.game.audio?.click?.();
    });
    this.clickable([this.tempKnob], (hit) => `Temperature: <b>${this.car.sys.climateTemp}°C</b> — click ${this.knobSide(this.tempKnob, hit) > 0 ? 'warmer' : 'cooler'}`, (hit) => {
      const s2 = this.car.sys;
      s2.climateTemp = clamp(s2.climateTemp + (this.knobSide(this.tempKnob, hit) > 0 ? 1 : -1), 16, 28);
      this.game.audio?.click?.();
    });
    // console buttons: drive mode, traction control, parking brake, mirror fold
    const by = sy - 0.53, bz = sz + 0.5;
    this.modeBtn = this.button(g, 0.07, by, bz, 0.04, 0.02, 0x2a2a2a, [0.2, 0.9, 0.3], () => `Drive mode: <b>${this.car.phys.pt.mode.toUpperCase()}</b> (<kbd>,</kbd>)`, () => {
      const order = ['eco', 'normal', 'sport'];
      const pt = this.car.phys.pt;
      pt.mode = order[(order.indexOf(pt.mode) + 1) % 3];
    });
    this.tcsBtn = this.button(g, -0.07, by, bz, 0.04, 0.02, 0x2a2a2a, [1, 0.6, 0.1], () => `Traction &amp; stability control: <b>${this.car.tuning.assists.tcs ? 'on' : 'OFF'}</b>`, () => {
      const a = this.car.tuning.assists;
      a.tcs = !a.tcs;
      a.esc = a.tcs;
      this.game.toast(a.tcs ? 'TCS / ESC on' : 'TCS / ESC OFF — good luck');
    });
    if (car.cfg.body !== 'classic') {
      this.epbBtn = this.button(g, 0, by - 0.01, bz - 0.12, 0.035, 0.02, 0x2a2a2a, [1, 0.15, 0.1], () => `Electronic parking brake: <b>${this.car.parkLever ? 'applied' : 'released'}</b>`, () => {
        this.car.parkLever = !this.car.parkLever;
        this.game.audio?.ratchet?.();
      });
    }
    this.foldBtn = this.button(g, sx + 0.25, sy - 0.47, sz + 0.62, 0.03, 0.018, 0x2a2a2a, null, () => `Mirrors: <b>${this.car.sys.mirrorsFolded ? 'folded' : 'out'}</b>`, () => (this.car.sys.mirrorsFolded = !this.car.sys.mirrorsFolded));
    // mirror adjust pad: centre picks the mirror, the edges tilt it
    this.mirrorSel = 0;
    this.mirrorAdj = this.car.sys.mirrorAdj ||= [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }];
    const pad = this.button(g, sx + 0.25, sy - 0.47, sz + 0.58, 0.036, 0.036, 0x30343a, null, () => (this.mirrorSel ? `Adjusting the <b>${this.mirrorSel === 1 ? 'left' : 'right'}</b> mirror — click the pad's edges to tilt it, the centre to switch` : 'Mirror adjust — click the centre to pick a mirror'), (hit) => {
      const lp = hit ? pad.worldToLocal(hit.point.clone()) : new THREE.Vector3();
      if (Math.abs(lp.x) < 0.007 && Math.abs(lp.y) < 0.007) {
        this.mirrorSel = (this.mirrorSel + 1) % 3;
        return;
      }
      if (!this.mirrorSel) this.mirrorSel = 1;
      const a = this.mirrorAdj[this.mirrorSel - 1];
      if (Math.abs(lp.x) > Math.abs(lp.y)) a.yaw = clamp(a.yaw + (lp.x < 0 ? 0.03 : -0.03), -0.35, 0.35);
      else a.pitch = clamp(a.pitch + (lp.y > 0 ? 0.02 : -0.02), -0.25, 0.25);
    });
    this.mirrorPad = pad;
    // radio volume knob on the screen bezel
    const vol = new THREE.Mesh(knobGeo, alu);
    vol.position.set(0.15, sy - 0.36, stackZ - 0.025);
    g.add(vol);
    this.volKnob = vol;
    this.clickable([vol], (hit) => `Radio volume: <b>${Math.round((this.game.settings.radioVolume || 0) * 100)}%</b> — click ${this.knobSide(vol, hit) > 0 ? 'louder' : 'quieter'}`, (hit) => {
      const st = this.game.settings;
      st.radioVolume = clamp((st.radioVolume || 0) + (this.knobSide(vol, hit) > 0 ? 0.1 : -0.1), 0, 1);
      this.game.audio?.applyVolumes?.();
      this.game.audio?.click?.();
    });

    // ---- centre console, gear selector, handbrake ----
    const consoleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.75), dark);
    consoleMesh.position.set(0, sy - 0.62, sz + 0.2);
    g.add(consoleMesh);
    this.shifter = new THREE.Group();
    this.shifter.position.set(0.02, sy - 0.55, sz + 0.34);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 8), alu);
    shaft.position.y = 0.06;
    const knobG = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), leather);
    knobG.position.y = 0.13;
    knobG.scale.set(1, 1.2, 1.3);
    this.shifter.add(shaft, knobG);
    g.add(this.shifter);
    this.clickable([shaft, knobG], () => {
      const pt = this.car.phys.pt;
      if (!pt.auto) return `Gear: <b>${pt.gear < 0 ? 'R' : pt.gear === 0 ? 'N' : pt.gear}</b> — click front to shift up, back to shift down (or <kbd>1</kbd>-<kbd>${pt.gearCount}</kbd>)`;
      return `Gear selector: <b>${pt.selector}</b> → click to change`;
    }, (hit) => {
      const pt = this.car.phys.pt;
      if (!pt.auto) {
        // push the lever forward (front half) to shift up, pull back to shift down
        const local = hit ? this.shifter.worldToLocal(hit.point.clone()) : new THREE.Vector3();
        if (local.z > 0) pt.shiftUp();
        else if (pt.gear <= 1) pt.shiftTo(pt.gear - 1);
        else pt.shiftDown();
        this.game.audio?.click?.();
        return;
      }
      const order = ['P', 'R', 'N', 'D'];
      const i = order.indexOf(pt.selector);
      const next = order[(i + 1) % 4];
      if ((next === 'R' || next === 'P') && this.car.speed > 2) {
        this.game.toast('Stop the car first');
        return;
      }
      pt.setSelector(next);
      this.game.audio?.click?.();
    });
    this.handbrake = new THREE.Group();
    this.handbrake.position.set(0, sy - 0.56, sz - 0.05);
    const hbLever = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.24), trim);
    hbLever.position.z = 0.1;
    this.handbrake.add(hbLever);
    g.add(this.handbrake);
    this.clickable([hbLever], () => `Parking brake: <b>${this.car.parkLever ? 'on' : 'off'}</b>`, () => {
      this.car.parkLever = !this.car.parkLever;
      this.game.audio?.ratchet?.();
    });
    // pedals (rebuilt when the gearbox changes: the third pedal comes and goes)
    this.pedals = [];
    this.buildPedals();

    // ---- seats ----
    for (const x of [sx, -sx]) this.addSeat(g, x, sy, sz, leather, car.cfg.seats === 'bucket');
    const bench = new THREE.Mesh(new THREE.BoxGeometry(hwCab * 1.7, 0.18, 0.55), leather);
    bench.position.set(0, sy - 0.66, sz - 0.95);
    if (b.doors.RL || b.kind === 'Sport sedan' || b.kind === 'SUV') g.add(bench);
    const benchBack = new THREE.Mesh(new THREE.BoxGeometry(hwCab * 1.7, 0.55, 0.12), leather);
    benchBack.position.set(0, sy - 0.35, sz - 1.25);
    benchBack.rotation.x = -0.15;
    if (bench.parent) g.add(benchBack);
    // seatbelt buckle
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.02), mat(0xb02020, 0.5));
    buckle.position.set(sx - 0.26, sy - 0.62, sz - 0.05);
    g.add(buckle);
    this.beltStrap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.008), mat(0x222222, 0.9));
    this.beltStrap.position.set(sx + 0.02, sy - 0.33, sz + 0.04);
    this.beltStrap.rotation.z = -0.62;
    this.beltStrap.visible = false;
    g.add(this.beltStrap);
    this.clickable([buckle], () => `Seatbelt: <b>${this.car.sys.seatbelt ? 'fastened' : 'unfastened'}</b>`, () => {
      this.car.sys.seatbelt = !this.car.sys.seatbelt;
      this.game.audio?.buckle?.(this.car.sys.seatbelt);
    });

    // ---- door card (moves with the driver's door) ----
    const door = car.model.parts.doorFL;
    const dzm = (b.doors.FL[0] + b.doors.FL[1]) / 2;
    const doorX = f.hw(dzm) * 0.9;
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, Math.min(0.95, b.doors.FL[1] - b.doors.FL[0] - 0.1)), soft);
    card.position.set(doorX, f.belt(dzm) - 0.28, dzm);
    const armrest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.45), leather);
    armrest.position.set(doorX - 0.04, sy - 0.5, sz + 0.1);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.1), alu);
    handle.position.set(doorX - 0.03, sy - 0.33, sz + 0.42);
    const winSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.05), mat(0x111111, 0.4));
    winSwitch.position.set(doorX - 0.06, sy - 0.47, sz + 0.2);
    const doorItems = [card, armrest, handle, winSwitch];
    if (door) {
      for (const it of doorItems) {
        it.position.sub(door.pivot);
        door.group.add(it);
      }
      this.doorItems = doorItems;
    } else doorItems.forEach((it) => g.add(it));
    this.clickable([handle], () => (door && door.userOpen ? 'Close door' : 'Open door'), () => {
      if (!door || door.state === 'detached') return;
      door.userOpen = !door.userOpen;
      this.game.audio?.door?.(door.userOpen);
    });
    this.clickable([winSwitch], () => `Window: <b>${this.car.sys.windowTarget > 0.5 ? 'close' : 'open'}</b>`, () => {
      this.car.sys.windowTarget = this.car.sys.windowTarget > 0.5 ? 0 : 1;
      this.game.audio?.windowMotor?.();
    });

    // ---- roof: dome light, visor, mirror ----
    const roofY = f.top(sz + 0.3) - 0.05;
    const dome = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.07), new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: new THREE.Color(1, 0.9, 0.75), emissiveIntensity: 0 }));
    dome.position.set(0, roofY - 0.01, sz + 0.25);
    g.add(dome);
    this.domeMesh = dome;
    this.domeLight = new THREE.PointLight(0xffe7c4, 0, 2.2, 1.5);
    this.domeLight.position.set(0, roofY - 0.1, sz + 0.1);
    g.add(this.domeLight);
    this.clickable([dome], () => `Dome light: <b>${this.car.sys.dome ? 'on' : 'off'}</b>`, () => {
      this.car.sys.dome = !this.car.sys.dome;
      this.game.audio?.click?.();
    });
    const visor = new THREE.Group();
    visor.position.set(sx, f.top(Z.roofF) - 0.04, Z.roofF - 0.02);
    const vp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.16), soft);
    vp.position.z = 0.08;
    visor.add(vp);
    g.add(visor);
    this.visorGroup = visor;
    this.clickable([vp], () => 'Sun visor', () => {
      this.visor = !this.visor;
      this.game.audio?.click?.();
    });
    // rear-view mirror with a live render target
    const mirrorPos = new THREE.Vector3(0.02, f.top(Z.roofF) - 0.1, Z.roofF - 0.03);
    this.mirrorRT = new THREE.WebGLRenderTarget(512, 160, { type: THREE.HalfFloatType });
    this.mirrorCam = new THREE.PerspectiveCamera(24, 512 / 160, 0.3, 320);
    const mirrorMat = new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture });
    const mg = new THREE.PlaneGeometry(0.21, 0.062);
    // flip horizontally for a mirror image
    const uv = mg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const mirror = new THREE.Mesh(mg, mirrorMat);
    mirror.position.copy(mirrorPos);
    mirror.rotation.set(0.05, Math.PI - 0.15, 0);
    const mirrorBack = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.075, 0.03), dark);
    mirrorBack.position.copy(mirrorPos).add(new THREE.Vector3(0, 0, 0.018));
    mirrorBack.rotation.copy(mirror.rotation);
    g.add(mirrorBack, mirror);
    this.mirrorPos = mirrorPos;
    this.buildSideMirrors();
    this.mirrorMat = mirrorMat;
    // side mirror glass shows the same feed
    for (const m of car.model.details.mirrors) {
      const sm = new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture });
      m.glass.material = sm;
      const guv = m.glass.geometry.attributes.uv;
      m.glass.geometry = m.glass.geometry.clone();
      const u2 = m.glass.geometry.attributes.uv;
      for (let i = 0; i < u2.count; i++) u2.setX(i, m.side > 0 ? 0.62 + guv.getX(i) * 0.38 : guv.getX(i) * 0.38);
    }

    // glovebox
    const glove = new THREE.Group();
    glove.position.set(-sx, sy - 0.47, sz + 0.62);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.02), soft);
    lid.position.y = 0.07;
    glove.add(lid);
    g.add(glove);
    this.glove = glove;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.08), new THREE.MeshBasicMaterial({ map: makePaper(this.car.cfg) }));
    paper.position.set(-sx, sy - 0.43, sz + 0.7);
    paper.rotation.set(-Math.PI / 2.3, Math.PI, 0);
    paper.visible = false;
    g.add(paper);
    this.paper = paper;
    this.clickable([lid], () => (this.gloveOpen ? 'Close glovebox' : 'Open glovebox'), () => {
      this.gloveOpen = !this.gloveOpen;
      this.game.audio?.click?.();
    });

    // ---- windshield overlay: rain, wipers, cracks, fog ----
    const ws = car.model.parts.windshield;
    if (ws) {
      this.wsCanvas = makeCanvas(512, 256);
      this.wsCtx = this.wsCanvas.getContext('2d');
      this.wsTex = canvasTexture(this.wsCanvas);
      const geo = ws.mesh.geometry.clone();
      const uvA = geo.attributes.uv;
      let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
      for (let i = 0; i < uvA.count; i++) {
        u0 = Math.min(u0, uvA.getX(i));
        u1 = Math.max(u1, uvA.getX(i));
        v0 = Math.min(v0, uvA.getY(i));
        v1 = Math.max(v1, uvA.getY(i));
      }
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (uvA.getX(i) - u0) / (u1 - u0 || 1), (uvA.getY(i) - v0) / (v1 - v0 || 1));
      this.wsOverlay = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.wsTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
      this.wsOverlay.renderOrder = 3;
      ws.group.add(this.wsOverlay);
    }

    // phone on a dash mount, right of the cluster (not in the 1960s classic)
    if (this.game.phone && this.game.phone.mountTex && car.cfg.body !== 'classic') {
      const pm = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.009), mat(0x111111, 0.4, 0.3));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.12), new THREE.MeshBasicMaterial({ map: this.game.phone.mountTex }));
      scr.position.z = -0.0055;
      scr.rotation.y = Math.PI;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), mat(0x222222, 0.6));
      arm.rotation.x = Math.PI / 2;
      arm.position.z = 0.035;
      pm.add(body, scr, arm);
      pm.position.set(sx - 0.33, dashTop + 0.06, Z.cowl - 0.1);
      pm.rotation.set(0.25, 0.25, 0);
      g.add(pm);
      this.phoneMount = pm;
      this.clickable([body, scr], () => 'Phone (<kbd>Tab</kbd>)', () => this.game.phone.toggle(true));
    }
    // roll cage
    if (car.cfg.rollCage) {
      const cage = mat(0x3a3d42, 0.4, 0.8);
      const bar = (a, b2) => {
        const d = new THREE.Vector3().subVectors(b2, a);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, d.length(), 8), cage);
        m.position.copy(a).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        g.add(m);
      };
      const zb = sz - 0.35, za = Z.roofF - 0.05;
      const top = (z) => f.top(z) - 0.06;
      const hw = (z) => f.hw(z) * 0.82;
      const fl = f.belt(zb) - 0.55;
      for (const s of [1, -1]) {
        bar(new THREE.Vector3(s * hw(zb), fl, zb), new THREE.Vector3(s * hw(zb) * 0.95, top(zb), zb));
        bar(new THREE.Vector3(s * hw(zb) * 0.95, top(zb), zb), new THREE.Vector3(s * hw(za) * 0.9, top(za), za));
        bar(new THREE.Vector3(s * hw(za) * 0.9, top(za), za), new THREE.Vector3(s * hw(Z.cowl), f.belt(Z.cowl) - 0.2, Z.cowl - 0.05));
      }
      bar(new THREE.Vector3(hw(zb) * 0.95, top(zb), zb), new THREE.Vector3(-hw(zb) * 0.95, top(zb), zb));
      bar(new THREE.Vector3(hw(zb), fl, zb), new THREE.Vector3(-hw(zb) * 0.95, top(zb), zb));
    }
    // airbag
    this.airbagMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), mat(0xf2f2ee, 0.9));
    this.airbagMesh.visible = false;
    this.wheel.add(this.airbagMesh);

    // show/hide exterior details that would block the view from inside
    this.driverHead = car.model.details.driver;
  }

  addSeat(g, x, sy, sz, m, bucket = false) {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), m);
    cushion.position.set(x, sy - 0.66, sz + 0.02);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, bucket ? 0.82 : 0.62, 0.12), m);
    backrest.position.set(x, sy - (bucket ? 0.22 : 0.3), sz - 0.28);
    backrest.rotation.x = -0.18;
    g.add(cushion, backrest);
    if (bucket) {
      // side bolsters and harness slots
      for (const s of [1, -1]) {
        const bol = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.2), m);
        bol.position.set(x + s * 0.24, sy - 0.25, sz - 0.24);
        bol.rotation.x = -0.18;
        const cb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.45), m);
        cb.position.set(x + s * 0.24, sy - 0.58, sz + 0.02);
        g.add(bol, cb);
      }
    } else {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.09), m);
      head.position.set(x, sy + 0.08, sz - 0.34);
      g.add(head);
    }
  }

  buildPedals() {
    const { dark, alu } = this.mats;
    const b = this.prof.b;
    const { x: sx, y: sy, z: sz } = b.seat;
    for (const p of this.pedals) if (p) p.parent?.remove(p);
    this.pedals = [];
    const pt = this.car.phys.pt;
    const nPedals = pt.auto || pt.ev ? 2 : 3;
    this.pedalCount = nPedals;
    for (let k = 0; k < 3; k++) {
      if (nPedals === 2 && k === 0) {
        this.pedals.push(null);
        continue;
      }
      const p = new THREE.Group();
      p.position.set(sx + 0.12 - k * 0.1 - (k === 2 ? 0.02 : 0), sy - 0.82, sz + 0.86);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(k === 1 && nPedals === 2 ? 0.1 : 0.06, 0.08, 0.012), alu);
      pad.position.set(0, -0.08, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.012), dark);
      arm.position.set(0, -0.02, 0.01);
      p.add(pad, arm);
      this.group.add(p);
      this.pedals.push(p);
    }
  }

  /** A small push button with an optional indicator LED colour. */
  button(parent, x, y, z, w, h, color, led, label, action, raw = false) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: led ? new THREE.Color(...led) : new THREE.Color(0, 0, 0), emissiveIntensity: 0 }));
    m.position.set(x, y, z);
    if (!raw) m.rotation.x = 0.3;
    parent.add(m);
    this.clickable([m], label, (hit) => {
      action(hit);
      this.game.audio?.click?.();
    });
    return m;
  }

  /** Which side of a round knob was clicked (+1 right/clockwise, -1 left). */
  knobSide(knob, hit) {
    if (!hit) return 1;
    const p = knob.worldToLocal(hit.point.clone());
    return p.x < 0 ? 1 : -1;
  }

  /** After a repair: clear cracks, refold the airbag, restore the glass overlay. */
  reset() {
    this.cracks.length = 0;
    this.drops.length = 0;
    this.fog = 0;
    this.rearFog = 0;
    this.airbag = 0;
    if (this.airbagMesh) {
      this.airbagMesh.visible = false;
      this.airbagMesh.scale.setScalar(1);
    }
    if (this.wsOverlay) this.wsOverlay.visible = true;
  }

  stalkLocal(stalk, hit) {
    if (!hit) return true;
    const p = stalk.worldToLocal(hit.point.clone());
    return p.x > 0;
  }

  clickable(meshes, label, action, opts = {}) {
    const c = { meshes, label, action, opts };
    for (const m of meshes) m.userData.clickable = c;
    this.clickables.push(c);
  }

  honkClick() {
    this.hornClickTimer = 0.35;
  }

  // ---------------------------------------------------------------- events
  onImpact(dv, p) {
    const car = this.car;
    // front impact direction?
    const local = car.body.toLocalPoint(p, _v);
    if (dv > 13 && local.z > 0.8 && this.airbag === 0) {
      this.airbag = 0.001;
      this.game.audio?.airbag?.();
    }
    if (dv > 6) this.fog = Math.min(1, this.fog + 0.02);
  }

  onGlass(part, lp, shattered) {
    if (part.name !== 'windshield' || !this.wsCtx) return;
    if (shattered) {
      if (this.wsOverlay) this.wsOverlay.visible = false;
      return;
    }
    // spider-web crack around the nearest point (approximate uv)
    const b = this.prof.b;
    const Z = b.zones;
    const u = clamp((lp.z - Z.roofF) / (Z.cowl - Z.roofF), 0.05, 0.95);
    const v = clamp(0.5 + lp.x / 1.6, 0.05, 0.95);
    this.cracks.push({ x: u * 512, y: (1 - v) * 256, r: 30 + Math.random() * 70, seed: Math.random() * 1000 });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, input) {
    const car = this.car;
    const game = this.game;
    const cockpit = game.cam.interior;
    this.t += dt;
    this.group.visible = true;
    const head = car.model.details.driver;
    if (head) head.visible = !cockpit;
    for (const h of this.hands) h.visible = cockpit;
    const s = car.sys;
    const pt = car.phys.pt;

    // ignition self-test sweep
    if (s.ignition !== this.lastIgnition) {
      if (this.lastIgnition === 'acc' && s.ignition === 'on') this.sweep = 1.6;
      this.lastIgnition = s.ignition;
    }
    if (this.sweep > 0) this.sweep -= dt;

    // steering wheel & hands
    const steerRot = car.phys.steerAngle / car.tuning.maxSteer * 7.4;
    this.wheel.rotation.z = -steerRot;
    for (const [i, h] of this.hands.entries()) {
      // hands stay on the rim up to ~100 degrees, then slide
      const s0 = i === 0 ? 1 : -1;
      const local = clamp(steerRot, -1.8, 1.8) - steerRot;
      const a = (i === 0 ? 0 : Math.PI) + local;
      h.position.set(Math.cos(a) * 0.185, Math.sin(a) * 0.185, -0.012);
      h.rotation.z = a;
      const arm = h.userData.arm;
      const hw = h.getWorldPosition(_v);
      this.group.worldToLocal(hw);
      const sh = h.userData.shoulder;
      const mid = _v2.copy(hw).add(sh).multiplyScalar(0.5);
      arm.position.copy(mid);
      const len = hw.distanceTo(sh);
      arm.scale.set(1, len, 1);
      arm.lookAt(this.group.localToWorld(hw.clone()));
      arm.rotateX(Math.PI / 2);
      arm.visible = cockpit;
      void s0;
    }
    // horn by clicking & holding the pad
    if (this.hornClickTimer > 0) this.hornClickTimer -= dt;
    this.clickHorn = this.hornClickTimer > 0 || (this.hovered && this.hovered.meshes.includes(this.hornPad) && input.mouse.down[0] && input.mouse.locked);
    if (this.clickHorn) s.horn = true;
    // stalks
    this.stalkL.rotation.x = s.indicator === 'right' ? -0.25 : s.indicator === 'left' ? 0.25 : 0;
    this.stalkR.rotation.x = s.wipers * -0.08;
    // key position
    const keyAngle = pt.cranking ? 1.4 : pt.running ? 1.05 : s.ignition === 'on' ? 1.05 : s.ignition === 'acc' ? 0.55 : 0;
    this.key.rotation.z = damp(this.key.rotation.z, -keyAngle, 20, dt);
    this.lightKnob.rotation.y = damp(this.lightKnob.rotation.y, -s.headlights * 0.6, 15, dt);
    this.hazardBtn.material.emissiveIntensity = s.hazard && s.blinkOn ? 3 : 0;
    this.defrostBtn.material.emissiveIntensity = s.defrost ? 2 : 0;
    // gear lever
    const selPos = { P: -0.06, R: -0.03, N: 0, D: 0.03, M: 0.03 }[pt.selector] ?? 0;
    if (pt.auto) this.shifter.position.z = damp(this.shifter.position.z, this.prof.b.seat.z + 0.34 - selPos, 15, dt);
    else {
      const gx = [0, 0.03, 0.03, 0, 0, -0.03, -0.03][Math.max(0, pt.gear)] ?? 0;
      const gz = pt.gear > 0 ? (pt.gear % 2 ? -0.04 : 0.04) : pt.gear < 0 ? 0.04 : 0;
      this.shifter.position.x = damp(this.shifter.position.x, 0.02 + gx, 15, dt);
      this.shifter.position.z = damp(this.shifter.position.z, this.prof.b.seat.z + 0.34 - gz, 15, dt);
    }
    const hb = car.phys.input.handbrake > 0 || car.parkLever ? 0.35 : 0;
    this.handbrake.rotation.x = damp(this.handbrake.rotation.x, -hb, 15, dt);
    car.phys.parkBrake = car.phys.parkBrake || !!car.parkLever;
    // pedals (third pedal appears when you switch to manual)
    const inp = car.phys.input;
    if ((pt.auto || pt.ev ? 2 : 3) !== this.pedalCount) this.buildPedals();
    if (this.pedals[0]) this.pedals[0].rotation.x = damp(this.pedals[0].rotation.x, pt.manualClutch ? pt.clutchPedal * 0.35 : pt.clutch < 0.9 && pt.gear !== 0 ? 0.3 : 0, 20, dt);
    // buttons and their LEDs
    const led = (m, on, k = 2.2) => m && (m.material.emissiveIntensity = on && car.electrics ? k : 0);
    led(this.fogBtn, s.fog > 0);
    led(this.rearDefBtn, s.rearDefrost);
    led(this.acBtn, s.ac);
    led(this.modeBtn, pt.mode !== 'normal');
    if (this.modeBtn) this.modeBtn.material.emissive.setRGB(pt.mode === 'sport' ? 1 : 0.2, pt.mode === 'sport' ? 0.3 : 0.9, 0.2);
    led(this.tcsBtn, !car.tuning.assists.tcs);
    led(this.epbBtn, !!car.parkLever);
    if (this.startBtn) this.startBtn.material.emissiveIntensity = pt.running ? 1.5 : 0.25 + Math.sin(this.t * 3) * 0.15;
    if (this.fanKnob) this.fanKnob.rotation.z = damp(this.fanKnob.rotation.z, -s.fan * 0.7, 12, dt);
    if (this.tempKnob) this.tempKnob.rotation.z = damp(this.tempKnob.rotation.z, -(s.climateTemp - 22) * 0.18, 12, dt);
    if (this.chokeKnob) this.chokeKnob.position.z = damp(this.chokeKnob.position.z, this.prof.b.seat.z + 0.66 - pt.choke * 0.03, 12, dt);
    // folding mirrors
    for (const m of car.model.details.mirrors) if (m.group && m.attached !== false) m.group.rotation.y = damp(m.group.rotation.y, s.mirrorsFolded ? (m.side > 0 ? 1.2 : -1.2) : 0, 6, dt);
    // dome light comes on with the door open
    const doorOpen = car.model.parts.doorFL && car.model.parts.doorFL.userOpen;
    this.domeAuto = !!doorOpen && car.electrics !== undefined;
    if (this.pedals[1]) this.pedals[1].rotation.x = damp(this.pedals[1].rotation.x, inp.brake * 0.35, 20, dt);
    if (this.pedals[2]) this.pedals[2].rotation.x = damp(this.pedals[2].rotation.x, inp.throttle * 0.35, 20, dt);
    // belt
    this.beltStrap.visible = s.seatbelt;
    if (!s.seatbelt && car.speed > 4 && pt.running) {
      this.chimeTimer -= dt;
      if (this.chimeTimer <= 0) {
        this.chimeTimer = 2.5;
        if (cockpit) game.audio?.chime?.('belt');
      }
    }
    // dome
    const domeOn = (s.dome || this.domeAuto) && !car.electricsDead && car.ext.battery > 0.04;
    this.domeMesh.material.emissiveIntensity = domeOn ? 3 : 0;
    this.domeLight.intensity = domeOn ? 0.9 : 0;
    // sun glare: low sun in front of you washes out the view unless the visor is down
    this.updateGlare(cockpit);
    // visor / glovebox
    this.visorGroup.rotation.x = damp(this.visorGroup.rotation.x, this.visor ? 1.35 : 0, 10, dt);
    this.glove.rotation.x = damp(this.glove.rotation.x, this.gloveOpen ? 0.9 : 0, 10, dt);
    this.paper.visible = this.gloveOpen;
    // window glass slides down with the switch
    const win = car.model.parts.winFL;
    if (win && win.state !== 'shattered' && win.state !== 'detached') win.mesh.position.y = -s.window * 0.45;
    // airbag
    if (this.airbag > 0) {
      this.airbag += dt;
      const inflate = Math.min(1, this.airbag * 12);
      const deflate = clamp((this.airbag - 1.5) / 3, 0, 1);
      const sc = inflate * (1 - deflate * 0.8);
      this.airbagMesh.visible = sc > 0.05;
      this.airbagMesh.scale.set(sc * 1.3, sc * 1.3, sc * 0.9);
      this.airbagMesh.position.z = -0.12 * sc;
      if (deflate >= 1) this.airbagMesh.scale.setScalar(0.25);
    }
    // interactions
    this.updateHover(input, cockpit);
    // displays at ~30 Hz, and only when you can see them (the cockpit cameras)
    if (!cockpit) return;
    this.frame = (this.frame || 0) + 1;
    if (this.frame % 2 === 0) {
      this.drawCluster();
      this.drawScreen();
    }
    this.updateWindshield(dt);
  }

  updateHover(input, cockpit) {
    const hud = this.game.hud;
    if (!cockpit || this.game.state !== 'play') {
      hud.crosshair(false);
      hud.hover(null);
      this.hovered = null;
      return;
    }
    hud.crosshair(true);
    const m = input.mouse;
    if (!m.locked && m.clicked[0]) {
      input.lock();
      return;
    }
    ray.setFromCamera(center, this.game.camera);
    ray.far = 1.6;
    const meshes = [];
    for (const c of this.clickables) for (const mm of c.meshes) if (mm.visible !== false) meshes.push(mm);
    const hits = ray.intersectObjects(meshes, false);
    const hit = hits[0];
    const c = hit ? hit.object.userData.clickable : null;
    this.hovered = c;
    if (c) {
      hud.hover(c.label(hit) + (m.locked ? '' : ' — click to grab the mouse'));
      if (m.clicked[0] && m.locked) c.action(hit);
    } else hud.hover(null);
  }

  updateGlare(cockpit) {
    const env = this.game.env;
    const hud = this.game.hud;
    let g = 0;
    if (cockpit && env.sunDir && env.sunDir.y > 0.02 && env.sunDir.y < 0.45 && env.cloud < 0.7) {
      const f = this.game.camera.getWorldDirection(_v);
      const a = f.dot(env.sunDir);
      g = Math.max(0, (a - 0.86) / 0.14) * (1 - env.cloud) * (1 - env.fogAmount);
      // visor blocks it when the sun is high enough to be behind it
      if (this.visor && env.sunDir.y > 0.08) g *= 0.12;
    }
    this.glare = g;
    hud.glare?.(g);
  }

  // ---------------------------------------------------------------- displays
  drawCluster() {
    const ctx = this.clusterCtx;
    const W = 1024, H = 384;
    const car = this.car;
    const pt = car.phys.pt;
    const s = car.sys;
    const on = car.electrics;
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, W, H);
    if (!on) {
      this.clusterTex.needsUpdate = true;
      return;
    }
    const night = this.game.env.night;
    const glow = 0.75 + 0.25 * (1 - night);
    const sweep = this.sweep > 0 ? Math.sin(clamp((1.6 - this.sweep) / 1.6, 0, 1) * Math.PI) : 0;
    const units = this.game.settings.units;
    const speed = Math.abs(car.forwardSpeed) * (units === 'mph' ? MPH : KMH);
    const maxSpeed = units === 'mph' ? 180 : 280;
    const maxRpm = pt.ev ? 16000 : Math.ceil((pt.spec.redline * 1.15) / 1000) * 1000;
    const dial = (cx, cy, r, value, max, step, label, redFrom, sub) => {
      ctx.save();
      ctx.translate(cx, cy);
      const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      g.addColorStop(0, '#15181c');
      g.addColorStop(1, '#0a0b0d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,120,40,${0.6 * glow})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      for (let v = 0; v <= max; v += step / 2) {
        const a = a0 + ((a1 - a0) * v) / max;
        const major = Math.abs((v / step) % 1) < 1e-6;
        ctx.strokeStyle = redFrom && v >= redFrom ? '#ff3030' : `rgba(235,240,245,${glow})`;
        ctx.lineWidth = major ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * (major ? 0.78 : 0.84), Math.sin(a) * r * (major ? 0.78 : 0.84));
        ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = `rgba(235,240,245,${glow})`;
          ctx.font = `600 ${Math.round(r * 0.13)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sub ? String(v / 1000) : String(v), Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
        }
      }
      const vv = Math.max(value, sweep * max);
      const a = a0 + ((a1 - a0) * clamp(vv, 0, max)) / max;
      ctx.strokeStyle = '#ff5a1a';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#ff5a1a';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * r * 0.12, -Math.sin(a) * r * 0.12);
      ctx.lineTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(160,170,180,${glow})`;
      ctx.font = `600 ${Math.round(r * 0.1)}px sans-serif`;
      ctx.fillText(label, 0, r * 0.4);
      ctx.restore();
    };
    const digital = car.cfg.gauges === 'digital';
    if (digital) {
      // digital: bar-graph tach arc + big numbers
      ctx.save();
      for (let i = 0; i < 48; i++) {
        const f = i / 48;
        const lit = f < Math.max(pt.rpm / maxRpm, sweep);
        const red = !pt.ev && f * maxRpm > pt.spec.redline;
        ctx.fillStyle = lit ? (red ? '#ff3030' : f > 0.7 ? '#ffb020' : '#3ce3c8') : '#14181d';
        const a = Math.PI * 0.85 + f * Math.PI * 1.3;
        ctx.save();
        ctx.translate(190 + Math.cos(a) * 150, 200 + Math.sin(a) * 150);
        ctx.rotate(a + Math.PI / 2);
        ctx.fillRect(-5, -14, 10, 28);
        ctx.restore();
      }
      ctx.fillStyle = '#e8edf2';
      ctx.font = '800 64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(pt.rpm / 100) * 100), 190, 200);
      ctx.font = '600 18px sans-serif';
      ctx.fillStyle = '#8b97a3';
      ctx.fillText('RPM', 190, 248);
      ctx.fillStyle = '#e8edf2';
      ctx.font = '800 110px sans-serif';
      ctx.fillText(String(Math.round(Math.max(speed, sweep * maxSpeed))), 834, 190);
      ctx.font = '600 22px sans-serif';
      ctx.fillStyle = '#8b97a3';
      ctx.fillText(units === 'mph' ? 'MPH' : 'KM/H', 834, 262);
      ctx.restore();
    } else {
      dial(190, 192, 175, pt.rpm, maxRpm, pt.ev ? 2000 : 1000, pt.ev ? 'x1000 RPM' : 'x1000 RPM', pt.ev ? null : pt.spec.redline, true);
      dial(834, 192, 175, speed, maxSpeed, units === 'mph' ? 20 : 20, units === 'mph' ? 'MPH' : 'KM/H', null, false);
    }
    // centre display
    ctx.fillStyle = '#0b0e12';
    roundRect(ctx, 392, 40, 240, 304, 16);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let gear;
    if (pt.ev) gear = pt.running ? (pt.selector === 'P' ? 'P' : pt.selector) : 'P';
    else if (pt.auto) gear = pt.selector === 'D' ? 'D' + pt.gear : pt.selector;
    else gear = pt.gear < 0 ? 'R' : pt.gear === 0 ? 'N' : String(pt.gear);
    ctx.fillStyle = '#fff';
    ctx.font = '800 76px sans-serif';
    ctx.fillText(gear, 512, 108);
    // mode / cruise line
    const ext = car.ext;
    ctx.font = '700 16px sans-serif';
    const tags = [];
    if (pt.mode !== 'normal') tags.push([pt.mode.toUpperCase(), pt.mode === 'sport' ? '#ff6a1f' : '#3ce36a']);
    if (ext.cruise.on) tags.push([`CRUISE ${Math.round(ext.cruise.speed * (units === 'mph' ? MPH : KMH))}`, '#3ce36a']);
    if (ext.limiter.on) tags.push([`LIM ${Math.round(ext.limiter.speed * (units === 'mph' ? MPH : KMH))}`, '#ffb020']);
    if (pt.ev) tags.push([pt.running ? 'READY' : '', '#3aa0ff'], [`REGEN ${pt.regenLevel}`, '#8b97a3']);
    if (s.headlights === 3) tags.push(['AUTO', '#3ce36a']);
    if (pt.launchArmed) tags.push(['LAUNCH', '#ff3030']);
    tags.filter((t) => t[0]).forEach((t, i, arr) => {
      ctx.fillStyle = t[1];
      ctx.fillText(t[0], 512 + (i - (arr.length - 1) / 2) * 76, 160);
    });
    // trip computer page
    const page = this.tripPage || 0;
    const tr = ext.trip;
    const dist = (km) => (units === 'mph' ? `${(km * 0.6214).toFixed(1)} mi` : `${km.toFixed(1)} km`);
    const cons = (v) => (pt.ev ? `${v.toFixed(1)} kWh/100km` : units === 'mph' ? `${v > 0.1 ? (235.2 / v).toFixed(1) : '—'} mpg` : `${v.toFixed(1)} L/100km`);
    const pages = [
      ['TRIP A', dist(tr.a)],
      ['TRIP B', dist(tr.b)],
      ['AVG', cons(tr.avg)],
      ['NOW', cons(tr.inst)],
      ['RANGE', dist(tr.range)],
      ['BATTERY', `${ext.volts.toFixed(1)} V`],
      ['TYRES', car.phys.wheels.map((w) => Math.round(w.temp)).join(' / ') + '°'],
      ['ODO', dist(ext.odo)],
    ];
    const [pl, pv] = pages[page % pages.length];
    ctx.fillStyle = '#8b97a3';
    ctx.font = '600 15px sans-serif';
    ctx.fillText(pl, 512, 198);
    ctx.fillStyle = '#e8edf2';
    ctx.font = '700 30px sans-serif';
    ctx.fillText(pv, 512, 228);
    ctx.font = '600 16px sans-serif';
    ctx.fillStyle = '#8b97a3';
    ctx.fillText(`${Math.round(speed)} ${units === 'mph' ? 'mph' : 'km/h'}   ${Math.round(pt.temp)}°C   ${this.game.env.hour ? String(Math.floor(this.game.env.hour)).padStart(2, '0') + ':' + String(Math.floor((this.game.env.hour % 1) * 60)).padStart(2, '0') : ''}`, 512, 262);
    const street = this.game.hud.lastStreet || '';
    ctx.fillStyle = '#c7d0da';
    ctx.fillText(street.slice(0, 22), 512, 292);
    // fuel (lagging needle) & temp bars
    const bar = (x, y, v, col) => {
      ctx.fillStyle = '#1a1e24';
      ctx.fillRect(x, y, 90, 8);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 90 * clamp(v, 0, 1), 8);
    };
    const fuelV = ext.fuelNeedle;
    bar(412, 322, Math.max(fuelV, sweep), fuelV < 0.12 ? '#ff4040' : pt.ev ? '#3aa0ff' : '#8fd14f');
    bar(522, 322, Math.max((pt.temp - 40) / 90, sweep), pt.temp > 112 ? '#ff4040' : '#37c8ff');
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = '#8b97a3';
    ctx.fillText(pt.ev ? `${Math.round(pt.energyFrac * 100)}%` : 'FUEL', 457, 340);
    ctx.fillText('TEMP', 567, 340);
    // warning lights (bulb check during sweep)
    const bulb = this.sweep > 0.2;
    const blinkFast = Math.floor(this.t * 6) % 2 === 0;
    const warn = (x, y, txt, onc, col, size = 17) => {
      ctx.fillStyle = onc || bulb ? col : '#1c1f24';
      ctx.font = `700 ${size}px sans-serif`;
      ctx.fillText(txt, x, y);
    };
    const flatTyre = car.phys.wheels.some((w) => w.flat > 0.5 || w.wear > 0.85);
    warn(90, 350, '◀', s.blinkOn && (s.indicator === 'left' || s.hazard), '#3ce36a');
    warn(290, 350, '▶', s.blinkOn && (s.indicator === 'right' || s.hazard), '#3ce36a');
    warn(160, 350, 'ABS', car.phys.absActive, '#ffb020');
    warn(222, 350, car.tuning.assists.tcs ? 'ESC' : 'ESC OFF', (car.phys.escActive || car.phys.tcsActive) && blinkFast || !car.tuning.assists.tcs, '#ffb020', 15);
    warn(734, 350, '⚙', pt.health < 0.5 || pt.misfire || pt.hydrolocked || (!pt.running && !pt.ev), '#ffb020');
    warn(794, 350, 'BELT', !s.seatbelt, '#ff4040');
    warn(864, 350, '(P)', car.phys.input.handbrake > 0 || car.phys.parkBrake, '#ff4040');
    warn(934, 350, '≣D', s.high && s.lightLevel === 2, '#3aa0ff');
    warn(84, 30, '≢D', s.fog >= 1, '#3ce36a', 15);
    warn(140, 30, 'O≢', s.fog >= 2, '#ffb020', 15);
    warn(512, 22, 'OIL', pt.oil < 0.25 || (pt.running && pt.health < 0.25), '#ff4040', 15);
    warn(890, 30, '🔋', ext.amps < -5 && pt.running || ext.volts < 11.6, '#ff4040', 15);
    warn(946, 30, '🌡', pt.temp > 112 || pt.coolant < 0.4, '#ff4040', 15);
    warn(836, 30, '⛽', fuelV < 0.12, '#ffb020', 15);
    warn(780, 30, '(!)', flatTyre, '#ffb020', 15);
    warn(724, 30, 'SVC', ext.odo > ext.serviceAt, '#ffb020', 14);
    warn(200, 30, '🔥', ext.fire > 0 && blinkFast, '#ff3030', 15);
    warn(260, 30, 'DOOR', !!(car.model.parts.doorFL && car.model.parts.doorFL.userOpen), '#ff4040', 14);
    // shift light
    if (!pt.ev) {
      const f = clamp((pt.rpm - pt.spec.redline * 0.8) / (pt.spec.redline * 0.2), 0, 1);
      for (let i = 0; i < 10; i++) {
        const lit = i / 10 < f || bulb;
        ctx.fillStyle = lit ? (i < 5 ? '#3ce36a' : i < 8 ? '#ffb020' : '#ff3030') : '#15181c';
        ctx.fillRect(412 + i * 21, 16, 16, 8);
      }
    }
    // electrical fault: the cluster flickers
    if (ext.flicker) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, W, H);
    }
    this.clusterMat.color.setScalar((0.55 + 0.45 * glow) * clamp((ext.volts - 10) / 2.2, 0.3, 1));
    this.clusterTex.needsUpdate = true;
  }

  /** The classic's radio: a glowing tuning dial with a needle, no touchscreen. */
  drawVintageRadio(ctx, W, H) {
    const st = this.game.audio?.radio?.stationInfo?.() || { name: 'OFF', freq: '' };
    const on = st.name !== 'OFF';
    ctx.fillStyle = '#2a1f14';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = on ? '#e9b45a' : '#5a4630';
    ctx.fillRect(30, 90, W - 60, 120);
    ctx.fillStyle = '#2a1f14';
    ctx.font = '700 22px serif';
    ctx.textAlign = 'center';
    for (let k = 0; k <= 10; k++) {
      const x = 50 + (k * (W - 100)) / 10;
      ctx.fillRect(x - 1, 100, 2, k % 2 ? 18 : 30);
      if (k % 2 === 0) ctx.fillText(String(88 + k * 2), x, 160);
    }
    const f = parseFloat(st.freq) || 98;
    const nx = 50 + ((Math.min(108, Math.max(88, f)) - 88) / 20) * (W - 100);
    ctx.fillStyle = '#c0281e';
    ctx.fillRect(nx - 2, 94, 4, 112);
    ctx.fillStyle = on ? '#f3d9a8' : '#7a6a55';
    ctx.font = 'italic 700 26px serif';
    ctx.fillText(on ? st.name : 'RADIO', W / 2, 260);
    this.screenTex.needsUpdate = true;
  }

  drawScreen() {
    const ctx = this.screenCtx;
    const W = 512, H = 320;
    const car = this.car;
    const audio = this.game.audio;
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, W, H);
    if (car.sys.ignition === 'off' && !car.phys.pt.running) {
      this.screenTex.needsUpdate = true;
      return;
    }
    if (car.cfg.body === 'classic') return this.drawVintageRadio(ctx, W, H);
    // mini map on the right
    const hud = this.game.hud;
    if (hud.mapCache) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(256, 10, 246, 200);
      ctx.clip();
      ctx.translate(379, 110);
      ctx.rotate(Math.PI + this.game.player.heading);
      const [mx, mz] = hud.worldToMap(car.body.position.x, car.body.position.z);
      const k = 1.3 / hud.mapScale;
      ctx.scale(k, k);
      ctx.drawImage(hud.mapBase || hud.mapCache, -mx, -mz);
      ctx.restore();
      ctx.fillStyle = '#ff6a1f';
      ctx.beginPath();
      ctx.moveTo(379, 100);
      ctx.lineTo(386, 118);
      ctx.lineTo(372, 118);
      ctx.fill();
    }
    // radio
    const st = audio?.radio?.stationInfo?.() || { name: 'Radio unavailable', freq: '', song: '' };
    ctx.fillStyle = '#ff6a1f';
    ctx.font = '700 30px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(st.freq || '', 16, 50);
    ctx.fillStyle = '#e8edf2';
    ctx.font = '700 22px sans-serif';
    ctx.fillText(st.name || 'OFF', 16, 84);
    ctx.fillStyle = '#8b97a3';
    ctx.font = '16px sans-serif';
    ctx.fillText((st.song || '').slice(0, 26), 16, 112);
    const h = this.game.env.hour;
    ctx.fillStyle = '#e8edf2';
    ctx.font = '700 36px sans-serif';
    ctx.fillText(`${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`, 16, 180);
    // buttons
    ctx.fillStyle = '#161b22';
    for (let i = 0; i < 3; i++) {
      roundRect(ctx, 8 + i * 168, 236, 160, 72, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#e8edf2';
    ctx.font = '700 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⏮', 88, 283);
    ctx.fillText('⏻', 256, 283);
    ctx.fillText('⏭', 424, 283);
    this.screenTex.needsUpdate = true;
  }

  updateWindshield(dt) {
    if (!this.wsCtx || !this.wsOverlay || !this.wsOverlay.visible) return;
    const ctx = this.wsCtx;
    const W = 512, H = 256;
    const env = this.game.env;
    const car = this.car;
    const s = car.sys;
    // raindrops accumulate while raining (less while moving fast: they streak)
    const rain = env.rain;
    const speed = car.speed;
    if (rain > 0.05) {
      const n = rain * dt * 90 * (car.model.parts.windshield.state === 'shattered' ? 0 : 1);
      for (let i = 0; i < n; i++) if (this.drops.length < 500) this.drops.push({ x: Math.random() * W, y: Math.random() * H, r: 1.2 + Math.random() * 3, vy: 0 });
    }
    // wipers sweep the glass (arcs from the bottom)
    const wa = s.wiperAngle;
    const prev = this.prevWiper ?? 0;
    this.prevWiper = wa;
    const lo = Math.min(prev, wa), hi = Math.max(prev, wa);
    const pivots = [[W * 0.3, H * 1.05], [W * 0.75, H * 1.05]];
    if (hi - lo > 1e-4) {
      this.drops = this.drops.filter((d) => {
        for (const [px, py] of pivots) {
          const ang = Math.atan2(py - d.y, d.x - px); // 0 = +x, PI/2 up
          const wiperA = Math.PI - (lo * 0.95 + 0.05) * Math.PI;
          const wiperB = Math.PI - (hi * 0.95 + 0.05) * Math.PI;
          const dist = Math.hypot(d.x - px, d.y - py);
          if (dist < H * 1.05 && ang <= wiperA + 0.05 && ang >= wiperB - 0.05) return false;
        }
        return true;
      });
      this.fog = Math.max(0, this.fog - (hi - lo) * 0.05);
    }
    // wind pushes drops up the glass at speed
    for (const d of this.drops) {
      d.y -= speed * dt * 0.8 * (d.r / 3);
      d.x += (Math.random() - 0.5) * speed * dt * 0.1;
    }
    this.drops = this.drops.filter((d) => d.y > -5);
    // washer fluid
    if (s.washer > 0) this.fog = Math.max(0, this.fog - dt * 0.3);
    // condensation builds in rain / cold mornings; the fan clears it, A/C dries the air,
    // and cold air on a wet day fogs the glass (warm it up or use defrost)
    const humid = (env.rain > 0.2 ? 0.02 : 0) + (env.hour < 8 ? 0.006 : 0) + (s.climateTemp < 19 && env.rain > 0.2 ? 0.012 : 0);
    const clear = (s.defrost ? 0.12 : 0) + s.fan * 0.012 + (s.ac ? 0.02 : 0);
    if (clear > humid) this.fog = Math.max(0, this.fog - (clear - humid) * dt);
    else this.fog = Math.min(0.6, this.fog + (humid - clear) * dt);
    // rear window: fogs the rear-view mirror image
    this.rearFog = this.rearFog || 0;
    if (s.rearDefrost && car.electrics) this.rearFog = Math.max(0, this.rearFog - dt * 0.08);
    else this.rearFog = Math.min(0.7, this.rearFog + humid * 0.8 * dt);
    if (this.mirrorMat) this.mirrorMat.color.setScalar(1 - this.rearFog * 0.35);
    // draw
    ctx.clearRect(0, 0, W, H);
    if (this.fog > 0.01) {
      ctx.fillStyle = `rgba(200,210,220,${this.fog * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    for (const d of this.drops) {
      ctx.fillStyle = 'rgba(210,225,240,0.35)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r, d.r * (1 + speed * 0.01), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(d.x - d.r * 0.3, d.y - d.r * 0.4, 1, 1);
    }
    if (s.washer > 0) {
      ctx.fillStyle = 'rgba(160,210,255,0.25)';
      for (let i = 0; i < 30; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 3, 6);
    }
    for (const c of this.cracks) drawCrack(ctx, c);
    this.wsTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- mirrors
  renderMirrors(renderer) {
    if (!this.game.cam.interior || this.game.state !== 'play') return;
    const mode = this.game.settings.mirrors || 'all';
    if (mode === 'off') return;
    this.mirrorFrame++;
    // rear mirror every other frame; with side mirrors on, rear / left / right in turn
    const side = mode === 'all' && this.sideMirrors?.length;
    const slot = side ? this.mirrorFrame % 4 : this.mirrorFrame % 2;
    if (side && (slot === 1 || slot === 3)) return this.renderSideMirror(renderer, this.sideMirrors[slot === 1 ? 0 : 1]);
    if (slot !== 0 && !(side && slot === 2)) return;
    if (side && slot === 2) return;
    const car = this.car;
    const cam = this.mirrorCam;
    const p = _v.copy(this.mirrorPos).sub(car.model.com);
    car.body.toWorldPoint(p, cam.position);
    // look backwards (car -z) = camera default -z, so align with the car
    cam.quaternion.copy(car.body.quaternion);
    cam.rotateX(-0.06);
    cam.updateMatrixWorld();
    const sky = this.game.env.sky;
    sky.position.copy(cam.position);
    const hidden = [this.group];
    const vis = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.mirrorRT);
    renderer.render(this.game.scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = autoShadow;
    hidden.forEach((o, i) => (o.visible = vis[i]));
    sky.position.copy(this.game.camera.position);
  }
}

Interior.prototype.renderSideMirror = function (renderer, m) {
  if (!m) return;
  const car = this.car;
  const d = m.d;
  if (!d.attached || car.sys.mirrorsFolded || !m.glass.parent) return;
  const cam = m.cam;
  m.glass.getWorldPosition(cam.position);
  cam.quaternion.copy(car.body.quaternion);
  const adj = this.mirrorAdj[m.idx];
  // look back and a little outward (+x is the car's left)
  cam.rotateY((d.side > 0 ? -0.32 : 0.32) - (d.side > 0 ? adj.yaw : -adj.yaw));
  cam.rotateX(-0.06 + adj.pitch);
  cam.updateMatrixWorld();
  const sky = this.game.env.sky;
  sky.position.copy(cam.position);
  const vis = this.group.visible;
  this.group.visible = false;
  const auto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(m.rt);
  renderer.render(this.game.scene, cam);
  renderer.setRenderTarget(prev);
  renderer.shadowMap.autoUpdate = auto;
  this.group.visible = vis;
  sky.position.copy(this.game.camera.position);
};

function drawCrack(ctx, c) {
  let s = c.seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.strokeStyle = 'rgba(235,240,245,0.75)';
  ctx.lineWidth = 1;
  const arms = 9;
  const rings = [];
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rnd() * 0.4;
    let x = c.x, y = c.y;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const len = c.r * (0.6 + rnd() * 0.8);
    const pts = [];
    for (let k = 1; k <= 5; k++) {
      x = c.x + Math.cos(a + (rnd() - 0.5) * 0.3) * (len * k) / 5;
      y = c.y + Math.sin(a + (rnd() - 0.5) * 0.3) * (len * k) / 5;
      ctx.lineTo(x, y);
      pts.push([x, y]);
    }
    ctx.stroke();
    rings.push(pts);
  }
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    for (let i = 0; i <= arms; i++) {
      const p = rings[i % arms][k];
      if (!p) continue;
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(240,245,250,0.6)';
  ctx.beginPath();
  ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function makeLogo() {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9ccd1';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1c1f';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', 32, 34);
  return canvasTexture(c);
}

function makePaper(cfg) {
  const c = makeCanvas(256, 102);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f3efe2';
  ctx.fillRect(0, 0, 256, 102);
  ctx.fillStyle = '#333';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('SAN DEMO DMV — REGISTRATION', 10, 18);
  ctx.font = '11px sans-serif';
  ctx.fillText(`Plate: ${cfg.plate}   Colour: ${cfg.paint}`, 10, 40);
  ctx.fillText('Owner: YOU (allegedly)', 10, 58);
  ctx.fillText('Notes: previous owner "only drove it', 10, 76);
  ctx.fillText('to church on Sundays". Sure.', 10, 92);
  return canvasTexture(c);
}
