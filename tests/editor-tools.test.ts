import { describe, expect, it } from 'vitest';
import { Editor } from '../src/core/editor';
import { packRGBA } from '../src/core/pixels';
import { createProject } from '../src/core/project';

const RED = packRGBA(255, 0, 0);
const BLUE = packRGBA(0, 0, 255);
const WHITE = packRGBA(255, 255, 255);

function setup(w = 16, h = 16) {
  const e = new Editor(createProject({ width: w, height: h }));
  const cel = () => e.project.frames[0]!.cels.get(e.project.layers[0]!.id)!;
  const at = (x: number, y: number) => cel()[y * e.project.width + x]!;
  const count = (c: number) => cel().filter((v) => v === c).length;
  const drag = (x0: number, y0: number, x1: number, y1: number, mods = {}) => {
    e.pointerDown(x0, y0, 'primary', mods);
    e.pointerMove(x1, y1, mods);
    e.pointerUp();
  };
  e.setPrimary(RED);
  return { e, cel, at, count, drag };
}

describe('shape tools', () => {
  it('line draws and Shift snaps to 15 degrees', () => {
    const { e, count, at, drag } = setup();
    e.setTool('line');
    drag(1, 1, 9, 2, { shift: true }); // ~7 degrees snaps to 0
    expect(at(9, 1)).toBe(RED);
    expect(at(9, 2)).toBe(0);
    expect(count(RED)).toBe(9);
  });
  it('rectangle outline vs filled, Shift makes a square, one undo step', () => {
    const { e, count, drag } = setup();
    e.setTool('rect');
    drag(2, 2, 6, 5);
    expect(count(RED)).toBe(14);
    e.undo();
    expect(count(RED)).toBe(0);
    e.setOptions({ filled: true });
    drag(2, 2, 6, 3, { shift: true });
    expect(count(RED)).toBe(25); // 5x5
  });
  it('the shape preview follows the pointer and leaves no trail', () => {
    const { e, count } = setup();
    e.setTool('rect');
    e.pointerDown(1, 1, 'primary');
    e.pointerMove(10, 10);
    e.pointerMove(3, 3);
    e.pointerUp();
    expect(count(RED)).toBe(8); // only the final 3x3 outline
  });
  it('ellipse draws something symmetric', () => {
    const { e, at, drag } = setup();
    e.setTool('ellipse');
    drag(2, 2, 11, 7);
    for (let y = 2; y <= 7; y++) for (let x = 2; x <= 11; x++) expect(at(x, y)).toBe(at(13 - x, y));
  });
  it('gradient fills the layer between primary and secondary and is undoable', () => {
    const { e, at, count } = setup(8, 1);
    e.setSecondary(BLUE);
    e.setTool('gradient');
    e.setOptions({ gradientPattern: 'none' });
    e.pointerDown(0, 0, 'primary');
    e.pointerMove(7, 0);
    e.pointerUp();
    expect(at(0, 0)).toBe(RED);
    expect(at(7, 0)).toBe(BLUE);
    e.undo();
    expect(count(0)).toBe(8);
  });
});

describe('pencil options', () => {
  it('pixel-perfect removes L corners from a drawn staircase', () => {
    const { e, count } = setup();
    e.setOptions({ pixelPerfect: true });
    e.pointerDown(0, 0, 'primary');
    e.pointerMove(1, 0);
    e.pointerMove(1, 1);
    e.pointerMove(2, 1);
    e.pointerMove(2, 2);
    e.pointerUp();
    expect(count(RED)).toBe(3); // diagonal only
    e.undo();
    expect(count(RED)).toBe(0);
  });
  it('without pixel-perfect the staircase keeps its corners', () => {
    const { e, count } = setup();
    e.pointerDown(0, 0, 'primary');
    e.pointerMove(1, 0);
    e.pointerMove(1, 1);
    e.pointerUp();
    expect(count(RED)).toBe(3);
  });
  it('pressure scales the brush size only when enabled', () => {
    const a = setup();
    a.e.setOptions({ size: 8, pressureSize: true });
    a.e.pointerDown(8, 8, 'primary', {}, 0.25);
    a.e.pointerUp();
    expect(a.count(RED)).toBe(4); // round(8*0.25)=2 -> 2x2
    const b = setup();
    b.e.setOptions({ size: 8 });
    b.e.pointerDown(8, 8, 'primary', {}, 0.25);
    b.e.pointerUp();
    expect(b.count(RED)).toBe(64);
  });
});

