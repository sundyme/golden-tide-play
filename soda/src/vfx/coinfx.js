// 金币离台后的演出（纯视觉，物理里该币已删除）：
//   前沿掉落 → 先自由下落一小段，再被"吸"进宝箱（加速 + 旋转），落袋闪光，箱内金币堆增高
//   侧面掉落 → 竖着滑进落海槽的水面，小水花
import * as THREE from 'three';

const GUTTER_Y = -1.05;   // 落海槽水面（machine_d1 槽底 -1.1）
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class CoinFX {
  constructor(scene, coinGeo, coinMat, { chestMouth, chestSize, seaY, pile = null, chestFloor = null }) {
    this.scene = scene;
    this.mouth = chestMouth.clone();       // 宝箱口中心（世界坐标）
    this.chestSize = chestSize;            // [宽, 深]
    this.seaY = seaY;
    this.flying = [];
    this.fly = new THREE.InstancedMesh(coinGeo, coinMat, 160);
    this.fly.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fly.frustumCulled = false; this.fly.castShadow = true; this.fly.count = 0;
    this.fly.setColorAt(0, new THREE.Color(0xffc23a));
    scene.add(this.fly);

    // 宝箱里的金币堆。位姿来自 tools/bake_chestpile.mjs 的物理烘焙（按落入顺序，任意前 n 枚都互不穿插）。
    // 每枚飞来的币都预定一个位置（未满：下一个空位；满了：顶层随机一枚，换个朝向重新落下），
    // 飞行末段转到该位置的姿态，落定时弹一下 —— 箱里的币堆一直在变，飞来的币不会凭空消失。
    // 没有烘焙数据时退回随机摆放。
    this.pileData = pile; this.chestFloor = chestFloor;
    this.pileMax = pile ? pile.coins.length : 140;
    this.pile = new THREE.InstancedMesh(coinGeo, coinMat, this.pileMax);
    this.pile.receiveShadow = true;
    this.pile.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pile.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.pileMax; i++) { this.pile.setMatrixAt(i, zero); this.pile.setColorAt(i, new THREE.Color(0xffc23a)); }
    this.pile.count = pile ? this.pileMax : 0;
    scene.add(this.pile);
    this.pileRng = mulberry(4);
    this.nextSlot = 0;                          // 下一个还没被预定的空位
    this.slotYaw = new Float32Array(this.pileMax);
    this.bounces = [];                          // 正在落定回弹的位置 { i, t }
    if (pile) {                                 // 顶层（最高的 30%）：满了以后新币落在这里
      this.topSlots = pile.coins.map((c, i) => [c[1], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(4, Math.round(this.pileMax * 0.3))).map(x => x[1]);
    }

    // 闪光与水花：共享的加法混合精灵池
    this.sparkTex = radialTex();
    this.sparks = [];
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
      col: new THREE.Color().setHSL(0.105 + Math.random() * 0.02, 0.92, 0.52 + Math.random() * 0.06),   // 实例颜色：不设就是白色（飞行中的币曾是银白的）
    };
    if (mesh && e.obj === 'map') {
      // 藏宝图：向镜头飞起、缩小（UI 同时点亮进度格）
      f.kind = 'map'; f.dur = 0.9; f.p0 = f.p.clone(); f.spin = new THREE.Vector3(1.5, 4, 0.8);
      f.target = new THREE.Vector3(-4.5, 14, 6);
      this.flying.push(f);
      return f;
    }
    if (f.kind === 'front') {
      // 先往前上方弹一下越过前沿台阶 / 前裙板，再吸进宝箱（原地下落会从台阶和裙板里穿过去）
      f.v.z = Math.max(f.v.z, 3 + Math.random()); f.v.y = Math.max(f.v.y, 3.6 + Math.random() * 0.6);
      f.tFall = 0.07 + Math.random() * 0.05;   // 还在上升时就转入吸入曲线（控制点在落点正上方），不会擦进前沿台阶
      f.p0 = f.p.clone(); f.v0 = f.v.clone();   // 卡顿帧（dt > tFall）会直接进入吸入段：起点先记好
      f.dur = 0.42 + Math.random() * 0.12;
      const [W, D] = this.chestSize;
      if (this.pileData && !mesh) {
        f.slot = this._reserveSlot();
        f.target = this._slotPose(f.slot, _p, _q).clone();
        f.slotQ = _q.clone();
      } else {
        f.target = this.mouth.clone().add(new THREE.Vector3((Math.random() - 0.5) * W * 0.6, 0, (Math.random() - 0.5) * D * 0.5));
      }
      f.spin = new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 18);
    } else {
      // 侧面：竖着滑进落海槽的水面（槽宽只有 0.55，原来向外甩、转着掉进远处的海，会穿过槽壁、柜壁和船舷）
      f.gutterX = Math.sign(f.p.x) * 4.88;
      f.v.set(0, Math.min(f.v.y, -1), f.v.z * 0.3);
      f.spin = new THREE.Vector3(0, 0, 0);
      // 竖起来（币面朝 ±x、贴着槽走向），保留绕 x 的随机滚角
      f.gutterQ = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(Math.sign(f.p.x) || 1, 0, 0))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.random() * Math.PI));
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
          let c;
          if (f.slot !== undefined) {   // 控制点在落点正上方：从上往下落进自己的位置，不从侧面穿过币堆 / 箱壁
            c = _v.set(f.p0.x + (f.target.x - f.p0.x) * 0.7, Math.max(f.p0.y, f.target.y) + 1.6, f.p0.z + (f.target.z - f.p0.z) * 0.7);
          } else {
            c = _v.copy(f.p0).addScaledVector(f.v0, f.dur * 0.35); c.y = Math.min(c.y, f.p0.y);
          }
          _p.copy(f.p0).multiplyScalar((1 - e) * (1 - e)).addScaledVector(c, 2 * (1 - e) * e).addScaledVector(f.target, e * e);
          f.p.copy(_p);
          f.k = k;
          if (k >= 1) { done = true; this._land(f); }
        }
      } else {
        f.v.y -= g * dt; f.p.addScaledVector(f.v, dt);
        if (f.gutterX !== undefined) {
          f.p.x += (f.gutterX - f.p.x) * Math.min(1, dt * 14);   // 收到槽中线、立起来，不蹭两侧槽壁
          f.q.slerp(f.gutterQ, Math.min(1, dt * 16));
          if (f.p.y < GUTTER_Y) { done = true; this._splash(f.p, GUTTER_Y); }
        } else if (f.p.y < this.seaY) { done = true; this._splash(f.p); }
      }
      _e.set(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt);
      f.q.multiply(_q.setFromEuler(_e));
      if (f.slotQ && f.k > 0.5) { const a = (f.k - 0.5) / 0.5; f.q.slerp(f.slotQ, a * a * (3 - 2 * a)); }   // 末段转到落点姿态，落定无跳变
      if (done) { this.flying.splice(i, 1); if (f.mesh) this.scene.remove(f.mesh); continue; }
      if (f.mesh) {
        f.mesh.position.copy(f.p); f.mesh.quaternion.copy(f.q); f.mesh.scale.setScalar(f.shrink ?? 1);
        continue;
      }
      _s.setScalar(f.scale * (f.shrink ?? 1));
      this.fly.setColorAt(n, f.col);
      this.fly.setMatrixAt(n++, _m.compose(f.p, f.q, _s));
    }
    this.fly.count = n;
    this.fly.instanceMatrix.needsUpdate = true;
    if (this.fly.instanceColor) this.fly.instanceColor.needsUpdate = true;

    // 落定回弹：刚落下的币在自己的位置上轻轻弹两下
    for (let i = this.bounces.length - 1; i >= 0; i--) {
      const b = this.bounces[i]; b.t += dt;
      const k = Math.min(1, b.t / 0.38);
      this._slotPose(b.i, _p, _q);
      _p.y += 0.3 * (1 - k) * (1 - k) * Math.abs(Math.cos(k * Math.PI * 1.5));
      this.pile.setMatrixAt(b.i, _m.compose(_p, _q, _s.setScalar(this.pileData.scale ?? 1)));
      this.pile.instanceMatrix.needsUpdate = true;
      if (k >= 1) this.bounces.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.userData.t += dt;
      const k = s.userData.t / s.userData.life;
      if (k >= 1) { this.scene.remove(s); this.sparks.splice(i, 1); continue; }
      s.position.addScaledVector(s.userData.v, dt); s.userData.v.y -= 6 * dt;
      s.material.opacity = (1 - k) * (1 - k);
      s.scale.setScalar(s.userData.size * (0.6 + 0.8 * Math.sin(Math.min(1, k * 3) * Math.PI * 0.5)));
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]; s.userData.t += dt;
      const k = s.userData.t / 0.9;
      if (k >= 1) { this.scene.remove(s); s.material.dispose(); this.splashes.splice(i, 1); continue; }
      s.scale.setScalar((0.4 + 2.2 * (1 - (1 - k) * (1 - k))) * (s.userData.s ?? 1));
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
    // 落进自己预定的位置（换个朝向 = 箱里的币堆有变化），弹两下
    if (f.slot !== undefined) {
      this._slotPose(f.slot, _p, _q);
      this.pile.setMatrixAt(f.slot, _m.compose(_p, _q, _s.setScalar(this.pileData.scale ?? 1)));
      this.pile.setColorAt(f.slot, new THREE.Color().setHSL(0.105 + this.pileRng() * 0.02, 0.92, 0.52 + this.pileRng() * 0.06));
      this.pile.instanceMatrix.needsUpdate = true;
      this.pile.instanceColor.needsUpdate = true;
      this.bounces = this.bounces.filter(b => b.i !== f.slot);
      if (!f.quiet) this.bounces.push({ i: f.slot, t: 0 });
      return;
    }
    // 没有烘焙数据：旧的随机摆放
    if (!this.pileData && this.pile.count < this.pileMax) {
      const r = this.pileRng, i = this.pile.count, [W, D] = this.chestSize, layer = Math.floor(i / 22);
      _p.set(this.mouth.x + (r() - 0.5) * W * 0.8, this.mouth.y - 0.55 + layer * 0.15 + r() * 0.06, this.mouth.z + (r() - 0.5) * D * 0.75);
      _q.setFromEuler(_e.set((r() - 0.5) * 0.7, r() * 6, (r() - 0.5) * 0.7));
      this.pile.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1)));
      this.pile.setColorAt(i, new THREE.Color().setHSL(0.105 + r() * 0.02, 0.92, 0.52 + r() * 0.06));
      this.pile.count++;
      this.pile.instanceMatrix.needsUpdate = true;
      this.pile.instanceColor.needsUpdate = true;
    }
  }

  // 预定落点：没满 → 下一个空位；满了 → 顶层随机一枚（新币落在它的位置上、换个朝向）
  _reserveSlot() {
    if (this.nextSlot < this.pileMax) return this.nextSlot++;
    const i = this.topSlots[Math.floor(this.pileRng() * this.topSlots.length)];
    this.slotYaw[i] = this.pileRng() * Math.PI * 2;
    return i;
  }

  // 位置 i 的世界位姿：烘焙位姿 + 绕币轴（本地 y）的随机朝向
  _slotPose(i, p, q) {
    const c = this.pileData.coins[i];
    p.set(c[0], c[1], c[2]).add(this.chestFloor);
    q.set(c[3], c[4], c[5], c[6]).multiply(_q2.setFromAxisAngle(_up, this.slotYaw[i]));
    return p;
  }

  // 开局给宝箱里先放一些币（看起来"已经很富"）
  prefill(n) {
    const save = this.pileRng;
    for (let i = 0; i < n; i++) {
      if (this.pileData) { const k = this._reserveSlot(); this.slotYaw[k] = this.pileRng() * 6.28; this._land({ slot: k, quiet: true, target: this.mouth }); }
      else this._land({ target: this.mouth, quiet: true });
    }
    this.pileRng = save;
  }

  _spark(pos, color, size, vel, life) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTex, color: new THREE.Color(color).multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    m.position.copy(pos); m.userData = { t: 0, life, v: vel, size };
    m.scale.setScalar(size);
    this.scene.add(m); this.sparks.push(m);
  }

  _splash(p, y = this.seaY) {
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff2ff).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const k = y === this.seaY ? 1 : 0.13;   // 落海槽很窄：水花小一号
    ring.position.set(p.x, y + 0.05, p.z); ring.userData = { t: 0, s: k };
    this.scene.add(ring); this.splashes.push(ring);
    for (let i = 0; i < 6; i++) this._spark(new THREE.Vector3(p.x, y + 0.1, p.z), 0x7ff8ff, (0.35 + Math.random() * 0.3) * Math.sqrt(k), new THREE.Vector3((Math.random() - 0.5) * 3 * k, 4 + Math.random() * 4, (Math.random() - 0.5) * 3 * k), 0.55);
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
