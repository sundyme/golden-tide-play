// 《金潮号》全部可调数值。单位：1 = 一枚金币直径（约 2.6 cm 实物），秒，度。
// 坐标：x 向右，y 向上，z 朝向玩家（前沿在 +z）。

export const CONFIG = {
  physics: {
    dt: 1 / 60,              // 固定步长
    solverIterations: 6,
    gravity: 38,             // 玩具尺度下的"手感重力"（真实比例约 330，会显得太快）
  },

  coin: {
    radius: 0.58,             // D1：币更大更胖（概念图台面一排约 7 枚）
    halfHeight: 0.1,         // 厚 0.2 —— 糖果币的胖边
    border: 0.03,            // roundCylinder 圆角，叠放更稳
    density: 2.4,
    friction: 0.32,
    restitution: 0.12,
    linearDamping: 0.12,
    angularDamping: 0.6,
    ccdSeconds: 1.2,         // 新投入的币开 CCD 的时长
    maxDynamic: 250,         // 动态币上限（超出时最远的静止币冻结）
  },

  machine: {
    width: 9.2,              // 台面内宽（x）
    tableFrontZ: 3.6,        // 下层台面前沿（悬崖）
    tableBackZ: -7.5,
    tableThickness: 0.5,
    sideOpenFromZ: 0.0,      // 此 z 之后左右两侧无护栏，币会掉进海里（sweep2 定稿）
    sideWallHeight: 5.5,     // 碰撞高度（看得见的紫色侧墙只到 ~2.1，上面算透明挡板）：原 3.2 时被海盗帽弹飞的币会停在墙顶 y 3.3 悬空（D1-52）
    guardWallHeight: 0.7,    // 鹦鹉护栏升起高度

    pusherHeight: 1.0,       // 推板顶面 = 上层平台高度
    pusherDepth: 7.0,
    pusherFrontMin: -2.9,    // 推板前脸行程
    pusherFrontMax: -0.6,
    pusherPeriod: 3.0,       // 一次往复的秒数
    pusherSideGap: 0.04,

    backWallZ: -6.2,         // 上层固定后挡板（推板回缩时把顶面的币刮向前）
    backWallGap: 0.06,       // 挡板底缘离推板顶面的缝隙（小于币厚）

    dropY: 4.95,             // 投币高度 = 吐币骷髅嘴里（D1-50；原 6.2）
    dropZ: -4.75,            // 投币点 z（落在推板顶面靠后，经后挡板刮落）
    dropXRange: 3.9,         // 投币口左右可移动范围
    dropJitter: 0.06,
  },

  // 骷髅门（投币路径上左右摆动的环）
  gate: {
    y: 3.3,                  // 圆环中心高度（投币口与上层平台之间；D1-50 3.6 → 3.3，给吐币骷髅让出高度）
    ringR: 1.1, tubeR: 0.24,  // 幸运圆环：环管中心半径 / 管粗（内口 0.86，v6 里环外径约 2.5 枚币宽）。水平圆环像漏斗，
                              // 落在环管内侧的币会滑进环心 → 穿环次数约为旧立柱门的 2 倍；收益由 slot.weights.none / tide.perGate 压回
    passRadius: 0.45,        // 币心距圆环中线小于此值、且穿过圆环高度 → 算穿过（= 斜着穿过内口的极限，看得见穿过的都算）
    amp: 2.9,                // 左右摆幅
    period: 3.2,             // 摆动周期 s
  },

  // 特殊物件
  specials: {
    giantScale: 1.8,         // 巨币直径倍数（同密度 → 约 5.8 倍重）
    gemRadius: 0.62, gemDensity: 5.0,
    kegRadius: 0.5, kegHalfHeight: 0.62, kegDensity: 0.9,
    kegBlastRadius: 3.2, kegBlastStrength: 9,
    mapSize: [1.3, 1.0], mapDensity: 1.2,
  },

  play: {
    startCoins: 60,
    refillEvery: 4,          // 币用完后每 4 秒补 1 枚
    refillCap: 20,
    holdDropInterval: 0.22,  // 长按连投的限速
    comboWindow: 0.9,        // 连续掉落计为连击的间隔
  },

  // 开局沉降：离线跑物理，让台面满载、前沿悬着一排币
  settle: {
    lowerCoins: 190,
    upperCoins: 46,
    seconds: 9,
    seed: 7,
  },

  tide: {
    swayDeg: 0.7,            // 平时船身摇晃（重力方向偏摆）
    swayPeriod: 7.5,
    surgeTiltDeg: 6,         // 大潮前倾
    surgePusherSpeed: 1.6,
    surgeSeconds: 10,
    perCoin: 0.0013,         // 潮汐计充能：每投一枚
    perGate: 0.0024,         // 穿过幸运圆环（穿环更多，充能 × 0.6）
    perPair: 0.012,          // 老虎机两连
    perTriple: 0.03,         // 老虎机三连
  },

  // 老虎机：公开的概率表（权重，相对值）。每次穿过骷髅门得到一次转动（最多存 4 次）
  slot: {
    weights: {
      skull: 0.8,            // 💀💀💀 Jackpot
      gem: 1.8,              // 💎💎💎 宝石落台
      keg: 2.0,              // 🛢️🛢️🛢️ 火药桶落台
      anchor: 1.5,           // ⚓⚓⚓ 道具：金币雨
      parrot: 1.5,           // 🦜🦜🦜 道具：护栏 20 秒
      pairAnchor: 1.6,       // ⚓⚓+任意：道具：巨型金币
      pair: 18,              // 其他两连：小奖（投币口追加 5 枚）
      none: 125,             // 幸运圆环穿环次数约为旧立柱门 2 倍，空转多一些。D1-43 投币点前移 140→110；D1-52 币改竖着吐出、穿环率 +18% → 125（botsweep 8 局：aim 1.28 / casual 1.25，噪声约 ±0.15）
    },
    maxQueue: 3,
    stop1: 0.9, stop2: 1.3, stop3: 1.7, tease: 0.9, showSeconds: 0.9,
    pairCoins: 5,
  },

  items: { max: 3, coinRain: 22, guardSeconds: 20 },

  // 推落前沿的价值（落海为 0）
  payout: { coin: 1, giant: 6, gem: 20, keg: 0, map: 0 },

  jackpot: { slowmo: 0.25, slowmoSeconds: 0.6, cannonCoins: 36, waterfallCoins: 30, bonus: 50, cannonFrom: [5.42, 4.56, -8.24] },  // cannonFrom：炮口出币点（x 取 ±）

  map: { pieces: 5, firstAt: 45, every: [80, 100], respawnAfterLost: 20, dropX: 1.8 },

  ending: { sailSeconds: 6, chestTipDelay: 1.2, chestCoins: 90, cardDelay: 6.5 },

  // 鹦鹉互动：戳满 pokesPerGift 下，鹦鹉从嘴里甩出几枚金币到台面（冷却按游戏时间计，几乎不影响平衡）
  parrot: { pokesPerGift: 8, giftCoins: 3, giftCooldown: 45, from: [-4.4, 6.9, -4.9], vel: [3.2, 1.2, 1.4] },

  camera: {
    // D1（效果图 v6）：30° 低俯角 + 近机位（fov 55）：台阶的竖直面更高、纵深更强，机罩在画面顶端、宝箱落在道具按钮上方。
    // 其他镜头（特写 / Jackpot / 终局）用 wideFov，切换时平滑过渡。
    fov: 55,
    wideFov: 46,
    pitchDeg: 30,
    distance: 24,
    target: [0, 1.0, -0.4],
  },
};
