// D1-54 开场仪式（点「起航」后约 3.5 s 才能投币，再 1.5 s 余韵）：
//   0.0  镜头推到高处的骷髅：它在吊架上轻轻摆，鼓点渐强
//   0.5  解锁：两个转轴发金光，咔、咔、咔三下迸出火花，滑轨抖动
//   1.45 棘轮一格一格放下滑轨（6 格，每格一声咔哒 + 火花），镜头拉远看全吊架
//   2.35 松扣：滑轨甩下去，骷髅被甩向后
//   2.71 落定：咚！冲击环 + 糖果彩纸 + 灯泡全亮 + 震屏，骷髅前后荡
//   3.0  骷髅 Q 弹一下「醒来」，身边冒星星
//   3.2  横幅「起航！」+ 号角，嘴里喷金光；3.45 镜头回到游戏机位，可以投币
// 开场期间点屏幕 = 快进（×2.6）。时间线只管演出，不碰物理。
import * as THREE from 'three';
import { RAIL_A0 } from './machine.js';

const ss = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const T = { unlock: 0.5, lower: 1.45, release: 2.35, fall: 0.36, wake: 3.0, banner: 3.2, ready: 3.45, end: 5.4 };
const LOWER_TO = 0.62;   // 棘轮放到 A0 × 0.62 再松扣
const STEPS = 6;
// 机位关键帧（世界坐标）：A 高处骷髅特写 → B 拉远看全吊架 → C 落定后的骷髅特写
const SHOTS = {
  A: { pos: [0, 10.2, 4.8], tgt: [0, 9.3, -5.3] },
  B: { pos: [0, 11.2, 13.5], tgt: [0, 8.2, -5.8] },
  C: { pos: [0, 7.5, 5.2], tgt: [0, 5.55, -5.2] },
};
const V = a => new THREE.Vector3(...a);

export class Intro {
  constructor(view, hooks = {}) {
    this.v = view; this.h = hooks;
    this.t = -1; this.speed = 1; this.fired = new Set();
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
    this.shots = Object.fromEntries(Object.entries(SHOTS).map(([k, s]) => [k, { pos: V(s.pos), tgt: V(s.tgt) }]));
  }
  get active() { return this.t >= 0; }

  start() {
    this.t = 0; this.speed = 1; this.fired.clear();
    const D = this.v.director;
    D.shot.pos.copy(this.shots.A.pos); D.shot.tgt.copy(this.shots.A.tgt);
    D.set('intro', null, 2.6);   // 鼓点 introStart 由 main 在音频初始化后触发（首次点击才能起音频）
  }
  hurry() { if (this.active && this.t < T.ready) this.speed = 2.6; }

  _once(key, at, fn) { if (this.t >= at && !this.fired.has(key)) { this.fired.add(key); fn(); } }
  _hubs(fn) { const M = this.v.machine; for (const s of [-1, 1]) fn(this._p.set(s * 5.62, M.railPivot.y, M.railPivot.z), s); }
  _knobs(fn) { for (const k of this.v.machine.railKnobs) fn(k.getWorldPosition(this._p)); }
  _skull() { return this.v.machine.dropper.getWorldPosition(this._q); }   // = 嘴里的币生成点

