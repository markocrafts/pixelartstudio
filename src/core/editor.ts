import { forEachLinePoint } from './bresenham';
import { clampBrushSize, shapeBrush, stampBrush, strokeBrush, type Brush, type BrushShape } from './brush';
import { nearestIndex, paletteRamp, shadePixel } from './color';
import { clampFps, MAX_DURATION_MS, MIN_DURATION_MS, tagsAfterDelete, tagsAfterInsert } from './animation';
import { blendInto, compositeFrame } from './composite';
import { applyGradient, ditherPick, type DitherPattern } from './dither';
import { applyMask, fillMask } from './fill';
import { renderText, type FontId } from './fonts';
import { History, diffCels, snapshotProject, type FrameState, type LayerState, type Patch } from './history';
import { defaultOnion, type OnionSettings } from './onion';
import { Painter, createPainter, defaultSymmetry, type Symmetry } from './painter';
import { pixelPerfect, type Point } from './pixelperfect';
import { MAX_PALETTE_COLORS, extractPalette } from './palette';
import { createCel, packRGBA } from './pixels';
import {
  MAX_FRAMES, MAX_LAYERS, clampSize, createLayer, createProject, uid, type Frame, type LayerMeta, type NewProjectOptions, type Project, type TagDirection,
} from './project';
import {
  allMask, colorMask, combineMasks, invertMask, maskBounds, polygonMask, rectMask, type Rect, type SelectOp,
} from './selection';
import { constrainSquare, ellipsePoints, rectPoints, snapLine } from './shapes';
import { cropProject, flipH, flipProject, flipV, resizeProject, rotate90, rotateProject, scaleProject, trimProject } from './transform';

export type ToolId =
  | 'pencil' | 'eraser' | 'bucket' | 'picker'
  | 'line' | 'rect' | 'ellipse' | 'gradient' | 'shading' | 'dither'
  | 'select' | 'lasso' | 'wand' | 'move' | 'text';
export type MouseButton = 'primary' | 'secondary';
export interface Mods { shift?: boolean; alt?: boolean }

export interface ToolOptions {
  size: number;
  shape: BrushShape;
  pixelPerfect: boolean;
  /** Stylus pressure scales brush size. */
  pressureSize: boolean;
  useCustomBrush: boolean;
  /** Paint the custom brush's silhouette in the current color instead of its own colors. */
  customTint: boolean;
  filled: boolean;
  fillContiguous: boolean;
  /** 0..100 */
  tolerance: number;
  fillSampleAll: boolean;
  pickSampleAll: boolean;
  gradientKind: 'linear' | 'radial';
  gradientPattern: DitherPattern;
  shadeMode: 'lighten' | 'darken';
  /** HSL lightness percent used when the palette has fewer than 2 colors. */
  shadeAmount: number;
  ditherPattern: DitherPattern;
  /** 0..100 */
  ditherDensity: number;
  ditherFillSecondary: boolean;
  wandContiguous: boolean;
  wandTolerance: number;
  lassoPolygon: boolean;
  text: string;
  font: FontId;
  textScale: number;
  /** Only palette colors can be drawn (colors snap to the nearest palette entry). */
  paletteLock: boolean;
}

export interface Clipboard { w: number; h: number; pixels: Uint32Array; mask: Uint8Array }

interface Floating {
  buf: Uint32Array;
  mask: Uint8Array;
  x: number; y: number; w: number; h: number;
  /** The cel with the lifted pixels removed (or untouched for a paste). */
  base: Uint32Array;
  /** The cel before the whole operation, for history and cancel. */
  original: Uint32Array;
  prevSelection: Uint8Array | null;
  wholeLayer: boolean;
  frameId: string;
  layerId: string;
  label: string;
}

interface Stroke {
  kind: 'brush' | 'shape' | 'marquee' | 'lasso' | 'move';
  tool: ToolId;
  frameId: string;
  layerId: string;
  snapshot: Uint32Array;
  color: number;
  button: MouseButton;
  startX: number; startY: number;
  lastX: number; lastY: number;
  size: number;
  shift: boolean;
  raw?: Point[];
  pp?: boolean;
  visited?: Set<number>;
  shadeDir?: 1 | -1;
  ramp?: number[] | null;
  op?: SelectOp;
  pts?: Point[];
  fx?: number; fy?: number;
}

const RECENT_MAX = 16;
const LABELS: Partial<Record<ToolId, string>> = {
  pencil: 'Draw', eraser: 'Erase', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse',
  gradient: 'Gradient', shading: 'Shade', dither: 'Dither',
};

/** Editing state and tool logic. Has no DOM dependency; the UI feeds it integer pixel coordinates. */
export class Editor {
  project: Project;
  readonly history = new History(500);
  tool: ToolId = 'pencil';
  primary = packRGBA(0, 0, 0);
  secondary = packRGBA(255, 255, 255);
  recent: number[] = [];
  options: ToolOptions = {
    size: 1, shape: 'square', pixelPerfect: false, pressureSize: false, useCustomBrush: false, customTint: false,
    filled: false,
    fillContiguous: true, tolerance: 0, fillSampleAll: false, pickSampleAll: false,
    gradientKind: 'linear', gradientPattern: 'bayer4',
    shadeMode: 'lighten', shadeAmount: 10,
    ditherPattern: 'bayer4', ditherDensity: 50, ditherFillSecondary: true,
    wandContiguous: true, wandTolerance: 0, lassoPolygon: false,
    text: 'Hello', font: '5x7', textScale: 1, paletteLock: false,
  };
  symmetry: Symmetry;
  activeFrame = 0;
  activeLayer = 0;
  /** Selected frame range (inclusive); the active frame is one end of it. */
  frameRange = { from: 0, to: 0 };
  private frameAnchor = 0;
  onion: OnionSettings = defaultOnion();
  celClipboard: Uint32Array | null = null;
  /** Tile mode: drawing wraps around the canvas edges (the renderer shows a 3×3 repeat). */
  tileMode = false;
  /** Bumped on every change to the project, for autosave. */
  revision = 0;
  /** Called just before the open project is replaced (autosave hooks in here). */
  beforeOpen: (() => void) | null = null;
  /** Selected pixels (1 = selected), or null for no selection. */
  selection: Uint8Array | null = null;
  selectionVersion = 0;
  customBrush: Brush | null = null;
  clipboard: Clipboard | null = null;
  // Overlays for the renderer
  marquee: Rect | null = null;
  lassoPts: Point[] | null = null;
  polyPts: Point[] | null = null;

  private floating: Floating | null = null;
  private stroke: Stroke | null = null;
  private listeners = new Set<() => void>();

  constructor(project?: Project) {
    this.project = project ?? createProject({ width: 32, height: 32 });
    this.symmetry = defaultSymmetry(this.project.width, this.project.height);
  }

