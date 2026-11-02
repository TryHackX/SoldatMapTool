import { ensureSceneryEntry } from '@shared/pmsCompiler';
import { isPropRenderable, PmsMapData, PmsProp } from '@shared/pmsParser';
import { RgbaColor } from '@shared/soldatConstants';
import { adjustColor, ColorAdjust, lerpColor, mulberry32, signedRandom } from './colorTools';
import { computePropQuadCenter } from './EditorDocument';

/**
 * Pure scenery (prop) operations used by the inspector, the command palette and the shortcuts.
 * Each returns a new map; props outside `indices` keep their object identity (and file record).
 */

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const MIN_SCALE = 0.02;
const MAX_SCALE = 64;

function withoutRaw(p: PmsProp): PmsProp {
  const { raw: _raw, ...rest } = p;
  return rest;
}

/** Applies `fn` to every selected prop; `order` is the position inside `indices` */
export function mapSelectedProps(
  map: PmsMapData,
  indices: ReadonlyArray<number>,
  fn: (p: PmsProp, order: number) => PmsProp
): PmsMapData {
  let next: PmsProp[] | null = null;
  indices.forEach((idx, order) => {
    const p = map.props[idx];
    if (!p) return;
    const updated = fn(p, order);
    if (updated === p) return;
    next ??= [...map.props];
    next[idx] = updated;
  });
  return next ? { ...map, props: next } : map;
}

/** Moves `next` so its visual quad centre matches the one of `prev` (scale / rotate / flip around the centre) */
export function keepPropCenter(prev: PmsProp, next: PmsProp): PmsProp {
  const a = computePropQuadCenter(prev);
  const b = computePropQuadCenter(next);
  return { ...next, x: next.x + (a.x - b.x), y: next.y + (a.y - b.y) };
}

export function setPropsTint(map: PmsMapData, indices: ReadonlyArray<number>, color: RgbaColor): PmsMapData {
  const r = clampByte(color.r);
  const g = clampByte(color.g);
  const b = clampByte(color.b);
  return mapSelectedProps(map, indices, (p) =>
    p.color.r === r && p.color.g === g && p.color.b === b ? p : { ...withoutRaw(p), color: { ...p.color, r, g, b } }
  );
}

export function adjustPropsTint(map: PmsMapData, indices: ReadonlyArray<number>, adjust: ColorAdjust): PmsMapData {
  return mapSelectedProps(map, indices, (p) => ({ ...withoutRaw(p), color: { ...adjustColor(p.color, adjust), a: p.color.a } }));
}

export function setPropsAlpha(map: PmsMapData, indices: ReadonlyArray<number>, alpha: number): PmsMapData {
  const a = clampByte(alpha);
  return mapSelectedProps(map, indices, (p) => (p.alpha === a ? p : { ...withoutRaw(p), alpha: a }));
}

export type PropGradientAxis = 'x' | 'y' | 'radial';

export interface PropGradientOptions {
  axis: PropGradientAxis;
  from: RgbaColor; // tint at the start (left / top / centre)
  to: RgbaColor; // tint at the end (right / bottom / outside)
  tint: boolean; // apply the colour gradient
  alphaFrom?: number; // optional opacity gradient
  alphaTo?: number;
}

/**
 * Colour and / or opacity gradient across the selected props, ordered by their centre along the axis.
 * Good for depth fog, light falloff or fading a row of clouds.
 */
export function gradientProps(map: PmsMapData, indices: ReadonlyArray<number>, opts: PropGradientOptions): PmsMapData {
  const valid = indices.filter((i) => map.props[i]);
  if (valid.length === 0) return map;
  const centers = new Map(valid.map((i) => [i, computePropQuadCenter(map.props[i])]));
  let cx = 0;
  let cy = 0;
  for (const c of centers.values()) {
    cx += c.x;
    cy += c.y;
  }
  cx /= valid.length;
  cy /= valid.length;
  const keyOf = (i: number) => {
    const c = centers.get(i)!;
    if (opts.axis === 'x') return c.x;
    if (opts.axis === 'y') return c.y;
    return Math.hypot(c.x - cx, c.y - cy);
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of valid) {
    const k = keyOf(i);
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  const span = hi - lo;
  const withAlpha = opts.alphaFrom !== undefined && opts.alphaTo !== undefined;
  return mapSelectedProps(map, valid, (p, order) => {
    const t = span > 1e-6 ? (keyOf(valid[order]) - lo) / span : 0;
    const next = { ...withoutRaw(p) };
    if (opts.tint) {
      const c = lerpColor(opts.from, opts.to, t);
      next.color = { ...p.color, r: c.r, g: c.g, b: c.b };
    }
    if (withAlpha) next.alpha = clampByte(opts.alphaFrom! + (opts.alphaTo! - opts.alphaFrom!) * t);
    return next;
  });
}

/** Multiplies (relative) or sets (absolute) the scale of each prop around its own centre, keeping flips */
export function scaleProps(
  map: PmsMapData,
  indices: ReadonlyArray<number>,
  sx: number,
  sy: number,
  mode: 'relative' | 'absolute' = 'relative'
): PmsMapData {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return map;
  const clampMag = (v: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));
  return mapSelectedProps(map, indices, (p) => {
    const signX = p.scaleX < 0 ? -1 : 1;
    const signY = p.scaleY < 0 ? -1 : 1;
    const magX = mode === 'relative' ? Math.abs(p.scaleX) * sx : sx;
    const magY = mode === 'relative' ? Math.abs(p.scaleY) * sy : sy;
    const scaled = { ...withoutRaw(p), scaleX: signX * clampMag(magX), scaleY: signY * clampMag(magY) };
    return keepPropCenter(p, scaled);
  });
}

