import { describe, expect, it } from 'vitest';
import { clampFps, frameDuration, playbackSequence, tagsAfterDelete, tagsAfterInsert } from '../src/core/animation';
import { Editor } from '../src/core/editor';
import { decodeGif } from '../src/core/gifdecode';
import { indexFrames } from '../src/core/gifindex';
import { buildOnion, tintFrame } from '../src/core/onion';
import { packRGBA } from '../src/core/pixels';
import { createProject, type FrameTag } from '../src/core/project';
import { buildSheet, sheetGeometry, sheetJson, sliceSheet } from '../src/core/sheet';
import { encodeGif } from '../src/io/gif';

const RED = packRGBA(255, 0, 0);
const BLUE = packRGBA(0, 0, 255);
const GREEN = packRGBA(0, 255, 0);

function setup(w = 4, h = 4) {
  const e = new Editor(createProject({ width: w, height: h }));
  const px = (frame: number, layer = 0) => e.project.frames[frame]!.cels.get(e.project.layers[layer]!.id)!;
  const dot = (x: number, y: number, c = RED) => { e.setPrimary(c); e.pointerDown(x, y, 'primary'); e.pointerUp(); };
  return { e, px, dot };
}
const tag = (name: string, from: number, to: number): FrameTag => ({ id: name, name, from, to, direction: 'forward', loop: true });

describe('frame operations', () => {
  it('adds a frame after the active one with a blank cel per layer; undo/redo', () => {
    const { e, px, dot } = setup();
    e.addLayer();
    dot(0, 0);
    e.addFrame();
    expect(e.project.frames).toHaveLength(2);
    expect(e.activeFrame).toBe(1);
    expect(e.project.frames[1]!.cels.size).toBe(2);
    dot(1, 1, BLUE);
    expect(px(1, 1)[5]).toBe(BLUE);
    e.undo(); e.undo();
    expect(e.project.frames).toHaveLength(1);
    expect(e.activeFrame).toBe(0);
    e.redo(); e.redo();
    expect(e.project.frames).toHaveLength(2);
    expect(px(1, 1)[5]).toBe(BLUE);
  });

  it('duplicates a frame range with its pixels and durations', () => {
    const { e, px, dot } = setup();
    dot(0, 0);
    e.addFrame();
    dot(1, 0, BLUE);
    e.setActiveFrame(0);
    e.setActiveFrame(1, true);
    expect(e.frameRange).toEqual({ from: 0, to: 1 });
    e.setFrameDuration(200);
    expect(e.duplicateFrames()).toBe(true);
    expect(e.project.frames).toHaveLength(4);
    expect(px(2)[0]).toBe(RED);
    expect(px(3)[1]).toBe(BLUE);
    expect(e.project.frames[2]!.durationMs).toBe(200);
    expect(px(2)).not.toBe(px(0));
    e.undo();
    expect(e.project.frames).toHaveLength(2);
  });

  it('deletes frames, keeps at least one, and undo restores pixels', () => {
    const { e, px, dot } = setup();
    e.addFrame();
    dot(2, 2, GREEN);
    const id = e.project.frames[1]!.id;
    expect(e.deleteFrames()).toBe(true);
    expect(e.project.frames).toHaveLength(1);
    expect(e.activeFrame).toBe(0);
    expect(e.deleteFrames()).toBe(false);
    e.undo();
    expect(e.project.frames[1]!.id).toBe(id);
    expect(px(1)[2 * 4 + 2]).toBe(GREEN);
    expect(e.activeFrame).toBe(1);
  });

  it('reorders frames', () => {
    const { e } = setup();
    e.addFrame(); e.addFrame();
    const ids = e.project.frames.map((f) => f.id);
    expect(e.moveFrame(0, 2)).toBe(true);
    expect(e.project.frames.map((f) => f.id)).toEqual([ids[1], ids[2], ids[0]]);
    e.undo();
    expect(e.project.frames.map((f) => f.id)).toEqual(ids);
  });

  it('enforces the 512 frame limit', () => {
    const { e } = setup(1, 1);
    for (let i = 0; i < 600; i++) e.addFrame();
    expect(e.project.frames).toHaveLength(512);
    expect(e.canAddFrame).toBe(false);
  });

  it('copies and pastes cels between frames', () => {
    const { e, px, dot } = setup();
    dot(1, 1);
    expect(e.copyCel()).toBe(true);
    e.addFrame();
    expect(px(1)[5]).toBe(0);
    expect(e.pasteCel()).toBe(true);
    expect(px(1)[5]).toBe(RED);
    e.undo();
    expect(px(1)[5]).toBe(0);
  });

  it('layer operations keep every frame in sync', () => {
    const { e } = setup();
    e.addFrame();
    e.addLayer();
    expect(e.project.frames.every((f) => f.cels.size === 2)).toBe(true);
    e.deleteLayer();
    expect(e.project.frames.every((f) => f.cels.size === 1)).toBe(true);
    e.undo();
    expect(e.project.frames.every((f) => f.cels.size === 2)).toBe(true);
  });

  it('frame durations and fps', () => {
    const { e } = setup();
    expect(frameDuration(e.project, e.project.frames[0]!)).toBe(100);
    e.setFps(20);
    expect(frameDuration(e.project, e.project.frames[0]!)).toBe(50);
    e.setFrameDuration(333);
    expect(frameDuration(e.project, e.project.frames[0]!)).toBe(333);
    e.setFrameDuration(undefined);
    expect(e.project.frames[0]!.durationMs).toBeUndefined();
    expect(clampFps(500)).toBe(60);
    expect(clampFps(0)).toBe(1);
  });
});

