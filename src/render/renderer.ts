import { brushFootprint } from '../core/brush';
import { compositeFrame, compositeFrameInto } from '../core/composite';
import { buildOnion } from '../core/onion';
import type { Editor } from '../core/editor';
import { maskEdges } from '../core/selection';
import { celToImageData } from './imagedata';
import { GRID_MIN_ZOOM, type Viewport } from './viewport';

const BRUSH_TOOLS = new Set(['pencil', 'eraser', 'dither', 'shading', 'line', 'rect', 'ellipse']);
const NO_CURSOR_TOOLS = new Set(['move', 'select', 'lasso', 'wand', 'text']);

export class Renderer {
  showGrid = true;
  /** Custom grid cell size in image pixels (0 = off) and its color. */
  customGrid = { w: 0, h: 0, color: '#ff4081' };
  stageColor = '#16161c';
  /** Pixel under the cursor, or null. */
  hover: { x: number; y: number } | null = null;
  private ctx: CanvasRenderingContext2D;
  private off = document.createElement('canvas');
  private offCtx = this.off.getContext('2d')!;
  private onionOff = document.createElement('canvas');
  private showOnion = false;
  private composite = new Uint32Array(0);
  private checker: CanvasPattern;
  private dirty = true;
  private raf = 0;
  private antsTimer = 0;
  private phase = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private antsPath: Path2D | null = null;
  private antsKey = '';

  constructor(private canvas: HTMLCanvasElement, private editor: Editor, private vp: Viewport) {
    this.ctx = canvas.getContext('2d')!;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const cc = c.getContext('2d')!;
    cc.fillStyle = '#ffffff';
    cc.fillRect(0, 0, 16, 16);
    cc.fillStyle = '#cfcfcf';
    cc.fillRect(0, 0, 8, 8);
    cc.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(c, 'repeat')!;
  }

  get width(): number { return this.cssW; }
  get height(): number { return this.cssH; }

  resize(cssW: number, cssH: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.requestDraw();
  }

