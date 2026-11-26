/**
 * 星云粒子着色器（双缓冲形变版）
 *
 * 顶点：
 *   1. 双缓冲形变 position → aTargetPosition（错峰 smoothstep + 三次缓出 + 中段旋涡扭转）
 *   2. 分形态动态物理 uBehavior（自转 / 径向脉冲 / 垂直升腾 / 湍流）
 *   3. 开普勒差速旋转 uShear
 *   4. 坍缩、超新星冲击波、指针引力旋涡、键盘星簇爆发
 *   5. 颜色：待机星系的逐顶点色 aColor ↔ 情绪星体的 colorT 三段渐变，权重随 localT 错峰过渡
 *
 * 片元：径向高斯衰减 × 程序化高斯贴图，叠加混合
 */

/** 形变总时长（秒）：2.8s「星际潜入」 */
export const MORPH_DURATION = 2.8;
/** 错峰延迟上限（delay = aRandom × 0.45）与延迟窗口宽度；二者之和 = 1，最迟粒子恰在 p = 1 落定 */
export const MORPH_DELAY_MAX = 0.45;
export const MORPH_DELAY_WIDTH = 0.55;

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// Ashima Arts / Stefan Gustavson 3D Simplex Noise
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);

  vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const nebulaVertexShader = /* glsl */ `
precision highp float;

attribute vec3  aTargetPosition;  // 目标形态坐标（双缓冲）
attribute float aSize;            // 粒子基础尺寸
attribute float aSeed;            // 随机种子
attribute float aRole;            // 结构角色权重 0~1
attribute float aColorT;          // 颜色梯度参数 0~1
attribute float aTargetSize;      // 目标尺寸
attribute float aTargetRole;      // 目标角色权重
attribute float aTargetColorT;    // 目标颜色梯度
attribute float aRandom;          // 错峰飞行种子 0~1
attribute vec3  aColor;           // 逐顶点颜色（待机星系的多色层次）
attribute float aColorW;          // 顶点色权重：1 → aColor，0 → colorT 渐变
attribute float aTargetColorW;    // 目标顶点色权重
attribute float aArm;             // 悬臂序号：0 = 非悬臂，1~6 = 六条情绪悬臂
// 注意：粒子的「形状」不再占用顶点属性 —— 顶点属性已接近 WebGL 的 16 个上限
// （position + 13 个自有属性 + aArm），所以形状改为在着色器里由 aSeed 与 colorT 推导。

uniform float uTime;
uniform float uMorphProgress;     // 0.0 → 1.0
uniform float uTransitionSwirl;   // 潮汐旋涡强度（CPU 按形变进度驱动，两端归零）
uniform float uMorphFade;         // 形变中段的整体淡出，避免粒子穿过圆心时堆成白球
uniform vec4  uBehavior;          // x 自转 / y 径向脉冲 / z 垂直升腾 / w 湍流强度
uniform float uShear;             // 开普勒差速强度

uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uEnergy;            // 潮汐呼吸慢包络 0~1（总 RMS × 旋律潮汐，damp 平滑）
uniform float uSpinPhase;         // 自转积分角（CPU 逐帧累加 dt × 角速度，含 uBehavior.x 与潮汐因子）
uniform float uCollapse;
uniform float uShockRadius;
uniform float uShockAmp;
uniform vec3  uBurstPos;
uniform float uBurstAmp;
uniform float uPixelRatio;
uniform float uSize;
uniform float uViewHeight;        // 视口 CSS 高度，用于把点尺寸换算成与分辨率无关的像素
uniform vec3  uColors[3];

varying vec3  vColor;
varying float vGlow;
varying float vAlpha;
varying float vShape;

${NOISE_GLSL}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  float t = uTime;

  // ================= 1. 双缓冲形变：错峰波浪 + 潮汐旋涡 =================
  float p = clamp(uMorphProgress, 0.0, 1.0);

  // 1.1 每颗粒子错峰延迟（0.0 ~ 0.45），smoothstep 窗口 0.55，三次方缓出
  //     延迟顺序由 aRandom 决定（待机星系按半径排序：核球先启航、旋臂后汇入）
  float delay = aRandom * ${MORPH_DELAY_MAX};
  float localT = smoothstep(delay, delay + ${MORPH_DELAY_WIDTH}, p);
  localT = 1.0 - pow(1.0 - localT, 3.0);

  // 1.2 纯线性基础插值（便于中途打断时 CPU 精确烘焙）
  vec3 base = mix(position, aTargetPosition, localT);

  // 1.3 独立连续的潮汐旋涡与呼吸扩张（消除直线穿模的生硬感）
  float swirlAngle = uTransitionSwirl * (1.35 - length(base) * 0.12);
  float sw = sin(swirlAngle);
  float cw = cos(swirlAngle);
  base.xz = mat2(cw, -sw, sw, cw) * base.xz;
  base *= (1.0 + abs(uTransitionSwirl) * 0.16);

  // 1.4 尺寸 / 角色 / 颜色梯度 / 顶点色权重与坐标同步插值，消除过渡结束时的跳变
  float role = mix(aRole, aTargetRole, localT);
  float colorT = mix(aColorT, aTargetColorT, localT);
  float sizeT = mix(aSize, aTargetSize, localT);
  float colorW = mix(aColorW, aTargetColorW, localT);

  // ================= 2. 分形态动态物理 =================
  float r = length(base.xz);

  // 2.1 自转 + 开普勒差速（内快外慢）。
  //     转角必须用 CPU 积分的 uSpinPhase：若写成 uTime × ω，潮汐改变 ω 时粒子会瞬间多转「运行秒数 × Δω」，
  //     页面开得越久转得越快。角速度随潮汐能量与中频在约 2.5 倍范围内起伏：高潮加速、低落近乎静止。
  base.xz = rot2(base.xz, uSpinPhase * (1.0 + uShear * role / (0.35 + r)));

  // 2.1b 六条情绪悬臂之间缓慢错开。
  //      注意：这里必须是有界摆动，不能写成 t * armId * 速率 —— 那样角位移会随时间无限累积，
  //      页面开一分钟后手臂编号 6 的粒子已被多转 ~8 rad，整颗星系看起来就像换了一颗
  //      （点「返回大星系」时与刚进页面时不一致，刷新后才"变回来"，就是这个原因）。
  //      减掉 t=0 的相位，保证首帧形态与原来的设计完全一致。
  float armFade = 1.0 - smoothstep(0.0, 0.22, uMorphProgress);
  float armId = aArm;
  float armPhase0 = armId * 1.1;
  float armSway = (sin(t * 0.06 + armPhase0) - sin(armPhase0)) * 0.22;
  base.xz = rot2(base.xz, armSway * armFade);

  // 2.2 径向脉冲（随低频能量呼吸）
  float pulse = uBehavior.y * uBass * (0.55 + 0.45 * sin(t * 3.4 + aSeed * 6.2831));
  base *= 1.0 + pulse;

  // 2.3 垂直升腾：每个粒子从自身基点缓慢上升并淡出（相位由种子错开，形态不被拉散）
  float fade = 1.0;
  if (uBehavior.z > 0.001) {
    float period = 7.0;
    float ph = mod(t * uBehavior.z * 3.0 + aSeed * period, period);
    base.y += ph * 0.28;
    fade *= 1.0 - ph / period;
  }

  // 2.4 湍流
  vec3 np = base * 0.55 + vec3(aSeed * 13.0);
  float n1 = snoise(np + vec3(0.0, t * 0.12, 0.0));
  float n2 = snoise(np * 1.8 + vec3(7.3, -t * 0.15, 3.1));
  base += vec3(n1, n2 * 0.7, n1 * 0.5) * uBehavior.w * (0.1 + 0.22 * role) * (0.6 + uMid * 1.3);

  // 2.5 潮汐呼吸（涨起 / 沉落）：高潮整体向外扩张 +18% 并微幅上浮，低落向中心收敛 -12% 并缓缓下沉
  float breathe = 0.88 + uEnergy * 0.30;
  base *= breathe;
  base.y += (uEnergy - 0.5) * 0.25;

  // ================= 3. 全局交互形变 =================
  // 坍缩
  base *= mix(1.0, 0.04, uCollapse);
  base.y *= mix(1.0, 0.2, uCollapse);

  // 超新星冲击波（球面波前）
  float dc = length(base);
  float wave = exp(-pow((dc - uShockRadius) / 0.8, 2.0)) * uShockAmp;
  base += normalize(base + vec3(0.0001)) * wave * 1.5;

  // 键盘星簇光脉冲
  float bd = length(base - uBurstPos);
  float burst = exp(-bd * bd * 0.55) * uBurstAmp;

  // ================= 4. 投影与尺寸 =================
  vec4 mv = modelViewMatrix * vec4(base, 1.0);
  // 形状推导（不占顶点属性）：核心极少数粒子给四芒星、外晕极少数给细光条，其余保持圆点。
  // aSeed 是每颗粒子的固有随机数，colorT 是内外圈梯度，二者组合出来的分布稳定且不需要额外缓冲。
  vShape = (colorT < 0.36 && aSeed < 0.11) ? 1.0 : ((colorT > 0.55 && aSeed > 0.82) ? 2.0 : 0.0);

  // 深度线索：远处粒子更暗更小，近处粒子淡出（推近镜头时不会糊成一屏大光斑）。
  // 加色混合没有前后遮挡，只能靠这两条渐隐制造体积感；下限取 0.62，避免外缘被压得看不见。
  float depth = max(0.35, -mv.z);
  float depthFade = smoothstep(30.0, 6.0, depth);
  float nearFade = smoothstep(0.45, 1.9, depth);

  float twinkle = 1.0 + uTreble * role * (0.55 + 0.45 * sin(t * 9.0 + aSeed * 60.0));
  // 低频推核心脉冲尺寸，高频推外围星尘闪烁尺寸，潮汐高潮整体更饱满
  float sizePx = sizeT * uSize * uPixelRatio * twinkle
    * (1.0 + uBass * 0.35 * role + burst * 1.8)
    * (0.85 + uEnergy * 0.30 + uTreble * 0.30 * role)
    * mix(0.78, 1.0, depthFade);
  // 四芒星要更大的点面积才撑得开星芒
  if (vShape > 0.5 && vShape < 1.5) sizePx *= 1.7;
  // 34.0 是 900px 视高下的经验系数，按视高归一后大小与分辨率无关；同时夹住移动端 GPU 的点尺寸上限
  float pxScale = 34.0 * (uViewHeight / 900.0);
  gl_PointSize = clamp(sizePx * pxScale / depth, 0.6, 160.0);
  gl_Position = projectionMatrix * mv;

  // ================= 5. 颜色 =================
  // 情绪星体：colorT 三段渐变（uColors 逐帧向目标调色板阻尼，保留实时换色）
  vec3 grad = colorT < 0.5
    ? mix(uColors[0], uColors[1], colorT * 2.0)
    : mix(uColors[1], uColors[2], (colorT - 0.5) * 2.0);
  // 待机星系：金白核心 / 暖褐尘埃 / 蓝紫旋臂 / 洋红星结的逐顶点色，随 localT 错峰融入目标渐变
  vColor = mix(grad, aColor, colorW);

// 基础亮度用 main 上调后的取值；再叠加视深渐隐（远处更暗、近处淡出）
  vGlow = (1.0 - colorT) * 0.4
        + role * 0.12
        + uBass * 0.35 * (1.0 - colorT)
        + burst * 2.4
        + wave * 1.4
        + (uEnergy - 0.5) * 0.18;
  vAlpha = (0.22 + 0.78 * (1.0 - colorT * 0.55)) * fade * uMorphFade * (0.94 + uEnergy * 0.12)
         * mix(0.62, 1.0, depthFade) * nearFade;
}
`;

