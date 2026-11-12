export type Point = [number, number];

/**
 * Removes "L-corner" pixels from a 1px stroke path: when a, b, p form an orthogonal bend
 * (a->b and b->p are both axis-aligned unit steps, a and p diagonal), b is dropped.
 * Consecutive duplicate points are collapsed.
 */
export function pixelPerfect(points: ReadonlyArray<Point>): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      const diagonal = a[0] !== p[0] && a[1] !== p[1] && Math.abs(a[0] - p[0]) === 1 && Math.abs(a[1] - p[1]) === 1;
      const bendsAtB = (a[0] === b[0] && b[1] === p[1]) || (a[1] === b[1] && b[0] === p[0]);
      if (diagonal && bendsAtB) out.pop();
    }
    out.push(p);
  }
  return out;
}
