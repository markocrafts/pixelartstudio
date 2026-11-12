import { unpackRGBA } from './pixels';

export function luma(c: number): number {
  const [r, g, b] = unpackRGBA(c);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** h in 0..360, s and l in 0..1 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** h in 0..360, s and v in 0..1 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]!;
  return [Math.round(r! * 255), Math.round(g! * 255), Math.round(b! * 255)];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

function rgbDist2(a: number, b: number): number {
  const [ar, ag, ab] = unpackRGBA(a);
  const [br, bg, bb] = unpackRGBA(b);
  return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
}

export function nearestIndex(colors: ReadonlyArray<number>, c: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const d = rgbDist2(colors[i]!, c);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Palette colors sorted dark to light. */
export function paletteRamp(colors: ReadonlyArray<number>): number[] {
  return [...colors].sort((a, b) => luma(a) - luma(b));
}

/**
 * Lightens (dir=1) or darkens (dir=-1) a pixel. With a ramp (sorted dark to light) it moves to the next
 * ramp color; otherwise it shifts HSL lightness by `amount` percent. Alpha is preserved.
 */
export function shadePixel(c: number, dir: 1 | -1, amount: number, ramp: ReadonlyArray<number> | null): number {
  const a = c & 0xff000000;
  if (ramp && ramp.length >= 2) {
    const idx = Math.min(ramp.length - 1, Math.max(0, nearestIndex(ramp, c) + dir));
    return ((ramp[idx]! & 0x00ffffff) | a) >>> 0;
  }
  const [r, g, b] = unpackRGBA(c);
  const [h, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(h, s, Math.min(1, Math.max(0, l + (dir * amount) / 100)));
  return ((nr | (ng << 8) | (nb << 16)) | a) >>> 0;
}
