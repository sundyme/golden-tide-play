// UI 层：钱包木牌、藏宝图进度、道具栏、横幅、飘字、鹦鹉气泡、开始 / 设置 / 结局卷轴。
// 只订阅游戏事件 + 每帧读取少量状态；操作通过 handlers 回调交给 main。
import { BOUNTY_BY_KEY } from '../gameplay/bounties.js';

const UI = './public/assets/ui/';
const ITEM = {
  coinrain: { img: 'pw_coinrain.webp', name: '金币雨' },
  guard: { img: 'pw_shield.webp', name: '护栏' },
  giant: { img: 'pw_bigcoin.webp', name: '巨币' },
};
const GEAR = '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';

// 面板顶部的日芒徽章（装饰艺术扇形：金色放射线 + 珐琅半圆 + 中心金章）
const CREST = '<svg class="crest" viewBox="0 0 120 60"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c8"/><stop offset=".55" stop-color="#e0bc76"/><stop offset="1" stop-color="#8e6a30"/></linearGradient></defs>'
  + Array.from({ length: 13 }, (_, i) => { const a = Math.PI * (i / 12), x = 60 - Math.cos(a) * 58, y = 56 - Math.sin(a) * 52; return `<line x1="60" y1="56" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="url(#cg)" stroke-width="${i % 2 ? 1.4 : 2.6}"/>`; }).join('')
  + '<path d="M28 56a32 32 0 0 1 64 0z" fill="#0b1f36" stroke="url(#cg)" stroke-width="3"/><path d="M38 56a22 22 0 0 1 44 0" fill="none" stroke="#d9b46a99" stroke-width="1.2"/><circle cx="60" cy="44" r="7" fill="url(#cg)" stroke="#0b1f36" stroke-width="1.5"/><path d="M14 57h92" stroke="url(#cg)" stroke-width="3" stroke-linecap="round"/></svg>';

// 玩法说明（设置 → 玩法说明）：目标 → 操作 → 老虎机符号表 → 道具 → 其它
const sym = (k, t, d) => `<div class="sym"><img src="${UI}sym_${k}.webp" alt=""><b>${t}</b><span>${d}</span></div>`;
const HOWTO = `
  <div class="goal"><img src="${UI}icon_map.webp" alt=""><p><b>目标</b>集齐 5 片藏宝图，驶向金币岛</p></div>
  <h3>投币</h3>
  <p>点台面任意位置，金币就从那一列落下；<b>按住</b>连投（键盘：空格）。推板来回推，被推下前沿、落进宝箱的金币归你，从两侧掉进海里的就没了。</p>
  <h3>骷髅门 → 老虎机</h3>
  <p>投币口下方的骷髅门左右摆动，金币<b>穿过门</b>老虎机就转一次（最多攒 3 次）。九宫格 5 条线：3 横 + 2 斜，三个一样就中奖。</p>
  <div class="syms">
    ${sym('skull', '骷髅', 'JACKPOT：船炮金雨 + 金币瀑布')}
    ${sym('gem', '宝石', '落下大宝石，推下去得 20 枚')}
    ${sym('keg', '火药桶', '点它点火，3 秒后朝前沿炸开，还会崩出金币进宝箱')}
    ${sym('anchor', '船锚', '道具「金币雨」')}
    ${sym('parrot', '鹦鹉', '百搭；盘面 3 只以上送「护栏」')}
    ${sym('coins', '金币堆', '不连线，数个数：7 / 8 / 9 个 → +2 / +6 / +30 枚')}
  </div>
  <p class="note2">一转中两条线以上，再送道具「巨币」。</p>
  <h3>道具（最多 3 个，点击或按 1 / 2 / 3）</h3>
  <div class="syms items">
    <div class="sym"><img src="${UI}pw_coinrain.webp" alt=""><b>金币雨</b><span>船炮朝天齐射，一大把金币落到台面</span></div>
    <div class="sym"><img src="${UI}pw_shield.webp" alt=""><b>护栏</b><span>两侧升起 20 秒，金币不再掉海</span></div>
    <div class="sym"><img src="${UI}pw_bigcoin.webp" alt=""><b>巨币</b><span>一枚超重的大币，推力十足</span></div>
  </div>
  <h3>大潮</h3>
  <p>投币、过门、中奖都会涨潮，涨满了掀起<b>大潮</b>：台面前倾、推板加速 10 秒，是推落的好时机。</p>
  <h3>悬赏令</h3>
  <p>每次航行有 3 条悬赏（简单 / 中等 / 困难），点右上角「悬赏」查看。完成就盖章：简单 +20 枚、中等送一个道具、困难 +60 枚。</p>
  <h3>其它</h3>
  <p>钱包不到 20 枚时每 4 秒补 1 枚。连击 10 以上会给大潮充能。鹦鹉铜板会给你出主意，戳够了还会吐几枚私房钱。游戏内金币为虚拟道具，不可兑换。</p>`;

