import { describe, expect, it } from 'vitest';
import { blendChannel, compositeFrame } from '../src/core/composite';
import { hsvToRgb, rgbToHsv } from '../src/core/color';
import { Editor } from '../src/core/editor';
import {
  BUILTIN_PALETTES, exportGpl, exportHex, exportPal, extractPalette, lospecSlug, parseGpl, parseHexColor,
  parseHexList, parsePal, parsePaletteText,
} from '../src/core/palette';
import { packRGBA } from '../src/core/pixels';
import { createProject } from '../src/core/project';

const RED = packRGBA(255, 0, 0);
const BLUE = packRGBA(0, 0, 255);
const GREEN = packRGBA(0, 255, 0);

function setup(w = 8, h = 8) {
  const e = new Editor(createProject({ width: w, height: h }));
  const cel = (i: number) => e.project.frames[0]!.cels.get(e.project.layers[i]!.id)!;
  const dot = (x: number, y: number, c = RED) => {
    e.setPrimary(c);
    e.pointerDown(x, y, 'primary');
    e.pointerUp();
  };
  return { e, cel, dot };
}

describe('layer operations', () => {
  it('adds a layer above the active one and makes it active; undo/redo restore everything', () => {
    const { e, dot, cel } = setup();
    dot(1, 1);
    expect(e.addLayer()).toBe(true);
    expect(e.project.layers).toHaveLength(2);
    expect(e.activeLayer).toBe(1);
    dot(2, 2, BLUE);
    expect(cel(1)[2 * 8 + 2]).toBe(BLUE);
    e.undo(); // the dot
    e.undo(); // add layer
    expect(e.project.layers).toHaveLength(1);
    expect(e.activeLayer).toBe(0);
    expect(e.project.frames[0]!.cels.size).toBe(1);
    e.redo();
    expect(e.project.layers).toHaveLength(2);
    expect(e.project.frames[0]!.cels.size).toBe(2);
    e.redo();
    expect(cel(1)[2 * 8 + 2]).toBe(BLUE);
  });

  it('enforces the 64 layer limit', () => {
    const { e } = setup(2, 2);
    for (let i = 0; i < 80; i++) e.addLayer();
    expect(e.project.layers).toHaveLength(64);
    expect(e.canAddLayer).toBe(false);
    expect(e.duplicateLayer()).toBe(false);
  });

  it('duplicates pixels and properties', () => {
    const { e, dot, cel } = setup();
    dot(3, 3);
    e.setLayerProps(0, { opacity: 0.5 });
    expect(e.duplicateLayer()).toBe(true);
    expect(e.project.layers[1]!.name).toMatch(/copy/);
    expect(e.project.layers[1]!.opacity).toBe(0.5);
    expect(cel(1)[3 * 8 + 3]).toBe(RED);
    expect(cel(1)).not.toBe(cel(0));
    e.undo();
    expect(e.project.layers).toHaveLength(1);
  });

  it('deletes a layer, keeps the last one, and undo brings the pixels back', () => {
    const { e, dot } = setup();
    e.addLayer();
    dot(4, 4);
    const id = e.project.layers[1]!.id;
    expect(e.deleteLayer()).toBe(true);
    expect(e.project.layers).toHaveLength(1);
    expect(e.activeLayer).toBe(0);
    expect(e.deleteLayer()).toBe(false);
    e.undo();
    expect(e.project.layers[1]!.id).toBe(id);
    expect(e.project.frames[0]!.cels.get(id)![4 * 8 + 4]).toBe(RED);
    expect(e.activeLayer).toBe(1);
  });

  it('reorders layers and the active layer follows', () => {
    const { e } = setup();
    e.addLayer('B');
    e.addLayer('C');
    const [a, b, c] = e.project.layers.map((l) => l.id);
    e.setActiveLayer(0);
    expect(e.moveLayer(0, 2)).toBe(true);
    expect(e.project.layers.map((l) => l.id)).toEqual([b, c, a]);
    expect(e.activeLayer).toBe(2);
    e.undo();
    expect(e.project.layers.map((l) => l.id)).toEqual([a, b, c]);
    expect(e.activeLayer).toBe(0);
  });

  it('property changes are undoable; live previews record a single step', () => {
    const { e } = setup();
    e.setLayerProps(0, { visible: false });
    expect(e.project.layers[0]!.visible).toBe(false);
    e.undo();
    expect(e.project.layers[0]!.visible).toBe(true);
    const before = e.captureLayerState();
    e.setLayerProps(0, { opacity: 0.8 }, false);
    e.setLayerProps(0, { opacity: 0.3 }, false);
    e.recordLayerChange('Layer opacity', before);
    expect(e.project.layers[0]!.opacity).toBe(0.3);
    e.undo();
    expect(e.project.layers[0]!.opacity).toBe(1);
    e.redo();
    expect(e.project.layers[0]!.opacity).toBe(0.3);
  });

  it('hidden and locked layers cannot be drawn on', () => {
    const { e, dot, cel } = setup();
    e.setLayerProps(0, { locked: true });
    dot(1, 1);
    expect(cel(0)[9]).toBe(0);
    e.setLayerProps(0, { locked: false, visible: false });
    dot(1, 1);
    expect(cel(0)[9]).toBe(0);
  });

  it('merges down with opacity and undoes it exactly', () => {
    const { e, dot, cel } = setup(2, 1);
    dot(0, 0, RED);
    e.addLayer();
    dot(0, 0, BLUE);
    dot(1, 0, BLUE);
    e.setLayerProps(1, { opacity: 0.5 });
    expect(e.mergeDown()).toBe(true);
    expect(e.project.layers).toHaveLength(1);
    expect(e.activeLayer).toBe(0);
    const [r, , b, a] = [cel(0)[0]! & 255, 0, (cel(0)[0]! >>> 16) & 255, cel(0)[0]! >>> 24];
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135);
    expect(b).toBeGreaterThan(120);
    expect(cel(0)[1]! >>> 24).toBe(128);
    e.undo();
    expect(e.project.layers).toHaveLength(2);
    expect(cel(0)[0]).toBe(RED);
    expect(cel(0)[1]).toBe(0);
    expect(cel(1)[0]).toBe(BLUE);
    expect(e.mergeDown(0)).toBe(false);
  });

  it('flatten merges everything visible into one layer and is undoable', () => {
    const { e, dot, cel } = setup();
    dot(0, 0, RED);
    e.addLayer();
    dot(1, 0, BLUE);
    e.addLayer();
    dot(2, 0, GREEN);
    e.setLayerProps(2, { visible: false });
    expect(e.flatten()).toBe(true);
    expect(e.project.layers).toHaveLength(1);
    expect(cel(0)[0]).toBe(RED);
    expect(cel(0)[1]).toBe(BLUE);
    expect(cel(0)[2]).toBe(0); // hidden layer dropped
    e.undo();
    expect(e.project.layers).toHaveLength(3);
    expect(e.project.frames[0]!.cels.get(e.project.layers[2]!.id)![2]).toBe(GREEN);
    expect(e.flatten()).toBe(true);
    e.setActiveLayer(0);
    expect(e.flatten()).toBe(false);
  });
});

