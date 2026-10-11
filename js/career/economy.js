import { BODIES, configForBody, DEFAULT_CONFIG } from '../vehicle/specs.js';

/** Dealership catalogue: price and the reputation level needed to buy. */
export const CAR_PRICES = {
  hatch: { price: 9500, level: 1 },
  van: { price: 14000, level: 1 },
  sedan: { price: 21000, level: 2 },
  classic: { price: 24000, level: 3 },
  pickup: { price: 26000, level: 3 },
  suv: { price: 31000, level: 4 },
  truck: { price: 33000, level: 4 },
  muscle: { price: 38000, level: 5 },
  coupe: { price: 47000, level: 7 },
  supercar: { price: 145000, level: 11 },
};

export const PART_PRICES = {
  'engine:i4': 3000, 'engine:v6': 7000, 'engine:i6': 10000, 'engine:v8': 13000, 'engine:ev': 26000,
  'turbo:small': 4500, 'turbo:big': 9500,
  'tune:1': 1800, 'tune:2': 4500, 'tune:3': 9000,
  'tire:street': 500, 'tire:sport': 1200, 'tire:slick': 2800, 'tire:offroad': 1400,
  'drivetrain:fwd': 3000, 'drivetrain:rwd': 3500, 'drivetrain:awd': 7500,
  'diff:open': 300, 'diff:lsd': 1800, 'diff:locked': 1200,
  'exhaust:stock': 200, 'exhaust:sport': 900, 'exhaust:straight': 1600,
  antilag: 2500,
  'spoiler:lip': 400, 'spoiler:wing': 1200, 'spoiler:gt': 2600,
  coilovers: 2200,
  brakes: 2400,
  'weight:1': 3000, 'weight:2': 7000,
  underglow: 800,
  'gearbox:manual': 600, 'gearbox:auto': 600,
  finaldrive: 1200, gearset: 3500, lsdtune: 400, boostctl: 900, alignment: 150,
  'bodykit:sport': 2200, 'bodykit:aero': 4800, hoodscoop: 700, flares: 1500, rollcage: 3200,
  'swheel:sport': 600, 'swheel:classic': 500, 'seats:bucket': 1400, 'gauges:digital': 900,
  spacers: 300, 'tirewidth:wide': 400, 'tirewidth:narrow': 200, 'tip:dual': 250, 'tip:quad': 450, 'tip:square': 300,
  'glowmode:pulse': 300, 'glowmode:rainbow': 450, calipers: 200, smokedtails: 250,
};
// level needed to buy a part (keeps big upgrades for later)
export const PART_LEVEL = { 'bodykit:aero': 5, gearset: 4, rollcage: 3, boostctl: 3, 'turbo:big': 5, 'tune:2': 4, 'tune:3': 8, 'tire:slick': 5, 'engine:v8': 4, 'engine:ev': 9, 'engine:i6': 3, 'weight:2': 6, antilag: 3, 'spoiler:gt': 4, 'drivetrain:awd': 5 };

export const PART_NAMES = {
  engine: 'Engine swap', turbo: 'Turbo', tune: 'ECU tune', tire: 'Tyres', drivetrain: 'Drivetrain conversion', diff: 'Differential', exhaust: 'Exhaust',
  antilag: 'Anti-lag', spoiler: 'Spoiler', coilovers: 'Adjustable coilovers', brakes: 'Big brake kit', weight: 'Weight reduction', underglow: 'Underglow',
  wheels: 'Rims', wheelsize: 'Rim size', headlights: 'Headlight bulbs', horn: 'Horn', gearbox: 'Gearbox swap',
  finaldrive: 'Final drive', gearset: 'Custom gear set', lsdtune: 'LSD preload tuning', boostctl: 'Boost controller', alignment: 'Wheel alignment',
  bodykit: 'Body kit', hoodscoop: 'Hood scoop', flares: 'Fender flares', rollcage: 'Roll cage', swheel: 'Steering wheel', seats: 'Seats', gauges: 'Gauges',
  spacers: 'Wheel spacers', tirewidth: 'Tyre width', tip: 'Exhaust tips', glowmode: 'Underglow controller', calipers: 'Caliper paint', smokedtails: 'Smoked tail lights',
};

