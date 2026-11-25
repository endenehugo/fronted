import type { NebulaPreset, ScaleId } from '../types';

export const A4 = 440;
/** 基准音高：A3 = 220Hz、C4 = 261.63Hz（MIDI 57 / 60），调式音阶均由此换算 */
export const A3 = 220;
export const C4 = midiToFreq(60);

/** MIDI 音符号 → 频率（Hz） */
export function midiToFreq(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 构建跨 octaves 个八度的音阶频率表（用于星辰旋律 / 键盘演奏）
 * 返回值按音高升序，可直接当作音阶数组下标访问
 */
export function buildScale(root: number, intervals: number[], octaves = 2): number[] {
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const iv of intervals) {
      out.push(midiToFreq(root + o * 12 + iv));
    }
  }
  return out;
}

/**
 * 调式音阶库：音程以主音为 0 的半音数表示，频率由 buildScale 按 MIDI → Hz 换算。
 * pentatonic 以 C4 / A3 为基准时分别得到 C 大调五声与 A 小调五声（同一组音）。
 */
export interface ScaleDef {
  id: Exclude<ScaleId, 'preset'>;
  name: string;
  /** 听感描述 */
  mood: string;
  intervals: number[];
}

export const SCALE_LIBRARY: ScaleDef[] = [
  { id: 'pentatonic', name: '大调五声', mood: '空灵明亮', intervals: [0, 2, 4, 7, 9] },
  { id: 'minor', name: '自然小调', mood: '深邃忧郁', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'dorian', name: '多利亚调式', mood: '神秘科幻', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'lydian', name: '利底亚调式', mood: '梦幻漂浮', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'phrygian', name: '弗里吉亚调式', mood: '异域张力', intervals: [0, 1, 3, 5, 7, 8, 10] },
];

export const SCALE_MAP: Record<Exclude<ScaleId, 'preset'>, ScaleDef> = SCALE_LIBRARY.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<Exclude<ScaleId, 'preset'>, ScaleDef>,
);

/** 由基准 MIDI 音符 + 调式构建跨 octaves 个八度的频率表 */
export function buildScaleFromKey(keyMidi: number, scaleId: Exclude<ScaleId, 'preset'>, octaves = 2): number[] {
  return buildScale(keyMidi, SCALE_MAP[scaleId].intervals, octaves);
}

/**
 * 交互旋律音阶：比主音高两个八度，清亮不刺耳。
 * scaleId = 'preset' 时沿用星体自带调式，否则以星体主音为根套用全局调式库。
 */
export function presetScale(preset: NebulaPreset, scaleId: ScaleId = 'preset'): number[] {
  const intervals = scaleId === 'preset' ? preset.scale : SCALE_MAP[scaleId].intervals;
  return buildScale(preset.root + 24, intervals, 2);
}

/** 当前生效的音阶名（供顶栏 / 控制栏展示） */
export function scaleDisplayName(preset: NebulaPreset, scaleId: ScaleId = 'preset'): string {
  if (scaleId === 'preset') return preset.scaleName;
  const root = freqToNoteName(midiToFreq(preset.root)).replace(/-?\d+$/, '');
  return `${root} ${SCALE_MAP[scaleId].name}`;
}

/** 超新星爆发使用的和弦音级（以音阶下标表示） */
export const SUPERNOVA_CHORD = [0, 2, 4, 6, 8, 12];

/** 键盘 A–L 九个键对应的音阶下标 */
export const KEY_DEGREES = [0, 2, 4, 5, 7, 9, 11, 12, 14];

/** 频率 → 最接近的音名（用于 UI 展示） */
export function freqToNoteName(freq: number): string {
  const midi = Math.round(69 + 12 * Math.log2(freq / A4));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${names[n]}${octave}`;
}