  update(dt) {
    if (this.t < 0) return;
    const M = this.v.machine, D = this.v.director, FX = this.v.effects, cam = this.v.camera.position;
    this.t += Math.min(dt, 0.05) * this.speed;
    const t = this.t;

    // ---- 吊架角度 + 骷髅摆动 ----
    let a = RAIL_A0, swing = 0.07 * Math.sin(t * 2.4);                 // 吊在高处轻轻荡
    if (t >= T.unlock && t < T.lower) {
      const u = t - T.unlock;
      a += 0.022 * Math.sin(u * 46) * Math.exp(-((u % 0.32) * 7));      // 每下「咔」之后抖一抖
    } else if (t >= T.lower && t < T.release) {
      const k = (t - T.lower) / (T.release - T.lower), f = k * STEPS, i = Math.floor(f);
      const step = (i + ss(Math.min(1, (f - i) * 2.2))) / STEPS;       // 棘轮：每格快速落一下再停住
      a = RAIL_A0 * (1 - (1 - LOWER_TO) * step);
      swing = 0.05 * Math.sin(t * 2.4) + 0.06 * Math.sin((f - i) * Math.PI) ;
    } else if (t >= T.release && t < T.release + T.fall) {
      const k = (t - T.release) / T.fall;
      a = RAIL_A0 * LOWER_TO * (1 - k * k); swing = -0.32 * k * k;
    } else if (t >= T.release + T.fall) {
      const u = t - T.release - T.fall;
      a = -0.07 * Math.exp(-5 * u) * Math.abs(Math.sin(13 * u));        // 撞停后往上弹两下
      swing = 0.38 * Math.exp(-2.6 * u) * Math.sin(7.5 * u + 0.6);       // 骷髅前后荡
      if (u > 2.4) { a = 0; swing = 0; }
    }
    M.setRail(a, swing);

    // ---- 转轴金光 ----
    M.hubGlow = t < T.unlock ? 0 : t < T.release ? ss((t - T.unlock) / 0.4) * (0.75 + 0.25 * Math.sin(t * 18)) : Math.max(0, 1 - (t - T.release) * 2.5);

    // ---- 事件 ----
    this._once('unlock', T.unlock, () => this.h.sfx?.('unlock'));
    for (let i = 0; i < 3; i++) this._once('clack' + i, T.unlock + 0.05 + i * 0.32, () => {
      this.h.sfx?.('tick', i);
      this._hubs(p => { FX.burst(p, 0xffd76a, 10, 0.35, 5); FX.twinkle(p, 2, 0.3, 0xfff2b0, 0.9); });
    });
    for (let i = 0; i < STEPS; i++) this._once('step' + i, T.lower + (i / STEPS) * (T.release - T.lower), () => {
      this.h.sfx?.('tick', 3 + i);
      this._hubs(p => FX.burst(p, 0xffd76a, 5, 0.28, 4));
    });
    this._once('release', T.release, () => {
      this.h.sfx?.('release');
      this._hubs(p => { FX.burst(p, 0xfff0b0, 16, 0.4, 7); FX.flash(p, 0xffd27a, 60); });
    });
    this._once('land', T.release + T.fall, () => {
      this.h.sfx?.('land');
      D.bump(0.45);
      M.skullBoing(-0.8);                                                  // 撞停时压扁一下
      const s = this._skull().clone();
      FX.shock(s.clone().add(new THREE.Vector3(0, 0.4, 0.6)), cam, 0xfff0b0, 4.5, 0.6);
      FX.shock(s.clone().add(new THREE.Vector3(0, 0.4, 0.6)), cam, 0x9ff8ff, 7, 0.85);
      FX.flash(s.clone().add(new THREE.Vector3(0, 1, 2)), 0xffe6b0, 160);
      FX.confetti(s.clone().add(new THREE.Vector3(0, 1.2, 0.4)), 46, 8);
      this._knobs(p => { FX.confetti(p, 14, 6); FX.burst(p, 0xffd76a, 10, 0.4, 5); });
      this.v.fxState.flash = 1.4;                                         // 转轮灯泡全亮
    });
    this._once('wake', T.wake, () => {                                    // 骷髅「醒来」：Q 弹一下，身边冒星星
      M.skullBoing(1);
      this.h.sfx?.('wake');
      FX.twinkle(this._skull().clone().add(new THREE.Vector3(0, 0.75, 0.4)), 5, 0.9, 0xffffff, 0.75);
    });
    this._once('banner', T.banner, () => {
      this.h.banner?.();
      this.h.sfx?.('ready');
      const s = this._skull().clone().add(new THREE.Vector3(0, 0, 0.5));
      FX.burst(s, 0xffd23c, 18, 0.45, 5); FX.twinkle(s, 5, 0.8, 0xffe27a, 0.8);
    });
    this._once('ready', T.ready, () => { M.railReady = true; D.set('play', null, 1.7); this.speed = 1; });

    // ---- 镜头 ----
    if (t < T.ready) {
      const S = this.shots;
      let from = S.A, to = S.A, k = 0;
      if (t >= T.lower - 0.3 && t < T.release) { from = S.A; to = S.B; k = ss((t - T.lower + 0.3) / 0.9); }
      else if (t >= T.release) { from = S.B; to = S.C; k = ss((t - T.release) / 0.5); }
      D.shot.pos.lerpVectors(from.pos, to.pos, k); D.shot.tgt.lerpVectors(from.tgt, to.tgt, k);
      D.k = t < T.release ? 2.6 : 4.5;
    }
    if (t > T.end) { this.t = -1; M.hubGlow = 0; M.setRail(0, 0); }
  }
}
