import { describe, expect, it } from 'vitest';
import { allMask, colorMask, combineMasks, invertMask, maskBounds, maskCount, maskEdges, polygonMask, rectMask } from '../src/core/selection';
import { cropCel, flipH, flipV, resizeCel, rotate90, scaleCel, resizeProject, scaleProject, trimProject, rotateProject, flipProject, cropProject } from '../src/core/transform';
import { createProject } from '../src/core/project';
import { packRGBA } from '../src/core/pixels';
import { FONT_SIZES, glyphRows, hasGlyph, renderText } from '../src/core/fonts';

describe('selection masks', () => {
  it('rectMask is inclusive, order-independent and clamped', () => {
    expect(maskCount(rectMask(10, 10, 2, 2, 4, 3))).toBe(6);
    expect(maskCount(rectMask(10, 10, 4, 3, 2, 2))).toBe(6);
    expect(maskCount(rectMask(10, 10, -5, -5, 1, 1))).toBe(4);
    expect(maskBounds(rectMask(10, 10, 2, 3, 5, 6), 10, 10)).toEqual({ x: 2, y: 3, w: 4, h: 4 });
  });
  it('polygonMask fills a triangle and includes thin outlines', () => {
    const tri = polygonMask(10, 10, [[1, 1], [8, 1], [1, 8]]);
    expect(tri[2 * 10 + 2]).toBe(1);
    expect(tri[7 * 10 + 7]).toBe(0);
    const line = polygonMask(10, 10, [[1, 1], [5, 1]]);
    expect(maskCount(line)).toBe(5);
    expect(maskCount(polygonMask(10, 10, []))).toBe(0);
  });
  it('polygonMask of an axis-aligned square matches rectMask', () => {
    const sq = polygonMask(10, 10, [[2, 2], [6, 2], [6, 6], [2, 6]]);
    expect([...sq]).toEqual([...rectMask(10, 10, 2, 2, 6, 6)]);
  });
  it('combineMasks replace/add/subtract and empty -> null', () => {
    const a = rectMask(4, 4, 0, 0, 1, 1);
    const b = rectMask(4, 4, 1, 1, 2, 2);
    expect(maskCount(combineMasks(a, b, 'add')!)).toBe(7);
    expect(maskCount(combineMasks(a, b, 'subtract')!)).toBe(3);
    expect(maskCount(combineMasks(a, b, 'replace')!)).toBe(4);
    expect(combineMasks(a, a, 'subtract')).toBeNull();
    expect(combineMasks(null, b, 'subtract')).toBeNull();
    expect(maskCount(combineMasks(null, b, 'add')!)).toBe(4);
  });
  it('invertMask selects everything when nothing was selected, and null when full', () => {
    expect(maskCount(invertMask(null, 3, 3)!)).toBe(9);
    expect(invertMask(allMask(3, 3), 3, 3)).toBeNull();
    expect(maskCount(invertMask(rectMask(3, 3, 0, 0, 0, 0), 3, 3)!)).toBe(8);
  });
  it('colorMask selects all pixels of a color, with tolerance', () => {
    const red = packRGBA(255, 0, 0), near = packRGBA(250, 0, 0), blue = packRGBA(0, 0, 255);
    const img = Uint32Array.of(red, blue, red, near);
    expect(maskCount(colorMask(img, red, 0))).toBe(2);
    expect(maskCount(colorMask(img, red, 5))).toBe(3);
  });
  it('maskEdges traces the perimeter of a rectangle as 4 merged segments', () => {
    const e = maskEdges(rectMask(6, 6, 1, 1, 3, 2), 6, 6);
    expect(e.length / 4).toBe(4);
  });
});

