import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  cloudFragmentShader,
  cloudVertexShader,
  constellationFragmentShader,
  constellationVertexShader,
  FilmShader,
  MORPH_DELAY_MAX,
  MORPH_DELAY_WIDTH,
  MORPH_DURATION,
  nebulaFragmentShader,
  nebulaVertexShader,
  starfieldFragmentShader,
  starfieldVertexShader,
  VignetteShader,
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
  /** 星图模式：所有星座连线一起显现（键盘 C 或底部按钮切换） */
  starchart: boolean;
  onToggleStarchart?: () => void;
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

/**
 * 潮汐呼吸慢包络 uEnergy 的阻尼系数：上升 ≈0.5s、回落 ≈1.8s 收敛到 95%
 * （damp(x, target, λ, dt) = 1 − exp(−λ·dt)，95% 对应 t = 3/λ）
 */
const ENERGY_DAMP_RISE = 6;
const ENERGY_DAMP_FALL = 1.7;
/** 音频未就绪时的包络基线：画面保持中低位的静息呼吸，而非压到最暗 */
const ENERGY_IDLE = 0.35;

/**
 * 自转角速度的潮汐因子：ω = spin × (SPIN_BASE + energy × SPIN_ENERGY + mid × SPIN_MID)。
 * 待机包络 0.35 时约 0.49，潮汐高潮约 0.95 → 高低潮之间约 2 倍速差，整体保持缓慢漂移。
 */
const SPIN_BASE = 0.25;
const SPIN_ENERGY = 0.5;
const SPIN_MID = 0.25;

/** 背景星野恒星数（桌面 / 移动） */
const STARFIELD_COUNT = { desktop: 3500, mobile: 2000 };

/** 云气层平面到相机的距离（挂在相机下，随朝向一起转，只负责铺底氛围） */
const CLOUD_DIST = 80;
/** 云气层淡入淡出的阻尼系数：待机 M31 是盘状星系，加云气会糊掉尘埃带，所以按预设淡出 */
const CLOUD_DAMP = 1.4;

/** 星座恒星所在球壳半径（与主星群同层，避免相机推拉时和星野错位） */
const CONSTELLATION_RADIUS = 54;
/** 星座连线宽度（CSS px；实际按 DPR 换算成设备像素） */
const CONSTELLATION_WIDTH_PX = 2.6;
/** 星图模式 / 其余 两档透明度：平时完全不显示连线，只有开星图才出现 */
const CONST_ALPHA_CHART = 0.34;
const CONST_ALPHA_ACTIVE_BONUS = 0.16;
const CONST_ALPHA_IDLE = 0;

interface ConstellationStar {
  /** 赤经（小时） */
  ra: number;
  /** 赤纬（度） */
  dec: number;
  /** 视星等 */
  mag: number;
}

interface ConstellationDef {
  id: string;
  name: string;
  /** 连线用的暖白色温，几组之间略有差异，方便分辨 */
  tint: [number, number, number];
  stars: ConstellationStar[];
  /** 星表下标对，构成星座轮廓 */
  edges: [number, number][];
}

/**
 * 8 个高辨识度星座，用真实赤经 / 赤纬铺在天球上（允许一两度误差，形状对即可）。
 * 只收录肉眼可见的主星（mag 1~3），这样连线端点就是天上最亮的那几颗，
 * 和程序化生成的暗星背景自然分层 —— 真实夜空本来就是"少数亮星 + 大量暗星"。
 */
