import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseAseprite } from '../src/core/aseprite';
import { Editor } from '../src/core/editor';
import { packRGBA } from '../src/core/pixels';
import { createProject } from '../src/core/project';
import { parsePxf, serializePxf } from '../src/core/pxf';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const RED = packRGBA(255, 0, 0);
const BLUE = packRGBA(0, 0, 255);

function richProject() {
  const e = new Editor(createProject({ width: 5, height: 3, name: 'Hero' }));
  e.setPrimary(RED); e.pointerDown(1, 1, 'primary'); e.pointerUp();
  e.addLayer('Top');
  e.setLayerProps(1, { opacity: 0.5, blendMode: 'multiply', alphaLock: true });
  e.setPrimary(BLUE); e.pointerDown(2, 2, 'primary'); e.pointerUp();
  e.addFrame();
  e.setFrameDuration(250);
  e.setPrimary(RED); e.pointerDown(0, 0, 'primary'); e.pointerUp();
  e.addTag('walk', 0, 1, 'pingpong', false);
  e.setPalette('Mine', [RED, BLUE]);
  e.setFps(12);
  return e.project;
}

describe('.pxf', () => {
  it('round-trips everything with byte-identical cels', () => {
    const p = richProject();
    const q = parsePxf(serializePxf(p));
    expect(q).toMatchObject({ id: p.id, name: 'Hero', width: 5, height: 3, fps: 12, palette: { name: 'Mine', colors: [RED, BLUE] } });
    expect(q.layers).toEqual(p.layers);
    expect(q.tags).toEqual(p.tags);
    expect(q.frames.map((f) => [f.id, f.durationMs])).toEqual(p.frames.map((f) => [f.id, f.durationMs]));
    for (let fi = 0; fi < p.frames.length; fi++) {
      for (const l of p.layers) {
        const a = p.frames[fi]!.cels.get(l.id)!, b = q.frames[fi]!.cels.get(l.id)!;
        expect(b.length).toBe(a.length);
        expect(Array.from(b)).toEqual(Array.from(a));
      }
    }
  });

  it('rejects malformed files', () => {
    expect(() => parsePxf(Uint8Array.of(1, 2, 3))).toThrow(/valid/);
    expect(() => parsePxf(zipSync({ 'x.txt': strToU8('hi') }))).toThrow(/project.json/);
    expect(() => parsePxf(zipSync({ 'project.json': strToU8('{nope') }))).toThrow(/JSON/);
    const bytes = serializePxf(richProject());
    const files = unzipSync(bytes);
    files['cels/0_0.bin'] = new Uint8Array(3);
    expect(() => parsePxf(zipSync(files))).toThrow(/wrong size/);
    const j = JSON.parse(strFromU8(files['project.json']!));
    for (const bad of [{ width: 99999 }, { layers: [] }, { frames: [] }, { format: 'zip' }, { version: 99 }]) {
      const f2 = unzipSync(bytes);
      f2['project.json'] = strToU8(JSON.stringify({ ...j, ...bad }));
      expect(() => parsePxf(zipSync(f2))).toThrow();
    }
  });

  it('sanitizes hostile field values', () => {
    const files = unzipSync(serializePxf(richProject()));
    const j = JSON.parse(strFromU8(files['project.json']!));
    j.layers[0].opacity = 9;
    j.layers[0].blendMode = '<script>';
    j.fps = 1e9;
    j.palette.colors = [1, 'x', -4, 2 ** 40, 7];
    j.tags[0].from = 99;
    files['project.json'] = strToU8(JSON.stringify(j));
    const q = parsePxf(zipSync(files));
    expect(q.layers[0]).toMatchObject({ opacity: 1, blendMode: 'normal' });
    expect(q.fps).toBe(60);
    expect(q.palette.colors).toEqual([1, 7]);
    expect(q.tags[0]!.from).toBeLessThanOrEqual(q.frames.length - 1);
  });
});

