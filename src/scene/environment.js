// 环境：反射用环境贴图、夜空、荧光海面、灯光。
import * as THREE from 'three';

const PAL = {
  skyTop: new THREE.Color('#0d1230'), skyHorizon: new THREE.Color('#2a2f6b'),
  sea: new THREE.Color('#0b1a33'), seaDeep: new THREE.Color('#050b1c'),
  glow: new THREE.Color('#3ff2ff'), glow2: new THREE.Color('#19b8d6'),
  moon: new THREE.Color('#dce6ff'), lantern: new THREE.Color('#ff9a3c'),
};
export { PAL };

// ---------- 反射环境：金币/黄铜"看到"的世界 ----------
// 观察方向约 55° 俯视，平放金币的反射方向指向机台后上方 → 那里放老虎机跑马灯的暖色大光片，金币才会金。
export function buildEnvMap(renderer, skyTex) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sky: { value: skyTex }, top: { value: PAL.skyTop }, hor: { value: PAL.skyHorizon }, sea: { value: PAL.seaDeep } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform sampler2D sky; uniform vec3 top, hor, sea; varying vec3 vD;
      void main(){
        float e = vD.y;
        vec3 c = mix(hor, top, smoothstep(0.0, 0.7, e));
        c = mix(c, sea * 1.4, smoothstep(0.02, -0.25, e));
        // 背后半球贴月夜天空图（含月亮、云、远岛灯火）
        float az = atan(vD.x, -vD.z);           // 0 = 机台正后方
        float u = 0.5 + az / 3.14159 * 0.55;
        float v = 0.62 + e * 1.1;
        if (u > 0.0 && u < 1.0 && v > 0.05 && v < 1.0) {
          vec3 s = texture2D(sky, vec2(u, v)).rgb;
          float w = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u) * smoothstep(0.05, 0.2, v);
          c = mix(c, s * 1.15, w);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(sky);
  const panel = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); scene.add(m);
  };
  const O = [0, 0, 0];
  // 平放金币的反射方向 ≈ 机台后上方仰角 55°：放一大片暖金光（跑马灯 / 顶灯），金币才"金"
  panel(40, 22, new THREE.Color('#ffb44e'), 3.6, [0, 26, -18], O);
  panel(16, 8, new THREE.Color('#ffe0a0'), 3.2, [0, 31, 2], O);      // 正上方：高光
  panel(6, 8, PAL.lantern, 7, [-24, 8, -6], O);                      // 左右灯笼
  panel(6, 8, PAL.lantern, 7, [24, 8, -6], O);
  panel(8, 6, new THREE.Color('#ffc46b'), 4, [-14, 10, 20], O);      // 前方补光（侧面/币缘）
  panel(8, 6, new THREE.Color('#ffc46b'), 4, [14, 10, 20], O);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ color: PAL.moon.clone().multiplyScalar(14) }));
  moon.position.set(22, 30, -28); moon.lookAt(0, 0, 0); scene.add(moon);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.03);
  pm.dispose();
  return rt.texture;
}

