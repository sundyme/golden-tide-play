// 游戏画面总装：场景（环境 / 机台 / 金币 / 特殊物件 / 资产 / VFX）+ 镜头导演 + 后期 + 事件演出。
// 只读游戏状态、只订阅游戏事件；唯一会"反向"影响节奏的是 timeScale（宝石慢镜头）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { buildEnvMap, buildSea, buildLights, buildSkyDome, PAL } from './environment.js';
import { Machine, DECK_Y } from './machine.js';
import { CoinField } from './coins.js';
import { SpecialsView } from './specials.js';
import { SlotReels, buildReelTexture } from './reels.js';
import { Director } from './director.js';
import { Parrot } from './parrot.js';
import { candyize, candy, C } from './candy.js';
import { Post, QUALITY } from './post.js';
import { CoinFX } from '../vfx/coinfx.js';
import { Effects } from '../vfx/effects.js';

const ASSET = './public/assets/';
const lerp = (a, b, k) => a + (b - a) * k;

export class GameView {
  constructor(canvas, config, quality = 'high') {
    this.cfg = config;
    this.q = QUALITY[quality] ?? QUALITY.high;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.dprMax = Math.min(devicePixelRatio, this.q.dprMax);
    this.dpr = this.dprMax;
    r.setPixelRatio(this.dpr);
    r.toneMapping = THREE.NeutralToneMapping;   // D1：Neutral 保留糖果色的色相和饱和度（ACES 会把粉紫压脏）
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = this.scene = new THREE.Scene();
    scene.background = PAL.skyHorizon.clone();
    scene.fog = new THREE.Fog(new THREE.Color('#d6f1ff'), 70, 260);
    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 9 / 16, 0.5, 420);
    this.director = new Director(this.camera, config);
    this._ray = new THREE.Raycaster(); this._ndc = new THREE.Vector2(); this._gazeV = new THREE.Vector3();
    this.lights = buildLights(scene);
    this.lights.key.shadow.mapSize.set(this.q.shadows, this.q.shadows);

