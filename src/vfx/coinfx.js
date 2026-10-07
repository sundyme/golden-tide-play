// 金币离台后的演出（纯视觉，物理里该币已删除）：
//   前沿掉落 → 先自由下落一小段，再被"吸"进宝箱（加速 + 旋转），落袋闪光，箱内金币堆增高
//   侧面掉落 → 竖着落进两侧的落海槽（台边与槽外壁之间），消失在槽底的黑暗里（以前往外抛，会穿过槽壁和柜壁）
import * as THREE from 'three';
import { SpriteBatch } from './batch.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class CoinFX {
  constructor(scene, coinGeo, coinMat, { chestMouth, chestSize, seaY, chute }) {
    this.scene = scene;
    this.chute = chute;                    // 落海槽：{ x0, x1 } 槽内币心 |x| 范围，z1 槽前端，floorY 槽底
    this.mouth = chestMouth.clone();       // 宝箱口中心（世界坐标）
    this.chestSize = chestSize;            // [宽, 深]
    this.seaY = seaY;
    this.flying = [];
    this.fly = new THREE.InstancedMesh(coinGeo, coinMat, 160);
    this.fly.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fly.frustumCulled = false; this.fly.castShadow = true; this.fly.count = 0;
    this.fly.setColorAt(0, new THREE.Color(0xffc23a));
    scene.add(this.fly);

    // 宝箱里的金币堆（静态实例，随收集增高）
    this.pileMax = 140;
    this.pile = new THREE.InstancedMesh(coinGeo, coinMat, this.pileMax);
    this.pile.count = 0; this.pile.receiveShadow = true;
    this.pile.setColorAt(0, new THREE.Color(0xffc23a));
    scene.add(this.pile);
    this.pileRng = mulberry(4);
    // 金币堆高度图：每枚新币落在脚下已有币的最高处，倾角顺着局部坡度 → 堆里的币互不穿插
    {
      const [W, D] = chestSize, cell = 0.1;
      const hm = this.hm = { cell, x0: chestMouth.x - W * 0.42, z0: chestMouth.z - D * 0.42, nx: Math.ceil(W * 0.84 / cell), nz: Math.ceil(D * 0.84 / cell) };
      hm.h = new Float32Array(hm.nx * hm.nz).fill(chestMouth.y - 1.9);
    }

    // 闪光与水花：共享的加法混合精灵池
    this.sparkTex = radialTex();
    this.sparks = [];
    this.sparkBatch = new SpriteBatch(scene, { map: this.sparkTex, blending: THREE.AdditiveBlending, cap: 360, renderOrder: 3 });   // 合批，见 batch.js
    this.splashes = [];
    const ringGeo = new THREE.RingGeometry(0.6, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo = ringGeo;
  }

  // e: physics coinOut 事件（含 coin、kind、位置）；mesh：特殊物件的网格（不给则用金币实例绘制）
  spawn(e, mesh = null) {
    const b = e.coin.body;
    const t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
    const f = {
      kind: e.kind, t: 0, scale: e.coin.scale,
      p: new THREE.Vector3(t.x, t.y, t.z), v: new THREE.Vector3(v.x, v.y, v.z),
      q: new THREE.Quaternion(r.x, r.y, r.z, r.w), w: new THREE.Vector3(w.x, w.y, w.z),
      color: e.color, mesh,
    };
    if (mesh && e.obj === 'map') {
      // 藏宝图：向镜头飞起、缩小（UI 同时点亮进度格）
      f.kind = 'map'; f.dur = 0.9; f.p0 = f.p.clone(); f.spin = new THREE.Vector3(1.5, 4, 0.8);
      f.target = new THREE.Vector3(-4.5, 14, 6);
      this.flying.push(f);
      return f;
    }
    if (f.kind === 'front') {
      // 物理在币刚翻过前沿（还高于箱沿）时就交出来：只自由落一小下，然后从箱子后壁上方越过去
      f.tFall = 0.04 + Math.random() * 0.04;
      f.p0 = f.p.clone(); f.v0 = f.v.clone();          // 一帧 dt 比 tFall 还长时直接进吸入段，起点不能是空的
      f.dur = 0.42 + Math.random() * 0.12;
      const [W, D] = this.chestSize;
      f.target = this.mouth.clone().add(new THREE.Vector3((Math.random() - 0.5) * W * 0.6, 0, (Math.random() - 0.5) * D * 0.5));
      f.target.y = Math.max(this.pileTop(f.target.x, f.target.z) + 0.2, this.mouth.y - 0.6);
      f.spin = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
    } else {
      // 侧面：竖起来（币面朝 ±x）顺着槽落下；横向速度收住，不再往外抛
      f.v.x *= 0.3; f.v.z *= 0.5; f.v.y = Math.min(f.v.y, 0);
      const s = Math.sign(f.p.x) || 1, axis = new THREE.Vector3(0, 1, 0).applyQuaternion(f.q);
      f.qT = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(axis.x * s >= 0 ? s : -s, 0, 0));
      f.qT.premultiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 1.2));
      f.spin = new THREE.Vector3(0, 0, 0);
    }
    if (this.flying.length < 160) this.flying.push(f);
    return f;
  }

  update(dt, t) {
    const g = 38;
    let n = 0;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      let done = false;
      if (f.kind === 'map') {
        const k = Math.min(1, f.t / f.dur), e = 1 - (1 - k) * (1 - k);
        f.p.copy(f.p0).lerp(f.target, e); f.p.y += Math.sin(k * Math.PI) * 2;
        f.shrink = 1 - 0.7 * k;
        if (k >= 1) done = true;
      } else if (f.kind === 'front') {
        if (f.t < f.tFall) {
          f.v.y -= g * dt; f.p.addScaledVector(f.v, dt);
          if (!f.p0) f.p0 = new THREE.Vector3();
          f.p0.copy(f.p); f.v0 = f.v.clone();
        } else {
          // 吸入：二次贝塞尔，起点切线沿当前速度，终点在宝箱口，缓入（越来越快）
          const k = Math.min(1, (f.t - f.tFall) / f.dur);
          const e = k * k * (1.6 - 0.6 * k);
          // 控制点抬到箱沿以上、推过后壁：贝塞尔曲线在后壁附近一直高于箱沿，币不会从后壁里穿出来
          const c = f.p0.clone().addScaledVector(f.v0, f.dur * 0.35);
          c.y = Math.max(Math.min(c.y, f.p0.y + 0.15), this.mouth.y + 0.65);
          c.z = Math.max(c.z, this.mouth.z - this.chestSize[1] * 0.62 + 0.55);
          _p.copy(f.p0).multiplyScalar((1 - e) * (1 - e)).addScaledVector(c, 2 * (1 - e) * e).addScaledVector(f.target, e * e);
          f.p.copy(_p);
          f.shrink = 1 - 0.25 * e;
          if (k >= 1) { done = true; this._land(f); }
        }
      } else {
        f.v.y -= g * dt; f.p.addScaledVector(f.v, dt);
        const C = this.chute, s = Math.sign(f.p.x) || 1, k = 1 - Math.exp(-dt * 30);
        if (f.qT) f.q.slerp(f.qT, 1 - Math.exp(-dt * 30));
        // 按当前姿态算横向半宽，币心收进「不碰台边、不碰槽外壁」的区间（槽比平躺的币窄，所以同时把币竖起来）
        const ax = _p.set(0, 1, 0).applyQuaternion(f.q).x, r = 0.5 * f.scale, ex = r * Math.sqrt(Math.max(0, 1 - ax * ax)) + 0.085 * f.scale * Math.abs(ax);
        let lo = C.x0 - 0.08 + ex, hi = C.x1 + 0.085 - ex; if (lo > hi) lo = hi = (lo + hi) / 2;
        const px = Math.abs(f.p.x);
        f.p.x = s * (px + (Math.min(hi, Math.max(lo, px)) - px) * (px > hi ? 1 : k));
        f.p.z += (Math.min(f.p.z, C.z1) - f.p.z) * k;
        if (f.p.y < C.floorY - 0.6) done = true;     // 已经整个没入槽底的黑暗
      }
      _e.set(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt);
      f.q.multiply(_q.setFromEuler(_e));
      if (done) { this.flying.splice(i, 1); if (f.mesh) this.scene.remove(f.mesh); continue; }
      if (f.mesh) {
        f.mesh.position.copy(f.p); f.mesh.quaternion.copy(f.q); f.mesh.scale.setScalar(f.shrink ?? 1);
        continue;
      }
      _s.setScalar(f.scale * (f.shrink ?? 1));
      this.fly.setMatrixAt(n++, _m.compose(f.p, f.q, _s));
    }
    this.fly.count = n;
    this.fly.instanceMatrix.needsUpdate = true;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.userData.t += dt;
      const k = s.userData.t / s.userData.life;
      if (k >= 1) { this.sparkBatch.remove(s); this.sparks[i] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; }
      s.position.addScaledVector(s.userData.v, dt); s.userData.v.y -= 6 * dt;
      s.material.opacity = (1 - k) * (1 - k);
      s.scale.setScalar(s.userData.size * (0.6 + 0.8 * Math.sin(Math.min(1, k * 3) * Math.PI * 0.5)));
    }
    this.sparkBatch.flush();
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]; s.userData.t += dt;
      const k = s.userData.t / 0.9;
      if (k >= 1) { this.scene.remove(s); s.material.dispose(); this.splashes.splice(i, 1); continue; }
      s.scale.setScalar(0.4 + 2.2 * (1 - (1 - k) * (1 - k)));
      s.material.opacity = 0.9 * (1 - k);
    }
  }

  _land(f) {
    if (f.mesh) {   // 宝石 / 巨币等：落袋大闪光，不进金币堆
      for (let i = 0; i < 14; i++) this._spark(f.target, f.mesh.userData.sparkColor ?? 0x8fd1ff, 0.7 + Math.random() * 0.6, new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 5, (Math.random() - 0.5) * 6), 0.6);
      return;
    }
    // 落袋闪光
    if (!f.quiet) for (let i = 0; i < 5; i++) this._spark(f.target, 0xffd76a, 0.5 + Math.random() * 0.4, new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3), 0.35);
    // 箱内金币堆加一枚（高度图 + 支撑平面，堆里的币互不穿插）
    if (this.pile.count < this.pileMax && !this.pileFull) {
      const r = this.pileRng, hm = this.hm, R = 0.5, hH = 0.085;
      const hx = (hm.nx * hm.cell) / 2 - R, hz = (hm.nz * hm.cell) / 2 - R, cx = hm.x0 + hm.nx * hm.cell / 2, cz = hm.z0 + hm.nz * hm.cell / 2;
      // 每个候选落点求「支撑平面」：在一组倾角里找让币心最低、且底面高过足迹内每一格的那个（币会斜靠在高点上、另一侧沉进空隙）
      // 再从候选里挑最低的（像倒进去的币会往低处滑）；飞来的币只在落点附近挑
      const aim = !f.quiet && f.target;
      let best = null;
      for (let k = 0; k < (aim ? 4 : 10); k++) {
        const tx = Math.min(cx + hx, Math.max(cx - hx, aim ? f.target.x + (r() - 0.5) * 1.0 : cx + (r() - 0.5) * 2 * hx));
        const tz = Math.min(cz + hz, Math.max(cz - hz, aim ? f.target.z + (r() - 0.5) * 0.9 : cz + (r() - 0.5) * 2 * hz));
        const fit = this._pileFit(tx, tz);
        fit.score = fit.y + Math.hypot(tx - cx, tz - cz) * 0.04;
        if (!best || fit.score < best.score) best = fit;
      }
      if (best.y > this.mouth.y + 0.5) { this.pileFull = true; return; }   // 堆满了：不再长高（落袋闪光照放）
      const { x, z, y, gx, gz, cells } = best;
      for (const [k, px, pz] of cells) hm.h[k] = Math.max(hm.h[k], y + gx * px + gz * pz + hH);
      _p.set(x, y, z);
      const n = new THREE.Vector3(-gx, 1, -gz).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28));
      const i = this.pile.count;
      this.pile.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1)));
      this.pile.setColorAt(i, new THREE.Color().setHSL(0.105 + r() * 0.02, 0.92, 0.52 + r() * 0.06));
      this.pile.count++;
      this.pile.instanceMatrix.needsUpdate = true;
      this.pile.instanceColor.needsUpdate = true;
    }
  }

  // 在 (x, z) 放一枚币的支撑平面：倾角 gx, gz ∈ [−0.3, 0.3]，底面 y + g·d − 厚度/2 ≥ 足迹内每格高度
  _pileFit(x, z) {
    const hm = this.hm, R = 0.5, hH = 0.085, cells = [];
    const i0 = Math.max(0, Math.floor((x - R - hm.x0) / hm.cell)), i1 = Math.min(hm.nx - 1, Math.floor((x + R - hm.x0) / hm.cell));
    const j0 = Math.max(0, Math.floor((z - R - hm.z0) / hm.cell)), j1 = Math.min(hm.nz - 1, Math.floor((z + R - hm.z0) / hm.cell));
    for (let iz = j0; iz <= j1; iz++) for (let ix = i0; ix <= i1; ix++) {
      const px = hm.x0 + (ix + 0.5) * hm.cell - x, pz = hm.z0 + (iz + 0.5) * hm.cell - z;
      if (px * px + pz * pz <= R * R) cells.push([iz * hm.nx + ix, px, pz]);
    }
    let best = null;
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      const gx = a * 0.1, gz = b * 0.1;
      let y = -Infinity;
      for (const [k, px, pz] of cells) { const v = hm.h[k] - gx * px - gz * pz + hH; if (v > y) y = v; }
      const score = y + (gx * gx + gz * gz) * 0.15;      // 同样低时偏向平躺
      if (!best || score < best.s) best = { s: score, y, gx, gz };
    }
    return { x, z, y: best.y, gx: best.gx, gz: best.gz, cells };
  }

  // 金币堆在 (x, z) 处的表面高度（飞进来的币瞄准这里）
  pileTop(x, z) { return this._pileFit(x, z).y; }

  // 开局给宝箱里先放一些币（看起来"已经很富"）
  prefill(n) {
    const save = this.pileRng;
    for (let i = 0; i < n; i++) this._land({ target: this.mouth, quiet: true });
    this.pileRng = save;
  }

  _spark(pos, color, size, vel, life) {
    const m = this.sparkBatch.add(new THREE.Color(color).multiplyScalar(3));
    if (!m) return;
    m.position.copy(pos); m.userData = { t: 0, life, v: vel, size };
    m.scale.setScalar(size);
    this.sparks.push(m);
  }

  _splash(p) {
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff2ff).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p.x, this.seaY + 0.05, p.z); ring.userData = { t: 0 };
    this.scene.add(ring); this.splashes.push(ring);
    for (let i = 0; i < 6; i++) this._spark(new THREE.Vector3(p.x, this.seaY + 0.1, p.z), 0x7ff8ff, 0.35 + Math.random() * 0.3, new THREE.Vector3((Math.random() - 0.5) * 3, 4 + Math.random() * 4, (Math.random() - 0.5) * 3), 0.55);
  }
}

function radialTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  // 十字星芒
  g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(30, 4, 4, 56); g.fillRect(4, 30, 56, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
