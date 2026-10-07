// 鹦鹉「铜板」：拆件程序化动画（头 / 双翼 / 尾 + 整体），按情绪状态切换。
// 情绪：idle 待机 · worry 探头紧张 · cheer 扑翅欢呼 · sigh 叹气 · dance 跳舞（Jackpot）· hint 引导（看投币口）
// 玩家互动：poke 被戳（缩一下弹起、甩头）· ruffle 炸毛抖羽 · spin 原地转圈 · gift 低头吐币 · talk 说话点头
// 叠加层（不占情绪）：hover 悬停时转头看镜头、歪头好奇；gaze 平时转头盯着投币位置
import * as THREE from 'three';

const _v = new THREE.Vector3();
const ease = k => k * k * (3 - 2 * k);

export class Parrot {
  constructor(root) {
    this.root = root;
    this.head = root.getObjectByName('head');
    this.wl = root.getObjectByName('wing_l');
    this.wr = root.getObjectByName('wing_r');
    this.tail = root.getObjectByName('tail');
    this.base = { pos: root.position.clone(), rotY: root.rotation.y, scale: root.scale.x };
    this.mood = 'idle'; this.moodT = 0; this.moodDur = 0;
    this.blend = 0;     // 当前情绪的权重（进出缓动）
    this.lookAt = null; // 世界坐标：头转向这里（悬停时 = 镜头，平时 = 投币点）
    this.hover = 0; this.hoverOn = false;
    this.gazeYaw = 0; this.gazePitch = 0;
  }

  // 触发一个情绪；duration 秒后回到 idle（dance/hint 由外部结束）
  set(mood, duration = 1.6, priority = 1) {
    if (this.mood !== 'idle' && this.priority > priority && this.moodT < this.moodDur) return;
    this.mood = mood; this.moodT = 0; this.moodDur = duration; this.priority = priority;
  }

  // 头部朝向 lookAt 的偏航 / 俯仰（相对身体），平滑追随
  _gaze(dt) {
    let yaw = 0, pitch = 0;
    if (this.lookAt) {
      const R = this.root, h = this.headWorld(_v);
      const dx = this.lookAt.x - h.x, dy = this.lookAt.y - h.y, dz = this.lookAt.z - h.z;
      yaw = Math.atan2(dx, dz) - R.rotation.y;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      yaw = Math.max(-1.0, Math.min(1.0, yaw));
      pitch = Math.max(-0.5, Math.min(0.6, -Math.atan2(dy, Math.hypot(dx, dz))));
    }
    const a = 1 - Math.exp(-dt * 6);
    this.gazeYaw += (yaw - this.gazeYaw) * a; this.gazePitch += (pitch - this.gazePitch) * a;
  }

