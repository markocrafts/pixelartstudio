/** UI preferences persisted in localStorage. Every access is guarded: storage can be blocked or full. */
export type Theme = 'dark' | 'light';

export interface Prefs {
  theme: Theme;
  tool: string;
  primary: number;
  secondary: number;
  options: Record<string, unknown>;
  grid: { show: boolean; w: number; h: number; color: string };
  sideOpen: boolean | null;
  timelineOpen: boolean | null;
  onion: { enabled: boolean; prev: number; next: number; opacity: number } | null;
  keys: Record<string, string>;
  zoomGrid: boolean;
}

const KEY = 'pixelforge.prefs';

export const defaultPrefs = (): Prefs => ({
  theme: 'dark', tool: 'pencil', primary: 0xff000000, secondary: 0xffffffff, options: {},
  grid: { show: true, w: 0, h: 0, color: '#ff4081' }, sideOpen: null, timelineOpen: null, onion: null, keys: {}, zoomGrid: true,
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadPrefs(): Prefs {
  const d = defaultPrefs();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (!isObj(raw)) return d;
    if (raw.theme === 'light' || raw.theme === 'dark') d.theme = raw.theme;
    if (typeof raw.tool === 'string') d.tool = raw.tool;
    if (typeof raw.primary === 'number') d.primary = raw.primary >>> 0;
    if (typeof raw.secondary === 'number') d.secondary = raw.secondary >>> 0;
    if (isObj(raw.options)) d.options = raw.options;
    if (isObj(raw.grid)) {
      const g = raw.grid;
      d.grid = {
        show: g.show !== false,
        w: typeof g.w === 'number' ? Math.min(256, Math.max(0, Math.round(g.w))) : 0,
        h: typeof g.h === 'number' ? Math.min(256, Math.max(0, Math.round(g.h))) : 0,
        color: typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : d.grid.color,
      };
    }
    if (typeof raw.sideOpen === 'boolean') d.sideOpen = raw.sideOpen;
    if (typeof raw.timelineOpen === 'boolean') d.timelineOpen = raw.timelineOpen;
    if (isObj(raw.onion)) {
      const o = raw.onion;
      d.onion = { enabled: o.enabled === true, prev: Number(o.prev) || 0, next: Number(o.next) || 0, opacity: Number(o.opacity) || 0.4 };
    }
    if (isObj(raw.keys)) d.keys = Object.fromEntries(Object.entries(raw.keys).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  } catch {
    /* corrupt or unavailable: use defaults */
  }
  return d;
}

let timer = 0;
export function savePrefs(p: Prefs): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
  }, 300);
}
