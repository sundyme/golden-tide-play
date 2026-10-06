// 风格化海面 v2（仍然不是写实水面）：
//   网格：以船为中心的放射状网格，近密远疏，半径 400，盖住金币岛方向的远海；
//   顶点：4 道 Gerstner 浪（尖浪峰），短浪随离中心距离淡出（网格变疏的地方不出锯齿 / 闪烁）；
//   着色：色阶卡通光照（月光 ↔ 黎明阳光）、掠射角反射天色（菲涅尔）、浪尖透光、风格化白浪、
//         光路闪点（夜里是月光碎银，黎明是一条通往金币岛的金色光路）、荧光光点、手绘月牙笔触（只在近处）。
//   细节按像素大小（fwidth）自动淡出：远处、低角度不闪；画质档位只控制细节法线和闪点。
import * as THREE from 'three';

export function radialGrid(rings, sectors, radius, power) {
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = radius * Math.pow(i / rings, power);
    for (let j = 0; j < sectors; j++) { const a = j / sectors * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  const ring = i => 1 + (i - 1) * sectors;
  for (let j = 0; j < sectors; j++) idx.push(0, ring(1) + (j + 1) % sectors, ring(1) + j);
  for (let i = 1; i < rings; i++) for (let j = 0; j < sectors; j++) {
    const a = ring(i) + j, b = ring(i) + (j + 1) % sectors, c = ring(i + 1) + j, d = ring(i + 1) + (j + 1) % sectors;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export const SEA_QUALITY = { high: { rings: 130, sectors: 300, detail: 1 }, medium: { rings: 100, sectors: 220, detail: 0.6 }, low: { rings: 76, sectors: 160, detail: 0 } };

export function buildSea(hull, PAL, quality = 'high') {
  const Q = SEA_QUALITY[quality] ?? SEA_QUALITY.high;
  const geo = radialGrid(Q.rings, Q.sectors, 700, 2.4);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, surge: { value: 0 }, gold: { value: 0 }, detail: { value: Q.detail },
      cDeep: { value: PAL.seaDeep }, cBody: { value: new THREE.Color('#123a5c') }, cCrest: { value: new THREE.Color('#2f8fa6') },
      cSkyHor: { value: PAL.skyHorizon }, cSkyTop: { value: PAL.skyTop },
      cGlow: { value: PAL.glow }, cGlow2: { value: PAL.glow2 }, cMoon: { value: PAL.moon },
      moonDir: { value: new THREE.Vector3(0.28, 0.5, -0.82).normalize() },
      sunDir: { value: new THREE.Vector3(0.0, 0.16, 1).normalize() },   // 黎明：太阳在船头前方、金币岛那边，贴着海平线
      hull: { value: new THREE.Vector4(...hull) },
      goldTex: { value: null },       // 金币岛天穹图：海天线取它沙滩那一行的颜色，海和岛无缝接上
    }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float time, surge;
      varying vec3 vW, vN; varying float vH, vCrest;
      // Gerstner：d 方向、L 波长、A 振幅、S 尖度、c 相速度；fade 按离网格中心的距离淡出短浪
      void gw(vec2 x, vec2 d, float L, float A, float S, float c, float r, inout vec3 P, inout vec3 N, inout float cr){
        A *= 1.0 - smoothstep(L * 4.0, L * 9.0, r);
        float k = 6.2831 / L, f = k * (dot(d, x) - c * time), s = sin(f), co = cos(f);
        P.x += S * A * d.x * co; P.z += S * A * d.y * co; P.y += A * s;
        N.x -= d.x * k * A * co; N.z -= d.y * k * A * co; N.y -= S * k * A * s;
        cr += S * k * A * s;
      }
      void main(){
        vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
        float r = length(position.xz);
        float A = 1.0 + surge * 1.4;
        vec3 P = vec3(0.0), N = vec3(0.0, 1.0, 0.0); float cr = 0.0;
        gw(w.xz, normalize(vec2(0.3, 1.0)), 31.0, 0.46 * A, 0.55, 3.0, r, P, N, cr);
        gw(w.xz, normalize(vec2(-0.6, 0.8)), 19.0, 0.27 * A, 0.6, 2.4, r, P, N, cr);
        gw(w.xz, normalize(vec2(0.85, 0.35)), 11.5, 0.15 * A, 0.65, 1.9, r, P, N, cr);
        gw(w.xz, normalize(vec2(-0.15, -1.0)), 7.3, 0.08 * A, 0.7, 1.5, r, P, N, cr);
        w += P;
        vH = P.y; vCrest = cr; vW = w; vN = N;
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float time, surge, gold, detail;
      uniform vec3 cDeep, cBody, cCrest, cSkyHor, cSkyTop, cGlow, cGlow2, cMoon, moonDir, sunDir; uniform vec4 hull; uniform sampler2D goldTex;
      varying vec3 vW, vN; varying float vH, vCrest;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      // 噪声坡度（有限差分）→ 细节法线
      vec2 slope(vec2 p){ float c = vnoise(p); return vec2(vnoise(p + vec2(0.35, 0.0)) - c, vnoise(p + vec2(0.0, 0.35)) - c) / 0.35; }
      // 手绘月牙笔触（v1.5 的风格标志，保留在近处）
      float strokes(vec2 p, float scale, float seed){
        vec2 sp = p * scale + vec2(time * 0.05, time * 0.11);
        vec2 ci = floor(sp), cf = fract(sp);
        float hh = h21(ci + seed);
        vec2 c = vec2(h21(ci + 7.1 + seed), h21(ci + 3.3 + seed)) * 0.4 + 0.3;
        float life = sin(fract(time * (0.07 + hh * 0.05) + hh * 9.0) * 3.14159);
        vec2 d = (cf - c) * vec2(1.0, 2.6);
        float ring = abs(length(d) - (0.17 + hh * 0.07));
        float arc = smoothstep(0.15, 0.95, -sin(atan(d.y, d.x)));
        float w = 0.04 * (0.3 + 0.7 * arc);
        return step(0.45, hh) * (1.0 - smoothstep(w * 0.5, w, ring)) * arc * life;
      }
      void main(){
        vec2 q = vW.xz;
        float px = max(length(fwidth(q)), 1e-4);                 // 一个像素覆盖多少世界单位
        float camD = length(cameraPosition - vW);
        vec3 V = normalize(cameraPosition - vW);
        vec3 n = normalize(vN);
        // 细节法线：两层滚动噪声坡度，按像素大小淡出（远处 / 掠射角不闪）
        // 低画质（detail = 0）整段跳过：真分支，不是乘 0
        if (detail > 0.0) {
          vec2 g = slope(q * 0.33 + vec2(time * 0.19, time * 0.12)) * 0.12 * (1.0 - smoothstep(0.12, 0.5, px));
          if (detail > 0.7) g += slope(q * 0.85 + vec2(-time * 0.33, time * 0.26)) * 0.07 * (1.0 - smoothstep(0.05, 0.2, px));
          n = normalize(n + vec3(g.x, 0.0, g.y));
        }
        vec3 L = normalize(mix(moonDir, sunDir, gold));
        // 色阶卡通光：两道柔和台阶
        float nl = dot(n, L) * 0.5 + 0.5;
        float toon = smoothstep(0.5, 0.56, nl) * 0.45 + smoothstep(0.72, 0.78, nl) * 0.55;
        float h = smoothstep(-0.7, 0.8, vH);
        vec3 deep = mix(cDeep, vec3(0.02, 0.17, 0.24), gold);
        vec3 body = mix(cBody, vec3(0.05, 0.4, 0.47), gold);
        vec3 lite = mix(cCrest, vec3(0.3, 0.85, 0.75), gold);
        vec3 col = mix(deep, body, clamp(toon * 0.75 + h * 0.35, 0.0, 1.0));
        // 浪尖透光：逆光看薄浪峰发亮（黎明更明显）
        float sss = pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.45, 1.0, h);
        col += lite * sss * mix(0.35, 0.9, gold);
        // 反射天色：掠射角越大越接近天（分两档，保持插画感）
        vec3 R = reflect(-V, n); R.y = abs(R.y);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        fres = (smoothstep(0.02, 0.2, fres) * 0.5 + smoothstep(0.3, 0.8, fres) * 0.5) * mix(0.42, 0.55, gold);
        vec3 skyN = mix(cSkyHor, cSkyTop, smoothstep(0.0, 0.6, R.y));
        vec3 skyG = mix(vec3(0.95, 0.6, 0.32), vec3(0.4, 0.3, 0.58), smoothstep(0.0, 0.4, R.y));
        col = mix(col, mix(skyN, skyG, gold), fres);
        // 光路：宽而柔的光带 + 里面一闪一闪的碎光（世界格子里的随机点，太小就淡出）
        float rl = max(dot(R, L), 0.0);
        vec3 lc = mix(cMoon, vec3(1.0, 0.78, 0.42), gold);
        float path = pow(rl, mix(220.0, 70.0, gold)) * mix(0.22, 0.3, gold);
        // 光路里横向的碎光笔触（手绘感）：只在光路范围内、按像素大小淡出
        float dash = smoothstep(0.62, 0.8, vnoise(vec2(q.x * 0.5 + time * 0.15, q.y * 2.4 - time * 0.35))) * smoothstep(mix(0.97, 0.85, gold), 1.0, rl) * (1.0 - smoothstep(0.3, 0.9, px));
        float glint = 0.0;
        if (detail > 0.0 && rl > 0.85) {
          vec2 gq = q * 1.6; vec2 ci = floor(gq), cf = fract(gq) - 0.5; float hh = h21(ci);
          vec2 off = (vec2(h21(ci + 3.1), h21(ci + 5.7)) - 0.5) * 0.6;
          float tw = 0.5 + 0.5 * sin(time * (2.0 + hh * 5.0) + hh * 30.0);
          glint = smoothstep(0.14, 0.0, length(cf - off)) * step(0.62, hh) * tw * smoothstep(mix(0.975, 0.9, gold), 1.0, rl);
          glint *= 1.0 - smoothstep(0.1, 0.35, px);
        }
        col += lc * (path + dash * mix(0.45, 0.9, gold) + glint * mix(1.2, 2.2, gold) * (0.4 + 0.6 * detail));
        // 风格化白浪：浪峰尖处 + 噪声打碎成片，边缘柔
        float fn = vnoise(q * 0.5 + vec2(time * 0.1, -time * 0.22));
        float cap = smoothstep(0.5, 0.68, vCrest * 0.9 + h * 0.3 + (fn - 0.5) * 0.6) * (1.0 - smoothstep(0.4, 1.2, px));
        col = mix(col, mix(vec3(0.45, 0.66, 0.86), vec3(1.0, 0.94, 0.82), gold) * (0.6 + 0.4 * toon), cap * mix(0.32, 0.72, gold));
        // 船体轮廓泡沫（船头收窄）
        float hk = clamp((clamp(vW.z, hull.y, hull.w) - hull.z) / (hull.w - hull.z), 0.0, 1.0);
        float hw = hull.x * sqrt(1.0 - hk * hk);
        float dh = length(vec2(max(abs(vW.x) - hw, 0.0), max(hull.y - vW.z, 0.0) + max(vW.z - hull.w, 0.0)));
        float fh = vnoise(vec2(vW.x * 1.6, vW.z * 0.7) + vec2(time * 0.3, -time * 0.9));
        float foam = (1.0 - smoothstep(0.25, 0.4, dh)) * 0.9 + (1.0 - smoothstep(0.05, 0.12, abs(dh - 0.9 - fh * 0.4))) * step(0.45, fh) * 0.55;
        // 荧光光点（夜里）+ 手绘月牙笔触（近处）
        vec2 sp = q * 1.25 + vec2(time * 0.06, time * 0.02);
        vec2 si = floor(sp), sf = fract(sp); float sh = h21(si);
        vec2 pp = vec2(h21(si + 7.1), h21(si + 3.3)) * 0.8 + 0.1;
        float spark = step(0.82, sh) * smoothstep(0.12, 0.0, length(sf - pp)) * (0.5 + 0.5 * sin(time * (1.5 + sh * 4.0) + sh * 40.0)) * 2.0 * (1.0 - smoothstep(0.08, 0.3, px));
        float st = (strokes(q, 0.16, 0.0) + strokes(q + 37.0, 0.26, 5.0) * 0.7) * (0.55 + 0.45 * h) * (1.0 - smoothstep(0.08, 0.25, px));
        col += vec3(0.55, 0.8, 1.0) * st * (0.32 + surge * 0.4) * (1.0 - gold * 0.6);
        float gl = (spark * (1.0 - gold) + foam * 0.8) * (1.0 + surge * 1.2);
        col += mix(mix(cGlow2, cGlow, clamp(gl, 0.0, 1.0)), vec3(1.0, 0.9, 0.7), gold) * gl * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // 雾：黎明时海面基本不吃雾（雾色是灰奶油色，会在海天之间糊出一条白带），由下面的海天线混色接管
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - gold * 0.8));
        #endif
        // 贴近海平线时并入天穹的地平线色（和天穹无缝接上，黎明时是一条金色的海天线）
        float hz = 1.0 - smoothstep(0.0, mix(0.04, 0.035, gold), V.y);
        vec3 hg = vec3(1.0, 0.72, 0.4);
        if (gold > 0.0) { vec3 d = -V; float u = 0.5 + atan(d.x, d.z) / 3.14159 * 0.6; if (u > 0.02 && u < 0.98) hg = mix(hg, texture2D(goldTex, vec2(u, 0.6)).rgb, 0.85); }
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(cSkyHor * 0.9, hg, gold), hz * 0.9);
      }`,
  });
  mat.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -5.2, 15);
  mesh.frustumCulled = false;
  return mesh;
}
