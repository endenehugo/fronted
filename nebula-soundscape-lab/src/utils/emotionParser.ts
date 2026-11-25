import type { EmotionVector, NebulaPreset, Palette, PresetId } from '../types';
import { nearestPreset } from '../visual/presets';

/**
 * 本地中文 / 英文心情解析器
 * 情感维度词典（Valence 效价 / Arousal 唤醒度 / Mystery 神秘感）
 * + 否定词、程度副词权重计算，纯前端零延迟。
 */

export interface EmotionResult {
  vector: EmotionVector;
  preset: NebulaPreset;
  colors: Palette;
  turbulence: number;
  speed: number;
  log: string;
  matched: string[];
  intensity: number;
}

interface LexiconEntry {
  v: number;
  a: number;
  m: number;
}

const LEXICON: Record<string, LexiconEntry> = {
  // ---- 正向 ----
  开心: { v: 0.8, a: 0.5, m: 0 },
  高兴: { v: 0.8, a: 0.55, m: 0 },
  快乐: { v: 0.85, a: 0.6, m: 0 },
  幸福: { v: 0.85, a: 0.35, m: 0.1 },
  喜悦: { v: 0.8, a: 0.55, m: 0 },
  兴奋: { v: 0.7, a: 0.85, m: 0.05 },
  激动: { v: 0.65, a: 0.9, m: 0 },
  狂喜: { v: 0.9, a: 0.95, m: 0 },
  欣喜: { v: 0.85, a: 0.75, m: 0 },
  期待: { v: 0.6, a: 0.55, m: 0.2 },
  希望: { v: 0.7, a: 0.3, m: 0.4 },
  值得: { v: 0.72, a: 0.12, m: 0.2 },
  有意义: { v: 0.68, a: 0.25, m: 0.25 },
  成就感: { v: 0.75, a: 0.4, m: 0.1 },
  满足感: { v: 0.7, a: 0.1, m: 0.1 },
  欣慰: { v: 0.65, a: 0.05, m: 0.2 },
  庆幸: { v: 0.6, a: 0.1, m: 0.25 },
  骄傲: { v: 0.7, a: 0.45, m: 0 },
  轻松: { v: 0.55, a: -0.45, m: 0.05 },
  舒心: { v: 0.6, a: -0.35, m: 0.1 },
  畅快: { v: 0.7, a: 0.45, m: 0 },
  痛快: { v: 0.65, a: 0.6, m: 0 },
  发泄: { v: 0.2, a: 0.75, m: 0.15 },
  宣泄: { v: 0.25, a: 0.7, m: 0.2 },
  释放: { v: 0.3, a: 0.6, m: 0.2 },
  放下: { v: 0.5, a: -0.3, m: 0.25 },
  坦然: { v: 0.45, a: -0.35, m: 0.2 },
  从容: { v: 0.45, a: -0.4, m: 0.1 },
  心流: { v: 0.5, a: 0.3, m: 0.3 },
  松弛: { v: 0.5, a: -0.55, m: 0.05 },
  安然: { v: 0.45, a: -0.5, m: 0.15 },
  释怀: { v: 0.6, a: -0.2, m: 0.3 },
  温暖: { v: 0.65, a: 0.1, m: 0.1 },
  感动: { v: 0.6, a: 0.35, m: 0.25 },
  治愈: { v: 0.65, a: -0.25, m: 0.35 },
  平静: { v: 0.4, a: -0.65, m: 0.2 },
  宁静: { v: 0.45, a: -0.7, m: 0.25 },
  安静: { v: 0.3, a: -0.7, m: 0.2 },
  放松: { v: 0.5, a: -0.55, m: 0.1 },
  舒缓: { v: 0.45, a: -0.5, m: 0.15 },
  踏实: { v: 0.45, a: -0.25, m: 0 },
  满足: { v: 0.6, a: -0.1, m: 0.1 },
  专注: { v: 0.3, a: 0.35, m: 0.05 },
  清醒: { v: 0.35, a: 0.45, m: 0 },
  灵感: { v: 0.55, a: 0.55, m: 0.5 },
  好奇: { v: 0.35, a: 0.4, m: 0.55 },
  甜蜜: { v: 0.75, a: 0.35, m: 0.1 },
  自豪: { v: 0.7, a: 0.45, m: 0 },

  // ---- 负向 ----
  难过: { v: -0.75, a: -0.35, m: 0.15 },
  悲伤: { v: -0.8, a: -0.4, m: 0.2 },
  伤心: { v: -0.8, a: -0.3, m: 0.15 },
  失落: { v: -0.65, a: -0.45, m: 0.2 },
  沮丧: { v: -0.7, a: -0.4, m: 0.2 },
  低落: { v: -0.6, a: -0.5, m: 0.15 },
  绝望: { v: -0.9, a: 0.35, m: 0.45 },
  崩溃: { v: -0.85, a: 0.85, m: 0.1 },
  孤独: { v: -0.65, a: -0.35, m: 0.4 },
  寂寞: { v: -0.6, a: -0.35, m: 0.35 },
  疲惫: { v: -0.55, a: -0.65, m: 0.1 },
  疲倦: { v: -0.5, a: -0.6, m: 0.1 },
  累: { v: -0.45, a: -0.55, m: 0 },
  倦: { v: -0.4, a: -0.5, m: 0 },
  焦虑: { v: -0.6, a: 0.7, m: 0.2 },
  烦躁: { v: -0.65, a: 0.7, m: 0 },
  紧张: { v: -0.45, a: 0.65, m: 0.1 },
  压力: { v: -0.5, a: 0.4, m: 0.1 },
  焦灼: { v: -0.65, a: 0.75, m: 0.1 },
  愤怒: { v: -0.85, a: 0.85, m: 0 },
  生气: { v: -0.8, a: 0.8, m: 0 },
  愤慨: { v: -0.8, a: 0.8, m: 0 },
  委屈: { v: -0.7, a: 0.3, m: 0.2 },
  内耗: { v: -0.7, a: 0.35, m: 0.3 },
  熬夜: { v: -0.4, a: -0.2, m: 0.1 },
  加班: { v: -0.45, a: -0.1, m: 0.1 },
  心累: { v: -0.65, a: -0.55, m: 0.15 },
  撑不住: { v: -0.75, a: -0.2, m: 0.2 },
  迷茫: { v: -0.35, a: 0.1, m: 0.7 },
  迷失: { v: -0.5, a: 0.05, m: 0.7 },
  空虚: { v: -0.55, a: -0.45, m: 0.6 },
  无力: { v: -0.6, a: -0.55, m: 0.15 },
  无助: { v: -0.75, a: -0.2, m: 0.35 },
  忐忑: { v: -0.4, a: 0.5, m: 0.3 },
  不安: { v: -0.55, a: 0.5, m: 0.3 },
  遗憾: { v: -0.55, a: -0.1, m: 0.25 },

  // ---- 中性 / 神秘 ----
  神秘: { v: 0.1, a: 0.1, m: 0.85 },
  未知: { v: 0.0, a: 0.15, m: 0.8 },
  深邃: { v: 0.05, a: -0.1, m: 0.75 },
  空旷: { v: 0.0, a: -0.3, m: 0.65 },
  安宁: { v: 0.4, a: -0.7, m: 0.3 },
  沉浸: { v: 0.35, a: 0.15, m: 0.45 },
  出神: { v: 0.1, a: -0.2, m: 0.6 },

  // ---- 英文 ----
  happy: { v: 0.8, a: 0.5, m: 0 },
  joy: { v: 0.85, a: 0.6, m: 0 },
  joyful: { v: 0.85, a: 0.6, m: 0 },
  excited: { v: 0.7, a: 0.85, m: 0.05 },
  euphoric: { v: 0.9, a: 0.95, m: 0 },
  calm: { v: 0.4, a: -0.65, m: 0.2 },
  peaceful: { v: 0.45, a: -0.7, m: 0.25 },
  serene: { v: 0.45, a: -0.7, m: 0.25 },
  relaxed: { v: 0.5, a: -0.55, m: 0.1 },
  content: { v: 0.6, a: -0.1, m: 0.1 },
  hopeful: { v: 0.7, a: 0.3, m: 0.4 },
  grateful: { v: 0.65, a: 0.15, m: 0.15 },
  warm: { v: 0.65, a: 0.1, m: 0.1 },
  healing: { v: 0.65, a: -0.25, m: 0.35 },
  tired: { v: -0.55, a: -0.65, m: 0.1 },
  exhausted: { v: -0.7, a: -0.6, m: 0.1 },
  drained: { v: -0.65, a: -0.6, m: 0.1 },
  sad: { v: -0.8, a: -0.4, m: 0.2 },
  melancholy: { v: -0.7, a: -0.35, m: 0.55 },
  lonely: { v: -0.65, a: -0.35, m: 0.4 },
  anxious: { v: -0.6, a: 0.7, m: 0.2 },
  anxiousness: { v: -0.6, a: 0.7, m: 0.2 },
  stressed: { v: -0.55, a: 0.55, m: 0.1 },
  angry: { v: -0.85, a: 0.85, m: 0 },
  frustrated: { v: -0.7, a: 0.7, m: 0.05 },
  lost: { v: -0.5, a: 0.05, m: 0.7 },
  empty: { v: -0.55, a: -0.45, m: 0.6 },
  overwhelmed: { v: -0.7, a: 0.8, m: 0.15 },
  mystery: { v: 0.1, a: 0.1, m: 0.85 },
  mysterious: { v: 0.1, a: 0.1, m: 0.85 },
  wonder: { v: 0.45, a: 0.4, m: 0.6 },
  focused: { v: 0.3, a: 0.35, m: 0.05 },
  inspired: { v: 0.55, a: 0.55, m: 0.5 },
  catharsis: { v: -0.2, a: 0.75, m: 0.3 },
  worth: { v: 0.7, a: 0.1, m: 0.2 },
  worthwhile: { v: 0.75, a: 0.1, m: 0.2 },
};

