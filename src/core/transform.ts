import { clampSize, type Project } from './project';
import type { Rect } from './selection';

type Buf = Uint8Array | Uint32Array;

export function flipH<T extends Buf>(src: T, w: number, h: number): T {
  const out = src.slice() as T;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + (w - 1 - x)] = src[y * w + x]!;
  return out;
}

export function flipV<T extends Buf>(src: T, w: number, h: number): T {
  const out = src.slice() as T;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(h - 1 - y) * w + x] = src[y * w + x]!;
  return out;
}

/** Rotates 90 degrees. The result is h wide and w tall. */
export function rotate90<T extends Buf>(src: T, w: number, h: number, clockwise: boolean): T {
  const out = src.slice() as T;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = clockwise ? h - 1 - y : y;
      const ny = clockwise ? x : w - 1 - x;
      out[ny * h + nx] = src[y * w + x]!;
    }
  }
  return out;
}

/** Copies the old image into a new nw x nh image with its top-left at (ox,oy). */
export function resizeCel(src: Uint32Array, w: number, h: number, nw: number, nh: number, ox: number, oy: number): Uint32Array {
  const out = new Uint32Array(nw * nh);
  for (let y = 0; y < h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= nh) continue;
    for (let x = 0; x < w; x++) {
      const tx = x + ox;
      if (tx >= 0 && tx < nw) out[ty * nw + tx] = src[y * w + x]!;
    }
  }
  return out;
}

/** Nearest-neighbor scale. */
export function scaleCel(src: Uint32Array, w: number, h: number, nw: number, nh: number): Uint32Array {
  const out = new Uint32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / nh));
    for (let x = 0; x < nw; x++) out[y * nw + x] = src[sy * w + Math.min(w - 1, Math.floor((x * w) / nw))]!;
  }
  return out;
}

export function cropCel(src: Uint32Array, w: number, r: Rect): Uint32Array {
  const out = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(src.subarray((r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w), y * r.w);
  return out;
}

function mapCels(p: Project, nw: number, nh: number, fn: (cel: Uint32Array) => Uint32Array): void {
  for (const f of p.frames) for (const [id, cel] of f.cels) f.cels.set(id, fn(cel));
  p.width = nw;
  p.height = nh;
  p.updatedAt = Date.now();
}

export function flipProject(p: Project, axis: 'h' | 'v'): void {
  const { width: w, height: h } = p;
  mapCels(p, w, h, (c) => (axis === 'h' ? flipH(c, w, h) : flipV(c, w, h)));
}

export function rotateProject(p: Project, clockwise: boolean): void {
  const { width: w, height: h } = p;
  mapCels(p, h, w, (c) => rotate90(c, w, h, clockwise));
}

/** anchorX/anchorY in 0..1 (0 = left/top, 0.5 = center, 1 = right/bottom). */
export function resizeProject(p: Project, nw: number, nh: number, anchorX: number, anchorY: number): boolean {
  nw = clampSize(nw);
  nh = clampSize(nh);
  if (nw === p.width && nh === p.height) return false;
  const { width: w, height: h } = p;
  const ox = Math.round((nw - w) * anchorX);
  const oy = Math.round((nh - h) * anchorY);
  mapCels(p, nw, nh, (c) => resizeCel(c, w, h, nw, nh, ox, oy));
  return true;
}

export function scaleProject(p: Project, nw: number, nh: number): boolean {
  nw = clampSize(nw);
  nh = clampSize(nh);
  if (nw === p.width && nh === p.height) return false;
  const { width: w, height: h } = p;
  mapCels(p, nw, nh, (c) => scaleCel(c, w, h, nw, nh));
  return true;
}

export function cropProject(p: Project, r: Rect): boolean {
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  const rect = { x, y, w: Math.min(p.width, r.x + r.w) - x, h: Math.min(p.height, r.y + r.h) - y };
  if (rect.w <= 0 || rect.h <= 0) return false;
  if (rect.x === 0 && rect.y === 0 && rect.w === p.width && rect.h === p.height) return false;
  const w = p.width;
  mapCels(p, rect.w, rect.h, (c) => cropCel(c, w, rect));
  return true;
}

/** Bounds of all non-transparent pixels across every frame and layer, or null if the project is blank. */
export function contentBounds(p: Project): Rect | null {
  const { width: w, height: h } = p;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (const f of p.frames) {
    for (const cel of f.cels.values()) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (cel[y * w + x]! >>> 24 === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Crops away fully transparent edges. Returns false if nothing changed (blank or already tight). */
export function trimProject(p: Project): boolean {
  const b = contentBounds(p);
  return b ? cropProject(p, b) : false;
}
