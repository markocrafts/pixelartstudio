import { parseAseprite } from '../core/aseprite';
import { Editor, type ToolId, type ToolOptions } from '../core/editor';
import { lookupAction, normalizeKey, overridesOf, resolveBindings, type Bindings } from '../core/keymap';
import { hexToPacked, packedToHex, unpackRGBA } from '../core/pixels';
import { MAX_CANVAS_SIZE, WHITE, uid } from '../core/project';
import { parsePxf, serializePxf } from '../core/pxf';
import { readImageBlob, writeSystemClipboard } from '../io/clipboard';
import { EXPORT_SCALES, downloadBlob, exportPngBlob } from '../io/png';
import { Renderer } from '../render/renderer';
import { hasProject, loadProject, storageAvailable } from '../storage/db';
import { startAutosave } from '../storage/autosave';
import { Viewport } from '../render/viewport';
import { openColorPicker, type PickerHandle } from './colorpicker';
import { ANIM_DIALOGS_TEMPLATE, mountAnimIo } from './anim-export';
import { GALLERY_TEMPLATE, mountGallery } from './gallery';
import { loadPrefs, savePrefs, type Theme } from './prefs';
import { SETTINGS_TEMPLATE, mountSettings } from './settings';
import { LAYERS_TEMPLATE, mountLayers } from './layers';
import { PALETTE_TEMPLATE, mountPalette } from './palette-panel';
import { PREVIEW_TEMPLATE, mountPreview } from './preview';
import { TIMELINE_TEMPLATE, mountTimeline } from './timeline';
import './style.css';

const TOOLS: Array<{ id: ToolId; label: string }> = [
  { id: 'pencil', label: 'Pencil' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'bucket', label: 'Fill' },
  { id: 'picker', label: 'Picker' },
  { id: 'line', label: 'Line' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'shading', label: 'Shading' },
  { id: 'dither', label: 'Dither' },
  { id: 'select', label: 'Select' },
  { id: 'lasso', label: 'Lasso' },
  { id: 'wand', label: 'Wand' },
  { id: 'move', label: 'Move' },
  { id: 'text', label: 'Text' },
];
const SEPARATOR_AFTER = new Set<ToolId>(['picker', 'dither', 'wand']);
const PRESETS = [16, 32, 64, 128, 256];
const BRUSH_TOOLS = 'pencil eraser line rect ellipse shading dither';
const PATTERNS = '<option value="bayer4">Bayer 4&times;4</option><option value="bayer2">Bayer 2&times;2</option><option value="checker">Checker</option>';

const anchorCell = (i: number): string =>
  `<label title="Anchor"><input type="radio" name="anchor" value="${i}"${i === 4 ? ' checked' : ''}></label>`;

