import { Camera, Link2, Sparkles, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import type { FormEvent } from 'react';
import type { NebulaPreset, PresetId } from '../types';

interface Props {
  presets: NebulaPreset[];
  activeId: PresetId;
  onSelect: (id: PresetId) => void;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onCapture: () => void;
  onShare: () => void;
  busy: boolean;
}

/** 底部悬浮玻璃拟态控制栏 */
export default function ControlDock(props: Props) {
  const { presets, activeId, onSelect, value, onChange, onSubmit, onClear } = props;
  const { volume, muted, onVolume, onToggleMute, onCapture, onShare, busy } = props;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="pointer-events-auto w-full max-w-[1080px] rounded-3xl border border-white/[0.12] bg-white/[0.055] p-2.5 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
        {/* 预设 + 动作 */}
        <div className="flex items-center gap-2">
          <div className="scrollbar-none flex flex-1 items-center gap-1.5 overflow-x-auto">
            {presets.map((p) => {
              const active = p.id === activeId;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  title={p.description}
                  className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-all duration-300 ${
                    active
                      ? 'border-white/35 bg-white/15 text-white shadow-[0_0_24px_-6px_rgba(255,255,255,0.5)]'
                      : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:bg-white/[0.08] hover:text-white/85'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full transition-transform duration-300 group-hover:scale-125"
                    style={{
                      background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})`,
                      boxShadow: active ? `0 0 10px ${p.colors[1]}` : 'none',
                    }}
                  />
                  <span className="whitespace-nowrap">{p.name.split(' · ')[1] ?? p.name}</span>
                </button>
              );
            })}
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

            <button
              onClick={onCapture}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/80 transition-all hover:border-white/35 hover:bg-white/15 disabled:opacity-50"
            >
              <Camera size={14} />
              <span className="hidden sm:inline">定格此刻</span>
            </button>

            <button
              onClick={onShare}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/80 transition-all hover:border-white/35 hover:bg-white/15"
            >
              <Link2 size={14} />
              <span className="hidden sm:inline">分享</span>
            </button>
          </div>
        </div>

        {/* 心情输入 */}
        <form
          onSubmit={handleSubmit}
          className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-1.5 focus-within:border-white/30 focus-within:bg-white/[0.07] transition-colors"
        >
          <Sparkles size={15} className="shrink-0 text-white/50" />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={80}
            spellCheck={false}
            placeholder="写下此刻的心情，星云会替你显形…"
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
            生成星云
          </button>
        </form>
      </div>
    </div>
  );
}