describe('symmetry', () => {
  it('pencil strokes are mirrored and undo as one step', () => {
    const { e, at, count } = setup(8, 8);
    e.setSymmetry({ x: true, y: true });
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    expect([at(1, 1), at(6, 1), at(1, 6), at(6, 6)]).toEqual([RED, RED, RED, RED]);
    expect(count(RED)).toBe(4);
    e.undo();
    expect(count(RED)).toBe(0);
  });
  it('shape tools mirror too, and the axis can move', () => {
    const { e, at, drag } = setup(8, 8);
    e.setTool('line');
    e.setSymmetry({ x: true, axisX: 2 });
    drag(0, 0, 1, 0);
    expect([at(0, 0), at(1, 0), at(2, 0), at(3, 0)]).toEqual([RED, RED, RED, RED]);
  });
});

describe('selection', () => {
  it('rectangle selection, with Shift to add and Alt to subtract', () => {
    const { e, drag } = setup();
    e.setTool('select');
    drag(1, 1, 3, 3);
    expect(e.selection!.filter(Boolean).length).toBe(9);
    drag(6, 6, 7, 7, { shift: true });
    expect(e.selection!.filter(Boolean).length).toBe(13);
    drag(1, 1, 1, 3, { alt: true });
    expect(e.selection!.filter(Boolean).length).toBe(10);
    e.pointerDown(12, 12, 'primary'); // click clears
    e.pointerUp();
    expect(e.selection).toBeNull();
  });
  it('lasso (freehand) and polygon lasso select regions', () => {
    const { e } = setup();
    e.setTool('lasso');
    e.pointerDown(2, 2, 'primary');
    for (const [x, y] of [[8, 2], [8, 8], [2, 8]] as const) e.pointerMove(x, y);
    e.pointerUp();
    expect(e.selection![5 * 16 + 5]).toBe(1);
    expect(e.selection![12 * 16 + 12]).toBe(0);
    e.deselect();
    e.setOptions({ lassoPolygon: true });
    for (const [x, y] of [[2, 2], [8, 2], [8, 8]] as const) { e.pointerDown(x, y, 'primary'); e.pointerUp(); }
    e.polygonClose();
    expect(e.selection![3 * 16 + 7]).toBe(1);
    expect(e.selection![8 * 16 + 2]).toBe(0);
  });
  it('magic wand: contiguous and by-color', () => {
    const { e, drag } = setup();
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(0, 0, 3, 3);
    drag(10, 10, 12, 12);
    e.setTool('wand');
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    expect(e.selection!.filter(Boolean).length).toBe(16);
    e.setOptions({ wandContiguous: false });
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    expect(e.selection!.filter(Boolean).length).toBe(25);
  });
  it('select all, invert, deselect and select-by-color', () => {
    const { e, drag } = setup(8, 8);
    e.selectAll();
    expect(e.selection!.filter(Boolean).length).toBe(64);
    e.invertSelection();
    expect(e.selection).toBeNull();
    e.deselect();
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(0, 0, 1, 1);
    e.selectByColor(RED);
    expect(e.selection!.filter(Boolean).length).toBe(4);
    e.invertSelection();
    expect(e.selection!.filter(Boolean).length).toBe(60);
  });
  it('drawing is clipped to the selection', () => {
    const { e, count, drag } = setup();
    e.setTool('select');
    drag(4, 4, 7, 7);
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(0, 0, 15, 15);
    expect(count(RED)).toBe(16);
    e.setTool('bucket');
    e.setPrimary(BLUE);
    e.pointerDown(5, 5, 'primary');
    expect(count(BLUE)).toBe(16);
    expect(count(0)).toBe(256 - 16);
  });
  it('Delete clears only the selection; Cut and Paste round-trip', () => {
    const { e, at, count, drag } = setup();
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(2, 2, 5, 5);
    e.setTool('select');
    drag(2, 2, 3, 3);
    e.cut();
    expect(count(RED)).toBe(12);
    expect(e.paste(8, 8)).toBe(true);
    expect(e.tool).toBe('move');
    expect(at(8, 8)).toBe(RED);
    expect(at(9, 9)).toBe(RED);
    e.commitFloating();
    expect(count(RED)).toBe(16);
    e.undo(); // undo paste
    expect(count(RED)).toBe(12);
    e.undo(); // undo cut
    expect(count(RED)).toBe(16);
    e.setTool('select');
    drag(2, 2, 3, 3);
    e.deleteSelection();
    expect(count(RED)).toBe(12);
  });
});

