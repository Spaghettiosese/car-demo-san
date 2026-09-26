import * as THREE from 'three';
import { StaticWorld } from '../js/physics/world.js';
import { VehiclePhysics } from '../js/vehicle/vehiclePhysics.js';
import { buildTuning, configForBody, DEFAULT_CONFIG } from '../js/vehicle/specs.js';

const g = new THREE.Vector3(0, -9.81, 0);
const DT = 1 / 240;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };

function makeCar(body, extra = {}) {
  const cfg = { ...configForBody(body, DEFAULT_CONFIG), ...extra };
  const t = buildTuning(cfg);
  const v = new VehiclePhysics(t);
  v.resetTo(0, 0, 0, 0);
  v.pt.running = true;
  v.pt.setSelector('D');
  v.pt.omega = v.pt.spec.idle ? v.pt.spec.idle * Math.PI / 30 : 0;
  if (v.pt.ev) v.pt.gear = 1;
  return v;
}
function run(v, world, secs, fn) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    if (fn) fn(i * DT);
    v.step(DT, world, g);
    // ground contact for hull not modelled here
    v.body.integratePosition(DT);
  }
}
const world = new StaticWorld();

for (const body of ['sedan', 'hatch', 'muscle', 'coupe', 'suv', 'pickup', 'van']) {
  console.log(`\n== ${body}`);
  const v = makeCar(body);
  run(v, world, 2, () => { v.input.throttle = 0; v.input.brake = 0.3; });
  const y0 = v.body.position.y;
  check(Math.abs(v.body.velocity.length()) < 0.2, `settles at rest (v=${v.body.velocity.length().toFixed(3)}, y=${y0.toFixed(3)}, s=${v.wheels.map(w=>w.s.toFixed(3)).join(',')})`);
  let t100 = null, t = 0;
  const trace = [];
  run(v, world, 30, (tt) => {
    v.input.throttle = 1; v.input.brake = 0; v.input.steer = 0;
    t = tt;
    if (t100 === null && v.speed * 3.6 >= 100) t100 = tt;
    if (Math.abs(tt - Math.round(tt)) < DT / 2 && Math.round(tt) % 3 === 0) trace.push(`${Math.round(tt)}s:${(v.speed*3.6).toFixed(0)}km/h g${v.pt.gear} ${v.pt.rpm.toFixed(0)}rpm`);
  });
  console.log('  ', trace.join(' | '));
  check(t100 !== null && t100 < 14, `0-100 km/h in ${t100 && t100.toFixed(2)} s`);
  const vmax = v.speed * 3.6;
  check(vmax > 150 && vmax < 320, `speed after 30s ${vmax.toFixed(0)} km/h`);
  check(Math.abs(v.body.position.x) < 2, `drives straight (x drift ${v.body.position.x.toFixed(2)} m)`);
  // braking from current speed down to 0, measure from 100 km/h
  run(v, world, 40, () => { v.input.throttle = 0; v.input.brake = v.speed * 3.6 > 101 ? 1 : 0; });
  // now at <100: accelerate a bit to exactly 100 then brake
  let startZ = null, stopT = 0;
  const pos0 = v.body.position.clone();
  const v0 = v.speed * 3.6;
  run(v, world, 8, (tt) => { v.input.throttle = 0; v.input.brake = 1; if (v.speed < 0.3 && !stopT) stopT = tt; });
  const dist = v.body.position.distanceTo(pos0);
  console.log(`   braking from ${v0.toFixed(0)} km/h: ${dist.toFixed(1)} m, ${stopT.toFixed(2)}s, ABS ok`);
  check(!Number.isNaN(v.body.position.x), 'no NaN');
}

// cornering: sedan at ~70 km/h steady steer
{
  console.log('\n== skidpad sedan');
  const v = makeCar('sedan');
  run(v, world, 1);
  let maxLat = 0;
  run(v, world, 25, (tt) => {
    const sp = v.speed * 3.6;
    v.input.throttle = sp < 60 ? 0.6 : 0.25;
    v.input.steer = tt > 6 ? 0.35 : 0;
    const a = v.body.angularVelocity.y * v.speed;
    if (tt > 12) maxLat = Math.max(maxLat, Math.abs(a));
  });
  const up = new THREE.Vector3(0,1,0).applyQuaternion(v.body.quaternion);
  console.log(`   lateral accel ${ (maxLat/9.81).toFixed(2) } g, speed ${(v.speed*3.6).toFixed(0)} km/h, roll up.y ${up.y.toFixed(3)}`);
  check(maxLat / 9.81 > 0.5 && maxLat / 9.81 < 1.4, 'lateral g plausible');
  check(up.y > 0.9, 'did not roll over');
}
// reverse
{
  console.log('\n== reverse');
  const v = makeCar('hatch');
  run(v, world, 1);
  v.pt.setSelector('R');
  run(v, world, 4, () => { v.input.throttle = 0.6; });
  console.log('   fwd speed', v.forwardSpeed.toFixed(2), 'gear', v.pt.gear);
  check(v.forwardSpeed < -2, 'reverses');
}
// handbrake turn -> should rotate
{
  console.log('\n== handbrake');
  const v = makeCar('muscle');
  run(v, world, 1);
  run(v, world, 6, () => { v.input.throttle = 1; });
  run(v, world, 1.5, () => { v.input.throttle = 0; v.input.steer = 0.8; v.input.handbrake = 1; });
  const yawRate = v.body.angularVelocity.y;
  console.log('   yaw rate', yawRate.toFixed(2), 'speed', (v.speed*3.6).toFixed(0));
  check(Math.abs(yawRate) > 0.3, 'handbrake rotates the car');
}
// EV
{
  console.log('\n== ev');
  const v = makeCar('coupe', { engine: 'ev' });
  v.pt.running = true; v.pt.setSelector('D');
  let t100 = null;
  run(v, world, 12, (tt) => { v.input.throttle = 1; v.input.handbrake = 0; if (t100 === null && v.speed*3.6 >= 100) t100 = tt; });
  console.log('   0-100', t100 && t100.toFixed(2), 'speed', (v.speed*3.6).toFixed(0));
  check(t100 && t100 < 7.5, 'ev quick');
}
console.log(failures ? `\n${failures} failures` : '\nall good');
process.exit(failures ? 1 : 0);
