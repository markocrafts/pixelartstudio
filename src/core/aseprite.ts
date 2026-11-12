import { unzlibSync } from 'fflate';
import { createCel, packRGBA } from './pixels';
import {
  MAX_CANVAS_SIZE, MAX_FRAMES, MAX_LAYERS, createProject, uid, type BlendMode, type FrameTag, type LayerMeta, type Project, type TagDirection,
} from './project';

const BLEND: Record<number, BlendMode> = { 0: 'normal', 1: 'multiply', 2: 'screen', 3: 'overlay', 4: 'darken', 5: 'lighten', 16: 'add', 17: 'subtract', 18: 'difference' };

class Reader {
  pos = 0;
  private v: DataView;
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  private need(n: number): void { if (this.pos + n > this.b.length) throw new Error('Corrupt Aseprite file (unexpected end)'); }
  u8(): number { this.need(1); return this.v.getUint8(this.pos++); }
  u16(): number { this.need(2); const x = this.v.getUint16(this.pos, true); this.pos += 2; return x; }
  i16(): number { this.need(2); const x = this.v.getInt16(this.pos, true); this.pos += 2; return x; }
  u32(): number { this.need(4); const x = this.v.getUint32(this.pos, true); this.pos += 4; return x; }
  skip(n: number): void { this.need(n); this.pos += n; }
  bytes(n: number): Uint8Array { this.need(n); const o = this.b.subarray(this.pos, this.pos + n); this.pos += n; return o; }
  str(): string { return new TextDecoder().decode(this.bytes(this.u16())); }
}

interface RawCel { layer: number; x: number; y: number; opacity: number; w: number; h: number; data: Uint8Array; linked?: number }

/**
 * Imports an `.aseprite` / `.ase` file (basic): layers (blend mode, opacity, visibility), frames with
 * durations, image cels (raw, compressed or linked), palette and tags. RGBA, grayscale and indexed
 * color modes work; group and tilemap layers are not supported (group children import as normal layers).
 */
