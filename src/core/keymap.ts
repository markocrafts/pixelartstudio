export interface ActionDef {
  id: string;
  label: string;
  group: 'Tools' | 'View' | 'Animation' | 'Colors' | 'Fixed';
  /** Default key string ('' = unbound). */
  key: string;
  /** Shown in the cheat sheet but not rebindable. */
  fixed?: boolean;
}

export const ACTIONS: ActionDef[] = [
  { id: 'tool:pencil', label: 'Pencil', group: 'Tools', key: 'b' },
  { id: 'tool:eraser', label: 'Eraser', group: 'Tools', key: 'e' },
  { id: 'tool:bucket', label: 'Fill', group: 'Tools', key: 'g' },
  { id: 'tool:picker', label: 'Color picker', group: 'Tools', key: 'i' },
  { id: 'tool:line', label: 'Line', group: 'Tools', key: 'l' },
  { id: 'tool:rect', label: 'Rectangle', group: 'Tools', key: 'u' },
  { id: 'tool:ellipse', label: 'Ellipse', group: 'Tools', key: 'o' },
  { id: 'tool:gradient', label: 'Gradient', group: 'Tools', key: '' },
  { id: 'tool:shading', label: 'Shading', group: 'Tools', key: '' },
  { id: 'tool:dither', label: 'Dither', group: 'Tools', key: '' },
  { id: 'tool:select', label: 'Rectangle select', group: 'Tools', key: 'm' },
  { id: 'tool:lasso', label: 'Lasso', group: 'Tools', key: 'q' },
  { id: 'tool:wand', label: 'Magic wand', group: 'Tools', key: 'w' },
  { id: 'tool:move', label: 'Move', group: 'Tools', key: 'v' },
  { id: 'tool:text', label: 'Text', group: 'Tools', key: 't' },
  { id: 'swapColors', label: 'Swap primary / secondary', group: 'Colors', key: 'x' },
  { id: 'centerView', label: 'Center canvas', group: 'View', key: '0' },
  { id: 'zoomIn', label: 'Zoom in', group: 'View', key: '+' },
  { id: 'zoomOut', label: 'Zoom out', group: 'View', key: '-' },
  { id: 'prevFrame', label: 'Previous frame', group: 'Animation', key: ',' },
  { id: 'nextFrame', label: 'Next frame', group: 'Animation', key: '.' },
  { id: 'togglePlay', label: 'Play / pause preview', group: 'Animation', key: 'p' },
  { id: 'toggleTile', label: 'Toggle tile mode', group: 'View', key: 'h' },
  { id: 'cheatsheet', label: 'Show shortcuts', group: 'View', key: '?' },
  { id: 'fixed:undo', label: 'Undo', group: 'Fixed', key: 'ctrl+z', fixed: true },
  { id: 'fixed:redo', label: 'Redo', group: 'Fixed', key: 'ctrl+y / ctrl+shift+z', fixed: true },
  { id: 'fixed:all', label: 'Select all / deselect', group: 'Fixed', key: 'ctrl+a / ctrl+d', fixed: true },
  { id: 'fixed:inv', label: 'Invert selection', group: 'Fixed', key: 'ctrl+shift+i', fixed: true },
  { id: 'fixed:clip', label: 'Copy / cut / paste', group: 'Fixed', key: 'ctrl+c / ctrl+x / ctrl+v', fixed: true },
  { id: 'fixed:del', label: 'Clear selection', group: 'Fixed', key: 'delete', fixed: true },
  { id: 'fixed:commit', label: 'Commit / close polygon', group: 'Fixed', key: 'enter', fixed: true },
  { id: 'fixed:cancel', label: 'Cancel / deselect', group: 'Fixed', key: 'escape', fixed: true },
  { id: 'fixed:pan', label: 'Pan', group: 'Fixed', key: 'space + drag / middle mouse', fixed: true },
  { id: 'fixed:nudge', label: 'Nudge (Move tool)', group: 'Fixed', key: 'arrows (shift = 10)', fixed: true },
  { id: 'fixed:alt', label: 'Pick color while drawing', group: 'Fixed', key: 'alt + click', fixed: true },
];

export type Bindings = Record<string, string>;

/** Canonical key string for a keyboard event: modifiers in a fixed order, then the lowercase key. */
export function normalizeKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string {
  let k = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (k === 'esc') k = 'escape';
  if (['control', 'shift', 'alt', 'meta'].includes(k)) return '';
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : ''];
  // Shift is already part of printable symbols such as '?' or '+', so only keep it for letters and named keys.
  if (e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k))) mods.push('shift');
  return [...mods.filter(Boolean), k].join('+');
}

export function defaultBindings(): Bindings {
  return Object.fromEntries(ACTIONS.filter((a) => !a.fixed).map((a) => [a.id, a.key]));
}

const RESERVED = new Set(['space', 'enter', 'escape', 'delete', 'backspace', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** Whether a key string may be bound to an action (no modifiers except shift, nothing reserved). */
export function isBindable(key: string): boolean {
  if (key === '') return true;
  if (/(^|\+)(ctrl|alt)\+/.test(key) || RESERVED.has(key)) return false;
  return key.length <= 12;
}

/** Defaults overlaid with saved overrides; unknown actions and unusable keys are ignored. */
export function resolveBindings(overrides: unknown): Bindings {
  const out = defaultBindings();
  if (typeof overrides !== 'object' || overrides === null) return out;
  for (const [id, key] of Object.entries(overrides)) {
    if (id in out && typeof key === 'string' && isBindable(key)) out[id] = key;
  }
  // A saved layout may collide (e.g. after new defaults were added): the later action loses its key.
  const used = new Map<string, string>();
  for (const id of Object.keys(out)) {
    const k = out[id]!;
    if (!k) continue;
    if (used.has(k)) out[id] = '';
    else used.set(k, id);
  }
  return out;
}

/** The action already using `key`, if it is not `exceptId`. */
export function findConflict(b: Bindings, exceptId: string, key: string): string | null {
  if (!key) return null;
  for (const [id, k] of Object.entries(b)) if (id !== exceptId && k === key) return id;
  return null;
}

export function lookupAction(b: Bindings, key: string): string | null {
  if (!key) return null;
  for (const [id, k] of Object.entries(b)) if (k === key) return id;
  return null;
}

export function overridesOf(b: Bindings): Bindings {
  const d = defaultBindings();
  return Object.fromEntries(Object.entries(b).filter(([id, k]) => d[id] !== k));
}
