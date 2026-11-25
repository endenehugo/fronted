import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  MORPH_DELAY_MAX,
  MORPH_DELAY_WIDTH,
  MORPH_DURATION,
  nebulaFragmentShader,
  nebulaVertexShader,
  starfieldFragmentShader,
  starfieldVertexShader,
} from './nebulaShaders';
import { buildShape, type ShapeAttributes } from './shapeGenerators';
import { PRESET_MAP } from './presets';
import type { EmotionVector, NebulaPreset, PresetId } from '../types';
import { NebulaAudioEngine } from '../audio/NebulaAudioEngine';

export interface NebulaCanvasHandle {
  /** 截取当前 WebGL 画面（需 preserveDrawingBuffer） */
  capture: () => string | null;
  /** 从奇点展开 */
  expand: () => void;
}

export interface NebulaStats {
  fps: number;
  count: number;
}

interface Props {
  preset: NebulaPreset;
  emotion: EmotionVector | null;
  palette: [string, string, string] | null;
  turbulence: number;
  speed: number;
  /** 效价滑块 -1~1；null 表示未启用，跟随文本解析 */
  valence: number | null;
  onStats?: (s: NebulaStats) => void;
}

const KEY_DEGREES: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  g: 4,
  h: 5,
  j: 6,
  k: 7,
  l: 8,
};

/** 潮汐旋涡峰值强度（角度系数，中段最强、两端归零）；2.8s 长过渡下压到 1.1 保持柔和 */
const SWIRL_AMP = 1.1;

/** 相机指数阻尼系数 λ：1.6 时 2.8s 内收敛到 99%，与「星际潜入」形变同长 */
const CAM_DAMP = 1.6;

/** 背景星野恒星数（桌面 / 移动） */
const STARFIELD_COUNT = { desktop: 3500, mobile: 2000 };

/** 切换预设瞬间的 Bloom 能量涌动：上浮量与连点封顶（防叠加爆白） */
const BLOOM_KICK = 0.15;
const BLOOM_KICK_MAX = 0.3;

/** 与 GLSL smoothstep 等价，供 CPU 中断烘焙复现着色器里的错峰插值 */
const smoothstep01 = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 程序化径向高斯贴图，消除方形锯齿 */
function createParticleTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) {
    const fallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    fallback.needsUpdate = true;
    return fallback as unknown as THREE.CanvasTexture;
  }
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.82)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
};

class NebulaEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private points: THREE.Points;
  /** 深空背景星野（常驻图层，不参与形变） */
  private starfield!: THREE.Points;
  private starMaterial!: THREE.ShaderMaterial;
  private coreSprite: THREE.Sprite;
  private material: THREE.ShaderMaterial;
  private uniforms: Record<string, THREE.IUniform>;
  private texture: THREE.CanvasTexture;
  private raycaster = new THREE.Raycaster();

  private preset: NebulaPreset;
  private emotion: EmotionVector | null;
  private shapeId: PresetId;

  private raf = 0;
  private clock = new THREE.Clock();
  private disposed = false;

  private count: number;
  private downgraded = false;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsGapMax = 0;
  private lowFpsStreak = 0;
  private lastFps = 60;
  private warmup = 0;

  private targetColors: THREE.Color[] = [];
  private uniformColors: THREE.Color[] = [];

  // 视觉参数：切换回调只写 *Target，loop 内逐帧阻尼到 *Current，禁止直接突变
  private bloomTarget = 1;
  private bloomCurrent = 1;
  private bloomKick = 0;
  private sizeTarget = 1;
  private sizeCurrent = 1;
  private coreTarget = 0.4;
  private coreCurrent = 0.4;
  /** 频段律动叠加：bass 体量涨缩 / mid 转速辉光 / treble 粒子尺寸，均在 loop 内平滑 */
  private grooveBass = 0;
  private grooveMid = 0;
  private grooveTreble = 0;

  // 分形态动态物理
  private behaviorTarget = new THREE.Vector4(0.2, 0.1, 0, 0.1);
  private behaviorCurrent = new THREE.Vector4(0.2, 0.1, 0, 0.1);
  private shearTarget = 0;
  private shearCurrent = 0;
  /** 心情解析对湍流 / 转速的相对缩放 */
  private motionScale = { turbulence: 1, speed: 1 };

  // 双缓冲形变
  private morphActive = false;
  private morphProgress = 0;
  private transitionSwirl = 0;

  // 效价滑块：只改配色、不动几何；mix ∈ [-1,1]，null = 未启用，跟随预设/解析配色
  private valenceMix: number | null = null;

  // 相机
  private camTheta = 0.4;
  private camPhi = 0.95;
  private camDist = 10.6;
  private camThetaTarget = 0.4;
  private camPhiTarget = 0.95;
  private camDistTarget = 10.6;
  private userCam = false;
  private velTheta = 0;
  private velPhi = 0;

  // 交互形变
  private collapse = 1;
  private collapseTarget = 1;
  private shockActive = false;
  private shockT = 0;
  private pointerTarget = new THREE.Vector3(999, 999, 999);
  private pointerCurrent = new THREE.Vector3(999, 999, 999);
  private pointerStrength = 0;
  private pointerTargetStrength = 0;
  private burstPos = new THREE.Vector3(999, 999, 999);
  private burstAmp = 0;

  private pointerDown = false;
  private moved = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private downTime = 0;
  private collapseTimer: number | null = null;
  private collapsing = false;
  private lastHoverSound = 0;

  private audio = NebulaAudioEngine.getInstance();
  private resizeObserver: ResizeObserver | null = null;
  private onStats?: (s: NebulaStats) => void;

  constructor(
    container: HTMLElement,
    preset: NebulaPreset,
    emotion: EmotionVector | null,
    onStats?: (s: NebulaStats) => void,
  ) {
    this.container = container;
    this.preset = preset;
    this.emotion = emotion;
    this.onStats = onStats;
    this.shapeId = preset.id;
    this.count = isMobileDevice() ? 8000 : 18000;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // 明信片导出必需
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200);
    this.texture = createParticleTexture();

    this.camTheta = preset.camera.theta;
    this.camThetaTarget = preset.camera.theta;
    this.camPhi = preset.camera.phi;
    this.camPhiTarget = preset.camera.phi;
    this.camDist = preset.camera.dist;
    this.camDistTarget = preset.camera.dist;

    this.uniforms = {
      uTime: { value: 0 },
      uMorphProgress: { value: 0 },
      uTransitionSwirl: { value: 0 },
      uBehavior: { value: this.behaviorCurrent.clone() },
      uShear: { value: preset.shear },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uCollapse: { value: 1 },
      uShockRadius: { value: 0 },
      uShockAmp: { value: 0 },
      uPointer: { value: this.pointerCurrent },
      uPointerStrength: { value: 0 },
      uBurstPos: { value: this.burstPos },
      uBurstAmp: { value: 0 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uSize: { value: preset.sizeScale },
      uColors: {
        value: [new THREE.Color('#ffffff'), new THREE.Color('#00b4d8'), new THREE.Color('#03045e')],
      },
      uMap: { value: this.texture },
    };
    this.uniformColors = this.uniforms.uColors.value as THREE.Color[];

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const shape = buildShape(preset.id, this.count);
    this.points = new THREE.Points(this.buildGeometry(this.count, shape), this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // 核心辉光：大尺寸软光斑，避免核心被成千上万个点叠加成死白
    this.coreSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texture,
        color: new THREE.Color(preset.colors[0]),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.coreSprite.scale.set(1.6, 1.6, 1);
    this.scene.add(this.coreSprite);

    this.buildStarfield();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.1, 0.75, 0.12);
    this.composer.addPass(this.bloom);

    this.applyPreset(preset, emotion, true);
    this.bindEvents();
    this.loop();
  }

  // -------------------------------------------------------------- 几何

  /**
   * 独立背景星野：半径 35~65 的球壳 THREE.Points，色温涵盖冷白 / 淡蓝 / 暖黄，
   * 尺寸随机（少数亮星更大），只用一份轻量着色器做闪烁，主循环里整体缓慢微旋。
   */
  private buildStarfield(): void {
    const n = isMobileDevice() ? STARFIELD_COUNT.mobile : STARFIELD_COUNT.desktop;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    const tints: [number, number, number][] = [
      [0.82, 0.88, 1.0], // 冷白
      [0.66, 0.78, 1.0], // 淡蓝
      [1.0, 0.88, 0.68], // 暖黄
      [1, 1, 1],
    ];
    const rMin = 35;
    const rMax = 65;
    for (let i = 0; i < n; i++) {
      // 球壳内按体积均匀分布
      const u = Math.random() * 2 - 1;
      const ph = Math.random() * Math.PI * 2;
      const r = Math.cbrt(rMin ** 3 + Math.random() * (rMax ** 3 - rMin ** 3));
      const st = Math.sqrt(1 - u * u);
      pos[i * 3] = r * st * Math.cos(ph);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * st * Math.sin(ph);
      const t = tints[Math.floor(Math.random() * tints.length)];
      const b = 0.55 + Math.random() * 0.45;
      col[i * 3] = t[0] * b;
      col[i * 3 + 1] = t[1] * b;
      col[i * 3 + 2] = t[2] * b;
      size[i] = Math.random() < 0.06 ? 4 + Math.random() * 2.5 : 1.6 + Math.random() * 3.2;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uMap: { value: this.texture },
      },
      vertexShader: starfieldVertexShader,
      fragmentShader: starfieldFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.starfield = new THREE.Points(geo, this.starMaterial);
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);
  }

  private buildGeometry(count: number, shape: ShapeAttributes): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(shape.position.slice(), 3));
    geo.setAttribute('aTargetPosition', new THREE.BufferAttribute(shape.position.slice(), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(shape.size.slice(), 1));
    geo.setAttribute('aTargetSize', new THREE.BufferAttribute(shape.size.slice(), 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(shape.seed.slice(), 1));
    geo.setAttribute('aRole', new THREE.BufferAttribute(shape.role.slice(), 1));
    geo.setAttribute('aTargetRole', new THREE.BufferAttribute(shape.role.slice(), 1));
    geo.setAttribute('aColorT', new THREE.BufferAttribute(shape.colorT.slice(), 1));
    geo.setAttribute('aTargetColorT', new THREE.BufferAttribute(shape.colorT.slice(), 1));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(shape.random.slice(), 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(shape.color.slice(), 3));
    geo.setAttribute('aColorW', new THREE.BufferAttribute(shape.colorW.slice(), 1));
    geo.setAttribute('aTargetColorW', new THREE.BufferAttribute(shape.colorW.slice(), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    return geo;
  }

  private applyCount(n: number): void {
    this.count = n;
    const shape = buildShape(this.shapeId, n);
    const geo = this.buildGeometry(n, shape);
    this.points.geometry.dispose();
    this.points.geometry = geo;
    this.morphActive = false;
    this.morphProgress = 0;
    this.transitionSwirl = 0;
    this.uniforms.uMorphProgress.value = 0;
    this.uniforms.uTransitionSwirl.value = 0;
  }

  // -------------------------------------------------------------- 形变

  /** 把当前插值状态快照进 position，再写入新目标，避免中途切换时跳变 */
  private beginMorph(next: ShapeAttributes): void {
    const geo = this.points.geometry;

    if (this.morphActive) this.bakeMorphSnapshot();

    const write = (name: string, data: Float32Array) => {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute;
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    };
    write('aTargetPosition', next.position);
    write('aTargetSize', next.size);
    write('aTargetRole', next.role);
    write('aTargetColorT', next.colorT);
    write('aTargetColorW', next.colorW);
    // 目标形态使用逐顶点色（待机大星系）时才覆写 aColor：
    // 情绪星体的 colorW = 0，aColor 对渲染无影响，可直接当作「目标顶点色」容器
    if (next.colorW.some((w) => w > 0)) write('aColor', next.color);

    this.morphProgress = 0;
    this.morphActive = true;
    this.transitionSwirl = 0;
    this.uniforms.uMorphProgress.value = 0;
    this.uniforms.uTransitionSwirl.value = 0;

    // 声画同步：过渡音效与画面形变同长
    this.audio.transition(MORPH_DURATION);
  }

  /**
   * 中途打断时，把着色器里「错峰插值 + 潮汐旋涡」的结果精确烘焙回当前缓冲。
   * 必须逐粒子复现 localT（延迟 + smoothstep + 三次缓出），否则打断瞬间会跳变。
   * 颜色状态由 aColorT + aColorW 精确承载（vColor = mix(grad(colorT), aColor, colorW)），
   * 烘焙后 aColor 不需逐粒子改写即可保证零闪烁。
   */
  private bakeMorphSnapshot(): void {
    const geo = this.points.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const tpos = geo.getAttribute('aTargetPosition') as THREE.BufferAttribute;
    const rnd = (geo.getAttribute('aRandom') as THREE.BufferAttribute).array as Float32Array;
    const a = pos.array as Float32Array;
    const b = tpos.array as Float32Array;

    const p = this.morphProgress;
    const swirl = this.transitionSwirl;
    const expand = 1 + Math.abs(swirl) * 0.16;
    const n = rnd.length;

    for (let i = 0; i < n; i++) {
      const delay = rnd[i] * MORPH_DELAY_MAX;
      let lt = smoothstep01(delay, delay + MORPH_DELAY_WIDTH, p);
      lt = 1 - Math.pow(1 - lt, 3);

      const i3 = i * 3;
      let x = a[i3] + (b[i3] - a[i3]) * lt;
      let y = a[i3 + 1] + (b[i3 + 1] - a[i3 + 1]) * lt;
      let z = a[i3 + 2] + (b[i3 + 2] - a[i3 + 2]) * lt;

      if (swirl !== 0) {
        const ang = swirl * (1.35 - Math.hypot(x, y, z) * 0.12);
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const nx = c * x + s * z;
        const nz = -s * x + c * z;
        x = nx * expand;
        y *= expand;
        z = nz * expand;
      }

      a[i3] = x;
      a[i3 + 1] = y;
      a[i3 + 2] = z;
    }
    pos.needsUpdate = true;

    const bakeScalar = (curName: string, tgtName: string): void => {
      const cur = geo.getAttribute(curName) as THREE.BufferAttribute;
      const tgt = geo.getAttribute(tgtName) as THREE.BufferAttribute;
      const ca = cur.array as Float32Array;
      const ta = tgt.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const delay = rnd[i] * MORPH_DELAY_MAX;
        let lt = smoothstep01(delay, delay + MORPH_DELAY_WIDTH, p);
        lt = 1 - Math.pow(1 - lt, 3);
        ca[i] = ca[i] + (ta[i] - ca[i]) * lt;
      }
      cur.needsUpdate = true;
    };
    bakeScalar('aSize', 'aTargetSize');
    bakeScalar('aRole', 'aTargetRole');
    bakeScalar('aColorT', 'aTargetColorT');
    bakeScalar('aColorW', 'aTargetColorW');
  }

  /** 过渡结束：把目标缓冲同步回当前缓冲 */
  private finalizeMorph(): void {
    const geo = this.points.geometry;
    const pairs: [string, string][] = [
      ['position', 'aTargetPosition'],
      ['aSize', 'aTargetSize'],
      ['aRole', 'aTargetRole'],
      ['aColorT', 'aTargetColorT'],
      ['aColorW', 'aTargetColorW'],
    ];
    for (const [curName, tgtName] of pairs) {
      const cur = geo.getAttribute(curName) as THREE.BufferAttribute;
      const tgt = geo.getAttribute(tgtName) as THREE.BufferAttribute;
      (cur.array as Float32Array).set(tgt.array as Float32Array);
      cur.needsUpdate = true;
    }
    this.morphActive = false;
    this.morphProgress = 0;
    this.transitionSwirl = 0;
    this.uniforms.uMorphProgress.value = 0;
    this.uniforms.uTransitionSwirl.value = 0;
    // 声画同步：形变落定时给一记轻柔和弦确认音
    this.audio.arrive();
  }

  // -------------------------------------------------------------- 预设

  applyPreset(preset: NebulaPreset, emotion: EmotionVector | null, immediate = false): void {
    const shapeChanged = preset.id !== this.shapeId;
    this.preset = preset;
    this.emotion = emotion;
    this.shapeId = preset.id;

    this.targetColors = preset.colors.map((c) => new THREE.Color(c));
    this.bloomTarget = preset.bloom;
    this.sizeTarget = preset.sizeScale;
    this.coreTarget = preset.core;
    // Bloom 能量涌动：只上浮当前值，目标值不动，随后指数回落到预设值
    if (!immediate) this.bloomKick = Math.min(this.bloomKick + BLOOM_KICK, BLOOM_KICK_MAX);

    // 分形态动态物理（预设基线 × 心情缩放）
    this.motionScale = { turbulence: 1, speed: 1 };
    this.applyBehavior();
    this.shearTarget = preset.shear;

    // 最佳观赏机位（方位角取最短旋转路径，避免相机绕远路）
    let dTheta = preset.camera.theta - this.camTheta;
    dTheta = ((dTheta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.camThetaTarget = this.camTheta + dTheta;
    this.camPhiTarget = preset.camera.phi;
    this.camDistTarget = preset.camera.dist;
    this.userCam = false;

    if (immediate) {
      this.bloomCurrent = this.bloomTarget;
      this.sizeCurrent = this.sizeTarget;
      this.coreCurrent = this.coreTarget;
      // 粒子尺寸：基线 × treble 细节脉动（高频点亮星点），整体体量再随 bass 涨缩
    const sizeGroove = this.sizeCurrent * (1 + this.grooveTreble * 0.22) * (1 + this.grooveBass * 0.12);
    this.uniforms.uSize.value = sizeGroove;
      this.behaviorCurrent.copy(this.behaviorTarget);
      this.shearCurrent = this.shearTarget;
      this.camTheta = this.camThetaTarget;
      this.camPhi = this.camPhiTarget;
      this.camDist = this.camDistTarget;
      this.uniforms.uBehavior.value.copy(this.behaviorCurrent);
      this.uniforms.uShear.value = this.shearCurrent;
    }

    if (shapeChanged) {
      this.beginMorph(buildShape(preset.id, this.count));
    }

    this.container.style.setProperty('--nebula-bg', preset.bg);
  }

  /** 由预设基线 + 心情缩放计算 uBehavior 目标值 */
  private applyBehavior(): void {
    const b = this.preset.behavior;
    this.behaviorTarget.set(
      b.spin * this.motionScale.speed,
      b.pulse,
      b.drift,
      b.turbulence * this.motionScale.turbulence,
    );
  }

  /** 覆盖目标调色板（心情解析生成的连续色） */
  overrideColors(colors: THREE.Color[]): void {
    if (colors.length === 3) {
      this.targetColors = colors;
    }
  }

  /**
   * 效价滑块：mix ∈ [-1,1]，-1 锚定深思/低落配色，1 锚定狂喜/明亮配色。
   * 只在两端调色板间渐变，几何形状保持当前预设不变；传 null 关闭，回到当前预设配色。
   */
  setValenceMix(mix: number | null): void {
    if (mix === null) {
      this.valenceMix = null;
      // 关闭滑块：回到当前预设/解析配色
      this.targetColors = this.preset.colors.map((c) => new THREE.Color(c));
      return;
    }
    this.valenceMix = Math.min(1, Math.max(-1, mix));
    this.applyValenceColors();
  }

  /** 按当前 valenceMix 在两端调色板间插值配色（不触碰任何几何缓冲） */
  private applyValenceColors(): void {
    if (this.valenceMix === null) return;
    const t = (this.valenceMix + 1) / 2; // 0 低落端 → 1 明亮端
    const lowC = PRESET_MAP.melancholy.colors;
    const highC = PRESET_MAP.euphoria.colors;
    this.targetColors = lowC.map((hex, i) => {
      const c0 = new THREE.Color(hex);
      const c1 = new THREE.Color(highC[i]);
      return c0.lerp(c1, t);
    });
  }

  /** 覆盖湍流 / 旋转速度目标值（心情解析结果，相对预设缩放） */
  setMotion(turbulence: number, speed: number): void {
    const p = this.preset;
    this.motionScale = {
      turbulence: turbulence / Math.max(0.001, p.turbulence),
      speed: speed / Math.max(0.001, p.speed),
    };
    this.applyBehavior();
  }

  /** 奇点展开：从中心一点舒展为完整星云 */
  expandFromSingularity(): void {
    this.collapseTarget = 0;
  }

  // -------------------------------------------------------------- 交互

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }
  }

  private onResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.userCam = true;
    this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.008, 5, 24);
    this.camDistTarget = this.camDist;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.pointerDown = true;
    this.moved = false;
    this.dragging = false;
    this.userCam = true; // 用户接管相机
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downTime = performance.now();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (this.collapseTimer !== null) window.clearTimeout(this.collapseTimer);
    this.collapseTimer = window.setTimeout(() => {
      if (!this.moved && this.pointerDown) {
        this.collapsing = true;
        this.collapseTarget = 1;
        this.audio.startRiser();
      }
    }, 240);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const dist = this.camera.position.length();
    this.raycaster.ray.at(dist * 0.9, this.pointerTarget);
    this.pointerTargetStrength = 1;

    if (this.pointerDown) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (!this.moved && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 7) {
        this.moved = true;
        if (this.collapseTimer !== null) {
          window.clearTimeout(this.collapseTimer);
          this.collapseTimer = null;
        }
        if (this.collapsing) {
          this.collapsing = false;
          this.collapseTarget = 0;
          this.audio.stopRiser();
        }
      }
      if (this.moved) {
        this.dragging = true;
        this.velTheta = -dx * 0.0042;
        this.velPhi = -dy * 0.0032;
        this.camTheta += this.velTheta;
        this.camPhi = THREE.MathUtils.clamp(this.camPhi + this.velPhi, 0.35, 2.25);
      }
    }

    const now = performance.now();
    if (now - this.lastHoverSound > 220 && Math.abs(e.movementX) + Math.abs(e.movementY) > 8) {
      this.lastHoverSound = now;
      this.audio.playHover(nx * 0.8);
    }

    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    this.dragging = false;
    if (this.collapseTimer !== null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    const held = performance.now() - this.downTime;

    if (this.collapsing) {
      this.collapsing = false;
      this.collapseTarget = 0;
      this.audio.stopRiser();
      this.triggerSupernova();
    } else if (!this.moved && held < 260) {
      this.audio.playClick((e.clientX / Math.max(1, window.innerWidth)) * 1.6 - 0.8);
      this.triggerBurst(this.pointerTarget, 0.9);
    }
  };

  private onPointerLeave = (): void => {
    this.pointerTargetStrength = 0;
    if (this.pointerDown) {
      this.pointerDown = false;
      this.dragging = false;
      if (this.collapseTimer !== null) {
        window.clearTimeout(this.collapseTimer);
        this.collapseTimer = null;
      }
      if (this.collapsing) {
        this.collapsing = false;
        this.collapseTarget = 0;
        this.audio.stopRiser();
      }
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    const key = e.key.toLowerCase();
    const degree = KEY_DEGREES[key];
    if (degree === undefined) return;

    this.audio.playChime(degree, 1);
    const ang = Math.random() * Math.PI * 2;
    const rad = 1.6 + Math.random() * 4.6;
    this.burstPos.set(Math.cos(ang) * rad, (Math.random() - 0.5) * 1.3, Math.sin(ang) * rad);
    this.burstAmp = 1.7;
  };

  private triggerBurst(pos: THREE.Vector3, power: number): void {
    this.burstPos.copy(pos);
    this.burstAmp = power * 1.4;
  }

  private triggerSupernova(): void {
    this.shockActive = true;
    this.shockT = 0;
    this.burstPos.set(0, 0, 0);
    this.burstAmp = 2.6;
    this.audio.supernova(1);
  }

  // -------------------------------------------------------------- 主循环

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    const t = this.uniforms.uTime.value + dt;
    this.uniforms.uTime.value = t;

    // 音频能量
    const bands = this.audio.getBands(dt);
    this.uniforms.uBass.value = bands.bass;
    this.uniforms.uMid.value = bands.mid;
    this.uniforms.uTreble.value = bands.treble;

    // 视觉参数逐帧指数阻尼（MathUtils.damp 即 1 - exp(-lambda·dt)，帧率无关）
    this.bloomCurrent = THREE.MathUtils.damp(this.bloomCurrent, this.bloomTarget, 3.0, dt);
    this.bloomKick *= Math.exp(-dt * 1.8);
    this.sizeCurrent = THREE.MathUtils.damp(this.sizeCurrent, this.sizeTarget, 3.0, dt);
    this.coreCurrent = THREE.MathUtils.damp(this.coreCurrent, this.coreTarget, 3.0, dt);

    // 频段律动平滑跟随：bass 体量 / mid 转速辉光 / treble 粒子细节
    const grooveK = 1 - Math.exp(-dt * 6.0);
    this.grooveBass += (bands.bass - this.grooveBass) * grooveK;
    this.grooveMid += (bands.mid - this.grooveMid) * grooveK;
    this.grooveTreble += (bands.treble - this.grooveTreble) * grooveK;

    this.uniformColors.forEach((c, idx) => {
      c.lerp(this.targetColors[idx] ?? c, 1 - Math.exp(-3.2 * dt));
    });

    // 分形态动态物理（mid 叠加转速与辉光：中段能量推动旋臂，低落时趋于沉静）
    this.behaviorCurrent.lerp(this.behaviorTarget, 1 - Math.exp(-3.0 * dt));
    this.uniforms.uBehavior.value.copy(this.behaviorCurrent);
    this.uniforms.uBehavior.value.x *= 1 + this.grooveMid * 0.35;
    this.shearCurrent = THREE.MathUtils.damp(this.shearCurrent, this.shearTarget, 3.0, dt);
    this.uniforms.uShear.value = this.shearCurrent;

    // 双缓冲形变推进：错峰波浪 + 潮汐旋涡（中段最强、两端归零）
    if (this.morphActive) {
      this.morphProgress = Math.min(1, this.morphProgress + dt / MORPH_DURATION);
      this.transitionSwirl = SWIRL_AMP * Math.sin(Math.PI * this.morphProgress);
      this.uniforms.uMorphProgress.value = this.morphProgress;
      this.uniforms.uTransitionSwirl.value = this.transitionSwirl;
      if (this.morphProgress >= 1) this.finalizeMorph();
    } else if (this.transitionSwirl !== 0) {
      this.transitionSwirl = 0;
      this.uniforms.uTransitionSwirl.value = 0;
    }

    // 指针
    this.pointerCurrent.lerp(this.pointerTarget, 1 - Math.exp(-dt * 10));
    this.pointerStrength += (this.pointerTargetStrength - this.pointerStrength) * (1 - Math.exp(-dt * 8));
    this.uniforms.uPointerStrength.value = this.pointerStrength;

    // 坍缩
    const ck = 1 - Math.exp(-dt * (this.collapseTarget > this.collapse ? 7 : 2.6));
    this.collapse += (this.collapseTarget - this.collapse) * ck;
    this.uniforms.uCollapse.value = this.collapse;

    // 超新星冲击波
    if (this.shockActive) {
      this.shockT += dt;
      const radius = this.shockT * 11;
      const amp = Math.exp(-this.shockT * 2.1) * 1.5;
      this.uniforms.uShockRadius.value = radius;
      this.uniforms.uShockAmp.value = amp;
      if (this.shockT > 3) {
        this.shockActive = false;
        this.uniforms.uShockAmp.value = 0;
      }
    }

    // 星簇爆发衰减
    this.burstAmp *= Math.exp(-dt * 5.5);
    this.uniforms.uBurstAmp.value = this.burstAmp;

    // 相机：用户拖拽时立即让出控制权，否则平滑过渡到形态最佳机位
    if (!this.dragging) {
      this.camTheta += this.velTheta;
      this.camPhi = THREE.MathUtils.clamp(this.camPhi + this.velPhi, 0.35, 2.25);
      this.velTheta *= 0.92;
      this.velPhi *= 0.92;
    }
    if (!this.userCam) {
      this.camThetaTarget += dt * 0.022; // 缓慢环绕，保持画面生命感
      // 星际潜入：待机全景 [0, 1.8, 9.2] → 星体特写，λ=1.6 的指数阻尼与 2.8s 形变同长
      this.camTheta = THREE.MathUtils.damp(this.camTheta, this.camThetaTarget, CAM_DAMP, dt);
      this.camPhi = THREE.MathUtils.damp(this.camPhi, this.camPhiTarget, CAM_DAMP, dt);
      this.camDist = THREE.MathUtils.damp(this.camDist, this.camDistTarget, CAM_DAMP, dt);
    }
    const r = this.camDist;
    this.camera.position.set(
      Math.sin(this.camPhi) * Math.cos(this.camTheta) * r,
      Math.cos(this.camPhi) * r,
      Math.sin(this.camPhi) * Math.sin(this.camTheta) * r,
    );
    this.camera.lookAt(0, 0, 0);

    // 背景星野：缓慢微旋 + 错相位闪烁；整体明度随 bass 呼吸，低落时压暗
    this.starfield.rotation.y += dt * 0.004;
    this.starMaterial.uniforms.uTime.value = t;
    const starDim = 0.62 + this.grooveBass * 0.38;
    (this.starfield.material as THREE.ShaderMaterial).opacity = starDim;

    // 核心辉光随低频呼吸（强度按形态：黑洞视界需保持绝对空心）
    const coreMat = this.coreSprite.material as THREE.SpriteMaterial;
    const coreK = this.coreCurrent;
    this.coreSprite.scale.setScalar((1.0 + bands.bass * 0.6) * (0.3 + coreK * 0.8));
    coreMat.opacity = (0.08 + bands.bass * 0.12) * coreK;
    coreMat.color.copy(this.uniformColors[0]);

    // Bloom：bass 托起辉光体量，mid 拓宽辉光范围；整体高潮涨起、低落沉下减光
    const lift = this.grooveBass * 0.55 + this.grooveMid * 0.3;
    this.bloom.strength = this.bloomCurrent * 0.92 + lift + this.bloomKick;

    // 整体体量：bass 高涨时星云向外涨起，低落时向内收拢（沿相机距离方向缩放粒子群）
    const bodyScale = 1 + this.grooveBass * 0.1 - (1 - this.grooveBass) * 0.04;
    this.points.scale.setScalar(bodyScale);
    this.coreSprite.scale.multiplyScalar(bodyScale);

    // 帧率监控：低帧率自动降级
    this.warmup += dt;
    this.fpsAccum += rawDt;
    this.fpsFrames += 1;
    this.fpsGapMax = Math.max(this.fpsGapMax, rawDt);
    if (this.fpsAccum >= 1) {
      const fps = Math.round(this.fpsFrames / this.fpsAccum);
      // 标签页被节流 / 截图停顿时不算数：显示沿用上一次的稳定值，也不参与降级判定
      const throttled = this.fpsGapMax > 0.2;
      if (!throttled) this.lastFps = fps;
      this.onStats?.({ fps: this.lastFps, count: this.count });
      // 调试快照（DOM 可读，便于自动化验收）
      this.container.dataset.debug = JSON.stringify({
        id: this.preset.id,
        cam: [+this.camTheta.toFixed(2), +this.camPhi.toFixed(2), +this.camDist.toFixed(2)],
        userCam: this.userCam,
        morph: this.morphActive,
        prog: +this.morphProgress.toFixed(2),
        count: this.count,
        fps: this.lastFps,
        gap: +this.fpsGapMax.toFixed(3),
        throttled,
        burst: +this.burstAmp.toFixed(2),
        collapse: +this.collapse.toFixed(2),
        shock: this.shockActive,
      });
      this.lowFpsStreak = !throttled && fps < 42 ? this.lowFpsStreak + 1 : 0;
      // 形变进行中不降级：重建几何会把粒子直接瞬移到目标形态，等落定后再降
      if (
        this.warmup > 3 &&
        this.lowFpsStreak >= 3 &&
        this.count > 8000 &&
        !this.morphActive &&
        !this.downgraded
      ) {
        this.downgraded = true;
        this.applyCount(8000);
      }
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.fpsGapMax = 0;
    }

    this.composer.render();
  };

  // -------------------------------------------------------------- 导出

  capture(): string | null {
    try {
      this.composer.render();
      return this.renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    if (this.collapseTimer !== null) window.clearTimeout(this.collapseTimer);
    this.resizeObserver?.disconnect();
    this.points.geometry.dispose();
    this.starfield.geometry.dispose();
    this.starMaterial.dispose();
    this.material.dispose();
    this.coreSprite.material.dispose();
    this.texture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}

export const NebulaCanvas = forwardRef<NebulaCanvasHandle, Props>(function NebulaCanvas(
  { preset, emotion, palette, turbulence, speed, valence, onStats },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<NebulaEngine | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const engine = new NebulaEngine(el, preset, emotion, (s) => onStatsRef.current?.(s));
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!engineRef.current) return;
    const engine = engineRef.current;
    engine.setValenceMix(valence);
  }, [valence]);

  useEffect(() => {
    if (!engineRef.current) return;
    const engine = engineRef.current;
    engine.applyPreset(preset, emotion);
    if (palette) {
      const targets = palette.map((c) => new THREE.Color(c));
      engine.overrideColors(targets);
    }
    engine.setMotion(turbulence, speed);
  }, [preset, emotion, palette, turbulence, speed]);

  useImperativeHandle(
    ref,
    () => ({
      capture: () => engineRef.current?.capture() ?? null,
      expand: () => engineRef.current?.expandFromSingularity(),
    }),
    [],
  );

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      style={{ touchAction: 'none', userSelect: 'none' }}
      aria-label="星云 3D 交互画布"
    />
  );
});
