import type { PresetId } from '../types';
import { getPreset } from './presets';

/**
 * 纯数学点云生成器
 * 待机态「仙女座大星系」+ 六大情绪预设定制截然不同的 3D 天体几何拓扑，
 * 所有形状统一归一化在半径 ~3.5 的空间内。
 *
 * 坐标约定：Y 轴向上（天极），XZ 为赤道面。
 */

const TAU = Math.PI * 2;

const gauss = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

/** 0~1 的三次平滑阶跃，用来做软过渡 / 压暗包络 */
const smooth01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

export interface ShapeAttributes {
  /** 当前形态坐标 */
  position: Float32Array;
  /** 粒子基础尺寸 */
  size: Float32Array;
  /** 随机种子（闪烁 / 相位） */
  seed: Float32Array;
  /** 结构角色权重 0~1（用于运动规律加权） */
  role: Float32Array;
  /** 颜色梯度参数 0~1（0 内核色 → 1 外晕色） */
  colorT: Float32Array;
  /** 错峰飞行种子 0~1（形变时的延迟相位）；-1 表示由 buildShape 统一随机填充 */
  random: Float32Array;
  /** 逐顶点颜色 RGB（待机星系的多色层次；情绪星体留空，走 colorT 渐变） */
  color: Float32Array;
  /** 顶点色权重 0~1：1 完全使用 aColor，0 使用 colorT 三段渐变 */
  colorW: Float32Array;
  /** 悬臂序号 0~6（0 = 非悬臂，1~6 = 六条情绪悬臂），驱动各自的差速自转 */
  arm: Float32Array;
}

type Builder = (count: number) => ShapeAttributes;

function alloc(count: number): ShapeAttributes {
  return {
    position: new Float32Array(count * 3),
    size: new Float32Array(count),
    seed: new Float32Array(count),
    role: new Float32Array(count),
    colorT: new Float32Array(count),
    random: new Float32Array(count).fill(-1),
    color: new Float32Array(count * 3),
    colorW: new Float32Array(count),
    arm: new Float32Array(count),
  };
}

// ---------------------------------------------------------------- 1. 蝴蝶双叶星云

/**
 * 沿 X 轴左右对称的双翼蝶形，中心腰部收窄（sin^0.75 包络），
 * 翼面叠加多层丝绸状正弦波纹。
 */
const buildSerenity: Builder = (count) => {
  const s = alloc(count);
  const nBody = Math.floor(count * 0.12);

  let i = 0;
  // 蝶身（腰部）
  for (let k = 0; k < nBody; k++, i++) {
    const t = Math.random();
    s.position[i * 3] = gauss() * 0.09;
    s.position[i * 3 + 1] = gauss() * 0.11;
    s.position[i * 3 + 2] = (t - 0.35) * 1.6;
    s.size[i] = 0.32 + Math.random() * 0.4;
    s.seed[i] = Math.random();
    s.role[i] = 0.05;
    s.colorT[i] = 0.34 + t * 0.2;
  }

  // 双翼
  for (let k = 0; k < count - nBody; k++, i++) {
    const side = k % 2 === 0 ? 1 : -1;
    const u = Math.pow(Math.random(), 0.8); // 0 体侧 → 1 翼尖
    const v = Math.random() * 2 - 1; // -1 前缘 → 1 后缘

    // sin^0.75 包络：腰部收窄，中段最宽，翼尖收成尖角
    const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.72);
    const halfW = 1.34 * env * (v > 0 ? 1.0 : 0.66);
    const span = 0.12 + 3.05 * u;

    const x = side * span;
    const z = 0.52 * u + v * halfW;

    // 多层丝绸状波纹
    let y = 0.11 * Math.sin(u * 5.0 * Math.PI + v * 1.6);
    y += 0.06 * Math.sin(u * 10.5 * Math.PI - v * 3.1);
    y += 0.035 * Math.sin(v * 6.0 * Math.PI + u * 2.0);
    y *= 0.3 + 0.8 * u;
    y += 0.3 * u * u; // 翼尖上扬
    y += gauss() * 0.018;

    s.position[i * 3] = x;
    s.position[i * 3 + 1] = y;
    s.position[i * 3 + 2] = z;
    s.size[i] = 0.45 + Math.random() * 0.85;
    s.seed[i] = Math.random();
    s.role[i] = 0.15 + u * 0.35;
    s.colorT[i] = 0.16 + u * 0.58 + Math.abs(v) * 0.1;
  }

  return s;
};

