import { Camera, Link2, Music2, Sparkles, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import type { NebulaPreset, PresetId } from '../types';
import { PRESET_MAP, type Inspiration } from '../visual/presets';

interface Props {
  /** idle：待机大星系（灵感词 + 心情输入）；body：具体星体（信息 + 切换 + 输入 + 定格） */
  mode: 'idle' | 'body';
  preset: NebulaPreset;
  inspirations: Inspiration[];
  presets: NebulaPreset[];
  activeId: PresetId;
  onSelect: (id: PresetId) => void;
  onInspire: (word: string) => void;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  /** 效价滑块 -1~1；null 表示跟随文本解析 */
  valence: number | null;
  onValence: (v: number) => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onCapture: () => void;
  onShare: () => void;
  busy: boolean;
}

const chipClass = (active: boolean): string =>
  `group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-all duration-300 ${
    active
      ? 'border-white/35 bg-white/15 text-white shadow-[0_0_24px_-6px_rgba(255,255,255,0.5)]'
      : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:bg-white/[0.08] hover:text-white/85'
  }`;

/** 带渐变色点的轻量胶囊（灵感词 / 星体切换共用） */
function Chip({
  colors,
  label,
  title,
  active = false,
  onClick,
}: {
  colors: [string, string];
  label: ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={title} className={chipClass(active)}>
      <span
        className="h-2 w-2 rounded-full transition-transform duration-300 group-hover:scale-125"
        style={{
          background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
          boxShadow: active ? `0 0 10px ${colors[1]}` : 'none',
        }}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** 底部悬浮玻璃拟态控制栏 */
export default function ControlDock(props: Props) {
  const { mode, preset, inspirations, presets, activeId, onSelect, onInspire } = props;
  const { value, onChange, onSubmit, onClear, valence, onValence } = props;
  const { volume, muted, onVolume, onToggleMute, onCapture, onShare, busy } = props;
  const idle = mode === 'idle';
  const valenceValue = valence ?? 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="pointer-events-auto w-full max-w-[1080px] rounded-3xl border border-white/[0.12] bg-white/[0.055] p-2.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
        {/* 星体态：天文观测名称 · 诗意解读 · 音阶演奏提示 · 定格明信片 */}
        {!idle && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1.5 pb-2 pt-0.5">
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${preset.colors[0]}, ${preset.colors[1]})`,
                  boxShadow: `0 0 10px ${preset.colors[1]}`,
                }}
              />
              <span className="text-[13px] text-white">{preset.name}</span>
              <span className="text-[9px] tracking-[0.24em] text-white/35">{preset.english}</span>
            </div>
            <p className="min-w-0 flex-[1_1_200px] text-[11.5px] leading-5 text-white/55">
              {preset.description}
            </p>
            <div className="hidden shrink-0 items-center gap-1.5 text-[11px] text-white/45 lg:flex">
              <Music2 size={12} />
              <span>
                按 <span className="font-mono text-white/75">A – L</span> 拨弦 · {preset.scaleName}
              </span>
            </div>
            <button
              onClick={onCapture}
              disabled={busy}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.1] px-3.5 py-1.5 text-[12px] text-white/90 transition-all hover:border-white/40 hover:bg-white/20 disabled:opacity-50"
            >
              <Camera size={14} />
              <span className="hidden sm:inline">定格星云明信片</span>
              <span className="sm:hidden">定格</span>
            </button>
          </div>
        )}

        {/* 待机态：6 个灵感词 / 星体态：6 大星体切换 + 音量 + 分享 */}
        <div className="flex items-center gap-2">
          <div className="scrollbar-none flex flex-1 items-center gap-1.5 overflow-x-auto">
            {idle
              ? inspirations.map(({ word, presetId }) => {
                  const p = PRESET_MAP[presetId];
                  return (
                    <Chip
                      key={word}
                      colors={[p.colors[0], p.colors[1]]}
                      label={word}
                      title={`${p.name} · ${p.description}`}
                      onClick={() => onInspire(word)}
                    />
                  );
                })
              : presets.map((p) => (
                  <Chip
                    key={p.id}
                    colors={[p.colors[0], p.colors[1]]}
                    label={p.name.split(' · ')[1] ?? p.name}
                    title={p.description}
                    active={p.id === activeId}
                    onClick={() => onSelect(p.id)}
                  />
                ))}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* 音量 */}
            <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5 sm:flex">
              <button
                onClick={onToggleMute}
                className="text-white/60 transition-colors hover:text-white"
                title={muted ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? <VolumeX size={15} /> : volume < 0.5 ? <Volume1 size={15} /> : <Volume2 size={15} />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((muted ? 0 : volume) * 100)}
                onChange={(e) => onVolume(Number(e.target.value) / 100)}
                className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/20 accent-white/80"
                style={{ accentColor: 'rgba(255,255,255,0.85)' }}
              />
            </div>

            {!idle && (
              <button
                onClick={onShare}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/80 transition-all hover:border-white/35 hover:bg-white/15"
              >
                <Link2 size={14} />
                <span className="hidden sm:inline">分享</span>
              </button>
            )}
          </div>
        </div>

        {/* 效价滑块：低落 ↔ 明亮，连续改变星云形态与配色 */}
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
          <span className="shrink-0 text-[11px] text-white/45">低落</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={Math.round(valenceValue * 100)}
            onChange={(e) => onValence(Number(e.target.value) / 100)}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20"
            aria-label="情绪效价滑块：低落至明亮"
          />
          <span className="shrink-0 text-[11px] text-white/45">明亮</span>
          <span className="hidden w-10 shrink-0 text-right font-mono text-[10px] text-white/35 sm:inline">
            {valence === null ? '跟随' : `${valenceValue > 0 ? '+' : ''}${valenceValue.toFixed(1)}`}
          </span>
        </div>

        {/* 心情输入 */}
        <form
          onSubmit={handleSubmit}
          className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-1.5 transition-colors focus-within:border-white/30 focus-within:bg-white/[0.07]"
        >
          <Sparkles size={15} className="shrink-0 text-white/50" />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={80}
            spellCheck={false}
            placeholder={idle ? '写下此刻的心情，星云会替你显形…' : '换一种心情，再次潜入…'}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-white placeholder:text-white/30 focus:outline-none"
          />
          {value && (
            <button
              type="button"
              onClick={onClear}
              aria-label="清空"
              className="shrink-0 rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
              title="清空"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="submit"
            disabled={!value.trim()}
            className="shrink-0 rounded-xl border border-white/20 bg-white/12 px-3.5 py-1.5 text-[12px] text-white transition-all hover:border-white/40 hover:bg-white/20 disabled:opacity-35"
          >
            {idle ? '潜入星云' : '再次潜入'}
          </button>
        </form>
      </div>
    </div>
  );
}
