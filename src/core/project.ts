import { createCel, packRGBA } from './pixels';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'add'
  | 'subtract' | 'darken' | 'lighten' | 'difference';

export const MAX_CANVAS_SIZE = 2048;
export const MAX_LAYERS = 64;
export const MAX_FRAMES = 512;
export const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'add', 'subtract', 'darken', 'lighten', 'difference'];

export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blendMode: BlendMode;
  isReference: boolean;
  /** Paint only on pixels that already have alpha; alpha itself is preserved. */
  alphaLock: boolean;
}

export interface Frame {
  id: string;
  durationMs?: number;
  cels: Map<string, Uint32Array>;
}

export type TagDirection = 'forward' | 'reverse' | 'pingpong';

/** A named, inclusive range of frame indices with its own playback settings. */
export interface FrameTag {
  id: string;
  name: string;
  from: number;
  to: number;
  direction: TagDirection;
  loop: boolean;
}

export interface Palette {
  name: string;
  colors: number[]; // packed RGBA
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  frames: Frame[];
  layers: LayerMeta[]; // index 0 is the bottom layer
  palette: Palette;
  tags: FrameTag[];
  fps: number;
  createdAt: number;
  updatedAt: number;
}

let counter = 0;
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clampSize(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_CANVAS_SIZE, Math.max(1, Math.round(n)));
}

export interface NewProjectOptions {
  name?: string;
  width: number;
  height: number;
  /** 'transparent', or a packed RGBA color filled into the first layer. */
  background?: 'transparent' | number;
}

export function createLayer(name: string): LayerMeta {
  return { id: uid('layer'), name, visible: true, locked: false, opacity: 1, blendMode: 'normal', isReference: false, alphaLock: false };
}

export function createProject(opts: NewProjectOptions): Project {
  const width = clampSize(opts.width);
  const height = clampSize(opts.height);
  const layer = createLayer('Layer 1');
  const cel = createCel(width, height);
  if (typeof opts.background === 'number') cel.fill(opts.background);
  const now = Date.now();
  return {
    id: uid('proj'),
    name: opts.name ?? 'Untitled',
    width,
    height,
    frames: [{ id: uid('frame'), cels: new Map([[layer.id, cel]]) }],
    layers: [layer],
    palette: { name: 'Default', colors: [] },
    tags: [],
    fps: 10,
    createdAt: now,
    updatedAt: now,
  };
}

export const WHITE = packRGBA(255, 255, 255);

export function getCel(project: Project, frameId: string, layerId: string): Uint32Array | undefined {
  return project.frames.find((f) => f.id === frameId)?.cels.get(layerId);
}
