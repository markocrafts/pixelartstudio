/** Largest per-channel RGBA difference as a percentage (0..100). Fully transparent pixels are all equal. */
export function colorDistancePct(a: number, b: number): number {
  const aa = a >>> 24;
  const ba = b >>> 24;
  if (aa === 0 && ba === 0) return 0;
  const d = Math.max(
    Math.abs((a & 255) - (b & 255)),
    Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255)),
    Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255)),
    Math.abs(aa - ba),
  );
  return (d / 255) * 100;
}

/**
 * Returns a mask (1 = fill) of the pixels a bucket fill at (x,y) would change, or null if (x,y) is outside.
 * `sample` is the image the comparison is made on (a single cel or a composite).
 * Contiguous mode uses 4-connectivity.
 */
export function fillMask(sample: Uint32Array, w: number, h: number, x: number, y: number, tolerance: number, contiguous: boolean): Uint8Array | null {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const target = sample[y * w + x]!;
  const matches = (i: number): boolean => {
    const c = sample[i]!;
    return tolerance <= 0 ? c === target || (c >>> 24 === 0 && target >>> 24 === 0) : colorDistancePct(c, target) <= tolerance;
  };
  const mask = new Uint8Array(w * h);
  if (!contiguous) {
    for (let i = 0; i < mask.length; i++) if (matches(i)) mask[i] = 1;
    return mask;
  }
  const stack = new Int32Array(w * h);
  let sp = 0;
  const start = y * w + x;
  mask[start] = 1;
  stack[sp++] = start;
  while (sp > 0) {
    const i = stack[--sp]!;
    const px = i % w;
    const py = (i - px) / w;
    if (px > 0 && !mask[i - 1] && matches(i - 1)) { mask[i - 1] = 1; stack[sp++] = i - 1; }
    if (px < w - 1 && !mask[i + 1] && matches(i + 1)) { mask[i + 1] = 1; stack[sp++] = i + 1; }
    if (py > 0 && !mask[i - w] && matches(i - w)) { mask[i - w] = 1; stack[sp++] = i - w; }
    if (py < h - 1 && !mask[i + w] && matches(i + w)) { mask[i + w] = 1; stack[sp++] = i + w; }
  }
  return mask;
}

export function applyMask(cel: Uint32Array, mask: Uint8Array, color: number): void {
  for (let i = 0; i < mask.length; i++) if (mask[i]) cel[i] = color;
}
