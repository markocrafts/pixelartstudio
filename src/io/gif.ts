import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { indexFrames } from '../core/gifindex';
import { scaleCel } from '../core/transform';

export interface GifJob {
  frames: Uint32Array[];
  delaysMs: number[];
  width: number;
  height: number;
  scale: number;
  /** Loop forever when true, play once when false. */
  loop: boolean;
}

/**
 * Encodes frames as an animated GIF. Uses an exact global palette when the animation has at most 255
 * colors (plus transparency); otherwise quantizes. Pure and DOM-free, so it can run in a worker.
 */
export function encodeGif(job: GifJob, onProgress?: (done: number, total: number) => void): Uint8Array {
  const { width: w, height: h, scale } = job;
  const sw = w * scale, sh = h * scale;
  const scaled = scale === 1 ? job.frames : job.frames.map((f) => scaleCel(f, w, h, sw, sh));
  const enc = GIFEncoder();
  const exact = indexFrames(scaled);
  const total = scaled.length;
  let palette: number[][];
  let indexed: Uint8Array[] | null = null;
  let transparentIndex = -1;
  if (exact) {
    palette = exact.palette;
    indexed = exact.indices;
    transparentIndex = exact.transparentIndex;
  } else {
    // Too many colors: build one palette from all frames (alpha folded to 1 bit) and map every frame onto it.
    const sample = new Uint8Array(scaled.reduce((n, f) => n + f.length * 4, 0));
    let o = 0;
    for (const f of scaled) { sample.set(new Uint8Array(f.buffer, f.byteOffset, f.length * 4), o); o += f.length * 4; }
    palette = quantize(sample, 256, { format: 'rgba4444', oneBitAlpha: true });
    transparentIndex = palette.findIndex((c) => (c[3] ?? 255) === 0);
  }
  const rgbPalette = palette.map((c) => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0]);
  scaled.forEach((f, i) => {
    const index = indexed ? indexed[i]! : applyPalette(new Uint8Array(f.buffer, f.byteOffset, f.length * 4), palette, 'rgba4444');
    enc.writeFrame(index, sw, sh, {
      ...(i === 0 ? { palette: rgbPalette } : {}),
      delay: Math.max(20, job.delaysMs[i] ?? 100),
      repeat: job.loop ? 0 : -1,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: transparentIndex >= 0 ? 2 : 0,
      first: i === 0,
    });
    onProgress?.(i + 1, total);
  });
  enc.finish();
  return enc.bytes();
}
