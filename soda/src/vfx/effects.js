// 通用粒子演出（精灵池）：火花迸发、火药桶爆炸（闪光 + 火球 + 烟 + 冲击环）、炮口焰、宝箱倾倒的金光拖尾、鹦鹉羽毛。
import * as THREE from 'three';

function tex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'smoke') {
    grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  }
  if (kind === 'star') {   // 四角星闪光（开场仪式 / 骷髅睁眼）
    g.translate(32, 32); g.fillStyle = grd; g.fillRect(-32, -32, 64, 64);
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? 5 : 31, a = i * Math.PI / 4 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.fill();
  } else if (kind === 'feather') {   // 一片羽毛：羽轴 + 两侧羽片，末端分叉
    g.translate(32, 32); g.rotate(-0.5);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -28); g.quadraticCurveTo(13, -6, 6, 22); g.lineTo(0, 18); g.lineTo(-6, 22); g.quadraticCurveTo(-13, -6, 0, -28); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 28); g.stroke();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i % 2 ? 9 : -9, -10 + i * 7); g.lineTo(i % 2 ? 3 : -3, -6 + i * 7); g.lineWidth = 1.4; g.stroke(); }
  } else { g.fillStyle = grd; g.fillRect(0, 0, 64, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = tex('glow'); this.smoke = tex('smoke'); this.feather = tex('feather'); this.star = tex('star');
    this.items = [];
    this.flashLight = new THREE.PointLight(0xff9a3a, 0, 22, 1.6);
    scene.add(this.flashLight);
    const rg = new THREE.RingGeometry(0.8, 1, 48); rg.rotateX(-Math.PI / 2);
    this.ringGeo = rg;
    this.trickleT = 0;
  }

  // p: 位置；o: {color, size, vel, life, grow, drag, gravity, smoke, opacity}
  _sprite(p, o) {
    if (this.items.length > 400) return;
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: o.smoke ? this.smoke : this.glow, color: new THREE.Color(o.color).multiplyScalar(o.smoke ? 1 : (o.hdr ?? 3)),
      blending: o.smoke ? THREE.NormalBlending : THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: o.opacity ?? 1,
    }));
    m.position.copy(p);
    m.userData = { t: 0, life: o.life, v: o.vel.clone(), size: o.size, grow: o.grow ?? 0, drag: o.drag ?? 0, g: o.gravity ?? 6, op: o.opacity ?? 1, smoke: !!o.smoke };
    m.scale.setScalar(o.size);
    m.renderOrder = o.smoke ? 2 : 3;
    this.scene.add(m); this.items.push(m);
  }

  burst(p, color, n = 10, size = 0.5, speed = 4) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this._sprite(p, { color, size: size * (0.6 + Math.random() * 0.8), vel: v, life: 0.35 + Math.random() * 0.3, drag: 2 });
    }
  }

  // 鹦鹉羽毛：红 / 蓝 / 黄小羽毛弹出后左右飘着落下
  feathers(p, n = 8) {
    const cols = [0xd8262a, 0xe8352c, 0x2a6fd8, 0xf2c230, 0x2fa86a];
    for (let i = 0; i < n; i++) {
      if (this.items.length > 400) return;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.feather, color: cols[i % cols.length], transparent: true, depthWrite: false, rotation: Math.random() * 6.28 }));
      m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.6));
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7 + 0.5, Math.random() - 0.3).normalize().multiplyScalar(3 + Math.random() * 3);
      const size = 0.85 + Math.random() * 0.45;
      m.userData = { t: 0, life: 1.6 + Math.random() * 0.8, v, size, grow: 0, drag: 3.2, g: 2.2, op: 1, feather: true, ph: Math.random() * 6.28, spin: (Math.random() - 0.5) * 6 };
      m.scale.setScalar(size); m.renderOrder = 3;
      this.scene.add(m); this.items.push(m);
    }
  }

  explosion(p) {
    this.flashLight.color.set(0xff9a3a);
    this.flashLight.position.copy(p).add(new THREE.Vector3(0, 1.5, 0));
    this.flashLight.intensity = 260;
    this._sprite(p, { color: 0xfff0c0, size: 5, vel: new THREE.Vector3(), life: 0.18, grow: 6, hdr: 5 });            // 白闪
    for (let i = 0; i < 16; i++) {                                                                                 // 火球
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 5);
      this._sprite(p, { color: i % 3 ? 0xff7a1a : 0xffc040, size: 1.2 + Math.random() * 1.2, vel: v, life: 0.45 + Math.random() * 0.25, grow: 2.5, drag: 4, gravity: -2 });
    }
    for (let i = 0; i < 14; i++) {                                                                                 // 烟
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.6, Math.random() - 0.5).multiplyScalar(3 + Math.random() * 2);
      this._sprite(p.clone().add(new THREE.Vector3(0, 0.5, 0)), { color: 0x3a3440, size: 1.6 + Math.random(), vel: v, life: 1.6 + Math.random() * 0.8, grow: 2.2, drag: 1.8, gravity: -1.2, smoke: true, opacity: 0.75 });
    }
    for (let i = 0; i < 22; i++) {                                                                                 // 火星
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.2 + 0.4, Math.random() - 0.5).normalize().multiplyScalar(9 + Math.random() * 8);
      this._sprite(p, { color: 0xffb040, size: 0.22 + Math.random() * 0.2, vel: v, life: 0.6 + Math.random() * 0.5, gravity: 22, drag: 0.6 });
    }
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(p).setY(p.y + 0.05); ring.userData = { t: 0, life: 0.5, ring: true, size: 6 };
    this.scene.add(ring); this.items.push(ring);
  }

  muzzle(p) {
    this.flashLight.color.set(0xff9a3a); this.flashLight.position.copy(p); this.flashLight.intensity = Math.max(this.flashLight.intensity, 140);
    this._sprite(p, { color: 0xffd080, size: 3, vel: new THREE.Vector3(), life: 0.14, grow: 5, hdr: 5 });
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).multiplyScalar(2.5);
      this._sprite(p, { color: 0x6a6070, size: 1.3, vel: v, life: 1.2 + Math.random() * 0.5, grow: 2, drag: 1.5, gravity: -1, smoke: true, opacity: 0.6 });
    }
  }

  // ---------- D1-54 开场仪式 ----------
  // 星光：四角星弹出放大再缩没，边转边飘
  twinkle(p, n = 6, spread = 0.6, color = 0xfff4c0, size = 0.7) {
    for (let i = 0; i < n; i++) {
      if (this.items.length > 400) return;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.star, color: new THREE.Color(color).multiplyScalar(2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, rotation: Math.random() * 6.28 }));
      m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.2) * spread));
      const sz = size * (0.6 + Math.random() * 0.7);
      m.userData = { t: -i * 0.05, life: 0.55 + Math.random() * 0.35, v: new THREE.Vector3(0, 0.6, 0), size: sz, twinkle: true, spin: (Math.random() - 0.5) * 4 };
      m.scale.setScalar(0.001); m.renderOrder = 4;
      this.scene.add(m); this.items.push(m);
    }
  }
  // 糖果彩纸：粉 / 薄荷 / 紫 / 金 / 天蓝的小光点，向上炸开后带重力落下
  confetti(p, n = 30, speed = 7, up = 0.9) {
    const cols = [0xff8ab0, 0x8ef0b8, 0xa99bff, 0xffd23c, 0x7fd0ff, 0xffffff];
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * up + 0.35, (Math.random() - 0.3) * 0.8).normalize().multiplyScalar(speed * (0.45 + Math.random() * 0.75));
      this._sprite(p, { color: cols[i % cols.length], size: 0.2 + Math.random() * 0.22, vel: v, life: 0.9 + Math.random() * 0.7, gravity: 13, drag: 1.4, hdr: 1.7 });
    }
  }
  // 冲击环：竖直、正对镜头的发光圆环（看得见的「咚」）
  shock(p, camPos, color = 0xfff0b0, size = 4, life = 0.55) {
    this.vRingGeo ??= new THREE.RingGeometry(0.86, 1, 64);
    const ring = new THREE.Mesh(this.vRingGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.copy(p); ring.lookAt(camPos);
    ring.userData = { t: 0, life, ring: true, size };
    ring.renderOrder = 4;
    this.scene.add(ring); this.items.push(ring);
  }
  // 闪光灯：任意颜色（爆炸用默认的橙色）
  flash(p, color = 0xffe0a0, k = 120) {
    this.flashLight.color.set(color); this.flashLight.position.copy(p);
    this.flashLight.intensity = Math.max(this.flashLight.intensity, k);
  }

  trickle(p) {
    this.trickleT -= 1;
    if (this.trickleT > 0) return;
    this.trickleT = 2;
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, -2 - Math.random() * 2, 2 + Math.random() * 2);
    this._sprite(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, 0)), { color: 0xffd76a, size: 0.6 + Math.random() * 0.5, vel: v, life: 0.7, gravity: 10 });
  }

  update(dt) {
    this.flashLight.intensity *= Math.pow(0.0005, dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const s = this.items[i], u = s.userData;
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { this.scene.remove(s); s.material.dispose(); this.items.splice(i, 1); continue; }
      if (u.twinkle) {
        if (u.t < 0) continue;
        s.scale.setScalar(u.size * Math.sin(Math.PI * Math.max(0, k)) ** 0.6);
        s.material.rotation += u.spin * dt; s.position.addScaledVector(u.v, dt);
        continue;
      }
      if (u.ring) { s.scale.setScalar(0.5 + u.size * (1 - (1 - k) ** 3)); s.material.opacity = 1 - k; continue; }
      u.v.multiplyScalar(Math.exp(-u.drag * dt)); u.v.y -= u.g * dt;
      if (u.feather) {   // 飘落：限速下落 + 左右摆 + 转动，最后淡出
        u.v.y = Math.max(u.v.y, -1.1);
        s.position.x += Math.sin(u.t * 4 + u.ph) * 1.2 * dt;
        s.material.rotation += (u.spin + Math.sin(u.t * 4 + u.ph) * 2) * dt;
        s.position.addScaledVector(u.v, dt);
        s.material.opacity = Math.min(1, (1 - k) * 3);
        continue;
      }
      s.position.addScaledVector(u.v, dt);
      s.scale.setScalar(u.size * (1 + u.grow * k));
      s.material.opacity = u.op * (u.smoke ? (1 - k) * Math.min(1, k * 6) : (1 - k) * (1 - k));
    }
  }
}
