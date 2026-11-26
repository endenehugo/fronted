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
import type { EmotionVector, Palette, PresetId, ScaleId, TimbreId } from './types';
import { scaleDisplayName } from './audio/scales';

interface Stats {
  fps: number;
  count: number;
}

export default function App() {
  /**
   * 从 URL hash 读初始状态：必须在这里**同步**取。
   *
   * 以前是放在 useEffect 里还原，于是首帧先按 galaxy_idle 建好粒子形状，
   * 等 effect 跑起来才切到 hash 里的星体 —— 用户看到的是「待机六臂星系正在变形到目标星体」
   * 的中途状态，两套形态混在一起，就是「第一次进去星云是混乱的」。
   */
  const initialState = useMemo(() => readStateFromHash(), []);

  const [ignited, setIgnited] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [presetId, setPresetId] = useState<PresetId>(initialState?.presetId ?? GALAXY_IDLE.id);
  const [input, setInput] = useState(initialState?.customText ?? '');
  const [emotion, setEmotion] = useState<EmotionVector | null>(initialState?.emotion ?? null);
  /**
   * 配色只在「分享的是一段心情文本」时才恢复 hash 里的那份混合色。
   * 单纯分享星体时用星体原色 —— 否则第二次进来形状对了、颜色却和星体对不上。
   */
  const [palette, setPalette] = useState<Palette | null>(
    initialState?.emotion ? initialState.colors : null,
  );
  const [turbulence, setTurbulence] = useState(initialState?.turbulence ?? GALAXY_IDLE.turbulence);
  const [speed, setSpeed] = useState(initialState?.speed ?? GALAXY_IDLE.speed);
  const [log, setLog] = useState<string | null>(null);
  const [postcard, setPostcard] = useState<string | null>(null);
  const [postcardMood, setPostcardMood] = useState('');
  const [volume, setVolume] = useState(0.75);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audioLive, setAudioLive] = useState(false);
  // 音色 / 音阶：null = 跟随星体预设（音色取 preset.timbre，音阶取 preset.scale）
  const [timbreOverride, setTimbreOverride] = useState<TimbreId | null>(null);
  const [scaleOverride, setScaleOverride] = useState<ScaleId | null>(null);

  /** 配色滑块：相对当前星体配色的色相偏移，-1 偏紫 ↔ +1 偏金；0 = 星体原色（初始位置即"跟随"） */
  const [valence, setValence] = useState<number>(initialState?.valence ?? 0);
  /** 星图模式：所有星座连线一起显现（键盘 C 或底部按钮） */
  const [starchart, setStarchart] = useState(false);

  const canvasRef = useRef<NebulaCanvasHandle>(null);
  const wokenRef = useRef(false);
  const audio = useMemo(() => NebulaAudioEngine.getInstance(), []);
  const preset = useMemo(() => getPreset(presetId), [presetId]);
  const isIdle = presetId === GALAXY_IDLE.id;
  const timbre: TimbreId = timbreOverride ?? preset.timbre;
  const scaleId: ScaleId = scaleOverride ?? 'preset';
  const scaleName = scaleDisplayName(preset, scaleId);

  // ---- 音色 / 音阶同步到音频引擎（预设变化或用户手动切换时生效） ----
  useEffect(() => {
    if (!audio.ready) return;
    audio.setTimbre(timbre);
    audio.setScale(scaleId);
  }, [audio, timbre, scaleId, audioLive]);

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
        valence,
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [presetId, input, palette, turbulence, speed, emotion, valence, launched, preset.colors]);

  // ---- 唤醒星云：任意一次点击 / 按键即解锁音频，并把标题层淡出 ----
  const wake = useCallback(() => {
    if (wokenRef.current) return;
    wokenRef.current = true;
    setIgnited(true);
    setLaunched(true);
    void (async () => {
      try {
        await audio.unlock(preset);
        audio.setPreset(preset);
        audio.setVolume(muted ? 0 : volume);
      } catch {
        /* 音频不可用时仍然展示视觉 */
      }
    })();
  }, [audio, preset, muted, volume]);

  useEffect(() => {
    const onFirstGesture = () => wake();
    const opts: AddEventListenerOptions = { once: true, capture: true };
    window.addEventListener('pointerdown', onFirstGesture, opts);
    window.addEventListener('keydown', onFirstGesture, opts);
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, { capture: true });
      window.removeEventListener('keydown', onFirstGesture, { capture: true });
    };
  }, [wake]);

  // ---- 首屏：大星系从一点缓缓展开，作为整页的背景舞台 ----
  useEffect(() => {
    const t = window.setTimeout(() => canvasRef.current?.expand(), 300);
    return () => window.clearTimeout(t);
  }, []);

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
      // 注意：不再把解析结果回填滑块 —— 那会让用户拖好的位置被一次"潜入"重置，
      // 滑块保持自己的偏移，情绪解析只负责基底配色与形态。
      audio.setPreset(res.preset);
    },
    [audio],
  );

  const handleAnalyze = useCallback(() => runAnalyze(input), [input, runAnalyze]);

  // 灵感词胶囊：等同于输入该词并回车
  const handleInspire = useCallback(
    (word: string) => {
      // 只按这个词解析、切到对应星体；不把词写进输入框（点预设不该改动用户正在输入的内容）。
      // 同时把配色滑块复位到中心，等于「忽略上一次的配色调整」。
      setValence(0);
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
      // 点预设情绪 = 忽略之前的配色调整，滑块回中心（0 = 该星体原色）
      setValence(0);
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
    setValence(0);
    audio.setPreset(GALAXY_IDLE);
  }, [audio]);

  // ---- 拖动效价滑块：手动覆盖情绪基调（-1 低落 ↔ 1 明亮） ----
  const handleValence = useCallback((v: number) => {
    setValence(Math.min(1, Math.max(-1, v)));
  }, []);

  const handleClear = useCallback(() => {
    setInput('');
    setEmotion(null);
    setPalette(null);
    setLog(null);
    setValence(0);
    setTurbulence(preset.turbulence);
    setSpeed(preset.speed);
  }, [preset]);

  const handleTimbre = useCallback((id: TimbreId) => setTimbreOverride(id), []);
  const handleScale = useCallback((id: ScaleId) => setScaleOverride(id === 'preset' ? null : id), []);

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
    if (!img) {
      setLog('画面还没准备好，稍等一下再定格');
      return;
    }
    setBusy(true);
    try {
      const url = await generatePostcard({
        image: img,
        mood: input.trim(),
        preset,
        palette: palette ?? preset.colors,
        spectrum: audio.getSpectrum(64),
        timestamp: Date.now(),
        scaleName,
      });
      setPostcardMood(input.trim());
      setPostcard(url);
    } catch {
      // 原来只有 finally，合成失败会变成未捕获的 rejection（用户只看到按钮闪一下）
      setLog('明信片合成失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }, [busy, input, preset, palette, audio, scaleName]);

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
      valence,
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
  }, [presetId, input, palette, turbulence, speed, emotion, valence, preset.colors]);

  const handleClosePostcard = useCallback(() => setPostcard(null), []);
  const handleToggleStarchart = useCallback(() => setStarchart((v) => !v), []);

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
        valence={valence}
        starchart={starchart}
        onToggleStarchart={handleToggleStarchart}
        onStats={setStats}
      />

      {/* 影院感压角：只压四周，星系本体保持通透 */}
      <div
        className="pointer-events-none fixed inset-0 z-20"
        style={{
          background:
            'radial-gradient(ellipse 78% 70% at 50% 46%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%)',
        }}
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
            <div className="mt-1 text-[13px] text-white/85 sm:text-[14px]">{isIdle ? '星系' : preset.name}</div>
          )}
        </div>
        <div className="animate-fade-in text-right" style={{ animationDelay: '150ms' }}>
          <div className="text-[9px] tracking-[0.24em] text-white/35 sm:text-[10px]">SCALE</div>
          <div className="mt-1 text-[11px] text-white/70 sm:text-[12px]">{scaleName}</div>
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

      {/* 观测日志 */}
      {log && (
        <div key={log} className="pointer-events-none fixed inset-x-0 top-[84px] z-40 flex justify-center px-4">
          <div className="animate-fade-up max-w-xl rounded-2xl border border-white/10 bg-black/25 px-5 py-2.5 text-center text-[12px] leading-6 text-white/70 backdrop-blur-md sm:text-[12.5px]">
            <span className="mr-1.5 text-white/35">观测日志</span>
            {log}
          </div>
        </div>
      )}

{/* 底部控制栏：首屏就位，作为「潜入」的入口 */}
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
        valence={valence}
        onValence={handleValence}
        volume={volume}
        muted={muted}
        onVolume={handleVolume}
        onToggleMute={handleToggleMute}
        onCapture={handleCapture}
        onShare={handleCopyLink}
        busy={busy}
        timbre={timbre}
        scaleId={scaleId}
        onTimbre={handleTimbre}
        onScale={handleScale}
        starchart={starchart}
        onStarchart={handleToggleStarchart}
      />

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

      {/* 首屏标题层：透明浮在星系之上，不挡交互 */}
      {!launched && <LaunchOverlay preset={preset} onLaunch={wake} fading={ignited} />}
    </div>
  );
}
