import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSun, uMoon, uZenith, uHorizon, uGround, uSunColor;
uniform float uNight, uCloud, uTime, uFlash;
float hash(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  if (h < 0.0) col = mix(uHorizon, uGround, clamp(-h * 5.0, 0.0, 1.0));
  float sd = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(sd, 1400.0) * 40.0 + pow(sd, 90.0) * 1.2 + pow(sd, 8.0) * 0.25) * (1.0 - uCloud * 0.85);
  // stars
  if (h > 0.0 && uNight > 0.01) {
    vec3 sp = floor(d * 420.0);
    float s = step(0.9975, hash(sp)) * (0.5 + 0.5 * sin(uTime * 3.0 + hash(sp + 1.0) * 30.0));
    col += vec3(s) * uNight * 1.8 * (1.0 - uCloud);
  }
  // moon
  float md = dot(d, uMoon);
  col += vec3(1.6, 1.7, 1.9) * smoothstep(0.99955, 0.9997, md) * uNight;
  col += vec3(0.08, 0.1, 0.16) * pow(max(md, 0.0), 30.0) * uNight;
  // clouds
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0025);
    float c = fbm(uv);
    float cover = mix(0.62, 0.22, uCloud);
    float dens = smoothstep(cover, cover + 0.25, c) * smoothstep(0.0, 0.12, h);
    vec3 lit = mix(vec3(0.95, 0.96, 1.0), uSunColor * 0.9 + 0.3, pow(sd, 3.0) * 0.6);
    vec3 cloudCol = mix(uHorizon * 1.1, lit * (0.4 + 0.6 * (1.0 - uNight)), 0.6) * (1.0 - uCloud * 0.45);
    col = mix(col, cloudCol, dens * 0.9);
  }
  col += vec3(0.7, 0.75, 0.9) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

