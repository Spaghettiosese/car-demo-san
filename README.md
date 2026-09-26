# SAN DEMO — Driving Sandbox

A driving sandbox tech demo that runs in the browser (three.js, no build step). You drive around the city of San Demo in third person or from a fully interactive cockpit. The cars have raycast tyre physics and soft-body crash damage, and the city is full of traffic that obeys the rules until you make it angry. Police are optional.

Everything is generated in code: car bodies, the city, textures and every sound. There are no model, texture or audio files.

## Run it

The game uses ES modules, so serve it over HTTP. Opening `index.html` from disk won't work.

```bash
npx serve .            # or: python3 -m http.server 8000
```

Open the printed URL in Chrome, Edge or Firefox on a desktop with a dedicated or modern integrated GPU. Headphones are recommended.

You start in the cockpit with the engine off. Point at the key and click it, or press **I**.

## Controls

| Driving | | Camera & world | |
| --- | --- | --- | --- |
| W / S (↑ / ↓) | Throttle / brake, hold S at a stop to reverse | C | Cycle cameras (chase, far, cockpit, hood, bumper, cinematic, TV) |
| A / D (← / →) | Steer | Mouse | Cockpit free-look (click to grab the mouse), chase-cam orbit |
| Space | Handbrake | Left click | Use the cockpit control under the crosshair |
| X or Shift / Z | Shift up / down (manual) | Middle mouse (hold) | Cockpit zoom |
| T | Toggle automatic / manual gearbox | B | Look back |
| I | Start / stop engine | M | Map, click to set a GPS waypoint |
| H | Horn | N | Next radio station |
| L / K | Headlights (off / parking / on) / high beams | F2 | Photo mode (free camera) |
| Q / E / J | Left / right indicator, hazards | \ | Slow motion |
| V | Wipers (off / intermittent / low / high) | F3 | Telemetry (wheel loads, slip, g-forces) |
| R (hold) | Recover / flip the car | F1 | Controls overlay |
| Backspace | Repair | Esc | Pause and sandbox menu |
| F | Get out / get in (or steal) a car | Enter | Garage or refuel, when you're in the right spot |
| G | Siren (in a police car) | | |

On foot, use WASD to walk, Shift to run and Space to jump. A gamepad also works: RT/LT for throttle and brake, the left stick to steer and the right stick to look.

## The cockpit

In the cockpit view, point the crosshair at a control and click it:

- **Ignition key** (OFF → ACC → ON → START). Turning it to ON sweeps the gauge needles and lights every warning lamp as a bulb check.
- **Left stalk** signals left or right depending on where you click. The tip toggles high beams. Indicators cancel themselves after the turn.
- **Right stalk** sets the wiper speed. The tip sprays washer fluid.
- **Light knob**, **hazard button**, **defrost button** (the windshield fogs up in the rain without it), **radio screen** (previous / power / next).
- **Gear selector** (P-R-N-D), **parking brake lever**, and pedals that move with your inputs.
- **Door handle** (the door really opens), **window switch** (louder wind and outside sound), **seatbelt buckle** (chimes if you drive unbuckled), **dome light**, **sun visor**, **glovebox**.
- **Horn pad** on the steering wheel. The wheel turns about 420° each way and your hands follow it.
- **Live rear-view and side mirrors**, rain drops that the wipers clear, cracks when you crash, and an airbag in hard frontal hits.
- The instrument cluster has a tach, speedo, gear, trip, temperature, fuel, current street and shift lights. The screen shows the radio and a moving map.

## What's simulated

**Vehicle physics** (`js/vehicle/vehiclePhysics.js`, `powertrain.js`, `tire.js`)
- Rigid-body chassis on four raycast spring/damper corners with bump stops and anti-roll bars. The tyre contact patch is sampled so curbs roll up properly.
- A combined-slip tyre model (friction ellipse, load sensitivity, surface grip, wet grip), four tyre compounds, and an implicit wheel-spin solver that stays stable at 240 Hz.
- An engine torque curve through an implicit clutch to a 6-speed gearbox and an open / limited-slip / locked differential, in FWD, RWD or AWD. It covers idle control, rev limiter, stalling, rev-matched downshifts, turbo lag and blow-off, overrun pops, fuel use, engine temperature and an EV motor.
- ABS, traction control and a counter-steer assist (all optional), plus aerodynamic drag and wing downforce.

**Damage** (`js/vehicle/deform.js`, `car.js`)
- Each car has a node-and-beam lattice with plastic yield. Impacts dent it, the dent spreads through the structure, and the metal springs back slightly.
- Crumple zones are softer than the safety cell, and the engine block is hard.
- The deformed lattice drives the body mesh, the collision hull and the suspension mounts. Bent structure means bent handling: toe and camber change, rims wobble, tyres go flat.
- Hoods pop their latch and fly open at speed. Doors, bumpers and mirrors come loose and fall off as physics objects. Wheels can break off and roll away.
- Glass cracks and shatters, lights break, and radiator damage vents steam and overheats the engine. The engine can die and the fuel tank can leak.