describe('alpha lock and reference layers', () => {
  it('alpha lock paints only on existing pixels and keeps their alpha', () => {
    const { e, dot, cel } = setup(4, 1);
    const half = packRGBA(0, 255, 0, 128);
    cel(0)[1] = half;
    e.setLayerProps(0, { alphaLock: true });
    dot(0, 0, RED);
    expect(cel(0)[0]).toBe(0);
    dot(1, 0, RED);
    expect(cel(0)[1]).toBe(packRGBA(255, 0, 0, 128));
    e.setTool('eraser');
    e.pointerDown(1, 0, 'primary');
    e.pointerUp();
    expect(cel(0)[1]).toBe(packRGBA(255, 0, 0, 128));
  });

  it('alpha lock applies to bucket fill', () => {
    const { e, cel } = setup(3, 1);
    cel(0)[0] = RED;
    e.setLayerProps(0, { alphaLock: true });
    e.setPrimary(BLUE);
    e.setTool('bucket');
    e.pointerDown(1, 0, 'primary'); // transparent region
    e.pointerUp();
    expect([...cel(0)]).toEqual([RED, 0, 0]);
  });

  it('reference layers show only in the editor view, are not drawable and not exported', () => {
    const { e, cel } = setup(2, 2);
    const img = { w: 2, h: 2, pixels: new Uint32Array(4).fill(BLUE) };
    expect(e.addImageLayer(img, 'ref', true)).toBe(true);
    const ref = e.project.layers[1]!;
    expect(ref.isReference).toBe(true);
    expect(ref.opacity).toBe(0.5);
    e.setTool('pencil');
    e.setPrimary(RED);
    e.pointerDown(0, 0, 'primary');
    e.pointerUp();
    expect(e.project.frames[0]!.cels.get(ref.id)![0]).toBe(BLUE);
    expect(cel(0)[0]).toBe(0);
    const f = e.project.frames[0]!;
    expect(compositeFrame(e.project, f)[0]).toBe(0);
    expect(compositeFrame(e.project, f, { reference: true })[0]! >>> 24).toBe(128);
    expect(e.mergeDown()).toBe(false);
    e.undo();
    expect(e.project.layers).toHaveLength(1);
  });

  it('imports an image as a normal layer, clipped to the canvas', () => {
    const { e } = setup(2, 2);
    const img = { w: 3, h: 3, pixels: new Uint32Array(9).fill(GREEN) };
    expect(e.addImageLayer(img, 'big', false)).toBe(true);
    const cel = e.project.frames[0]!.cels.get(e.project.layers[1]!.id)!;
    expect(cel.length).toBe(4);
    expect(cel.every((v) => v === GREEN)).toBe(true);
  });
});