// ---------------------------------------------------------------- 2. 超新星爆炸残骸

/** 75% 双层中空纤维球壳 + 25% 八条高能喷流 */
const buildEuphoria: Builder = (count) => {
  const s = alloc(count);
  const nShell = Math.floor(count * 0.75);

  let i = 0;
  for (let k = 0; k < nShell; k++, i++) {
    const ct = Math.random() * 2 - 1;
    const th = Math.acos(ct);
    const ph = Math.random() * TAU;
    const shell = Math.random() < 0.5 ? 2.45 : 2.98;

    // 3D 纤维褶皱
    const wrinkle =
      0.18 * Math.sin(th * 7 + ph * 3) * Math.sin(th * 3 - ph * 2) +
      0.12 * Math.sin(th * 13 + ph * 5) +
      0.06 * Math.sin(ph * 11);
    const r = shell + wrinkle + gauss() * 0.045;
    const st = Math.sin(th);

    s.position[i * 3] = r * st * Math.cos(ph);
    s.position[i * 3 + 1] = r * Math.cos(th);
    s.position[i * 3 + 2] = r * st * Math.sin(ph);
    s.size[i] = 0.4 + Math.random() * 0.75;
    s.seed[i] = Math.random();
    s.role[i] = 0.35;
    s.colorT[i] = 0.45 + (r / 3.2) * 0.35 + Math.random() * 0.1;
  }

  // 八条喷流：4 个方位角 × 上下两个锥面
  const cone = 0.6;
  for (let k = 0; k < count - nShell; k++, i++) {
    const j = k % 8;
    const up = j % 2 === 0 ? 1 : -1;
    const az = (j >> 1) * (TAU / 4);
    const dx = Math.sin(cone) * Math.cos(az);
    const dy = Math.cos(cone) * up;
    const dz = Math.sin(cone) * Math.sin(az);

    const t = Math.pow(Math.random(), 0.62) * 3.3;
    const spread = 0.015 + t * 0.03;

    s.position[i * 3] = dx * t + gauss() * spread;
    s.position[i * 3 + 1] = dy * t + gauss() * spread;
    s.position[i * 3 + 2] = dz * t + gauss() * spread;
    s.size[i] = 0.32 + Math.random() * 0.55;
    s.seed[i] = Math.random();
    s.role[i] = 1.0;
    s.colorT[i] = 0.04 + (t / 3.3) * 0.3;
  }

  return s;
};

// ---------------------------------------------------------------- 3. 黑洞吸积盘

