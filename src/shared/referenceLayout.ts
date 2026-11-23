import type { PmsMapData, PmsVertex } from './pmsParser';
import { polygonSignedArea2, rebuildPolygonGeometry } from './pmsCompiler';
import { across, measureStyleStrips, registerBoundary, type Axis } from './styleSections';
type Point = {
  x: number;
  y: number;
};
// Fit a continuous deformation to measured cross-sections. Shared polygon vertices, objects,
// flags and waypoints all use the same field; sparse or nearly flat triangles bound its strength.
export function reshapeReferenceLayout(maps: PmsMapData[], variation: number, rand: () => number, tint: (v: PmsVertex, kind: number) => PmsVertex['color']) {
  const base = maps[0], bounds = base.polyBounds, axis: Axis = bounds.width >= bounds.height ? 'x' : 'y', cross = across(axis);
  const strips = maps.map((m, i) => measureStyleStrips(m, i, axis, 8));
  const main = strips[0], length = main.at(-1)!.to - main[0].from, crossSize = main[0].crossSize;
  const counts = maps.map(() => 0);
  const nodes = main.map((s, i) => {
    const source = i % maps.length, donor = strips[source][Math.floor(rand() * strips[source].length)];
    counts[source]++;
    const edges = donor.middle.edges, anchor = s.middle.edges;
    const middle = (a: number[]) => a.length ? a.reduce((sum, v) => sum + v, 0) / a.length : 0.5;
    const shift = Math.max(-0.14, Math.min(0.14, middle(edges) - middle(anchor))) * crossSize;
    return { at: (s.from + s.to) / 2, warp: registerBoundary(s.middle, donor.middle), shift: shift + (rand() - 0.5) * Math.min(32, crossSize * 0.08),
      width: ((donor.to - donor.from) / (strips[source].at(-1)!.to - strips[source][0].from) - 1 / 8) * length + (rand() - 0.5) * length * 0.035 };
  });
  const strength = 0.16 + variation / 100 * 0.72;
  function project(p: Point, amplitude: number): Point {
    const a = p[axis], v = (p[cross] - main[0].crossStart) / crossSize;
    let i = 0;
    while (i < nodes.length - 2 && nodes[i + 1].at < a)
      i++;
    const first = nodes[i], next = nodes[i + 1], k = Math.max(0, Math.min(1, (a - first.at) / (next.at - first.at)));
    const smooth = k * k * (3 - 2 * k);
    const along = a + (first.width * (1 - smooth) + next.width * smooth) * strength * amplitude * 0.65;
    const delta = (n: typeof first) => (n.warp(v) - v) * crossSize + n.shift * 0.45;
    const lateral = p[cross] + (delta(first) * (1 - smooth) + delta(next) * smooth) * strength * amplitude;
    return axis === 'x' ? { x: along, y: lateral } : { x: lateral, y: along };
  }
  let amplitude = 1;
  while (amplitude > 1 / 256 && base.polygons.some(p => {
    const area = polygonSignedArea2(...p.vertices);
    const next = polygonSignedArea2(project(p.vertices[0], amplitude), project(p.vertices[1], amplitude), project(p.vertices[2], amplitude));
    return Math.abs(area) > 0.01 && next / area < 0.2;
  }))
    amplitude /= 2;
  const point = (p: Point) => project(p, amplitude);
  const integer = (p: Point) => { const { x, y } = point(p); return { x: Math.round(x), y: Math.round(y) }; };
  const polygons = base.polygons.map(p => {
    const vertex = (v: PmsVertex) => ({ ...v, ...point(v), color: tint(v, p.polyType) });
    return rebuildPolygonGeometry({ ...p, vertices: [vertex(p.vertices[0]), vertex(p.vertices[1]), vertex(p.vertices[2])] });
  });
  return { geometry: { polygons, props: base.props.map(p => ({ ...p, ...point(p), raw: undefined })),
      scenery: base.scenery.map(d => ({ ...d, raw: undefined })), colliders: base.colliders.map(c => ({ ...c, ...point(c), raw: undefined })),
      spawnpoints: base.spawnpoints.map(s => ({ ...s, ...integer(s), raw: undefined })),
      waypoints: base.waypoints.map(w => ({ ...w, ...integer(w), connections: [...w.connections], raw: undefined })) },
    report: { sections: main.length, fromSources: counts, recombined: 0 } };
}