/** Rotates each prop around its own centre (degrees, clockwise on screen) */
export function rotatePropsInPlace(map: PmsMapData, indices: ReadonlyArray<number>, deltaDeg: number): PmsMapData {
  if (!Number.isFinite(deltaDeg) || deltaDeg === 0) return map;
  const delta = (deltaDeg * Math.PI) / 180;
  // PMS rotation grows counter-clockwise on screen (Y points down), so a clockwise turn subtracts
  return mapSelectedProps(map, indices, (p) => keepPropCenter(p, { ...withoutRaw(p), rotation: p.rotation - delta }));
}

export function flipProps(map: PmsMapData, indices: ReadonlyArray<number>, axis: 'x' | 'y'): PmsMapData {
  return mapSelectedProps(map, indices, (p) =>
    keepPropCenter(p, axis === 'x' ? { ...withoutRaw(p), scaleX: -p.scaleX } : { ...withoutRaw(p), scaleY: -p.scaleY })
  );
}

export interface PropRandomizeOptions {
  seed: number;
  scale?: number; // ±fraction, e.g. 0.2 = ±20 %
  rotationDeg?: number; // ±degrees
  hue?: number; // ±degrees
  brightness?: number; // ±0..1
  alpha?: number; // ±0..255
  flipX?: boolean; // 50 % chance of a horizontal flip
}

/** Natural-looking variation for a group of identical props (trees, rocks, clouds) */
export function randomizeProps(map: PmsMapData, indices: ReadonlyArray<number>, opts: PropRandomizeOptions): PmsMapData {
  const rng = mulberry32(opts.seed);
  return mapSelectedProps(map, indices, (p) => {
    let next: PmsProp = { ...withoutRaw(p) };
    if (opts.scale) {
      const k = Math.max(0.05, 1 + signedRandom(rng) * opts.scale);
      next.scaleX = Math.sign(p.scaleX || 1) * Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.abs(p.scaleX) * k));
      next.scaleY = Math.sign(p.scaleY || 1) * Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.abs(p.scaleY) * k));
    }
    if (opts.rotationDeg) next.rotation = p.rotation - (signedRandom(rng) * opts.rotationDeg * Math.PI) / 180;
    if (opts.flipX && rng() < 0.5) next.scaleX = -next.scaleX;
    if (opts.hue || opts.brightness) {
      const c = adjustColor(p.color, {
        hueShift: opts.hue ? signedRandom(rng) * opts.hue : 0,
        brightness: opts.brightness ? signedRandom(rng) * opts.brightness : 0,
      });
      next.color = { ...p.color, r: c.r, g: c.g, b: c.b };
    }
    if (opts.alpha) next.alpha = clampByte(p.alpha + signedRandom(rng) * opts.alpha);
    next = keepPropCenter(p, next);
    return next;
  });
}

export interface DepthHazeOptions {
  color: RgbaColor;
  back: number; // 0..1 blend towards the haze colour for level 0
  middle: number; // level 1
  front: number; // level 2
}

/** Blends every prop's tint towards a haze colour by scenery level: distant (back) layers fade the most */
export function applyDepthHaze(map: PmsMapData, opts: DepthHazeOptions): PmsMapData {
  const strength = [opts.back, opts.middle, opts.front];
  const all = map.props.map((_, i) => i);
  return mapSelectedProps(map, all, (p) => {
    const k = strength[p.level] ?? 0;
    if (!(k > 0) || !isPropRenderable(p, map.scenery.length)) return p;
    const c = lerpColor(p.color, { ...opts.color, a: p.color.a }, k);
    return { ...withoutRaw(p), color: { ...p.color, r: c.r, g: c.g, b: c.b } };
  });
}

/** File name without extension, lower case: "Tree.BMP" and "tree.png" are the same scenery for the game */
export function sceneryStem(filename: string): string {
  return filename.trim().toLowerCase().replace(/\.[^./\\]+$/, '');
}

/**
 * Indices of all props drawing the given scenery file. Case-insensitive, and an image matches its .bmp / .png twin
 * (the game loads "x.png" for a map that names "x.bmp").
 */
export function propsUsingScenery(map: PmsMapData, filename: string): number[] {
  const stem = sceneryStem(filename);
  const styles = new Set<number>();
  map.scenery.forEach((s, i) => {
    if (sceneryStem(s.filename) === stem) styles.add(i + 1);
  });
  const out: number[] = [];
  map.props.forEach((p, i) => {
    if (styles.has(p.style)) out.push(i);
  });
  return out;
}

/** Swaps the image of the selected props (keeps position, size on screen is not adjusted) */
export function replacePropsScenery(map: PmsMapData, indices: ReadonlyArray<number>, filename: string): PmsMapData {
  const clean = filename.trim();
  if (!clean || indices.length === 0) return map;
  const ensured = ensureSceneryEntry(map.scenery, clean);
  const next = mapSelectedProps({ ...map, scenery: ensured.scenery }, indices, (p) =>
    p.style === ensured.style ? p : { ...withoutRaw(p), style: ensured.style }
  );
  return next.props === map.props ? map : next;
}

/** Usage count per scenery stem (see sceneryStem), for the asset browser badges */
export function sceneryUsageCounts(map: PmsMapData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of map.props) {
    if (!isPropRenderable(p, map.scenery.length)) continue;
    const key = sceneryStem(map.scenery[p.style - 1].filename);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
