import type { Point } from './pixelperfect';

export type { Point };

/** Returns the end point that makes the box from (x0,y0) a square (keeps the larger side). */
export function constrainSquare(x0: number, y0: number, x1: number, y1: number): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + (dx < 0 ? -m : m), y0 + (dy < 0 ? -m : m)];
}

/** Snaps the line direction to the nearest multiple of `stepDeg`, keeping its length. */
export function snapLine(x0: number, y0: number, x1: number, y1: number, stepDeg = 15): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [x1, y1];
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return [x0 + Math.round(len * Math.cos(ang)), y0 + Math.round(len * Math.sin(ang))];
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  const pts: Point[] = [];
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (filled || x === xa || x === xb || y === ya || y === yb) pts.push([x, y]);
    }
  }
  return pts;
}

/** Ellipse inscribed in the box from (x0,y0) to (x1,y1), both corners inclusive. Symmetric by construction. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const xa = Math.min(x0, x1), ya = Math.min(y0, y1);
  const w = Math.abs(x1 - x0) + 1;
  const h = Math.abs(y1 - y0) + 1;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const rx = w / 2, ry = h / 2;
  const inside = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < w && j < h && ((i - cx) / rx) ** 2 + ((j - cy) / ry) ** 2 <= 1;
  const pts: Point[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!inside(i, j)) continue;
      if (filled || !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1)) pts.push([xa + i, ya + j]);
    }
  }
  return pts;
}
