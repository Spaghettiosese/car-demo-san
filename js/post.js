import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = smoothstep(uThreshold, uThreshold * 2.5, l);
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270;
  s += texture2D(tDiffuse, vUv + uDir * 1.3846154).rgb * 0.3162162;
  s += texture2D(tDiffuse, vUv - uDir * 1.3846154).rgb * 0.3162162;
  s += texture2D(tDiffuse, vUv + uDir * 3.2307692).rgb * 0.0702703;
  s += texture2D(tDiffuse, vUv - uDir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene, tBloom1, tBloom2;
uniform float uBloom, uExposure, uVignette, uGrain, uTime, uAberr, uSat, uContrast;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// ACES filmic (Narkowicz fit, same family as three.js)
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  vec3 col;
  if (uAberr > 0.0005) {
    col.r = texture2D(tScene, uv + d * uAberr).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - d * uAberr).b;
  } else col = texture2D(tScene, uv).rgb;
  col += (texture2D(tBloom1, uv).rgb * 0.55 + texture2D(tBloom2, uv).rgb * 0.75) * uBloom;
  col *= uExposure;
  col = aces(col * 0.8);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  col *= 1.0 - uVignette * dot(d, d) * 1.8;
  col = toSRGB(clamp(col, 0.0, 1.0));
  col += (hash(uv * 1000.0 + uTime) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

/** HDR scene -> bloom (two levels) -> filmic tone map, grade, vignette, grain. */
export class PostFX {
  constructor(renderer, scene, camera, settings) {
    this.renderer = renderer;
    this.settings = settings;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtC = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtD = new THREE.WebGLRenderTarget(4, 4, opts);
    for (const rt of [this.rtA, this.rtB, this.rtC, this.rtD]) rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    this.bright = pass(BRIGHT, { tDiffuse: { value: null }, uThreshold: { value: 1.2 } });
    this.blur = pass(BLUR, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.comp = pass(COMPOSITE, {
      tScene: { value: this.rtScene.texture },
      tBloom1: { value: this.rtA.texture },
      tBloom2: { value: this.rtC.texture },
      uBloom: { value: 0.55 },
      uExposure: { value: 1.0 },
      uVignette: { value: 0.35 },
      uGrain: { value: 0.025 },
      uTime: { value: 0 },
      uAberr: { value: 0 },
      uSat: { value: 1.08 },
      uContrast: { value: 1.04 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.time = 0;
  }

  setSize(w, h, pr) {
    const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
    this.rtScene.setSize(W, H);
    this.rtA.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.rtB.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.rtC.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.rtD.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.w = W;
    this.h = H;
  }

  draw(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(dt, game, scene = game.scene, camera = game.camera) {
    const r = this.renderer;
    this.time += dt;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    // bloom
    this.bright.uniforms.tDiffuse.value = this.rtScene.texture;
    this.draw(this.bright, this.rtA);
    const blur = (src, dst, w, h, dx, dy) => {
      this.blur.uniforms.tDiffuse.value = src.texture;
      this.blur.uniforms.uDir.value.set(dx / w, dy / h);
      this.draw(this.blur, dst);
    };
    const hw = this.w >> 1, hh = this.h >> 1;
    blur(this.rtA, this.rtB, hw, hh, 1, 0);
    blur(this.rtB, this.rtA, hw, hh, 0, 1);
    const qw = this.w >> 2, qh = this.h >> 2;
    blur(this.rtA, this.rtC, qw, qh, 1.5, 0);
    blur(this.rtC, this.rtD, qw, qh, 0, 1.5);
    blur(this.rtD, this.rtC, qw, qh, 2.5, 0);
    blur(this.rtC, this.rtD, qw, qh, 0, 2.5);
    this.comp.uniforms.tBloom2.value = this.rtD.texture;
    // grade
    const u = this.comp.uniforms;
    u.uTime.value = this.time;
    const shake = game.cam ? game.cam.shake : 0;
    const hurt = parseFloat(document.getElementById('hurt').style.opacity || '0');
    u.uAberr.value = Math.min(0.02, shake * 0.006 + hurt * 0.012);
    const night = game.env ? game.env.night : 0;
    u.uExposure.value = 1.0 + night * 0.35;
    u.uBloom.value = 0.45 + night * 0.35;
    this.draw(this.comp, null);
  }
}
