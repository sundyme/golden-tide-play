// 推币机物理核心。不依赖 DOM / three，浏览器与无头模拟（tools/sim.mjs）共用。
// 调用方先 await RAPIER.init()，再把 RAPIER 传进来。

const DEG = Math.PI / 180;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 碰撞分组（高 16 位 = 所属组，低 16 位 = 与哪些组碰撞）：幸运圆环只和普通硬币（默认全组）碰撞
const RING_GROUPS = (0x0002 << 16) | 0x0001;
const BIG_GROUPS = (0x0004 << 16) | (0xffff & ~0x0002);

export class PusherPhysics {
  constructor(RAPIER, config) {
    this.R = RAPIER;
    this.cfg = config;
    const P = config.physics;

    this.world = new RAPIER.World({ x: 0, y: -P.gravity, z: 0 });
    this.world.timestep = P.dt;
    this.world.numSolverIterations = P.solverIterations;

    this.time = 0;
    this.phase = -Math.PI / 2;   // 从行程最后方开始
    this.pusherSpeed = 1;
    this.tilt = 0;               // 大潮前倾（度）
    this.swayEnabled = true;
    this.trackPrev = false;      // 浏览器端打开，用于渲染插值
    this.rng = Math.random;      // 无头模拟可注入种子随机数，保证可复现

    this.coins = [];             // 台面上所有物体：{ id, kind, body, scale, born, ccdUntil, out }
                                 // kind: coin / giant / gem / keg / map
    this.nextId = 1;
    this.stats = { front: 0, side: 0, dropped: 0 };
    this.listeners = [];

    this._buildMachine();
    this._buildGate();
  }

  on(fn) { this.listeners.push(fn); }
  _emit(e) { for (const fn of this.listeners) fn(e); }

