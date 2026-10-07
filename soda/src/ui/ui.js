// UI 层（D1 汽水海：玻璃面板 + 果冻按钮）：钱包、藏宝图进度、道具栏、横幅、飘字、鹦鹉气泡、开始 / 设置 / 结局卷轴。
// 只订阅游戏事件 + 每帧读取少量状态；操作通过 handlers 回调交给 main。
const UI = './public/assets/ui/';
const ITEM = {
  coinrain: { img: 'pw_coinrain.webp', name: '金币雨' },
  guard: { img: 'pw_shield.webp', name: '护栏' },
  giant: { img: 'pw_bigcoin.webp', name: '巨币' },
};
const GEAR = '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';

const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };

export class GameUI {
  constructor(frame, handlers) {
    this.H = handlers;
    const root = this.root = h('div', { className: 'ui' });
    root.innerHTML = `
      <div id="edge"></div>
      <div id="pops"></div>
      <div id="plaque" class="glass"><img src="${UI}icon_coin.webp" alt=""><span id="wallet" class="num gold-text">0</span></div>
      <div id="refill">补给中…</div>
      <div id="maps" class="glass">${'<i></i>'.repeat(5)}</div>
      <div id="maps-label">藏宝图</div>
      <button id="btn-settings" class="icon-btn" aria-label="设置">${GEAR}</button>
      <div id="chips"></div>
      <div id="items">${[0, 1, 2].map(i => `<button class="slot" data-i="${i}" aria-label="道具"><img alt=""><span class="lbl"></span></button>`).join('')}</div>
      <div id="banner"><span class="t gold-text"></span><span class="s"></span></div>
      <div id="bubble"></div>
      <div id="hint">点击台面投币 · 按住连投</div>
      <div id="start" class="screen">
        <div class="logo-wrap"><img class="logo" src="${UI}logo.webp" alt="金潮号 GOLDEN TIDE"><div class="shine"></div></div>
        <div class="tag">推金币 · 寻宝藏 · 驶向金币岛</div>
        <div class="grow"></div>
        <button class="btn-red" id="btn-start">起 航</button>
        <div class="row"><button class="icon-btn" id="btn-settings2" aria-label="设置">${GEAR}</button></div>
        <div class="best" id="best"></div>
        <div class="note">游戏内金币为虚拟道具，不可兑换</div>
      </div>
      <div id="settings" class="screen scrim hide">
        <div class="scroll tall">
          <h2>设 置</h2>
          <div class="opt">音乐<div class="seg" data-k="music"><button data-v="1">开</button><button data-v="0">关</button></div></div>
          <div class="opt">音效<div class="seg" data-k="sfx"><button data-v="1">开</button><button data-v="0">关</button></div></div>
          <div class="opt">画质<div class="seg" data-k="quality"><button data-v="high">高</button><button data-v="medium">中</button><button data-v="low">低</button></div></div>
          <div class="actions"><button class="btn-red sm" id="btn-close">继 续</button></div>
        </div>
      </div>
      <div id="ending" class="screen scrim hide">
        <div class="scroll tall">
          <h2>抵达金币岛！</h2>
          <div class="stats">
            <span>本局推落</span><b class="num" id="e-won">0</b>
            <span>投入金币</span><b class="num" id="e-spent">0</b>
            <span>航行时间</span><b class="num" id="e-time">0</b>
          </div>
          <div class="actions"><button class="btn-red sm" id="btn-continue">继续航行</button></div>
        </div>
      </div>`;
    frame.append(root);
    const $ = s => root.querySelector(s);
    this.el = { wallet: $('#wallet'), plaque: $('#plaque'), refill: $('#refill'), maps: [...root.querySelectorAll('#maps i')], chips: $('#chips'), slots: [...root.querySelectorAll('.slot')], banner: $('#banner'), bubble: $('#bubble'), pops: $('#pops'), hint: $('#hint'), edge: $('#edge'), start: $('#start'), settings: $('#settings'), ending: $('#ending'), best: $('#best') };
    this.shown = { wallet: 0 }; this.started = false; this.dropped = false; this.hintAt = Infinity;
    this.bubbleT = 0; this.bubbleCool = 0; this.bubblePri = 0;
    this.popAcc = { v: 0, t: 0 };
    this.chips = {};

    $('#btn-start').addEventListener('click', () => handlers.start());
    for (const b of [$('#btn-settings'), $('#btn-settings2')]) b.addEventListener('click', e => { e.stopPropagation(); this.openSettings(true); });
    $('#btn-close').addEventListener('click', () => this.openSettings(false));
    $('#btn-continue').addEventListener('click', () => { this.el.ending.classList.add('hide'); handlers.continue(); });
    for (const s of this.el.slots) s.addEventListener('pointerdown', e => { e.stopPropagation(); handlers.useItem(+s.dataset.i); });
    for (const seg of root.querySelectorAll('.seg')) seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      handlers.setting(seg.dataset.k, seg.dataset.k === 'quality' ? b.dataset.v : b.dataset.v === '1');
    });
  }

  // ---------- 屏幕 ----------
  showStart(best) { if (best) this.el.best.textContent = `最佳：推落 ${best.won} 枚 · 抵达金币岛 ${best.endings} 次`; }
  hideStart() { this.el.start.classList.add('hide'); setTimeout(() => this.el.start.remove(), 700); this.started = true; this.hintAt = performance.now() + 1500; }
  openSettings(on) { this.el.settings.classList.toggle('hide', !on); this.H.pause(on); }
  syncSettings(s) {
    for (const seg of this.root.querySelectorAll('.seg')) {
      const v = s[seg.dataset.k];
      for (const b of seg.children) b.classList.toggle('on', seg.dataset.k === 'quality' ? b.dataset.v === v : (b.dataset.v === '1') === v);
    }
  }

  banner(text, sub = '', cls = '', dur = 1.8) {
    const b = this.el.banner;
    b.className = cls; b.style.setProperty('--dur', dur + 's');
    const t = b.querySelector('.t'); t.textContent = t.dataset.t = text; b.querySelector('.s').textContent = sub;
    void b.offsetWidth; b.classList.add('show');
  }

  pop(text, x, y, cls = '') {
    const p = h('div', { className: `pop num gold-text ${cls}` }); p.textContent = p.dataset.t = text;
    p.style.left = x + 'px'; p.style.top = y + 'px';
    this.el.pops.append(p);
    setTimeout(() => p.remove(), 1150);
  }

  say(text, pri = 1, dur = 2.2) {
    if (this.bubbleT > 0 && pri < this.bubblePri) return;
    if (this.bubbleCool > 0 && pri < 3) return;
    const b = this.el.bubble;
    b.textContent = text; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    this.bubbleT = dur; this.bubblePri = pri; this.bubbleCool = dur + 2.5;
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
      case 'payout': if (e.value > 0) { this.popAcc.v += e.value; this.popAcc.big = this.popAcc.big || e.value >= 6; if (e.combo >= 5 && e.combo % 5 === 0) this._comboPop(e.combo, view); } break;
      case 'refill': this.el.plaque.classList.remove('bump'); void this.el.plaque.offsetWidth; this.el.plaque.classList.add('bump'); break;
      case 'comboEnd': if (e.n >= 8 && view.director.mode === 'play') this.banner(`连击 ×${e.n}`, '', 'small', 1.2); break;
      case 'slotResult': {
        const R = { gem: ['三宝石！', '大宝石落下 · 价值 20 枚'], keg: ['火药桶！', '推下去就炸开前沿'], anchor: ['三船锚！', '获得道具：金币雨'], parrot: ['三鹦鹉！', '获得道具：护栏'], pairAnchor: ['双船锚', '获得道具：巨币'], pair: ['对子', `+${game.cfg.slot.pairCoins} 枚金币`] }[e.result];
        if (R) this.banner(R[0], R[1], e.result === 'pair' || e.result === 'pairAnchor' ? 'small' : '', e.result === 'pair' ? 1.1 : 1.8);
        if (e.result === 'gem') this.say('宝石！推它下去！', 2);
        if (e.result === 'keg') this.say('当心！要炸啦！', 2);
        break;
      }
      case 'itemGain': this.say(`拿到「${ITEM[e.item].name}」！点下面用！`, 2); break;
      case 'kegBoom': this.say('轰——！嘎！', 3, 1.4); break;
      case 'surgeStart': this.banner('大潮！', '台面前倾 · 推板加速', 'teal', 2); this.say('大潮来啦！快投！', 3); break;
      case 'jackpotStart': this.el.edge.className = 'gold'; break;
      case 'jackpotTitle': this.banner('JACKPOT', '骷髅三连 · 炮火金雨', 'big', 2.6); this.say('发财啦！嘎嘎嘎！', 3); break;
      case 'jackpotCount': { const p = view.chestScreen(); this.pop(`+${e.value}`, p.x, p.y - 60, 'lg'); break; }
      case 'jackpotEnd': this.el.edge.className = ''; break;
      case 'specialDrop': if (e.obj === 'map') this.say('藏宝图碎片！别让它掉海里！', 2); break;
      case 'mapCollected': this.el.maps[e.n - 1]?.classList.add('on'); this.say(e.n < 5 ? `藏宝图 ${e.n}/5！` : '集齐啦！起锚！', 3); break;
      case 'lost': if (e.obj === 'map') this.say('啊！图掉海里了…', 3); else if (e.obj === 'gem') this.say('宝石喂鱼了…', 3); break;
      case 'endingStart': this.banner('藏宝图集齐！', '驶向金币岛', '', 3); this.el.edge.className = 'gold'; break;
      case 'endingCard': {
        this.el.edge.className = '';
        const m = Math.floor(e.time / 60), s = Math.floor(e.time % 60);
        this.root.querySelector('#e-won').textContent = e.won; this.root.querySelector('#e-spent').textContent = e.spent;
        this.root.querySelector('#e-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
        this.el.ending.classList.remove('hide');
        break;
      }
      case 'endingDone': this.el.maps.forEach(m => m.classList.remove('on')); break;
    }
  }

  _comboPop(n, view) { if (view.director.mode !== 'play') return; const p = view.chestScreen(); this.pop(`连击 ×${n}`, p.x + 70, p.y - 90, 'combo'); }

  // ---------- 每帧 ----------
  update(dt, game, view) {
    // 钱包数字滚动
    const w = game.wallet;
    if (w !== this.shown.wallet) {
      const d = w - this.shown.wallet;
      this.shown.wallet += Math.sign(d) * Math.max(1, Math.round(Math.abs(d) * Math.min(1, dt * 10)));
      if (Math.sign(w - this.shown.wallet) !== Math.sign(d)) this.shown.wallet = w;
      this.el.wallet.textContent = this.shown.wallet;
      if (d > 0 && !this.el.plaque.classList.contains('bump')) { this.el.plaque.classList.add('bump'); setTimeout(() => this.el.plaque.classList.remove('bump'), 300); }
    }
    this.el.plaque.classList.toggle('empty', w <= 0);
    this.el.refill.classList.toggle('on', !!(w <= 0 && this.started));
    if (w <= 0 && this.started && !this.saidEmpty) { this.say('没币了…等等会有补给', 2); this.saidEmpty = true; }
    if (w > 3) this.saidEmpty = false;
    // 推落飘字（0.25 秒内合并）
    this.popAcc.t += dt;
    if (this.popAcc.v > 0 && this.popAcc.t > 0.25 && view.director.mode !== 'play') this.popAcc = { v: 0, t: 0 };
    if (this.popAcc.v > 0 && this.popAcc.t > 0.25) {
      const p = view.chestScreen();
      this.pop(`+${this.popAcc.v}`, p.x + (Math.random() - 0.5) * 40, p.y - 20, this.popAcc.big ? 'lg' : '');
      this.popAcc = { v: 0, t: 0 };
    } else if (this.popAcc.v === 0) this.popAcc.t = 0;
    // 道具栏
    this.el.slots.forEach((s, i) => {
      const it = game.items[i];
      if ((s.dataset.item || '') === (it || '')) return;
      s.dataset.item = it || '';
      s.classList.toggle('full', !!it);
      if (it) { s.querySelector('img').src = UI + ITEM[it].img; s.querySelector('.lbl').textContent = ITEM[it].name; }
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
    const showHint = this.started && !this.dropped && performance.now() > this.hintAt;
    this.el.hint.classList.toggle('on', !!showHint);
    if (showHint && !this.saidHint) { this.say('点一下台面，投币！嘎！', 3, 3.5); this.saidHint = true; }
    // 气泡跟随鹦鹉
    this.bubbleT -= dt; this.bubbleCool -= dt;
    if (this.bubbleT <= 0) this.el.bubble.classList.remove('on');
    else if (view.director.mode === 'stern') this.el.bubble.classList.remove('on');
    else { const p = view.parrotTopScreen(); this.el.bubble.style.left = p.x + 'px'; this.el.bubble.style.top = (p.y - 6) + 'px'; }
  }
}
