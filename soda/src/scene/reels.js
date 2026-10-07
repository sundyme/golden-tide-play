// 老虎机三轴转轮：贴图（5 个符号一圈）+ 转动动画（匀速 → 逐轴减速回弹停在目标符号）
import * as THREE from 'three';

const ASSET = './public/assets/';
const TAU = Math.PI * 2;
// 符号 i 正对窗口时的转角（见 machine.js 转轮的几何朝向推导）
export const symbolAngle = i => TAU * (i + 0.5) / 5;

export class SlotReels {
  constructor(meshes) {
    this.meshes = meshes;
    this.reels = meshes.map((m, i) => ({ a: symbolAngle([0, 2, 4][i]), v: 0, state: 'idle', from: 0, to: 0, t: 0 }));
    this.spinning = false;
  }
  start() {
    for (const r of this.reels) { r.state = 'spin'; r.v = 0; }
    this.spinning = true;
  }
  stop(i, symbol) {
    const r = this.reels[i];
    const base = symbolAngle(symbol);
    let to = r.a + 2.2;                                   // 至少再转一段，减速才自然
    to = to + ((base - to) % TAU + TAU) % TAU;            // 对齐到目标符号
    Object.assign(r, { state: 'stop', from: r.a, to, t: 0, v0: r.v });
  }
  update(dt) {
    for (const r of this.reels) {
      if (r.state === 'spin') { r.v = Math.min(18, r.v + dt * 60); r.a += r.v * dt; }
      else if (r.state === 'stop') {
        r.t += dt;
        const D = 0.42, k = Math.min(1, r.t / D);
        // 减速 + 轻微回弹（过冲 4% 再回来）
        const e = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.04;
        r.a = r.from + (r.to - r.from) * e;
        if (k >= 1) { r.a = r.to % TAU; r.state = 'idle'; }
      }
    }
    this.spinning = this.reels.some(r => r.state !== 'idle');
    return this.reels.map(r => r.a);
  }
}

// 转轮贴图：五个老虎机符号排成一圈（来自已过审的 2D 符号）
export async function buildReelTexture() {
  const names = ['sym_skull', 'sym_gem', 'sym_keg', 'sym_anchor', 'sym_parrot'];
  const loadImg = (src, tries = 3) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => tries > 1 ? setTimeout(() => loadImg(src, tries - 1).then(res, rej), 150) : rej(new Error('image load failed: ' + src));
    i.src = src;
  });
  const imgs = await Promise.all(names.map(n => loadImg(`${ASSET}ui/${n}.webp`)));
  const cell = 320, W = cell * names.length, H = 400;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // D1：奶油白糖果转轮，上下淡紫渐暗，两侧泡泡紫色带 + 奶油细线
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#d9d0ff'); bg.addColorStop(0.5, '#fffaf2'); bg.addColorStop(1, '#d9d0ff');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (const y of [0, H - 26]) { g.fillStyle = '#8b7cff'; g.fillRect(0, y, W, 26); g.fillStyle = '#fff3e2'; g.fillRect(0, y === 0 ? 20 : y + 2, W, 4); }
  imgs.forEach((im, i) => {
    g.save();
    g.translate(i * cell + cell / 2, H / 2);
    g.rotate(Math.PI / 2);                        // u 方向绕转轮一圈 → 屏幕上的竖直方向
    const s = Math.min(cell, H) * 0.8 / Math.max(im.width, im.height);
    if (names[i] === 'sym_skull') g.filter = 'brightness(0.42) sepia(0.7) saturate(1.4)';   // v6：深巧克力色骷髅（淡紫骷髅在奶油转轮上发白、看不清）
    g.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
    g.filter = 'none';
    g.restore();
    g.fillStyle = 'rgba(139,124,255,0.35)'; g.fillRect(i * cell, 0, 3, H);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