describe('transforms', () => {
  const img = Uint32Array.of(1, 2, 3, 4, 5, 6); // 3x2
  it('flips', () => {
    expect([...flipH(img, 3, 2)]).toEqual([3, 2, 1, 6, 5, 4]);
    expect([...flipV(img, 3, 2)]).toEqual([4, 5, 6, 1, 2, 3]);
  });
  it('rotates 90 degrees and four rotations return the original', () => {
    expect([...rotate90(img, 3, 2, true)]).toEqual([4, 1, 5, 2, 6, 3]);
    expect([...rotate90(img, 3, 2, false)]).toEqual([3, 6, 2, 5, 1, 4]);
    let r = img;
    let w = 3, h = 2;
    for (let i = 0; i < 4; i++) { r = rotate90(r, w, h, true); [w, h] = [h, w]; }
    expect([...r]).toEqual([...img]);
  });
  it('resize places the image at the offset and crops overflow', () => {
    expect([...resizeCel(img, 3, 2, 4, 3, 1, 1)]).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 0, 4, 5, 6]);
    expect([...resizeCel(img, 3, 2, 2, 1, 0, 0)]).toEqual([1, 2]);
  });
  it('scale is nearest-neighbor, crop extracts a rect', () => {
    expect([...scaleCel(Uint32Array.of(1, 2), 2, 1, 4, 2)]).toEqual([1, 1, 2, 2, 1, 1, 2, 2]);
    expect([...cropCel(img, 3, { x: 1, y: 0, w: 2, h: 2 })]).toEqual([2, 3, 5, 6]);
  });
  it('project-level ops update dimensions and every cel', () => {
    const p = createProject({ width: 4, height: 2 });
    const layerId = p.layers[0]!.id;
    p.frames[0]!.cels.get(layerId)![0] = 7;
    rotateProject(p, true);
    expect([p.width, p.height]).toEqual([2, 4]);
    expect(p.frames[0]!.cels.get(layerId)!.length).toBe(8);
    flipProject(p, 'h');
    expect(resizeProject(p, 10, 10, 0.5, 0.5)).toBe(true);
    expect(resizeProject(p, 10, 10, 0.5, 0.5)).toBe(false);
    expect(scaleProject(p, 5, 5)).toBe(true);
    expect(p.frames[0]!.cels.get(layerId)!.length).toBe(25);
  });
  it('trim crops to content across layers and frames; blank projects are untouched', () => {
    const p = createProject({ width: 8, height: 8 });
    expect(trimProject(p)).toBe(false);
    const cel = p.frames[0]!.cels.get(p.layers[0]!.id)!;
    cel[2 * 8 + 3] = packRGBA(1, 1, 1);
    cel[4 * 8 + 5] = packRGBA(1, 1, 1);
    expect(trimProject(p)).toBe(true);
    expect([p.width, p.height]).toEqual([3, 3]);
    expect(p.frames[0]!.cels.get(p.layers[0]!.id)![0]).not.toBe(0);
  });
  it('cropProject rejects empty or no-op rects', () => {
    const p = createProject({ width: 4, height: 4 });
    expect(cropProject(p, { x: 0, y: 0, w: 4, h: 4 })).toBe(false);
    expect(cropProject(p, { x: 10, y: 10, w: 2, h: 2 })).toBe(false);
    expect(cropProject(p, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
  });
});

describe('fonts', () => {
  it('every glyph is well-formed in both fonts', () => {
    for (let c = 32; c < 127; c++) {
      const ch = String.fromCharCode(c).toUpperCase();
      for (const font of ['3x5', '5x7'] as const) {
        expect(hasGlyph(font, ch), `${font} missing ${JSON.stringify(ch)}`).toBe(true);
        const rows = glyphRows(font, ch)!;
        expect(rows.length).toBe(FONT_SIZES[font].h);
        if (font === '5x7') for (const r of rows) expect(r).toMatch(/^[#.]{5}$/);
        else for (const r of rows) expect(r).toMatch(/^[0-7]$/);
      }
    }
  });
  it('renders sized bitmaps with spacing, lines and scale', () => {
    const a = renderText('A', '3x5');
    expect([a.w, a.h]).toEqual([3, 5]);
    expect([...a.on.slice(0, 3)]).toEqual([0, 1, 0]);
    const ab = renderText('AB', '5x7');
    expect([ab.w, ab.h]).toEqual([11, 7]);
    expect(renderText('A\nB', '3x5').h).toBe(11);
    expect(renderText('A', '3x5', 3).w).toBe(9);
  });
  it('lowercase renders like uppercase and unknown characters fall back to "?"', () => {
    expect([...renderText('a', '5x7').on]).toEqual([...renderText('A', '5x7').on]);
    expect([...renderText('é', '3x5').on]).toEqual([...renderText('?', '3x5').on]);
  });
});
