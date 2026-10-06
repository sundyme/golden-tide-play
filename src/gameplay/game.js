// 游戏规则层（无 DOM、无 three）：钱包、骷髅门 → 老虎机、道具、特殊物件、潮汐 / 大潮、Jackpot、藏宝图终局。
// 浏览器与无头机器人（tools/bot.mjs）共用。每个物理步调用一次 update(dt)，全部计时用游戏时间。
// 表现层（画面 / 音频 / UI）只订阅这里发出的事件，不反向修改规则。
import { mulberry32 } from '../physics/pusher.js';

export const SYMBOLS = ['skull', 'gem', 'keg', 'anchor', 'parrot', 'coins'];
// 九宫格坐标 grid[列][行]（行 0 = 上）；5 条线：上 / 中 / 下 / 左上→右下 / 左下→右上
export const LINES = [[[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]], [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]]];
const WILD = 'parrot', SCATTER = 'coins';

// 一条线的结果：三格（百搭可替代）同为某符号 → 该符号；含金币堆或不成线 → null
export function lineSymbol(cells) {
  if (cells.includes(SCATTER)) return null;
  const base = cells.filter(c => c !== WILD);
  if (!base.length) return WILD;
  return base.every(c => c === base[0]) ? base[0] : null;
}
export function evaluateGrid(grid) {
  const lines = [];
  LINES.forEach((L, i) => {
    const cells = L.map(([c, r]) => grid[c][r]);
    const sym = lineSymbol(cells);
    if (sym) lines.push({ i, symbol: sym, wild: sym !== WILD && cells.includes(WILD) });
  });
  const flat = grid.flat();
  return { lines, coins: flat.filter(c => c === SCATTER).length, parrots: flat.filter(c => c === WILD).length };
}

export class Game {
  constructor(sim, config, { rng = Math.random } = {}) {
    this.sim = sim; this.cfg = config; this.rng = rng;
    const P = config.play;
    this.wallet = P.startCoins;
    this.won = 0; this.lost = 0; this.spent = 0; this.bonus = 0;
    this.refillT = 0;
    this.tide = 0; this.surgeT = 0; this.surgeK = 0;
    this.guardT = 0;
    this.items = [];                 // 'coinrain' | 'guard' | 'giant'
    this.mapPieces = 0; this.mapOnTable = 0; this.nextMapT = config.map.firstAt;
    this.combo = 0; this.comboT = 0;
    this.slot = { queue: 0, state: 'idle', t: 0, result: null, grid: [['coins', 'skull', 'coins'], ['gem', 'coins', 'anchor'], ['coins', 'parrot', 'coins']], stops: [] };
    this.jackpot = null; this.ending = null;
    this.timeScale = 1;
    this.time = 0;
    this.stats = { gates: 0, spins: 0, results: {}, gems: 0, kegs: 0, kegBooms: 0, maps: 0, mapsLost: 0, surges: 0, jackpots: 0, items: {}, endings: 0, endingAt: null, payoutBySource: {} };
    this.listeners = [];
    this.scheduled = [];             // [{ t, fn }]
    sim.on(e => this._onPhysics(e));
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { const e = { type, t: this.time, ...data }; for (const fn of this.listeners) fn(e); }
  after(sec, fn) { this.scheduled.push({ t: this.time + sec, fn }); }

  // ---------- 玩家操作 ----------
  canDrop() { return this.wallet > 0 && !this.ending?.lock; }
  drop(x) {
    if (!this.canDrop()) return false;
    this.wallet--; this.spent++;
    const c = this.sim.dropCoin(x);
    this._addTide(this.cfg.tide.perCoin);
    this.emit('drop', { x, coin: c });
    return true;
  }

  // 鹦鹉的谢礼：被戳够次数后吐出几枚金币（有冷却）；成功返回 true
  parrotGift() {
    const P = this.cfg.parrot;
    if (this.ending?.lock || this.time < (this.giftReadyT ?? 0)) return false;
    this.giftReadyT = this.time + P.giftCooldown;
    for (let k = 0; k < P.giftCoins; k++) this.after(0.25 + k * 0.12, () => this.sim.spawnCoin(P.from[0], P.from[1], P.from[2], {
      vel: { x: P.vel[0] + this.rng() * 0.8, y: P.vel[1] + this.rng(), z: P.vel[2] + (this.rng() - 0.5) * 1.2 }, tiltX: this.rng(), tiltZ: this.rng(),
    }));
    this.emit('parrotGift', { n: P.giftCoins });
    return true;
  }

  useItem(i, x = 0) {
    const it = this.items[i];
    if (!it) return false;
    this.items.splice(i, 1);
    this.stats.items[it] = (this.stats.items[it] || 0) + 1;
    const M = this.cfg.machine;
    if (it === 'coinrain') {
      const n = this.cfg.items.coinRain;
      for (let k = 0; k < n; k++) this.after(k * 0.07, () => this.sim.spawnCoin((this.rng() * 2 - 1) * (M.width / 2 - 0.7), M.dropY + this.rng() * 1.5, -4.6 + this.rng() * 2.4, { tiltX: this.rng(), tiltZ: this.rng() }));
    } else if (it === 'guard') {
      this.guardT = this.cfg.items.guardSeconds;
      this.sim.setGuards(true);
    } else if (it === 'giant') {
      this.sim.dropSpecial('giant', x);
    }
    this.emit('itemUse', { item: it, x });
    return true;
  }

  // ---------- 每个物理步 ----------
  update(dt) {
    this.time += dt;
    const P = this.cfg.play, T = this.cfg.tide;

    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (this.time >= this.scheduled[i].t) { const s = this.scheduled[i]; this.scheduled.splice(i, 1); s.fn(); }
    }

    // 币用完：缓慢补币
    if (this.wallet <= 0) {
      this.refillT += dt;
      if (this.refillT >= P.refillEvery) { this.refillT = 0; if (this.wallet < P.refillCap) { this.wallet++; this.emit('refill'); } }
    } else this.refillT = 0;

    // 连击计时
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { if (this.combo >= 3) this.emit('comboEnd', { n: this.combo }); this.combo = 0; } }

