import { MAX_FRAMES } from '../core/project';
import { sliceSheet } from '../core/sheet';
import { readImageBlob } from '../io/clipboard';
import {
  encodeGifInWorker, exportRange, exportSheet, gifJob, readGifFile, recordVideo, videoMimeType,
} from '../io/anim';
import { downloadBlob } from '../io/png';
import type { Editor } from '../core/editor';
import type { SheetLayout } from '../core/sheet';

const VIDEO = videoMimeType();

export const ANIM_DIALOGS_TEMPLATE = `
<dialog id="animDlg">
  <form method="dialog" id="animForm">
    <h3>Export animation</h3>
    <div class="row"><span>Format</span><select id="axFormat"><option value="gif">Animated GIF</option><option value="sheet">Sprite sheet (PNG + JSON)</option>${VIDEO ? `<option value="video">Video (${VIDEO.startsWith('video/mp4') ? 'MP4' : 'WebM'})</option>` : ''}</select></div>
    <div class="row"><span>Frames</span><select id="axRange"></select></div>
    <div class="row"><span>Scale</span><select id="axScale">${[1, 2, 3, 4, 6, 8, 16].map((s) => `<option value="${s}">${s}&times;</option>`).join('')}</select><span id="axSize" class="hint"></span></div>
    <div class="row" data-ax="gif"><span>Loop</span><label><input type="checkbox" id="axLoop" checked> Repeat forever</label></div>
    <div class="row" data-ax="sheet"><span>Layout</span><select id="axLayout"><option value="horizontal">Horizontal strip</option><option value="vertical">Vertical strip</option><option value="grid">Grid</option></select><input type="number" id="axCols" min="1" value="4" title="Columns" class="narrow"></div>
    <div class="row" data-ax="sheet"><span>Padding</span><input type="number" id="axPad" min="0" max="32" value="0" class="narrow"> px<label><input type="checkbox" id="axJson" checked> JSON</label></div>
    <div class="row" data-ax="video"><span></span><span class="hint">Records one pass in real time, so it takes as long as the animation plays.</span></div>
    <progress id="axProgress" class="hidden" max="1" value="0"></progress>
    <div class="actions"><button value="cancel" id="axClose">Close</button><button value="go" class="active" id="axGo">Export</button></div>
  </form>
</dialog>
<dialog id="sheetDlg">
  <form method="dialog" id="sheetForm">
    <h3>Import sprite sheet</h3>
    <div class="row"><span>Image</span><span id="shInfo" class="hint"></span></div>
    <div class="row"><span>Cut by</span><select id="shMode"><option value="grid">Columns &times; rows</option><option value="cell">Cell size</option></select></div>
    <div class="row" data-sh="grid"><span>Grid</span><input type="number" id="shCols" min="1" value="1" class="narrow"> &times; <input type="number" id="shRows" min="1" value="1" class="narrow"></div>
    <div class="row hidden" data-sh="cell"><span>Cell</span><input type="number" id="shCw" min="1" value="16" class="narrow"> &times; <input type="number" id="shCh" min="1" value="16" class="narrow"></div>
    <div class="row"><span>Padding</span><input type="number" id="shPad" min="0" max="32" value="0" class="narrow"> px</div>
    <div class="row"><span></span><span id="shCount" class="hint"></span></div>
    <div class="actions"><button value="cancel">Cancel</button><button value="ok" class="active" id="shOk">Import</button></div>
  </form>
</dialog>`;

