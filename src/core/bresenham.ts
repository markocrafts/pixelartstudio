/** Calls cb for every pixel on the line from (x0,y0) to (x1,y1), both endpoints included. */
export function forEachLinePoint(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    cb(x, y);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export function bresenham(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  forEachLinePoint(x0, y0, x1, y1, (x, y) => pts.push([x, y]));
  return pts;
}
