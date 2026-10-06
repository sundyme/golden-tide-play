// 游戏画面总装：场景（环境 / 机台 / 金币 / 特殊物件 / 资产 / VFX）+ 镜头导演 + 后期 + 事件演出。
// 只读游戏状态、只订阅游戏事件；唯一会"反向"影响节奏的是 timeScale（宝石慢镜头）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { buildEnvMap, buildSea as buildSeaV1, buildLights, buildSkyDome, PAL } from './environment.js';
import { buildSea, SEA_QUALITY } from './sea.js';
import { buildSeaV0 } from './sea_v0.js';
import { buildSeaMoon } from './sea_moon.js';
import { Machine, DECK_Y } from './machine.js';
import { CoinField } from './coins.js';
import { SpecialsView } from './specials.js';
import { SlotReels, loadReelArt } from './reels.js';
import { Director } from './director.js';
import { Parrot } from './parrot.js';
import { Post, QUALITY } from './post.js';
import { CoinFX } from '../vfx/coinfx.js';
import { Effects } from '../vfx/effects.js';

const ASSET = './public/assets/';
const lerp = (a, b, k) => a + (b - a) * k;
const DPR_FLOOR = { high: 1.5, medium: 1, low: 0.75 };   // 动态分辨率的下限（见 adaptQuality）

export class GameView {
  constructor(canvas, config, quality = 'high') {
    this.cfg = config;
    this.q = QUALITY[quality] ?? QUALITY.high; this.qName = QUALITY[quality] ? quality : 'high';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.dprMax = Math.min(devicePixelRatio, this.q.dprMax);
    this.dpr = this.dprMax;
    r.setPixelRatio(this.dpr);
    r.toneMapping = THREE.ACESFilmicToneMapping;   // ACES：高光里的金色保持饱和（AgX 会把亮金洗成奶白）
    r.toneMappingExposure = 0.8;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;   // PCF + shadow.radius 已经够柔；PCFSoft 每个受光像素多采十几次，GPU 贵约 2 ms

    const scene = this.scene = new THREE.Scene();
    scene.background = PAL.seaDeep.clone();
    scene.fog = new THREE.Fog(new THREE.Color('#16244a'), 62, 200);
    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 9 / 16, 0.5, 900);   // 远裁剪面 900：终局船尾镜头要看到金币岛前的整片海
    this.director = new Director(this.camera, config);
    this._ray = new THREE.Raycaster(); this._ndc = new THREE.Vector2(); this._gazeV = new THREE.Vector3();
    this.lights = buildLights(scene);
    this.lights.key.shadow.mapSize.set(this.q.shadows, this.q.shadows);

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
    let [faces, sky, goldSky, reelArt, kit, badge] = await Promise.all([tex('textures/coin_faces.png'), tex('textures/sky_far_full.webp'), tex('textures/gold_island_full.webp'), loadReelArt(), this.gltf.loadAsync(ASSET + 'models/machine.glb'), tex('ui/sym_skull.webp')]);
    // 徽章图透明处底色是抠图绿，过滤时会渗出绿边：先合成到深色底上
    { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
      g.fillStyle = '#20140a'; g.fillRect(0, 0, 512, 512); g.drawImage(badge.image, 0, 0, 512, 512);
      badge = new THREE.CanvasTexture(c); badge.colorSpace = THREE.SRGBColorSpace; badge.anisotropy = 4; }
    sky.colorSpace = goldSky.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = buildEnvMap(this.renderer, sky);

