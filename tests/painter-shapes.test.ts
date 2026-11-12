import { describe, expect, it } from 'vitest';
import { createPainter, defaultSymmetry, mirrorCoord } from '../src/core/painter';
import { pixelPerfect } from '../src/core/pixelperfect';
import { constrainSquare, ellipsePoints, rectPoints, snapLine } from '../src/core/shapes';
import { threshold, ditherPick, gradientT, applyGradient } from '../src/core/dither';
import { hslToRgb, rgbToHsl, shadePixel, paletteRamp } from '../src/core/color';
import { packRGBA, unpackRGBA } from '../src/core/pixels';

const set = (cel: Uint32Array, w: number) => {
  const out: string[] = [];
  cel.forEach((v, i) => { if (v) out.push(`${i % w},${Math.floor(i / w)}`); });
  return out.sort();
};

describe('symmetry (Painter)', () => {
  it('mirrorCoord reflects across the axis', () => {
    expect(mirrorCoord(0, 4)).toBe(7);
    expect(mirrorCoord(3, 4)).toBe(4);
    expect(mirrorCoord(2, 4.5)).toBe(6);
  });
  it('horizontal mirror writes the reflected pixel', () => {
    const cel = new Uint32Array(8 * 8);
    const sym = { ...defaultSymmetry(8, 8), x: true };
    createPainter(cel, 8, 8, null, sym).put(1, 2, 9);
    expect(set(cel, 8)).toEqual(['1,2', '6,2']);
  });
  it('both axes write four pixels, and a pixel on a half-pixel axis is not doubled', () => {
    const cel = new Uint32Array(8 * 8);
    const sym = { ...defaultSymmetry(8, 8), x: true, y: true };
    createPainter(cel, 8, 8, null, sym).put(1, 2, 9);
    expect(set(cel, 8)).toEqual(['1,2', '1,5', '6,2', '6,5']);
  });
  it('a moved axis changes the reflection', () => {
    const cel = new Uint32Array(8 * 8);
    const sym = { x: true, y: false, axisX: 2, axisY: 4 };
    createPainter(cel, 8, 8, null, sym).put(0, 0, 9);
    expect(set(cel, 8)).toEqual(['0,0', '3,0']);
  });
  it('drops mirrored pixels that fall outside the canvas', () => {
    const cel = new Uint32Array(8 * 8);
    const sym = { x: true, y: false, axisX: 1, axisY: 4 };
    createPainter(cel, 8, 8, null, sym).put(6, 0, 9); // mirror -> x=-5
    expect(set(cel, 8)).toEqual(['6,0']);
  });
  it('respects the selection mask for every copy', () => {
    const cel = new Uint32Array(4 * 4);
    const mask = new Uint8Array(16);
    mask[1] = 1; // only (1,0)
    const sym = { ...defaultSymmetry(4, 4), x: true };
    const p = createPainter(cel, 4, 4, mask, sym);
    p.put(1, 0, 5);
    p.put(2, 0, 5);
    expect(set(cel, 4)).toEqual(['1,0']);
  });
});