  // ---- subscriptions & small state ----------------------------------------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get isStroking(): boolean { return this.stroke !== null; }
  get hasFloating(): boolean { return this.floating !== null; }
  get canUndo(): boolean { return this.floating !== null || this.history.canUndo; }
  get canRedo(): boolean { return this.floating === null && this.history.canRedo; }

  newProject(opts: NewProjectOptions): void {
    this.openProject(createProject(opts));
  }

  /** Replaces the current project (new, loaded from storage or imported). History is cleared. */
  openProject(project: Project): void {
    this.commitFloating();
    this.beforeOpen?.();
    this.stroke = null;
    this.floating = null;
    this.project = project;
    this.revision++;
    this.history.clear();
    this.activeFrame = 0;
    this.frameRange = { from: 0, to: 0 };
    this.frameAnchor = 0;
    this.activeLayer = 0;
    this.selection = null;
    this.selectionVersion++;
    this.marquee = this.lassoPts = this.polyPts = null;
    this.resetAxes();
    this.emit();
  }

  setTool(tool: ToolId): void {
    if (tool !== this.tool) {
      if (tool !== 'move') this.commitFloating();
      this.polyPts = null;
    }
    this.tool = tool;
    this.emit();
  }

  setOptions(patch: Partial<ToolOptions>): void {
    this.options = { ...this.options, ...patch };
    this.options.size = clampBrushSize(this.options.size);
    this.options.tolerance = Math.min(100, Math.max(0, this.options.tolerance));
    this.options.wandTolerance = Math.min(100, Math.max(0, this.options.wandTolerance));
    this.options.ditherDensity = Math.min(100, Math.max(0, this.options.ditherDensity));
    this.options.shadeAmount = Math.min(50, Math.max(1, this.options.shadeAmount));
    this.options.textScale = Math.min(16, Math.max(1, Math.round(this.options.textScale) || 1));
    this.emit();
  }

  setTileMode(on: boolean): void {
    this.tileMode = on;
    this.emit();
  }

  renameProject(name: string): void {
    const n = name.trim().slice(0, 128) || 'Untitled';
    if (n === this.project.name) return;
    this.project.name = n;
    this.touch();
  }

  /** Cancels the stroke in progress (e.g. a second finger landed) and restores the pixels it changed. */
  abortStroke(): void {
    const s = this.stroke;
    if (!s) return;
    if (s.snapshot.length) {
      const cel = this.project.frames.find((f) => f.id === s.frameId)?.cels.get(s.layerId);
      cel?.set(s.snapshot);
    }
    this.stroke = null;
    this.marquee = this.lassoPts = null;
    this.emit();
  }

  setSymmetry(patch: Partial<Symmetry>): void {
    const s = { ...this.symmetry, ...patch };
    s.axisX = Math.min(this.project.width, Math.max(0, Math.round(s.axisX * 2) / 2));
    s.axisY = Math.min(this.project.height, Math.max(0, Math.round(s.axisY * 2) / 2));
    this.symmetry = s;
    this.emit();
  }

  private resetAxes(): void {
    const d = defaultSymmetry(this.project.width, this.project.height);
    this.symmetry = { ...this.symmetry, axisX: d.axisX, axisY: d.axisY };
  }

  setPrimary(c: number): void { this.primary = c; this.emit(); }
  setSecondary(c: number): void { this.secondary = c; this.emit(); }
  swapColors(): void {
    [this.primary, this.secondary] = [this.secondary, this.primary];
    this.emit();
  }

  private addRecent(c: number): void {
    this.recent = [c, ...this.recent.filter((x) => x !== c)].slice(0, RECENT_MAX);
  }

  private get frame() { return this.project.frames[this.activeFrame]!; }
  private get layer() { return this.project.layers[this.activeLayer]!; }
  private get cel(): Uint32Array | undefined { return this.frame.cels.get(this.layer.id); }

  private get drawable(): boolean {
    const l = this.layer;
    return !!l && l.visible && !l.locked && !l.isReference && !!this.cel;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.project.width && y < this.project.height;
  }

  private touch(): void {
    this.project.updatedAt = Date.now();
    this.revision++;
    this.emit();
  }

  private painter(cel: Uint32Array): Painter {
    return createPainter(cel, this.project.width, this.project.height, this.selection, this.symmetry, {
      alphaLock: this.layer.alphaLock,
      snap: this.snapColor(),
      wrap: this.tileMode,
    });
  }

  /** Palette-lock color mapper, or null when the lock is off or the palette is empty. */
  private snapColor(): ((c: number) => number) | null {
    const colors = this.project.palette.colors;
    if (!this.options.paletteLock || colors.length === 0) return null;
    return (c) => (((colors[nearestIndex(colors, c)]! & 0x00ffffff) | (c & 0xff000000)) >>> 0);
  }

  private effectiveSize(pressure?: number): number {
    const { size, pressureSize } = this.options;
    return pressureSize && pressure !== undefined ? Math.max(1, Math.round(size * pressure)) : size;
  }

  private currentBrush(size: number, eraser: boolean): Brush {
    if (!eraser && this.options.useCustomBrush && this.customBrush) return this.customBrush;
    return shapeBrush(size, this.options.shape);
  }

