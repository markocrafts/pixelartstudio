import { MAX_PALETTE_COLORS, dedupeColors, parsePaletteText, type PaletteDef } from '../core/palette';
import { packRGBA } from '../core/pixels';
import { celToImageData } from '../render/imagedata';
import { readImageBlob } from './clipboard';

/** Reads a palette from a `.hex`, `.gpl`, `.pal` or `.png` (one pixel per color) file. */
export async function readPaletteFile(file: File): Promise<PaletteDef> {
  const baseName = file.name.replace(/\.[^.]+$/, '');
  if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
    const img = await readImageBlob(file);
    const colors = dedupeColors([...img.pixels].filter((c) => (c >>> 24) !== 0)).slice(0, MAX_PALETTE_COLORS);
    if (colors.length === 0) throw new Error('The image has no visible pixels');
    return { name: baseName, colors };
  }
  const def = parsePaletteText(await file.text());
  return { name: def.name || baseName, colors: def.colors };
}

/** Palette as an N×1 PNG with one pixel per color. */
export function paletteToPngBlob(colors: ReadonlyArray<number>): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, colors.length);
  canvas.height = 1;
  const px = new Uint32Array(canvas.width);
  px.set(colors.length ? colors : [packRGBA(0, 0, 0, 0)]);
  canvas.getContext('2d')!.putImageData(celToImageData(px, canvas.width, 1), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

/** Fetches a palette from lospec.com by slug (only runs when the user asks for it). */
export async function fetchLospecPalette(slug: string): Promise<PaletteDef> {
  let res: Response;
  try {
    res = await fetch(`https://lospec.com/palette-list/${encodeURIComponent(slug)}.json`);
  } catch {
    throw new Error('Could not reach lospec.com. Paste the palette\'s hex list instead.');
  }
  if (!res.ok) throw new Error(res.status === 404 ? `No Lospec palette named "${slug}"` : `Lospec returned ${res.status}`);
  const data = (await res.json()) as { name?: unknown; colors?: unknown };
  if (!Array.isArray(data.colors)) throw new Error('Unexpected response from Lospec');
  const def = parsePaletteText(data.colors.map(String).join('\n'));
  return { name: typeof data.name === 'string' ? data.name : slug, colors: def.colors };
}
