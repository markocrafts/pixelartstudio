import { describe, expect, it } from 'vitest';
import { brushFootprint, clampBrushSize } from '../src/core/brush';
import { compositeFrame } from '../src/core/composite';
import { hexToPacked, packRGBA, packedToHex } from '../src/core/pixels';
import { clampSize, createProject } from '../src/core/project';
import { Viewport, clampToCanvas } from '../src/render/viewport';

describe('brush', () => {
  it('square footprints have size^2 cells', () => {
    for (const n of [1, 2, 3, 8, 64]) expect(brushFootprint(n, 'square').length).toBe(n * n);
  });
  it('circle footprints are symmetric-ish, smaller than the square, and include the center', () => {
    expect(brushFootprint(1, 'circle').length).toBe(1);
    expect(brushFootprint(2, 'circle').length).toBe(4);
    expect(brushFootprint(3, 'circle').length).toBe(5);
    expect(brushFootprint(8, 'circle').length).toBeLessThan(64);
  });
  it('clamps size to 1..64', () => {
    expect(clampBrushSize(0)).toBe(1);
    expect(clampBrushSize(999)).toBe(64);
    expect(clampBrushSize(NaN)).toBe(1);
  });
});

describe('colors and project', () => {
  it('hex round-trips', () => {
    expect(packedToHex(hexToPacked('#12ab9f'))).toBe('#12ab9f');
    expect(hexToPacked('nope')).toBe(0);
  });
  it('clamps canvas size to 1..2048', () => {
    expect(clampSize(0)).toBe(1);
    expect(clampSize(5000)).toBe(2048);
  });
});

describe('composite', () => {
  it('stacks layers bottom-to-top and honors visibility and opacity', () => {
    const p = createProject({ width: 1, height: 1, background: packRGBA(255, 0, 0) });
    const f = p.frames[0]!;
    p.layers.push({ id: 'top', name: 'Top', visible: true, locked: false, opacity: 1, blendMode: 'normal', isReference: false, alphaLock: false });
    f.cels.set('top', Uint32Array.of(packRGBA(0, 0, 255)));
    expect(compositeFrame(p, f)[0]).toBe(packRGBA(0, 0, 255));
    p.layers[1]!.visible = false;
    expect(compositeFrame(p, f)[0]).toBe(packRGBA(255, 0, 0));
    p.layers[1]!.visible = true;
    p.layers[1]!.opacity = 0.5;
    const [r, , b, a] = [...new Uint8Array(compositeFrame(p, f).buffer)];
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135);
    expect(b).toBeGreaterThan(120);
  });
});

describe('Viewport', () => {
  it('screenToPixel inverts the pan and zoom', () => {
    const v = new Viewport();
    v.zoom = 10;
    v.panX = 100;
    v.panY = 50;
    expect(v.screenToPixel(100, 50)).toEqual({ x: 0, y: 0 });
    expect(v.screenToPixel(129, 89)).toEqual({ x: 2, y: 3 });
    expect(v.screenToPixel(99, 49)).toEqual({ x: -1, y: -1 });
  });
  it('zooming keeps the point under the cursor fixed', () => {
    const v = new Viewport();
    v.zoom = 8;
    v.panX = 40;
    v.panY = 40;
    const before = v.screenToImage(200, 150);
    v.stepZoom(1, 200, 150);
    const after = v.screenToImage(200, 150);
    expect(v.zoom).toBeGreaterThan(8);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });
  it('stays within 1x..64x', () => {
    const v = new Viewport();
    for (let i = 0; i < 30; i++) v.stepZoom(1, 0, 0);
    expect(v.zoom).toBe(64);
    for (let i = 0; i < 30; i++) v.stepZoom(-1, 0, 0);
    expect(v.zoom).toBe(1);
  });
  it('fit picks the largest zoom that fits and centers', () => {
    const v = new Viewport();
    v.fit(800, 600, 32, 32, 24);
    expect(v.zoom).toBe(16); // 32*16=512 <= 552; 32*24=768 > 552
    expect(v.panX).toBe((800 - 512) / 2);
    expect(v.panY).toBe((600 - 512) / 2);
  });
});

describe('clampToCanvas / center', () => {
  it('clamps to the canvas edges', () => {
    expect(clampToCanvas(-5, 40, 32, 32)).toEqual({ x: 0, y: 31 });
    expect(clampToCanvas(10, 10, 32, 32)).toEqual({ x: 10, y: 10 });
  });
  it('center keeps zoom', () => {
    const vp = new Viewport();
    vp.zoom = 4;
    vp.center(400, 300, 32, 32);
    expect(vp.zoom).toBe(4);
    expect(vp.panX).toBe(136);
    expect(vp.panY).toBe(86);
  });
});
