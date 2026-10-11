# SAN DEMO — Driving Sandbox

A driving sandbox that runs in the browser (three.js, no build step). You drive around San Demo in third person or from a fully interactive cockpit, through a city, a mountain canyon, a coast highway, a harbor, a beach and the sea.

- The cars have raycast tyre physics and soft-body crash damage.
- The city is full of traffic, pedestrians, buses and emergency services. They obey the rules until you make them angry.
- The police care what you do.

Everything is generated in code: car bodies, the city and hills, textures and every sound. There are no model, texture or audio files.

**v2** is a remake on top of the original demo. It adds a Career mode, 18 activities, a much bigger world and 350 new features, all listed and ticked in [`FEATURES.md`](FEATURES.md).

## Run it

The game uses ES modules, so serve it over HTTP. Opening `index.html` from disk won't work.

```bash
npx serve .            # or: python3 -m http.server 8000
```

Open the printed URL in Chrome, Edge or Firefox on a desktop with a dedicated or modern integrated GPU. Headphones are recommended.

## Modes

- **Career**: three save slots with autosave. You start with Uncle Vic's tired hatchback and $1,500, and a short tutorial walks you through your first drive.
  - Earn money and XP from jobs, races and stunts.
  - Buy cars and parts at the dealership and garage.
  - Pay for fuel, repairs, insurance, loans and fines.
  - Too many licence points suspend your licence.
- **Free Roam**: everything unlocked, free repairs and the full sandbox menu.
- **Free Roam garage**: build a car straight from the main menu.

## Controls