type ModifierType = 'neg' | 'int' | 'dim';

const MODIFIERS: { key: string; type: ModifierType; weight: number }[] = [
  { key: '并不是', type: 'neg', weight: 1 },
  { key: '并不是', type: 'neg', weight: 1 },
  { key: '不太', type: 'dim', weight: 0.6 },
  { key: '不怎么', type: 'dim', weight: 0.5 },
  { key: '一点也', type: 'neg', weight: 1 },
  { key: '并不', type: 'neg', weight: 1 },
  { key: '没有', type: 'neg', weight: 1 },
  { key: '不是', type: 'neg', weight: 0.95 },
  { key: '不再', type: 'neg', weight: 0.9 },
  { key: '从未', type: 'neg', weight: 1 },
  { key: '毫无', type: 'neg', weight: 1 },
  { key: '无法', type: 'neg', weight: 0.9 },
  { key: '不', type: 'neg', weight: 1 },
  { key: '没', type: 'neg', weight: 0.95 },
  { key: '无', type: 'neg', weight: 0.9 },
  { key: '非', type: 'neg', weight: 0.85 },
  { key: '别', type: 'neg', weight: 0.8 },
  { key: '未', type: 'neg', weight: 0.85 },
  { key: 'never', type: 'neg', weight: 1 },
  { key: 'not', type: 'neg', weight: 1 },
  { key: 'no', type: 'neg', weight: 1 },
  { key: 'without', type: 'neg', weight: 0.9 },
  { key: "n't", type: 'neg', weight: 1 },

  { key: '非常', type: 'int', weight: 1.75 },
  { key: '特别', type: 'int', weight: 1.7 },
  { key: '极其', type: 'int', weight: 1.95 },
  { key: '格外', type: 'int', weight: 1.6 },
  { key: '十分', type: 'int', weight: 1.6 },
  { key: '相当', type: 'int', weight: 1.45 },
  { key: '超级', type: 'int', weight: 1.85 },
  { key: '超', type: 'int', weight: 1.7 },
  { key: '很', type: 'int', weight: 1.5 },
  { key: '太', type: 'int', weight: 1.6 },
  { key: 'really', type: 'int', weight: 1.5 },
  { key: 'very', type: 'int', weight: 1.5 },
  { key: 'so', type: 'int', weight: 1.45 },
  { key: 'extremely', type: 'int', weight: 1.95 },
  { key: 'incredibly', type: 'int', weight: 1.9 },
  { key: 'totally', type: 'int', weight: 1.6 },
  { key: 'super', type: 'int', weight: 1.7 },

  { key: '有点', type: 'dim', weight: 0.6 },
  { key: '有些', type: 'dim', weight: 0.62 },
  { key: '稍微', type: 'dim', weight: 0.5 },
  { key: '略微', type: 'dim', weight: 0.48 },
  { key: '一点点', type: 'dim', weight: 0.55 },
  { key: 'a bit', type: 'dim', weight: 0.6 },
  { key: 'slightly', type: 'dim', weight: 0.5 },
  { key: 'somewhat', type: 'dim', weight: 0.55 },
];