// ---------- 天穹：夜（月夜天空图在机台后方）↔ 金色黎明（金币岛在船头前方），gold 0..1 交叉渐变 ----------
export function buildSkyDome(nightTex, goldTex) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { night: { value: nightTex }, goldTex: { value: goldTex }, gold: { value: 0 }, top: { value: PAL.skyTop }, hor: { value: PAL.skyHorizon } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform sampler2D night, goldTex; uniform float gold; uniform vec3 top, hor; varying vec3 vD;
      float bandW;   // 贴图边缘的渐隐权重（上缘不再硬切到纯色天空）
      vec3 band(sampler2D tex, vec3 d, float facing){
        float az = atan(d.x, facing * d.z);
        // 金币岛那张图朝船头那面下移一点：岛的沙滩压在远海尽头的金色雾带上
        float u = 0.5 + az / 3.14159 * 0.6, v = (facing > 0.0 ? 0.625 : 0.6) + d.y * 1.6;
        if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return vec3(-1.0);
        bandW = smoothstep(1.0, 0.8, v) * smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.94, u);
        return texture2D(tex, vec2(u, v)).rgb;
      }
      void main(){
        float e = vD.y;
        vec3 nCol = mix(hor, top, smoothstep(0.0, 0.6, e));
        vec3 s = band(night, vD, -1.0);
        if (s.x >= 0.0) nCol = mix(nCol, s, smoothstep(-0.02, 0.06, e) * 0.95 * bandW);
        vec3 gCol = mix(vec3(1.0, 0.72, 0.38), vec3(0.1, 0.14, 0.42), smoothstep(0.0, 0.3, e));   // 上方接金币岛图顶部的深蓝夜空，不留灰带
        vec3 g = band(goldTex, vD, 1.0);
        if (g.x >= 0.0) gCol = mix(gCol, g, smoothstep(-0.02, 0.08, e) * bandW);
        vec3 c = mix(nCol, gCol, gold);
        c = mix(c, mix(vec3(0.02, 0.05, 0.12), vec3(0.3, 0.2, 0.15), gold), smoothstep(0.0, -0.08, e));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(330, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ---------- 荧光海面 ----------
export function buildSea(hull) {
  const geo = new THREE.PlaneGeometry(420, 420, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, surge: { value: 0 }, gold: { value: 0 },
      cSea: { value: PAL.sea }, cDeep: { value: PAL.seaDeep }, cSky: { value: PAL.skyHorizon },
      cGlow: { value: PAL.glow }, cGlow2: { value: PAL.glow2 }, cMoon: { value: PAL.moon },
      moonDir: { value: new THREE.Vector3(0.28, 0.5, -0.82).normalize() },
      hull: { value: new THREE.Vector4(...hull) },        // 半宽, 船尾 z, 收窄起点 z, 船头 z（船体轮廓，做环绕泡沫）
    }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float time, surge;
      varying vec3 vW, vN; varying float vCrest;
      vec3 wave(vec2 p, vec2 dir, float len, float amp, float spd, inout vec3 n){
        float k = 6.2831 / len; float f = k * dot(dir, p) - time * spd * k;
        float s = sin(f), c = cos(f);
        n.x -= dir.x * k * amp * c; n.z -= dir.y * k * amp * c;
        return vec3(0.0, amp * s, 0.0);
      }
      void main(){
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 n = vec3(0.0, 1.0, 0.0);
        float A = 1.0 + surge * 1.4;
        vec3 d = wave(p.xz, normalize(vec2(0.3, 1.0)), 23.0, 0.42 * A, 2.2, n)
               + wave(p.xz, normalize(vec2(-0.7, 0.6)), 13.0, 0.22 * A, 1.8, n)
               + wave(p.xz, normalize(vec2(0.9, 0.2)), 7.3, 0.11 * A, 1.4, n)
               + wave(p.xz, normalize(vec2(-0.2, -1.0)), 4.1, 0.05, 1.1, n);
        p += d;
        vCrest = d.y;
        vW = p; vN = normalize(n);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float time, surge, gold; uniform vec3 cSea, cDeep, cSky, cGlow, cGlow2, cMoon, moonDir; uniform vec4 hull;
      varying vec3 vW, vN; varying float vCrest;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      // 手绘浪花：每个格子里一道月牙形笔触，慢慢浮现、漂移、消失（风格化，不做写实反射）
      float strokes(vec2 p, float scale, float seed){
        vec2 sp = p * scale + vec2(time * 0.05, time * 0.11);
        vec2 ci = floor(sp), cf = fract(sp);
        float hh = h21(ci + seed);
        vec2 c = vec2(h21(ci + 7.1 + seed), h21(ci + 3.3 + seed)) * 0.4 + 0.3;
        float ph = fract(time * (0.07 + hh * 0.05) + hh * 9.0);
        float life = sin(ph * 3.14159);
        vec2 d = (cf - c) * vec2(1.0, 2.6);
        float r = 0.17 + hh * 0.07;
        float ring = abs(length(d) - r);
        float ang = atan(d.y, d.x);                          // 只保留上半弧（朝船尾的弧背）
        float arc = smoothstep(0.15, 0.95, -sin(ang)) ;
        float w = 0.04 * (0.3 + 0.7 * arc);
        return step(0.45, hh) * (1.0 - smoothstep(w * 0.5, w, ring)) * arc * life;
      }
      void main(){
        vec3 n = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        // 色阶化的海色：浪谷 / 浪腹 / 浪背三档，边界柔一点（不是硬切）
        float k = smoothstep(-0.55, 0.55, vCrest);
        float band = smoothstep(0.28, 0.36, k) * 0.5 + smoothstep(0.7, 0.78, k) * 0.5;
        vec3 sea = mix(cSea, vec3(0.05, 0.32, 0.38), gold), deep = mix(cDeep, vec3(0.02, 0.16, 0.22), gold);
        vec3 col = mix(deep, sea * 1.15, band);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        col = mix(col, mix(cSky * 1.2, vec3(1.0, 0.7, 0.4), gold), floor(fres * 3.0 + 0.5) / 3.0 * 0.6);
        // 月光路：一条宽而柔的光带，里面是横向的短笔触（像手绘的月光碎片）
        vec3 R = reflect(-V, n);
        float md = max(dot(R, moonDir), 0.0);
        float path = smoothstep(0.975, 0.999, md);
        float dash = smoothstep(0.6, 0.78, vnoise(vec2(vW.x * 0.45 + time * 0.15, vW.z * 2.2 - time * 0.3)));
        col += cMoon * (path * 0.08 + path * dash * 0.55);
        // 荧光：随机散落的小光点（闪烁）
        vec2 sp = vW.xz * 1.25 + vec2(time * 0.06, time * 0.02);
        vec2 ci = floor(sp), cf = fract(sp);
        float hh = h21(ci);
        vec2 pp = vec2(h21(ci + 7.1), h21(ci + 3.3)) * 0.8 + 0.1;
        float tw = 0.5 + 0.5 * sin(time * (1.5 + hh * 4.0) + hh * 40.0);
        float spark = step(0.82, hh) * smoothstep(0.12, 0.0, length(cf - pp)) * tw * 2.0;
        // 船体轮廓距离（船头收窄）
        float hk = clamp((clamp(vW.z, hull.y, hull.w) - hull.z) / (hull.w - hull.z), 0.0, 1.0);
        float hw = hull.x * sqrt(1.0 - hk * hk);
        float dh = length(vec2(max(abs(vW.x) - hw, 0.0), max(hull.y - vW.z, 0.0) + max(vW.z - hull.w, 0.0)));
        // 船体泡沫：一道干净的白线 + 断续的外圈笔触
        float fn = vnoise(vec2(vW.x * 1.6, vW.z * 0.7) + vec2(time * 0.3, -time * 0.9));
        float foam = (1.0 - smoothstep(0.25, 0.4, dh)) * 0.9 + (1.0 - smoothstep(0.05, 0.12, abs(dh - 0.9 - fn * 0.4))) * step(0.45, fn) * 0.55;
        // 浪花笔触：两层不同尺度
        float st = strokes(vW.xz, 0.16, 0.0) + strokes(vW.xz + 37.0, 0.26, 5.0) * 0.7;
        st *= 0.55 + 0.45 * smoothstep(0.3, 0.8, k);        // 浪背上更明显
        col += vec3(0.55, 0.8, 1.0) * st * (0.42 + surge * 0.4);
        float g = spark + foam * 0.8;
        g *= 1.0 + surge * 1.2;
        col += mix(mix(cGlow2, cGlow, clamp(g, 0.0, 1.0)), vec3(1.0, 0.85, 0.45), gold) * g * 0.75;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -5.2;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- 灯光 ----------
export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0x5a74d0, 0x0c1424, 0.65);
  scene.add(hemi);
  // 冷月光：右后上方，主光 + 投影（ART_BIBLE：冷色月光做主轮廓光与环境光）
  const key = new THREE.DirectionalLight(PAL.moon, 1.55);
  key.position.set(9, 22, -8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 14, bottom: -14, near: 2, far: 60 });
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  // 暖色补光：镜头一侧的灯笼余光，不投影（局部暖光主要靠点光源 + 环境反射）
  const warm = new THREE.DirectionalLight(0xffc690, 0.45);
  warm.position.set(-4, 12, 16);
  scene.add(warm);
  return { hemi, key, warm };
}
