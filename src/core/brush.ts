import { forEachLinePoint } from './bresenham';
import type { Painter } from './painter';

export type BrushShape = 'square' | 'circle';
export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 64;

export function clampBrushSize(n: number): number {
  if (!Number.isFinite(n)) return MIN_BRUSH_SIZE;
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(n)));
}

/** A stamp: pixel offsets from the anchor, optionally with a color per offset (custom brushes). */
export interface Brush {
  offsets: ReadonlyArray<readonly [number, number]>;
  colors?: ReadonlyArray<number>;
}

const cache = new Map<string, ReadonlyArray<readonly [number, number]>>();

/** Offsets (relative to the anchor pixel) covered by a brush of the given size and shape. */
export function brushFootprint(size: number, shape: BrushShape): ReadonlyArray<readonly [number, number]> {
  size = clampBrushSize(size);
  const key = `${shape}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const start = -Math.floor((size - 1) / 2);
  const c = (size - 1) / 2;
  const r2 = (size * size) / 4 - (size > 2 ? 0.5 : 0);
  const pts: Array<readonly [number, number]> = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (shape === 'circle' && (i - c) ** 2 + (j - c) ** 2 > r2) continue;
      pts.push([start + i, start + j]);
    }
  }
  cache.set(key, pts);
  return pts;
}

export function shapeBrush(size: number, shape: BrushShape): Brush {
  return { offsets: brushFootprint(size, shape) };
}

/** Stamps the brush at (cx,cy). Custom-colored brushes keep their own colors unless `tint` is set. */
export function stampBrush(p: Painter, brush: Brush, cx: number, cy: number, color: number, tint = false): void {
  const { offsets, colors } = brush;
  for (let k = 0; k < offsets.length; k++) {
    const [ox, oy] = offsets[k]!;
    p.put(cx + ox, cy + oy, colors && !tint ? colors[k]! : color);
  }
}

/** Stamps the brush along a line so fast strokes leave no gaps. */
export function strokeBrush(p: Painter, brush: Brush, x0: number, y0: number, x1: number, y1: number, color: number, tint = false): void {
  forEachLinePoint(x0, y0, x1, y1, (x, y) => stampBrush(p, brush, x, y, color, tint));
}
