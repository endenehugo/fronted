import { ArrowDown, Headphones } from 'lucide-react';
import type { NebulaPreset } from '../types';

interface Props {
  preset: NebulaPreset;
  onLaunch: () => void;
  fading?: boolean;
}

/**
 * 首屏渐次浮出的标题层。
 *
 * 和旧版不同：这里不再盖一层不透明的底，也不再画假星星——
 * 背景就是底下真正的仙女座大星系，这一层只负责「压暗四周、把视线引到星系上」，
 * 所以指针事件全部放行，用户第一下点击就能落进画布，音频也随之解锁。
 */
export default function LaunchOverlay({ preset, onLaunch, fading = false }: Props) {
  const accent = preset.colors[1];

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-between overflow-hidden px-6 pb-[168px] pt-[9vh] transition-opacity duration-[1400ms] ease-out sm:pb-[176px] ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* 四角压暗：中间留亮，让星系的核球自己发光 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 62% 58% at 50% 46%, rgba(2,3,9,0) 0%, rgba(2,3,9,0.10) 52%, rgba(2,3,9,0.62) 100%)',
        }}
      />
      <div className="absolute inset-x-0 top-0 h-[34vh] bg-gradient-to-b from-[#02030a]/70 via-[#02030a]/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[26vh] bg-gradient-to-t from-[#02030a]/80 via-[#02030a]/25 to-transparent" />

      {/* 标题 */}
      <header className="animate-fade-up relative z-10 flex flex-col items-center text-center">
        <div className="mb-5 flex items-center gap-3 text-[10px] tracking-[0.46em] text-white/40">
          <span className="h-px w-8 bg-white/25" />
          MESSIER 31 · ANDROMEDA
          <span className="h-px w-8 bg-white/25" />
        </div>

        <h1 className="text-[clamp(26px,3.8vw,48px)] font-light leading-none tracking-[0.16em] text-white/95 [text-shadow:0_0_40px_rgba(0,0,0,0.55)]">
          星云声景实验室
        </h1>

        <p className="mt-4 text-[11px] tracking-[0.52em] text-white/38">NEBULA SOUNDSCAPE LAB</p>

        <div
          className="mt-7 h-px w-24"
          style={{
            background: `linear-gradient(to right, transparent, ${accent}99, transparent)`,
          }}
        />

        <p className="mt-7 text-[13px] leading-7 tracking-[0.12em] text-white/52 sm:text-[14px]">
          六个情绪星系，藏在这片星海里
        </p>
        <p className="mt-1.5 text-[12px] leading-6 tracking-[0.1em] text-white/32 sm:text-[13px]">
          写下此刻的心情，光会带你走进对应的那一座
        </p>
      </header>

      {/* 底部引导：指向下方的输入框 */}
      <div className="animate-fade-up relative z-10 flex flex-col items-center gap-4 [animation-delay:260ms]">
        <div className="flex items-center gap-2 text-[11px] tracking-[0.3em] text-white/45">
          <ArrowDown size={12} className="animate-bounce text-white/55" />
          写下此刻的心情 · 回车潜入
        </div>

        <button
          type="button"
          onClick={onLaunch}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[10px] tracking-[0.24em] text-white/45 backdrop-blur-sm transition-colors duration-300 hover:border-white/30 hover:text-white/80"
        >
          <Headphones size={11} />
          轻触唤醒声音
        </button>
      </div>
    </div>
  );
}