import { loadProfile, saveProfile, newProfile, levelFromXp, levelProgress, newGarageEntry } from './profile.js';
import { CAR_PRICES, PART_LEVEL, fmtMoney, carValue, partsOf, repairCost } from './economy.js';
import { ACHIEVEMENTS, ACH } from './achievements.js';
import { clamp } from '../core/util.js';

const FINE_POINTS = { speeding: 2, redlight: 3, reckless: 3, hit: 4, property: 1, assault: 6, carjack: 6, evading: 4, pedestrian: 6, seatbelt: 1, nolights: 1, stopsign: 2, wrongway: 3, suspended: 3 };

/**
 * Career mode: money, XP, levels, the garage of owned cars, the bank,
 * fines and licence points, insurance, loans, achievements and autosave.
 * Free Roam has no Career object at all (game.career is null).
 */
export class Career {
  constructor(game, profile) {
    this.game = game;
    this.p = profile;
    this.saveT = 0;
    this.dirty = false;
    this.receipt = null;
    this.achT = 0;
    this.lastHour = game.env.hour;
    this.nightDist = 0;
    this.level = levelFromXp(profile.xp);
  }

  static load(game, slot) {
    const p = loadProfile(slot);
    return p ? new Career(game, p) : null;
  }
  static fresh(game, slot) {
    const p = newProfile(slot);
    const c = new Career(game, p);
    c.log('Starting balance', p.money);
    c.message('Uncle Vic', `Welcome to San Demo, kid. That hatchback has ${Math.round(p.garage[0].odometer / 1e6)}k on the clock but she runs. Do some jobs, keep your nose clean, and come see me at the dealership when you've got real money.`);
    if (p.garage[0].cfg.migrated) c.message('San Demo Customs', 'We matched your new car to the colours of your old sandbox ride. On the house.');
    c.save();
    return c;
  }

  get money() {
    return this.p.money;
  }
  get car() {
    return this.p.garage.find((g) => g.id === this.p.current) || this.p.garage[0];
  }

  // ------------------------------------------------------------ money
  log(label, amount) {
    const b = this.p.bank;
    b.push({ day: this.p.day, label, amount: Math.round(amount), balance: Math.round(this.p.money) });
    if (b.length > 120) b.splice(0, b.length - 120);
  }

  /** Take money. Returns false (and charges nothing) if you can't afford it, unless `force`. */
  charge(amount, label, accumulate = false, force = false) {
    amount = Math.max(0, amount);
    if (!force && this.p.money < amount) return false;
    this.p.money -= amount;
    this.p.stats.spent += amount;
    if (accumulate) {
      if (!this.receipt || this.receipt.label !== label) this.flushReceipt();
      this.receipt ||= { label, amount: 0 };
      this.receipt.amount += amount;
    } else {
      this.log(label, -amount);
      this.game.hud?.money?.(-amount);
    }
    this.dirty = true;
    return true;
  }
  flushReceipt() {
    if (!this.receipt) return;
    const r = this.receipt;
    this.receipt = null;
    this.log(r.label, -r.amount);
    this.game.toast?.(`${r.label}: ${fmtMoney(r.amount)}`, 'info', 2);
    this.game.hud?.money?.(-r.amount);
  }

  earn(amount, label, xp = 0) {
    amount = Math.round(amount);
    this.p.money += amount;
    this.p.stats.earned += amount;
    this.log(label, amount);
    this.game.hud?.money?.(amount);
    if (xp) this.addXp(xp);
    this.dirty = true;
  }

  addXp(n) {
    const before = this.level;
    this.p.xp += Math.round(n);
    this.level = levelFromXp(this.p.xp);
    this.game.hud?.xp?.(n);
    if (this.level > before) this.levelUp(before, this.level);
    this.dirty = true;
  }

  levelUp(from, to) {
    for (let l = from + 1; l <= to; l++) {
      const bonus = 500 * l;
      this.p.money += bonus;
      this.log(`Level ${l} bonus`, bonus);
      const cars = Object.entries(CAR_PRICES).filter(([, v]) => v.level === l).map(([k]) => k);
      const parts = Object.entries(PART_LEVEL).filter(([, v]) => v === l).map(([k]) => k);
      const unlock = [...cars.map((c) => `the ${c} at the dealership`), ...(parts.length ? [`${parts.length} new parts`] : [])];
      this.game.hud?.big?.(`LEVEL ${l}`, `+${fmtMoney(bonus)}${unlock.length ? ' · Unlocked: ' + unlock.join(', ') : ''}`, 4);
      this.game.audio?.chime?.('level');
    }
  }

