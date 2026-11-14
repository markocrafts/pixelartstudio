import { ACTIONS, defaultBindings, findConflict, isBindable, normalizeKey, type Bindings } from '../core/keymap';
import type { Prefs, Theme } from './prefs';

export const SETTINGS_TEMPLATE = `
<dialog id="settingsDlg" class="settings">
  <div class="ghead"><h3>Settings</h3><span class="spacer"></span><button id="stClose">Close</button></div>
  <div class="stbody">
    <section>
      <h4>Appearance</h4>
      <div class="row"><span>Theme</span><select id="stTheme"><option value="dark">Dark</option><option value="light">Light</option></select></div>
    </section>
    <section>
      <h4>Custom grid</h4>
      <div class="row"><span>Cell size</span><label class="dim">Width <input type="number" id="stGridW" min="0" max="256" class="narrow" aria-label="Grid cell width"></label> &times; <label class="dim">Height <input type="number" id="stGridH" min="0" max="256" class="narrow" aria-label="Grid cell height"></label><span class="hint">0 = off, e.g. 16 &times; 16 for tiles</span></div>
      <div class="row"><span>Color</span><input type="color" id="stGridColor"></div>
    </section>
    <section>
      <h4>Keyboard shortcuts</h4>
      <p class="hint">Click a shortcut, then press the new key. Backspace clears it, Esc cancels.</p>
      <div id="stKeys" class="keys"></div>
      <div class="actions"><button id="stKeysReset">Reset shortcuts</button></div>
    </section>
    <section>
      <h4>Storage</h4>
      <p class="hint">Projects are saved in this browser (IndexedDB) automatically. Use the gallery to download them as .pxf files.</p>
    </section>
  </div>
</dialog>
<dialog id="cheatDlg" class="settings">
  <div class="ghead"><h3>Keyboard shortcuts</h3><span class="spacer"></span><button id="chClose">Close</button></div>
  <div class="stbody" id="chBody"></div>
</dialog>`;

const pretty = (k: string): string => (k === '' ? 'unbound' : k.split(/\+(?=.)/).map((p) => (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1))).join(' + '));

export interface SettingsHandle {
  openSettings(): void;
  openCheatsheet(): void;
}

/** Settings (theme, custom grid, shortcut editor) and the `?` cheat sheet. */
export function mountSettings(
  root: HTMLElement,
  prefs: Prefs,
  getBindings: () => Bindings,
  hooks: { theme(t: Theme): void; grid(): void; keys(b: Bindings): void; changed(): void },
): SettingsHandle {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const dlg = $<HTMLDialogElement>('settingsDlg');
  const cheat = $<HTMLDialogElement>('cheatDlg');
  let listening: { id: string; btn: HTMLButtonElement; stop(): void } | null = null;

  const renderKeys = (): void => {
    const b = getBindings();
    const rows: HTMLElement[] = [];
    let group = '';
    for (const a of ACTIONS.filter((x) => !x.fixed)) {
      if (a.group !== group) {
        group = a.group;
        const h = document.createElement('div');
        h.className = 'kgroup';
        h.textContent = group;
        rows.push(h);
      }
      const row = document.createElement('div');
      row.className = 'krow';
      const label = document.createElement('span');
      label.textContent = a.label;
      const btn = document.createElement('button');
      btn.dataset.action = a.id;
      btn.textContent = pretty(b[a.id] ?? '');
      btn.className = 'keybtn' + (b[a.id] ? '' : ' none');
      row.append(label, btn);
      rows.push(row);
    }
    $('stKeys').replaceChildren(...rows);
  };

  const apply = (b: Bindings): void => { hooks.keys(b); renderKeys(); hooks.changed(); };

  $('stKeys').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!btn) return;
    listening?.stop();
    const id = btn.dataset.action!;
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopPropagation();
      stop();
      if (ev.key === 'Escape') return;
      const next = { ...getBindings() };
      if (ev.key === 'Backspace' || ev.key === 'Delete') next[id] = '';
      else {
        const key = normalizeKey(ev);
        if (!key) return;
        if (!isBindable(key)) { btn.textContent = `Can't use ${pretty(key)}`; setTimeout(renderKeys, 1200); return; }
        const other = findConflict(next, id, key);
        if (other) next[other] = '';
        next[id] = key;
      }
      apply(next);
    };
    const stop = (): void => {
      window.removeEventListener('keydown', onKey, true);
      listening = null;
      renderKeys();
    };
    window.addEventListener('keydown', onKey, true);
    listening = { id, btn, stop };
  });
  $('stKeysReset').addEventListener('click', () => apply(defaultBindings()));

  const theme = $<HTMLSelectElement>('stTheme');
  theme.addEventListener('change', () => hooks.theme(theme.value as Theme));
  const gw = $<HTMLInputElement>('stGridW'), gh = $<HTMLInputElement>('stGridH'), gc = $<HTMLInputElement>('stGridColor');
  const gridChanged = (): void => {
    prefs.grid.w = Math.min(256, Math.max(0, Math.round(Number(gw.value) || 0)));
    prefs.grid.h = Math.min(256, Math.max(0, Math.round(Number(gh.value) || 0)));
    prefs.grid.color = gc.value;
    hooks.grid();
  };
  for (const el of [gw, gh, gc]) el.addEventListener('input', gridChanged);
  $('stClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => listening?.stop());

  const renderCheat = (): void => {
    const b = getBindings();
    const groups = new Map<string, Array<[string, string]>>();
    for (const a of ACTIONS) {
      const key = a.fixed ? a.key : b[a.id] ?? '';
      if (!key) continue;
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group)!.push([a.label, a.fixed ? key : pretty(key)]);
    }
    $('chBody').replaceChildren(...[...groups].map(([g, items]) => {
      const sec = document.createElement('section');
      const h = document.createElement('h4');
      h.textContent = g === 'Fixed' ? 'Editing' : g;
      sec.append(h, ...items.map(([label, key]) => {
        const row = document.createElement('div');
        row.className = 'krow';
        const l = document.createElement('span');
        l.textContent = label;
        const k = document.createElement('kbd');
        k.textContent = key;
        row.append(l, k);
        return row;
      }));
      return sec;
    }));
  };
  $('chClose').addEventListener('click', () => cheat.close());

  return {
    openSettings(): void {
      theme.value = prefs.theme;
      gw.value = String(prefs.grid.w);
      gh.value = String(prefs.grid.h);
      gc.value = prefs.grid.color;
      renderKeys();
      dlg.showModal();
    },
    openCheatsheet(): void {
      renderCheat();
      if (cheat.open) cheat.close(); else cheat.showModal();
    },
  };
}
