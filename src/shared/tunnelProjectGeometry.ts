import type { TunnelPoint as Point } from './climbTunnel';
import { simplifyPolylineRdp } from './imageTracer';

// Gate vertices retain this knot's previous width and landing height during local rerolls.
export type KnotWeight = [knotIndex: number, bend: number, lift: number] |
  [knotIndex: number, bend: number, lift: number, fixedWidth: number, fixedHeight: number, fixedReach?: number];
export interface BoundVertex extends Point { weights: KnotWeight[] }

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const ease = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

function projection(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1);
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const t = Math.min(1, Math.max(0, projection(p, a, b)));
  return Math.hypot(p.x - a.x - (b.x - a.x) * t, p.y - a.y - (b.y - a.y) * t);
}

/** Preserve each drawn bend separately from the control mesh. Add handles to long straights. */
export function editKnots(source: readonly Point[], drawn: boolean): Point[] {
  const line = simplifyPolylineRdp(source, drawn ? 3 : 7);
  const sparse = [line[0]];
  for (const p of line.slice(1, -1)) {
    if (dist(p, sparse[sparse.length - 1]) >= 38 && dist(p, line[line.length - 1]) >= 32) sparse.push(p);
  }
  sparse.push(line[line.length - 1]);
  const out: Point[] = [{ ...sparse[0] }];
  for (let i = 1; i < sparse.length; i++) {
    const a = sparse[i - 1], b = sparse[i];
    const parts = Math.max(sparse.length === 2 ? 2 : 1, Math.ceil(dist(a, b) / 135));
    for (let k = 1; k <= parts; k++) {
      out.push({ x: a.x + (b.x - a.x) * k / parts, y: a.y + (b.y - a.y) * k / parts });
    }
  }
  return out;
}

/** A ledge belongs to its station along the axis even if a neighboring spiral pass is spatially close. */
export function nearestKnotAlongAxis(p: Point, knots: readonly Point[]) {
  let owner = 0, closest = Infinity;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i], distance = segmentDistance(p, a, b);
    if (distance >= closest) continue;
    closest = distance;
    owner = projection(p, a, b) < 0.5 ? i - 1 : i;
  }
  return owner;
}

export function nearestPoint(p: Point, points: readonly Point[]): number {
  let best = -1, closest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = (p.x - points[i].x) ** 2 + (p.y - points[i].y) ** 2;
    if (d < closest) { best = i; closest = d; }
  }
  return best;
}

/** Compact spatial weights are fixed when the mesh is created. This keeps repeated edits reversible,
 * welds coincident vertices from independent triangles, and leaves remote runs of a spiral stationary. */
export function bindPoint(p: Point, knots: readonly Point[], landings: readonly Point[], width: number): BoundVertex {
  const distances: number[] = [];
  let nearest = Infinity;
  for (let j = 0; j < knots.length - 1; j++) {
    const d = segmentDistance(p, knots[j], knots[j + 1]);
    distances.push(d);
    nearest = Math.min(nearest, d);
  }
  const weights: KnotWeight[] = [];
  for (let k = 1; k < knots.length - 1; k++) {
    const near = Math.min(distances[k - 1], distances[k]);
    if (near > nearest + width * 0.8 || near > width * 1.7) continue;
    const a = knots[k - 1], b = knots[k], c = knots[k + 1];
    const window = ease(projection(p, a, b)) * ease(1 - projection(p, b, c));
    if (window === 0) continue;
    // Fade out at the medial plane between separate passes. A sharp hand-drawn turn can have
    // a shared wall; exactly the same spatial weight must be used on both sides of that wall.
    let remote = Infinity;
    for (let j = 0; j < distances.length; j++) {
      if (j < k - 2 || j > k + 1) remote = Math.min(remote, distances[j]);
    }
    const separation = ease((remote - near) / Math.max(24, width * 0.38));
    const bend = window * separation * ease((width * 1.65 - near) / (width * 0.57));
    const landing = landings[k - 1];
    const radius = Math.max(38, Math.min(76, (dist(a, b) + dist(b, c)) * 0.35));
    const lift = window * separation * ease(1 - Math.hypot((p.x - landing.x) / radius, (p.y - landing.y) / 60));
    if (bend > 0 || lift > 0) weights.push([k, bend, lift]);
  }
  return { x: p.x, y: p.y, weights };
}

export interface SectionProperties { landingHeight: number; bounce: number | null; widthOffset?: number; landingReach?: number }

interface EdgeConstraint { tip: number; a: number; b: number; fraction: number }
const meshBindings = new WeakMap<readonly BoundVertex[], {edges: EdgeConstraint[]; corrections: Map<number, Map<number, Point>>}>();

const widthDirections = new WeakMap<readonly Point[], WeakMap<Point, Point>>();

/** Use the rounded, sampled axis here. The sketch can turn sharply several map units away
 * from the playable bend. Interpolated normals keep both walls and their footholds moving
 * perpendicular to a shaft, slope or turn even at a boundary between axis segments. */