// ---- minimal .aseprite writer for tests ----
const le = (n: number, bytes: number): number[] => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255);
const str = (s: string): number[] => [...le(s.length, 2), ...[...s].map((c) => c.charCodeAt(0))];
const chunk = (type: number, body: number[]): number[] => [...le(body.length + 6, 4), ...le(type, 2), ...body];
const frame = (chunks: number[][], durationMs: number): number[] => {
  const body = chunks.flat();
  return [...le(body.length + 16, 4), ...le(0xf1fa, 2), ...le(chunks.length, 2), ...le(durationMs, 2), 0, 0, ...le(chunks.length, 4), ...body];
};
const layerChunk = (name: string, flags = 3, blend = 0, opacity = 255): number[] =>
  chunk(0x2004, [...le(flags, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(blend, 2), opacity, 0, 0, 0, ...str(name)]);
const celChunk = (layer: number, x: number, y: number, w: number, h: number, rgba: number[], compressed: boolean): number[] => {
  const data = compressed ? [...zlibSync(Uint8Array.from(rgba))] : rgba;
  return chunk(0x2005, [...le(layer, 2), ...le(x, 2), ...le(y, 2), 255, ...le(compressed ? 2 : 0, 2), ...le(0, 2), 0, 0, 0, 0, 0, ...le(w, 2), ...le(h, 2), ...data]);
};
const linkedCel = (layer: number, frameIdx: number): number[] =>
  chunk(0x2005, [...le(layer, 2), ...le(0, 2), ...le(0, 2), 255, ...le(1, 2), ...le(0, 2), 0, 0, 0, 0, 0, ...le(frameIdx, 2)]);
const tagsChunk = (name: string, from: number, to: number, dir: number): number[] =>
  chunk(0x2018, [...le(1, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(from, 2), ...le(to, 2), dir, ...le(0, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...str(name)]);
function ase(w: number, h: number, depth: number, frames: number[][]): Uint8Array {
  const body = frames.flat();
  const header = [...le(128 + body.length, 4), ...le(0xa5e0, 2), ...le(frames.length, 2), ...le(w, 2), ...le(h, 2), ...le(depth, 2), ...le(1, 4), ...le(100, 2), ...le(0, 4), ...le(0, 4), 0, 0, 0, 0, ...le(0, 2), 1, 1, ...le(0, 2), ...le(0, 2), ...le(16, 2), ...le(16, 2)];
  while (header.length < 128) header.push(0);
  return Uint8Array.from([...header, ...body]);
}

describe('.aseprite import', () => {
  const px = (r: number, g: number, b: number, a = 255): number[] => [r, g, b, a];

  it('imports layers, frames, durations, tags, compressed and linked cels', () => {
    const f1 = frame([layerChunk('Base'), layerChunk('Top', 3, 1, 128), tagsChunk('walk', 0, 1, 2),
      celChunk(0, 0, 0, 2, 2, [...px(255, 0, 0), ...px(0, 255, 0), ...px(0, 0, 255), ...px(0, 0, 0, 0)], true),
      celChunk(1, 1, 1, 1, 1, px(9, 9, 9), false)], 120);
    const f2 = frame([linkedCel(0, 0)], 80);
    const p = parseAseprite(ase(2, 2, 32, [f1, f2]));
    expect([p.width, p.height, p.frames.length, p.layers.length]).toEqual([2, 2, 2, 2]);
    expect(p.layers[1]).toMatchObject({ name: 'Top', blendMode: 'multiply', visible: true });
    expect(p.layers[1]!.opacity).toBeCloseTo(128 / 255);
    expect(p.frames.map((f) => f.durationMs)).toEqual([120, 80]);
    const base0 = p.frames[0]!.cels.get(p.layers[0]!.id)!;
    expect([...base0]).toEqual([packRGBA(255, 0, 0), packRGBA(0, 255, 0), packRGBA(0, 0, 255), 0]);
    expect([...p.frames[1]!.cels.get(p.layers[0]!.id)!]).toEqual([...base0]); // linked
    expect(p.frames[0]!.cels.get(p.layers[1]!.id)![3]).toBe(packRGBA(9, 9, 9)); // offset cel
    expect(p.tags[0]).toMatchObject({ name: 'walk', from: 0, to: 1, direction: 'pingpong' });
  });

  it('rejects non-aseprite and truncated data', () => {
    expect(() => parseAseprite(new Uint8Array(200))).toThrow(/Aseprite/);
    const good = ase(1, 1, 32, [frame([layerChunk('L'), celChunk(0, 0, 0, 1, 1, px(1, 2, 3), false)], 100)]);
    expect(() => parseAseprite(good.subarray(0, 140))).toThrow();
    expect(parseAseprite(good).frames).toHaveLength(1);
  });
});
