import type { NebulaPreset } from '../types';

export const A4 = 440;

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

/** 交互旋律音阶：比主音高两个八度，清亮不刺耳 */
export function presetScale(preset: NebulaPreset): number[] {
  return buildScale(preset.root + 24, preset.scale, 2);
}

/**
 * Drone 铺底音：[根音, 纯五度, 高八度]
 * 低频 sine + triangle 叠加，形成包裹感
 */
export function presetDrone(preset: NebulaPreset): [number, number, number] {
  const root = midiToFreq(preset.root);
  return [root, root * 1.5, root * 2];
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
