import { DEFAULT_CONFIG, configForBody } from '../vehicle/specs.js';
import { partsOf } from './economy.js';

const OLD_KEY = 'sandemo.career.v2';
const keyFor = (slot) => `sandemo.career.v2.s${slot}`;
export const SLOTS = [1, 2, 3];

/** The car you start a career with: a tired old hatchback. */
export function starterConfig() {
  const cfg = {
    ...configForBody('hatch', DEFAULT_CONFIG),
    paint: '#5c6e8a',
    finish: 'gloss',
    turbo: 'none',
    tire: 'street',
    wheelStyle: 'steel',
    wheelColor: '#b9bdc4',
    wheelSize: 16,
    spoiler: 'none',
    exhaust: 'stock',
    headlights: 'halogen',
    horn: 'normal',
    plate: 'NEW 001',
    tint: 0.2,
  };
  // carry the colours of your v1 sandbox car over (migration)
  try {
    const old = JSON.parse(localStorage.getItem('sandemo.car') || 'null');
    if (old && old.paint) {
      cfg.paint = old.paint;
      if (old.plate) cfg.plate = old.plate;
      cfg.migrated = true;
    }
  } catch (e) {
    /* ignore */
  }
  return cfg;
}

let uid = 0;
export const newCarId = () => `car${Date.now().toString(36)}${(uid++).toString(36)}`;

export function newGarageEntry(cfg, extra = {}) {
  return { id: newCarId(), cfg, parts: partsOf(cfg), odometer: 0, wear: [0, 0, 0, 0], fuel: null, battery: 0.9, oil: 1, engine: 1, setups: [], purchased: Date.now(), ...extra };
}

export function newProfile(slot = 1) {
  const car = newGarageEntry(starterConfig(), { odometer: 41800 });
  return {
    version: 2,
    slot,
    created: Date.now(),
    playtime: 0,
    money: 1500,
    xp: 0,
    day: 1,
    garage: [car],
    current: car.id,
    events: {}, // id -> { best, medal, runs }
    leaderboards: {}, // id -> [{ score, date, car }]
    collected: [], // hubcap ids
    jumps: {}, // stunt jump id -> best distance
    traps: {}, // speed trap id -> best km/h
    photos: {}, // photo spot id -> true
    achievements: {}, // id -> timestamp
    tutorial: 0,
    hints: {},
    bank: [], // { day, label, amount, balance }
    loans: [], // { principal, perDay }
    insurance: { active: false, claimsToday: 0 },
    licence: { points: 0, suspendedUntil: 0 },
    messages: [], // phone texts
    daily: { date: '', done: false },
    stats: { distance: 0, topSpeed: 0, crashes: 0, fines: 0, escapes: 0, jobs: 0, wins: 0, earned: 0, spent: 0, bestDrift: 0, bestJump: 0, nearMisses: 0, airTime: 0, busted: 0, pedsHit: 0, carsBought: 0, partsBought: 0 },
  };
}

function migrateOld() {
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (raw && !localStorage.getItem(keyFor(1))) {
      localStorage.setItem(keyFor(1), raw);
      localStorage.removeItem(OLD_KEY);
    }
  } catch (e) {
    /* ignore */
  }
}

export function loadProfile(slot = 1) {
  migrateOld();
  try {
    const raw = localStorage.getItem(keyFor(slot));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.version !== 2) return null;
    const base = newProfile(slot);
    const out = { ...base, ...p, slot, stats: { ...base.stats, ...(p.stats || {}) } };
    out.garage = (out.garage || []).map((g) => ({ ...newGarageEntry(g.cfg), ...g }));
    return out;
  } catch (e) {
    return null;
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(keyFor(p.slot || 1), JSON.stringify(p));
    return true;
  } catch (e) {
    return false;
  }
}

export function deleteProfile(slot = 1) {
  try {
    localStorage.removeItem(keyFor(slot));
  } catch (e) {
    /* ignore */
  }
}

/** Summary of each save slot for the career menu. */
export function listSlots() {
  migrateOld();
  return SLOTS.map((slot) => {
    const p = loadProfile(slot);
    if (!p) return { slot, empty: true };
    return { slot, empty: false, money: p.money, level: levelFromXp(p.xp), day: p.day, cars: p.garage.length, playtime: p.playtime || 0, created: p.created };
  });
}

// ---------------------------------------------------------------- levels
/** Total XP needed to reach a level (level 1 = 0). */
export function xpForLevel(level) {
  return Math.round(350 * Math.pow(level - 1, 1.55));
}
export function levelFromXp(xp) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp && l < 50) l++;
  return l;
}
export function levelProgress(xp) {
  const l = levelFromXp(xp);
  const a = xpForLevel(l), b = xpForLevel(l + 1);
  return { level: l, into: xp - a, need: b - a, frac: (xp - a) / Math.max(1, b - a) };
}
