import type { Frame, FrameTag, LayerMeta, Project } from './project';

/** A changed rectangle of one cel, with the pixels before and after. */
export interface Patch {
  frameId: string;
  layerId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  before: Uint32Array;
  after: Uint32Array;
}

/** Full pixel state of a project's cels, used for operations that change canvas size. */
export interface ProjectSnapshot {
  width: number;
  height: number;
  cels: Array<{ frameId: string; layerId: string; data: Uint32Array }>;
}

export function snapshotProject(project: Project): ProjectSnapshot {
  const cels: ProjectSnapshot['cels'] = [];
  for (const f of project.frames) for (const [layerId, data] of f.cels) cels.push({ frameId: f.id, layerId, data: data.slice() });
  return { width: project.width, height: project.height, cels };
}

export function restoreSnapshot(project: Project, snap: ProjectSnapshot): void {
  project.width = snap.width;
  project.height = snap.height;
  for (const c of snap.cels) project.frames.find((f) => f.id === c.frameId)?.cels.set(c.layerId, c.data.slice());
}

/**
 * Layer list state for layer operations. `cels` holds private copies of only the cels the operation
 * created, removed or changed; cels of layers not listed there stay as they are.
 */
export interface LayerState {
  layers: LayerMeta[];
  active: number;
  cels: Array<{ frameId: string; layerId: string; data: Uint32Array }>;
}

export function applyLayerState(project: Project, s: LayerState): void {
  project.layers = s.layers.map((l) => ({ ...l }));
  const ids = new Set(project.layers.map((l) => l.id));
  for (const f of project.frames) for (const id of [...f.cels.keys()]) if (!ids.has(id)) f.cels.delete(id);
  for (const c of s.cels) project.frames.find((f) => f.id === c.frameId)?.cels.set(c.layerId, c.data.slice());
}

/**
 * Frame list state for frame operations. `cels` holds private copies of the cels (every layer) of frames
 * the operation created, removed or changed; frames not listed there keep their live cels.
 */
export interface FrameState {
  frames: Array<{ id: string; durationMs?: number }>;
  tags: FrameTag[];
  active: number;
  cels: Array<{ frameId: string; layerId: string; data: Uint32Array }>;
}

export function applyFrameState(project: Project, s: FrameState): void {
  const existing = new Map(project.frames.map((f) => [f.id, f]));
  project.frames = s.frames.map((m): Frame => {
    const f = existing.get(m.id) ?? { id: m.id, cels: new Map<string, Uint32Array>() };
    if (m.durationMs === undefined) delete f.durationMs; else f.durationMs = m.durationMs;
    return f;
  });
  project.tags = s.tags.map((t) => ({ ...t }));
  for (const c of s.cels) project.frames.find((f) => f.id === c.frameId)?.cels.set(c.layerId, c.data.slice());
}

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  /** Set for size-changing operations; takes precedence over patches. */
  states?: { before: ProjectSnapshot; after: ProjectSnapshot };
  /** Set for layer operations (add, delete, reorder, merge, properties...). */
  layerStates?: { before: LayerState; after: LayerState };
  /** Set for frame operations (add, duplicate, delete, reorder, duration, tags, cel paste...). */
  frameStates?: { before: FrameState; after: FrameState };
}

/** Diffs two versions of a cel. Returns null when nothing changed. */
export function diffCels(frameId: string, layerId: string, before: Uint32Array, after: Uint32Array, width: number, height: number): Patch | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (before[row + x] !== after[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const b = new Uint32Array(w * h);
  const a = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (minY + y) * width + minX;
    b.set(before.subarray(src, src + w), y * w);
    a.set(after.subarray(src, src + w), y * w);
  }
  return { frameId, layerId, x: minX, y: minY, w, h, before: b, after: a };
}

export function applyPatch(project: Project, patch: Patch, direction: 'undo' | 'redo'): void {
  const cel = project.frames.find((f) => f.id === patch.frameId)?.cels.get(patch.layerId);
  if (!cel) return;
  const data = direction === 'undo' ? patch.before : patch.after;
  for (let y = 0; y < patch.h; y++) {
    cel.set(data.subarray(y * patch.w, (y + 1) * patch.w), (patch.y + y) * project.width + patch.x);
  }
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  /** Active layer index stored by the layer operation applied by the last undo/redo, if any. */
  lastActive: number | undefined;
  /** Same, for the active frame index. */
  lastActiveFrame: number | undefined;

  constructor(private readonly limit = 500) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | undefined { return this.undoStack[this.undoStack.length - 1]?.label; }
  get redoLabel(): string | undefined { return this.redoStack[this.redoStack.length - 1]?.label; }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(project: Project): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.lastActive = undefined;
    this.lastActiveFrame = undefined;
    if (e.frameStates) { applyFrameState(project, e.frameStates.before); this.lastActiveFrame = e.frameStates.before.active; }
    else if (e.layerStates) { applyLayerState(project, e.layerStates.before); this.lastActive = e.layerStates.before.active; }
    else if (e.states) restoreSnapshot(project, e.states.before);
    else for (let i = e.patches.length - 1; i >= 0; i--) applyPatch(project, e.patches[i]!, 'undo');
    this.redoStack.push(e);
    return true;
  }

  redo(project: Project): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.lastActive = undefined;
    this.lastActiveFrame = undefined;
    if (e.frameStates) { applyFrameState(project, e.frameStates.after); this.lastActiveFrame = e.frameStates.after.active; }
    else if (e.layerStates) { applyLayerState(project, e.layerStates.after); this.lastActive = e.layerStates.after.active; }
    else if (e.states) restoreSnapshot(project, e.states.after);
    else for (const p of e.patches) applyPatch(project, p, 'redo');
    this.undoStack.push(e);
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