export const nebulaFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uMap;

varying vec3  vColor;
varying float vGlow;
varying float vAlpha;
varying float vShape;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
// 核更紧、边缘更快收：粒子之间才看得见「点」，整片不会糊成雾（main 调过的高斯核）
  float disc = tex.a * exp(-d * d * 4.5);

  float mask = disc;
  float gain = 1.0;

  if (vShape > 0.5 && vShape < 1.5) {
    // 四芒星：横竖两条高次幂窄带交叉，中心保留一点圆核，尖角自然收束
    float sx = pow(max(0.0, 1.0 - abs(uv.y) * 30.0), 3.0) * pow(max(0.0, 1.0 - abs(uv.x) * 2.6), 1.5);
    float sy = pow(max(0.0, 1.0 - abs(uv.x) * 30.0), 3.0) * pow(max(0.0, 1.0 - abs(uv.y) * 2.6), 1.5);
    mask = disc * 0.28 + (sx + sy) * 1.7;
    gain = 1.25;
  } else if (vShape > 1.5) {
    // 细光条：沿 X 拉长的软线，像被潮汐扯开的气体丝
    float streak = exp(-uv.y * uv.y * 320.0) * exp(-abs(uv.x) * 2.0);
    mask = disc * 0.22 + streak;
    gain = 0.92;
  }

  float a = mask * vAlpha;
  vec3 c = vColor * (0.4 + vGlow * 0.62) * gain;
  gl_FragColor = vec4(c, a);
}
`;

/**
 * 深空背景星野（常驻图层）：35~65 球壳上的恒星，尺寸随机、色温各异，
 * 不参与星云形变，仅随场景缓慢微旋并按种子错相位闪烁。
 */
export const starfieldVertexShader = /* glsl */ `
precision highp float;