const ALL_KEYS = Array.from(new Set([...Object.keys(LEXICON), ...MODIFIERS.map((m) => m.key)])).sort(
  (a, b) => b.length - a.length,
);

const isAsciiWord = (s: string) => /^[a-z']+$/.test(s);

interface Token {
  key: string;
  index: number;
  end: number;
}

function scan(text: string): Token[] {
  const lower = text.toLowerCase();
  const tokens: Token[] = [];
  let i = 0;
  while (i < lower.length) {
    let hit: string | null = null;
    for (const key of ALL_KEYS) {
      if (!lower.startsWith(key, i)) continue;
      // 英文词需保证词边界，避免 "note" 命中 "not"
      if (isAsciiWord(key)) {
        const before = i > 0 ? lower[i - 1] : ' ';
        const after = i + key.length < lower.length ? lower[i + key.length] : ' ';
        if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;
      }
      hit = key;
      break;
    }
    if (hit) {
      tokens.push({ key: hit, index: i, end: i + hit.length });
      i += hit.length;
    } else {
      i += 1;
    }
  }
  return tokens;
}

const clamp = (n: number, min = -1, max = 1) => Math.min(max, Math.max(min, n));

/** 解析任意中英文短句为情感向量 + 星云参数 */
export function analyzeEmotion(text: string): EmotionResult {
  const tokens = scan(text || '');
  let v = 0;
  let a = 0;
  let m = 0;
  let count = 0;
  let intensity = 0;
  const matched: string[] = [];

  const pendingModifiers: { type: ModifierType; weight: number }[] = [];

  for (const token of tokens) {
    const modifier = MODIFIERS.find((x) => x.key === token.key);
    if (modifier) {
      pendingModifiers.push({ type: modifier.type, weight: modifier.weight });
      continue;
    }
    const entry = LEXICON[token.key];
    if (!entry) {
      pendingModifiers.length = 0;
      continue;
    }

    let weight = 1;
    let flipped = false;
    for (const mod of pendingModifiers) {
      if (mod.type === 'neg') {
        flipped = !flipped;
      } else {
        weight *= mod.weight;
      }
    }
    pendingModifiers.length = 0;

    let ev = entry.v * weight;
    let ea = entry.a * weight;
    let em = entry.m * weight;
    if (flipped) {
      // 否定反转效价，同时提升神秘感（不确定性）
      ev = -ev * 0.85;
      em = em * 0.9 + 0.18;
    }
    v += ev;
    a += ea;
    m += em;
    intensity += Math.abs(ev) + Math.abs(ea) * 0.6;
    count += 1;
    matched.push(token.key);
  }

  let vector: EmotionVector;
  if (count === 0) {
    // 无命中：按文本长度给出轻微神秘倾向的中性向量
    const len = (text || '').trim().length;
    vector = { valence: 0.05, arousal: len > 12 ? 0.12 : 0.02, mystery: 0.4 };
  } else {
    const norm = 1 / Math.max(1, Math.sqrt(count));
    vector = {
      valence: clamp(v * norm * 1.25),
      arousal: clamp(a * norm * 1.25),
      mystery: clamp(m * norm * 1.4),
    };
  }

  const preset = nearestPreset(vector);
  const colors = blendPalette(preset, vector);
  const turbulence = clamp(preset.turbulence * (0.78 + vector.arousal * 0.32), 0.25, 1.9);
  const speed = clamp(preset.speed * (0.86 + vector.arousal * 0.3), 0.25, 2.2);
  const log = buildLog(preset, vector, matched);

  return {
    vector,
    preset,
    colors,
    turbulence,
    speed,
    log,
    matched,
    intensity: clamp(intensity / Math.max(1, count), 0, 1),
  };
}

// ---------------------------------------------------------------- 颜色

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return [h, s, l];
}

