import * as THREE from 'three';
import { MATERIALS } from '../physics/world.js';
import { mulberry32, clamp } from '../core/util.js';
import { makeCanvas, canvasTexture } from '../core/canvas.js';
import { MeshBuilder } from './city.js';
import { HARBOR, SEA_LEVEL, shoreZ } from './terrain.js';
import { concreteTexture, beamTexture, signTexture } from './textures.js';

/**
 * The waterfront: the container harbor south-west of downtown (warehouses,
 * container stacks, gantry cranes, a moored freighter, a roundabout and loose
 * crates), the beach with its pier and the lighthouse on the western point.
 */
export class Coast {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.city = game.city;
    this.terrain = game.terrain;
    this.group = new THREE.Group();
    this.group.name = 'coast';
    this.scene.add(this.group);
    this.rng = mulberry32(2024);
    this.wetMats = [];
    this.nightMats = [];
    this.locations = {};
    this.containers = [];
    this.time = 0;
  }

  build() {
    this.buildApron();
    this.buildWarehouses();
    this.buildContainers();
    this.buildCranes();
    this.buildQuay();
    this.buildShip();
    this.buildTanks();
    this.buildRoundabout();
    this.buildPier();
    this.buildBeach();
    this.buildLighthouse();
    this.spawnCrates();
    return this;
  }

  // ------------------------------------------------------------ harbor
  buildApron() {
    const H = HARBOR;
    const tex = concreteTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, color: 0xd0cdc6 });
    this.wetMats.push({ mat, dry: 0.93, wet: 0.3, dryColor: new THREE.Color(0xd0cdc6), wetColor: new THREE.Color(0x8e8c88) });
    const mb = new MeshBuilder(1);
    mb.flat(H.x0, H.z0, H.x1, H.z1, 0, 7);
    const m = new THREE.Mesh(mb.build(), mat);
    m.receiveShadow = true;
    this.group.add(m);
    // painted lanes: entry avenue, quay road and yard aisles
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ly = new MeshBuilder(1), lw = new MeshBuilder(1);
    const y = 0.012;
    // quay road (east-west) at z = 497, entry road (north-south) at x = -110
    for (let x = H.x0 + 6; x < H.x1 - 6; x += 9) ly.strip(x + 2.5, 497, 1, 0, 5, 0.15, y);
    for (let z = 364 + 22; z < 490; z += 9) ly.strip(-110, z + 2.5, 0, 1, 5, 0.15, y);
    // quay edge warning stripe
    lw.strip((H.x0 + H.x1) / 2, H.z1 - 1.6, 1, 0, H.x1 - H.x0 - 2, 0.3, y);
    for (let x = H.x0 + 4; x < H.x1 - 2; x += 3) ly.strip(x, H.z1 - 0.7, 1, 0, 1.4, 1.0, y + 0.001);
    this.group.add(new THREE.Mesh(ly.build(), yellow), new THREE.Mesh(lw.build(), white));
    this.wetMats.push({ mat: white, dry: 0.7, wet: 0.2, dryColor: new THREE.Color(0xe8e6de), wetColor: new THREE.Color(0xbcbab2) });
    this.locations.harbor = { pos: new THREE.Vector3(-110, 0, 350), yaw: 0, name: 'Harbor' };
    // gate sign
    this.city.signBoard(-128, 342, 'PORT OF SAN DEMO', '#14365c', 10);
  }

  buildWarehouses() {
    const metal = corrugatedTexture('#6f7c86');
    const metal2 = corrugatedTexture('#8a5a3c');
    const roof = new THREE.MeshStandardMaterial({ color: 0x5d6166, roughness: 0.7, metalness: 0.4 });
    const doorTex = rollerDoorTexture();
    const list = [
      [-330, 345, -258, 398, 13, metal, 'PIER 1 LOGISTICS'],
      [-330, 412, -258, 468, 11, metal2, 'SAN DEMO SHIPPING CO.'],
      [-246, 345, -182, 388, 9, metal, 'COLD STORAGE'],
    ];
    for (const [x0, z0, x1, z1, h, tex, label] of list) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set((x1 - x0) / 6, 1);
      const wall = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.35 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), [wall, wall, roof, roof, wall, wall]);
      mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.world.addBox(x0, 0, z0, x1, h, z1, { kind: 'building' });
      // roller doors on the east face
      const dm = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.5, metalness: 0.5 });
      for (let z = z0 + 6; z < z1 - 5; z += 11) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), dm);
        d.position.set(x1 + 0.03, 2.5, z + 3);
        d.rotation.y = Math.PI / 2;
        this.group.add(d);
      }
      // loading dock lamps
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshStandardMaterial({ map: signTexture(label, '#1d2a38'), emissive: 0xffffff, emissiveMap: signTexture(label, '#1d2a38'), emissiveIntensity: 0.2 }));
      sign.position.set(x1 + 0.05, h - 2, (z0 + z1) / 2);
      sign.rotation.y = Math.PI / 2;
      this.group.add(sign);
      this.nightMats.push({ mat: sign.material, min: 0.2, max: 1 });
    }
  }

  buildContainers() {
    const rnd = this.rng;
    const colors = ['#b5302a', '#1f5f9e', '#2f7d4a', '#c98a1c', '#6b6f75', '#8a3b8f', '#d7d2c8', '#1d8a8a', '#a8542a'];
    const brands = ['MAERSKY', 'EVERGRIN', 'COSCOE', 'HAPAG-LOYD', 'MSK', 'ONE LINE', 'SANDEMO'];
    const mats = colors.map((c, i) => {
      const t = containerTexture(c, brands[i % brands.length]);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.3 });
    });
    const L = 12.2, W = 2.44, Hc = 2.6;
    const geo = new THREE.BoxGeometry(L, Hc, W);
    // yard: rows of stacks between x -170 and 40, z 400..482
    const byMat = new Map();
    const place = (x, z, level, rotY) => {
      const mi = Math.floor(rnd() * mats.length);
      if (!byMat.has(mi)) byMat.set(mi, []);
      byMat.get(mi).push([x, Hc / 2 + level * Hc, z, rotY]);
    };
    for (let row = 0; row < 6; row++) {
      const z = 404 + row * 13;
      for (let x = -168; x < 40; x += L + 0.4) {
        if (x < -100 && x + L > -120) continue; // aisle for the port road
        if (rnd() < 0.18) continue;
        // stack of 1-4 across a pair of rows
        for (const dz of [0, W + 0.25]) {
          const n = 1 + Math.floor(rnd() * (row % 2 ? 4 : 3));
          for (let k = 0; k < n; k++) place(x + L / 2, z + dz, k, 0);
          this.world.addBox(x, 0, z + dz - W / 2, x + L, n * Hc, z + dz + W / 2, { kind: 'container', mat: MATERIALS.metal });
        }
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [mi, list] of byMat) {
      const im = new THREE.InstancedMesh(geo, mats[mi], list.length);
      list.forEach((c, i) => {
        q.setFromAxisAngle(up, c[3]);
        p.set(c[0], c[1], c[2]);
        im.setMatrixAt(i, m4.compose(p, q, s1));
      });
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
    this.containerMats = mats;
  }

  buildCranes() {
    const red = new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.55, metalness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.5, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6 });
    this.cranes = [];
    for (const [cx, mat] of [[-245, red], [-150, white], [-55, red], [45, white]]) {
      const g = new THREE.Group();
      const z0 = 488, z1 = 514, H = 34;
      for (const x of [cx - 8, cx + 8])
        for (const z of [z0, z1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, H, 1.4), mat);
          leg.position.set(x, H / 2, z);
          leg.castShadow = true;
          g.add(leg);
          this.world.addBox(x - 0.7, 0, z - 0.7, x + 0.7, H, z + 0.7, { kind: 'pole', mat: MATERIALS.metal });
        }
      for (const x of [cx - 8, cx + 8]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, z1 - z0 + 1.4), mat);
        beam.position.set(x, H - 1, (z0 + z1) / 2);
        g.add(beam);
        // diagonal brace
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.5, Math.hypot(z1 - z0, H * 0.45), 0.5), mat);
        br.position.set(x, H * 0.55, (z0 + z1) / 2);
        br.rotation.x = Math.atan2(z1 - z0, H * 0.45);
        g.add(br);
      }
      // boom out over the water and back over the yard
      const boom = new THREE.Mesh(new THREE.BoxGeometry(18, 2.2, 95), mat);
      boom.position.set(cx, H + 1.2, 505);
      boom.castShadow = true;
      g.add(boom);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 3), dark);
      cab.position.set(cx, H - 1.5, 520);
      g.add(cab);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2), mat);
      tower.position.set(cx, H + 7, 498);
      g.add(tower);
      // hanging spreader with a container that slowly travels
      const trolley = new THREE.Group();
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 14, 0.06), dark);
      cable.position.y = -7;
      const spreader = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.5, 2.6), dark);
      spreader.position.y = -14;
      const box = new THREE.Mesh(new THREE.BoxGeometry(12.2, 2.6, 2.44), this.containerMats[(this.cranes.length * 3) % this.containerMats.length]);
      box.position.y = -15.6;
      trolley.add(cable, spreader, box);
      trolley.position.set(cx, H, 505);
      trolley.rotation.y = Math.PI / 2;
      g.add(trolley);
      // aircraft warning light
      const warn = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
      warn.position.set(cx, H + 12.3, 498);
      g.add(warn);
      this.group.add(g);
      this.cranes.push({ trolley, warn, phase: this.cranes.length * 1.7 });
    }
  }

  buildQuay() {
    const H = HARBOR;
    const conc = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.95 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(H.x1 - H.x0, 9.2, 1.2), conc);
    wall.position.set((H.x0 + H.x1) / 2, -4.55, H.z1 - 0.6);
    this.group.add(wall);
    // basin side walls
    for (const x of [H.x0, H.x1]) {
      const z1 = shoreZ(x + (x === H.x0 ? -4 : 4)) + 40;
      const side = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9.2, z1 - H.z1), conc);
      side.position.set(x, -4.55, (H.z1 + z1) / 2);
      this.group.add(side);
    }
    // bollards and tyre fenders
    const bm = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 });
    const bg = new THREE.CylinderGeometry(0.28, 0.34, 0.7, 10);
    const tyre = new THREE.TorusGeometry(0.55, 0.22, 6, 12);
    const tm = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    for (let x = H.x0 + 8; x < H.x1 - 4; x += 15) {
      const b = new THREE.Mesh(bg, bm);
      b.position.set(x, 0.35, H.z1 - 0.9);
      b.castShadow = true;
      this.group.add(b);
      this.world.addCylinder(x, H.z1 - 0.9, 0.32, 0, 0.7, { kind: 'pole' });
      const f = new THREE.Mesh(tyre, tm);
      f.position.set(x + 7, -0.9, H.z1 + 0.15);
      this.group.add(f);
    }
  }

  buildShip() {
    // a container freighter moored along the quay
    const x0 = -300, x1 = -80, z0 = 528, z1 = 556;
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1d2d4a, roughness: 0.6, metalness: 0.3 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.7 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.6 });
    const g = new THREE.Group();
    const L = x1 - x0, W = z1 - z0;
    // hull: tapered bow using a custom shape extrusion
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(L - 20, 0);
    shape.quadraticCurveTo(L, W * 0.1, L + 4, W / 2);
    shape.quadraticCurveTo(L, W * 0.9, L - 20, W);
    shape.lineTo(0, W);
    shape.lineTo(0, 0);
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 9, bevelEnabled: false }), hullMat);
    hull.rotation.x = Math.PI / 2;
    hull.position.set(x0, 6, z0);
    hull.castShadow = true;
    g.add(hull);
    const anti = new THREE.Mesh(new THREE.BoxGeometry(L, 2.5, W - 0.2), redMat);
    anti.position.set(x0 + L / 2 - 2, -2.2, z0 + W / 2);
    g.add(anti);
    // bridge superstructure at the stern
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 16, W - 4), whiteMat);
    bridge.position.set(x0 + 9, 14, z0 + W / 2);
    bridge.castShadow = true;
    g.add(bridge);
    const funnel = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 5), redMat);
    funnel.position.set(x0 + 5, 25, z0 + W / 2);
    g.add(funnel);
    // windows strip
    const win = new THREE.Mesh(new THREE.BoxGeometry(14.2, 1.4, W - 3.6), new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0xffd9a0, emissiveIntensity: 0 }));
    win.position.set(x0 + 9, 20, z0 + W / 2);
    g.add(win);
    this.nightMats.push({ mat: win.material, min: 0, max: 0.9 });
    // deck containers
    const geo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
    const rnd = this.rng;
    for (let x = x0 + 22; x < x1 - 22; x += 12.6)
      for (let z = z0 + 2.5; z < z1 - 2.5; z += 2.6) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const c = new THREE.Mesh(geo, this.containerMats[Math.floor(rnd() * this.containerMats.length)]);
          c.position.set(x + 6, 6 + 1.3 + k * 2.6, z + 1.2);
          g.add(c);
        }
      }
    // name on the bow
    const nameTex = signTexture('SAN DEMO STAR', '#1d2d4a');
    const name = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: nameTex, transparent: true }));
    name.position.set(x1 - 30, 3, z0 - 0.05);
    name.rotation.y = Math.PI;
    g.add(name);
    this.group.add(g);
    this.ship = g;
    this.world.addBox(x0, -9, z0, x1 + 2, 6, z1, { kind: 'wall', mat: MATERIALS.metal });
  }

  buildTanks() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.45, metalness: 0.5 });
    for (const [x, z] of [[78, 420], [104, 445], [76, 466]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 12, 24), mat);
      t.position.set(x, 6, z);
      t.castShadow = t.receiveShadow = true;
      this.group.add(t);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 6, 0, Math.PI * 2, 0, 0.35), mat);
      cap.position.set(x, 12 - 7.6, z);
      cap.scale.y = 1;
      this.group.add(cap);
      this.world.addCylinder(x, z, 9, 0, 12, { kind: 'wall', mat: MATERIALS.metal });
    }
  }

  buildRoundabout() {
    // a roundabout where Mission Ave enters the port
    const cx = -110, cz = 364, R = 9;
    const grass = new THREE.MeshStandardMaterial({ color: 0x4a6b2e, roughness: 1 });
    const curb = new THREE.MeshStandardMaterial({ color: 0xbab6ae, roughness: 0.9 });
    const island = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.3, 0.35, 40), curb);
    island.position.set(cx, 0.17, cz);
    island.receiveShadow = true;
    this.group.add(island);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.5, R - 0.5, 0.36, 40), grass);
    top.position.set(cx, 0.19, cz);
    this.group.add(top);
    this.world.addCylinder(cx, cz, R, -0.5, 0.35, { kind: 'curb', mat: MATERIALS.concrete });
    // anchor sculpture
    const iron = new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.5, metalness: 0.8 });
    const shank = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), iron);
    shank.position.set(cx, 3.3, cz);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.18, 8, 16), iron);
    ring.position.set(cx, 6.6, cz);
    const arm = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.3, 8, 20, Math.PI), iron);
    arm.rotation.z = Math.PI;
    arm.position.set(cx, 1.6, cz);
    this.group.add(shank, ring, arm);
    this.world.addCylinder(cx, cz, 2.6, 0, 7, { kind: 'pole' });
    // painted circulation ring
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mb = new MeshBuilder(1);
    for (let k = 0; k < 40; k += 2) {
      const a0 = (k / 40) * Math.PI * 2, a1 = ((k + 1) / 40) * Math.PI * 2;
      const r0 = 19.6, r1 = 19.9;
      mb.quad([cx + Math.cos(a0) * r0, 0.013, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, 0.013, cz + Math.sin(a1) * r0], [cx + Math.cos(a1) * r1, 0.013, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, 0.013, cz + Math.sin(a0) * r1], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    this.group.add(new THREE.Mesh(mb.build(), white));
    this.roundabout = { x: cx, z: cz, r: R, lane: 15 };
  }

  // ------------------------------------------------------------ beach
  buildPier() {
    const T = this.terrain;
    const px = 520;
    const zs = T.findShore(px);
    const z0 = zs - 26, z1 = zs + 150, W = 8, top = 1.1;
    const wood = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 });
    this.wetMats.push({ mat: wood, dry: 0.85, wet: 0.35, dryColor: new THREE.Color(0xffffff), wetColor: new THREE.Color(0x9a958e) });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, z1 - z0), wood);
    deck.material.map.repeat.set(1, (z1 - z0) / 4);
    deck.position.set(px, top - 0.15, (z0 + z1) / 2);
    deck.castShadow = deck.receiveShadow = true;
    this.group.add(deck);
    this.world.addBox(px - W / 2, top - 0.3, z0, px + W / 2, top, z1, { kind: 'deck', mat: MATERIALS.wood });
    // ramp up from the sand
    const sy = T.rawHeight(px, z0 - 12);
    this.city.ramp(px, z0 - 6, 0, W, 12, sy, top, 'concrete');
    // piles
    const pm = new THREE.MeshStandardMaterial({ color: 0x4d3b2a, roughness: 0.9 });
    const pg = new THREE.CylinderGeometry(0.25, 0.25, 12, 8);
    for (let z = z0 + 4; z < z1; z += 8)
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(pg, pm);
        p.position.set(px + s * (W / 2 - 0.4), top - 6.3, z);
        this.group.add(p);
      }
    // railings
    const rail = new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, z1 - z0), rail);
      r.position.set(px + s * (W / 2 - 0.1), top + 1.0, (z0 + z1) / 2);
      this.group.add(r);
      for (let z = z0 + 1; z < z1; z += 2.5) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), rail);
        post.position.set(px + s * (W / 2 - 0.1), top + 0.5, z);
        this.group.add(post);
        this.world.addCylinder(px + s * (W / 2 - 0.1), z, 0.12, top - 0.2, top + 1.05, { kind: 'rail', mat: MATERIALS.wood });
      }
    }
    // end of the pier: a bait shop and lamps (open end for the brave)
    const shop = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 4), new THREE.MeshStandardMaterial({ color: 0x3f7fa8, roughness: 0.7 }));
    shop.position.set(px - 1.2, top + 1.6, z1 - 12);
    this.group.add(shop);
    this.world.addBox(px - 3.7, top, z1 - 14, px + 1.3, top + 3.2, z1 - 10, { kind: 'building', mat: MATERIALS.wood });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.2), new THREE.MeshStandardMaterial({ map: signTexture('BAIT & TACKLE', '#a83a2a'), emissive: 0xffffff, emissiveMap: signTexture('BAIT & TACKLE', '#a83a2a'), emissiveIntensity: 0.2 }));
    sign.position.set(px - 1.2, top + 3.8, z1 - 9.9);
    this.group.add(sign);
    this.nightMats.push({ mat: sign.material, min: 0.2, max: 1.1 });
    this.pier = { x: px, z0, z1, top, w: W };
    this.locations.pier = { pos: new THREE.Vector3(px, top, z0 + 6), yaw: 0, name: 'Pier' };
  }

  buildBeach() {
    const T = this.terrain;
    const rnd = this.rng;
    const cloth = ['#d23b3b', '#f2c14e', '#2f7fbf', '#3fa66b', '#ffffff', '#e86fae'];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5 });
    for (let k = 0; k < 34; k++) {
      const x = 240 + rnd() * 620;
      if (Math.abs(x - 520) < 14) continue;
      const zs = T.findShore(x);
      const z = zs - 12 - rnd() * 22;
      const y = T.rawHeight(x, z);
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: cloth[k % cloth.length], roughness: 0.8, side: THREE.DoubleSide }));
      um.position.set(x, y + 2.3, z);
      um.rotation.z = (rnd() - 0.5) * 0.3;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5), poleMat);
      pole.position.set(x, y + 1.2, z);
      this.group.add(um, pole);
      this.world.addCylinder(x, z, 0.08, y - 0.5, y + 2.4, { kind: 'pole' });
      // towel
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: cloth[(k + 2) % cloth.length], roughness: 0.9 }));
      towel.position.set(x + 1.3, y + 0.03, z + 0.4);
      towel.rotation.y = rnd() * 3;
      this.group.add(towel);
    }
    // lifeguard towers
    const wood = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8352a, roughness: 0.7 });
    for (const x of [330, 700]) {
      const zs = T.findShore(x);
      const z = zs - 30, y = T.rawHeight(x, z);
      const g = new THREE.Group();
      for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), wood);
        leg.position.set(dx, 1.2, dz);
        g.add(leg);
      }
      const hut = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), wood);
      hut.position.y = 3.4;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1, 4), red);
      roof.position.y = 4.9;
      roof.rotation.y = Math.PI / 4;
      g.add(hut, roof);
      g.position.set(x, y, z);
      this.group.add(g);
      this.world.addBox(x - 1.4, y, z - 1.4, x + 1.4, y + 4.4, z + 1.4, { kind: 'building', mat: MATERIALS.wood });
    }
    this.locations.beach = { pos: new THREE.Vector3(420, 0, 452), yaw: Math.PI / 2, name: 'Beach' };
  }

  buildLighthouse() {
    const T = this.terrain;
    const x = -720;
    const z = T.findShore(x) - 18;
    const y = T.rawHeight(x, z);
    const g = new THREE.Group();
    const stripes = lighthouseTexture();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 24, 20), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }));
    tower.position.y = 12;
    tower.castShadow = true;
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x2a2c30 }));
    gallery.position.y = 24.2;
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 0.2, transparent: true, opacity: 0.75 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 12), lampMat);
    lantern.position.y = 25.7;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.8, 12), new THREE.MeshStandardMaterial({ color: 0xa8281e, roughness: 0.5 }));
    cap.position.y = 27.9;
    const house = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 0.8 }));
    house.position.set(5.5, 2, 0);
    g.add(tower, gallery, lantern, cap, house);
    // rotating beams
    const bt = beamTexture();
    const beamMat = new THREE.MeshBasicMaterial({ map: bt, color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rot = new THREE.Group();
    rot.position.y = 25.7;
    for (const s of [0, Math.PI]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(14, 160, 16, 1, true), beamMat);
      cone.geometry.translate(0, -80, 0);
      cone.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(cone);
      holder.rotation.y = s;
      rot.add(holder);
    }
    g.add(rot);
    g.position.set(x, y, z);
    this.group.add(g);
    this.world.addCylinder(x, z, 3.4, y - 1, y + 28, { kind: 'wall', mat: MATERIALS.concrete });
    this.world.addBox(x + 2, y - 1, z - 3, x + 9, y + 4, z + 3, { kind: 'building' });
    this.lighthouse = { rot, beamMat, lampMat, pos: new THREE.Vector3(x, y + 25.7, z) };
    this.locations.lighthouse = { pos: new THREE.Vector3(x + 14, y, z - 14), yaw: 0, name: 'Lighthouse' };
  }

  spawnCrates() {
    // loose crates, pallets and drums by the warehouses: real physics debris
    const debris = this.game.debris;
    if (!debris) return;
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
    const drumMat = new THREE.MeshStandardMaterial({ color: 0x2f5fa0, roughness: 0.5, metalness: 0.4 });
    const rnd = this.rng;
    const spots = [[-250, 352], [-250, 372], [-250, 420], [-250, 445], [-176, 352], [-176, 372]];
    for (const [sx, sz] of spots) {
      for (let k = 0; k < 4; k++) {
        const drum = k === 3;
        const m = drum ? new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), drumMat) : new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), crateMat);
        m.castShadow = true;
        const x = sx + 2 + rnd() * 4, z = sz + rnd() * 8;
        m.position.set(x, drum ? 0.45 : 0.55, z);
        m.rotation.y = rnd() * 0.3;
        this.scene.add(m);
        const it = debris.spawnFromObject(m, new THREE.Vector3(), drum ? 60 : 45, { kind: drum ? 'barrel' : 'crate', mat: drum ? 'metal' : 'wood', persistent: true, maxLife: Infinity, friction: 0.7 });
        it.body.angularVelocity.set(0, 0, 0);
        it.body.sleeping = true;
      }
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, night) {
    this.time += dt;
    const t = this.time;
    for (const c of this.cranes) {
      // trolley travels between ship and yard, hoisting as it goes
      const ph = (Math.sin(t * 0.05 + c.phase) + 1) / 2;
      c.trolley.position.z = 470 + ph * 75;
      c.warn.material.color.setRGB(Math.floor(t + c.phase) % 2 ? 1 : 0.15, 0.05, 0.03);
    }
    if (this.lighthouse) {
      const L = this.lighthouse;
      L.rot.rotation.y = t * 0.9;
      const fog = this.game.env?.fogAmount || 0;
      L.beamMat.opacity = clamp(night * 0.22 + fog * 0.1, 0, 0.3);
      L.lampMat.emissiveIntensity = 0.2 + night * 6;
    }
    if (this.ship) this.ship.position.y = Math.sin(t * 0.3) * 0.12;
  }

  setNight(f) {
    for (const n of this.nightMats) n.mat.emissiveIntensity = n.min + f * (n.max - n.min);
  }

  setWetness(w) {
    for (const e of this.wetMats) {
      e.mat.roughness = e.dry + (e.wet - e.dry) * w;
      e.mat.color.copy(e.dryColor).lerp(e.wetColor, w);
    }
  }
}

