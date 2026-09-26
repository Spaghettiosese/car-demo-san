// Keyboard, mouse and gamepad input with named actions.

export const BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  shiftUp: ['ShiftLeft', 'KeyX'],
  shiftDown: ['KeyZ'],
  camera: ['KeyC'],
  lookBack: ['KeyB'],
  horn: ['KeyH'],
  lights: ['KeyL'],
  highBeam: ['KeyK'],
  indLeft: ['KeyQ'],
  indRight: ['KeyE'],
  hazard: ['KeyJ'],
  wipers: ['KeyV'],
  ignition: ['KeyI'],
  enterExit: ['KeyF'],
  reset: ['KeyR'],
  repair: ['Backspace'],
  map: ['KeyM'],
  radio: ['KeyN'],
  pause: ['Escape', 'KeyP'],
  help: ['F1'],
  telemetry: ['F3'],
  photo: ['F2'],
  slowmo: ['Backslash'],
  siren: ['KeyG'],
  jump: ['Space'],
  run: ['ShiftLeft'],
  interact: ['KeyE'],
};

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, down: [false, false, false], clicked: [false, false, false], wheel: 0, locked: false, dragging: false };
    this.pad = null;
    this.padPrev = [];
    this.padButtons = [];
    this.padAxes = [0, 0, 0, 0];
    this.lastDevice = 'keyboard';
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F1', 'F2', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedSet.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.mouse.locked || this.mouse.down[0] || this.mouse.down[2]) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    dom.addEventListener('mousedown', (e) => {
      this.mouse.down[e.button] = true;
      this.mouse.clicked[e.button] = true;
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.down[e.button] = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === dom;
    });
  }

  lock() {
    if (!this.mouse.locked && this.dom.requestPointerLock) {
      try {
        const r = this.dom.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(action) {
    if (!this.enabled) return false;
    const b = BINDINGS[action];
    if (b) for (const k of b) if (this.keys.has(k)) return true;
    return this.padDown(action);
  }
  pressed(action) {
    if (!this.enabled) return false;
    const b = BINDINGS[action];
    if (b) for (const k of b) if (this.pressedSet.has(k)) return true;
    return this.padPressed(action);
  }
  released(action) {
    const b = BINDINGS[action];
    if (b) for (const k of b) if (this.releasedSet.has(k)) return true;
    return false;
  }
  key(code) {
    return this.keys.has(code);
  }
  keyPressed(code) {
    return this.pressedSet.has(code);
  }

  // ---------------- gamepad (standard mapping) ----------------
  static PAD = {
    handbrake: 0, lookBack: 1, horn: 2, camera: 3, shiftDown: 4, shiftUp: 5,
    pause: 9, map: 8, lights: 12, wipers: 13, indLeft: 14, indRight: 15, hazard: 10, enterExit: 11, jump: 0, interact: 2,
  };
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (!this.pad) return;
    this.padPrev = this.padButtons;
    this.padButtons = this.pad.buttons.map((b) => b.value);
    this.padAxes = this.pad.axes.slice(0, 4);
    if (this.padButtons.some((v) => v > 0.3) || this.padAxes.some((v) => Math.abs(v) > 0.3)) this.lastDevice = 'pad';
  }
  padDown(action) {
    if (!this.pad) return false;
    const i = Input.PAD[action];
    return i !== undefined && this.padButtons[i] > 0.5;
  }
  padPressed(action) {
    if (!this.pad) return false;
    const i = Input.PAD[action];
    return i !== undefined && this.padButtons[i] > 0.5 && !(this.padPrev[i] > 0.5);
  }
  /** Analog driving axes; keyboard gives -1/0/1. */
  drive() {
    const kbSteer = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const kbThr = this.down('throttle') ? 1 : 0;
    const kbBrk = this.down('brake') ? 1 : 0;
    let steer = kbSteer, thr = kbThr, brk = kbBrk, analog = false;
    if (this.pad) {
      const ax = this.padAxes[0] || 0;
      const dz = 0.08;
      const s = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz)) ** 1.4;
      const rt = this.padButtons[7] || 0, lt = this.padButtons[6] || 0;
      if (Math.abs(s) > 0.001 || rt > 0.02 || lt > 0.02) analog = true;
      if (Math.abs(s) > Math.abs(steer)) steer = s;
      thr = Math.max(thr, rt);
      brk = Math.max(brk, lt);
    }
    return { steer, throttle: thr, brake: brk, analog: analog && this.lastDevice === 'pad' };
  }
  look() {
    let x = 0, y = 0;
    if (this.pad) {
      const rx = this.padAxes[2] || 0, ry = this.padAxes[3] || 0;
      if (Math.abs(rx) > 0.12) x = rx;
      if (Math.abs(ry) > 0.12) y = ry;
    }
    return { x, y };
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.clicked[0] = this.mouse.clicked[1] = this.mouse.clicked[2] = false;
  }
}
