import type { Editor } from '../core/editor';
import { serializePxf } from '../core/pxf';
import { downloadBlob } from '../io/png';
import {
  deleteProject, listProjects, loadProject, loadProjectBytes, nearlyFull, renameStored, storageUsage, type ProjectMeta,
} from '../storage/db';
import type { AutosaveHandle } from '../storage/autosave';

export const GALLERY_TEMPLATE = `
<dialog id="galleryDlg" class="gallery">
  <div class="ghead">
    <h3>Projects</h3>
    <span class="spacer"></span>
    <span id="gUsage" class="hint"></span>
    <button id="gNew">New&hellip;</button>
    <button id="gOpenFile" title="Open a .pxf, .aseprite, GIF or image file">Open file&hellip;</button>
    <button id="gClose">Close</button>
  </div>
  <div id="gWarn" class="gwarn hidden"></div>
  <div class="gcards" id="gCards"></div>
</dialog>`;

const fmtBytes = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fmtDate = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Gallery: stored projects with thumbnails; open, duplicate, rename, delete, download as .pxf. */
export function mountGallery(root: HTMLElement, editor: Editor, autosave: AutosaveHandle, hooks: { newProject(): void; openFile(): void; notify(msg: string): void }): { open(): Promise<void> } {
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const dlg = $<HTMLDialogElement>('galleryDlg');
  const cards = $('gCards');

  async function render(): Promise<void> {
    let list: ProjectMeta[] = [];
    try { list = await listProjects(); } catch { hooks.notify('Could not read stored projects.'); }
    cards.replaceChildren(...list.map((m) => {
      const card = document.createElement('div');
      card.className = 'gcard' + (m.id === editor.project.id ? ' current' : '');
      card.dataset.id = m.id;
      const img = document.createElement('img');
      img.alt = '';
      img.src = m.thumb;
      img.className = 'gthumb';
      img.dataset.act = 'open';
      const name = document.createElement('div');
      name.className = 'gname';
      name.textContent = m.name;
      name.title = m.name;
      const info = document.createElement('div');
      info.className = 'hint';
      info.textContent = `${m.width}×${m.height} · ${m.frames} frame${m.frames === 1 ? '' : 's'} · ${m.layers} layer${m.layers === 1 ? '' : 's'} · ${fmtBytes(m.bytes)}`;
      const when = document.createElement('div');
      when.className = 'hint';
      when.textContent = fmtDate(m.updatedAt);
      const btns = document.createElement('div');
      btns.className = 'gbtns';
      for (const [act, label] of [['open', 'Open'], ['dup', 'Duplicate'], ['rename', 'Rename'], ['pxf', '.pxf'], ['del', 'Delete']] as const) {
        const b = document.createElement('button');
        b.dataset.act = act;
        b.textContent = label;
        btns.append(b);
      }
      card.append(img, name, info, when, btns);
      return card;
    }));
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No saved projects yet. Your work is saved automatically as you draw.';
      cards.replaceChildren(empty);
    }
    const u = await storageUsage();
    $('gUsage').textContent = u ? `Storage: ${fmtBytes(u.usage)} of ${fmtBytes(u.quota)}` : '';
    const warn = $('gWarn');
    warn.classList.toggle('hidden', !nearlyFull(u));
    warn.textContent = 'Browser storage is almost full. Download projects you want to keep as .pxf and delete the rest.';
  }

  async function open(): Promise<void> {
    await autosave.save();
    await render();
    if (!dlg.open) dlg.showModal();
  }

  cards.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const card = t?.closest<HTMLElement>('.gcard');
    if (!t || !card) return;
    const id = card.dataset.id!;
    const act = t.dataset.act;
    try {
      if (act === 'open') {
        if (id !== editor.project.id) {
          const p = await loadProject(id);
          if (!p) { hooks.notify('That project could not be found.'); return; }
          editor.openProject(p);
          autosave.remember(id);
        }
        dlg.close();
      } else if (act === 'dup') {
        const p = await loadProject(id);
        if (!p) return;
        p.id = `${p.id}_copy${Date.now().toString(36)}`;
        p.name = `${p.name} copy`;
        editor.openProject(p); // opening stores it; the original stays in the list
        dlg.close();
      } else if (act === 'rename') {
        const meta = card.querySelector('.gname')!.textContent ?? '';
        const name = prompt('Rename project', meta);
        if (name === null) return;
        if (id === editor.project.id) editor.renameProject(name);
        else await renameStored(id, name);
        await autosave.save();
        await render();
      } else if (act === 'pxf') {
        const bytes = id === editor.project.id ? serializePxf(editor.project) : await loadProjectBytes(id);
        if (bytes) downloadBlob(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), `${(card.querySelector('.gname')!.textContent ?? 'project').replace(/[^\w.-]+/g, '_')}.pxf`);
      } else if (act === 'del') {
        if (!confirm(`Delete "${card.querySelector('.gname')!.textContent}"? This cannot be undone.`)) return;
        await deleteProject(id);
        if (id === editor.project.id) editor.newProject({ width: editor.project.width, height: editor.project.height });
        await render();
      }
    } catch (err) {
      hooks.notify(err instanceof Error ? err.message : 'That action failed.');
    }
  });
  $('gNew').addEventListener('click', () => { dlg.close(); hooks.newProject(); });
  $('gOpenFile').addEventListener('click', () => { dlg.close(); hooks.openFile(); });
  $('gClose').addEventListener('click', () => dlg.close());
  return { open };
}
