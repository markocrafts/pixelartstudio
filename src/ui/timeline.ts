import { MAX_DURATION_MS, MIN_DURATION_MS, MAX_FPS, MIN_FPS, frameDuration } from '../core/animation';
import type { Editor } from '../core/editor';
import { MAX_FRAMES, type TagDirection } from '../core/project';

export const TIMELINE_TEMPLATE = `
<div class="timeline" id="timeline">
  <div class="tlbar">
    <div class="group">
      <button id="fAdd" title="Add a blank frame after the current one">+ Frame</button>
      <button id="fDup" title="Duplicate the selected frames">Duplicate</button>
      <button id="fDel" title="Delete the selected frames">Delete</button>
      <button id="fLeft" title="Move frame left">&#9664;</button>
      <button id="fRight" title="Move frame right">&#9654;</button>
    </div>
    <div class="group">
      <button id="celCopy" title="Copy the current cel (active layer, active frame)">Copy cel</button>
      <button id="celPaste" title="Paste the copied cel here">Paste cel</button>
    </div>
    <div class="group">
      <label>Duration <input type="number" class="narrow" id="fDur" min="${MIN_DURATION_MS}" max="${MAX_DURATION_MS}" step="10"> ms</label>
      <button id="fDurAuto" title="Use the project FPS for the selected frames">Auto</button>
      <label>FPS <input type="number" class="narrow" id="fps" min="${MIN_FPS}" max="${MAX_FPS}"></label>
    </div>
    <div class="group">
      <label><input type="checkbox" id="onionOn"> Onion skin</label>
      <label>&#9664; <input type="number" class="narrow" id="onionPrev" min="0" max="5"></label>
      <label>&#9654; <input type="number" class="narrow" id="onionNext" min="0" max="5"></label>
      <label>Opacity <input type="range" id="onionOpacity" min="5" max="100"></label>
    </div>
    <div class="group"><button id="tagAdd" title="Create a tag from the selected frames">+ Tag</button></div>
  </div>
  <div class="tlbody" id="tlBody"></div>
</div>
<dialog id="tagDlg">
  <form method="dialog">
    <h3>Frame tag</h3>
    <div class="row"><span>Name</span><input type="text" id="tagName" maxlength="40"></div>
    <div class="row"><span>Frames</span><input type="number" id="tagFrom" min="1"> &ndash; <input type="number" id="tagTo" min="1"></div>
    <div class="row"><span>Direction</span><select id="tagDir"><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="pingpong">Ping-pong</option></select></div>
    <div class="row"><span>Loop</span><label><input type="checkbox" id="tagLoop"> Loop this tag when played</label></div>
    <div class="actions"><button value="delete" id="tagDelete">Delete</button><button value="cancel">Cancel</button><button value="ok" class="active">Save</button></div>
  </form>
</dialog>`;

const LABEL_W = 112;

function hasPixels(a: Uint32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) return true;
  return false;
}

