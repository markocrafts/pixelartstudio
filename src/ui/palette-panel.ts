import type { Editor } from '../core/editor';
import {
  BUILTIN_PALETTES, exportGpl, exportHex, exportPal, lospecSlug, parsePaletteText, colorToHex,
} from '../core/palette';
import { unpackRGBA } from '../core/pixels';
import { fetchLospecPalette, paletteToPngBlob, readPaletteFile } from '../io/palette';
import { downloadBlob } from '../io/png';

export const PALETTE_TEMPLATE = `
<section class="panel" id="palettePanel">
  <header>
    <h4>Palette</h4>
    <span class="spacer"></span>
    <select id="palPreset" title="Load a built-in palette">
      <option value="">Load&hellip;</option>
      ${BUILTIN_PALETTES.map((p, i) => `<option value="${i}">${p.name} (${p.colors.length})</option>`).join('')}
    </select>
  </header>
  <div class="palname" id="palName"></div>
  <div class="palette" id="palGrid"></div>
  <div class="panelbtns">
    <button id="palAdd" title="Add the primary color">Add</button>
    <button id="palRemove" title="Remove the selected color">Remove</button>
    <button id="palSet" title="Set the selected swatch to the primary color">Set</button>
    <button id="palExtract" title="Build a palette from the colors in this frame">Extract</button>
  </div>
  <div class="panelbtns">
    <button id="palRepFrame" title="Replace the selected swatch's color with the primary color in this frame">Replace: frame</button>
    <button id="palRepProj" title="Replace the selected swatch's color with the primary color in all frames">project</button>
  </div>
  <div class="panelbtns">
    <button id="palImport" title="Import .hex, .gpl, .pal or .png">Import&hellip;</button>
    <button id="palPaste" title="Paste a hex list or Lospec palette name">Paste&hellip;</button>
    <select id="palExport" title="Export the palette"><option value="">Export&hellip;</option><option value="hex">.hex</option><option value="gpl">.gpl (GIMP)</option><option value="pal">.pal (JASC)</option><option value="png">.png</option></select>
  </div>
  <label class="srow"><input type="checkbox" id="palLock"> Palette lock (draw only palette colors)</label>
  <input type="file" id="palFile" accept=".hex,.gpl,.pal,.png,.txt,image/png" class="hidden">
  <dialog id="palDlg">
    <form method="dialog">
      <h3>Paste palette</h3>
      <p class="hint">Paste hex colors (one per line or separated by spaces), or a Lospec palette name or link, such as <code>pico-8</code>. A Lospec name is looked up on lospec.com.</p>
      <textarea id="palText" rows="6" spellcheck="false"></textarea>
      <div class="actions"><button value="cancel">Cancel</button><button value="ok" class="active">Load</button></div>
    </form>
  </dialog>
</section>`;

