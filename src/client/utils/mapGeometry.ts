import type { PmsMapData } from '@shared/pmsParser';

/** True when the point lies inside or on the edge of the triangle (either winding) */
export function pointInTriangle(
  px: number,
  py: number,
  v1: { x: number; y: number },
  v2: { x: number; y: number },
  v3: { x: number; y: number }
): boolean {
  const d1 = (px - v2.x) * (v1.y - v2.y) - (v1.x - v2.x) * (py - v2.y);
  const d2 = (px - v3.x) * (v2.y - v3.y) - (v2.x - v3.x) * (py - v3.y);
  const d3 = (px - v1.x) * (v3.y - v1.y) - (v3.x - v1.x) * (py - v1.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Polygon types players stand on (everything except bullet-only, non-colliding, flag-only and background ones)
export const PLAYER_SOLID_POLY_TYPES = new Set([0, 2, 4, 5, 6, 7, 8, 9, 11, 13, 15, 17, 18, 19, 20, 21, 22]);

/**
 * Height of the first floor a soldier dropped at (x, y) lands on: the nearest player-solid polygon edge crossed by
 * the vertical line below the point, within `maxDrop`. Null when there is none or the point is inside such a
 * polygon (then the soldier is drawn exactly at the point).
 */
export function findFloorBelow(map: PmsMapData, x: number, y: number, maxDrop: number): number | null {
  let best: number | null = null;
  for (const poly of map.polygons) {
    if (!PLAYER_SOLID_POLY_TYPES.has(poly.polyType)) continue;
    const [a, b, c] = poly.vertices;
    if (x < Math.min(a.x, b.x, c.x) || x > Math.max(a.x, b.x, c.x)) continue;
    if (pointInTriangle(x, y, a, b, c)) return null;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if ((p.x < x && q.x < x) || (p.x > x && q.x > x) || p.x === q.x) continue;
      const yi = p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
      if (yi >= y && yi <= y + maxDrop && (best === null || yi < best)) best = yi;
    }
  }
  return best;
}
