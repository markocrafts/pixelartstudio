import { describe, expect, it } from 'vitest';
import { History, diffCels } from '../src/core/history';
import { createProject } from '../src/core/project';
import { setPixel } from '../src/core/pixels';

describe('history', () => {
  it('diffCels returns null for identical cels and a tight rect otherwise', () => {
    const a = new Uint32Array(16);
    const b = a.slice();
    expect(diffCels('f', 'l', a, b, 4, 4)).toBeNull();
    setPixel(b, 4, 1, 2, 5);
    setPixel(b, 4, 3, 3, 6);
    const p = diffCels('f', 'l', a, b, 4, 4)!;
    expect([p.x, p.y, p.w, p.h]).toEqual([1, 2, 3, 2]);
    expect(p.before.length).toBe(6);
  });

  it('undo and redo restore exact pixels', () => {
    const project = createProject({ width: 8, height: 8 });
    const frame = project.frames[0]!;
    const layer = project.layers[0]!;
    const cel = frame.cels.get(layer.id)!;
    const h = new History();
    const original = cel.slice();
    const before = cel.slice();
    setPixel(cel, 8, 2, 2, 99);
    h.push({ label: 'x', patches: [diffCels(frame.id, layer.id, before, cel, 8, 8)!] });
    const edited = cel.slice();
    expect(h.undo(project)).toBe(true);
    expect(cel).toEqual(original);
    expect(h.redo(project)).toBe(true);
    expect(cel).toEqual(edited);
    expect(h.redo(project)).toBe(false);
  });

  it('pushing after undo clears the redo stack', () => {
    const h = new History();
    h.push({ label: 'a', patches: [] });
    h.push({ label: 'b', patches: [] });
    const project = createProject({ width: 1, height: 1 });
    h.undo(project);
    expect(h.canRedo).toBe(true);
    h.push({ label: 'c', patches: [] });
    expect(h.canRedo).toBe(false);
  });

  it('keeps at most `limit` entries', () => {
    const h = new History(3);
    for (let i = 0; i < 10; i++) h.push({ label: String(i), patches: [] });
    const project = createProject({ width: 1, height: 1 });
    let n = 0;
    while (h.undo(project)) n++;
    expect(n).toBe(3);
  });
});