/** Timeline: frames as columns, layers as rows, tag bars above, plus frame/cel/onion/fps controls. */
export function mountTimeline(root: HTMLElement, editor: Editor, notify: (msg: string) => void): { refresh(): void } {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const body = $('tlBody');
  let key = '';
  let headers: HTMLElement[] = [];
  let cells: HTMLElement[][] = []; // [layerIndexFromTop][frame]
  let rowLabels: HTMLElement[] = [];
  let lastActiveFrame = -1;
  let fillTimer = 0;
  let dragFrom = -1;
  let editingTag: string | null = null;

  const structureKey = (): string => {
    const p = editor.project;
    return [
      p.id,
      p.frames.map((f) => `${f.id}:${f.durationMs ?? ''}`).join(','),
      p.layers.map((l) => `${l.id}:${l.name}:${+l.visible}:${+l.locked}:${+l.isReference}`).join(','),
      JSON.stringify(p.tags),
      p.fps,
    ].join('|');
  };

  const build = (): void => {
    const p = editor.project;
    const n = p.frames.length;
    // Greedy lane assignment so overlapping tags get their own rows.
    const lanes: number[] = [];
    const laneOf = p.tags.map((t) => {
      let lane = lanes.findIndex((end) => end < t.from);
      if (lane < 0) { lane = lanes.length; lanes.push(t.to); } else lanes[lane] = t.to;
      return lane;
    });
    const tagRows = Math.max(1, lanes.length);
    const headerRow = tagRows + 1;
    const grid = document.createElement('div');
    grid.className = 'tlgrid';
    grid.style.gridTemplateColumns = `${LABEL_W}px repeat(${n}, 26px)`;

    const put = (el: HTMLElement, row: number, col: number, span = 1): HTMLElement => {
      el.style.gridRow = String(row);
      el.style.gridColumn = span > 1 ? `${col} / span ${span}` : String(col);
      grid.append(el);
      return el;
    };
    const corner = document.createElement('div');
    corner.className = 'tlcorner';
    corner.textContent = 'Tags';
    put(corner, 1, 1).style.gridRow = `1 / span ${tagRows}`;
    p.tags.forEach((t, i) => {
      const bar = document.createElement('button');
      bar.className = 'tagbar';
      bar.textContent = `${t.name}${t.direction === 'forward' ? '' : t.direction === 'reverse' ? ' ◀' : ' ⇄'}${t.loop ? '' : ' ·1'}`;
      bar.title = `${t.name}: frames ${t.from + 1}–${t.to + 1}. Click to edit.`;
      bar.dataset.tag = t.id;
      put(bar, laneOf[i]! + 1, t.from + 2, t.to - t.from + 1);
    });
    const hc = document.createElement('div');
    hc.className = 'tlcorner';
    hc.textContent = 'Frame';
    put(hc, headerRow, 1);
    headers = p.frames.map((f, i) => {
      const h = document.createElement('div');
      h.className = 'tlhead';
      h.dataset.f = String(i);
      h.draggable = true;
      h.innerHTML = `<b>${i + 1}</b>${f.durationMs !== undefined ? `<i>${f.durationMs}</i>` : ''}`;
      h.title = `Frame ${i + 1} · ${frameDuration(p, f)} ms${f.durationMs !== undefined ? ' (custom)' : ''}`;
      return put(h, headerRow, i + 2);
    });
    cells = [];
    rowLabels = [];
    for (let r = 0; r < p.layers.length; r++) {
      const li = p.layers.length - 1 - r;
      const l = p.layers[li]!;
      const lab = document.createElement('div');
      lab.className = 'tllabel' + (l.visible ? '' : ' off') + (l.isReference ? ' ref' : '');
      lab.dataset.l = String(li);
      lab.textContent = l.name + (l.locked ? ' 🔒' : '');
      lab.title = l.name;
      put(lab, headerRow + 1 + r, 1);
      rowLabels.push(lab);
      cells.push(p.frames.map((_, i) => {
        const c = document.createElement('div');
        c.className = 'tlcell';
        c.dataset.f = String(i);
        c.dataset.l = String(li);
        return put(c, headerRow + 1 + r, i + 2);
      }));
    }
    body.replaceChildren(grid);
  };

  const paintSelection = (): void => {
    const { from, to } = editor.frameRange;
    headers.forEach((h, i) => {
      h.classList.toggle('active', i === editor.activeFrame);
      h.classList.toggle('range', i >= from && i <= to);
    });
    const rowTop = editor.project.layers.length - 1 - editor.activeLayer;
    cells.forEach((row, r) => row.forEach((c, i) => {
      c.classList.toggle('active', i === editor.activeFrame && r === rowTop);
      c.classList.toggle('range', i >= from && i <= to);
      c.classList.toggle('layerrow', r === rowTop);
    }));
    rowLabels.forEach((l, r) => l.classList.toggle('active', r === rowTop));
    if (editor.activeFrame !== lastActiveFrame) {
      lastActiveFrame = editor.activeFrame;
      const h = headers[editor.activeFrame];
      if (h) {
        const left = h.offsetLeft - LABEL_W, right = h.offsetLeft + h.offsetWidth;
        if (left < body.scrollLeft) body.scrollLeft = Math.max(0, left - 4);
        else if (right > body.scrollLeft + body.clientWidth) body.scrollLeft = right - body.clientWidth + 8;
      }
    }
  };

  const markFilled = (): void => {
    fillTimer = 0;
    const p = editor.project;
    if (p.frames.length * p.layers.length * p.width * p.height > 60_000_000) return;
    cells.forEach((row, r) => {
      const layer = p.layers[p.layers.length - 1 - r]!;
      row.forEach((c, i) => {
        const cel = p.frames[i]?.cels.get(layer.id);
        c.classList.toggle('filled', !!cel && hasPixels(cel));
      });
    });
  };

  const syncControls = (): void => {
    const p = editor.project;
    const { from, to } = editor.frameRange;
    const sel = p.frames.slice(from, to + 1);
    const dur = $<HTMLInputElement>('fDur');
    if (document.activeElement !== dur) {
      const first = frameDuration(p, sel[0]!);
      dur.value = String(first);
      dur.classList.toggle('mixed', sel.some((f) => frameDuration(p, f) !== first));
    }
    const fps = $<HTMLInputElement>('fps');
    if (document.activeElement !== fps) fps.value = String(p.fps);
    $<HTMLButtonElement>('fAdd').disabled = !editor.canAddFrame;
    $<HTMLButtonElement>('fDup').disabled = p.frames.length + (to - from + 1) > MAX_FRAMES;
    $<HTMLButtonElement>('fDel').disabled = to - from + 1 >= p.frames.length;
    $<HTMLButtonElement>('fLeft').disabled = editor.activeFrame <= 0;
    $<HTMLButtonElement>('fRight').disabled = editor.activeFrame >= p.frames.length - 1;
    $<HTMLButtonElement>('celPaste').disabled = editor.celClipboard === null;
    const o = editor.onion;
    $<HTMLInputElement>('onionOn').checked = o.enabled;
    for (const [id, v] of [['onionPrev', o.prev], ['onionNext', o.next]] as const) {
      const el = $<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = String(v);
    }
    $<HTMLInputElement>('onionOpacity').value = String(Math.round(o.opacity * 100));
  };

  function refresh(): void {
    const k = structureKey();
    if (k !== key) { key = k; lastActiveFrame = -1; build(); }
    paintSelection();
    syncControls();
    if (!fillTimer) fillTimer = window.setTimeout(markFilled, 250);
  }

  // Grid interactions
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const bar = t.closest<HTMLElement>('[data-tag]');
    if (bar) { openTagDialog(bar.dataset.tag!); return; }
    const lab = t.closest<HTMLElement>('.tllabel');
    if (lab) { editor.setActiveLayer(Number(lab.dataset.l)); return; }
    const c = t.closest<HTMLElement>('[data-f]');
    if (!c) return;
    editor.setActiveFrame(Number(c.dataset.f), e.shiftKey);
    if (c.dataset.l !== undefined) editor.setActiveLayer(Number(c.dataset.l));
  });
  body.addEventListener('dragstart', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('.tlhead');
    if (!h) return;
    dragFrom = Number(h.dataset.f);
    e.dataTransfer?.setData('text/plain', String(dragFrom));
  });
  body.addEventListener('dragover', (e) => { if (dragFrom >= 0 && (e.target as HTMLElement).closest('.tlhead')) e.preventDefault(); });
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    const h = (e.target as HTMLElement).closest<HTMLElement>('.tlhead');
    const from = dragFrom;
    dragFrom = -1;
    if (h && from >= 0) editor.moveFrame(from, Number(h.dataset.f));
  });
  body.addEventListener('dragend', () => { dragFrom = -1; });

  // Toolbar
  $('fAdd').addEventListener('click', () => editor.addFrame());
  $('fDup').addEventListener('click', () => editor.duplicateFrames());
  $('fDel').addEventListener('click', () => editor.deleteFrames());
  $('fLeft').addEventListener('click', () => editor.moveFrame(editor.activeFrame, editor.activeFrame - 1));
  $('fRight').addEventListener('click', () => editor.moveFrame(editor.activeFrame, editor.activeFrame + 1));
  $('celCopy').addEventListener('click', () => { if (!editor.copyCel()) notify('Nothing to copy.'); });
  $('celPaste').addEventListener('click', () => { if (!editor.pasteCel()) notify('That layer cannot be pasted into (locked, hidden or a reference layer).'); });
  const dur = $<HTMLInputElement>('fDur');
  dur.addEventListener('change', () => { if (dur.value !== '') editor.setFrameDuration(Number(dur.value)); });
  $('fDurAuto').addEventListener('click', () => editor.setFrameDuration(undefined));
  const fps = $<HTMLInputElement>('fps');
  fps.addEventListener('change', () => { if (fps.value !== '') editor.setFps(Number(fps.value)); });
  $<HTMLInputElement>('onionOn').addEventListener('change', (e) => editor.setOnion({ enabled: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('onionPrev').addEventListener('input', (e) => editor.setOnion({ prev: Number((e.target as HTMLInputElement).value) || 0 }));
  $<HTMLInputElement>('onionNext').addEventListener('input', (e) => editor.setOnion({ next: Number((e.target as HTMLInputElement).value) || 0 }));
  $<HTMLInputElement>('onionOpacity').addEventListener('input', (e) => editor.setOnion({ opacity: Number((e.target as HTMLInputElement).value) / 100 }));

  // Tag dialog
  const dlg = $<HTMLDialogElement>('tagDlg');
  const field = {
    name: $<HTMLInputElement>('tagName'), from: $<HTMLInputElement>('tagFrom'), to: $<HTMLInputElement>('tagTo'),
    dir: $<HTMLSelectElement>('tagDir'), loop: $<HTMLInputElement>('tagLoop'),
  };
  function openTagDialog(id: string | null): void {
    editingTag = id;
    const t = id ? editor.project.tags.find((x) => x.id === id) : undefined;
    const { from, to } = editor.frameRange;
    field.name.value = t?.name ?? `Tag ${editor.project.tags.length + 1}`;
    field.from.value = String((t?.from ?? from) + 1);
    field.to.value = String((t?.to ?? to) + 1);
    field.dir.value = t?.direction ?? 'forward';
    field.loop.checked = t?.loop ?? true;
    $('tagDelete').classList.toggle('hidden', !t);
    field.from.max = field.to.max = String(editor.project.frames.length);
    dlg.showModal();
    field.name.select();
  }
  $('tagAdd').addEventListener('click', () => openTagDialog(null));
  dlg.addEventListener('close', () => {
    const id = editingTag;
    if (dlg.returnValue === 'delete' && id) { editor.removeTag(id); return; }
    if (dlg.returnValue !== 'ok') return;
    const from = Number(field.from.value) - 1, to = Number(field.to.value) - 1;
    const dir = field.dir.value as TagDirection;
    if (id) editor.updateTag(id, { name: field.name.value, from, to, direction: dir, loop: field.loop.checked });
    else if (!editor.addTag(field.name.value, from, to, dir, field.loop.checked)) notify('That frame range is outside the animation.');
  });

  refresh();
  return { refresh };
}
