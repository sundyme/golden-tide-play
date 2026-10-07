// 调试面板：按 ` 键呼出。物理参数实时生效（改到新投入的币 / 现有碰撞体），事件一键触发。
import GUI from 'lil-gui';

export class DebugPanel {
  constructor(config, sim, actions) {
    const gui = this.gui = new GUI({ title: '金潮号 · 调试' });
    gui.hide();
    addEventListener('keydown', e => { if (e.key === '`' || e.key === '·') gui._hidden ? gui.show() : gui.hide(); });

    const ev = gui.addFolder('事件');
    ev.add(actions, 'surge').name('🌊 大潮');
    ev.add(actions, 'jackpot').name('💀 JACKPOT');
    const slot = { result: 'gem' };
    ev.add(slot, 'result', ['skull', 'gem', 'keg', 'anchor', 'parrot', 'pairAnchor', 'pair', 'none']).name('老虎机结果');
    ev.add({ spin: () => actions.slot(slot.result) }, 'spin').name('🎰 强制转一次');
    ev.add(actions, 'map').name('🗺 落下藏宝图');
    ev.add(actions, 'mapPiece').name('🗺 +1 碎片');
    ev.add(actions, 'ending').name('🏝 终局');
    ev.add({ rain: () => actions.item('coinrain') }, 'rain').name('道具：金币雨');
    ev.add({ guard: () => actions.item('guard') }, 'guard').name('道具：护栏');
    ev.add({ giant: () => actions.item('giant') }, 'giant').name('道具：巨币');
    ev.add({ add: () => actions.addCoins(50) }, 'add').name('+50 枚');
    ev.add(actions, 'reset').name('清档重开');

    const P = gui.addFolder('物理');
    P.add(config.physics, 'gravity', 10, 80, 1).name('重力');
    P.add(config.physics, 'solverIterations', 1, 12, 1).name('求解迭代').onChange(v => { sim.world.numSolverIterations = v; });
    P.add(config.machine, 'pusherPeriod', 1.5, 8, 0.1).name('推板周期 s');
    P.add(config.tide, 'swayDeg', 0, 3, 0.1).name('摇晃 °');
    P.add(config.tide, 'surgeTiltDeg', 0, 15, 0.5).name('大潮前倾 °');

    const C = gui.addFolder('金币（新投入生效）');
    C.add(config.coin, 'friction', 0.05, 1, 0.01).name('摩擦');
    C.add(config.coin, 'restitution', 0, 0.6, 0.01).name('弹性');
    C.add(config.coin, 'density', 0.5, 6, 0.1).name('密度');
    C.add(config.coin, 'linearDamping', 0, 1, 0.01).name('线阻尼');
    C.add(config.coin, 'angularDamping', 0, 2, 0.01).name('角阻尼');
    C.add({ apply: () => {
      for (const c of sim.coins) {
        const col = c.body.collider(0);
        col.setFriction(config.coin.friction); col.setRestitution(config.coin.restitution);
        c.body.setLinearDamping(config.coin.linearDamping); c.body.setAngularDamping(config.coin.angularDamping);
      }
    } }, 'apply').name('应用到台面现有币');
    gui.close(); ev.open();
  }
}