describe('blend modes', () => {
  it('channel functions', () => {
    expect(blendChannel('multiply', 0.5, 0.5)).toBe(0.25);
    expect(blendChannel('screen', 0.5, 0.5)).toBe(0.75);
    expect(blendChannel('add', 0.7, 0.7)).toBe(1);
    expect(blendChannel('subtract', 0.2, 0.7)).toBe(0);
    expect(blendChannel('darken', 0.2, 0.7)).toBe(0.2);
    expect(blendChannel('lighten', 0.2, 0.7)).toBe(0.7);
    expect(blendChannel('difference', 0.2, 0.7)).toBeCloseTo(0.5);
    expect(blendChannel('overlay', 0.25, 0.5)).toBe(0.25);
    expect(blendChannel('normal', 0.25, 0.5)).toBe(0.5);
  });

  it('composites a multiply layer over opaque pixels, and acts as normal over transparency', () => {
    const p = createProject({ width: 2, height: 1 });
    const f = p.frames[0]!;
    const base = p.layers[0]!;
    f.cels.get(base.id)![0] = packRGBA(200, 100, 50);
    p.layers.push({ id: 'm', name: 'm', visible: true, locked: false, opacity: 1, blendMode: 'multiply', isReference: false, alphaLock: false });
    f.cels.set('m', Uint32Array.of(packRGBA(128, 128, 128), packRGBA(10, 20, 30)));
    const out = compositeFrame(p, f);
    expect(out[0]).toBe(packRGBA(100, 50, 25));
    expect(out[1]).toBe(packRGBA(10, 20, 30));
  });
});

describe('palette lock and replace color', () => {
  it('snaps drawn colors to the nearest palette color', () => {
    const { e, dot, cel } = setup(4, 1);
    e.setPalette('p', [RED, BLUE]);
    e.setOptions({ paletteLock: true });
    dot(0, 0, packRGBA(250, 30, 30));
    dot(1, 0, packRGBA(20, 20, 200));
    expect(cel(0)[0]).toBe(RED);
    expect(cel(0)[1]).toBe(BLUE);
    e.setOptions({ paletteLock: false });
    dot(2, 0, packRGBA(250, 30, 30));
    expect(cel(0)[2]).toBe(packRGBA(250, 30, 30));
  });

  it('replaces a color across the frame/project in one undo step, skipping locked layers', () => {
    const { e, dot, cel } = setup(3, 1);
    dot(0, 0, RED);
    e.addLayer();
    dot(1, 0, RED);
    e.addLayer();
    dot(2, 0, RED);
    e.setLayerProps(2, { locked: true });
    expect(e.replaceColor(RED, BLUE, 'frame')).toBe(2);
    expect(cel(0)[0]).toBe(BLUE);
    expect(cel(1)[1]).toBe(BLUE);
    expect(cel(2)[2]).toBe(RED);
    e.undo();
    expect(cel(0)[0]).toBe(RED);
    expect(cel(1)[1]).toBe(RED);
    e.redo();
    expect(cel(1)[1]).toBe(BLUE);
    expect(e.replaceColor(RED, RED, 'project')).toBe(0);
  });

  it('edits palette entries', () => {
    const { e } = setup();
    e.setPalette('p', [RED]);
    expect(e.addPaletteColor(BLUE)).toBe(true);
    expect(e.addPaletteColor(BLUE)).toBe(false);
    e.addPaletteColor(GREEN);
    e.movePaletteColor(2, 0);
    expect(e.project.palette.colors).toEqual([GREEN, RED, BLUE]);
    e.setPaletteColor(1, 5);
    e.removePaletteColor(0);
    expect(e.project.palette.colors).toEqual([5, BLUE]);
  });
});