describe('move and floating selections', () => {
  it('dragging moves the selected pixels and commits as one history step', () => {
    const { e, at, count, drag } = setup();
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(2, 2, 3, 3);
    e.setTool('select');
    drag(2, 2, 3, 3);
    e.setTool('move');
    e.pointerDown(2, 2, 'primary');
    e.pointerMove(5, 6);
    e.pointerUp();
    expect(at(2, 2)).toBe(0);
    expect(at(5, 6)).toBe(RED);
    expect(e.selection![6 * 16 + 5]).toBe(1);
    e.commitFloating();
    expect(count(RED)).toBe(4);
    e.undo();
    expect(at(2, 2)).toBe(RED);
    expect(at(5, 6)).toBe(0);
  });
  it('undo while floating cancels the move without touching history', () => {
    const { e, at, drag } = setup();
    e.setTool('rect');
    drag(2, 2, 4, 4);
    e.setTool('select');
    drag(2, 2, 4, 4);
    e.setTool('move');
    e.nudge(3, 0);
    expect(at(5, 2)).toBe(RED);
    e.undo();
    expect(at(2, 2)).toBe(RED);
    expect(at(5, 2)).toBe(0);
    expect(e.hasFloating).toBe(false);
    expect(e.selection![2 * 16 + 2]).toBe(1);
  });
  it('with no selection the Move tool shifts the whole layer', () => {
    const { e, at } = setup();
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    e.setTool('move');
    e.nudge(2, 3);
    e.commitFloating();
    expect(at(1, 1)).toBe(0);
    expect(at(3, 4)).toBe(RED);
    expect(e.selection).toBeNull();
  });
  it('pixels moved off the canvas are lost on commit but restored by undo', () => {
    const { e, count } = setup(8, 8);
    e.pointerDown(7, 7, 'primary');
    e.pointerUp();
    e.setTool('move');
    e.nudge(5, 5);
    e.commitFloating();
    expect(count(RED)).toBe(0);
    e.undo();
    expect(count(RED)).toBe(1);
  });
  it('starting another tool commits the floating selection', () => {
    const { e, at } = setup();
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    e.setTool('move');
    e.nudge(4, 0);
    e.setTool('pencil');
    expect(e.hasFloating).toBe(false);
    expect(at(5, 1)).toBe(RED);
    e.undo();
    expect(at(1, 1)).toBe(RED);
  });
  it('flip and rotate a selection', () => {
    const { e, at, drag } = setup();
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(2, 2, 3, 2); // 2x1 bar
    e.setPrimary(BLUE);
    e.setTool('pencil');
    e.pointerDown(2, 2, 'primary');
    e.pointerUp();
    e.setTool('select');
    drag(2, 2, 3, 2);
    e.transform('flipH');
    expect([at(2, 2), at(3, 2)]).toEqual([RED, BLUE]);
    e.transform('rotCW');
    expect(e.selection!.filter(Boolean).length).toBe(2);
    expect(e.hasFloating).toBe(false);
    e.undo();
    e.undo();
    expect([at(2, 2), at(3, 2)]).toEqual([BLUE, RED]);
  });
});

describe('custom brush', () => {
  it('captures a selection and stamps it with its own colors', () => {
    const { e, at, drag } = setup();
    e.setTool('rect');
    e.setOptions({ filled: true });
    drag(2, 2, 3, 3);
    e.setTool('select');
    drag(2, 2, 3, 3);
    expect(e.captureBrush()).toBe(true);
    expect(e.tool).toBe('pencil');
    e.deselect();
    e.setPrimary(BLUE);
    e.pointerDown(10, 10, 'primary');
    e.pointerUp();
    expect([at(9, 9), at(10, 10), at(11, 11)]).toEqual([RED, RED, 0]); // its own color; a 2x2 brush anchors at its lower-right pixel
    e.setOptions({ customTint: true });
    e.pointerDown(5, 12, 'primary');
    e.pointerUp();
    expect(at(5, 12)).toBe(BLUE);
  });
  it('capture fails without a selection', () => {
    expect(setup().e.captureBrush()).toBe(false);
  });
});

