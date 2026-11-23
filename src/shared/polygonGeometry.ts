/**
 * Twice the signed area of triangle (v0, v1, v2) in Soldat's Y-down world space (+X right, +Y down).
 * Positive (> 0) means Clockwise (CW), which is what Soldat / OpenSoldat expects for valid collision normals.
 */
export function polygonSignedArea2(
  v0: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number }
): number {
  return (v1.x - v0.x) * (v2.y - v0.y) - (v1.y - v0.y) * (v2.x - v0.x);
}

export function pointInTriInclusive(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): boolean {
  const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
  const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function orient2d(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number
): boolean {
  return (
    px >= Math.min(ax, bx) - 1e-6 &&
    px <= Math.max(ax, bx) + 1e-6 &&
    py >= Math.min(ay, by) - 1e-6 &&
    py <= Math.max(ay, by) + 1e-6
  );
}

export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const o1 = orient2d(ax, ay, bx, by, cx, cy);
  const o2 = orient2d(ax, ay, bx, by, dx, dy);
  const o3 = orient2d(cx, cy, dx, dy, ax, ay);
  const o4 = orient2d(cx, cy, dx, dy, bx, by);

  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  if (Math.abs(o1) <= 1e-6 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(o2) <= 1e-6 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (Math.abs(o3) <= 1e-6 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(o4) <= 1e-6 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

/**
 * Triangulates a simple closed 2D polygon into Clockwise (CW) triangles in Soldat Y-down space.
 * Returns clockwise point triples. A crossing or degenerate outline returns an empty mesh.
 */
export function earClipTriangulate(points: ReadonlyArray<{ x: number; y: number }>): Array<[
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
]> {
  // 1. Remove consecutive duplicate points
  const ring: Array<{ x: number; y: number }> = [];
  for (const pt of points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    const prev = ring[ring.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.05) {
      ring.push({ x: pt.x, y: pt.y });
    }
  }
  if (ring.length >= 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.05) {
      ring.pop();
    }
  }
  if (ring.length < 3) return [];
  // A crossing or touching outline has ambiguous solid space. Never fill its convex hull.
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      const c = ring[j], d = ring[(j + 1) % ring.length];
      if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return [];
    }
  }
  if (Math.abs(area) < 1e-5) return [];
  if (area < 0) ring.reverse();

  const indices = ring.map((_, i) => i);
  const uses = ring.map(() => 0);
  type Point = typeof ring[number];
  const triangles: Array<[Point, Point, Point]> = [];
  while (indices.length > 3) {
    const candidates = indices.map((curr, i) => {
      const prev = indices[(i + indices.length - 1) % indices.length];
      const next = indices[(i + 1) % indices.length];
      const a = ring[prev], b = ring[curr], c = ring[next];
      const cross = polygonSignedArea2(a, b, c);
      const diagonal2 = (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
      // Prefer compact triangles and distribute internal edges across different corners.
      const score = cross / ((1 + diagonal2) * (1 + uses[prev] + uses[next]));
      return { i, prev, curr, next, cross, score };
    }).filter(ear => ear.cross > 1e-5).sort((a, b) => b.score - a.score);

    const ear = candidates.find(({ prev, curr, next }) => !indices.some(index => {
      if (index === prev || index === curr || index === next) return false;
      const p = ring[index];
      return pointInTriInclusive(p.x, p.y, ring[prev], ring[curr], ring[next]);
    }));
    if (!ear) return [];
    triangles.push([ring[ear.prev], ring[ear.curr], ring[ear.next]]);
    uses[ear.prev]++;
    uses[ear.next]++;
    indices.splice(ear.i, 1);
  }
  const [a, b, c] = indices.map(index => ring[index]);
  if (polygonSignedArea2(a, b, c) <= 1e-5) return [];
  triangles.push([a, b, c]);

  return triangles;
}
