# 星云声景实验室 · Nebula Soundscape Lab

> 2026 Qoder 高校创造力大赛 · LifeHack 赛道
> 纯前端、零后端、点开即玩的星云主题实时视听交互与情绪生成式玩具。

![星云声景实验室 · 暗物质 · 深思（黑洞吸积盘）](./preview.png)

---

## 一、快速开始

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物在 dist/，可直接部署到 Qoder Sites
npm run preview  # 本地预览生产构建
```

环境要求：Node 18+。构建产物为纯静态文件，`base: './'` 已配置为相对路径，任意静态托管均可直接访问。

---

## 二、技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript + Vite 5 |
| 样式 | Tailwind CSS 3（玻璃拟态 / 动效） |
| 3D | Three.js r171（自定义 ShaderMaterial 粒子 + UnrealBloomPass） |
| 音频 | 原生 Web Audio API（振荡器 / 滤波器 / 延迟 / AnalyserNode FFT） |
| 图标 | lucide-react |

零外部音频文件、零鉴权后端、零字体与 CDN 依赖。

---

## 三、目录结构

```text
src/
├── audio/
│   ├── NebulaAudioEngine.ts   # Web Audio 合成器、音阶生成与 FFT Analyser（单例）
│   └── scales.ts              # 情绪调式音阶与频率映射表
├── visual/
│   ├── NebulaCanvas.tsx       # Three.js 场景生命周期、双缓冲形变调度与交互绑定
│   ├── shapeGenerators.ts     # 纯数学点云生成器：六大情绪的专属天体几何拓扑
│   ├── nebulaShaders.ts       # 顶点/片元着色器（形变旋涡、分形态物理、Simplex 湍流）
│   └── presets.ts             # 六大情绪星系的拓扑 / 物理 / 机位 / 声学配置
├── utils/
│   ├── emotionParser.ts       # 本地中英文心情文本多维情感向量解析器
│   ├── postcardGenerator.ts   # 离屏 Canvas 合成星云声波明信片 PNG
│   └── urlState.ts            # URL Hash 状态序列化（LZW + Base64URL）
├── components/
│   ├── LaunchOverlay.tsx      # 首屏奇点唤醒遮罩（解锁 AudioContext）
│   ├── ControlDock.tsx        # 底部悬浮玻璃拟态控制栏
│   └── PostcardModal.tsx      # 明信片预览、下载与分享链接复制
├── App.tsx
├── main.tsx
└── index.css
```

---

## 四、实现要点

### 0. 待机态：仙女座大星系 + 2.8s 星际潜入

- **`GALAXY_IDLE` 预设**（`presets.ts`）：首屏即大星系，机位 `[0, 1.8, 9.2]`，`spin = 0`（盘面已倾斜，再绕世界 Y 轴会变成翻滚），仅有 0.04 的呼吸脉冲。
- **`buildGalaxy`**（`shapeGenerators.ts`，对照 M31 实拍）：22% 扁椭球核球（向中心集中，两成大而暗的粒子做眩光包络）+ 68% 指数盘（`Σ(r) ∝ exp(-r/1.7)`；50% 双对数螺旋主臂、12% 紧贴主臂内侧的暗尘埃带、其余臂间盘与外晕；一半是大尺寸低亮度粒子，铺出连续盘面光）+ 10% 双伴星系（M32 核球左侧紧凑亮白、M110 右下弥散淡紫）。盘面先按 113° 倾角压扁（投影长短轴 ≈ 2.6:1，近侧落在主轴下方），再在屏面内滚转 33°，得到左低右高的斜向椭圆姿态。尘埃带靠「极暗粒子 + 该区域不投放亮粒子」在加色混合下形成。
- **逐顶点色 `aColor` / 权重 `aColorW`**：核周暖白 `#FFFDF5` → 中盘暖褐 `#B87D56` → 外盘蓝紫 `#6B7FD7`，外加 3% 洋红星结；顶点着色器里 `vColor = mix(grad, aColor, colorW)`，`colorW` 随 `localT` 插值，星系多色层次错峰融入目标渐变。
- **独立背景星野**（`starfield*Shader`）：35~65 球壳上的常驻恒星，色温各异，不参与形变，仅缓慢微旋。
- **星际潜入**：`MORPH_DURATION = 2.8s`，`delay = aRandom × 0.45`、`smoothstep(delay, delay + 0.55)`、三次方缓出；星系粒子按离中心的半径写 `aRandom`，核球先启航、外缘与伴星系后汇入。相机 `dist 9.37 → ~5.3` 走 `MathUtils.damp`（λ 1.6），途中穿插潮汐旋涡 `uTransitionSwirl`。中途被打断时 `bakeMorphSnapshot` 把 position / size / role / colorT / colorW 一并烘焙。
- **UI 流**（`App.tsx` / `ControlDock.tsx`）：`mode = idle | body`。待机态只有极简标题「在群星之间写下此刻的心绪」+ 底部心情输入与 6 个灵感词胶囊；进入星体后左上「← 返回大星系」，底部为观测名 / 诗意解读 / 音阶提示 / 明信片。
- **声景联动**（`NebulaAudioEngine.ts`）：待机态旋律总线压到 0.08；潜入后 τ=0.6 渐入到 1。

