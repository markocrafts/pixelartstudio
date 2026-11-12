import { frameDuration, playbackSequence } from '../core/animation';
import { compositeFrame } from '../core/composite';
import type { Editor } from '../core/editor';
import type { TagDirection } from '../core/project';
import { celToImageData } from '../render/imagedata';

export const PREVIEW_TEMPLATE = `
<section class="panel" id="previewPanel">
  <header><h4>Preview</h4><span class="spacer"></span><span class="hint" id="pvInfo"></span></header>
  <div class="pvwrap"><canvas id="pvCanvas" width="200" height="200"></canvas></div>
  <div class="panelbtns">
    <button id="pvPlay" title="Play or pause the animation">Play</button>
    <button id="pvPrev" title="Previous frame (,)">&#9664;</button>
    <button id="pvNext" title="Next frame (.)">&#9654;</button>
    <label class="srow"><input type="checkbox" id="pvLoop" checked> Loop</label>
  </div>
  <label class="srow">Mode <select id="pvMode"><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="pingpong">Ping-pong</option></select></label>
  <label class="srow">Range <select id="pvRange"></select></label>
</section>`;

/** Preview window: plays the animation (all frames or a tag) without moving the editing cursor. */
export function mountPreview(root: HTMLElement, editor: Editor): { refresh(): void; togglePlay(): void } {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const canvas = $<HTMLCanvasElement>('pvCanvas');
  const ctx = canvas.getContext('2d')!;
  const off = document.createElement('canvas');
  let playing = false;
  let timer = 0;
  let seq: number[] = [];
  let pos = 0;
  let showing = -1; // frame currently shown while playing
  let rangeKey = '';

  const settings = (): { direction: TagDirection; loop: boolean; from: number; to: number } => {
    const p = editor.project;
    const tag = p.tags.find((t) => t.id === $<HTMLSelectElement>('pvRange').value);
    if (tag) return { direction: tag.direction, loop: tag.loop, from: tag.from, to: tag.to };
    return { direction: $<HTMLSelectElement>('pvMode').value as TagDirection, loop: $<HTMLInputElement>('pvLoop').checked, from: 0, to: p.frames.length - 1 };
  };

  const draw = (index: number): void => {
    const p = editor.project;
    const frame = p.frames[Math.min(index, p.frames.length - 1)];
    if (!frame) return;
    off.width = p.width;
    off.height = p.height;
    off.getContext('2d')!.putImageData(celToImageData(compositeFrame(p, frame), p.width, p.height), 0, 0);
    const z = Math.max(1, Math.floor(Math.min(canvas.width / p.width, canvas.height / p.height)));
    const w = p.width * z, h = p.height * z;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2a2a33';
    ctx.fillRect((canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
    $('pvInfo').textContent = `${index + 1} / ${p.frames.length}`;
  };

  const stop = (): void => {
    playing = false;
    clearTimeout(timer);
    showing = -1;
    $('pvPlay').textContent = 'Play';
    draw(editor.activeFrame);
  };

  const tick = (): void => {
    const p = editor.project;
    const s = settings();
    if (pos >= seq.length) {
      if (!s.loop) { stop(); return; }
      pos = 0;
    }
    const idx = seq[pos++]!;
    const frame = p.frames[idx];
    if (!frame) { stop(); return; }
    showing = idx;
    draw(idx);
    timer = window.setTimeout(tick, frameDuration(p, frame));
  };

  const play = (): void => {
    const s = settings();
    const p = editor.project;
    seq = playbackSequence(Math.min(s.from, p.frames.length - 1), Math.min(s.to, p.frames.length - 1), s.direction);
    pos = 0;
    playing = true;
    $('pvPlay').textContent = 'Pause';
    tick();
  };

  const togglePlay = (): void => { if (playing) stop(); else play(); };
  $('pvPlay').addEventListener('click', togglePlay);
  $('pvPrev').addEventListener('click', () => { if (playing) stop(); editor.setActiveFrame((editor.activeFrame - 1 + editor.project.frames.length) % editor.project.frames.length); });
  $('pvNext').addEventListener('click', () => { if (playing) stop(); editor.setActiveFrame((editor.activeFrame + 1) % editor.project.frames.length); });
  for (const id of ['pvMode', 'pvRange', 'pvLoop']) $(id).addEventListener('change', () => { if (playing) { clearTimeout(timer); play(); } });
  $<HTMLSelectElement>('pvMode').addEventListener('change', () => { $<HTMLSelectElement>('pvRange').value = 'all'; });

  function refresh(): void {
    const p = editor.project;
    const k = p.id + JSON.stringify(p.tags.map((t) => [t.id, t.name]));
    if (k !== rangeKey) {
      rangeKey = k;
      const sel = $<HTMLSelectElement>('pvRange');
      const cur = sel.value;
      sel.replaceChildren(new Option('All frames', 'all'), ...p.tags.map((t) => new Option(`Tag: ${t.name}`, t.id)));
      if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
      $<HTMLSelectElement>('pvMode').disabled = false;
    }
    const tagged = $<HTMLSelectElement>('pvRange').value !== 'all';
    $<HTMLSelectElement>('pvMode').disabled = tagged;
    $<HTMLInputElement>('pvLoop').disabled = tagged;
    if (playing) {
      // Keep going, but stop if the project shrank under us.
      if (showing >= p.frames.length) stop();
    } else draw(editor.activeFrame);
  }

  refresh();
  return { refresh, togglePlay };
}
