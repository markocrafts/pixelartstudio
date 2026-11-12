import { compositeFrame } from '../core/composite';
import type { Project } from '../core/project';
import { celToImageData } from '../render/imagedata';

export const EXPORT_SCALES = [1, 2, 4, 8, 16, 32] as const;

/** Exports one frame as a PNG, scaled with nearest-neighbor. */
export async function exportPngBlob(project: Project, frameIndex: number, scale: number): Promise<Blob> {
  const { width: w, height: h } = project;
  scale = Math.min(32, Math.max(1, Math.round(scale)));
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  src.getContext('2d')!.putImageData(celToImageData(compositeFrame(project, project.frames[frameIndex]!), w, h), 0, 0);
  const out = document.createElement('canvas');
  out.width = w * scale;
  out.height = h * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
