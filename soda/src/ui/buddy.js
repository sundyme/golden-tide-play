// 鹦鹉「铜板」的玩家互动：悬停 → 转头看玩家、歪头「嗯？」；点击 → 随机反应（甩头 / 转圈）+ 叫声 + 羽毛 + 台词；
// 1.6 秒内连戳 3 下 → 炸毛抗议；累计戳满 config.parrot.pokesPerGift 下 → 吐几枚金币到台面（规则层有冷却）。
// 平时偶尔自言自语（根据当前局面挑台词）。只做表现与调度，金币由 game.parrotGift() 发放。

const pick = a => a[(Math.random() * a.length) | 0];

const POKE = ['嘎！别戳我！', '我叫铜板！嘎！', '金币！金币！', '痒——嘎嘎嘎！', '饼干？有饼干吗？', '船长好！嘎！', '哟吼吼，扬帆起航！', '推下去！推下去！', '再戳我就啄你！'];
const HOVER = ['嗯？', '看我干嘛？', '嘎？', '要摸摸头吗？'];
const RUFFLE = ['别戳啦！羽毛都乱了！', '嘎嘎嘎！抗议！', '我要告诉船长！'];
const SPIN = ['看我转圈圈～', '帅不帅？嘎！', '鹦鹉回旋！'];
const GIFT = ['好啦好啦，赏你的！', '藏在嘴里的私房钱！', '拿去吧，别说是我给的！'];
const CHAT = ['瞄准骷髅门，转老虎机！', '台面边上快掉了…嘎！', '我闻到金币的味道了！', '海风真舒服，嘎～', '多投几枚，推下去的更多！'];

export class ParrotBuddy {
  constructor({ view, ui, audio, game }) {
    Object.assign(this, { view, ui, audio, game });
    this.pokes = 0; this.recent = []; this.hoverCool = 0; this.chatT = 25; this.last = '';
  }

  _line(pool) { let s; do s = pick(pool); while (s === this.last && pool.length > 1); this.last = s; return s; }

  // 局面相关的台词（优先于随机台词）
  _context() {
    const g = this.game, c = g.cfg;
    if (g.tide > 0.75 && g.surgeT <= 0) return '潮水快涨满啦，大潮要来了！';
    if (g.mapPieces >= 3) return `藏宝图还差 ${c.map.pieces - g.mapPieces} 片！`;
    if (g.items.length) return '道具栏里有好东西，点它！';
    if (g.wallet > 0 && g.wallet < 5) return '钱袋快空了…省着点！';
    return null;
  }

  hover(on) {
    const P = this.view.parrot;
    if (P.hoverOn === on) return;
    P.hoverOn = on;
    if (on && this.hoverCool <= 0) {
      this.hoverCool = 5;
      this.audio.squawk('hover');
      if (P.mood === 'idle' || P.mood === 'hint') this.ui.say(this._line(HOVER), 2, 1.3);
    }
  }

  poke() {
    const P = this.view.parrot, now = performance.now() / 1000;
    this.recent = this.recent.filter(t => now - t < 1.6); this.recent.push(now);
    this.pokes++;
    this.chatT = Math.max(this.chatT, 12);
    this.audio.haptic(12);
    let kind;
    if (this.pokes % this.game.cfg.parrot.pokesPerGift === 0 && this.game.parrotGift()) {
      kind = 'gift'; P.set('gift', 1.3, 4); this.ui.say(this._line(GIFT), 4, 2.2);
    } else if (this.recent.length >= 3) {
      kind = 'ruffle'; this.recent = []; P.set('ruffle', 1.2, 4); this.ui.say(this._line(RUFFLE), 4, 1.8);
    } else if (Math.random() < 0.2) {
      kind = 'spin'; P.set('spin', 1.3, 4); this.ui.say(this._line(SPIN), 4, 1.6);
    } else {
      kind = 'poke'; P.set('poke', 0.9, 4);
      const c = Math.random() < 0.35 ? this._context() : null;
      this.ui.say(c ?? this._line(POKE), 4, 1.8);
    }
    this.audio.squawk(kind);
    this.view.parrotFX(kind);
    return kind;
  }

  update(dt, started) {
    this.hoverCool -= dt;
    if (!started || this.view.director.mode !== 'play') return;
    const P = this.view.parrot;
    if (P.mood !== 'idle' || this.ui.bubbleT > 0 || this.ui.bubbleCool > 0) return;
    this.chatT -= dt;
    if (this.chatT > 0) return;
    this.chatT = 30 + Math.random() * 25;
    P.set('talk', 1.6, 1);
    this.ui.say(this._context() ?? this._line(CHAT), 1, 2.4);
    this.audio.squawk('talk');
  }
}
