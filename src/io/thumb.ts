import { compositeFrame } from '../core/composite';
import type { Project } from '../core/project';
import { celToImageData } from '../render/imagedata';

/** Small PNG data URL of frame 1, fitted into `size` px with nearest-neighbor scaling. */
export function makeThumbnail(p: Project, size = 96): string {
  try {
    const src = document.createElement('canvas');
    src.width = p.width;
    src.height = p.height;
    src.getContext('2d')!.putImageData(celToImageData(compositeFrame(p, p.frames[0]!), p.width, p.height), 0, 0);
    const k = Math.min(size / p.width, size / p.height);
    const w = Math.max(1, Math.round(p.width * k)), h = Math.max(1, Math.round(p.height * k));
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, w, h);
    return out.toDataURL('image/png');
  } catch {
    return '';
  }
}
