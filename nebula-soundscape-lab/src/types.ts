/** 星云声景实验室 —— 全局类型定义 */

export type PresetId =
  /** 待机态：仙女座大星系（不是情绪星体，不参与最近邻匹配） */
  | 'galaxy_idle'
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

/** 程序化乐器音色（全部由 Web Audio 实时合成，零采样） */
export type TimbreId =
  | 'crystal_bowl'
  | 'pluck_harp'
  | 'cosmic_rhodes'
  | 'vibraphone'
  | 'synth_pad'
  | 'nebula_brass'
  | 'ethereal_choir'
  | 'arp_pluck';

/** 音阶切换器：preset = 跟随当前星体自带的调式，其余为全局调式库 */
export type ScaleId = 'preset' | 'pentatonic' | 'minor' | 'dorian' | 'lydian' | 'phrygian';

/** 分形态动态物理参数（对应 Shader 的 uBehavior vec4） */
export interface ShapeBehavior {
  /** 自转速度 */
  spin: number;
  /** 径向脉冲（随低频） */
  pulse: number;
  /** 垂直升腾速度 */
  drift: number;
  /** 湍流强度 */
  turbulence: number;
}

/** 形态专属最佳观赏机位 */
export interface CameraView {
  /** 俯仰角（自 +Y 轴起算的极角，弧度） */
  phi: number;
  /** 方位角（绕 Y 轴，弧度；决定从哪个朝向看形态） */
  theta: number;
  /** 相机距离 */
  dist: number;
}

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
  /** 该情绪预设推荐绑定的默认音色（用户可在控制栏随时手动切换） */
  timbre: TimbreId;
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
  /** 专属动态物理 */
  behavior: ShapeBehavior;
  /** 专属最佳机位 */
  camera: CameraView;
  /** 差速旋转强度（吸积盘类形态需要强差速） */
  shear: number;
  /** 核心辉光强度 0~1（黑洞等形态需要压到接近 0，保留绝对空心的视界） */
  core: number;
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
  /** 效价滑块：-1 低落负向 ↔ 1 正向明亮；null 表示未手动覆盖（跟随文本解析） */
  valence: number | null;
}