    this.exposure = 0.6;
    this.timeScale = 1;          // 演出慢镜头（与游戏的 timeScale 相乘）
    this.slowT = 0;
    this.fxState = { surge: 0, gold: 0, flash: 0, sunrise: 0 };
    this.targets = { surge: 0, gold: 0, sunrise: 0 };
    this.lostBurst = [];
    this.ready = this._load();
  }

  async _load() {
    const texLoader = new THREE.TextureLoader();
    const tex = url => texLoader.loadAsync(ASSET + url);
    const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/');
    this.gltf = new GLTFLoader().setDRACOLoader(draco);
    let [faces, reelTexture, kit, badge] = await Promise.all([tex('textures/coin_faces.png'), buildReelTexture(), this.gltf.loadAsync(ASSET + 'models/machine.glb'), tex('ui/sym_skull.webp')]);
    // 徽章图透明处底色是抠图绿，过滤时会渗出绿边：先合成到深色底上
    { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
      g.fillStyle = '#fff3e2'; g.fillRect(0, 0, 512, 512); g.drawImage(badge.image, 0, 0, 512, 512);
      badge = new THREE.CanvasTexture(c); badge.colorSpace = THREE.SRGBColorSpace; badge.anisotropy = 4; }
    this.scene.environment = buildEnvMap(this.renderer);

    this.machine = new Machine(this.scene, this.cfg, { reelTexture, kit: kit.scene, badgeTex: badge });
    this.reels = new SlotReels(this.machine.reels);
    this.sea = buildSea(this.machine.hullRect);
    this.scene.add(this.sea);
    this.sky = buildSkyDome();
    this.scene.add(this.sky);
    this.coins = new CoinField(this.scene, this.cfg, faces);
    await this._props();
    this.specials = new SpecialsView(this.scene, this.cfg, this.kegModel, this.mapModel);
    this.fx = new CoinFX(this.scene, this.coins.geo, this.coins.mat, {
      chestMouth: new THREE.Vector3(0, DECK_Y + 1.66 * this.chestScale, this.chestZ),   // 箱沿高度
      chestSize: [3.6, 1.95],
      seaY: this.sea.position.y,
      pile: this.chestPile, chestFloor: this.chestFloor,
    });
    this.fx.prefill(Math.round(this.fx.pileMax * 0.55));
    this.effects = new Effects(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera, this.q);
    if (this.w) this.resize(this.w, this.h);
    // 预编译全部着色器，避免开局第一次看到新材质时卡一下
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { /* 旧浏览器没有 compileAsync */ }
  }

  // 黄铜 T 形栖架：底座环 + 短立杆 + 木横杆（两端黄铜帽）+ 小食槽
  _perch(p) {
    const brass = this.machine.m.brass, wood = this.machine.m.woodDark;
    const g = new THREE.Group(); g.position.copy(p); g.rotation.y = 0.32;
    const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.4, 0.46, 0.14, 20), brass, 0, 0.07, 0);
    add(new THREE.CylinderGeometry(0.07, 0.09, 0.66, 12), brass, 0, 0.45, 0);
    add(new THREE.SphereGeometry(0.11, 12, 8), brass, 0, 0.78, 0);
    add(new THREE.CylinderGeometry(0.075, 0.075, 1.9, 12), wood, 0, 0.8, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.12, 12, 8), brass, s * 0.97, 0.8, 0);
    add(new THREE.CylinderGeometry(0.17, 0.12, 0.16, 14, 1, true), brass, 0.72, 0.62, 0.0);
    this.scene.add(g);
  }

  async _props() {
    const loader = this.gltf;
    const M = this.cfg.machine;
    const load = async file => {
      const g = (await loader.loadAsync(ASSET + 'models/' + file)).scene;
      g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      return g;
    };
    const [parrot, cannon, chest, keg, anchor, island] = await Promise.all(['parrot.glb', 'cannon.glb', 'chest.glb', 'keg.glb', 'anchor.glb', 'island.glb'].map(load));
    const put = (g, pos, rotY = 0, s = 1) => { g.position.set(...pos); g.rotation.y = rotY; g.scale.setScalar(s); this.scene.add(g); return g; };
    // D1：道具材质换成共享糖果材质（名字映射，见 candy.js）
    for (const g of [parrot, cannon, chest, keg]) candyize(g, { medal: this.machine.m.medal });
    this.kegModel = keg.clone();
    this.giantChest = chest.clone();          // 终局巨型宝箱（带盖）

    // 鹦鹉「铜板」：站在左后立柱顶的黄铜 T 形栖架上，侧身朝台面 / 玩家（画面左上，衬着夜海）
    const perchAt = new THREE.Vector3(-6.65, 4.06, M.backWallZ + 0.3);   // D1-53：从柜角立柱（-5.62）挪到左侧甲板的独立立柱上，给滑轨连杆让位（鹦鹉包围盒 x 收在 -5.45 以外）
    this._perch(perchAt);
    put(parrot, [perchAt.x, perchAt.y + 0.86, perchAt.z], 0.32, 1.05);   // Rodin 鹦鹉帽子大，比程序化版本缩小一点
    this.parrot = new Parrot(parrot);
    // 专属暖色补光：让鹦鹉在夜色里跳出来（只照近处）
    const pl = this.parrotLight = new THREE.PointLight(0xfff0e0, 2.5, 7, 1.6);
    pl.position.set(perchAt.x + 1.6, perchAt.y + 3.6, perchAt.z + 2.4);
    this.scene.add(pl);
    // 点选用的包围盒（静止姿态 + 外扩，手指也好点中）
    this.scene.updateMatrixWorld(true);
    this.parrotBox = new THREE.Box3().setFromObject(parrot).expandByScalar(0.45);
    // 船炮：架在老虎机罩两侧的木托架上，炮口斜指台面（Jackpot 时朝台面喷金币）
    const ledgeMat = this.machine.m.purple;
    const trimMat = this.machine.m.cream;
    this.cannons = [-1, 1].map(s => {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.32, 2.6), ledgeMat);
      ledge.visible = false; ledge.castShadow = ledge.receiveShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 2.66), trimMat);   // 外沿黄铜包边
      trim.visible = false;   // 第二轮：船炮直接架在加宽后的船舷扶手上
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.9, 8), trimMat);
      brace.visible = false;   // 第二轮：炮架直接坐在加高的船舷上，不需要斜撑
      this.scene.add(ledge, trim, brace);
      const c = put(s < 0 ? cannon : cannon.clone(), [s * 7.7, 1.3, -8.4], -s * 0.95, 0.95);   // v6：机罩两侧高处的船舷上，炮口斜朝外
      const barrel = c.getObjectByName('barrel'); if (barrel) barrel.rotation.x = -0.12;
      return { root: c, barrel, base: barrel?.position.clone(), side: s, recoil: 0 };
    });
    // 炮口位置 → 规则层的出币点（两者对齐，金币真的从炮口飞出）
    this.scene.updateMatrixWorld(true);
    const c0 = this.cannons[1];
    if (c0.barrel) {
      const muzzle = this.muzzleLocal = new THREE.Vector3();
      const lb = new THREE.Box3(); c0.barrel.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); lb.union(o.geometry.boundingBox); } });
      muzzle.set((lb.min.x + lb.max.x) / 2, (lb.min.y + lb.max.y) / 2, lb.max.z);
      const w = c0.barrel.localToWorld(muzzle.clone());
      this.cfg.jackpot.cannonFrom = [Math.abs(w.x), w.y, w.z];
    }
    // 收币宝箱：前裙板正前方，敞口（第一版 Rodin 合盖宝箱在骷髅锁扣上沿切开 + 布尔挖内腔，见 props_rodin_d1.chest_cut）
    // 模型 × CHEST_S（v6：宝箱约占画面宽 38%，1.6 偏大）：外宽 4.56、外深 3.02；内腔 3.64 × 1.99、箱底离甲板 0.49、箱沿高 2.32
    const CS = this.chestScale = 1.4;
    this.chestZ = M.tableFrontZ + 0.6 + 1.08 * CS;   // 后沿离前裙板一点点
    this.chest = put(chest, [0, DECK_Y, this.chestZ], 0, CS);
    const lid = this.chest.getObjectByName('lid'); if (lid) lid.visible = false;   // 收币宝箱不带盖（掀开的盖子会横在下层台面上）；终局巨宝箱用盖子开箱
    // 箱内金币堆：物理烘焙的位姿（tools/bake_chestpile.mjs 3.6 1.95 1.83），相对箱底中心
    this.chestFloor = new THREE.Vector3(0, DECK_Y + 0.35 * CS, this.chestZ);
    this.chestPile = await fetch('./public/assets/chestpile.json').then(r => r.ok ? r.json() : null).catch(() => null);
    // 终局巨型宝箱：同一份烘焙金币堆装满（宝箱本地坐标 = 世界 / CS）
    if (this.chestPile) {
      const P = this.chestPile, gp = new THREE.InstancedMesh(this.coins.geo, this.coins.mat, P.coins.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3().setScalar(P.scale / CS);
      P.coins.forEach((c, i) => {
        gp.setMatrixAt(i, m4.compose(new THREE.Vector3(c[0] / CS, 0.35 + c[1] / CS, c[2] / CS), q.set(c[3], c[4], c[5], c[6]), sc));
        gp.setColorAt(i, new THREE.Color().setHSL(0.105 + (i % 7) * 0.003, 0.92, 0.54));
      });
      this.giantChest.add(gp);
    }
    // 甲板摆件（第二轮：全部是 Codex 参考图 → Rodin 生成的糖果道具，见需求单 08；位置照概念图的船头两角）
    const [lifering, skullball, starfish, barrel, ropecoil] = await Promise.all(['lifering.glb', 'skullball.glb', 'starfish.glb', 'barrel.glb', 'ropecoil.glb'].map(load));
    const mapscroll = await load('mapscroll.glb');
    // 幸运圆环的海盗帽（需求单 12 · T → Rodin）
    const hoophat = await load('hoophat.glb');
    candyize(hoophat);
    hoophat.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.machine.attachHat(hoophat);
    // 吐币骷髅（需求单 13 · U → Rodin，嘴里切了币槽：props_rodin_d1.skull_dropper）
    const skulldropper = await load('skulldropper.glb').catch(() => null);
    if (skulldropper) { candyize(skulldropper); this.machine.attachDropperSkull(skulldropper); }
    for (const g of [lifering, skullball, starfish, barrel, ropecoil, mapscroll]) candyize(g);
    this.mapModel = mapscroll;
    // v6 构图：救生圈在宝箱左侧、海星在宝箱左前、木桶在宝箱右侧、骷髅浮球在右下角，盘绳靠两侧船舷
    // D1-45：按实测占地半径摆（盘绳 0.97·s、木桶 0.69·s、火药桶 0.75·s、救生圈 1.13·s、骷髅浮球 1.0·s、海星 0.67·s），
    // 避开：前裙板 / 槽尾角柱（z < 3.75）、前角立柱 (±5.55, 3.75) r0.42、船头舷墙内侧（z 5 → 7.1，z 7.5 → 5.9）、宝箱 |x| < 2.3
    const cz = this.chestZ;
    put(lifering, [-4.5, DECK_Y, cz + 0.69], 0.35, 1.25);
    put(starfish, [-2.9, DECK_Y + 0.02, cz + 2.29], 0.6, 1.2);
    put(ropecoil, [-6.3, DECK_Y, cz - 0.96], 0.0, 0.8);
    put(barrel, [3.35, DECK_Y, cz - 0.56], 0.3, 1.2);
    put(skullball, [3.9, DECK_Y, cz + 1.59], -0.55, 1.3);
    put(ropecoil.clone(), [5.7, DECK_Y, cz - 0.41], 1.2, 0.8);
    // 两侧甲板（柜壁外侧 5.86 到舷墙内侧 7.9 的长条，中线 x = ±6.88）：木桶 / 盘绳 / 火药桶。
    // 骷髅旗挂在 z = -4.2 / -0.6 / 3.0（各 ±0.73，下沿 y -1.95）：高的桶避开旗面，矮的盘绳可以放在旗下
    put(keg, [-6.88, DECK_Y, 1.3], 0.3, 1.05);
    put(ropecoil.clone(), [-6.88, DECK_Y, -0.6], 2.1, 0.9);
    put(barrel.clone(), [-6.88, DECK_Y, -2.45], 0.2, 0.95);
    put(barrel.clone(), [6.88, DECK_Y, 1.3], 0.8, 1.0);
    put(ropecoil.clone(), [6.88, DECK_Y, -0.6], 0.4, 0.9);
    put(keg.clone(), [6.88, DECK_Y, -2.45], 2.0, 0.95);
    void anchor;   // v1 的黄铜锚与 D1 糖果风不搭，不再摆
    // 远景小岛：夜里在船尾方向；终局的金币岛在船头前方
    // 远景小岛：在雾里若隐若现，岛上有几点暖色灯火
    const isles = [put(island, [-19, -6.3, -52], 0.9, 0.8), put(island.clone(), [21, -6.5, -92], -1.2, 0.85), put(island.clone(), [-40, -6.8, -130], 2.0, 1.4)];
    // 夜里的远岛：压暗、偏冷，只剩轮廓和灯火（金币岛另有材质，不受影响）
    for (const isle of isles) isle.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(1.05, 1.0, 1.05)); o.material.envMapIntensity = 0.4; o.castShadow = false; } });
    const lampTex = this._glowTex(); this.lamps = [];
    for (const [k, isle] of isles.entries()) for (let i = 0; i < 0; i++) {   // D1 白天：远岛不点灯
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTex, color: new THREE.Color(0xffa040).multiplyScalar(4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      sp.position.copy(isle.position).add(new THREE.Vector3((Math.random() - 0.5) * 14 * isle.scale.x, 1.6 + Math.random() * 2.5, (Math.random() - 0.5) * 6));
      sp.scale.setScalar(1.6 + Math.random()); sp.userData.ph = Math.random() * 6;
      this.scene.add(sp); (this.lamps ??= []).push(sp);
    }
    this.goldIsland = put(island.clone(), [6, -7, 200], 2.4, 3.6);
    this._gildIsland();
    this.goldIsland.visible = false;
  }

  _glowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.2, 'rgba(255,255,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // 金币岛：从上往下打射线，把金币撒在岛的表面上（沙滩 / 岩石，避开树冠）
  _gildIsland() {
    const I = this.goldIsland;
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(I);
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
    const N = 520, mesh = new THREE.InstancedMesh(this.coins.geo, this.coins.mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, rx = (box.max.x - box.min.x) / 2, rz = (box.max.z - box.min.z) / 2;
    let n = 0;
    for (let tries = 0; tries < N * 6 && n < N; tries++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.85;
      ray.set(new THREE.Vector3(cx + Math.cos(a) * rx * r, box.max.y + 5, cz + Math.sin(a) * rz * r), down);
      const hit = ray.intersectObject(I, true)[0];
      if (!hit || hit.point.y > box.min.y + (box.max.y - box.min.y) * 0.35 || hit.point.y < -5.6) continue;
      const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (nrm.y < 0.6) continue;
      q.setFromUnitVectors(up, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), Math.random() * 0.5));
      p.copy(hit.point).addScaledVector(nrm, 0.05);
      mesh.setMatrixAt(n, m.compose(p, q, s.setScalar(2.2 + Math.random() * 1.2)));
      mesh.setColorAt(n, new THREE.Color().setHSL(0.105 + Math.random() * 0.02, 0.92, 0.52));
      n++;
    }
    mesh.count = n;
    // 世界坐标的实例 → 挂在场景根上，随岛一起显隐
    mesh.frustumCulled = false;
    this.goldCoins = mesh; mesh.visible = false;
    this.scene.add(mesh);
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 以 9:16 的水平视野为基准：更窄更高的屏幕（手机）保持左右取景，竖向多看一些（由镜头导演按当前 fov 适配）
    const D = this.director;
    if (D) { D.aspect = w / h; this.camera.fov = D._fit(D.fov); }
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, this.dpr);
  }

  // 设置里切换画质：DPR 上限 / MSAA / Bloom / 移轴 / 阴影贴图
  setQuality(name) {
    const q = this.q = QUALITY[name] ?? QUALITY.high;
    this.dprMax = Math.min(devicePixelRatio, q.dprMax); this.dpr = this.dprMax;
    const sh = this.lights.key.shadow;
    sh.mapSize.set(q.shadows, q.shadows); sh.map?.dispose(); sh.map = null;
    if (this.post) {
      this.post.bloom.enabled = q.bloom;
      this.post.finish.uniforms.blur.value = q.tiltShift ? 0.75 : 0;
      for (const rt of [this.post.composer.renderTarget1, this.post.composer.renderTarget2]) { rt.samples = q.msaa; rt.dispose(); }
    }
    this.resize(this.w, this.h);
  }

  // 动态分辨率：1.5 s 窗口取帧时中位数（单次卡顿不算）；持续慢 → 降一档；稳定贴着垂直同步 → 试升一档，
  // 试升后变慢就退回并把该档锁 30 s。注意 60 Hz 下帧时最低就是 16.7 ms，不能用"比 16.7 快很多"做升档条件。
  adaptQuality(frameMs) {
    const now = performance.now();
    this._aq ??= { buf: [], t0: now + 3000, last: now, trial: null, banned: {} };
    const A = this._aq;
    if (now < A.t0) return;                       // 开局 3 s 内不调（着色器编译、资源上传）
    A.buf.push(frameMs);
    if (now - A.last < 1500) return;
    const sorted = A.buf.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1];
    const slow = A.buf.filter(x => x > 22).length / A.buf.length;
    A.buf.length = 0; A.last = now;
    let d = this.dpr;
    if (A.trial && med > 19) { A.banned[A.trial] = now + 30000; d = A.trial - 0.25; A.trial = null; }
    else if (med > 21 && d > 0.75) d -= 0.25;
    else if (med < 17.8 && slow < 0.05 && d < this.dprMax && !((A.banned[d + 0.25] ?? 0) > now)) { d = Math.min(this.dprMax, d + 0.25); A.trial = d; }
    else A.trial = null;
    if (d !== this.dpr) { this.dpr = d; this.resize(this.w, this.h); }
  }

  // ---------- 游戏事件 → 演出 ----------
  onEvent(e, game) {
    const P = this.parrot, D = this.director, FX = this.effects;
    switch (e.type) {
      case 'drop': this.firstDropDone = true; break;
      case 'gate':
        this.machine.gateFlash = 1;
        FX.burst(this.machine.gateGroup.getWorldPosition(new THREE.Vector3()).setY(this.cfg.gate.y), 0x7ff8ff, 12, 0.55);
        break;
      case 'spinStart': this.reels.start(); this.tease = e.tease; break;
      case 'reelStop': this.reels.stop(e.i, ['skull', 'gem', 'keg', 'anchor', 'parrot'].indexOf(e.symbol)); break;
      case 'slotResult':
        if (e.result !== 'none') this.fxState.flash = e.result === 'pair' ? 0.6 : 1.4;
        if (['gem', 'keg', 'anchor', 'parrot', 'pairAnchor'].includes(e.result)) P.set('cheer', 1.4, 2);
        this.tease = false;
        break;
      case 'payout': this._payout(e); break;
      case 'lost': this._lost(e); break;
      case 'kegBoom': {
        const p = new THREE.Vector3(e.x, 0.6, e.z);
        FX.explosion(p); D.bump(0.9); P.set('worry', 1.2, 3);
        break;
      }
      case 'specialDrop': P.set('worry', 0.9, 1); break;
      case 'surgeStart': this.targets.surge = 1; D.bump(0.5); P.set('cheer', 1.6, 2); break;
      case 'surgeEnd': this.targets.surge = 0; break;
      case 'jackpotStart': this.targets.gold = 1; P.set('dance', 999, 5); D.bump(0.4); break;
      case 'jackpotCannons': D.set('jackpot', null, 1.8); break;
      case 'cannonFire': {
        const c = this.cannons[e.side < 0 ? 0 : 1];
        c.recoil = 1;
        if (e.k < 2 || e.k % 6 < 2) { FX.muzzle(c.barrel.localToWorld(this.muzzleLocal.clone())); D.bump(0.25); }
        break;
      }
      case 'jackpotTitle': D.set('play', null, 1.6); break;
      case 'jackpotEnd': this.targets.gold = 0; P.set('idle', 0, 9); break;
      case 'endingStart': D.set('stern', null, 1.1); this.targets.sunrise = 1; this.goldIsland.visible = this.goldCoins.visible = true; P.set('cheer', 3, 4); break;
      case 'giantChest': D.set('play', null, 1.5); this._giantChestIn(); break;
      case 'chestPour': this.chestPour = 0; P.set('dance', 999, 5); break;
      case 'endingCard': this.targets.gold = 0; P.set('idle', 0, 9); break;
      case 'endingDone': this.targets.sunrise = 0; this.goldIsland.visible = this.goldCoins.visible = false; break;
      case 'comboEnd': if (e.n >= 5) P.set('cheer', 1.4, 2); break;
      case 'itemUse': if (e.item === 'guard') P.set('cheer', 1.2, 2); break;
    }
  }

  _payout(e) {
    const o = e.coin;
    if (e.obj === 'keg') { const m = this.specials.claim(o.id); if (m) this.scene.remove(m); return; }
    if (e.obj === 'map') { const m = this.specials.claim(o.id); this.fx.spawn({ ...e, kind: 'front' }, m); this.parrot.set('cheer', 1.6, 3); return; }
    if (e.obj === 'gem') {
      const m = this.specials.claim(o.id);
      if (m) m.userData.sparkColor = 0x8fd1ff;
      this.fx.spawn({ ...e, kind: 'front' }, m);
      // 慢镜头 + 特写
      this.slowT = 1.1; this.timeScale = 0.3;
      const p = o.body.translation();
      this.director.set('closeup', new THREE.Vector3(p.x, 0, p.z + 1), 4);
      this.parrot.set('cheer', 2, 3);
      return;
    }
    this.fx.spawn({ ...e, kind: 'front' });
    if (e.obj === 'giant') this.director.bump(0.3);
  }

  _lost(e) {
    const o = e.coin;
    const m = e.obj === 'coin' || e.obj === 'giant' ? null : this.specials.claim(o.id);
    this.fx.spawn({ ...e, kind: 'side' }, m);
    const now = performance.now();
    this.lostBurst = this.lostBurst.filter(t => now - t < 2500); this.lostBurst.push(now);
    if (this.lostBurst.length >= 3 || e.obj === 'map') { this.parrot.set('sigh', 1.8, 2); this.lostBurst = []; }
  }

  _giantChestIn() {
    const g = this.giantChest;
    g.position.set(0, 6.2, -4.6); g.rotation.set(0, 0, 0); g.scale.setScalar(0.01);
    this.scene.add(g);
    this.giantT = 0;
    this.chestPour = null;
  }

  _updateGiantChest(dt) {
    if (this.giantT === undefined || this.giantT === null) return;
    this.giantT += dt;
    const g = this.giantChest, t = this.giantT;
    const lid = g.getObjectByName('lid');
    // 出现（回弹放大）→ 悬停 → 翻倒倾倒 → 收起
    const S = 1.8, s = t < 0.6 ? S * (1 + Math.sin(Math.min(1, t / 0.6) * Math.PI) * 0.15) * Math.min(1, t / 0.45) : S;
    g.scale.setScalar(Math.max(0.01, s));
    g.position.y = 6.2 + Math.sin(t * 2) * 0.15;
    if (this.chestPour !== null) {
      this.chestPour += dt;
      const k = Math.min(1, this.chestPour / 0.9);
      g.rotation.x = 1.6 * (k * k * (3 - 2 * k));            // 朝台面（+z）翻倒，箱口朝前下
      if (lid) lid.rotation.x = -1.9 * k;
      if (this.chestPour > 0.3 && this.chestPour < 3) this.effects.trickle(g.localToWorld(new THREE.Vector3(0, 2.0, 0.6)));
      if (this.chestPour > 4.5) {
        const k2 = Math.min(1, (this.chestPour - 4.5) / 0.8);
        g.scale.setScalar(1.8 * (1 - k2) + 0.01); g.position.y += k2 * 6;
        if (k2 >= 1) { this.scene.remove(g); this.giantT = null; }
      }
    }
  }

  // ---------- 每帧 ----------
  update(sim, game, alpha, t, dt, input) {
    if (!this.post) return;
    // 演出慢镜头计时（真实时间）
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) { this.timeScale = 1; this.director.set('play', null, 2.4); } }
    const sdt = dt * this.timeScale * game.timeScale;
    // 环境状态平滑过渡
    const F = this.fxState, T = this.targets;
    F.surge = lerp(F.surge, T.surge, 1 - Math.exp(-dt * 1.8));
    F.gold = lerp(F.gold, T.gold, 1 - Math.exp(-dt * 2.5));
    F.sunrise = lerp(F.sunrise, T.sunrise, 1 - Math.exp(-dt * 0.6));
    F.flash = Math.max(0, F.flash - dt);
    this._applyEnv(t);

    const reelAngles = this.reels.update(sdt);
    this.machine.update(sim, alpha, t, {
      dropX: input.dropX, guards: game.guardT > 0, surge: game.surgeT > 0 ? 1 : 0, tide: game.tide,
      chase: (1 + F.surge * 1.5) * (this.tease ? 2.2 : 1) * (this.reels.spinning ? 1.6 : 1),
      bulbFlash: Math.min(1, F.flash), gold: F.gold, reelAngles, dt,
    });
    this.coins.update(sim.coins, alpha);
    this.specials.update(sim.coins, alpha);
    this.fx.update(sdt, t);
    this.effects.update(sdt, t);
    this._updateCannons(dt);
    for (const l of this.lamps) l.material.opacity = 0.75 + 0.25 * Math.sin(t * 3 + l.userData.ph) * Math.sin(t * 7.3 + l.userData.ph * 2);
    this._updateGiantChest(sdt);

    // 鹦鹉：开局引导（还没投过币时看投币口）、悬崖紧张
    // 鹦鹉视线：被悬停时看镜头（看玩家），平时盯着投币口上方玩家瞄准的位置
    const P = this.parrot, M = this.cfg.machine;
    P.lookAt = P.hoverOn ? this.camera.position : this._gazeV.set(input.dropX ?? 0, M.dropY, M.dropZ);
    if (!this.firstDropDone && t > 1.5 && this.parrot.mood === 'idle') this.parrot.set('hint', 999, 1);
    if (this.firstDropDone && this.parrot.mood === 'hint') this.parrot.set('idle', 0, 9);
    if (this.parrot.mood === 'idle' && sim.cliffCount() >= 14 && Math.cos(sim.phase) > 0.6 && Math.random() < dt * 0.15) this.parrot.set('worry', 1.6, 1);
    this.parrot.update(sdt, t);

    const sway = sim.swayEnabled ? this.cfg.tide.swayDeg * Math.PI / 180 * Math.sin(sim.time * 2 * Math.PI / this.cfg.tide.swayPeriod) : 0;
    this.director.update(dt, t, { surge: F.surge, sway });
    this.post.render(dt);
  }

  _applyEnv(t) {
    const F = this.fxState;
    // 大潮：起风变天（天色压暗偏紫、偶发闪光）；Jackpot：全场金色补光；终局：糖果色晚霞
    if (F.surge > 0.5 && Math.random() < 0.006) this.lightning = 1;
    this.lightning = Math.max(0, (this.lightning || 0) - 0.06);
    const lt = this.lightning > 0.5 ? 1 : this.lightning * 0.6;
    const su = this.sea.material.uniforms;
    su.time.value = t; su.surge.value = F.surge; su.gold.value = F.sunrise;
    const sk = this.sky.material.uniforms; sk.gold.value = F.sunrise; sk.time.value = t;
    this.renderer.toneMappingExposure = (window.__exp ?? this.exposure) * (1 - 0.18 * F.surge) * (1 + lt * 0.3);
    const L = this.lights, K = window.__L || {};   // __L：调光实验用的倍率（hemi / key / env）
    L.hemi.intensity = 0.2 * (K.hemi ?? 1) * (1 - 0.25 * F.surge) + lt * 1.2;
    L.hemi.color.setRGB(lerp(0.86, 1.0, F.sunrise), lerp(0.94, 0.8, F.sunrise), lerp(1.0, 0.8, F.sunrise));
    L.key.intensity = 3.7 * (K.key ?? 1) * (1 - 0.35 * F.surge) + lt * 3;
    L.key.color.setRGB(1.0, lerp(0.95, 0.78, F.sunrise), lerp(0.87, 0.62, F.sunrise));
    L.warm.intensity = 0.45 + F.gold * 1.1;
    L.warm.color.setRGB(1.0, lerp(0.78, 0.82, F.gold), lerp(0.85, 0.4, F.gold));
    this.scene.environmentIntensity = 0.45 * (K.env ?? 1) + F.gold * 0.25;   // 第二轮：压低环境/天光填充、加强主光 → 有明暗面，颜色不再发粉发灰
    this.scene.fog.far = 260 + F.sunrise * 360;
    this.scene.fog.color.setRGB(lerp(0.84, 1.0, F.sunrise) * (1 - 0.25 * F.surge), lerp(0.95, 0.8, F.sunrise) * (1 - 0.2 * F.surge), lerp(1.0, 0.78, F.sunrise));
    this.post.finish.uniforms.warmth.value = F.gold * 0.5 + F.sunrise * 0.3;
    this.post.bloom.strength = 0.32 + F.gold * 0.15 + F.surge * 0.05;
  }

  _updateCannons(dt) {
    for (const c of this.cannons) {
      if (!c.barrel) continue;
      c.recoil = Math.max(0, c.recoil - dt * 6);
      c.barrel.position.copy(c.base).add(new THREE.Vector3(0, 0, -0.35 * c.recoil));
    }
  }

  // 指哪投哪：屏幕点 → 射线打到台面高度（y=0）取 x；u, v 为画布内 0..1
  dropXAt(u, v) {
    const ray = this._ray ??= new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-4) return 0;
    return o.x + d.x * (-o.y / d.y);
  }

  // 屏幕坐标（UI 气泡跟随鹦鹉 / 数字飞出点）
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.w, y: (-p.y * 0.5 + 0.5) * this.h };
  }
  parrotScreen() { return this.toScreen(this.parrot.headWorld()); }
  parrotTopScreen() { return this.toScreen(this.parrot.topWorld()); }
  // 屏幕归一化坐标 (u, v) 是否点中鹦鹉（只在游戏镜头下可互动）
  parrotHit(u, v) {
    if (!this.parrotBox || this.director.mode !== 'play') return false;
    this._ray.setFromCamera(this._ndc.set(u * 2 - 1, 1 - v * 2), this.camera);
    return this._ray.ray.intersectsBox(this.parrotBox);
  }
  // 羽毛 / 火花从鹦鹉身上迸出（互动反馈）
  parrotFX(kind) {
    const p = this.parrot.root.position.clone().add(new THREE.Vector3(0, 2.2, 0.3));
    this.effects.feathers(p, kind === 'ruffle' ? 14 : kind === 'spin' ? 10 : 6);
    if (kind === 'gift') this.effects.burst(p.clone().add(new THREE.Vector3(0.6, 0.6, 0.6)), 0xffd76a, 12, 0.5, 5);
  }
  chestScreen() { return this.toScreen(new THREE.Vector3(0, DECK_Y + 1.66 * this.chestScale, this.chestZ)); }
}
