// 渲染后期：HDR 渲染（MSAA）→ Bloom（只有超过 HDR 阈值的灯泡 / 高光 / 荧光）→ 色调映射 → 移轴 + 调色 + 暗角。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) },
    focus: { value: 0.47 }, band: { value: 0.36 }, blur: { value: 0.55 }, vignette: { value: 0.12 },
    sat: { value: 1.22 }, contrast: { value: 1.12 }, warmth: { value: 0 }, time: { value: 0 }, grain: { value: 0.0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float focus, band, blur, vignette, sat, contrast, warmth, time, grain; varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - focus) - band);
      float r = clamp(d * 2.6, 0.0, 1.0) * blur;
      vec4 c = texture2D(tDiffuse, vUv);
      if (r > 0.01) {
        vec4 acc = c; float w = 1.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996;
          float rr = sqrt(float(i) + 0.5) / sqrt(12.0);
          vec2 o = vec2(cos(a), sin(a)) * rr * r * 9.0 / res;
          acc += texture2D(tDiffuse, vUv + o); w += 1.0;
        }
        c = acc / w;
      }
      // 调色：饱和 + 对比 + 分离色调（暗部偏靛蓝夜色、亮部偏暖金）
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      // D1：暗部偏淡紫（不发黑）、亮部微暖；warmth = Jackpot / 晚霞
      c.rgb += vec3(0.025, 0.0, 0.045) * (1.0 - smoothstep(0.0, 0.4, l));
      c.rgb += vec3(0.02, 0.008, -0.015) * smoothstep(0.55, 1.0, l) * warmth * 3.0;
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
    this.r = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa });
    const comp = this.composer = new EffectComposer(renderer, rt);
    comp.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.4, 2.6);
    this.bloom.enabled = quality.bloom;
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.finish.uniforms.blur.value = quality.tiltShift ? 0.75 : 0;
    comp.addPass(this.finish);
  }
  setSize(w, h, dpr) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.finish.uniforms.res.value.set(w * dpr, h * dpr);
  }
  render(dt) { this.finish.uniforms.time.value += dt ?? 0.016; this.composer.render(dt); }
}

// 画质分级（设置里的"画质"三档；动态 DPR 在档内微调）
export const QUALITY = {
  high: { dprMax: 2, msaa: 4, bloom: true, tiltShift: true, shadows: 2048 },
  medium: { dprMax: 1.5, msaa: 2, bloom: true, tiltShift: true, shadows: 1024 },
  low: { dprMax: 1, msaa: 0, bloom: false, tiltShift: false, shadows: 512 },
};
