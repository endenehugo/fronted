import type { PresetId } from '../types';

/**
 * 纯数学点云生成器
 * 为六大情绪预设定制截然不同的 3D 天体几何拓扑，
 * 所有形状统一归一化在半径 ~3.5 的空间内。
 *
 * 坐标约定：Y 轴向上（天极），XZ 为赤道面。
 */

const TAU = Math.PI * 2;

const gauss = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

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
}

type Builder = (count: number) => ShapeAttributes;

function alloc(count: number): ShapeAttributes {
  return {
    position: new Float32Array(count * 3),
    size: new Float32Array(count),
    seed: new Float32Array(count),
    role: new Float32Array(count),
    colorT: new Float32Array(count),
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
    s.position[i * 3] = gauss() * 0.055;
    s.position[i * 3 + 1] = gauss() * 0.06;
    s.position[i * 3 + 2] = (t - 0.35) * 1.5;
    s.size[i] = 0.5 + Math.random() * 0.7;
    s.seed[i] = Math.random();
    s.role[i] = 0.05;
    s.colorT[i] = 0.08 + t * 0.22;
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

// ---------------------------------------------------------------- 入口

const BUILDERS: Record<PresetId, Builder> = {
  serenity: buildSerenity,
  euphoria: buildEuphoria,
  melancholy: buildMelancholy,
  focus: buildFocus,
  catharsis: buildCatharsis,
  healing: buildHealing,
};

/** 生成指定预设的完整形状属性（坐标 + 尺寸 / 种子 / 角色 / 颜色梯度） */
export function buildShape(type: PresetId, count: number): ShapeAttributes {
  const builder = BUILDERS[type] ?? BUILDERS.serenity;
  return builder(Math.max(1, Math.floor(count)));
}

/**
 * 纯数学点云生成器：返回 count × 3 的坐标数组
 * 总跨度归一化在半径 ~3.5 的空间内
 */
export function generateNebulaShape(type: PresetId, count: number): Float32Array {
  return buildShape(type, count).position;
}
