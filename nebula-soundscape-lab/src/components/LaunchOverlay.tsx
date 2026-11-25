import { AudioLines, Headphones, Sparkles } from 'lucide-react';
import type { NebulaPreset, ThemeMode } from '../types';

interface Props {
  preset: NebulaPreset;
  theme: ThemeMode;
  onLaunch: () => void;
  fading?: boolean;
}

/** 首屏奇点唤醒遮罩：解锁 AudioContext + 星云展开；明场沿用宣纸水墨基调 */
export default function LaunchOverlay({ preset, theme, onLaunch, fading = false }: Props) {
  const light = theme === 'light';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden transition-opacity duration-[1200ms] ease-out ${
        fading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      style={{
        background: light
          ? 'radial-gradient(ellipse at 50% 45%, #f3ede0 0%, #e8ddc9 55%, #d9cbb0 100%)'
          : `radial-gradient(ellipse at 50% 45%, ${preset.bg} 0%, #04060f 55%, #000 100%)`,
      }}
    >
      {/* 星点 / 墨絮背景 */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        {Array.from({ length: 60 }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${(i * 37.7) % 100}%`,
              top: `${(i * 53.3) % 100}%`,
              width: `${1 + (i % 3)}px`,
              height: `${1 + (i % 3)}px`,
              background: light ? 'rgba(74,62,48,0.5)' : '#ffffff',
              opacity: 0.15 + ((i * 7) % 10) / 22,
              animation: `float ${6 + (i % 7)}s ease-in-out ${-(i % 9)}s infinite`,
            }}
          />
        ))}
      </div>

      {/* 光晕 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background: `radial-gradient(circle, ${preset.colors[1]}55 0%, transparent 70%)`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <div
          className={`animate-fade-up mb-6 flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] tracking-[0.32em] backdrop-blur-md ${
            light
              ? 'border-[rgba(74,62,48,0.2)] bg-[rgba(255,253,247,0.5)] text-[rgba(43,38,32,0.7)]'
              : 'border-white/15 bg-white/5 text-white/60'
          }`}
        >
          <Sparkles size={12} className={light ? 'text-[#a63a2e]' : 'text-white/70'} />
          2026 QODER · LIFEHACK
        </div>

        <h1
          className={`animate-fade-up bg-gradient-to-r bg-clip-text text-[clamp(40px,7vw,84px)] font-semibold leading-none tracking-tight text-transparent [animation-delay:120ms] ${
            light ? 'font-title' : ''
          } ${light ? 'from-[#2b2620] via-[#2b2620] to-[rgba(43,38,32,0.6)]' : 'from-white via-white to-white/60'}`}
        >
          星云声景实验室
        </h1>
        <p
          className={`animate-fade-up mt-5 text-[12px] tracking-[0.55em] [animation-delay:220ms] ${
            light ? 'text-[rgba(43,38,32,0.5)]' : 'text-white/45'
          }`}
        >
          NEBULA SOUNDSCAPE LAB
        </p>

        <p
          className={`animate-fade-up mt-10 max-w-md text-[15px] leading-7 [animation-delay:320ms] ${
            light ? 'text-[rgba(43,38,32,0.6)]' : 'text-white/55'
          }`}
        >
          一片由你的情绪点燃的星云。
          <br />
          拖动视角，长按坍缩，松开引爆；按下 <span className={light ? 'font-mono text-[rgba(43,38,32,0.8)]' : 'font-mono text-white/80'}>A – L</span>{' '}
          拨动星弦。
        </p>

        <div className="animate-fade-up relative mt-12 [animation-delay:420ms]">
          <span
            className="absolute inset-0 rounded-full blur-2xl"
            style={{ background: `${preset.colors[1]}66` }}
          />
          <button
            onClick={onLaunch}
            className={`group relative flex items-center gap-3 rounded-full border px-9 py-4 text-sm tracking-[0.18em] backdrop-blur-xl transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] ${
              light
                ? 'border-[rgba(74,62,48,0.3)] bg-[rgba(255,253,247,0.7)] text-[#2b2620] hover:border-[#a63a2e]'
                : 'border-white/25 bg-white/10 text-white hover:border-white/50 hover:bg-white/15'
            }`}
          >
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full ${
                  light ? 'bg-[#a63a2e]/70' : 'bg-white/70'
                }`}
              />
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  light ? 'bg-[#a63a2e]' : 'bg-white'
                }`}
              />
            </span>
            IGNITE NEBULA
            <span className={light ? 'text-[rgba(43,38,32,0.5)]' : 'text-white/50'}>·</span>
            <span className={light ? 'text-[rgba(43,38,32,0.8)]' : 'text-white/80'}>唤醒星云</span>
          </button>
        </div>

        <div
          className={`animate-fade-up mt-10 flex items-center gap-5 text-[11px] tracking-wider [animation-delay:520ms] ${
            light ? 'text-[rgba(43,38,32,0.45)]' : 'text-white/35'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Headphones size={13} />
            建议佩戴耳机
          </span>
          <span className="flex items-center gap-1.5">
            <AudioLines size={13} />
            纯前端实时合成 · 零外部音频
          </span>
        </div>
      </div>
    </div>
  );
}
