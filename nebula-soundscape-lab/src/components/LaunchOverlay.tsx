import { AudioLines, Headphones, Sparkles } from 'lucide-react';
import type { NebulaPreset } from '../types';

interface Props {
  preset: NebulaPreset;
  onLaunch: () => void;
  fading?: boolean;
}

/** 首屏奇点唤醒遮罩：解锁 AudioContext + 星云展开 */
export default function LaunchOverlay({ preset, onLaunch, fading = false }: Props) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden transition-opacity duration-[1200ms] ease-out ${
        fading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      style={{
        background: `radial-gradient(ellipse at 50% 45%, ${preset.bg} 0%, #04060f 55%, #000 100%)`,
      }}
    >
      {/* 星点背景 */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        {Array.from({ length: 60 }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${(i * 37.7) % 100}%`,
              top: `${(i * 53.3) % 100}%`,
              width: `${1 + (i % 3)}px`,
              height: `${1 + (i % 3)}px`,
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
        <div className="animate-fade-up mb-6 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] tracking-[0.32em] text-white/60 backdrop-blur-md">
          <Sparkles size={12} className="text-white/70" />
          2026 QODER · LIFEHACK
        </div>

        <h1 className="animate-fade-up bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-[clamp(40px,7vw,84px)] font-semibold leading-none tracking-tight text-transparent [animation-delay:120ms]">
          星云声景实验室
        </h1>
        <p className="animate-fade-up mt-5 text-[12px] tracking-[0.55em] text-white/45 [animation-delay:220ms]">
          NEBULA SOUNDSCAPE LAB
        </p>

        <p className="animate-fade-up mt-10 max-w-md text-[15px] leading-7 text-white/55 [animation-delay:320ms]">
          一片由你的情绪点燃的星云。
          <br />
          拖动视角，长按坍缩，松开引爆；按下 <span className="font-mono text-white/80">A – L</span>{' '}
          拨动星弦。
        </p>

        <div className="animate-fade-up relative mt-12 [animation-delay:420ms]">
          <span
            className="absolute inset-0 rounded-full blur-2xl"
            style={{ background: `${preset.colors[1]}66` }}
          />
          <button
            onClick={onLaunch}
            className="group relative flex items-center gap-3 rounded-full border border-white/25 bg-white/10 px-9 py-4 text-sm tracking-[0.18em] text-white backdrop-blur-xl transition-all duration-300 hover:scale-[1.03] hover:border-white/50 hover:bg-white/15 active:scale-[0.98]"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            IGNITE NEBULA
            <span className="text-white/50">·</span>
            <span className="text-white/80">唤醒星云</span>
          </button>
        </div>

        <div className="animate-fade-up mt-10 flex items-center gap-5 text-[11px] tracking-wider text-white/35 [animation-delay:520ms]">
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