/** 中心 r<0.75 绝对空心；70% 极薄水平吸积盘 + 30% 交叉引力透镜光环 */
const buildMelancholy: Builder = (count) => {
  const s = alloc(count);
  const nDisk = Math.floor(count * 0.7);

  let i = 0;
  for (let k = 0; k < nDisk; k++, i++) {
    const r = 0.75 + 2.85 * Math.pow(Math.random(), 0.55);
    const th = Math.random() * TAU;
    const y = gauss() * 0.035 + 0.05 * Math.sin(th * 2 + r);

    s.position[i * 3] = r * Math.cos(th);
    s.position[i * 3 + 1] = y;
    s.position[i * 3 + 2] = r * Math.sin(th);
    s.size[i] = 0.34 + Math.random() * 0.5;
    s.seed[i] = Math.random();
    s.role[i] = 1.0;
    s.colorT[i] = 0.05 + ((r - 0.75) / 2.85) * 0.62;
  }

  // 引力透镜光环：主环（XY 竖直面，绕 Y 偏转 20°）+ 次环（YZ 竖直面）
  const tiltA = 0.35;
  const ca = Math.cos(tiltA);
  const sa = Math.sin(tiltA);
  for (let k = 0; k < count - nDisk; k++, i++) {
    if (Math.random() < 0.62) {
      const th = Math.random() * TAU;
      const R = 2.05 + gauss() * 0.09;
      const x0 = R * Math.cos(th);
      const z0 = gauss() * 0.09;
      s.position[i * 3] = x0 * ca - z0 * sa;
      s.position[i * 3 + 1] = R * Math.sin(th);
      s.position[i * 3 + 2] = x0 * sa + z0 * ca;
    } else {
      const th = Math.random() * TAU;
      const R = 1.68 + gauss() * 0.08;
      s.position[i * 3] = gauss() * 0.07;
      s.position[i * 3 + 1] = R * Math.sin(th);
      s.position[i * 3 + 2] = R * Math.cos(th);
    }
    s.size[i] = 0.55 + Math.random() * 0.95;
    s.seed[i] = Math.random();
    s.role[i] = 0.0; // role=0 → 刚性自转，爱因斯坦环不会被差速剪切成带状
    s.colorT[i] = 0.18 + Math.random() * 0.14;
  }

  return s;
};

// ---------------------------------------------------------------- 4. 脉冲星磁感线

/** 15% 致密亮核 + 35% 倾斜磁轴双极光束 + 50% 三组偶极子磁感线 */
const buildFocus: Builder = (count) => {
  const s = alloc(count);
  const nCore = Math.floor(count * 0.15);
  const nBeam = Math.floor(count * 0.35);

  const tilt = 0.44; // 磁轴倾斜 ~25°
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const tiltVec = (x: number, y: number, z: number): [number, number, number] => [
    x,
    y * ct - z * st,
    y * st + z * ct,
  ];

  let i = 0;
  // 致密亮核
  for (let k = 0; k < nCore; k++, i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.acos(u);
    const ph = Math.random() * TAU;
    const r = 0.24 * Math.pow(Math.random(), 0.7);
    s.position[i * 3] = r * Math.sin(th) * Math.cos(ph);
    s.position[i * 3 + 1] = r * Math.cos(th);
    s.position[i * 3 + 2] = r * Math.sin(th) * Math.sin(ph);
    s.size[i] = 0.35 + Math.random() * 0.5;
    s.seed[i] = Math.random();
    s.role[i] = 0.05;
    s.colorT[i] = 0.02 + Math.random() * 0.06;
  }

  // 双极光束
  for (let k = 0; k < nBeam; k++, i++) {
    const dir = k % 2 === 0 ? 1 : -1;
    const t = 0.18 + Math.pow(Math.random(), 0.8) * 3.2;
    const spread = 0.012 + t * 0.016;
    const ph = Math.random() * TAU;
    const rad = Math.abs(gauss()) * spread;

    const [x, y, z] = tiltVec(
      rad * Math.cos(ph),
      dir * t,
      rad * Math.sin(ph),
    );
    s.position[i * 3] = x;
    s.position[i * 3 + 1] = y;
    s.position[i * 3 + 2] = z;
    s.size[i] = 0.3 + Math.random() * 0.5;
    s.seed[i] = Math.random();
    s.role[i] = 0.75;
    s.colorT[i] = 0.05 + (t / 3.4) * 0.32;
  }

  // 偶极子磁感线：r = L · sin²θ
  const Ls = [1.55, 2.4, 3.2];
  for (let k = 0; k < count - nCore - nBeam; k++, i++) {
    const group = k % 3;
    const L = Ls[group] + (Math.random() - 0.5) * 0.18;
    const theta = Math.acos(1 - 2 * Math.random());
    const phi = Math.random() * TAU;
    const r = L * Math.sin(theta) * Math.sin(theta);
    const sr = Math.sin(theta);

    const [x, y, z] = tiltVec(
      r * sr * Math.cos(phi),
      r * Math.cos(theta),
      r * sr * Math.sin(phi),
    );
    s.position[i * 3] = x;
    s.position[i * 3 + 1] = y;
    s.position[i * 3 + 2] = z;
    s.size[i] = 0.35 + Math.random() * 0.6;
    s.seed[i] = Math.random();
    s.role[i] = 0.25 + group * 0.15;
    s.colorT[i] = 0.3 + (group / 2) * 0.45 + Math.random() * 0.08;
  }

  return s;
};

