// 机台：静态外壳来自 Blender 建模的 machine.glb（D1：art/blender/machine_d1.py；材质名 = 糖果材质名），
// 这里负责把它按分组挂到位、换成运行时材质，并用代码做所有会动 / 会发光的部分：
// 推板运动、三轴转轮、跑马灯、骷髅门、潮汐计、护栏、投币口、灯笼，以及台面与船甲板。
// 尺寸和物理碰撞体一一对应（见 config.machine）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { candy, C } from './candy.js';
import { candyTiles, candyPlanks } from './textures.js';

export const DECK_Y = -3.2;
const TILE = 1.55;   // 台面方砖边长（世界单位）

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

export const RAIL_A0 = -1.42;   // 开场时吊架抬起的角度（≈ 81°：滑轨从 y 6.5 沿圆弧升到 ≈ 10.5，骷髅在转轮窗口上方）

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
    // D1「汽水海」：糖果塑料（见 candy.js / art/ART_BIBLE_D1.md）。旧材质名保留作映射键，便于沿用 machine.glb 的分组。
    this.m = {
      wood: candy(C.pink), woodDark: candy(C.purple), deck: candy(0xffffff, { gloss: 0.35, rim: 0.1 }),
      brass: candy(C.cream, { gloss: 0.8 }), brassDim: candy(C.cream, { gloss: 0.7 }),
      velvet: candy(C.lilac, { gloss: 0.35, rim: 0.12 }),
      pit: candy(C.pit, { gloss: 0.2, rim: 0 }), iron: candy(C.purpleDeep),
      glass: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0c8, emissiveIntensity: 1.6, roughness: 0.2 }),
      reelFace: candy(C.cream, { gloss: 0.5, rim: 0.1 }),
      rope: candy(C.rope, { gloss: 0.15, rim: 0.2 }), canvas: candy(C.cream, { gloss: 0.2 }),
      mint: candy(C.mint), mintDeep: candy(C.mintDeep), cream: candy(C.cream, { gloss: 0.75 }), purple: candy(C.purple), purpleDeep: candy(C.purpleDeep),
      pink: candy(C.pink), pinkLight: candy(C.pinkLight), lilac: candy(C.lilac, { gloss: 0.35, rim: 0.12 }), gold: candy(C.gold, { gloss: 0.9 }), lavender: candy(0xb6abff, { gloss: 0.7 }),
    };
    // 台面 / 推板顶：淡紫软糖方砖（贴图自带颜色，材质底色用白）
    this.m.tiles = candy(0xffffff, { gloss: 0.4, rim: 0.1 });
    this.m.tiles.map = candyTiles();
    this.m.deck.map = candyPlanks();   // 第二轮：甲板珊瑚粉木板（概念图的甲板颜色更饱和）
    // 落海槽底：海水蓝（v6：下层台面前半段两侧能看到海水）
    this.m.water = candy(0x3fd6f2, { gloss: 0.9, rim: 0.25 }); this.m.water.emissive = new THREE.Color(0x0e8fb8); this.m.water.emissiveIntensity = 0.35;
    this.groupMats = { pusher: { lilac: this.m.tiles }, cabinet: { lilac: this.m.tiles, pit: this.m.water } };
    const badge = this.assets.badgeTex;
    this.m.medal = badge ? new THREE.MeshStandardMaterial({ map: badge, roughness: 0.4, envMapIntensity: 0.6 }) : this.m.cream;
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
    const len = M.tableFrontZ - 0.12 - back;   // 前沿 0.12 交给台阶的圆角（machine_d1：台阶整个收在悬崖线以内，顶面藏在这张贴图下）
    const top = new THREE.Mesh(boxUV(new THREE.PlaneGeometry(M.width, len), TILE), this.m.tiles);
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
      g.position.set(s * (M.width / 2 + 0.12), 0, so + gLen / 2);
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
    const W = 9.0, H = 4.4, back = -1.5;   // 与 Blender 罩体一致（machine_d1.py build_housing：第二轮收窄到 9）
    const tmp = new THREE.Object3D();
    const bulbGeo = new THREE.SphereGeometry(0.13, 14, 10);   // v6：小一号的暖黄灯珠
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const archN = 0;   // v6：拱顶没有灯珠（只有转轮灯框一圈）
    const am = this.archBulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, archN);
    for (let i = 0; i < archN; i++) {
      const a = Math.PI * (0.06 + 0.88 * i / (archN - 1));
      tmp.position.set(Math.cos(a) * (W / 2 - 0.05), H + Math.sin(a) * (W / 2 - 0.05) * 0.42, back + 0.48);   // 坐在紫色粗拱带正面
      tmp.updateMatrix(); am.setMatrixAt(i, tmp.matrix); am.setColorAt(i, new THREE.Color(0xffb347));
    }
    hous.add(am);

    // 斜面面板：朝镜头仰起；窗口是真开口，转轮在后面
    const face = this.face = new THREE.Group();
    face.position.set(0, 0, 0.2);
    face.rotation.x = -0.42;
    hous.add(face);
    const ft = 0.3;
    const win = { w: 6.3, h: 2.3, y: 2.2 };
    const backing = new THREE.Mesh(new THREE.PlaneGeometry(win.w + 0.4, win.h + 0.4), new THREE.MeshStandardMaterial({ color: 0x3a2f8a, roughness: 1 }));
    backing.position.set(0, win.y, -2.0);
    face.add(backing);
    this.reels = [];
    const reelTex = this.assets.reelTexture;
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.9, 48, 1, true), new THREE.MeshStandardMaterial({ map: reelTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: reelTex, emissiveIntensity: 0.06 }));
      r.rotation.z = Math.PI / 2;
      r.position.set((i - 1) * 2.06, win.y, -1.1);
      face.add(r);
      this.reels.push(r);
    }
    // 窗口内顶部的暖光条，照亮转轮
    const reelLight = new THREE.PointLight(0xffc070, 3, 4, 1.5);   // v6：转轮图案饱和清晰，补光不要冲白
    reelLight.position.set(0, win.y + 0.6, -0.1);
    face.add(reelLight);
    // 跑马灯泡：窗口一圈
    const bulbs = [];
    const bw = win.w + 1.0, bh = win.h + 0.95, per = 2 * (bw + bh), N = 30;
    for (let i = 0; i < N; i++) {
      let d = (i / N) * per, x, y;
      if (d < bw) { x = -bw / 2 + d; y = bh / 2; }
      else if ((d -= bw) < bh) { x = bw / 2; y = bh / 2 - d; }
      else if ((d -= bh) < bw) { x = bw / 2 - d; y = -bh / 2; }
      else { d -= bw; x = -bw / 2; y = -bh / 2 + d; }
      bulbs.push([x, y + win.y, 0.5]);   // 坐在 Blender 紫色灯框的奶油灯座上
    }
    const bm = this.bulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, bulbs.length);
    bulbs.forEach(([x, y, zz], i) => { tmp.position.set(x, y, zz); tmp.updateMatrix(); bm.setMatrixAt(i, tmp.matrix); bm.setColorAt(i, new THREE.Color(0xffe39a)); });
    face.add(bm);
    // 潮汐计的位置预留在窗口下方（阶段 3 接实体仪表）
    this.tideAnchor = new THREE.Object3D(); this.tideAnchor.position.set(0, 0.5, ft / 2); face.add(this.tideAnchor);
  }

  // Blender 外壳：按分组挂到对应的代码分组下，材质按名字换成运行时材质，木头/青绒重新做世界尺度 UV
  _kit() {
    const kit = this.assets.kit;
    const targets = { cabinet: this.group, pusher: this.pusher, housing: this.housing, face: this.face, dressing: this.group, hull: this.group };
    for (const [name, target] of Object.entries(targets)) {
      const node = kit.getObjectByName(name);
      if (!node) { console.warn('machine.glb 缺少分组', name); continue; }
      for (const m of node.children.filter(c => c.isMesh)) {
        const key = m.material.name.replace(/\.\d+$/, '');
        const mat = this.groupMats[name]?.[key] ?? this.m[key];
        if (!mat) console.warn('machine.glb 未知材质', key);
        if (mat) m.material = mat;
        if (mat === this.m.tiles) boxUV(m.geometry, TILE);
        m.castShadow = key !== 'velvet'; m.receiveShadow = true;
        m.position.set(0, 0, 0); m.quaternion.identity();
        target.add(m);
      }
    }
  }

  _dropper() {
    const M = this.cfg.machine;
    // D1-54 滑轨改走骷髅头顶上方（原来横穿太阳穴）：骷髅吊在滑轨上的小滑车下面（吊杆插在头巾顶的紫色球头上）
    const railY = M.dropY + 1.6;    // 骷髅徽章颅顶 = dropY + 1.24；吊杆球头（滑轨下 0.36）正好落在颅顶
    const railZ = M.dropZ - 0.04;   // = 颅顶正上方（徽章厚 0.95、前后居中；币面在中线前 0.04）
    // D1-53/54 吊架：两根薄荷连杆通过紫色转轴挂在机罩两侧的高立柱上（立柱 x ±4.85、z = 罩子 z - 0.75，顶 y 9.1，见 machine_d1 build_housing），
    // 连杆在立柱外侧（x ±5.34：立柱以内是转轮灯框）。转轴提到 y 8.6：抬起时滑轨沿圆弧升到 y ≈ 10.5、z 仍在转轮面板（z -6.19）之前，
    // 吊着的骷髅不会撞进面板（转轴低时抬起会往后摆进面板）。开场仪式见 intro.js。
    const PIV = this.railPivot = new THREE.Vector3(0, 8.6, -6.7 - 0.75);
    const rig = this.railRig = new THREE.Group();
    rig.position.copy(PIV);
    this.group.add(rig);
    const L = (x, y, z) => [x, y - PIV.y, z - PIV.z];   // 世界 → 吊架本地
    const ax = 5.34;                                     // 连杆 / 转轴所在 x
    const rod = (a, b, r, mat, parent = rig) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, A.distanceTo(B), 4, 12), mat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      m.castShadow = m.receiveShadow = true; parent.add(m); return m;
    };
    // 转轴 / 关节用独立材质：开场「解锁」时发金光（hubGlow）
    this.hubMat = candy(C.purple, { emissive: 0xffc23a, emissiveIntensity: 0 });
    this.hubGlow = 0;
    rod(L(-ax, railY, railZ), L(ax, railY, railZ), 0.13, this.m.mint);   // 滑轨
    this.railKnobs = [];
    for (const s of [-1, 1]) {
      rod([s * ax, 0, 0], L(s * ax, railY, railZ), 0.1, this.m.mint);   // 连杆：转轴 → 滑轨端头
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), this.hubMat);   // 端头关节
      knob.position.set(...L(s * ax, railY, railZ)); knob.castShadow = true; rig.add(knob); this.railKnobs.push(knob);
      // 转轴：紫色轴套（插进立柱外侧）+ 奶油轴帽；不随吊架转（挂在 this.group 上）
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 24), this.hubMat);
      hub.rotation.z = Math.PI / 2; hub.position.set(s * (ax - 0.02), PIV.y, PIV.z); hub.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.4, 16), this.m.cream);
      cap.rotation.z = Math.PI / 2; cap.position.set(s * (ax + 0.02), PIV.y, PIV.z);
      this.group.add(hub, cap);
    }
    // 骷髅吊在滑轨上（吊点 = 滑轨轴线），像钟摆一样晃；左右移动改的是 dropperHang.position.x
    const hang = this.dropperHang = new THREE.Group();
    hang.position.set(...L(0, railY, railZ));
    rig.add(hang);
    // 滑车：套在滑轨上的紫色套筒 + 两圈奶油边 + 吊杆 + 头巾顶的紫色球头
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.6, 24), this.m.purple);
    sleeve.rotation.z = Math.PI / 2;
    hang.add(sleeve);
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 28), this.m.cream);
      rim.rotation.y = Math.PI / 2; rim.position.x = s * 0.3; hang.add(rim);
    }
    rod([0, -0.12, 0], [0, -0.3, 0], 0.075, this.m.cream, hang);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), this.m.purple);
    ball.position.y = -0.36; hang.add(ball);
    hang.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.railReady = true;
    this.boing = { v: 0, vel: 0 };   // 骷髅 Q 弹（开场落定后「醒来」：压扁 → 拉长 → 回弹）
    // D1-50 吐币骷髅：投币器正面就是一颗奶油糖果骷髅，咧开的嘴 = 出币口。币竖着（币面朝镜头）在嘴里生成，
    // 从上下两排牙之间露出来、滑出下巴落下。原点 = 币的生成点（嘴里，z = dropZ 的币面所在平面）。
    // 下颌是一圈「口」字：前面的下巴 + 后面的颌骨 + 两侧颌条，中间留 0.36 宽的缝给竖着的币（币厚 0.2、宽 1.16）。
    // 尺寸约束：下巴底 ≈ 4.2 要高过圆环上的海盗帽顶（gate.y 3.3 时约 4.03）；颅顶 ≈ 6.2 不遮转轮。
    const g = this.dropper = new THREE.Group();
    const sk = this.dropperSkull = new THREE.Group();   // 程序化骷髅（备用）：Rodin 模型加载后由 attachDropperSkull 替换
    g.add(sk);
    const cream = this.m.cream, dark = this.m.purpleDeep;
    const mk = (geo, mat, x, y, z, parent = sk) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent.add(o); return o; };
    const cranium = mk(new THREE.SphereGeometry(0.8, 40, 28), cream, 0, 0.6, -0.25);
    cranium.scale.set(1, 0.85, 0.9);
    mk(new RoundedBoxGeometry(1.56, 0.42, 1.0, 4, 0.18), cream, 0, 0.1, -0.12);           // 上颌 / 颧骨
    for (let i = 0; i < 6; i++) mk(new RoundedBoxGeometry(0.17, 0.16, 0.12, 2, 0.05), cream, -0.55 + i * 0.22, -0.16, 0.31);   // 上排牙
    mk(new RoundedBoxGeometry(1.36, 0.44, 0.04, 2, 0.02), dark, 0, -0.36, -0.15);          // 口腔（币背后的深色）
    mk(new RoundedBoxGeometry(1.5, 0.24, 0.24, 3, 0.1), cream, 0, -0.63, 0.31);            // 下巴（币前面）
    for (let i = 0; i < 5; i++) mk(new RoundedBoxGeometry(0.17, 0.13, 0.12, 2, 0.05), cream, -0.44 + i * 0.22, -0.49, 0.31);   // 下排牙
    mk(new RoundedBoxGeometry(1.5, 0.3, 0.5, 3, 0.12), cream, 0, -0.6, -0.42);             // 后颌（币后面）
    for (const s of [-1, 1]) mk(new RoundedBoxGeometry(0.12, 0.36, 0.95, 2, 0.05), cream, s * 0.73, -0.55, -0.12);   // 两侧颌条
    // 五官：大眼窝（深紫 + 高光）、倒心形鼻孔
    for (const s of [-1, 1]) {
      const eye = mk(new THREE.SphereGeometry(0.22, 24, 16), dark, s * 0.33, 0.62, 0.36);
      eye.scale.set(1, 1.12, 0.45);
      mk(new THREE.SphereGeometry(0.055, 12, 8), this.m.cream, s * 0.33 + 0.07, 0.72, 0.46);
      const nose = mk(new THREE.SphereGeometry(0.06, 12, 8), dark, s * 0.045, 0.34, 0.41);
      nose.scale.set(1, 1.25, 0.5); nose.rotation.z = s * 0.5;
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(0, M.dropY - railY, M.dropZ - railZ);   // 吊点（滑轨轴线）→ 币生成点
    hang.add(g);
    // 投币指示：落点光圈
    const mark = this.dropMark = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, M.pusherHeight + 0.02, M.dropZ);
    this.group.add(mark);
  }

  // 骷髅门：两根黄铜立柱 + 骷髅顶饰 + 两柱之间的荧光传送环（视觉，不碰撞）
  _gate() {
    // 幸运圆环（效果图 v6）：悬空、水平的薄荷糖果圆环 + 歪戴的海盗帽（帽子模型在 view 加载后 attachHat 挂上）
    const G = this.cfg.gate, M = this.cfg.machine;
    const g = this.gateGroup = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(G.ringR, G.tubeR, 20, 64), this.m.mint);
    torus.rotation.x = Math.PI / 2; torus.castShadow = true;
    // 触发光：套在环外的一圈加法混合光管 + 环心光膜，币穿过时亮起、放大
    const ring = this.gateRing = new THREE.Mesh(new THREE.TorusGeometry(G.ringR, G.tubeR * 1.35, 12, 64), new THREE.MeshBasicMaterial({ color: 0x3ff2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    const disc = this.gateDisc = new THREE.Mesh(new THREE.CircleGeometry(G.ringR - G.tubeR, 48), new THREE.MeshBasicMaterial({ color: 0x8ff8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    g.add(torus, ring, disc);
    g.position.set(0, G.y, M.dropZ);
    this.group.add(g);
    this.gateFlash = 0;
  }

  // ---------- 开场吊架（时间线在 intro.js）----------
  // setRail(a, swing)：吊架绕转轴转 a（RAIL_A0 = 抬起，0 = 工作位）；骷髅反向转回来保持竖直，再叠加钟摆 swing
  setRail(a, swing = 0) { this.railRig.rotation.x = a; this.dropperHang.rotation.x = -a + swing; }
  raiseRail() { this.railReady = false; this.setRail(RAIL_A0, 0); }
  skullBoing(k = 1) { this.boing.vel += 7 * k; }
  // Q 弹：阻尼弹簧，竖向拉伸 v、横向反向补偿（体积感）。缩放在 dropper 上 = 以嘴里的币生成点为中心
  _boingUpdate(dt) {
    const B = this.boing;
    if (Math.abs(B.v) < 1e-4 && Math.abs(B.vel) < 1e-3) { B.v = B.vel = 0; this.dropper.scale.setScalar(1); return; }
    B.vel += (-B.v * 260 - B.vel * 9) * dt; B.v += B.vel * dt;
    const v = Math.max(-0.25, Math.min(0.25, B.v));
    this.dropper.scale.set(1 - v * 0.5, 1 + v, 1 - v * 0.5);
  }

  // 吐币骷髅模型：模型里币的生成点 = (0, 0.52, 0.04)（props_rodin_d1.skull_emblem 的返回值），对到投币器原点（= 币生成点）
  attachDropperSkull(model) {
    model.position.set(0, -0.52, -0.04);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.dropper.add(model);
    this.dropperSkull.visible = false;
  }

  // 圆环的海盗帽：歪戴在环管右后方（v6 效果图），帽檐朝镜头
  attachHat(hat) {
    const G = this.cfg.gate, a = -0.38;   // 环的右侧略偏后（-z 是机台后方）
    hat.scale.setScalar(1.35);            // 宽约 1.5：v6 里帽子约为圆环外径的六成
    hat.position.set(Math.cos(a) * G.ringR, G.tubeR * 0.95, Math.sin(a) * G.ringR);   // 帽檐搭在环管顶上，不插进环管
    hat.rotation.set(0.1, -0.25, -0.3);   // 帽徽朝镜头、向外歪戴
    this.gateGroup.add(hat);
  }


  // 潮汐计：转轮窗口下方的发光玻璃管
  _tideMeter() {
    const a = this.tideAnchor, L = 5.6, r = 0.2;
    const glass = new THREE.Mesh(new THREE.CapsuleGeometry(r, L, 6, 20), new THREE.MeshPhysicalMaterial({ color: 0x9fdfff, roughness: 0.05, transmission: 0.6, thickness: 0.3, transparent: true, opacity: 0.45, envMapIntensity: 1.2 }));
    glass.rotation.z = Math.PI / 2;
    const fillGeo = new THREE.CylinderGeometry(r * 0.72, r * 0.72, 1, 16); fillGeo.translate(0, 0.5, 0);
    const fill = this.tideFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ff2ff).multiplyScalar(1.5) }));
    fill.rotation.z = -Math.PI / 2; fill.position.x = -L / 2;
    fill.scale.y = 0.001;
    a.add(glass, fill);
    for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.22, 16), this.m.brass); cap.rotation.z = Math.PI / 2; cap.position.x = s * (L / 2 + r * 0.9); a.add(cap); }
    // 刻度：5 个小铆钉
    for (let i = 1; i < 5; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.m.brassDim); t.position.set(-L / 2 + (L * i) / 5, r + 0.06, 0.05); a.add(t); }
    a.position.y += 0.05;
    this.tideLen = L;
    this.tideShown = 0;
  }

  _lanterns() {
    const M = this.cfg.machine, hw = M.width / 2;
    this.lanternGlass = [];
    const mk = (x, y, z, post) => {
      const g = new THREE.Group();
      if (post > 0) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, post, 10), this.m.woodDark);
        p.position.y = -post / 2 - 0.55; p.castShadow = true; g.add(p);
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.22, 20), this.m.purple); base.position.y = -0.52;
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.85, 16), this.m.glass.clone());
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.m.purple); cap.position.y = 0.45; cap.scale.y = 0.75;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), this.m.pink); knob.position.y = 0.88;
      for (let i = 0; i < 4; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), this.m.cream);
        const a = i * Math.PI / 2 + Math.PI / 4; bar.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36); g.add(bar);
      }
      g.add(base, glass, cap, knob);
      g.position.set(x, y, z);
      g.traverse(o => { if (o.isMesh && o !== glass) o.castShadow = true; });
      this.group.add(g);
      this.lanternGlass.push(glass);
      return g;
    };
    // D1 晴天：概念图里没有灯笼（前角是矮胖糖果柱 + 紫色圆帽，见 machine_d1.py），也省掉两盏点光
    this.lanternLights = [];
    void mk;
    const marquee = this.marqueeLight = new THREE.PointLight(0xffb24a, 12, 14, 1.8);
    marquee.position.set(0, M.pusherHeight + 5.2, M.backWallZ + 1.6);
    this.group.add(marquee);
  }

  _deck() {
    const M = this.cfg.machine;
    // 甲板外形：后段宽、船头收窄
    const s = new THREE.Shape();
    // 船头在收币宝箱后不远处收尖，画面下角露出荧光海
    const W = 8.4, zb = -22, z1 = 0.5, tip = 11.8;   // 与 machine_d1.py hull_outline 一致（第二轮加宽）
    s.moveTo(-W, zb); s.lineTo(W, zb); s.lineTo(W, z1);
    s.bezierCurveTo(W, 6.6, 5.4, 10.2, 0, tip); s.bezierCurveTo(-5.4, 10.2, -W, 6.6, -W, z1); s.closePath();
    const top = new THREE.ShapeGeometry(s, 24);
    top.rotateX(Math.PI / 2);   // shape 的 y → z
    const uv = top.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.2, uv.getY(i) / 3.2);
    const deck = new THREE.Mesh(top, this.m.deck);
    deck.material.side = THREE.DoubleSide;
    deck.position.y = DECK_Y; deck.receiveShadow = true;
    this.group.add(deck);
    // 船舷（舷墙、扶手、立柱、垂绳、骷髅旗）在 machine.glb 的 hull 分组里（art/blender/machine_d1.py build_hull）
    const pts = s.getSpacedPoints(90).map(p => new THREE.Vector3(p.x, DECK_Y, p.y));
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
    side.geometry = sideGeo; side.material = candy(C.pink, { gloss: 0.5, side: THREE.DoubleSide });
    this.group.add(side);
    this.hullRect = [W * 0.95, zb, z1, tip];   // 吃水线轮廓：半宽、船尾、收窄起点、船头尖（海面泡沫用）
  }

  // ---------- 每帧 ----------
  update(sim, alpha, t, state = {}) {
    const M = this.cfg.machine;
    const z0 = sim.pusherCenterZ(sim.prevPhase ?? sim.phase), z1 = sim.pusherCenterZ();
    this.pusher.position.z = z0 + (z1 - z0) * alpha;
    // 骷髅门
    const gx0 = sim.prevGateX ?? sim.gateX;
    this.gateGroup.position.x = gx0 + (sim.gateX - gx0) * alpha;
    this.gateFlash = Math.max(0, this.gateFlash - 0.04);
    const gf = this.gateFlash;
    this.gateRing.material.opacity = 0.9 * gf;
    this.gateDisc.material.opacity = 0.45 * gf;
    this.gateRing.scale.setScalar(1 + 0.18 * gf);
    // 潮汐计
    const tide = state.surge > 0 ? 1 : (state.tide ?? 0);
    this.tideShown += (tide - this.tideShown) * 0.08;
    this.tideFill.scale.y = Math.max(0.001, this.tideShown * this.tideLen);
    const pulse = state.surge > 0 ? 0.6 + 0.4 * Math.sin(t * 14) : this.tideShown > 0.85 ? 0.8 + 0.2 * Math.sin(t * 8) : 1;
    this.tideFill.material.color.setRGB(0.25 * pulse * 1.5, 0.95 * pulse * 1.5, 1.0 * pulse * 1.5);
    // 跑马灯：追逐 + 呼吸；中奖时整圈闪烁，Jackpot 时金色常亮
    const chase = state.chase ?? 1, flash = state.bulbFlash ?? 0, gold = state.gold ?? 0;
    const c = new THREE.Color();
    const n = this.bulbs.count;
    for (let i = 0; i < n; i++) {
      const on = 0.5 + 0.5 * Math.sin(t * 7 * chase - i * 0.9);
      let k = 0.95 + 2.1 * on * on;   // D1：暖白灯泡，亮时才进 Bloom
      if (flash > 0) k = k * (1 - flash) + flash * (Math.sin(t * 30) > 0 ? 4.0 : 0.9);
      k += gold * 2.2;
      c.setRGB(1.0 * k, (0.94 - gold * 0.15) * k, (0.8 - gold * 0.45) * k);
      this.bulbs.setColorAt(i, c);
    }
    this.marqueeLight.intensity = 4 + gold * 24 + flash * 10;
    this.bulbs.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.archBulbs.count; i++) {
      const on = 0.5 + 0.5 * Math.sin(t * 4 - i * 0.7);
      const k = 0.95 + 1.8 * on;
      c.setRGB(1.0 * k, 0.94 * k, 0.8 * k);
      this.archBulbs.setColorAt(i, c);
    }
    if (this.archBulbs.instanceColor) this.archBulbs.instanceColor.needsUpdate = true;
    // 灯笼摇曳
    this.lanternGlass.forEach((g, i) => { g.material.emissiveIntensity = 2.8 + 0.5 * Math.sin(t * 9.1 + i * 2) * Math.sin(t * 3.7 + i); });
    this.lanternLights.forEach((l, i) => { l.intensity = 2.5 + 0.5 * Math.sin(t * 8.3 + i * 1.7); });
    // 投币口跟随
    const dx = state.dropX ?? 0;
    this.dropperHang.position.x += (dx - this.dropperHang.position.x) * 0.35;
    this.dropMark.position.x = this.dropperHang.position.x;
    const dt = state.dt ?? 1 / 60;
    this._boingUpdate(Math.min(dt, 0.05));
    this.hubMat.emissiveIntensity = this.hubGlow * 1.8;
    this.dropMark.material.opacity = 0.35 + 0.2 * Math.sin(t * 5);
    // 护栏升降
    for (const g of this.guards) {
      const target = state.guards ? 1 : 0;
      g.userData.raise += (target - g.userData.raise) * 0.12;
      g.position.y = -M.guardWallHeight - 0.4 + g.userData.raise * (M.guardWallHeight + 0.4);
      g.visible = g.userData.raise > 0.01;
    }
    // 转轮待机缓转
    this.reels.forEach((r, i) => { r.rotation.x = (state.reelAngles?.[i]) ?? (t * 0.15 + i * 2.1); });
  }
}
