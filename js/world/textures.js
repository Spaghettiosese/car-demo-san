import * as THREE from 'three';
import { makeCanvas, canvasTexture } from '../core/canvas.js';
import { mulberry32, valueNoise } from '../core/util.js';

const cache = new Map();
function tex(key, w, h, draw, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = canvasTexture(c, { anisotropy: 8, ...opts });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

function grain(ctx, w, h, amount, seed = 1, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rnd = mulberry32(seed);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (rnd() - 0.5) * amount + (valueNoise((x / w) * 8 * scale, (y / h) * 8 * scale) - 0.5) * amount * 1.2;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  ctx.putImageData(img, 0, 0);
}

export function asphaltTexture() {
  return tex('asphalt', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3b3d40';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 34, 3, 2);
    const rnd = mulberry32(7);
    // patches
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '20,20,22' : '70,70,72'},${0.15 + rnd() * 0.15})`;
      ctx.fillRect(rnd() * w, rnd() * h, 30 + rnd() * 120, 20 + rnd() * 80);
    }
    // cracks
    ctx.strokeStyle = 'rgba(15,15,16,0.55)';
    for (let i = 0; i < 10; i++) {
      ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath();
      let x = rnd() * w, y = rnd() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 40;
        y += (rnd() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // oil stains
    for (let i = 0; i < 5; i++) {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 30);
      g.addColorStop(0, 'rgba(10,10,12,0.35)');
      g.addColorStop(1, 'rgba(10,10,12,0)');
      ctx.save();
      ctx.translate(rnd() * w, rnd() * h);
      ctx.scale(1, 0.5 + rnd());
      ctx.fillStyle = g;
      ctx.fillRect(-30, -30, 60, 60);
      ctx.restore();
    }
  });
}

export function sidewalkTexture() {
  return tex('sidewalk', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9d9b96';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 18, 11, 3);
    ctx.strokeStyle = 'rgba(60,58,55,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * h) / 2);
      ctx.lineTo(w, (i * h) / 2);
      ctx.moveTo((i * w) / 2, 0);
      ctx.lineTo((i * w) / 2, h);
      ctx.stroke();
    }
  });
}

export function grassTexture() {
  return tex('grass', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4a6b2e';
    ctx.fillRect(0, 0, w, h);
    const rnd = mulberry32(5);
    for (let i = 0; i < 5000; i++) {
      const g = 80 + rnd() * 70;
      ctx.fillStyle = `rgba(${40 + rnd() * 40},${g},${20 + rnd() * 25},0.5)`;
      ctx.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 3);
    }
    grain(ctx, w, h, 18, 9, 1);
  });
}

export function dirtTexture() {
  return tex('dirt', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a634a';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 40, 21, 2);
    const rnd = mulberry32(3);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${90 + rnd() * 60},${80 + rnd() * 40},${60 + rnd() * 30},0.8)`;
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, rnd() * 2.5, 0, 6.3);
      ctx.fill();
    }
  });
}

export function concreteTexture() {
  return tex('concrete', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8c8a86';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 22, 31, 2);
  });
}

export function roofTexture() {
  return tex('roof', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5d5b58';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 40, 41, 4);
  });
}

/**
 * Building facades: each tile is 4 bays x 4 floors so lit windows don't
 * obviously repeat. Returns { map, emissive } textures.
 */