// ---------------------------------------------------------------- 5. 红巨星日冕环

/** 60% 强湍流恒星球体 + 40% 六条贝塞尔日珥磁力拱环 */
const buildCatharsis: Builder = (count) => {
  const s = alloc(count);
  const nStar = Math.floor(count * 0.6);
  const R0 = 1.52;

  const spherePoint = (lon: number, lat: number): [number, number, number] => {
    const cl = Math.cos(lat);
    return [R0 * cl * Math.cos(lon), R0 * Math.sin(lat), R0 * cl * Math.sin(lon)];
  };

  let i = 0;
  for (let k = 0; k < nStar; k++, i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.acos(u);
    const ph = Math.random() * TAU;
    const r =
      R0 +
      0.16 * Math.sin(th * 5 + ph * 3) +
      0.1 * Math.sin(th * 9 - ph * 4) +
      0.06 * Math.sin(ph * 13 + th * 2) +
      gauss() * 0.03;
    const sr = Math.sin(th);

    s.position[i * 3] = r * sr * Math.cos(ph);
    s.position[i * 3 + 1] = r * Math.cos(th);
    s.position[i * 3 + 2] = r * sr * Math.sin(ph);
    s.size[i] = 0.42 + Math.random() * 0.75;
    s.seed[i] = Math.random();
    s.role[i] = 0.15;
    s.colorT[i] = 0.2 + Math.random() * 0.45;
  }

  // 六条日珥拱环：几何参数固定，保证是 6 条清晰拱起又回落的磁力拱
  const arcs = Array.from({ length: 6 }, (_, i) => ({
    a1: i * (TAU / 6) + 0.18,
    a2: i * (TAU / 6) + 1.42,
    lat1: -0.16 + (i % 3) * 0.14,
    lat2: 0.2 - (i % 2) * 0.26,
    lift: 2.55 + (i % 3) * 0.42,
  }));

  for (let k = 0; k < count - nStar; k++, i++) {
    const arc = arcs[k % 6];
    const p0 = spherePoint(arc.a1, arc.lat1);
    const p2 = spherePoint(arc.a2, arc.lat2);
    const mx = p0[0] + p2[0];
    const my = p0[1] + p2[1];
    const mz = p0[2] + p2[2];
    const mlen = Math.hypot(mx, my, mz) || 1;
    const cx = (mx / mlen) * arc.lift;
    const cy = (my / mlen) * arc.lift;
    const cz = (mz / mlen) * arc.lift;

    const t = Math.random();
    const it = 1 - t;
    const b0 = it * it;
    const b1 = 2 * it * t;
    const b2 = t * t;
    const jitter = 0.05;

    s.position[i * 3] = b0 * p0[0] + b1 * cx + b2 * p2[0] + gauss() * jitter;
    s.position[i * 3 + 1] = b0 * p0[1] + b1 * cy + b2 * p2[1] + gauss() * jitter;
    s.position[i * 3 + 2] = b0 * p0[2] + b1 * cz + b2 * p2[2] + gauss() * jitter;
    s.size[i] = 0.45 + Math.random() * 0.8;
    s.seed[i] = Math.random();
    s.role[i] = 0.45;
    s.colorT[i] = 0.12 + Math.sin(t * Math.PI) * 0.3;
  }

  return s;
};

// ---------------------------------------------------------------- 6. 创生之柱

