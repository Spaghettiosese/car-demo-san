/**
 * Photo mode panel: the HUD hides, the free camera flies, and the grade can
 * be tuned (exposure, saturation, contrast, colour filters, vignette, grain),
 * plus field of view and time of day. Snap saves a PNG of the frame.
 */
const FILTERS = {
  none: { tint: [1, 1, 1], sepia: 0, sat: 1.08 },
  warm: { tint: [1.08, 1.0, 0.86], sepia: 0, sat: 1.1 },
  cool: { tint: [0.88, 0.98, 1.12], sepia: 0, sat: 1.0 },
  vivid: { tint: [1, 1, 1], sepia: 0, sat: 1.45 },
  bw: { tint: [1, 1, 1], sepia: 0, sat: 0 },
  sepia: { tint: [1, 1, 1], sepia: 0.85, sat: 0.6 },
  noir: { tint: [0.95, 0.98, 1.05], sepia: 0, sat: 0, contrast: 1.35 },
  vintage: { tint: [1.06, 0.98, 0.84], sepia: 0.3, sat: 0.8, contrast: 0.92 },
};

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.el = null;
    this.state = { exposure: 1, sat: 1.08, contrast: 1.04, vignette: 0.35, grain: 0.025, sepia: 0, tint: [1, 1, 1], filter: 'none', fov: 60 };
    this.active = false;
  }

  open() {
    const g = this.game;
    this.active = true;
    this.prevHour = g.env.hour;
    this.prevFrozen = g.env.frozen;
    g.hud.show(false);
    this.build();
    this.el.classList.remove('hidden');
    this.apply();
  }

  close() {
    const g = this.game;
    this.active = false;
    if (g.post) g.post.photo = null;
    g.hud.show(true);
    if (this.el) this.el.classList.add('hidden');
    g.env.frozen = this.prevFrozen;
    g.camera.fov = 62;
    g.camera.updateProjectionMatrix();
  }

  apply() {
    const g = this.game;
    if (g.post) g.post.photo = this.state;
    g.camera.fov = this.state.fov;
    g.camera.updateProjectionMatrix();
  }

  build() {
    if (this.el) return this.sync();
    const g = this.game;
    const el = document.createElement('div');
    el.id = 'photo-panel';
    const slider = (k, label, min, max, step) => `<label><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><em data-o="${k}"></em></label>`;
    el.innerHTML = `<div class="ph">📷 Photo mode <span>F2 to exit · H hides this panel</span></div>
      ${slider('exposure', 'Exposure', 0.3, 2.5, 0.05)}
      ${slider('contrast', 'Contrast', 0.6, 1.6, 0.02)}
      ${slider('sat', 'Saturation', 0, 2, 0.02)}
      ${slider('vignette', 'Vignette', 0, 1.4, 0.02)}
      ${slider('grain', 'Film grain', 0, 0.15, 0.005)}
      ${slider('fov', 'Field of view', 15, 100, 1)}
      ${slider('hour', 'Time of day', 0, 24, 0.1)}
      <div class="filters">${Object.keys(FILTERS).map((f) => `<button data-f="${f}">${f === 'bw' ? 'B&W' : f}</button>`).join('')}</div>
      <div class="pb"><button class="snap" data-a="snap">📸 Save PNG (Enter)</button><button data-a="reset">Reset</button></div>`;
    document.getElementById('app').appendChild(el);
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.querySelectorAll('input[type=range]').forEach((r) => (r.oninput = () => {
      const k = r.dataset.k;
      const v = parseFloat(r.value);
      if (k === 'hour') {
        g.env.setTime(v);
        g.env.frozen = true;
      } else this.state[k] = v;
      this.apply();
      this.sync();
    }));
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
      const f = FILTERS[b.dataset.f];
      Object.assign(this.state, { filter: b.dataset.f, tint: f.tint, sepia: f.sepia, sat: f.sat, contrast: f.contrast ?? 1.04 });
      this.apply();
      this.sync();
    }));
    el.querySelector('[data-a=snap]').onclick = () => this.snap();
    el.querySelector('[data-a=reset]').onclick = () => {
      Object.assign(this.state, { exposure: 1, sat: 1.08, contrast: 1.04, vignette: 0.35, grain: 0.025, sepia: 0, tint: [1, 1, 1], filter: 'none', fov: 60 });
      this.apply();
      this.sync();
    };
    this.el = el;
    this.sync();
  }

  sync() {
    const el = this.el;
    if (!el) return;
    const s = this.state;
    const vals = { ...s, hour: this.game.env.hour };
    el.querySelectorAll('input[type=range]').forEach((r) => {
      const k = r.dataset.k;
      r.value = vals[k];
      const o = el.querySelector(`[data-o=${k}]`);
      if (o) o.textContent = k === 'hour' ? `${String(Math.floor(vals.hour)).padStart(2, '0')}:${String(Math.floor((vals.hour % 1) * 60)).padStart(2, '0')}` : k === 'fov' ? `${vals.fov}°` : vals[k].toFixed(2);
    });
    el.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === s.filter));
  }

  update() {
    const g = this.game;
    if (!this.active) return;
    if (g.input.keyPressed('KeyH')) this.el.classList.toggle('hidden');
  }

  /** Render a frame and save it as a PNG download. */
  snap() {
    const g = this.game;
    g.audio?.shutter?.();
    g.freeroam?.snap?.();
    try {
      g.render(0);
      const url = g.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      const d = new Date();
      a.download = `san-demo-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.lastUrl = url;
      g.toast('📸 Saved to your downloads', 'good', 2);
      if (g.career) (g.career.p.shots ||= 0), g.career.p.shots++;
    } catch (e) {
      g.toast('Could not save the screenshot', 'warn');
    }
    const flash = document.getElementById('cam-flash');
    if (flash) {
      flash.classList.remove('on');
      void flash.offsetWidth;
      flash.classList.add('on');
    }
  }
}