export const FACADES = ['glass', 'office', 'brick', 'modern', 'apartment'];
export function facadeTextures(style) {
  const key = 'facade:' + style;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 512;
  const c = makeCanvas(W, H);
  const e = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const ex = e.getContext('2d');
  const rnd = mulberry32(style.length * 97 + style.charCodeAt(0));
  const bw = W / 4, fh = H / 4;
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, W, H);
  const litColor = () => {
    const t = rnd();
    return t < 0.6 ? `rgb(255,${200 + rnd() * 40},${120 + rnd() * 60})` : t < 0.85 ? `rgb(${200 + rnd() * 40},${220 + rnd() * 30},255)` : `rgb(255,${150 + rnd() * 50},${80 + rnd() * 40})`;
  };
  const lit = () => rnd() < 0.38;
  if (style === 'glass') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2d4a63');
    g.addColorStop(0.5, '#4d7494');
    g.addColorStop(1, '#27425a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let fy = 0; fy < 4; fy++)
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * bw, y = fy * fh;
        ctx.fillStyle = `rgba(${150 + rnd() * 60},${190 + rnd() * 40},${220 + rnd() * 30},${0.08 + rnd() * 0.15})`;
        ctx.fillRect(x + 3, y + 3, bw - 6, fh - 10);
        if (lit()) {
          ex.fillStyle = litColor();
          ex.globalAlpha = 0.5 + rnd() * 0.5;
          ex.fillRect(x + 3, y + 3, bw - 6, fh - 10);
          ex.globalAlpha = 1;
        }
      }
    ctx.fillStyle = '#1b2530';
    for (let i = 0; i <= 4; i++) {
      ctx.fillRect(i * bw - 2, 0, 4, H);
      ctx.fillRect(0, i * fh - 4, W, 8);
    }
  } else {
    const base = { office: '#a9a59c', brick: '#8b4a36', modern: '#d9d7d2', apartment: '#c9b79c' }[style];
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, style === 'brick' ? 26 : 14, 5 + style.length, 6);
    if (style === 'brick') {
      ctx.strokeStyle = 'rgba(60,30,20,0.35)';
      ctx.lineWidth = 1;
      for (let y = 0; y < H; y += 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        for (let x = (y / 8) % 2 ? 0 : 8; x < W; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 8);
          ctx.stroke();
        }
      }
    }
    for (let fy = 0; fy < 4; fy++)
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * bw, y = fy * fh;
        const ww = style === 'modern' ? bw * 0.8 : bw * 0.52;
        const wh = style === 'modern' ? fh * 0.55 : fh * 0.58;
        const wx = x + (bw - ww) / 2, wy = y + fh * 0.18;
        ctx.fillStyle = style === 'modern' ? '#2a3440' : '#20262c';
        ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
        g.addColorStop(0, '#5f7b92');
        g.addColorStop(1, '#2d3d4c');
        ctx.fillStyle = g;
        ctx.fillRect(wx, wy, ww, wh);
        // curtains / blinds
        if (rnd() < 0.4) {
          ctx.fillStyle = `rgba(${200 + rnd() * 50},${180 + rnd() * 50},${140 + rnd() * 60},0.6)`;
          ctx.fillRect(wx, wy, ww * (0.2 + rnd() * 0.3), wh);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        // sill
        ctx.fillStyle = 'rgba(230,230,225,0.7)';
        ctx.fillRect(wx - 5, wy + wh + 3, ww + 10, 4);
        if (lit()) {
          ex.fillStyle = litColor();
          ex.globalAlpha = 0.55 + rnd() * 0.45;
          ex.fillRect(wx, wy, ww, wh);
          ex.globalAlpha = 1;
        }
      }
    if (style === 'apartment') {
      // balconies
      ctx.fillStyle = 'rgba(40,40,40,0.8)';
      for (let fy = 0; fy < 4; fy++)
        for (let bx = 0; bx < 4; bx += 2) ctx.fillRect(bx * bw + 6, fy * fh + fh * 0.72, bw - 12, 3);
    }
  }
  const map = canvasTexture(c, { anisotropy: 8 });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissive = canvasTexture(e, { anisotropy: 8 });
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  const res = { map, emissive };
  cache.set(key, res);
  return res;
}

export function shopTexture() {
  return tex('shops', 1024, 128, (ctx, w, h) => {
    const rnd = mulberry32(77);
    const names = ['PIZZA', 'CAFE', 'DELI', 'BOOKS', 'TACOS', 'SUSHI', 'BAKERY', 'GYM', 'PHONES', 'DINER', 'FLOWERS', 'BANK'];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = (i * w) / n, sw = w / n;
      const hue = Math.floor(rnd() * 360);
      ctx.fillStyle = `hsl(${hue},45%,35%)`;
      ctx.fillRect(x, 0, sw, h);
      ctx.fillStyle = `hsl(${hue},60%,50%)`;
      ctx.fillRect(x + 4, 6, sw - 8, 26);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(names[Math.floor(rnd() * names.length)], x + sw / 2, 26);
      const g = ctx.createLinearGradient(0, 40, 0, h);
      g.addColorStop(0, '#6d8aa3');
      g.addColorStop(1, '#23303b');
      ctx.fillStyle = g;
      ctx.fillRect(x + 8, 40, sw - 16, h - 44);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(x + sw * 0.62, 50, sw * 0.24, h - 54);
    }
  });
}

export function glowTexture() {
  return tex('glowpool', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { linear: true });
}

export function beamTexture() {
  return tex('beam', 128, 128, (ctx, w, h) => {
    // headlight pool on the road: bright near, fading forward, soft sides
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = (x / w - 0.5) * 2, v = y / h;
        const spread = 0.25 + v * 0.75;
        const side = Math.max(0, 1 - Math.abs(u) / spread);
        const a = side ** 1.5 * Math.min(1, v * 5) * (1 - v) ** 1.2;
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    ctx.putImageData(img, 0, 0);
  }, { linear: true });
}

export function signTexture(text, bg = '#1c6b3a', fg = '#ffffff') {
  const key = 'sign:' + text + bg;
  return tex(key, 256, 64, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = fg;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}
