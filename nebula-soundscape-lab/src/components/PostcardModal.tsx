import { Check, Download, Link2, X } from 'lucide-react';
import type { NebulaPreset } from '../types';

interface Props {
  image: string;
  preset: NebulaPreset;
  mood: string;
  copied: boolean;
  onClose: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
}

/** 明信片预览、下载与分享链接复制 */
export default function PostcardModal({
  image,
  preset,
  mood,
  copied,
  onClose,
  onDownload,
  onCopyLink,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[94vh] w-full max-w-[560px] overflow-y-auto rounded-3xl border border-white/15 bg-[#070a14]/90 p-4 shadow-[0_40px_120px_-30px_rgba(0,0,0,1)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-medium text-white">星云声波明信片</h3>
            <p className="mt-0.5 text-[11px] tracking-[0.18em] text-white/40">
              {preset.name} · {preset.scaleName}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          <img
            src={image}
            alt="星云声波明信片"
            className="mx-auto block max-h-[58vh] w-auto object-contain"
          />
        </div>

        {mood && <p className="mt-3 text-center text-[12px] leading-6 text-white/45">「{mood}」</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={onDownload}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 py-2.5 text-[13px] text-white transition-all hover:border-white/40 hover:bg-white/20"
          >
            <Download size={15} />
            下载 PNG
          </button>
          <button
            onClick={onCopyLink}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 py-2.5 text-[13px] text-white transition-all hover:border-white/40 hover:bg-white/20"
          >
            {copied ? <Check size={15} className="text-emerald-300" /> : <Link2 size={15} />}
            {copied ? '已复制链接' : '复制分享链接'}
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] leading-5 text-white/30">
          链接内包含当前星云的预设、配色与心情参数，打开即可 100% 复现。
        </p>
      </div>
    </div>
  );
}
