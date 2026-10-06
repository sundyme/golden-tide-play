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
import { Tutorial, TUTORIAL_STEPS } from './ui/tutorial.js';

const $ = id => document.getElementById(id);
const frame = $('frame');
const canvas = document.createElement('canvas');
frame.prepend(canvas);
const params = new URLSearchParams(location.search);

// ---------- 存档（localStorage 可能不可用：隐私模式 / 禁用存储） ----------
const SAVE_KEY = 'goldenTide.v1';
const store = {
  load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } },
  save(d) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { } },
};

async function boot() {
  const saved = params.has('fresh') ? {} : store.load();
  const settings = { music: true, sfx: true, voice: true, quality: matchMedia('(max-width: 600px)').matches ? 'medium' : 'high', ...saved.settings };
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
  audio.settings.music = settings.music; audio.settings.sfx = settings.sfx; audio.settings.voice = settings.voice;

  let started = false, paused = false;
  let tut = null;
  const persist = () => store.save({ game: game.serialize(), settings, best: { won: Math.max(best.won, game.won), endings: best.endings, fastest: best.fastest, combo: best.combo }, tut: tut?.saved ?? saved.tut });

  const ui = new GameUI(frame, {
    start() {
      if (started) return;
      started = true;
      audio.init().then(() => audio.ui('start'));
      ui.hideStart();
      tut.start();
    },
    pause(on) { paused = on; audio.pause(on); if (!on) last = performance.now(); },
    useItem(i) { if (started && game.useItem(i, dropX)) audio.ui('click'); },
    setting(k, v) {
      settings[k] = v; ui.syncSettings(settings); persist();
      if (k === 'quality') view.setQuality(v); else audio.set(k, v);
      audio.ui('click');
    },
    continue() { game.continueAfterEnding(); persist(); },
    replayTutorial() { tut.reset(); persist(); },
  });
  ui.syncSettings(settings);
  ui.onSay = text => audio.speak(text);   // 鹦鹉台词气泡 → 配音
  ui.showStart(best.won ? best : null);
  // 新手引导：老玩家（有存档、投过币、但存档里还没有引导记录）视为已完成；?tutorial 强制重来
  const veteran = !saved.tut && (saved.game?.spent ?? 0) > 0;
  tut = new Tutorial({ ui, view, game, done: params.has('tutorial') ? [] : veteran ? TUTORIAL_STEPS : saved.tut ?? [] });
  tut.onChange = persist;

  game.on(e => {
    // 终局卡：先和最佳纪录比（最快抵达 / 最高连击），UI 据此盖「新纪录」章
    if (e.type === 'endingCard') {
      e.record = { time: !(best.fastest <= e.time), combo: e.maxCombo > (best.combo ?? 0) };
      if (e.record.time) best.fastest = Math.round(e.time);
      if (e.record.combo) best.combo = e.maxCombo;
      e.best = { ...best };
    }
    view.onEvent(e, game);
    ui.onEvent(e, game, view);
    tut.onEvent(e);
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
  // 火药桶：点到台上还没点着的火药桶就点火，这一下不投币
  const onKeg = ev => {
    const r = canvas.getBoundingClientRect();
    return view.kegHit((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
  };
  canvas.addEventListener('pointermove', ev => {
    dropX = toDropX(ev);
    if (ev.pointerType === 'mouse' && !holding) {
      const on = started && !paused && onParrot(ev);
      buddy.hover(on); canvas.style.cursor = on || (started && !paused && onKeg(ev) !== null) ? 'pointer' : '';
    }
  });
  canvas.addEventListener('pointerleave', () => { buddy.hover(false); canvas.style.cursor = ''; });
  canvas.addEventListener('pointerdown', ev => {
    if (!started || paused) return;
    if (onParrot(ev)) { buddy.poke(); if (ev.pointerType !== 'mouse') { buddy.hover(true); setTimeout(() => buddy.hover(false), 1200); } return; }
    { const id = onKeg(ev); if (id !== null && game.lightKeg(id)) return; }
    canvas.setPointerCapture(ev.pointerId);
    dropX = toDropX(ev); holding = true; holdT = 0; game.drop(dropX);
  });
  const up = () => { holding = false; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  addEventListener('keydown', e => {
    if (e.code === 'Space' && started && !paused) { e.preventDefault(); game.drop(dropX); }
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
  window.__gt = { sim, view, game, ui, audio, buddy, tut, actions, capture, start: () => ui.H.start(), get started() { return started; } };

  // ---------- 主循环 ----------
  const dt = CONFIG.physics.dt;
  let acc = 0, last = performance.now(), fpsT = 0, frames = 0, fps = 0, stepMs = 0;
  const showStats = params.has('stats');
  if (!showStats) $('stats').remove();
  const loop = now => {
    requestAnimationFrame(loop);
    const frameDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (document.hidden || paused) return;

    if (holding && started) { holdT += frameDt; if (holdT >= CONFIG.play.holdDropInterval) { holdT = 0; game.drop(dropX); } }

    // 慢动作：规则层（Jackpot 定格）× 画面层（宝石特写）
    acc += frameDt * game.timeScale * view.timeScale;
    const a = performance.now();
    let n = 0;
    while (acc >= dt && n < 4) { sim.step(); game.update(dt); acc -= dt; n++; }
    if (n === 4) acc = 0;
    if (n) stepMs = stepMs * 0.9 + (performance.now() - a) / n * 0.1;

    view.update(sim, game, acc / dt, now / 1000, frameDt, { dropX });
    view.adaptQuality(frameDt * 1000);
    ui.update(frameDt, game, view);
    tut.update(frameDt);
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