### 1. 六大情绪的专属几何拓扑

`src/visual/shapeGenerators.ts` 是纯数学点云生成器，`generateNebulaShape(type, count): Float32Array`
返回 `count × 3` 坐标；六种拓扑共用同一坐标约定（Y 轴向上），跨度统一归一化在半径 ~3.5 内：

| 预设 | 天体拓扑 | 关键构造 |
| --- | --- | --- |
| 静谧 `serenity` | 蝴蝶双叶星云 | 沿 X 轴左右对称双翼，`sin^0.75` 包络收腰、翼尖收成尖角，翼面叠三层丝绸状正弦波纹并上扬 |
| 狂喜 `euphoria` | 超新星爆炸残骸 | 75% 双层中空纤维球壳（r 2.45 / 2.98 + 3D 褶皱）+ 25% 八向高能喷流（4 方位角 × 上下锥） |
| 深思 `melancholy` | 黑洞吸积盘 | r < 0.75 绝对空心视界；70% 极薄水平吸积盘（0.75–3.6）；30% 竖直爱因斯坦环（主环绕 Y 偏转 20°） |
| 专注 `focus` | 脉冲星磁感线 | 15% 致密亮核 + 35% 倾斜 25° 磁轴的极窄双极光束 + 50% 三组偶极子磁感线 `r = L·sin²θ` |
| 释放 `catharsis` | 红巨星日冕环 | 60% 强湍流恒星球体 + 40% 六条固定参数的二次贝塞尔日珥磁拱（拱起又回落） |
| 治愈 `healing` | 创生之柱 | 三塔 h = 3.6 / 2.7 / 1.9，柱身螺旋收窄带有机凹凸，顶端 12% 聚集高亮气态球 |

每个 builder 同时输出 `size / seed / role / colorT` 四个逐粒子属性：
`role` 是结构角色权重（驱动形变旋涡强度与差速自转），`colorT` 是 0 内核 → 1 外晕的颜色梯度参数。

### 2. 双缓冲形变（GPU Morph · 错峰波浪 + 潮汐旋涡）

- `BufferGeometry` 同时挂 `position`（当前）与 `aTargetPosition`（目标），并配 `aSize/aTargetSize`、
  `aRole/aTargetRole`、`aColorT/aTargetColorT`、`aRandom`（错峰种子）等缓冲。
- **错峰波浪**：每颗粒子按 `aRandom` 获得独立延迟（0–0.35），`localT = smoothstep(delay, delay + 0.65, p)`
  再做三次方缓出，粒子分批起飞、分批落地，消除「整片同时平移」的塑料感。
- **潮汐旋涡**：形变期间 CPU 驱动 `uTransitionSwirl = A·sin(π·p)`（中段最强、两端归零），
  顶点着色器按 `swirl·(1.35 - |base|·0.12)` 做差速旋转（内圈转得比外圈多），并叠加
  `1 + |swirl|·0.16` 的呼吸扩张，粒子沿星尘旋涡轨迹重组而非直线穿模。