    // 大潮
    if (this.surgeT > 0) {
      this.surgeT -= dt;
      if (this.surgeT <= 0) { this.surgeT = 0; this.emit('surgeEnd'); }
    }
    const target = this.surgeT > 0 ? Math.min(1, (T.surgeSeconds - this.surgeT) / 0.8, this.surgeT / 1.2) : 0;
    this.surgeK = target;
    this.sim.tilt = T.surgeTiltDeg * target;
    this.sim.pusherSpeed = 1 + (T.surgePusherSpeed - 1) * target;

    // 护栏
    if (this.guardT > 0) { this.guardT -= dt; if (this.guardT <= 0) { this.guardT = 0; this.sim.setGuards(false); this.emit('guardEnd'); } }

    this._updateSlot(dt);
    this._updateMap();
  }

  // ---------- 物理事件 ----------
  _onPhysics(e) {
    if (e.type === 'gate') {
      this.stats.gates++;
      this._addTide(this.cfg.tide.perGate);
      const full = this.slot.queue >= this.cfg.slot.maxQueue;   // 已经攒满 3 次：这次过门不加
      if (!full) this.slot.queue++;
      this.emit('gate', { x: e.x, queue: this.slot.queue, full });
      return;
    }
    if (e.type !== 'coinOut') return;
    const obj = e.obj, front = e.kind === 'front';
    if (front) {
      let v = this.cfg.payout[obj] ?? 0;
      if (obj === 'keg') this._kegBoom(e.x);
      if (obj === 'map') { this.mapPieces++; this.mapOnTable--; this.stats.maps++; this.emit('mapCollected', { n: this.mapPieces }); if (this.mapPieces >= this.cfg.map.pieces) this.after(1.2, () => this._startEnding()); }
      if (obj === 'gem') this.stats.gems++;
      if (v > 0) {
        this.wallet += v; this.won += v;
        this.stats.payoutBySource[obj] = (this.stats.payoutBySource[obj] || 0) + v;
        this.combo++; this.comboT = this.cfg.play.comboWindow;
      }
      this.emit('payout', { obj, value: v, x: e.x, combo: this.combo, coin: e.coin });
    } else {
      if (obj === 'coin' || obj === 'giant') this.lost++;
      if (obj === 'map') { this.mapOnTable--; this.stats.mapsLost++; this.nextMapT = Math.min(this.nextMapT, this.time + this.cfg.map.respawnAfterLost); }
      this.emit('lost', { obj, x: e.x, coin: e.coin });
    }
  }

  _kegBoom(x) {
    const M = this.cfg.machine, S = this.cfg.specials;
    this.stats.kegBooms++;
    const p = { x: Math.max(-M.width / 2 + 1, Math.min(M.width / 2 - 1, x)), y: 0.3, z: M.tableFrontZ - 0.9 };
    const n = this.sim.explode(p.x, p.y, p.z, S.kegBlastRadius, S.kegBlastStrength);
    this.emit('kegBoom', { ...p, n });
  }

  _addTide(v) {
    if (this.surgeT > 0 || this.jackpot) return;
    this.tide = Math.min(1, this.tide + v);
    if (this.tide >= 1) { this.tide = 0; this._startSurge(); }
  }

  _startSurge() {
    this.surgeT = this.cfg.tide.surgeSeconds;
    this.stats.surges++;
    this.emit('surgeStart');
  }

  // ---------- 老虎机（3×3） ----------
  _rollCell() {
    const W = this.cfg.slot.cells;
    let r = this.rng() * Object.values(W).reduce((a, b) => a + b, 0);
    for (const [k, w] of Object.entries(W)) if ((r -= w) < 0) return k;
    return SCATTER;
  }
  _rollGrid() { return [0, 1, 2].map(() => [0, 1, 2].map(() => this._rollCell())); }

  // 调试 / 截图用：造一个指定结果的盘面（随机重抽直到结果恰好符合）
  _forcedGrid(kind) {
    const want = g => {
      const e = evaluateGrid(g), C = this.cfg.slot, n = e.lines.length;
      if (kind === 'none') return !n && !C.coinPay[e.coins] && e.parrots < C.parrotGuard;
      if (kind === 'coins') return !n && e.coins === 8 && e.parrots < C.parrotGuard;
      if (kind === 'coins9') return e.coins === 9;
      if (kind === 'guard') return !n && e.parrots >= C.parrotGuard;
      if (kind === 'multi') return n >= 2 && !e.lines.some(l => l.symbol === 'skull');
      return n === 1 && e.lines[0].symbol === kind && (kind === WILD || e.parrots < C.parrotGuard);
    };
    for (let k = 0; k < 4000; k++) {
      const g = this._rollGrid();
      if (kind === 'coins9') g.forEach(col => col.fill(SCATTER));
      else if (kind === 'coins') { g.forEach(col => col.fill(SCATTER)); g[this.rng() * 3 | 0][this.rng() * 3 | 0] = SYMBOLS[this.rng() * 4 | 0]; }
      else if (SYMBOLS.includes(kind)) { const L = LINES[this.rng() * 5 | 0]; L.forEach(([c, r]) => { g[c][r] = kind === WILD || this.rng() < 0.8 ? kind : WILD; }); }
      else if (kind === 'multi') { const s = ['gem', 'keg', 'anchor'][this.rng() * 3 | 0]; [LINES[0], LINES[3]].forEach(L => L.forEach(([c, r]) => { g[c][r] = s; })); }
      else if (kind === 'guard') { [[0, 0], [1, 2], [2, 1]].forEach(([c, r]) => { g[c][r] = WILD; }); }
      if (want(g)) return g;
    }
    return this._rollGrid();
  }

  // 前两列停下后，第三列还"有戏"才慢停：大奖（骷髅 / 宝石）某条线差最后一格，或金币堆前两列已有 6 个（差一个就满 7）。
  // 只挑大奖：九宫格里"任意线差一格"超过一半的转动都会满足，慢停就不再有悬念、还拖慢节奏
  _tease(g) {
    if (LINES.some(L => ['skull', 'gem'].includes(lineSymbol([g[L[0][0]][L[0][1]], g[L[1][0]][L[1][1]], WILD])))) return true;
    return [...g[0], ...g[1]].filter(c => c === SCATTER).length >= 6;
  }

  _updateSlot(dt) {
    const S = this.slot, C = this.cfg.slot;
    if (S.state === 'idle') {
      if (S.queue > 0 && !this.jackpot && !this.ending) {
        S.queue--;
        const forced = this.forceResult; this.forceResult = null;
        S.grid = forced ? this._forcedGrid(forced) : this._rollGrid();
        S.eval = evaluateGrid(S.grid);
        const tease = this._tease(S.grid);
        S.stops = [C.stop1, C.stop2, C.stop3 + (tease ? C.tease : 0)];
        S.t = 0; S.state = 'spin'; S.stopped = 0;
        this.stats.spins++;
        this.emit('spinStart', { grid: S.grid, stops: S.stops, queue: S.queue, tease });
      }
      return;
    }
    S.t += dt;
    if (S.state === 'spin') {
      while (S.stopped < 3 && S.t >= S.stops[S.stopped]) {
        this.emit('reelStop', { i: S.stopped, column: S.grid[S.stopped] });
        S.stopped++;
      }
      if (S.stopped === 3) { S.state = 'show'; S.t = 0; this._resolve(S.eval); }
    } else if (S.state === 'show' && S.t >= C.showSeconds) S.state = 'idle';
  }

  _resolve(ev) {
    const C = this.cfg.slot, T = this.cfg.tide, M = this.cfg.machine;
    const giveItem = it => {
      if (this.items.length < this.cfg.items.max) { this.items.push(it); this.emit('itemGain', { item: it, slot: this.items.length - 1 }); }
      else this.useItem(0) && this.items.push(it);   // 道具栏满：自动用掉最早的，新道具入栏
    };
    const dropCoins = n => { for (let k = 0; k < n; k++) this.after(0.12 * k, () => this.sim.dropCoin((this.rng() * 2 - 1) * M.dropXRange)); this.bonus += n; };
    const syms = ev.lines.map(l => l.symbol);
    let jackpot = false, guard = false;
    for (const s of syms) {
      if (s === 'skull') jackpot = true;
      else if (s === 'gem') { this.sim.dropSpecial('gem'); this.emit('specialDrop', { obj: 'gem' }); }
      else if (s === 'keg') { this.sim.dropSpecial('keg'); this.stats.kegs++; this.emit('specialDrop', { obj: 'keg' }); }
      else if (s === 'anchor') giveItem('coinrain');
      else if (s === WILD) guard = true;
    }
    if (ev.parrots >= C.parrotGuard) guard = true;
    if (guard) giveItem('guard');
    const multi = ev.lines.length >= 2;
    if (multi) { giveItem('giant'); dropCoins(C.multiBonus * (ev.lines.length - 1)); }
    const coinPay = C.coinPay[ev.coins] ?? 0;
    if (coinPay) dropCoins(coinPay);
    // 汇总一个"头条"结果（统计 / 横幅 / 音效用）
    const result = jackpot ? 'skull' : multi ? 'multi' : syms[0] ?? (guard ? 'guard' : coinPay ? (ev.coins === 9 ? 'coins9' : 'coins') : 'none');
    this.stats.results[result] = (this.stats.results[result] || 0) + 1;
    this._addTide(ev.lines.length * T.perTriple + (coinPay || (guard && !syms.includes(WILD)) ? T.perPair : 0));
    this.emit('slotResult', { result, lines: ev.lines, coins: ev.coins, coinPay, parrots: ev.parrots, guard, multi, bonus: multi ? C.multiBonus * (ev.lines.length - 1) : 0, grid: this.slot.grid });
    if (jackpot) this.after(0.6, () => this._startJackpot());   // 先让连线亮一下再进 Jackpot
  }

  // ---------- Jackpot ----------
  _startJackpot() {
    const J = this.cfg.jackpot, M = this.cfg.machine;
    this.stats.jackpots++;
    this.jackpot = { t0: this.time };
    this.timeScale = J.slowmo;
    this.emit('jackpotStart');
    this.after(J.slowmoSeconds * J.slowmo, () => { this.timeScale = 1; this.emit('jackpotCannons'); });
    // 宝箱两侧的船炮朝台面喷金币
    const t0 = J.slowmoSeconds * J.slowmo + 0.5;
    for (let k = 0; k < J.cannonCoins; k++) {
      const s = k % 2 ? 1 : -1;
      this.after(t0 + k * 0.06, () => {
        const tx = (this.rng() * 2 - 1) * (M.width / 2 - 1.2), tz = -1.5 + this.rng() * 4.2;
        const [fx, fy, fz] = J.cannonFrom; const from = { x: s * fx, y: fy, z: fz };
        const v = ballistic(from, { x: tx, y: 0.4, z: tz }, 1.0, this.cfg.physics.gravity);   // 炮在船头甲板上：弧线要高过台面前沿
        this.sim.spawn('coin', from.x, from.y, from.z, { vel: v, fly: 1.2, angvel: { x: this.rng() * 20 - 10, y: 0, z: this.rng() * 20 - 10 } });
        this.emit('cannonFire', { side: s, k });
      });
    }
    this.after(t0 + J.cannonCoins * 0.06 + 0.3, () => this.emit('jackpotTitle'));
    // 金币瀑布：从投币口一排倾泻
    const t1 = t0 + J.cannonCoins * 0.06 + 0.9;
    for (let k = 0; k < J.waterfallCoins; k++) this.after(t1 + k * 0.05, () => this.sim.spawnCoin((this.rng() * 2 - 1) * (M.width / 2 - 0.7), M.dropY + this.rng(), M.dropZ + 0.6 + this.rng() * 1.5, { tiltX: this.rng() * 2, tiltZ: this.rng() }));
    const t2 = t1 + J.waterfallCoins * 0.05 + 0.6;
    this.after(t2, () => { this.wallet += J.bonus; this.won += J.bonus; this.bonus += J.bonus; this.emit('jackpotCount', { value: J.bonus }); });
    this.after(t2 + 2.6, () => { this.jackpot = null; this.emit('jackpotEnd'); });
  }

  // ---------- 藏宝图与终局 ----------
  _updateMap() {
    const Mp = this.cfg.map;
    if (this.ending) return;
    if (this.time >= this.nextMapT && this.mapPieces + this.mapOnTable < Mp.pieces) {
      this.sim.dropSpecial('map', (this.rng() * 2 - 1) * Mp.dropX);   // 靠中间落下，少一点直接被推进海里
      this.mapOnTable++;
      this.nextMapT = this.time + Mp.every[0] + this.rng() * (Mp.every[1] - Mp.every[0]);
      this.emit('specialDrop', { obj: 'map' });
    }
  }

  _startEnding() {
    if (this.ending) return;
    const E = this.cfg.ending, M = this.cfg.machine;
    this.ending = { t0: this.time, lock: false };
    this.stats.endings++;
    if (this.stats.endingAt === null) this.stats.endingAt = this.time;
    this.emit('endingStart');
    // 驶向金币岛（表现层做天色 / 海色转场），然后巨型宝箱翻倒在台面上
    this.after(E.sailSeconds, () => this.emit('giantChest'));
    this.after(E.sailSeconds + E.chestTipDelay, () => {
      for (let k = 0; k < E.chestCoins; k++) this.after(k * 0.025, () => {
        const x = (this.rng() * 2 - 1) * (M.width / 2 - 0.8);
        this.sim.spawn(k % 23 === 0 ? 'gem' : 'coin', x, 5 + this.rng() * 2.5, -3.2 + this.rng() * 3.5, { vel: { x: (this.rng() - 0.5) * 3, y: -2, z: 2 + this.rng() * 3 }, angvel: { x: this.rng() * 12, y: 0, z: this.rng() * 12 } });
      });
      this.emit('chestPour');
    });
    this.after(E.sailSeconds + E.chestTipDelay + E.cardDelay, () => this.emit('endingCard', { won: this.won, spent: this.spent, time: this.time }));
  }

  // 结局卡关闭后继续玩：藏宝图重置
  continueAfterEnding() {
    this.ending = null; this.mapPieces = 0; this.nextMapT = this.time + this.cfg.map.firstAt;
    this.emit('endingDone');
  }

  // ---------- 调试：一键触发（只给调试面板 / 截图脚本用） ----------
  debug(what, arg) {
    switch (what) {
      case 'slot': this.forceResult = arg; this.slot.queue = Math.max(1, this.slot.queue); break;
      case 'surge': if (this.surgeT <= 0) this._startSurge(); break;
      case 'jackpot': if (!this.jackpot) this._startJackpot(); break;
      case 'map': this.sim.dropSpecial('map', 0); this.mapOnTable++; this.emit('specialDrop', { obj: 'map' }); break;
      case 'mapPiece': this.mapPieces++; this.emit('mapCollected', { n: this.mapPieces }); if (this.mapPieces >= this.cfg.map.pieces) this.after(1.2, () => this._startEnding()); break;
      case 'ending': this.mapPieces = this.cfg.map.pieces; this._startEnding(); break;
      case 'item': if (this.items.length < this.cfg.items.max) { this.items.push(arg); this.emit('itemGain', { item: arg, slot: this.items.length - 1 }); } break;
      case 'coins': this.wallet += arg; break;
    }
  }

  // ---------- 存档 ----------
  serialize() {
    return { v: 1, wallet: this.wallet, won: this.won, lost: this.lost, spent: this.spent, tide: this.tide, items: this.items, mapPieces: this.mapPieces };
  }
  restore(d) {
    if (!d || d.v !== 1) return;
    Object.assign(this, { wallet: d.wallet, won: d.won, lost: d.lost, spent: d.spent, tide: d.tide, items: d.items.slice(0, this.cfg.items.max), mapPieces: Math.min(d.mapPieces, this.cfg.map.pieces - 1) });
  }
}

// 从 from 打到 to、飞行时间 T 的初速度
function ballistic(from, to, T, g) {
  return { x: (to.x - from.x) / T, y: (to.y - from.y) / T + 0.5 * g * T, z: (to.z - from.z) / T };
}

export { mulberry32 };
