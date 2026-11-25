/**
 * 星云粒子着色器
 * 顶点：开普勒差速旋转 + Simplex 湍流 + 指针引力旋涡 + 坍缩 + 超新星冲击波
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

attribute float aType;     // 0 核心恒星区 / 1 对数螺旋旋臂 / 2 外围星尘晕
attribute float aRadius;   // 基础半径
attribute float aTheta;    // 基础极角
attribute float aY;        // 垂直偏移
attribute float aSize;     // 基础尺寸
attribute float aSeed;     // 随机种子

uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uTurbulence;
uniform float uSpeed;
uniform float uSpin;
uniform float uTwist;
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

void main() {
  float t = uTime;

  float isCore = 1.0 - step(0.5, aType);
  float isArm  = step(0.5, aType) * (1.0 - step(1.5, aType));
  float isHalo = step(1.5, aType);

  // ---- 开普勒差速旋转：内圈略快于外圈（保持旋臂可辨识） ----
  float omega = uSpin * uSpeed * (0.55 + 0.45 / (0.9 + aRadius * 0.6));
  // ---- 对数螺旋：theta = theta0 + twist * ln(1 + r)，可随预设平滑插值 ----
  float theta = aTheta + log(1.0 + aRadius) * uTwist + t * omega;

  // ---- 半径：低频心跳呼吸 + 长按坍缩 ----
  float r = aRadius;
  r *= 1.0 + uBass * 0.22 * isCore * (0.75 + 0.25 * sin(t * 3.2 + aSeed * 6.2831));
  r *= mix(1.0, 0.035, uCollapse);

  vec3 base = vec3(cos(theta) * r, aY * mix(1.0, 0.12, uCollapse), sin(theta) * r);

  // ---- 气体湍流褶皱（Simplex Curl 近似） ----
  vec3 np = base * 0.42 + vec3(aSeed * 17.0);
  float n1 = snoise(np + vec3(0.0, t * 0.11, 0.0));
  float n2 = snoise(np * 1.7 + vec3(11.3, -t * 0.14, 5.1));
  vec3 turb = vec3(n1, n2 * 0.65, n1 * 0.55);
  base += turb * uTurbulence * (0.16 + 0.55 * isArm) * (0.55 + uMid * 1.45);

  // ---- 超新星冲击波：以中心为圆心的球面波前 ----
  float dc = length(base.xz);
  float wave = exp(-pow((dc - uShockRadius) / 0.75, 2.0)) * uShockAmp;
  base.xz += normalize(base.xz + vec2(0.0001)) * wave * 1.45;
  base.y  += wave * 0.28 * sin(aSeed * 31.0);

  // ---- 指针局部引力旋涡：径向吸附 + 切向搅动 ----
  vec3 toP = uPointer - base;
  float pd = length(toP);
  float infl = smoothstep(3.2, 0.0, pd) * uPointerStrength;
  vec3 pdir = toP / max(pd, 0.0001);
  vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), pdir) + vec3(0.0001));
  base += (pdir * 0.55 + tang * 0.95) * infl * (0.45 + 0.75 * isArm);

  // ---- 键盘星簇光脉冲 ----
  float bd = length(base - uBurstPos);
  float burst = exp(-bd * bd * 0.55) * uBurstAmp;

  vec4 mv = modelViewMatrix * vec4(base, 1.0);

  // ---- 尺寸：高频星尘闪烁 + 低频核心膨胀 ----
  float twinkle = 1.0 + uTreble * isHalo * (0.55 + 0.45 * sin(t * 9.0 + aSeed * 60.0));
  float sizePx = aSize * uSize * uPixelRatio * twinkle * (1.0 + uBass * 0.35 * isCore + burst * 1.8);
  gl_PointSize = sizePx * (34.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;

  // ---- 配色：内核 / 旋臂 / 外晕三段渐变 ----
  vec3 col = mix(uColors[1], uColors[0], isCore);
  col = mix(col, uColors[2], isHalo * 0.88 + smoothstep(1.0, 7.0, dc) * 0.38 * isArm);

  vColor = col;
  vGlow = isCore * (0.22 + uBass * 0.55)
        + isArm * 0.34
        + isHalo * 0.10
        + burst * 2.4
        + wave * 1.4;
  vAlpha = 0.20 + 0.80 * (isCore * 0.72 + isArm * 0.50 + isHalo * 0.16);
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
