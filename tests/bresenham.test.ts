import { describe, expect, it } from 'vitest';
import { bresenham } from '../src/core/bresenham';

describe('bresenham', () => {
  it('draws a single point', () => {
    expect(bresenham(3, 3, 3, 3)).toEqual([[3, 3]]);
  });
  it('draws horizontal and vertical lines', () => {
    expect(bresenham(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(bresenham(2, 3, 2, 0)).toEqual([[2, 3], [2, 2], [2, 1], [2, 0]]);
  });
  it('draws a perfect diagonal', () => {
    expect(bresenham(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });
  it('has no gaps and includes both endpoints for any direction', () => {
    const cases: Array<[number, number, number, number]> = [[0, 0, 10, 3], [10, 3, 0, 0], [-4, 7, 5, -2], [2, 9, 3, -8]];
    for (const [x0, y0, x1, y1] of cases) {
      const pts = bresenham(x0, y0, x1, y1);
      expect(pts[0]).toEqual([x0, y0]);
      expect(pts[pts.length - 1]).toEqual([x1, y1]);
      expect(pts.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
      for (let i = 1; i < pts.length; i++) {
        expect(Math.abs(pts[i]![0] - pts[i - 1]![0])).toBeLessThanOrEqual(1);
        expect(Math.abs(pts[i]![1] - pts[i - 1]![1])).toBeLessThanOrEqual(1);
      }
    }
  });
});
