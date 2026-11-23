import { hasTunnelClearance, type TunnelPoint as Point, type TunnelResult, type TunnelSettings } from './climbTunnel';
import { computeMapBounds, rebuildPolygonGeometry } from './pmsCompiler';
import type { PmsMapData, PmsPolygon, PmsSpawnpoint, PmsVertex } from './pmsParser';
import { pointInTriInclusive, polygonSignedArea2, segmentsIntersect } from './polygonGeometry';
import { doesPolyCollideSoldier } from './soldatConstants';
import { bindPoint, editKnots, meshWidthCorrections, nearestKnotAlongAxis, nearestPoint, position, type BoundVertex, type SectionProperties } from './tunnelProjectGeometry';
import { neighbouringDividers, wideningKeepsWalls } from './tunnelProjectSeparation';
import { isTunnelPoint, isTunnelSettings } from './tunnelSketch';
import { pinTunnelSection } from './tunnelSectionGates';
import { isPaceSettings, type PaceSettings } from './tunnelPace';
export { tunnelSectionGates, tunnelGateAt } from './tunnelSectionGates';

type Triple<T> = [T, T, T];

interface ProjectFace {
  v: Triple<number>;
  key: string;
  type: number;
  rebound: number;
  landing: number; // Editable knot index. Zero for faces other than the landing surface.
  pinnedLanding?: boolean; // A material touching the entrance or exit must not change on reroll.
}

export type TunnelSectionEdit = SectionProperties;
export interface TunnelProject {
  version: 1;
  id: string;
  method: 'draw' | 'auto';
  settings: TunnelSettings;
  pace?: PaceSettings;
  sourcePath: Point[];
  restKnots: Point[];
  knots: Point[];
  sections: TunnelSectionEdit[];
  landings: Point[];
  axis: BoundVertex[];
  footholds?: BoundVertex[];
  spawnpoints?: PmsSpawnpoint[];
  vertices: BoundVertex[];
  faces: ProjectFace[];
}

export interface TunnelSectionChange {
  point?: Point;
  landingHeight?: number;
  landingReach?: number;
  bounce?: number | null;
  widthOffset?: number;
  pinGates?: boolean;
}

export const TUNNEL_WIDTH_OFFSET_RANGE = { min: -80, max: 120 } as const;
type RejectReason = 'invalid' | 'manual' | 'clearance' | 'neighbour' | 'unchanged';
export type TunnelSectionResult =
  | { ok: false; reason: RejectReason }
  | { ok: true; map: PmsMapData; project: TunnelProject; changedPolygons: number; changedIndices: number[] };