/** 三根错落垂直星云巨塔，柱身螺旋收窄 + 顶端高亮气态球 */
const buildHealing: Builder = (count) => {
  const s = alloc(count);
  const columns = [
    { x: -1.95, z: 0.3, h: 3.6, r: 0.86, weight: 0.44 },
    { x: 0.0, z: -0.2, h: 2.7, r: 0.74, weight: 0.33 },
    { x: 1.9, z: 0.34, h: 1.9, r: 0.62, weight: 0.23 },
  ];
  const baseY = -1.15;

  for (let k = 0; k < count; k++) {
    // 按柱高加权选塔
    let pick = Math.random();
    let ci = 0;
    for (let c = 0; c < columns.length; c++) {
      if (pick < columns[c].weight) {
        ci = c;
        break;
      }
      pick -= columns[c].weight;
    }
    const col = columns[ci];

    if (Math.random() < 0.12) {
      // 顶端高亮气态球
      const u = Math.random() * 2 - 1;
      const th = Math.acos(u);
      const ph = Math.random() * TAU;
      const r = 0.55 * Math.pow(Math.random(), 0.55);
      const cy = baseY + col.h - 0.08;
      s.position[k * 3] = col.x + r * Math.sin(th) * Math.cos(ph);
      s.position[k * 3 + 1] = cy + r * Math.cos(th) * 0.85;
      s.position[k * 3 + 2] = col.z + r * Math.sin(th) * Math.sin(ph);
      s.size[k] = 0.4 + Math.random() * 0.6;
      s.seed[k] = Math.random();
      s.role[k] = 0.12;
      s.colorT[k] = 0.02 + Math.random() * 0.08;
    } else {
      // 柱身
      const t = Math.pow(Math.random(), 0.82);
      const th = Math.random() * TAU;
      // 有机凹凸
      const bump =
        1 +
        0.1 * Math.sin(t * 9 + ci * 2.1) +
        0.05 * Math.sin(t * 17 + 1.3) +
        0.03 * Math.sin(th * 5 + t * 6);
      // 随高度螺旋收窄
      const rr = col.r * (1 - 0.42 * t) * bump;
      const a = th + t * 2.6;

      s.position[k * 3] = col.x + rr * Math.cos(a) * 1.08;
      s.position[k * 3 + 1] = baseY + t * col.h + gauss() * 0.035;
      s.position[k * 3 + 2] = col.z + rr * Math.sin(a) * 0.92;
      s.size[k] = 0.5 + Math.random() * 0.95;
      s.seed[k] = Math.random();
      s.role[k] = 0.3 + t * 0.45;
      s.colorT[k] = 0.62 - t * 0.48;
    }
  }

  return s;
};

// ---------------------------------------------------------------- 0. 仙女座大星系（待机态）
const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const GALAXY_R = 4.0; // 星云外缘
const GALAXY_SCALE_LEN = 2.05; // 面亮度标长
const GALAXY_ARM_K = 2.25; // 六条悬臂的对数螺旋松紧
const GALAXY_ARM0 = 0.55; // 悬臂起始半径

const GALAXY_CORE_A = rgb('#FFFDF5');
const GALAXY_CORE_B = rgb('#F4D09A');
const CLOUD_WARM = rgb('#FFF4E2');
const CLOUD_MID = rgb('#D4DEFF');
const CLOUD_COOL = rgb('#7488E8');

/** 六条悬臂，一条对应一种情绪 */
const ARM_COUNT = 6;
const ARM_R_IN = 0.7;
const ARM_R_OUT = 3.95;

const NEST_ORDER: PresetId[] = [
  'serenity',
  'euphoria',
  'melancholy',
  'focus',
  'catharsis',
  'healing',
];

const armPhase = (i: number): number => (i * TAU) / ARM_COUNT;
const armAngleAt = (i: number, r: number): number =>
  armPhase(i) + GALAXY_ARM_K * Math.log(r / GALAXY_ARM0);

export interface IdleNest {
  /** 对应情绪预设 id（不会是 galaxy_idle） */
  id: PresetId;
  /** 悬臂上用于取景的锚点（未旋转坐标系） */
  center: [number, number, number];
  /** 悬臂锚点处的视觉半径 */
  radius: number;
  /** 悬臂序号 0~5，用于各自的转速 */
  arm: number;
}

/** 取景锚点半径：六条悬臂中段 */
const NEST_RADIUS = 2.3;

