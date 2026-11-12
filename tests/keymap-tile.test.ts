import { describe, expect, it } from 'vitest';
import { Editor } from '../src/core/editor';
import {
  ACTIONS, defaultBindings, findConflict, isBindable, lookupAction, normalizeKey, overridesOf, resolveBindings,
} from '../src/core/keymap';
import { packRGBA } from '../src/core/pixels';
import { createProject } from '../src/core/project';

describe('keymap', () => {
  it('normalizes key events', () => {
    expect(normalizeKey({ key: 'B' })).toBe('b');
    expect(normalizeKey({ key: 'z', ctrlKey: true })).toBe('ctrl+z');
    expect(normalizeKey({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+z');
    expect(normalizeKey({ key: '?', shiftKey: true })).toBe('?');
    expect(normalizeKey({ key: ' ' })).toBe('space');
    expect(normalizeKey({ key: 'Shift', shiftKey: true })).toBe('');
  });

  it('has unique default keys and every tool has an action', () => {
    const keys = Object.values(defaultBindings()).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of ['pencil', 'eraser', 'bucket', 'picker', 'line', 'rect', 'ellipse', 'gradient', 'shading', 'dither', 'select', 'lasso', 'wand', 'move', 'text']) {
      expect(ACTIONS.some((a) => a.id === `tool:${t}`)).toBe(true);
    }
    expect(lookupAction(defaultBindings(), 'b')).toBe('tool:pencil');
  });

  it('applies overrides, ignores bad ones, resolves collisions, and reports conflicts', () => {
    const b = resolveBindings({ 'tool:pencil': 'k', 'tool:eraser': 'ctrl+e', nope: 'z', 'tool:line': 5, 'tool:text': 'enter' });
    expect(b['tool:pencil']).toBe('k');
    expect(b['tool:eraser']).toBe('e');
    expect(b['tool:text']).toBe('t');
    expect(b.nope).toBeUndefined();
    const dup = resolveBindings({ 'tool:pencil': 'e' });
    expect(dup['tool:pencil']).toBe('e');
    expect(dup['tool:eraser']).toBe('');
    expect(findConflict(defaultBindings(), 'tool:pencil', 'e')).toBe('tool:eraser');
    expect(findConflict(defaultBindings(), 'tool:eraser', 'e')).toBeNull();
    expect(overridesOf(b)).toEqual({ 'tool:pencil': 'k' });
    expect(resolveBindings(null)).toEqual(defaultBindings());
  });

  it('only allows sane keys', () => {
    expect(isBindable('k')).toBe(true);
    expect(isBindable('shift+k')).toBe(true);
    expect(isBindable('ctrl+k')).toBe(false);
    expect(isBindable('space')).toBe(false);
    expect(isBindable('')).toBe(true);
  });
});

describe('tile mode', () => {
  const RED = packRGBA(255, 0, 0);
  it('wraps drawing around the canvas edges', () => {
    const e = new Editor(createProject({ width: 8, height: 8 }));
    e.setPrimary(RED);
    e.setOptions({ size: 3 });
    e.setTileMode(true);
    e.pointerDown(0, 0, 'primary');
    e.pointerUp();
    const cel = e.project.frames[0]!.cels.get(e.project.layers[0]!.id)!;
    expect(cel[0]).toBe(RED);
    expect(cel[7]).toBe(RED); // wrapped to the right edge
    expect(cel[7 * 8]).toBe(RED); // wrapped to the bottom
    expect(cel[63]).toBe(RED); // wrapped corner
    e.undo();
    expect(cel.every((v) => v === 0)).toBe(true);
    e.setTileMode(false);
    e.pointerDown(0, 0, 'primary');
    e.pointerUp();
    expect(cel[7]).toBe(0);
  });

  it('lines crossing an edge wrap too', () => {
    const e = new Editor(createProject({ width: 8, height: 8 }));
    e.setPrimary(RED);
    e.setTool('line');
    e.setTileMode(true);
    e.pointerDown(6, 4, 'primary');
    e.pointerMove(10, 4, {});
    e.pointerUp();
    const cel = e.project.frames[0]!.cels.get(e.project.layers[0]!.id)!;
    expect([0, 1, 2, 6, 7].map((x) => cel[4 * 8 + x])).toEqual([RED, RED, RED, RED, RED]);
  });

  it('abortStroke restores the pixels and revision counts changes', () => {
    const e = new Editor(createProject({ width: 4, height: 4 }));
    const r0 = e.revision;
    e.setPrimary(RED);
    e.pointerDown(1, 1, 'primary');
    e.abortStroke();
    const cel = e.project.frames[0]!.cels.get(e.project.layers[0]!.id)!;
    expect(cel.every((v) => v === 0)).toBe(true);
    expect(e.canUndo).toBe(false);
    e.pointerDown(1, 1, 'primary');
    e.pointerUp();
    expect(e.revision).toBeGreaterThan(r0);
    const p = createProject({ width: 2, height: 2 });
    e.openProject(p);
    expect(e.project).toBe(p);
    expect(e.canUndo).toBe(false);
  });
});