/**
 * 由情感向量微调预设调色板：
 * 以预设色为基准做色相偏移（保持星系辨识度），再用唤醒度调整饱和度与明度。
 */
export function blendPalette(preset: NebulaPreset, e: EmotionVector): Palette {
  return preset.colors.map((hex, i) => {
    const [h, s, l] = rgbToHsl(...hexToRgb(hex));
    const hue = (h - e.valence * 34 + e.mystery * 24 + 360) % 360;
    const sat = Math.min(1, Math.max(0.25, s * (0.92 + e.arousal * 0.22)));
    const light = Math.min(0.95, Math.max(0.06, l + e.valence * 0.05 + e.arousal * 0.04 + (i === 0 ? 0.02 : 0)));
    return hslToHex(hue, sat * 100, light * 100);
  }) as Palette;
}

// ---------------------------------------------------------------- 观测日志

const LOG_TEMPLATES: Record<PresetId, string[]> = {
  // 待机大星系不会由最近邻匹配命中，仅用于补全 Record 类型
  galaxy_idle: ['星系静默。'],
  serenity: [
    '星云以 {speed} 的转速缓缓舒展，旋臂之间流淌着 {note} 的余韵。',
    '低湍流，深呼吸。你看见的是一片被「{kw}」染透的静海。',
    '此刻的星际介质近乎静止，只有内核还在随 {note} 轻轻起伏。',
  ],
  euphoria: [
    '核心温度骤升，{note} 的琶音沿旋臂一路点燃到外晕。',
    '「{kw}」把星云推到临界转速，星点在 shock front 上炸成金色的雨。',
    '高泛光，高自转。这是一次没有任何保留的燃烧。',
  ],
  melancholy: [
    '旋臂缓慢下沉，{note} 在引力井底部折射出很长的影子。',
    '「{kw}」让光都走得慢了一些，深空里只剩下低频的呼吸。',
    '紧致的旋涡收拢，像一句没有说出口的话。',
  ],
  focus: [
    '双环结构稳定成形，{note} 的脉冲像节拍器一样准确。',
    '「{kw}」被折算成清晰的律动，每一颗粒子都落在该落的位置。',
    '噪声退到背景，只剩一条笔直的注意力轴线。',
  ],
  catharsis: [
    '湍流撕裂旋臂，{note} 的和弦在碰撞中被反复擦亮。',
    '「{kw}」沿着激波向外释放，红巨星的壳层正在剥落。',
    '剧烈，但不混乱——所有能量都找到了出口。',
  ],
  healing: [
    '云雾以极慢的速度向外扩散，{note} 的加九音像暖流一样铺开。',
    '「{kw}」被折成柔和的泛音，落在创生之柱的脊线上。',
    '没有方向，只有温度。星云正在自己愈合。',
  ],
};

function buildLog(preset: NebulaPreset, e: EmotionVector, matched: string[]): string {
  const templates = LOG_TEMPLATES[preset.id] ?? LOG_TEMPLATES.serenity;
  const tpl = templates[Math.floor(Math.random() * templates.length)];
  const kw = matched.length ? matched.slice(0, 2).join(' · ') : preset.label;
  const speedWord =
    e.arousal > 0.5 ? '极快' : e.arousal > 0.15 ? '轻快' : e.arousal > -0.15 ? '适中' : e.arousal > -0.5 ? '缓慢' : '近乎静止';
  return tpl.replace('{kw}', kw).replace('{note}', preset.scaleName).replace('{speed}', speedWord);
}

export function emptyResult(): EmotionResult {
  const preset = nearestPreset({ valence: 0, arousal: 0, mystery: 0 });
  return {
    vector: { valence: 0, arousal: 0, mystery: 0 },
    preset,
    colors: preset.colors,
    turbulence: preset.turbulence,
    speed: preset.speed,
    log: '',
    matched: [],
    intensity: 0,
  };
}