  // ------------------------------------------------------------ law
  fine(amount, reason) {
    const p = this.p;
    p.stats.fines += amount;
    this.charge(amount, `Fine: ${reason}`, false, true);
    const pts = FINE_POINTS[reason] || 2;
    p.licence.points += pts;
    if (p.licence.points >= 12 && p.licence.suspendedUntil <= p.day) {
      p.licence.suspendedUntil = p.day + 1;
      p.licence.points = 0;
      this.game.toast?.('🚫 Your licence is SUSPENDED until tomorrow. Cops will pull you over on sight.', 'warn', 6);
      this.message('SD Department of Motor Vehicles', 'Your driving licence has been suspended for one day after reaching 12 penalty points. Driving while suspended is an offence.');
    } else this.game.toast?.(`+${pts} licence points (${p.licence.points}/12)`, 'warn', 3);
  }
  get suspended() {
    return this.p.licence.suspendedUntil > this.p.day;
  }

  /** Busted: fines plus the impound fee, car moved to the Police HQ lot. */
  onBusted(fines) {
    this.p.stats.busted++;
    const impound = 500;
    this.charge(impound, 'Impound fee', false, true);
    this.message('SDPD Impound', `Your vehicle was impounded. Fee: ${fmtMoney(impound)}. Fines: ${fmtMoney(fines)}. Have a nice day.`);
    this.dirty = true;
  }

  onBlackout(cause) {
    const bill = cause === 'fire' ? 900 : 650;
    this.charge(bill, 'Hospital bill', false, true);
    this.message('San Demo General', `You were treated for ${cause === 'fire' ? 'burns' : 'crash injuries'}. Invoice: ${fmtMoney(bill)}. Please consider wearing a seatbelt.`);
  }

  // ------------------------------------------------------------ insurance & loans
  setInsurance(on) {
    this.p.insurance.active = on;
    this.game.toast?.(on ? `Insured. Premium ${fmtMoney(this.premium())}/day, we pay 60% of repairs over $250.` : 'Insurance cancelled');
    this.dirty = true;
  }
  premium() {
    const v = carValue(this.car.cfg, this.car.parts);
    return Math.round(120 + v * 0.004 + this.p.licence.points * 15);
  }
  /** Repair bill after insurance. */
  repairQuote(car) {
    const full = repairCost(car, this.car.parts);
    const ins = this.p.insurance;
    if (!ins.active || full <= 250 || ins.claimsToday >= 2) return { full, pay: full, covered: 0 };
    const covered = Math.round((full - 250) * 0.6);
    return { full, pay: full - covered, covered };
  }
  claim() {
    this.p.insurance.claimsToday++;
  }
  borrow(amount) {
    const max = this.loanLimit();
    const owed = this.p.loans.reduce((a, l) => a + l.principal, 0);
    amount = Math.min(amount, max - owed);
    if (amount <= 0) return 0;
    this.p.loans.push({ principal: amount * 1.12, perDay: Math.ceil((amount * 1.12) / 5) });
    this.earn(amount, 'Bank loan');
    return amount;
  }
  loanLimit() {
    return 4000 + this.level * 4000;
  }
  get debt() {
    return this.p.loans.reduce((a, l) => a + l.principal, 0);
  }

  /** Called when the in-game clock passes midnight. */
  newDay() {
    const p = this.p;
    p.day++;
    p.insurance.claimsToday = 0;
    if (p.insurance.active) this.charge(this.premium(), 'Insurance premium', false, true);
    for (const l of p.loans) {
      const pay = Math.min(l.perDay, l.principal);
      l.principal -= pay;
      this.charge(pay, 'Loan repayment', false, true);
    }
    p.loans = p.loans.filter((l) => l.principal > 0.5);
    if (p.licence.points > 0 && Math.random() < 0.5) p.licence.points--;
    if (p.pendingFine > 0) {
      // unpaid camera fines get a late fee and a point on the licence
      p.pendingFine = Math.round(p.pendingFine * 1.5);
      p.licence.points++;
      this.message('SD Traffic Enforcement', `Your camera fine is overdue. A 50% late fee was added: ${fmtMoney(p.pendingFine)} now outstanding. Pay it from the Bank app.`);
    }
    this.game.toast?.(`Day ${p.day}`, 'info', 2);
    this.game.activities?.newDay?.();
    this.dirty = true;
  }