  update(dt, t) {
    this.moodT += dt;
    this.hover += ((this.hoverOn ? 1 : 0) - this.hover) * (1 - Math.exp(-dt * 8));
    this._gaze(dt);
    if (this.mood !== 'idle' && this.moodT >= this.moodDur) { this.mood = 'idle'; this.priority = 0; }
    const R = this.root, b = this.base;
    // 默认待机
    let y = Math.abs(Math.sin(t * 2.2)) * 0.04, lean = 0, yaw = b.rotY;
    let hx = 0.18 + Math.sin(t * 0.9) * 0.06, hy = Math.sin(t * 0.6) * 0.3, hz = Math.sin(t * 0.45) * 0.08;
    let wing = 0.04 + 0.04 * Math.sin(t * 3.1), tail = -0.1 + Math.sin(t * 1.7) * 0.06;
    let sq = 0, puff = 0;   // 压扁 / 炸毛（缩放）
    // 跟随视线：idle 时一半是自己晃、一半盯着目标；悬停时完全转向镜头并歪头
    const g = 0.6 + 0.4 * this.hover;
    hy = hy * (1 - g) + this.gazeYaw * g; hx = hx * (1 - g * 0.6) + (this.gazePitch + 0.1) * g * 0.6;
    hz += this.hover * 0.32 * Math.sin(t * 1.3 + 0.6);
    lean += this.hover * 0.12; y += this.hover * 0.06 * Math.abs(Math.sin(t * 5));
    const att = this.mood === 'poke' || this.mood === 'spin' || this.mood === 'ruffle' ? 0.05 : 0.25;
    const k = this.mood === 'idle' ? 0 : ease(Math.min(1, this.moodT / att)) * ease(Math.min(1, (this.moodDur - this.moodT) / 0.3 + (this.mood === 'dance' || this.mood === 'hint' ? 1 : 0)));
    switch (this.mood) {
      case 'worry': {   // 探头：身体前倾、脖子伸、翅膀微张发抖
        lean = 0.35 * k; hx = hx * (1 - k) + 0.55 * k; hy *= 1 - k;
        wing = wing * (1 - k) + k * (0.25 + 0.06 * Math.sin(t * 40));
        y += k * 0.05 * Math.sin(t * 25);
        break;
      }
      case 'cheer': {   // 跳起 + 大幅扑翅 + 抬头
        const hop = Math.abs(Math.sin(this.moodT * 9));
        y += k * hop * 0.45; hx = hx * (1 - k) - 0.25 * k;
        wing = wing * (1 - k) + k * (0.6 + 0.6 * Math.sin(t * 28));
        tail = tail * (1 - k) + k * (0.3 * Math.sin(t * 20));
        break;
      }
      case 'sigh': {    // 低头、翅膀耷拉、身体一沉
        y -= k * 0.08; hx = hx * (1 - k) + 0.75 * k; hy = hy * (1 - k) + k * 0.25 * Math.sin(this.moodT * 2.5);
        wing = wing * (1 - k) - k * 0.1; tail = tail * (1 - k) - k * 0.25;
        break;
      }
      case 'dance': {   // 节奏跳 + 左右扭 + 扑翅 + 点头
        const beat = t * 2 * Math.PI * 2.1;
        y += k * Math.abs(Math.sin(beat)) * 0.3; yaw = b.rotY + k * 0.45 * Math.sin(beat * 0.5);
        hx = hx * (1 - k) + k * (0.1 + 0.25 * Math.sin(beat)); hz = k * 0.25 * Math.sin(beat * 0.5);
        wing = wing * (1 - k) + k * (0.4 + 0.45 * Math.sin(beat * 2));
        tail = k * 0.35 * Math.sin(beat);
        break;
      }
      case 'poke': {    // 被戳：先缩成一团，再弹起 + 甩头 + 翅膀一炸
        const m = this.moodT;
        sq = k * (m < 0.12 ? m / 0.12 : Math.max(-0.6, -Math.sin((m - 0.12) * 14) * Math.exp(-(m - 0.12) * 5)));
        y += k * Math.max(0, Math.sin((m - 0.1) * 9)) * 0.55 * Math.exp(-m * 2);
        hz = hz * (1 - k) + k * 0.5 * Math.sin(m * 30) * Math.exp(-m * 4);
        wing = wing * (1 - k) + k * (0.9 * Math.exp(-m * 3) + 0.1);
        tail = tail * (1 - k) + k * 0.4 * Math.sin(m * 24) * Math.exp(-m * 3);
        break;
      }
      case 'ruffle': {  // 炸毛：身体鼓起、全身抖、翅膀半张
        puff = k * (0.14 + 0.03 * Math.sin(t * 50));
        yaw = b.rotY + k * 0.08 * Math.sin(t * 46);
        hz = hz * (1 - k) + k * 0.22 * Math.sin(t * 38);
        wing = wing * (1 - k) + k * (0.35 + 0.15 * Math.sin(t * 44));
        tail = tail * (1 - k) + k * 0.3 * Math.sin(t * 36);
        break;
      }
      case 'spin': {    // 原地起跳转一圈，落地压扁一下
        const p = Math.min(1, this.moodT / 0.9), e = p * p * (3 - 2 * p);
        yaw = b.rotY + e * Math.PI * 2;
        y += Math.sin(p * Math.PI) * 0.9;
        wing = wing * (1 - k) + k * (0.5 + 0.5 * Math.sin(t * 30) * (1 - p));
        sq = this.moodT > 0.9 ? 0.35 * Math.sin((this.moodT - 0.9) * 12) * Math.exp(-(this.moodT - 0.9) * 6) : 0;
        hy *= 1 - k; hx = hx * (1 - k) - 0.2 * k * Math.sin(p * Math.PI);
        break;
      }
      case 'gift': {    // 低头「吐」出金币，再得意地挺胸
        const m = this.moodT;
        const down = m < 0.45 ? ease(m / 0.45) : Math.max(0, 1 - (m - 0.45) * 3);
        lean = k * (0.5 * down - 0.15 * (1 - down)); hx = hx * (1 - k) + k * (0.9 * down - 0.2);
        hy *= 1 - k; sq = k * 0.15 * Math.sin(m * 16) * Math.exp(-m * 3);
        wing = wing * (1 - k) + k * (m > 0.45 ? 0.5 + 0.4 * Math.sin(t * 22) : 0.1);
        break;
      }
      case 'talk': {    // 说话：点头 + 嘴（头）一张一合
        hx += k * 0.12 * Math.max(0, Math.sin(t * 17)); y += k * 0.03 * Math.abs(Math.sin(t * 8.5));
        wing = wing * (1 - k) + k * (0.12 + 0.08 * Math.sin(t * 9));
        break;
      }
      case 'hint': {    // 转头看投币口，翅膀指一指
        yaw = b.rotY + k * 0.35; hx = hx * (1 - k) + 0.3 * k;
        wing = wing * (1 - k) + k * 0.15;
        break;
      }
    }
    R.position.set(b.pos.x, b.pos.y + y, b.pos.z);
    R.rotation.set(lean - 0.26, yaw, 0);   // D1 机位更高：整只微微后仰，脸朝镜头而不是只露帽顶
    const sc = b.scale * (1 + this.hover * 0.04);
    R.scale.set(sc * (1 + sq * 0.35 + puff), sc * (1 - sq * 0.4 + puff * 0.6), sc * (1 + sq * 0.35 + puff));
    if (this.head) this.head.rotation.set(hx, hy, hz);
    // 引导时用靠台面那一侧（左翼，鹦鹉在台面左边）指向投币口
    if (this.wl) this.wl.rotation.z = this.mood === 'hint' ? wing + k * 0.9 + 0.15 * Math.sin(t * 6) * k : wing;
    if (this.wr) this.wr.rotation.z = -wing;
    if (this.tail) this.tail.rotation.x = tail;
  }

  headWorld(v = new THREE.Vector3()) { return (this.head ?? this.root).getWorldPosition(v).add(new THREE.Vector3(0, 0.9, 0)); }
  // 帽顶（气泡锚点）：D1 Rodin 鹦鹉的头枢轴在脖子，帽顶比眼睛再高约 1.4
  topWorld(v = new THREE.Vector3()) { return this.headWorld(v).add(new THREE.Vector3(0, 1.2, 0)); }
}
