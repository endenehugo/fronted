import type { NebulaPreset, PresetId, EmotionVector } from '../types';

/**
 * 六大内置「情绪星系」预设
 * 颜色顺序：内核 → 旋臂 → 外晕
 * 每个预设拥有专属的天体几何拓扑（见 shapeGenerators.ts）与动态物理参数
 */
export const PRESETS: NebulaPreset[] = [
  {
    id: 'serenity',
    name: '猎户座 · 静谧',
    english: 'SERENITY',
    label: '静',
    colors: ['#E0F7FA', '#00B4D8', '#03045E'],
    bg: '#020a1a',
    root: 48, // C3
    scale: [0, 2, 4, 7, 9],
    scaleName: 'C 大调五声音阶',
    bpm: 62,
    turbulence: 0.42,
    speed: 0.55,
    spin: 0.22,
    twist: 1.7,
    bloom: 1.05,
    sizeScale: 1.0,
    description: '蝴蝶双叶星云 · 舒展缓转、低湍流、深海呼吸感',
    centroid: { valence: 0.35, arousal: -0.65, mystery: 0.25 },
    behavior: { spin: 0.22, pulse: 0.1, drift: 0, turbulence: 0.1 },
    camera: { phi: 0.62, theta: 1.57, dist: 10.6 },
    shear: 0.15,
    core: 0.42,
  },
  {
    id: 'euphoria',
    name: '超新星 · 狂喜',
    english: 'EUPHORIA',
    label: '喜',
    colors: ['#FFF3B0', '#FF9F1C', '#E71D36'],
    bg: '#1a0505',
    root: 53, // F3
    scale: [0, 2, 4, 6, 7, 9, 11],
    scaleName: 'F 利底亚调式',
    bpm: 104,
    turbulence: 1.15,
    speed: 1.55,
    spin: 0.42,
    twist: 1.25,
    bloom: 1.45,
    sizeScale: 1.08,
    description: '超新星残骸 · 纤维球壳与八向喷流',
    centroid: { valence: 0.85, arousal: 0.8, mystery: 0.1 },
    behavior: { spin: 0.38, pulse: 0.22, drift: 0, turbulence: 0.16 },
    camera: { phi: 1.12, theta: 1.05, dist: 10.9 },
    shear: 0.1,
    core: 0.62,
  },
  {
    id: 'melancholy',
    name: '暗物质 · 深思',
    english: 'MELANCHOLY',
    label: '思',
    colors: ['#E0AAFF', '#7B2CBF', '#10002B'],
    bg: '#05010f',
    root: 45, // A2
    scale: [0, 2, 3, 5, 7, 8, 10],
    scaleName: 'A 自然小调',
    bpm: 54,
    turbulence: 0.7,
    speed: 0.4,
    spin: 0.18,
    twist: 1.35,
    bloom: 0.92,
    sizeScale: 0.95,
    description: '黑洞吸积盘 · 事件视界与爱因斯坦环',
    centroid: { valence: -0.65, arousal: -0.35, mystery: 0.55 },
    behavior: { spin: 0.34, pulse: 0.06, drift: 0, turbulence: 0.05 },
    camera: { phi: 1.26, theta: 0.92, dist: 10.5 },
    shear: 2.4,
    core: 0.1,
  },
  {
    id: 'focus',
    name: '脉冲星 · 专注',
    english: 'FOCUS',
    label: '专',
    colors: ['#FFFFFF', '#4CC9F0', '#1D3557'],
    bg: '#04101f',
    root: 50, // D3
    scale: [0, 2, 3, 5, 7, 9, 10],
    scaleName: 'D 多利亚调式',
    bpm: 84,
    turbulence: 0.5,
    speed: 0.85,
    spin: 0.3,
    twist: 1.15,
    bloom: 1.1,
    sizeScale: 0.92,
    description: '脉冲星磁感线 · 双极光束与偶极环',
    centroid: { valence: 0.2, arousal: 0.35, mystery: 0.05 },
    behavior: { spin: 0.16, pulse: 0.1, drift: 0, turbulence: 0.06 },
    camera: { phi: 1.05, theta: 0.62, dist: 10.4 },
    shear: 0.05,
    core: 0.5,
  },
  {
    id: 'catharsis',
    name: '红巨星 · 释放',
    english: 'CATHARSIS',
    label: '释',
    colors: ['#FFD166', '#F77F00', '#9E2A2B'],
    bg: '#170404',
    root: 52, // E3
    scale: [0, 1, 3, 5, 7, 8, 10],
    scaleName: 'E 弗里吉亚调式',
    bpm: 92,
    turbulence: 1.45,
    speed: 1.1,
    spin: 0.34,
    twist: 0.95,
    bloom: 1.3,
    sizeScale: 1.05,
    description: '红巨星日冕 · 湍流星体与日珥磁拱',
    centroid: { valence: -0.25, arousal: 0.75, mystery: 0.3 },
    behavior: { spin: 0.2, pulse: 0.18, drift: 0, turbulence: 0.2 },
    camera: { phi: 1.0, theta: 1.2, dist: 10.7 },
    shear: 0.05,
    core: 0.5,
  },
  {
    id: 'healing',
    name: '创生之柱 · 治愈',
    english: 'HEALING',
    label: '愈',
    colors: ['#D8F3DC', '#52B788', '#1B4332'],
    bg: '#03110a',
    root: 43, // G2
    scale: [0, 2, 4, 7, 9, 11, 14],
    scaleName: 'G 大调加九音',
    bpm: 66,
    turbulence: 0.58,
    speed: 0.62,
    spin: 0.24,
    twist: 1.2,
    bloom: 1.0,
    sizeScale: 1.0,
    description: '创生之柱 · 三塔耸立与顶端气态球',
    centroid: { valence: 0.6, arousal: -0.15, mystery: 0.35 },
    behavior: { spin: 0.1, pulse: 0.08, drift: 0.16, turbulence: 0.08 },
    camera: { phi: 1.34, theta: 1.5, dist: 12.2 },
    shear: 0.02,
    core: 0.34,
  },
];

export const PRESET_MAP: Record<PresetId, NebulaPreset> = PRESETS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<PresetId, NebulaPreset>,
);

export function getPreset(id: PresetId | string | undefined): NebulaPreset {
  return PRESET_MAP[(id ?? 'serenity') as PresetId] ?? PRESETS[0];
}

/** 由情感向量反查最接近的预设 */
export function nearestPreset(v: EmotionVector): NebulaPreset {
  let best = PRESETS[0];
  let bestD = Infinity;
  for (const p of PRESETS) {
    const d =
      Math.pow(p.centroid.valence - v.valence, 2) * 1.0 +
      Math.pow(p.centroid.arousal - v.arousal, 2) * 1.15 +
      Math.pow(p.centroid.mystery - v.mystery, 2) * 0.8;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
