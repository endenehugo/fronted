import type { EmotionVector, NebulaState, Palette, PresetId, ThemeMode } from '../types';
import { getPreset } from '../visual/presets';

/**
 * 无后端 URL 状态分享
 * JSON → LZW 压缩 → Base64URL → window.location.hash（#nebula=eyJ...）
 */

const KEY = 'nebula';

// ---------------------------------------------------------------- LZW

function lzwCompress(input: string): string {
  if (!input) return '';
  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  let dictSize = 256;
  let w = '';
  const codes: number[] = [];

  for (const ch of input) {
    const wc = w + ch;
    if (dict.has(wc)) {
      w = wc;
    } else {
      codes.push(dict.get(w)!);
      dict.set(wc, dictSize++);
      w = ch;
    }
  }
  if (w) codes.push(dict.get(w)!);

  // 每个码位用 2 个字符承载（支持到 65535 个词条）
  let out = '';
  for (let i = 0; i < codes.length; i += 4096) {
    const chunk = codes.slice(i, i + 4096);
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function lzwDecompress(input: string): string {
  if (!input) return '';
  const dict = new Map<number, string>();
  for (let i = 0; i < 256; i++) dict.set(i, String.fromCharCode(i));
  let dictSize = 256;

  const codes: number[] = [];
  for (let i = 0; i < input.length; i++) codes.push(input.charCodeAt(i));

  let w = String.fromCharCode(codes[0]);
  let result = w;
  for (let i = 1; i < codes.length; i++) {
    const k = codes[i];
    let entry = dict.get(k);
    if (entry === undefined) {
      if (k !== dictSize) throw new Error('LZW: invalid code');
      entry = w + w[0];
    }
    result += entry;
    dict.set(dictSize++, w + entry[0]);
    w = entry;
  }
  return result;
}

// ---------------------------------------------------------------- Base64URL

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- 编解码

export function encodeState(state: NebulaState): string {
  const json = JSON.stringify({
    p: state.presetId,
    t: state.customText,
    c: state.colors,
    tb: Math.round(state.turbulence * 100) / 100,
    sp: Math.round(state.speed * 100) / 100,
    sd: state.seed,
    e: state.emotion
      ? [
          Math.round(state.emotion.valence * 1000) / 1000,
          Math.round(state.emotion.arousal * 1000) / 1000,
          Math.round(state.emotion.mystery * 1000) / 1000,
        ]
      : null,
    th: state.theme,
  });
  try {
    return toBase64Url(lzwCompress(json));
  } catch {
    return toBase64Url(json);
  }
}

export function decodeState(payload: string): NebulaState | null {
  if (!payload) return null;
  const tryParse = (raw: string): NebulaState | null => {
    try {
      const obj = JSON.parse(raw);
      const preset = getPreset(obj.p);
      const emotion: EmotionVector | null = Array.isArray(obj.e)
        ? {
            valence: Number(obj.e[0]) || 0,
            arousal: Number(obj.e[1]) || 0,
            mystery: Number(obj.e[2]) || 0,
          }
        : null;
      const colors: Palette =
        Array.isArray(obj.c) && obj.c.length === 3
          ? [String(obj.c[0]), String(obj.c[1]), String(obj.c[2])]
          : preset.colors;
      return {
        presetId: preset.id as PresetId,
        customText: typeof obj.t === 'string' ? obj.t.slice(0, 120) : '',
        colors,
        turbulence: Number.isFinite(obj.tb) ? Number(obj.tb) : preset.turbulence,
        speed: Number.isFinite(obj.sp) ? Number(obj.sp) : preset.speed,
        seed: Number.isFinite(obj.sd) ? Number(obj.sd) : 1,
        emotion,
        theme: obj.th === 'light' ? ('light' as ThemeMode) : ('dark' as ThemeMode),
      };
    } catch {
      return null;
    }
  };

  // 先按 LZW 解压，失败则回退为明文 JSON
  try {
    const plain = lzwDecompress(fromBase64Url(payload));
    const state = tryParse(plain);
    if (state) return state;
  } catch {
    /* fallthrough */
  }
  try {
    return tryParse(fromBase64Url(payload));
  } catch {
    return null;
  }
}

export function writeStateToHash(state: NebulaState): void {
  const payload = encodeState(state);
  const hash = `#${KEY}=${payload}`;
  if (window.location.hash === hash) return;
  try {
    window.history.replaceState(null, '', hash);
  } catch {
    window.location.hash = hash;
  }
}

export function readStateFromHash(): NebulaState | null {
  const raw = window.location.hash;
  if (!raw || raw.length < 2) return null;
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  const idx = body.indexOf(`${KEY}=`);
  if (idx === -1) return null;
  const payload = body.slice(idx + KEY.length + 1).split('&')[0];
  return decodeState(payload);
}

export function clearStateHash(): void {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* noop */
  }
}

/** 生成当前状态的分享链接 */
export function buildShareUrl(state: NebulaState): string {
  const payload = encodeState(state);
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${KEY}=${payload}`;
}
