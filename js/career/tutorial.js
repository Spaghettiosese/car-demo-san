/**
 * The career intro: a short guided first drive. Each step explains one thing
 * and waits until the player has actually done it (or skips after a while).
 */
const STEPS = [
  {
    text: 'Welcome to San Demo! Uncle Vic left you his old hatchback. First, <b>start the engine</b>: click the key in the ignition, or press <kbd>I</kbd>. (EVs: hold the brake and press START.)',
    done: (g, car) => car.phys.pt.running,
  },
  {
    text: '<b>Buckle up.</b> Click the seatbelt buckle by your seat, or press <kbd>;</kbd>. Driving without one is a fine, and crashes hurt a lot more.',
    done: (g, car) => car.sys.seatbelt,
  },
  {
    text: '<b>Pull away</b>: hold <kbd>W</kbd> to accelerate, <kbd>S</kbd> to brake, <kbd>A</kbd>/<kbd>D</kbd> to steer. <kbd>C</kbd> changes the camera.',
    done: (g, car) => car.speed > 6,
  },
  {
    text: 'Follow the <b>blue GPS line</b> to the <b>Fuel Stop</b>. The town limit is 50 km/h. Red lights and STOP signs mean stop!',
    enter: (g) => g.setWaypoint(g.city.locations.gas.pos.clone()),
    done: (g, car) => car.body.position.distanceTo(g.city.locations.gas.pos) < 18,
  },
  {
    text: '<b>Fill up.</b> Stop next to a pump, press <kbd>Enter</kbd> to open the fuel door, switch the engine off (<kbd>I</kbd>) and hold <kbd>Enter</kbd>. EVs use the chargers on the west side. Fuel costs money in Career.',
    tick: (g, t) => g.fuelingT > 0 && (t.fueled = (t.fueled || 0) + 1),
    done: (g, car, t) => t.fueled > 30 || car.phys.pt.energyFrac > 0.97 || t.t > 45,
  },
  {
    text: 'Now head back to <b>San Demo Customs</b>, your home garage (follow the GPS). Stop in the bay and press <kbd>Enter</kbd> for repairs, servicing, paint and upgrades.',
    enter: (g) => g.setWaypoint(g.city.locations.garage.pos.clone()),
    done: (g, car, t) => g.tutorial.sawGarage || t.t > 150,
  },
  {
    text: 'Money comes from <b>jobs and events</b>. Open your phone with <kbd>Tab</kbd> and look at <b>Jobs</b>, or the yellow markers on the map (<kbd>M</kbd>).',
    done: (g, car, t) => (g.phone?.open && g.phone.app === 'jobs') || t.t > 25,
  },
  {
    text: 'Your first job: a <b>Taxi Shift</b>. Drive into the yellow marker and press <kbd>Enter</kbd>. Smooth driving earns big tips.',
    enter: (g) => {
      const d = g.activities?.byId('taxi');
      if (d) g.setWaypoint(d.start.clone());
    },
    done: (g, car, t) => !!g.activities?.current || t.t > 120,
  },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = null;
  }

  start() {
    const g = this.game;
    if (!g.career || g.career.p.tutorialDone) return;
    // an established career (older saves have no flag): no intro needed
    const p = g.career.p;
    if (g.career.level > 1 || Object.keys(p.events || {}).length) {
      p.tutorialDone = true;
      return;
    }
    this.active = true;
    this.sawGarage = false;
    this.i = -1;
    this.build();
    this.next();
  }

  build() {
    if (this.el) {
      this.el.classList.remove('hidden');
      return;
    }
    const el = document.createElement('div');
    el.id = 'tutorial';
    el.innerHTML = '<div class="th"><b>Getting started</b><span class="steps"></span><button>Skip tutorial</button></div><div class="tut-text"></div>';
    document.getElementById('hud').appendChild(el);
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.querySelector('button').onclick = () => this.finish(true);
    this.el = el;
  }

  next() {
    const g = this.game;
    this.i++;
    if (this.i >= STEPS.length) return this.finish(false);
    const st = STEPS[this.i];
    this.t = 0;
    this.state = { t: 0 };
    st.enter?.(g);
    this.el.querySelector('.tut-text').innerHTML = st.text;
    this.el.querySelector('.steps').innerHTML = STEPS.map((_, k) => `<i class="${k < this.i ? 'd' : k === this.i ? 'c' : ''}"></i>`).join('');
    this.el.classList.remove('pop');
    void this.el.offsetWidth;
    this.el.classList.add('pop');
    if (this.i > 0) g.audio?.chime?.('pickup');
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const car = g.player.car;
    if (!car || g.player.mode !== 'car') return;
    const st = STEPS[this.i];
    this.state.t += dt;
    st.tick?.(g, this.state);
    if (st.done(g, car, this.state)) this.next();
  }

  /** Leave the tutorial without finishing it (quit to the menu, another mode). */
  stop() {
    this.active = false;
    if (this.el) this.el.classList.add('hidden');
  }

  /** Only on screen while actually driving around (not in pause, the map or a card). */
  sync() {
    if (this.el) this.el.classList.toggle('hidden', !this.active || this.game.state !== 'play');
  }

  finish(skipped) {
    const g = this.game;
    this.active = false;
    if (this.el) this.el.classList.add('hidden');
    if (g.career) {
      g.career.p.tutorialDone = true;
      g.career.dirty = true;
      if (!skipped) {
        g.career.earn(250, 'Tutorial bonus', 100);
        g.hud.big('YOU\'RE ALL SET', 'Mind the speed limits, have fun. F1 shows every control.', 4);
      }
    }
  }
}
