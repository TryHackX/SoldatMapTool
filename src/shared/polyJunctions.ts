import { polygonSignedArea2, rebuildPolygonGeometry } from './pmsCompiler';
import type { PmsMapData, PmsPolygon, PmsVertex } from './pmsParser';
import { TriangleGrid } from './triangleGrid';
import { SOLDIER_COLLIDABLE_TYPES } from './soldatConstants';
import { closestContactFeature, outsideHostEdge, parallelContactSides, type ContactFeature } from './nearPolyContact';

type Point = {x: number; y: number};
type Tip = { polygon: number; vertex: number };
type Move = Tip & { next: PmsVertex };
export interface Junction extends Point {
  kind: 'point' | 'edge';
  gap?: number;
  polygons: number[];
  moves: Move[];
}

const key = (v: Point) => v.x + ',' + v.y;
const EPSILON = 1e-7;
const MAX_OVERLAP = 2;
export const MAX_JUNCTION_TOLERANCE = 1;
const goodGround = (p: PmsPolygon) => p.polyType === 0 && polygonSignedArea2(...p.vertices) >= 2;

// Two clockwise triangles overlap in area when no edge separates their interiors.
function overlap(a: PmsPolygon['vertices'], b: PmsPolygon['vertices']) {
  const separated = (first: typeof a, other: typeof b) => first.some((v, i) =>
    other.every(w => polygonSignedArea2(v, first[(i + 1) % 3], w) <= EPSILON));
  return !separated(a, b) && !separated(b, a);
}

function edgeContact(edge: PmsPolygon, tip: PmsVertex) {
  for (let i = 0; i < 3; i++) {
    const a = edge.vertices[i], b = edge.vertices[(i + 1) % 3];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!length || Math.abs(polygonSignedArea2(a, b, tip)) > EPSILON * length) continue;
    const along = ((tip.x - a.x) * dx + (tip.y - a.y) * dy) / length;
    if (along > EPSILON && along < length - EPSILON) return [a, b] as const;
  }
}

function tipMove(polys: readonly PmsPolygon[], tip: Tip, receivers: number[], contact?: Point): Move | undefined {
  const src = polys[tip.polygon], v = src.vertices[tip.vertex];
  const a = src.vertices[(tip.vertex + 1) % 3], b = src.vertices[(tip.vertex + 2) % 3];
  const mx = v.x - (a.x + b.x) / 2, my = v.y - (a.y + b.y) / 2;
  const step = Math.min(MAX_OVERLAP, Math.hypot(mx, my) * 0.12);
  if (step < 0.05) return;
  const destinations = receivers.filter(i => i !== tip.polygon && !overlap(src.vertices, polys[i].vertices));
  // Prefer continuing an existing straight outer edge into the neighbour, e.g. the top of a floor.
  const directions = [[mx, my]];
  for (const p of [a, b]) {
    const dx = v.x - p.x, dy = v.y - p.y;
    if (destinations.some(i => polys[i].vertices.some(q =>
      Math.abs(polygonSignedArea2(p, v, q)) <= EPSILON * Math.hypot(dx, dy) &&
      (q.x - v.x) * dx + (q.y - v.y) * dy > 0))) directions.unshift([dx, dy]);
  }
  const det = polygonSignedArea2(v, a, b);
  const targets: Point[] = directions.flatMap(([dx, dy]) => {
    const length = Math.hypot(dx,dy);
    return length ? [{x:v.x + step * dx / length, y:v.y + step * dy / length}] : [];
  });
  if (contact) {
    const remaining = step - Math.hypot(contact.x - v.x, contact.y - v.y);
    if (remaining < 0.05) return;
    for (const i of destinations) {
      const host = polys[i].vertices;
      const dx = (host[0].x + host[1].x + host[2].x) / 3 - contact.x;
      const dy = (host[0].y + host[1].y + host[2].y) / 3 - contact.y;
      const length = Math.hypot(dx,dy);
      if (length) targets.push({x:contact.x + remaining * dx / length, y:contact.y + remaining * dy / length});
    }
  }
  for (const {x,y} of targets) {
    const ta = ((x - v.x) * (b.y - v.y) - (y - v.y) * (b.x - v.x)) / det;
    const tb = ((a.x - v.x) * (y - v.y) - (a.y - v.y) * (x - v.x)) / det;
    const next = { ...v, x, y, u: v.u + ta * (a.u - v.u) + tb * (b.u - v.u),
      v: v.v + ta * (a.v - v.v) + tb * (b.v - v.v) };
    const newFace: PmsPolygon['vertices'] = [next, a, b];
    if (polygonSignedArea2(...newFace) <= det) continue;
    if (contact && newFace.some((p,i) => polygonSignedArea2(p,newFace[(i+1)%3],v) < -EPSILON)) continue;
    if (destinations.some(i => {
      const host = polys[i].vertices;
      return host.every((w, j) => polygonSignedArea2(w, host[(j + 1) % 3], next) >= -EPSILON) &&
        overlap(newFace, host);
    })) return { ...tip, next };
  }
}

