/** Pack RGBA (0-255 each) into a little-endian Uint32 value (ABGR in memory order matches ImageData). */
export function packRGBA(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;
}

export function unpackRGBA(c: number): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255];
}

/** A single layer's pixels for one frame. */
export function createCel(width: number, height: number): Uint32Array {
  return new Uint32Array(width * height);
}

export function setPixel(cel: Uint32Array, width: number, x: number, y: number, color: number): void {
  if (x < 0 || y < 0 || x >= width || y * width + x >= cel.length) return;
  cel[y * width + x] = color;
}

/** '#rrggbb' -> packed opaque color. Returns 0 (transparent) on malformed input. */
export function hexToPacked(hex: string): number {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return packRGBA((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

/** Packed color -> '#rrggbb' (alpha dropped). */
export function packedToHex(c: number): string {
  const [r, g, b] = unpackRGBA(c);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
