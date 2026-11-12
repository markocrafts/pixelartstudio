import { packRGBA, unpackRGBA } from './pixels';

export interface PaletteDef {
  name: string;
  colors: number[];
}

export const MAX_PALETTE_COLORS = 1024;

/** '#rgb', 'rgb', 'rrggbb' or 'rrggbbaa' (with optional '#') -> packed color, or null if malformed. */
export function parseHexColor(token: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(token.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return packRGBA(r, g, b, a);
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/** Packed color -> 'rrggbb' (or 'rrggbbaa' when not opaque). */
export function colorToHex(c: number): string {
  const [r, g, b, a] = unpackRGBA(c);
  return hex2(r) + hex2(g) + hex2(b) + (a < 255 ? hex2(a) : '');
}

/** Removes duplicate colors, keeping first occurrences. */
export function dedupeColors(colors: ReadonlyArray<number>): number[] {
  return [...new Set(colors)];
}

/** `.hex` files and pasted lists: colors separated by whitespace, commas or semicolons. */
export function parseHexList(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[\s,;]+/)) {
    if (!tok) continue;
    const c = parseHexColor(tok);
    if (c === null) throw new Error(`Not a hex color: "${tok.slice(0, 24)}"`);
    out.push(c);
  }
  return out;
}

/** GIMP `.gpl`: "GIMP Palette", optional "Name:", then "R G B  name" lines. */
export function parseGpl(text: string): PaletteDef {
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette/i.test(lines[0]?.trim() ?? '')) throw new Error('Not a GIMP palette (.gpl) file');
  let name = '';
  const colors: number[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const nm = /^Name:\s*(.*)$/i.exec(line);
    if (nm) { name = nm[1]!.trim(); continue; }
    if (/^Columns:/i.test(line)) continue;
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(line);
    if (!m) throw new Error(`Bad .gpl line: "${line.slice(0, 40)}"`);
    colors.push(packRGBA(Math.min(255, +m[1]!), Math.min(255, +m[2]!), Math.min(255, +m[3]!)));
  }
  return { name, colors };
}

/** JASC `.pal`: "JASC-PAL", "0100", count, then "R G B" lines. */
export function parsePal(text: string): PaletteDef {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  if (lines[0] !== 'JASC-PAL') throw new Error('Not a JASC palette (.pal) file');
  const count = Number(lines[2]);
  if (!Number.isInteger(count) || count < 0) throw new Error('Bad .pal color count');
  const colors: number[] = [];
  for (const line of lines.slice(3, 3 + count)) {
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(line);
    if (!m) throw new Error(`Bad .pal line: "${line.slice(0, 40)}"`);
    colors.push(packRGBA(Math.min(255, +m[1]!), Math.min(255, +m[2]!), Math.min(255, +m[3]!)));
  }
  return { name: '', colors };
}

/** Detects .gpl / .pal / hex-list text and parses it. */
export function parsePaletteText(text: string): PaletteDef {
  const t = text.replace(/^\uFEFF/, '').trim();
  let def: PaletteDef;
  if (/^GIMP Palette/i.test(t)) def = parseGpl(t);
  else if (t.startsWith('JASC-PAL')) def = parsePal(t);
  else def = { name: '', colors: parseHexList(t) };
  if (def.colors.length === 0) throw new Error('No colors found');
  return { name: def.name, colors: def.colors.slice(0, MAX_PALETTE_COLORS) };
}

export function exportHex(colors: ReadonlyArray<number>): string {
  return colors.map(colorToHex).join('\n') + '\n';
}

export function exportGpl(name: string, colors: ReadonlyArray<number>): string {
  const rows = colors.map((c, i) => {
    const [r, g, b] = unpackRGBA(c);
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\tIndex ${i}`;
  });
  return ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#', ...rows].join('\n') + '\n';
}

export function exportPal(colors: ReadonlyArray<number>): string {
  const rows = colors.map((c) => unpackRGBA(c).slice(0, 3).join(' '));
  return ['JASC-PAL', '0100', String(colors.length), ...rows].join('\r\n') + '\r\n';
}

/** Distinct visible colors of a pixel buffer, most frequent first, at most `max`. */
export function extractPalette(pixels: Uint32Array, max = 256): number[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i]!;
    if ((c >>> 24) === 0) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c);
}

/** Extracts a Lospec slug from a bare slug or a lospec.com palette URL; null if `text` is not one. */
export function lospecSlug(text: string): string | null {
  const t = text.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?lospec\.com\/palette-list\/([a-z0-9][a-z0-9-]*?)(?:\.[a-z]+)?\/?$/i.exec(t);
  if (url) return url[1]!.toLowerCase();
  if (/^[a-z0-9][a-z0-9-]*$/i.test(t) && !/^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(t)) return t.toLowerCase();
  return null;
}

const fromHexString = (name: string, hex: string): PaletteDef => ({ name, colors: parseHexList(hex) });

const gray = (n: number): number[] => Array.from({ length: n }, (_, i) => {
  const v = Math.round((i * 255) / (n - 1));
  return packRGBA(v, v, v);
});

export const BUILTIN_PALETTES: PaletteDef[] = [
  fromHexString('PICO-8', '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'),
  fromHexString('Endesga 32', 'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569'),
  fromHexString('Sweetie 16', '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57'),
  fromHexString('DB16', '140c1c 442434 30346d 4e4a4e 854c30 346524 d04648 757161 597dce d27d2c 8595a1 6daa2c d2aa99 6dc2ca dad45e deeed6'),
  fromHexString('DB32', '000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30'),
  fromHexString('Game Boy', '0f380f 306230 8bac0f 9bbc0f'),
  {
    name: 'NES',
    colors: dedupeColors(parseHexList(`
      7c7c7c 0000fc 0000bc 4428bc 940084 a80020 a81000 881400 503000 007800 006800 005800 004058 000000
      bcbcbc 0078f8 0058f8 6844fc d800cc e40058 f83800 e45c10 ac7c00 00b800 00a800 00a844 008888
      f8f8f8 3cbcfc 6888fc 9878f8 f878f8 f85898 f87858 fca044 f8b800 b8f818 58d854 58f898 00e8d8 787878
      fcfcfc a4e4fc b8b8f8 d8b8f8 f8b8f8 f8a4c0 f0d0b0 fce0a8 f8d878 d8f878 b8f8b8 b8f8d8 00fcfc f8d8f8`)),
  },
  { name: 'Grayscale 4', colors: gray(4) },
  { name: 'Grayscale 8', colors: gray(8) },
  { name: 'Grayscale 16', colors: gray(16) },
];
