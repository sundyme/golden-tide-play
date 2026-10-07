// 渲染后期：HDR 渲染（MSAA）→ Bloom（只有超过 HDR 阈值的灯泡 / 高光 / 荧光）→ 收尾（移轴 + 色调映射 + 调色 + 暗角，一个全屏 pass）。
// 色调映射原来是单独的 OutputPass：多一次全分辨率 HalfFloat 读写，手机上带宽很贵，现在并进收尾 pass。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) },
    focus: { value: 0.45 }, band: { value: 0.3 }, blur: { value: 0.75 }, vignette: { value: 0.4 },
    sat: { value: 1.15 }, contrast: { value: 1.08 }, warmth: { value: 0 }, time: { value: 0 }, grain: { value: 0.022 },
    toneMappingExposure: { value: 1 },
  },
  // RawShaderMaterial：自己引入色调映射和 sRGB 编码（和 three 的 OutputShader 同一套 chunk / define）
  vertexShader: `precision highp float; uniform mat4 modelViewMatrix, projectionMatrix; attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float focus, band, blur, vignette, sat, contrast, warmth, time, grain; varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - focus) - band);
      float r = clamp(d * 2.6, 0.0, 1.0) * blur;
      vec4 c = texture2D(tDiffuse, vUv);
      if (r > 0.01) {
        vec4 acc = c; float w = 1.0;
        for (int i = 0; i < TAPS; i++) {   // 移轴：黄金角螺旋采样（高画质 12 次，中画质 6 次）
          float a = float(i) * 2.39996;
          float rr = sqrt(float(i) + 0.5) / sqrt(float(TAPS));
          vec2 o = vec2(cos(a), sin(a)) * rr * r * 9.0 / res;
          acc += texture2D(tDiffuse, vUv + o); w += 1.0;
        }
        c = acc / w;
      }
      // 色调映射 + sRGB（原 OutputPass）：在线性 HDR 上先模糊再映射，虚化区的灯泡高光会稍亮一点，像真的微距散景
      #ifdef ACES_FILMIC_TONE_MAPPING
        c.rgb = ACESFilmicToneMapping(c.rgb);
      #elif defined( AGX_TONE_MAPPING )
        c.rgb = AgXToneMapping(c.rgb);
      #elif defined( NEUTRAL_TONE_MAPPING )
        c.rgb = NeutralToneMapping(c.rgb);
      #endif
      #ifdef SRGB_TRANSFER
        c = sRGBTransferOETF(c);
      #endif
      // 调色：饱和 + 对比 + 分离色调（暗部偏靛蓝夜色、亮部偏暖金）
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(-0.012, -0.006, 0.03) * (1.0 - smoothstep(0.0, 0.45, l));
      c.rgb += vec3(0.03, 0.012, -0.02) * smoothstep(0.5, 1.0, l) * (1.0 + warmth * 3.0);
      c.rgb = clamp(c.rgb, 0.0, 1.0);
      vec2 q = vUv - 0.5; q.x *= res.x / res.y;
      float v = smoothstep(0.95, 0.25, length(q) * (1.0 + vignette));
      c.rgb *= mix(1.0 - vignette, 1.0, v);
      // 细颗粒：统一 CG 质感，同时打散暗部渐变的色带；亮部减弱（不弄脏金币）
      float n = fract(sin(dot(floor(vUv * res) + fract(time * 7.3) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c.rgb += n * grain * (1.0 - 0.7 * l);
      gl_FragColor = c;
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.r = renderer; this.msaa = quality.msaa;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
    const comp = this.composer = new EffectComposer(renderer, rt);
    comp.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.5, 1.4);
    this.bloom.enabled = quality.bloom;
    // Bloom 在四分之一分辨率上做（UnrealBloomPass 默认半分辨率）：光晕本来就是糊的，看不出差别；
    // 高画质 2× 像素密度下它原来是全帧最贵的一步（实测比整个场景还贵），是画面变糊（动态分辨率被迫降档）的主因
    const bloomSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    comp.addPass(this.bloom);
    const tm = { [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING', [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING', [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING' }[renderer.toneMapping];
    const defines = { TAPS: quality.tiltTaps ?? 12 };
    if (tm) defines[tm] = '';
    if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
    this.finish = new ShaderPass(new THREE.RawShaderMaterial({ name: 'Finish', defines, uniforms: THREE.UniformsUtils.clone(FinishShader.uniforms), vertexShader: FinishShader.vertexShader, fragmentShader: FinishShader.fragmentShader, depthTest: false, depthWrite: false }));
    this.finish.uniforms.blur.value = quality.tiltShift ? 0.75 : 0;
    comp.addPass(this.finish);
  }
  setSize(w, h, dpr) {
    // 高像素密度屏（DPR ≥ 1.75）上 4×MSAA 的收益很小、带宽开销很大：降到 2×
    const samples = dpr >= 1.75 ? Math.min(2, this.msaa) : this.msaa;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.finish.uniforms.res.value.set(w * dpr, h * dpr);
  }
  setTaps(n) { const m = this.finish.material; if (m.defines.TAPS !== n) { m.defines.TAPS = n; m.needsUpdate = true; } }
  render(dt) { const u = this.finish.uniforms; u.time.value += dt ?? 0.016; u.toneMappingExposure.value = this.r.toneMappingExposure; this.composer.render(dt); }
}

// 画质分级（设置里的"画质"三档；动态 DPR 在档内微调）
export const QUALITY = {
  high: { dprMax: 2, msaa: 4, bloom: true, tiltShift: true, shadows: 2048, clearcoat: true },
  medium: { dprMax: 1.5, msaa: 2, bloom: true, tiltShift: true, tiltTaps: 6, shadows: 1024, clearcoat: false },
  low: { dprMax: 1, msaa: 0, bloom: false, tiltShift: false, shadows: 512, clearcoat: false },
};