export const IDLE_NESTS: IdleNest[] = NEST_ORDER.map((id, i) => {
  const a = armAngleAt(i, NEST_RADIUS);
  return {
    id,
    center: [Math.cos(a) * NEST_RADIUS, 0, Math.sin(a) * NEST_RADIUS],
    radius: 0.66,
    arm: i,
  };
});

export function idleNestFor(id: string): IdleNest | undefined {
  return IDLE_NESTS.find((n) => n.id === id);
}

const nestPalette = (id: PresetId): [number, number, number][] => {
  const p = getPreset(id);
  return [rgb(p.colors[0]), rgb(p.colors[1]), rgb(p.colors[2])];
};

const grad3 = (
  pal: [number, number, number][],
  t: number,
): [number, number, number] => {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? mix3(pal[0], pal[1], u * 2) : mix3(pal[1], pal[2], (u - 0.5) * 2);
};

const scale3 = (
  c: [number, number, number],
  k: number,
): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

const buildGalaxy: Builder = (count) => {
  const s = alloc(count);

  const nCore = Math.floor(count * 0.05);
  const nArms = Math.floor(count * 0.28);
  const nFog = Math.floor(count * 0.035);
  const nNest = Math.floor(count * 0.12);
  const nLink = Math.floor(count * 0.05);
  const nBand = Math.floor(count * 0.11);
  const nCloud = count - nCore - nArms - nFog - nNest - nLink - nBand;
  const perArm = Math.floor(nArms / ARM_COUNT);

  const write = (
    i: number,
    p: [number, number, number],
    size: number,
    color: [number, number, number],
    colorT: number,
    role: number,
    random: number,
    arm: number,
  ) => {
    s.position[i * 3] = p[0];
    s.position[i * 3 + 1] = p[1];
    s.position[i * 3 + 2] = p[2];
    s.size[i] = size;
    s.seed[i] = Math.random();
    s.role[i] = role;
    s.colorT[i] = colorT;
    s.random[i] = random;
    s.color[i * 3] = color[0];
    s.color[i * 3 + 1] = color[1];
    s.color[i * 3 + 2] = color[2];
    s.colorW[i] = 1;
    s.arm[i] = arm;
  };

  const dir = (): [number, number, number] => {
    const u = Math.random() * 2 - 1;
    const ph = Math.random() * TAU;
    const st = Math.sqrt(1 - u * u);
    return [st * Math.cos(ph), u, st * Math.sin(ph)];
  };

  let i = 0;

  // ---- 核：只有一层极淡的暖雾，中心不留亮光
  for (let k = 0; k < nCore; k++, i++) {
    const u = Math.pow(Math.random(), 0.85);
    const d = dir();
    const rr = 0.95 * u;
    const haze = Math.random() < 0.06;
    const core = u < 0.16;
    write(
      i,
      [d[0] * rr * 1.25, d[1] * rr * 0.5, d[2] * rr],
      haze ? 0.9 + Math.random() * 0.7 : core ? 0.4 + Math.random() * 0.3 : 0.2 + Math.random() * 0.2,
      scale3(mix3(GALAXY_CORE_A, GALAXY_CORE_B, Math.pow(u, 0.75)), 0.1 + 0.16 * (1 - u)),
      0.04,
      haze ? 0.05 : 0.1,
      0.05 + u * 0.3,
      0,
    );
  }

  // ---- 星云主体：一整片填满的白色星云带，没有旋臂结构，
  //      只靠角向低频扰动长出一层层的丝絮，避免糊成一团均匀的白。
  for (let k = 0; k < nCloud; k++, i++) {
    const r = 0.32 + 3.55 * Math.pow(Math.random(), 0.62);
    const t = Math.min(1, r / GALAXY_R);
    const ang = Math.random() * TAU;
    const thick = 0.05 + 0.26 * (1 - t * 0.7);

    // 丝絮：两段不同频率的角向调制 + 径向起伏
    const fil =
      Math.sin(ang * 3.0 + r * 4.2) * 0.5 + Math.sin(ang * 7.0 - r * 2.4 + 1.7) * 0.30;

    const dens = Math.exp(-r / GALAXY_SCALE_LEN);
    const bright = (0.20 + 0.34 * fil) * (0.35 + 1.05 * dens) * 0.62;
    const warm = Math.exp(-r / 1.15);

    write(
      i,
      [
        Math.cos(ang) * r + gauss() * 0.035,
        gauss() * thick,
        Math.sin(ang) * r + gauss() * 0.035,
      ],
      0.42 + Math.random() * 0.62,
      scale3(mix3(mix3(CLOUD_COOL, CLOUD_MID, 0.55), CLOUD_WARM, warm), Math.max(0.18, bright)),
      0.12 + 0.2 * t,
      0.06,
      Math.random(),
      0,
    );
  }

  // ---- 大颗粒柔光：把点云之间的缝补上，让星云带看起来是连续的
  for (let k = 0; k < nFog; k++, i++) {
    const r = 0.4 + 3.35 * Math.random();
    const t = Math.min(1, r / GALAXY_R);
    const ang = Math.random() * TAU;
    const warm = Math.exp(-r / 1.3);
    write(
      i,
      [Math.cos(ang) * r, gauss() * (0.08 + 0.14 * (1 - t)), Math.sin(ang) * r],
      1.15 + Math.random() * 0.9,
      scale3(mix3(CLOUD_COOL, CLOUD_WARM, warm), 0.035 + Math.random() * 0.025),
      0.15,
      0.02,
      Math.random(),
      0,
    );
  }

  // ---- 白色环带：绕中心整整一圈的白色星云圆环，六条彩臂从中穿过，
//      环的内外边缘做柔化，靠近臂的位置略微加浓，看起来像一条缠绕星系的白色带子。
  for (let k = 0; k < nBand; k++, i++) {
    const ang = Math.random() * TAU;
    const rr = 1.9 + Math.random() * 1.1;
    const tn = rr / GALAXY_R;
    const edge = smooth01((rr - 1.6) / 0.42) * (1 - smooth01((rr - 2.86) / 0.42));
    // 角向轻微起伏，避免看起来像画上去的几何圆
    const ripple = 0.82 + 0.18 * Math.sin(ang * 5 + 1.3) + 0.08 * Math.sin(ang * 11 + 2.1);
    const bright = (0.42 + 0.95 * edge) * ripple * (0.72 + Math.random() * 0.45);
    write(
      i,
      [
        Math.cos(ang) * rr,
        gauss() * (0.03 + 0.06 * (1 - tn)),
        Math.sin(ang) * rr,
      ],
      0.58 + Math.random() * 0.85,
      scale3(mix3(CLOUD_WARM, [1, 1, 1], 0.55), 0.16 + bright * 0.4),
      0.18,
      0.06,
      Math.random(),
      0,
    );
  }

  // ---- 六颗情绪星云：紧实的发光团，落在自己那条悬臂的随机位置上，随悬臂同步自转
  {
    const perNest = Math.floor(nNest / ARM_COUNT);
    for (let a = 0; a < ARM_COUNT; a++) {
      const pal = nestPalette(NEST_ORDER[a]);
      const nestR = 1.0 + Math.random() * 1.7;
      const nestAng = armAngleAt(a, nestR) + gauss() * 0.03;
      const cx = Math.cos(nestAng) * nestR;
      const cz = Math.sin(nestAng) * nestR;
      const per = Math.min(perNest, count - i);
      for (let j = 0; j < per; j++, i++) {
        // 越靠核心越密越亮：外层稀薄，内层是一颗小白核
        const u = Math.pow(Math.random(), 0.55);
        const d = dir();
        const rr = 0.66 * u;
        const inner = u < 0.22;
        const bright = (inner ? 2.0 : 0.85) * (0.75 + Math.random() * 0.7);
        write(
          i,
          [cx + d[0] * rr * 1.35, d[1] * rr * 0.55, cz + d[2] * rr * 1.1],
          inner ? 0.85 + Math.random() * 0.5 : 0.34 + Math.random() * 0.4,
          scale3(mix3(pal[0], pal[1], Math.random() * 0.5), bright),
          0.08,
          0.5,
          Math.random(),
          a + 1,
        );
      }
    }
  }

  // ---- 对称悬臂之间的连接云：把 a 与 a+3 两条臂接成一片，整团才像一个星云
  for (let k = 0; k < nLink; k++, i++) {
    const a = k % ARM_COUNT;
    const partner = (a + 3) % ARM_COUNT;
    const r = 0.7 + Math.random() * 2.6;
    const angA = armAngleAt(a, r);
    const angB = armAngleAt(partner, r);
    const ang = angA + (angB - angA) * Math.random() + gauss() * 0.26;
    const rr = r + gauss() * 0.26;
    const c = mix3(nestPalette(NEST_ORDER[a])[0], nestPalette(NEST_ORDER[partner])[0], Math.random() * 0.6);
    write(
      i,
      [Math.cos(ang) * rr, gauss() * (0.06 + 0.16 * (1 - r / GALAXY_R)), Math.sin(ang) * rr],
      0.9 + Math.random() * 0.8,
      scale3(c, 0.08 + Math.random() * 0.09),
      0.16,
      0.03,
      Math.random(),
      0,
    );
  }

  // ---- 六条悬臂：每条单独一色，六条臂整体同步自转
  for (let a = 0; a < ARM_COUNT; a++) {
    const pal = nestPalette(NEST_ORDER[a]);
    const per = Math.min(perArm, count - i);
    for (let k = 0; k < per; k++, i++) {
      const rr = ARM_R_IN + Math.pow(Math.random(), 0.85) * (ARM_R_OUT - ARM_R_IN);
      const tn = rr / GALAXY_R;
      const wide = Math.random() < 0.7 ? 0.07 + 0.05 * tn : 0.26 + 0.24 * tn;
      const ang = armAngleAt(a, rr) + gauss() * wide;
      const knot = Math.random() < 0.06;
      const c = mix3(pal[0], pal[1], Math.random() * 0.55);
      const bright = (knot ? 2.0 : 1.15 + 0.95 * (1 - tn)) * (0.85 + Math.random() * 0.45);

      write(
        i,
        [
          Math.cos(ang) * rr + gauss() * 0.03,
          gauss() * (0.04 + 0.1 * (1 - tn)),
          Math.sin(ang) * rr + gauss() * 0.03,
        ],
        knot ? 1.1 + Math.random() * 0.9 : wide > 0.2 ? 0.85 + Math.random() * 0.75 : 0.42 + Math.random() * 0.46,
        scale3(c, bright),
        0.1 + 0.25 * tn,
        knot ? 0.35 : 0.18,
        0.15 + (k / Math.max(1, per)) * 0.6,
        a + 1,
      );
    }
  }

  return s;
};
// ---------------------------------------------------------------- 入口

const BUILDERS: Record<PresetId, Builder> = {
  galaxy_idle: buildGalaxy,
  serenity: buildSerenity,
  euphoria: buildEuphoria,
  melancholy: buildMelancholy,
  focus: buildFocus,
  catharsis: buildCatharsis,
  healing: buildHealing,
};

/** 生成指定预设的完整形状属性（坐标 + 尺寸 / 种子 / 角色 / 颜色梯度 / 顶点色） */
export function buildShape(type: PresetId, count: number): ShapeAttributes {
  const s = (BUILDERS[type] ?? BUILDERS.galaxy_idle)(Math.max(1, Math.floor(count)));
  // 错峰飞行种子：与 seed 解耦，形变延迟不受闪烁相位影响；builder 自己排序过的粒子保留
  for (let i = 0; i < s.random.length; i++) if (s.random[i] < 0) s.random[i] = Math.random();
  return s;
}

/**
 * 纯数学点云生成器：返回 count × 3 的坐标数组
 * 总跨度归一化在半径 ~3.5 的空间内
 */
export function generateNebulaShape(type: PresetId, count: number): Float32Array {
  return buildShape(type, count).position;
}
