import { describe, expect, it } from 'vitest';
import { Editor } from '../src/core/editor';
import { packRGBA } from '../src/core/pixels';
import { createProject } from '../src/core/project';

const RED = packRGBA(255, 0, 0);
const BLUE = packRGBA(0, 0, 255);

function setup(w = 16, h = 16) {
  const e = new Editor(createProject({ width: w, height: h }));
  const cel = () => e.project.frames[0]!.cels.get(e.project.layers[0]!.id)!;
  return { e, cel };
}

describe('Editor', () => {
  it('pencil stroke draws a gap-free line and is one undo step', () => {
    const { e, cel } = setup();
    e.setPrimary(RED);
    e.pointerDown(0, 0, 'primary');
    e.pointerMove(10, 4);
    e.pointerUp();
    expect(cel().filter((v) => v === RED).length).toBe(11);
    e.undo();
    expect(cel().every((v) => v === 0)).toBe(true);
    e.redo();
    expect(cel().filter((v) => v === RED).length).toBe(11);
  });

  it('right button draws with the secondary color', () => {
    const { e, cel } = setup();
    e.setSecondary(BLUE);
    e.pointerDown(3, 3, 'secondary');
    e.pointerUp();
    expect(cel()[3 * 16 + 3]).toBe(BLUE);
  });

  it('eraser clears pixels', () => {
    const { e, cel } = setup();
    e.setPrimary(RED);
    e.pointerDown(2, 2, 'primary');
    e.pointerUp();
    e.setTool('eraser');
    e.pointerDown(2, 2, 'primary');
    e.pointerUp();
    expect(cel()[2 * 16 + 2]).toBe(0);
  });

  it('strokes may leave and re-enter the canvas without errors', () => {
    const { e, cel } = setup(8, 8);
    e.setPrimary(RED);
    e.pointerDown(1, 1, 'primary');
    e.pointerMove(-20, 1);
    e.pointerMove(5, 1);
    e.pointerUp();
    expect(cel()[1 * 8 + 5]).toBe(RED);
  });

  it('bucket fill respects the option set and is undoable', () => {
    const { e, cel } = setup(4, 4);
    e.setPrimary(RED);
    e.setTool('bucket');
    e.pointerDown(0, 0, 'primary');
    expect(cel().every((v) => v === RED)).toBe(true);
    e.undo();
    expect(cel().every((v) => v === 0)).toBe(true);
  });

  it('bucket fill on an already-matching area adds no history', () => {
    const { e } = setup(4, 4);
    e.setPrimary(0);
    e.setTool('bucket');
    e.pointerDown(0, 0, 'primary');
    expect(e.history.canUndo).toBe(false);
  });

  it('picker (and Alt+click) sets the primary color without history', () => {
    const { e } = setup();
    e.setPrimary(RED);
    e.pointerDown(5, 5, 'primary');
    e.pointerUp();
    e.setPrimary(BLUE);
    e.pointerDown(5, 5, 'primary', { alt: true });
    expect(e.primary).toBe(RED);
    expect(e.tool).toBe('pencil');
  });

  it('does not draw on locked or hidden layers', () => {
    const { e, cel } = setup();
    e.project.layers[0]!.locked = true;
    e.setPrimary(RED);
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    expect(cel().every((v) => v === 0)).toBe(true);
    e.project.layers[0]!.locked = false;
    e.project.layers[0]!.visible = false;
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    expect(cel().every((v) => v === 0)).toBe(true);
  });

  it('records recent colors, most recent first, max 16, no duplicates', () => {
    const { e } = setup(64, 4);
    for (let i = 0; i < 20; i++) {
      e.setPrimary(packRGBA(i, 0, 0));
      e.pointerDown(i, 0, 'primary');
      e.pointerUp();
    }
    expect(e.recent.length).toBe(16);
    expect(e.recent[0]).toBe(packRGBA(19, 0, 0));
    e.setPrimary(packRGBA(10, 0, 0));
    e.pointerDown(30, 1, 'primary');
    e.pointerUp();
    expect(e.recent[0]).toBe(packRGBA(10, 0, 0));
    expect(new Set(e.recent).size).toBe(e.recent.length);
  });

  it('survives 250 strokes of undo and redo with identical pixels (>= 200 steps)', () => {
    const { e, cel } = setup(64, 64);
    const snapshots = [cel().slice()];
    for (let i = 0; i < 250; i++) {
      e.setPrimary(packRGBA(i % 256, (i * 7) % 256, 50));
      e.pointerDown(i % 64, (i * 3) % 64, 'primary');
      e.pointerMove((i * 5) % 64, (i * 11) % 64);
      e.pointerUp();
      snapshots.push(cel().slice());
    }
    for (let i = 249; i >= 0; i--) {
      e.undo();
      expect(cel()).toEqual(snapshots[i]);
    }
    for (let i = 1; i <= 250; i++) {
      e.redo();
      expect(cel()).toEqual(snapshots[i]);
    }
  });

  it('newProject resets history', () => {
    const { e } = setup();
    e.pointerDown(0, 0, 'primary');
    e.pointerUp();
    e.newProject({ width: 8, height: 8, background: RED });
    expect(e.history.canUndo).toBe(false);
    expect(e.project.frames[0]!.cels.values().next().value![0]).toBe(RED);
  });
});
