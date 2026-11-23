import { computePolygonNormals, polygonSignedArea2 } from './pmsCompiler';
import type { PmsPolygon, PmsVertex } from './pmsParser';
import { across, type Axis } from './styleSections';
import { doesPolyCollideSoldier } from './soldatConstants';
export interface SeamFace {
  low: PmsVertex;
  high: PmsVertex;
  kind: number;
  bounce: number;
}
export function collectSeam(faces: SeamFace[], vertices: PmsVertex[], axis: Axis, at: number, poly: PmsPolygon) {
  const cross = across(axis);
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (Math.abs(a[axis] - at) > 0.0001 || Math.abs(b[axis] - at) > 0.0001 || Math.abs(a[cross] - b[cross]) < 0.01)
      continue;
    faces.push({ low: a[cross] < b[cross] ? a : b, high: a[cross] < b[cross] ? b : a, kind: poly.polyType, bounce: poly.bounciness });
  }
}
function midpoint(a: PmsVertex, b: PmsVertex): PmsVertex {
  const alpha = a.color.a + b.color.a;
  const channel = (key:'r'|'g'|'b') => alpha ? Math.round((a.color[key]*a.color.a+b.color[key]*b.color.a)/alpha) : 0;
  return { ...a, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, u: (a.u + b.u) / 2, v: (a.v + b.v) / 2,
    color: { r:channel('r'),g:channel('g'),b:channel('b'),a:Math.round(alpha/2) } };
}
// Meet matching rock bands halfway. A ledge present on only one side tapers into the join.
export function joinStyleSeam(left: SeamFace[], right: SeamFace[], axis: Axis, at: number, otherAt: number) {
  const polys: PmsPolygon[] = [], cross = across(axis), mid = (at + otherAt) / 2;
  function merge(faces: SeamFace[]) {
    const out: SeamFace[] = [];
    for (const f of [...faces].sort((a, b) => a.kind - b.kind || a.low[cross] - b.low[cross])) {
      const tail = out.at(-1);
      if (tail && tail.kind === f.kind && Math.abs(tail.bounce - f.bounce) < 0.05 && f.low[cross] <= tail.high[cross] + 0.05) {
        if (f.high[cross] > tail.high[cross])
          tail.high = f.high;
      }
      else
        out.push({ ...f });
    }
    return out.sort((a, b) => a.low[cross] - b.low[cross]);
  }
  function tri(a: PmsVertex, b: PmsVertex, c: PmsVertex, f: SeamFace) {
    const area = polygonSignedArea2(a, b, c);
    if (Math.abs(area) < 0.015)
      return;
    const vertices: PmsPolygon['vertices'] = area > 0 ? [a, b, c] : [a, c, b];
    const geometry = { vertices, polyType: f.kind, bounciness: f.bounce };
    polys.push({ ...geometry, ...computePolygonNormals(geometry) });
  }
  function taper(f: SeamFace) {
    const tip = { ...midpoint(f.low, f.high), [axis]: mid };
    tri(f.low, f.high, tip, f);
  }
  const targets = merge(right), used = new Set<number>();
  for (const a of merge(left)) {
    const centerA = (a.low[cross] + a.high[cross]) / 2;
    let score = Infinity, match = -1;
    for (let i = 0; i < targets.length; i++) {
      if (used.has(i))
        continue;
      const b = targets[i];
      if (doesPolyCollideSoldier(a.kind, 1, false) !== doesPolyCollideSoldier(b.kind, 1, false))
        continue;
      const freeGap = Math.max(0, a.low[cross] - b.high[cross], b.low[cross] - a.high[cross]);
      if (freeGap > Math.abs(at - otherAt) * 0.85)
        continue;
      const cost = freeGap + Math.abs(centerA - (b.low[cross] + b.high[cross]) / 2) * 0.4 + (a.kind === b.kind ? 0 : 20);
      if (cost < score) {
        score = cost;
        match = i;
      }
    }
    if (match < 0) {
      taper(a);
      continue;
    }
    used.add(match);
    const target = targets[match], du = Math.round(a.low.u - target.low.u), dv = Math.round(a.low.v - target.low.v);
    const align = (v: PmsVertex) => ({ ...v, u: v.u + du, v: v.v + dv });
    const b = { ...target, low: align(target.low), high: align(target.high) }, low = midpoint(a.low, b.low), high = midpoint(a.high, b.high);
    tri(a.low, a.high, low, a);
    tri(low, a.high, high, a);
    tri(low, high, b.low, b);
    tri(b.low, high, b.high, b);
  }
  targets.forEach((b, i) => { if (!used.has(i))
    taper(b); });
  return polys;
}
