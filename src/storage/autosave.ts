import type { Editor } from '../core/editor';
import { serializePxf } from '../core/pxf';
import { makeThumbnail } from '../io/thumb';
import { metaOf, nearlyFull, putProject, storageUsage } from './db';

const LAST_KEY = 'pixelforge.last';
const SESSION_KEY = 'pixelforge.session';

const ls = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export interface AutosaveHandle {
  /** Saves now if anything changed. */
  save(): Promise<void>;
  lastProjectId(): string | null;
  /** True when the previous session did not close cleanly. */
  readonly crashed: boolean;
  /** Marks `id` as the project to reopen next time. */
  remember(id: string): void;
}

/** Autosaves the open project every `intervalMs` while it changed, and when the page is hidden or closed. */
export function startAutosave(editor: Editor, notify: (msg: string) => void, intervalMs = 10_000): AutosaveHandle {
  const crashed = ls.get(SESSION_KEY) === 'open';
  ls.set(SESSION_KEY, 'open');
  let savedRevision = editor.revision;
  let savedId = editor.project.id;
  let warned = false;

  const save = async (): Promise<void> => {
    const p = editor.project;
    if (editor.revision === savedRevision && p.id === savedId) return;
    savedRevision = editor.revision;
    savedId = p.id;
    try {
      const data = serializePxf(p); // synchronous snapshot of the project as it is now
      const meta = metaOf(p, makeThumbnail(p), data.byteLength);
      await putProject(meta, data);
      ls.set(LAST_KEY, p.id);
      if (!warned && nearlyFull(await storageUsage())) {
        warned = true;
        notify('Browser storage is almost full. Export projects as .pxf and delete old ones from the gallery.');
      }
    } catch (err) {
      savedRevision = -1; // retry next time
      notify(err instanceof DOMException && err.name === 'QuotaExceededError'
        ? 'Browser storage is full, so autosave failed. Export your project as .pxf.'
        : 'Autosave failed. Export your project as .pxf to be safe.');
    }
  };

  editor.beforeOpen = () => { void save(); };
  setInterval(() => { void save(); }, intervalMs);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void save(); });
  window.addEventListener('pagehide', () => { void save(); ls.set(SESSION_KEY, 'closed'); });
  window.addEventListener('pageshow', () => ls.set(SESSION_KEY, 'open'));

  return {
    save,
    lastProjectId: () => ls.get(LAST_KEY),
    crashed,
    remember: (id) => { ls.set(LAST_KEY, id); },
  };
}
