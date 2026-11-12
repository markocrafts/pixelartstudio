import type { Editor } from '../core/editor';
import type { LayerState } from '../core/history';
import { BLEND_MODES, MAX_LAYERS, type LayerMeta } from '../core/project';
import { celToImageData } from '../render/imagedata';
import { readImageBlob } from '../io/clipboard';

const EYE = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".4"/><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.6"/></svg>';
const LOCK = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="7" width="10" height="7" rx="1.2" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const UNLOCK = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="7" width="10" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".4"/><path d="M5 7V5a3 3 0 0 1 5.6-1.5" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".4"/></svg>';

const THUMB = 36;

export const LAYERS_TEMPLATE = `
<section class="panel" id="layersPanel">
  <header>
    <h4>Layers</h4>
    <span class="spacer"></span>
    <button id="lyAdd" title="Add layer">+</button>
    <button id="lyDup" title="Duplicate layer">Dup</button>
    <button id="lyDel" title="Delete layer">Del</button>
  </header>
  <div class="layerlist" id="layerList"></div>
  <div class="layerprops">
    <label class="srow">Opacity <input type="range" id="lyOpacity" min="0" max="100"><output id="lyOpacityVal"></output></label>
    <label class="srow">Blend <select id="lyBlend">${BLEND_MODES.map((m) => `<option value="${m}">${m[0]!.toUpperCase()}${m.slice(1)}</option>`).join('')}</select></label>
    <label class="srow"><input type="checkbox" id="lyAlphaLock"> Alpha lock</label>
  </div>
  <div class="panelbtns">
    <button id="lyMerge" title="Merge into the layer below">Merge &darr;</button>
    <button id="lyFlatten" title="Flatten all visible layers into one">Flatten</button>
    <button id="lyImport" title="Import an image as a new layer">Import&hellip;</button>
    <button id="lyRef" title="Add an image as a reference layer (never exported)">Reference&hellip;</button>
  </div>
  <input type="file" id="lyFile" accept="image/*" class="hidden">
</section>`;