- 形变总时长 **2.0s**；坐标 / 尺寸 / 角色 / 颜色梯度共用同一个 `localT`，过渡结束不产生任何跳变。
- **中途打断可精确烘焙**：`bakeMorphSnapshot()` 用同一套 `smoothstep + 三次缓出 + 旋涡变换` 在 CPU
  复现着色器结果写回当前缓冲，连续切换预设也不会闪跳。
- 同一预设只改情绪时不重建几何（`shapeChanged = preset.id !== shapeId`）。

### 2.1 声画同步过渡

`NebulaAudioEngine.transition(2.0)` 与画面形变同长：粉红噪声经带通滤波做中心频率
220 Hz → 2.6 kHz → 320 Hz 的上扫回落（星尘气流），叠加 48 → 96 → 42 Hz 的低频涌动，
同时形变结束时 `arrive()` 用调式内
三音给出「到位」的听觉锚点。

### 3. 分形态动态物理 `uBehavior`

`uBehavior = vec4(spin, pulse, drift, turbulence)`，各预设在 `presets.ts` 给出专属基线，
运行时按 `1 - exp(-dt·2.4)` 平滑趋近：

| 分量 | 规律 | 形态差异 |
| --- | --- | --- |
| `x` 自转 | `ω = spin·(1 + shear·role / (0.35 + r))` 开普勒差速 | melancholy `shear = 2.4` 内快外慢；healing 仅 0.02 |
| `y` 径向脉冲 | 随 `uBass` 呼吸 | euphoria 0.22 最强，melancholy 0.06 |
| `z` 垂直升腾 | 每粒子按种子错相位上升并淡出 | 仅 healing 0.16，柱体持续升腾飘散而不散架 |
| `w` 湍流 | Simplex 噪声位移 | catharsis 0.20 最乱，melancholy 0.05 |

心情解析得到的湍流 / 转速以相对倍率叠加到基线上（`setMotion`），不会覆盖形态自身的性格。

### 4. 相机最佳机位过渡

每个预设给出 `camera = { phi, theta, dist }`：切换时相机按 `1 - exp(-dt·2.2)` 平滑移动到该形态的
最佳俯仰角 / 方位角 / 距离（如 melancholy 以 18° 俯视同时看到吸积盘与透镜环，serenity 以 54° 俯视展开双翼），
方位角取最短旋转路径避免绕远路。用户一旦拖拽或滚轮，`userCam` 立即置位让出控制权，
直到下一次切换预设才收回。

**全量视觉参数统一逐帧阻尼**：切换预设的回调只写目标值，颜色（`Color.lerp`，λ=3.2）、粒子尺寸 `uSize`（λ=3.0）、
核心辉光 `core`（λ=3.0）、`uBehavior` / `uShear`（λ=3.0）、Bloom（λ=3.0）全部在主循环里用
`THREE.MathUtils.damp`（即 `1 - exp(-λ·dt)`）平滑过渡，回调里不再直接突变任何显示值。
切换瞬间 Bloom 额外上浮 +0.15（连点封顶 +0.3）后按 τ≈0.56s 回落，制造能量涌动感。

### 5. 视听共振

每帧从 `AnalyserNode` 读取三段能量写入 uniform：

| Uniform | 频段 | 作用 |
| --- | --- | --- |
| `uBass` | 20–150 Hz | 核心呼吸膨胀、核心辉光与 Bloom 强度 |
| `uMid` | 150–2000 Hz | 旋臂湍流幅度 |
| `uTreble` | 2000 Hz+ | 外围星尘高频闪烁 |

### 6. 交互

| 操作 | 反馈 |
| --- | --- |
| 鼠标拖拽 | 球坐标视角旋转，带惯性衰减；同时 `userCam = true`，立即接管相机（预设机位不再抢权） |
| 悬停 | 3D 空间投影点生成局部引力旋涡（径向吸附 + 切向搅动），并触发轻微高频泛音 |
| 长按（>240ms 未移动） | 粒子向中心坍缩，`startRiser()` 音调平滑上扬 |
| 松开 | 超新星爆发：球面冲击波 + 低频冲击 + 噪声气浪 + 调式和弦琶音 |
| 单击 | 局部星簇光脉冲 + 随机音阶泛音 |
| 键盘 `A S D F G H J K L` | 点亮随机星簇（`uBurstPos`）+ 演奏当前调式音阶风铃音 |
| 滚轮 | 相机推拉（5 – 24），同样置位 `userCam` |