export const FUEL_PRICE = 1.7; // $ per litre
export const TOW_PRICE = 250;

function stock(cfg) {
  return configForBody(cfg.body, DEFAULT_CONFIG);
}

/** Parts a config uses that differ from the factory spec. */
export function partsOf(cfg) {
  const s = stock(cfg);
  const p = [];
  if (cfg.engine !== s.engine) p.push(`engine:${cfg.engine}`);
  if (cfg.engine !== 'ev' && cfg.turbo !== s.turbo && cfg.turbo !== 'none') p.push(`turbo:${cfg.turbo}`);
  if (cfg.tune > 0) for (let i = 1; i <= cfg.tune; i++) p.push(`tune:${i}`);
  if (cfg.tire !== s.tire) p.push(`tire:${cfg.tire}`);
  if (cfg.drivetrain !== s.drivetrain) p.push(`drivetrain:${cfg.drivetrain}`);
  if (cfg.diff !== s.diff) p.push(`diff:${cfg.diff}`);
  if (cfg.exhaust !== s.exhaust) p.push(`exhaust:${cfg.exhaust}`);
  if (cfg.antilag) p.push('antilag');
  if (cfg.spoiler !== 'none') p.push(`spoiler:${cfg.spoiler}`);
  if (cfg.rideHeight !== s.rideHeight || cfg.springs !== s.springs || cfg.dampers !== s.dampers || cfg.antiRoll !== s.antiRoll) p.push('coilovers');
  if (cfg.brakeKit) p.push('brakes');
  if ((cfg.finalMul ?? 1) !== 1) p.push('finaldrive');
  if ((cfg.gearSpacing ?? 1) !== 1) p.push('gearset');
  if ((cfg.lsdPreload ?? 0.5) !== 0.5) p.push('lsdtune');
  if ((cfg.boost ?? 1) !== 1 && cfg.turbo !== 'none') p.push('boostctl');
  if ((cfg.camber ?? -1) !== -1 || (cfg.toe ?? 0) !== 0) p.push('alignment');
  if (cfg.bodyKit && cfg.bodyKit !== 'stock') p.push(`bodykit:${cfg.bodyKit}`);
  if (cfg.hoodScoop) p.push('hoodscoop');
  if (cfg.flares) p.push('flares');
  if (cfg.rollCage) p.push('rollcage');
  if (cfg.wheelStyleInterior && cfg.wheelStyleInterior !== 'stock') p.push(`swheel:${cfg.wheelStyleInterior}`);
  if (cfg.seats === 'bucket') p.push('seats:bucket');
  if (cfg.gauges === 'digital') p.push('gauges:digital');
  if (cfg.wheelOffset) p.push('spacers');
  if (cfg.tireWidth) p.push(`tirewidth:${cfg.tireWidth > 0 ? 'wide' : 'narrow'}`);
  if (cfg.exhaustTip && cfg.exhaustTip !== 'round') p.push(`tip:${cfg.exhaustTip}`);
  if (cfg.underglow && cfg.underglow !== 'none' && cfg.underglowMode && cfg.underglowMode !== 'steady') p.push(`glowmode:${cfg.underglowMode}`);
  if (cfg.caliperColor && cfg.caliperColor !== '#c0392b') p.push('calipers');
  if (cfg.smokedTails) p.push('smokedtails');
  if (cfg.weightReduction > 0) for (let i = 1; i <= cfg.weightReduction; i++) p.push(`weight:${i}`);
  if (cfg.underglow && cfg.underglow !== 'none') p.push('underglow');
  if (cfg.wheelStyle !== s.wheelStyle) p.push(`wheels:${cfg.wheelStyle}`);
  if (cfg.wheelSize !== s.wheelSize) p.push(`wheelsize:${cfg.wheelSize}`);
  if (cfg.headlights !== s.headlights) p.push(`headlights:${cfg.headlights}`);
  if (cfg.horn !== s.horn) p.push(`horn:${cfg.horn}`);
  if (cfg.gearbox !== s.gearbox) p.push(`gearbox:${cfg.gearbox}`);
  return p;
}

