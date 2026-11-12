import { describe, expect, it } from 'vitest';
import { createCel, packRGBA, setPixel, unpackRGBA } from '../src/core/pixels';

describe('pixels', () => {
  it('round-trips packed colors', () => {
    expect(unpackRGBA(packRGBA(10, 20, 30, 40))).toEqual([10, 20, 30, 40]);
  });
  it('sets pixels and ignores out-of-bounds writes', () => {
    const cel = createCel(4, 4);
    setPixel(cel, 4, 1, 2, 7);
    setPixel(cel, 4, -1, 0, 7);
    setPixel(cel, 4, 4, 0, 7);
    expect(cel[9]).toBe(7);
    expect(cel.filter((v) => v !== 0).length).toBe(1);
  });
});
