import { doesPolyCollideSoldier } from './soldatConstants';
import type { PmsMapData, PmsVertex } from './pmsParser';
export type Axis = 'x' | 'y';
type Point = {
  x: number;
  y: number;
};
type Span = [
  number,
  number
];
export interface CrossSection {
  edges: number[];
  mask: Uint8Array;
  visible: Uint8Array;
}
export interface StyleStrip {
  source: number;
  index: number;
  from: number;
  to: number;
  crossStart: number;
  crossSize: number;
  entrance: CrossSection;
  middle: CrossSection;
  exit: CrossSection;
  polygons: number[];
}
export const across = (axis: Axis): Axis => axis === 'x' ? 'y' : 'x';
const bins = 96;
function profile(map: PmsMapData, axis: Axis, at: number, crossStart: number, extent: number): CrossSection {
  const spans: Span[] = [];
  const visible = new Uint8Array(bins);
  const cross = across(axis);
  for (const poly of map.polygons) {
    const intersections: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = poly.vertices[i], b = poly.vertices[(i + 1) % 3];
      if ((a[axis] > at) === (b[axis] > at))
        continue;
      const fraction = (at - a[axis]) / (b[axis] - a[axis]);
      intersections.push((a[cross] + fraction * (b[cross] - a[cross]) - crossStart) / extent);
    }
    if (intersections.length === 2) {
      const lo = Math.min(...intersections), hi = Math.max(...intersections);
      if (poly.vertices.some(v => v.color.a > 15))
        visible.fill(1, Math.max(0, Math.floor(lo * bins)), Math.min(bins, Math.ceil(hi * bins)));
      if (doesPolyCollideSoldier(poly.polyType, 1, false))
        spans.push([lo, hi]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1] + 1e-6)
      last[1] = Math.max(last[1], span[1]);
    else
      merged.push(span);
  }
  const mask = new Uint8Array(bins);
  for (const [start, end] of merged)
    mask.fill(1, Math.max(0, Math.min(bins - 1, Math.floor(start * bins))), Math.min(bins, Math.ceil(end * bins)));
  return { edges: merged.flat(), mask, visible };
}
export function measureStyleStrips(map: PmsMapData, source: number, axis: Axis, count: number): StyleStrip[] {
  const b = map.polyBounds;
  const [start, size, crossStart, crossSize] = axis === 'x' ? [b.left, b.width, b.top, b.height] : [b.top, b.height, b.left, b.width];
  if (!map.polygons.length || ![start, size, crossStart, crossSize].every(Number.isFinite) || size < 8 || crossSize < 3)
    throw new Error('A reference has no measurable terrain.');
  const spans = map.polygons.map(poly => {
    const v = poly.vertices.map(p => p[axis]);
    return [Math.min(...v), Math.max(...v)];
  });
  const markers = map.spawnpoints.filter(p => p.active && p.team <= 6);
  const cuts = Array.from({ length: count + 1 }, (_, i) => {
    const nominal = start + i * size / count;
    if (i === 0 || i === count)
      return nominal;
    // Prefer a cut through few triangles, away from starts and flags.
    let best = nominal, cost = Infinity;
    for (const shift of [0, -0.11, 0.11, -0.22, 0.22]) {
      const at = nominal + shift * size / count;
      const intersections = spans.reduce((n, [a, b]) => n + Number(a < at && b > at), 0);
      const score = intersections + Math.abs(shift) * 3 + markers.reduce((n, p) => n + Math.max(0, 28 - Math.abs(p[axis] - at)), 0);
      if (score < cost) {
        cost = score;
        best = at;
      }
    }
    return best;
  });
  return cuts.slice(0, -1).map((from, index) => {
    const to = cuts[index + 1], epsilon = Math.min(0.001, (to - from) * 0.00001);
    return { source, index, from, to, crossStart, crossSize, entrance: profile(map, axis, from + epsilon, crossStart, crossSize),
      middle: profile(map, axis, (from + to) / 2, crossStart, crossSize),
      exit: profile(map, axis, to - epsilon, crossStart, crossSize), polygons: spans.flatMap(([a, b], i) => a < to && b > from ? [i] : []) };
  });
}
export function boundaryDistance(a: CrossSection, b: CrossSection) {
  let difference = 0;
  for (let i = 0; i < bins; i++)
    difference += Math.abs(a.mask[i] - b.mask[i]) + 0.65 * Math.abs(a.visible[i] - b.visible[i]);
  return difference / bins + Math.min(8, Math.abs(a.edges.length - b.edges.length)) * 0.024;
}
/** Register nearby floors with floors and ceilings with ceilings, preserving their order. */
export function registerBoundary(source: CrossSection, target: CrossSection) {
  const knots: Span[] = [[0, 0]];
  let cursor = 0;
  for (let i = 0; i < source.edges.length; i++) {
    const from = source.edges[i], previous = knots[knots.length - 1];
    if (from <= previous[0] + 0.002 || from >= 0.998)
      continue;
    let best = -1, distance = 0.095;
    for (let j = cursor; j < target.edges.length; j++) {
      const to = target.edges[j];
      if (to > from + distance)
        break;
      if (j % 2 !== i % 2 || to <= previous[1] + 0.002 || to >= 0.998)
        continue;
      const d = Math.abs(to - from);
      if (d < distance) {
        best = j;
        distance = d;
      }
    }
    if (best >= 0) {
      knots.push([from, target.edges[best]]);
      cursor = best + 1;
    }
  }
  knots.push([1, 1]);
  return (value: number) => {
    if (value <= 0 || value >= 1)
      return value;
    let lo = 0, hi = knots.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (knots[mid][0] <= value)
        lo = mid;
      else
        hi = mid;
    }
    const a = knots[lo], b = knots[hi];
    return a[1] + (value - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
  };
}
function cutVertices(vertices: PmsVertex[], axis: Axis, limit: number, lower: boolean) {
  const result: PmsVertex[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const inside = lower ? a[axis] >= limit : a[axis] <= limit;
    if (inside)
      result.push(a);
    if ((a[axis] < limit && b[axis] > limit) || (a[axis] > limit && b[axis] < limit)) {
      const k = (limit - a[axis]) / (b[axis] - a[axis]);
      const mix = (v: number, w: number) => v + (w - v) * k;
      result.push({ x: mix(a.x, b.x), y: mix(a.y, b.y), [axis]: limit, z: mix(a.z, b.z), rhw: mix(a.rhw, b.rhw),
        u: mix(a.u, b.u), v: mix(a.v, b.v), color: { r: Math.round(mix(a.color.r, b.color.r)), g: Math.round(mix(a.color.g, b.color.g)),
          b: Math.round(mix(a.color.b, b.color.b)), a: Math.round(mix(a.color.a, b.color.a)) } });
    }
  }
  return result;
}
export function clipStrip(vertices: PmsVertex[], axis: Axis, strip: StyleStrip) {
  return cutVertices(cutVertices(vertices, axis, strip.from, true), axis, strip.to, false);
}
export function ownsPoint(point: Point, axis: Axis, strip: StyleStrip, count: number) {
  return (strip.index === 0 || point[axis] >= strip.from) && (strip.index === count - 1 || point[axis] < strip.to);
}