export function partPrice(key) {
  if (PART_PRICES[key] !== undefined) return PART_PRICES[key];
  const [k, v] = key.split(':');
  if (k === 'wheels') return 900;
  if (k === 'wheelsize') return 120 * Math.abs(+v - 17) + 300;
  if (k === 'headlights') return 350;
  if (k === 'horn') return v === 'melody' ? 400 : 150;
  return 500;
}

export function partLevel(key) {
  return PART_LEVEL[key] || 1;
}

/** Cosmetic changes are billed as one paint-shop job. */
export function paintJobPrice(from, to) {
  let cost = 0;
  if (from.paint !== to.paint || from.finish !== to.finish) cost += to.finish === 'chrome' ? 3500 : to.finish === 'pearl' ? 1600 : 700;
  if (from.livery !== to.livery || (to.livery !== 'none' && from.accent !== to.accent)) cost += to.livery === 'none' ? 150 : 450;
  if (from.tint !== to.tint) cost += 150;
  if (from.plate !== to.plate) cost += 60;
  if (from.wheelColor !== to.wheelColor) cost += 250;
  if ((from.twoTone || 'none') !== (to.twoTone || 'none')) cost += to.twoTone === 'none' ? 300 : 600;
  if ((from.raceNumber || '') !== (to.raceNumber || '')) cost += to.raceNumber ? 120 : 40;
  if ((from.interiorColor || '') !== (to.interiorColor || '')) cost += 500;
  return cost;
}

/** What the garage charges to go from one config to another, given parts already owned. */
export function upgradeCost(from, to, owned = []) {
  const items = [];
  // never bill for what the car already has fitted or what you own
  const have = new Set([...owned, ...partsOf(from)]);
  for (const key of partsOf(to)) {
    if (have.has(key)) continue;
    const [k] = key.split(':');
    items.push({ key, name: `${PART_NAMES[k] || k}${key.includes(':') ? ' · ' + key.split(':')[1] : ''}`, price: partPrice(key), level: partLevel(key) });
  }
  const paint = paintJobPrice(from, to);
  if (paint) items.push({ key: 'paint', name: 'Paint shop', price: paint, level: 1 });
  return { items, total: items.reduce((a, b) => a + b.price, 0), level: Math.max(1, ...items.map((i) => i.level)) };
}

export function carValue(cfg, owned = []) {
  const base = (CAR_PRICES[cfg.body] || { price: 15000 }).price;
  const parts = owned.reduce((a, k) => a + partPrice(k), 0);
  return base + parts * 0.5;
}

/** Bill for fixing a damaged car. */
export function repairCost(car, owned = []) {
  const d = car.damageSummary();
  const value = carValue(car.cfg, owned);
  let cost = d.body * value * 0.1 + d.engine * value * 0.08;
  cost += d.wheels.reduce((a, w) => a + (w >= 1 ? 450 : w * 300), 0);
  cost += d.glass.reduce((a, g) => a + g * 220, 0);
  cost += car.model.allParts.filter((p) => p.state === 'detached').length * 260;
  cost += car.model.lights.all.filter((l) => l.broken).length * 90;
  return Math.round(Math.min(cost, value * 0.45) / 10) * 10;
}

export function sellPrice(cfg, owned) {
  return Math.round((carValue(cfg, owned) * 0.55) / 100) * 100;
}

export function fmtMoney(v) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

export { BODIES };