/** Palette panel: swatches (click = primary, right-click = secondary, drag to reorder), import/export, extract, lock. */
export function mountPalette(root: HTMLElement, editor: Editor, notify: (msg: string) => void): { refresh(): void } {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const grid = $('palGrid');
  let selected = -1;
  let key = '';
  let dragFrom = -1;

  const css = (c: number): string => {
    const [r, g, b, a] = unpackRGBA(c);
    return `rgba(${r},${g},${b},${a / 255})`;
  };

  function build(): void {
    const colors = editor.project.palette.colors;
    $('palName').textContent = `${editor.project.palette.name} · ${colors.length} color${colors.length === 1 ? '' : 's'}`;
    if (selected >= colors.length) selected = -1;
    grid.replaceChildren(...colors.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'pswatch' + (i === selected ? ' sel' : '');
      b.style.setProperty('--c', css(c));
      b.title = '#' + colorToHex(c);
      b.dataset.i = String(i);
      b.draggable = true;
      return b;
    }));
    if (colors.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'Empty. Load a preset, import a file, or add colors.';
      grid.replaceChildren(hint);
    }
  }

  function refresh(): void {
    const p = editor.project.palette;
    const k = editor.project.id + '|' + p.name + '|' + p.colors.join(',') + '|' + selected;
    if (k !== key) { key = k; build(); }
    const has = selected >= 0 && selected < p.colors.length;
    for (const id of ['palRemove', 'palSet', 'palRepFrame', 'palRepProj']) $<HTMLButtonElement>(id).disabled = !has;
    $<HTMLInputElement>('palLock').checked = editor.options.paletteLock;
  }

  const load = (name: string, colors: number[]): void => {
    editor.setPalette(name, colors);
    selected = -1;
  };

  grid.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!b) return;
    selected = Number(b.dataset.i);
    editor.setPrimary(editor.project.palette.colors[selected]!);
    key = ''; refresh();
  });
  grid.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (b) editor.setSecondary(editor.project.palette.colors[Number(b.dataset.i)]!);
  });
  grid.addEventListener('dragstart', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!b) return;
    dragFrom = Number(b.dataset.i);
    e.dataTransfer?.setData('text/plain', String(dragFrom));
  });
  grid.addEventListener('dragover', (e) => { if (dragFrom >= 0) e.preventDefault(); });
  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    const from = dragFrom;
    dragFrom = -1;
    if (!b || from < 0) return;
    const to = Number(b.dataset.i);
    editor.movePaletteColor(from, to);
    if (selected === from) selected = to;
  });
  grid.addEventListener('dragend', () => { dragFrom = -1; });

  $('palAdd').addEventListener('click', () => {
    if (editor.addPaletteColor(editor.primary)) selected = editor.project.palette.colors.length - 1;
    else notify('That color is already in the palette.');
  });
  $('palRemove').addEventListener('click', () => { editor.removePaletteColor(selected); selected = -1; });
  $('palSet').addEventListener('click', () => editor.setPaletteColor(selected, editor.primary));
  $('palExtract').addEventListener('click', () => {
    const colors = editor.paletteFromImage(256);
    if (colors.length === 0) { notify('Nothing to extract: the frame has no visible pixels.'); return; }
    load('Extracted', colors);
  });
  const replace = (scope: 'frame' | 'project'): void => {
    const from = editor.project.palette.colors[selected];
    if (from === undefined) return;
    const n = editor.replaceColor(from, editor.primary, scope);
    editor.setPaletteColor(selected, editor.primary);
    notify(`Replaced ${n} pixel${n === 1 ? '' : 's'}.`);
  };
  $('palRepFrame').addEventListener('click', () => replace('frame'));
  $('palRepProj').addEventListener('click', () => replace('project'));
  $<HTMLInputElement>('palLock').addEventListener('change', (e) => editor.setOptions({ paletteLock: (e.target as HTMLInputElement).checked }));

  $<HTMLSelectElement>('palPreset').addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const def = BUILTIN_PALETTES[Number(sel.value)];
    sel.value = '';
    if (def) load(def.name, def.colors);
  });

  const file = $<HTMLInputElement>('palFile');
  $('palImport').addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    readPaletteFile(f).then((def) => load(def.name || 'Imported', def.colors)).catch((err: unknown) => notify(err instanceof Error ? err.message : 'Could not read that palette.'));
  });

  const dlg = $<HTMLDialogElement>('palDlg');
  const text = $<HTMLTextAreaElement>('palText');
  $('palPaste').addEventListener('click', () => { text.value = ''; dlg.showModal(); text.focus(); });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const t = text.value.trim();
    if (!t) return;
    const slug = lospecSlug(t);
    const p = slug ? fetchLospecPalette(slug) : Promise.resolve().then(() => parsePaletteText(t));
    p.then((def) => load(def.name || slug || 'Pasted', def.colors)).catch((err: unknown) => notify(err instanceof Error ? err.message : 'Could not read that palette.'));
  });

  $<HTMLSelectElement>('palExport').addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const fmt = sel.value;
    sel.value = '';
    const { name, colors } = editor.project.palette;
    if (!fmt) return;
    if (colors.length === 0) { notify('The palette is empty.'); return; }
    const base = name.replace(/[^\w.-]+/g, '_') || 'palette';
    if (fmt === 'png') void paletteToPngBlob(colors).then((b) => downloadBlob(b, `${base}.png`));
    else if (fmt === 'hex') downloadBlob(new Blob([exportHex(colors)], { type: 'text/plain' }), `${base}.hex`);
    else if (fmt === 'gpl') downloadBlob(new Blob([exportGpl(name, colors)], { type: 'text/plain' }), `${base}.gpl`);
    else if (fmt === 'pal') downloadBlob(new Blob([exportPal(colors)], { type: 'text/plain' }), `${base}.pal`);
  });

  refresh();
  return { refresh };
}
