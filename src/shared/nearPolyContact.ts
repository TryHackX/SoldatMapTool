import type { PmsPolygon } from './pmsParser';
import { polygonSignedArea2 } from './polygonGeometry';

type Point = {x:number; y:number};
export type ContactFeature = {kind:'point'; vertex:number; at:Point} | {kind:'edge'; edge:number; at:Point};

/** Classify just the closest feature. Multiple possible vertices/edges belong to an ambiguous thin patch. */
export function closestContactFeature(host: PmsPolygon, v: Point, radius: number): ContactFeature | 'ambiguous' | undefined {
  const corners = host.vertices.flatMap((p,i) => Math.hypot(p.x-v.x,p.y-v.y) <= radius ? [i] : []);
  if (corners.length > 1) return 'ambiguous';
  if (corners.length) return {kind:'point',vertex:corners[0],at:host.vertices[corners[0]]};
  let found: ContactFeature | undefined;
  for (let edge=0; edge<3; edge++) {
    const a = host.vertices[edge], b = host.vertices[(edge+1)%3];
    const dx = b.x-a.x, dy = b.y-a.y, square = dx*dx + dy*dy;
    const t = ((v.x-a.x)*dx + (v.y-a.y)*dy)/square;
    if (!(t>0 && t<1)) continue;
    const at = {x:a.x + t*dx, y:a.y + t*dy};
    if (Math.hypot(v.x-at.x,v.y-at.y)>radius) continue;
    if (found) return 'ambiguous';
    found = {kind:'edge',edge,at};
  }
  return found;
}

/** An extended shared side may look like two close corners at its end. Leave that seam intact. */
export function parallelContactSides(src: PmsPolygon, vertex: number, host: PmsPolygon, target: number, radius: number) {
  const v = src.vertices[vertex], w = host.vertices[target];
  return src.vertices.some((p,i) => i !== vertex && host.vertices.some((q,j) => {
    if (j === target) return false;
    const ax = p.x-v.x, ay = p.y-v.y, bx = q.x-w.x, by = q.y-w.y;
    return ax*bx + ay*by > 0 && Math.abs(ax*by - ay*bx) <= radius * Math.max(Math.hypot(ax,ay), Math.hypot(bx,by));
  }));
}

export function outsideHostEdge(src: PmsPolygon, vertex: number, host: PmsPolygon, edge: number, radius: number) {
  const a=host.vertices[edge], b=host.vertices[(edge+1)%3];
  const margin=radius*Math.hypot(b.x-a.x,b.y-a.y);
  return src.vertices.every((p,i) => i===vertex || polygonSignedArea2(a,b,p) < -margin);
}