const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };

export class GameUI {
  constructor(frame, handlers) {
    this.H = handlers;
    const root = this.root = h('div', { className: 'ui prestart' });
    root.innerHTML = `
      <div id="edge"></div>
      <div id="pops"></div>
      <div id="flash"></div>
      <div id="plaque" class="enamel sheen"><img src="${UI}icon_coin.webp" alt=""><span id="wallet" class="num gold-text">0</span></div>
      <div id="refill"><i class="ring"></i>补给 <b class="num">4s</b></div>
      <div id="combo"></div>
      <div id="maps" class="enamel sheen">${'<i></i>'.repeat(5)}</div>
      <div id="maps-label">藏宝图</div>
      <button id="btn-settings" class="icon-btn enamel" aria-label="设置">${GEAR}</button>
      <button id="btn-bounty" class="enamel" aria-label="悬赏令"><img src="${UI}icon_bounty.webp" alt=""><b>悬赏</b><span class="num">0/3</span></button>
      <div id="btoast"><i class="seal"></i><div><b>悬赏完成</b><span></span></div><em class="num"></em></div>
      <div id="chips"></div>
      <div id="spins" class="enamel"><b>待转</b><i></i><i></i><i></i></div>
      <div id="items">${[0, 1, 2].map(i => `<button class="slot enamel" data-i="${i}" aria-label="道具"><img alt=""><span class="lbl"></span></button>`).join('')}</div>
      <div id="banner"><i class="rays"></i><span class="t gold-text"></span><span class="s"></span></div>
      <div id="bubble"></div>
      <div id="hint">点击台面投币 · 按住连投</div>
      <div id="start" class="screen">
        <div class="logo-wrap"><img class="logo" src="${UI}logo.webp" alt="金潮号 GOLDEN TIDE"><div class="shine"></div></div>
        <div class="tag">推金币 · 寻宝藏 · 驶向金币岛</div>
        <div class="grow"></div>
        <button class="btn-deco" id="btn-start">起航</button>
        <div class="row"><button class="icon-btn enamel" id="btn-settings2" aria-label="设置">${GEAR}</button></div>
        <div class="best" id="best"></div>
        <div class="snd-hint"><svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.6 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>轻触屏幕 · 开启配乐</div>
        <div class="note">游戏内金币为虚拟道具，不可兑换</div>
      </div>
      <div id="settings" class="screen scrim hide">
        <div class="card tall"><i class="frame"></i>${CREST}
          <h2 class="gold-text">设置</h2>
          <div class="opt">音乐<div class="seg" data-k="music"><button data-v="1">开</button><button data-v="0">关</button></div></div>
          <div class="opt">音效<div class="seg" data-k="sfx"><button data-v="1">开</button><button data-v="0">关</button></div></div>
          <div class="opt">鹦鹉<div class="seg" data-k="voice"><button data-v="1">说话</button><button data-v="0">嘎嘎</button></div></div>
          <div class="opt">画质<div class="seg" data-k="quality"><button data-v="high">高</button><button data-v="medium">中</button><button data-v="low">低</button></div></div>
          <div class="links"><button class="link" id="btn-howto">玩法说明</button><button class="link" id="btn-retut">重看新手引导</button></div>
          <div class="actions"><button class="btn-deco sm" id="btn-close">继续</button></div>
        </div>
      </div>
      <div id="bounty" class="screen scrim hide">
        <div class="card tall"><i class="frame"></i>${CREST}
          <h2 class="gold-text">悬赏令</h2>
          <div class="bsub">本次航行 · 完成就盖章领赏</div>
          <div class="blist"></div>
          <div class="actions"><button class="btn-deco sm" id="btn-bounty-close">继续航行</button></div>
        </div>
      </div>
      <div id="howto" class="screen scrim hide">
        <div class="card tall"><i class="frame"></i>${CREST}
          <h2 class="gold-text">玩法</h2>
          <div class="howto-body">${HOWTO}</div>
          <div class="actions"><button class="btn-deco sm" id="btn-howto-close">知道了</button></div>
        </div>
      </div>
      <div id="ending" class="screen scrim hide">
        <div class="card tall"><i class="frame"></i>${CREST}
          <h2 class="gold-text">抵达金币岛</h2>
          <div class="stamp" id="e-stamp"></div>
          <div class="stats">
            <span>本局推落</span><b class="num" id="e-won">0</b>
            <span>投入金币</span><b class="num" id="e-spent">0</b>
            <span>航行时间</span><b class="num" id="e-time">0</b>
            <span>最佳连击</span><b class="num" id="e-combo">0</b>
            <span>Jackpot</span><b class="num" id="e-jp">0</b>
            <span>亲手点火</span><b class="num" id="e-keg">0</b>
            <span>悬赏完成</span><b class="num" id="e-bounty">0/3</b>
          </div>
          <div class="best" id="e-best"></div>
          <div class="actions"><button class="btn-deco sm" id="btn-continue">继续航行</button></div>
        </div>
      </div>`;
    frame.append(root);
    const $ = s => root.querySelector(s);
    this.el = { combo: $('#combo'), refillN: $('#refill b'), refillRing: $('#refill .ring'), wallet: $('#wallet'), plaque: $('#plaque'), refill: $('#refill'), maps: [...root.querySelectorAll('#maps i')], chips: $('#chips'), slots: [...root.querySelectorAll('.slot')], banner: $('#banner'), bubble: $('#bubble'), pops: $('#pops'), hint: $('#hint'), flash: $('#flash'), mapsBar: $('#maps'), edge: $('#edge'), start: $('#start'), spins: $('#spins'), spinPips: [...root.querySelectorAll('#spins i')], settings: $('#settings'), ending: $('#ending'), best: $('#best') };
    this.shown = { wallet: 0 }; this.started = false; this.dropped = false; this.hintAt = Infinity;
    this.bubbleT = 0; this.bubbleCool = 0; this.bubblePri = 0;
    this.popAcc = { v: 0, t: 0 };
    this.chips = {};
    this.inFlight = 0;

    $('#btn-start').addEventListener('click', () => handlers.start());
    for (const b of [$('#btn-settings'), $('#btn-settings2')]) b.addEventListener('click', e => { e.stopPropagation(); this.openSettings(true); });
    $('#btn-close').addEventListener('click', () => this.openSettings(false));
    $('#btn-bounty').addEventListener('click', e => { e.stopPropagation(); this.openBounty(true); });
    $('#btn-bounty-close').addEventListener('click', () => this.openBounty(false));
    $('#btn-howto').addEventListener('click', () => { this.el.settings.classList.add('hide'); $('#howto').classList.remove('hide'); $('#howto .howto-body').scrollTop = 0; });
    $('#btn-howto-close').addEventListener('click', () => { $('#howto').classList.add('hide'); this.el.settings.classList.remove('hide'); });
    $('#btn-retut').addEventListener('click', () => { this.openSettings(false); handlers.replayTutorial?.(); });
    $('#btn-continue').addEventListener('click', () => { this.el.ending.classList.add('hide'); handlers.continue(); });
    for (const s of this.el.slots) s.addEventListener('pointerdown', e => { e.stopPropagation(); handlers.useItem(+s.dataset.i); });
    for (const seg of root.querySelectorAll('.seg')) seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      handlers.setting(seg.dataset.k, seg.dataset.k === 'quality' ? b.dataset.v : b.dataset.v === '1');
    });
  }

  // ---------- 屏幕 ----------
  showStart(best) { if (best) this.el.best.textContent = `最佳：推落 ${best.won} 枚 · 抵达金币岛 ${best.endings} 次`; }
  hideStart() { this.root.querySelector('#btn-bounty').classList.add('new'); this.root.classList.remove('prestart'); this.el.start.classList.add('hide'); setTimeout(() => this.el.start.remove(), 700); this.started = true; this.hintAt = performance.now() + 1500; }
  openSettings(on) { this.el.settings.classList.toggle('hide', !on); this.H.pause(on); }
  // 悬赏令面板：打开时暂停（和设置一样）
  openBounty(on) {
    const el = this.root.querySelector('#bounty');
    if (on) { this._renderBounty(); this.root.querySelector('#btn-bounty').classList.remove('new'); }
    el.classList.toggle('hide', !on); this.H.pause(on);
  }
  _renderBounty() {
    const g = this.g; if (!g) return;
    const R = g.cfg.bounty.rewards, TIER = ['简单', '中等', '困难'];
    const rewardText = r => r.coins ? `+${r.coins} 枚` : '道具一个';
    this.root.querySelector('#bounty .blist').innerHTML = g.bounties.list.map(b => {
      const d = BOUNTY_BY_KEY[b.key];
      return `<div class="brow t${d.tier}${b.done ? ' done' : ''}">
        <img class="tier" src="${UI}tier${d.tier + 1}.webp" alt="${TIER[d.tier]}" title="${TIER[d.tier]}">
        <div class="btext"><b>${d.text(b.goal)}</b><span class="bar"><i style="width:${(b.n / b.goal * 100).toFixed(0)}%"></i></span></div>
        <div class="bside"><em class="num">${b.done ? '' : `${b.n}/${b.goal}`}</em><small>${rewardText(R[d.tier])}</small></div>
        ${b.done ? '<i class="bstamp">已领</i>' : ''}
      </div>`;
    }).join('');
  }
  syncSettings(s) {
    for (const seg of this.root.querySelectorAll('.seg')) {
      const v = s[seg.dataset.k];
      for (const b of seg.children) b.classList.toggle('on', seg.dataset.k === 'quality' ? b.dataset.v === v : (b.dataset.v === '1') === v);
    }
  }

  banner(text, sub = '', cls = '', dur = 1.8) {
    const b = this.el.banner;
    this.bannerUntil = performance.now() + dur * 820;   // 横幅占着画面中上部：这段时间里鹦鹉的台词往后排
    b.className = cls; b.style.setProperty('--dur', dur + 's');
    b.querySelector('.t').textContent = text; b.querySelector('.s').textContent = sub;
    void b.offsetWidth; b.classList.add('show');
    // 庆祝分级：small 只有字；普通横幅加日芒 + 星光；big（JACKPOT / 满盘）再加闪屏和金币雨
    if (cls.includes('small')) return;
    const r = this.root.getBoundingClientRect(), y = r.height * 0.45;
    this._burst(r.width / 2, y, cls.includes('big') ? 22 : 12, cls.includes('teal') ? '#5fe3f0' : '#ffd36a', r.width * 0.42);
    if (cls.includes('big')) { this._flash(); this._shower(26); }
  }

  _flash() { const f = this.el.flash; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

  // 星光迸射：从 (x, y) 向四周飞出的四角星
  _burst(x, y, n, color = '#ffd36a', reach = 80) {
    for (let i = 0; i < n; i++) {
      const s = h('i', { className: 'star' });
      s.style.setProperty('--c', color);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = reach * (0.55 + Math.random() * 0.45), k = 0.6 + Math.random() * 0.9;
      this.el.pops.append(s);
      s.animate([
        { transform: `translate(${x}px, ${y}px) scale(.2) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x + Math.cos(a) * d}px, ${y + Math.sin(a) * d}px) scale(${k}) rotate(90deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${x + Math.cos(a) * d * 1.15}px, ${y + Math.sin(a) * d * 1.15 + 12}px) scale(0) rotate(140deg)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
    }
  }

  // 金币雨：从画面上方翻滚落下（只是 UI 层的庆祝，不影响台面）
  _shower(n) {
    const r = this.root.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const c = h('img', { className: 'rain', src: UI + 'icon_coin.webp', alt: '' });
      const x = Math.random() * r.width, drift = (Math.random() - 0.5) * 80, sc = 0.6 + Math.random() * 0.7, spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540);
      this.el.pops.append(c);
      c.animate([
        { transform: `translate(${x}px, -40px) scale(${sc}) rotateY(0deg) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x + drift}px, ${r.height * 0.75}px) scale(${sc}) rotateY(${spin}deg) rotate(${spin / 4}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${x + drift * 1.1}px, ${r.height * 0.85}px) scale(${sc}) rotateY(${spin * 1.1}deg)`, opacity: 0 },
      ], { duration: 1300 + Math.random() * 700, delay: Math.random() * 600, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'backwards' }).onfinish = () => c.remove();
    }
  }

  // 元素中心（相对 UI 根节点）
  _center(el) { const r = this.root.getBoundingClientRect(), b = el.getBoundingClientRect(); return { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top }; }

  pop(text, x, y, cls = '', icon = '') {
    const p = h('div', { className: `pop num gold-text ${cls}` }, text);
    if (icon) p.prepend(h('img', { className: 'pi', src: UI + icon, alt: '' }));   // 飘字前的小图标（点火 / 快转）
    p.style.left = x + 'px'; p.style.top = y + 'px';
    this.el.pops.append(p);
    setTimeout(() => p.remove(), 1150);
  }

  say(text, pri = 1, dur = 2.2) {
    const wait = (this.bannerUntil ?? 0) - performance.now();
    if (wait > 0) { if (pri >= 2) { clearTimeout(this.sayLater); this.sayLater = setTimeout(() => this.say(text, pri, dur), wait); } return; }
    if (this.bubbleT > 0 && pri < this.bubblePri) return;
    if (this.bubbleCool > 0 && pri < 3) return;
    const b = this.el.bubble;
    b.textContent = text; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    this.bubbleT = dur; this.bubblePri = pri; this.bubbleCool = dur + 2.5;
    this.onSay?.(text);
  }

  chip(key, on, html = '') {
    let c = this.chips[key];
    if (on && !c) { c = this.chips[key] = h('div', { className: `chip ${key}` }, html); this.el.chips.append(c); }
    if (!on && c) { c.remove(); delete this.chips[key]; }
    return c;
  }

  // ---------- 游戏事件 ----------
  onEvent(e, game, view) {
    switch (e.type) {
      case 'drop': this.dropped = true; break;
      case 'gate': {
        // 过门反馈：待转徽标旁飘「+1」，新亮的那颗闪一下；攒满时飘「已满」
        if (view.director.mode !== 'play') break;
        const p = view.spinScreen(), cq = this.root.clientWidth / 100;
        if (e.full) this.pop('已满', p.x + 9 * cq, p.y - 2 * cq, 'spin full');
        else {
          this.pop('+1', p.x + 9 * cq, p.y - 2 * cq, 'spin');
          const pip = this.el.spinPips[e.queue - 1];
          if (pip) { pip.classList.remove('new'); void pip.offsetWidth; pip.classList.add('new'); }
        }
        break;
      }
      case 'payout': if (e.value > 0 && view.director.mode === 'play') this._flyCoins(e.value, view);
        if (e.value > 0) { this.popAcc.v += e.value; this.popAcc.big = this.popAcc.big || e.value >= 6; if (e.combo >= 5) this._comboPop(e.combo, view, game); } break;
      case 'refill': this.el.plaque.classList.remove('bump'); void this.el.plaque.offsetWidth; this.el.plaque.classList.add('bump'); break;
      case 'comboEnd': clearTimeout(this.comboHide); this.el.combo.classList.remove('on'); if (e.n >= 8 && view.director.mode === 'play') this.banner(`连击 ×${e.n}`, '', 'small', 1.2); break;
      case 'slotResult': {
        const wild = e.lines.some(l => l.wild) ? ' · 鹦鹉百搭' : '';
        const NAME = { gem: '宝石', keg: '火药桶', anchor: '船锚', parrot: '鹦鹉' };
        const SUB = { gem: '大宝石落下 · 价值 20 枚', keg: '点它点火 · 炸开前沿崩出金币', anchor: '获得道具：金币雨', parrot: '获得道具：护栏' };
        if (e.result === 'multi') this.banner(`${e.lines.length} 线连中！`, `获得道具：巨币 · +${e.bonus} 枚${wild}`, '', 2.2);
        else if (SUB[e.result]) this.banner(`${NAME[e.result]}连线！`, SUB[e.result] + wild, '', 1.8);
        else if (e.result === 'guard') this.banner(`${e.parrots} 只鹦鹉！`, '获得道具：护栏', 'small teal', 1.6);
        else if (e.result === 'coins9') this.banner('金潮满盘！', `九格金币 · +${e.coinPay} 枚`, 'big', 2.4);
        else if (e.result === 'coins') this.banner(`金币 ×${e.coins}`, `+${e.coinPay} 枚`, 'small', 1.1);
        if (e.result === 'gem') this.say('宝石！推它下去！', 2);
        if (e.result === 'keg') this.say('点一下火药桶，点火！', 2);
        if (e.result === 'coins9') this.say('满盘金币！嘎嘎！', 3);
        if (wild && e.result !== 'gem' && e.result !== 'keg') this.say('嘿嘿，我是百搭！', 2);
        break;
      }
      case 'itemGain': this.say(`拿到「${ITEM[e.item].name}」！点下面用！`, 2); break;
      case 'kegLit': if (!e.auto) { const p = view.tableScreen(e.x, e.z, 1.6); this.pop('点火！', p.x, p.y, 'spin', 'fx_fuse.webp'); this.say('点火！快躲开！', 3, 1.4); } else this.say('当心！要炸啦！', 2); break;
      case 'kegBoom': { this.say('轰——！嘎！', 3, 1.4); const p = view.tableScreen(e.x, e.z, 1.2); this.pop(e.sea ? `崩回 ${e.bonus} 枚` : `崩出 ${e.bonus} 枚`, p.x, p.y, 'spin'); break; }
      // 道具栏满：同一时刻老虎机结果横幅也会出，用道具栏上方的飘字说明（横幅会被覆盖）
      case 'bountyDone': {
        const d = BOUNTY_BY_KEY[e.key], t = this.root.querySelector('#btoast');
        t.querySelector('span').textContent = d.text(game.bounties.list[e.i].goal);
        t.querySelector('em').textContent = e.reward.coins ? `+${e.reward.coins}` : ITEM[e.reward.item].name;
        t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
        clearTimeout(this.btoastT); this.btoastT = setTimeout(() => t.classList.remove('on'), 3200);
        const b = this.root.querySelector('#btn-bounty'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
        if (e.reward.coins) setTimeout(() => { const c = this._center(t.querySelector('em')); this._burst(c.x, c.y, 12, '#ffd36a', 60); }, 350);
        this.say('悬赏完成！嘎！', 3);
        break;
      }
      case 'bountiesNew': this.root.querySelector('#btn-bounty').classList.add('new'); this.say('新的悬赏令来啦！', 2); break;
      case 'itemOverflow': { const c = this._center(this.el.slots[1]), cq = this.root.clientWidth / 100; setTimeout(() => this.pop(`道具栏满 · ${ITEM[e.item].name}直接发动`, c.x, c.y - 27 * cq, 'spin full'), 500); this.say('道具栏满啦，直接放！', 2); break; }
      case 'spinStart': if (e.fast) { const p = view.spinScreen(), cq = this.root.clientWidth / 100; this.pop('快转', p.x + 9 * cq, p.y + 4 * cq, 'spin full', 'fx_fast.webp'); } break;
      case 'surgeStart': {
        this.banner('大潮！', '台面前倾 · 推板加速', 'teal', 2);
        // 手里有道具：提醒趁大潮用（金币雨 / 护栏叠大潮收益接近翻倍），道具槽一起跳
        const has = game.items.length > 0;
        this.say(has ? '大潮！快用道具！' : '大潮来啦！快投！', 3);
        if (has) for (const el of this.el.slots) if (el.classList.contains('full')) { el.classList.remove('urge'); void el.offsetWidth; el.classList.add('urge'); setTimeout(() => el.classList.remove('urge'), 5000); }
        break;
      }
      case 'mapRescue': { const p = view.tableScreen(e.to.x, e.to.z); this._burst(p.x, p.y, 12, '#ffd36a', 60); this.say('地图卡住啦，我叼过来！', 3); break; }
      case 'jackpotStart': this.el.edge.className = 'gold'; break;
      case 'jackpotTitle': this.banner('JACKPOT', '骷髅三连 · 炮火金雨', 'big', 2.6); this.say('发财啦！嘎嘎嘎！', 3); break;
      case 'jackpotCount': { const p = view.chestScreen(); this.pop(`+${e.value}`, p.x, p.y - 60, 'lg'); break; }
      case 'jackpotEnd': this.el.edge.className = ''; break;
      case 'specialDrop': if (e.obj === 'map') this.say('藏宝图碎片！别让它掉海里！', 2); break;
      case 'mapCollected': { const m = this.el.maps[e.n - 1]; if (m) { m.classList.add('on', 'got'); setTimeout(() => m.classList.remove('got'), 950); const c = this._center(m); this._burst(c.x, c.y, 10, '#ffd36a', 50); } if (e.n >= 5) this.el.mapsBar.classList.add('full'); this.say(e.n < 5 ? `藏宝图 ${e.n}/5！` : '集齐啦！起锚！', 3); break; }
      case 'lost': if (e.obj === 'map') this.say('啊！图掉海里了…', 3); else if (e.obj === 'gem') this.say('宝石喂鱼了…', 3); break;
      case 'endingStart': this.banner('藏宝图集齐！', '驶向金币岛', '', 3); this._flash(); this._shower(30); this.el.edge.className = 'gold'; break;
      case 'endingCard': {
        this.el.edge.className = '';
        const m = Math.floor(e.time / 60), s = Math.floor(e.time % 60);
        this.root.querySelector('#e-won').textContent = e.won; this.root.querySelector('#e-spent').textContent = e.spent;
        this.root.querySelector('#e-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
        const q = id => this.root.querySelector(id), fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        q('#e-combo').textContent = e.maxCombo ?? 0; q('#e-jp').textContent = e.jackpots ?? 0; q('#e-keg').textContent = e.kegsLit ?? 0; q('#e-bounty').textContent = `${e.bounties ?? 0}/3`;
        // 印章：首航 / 新纪录（更快抵达或更高连击）
        const first = !(e.best?.endings > 0), rec = e.record && (e.record.time || e.record.combo);
        const st = q('#e-stamp'); st.className = 'stamp'; st.textContent = first ? '首航' : rec ? '新纪录' : ''; st.classList.toggle('long', st.textContent.length > 2);
        if (first || rec) requestAnimationFrame(() => st.classList.add('on'));
        q('#e-best').textContent = first ? '' : `最快 ${fmt(e.best.fastest)} · 最高连击 ×${e.best.combo ?? 0}`;
        if (rec && !first) this.say('新纪录！嘎！', 3);
        this.el.ending.classList.remove('hide');
        break;
      }
      case 'endingDone': this.el.maps.forEach(m => m.classList.remove('on')); this.el.mapsBar.classList.remove('full'); break;
    }
  }

  // 推落的币化成小金币图标，从宝箱弧线飞进钱包；钱包数字等它们落袋才涨（延迟到账，更有"收进口袋"的感觉）
  _flyCoins(value, view) {
    const n = Math.min(value >= 6 ? 6 : value, 6), from = view.chestScreen();
    const fr = this.root.getBoundingClientRect(), icon = this.el.plaque.querySelector('img').getBoundingClientRect();
    const tx = icon.left + icon.width / 2 - fr.left, ty = icon.top + icon.height / 2 - fr.top;
    this.inFlight += value;
    for (let i = 0; i < n; i++) {
      const share = i === n - 1 ? value - Math.floor(value / n) * (n - 1) : Math.floor(value / n);
      const c = h('img', { className: 'flycoin', src: UI + 'icon_coin.webp', alt: '' });
      const x0 = from.x + (Math.random() - 0.5) * 60, y0 = from.y - 10 + (Math.random() - 0.5) * 20;
      const mx = x0 + (Math.random() - 0.5) * 120, my = Math.min(y0, ty) + (y0 - ty) * 0.35;
      this.el.pops.append(c);
      const a = c.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${(x0 + mx) / 2}px, ${y0 - 40}px) scale(1.15)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${tx}px, ${ty}px) scale(.55)`, opacity: 0.9 },
      ], { duration: 620 + Math.random() * 160, delay: 380 + i * 70, easing: 'cubic-bezier(.45,0,.75,1)', fill: 'both' });
      const land = () => { c.remove(); this.inFlight = Math.max(0, this.inFlight - share); };
      a.onfinish = land; a.oncancel = land;
    }
  }

  // 连击：固定在宝箱右上方的一个计数，原地刷新放大一下（以前每 5 连击新生成一个飘字，会叠在一起）
  _comboPop(n, view, game) {
    if (view.director.mode !== 'play') return;
    const c = this.el.combo, p = view.chestScreen(), cq = this.root.clientWidth / 100;
    const tide = n >= game.cfg.tide.comboTideFrom;   // 连击 ≥ 10：在给大潮充能，徽章右边亮一个浪花
    c.innerHTML = `<span class="lbl">连击</span><b class="n gold-text"><small>×</small>${n}</b>${tide ? `<img class="tide" src="${UI}fx_tide.webp" alt="" title="连击在给大潮充能">` : ''}`; c.classList.toggle('hot', n >= 15); c.style.left = (p.x + 22 * cq) + 'px'; c.style.top = (p.y - 20 * cq) + 'px';
    c.classList.add('on'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    clearTimeout(this.comboHide); this.comboHide = setTimeout(() => c.classList.remove('on'), 1600);
  }

  // ---------- 每帧 ----------
  update(dt, game, view) {
    this.g = game;
    { const n = game.bounties.doneCount, b = this.el.bountyN ??= this.root.querySelector('#btn-bounty span'); if (b.textContent !== `${n}/3`) b.textContent = `${n}/3`; }
    // 钱包数字滚动
    const w = game.wallet - this.inFlight;
    if (w !== this.shown.wallet) {
      const d = w - this.shown.wallet;
      this.shown.wallet += Math.sign(d) * Math.max(1, Math.round(Math.abs(d) * Math.min(1, dt * 10)));
      if (Math.sign(w - this.shown.wallet) !== Math.sign(d)) this.shown.wallet = w;
      this.el.wallet.textContent = this.shown.wallet;
      if (d > 0 && !this.el.plaque.classList.contains('bump')) { this.el.plaque.classList.add('bump'); setTimeout(() => this.el.plaque.classList.remove('bump'), 300); }
      if (d > 0 && !this.el.plaque.classList.contains('flip')) { const pl = this.el.plaque; pl.classList.add('flip'); if (d >= 6) pl.classList.add('rich'); setTimeout(() => pl.classList.remove('flip', 'rich'), 650); }
    }
    this.el.plaque.classList.toggle('empty', w <= 0);
    const low = w < game.cfg.play.refillCap && this.started && !game.ending;   // 钱包低于 20：慢慢补给
    this.el.refill.classList.toggle('on', low);
    if (low) { const every = game.cfg.play.refillEvery, left = Math.max(0, every - (game.refillT ?? 0)); this.el.refillN.textContent = Math.ceil(left) + 's'; this.el.refillRing.style.setProperty('--p', (1 - left / every).toFixed(3)); }
    if (w <= 0 && this.started && !this.saidEmpty) { this.say('没币了…等等会有补给', 2); this.saidEmpty = true; }
    if (w > 3) this.saidEmpty = false;
    // 推落飘字（0.4 秒内合并）
    this.popAcc.t += dt;
    if (this.popAcc.v > 0 && this.popAcc.t > 0.25 && view.director.mode !== 'play') this.popAcc = { v: 0, t: 0 };
    if (this.popAcc.v > 0 && this.popAcc.t > 0.4) {   // 0.4 秒内的进账合成一个数字
      const p = view.chestScreen();
      this.pop(`+${this.popAcc.v}`, p.x + (Math.random() - 0.5) * 40, p.y - 20, this.popAcc.big ? 'lg' : '');
      if (this.popAcc.big) this._burst(p.x, p.y - 30, 8, '#ffd36a', 60);
      this.popAcc = { v: 0, t: 0 };
    } else if (this.popAcc.v === 0) this.popAcc.t = 0;
    // 电影镜头时收起操作类 UI
    this.root.classList.toggle('cinematic', this.started && (view.director.mode !== 'play' || view.director.settled === false));   // 镜头还在路上时 HUD 也先别出来
    // 道具栏
    this.el.slots.forEach((s, i) => {
      const it = game.items[i];
      if ((s.dataset.item || '') === (it || '')) return;
      s.dataset.item = it || '';
      s.classList.toggle('full', !!it);
      if (it) {
        s.querySelector('img').src = UI + ITEM[it].img; s.querySelector('.lbl').textContent = ITEM[it].name;
        s.classList.remove('gain'); void s.offsetWidth; s.classList.add('gain');
        const c = this._center(s); this._burst(c.x, c.y, 12, { guard: '#5fe3f0', giant: '#ff9a3c' }[it] || '#ffd36a', 70);
      }
    });
    // 地图格（读档时同步）
    this.el.maps.forEach((m, i) => { if (i < game.mapPieces) m.classList.add('on'); });
    // 状态条
    const surge = this.chip('surge', game.surgeT > 0, `<img src="${UI}sym_anchor.webp">大潮 <span class="num"></span>`);
    if (surge) surge.querySelector('.num').textContent = Math.ceil(game.surgeT) + 's';
    const guard = this.chip('guard', game.guardT > 0, `<img src="${UI}pw_shield.webp">护栏 <span class="num"></span>`);
    if (guard) guard.querySelector('.num').textContent = Math.ceil(game.guardT) + 's';
    if (game.surgeT > 0 && this.el.edge.className === '') this.el.edge.className = 'surge';
    if (game.surgeT <= 0 && this.el.edge.className === 'surge') this.el.edge.className = '';
    // 引导
    const showHint = this.started && !this.dropped && !this.tutActive && performance.now() > this.hintAt;   // 新手引导进行中由引导层负责
    this.el.hint.classList.toggle('on', !!showHint);
    if (showHint && !this.saidHint) { this.say('点一下台面，投币！嘎！', 3, 3.5); this.saidHint = true; }
    // 老虎机待转次数：贴在转轮窗右上角；只在真有攒着的次数时出现（正在转的那次不算，免得出现一排全灭的空徽标）
    const q = game.slot.queue;
    const showSpins = this.started && view.director.mode === 'play' && q > 0;
    this.el.spins.classList.toggle('on', showSpins);
    if (showSpins) {
      const p = view.spinScreen();
      this.el.spins.style.transform = `translate(${p.x}px, ${p.y}px)`;
      this.el.spinPips.forEach((e, i) => e.classList.toggle('lit', i < game.slot.queue));
    }
    // 气泡跟随鹦鹉
    this.bubbleT -= dt; this.bubbleCool -= dt;
    if (this.bubbleT <= 0) this.el.bubble.classList.remove('on');
    else if (view.director.mode === 'stern') this.el.bubble.classList.remove('on');
    else { const p = view.parrotScreen(); this.el.bubble.style.left = p.x + 'px'; this.el.bubble.style.top = (p.y - 6) + 'px'; }
  }
}
