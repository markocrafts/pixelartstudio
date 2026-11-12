import type { BlendMode, Frame, Project } from './project';

/** Blend function B(cb, cs) on 0..1 channels (W3C compositing, separable modes). */
export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs); // hard light with swapped roles
    case 'add': return Math.min(1, cb + cs);
    case 'subtract': return Math.max(0, cb - cs);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    case 'difference': return Math.abs(cb - cs);
    default: return cs;
  }
}

/** Blends `src` onto `dst` (both packed RGBA, same size) at the given opacity and blend mode. */
export function blendInto(dst: Uint32Array, src: Uint32Array, opacity: number, mode: BlendMode = 'normal'): void {
  const normal = mode === 'normal';
  for (let i = 0; i < src.length; i++) {
    const s = src[i]!;
    const sa8 = s >>> 24;
    if (sa8 === 0) continue;
    if (normal && sa8 === 255 && opacity >= 1) { dst[i] = s; continue; }
    const sa = (sa8 / 255) * opacity;
    if (sa <= 0) continue;
    const d = dst[i]!;
    const da = (d >>> 24) / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) continue;
    let sr = s & 255, sg = (s >>> 8) & 255, sb = (s >>> 16) & 255;
    const dr = d & 255, dg = (d >>> 8) & 255, db = (d >>> 16) & 255;
    if (!normal && da > 0) {
      // Cs' = (1 - ab) * Cs + ab * B(Cb, Cs)
      sr = 255 * ((1 - da) * (sr / 255) + da * blendChannel(mode, dr / 255, sr / 255));
      sg = 255 * ((1 - da) * (sg / 255) + da * blendChannel(mode, dg / 255, sg / 255));
      sb = 255 * ((1 - da) * (sb / 255) + da * blendChannel(mode, db / 255, sb / 255));
    }
    const k = da * (1 - sa);
    const r = (sr * sa + dr * k) / oa;
    const g = (sg * sa + dg * k) / oa;
    const b = (sb * sa + db * k) / oa;
    dst[i] = ((Math.round(oa * 255) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }
}

export interface CompositeOptions {
  /** Draw reference layers too (editor view only; exports leave them out). */
  reference?: boolean;
}

/** Composites all visible layers of a frame (bottom to top) into `out`. */
export function compositeFrameInto(out: Uint32Array, project: Project, frame: Frame, opts: CompositeOptions = {}): void {
  out.fill(0);
  for (const layer of project.layers) {
    if (!layer.visible || (layer.isReference && !opts.reference)) continue;
    const cel = frame.cels.get(layer.id);
    if (cel) blendInto(out, cel, layer.opacity, layer.isReference ? 'normal' : layer.blendMode);
  }
}

export function compositeFrame(project: Project, frame: Frame, opts: CompositeOptions = {}): Uint32Array {
  const out = new Uint32Array(project.width * project.height);
  compositeFrameInto(out, project, frame, opts);
  return out;
}
