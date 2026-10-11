import * as THREE from 'three';
import { fmtMoney } from '../career/economy.js';
import { clamp } from '../core/util.js';
import { buildCarModel } from '../vehicle/carBuilder.js';
import { buildTuning } from '../vehicle/specs.js';

const _v = new THREE.Vector3();
const MEDALS = ['', 'Bronze', 'Silver', 'Gold'];
const MEDAL_ICON = ['', '🥉', '🥈', '🥇'];
export const DIFFICULTY = {
  easy: { name: 'Easy', skill: 0.8, reward: 0.7 },
  normal: { name: 'Normal', skill: 0.9, reward: 1 },
  hard: { name: 'Hard', skill: 0.98, reward: 1.5 },
};
export const RIVALS = [
  { name: 'Vinnie "Clutch" Russo', skill: 0.95, aggression: 0.8 },
  { name: 'Kenji Arai', skill: 0.98, aggression: 0.3 },
  { name: 'Dolores', skill: 0.9, aggression: 0.5 },
  { name: 'Big Tony', skill: 0.88, aggression: 0.95 },
  { name: 'Priya Shah', skill: 0.97, aggression: 0.4 },
  { name: 'The Professor', skill: 0.93, aggression: 0.2 },
  { name: 'Marcus Lane', skill: 0.92, aggression: 0.6 },
  { name: 'Ghost Rider', skill: 1.0, aggression: 0.7 },
];

/**
 * Activity framework: markers in the world, the start card, countdown,
 * checkpoints, objective panel, results with medals, leaderboards, ghosts.
 * Event definitions live in events.js; free-roam scoring in freeroam.js.
 */
export class ActivityManager {
  constructor(game, defs) {
    this.game = game;
    this.defs = defs;
    this.current = null;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.markers = [];
    this.gates = [];
    this.cardEl = document.createElement('div');
    this.cardEl.id = 'ev-card';
    this.cardEl.className = 'hidden';
    document.getElementById('app').appendChild(this.cardEl);
    this.cardEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.countEl = document.createElement('div');
    this.countEl.id = 'countdown';
    document.getElementById('hud').appendChild(this.countEl);
    this.posEl = document.createElement('div');
    this.posEl.id = 'race-pos';
    this.posEl.className = 'hidden';
    document.getElementById('hud').appendChild(this.posEl);
    this.difficulty = 'normal';
    this.wager = 0;
    this.buildMarkers();
  }

  byId(id) {
    return this.defs.find((d) => d.id === id);
  }

  /** Events for the phone / map, with progress. */
  list() {
    const ca = this.game.career;
    return this.defs.filter((d) => !d.hidden).map((d) => {
      const rec = ca ? ca.p.events[d.id] : this.freeRec?.[d.id];
      const reward = d.reward ? d.reward.gold : 0;
      return { id: d.id, name: d.name, icon: d.icon, blurb: d.blurb, start: d.start, medal: rec?.medal || 0, locked: ca ? (d.level || 1) > ca.level : false, level: d.level || 1, reward };
    });
  }

  records() {
    const ca = this.game.career;
    const ev = ca ? ca.p.events : this.freeRec || {};
    const out = [];
    for (const d of this.defs) {
      const r = ev[d.id];
      if (r && r.best != null) out.push({ name: d.name, best: d.format ? d.format(r.best) : r.best });
    }
    if (ca) {
      for (const [k, v] of Object.entries(ca.p.traps)) out.push({ name: `Speed trap ${k}`, best: `${Math.round(v)} km/h` });
      for (const [k, v] of Object.entries(ca.p.jumps)) out.push({ name: `Stunt jump ${k}`, best: `${v.toFixed(1)} m` });
      out.push({ name: 'Best drift', best: Math.round(ca.p.stats.bestDrift).toLocaleString() });
      out.push({ name: 'Hubcaps', best: `${ca.p.collected.length}/25` });
    }
    return out;
  }

