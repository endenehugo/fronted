import * as THREE from 'three';

/**
 * 待机星系的「连续光面」底纹：不再画旋臂，只铺一层填满的白色星云带
 * （中心暖白、外缘冷蓝，叠加低频明暗团块），让点云之间没有空洞，
 * 结构完全交给六条情绪悬臂自己去长。
 *
 * 只用于 galaxy_idle，飞向情绪星云时随 morph 淡出。
 */
const SIZE = 1024;
const GALAXY_R = 4.0;
const PX = SIZE / (2 * GALAXY_R);

function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  mid: string,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.6, r));
  g.addColorStop(0, color);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
  ctx.fill();
}

export function createGalaxyTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.globalCompositeOperation = 'lighter';
  const cx = SIZE * 0.5;
  const cy = SIZE * 0.5;

  // ---- 1. 填满的星云带：中心暖白 → 中段灰蓝 → 外缘冷蓝，连续无断口
  const disk = ctx.createRadialGradient(cx, cy, 0, cx, cy, 3.55 * PX);
  disk.addColorStop(0, 'rgba(255,248,238,0.2)');
  disk.addColorStop(0.16, 'rgba(255,240,222,0.13)');
  disk.addColorStop(0.4, 'rgba(214,224,255,0.09)');
  disk.addColorStop(0.68, 'rgba(150,170,248,0.05)');
  disk.addColorStop(0.88, 'rgba(96,120,220,0.02)');
  disk.addColorStop(1, 'rgba(70,90,190,0)');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.57 * PX, 0, Math.PI * 2);
  ctx.fill();

  // ---- 2. 低频团块：让白面不是一块均匀的糖霜，而是有厚薄、有丝絮
  for (let k = 0; k < 140; k++) {
    const r = Math.pow(Math.random(), 0.7) * 3.3;
    const ang = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(ang) * r * PX;
    const y = cy + Math.sin(ang) * r * PX;
    const s = (0.3 + Math.random() * 0.85) * PX;
    const warm = Math.exp(-r / 1.2);
    const a = 0.03 + Math.random() * 0.055;
    blob(
      ctx,
      x,
      y,
      s,
      `rgba(${Math.round(255 - 60 * (1 - warm))},${Math.round(248 - 26 * (1 - warm))},${Math.round(236 + 12 * (1 - warm))},${a})`,
      `rgba(170,190,255,${a * 0.4})`,
    );
  }

  // ---- 3. 亮核：小而集中的暖白核球
  const coreR = 0.6 * PX;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, 'rgba(255,253,248,0.6)');
  core.addColorStop(0.3, 'rgba(255,242,214,0.3)');
  core.addColorStop(0.7, 'rgba(255,218,168,0.09)');
  core.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.3, 1);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ---- 4. 边界柔化：径向挖掉外圈，避免看到贴图/平面的直边
  ctx.globalCompositeOperation = 'destination-out';
  const mask = ctx.createRadialGradient(cx, cy, 2.3 * PX, cx, cy, 3.25 * PX);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}