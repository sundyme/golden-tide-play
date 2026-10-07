// 新手引导：鹦鹉铜板带路，边玩边学，每步只讲一件事。
// 表现：聚光圈（其余画面压暗）+ 手指示意 + 一张小卡片，台词由铜板说（有配音）。引导层不拦点击，玩家照常操作。
// 推进：前两步（投币 → 骷髅门）按顺序；之后的步骤等对应事件第一次发生时再讲（老虎机转起来、拿到道具、第一次进账、藏宝图落下）。
// 第一次转老虎机固定出船锚连线（送「金币雨」），让道具这一步在开局一分钟内就能讲到。
// 完成的步骤记进存档（main.js persist）；设置里可「重看新手引导」，URL 加 ?tutorial 强制重来。
import * as THREE from 'three';

const HAND = '<svg viewBox="0 0 64 84"><path d="M25 9a6.5 6.5 0 0 1 13 0v27l3.5-.8a6.3 6.3 0 0 1 7.4 4.4l1.8-.3a6.3 6.3 0 0 1 7.3 5.4l.6-.1a6 6 0 0 1 6.4 6v11.6C65 73 57 81 47 81h-7.6c-6 0-10.6-2.6-13.6-7.3L11.6 52.5a6.4 6.4 0 0 1 9.6-8.3L25 48z" fill="#fff7e3" stroke="#0b1f36" stroke-width="3.2" stroke-linejoin="round"/><path d="M38 40v12M50 44v9M60 50v6" stroke="#0b1f3655" stroke-width="2.6" stroke-linecap="round"/></svg>';

