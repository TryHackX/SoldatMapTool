import type { PmsPolygon } from './pmsParser';

export interface JumpSample { gap: number; rise: number; landingWidth?: number; rebound?: number }
export interface ClimbGeometryProfile {
  jumps: JumpSample[];
  rebounds: number[];
  bounceJumps?: JumpSample[];
  measuredMaps: number;
  pairs: number;
  bounceMaps: number;
  library?: import('./climbLibrary').ClimbLibrarySnapshot;
}

interface Ledge { left: number; right: number; leftY: number; rightY: number; poly: PmsPolygon }
// Alpha runner before collecting the flag. Bullet-only faces and other team walls do not cover a ledge.
const solid = new Set([0, 2, 4, 5, 6, 7, 8, 9, 11, 18, 19, 20, 22]);

// Only the exposed upper face is a foothold. Half a unit above an internal diagonal is still solid.
export function measureClimbTerrain(polygons: readonly PmsPolygon[], recordSequences = false) {
  const boxes = polygons.filter(p => solid.has(p.polyType)).map(poly => ({
    poly, min: Math.min(...poly.vertices.map(v => v.x)), max: Math.max(...poly.vertices.map(v => v.x)),
  })).sort((a, b) => a.min - b.min);
  const candidates: Ledge[] = [];
  for (const { poly } of boxes) {
    if (![0, 2, 4, 8, 18].includes(poly.polyType)) continue;
    for (let i = 0; i < 3; i++) {
      const a = poly.vertices[i], b = poly.vertices[(i + 1) % 3], c = poly.vertices[(i + 2) % 3];
      const [l, r] = a.x < b.x ? [a, b] : [b, a], dx = r.x - l.x, dy = r.y - l.y;
      if (dx < 7 || dx > 220 || Math.abs(dy) > dx * 0.24 || dx * (c.y - l.y) - dy * (c.x - l.x) <= 0) continue;
      candidates.push({ left: l.x, right: r.x, leftY: l.y, rightY: r.y, poly });
    }
  }
  const center = (e: Ledge) => (e.left + e.right) / 2;
  candidates.sort((a, b) => center(a) - center(b));
  let next = 0;
  const active = new Set<typeof boxes[number]>();
  const exposed = candidates.filter(e => {
    const x = center(e), y = (e.leftY + e.rightY) / 2 - 0.5;
    while (next < boxes.length && boxes[next].min <= x) active.add(boxes[next++]);
    for (const box of active) {
      if (box.max < x) { active.delete(box); continue; }
      if (box.poly === e.poly) continue;
      const sides = box.poly.vertices.map((v, i) => {
        const w = box.poly.vertices[(i + 1) % 3];
        return (w.x - v.x) * (y - v.y) - (w.y - v.y) * (x - v.x);
      });
      if (sides.every(n => n >= 0) || sides.every(n => n <= 0)) return false;
    }
    return true;
  }).sort((a, b) => a.left - b.left);
  const jumps: JumpSample[] = [], rebounds: number[] = [];
  const successors = recordSequences ? new Map<number,{index:number; jump:JumpSample}>() : undefined;
  for (let i = 0; i < exposed.length; i++) {
    const a = exposed[i];
    const bouncy = a.poly.polyType === 18 && Number.isFinite(a.poly.bounciness) && a.poly.bounciness > 0;
    if (bouncy) rebounds.push(a.poly.bounciness);
    let nearest: JumpSample | undefined, nearestIndex = -1, score = Infinity;
    for (let j = i + 1; j < exposed.length; j++) {
      const b = exposed[j], gap = b.left - a.right, rise = a.rightY - b.leftY;
      if (gap > 170) break;
      if (gap < 6 || Math.abs(rise) > 80) continue;
      const distance = Math.hypot(gap, rise);
      if (distance < score) {
        score = distance;
        nearestIndex = j;
        nearest = { gap: Math.round(gap), rise: Math.round(rise), landingWidth: Math.round(b.right - b.left) };
      }
    }
    if (nearest) {
      const jump=bouncy ? {...nearest,rebound:a.poly.bounciness} : nearest;
      jumps.push(jump);
      successors?.set(i,{index:nearestIndex,jump});
    }
  }
  jumps.sort((a, b) => Math.hypot(a.gap, a.rise) - Math.hypot(b.gap, b.rise));
  rebounds.sort((a, b) => a - b);
  const sequences: {previous:JumpSample; next:JumpSample}[] = [];
  if (successors) for (const {index,jump} of successors.values()) {
    const next = successors.get(index);
    if (next) sequences.push({previous:jump,next:next.jump});
  }
  const exposedLength = exposed.reduce((sum, edge) => sum + Math.hypot(edge.right - edge.left, edge.rightY - edge.leftY), 0);
  return { jumps, rebounds, sequences, exposedLength };
}

// Limit each map's influence and keep real gap/height pairs together.
export function representatives<T>(sorted: readonly T[]): T[] {
  return sorted.length ? [0.2, 0.5, 0.8].map(q => sorted[Math.round((sorted.length - 1) * q)]) : [];
}