  // ---------- 机台 ----------
  _buildMachine() {
    const R = this.R, M = this.cfg.machine, w = this.world;
    const halfW = M.width / 2;
    const fixed = (hx, hy, hz, x, y, z, friction = 0.35) => {
      const c = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(0.05);
      return w.createCollider(c);
    };
    this.colliders = {};

    // 下层台面（顶面 y=0），向后延伸到推板底下
    const back = M.pusherFrontMin - M.pusherDepth - 1;
    const tLen = M.tableFrontZ - back;
    fixed(halfW, M.tableThickness / 2, tLen / 2, 0, -M.tableThickness / 2, back + tLen / 2, 0.38);

    // 侧墙：从最后方到 sideOpenFromZ，之后两侧敞开（掉进海里）
    const sLen = M.sideOpenFromZ - back;
    for (const s of [-1, 1]) {
      fixed(0.15, M.sideWallHeight / 2, sLen / 2, s * (halfW + 0.15), M.sideWallHeight / 2, back + sLen / 2, 0.2);
    }
    // 鹦鹉护栏：平时关闭
    const gLen = M.tableFrontZ - M.sideOpenFromZ;
    this.colliders.guards = [-1, 1].map(s => {
      const c = fixed(0.12, M.guardWallHeight / 2, gLen / 2, s * (halfW + 0.12), M.guardWallHeight / 2, M.sideOpenFromZ + gLen / 2, 0.2);
      c.setEnabled(false);
      return c;
    });

    // D1-44：悬崖线以下 / 槽尾角柱 / 前角都给碰撞体（落海槽不加外壁：槽太窄，币会斜卡住 → 改为翻过台边就交给 VFX），和 machine.glb 的外形对齐 —— 币翻落、掉槽时不再穿过模型
    const F = M.tableFrontZ;
    fixed(halfW, 0.75, 0.1, 0, -0.5 - 0.75, F - 0.08, 0.2);   // 前裙板正面（台面下方的悬崖）
    for (const s of [-1, 1]) {
      fixed(0.36, 1.6, 0.12, s * (halfW + 0.35), -1.6, F - 0.12, 0.2);                 // 槽尾粉色角柱
      fixed(0.4, 2.4, 0.3, s * 5.55, -0.8, F + 0.3, 0.2);                             // 前角立柱 + 外侧柜壁
    }

    // 上层固定后挡板（底缘略高于推板顶面）
    const bwH = 3.0;
    fixed(halfW, bwH / 2, 0.15, 0, M.pusherHeight + M.backWallGap + bwH / 2, M.backWallZ - 0.15, 0.2);

    // 推板：运动学刚体
    const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, M.pusherHeight / 2, this.pusherCenterZ()));
    w.createCollider(
      R.ColliderDesc.cuboid(halfW - M.pusherSideGap, M.pusherHeight / 2, M.pusherDepth / 2).setFriction(0.45).setRestitution(0.05),
      body,
    );
    this.pusher = body;
  }

  pusherFrontZ(phase = this.phase) {
    const M = this.cfg.machine;
    const mid = (M.pusherFrontMin + M.pusherFrontMax) / 2;
    const amp = (M.pusherFrontMax - M.pusherFrontMin) / 2;
    return mid + amp * Math.sin(phase);
  }
  pusherCenterZ(phase = this.phase) { return this.pusherFrontZ(phase) - this.cfg.machine.pusherDepth / 2; }

  setGuards(on) { for (const c of this.colliders.guards) c.setEnabled(on); }

  // ---------- 幸运圆环（D1）：投币路径上左右摆动的水平圆环，币从环心穿过触发老虎机 ----------
  // 环管 = 一圈小球（运动学刚体），擦到环管会被弹开 —— 真实的技巧投掷。
  // 内口半径 ringR - tubeR = 0.86 > 币半径 0.58：平着的币也能穿过、不会被托住；看得见穿过的币都算（passRadius 0.45）。
  // （早期 v1 的水平圆环内口比币小，会把币托住，所以当时换成了立柱）
  _buildGate() {
    const R = this.R, G = this.cfg.gate, M = this.cfg.machine;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, G.y, M.dropZ));
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      this.world.createCollider(R.ColliderDesc.ball(G.tubeR).setTranslation(Math.cos(a) * G.ringR, 0, Math.sin(a) * G.ringR).setRestitution(0.45).setFriction(0.05).setCollisionGroups(RING_GROUPS), body);
    }
    // 海盗帽也给碰撞（两颗球近似，只和普通硬币碰撞）：原来币会从帽子里穿过去。位置 = machine.attachHat 的帽子包围盒
    for (const hx of [0.82, 1.3]) this.world.createCollider(R.ColliderDesc.ball(0.3).setTranslation(hx, 0.4, -0.37).setRestitution(0.4).setFriction(0.1).setCollisionGroups(RING_GROUPS), body);
    this.gate = body;
    this.gateX = 0;
  }
  gateXAt(t) { const G = this.cfg.gate; return G.amp * Math.sin(2 * Math.PI * t / G.period); }

  // ---------- 台面物体 ----------
  // kind：coin 普通币 / giant 巨型金币 / gem 宝石 / keg 火药桶 / map 藏宝图碎片
  spawn(kind, x, y, z, { ccd = true, tiltX = 0, tiltZ = 0, rotY = 0, vel = null, angvel = null, gateCheck = false } = {}) {
    const R = this.R, C = this.cfg.coin, S = this.cfg.specials;
    const q = quatFromEuler(tiltX, rotY, tiltZ);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z).setRotation(q)
      .setLinvel(vel?.x ?? 0, vel?.y ?? 0, vel?.z ?? 0)
      .setLinearDamping(C.linearDamping).setAngularDamping(C.angularDamping)
      .setCcdEnabled(ccd);
    if (angvel) desc.setAngvel(angvel);
    const body = this.world.createRigidBody(desc);
    let col, scale = 1;
    if (kind === 'coin' || kind === 'giant') {
      scale = kind === 'giant' ? S.giantScale : 1;
      col = R.ColliderDesc.roundCylinder(C.halfHeight * scale - C.border, C.radius * scale - C.border, C.border).setDensity(C.density);
    } else if (kind === 'gem') {
      col = R.ColliderDesc.convexHull(gemHullPoints(S.gemRadius)).setDensity(S.gemDensity);
    } else if (kind === 'keg') {
      col = R.ColliderDesc.roundCylinder(S.kegHalfHeight - 0.05, S.kegRadius - 0.05, 0.05).setTranslation(0, S.kegHalfHeight, 0).setDensity(S.kegDensity);
    } else if (kind === 'map') {
      col = R.ColliderDesc.cuboid(S.mapSize[0] / 2, 0.035, S.mapSize[1] / 2).setDensity(S.mapDensity);
    }
    col.setFriction(kind === 'gem' ? 0.5 : C.friction).setRestitution(C.restitution);
    if (kind !== 'coin') col.setCollisionGroups(BIG_GROUPS);   // 巨币 / 宝石 / 火药桶 / 藏宝图不碰幸运圆环（巨币比圆环内口大，会被托住）
    this.world.createCollider(col, body);
    const o = { id: this.nextId++, kind, body, scale, born: this.time, ccdUntil: ccd ? this.time + C.ccdSeconds : 0, out: null, gateCheck };
    this.coins.push(o);
    return o;
  }

  spawnCoin(x, y, z, opts = {}) { return this.spawn('coin', x, y, z, opts); }

  dropCoin(x) {
    const M = this.cfg.machine;
    const rnd = this.rng;
    x = Math.max(-M.dropXRange, Math.min(M.dropXRange, x));
    this.stats.dropped++;
    // D1-50：竖着（币面朝镜头）从骷髅嘴里吐出来；嘴缝只有 0.36，倾角抖动要小
    return this.spawnCoin(x + (rnd() - 0.5) * M.dropJitter, M.dropY, M.dropZ + (rnd() - 0.5) * M.dropJitter * 0.5, {
      tiltX: Math.PI / 2 + (rnd() - 0.5) * 0.06, tiltZ: (rnd() - 0.5) * 0.06, vel: { x: 0, y: -2, z: 0 }, gateCheck: true,
    });
  }

  // 从投币口放下特殊物件（宝石 / 火药桶 / 藏宝图 / 巨币），落在上层平台
  dropSpecial(kind, x) {
    const M = this.cfg.machine, rnd = this.rng;
    x = x ?? (rnd() * 2 - 1) * (M.dropXRange - 0.6);
    return this.spawn(kind, x, M.dropY - 0.85, M.dropZ + 0.4,   // 骷髅下巴（dropY - 0.75）下方
      { tiltX: (rnd() - 0.5) * 0.3, tiltZ: (rnd() - 0.5) * 0.3, rotY: rnd() * 6.28 });
  }

  // 爆炸：给半径内的物体一个向外向上的冲量（火药桶）
  explode(x, y, z, radius, strength) {
    let n = 0;
    for (const c of this.coins) {
      const p = c.body.translation();
      const dx = p.x - x, dy = p.y - y, dz = p.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const k = (1 - d / radius) * strength * c.body.mass();
      const inv = 1 / Math.max(0.3, d);
      c.body.applyImpulse({ x: dx * inv * k * 0.8, y: k * (0.9 + this.rng() * 0.4), z: dz * inv * k * 0.8 }, true);
      c.body.applyTorqueImpulse({ x: (this.rng() - 0.5) * k * 0.1, y: 0, z: (this.rng() - 0.5) * k * 0.1 }, true);
      n++;
    }
    return n;
  }

  // 开局沉降：铺满下层与上层，再离线跑若干秒（浏览器端可分帧：settleSpawn → step×N → settleFinish）
  settle(onProgress) {
    this.settleSpawn();
    const steps = Math.round(this.cfg.settle.seconds / this.cfg.physics.dt);
    for (let i = 0; i < steps; i++) {
      this.step({ silent: true });
      if (onProgress && i % 30 === 0) onProgress(i / steps);
    }
    this.settleFinish();
  }

  settleSpawn() {
    const S = this.cfg.settle, M = this.cfg.machine, C = this.cfg.coin;
    const rnd = mulberry32(S.seed);
    const halfW = M.width / 2 - C.radius - 0.05;
    const place = (n, z0, z1, yBase) => {
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(i / 22);
        this.spawnCoin(
          (rnd() * 2 - 1) * halfW,
          yBase + 0.3 + layer * 0.45 + rnd() * 0.2,
          z0 + rnd() * (z1 - z0),
          { ccd: false, tiltX: (rnd() - 0.5) * 0.3, tiltZ: (rnd() - 0.5) * 0.3 },
        );
      }
    };
    // 下层：从推板最前位置到前沿；上层：后挡板到推板最后位置
    place(S.lowerCoins, M.pusherFrontMax + 0.3, M.tableFrontZ + 0.15, 0);
    place(S.upperCoins, M.backWallZ + 0.6, M.pusherFrontMin - 0.4, M.pusherHeight);
  }

  // 从预烘焙文件恢复开局（见 tools/bake_settle.mjs）
  loadSettled(data) {
    this.phase = data.phase;
    this.pusher.setTranslation({ x: 0, y: this.cfg.machine.pusherHeight / 2, z: this.pusherCenterZ() }, true);
    for (const [x, y, z, qx, qy, qz, qw] of data.coins) {
      const c = this.spawnCoin(x, y, z, { ccd: false });
      c.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, false);
    }
    this.settleFinish();
  }

  settleFinish() {
    this.stats.front = this.stats.side = 0;
    this.time = 0;
  }

  // ---------- 推进一步 ----------
  step({ silent = false } = {}) {
    const P = this.cfg.physics, M = this.cfg.machine, T = this.cfg.tide;
    const dt = P.dt;
    this.time += dt;
    if (this.trackPrev) this._storePrev();

    // 推板
    this.prevPhase = this.phase;
    this.phase += (2 * Math.PI * dt / M.pusherPeriod) * this.pusherSpeed;
    this.pusher.setNextKinematicTranslation({ x: 0, y: M.pusherHeight / 2, z: this.pusherCenterZ() });

    // 船身摇晃 + 大潮前倾：通过改变重力方向
    const sway = this.swayEnabled ? T.swayDeg * Math.sin(this.time * 2 * Math.PI / T.swayPeriod) : 0;
    const ax = sway * DEG, at = this.tilt * DEG;
    const g = P.gravity;
    this.world.gravity = { x: g * Math.sin(ax), y: -g * Math.cos(ax) * Math.cos(at), z: g * Math.sin(at) };

    // 骷髅门
    const G = this.cfg.gate;
    this.prevGateX = this.gateX;
    this.gateX = this.gateXAt(this.time);
    this.gate.setNextKinematicTranslation({ x: this.gateX, y: G.y, z: M.dropZ });

    this.world.step();

    // CCD 到期关闭；骷髅门穿越判定；离台判定
    const halfW = M.width / 2;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.ccdUntil && this.time > c.ccdUntil) { c.body.enableCcd(false); c.ccdUntil = 0; }
      const p = c.body.translation();
      if (c.gateCheck) {
        if (p.y < G.y) {
          c.gateCheck = false;
          const py = c.prevGateY ?? p.y;
          if (py >= G.y - 0.3 && Math.abs(p.x - this.gateX) < G.passRadius && Math.abs(p.z - M.dropZ) < 0.7 && !silent) {
            this._emit({ type: 'gate', coin: c, x: p.x });
          }
        } else c.prevGateY = p.y;
      }
      // 防卡：搁在圆环管上停住的币（极少见）推一下，让它滑下去
      if (Math.abs(p.y - G.y) < 0.45 && Math.hypot(p.x - this.gateX, p.z - M.dropZ) < G.ringR + G.tubeR + 0.6) {
        const v = c.body.linvel();
        if (Math.abs(v.y) < 0.2) { const m = c.body.mass(); c.body.applyImpulse({ x: Math.sign(p.x - this.gateX || 1) * 0.8 * m, y: -0.4 * m, z: 0.3 * m }, true); }
      }
      // 离台判定：一落到台面以下就归类并移出物理世界（之后的下落 / 入箱 / 落海由 VFX 演）
      // 侧面一翻过台边就交给 VFX：落海槽只有 0.55 宽（币直径 1.16），留在物理里会斜卡在台边和槽壁之间、或者穿过槽壁
      const offSide = p.y < -0.15 && Math.abs(p.x) > halfW + 0.02 && p.z < M.tableFrontZ - 0.05;
      if (p.y < -0.7 || offSide) {
        c.out = p.z > M.tableFrontZ - 0.05 && Math.abs(p.x) < halfW + 0.3 ? 'front' : 'side';
        if (!silent) { if (c.kind === 'coin') this.stats[c.out]++; this._emit({ type: 'coinOut', kind: c.out, obj: c.kind, coin: c, x: p.x, z: p.z }); }
        this._remove(i);
      } else if (Math.abs(p.x) > 30 || Math.abs(p.z) > 30) this._remove(i);
    }
  }

  // 渲染插值用：记录上一步的位姿（复用对象，不产生垃圾）
  _storePrev() {
    for (const c of this.coins) {
      const t = c.body.translation(), r = c.body.rotation();
      if (!c.prevP) { c.prevP = { x: 0, y: 0, z: 0 }; c.prevQ = { x: 0, y: 0, z: 0, w: 1 }; }
      c.prevP.x = t.x; c.prevP.y = t.y; c.prevP.z = t.z;
      c.prevQ.x = r.x; c.prevQ.y = r.y; c.prevQ.z = r.z; c.prevQ.w = r.w;
    }
  }

  _remove(i) {
    const c = this.coins[i];
    this.world.removeRigidBody(c.body);
    const last = this.coins.pop();
    if (i < this.coins.length) this.coins[i] = last;
  }

  // 统计：前沿悬崖区（中心在前沿 1 个币径内）的币数，用于手感调参
  cliffCount() {
    const M = this.cfg.machine;
    let n = 0;
    for (const c of this.coins) {
      const p = c.body.translation();
      if (p.y > -0.2 && p.z > M.tableFrontZ - 0.55) n++;
    }
    return n;
  }

  awakeCount() {
    let n = 0;
    for (const c of this.coins) if (!c.body.isSleeping()) n++;
    return n;
  }
}

// 宝石碰撞体：圆形明亮式切割的凸包（台面朝上）
export function gemHullPoints(r) {
  const pts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, a2 = a + Math.PI / n;
    pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);                         // 腰
    pts.push(Math.cos(a2) * r * 0.62, r * 0.42, Math.sin(a2) * r * 0.62);   // 冠部台面
  }
  pts.push(0, -r * 0.78, 0);                                                // 底尖
  return new Float32Array(pts);
}

export function quatFromEuler(x, y, z) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}
