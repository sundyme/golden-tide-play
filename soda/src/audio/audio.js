// 音频：全部 Web Audio 实时合成（无音频文件）。
//   音乐：原创海盗小调，三层随潮汐加厚（L1 低音 + 手风琴和弦 · L2 提琴旋律 · L3 打击乐），Jackpot / 终局全开
//   音效：金币碰撞（预渲染多变体，按冲击强度叠层）、连击升调、落海水花、骷髅门、老虎机、火药桶、炮击、大潮…
//   总线：music / sfx → 压缩器 → 输出；大事件时音乐闪避（ducking）；简易卷积混响
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];

// 原创旋律（D 小调 / 多利亚，8 小节 × 8 个八分音符；-1 休止）
const MELODY = [
  [69, 69, 74, 74, 76, 77, 76, 74], [76, 72, 72, -1, 67, 72, 76, 79], [77, 76, 74, 69, 74, 77, 81, 77], [76, -1, 72, 69, 76, -1, 69, -1],
  [69, 74, 77, 81, 79, 77, 76, 74], [72, 76, 79, 76, 72, 76, 79, 84], [74, 77, 82, 77, 73, 76, 81, 76], [74, -1, 69, -1, 74, -1, -1, -1],
];
const CHORDS = [[50, 53, 57], [48, 52, 55], [50, 53, 57], [45, 48, 52], [50, 53, 57], [48, 52, 55], [46, 50, 53, 45, 49, 52], [50, 53, 57]];

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.settings = { music: true, sfx: true };
    this.intensity = 0;          // 0..1 音乐层级目标
    this.tension = 0;
  }

  // 必须在用户手势里调用
  async init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.comp = C.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 10; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master = C.createGain(); this.master.gain.value = 0.9;
    this.comp.connect(this.master).connect(C.destination);
    this.music = C.createGain(); this.duck = C.createGain(); this.sfx = C.createGain();
    this.music.connect(this.duck).connect(this.comp); this.sfx.connect(this.comp);
    this.music.gain.value = this.settings.music ? 0.42 : 0; this.sfx.gain.value = this.settings.sfx ? 0.9 : 0;
    this.rev = C.createConvolver(); this.rev.buffer = this._impulse(1.8);
    this.revIn = C.createGain(); this.revIn.gain.value = 0.22;
    this.revIn.connect(this.rev).connect(this.comp);
    this.layers = [0, 1, 2].map(() => { const g = C.createGain(); g.gain.value = 0; g.connect(this.music); return g; });
    this.musicRev = C.createGain(); this.musicRev.gain.value = 0.35; this.music.connect(this.musicRev).connect(this.revIn);
    this.noise = this._noiseBuf(2);
    this.clinks = await Promise.all(Array.from({ length: 8 }, (_, i) => this._renderClink(i)));
    this._ocean();
    this.step = 0; this.nextT = C.currentTime + 0.1; this.tempo = 132;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  set(key, on) {
    this.settings[key] = on;
    if (!this.ctx) return;
    const g = key === 'music' ? this.music.gain : this.sfx.gain;
    g.setTargetAtTime(on ? (key === 'music' ? 0.42 : 0.9) : 0, this.ctx.currentTime, 0.05);
  }
  pause(on) { if (!this.ctx) return; on ? this.ctx.suspend() : this.ctx.resume(); }

  // ---------- 基础构件 ----------
  _impulse(sec) {
    const C = this.ctx, n = Math.floor(C.sampleRate * sec), b = C.createBuffer(2, n, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    return b;
  }
  _noiseBuf(sec, brown = false) {
    const C = this.ctx, n = Math.floor(C.sampleRate * sec), b = C.createBuffer(1, n, C.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  async _renderClink(seed) {
    const sr = 44100, len = 0.5;
    const O = new OfflineAudioContext(1, sr * len, sr);
    const f0 = 1700 + seed * 170 + Math.random() * 120;
    const parts = [[1, 0.5, 0.34], [2.32, 0.32, 0.2], [4.25, 0.22, 0.12], [6.63, 0.14, 0.08], [9.38, 0.08, 0.05]];
    for (const [r, a, d] of parts) {
      const o = O.createOscillator(), g = O.createGain();
      o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.01);
      g.gain.setValueAtTime(a, 0); g.gain.exponentialRampToValueAtTime(0.0001, d * (0.8 + Math.random() * 0.5));
      o.connect(g).connect(O.destination); o.start(0); o.stop(len);
    }
    const nb = O.createBuffer(1, sr * 0.01, sr), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length) ** 2;
    const ns = O.createBufferSource(), hp = O.createBiquadFilter(), ng = O.createGain();
    ns.buffer = nb; hp.type = 'highpass'; hp.frequency.value = 3000; ng.gain.value = 0.5;
    ns.connect(hp).connect(ng).connect(O.destination); ns.start(0);
    return O.startRendering();
  }
  _osc(type, freq, t, dur, { gain = 0.2, attack = 0.005, out = this.sfx, filter = null, q = 1, detune = 0, glide = null, rev = 0 } = {}) {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = o;
    if (filter) { const f = C.createBiquadFilter(); f.type = filter[0]; f.frequency.setValueAtTime(filter[1], t); if (filter[2]) f.frequency.exponentialRampToValueAtTime(filter[2], t + dur); f.Q.value = q; n.connect(f); n = f; }
    n.connect(g).connect(out);
    if (rev) { const s = C.createGain(); s.gain.value = rev; g.connect(s).connect(this.revIn); }
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  _noise(t, dur, { gain = 0.3, filter = ['lowpass', 2000, null], q = 0.7, out = this.sfx, attack = 0.005, rev = 0, rate = 1 } = {}) {
    const C = this.ctx, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain();
    s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate;
    f.type = filter[0]; f.frequency.setValueAtTime(filter[1], t); if (filter[2]) f.frequency.exponentialRampToValueAtTime(filter[2], t + dur); f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    if (rev) { const r = C.createGain(); r.gain.value = rev; g.connect(r).connect(this.revIn); }
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  clink(t = this.ctx.currentTime, { gain = 0.35, rate = 1, rev = 0.15 } = {}) {
    if (!this.clinks) return;
    const C = this.ctx, s = C.createBufferSource(), g = C.createGain(), p = C.createStereoPanner();
    s.buffer = this.clinks[(Math.random() * this.clinks.length) | 0];
    s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    g.gain.value = gain; p.pan.value = (Math.random() - 0.5) * 0.6;
    s.connect(g).connect(p).connect(this.sfx);
    if (rev) { const r = C.createGain(); r.gain.value = rev; g.connect(r).connect(this.revIn); }
    s.start(t);
  }
  // 冲击强度 → 叠层数：轻碰 1 声，重落 3~4 声错开几毫秒（"哗啦"）
  impact(k, t = this.ctx.currentTime, rate = 1) {
    const n = 1 + Math.min(4, Math.floor(k * 4));
    for (let i = 0; i < n; i++) this.clink(t + i * (0.008 + Math.random() * 0.02), { gain: 0.12 + 0.2 * k / Math.sqrt(n), rate: rate * (1 - i * 0.04) });
  }
  duckMusic(depth = 0.35, sec = 0.8) {
    const g = this.duck.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.03); g.setTargetAtTime(1, t + sec, 0.3);
  }
  haptic(p) { try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(p); } catch { } }

  _ocean() {
    const C = this.ctx, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain(), lfo = C.createOscillator(), lg = C.createGain();
    s.buffer = this._noiseBuf(6, true); s.loop = true;
    f.type = 'lowpass'; f.frequency.value = 520;
    g.gain.value = 0.12; lfo.frequency.value = 0.11; lg.gain.value = 0.07;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(); lfo.start();
    this.oceanGain = g;
  }

  // ---------- 音乐：前瞻调度 ----------
  _schedule() {
    const C = this.ctx;
    if (C.state !== 'running') { this.nextT = C.currentTime + 0.05; return; }
    // 层级渐变
    const I = this.intensity, t0 = C.currentTime;
    [1, I > 0.33 ? 1 : 0.0001, I > 0.7 ? 1 : 0.0001].forEach((v, i) => this.layers[i].gain.setTargetAtTime(v * [0.9, 0.7, 0.8][i], t0, 0.6));
    const e8 = 60 / this.tempo / 2;
    while (this.nextT < t0 + 0.15) { this._note(this.step, this.nextT, e8); this.nextT += e8; this.step++; }
  }
  _note(step, t, e8) {
    const bar = Math.floor(step / 8) % 8, s = step % 8;
    const [L1, L2, L3] = this.layers;
    let ch = CHORDS[bar];
    if (ch.length > 3) ch = s < 4 ? ch.slice(0, 3) : ch.slice(3);
    // L1：低音（1、5 拍）+ 手风琴和弦（反拍）
    if (s === 0 || s === 4) {
      const root = ch[0] - 12 - (s === 4 ? 5 : 0) + (s === 4 && bar % 2 ? 7 : 0);
      this._osc('triangle', mtof(root), t, e8 * 3, { gain: 0.32, out: L1, attack: 0.01 });
      this._osc('sine', mtof(root - 12), t, e8 * 3, { gain: 0.22, out: L1, attack: 0.01 });
    }
    if (s === 2 || s === 6 || (s === 7 && this.intensity > 0.7)) {
      for (const n of ch) {
        this._osc('sawtooth', mtof(n + 12), t, e8 * 1.3, { gain: 0.045, out: L1, attack: 0.015, filter: ['lowpass', 1700], detune: -7 });
        this._osc('square', mtof(n + 12), t, e8 * 1.3, { gain: 0.03, out: L1, attack: 0.015, filter: ['lowpass', 1500], detune: 7 });
      }
    }
    // L2：旋律（提琴感：锯齿 + 带通 + 颤音）
    const m = MELODY[bar][s];
    if (m > 0) {
      let len = 1; while (s + len < 8 && MELODY[bar][s + len] === -1 && len < 3) len++;
      const o = this._osc('sawtooth', mtof(m), t, e8 * len * 0.95, { gain: 0.09, out: L2, attack: 0.03, filter: ['bandpass', 1400], q: 0.8 });
      const v = this.ctx.createOscillator(), vg = this.ctx.createGain();
      v.frequency.value = 5.5; vg.gain.value = 9; v.connect(vg).connect(o.detune); v.start(t); v.stop(t + e8 * len + 0.05);
      this._osc('sine', mtof(m + 12), t, e8 * len * 0.8, { gain: 0.025, out: L2, attack: 0.02 });
    }
    // L3：打击乐（底鼓 1/5、拍手 3/7、沙锤每个八分）
    if (s === 0 || s === 4) this._osc('sine', 120, t, 0.28, { gain: 0.55, out: L3, glide: 42, attack: 0.002 });
    if (s === 2 || s === 6) this._noise(t, 0.14, { gain: 0.16, filter: ['bandpass', 1600], q: 0.9, out: L3 });
    this._noise(t, 0.05, { gain: s % 2 ? 0.05 : 0.08, filter: ['highpass', 7000], out: L3 });
  }

  // ---------- 游戏事件 ----------
  onEvent(e, game) {
    if (!this.ctx || !this.clinks) return;
    const t = this.ctx.currentTime;
    switch (e.type) {
      case 'drop': this._osc('triangle', 1250, t, 0.06, { gain: 0.05 }); this.impact(0.55, t + 0.32); break;
      case 'gate': [0, 4, 7, 12].forEach((s, i) => this._osc('sine', mtof(88 + s), t + i * 0.05, 0.5, { gain: 0.08, rev: 0.5 })); break;
      case 'payout': {
        const combo = Math.max(1, e.combo || 1);
        const rate = Math.pow(2, PENTA[Math.min(combo - 1, PENTA.length - 1)] / 12) * 0.85;
        const heavy = e.obj === 'giant' || e.obj === 'gem';
        this.impact(heavy ? 1 : 0.45, t + 0.5, rate);
        if (e.obj === 'gem') { [0, 7, 12, 16, 19, 24].forEach((s, i) => this._osc('sine', mtof(84 + s), t + 0.45 + i * 0.06, 0.8, { gain: 0.07, rev: 0.6 })); this.haptic([20, 40, 30]); }
        if (e.obj === 'map') [0, 5, 9, 12].forEach((s, i) => this._osc('triangle', mtof(81 + s), t + i * 0.08, 0.6, { gain: 0.07, rev: 0.5 }));
        if (heavy) this.haptic(25);
        break;
      }
      case 'lost':
        this._noise(t + 0.25, 0.45, { gain: 0.11, filter: ['lowpass', 2600, 300], rate: 0.8 });
        this._osc('sine', 700 + Math.random() * 300, t + 0.28, 0.12, { gain: 0.05, glide: 1500 });
        break;
      case 'spinStart': this.spinning = true; this.spinTick = t; this.tease = e.tease; break;
      case 'reelStop':
        this._osc('sine', 160, t, 0.12, { gain: 0.3, glide: 70 }); this._noise(t, 0.05, { gain: 0.12, filter: ['bandpass', 2500] });
        if (e.i === 1 && this.tease) this._osc('sawtooth', 300, t + 0.05, 0.9, { gain: 0.05, glide: 900, filter: ['lowpass', 2000] });
        if (e.i === 2) this.spinning = false;
        break;
      case 'slotResult': {
        if (e.result === 'none') { this._osc('triangle', mtof(62), t, 0.18, { gain: 0.08 }); this._osc('triangle', mtof(57), t + 0.12, 0.3, { gain: 0.08 }); break; }
        if (e.result === 'skull') break;
        const big = e.result !== 'pair';
        [0, 4, 7, 12, big ? 16 : null, big ? 19 : null].filter(x => x !== null).forEach((s, i) => {
          this._osc('square', mtof(72 + s), t + i * 0.07, 0.35, { gain: 0.05, filter: ['lowpass', 3000], rev: 0.4 });
          this._osc('sine', mtof(84 + s), t + i * 0.07, 0.5, { gain: 0.05, rev: 0.4 });
        });
        if (e.result === 'pair') for (let i = 0; i < 5; i++) this.clink(t + 0.2 + i * 0.15, { gain: 0.2 });
        if (big) this.duckMusic(0.5, 0.6);
        break;
      }
      case 'kegBoom': this._boom(t, 1.4, 1); this.duckMusic(0.25, 0.9); this.haptic([60, 30, 40]); for (let i = 0; i < 10; i++) this.clink(t + 0.05 + Math.random() * 0.5, { gain: 0.15 }); break;
      case 'specialDrop': if (e.obj === 'keg') this._osc('sawtooth', 220, t, 0.6, { gain: 0.05, glide: 110, filter: ['lowpass', 900] }); break;
      case 'surgeStart':
        this._noise(t, 2.2, { gain: 0.35, filter: ['bandpass', 300, 2400], q: 1.2, attack: 0.6, rev: 0.3 });
        [50, 57, 62].forEach(n => this._osc('sawtooth', mtof(n), t + 0.2, 1.6, { gain: 0.07, attack: 0.25, filter: ['lowpass', 900], rev: 0.4 }));
        this.duckMusic(0.5, 1.2); this.haptic(80);
        break;
      case 'jackpotStart':
        this._noise(t, 2.5, { gain: 0.25, filter: ['highpass', 5000], attack: 0.01, rev: 0.6 });
        this.duckMusic(0.15, 2.2); this.haptic([100, 50, 100]);
        break;
      case 'cannonFire': if (e.k < 2 || e.k % 6 < 2) { this._boom(t, 0.7, 0.55); } this.clink(t + 0.7, { gain: 0.18 }); if (e.k % 6 === 0) this.haptic(30); break;
      case 'jackpotTitle': this._fanfare(t); this.duckMusic(0.3, 1.6); break;
      case 'jackpotCount': for (let i = 0; i < 18; i++) this.clink(t + i * 0.05, { gain: 0.22, rate: 1 + i * 0.02 }); break;
      case 'itemUse':
        if (e.item === 'coinrain') { this._noise(t, 0.8, { gain: 0.2, filter: ['bandpass', 600, 4000] }); for (let i = 0; i < 20; i++) this.clink(t + 0.4 + i * 0.07, { gain: 0.14 }); }
        if (e.item === 'guard') { this._osc('sawtooth', 300, t, 0.5, { gain: 0.08, glide: 1200, filter: ['bandpass', 1500] }); this._osc('sine', mtof(91), t + 0.4, 1, { gain: 0.08, rev: 0.6 }); }
        if (e.item === 'giant') this.impact(1, t + 0.4, 0.6);
        break;
      case 'itemGain': [0, 7, 12].forEach((s, i) => this._osc('triangle', mtof(79 + s), t + i * 0.06, 0.3, { gain: 0.07 })); break;
      case 'mapCollected': [0, 4, 7, 11, 14].forEach((s, i) => this._osc('sine', mtof(86 + s), t + i * 0.07, 0.9, { gain: 0.06, rev: 0.7 })); this.haptic(40); break;
      case 'endingStart': this._fanfare(t, true); this.duckMusic(0.4, 2); break;
      case 'chestPour': for (let i = 0; i < 60; i++) this.clink(t + 0.2 + i * 0.04 + Math.random() * 0.03, { gain: 0.16, rate: 0.9 + Math.random() * 0.3 }); this.haptic([80, 40, 80]); break;
      case 'refill': this._osc('triangle', 1600, t, 0.08, { gain: 0.04 }); break;
      case 'comboEnd': if (e.n >= 8) [0, 4, 7, 12].forEach((s, i) => this._osc('square', mtof(76 + s), t + i * 0.05, 0.2, { gain: 0.04, filter: ['lowpass', 2500] })); break;
    }
  }
  ui(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'click') { this._osc('triangle', 900, t, 0.06, { gain: 0.08 }); this._osc('sine', 1800, t + 0.03, 0.08, { gain: 0.04 }); }
    if (kind === 'start') { this._fanfare(t, true); this.haptic(30); }
  }
  // 鹦鹉叫声：锯齿波 + 快速音高轮廓，过两个带通共振峰（鼻音），再用 ~70 Hz 调幅做出沙哑感
  _caw(t, dur, f0, f1, f2, gain = 0.16) {
    const C = this.ctx, o = C.createOscillator(), am = C.createOscillator(), amG = C.createGain(), g = C.createGain(), mix = C.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    am.type = 'square'; am.frequency.value = 62 + Math.random() * 20; amG.gain.value = 0.45;
    mix.gain.value = 0.55; am.connect(amG).connect(mix.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.setValueAtTime(gain, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(mix);
    for (const [f, q, k] of [[1350, 5, 1], [2900, 7, 0.6]]) {
      const bp = C.createBiquadFilter(), bg = C.createGain(); bp.type = 'bandpass'; bp.frequency.value = f * (0.95 + Math.random() * 0.1); bp.Q.value = q; bg.gain.value = k * 2.2;
      mix.connect(bp).connect(bg).connect(g);
    }
    g.connect(this.sfx);
    const r = C.createGain(); r.gain.value = 0.18; g.connect(r).connect(this.revIn);
    o.start(t); am.start(t); o.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
    this._noise(t, dur * 0.7, { gain: gain * 0.25, filter: ['bandpass', 2400, 1600], q: 2 });
  }
  squawk(kind = 'poke') {
    if (!this.ctx || !this.settings.sfx) return;
    const t = this.ctx.currentTime + 0.01, j = () => 0.9 + Math.random() * 0.2;
    switch (kind) {
      case 'hover': this._caw(t, 0.16, 700 * j(), 820, 1250, 0.09); break;                                  // 「嗯？」上扬
      case 'poke': this._caw(t, 0.17, 950 * j(), 1500, 800, 0.16); this._caw(t + 0.2, 0.15, 1000 * j(), 1450, 760, 0.13); break;   // 「嘎嘎」
      case 'ruffle': for (let i = 0; i < 4; i++) this._caw(t + i * 0.11, 0.12, 1200 * j(), 1700, 900, 0.14); break;               // 连声抗议
      case 'spin': this._caw(t, 0.6, 600, 900, 2200, 0.1); this._osc('sine', 1800, t + 0.1, 0.5, { gain: 0.05, glide: 3200 }); break; // 「呜——」
      case 'gift': this._caw(t, 0.2, 900, 1400, 700, 0.15); for (let i = 0; i < 3; i++) this.clink(t + 0.3 + i * 0.12, { gain: 0.3, rate: 1.1 }); break;
      case 'talk': for (let i = 0; i < 3; i++) this._caw(t + i * 0.13, 0.1, (850 + i * 120) * j(), 1200, 900, 0.08); break;      // 叽里呱啦
    }
  }
  // D1-54 开场仪式音效（时间线见 scene/intro.js）：
  //   introStart 鼓点渐强 + 低音垫铺底 · unlock 魔法闪音 · tick(i) 棘轮咔哒（越放越高）· release 松扣 + 风声
  //   land 落定的咚 + 塑料当 + 彩纸噗 · wake 骷髅醒来 Q 弹的「啵啵」+ 小星星 · ready 起航号角
  intro(kind, i = 0) {
    if (!this.ctx || !this.settings.sfx) return;
    const t = this.ctx.currentTime + 0.01;
    switch (kind) {
      case 'introStart':
        for (let k = 0; k < 26; k++) {
          const tk = t + 0.02 + k * 0.055 * (1 - k * 0.012), g = 0.05 + k * 0.009;
          this._noise(tk, 0.07, { gain: g, filter: ['bandpass', 700 + k * 25, null], q: 1.2, attack: 0.002 });
          if (k % 4 === 0) this._osc('sine', 82, tk, 0.16, { gain: 0.12 + k * 0.008, glide: 58, attack: 0.003 });
        }
        this._osc('sawtooth', mtof(38), t, 2.4, { gain: 0.035, attack: 1.2, filter: ['lowpass', 500, 900], rev: 0.4 });
        this._osc('sawtooth', mtof(45), t + 0.3, 2.1, { gain: 0.025, attack: 1.0, filter: ['lowpass', 600, 1100], rev: 0.4 });
        break;
      case 'unlock':
        [74, 78, 81, 86, 90].forEach((n, k) => this._osc('sine', mtof(n), t + k * 0.06, 0.6, { gain: 0.05, rev: 0.6 }));
        this._noise(t, 0.9, { gain: 0.05, filter: ['highpass', 7000, null], rev: 0.5, attack: 0.2 });
        break;
      case 'tick': {
        const f = 1300 + i * 110;
        this._osc('square', f, t, 0.03, { gain: 0.07, filter: ['bandpass', f * 1.2, null], q: 5 });
        this._noise(t, 0.035, { gain: 0.16, filter: ['highpass', 2600, null] });
        this._osc('triangle', f * 0.5, t, 0.09, { gain: 0.05, rev: 0.2 });
        this._osc('sine', 160 - i * 6, t, 0.08, { gain: 0.1, glide: 90 });
        break;
      }
      case 'release':
        this._osc('square', 1700, t, 0.04, { gain: 0.08, filter: ['bandpass', 2000, null], q: 4 });
        this._noise(t, 0.05, { gain: 0.16, filter: ['highpass', 2500, null] });
        this._osc('sawtooth', 110, t + 0.02, 0.36, { gain: 0.04, glide: 62, filter: ['lowpass', 800, 300], attack: 0.03 });
        this._noise(t + 0.02, 0.38, { gain: 0.24, filter: ['bandpass', 420, 2200], q: 1.4, attack: 0.25 });
        break;
      case 'land':
        this._osc('sine', 130, t, 0.45, { gain: 0.6, glide: 44, attack: 0.002 });
        this._noise(t, 0.25, { gain: 0.36, filter: ['lowpass', 1100, 140], attack: 0.002 });
        this._osc('triangle', 610, t, 0.6, { gain: 0.08, rev: 0.3 });
        this._osc('triangle', 947, t, 0.45, { gain: 0.05, rev: 0.3 });
        this.impact(0.8, t + 0.03, 1.05);
        this._osc('sine', 150, t + 0.13, 0.18, { gain: 0.18, glide: 70 });
        this._noise(t + 0.02, 0.5, { gain: 0.1, filter: ['highpass', 5000, null], rev: 0.5 });         // 彩纸「噗」
        [84, 88, 91, 96].forEach((n, k) => this._osc('triangle', mtof(n), t + 0.05 + k * 0.045, 0.35, { gain: 0.035, rev: 0.5 }));
        this.haptic([30, 60, 15]);
        break;
      case 'wake':
        this._osc('sine', 420, t, 0.14, { gain: 0.12, glide: 980, attack: 0.004 });
        this._osc('sine', 520, t + 0.13, 0.16, { gain: 0.11, glide: 1250, attack: 0.004 });
        [96, 100].forEach((n, k) => this._osc('triangle', mtof(n), t + 0.26 + k * 0.08, 0.3, { gain: 0.03, rev: 0.6 }));
        break;
      case 'ready': this._fanfare(t, true); this.haptic(30); break;
    }
  }
  _boom(t, dur, k) {
    this._noise(t, dur, { gain: 0.6 * k, filter: ['lowpass', 1400, 80], attack: 0.004, rev: 0.4 });
    this._osc('sine', 110, t, dur * 0.7, { gain: 0.7 * k, glide: 32, attack: 0.003 });
  }
  _fanfare(t, major = false) {
    const seq = major ? [[62, 66, 69], [64, 67, 71], [66, 69, 74]] : [[62, 65, 69], [60, 64, 67], [62, 65, 69, 74]];
    seq.forEach((ch, i) => ch.forEach(n => {
      this._osc('sawtooth', mtof(n), t + i * 0.22, i === 2 ? 1.4 : 0.22, { gain: 0.06, attack: 0.02, filter: ['lowpass', 2600], rev: 0.5 });
      this._osc('square', mtof(n + 12), t + i * 0.22, i === 2 ? 1.2 : 0.2, { gain: 0.025, filter: ['lowpass', 3500] });
    }));
    this._noise(t + 0.44, 1.6, { gain: 0.12, filter: ['highpass', 6000], rev: 0.6 });
  }

  // ---------- 每帧 ----------
  update(dt, game, sim) {
    if (!this.ctx || !this.clinks || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    // 音乐层级：潮汐 → L2，大潮 / Jackpot / 终局 → L3
    this.intensity = game.jackpot || game.ending ? 1 : game.surgeT > 0 ? 0.85 : Math.min(0.69, 0.15 + game.tide * 0.9);
    this.tempo += ((game.jackpot ? 152 : game.surgeT > 0 ? 144 : 132) - this.tempo) * Math.min(1, dt * 2);
    // 老虎机转动嘀嗒
    if (this.spinning && t - this.spinTick > 0.055) { this.spinTick = t; this._osc('square', 2400, t, 0.02, { gain: 0.025, filter: ['bandpass', 2400] }); }
    // 台面金币碰撞的底噪：醒着的币越多，随机碰撞越多
    const awake = Math.min(40, sim.awakeCount());
    if (Math.random() < awake * 0.12 * dt) this.clink(t, { gain: 0.04 + Math.random() * 0.06, rate: 0.85 + Math.random() * 0.3, rev: 0.05 });
    this.oceanGain.gain.setTargetAtTime(0.12 + (game.surgeT > 0 ? 0.12 : 0), t, 0.5);
  }
}
