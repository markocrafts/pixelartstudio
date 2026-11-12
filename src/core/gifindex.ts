/** Exact indexed form of RGBA frames for GIF encoding. */
export interface IndexedFrames {
  /** RGB triplets. */
  palette: Array<[number, number, number]>;
  /** Index of the transparent entry, or -1 when no pixel is transparent. */
  transparentIndex: number;
  indices: Uint8Array[];
}

/**
 * Converts frames to palette indices without losing colors. Pixels with alpha below `alphaThreshold` are
 * transparent; the rest are treated as opaque. Returns null when more than 256 entries would be needed
 * (the caller then quantizes).
 */
export function indexFrames(frames: ReadonlyArray<Uint32Array>, alphaThreshold = 128): IndexedFrames | null {
  const map = new Map<number, number>();
  const palette: Array<[number, number, number]> = [];
  let transparentIndex = -1;
  const indices: Uint8Array[] = [];
  for (const f of frames) {
    const out = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const c = f[i]!;
      let idx: number;
      if ((c >>> 24) < alphaThreshold) {
        if (transparentIndex < 0) {
          if (palette.length >= 256) return null;
          transparentIndex = palette.length;
          palette.push([0, 0, 0]);
        }
        idx = transparentIndex;
      } else {
        const rgb = c & 0x00ffffff;
        const found = map.get(rgb);
        if (found === undefined) {
          if (palette.length >= 256) return null;
          idx = palette.length;
          palette.push([c & 255, (c >>> 8) & 255, (c >>> 16) & 255]);
          map.set(rgb, idx);
        } else idx = found;
      }
      out[i] = idx;
    }
    indices.push(out);
  }
  return { palette, transparentIndex, indices };
}