const TEMPLATE = `
<div class="bar">
  <div class="group">
    <button id="gallery" title="Your saved projects">Gallery</button>
    <input type="text" id="pname" class="pname" maxlength="128" title="Project name" spellcheck="false">
  </div>
  <div class="group">
    <button id="undo" title="Undo (Ctrl+Z)">Undo</button>
    <button id="redo" title="Redo (Ctrl+Y)">Redo</button>
  </div>
  <div class="group colors">
    <button class="colorbtn" id="primary" title="Primary color (click to edit)"><span></span></button>
    <button class="colorbtn" id="secondary" title="Secondary color (click to edit)"><span></span></button>
    <button id="swap" title="Swap colors (X)">&#8644;</button>
    <div class="recent" id="recent" title="Recent colors (right-click sets secondary)"></div>
  </div>
  <div class="group">
    <button id="new">New&hellip;</button>
    <select id="scale" title="Export scale">${EXPORT_SCALES.map((s) => `<option value="${s}">${s}&times;</option>`).join('')}</select>
    <button id="export">Export PNG</button>
    <button id="exportAnim" title="Export GIF, sprite sheet or video">Animation&hellip;</button>
    <button id="importAnim" title="Open a .pxf, .aseprite, GIF or image file">Open file&hellip;</button>
    <button id="savePxf" title="Download this project as a .pxf file">Save .pxf</button>
    <input type="file" id="importFile" accept=".pxf,.ase,.aseprite,image/gif,image/png,image/jpeg,image/webp,.gif" class="hidden">
  </div>
  <div class="group">
    <button id="settings" title="Theme, grid and keyboard shortcuts">Settings</button>
    <button id="help" title="Keyboard shortcuts (?)">?</button>
  </div>
</div>
<div class="bar edit">
  <div class="group">
    <button id="selAll" title="Select all (Ctrl+A)">All</button>
    <button id="selNone" title="Deselect (Ctrl+D)">None</button>
    <button id="selInv" title="Invert selection (Ctrl+Shift+I)">Invert</button>
    <button id="selColor" title="Select every pixel of the primary color">By color</button>
  </div>
  <div class="group">
    <button id="copy" title="Copy (Ctrl+C)">Copy</button>
    <button id="cut" title="Cut (Ctrl+X)">Cut</button>
    <button id="paste" title="Paste (Ctrl+V)">Paste</button>
    <button id="del" title="Clear selection (Delete)">Clear</button>
  </div>
  <div class="group" title="Applies to the selection, or the whole canvas when nothing is selected">
    <button id="flipH">Flip &harr;</button>
    <button id="flipV">Flip &updownarrow;</button>
    <button id="rotL">&#8634; 90&deg;</button>
    <button id="rotR">&#8635; 90&deg;</button>
  </div>
  <div class="group">
    <button id="canvasSize">Canvas size&hellip;</button>
    <button id="crop" title="Crop the canvas to the selection">Crop</button>
    <button id="trim" title="Trim transparent edges">Trim</button>
  </div>
  <div class="group">
    <button id="capBrush" title="Use the selection as a brush">Make brush</button>
    <button id="clrBrush">Clear brush</button>
  </div>
  <div class="group">
    <label><input type="checkbox" id="symX"> Mirror &harr;</label>
    <label><input type="checkbox" id="symY"> Mirror &updownarrow;</label>
    <label title="Preview the canvas repeated 3×3; drawing wraps around the edges"><input type="checkbox" id="tile"> Tile mode</label>
  </div>
</div>
<div class="bar options" id="options">
  <div class="group" data-for="${BRUSH_TOOLS}">
    <label>Size <input type="number" class="narrow" id="size" min="1" max="64"></label>
    <label>Shape <select id="shape"><option value="square">Square</option><option value="circle">Circle</option></select></label>
  </div>
  <div class="group" data-for="pencil eraser">
    <label><input type="checkbox" id="pixelPerfect"> Pixel-perfect</label>
    <label><input type="checkbox" id="pressureSize"> Pen pressure &rarr; size</label>
  </div>
  <div class="group" data-for="pencil">
    <label><input type="checkbox" id="useCustomBrush"> Custom brush</label>
    <label><input type="checkbox" id="customTint"> Tint with color</label>
  </div>
  <div class="group" data-for="rect ellipse">
    <label><input type="checkbox" id="filled"> Filled</label>
    <span class="hint">Shift = square / circle</span>
  </div>
  <div class="group" data-for="line"><span class="hint">Shift = snap to 15&deg;</span></div>
  <div class="group" data-for="bucket">
    <label><input type="checkbox" id="fillContiguous"> Contiguous</label>
    <label>Tolerance <input type="number" class="narrow" id="tolerance" min="0" max="100"></label>
    <label><input type="checkbox" id="fillSampleAll"> Sample all layers</label>
  </div>
  <div class="group" data-for="picker">
    <label><input type="checkbox" id="pickSampleAll"> Sample composite</label>
  </div>
  <div class="group" data-for="gradient">
    <label>Type <select id="gradientKind"><option value="linear">Linear</option><option value="radial">Radial</option></select></label>
    <label>Dither <select id="gradientPattern"><option value="none">None</option>${PATTERNS}</select></label>
    <span class="hint">Drag from start to end &middot; primary &rarr; secondary</span>
  </div>
  <div class="group" data-for="shading">
    <label>Mode <select id="shadeMode"><option value="lighten">Lighten</option><option value="darken">Darken</option></select></label>
    <label>Amount % <input type="number" class="narrow" id="shadeAmount" min="1" max="50"></label>
    <span class="hint">Right-click inverts &middot; uses the palette ramp when the palette has 2+ colors</span>
  </div>
  <div class="group" data-for="dither">
    <label>Pattern <select id="ditherPattern">${PATTERNS}</select></label>
    <label>Density % <input type="number" class="narrow" id="ditherDensity" min="0" max="100"></label>
    <label><input type="checkbox" id="ditherFillSecondary"> Fill gaps with secondary</label>
  </div>
  <div class="group" data-for="select lasso wand">
    <span class="hint">Shift = add &middot; Alt = subtract &middot; click = deselect</span>
  </div>
  <div class="group" data-for="wand">
    <label><input type="checkbox" id="wandContiguous"> Contiguous</label>
    <label>Tolerance <input type="number" class="narrow" id="wandTolerance" min="0" max="100"></label>
  </div>
  <div class="group" data-for="lasso">
    <label><input type="checkbox" id="lassoPolygon"> Polygon (click points, Enter or double-click to close)</label>
  </div>
  <div class="group" data-for="move">
    <span class="hint">Drag or use arrow keys (Shift = 10 px) &middot; Enter commits &middot; Esc cancels</span>
  </div>
  <div class="group" data-for="text">
    <label>Text <input type="text" id="text"></label>
    <label>Font <select id="font"><option value="5x7">5&times;7</option><option value="3x5">3&times;5</option></select></label>
    <label>Scale <input type="number" class="narrow" id="textScale" min="1" max="16"></label>
    <span class="hint">Click to place &middot; lowercase renders as capitals</span>
  </div>
</div>
<div class="main">
  <div class="toolcol" id="tools">${TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.label}">${t.label}<kbd></kbd></button>${SEPARATOR_AFTER.has(t.id) ? '<hr>' : ''}`).join('')}</div>
  <div class="stage" id="stage"><canvas id="canvas"></canvas></div>
  <aside class="side" id="side">${PREVIEW_TEMPLATE}${LAYERS_TEMPLATE}${PALETTE_TEMPLATE}</aside>