**City** (`js/world/`)
- A 7×7 street grid with two lanes each way and timed, staggered traffic lights. Blocks include a downtown with towers, midtown shops, residential streets, Liberty Park, the Fuel Stop, San Demo Customs (repair and garage), Police HQ, a parking lot and a construction site with dirt jumps.
- A **Proving Grounds** area with jumps, a skid pad with a live g meter, a quarter-mile drag strip with timing, a crash-test wall that reads out impact speed, and slalom cones.
- Breakable street furniture: lamp posts, hydrants (which spray water), cones, benches, mailboxes, meters and barrels.
- A day/night cycle, and clear, cloudy, rain, storm (with lightning) and fog weather. Roads get wet, and wet roads mean less grip and tyre spray.

**AI** (`js/ai/`)
- Traffic drivers follow lanes, change lanes before turns, signal, stop for red and yellow lights, yield on left turns, keep their distance and slow for corners. Far-away cars switch to a cheap kinematic mode.
- Drivers **honk** when you block them, go around you, flash their high beams if you drive the wrong way, and honk back at you. If you hit them they get shaken or **road rage**: they chase you, tailgate, ram you and yell insults (speech bubbles).
- **Police** (toggle in Esc → World) watch for speeding, red-light running, hit-and-runs, property damage and carjacking.
  - One star is a pull-over: stop and you get a ticket.
  - Keep going and it becomes a pursuit, with PIT maneuvers from three stars, and roadblocks and spike strips from four.
  - Break line of sight to escape. Stop next to a cruiser and you're busted.

**Audio** (`js/audio/`)
- Engines are synthesized per cylinder layout: a burbly cross-plane V8, a buzzy I4, a smooth I6, a V6, and EV whine. They crossfade across rpm and load, and sound muffled from inside the cabin.
- Turbo whistle, pops and bangs, tyre squeal, road and wind noise, metal crunches, glass shattering, scrapes, positional horns and sirens.
- The radio has four procedurally composed stations. The talk station reads out news about your own driving.

## Sandbox menu (Esc)

- **World**: time of day, time speed, weather, traffic density, police, road rage, damage level, crash slow-mo, reset the world.
- **Sandbox**: repair, flip, refuel, invincibility, teleport, spawn ramps / parked cars / a wall of cars / cones / barrels, "Launch me", car rain, anger the nearest driver, set wanted level, gravity (Earth / Mars / Moon), slow motion.
- **Car**: switch gearbox and assists on the fly. **Settings**: graphics preset, resolution scale, shadows, bloom, FOV, units, volumes. **Stats**.

The **Garage** is available from the main menu, the pause menu, or by driving into San Demo Customs and pressing Enter. It offers 7 bodies (sedan, hot hatch, muscle car, sports coupe, SUV, pickup, van) and these options:

- Paint and finish (gloss / metallic / pearl / matte / chrome), liveries, window tint.
- Seven rim styles, 16"–21" rims, rim colour, tyre compound.
- Engine (I4 / V6 / V8 / I6 / electric), turbo, ECU stages, gearbox, drivetrain, differential, exhaust, anti-lag.
- Ride height, springs, dampers, anti-roll bars, brake bias, weight reduction, ABS, TCS.
- Spoilers, underglow, headlight colour, horn, licence plate.

The 0-100 and top-speed numbers come from actually running the physics.

## Project layout

```
index.html, style.css      page shell and HUD styles
js/main.js                 game loop, state, events, lights, zones
js/physics/                rigid body, contact solver, static world, collision system
js/vehicle/                specs, tyre, powertrain, vehicle physics, deformation, car builder, wheels, interior, Car entity
js/world/                  city generator, props & traffic signals, environment (sky/weather), textures
js/ai/                     traffic drivers, police, road-graph routing
js/audio/                  engine/SFX synthesis, radio
js/fx/                     particles, skid marks, debris physics
js/ui/                     HUD, menus, garage
vendor/three.module.min.js three.js r160 (MIT)
tests/                     physics tests, car render test page, headless drive scripts
```

## Tests

```bash
npm test                   # headless physics checks: settling, 0-100, top speed, braking, skidpad, reverse, handbrake, EV
```

`tests/cars.html` renders every body style, which is useful when tweaking the car builder. `tests/play.mjs` drives the game in headless Chromium through Playwright and takes screenshots.

## Notes

- Performance depends on your GPU. If it's slow, use Esc → Settings → Graphics preset → Medium/Low, lower the resolution scale, or reduce traffic.
- Settings and your car are saved in `localStorage`.
