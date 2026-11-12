import { frameDuration, playbackSequence } from '../core/animation';
import { compositeFrame } from '../core/composite';
import { decodeGif } from '../core/gifdecode';
import type { Project } from '../core/project';
import { buildSheet, sheetJson, type SheetOptions } from '../core/sheet';
import { scaleCel } from '../core/transform';
import { celToImageData } from '../render/imagedata';
import type { GifJob } from './gif';

export interface ExportRange {
  /** Frame indices in play order (ping-pong tags repeat frames). */
  sequence: number[];
}

/** 'all' or a tag id -> the frame order to export. */
export function exportRange(project: Project, which: string): ExportRange {
  const tag = project.tags.find((t) => t.id === which);
  if (tag) return { sequence: playbackSequence(tag.from, tag.to, tag.direction) };
  return { sequence: project.frames.map((_, i) => i) };
}

function toCanvas(px: Uint32Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(celToImageData(px, w, h), 0, 0);
  return c;
}

function canvasBlob(c: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type));
}

/** Runs GIF encoding in a worker, reporting progress as frames complete. */
export function encodeGifInWorker(job: GifJob, onProgress: (done: number, total: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; bytes?: Uint8Array; message?: string }>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.done ?? 0, m.total ?? 0);
      else if (m.type === 'done') { worker.terminate(); resolve(m.bytes!); }
      else { worker.terminate(); reject(new Error(m.message ?? 'GIF encoding failed')); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'GIF encoding failed')); };
    worker.postMessage(job, job.frames.map((f) => f.buffer));
  });
}

export function gifJob(project: Project, range: ExportRange, scale: number, loop: boolean): GifJob {
  return {
    frames: range.sequence.map((i) => compositeFrame(project, project.frames[i]!)),
    delaysMs: range.sequence.map((i) => frameDuration(project, project.frames[i]!)),
    width: project.width,
    height: project.height,
    scale,
    loop,
  };
}

export async function exportSheet(project: Project, range: ExportRange, scale: number, opts: SheetOptions, imageName: string): Promise<{ png: Blob; json: string }> {
  const { width: w, height: h } = project;
  const frames = range.sequence.map((i) => compositeFrame(project, project.frames[i]!));
  const { pixels, geometry } = buildSheet(frames, w, h, opts);
  const sheetCanvas = toCanvas(pixels, geometry.width, geometry.height);
  let png: Blob;
  if (scale === 1) png = await canvasBlob(sheetCanvas);
  else {
    const out = document.createElement('canvas');
    out.width = geometry.width * scale;
    out.height = geometry.height * scale;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheetCanvas, 0, 0, out.width, out.height);
    png = await canvasBlob(out);
  }
  // JSON describes the scaled sheet so the rectangles match the exported image.
  const scaledGeometry = {
    width: geometry.width * scale, height: geometry.height * scale,
    cells: geometry.cells.map((c) => ({ x: c.x * scale, y: c.y * scale })),
  };
  const durations = range.sequence.map((i) => frameDuration(project, project.frames[i]!));
  return { png, json: sheetJson(imageName, scaledGeometry, w * scale, h * scale, durations, project.tags) };
}

/** Which video container this browser can record, or null (the option is then hidden). */
export function videoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  for (const t of ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/** Records one pass of the animation in real time with MediaRecorder. */
export async function recordVideo(project: Project, range: ExportRange, scale: number, mime: string, onProgress: (done: number, total: number) => void): Promise<Blob> {
  const { width: w, height: h } = project;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const draw = (i: number): void => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const px = scale === 1 ? compositeFrame(project, project.frames[i]!) : scaleCel(compositeFrame(project, project.frames[i]!), w, h, w * scale, h * scale);
    ctx.drawImage(toCanvas(px, w * scale, h * scale), 0, 0);
  };
  draw(range.sequence[0]!);
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
  rec.start();
  for (let n = 0; n < range.sequence.length; n++) {
    const i = range.sequence[n]!;
    draw(i);
    onProgress(n + 1, range.sequence.length);
    await new Promise((r) => setTimeout(r, frameDuration(project, project.frames[i]!)));
  }
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: mime.split(';')[0] });
}

export async function readGifFile(file: File): Promise<{ width: number; height: number; frames: Array<{ pixels: Uint32Array; durationMs: number }> }> {
  const gif = decodeGif(new Uint8Array(await file.arrayBuffer()));
  return { width: gif.width, height: gif.height, frames: gif.frames.map((f) => ({ pixels: f.pixels, durationMs: f.delayMs })) };
}
