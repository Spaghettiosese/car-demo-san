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
  // v2
  clutch: ['ControlLeft'],
  cruise: ['KeyO'],
  cruiseUp: ['Equal'],
  cruiseDown: ['Minus'],
  limiter: ['KeyU'],
  flash: ['KeyY'],
  fog: ['Period'],
  driveMode: ['Comma'],
  regen: ['Slash'],
  lookLeft: ['BracketLeft'],
  lookRight: ['BracketRight'],
  phone: ['Tab'],
  replay: ['F5'],
  hideHud: ['F6'],
  restart: ['F4'],
  seatUp: ['PageUp'],
  seatDown: ['PageDown'],
  seatFwd: ['Home'],
  seatBack: ['End'],
  gear1: ['Digit1'],
  gear2: ['Digit2'],
  gear3: ['Digit3'],
  gear4: ['Digit4'],
  gear5: ['Digit5'],
  gear6: ['Digit6'],
  gear7: ['Digit7'],
  gearR: ['Backquote'],
  gearN: ['Digit0'],
  fob: ['KeyK'],
};

/** Actions the player may rebind, with labels for the controls screen. */
export const REBINDABLE = {
  throttle: 'Throttle', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right', handbrake: 'Handbrake',
  clutch: 'Clutch', shiftUp: 'Shift up', shiftDown: 'Shift down', horn: 'Horn', lights: 'Headlights', highBeam: 'High beams',
  flash: 'Flash to pass', fog: 'Fog lights', indLeft: 'Indicator left', indRight: 'Indicator right', hazard: 'Hazards',
  wipers: 'Wipers', ignition: 'Ignition', cruise: 'Cruise control', limiter: 'Speed limiter', driveMode: 'Drive mode',
  camera: 'Camera', lookBack: 'Look back', lookLeft: 'Look left', lookRight: 'Look right', enterExit: 'Get in / out',
  reset: 'Recover car', repair: 'Repair', map: 'Map', phone: 'Phone', radio: 'Next station', siren: 'Siren',
  replay: 'Replay', photo: 'Photo mode', hideHud: 'Hide HUD', restart: 'Restart event',
};
const DEFAULT_BINDINGS = JSON.parse(JSON.stringify(BINDINGS));
try {
  const saved = JSON.parse(localStorage.getItem('sandemo.keys') || 'null');
  if (saved) for (const k in saved) if (BINDINGS[k] && Array.isArray(saved[k])) BINDINGS[k] = saved[k];
} catch (e) {
  /* ignore */
}
export function rebind(action, code) {
  if (!BINDINGS[action]) return;
  // free the key from any other action of the same kind first
  for (const k in BINDINGS) if (k !== action && REBINDABLE[k]) BINDINGS[k] = BINDINGS[k].filter((c) => c !== code);
  BINDINGS[action] = [code, ...BINDINGS[action].filter((c) => c !== code)].slice(0, 2);
  saveBindings();
}
export function resetBindings() {
  for (const k in DEFAULT_BINDINGS) BINDINGS[k] = DEFAULT_BINDINGS[k].slice();
  saveBindings();
}
function saveBindings() {
  try {
    const out = {};
    for (const k in REBINDABLE) out[k] = BINDINGS[k];
    localStorage.setItem('sandemo.keys', JSON.stringify(out));
  } catch (e) {
    /* ignore */
  }
}
export function keyLabel(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ShiftLeft', 'L-Shift').replace('ControlLeft', 'L-Ctrl').replace('Backquote', '`').replace('BracketLeft', '[').replace('BracketRight', ']');
}

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
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'Tab', 'PageUp', 'PageDown', 'Home', 'End', 'Slash', 'Quote'].includes(e.code)) e.preventDefault();
      if (this.captureNext) {
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
        e.preventDefault();
        return;
      }
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
    pause: 9, map: 8, lights: 12, wipers: 13, indLeft: 14, indRight: 15, clutch: 10, enterExit: 11, jump: 0, interact: 2,
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
    const kbClutch = BINDINGS.clutch.some((k) => this.keys.has(k)) ? 1 : 0;
    const clutch = Math.max(kbClutch, this.pad ? this.padButtons[10] || 0 : 0);
    return { steer, throttle: thr, brake: brk, clutch, analog: analog && this.lastDevice === 'pad', wheel: this.isWheel() };
  }

  /** A steering wheel shows up as a gamepad whose id mentions a wheel. */
  isWheel() {
    return !!(this.pad && /wheel|g29|g920|g923|t300|t150|fanatec|moza|logitech g|thrustmaster/i.test(this.pad.id));
  }

  /** Force-feedback-lite: gamepad rumble. */
  rumble(strong, weak, ms = 60) {
    const a = this.pad && this.pad.vibrationActuator;
    if (!a || (strong < 0.02 && weak < 0.02)) return;
    try {
      a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) });
    } catch (e) {
      /* ignore */
    }
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