const CONSTELLATIONS: ConstellationDef[] = [
  {
    id: 'dipper',
    name: '北斗七星',
    tint: [1.0, 0.94, 0.82],
    stars: [
      { ra: 11.062, dec: 61.75, mag: 1.79 }, // 天枢
      { ra: 11.031, dec: 56.38, mag: 2.37 }, // 天璇
      { ra: 11.897, dec: 53.69, mag: 2.44 }, // 天玑
      { ra: 12.257, dec: 57.03, mag: 3.31 }, // 天权
      { ra: 12.900, dec: 55.96, mag: 1.77 }, // 玉衡
      { ra: 13.399, dec: 54.93, mag: 2.23 }, // 开阳
      { ra: 13.792, dec: 49.31, mag: 1.86 }, // 摇光
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
  },
  {
    id: 'orion',
    name: '猎户座',
    tint: [0.86, 0.92, 1.0],
    stars: [
      { ra: 5.919, dec: 7.41, mag: 0.42 }, // 参宿四
      { ra: 5.418, dec: 6.35, mag: 1.64 }, // 参宿五
      { ra: 5.679, dec: -1.94, mag: 1.77 }, // 参宿一
      { ra: 5.604, dec: -1.2, mag: 1.69 }, // 参宿二
      { ra: 5.533, dec: -0.3, mag: 2.25 }, // 参宿三
      { ra: 5.796, dec: -9.67, mag: 2.06 }, // 参宿六
      { ra: 5.242, dec: -8.2, mag: 0.18 }, // 参宿七
    ],
    edges: [
      [0, 1],
      [1, 4],
      [4, 3],
      [3, 2],
      [2, 0],
      [2, 5],
      [5, 6],
      [6, 4],
    ],
  },
  {
    id: 'cassiopeia',
    name: '仙后座',
    tint: [0.94, 0.9, 1.0],
    stars: [
      { ra: 0.153, dec: 59.15, mag: 2.27 }, // 王良一
      { ra: 0.675, dec: 56.54, mag: 2.24 }, // 王良四
      { ra: 0.945, dec: 60.72, mag: 2.15 }, // 策
      { ra: 1.43, dec: 60.24, mag: 2.68 }, // 阁道三
      { ra: 1.906, dec: 63.67, mag: 3.35 }, // 阁道二
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },
  {
    id: 'cygnus',
    name: '天鹅座',
    tint: [0.9, 0.95, 1.0],
    stars: [
      { ra: 20.69, dec: 45.28, mag: 1.25 }, // 天津四
      { ra: 20.37, dec: 40.26, mag: 2.23 }, // 天津一
      { ra: 20.77, dec: 33.97, mag: 2.46 }, // 天津九
      { ra: 19.75, dec: 45.13, mag: 2.86 }, // 天津二
      { ra: 19.512, dec: 27.96, mag: 3.05 }, // 辇道增七
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ],
  },
  {
    id: 'lyra',
    name: '天琴座',
    tint: [0.88, 0.96, 1.0],
    stars: [
      { ra: 18.615, dec: 38.78, mag: 0.03 }, // 织女一
      { ra: 18.834, dec: 33.36, mag: 3.52 }, // 渐台二
      { ra: 18.982, dec: 32.69, mag: 3.25 }, // 渐台三
      { ra: 18.908, dec: 36.9, mag: 4.3 },
      { ra: 18.747, dec: 37.6, mag: 4.36 },
    ],
    edges: [
      [0, 4],
      [4, 3],
      [3, 2],
      [2, 1],
      [1, 4],
    ],
  },
  {
    id: 'scorpius',
    name: '天蝎座',
    tint: [1.0, 0.86, 0.8],
    stars: [
      { ra: 16.49, dec: -26.43, mag: 1.06 }, // 心宿二
      { ra: 16.005, dec: -22.62, mag: 2.29 }, // 房宿三
      { ra: 16.09, dec: -19.81, mag: 2.56 }, // 房宿四
      { ra: 16.836, dec: -34.29, mag: 2.29 },
      { ra: 17.622, dec: -42.99, mag: 1.86 }, // 尾宿五
      { ra: 17.56, dec: -37.1, mag: 1.62 }, // 尾宿八
      { ra: 17.513, dec: -37.3, mag: 2.69 }, // 尾宿九
    ],
    edges: [
      [2, 1],
      [1, 0],
      [0, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ],
  },
  {
    id: 'taurus',
    name: '金牛座',
    tint: [1.0, 0.9, 0.76],
    stars: [
      { ra: 4.599, dec: 16.51, mag: 0.87 }, // 毕宿五
      { ra: 5.438, dec: 28.61, mag: 1.65 }, // 五车五
      { ra: 3.791, dec: 24.11, mag: 2.87 }, // 昴宿六
      { ra: 4.477, dec: 15.87, mag: 3.4 },
      { ra: 4.477, dec: 19.18, mag: 3.53 },
      { ra: 5.627, dec: 21.14, mag: 3.0 },
    ],
    edges: [
      [2, 0],
      [0, 3],
      [3, 4],
      [4, 1],
      [1, 5],
      [5, 0],
    ],
  },
  {
    id: 'andromeda',
    name: '仙女座',
    tint: [0.92, 0.94, 1.0],
    stars: [
      { ra: 0.14, dec: 29.09, mag: 2.06 }, // 壁宿二
      { ra: 1.162, dec: 35.62, mag: 2.06 }, // 奎宿九
      { ra: 2.065, dec: 42.33, mag: 2.26 }, // 天大将军一
      { ra: 0.655, dec: 30.86, mag: 3.27 },
      { ra: 0.947, dec: 38.5, mag: 3.87 },
    ],
    edges: [
      [0, 3],
      [3, 1],
      [1, 2],
      [1, 4],
      [4, 0],
    ],
  },
];

/** 星图模式下，当前情绪对应星座的连线透明度 */
const constActiveAlpha = (): number => CONST_ALPHA_CHART + CONST_ALPHA_ACTIVE_BONUS;

/** 情绪星体 ⇄ 星座 的对应关系（星图模式下，当前星体对应的星座连线更亮一档） */
const PRESET_CONSTELLATION: Record<string, string> = {
  galaxy_idle: 'andromeda',
  serenity: 'orion',
  euphoria: 'scorpius',
  melancholy: 'cygnus',
  focus: 'cassiopeia',
  catharsis: 'taurus',
  healing: 'lyra',
};

/** 赤经（小时）/ 赤纬（度）→ 天球直角坐标（Y 轴为北天极，与相机绕 Y 轴环绕一致） */
function raDecToVec3(ra: number, dec: number, radius: number): THREE.Vector3 {
  const a = (ra * 15 * Math.PI) / 180;
  const d = (dec * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(d) * Math.cos(a) * radius,
    Math.sin(d) * radius,
    Math.cos(d) * Math.sin(a) * radius,
  );
}

/** 星等 → 相对亮度（mag 1 ≈ 1.0，mag 3 ≈ 0.16），再做下限压缩避免暗星消失 */
function magToBrightness(mag: number): number {
  return Math.min(1.15, Math.max(0.22, 0.32 + 0.8 * Math.pow(10, -0.4 * (mag - 1.6))));
}

/** 星等 → 点尺寸（mag 1 ≈ 9，mag 4 ≈ 4；mag 0 的一等星封顶在 11，避免点成大光球） */
function magToSize(mag: number): number {
  return Math.min(11, 2.2 + 6.6 * Math.pow(10, -0.4 * (mag - 1.6)));
}

/**
 * 生成一张白字透明底的文字纹理（中文用系统字体，零字体依赖、零网络请求）。
 * 先画一圈柔光再写字，深空背景下才读得清。
 */
function createLabelTexture(text: string): { texture: THREE.Texture; aspect: number } {
  const dpr = 2;
  const fontSize = 60;
  const padX = 26;
  const padY = 20;
  const probe = document.createElement('canvas').getContext('2d');
  let textW = 240;
  if (probe) {
    probe.font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    textW = Math.ceil(probe.measureText(text).width);
  }
  const cw = Math.max(80, textW + padX * 2);
  const ch = fontSize + padY * 2;

  const canvas = document.createElement('canvas');
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const g = canvas.getContext('2d');
  if (!g) {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return { texture: tex, aspect: 1 };
  }
  g.scale(dpr, dpr);
  g.font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(170, 205, 255, 0.9)';
  g.shadowBlur = 16;
  g.fillStyle = '#FFFFFF';
  g.fillText(text, cw / 2, ch / 2);
  g.shadowBlur = 0;
  g.fillText(text, cw / 2, ch / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, aspect: cw / ch };
}

/** 切换预设瞬间的 Bloom 能量涌动：上浮量与连点封顶（防叠加爆白） */
const BLOOM_KICK = 0.15;
const BLOOM_KICK_MAX = 0.3;

/** 全局曝光总开关：ACES 之后中间调的亮度基本由它决定，调这一个数即可整体提亮/压暗 */
const EXPOSURE = 1.35;
/** 粒子视觉尺寸的整体倍率（撑开点面积，减少暗区空隙感） */
const PARTICLE_SIZE_BOOST = 1.12;

/** 与 GLSL smoothstep 等价，供 CPU 中断烘焙复现着色器里的错峰插值 */
const smoothstep01 = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 配色滑块紫端的相对亮度下限（相对金端）：滑块只换颜色，两端亮度基本一致且都保持明亮 */
const SPECTRUM_BRIGHTNESS = 0.8;

/** 相对亮度（THREE.Color 的分量已处于线性工作空间，直接加权即可） */
const relLuminance = (c: THREE.Color): number =>
  0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

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

/**
 * 周期性 FBM 噪声贴图（一次性 CPU 生成，256²，约 20~30 ms）。
 *
 * 每个八度都在「整数周期格点」上做值噪声（哈希时对格点取模），因此贴图在 UV 上是无缝平铺的 ——
 * 云气层靠两层反向漂移制造流动感，只要贴图可平铺就不会看到接缝或重复边界。
 * 用 Math.imul 做整数哈希（不用 Math.sin），比 sin 式哈希快一个量级。
 */
function createCloudTexture(size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) {
    const fallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    fallback.needsUpdate = true;
    return fallback;
  }

  const hash = (x: number, y: number): number => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  /** 周期 = period 的格点值噪声（period 为整数才能首尾相接） */
  const periodic = (x: number, y: number, period: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const wrap = (n: number): number => ((n % period) + period) % period;
    const x0 = wrap(xi);
    const x1 = wrap(xi + 1);
    const y0 = wrap(yi);
    const y1 = wrap(yi + 1);
    const a = hash(x0, y0);
    const b = hash(x1, y0);
    const cc = hash(x0, y1);
    const d = hash(x1, y1);
    return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
  };

  const img = g.createImageData(size, size);
  const octaves = [3, 6, 12, 24];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let n = 0;
      let amp = 0.5;
      let sum = 0;
      for (const f of octaves) {
        n += periodic(u * f, v * f, f) * amp;
        sum += amp;
        amp *= 0.5;
      }
      n /= sum;
      const val = Math.max(0, Math.min(255, Math.round(Math.pow(n, 1.15) * 255)));
      const idx = (y * size + x) * 4;
      img.data[idx] = val;
      img.data[idx + 1] = val;
      img.data[idx + 2] = val;
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

class NebulaEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private vignette: ShaderPass;
  private points: THREE.Points;
  /** 深空背景星野（常驻图层，不参与形变） */
  private starfield!: THREE.Points;
  private starMaterial!: THREE.ShaderMaterial;
  /** 天球分组：星野 + 星座连线共用一个自转，保证线始终贴着星点 */
  private sky!: THREE.Group;
  /** 星座连线（每条边 4 顶点拼成的细带） */
  private constellationMesh!: THREE.Mesh;
  private constellationMaterial!: THREE.ShaderMaterial;
  /** 星座中文名标签（文字纹理 Sprite，随天球一起转，也能被明信片截到） */
  private labels: THREE.Sprite[] = [];
  /** 每个星座当前透明度（CPU 逐帧写回 aAlpha） */
  private constAlpha: number[] = [];
  /** 描线进度 0~1：切星体 / 切星图模式时重新"画"一遍 */
  private constDraw = 1;
  private starchart = false;
  /** 背景云气层：单位平面挂在相机下，铺底氛围；待机 M31 时淡出 */
  private cloud!: THREE.Mesh;
  private cloudMaterial!: THREE.ShaderMaterial;
  private cloudTexture!: THREE.Texture;
  private cloudOpacity = 0;
  private cloudTarget = 0;
  /** 胶片层：颗粒 + 边缘色差 + 超新星径向冲击（最后一个 pass） */
  private film!: ShaderPass;
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

  /** 潮汐呼吸慢包络：目标由 总 RMS × 旋律潮汐 合成，上升 / 回落用不同 λ 阻尼 */
  private energyCurrent = ENERGY_IDLE;
  /** 自转积分角（弧度）：逐帧累加，保证角速度变化时不产生转角跳变 */
  private spinPhase = 0;

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

  // 配色滑块：只改色相/饱和度、不动几何与明暗；mix ∈ [-1,1]，null = 未启用，跟随预设/解析配色
  private valenceMix: number | null = null;
  /** 配色锁定源：'preset' 跟随预设/解析，'valence' 被滑块手动锁定 */
  private colorSource: 'preset' | 'valence' = 'preset';

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
  private onToggleStarchart?: () => void;

  constructor(
    container: HTMLElement,
    preset: NebulaPreset,
    emotion: EmotionVector | null,
    onStats?: (s: NebulaStats) => void,
    starchart = false,
    onToggleStarchart?: () => void,
  ) {
    this.container = container;
    this.preset = preset;
    this.emotion = emotion;
    this.onStats = onStats;
    this.starchart = starchart;
    this.onToggleStarchart = onToggleStarchart;
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
    // 色调映射：粒子是加色混合的高动态范围画面，没有 tonemap 时高光直接剪成纯白、
    // 中间调挤在暗部 —— 这是"整体很暗"的一半原因（另一半是缺 OutputPass 的 sRGB 编码）。
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
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
      uEnergy: { value: ENERGY_IDLE },
      uSpinPhase: { value: 0 },
      uCollapse: { value: 1 },
      uShockRadius: { value: 0 },
      uShockAmp: { value: 0 },
      uPointer: { value: this.pointerCurrent },
      uPointerStrength: { value: 0 },
      uBurstPos: { value: this.burstPos },
      uBurstAmp: { value: 0 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uViewHeight: { value: h },
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

    this.sky = new THREE.Group();
    this.scene.add(this.sky);
    this.buildStarfield();
    this.buildConstellations();
    this.buildConstellationLabels();
    this.buildCloud();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.0, 0.62, 0.3);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.uAspect.value = w / h;
    this.composer.addPass(this.vignette);
    // 色彩管线终点：ACES 色调映射 + sRGB 编码。缺这一步，composer 里的线性色值会被当成
    // sRGB 直接上屏 —— 设计稿里的配色显示不出来、暗部更暗、亮部剪白。
    this.composer.addPass(new OutputPass());
    // 胶片层放在 OutputPass 之后：颗粒与色差作用在最终显示值上，暗部不再被撒噪
    this.film = new ShaderPass(FilmShader);
    this.film.uniforms.uAspect.value = w / h;
    this.composer.addPass(this.film);

    this.applyPreset(preset, emotion, true);
    this.bindEvents();
    this.loop();
  }

  // -------------------------------------------------------------- 几何

  /**
   * 独立背景星野：两层球壳。内层 35~65 主星群（冷白/淡蓝/暖黄），外层 70~110 更远更暗的背景星；
   * 少量亮星加大并带彩色色温（蓝/金/红）。只用一份轻量着色器闪烁，主循环整体缓慢微旋。
   */
  private buildStarfield(): void {
    const n = isMobileDevice() ? STARFIELD_COUNT.mobile : STARFIELD_COUNT.desktop;
    const outer = Math.floor(n * 0.42); // 外层暗星（略减，把预算让给亮星与星座）
    const band = Math.floor(n * 0.6); // 银河带附加恒星
    const constCount = CONSTELLATIONS.reduce((acc, c) => acc + c.stars.length, 0);
    const total = n + outer + band + constCount;
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const size = new Float32Array(total);
    const seed = new Float32Array(total);
    const shape = new Float32Array(total);
    const tints: [number, number, number][] = [
      [0.82, 0.88, 1.0], // 冷白
      [0.66, 0.78, 1.0], // 淡蓝
      [1.0, 0.88, 0.68], // 暖黄
      [1, 1, 1],
    ];
    // 少量彩色亮星色温
    const brightTints: [number, number, number][] = [
      [0.62, 0.74, 1.0], // 蓝
      [1.0, 0.86, 0.5], // 金
      [1.0, 0.55, 0.5], // 红
    ];
    const place = (i: number, rMin: number, rMax: number, dim: boolean): void => {
      const u = Math.random() * 2 - 1;
      const ph = Math.random() * Math.PI * 2;
      const r = Math.cbrt(rMin ** 3 + Math.random() * (rMax ** 3 - rMin ** 3));
      const st = Math.sqrt(1 - u * u);
      pos[i * 3] = r * st * Math.cos(ph);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * st * Math.sin(ph);
      const bright = !dim && Math.random() < 0.16;
      const t = bright
        ? brightTints[Math.floor(Math.random() * brightTints.length)]
        : tints[Math.floor(Math.random() * tints.length)];
      // 三档亮度：暗背景星 / 普通星 / 亮星（亮星会越过 bloom 阈值形成明显光晕）
      const b = bright
        ? 0.88 + Math.random() * 0.42
        : dim
          ? 0.14 + Math.random() * 0.16
          : 0.5 + Math.random() * 0.32;
      col[i * 3] = t[0] * b;
      col[i * 3 + 1] = t[1] * b;
      col[i * 3 + 2] = t[2] * b;
      size[i] = bright
        ? 6.5 + Math.random() * 5
        : dim
          ? 0.9 + Math.random() * 1.4
          : 1.7 + Math.random() * 3.2;
      seed[i] = Math.random();
      // 亮星带十字星芒
      shape[i] = bright ? 1 : 0;
    };
    for (let i = 0; i < n; i++) place(i, 35, 65, false);
    for (let i = n; i < n + outer; i++) place(i, 70, 110, true);

    // 银河带：绕一条倾斜大圆的高斯纬向分布，暖白、更暗更小；均匀球壳是"随机撒盐"，
    // 一条斜带才能读出"这是天空"而不是"这是噪声"
    const normal = new THREE.Vector3(0.42, 0.6, -0.68).normalize();
    const uAxis = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();
    const dir = new THREE.Vector3();
    const placeBand = (i: number): void => {
      const a = Math.random() * Math.PI * 2;
      const lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.75; // 近似高斯纬向偏移
      dir.copy(uAxis)
        .multiplyScalar(Math.cos(a))
        .addScaledVector(vAxis, Math.sin(a))
        .addScaledVector(normal, lat)
        .normalize();
      const r = 38 + Math.random() * 32;
      pos[i * 3] = dir.x * r;
      pos[i * 3 + 1] = dir.y * r;
      pos[i * 3 + 2] = dir.z * r;
      const warm = Math.random() < 0.6 ? tints[2] : tints[0];
      const b = 0.12 + Math.random() * 0.26;
      col[i * 3] = warm[0] * b;
      col[i * 3 + 1] = warm[1] * b;
      col[i * 3 + 2] = warm[2] * b;
      size[i] = 0.7 + Math.random() * 1.6;
      seed[i] = Math.random();
      shape[i] = 0;
    };
    for (let i = n + outer; i < n + outer + band; i++) placeBand(i);

    // 星座主星：真实赤经赤纬写进同一份点云，所以连线端点必然落在星点上（不会出现"线头悬空"）。
    // 亮度与尺寸按星等映射，mag 1~2 的会越过 bloom 阈值形成光晕，mag 3~4 只当普通亮星。
    let ci = n + outer + band;
    for (const c of CONSTELLATIONS) {
      for (const s of c.stars) {
        const v = raDecToVec3(s.ra, s.dec, CONSTELLATION_RADIUS);
        pos[ci * 3] = v.x;
        pos[ci * 3 + 1] = v.y;
        pos[ci * 3 + 2] = v.z;
        // 星座连接点要"凸出来"：亮度、尺寸都比同星等的背景星高一档，且一律带十字星芒
        const b = Math.min(1.25, magToBrightness(s.mag) * 1.12);
        col[ci * 3] = c.tint[0] * b;
        col[ci * 3 + 1] = c.tint[1] * b;
        col[ci * 3 + 2] = c.tint[2] * b;
        size[ci] = Math.max(7.5, Math.min(15, magToSize(s.mag) * 1.45));
        seed[ci] = Math.random();
        shape[ci] = 1;
        ci += 1;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aShape', new THREE.BufferAttribute(shape, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uOpacity: { value: 0.6 },
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
    this.starfield.renderOrder = -5;
    this.sky.add(this.starfield);
  }

  /**
   * 星座连线：每条边拆成 4 个顶点（左右两对称点），在顶点着色器里按屏幕空间法线外扩成细带。
   * 几何量很小（8 个星座约 45 条边 ≈ 180 顶点），但能拿到可控线宽、软边和 bloom 辉光。
   */
  private buildConstellations(): void {
    const edgeCount = CONSTELLATIONS.reduce((acc, c) => acc + c.edges.length, 0);
    const quads = edgeCount * 4; // 每条边 4 顶点
    const start = new Float32Array(quads * 3);
    const end = new Float32Array(quads * 3);
    const side = new Float32Array(quads);
    const tParam = new Float32Array(quads);
    const delay = new Float32Array(quads);
    const alpha = new Float32Array(quads);
    const color = new Float32Array(quads * 3);
    const index: number[] = [];

    this.constAlpha = [];
    let v = 0;
    let quad = 0;
    for (const c of CONSTELLATIONS) {
      const points = c.stars.map((s) => raDecToVec3(s.ra, s.dec, CONSTELLATION_RADIUS));
      this.constAlpha.push(CONST_ALPHA_IDLE);
      c.edges.forEach(([ia, ib], ei) => {
        const a = points[ia];
        const b = points[ib];
        // 沿星座内部顺序给一点错峰延迟，看起来像一笔一笔"画"出来
        const d = Math.min(0.32, ei * 0.045);
        for (const [pt, t] of [
          [a, 0],
          [b, 1],
        ] as [THREE.Vector3, number][]) {
          for (const s of [-1, 1]) {
            start[v * 3] = a.x;
            start[v * 3 + 1] = a.y;
            start[v * 3 + 2] = a.z;
            end[v * 3] = b.x;
            end[v * 3 + 1] = b.y;
            end[v * 3 + 2] = b.z;
            side[v] = s;
            tParam[v] = t;
            delay[v] = d;
            alpha[v] = CONST_ALPHA_IDLE;
            color[v * 3] = c.tint[0];
            color[v * 3 + 1] = c.tint[1];
            color[v * 3 + 2] = c.tint[2];
            v += 1;
          }
        }
        const base = quad * 4;
        index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        quad += 1;
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quads * 3), 3));
    geo.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(tParam, 1));
    geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CONSTELLATION_RADIUS * 1.2);

    this.constellationMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uWidthPx: { value: CONSTELLATION_WIDTH_PX * this.renderer.getPixelRatio() },
        uResolution: {
          value: new THREE.Vector2(
            this.renderer.domElement.width,
            this.renderer.domElement.height,
          ),
        },
        uDraw: { value: 1 },
      },
      vertexShader: constellationVertexShader,
      fragmentShader: constellationFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // 细带是两三角面拼的，顶点绕序随边的方向变化，必须双面渲染否则有一半会消失
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.constellationMesh = new THREE.Mesh(geo, this.constellationMaterial);
    this.constellationMesh.frustumCulled = false;
    this.constellationMesh.renderOrder = -4; // 连线在星点之后、星云之前
    this.sky.add(this.constellationMesh);
    this.constDraw = 1;
  }

  /**
   * 星座中文名：启动时用 canvas 各画一张文字纹理贴成 Sprite，挂在同一个天球上。
   * 用 3D Sprite 而不是 DOM 覆盖层：它会跟着天球旋转、跟着相机透视，`capture()` 截图也能带上。
   * 位置取该星座所有星的质心方向，再沿切平面向上偏一点，避免压在星点上。
   */
  private buildConstellationLabels(): void {
    const TOP = new THREE.Vector3(0, 1, 0);
    for (const c of CONSTELLATIONS) {
      const centroid = new THREE.Vector3();
      for (const s of c.stars) centroid.add(raDecToVec3(s.ra, s.dec, 1));
      centroid.normalize();
      const tangent = TOP.clone().addScaledVector(centroid, -TOP.dot(centroid));
      if (tangent.lengthSq() < 1e-4) tangent.set(1, 0, 0);
      tangent.normalize();
      const pos = centroid
        .clone()
        .multiplyScalar(CONSTELLATION_RADIUS - 1.5)
        .addScaledVector(tangent, 3.6);

      const label = createLabelTexture(c.name);
      const material = new THREE.SpriteMaterial({
        map: label.texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      const h = 2.6; // 世界单位：在 r≈52 处约 40 px 高
      sprite.scale.set(h * label.aspect, h, 1);
      sprite.position.copy(pos);
      sprite.renderOrder = -3;
      sprite.visible = false;
      this.sky.add(sprite);
      this.labels.push(sprite);
    }
  }

  /** 星图模式开关：切换时让连线重新"描"一遍 */
  setStarchart(on: boolean): void {
    if (this.starchart === on) return;
    this.starchart = on;
    this.constDraw = 0.05;
  }

  /**
   * 背景云气层：一张挂在相机前的单位平面（跟着相机转，永远铺满画面），
   * 用 CPU 生成的周期性 FBM 贴图做两层反向漂移。它替代了此前被 revert 掉的 3D 体积雾：
   * 那版是三维雾片把粒子裹住、成本高且浑浊；这一层在粒子之后（更远）、加色很轻，
   * 只提供"背后有星云"的氛围，不参与遮挡也不吃粒子细节。
   */
  private buildCloud(): void {
    this.cloudTexture = createCloudTexture();
    this.cloudMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCloud: { value: this.cloudTexture },
        uTime: { value: 0 },
        uEnergy: { value: ENERGY_IDLE },
        uBass: { value: 0 },
        uOpacity: { value: 0 },
        // 与主星云共享同一组 Color 实例：配色滑块 / 预设切换会让云气一起变色
        uColors: { value: this.uniformColors },
      },
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.cloud = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.cloudMaterial);
    this.cloud.position.set(0, 0, -CLOUD_DIST);
    this.cloud.frustumCulled = false;
    this.cloud.renderOrder = -10; // 先画云，粒子与星野叠在上面
    this.cloud.visible = false;
    // 挂在相机下：相机必须进场景图，其子节点才会被渲染
    this.camera.add(this.cloud);
    this.scene.add(this.camera);
    this.sizeCloud();
  }

  /** 按当前 FOV 与宽高比把云气平面撑满视锥（略放 4% 防边缘露出） */
  private sizeCloud(): void {
    if (!this.cloud) return;
    const h = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * CLOUD_DIST;
    this.cloud.scale.set(h * this.camera.aspect * 1.04, h * 1.04, 1);
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

    // 粒子形状是每颗粒子的固有属性（形变时不插值，避免中途跳形）：
    // 核心少数四芒星、外晕少数细光条，其余保持圆点 —— 18k 个同一种高斯点看起来必然像撒砂子。
    const shapeAttr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const s = shape.seed[i];
      const ct = shape.colorT[i];
      shapeAttr[i] = ct < 0.36 && s < 0.11 ? 1 : ct > 0.55 && s > 0.82 ? 2 : 0;
    }
    geo.setAttribute('aShape', new THREE.BufferAttribute(shapeAttr, 1));

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

    // 滑块锁定配色时，预设切换/解析配色不覆盖它；否则以预设色为基底（解析色随后由 overrideColors 覆写）
    if (this.colorSource !== 'valence') {
      this.targetColors = preset.colors.map((c) => new THREE.Color(c));
    }
    this.bloomTarget = preset.bloom;
    this.sizeTarget = preset.sizeScale;
    this.coreTarget = preset.core;
    // 待机 M31 是盘状星系，暗尘埃带靠"极暗粒子 + 该区域不投亮粒子"形成，铺一层云气会糊掉暗带；
    // 所以只有情绪星体才让云气淡入。
    this.cloudTarget = preset.id === 'galaxy_idle' ? 0 : 1;
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
      // 换星体：对应星座重新"描"一遍（与 2.8s 星际潜入同节奏）
      this.constDraw = 0.05;
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

  /** 覆盖目标调色板（心情解析生成的连续色）；滑块锁定时不覆写 */
  overrideColors(colors: THREE.Color[]): void {
    if (colors.length === 3 && this.colorSource !== 'valence') {
      this.targetColors = colors;
    }
  }

  /**
   * 配色滑块：mix ∈ [-1,1]，-1 锚定深思的紫色，1 锚定狂喜的金色。
   * 只在两端调色板之间改色相与饱和度，明度固定在金色的亮端（不改变星体亮暗、始终保持较亮），
   * 几何形状保持当前预设不变；传 null 关闭，回到当前预设/解析配色。
   */
  setValenceMix(mix: number | null): void {
    if (mix === null) {
      this.valenceMix = null;
      this.colorSource = 'preset';
      // 关闭滑块：回到当前预设/解析配色
      this.targetColors = this.preset.colors.map((c) => new THREE.Color(c));
      return;
    }
    this.valenceMix = Math.min(1, Math.max(-1, mix));
    this.colorSource = 'valence';
    this.applyValenceColors();
  }

  /**
   * 在紫 / 金两端调色板间插值色相与饱和度；明度按相对亮度反求解，使紫端亮度不低于金端的 80%，
   * 所以滑块只换颜色、不压暗星体（不触碰任何几何缓冲）。
   */
  private applyValenceColors(): void {
    if (this.valenceMix === null) return;
    const t = (this.valenceMix + 1) / 2; // 0 紫端 → 1 金端
    const purpleC = PRESET_MAP.melancholy.colors;
    const goldC = PRESET_MAP.euphoria.colors;
    const a = { h: 0, s: 0, l: 0 };
    const b = { h: 0, s: 0, l: 0 };
    this.targetColors = purpleC.map((hex, i) => {
      new THREE.Color(hex).getHSL(a, THREE.SRGBColorSpace);
      const gold = new THREE.Color(goldC[i]);
      gold.getHSL(b, THREE.SRGBColorSpace);
      // 色相沿色环最短弧线过渡，避免绕远路经过无关颜色
      let dh = b.h - a.h;
      if (dh > 0.5) dh -= 1;
      else if (dh < -0.5) dh += 1;
      const h = (a.h + dh * t + 1) % 1;
      const s = a.s + (b.s - a.s) * t;
      const yTarget = relLuminance(gold) * (SPECTRUM_BRIGHTNESS + (1 - SPECTRUM_BRIGHTNESS) * t);
      // 亮度随 HSL 明度单调递增：二分求出达到目标亮度所需的明度
      const c = new THREE.Color();
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        c.setHSL(h, s, mid, THREE.SRGBColorSpace);
        if (relLuminance(c) < yTarget) lo = mid;
        else hi = mid;
      }
      return c.setHSL(h, s, (lo + hi) / 2, THREE.SRGBColorSpace);
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
    this.vignette.uniforms.uAspect.value = w / h;
    this.film.uniforms.uAspect.value = w / h;
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.uniforms.uViewHeight.value = h;
    if (this.constellationMaterial) {
      this.constellationMaterial.uniforms.uResolution.value.set(
        this.renderer.domElement.width,
        this.renderer.domElement.height,
      );
      this.constellationMaterial.uniforms.uWidthPx.value =
        CONSTELLATION_WIDTH_PX * this.renderer.getPixelRatio();
    }
    this.sizeCloud();
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
    // C：切换「星图模式」（星座连线全部显现）
    if (key === 'c') {
      e.preventDefault();
      this.onToggleStarchart?.();
      return;
    }
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

    // 潮汐呼吸慢包络：潮汐强度为主、瞬时 RMS 为辅；上升快（0.5s）、回落慢（1.8s）
    const audioOn = this.audio.ready;
    const energyTarget = audioOn
      ? Math.min(1, bands.tide * 0.7 + bands.level * 0.7 + bands.tide * bands.level * 0.1)
      : ENERGY_IDLE;
    this.energyCurrent = THREE.MathUtils.damp(
      this.energyCurrent,
      energyTarget,
      energyTarget > this.energyCurrent ? ENERGY_DAMP_RISE : ENERGY_DAMP_FALL,
      dt,
    );
    const energy = this.energyCurrent;
    this.uniforms.uEnergy.value = energy;

    // 自转积分角：behaviorCurrent.x（预设自转 × 心情缩放）已做阻尼平滑，能量 / 中频也是慢包络，
    // 所以直接欧拉累加即可，角速度连续、无跳变。
    this.spinPhase += dt * this.behaviorCurrent.x * (SPIN_BASE + energy * SPIN_ENERGY + bands.mid * SPIN_MID);
    this.uniforms.uSpinPhase.value = this.spinPhase;

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

    // 粒子尺寸：基线 × treble 细节脉动（高频点亮星点），整体体量再随 bass 涨缩；低落时略收
    const sizeGroove =
      this.sizeCurrent * (1 + this.grooveTreble * 0.22) * (1 + this.grooveBass * 0.12) * (1 - (1 - this.grooveBass) * 0.05);
    this.uniforms.uSize.value = sizeGroove * PARTICLE_SIZE_BOOST;

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

    // 天球（星野 + 星座连线）整体缓慢自转
    this.sky.rotation.y += dt * 0.004;
    this.starMaterial.uniforms.uTime.value = t;
    this.starMaterial.uniforms.uOpacity.value = 0.72 + this.grooveBass * 0.3;

    // 星座连线：当前情绪的星座最亮；星图模式下全部显现；其余只留一点存在感
    if (this.constellationMesh) {
      this.constDraw = THREE.MathUtils.damp(this.constDraw, 1, 1.7, dt);
      this.constellationMaterial.uniforms.uDraw.value = this.constDraw;
      const activeConst = PRESET_CONSTELLATION[this.preset.id];
      const alphaAttr = this.constellationMesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
      const alphaArr = alphaAttr.array as Float32Array;
      let vi = 0;
      for (let i = 0; i < CONSTELLATIONS.length; i++) {
        const c = CONSTELLATIONS[i];
        const isActive = c.id === activeConst;
        // 平时完全不画连线（用户要求"平时不要抢戏"），只有星图模式才出现
        const target = !this.starchart
          ? CONST_ALPHA_IDLE
          : isActive
            ? constActiveAlpha()
            : CONST_ALPHA_CHART;
        this.constAlpha[i] = THREE.MathUtils.damp(this.constAlpha[i] ?? 0, target, 2.4, dt);
        const a = this.constAlpha[i];
        const nv = c.edges.length * 4;
        for (let k = 0; k < nv; k++) alphaArr[vi + k] = a;
        vi += nv;

        // 中文名跟着星座一起淡入淡出
        const sprite = this.labels[i];
        if (sprite) {
          const mat = sprite.material as THREE.SpriteMaterial;
          mat.opacity = Math.min(1, a * 2.2);
          sprite.visible = a > 0.012;
        }
      }
      alphaAttr.needsUpdate = true;
    }

    // 云气层：按预设淡入淡出；时间 / 潮汐 / 低频一起喂进去
    this.cloudOpacity = THREE.MathUtils.damp(this.cloudOpacity, this.cloudTarget, CLOUD_DAMP, dt);
    this.cloud.visible = this.cloudOpacity > 0.002;
    if (this.cloud.visible) {
      this.cloudMaterial.uniforms.uTime.value = t;
      this.cloudMaterial.uniforms.uEnergy.value = energy;
      this.cloudMaterial.uniforms.uBass.value = bands.bass;
      this.cloudMaterial.uniforms.uOpacity.value = this.cloudOpacity;
    }

    // 胶片层：颗粒常驻；超新星冲击波（uShockAmp）驱动径向扭曲与额外色差
    this.film.uniforms.uTime.value = t;
    this.film.uniforms.uShock.value = Math.min(1, this.uniforms.uShockAmp.value * 0.8);

    // 核心辉光随低频呼吸（强度按形态：黑洞视界需保持绝对空心）；潮汐高潮核心额外胀大
    const coreMat = this.coreSprite.material as THREE.SpriteMaterial;
    const coreK = this.coreCurrent;
    // 核心：低频呼吸 + 潮汐高潮额外胀大；基础亮度沿用 dev 的压暗值
    this.coreSprite.scale.setScalar((1.0 + bands.bass * 0.6 + energy * 0.25) * (0.3 + coreK * 0.8));
    coreMat.opacity = (0.05 + bands.bass * 0.1 + energy * 0.06) * coreK;
    coreMat.color.copy(this.uniformColors[0]);

    // Bloom：bass 托起辉光体量，mid 拓宽辉光范围；整体高潮涨起、低落沉下减光，
    // 并随潮汐呼吸明暗（高潮璀璨泛光、低落压暗至深空微光）
    const lift = this.grooveBass * 0.3 + this.grooveMid * 0.16;
    this.bloom.strength = (this.bloomCurrent * 0.58 + lift) * (0.7 + energy * 0.45) + this.bloomKick;

    // 暗角：高潮时四周压暗更强、中心更聚焦；低落时略微松开（整体已提亮，暗角收一档）
    this.vignette.uniforms.uAmount.value = 0.28 + this.grooveBass * 0.1;

    // 整体体量：bass 高涨时星云向外涨起，低落时向内收拢压暗（沿相机距离方向缩放粒子群）
    const bodyScale = 1 + this.grooveBass * 0.1 - (1 - this.grooveBass) * 0.06;
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
        energy: +this.energyCurrent.toFixed(3),
        tide: +bands.tide.toFixed(3),
        level: +bands.level.toFixed(3),
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
    this.constellationMesh.geometry.dispose();
    this.constellationMaterial.dispose();
    for (const sprite of this.labels) {
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.labels = [];
    this.material.dispose();
    this.coreSprite.material.dispose();
    this.cloud.geometry.dispose();
    this.cloudMaterial.dispose();
    this.cloudTexture.dispose();
    this.film.material.dispose();
    this.texture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}

export const NebulaCanvas = forwardRef<NebulaCanvasHandle, Props>(function NebulaCanvas(
  { preset, emotion, palette, turbulence, speed, valence, starchart, onToggleStarchart, onStats },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<NebulaEngine | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const onToggleRef = useRef(onToggleStarchart);
  onToggleRef.current = onToggleStarchart;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const engine = new NebulaEngine(el, preset, emotion, (s) => onStatsRef.current?.(s), starchart, () =>
      onToggleRef.current?.(),
    );
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setStarchart(starchart);
  }, [starchart]);

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