  /** Pixel data changed: recomposite on next frame. */
  invalidate(): void {
    this.dirty = true;
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private updateComposite(): void {
    const p = this.editor.project;
    if (this.off.width !== p.width || this.off.height !== p.height) {
      this.off.width = p.width;
      this.off.height = p.height;
      this.composite = new Uint32Array(p.width * p.height);
    }
    compositeFrameInto(this.composite, p, p.frames[this.editor.activeFrame]!, { reference: true });
    const o = this.editor.onion;
    this.showOnion = o.enabled && p.frames.length > 1 && (o.prev > 0 || o.next > 0);
    if (this.showOnion) {
      this.onionOff.width = p.width;
      this.onionOff.height = p.height;
      const buf = buildOnion(p.frames.length, this.editor.activeFrame, o, (i) => compositeFrame(p, p.frames[i]!), p.width * p.height);
      this.onionOff.getContext('2d')!.putImageData(celToImageData(buf, p.width, p.height), 0, 0);
    }
    this.offCtx.putImageData(celToImageData(this.composite, p.width, p.height), 0, 0);
    this.dirty = false;
  }

  private draw(): void {
    if (this.dirty) this.updateComposite();
    const { ctx, vp, editor } = this;
    const { width: iw, height: ih } = editor.project;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.stageColor;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const z = vp.zoom;
    const tile = editor.tileMode;
    const rx0 = vp.panX - (tile ? iw * z : 0), ry0 = vp.panY - (tile ? ih * z : 0);
    const rx1 = vp.panX + iw * z * (tile ? 2 : 1), ry1 = vp.panY + ih * z * (tile ? 2 : 1);
    const x0 = Math.max(0, rx0);
    const y0 = Math.max(0, ry0);
    const x1 = Math.min(this.cssW, rx1);
    const y1 = Math.min(this.cssH, ry1);
    if (x1 <= x0 || y1 <= y0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    for (let ty = tile ? -1 : 0; ty <= (tile ? 1 : 0); ty++) {
      for (let tx = tile ? -1 : 0; tx <= (tile ? 1 : 0); tx++) {
        const ox = vp.panX + tx * iw * z, oy = vp.panY + ty * ih * z;
        ctx.globalAlpha = tx === 0 && ty === 0 ? 1 : 0.55;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillStyle = this.checker;
        ctx.fillRect(0, 0, iw * z, ih * z);
        ctx.restore();
        if (this.showOnion) ctx.drawImage(this.onionOff, ox, oy, iw * z, ih * z);
        ctx.drawImage(this.off, ox, oy, iw * z, ih * z);
      }
    }
    ctx.globalAlpha = 1;
    if (tile) {
      ctx.strokeStyle = 'rgba(91,140,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(vp.panX) + 0.5, Math.round(vp.panY) + 0.5, iw * z - 1, ih * z - 1);
    }

    if (this.showGrid && z >= GRID_MIN_ZOOM) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const firstX = Math.max(0, Math.floor((x0 - vp.panX) / z));
      const lastX = Math.min(iw, Math.ceil((x1 - vp.panX) / z));
      for (let i = firstX; i <= lastX; i++) {
        const sx = Math.round(vp.panX + i * z) + 0.5;
        ctx.moveTo(sx, y0);
        ctx.lineTo(sx, y1);
      }
      const firstY = Math.max(0, Math.floor((y0 - vp.panY) / z));
      const lastY = Math.min(ih, Math.ceil((y1 - vp.panY) / z));
      for (let j = firstY; j <= lastY; j++) {
        const sy = Math.round(vp.panY + j * z) + 0.5;
        ctx.moveTo(x0, sy);
        ctx.lineTo(x1, sy);
      }
      ctx.stroke();
    }
    const cg = this.customGrid;
    if (cg.w > 0 && cg.h > 0 && this.showGrid && z >= 2) {
      ctx.strokeStyle = cg.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= iw; gx += cg.w) { const sx = Math.round(vp.panX + gx * z) + 0.5; ctx.moveTo(sx, Math.max(y0, vp.panY)); ctx.lineTo(sx, Math.min(y1, vp.panY + ih * z)); }
      for (let gy = 0; gy <= ih; gy += cg.h) { const sy = Math.round(vp.panY + gy * z) + 0.5; ctx.moveTo(Math.max(x0, vp.panX), sy); ctx.lineTo(Math.min(x1, vp.panX + iw * z), sy); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    this.drawSelection();
    this.drawTransient();
    this.drawSymmetry();
    this.drawCursor();

    // Keep the marching ants moving while a selection exists.
    if (editor.selection && !this.antsTimer) {
      this.antsTimer = window.setTimeout(() => {
        this.antsTimer = 0;
        this.phase = (this.phase + 1) % 8;
        this.requestDraw();
      }, 110);
    }
  }

  /** Runs `fn` in image-pixel coordinates with 1-device-pixel-ish line widths. */
  private inImageSpace(fn: (z: number) => void): void {
    const { ctx, vp } = this;
    ctx.save();
    ctx.translate(vp.panX, vp.panY);
    ctx.scale(vp.zoom, vp.zoom);
    ctx.lineWidth = 1 / vp.zoom;
    fn(vp.zoom);
    ctx.restore();
  }

  private ants(path: Path2D): void {
    const { ctx } = this;
    this.inImageSpace((z) => {
      const dash = 4 / z;
      ctx.setLineDash([dash, dash]);
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = -(this.phase / 2) * (1 / z);
      ctx.stroke(path);
      ctx.strokeStyle = '#fff';
      ctx.lineDashOffset = -(this.phase / 2) * (1 / z) + dash;
      ctx.stroke(path);
    });
  }

  private drawSelection(): void {
    const { editor } = this;
    const sel = editor.selection;
    if (!sel) { this.antsPath = null; return; }
    const key = `${editor.selectionVersion}:${editor.project.width}x${editor.project.height}`;
    if (key !== this.antsKey || !this.antsPath) {
      const path = new Path2D();
      const e = maskEdges(sel, editor.project.width, editor.project.height);
      for (let i = 0; i < e.length; i += 4) {
        path.moveTo(e[i]!, e[i + 1]!);
        path.lineTo(e[i + 2]!, e[i + 3]!);
      }
      this.antsPath = path;
      this.antsKey = key;
    }
    this.ants(this.antsPath);
  }

  private drawTransient(): void {
    const { editor, ctx } = this;
    const m = editor.marquee;
    if (m) {
      const p = new Path2D();
      p.rect(m.x, m.y, m.w, m.h);
      this.ants(p);
    }
    const poly = editor.polyPts;
    const free = editor.lassoPts;
    const pts = free ?? poly;
    if (pts && pts.length > 0) {
      const p = new Path2D();
      p.moveTo(pts[0]![0] + 0.5, pts[0]![1] + 0.5);
      for (const [x, y] of pts.slice(1)) p.lineTo(x + 0.5, y + 0.5);
      if (poly && !free && this.hover) p.lineTo(this.hover.x + 0.5, this.hover.y + 0.5);
      this.ants(p);
      if (poly && !free) {
        this.inImageSpace(() => {
          ctx.fillStyle = '#5b8cff';
          for (const [x, y] of pts) ctx.fillRect(x + 0.25, y + 0.25, 0.5, 0.5);
        });
      }
    }
  }

  private drawSymmetry(): void {
    const { editor, ctx, vp } = this;
    const s = editor.symmetry;
    if (!s.x && !s.y) return;
    const { width: iw, height: ih } = editor.project;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,80,160,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (s.x) {
      const sx = Math.round(vp.panX + s.axisX * vp.zoom) + 0.5;
      ctx.moveTo(sx, vp.panY - 8);
      ctx.lineTo(sx, vp.panY + ih * vp.zoom + 8);
    }
    if (s.y) {
      const sy = Math.round(vp.panY + s.axisY * vp.zoom) + 0.5;
      ctx.moveTo(vp.panX - 8, sy);
      ctx.lineTo(vp.panX + iw * vp.zoom + 8, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawCursor(): void {
    const h = this.hover;
    if (!h) return;
    const { ctx, vp, editor } = this;
    const tool = editor.tool;
    if (NO_CURSOR_TOOLS.has(tool)) return;
    const z = vp.zoom;
    let offsets: ReadonlyArray<readonly [number, number]> = [[0, 0]];
    if (BRUSH_TOOLS.has(tool)) {
      offsets = tool === 'pencil' && editor.options.useCustomBrush && editor.customBrush
        ? editor.customBrush.offsets
        : brushFootprint(editor.options.size, editor.options.shape);
    }
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    for (const [ox, oy] of offsets) {
      const sx = vp.panX + (h.x + ox) * z;
      const sy = vp.panY + (h.y + oy) * z;
      ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, z - 1, z - 1);
    }
    ctx.restore();
  }
}