/** Layers panel: list with live thumbnails, drag-to-reorder, rename on double-click, properties, merge/flatten. */
export function mountLayers(root: HTMLElement, editor: Editor, notify: (msg: string) => void): { refresh(): void } {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const list = $('layerList');
  const thumbs = new Map<string, HTMLCanvasElement>();
  const scratch = document.createElement('canvas');
  let key = '';
  let thumbTimer = 0;
  let pendingOpacity: LayerState | null = null;

  const layerKey = (): string =>
    editor.project.id + '|' + editor.activeLayer + '|' + JSON.stringify(editor.project.layers);

  const drawThumbs = (): void => {
    thumbTimer = 0;
    const p = editor.project;
    const frame = p.frames[editor.activeFrame];
    if (!frame) return;
    // Large projects: only keep the active layer's thumbnail live.
    const all = p.width * p.height * p.layers.length <= 4_000_000;
    scratch.width = p.width;
    scratch.height = p.height;
    const sctx = scratch.getContext('2d')!;
    const k = Math.min(THUMB / p.width, THUMB / p.height);
    const tw = Math.max(1, Math.round(p.width * k)), th = Math.max(1, Math.round(p.height * k));
    p.layers.forEach((l, i) => {
      const cv = thumbs.get(l.id);
      const cel = frame.cels.get(l.id);
      if (!cv || !cel || (!all && i !== editor.activeLayer)) return;
      sctx.putImageData(celToImageData(cel, p.width, p.height), 0, 0);
      const c = cv.getContext('2d')!;
      c.clearRect(0, 0, cv.width, cv.height);
      c.imageSmoothingEnabled = false;
      c.drawImage(scratch, (THUMB - tw) / 2, (THUMB - th) / 2, tw, th);
    });
  };
  const scheduleThumbs = (): void => {
    if (!thumbTimer) thumbTimer = window.setTimeout(drawThumbs, 200);
  };

  const dragState: { from: number } = { from: -1 };

  const rename = (nameEl: HTMLElement, i: number, l: LayerMeta): void => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = l.name;
    input.className = 'rename';
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      if (commit) editor.setLayerProps(i, { name: input.value });
      key = ''; // force a rebuild
      refresh();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  };

  const build = (): void => {
    const layers = editor.project.layers;
    thumbs.clear();
    const rows: HTMLElement[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      const row = document.createElement('div');
      row.className = 'layer' + (i === editor.activeLayer ? ' active' : '') + (l.isReference ? ' ref' : '');
      row.draggable = true;
      row.dataset.i = String(i);
      const cv = document.createElement('canvas');
      cv.width = cv.height = THUMB;
      cv.className = 'thumb';
      thumbs.set(l.id, cv);
      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = l.name;
      name.title = 'Double-click to rename';
      const tags = document.createElement('span');
      tags.className = 'tags';
      tags.textContent = [l.isReference ? 'ref' : '', l.alphaLock ? 'α' : '', l.blendMode !== 'normal' ? l.blendMode : ''].filter(Boolean).join(' ');
      const vis = document.createElement('button');
      vis.className = 'icon' + (l.visible ? '' : ' off');
      vis.innerHTML = l.visible ? EYE : EYE_OFF;
      vis.title = 'Toggle visibility';
      vis.dataset.act = 'vis';
      const lock = document.createElement('button');
      lock.className = 'icon' + (l.locked ? '' : ' off');
      lock.innerHTML = l.locked ? LOCK : UNLOCK;
      lock.title = 'Toggle lock';
      lock.dataset.act = 'lock';
      const label = document.createElement('div');
      label.className = 'lmeta';
      label.append(name, tags);
      row.append(cv, label, vis, lock);
      rows.push(row);
    }
    list.replaceChildren(...rows);
    drawThumbs();
  };

  const syncProps = (): void => {
    const l = editor.project.layers[editor.activeLayer];
    const n = editor.project.layers.length;
    if (!l) return;
    const op = $<HTMLInputElement>('lyOpacity');
    if (document.activeElement !== op) op.value = String(Math.round(l.opacity * 100));
    $('lyOpacityVal').textContent = `${Math.round(l.opacity * 100)}%`;
    $<HTMLSelectElement>('lyBlend').value = l.blendMode;
    $<HTMLSelectElement>('lyBlend').disabled = l.isReference;
    $<HTMLInputElement>('lyAlphaLock').checked = l.alphaLock;
    $<HTMLInputElement>('lyAlphaLock').disabled = l.isReference;
    $<HTMLButtonElement>('lyAdd').disabled = !editor.canAddLayer;
    $<HTMLButtonElement>('lyDup').disabled = !editor.canAddLayer;
    $<HTMLButtonElement>('lyDel').disabled = n <= 1;
    const prev = editor.project.layers[editor.activeLayer - 1];
    $<HTMLButtonElement>('lyMerge').disabled = !prev || prev.isReference || l.isReference;
    $<HTMLButtonElement>('lyFlatten').disabled = editor.project.layers.filter((x) => !x.isReference).length < 2;
    $<HTMLButtonElement>('lyImport').disabled = !editor.canAddLayer;
    $<HTMLButtonElement>('lyRef').disabled = !editor.canAddLayer;
  };

  function refresh(): void {
    const k = layerKey();
    if (k !== key) {
      key = k;
      build();
    } else scheduleThumbs();
    syncProps();
  }

  // Row interactions
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
    if (!row) return;
    const i = Number(row.dataset.i);
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    const l = editor.project.layers[i];
    if (!l) return;
    if (act === 'vis') editor.setLayerProps(i, { visible: !l.visible });
    else if (act === 'lock') editor.setLayerProps(i, { locked: !l.locked });
    else editor.setActiveLayer(i);
  });
  list.addEventListener('dblclick', (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>('.lname');
    const row = name?.closest<HTMLElement>('.layer');
    if (!name || !row) return;
    const i = Number(row.dataset.i);
    rename(name, i, editor.project.layers[i]!);
  });
  list.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
    if (!row) return;
    dragState.from = Number(row.dataset.i);
    e.dataTransfer?.setData('text/plain', String(dragState.from));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => {
    if (dragState.from < 0) return;
    e.preventDefault();
    const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
    for (const r of list.querySelectorAll('.dragover')) r.classList.remove('dragover');
    row?.classList.add('dragover');
  });
  list.addEventListener('dragleave', (e) => {
    (e.target as HTMLElement).closest('.layer')?.classList.remove('dragover');
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
    const from = dragState.from;
    dragState.from = -1;
    for (const r of list.querySelectorAll('.dragover')) r.classList.remove('dragover');
    if (row && from >= 0) editor.moveLayer(from, Number(row.dataset.i));
  });
  list.addEventListener('dragend', () => { dragState.from = -1; });

  // Buttons
  $('lyAdd').addEventListener('click', () => editor.addLayer());
  $('lyDup').addEventListener('click', () => editor.duplicateLayer());
  $('lyDel').addEventListener('click', () => editor.deleteLayer());
  $('lyMerge').addEventListener('click', () => editor.mergeDown());
  $('lyFlatten').addEventListener('click', () => editor.flatten());

  const opacity = $<HTMLInputElement>('lyOpacity');
  opacity.addEventListener('input', () => {
    pendingOpacity ??= editor.captureLayerState();
    editor.setLayerProps(editor.activeLayer, { opacity: Number(opacity.value) / 100 }, false);
  });
  opacity.addEventListener('change', () => {
    if (pendingOpacity) editor.recordLayerChange('Layer opacity', pendingOpacity);
    pendingOpacity = null;
  });
  $<HTMLSelectElement>('lyBlend').addEventListener('change', (e) =>
    editor.setLayerProps(editor.activeLayer, { blendMode: (e.target as HTMLSelectElement).value as LayerMeta['blendMode'] }));
  $<HTMLInputElement>('lyAlphaLock').addEventListener('change', (e) =>
    editor.setLayerProps(editor.activeLayer, { alphaLock: (e.target as HTMLInputElement).checked }));

  // Image import / reference
  const file = $<HTMLInputElement>('lyFile');
  let asReference = false;
  const pick = (ref: boolean): void => { asReference = ref; file.value = ''; file.click(); };
  $('lyImport').addEventListener('click', () => pick(false));
  $('lyRef').addEventListener('click', () => pick(true));
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    const name = f.name.replace(/\.[^.]+$/, '');
    readImageBlob(f)
      .then((img) => {
        if (!editor.addImageLayer(img, name, asReference)) notify(`Layer limit reached (${MAX_LAYERS}).`);
        else if (img.w > editor.project.width || img.h > editor.project.height) notify('The image is larger than the canvas and was clipped.');
      })
      .catch(() => notify('That file could not be read as an image.'));
  });

  refresh();
  return { refresh };
}
