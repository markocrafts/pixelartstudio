export interface DecodedGif {
  width: number;
  height: number;
  /** Fully composed frames (disposal applied), packed RGBA. */
  frames: Array<{ pixels: Uint32Array; delayMs: number }>;
}

class Reader {
  pos = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number {
    if (this.pos >= this.b.length) throw new Error('Unexpected end of GIF data');
    return this.b[this.pos++]!;
  }
  u16(): number { const lo = this.u8(); return lo | (this.u8() << 8); }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.b.length) throw new Error('Unexpected end of GIF data');
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** Concatenates data sub-blocks until the zero terminator. */
  subBlocks(): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let n = this.u8(); n > 0; n = this.u8()) { const p = this.bytes(n); parts.push(p); total += p.length; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

function lzw(data: Uint8Array, minCode: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = minCode + 1, next = eoi + 1, prev = -1, first = 0;
  let bits = 0, acc = 0, di = 0, oi = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (oi < pixelCount) {
    while (bits < size) {
      if (di >= data.length) return out;
      acc |= data[di++]! << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>= size;
    bits -= size;
    if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let sp = 0;
    let cur = code;
    if (prev === -1) { out[oi++] = suffix[code]!; prev = code; first = code; continue; }
    if (code >= next) { stack[sp++] = first; cur = prev; }
    while (cur >= clear) { stack[sp++] = suffix[cur]!; cur = prefix[cur]!; }
    first = suffix[cur]!;
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if (next === (1 << size) && size < 12) size++;
    }
    prev = code;
    while (sp > 0 && oi < pixelCount) out[oi++] = stack[--sp]!;
  }
  return out;
}

/** Decodes an animated or still GIF into composed full-canvas frames. */
export function decodeGif(bytes: Uint8Array): DecodedGif {
  const r = new Reader(bytes);
  const sig = String.fromCharCode(...r.bytes(6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF file');
  const width = r.u16(), height = r.u16();
  const flags = r.u8();
  r.u8(); r.u8();
  if (width === 0 || height === 0) throw new Error('GIF has no size');
  let globalPalette: Uint8Array | null = null;
  if (flags & 0x80) globalPalette = r.bytes(3 * (1 << ((flags & 7) + 1)));

  const canvas = new Uint32Array(width * height);
  const frames: DecodedGif['frames'] = [];
  let delay = 100, transparent = -1, disposal = 0;

  for (;;) {
    const block = r.u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = r.u8();
      if (label === 0xf9) {
        r.u8();
        const f = r.u8();
        delay = r.u16() * 10;
        const t = r.u8();
        disposal = (f >> 2) & 7;
        transparent = f & 1 ? t : -1;
        r.u8();
      } else r.subBlocks();
      continue;
    }
    if (block !== 0x2c) throw new Error('Corrupt GIF block');
    const ix = r.u16(), iy = r.u16(), iw = r.u16(), ih = r.u16();
    const f = r.u8();
    let palette = globalPalette;
    if (f & 0x80) palette = r.bytes(3 * (1 << ((f & 7) + 1)));
    if (!palette) throw new Error('GIF frame has no palette');
    const minCode = r.u8();
    if (minCode < 1 || minCode > 11) throw new Error('Bad GIF LZW size');
    const idx = lzw(r.subBlocks(), minCode, iw * ih);
    const saved = disposal === 3 ? canvas.slice() : null;
    const rowOf = (n: number): number => {
      if (!(f & 0x40)) return n;
      const p1 = Math.ceil(ih / 8), p2 = Math.ceil(Math.max(0, ih - 4) / 8), p3 = Math.ceil(Math.max(0, ih - 2) / 4);
      if (n < p1) return n * 8;
      if (n < p1 + p2) return (n - p1) * 8 + 4;
      if (n < p1 + p2 + p3) return (n - p1 - p2) * 4 + 2;
      return (n - p1 - p2 - p3) * 2 + 1;
    };
    for (let j = 0; j < ih; j++) {
      const y = iy + rowOf(j);
      if (y >= height) continue;
      for (let i = 0; i < iw; i++) {
        const x = ix + i;
        if (x >= width) continue;
        const c = idx[j * iw + i]!;
        if (c === transparent) continue;
        const o = c * 3;
        canvas[y * width + x] = (0xff000000 | ((palette[o + 2] ?? 0) << 16) | ((palette[o + 1] ?? 0) << 8) | (palette[o] ?? 0)) >>> 0;
      }
    }
    frames.push({ pixels: canvas.slice(), delayMs: Math.max(10, delay) });
    if (disposal === 2) {
      for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
        const x = ix + i, y = iy + j;
        if (x < width && y < height) canvas[y * width + x] = 0;
      }
    } else if (disposal === 3 && saved) canvas.set(saved);
    delay = 100; transparent = -1; disposal = 0;
  }
  if (frames.length === 0) throw new Error('GIF has no frames');
  return { width, height, frames };
}