</div>
${TIMELINE_TEMPLATE}
<div class="toast hidden" id="toast" role="status"></div>
<div class="status">
  <span id="coords">&ndash;</span>
  <span id="info"></span>
  <span class="spacer"></span>
  <button id="zout" title="Zoom out (-)">&minus;</button>
  <span id="zoom" style="min-width:42px;text-align:center"></span>
  <button id="zin" title="Zoom in (+)">+</button>
  <button id="fit">Fit</button>
  <button id="actual">100%</button>
  <label><input type="checkbox" id="grid" checked> Grid</label>
  <button id="toggleSide" title="Show or hide the Preview / Layers / Palette panels">Panels</button>
  <button id="toggleTl" title="Show or hide the timeline">Timeline</button>
</div>
<dialog id="newdlg">
  <form method="dialog" id="newform">
    <h3>New project</h3>
    <div class="row"><span>Preset</span><select id="preset">${PRESETS.map((p) => `<option value="${p}">${p} &times; ${p}</option>`).join('')}<option value="custom">Custom</option></select></div>
    <div class="row"><span>Size</span><input type="number" id="nw" min="1" max="${MAX_CANVAS_SIZE}" value="32"> &times; <input type="number" id="nh" min="1" max="${MAX_CANVAS_SIZE}" value="32"></div>
    <div class="row"><span>Background</span><select id="bg"><option value="transparent">Transparent</option><option value="white">White</option><option value="color">Color</option></select><input type="color" id="bgcolor" value="#ffffff" class="hidden"></div>
    <div class="actions"><button value="cancel">Cancel</button><button value="ok" class="active">Create</button></div>
  </form>
</dialog>
${ANIM_DIALOGS_TEMPLATE}
${GALLERY_TEMPLATE}
${SETTINGS_TEMPLATE}
<dialog id="sizedlg">
  <form method="dialog" id="sizeform">
    <h3>Canvas size</h3>
    <div class="row"><span>Size</span><input type="number" id="cw" min="1" max="${MAX_CANVAS_SIZE}"> &times; <input type="number" id="ch" min="1" max="${MAX_CANVAS_SIZE}"></div>
    <div class="row"><span>Mode</span><select id="sizeMode"><option value="resize">Resize canvas (keeps pixels)</option><option value="scale">Scale image (nearest)</option></select></div>
    <div class="row" id="anchorRow"><span>Anchor</span><div class="anchors">${Array.from({ length: 9 }, (_, i) => anchorCell(i)).join('')}</div></div>
    <div class="actions"><button value="cancel">Cancel</button><button value="ok" class="active">Apply</button></div>
  </form>
