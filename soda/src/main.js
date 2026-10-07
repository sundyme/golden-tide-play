// 入口：固定步长物理 + 规则层 Game + 画面 / UI / 音频订阅事件；存档、暂停、输入、截图钩子。
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';
import { PusherPhysics } from './physics/pusher.js';
import { Game } from './gameplay/game.js';
import { GameView } from './scene/view.js';
import { GameUI } from './ui/ui.js';
import { GameAudio } from './audio/audio.js';
import { DebugPanel } from './debug/panel.js';
import { ParrotBuddy } from './ui/buddy.js';
import { Intro } from './scene/intro.js';

const $ = id => document.getElementById(id);
const frame = $('frame');
const canvas = document.createElement('canvas');
frame.prepend(canvas);
const params = new URLSearchParams(location.search);

// ---------- 存档（localStorage 可能不可用：隐私模式 / 禁用存储） ----------
const SAVE_KEY = 'goldenTide.d1';   // D1-58：汽水海单独存档（试玩站与主线版同域名，共用 localStorage）
const store = {
  load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } },
  save(d) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { } },
};

async function boot() {
  const saved = params.has('fresh') ? {} : store.load();
  const settings = { music: true, sfx: true, quality: matchMedia('(max-width: 600px)').matches ? 'medium' : 'high', ...saved.settings };
  if (params.get('q')) settings.quality = params.get('q');

  await RAPIER.init();
  const sim = new PusherPhysics(RAPIER, CONFIG);
  const view = new GameView(canvas, CONFIG, settings.quality);
  const fit = () => view.resize(frame.clientWidth, frame.clientHeight);
  fit();
  addEventListener('resize', fit);
  await view.ready;
  $('loadbar').style.width = '70%';

  // 开局：预烘焙沉降结果（缺失时现场沉降）
  const baked = await fetch('./public/assets/settle.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (baked) sim.loadSettled(baked);
  else {
    const total = Math.round(CONFIG.settle.seconds / CONFIG.physics.dt);
    sim.settleSpawn();
    for (let i = 0; i < total;) {
      const t0 = performance.now();
      while (i < total && performance.now() - t0 < 12) { sim.step({ silent: true }); i++; }
      $('loadbar').style.width = `${70 + 30 * i / total}%`;
      await new Promise(r => setTimeout(r, 0));
    }
    sim.settleFinish();
  }
  sim.trackPrev = true;

  const game = new Game(sim, CONFIG);
  if (saved.game) game.restore(saved.game);
  const best = { won: 0, endings: 0, ...saved.best };
  const audio = new GameAudio();
  audio.settings.music = settings.music; audio.settings.sfx = settings.sfx;
  // D1-53/54 开场仪式：滑轨吊在高处、骷髅打瞌睡；点「起航」后解锁 → 棘轮放下 → 甩落 → 睁眼 → 起航（scene/intro.js）。演完才能投币
  view.machine.raiseRail();
  const intro = new Intro(view, {
    sfx: (k, i) => audio.intro(k, i),
    banner: () => ui.banner('起航！', '点台面投币 · 按住连投', 'teal', 1.9),
  });
  const canDrop = () => started && !paused && view.machine.railReady;

  let started = false, paused = false;
  const persist = () => store.save({ game: game.serialize(), settings, best: { won: Math.max(best.won, game.won), endings: best.endings } });

  const ui = new GameUI(frame, {
    start() {
      if (started) return;
      started = true;
      audio.init().then(() => intro.h.sfx('introStart'));
      intro.start();
      ui.hideStart();
    },
    pause(on) { paused = on; audio.pause(on); if (!on) last = performance.now(); },
    useItem(i) { if (started && game.useItem(i, dropX)) audio.ui('click'); },
    setting(k, v) {
      settings[k] = v; ui.syncSettings(settings); persist();
      if (k === 'quality') view.setQuality(v); else audio.set(k, v);
      audio.ui('click');
    },
    continue() { game.continueAfterEnding(); persist(); },
  });
  ui.syncSettings(settings);
  ui.showStart(best.won ? best : null);

  game.on(e => {
    view.onEvent(e, game);
    ui.onEvent(e, game, view);
    audio.onEvent(e, game);
    if (e.type === 'endingCard') { best.endings++; persist(); }
  });
  $('loading').style.opacity = 0;
  setTimeout(() => $('loading').remove(), 450);

  // ---------- 输入：指哪投哪，单击投一枚，长按连投 ----------
  const M = CONFIG.machine;
  let dropX = 0, holding = false, holdT = 0;
  const toDropX = ev => {
    const r = canvas.getBoundingClientRect();
    const x = view.dropXAt((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    return Math.max(-M.dropXRange, Math.min(M.dropXRange, x));
  };
  // 鹦鹉互动：悬停 / 点到鹦鹉时不投币
  const buddy = new ParrotBuddy({ view, ui, audio, game });
  const onParrot = ev => {
    const r = canvas.getBoundingClientRect();
    return view.parrotHit((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
  };
  canvas.addEventListener('pointermove', ev => {
    dropX = toDropX(ev);
    if (ev.pointerType === 'mouse' && !holding) {
      const on = started && !paused && onParrot(ev);
      buddy.hover(on); canvas.style.cursor = on ? 'pointer' : '';
    }
  });
  canvas.addEventListener('pointerleave', () => { buddy.hover(false); canvas.style.cursor = ''; });
  canvas.addEventListener('pointerdown', ev => {
    if (!started || paused) return;
    if (onParrot(ev)) { buddy.poke(); if (ev.pointerType !== 'mouse') { buddy.hover(true); setTimeout(() => buddy.hover(false), 1200); } return; }
    canvas.setPointerCapture(ev.pointerId);
    if (intro.active && !view.machine.railReady) { intro.hurry(); return; }   // 开场时点屏幕 = 快进
    if (!canDrop()) return;
    dropX = toDropX(ev); holding = true; holdT = 0; game.drop(dropX);
  });
  const up = () => { holding = false; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  addEventListener('keydown', e => {
    if (e.code === 'Space' && canDrop()) { e.preventDefault(); game.drop(dropX); }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') game.useItem(+e.code.slice(-1) - 1, dropX);
  });

  // 切到后台：暂停 + 存档
  document.addEventListener('visibilitychange', () => { audio.pause(document.hidden || paused); if (document.hidden) persist(); else last = performance.now(); });
  addEventListener('pagehide', persist);
  setInterval(() => { if (started) persist(); }, 5000);

  // ---------- 调试 ----------
  const actions = {
    surge: () => game.debug('surge'), jackpot: () => game.debug('jackpot'), ending: () => game.debug('ending'),
    slot: r => game.debug('slot', r), map: () => game.debug('map'), mapPiece: () => game.debug('mapPiece'),
    item: k => game.debug('item', k), addCoins: (n = 50) => game.debug('coins', n),
    reset: () => { try { localStorage.removeItem(SAVE_KEY); } catch { } location.search = '?fresh'; },
  };
  new DebugPanel(CONFIG, sim, actions);

  // 截图钩子：渲染完这一帧后把画布 POST 给开发服务器（tools/devserver.mjs）
  let pendingShot = null;
  const capture = name => new Promise(res => { pendingShot = { name, res }; });
  window.__gt = { sim, view, game, ui, audio, buddy, actions, capture, intro, start: () => ui.H.start(), get started() { return started; } };

  // ---------- 主循环 ----------
  const dt = CONFIG.physics.dt;
  let acc = 0, last = performance.now(), fpsT = 0, frames = 0, fps = 0, stepMs = 0;
  const showStats = params.has('stats');
  if (!showStats) $('stats').remove();
  const loop = now => {
    requestAnimationFrame(loop);
    const frameDt = Math.max(0, Math.min(0.1, (now - last) / 1000));   // rAF 时间戳可能早于 start()/恢复时记的 performance.now() → 负值
    last = now;
    if (document.hidden || paused) return;

    if (holding && canDrop()) { holdT += frameDt; if (holdT >= CONFIG.play.holdDropInterval) { holdT = 0; game.drop(dropX); } }

    // 慢动作：规则层（Jackpot 定格）× 画面层（宝石特写）
    acc += frameDt * game.timeScale * view.timeScale;
    const a = performance.now();
    let n = 0;
    while (acc >= dt && n < 4) { sim.step(); game.update(dt); acc -= dt; n++; }
    if (n === 4) acc = 0;
    if (n) stepMs = stepMs * 0.9 + (performance.now() - a) / n * 0.1;

    intro.update(frameDt);
    view.update(sim, game, acc / dt, now / 1000, frameDt, { dropX });
    view.adaptQuality(frameDt * 1000);
    ui.update(frameDt, game, view);
    buddy.update(frameDt, started && !paused);
    audio.update(frameDt, game, sim);

    if (pendingShot) {
      const { name, res } = pendingShot; pendingShot = null;
      canvas.toBlob(b => fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: b }).then(r => res(r.ok)).catch(() => res(false)), 'image/png');
    }
    if (showStats) {
      frames++; fpsT += frameDt;
      if (fpsT > 0.5) {
        fps = frames / fpsT; frames = 0; fpsT = 0;
        $('stats').textContent = `${fps.toFixed(0)} fps · step ${stepMs.toFixed(2)} ms · dpr ${view.dpr}\ncoins ${sim.coins.length} · awake ${sim.awakeCount()} · cliff ${sim.cliffCount()}`;
      }
    }
  };
  requestAnimationFrame(loop);
  if (params.has('autostart')) ui.H.start();
}

boot().catch(err => {
  console.error(err);
  const l = $('loading');
  if (l) l.textContent = '启动失败：' + (err?.message ?? String(err));
});
