// 环境（D1「汽水海」）：糖果摄影棚反射环境、晴天天穹（程序化棉花云）、卡通泻湖海面、太阳 + 淡紫天光。
// 色板见 art/ART_BIBLE_D1.md。gold 参数 = 终局的糖果色晚霞。
import * as THREE from 'three';

const PAL = {
  skyTop: new THREE.Color('#7fd0ff'), skyHorizon: new THREE.Color('#e4f7ff'),
  sea: new THREE.Color('#2fd0d6'), seaDeep: new THREE.Color('#1a8fe0'), shallow: new THREE.Color('#8ff5e6'),
  foam: new THREE.Color('#ffffff'), lilac: new THREE.Color('#8b7cff'), shadow: new THREE.Color('#6b5fd6'),
  sun: new THREE.Color('#fff3df'), sunset: new THREE.Color('#ffb38a'),
};
export { PAL };

// ---------- 反射环境：糖果摄影棚 ----------
// 上方大白柔光箱（塑料的高光）、正后上方暖金片（平放金币的反射方向，金币才够金）、天蓝天空、淡紫地面反光
export function buildEnvMap(renderer) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: PAL.skyTop }, hor: { value: PAL.skyHorizon }, ground: { value: new THREE.Color('#a99cff') } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top, hor, ground; varying vec3 vD;
      void main(){
        float e = vD.y;
        vec3 c = mix(hor, top, smoothstep(0.0, 0.8, e));
        c = mix(c, ground * 0.9, smoothstep(0.02, -0.3, e));
        gl_FragColor = vec4(c * 1.1, 1.0);
      }`,
  }));
  scene.add(sky);
  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); scene.add(m);
  };
  panel(40, 22, '#ffd27a', 2.6, [0, 26, -18]);    // 金币的金：机台后上方暖金
  panel(22, 12, '#ffffff', 3.4, [-6, 32, 6]);     // 顶部白色柔光箱：塑料高光
  panel(10, 7, '#ffd0e0', 1.6, [-18, 8, 16]);     // 前侧粉色反光
  panel(10, 7, '#c8fff0', 1.4, [18, 8, 16]);      // 前侧薄荷反光
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  return rt.texture;
}

// ---------- 天穹：晴天渐变 + 程序化棉花云 + 太阳光晕；gold → 糖果晚霞 ----------
export function buildSkyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { gold: { value: 0 }, time: { value: 0 }, top: { value: PAL.skyTop }, hor: { value: PAL.skyHorizon }, sunDir: { value: new THREE.Vector3(-0.35, 0.45, -0.82).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform float gold, time; uniform vec3 top, hor, sunDir; varying vec3 vD;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ s += a * vn(p); p = m * p; a *= 0.5; } return s; }
      void main(){
        float e = vD.y;
        vec3 dayTop = top, dayHor = hor;
        vec3 setTop = vec3(0.55, 0.52, 0.95), setHor = vec3(1.0, 0.72, 0.62);
        vec3 c = mix(mix(dayHor, dayTop, smoothstep(0.0, 0.55, e)), mix(setHor, setTop, smoothstep(0.0, 0.5, e)), gold);
        // 棉花云：只在地平线上方一条带里，软边 + 底部淡紫阴影
        vec2 uv = vec2(atan(vD.x, vD.z) * 2.2, e * 7.0) + vec2(time * 0.004, 0.0);
        float d = fbm(uv * vec2(1.0, 1.6));
        float band = smoothstep(0.02, 0.12, e) * smoothstep(0.5, 0.18, e);
        float cl = smoothstep(0.5, 0.62, d) * band;
        float lit = smoothstep(0.45, 0.75, fbm(uv * vec2(1.0, 1.6) + vec2(0.0, -0.06)));
        vec3 cloud = mix(mix(vec3(0.78, 0.76, 1.0), vec3(1.0), lit), mix(vec3(0.95, 0.6, 0.75), vec3(1.0, 0.9, 0.8), lit), gold);
        c = mix(c, cloud, cl * 0.95);
        // 太阳光晕
        float s = max(dot(vD, sunDir), 0.0);
        c += mix(vec3(1.0, 0.96, 0.85), vec3(1.0, 0.7, 0.45), gold) * (pow(s, 40.0) * 0.6 + pow(s, 600.0) * 2.0);
        c = mix(c, mix(vec3(0.55, 0.85, 0.95), vec3(0.95, 0.65, 0.6), gold), smoothstep(0.0, -0.06, e));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(330, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ---------- 卡通泻湖海面 ----------
// 近船浅（薄荷绿松石）→ 远处深（天蓝）；菲涅尔分段映出天色；太阳闪点 = 一颗颗四角星；船体周围一圈干净的白色泡沫环；浪尖白线
export function buildSea(hull) {
  const geo = new THREE.PlaneGeometry(420, 420, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, surge: { value: 0 }, gold: { value: 0 },
      cSea: { value: PAL.sea }, cDeep: { value: PAL.seaDeep }, cShallow: { value: PAL.shallow }, cSky: { value: PAL.skyHorizon },
      sunDir: { value: new THREE.Vector3(-0.35, 0.6, -0.72).normalize() },
      hull: { value: new THREE.Vector4(...hull) },
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
        vec3 d = wave(p.xz, normalize(vec2(0.3, 1.0)), 23.0, 0.36 * A, 2.0, n)
               + wave(p.xz, normalize(vec2(-0.7, 0.6)), 13.0, 0.2 * A, 1.7, n)
               + wave(p.xz, normalize(vec2(0.9, 0.2)), 7.3, 0.09 * A, 1.3, n);
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
      uniform float time, surge, gold; uniform vec3 cSea, cDeep, cShallow, cSky, sunDir; uniform vec4 hull;
      varying vec3 vW, vN; varying float vCrest;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 3; i++){ s += a * vn(p); p = m * p + 1.7; a *= 0.5; } return s; }
      void main(){
        vec3 n = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        // 到船体轮廓的距离（船头收窄）
        float hk = clamp((clamp(vW.z, hull.y, hull.w) - hull.z) / (hull.w - hull.z), 0.0, 1.0);
        float hw = hull.x * sqrt(1.0 - hk * hk);
        float dh = length(vec2(max(abs(vW.x) - hw, 0.0), max(hull.y - vW.z, 0.0) + max(vW.z - hull.w, 0.0)));
        // 底色：近船浅、远处深，分成柔和的两三段（卡通水）
        float near = exp(-dh * 0.09);
        float k = floor(near * 3.0 + fbm(vW.xz * 0.08 + time * 0.03) * 0.8) / 3.0;
        vec3 col = mix(cDeep, cSea, smoothstep(0.0, 0.5, mix(near, k, 0.5)));
        col = mix(col, cShallow, smoothstep(0.55, 1.0, near) * 0.6);
        // 浪面明暗：朝太阳的坡亮一点，背面带一点紫
        float lam = dot(n, normalize(vec3(sunDir.x, 1.2, sunDir.z)));
        col *= 0.9 + 0.18 * smoothstep(0.6, 1.0, lam);
        col = mix(col, vec3(0.42, 0.45, 0.95), smoothstep(0.0, -0.4, vCrest) * 0.12);
        // 菲涅尔：远处映出天色
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        col = mix(col, mix(cSky, vec3(1.0, 0.75, 0.65), gold), smoothstep(0.2, 0.7, fres) * 0.55);
        // 浪尖白线（细、干净、随浪起伏）
        float crestLine = 0.6 * smoothstep(0.4, 0.43, vCrest + (fbm(vW.xz * 0.4 + time * 0.1) - 0.5) * 0.18);
        // 船体泡沫环：一道实心白边 + 外面一圈断续的泡沫点
        float ring = 1.0 - smoothstep(0.35, 0.55, dh + (fbm(vec2(vW.x * 1.6, vW.z * 0.8) + time * vec2(0.2, -0.6)) - 0.5) * 0.5);
        float ring2 = smoothstep(0.62, 0.66, fbm(vW.xz * 1.1 + vec2(0.0, -time * 0.8))) * exp(-dh * 0.7) * step(0.6, dh);
        // 尾迹：船尾方向拉长的白条
        float wake = smoothstep(0.62, 0.7, fbm(vec2(vW.x * 0.9, vW.z * 0.15 + time * 0.7))) * exp(-dh * 0.25) * smoothstep(-10.0, -30.0, vW.z);
        float foam = max(max(ring, ring2 * 0.9), max(crestLine * 0.75, wake * 0.8));
        foam = max(foam, smoothstep(0.55, 0.6, fbm(vW.xz * 0.6 + time * 0.12)) * surge * 0.8);
        col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0));
        // 太阳闪点：反射方向对准太阳的稀疏格子，画成四角星并闪烁
        vec3 R = reflect(-V, n);
        float sd = max(dot(R, sunDir), 0.0);
        vec2 sp = vW.xz * 0.9 + vec2(time * 0.05, 0.0);
        vec2 ci = floor(sp), cf = fract(sp) - 0.5;
        float hh = h21(ci);
        vec2 o = (vec2(h21(ci + 7.1), h21(ci + 3.3)) - 0.5) * 0.5;
        vec2 q = abs(cf - o);
        float star = smoothstep(0.08, 0.0, q.x * q.y * 40.0 + length(q) * 0.6);
        float tw = 0.5 + 0.5 * sin(time * (2.0 + hh * 5.0) + hh * 30.0);
        col += vec3(1.0) * star * step(0.72, hh) * tw * (0.35 + smoothstep(0.85, 0.99, sd) * 2.5);
        col += vec3(1.0, 0.98, 0.9) * pow(sd, 300.0) * 1.5;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -5.2;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- 灯光：太阳（左前上方，投影）+ 天光（天蓝 / 地面淡紫：阴影自然偏紫）+ 前方粉色反光 ----------
export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xdcf1ff, 0x7a68ee, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(PAL.sun, 2.5);
  key.position.set(-9, 24, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -13, right: 13, top: 16, bottom: -16, near: 2, far: 70 });
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.025;
  key.shadow.radius = 4;
  key.shadow.intensity = 0.62;   // 阴影只压掉一半的阳光：剩下天光的淡紫，不发黑
  scene.add(key, key.target);
  const warm = new THREE.DirectionalLight(0xffc8d8, 0.45);   // 前方粉色反光（也是 Jackpot 金色补光的通道）
  warm.position.set(4, 6, 18);
  scene.add(warm);
  return { hemi, key, warm };
}
