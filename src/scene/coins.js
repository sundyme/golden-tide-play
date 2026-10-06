// 金币：车削轮廓（厚边 + 倒角）+ 币面浮雕（骷髅 / 锚，法线贴图）+ 程序化边齿。
// 一个 InstancedMesh 承载所有物理金币；同一几何体与材质也给 VFX（被吸进宝箱的币）复用。
import * as THREE from 'three';

export function coinGeometry(R, halfH) {
  const b = Math.min(0.045, halfH * 0.45);      // 倒角半径
  const pts = [new THREE.Vector2(0, halfH)];
  pts.push(new THREE.Vector2(R * 0.5, halfH));
  pts.push(new THREE.Vector2(R - b, halfH));
  for (let i = 1; i <= 3; i++) { const a = (i / 3) * Math.PI / 2; pts.push(new THREE.Vector2(R - b + Math.sin(a) * b, halfH - b + Math.cos(a) * b)); }
  for (let i = 0; i <= 3; i++) { const a = (i / 3) * Math.PI / 2; pts.push(new THREE.Vector2(R - b + Math.cos(a) * b, -halfH + b - Math.sin(a) * b)); }
  pts.push(new THREE.Vector2(R * 0.5, -halfH));
  pts.push(new THREE.Vector2(0, -halfH));
  // 车削轮廓需从下到上排列，法线才朝外
  // 36 段：币在屏幕上只有 20–30 像素宽，56 段看不出区别；每枚 1456 → 792 个三角形（200 多枚币，还要画一遍阴影）
  const g = new THREE.LatheGeometry(pts.reverse(), 36);
  g.computeVertexNormals();
  return g;
}

export function coinMaterial(faceTex, { color = 0xffc23a } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.25, emissive: 0xff9a1a, emissiveIntensity: 0.05, envMapIntensity: 0.7 });
  faceTex.colorSpace = THREE.NoColorSpace;
  faceTex.anisotropy = 8;
  mat.onBeforeCompile = sh => {
    sh.uniforms.coinFaces = { value: faceTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOPos; varying vec3 vONrm; varying mat3 vNM;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vOPos = position; vONrm = normal;
        mat3 coinIM = mat3(1.0);
        #ifdef USE_INSTANCING
          coinIM = mat3(instanceMatrix);
        #endif
        vNM = normalMatrix * coinIM;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D coinFaces; varying vec3 vOPos; varying vec3 vONrm; varying mat3 vNM;
        const float COIN_R = ${(0.5).toFixed(3)};`)
      // 采样币面：算出局部法线扰动与高度（凹处压暗、凸处更亮更光滑）
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 on = normalize(vONrm);
        float faceK = smoothstep(0.75, 0.95, abs(on.y));
        vec2 fuv = vOPos.xz / (2.0 * COIN_R);
        float top = step(0.0, vOPos.y);
        vec2 uvF = top > 0.5 ? vec2(0.25 + fuv.x * 0.5, 0.5 - fuv.y) : vec2(0.75 - fuv.x * 0.5, 0.5 - fuv.y);
        vec4 fs = texture2D(coinFaces, uvF);
        float coinH = mix(1.0, fs.a, faceK);
        diffuseColor.rgb *= mix(0.62, 1.04, coinH);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.42, 0.16, coinH), faceK);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec3 objN = on;
          if (faceK > 0.0) {
            vec3 tn = fs.xyz * 2.0 - 1.0;
            vec3 T = top > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(-1.0, 0.0, 0.0);
            vec3 B = vec3(0.0, 0.0, -1.0);
            vec3 N = vec3(0.0, top > 0.5 ? 1.0 : -1.0, 0.0);
            objN = normalize(mix(on, normalize(T * tn.x + B * tn.y + N * tn.z), faceK));
          }
          // 边齿：只作用于侧面竖带
          float sideK = 1.0 - smoothstep(0.15, 0.45, abs(on.y));
          if (sideK > 0.0) {
            float th = atan(vOPos.z, vOPos.x);
            vec3 tang = vec3(-sin(th), 0.0, cos(th));
            objN = normalize(objN + tang * sin(th * 110.0) * 0.45 * sideK);
          }
          normal = normalize(vNM * objN);
          ${'#'}ifdef DOUBLE_SIDED
            normal *= faceDirection;
          ${'#'}endif
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= mix(0.4, 1.0, coinH);`);
  };
  mat.customProgramCacheKey = () => 'coin-v1';
  return mat;
}

export class CoinField {
  constructor(scene, config, faceTex, max = 420) {
    const C = config.coin;
    this.geo = coinGeometry(C.radius, C.halfHeight);
    this.mat = coinMaterial(faceTex);
    const mesh = this.mesh = new THREE.InstancedMesh(this.geo, this.mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    // 每枚币一点点色差（偏红金 / 偏淡金），按币 id 固定，避免"复制粘贴"感。材质色为白，颜色全在实例上
    this.mat.color.set(0xffffff);
    this.palette = Array.from({ length: 16 }, (_, k) => new THREE.Color().setHSL(0.102 + (k / 15) * 0.022, 0.92, 0.5 + ((k * 7) % 16) / 15 * 0.07));
    mesh.setColorAt(0, this.palette[0]);
    scene.add(mesh);
    this.max = max;
    this.frontZ = config.machine.tableFrontZ; this._c = new THREE.Color();
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._s = new THREE.Vector3();
  }

  // 用物理状态（含上一步位姿）插值写入实例矩阵；skip(coin) 返回 true 的不画（已交给 VFX）
  update(coins, alpha, skip) {
    const { _m: m, _p: p, _q: q, _q2: q2, _s: s } = this;
    let n = 0;
    for (let i = 0; i < coins.length && n < this.max; i++) {
      const c = coins[i];
      if (c.kind !== 'coin' && c.kind !== 'giant') continue;
      if (skip && skip(c)) continue;
      const tr = c.body.translation(), ro = c.body.rotation();
      if (c.prevP) {
        p.set(c.prevP.x + (tr.x - c.prevP.x) * alpha, c.prevP.y + (tr.y - c.prevP.y) * alpha, c.prevP.z + (tr.z - c.prevP.z) * alpha);
        q.set(c.prevQ.x, c.prevQ.y, c.prevQ.z, c.prevQ.w).slerp(q2.set(ro.x, ro.y, ro.z, ro.w), alpha);
      } else { p.set(tr.x, tr.y, tr.z); q.set(ro.x, ro.y, ro.z, ro.w); }
      s.setScalar(c.scale);
      m.compose(p, q, s);
      // 前沿悬着、快掉下去的币更亮（画面上最亮的金 = 下一秒的收获）
      const edge = (p.z - this.frontZ + 0.7) / 0.7;
      if (edge > 0) this.mesh.setColorAt(n, this._c.copy(this.palette[c.id & 15]).multiplyScalar(1 + Math.min(1, edge) * 0.3));
      else this.mesh.setColorAt(n, this.palette[c.id & 15]);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