  // ---- pointer input -------------------------------------------------------
  pointerDown(x: number, y: number, button: MouseButton, mods: Mods = {}, pressure?: number): void {
    if (this.stroke) return;
    const selTool = this.tool === 'select' || this.tool === 'lasso' || this.tool === 'wand';
    const tool: ToolId = mods.alt && !selTool ? 'picker' : this.tool;
    const color = button === 'primary' ? this.primary : this.secondary;
    const { width: w, height: h } = this.project;

    if (tool === 'picker') {
      if (!this.inBounds(x, y)) return;
      const src = this.options.pickSampleAll ? compositeFrame(this.project, this.frame) : this.cel;
      if (!src) return;
      const picked = src[y * w + x]!;
      if (button === 'primary') this.primary = picked; else this.secondary = picked;
      this.emit();
      return;
    }

    if (tool !== 'move') this.commitFloating();

    // Selection tools
    if (tool === 'select' || tool === 'lasso' || tool === 'wand') {
      const op: SelectOp = mods.shift ? 'add' : mods.alt ? 'subtract' : 'replace';
      this.beginSelect(tool, x, y, button, op);
      return;
    }

    const cel = this.cel;
    if (!cel || !this.drawable) return;
    const base = {
      frameId: this.frame.id, layerId: this.layer.id, button, color,
      startX: x, startY: y, lastX: x, lastY: y, shift: !!mods.shift,
    };

    switch (tool) {
      case 'move': {
        if (!this.floating && !this.lift('Move')) return;
        const f = this.floating!;
        this.stroke = { ...base, kind: 'move', tool, snapshot: new Uint32Array(0), size: 1, fx: f.x, fy: f.y };
        return;
      }
      case 'bucket': {
        const sample = this.options.fillSampleAll ? compositeFrame(this.project, this.frame) : cel;
        const mask = fillMask(sample, w, h, x, y, this.options.tolerance, this.options.fillContiguous);
        if (!mask) return;
        const lockAlpha = this.layer.alphaLock;
        if (this.selection || lockAlpha) {
          for (let i = 0; i < mask.length; i++) if ((this.selection && !this.selection[i]) || (lockAlpha && (cel[i]! >>> 24) === 0)) mask[i] = 0;
        }
        const before = cel.slice();
        applyMask(cel, mask, this.snapColor()?.(color) ?? color);
        this.finishDraw(before, 'Fill', color);
        return;
      }
      case 'text': {
        const before = cel.slice();
        const bmp = renderText(this.options.text, this.options.font, this.options.textScale);
        const p = this.painter(cel);
        for (let j = 0; j < bmp.h; j++) for (let i = 0; i < bmp.w; i++) if (bmp.on[j * bmp.w + i]) p.put(x + i, y + j, color);
        this.finishDraw(before, 'Text', color);
        return;
      }
      case 'line': case 'rect': case 'ellipse': case 'gradient': {
        this.stroke = { ...base, kind: 'shape', tool, snapshot: cel.slice(), size: this.options.size };
        this.drawShape(this.stroke);
        this.emit();
        return;
      }
      default: {
        // pencil / eraser / shading / dither
        const size = this.effectiveSize(pressure);
        const eraser = tool === 'eraser';
        const s: Stroke = {
          ...base, kind: 'brush', tool, snapshot: cel.slice(), size, color: eraser ? 0 : color,
          pp: this.options.pixelPerfect && (tool === 'pencil' || eraser) && size === 1 && !(tool === 'pencil' && this.options.useCustomBrush && this.customBrush),
        };
        if (tool === 'shading') {
          s.visited = new Set();
          s.shadeDir = (this.options.shadeMode === 'lighten') === (button === 'primary') ? 1 : -1;
          s.ramp = this.project.palette.colors.length >= 2 ? paletteRamp(this.project.palette.colors) : null;
        }
        if (s.pp) s.raw = [[x, y]];
        this.stroke = s;
        this.paintBrushSegment(s, cel, x, y, x, y);
        this.emit();
      }
    }
  }

  pointerMove(x: number, y: number, mods: Mods = {}, pressure?: number): void {
    const s = this.stroke;
    if (!s) return;
    if (x === s.lastX && y === s.lastY && !(s.kind === 'shape' && !!mods.shift !== s.shift)) return;
    const cel = this.cel;

    if (s.kind === 'brush' && cel) {
      if (s.tool === 'pencil' || s.tool === 'eraser' || s.tool === 'shading' || s.tool === 'dither') s.size = this.effectiveSize(pressure);
      if (s.pp) {
        forEachLinePoint(s.lastX, s.lastY, x, y, (px, py) => s.raw!.push([px, py]));
        cel.set(s.snapshot);
        const p = this.painter(cel);
        for (const [px, py] of pixelPerfect(s.raw!)) p.put(px, py, s.color);
      } else {
        this.paintBrushSegment(s, cel, s.lastX, s.lastY, x, y);
      }
    } else if (s.kind === 'shape' && cel) {
      s.shift = !!mods.shift;
      s.lastX = x; s.lastY = y;
      this.drawShape(s);
    } else if (s.kind === 'marquee') {
      this.marquee = { x: Math.min(s.startX, x), y: Math.min(s.startY, y), w: Math.abs(x - s.startX) + 1, h: Math.abs(y - s.startY) + 1 };
    } else if (s.kind === 'lasso') {
      s.pts!.push([x, y]);
      this.lassoPts = s.pts!;
    } else if (s.kind === 'move' && this.floating) {
      this.floating.x = s.fx! + (x - s.startX);
      this.floating.y = s.fy! + (y - s.startY);
      this.renderFloating();
    }
    s.lastX = x;
    s.lastY = y;
    this.emit();
  }

  pointerUp(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const w = this.project.width, h = this.project.height;

    if (s.kind === 'brush' || s.kind === 'shape') {
      const cel = this.cel;
      if (cel) this.finishDraw(s.snapshot, LABELS[s.tool] ?? 'Draw', s.tool === 'eraser' || s.tool === 'shading' ? null : s.color);
      return;
    }
    if (s.kind === 'marquee') {
      this.marquee = null;
      if (s.startX === s.lastX && s.startY === s.lastY && s.op === 'replace') this.setSelection(null);
      else this.setSelection(combineMasks(this.selection, rectMask(w, h, s.startX, s.startY, s.lastX, s.lastY), s.op!));
      return;
    }
    if (s.kind === 'lasso') {
      this.lassoPts = null;
      const pts = s.pts!;
      if (pts.length < 2 && s.op === 'replace') this.setSelection(null);
      else this.setSelection(combineMasks(this.selection, polygonMask(w, h, pts), s.op!));
      return;
    }
    this.emit(); // move: floating stays until committed
  }

  private beginSelect(tool: 'select' | 'lasso' | 'wand', x: number, y: number, button: MouseButton, op: SelectOp): void {
    const { width: w, height: h } = this.project;
    if (tool === 'wand') {
      if (!this.inBounds(x, y)) return;
      const cel = this.cel;
      if (!cel) return;
      const mask = fillMask(cel, w, h, x, y, this.options.wandTolerance, this.options.wandContiguous);
      if (mask) this.setSelection(combineMasks(this.selection, mask, op));
      return;
    }
    if (tool === 'lasso' && this.options.lassoPolygon) {
      const pts = this.polyPts ?? (this.polyPts = []);
      const first = pts[0];
      if (first && pts.length >= 3 && first[0] === x && first[1] === y) this.polygonClose(op);
      else pts.push([x, y]);
      this.polyOp = op;
      this.emit();
      return;
    }
    const base = {
      frameId: this.frame.id, layerId: this.layer.id, snapshot: new Uint32Array(0), color: 0, button, size: 1,
      startX: x, startY: y, lastX: x, lastY: y, shift: false, op,
    };
    if (tool === 'select') {
      this.stroke = { ...base, kind: 'marquee', tool };
      this.marquee = { x, y, w: 1, h: 1 };
    } else {
      this.stroke = { ...base, kind: 'lasso', tool, pts: [[x, y]] };
      this.lassoPts = this.stroke.pts!;
    }
    this.emit();
  }

  private polyOp: SelectOp = 'replace';

  /** Closes the polygon lasso in progress and applies it as a selection. */
  polygonClose(op: SelectOp = this.polyOp): void {
    const pts = this.polyPts;
    this.polyPts = null;
    if (pts && pts.length >= 3) {
      this.setSelection(combineMasks(this.selection, polygonMask(this.project.width, this.project.height, pts), op));
    } else this.emit();
  }

  cancelPolygon(): void {
    this.polyPts = null;
    this.emit();
  }

