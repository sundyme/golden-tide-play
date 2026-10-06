// 《金潮号》全部可调数值。单位：1 = 一枚金币直径（约 2.6 cm 实物），秒，度。
// 坐标：x 向右，y 向上，z 朝向玩家（前沿在 +z）。

export const CONFIG = {
  physics: {
    dt: 1 / 60,              // 固定步长
    solverIterations: 6,
    gravity: 38,             // 玩具尺度下的"手感重力"（真实比例约 330，会显得太快）
  },

  coin: {
    radius: 0.5,
    halfHeight: 0.085,       // 厚 0.17 —— 厚实但能叠
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
    sideWallHeight: 8.0,     // 隐形侧墙（推台区）：要高过投币点，否则被骷髅门弹飞的币会从墙上飞出机台、穿过柜壁护栏
    guardWallHeight: 0.7,    // 鹦鹉护栏升起高度

    pusherHeight: 1.0,       // 推板顶面 = 上层平台高度
    pusherDepth: 7.0,
    pusherFrontMin: -2.9,    // 推板前脸行程
    pusherFrontMax: -0.6,
    pusherPeriod: 3.0,       // 一次往复的秒数
    pusherSideGap: 0.04,

    backWallZ: -6.2,         // 上层固定后挡板（推板回缩时把顶面的币刮向前）
    backWallGap: 0.06,       // 挡板底缘离推板顶面的缝隙（小于币厚）

    dropY: 6.2,              // 投币高度（物理；改低会让藏宝图卡在骷髅门顶上，见 DEVLOG）
    dropperY: 5.4,           // 漏斗的显示高度：压到老虎机窗口下沿以下，九宫格第三行不被挡；漏斗口以上的币不渲染
    dropZ: -5.2,             // 投币点 z（落在推板顶面靠后，经后挡板刮落）
    dropXRange: 3.9,         // 投币口左右可移动范围
    dropJitter: 0.06,
  },

  // 骷髅门（投币路径上左右摆动的环）
  gate: {
    y: 3.6,                  // 门中心高度（投币口与上层平台之间）
    spacing: 1.32,           // 两柱中心距
    postR: 0.09, postHalf: 0.55, capR: 0.15,
    passRadius: 0.28,        // 币心距两柱中线小于此值、且穿过门高度 → 算穿过
    amp: 3.1,                // 左右摆幅
    period: 3.2,             // 摆动周期 s
  },

  // 特殊物件
  specials: {
    giantScale: 1.8,         // 巨币直径倍数（同密度 → 约 5.8 倍重）
    gemRadius: 0.62, gemDensity: 5.0,
    kegRadius: 0.5, kegHalfHeight: 0.62, kegDensity: 0.9,
    kegBlastRadius: 3.2, kegBlastStrength: 9,
    // 火药桶点火：玩家点一下 → 引信 kegFuse 秒后在原地朝前沿定向爆炸，并崩出 kegBonus 枚金币飞进宝箱；
    // 没人点、推到离前沿 kegAutoLightZ 以内自动点燃；从侧面掉海时半空炸开，崩回 kegSeaBonus 枚
    kegFuse: 3, kegAutoLightZ: 1.4, kegBlastForward: 0.6, kegBonus: 6, kegSeaBonus: 3,
    mapSize: [1.3, 1.0], mapDensity: 1.2,
  },

  play: {
    startCoins: 60,
    refillEvery: 4,          // 钱包低于 refillCap 时每 4 秒补 1 枚（离开一会儿回来就有 20 枚）
    refillCap: 20,
    holdDropInterval: 0.30,  // 长按连投的限速（0.22 时每秒 4.5 枚，远超台面吸收速度，8 局 7 局破产）
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
    perGate: 0.004,          // 穿过骷髅门
    perPair: 0.012,          // 老虎机小奖（金币散布 / 三鹦鹉）
    perTriple: 0.03,         // 老虎机每条连线
    perCombo: 0.0015,        // 连击 ≥ comboTideFrom 后，每多推落一枚
    comboTideFrom: 10,
  },

  // 老虎机：3×3 九宫格，5 条线（3 横 + 2 斜）。每格独立按下表抽符号（公开的概率，合计 1）。
  // 每次穿过骷髅门得到一次转动（最多存 3 次）。
  //   连线：一条线上三个相同 → 符号奖（骷髅 Jackpot / 宝石落台 / 火药桶落台 / 船锚→金币雨 / 鹦鹉→护栏）
  //   鹦鹉 = 百搭：线上可替代任何符号（金币堆除外）；盘面 ≥3 只鹦鹉 → 护栏
  //   金币堆 = 散布：盘面 7 / 8 / 9 个 → 投币口追加 2 / 6 / 30 枚
  //   多线连中：一转 ≥2 条线 → 巨币道具 + 每多一条线 10 枚
  // 蒙特卡洛（30 万转）：Jackpot 0.82% · 宝石 1.75% · 火药桶 1.94% · 金币雨 1.54% · 护栏 2.1% · 多线 0.4% · 金币奖 25%
  slot: {
    cells: { skull: 0.056, gem: 0.101, keg: 0.104, anchor: 0.097, parrot: 0.078, coins: 0.564 },
    coinPay: { 7: 1, 8: 6, 9: 30 },   // 7 格 2 → 1：抵消「攒多了转轮加速」带来的转数增加
    parrotGuard: 3,
    multiBonus: 10,
    maxQueue: 3,
    stop1: 0.9, stop2: 1.3, stop3: 1.7, tease: 0.8, showSeconds: 0.9,
    fastQueue: 2, fastK: 0.75,   // 开转时待转（含这一次）≥ fastQueue：停轮和展示时间 × fastK（瞄得准的玩家不再被「最多攒 3 次」卡死；慢停悬念保留）
  },

  items: { max: 3, coinRain: 22, guardSeconds: 20 },

  // 推落前沿的价值（落海为 0）
  payout: { coin: 1, giant: 6, gem: 20, keg: 0, map: 0 },

  jackpot: { slowmo: 0.25, slowmoSeconds: 0.6, cannonCoins: 36, waterfallCoins: 30, bonus: 50, cannonFrom: [3.09, -1.31, 4.59] },  // cannonFrom：炮口出币点（x 取 ±；船头甲板上的炮，view.js 会按炮口实测覆盖）

  // 藏宝图：每开转一次老虎机，下一片提前 spinAdvance 秒（瞄得准 → 转得多 → 更快集齐）；台上放了 rescueAfter 秒还没推下来
  // （常见是被推板压住、推不动）就由鹦鹉叼回下层台面前半区，避免终局永久卡死
  map: { pieces: 5, firstAt: 30, every: [130, 150], spinAdvance: 3.5, rescueAfter: 150, respawnAfterLost: 20, dropX: 1.8 },

  // 悬赏令奖励（按档）：简单 20 枚、中等一个道具（金币雨 / 护栏）、困难 60 枚；题库和目标数在 src/gameplay/bounties.js
  bounty: { rewards: [{ coins: 20 }, { item: true }, { coins: 60 }] },
  ending: { sailSeconds: 6, chestTipDelay: 1.2, chestCoins: 60, cardDelay: 6.5 },

  // 鹦鹉互动：戳满 pokesPerGift 下，鹦鹉从嘴里甩出几枚金币到台面（冷却按游戏时间计，几乎不影响平衡）
  parrot: { pokesPerGift: 8, giftCoins: 3, giftCooldown: 45, from: [-4.4, 6.9, -4.9], vel: [3.2, 1.2, 1.4] },

  camera: {
    // 34° 俯角 + 长焦（fov 32）：台面占画面宽约 69%，拱顶贴着 HUD 下沿、船舵落在两块 HUD 之间，
    // 两侧仍露出海面（由取景约束搜索得出）。其他镜头（特写 / Jackpot / 终局）用 wideFov，切换时平滑过渡。
    fov: 32,
    wideFov: 46,
    pitchDeg: 34,
    distance: 48.5,
    target: [0, 1, -6],
  },
};
