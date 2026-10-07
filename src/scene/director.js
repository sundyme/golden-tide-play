// 镜头导演：平时（34° 长焦俯视 + 呼吸漂移）、宝石特写、Jackpot 拉远看整艘船、终局转到船尾看金币岛。
// 每个模式给出期望的机位 / 注视点，当前镜头以阻尼平滑追过去；震屏叠加在最后。
import * as THREE from 'three';

export class Director {
  constructor(camera, config) {
    this.cam = camera; this.cfg = config;
    this.mode = 'play'; this.focus = new THREE.Vector3();
    this.pos = new THREE.Vector3(); this.tgt = new THREE.Vector3();
    this.shake = 0; this.roll = 0;
    this.k = 3.2;
    this.fov = config.camera.fov; this.aspect = 9 / 16;
    const p = this._play(0, 0);
    this.pos.copy(p.pos); this.tgt.copy(p.tgt);
  }
  set(mode, focus, k = 3.2) { this.mode = mode; if (focus) this.focus.copy(focus); this.k = k; }
  bump(v) { this.shake = Math.max(this.shake, v); }

  _orbit(tgt, dist, pitchDeg, yawDeg = 0) {
    const p = pitchDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
    return { pos: new THREE.Vector3(Math.sin(y) * Math.cos(p) * dist, Math.sin(p) * dist, Math.cos(y) * Math.cos(p) * dist).add(tgt), tgt: tgt.clone() };
  }
  _play(t, surge) {
    const C = this.cfg.camera;
    const tgt = new THREE.Vector3(...C.target);
    const o = this._orbit(tgt, C.distance - surge * 2.5, C.pitchDeg + surge * 4);
    o.pos.x += Math.sin(t * 0.31) * 0.12; o.pos.y += Math.sin(t * 0.23) * 0.08;
    return o;
  }
  // 竖屏比 9:16 更窄时放大纵向 fov，保证横向覆盖不变
  _fit(fov) {
    const base = 9 / 16;
    return this.aspect < base ? 2 * Math.atan(Math.tan(fov * Math.PI / 360) * base / this.aspect) * 180 / Math.PI : fov;
  }

  update(dt, t, { surge = 0, sway = 0 } = {}) {
    let d;
    switch (this.mode) {
      case 'closeup': d = this._orbit(this.focus, 13, 46); break;
      case 'jackpot': d = this._orbit(new THREE.Vector3(0, 0, -3), 58, 46, Math.sin(t * 0.4) * 6); break;
      // 机位偏到右侧：桅杆顶落在画面左三分之一，不再挡在正中（以前 x 在 ±4 间摆，桅杆常在画面中央）
      case 'stern': d = { pos: new THREE.Vector3(7 + Math.sin(t * 0.15) * 2, 31, -40), tgt: new THREE.Vector3(-1.5, -4, 120) }; break;   // 从船尾上方越过机台看船头与金币岛
      default: d = this._play(t, surge);
    }
    const a = 1 - Math.exp(-dt * this.k);
    // 大跨度转场（终局船尾 → 回到机台）：注视点先转回来、机位再慢慢飞过去。
    // 两者同速插值时注视点要从船头前方远处一路扫回，中间约 1 秒画面里只有一片海（空镜）。
    const far = this.tgt.distanceTo(d.tgt) > 30;
    this.pos.lerp(d.pos, a); this.tgt.lerp(d.tgt, far ? 1 - Math.exp(-dt * this.k * 3.5) : a);
    this.settled = this.mode === 'play' && this.pos.distanceTo(d.pos) < 2;   // 镜头到位：HUD 才回来
    const C = this.cfg.camera;
    this.fov += ((this.mode === 'play' ? C.fov : C.wideFov) - this.fov) * a;
    const fov = this._fit(this.fov);
    if (Math.abs(fov - this.cam.fov) > 1e-3) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.shake *= Math.pow(0.015, dt);
    const s = this.shake;
    this.cam.position.set(this.pos.x + (Math.random() - 0.5) * s, this.pos.y + (Math.random() - 0.5) * s, this.pos.z + (Math.random() - 0.5) * s * 0.5);
    this.cam.lookAt(this.tgt);
    this.cam.rotateZ(-sway * 0.6 + surge * 0.03 * Math.sin(t * 1.3));
  }
}
