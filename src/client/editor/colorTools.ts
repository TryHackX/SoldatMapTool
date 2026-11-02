import { RgbaColor } from '@shared/soldatConstants';

/** Hue 0–360, saturation and value 0–1 */
export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

/** Relative change applied to every selected colour (keeps the differences between them) */
export interface ColorAdjust {
  hueShift?: number; // degrees, -180..180
  saturation?: number; // -1..1 (added to S)
  brightness?: number; // -1..1 (added to V)
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function rgbToHex(c: Pick<RgbaColor, 'r' | 'g' | 'b'>): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Parses #rgb / #rrggbb (with or without #); null when the text is not a colour */
export function parseHexColor(text: string): { r: number; g: number; b: number } | null {
  let hex = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.replace(/./g, (ch) => ch + ch);
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function hexToRgb(hex: string, alpha = 255): RgbaColor {
  const c = parseHexColor(hex) ?? { r: 255, g: 255, b: 255 };
  return { ...c, a: clampByte(alpha) };
}

export function rgbToHsv(c: Pick<RgbaColor, 'r' | 'g' | 'b'>): HsvColor {
  const r = clampByte(c.r) / 255;
  const g = clampByte(c.g) / 255;
  const b = clampByte(c.b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max > 1e-9 ? d / max : 0, v: max };
}

export function hsvToRgb(hsv: HsvColor, alpha = 255): RgbaColor {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp01(hsv.s);
  const v = clamp01(hsv.v);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255), a: clampByte(alpha) };
}

export function adjustColor(c: RgbaColor, adjust: ColorAdjust): RgbaColor {
  const hsv = rgbToHsv(c);
  return hsvToRgb(
    {
      h: hsv.h + (adjust.hueShift ?? 0),
      s: hsv.s + (adjust.saturation ?? 0),
      v: hsv.v + (adjust.brightness ?? 0),
    },
    c.a
  );
}

export function lerpColor(a: RgbaColor, b: RgbaColor, t: number): RgbaColor {
  const k = clamp01(t);
  return {
    r: clampByte(a.r + (b.r - a.r) * k),
    g: clampByte(a.g + (b.g - a.g) * k),
    b: clampByte(a.b + (b.b - a.b) * k),
    a: clampByte(a.a + (b.a - a.a) * k),
  };
}

/** Small deterministic PRNG (mulberry32): the same seed gives the same "random" variation */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random value in [-1, 1] */
export function signedRandom(rng: () => number): number {
  return rng() * 2 - 1;
}
