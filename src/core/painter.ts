export interface Symmetry {
  /** Mirror left/right across the vertical axis at `axisX`. */
  x: boolean;
  /** Mirror top/bottom across the horizontal axis at `axisY`. */
  y: boolean;
  /** Axis positions in pixel-edge coordinates (0..width). Multiples of 0.5 so mirrored pixels stay on the grid. */
  axisX: number;
  axisY: number;
}

export function defaultSymmetry(w: number, h: number): Symmetry {
  return { x: false, y: false, axisX: w / 2, axisY: h / 2 };
}

/** Mirror a pixel coordinate across an axis given in pixel-edge coordinates. */
export function mirrorCoord(v: number, axis: number): number {
  return Math.round(2 * axis - v - 1);
}

export interface PainterOptions {
  /** Only touch pixels that already have alpha, keeping that alpha. */
  alphaLock?: boolean;
  /** Maps every written (non-transparent) color, e.g. to the nearest palette color. */
  snap?: ((color: number) => number) | null;
  /** Tile mode: coordinates wrap around the canvas edges instead of being clipped. */
  wrap?: boolean;
}

/**
 * Every drawing tool writes pixels through a Painter, which applies the selection mask and
 * symmetry in one place. Out-of-bounds writes are ignored.
 */
export class Painter {
  private fixed = 0;
  private fn: ((cur: number, x: number, y: number) => number) | null = null;

  constructor(
    private readonly cel: Uint32Array,
    readonly w: number,
    readonly h: number,
    private readonly mask: Uint8Array | null,
    private readonly sym: Symmetry,
    private readonly opts: PainterOptions = {},
  ) {}

  /** Writes a fixed color (and its mirrored copies). */
  put(x: number, y: number, color: number): void {
    this.fixed = color;
    this.fn = null;
    this.run(x, y);
  }

  /** Writes fn(currentColor, finalX, finalY) at (x,y) (and mirrored copies). */
  paint(x: number, y: number, fn: (cur: number, x: number, y: number) => number): void {
    this.fn = fn;
    this.run(x, y);
  }

  private run(x: number, y: number): void {
    const { sym } = this;
    this.apply(x, y);
    const mx = sym.x ? mirrorCoord(x, sym.axisX) : x;
    const my = sym.y ? mirrorCoord(y, sym.axisY) : y;
    if (sym.x && mx !== x) this.apply(mx, y);
    if (sym.y && my !== y) this.apply(x, my);
    if (sym.x && sym.y && mx !== x && my !== y) this.apply(mx, my);
  }

  private apply(x: number, y: number): void {
    if (this.opts.wrap) {
      x = ((x % this.w) + this.w) % this.w;
      y = ((y % this.h) + this.h) % this.h;
    } else if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.mask && !this.mask[i]) return;
    const cur = this.cel[i]!;
    let v = this.fn ? this.fn(cur, x, y) : this.fixed;
    const { alphaLock, snap } = this.opts;
    if (alphaLock && ((cur >>> 24) === 0 || (v >>> 24) === 0)) return;
    if (snap && (v >>> 24) !== 0) v = snap(v);
    if (alphaLock) v = ((v & 0x00ffffff) | (cur & 0xff000000)) >>> 0;
    this.cel[i] = v;
  }
}

export function createPainter(cel: Uint32Array, w: number, h: number, mask: Uint8Array | null, sym: Symmetry, opts: PainterOptions = {}): Painter {
  return new Painter(cel, w, h, mask, sym, opts);
}
