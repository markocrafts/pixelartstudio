export type DitherPattern = 'none' | 'bayer2' | 'bayer4' | 'checker';

const B2 = [[0, 2], [3, 1]];
const B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/** Threshold in (0,1) for the pattern at pixel (x,y). A pixel takes the second color when t > threshold. */
export function threshold(pattern: DitherPattern, x: number, y: number): number {
  switch (pattern) {
    case 'bayer2': return (B2[y & 1]![x & 1]! + 0.5) / 4;
    case 'bayer4': return (B4[y & 3]![x & 3]! + 0.5) / 16;
    case 'checker': return (x + y) & 1 ? 0.75 : 0.25;
    default: return 0.5;
  }
}

/** True when the pixel should use the second color for blend amount t (0..1). */
export function ditherPick(pattern: DitherPattern, t: number, x: number, y: number): boolean {
  return t > threshold(pattern, x, y);
}

export interface GradientOpts {
  kind: 'linear' | 'radial';
  x0: number; y0: number; x1: number; y1: number;
  pattern: DitherPattern;
  /** Color at t=0 */
  primary: number;
  /** Color at t=1 */
  secondary: number;
}

export function gradientT(kind: 'linear' | 'radial', x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  const vx = x1 - x0, vy = y1 - y0;
  let t: number;
  if (kind === 'linear') {
    const len2 = vx * vx + vy * vy;
    t = len2 === 0 ? 0 : ((px - x0) * vx + (py - y0) * vy) / len2;
  } else {
    const r = Math.hypot(vx, vy);
    t = r === 0 ? 0 : Math.hypot(px - x0, py - y0) / r;
  }
  return Math.min(1, Math.max(0, t));
}

/** Fills the whole cel (inside `mask` if given) with a dithered two-color gradient. */
export function applyGradient(cel: Uint32Array, mask: Uint8Array | null, w: number, h: number, o: GradientOpts): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask && !mask[i]) continue;
      const t = gradientT(o.kind, o.x0, o.y0, o.x1, o.y1, x, y);
      cel[i] = ditherPick(o.pattern, t, x, y) ? o.secondary : o.primary;
    }
  }
}