  // ------------------------------------------------------------ cars
  /** Snapshot the live car into its garage entry (fuel, wear, mileage, mechanical state). */
  storeCar(car) {
    const e = this.car;
    if (!car || !e) return;
    e.cfg = { ...car.cfg };
    e.fuel = car.phys.pt.ev ? car.phys.pt.soc : car.phys.pt.fuel;
    e.wear = car.phys.wheels.map((w) => +w.wear.toFixed(3));
    e.battery = +car.ext.battery.toFixed(3);
    e.oil = +car.phys.pt.oil.toFixed(3);
    e.engine = +car.phys.pt.health.toFixed(3);
    e.odometer = Math.round(e.odometerBase ?? e.odometer) + car.ext.odo * 1000;
    e.serviceAt = car.ext.serviceAt;
    e.dirt = +car.ext.dirt.toFixed(2);
    e.damage = car.damageSnapshot();
    this.dirty = true;
  }
  /** Apply a garage entry's saved state to a freshly spawned car. */
  restoreCar(car, e = this.car) {
    const pt = car.phys.pt;
    if (e.fuel != null) {
      if (pt.ev) pt.soc = e.fuel;
      else pt.fuel = e.fuel;
    }
    car.phys.wheels.forEach((w, i) => (w.wear = e.wear?.[i] || 0));
    car.ext.battery = e.battery ?? 0.9;
    pt.oil = e.oil ?? 1;
    pt.health = e.engine ?? 1;
    car.ext.odo = 0;
    e.odometerBase = e.odometer;
    car.ext.serviceAt = e.serviceAt ?? 3000;
    car.ext.dirt = e.dirt || 0;
    car.model.setDirt?.(car.ext.dirt);
    car.restoreDamage(e.damage);
  }
  /** Depreciated market value of a garage entry. */
  value(e = this.car) {
    const base = carValue(e.cfg, e.parts);
    const km = (e.odometer || 0) / 1000;
    return Math.round(base * clamp(1 - km / 250000, 0.45, 1) * (0.5 + 0.5 * (e.engine ?? 1)));
  }
  buyCar(cfg, price) {
    if (!this.charge(price, `Bought ${cfg.body}`)) return null;
    const e = newGarageEntry(cfg, { odometer: 12000 });
    e.parts = partsOf(cfg);
    this.p.garage.push(e);
    this.p.stats.carsBought++;
    this.dirty = true;
    this.save();
    return e;
  }
  sellCar(id) {
    const i = this.p.garage.findIndex((g) => g.id === id);
    if (i < 0 || this.p.garage.length <= 1 || id === this.p.current) return 0;
    const e = this.p.garage[i];
    const price = Math.round(this.value(e) * 0.6 / 50) * 50;
    this.p.garage.splice(i, 1);
    this.earn(price, `Sold ${e.cfg.body}`);
    this.save();
    return price;
  }

  // ------------------------------------------------------------ achievements & messages
  unlock(id) {
    const a = ACH[id];
    if (!a || this.p.achievements[id]) return;
    this.p.achievements[id] = Date.now();
    this.game.hud?.achievement?.(a);
    if (a.xp) this.addXp(a.xp);
    this.dirty = true;
  }
  checkAchievements() {
    for (const a of ACHIEVEMENTS) if (a.check && !this.p.achievements[a.id] && a.check(this.p, this.game)) this.unlock(a.id);
  }
  message(from, text) {
    this.p.messages.unshift({ from, text, day: this.p.day, read: false });
    if (this.p.messages.length > 40) this.p.messages.length = 40;
    this.game.hud?.notify?.(`📱 ${from}`, text.slice(0, 80) + (text.length > 80 ? '…' : ''));
    this.game.audio?.chime?.('message');
    this.dirty = true;
  }
  hint(id, text) {
    if (this.p.hints[id]) return;
    this.p.hints[id] = 1;
    this.game.hud?.hint?.(text);
    this.dirty = true;
  }

