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

uniform float uTime;
uniform float uMorphProgress;     // 0.0 → 1.0
uniform float uTransitionSwirl;   // 潮汐旋涡强度（CPU 按形变进度驱动，两端归零）
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
uniform vec3  uPointer;
uniform float uPointerStrength;
uniform vec3  uBurstPos;
uniform float uBurstAmp;
uniform float uPixelRatio;
uniform float uSize;
uniform vec3  uColors[3];

varying vec3  vColor;
varying float vGlow;
varying float vAlpha;

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

  // 指针局部引力旋涡
  vec3 toP = uPointer - base;
  float pd = length(toP);
  float infl = smoothstep(3.2, 0.0, pd) * uPointerStrength;
  vec3 pdir = toP / max(pd, 0.0001);
  vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), pdir) + vec3(0.0001));
  base += (pdir * 0.55 + tang * 0.95) * infl * (0.45 + 0.75 * role);

  // 键盘星簇光脉冲
  float bd = length(base - uBurstPos);
  float burst = exp(-bd * bd * 0.55) * uBurstAmp;

  // ================= 4. 投影与尺寸 =================
  vec4 mv = modelViewMatrix * vec4(base, 1.0);

  float twinkle = 1.0 + uTreble * role * (0.55 + 0.45 * sin(t * 9.0 + aSeed * 60.0));
  // 低频推核心脉冲尺寸，高频推外围星尘闪烁尺寸，潮汐高潮整体更饱满
  float sizePx = sizeT * uSize * uPixelRatio * twinkle
    * (1.0 + uBass * 0.35 * role + burst * 1.8)
    * (0.85 + uEnergy * 0.30 + uTreble * 0.30 * role);
  gl_PointSize = sizePx * (34.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;

  // ================= 5. 颜色 =================
  // 情绪星体：colorT 三段渐变（uColors 逐帧向目标调色板阻尼，保留实时换色）
  vec3 grad = colorT < 0.5
    ? mix(uColors[0], uColors[1], colorT * 2.0)
    : mix(uColors[1], uColors[2], (colorT - 0.5) * 2.0);
  // 待机星系：金白核心 / 暖褐尘埃 / 蓝紫旋臂 / 洋红星结的逐顶点色，随 localT 错峰融入目标渐变
  vColor = mix(grad, aColor, colorW);

  // 潮汐明暗呼吸：高潮泛光更亮，低落压暗到深空微光（±约 15%）
  vGlow = (1.0 - colorT) * 0.4
        + role * 0.12
        + uBass * 0.35 * (1.0 - colorT)
        + burst * 2.4
        + wave * 1.4
        + (uEnergy - 0.5) * 0.3;
  vAlpha = (0.22 + 0.78 * (1.0 - colorT * 0.55)) * fade * (0.82 + uEnergy * 0.2);
}
`;

export const nebulaFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uMap;

varying vec3  vColor;
varying float vGlow;
varying float vAlpha;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float falloff = exp(-d * d * 2.4);
  float a = tex.a * falloff * vAlpha;
  vec3 c = vColor * (0.45 + vGlow * 0.85);
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

uniform float uTime;
uniform float uPixelRatio;

varying vec3  vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vAlpha = 0.6 + 0.4 * sin(uTime * (0.35 + aSeed * 0.9) + aSeed * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (34.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

export const starfieldFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uMap;

varying vec3  vColor;
varying float vAlpha;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor, tex.a * vAlpha);
}
`;