### 7. 程序化星际合成器

`NebulaAudioEngine` 为单例，两层架构（无任何持续铺底层）：

1. **Generative Chimes**：按预设 BPM 的八分音符 lookahead 调度，马尔可夫音级游走（偏好小音程），
   立体声反馈延迟（0.375s / 0.52s，交叉反馈 + 低通阻尼）模拟宇宙混响。
2. **Interactive Synth**：8 种程序化音色，见第 10 节。

> 原有 **Ambient Drone**（持续正弦和声）与 **Solar Wind**（粉红噪声铺底）两层已按用户试听要求移除：
> 分层静音实测 Drone 占总输出 RMS 的 92%，是「低沉嗡嗡声」的来源；任何持续纯音都有这个问题。

> 浏览器自动播放合规：首屏 `IGNITE NEBULA` 按钮内执行 `audioContext.resume()`，
> 主增益从 0.0001 用 2.4s 指数淡入，杜绝爆音。

### 8. 情绪引擎

- 词典覆盖中英文约 200 个词条，三维打分：**Valence 效价 / Arousal 唤醒度 / Mystery 神秘感**。
- 否定词（不 / 没 / 无 / 非 / not / never…）反转效价并提升神秘感；
  程度副词（非常 / 特别 / very / extremely…）与弱化词（有点 / 稍微 / a bit…）做权重乘法。
- 输出连续向量 → 最近邻匹配六大星系 → 生成情绪调色板并与预设色 50% 混合 →
  派生湍流 / 转速 → 生成一句「星云观测日志」。
- 所有参数逐帧指数阻尼（λ 2.2~3.2，95% 收敛约 0.9~1.4s），详见「4. 相机最佳机位过渡」末尾。

### 9. 明信片与分享

- `WebGLRenderer` 开启 `preserveDrawingBuffer: true`，`composer.render()` 后 `toDataURL()` 截图。
- 离屏 2D Canvas 合成 1080×1350 玻璃拟态卡片：星云图 + 心情短句 + 星系名 / 音阶 +
  对数频谱条 + 时间戳。
- URL Hash：`{ presetId, customText, colors, turbulence, speed, seed, emotion }`
  → JSON → **LZW 压缩** → **Base64URL** → `#nebula=eyJ...`；
  初始化时反解并还原**预设 / 文本 / 配色 / 湍流 / 转速 / 情绪 / 配色滑块**，
  解压失败（或词典溢出）自动回退明文 Base64。
  > 注意：粒子的**具体排布**不在链接里（`seed` 字段目前恒为 1 且未参与生成），
  > 几何用的是 `Math.random`，所以同一个链接两次打开是同一类形态、但不是逐粒子一致。
  > 若要严格复现，需要把 seed 接进 `buildShape`（本轮未做）。

---

### 10. 八种程序化音色 · 音阶切换器 · 潮汐呼吸

