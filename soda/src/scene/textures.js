// 程序化贴图（Canvas 生成，零下载）：漆木板、木纹、绒布法线。
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// 高度图（灰度 canvas）→ 法线贴图 canvas
function heightToNormal(src, strength) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h), d = out.data;
  const H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function tex(c, { srgb = false, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 漆木板：竖向木板 + 板缝 + 柔和木纹。返回 { map, normalMap, roughnessMap }
export function woodPlanks({ planks = 6, base = '#7a3e22', dark = '#4a2414', light = '#9a5634', seed = 3, size = 512, grain = 1 } = {}) {
  const r = rng(seed);
  const [c, g] = canvas(size, size);
  const [hc, hg] = canvas(size, size);
  hg.fillStyle = '#fff'; hg.fillRect(0, 0, size, size);
  const pw = size / planks;
  for (let i = 0; i < planks; i++) {
    const x0 = i * pw;
    const tint = (r() - 0.5) * 0.18;
    const grd = g.createLinearGradient(x0, 0, x0 + pw, 0);
    grd.addColorStop(0, shade(base, tint - 0.06)); grd.addColorStop(0.5, shade(base, tint + 0.04)); grd.addColorStop(1, shade(base, tint - 0.08));
    g.fillStyle = grd; g.fillRect(x0, 0, pw, size);
    // 木纹：沿板长方向的细波浪线
    g.globalAlpha = 0.18 * grain;
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = r() < 0.5 ? dark : light; g.lineWidth = 0.6 + r() * 1.6;
      const gx = x0 + 3 + r() * (pw - 6), amp = 1 + r() * 3, f = 0.01 + r() * 0.02, ph = r() * 6;
      g.beginPath();
      for (let y = 0; y <= size; y += 8) g.lineTo(gx + Math.sin(y * f + ph) * amp, y);
      g.stroke();
    }
    // 偶尔一个木节
    if (r() < 0.35) {
      const ky = r() * size, kx = x0 + pw * (0.3 + r() * 0.4);
      g.globalAlpha = 0.35 * grain; g.fillStyle = dark;
      g.beginPath(); g.ellipse(kx, ky, 3 + r() * 3, 8 + r() * 8, 0, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // 板缝（高度图压低 + 颜色加深）
    g.fillStyle = 'rgba(20,8,4,0.85)'; g.fillRect(x0, 0, 2, size);
    hg.fillStyle = '#000'; hg.fillRect(x0 - 1, 0, 4, size);
    // 横向接缝
    if (r() < 0.6) {
      const jy = r() * size;
      g.fillStyle = 'rgba(20,8,4,0.7)'; g.fillRect(x0, jy, pw, 2);
      hg.fillStyle = '#000'; hg.fillRect(x0, jy - 1, pw, 4);
    }
  }
  const hb = blurCanvas(hc, 2);
  const map = tex(c, { srgb: true });
  const normalMap = tex(heightToNormal(hb, 2.5));
  return { map, normalMap };
}

// 深青绒布：细密纤维噪声的法线
export function velvetNormal(size = 256, seed = 9) {
  const r = rng(seed);
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const v = 110 + r() * 120; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return tex(heightToNormal(blurCanvas(c, 0.7), 1.2), { repeat: [6, 6] });
}

function blurCanvas(src, px) {
  const [c, g] = canvas(src.width, src.height);
  g.filter = `blur(${px}px)`;
  // 平铺绘制三次避免边缘发黑
  for (const dx of [-src.width, 0, src.width]) for (const dy of [-src.height, 0, src.height]) g.drawImage(src, dx, dy);
  return c;
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * (1 + k))));
  return '#' + c.getHexString();
}

// D1 台面：淡紫圆角方砖（深一点的砖缝 + 左上高光 / 右下暗边，像软糖块），一张砖 = 贴图一格
export function candyTiles({ size = 256, base = '#9b8cf6', grout = '#6f5fd8', hi = '#c2b8ff', lo = '#8172e8' } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = grout; g.fillRect(0, 0, size, size);
  const pad = size * 0.045, r = size * 0.13, w = size - pad * 2;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  g.fillStyle = lo; rr(pad, pad + size * 0.025, w, w - size * 0.01, r);      // 下沿暗边
  g.fillStyle = hi; rr(pad, pad, w, w - size * 0.03, r);                      // 上沿高光
  const grad = g.createLinearGradient(0, pad, 0, pad + w);
  grad.addColorStop(0, base); grad.addColorStop(1, '#9284f2');
  g.fillStyle = grad; rr(pad + size * 0.02, pad + size * 0.025, w - size * 0.04, w - size * 0.06, r * 0.85);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// D1 甲板：珊瑚粉糖果木板（顺船长方向，深一点的板缝 + 错开的板头，板面轻微明暗差）
export function candyPlanks({ size = 256, base = [255, 128, 142], groove = '#e05f78' } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const n = 4, w = size / n, r = rng(17);
  g.fillStyle = groove; g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    const off = r() * size;
    for (const y0 of [off - size, off]) {
      const k = 0.94 + r() * 0.1;
      g.fillStyle = `rgb(${Math.min(255, base[0] * k) | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      g.beginPath(); g.roundRect(i * w + 3, y0 + 3, w - 6, size - 6, 10); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';   // 板面左沿高光
      g.fillRect(i * w + 5, y0 + 10, 3, size - 20);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
