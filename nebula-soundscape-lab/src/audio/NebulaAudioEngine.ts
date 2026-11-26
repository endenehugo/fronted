import type { NebulaPreset, ScaleId, TimbreId } from '../types';
import { presetScale } from './scales';

export interface AudioBands {
  bass: number;
  mid: number;
  treble: number;
  /** 总 RMS 音量（0~1，已扣除铺底本底并按高潮段满刻度归一化；静音为 0） */
  level: number;
  /** 旋律潮汐强度（0~1，14s 周期） */
  tide: number;
}

/** 同时发声的上限：超出后新音符直接丢弃，防止高潮期叠和弦把 CPU 打满 */
const MAX_VOICES = 48;
/** 潮汐周期（秒） */
export const TIDE_PERIOD = 14;

/** 各音色相对响度补偿：锯齿 / 合成垫音能量高，统一压到与正弦铃相近的响度 */
const TIMBRE_GAIN: Record<TimbreId, number> = {
  crystal_bowl: 1,
  pluck_harp: 0.9,
  cosmic_rhodes: 1,
  vibraphone: 1,
  synth_pad: 0.32,
  nebula_brass: 0.26,
  ethereal_choir: 0.3,
  arp_pluck: 0.5,
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Riser {
  osc: OscillatorNode;
  gain: GainNode;
}

/**
 * NebulaAudioEngine —— 程序化星际合成器（单例）
 *
 * 两层声音架构（没有任何持续铺底层）：
 *  1. Generative Chimes 自动星辰旋律（马尔可夫音级游走 + 14s 潮汐密度曲线 + 立体声延迟）
 *  2. Interactive Synth 交互即时响应（8 种纯程序化音色，见 playNote）
 *
 * 注意：曾有「Ambient Drone」（三个持续正弦波叠成的和声）与「Solar Wind」（粉红噪声铺底）两层，
 * 用户分层静音试听后要求全部移除：持续纯音在听感上就是嗡嗡声，噪声铺底也被要求删掉。
 *
 * 所有声音均由 Web Audio API 实时合成，零外部音频资源。
 * 所有增益包络都从 0.0001 指数爬坡、再指数回落到 0.0001，杜绝爆音。
 */
export class NebulaAudioEngine {
  private static instance: NebulaAudioEngine | null = null;

  static getInstance(): NebulaAudioEngine {
    if (!NebulaAudioEngine.instance) {
      NebulaAudioEngine.instance = new NebulaAudioEngine();
    }
    return NebulaAudioEngine.instance;
  }

  ctx: AudioContext | null = null;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private delaySend!: GainNode;
  private delayL!: DelayNode;
  private delayR!: DelayNode;
  private fbL!: GainNode;
  private fbR!: GainNode;

  private riser: Riser | null = null;
  /** 生成旋律总线：待机态压低、进入星体后随低通一起渐入（键盘 / 点击等交互音不走此总线） */
  private melody: GainNode | null = null;

  private preset: NebulaPreset | null = null;
  private scale: number[] = [];
  /** 当前音阶：'preset' 跟随星体，否则为全局调式库 */
  private scaleId: ScaleId = 'preset';
  /** 当前音色；timbreLocked 为 true 表示用户手动选过，换星体时不再回落到预设推荐音色 */
  private timbre: TimbreId = 'crystal_bowl';
  private timbreLocked = false;
  /** 进行中的发声数（用于 MAX_VOICES 限流） */
  private voices = 0;
  private volume = 0.75;
  private schedulerId: number | null = null;
  private nextNoteTime = 0;
  private lastDegree = 0;

  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  private bands: AudioBands = { bass: 0, mid: 0, treble: 0, level: 0, tide: 0 };
  /** 各频段近期能量峰值（自适应归一化基准，缓慢回落） */
  private bandPeak: AudioBands = { bass: 0.2, mid: 0.2, treble: 0.2, level: 0, tide: 0 };

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get currentTimbre(): TimbreId {
    return this.timbre;
  }

  get currentScale(): ScaleId {
    return this.scaleId;
  }

  // ---------------------------------------------------------------- 初始化

  async unlock(preset: NebulaPreset): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch {
          /* 用户手势缺失时静默失败 */
        }
      }
      return;
    }

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 26;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.28;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.master.connect(comp);
    comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    this.buildReverb();
    this.buildMelodyBus();
    this.setPreset(preset);
    this.startScheduler();

    // 调试句柄（验收时可在控制台读取 FFT 与上下文状态）
    (window as unknown as Record<string, unknown>).__nebulaAudio = this;

    // 平滑淡入，避免爆音
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.0001, t);
    this.master.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.volume), t + 2.4);
  }

  // ---------------------------------------------------------------- 基础层

  /** 立体声反馈延迟：模拟宇宙空旷混响 */
  private buildReverb(): void {
    const ctx = this.ctx!;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.4;

    this.delayL = ctx.createDelay(1.5);
    this.delayR = ctx.createDelay(1.5);
    this.delayL.delayTime.value = 0.375;
    this.delayR.delayTime.value = 0.52;

    this.fbL = ctx.createGain();
    this.fbR = ctx.createGain();
    this.fbL.gain.value = 0.36;
    this.fbR.gain.value = 0.32;

    const dampL = ctx.createBiquadFilter();
    dampL.type = 'lowpass';
    dampL.frequency.value = 2600;
    const dampR = ctx.createBiquadFilter();
    dampR.type = 'lowpass';
    dampR.frequency.value = 2200;

    this.delaySend.connect(this.delayL);
    this.delayL.connect(dampL);
    dampL.connect(this.fbL);
    this.fbL.connect(this.delayR);
    this.delayR.connect(dampR);
    dampR.connect(this.fbR);
    this.fbR.connect(this.delayL);

    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.7;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.7;

    this.delayL.connect(panL);
    panL.connect(this.master);
    this.delayR.connect(panR);
    panR.connect(this.master);
  }

  /** 生成旋律总线：只给 Generative Chimes 用，待机时压到 0.08、进入星体后渐入到 1 */
  private buildMelodyBus(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this.master);
    g.connect(this.delaySend);
    this.melody = g;
  }

  /** Paul Kellet 粉红噪声（生成一次后缓存复用，见 getNoise） */
  private noiseCache: AudioBuffer | null = null;

  /**
   * 复用的粉噪声缓冲。
   *
   * 切换预设与超新星都要用噪声，如果每次现生成（4 秒 × 44.1kHz × 2 声道 ≈
   * 35 万采样 × 2 的同步循环），这一步正好落在形变开始那一帧，是「切预设卡一下」的元凶之一。
   * 这里只生成一次，音色差异交给带通滤波与播放速率去区分。
   */
  private getNoise(seconds: number): AudioBuffer {
    const need = Math.max(6, seconds + 0.5);
    if (!this.noiseCache || this.noiseCache.duration < need) {
      this.noiseCache = this.makePinkNoise(need);
    }
    return this.noiseCache;
  }

  /** Paul Kellet 粉红噪声 */
  private makePinkNoise(seconds = 4): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    return buffer;
  }

  // ---------------------------------------------------------------- 预设切换

  setPreset(preset: NebulaPreset): void {
    this.preset = preset;
    // 用户手动选过音色则保留，否则回落到该星体推荐音色
    if (!this.timbreLocked) this.timbre = preset.timbre;
    this.scale = presetScale(preset, this.scaleId);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // 预设切换的持续参数走 setTargetAtTime（指数滑音，起点取当前值，无爆音）。
    // 待机大星系：生成旋律近乎静默；进入情绪星体：旋律总线 τ=0.6 渐入。
    const idle = preset.id === 'galaxy_idle';
    const tau = 0.6;
    this.melody?.gain.setTargetAtTime(idle ? 0.08 : 1, t, tau);
  }

  /** 手动切换音色：之后换星体也不再回落到推荐音色 */
  setTimbre(id: TimbreId): void {
    this.timbre = id;
    this.timbreLocked = true;
  }

  /** 切换音阶：'preset' 跟随星体自带调式；对正在发声的音符无影响，下一颗音起生效 */
  setScale(id: ScaleId): void {
    this.scaleId = id;
    if (this.preset) this.scale = presetScale(this.preset, id);
    this.lastDegree = 0;
  }

  /** 潮汐强度 0~1：14s 一个周期，x = 1 − cos 的半波再做 1.6 次幂，低潮段被拉长 */
  tideAt(time: number): number {
    const x = 0.5 - 0.5 * Math.cos((Math.PI * 2 * time) / TIDE_PERIOD);
    return Math.pow(x, 1.6);
  }

  /** 当前时刻的潮汐强度（音频未就绪时为 0，视觉保持低落静止） */
  getTide(): number {
    return this.ctx ? this.tideAt(this.ctx.currentTime) : 0;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(Math.max(0.0002, this.volume), t, 0.08);
  }

  getVolume(): number {
    return this.volume;
  }

  // ---------------------------------------------------------------- 旋律生成

  private startScheduler(): void {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.5;
    this.schedulerId = window.setInterval(() => {
      if (!this.ctx || !this.preset) return;
      const now = this.ctx.currentTime;
      const bpm = this.preset.bpm;
      const step = 60 / bpm / 2; // 八分音符
      while (this.nextNoteTime < now + 0.35) {
        this.scheduleStep(this.nextNoteTime, step);
        this.nextNoteTime += step;
      }
    }, 110);
  }

  /**
   * 潮汐密度曲线（14s 周期）驱动的一个八分音符步：
   *  低潮（tide→0）约每 2.5s 才落一颗单音；高潮（tide→1）密度逼近每个八分音符一颗。
   *  待机大星系整体乘 0.22，保持深空稀疏。
   */
  private scheduleStep(time: number, step: number): void {
    const tide = this.tideAt(time);
    const idleK = this.preset?.id === 'galaxy_idle' ? 0.22 : 1;
    const lowDensity = Math.min(0.5, step / 2.5); // step / 2.5s ≈ 每 2~3 秒一颗
    const density = lerp(lowDensity, 0.85, tide) * idleK;
    if (Math.random() >= density) return;
    this.scheduleChime(time, tide);
  }

  /**
   * 马尔可夫音级游走：偏好小音程，保证任意旋律都和谐。
   * tide > 0.55 后概率叠加双音（三度 / 四度），tide > 0.8 再垫一颗低八度垫音。
   */
  private scheduleChime(time: number, tide: number): void {
    if (!this.ctx || this.scale.length === 0) return;
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
    const weights = [2.2, 3.0, 2.4, 1.7, 1.3, 0.85, 0.7, 0.45, 0.35, 0.22, 0.15];
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = 0;
    for (let i = 0; i < offsets.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = offsets[i];
        break;
      }
    }
    const n = this.scale.length;
    this.lastDegree = (this.lastDegree + pick + n) % n;
    const degree = this.lastDegree;
    const freq = this.scale[degree] * (Math.random() < 0.16 ? 2 : 1);
    const pan = (Math.random() * 2 - 1) * 0.75;
    const dest = this.melody ?? undefined;
    this.playNote(freq, 0.085 + tide * 0.05 + Math.random() * 0.075, this.timbre, { when: time, pan, dest });

    // 高潮双音和弦
    if (tide > 0.55 && Math.random() < (tide - 0.55) * 1.8) {
      const interval = Math.random() < 0.5 ? 2 : 3;
      const dyad = this.scale[(degree + interval) % n] * (degree + interval >= n ? 2 : 1);
      this.playNote(dyad, 0.05 + tide * 0.045, this.timbre, {
        when: time + 0.035,
        pan: -pan * 0.6,
        dest,
      });
    }
    // 高潮底层垫音：低八度，用温暖垫音音色
    if (tide > 0.8 && Math.random() < 0.3) {
      const bass = this.scale[degree % n] / 4;
      this.playNote(bass, 0.09 * tide, 'synth_pad', { when: time, pan: 0, dest });
    }
  }

  // ---------------------------------------------------------------- 八种程序化音色

  /**
   * 统一发声入口：按音色合成一颗音符。
   * @param freq     频率 Hz
   * @param velocity 力度 0~1（0.1 左右为常规旋律音）
   * @param timbre   音色，缺省为当前音色
   * @param opts.when 调度时刻（缺省立即）；pan 立体声位置 -1~1；dest 输出总线（缺省 master + 延迟混响）
   *
   * 所有振幅包络：0.0001 →（指数爬坡 attack）→ 峰值 →（指数衰减 release）→ 0.0001。
   */
  playNote(
    freq: number,
    velocity = 1,
    timbre: TimbreId = this.timbre,
    opts: { when?: number; pan?: number; dest?: AudioNode } = {},
  ): void {
    if (!this.ctx || this.voices >= MAX_VOICES || freq <= 0) return;
    const ctx = this.ctx;
    const t = Math.max(opts.when ?? ctx.currentTime, ctx.currentTime);
    const pan = opts.pan ?? 0;
    const dest = opts.dest;
    const peak = Math.max(0.0002, velocity) * (TIMBRE_GAIN[timbre] ?? 1);

    const amp = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    amp.connect(panner);
    panner.connect(dest ?? this.master);
    if (!dest) panner.connect(this.delaySend);

    const stops: AudioScheduledSourceNode[] = [];
    const osc = (type: OscillatorType, f: number, detune = 0): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      stops.push(o);
      return o;
    };
    const gain = (g: number): GainNode => {
      const n = ctx.createGain();
      n.gain.value = g;
      return n;
    };
    const filter = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };
    /** 振幅包络：attack 内指数爬到峰值，随后 release 内指数衰减到静音 */
    const env = (attack: number, release: number): number => {
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(peak, t + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
      return t + attack + release;
    };
    /** 把振荡器接入一个单极点低通再进 amp */
    const throughLowpass = (srcs: AudioNode[], f: number, q: number): BiquadFilterNode => {
      const lp = filter('lowpass', f, q);
      srcs.forEach((s) => s.connect(lp));
      lp.connect(amp);
      return lp;
    };

    let end = t;
    switch (timbre) {
      // 1. 水晶颂钵：1f + 2.756f + 5.404f 三正弦，微失谐 ±3 cents，慢起音 0.35s，长释放 3.2s
      case 'crystal_bowl': {
        const parts: [number, number, number][] = [
          [1, 1, -3],
          [2.756, 0.28, 3],
          [5.404, 0.1, -3],
        ];
        for (const [ratio, g, det] of parts) {
          const o = osc('sine', freq * ratio, det);
          const pg = gain(g);
          o.connect(pg);
          pg.connect(amp);
        }
        end = env(0.35, 3.2);
        break;
      }

      // 2. 尼龙拨弦：三角波，低通 3200Hz → 320Hz（0.25s 指数衰减），起音 0.01s，释放 1.4s
      case 'pluck_harp': {
        const o = osc('triangle', freq);
        const lp = throughLowpass([o], 3200, 1);
        lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(320, t + 0.25);
        end = env(0.01, 1.4);
        break;
      }

      // 3. 太空电钢：FM（载波 1f，调制波 2f，调制深度 0.15s 快速衰减）+ 低通 + 0.4Hz 立体声摇摆
      case 'cosmic_rhodes': {
        const carrier = osc('sine', freq);
        const mod = osc('sine', freq * 2);
        const modGain = gain(1);
        modGain.gain.setValueAtTime(freq * 1.6, t);
        modGain.gain.exponentialRampToValueAtTime(freq * 0.01, t + 0.15);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        throughLowpass([carrier], 2600, 0.8);
        const lfo = osc('sine', 0.4);
        const lfoGain = gain(0.55);
        lfo.connect(lfoGain);
        lfoGain.connect(panner.pan);
        end = env(0.02, 2.4);
        break;
      }

      // 4. 太空颤音琴：1f 正弦 + 3.98f 短衰减金属泛音 + 5.5Hz LFO 音量颤音
      case 'vibraphone': {
        const trem = gain(0.78);
        trem.connect(amp);
        const o1 = osc('sine', freq);
        const g1 = gain(0.85);
        o1.connect(g1);
        g1.connect(trem);
        const o2 = osc('sine', freq * 3.98);
        const g2 = gain(1);
        g2.gain.setValueAtTime(0.25, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o2.connect(g2);
        g2.connect(trem);
        const lfo = osc('sine', 5.5);
        const lfoGain = gain(0.22);
        lfo.connect(lfoGain);
        lfoGain.connect(trem.gain);
        end = env(0.01, 2.6);
        break;
      }

      // 5. 温暖垫音：三角 / 锯齿 ±7 cents 失谐 + 慢扫频低通，起音 0.5s，释放 2.5s
      case 'synth_pad': {
        const o1 = osc('triangle', freq, -7);
        const o2 = osc('sawtooth', freq, 7);
        const g1 = gain(0.6);
        const g2 = gain(0.4);
        o1.connect(g1);
        o2.connect(g2);
        const lp = throughLowpass([g1, g2], 380, 0.9);
        lp.frequency.setValueAtTime(380, t);
        lp.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
        lp.frequency.exponentialRampToValueAtTime(700, t + 3.0);
        end = env(0.5, 2.5);
        break;
      }

      // 6. 深空号角：三锯齿（-8 / 0 / +8 cents）+ 共振低通 180Hz → 1600Hz（0.6s 打开），起音 0.35s
      case 'nebula_brass': {
        const mix: GainNode[] = [-8, 0, 8].map((det) => {
          const o = osc('sawtooth', freq, det);
          const g = gain(0.34);
          o.connect(g);
          return g;
        });
        const lp = throughLowpass(mix, 180, 5);
        lp.frequency.setValueAtTime(180, t);
        lp.frequency.exponentialRampToValueAtTime(1600, t + 0.6);
        end = env(0.35, 2.0);
        break;
      }

      // 7. 空灵合唱：失谐锯齿并联三母音共振峰带通（320 / 800 / 2500Hz），起音 0.6s，释放 2.6s
      case 'ethereal_choir': {
        const pre = gain(1);
        [-6, 6].forEach((det) => {
          const o = osc('sawtooth', freq, det);
          const g = gain(0.5);
          o.connect(g);
          g.connect(pre);
        });
        const formants: [number, number, number][] = [
          [320, 5, 1],
          [800, 7, 0.55],
          [2500, 9, 0.22],
        ];
        for (const [f, q, g] of formants) {
          const bp = filter('bandpass', f, q);
          const fg = gain(g);
          pre.connect(bp);
          bp.connect(fg);
          fg.connect(amp);
        }
        end = env(0.6, 2.6);
        break;
      }

      // 8. 脉冲琶音：锯齿 + 低八度正弦（0.5f）+ 高共振低通 3600Hz → 240Hz（0.12s）
      case 'arp_pluck': {
        const o = osc('sawtooth', freq);
        const sub = osc('sine', freq * 0.5);
        const subGain = gain(0.6);
        sub.connect(subGain);
        const lp = throughLowpass([o, subGain], 3600, 12);
        lp.frequency.setValueAtTime(3600, t);
        lp.frequency.exponentialRampToValueAtTime(240, t + 0.12);
        end = env(0.005, 0.9);
        break;
      }
    }

    this.voices += 1;
    const first = stops[0];
    if (first) {
      first.onended = () => {
        this.voices = Math.max(0, this.voices - 1);
      };
    }
    for (const o of stops) {
      o.start(t);
      o.stop(end + 0.05);
    }
  }

  // ---------------------------------------------------------------- 交互音效

  /** 键盘 A–L 拨弦：当前音色主音 + 一颗高八度弱音 */
  playChime(index: number, velocity = 1): void {
    if (!this.ctx || this.scale.length === 0) return;
    const n = this.scale.length;
    const degree = ((index % n) + n) % n;
    const freq = this.scale[degree];
    const t = this.ctx.currentTime;
    this.playNote(freq, 0.17 * velocity, this.timbre, { when: t, pan: ((index % 9) / 8) * 1.4 - 0.7 });
    this.playNote(freq * 2, 0.055 * velocity, this.timbre, { when: t + 0.01, pan: 0 });
  }

  /** 指针点击的轻柔泛音 */
  playClick(pan = 0): void {
    if (!this.ctx || this.scale.length === 0) return;
    const freq = this.scale[Math.floor(Math.random() * this.scale.length)];
    this.playNote(freq, 0.11, this.timbre, { when: this.ctx.currentTime, pan });
  }

  /** 鼠标悬停时触发的高频泛音（节流由调用方负责） */
  playHover(pan = 0): void {
    if (!this.ctx || this.scale.length === 0) return;
    const freq = this.scale[Math.floor(this.scale.length / 2)] * 4;
    this.playNote(freq, 0.028, this.timbre, { when: this.ctx.currentTime, pan });
  }

  /** 长按蓄力：音调平滑上扬（Pitch Bend） */
  startRiser(): void {
    if (!this.ctx || this.riser) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(4200, t + 5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.055, t + 0.55);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(t);

    this.riser = { osc, gain };
  }

  stopRiser(): void {
    if (!this.ctx || !this.riser) return;
    const { osc, gain } = this.riser;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(0.0002, gain.gain.value), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    try {
      osc.stop(t + 0.18);
    } catch {
      /* noop */
    }
    this.riser = null;
  }

  // ---------------------------------------------------------------- 过渡音效

  /**
   * 形变过渡音效：与画面 2.8s「星际潜入」同步的「星尘气流 + 低频涌动」。
   * 噪声带通中心频率先上扫再回落，低频从 48Hz 涌到 96Hz 再沉回 42Hz。
   */
  transition(duration = 2.8): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const d = Math.max(0.4, duration);

    // 噪声气流（星尘被卷起的摩擦感）
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoise(d + 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + d * 0.62);
    bp.frequency.exponentialRampToValueAtTime(320, t + d);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.11, t + d * 0.35);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + d);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    noise.start(t);
    noise.stop(t + d + 0.1);

    // 低频涌动（质量在移动）
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(48, t);
    sub.frequency.exponentialRampToValueAtTime(96, t + d * 0.5);
    sub.frequency.exponentialRampToValueAtTime(42, t + d);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.12, t + d * 0.4);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + d);
    sub.connect(sg);
    sg.connect(this.master);
    sub.start(t);
    sub.stop(t + d + 0.1);
  }

  /** 形变落定：调式内三音轻声确认，给画面一个「到位」的听觉锚点 */
  arrive(): void {
    if (!this.ctx || this.scale.length === 0) return;
    const t = this.ctx.currentTime;
    const n = this.scale.length;
    [0, 2, 4].forEach((deg, i) => {
      const freq = this.scale[(deg + n) % n];
      this.playNote(freq, 0.05, 'crystal_bowl', { when: t + i * 0.07, pan: (i - 1) * 0.5 });
    });
  }

  /** 超新星爆发：低频冲击 + 噪声气浪 + 调式和弦琶音 */
  supernova(power = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 低频冲击
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(120, t);
    boom.frequency.exponentialRampToValueAtTime(26, t + 1.9);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.0001, t);
    boomGain.gain.exponentialRampToValueAtTime(0.5 * power, t + 0.02);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    boom.connect(boomGain);
    boomGain.connect(this.master);
    boom.start(t);
    boom.stop(t + 2.5);

    // 噪声气浪
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoise(1.8);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.16 * power, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(this.master);
    noise.start(t);
    noise.stop(t + 1.5);

    // 调式和弦琶音
    if (this.scale.length > 0) {
      const chord = [0, 2, 4, 6, 8, 12];
      chord.forEach((semi, i) => {
        const freq = this.scale[semi % this.scale.length] * (i >= 4 ? 2 : 1);
        this.playNote(freq, 0.12 * power, 'crystal_bowl', { when: t + i * 0.055, pan: (i / chord.length) * 1.4 - 0.7 });
      });
    }
  }

  // ---------------------------------------------------------------- 分析

  /** 读取 FFT 与时域 RMS，返回平滑后的三段能量（0~1）、总音量与潮汐强度 */
  getBands(dt = 0.016): AudioBands {
    if (!this.analyser || !this.ctx || !this.freqData) {
      return { bass: 0, mid: 0, treble: 0, level: 0, tide: 0 };
    }
    this.analyser.getByteFrequencyData(this.freqData);
    const sr = this.ctx.sampleRate;
    const binHz = sr / this.analyser.fftSize;
    const len = this.freqData.length;

    const avg = (f0: number, f1: number): number => {
      const a = Math.max(1, Math.floor(f0 / binHz));
      const b = Math.min(len - 1, Math.ceil(f1 / binHz));
      if (b <= a) return this.freqData![a] / 255;
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.freqData![i];
      return sum / ((b - a + 1) * 255);
    };

    const rawBass = Math.min(1, avg(20, 150) * 1.5);
    const rawMid = Math.min(1, avg(150, 2000) * 1.8);
    const rawTreble = Math.min(1, avg(2000, sr / 2) * 2.8);

    // 自适应归一化：跟踪近期峰值并缓慢回落，弱段也能被抬到可见起伏；峰值以下压暗避免过曝
    const peakDecay = Math.exp(-dt * 0.8);
    this.bandPeak.bass = Math.max(rawBass, this.bandPeak.bass * peakDecay);
    this.bandPeak.mid = Math.max(rawMid, this.bandPeak.mid * peakDecay);
    this.bandPeak.treble = Math.max(rawTreble, this.bandPeak.treble * peakDecay);
    const norm = (raw: number, peak: number): number => {
      const denom = Math.max(peak, 0.12);
      return Math.min(1, (raw / denom) * 0.85);
    };
    const normBass = norm(rawBass, this.bandPeak.bass);
    const normMid = norm(rawMid, this.bandPeak.mid);
    const normTreble = norm(rawTreble, this.bandPeak.treble);

    // 总 RMS：时域样本偏离中值（128）的均方根。×5 后扣掉纯铺底的本底（≈0.12）、
    // 以高潮段（≈0.57）为满刻度，使低潮 ≈0.1、高潮 ≈1，静音时归零
    let rawLevel = 0;
    if (this.timeData) {
      this.analyser.getByteTimeDomainData(this.timeData);
      let acc = 0;
      for (let i = 0; i < this.timeData.length; i++) {
        const v = (this.timeData[i] - 128) / 128;
        acc += v * v;
      }
      rawLevel = Math.min(1, Math.max(0, (Math.sqrt(acc / this.timeData.length) * 5 - 0.12) / 0.45));
    }

    const k = 1 - Math.exp(-Math.max(0.001, dt) * 14);
    this.bands.bass += (normBass - this.bands.bass) * k;
    this.bands.mid += (normMid - this.bands.mid) * k;
    this.bands.treble += (normTreble - this.bands.treble) * k;
    this.bands.level += (rawLevel - this.bands.level) * k;
    this.bands.tide = this.tideAt(this.ctx.currentTime);

    return this.bands;
  }

  /** 用于明信片波形条的对数频谱 */
  getSpectrum(bars = 64): number[] {
    if (!this.analyser || !this.freqData || !this.ctx) {
      return new Array(bars).fill(0).map(() => Math.random() * 0.35);
    }
    this.analyser.getByteFrequencyData(this.freqData);
    const n = this.freqData.length;
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      const t0 = Math.pow(i / bars, 1.7);
      const t1 = Math.pow((i + 1) / bars, 1.7);
      const a = Math.floor(t0 * n * 0.82);
      const b = Math.max(a + 1, Math.floor(t1 * n * 0.82));
      let sum = 0;
      let count = 0;
      for (let j = a; j < Math.min(b, n); j++) {
        sum += this.freqData[j];
        count++;
      }
      out.push(count ? sum / count / 255 : 0);
    }
    return out;
  }

  dispose(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.stopRiser();
    this.ctx?.close().catch(() => {});
    NebulaAudioEngine.instance = null;
  }
}