export function parseAseprite(bytes: Uint8Array): Project {
  const r = new Reader(bytes);
  r.u32();
  if (r.u16() !== 0xa5e0) throw new Error('Not an Aseprite file');
  const frameCount = r.u16();
  const width = r.u16(), height = r.u16();
  const depth = r.u16();
  r.u32(); // flags
  r.u16(); r.u32(); r.u32();
  const transparentIndex = r.u8();
  r.skip(3);
  r.u16();
  r.pos = 128;
  if (![8, 16, 32].includes(depth)) throw new Error('Unsupported Aseprite color depth');
  if (width < 1 || height < 1 || width > MAX_CANVAS_SIZE || height > MAX_CANVAS_SIZE) throw new Error('Aseprite canvas size is not supported');
  if (frameCount < 1 || frameCount > MAX_FRAMES) throw new Error('Aseprite frame count is not supported');

  const layers: Array<LayerMeta & { aseType: number }> = [];
  const durations: number[] = [];
  const cels: Array<Map<number, RawCel>> = [];
  const tags: FrameTag[] = [];
  const palRGBA: number[] = []; // index -> packed

  for (let f = 0; f < frameCount; f++) {
    const start = r.pos;
    const size = r.u32();
    if (r.u16() !== 0xf1fa) throw new Error('Corrupt Aseprite file (bad frame)');
    const oldChunks = r.u16();
    durations.push(r.u16() || 100);
    r.skip(2);
    const newChunks = r.u32();
    const chunks = newChunks || oldChunks;
    const frameCels = new Map<number, RawCel>();
    cels.push(frameCels);
    for (let c = 0; c < chunks; c++) {
      const cStart = r.pos;
      const cSize = r.u32();
      const type = r.u16();
      const end = cStart + cSize;
      if (cSize < 6 || end > bytes.length) throw new Error('Corrupt Aseprite file (bad chunk)');
      if (type === 0x2004) {
        const lf = r.u16(), lt = r.u16();
        r.u16(); r.u16(); r.u16();
        const blend = r.u16();
        const opacity = r.u8();
        r.skip(3);
        const name = r.str();
        layers.push({
          id: uid('layer'), name: name || `Layer ${layers.length + 1}`, visible: (lf & 1) !== 0, locked: (lf & 2) === 0,
          opacity: opacity / 255, blendMode: BLEND[blend] ?? 'normal', isReference: (lf & 64) !== 0, alphaLock: false, aseType: lt,
        });
      } else if (type === 0x2005) {
        const layer = r.u16(), x = r.i16(), y = r.i16(), opacity = r.u8(), ct = r.u16();
        r.i16(); r.skip(5);
        if (ct === 1) frameCels.set(layer, { layer, x, y, opacity, w: 0, h: 0, data: new Uint8Array(0), linked: r.u16() });
        else if (ct === 0 || ct === 2) {
          const w = r.u16(), h = r.u16();
          const body = r.bytes(end - r.pos);
          const bpp = depth / 8;
          const data = ct === 2 ? unzlibSync(body) : body.slice();
          if (data.length < w * h * bpp) throw new Error('Corrupt Aseprite file (short cel)');
          frameCels.set(layer, { layer, x, y, opacity, w, h, data });
        }
      } else if (type === 0x2019) {
        const n = r.u32(), from = r.u32(), to = r.u32();
        r.skip(8);
        if (n > 4096 || to >= 4096) throw new Error('Corrupt Aseprite palette');
        for (let i = from; i <= to; i++) {
          const ef = r.u16();
          const cr = r.u8(), cg = r.u8(), cb = r.u8(), ca = r.u8();
          if (ef & 1) r.str();
          palRGBA[i] = packRGBA(cr, cg, cb, ca);
        }
      } else if (type === 0x2018) {
        const n = r.u16();
        r.skip(8);
        for (let i = 0; i < n; i++) {
          const from = r.u16(), to = r.u16(), dir = r.u8();
          r.skip(2 + 6);
          r.skip(3);
          r.skip(1);
          const name = r.str();
          const direction: TagDirection = dir === 1 ? 'reverse' : dir === 2 ? 'pingpong' : 'forward';
          tags.push({ id: uid('tag'), name, from: Math.min(from, frameCount - 1), to: Math.min(Math.max(from, to), frameCount - 1), direction, loop: true });
        }
      }
      r.pos = end;
    }
    r.pos = start + size;
  }

  if (layers.length === 0) throw new Error('The Aseprite file has no layers');
  const usable = layers.slice(0, MAX_LAYERS);
  const p = createProject({ width, height, name: 'Imported' });
  p.layers = usable.map((l) => { const { aseType, ...rest } = l; void aseType; return rest; });
  const palette = palRGBA.filter((c) => c !== undefined);
  p.palette = { name: 'Aseprite palette', colors: [] };
  if (palette.length) p.palette = { name: 'Aseprite palette', colors: [...new Set(palette.filter((c) => (c >>> 24) !== 0))].slice(0, 1024) };

  const toPixel = (src: Uint8Array, i: number): number => {
    if (depth === 32) return packRGBA(src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!, src[i * 4 + 3]!);
    if (depth === 16) return packRGBA(src[i * 2]!, src[i * 2]!, src[i * 2]!, src[i * 2 + 1]!);
    const idx = src[i]!;
    return idx === transparentIndex ? 0 : (palRGBA[idx] ?? 0);
  };

  p.frames = cels.map((fc, fi) => {
    const map = new Map<string, Uint32Array>();
    usable.forEach((l, li) => {
      const out = createCel(width, height);
      let c = fc.get(li);
      if (c?.linked !== undefined) c = cels[c.linked]?.get(li);
      if (c && c.linked === undefined && l.aseType === 0) {
        for (let y = 0; y < c.h; y++) {
          const dy = y + c.y;
          if (dy < 0 || dy >= height) continue;
          for (let x = 0; x < c.w; x++) {
            const dx = x + c.x;
            if (dx < 0 || dx >= width) continue;
            let px = toPixel(c.data, y * c.w + x);
            if (c.opacity < 255 && (px >>> 24) !== 0) px = ((((px >>> 24) * c.opacity) / 255) << 24 | (px & 0xffffff)) >>> 0;
            out[dy * width + dx] = px;
          }
        }
      }
      map.set(l.id, out);
    });
    return { id: uid('frame'), durationMs: durations[fi]!, cels: map };
  });
  p.tags = tags;
  return p;
}