/** Animation export (GIF, sprite sheet, video) and import (GIF, sprite sheet) dialogs. */
export function mountAnimIo(root: HTMLElement, editor: Editor, notify: (msg: string) => void): { openExport(): void; importFile(file: File): void } {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const dlg = $<HTMLDialogElement>('animDlg');
  const fmt = $<HTMLSelectElement>('axFormat');
  const prog = $<HTMLProgressElement>('axProgress');
  let busy = false;

  const baseName = (): string => editor.project.name.replace(/[^\w.-]+/g, '_') || 'pixelartstudio';
  const sync = (): void => {
    for (const el of dlg.querySelectorAll<HTMLElement>('[data-ax]')) el.classList.toggle('hidden', el.dataset.ax !== fmt.value);
    const p = editor.project;
    const s = Number($<HTMLSelectElement>('axScale').value);
    $('axSize').textContent = `${p.width * s} × ${p.height * s} px per frame`;
    $<HTMLInputElement>('axCols').classList.toggle('hidden', $<HTMLSelectElement>('axLayout').value !== 'grid');
  };
  for (const id of ['axFormat', 'axScale', 'axLayout']) $(id).addEventListener('change', sync);

  function openExport(): void {
    editor.commitFloating();
    const sel = $<HTMLSelectElement>('axRange');
    sel.replaceChildren(new Option(`All frames (${editor.project.frames.length})`, 'all'), ...editor.project.tags.map((t) => new Option(`Tag: ${t.name} (${t.from + 1}–${t.to + 1})`, t.id)));
    prog.classList.add('hidden');
    sync();
    dlg.showModal();
  }

  $('axGo').addEventListener('click', async (e) => {
    e.preventDefault(); // keep the dialog open while exporting
    if (busy) return;
    busy = true;
    const go = $<HTMLButtonElement>('axGo');
    go.disabled = true;
    prog.classList.remove('hidden');
    prog.value = 0;
    const p = editor.project;
    const range = exportRange(p, $<HTMLSelectElement>('axRange').value);
    const scale = Number($<HTMLSelectElement>('axScale').value);
    const onProgress = (d: number, t: number): void => { prog.value = t ? d / t : 0; };
    try {
      if (fmt.value === 'gif') {
        const bytes = await encodeGifInWorker(gifJob(p, range, scale, $<HTMLInputElement>('axLoop').checked), onProgress);
        downloadBlob(new Blob([bytes as BlobPart], { type: 'image/gif' }), `${baseName()}.gif`);
      } else if (fmt.value === 'sheet') {
        const name = baseName();
        const { png, json } = await exportSheet(p, range, scale, {
          layout: $<HTMLSelectElement>('axLayout').value as SheetLayout,
          cols: Number($<HTMLInputElement>('axCols').value),
          padding: Number($<HTMLInputElement>('axPad').value),
        }, `${name}.png`);
        downloadBlob(png, `${name}.png`);
        if ($<HTMLInputElement>('axJson').checked) downloadBlob(new Blob([json], { type: 'application/json' }), `${name}.json`);
      } else if (VIDEO) {
        const blob = await recordVideo(p, range, scale, VIDEO, onProgress);
        downloadBlob(blob, `${baseName()}.${VIDEO.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
      }
      dlg.close('go');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      busy = false;
      go.disabled = false;
    }
  });
  $('axClose').addEventListener('click', () => { if (!busy) dlg.close('cancel'); });
  dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });

  // ---- sprite sheet import ----
  const sh = $<HTMLDialogElement>('sheetDlg');
  let sheet: { w: number; h: number; pixels: Uint32Array; name: string } | null = null;
  const cuts = (): { cw: number; ch: number } | null => {
    if (!sheet) return null;
    const pad = Math.max(0, Number($<HTMLInputElement>('shPad').value) || 0);
    if ($<HTMLSelectElement>('shMode').value === 'grid') {
      const cols = Math.max(1, Number($<HTMLInputElement>('shCols').value) || 1), rows = Math.max(1, Number($<HTMLInputElement>('shRows').value) || 1);
      return { cw: Math.floor((sheet.w - pad * (cols + 1)) / cols), ch: Math.floor((sheet.h - pad * (rows + 1)) / rows) };
    }
    return { cw: Math.max(1, Number($<HTMLInputElement>('shCw').value) || 1), ch: Math.max(1, Number($<HTMLInputElement>('shCh').value) || 1) };
  };
  const cut = (): Uint32Array[] => {
    const c = cuts();
    if (!sheet || !c || c.cw < 1 || c.ch < 1) return [];
    return sliceSheet(sheet.pixels, sheet.w, sheet.h, c.cw, c.ch, Math.max(0, Number($<HTMLInputElement>('shPad').value) || 0));
  };
  const shSync = (): void => {
    for (const el of sh.querySelectorAll<HTMLElement>('[data-sh]')) el.classList.toggle('hidden', el.dataset.sh !== $<HTMLSelectElement>('shMode').value);
    const c = cuts(), n = cut().length;
    $('shCount').textContent = c && n ? `${n} frame${n === 1 ? '' : 's'} of ${c.cw} × ${c.ch}${n > MAX_FRAMES ? ` (first ${MAX_FRAMES} used)` : ''}` : 'These settings produce no frames.';
    $<HTMLButtonElement>('shOk').disabled = n === 0 || (c?.cw ?? 0) > 2048 || (c?.ch ?? 0) > 2048;
  };
  for (const id of ['shMode', 'shCols', 'shRows', 'shCw', 'shCh', 'shPad']) $(id).addEventListener('input', shSync);
  sh.addEventListener('close', () => {
    if (sh.returnValue !== 'ok' || !sheet) return;
    const c = cuts();
    const frames = cut();
    if (c && frames.length && editor.loadFrames(frames.map((pixels) => ({ pixels })), c.cw, c.ch, sheet.name)) notify(`Imported ${Math.min(frames.length, MAX_FRAMES)} frames.`);
  });

  // The current project is autosaved before it is replaced, so no confirmation is needed.
  const confirmDiscard = (): boolean => true;

  function importFile(file: File): void {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
      void readGifFile(file).then((g) => {
        if (!confirmDiscard()) return;
        if (editor.loadFrames(g.frames, g.width, g.height, name)) notify(`Imported ${Math.min(g.frames.length, MAX_FRAMES)} GIF frames.`);
        else notify('That GIF could not be imported.');
      }).catch((err: unknown) => notify(err instanceof Error ? err.message : 'That file is not a readable GIF.'));
      return;
    }
    void readImageBlob(file).then((img) => {
      if (!confirmDiscard()) return;
      sheet = { ...img, name };
      $<HTMLSelectElement>('shMode').value = 'grid';
      $<HTMLInputElement>('shCols').value = $<HTMLInputElement>('shRows').value = '1';
      $('shInfo').textContent = `${file.name} · ${img.w} × ${img.h}`;
      $<HTMLInputElement>('shCw').value = String(Math.min(img.w, img.h));
      $<HTMLInputElement>('shCh').value = String(Math.min(img.w, img.h));
      shSync();
      sh.showModal();
    }).catch(() => notify('That file could not be read as an image.'));
  }

  return { openExport, importFile };
}