  // ---- brush & shape painting ---------------------------------------------
  private paintBrushSegment(s: Stroke, cel: Uint32Array, x0: number, y0: number, x1: number, y1: number): void {
    const p = this.painter(cel);
    const w = this.project.width;
    switch (s.tool) {
      case 'pencil': case 'eraser': {
        if (s.pp) { p.put(x1, y1, s.color); break; }
        strokeBrush(p, this.currentBrush(s.size, s.tool === 'eraser'), x0, y0, x1, y1, s.color, this.options.customTint);
        break;
      }
      case 'dither': {
        const { ditherPattern: pat, ditherDensity: den, ditherFillSecondary: fill } = this.options;
        const prim = this.primary, sec = this.secondary;
        const fn = (cur: number, x: number, y: number): number => (ditherPick(pat, 1 - den / 100, x, y) ? (fill ? sec : cur) : prim);
        const brush = shapeBrush(s.size, this.options.shape);
        forEachLinePoint(x0, y0, x1, y1, (x, y) => { for (const [ox, oy] of brush.offsets) p.paint(x + ox, y + oy, fn); });
        break;
      }
      case 'shading': {
        const { shadeAmount } = this.options;
        const fn = (cur: number, x: number, y: number): number => {
          if (cur >>> 24 === 0) return cur;
          const i = y * w + x;
          if (s.visited!.has(i)) return cur;
          s.visited!.add(i);
          return shadePixel(cur, s.shadeDir!, shadeAmount, s.ramp ?? null);
        };
        const brush = shapeBrush(s.size, this.options.shape);
        forEachLinePoint(x0, y0, x1, y1, (x, y) => { for (const [ox, oy] of brush.offsets) p.paint(x + ox, y + oy, fn); });
        break;
      }
    }
    s.lastX = x1;
    s.lastY = y1;
  }

  private drawShape(s: Stroke): void {
    const cel = this.cel;
    if (!cel) return;
    cel.set(s.snapshot);
    const { startX: x0, startY: y0 } = s;
    let x1 = s.lastX, y1 = s.lastY;
    const { width: w, height: h } = this.project;

    if (s.tool === 'gradient') {
      const a = s.button === 'primary' ? this.primary : this.secondary;
      const b = s.button === 'primary' ? this.secondary : this.primary;
      applyGradient(cel, this.selection, w, h, {
        kind: this.options.gradientKind, x0, y0, x1, y1, pattern: this.options.gradientPattern, primary: a, secondary: b,
      });
      return;
    }
    const p = this.painter(cel);
    const brush = shapeBrush(s.size, this.options.shape);
    if (s.tool === 'line') {
      if (s.shift) [x1, y1] = snapLine(x0, y0, x1, y1);
      strokeBrush(p, brush, x0, y0, x1, y1, s.color);
      return;
    }
    if (s.shift) [x1, y1] = constrainSquare(x0, y0, x1, y1);
    const filled = this.options.filled;
    const pts = s.tool === 'rect' ? rectPoints(x0, y0, x1, y1, filled) : ellipsePoints(x0, y0, x1, y1, filled);
    if (filled) for (const [x, y] of pts) p.put(x, y, s.color);
    else for (const [x, y] of pts) stampBrush(p, brush, x, y, s.color);
  }

  /** Pushes one history step for the difference between `before` and the current cel. */
  private finishDraw(before: Uint32Array, label: string, recentColor: number | null): void {
    const cel = this.cel;
    if (!cel) return;
    const patch = diffCels(this.frame.id, this.layer.id, before, cel, this.project.width, this.project.height);
    if (patch) {
      this.history.push({ label, patches: [patch] });
      if (recentColor !== null) this.addRecent(recentColor);
      this.touch();
    } else this.emit();
  }

  // ---- selection ------------------------------------------------------------
  private setSelection(mask: Uint8Array | null): void {
    this.selection = mask;
    this.selectionVersion++;
    this.emit();
  }

  selectAll(): void {
    this.commitFloating();
    this.setSelection(allMask(this.project.width, this.project.height));
  }

  deselect(): void {
    this.commitFloating();
    this.polyPts = null;
    this.setSelection(null);
  }

  invertSelection(): void {
    this.commitFloating();
    this.setSelection(invertMask(this.selection, this.project.width, this.project.height));
  }

  /** Selects every pixel of the active layer matching `color` (within tolerance percent). */
  selectByColor(color: number, tolerance = 0, op: SelectOp = 'replace'): void {
    this.commitFloating();
    const cel = this.cel;
    if (cel) this.setSelection(combineMasks(this.selection, colorMask(cel, color, tolerance), op));
  }

  // ---- floating selection (move / paste / transform) --------------------------
  private lift(label: string): boolean {
    const cel = this.cel;
    if (!cel || !this.drawable) return false;
    const { width: w, height: h } = this.project;
    const mask = this.selection ?? allMask(w, h);
    const b = maskBounds(mask, w, h);
    if (!b) return false;
    const original = cel.slice();
    const base = cel.slice();
    const buf = new Uint32Array(b.w * b.h);
    const m = new Uint8Array(b.w * b.h);
    for (let j = 0; j < b.h; j++) {
      for (let i = 0; i < b.w; i++) {
        const si = (b.y + j) * w + b.x + i;
        if (!mask[si]) continue;
        buf[j * b.w + i] = cel[si]!;
        m[j * b.w + i] = 1;
        base[si] = 0;
      }
    }
    this.floating = {
      buf, mask: m, x: b.x, y: b.y, w: b.w, h: b.h, base, original,
      prevSelection: this.selection, wholeLayer: !this.selection,
      frameId: this.frame.id, layerId: this.layer.id, label,
    };
    this.renderFloating();
    return true;
  }

  /** Redraws the cel from the floating selection's current position and moves the selection with it. */
  private renderFloating(): void {
    const f = this.floating;
    const cel = this.cel;
    if (!f || !cel) return;
    const { width: w, height: h } = this.project;
    cel.set(f.base);
    const sel = new Uint8Array(w * h);
    let any = false;
    for (let j = 0; j < f.h; j++) {
      for (let i = 0; i < f.w; i++) {
        const k = j * f.w + i;
        if (!f.mask[k]) continue;
        const tx = f.x + i, ty = f.y + j;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        sel[ty * w + tx] = 1;
        any = true;
        const c = f.buf[k]!;
        if (c >>> 24 !== 0) cel[ty * w + tx] = c;
      }
    }
    this.selection = any ? sel : null;
    this.selectionVersion++;
  }

