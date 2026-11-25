import type { NebulaPreset } from '../types';
import { presetDrone, presetScale } from './scales';

export interface AudioBands {
  bass: number;
  mid: number;
  treble: number;
}

interface DroneLayer {
  oscs: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  lfo: OscillatorNode;
}

interface WindLayer {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface Riser {
  osc: OscillatorNode;
  gain: GainNode;
}

/**
 * NebulaAudioEngine —— 程序化星际合成器（单例）
 *
 * 四层声音架构：
 *  1. Ambient Drone   深空环境铺底（微失谐振荡器 + 低通 + LFO）
 *  2. Generative Chimes 自动星辰旋律（马尔可夫音级游走 + 立体声延迟）
 *  3. Interactive Synth 交互即时响应（FM 钟琴音色，Attack 15ms / Release 1.8s）
 *  4. Solar Wind      宇宙背景噪波（粉红噪声 + 带通滤波）
 *
 * 所有声音均由 Web Audio API 实时合成，零外部音频资源。
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

  private drone: DroneLayer | null = null;
  private wind: WindLayer | null = null;
  private riser: Riser | null = null;
  /** 生成旋律总线：待机态压低、进入星体后随低通一起渐入（键盘 / 点击等交互音不走此总线） */
  private melody: GainNode | null = null;
  private melodyDensity = 0.4;

  private preset: NebulaPreset | null = null;
  private scale: number[] = [];
  private volume = 0.75;
  private schedulerId: number | null = null;
  private nextNoteTime = 0;
  private lastDegree = 0;

  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private bands: AudioBands = { bass: 0, mid: 0, treble: 0 };
  /** 各频段近期能量峰值（自适应归一化基准，缓慢回落） */
  private bandPeak: AudioBands = { bass: 0.2, mid: 0.2, treble: 0.2 };

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
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

    this.buildReverb();
    this.buildMelodyBus();
    this.buildDrone();
    this.buildWind();
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

  /** Ambient Drone：两个微失谐振荡器 + 纯五度 + 低通 + 极慢 LFO */
  private buildDrone(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const defs = [
      { type: 'sine' as OscillatorType, detune: -6, gain: 0.55 },
      { type: 'triangle' as OscillatorType, detune: 6, gain: 0.32 },
      { type: 'sine' as OscillatorType, detune: 0, gain: 0.2 },
    ];

    const oscs: OscillatorNode[] = [];
    for (const d of defs) {
      const osc = ctx.createOscillator();
      osc.type = d.type;
      osc.detune.value = d.detune;
      const g = ctx.createGain();
      g.gain.value = d.gain;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      oscs.push(osc);
    }

    filter.connect(gain);
    gain.connect(this.master);
    lfo.start();

    this.drone = { oscs, filter, gain, lfo };
  }

  /** Solar Wind：内存生成粉红噪波 + 带通滤波 */
  private buildWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.makePinkNoise(4);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.55;

    const gain = ctx.createGain();
    gain.gain.value = 0.03;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();

    this.wind = { src, filter, gain };
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
    this.scale = presetScale(preset);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // 预设切换的全部持续参数都走 setTargetAtTime（指数滑音，起点取当前值，无爆音）。
    // 待机大星系：低通压到 320Hz、Drone 加厚、生成旋律近乎静默 → 低频宽广的深空铺底；
    // 进入情绪星体：低通 τ=0.6 缓缓打开到 1400Hz（≈2.5s 完成 98%），旋律总线同步渐入。
    // Drone 音高 τ=0.55，落在 2.8s 画面形变的前半段，声音先落定但不抢拍。
    const idle = preset.id === 'galaxy_idle';
    const tau = 0.6;
    if (this.drone) {
      const [root, fifth, octave] = presetDrone(preset);
      const freqs = [root, fifth, octave];
      this.drone.oscs.forEach((osc, i) => {
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setTargetAtTime(freqs[i] ?? root, t, 0.55);
      });
      this.drone.filter.frequency.setTargetAtTime(idle ? 320 : 1400, t, tau);
      this.drone.gain.gain.setTargetAtTime(this.droneGainTarget(preset), t, tau);
    }

    if (this.wind) {
      this.wind.gain.gain.setTargetAtTime(idle ? 0.012 : 0.018 + preset.turbulence * 0.055, t, tau);
      this.wind.filter.frequency.setTargetAtTime(idle ? 260 : 380 + preset.speed * 620, t, tau);
    }

