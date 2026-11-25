/**
 * 星云粒子着色器（双缓冲形变版）
 *
 * 顶点：
 *   1. 双缓冲形变 position → aTargetPosition（cubic ease-in-out + 中段旋涡扭转）
 *   2. 分形态动态物理 uBehavior（自转 / 径向脉冲 / 垂直升腾 / 湍流）
 *   3. 开普勒差速旋转 uShear
 *   4. 坍缩、超新星冲击波、指针引力旋涡、键盘星簇爆发
 *
 * 片元：径向高斯衰减 × 程序化高斯贴图，叠加混合
 */

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

uniform float uTime;
uniform float uMorphProgress;     // 0.0 → 1.0
uniform float uTransitionSwirl;   // 潮汐旋涡强度（CPU 按形变进度驱动，两端归零）
uniform vec4  uBehavior;          // x 自转 / y 径向脉冲 / z 垂直升腾 / w 湍流强度
uniform float uShear;             // 开普勒差速强度

uniform float uBass;
uniform float uMid;
uniform float uTreble;
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

  // 1.1 每颗粒子错峰延迟（0.0 ~ 0.35），三次方缓出，落地更柔和
  float delay = aRandom * 0.35;
  float localT = smoothstep(delay, delay + 0.65, p);
  localT = 1.0 - pow(1.0 - localT, 3.0);

  // 1.2 纯线性基础插值（便于中途打断时 CPU 精确烘焙）
  vec3 base = mix(position, aTargetPosition, localT);

  // 1.3 独立连续的潮汐旋涡与呼吸扩张（消除直线穿模的生硬感）
  float swirlAngle = uTransitionSwirl * (1.35 - length(base) * 0.12);
  float sw = sin(swirlAngle);
  float cw = cos(swirlAngle);
  base.xz = mat2(cw, -sw, sw, cw) * base.xz;
  base *= (1.0 + abs(uTransitionSwirl) * 0.16);

  // 1.4 尺寸 / 角色 / 颜色梯度与坐标同步插值，消除过渡结束时的跳变
  float role = mix(aRole, aTargetRole, localT);
  float colorT = mix(aColorT, aTargetColorT, localT);
  float sizeT = mix(aSize, aTargetSize, localT);

  // ================= 2. 分形态动态物理 =================
  float r = length(base.xz);

  // 2.1 自转 + 开普勒差速（内快外慢）
  float omega = uBehavior.x * (1.0 + uShear * role / (0.35 + r));
  base.xz = rot2(base.xz, t * omega);

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
  float sizePx = sizeT * uSize * uPixelRatio * twinkle * (1.0 + uBass * 0.35 * role + burst * 1.8);
  gl_PointSize = sizePx * (34.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;

  // ================= 5. 颜色 =================
  vec3 col = colorT < 0.5
    ? mix(uColors[0], uColors[1], colorT * 2.0)
    : mix(uColors[1], uColors[2], (colorT - 0.5) * 2.0);
  vColor = col;

  vGlow = (1.0 - colorT) * 0.4
        + role * 0.12
        + uBass * 0.35 * (1.0 - colorT)
        + burst * 2.4
        + wave * 1.4;
  vAlpha = (0.22 + 0.78 * (1.0 - colorT * 0.55)) * fade;
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
