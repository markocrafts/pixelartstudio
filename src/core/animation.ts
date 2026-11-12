import type { FrameTag, Project, TagDirection } from './project';

export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MIN_DURATION_MS = 10;
export const MAX_DURATION_MS = 60_000;

export function clampFps(n: number): number {
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(Number.isFinite(n) ? n : 10)));
}

/** Duration of a frame in ms: its own override, or 1000 / project fps. */
export function frameDuration(project: Pick<Project, 'fps'>, frame: { durationMs?: number }): number {
  return frame.durationMs ?? Math.round(1000 / project.fps);
}

/**
 * Order in which frames play for an inclusive range. Ping-pong goes up then back down without repeating
 * the end frames, so one cycle of [0..3] is 0,1,2,3,2,1.
 */
export function playbackSequence(from: number, to: number, direction: TagDirection): number[] {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const fwd: number[] = [];
  for (let i = lo; i <= hi; i++) fwd.push(i);
  if (direction === 'forward') return fwd;
  if (direction === 'reverse') return fwd.reverse();
  if (fwd.length <= 2) return fwd;
  return [...fwd, ...fwd.slice(1, -1).reverse()];
}

/** Tags after inserting `count` frames at index `at` (frames at >= at move right; tags spanning `at` grow). */
export function tagsAfterInsert(tags: ReadonlyArray<FrameTag>, at: number, count: number): FrameTag[] {
  return tags.map((t) => {
    const from = t.from >= at ? t.from + count : t.from;
    const to = t.to >= at ? t.to + count : t.to;
    return { ...t, from, to };
  });
}

/** Tags after deleting frames [at, at+count). A tag shrinks to its surviving frames and is dropped when none remain. */
export function tagsAfterDelete(tags: ReadonlyArray<FrameTag>, at: number, count: number): FrameTag[] {
  const end = at + count - 1;
  const survivors = (t: FrameTag): number[] => {
    const out: number[] = [];
    for (let i = t.from; i <= t.to; i++) if (i < at || i > end) out.push(i < at ? i : i - count);
    return out;
  };
  const out: FrameTag[] = [];
  for (const t of tags) {
    const s = survivors(t);
    if (s.length) out.push({ ...t, from: s[0]!, to: s[s.length - 1]! });
  }
  return out;
}
