import { hsvToRgb, rgbToHsv } from '../core/color';
import { packRGBA, unpackRGBA } from '../core/pixels';
import { colorToHex, parseHexColor } from '../core/palette';

export interface PickerHandle {
  close(): void;
  /** Updates the picker when the color changed elsewhere (e.g. eyedropper). */
  setColor(c: number): void;
  readonly anchor: HTMLElement;
}

const SV_W = 190;
const SV_H = 140;

/** Popover with an HSV square, hue and alpha sliders, and RGB / HSV / hex inputs. */
export function openColorPicker(anchor: HTMLElement, initial: number, onChange: (c: number) => void): PickerHandle {
  const [r0, g0, b0, a0] = unpackRGBA(initial);
  let [h, s, v] = rgbToHsv(r0, g0, b0);
  let a = a0;

  const pop = document.createElement('div');
  pop.className = 'picker';
  pop.innerHTML = `
    <canvas class="sv" width="${SV_W}" height="${SV_H}"></canvas>
    <label class="srow">Hue <input type="range" class="hue" min="0" max="359" step="1"></label>
    <label class="srow">Alpha <input type="range" class="alpha" min="0" max="255" step="1"></label>
    <div class="fields">
      <label>Hex <input type="text" class="hex" maxlength="9" spellcheck="false"></label>
      <label>R <input type="number" class="r" min="0" max="255"></label>
      <label>G <input type="number" class="g" min="0" max="255"></label>
      <label>B <input type="number" class="b" min="0" max="255"></label>
      <label>H <input type="number" class="hh" min="0" max="359"></label>
      <label>S <input type="number" class="ss" min="0" max="100"></label>
      <label>V <input type="number" class="vv" min="0" max="100"></label>
    </div>`;
  const q = <T extends HTMLElement>(sel: string): T => pop.querySelector<T>(sel)!;
  const sv = q<HTMLCanvasElement>('.sv');
  const ctx = sv.getContext('2d')!;
  const hue = q<HTMLInputElement>('.hue');
  const alpha = q<HTMLInputElement>('.alpha');
  const hex = q<HTMLInputElement>('.hex');
  const nums = { r: q<HTMLInputElement>('.r'), g: q<HTMLInputElement>('.g'), b: q<HTMLInputElement>('.b'), hh: q<HTMLInputElement>('.hh'), ss: q<HTMLInputElement>('.ss'), vv: q<HTMLInputElement>('.vv') };

  const rgb = (): [number, number, number] => hsvToRgb(h, s, v);
  const packed = (): number => packRGBA(...rgb(), a);

  const drawSV = (): void => {
    const [hr, hg, hb] = hsvToRgb(h, 1, 1);
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const white = ctx.createLinearGradient(0, 0, SV_W, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const black = ctx.createLinearGradient(0, 0, 0, SV_H);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, '#000');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const x = s * SV_W, y = (1 - v) * SV_H;
    ctx.lineWidth = 2;
    ctx.strokeStyle = v > 0.5 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
  };

  /** Writes the state into every control except the one being typed in. */
  const refresh = (skip?: HTMLElement): void => {
    const [r, g, b] = rgb();
    drawSV();
    const set = (el: HTMLInputElement, val: string): void => { if (el !== skip && el.value !== val) el.value = val; };
    set(hue, String(Math.round(h) % 360));
    set(alpha, String(a));
    set(hex, colorToHex(packed()));
    set(nums.r, String(r)); set(nums.g, String(g)); set(nums.b, String(b));
    set(nums.hh, String(Math.round(h) % 360)); set(nums.ss, String(Math.round(s * 100))); set(nums.vv, String(Math.round(v * 100)));
    alpha.style.setProperty('--c', `rgb(${r},${g},${b})`);
    hue.style.setProperty('--c', `hsl(${h},100%,50%)`);
  };
  const emit = (skip?: HTMLElement): void => { refresh(skip); onChange(packed()); };
  const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

  let dragging = false;
  const svAt = (e: PointerEvent): void => {
    const rect = sv.getBoundingClientRect();
    s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    v = 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1);
    emit();
  };
  sv.addEventListener('pointerdown', (e) => { dragging = true; sv.setPointerCapture(e.pointerId); svAt(e); });
  sv.addEventListener('pointermove', (e) => { if (dragging) svAt(e); });
  sv.addEventListener('pointerup', () => { dragging = false; });
  hue.addEventListener('input', () => { h = Number(hue.value); emit(hue); });
  alpha.addEventListener('input', () => { a = Number(alpha.value); emit(alpha); });
  hex.addEventListener('input', () => {
    const c = parseHexColor(hex.value);
    if (c === null) return;
    const [r, g, b, al] = unpackRGBA(c);
    [h, s, v] = rgbToHsv(r, g, b);
    a = al;
    emit(hex);
  });
  for (const k of ['r', 'g', 'b'] as const) {
    nums[k].addEventListener('input', () => {
      const cur = rgb();
      cur[k === 'r' ? 0 : k === 'g' ? 1 : 2] = clamp(Math.round(Number(nums[k].value)), 0, 255);
      [h, s, v] = rgbToHsv(...cur);
      emit(nums[k]);
    });
  }
  nums.hh.addEventListener('input', () => { h = clamp(Number(nums.hh.value), 0, 359); emit(nums.hh); });
  nums.ss.addEventListener('input', () => { s = clamp(Number(nums.ss.value), 0, 100) / 100; emit(nums.ss); });
  nums.vv.addEventListener('input', () => { v = clamp(Number(nums.vv.value), 0, 100) / 100; emit(nums.vv); });

  document.body.appendChild(pop);
  const place = (): void => {
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(window.innerWidth - pw - 4, r.left))}px`;
    pop.style.top = `${Math.max(4, Math.min(window.innerHeight - ph - 4, r.bottom + 6))}px`;
  };
  refresh();
  place();

  const onDown = (e: PointerEvent): void => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  function close(): void {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    pop.remove();
  }

  return {
    close,
    anchor,
    setColor(c: number): void {
      if (c === packed()) return;
      const [r, g, b, al] = unpackRGBA(c);
      // Keep hue/saturation for grays so the square does not jump while picking near-gray colors.
      const hsv = rgbToHsv(r, g, b);
      if (hsv[1] > 0) h = hsv[0];
      if (hsv[2] > 0) s = hsv[1];
      v = hsv[2];
      a = al;
      refresh();
    },
  };
}
