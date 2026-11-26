import type { NebulaPreset, Palette } from '../types';

/**
 * 离屏 2D Canvas 合成「星云声波明信片」
 * 玻璃拟态收藏卡片：星云高清图 + 心情短句 + 星系名称与音阶 + 实时频谱 + 时间戳
 */

export interface PostcardOptions {
  image: string;
  mood: string;
  preset: NebulaPreset;
  palette: Palette;
  spectrum: number[];
  timestamp: number;
  /** 当前生效的调式名（用户可能把音阶切成调式库里的其它调式，不能再用 preset.scaleName） */
  scaleName?: string;
}

const W = 1080;
const H = 1350;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('postcard image load failed'));
    img.src = src;
  });
}

/** cover 模式绘制，保持比例裁切 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = '';
  let truncated = false;
  for (const ch of Array.from(text)) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = ch;
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    } else {
      current = test;
    }
  }
  if (!truncated && lines.length < maxLines && current) lines.push(current);
  // 超出最大行数时补省略号：原来直接 break，后面的文字连省略号都没有，读者会以为句子就这样结束了
  if (truncated && lines.length > 0) {
    const i = lines.length - 1;
    const last = lines[i];
    // 去掉最后一个字再补省略号，避免加完超出 maxWidth
    lines[i] = `${last.length > 1 ? last.slice(0, -1) : last}…`;
  }
  return lines;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function generatePostcard(opts: PostcardOptions): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // ---------- 背景 ----------
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.32, 40, W * 0.5, H * 0.55, H * 0.95);
  bg.addColorStop(0, opts.preset.bg);
  bg.addColorStop(0.55, '#03040d');
  bg.addColorStop(1, '#000000');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 细微星点
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.6;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.35})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- 星云图 ----------
  const area = { x: 56, y: 56, w: W - 112, h: 742 };
  const img = await loadImage(opts.image);

  ctx.save();
  roundRectPath(ctx, area.x, area.y, area.w, area.h, 30);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(area.x, area.y, area.w, area.h);
  drawCover(ctx, img, area.x, area.y, area.w, area.h);
  // 顶部与底部的柔和渐隐，让画面融入卡片
  const fadeTop = ctx.createLinearGradient(0, area.y, 0, area.y + 140);
  fadeTop.addColorStop(0, 'rgba(0,0,0,0.45)');
  fadeTop.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fadeTop;
  ctx.fillRect(area.x, area.y, area.w, 140);
  const fadeBottom = ctx.createLinearGradient(0, area.y + area.h - 200, 0, area.y + area.h);
  fadeBottom.addColorStop(0, 'rgba(0,0,0,0)');
  fadeBottom.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = fadeBottom;
  ctx.fillRect(area.x, area.y + area.h - 200, area.w, 200);

  // 与屏幕一致的四角压暗：网页上有一层 CSS 暗角，截图截不到它，
  // 之前卡片里的星云因此比屏幕上亮一圈。这里在星云区域内补同一效果的径向暗角。
  const vig = ctx.createRadialGradient(
    area.x + area.w * 0.5,
    area.y + area.h * 0.46,
    area.w * 0.12,
    area.x + area.w * 0.5,
    area.y + area.h * 0.46,
    area.w * 0.62,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.62, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.restore();

  roundRectPath(ctx, area.x, area.y, area.w, area.h, 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ---------- 玻璃卡片 ----------
  const card = { x: 56, y: 838, w: W - 112, h: 436 };

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 20;
  roundRectPath(ctx, card.x, card.y, card.w, card.h, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.085)';
  ctx.fill();
  ctx.restore();

  // 玻璃高光
  const sheen = ctx.createLinearGradient(card.x, card.y, card.x + card.w, card.y + card.h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(0.42, 'rgba(255,255,255,0.03)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.10)');
  roundRectPath(ctx, card.x, card.y, card.w, card.h, 34);
  ctx.fillStyle = sheen;
  ctx.fill();

  roundRectPath(ctx, card.x, card.y, card.w, card.h, 34);
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ---------- 文字 ----------
  const padX = 52;
  let cy = card.y + 62;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // 星系名
  ctx.font = '600 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;
  ctx.fillText(opts.preset.name, card.x + padX, cy);
  ctx.shadowBlur = 0;

  // 英文 + 情绪标签
  ctx.font = '500 22px "SF Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  const meta = `${opts.preset.english}   ·   ${opts.preset.label}`;
  ctx.fillText(meta.split('').join(' '), card.x + padX, cy + 40);

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(card.x + padX, cy + 74);
  ctx.lineTo(card.x + card.w - padX, cy + 74);
  ctx.stroke();

  // 心情短句
  const moodText = (opts.mood || '').trim() || '此刻，无需言语。';
  ctx.font = '400 36px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  const lines = wrapText(ctx, moodText, card.w - padX * 2, 3);
  let ty = cy + 132;
  for (const line of lines) {
    ctx.fillText(line, card.x + padX, ty);
    ty += 52;
  }

  // 音阶信息
  ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = opts.palette[1];
  ctx.globalAlpha = 0.95;
  ctx.fillText(`音阶 · ${opts.scaleName ?? opts.preset.scaleName}`, card.x + padX, card.y + card.h - 148);
  ctx.globalAlpha = 1;

  // ---------- 频谱 ----------
  const bars = opts.spectrum.length ? opts.spectrum : new Array(48).fill(0.2);
  const barArea = { x: card.x + padX, y: card.y + card.h - 108, w: card.w - padX * 2, h: 54 };
  const n = bars.length;
  const gap = 4;
  const bw = Math.max(3, (barArea.w - gap * (n - 1)) / n);
  const grad = ctx.createLinearGradient(barArea.x, barArea.y, barArea.x, barArea.y + barArea.h);
  grad.addColorStop(0, '#FFFFFF');
  grad.addColorStop(0.5, opts.palette[1]);
  grad.addColorStop(1, opts.palette[2]);
  ctx.fillStyle = grad;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.06, Math.min(1, bars[i] * 1.35));
    const bh = Math.max(4, v * barArea.h);
    const x = barArea.x + i * (bw + gap);
    roundRectPath(ctx, x, barArea.y + barArea.h - bh, bw, bh, bw / 2);
    ctx.fill();
  }

  // 时间戳
  ctx.font = '400 20px "SF Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'right';
  ctx.fillText(formatTime(opts.timestamp), card.x + card.w - padX, card.y + card.h - 148);
  ctx.textAlign = 'left';

  // ---------- 页脚 ----------
  ctx.font = '500 18px "SF Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('NEBULA SOUNDSCAPE LAB', 56, H - 46);
  ctx.textAlign = 'right';
  ctx.fillText('2026 QODER · LIFEHACK', W - 56, H - 46);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

/** 触发浏览器下载 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