describe('palette formats', () => {
  it('parses hex colors and lists', () => {
    expect(parseHexColor('#ff0000')).toBe(RED);
    expect(parseHexColor('f00')).toBe(RED);
    expect(parseHexColor('ff000080')).toBe(packRGBA(255, 0, 0, 128));
    expect(parseHexColor('xyz')).toBeNull();
    expect(parseHexList('ff0000\n00ff00\r\n#0000ff, 000')).toEqual([RED, GREEN, BLUE, packRGBA(0, 0, 0)]);
    expect(() => parseHexList('ff0000 nope')).toThrow();
  });

  it('parses GIMP .gpl', () => {
    const gpl = 'GIMP Palette\nName: Test\nColumns: 4\n#\n255   0   0\tRed\n  0 255   0 Green\n';
    expect(parseGpl(gpl)).toEqual({ name: 'Test', colors: [RED, GREEN] });
    expect(() => parseGpl('nope')).toThrow();
  });

  it('parses JASC .pal', () => {
    const pal = 'JASC-PAL\r\n0100\r\n2\r\n255 0 0\r\n0 0 255\r\n';
    expect(parsePal(pal).colors).toEqual([RED, BLUE]);
    expect(() => parsePal('JASC-PAL\n0100\n1\nbad')).toThrow();
  });

  it('auto-detects formats', () => {
    expect(parsePaletteText('JASC-PAL\n0100\n1\n255 0 0').colors).toEqual([RED]);
    expect(parsePaletteText('GIMP Palette\n255 0 0 r').colors).toEqual([RED]);
    expect(parsePaletteText('﻿ff0000\n00ff00').colors).toEqual([RED, GREEN]);
    expect(() => parsePaletteText('   ')).toThrow();
  });

  it('round-trips through every export format', () => {
    const colors = [RED, GREEN, BLUE, packRGBA(1, 2, 3)];
    expect(parsePaletteText(exportHex(colors)).colors).toEqual(colors);
    expect(parsePaletteText(exportGpl('x', colors))).toEqual({ name: 'x', colors });
    expect(parsePaletteText(exportPal(colors)).colors).toEqual(colors);
  });

  it('extracts the most frequent visible colors', () => {
    const px = Uint32Array.of(RED, RED, BLUE, 0, GREEN, GREEN, GREEN);
    expect(extractPalette(px)).toEqual([GREEN, RED, BLUE]);
    expect(extractPalette(px, 2)).toEqual([GREEN, RED]);
  });

  it('recognises Lospec slugs and URLs', () => {
    expect(lospecSlug('pico-8')).toBe('pico-8');
    expect(lospecSlug('https://lospec.com/palette-list/endesga-32')).toBe('endesga-32');
    expect(lospecSlug('ff0000')).toBeNull();
    expect(lospecSlug('two words')).toBeNull();
  });

  it('built-in palettes have the expected sizes and no invalid entries', () => {
    const sizes = Object.fromEntries(BUILTIN_PALETTES.map((p) => [p.name, p.colors.length]));
    expect(sizes['PICO-8']).toBe(16);
    expect(sizes['Endesga 32']).toBe(32);
    expect(sizes['Sweetie 16']).toBe(16);
    expect(sizes['DB16']).toBe(16);
    expect(sizes['DB32']).toBe(32);
    expect(sizes['Game Boy']).toBe(4);
    expect(sizes['Grayscale 16']).toBe(16);
    expect(sizes['NES']).toBeGreaterThan(40);
    for (const p of BUILTIN_PALETTES) expect(new Set(p.colors).size).toBe(p.colors.length);
  });
});

describe('hsv', () => {
  it('round-trips colors', () => {
    for (const [r, g, b] of [[255, 0, 0], [12, 200, 99], [0, 0, 0], [255, 255, 255], [128, 128, 128]] as const) {
      const [h, s, v] = rgbToHsv(r, g, b);
      expect(hsvToRgb(h, s, v)).toEqual([r, g, b]);
    }
    expect(rgbToHsv(0, 255, 0)[0]).toBe(120);
  });
});