describe('tags', () => {
  it('adds, edits, removes with undo', () => {
    const { e } = setup();
    e.addFrame(); e.addFrame();
    expect(e.addTag('walk', 2, 0, 'pingpong', false)).toBe(true);
    const t = e.project.tags[0]!;
    expect([t.from, t.to, t.direction, t.loop]).toEqual([0, 2, 'pingpong', false]);
    e.updateTag(t.id, { name: 'run', to: 1 });
    expect(e.project.tags[0]).toMatchObject({ name: 'run', from: 0, to: 1 });
    e.undo();
    expect(e.project.tags[0]!.name).toBe('walk');
    e.removeTag(t.id);
    expect(e.project.tags).toHaveLength(0);
    e.undo();
    expect(e.project.tags).toHaveLength(1);
  });

  it('shift with inserted and deleted frames', () => {
    expect(tagsAfterInsert([tag('a', 1, 2)], 2, 1)).toMatchObject([{ from: 1, to: 3 }]);
    expect(tagsAfterInsert([tag('a', 1, 2)], 0, 2)).toMatchObject([{ from: 3, to: 4 }]);
    expect(tagsAfterDelete([tag('a', 1, 3)], 2, 1)).toMatchObject([{ from: 1, to: 2 }]);
    expect(tagsAfterDelete([tag('a', 1, 2)], 1, 2)).toEqual([]);
    expect(tagsAfterDelete([tag('a', 2, 4)], 0, 2)).toMatchObject([{ from: 0, to: 2 }]);
  });

  it('frame edits update tags and undo restores them', () => {
    const { e } = setup();
    e.addFrame(); e.addFrame(); // 3 frames
    e.addTag('x', 1, 2);
    e.setActiveFrame(0);
    e.addFrame(); // inserted at 1
    expect(e.project.tags[0]).toMatchObject({ from: 2, to: 3 });
    e.undo();
    expect(e.project.tags[0]).toMatchObject({ from: 1, to: 2 });
  });
});

describe('playback sequence', () => {
  it('forward, reverse and ping-pong', () => {
    expect(playbackSequence(1, 3, 'forward')).toEqual([1, 2, 3]);
    expect(playbackSequence(1, 3, 'reverse')).toEqual([3, 2, 1]);
    expect(playbackSequence(0, 3, 'pingpong')).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackSequence(0, 1, 'pingpong')).toEqual([0, 1]);
    expect(playbackSequence(2, 2, 'pingpong')).toEqual([2]);
  });
});

describe('onion skin', () => {
  it('tints and fades, previous red and next blue', () => {
    const t = tintFrame(Uint32Array.of(packRGBA(0, 0, 0), 0), 0xff0000, 0.5);
    expect(t[0]! >>> 24).toBe(128);
    expect(t[0]! & 255).toBe(127);
    expect(t[1]).toBe(0);
    const frames = [Uint32Array.of(RED), Uint32Array.of(0), Uint32Array.of(RED)];
    const only = buildOnion(3, 1, { enabled: true, prev: 1, next: 0, opacity: 1 }, (i) => frames[i]!, 1);
    expect(only[0]! >>> 24).toBe(255);
    const none = buildOnion(3, 1, { enabled: true, prev: 0, next: 0, opacity: 1 }, (i) => frames[i]!, 1);
    expect(none[0]).toBe(0);
    const edge = buildOnion(3, 0, { enabled: true, prev: 2, next: 0, opacity: 1 }, (i) => frames[i]!, 1);
    expect(edge[0]).toBe(0);
  });
});

