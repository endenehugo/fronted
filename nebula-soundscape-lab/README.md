# 星云声景实验室 · Nebula Soundscape Lab

> 2026 Qoder 高校创造力大赛 · LifeHack 赛道
> 纯前端、零后端、点开即玩的星云主题实时视听交互与情绪生成式玩具。

![星云声景实验室 · 超新星 · 狂喜](./preview.png)

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
│   ├── NebulaCanvas.tsx       # Three.js 场景生命周期与指针/键盘交互绑定
│   ├── nebulaShaders.ts       # 顶点/片元着色器（螺旋旋臂、Simplex 湍流、音频响应）
│   └── presets.ts             # 六大情绪星系视觉与声学配置
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

### 1. 星云粒子系统

- **18,000 颗粒子**（移动端或连续低帧率自动降级至 8,000），`BufferGeometry` 自定义属性：
  `aType`（核心/旋臂/星尘晕）、`aRadius`、`aTheta`、`aY`、`aSize`、`aSeed`。
- **三层结构**：核心恒星区 20%、对数螺旋旋臂 60%、外围星尘晕 20%。
- **螺旋**：`theta = theta0 + twist · ln(1 + r) + t · ω(r)`，`ω` 随半径衰减形成开普勒差速旋转；
  `twist` 作为 uniform 可随预设平滑插值，切换星系时形态不会跳变。
- **湍流**：顶点着色器内嵌 Ashima 3D Simplex Noise，两层噪声叠加形成气体褶皱。
- **材质**：程序化径向高斯 `CanvasTexture` + `AdditiveBlending` + `depthWrite: false`，
  `EffectComposer` + `UnrealBloomPass` 输出核心过曝泛光。

### 2. 视听共振

每帧从 `AnalyserNode` 读取三段能量写入 uniform：

| Uniform | 频段 | 作用 |
| --- | --- | --- |
| `uBass` | 20–150 Hz | 核心呼吸膨胀、核心辉光与 Bloom 强度 |
| `uMid` | 150–2000 Hz | 旋臂湍流幅度 |
| `uTreble` | 2000 Hz+ | 外围星尘高频闪烁 |

### 3. 交互

| 操作 | 反馈 |
| --- | --- |
| 鼠标拖拽 | 球坐标视角旋转，带惯性衰减 |
| 悬停 | 3D 空间投影点生成局部引力旋涡（径向吸附 + 切向搅动），并触发轻微高频泛音 |
| 长按（>240ms 未移动） | 粒子向中心坍缩，`startRiser()` 音调平滑上扬 |
| 松开 | 超新星爆发：球面冲击波 + 低频冲击 + 噪声气浪 + 调式和弦琶音 |
| 单击 | 局部星簇光脉冲 + 随机音阶泛音 |
| 键盘 `A S D F G H J K L` | 点亮随机星簇（`uBurstPos`）+ 演奏当前调式音阶风铃音 |
| 滚轮 | 相机推拉（6.5 – 22） |

### 4. 程序化星际合成器

`NebulaAudioEngine` 为单例，四层架构：

1. **Ambient Drone**：3 个振荡器（sine ±6¢ / triangle）+ 低通 + 0.05 Hz LFO。
2. **Generative Chimes**：按预设 BPM 的八分音符 lookahead 调度，马尔可夫音级游走（偏好小音程），
   立体声反馈延迟（0.375s / 0.52s，交叉反馈 + 低通阻尼）模拟宇宙混响。
3. **Interactive Synth**：FM 钟琴音色，Attack 15ms / Release 1.8s。
4. **Solar Wind**：Paul Kellet 粉红噪声 Buffer + 带通滤波，随星云转速调整风声。

> 浏览器自动播放合规：首屏 `IGNITE NEBULA` 按钮内执行 `audioContext.resume()`，
> 主增益从 0.0001 用 2.4s 指数淡入，杜绝爆音。

### 5. 情绪引擎

- 词典覆盖中英文约 200 个词条，三维打分：**Valence 效价 / Arousal 唤醒度 / Mystery 神秘感**。
- 否定词（不 / 没 / 无 / 非 / not / never…）反转效价并提升神秘感；
  程度副词（非常 / 特别 / very / extremely…）与弱化词（有点 / 稍微 / a bit…）做权重乘法。
- 输出连续向量 → 最近邻匹配六大星系 → 生成情绪调色板并与预设色 50% 混合 →
  派生湍流 / 转速 → 生成一句「星云观测日志」。
- 所有参数在 1.5s 内平滑插值（`1 - exp(-dt·2.7)`）。

### 6. 明信片与分享

- `WebGLRenderer` 开启 `preserveDrawingBuffer: true`，`composer.render()` 后 `toDataURL()` 截图。
- 离屏 2D Canvas 合成 1080×1350 玻璃拟态卡片：星云图 + 心情短句 + 星系名 / 音阶 +
  对数频谱条 + 时间戳。
- URL Hash：`{ presetId, customText, colors, turbulence, speed, seed, emotion }`
  → JSON → **LZW 压缩** → **Base64URL** → `#nebula=eyJ...`；
  初始化时反解并 100% 还原，解压失败自动回退明文 Base64。

---

## 五、验收对照

### 阶段一 · 视觉底座
- [x] 全屏 18,000 粒子螺旋星云（桌面端），移动端 / 低帧率自动降至 8,000
- [x] 鼠标拖拽视角、悬停引力扰动
- [x] 长按坍缩 → 松开超新星爆发
- [x] 稳定 60 FPS（实测 140+ FPS @ 850×667，DPR 2）

### 阶段二 · 声景与视听联动
- [x] 点击唤醒后声音平滑淡入（无爆音）
- [x] 低频驱动核心脉动 + Bloom 泛光
- [x] 键盘 `A–L` 流畅弹奏星辰泛音
- [x] 六大预设各自独立调式 / BPM / 湍流 / 转速

### 阶段三 · 情绪引擎与分享闭环
- [x] 切换 6 大预设或输入任意心情文本，颜色 / 形态 / 音阶 1.5s 内渐变
- [x] 定格生成完整明信片并下载 PNG
- [x] 复制链接在新标签页打开 100% 复现（已实测：预设、文本、配色、音阶全部还原）

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
