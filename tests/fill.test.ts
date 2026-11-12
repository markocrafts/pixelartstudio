import { describe, expect, it } from 'vitest';
import { applyMask, colorDistancePct, fillMask } from '../src/core/fill';
import { packRGBA } from '../src/core/pixels';

const R = packRGBA(255, 0, 0);
const G = packRGBA(0, 255, 0);
const T = 0;

/** 5x1 row: R R G R R */
const row = () => Uint32Array.from([R, R, G, R, R]);
const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe('fillMask', () => {
  it('contiguous fill stops at a different color', () => {
    const m = fillMask(row(), 5, 1, 0, 0, 0, true)!;
    expect([...m]).toEqual([1, 1, 0, 0, 0]);
  });
  it('global fill replaces every matching pixel', () => {
    const m = fillMask(row(), 5, 1, 0, 0, 0, false)!;
    expect([...m]).toEqual([1, 1, 0, 1, 1]);
  });
  it('returns null outside the canvas', () => {
    expect(fillMask(row(), 5, 1, 5, 0, 0, true)).toBeNull();
    expect(fillMask(row(), 5, 1, 0, -1, 0, true)).toBeNull();
  });
  it('uses 4-connectivity (diagonals do not leak)', () => {
    // 2x2: R G / G R  -> filling top-left red must not reach bottom-right red
    const img = Uint32Array.from([R, G, G, R]);
    expect([...fillMask(img, 2, 2, 0, 0, 0, true)!]).toEqual([1, 0, 0, 0]);
  });
  it('tolerance includes near colors', () => {
    const near = packRGBA(250, 0, 0);
    const img = Uint32Array.from([R, near, G]);
    expect(count(fillMask(img, 3, 1, 0, 0, 0, true)!)).toBe(1);
    expect(count(fillMask(img, 3, 1, 0, 0, 5, true)!)).toBe(2);
    expect(count(fillMask(img, 3, 1, 0, 0, 100, true)!)).toBe(3);
  });
  it('treats all fully transparent pixels as the same color', () => {
    const img = Uint32Array.from([T, packRGBA(9, 9, 9, 0), R]);
    expect(count(fillMask(img, 3, 1, 0, 0, 0, true)!)).toBe(2);
  });
  it('fills a large open area without overflowing the stack', () => {
    const img = new Uint32Array(512 * 512);
    expect(count(fillMask(img, 512, 512, 100, 100, 0, true)!)).toBe(512 * 512);
  });
  it('applyMask paints only masked pixels', () => {
    const img = row();
    applyMask(img, fillMask(img, 5, 1, 0, 0, 0, true)!, G);
    expect([...img]).toEqual([G, G, G, R, R]);
  });
  it('colorDistancePct is 0 for equal and 100 for opposite colors', () => {
    expect(colorDistancePct(R, R)).toBe(0);
    expect(colorDistancePct(packRGBA(0, 0, 0), packRGBA(255, 255, 255))).toBe(100);
  });
});
