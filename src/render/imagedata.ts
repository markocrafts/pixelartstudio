/** Wraps a packed-RGBA cel as ImageData without copying. Assumes a little-endian platform (all browsers we target). */
export function celToImageData(cel: Uint32Array, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(cel.buffer as ArrayBuffer, cel.byteOffset, cel.length * 4), w, h);
}
