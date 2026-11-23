import type { PmsMapData, PmsPolygon } from '@shared/pmsParser';
import { doesPolyCollideSoldier } from '@shared/soldatConstants';

interface WidthMask {
  canvas: HTMLCanvasElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const cached = new WeakMap<readonly PmsPolygon[], WidthMask>();

// Draw the difference between two solid silhouettes. Highlighting all triangles would
// also tint their common interiors and hide small outward movements of a wall.
export function sectionWidthMask(map: PmsMapData, before: readonly PmsPolygon[], after: readonly PmsPolygon[]) {
  const previous = cached.get(after);
  if (previous) return previous;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const poly of [...before, ...after]) {
    for (const { x, y } of poly.vertices) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (!(right > left && bottom > top)) return;
  const scale = Math.min(4, 768 / Math.max(right - left, bottom - top));
  left -= 1 / scale; top -= 1 / scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((right - left) * scale) + 1;
  canvas.height = Math.ceil((bottom - top) * scale) + 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
  function triangle(poly: PmsPolygon) {
    if (!ctx || !doesPolyCollideSoldier(poly.polyType, 1, false)) return;
    const [a, b, c] = poly.vertices;
    // A manually flipped face still covers the same ground.
    const clockwise = (b.x-a.x)*(c.y-a.y) >= (b.y-a.y)*(c.x-a.x);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(clockwise ? b.x : c.x, clockwise ? b.y : c.y);
    ctx.lineTo(clockwise ? c.x : b.x, clockwise ? c.y : b.y);
    ctx.closePath();
  }
  ctx.beginPath();
  before.forEach(triangle);
  ctx.fillStyle = '#67e8f9';
  ctx.fill();
  ctx.globalCompositeOperation = 'xor';
  ctx.beginPath();
  after.forEach(triangle);
  ctx.fillStyle = '#fbbf24';
  ctx.fill();

  // An overlapping unchanged wall or active collider still occupies this area.
  const edited = new Set(before);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  for (const poly of map.polygons) {
    if (edited.has(poly)) continue;
    const [a,b,c] = poly.vertices;
    if (Math.max(a.x,b.x,c.x) < left || Math.min(a.x,b.x,c.x) > right ||
        Math.max(a.y,b.y,c.y) < top || Math.min(a.y,b.y,c.y) > bottom) continue;
    triangle(poly);
  }
  for (const collider of map.colliders) {
    if (!collider.active || collider.radius <= 0) continue;
    ctx.moveTo(collider.x + collider.radius/2, collider.y);
    ctx.arc(collider.x, collider.y, collider.radius/2, 0, Math.PI*2);
  }
  ctx.fill();
  const mask = { canvas, left, top, right: left + canvas.width / scale, bottom: top + canvas.height / scale };
  cached.set(after, mask);
  return mask;
}
