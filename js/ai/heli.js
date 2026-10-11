import * as THREE from 'three';
import { clamp } from '../core/util.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * Police helicopter for 4+ star pursuits: circles above the player, keeps
 * them in sight (hard to shake unless you hide under cover) and lights them
 * up with a searchlight at night. Rotor sound is positional.
 */
export class PoliceHeli {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.active = false;
    this.leaving = false;
    this.root = this.build();
    this.root.visible = false;
    game.scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.orbit = Math.random() * 6.28;
    this.sound = null;
  }

  build() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: this.opts.color ?? 0x1b2a4a, roughness: 0.45, metalness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.5, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.5 });
    const cab = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12), body);
    cab.scale.set(1, 0.95, 1.7);
    g.add(cab);
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.27, 18, 4, 0, Math.PI * 2, 1.35, 0.45), white);
    stripe.scale.set(1, 0.95, 1.7);
    g.add(stripe);
    const win = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 10, -1.1, 2.2, 0.5, 1.2), glass);
    win.scale.set(1.15, 0.95, 1.6);
    win.position.set(0, 0.15, 0.55);
    g.add(win);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 4.6, 10), body);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.3, -3.6);
    g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.7), body);
    fin.position.set(0, 0.85, -5.7);
    g.add(fin);
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), dark);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(s * 0.95, -1.35, 0.1);
      g.add(skid);
      for (const z of [-0.7, 0.9]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), dark);
        strut.position.set(s * 0.85, -1.1, z);
        g.add(strut);
      }
    }
    // rotors
    this.rotor = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 5.4), dark);
      b.position.z = 2.6;
      const arm = new THREE.Group();
      arm.rotation.y = (k * Math.PI) / 2;
      arm.add(b);
      this.rotor.add(arm);
    }
    this.rotor.position.y = 1.35;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.4, 32), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 1.36;
    g.add(this.rotor, disc);
    this.tail = new THREE.Group();
    for (let k = 0; k < 2; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.12), dark);
      b.rotation.x = (k * Math.PI) / 2;
      this.tail.add(b);
    }
    this.tail.position.set(0.12, 0.9, -5.75);
    g.add(this.tail);
    // nav lights
    this.navR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.navR.position.set(0, -1.15, 0);
    g.add(this.navR);
    // searchlight
    this.spot = new THREE.SpotLight(0xf2f6ff, 0, 140, 0.16, 0.45, 1.2);
    this.spot.position.set(0, -1.1, 1.4);
    g.add(this.spot, this.spot.target);
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(4, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.game.scene.add(this.beam);
    return g;
  }

  arrive(target) {
    if (this.active && !this.leaving) return;
    this.active = true;
    this.leaving = false;
    this.root.visible = true;
    // come in from far away
    const a = Math.random() * 6.28;
    this.pos.set(target.x + Math.cos(a) * 420, 70, target.z + Math.sin(a) * 420);
    this.vel.set(0, 0, 0);
    this.game.toast('🚁 Police helicopter overhead!', 'warn', 3);
    this.game.hud.notify?.('📻 SDPD Dispatch', 'Air One is up. Suspect will have nowhere to hide.', '', 4);
  }

  leave() {
    if (!this.active) return;
    this.leaving = true;
  }

  /** Can the helicopter see the target right now? */
  sees(p, hidden) {
    if (!this.active || this.leaving) return false;
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    return d < 240 && !hidden;
  }

  update(dt, target) {
    const g = this.game;
    if (!this.active) return;
    // fly to an orbit point above the target, or away when leaving
    this.orbit += dt * 0.18;
    let want;
    if (this.leaving || !target) {
      want = _v.copy(this.pos).add(_w.set(this.pos.x - g.player.focus.x, 0, this.pos.z - g.player.focus.z).setLength(60)).setY(90);
    } else want = _v.set(target.x + Math.cos(this.orbit) * 32, target.y + 42, target.z + Math.sin(this.orbit) * 32);
    _w.copy(want).sub(this.pos);
    const d = _w.length();
    const maxV = this.leaving ? 45 : clamp(d * 0.5, 8, 42);
    _w.setLength(Math.min(maxV, d * 2));
    this.vel.lerp(_w, Math.min(1, dt * 0.9));
    this.pos.addScaledVector(this.vel, dt);
    this.root.position.copy(this.pos);
    // nose into the direction of travel, banking into turns
    const yaw = Math.atan2(this.vel.x, this.vel.z);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.root.rotation.set(clamp(sp * 0.008, 0, 0.25), yaw, 0, 'YXZ');
    this.rotor.rotation.y += dt * 38;
    this.tail.rotation.x += dt * 60;
    this.navR.visible = Math.floor(g.physics.time * 1.2) % 2 === 0;
    // searchlight at night
    const night = g.env.night;
    if (target && !this.leaving && this.opts.searchlight !== false) {
      this.spot.target.position.copy(this.root.worldToLocal(_v.copy(target)));
      this.spot.intensity = night > 0.3 ? 900 * night : 0;
      const from = this.root.localToWorld(_w.set(0, -1.1, 1.4));
      const len = from.distanceTo(target);
      this.beam.position.copy(from).lerp(target, 0.5);
      this.beam.scale.set(1, len, 1);
      this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), _v.copy(target).sub(from).normalize());
      this.beam.material.opacity = night > 0.3 ? 0.08 * night : 0;
    } else {
      this.spot.intensity = 0;
      this.beam.material.opacity = 0;
    }
    if (!this.opts.quiet) g.audio?.heliRotor?.(this.pos, d, true);
    if (this.leaving && this.pos.distanceTo(g.player.focus) > 500) this.despawn();
  }

  despawn() {
    this.active = false;
    this.leaving = false;
    this.root.visible = false;
    this.beam.material.opacity = 0;
    this.spot.intensity = 0;
    this.game.audio?.heliRotor?.(this.pos, 0, false);
  }
}
