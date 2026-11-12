import { blendInto } from './composite';
import { unpackRGBA } from './pixels';

export interface OnionSettings {
  enabled: boolean;
  /** Previous frames shown (red tint). */
  prev: number;
  /** Next frames shown (blue tint). */
  next: number;
  /** 0..1, strength of the nearest frame; farther frames fade. */
  opacity: number;
}

export const defaultOnion = (): OnionSettings => ({ enabled: false, prev: 1, next: 1, opacity: 0.4 });

export const ONION_PREV_TINT = 0xff3030;
export const ONION_NEXT_TINT = 0x3070ff;

/** Tinted, faded copy of a composited frame (tint given as 0xRRGGBB). */
export function tintFrame(src: Uint32Array, tint: number, alpha: number): Uint32Array {
  const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
  const out = new Uint32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const [r, g, b, a] = unpackRGBA(src[i]!);
    if (a === 0) continue;
    const na = Math.round(a * alpha);
    if (na === 0) continue;
    out[i] = ((na << 24) | (((b + tb) >> 1) << 16) | (((g + tg) >> 1) << 8) | ((r + tr) >> 1)) >>> 0;
  }
  return out;
}

/** Builds the onion-skin overlay: previous frames in red, next frames in blue, fading with distance. */
export function buildOnion(
  frameCount: number, active: number, s: OnionSettings, composite: (index: number) => Uint32Array, size: number,
): Uint32Array {
  const out = new Uint32Array(size);
  const add = (idx: number, dist: number, tint: number, n: number): void => {
    if (idx < 0 || idx >= frameCount) return;
    const fade = n <= 1 ? 1 : 1 - (dist - 1) / n;
    blendInto(out, tintFrame(composite(idx), tint, s.opacity * fade), 1);
  };
  for (let d = s.prev; d >= 1; d--) add(active - d, d, ONION_PREV_TINT, s.prev);
  for (let d = s.next; d >= 1; d--) add(active + d, d, ONION_NEXT_TINT, s.next);
  return out;
}
