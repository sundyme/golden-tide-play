// 月光海面（v3）：回到第一版（v1-moonlit）的观感 —— fbm 细碎波纹法线 + 月光路上的碎银闪烁 + 荧光光点 + 船体泡沫。
// 和第一版的区别只有：放射状网格（以船为中心、近密远疏，半径 240，和第一版 420 见方的平面覆盖范围相当）；
//   短浪按离中心距离淡出；波纹和碎银按像素覆盖面积淡出（顶点里按距离和视角估算，不用 fwidth），低机位 / 远处不闪；
//   船体泡沫和尾迹只在船边算。
// 试过把海面铺到海平线（v2 的做法）：黎明时远海变成一片灰平面、海天交界出硬边，不如第一版
//   「海面在远处结束、露出天穹金色雾带」好看，所以没保留。
// 实测（864×1536 全屏一层海面，GPU 计时）：第一版 ≈0.24 ms，v1.5 ≈0.13 ms，v2 ≈1.6 ms。
import * as THREE from 'three';
import { radialGrid, SEA_QUALITY } from './sea.js';

export function buildSeaMoon(hull, PAL, quality = 'high') {
  const Q = SEA_QUALITY[quality] ?? SEA_QUALITY.high;
  const geo = radialGrid(Q.rings, Q.sectors, 240, 1.8);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, surge: { value: 0 }, gold: { value: 0 }, detail: { value: Q.detail },
      pxAngle: { value: 0.001 },                          // 一个像素对应的视角（弧度），每帧按相机 fov 和画布高度更新
      cSea: { value: PAL.sea }, cDeep: { value: PAL.seaDeep }, cSky: { value: PAL.skyHorizon },
      cGlow: { value: PAL.glow }, cGlow2: { value: PAL.glow2 }, cMoon: { value: PAL.moon },
      moonDir: { value: new THREE.Vector3(0.28, 0.5, -0.82).normalize() },
      hull: { value: new THREE.Vector4(...hull) },        // 半宽, 船尾 z, 收窄起点 z, 船头 z（船体轮廓，做环绕泡沫）
    }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float time, surge, pxAngle;
      varying vec3 vW, vN; varying float vCrest, vPx;
      vec3 wave(vec2 p, vec2 dir, float len, float amp, float spd, float r, inout vec3 n){
        amp *= 1.0 - smoothstep(len * 5.0, len * 11.0, r);   // 网格变疏的远处，短浪淡出（不出锯齿）
        float k = 6.2831 / len; float f = k * dot(dir, p) - time * spd * k;
        float s = sin(f), c = cos(f);
        n.x -= dir.x * k * amp * c; n.z -= dir.y * k * amp * c;
        return vec3(0.0, amp * s, 0.0);
      }
      void main(){
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        float r = length(position.xz);
        vec3 n = vec3(0.0, 1.0, 0.0);
        float A = 1.0 + surge * 1.4;
        vec3 d = wave(p.xz, normalize(vec2(0.3, 1.0)), 23.0, 0.42 * A, 2.2, r, n)
               + wave(p.xz, normalize(vec2(-0.7, 0.6)), 13.0, 0.22 * A, 1.8, r, n)
               + wave(p.xz, normalize(vec2(0.9, 0.2)), 7.3, 0.11 * A, 1.4, r, n)
               + wave(p.xz, normalize(vec2(-0.2, -1.0)), 4.1, 0.05, 1.1, r, n);
        p += d;
        vCrest = d.y;
        vW = p; vN = normalize(n);
        // 一个像素在海面上覆盖多少世界单位：距离 × 像素视角 ÷ 视线与海面的夹角（掠射时被拉长）
        vec3 toC = cameraPosition - p; float dist = length(toC);
        vPx = dist * pxAngle / max(abs(toC.y) / dist, 0.06);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float time, surge, gold, detail; uniform vec3 cSea, cDeep, cSky, cGlow, cGlow2, cMoon, moonDir; uniform vec4 hull;
      varying vec3 vW, vN; varying float vCrest, vPx;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = m * p + 1.7; a *= 0.5; } return s; }   // 每层旋转，消掉值噪声的方格
      void main(){
        float px = vPx;              // 一个像素覆盖多少世界单位（顶点里算好；不用 fwidth：Chrome/ANGLE→Metal 下用了屏幕导数整段着色器慢 15 倍）
        // 细碎波纹法线：解析波浪法线 + fbm 坡度，像素太大时淡出
        vec3 n = normalize(vN);
        vec2 q = vW.xz * 0.35 + vec2(time * 0.12, time * 0.05);
        float e = 0.08;
        float r0 = fbm(q), rx = fbm(q + vec2(e, 0.0)), rz = fbm(q + vec2(0.0, e));
        n = normalize(n + vec3(r0 - rx, 0.0, r0 - rz) * 2.6 * (1.0 - smoothstep(0.25, 1.1, px) * 0.5));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        float depthK = smoothstep(-0.6, 0.6, vCrest);
        vec3 sea = mix(cSea, vec3(0.05, 0.32, 0.38), gold), deep = mix(cDeep, vec3(0.02, 0.16, 0.22), gold);
        vec3 col = mix(deep, sea, 0.55 + 0.45 * depthK);
        col = mix(col, mix(cSky * 1.25, vec3(1.0, 0.7, 0.4), gold), fres * 0.85);
        // 月光波光带：宽而柔的光路 + 路上细碎闪烁（碎银）
        vec3 R = reflect(-V, n);
        float md = max(dot(R, moonDir), 0.0);
        float path = pow(md, 90.0);
        float glit = 0.0;
        if (detail > 0.0) glit = smoothstep(0.7, 0.95, fbm(vW.xz * 3.1 + vec2(time * 0.7, -time * 0.4))) * (1.0 - smoothstep(0.12, 0.45, px));
        col += cMoon * (path * 0.25 + path * glit * 2.6 + pow(md, 600.0) * 2.0);
        // 荧光：随机散落的小光点（闪烁）
        vec2 sp = vW.xz * 1.25 + vec2(time * 0.06, time * 0.02);
        vec2 ci = floor(sp), cf = fract(sp);
        float hh = h21(ci);
        vec2 pp = vec2(h21(ci + 7.1), h21(ci + 3.3)) * 0.8 + 0.1;
        float tw = 0.5 + 0.5 * sin(time * (1.5 + hh * 4.0) + hh * 40.0);
        float spark = step(0.8, hh) * smoothstep(0.13, 0.0, length(cf - pp)) * tw * 2.2 * (1.0 - smoothstep(0.08, 0.3, px));
        // 船体周围：一道细泡沫线 + 被撕碎的泡沫条；尾迹：沿航向拉长的条纹
        float hk = clamp((clamp(vW.z, hull.y, hull.w) - hull.z) / (hull.w - hull.z), 0.0, 1.0);
        float hw = hull.x * sqrt(1.0 - hk * hk);
        float dh = length(vec2(max(abs(vW.x) - hw, 0.0), max(hull.y - vW.z, 0.0) + max(vW.z - hull.w, 0.0)));
        float foam = 0.0, wake = 0.0;
        if (dh < 6.0) {
          float fn = fbm(vec2(vW.x * 2.2, vW.z * 0.9) + vec2(time * 0.3, -time * 0.9));
          foam = exp(-dh * 2.4) * smoothstep(0.5, 0.8, fn) + exp(-dh * 7.0) * 0.55;
        }
        if (dh < 12.0) wake = smoothstep(0.62, 0.85, fbm(vec2(vW.x * 1.4, vW.z * 0.22 + time * 0.9))) * exp(-dh * 0.45) * 0.5;
        col += cGlow2 * smoothstep(0.25, 0.5, vCrest) * 0.06;
        float g = spark * (1.0 - gold * 0.7) + foam * 0.9 + wake * 0.5;
        g *= 1.0 + surge * 1.5;
        col += mix(mix(cGlow2, cGlow, clamp(g, 0.0, 1.0)), vec3(1.0, 0.85, 0.45), gold) * g * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.onBeforeRender = (r, s, cam) => { mat.uniforms.pxAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov ?? 45) / 2) / Math.max(1, r.getContext().drawingBufferHeight); };
  mesh.position.set(0, -5.2, 15);
  mesh.frustumCulled = false;
  return mesh;
}
