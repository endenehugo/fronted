import type { TimbreId } from '../types';

/** 音色元数据：合成配方见 NebulaAudioEngine.playNote */
export interface TimbreDef {
  id: TimbreId;
  name: string;
  recipe: string;
}

export const TIMBRE_LIST: TimbreDef[] = [
  { id: 'crystal_bowl', name: '水晶颂钵', recipe: '三正弦叠置 · 慢起音 · 长释放' },
  { id: 'pluck_harp', name: '尼龙拨弦', recipe: '三角波 · 低通 3200→320Hz 扫频' },
  { id: 'cosmic_rhodes', name: '太空电钢', recipe: 'FM 调制 · 0.4Hz 立体声摇摆' },
  { id: 'vibraphone', name: '太空颤音琴', recipe: '正弦 + 金属泛音 · 5.5Hz 颤音' },
  { id: 'synth_pad', name: '温暖垫音', recipe: '双失谐锯齿/三角 · 慢扫频低通' },
  { id: 'nebula_brass', name: '深空号角', recipe: '三锯齿 · 共振低通 180→1600Hz' },
  { id: 'ethereal_choir', name: '空灵合唱', recipe: '失谐锯齿 · 三母音共振峰' },
  { id: 'arp_pluck', name: '脉冲琶音', recipe: '锯齿 + 低八度正弦 · 高共振低通' },
];