describe('sprite sheets', () => {
  const frames = [Uint32Array.of(RED, 0), Uint32Array.of(BLUE, GREEN), Uint32Array.of(GREEN, GREEN)]; // 2×1 each

  it('computes layouts with padding', () => {
    expect(sheetGeometry(3, 2, 1, { layout: 'horizontal', cols: 0, padding: 0 })).toMatchObject({ width: 6, height: 1 });
    expect(sheetGeometry(3, 2, 1, { layout: 'vertical', cols: 0, padding: 1 })).toMatchObject({ width: 4, height: 7 });
    const g = sheetGeometry(3, 2, 1, { layout: 'grid', cols: 2, padding: 0 });
    expect(g).toMatchObject({ width: 4, height: 2 });
    expect(g.cells[2]).toEqual({ x: 0, y: 1 });
  });

  it('round-trips build → slice', () => {
    for (const layout of ['horizontal', 'vertical', 'grid'] as const) {
      for (const padding of [0, 2]) {
        const { pixels, geometry } = buildSheet(frames, 2, 1, { layout, cols: 2, padding });
        const back = sliceSheet(pixels, geometry.width, geometry.height, 2, 1, padding).filter((c) => c.some(Boolean));
        expect(back.map((c) => [...c])).toEqual(frames.map((f) => [...f]).filter((f) => f.some(Boolean)));
      }
    }
  });

  it('writes JSON metadata with durations and tags', () => {
    const g = sheetGeometry(2, 2, 1, { layout: 'horizontal', cols: 0, padding: 0 });
    const j = JSON.parse(sheetJson('hero', g, 2, 1, [100, 250], [tag('walk', 0, 1)]));
    expect(j.frames[1]).toMatchObject({ frame: { x: 2, y: 0, w: 2, h: 1 }, duration: 250 });
    expect(j.meta.frameTags[0]).toMatchObject({ name: 'walk', from: 0, to: 1 });
    expect(j.meta.size).toEqual({ w: 4, h: 1 });
  });
});

describe('GIF', () => {
  const f1 = Uint32Array.of(RED, 0, BLUE, GREEN);
  const f2 = Uint32Array.of(GREEN, RED, 0, BLUE);

  it('indexes frames exactly, with a transparent entry only when needed', () => {
    const a = indexFrames([f1, f2])!;
    expect(a.palette).toHaveLength(4);
    expect(a.transparentIndex).toBeGreaterThanOrEqual(0);
    const b = indexFrames([Uint32Array.of(RED, BLUE)])!;
    expect(b.transparentIndex).toBe(-1);
    const many = Uint32Array.from({ length: 300 }, (_, i) => packRGBA(i % 256, (i * 7) % 256, i >> 3));
    expect(indexFrames([many])).toBeNull();
  });

  it('encode → decode round-trips pixels, transparency and delays', () => {
    const bytes = encodeGif({ frames: [f1, f2], delaysMs: [100, 300], width: 2, height: 2, scale: 1, loop: true });
    const gif = decodeGif(bytes);
    expect([gif.width, gif.height, gif.frames.length]).toEqual([2, 2, 2]);
    expect([...gif.frames[0]!.pixels]).toEqual([...f1]);
    expect([...gif.frames[1]!.pixels]).toEqual([...f2]);
    expect(gif.frames.map((f) => f.delayMs)).toEqual([100, 300]);
  });

  it('scales with nearest neighbor', () => {
    const gif = decodeGif(encodeGif({ frames: [f1], delaysMs: [100], width: 2, height: 2, scale: 3, loop: false }));
    expect([gif.width, gif.height]).toEqual([6, 6]);
    expect(gif.frames[0]!.pixels[0]).toBe(RED);
    expect(gif.frames[0]!.pixels[2]).toBe(RED);
    expect(gif.frames[0]!.pixels[3]).toBe(0);
    expect(gif.frames[0]!.pixels[5 * 6 + 5]).toBe(GREEN);
  });

  it('handles animations with more than 256 colors by quantizing', () => {
    const big = Uint32Array.from({ length: 32 * 32 }, (_, i) => packRGBA(i % 256, (i * 5) % 256, (i * 11) % 256));
    const gif = decodeGif(encodeGif({ frames: [big, big], delaysMs: [50, 50], width: 32, height: 32, scale: 1, loop: true }));
    expect(gif.frames).toHaveLength(2);
    expect(gif.frames[0]!.pixels.every((p) => p >>> 24 === 255)).toBe(true);
  });

  it('rejects non-GIF data', () => {
    expect(() => decodeGif(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))).toThrow();
  });
});

describe('loadFrames', () => {
  it('builds a project from frames and rejects wrong sizes', () => {
    const e = new Editor();
    expect(e.loadFrames([{ pixels: new Uint32Array(4), durationMs: 50 }, { pixels: new Uint32Array(4).fill(RED) }], 2, 2, 'x')).toBe(true);
    expect(e.project.frames).toHaveLength(2);
    expect(e.project.frames[0]!.durationMs).toBe(50);
    expect(e.project.width).toBe(2);
    expect(e.canUndo).toBe(false);
    expect(e.loadFrames([{ pixels: new Uint32Array(3) }], 2, 2, 'y')).toBe(false);
  });
});
