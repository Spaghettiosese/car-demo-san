import * as THREE from 'three';

const _c = new THREE.Vector3();
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const CORNERS = [];
for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) CORNERS.push([x, y, z]);

/**
 * Buoyancy and drag for a car in the sea. The car is treated as its bounding
 * box split into eight corner cells; each submerged cell pushes up with a
 * share of the displaced weight and drags against the water. Cars float at
 * first (air in the cabin), then sink as water gets in (car.flood -> 1).
 */
export function applyWater(car, terrain, h) {
  const b = car.body;
  const p = b.position;
  car.submerged = 0;
  if (!terrain || p.z < 370) return;
  const wy = terrain.waterAt(p.x, p.z);
  if (wy === -Infinity || p.y - car.radius > wy) return;
  const mn = car.boundsMin, mx = car.boundsMax;
  const m = b.mass;
  const flood = car.flood || 0;
  const cell = (m * 9.81 * (2.2 - 1.75 * flood)) / 8;
  let sub = 0;
  for (const [ix, iy, iz] of CORNERS) {
    _c.set(ix ? mx.x : mn.x, iy ? mx.y : mn.y, iz ? mx.z : mn.z);
    b.toWorldPoint(_c, _w);
    const d = wy - _w.y;
    if (d <= -0.3) continue;
    const f = Math.min(1, (d + 0.3) / 0.6);
    sub += f / 8;
    b.pointVelocity(_w, _v);
    const sp = _v.length();
    const k = (m * f) / 8;
    _f.set(-_v.x * k * (0.45 + 0.08 * sp), cell * f - _v.y * k * (1.1 + 0.12 * sp), -_v.z * k * (0.45 + 0.08 * sp));
    b.applyForce(_f, _w);
  }
  car.submerged = sub;
  car.waterLevel = wy;
}

/** Per-frame consequences of being in water (flooding, hydrolock, shorts, splashes). */
export function updateWaterEffects(car, dt, game) {
  const sub = car.submerged || 0;
  const was = car.wasSubmerged || 0;
  car.wasSubmerged = sub;
  const pt = car.phys.pt;
  if (sub > 0.02) {
    // splash on entry
    if (was < 0.02) {
      const v = car.body.velocity;
      const hit = Math.abs(v.y) + v.length() * 0.3;
      if (hit > 2) {
        for (let i = 0; i < Math.min(12, hit * 1.5); i++) {
          _w.set(car.body.position.x + (Math.random() - 0.5) * 3, car.waterLevel, car.body.position.z + (Math.random() - 0.5) * 4);
          game.fx?.water(_w, 0.6 + Math.random() * 0.5, 0.6);
        }
        game.audio?.splash?.(car, Math.min(1, hit / 12));
      }
    }
    // water gets in through door seals, faster with broken glass or open windows
    const glass = Object.values(car.model.glassParts).some((g) => g.state === 'shattered');
    const open = car.sys.window > 0.2 || car.model.allParts.some((p) => p.name.startsWith('door') && (p.userOpen || p.state === 'detached'));
    const rate = sub > 0.3 ? 0.012 + (glass ? 0.07 : 0) + (open ? 0.05 : 0) : 0.002;
    car.flood = Math.min(1, (car.flood || 0) + rate * dt * sub);
    // engine sucks water through the intake: hydrolock
    if (pt.running && !pt.ev && sub > 0.45) {
      pt.hydrolock();
      game.onPartEvent?.(car, null, 'hydrolock');
    }
    // electrics short out once the cabin floor is under
    if (sub > 0.55 && !car.electricsDead) {
      car.electricsDead = true;
      if (pt.ev && pt.running) pt.shutOff();
      game.onPartEvent?.(car, null, 'shorted');
    }
    if (car.speed > 3 && Math.random() < dt * 20) {
      _w.set(car.body.position.x, car.waterLevel, car.body.position.z);
      game.fx?.spray(_w, car.body.velocity, 1);
    }
  } else if (car.flood > 0) {
    // drains slowly once out of the water
    car.flood = Math.max(0, car.flood - dt * 0.03);
  }
}
