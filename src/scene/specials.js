// 特殊物件的画面：宝石（折射 + 色散）、火药桶（glb）、藏宝图碎片（羊皮卷）。巨币由 CoinField 按 scale 绘制。
// 按物理物体 id 建 / 删网格，位姿插值与金币一致。
import * as THREE from 'three';
import { gemHullPoints } from '../physics/pusher.js';

export function gemGeometry(r) {
  // 圆形明亮式：8 面腰 + 冠部台面 + 底尖，平面着色出刻面闪光
  const p = gemHullPoints(r);
  const n = 8, top = [], gird = [];
  for (let i = 0; i < n; i++) { gird.push(new THREE.Vector3(p[i * 6], p[i * 6 + 1], p[i * 6 + 2])); top.push(new THREE.Vector3(p[i * 6 + 3], p[i * 6 + 4], p[i * 6 + 5])); }
  const tip = new THREE.Vector3(0, -r * 0.78, 0), tc = new THREE.Vector3(0, r * 0.42, 0);
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(tc, top[j], top[i]);                // 台面
    tri(gird[i], top[i], gird[j]);          // 冠部风筝面
    tri(top[i], top[j], gird[j]);
    tri(gird[j], tip, gird[i]);             // 亭部
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function mapTexture(seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 200;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // 撕边羊皮纸
  g.beginPath();
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rx = 118 + (r() - 0.5) * 14, ry = 90 + (r() - 0.5) * 12;
    pts.push([128 + Math.cos(a) * rx * (Math.abs(Math.cos(a)) ** 0.3), 100 + Math.sin(a) * ry * (Math.abs(Math.sin(a)) ** 0.3)]);
  }
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const grd = g.createRadialGradient(128, 100, 20, 128, 100, 140);
  grd.addColorStop(0, '#f6dcaa'); grd.addColorStop(0.7, '#e2bb7c'); grd.addColorStop(1, '#a8743c');
  g.fillStyle = grd; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#8a5a2b'; g.stroke();
  g.save(); g.clip();
  // 小岛 + 虚线路线 + 红 X
  g.fillStyle = '#7fb07a'; g.beginPath(); g.ellipse(70 + r() * 30, 70 + r() * 20, 26, 16, r(), 0, 7); g.fill();
  g.strokeStyle = '#5a3a1a'; g.lineWidth = 3; g.setLineDash([7, 6]);
  g.beginPath(); g.moveTo(40, 160); g.bezierCurveTo(90, 110, 150, 170, 190, 90); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#e8443a'; g.lineWidth = 14; g.lineCap = 'round';
  g.beginPath(); g.moveTo(170, 70); g.lineTo(210, 110); g.moveTo(210, 70); g.lineTo(170, 110); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class SpecialsView {
  constructor(scene, config, kegModel) {
    this.scene = scene; this.cfg = config;
    const S = config.specials;
    this.gemGeo = gemGeometry(S.gemRadius);
    // 宝石：台面上最该被看见的奖品（价值 20 枚）。以前用透射 + 色散，夜里背后没光可透，看起来是一块暗蓝石头；
    // 改成自发光的亮蓝 + 强反射 + 清漆刻面高光（也省掉透射带来的整场景多画一遍）
    this.gemMat = new THREE.MeshPhysicalMaterial({
      color: 0x2e6bff, metalness: 0.15, roughness: 0.06, emissive: 0x3d8bff, emissiveIntensity: 0.75,
      clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 3.2, iridescence: 0.35, flatShading: true,
    });
    this.kegModel = kegModel;
    const [w, d] = S.mapSize;
    const mg = new THREE.PlaneGeometry(w, d, 12, 8); mg.rotateX(-Math.PI / 2);
    const pa = mg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i); pa.setY(i, 0.04 + 0.12 * (Math.pow(Math.abs(x) / (w / 2), 3) + 0.5 * Math.pow(Math.abs(z) / (d / 2), 4))); }
    mg.computeVertexNormals();
    this.mapGeo = mg;
    this.mapTex = [1, 2, 3, 4, 5].map(i => mapTexture(i * 977));
    this.meshes = new Map();
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
  }

  _make(o) {
    let m;
    if (o.kind === 'gem') {
      m = new THREE.Group();
      const gem = new THREE.Mesh(this.gemGeo, this.gemMat); gem.castShadow = true;
      // 内部光晕：加法混合的光斑（不用点光源：避免宝石出现时全场着色器重编译）
      const glow = new THREE.Sprite(this.glowMat ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0x5a8cff).multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      glow.scale.setScalar(2.1);
      // 闪点：几颗四角星在宝石周围此起彼伏
      const stars = [0, 1, 2].map(i => {
        const s = new THREE.Sprite(this.starMat ??= new THREE.SpriteMaterial({ map: starTexture(), color: new THREE.Color(0xdff2ff).multiplyScalar(2.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        const a = i * 2.1; s.position.set(Math.cos(a) * 0.45, 0.25 + 0.2 * (i % 2), Math.sin(a) * 0.45); s.userData.ph = i * 0.37;
        return s;
      });
      m.add(gem, glow, ...stars);
      m.userData.stars = stars;
    } else if (o.kind === 'keg') {
      m = this.kegModel.clone();
      // 「可以点」的提示：桶顶一圈暖光呼吸（点着以后换成引信火花）
      const hint = new THREE.Sprite(this.kegHintMat ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xffa040).multiplyScalar(0.9), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      hint.position.y = 1.35; hint.scale.setScalar(1.1);
      m.add(hint); m.userData.hint = hint;
    } else if (o.kind === 'map') {
      // 藏宝图碎片：终极目标物件，画面上放大 1.3 倍、羊皮纸压暖微亮 + 平贴台面向外扩散的金色波纹（在金币堆里一眼找到）
      m = new THREE.Group();
      const paper = new THREE.Mesh(this.mapGeo, new THREE.MeshStandardMaterial({ map: this.mapTex[o.id % 5], roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false, emissive: 0x7a4a18, emissiveIntensity: 0.4 }));
      paper.material.map.premultiplyAlpha = false;
      paper.castShadow = true; paper.receiveShadow = true; paper.scale.setScalar(1.3);
      const halo = new THREE.Sprite(this.haloMat ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xffb84a).multiplyScalar(0.7), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      halo.scale.setScalar(1.5); halo.position.y = 0.1;
      const ring = new THREE.Mesh(this.ringGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.ringTex ??= ringTexture(), color: new THREE.Color(0xffd36a).multiplyScalar(1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      ring.renderOrder = 5;   // 不做深度测试：波纹画在金币上层，扩散到哪都看得见
      halo.visible = false;   // 光晕试过：在台面上像一个泡泡，盖住碎片本身，不用
      m.add(paper, halo, ring);
      m.userData.paper = paper; m.userData.ring = ring; m.userData.halo = halo;
    }
    m.userData.kind = o.kind;
    this.scene.add(m);
    return m;
  }

  // 火药桶点着：桶顶引信火花 + 红光，越接近爆炸闪得越快
  light(id, fuse) {
    const m = this.meshes.get(id); if (!m) return;
    m.userData.fuse = { t0: performance.now() / 1000, dur: fuse };
    if (m.userData.hint) m.userData.hint.visible = false;
    const spark = new THREE.Sprite(this.sparkMat ??= new THREE.SpriteMaterial({ map: starTexture(), color: new THREE.Color(0xffe2a0).multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xff3a1a).multiplyScalar(1.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    spark.position.y = glow.position.y = 1.4;
    m.add(glow, spark); m.userData.spark = spark; m.userData.fglow = glow;
  }

  update(objs, alpha) {
    const seen = new Set();
    for (const o of objs) {
      if (o.kind === 'coin' || o.kind === 'giant') continue;
      seen.add(o.id);
      let m = this.meshes.get(o.id);
      if (!m) { m = this._make(o); this.meshes.set(o.id, m); }
      const tr = o.body.translation(), ro = o.body.rotation();
      if (o.prevP) {
        m.position.set(o.prevP.x + (tr.x - o.prevP.x) * alpha, o.prevP.y + (tr.y - o.prevP.y) * alpha, o.prevP.z + (tr.z - o.prevP.z) * alpha);
        m.quaternion.set(o.prevQ.x, o.prevQ.y, o.prevQ.z, o.prevQ.w).slerp(this._q2.set(ro.x, ro.y, ro.z, ro.w), alpha);
      } else { m.position.set(tr.x, tr.y, tr.z); m.quaternion.set(ro.x, ro.y, ro.z, ro.w); }
    }
    // 动画：宝石闪点、藏宝图光环脉动 + 纸片轻微上下浮动（只动子网格，不影响物理）
    const t = performance.now() / 1000;
    for (const m of this.meshes.values()) {
      if (m.userData.hint?.visible) { const k = 0.5 + 0.5 * Math.sin(t * 3.2); m.userData.hint.material.opacity = 0.35 + 0.5 * k; m.userData.hint.scale.setScalar(0.9 + 0.5 * k); }
      if (m.userData.fuse) {
        // 引信：火花抖动旋转；红光按「剩余时间」加速闪烁（最后 1 秒几乎常亮）
        const F = m.userData.fuse, left = Math.max(0, F.dur - (t - F.t0)), rate = 3 + 14 * (1 - left / F.dur);
        m.userData.spark.scale.setScalar(0.45 + 0.35 * Math.random()); m.userData.spark.material.rotation = t * 9;
        const fl = 0.5 + 0.5 * Math.sin((t - F.t0) * rate * Math.PI);
        m.userData.fglow.scale.setScalar(1.2 + 1.6 * fl); m.userData.fglow.material.opacity = 0.35 + 0.65 * fl;
      }
      if (m.userData.stars) m.userData.stars.forEach(s => { const k = Math.max(0, Math.sin((t + s.userData.ph) * 4.2)); s.scale.setScalar(0.05 + 0.6 * k * k); });
      if (m.userData.ring) {
        // 波纹：每 1.4 秒从碎片下方扩散一圈，平贴在台面上（抵消碎片自身的倾斜）
        const r = m.userData.ring, k = (t / 1.4) % 1;
        r.quaternion.copy(m.quaternion).invert(); r.position.set(0, 0.06, 0);
        r.scale.setScalar(1.3 + 2.4 * k); r.material.opacity = (1 - k) * Math.min(1, k * 6);
        m.userData.halo.material.opacity = 0.35 + 0.15 * Math.sin(t * 3);
        m.userData.paper.position.y = 0.05 + 0.04 * Math.sin(t * 2.4);
      }
    }
    // 物理里已不存在、也没被演出接管的：直接移除
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.scene.remove(m); this.meshes.delete(id); }
  }

  // 物体离台：把网格交给演出（VFX 负责之后的移除）
  claim(id) {
    const m = this.meshes.get(id);
    if (!m) return null;
    this.meshes.delete(id);
    if (m.userData.ring) { m.userData.ring.visible = false; m.userData.halo.visible = false; }   // 交给演出飞进宝箱 / 落海时收起波纹和光晕
    return m;
  }
  meshOf(id) { return this.meshes.get(id); }
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.25, 'rgba(255,255,255,.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// 四角星闪点
function starTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30); grd.addColorStop(0, '#fff'); grd.addColorStop(0.2, 'rgba(255,255,255,.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(32, 0); g.quadraticCurveTo(35, 29, 64, 32); g.quadraticCurveTo(35, 35, 32, 64); g.quadraticCurveTo(29, 35, 0, 32); g.quadraticCurveTo(29, 29, 32, 0); g.fill();
  return new THREE.CanvasTexture(c);
}

// 藏宝图下方扩散的波纹：一条细亮环
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 48, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.55, '#fff'); grd.addColorStop(1, 'rgba(255,255,255,0)');   // 只有一条细亮边，内圈全透明（带填充会像个泡泡）
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