| Driving | | Camera, world & UI | |
| --- | --- | --- | --- |
| W / S (↑ / ↓) | Throttle / brake (hold S at a stop to reverse) | C | Cycle cameras (chase, far, cockpit, helmet, hood, bumper, wheel, drone, news heli, orbit, director, TV) |
| A / D (← / →) | Steer | Mouse | Cockpit free-look (click to grab the mouse), chase-cam orbit |
| Space | Handbrake | Left click | Use the cockpit control under the crosshair |
| X or Shift / Z | Shift up / down | B, [ / ] | Look back, look left / right |
| 1–7, \`, 0 | Direct gear select, reverse, neutral (manual) | M | Map: zoom, pan, filters, click to set a GPS route |
| Left Ctrl | Clutch | Tab | Phone: map, jobs, contacts, bank, messages |
| T | Toggle automatic / manual gearbox | N | Next radio station |
| I | Start / stop engine (EVs: hold the brake) | F2 | Photo mode |
| ; | Seatbelt | F5 | Replay of the last 30 s |
| L / K / Y | Headlights / high beams / flash-to-pass | F4 | Restart the current event |
| . | Fog lights | F6 | Hide the HUD |
| Q / E / J | Left / right indicator, hazards (double-blink to say thanks) | F3 | Telemetry: loads, slip, g-forces, throttle and brake trace |
| V | Wipers (off / intermittent / low / high / auto) | F1 | Controls overlay |
| O, + / − | Cruise control and set speed | \\ | Slow motion |
| U | Speed limiter | Esc | Pause menu and sandbox |
| , and / | Drive mode (Eco / Normal / Sport), EV regen level | Enter | Garage, fuel, charging and activities, when you're in the right spot |
| R (hold) | Recover / flip the car | Backspace | Repair (Free Roam) |
| F | Get out / get in (or steal) a car | PgUp / PgDn / Home / End | Seat height and position |
| H | Horn | G | Siren (in a police car) |

Every driving key can be rebound (main menu → Controls & key bindings).

- **On foot**: WASD to walk, Shift to run, Space to jump. Hold E to use the fire extinguisher; press E to jump-start a car.
- **Gamepads** work, with rumble: RT/LT for throttle and brake, the left stick to steer and the right stick to look.
- **Steering wheels** work too, and can be calibrated in Settings → Driving.

## The cockpit

In the cockpit view, point the crosshair at a control and click it.

- **Ignition key** (OFF → ACC → ON → START). At ON the fuel pump primes and every lamp lights for the bulb check.
  - Cold engines fast-idle while they warm up.
  - Long cranking floods the engine.
  - The classic car has a manual choke.
  - EVs show READY.
- **Lighting and visibility**:
  - **Stalks** for the indicators, high beams, wipers (with an AUTO rain sensor) and washer.
  - The **light knob** has an AUTO setting, and there are fog lights.
  - Hazard, front and rear defrost buttons, and **climate** fan, temperature and A/C.
- **Driver aids and cabin controls**:
  - TCS-OFF, an electronic parking brake, and the gear selector and lever, which shifts the manual box.
  - Hood, trunk and fuel-door releases; door handle, window switch and seatbelt buckle.
  - Dome light, sun visor (it blocks low-sun glare), glovebox (your registration for traffic stops), phone mount and a mirror-fold button.
- **Live mirrors**: a rear-view mirror and side mirrors with their own view angles. The mirror adjust pad aims them.
- **Cabin effects**:
  - Rain on the glass that the wipers clear.
  - Fogged windows in the rain unless you use the climate controls.
  - Cracks when you crash, an airbag in hard frontal hits, and water filling the cabin if you drive into the sea.
- **Instrument cluster**:
  - Gauges: tach, speedo, gear and shift lights, plus temperature, fuel, oil and battery/voltage.
  - The trip computer shows instant and average consumption and range; click it to reset trip A/B.
  - EV state of charge, and analog or digital gauge styles.
- **Hands and pedals**: the wheel turns about 420° each way with self-centring from the tyres. Your hands follow it, the pedals move (a clutch appears for manuals), and the cabin shakes with rpm and road bumps.

## What's simulated

**Vehicle physics** (`js/vehicle/`)
- A rigid-body chassis on four raycast spring/damper corners with bump stops and anti-roll bars. A combined-slip tyre model handles load sensitivity, surface and wet grip, tyre temperature, wear and pressure, camber and toe, and blowouts.
- Surfaces: asphalt, dirt, gravel, rock and deep sand (drag, sinking and sand plumes). Standing water causes aquaplaning. Wind gusts push tall vehicles.
- Powertrain: an engine → clutch → per-car gearbox and final drive → open, LSD or locked differential, in FWD, RWD or AWD.
  - Manual clutch, stalling, gear grinding, money-shift over-revs, launch control, hill-start assist and drive modes.
  - Turbo lag, boost control, anti-lag and overrun pops.
  - Fuel, oil and coolant; EVs have a battery with regen.
  - The 12 V battery and alternator can go flat; jump-start from another car.
- ABS, TCS, ESC and counter-steer assists with Arcade, Realistic and Sim presets. Brakes fade when hot, and there is aero drag and wing downforce.

**Damage** (`js/vehicle/deform.js`, `car.js`, `systems.js`)
- Each car has a node-and-beam lattice with plastic yield and crumple zones. The deformed lattice drives the body mesh, the collision hull and the suspension mounts, so bent structure means bent handling.
- Panels come loose and fall off, hoods fly open, glass cracks and shatters, lights break and headlights misaim, and wheels break off.
- Systems fail as well:
  - Radiator and coolant leaks overheat the engine; oil leaks seize it.
  - The transmission loses gears, the steering rack pulls, electrics flicker, the horn sticks and the exhaust drags sparks.
  - Fuel leaks plus sparks start fires, and a burning car can explode. Use the fire extinguisher on foot.
- The driver can be injured. Without a seatbelt you get blur and tinnitus, or go through the windshield. Water hydrolocks engines, shorts the electrics and sinks cars.

**World** (`js/world/`)
- **The city**: a 7×7 street grid with timed traffic lights, four-way stops, a one-way street, speed bumps, potholes and manholes. It has a downtown with towers, midtown shops (with breakable windows) and residential streets.
  - Places: Liberty Park, the Fuel Stop with EV chargers, San Demo Customs, the car wash, Police HQ, San Demo General hospital, the parking lot and the construction site with dirt jumps.
  - Breakable street furniture: trees, traffic signals, bollards, lamp posts, hydrants, cones, benches and more.
- **Beyond the city**:
  - Terrain with hills, forests and boulders.
  - A canyon road with hairpins up to the Demo Peak lookout, a coast highway loop with guardrails and a dirt rally trail.
  - The beach and pier, a lighthouse and a harbor with warehouses, containers, cranes, pushable crates and a roundabout.
  - The sea, with waves, surf and boats.
- **The Proving Grounds**: jumps, a skid pad with a g meter, a quarter-mile drag strip, a crash-test wall and a slalom.
- **Weather and sky**:
  - A day/night cycle; street lights come on one by one at dusk.
  - Weather that changes by itself: clear, cloudy, rain (puddles), storm (with lightning), fog and snow.
  - Rainbows after rain, shooting stars, and fireworks over the harbor at 21:00.
- **Life**: animated billboards, flags in the wind, gulls, bird flocks and airliner flyovers. Pedestrians cross with the signals, dodge cars, react to the horn and walk their dogs.

**AI** (`js/ai/`)
- **Traffic drivers**:
  - They follow lanes, signal, stop for lights and STOP signs (first come, first served) and yield. They pull over for sirens and slow for bumps.
  - Each one has a personality: learners, elderly drivers, boy-racers, and drunks at night.
  - Traffic is heavier at rush hour and thinner at night.
  - Parked cars pull out, delivery vans double-park, and cars break down with their hazards on.
  - NPCs honk at and crash into each other, then get out and argue.
- **City buses** run a route and stop at the shelters.
- **Emergency services**: ambulances respond to big crashes, fire trucks to car fires, and tow trucks clear wrecks.
- **Road rage**:
  - If you hit someone they may tailgate, brake-check, cut you off, ram you, or get out to confront you.
  - A hazard "sorry" flash calms them.
  - A carjacked driver chases you on foot.
- **Police** watch for speeding, red lights and STOP signs, wrong-way driving, no seatbelt or no lights at night, hit-and-runs, property damage, hitting pedestrians and carjacking.
  - One star is an interactive traffic stop: pull over, the officer walks up, and you hand over your registration.
  - Keep going and it becomes a pursuit, with PIT maneuvers, roadblocks with officers, spike strips, unmarked cars, and a helicopter with a searchlight from four stars.
  - Speed cameras flash you.
  - Escape by breaking line of sight, hiding in a garage or getting a respray.

**Audio** (`js/audio/`)
- Engines are synthesized per layout: I4, I6, V6, cross-plane V8, V12, diesel and EV. They crossfade across rpm and load and sound muffled from inside the cabin. Traffic engines match their cars.
- Mechanical sounds: turbo, pops, tyre squeal, gravel and sand, brake squeal, suspension clunks, damage rattles, rod knock, gear grind, cooling-fan run-on and exhaust tick.
- Doppler on passing cars and sirens. Each car has its own indicator relay, plus seatbelt and door chimes.
- Ambience: sea and seagulls, birds and crickets, downtown horns, wind gusts and rain on the roof. Thunder arrives after the lightning, delayed by its distance.
- The radio has five stations, including a talk station that reads out news about your driving and a live police scanner. Static plays between stations while tuning, and there's a volume knob.
- Spoken lines: NPCs and GPS turn-by-turn prompts, with optional subtitles.

## Activities

Activities are yellow markers on the map: drive in and press Enter. Each has medals, a local leaderboard and a ghost of your best run, with rewards scaled by AI difficulty.

- **Jobs**: Taxi Shift (comfort-rated tips), Courier Run, Fragile Freight (g-limited cargo), Ambulance Run, Valet Parking.
- **Races**: Downtown Sprint, Canyon Run, Harbor Circuit and the Quarter Mile Duel against named rivals with rubber-band AI. There are countdown lights and false-start detection, plus wager races and red-light street races against boy-racers.
- **Time trials and challenges**: Coast Highway Time Trial, Canyon Hill-climb, Forest Rally Stage, Drift Trial, Slalom, Eco Challenge and a daily challenge.
- **Mayhem**: Demolition Derby, Cop Duty (catch fleeing suspects in a cruiser) and Heat Run (survive the police).
- **Free-roam scoring**: drift combos, near misses, airtime, 8 speed traps, 8 stunt jumps, 25 hubcaps and photo challenges at scenic spots.

## Garage and dealership

San Demo Customs (drive in and press Enter) holds several cars, each with named setups, mileage and condition. It offers these options:

- **Bodies (11)**: sedan, hot hatch, muscle car, sports coupe, SUV, pickup, van, classic, supercar, truck and city bus.
- **Engines and drivetrain**: I4, V6, V8, I6, V12, diesel and electric. Turbo and boost controller, ECU stages, gearbox, gear ratios and final drive, drivetrain, differential and LSD preload, exhaust and tips, anti-lag.
- **Chassis and brakes**: ride height, springs, dampers, anti-roll bars, camber and toe, tyre compound, width and pressure, brake bias, a big brake kit, weight reduction and a roll cage.
- **Looks**:
  - Paint and finish, two-tone, liveries, racing numbers and window tint.
  - Body kits, a hood scoop and wide body.
  - Rims (style, size, offset, colour), caliper colour, smoked tail lights, headlight colour, underglow modes and spoilers.
- **Interior**: steering wheels, bucket seats, interior colour and gauge style.

A dyno graph shows the torque and power curves. The 0-100 and top-speed numbers come from actually running the physics. In Career, parts cost money, and the dealership sells, buys back (with depreciation) and lends test drives.

## Replay, photo and cameras

- **Replay (F5)**: the last 30 seconds, with scrubbing, playback speed and chase, trackside, cinematic and free cameras. Hard crashes replay automatically (optional).
- **Photo mode (F2)**:
  - The sim pauses and the HUD hides.
  - A free camera with field of view and time of day.
  - Exposure, contrast, saturation, vignette, film grain and colour filters.
  - Save a PNG.
- **Camera settings**: chase distance, height and stiffness; cockpit FOV; reduced camera shake; a rear-view PiP. Cameras never clip into hills.

## Sandbox menu (Esc)

- **World**: time and time speed, weather (auto or fixed), traffic density (optionally by time of day), police, road rage, emergency services, damage level, crash slow-mo, and resetting the world.
- **Sandbox**:
  - Utilities: repair, flip, refuel, invincibility, teleport, gravity (Earth / Mars / Moon) and slow motion.
  - Spawning: ramps, parked cars, a wall of cars, cones, barrels, car rain, "Launch me", black-ice patches and traffic jams.
  - Spawn AI racers, derby drivers, fleeing cars or ragers; spectate any NPC car.
  - Weather and time presets, saved and loaded scenarios, and the Crash Test tool (pick a speed, auto-drive into the wall, read the report).
- **Car**: gearbox and assists on the fly, damage report.
- **Settings**, in tabs:
  - **Graphics**: preset, resolution scale, dynamic resolution, view distance, tree density, shadows and bloom.
  - **Camera**: the camera settings above.
  - **HUD**: HUD scale, a colour-blind palette, speedometer style, speed-limit sign, subtitles and a frame-time graph.
  - **Audio**: volumes, NPC voices and GPS voice.
  - **Driving**: assist presets, toggle-or-hold controls, units and wheel calibration.
  - **World**: auto weather and traffic by time.

## Project layout

```
index.html, style.css      page shell and HUD styles
js/main.js                 game loop, state, settings, zones, crash test
js/physics/                rigid body, contact solver, static world, collision system, water
js/vehicle/                specs, tyre, powertrain, vehicle physics, car systems, deformation, car builder, interior, Car entity
js/world/                  city, terrain, props, environment (sky/weather/snow), ambient life, textures
js/ai/                     traffic, police and helicopter, emergency services and buses, racers, pedestrians, GPS routing
js/activities/             activity framework, events, free-roam scoring
js/career/                 profiles and save slots, economy, achievements, tutorial
js/audio/                  engine and SFX synthesis, mechanical and ambient extras, radio
js/fx/                     particles, skid marks, debris physics
js/ui/                     HUD and HUD extras, menus, garage, dealership, phone, photo mode
js/replay.js, sandbox.js   replay recorder and player, sandbox tools
js/camera.js, player.js, onfoot.js, input.js, post.js
vendor/three.module.min.js three.js r160 (MIT)
tests/                     physics tests, car render test page, headless drive scripts
```

## Tests

```bash
npm test                   # headless physics checks: settling, 0-100, top speed, braking, skidpad, reverse, handbrake, EV
```

- `tests/cars.html` renders every body style, which is useful when tweaking the car builder.
- `tests/play.mjs` drives the game in headless Chromium through Playwright and takes screenshots: `node tests/play.mjs out steps.json`.

## Notes

- Performance depends on your GPU. If it's slow, try:
  - Esc → Settings → Graphics: a Medium/Low preset, a lower resolution scale or dynamic resolution, a shorter view distance or fewer trees.
  - Reducing traffic.
- Settings, key bindings, career saves and sandbox scenarios are saved in `localStorage`.
