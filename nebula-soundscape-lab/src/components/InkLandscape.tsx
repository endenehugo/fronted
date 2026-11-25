import { memo } from 'react';

/**
 * 明场水墨青绿山水层（light 主题）
 * - 底层：宣纸白底 + 水墨山水插画（public/ink/landscape.png）
 * - 中层：缓慢漂移的墨色烟絮（柔边椭圆 / 模糊渐变）
 * - 上层：横贯画面的极细水墨流线
 * 纯静态分层 + CSS 循环动画，不依赖 WebGL；暗场时整层淡出卸载。
 */

/** 烟絮团：位置 / 尺寸 / 配色 / 漂移时长 */
const SMOKES = [
  { left: '8%', top: '30%', w: 340, h: 150, color: 'rgba(90,110,100,0.16)', dur: 26, delay: 0 },
  { left: '38%', top: '20%', w: 420, h: 170, color: 'rgba(122,155,118,0.14)', dur: 32, delay: 4 },
  { left: '64%', top: '38%', w: 360, h: 150, color: 'rgba(74,92,88,0.15)', dur: 28, delay: 9 },
  { left: '20%', top: '52%', w: 300, h: 130, color: 'rgba(176,122,78,0.10)', dur: 35, delay: 2 },
];

/** 细流线：横向墨笔线条，缓慢横移 */
const LINES = [
  { top: '34%', w: '55%', left: '10%', dur: 30, delay: 0, opacity: 0.35 },
  { top: '46%', w: '42%', left: '44%', dur: 36, delay: 6, opacity: 0.28 },
  { top: '58%', w: '48%', left: '16%', dur: 33, delay: 3, opacity: 0.22 },
];

function InkSmoke() {
  return (
    <>
      {SMOKES.map((s, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-full blur-2xl"
          style={{
            left: s.left,
            top: s.top,
            width: s.w,
            height: s.h,
            background: `radial-gradient(ellipse at center, ${s.color} 0%, transparent 70%)`,
            animation: `inkDrift ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
}

function InkLines() {
  return (
    <>
      {LINES.map((l, i) => (
        <div
          key={i}
          className="pointer-events-none absolute"
          style={{
            top: l.top,
            left: l.left,
            width: l.w,
            height: 1,
            opacity: l.opacity,
            background:
              'linear-gradient(90deg, transparent, rgba(62,92,89,0.55) 30%, rgba(62,92,89,0.35) 70%, transparent)',
            animation: `inkLine ${l.dur}s ease-in-out ${l.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
}

const InkLandscape = memo(function InkLandscape() {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      aria-label="水墨青绿山水明场"
      role="img"
    >
      {/* 山水插画底图，cover 铺满，保持宣纸白基调 */}
      <img
        src="/ink/landscape.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* 淡青绿雾气罩，统一明暗与留白 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(243,237,224,0.28) 0%, rgba(243,237,224,0.05) 40%, rgba(243,237,224,0.22) 100%)',
        }}
      />
      <InkSmoke />
      <InkLines />
    </div>
  );
});

export default InkLandscape;