function findNearbyContacts(polys: readonly PmsPolygon[], groups: Map<string,Tip[]>, grid: TriangleGrid, radius: number) {
  const options = new Map<string, {tip:Tip; host:number; feature:ContactFeature; gap:number}>();
  for (const [id,group] of groups) {
    if (group.length!==1) continue;
    const tip = group[0], src = polys[tip.polygon], v=src.vertices[tip.vertex];
    if (!goodGround(src)) continue;
    const ids = new Set<number>();
    // With a radius below one map unit, the square intersects at most four 64-unit grid cells.
    for (const x of [v.x-radius,v.x+radius]) for (const y of [v.y-radius,v.y+radius])
      for (const index of grid.candidates(x,y)) if (index !== tip.polygon) ids.add(index);
    let proposed: {tip:Tip; host:number; feature:ContactFeature; gap:number} | undefined;
    for (const host of ids) {
      const other = polys[host], feature = closestContactFeature(other,v,radius);
      if (!feature) {
        const sides=other.vertices.map((p,i)=>polygonSignedArea2(p,other.vertices[(i+1)%3],v));
        if (sides.every(n=>n>EPSILON) || sides.every(n=>n < -EPSILON)) { proposed=undefined; break; }
        continue;
      }
      if (proposed || feature==='ambiguous' || !goodGround(other) || overlap(src.vertices,other.vertices)) { proposed=undefined; break; }
      const gap = Math.hypot(v.x-feature.at.x,v.y-feature.at.y);
      if (gap<=EPSILON || (feature.kind==='point'
        ? groups.get(key(feature.at))?.length!==1 || parallelContactSides(src,tip.vertex,other,feature.vertex,radius)
        : !outsideHostEdge(src,tip.vertex,other,feature.edge,radius))) { proposed=undefined; break; }
      proposed={tip,host,feature,gap};
    }
    if (proposed) options.set(id,proposed);
  }
  const found:Junction[]=[];
  for (const [id,{tip,host,feature,gap}] of options) {
    const v=polys[tip.polygon].vertices[tip.vertex];
    const move=tipMove(polys,tip,[host],feature.at);
    if (!move) continue;
    const moves=[move];
    if (feature.kind==='point') {
      const target=options.get(key(feature.at));
      if (tip.polygon>=host || target?.host!==tip.polygon || target.feature.kind!=='point' || key(target.feature.at)!==id) continue;
      const reverse=tipMove(polys,target.tip,[tip.polygon],v);
      if (!reverse) continue;
      moves.push(reverse);
    }
    found.push({kind:feature.kind,x:v.x,y:v.y,gap,polygons:[tip.polygon,host],moves});
  }
  return found;
}

