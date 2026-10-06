// 机台：静态外壳来自 Blender 建模的 machine.glb（art/blender/machine_v2.py，需求单 04），
// 这里负责把它按分组挂到位、换成运行时材质，并用代码做所有会动 / 会发光的部分：
// 推板运动、三轴转轮、跑马灯、骷髅门、潮汐计、护栏、投币口、灯笼，以及台面与船甲板。
// 尺寸和物理碰撞体一一对应（见 config.machine）。
import * as THREE from 'three';
import { woodPlanks, velvetNormal } from './textures.js';

export const DECK_Y = -3.2;

// 按法线主轴做盒状投影 UV（世界尺度，贴图不拉伸）
function boxUV(geo, scale = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// 剔除三个顶点都落在 inside(x, y, z) 里的三角形（索引几何）
function dropTris(geo, inside) {
  const P = geo.attributes.position, idx = geo.index; if (!idx) return;
  const keep = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const ins = v => inside(P.getX(v), P.getY(v), P.getZ(v));
    if (!(ins(a) && ins(b) && ins(c))) keep.push(a, b, c);
  }
  geo.setIndex(keep);
}

export class Machine {
  constructor(scene, config, assets) {
    this.cfg = config; this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.assets = assets;
    this._mats();
    this._table();
    this._cabinet();
    this._pusher();
    this._backHousing();
    this._kit();
    this._dropper();
    this._gate();
    this._tideMeter();
    this._lanterns();
    this._deck();
  }

  _mats() {
    const wood = woodPlanks({ planks: 4, base: '#5c2a1d', seed: 5 });
    const woodDark = woodPlanks({ planks: 5, base: '#3a1c14', seed: 11 });
    const deck = woodPlanks({ planks: 8, base: '#3b2b24', dark: '#21160f', light: '#5a4536', seed: 21, grain: 1.1 });
    // 午夜蓝漆面（机台外壳 / 船体）：漆过的木板，纹理只剩一点板缝与色差；与金币形成冷暖对比
    const navy = woodPlanks({ planks: 4, base: '#25597c', dark: '#173d58', light: '#3874a0', seed: 5, grain: 0.35, seam: 'rgba(6,14,24,0.8)' });
    const navyDeep = woodPlanks({ planks: 5, base: '#173852', dark: '#0e2436', light: '#22496a', seed: 11, grain: 0.3, seam: 'rgba(4,8,14,0.85)' });
    this.m = {
      lacquer: new THREE.MeshPhysicalMaterial({ map: navy.map, normalMap: navy.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.45, envMapIntensity: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.16 }),
      lacquerDeep: new THREE.MeshPhysicalMaterial({ map: navyDeep.map, normalMap: navyDeep.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.5, envMapIntensity: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      // 漆木：清漆层给倒角边一道高光（玩具感的关键）
      wood: new THREE.MeshPhysicalMaterial({ map: wood.map, normalMap: wood.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.55, metalness: 0, envMapIntensity: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.28 }),
      woodDark: new THREE.MeshPhysicalMaterial({ map: woodDark.map, normalMap: woodDark.normalMap, roughness: 0.6, envMapIntensity: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
      deck: new THREE.MeshStandardMaterial({ map: deck.map, normalMap: deck.normalMap, roughness: 0.75, envMapIntensity: 0.12 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd6b26e, metalness: 1, roughness: 0.28, envMapIntensity: 0.8 }),
      brassDim: new THREE.MeshStandardMaterial({ color: 0xb08f55, metalness: 1, roughness: 0.36 }),
      velvet: new THREE.MeshPhysicalMaterial({ color: 0x135e6c, roughness: 0.92, sheen: 1, sheenColor: new THREE.Color(0x6fe2ee), sheenRoughness: 0.4, normalMap: velvetNormal(), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.08 }),
      pit: new THREE.MeshStandardMaterial({ color: 0x07050a, roughness: 1 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x23222a, metalness: 0.7, roughness: 0.45 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xffa040, emissiveIntensity: 3.2, roughness: 0.2, transparent: true, opacity: 0.92 }),
      reelFace: new THREE.MeshStandardMaterial({ color: 0xfff2d8, roughness: 0.45 }),
      rope: new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.9, envMapIntensity: 0.15 }),
      canvas: new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.85, envMapIntensity: 0.15 }),
    };
    // 骷髅徽章：直接用已过审的老虎机骷髅徽章图（黄铜圆框 + 立体骷髅），自发光一点保证暗处可读
    // glTF 的 UV 原点在左上，贴图不能翻 Y（CanvasTexture 默认翻，徽章会倒过来）
    const badge = this.assets.badgeTex;
    if (badge) { badge.flipY = false; badge.needsUpdate = true; }
    this.m.medal = badge ? new THREE.MeshStandardMaterial({ map: badge, emissive: 0xffffff, emissiveMap: badge, emissiveIntensity: 0.18, metalness: 0.25, roughness: 0.45, envMapIntensity: 0.4 }) : this.m.brass;
    // 投币口 / 骷髅门的装饰艺术风：抛光金 + 深蓝珐琅
    this.m.gilt = new THREE.MeshStandardMaterial({ color: 0xe0bc76, metalness: 1, roughness: 0.24, envMapIntensity: 0.75 });
    this.m.enamel = new THREE.MeshPhysicalMaterial({ color: 0x0b1a2e, roughness: 0.42, envMapIntensity: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.35 });   // 近黑藏蓝：投币斗正对灯泡、强光下浅一点的蓝会被照成棕金
  }

