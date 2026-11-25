import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { GALAXY_IDLE, INSPIRATIONS, PRESETS, getPreset } from './visual/presets';
import { NebulaCanvas, type NebulaCanvasHandle } from './visual/NebulaCanvas';
import LaunchOverlay from './components/LaunchOverlay';
import ControlDock from './components/ControlDock';
import PostcardModal from './components/PostcardModal';
import { NebulaAudioEngine } from './audio/NebulaAudioEngine';
import { analyzeEmotion } from './utils/emotionParser';
import { buildShareUrl, readStateFromHash, writeStateToHash } from './utils/urlState';
import { downloadDataUrl, generatePostcard } from './utils/postcardGenerator';
import type { EmotionVector, Palette, PresetId } from './types';

interface Stats {
  fps: number;
  count: number;
}

export default function App() {
  const [ignited, setIgnited] = useState(false);
  const [launched, setLaunched] = useState(false);
  // 初始即为待机态：仙女座大星系
  const [presetId, setPresetId] = useState<PresetId>(GALAXY_IDLE.id);
  const [input, setInput] = useState('');
  const [emotion, setEmotion] = useState<EmotionVector | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [turbulence, setTurbulence] = useState(GALAXY_IDLE.turbulence);
  const [speed, setSpeed] = useState(GALAXY_IDLE.speed);
  const [log, setLog] = useState<string | null>(null);
  const [postcard, setPostcard] = useState<string | null>(null);
  const [postcardMood, setPostcardMood] = useState('');
  const [volume, setVolume] = useState(0.75);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audioLive, setAudioLive] = useState(false);

  const canvasRef = useRef<NebulaCanvasHandle>(null);
  const audio = useMemo(() => NebulaAudioEngine.getInstance(), []);
  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const isIdle = presetId === GALAXY_IDLE.id;

  // ---- 启动时还原 URL Hash 状态 ----
  useEffect(() => {
    const state = readStateFromHash();
    if (!state) return;
    setPresetId(state.presetId);
    setInput(state.customText);
    setEmotion(state.emotion);
    setPalette(state.colors);
    setTurbulence(state.turbulence);
    setSpeed(state.speed);
  }, []);

  // ---- 音频引擎状态指示 ----
  useEffect(() => {
    const id = window.setInterval(() => setAudioLive(NebulaAudioEngine.getInstance().ready), 400);
    return () => window.clearInterval(id);
  }, []);

  // ---- 观测日志自动淡出 ----
  useEffect(() => {
    if (!log) return;
    const t = window.setTimeout(() => setLog(null), 9000);
    return () => window.clearTimeout(t);
  }, [log]);

  // ---- 状态变化时写回 URL Hash（防抖） ----
  useEffect(() => {
    if (!launched) return;
    const timer = window.setTimeout(() => {
      writeStateToHash({
        presetId,
        customText: input.trim(),
        colors: palette ?? preset.colors,
        turbulence,
        speed,
        seed: 1,
        emotion,
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [presetId, input, palette, turbulence, speed, emotion, launched, preset.colors]);

  // ---- 唤醒星云：解锁音频，从奇点展开为待机大星系 ----
  const handleLaunch = useCallback(async () => {
    if (ignited) return;
    setIgnited(true);
    try {
      await audio.unlock(preset);
      audio.setPreset(preset);
      audio.setVolume(muted ? 0 : volume);
    } catch {
      /* 音频不可用时仍然展示视觉 */
    }
    canvasRef.current?.expand();
    window.setTimeout(() => setLaunched(true), 1500);
  }, [ignited, preset, audio, muted, volume]);

  // ---- 心情解析：文本 → 情绪向量 → 最近邻星体 + 调色板 + 观测日志 ----
  const runAnalyze = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const res = analyzeEmotion(trimmed);
      setEmotion(res.vector);
      setPresetId(res.preset.id);
      setPalette(res.colors);
      setTurbulence(res.turbulence);
      setSpeed(res.speed);
      setLog(res.log);
      audio.setPreset(res.preset);
    },
    [audio],
  );

  const handleAnalyze = useCallback(() => runAnalyze(input), [input, runAnalyze]);

  // 灵感词胶囊：等同于输入该词并回车
  const handleInspire = useCallback(
    (word: string) => {
      setInput(word);
      runAnalyze(word);
    },
    [runAnalyze],
  );

  // ---- 切换星体（星体态胶囊，不经过情绪解析） ----
  const handleSelectPreset = useCallback(
    (id: PresetId) => {
      const p = getPreset(id);
      setPresetId(id);
      setEmotion(null);
      setPalette(null);
      setTurbulence(p.turbulence);
      setSpeed(p.speed);
      setLog(null);
      audio.setPreset(p);
    },
    [audio],
  );

  // ---- 返回大星系：目标切回待机态，相机与粒子在 2.8s 内缓缓退回宏观总览 ----
  const handleBackToGalaxy = useCallback(() => {
    setPresetId(GALAXY_IDLE.id);
    setEmotion(null);
    setPalette(null);
    setLog(null);
    setTurbulence(GALAXY_IDLE.turbulence);
    setSpeed(GALAXY_IDLE.speed);
    audio.setPreset(GALAXY_IDLE);
  }, [audio]);

  const handleClear = useCallback(() => {
    setInput('');
    setEmotion(null);
    setPalette(null);
    setLog(null);
    setTurbulence(preset.turbulence);
    setSpeed(preset.speed);
  }, [preset]);

  const handleVolume = useCallback(
    (v: number) => {
      setVolume(v);
      if (v > 0 && muted) setMuted(false);
      audio.setVolume(v);
    },
    [audio, muted],
  );

  const handleToggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      audio.setVolume(next ? 0 : volume);
      return next;
    });
  }, [audio, volume]);

  // ---- 明信片 ----
  const handleCapture = useCallback(async () => {
    if (busy) return;
    const img = canvasRef.current?.capture();
    if (!img) return;
    setBusy(true);
    try {
      const url = await generatePostcard({
        image: img,
        mood: input.trim(),
        preset,
        palette: palette ?? preset.colors,
        spectrum: audio.getSpectrum(64),
        timestamp: Date.now(),
      });
      setPostcardMood(input.trim());
      setPostcard(url);
    } finally {
      setBusy(false);
    }
  }, [busy, input, preset, palette, audio]);

  const handleDownload = useCallback(() => {
    if (!postcard) return;
    downloadDataUrl(postcard, `nebula-${preset.id}-${Date.now()}.png`);
  }, [postcard, preset.id]);

  const handleCopyLink = useCallback(async () => {
    const url = buildShareUrl({
      presetId,
      customText: input.trim(),
      colors: palette ?? preset.colors,
      turbulence,
      speed,
      seed: 1,
      emotion,
    });
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }, [presetId, input, palette, turbulence, speed, emotion, preset.colors]);

  const handleClosePostcard = useCallback(() => setPostcard(null), []);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black text-white">
      {/* 星云画布 */}
      <NebulaCanvas
        ref={canvasRef}
        preset={preset}
        emotion={emotion}
        palette={palette}
        turbulence={turbulence}
        speed={speed}
        onStats={setStats}
      />

      {/* 顶部信息 */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between p-4 sm:p-6">
        <div className="animate-fade-in">
          <div className="text-[9px] tracking-[0.38em] text-white/35 sm:text-[10px]">
            NEBULA SOUNDSCAPE LAB
          </div>
          {launched && !isIdle ? (
            <button
              onClick={handleBackToGalaxy}
              className="animate-fade-in pointer-events-auto mt-2 flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[12px] text-white/80 backdrop-blur-xl transition-all hover:border-white/35 hover:bg-white/15 hover:text-white"
            >
              <ArrowLeft size={13} />
              返回大星系
            </button>
          ) : (
            <div className="mt-1 text-[13px] text-white/85 sm:text-[14px]">{preset.name}</div>
          )}
        </div>
        <div className="animate-fade-in text-right" style={{ animationDelay: '150ms' }}>
          <div className="text-[9px] tracking-[0.24em] text-white/35 sm:text-[10px]">SCALE</div>
          <div className="mt-1 text-[11px] text-white/70 sm:text-[12px]">{preset.scaleName}</div>
          {stats && (
            <div className="mt-1 font-mono text-[9px] tracking-wider text-white/25 sm:text-[10px]">
              {stats.count.toLocaleString()} PARTICLES · {stats.fps} FPS
            </div>
          )}
          {launched && (
            <div className="mt-0.5 flex items-center justify-end gap-1.5 font-mono text-[9px] tracking-wider text-white/30">
              <span
                className={`h-1 w-1 rounded-full ${audioLive ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-white/25'}`}
              />
              AUDIO {audioLive ? 'LIVE' : 'OFF'}
            </div>
          )}
        </div>
      </header>

      {/* 待机态：极简标题与副标题 */}
      {launched && isIdle && (
        <div className="pointer-events-none fixed inset-x-0 top-[14%] z-30 flex flex-col items-center px-6 text-center">
          <div className="animate-fade-in text-[9px] tracking-[0.5em] text-white/30 sm:text-[10px]">
            MESSIER 31 · ANDROMEDA
          </div>
          <h1
            key="hero"
            className="animate-fade-up mt-3 text-[clamp(18px,2.6vw,28px)] font-light leading-snug tracking-[0.12em] text-white/90 [animation-delay:120ms]"
          >
            在群星之间写下此刻的心绪
          </h1>
          <p className="animate-fade-up mt-2 text-[12px] tracking-[0.08em] text-white/40 [animation-delay:240ms]">
            输入任意心情，回车潜入属于它的星云
          </p>
        </div>
      )}

      {/* 星云观测日志 */}
      {log && (
        <div key={log} className="pointer-events-none fixed inset-x-0 top-[84px] z-40 flex justify-center px-4">
          <div className="animate-fade-up max-w-xl rounded-2xl border border-white/10 bg-black/25 px-5 py-2.5 text-center text-[12px] leading-6 text-white/70 backdrop-blur-md sm:text-[12.5px]">
            <span className="mr-1.5 text-white/35">观测日志</span>
            {log}
          </div>
        </div>
      )}

      {/* 底部控制栏 */}
      {launched && (
        <ControlDock
          mode={isIdle ? 'idle' : 'body'}
          preset={preset}
          inspirations={INSPIRATIONS}
          presets={PRESETS}
          activeId={presetId}
          onSelect={handleSelectPreset}
          onInspire={handleInspire}
          value={input}
          onChange={setInput}
          onSubmit={handleAnalyze}
          onClear={handleClear}
          volume={volume}
          muted={muted}
          onVolume={handleVolume}
          onToggleMute={handleToggleMute}
          onCapture={handleCapture}
          onShare={handleCopyLink}
          busy={busy}
        />
      )}

      {/* 明信片弹窗 */}
      {postcard && (
        <PostcardModal
          image={postcard}
          preset={preset}
          mood={postcardMood}
          copied={copied}
          onClose={handleClosePostcard}
          onDownload={handleDownload}
          onCopyLink={handleCopyLink}
        />
      )}

      {/* 启动遮罩 */}
      {!launched && <LaunchOverlay preset={preset} onLaunch={handleLaunch} fading={ignited} />}
    </div>
  );
}
