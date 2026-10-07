// 粒子合批：同一种贴图 + 混合方式的所有粒子画成一个实例化的朝向镜头的方片（一次绘制调用）。
// 以前每颗粒子是一个 THREE.Sprite + 一份新材质：Jackpot / 爆炸时一下多出上百次绘制调用，
// 第一次出现的特效还会当场编译着色器（掉帧）。现在每批一份材质，开局就随场景一起预编译。
//
// 为了少改上层代码，add() 返回一个「伪精灵」，字段和 THREE.Sprite 用到的那部分一样：
//   position / scale.setScalar / material.opacity / material.rotation / material.color / userData
import * as THREE from 'three';

const VERT = `
  attribute vec3 iPos; attribute vec4 iColor; attribute vec2 iSizeRot;
  varying vec2 vUv; varying vec4 vColor;
  void main() {
    vUv = uv; vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
    mv.xy += mat2(c, s, -s, c) * position.xy * iSizeRot.x;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.003) discard;
  }`;

export class SpriteBatch {
  constructor(scene, { map, blending = THREE.AdditiveBlending, cap = 400, renderOrder = 3 }) {
    this.cap = cap; this.items = [];
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.pos); g.setAttribute('iColor', this.col); g.setAttribute('iSizeRot', this.sr);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map } }, vertexShader: VERT, fragmentShader: FRAG, blending, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }
  get full() { return this.items.length >= this.cap; }
  // color：THREE.Color（可以超过 1，进 Bloom）
  add(color, opacity = 1, rotation = 0) {
    if (this.full) return null;
    const s = { position: new THREE.Vector3(), scale: { x: 1, setScalar(v) { this.x = v; } }, material: { color, opacity, rotation, dispose() { } }, userData: {}, _i: this.items.length, _b: this };
    this.items.push(s);
    return s;
  }
  remove(s) {
    const A = this.items, i = s._i;
    if (A[i] !== s) return;
    const last = A.pop();
    if (last !== s) { A[i] = last; last._i = i; }
  }
  // 每帧把活着的粒子写进实例属性
  flush() {
    const A = this.items, n = A.length, P = this.pos.array, C = this.col.array, S = this.sr.array;
    for (let i = 0; i < n; i++) {
      const s = A[i], m = s.material, p = s.position;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      C[i * 4] = m.color.r; C[i * 4 + 1] = m.color.g; C[i * 4 + 2] = m.color.b; C[i * 4 + 3] = m.opacity;
      S[i * 2] = s.scale.x; S[i * 2 + 1] = m.rotation;
    }
    this.mesh.geometry.instanceCount = n;
    if (n) {
      for (const a of [this.pos, this.col, this.sr]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    }
  }
}
