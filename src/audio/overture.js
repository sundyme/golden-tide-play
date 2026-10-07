// 序曲：加载页 → 起航页 → 起航仪式的配乐。Web Audio 实时合成，用的是游戏主题同一条旋律（放慢一倍、换成铜管）。
//   loading  加载页：远处圆号吹主题第一句，低音弦乐、人声铺底、船钟、定音鼓心跳；4 小节一循环，加载多久循环多久
//   reveal   加载完成、Logo 落下：定音鼓滚奏 + 镲片渐强 → 全奏 D 小调和弦
//   title    起航页：圆号庄严地吹整段主题（16 小节一轮），第二轮小号高八度加入、合唱铺满
//   ceremony 点「起航」：船钟两响、军鼓滚奏、小号号角、D 大调全奏 + 两声礼炮，然后交给游戏里的快板
// 只依赖一个 BaseAudioContext + 输出节点，离线渲染（OfflineAudioContext）也能跑，方便试听和测响度。
import { mtof, MELODY, CHORDS } from './theme.js';

const BPM = 72, BEAT = 60 / BPM;
const LOAD_CHORDS = [[50, 53, 57], [50, 53, 57], [46, 50, 53], [45, 49, 52]];   // Dm Dm B♭ A：问句，停在属和弦上等加载完
const LOAD_HORN = [[57, 0, 1], [57, 1, 1], [62, 2, 1], [62, 3, 1], [64, 4, 1], [65, 5, 1], [64, 6, 1], [62, 7, 1], [65, 8, 3.6], [64, 12, 2.6]];   // [音, 第几拍, 拍数]

