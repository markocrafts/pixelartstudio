import type { FrameTag } from './project';

export type SheetLayout = 'horizontal' | 'vertical' | 'grid';

export interface SheetOptions {
  layout: SheetLayout;
  /** Columns for the grid layout (ignored otherwise). */
  cols: number;
  /** Transparent pixels between cells (and around the edge). */
  padding: number;
}

export interface SheetGeometry {
  width: number;
  height: number;
  cells: Array<{ x: number; y: number }>;
}

export function sheetGeometry(count: number, w: number, h: number, o: SheetOptions): SheetGeometry {
  const pad = Math.max(0, Math.round(o.padding));
  const cols = o.layout === 'horizontal' ? count : o.layout === 'vertical' ? 1
    : Math.min(count, Math.max(1, Math.round(o.cols) || Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / cols);
  const cells = Array.from({ length: count }, (_, i) => ({
    x: pad + (i % cols) * (w + pad),
    y: pad + Math.floor(i / cols) * (h + pad),
  }));
  return { width: pad + cols * (w + pad), height: pad + rows * (h + pad), cells };
}

/** Lays frames (each w×h) out on one transparent sheet. */
export function buildSheet(frames: ReadonlyArray<Uint32Array>, w: number, h: number, o: SheetOptions): { pixels: Uint32Array; geometry: SheetGeometry } {
  const geometry = sheetGeometry(frames.length, w, h, o);
  const pixels = new Uint32Array(geometry.width * geometry.height);
  frames.forEach((f, i) => {
    const c = geometry.cells[i]!;
    for (let y = 0; y < h; y++) pixels.set(f.subarray(y * w, (y + 1) * w), (c.y + y) * geometry.width + c.x);
  });
  return { pixels, geometry };
}

/** Aseprite-style JSON metadata describing a sheet. */
export function sheetJson(
  imageName: string, geometry: SheetGeometry, w: number, h: number, durations: ReadonlyArray<number>, tags: ReadonlyArray<FrameTag>,
): string {
  const frames = geometry.cells.map((c, i) => ({
    filename: `${imageName} ${i}`,
    frame: { x: c.x, y: c.y, w, h },
    duration: durations[i] ?? 100,
  }));
  return JSON.stringify({
    frames,
    meta: {
      app: 'Pixel Art Studio',
      image: imageName,
      size: { w: geometry.width, h: geometry.height },
      frameTags: tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.direction })),
    },
  }, null, 2);
}

/** Cuts a sheet into cw×ch cells, row by row. Cells that would extend past the edge are skipped. */
export function sliceSheet(pixels: Uint32Array, sw: number, sh: number, cw: number, ch: number, padding = 0): Uint32Array[] {
  const out: Uint32Array[] = [];
  const pad = Math.max(0, padding);
  for (let y = pad; y + ch <= sh; y += ch + pad) {
    for (let x = pad; x + cw <= sw; x += cw + pad) {
      const cell = new Uint32Array(cw * ch);
      for (let j = 0; j < ch; j++) cell.set(pixels.subarray((y + j) * sw + x, (y + j) * sw + x + cw), j * cw);
      out.push(cell);
    }
  }
  return out;
}