function widthDirection(p: Point, axis: readonly Point[]): Point {
  let cached = widthDirections.get(axis);
  if (!cached) { cached = new WeakMap(); widthDirections.set(axis, cached); }
  const found = cached.get(p);
  if (found) return found;
  let nearest = Infinity, station = 0, fraction = 0;
  for (let i = 1; i < axis.length; i++) {
    const a = axis[i - 1], b = axis[i];
    const t = Math.min(1, Math.max(0, projection(p, a, b)));
    const dx = p.x - a.x - (b.x - a.x) * t, dy = p.y - a.y - (b.y - a.y) * t;
    const squared = dx * dx + dy * dy;
    if (squared < nearest) { nearest = squared; station = i - 1; fraction = t; }
  }
  const a = axis[station], b = axis[station + 1];
  function normal(i: number) {
    const before = axis[Math.max(0, i - 1)], after = axis[Math.min(axis.length - 1, i + 1)];
    const length = dist(before, after) || 1;
    return { x: (before.y - after.y) / length, y: (after.x - before.x) / length };
  }
  const left = normal(station), right = normal(station + 1);
  const nx = left.x + (right.x - left.x) * fraction, ny = left.y + (right.y - left.y) * fraction;
  const length = Math.hypot(nx, ny) || 1;
  const signed = ((p.x - a.x - (b.x - a.x) * fraction) * nx +
    (p.y - a.y - (b.y - a.y) * fraction) * ny) / length;
  // Taper through the center instead of splitting small floating hazards at the axis.
  const gain = Math.sign(signed) * ease(Math.abs(signed) / 24) / length;
  const direction = { x: nx * gain, y: ny * gain };
  cached.set(p, direction);
  return direction;
}

/** Clipping the backing rock leaves thin, almost collinear triangles. Independent samples of
 * a curved deformation can move a middle vertex across its long edge. Interpolate the
 * displacement on that edge for the worst-conditioned triangle meeting each such vertex.
 * The weights are fixed in the rest pose, so follow-up edits and resets are deterministic. */
export function meshWidthCorrections(vertices: readonly BoundVertex[], faces: readonly {v: readonly number[]}[],
  axis: readonly Point[], knot: number): ReadonlyMap<number, Point> {
  let mesh = meshBindings.get(vertices);
  if (!mesh) {
    const edges = new Map<number, EdgeConstraint & {aspect: number}>();
    for (const {v} of faces) {
      for (let i=0; i<3; i++) {
        const tip = v[i], a = v[(i+1)%3], b = v[(i+2)%3];
        const p = vertices[tip], u = vertices[a], z = vertices[b];
        const dx=z.x-u.x, dy=z.y-u.y, len2=dx*dx+dy*dy;
        if (!len2) continue;
        const fraction=projection(p,u,z);
        if (fraction <= 0 || fraction >= 1) continue;
        const aspect=Math.abs((p.x-u.x)*dy - (p.y-u.y)*dx)/len2;
        if (aspect < 0.12 && (!edges.has(tip) || edges.get(tip)!.aspect > aspect)) {
          edges.set(tip,{tip,a,b,fraction,aspect});
        }
      }
    }
    mesh={edges:[...edges.values()],corrections:new Map()};
    meshBindings.set(vertices,mesh);
  }
  const cached=mesh.corrections.get(knot);
  if (cached) return cached;
  const raw = (id: number) => {
    const p=vertices[id], weight=p.weights.find(w=>w[0]===knot)?.[1] ?? 0;
    if (!weight) return {x:0,y:0};
    const n=widthDirection(p,axis);
    return {x:n.x*weight/2,y:n.y*weight/2};
  };
  const corrections=new Map<number,Point>();
  for (const {tip,a,b,fraction} of mesh.edges) {
    // A clamped boundary or neighboring pass must not acquire an influence.
    if (!vertices[tip].weights.some(w=>w[0]===knot && w[1]>0)) continue;
    const u=raw(a), v=raw(b), p=raw(tip);
    corrections.set(tip,{x:u.x+(v.x-u.x)*fraction-p.x,y:u.y+(v.y-u.y)*fraction-p.y});
  }
  mesh.corrections.set(knot,corrections);
  return corrections;
}

export function position(
  p: BoundVertex, rest: readonly Point[], knots: readonly Point[], sections: readonly SectionProperties[],
  axis: readonly Point[], terrain = true, landings?: readonly Point[]
): Point {
  let x = p.x, y = p.y, widening = 0;
  for (const [k, bend, lift, fixedWidth, fixedHeight, fixedReach] of p.weights) {
    x += (knots[k].x - rest[k].x) * bend;
    y += (knots[k].y - rest[k].y) * bend;
    if (terrain) {
      y -= (fixedHeight ?? sections[k - 1].landingHeight) * lift;
      const reach = fixedWidth === undefined ? sections[k - 1].landingReach : fixedReach;
      if (lift && reach && landings) {
        // Stretch the landing horizontally about its original centre. Welded rock and
        // footholds follow the same smooth displacement, tapering off at its perimeter.
        x += reach * Math.tanh((p.x - landings[k - 1].x) / 12) * lift;
      }
      widening += (fixedWidth ?? sections[k - 1].widthOffset ?? 0) * bend;
    }
  }
  if (widening !== 0) {
    const normal = widthDirection(p, axis);
    x += normal.x * widening / 2;
    y += normal.y * widening / 2;
  }
  return { x, y };
}
