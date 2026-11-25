/** 星云声景实验室 —— 全局类型定义 */

export type PresetId =
  | 'serenity'
  | 'euphoria'
  | 'melancholy'
  | 'focus'
  | 'catharsis'
  | 'healing';

/** 情感向量：Valence 效价 / Arousal 唤醒度 / Mystery 神秘感，取值范围 [-1, 1] */
export interface EmotionVector {
  valence: number;
  arousal: number;
  mystery: number;
}

/** 三段式渐变色：内核 → 旋臂 → 外晕 */
export type Palette = [string, string, string];

export interface NebulaPreset {
  id: PresetId;
  /** 中文名称，如「猎户座 · 静谧」 */
  name: string;
  english: string;
  /** 情绪标签 */
  label: string;
  colors: Palette;
  bg: string;
  /** 主音 MIDI 编号（低音区，用于 Drone） */
  root: number;
  /** 调式音程（半音） */
  scale: number[];
  scaleName: string;
  bpm: number;
  /** 湍流强度 0~2 */
  turbulence: number;
  /** 旋转速度倍率 */
  speed: number;
  /** 差速自转基频 */
  spin: number;
  /** 螺旋紧密度（rad / 单位半径） */
  twist: number;
  /** Bloom 基础强度 */
  bloom: number;
  /** 粒子尺寸倍率 */
  sizeScale: number;
  description: string;
  /** 情绪坐标中心，用于文本 → 预设匹配 */
  centroid: EmotionVector;
}

/** 写入 URL Hash 的可序列化状态 */
export interface NebulaState {
  presetId: PresetId;
  customText: string;
  colors: Palette;
  turbulence: number;
  speed: number;
  seed: number;
  emotion: EmotionVector | null;
}