- **`playNote(freq, velocity, timbre, opts)`**（`NebulaAudioEngine.ts`）是唯一发声入口，替换了原先的单一 FM 铃铛；所有振幅包络都是 `0.0001 →(指数爬坡 attack)→ 峰值 →(指数衰减 release)→ 0.0001`，杜绝爆音。同时发声上限 48（`MAX_VOICES`），超出直接丢弃。音色清单见 `audio/timbres.ts`：

  | id | 名称 | 合成配方 | 起音 / 释放 | 预设默认绑定 |
  |---|---|---|---|---|
  | `crystal_bowl` | 水晶颂钵 | `1f + 2.756f + 5.404f` 三正弦，±3 cents 失谐 | 0.35s / 3.2s | 仙女座待机态 |
  | `pluck_harp` | 尼龙拨弦 | 三角波，低通 3200→320Hz（0.25s 指数衰减） | 0.01s / 1.4s | 红巨星 · 释放 |
  | `cosmic_rhodes` | 太空电钢 | FM（载波 1f、调制 2f，深度 0.15s 衰减）+ 低通 + 0.4Hz 立体声摇摆 | 0.02s / 2.4s | 暗物质 · 深思 |
  | `vibraphone` | 太空颤音琴 | `1f` 正弦 + `3.98f` 短衰减金属泛音 + 5.5Hz 音量颤音 | 0.01s / 2.6s | 猎户座 · 静谧 |
  | `synth_pad` | 温暖垫音 | 三角 / 锯齿 ±7 cents + 慢扫频低通 380→2400→700Hz | 0.5s / 2.5s | 高潮底层垫音 |
  | `nebula_brass` | 深空号角 | 三锯齿 −8/0/+8 cents + 共振低通 180→1600Hz（0.6s） | 0.35s / 2.0s | 超新星 · 狂喜 |
  | `ethereal_choir` | 空灵合唱 | 失谐锯齿并联三母音共振峰带通 320 / 800 / 2500Hz | 0.6s / 2.6s | 创生之柱 · 治愈 |
  | `arp_pluck` | 脉冲琶音 | 锯齿 + `0.5f` 正弦 + 高共振低通 3600→240Hz（0.12s） | 0.005s / 0.9s | 脉冲星 · 专注 |

  每个情绪预设通过 `NebulaPreset.timbre` 绑定推荐音色；控制栏手动切换后 `timbreLocked` 置位，换星体不再回落。键盘拨弦 / 点击 / 悬停 / 落定确认音都走当前音色。
- **音阶切换器**（`scales.ts`）：`SCALE_LIBRARY` 含大调五声、自然小调、多利亚、利底亚、弗里吉亚五种调式（音程数组，`buildScale` 按 MIDI→Hz 换算，`A3 = 220Hz` / `C4` 为基准）。`presetScale(preset, scaleId)`：`'preset'` 沿用星体自带调式，否则以星体主音为根套用调式库；顶栏与控制栏实时显示 `scaleDisplayName`。
- **潮汐起伏自动旋律**：`tideAt(t) = (0.5 − 0.5·cos(2πt/14))^1.6`，14s 一个周期、低潮段被拉长。八分音符步进时按潮汐取密度：低潮约每 2.5s 一颗单音，高潮逼近每步一颗；`tide > 0.55` 概率叠加三度 / 四度双音，`tide > 0.8` 再垫一颗低八度 `synth_pad`。待机大星系整体密度 ×0.22。
- **铺底层已全部移除**：分层静音实测，原 Drone 层（持续正弦和声）占总输出 RMS 的 92%，是用户听到的「低沉嗡嗡声」来源；随后太阳风噪声铺底也按用户要求删除。引擎里不再有任何持续发声的节点，只有旋律、交互音与过渡音效。
- **视觉「潮汐呼吸」四维同步**（`NebulaCanvas.tsx` / `nebulaShaders.ts`）：
  - 慢包络 `uEnergy`：目标 = `tide × 0.7 + level × 0.7 + tide × level × 0.1`（`level` 为时域 RMS，已扣除铺底本底并按高潮段满刻度归一化），上升 λ=6（≈0.5s 到 95%）、回落 λ=1.7（≈1.8s），音频未就绪时停在 0.35。
  - ① 整体缩放与沉浮：`base *= 0.88 + uEnergy × 0.30`（高潮 +18%、低落 −12%），`base.y += (uEnergy − 0.5) × 0.25`。
  - ② 旋臂转速：转角由 CPU 逐帧积分 `spinPhase += dt × uBehavior.x × (0.25 + uEnergy × 0.5 + uMid × 0.25)` 传入 `uSpinPhase`，
    着色器 `rot2(base.xz, uSpinPhase × 差速项)`。不能用 `uTime × ω`：潮汐改变 ω 时粒子会瞬间多转「运行秒数 × Δω」，页面开得越久转得越快。
  - ③ 粒子与核心：`gl_PointSize × (0.85 + uEnergy × 0.30 + uTreble × 0.30 × role)`，核心 Sprite 随 `uBass` 脉冲并随 `uEnergy` 额外胀大。
  - ④ 辉光明暗：`vGlow += (uEnergy − 0.5) × 0.3`、`vAlpha × (0.82 + uEnergy × 0.2)`，`UnrealBloomPass.strength = bloomCurrent × (0.7 + uEnergy × 0.45) × 0.92 + bass × 0.95 + kick`。
