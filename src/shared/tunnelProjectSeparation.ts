import type { TunnelPoint as Point } from './climbTunnel';
import type { PmsPolygon } from './pmsParser';
import { doesPolyCollideSoldier } from './soldatConstants';
import type { BoundVertex } from './tunnelProjectGeometry';

/** Measure solid rock along a chord between two nearby runs. Triangle intervals must be
 * merged because the deep rock and the visible shell intentionally overlap. */
function rockOnChord(a: Point, b: Point, terrain: readonly PmsPolygon[]) {
  const spans: [number, number][] = [];
  const dx = b.x - a.x, dy = b.y - a.y;
  const left = Math.min(a.x,b.x), right = Math.max(a.x,b.x);
  const top = Math.min(a.y,b.y), bottom = Math.max(a.y,b.y);
  for (const poly of terrain) {
    const v = poly.vertices;
    if (v.every(p=>p.x < left) || v.every(p=>p.x > right) ||
      v.every(p=>p.y < top) || v.every(p=>p.y > bottom) || !doesPolyCollideSoldier(poly.polyType,1,false)) continue;
    let lo = 0, hi = 1;
    for (let i = 0; i < 3 && hi > lo; i++) {
      const p = v[i], q = v[(i + 1) % 3];
      const ex = q.x - p.x, ey = q.y - p.y;
      const origin = ex * (a.y - p.y) - ey * (a.x - p.x), rate = ex * dy - ey * dx;
      if (rate > 0) lo = Math.max(lo, -origin / rate);
      else if (rate < 0) hi = Math.min(hi, -origin / rate);
      else if (origin < 0) hi = lo;
    }
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((x,y)=>x[0]-y[0]);
  let covered = 0, end = 0;
  for (const [lo,hi] of spans) {
    covered += Math.max(0,hi-Math.max(lo,end));
    end = Math.max(end,hi);
  }
  return covered * Math.hypot(dx,dy);
}

interface Divider { a: Point; b: Point }

/** A separate pass is near in world space but far along the same route, or belongs to
 * another tunnel. Sample the nearest facing point on each neighboring stretch. */
export function neighbouringDividers(axis: readonly BoundVertex[], line: readonly Point[], k: number,
  neighbours: readonly Point[][], searchRadius: number) {
  const along = [0];
  for (let i=1; i<line.length; i++) along.push(along[i-1]+Math.hypot(line[i].x-line[i-1].x,line[i].y-line[i-1].y));
  const dividers: Divider[] = [];
  for (let i=0; i<line.length; i++) {
    if (!axis[i].weights.some(w => w[0] === k && w[1] > 0)) continue;
    const a = line[i];
    const prev = line[Math.max(0,i-1)], next = line[Math.min(line.length-1,i+1)];
    const tx = next.x - prev.x, ty = next.y - prev.y, length = Math.hypot(tx,ty) || 1;
    for (const path of [line,...neighbours]) {
      let nearest: {b: Point; distance: number} | undefined;
      for (let j=1; j<path.length; j++) {
        const p = path[j-1], q = path[j];
        const vx = q.x - p.x, vy = q.y - p.y;
        const t = Math.max(0,Math.min(1,((a.x-p.x)*vx + (a.y-p.y)*vy)/(vx*vx + vy*vy || 1)));
        const b = { x:p.x+t*vx, y:p.y+t*vy };
        const dx = b.x-a.x, dy = b.y-a.y, d = Math.hypot(dx,dy);
        const separate = path !== line || Math.abs(along[i] - along[j-1] - t*(along[j]-along[j-1])) > Math.max(100,1.9*d);
        const facing = Math.abs(tx*dy - ty*dx)/(length*d || 1);
        if (separate && facing >= 0.7 && d < searchRadius) {
          if (!nearest || d < nearest.distance) nearest = {b,distance:d};
        } else if (nearest) {
          dividers.push({a,b:nearest.b});
          nearest = undefined;
        }
      }
      if (nearest) dividers.push({a,b:nearest.b});
    }
  }
  return dividers;
}

export function wideningKeepsWalls(dividers: readonly Divider[], before: readonly PmsPolygon[], after: readonly PmsPolygon[]) {
  for (const {a,b} of dividers) {
    const was = rockOnChord(a,b,before), now = rockOnChord(a,b,after);
    // Allow safe corrections on already-thin rock. Check remaining thickness on the built
    // geometry: displacement fades at the medial plane instead of consuming the full offset.
    if (now + 0.01 < Math.min(was, 8)) return false;
  }
  return true;
}