  _add(geo, mat, x, y, z, { cast = true, receive = true, uvScale = 2.2, parent = this.group } = {}) {
    if (uvScale) boxUV(geo, uvScale);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m);
    return m;
  }
  // 沿线段的黄铜圆杆（包边 / 扶手）
  _rail(a, b, r, mat = this.m.brass) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CapsuleGeometry(r, len, 4, 12);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
  _table() {
    const M = this.cfg.machine;
    const back = M.backWallZ - 1.5;
    const len = M.tableFrontZ - back;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(M.width, len), this.m.velvet);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, 0.001, back + len / 2);
    top.receiveShadow = true;
    this.group.add(top);
  }

  _cabinet() {
    const M = this.cfg.machine;
    const front = M.tableFrontZ, so = M.sideOpenFromZ;
    // 护栏（鹦鹉道具）：黄铜栏杆，平时降下藏进槽里
    const gLen = front - so;
    this.guards = [-1, 1].map(s => {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, gLen, 4, 10), this.m.brass);
      bar.rotation.x = Math.PI / 2; bar.position.set(0, M.guardWallHeight, 0);
      g.add(bar);
      for (let i = 0; i < 4; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, M.guardWallHeight + 1, 8), this.m.brass);
        post.position.set(0, (M.guardWallHeight - 1) / 2, -gLen / 2 + (i + 0.5) * gLen / 4);
        g.add(post);
      }
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(gLen, M.guardWallHeight), new THREE.MeshStandardMaterial({ color: 0x3ff2ff, emissive: 0x19b8d6, emissiveIntensity: 1.5, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      panel.rotation.y = Math.PI / 2; panel.position.y = M.guardWallHeight / 2;
      g.add(panel);
      g.position.set(s * (M.width / 2 + 0.16), 0, so + gLen / 2);   // 杆子内沿 ≈ halfW + 0.08，靠墙的币不会切进杆子
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.userData.raise = 0;
      this.group.add(g);
      return g;
    });
  }

  _pusher() {
    const M = this.cfg.machine;
    const p = this.pusher = new THREE.Group();
    p.position.y = M.pusherHeight / 2;
    this.group.add(p);
  }

  _backHousing() {
    const M = this.cfg.machine;
    const zf = M.backWallZ - 0.5;           // 罩子前沿
    const y0 = M.pusherHeight + 3.1;        // 罩子底
    const hous = this.housing = new THREE.Group();
    hous.position.set(0, y0, zf);
    this.group.add(hous);
    const W = M.width + 1.6, H = 4.4, back = -1.5;   // 与 Blender 罩体一致（灯泡坐在模型的灯杯里）
    const tmp = new THREE.Object3D();
    const bulbGeo = new THREE.SphereGeometry(0.13, 12, 8);
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const archN = 13;
    const am = this.archBulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, archN);
    for (let i = 0; i < archN; i++) {
      const a = Math.PI * (0.06 + 0.88 * i / (archN - 1));
      tmp.position.set(Math.cos(a) * (W / 2 - 0.05), H + Math.sin(a) * (W / 2 - 0.05) * 0.42, back + 0.18);
      tmp.updateMatrix(); am.setMatrixAt(i, tmp.matrix); am.setColorAt(i, new THREE.Color(0xffb347));
    }
    hous.add(am);

    // 斜面面板（九宫格版，代码建模，替换 machine.glb 的 face 组）：朝镜头仰起；窗口是真开口，三条弧面转轮在后面
    const face = this.face = new THREE.Group();
    face.position.set(0, 0, 0.2);
    face.rotation.x = -0.42;
    hous.add(face);
    const ft = 0.3, fw = 10.6, fh = 4.0;
    const win = this.win = { w: 5.7, h: 2.75, y: 2.15 };
    const rrect = (path, cx, cy, w, h, r) => {
      const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
      path.moveTo(x0 + r, y0); path.lineTo(x1 - r, y0); path.quadraticCurveTo(x1, y0, x1, y0 + r); path.lineTo(x1, y1 - r); path.quadraticCurveTo(x1, y1, x1 - r, y1);
      path.lineTo(x0 + r, y1); path.quadraticCurveTo(x0, y1, x0, y1 - r); path.lineTo(x0, y0 + r); path.quadraticCurveTo(x0, y0, x0 + r, y0);
      return path;
    };
    const ring = (ow, oh, or, iw, ih, ir, cy) => { const sh = rrect(new THREE.Shape(), 0, cy, ow, oh, or); sh.holes.push(rrect(new THREE.Path(), 0, cy, iw, ih, ir)); return sh; };
    const extrude = (shape, depth, bevel, mat, z) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
      g.translate(0, 0, z - depth - bevel);   // 前表面落在 z
      const m = this._add(g, mat, 0, 0, 0, { parent: face, uvScale: mat === this.m.lacquerDeep ? 2.2 : 0 });
      return m;
    };
    // 漆面面板（开窗）+ 厚黄铜窗框 + 细黄铜内沿 + 两条列分隔条
    const panel = rrect(new THREE.Shape(), 0, fh / 2, fw, fh, 0.14); panel.holes.push(rrect(new THREE.Path(), 0, win.y, win.w + 0.1, win.h + 0.1, 0.24));
    extrude(panel, ft - 0.12, 0.06, this.m.lacquerDeep, ft / 2);
    extrude(ring(win.w + 0.56, win.h + 0.56, 0.38, win.w, win.h, 0.22, win.y), 0.12, 0.08, this.m.brass, ft / 2 + 0.24);
    extrude(ring(win.w + 0.08, win.h + 0.08, 0.24, win.w - 0.06, win.h - 0.06, 0.2, win.y), 0.3, 0.02, this.m.brassDim, ft / 2 + 0.02);
    for (const s of [-1, 1]) this._add(new THREE.CapsuleGeometry(0.05, win.h - 0.1, 4, 8), this.m.brassDim, s * 0.95, win.y, ft / 2 - 0.1, { parent: face, uvScale: 0 });
    // 两侧立板 + 黄铜包边（原 Blender 面板的侧框）
    for (const s of [-1, 1]) {
      this._add(new THREE.BoxGeometry(0.42, fh + 0.1, 1.9), this.m.lacquer, s * (fw / 2 - 0.2), fh / 2, -0.95, { parent: face });
      this._add(new THREE.CapsuleGeometry(0.1, fh, 4, 10), this.m.brass, s * (fw / 2 - 0.2), fh / 2, 0.05, { parent: face, uvScale: 0 });
    }
    for (const y of [0.02, fh - 0.02]) { const m = this._add(new THREE.CapsuleGeometry(0.07, fw - 0.6, 4, 10), this.m.brass, 0, y, ft / 2, { parent: face, uvScale: 0 }); m.rotation.z = Math.PI / 2; }
    const backing = new THREE.Mesh(new THREE.PlaneGeometry(win.w + 0.4, win.h + 0.4), new THREE.MeshStandardMaterial({ color: 0x120805, roughness: 1 }));
    backing.position.set(0, win.y, -1.2);
    face.add(backing);
    // 三条弧面转轮：半径 2 的圆柱只取正面 ±43.5° 一段，纸带在上面滚动（贴图偏移），一格 = 26°，窗口里正好露出三格
    this.reels = [];
    const RR = 2.0, TH = 43.5 * Math.PI / 180, CELL = 26 * Math.PI / 180, colX = c => (c - 1) * 1.9;
    this.reelRepeat = (2 * TH / CELL) / 10;
    for (let i = 0; i < 3; i++) {
      const tex = this.assets.reelStrips[i].tex;
      tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = this.reelRepeat;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, 1.78, 40, 1, true, -TH, 2 * TH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffe2b0, emissiveMap: tex, emissiveIntensity: 0.42 }));
      r.rotation.z = Math.PI / 2;
      r.position.set(colX(i), win.y, -RR);
      face.add(r);
      this.reels.push(r);
    }
    // 中奖连线：5 条发光线（上 / 中 / 下 / 两条对角）+ 9 个格子光晕（金币散布、鹦鹉计数用）
    const rowY = r => win.y + (1 - r) * RR * Math.sin(CELL), zw = ft / 2 + 0.04;
    // 格子高亮：圆角描边框（米色纸带很亮，加法光晕看不出来，用不透明的彩色描边）
    const frameTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 140;
      const g = c.getContext('2d');
      g.shadowColor = '#fff'; g.shadowBlur = 18; g.strokeStyle = '#fff'; g.lineWidth = 15;
      g.beginPath(); g.roundRect(14, 14, 228, 112, 22); g.stroke(); g.stroke();
      return new THREE.CanvasTexture(c);
    })();
    const lineTex = (() => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 64;
      const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, 'rgba(10,24,48,0)'); grd.addColorStop(0.18, 'rgba(10,24,48,.85)'); grd.addColorStop(0.32, '#ffd36a');
      grd.addColorStop(0.5, '#fffbe8'); grd.addColorStop(0.68, '#ffd36a'); grd.addColorStop(0.82, 'rgba(10,24,48,.85)'); grd.addColorStop(1, 'rgba(10,24,48,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 8, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.winLines = [[[0, 0], [2, 0]], [[0, 1], [2, 1]], [[0, 2], [2, 2]], [[0, 0], [2, 2]], [[0, 2], [2, 0]]].map(([[c0, r0], [c1, r1]]) => {
      const a = new THREE.Vector2(colX(c0), rowY(r0)), b = new THREE.Vector2(colX(c1), rowY(r1));
      const d = b.clone().sub(a).normalize().multiplyScalar(0.8); a.sub(d); b.add(d);   // 两端各伸出半格
      const len = a.distanceTo(b);
      // 连线：深色外边 + 亮金芯（米色纸带上加法光看不见，改普通混合的「描边光带」）
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.3), new THREE.MeshBasicMaterial({ map: lineTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, zw); m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      m.renderOrder = 4; m.userData.k = 0; face.add(m);
      return m;
    });
    this.cellGlows = [];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.95), new THREE.MeshBasicMaterial({ map: frameTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      m.position.set(colX(c), rowY(r), zw - 0.004); m.renderOrder = 3; m.userData.k = 0; face.add(m);
      this.cellGlows[c * 3 + r] = m;
      // 没中奖的格子压暗：中奖格一眼跳出来
      const dim = new THREE.Mesh(new THREE.PlaneGeometry(1.74, 0.95), new THREE.MeshBasicMaterial({ color: 0x050d1c, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      dim.position.set(colX(c), rowY(r), zw - 0.008); dim.renderOrder = 2; dim.userData.k = 0; face.add(dim);
      (this.cellDims ??= [])[c * 3 + r] = dim;
    }
    // 跑马灯泡 + 黄铜灯杯：窗口一圈
    const bulbs = [];
    const bw = win.w + 1.05, bh = win.h + 0.92, per = 2 * (bw + bh), N = 30;
    for (let i = 0; i < N; i++) {
      let d = (i / N) * per, x, y;
      if (d < bw) { x = -bw / 2 + d; y = bh / 2; }
      else if ((d -= bw) < bh) { x = bw / 2; y = bh / 2 - d; }
      else if ((d -= bh) < bw) { x = bw / 2 - d; y = -bh / 2; }
      else { d -= bw; x = -bw / 2; y = -bh / 2 + d; }
      bulbs.push([x, y + win.y, ft / 2 + 0.06]);
    }
    const bm = this.bulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, bulbs.length);
    const cupGeo = new THREE.LatheGeometry([[0.0, 0], [0.19, 0], [0.23, 0.07], [0.19, 0.13], [0.15, 0.09], [0.0, 0.07]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
    cupGeo.rotateX(Math.PI / 2);
    const cups = new THREE.InstancedMesh(cupGeo, this.m.brassDim, bulbs.length);
    bulbs.forEach(([x, y, zz], i) => {
      tmp.position.set(x, y, zz); tmp.updateMatrix(); bm.setMatrixAt(i, tmp.matrix); bm.setColorAt(i, new THREE.Color(0xffb347));
      tmp.position.set(x, y, ft / 2 - 0.04); tmp.updateMatrix(); cups.setMatrixAt(i, tmp.matrix);
    });
    face.add(bm, cups);
    // 待转次数徽标的锚点：窗口右上角（UI 层投影到屏幕）
    this.spinAnchor = new THREE.Object3D(); this.spinAnchor.position.set(win.w / 2 + 0.25, win.y + win.h / 2 + 0.25, ft / 2 + 0.2); face.add(this.spinAnchor);
    // 潮汐计：窗口两侧两根竖直玻璃管（潮位往上涨）
    this.tideAnchors = [-1, 1].map(s => { const o = new THREE.Object3D(); o.position.set(s * 4.25, 0.5, ft / 2 + 0.05); face.add(o); return o; });
  }

  // Blender 外壳：按分组挂到对应的代码分组下，材质按名字换成运行时材质，木头/青绒重新做世界尺度 UV
  _kit() {
    const kit = this.assets.kit;
    const targets = { cabinet: this.group, pusher: this.pusher, housing: this.housing, dressing: this.group };   // face 组改为代码建模（九宫格窗口）
    // 外壳（柜体 / 罩子 / 面板 / 推板）的木件刷成午夜蓝漆；桅杆、木箱等甲板杂物保留原木
    const shell = { wood: 'lacquer', woodDark: 'lacquerDeep' };
    for (const [name, target] of Object.entries(targets)) {
      const node = kit.getObjectByName(name);
      if (!node) { console.warn('machine.glb 缺少分组', name); continue; }
      for (const m of node.children.filter(c => c.isMesh)) {
        const src = m.material.name.replace(/\.\d+$/, '');
        const key = name !== 'dressing' && shell[src] ? shell[src] : src;
        const mat = this.m[key];
        if (!mat) console.warn('machine.glb 未知材质', key);
        if (mat) m.material = mat;
        if (['wood', 'woodDark', 'lacquer', 'lacquerDeep', 'velvet', 'canvas'].includes(key)) boxUV(m.geometry, key === 'velvet' ? 1.2 : 2.2);
        // 甲板盘绳：glb 里那圈光滑螺旋管看着像假绳子，剔掉它的三角形（view.js 另做三股捻绳）
        // machine_v2.py 已删掉这段；Blender 文件里混着 D1 分支的同名物体，暂不重新导出
        if (key === 'rope') dropTris(m.geometry, (x, y, z) => Math.abs(x + 4.1) < 1.1 && Math.abs(z - 6.4) < 1.1 && y < DECK_Y + 0.5);
        m.castShadow = key !== 'velvet'; m.receiveShadow = true;
        m.position.set(0, 0, 0); m.quaternion.identity();
        target.add(m);
      }
    }
  }

  // 车床体：轮廓点 [半径, 高度]
  _lathe(pts, seg = 28) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
  // 投币口（装饰艺术风，克制）：轨道上一节金套筒（中段珐琅），两条扁吊带吊着车床斗身——
  // 阶梯式口沿、抛光金锥身、中腰一圈深蓝珐琅夹两道细金线、阶梯收口的出币嘴
  _dropper() {
    const M = this.cfg.machine;
    const y = M.dropperY + 0.5;   // 漏斗压低到老虎机窗口以下（物理投币点 dropY 不变）
    this._rail([-M.dropXRange - 0.5, y, M.dropZ], [M.dropXRange + 0.5, y, M.dropZ], 0.08);   // 只比滑块行程长一点：左端不能穿过鹦鹉
    // 轨道两端支架（接到罩子立柱）
    for (const s of [-1, 1]) this._rail([s * (M.dropXRange + 0.5), y, M.dropZ], [s * (M.dropXRange + 0.7), M.pusherHeight + 3.4, M.backWallZ - 0.4], 0.09, this.m.brassDim);
    const g = this.dropper = new THREE.Group();
    const add = (geo, mat, py = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = py; g.add(m); return m; };
    // 斗身：外壁（阶梯口沿 → 锥身 → 阶梯收口 → 出币嘴）+ 内壁，一条闭合轮廓
    add(this._lathe([
      [0.16, -0.58], [0.21, -0.58], [0.21, -0.5], [0.26, -0.5], [0.26, -0.44], [0.31, -0.44],   // 两级阶梯出币嘴
      [0.31, -0.38], [0.6, 0.1],                                                               // 锥身
      [0.66, 0.1], [0.66, 0.17], [0.7, 0.17], [0.7, 0.25],                                     // 两级阶梯口沿
      [0.6, 0.25], [0.55, 0.12], [0.24, -0.38], [0.16, -0.46], [0.16, -0.58],                  // 内壁
    ], 48), this.m.gilt);
    // 中腰珐琅带 + 上下两道细金线（锥面上的一段截锥）
    const ry = yy => 0.31 + (0.6 - 0.31) * (yy + 0.38) / 0.48;
    const band = (y0, y1, d, mat) => add(new THREE.CylinderGeometry(ry(y1) + d, ry(y0) + d, y1 - y0, 48, 1, true), mat, (y0 + y1) / 2);
    band(-0.27, -0.02, 0.012, this.m.enamel);
    for (const yy of [-0.285, -0.005]) { const t = add(new THREE.TorusGeometry(ry(yy) + 0.014, 0.012, 6, 48), this.m.gilt, yy); t.rotation.x = Math.PI / 2; }
    // 喉口：往斗里看是深色的洞
    const throat = add(new THREE.CircleGeometry(0.17, 24), this.m.pit, -0.42); throat.rotation.x = -Math.PI / 2;
    // 轨道套筒：两端金、中段珐琅
    for (const [x0, x1, mat] of [[-0.27, -0.12, this.m.gilt], [-0.12, 0.12, this.m.enamel], [0.12, 0.27, this.m.gilt]]) {
      const r = mat === this.m.enamel ? 0.13 : 0.145;
      const m = add(new THREE.CylinderGeometry(r, r, x1 - x0, 24), mat, 0.5); m.rotation.z = Math.PI / 2; m.position.x = (x0 + x1) / 2;
    }
    // 两条扁吊带：套筒两端 → 口沿
    for (const s of [-1, 1]) {
      const A = new THREE.Vector3(s * 0.2, 0.42, 0), B = new THREE.Vector3(s * 0.66, 0.22, 0);
      const strap = add(new THREE.BoxGeometry(0.05, A.distanceTo(B) + 0.04, 0.12), this.m.gilt);
      strap.position.copy(A).add(B).multiplyScalar(0.5); strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(0, y - 0.5, M.dropZ); this.dropperY = y - 0.5;
    this.group.add(g);
    // 投币指示：落点光圈
    const mark = this.dropMark = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, M.pusherHeight + 0.02, M.dropZ);
    this.group.add(mark);
  }

  // 骷髅门（装饰艺术风，克制）：两根细长金柱（阶梯底座、中段珐琅套、阶梯柱头）+ 抛光金球顶（一道珐琅腰线），
  // 两柱之间一只细金圈（内衬珐琅、嵌荧光内环）。外形贴着碰撞体：立柱胶囊 postR / postHalf，球顶 capR（config.gate）。视觉，不碰撞
  _gate() {
    const G = this.cfg.gate, M = this.cfg.machine;
    const g = this.gateGroup = new THREE.Group();
    const h = G.postHalf + G.postR, r = G.postR;
    const postGeo = this._lathe([
      [0, -h - 0.06], [r * 1.8, -h - 0.06], [r * 1.8, -h], [r * 1.4, -h], [r * 1.4, -h + 0.06], [r * 0.9, -h + 0.06],   // 两级阶梯底座
      [r * 0.85, G.postHalf - 0.06], [r * 1.3, G.postHalf - 0.06], [r * 1.3, G.postHalf], [r * 1.6, G.postHalf], [r * 1.6, G.postHalf + 0.05], [0, G.postHalf + 0.05],   // 阶梯柱头
    ], 32);
    const sleeveGeo = new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.42, 24);
    const cy = G.postHalf + G.capR * 0.6, R = G.spacing / 2 - G.postR - 0.03;
    for (const s of [-1, 1]) {
      const x = s * G.spacing / 2;
      const post = new THREE.Mesh(postGeo, this.m.gilt); post.position.x = x;
      const sleeve = new THREE.Mesh(sleeveGeo, this.m.enamel); sleeve.position.set(x, -0.18, 0);
      for (const yy of [-0.39, 0.03]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, 0.014, 6, 24), this.m.gilt); t.rotation.x = Math.PI / 2; t.position.set(x, yy, 0); g.add(t); }
      const cap = new THREE.Mesh(new THREE.SphereGeometry(G.capR, 32, 20), this.m.gilt); cap.position.set(x, cy, 0);
      const belt = new THREE.Mesh(new THREE.TorusGeometry(G.capR * 1.0, 0.018, 8, 40), this.m.enamel); belt.rotation.x = Math.PI / 2; belt.position.set(x, cy, 0);
      // 金圈托杆
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, G.spacing / 2 - R, 10), this.m.gilt);
      arm.rotation.z = Math.PI / 2; arm.position.x = s * (R + (G.spacing / 2 - R) / 2);
      g.add(post, sleeve, cap, belt, arm);
    }
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(R + 0.01, 0.038, 12, 64), this.m.gilt); hoop.rotation.x = Math.PI / 2;
    const liner = new THREE.Mesh(new THREE.TorusGeometry(R - 0.035, 0.016, 8, 64), this.m.enamel); liner.rotation.x = Math.PI / 2; liner.position.y = 0.012;
    const ring = this.gateRing = new THREE.Mesh(new THREE.TorusGeometry(R - 0.035, 0.014, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff2ff).multiplyScalar(1.6), transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.012;
    const disc = this.gateDisc = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 48), new THREE.MeshBasicMaterial({ color: 0x3ff2ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    g.add(hoop, liner, ring, disc);
    g.traverse(o => { if (o.isMesh && o !== ring && o !== disc) o.castShadow = true; });
    g.position.set(0, G.y, M.dropZ);
    this.group.add(g);
    this.gateFlash = 0;
  }

  // 潮汐计：窗口两侧的竖直发光玻璃管
  _tideMeter() {
    const L = 2.9, r = 0.17;
    // 不用 transmission：three.js 只要场景里有一个透射材质，每帧就要把整个场景多画一遍（实测掉约 13% 帧率）；普通半透明 + 环境反射看起来差不多
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fdfff, roughness: 0.05, transparent: true, opacity: 0.32, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff2ff).multiplyScalar(1.5) });
    const fillGeo = new THREE.CylinderGeometry(r * 0.72, r * 0.72, 1, 16); fillGeo.translate(0, 0.5, 0);
    this.tideFills = this.tideAnchors.map(a => {
      const glass = new THREE.Mesh(new THREE.CapsuleGeometry(r, L, 6, 20), glassMat);
      glass.position.y = L / 2;
      const fill = new THREE.Mesh(fillGeo, fillMat); fill.scale.y = 0.001;
      a.add(glass, fill);
      for (const y of [-r * 0.9, L + r * 0.9]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.4, r * 1.4, 0.22, 16), this.m.brass); cap.position.y = y; a.add(cap); }
      for (let i = 1; i < 5; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), this.m.brassDim); t.position.set(r + 0.06, (L * i) / 5, 0.05); a.add(t); }
      return fill;
    });
    this.tideFill = { material: fillMat };
    this.tideLen = L;
    this.tideShown = 0;
  }

  _lanterns() {
    const M = this.cfg.machine, hw = M.width / 2;
    this.lanternGlass = [];
    // 装饰艺术船灯：六棱玻璃灯罩 + 六根黄铜角柱 + 上下阶梯法兰；顶上阶梯穹顶、通风烟囱、提环；
    // 罩里一根蜡烛 + 火苗芯（灯罩本身半透发光，火苗是最亮的一点）
    const lathe = (pts, seg = 6) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const hexR = 0.36, hexH = 0.8;
    const geo = {
      foot: lathe([[0, -0.66], [0.44, -0.66], [0.46, -0.6], [0.4, -0.56], [0.4, -0.52], [0.47, -0.5], [0.47, -0.44], [0, -0.44]], 24),
      flangeLo: lathe([[0, -0.44], [0.44, -0.44], [0.44, -0.39], [0.4, -0.39], [0, -0.39]], 6),
      glass: new THREE.CylinderGeometry(hexR - 0.02, hexR - 0.02, hexH, 6, 1, true),
      rib: new THREE.BoxGeometry(0.07, hexH + 0.06, 0.07),
      band: new THREE.TorusGeometry(hexR + 0.005, 0.022, 4, 6),
      flangeHi: lathe([[0, 0.39], [0.46, 0.39], [0.48, 0.45], [0.42, 0.45], [0.42, 0.5], [0, 0.5]], 6),
      dome: lathe([[0.38, 0.5], [0.36, 0.6], [0.3, 0.68], [0.26, 0.68], [0.22, 0.76], [0.15, 0.8], [0.15, 0.86], [0, 0.86]], 24),
      chimney: lathe([[0.1, 0.86], [0.1, 0.98], [0.15, 1.0], [0.15, 1.05], [0.08, 1.07], [0, 1.07]], 16),
      vent: new THREE.TorusGeometry(0.155, 0.02, 4, 16),
      bail: new THREE.TorusGeometry(0.17, 0.028, 8, 20, Math.PI * 1.25),
      finial: new THREE.SphereGeometry(0.05, 10, 8),
      candle: new THREE.CylinderGeometry(0.075, 0.08, 0.32, 12),
      flame: new THREE.SphereGeometry(0.06, 10, 8),
    };
    geo.flame.scale(1, 1.9, 1);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).multiplyScalar(4) });
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xf2e6cc, emissive: 0xffb060, emissiveIntensity: 0.5, roughness: 0.6 });
    this.lanternFlames = [];
    const mk = (x, y, z) => {
      const g = new THREE.Group();
      const add = (gg, mat, py = 0) => { const m = new THREE.Mesh(gg, mat); m.position.y = py; g.add(m); return m; };
      add(geo.foot, this.m.brass);
      add(geo.flangeLo, this.m.gilt).rotation.y = Math.PI / 6;
      const glass = add(geo.glass, this.m.glass.clone());
      glass.rotation.y = Math.PI / 6; glass.material.side = THREE.DoubleSide; glass.material.opacity = 0.5; glass.material.flatShading = true; glass.material.depthWrite = false;
      for (let i = 0; i < 6; i++) {   // 角柱在六棱的棱上
        const a = i * Math.PI / 3, r = add(geo.rib, this.m.brass);
        r.position.set(Math.cos(a) * hexR, 0, Math.sin(a) * hexR); r.rotation.y = -a;
      }
      for (const by of [-0.12, 0.2]) { const b = add(geo.band, this.m.brassDim, by); b.rotation.x = Math.PI / 2; b.rotation.z = Math.PI / 6; }   // 两道护条
      add(geo.flangeHi, this.m.gilt).rotation.y = Math.PI / 6;
      add(geo.dome, this.m.brass);
      add(geo.chimney, this.m.brass);
      add(geo.vent, this.m.enamel, 0.93).rotation.x = Math.PI / 2;   // 烟囱上一圈蓝珐琅（呼应外壳）
      const bail = add(geo.bail, this.m.brassDim, 1.16); bail.rotation.z = -Math.PI * 0.125;
      add(geo.finial, this.m.gilt, 1.1);
      add(geo.candle, waxMat, -0.23);
      const flame = add(geo.flame, flameMat, 0.03);
      g.position.set(x, y, z);
      g.traverse(o => { if (o.isMesh && o !== glass && o !== flame) o.castShadow = true; });
      this.group.add(g);
      this.lanternGlass.push(glass); this.lanternFlames.push(flame);
      return g;
    };
    const ox = hw + 0.95;
    // 灯笼立在 machine.glb 的车削立柱顶上（立柱已建模，这里不再做杆）
    mk(-ox, 2.2, M.tableFrontZ + 0.15);
    mk(ox, 2.2, M.tableFrontZ + 0.15);
    mk(ox + 0.07, 4.6, M.backWallZ + 0.3);   // 左后立柱顶上是鹦鹉的栖架（view.js），不放灯笼
    // 前灯笼的光：画在台面 / 甲板上的加法光斑（假光），不用实时点光源
    const poolTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    this.lanternLights = [];
    for (const s of [-1, 1]) for (const [y, r, k] of [[0.012, 6.5, 0.32], [DECK_Y + 0.02, 9, 0.4]]) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(r, r), new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(0xffa94d).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: true }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(s * (ox - 0.6), y, M.tableFrontZ + (y > -1 ? -0.9 : 1.2));
      pool.userData.k = k; pool.renderOrder = 1;
      this.group.add(pool); this.lanternLights.push(pool);
    }
    const marquee = this.marqueeLight = new THREE.PointLight(0xffd29a, 10, 14, 1.8);
    marquee.position.set(0, M.pusherHeight + 6.2, M.backWallZ + 2.8);   // 离投币口 ≈ 2.5：原来只差 1，投币口被照得发白过曝、看不出造型
    this.group.add(marquee);
  }

  _deck() {
    const M = this.cfg.machine;
    // 甲板外形：后段宽、船头收窄
    const s = new THREE.Shape();
    // 船头在收币宝箱后不远处收尖，画面下角露出荧光海
    const W = 7.0, zb = -22, z1 = 0.5, tip = 11.0;
    s.moveTo(-W, zb); s.lineTo(W, zb); s.lineTo(W, z1);
    s.bezierCurveTo(W, 6.2, 4.4, 9.5, 0, tip); s.bezierCurveTo(-4.4, 9.5, -W, 6.2, -W, z1); s.closePath();
    const top = new THREE.ShapeGeometry(s, 24);
    top.rotateX(Math.PI / 2);   // shape 的 y → z
    const uv = top.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.2, uv.getY(i) / 3.2);
    const deck = new THREE.Mesh(top, this.m.deck);
    deck.material.side = THREE.DoubleSide;
    deck.position.y = DECK_Y; deck.receiveShadow = true;
    this.group.add(deck);
    // 船舷：沿轮廓挤出一圈矮墙 + 黄铜扶手
    const pts = s.getSpacedPoints(90).map(p => new THREE.Vector3(p.x, DECK_Y, p.y));
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const hull = new THREE.Mesh(new THREE.TubeGeometry(curve, 180, 0.32, 8, true), this.m.lacquerDeep);
    hull.scale.set(1, 1, 1); hull.position.y = 0.35; hull.castShadow = true; hull.receiveShadow = true;
    this.group.add(hull);
    const railTube = new THREE.Mesh(new THREE.TubeGeometry(curve, 180, 0.12, 8, true), this.m.brassDim);
    railTube.position.y = 0.85; railTube.castShadow = true;
    this.group.add(railTube);
    // 船体外板：从甲板沿往下伸进海里
    const side = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 90, 1, true), this.m.woodDark);
    const sideGeo = new THREE.BufferGeometry();
    const P = [], I = [], U = [];
    const n = pts.length;
    pts.forEach((p, i) => { P.push(p.x, DECK_Y + 0.2, p.z, p.x * 0.93, DECK_Y - 4.5, p.z * 0.97); U.push(i / n * 30, 1, i / n * 30, 0); });
    for (let i = 0; i < n; i++) { const a = i * 2, b = ((i + 1) % n) * 2; I.push(a, b, a + 1, b, b + 1, a + 1); }
    sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    sideGeo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    sideGeo.setIndex(I); sideGeo.computeVertexNormals();
    side.geometry = sideGeo; side.material = this.m.lacquerDeep.clone(); side.material.side = THREE.DoubleSide;
    this.group.add(side);
    this.hullRect = [W * 0.95, zb, z1, tip];   // 吃水线轮廓：半宽、船尾、收窄起点、船头尖（海面泡沫用）
  }

  // 亮起中奖线 / 格子：lines = 线序号数组，cells = [[列, 行], …]；持续约 2 秒后淡出
  showWin(lines = [], cells = [], color = 0xffd36a) {
    const L = [[[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]], [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]]];
    for (const i of lines) { const m = this.winLines[i]; m.material.color.set(color).multiplyScalar(1.3); m.userData.k = 2.2; cells = cells.concat(L[i]); }
    for (const [c, r] of cells) { const m = this.cellGlows[c * 3 + r]; m.material.color.set(color); m.userData.k = 2.2; }
    // 同一转（0.5 秒内的几次 showWin：连线 / 金币堆 / 鹦鹉）合并中奖格，其余格子压暗
    const now = performance.now();
    if (!this.winSet || now - this.winAt > 500) this.winSet = new Set();
    this.winAt = now;
    for (const [c, r] of cells) this.winSet.add(c * 3 + r);
    if (this.winSet.size) this.cellDims.forEach((d, i) => { d.userData.k = this.winSet.has(i) ? 0 : 2.2; });
  }

  // ---------- 每帧 ----------
  update(sim, alpha, t, state = {}) {
    for (const m of this.winLines) if (m.userData.k > 0) { m.userData.k = Math.max(0, m.userData.k - 1 / 60); const k = m.userData.k; m.material.opacity = Math.min(1, k) * (0.85 + 0.15 * Math.sin(t * 18)); m.scale.y = 1 + 0.25 * Math.sin(t * 9); }
    for (const m of this.cellDims) { if (m.userData.k > 0) m.userData.k = Math.max(0, m.userData.k - 1 / 60); m.material.opacity = Math.min(1, m.userData.k * 2) * 0.5; }
    for (const m of this.cellGlows) if (m.userData.k > 0) { m.userData.k = Math.max(0, m.userData.k - 1 / 60); m.material.opacity = Math.min(1, m.userData.k) * (0.75 + 0.25 * Math.sin(t * 10)); }
    const M = this.cfg.machine;
    const z0 = sim.pusherCenterZ(sim.prevPhase ?? sim.phase), z1 = sim.pusherCenterZ();
    this.pusher.position.z = z0 + (z1 - z0) * alpha;
    // 骷髅门
    const gx0 = sim.prevGateX ?? sim.gateX;
    this.gateGroup.position.x = gx0 + (sim.gateX - gx0) * alpha;
    this.gateFlash = Math.max(0, this.gateFlash - 0.04);
    const gf = this.gateFlash;
    this.gateRing.material.color.setRGB(0.25 + 3 * gf + 0.15 * Math.sin(t * 6), 0.95 + 2 * gf, 1 + 2 * gf);
    this.gateDisc.material.opacity = 0.1 + 0.5 * gf;
    this.gateRing.scale.setScalar(1 + 0.08 * gf);
    // 潮汐计
    const tide = state.surge > 0 ? 1 : (state.tide ?? 0);
    this.tideShown += (tide - this.tideShown) * 0.08;
    for (const f of this.tideFills) f.scale.y = Math.max(0.001, this.tideShown * this.tideLen);
    const pulse = state.surge > 0 ? 0.6 + 0.4 * Math.sin(t * 14) : this.tideShown > 0.85 ? 0.8 + 0.2 * Math.sin(t * 8) : 1;
    this.tideFill.material.color.setRGB(0.25 * pulse * 1.5, 0.95 * pulse * 1.5, 1.0 * pulse * 1.5);
    // 跑马灯：追逐 + 呼吸；中奖时整圈闪烁，Jackpot 时金色常亮
    const chase = state.chase ?? 1, flash = state.bulbFlash ?? 0, gold = state.gold ?? 0;
    const c = new THREE.Color();
    const n = this.bulbs.count;
    for (let i = 0; i < n; i++) {
      const on = 0.5 + 0.5 * Math.sin(t * 7 * chase - i * 0.9);
      let k = 0.6 + 2.6 * on * on;
      if (flash > 0) k = k * (1 - flash) + flash * (Math.sin(t * 30) > 0 ? 4.5 : 0.6);
      k += gold * 2.5;
      c.setRGB(1.0 * k, 0.74 * k + gold * 0.2, 0.42 * k * (1 - gold * 0.5));
      this.bulbs.setColorAt(i, c);
    }
    this.marqueeLight.intensity = 10 + gold * 30 + flash * 12;
    this.bulbs.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.archBulbs.count; i++) {
      const on = 0.5 + 0.5 * Math.sin(t * 4 - i * 0.7);
      const k = 0.8 + 2.0 * on;
      c.setRGB(1.0 * k, 0.78 * k, 0.48 * k);
      this.archBulbs.setColorAt(i, c);
    }
    this.archBulbs.instanceColor.needsUpdate = true;
    // 灯笼摇曳
    this.lanternGlass.forEach((g, i) => { g.material.emissiveIntensity = 1.1 + 0.25 * Math.sin(t * 9.1 + i * 2) * Math.sin(t * 3.7 + i); });
    this.lanternFlames.forEach((f, i) => { const k = 1 + 0.12 * Math.sin(t * 13 + i * 2.3) * Math.sin(t * 5.1 + i); f.scale.set(1 / k, k, 1 / k); });
    this.lanternLights.forEach((l, i) => { l.material.opacity = 0.88 + 0.12 * Math.sin(t * 8.3 + (i >> 1) * 1.7); });
    // 投币口跟随
    const dx = state.dropX ?? 0;
    this.dropper.position.x += (dx - this.dropper.position.x) * 0.35;
    // 投币反冲：漏斗往上一顶再回落，压扁一下
    this.kick = Math.max(0, (this.kick ?? 0) - 0.09);
    const kk = Math.sin(this.kick * Math.PI) * this.kick;
    this.dropper.position.y = this.dropperY + kk * 0.22;
    this.dropper.scale.set(1 + kk * 0.12, 1 - kk * 0.14, 1 + kk * 0.12);
    this.dropMark.position.x = this.dropper.position.x;
    this.dropMark.material.opacity = 0.35 + 0.2 * Math.sin(t * 5);
    // 护栏升降
    // 跟物理刚体走（sim.guardRaise），画面和碰撞同步升降
    for (const g of this.guards) {
      g.position.y = sim.guardY(sim.guardRaise);
      g.visible = sim.guardRaise > 0;
    }
    // 转轮待机缓转
    // 弧面转轮：纸带滚动 = 贴图偏移（转角 a 对应纸带位置 a / 2π）
    this.reels.forEach((r, i) => { r.material.map.offset.x = ((state.reelAngles?.[i]) ?? 0) / (Math.PI * 2) - this.reelRepeat / 2; });
  }
}