describe('pixelPerfect', () => {
  it('removes the L-corner of an orthogonal staircase', () => {
    expect(pixelPerfect([[0, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
    expect(pixelPerfect([[0, 0], [0, 1], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });
  it('turns a 2-wide staircase into a clean diagonal', () => {
    const stair: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3]];
    expect(pixelPerfect(stair)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });
  it('keeps straight lines and collapses duplicates', () => {
    expect(pixelPerfect([[0, 0], [1, 0], [2, 0], [2, 0], [3, 0]])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });
  it('does not alter a line that has no corners', () => {
    const diag: Array<[number, number]> = [[0, 0], [1, 1], [2, 2]];
    expect(pixelPerfect(diag)).toEqual(diag);
  });
});

describe('shapes', () => {
  it('rectangle outline vs filled counts', () => {
    expect(rectPoints(0, 0, 4, 3, true).length).toBe(20);
    expect(rectPoints(0, 0, 4, 3, false).length).toBe(14);
    expect(rectPoints(4, 3, 0, 0, true).length).toBe(20);
  });
  it('ellipse fits its box, is symmetric, and its outline is a subset of the fill', () => {
    const fill = ellipsePoints(2, 3, 12, 9, true);
    const outline = ellipsePoints(2, 3, 12, 9, false);
    const key = (p: number[]) => `${p[0]},${p[1]}`;
    const fk = new Set(fill.map(key));
    expect(outline.length).toBeLessThan(fill.length);
    for (const p of outline) expect(fk.has(key(p))).toBe(true);
    for (const [x, y] of fill) {
      expect(x >= 2 && x <= 12 && y >= 3 && y <= 9).toBe(true);
      expect(fk.has(`${2 + 12 - x},${y}`)).toBe(true); // mirror in x
      expect(fk.has(`${x},${3 + 9 - y}`)).toBe(true); // mirror in y
    }
  });
  it('1x1 and 2x2 ellipses are full', () => {
    expect(ellipsePoints(0, 0, 0, 0, true).length).toBe(1);
    expect(ellipsePoints(0, 0, 1, 1, true).length).toBe(4);
  });
  it('shift constraints', () => {
    expect(constrainSquare(0, 0, 5, 2)).toEqual([5, 5]);
    expect(constrainSquare(5, 5, 2, 4)).toEqual([2, 2]);
    expect(snapLine(0, 0, 10, 1)).toEqual([10, 0]);
    expect(snapLine(0, 0, 10, 9)).toEqual([Math.round(Math.hypot(10, 9) * Math.cos(Math.PI / 4)), Math.round(Math.hypot(10, 9) * Math.sin(Math.PI / 4))]);
    expect(snapLine(3, 3, 3, 3)).toEqual([3, 3]);
  });
});

describe('dither and gradient', () => {
  it('thresholds are within (0,1) and bayer4 has 16 distinct levels', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const t = threshold('bayer4', x, y);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
      seen.add(t);
    }
    expect(seen.size).toBe(16);
  });
  it('t=0 is always the first color and t=1 always the second, for every pattern', () => {
    for (const pat of ['none', 'bayer2', 'bayer4', 'checker'] as const) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        expect(ditherPick(pat, 0, x, y)).toBe(false);
        expect(ditherPick(pat, 1, x, y)).toBe(true);
      }
    }
  });
  it('t=0.5 with the checker pattern alternates', () => {
    expect(ditherPick('checker', 0.5, 0, 0)).toBe(true);
    expect(ditherPick('checker', 0.5, 1, 0)).toBe(false);
  });
  it('gradientT is clamped and radial grows with distance', () => {
    expect(gradientT('linear', 0, 0, 10, 0, -5, 0)).toBe(0);
    expect(gradientT('linear', 0, 0, 10, 0, 5, 7)).toBe(0.5);
    expect(gradientT('linear', 0, 0, 10, 0, 99, 0)).toBe(1);
    expect(gradientT('radial', 0, 0, 10, 0, 0, 5)).toBe(0.5);
    expect(gradientT('linear', 3, 3, 3, 3, 9, 9)).toBe(0);
  });
  it('applyGradient honors the mask and hits both end colors', () => {
    const cel = new Uint32Array(8);
    const mask = new Uint8Array(8).fill(1);
    mask[3] = 0;
    applyGradient(cel, mask, 8, 1, { kind: 'linear', x0: 0, y0: 0, x1: 7, y1: 0, pattern: 'none', primary: 1, secondary: 2 });
    expect(cel[0]).toBe(1);
    expect(cel[7]).toBe(2);
    expect(cel[3]).toBe(0);
  });
});

describe('color / shading', () => {
  it('hsl round-trips', () => {
    for (const [r, g, b] of [[255, 0, 0], [10, 200, 90], [128, 128, 128], [3, 4, 250]] as const) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [r2, g2, b2] = hslToRgb(h, s, l);
      expect(Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2)).toBeLessThanOrEqual(3);
    }
  });
  it('lighten raises and darken lowers lightness; alpha is preserved', () => {
    const c = packRGBA(100, 100, 100, 200);
    const up = unpackRGBA(shadePixel(c, 1, 10, null));
    const down = unpackRGBA(shadePixel(c, -1, 10, null));
    expect(up[0]).toBeGreaterThan(100);
    expect(down[0]).toBeLessThan(100);
    expect(up[3]).toBe(200);
    expect(down[3]).toBe(200);
  });
  it('moves along a palette ramp when one is given and clamps at the ends', () => {
    const ramp = paletteRamp([packRGBA(200, 200, 200), packRGBA(0, 0, 0), packRGBA(100, 100, 100)]);
    expect(shadePixel(packRGBA(100, 100, 100), 1, 10, ramp)).toBe(packRGBA(200, 200, 200));
    expect(shadePixel(packRGBA(100, 100, 100), -1, 10, ramp)).toBe(packRGBA(0, 0, 0));
    expect(shadePixel(packRGBA(200, 200, 200), 1, 10, ramp)).toBe(packRGBA(200, 200, 200));
  });
});