  // ------------------------------------------------------------ per frame
  /** Contextual hints, shown once per profile when the situation first comes up. */
  contextHints() {
    const g = this.game;
    const car = g.player.car;
    if (!car || g.player.mode !== 'car' || g.activities?.current || g.tutorial?.active) return;
    const pt = car.phys.pt;
    const tank = pt.ev ? 1 : pt.spec.tank || 55;
    if ((pt.ev ? pt.soc : pt.fuel / tank) < 0.15) this.hint('fuel', pt.ev ? '🔋 Battery low: the EV chargers are at the Fuel Stop (⛽ on the map).' : '⛽ Fuel is running low. The Fuel Stop is on your map; stop at a pump and hold <kbd>Enter</kbd>.');
    if (car.damageSummary().body > 0.2) this.hint('damage', '🔧 Your car is damaged. Repair it at San Demo Customs, or call the mechanic from your phone (<kbd>Tab</kbd> → Contacts).');
    const heat = g.police?.heat || 0;
    if (heat >= 1 && heat < 2) this.hint('pullover', '🚨 The police want you to pull over. Stop and stay in the car for a ticket, or try to lose them.');
    if (heat >= 3) this.hint('hide', '🚨 Lots of heat! Break line of sight, hide in the car wash or the customs workshop, or get a respray.');
    if (g.env.night > 0.6 && car.sys.lightLevel < 2) this.hint('lights', '💡 It\'s dark: switch on your headlights with <kbd>L</kbd>.');
    if (g.env.rain > 0.4) this.hint('rain', '🌧 Wet roads double your braking distance. Wipers: <kbd>V</kbd>.');
    if ((g.env.snowCover || 0) > 0.3) this.hint('snow', '❄ Snow on the road: very little grip. Gentle on the throttle and brakes.');
    if (car.submerged > 0.2) this.hint('water', '🌊 Water and engines don\'t mix. Get out before the cabin floods (<kbd>F</kbd>).');
    if (!car.sys.seatbelt && car.speed > 10) this.hint('belt', '🔔 No seatbelt: press <kbd>;</kbd> (or click the buckle). It\'s also a fine.');
    if (car.speed > 120 / 3.6 && Math.abs(car.body.position.x) < 380 && Math.abs(car.body.position.z) < 380) this.hint('cams', '📸 Speed cameras in town mail you fines. Pay them in the Bank app before the late fee.');
    if (this.p.money > 6000 && this.level >= 2) this.hint('dealer', '🚗 Saving up? San Demo Motors (east of the city) sells new cars, with finance.');
  }

  /** Contacts text you about work now and then: that job pays extra for a while. */
  jobOffers(dt) {
    const g = this.game;
    const p = this.p;
    if (!g.activities || g.tutorial?.active) return;
    this.offerT = (this.offerT ?? 150) - dt;
    if (p.offer && p.playtime > p.offer.until) p.offer = null;
    if (this.offerT > 0 || p.offer) return;
    this.offerT = 200 + Math.random() * 220;
    const list = g.activities.list().filter((a) => !a.locked && a.start);
    if (!list.length) return;
    const a = list[Math.floor(Math.random() * list.length)];
    const who = [['Uncle Vic', 'Kid, I heard there\'s good money in'], ['Rosa (dispatcher)', 'Got a gig for you:'], ['Big Tony', 'You want to make some cash? Try'], ['Kenji', 'Bet you can\'t beat my time in'], ['Demo Mutual', 'Our clients are hiring drivers for']][Math.floor(Math.random() * 5)];
    p.offer = { id: a.id, until: p.playtime + 600, mult: 1.5 };
    this.message(who[0], `${who[1]} ${a.name}. Pays 50% extra for the next 10 minutes. I put it on your GPS.`);
    g.setWaypoint?.(a.start.clone ? a.start.clone() : a.start);
  }

  update(dt) {
    const g = this.game;
    const p = this.p;
    p.playtime += dt;
    this.hintT = (this.hintT || 0) - dt;
    if (this.hintT <= 0) {
      this.hintT = 1;
      this.contextHints();
    }
    this.jobOffers(dt);
    const car = g.player.car;
    if (car && g.player.mode === 'car') {
      p.stats.distance += car.speed * dt;
      p.stats.topSpeed = Math.max(p.stats.topSpeed, car.speed);
      if (g.env.night > 0.5) {
        this.nightDist += car.speed * dt;
        if (this.nightDist > 10000) this.unlock('nightOwl');
      }
      if (car.phys.airTime > 2) this.unlock('air');
      if (car.submerged > 0.8) this.unlock('submarine');
      if (car.wrecked && car.lastImpact > 0) this.unlock('wrecked');
      const lk = g.terrain?.lookout;
      if (lk && car.body.position.distanceTo(lk.pos) < 30) this.unlock('lookout');
      const pr = g.coast?.pier;
      if (pr && Math.abs(car.body.position.x - pr.x) < 10 && car.body.position.z > pr.z1 && car.submerged > 0.2) this.unlock('pier');
    }
    // midnight
    const h = g.env.hour;
    if (h < this.lastHour - 12) this.newDay();
    this.lastHour = h;
    this.achT -= dt;
    if (this.achT <= 0) {
      this.achT = 2;
      this.checkAchievements();
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 30;
      if (this.dirty) this.save();
    }
  }

  save() {
    const g = this.game;
    if (g.player.car && g.player.car.careerId === this.p.current) this.storeCar(g.player.car);
    this.flushReceipt();
    const ok = saveProfile(this.p);
    this.dirty = false;
    g.hud?.saving?.(ok);
    return ok;
  }

  get progress() {
    return levelProgress(this.p.xp);
  }
}
