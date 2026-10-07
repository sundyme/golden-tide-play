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
  grd.addColorStop(0, '#fbe8bf'); grd.addColorStop(0.7, '#e9c98d'); grd.addColorStop(1, '#b98a4e');
  g.fillStyle = grd; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#8a5a2b'; g.stroke();
  g.save(); g.clip();
  // 小岛 + 虚线路线 + 红 X
  g.fillStyle = '#7fb07a'; g.beginPath(); g.ellipse(70 + r() * 30, 70 + r() * 20, 26, 16, r(), 0, 7); g.fill();
  g.strokeStyle = '#5a3a1a'; g.lineWidth = 3; g.setLineDash([7, 6]);
  g.beginPath(); g.moveTo(40, 160); g.bezierCurveTo(90, 110, 150, 170, 190, 90); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#e8443a'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(176, 76); g.lineTo(204, 104); g.moveTo(204, 76); g.lineTo(176, 104); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class SpecialsView {
  constructor(scene, config, kegModel, mapModel) {
    this.scene = scene; this.cfg = config;
    const S = config.specials;
    this.gemGeo = gemGeometry(S.gemRadius);
    this.gemMat = new THREE.MeshPhysicalMaterial({
      color: 0x5a8cff, metalness: 0, roughness: 0.04, transmission: 0.92, thickness: 0.9, ior: 2.1, dispersion: 5,
      attenuationColor: new THREE.Color(0x2e6bff), attenuationDistance: 0.7, emissive: 0x1a3cff, emissiveIntensity: 0.35,
      specularIntensity: 1, envMapIntensity: 1.6, flatShading: true,
    });
    this.kegModel = kegModel; this.mapModel = mapModel;   // D1：藏宝图用 Rodin 卷轴模型（需求单 08-M）
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
      // 内部光点：让宝石在暗处也"亮"
      const glow = new THREE.PointLight(0x5a8cff, 2.5, 3, 2);
      m.add(gem, glow);
    } else if (o.kind === 'keg') {
      m = this.kegModel.clone();
    } else if (o.kind === 'map') {
      if (this.mapModel) {
        m = new THREE.Group();
        const sc = this.mapModel.clone(); sc.scale.setScalar(0.85); sc.position.y = -0.16; sc.rotation.y = (o.id % 5) * 0.4 - 0.8;   // 原点在底面：压到刚体中心下
        m.add(sc);
      } else {
        m = new THREE.Mesh(this.mapGeo, new THREE.MeshStandardMaterial({ map: this.mapTex[o.id % 5], roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false }));
        m.material.map.premultiplyAlpha = false;
        m.castShadow = true; m.receiveShadow = true;
      }
    }
    this.scene.add(m);
    return m;
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
    // 物理里已不存在、也没被演出接管的：直接移除
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.scene.remove(m); this.meshes.delete(id); }
  }

  // 物体离台：把网格交给演出（VFX 负责之后的移除）
  claim(id) {
    const m = this.meshes.get(id);
    if (!m) return null;
    this.meshes.delete(id);
    return m;
  }
  meshOf(id) { return this.meshes.get(id); }
}