attribute vec3  aColor;
attribute float aSize;
attribute float aSeed;
attribute float aShape;           // 0 圆点 / 1 带芒亮星

uniform float uTime;
uniform float uPixelRatio;

varying vec3  vColor;
varying float vAlpha;
varying float vShape;

void main() {
  vColor = aColor;
vShape = aShape;
  // 每颗星自己的呼吸节奏：相位错开、频率错开，三次幂让亮的是短促的一闪而不是缓慢起伏
  float tw = pow(0.5 + 0.5 * sin(uTime * (0.9 + aSeed * 2.2) + aSeed * 44.0), 3.0);
  vAlpha = 0.12 + 0.88 * tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (34.0 / max(0.1, -mv.z)) * (0.55 + 1.15 * tw);
  gl_Position = projectionMatrix * mv;
}
`;

export const starfieldFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uMap;
uniform float uOpacity;      // CPU 按低频驱动的整体明度（ShaderMaterial 的 opacity 属性不会自动生效）

varying vec3  vColor;
varying float vAlpha;
varying float vShape;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  vec2 uv = gl_PointCoord - 0.5;
  float disc = tex.a;
  if (vShape > 0.5) {
    // 亮星十字星芒：只在少量恒星上出现，是"天文照片感"最省成本的一笔
    float sx = pow(max(0.0, 1.0 - abs(uv.y) * 26.0), 3.0) * pow(max(0.0, 1.0 - abs(uv.x) * 2.2), 1.4);
    float sy = pow(max(0.0, 1.0 - abs(uv.x) * 26.0), 3.0) * pow(max(0.0, 1.0 - abs(uv.y) * 2.2), 1.4);
    disc = disc * 0.3 + (sx + sy) * 0.9;
  }
  gl_FragColor = vec4(vColor, disc * vAlpha * uOpacity);
}
`;