- **控制栏**（`ControlDock.tsx`）：「音色」「音阶」两个玻璃拟态下拉（`GlassSelect`，自绘 listbox 经 Portal 挂到 body，原生 `<select>` 的展开列表无法定制样式），位于音量左侧，`md` 以下隐藏文字标签只留图标与当前值。

## 五、验收对照

### 阶段一 · 视觉底座
- [x] 全屏 18,000 粒子星云（桌面端），移动端 / 低帧率自动降至 8,000
- [x] 鼠标拖拽视角、悬停引力扰动
- [x] 长按坍缩 → 松开超新星爆发
- [x] 稳定 60 FPS（实测 144 FPS @ 850×667，DPR 2）

### 阶段二 · 声景与视听联动
- [x] 点击唤醒后声音平滑淡入（无爆音）
- [x] 低频驱动核心脉动 + Bloom 泛光
- [x] 键盘 `A–L` 流畅弹奏星辰泛音
- [x] 六大预设各自独立调式 / BPM / 湍流 / 转速

### 阶段三 · 情绪引擎与分享闭环
- [x] 切换 6 大预设或输入任意心情文本，颜色 / 形态 / 音阶 1.5s 内渐变
- [x] 定格生成完整明信片并下载 PNG
- [x] 复制链接在新标签页打开可还原预设 / 文本 / 配色 / 音阶（粒子排布不在链接内，见 §9 说明）

### 改造 · 六大专属拓扑与双缓冲形变
- [x] `generateNebulaShape(type, count)` 导出 6 套截然不同的天体几何（蝴蝶 / 超新星 / 黑洞 / 脉冲星 / 红巨星 / 创生之柱），
      跨度统一归一化在半径 ~3.5 内（实测包围盒见下）
- [x] `aTargetPosition` + `uMorphProgress` 双缓冲形变，2.0s 错峰波浪（`aRandom` 延迟 0–0.35 + 三次缓出）
      + `uTransitionSwirl` 潮汐旋涡（差速旋转 + 呼吸扩张），结束后目标缓冲同步回 `position`
- [x] 形变期间坐标 / 尺寸 / 角色 / 颜色同 `localT` 插值，落点无跳变；中途打断用 `bakeMorphSnapshot()` 精确烘焙
- [x] 声画同步：`transition(2.0)` 噪声气流 + 低频涌动与画面同长，落定 `arrive()` 和弦确认音
- [x] `uBehavior` 四类分形态物理（melancholy 强开普勒差速、healing 持续升腾飘散等）
- [x] 切换预设时相机平滑移动到形态最佳俯仰角；用户拖拽 / 滚轮立即让权（实测 `userCam: true` 后不再跟随）
- [x] 零回退：FFT 频谱、悬停旋涡、长按坍缩 / 超新星、键盘星簇、明信片导出全部保留并实测通过

| 形态 | 包围盒 x / y / z（半径 ~3.5 内） |
| --- | --- |
| serenity | ±3.17 / -0.09~0.49 / -0.68~1.58 |
| euphoria | -3.10~3.32 / ±3.27 / ±3.25 |
| melancholy | ±3.60 / ±2.13 / ±3.59 |
| focus | ±3.27 / ±3.07 / ±3.06 |
| catharsis | -2.25~2.30 / ±1.81 / ±2.08 |
| healing | -2.95~2.55 / -1.16~2.79 / -0.94~1.16 |

---

## 六、调试

```js
// 控制台读取音频引擎状态
__nebulaAudio.ctx.state        // "running"
__nebulaAudio.getBands(0.016)  // { bass, mid, treble } 0~1
__nebulaAudio.getSpectrum(64)  // 频谱数组
```

## 七、部署

```bash
npm run build
```

将 `dist/` 目录上传至 Qoder Sites（或任意静态托管）即可公开访问。
分享链接使用 `history.replaceState` 写入 Hash，不产生服务端请求。