const RAIN_VERT = /* glsl */ `
attribute float aEnd;
uniform vec3 uCam;
uniform float uTime, uSpeed;
uniform vec3 uBox;
uniform vec2 uWind;
varying float vA;
void main() {
  vec3 p = position;
  float fall = uTime * uSpeed;
  p.y = mod(p.y - fall - uCam.y, uBox.y);
  p.xz = mod(p.xz + uWind * uTime - uCam.xz, uBox.xz);
  vec3 w = vec3(uCam.x + p.x - uBox.x * 0.5, uCam.y + p.y - uBox.y * 0.5, uCam.z + p.z - uBox.z * 0.5);
  w -= vec3(uWind.x, -uSpeed, uWind.y) * 0.035 * aEnd;
  vA = 1.0 - aEnd * 0.8;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
void main() { gl_FragColor = vec4(uColor, uAlpha * vA); }`;

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog'];

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.hour = 16.5;
    this.timeScale = 1 / 60; // game hours per real second (24 min day)
    this.frozen = false;
    this.weather = 'clear';
    this.cloud = 0.15;
    this.rain = 0;
    this.fogAmount = 0;
    this.wetness = 0;
    this.night = 0;
    this.flash = 0;
    this.nextLightning = 8;
    this.time = 0;
    this.onThunder = null;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.shadowSize = 70;

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uMoon: { value: new THREE.Vector3(0, -1, 0) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color(0.05, 0.05, 0.05) },
        uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
        uNight: { value: 0 },
        uCloud: { value: 0 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -this.shadowSize;
    sc.right = sc.top = this.shadowSize;
    sc.near = 1;
    sc.far = 500;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3530, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0012);

    // env map (reflections) rendered from a sky-only scene
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat);
    this.envScene.add(this.envSky);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x303030 });
    const g = new THREE.Mesh(new THREE.CircleGeometry(90, 24), groundMat);
    g.rotation.x = -Math.PI / 2;
    g.position.y = -2;
    this.envScene.add(g);
    this.envGround = groundMat;
    // city silhouettes in the reflection
    const bm = new THREE.MeshBasicMaterial({ color: 0x20242a });
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const h = 4 + Math.random() * 18;
      const b = new THREE.Mesh(new THREE.BoxGeometry(8 + Math.random() * 10, h, 6), bm);
      b.position.set(Math.cos(a) * 70, h / 2 - 2, Math.sin(a) * 70);
      b.lookAt(0, h / 2 - 2, 0);
      this.envScene.add(b);
    }
    this.envBuildings = bm;
    this.envTarget = null;
    this.envHour = -99;
    this.envWeather = null;
    this.envTimer = 0;

    // rain
    const N = 7000;
    const pos = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    const box = new THREE.Vector3(70, 36, 70);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * box.x, y = Math.random() * box.y, z = Math.random() * box.z;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uSpeed: { value: 16 },
        uBox: { value: box },
        uWind: { value: new THREE.Vector2(1.5, 0.8) },
        uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
        uAlpha: { value: 0.35 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.rainMesh = new THREE.LineSegments(rg, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainMesh.renderOrder = 6;
    scene.add(this.rainMesh);
  }

  setWeather(w) {
    this.weather = w;
  }
  setTime(h) {
    this.hour = ((h % 24) + 24) % 24;
  }

  update(dt, focus, camPos) {
    this.time += dt;
    if (!this.frozen) this.hour = (this.hour + dt * this.timeScale) % 24;
    // weather targets
    const W = {
      clear: { cloud: 0.12, rain: 0, fog: 0 },
      cloudy: { cloud: 0.7, rain: 0, fog: 0.15 },
      rain: { cloud: 0.9, rain: 0.8, fog: 0.35 },
      storm: { cloud: 1, rain: 1, fog: 0.45 },
      fog: { cloud: 0.6, rain: 0, fog: 1 },
    }[this.weather];
    const k = Math.min(1, dt * 0.25);
    this.cloud = lerp(this.cloud, W.cloud, k);
    this.rain = lerp(this.rain, W.rain, k);
    this.fogAmount = lerp(this.fogAmount, W.fog, k);
    if (this.rain > 0.2) this.wetness = Math.min(1, this.wetness + dt / 40);
    else this.wetness = Math.max(0, this.wetness - dt / 150);

    // sun & moon
    const a = ((this.hour - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.9, -0.42 * Math.max(0.3, Math.sin(a))).normalize();
    this.moonDir.set(-Math.cos(a) * 0.8, -Math.sin(a) * 0.8 + 0.25, 0.4).normalize();
    const elev = this.sunDir.y;
    const day = smoothstep(-0.12, 0.22, elev);
    this.night = 1 - smoothstep(-0.18, 0.06, elev);
    const sunset = smoothstep(0.45, 0.02, Math.abs(elev)) * (1 - this.night * 0.7);
    const cloud = this.cloud;
    // palette (linear HDR)
    const zDay = new THREE.Color(0.24, 0.5, 1.15), hDay = new THREE.Color(0.85, 1.0, 1.2);
    const zSet = new THREE.Color(0.25, 0.3, 0.62), hSet = new THREE.Color(1.5, 0.72, 0.38);
    const zNight = new THREE.Color(0.004, 0.008, 0.025), hNight = new THREE.Color(0.035, 0.045, 0.075);
    const zenith = zNight.clone().lerp(zDay, day).lerp(zSet, sunset * 0.6);
    const horizon = hNight.clone().lerp(hDay, day).lerp(hSet, sunset);
    // city glow on the horizon at night
    horizon.add(new THREE.Color(0.06, 0.04, 0.025).multiplyScalar(this.night));
    // overcast greys
    const grey = new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(0.12 + day * 0.9);
    zenith.lerp(grey, cloud * 0.8);
    horizon.lerp(grey.clone().multiplyScalar(1.1), cloud * 0.75);
    const u = this.skyMat.uniforms;
    u.uSun.value.copy(this.sunDir);
    u.uMoon.value.copy(this.moonDir);
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uGround.value.copy(horizon).multiplyScalar(0.3);
    const sunCol = new THREE.Color(1.0, 0.95, 0.88).lerp(new THREE.Color(1.0, 0.5, 0.22), sunset);
    u.uSunColor.value.copy(sunCol);
    u.uNight.value = this.night;
    u.uCloud.value = cloud;
    u.uTime.value = this.time;

    // lightning
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.weather === 'storm') {
      this.nextLightning -= dt;
      if (this.nextLightning < 0) {
        this.flash = 1;
        this.nextLightning = 5 + Math.random() * 14;
        const dist = 0.3 + Math.random() * 3;
        setTimeout(() => this.onThunder?.(dist), dist * 1000);
      }
    }
    const fl = this.flash > 0.5 ? this.flash : this.flash * 0.3;
    u.uFlash.value = fl;

    // lights
    const sunUp = elev > -0.03;
    const dir = sunUp ? this.sunDir : this.moonDir;
    const sunI = smoothstep(-0.03, 0.18, elev) * 3.4 * (1 - cloud * 0.75);
    const moonI = (1 - smoothstep(-0.12, 0.0, elev)) * 0.32 * (1 - cloud * 0.6);
    this.sun.intensity = (sunUp ? sunI : moonI) + fl * 2;
    this.sun.color.copy(sunUp ? sunCol : new THREE.Color(0.6, 0.7, 1.0));
    const f = focus || new THREE.Vector3();
    // snap the shadow frustum to texels to stop shimmering
    const texel = (this.shadowSize * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.position.set(fx + dir.x * 200, dir.y * 200 + f.y, fz + dir.z * 200);
    this.sun.target.position.set(fx, f.y, fz);
    this.hemi.intensity = 0.12 + day * (0.75 - cloud * 0.15) + this.night * 0.1 + fl * 2;
    this.hemi.color.copy(zenith).lerp(new THREE.Color(0.8, 0.85, 1), 0.5);
    this.hemi.groundColor.setRGB(0.18, 0.16, 0.14).multiplyScalar(0.3 + day * 0.7);

    // fog
    const fogCol = horizon.clone().multiplyScalar(0.9);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.0011 + this.fogAmount * 0.009 + this.rain * 0.0015;

    // rain
    this.rainMesh.visible = this.rain > 0.03;
    if (this.rainMesh.visible) {
      const r = this.rainMat.uniforms;
      r.uTime.value = this.time;
      if (camPos) r.uCam.value.copy(camPos);
      r.uAlpha.value = 0.12 + this.rain * 0.3;
      r.uColor.value.setRGB(0.55 + day * 0.35, 0.6 + day * 0.35, 0.68 + day * 0.35);
      this.rainMesh.geometry.setDrawRange(0, Math.floor(this.rainMesh.geometry.attributes.position.count * this.rain));
    }

    // reflections: refresh when the sky changed enough
    this.envTimer -= dt;
    if (this.envTimer <= 0 && (Math.abs(this.hour - this.envHour) > 0.2 || this.envWeather !== this.weather || Math.abs(this.cloud - (this.envCloud ?? -1)) > 0.08)) {
      this.envTimer = 1.5;
      this.refreshEnv();
    }
  }

  refreshEnv() {
    this.envHour = this.hour;
    this.envWeather = this.weather;
    this.envCloud = this.cloud;
    const day = 1 - this.night;
    this.envGround.color.setRGB(0.05 + day * 0.18, 0.05 + day * 0.18, 0.055 + day * 0.19);
    this.envBuildings.color.setRGB(0.03 + day * 0.1, 0.035 + day * 0.11, 0.04 + day * 0.12);
    if (this.night > 0.5) this.envBuildings.color.setRGB(0.12, 0.09, 0.05);
    const rt = this.pmrem.fromScene(this.envScene, 0.02);
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = rt;
    this.scene.environment = rt.texture;
  }

  /** Current sky tint (for tinting things like the minimap). */
  get dayFactor() {
    return 1 - this.night;
  }
}
