import { forEachLinePoint } from './bresenham';
import { colorDistancePct } from './fill';
import type { Point } from './pixelperfect';

export type SelectOp = 'replace' | 'add' | 'subtract';
export interface Rect { x: number; y: number; w: number; h: number }

export function allMask(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h).fill(1);
}

export function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const m = new Uint8Array(w * h);
  const xa = Math.max(0, Math.min(x0, x1)), xb = Math.min(w - 1, Math.max(x0, x1));
  const ya = Math.max(0, Math.min(y0, y1)), yb = Math.min(h - 1, Math.max(y0, y1));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) m[y * w + x] = 1;
  return m;
}

/** Even-odd polygon fill sampled at pixel centers, plus the outline so thin shapes still select pixels. */
export function polygonMask(w: number, h: number, pts: ReadonlyArray<Point>): Uint8Array {
  const m = new Uint8Array(w * h);
  const n = pts.length;
  if (n === 0) return m;
  const set = (x: number, y: number): void => { if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1; };
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    forEachLinePoint(a[0], a[1], b[0], b[1], set);
  }
  if (n < 3) return m;
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      const ay = a[1] + 0.5, by = b[1] + 0.5;
      if ((ay <= yc) !== (by <= yc)) xs.push(a[0] + 0.5 + ((yc - ay) / (by - ay)) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(w - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
      for (let x = from; x <= to; x++) m[y * w + x] = 1;
    }
  }
  return m;
}

export function maskCount(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Combines a new mask into the current selection. Returns null when the result is empty. */
export function combineMasks(base: Uint8Array | null, incoming: Uint8Array, op: SelectOp): Uint8Array | null {
  let out: Uint8Array;
  if (op === 'replace' || !base) {
    out = op === 'subtract' ? new Uint8Array(incoming.length) : incoming.slice();
  } else {
    out = base.slice();
    for (let i = 0; i < out.length; i++) {
      if (op === 'add') { if (incoming[i]) out[i] = 1; }
      else if (incoming[i]) out[i] = 0;
    }
  }
  return maskCount(out) === 0 ? null : out;
}

/** Inverts a selection. With no selection, everything becomes selected. */
export function invertMask(mask: Uint8Array | null, w: number, h: number): Uint8Array | null {
  if (!mask) return allMask(w, h);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 0 : 1;
  return maskCount(out) === 0 ? null : out;
}

export function colorMask(sample: Uint32Array, color: number, tolerancePct: number): Uint8Array {
  const out = new Uint8Array(sample.length);
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i]!;
    const same = c === color || (c >>> 24 === 0 && color >>> 24 === 0);
    if (same || (tolerancePct > 0 && colorDistancePct(c, color) <= tolerancePct)) out[i] = 1;
  }
  return out;
}

/** Boundary segments of a mask as flat [x0,y0,x1,y1,...] in pixel-edge coordinates (for marching ants). */
export function maskEdges(mask: Uint8Array, w: number, h: number): number[] {
  const seg: number[] = [];
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]!);
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && at(x, y - 1) !== at(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { seg.push(start, y, x, y); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && at(x - 1, y) !== at(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { seg.push(x, start, x, y); start = -1; }
    }
  }
  return seg;
}
