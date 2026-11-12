import type { Clipboard } from '../core/editor';
import { celToImageData } from '../render/imagedata';

/** Best-effort: puts the internal clipboard on the system clipboard as a PNG. Failures are ignored. */
export async function writeSystemClipboard(c: Clipboard): Promise<void> {
  try {
    const pixels = c.pixels.map((v, i) => (c.mask[i] ? v : 0));
    const canvas = document.createElement('canvas');
    canvas.width = c.w;
    canvas.height = c.h;
    canvas.getContext('2d')!.putImageData(celToImageData(pixels, c.w, c.h), 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (blob && navigator.clipboard && 'write' in navigator.clipboard) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
  } catch {
    /* clipboard access can be denied; the internal clipboard still works */
  }
}

/** Decodes an image blob (e.g. pasted from the system clipboard) into packed pixels. */
export async function readImageBlob(blob: Blob): Promise<{ w: number; h: number; pixels: Uint32Array }> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { w: canvas.width, h: canvas.height, pixels: new Uint32Array(data.buffer.slice(0)) };
}
