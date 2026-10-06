// 老虎机 3×3：三轴弧面转轮，每轴一条 10 格的纸带（每轴一张可重绘的贴图），窗口里露出 3 格。
// 停轴前把目标那一列的 3 个符号写进即将停到窗口的 3 格（此时它们在窗口外、轮子正高速转），再减速回弹停住。
import * as THREE from 'three';

const ASSET = './public/assets/';
const TAU = Math.PI * 2;
export const SLOTS = 10;
export const REEL_SYMBOLS = ['skull', 'gem', 'keg', 'anchor', 'parrot', 'coins'];
// 纸带第 k 格正对窗口中线时的转角（几何推导见 machine.js：转角增大 → 符号往下走，k+1 格在 k 格上方）
export const slotAngle = k => TAU * (k + 0.5) / SLOTS;
// 纸带像素比例按真实尺寸：一格 = 半径 2 的 26° 弧长 ≈ 0.91，轮宽 1.78 → 格宽 : 高 ≈ 0.51
const H = 512, CELL = 260;

const loadImg = (src, tries = 3) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => tries > 1 ? setTimeout(() => loadImg(src, tries - 1).then(res, rej), 150) : rej(new Error('image load failed: ' + src));
  i.src = src;
});

// 一格纸面底（羊皮纸 + 两侧暗红包边），所有格子共用
function paperCell() {
  const c = document.createElement('canvas'); c.width = CELL; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#c9ae80'); bg.addColorStop(0.5, '#ecd9b2'); bg.addColorStop(1, '#c9ae80');
  g.fillStyle = bg; g.fillRect(0, 0, CELL, H);
  for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,80,40' : '255,245,220'},${0.04 + Math.random() * 0.06})`; g.fillRect(Math.random() * CELL, Math.random() * H, 1 + Math.random() * 6, 1); }
  for (const y of [0, H - 34]) { g.fillStyle = '#6a1a12'; g.fillRect(0, y, CELL, 34); g.fillStyle = '#d9a442'; g.fillRect(0, y === 0 ? 29 : y, CELL, 5); }
  g.fillStyle = 'rgba(120,70,30,0.35)'; g.fillRect(0, 0, 3, H);   // 格与格之间的分隔线
  return c;
}

class Strip {
  constructor(imgs, paper) {
    this.imgs = imgs; this.paper = paper;
    this.canvas = document.createElement('canvas'); this.canvas.width = CELL * SLOTS; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.slots = [];
    for (let k = 0; k < SLOTS; k++) this.set(k, REEL_SYMBOLS[(Math.random() * REEL_SYMBOLS.length) | 0], false);
    this.tex.needsUpdate = true;
  }
  set(k, sym, upload = true) {
    k = ((k % SLOTS) + SLOTS) % SLOTS;
    if (this.slots[k] === sym) return;
    this.slots[k] = sym;
    const g = this.g, x = k * CELL, im = this.imgs[sym];
    g.drawImage(this.paper, x, 0);
    g.save();
    g.translate(x + CELL / 2, H / 2);
    g.rotate(Math.PI / 2);                        // 纸带 +x（绕转轮一圈）= 屏幕向上：符号转 90° 才是正的
    const s = CELL * 0.98 / Math.max(im.width, im.height);
    g.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
    g.restore();
    if (upload) this.tex.needsUpdate = true;
  }
}

export async function loadReelArt() {
  const list = await Promise.all(REEL_SYMBOLS.map(n => loadImg(`${ASSET}ui/sym_${n}.webp`)));
  const imgs = Object.fromEntries(REEL_SYMBOLS.map((n, i) => [n, list[i]]));
  const paper = paperCell();
  return { strips: [0, 1, 2].map(() => new Strip(imgs, paper)) };
}

export class SlotReels {
  constructor(meshes, art) {
    this.meshes = meshes; this.strips = art.strips;
    this.reels = meshes.map((m, i) => ({ a: slotAngle(i * 3), v: 0, state: 'idle', from: 0, to: 0, t: 0 }));
    this.spinning = false;
  }
  // 当前停在窗口中线的格子
  _center(r) { return ((Math.round(r.a / (TAU / SLOTS) - 0.5) % SLOTS) + SLOTS) % SLOTS; }
  start() {
    this.reels.forEach((r, i) => {
      // 窗口外的 5 格换成随机符号（转起来看到的是新内容；窗口里的 3 格不动，免得起转瞬间跳字）
      const c = this._center(r);
      for (let d = 2; d <= SLOTS - 2; d++) this.strips[i].set(c + d, REEL_SYMBOLS[(Math.random() * REEL_SYMBOLS.length) | 0]);
      r.state = 'spin'; r.v = 0;
    });
    this.spinning = true;
  }
  // column：[上, 中, 下] 三个符号名
  stop(i, column) {
    const r = this.reels[i];
    const step = TAU / SLOTS;
    // 至少再转 4 格（窗口里露出中线上下各 1.5 格）：目标三格此刻都在窗口外，重写纸带看不出来
    const k = Math.ceil((r.a + step * 4) / step - 0.5);
    const to = (k + 0.5) * step;
    const S = this.strips[i];
    S.set(k + 1, column[0]); S.set(k, column[1]); S.set(k - 1, column[2]);
    Object.assign(r, { state: 'stop', from: r.a, to, t: 0 });
  }
  update(dt) {
    for (const r of this.reels) {
      if (r.state === 'spin') { r.v = Math.min(18, r.v + dt * 60); r.a += r.v * dt; }
      else if (r.state === 'stop') {
        r.t += dt;
        const D = 0.5, k = Math.min(1, r.t / D);
        // 减速 + 轻微回弹（过冲再回来）
        const e = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.03;
        r.a = r.from + (r.to - r.from) * e;
        if (k >= 1) { r.a = r.to % TAU; r.state = 'idle'; }
      }
    }
    this.spinning = this.reels.some(r => r.state !== 'idle');
    return this.reels.map(r => r.a);
  }
}
