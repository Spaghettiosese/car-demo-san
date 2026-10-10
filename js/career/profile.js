import { DEFAULT_CONFIG, configForBody } from '../vehicle/specs.js';

const KEY = 'sandemo.career.v2';

/** The car you start a career with: a tired old hatchback. */
export function starterConfig() {
  return {
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
}

let uid = 0;
export const newCarId = () => `car${Date.now().toString(36)}${(uid++).toString(36)}`;

export function newProfile() {
  const id = newCarId();
  return {
    version: 2,
    created: Date.now(),
    money: 1500,
    xp: 0,
    garage: [{ id, cfg: starterConfig(), parts: [], odometer: 0 }],
    current: id,
    events: {}, // id -> { best, medal, runs }
    collected: [], // hubcap ids
    jumps: {}, // stunt jump id -> best distance
    traps: {}, // speed trap id -> best km/h
    tutorial: 0,
    stats: { distance: 0, topSpeed: 0, crashes: 0, fines: 0, escapes: 0, jobs: 0, wins: 0, earned: 0, spent: 0, bestDrift: 0, bestJump: 0, nearMisses: 0, airTime: 0, busted: 0 },
  };
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.version !== 2) return null;
    const base = newProfile();
    return { ...base, ...p, stats: { ...base.stats, ...(p.stats || {}) } };
  } catch (e) {
    return null;
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch (e) {
    return false;
  }
}

export function deleteProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
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