    this.melody?.gain.setTargetAtTime(idle ? 0.08 : 1, t, tau);
    this.melodyDensity = idle ? 0.08 : 0.4;
  }

  /** Drone 增益目标：待机铺底更厚，星体按湍流微调 */
  private droneGainTarget(preset: NebulaPreset): number {
    return preset.id === 'galaxy_idle' ? 0.2 : 0.13 + preset.turbulence * 0.05;
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
      const bpm = this.preset.bpm;
      const step = 60 / bpm / 2; // 八分音符
      while (this.nextNoteTime < this.ctx.currentTime + 0.35) {
        if (Math.random() < this.melodyDensity) {
          this.scheduleChime(this.nextNoteTime);
        }
        this.nextNoteTime += step;
      }
    }, 110);
  }

  /** 马尔可夫音级游走：偏好小音程，保证任意旋律都和谐 */
  private scheduleChime(time: number): void {
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
    const freq = this.scale[this.lastDegree] * (Math.random() < 0.16 ? 2 : 1);
    this.bell(freq, 0.085 + Math.random() * 0.075, time, (Math.random() * 2 - 1) * 0.75, 2.8, this.melody ?? undefined);
  }

  /**
   * 钟琴音色：FM 调制 + 三倍频泛音，Attack 15ms / 长 Release。
   * dest 指定输出总线（生成旋律走 melody 总线以便渐入渐出）；缺省直连 master 并送混响。
   */
  private bell(
    freq: number,
    vel: number,
    when: number,
    pan: number,
    dur: number,
    dest?: AudioNode,
  ): void {
    const ctx = this.ctx!;
    const t = Math.max(when, ctx.currentTime);

    const amp = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2.0;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 1.1, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.01, t + dur * 0.7);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 3.01;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.12;

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel), t + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    carrier.connect(amp);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(amp);
    amp.connect(panner);
    panner.connect(dest ?? this.master);
    if (!dest) panner.connect(this.delaySend);

    carrier.start(t);
    mod.start(t);
    shimmer.start(t);
    const end = t + dur + 0.05;
    carrier.stop(end);
    mod.stop(end);
    shimmer.stop(end);
  }

  // ---------------------------------------------------------------- 交互音效

  /** 键盘 A–L 拨弦 */
  playChime(index: number, velocity = 1): void {
    if (!this.ctx || this.scale.length === 0) return;
    const n = this.scale.length;
    const degree = ((index % n) + n) % n;
    const freq = this.scale[degree];
    const t = this.ctx.currentTime;
    this.bell(freq, 0.17 * velocity, t, ((index % 9) / 8) * 1.4 - 0.7, 2.2);
    this.bell(freq * 2, 0.055 * velocity, t + 0.01, 0, 1.5);
  }

  /** 指针点击的轻柔泛音 */
  playClick(pan = 0): void {
    if (!this.ctx || this.scale.length === 0) return;
    const freq = this.scale[Math.floor(Math.random() * this.scale.length)];
    this.bell(freq, 0.11, this.ctx.currentTime, pan, 1.9);
  }

  /** 鼠标悬停时触发的高频泛音（节流由调用方负责） */
  playHover(pan = 0): void {
    if (!this.ctx || this.scale.length === 0) return;
    const freq = this.scale[Math.floor(this.scale.length / 2)] * 4;
    this.bell(freq, 0.028, this.ctx.currentTime, pan, 0.7);
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
   * 噪声带通中心频率先上扫再回落，低频从 48Hz 涌到 96Hz 再沉回 42Hz，
   * 同时让 Drone 层轻微避让，把中频让给过渡音。
   */
  transition(duration = 2.8): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const d = Math.max(0.4, duration);

    // 噪声气流（星尘被卷起的摩擦感）
    const noise = ctx.createBufferSource();
    noise.buffer = this.makePinkNoise(d + 0.6);
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

    // Drone 避让：过渡期间压低，落定后按当前预设回位
    if (this.drone) {
      const back = this.preset ? this.droneGainTarget(this.preset) : 0.15;
      this.drone.gain.gain.cancelScheduledValues(t);
      this.drone.gain.gain.setTargetAtTime(0.065, t, 0.16);
      this.drone.gain.gain.setTargetAtTime(back, t + d * 0.78, 0.5);
    }
  }

  /** 形变落定：调式内三音轻声确认，给画面一个「到位」的听觉锚点 */
  arrive(): void {
    if (!this.ctx || this.scale.length === 0) return;
    const t = this.ctx.currentTime;
    const n = this.scale.length;
    [0, 2, 4].forEach((deg, i) => {
      const freq = this.scale[(deg + n) % n];
      this.bell(freq, 0.05, t + i * 0.07, (i - 1) * 0.5, 2.8);
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
    noise.buffer = this.makePinkNoise(1.6);
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
        this.bell(freq, 0.12 * power, t + i * 0.055, (i / chord.length) * 1.4 - 0.7, 3.4);
      });
    }
  }

  // ---------------------------------------------------------------- 分析

  /** 读取 FFT，返回平滑后的三段能量（0~1） */
  getBands(dt = 0.016): AudioBands {
    if (!this.analyser || !this.ctx || !this.freqData) {
      return { bass: 0, mid: 0, treble: 0 };
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

    const k = 1 - Math.exp(-Math.max(0.001, dt) * 14);
    this.bands.bass += (normBass - this.bands.bass) * k;
    this.bands.mid += (normMid - this.bands.mid) * k;
    this.bands.treble += (normTreble - this.bands.treble) * k;

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
