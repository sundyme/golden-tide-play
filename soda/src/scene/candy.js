// D1「汽水海」材质：光滑糖果塑料（柔和高光 + 白色菲涅尔轮廓光），没有贴图、没有清漆层，比 v1 的 Physical 便宜。
// 阴影偏紫来自天光（HemisphereLight 地面色 = 淡紫），不需要改着色模型。
import * as THREE from 'three';

export const C = {
  pink: 0xff8a98, pinkLight: 0xffb8c2, cream: 0xfff3e2, mint: 0x8ef0b8, mintDeep: 0x4fcf9a,
  purple: 0x8b7cff, purpleDeep: 0x6b5fd6, lilac: 0x9585f2, gold: 0xffc93c, white: 0xffffff,
  rope: 0xf3dcb8, pit: 0x5a4cc0, sky: 0x7fd0ff, red: 0xff5a6a,
};

// rim：轮廓光强度；gloss：0 哑光 … 1 很亮
export function candy(color, { rim = 0.35, gloss = 0.6, emissive = 0x000000, emissiveIntensity = 0, transparent = false, opacity = 1, side } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.62 - gloss * 0.4, metalness: 0, envMapIntensity: 0.3 + gloss * 0.35,
    emissive, emissiveIntensity, transparent, opacity, side: side ?? THREE.FrontSide,
  });
  return rimify(m, rim);
}

// 给任意 MeshStandardMaterial 加白色菲涅尔轮廓光（Rodin 生成道具的贴图材质也用它）
export function rimify(m, rim = 0.35) {
  m.userData.rim = rim;
  if (rim > 0) {
    m.onBeforeCompile = sh => {
      sh.uniforms.rimK = { value: rim };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float rimK;')
        .replace('#include <opaque_fragment>', `
          float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
          outgoingLight += vec3(1.0, 0.98, 1.0) * rimF * rimK;
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'candyRim';
  }
  return m;
}

// glb 道具（art/blender/props_d1.py）的材质名 d1_<色名> → 共享糖果材质
const NAMED = {
  red: [0xff4a5a, { gloss: 0.75 }], redLight: [0xff6f7c, {}], white: [0xffffff, { gloss: 0.8, rim: 0.15 }], ink: [0x2b2547, { gloss: 0.95, rim: 0.2 }],
  yellow: [0xffc93c, { gloss: 0.7 }], yellowDeep: [0xff9f1c, {}], blue: [0x3f8cff, { gloss: 0.7 }], blush: [0xff9ab0, { gloss: 0.2, rim: 0 }],
};
const cache = {};
export function candyize(root, { medal } = {}) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const name = (o.material.name || '').replace(/^d1_/, '').replace(/\.\d+$/, '');
    if (name === 'medal' && medal) { o.material = medal; }
    else if (NAMED[name] || C[name] !== undefined) {
      cache[name] ??= NAMED[name] ? candy(NAMED[name][0], NAMED[name][1]) : candy(C[name]);
      o.material = cache[name];
    } else if (o.material.map && !o.material.userData.rim) {
      // Rodin 生成道具（art/blender/props_rodin_d1.py）：保留贴图，统一成糖果塑料的光泽 + 轮廓光
      const m = o.material;
      m.metalness = 0; m.envMapIntensity = 0.55;
      if (!m.roughnessMap) m.roughness = 0.36;   // 有的拆件导出时丢了粗糙度贴图
      rimify(m, 0.32);
    }
    o.castShadow = o.receiveShadow = true;
  });
  return root;
}