    this.machine = new Machine(this.scene, this.cfg, { reelStrips: reelArt.strips, kit: kit.scene, badgeTex: badge });
    this.reels = new SlotReels(this.machine.reels, reelArt);
    // 海面 v3：第一版的月光碎银观感 + v2 的结构修复（sea_moon.js）。对比用：?sea=v0 第一版原样，?sea=v1 v1.5 笔触，?sea=v2 色阶 Gerstner
    const seaV = new URLSearchParams(location.search).get('sea'), H = this.machine.hullRect;
    this.sea = seaV === 'v0' ? buildSeaV0(H, PAL) : seaV === 'v1' ? buildSeaV1(H) : seaV === 'v2' ? buildSea(H, PAL, this.qName) : buildSeaMoon(H, PAL, this.qName);
    this.scene.add(this.sea);
    this.sky = buildSkyDome(sky, goldSky);
    if (this.sea.material.uniforms.goldTex) this.sea.material.uniforms.goldTex.value = goldSky;
    this.scene.add(this.sky);
    this.coins = new CoinField(this.scene, this.cfg, faces);
    await this._props();
    this.specials = new SpecialsView(this.scene, this.cfg, this.kegModel);
    this.fx = new CoinFX(this.scene, this.coins.geo, this.coins.mat, {
      chestMouth: new THREE.Vector3(0, DECK_Y + 2.45, this.chestZ),   // 箱沿高度（实测包围盒顶 ≈ DECK_Y + 2.49）
      chestSize: [4.6, 3.0],
      seaY: this.sea.position.y,
      // 落海槽（machine_v2.py：台边黄铜唇 |x| 4.62、槽外壁 5.29、槽底 −1.1、前端 FRONT）；币竖着落，币心留在两壁之间
      chute: { x0: this.cfg.machine.width / 2 + 0.12, x1: this.cfg.machine.width / 2 + 0.56, z1: this.cfg.machine.tableFrontZ - 0.15, floorY: -1.1 },
    });
    this.fx.prefill(65);
    this.effects = new Effects(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera, this.q);
    this._applyClearcoat();
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