  // ------------------------------------------------------------ markers
  buildMarkers() {
    const beamGeo = new THREE.CylinderGeometry(3.2, 3.2, 40, 24, 1, true);
    beamGeo.translate(0, 20, 0);
    const ringGeo = new THREE.TorusGeometry(3.4, 0.12, 6, 40);
    ringGeo.rotateX(Math.PI / 2);
    for (const d of this.defs) {
      if (!d.start || d.hidden) continue;
      const g = new THREE.Group();
      const col = new THREE.Color(d.color || 0xffb020);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2) }));
      ring.position.y = 0.15;
      const icon = this.iconSprite(d.icon || '🏁', col);
      icon.position.y = 6;
      g.add(beam, ring, icon);
      const gy = this.game.world.groundAt(d.start.x, d.start.z, 200, { y: 0 }).y;
      g.position.set(d.start.x, gy, d.start.z);
      this.group.add(g);
      this.markers.push({ def: d, g, beam, ring, icon });
    }
  }

  iconSprite(emoji, col) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
    s.scale.set(3.2, 3.2, 1);
    return s;
  }

  // ------------------------------------------------------------ checkpoint gates
  showGates(points, i, radius = 8) {
    this.clearGates();
    const mk = (p, next) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.55, 0.25, 8, 36), new THREE.MeshBasicMaterial({ color: next ? new THREE.Color(3, 1.6, 0.3) : new THREE.Color(0.8, 0.8, 0.9), transparent: true, opacity: next ? 0.9 : 0.35 }));
      const gy = this.game.world.groundAt(p.x, p.z, (p.y || 0) + 50, { y: 0 }).y;
      ring.position.set(p.x, gy + radius * 0.55, p.z);
      if (p.yaw !== undefined) ring.rotation.y = p.yaw;
      this.group.add(ring);
      this.gates.push(ring);
    };
    if (points[i]) mk(points[i], true);
    if (points[i + 1]) mk(points[i + 1], false);
  }
  clearGates() {
    for (const g of this.gates) this.group.remove(g);
    this.gates.length = 0;
  }

  // ------------------------------------------------------------ flow
  /** Called every frame while playing. */
  update(dt) {
    const g = this.game;
    const car = g.player.car;
    const t = performance.now() / 1000;
    g.activityPrompt = null;
    for (const m of this.markers) {
      const vis = !this.current;
      m.g.visible = vis;
      if (!vis) continue;
      m.icon.position.y = 6 + Math.sin(t * 2 + m.g.position.x) * 0.3;
      m.ring.rotation.z = t;
      const locked = g.career && (m.def.level || 1) > g.career.level;
      m.beam.material.opacity = locked ? 0.05 : 0.16;
    }
    if (this.current) {
      this.updateCurrent(dt);
      return;
    }
    // near a marker: offer the event
    if (g.player.mode !== 'car' || !car || g.state !== 'play') return;
    const p = car.body.position;
    let near = null;
    for (const m of this.markers) {
      const d = m.def;
      if (Math.hypot(p.x - d.start.x, p.z - d.start.z) < 4.5) near = d;
    }
    if (near && car.speed < 4) {
      g.activityPrompt = `<kbd>Enter</kbd> ${near.icon || ''} ${near.name}`;
      if (g.input.keyPressed('Enter')) this.openCard(near);
    }
  }

  openCard(def) {
    const g = this.game;
    const ca = g.career;
    const rec = ca ? ca.p.events[def.id] : this.freeRec?.[def.id];
    const locked = ca && (def.level || 1) > ca.level;
    const suspended = ca && ca.suspended && def.job;
    const pc = g.player.car;
    const wrecked = ca && !def.lend && pc && (pc.wrecked || pc.phys.pt.health < 0.15);
    const daily = this.dailyId() === def.id;
    const board = (ca ? ca.p.leaderboards[def.id] : null) || [];
    const fmt = def.format || ((v) => v);
    g.state = 'card';
    g.input.unlock();
    this.cardEl.classList.remove('hidden');
    const meds = def.medals ? [3, 2, 1].map((m) => `<div class="med">${MEDAL_ICON[m]} <b>${def.medalText ? def.medalText(m) : fmt(def.medals[['', 'bronze', 'silver', 'gold'][m]])}</b>${def.reward ? `<span>${fmtMoney(def.reward[['', 'bronze', 'silver', 'gold'][m]])}</span>` : ''}</div>`).join('') : '';
    this.cardEl.innerHTML = `<div class="panel evcard">
      <div class="h">${def.icon || '🏁'} ${def.name}${daily ? ' <span class="daily">DAILY ×2</span>' : ''}</div>
      <div class="d">${def.desc || def.blurb}</div>
      ${meds ? `<div class="meds">${meds}</div>` : ''}
      ${rec && rec.best != null ? `<div class="best">Your best: <b>${fmt(rec.best)}</b> ${MEDAL_ICON[rec.medal || 0]}</div>` : ''}
      ${board.length ? `<div class="board">${board.slice(0, 5).map((b, i) => `<div><span>${i + 1}. ${b.car}</span><b>${fmt(b.score)}</b></div>`).join('')}</div>` : ''}
      ${def.ai ? `<div class="row"><label>Difficulty</label><div class="ctl"><div class="seg" data-k="diff">${Object.entries(DIFFICULTY).map(([k, v]) => `<button data-v="${k}" class="${k === this.difficulty ? 'on' : ''}">${v.name}</button>`).join('')}</div></div></div>` : ''}
      ${def.ai && ca ? `<div class="row"><label>Side bet with the other drivers</label><div class="ctl"><div class="seg" data-k="wager">${[0, 250, 1000, 5000].map((w) => `<button data-v="${w}" class="${w === this.wager ? 'on' : ''}" ${w > ca.money ? 'disabled' : ''}>${w ? fmtMoney(w) : 'None'}</button>`).join('')}</div></div></div>` : ''}
      ${locked ? `<div class="lock">🔒 Reach level ${def.level} to enter.</div>` : suspended ? '<div class="lock">🚫 Not with a suspended licence.</div>' : wrecked ? '<div class="lock">🔧 Your car is too damaged. Call a mechanic (phone) or visit the garage.</div>' : ''}
      <div class="b"><button class="btn small primary" data-a="go" ${locked || suspended || wrecked ? 'disabled' : ''}>Start</button><button class="btn small" data-a="close">Not now</button></div></div>`;
    this.cardEl.querySelectorAll('.seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      if (sg.dataset.k === 'diff') this.difficulty = b.dataset.v;
      else this.wager = +b.dataset.v;
      this.openCard(def);
    })));
    this.cardEl.querySelector('[data-a=close]').onclick = () => this.closeCard();
    this.cardEl.querySelector('[data-a=go]').onclick = () => {
      this.closeCard();
      this.start(def);
    };
  }

  closeCard() {
    this.cardEl.classList.add('hidden');
    if (this.game.state === 'card') this.game.state = 'play';
  }

  start(def) {
    const g = this.game;
    const ca = g.career;
    if (this.wager && ca && !ca.charge(this.wager, 'Side bet')) this.wager = 0;
    const ctx = {
      def,
      game: g,
      t: 0,
      started: false,
      countdown: def.countdown === false ? 0 : 3.6,
      diff: DIFFICULTY[this.difficulty],
      wager: def.ai ? this.wager : 0,
      cars: [],
      drivers: [],
      score: 0,
      status: 'running',
      checkpoints: null,
      cp: 0,
      ghostRec: [],
      startPos: g.player.car ? g.player.car.body.position.clone() : null,
      falseStart: false,
    };
    this.current = ctx;
    this.wager = 0;
    // Free Roam events always start with a fresh car; in Career you pay for your own repairs
    if (!ca && g.player.car && g.player.mode === 'car') g.player.car.repair();
    if (def.closed) g.police && (g.police.paused = true);
    def.setup(ctx);
    if (def.ghost) this.loadGhost(ctx);
    g.hud.objective({ title: def.name, text: 'Get ready…' });
    g.audio?.chime?.('event');
  }

  updateCurrent(dt) {
    const ctx = this.current;
    const g = this.game;
    const def = ctx.def;
    // countdown with lights; moving before GO is a false start
    if (ctx.countdown > 0) {
      const before = Math.ceil(ctx.countdown - 0.6);
      ctx.countdown -= dt;
      const n = Math.ceil(ctx.countdown - 0.6);
      if (n !== before && n > 0) g.audio?.beep?.(n > 0 ? 660 : 990);
      this.countEl.className = 'on';
      this.countEl.innerHTML = n > 0 ? `<div class="lights">${[3, 2, 1].map((k) => `<i class="${n <= k ? 'r' : ''}"></i>`).join('')}</div><b>${n}</b>` : '<div class="lights"><i class="g"></i><i class="g"></i><i class="g"></i></div><b>GO!</b>';
      for (const d of ctx.drivers) d.frozen = true;
      const car = g.player.car;
      if (car && ctx.startPos && def.falseStart !== false && n > 0 && car.body.position.distanceTo(ctx.startPos) > 1.5 && !ctx.falseStart) {
        ctx.falseStart = true;
        g.toast('False start! +2 s penalty', 'warn', 2);
      }
      if (ctx.countdown <= 0) {
        ctx.started = true;
        for (const d of ctx.drivers) d.frozen = false;
        g.audio?.beep?.(990);
        setTimeout(() => (this.countEl.className = ''), 700);
        def.onGo?.(ctx);
      }
      return;
    }
    ctx.t += dt;
    // rubber band: the AI eases off when far ahead, pushes when behind
    if (def.ai && ctx.drivers.length) this.rubberBand(ctx);
    for (const d of ctx.drivers) d.update?.(dt);
    // ghost
    if (def.ghost && g.player.car) {
      ctx.ghostT = (ctx.ghostT || 0) + dt;
      if (ctx.ghostT >= 0.1) {
        ctx.ghostT = 0;
        const b = g.player.car.body;
        ctx.ghostRec.push([+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2), +b.quaternion.x.toFixed(3), +b.quaternion.y.toFixed(3), +b.quaternion.z.toFixed(3), +b.quaternion.w.toFixed(3)]);
      }
      this.updateGhost(ctx);
    }
    const res = def.update(ctx, dt);
    if (ctx.positions) this.drawPositions(ctx);
    if (res === 'done' || res === 'fail') this.finish(res);
    // the player gave up: drove away from a job, wrecked the car
    if (g.player.car && g.player.car.wrecked && def.failOnWreck !== false && res !== 'done') this.finish('fail', 'Your car is wrecked');
  }

  rubberBand(ctx) {
    const g = this.game;
    const me = ctx.playerProgress?.() ?? 0;
    for (const d of ctx.drivers) {
      if (d.progress === undefined) continue;
      const gap = d.progress - me; // >0: the AI is ahead
      const base = ctx.diff.skill * (d.rival ? d.rival.skill : 0.92);
      d.skill = clamp(base - clamp(gap / 400, -0.06, 0.12), 0.6, 1.05);
    }
    void g;
  }

  drawPositions(ctx) {
    const list = ctx.positions();
    this.posEl.classList.remove('hidden');
    // sit just below the objective panel, whatever its height
    const ob = document.getElementById('objective');
    if (ob && ob.offsetHeight) this.posEl.style.top = `${ob.offsetTop + ob.offsetHeight + 8}px`;
    this.posEl.innerHTML = `${ctx.laps ? `<div class="lap">LAP ${Math.min(ctx.laps, (ctx.lap || 0) + 1)}/${ctx.laps}</div>` : ''}${list.map((r, i) => `<div class="${r.me ? 'me' : ''}"><span>${i + 1}</span>${r.name}${r.gap ? `<i>${r.gap}</i>` : ''}</div>`).join('')}`;
  }

  /** End the event: 'done' (scored) or 'fail'. */
  finish(result, reason) {
    const ctx = this.current;
    if (!ctx || ctx.status !== 'running') return;
    const g = this.game;
    const def = ctx.def;
    ctx.status = result;
    let score = ctx.score;
    if (ctx.falseStart && def.lowerIsBetter) score += 2;
    const ca = g.career;
    const recs = ca ? ca.p.events : (this.freeRec ||= {});
    const rec = (recs[def.id] ||= { best: null, medal: 0, runs: 0 });
    rec.runs++;
    let medal = 0, newBest = false, money = 0, xp = 0;
    if (result === 'done') {
      medal = def.medalFor ? def.medalFor(ctx, score) : this.medalFor(def, score);
      const better = rec.best == null || (def.lowerIsBetter ? score < rec.best : score > rec.best);
      if (better && def.recordBest !== false) {
        rec.best = score;
        newBest = true;
        if (def.ghost) this.saveGhost(ctx);
      }
      const daily = this.dailyId() === def.id && ca && ca.p.daily.date !== this.today();
      const prev = rec.medal || 0;
      rec.medal = Math.max(prev, medal);
      if (def.reward) {
        const key = ['', 'bronze', 'silver', 'gold'][medal];
        money = (key ? def.reward[key] : def.reward.finish || 0) * ctx.diff.reward;
        if (def.payout) money = def.payout(ctx, money);
        if (daily) {
          money *= 2;
          ca.p.daily = { date: this.today(), done: true };
        }
      } else if (def.payout) money = def.payout(ctx, 0);
      xp = Math.round((def.xp || 100) * (0.4 + medal * 0.3) * ctx.diff.reward + (medal > prev ? 60 * (medal - prev) : 0));
      // side bet: winners take the pot
      if (ctx.wager) {
        if (ctx.place === 1) money += ctx.wager * (ctx.drivers.length + 1);
        else g.toast(`You lost the ${fmtMoney(ctx.wager)} bet`, 'warn');
      }
      if (ca) {
        if (money > 0) ca.earn(money, def.name, xp);
        else ca.addXp(xp);
        if (def.job) ca.p.stats.jobs++;
        if (ctx.place === 1) ca.p.stats.wins++;
        const board = (ca.p.leaderboards[def.id] ||= []);
        board.push({ score, car: g.player.car?.model.prof.b.name || '?', day: ca.p.day });
        board.sort((a, b) => (def.lowerIsBetter ? a.score - b.score : b.score - a.score));
        board.length = Math.min(board.length, 10);
        ca.save();
      }
    }
    def.cleanup?.(ctx);
    this.cleanupCtx(ctx);
    this.current = null;
    g.police && (g.police.paused = false);
    this.showResults(def, result, { score, medal, newBest, money, xp, reason, ctx });
  }

  medalFor(def, score) {
    const m = def.medals;
    if (!m) return 0;
    const ok = (v) => (def.lowerIsBetter ? score <= v : score >= v);
    return ok(m.gold) ? 3 : ok(m.silver) ? 2 : ok(m.bronze) ? 1 : 0;
  }

  cleanupCtx(ctx) {
    const g = this.game;
    this.clearGates();
    for (const c of ctx.cars) if (!c.removed && c !== g.player.car) g.removeCar(c);
    ctx.cars.length = 0;
    ctx.drivers.length = 0;
    if (this.ghostModel) {
      g.scene.remove(this.ghostModel.root);
      this.ghostModel = null;
    }
    g.hud.objective(null);
    g.hud.navArrow(null);
    this.posEl.classList.add('hidden');
    this.countEl.className = '';
  }

  showResults(def, result, r) {
    const g = this.game;
    const fmt = def.format || ((v) => v);
    g.state = 'card';
    g.input.unlock();
    this.cardEl.classList.remove('hidden');
    const title = result === 'done' ? (r.medal ? `${MEDAL_ICON[r.medal]} ${MEDALS[r.medal]}!` : r.ctx.place && r.ctx.place > 1 ? `Finished P${r.ctx.place}` : 'Finished') : 'Failed';
    this.cardEl.innerHTML = `<div class="panel evcard results">
      <div class="h">${def.icon || '🏁'} ${def.name}</div>
      <div class="big ${result}">${title}</div>
      ${result === 'done' ? `<div class="score">${def.scoreLabel || 'Result'}: <b>${fmt(r.score)}</b>${r.newBest ? ' <span class="nb">NEW BEST</span>' : ''}</div>` : `<div class="score">${r.reason || r.ctx.failReason || ''}</div>`}
      ${r.ctx.summary ? `<div class="sum">${r.ctx.summary}</div>` : ''}
      ${g.career && result === 'done' ? `<div class="pay">${r.money ? `+${fmtMoney(r.money)}` : ''} · +${r.xp} XP</div>` : ''}
      <div class="b"><button class="btn small primary" data-a="cont">Continue</button><button class="btn small" data-a="retry">Retry (F4)</button></div></div>`;
    this.lastDef = def;
    this.cardEl.querySelector('[data-a=cont]').onclick = () => this.closeCard();
    this.cardEl.querySelector('[data-a=retry]').onclick = () => {
      this.closeCard();
      this.start(def);
    };
    g.audio?.chime?.(result === 'done' && r.medal ? 'medal' : 'event');
  }

  restart() {
    const def = this.current ? this.current.def : this.lastDef;
    if (!def) return;
    if (this.current) {
      this.current.def.cleanup?.(this.current);
      this.cleanupCtx(this.current);
      this.current = null;
    }
    this.start(def);
  }

  abort(toast) {
    if (!this.current) return;
    const ctx = this.current;
    ctx.def.cleanup?.(ctx);
    this.cleanupCtx(ctx);
    this.current = null;
    this.game.police && (this.game.police.paused = false);
    if (toast) this.game.toast('Event abandoned');
  }

  // ------------------------------------------------------------ ghosts
  saveGhost(ctx) {
    const ca = this.game.career;
    const store = ca ? (ca.p.ghosts ||= {}) : (this.freeGhosts ||= {});
    const rec = ctx.ghostRec;
    if (rec.length > 3000) return;
    store[ctx.def.id] = { cfg: { ...this.game.player.car.cfg }, f: rec };
  }

  loadGhost(ctx) {
    const g = this.game;
    const ca = g.career;
    const store = ca ? ca.p.ghosts || {} : this.freeGhosts || {};
    const gh = store[ctx.def.id];
    if (!gh || !gh.f.length) return;
    const m = buildCarModel(gh.cfg, buildTuning(gh.cfg), { npc: true });
    m.root.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.3;
        o.material.depthWrite = false;
        o.castShadow = false;
      }
    });
    g.scene.add(m.root);
    this.ghostModel = m;
    ctx.ghost = gh.f;
  }

  updateGhost(ctx) {
    const m = this.ghostModel;
    if (!m || !ctx.ghost) return;
    const f = ctx.t * 10;
    const i = Math.min(ctx.ghost.length - 1, Math.floor(f));
    const j = Math.min(ctx.ghost.length - 1, i + 1);
    const a = ctx.ghost[i], b = ctx.ghost[j], k = f - Math.floor(f);
    m.root.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    m.root.quaternion.set(a[3], a[4], a[5], a[6]);
  }

  // ------------------------------------------------------------ daily challenge
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  dailyId() {
    const pool = this.defs.filter((d) => d.reward && !d.hidden);
    if (!pool.length) return null;
    let h = 0;
    for (const ch of this.today()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length].id;
  }
  newDay() {
    const id = this.dailyId();
    const d = this.byId(id);
    if (d && this.game.career) this.game.career.message('Daily challenge', `Today's challenge: ${d.name}. Double money for your first run.`);
  }
}

export { MEDAL_ICON };