// ------------------------------------------------------------ textures
function corrugatedTexture(base) {
  const c = makeCanvas(128, 128);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 8) {
    const g = x.createLinearGradient(i, 0, i + 8, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    x.fillStyle = g;
    x.fillRect(i, 0, 8, 128);
  }
  x.fillStyle = 'rgba(80,50,30,0.15)';
  for (let i = 0; i < 30; i++) x.fillRect(Math.random() * 128, 100 + Math.random() * 28, 2, 10);
  return canvasTexture(c, { repeat: [1, 1] });
}

function rollerDoorTexture() {
  const c = makeCanvas(64, 64);
  const x = c.getContext('2d');
  x.fillStyle = '#9da3a8';
  x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 4) {
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(0, i, 64, 1);
  }
  x.fillStyle = '#c9a227';
  x.fillRect(0, 60, 64, 4);
  return canvasTexture(c);
}

function containerTexture(color, brand) {
  const c = makeCanvas(256, 64);
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 256; i += 6) {
    x.fillStyle = 'rgba(0,0,0,0.22)';
    x.fillRect(i, 0, 2, 64);
    x.fillStyle = 'rgba(255,255,255,0.08)';
    x.fillRect(i + 3, 0, 1, 64);
  }
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.font = 'bold 22px sans-serif';
  x.textAlign = 'center';
  x.fillText(brand, 128, 40);
  x.strokeStyle = 'rgba(0,0,0,0.4)';
  x.lineWidth = 3;
  x.strokeRect(1, 1, 254, 62);
  return canvasTexture(c);
}

function plankTexture() {
  const c = makeCanvas(128, 128);
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const v = 120 + Math.random() * 40;
    x.fillStyle = `rgb(${v},${v * 0.78},${v * 0.55})`;
    x.fillRect(i * 16, 0, 15, 128);
    x.fillStyle = 'rgba(0,0,0,0.5)';
    x.fillRect(i * 16 + 15, 0, 1, 128);
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

function crateTexture() {
  const c = makeCanvas(64, 64);
  const x = c.getContext('2d');
  x.fillStyle = '#a07b4a';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#6e5230';
  x.lineWidth = 6;
  x.strokeRect(3, 3, 58, 58);
  x.beginPath();
  x.moveTo(6, 6);
  x.lineTo(58, 58);
  x.stroke();
  return canvasTexture(c);
}

function lighthouseTexture() {
  const c = makeCanvas(32, 128);
  const x = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    x.fillStyle = i % 2 ? '#c8352a' : '#f2efe8';
    x.fillRect(0, i * 32, 32, 32);
  }
  return canvasTexture(c);
}

export { SEA_LEVEL };