</dialog>`;

/** Option inputs bound to ToolOptions keys. */
const OPTION_BINDINGS: Array<{ id: string; key: keyof ToolOptions; type: 'num' | 'bool' | 'str' }> = [
  { id: 'size', key: 'size', type: 'num' }, { id: 'shape', key: 'shape', type: 'str' },
  { id: 'pixelPerfect', key: 'pixelPerfect', type: 'bool' }, { id: 'pressureSize', key: 'pressureSize', type: 'bool' },
  { id: 'useCustomBrush', key: 'useCustomBrush', type: 'bool' }, { id: 'customTint', key: 'customTint', type: 'bool' },
  { id: 'filled', key: 'filled', type: 'bool' },
  { id: 'fillContiguous', key: 'fillContiguous', type: 'bool' }, { id: 'tolerance', key: 'tolerance', type: 'num' },
  { id: 'fillSampleAll', key: 'fillSampleAll', type: 'bool' }, { id: 'pickSampleAll', key: 'pickSampleAll', type: 'bool' },
  { id: 'gradientKind', key: 'gradientKind', type: 'str' }, { id: 'gradientPattern', key: 'gradientPattern', type: 'str' },
  { id: 'shadeMode', key: 'shadeMode', type: 'str' }, { id: 'shadeAmount', key: 'shadeAmount', type: 'num' },
  { id: 'ditherPattern', key: 'ditherPattern', type: 'str' }, { id: 'ditherDensity', key: 'ditherDensity', type: 'num' },
  { id: 'ditherFillSecondary', key: 'ditherFillSecondary', type: 'bool' },
  { id: 'wandContiguous', key: 'wandContiguous', type: 'bool' }, { id: 'wandTolerance', key: 'wandTolerance', type: 'num' },
  { id: 'lassoPolygon', key: 'lassoPolygon', type: 'bool' },
  { id: 'text', key: 'text', type: 'str' }, { id: 'font', key: 'font', type: 'str' }, { id: 'textScale', key: 'textScale', type: 'num' },
];

export function mountApp(root: HTMLElement): { editor: Editor } {
  root.innerHTML = TEMPLATE;
  const $ = <T extends HTMLElement>(id: string): T => root.querySelector<T>('#' + id)!;
  const editor = new Editor();
  const prefs = loadPrefs();
  let bindings: Bindings = resolveBindings(prefs.keys);
  const vp = new Viewport();
  const stage = $('stage');
  const canvas = $<HTMLCanvasElement>('canvas');
  const renderer = new Renderer(canvas, editor, vp);

  const applyTheme = (t: Theme): void => {
    prefs.theme = t;
    document.documentElement.dataset.theme = t;
    renderer.stageColor = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#16161c';
    renderer.requestDraw();
  };
  const applyGrid = (): void => {
    renderer.customGrid = { w: prefs.grid.w, h: prefs.grid.h, color: prefs.grid.color };
    renderer.showGrid = prefs.grid.show;
    renderer.requestDraw();
  };
  const renderToolKeys = (): void => {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const key = bindings[`tool:${b.dataset.tool}`] ?? '';
      b.querySelector('kbd')!.textContent = key.toUpperCase();
      const label = TOOLS.find((t) => t.id === b.dataset.tool)?.label ?? '';
      b.title = key ? `${label} (${key.toUpperCase()})` : label;
    }
  };
  const persist = (): void => {
    prefs.tool = editor.tool;
    prefs.primary = editor.primary;
    prefs.secondary = editor.secondary;
    prefs.options = { ...editor.options };
    prefs.onion = { ...editor.onion };
    prefs.keys = overridesOf(bindings);
    savePrefs(prefs);
  };
  // Restore saved preferences (only known option keys with matching types).
  for (const [k, v] of Object.entries(prefs.options)) {
    const cur = (editor.options as unknown as Record<string, unknown>)[k];
    if (cur !== undefined && typeof cur === typeof v) (editor.options as unknown as Record<string, unknown>)[k] = v;
  }
  editor.setOptions({});
  editor.primary = prefs.primary;
  editor.secondary = prefs.secondary;
  if (TOOLS.some((t) => t.id === prefs.tool)) editor.tool = prefs.tool as ToolId;
  if (prefs.onion) editor.setOnion(prefs.onion);
  applyTheme(prefs.theme);
  applyGrid();

  const updateInfo = (): void => {
    $('zoom').textContent = `${vp.zoom * 100}%`;
    $('info').textContent = `${editor.project.width} × ${editor.project.height}`;
  };
  const fitView = (): void => {
    const p = editor.project;
    vp.fit(renderer.width, renderer.height, p.width, p.height);
    updateInfo();
    renderer.requestDraw();
  };

  let toastTimer = 0;
  const notify = (msg: string): void => {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.add('hidden'), 4000);
  };
  const layersPanel = mountLayers($('layersPanel'), editor, notify);
  const palettePanel = mountPalette($('palettePanel'), editor, notify);
  const timeline = mountTimeline(root, editor, notify);
  const preview = mountPreview($('previewPanel'), editor);
  const animIo = mountAnimIo(root, editor, notify);
  const settingsUi = mountSettings(root, prefs, () => bindings, {
    theme: (t) => { applyTheme(t); persist(); },
    grid: () => { applyGrid(); persist(); },
    keys: (b) => { bindings = b; renderToolKeys(); },
    changed: persist,
  });
  renderToolKeys();
  const autosave = startAutosave(editor, notify);

  // ---- Option inputs ---------------------------------------------------------
  for (const b of OPTION_BINDINGS) {
    const el = $<HTMLInputElement | HTMLSelectElement>(b.id);
    const v = editor.options[b.key];
    if (b.type === 'bool') (el as HTMLInputElement).checked = v as boolean; else el.value = String(v);
    el.addEventListener(b.type === 'bool' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const raw = b.type === 'bool' ? (el as HTMLInputElement).checked : el.value;
      if (b.type === 'num' && el.value === '') return;
      editor.setOptions({ [b.key]: b.type === 'num' ? Number(raw) : raw } as Partial<ToolOptions>);
    });
  }

  // ---- UI state sync -----------------------------------------------------------
  let lastProjectId = editor.project.id;
  let lastW = editor.project.width;
  let lastH = editor.project.height;
  let lastRecent = '';
  const setChecked = (id: string, v: boolean): void => { const el = $<HTMLInputElement>(id); if (el.checked !== v) el.checked = v; };

  const paintColorButton = (btn: HTMLElement, c: number): void => {
    const [r, g, b, a] = unpackRGBA(c);
    (btn.firstElementChild as HTMLElement).style.setProperty('--c', `rgba(${r},${g},${b},${a / 255})`);
    btn.title = `${btn.id === 'primary' ? 'Primary' : 'Secondary'} color ${packedToHex(c)}${a < 255 ? ` @ ${Math.round((a / 255) * 100)}%` : ''} (click to edit)`;
  };
  let picker: PickerHandle | null = null;

  const sync = (): void => {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) b.classList.toggle('active', b.dataset.tool === editor.tool);
    for (const g of root.querySelectorAll<HTMLElement>('[data-for]')) g.classList.toggle('hidden', !g.dataset.for!.split(' ').includes(editor.tool));
    $<HTMLButtonElement>('undo').disabled = !editor.canUndo;
    $<HTMLButtonElement>('redo').disabled = !editor.canRedo;
    paintColorButton($('primary'), editor.primary);
    paintColorButton($('secondary'), editor.secondary);
    if (picker) picker.setColor(picker.anchor.id === 'primary' ? editor.primary : editor.secondary);
    layersPanel.refresh();
    const pn = $<HTMLInputElement>('pname');
    if (document.activeElement !== pn && pn.value !== editor.project.name) pn.value = editor.project.name;
    setChecked('tile', editor.tileMode);
    persist();
    palettePanel.refresh();
    timeline.refresh();
    preview.refresh();
    const recentKey = editor.recent.join(',');
    if (recentKey !== lastRecent) {
      lastRecent = recentKey;
      $('recent').replaceChildren(...editor.recent.map((c) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      const [r, g, bl, a] = unpackRGBA(c);
      b.style.background = `rgba(${r},${g},${bl},${a / 255})`;
      b.title = packedToHex(c);
      b.dataset.color = String(c);
      return b;
      }));
    }
    const hasSel = editor.selection !== null;
    for (const id of ['copy', 'cut', 'del', 'selNone', 'crop', 'capBrush']) $<HTMLButtonElement>(id).disabled = id === 'copy' || id === 'cut' || id === 'del' ? false : !hasSel;
    $<HTMLButtonElement>('paste').disabled = editor.clipboard === null;
    $<HTMLButtonElement>('clrBrush').disabled = editor.customBrush === null;
    setChecked('useCustomBrush', editor.options.useCustomBrush);
    setChecked('symX', editor.symmetry.x);
    setChecked('symY', editor.symmetry.y);
    const { width: w, height: h } = editor.project;
    if (editor.project.id !== lastProjectId || w !== lastW || h !== lastH) {
      lastProjectId = editor.project.id;
      lastW = w;
      lastH = h;
      fitView();
    }
    updateInfo();
    renderer.invalidate();
  };
  editor.subscribe(sync);

  // ---- Toolbars ------------------------------------------------------------------
  root.querySelector('#tools')!.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
    if (t) editor.setTool(t.dataset.tool as ToolId);
  });
  $('undo').addEventListener('click', () => editor.undo());
  $('redo').addEventListener('click', () => editor.redo());
  $('swap').addEventListener('click', () => editor.swapColors());
  for (const id of ['primary', 'secondary'] as const) {
    $(id).addEventListener('click', () => {
      const wasOpen = picker?.anchor.id === id;
      picker?.close();
      picker = null;
      if (wasOpen) return;
      const set = id === 'primary' ? editor.setPrimary.bind(editor) : editor.setSecondary.bind(editor);
      const handle = openColorPicker($(id), id === 'primary' ? editor.primary : editor.secondary, set);
      picker = handle;
    });
  }
  $('recent').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
    if (b) editor.setPrimary(Number(b.dataset.color));
  });
  $('recent').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
    if (b) editor.setSecondary(Number(b.dataset.color));
  });

  // Edit bar
  const doCopy = (): void => { if (editor.copy() && editor.clipboard) void writeSystemClipboard(editor.clipboard); };
  const doCut = (): void => { if (editor.cut() && editor.clipboard) void writeSystemClipboard(editor.clipboard); };
  const doPaste = (): void => {
    const p = vp.screenToPixel(0, 0);
    editor.paste(Math.max(0, p.x), Math.max(0, p.y));
  };
  $('selAll').addEventListener('click', () => editor.selectAll());
  $('selNone').addEventListener('click', () => editor.deselect());
  $('selInv').addEventListener('click', () => editor.invertSelection());
  $('selColor').addEventListener('click', () => editor.selectByColor(editor.primary));
  $('copy').addEventListener('click', doCopy);
  $('cut').addEventListener('click', doCut);
  $('paste').addEventListener('click', doPaste);
  $('del').addEventListener('click', () => editor.deleteSelection());
  $('flipH').addEventListener('click', () => editor.transform('flipH'));
  $('flipV').addEventListener('click', () => editor.transform('flipV'));
  $('rotL').addEventListener('click', () => editor.transform('rotCCW'));
  $('rotR').addEventListener('click', () => editor.transform('rotCW'));
  $('crop').addEventListener('click', () => { if (!editor.cropToSelection()) alert('Select an area to crop to first.'); });
  $('trim').addEventListener('click', () => { if (!editor.trim()) alert('Nothing to trim: the canvas is blank or already tight.'); });
  $('capBrush').addEventListener('click', () => { if (!editor.captureBrush()) alert('Select some pixels first, then use them as a brush.'); });
  $('clrBrush').addEventListener('click', () => editor.clearCustomBrush());
  $<HTMLInputElement>('symX').addEventListener('change', (e) => editor.setSymmetry({ x: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('symY').addEventListener('change', (e) => editor.setSymmetry({ y: (e.target as HTMLInputElement).checked }));

  $('export').addEventListener('click', async () => {
    editor.commitFloating();
    const scale = Number($<HTMLSelectElement>('scale').value);
    const blob = await exportPngBlob(editor.project, editor.activeFrame, scale);
    const name = editor.project.name.replace(/[^\w.-]+/g, '_') || 'pixelartstudio';
    downloadBlob(blob, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
  });

  $('exportAnim').addEventListener('click', () => animIo.openExport());
  const importFile = $<HTMLInputElement>('importFile');
  $('importAnim').addEventListener('click', () => { importFile.value = ''; importFile.click(); });
  /** Opens a project or media file: .pxf and .aseprite here, GIFs and images through the animation importer. */
  const openFile = (file: File): void => {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.(pxf|ase|aseprite)$/i.test(file.name)) {
      void file.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        const p = /\.pxf$/i.test(file.name) ? parsePxf(bytes) : parseAseprite(bytes);
        p.id = uid('proj'); // never overwrite a stored project
        if (!/\.pxf$/i.test(file.name)) p.name = name;
        editor.openProject(p);
        notify(`Opened ${file.name}.`);
      }).catch((err: unknown) => notify(err instanceof Error ? err.message : 'That file could not be opened.'));
    } else animIo.importFile(file);
  };
  importFile.addEventListener('change', () => { const f = importFile.files?.[0]; if (f) openFile(f); });
  $('savePxf').addEventListener('click', () => {
    editor.commitFloating();
    const name = editor.project.name.replace(/[^\w.-]+/g, '_') || 'pixelartstudio';
    downloadBlob(new Blob([serializePxf(editor.project) as BlobPart], { type: 'application/octet-stream' }), `${name}.pxf`);
  });
  const gallery = mountGallery(root, editor, autosave, {
    newProject: () => dlg.showModal(),
    openFile: () => { importFile.value = ''; importFile.click(); },
    notify,
  });
  $('gallery').addEventListener('click', () => { void gallery.open(); });
  $('settings').addEventListener('click', () => settingsUi.openSettings());
  $('help').addEventListener('click', () => settingsUi.openCheatsheet());
  $<HTMLInputElement>('pname').addEventListener('change', (e) => editor.renameProject((e.target as HTMLInputElement).value));
  $<HTMLInputElement>('tile').addEventListener('change', (e) => editor.setTileMode((e.target as HTMLInputElement).checked));

  // Collapsible panels (open by default on wide screens, closed on narrow ones)
  const side = $('side'), timelineEl = $('timeline');
  const setSide = (open: boolean): void => { prefs.sideOpen = open; side.classList.toggle('collapsed', !open); persist(); requestAnimationFrame(() => renderer.resize(stage.clientWidth, stage.clientHeight)); };
  const setTimeline = (open: boolean): void => { prefs.timelineOpen = open; timelineEl.classList.toggle('collapsed', !open); persist(); requestAnimationFrame(() => renderer.resize(stage.clientWidth, stage.clientHeight)); };
  setSide(prefs.sideOpen ?? window.innerWidth > 900);
  setTimeline(prefs.timelineOpen ?? window.innerWidth > 700);
  $('toggleSide').addEventListener('click', () => setSide(side.classList.contains('collapsed')));
  $('toggleTl').addEventListener('click', () => setTimeline(timelineEl.classList.contains('collapsed')));
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  stage.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    openFile(f);
  });

  // ---- Dialogs -------------------------------------------------------------------
  const dlg = $<HTMLDialogElement>('newdlg');
  const preset = $<HTMLSelectElement>('preset');
  const nw = $<HTMLInputElement>('nw');
  const nh = $<HTMLInputElement>('nh');
  const bg = $<HTMLSelectElement>('bg');
  const bgc = $<HTMLInputElement>('bgcolor');
  preset.addEventListener('change', () => { if (preset.value !== 'custom') nw.value = nh.value = preset.value; });
  for (const el of [nw, nh]) el.addEventListener('input', () => { preset.value = nw.value === nh.value && PRESETS.includes(Number(nw.value)) ? nw.value : 'custom'; });
  bg.addEventListener('change', () => bgc.classList.toggle('hidden', bg.value !== 'color'));
  $('new').addEventListener('click', () => {
    dlg.showModal();
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const background = bg.value === 'transparent' ? 'transparent' : bg.value === 'white' ? WHITE : hexToPacked(bgc.value);
    editor.newProject({ width: Number(nw.value), height: Number(nh.value), background });
  });

  const sizeDlg = $<HTMLDialogElement>('sizedlg');
  const cw = $<HTMLInputElement>('cw');
  const ch = $<HTMLInputElement>('ch');
  const sizeMode = $<HTMLSelectElement>('sizeMode');
  sizeMode.addEventListener('change', () => $('anchorRow').classList.toggle('hidden', sizeMode.value === 'scale'));
  $('canvasSize').addEventListener('click', () => {
    editor.commitFloating();
    cw.value = String(editor.project.width);
    ch.value = String(editor.project.height);
    sizeDlg.showModal();
  });
  sizeDlg.addEventListener('close', () => {
    if (sizeDlg.returnValue !== 'ok') return;
    const w = Number(cw.value), h = Number(ch.value);
    if (sizeMode.value === 'scale') { editor.scaleImage(w, h); return; }
    const a = Number(root.querySelector<HTMLInputElement>('input[name=anchor]:checked')?.value ?? 4);
    editor.resizeCanvas(w, h, (a % 3) / 2, Math.floor(a / 3) / 2);
  });

  // ---- Viewport --------------------------------------------------------------------
  const centerPt = (): [number, number] => [renderer.width / 2, renderer.height / 2];
  const zoomBy = (dir: 1 | -1, at: [number, number] = centerPt()): void => {
    vp.stepZoom(dir, at[0], at[1]);
    updateInfo();
    renderer.requestDraw();
  };
  $('zin').addEventListener('click', () => zoomBy(1));
  $('zout').addEventListener('click', () => zoomBy(-1));
  $('fit').addEventListener('click', fitView);
  $('actual').addEventListener('click', () => {
    vp.actualSize(renderer.width, renderer.height, editor.project.width, editor.project.height);
    updateInfo();
    renderer.requestDraw();
  });
  $<HTMLInputElement>('grid').checked = prefs.grid.show;
  $<HTMLInputElement>('grid').addEventListener('change', (e) => {
    prefs.grid.show = (e.target as HTMLInputElement).checked;
    applyGrid();
    persist();
  });

  let firstResize = true;
  new ResizeObserver(() => {
    renderer.resize(stage.clientWidth, stage.clientHeight);
    if (firstResize) { firstResize = false; fitView(); }
  }).observe(stage);

  // ---- Pointer input ------------------------------------------------------------------
  let spaceDown = false;
  let panFrom: { x: number; y: number } | null = null;
  let drawPointer: number | null = null;
  let axisDrag: 'x' | 'y' | null = null;
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const setPanClass = (): void => {
    stage.classList.toggle('pan', spaceDown && !panFrom);
    stage.classList.toggle('panning', !!panFrom);
  };
  const pressure = (e: PointerEvent): number | undefined => (e.pointerType === 'pen' ? e.pressure : undefined);
  const axisAt = (sx: number, sy: number): 'x' | 'y' | null => {
    const s = editor.symmetry;
    if (s.x && Math.abs(sx - (vp.panX + s.axisX * vp.zoom)) <= 5) return 'x';
    if (s.y && Math.abs(sy - (vp.panY + s.axisY * vp.zoom)) <= 5) return 'y';
    return null;
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Touch handling: palm rejection, two-finger pan/pinch, two-finger tap = undo, three-finger tap = redo.
  let lastPenAt = -Infinity;
  const touches = new Map<number, { x: number; y: number }>();
  let gesture: { start: number; maxFingers: number; moved: number; mid: [number, number]; dist: number; scale: number } | null = null;
  const touchMetrics = (): { mid: [number, number]; dist: number } => {
    const pts = [...touches.values()];
    const mx = pts.reduce((a, t) => a + t.x, 0) / pts.length, my = pts.reduce((a, t) => a + t.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    return { mid: [mx, my], dist };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') lastPenAt = performance.now();
    if (e.pointerType === 'touch') {
      if (performance.now() - lastPenAt < 1500) return; // palm rejection: ignore touches while a pen is in use
      canvas.setPointerCapture(e.pointerId);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        editor.abortStroke();
        drawPointer = null;
        axisDrag = null;
        const m = touchMetrics();
        gesture ??= { start: performance.now(), maxFingers: 0, moved: 0, mid: m.mid, dist: m.dist, scale: 1 };
        gesture.maxFingers = Math.max(gesture.maxFingers, touches.size);
        gesture.mid = m.mid;
        gesture.dist = m.dist;
        return;
      }
    }
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      panFrom = { x: e.clientX, y: e.clientY };
      setPanClass();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    if (drawPointer !== null) return;
    const [sx, sy] = local(e);
    const axis = e.button === 0 ? axisAt(sx, sy) : null;
    if (axis) { axisDrag = axis; drawPointer = e.pointerId; return; }
    drawPointer = e.pointerId;
    const p = vp.screenToPixel(sx, sy);
    editor.pointerDown(p.x, p.y, e.button === 2 ? 'secondary' : 'primary', { shift: e.shiftKey, alt: e.altKey }, pressure(e));
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return; // rejected touch
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture) {
        const m = touchMetrics();
        const dx = m.mid[0] - gesture.mid[0], dy = m.mid[1] - gesture.mid[1];
        gesture.moved += Math.abs(dx) + Math.abs(dy);
        vp.panBy(dx, dy);
        gesture.mid = m.mid;
        if (gesture.dist > 0 && m.dist > 0) {
          gesture.scale *= m.dist / gesture.dist;
          const [cx, cy] = [m.mid[0] - canvas.getBoundingClientRect().left, m.mid[1] - canvas.getBoundingClientRect().top];
          if (gesture.scale > 1.35) { zoomBy(1, [cx, cy]); gesture.scale = 1; }
          else if (gesture.scale < 0.74) { zoomBy(-1, [cx, cy]); gesture.scale = 1; }
          gesture.moved += Math.abs(m.dist - gesture.dist);
        }
        gesture.dist = m.dist;
        renderer.requestDraw();
        return;
      }
    }
    const [sx, sy] = local(e);
    const p = vp.screenToPixel(sx, sy);
    const wrapped = editor.tileMode ? { x: ((p.x % editor.project.width) + editor.project.width) % editor.project.width, y: ((p.y % editor.project.height) + editor.project.height) % editor.project.height } : p;
    renderer.hover = editor.inBounds(wrapped.x, wrapped.y) ? wrapped : null;
    $('coords').textContent = renderer.hover ? `${wrapped.x}, ${wrapped.y}` : '–';
    stage.classList.toggle('axis', !panFrom && drawPointer === null && axisAt(sx, sy) !== null);
    if (panFrom) {
      vp.panBy(e.clientX - panFrom.x, e.clientY - panFrom.y);
      panFrom = { x: e.clientX, y: e.clientY };
    } else if (axisDrag && drawPointer === e.pointerId) {
      const img = vp.screenToImage(sx, sy);
      editor.setSymmetry(axisDrag === 'x' ? { axisX: img.x } : { axisY: img.y });
    } else if (drawPointer === e.pointerId) {
      const mods = { shift: e.shiftKey, alt: e.altKey };
      const events = e.getCoalescedEvents?.();
      for (const ev of events && events.length ? events : [e]) {
        const q = vp.screenToPixel(...local(ev));
        editor.pointerMove(q.x, q.y, mods, pressure(e));
      }
    }
    renderer.requestDraw();
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && touches.delete(e.pointerId) && gesture && touches.size === 0) {
      const g = gesture;
      gesture = null;
      if (e.type === 'pointerup' && g.moved < 14 && performance.now() - g.start < 450) {
        if (g.maxFingers === 2) editor.undo();
        else if (g.maxFingers >= 3) editor.redo();
      }
    }
    if (panFrom) { panFrom = null; setPanClass(); }
    if (drawPointer === e.pointerId) {
      drawPointer = null;
      if (axisDrag) axisDrag = null;
      else editor.pointerUp();
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { renderer.hover = null; $('coords').textContent = '–'; renderer.requestDraw(); });
  canvas.addEventListener('dblclick', () => { if (editor.tool === 'lasso' && editor.polyPts) editor.polygonClose(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1, local(e));
  }, { passive: false });

  // ---- Keyboard -------------------------------------------------------------------------
  const typing = (t: EventTarget | null): boolean => {
    if (!(t instanceof HTMLElement)) return false;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
    if (t.tagName !== 'INPUT') return false;
    const type = (t as HTMLInputElement).type;
    return type !== 'checkbox' && type !== 'range' && type !== 'color' && type !== 'radio';
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || dlg.open || sizeDlg.open || root.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); }
      else if (k === 'y') { e.preventDefault(); editor.redo(); }
      else if (k === 'a') { e.preventDefault(); editor.selectAll(); }
      else if (k === 'd') { e.preventDefault(); editor.deselect(); }
      else if (k === 'i' && e.shiftKey) { e.preventDefault(); editor.invertSelection(); }
      else if (k === 'c') { e.preventDefault(); doCopy(); }
      else if (k === 'x') { e.preventDefault(); doCut(); }
      // Ctrl+V is handled by the paste event so system-clipboard images work.
      return;
    }
    if (e.altKey) return;
    if (k === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; setPanClass(); } return; }
    if (k === 'enter') { e.preventDefault(); if (editor.polyPts) editor.polygonClose(); else editor.commitFloating(); return; }
    if (k === 'escape') {
      if (editor.polyPts) editor.cancelPolygon();
      else if (editor.hasFloating) editor.cancelFloating();
      else editor.deselect();
      return;
    }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); editor.deleteSelection(); return; }
    if (k.startsWith('arrow') && editor.tool === 'move') {
      e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      editor.nudge(k === 'arrowleft' ? -n : k === 'arrowright' ? n : 0, k === 'arrowup' ? -n : k === 'arrowdown' ? n : 0);
      return;
    }
    const action = lookupAction(bindings, k === '=' ? '+' : normalizeKey(e));
    if (!action) return;
    const step = (d: number): void => editor.setActiveFrame((editor.activeFrame + d + editor.project.frames.length) % editor.project.frames.length);
    if (action.startsWith('tool:')) editor.setTool(action.slice(5) as ToolId);
    else if (action === 'swapColors') editor.swapColors();
    else if (action === 'prevFrame') step(-1);
    else if (action === 'nextFrame') step(1);
    else if (action === 'zoomIn') zoomBy(1);
    else if (action === 'zoomOut') zoomBy(-1);
    else if (action === 'togglePlay') preview.togglePlay();
    else if (action === 'toggleTile') editor.setTileMode(!editor.tileMode);
    else if (action === 'cheatsheet') settingsUi.openCheatsheet();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; setPanClass(); }
  });
  window.addEventListener('blur', () => { spaceDown = false; setPanClass(); });

  window.addEventListener('paste', (e) => {
    if (typing(e.target)) return;
    e.preventDefault();
    const p = vp.screenToPixel(0, 0);
    const x = Math.max(0, p.x), y = Math.max(0, p.y);
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) void readImageBlob(file).then((img) => editor.pasteImage(img, x, y));
    else editor.paste(x, y);
  });

  sync();

  // Reopen the last project; ask first when the previous session did not close cleanly.
  void (async () => {
    try {
      if (!storageAvailable()) return;
      const id = autosave.lastProjectId();
      if (!id || !(await hasProject(id))) return;
      if (autosave.crashed && !confirm('Pixel Art Studio did not close cleanly last time. Restore your last autosaved project?')) {
        void gallery.open();
        return;
      }
      const p = await loadProject(id);
      if (p && !editor.canUndo) editor.openProject(p);
    } catch {
      notify('Could not restore your last project.');
    }
  })();
  return { editor };
}