  // 甲板盘绳（弗兰德盘法）：平铺螺旋 + 外圈一段搭起 + 绳头；绳子是三股捻在一起的细管，
  // 俯视也能看出一节一节的捻纹（原来 glb 里是一根光滑的管子，像塑料软管）
  _ropeCoil(x, z, rotY = 0, s = 1) {
    const r0 = 0.085, turns = 3.6, rIn = 0.18, rOut = 0.78, path = [];
    const N = 900;
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = t * turns * Math.PI * 2, r = rIn + (rOut - rIn) * t;
      path.push(new THREE.Vector3(Math.cos(a) * r, r0 + (t > 0.9 ? (t - 0.9) * 1.4 : 0), Math.sin(a) * r));
    }
    // 绳头：顺着外圈切线甩出去，落回甲板
    const last = path[path.length - 1], a1 = turns * Math.PI * 2;
    const tan = new THREE.Vector3(-Math.sin(a1), 0, Math.cos(a1));
    for (let i = 1; i <= 60; i++) { const k = i / 60; path.push(last.clone().addScaledVector(tan, k * 0.9).setY(r0 + 0.14 * (1 - k) * (1 - k))); }
    const center = new THREE.CatmullRomCurve3(path);
    const L = center.getLength(), M = Math.round(L * 60);
    const frames = center.computeFrenetFrames(M, false);
    const g = new THREE.Group();
    const mats = [0xcfa877, 0xc29a66, 0xd8b585].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, envMapIntensity: 0.15 }));
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i <= M; i++) {
        const u = i / M, p = center.getPointAt(u), tw = u * L * 2.6 * Math.PI * 2 + k * Math.PI * 2 / 3;
        // 用平行运输的法线 / 副法线绕中心线转：三股等距、匀速捻
        pts.push(p.addScaledVector(frames.normals[i], Math.cos(tw) * r0 * 0.52).addScaledVector(frames.binormals[i], Math.sin(tw) * r0 * 0.52));
      }
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), M, r0 * 0.56, 6, false), mats[k]);
      m.castShadow = m.receiveShadow = true; g.add(m);
    }
    // 中心芯（填缝，免得股间透出甲板）+ 绳头扎线
    const core = new THREE.Mesh(new THREE.TubeGeometry(center, M, r0 * 0.62, 6, false), mats[1]); g.add(core);
    const end = center.getPointAt(1), whip = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 1.1, r0 * 1.1, 0.12, 10), this.machine.m.brassDim);
    whip.position.copy(center.getPointAt(0.985)); whip.lookAt(end); whip.rotateX(Math.PI / 2); g.add(whip);
    g.position.set(x, DECK_Y, z); g.rotation.y = rotY; g.scale.setScalar(s);
    this.scene.add(g);
    return g;
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
    this.kegModel = keg.clone();
    this.giantChest = chest.clone();          // 终局巨型宝箱（带盖）

    // 鹦鹉「铜板」：站在左后立柱顶的黄铜 T 形栖架上，侧身朝台面 / 玩家（画面左上，衬着夜海）
    const perchAt = new THREE.Vector3(-(M.width / 2 + 1.02), 4.06, M.backWallZ + 0.3);
    this._perch(perchAt);
    put(parrot, [perchAt.x, perchAt.y + 0.86, perchAt.z], 0.32, 1.25);
    this.parrot = new Parrot(parrot);
    // 专属暖色补光：让鹦鹉在夜色里跳出来（只照近处）
    const pl = this.parrotLight = new THREE.PointLight(0xffb878, 7, 7, 1.6);
    pl.position.set(perchAt.x + 1.6, perchAt.y + 3.6, perchAt.z + 2.4);
    this.scene.add(pl);
    // 点选用的包围盒（静止姿态 + 外扩，手指也好点中）
    this.scene.updateMatrixWorld(true);
    this.parrotBox = new THREE.Box3().setFromObject(parrot).expandByScalar(0.45);
    // 船炮：立在船头甲板、收币宝箱两侧，炮口斜指台面（Jackpot 时朝台面喷金币）
    // 原来架在机罩后方两侧的木托架上，玩家视角里被机罩挡住，看不到
    this.cannons = [-1, 1].map(s => {
      const c = put(s < 0 ? cannon : cannon.clone(), [s * 4.8, DECK_Y, 6.0], 0, 1.0);
      c.rotation.set(0, -s * 2.57, 0);   // cannon.glb 根节点自带 x / z 翻转 180°，只改 y 会把炮口转反
      const barrel = c.getObjectByName('barrel'); if (barrel) barrel.rotation.x = -0.35;
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
    // 收币宝箱：前裙板正前方，敞口
    this.chestZ = M.tableFrontZ + 0.45 + 1.9 * 0.8 + 0.35;
    this.chest = put(chest, [0, DECK_Y, this.chestZ], 0, 1.6);
    const lid = this.chest.getObjectByName('lid'); if (lid) lid.visible = false;
    // 甲板杂物
    put(keg, [-6.15, DECK_Y, -4.6], 0.5, 1.1);
    put(keg.clone(), [-6.3, DECK_Y, -3.3], -0.3, 0.9);
    put(keg.clone(), [6.2, DECK_Y, -4.2], 2.1, 1.05);
    const a = put(anchor, [3.3, DECK_Y + 0.05, 8.6], -0.95, 0.8); a.rotation.z = 0.3;
    this._ropeCoil(-3.5, 7.6, 0.6, 0.85);
    // 远景小岛：夜里在船尾方向；终局的金币岛在船头前方
    // 远景小岛：在雾里若隐若现，岛上有几点暖色灯火
    const isles = [put(island, [-19, -6.3, -52], 0.9, 0.8), put(island.clone(), [21, -6.5, -92], -1.2, 0.85), put(island.clone(), [-40, -6.8, -130], 2.0, 1.4)];
    // 夜里的远岛：压暗、偏冷，只剩轮廓和灯火（金币岛另有材质，不受影响）
    for (const isle of isles) isle.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(0.3, 0.34, 0.5)); o.material.envMapIntensity = 0.15; o.castShadow = false; } });
    const lampTex = this._glowTex();
    for (const [k, isle] of isles.entries()) for (let i = 0; i < 3 + k; i++) {
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
    const q = this.q = QUALITY[name] ?? QUALITY.high; this.qName = QUALITY[name] ? name : 'high';
    const sd = this.sea?.material.uniforms.detail; if (sd) sd.value = (SEA_QUALITY[this.qName] ?? SEA_QUALITY.high).detail;
    this.dprMax = Math.min(devicePixelRatio, q.dprMax); this.dpr = this.dprMax; this._aq = null;   // 换档后动态分辨率从头观察
    const sh = this.lights.key.shadow;
    sh.mapSize.set(q.shadows, q.shadows); sh.map?.dispose(); sh.map = null;
    if (this.post) {
      this.post.bloom.enabled = q.bloom;
      this.post.finish.uniforms.blur.value = q.tiltShift ? 0.75 : 0;
      this.post.msaa = q.msaa;   // 实际采样数在 resize → post.setSize 里按 DPR 决定
      this._applyClearcoat();
    }
    this.resize(this.w, this.h);
  }

  // 漆面清漆层（第二层高光）只在高画质开：中 / 低画质省掉这部分逐像素光照
  _applyClearcoat() {
    for (const m of Object.values(this.machine.m)) {
      if (m.userData.cc === undefined) m.userData.cc = m.clearcoat ?? 0;
      if (!m.userData.cc) continue;
      const v = this.q.clearcoat ? m.userData.cc : 0;
      if (m.clearcoat !== v) { m.clearcoat = v; m.needsUpdate = true; }
    }
  }

  // 动态分辨率：1.5 s 窗口取帧时中位数（单次卡顿不算）；持续慢 → 降一档；稳定贴着垂直同步 → 试升一档，
  // 试升后变慢就退回并把该档锁 30 s。注意 60 Hz 下帧时最低就是 16.7 ms，不能用"比 16.7 快很多"做升档条件。
  // 动态分辨率：帧慢就降像素密度、帧快再试着升回去。
  // 每档有下限（高 1.5 / 中 1 / 低 0.75，且不超过屏幕本身）：之前一路能降到 0.75，高画质玩一会就越来越糊。
  // 降档要连续两个窗口都慢；升档试探至少隔 10 秒，免得清晰度一会儿高一会儿低地来回跳。
  adaptQuality(frameMs) {
    const now = performance.now();
    this._aq ??= { buf: [], t0: now + 3000, last: now, trial: null, banned: {}, slowN: 0, nextUp: 0 };
    const A = this._aq;
    if (now < A.t0) return;                       // 开局 3 s 内不调（着色器编译、资源上传）
    A.buf.push(frameMs);
    if (now - A.last < 1500) return;
    const sorted = A.buf.slice().sort((x, y) => x - y), med = sorted[sorted.length >> 1];
    const slow = A.buf.filter(x => x > 22).length / A.buf.length;
    A.buf.length = 0; A.last = now;
    const floor = Math.min(this.dprMax, DPR_FLOOR[this.qName] ?? 1);
    let d = this.dpr;
    A.slowN = med > 21 ? A.slowN + 1 : 0;
    if (A.trial && med > 19) { A.banned[A.trial] = now + 30000; d = A.trial - 0.25; A.trial = null; A.slowN = 0; }
    else if (A.slowN >= 2 && d > floor) { d = Math.max(floor, d - 0.25); A.slowN = 0; A.nextUp = now + 10000; }
    else if (med < 17.8 && slow < 0.05 && d < this.dprMax && now > A.nextUp && !((A.banned[d + 0.25] ?? 0) > now)) { d = Math.min(this.dprMax, d + 0.25); A.trial = d; A.nextUp = now + 10000; }
    else A.trial = null;
    if (d !== this.dpr) { this.dpr = d; this.resize(this.w, this.h); }
  }

  // ---------- 游戏事件 → 演出 ----------
  onEvent(e, game) {
    const P = this.parrot, D = this.director, FX = this.effects;
    switch (e.type) {
      case 'drop': this.firstDropDone = true; this.machine.kick = 1; break;
      case 'gate':
        this.machine.gateFlash = 1;
        FX.burst(this.machine.gateGroup.getWorldPosition(new THREE.Vector3()).setY(this.cfg.gate.y), 0x7ff8ff, 12, 0.55);
        break;
      case 'spinStart': this.reels.start(); this.tease = e.tease; break;
      case 'reelStop': this.reels.stop(e.i, e.column); break;
      case 'slotResult': {
        if (e.result !== 'none') this.fxState.flash = e.result === 'coins' || e.result === 'guard' ? 0.6 : 1.4;
        if (!['none', 'coins'].includes(e.result)) P.set('cheer', 1.4, 2);
        this.tease = false;
        // 连线发光（宝石线偏蓝、其余金色）；金币散布 / 鹦鹉计数：对应格子发光。亮起时稍晚于第三轴停稳
        const cells = (sym, n) => { const out = []; e.grid.forEach((col, c) => col.forEach((s, r) => { if (s === sym) out.push([c, r]); })); return n ? out : []; };
        const color = e.result === 'gem' ? 0x6fc4ff : e.result === 'multi' ? 0xffb02e : 0xffc23a;
        setTimeout(() => {
          this.machine.showWin(e.lines.map(l => l.i), [], color);
          if (e.coinPay) this.machine.showWin([], cells('coins', 1), 0xff9a1a);
          if (e.guard && e.parrots >= 3) this.machine.showWin([], cells('parrot', 1), 0x19d4ee);
        }, 120);
        break;
      }
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
        if (e.k < 2 || e.k % 6 < 2) { FX.muzzle(c.barrel.localToWorld(this.muzzleLocal.clone())); if (e.big) D.bump(0.25); }   // 只有 Jackpot 齐射震镜头；平时的发币齐射只闪炮口
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
      bulbFlash: Math.min(1, F.flash), gold: F.gold, reelAngles,
    });
    // 漏斗口以上的币不画：物理投币点在漏斗上方 0.45，看起来就是从漏斗里落下来的
    const rim = this.cfg.machine.dropperY + 0.35, dz = this.cfg.machine.dropZ, dpx = this.machine.dropper.position.x;
    this.coins.update(sim.coins, alpha, c => { const p = c.body.translation(); return p.y > rim && Math.abs(p.z - dz) < 0.45 && Math.abs(p.x - dpx) < 0.9; });
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
    // 大潮：偶发闪电（冷白闪一下）
    if (this.fxState.surge > 0.5 && Math.random() < 0.006) this.lightning = 1;
    this.lightning = Math.max(0, (this.lightning || 0) - 0.06);
    const lt = this.lightning > 0.5 ? 1 : this.lightning * 0.6;
    const su = this.sea.material.uniforms;
    su.time.value = t; su.surge.value = F.surge; su.gold.value = F.sunrise;
    this.sky.material.uniforms.gold.value = F.sunrise;
    this.renderer.toneMappingExposure = 0.8 * (1 - 0.12 * F.surge) * (1 + lt * 0.35);
    // 大潮：天更暗、冷光更强；Jackpot：全场金色补光；终局：暖色黎明
    const L = this.lights;
    L.hemi.intensity = 0.65 * (1 - 0.35 * F.surge) + F.sunrise * 0.5 + lt * 1.5;
    L.hemi.color.setRGB(lerp(0.35, 1.0, F.sunrise), lerp(0.45, 0.78, F.sunrise), lerp(0.82, 0.55, F.sunrise));
    L.key.intensity = 1.85 * (1 - 0.15 * F.surge) + F.sunrise * 0.6 + lt * 4;
    L.key.color.setRGB(lerp(0.86, 1.0, F.sunrise), lerp(0.9, 0.82, F.sunrise), lerp(1.0, 0.6, F.sunrise));
    L.warm.intensity = 0.45 + F.gold * 0.9 + Math.min(2.5, this.effects.flashLight.intensity / 90);   // 爆炸 / 炮口闪光
    this.scene.environmentIntensity = 1 + F.gold * 0.2;
    this.scene.fog.far = 200 + F.sunrise * 420;
    this.scene.fog.color.setRGB(lerp(0.09, 0.55, F.sunrise) * (1 - 0.4 * F.surge), lerp(0.14, 0.4, F.sunrise) * (1 - 0.4 * F.surge), lerp(0.29, 0.3, F.sunrise) * (1 - 0.3 * F.surge));
    this.post.finish.uniforms.warmth.value = F.gold * 0.6 + F.sunrise * 0.3;
    this.post.bloom.strength = 0.45 + F.gold * 0.12 + F.surge * 0.05;
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
  spinScreen() { return this.toScreen(this.machine.spinAnchor.getWorldPosition(this._gazeV.clone())); }
  tableScreen(x, z, y = 0.3) { return this.toScreen(new THREE.Vector3(x, y, z)); }
  chestScreen() { return this.toScreen(new THREE.Vector3(0, DECK_Y + 2.5, this.chestZ)); }
}