// ---------------------------------------------------------------- 后期暗角

/** 电影感暗角通道：四周压暗，中心保持明亮；强度随 bass 轻微呼吸 */
export const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.42 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      p.x *= uAspect;
      float d = length(p);
      float vig = smoothstep(0.72, 0.28, d);
      c.rgb *= mix(1.0 - uAmount, 1.0, vig);
      gl_FragColor = c;
    }
  `,
};

// ---------------------------------------------------------------- 背景云气层

/**
 * 云气层顶点着色器：只是一张铺满画面的单位平面（挂在相机下，随相机朝向）。
 * 真正的云来自 CPU 一次性生成的周期性 FBM 贴图，片元里做两层反向漂移，
 * 所以每帧成本只有两次纹理采样，不占片元算力。
 */
export const cloudVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const cloudFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uCloud;
uniform float uTime;
uniform float uEnergy;      // 潮汐呼吸慢包络
uniform float uBass;
uniform float uOpacity;     // 由 CPU 按预设淡入淡出（待机 M31 不加云气）
uniform vec3  uColors[3];

varying vec2 vUv;

void main() {
  // 两层反向漂移：低层慢、上层快，错开后看不出贴图重复
  vec2 uv1 = vUv + vec2(uTime * 0.0045, uTime * 0.0026);
  vec2 uv2 = vUv * 1.9 + vec2(-uTime * 0.0072, uTime * 0.0031);
  float n1 = texture2D(uCloud, uv1).r;
  float n2 = texture2D(uCloud, uv2).r;
  float n = n1 * 0.66 + n2 * 0.34;

  // 径向遮罩：只有中心附近有云，边缘干净，避免整屏糊一层雾
  vec2 c = (vUv - 0.5) * vec2(1.0, 1.35);
  float core = smoothstep(0.52, 0.02, length(c));

  // 亮度：深空微光 × 潮汐呼吸 × 低频推亮；幂次让稀薄区更通透
  float dens = pow(clamp(n, 0.0, 1.0), 2.4);
  float glow = dens * core * uOpacity * (0.55 + uEnergy * 0.55 + uBass * 0.18);

  vec3 col = mix(uColors[2], uColors[1], clamp(n * 1.35, 0.0, 1.0));
  gl_FragColor = vec4(col, glow * 0.06);
}
`;

// ---------------------------------------------------------------- 星座连线