describe('shading, dither and text', () => {
  it('shading lightens each pixel once per stroke; right-click inverts', () => {
    const { e, at } = setup();
    e.setPrimary(packRGBA(100, 100, 100));
    e.pointerDown(3, 3, 'primary');
    e.pointerUp();
    e.setTool('shading');
    e.pointerDown(3, 3, 'primary');
    e.pointerMove(4, 3);
    e.pointerMove(3, 3); // back over the same pixel
    e.pointerUp();
    const once = at(3, 3) & 255;
    expect(once).toBeGreaterThan(100);
    e.pointerDown(3, 3, 'secondary'); // darken
    e.pointerUp();
    expect(at(3, 3) & 255).toBeLessThan(once);
  });
  it('shading ignores transparent pixels', () => {
    const { e, count } = setup();
    e.setTool('shading');
    e.pointerDown(3, 3, 'primary');
    e.pointerUp();
    expect(count(0)).toBe(256);
    expect(e.history.canUndo).toBe(false);
  });
  it('dither brush mixes primary and secondary by density', () => {
    const { e, cel, count } = setup(8, 8);
    e.setSecondary(BLUE);
    e.setTool('dither');
    e.setOptions({ size: 8, ditherPattern: 'bayer4', ditherDensity: 50 });
    e.pointerDown(3, 3, 'primary');
    e.pointerUp();
    expect(count(RED) + count(BLUE)).toBe(64);
    expect(count(RED)).toBe(32);
    expect(cel().length).toBe(64);
  });
  it('text stamps a bitmap at the click position as one undo step', () => {
    const { e, at, count } = setup(32, 16);
    e.setTool('text');
    e.setOptions({ text: 'A', font: '3x5' });
    e.pointerDown(4, 4, 'primary');
    e.pointerUp();
    expect(at(5, 4)).toBe(RED); // top of the A
    expect(at(4, 4)).toBe(0);
    expect(count(RED)).toBe(10);
    e.undo();
    expect(count(RED)).toBe(0);
  });
});

describe('canvas operations', () => {
  it('resize, scale, crop and trim are undoable structural steps', () => {
    const { e } = setup(8, 8);
    e.pointerDown(2, 2, 'primary');
    e.pointerUp();
    expect(e.resizeCanvas(12, 12, 0, 0)).toBe(true);
    expect([e.project.width, e.project.height]).toEqual([12, 12]);
    expect(e.trim()).toBe(true);
    expect([e.project.width, e.project.height]).toEqual([1, 1]);
    e.undo();
    expect([e.project.width, e.project.height]).toEqual([12, 12]);
    e.undo();
    expect([e.project.width, e.project.height]).toEqual([8, 8]);
    expect(e.project.frames[0]!.cels.get(e.project.layers[0]!.id)![2 * 8 + 2]).toBe(RED);
    e.redo();
    e.redo();
    expect([e.project.width, e.project.height]).toEqual([1, 1]);
  });
  it('crop to selection and canvas rotate change the size; selection is cleared', () => {
    const { e, drag } = setup(10, 6);
    e.setTool('select');
    drag(1, 1, 4, 3);
    expect(e.cropToSelection()).toBe(true);
    expect([e.project.width, e.project.height]).toEqual([4, 3]);
    expect(e.selection).toBeNull();
    e.transform('rotCW');
    expect([e.project.width, e.project.height]).toEqual([3, 4]);
    e.undo();
    e.undo();
    expect([e.project.width, e.project.height]).toEqual([10, 6]);
  });
  it('canvas flip with no selection mirrors the artwork', () => {
    const { e, at } = setup(8, 4);
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    e.transform('flipH');
    expect(at(6, 1)).toBe(RED);
    expect(at(1, 1)).toBe(0);
  });
  it('a selection from before a size change does not survive an undo that changes size', () => {
    const { e, drag } = setup(8, 8);
    e.resizeCanvas(4, 4, 0, 0);
    e.setTool('select');
    drag(0, 0, 3, 3);
    expect(e.selection).not.toBeNull();
    e.deselect();
    e.undo();
    expect(e.selection).toBeNull();
  });
  it('locked layers reject every drawing tool', () => {
    const { e, count } = setup();
    e.project.layers[0]!.locked = true;
    for (const t of ['pencil', 'line', 'rect', 'ellipse', 'gradient', 'bucket', 'text', 'shading', 'dither'] as const) {
      e.setTool(t);
      e.pointerDown(3, 3, 'primary');
      e.pointerMove(6, 6);
      e.pointerUp();
    }
    expect(count(0)).toBe(256);
    expect(count(WHITE)).toBe(0);
  });
});
