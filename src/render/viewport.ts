export const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;
/** The pixel grid is drawn at or above this zoom. */
export const GRID_MIN_ZOOM = 8;

/** Pure view math. panX/panY are the screen position (CSS px) of the image's top-left corner. */
export class Viewport {
  zoom = 8;
  panX = 0;
  panY = 0;

  screenToImage(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  screenToPixel(sx: number, sy: number): { x: number; y: number } {
    const p = this.screenToImage(sx, sy);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }

  panBy(dx: number, dy: number): void {
    this.panX = Math.round(this.panX + dx);
    this.panY = Math.round(this.panY + dy);
  }

  /** Sets the zoom, keeping the image point under (sx,sy) fixed on screen. */
  setZoomAt(zoom: number, sx: number, sy: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const p = this.screenToImage(sx, sy);
    this.zoom = z;
    this.panX = Math.round(sx - p.x * z);
    this.panY = Math.round(sy - p.y * z);
  }

  stepZoom(dir: 1 | -1, sx: number, sy: number): void {
    const next: number = dir > 0
      ? (ZOOM_LEVELS.find((z) => z > this.zoom) ?? MAX_ZOOM)
      : ([...ZOOM_LEVELS].reverse().find((z) => z < this.zoom) ?? MIN_ZOOM);
    this.setZoomAt(next, sx, sy);
  }

  center(viewW: number, viewH: number, imgW: number, imgH: number): void {
    this.panX = Math.round((viewW - imgW * this.zoom) / 2);
    this.panY = Math.round((viewH - imgH * this.zoom) / 2);
  }

  /** Largest zoom level at which the whole image fits (never below 1x), centered. */
  fit(viewW: number, viewH: number, imgW: number, imgH: number, margin = 24): void {
    const availW = Math.max(1, viewW - margin * 2);
    const availH = Math.max(1, viewH - margin * 2);
    let best: number = MIN_ZOOM;
    for (const z of ZOOM_LEVELS) if (imgW * z <= availW && imgH * z <= availH) best = z;
    this.zoom = best;
    this.center(viewW, viewH, imgW, imgH);
  }

  actualSize(viewW: number, viewH: number, imgW: number, imgH: number): void {
    this.zoom = 1;
    this.center(viewW, viewH, imgW, imgH);
  }
}

/** Clamp a pixel coordinate to the canvas so a stroke stops at the edge instead of leaving it. */
export function clampToCanvas(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: Math.min(Math.max(x, 0), w - 1), y: Math.min(Math.max(y, 0), h - 1) };
}