// Exact identity in the PMS representation, including color, UV and collision normals.
// A file reopened after Float32 round-trip has the same key. Index alone could select
// someone else's triangle after a reorder, deletion or pasted duplicate.
function polygonKey(poly: PmsPolygon): string {
  const bytes = new Uint8Array(121);
  const view = new DataView(bytes.buffer);
  let i = 0;
  function f(n: number) { view.setFloat32(i, n === 0 ? 0 : n, true); i += 4; }
  for (const v of poly.vertices) {
    f(v.x); f(v.y); f(v.z); f(v.rhw);
    bytes[i++] = v.color.b; bytes[i++] = v.color.g; bytes[i++] = v.color.r; bytes[i++] = v.color.a;
    f(v.u); f(v.v);
  }
  for (const n of poly.normals) { f(n.x); f(n.y); f(n.z); }
  bytes[i] = poly.polyType;
  // An in-memory edit can update the coefficient first, before collision normals are rebuilt.
  if (poly.polyType === 18 && Math.abs(poly.bounciness - Math.hypot(poly.normals[2].x, poly.normals[2].y)) > 0.000001) return '';
  return btoa(String.fromCharCode(...bytes));
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function centroid(poly: PmsPolygon): Point {
  const [a, b, c] = poly.vertices;
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

export function createTunnelProject(
  result: TunnelResult, settings: TunnelSettings, path?: readonly Point[]
): TunnelProject {
  if (!result.validation.ok || result.centerline.length < 2) throw new Error('A completed tunnel is required');
  const method = path ? 'draw' : 'auto';
  const sourcePath = (path ?? result.centerline).map(p => ({ x: p.x, y: p.y }));
  const restKnots = editKnots(sourcePath, !!path);
  const handles = restKnots.slice(1, -1);
  const surfaces = handles.map((): Point[] => []);
  const floorOwners = new Map<number, number>();
  for (const {polygon, station} of result.floorFaces) {
    const k = nearestKnotAlongAxis(station, restKnots);
    if (k > 0 && k < restKnots.length - 1) {
      surfaces[k - 1].push(centroid(result.polygons[polygon]));
      floorOwners.set(polygon, k);
    }
  }
  const landings = handles.map((handle, i) => surfaces[i][nearestPoint(handle, surfaces[i])] ?? handle);
  const indexByPoint = new Map<string, number>();
  const vertices: BoundVertex[] = [];

  const faces = result.polygons.map((poly, i) => {
    const v = poly.vertices.map(p => {
      const pointKey = Math.fround(p.x) + ',' + Math.fround(p.y);
      let id = indexByPoint.get(pointKey);
      if (id === undefined) {
        id = vertices.length;
        vertices.push(bindPoint({ x: p.x, y: p.y }, restKnots, landings, settings.clearance));
        indexByPoint.set(pointKey, id);
      }
      return id;
    }) as Triple<number>;
    const owner = floorOwners.get(i);
    const landing = owner && dist(centroid(poly), landings[owner - 1]) <= 36 ? owner : 0;
    return { v, key: polygonKey(poly), type: poly.polyType, rebound: poly.bounciness, landing };
  });
  return {
    version: 1, id: crypto.randomUUID(), method, settings: structuredClone(settings), sourcePath, restKnots,
    knots: restKnots.map(p => ({ ...p })), sections: handles.map(() => ({ landingHeight: 0, bounce: null })),
    landings, axis: result.centerline.map(p => bindPoint(p, restKnots, landings, settings.clearance)), vertices, faces,
    footholds: result.footholds.map(p => bindPoint(p, restKnots, landings, settings.clearance)),
    spawnpoints: result.spawnpoints.map(({ index, active, team, x, y }) => ({ index, active, team, x, y })),
  };
}

export function tunnelTrialRoute(project: TunnelProject) {
  const current = (p: BoundVertex, floor: boolean) => position(p, project.restKnots, project.knots, project.sections, project.axis, floor, project.landings);
  return {
    centerline: project.axis.map(p => current(p, false)),
    footholds: (project.footholds ?? []).map(p => current(p, true)),
    spawnpoints: project.spawnpoints?.map(s => ({ ...s })),
  };
}

// EditorDocument replaces the polygon array on every edit. A slider may preview dozens of
// variants against that same immutable snapshot. Verify the affected records again at apply time.
const indicesBySnapshot = new WeakMap<readonly PmsPolygon[], { count: number; indices: Map<string, number> }>();
function indexPolygons(polygons: readonly PmsPolygon[]) {
  const previous = indicesBySnapshot.get(polygons);
  if (previous && previous.count === polygons.length) return previous.indices;
  const indices = new Map<string, number>();
  polygons.forEach((p, i) => {
    const key = polygonKey(p);
    indices.set(key, indices.has(key) ? -1 : i); // Ambiguous owners may never be rebuilt.
  });
  indicesBySnapshot.set(polygons, { count: polygons.length, indices });
  return indices;
}

function vertexWeight(p: BoundVertex, k: number) {
  return p.weights.find(([index]) => index === k);
}

function terrainPoint(project: TunnelProject, id: number, knots = project.knots, sections = project.sections): Point {
  const v = project.vertices[id];
  const p = position(v,project.restKnots,knots,sections,project.axis,true,project.landings);
  for (const [owner,,,fixedWidth] of v.weights) {
    const amount = fixedWidth ?? sections[owner-1].widthOffset ?? 0;
    if (!amount) continue;
    const delta = meshWidthCorrections(project.vertices,project.faces,project.axis,owner).get(id);
    if (delta) { p.x += amount*delta.x; p.y += amount*delta.y; }
  }
  return p;
}

export function tunnelSectionPolygonIndices(map: PmsMapData, project: TunnelProject, knotIndex: number): number[] {
  const indices = indexPolygons(map.polygons);
  const selected: number[] = [];
  for (const face of project.faces) {
    if (face.landing !== knotIndex && !face.v.some(id => vertexWeight(project.vertices[id], knotIndex))) continue;
    const index = indices.get(face.key);
    if (index !== undefined && index >= 0) selected.push(index);
  }
  return selected;
}

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const integer = (v: unknown, lo: number, hi: number): v is number => finite(v, lo, hi) && Number.isInteger(v);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validBounce = (v: unknown): v is number | null => v === null || v === 0 || finite(v, 0.1, 4);
const validWidth = (v: unknown): v is number => finite(v, TUNNEL_WIDTH_OFFSET_RANGE.min, TUNNEL_WIDTH_OFFSET_RANGE.max);

export function isTunnelProject(value: unknown): value is TunnelProject {
  if (!isObject(value) || value.version !== 1 || typeof value.id !== 'string' || !value.id.length || value.id.length > 100 ||
    (value.method !== 'auto' && value.method !== 'draw') || !isTunnelSettings(value.settings) ||
    (value.pace !== undefined && !isPaceSettings(value.pace))) return false;
  const points = (v: unknown, min: number, max: number): v is Point[] =>
    Array.isArray(v) && v.length >= min && v.length <= max && v.every(isTunnelPoint);
  const { knots, restKnots, vertices, axis, faces, sections, landings } = value;
  if (!points(knots, 3, 800) || !points(restKnots, knots.length, knots.length) ||
    !points(value.sourcePath, 2, 24000) || !points(landings, knots.length - 2, knots.length - 2) ||
    !Array.isArray(sections) || sections.length !== knots.length - 2 ||
    !sections.every(s => isObject(s) && finite(s.landingHeight, -30, 30) && validBounce(s.bounce) &&
      (s.widthOffset === undefined || validWidth(s.widthOffset)) && (s.landingReach === undefined || finite(s.landingReach,0,24)))) return false;
  const validVertex = (v: unknown) => {
    if (!isObject(v) || !isTunnelPoint(v) || !Array.isArray(v.weights) || v.weights.length > knots.length - 2) return false;
    let prev = 0;
    return v.weights.every(w => {
      if (!Array.isArray(w) || (w.length !== 3 && !((w.length === 5 || w.length === 6 && finite(w[5],0,24)) && validWidth(w[3]) && finite(w[4], -30, 30))) ||
        !integer(w[0], prev + 1, knots.length - 2) || !finite(w[1], 0, 1) || !finite(w[2], 0, 1)) return false;
      prev = w[0]; return true;
    });
  };
  if (value.footholds !== undefined && (!Array.isArray(value.footholds) || value.footholds.length > 5000 || !value.footholds.every(validVertex))) return false;
  if (value.spawnpoints !== undefined && (!Array.isArray(value.spawnpoints) || value.spawnpoints.length !== 3 ||
    !value.spawnpoints.every((s, i) => isObject(s) && isTunnelPoint(s) && s.index === i && s.active === true && s.team === [1, 5, 6][i]))) return false;
  if (!Array.isArray(vertices) || !vertices.length || vertices.length > 15000 || !vertices.every(validVertex) ||
    !Array.isArray(axis) || axis.length < 2 || axis.length > 1000 || !axis.every(validVertex) ||
    !Array.isArray(faces) || !faces.length || faces.length > 5000) return false;
  return faces.every(f => isObject(f) && typeof f.key === 'string' && /^[A-Za-z0-9+/]{162}==$/.test(f.key) &&
    Array.isArray(f.v) && f.v.length === 3 && f.v.every(i => integer(i, 0, vertices.length - 1)) &&
    integer(f.type, 0, 255) && finite(f.rebound, 0, Number.MAX_VALUE) && integer(f.landing, 0, knots.length - 2) &&
    (f.pinnedLanding === undefined || typeof f.pinnedLanding === 'boolean'));
}

export function rebuildTunnelSection(map: PmsMapData, project: TunnelProject, knotIndex: number, change: TunnelSectionChange): TunnelSectionResult {
  if (!integer(knotIndex, 1, project.knots.length - 2)) return { ok: false, reason: 'invalid' };
  const k = knotIndex, oldPoint = project.knots[k], old = project.sections[k - 1];
  let acceptsVertex: ((p: Point) => boolean) | undefined;
  if (change.pinGates) {
    if (change.point && (change.point.x !== oldPoint.x || change.point.y !== oldPoint.y)) return {ok:false,reason:'invalid'};
    const pinned = pinTunnelSection(project,k,map.polygons,indexPolygons(map.polygons),id=>terrainPoint(project,id));
    if (!pinned) return {ok:false,reason:'manual'};
    project = pinned.project;
    acceptsVertex = pinned.inside;
  }
  const point = change.point ?? oldPoint;
  const widthOffset = change.widthOffset === undefined ? old.widthOffset ?? 0 : change.widthOffset;
  const landingReach = change.landingReach ?? old.landingReach ?? 0;
  if (!finite(landingReach,0,24)) return {ok:false,reason:'invalid'};
  const reach = landingReach !== (old.landingReach ?? 0);
  const next = { landingHeight: change.landingHeight ?? old.landingHeight, bounce: change.bounce === undefined ? old.bounce : change.bounce,
    widthOffset, ...(landingReach ? {landingReach} : {}) };
  if (!isTunnelPoint(point) || !finite(next.landingHeight, -30, 30) || !validBounce(next.bounce) || !validWidth(widthOffset)) return { ok: false, reason: 'invalid' };
  const bend = point.x !== oldPoint.x || point.y !== oldPoint.y;
  const lift = next.landingHeight !== old.landingHeight;
  const material = next.bounce !== old.bounce;
  const width = widthOffset !== (old.widthOffset ?? 0);
  if (!bend && !lift && !material && !width && !reach) return { ok: false, reason: 'unchanged' };
  if (dist(point, project.restKnots[k]) > 0.8 * Math.min(dist(project.restKnots[k], project.restKnots[k - 1]), dist(project.restKnots[k], project.restKnots[k + 1]))) {
    return { ok: false, reason: 'clearance' };
  }
  const knots = project.knots.slice(), sections = project.sections.slice();
  knots[k] = { ...point }; sections[k - 1] = next;
  const moved = new Map<number, Point>();
  if (bend || lift || width || reach) project.vertices.forEach((v, id) => {
    const w = vertexWeight(v, k);
    if (!w || !(bend && w[1] > 0 || w.length === 3 && (width && w[1] > 0 || (lift || reach) && w[2] > 0))) return;
    moved.set(id,terrainPoint(project,id,knots,sections));
  });
  const current = indexPolygons(map.polygons);
  const polygons = map.polygons.slice(), faces = project.faces.slice(), changedIndices: number[] = [];
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const repaint = material && face.landing === k && !face.pinnedLanding;
    if (!repaint && !face.v.some(id => moved.has(id))) continue;
    const index = current.get(face.key);
    if (index === undefined || index < 0) return { ok: false, reason: 'manual' };
    const poly = map.polygons[index];
    if (polygonKey(poly) !== face.key) return { ok: false, reason: 'manual' };
    const vertices = face.v.map((id, j) => {
      const p = moved.get(id);
      return p ? { ...poly.vertices[j], ...p } : poly.vertices[j];
    }) as Triple<PmsVertex>;
    const savedPoints = vertices.map(v=>({x:Math.fround(v.x), y:Math.fround(v.y)})) as Triple<Point>;
    if (polygonSignedArea2(...vertices) <= 0.002 || polygonSignedArea2(...savedPoints) <= 0.002) {
      return { ok: false, reason: 'clearance' };
    }
    let polyType = poly.polyType, bounciness = poly.bounciness;
    if (repaint) {
      if (next.bounce === null) {
        polyType = face.type;
        bounciness = face.rebound;
      } else {
        polyType = next.bounce > 0 ? 18 : 0;
        bounciness = next.bounce || 1;
      }
    }
    const updated = rebuildPolygonGeometry({ ...poly, vertices, polyType, bounciness });
    const key = polygonKey(updated);
    if (key === face.key) continue;
    if (acceptsVertex && !savedPoints.every(acceptsVertex)) return {ok:false,reason:'clearance'};
    polygons[index] = updated;
    faces[i] = { ...face, key };
    changedIndices.push(index);
  }
  if (!changedIndices.length) return { ok: false, reason: 'unchanged' };
  if (width) {
    const neighbours = (map.editorTunnels ?? []).filter(other=>other.id !== project.id)
      .map(other=>other.axis.map(p=>position(p,other.restKnots,other.knots,other.sections,other.axis,false)));
    const changedSolids = changedIndices.map(i=>polygons[i]).filter(p=>doesPolyCollideSoldier(p.polyType,1,false));
    if (neighbours.some(path=>!hasTunnelClearance(path,changedSolids,7))) return {ok:false, reason:'neighbour'};
    const line = project.axis.map(p=>position(p,project.restKnots,knots,sections,project.axis,false));
    const dividers = neighbouringDividers(project.axis,line,k,neighbours,project.settings.clearance*1.65 + TUNNEL_WIDTH_OFFSET_RANGE.max/2);
    if (!wideningKeepsWalls(dividers,map.polygons,polygons)) return {ok:false, reason:'neighbour'};
  }
  if (bend || lift || width || reach) {
    if (!clearPassage(polygons, map.colliders, project, knots, sections, k)) return { ok: false, reason: 'clearance' };
    const markers = [...map.spawnpoints, ...(project.spawnpoints ?? [])].filter(s => s.active);
    if (changedIndices.some(i => markers.some(s =>
      pointInTriInclusive(s.x, s.y, ...polygons[i].vertices) && !pointInTriInclusive(s.x, s.y, ...map.polygons[i].vertices)))) {
      return { ok: false, reason: 'clearance' };
    }
  }
  const nextMap = { ...map, polygons };
  return {
    ok: true, map: { ...nextMap, ...computeMapBounds(nextMap) }, project: { ...project, knots, sections, faces },
    changedPolygons: changedIndices.length, changedIndices
  };
}

function clearPassage(
  polygons: readonly PmsPolygon[], colliders: PmsMapData['colliders'], project: TunnelProject,
  knots: Point[], sections: SectionProperties[], k: number
) {
  const line = project.axis.map(p => position(p, project.restKnots, knots, sections, project.axis, false));
  const support = project.axis.map(p => !!vertexWeight(p, k));
  const solid = polygons.filter(p => doesPolyCollideSoldier(p.polyType, 1, false));
  const radius = 7;
  let patch: Point[] = [];
  for (let i = 1; i < line.length; i++) {
    if (!support[i - 1] && !support[i]) {
      if (patch.length && !hasTunnelClearance(patch, solid, radius)) return false;
      patch = [];
      continue;
    }
    const a = line[i - 1], b = line[i];
    if (!patch.length) patch.push(a);
    patch.push(b);
    for (let j = 1; j < line.length; j++) {
      if (Math.abs(j - i) <= 1) continue;
      const c = line[j - 1], d = line[j];
      if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return false;
    }
    for (const c of colliders) {
      if (!c.active) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.min(1, Math.max(0, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) < radius + c.radius / 2) return false;
    }
  }
  return !patch.length || hasTunnelClearance(patch, solid, radius);
}
