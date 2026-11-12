import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { BLEND_MODES, MAX_CANVAS_SIZE, MAX_FRAMES, MAX_LAYERS, type BlendMode, type FrameTag, type LayerMeta, type Project, type TagDirection } from './project';

/** Native project file: a zip holding `project.json` and one raw RGBA cel file per frame and layer. */
export const PXF_VERSION = 1;

interface PxfJson {
  format: 'pxf';
  version: number;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt: number;
  updatedAt: number;
  layers: LayerMeta[];
  frames: Array<{ id: string; durationMs?: number }>;
  palette: { name: string; colors: number[] };
  tags: FrameTag[];
}

const celPath = (frame: number, layer: number): string => `cels/${frame}_${layer}.bin`;

export function serializePxf(p: Project): Uint8Array {
  const json: PxfJson = {
    format: 'pxf',
    version: PXF_VERSION,
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    layers: p.layers.map((l) => ({ ...l })),
    frames: p.frames.map((f) => (f.durationMs === undefined ? { id: f.id } : { id: f.id, durationMs: f.durationMs })),
    palette: { name: p.palette.name, colors: [...p.palette.colors] },
    tags: p.tags.map((t) => ({ ...t })),
  };
  const files: Zippable = { 'project.json': [strToU8(JSON.stringify(json)), { level: 6 }] };
  p.frames.forEach((f, fi) => p.layers.forEach((l, li) => {
    const cel = f.cels.get(l.id);
    if (cel) files[celPath(fi, li)] = [new Uint8Array(cel.buffer, cel.byteOffset, cel.byteLength), { level: 6 }];
  }));
  return zipSync(files);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, d: string, max = 128): string => (typeof v === 'string' ? v.slice(0, max) : d);
const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Reads a `.pxf`. The file is untrusted, so every field is validated and clamped. Throws on malformed input. */
export function parsePxf(bytes: Uint8Array): Project {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Not a valid .pxf file (could not read the archive)');
  }
  const raw = files['project.json'];
  if (!raw) throw new Error('Not a valid .pxf file (project.json is missing)');
  let j: unknown;
  try { j = JSON.parse(strFromU8(raw)); } catch { throw new Error('Corrupt .pxf (project.json is not valid JSON)'); }
  if (!isObj(j) || j.format !== 'pxf') throw new Error('Not a Pixel Art Studio project file');
  if (typeof j.version !== 'number' || j.version > PXF_VERSION) throw new Error('This project was saved by a newer version of Pixel Art Studio');

  const width = Math.round(num(j.width, 0, 0, MAX_CANVAS_SIZE)), height = Math.round(num(j.height, 0, 0, MAX_CANVAS_SIZE));
  if (width < 1 || height < 1) throw new Error('Corrupt .pxf (bad canvas size)');
  if (!Array.isArray(j.layers) || j.layers.length < 1 || j.layers.length > MAX_LAYERS) throw new Error('Corrupt .pxf (bad layer list)');
  if (!Array.isArray(j.frames) || j.frames.length < 1 || j.frames.length > MAX_FRAMES) throw new Error('Corrupt .pxf (bad frame list)');

  const seen = new Set<string>();
  const layers: LayerMeta[] = j.layers.map((l: unknown, i: number) => {
    const o = isObj(l) ? l : {};
    let id = str(o.id, `layer_${i}`, 64);
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const bm = BLEND_MODES.includes(o.blendMode as BlendMode) ? (o.blendMode as BlendMode) : 'normal';
    return {
      id, name: str(o.name, `Layer ${i + 1}`, 64), visible: o.visible !== false, locked: o.locked === true,
      opacity: num(o.opacity, 1, 0, 1), blendMode: bm, isReference: o.isReference === true, alphaLock: o.alphaLock === true,
    };
  });
  const frameIds = new Set<string>();
  const frames = j.frames.map((f: unknown, fi: number) => {
    const o = isObj(f) ? f : {};
    let id = str(o.id, `frame_${fi}`, 64);
    if (frameIds.has(id)) id = `${id}_${fi}`;
    frameIds.add(id);
    const cels = new Map<string, Uint32Array>();
    layers.forEach((l, li) => {
      const data = files[celPath(fi, li)];
      if (!data) { cels.set(l.id, new Uint32Array(width * height)); return; }
      if (data.byteLength !== width * height * 4) throw new Error('Corrupt .pxf (a cel has the wrong size)');
      cels.set(l.id, new Uint32Array(data.slice().buffer));
    });
    const frame: Project['frames'][number] = { id, cels };
    if (typeof o.durationMs === 'number' && Number.isFinite(o.durationMs)) frame.durationMs = Math.min(60000, Math.max(10, Math.round(o.durationMs)));
    return frame;
  });

  const pal = isObj(j.palette) ? j.palette : {};
  const colors = Array.isArray(pal.colors) ? pal.colors.filter((c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 0xffffffff).slice(0, 1024) : [];
  const dirs: TagDirection[] = ['forward', 'reverse', 'pingpong'];
  const tags: FrameTag[] = (Array.isArray(j.tags) ? j.tags : []).flatMap((t: unknown, i: number) => {
    if (!isObj(t)) return [];
    const from = Math.round(num(t.from, 0, 0, frames.length - 1)), to = Math.round(num(t.to, from, 0, frames.length - 1));
    return [{
      id: str(t.id, `tag_${i}`, 64), name: str(t.name, 'tag', 40), from: Math.min(from, to), to: Math.max(from, to),
      direction: dirs.includes(t.direction as TagDirection) ? (t.direction as TagDirection) : 'forward', loop: t.loop !== false,
    }];
  });
  const now = Date.now();
  return {
    id: str(j.id, `proj_${now.toString(36)}`, 64), name: str(j.name, 'Untitled', 128), width, height, frames, layers,
    palette: { name: str(pal.name, 'Palette', 64), colors }, tags, fps: Math.round(num(j.fps, 10, 1, 60)),
    createdAt: num(j.createdAt, now, 0, Number.MAX_SAFE_INTEGER), updatedAt: num(j.updatedAt, now, 0, Number.MAX_SAFE_INTEGER),
  };
}
