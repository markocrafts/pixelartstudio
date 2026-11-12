import { encodeGif, type GifJob } from './gif';

interface WorkerScope {
  onmessage: ((e: MessageEvent<GifJob>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e) => {
  try {
    const bytes = encodeGif(e.data, (done, total) => ctx.postMessage({ type: 'progress', done, total }));
    ctx.postMessage({ type: 'done', bytes }, [bytes.buffer]);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'GIF encoding failed' });
  }
};