  /** Stamps the floating selection into the layer and records one history step. */
  commitFloating(): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    const cel = this.project.frames.find((fr) => fr.id === f.frameId)?.cels.get(f.layerId);
    if (!cel) return;
    const patch = diffCels(f.frameId, f.layerId, f.original, cel, this.project.width, this.project.height);
    if (patch) this.history.push({ label: f.label, patches: [patch] });
    if (f.wholeLayer) this.setSelection(null);
    this.touch();
  }

  cancelFloating(): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    this.cel?.set(f.original);
    this.setSelection(f.prevSelection);
  }

  /** Moves the selection contents (or the whole layer) by (dx,dy) pixels. */
  nudge(dx: number, dy: number): void {
    if (this.stroke) return;
    if (!this.floating && !this.lift('Move')) return;
    this.floating!.x += dx;
    this.floating!.y += dy;
    this.renderFloating();
    this.emit();
  }

  // ---- clipboard --------------------------------------------------------------
  private readRegion(): Clipboard | null {
    const cel = this.cel;
    if (!cel) return null;
    const { width: w, height: h } = this.project;
    const mask = this.selection ?? allMask(w, h);
    const b = maskBounds(mask, w, h);
    if (!b) return null;
    const pixels = new Uint32Array(b.w * b.h);
    const m = new Uint8Array(b.w * b.h);
    for (let j = 0; j < b.h; j++) {
      for (let i = 0; i < b.w; i++) {
        const si = (b.y + j) * w + b.x + i;
        if (!mask[si]) continue;
        pixels[j * b.w + i] = cel[si]!;
        m[j * b.w + i] = 1;
      }
    }
    return { w: b.w, h: b.h, pixels, mask: m };
  }

  copy(): boolean {
    this.commitFloating();
    const c = this.readRegion();
    if (!c) return false;
    this.clipboard = c;
    this.emit();
    return true;
  }

  cut(): boolean {
    if (!this.copy()) return false;
    this.clearSelectedPixels('Cut');
    return true;
  }

  /** Erases the selected pixels (or the whole layer when nothing is selected). */
  deleteSelection(): void {
    this.commitFloating();
    this.clearSelectedPixels('Delete');
  }

  private clearSelectedPixels(label: string): void {
    const cel = this.cel;
    if (!cel || !this.drawable) return;
    const before = cel.slice();
    const sel = this.selection;
    if (sel) for (let i = 0; i < cel.length; i++) { if (sel[i]) cel[i] = 0; }
    else cel.fill(0);
    this.finishDraw(before, label, null);
  }

  /** Pastes the internal clipboard as a floating selection at (x,y) and switches to the Move tool. */
  paste(x = 0, y = 0): boolean {
    return this.pasteImage(this.clipboard, x, y);
  }

  /** Pastes pixels (e.g. from the system clipboard) as a floating selection. Transparent pixels are not selected. */
  pasteImage(img: { w: number; h: number; pixels: Uint32Array; mask?: Uint8Array } | null, x = 0, y = 0): boolean {
    if (!img || !this.drawable) return false;
    this.commitFloating();
    const cel = this.cel!;
    const mask = img.mask ?? Uint8Array.from(img.pixels, (c) => (c >>> 24 === 0 ? 0 : 1));
    this.floating = {
      buf: img.pixels.slice(), mask: mask.slice(), x, y, w: img.w, h: img.h,
      base: cel.slice(), original: cel.slice(), prevSelection: this.selection, wholeLayer: false,
      frameId: this.frame.id, layerId: this.layer.id, label: 'Paste',
    };
    this.renderFloating();
    this.tool = 'move';
    this.emit();
    return true;
  }

  // ---- transforms ---------------------------------------------------------------
  /** Flips/rotates the selection (or the floating selection); with no selection, the whole canvas. */
  transform(kind: 'flipH' | 'flipV' | 'rotCW' | 'rotCCW'): void {
    if (this.stroke) return;
    if (this.floating || this.selection) {
      const had = this.floating !== null;
      if (!had && !this.lift('Transform')) return;
      const f = this.floating!;
      if (kind === 'flipH') { f.buf = flipH(f.buf, f.w, f.h); f.mask = flipH(f.mask, f.w, f.h); }
      else if (kind === 'flipV') { f.buf = flipV(f.buf, f.w, f.h); f.mask = flipV(f.mask, f.w, f.h); }
      else {
        const cw = kind === 'rotCW';
        const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
        f.buf = rotate90(f.buf, f.w, f.h, cw);
        f.mask = rotate90(f.mask, f.w, f.h, cw);
        [f.w, f.h] = [f.h, f.w];
        f.x = Math.round(cx - f.w / 2);
        f.y = Math.round(cy - f.h / 2);
      }
      this.renderFloating();
      if (!had) this.commitFloating();
      else this.emit();
      return;
    }
    const label = { flipH: 'Flip horizontal', flipV: 'Flip vertical', rotCW: 'Rotate 90° CW', rotCCW: 'Rotate 90° CCW' }[kind];
    this.structural(label, () => {
      if (kind === 'flipH') flipProject(this.project, 'h');
      else if (kind === 'flipV') flipProject(this.project, 'v');
      else rotateProject(this.project, kind === 'rotCW');
    });
  }

  /** Runs a size/content-changing operation on every cel as one undoable step. */
  private structural(label: string, fn: () => boolean | void): boolean {
    if (this.stroke) return false;
    this.commitFloating();
    const before = snapshotProject(this.project);
    if (fn() === false) return false;
    const after = snapshotProject(this.project);
    this.history.push({ label, patches: [], states: { before, after } });
    this.selection = null;
    this.selectionVersion++;
    this.resetAxes();
    this.touch();
    return true;
  }

  /** anchorX/anchorY: 0 = left/top, 0.5 = center, 1 = right/bottom. */
  resizeCanvas(w: number, h: number, anchorX = 0.5, anchorY = 0.5): boolean {
    return this.structural('Resize canvas', () => resizeProject(this.project, w, h, anchorX, anchorY));
  }

  scaleImage(w: number, h: number): boolean {
    return this.structural('Scale image', () => scaleProject(this.project, w, h));
  }

  cropToSelection(): boolean {
    this.commitFloating();
    const b = this.selection ? maskBounds(this.selection, this.project.width, this.project.height) : null;
    if (!b) return false;
    return this.structural('Crop', () => cropProject(this.project, b));
  }

  trim(): boolean {
    return this.structural('Trim', () => trimProject(this.project));
  }

  // ---- custom brush ---------------------------------------------------------------
  /** Captures the selection as a brush (opaque pixels only, anchored at its center). */
  captureBrush(): boolean {
    this.commitFloating();
    const c = this.selection ? this.readRegion() : null;
    if (!c) return false;
    const ax = Math.floor(c.w / 2), ay = Math.floor(c.h / 2);
    const offsets: Array<readonly [number, number]> = [];
    const colors: number[] = [];
    for (let j = 0; j < c.h; j++) {
      for (let i = 0; i < c.w; i++) {
        const k = j * c.w + i;
        if (!c.mask[k] || c.pixels[k]! >>> 24 === 0) continue;
        offsets.push([i - ax, j - ay]);
        colors.push(c.pixels[k]!);
      }
    }
    if (offsets.length === 0) return false;
    this.customBrush = { offsets, colors };
    this.options = { ...this.options, useCustomBrush: true };
    this.tool = 'pencil';
    this.emit();
    return true;
  }

  clearCustomBrush(): void {
    this.customBrush = null;
    this.options = { ...this.options, useCustomBrush: false };
    this.emit();
  }

  // ---- layers ------------------------------------------------------------------------
  private layerState(celLayerIds: string[]): LayerState {
    const cels: LayerState['cels'] = [];
    for (const f of this.project.frames) {
      for (const id of celLayerIds) {
        const c = f.cels.get(id);
        if (c) cels.push({ frameId: f.id, layerId: id, data: c.slice() });
      }
    }
    return { layers: this.project.layers.map((l) => ({ ...l })), active: this.activeLayer, cels };
  }

  /** Layer list (without pixel data) as it is now; pair with recordLayerChange for live-edited properties. */
  captureLayerState(): LayerState {
    return this.layerState([]);
  }

  /** Pushes one history step if the layer list differs from `before` (taken with captureLayerState). */
  recordLayerChange(label: string, before: LayerState): void {
    const after = this.layerState([]);
    if (JSON.stringify(before.layers) === JSON.stringify(after.layers)) return;
    this.history.push({ label, patches: [], layerStates: { before, after } });
    this.touch();
  }

  /**
   * Runs a layer-structure change as one undoable step. `affected` lists layers whose cels the change may
   * modify or remove; layers created by `fn` are detected automatically.
   */
  private layerOp(label: string, affected: string[], fn: () => boolean | void): boolean {
    if (this.stroke) return false;
    this.commitFloating();
    const before = this.layerState(affected);
    const beforeIds = new Set(before.layers.map((l) => l.id));
    if (fn() === false) return false;
    const ids = new Set(affected);
    for (const l of this.project.layers) if (!beforeIds.has(l.id)) ids.add(l.id);
    const after = this.layerState([...ids]);
    this.history.push({ label, patches: [], layerStates: { before, after } });
    this.touch();
    return true;
  }

  private layerAt(i: number): LayerMeta | undefined {
    return this.project.layers[i];
  }

  setActiveLayer(i: number): void {
    if (this.stroke) return;
    const n = Math.min(this.project.layers.length - 1, Math.max(0, Math.round(i)));
    if (n === this.activeLayer) return;
    this.commitFloating();
    this.activeLayer = n;
    this.emit();
  }

  get canAddLayer(): boolean { return this.project.layers.length < MAX_LAYERS; }

  /** Adds an empty layer above the active one. */
  addLayer(name?: string): boolean {
    if (!this.canAddLayer) return false;
    return this.layerOp('Add layer', [], () => {
      const layer = createLayer(name ?? this.nextLayerName());
      this.project.layers.splice(this.activeLayer + 1, 0, layer);
      for (const f of this.project.frames) f.cels.set(layer.id, createCel(this.project.width, this.project.height));
      this.activeLayer += 1;
    });
  }

  private nextLayerName(): string {
    const used = new Set(this.project.layers.map((l) => l.name));
    for (let n = this.project.layers.length + 1; ; n++) if (!used.has(`Layer ${n}`)) return `Layer ${n}`;
  }

  duplicateLayer(i = this.activeLayer): boolean {
    const src = this.layerAt(i);
    if (!src || !this.canAddLayer) return false;
    return this.layerOp('Duplicate layer', [], () => {
      const copy: LayerMeta = { ...src, id: uid('layer'), name: `${src.name} copy` };
      this.project.layers.splice(i + 1, 0, copy);
      for (const f of this.project.frames) {
        const c = f.cels.get(src.id);
        f.cels.set(copy.id, c ? c.slice() : createCel(this.project.width, this.project.height));
      }
      this.activeLayer = i + 1;
    });
  }

  /** Deletes a layer; the last remaining layer cannot be deleted. */
  deleteLayer(i = this.activeLayer): boolean {
    const layer = this.layerAt(i);
    if (!layer || this.project.layers.length <= 1) return false;
    return this.layerOp('Delete layer', [layer.id], () => {
      this.project.layers.splice(i, 1);
      for (const f of this.project.frames) f.cels.delete(layer.id);
      if (this.activeLayer === i) this.activeLayer = Math.max(0, i - 1);
      else if (this.activeLayer > i) this.activeLayer -= 1;
    });
  }

  /** Moves the layer at index `from` to index `to` (0 = bottom). The active layer follows its layer. */
  moveLayer(from: number, to: number): boolean {
    const n = this.project.layers.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return false;
    return this.layerOp('Reorder layers', [], () => {
      const activeId = this.layer.id;
      const [l] = this.project.layers.splice(from, 1);
      this.project.layers.splice(to, 0, l!);
      this.activeLayer = this.project.layers.findIndex((x) => x.id === activeId);
    });
  }

  /**
   * Changes layer properties. With `record` false the change is applied without a history step
   * (live slider preview); finish with captureLayerState() beforehand and recordLayerChange() after.
   */
  setLayerProps(
    i: number,
    patch: Partial<Pick<LayerMeta, 'name' | 'visible' | 'locked' | 'opacity' | 'blendMode' | 'alphaLock'>>,
    record = true,
  ): boolean {
    const layer = this.layerAt(i);
    if (!layer || this.stroke) return false;
    const next = { ...patch };
    if (next.opacity !== undefined) next.opacity = Math.min(1, Math.max(0, next.opacity));
    if (next.name !== undefined) next.name = next.name.trim().slice(0, 64) || layer.name;
    if ((Object.keys(next) as Array<keyof typeof next>).every((k) => layer[k] === next[k])) return false;
    if (!record) {
      this.commitFloating();
      Object.assign(layer, next);
      this.touch();
      return true;
    }
    const label = 'name' in next ? 'Rename layer' : 'visible' in next ? 'Layer visibility' : 'locked' in next ? 'Layer lock'
      : 'opacity' in next ? 'Layer opacity' : 'blendMode' in next ? 'Layer blend mode' : 'Alpha lock';
    return this.layerOp(label, [], () => { Object.assign(layer, next); });
  }

  /** Blends the layer at `i` into the layer below it (in every frame). */
  mergeDown(i = this.activeLayer): boolean {
    const upper = this.layerAt(i), lower = this.layerAt(i - 1);
    if (!upper || !lower || upper.isReference || lower.isReference) return false;
    return this.layerOp('Merge down', [upper.id, lower.id], () => {
      for (const f of this.project.frames) {
        const lo = f.cels.get(lower.id);
        const up = f.cels.get(upper.id);
        if (lo && up && upper.visible) blendInto(lo, up, upper.opacity, upper.blendMode);
        f.cels.delete(upper.id);
      }
      this.project.layers.splice(i, 1);
      this.activeLayer = i - 1;
    });
  }

  /** Merges every non-reference layer into one, applying visibility, opacity and blend modes. */
  flatten(): boolean {
    const flat = this.project.layers.filter((l) => !l.isReference);
    if (flat.length < 2) return false;
    return this.layerOp('Flatten', flat.map((l) => l.id), () => {
      const target = flat[0]!;
      for (const f of this.project.frames) {
        const merged = compositeFrame({ ...this.project, layers: flat }, f);
        for (const l of flat.slice(1)) f.cels.delete(l.id);
        f.cels.set(target.id, merged);
      }
      Object.assign(target, { visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, locked: false, name: 'Flattened' });
      const drop = new Set(flat.slice(1).map((l) => l.id));
      this.project.layers = this.project.layers.filter((l) => !drop.has(l.id));
      this.activeLayer = this.project.layers.indexOf(target);
    });
  }

  /**
   * Adds an image as a new layer above the active one, placed at the top-left and clipped to the canvas.
   * A reference layer is semi-transparent, never exported, and cannot be drawn on.
   */
  addImageLayer(img: { w: number; h: number; pixels: Uint32Array }, name: string, reference: boolean): boolean {
    if (!this.canAddLayer) return false;
    return this.layerOp(reference ? 'Add reference' : 'Import image', [], () => {
      const { width, height } = this.project;
      const layer = createLayer(name.slice(0, 64) || 'Image');
      if (reference) { layer.isReference = true; layer.opacity = 0.5; layer.locked = true; }
      const cel = createCel(width, height);
      for (let y = 0; y < Math.min(height, img.h); y++) {
        cel.set(img.pixels.subarray(y * img.w, y * img.w + Math.min(width, img.w)), y * width);
      }
      this.project.layers.splice(this.activeLayer + 1, 0, layer);
      for (const f of this.project.frames) f.cels.set(layer.id, f === this.frame ? cel : createCel(width, height));
      this.activeLayer += 1;
    });
  }

  /** Replaces every pixel of color `from` with `to` on unlocked, non-reference layers. Returns pixels changed. */
  replaceColor(from: number, to: number, scope: 'frame' | 'project'): number {
    if (this.stroke || from === to) return 0;
    this.commitFloating();
    const patches: Patch[] = [];
    let changed = 0;
    const frames = scope === 'frame' ? [this.frame] : this.project.frames;
    for (const f of frames) {
      for (const l of this.project.layers) {
        const cel = f.cels.get(l.id);
        if (!cel || l.locked || l.isReference) continue;
        const before = cel.slice();
        let any = false;
        for (let i = 0; i < cel.length; i++) if (cel[i] === from) { cel[i] = to; changed++; any = true; }
        if (!any) continue;
        const p = diffCels(f.id, l.id, before, cel, this.project.width, this.project.height);
        if (p) patches.push(p);
      }
    }
    if (patches.length) {
      this.history.push({ label: 'Replace color', patches });
      this.touch();
    }
    return changed;
  }

  // ---- frames --------------------------------------------------------------------------
  private frameState(celFrameIds: string[]): FrameState {
    const cels: FrameState['cels'] = [];
    for (const f of this.project.frames) {
      if (!celFrameIds.includes(f.id)) continue;
      for (const [layerId, data] of f.cels) cels.push({ frameId: f.id, layerId, data: data.slice() });
    }
    return {
      frames: this.project.frames.map((f) => (f.durationMs === undefined ? { id: f.id } : { id: f.id, durationMs: f.durationMs })),
      tags: this.project.tags.map((t) => ({ ...t })),
      active: this.activeFrame,
      cels,
    };
  }

  /**
   * Runs a frame-list change as one undoable step. `affected` lists frames whose cels may be modified or
   * removed; frames created by `fn` are detected automatically.
   */
  private frameOp(label: string, affected: string[], fn: () => boolean | void): boolean {
    if (this.stroke) return false;
    this.commitFloating();
    const before = this.frameState(affected);
    const beforeIds = new Set(before.frames.map((f) => f.id));
    if (fn() === false) return false;
    const ids = new Set(affected);
    for (const f of this.project.frames) if (!beforeIds.has(f.id)) ids.add(f.id);
    const after = this.frameState([...ids]);
    this.history.push({ label, patches: [], frameStates: { before, after } });
    this.touch();
    return true;
  }

  private blankFrame(): Frame {
    const cels = new Map<string, Uint32Array>();
    for (const l of this.project.layers) cels.set(l.id, createCel(this.project.width, this.project.height));
    return { id: uid('frame'), cels };
  }

  private selectRange(from: number, to: number): void {
    this.frameRange = { from: Math.min(from, to), to: Math.max(from, to) };
  }

  /** Makes frame `i` active. With `extend`, selects the range from the last non-extending selection. */
  setActiveFrame(i: number, extend = false): void {
    if (this.stroke) return;
    const n = Math.min(this.project.frames.length - 1, Math.max(0, Math.round(i)));
    this.commitFloating();
    if (!extend) this.frameAnchor = n;
    this.selectRange(this.frameAnchor, n);
    this.activeFrame = n;
    this.emit();
  }

  get canAddFrame(): boolean { return this.project.frames.length < MAX_FRAMES; }

  /** Adds an empty frame after the active one. */
  addFrame(): boolean {
    if (!this.canAddFrame) return false;
    return this.frameOp('Add frame', [], () => {
      const at = this.activeFrame + 1;
      this.project.frames.splice(at, 0, this.blankFrame());
      this.project.tags = tagsAfterInsert(this.project.tags, at, 1);
      this.activeFrame = at;
      this.frameAnchor = at;
      this.selectRange(at, at);
    });
  }

  /** Duplicates the selected frames, inserting the copies after the selection. */
  duplicateFrames(): boolean {
    const { from, to } = this.frameRange;
    const count = to - from + 1;
    if (this.project.frames.length + count > MAX_FRAMES) return false;
    return this.frameOp('Duplicate frames', [], () => {
      const copies: Frame[] = this.project.frames.slice(from, to + 1).map((f) => ({
        id: uid('frame'),
        ...(f.durationMs === undefined ? {} : { durationMs: f.durationMs }),
        cels: new Map([...f.cels].map(([id, c]) => [id, c.slice()])),
      }));
      this.project.frames.splice(to + 1, 0, ...copies);
      this.project.tags = tagsAfterInsert(this.project.tags, to + 1, count);
      this.activeFrame = to + 1;
      this.frameAnchor = to + 1;
      this.selectRange(to + 1, to + count);
    });
  }

  /** Deletes the selected frames; at least one frame always remains. */
  deleteFrames(): boolean {
    const { from, to } = this.frameRange;
    const count = to - from + 1;
    if (count >= this.project.frames.length) return false;
    const ids = this.project.frames.slice(from, to + 1).map((f) => f.id);
    return this.frameOp('Delete frames', ids, () => {
      this.project.frames.splice(from, count);
      this.project.tags = tagsAfterDelete(this.project.tags, from, count);
      const n = Math.min(from, this.project.frames.length - 1);
      this.activeFrame = n;
      this.frameAnchor = n;
      this.selectRange(n, n);
    });
  }

  /** Moves the frame at `from` to index `to`. Tags keep their index ranges. */
  moveFrame(from: number, to: number): boolean {
    const n = this.project.frames.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return false;
    return this.frameOp('Move frame', [], () => {
      const [f] = this.project.frames.splice(from, 1);
      this.project.frames.splice(to, 0, f!);
      this.activeFrame = to;
      this.frameAnchor = to;
      this.selectRange(to, to);
    });
  }

  /** Sets the duration override (ms) of every selected frame; `undefined` goes back to the project fps. */
  setFrameDuration(ms: number | undefined): boolean {
    const { from, to } = this.frameRange;
    const value = ms === undefined ? undefined : Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(ms)));
    const frames = this.project.frames.slice(from, to + 1);
    if (frames.every((f) => f.durationMs === value)) return false;
    return this.frameOp('Frame duration', [], () => {
      for (const f of frames) { if (value === undefined) delete f.durationMs; else f.durationMs = value; }
    });
  }

  setFps(fps: number): void {
    this.project.fps = clampFps(fps);
    this.touch();
  }

  setOnion(patch: Partial<OnionSettings>): void {
    const o = { ...this.onion, ...patch };
    o.prev = Math.min(5, Math.max(0, Math.round(o.prev)));
    o.next = Math.min(5, Math.max(0, Math.round(o.next)));
    o.opacity = Math.min(1, Math.max(0.05, o.opacity));
    this.onion = o;
    this.emit();
  }

  /** Copies the active layer's cel in the active frame. */
  copyCel(): boolean {
    const cel = this.cel;
    if (!cel) return false;
    this.commitFloating();
    this.celClipboard = cel.slice();
    this.emit();
    return true;
  }

  /** Replaces the active layer's cel in the active frame with the copied cel. */
  pasteCel(): boolean {
    const src = this.celClipboard;
    if (!src || src.length !== this.project.width * this.project.height || !this.drawable) return false;
    const frame = this.frame;
    const layerId = this.layer.id;
    this.commitFloating();
    const before = frame.cels.get(layerId)!.slice();
    const cel = frame.cels.get(layerId)!;
    cel.set(src);
    const patch = diffCels(frame.id, layerId, before, cel, this.project.width, this.project.height);
    if (!patch) return false;
    this.history.push({ label: 'Paste cel', patches: [patch] });
    this.touch();
    return true;
  }

  addTag(name: string, from: number, to: number, direction: TagDirection = 'forward', loop = true): boolean {
    const n = this.project.frames.length;
    const a = Math.min(from, to), b = Math.max(from, to);
    if (a < 0 || b >= n) return false;
    return this.frameOp('Add tag', [], () => {
      this.project.tags.push({ id: uid('tag'), name: name.trim().slice(0, 40) || 'tag', from: a, to: b, direction, loop });
    });
  }

  updateTag(id: string, patch: Partial<{ name: string; from: number; to: number; direction: TagDirection; loop: boolean }>): boolean {
    const t = this.project.tags.find((x) => x.id === id);
    if (!t) return false;
    const n = this.project.frames.length;
    const next = { ...t, ...patch };
    next.from = Math.min(n - 1, Math.max(0, Math.round(next.from)));
    next.to = Math.min(n - 1, Math.max(0, Math.round(next.to)));
    if (next.from > next.to) [next.from, next.to] = [next.to, next.from];
    next.name = next.name.trim().slice(0, 40) || t.name;
    if (JSON.stringify(next) === JSON.stringify(t)) return false;
    return this.frameOp('Edit tag', [], () => { Object.assign(t, next); });
  }

  removeTag(id: string): boolean {
    if (!this.project.tags.some((t) => t.id === id)) return false;
    return this.frameOp('Remove tag', [], () => { this.project.tags = this.project.tags.filter((t) => t.id !== id); });
  }

  /** Replaces the project with one layer and the given frames (GIF / sprite sheet import). */
  loadFrames(frames: Array<{ pixels: Uint32Array; durationMs?: number }>, w: number, h: number, name: string): boolean {
    const width = clampSize(w), height = clampSize(h);
    const list = frames.slice(0, MAX_FRAMES);
    if (list.length === 0 || list.some((f) => f.pixels.length !== width * height)) return false;
    this.newProject({ width, height, name });
    const layerId = this.project.layers[0]!.id;
    this.project.frames = list.map((f) => ({
      id: uid('frame'),
      ...(f.durationMs === undefined ? {} : { durationMs: f.durationMs }),
      cels: new Map([[layerId, f.pixels.slice()]]),
    }));
    this.emit();
    return true;
  }

  // ---- palette -----------------------------------------------------------------------
  setPalette(name: string, colors: ReadonlyArray<number>): void {
    this.project.palette = { name, colors: colors.slice(0, MAX_PALETTE_COLORS) };
    this.touch();
  }

  addPaletteColor(c: number): boolean {
    const p = this.project.palette;
    if (p.colors.length >= MAX_PALETTE_COLORS || p.colors.includes(c)) return false;
    p.colors.push(c);
    this.touch();
    return true;
  }

  removePaletteColor(i: number): void {
    const p = this.project.palette;
    if (i < 0 || i >= p.colors.length) return;
    p.colors.splice(i, 1);
    this.touch();
  }

  movePaletteColor(from: number, to: number): void {
    const c = this.project.palette.colors;
    if (from === to || from < 0 || to < 0 || from >= c.length || to >= c.length) return;
    c.splice(to, 0, c.splice(from, 1)[0]!);
    this.touch();
  }

  setPaletteColor(i: number, color: number): void {
    const c = this.project.palette.colors;
    if (i < 0 || i >= c.length) return;
    c[i] = color;
    this.touch();
  }

  /** Palette made from the visible colors of the current frame (reference layers excluded). */
  paletteFromImage(max = 256): number[] {
    return extractPalette(compositeFrame(this.project, this.frame), max);
  }

  // ---- history ---------------------------------------------------------------------
  undo(): void {
    if (this.stroke) return;
    if (this.floating) { this.cancelFloating(); return; }
    if (this.history.undo(this.project)) this.afterHistory();
  }

  redo(): void {
    if (this.stroke || this.floating) return;
    if (this.history.redo(this.project)) this.afterHistory();
  }

  private afterHistory(): void {
    if (this.history.lastActive !== undefined) this.activeLayer = this.history.lastActive;
    if (this.history.lastActiveFrame !== undefined) this.activeFrame = this.history.lastActiveFrame;
    this.activeFrame = Math.min(this.project.frames.length - 1, Math.max(0, this.activeFrame));
    this.frameAnchor = this.activeFrame;
    this.selectRange(this.activeFrame, this.activeFrame);
    this.activeLayer = Math.min(this.project.layers.length - 1, Math.max(0, this.activeLayer));
    const n = this.project.width * this.project.height;
    if (this.selection && this.selection.length !== n) { this.selection = null; this.selectionVersion++; }
    const s = this.symmetry;
    if (s.axisX > this.project.width || s.axisY > this.project.height) this.resetAxes();
    this.touch();
  }
}