/** Only exposed contacts can catch a soldier. A closed fan is solid all around its centre. */
export function findPolyJunctions(polygons: readonly PmsPolygon[], tolerance = 0): Junction[] {
  const groups = new Map<string, Tip[]>();
  polygons.forEach((p, polygon) => p.vertices.forEach((v, vertex) => {
    const id = key(v), group = groups.get(id);
    if (group) group.push({ polygon, vertex });
    else groups.set(id, [{ polygon, vertex }]);
  }));
  const solid = polygons.flatMap((p, i) => SOLDIER_COLLIDABLE_TYPES.has(p.polyType) ? [i] : []);
  const grid = new TriangleGrid(polygons, solid);
  const found: Junction[] = [];
  for (const group of groups.values()) {
    if (group.length > 32 || group.some(tip => !goodGround(polygons[tip.polygon]))) continue;
    const tipIds = new Set(group.map(tip => tip.polygon));
    const v = polygons[group[0].polygon].vertices[group[0].vertex];
    const hosts: number[] = [];
    let ambiguous = false;
    for (const i of grid.candidates(v.x, v.y)) {
      if (tipIds.has(i)) continue;
      const p = polygons[i], edge = edgeContact(p, v);
      if (!edge) {
        const side = p.vertices.map((a, j) => polygonSignedArea2(a, p.vertices[(j + 1) % 3], v));
        if (side.every(n => n > EPSILON) || side.every(n => n < -EPSILON)) { ambiguous = true; break; }
        continue;
      }
      if (!goodGround(p) || group.some(tip => polygons[tip.polygon].vertices.some((w, index) =>
        index !== tip.vertex && polygonSignedArea2(edge[0], edge[1], w) >= -EPSILON))) {
        // Shared edge segments, pre-existing overlaps and mixed-material boundaries stay as authored.
        ambiguous = true;
        break;
      }
      hosts.push(i);
    }
    if (ambiguous || hosts.length > 1) continue;
    let kind: Junction['kind'];
    if (hosts.length) kind = 'edge';
    else {
      if (group.length !== 2) continue;
      const [first, second] = group;
      // A shared edge, including a partial collinear edge, joins filled patches continuously.
      const firstEdges = polygons[first.polygon].vertices.filter((_, i) => i !== first.vertex);
      const secondEdges = polygons[second.polygon].vertices.filter((_, i) => i !== second.vertex);
      if (firstEdges.some(a => secondEdges.some(b =>
        Math.abs(polygonSignedArea2(v, a, b)) <= EPSILON &&
        (a.x-v.x)*(b.x-v.x)+(a.y-v.y)*(b.y-v.y) > 0))) continue;
      kind = 'point';
    }
    const participants = [...tipIds, ...hosts];
    const receivers = hosts.length ? hosts : participants;
    const moves = group.map(tip => tipMove(polygons, tip, receivers));
    if (moves.every((m): m is Move => m !== undefined)) {
      found.push({ x: v.x, y: v.y, kind, polygons: participants, moves });
    }
  }
  const radius = Number.isFinite(tolerance) ? Math.min(MAX_JUNCTION_TOLERANCE,tolerance) : 0;
  if (radius > EPSILON) found.push(...findNearbyContacts(polygons,groups,grid,radius));
  return found;
}

function applyJunction(polygons: PmsPolygon[], junction: Junction) {
  for (const move of junction.moves) {
    const poly = polygons[move.polygon];
    const vertices: PmsPolygon['vertices'] = [...poly.vertices];
    vertices[move.vertex] = move.next;
    polygons[move.polygon] = rebuildPolygonGeometry({ ...poly, vertices });
  }
}

export function sealPolyJunction(map: PmsMapData, x: number, y: number, tolerance = 0) {
  const junction = findPolyJunctions(map.polygons,tolerance).find(j => j.x === x && j.y === y);
  if (!junction) return map;
  const polygons = map.polygons.slice();
  applyJunction(polygons, junction);
  return { ...map, polygons };
}

export function sealAllPolyJunctions(map: PmsMapData, tolerance = 0) {
  let candidates = findPolyJunctions(map.polygons,tolerance);
  if (!candidates.length) return { map, count: 0 };
  const polygons = map.polygons.slice();
  let count = 0;
  while (candidates.length) {
    const touched = new Set<number>(), deferred = new Set<string>();
    for (const j of candidates) {
      if (j.polygons.some(i => touched.has(i))) deferred.add(key(j));
      else {
        applyJunction(polygons, j);
        for (const i of j.polygons) touched.add(i);
        count++;
      }
    }
    // Re-evaluate adjacent edits against the new vertex positions before applying the next batch.
    candidates = deferred.size ? findPolyJunctions(polygons,tolerance).filter(j => deferred.has(key(j))) : [];
  }
  return { map: { ...map, polygons }, count };
}
