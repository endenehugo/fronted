import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { nebulaFragmentShader, nebulaVertexShader } from './nebulaShaders';
import type { EmotionVector, NebulaPreset } from '../types';
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

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

class NebulaEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private points: THREE.Points;
  private coreSprite: THREE.Sprite;
  private material: THREE.ShaderMaterial;
  private uniforms: Record<string, THREE.IUniform>;
  private texture: THREE.CanvasTexture;
  private raycaster = new THREE.Raycaster();

  private preset: NebulaPreset;
  private emotion: EmotionVector | null;

  private raf = 0;
  private clock = new THREE.Clock();
  private disposed = false;
  private started = false;

  private count: number;
  private downgraded = false;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private warmup = 0;

  private targetColors: THREE.Color[] = [];
  private currentColors: THREE.Color[] = [];
  private uniformColors: THREE.Color[] = [];

  private target = { turbulence: 1, speed: 1, bloom: 1 };
  private current = { turbulence: 1, speed: 1, bloom: 1 };

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

  private camTheta = 0.4;
  private camPhi = 1.0;
  private camDist = 13.2;
  private velTheta = 0;
  private velPhi = 0;

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

    this.uniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uTurbulence: { value: 1 },
      uSpeed: { value: 1 },
      uSpin: { value: preset.spin },
      uTwist: { value: preset.twist },
      uCollapse: { value: 1 },
      uShockRadius: { value: 0 },
      uShockAmp: { value: 0 },
      uPointer: { value: this.pointerCurrent },
      uPointerStrength: { value: 0 },
      uBurstPos: { value: this.burstPos },
      uBurstAmp: { value: 0 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uSize: { value: preset.sizeScale },
      uColors: { value: [new THREE.Color('#ffffff'), new THREE.Color('#00b4d8'), new THREE.Color('#03045e')] },
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

    this.points = new THREE.Points(this.buildGeometry(this.count), this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // 核心辉光：大尺寸软光斑，避免核心被成千上万个点叠加成死白
    this.coreSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texture,
        color: new THREE.Color(preset.colors[0]),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.coreSprite.scale.set(2.4, 2.4, 1);
    this.scene.add(this.coreSprite);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.1, 0.75, 0.12);
    this.composer.addPass(this.bloom);

    this.applyPreset(preset, emotion, true);
    this.bindEvents();
    this.loop();
  }

  // -------------------------------------------------------------- 几何

  private buildGeometry(count: number): THREE.BufferGeometry {
    const nCore = Math.floor(count * 0.2);
    const nArm = Math.floor(count * 0.6);
    const nHalo = count - nCore - nArm;
    const arms = 4;

    const position = new Float32Array(count * 3);
    const type = new Float32Array(count);
    const radius = new Float32Array(count);
    const theta = new Float32Array(count);
    const y = new Float32Array(count);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    let i = 0;

    // 核心恒星区（12%）：高密度、高亮度中心核，径向呈长尾衰减
    for (let k = 0; k < nCore; k++, i++) {
      const r = 0.1 + Math.pow(Math.random(), 1.5) * 2.4;
      radius[i] = r;
      theta[i] = Math.random() * Math.PI * 2;
      y[i] = gauss() * 0.13 * (1.15 - r * 0.18);
      size[i] = 0.3 + Math.random() * 0.62;
      type[i] = 0;
      seed[i] = Math.random();
    }

    // 对数螺旋旋臂（72%）：紧贴臂线分布，保留气体褶皱
    for (let k = 0; k < nArm; k++, i++) {
      const u = Math.pow(Math.random(), 0.62);
      const r = 1.0 + u * 6.4;
      const armIdx = k % arms;
      const th = armIdx * ((Math.PI * 2) / arms) + gauss() * (0.07 + (1 - u) * 0.22);
      radius[i] = r;
      theta[i] = th;
      y[i] = gauss() * (0.10 + r * 0.055);
      size[i] = 1.25 + Math.random() * 1.75;
      type[i] = 1;
      seed[i] = Math.random();
    }

    // 外围星尘晕（16%）：大尺寸低透明度弥散粒子
    for (let k = 0; k < nHalo; k++, i++) {
      const r = 3.8 + Math.pow(Math.random(), 0.6) * 8.0;
      radius[i] = r;
      theta[i] = Math.random() * Math.PI * 2;
      y[i] = gauss() * 2.4;
      size[i] = 4.0 + Math.random() * 4.2;
      type[i] = 2;
      seed[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('aType', new THREE.BufferAttribute(type, 1));
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
    geo.setAttribute('aTheta', new THREE.BufferAttribute(theta, 1));
    geo.setAttribute('aY', new THREE.BufferAttribute(y, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    return geo;
  }

  private applyCount(n: number): void {
    this.count = n;
    const geo = this.buildGeometry(n);
    this.points.geometry.dispose();
    this.points.geometry = geo;
  }

  // -------------------------------------------------------------- 预设

  applyPreset(preset: NebulaPreset, emotion: EmotionVector | null, immediate = false): void {
    this.preset = preset;
    this.emotion = emotion;

    this.targetColors = preset.colors.map((c) => new THREE.Color(c));
    this.target.turbulence = preset.turbulence;
    this.target.speed = preset.speed;
    this.target.bloom = preset.bloom;

    this.uniforms.uSpin.value = preset.spin;
    this.uniforms.uTwist.value = preset.twist;
    this.uniforms.uSize.value = preset.sizeScale;

    if (immediate) {
      this.currentColors = this.targetColors.map((c) => c.clone());
      this.current = { ...this.target };
      this.uniformColors.forEach((c, idx) => c.copy(this.currentColors[idx]));
      this.uniforms.uTurbulence.value = this.current.turbulence;
      this.uniforms.uSpeed.value = this.current.speed;
    }

    this.container.style.setProperty('--nebula-bg', preset.bg);
  }

  /** 覆盖目标调色板（心情解析生成的连续色） */
  overrideColors(colors: THREE.Color[]): void {
    if (colors.length === 3) {
      this.targetColors = colors;
    }
  }

  /** 覆盖湍流 / 旋转速度目标值 */
  setMotion(turbulence: number, speed: number): void {
    this.target.turbulence = turbulence;
    this.target.speed = speed;
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
    this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.008, 6.5, 22);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.pointerDown = true;
    this.moved = false;
    this.dragging = false;
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

    // 悬停轻微高频泛音（节流）
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

    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.uniforms.uTime.value + dt;
    this.uniforms.uTime.value = t;

    if (!this.started) {
      this.started = true;
      this.clock.getDelta();
    }

    // 音频能量
    const bands = this.audio.getBands(dt);
    this.uniforms.uBass.value = bands.bass;
    this.uniforms.uMid.value = bands.mid;
    this.uniforms.uTreble.value = bands.treble;

    // 参数插值（约 1.5s 完成）
    const k = 1 - Math.exp(-dt * 2.7);
    this.current.turbulence += (this.target.turbulence - this.current.turbulence) * k;
    this.current.speed += (this.target.speed - this.current.speed) * k;
    this.current.bloom += (this.target.bloom - this.current.bloom) * k;
    this.uniforms.uTurbulence.value = this.current.turbulence;
    this.uniforms.uSpeed.value = this.current.speed;

    this.uniformColors.forEach((c, idx) => {
      c.lerp(this.targetColors[idx] ?? c, k);
    });

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

    // 相机：拖拽惯性 + 缓慢自转
    if (!this.dragging) {
      this.camTheta += this.velTheta;
      this.camPhi = THREE.MathUtils.clamp(this.camPhi + this.velPhi, 0.35, 2.25);
      this.velTheta *= 0.92;
      this.velPhi *= 0.92;
      this.camTheta += dt * 0.022;
    }
    const r = this.camDist;
    this.camera.position.set(
      Math.sin(this.camPhi) * Math.cos(this.camTheta) * r,
      Math.cos(this.camPhi) * r,
      Math.sin(this.camPhi) * Math.sin(this.camTheta) * r,
    );
    this.camera.lookAt(0, 0, 0);

    // 核心辉光随低频呼吸
    const coreMat = this.coreSprite.material as THREE.SpriteMaterial;
    this.coreSprite.scale.setScalar(1.6 + bands.bass * 0.8);
    coreMat.opacity = 0.13 + bands.bass * 0.17;
    coreMat.color.copy(this.uniformColors[0]);

    // Bloom 随低频脉动
    this.bloom.strength = this.current.bloom * 0.92 + bands.bass * 0.95;

    // 帧率监控：低帧率自动降级
    this.warmup += dt;
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 1) {
      const fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.onStats?.({ fps, count: this.count });
      if (this.warmup > 3 && fps < 42 && this.count > 8000 && !this.downgraded) {
        this.downgraded = true;
        this.applyCount(8000);
      }
      this.fpsAccum = 0;
      this.fpsFrames = 0;
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
    this.material.dispose();
    this.coreSprite.material.dispose();
    this.texture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}

export const NebulaCanvas = forwardRef<NebulaCanvasHandle, Props>(function NebulaCanvas(
  { preset, emotion, palette, turbulence, speed, onStats },
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
    engine.applyPreset(preset, emotion);
    if (palette) {
      // 自定义心情调色板：在预设之上叠加连续插值
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