export class Overture {
  // out：音乐总线；rev：混响送入；boom(t, dur, k)：礼炮（走音效总线）
  constructor(ctx, out, rev, { boom } = {}) {
    const C = this.C = ctx;
    this.rev = rev; this.boom = boom;
    this.bus = C.createGain(); this.bus.gain.value = 1.0; this.bus.connect(out);
    this.loadBus = this._sub(); this.titleBus = this._sub(); this.cerBus = this._sub();
    const n = Math.floor(C.sampleRate * 2), b = C.createBuffer(1, n, C.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    this.phase = null;      // null → loading → reveal → title → ceremony → done
    this.beat = 0; this.nextT = 0; this.loops = 0;
  }
  _sub() { const g = this.C.createGain(); g.connect(this.bus); return g; }

  // ---------- 阶段 ----------
  startLoading(t) { this.phase = 'loading'; this.beat = 0; this.loops = 0; this.nextT = t; }
  // 加载完成：滚奏 0.9 秒后全奏落下（正好接 Logo 落地），和弦余音里起航页主题进来
  reveal(t) {
    const hit = t + 0.9;
    this._fade(this.loadBus, t + 0.5, 0.6);
    this.timpRoll(38, t, hit - 0.03, 0.06, 0.55, this.cerBus);
    this.swell(t, hit, 0.1, this.cerBus);
    this.tutti(hit, false, this.cerBus);
    this.phase = 'title'; this.beat = 0; this.loops = 0; this.nextT = hit + BEAT * 3;
    return hit;
  }
  // 点「起航」：返回游戏快板该进来的时间
  ceremony(t) {
    this._fade(this.loadBus, t, 0.12); this._fade(this.titleBus, t, 0.12);
    const B = this.cerBus;
    B.gain.cancelScheduledValues(t); B.gain.setValueAtTime(1, t);
    this.bell(t, 81, 1.2, B); this.bell(t + 0.34, 81, 1.0, B);
    const call = t + 0.85;
    this.snareRoll(t + 0.15, call, 0.04, 0.32, B);
    this.timpRoll(38, t + 0.15, call - 0.02, 0.05, 0.45, B);
    // 号角：A A D · F# —— 落在 D 大调全奏上
    for (const [m, dt, len] of [[69, 0, 0.13], [69, 0.17, 0.13], [74, 0.34, 0.3], [78, 0.68, 0.12]]) this.brass(m, call + dt, len, { vel: 1, bright: 1.3, out: B, a: 0.02 }), this.brass(m - 12, call + dt, len, { vel: 0.6, bright: 0.9, out: B, a: 0.02 });
    const hit = call + 0.82;
    this.swell(call, hit, 0.08, B);
    this.tutti(hit, true, B);
    if (this.boom) { this.boom(hit, 1.1, 0.8); this.boom(hit + 0.55, 0.9, 0.55); }
    this.phase = 'done';
    this._fade(B, hit + 2.4, 2.5);
    return hit + 1.15;
  }
  stop(t) { if (this.phase === 'done') return; this._fade(this.loadBus, t, 0.4); this._fade(this.titleBus, t, 0.8); this.phase = 'done'; }
  _fade(g, t, sec) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value || 1, t); g.gain.setTargetAtTime(0.0001, t, sec / 3); }

  // 前瞻调度：每拍排一次
  tick(now) {
    if (this.phase !== 'loading' && this.phase !== 'title') return;
    if (this.nextT < now) this.nextT = now + 0.05;   // 页面卡顿 / 刚解锁：不补排过去的拍
    while (this.nextT < now + 0.35) {
      if (this.phase === 'loading') this._loadBeat(this.beat % 16, this.nextT); else this._titleBeat(this.beat % 64, this.nextT);
      this.nextT += BEAT; this.beat++;
      if (this.beat % (this.phase === 'loading' ? 16 : 64) === 0) this.loops++;
    }
  }

  _loadBeat(n, t) {
    const bar = n >> 2, b = n & 3, ch = LOAD_CHORDS[bar], O = this.loadBus, L = this.loops;
    if (b === 0) {
      this.strings(ch.map(x => x + 12), t, BEAT * 4, { gain: 0.022, a: 1.2, rel: 1.6, out: O });
      this.cello(ch[0] - 12, t, BEAT * 4, { out: O });
      if (L > 0 || bar > 1) this.choir(ch.map(x => x + 12), t, BEAT * 4, { gain: 0.012, out: O });
      this.timp(bar === 3 ? 33 : 38, t, 0.22, O);
    }
    if (b === 2) this.timp(bar === 3 ? 40 : 33, t, 0.12, O);
    if (n === 0) { this.bell(t, 81, 0.55, O); this.bell(t + 0.42, 81, 0.45, O); }
    for (const [m, at, len] of LOAD_HORN) if (at === n) this.brass(m, t, len * BEAT * 0.94, { vel: 0.55, bright: 0.55, out: O, rev: 1.1, a: 0.12 });
  }

  _titleBeat(n, t) {
    const ob = n >> 3, s = n & 7, O = this.titleBus, second = this.loops % 2 === 1;
    let ch = CHORDS[ob]; const split = ch.length > 3;
    if (split) ch = s < 4 ? ch.slice(0, 3) : ch.slice(3);
    // 旋律：原曲一个八分音符 = 这里一拍
    const m = MELODY[ob][s];
    if (m > 0) {
      let len = 1; while (s + len < 8 && MELODY[ob][s + len] === -1 && len < 3) len++;
      const dur = len * BEAT * 0.93;
      this.brass(m - 12, t, dur, { vel: 0.85, bright: 0.8, out: O, a: 0.06 });
      this.brass(m - 24, t, dur, { vel: 0.35, bright: 0.5, out: O, a: 0.08, rev: 0.3 });
      if (second) this.brass(m, t, dur, { vel: 0.5, bright: 1.1, out: O, a: 0.04 });
    }
    // 和声：弦乐长音 + 大提琴根音
    if (s === 0 || (split && s === 4)) {
      const len = split ? 4 : 8;
      this.strings([...ch, ...ch.map(x => x + 12)], t, BEAT * len, { gain: 0.016, a: 0.5, rel: 1.0, out: O });
      if (second || ob >= 4) this.choir(ch.map(x => x + 12), t, BEAT * len, { gain: 0.011, out: O });
    }
    if (s === 0 || s === 4) this.cello(ch[0] - 12 + (s === 4 && !split ? 7 : 0), t, BEAT * 4, { out: O, gain: 0.05 });
    // 定音鼓：每小节一、三拍（根音 / 五音），最后一小节滚奏回到开头
    const tp = x => { while (x < 33) x += 12; while (x > 45) x -= 12; return x; };
    if (s === 0) this.timp(tp(ch[0]), t, 0.36, O);
    if (s === 4) this.timp(tp(ch[0] + 7), t, 0.2, O);
    if (ob === 7 && s === 6) this.timpRoll(33, t, t + BEAT * 2 - 0.05, 0.05, 0.3, O);
    // 军鼓：每两拍一个装饰音，行进感但不吵
    if (s === 3 || s === 7) this.snare(t, 0.08, O);
    if (n === 0) this.bell(t, 81, 0.5, O);
  }

  // 全奏落点：D 小调（加载完成）/ D 大调（起航）
  tutti(t, major, out) {
    const third = major ? 66 : 65;
    for (const m of [62, third, 69]) this.brass(m, t, 2.4, { vel: 1, bright: 1.0, out, a: 0.03 });
    this.brass(50, t, 2.6, { vel: 0.7, bright: 0.6, out, a: 0.04 });
    for (const m of (major ? [74, 78, 81] : [69, 74])) this.brass(m, t, 2.0, { vel: 0.75, bright: 1.4, out, a: 0.02 });
    this.strings([38, 50, 57, 62, third, 69, 74], t, 3.2, { gain: 0.02, a: 0.08, rel: 1.8, out });
    this.choir([62, third, 69, 74], t, 3.0, { gain: 0.016, out, a: 0.25 });
    this.timp(38, t, 0.9, out); this.timp(26, t, 0.5, out);
    this.crash(t, 0.2, 3.4, out);
    this.bell(t, 81, 0.8, out);
  }

  // ---------- 乐器 ----------
  // 铜管：两根锯齿波 + 低通，滤波器先猛开再回落（铜管起音的那一下"噗"），长音加迟到的颤音
  brass(m, t, dur, { vel = 1, bright = 1, out, rev = 0.45, a = 0.05 } = {}) {
    const C = this.C, f = C.createBiquadFilter(), g = C.createGain(), hz = mtof(m), end = t + Math.max(dur, a) + 0.22;
    f.type = 'lowpass'; f.Q.value = 1.3;
    const top = Math.min(9000, hz * (2.5 + 5 * bright * vel)), sus = Math.min(7000, hz * (1.6 + 2.6 * bright * vel));
    f.frequency.setValueAtTime(hz * 0.9, t); f.frequency.exponentialRampToValueAtTime(top, t + a + 0.04); f.frequency.exponentialRampToValueAtTime(sus, t + a + 0.3);
    const pk = 0.075 * vel;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + a); g.gain.setTargetAtTime(pk * 0.78, t + a, 0.25);
    g.gain.setValueAtTime(pk * 0.78, t + Math.max(dur, a)); g.gain.exponentialRampToValueAtTime(0.0001, end);
    const oscs = [-6, 6].map(dt => { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = dt; o.connect(f); o.start(t); o.stop(end + 0.05); return o; });
    if (dur > 0.7) {
      const v = C.createOscillator(), vg = C.createGain();
      v.frequency.value = 5.2; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(0, t + 0.35); vg.gain.linearRampToValueAtTime(7, t + 0.8);
      v.connect(vg); for (const o of oscs) vg.connect(o.detune);
      v.start(t); v.stop(end + 0.05);
    }
    f.connect(g).connect(out || this.bus);
    this._send(g, rev);
  }
  // 弦乐：每个音三根略走音的锯齿波 → 低通，慢起慢收
  strings(notes, t, dur, { gain = 0.02, a = 0.6, rel = 1.2, cutoff = 1800, out } = {}) {
    const C = this.C, end = t + Math.max(dur, a) + rel;
    for (const m of notes) {
      const f = C.createBiquadFilter(), g = C.createGain();
      f.type = 'lowpass'; f.frequency.value = Math.min(cutoff, mtof(m) * 6); f.Q.value = 0.5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + a);
      g.gain.setValueAtTime(gain, t + Math.max(dur, a)); g.gain.exponentialRampToValueAtTime(0.0001, end);
      for (const dt of [-11, 0, 9]) { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = dt; o.connect(f); o.start(t); o.stop(end + 0.05); }
      f.connect(g).connect(out || this.bus);
      this._send(g, 0.7);
    }
  }
  // 合唱「啊」：锯齿波 + 颤音，过三个共振峰带通
  choir(notes, t, dur, { gain = 0.012, a = 0.9, rel = 1.4, out } = {}) {
    const C = this.C, end = t + Math.max(dur, a) + rel;
    for (const m of notes) {
      const o = C.createOscillator(), v = C.createOscillator(), vg = C.createGain(), g = C.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(m);
      v.frequency.value = 4.6 + Math.random() * 0.6; vg.gain.value = 12; v.connect(vg).connect(o.detune);
      for (const [fq, q, k] of [[720, 6, 1], [1150, 8, 0.55], [2650, 10, 0.3]]) {
        const bp = C.createBiquadFilter(), bg = C.createGain();
        bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q; bg.gain.value = k * 3.2;
        o.connect(bp).connect(bg).connect(g);
      }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + a);
      g.gain.setValueAtTime(gain, t + Math.max(dur, a)); g.gain.exponentialRampToValueAtTime(0.0001, end);
      g.connect(out || this.bus); this._send(g, 0.9);
      o.start(t); v.start(t); o.stop(end + 0.05); v.stop(end + 0.05);
    }
  }
  cello(m, t, dur, { gain = 0.06, out } = {}) {
    const C = this.C, f = C.createBiquadFilter(), g = C.createGain(), end = t + dur + 0.6;
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.18);
    g.gain.setValueAtTime(gain, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const [type, dt] of [['sawtooth', 4], ['triangle', 0]]) { const o = C.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = dt; o.connect(f); o.start(t); o.stop(end + 0.05); }
    f.connect(g).connect(out || this.bus); this._send(g, 0.4);
  }
  // 定音鼓：音高微微下滑的正弦 + 1.5 倍泛音 + 槌头噪声
  timp(m, t, vel, out, decay = 1.8) {
    const C = this.C, hz = mtof(m), O = out || this.bus;
    for (const [r, k, d] of [[1, 1, decay], [1.5, 0.35, decay * 0.45], [2.0, 0.12, decay * 0.3]]) {
      const o = C.createOscillator(), g = C.createGain();
      o.frequency.setValueAtTime(hz * r * 1.035, t); o.frequency.exponentialRampToValueAtTime(hz * r, t + 0.09);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42 * vel * k, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(O); this._send(g, 0.35);
      o.start(t); o.stop(t + d + 0.05);
    }
    this._hit(t, 0.06, 0.16 * vel, 'lowpass', 900, O);
  }
  timpRoll(m, t0, t1, v0, v1, out) {
    for (let t = t0, i = 0; t < t1; t += 0.058, i++) this.timp(m, t, v0 * Math.pow(v1 / v0, (t - t0) / (t1 - t0)) * (i % 2 ? 0.85 : 1), out, 0.7);
  }
  snare(t, vel, out) { this._hit(t, 0.12, vel, 'bandpass', 2300, out, 0.9); this._hit(t, 0.05, vel * 0.6, 'highpass', 6000, out); }
  snareRoll(t0, t1, v0, v1, out) {
    for (let t = t0; t < t1; t += 0.045) this._hit(t, 0.09, v0 * Math.pow(v1 / v0, (t - t0) / (t1 - t0)), 'bandpass', 2300, out, 0.9);
  }
  // 船钟：非整数倍泛音（含小三度那一条），长余音
  bell(t, m, vel, out) {
    const C = this.C, f0 = mtof(m), O = out || this.bus;
    for (const [r, k, d] of [[0.5, 0.35, 6], [1, 1, 4.5], [1.183, 0.5, 3], [1.506, 0.35, 2.4], [2, 0.3, 2], [2.514, 0.14, 1.4], [3.011, 0.08, 1]]) {
      const o = C.createOscillator(), g = C.createGain();
      o.frequency.value = f0 * r;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * vel * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(O); this._send(g, 1.1);
      o.start(t); o.stop(t + d + 0.05);
    }
    this._hit(t, 0.03, 0.08 * vel, 'highpass', 4000, O);
  }
  swell(t0, t1, peak, out) {
    const C = this.C, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain();
    s.buffer = this.noise; s.loop = true; f.type = 'highpass'; f.frequency.value = 5000;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t1); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.05);
    s.connect(f).connect(g).connect(out || this.bus); this._send(g, 0.6);
    s.start(t0, Math.random()); s.stop(t1 + 0.1);
  }
  crash(t, peak, dur, out) {
    this._hit(t, dur, peak, 'highpass', 4200, out, 0.6, 0.8);
    this._hit(t, dur * 0.5, peak * 0.6, 'bandpass', 7500, out, 1.2);
  }
  _hit(t, dur, gain, type, fq, out, q = 0.7, rev = 0.2) {
    const C = this.C, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.frequency.value = fq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out || this.bus); this._send(g, rev);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  _send(g, k) { if (!k || !this.rev) return; const s = this.C.createGain(); s.gain.value = k; g.connect(s).connect(this.rev); }
}