/**
 * 星座连线（屏幕空间扩展版）。
 *
 * WebGL 的 `gl.LINES` 线宽在多数平台被固定为 1px，所以这里没用 LineSegments：
 * 每条边用 4 个顶点拼成一条细带，在顶点着色器里沿屏幕空间法线外扩，宽度可控（uWidthPx）。
 * 位置仍取真实赤经赤纬算出的 3D 坐标，所以相机怎么转、星野怎么自转，线都和星点严丝合缝。
 */
export const constellationVertexShader = /* glsl */ `
precision highp float;

attribute vec3  aStart;
attribute vec3  aEnd;
attribute float aSide;       // -1 / +1：细带的左右两侧
attribute float aT;          // 0 起点 → 1 终点
attribute float aDelay;      // 该边在描线动画里的延迟 0~0.35
attribute float aAlpha;      // 该星座当前整体透明度（CPU 逐帧写）
attribute vec3  aColor;

uniform float uWidthPx;      // 线宽（设备像素）
uniform vec2  uResolution;   // 画布设备像素尺寸
uniform float uDraw;         // 描线进度 0~1

varying vec3  vColor;
varying float vAlpha;
varying float vSide;
varying float vT;

void main() {
  vec4 cs = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 ce = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  vec4 base = mix(cs, ce, aT);

  // 先投到 NDC 求方向，再换回 clip space 施加偏移：乘 base.w 让偏移在屏幕上保持恒定的像素宽度
  vec2 s = cs.xy / max(0.001, cs.w);
  vec2 e = ce.xy / max(0.001, ce.w);
  vec2 dir = e - s;
  dir = length(dir) < 1e-5 ? vec2(1.0, 0.0) : normalize(dir);
  vec2 nrm = vec2(-dir.y, dir.x);
  base.xy += nrm * (aSide * uWidthPx * 0.5) * (2.0 / uResolution) * base.w;

  vColor = aColor;
  vSide = aSide;
  vT = aT;
  // 描线：每条边按 aDelay 错峰出现，前沿做一点柔化
  float p = clamp((uDraw - aDelay) / max(0.001, 1.0 - aDelay), 0.0, 1.0);
  vAlpha = aAlpha * (1.0 - smoothstep(p, p + 0.10, aT));
  gl_Position = base;
}
`;

export const constellationFragmentShader = /* glsl */ `
precision highp float;

varying vec3  vColor;
varying float vAlpha;
varying float vSide;
varying float vT;

void main() {
  // 软边：中心实、两侧渐隐，读起来像一根发光细丝而不是几何线
  float edge = 1.0 - smoothstep(0.30, 1.0, abs(vSide));
  // 沿线极轻微的呼吸，避免机械直线感
  float breathe = 0.86 + 0.14 * sin(vT * 6.2831 + 1.7);
  gl_FragColor = vec4(vColor, vAlpha * edge * breathe);
}
`;

// ---------------------------------------------------------------- 胶片层（颗粒 / 色差 / 冲击波）

/**
 * 最后一层：极轻的色差 + 亮度反相关颗粒 + 超新星径向冲击。
 * - 色差把边缘的红/蓝轻微错开，消除"数码感"；
 * - 颗粒只在中间调出现，纯暗区保持干净（否则整屏像蒙了噪点）；
 * - uShock 由 CPU 从冲击波振幅驱动（0~1），只在中环最强，中心不糊。
 */
export const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uShock: { value: 0 },
    /** 颗粒极轻：只在中间调出现，纯暗区保持干净（否则整屏像蒙了噪点） */
    uGrain: { value: 0.006 },
    uCA: { value: 0.22 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uShock;
    uniform float uGrain;
    uniform float uCA;

    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(vec2(c.x * uAspect, c.y));
      vec2 dir = normalize(c + vec2(1e-5));

      // 冲击波：径向推挤，中心弱、中环最强
      float shock = uShock * exp(-pow(r - 0.35, 2.0) * 12.0);
      uv += dir * shock * 0.03;

      // 色差：越靠边缘越明显，爆发瞬间额外加强
      float ca = (uCA + shock * 2.4) * (0.35 + r * 0.9);
      vec3 col = vec3(
        texture2D(tDiffuse, uv + dir * ca * 0.0016).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - dir * ca * 0.0016).b
      );

      // 颗粒：只作用于中间调（纯黑区不撒噪），幅度极轻，避免"脏"
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float n = hash(floor(gl_FragCoord.xy) + floor(uTime * 60.0)) - 0.5;
      float grainMask = smoothstep(0.04, 0.30, lum) * (1.0 - smoothstep(0.75, 1.0, lum));
      col += n * uGrain * grainMask;

      col *= 1.0 + shock * 0.10;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