// spot：聚光目标；hand：'tap' 点按 / 'hold' 按住；dim：压暗程度（要玩家动手的步骤更暗）；auto：自动结束秒数
const STEPS = {
  tap: { n: 1, title: '投币', text: '点台面任意位置<br>金币就从那一列落下', say: '点一下台面，投币！嘎！', spot: 'table', hand: 'tap', dim: 0.62 },
  gate: { n: 2, title: '骷髅门', text: '金币穿过左右摆动的骷髅门<br>老虎机就转一次 · <b>按住</b>可以连投', say: '瞄准骷髅门，转老虎机！', spot: 'gate', hand: 'hold', dim: 0.5, timeout: 28 },
  slot: { n: 3, title: '老虎机', text: '5 条线，三个一样就中奖<br><b>鹦鹉</b>是百搭', say: '三个一样连成线，就中奖！', spot: 'reels', dim: 0.42 },
  queue: { n: 4, title: '待转次数', text: '金币每穿过一次骷髅门，这里就亮一颗<br>老虎机一次次转，最多攒 <b>3</b> 次', spot: 'spins', dim: 0.4, auto: 5 },
  item: { n: 5, title: '道具', text: '点一下就能用<br>金币雨：一大把金币落到台面', say: '拿到「金币雨」！点下面用！', spot: 'item', hand: 'tap', dim: 0.55, timeout: 20 },
  win: { n: 6, title: '收金币', text: '推下前沿、落进宝箱的金币都归你<br>从两侧掉进海里的就没了', say: '推下台边的金币，都归你啦！', spot: 'chest', dim: 0.4, auto: 4.5 },
  map: { n: 7, title: '藏宝图', text: '把碎片推下前沿收进宝箱<br>集齐 <b>5</b> 片，驶向金币岛！', say: '集齐五片藏宝图，就能找到金币岛！', spot: 'map', dim: 0.4, auto: 6 },
};
const ITEM_TIP = {
  coinrain: { name: '金币雨', text: '一大把金币落到台面' },
  guard: { name: '护栏', text: '两侧升起 20 秒，金币不再掉海' },
  giant: { name: '巨币', text: '一枚超重的大币，推力十足' },
};
const ORDER = Object.keys(STEPS);
export const TUTORIAL_STEPS = ORDER;
const TOTAL = ORDER.length;
const h = (tag, cls, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

export class Tutorial {
  constructor({ ui, view, game, done = [] }) {
    Object.assign(this, { ui, view, game });
    this.done = new Set(done.filter(k => STEPS[k]));
    this.pending = new Set();
    this.active = null; this.t = 0; this.wait = 0;
    this.spot = null;                       // 当前聚光（平滑跟随目标）
    this.won0 = false;                      // 第一次进账已经发生
    const root = this.el = h('div', '', '');
    root.id = 'tut';
    root.innerHTML = `<i class="dim"></i><i class="ring"></i><div class="hand">${HAND}</div>
      <div class="tcard enamel"><div class="tc-head"><span class="tc-n num"></span><b class="tc-title gold-text"></b></div><div class="tc-text"></div>
      <div class="tc-foot"><span class="tc-dots"></span><button class="tc-skip">跳过引导</button></div></div>`;
    ui.root.insertBefore(root, ui.el.bubble);   // 在鹦鹉气泡下面：铜板说话不被压暗
    this.$ = s => root.querySelector(s);
    this.$('.tc-skip').addEventListener('pointerdown', e => { e.stopPropagation(); this.skip(); });
    ui.tutActive = !this.finished;
  }

  get finished() { return ORDER.every(k => this.done.has(k)); }
  get saved() { return [...this.done]; }

  // 开始游戏后调用；已完成的玩家什么也不发生
  start() { if (!this.finished) { this.wait = 1.2; this.pending.add('tap'); } }

  reset() {
    this.done.clear(); this.pending.clear(); this._close(true);
    this.ui.tutActive = true; this.won0 = this.game.won > 0;
    this.start();
  }

  skip() { ORDER.forEach(k => this.done.add(k)); this.pending.clear(); this._close(true); this.ui.tutActive = false; this.onChange?.(); }

  onEvent(e) {
    if (this.finished) return;
    const need = k => !this.done.has(k);
    switch (e.type) {
      case 'drop': if (this.active === 'tap') this._finish(0.6, 'gate'); break;
      case 'gate':
        // 第一次过门：这一转固定出船锚连线（送金币雨）
        if (need('slot') && !this.game.forceResult) this.game.forceResult = 'anchor';
        if (this.active === 'gate') this._finish(0); else this.done.add('gate');
        break;
      case 'spinStart': if (need('slot')) this.pending.add('slot'); break;
      case 'slotResult': if (this.active === 'slot') this._finish(0.4); break;
      case 'itemGain': if (need('item')) this.pending.add('item'); break;
      case 'itemUse': if (this.active === 'item') this._finish(0.8); else this.done.add('item'); break;
      case 'payout': if (e.value > 0) this.won0 = true; break;
      case 'specialDrop': if (e.obj === 'map' && need('map')) this.pending.add('map'); break;
    }
  }

  update(dt) {
    if (this.finished && !this.active) return;
    const g = this.game, V = this.view;
    // 横幅（大潮 / 连线 / 道具……）占着画面中部时先收起引导卡，别压在横幅上
    const busy = V.director.mode !== 'play' || g.jackpot || g.ending || performance.now() < (this.ui.bannerUntil ?? 0);
    if (this.won0 && !this.done.has('win') && this.done.has('gate')) this.pending.add('win');
    if (!this.done.has('queue') && g.slot.queue > 0 && this.ui.el.spins.classList.contains('on')) this.pending.add('queue');
    this.wait -= dt;
    if (!this.active && !busy && this.wait <= 0) {
      const next = ORDER.find(k => this.pending.has(k) && !this.done.has(k));
      if (next) this._open(next);
    }
    if (!this.active) return;
    const S = STEPS[this.active];
    this.t += dt;
    this.el.classList.toggle('on', !busy);
    if (busy) return;
    if ((S.auto && this.t > S.auto) || (S.timeout && this.t > S.timeout)) { this._finish(0.4); return; }
    // 道具步骤：道具已经不在栏里（被别的途径用掉）就结束
    if (this.active === 'item' && !g.items.length) { this._finish(0.4); return; }
    const tgt = this._target(S.spot);
    if (!tgt) return;
    const s = this.spot ??= { ...tgt };
    const k = Math.min(1, dt * 10);
    for (const key of ['x', 'y', 'rx', 'ry']) s[key] += (tgt[key] - s[key]) * k;
    const st = this.el.style;
    st.setProperty('--x', s.x + 'px'); st.setProperty('--y', s.y + 'px');
    st.setProperty('--rx', s.rx + 'px'); st.setProperty('--ry', s.ry + 'px');
    st.setProperty('--dim', S.dim);
    // 手指：点在目标上，「骷髅门」这一步点在门正下方的台面上（那一列投下去正好过门）
    const hand = this.$('.hand');
    if (S.hand) { hand.style.left = (tgt.hx ?? s.x) + 'px'; hand.style.top = (tgt.hy ?? s.y) + 'px'; }
    // 卡片：优先放在目标下方（上方是鹦鹉和它的气泡），下方放不下才放上方；避开顶部 HUD 和底部道具栏
    const W = this.ui.root.clientWidth, H = this.ui.root.clientHeight, cq = W / 100;
    const card = this.$('.tcard'), ch = card.offsetHeight, bottom = H - ch - 30 * cq;
    const below = s.y + s.ry + (S.hand ? 12 : 5) * cq;
    let y = below <= bottom ? below : s.y - s.ry - 5 * cq - ch;
    y = Math.max(30 * cq, Math.min(bottom, y));
    card.style.transform = `translate(-50%, ${y}px)`;
  }

  _open(k) {
    let S = STEPS[k];
    if (k === 'item') { const it = ITEM_TIP[this.game.items[this.game.items.length - 1]] ?? ITEM_TIP.coinrain; S = { ...S, text: `点一下就能用${matchMedia('(pointer: fine)').matches ? '（键盘 1 / 2 / 3）' : ''}<br>${it.name}：${it.text}`, say: `拿到「${it.name}」！点下面用！` }; }
    this.active = k; this.t = 0; this.spot = null;
    this.pending.delete(k);
    this.$('.tc-n').textContent = `${S.n}/${TOTAL}`;
    this.$('.tc-title').textContent = S.title;
    this.$('.tc-text').innerHTML = S.text;
    this.$('.tc-dots').innerHTML = ORDER.map(o => `<i class="${this.done.has(o) ? 'ok' : o === k ? 'cur' : ''}"></i>`).join('');
    const hand = this.$('.hand');
    hand.className = 'hand' + (S.hand ? ' ' + S.hand : '');
    this.el.className = 'on step-' + k;
    const card = this.$('.tcard'); card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    const b = this.ui.el.bubble;
    if (S.say && !(this.ui.bubbleT > 0 && b.textContent === S.say)) this.ui.say(S.say, 3, 3.6);   // 道具步骤：UI 刚说过同一句就不重复
  }

  _finish(delay, then) {
    if (!this.active) return;
    this.done.add(this.active);
    this._close();
    this.wait = Math.max(this.wait, delay);
    if (then && !this.done.has(then)) this.pending.add(then);
    if (this.finished) this.ui.tutActive = false;
    this.onChange?.();
  }

  _close(hard) { this.active = null; this.spot = null; this.el.classList.remove('on'); if (hard) this.wait = 0; }

  // 聚光目标（UI 根节点坐标，px）
  _target(k) {
    const V = this.view, W = this.ui.root.clientWidth, cq = W / 100;
    const P = (x, y, z) => V.toScreen(new THREE.Vector3(x, y, z));
    const dom = el => { const r = this.ui.root.getBoundingClientRect(), b = el.getBoundingClientRect(); return { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top, rx: b.width / 2 + 3 * cq, ry: b.height / 2 + 3 * cq }; };
    switch (k) {
      case 'table': { const p = P(0, 0.4, 0.6); return { ...p, rx: 38 * cq, ry: 17 * cq }; }
      case 'gate': {
        const gp = V.machine.gateGroup.getWorldPosition(new THREE.Vector3()), p = V.toScreen(gp), q = P(gp.x, 0.4, 1.2);
        return { ...p, rx: 12 * cq, ry: 9 * cq, hx: q.x, hy: q.y };
      }
      case 'reels': {
        const c = new THREE.Vector3(), v = new THREE.Vector3();
        V.machine.reels.forEach(r => c.add(r.getWorldPosition(v)));
        const p = V.toScreen(c.divideScalar(V.machine.reels.length || 1));
        return { ...p, rx: 25 * cq, ry: 14 * cq };
      }
      case 'spins': return dom(this.ui.el.spins);
      case 'item': { const s = this.ui.el.slots.find(s => s.classList.contains('full')) ?? this.ui.el.slots[0]; return dom(s); }
      case 'chest': { const p = V.chestScreen(); return { x: p.x, y: p.y + 2 * cq, rx: 22 * cq, ry: 14 * cq }; }
      case 'map': {
        const m = this.game.sim.coins.find(c => c.kind === 'map');
        if (m) { const t = m.body.translation(); if (t.y > -1.5) return { ...P(t.x, t.y, t.z), rx: 13 * cq, ry: 11 * cq }; }
        return dom(this.ui.el.mapsBar);
      }
    }
    return null;
  }
}
