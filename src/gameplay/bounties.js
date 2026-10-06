// 悬赏令：每次航行发 3 条小目标（简单 / 中等 / 困难各一），完成就盖章发奖。
// 规则层（无 DOM），浏览器与无头机器人共用：机器人会把整个题库的进度都记下来，用来调难度。
//
// 进度有两种：count 累加（推落、过门……），max 取本次航行里的最大值（连击、一次大潮里推落多少……）。
// 题库里每一条都在后台一直统计，玩家只看到抽中的 3 条。

export const BOUNTY_POOL = [
  // 简单（机器人：两种风格第一次航行都 100% 达标，中位 1.5–4 分钟）
  { key: 'lines', tier: 0, goal: 3, kind: 'count', text: g => `老虎机连成 ${g} 条线`, family: 'lines' },
  { key: 'gates', tier: 0, goal: 40, kind: 'count', text: g => `金币穿过骷髅门 ${g} 次` },
  { key: 'won', tier: 0, goal: 250, kind: 'count', text: g => `本次航行推落 ${g} 枚` },
  // 中等（开局台面会连着塌一波，连击 / 过门目标要定高一点）
  { key: 'combo', tier: 1, goal: 30, kind: 'max', text: g => `连击达到 ${g}`, family: 'combo' },
  { key: 'surgeCoins', tier: 1, goal: 35, kind: 'max', text: g => `一次大潮里推落 ${g} 枚` },
  { key: 'gateRush', tier: 1, goal: 6, kind: 'max', text: g => `8 秒内过门 ${g} 次` },
  { key: 'gems', tier: 1, goal: 1, kind: 'count', text: g => `推落 ${g} 颗宝石` },
  { key: 'kegLit', tier: 1, goal: 1, kind: 'count', text: g => `亲手点爆 ${g} 个火药桶` },
  { key: 'surgeItem', tier: 1, goal: 1, kind: 'count', text: () => '大潮期间亲手使用道具' },
  // 困难
  { key: 'jackpot', tier: 2, goal: 1, kind: 'count', text: () => '触发一次骷髅 Jackpot' },
  { key: 'combo2', tier: 2, goal: 40, kind: 'max', text: g => `连击达到 ${g}`, family: 'combo' },
  { key: 'lines2', tier: 2, goal: 8, kind: 'count', text: g => `老虎机连成 ${g} 条线`, family: 'lines' },
  { key: 'itemCoins', tier: 2, goal: 70, kind: 'max', text: g => `一次道具生效期间推落 ${g} 枚` },
];
export const BOUNTY_BY_KEY = Object.fromEntries(BOUNTY_POOL.map(d => [d.key, d]));
const ITEM_WINDOW = 20;   // 道具生效窗口（秒）：金币雨 / 护栏 / 巨币之后这段时间里推落的都算

export class BountyBoard {
  constructor(game) {
    this.game = game;
    this.list = [];        // 本次航行抽中的 3 条：{ key, goal, n, done }
    this.reset();
    game.on(e => this._onEvent(e));
  }

  // 新航行：清进度、重新抽 3 条（每档一条，同一家族——比如两档连击——不同时出现）
  reset() {
    this.p = Object.fromEntries(BOUNTY_POOL.map(d => [d.key, 0]));
    this.at = {};          // 每条第一次达标的游戏时间（机器人调难度用）
    this.surgeAcc = 0; this.itemAcc = 0; this.itemUntil = -1; this.gateTimes = []; this.litIds = new Set();
    const rng = this.game.rng, picked = [];
    for (const tier of [0, 1, 2]) {
      const opts = BOUNTY_POOL.filter(d => d.tier === tier && !picked.some(p => p.family && p.family === d.family));
      picked.push(opts[rng() * opts.length | 0]);
    }
    this.list = picked.map(d => ({ key: d.key, goal: d.goal, n: 0, done: false }));
  }

  get doneCount() { return this.list.filter(b => b.done).length; }

  _bump(key, v, max = false) {
    const p = this.p, g = this.game;
    p[key] = max ? Math.max(p[key], v) : p[key] + v;
    if (this.at[key] === undefined && p[key] >= BOUNTY_BY_KEY[key].goal) this.at[key] = g.time - g.voyage.t0;
    for (const [i, b] of this.list.entries()) {
      if (b.key !== key || b.done) continue;
      const n = Math.min(b.goal, p[key]);
      if (n === b.n) continue;
      b.n = n;
      if (n >= b.goal) { b.done = true; g._bountyReward(i, b); } else g.emit('bountyProgress', { i, key, n, goal: b.goal });
    }
  }

  _onEvent(e) {
    const g = this.game;
    if (g.ending && e.type !== 'endingDone') return;   // 抵达金币岛后的宝箱金币不算
    switch (e.type) {
      case 'slotResult': if (e.lines.length) { this._bump('lines', e.lines.length); this._bump('lines2', e.lines.length); } break;
      case 'gate': this._bump('gates', 1); { const T = this.gateTimes; T.push(g.time); while (T[0] < g.time - 8) T.shift(); this._bump('gateRush', T.length, true); } break;
      case 'payout': {
        if (e.value <= 0) break;
        if (e.obj === 'gem') this._bump('gems', 1);
        if (e.obj === 'coin' || e.obj === 'giant') this._bump('won', e.value);
        this._bump('combo', e.combo, true); this._bump('combo2', e.combo, true);
        if (g.surgeT > 0) { this.surgeAcc += e.value; this._bump('surgeCoins', this.surgeAcc, true); }
        if (g.time < this.itemUntil) { this.itemAcc += e.value; this._bump('itemCoins', this.itemAcc, true); }
        break;
      }
      case 'surgeStart': this.surgeAcc = 0; break;
      case 'itemUse': this.itemAcc = 0; this.itemUntil = g.time + ITEM_WINDOW; if (g.surgeT > 0 && !e.auto) this._bump('surgeItem', 1); break;
      case 'kegLit': if (!e.auto) this.litIds.add(e.id); break;
      case 'kegBoom': if (this.litIds.has(e.id)) { this.litIds.delete(e.id); this._bump('kegLit', 1); } break;
      case 'jackpotStart': this._bump('jackpot', 1); break;
    }
  }

  serialize() { return { list: this.list, p: this.p }; }
  restore(d) {
    if (!d?.list?.length || !d.list.every(b => BOUNTY_BY_KEY[b.key])) return;
    this.list = d.list.map(b => ({ key: b.key, goal: b.goal, n: b.n, done: b.done }));
    Object.assign(this.p, d.p);
  }
}
