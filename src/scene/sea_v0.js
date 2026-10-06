// 第一版（v1 月光宝藏，tag v1-moonlit）的海面，原样保留用于对比：?sea=v0
import * as THREE from 'three';

export function buildSeaV0(hull, PAL) {
  const geo = new THREE.PlaneGeometry(420, 420, 220, 220);
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
      float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = m * p + 1.7; a *= 0.5; } return s; }   // 每层旋转，消掉值噪声的方格
      void main(){
        // 细碎波纹法线（屏幕导数 + 噪声）
        vec3 n = normalize(vN);   // 解析波浪法线（屏幕导数法线在网格三角面上是一块块平的，会出方格高光）
        vec2 q = vW.xz * 0.35 + vec2(time * 0.12, time * 0.05);
        float e = 0.08;
        float r0 = fbm(q), rx = fbm(q + vec2(e, 0.0)), rz = fbm(q + vec2(0.0, e));
        n = normalize(n + vec3(r0 - rx, 0.0, r0 - rz) * 2.6);
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        float depthK = smoothstep(-0.6, 0.6, vCrest);
        vec3 sea = mix(cSea, vec3(0.05, 0.32, 0.38), gold), deep = mix(cDeep, vec3(0.02, 0.16, 0.22), gold);
        vec3 col = mix(deep, sea, 0.55 + 0.45 * depthK);
        col = mix(col, mix(cSky * 1.25, vec3(1.0, 0.7, 0.4), gold), fres * 0.85);
        // 月光波光：反射方向对准月亮的高频亮点
        vec3 R = reflect(-V, n);
        // 月光波光带：宽而柔的光路 + 路上细碎闪烁
        float md = max(dot(R, moonDir), 0.0);
        float path = pow(md, 90.0);
        float glit = smoothstep(0.7, 0.95, fbm(vW.xz * 3.1 + vec2(time * 0.7, -time * 0.4)));
        col += cMoon * (path * 0.25 + path * glit * 2.6 + pow(md, 600.0) * 2.0);
        // 荧光：浪尖 + 噪声斑点 + 船体周围泡沫带
        // 荧光：随机散落的小光点（闪烁），不是整片云团
        vec2 sp = vW.xz * 1.25 + vec2(time * 0.06, time * 0.02);
        vec2 ci = floor(sp), cf = fract(sp);
        float hh = h21(ci);
        vec2 pp = vec2(h21(ci + 7.1), h21(ci + 3.3)) * 0.8 + 0.1;
        float tw = 0.5 + 0.5 * sin(time * (1.5 + hh * 4.0) + hh * 40.0);
        float spark = step(0.8, hh) * smoothstep(0.13, 0.0, length(cf - pp)) * tw * 2.2;
        float hk = clamp((clamp(vW.z, hull.y, hull.w) - hull.z) / (hull.w - hull.z), 0.0, 1.0);
        float hw = hull.x * sqrt(1.0 - hk * hk);
        float dh = length(vec2(max(abs(vW.x) - hw, 0.0), max(hull.y - vW.z, 0.0) + max(vW.z - hull.w, 0.0)));
        // 船体周围：一道细泡沫线 + 被撕碎的泡沫条
        float fn = fbm(vec2(vW.x * 2.2, vW.z * 0.9) + vec2(time * 0.3, -time * 0.9));
        float foam = exp(-dh * 2.4) * smoothstep(0.5, 0.8, fn) + exp(-dh * 7.0) * 0.55;
        // 尾迹：沿航向拉长的条纹
        float wake = smoothstep(0.62, 0.85, fbm(vec2(vW.x * 1.4, vW.z * 0.22 + time * 0.9))) * exp(-dh * 0.45) * 0.5;
        col += cGlow2 * smoothstep(0.25, 0.5, vCrest) * 0.06;
        float g = spark + foam * 0.9 + wake * 0.5;
        g *= 1.0 + surge * 1.5;
        col += mix(mix(cGlow2, cGlow, clamp(g, 0.0, 1.0)), vec3(1.0, 0.85, 0.45), gold) * g * 0.9;
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
