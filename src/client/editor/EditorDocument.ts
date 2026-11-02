import { EditorPrefabElementBundle } from '@shared/apiTypes';
import {
  computeMapBounds,
  createPolygonFromPoints,
  hasInwardNormals,
  ensureSceneryEntry,
  rebuildPolygonGeometry,
  reindexWaypointsAfterDelete,
} from '@shared/pmsCompiler';
import {
  computePropAabb,
  computePropCorners,
  isPropRenderable,
  makeEditedMapName,
  PmsBounds,
  PmsCollider,
  PmsMapData,
  PmsPolygon,
  PmsProp,
  PmsSpawnpoint,
  PmsVertex,
  PmsWaypoint,
} from '@shared/pmsParser';
import { RgbaColor } from '@shared/soldatConstants';
import {
  EditorSelection,
  EditorVertexRef,
  GizmoHandleKind,
  SelectionSummary,
} from './types';

export interface EditorHistoryEntry {
  id: number;
  label: string;
  timestamp: number;
  transactionId?: string;
  beforeMap: PmsMapData;
  afterMap: PmsMapData;
  beforeSelection: EditorSelection;
  afterSelection: EditorSelection;
}

export interface EditorDocumentSnapshot {
  draftId: string;
  sourceMapId: string | null;
  sourceBaseName: string | null;
  currentBaseName: string;
  hasSavedOnce: boolean;
  map: PmsMapData;
  savedMap: PmsMapData;
  selection: EditorSelection;
  undoStack: EditorHistoryEntry[];
  redoStack: EditorHistoryEntry[];
  revision: number;
}

// A transaction (drag, slider, repeated key) continues the previous undo step only within this pause
const TRANSACTION_MERGE_WINDOW_MS = 2000;

export function emptySelection(): EditorSelection {
  return {
    polygons: [],
    vertices: [],
    props: [],
    spawns: [],
    colliders: [],
    waypoints: [],
  };
}

export function cloneSelection(sel: EditorSelection): EditorSelection {
  return {
    polygons: [...sel.polygons],
    vertices: sel.vertices.map((v) => ({ ...v })),
    props: [...sel.props],
    spawns: [...sel.spawns],
    colliders: [...sel.colliders],
    waypoints: [...sel.waypoints],
  };
}

function sameNumbers(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function selectionsEqual(a: EditorSelection, b: EditorSelection): boolean {
  if (a === b) return true;
  if (
    !sameNumbers(a.polygons, b.polygons) ||
    !sameNumbers(a.props, b.props) ||
    !sameNumbers(a.spawns, b.spawns) ||
    !sameNumbers(a.colliders, b.colliders) ||
    !sameNumbers(a.waypoints, b.waypoints) ||
    a.vertices.length !== b.vertices.length
  ) {
    return false;
  }
  for (let i = 0; i < a.vertices.length; i++) {
    if (a.vertices[i].polyIndex !== b.vertices[i].polyIndex || a.vertices[i].vertexIndex !== b.vertices[i].vertexIndex) {
      return false;
    }
  }
  return true;
}

export function isSelectionEmpty(sel: EditorSelection): boolean {
  return (
    sel.polygons.length === 0 &&
    sel.vertices.length === 0 &&
    sel.props.length === 0 &&
    sel.spawns.length === 0 &&
    sel.colliders.length === 0 &&
    sel.waypoints.length === 0
  );
}

export function countSelectedObjects(sel: EditorSelection): number {
  return (
    sel.polygons.length +
    sel.props.length +
    sel.spawns.length +
    sel.colliders.length +
    sel.waypoints.length
  );
}

export function dedupeSortedIndices(indices: Iterable<number>, maxExclusive: number): number[] {
  const set = new Set<number>();
  for (const idx of indices) {
    if (Number.isInteger(idx) && idx >= 0 && idx < maxExclusive) {
      set.add(idx);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function sanitizeSelectionForMap(sel: EditorSelection, map: PmsMapData): EditorSelection {
  const polySet = new Set<string>();
  const vertices: EditorVertexRef[] = [];
  for (const v of sel.vertices) {
    if (
      v.polyIndex >= 0 &&
      v.polyIndex < map.polygons.length &&
      (v.vertexIndex === 0 || v.vertexIndex === 1 || v.vertexIndex === 2)
    ) {
      const key = `${v.polyIndex}:${v.vertexIndex}`;
      if (!polySet.has(key)) {
        polySet.add(key);
        vertices.push({ polyIndex: v.polyIndex, vertexIndex: v.vertexIndex });
      }
    }
  }
  return {
    polygons: dedupeSortedIndices(sel.polygons, map.polygons.length),
    vertices,
    props: dedupeSortedIndices(sel.props, map.props.length),
    spawns: dedupeSortedIndices(sel.spawns, map.spawnpoints.length),
    colliders: dedupeSortedIndices(sel.colliders, map.colliders.length),
    waypoints: dedupeSortedIndices(sel.waypoints, map.waypoints.length),
  };
}

export function computePropQuadCenter(p: PmsProp): { x: number; y: number } {
  const w = p.width !== 0 ? p.width : 64;
  const h = p.height !== 0 ? p.height : 64;
  const c = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
  return {
    x: (c[0] + c[4]) * 0.5,
    y: (c[1] + c[5]) * 0.5,
  };
}

export function computeSelectionSummary(map: PmsMapData, sel: EditorSelection): SelectionSummary {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const includePt = (x: number, y: number, r = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x - r < left) left = x - r;
    if (x + r > right) right = x + r;
    if (y - r < top) top = y - r;
    if (y + r > bottom) bottom = y + r;
  };

  for (const idx of sel.polygons) {
    const poly = map.polygons[idx];
    if (!poly) continue;
    for (const v of poly.vertices) includePt(v.x, v.y);
  }
  for (const vr of sel.vertices) {
    const v = map.polygons[vr.polyIndex]?.vertices[vr.vertexIndex];
    if (v) includePt(v.x, v.y);
  }
  for (const idx of sel.props) {
    const p = map.props[idx];
    if (!p) continue;
    const aabb = computePropAabb(p);
    includePt(aabb.left, aabb.top);
    includePt(aabb.right, aabb.bottom);
  }
  for (const idx of sel.spawns) {
    const sp = map.spawnpoints[idx];
    if (sp) includePt(sp.x, sp.y, 8);
  }
  for (const idx of sel.colliders) {
    const col = map.colliders[idx];
    if (col) includePt(col.x, col.y, Math.max(4, Math.abs(col.radius) * 0.5));
  }
  for (const idx of sel.waypoints) {
    const wp = map.waypoints[idx];
    if (wp) includePt(wp.x, wp.y, 6);
  }

  const bounds: PmsBounds | null = Number.isFinite(left)
    ? {
        left,
        right,
        top,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      }
    : null;

  return {
    totalObjects: countSelectedObjects(sel),
    vertexCount: sel.vertices.length,
    bounds,
  };
}

/**
 * Exact box of the selected objects: polygon corners, scenery quads and the points of spawns, colliders and
 * waypoints (the summary pads those for drawing). A single point gives a zero-size box.
 */
export function computeSelectionExactBounds(map: PmsMapData, sel: EditorSelection): PmsBounds | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  for (const i of sel.polygons) map.polygons[i]?.vertices.forEach((v) => add(v.x, v.y));
  for (const vr of sel.vertices) {
    const v = map.polygons[vr.polyIndex]?.vertices[vr.vertexIndex];
    if (v) add(v.x, v.y);
  }
  for (const i of sel.props) {
    const p = map.props[i];
    if (!p) continue;
    const b = computePropAabb(p);
    add(b.left, b.top);
    add(b.right, b.bottom);
  }
  for (const i of sel.spawns) if (map.spawnpoints[i]) add(map.spawnpoints[i].x, map.spawnpoints[i].y);
  for (const i of sel.colliders) if (map.colliders[i]) add(map.colliders[i].x, map.colliders[i].y);
  for (const i of sel.waypoints) if (map.waypoints[i]) add(map.waypoints[i].x, map.waypoints[i].y);
  if (!Number.isFinite(left)) return null;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/**
 * Collects every vertex `(polyIdx, vIdx)` affected by a selection, expanding to shared welded vertices if requested.
 */
function collectTargetPolygonVertices(
  map: PmsMapData,
  sel: EditorSelection,
  weldSharedVertices: boolean
): Map<number, Set<0 | 1 | 2>> {
  const targets = new Map<number, Set<0 | 1 | 2>>();
  const addRef = (pi: number, vi: 0 | 1 | 2) => {
    let set = targets.get(pi);
    if (!set) {
      set = new Set();
      targets.set(pi, set);
    }
    set.add(vi);
  };

  for (const pi of sel.polygons) {
    if (pi >= 0 && pi < map.polygons.length) {
      addRef(pi, 0);
      addRef(pi, 1);
      addRef(pi, 2);
    }
  }
  for (const vr of sel.vertices) {
    if (vr.polyIndex >= 0 && vr.polyIndex < map.polygons.length) {
      addRef(vr.polyIndex, vr.vertexIndex);
    }
  }

  // Only expand welded coincident vertices when moving individual vertices (not whole-polygon moves unless in vertex mode)
  if (weldSharedVertices && sel.vertices.length > 0 && sel.polygons.length === 0) {
    const coordKeys = new Set<string>();
    for (const vr of sel.vertices) {
      const v = map.polygons[vr.polyIndex]?.vertices[vr.vertexIndex];
      if (v) coordKeys.add(`${Math.round(v.x * 20)},${Math.round(v.y * 20)}`);
    }
    if (coordKeys.size > 0) {
      for (let pi = 0; pi < map.polygons.length; pi++) {
        const vs = map.polygons[pi].vertices;
        for (let vi = 0 as 0 | 1 | 2; vi < 3; vi = (vi + 1) as 0 | 1 | 2) {
          const key = `${Math.round(vs[vi].x * 20)},${Math.round(vs[vi].y * 20)}`;
          if (coordKeys.has(key)) addRef(pi, vi);
        }
      }
    }
  }

  return targets;
}

function withUpdatedBounds(map: PmsMapData): PmsMapData {
  const b = computeMapBounds(map);
  return {
    ...map,
    polyBounds: b.polyBounds,
    fullBounds: b.fullBounds,
  };
}

// Transforms rebuild normals but keep each triangle's vertex order, so vertex selections keep pointing at the same
// corners; the normals point inward for either winding (computePolygonNormals), which is what collision needs.
export function translateSelection(
  map: PmsMapData,
  sel: EditorSelection,
  dx: number,
  dy: number,
  options?: { weldSharedVertices?: boolean; worldAlignedUv?: boolean; texWidth?: number; texHeight?: number }
): PmsMapData {
  if ((!Number.isFinite(dx) && !Number.isFinite(dy)) || (Math.abs(dx) < 1e-7 && Math.abs(dy) < 1e-7)) {
    return map;
  }

  let nextPolygons = map.polygons;
  const polyTargets = collectTargetPolygonVertices(map, sel, Boolean(options?.weldSharedVertices));
  if (polyTargets.size > 0) {
    nextPolygons = [...map.polygons];
    const tw = Math.max(1, options?.texWidth ?? 128);
    const th = Math.max(1, options?.texHeight ?? 128);
    for (const [pi, vSet] of polyTargets.entries()) {
      const orig = map.polygons[pi];
      const nextVerts = orig.vertices.map((v, vi) => {
        if (!vSet.has(vi as 0 | 1 | 2)) return v;
        const nx = v.x + dx;
        const ny = v.y + dy;
        return {
          ...v,
          x: nx,
          y: ny,
          u: options?.worldAlignedUv ? nx / tw : v.u + (vSet.size < 3 ? dx / tw : 0),
          v: options?.worldAlignedUv ? ny / th : v.v + (vSet.size < 3 ? dy / th : 0),
        };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      nextPolygons[pi] = rebuildPolygonGeometry(
        { ...orig, vertices: nextVerts, raw: undefined },
        { enforceCw: false }
      );
    }
  }

  let nextProps = map.props;
  if (sel.props.length > 0) {
    nextProps = [...map.props];
    for (const idx of sel.props) {
      const p = map.props[idx];
      if (!p) continue;
      const { raw: _raw, ...rest } = p;
      nextProps[idx] = { ...rest, x: p.x + dx, y: p.y + dy };
    }
  }

  let nextSpawns = map.spawnpoints;
  if (sel.spawns.length > 0) {
    nextSpawns = [...map.spawnpoints];
    for (const idx of sel.spawns) {
      const sp = map.spawnpoints[idx];
      if (!sp) continue;
      const { raw: _raw, ...rest } = sp;
      nextSpawns[idx] = { ...rest, x: Math.round(sp.x + dx), y: Math.round(sp.y + dy) };
    }
  }

  let nextColliders = map.colliders;
  if (sel.colliders.length > 0) {
    nextColliders = [...map.colliders];
    for (const idx of sel.colliders) {
      const col = map.colliders[idx];
      if (!col) continue;
      const { raw: _raw, ...rest } = col;
      nextColliders[idx] = { ...rest, x: col.x + dx, y: col.y + dy };
    }
  }

  let nextWaypoints = map.waypoints;
  if (sel.waypoints.length > 0) {
    nextWaypoints = [...map.waypoints];
    for (const idx of sel.waypoints) {
      const wp = map.waypoints[idx];
      if (!wp) continue;
      const { raw: _raw, ...rest } = wp;
      nextWaypoints[idx] = { ...rest, x: Math.round(wp.x + dx), y: Math.round(wp.y + dy) };
    }
  }

  return withUpdatedBounds({
    ...map,
    polygons: nextPolygons,
    props: nextProps,
    spawnpoints: nextSpawns,
    colliders: nextColliders,
    waypoints: nextWaypoints,
  });
}

export function rotateSelection(
  map: PmsMapData,
  sel: EditorSelection,
  deltaRad: number,
  pivotX: number,
  pivotY: number,
  options?: { weldSharedVertices?: boolean }
): PmsMapData {
  if (!Number.isFinite(deltaRad) || Math.abs(deltaRad) < 1e-7) return map;
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  const rotPt = (x: number, y: number) => ({
    x: pivotX + (x - pivotX) * cos - (y - pivotY) * sin,
    y: pivotY + (x - pivotX) * sin + (y - pivotY) * cos,
  });

  let nextPolygons = map.polygons;
  const polyTargets = collectTargetPolygonVertices(map, sel, Boolean(options?.weldSharedVertices));
  if (polyTargets.size > 0) {
    nextPolygons = [...map.polygons];
    for (const [pi, vSet] of polyTargets.entries()) {
      const orig = map.polygons[pi];
      const nextVerts = orig.vertices.map((v, vi) => {
        if (!vSet.has(vi as 0 | 1 | 2)) return v;
        const rp = rotPt(v.x, v.y);
        return { ...v, x: rp.x, y: rp.y };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      nextPolygons[pi] = rebuildPolygonGeometry(
        { ...orig, vertices: nextVerts, raw: undefined },
        { enforceCw: false }
      );
    }
  }

  let nextProps = map.props;
  if (sel.props.length > 0) {
    nextProps = [...map.props];
    for (const idx of sel.props) {
      const p = map.props[idx];
      if (!p) continue;
      // Rotate the prop's visual quad centre around (pivotX, pivotY) and adjust PMS rotation (-deltaRad)
      const oldCenter = computePropQuadCenter(p);
      const targetCenter = rotPt(oldCenter.x, oldCenter.y);
      const newRotation = p.rotation - deltaRad;
      const { raw: _raw, ...rest } = p;
      const tempProp: PmsProp = { ...rest, rotation: newRotation };
      const tempCenter = computePropQuadCenter(tempProp);
      nextProps[idx] = {
        ...tempProp,
        x: p.x + (targetCenter.x - tempCenter.x),
        y: p.y + (targetCenter.y - tempCenter.y),
      };
    }
  }

  let nextSpawns = map.spawnpoints;
  if (sel.spawns.length > 0) {
    nextSpawns = [...map.spawnpoints];
    for (const idx of sel.spawns) {
      const sp = map.spawnpoints[idx];
      if (!sp) continue;
      const rp = rotPt(sp.x, sp.y);
      const { raw: _raw, ...rest } = sp;
      nextSpawns[idx] = { ...rest, x: Math.round(rp.x), y: Math.round(rp.y) };
    }
  }

  let nextColliders = map.colliders;
  if (sel.colliders.length > 0) {
    nextColliders = [...map.colliders];
    for (const idx of sel.colliders) {
      const col = map.colliders[idx];
      if (!col) continue;
      const rp = rotPt(col.x, col.y);
      const { raw: _raw, ...rest } = col;
      nextColliders[idx] = { ...rest, x: rp.x, y: rp.y };
    }
  }

  let nextWaypoints = map.waypoints;
  if (sel.waypoints.length > 0) {
    nextWaypoints = [...map.waypoints];
    for (const idx of sel.waypoints) {
      const wp = map.waypoints[idx];
      if (!wp) continue;
      const rp = rotPt(wp.x, wp.y);
      const { raw: _raw, ...rest } = wp;
      nextWaypoints[idx] = { ...rest, x: Math.round(rp.x), y: Math.round(rp.y) };
    }
  }

  return withUpdatedBounds({
    ...map,
    polygons: nextPolygons,
    props: nextProps,
    spawnpoints: nextSpawns,
    colliders: nextColliders,
    waypoints: nextWaypoints,
  });
}

export function scaleSelection(
  map: PmsMapData,
  sel: EditorSelection,
  sx: number,
  sy: number,
  pivotX: number,
  pivotY: number,
  options?: { weldSharedVertices?: boolean }
): PmsMapData {
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return map;
  const clampScale = (s: number) => (Math.abs(s) < 0.01 ? (s < 0 ? -0.01 : 0.01) : s);
  const csx = clampScale(sx);
  const csy = clampScale(sy);
  const scalePt = (x: number, y: number) => ({
    x: pivotX + (x - pivotX) * csx,
    y: pivotY + (y - pivotY) * csy,
  });

  let nextPolygons = map.polygons;
  const polyTargets = collectTargetPolygonVertices(map, sel, Boolean(options?.weldSharedVertices));
  if (polyTargets.size > 0) {
    nextPolygons = [...map.polygons];
    for (const [pi, vSet] of polyTargets.entries()) {
      const orig = map.polygons[pi];
      const nextVerts = orig.vertices.map((v, vi) => {
        if (!vSet.has(vi as 0 | 1 | 2)) return v;
        const sp = scalePt(v.x, v.y);
        return { ...v, x: sp.x, y: sp.y };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      nextPolygons[pi] = rebuildPolygonGeometry(
        { ...orig, vertices: nextVerts, raw: undefined },
        { enforceCw: false }
      );
    }
  }

  let nextProps = map.props;
  if (sel.props.length > 0) {
    nextProps = [...map.props];
    for (const idx of sel.props) {
      const p = map.props[idx];
      if (!p) continue;
      const oldCenter = computePropQuadCenter(p);
      const targetCenter = scalePt(oldCenter.x, oldCenter.y);
      const { raw: _raw, ...rest } = p;
      const tempProp: PmsProp = {
        ...rest,
        scaleX: p.scaleX * csx,
        scaleY: p.scaleY * csy,
      };
      const tempCenter = computePropQuadCenter(tempProp);
      nextProps[idx] = {
        ...tempProp,
        x: p.x + (targetCenter.x - tempCenter.x),
        y: p.y + (targetCenter.y - tempCenter.y),
      };
    }
  }

  let nextSpawns = map.spawnpoints;
  if (sel.spawns.length > 0) {
    nextSpawns = [...map.spawnpoints];
    for (const idx of sel.spawns) {
      const sp = map.spawnpoints[idx];
      if (!sp) continue;
      const pt = scalePt(sp.x, sp.y);
      const { raw: _raw, ...rest } = sp;
      nextSpawns[idx] = { ...rest, x: Math.round(pt.x), y: Math.round(pt.y) };
    }
  }

  let nextColliders = map.colliders;
  if (sel.colliders.length > 0) {
    nextColliders = [...map.colliders];
    const radialScale = (Math.abs(csx) + Math.abs(csy)) * 0.5;
    for (const idx of sel.colliders) {
      const col = map.colliders[idx];
      if (!col) continue;
      const pt = scalePt(col.x, col.y);
      const { raw: _raw, ...rest } = col;
      nextColliders[idx] = {
        ...rest,
        x: pt.x,
        y: pt.y,
        radius: Math.max(2, col.radius * radialScale),
      };
    }
  }

  let nextWaypoints = map.waypoints;
  if (sel.waypoints.length > 0) {
    nextWaypoints = [...map.waypoints];
    for (const idx of sel.waypoints) {
      const wp = map.waypoints[idx];
      if (!wp) continue;
      const pt = scalePt(wp.x, wp.y);
      const { raw: _raw, ...rest } = wp;
      nextWaypoints[idx] = { ...rest, x: Math.round(pt.x), y: Math.round(pt.y) };
    }
  }

  return withUpdatedBounds({
    ...map,
    polygons: nextPolygons,
    props: nextProps,
    spawnpoints: nextSpawns,
    colliders: nextColliders,
    waypoints: nextWaypoints,
  });
}

/**
 * Stretches/scales a single scenery prop along its own rotated local quad axes (`computePropCorners`)
 * while keeping the opposite edge/corner anchored cleanly in world space.
 */
export function stretchSinglePropLocal(
  prop: PmsProp,
  handle: GizmoHandleKind,
  worldX: number,
  worldY: number,
  uniformAspect = false
): PmsProp {
  const w = prop.width !== 0 ? prop.width : 64;
  const h = prop.height !== 0 ? prop.height : 64;
  const c = computePropCorners(prop.x, prop.y, w, h, prop.scaleX, prop.scaleY, prop.rotation);

  const ptAt = (corners: number[], u: number, v: number) => {
    const topX = corners[0] + (corners[2] - corners[0]) * u;
    const topY = corners[1] + (corners[3] - corners[1]) * u;
    const botX = corners[6] + (corners[4] - corners[6]) * u;
    const botY = corners[7] + (corners[5] - corners[7]) * u;
    return {
      x: topX + (botX - topX) * v,
      y: topY + (botY - topY) * v,
    };
  };

  // Only the compass part of the handle name counts ("scale_se" itself contains both "s" and "e")
  const dir = handle.startsWith('scale_') ? handle.slice(6) : '';
  const east = dir.includes('e');
  const west = dir.includes('w');
  const south = dir.includes('s');
  const north = dir.includes('n');

  let anchorU = 0.5;
  let anchorV = 0.5;
  if (east) anchorU = 0;
  else if (west) anchorU = 1;
  if (south) anchorV = 0;
  else if (north) anchorV = 1;

  const anchor = ptAt(c, anchorU, anchorV);
  const r = -prop.rotation;
  const ux = Math.cos(r);
  const uy = Math.sin(r);
  const vx = -Math.sin(r);
  const vy = Math.cos(r);

  const dx = worldX - anchor.x;
  const dy = worldY - anchor.y;
  const projU = dx * ux + dy * uy;
  const projV = dx * vx + dy * vy;

  const clampScale = (s: number) => (Math.abs(s) < 0.02 ? (s < 0 ? -0.02 : 0.02) : s);
  let nextScaleX = prop.scaleX;
  let nextScaleY = prop.scaleY;

  // The handle sits on the quad side it scales (u = 1 for east), so a flipped prop keeps its sign naturally
  if (east) {
    nextScaleX = clampScale(projU / w);
  } else if (west) {
    nextScaleX = clampScale(-projU / w);
  }

  if (south) {
    nextScaleY = clampScale(projV / h);
  } else if (north) {
    nextScaleY = clampScale(-projV / h);
  }

  if (uniformAspect && dir.length === 2) {
    const baseRatio =
      Math.abs(prop.scaleX) > 1e-4 ? Math.abs(prop.scaleY / prop.scaleX) : 1;
    const signY = nextScaleY < 0 ? -1 : 1;
    nextScaleY = clampScale(signY * Math.abs(nextScaleX) * baseRatio);
  }

  const tempCorners = computePropCorners(
    prop.x,
    prop.y,
    w,
    h,
    nextScaleX,
    nextScaleY,
    prop.rotation
  );
  const tempAnchor = ptAt(tempCorners, anchorU, anchorV);
  const { raw: _raw, ...rest } = prop;
  return {
    ...rest,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    x: prop.x + (anchor.x - tempAnchor.x),
    y: prop.y + (anchor.y - tempAnchor.y),
  };
}

export type AlignmentMode = 'left' | 'center_x' | 'right' | 'top' | 'center_y' | 'bottom';

export function alignSelection(
  map: PmsMapData,
  sel: EditorSelection,
  mode: AlignmentMode
): PmsMapData {
  const summary = computeSelectionSummary(map, sel);
  if (!summary.bounds || summary.totalObjects < 2) return map;
  const targetBounds = summary.bounds;
  const targetCx = (targetBounds.left + targetBounds.right) * 0.5;
  const targetCy = (targetBounds.top + targetBounds.bottom) * 0.5;

  const deltaForBox = (l: number, r: number, t: number, b: number): { dx: number; dy: number } => {
    switch (mode) {
      case 'left':
        return { dx: targetBounds.left - l, dy: 0 };
      case 'center_x':
        return { dx: targetCx - (l + r) * 0.5, dy: 0 };
      case 'right':
        return { dx: targetBounds.right - r, dy: 0 };
      case 'top':
        return { dx: 0, dy: targetBounds.top - t };
      case 'center_y':
        return { dx: 0, dy: targetCy - (t + b) * 0.5 };
      case 'bottom':
        return { dx: 0, dy: targetBounds.bottom - b };
    }
  };

  let nextPolygons = map.polygons;
  if (sel.polygons.length > 0) {
    nextPolygons = [...map.polygons];
    for (const idx of sel.polygons) {
      const poly = map.polygons[idx];
      if (!poly) continue;
      const xs = poly.vertices.map((v) => v.x);
      const ys = poly.vertices.map((v) => v.y);
      const { dx, dy } = deltaForBox(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys));
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
      const nextVerts = poly.vertices.map((v) => ({
        ...v,
        x: v.x + dx,
        y: v.y + dy,
      })) as [PmsVertex, PmsVertex, PmsVertex];
      nextPolygons[idx] = rebuildPolygonGeometry({ ...poly, vertices: nextVerts, raw: undefined }, { enforceCw: false });
    }
  }

  let nextProps = map.props;
  if (sel.props.length > 0) {
    nextProps = [...map.props];
    for (const idx of sel.props) {
      const p = map.props[idx];
      if (!p) continue;
      const aabb = computePropAabb(p);
      const { dx, dy } = deltaForBox(aabb.left, aabb.right, aabb.top, aabb.bottom);
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
      const { raw: _raw, ...rest } = p;
      nextProps[idx] = { ...rest, x: p.x + dx, y: p.y + dy };
    }
  }

  let nextSpawns = map.spawnpoints;
  if (sel.spawns.length > 0) {
    nextSpawns = [...map.spawnpoints];
    for (const idx of sel.spawns) {
      const sp = map.spawnpoints[idx];
      if (!sp) continue;
      const { dx, dy } = deltaForBox(sp.x, sp.x, sp.y, sp.y);
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
      const { raw: _raw, ...rest } = sp;
      nextSpawns[idx] = { ...rest, x: Math.round(sp.x + dx), y: Math.round(sp.y + dy) };
    }
  }

  let nextColliders = map.colliders;
  if (sel.colliders.length > 0) {
    nextColliders = [...map.colliders];
    for (const idx of sel.colliders) {
      const col = map.colliders[idx];
      if (!col) continue;
      const r = Math.abs(col.radius) * 0.5;
      const { dx, dy } = deltaForBox(col.x - r, col.x + r, col.y - r, col.y + r);
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
      const { raw: _raw, ...rest } = col;
      nextColliders[idx] = { ...rest, x: col.x + dx, y: col.y + dy };
    }
  }

  let nextWaypoints = map.waypoints;
  if (sel.waypoints.length > 0) {
    nextWaypoints = [...map.waypoints];
    for (const idx of sel.waypoints) {
      const wp = map.waypoints[idx];
      if (!wp) continue;
      const { dx, dy } = deltaForBox(wp.x, wp.x, wp.y, wp.y);
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
      const { raw: _raw, ...rest } = wp;
      nextWaypoints[idx] = { ...rest, x: Math.round(wp.x + dx), y: Math.round(wp.y + dy) };
    }
  }

  return withUpdatedBounds({
    ...map,
    polygons: nextPolygons,
    props: nextProps,
    spawnpoints: nextSpawns,
    colliders: nextColliders,
    waypoints: nextWaypoints,
  });
}

/** Recomputes (inward) normals of the polygons among `indices` whose stored normals point outward */
export function repairPolygonNormals(
  map: PmsMapData,
  indices: ReadonlyArray<number>
): { nextMap: PmsMapData; fixed: number } {
  let nextPolygons: PmsPolygon[] | null = null;
  let fixed = 0;
  for (const pi of indices) {
    const poly = map.polygons[pi];
    if (!poly || hasInwardNormals(poly)) continue;
    nextPolygons ??= [...map.polygons];
    nextPolygons[pi] = rebuildPolygonGeometry({ ...poly, raw: undefined }, { enforceCw: false });
    fixed++;
  }
  return { nextMap: nextPolygons ? { ...map, polygons: nextPolygons } : map, fixed };
}

/** Rewinds the counter-clockwise triangles among `indices` to clockwise (normals rebuilt); returns how many */
export function makePolygonsClockwise(
  map: PmsMapData,
  indices: ReadonlyArray<number>
): { nextMap: PmsMapData; fixed: number } {
  let nextPolygons: PmsPolygon[] | null = null;
  let fixed = 0;
  for (const pi of indices) {
    const poly = map.polygons[pi];
    if (!poly) continue;
    const [a, b, c] = poly.vertices;
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= 0) continue;
    nextPolygons ??= [...map.polygons];
    nextPolygons[pi] = rebuildPolygonGeometry({ ...poly, raw: undefined }, { enforceCw: true });
    fixed++;
  }
  return { nextMap: nextPolygons ? { ...map, polygons: nextPolygons } : map, fixed };
}

export function deleteSelection(map: PmsMapData, sel: EditorSelection): PmsMapData {
  // Deleting selected vertices deletes the owning triangles (a triangle cannot have < 3 vertices)
  const polyDel = new Set<number>(sel.polygons);
  for (const vr of sel.vertices) polyDel.add(vr.polyIndex);

  const nextPolygons =
    polyDel.size > 0 ? map.polygons.filter((_, idx) => !polyDel.has(idx)) : map.polygons;

  const propDel = new Set<number>(sel.props);
  const nextProps =
    propDel.size > 0
      ? map.props.filter((_, idx) => !propDel.has(idx)).map((p, idx) => (p.index === idx ? p : { ...p, index: idx }))
      : map.props;

  const spawnDel = new Set<number>(sel.spawns);
  const nextSpawns =
    spawnDel.size > 0
      ? map.spawnpoints
          .filter((_, idx) => !spawnDel.has(idx))
          .map((sp, idx) => (sp.index === idx ? sp : { ...sp, index: idx }))
      : map.spawnpoints;

  const colDel = new Set<number>(sel.colliders);
  const nextColliders =
    colDel.size > 0
      ? map.colliders
          .filter((_, idx) => !colDel.has(idx))
          .map((col, idx) => (col.index === idx ? col : { ...col, index: idx }))
      : map.colliders;

  const nextWaypoints =
    sel.waypoints.length > 0
      ? reindexWaypointsAfterDelete(map.waypoints, sel.waypoints)
      : map.waypoints;

  return withUpdatedBounds({
    ...map,
    polygons: nextPolygons,
    props: nextProps,
    spawnpoints: nextSpawns,
    colliders: nextColliders,
    waypoints: nextWaypoints,
  });
}

export function extractSelectionBundle(
  map: PmsMapData,
  sel: EditorSelection
): { bundle: EditorPrefabElementBundle; bounds: PmsBounds } | null {
  const summary = computeSelectionSummary(map, sel);
  if (!summary.bounds || summary.totalObjects === 0) return null;

  const polygons = sel.polygons
    .map((idx) => map.polygons[idx])
    .filter(Boolean)
    .map((p) => ({
      vertices: p.vertices.map((v) => ({
        x: v.x,
        y: v.y,
        color: { ...v.color },
        u: v.u,
        v: v.v,
      })),
      polyType: p.polyType,
      bounciness: p.bounciness,
    }));

  const props = sel.props
    .map((idx) => map.props[idx])
    .filter((p): p is PmsProp => Boolean(p && isPropRenderable(p, map.scenery.length)))
    .map((p) => {
      const sc = map.scenery[p.style - 1];
      return {
        sceneryName: sc.filename,
        sceneryDate: sc.date,
        width: p.width,
        height: p.height,
        x: p.x,
        y: p.y,
        rotation: p.rotation,
        scaleX: p.scaleX,
        scaleY: p.scaleY,
        alpha: p.alpha,
        color: { ...p.color },
        level: p.level,
      };
    });

  const spawns = sel.spawns
    .map((idx) => map.spawnpoints[idx])
    .filter(Boolean)
    .map((sp) => ({ x: sp.x, y: sp.y, team: sp.team }));

  const colliders = sel.colliders
    .map((idx) => map.colliders[idx])
    .filter(Boolean)
    .map((col) => ({ x: col.x, y: col.y, radius: col.radius }));

  const wpIdxMap = new Map<number, number>(); // old 1-based -> bundle 0-based
  sel.waypoints.forEach((zeroIdx, relIdx) => {
    const wp = map.waypoints[zeroIdx];
    if (wp) {
      wpIdxMap.set(zeroIdx + 1, relIdx);
      if (wp.id > 0 && !wpIdxMap.has(wp.id)) wpIdxMap.set(wp.id, relIdx);
    }
  });

  const waypoints = sel.waypoints
    .map((idx) => map.waypoints[idx])
    .filter(Boolean)
    .map((wp) => ({
      x: wp.x,
      y: wp.y,
      left: wp.left,
      right: wp.right,
      up: wp.up,
      down: wp.down,
      jetpack: wp.jetpack,
      pathNum: wp.pathNum,
      action: wp.action,
      connections: wp.connections
        .map((c) => wpIdxMap.get(c))
        .filter((rel): rel is number => rel !== undefined),
    }));

  return {
    bounds: summary.bounds,
    bundle: { polygons, props, spawns, colliders, waypoints },
  };
}

export function insertElementBundle(
  map: PmsMapData,
  bundle: EditorPrefabElementBundle,
  sourceBounds: PmsBounds,
  targetCenterX: number,
  targetCenterY: number
): { nextMap: PmsMapData; nextSelection: EditorSelection } {
  const srcCx = (sourceBounds.left + sourceBounds.right) * 0.5;
  const srcCy = (sourceBounds.top + sourceBounds.bottom) * 0.5;
  const dx = targetCenterX - srcCx;
  const dy = targetCenterY - srcCy;

  let nextPolygons = map.polygons;
  const newPolyIndices: number[] = [];
  if (bundle.polygons.length > 0) {
    nextPolygons = [...map.polygons];
    for (const bp of bundle.polygons) {
      if (bp.vertices.length < 3) continue;
      const base = createPolygonFromPoints(
        [
          { x: bp.vertices[0].x + dx, y: bp.vertices[0].y + dy },
          { x: bp.vertices[1].x + dx, y: bp.vertices[1].y + dy },
          { x: bp.vertices[2].x + dx, y: bp.vertices[2].y + dy },
        ],
        { polyType: bp.polyType, bounciness: bp.bounciness }
      );
      const verts = bp.vertices.slice(0, 3).map((v) => ({
        x: v.x + dx,
        y: v.y + dy,
        z: 1,
        rhw: 1,
        color: { ...v.color },
        u: v.u,
        v: v.v,
      })) as [PmsVertex, PmsVertex, PmsVertex];
      const rebuilt = rebuildPolygonGeometry(
        { ...base, vertices: verts, polyType: bp.polyType, bounciness: bp.bounciness },
        { enforceCw: true }
      );
      newPolyIndices.push(nextPolygons.length);
      nextPolygons.push(rebuilt);
    }
  }

  let nextScenery = map.scenery;
  let nextProps = map.props;
  const newPropIndices: number[] = [];
  if (bundle.props.length > 0) {
    nextProps = [...map.props];
    for (const bp of bundle.props) {
      const ensured = ensureSceneryEntry(nextScenery, bp.sceneryName, bp.sceneryDate);
      nextScenery = ensured.scenery;
      const newProp: PmsProp = {
        index: nextProps.length,
        active: true,
        style: ensured.style,
        width: bp.width,
        height: bp.height,
        x: bp.x + dx,
        y: bp.y + dy,
        rotation: bp.rotation,
        scaleX: bp.scaleX,
        scaleY: bp.scaleY,
        alpha: bp.alpha,
        color: { ...bp.color },
        level: bp.level,
      };
      newPropIndices.push(nextProps.length);
      nextProps.push(newProp);
    }
  }

  let nextSpawns = map.spawnpoints;
  const newSpawnIndices: number[] = [];
  if (bundle.spawns.length > 0) {
    nextSpawns = [...map.spawnpoints];
    for (const sp of bundle.spawns) {
      const newSp: PmsSpawnpoint = {
        index: nextSpawns.length,
        active: true,
        x: Math.round(sp.x + dx),
        y: Math.round(sp.y + dy),
        team: sp.team,
      };
      newSpawnIndices.push(nextSpawns.length);
      nextSpawns.push(newSp);
    }
  }

  let nextColliders = map.colliders;
  const newColIndices: number[] = [];
  if (bundle.colliders.length > 0) {
    nextColliders = [...map.colliders];
    for (const col of bundle.colliders) {
      const newCol: PmsCollider = {
        index: nextColliders.length,
        active: true,
        x: col.x + dx,
        y: col.y + dy,
        radius: col.radius,
      };
      newColIndices.push(nextColliders.length);
      nextColliders.push(newCol);
    }
  }

  let nextWaypoints = map.waypoints;
  const newWpIndices: number[] = [];
  if (bundle.waypoints.length > 0) {
    nextWaypoints = [...map.waypoints];
    const baseOneBased = nextWaypoints.length + 1;
    for (let i = 0; i < bundle.waypoints.length; i++) {
      const bw = bundle.waypoints[i];
      const oneBased = baseOneBased + i;
      const newWp: PmsWaypoint = {
        index: oneBased,
        active: true,
        id: oneBased,
        x: Math.round(bw.x + dx),
        y: Math.round(bw.y + dy),
        left: bw.left,
        right: bw.right,
        up: bw.up,
        down: bw.down,
        jetpack: bw.jetpack,
        pathNum: bw.pathNum,
        action: bw.action,
        connections: bw.connections
          .filter((rel) => rel >= 0 && rel < bundle.waypoints.length && rel !== i)
          .map((rel) => baseOneBased + rel)
          .slice(0, 20),
      };
      newWpIndices.push(nextWaypoints.length);
      nextWaypoints.push(newWp);
    }
  }

  return {
    nextMap: withUpdatedBounds({
      ...map,
      polygons: nextPolygons,
      scenery: nextScenery,
      props: nextProps,
      spawnpoints: nextSpawns,
      colliders: nextColliders,
      waypoints: nextWaypoints,
    }),
    nextSelection: {
      polygons: newPolyIndices,
      vertices: [],
      props: newPropIndices,
      spawns: newSpawnIndices,
      colliders: newColIndices,
      waypoints: newWpIndices,
    },
  };
}

export function duplicateSelection(
  map: PmsMapData,
  sel: EditorSelection,
  offsetX = 16,
  offsetY = 16
): { nextMap: PmsMapData; nextSelection: EditorSelection } | null {
  const extracted = extractSelectionBundle(map, sel);
  if (!extracted) return null;
  const cx = (extracted.bounds.left + extracted.bounds.right) * 0.5 + offsetX;
  const cy = (extracted.bounds.top + extracted.bounds.bottom) * 0.5 + offsetY;
  return insertElementBundle(map, extracted.bundle, extracted.bounds, cx, cy);
}

export type PropDrawOrderDirection = 'front' | 'back' | 'forward' | 'backward';

export function reorderSelectedProps(
  map: PmsMapData,
  selectedProps: ReadonlyArray<number>,
  direction: PropDrawOrderDirection
): { nextMap: PmsMapData; nextSelectedProps: number[] } {
  const selSet = new Set(selectedProps.filter((i) => i >= 0 && i < map.props.length));
  if (selSet.size === 0 || map.props.length <= 1) {
    return { nextMap: map, nextSelectedProps: [...selSet] };
  }

  const tagged = map.props.map((prop, origIdx) => ({ prop, selected: selSet.has(origIdx) }));

  if (direction === 'front') {
    const unselected = tagged.filter((t) => !t.selected);
    const selected = tagged.filter((t) => t.selected);
    tagged.splice(0, tagged.length, ...unselected, ...selected);
  } else if (direction === 'back') {
    const selected = tagged.filter((t) => t.selected);
    const unselected = tagged.filter((t) => !t.selected);
    tagged.splice(0, tagged.length, ...selected, ...unselected);
  } else if (direction === 'forward') {
    for (let i = tagged.length - 2; i >= 0; i--) {
      if (tagged[i].selected && !tagged[i + 1].selected) {
        const tmp = tagged[i];
        tagged[i] = tagged[i + 1];
        tagged[i + 1] = tmp;
      }
    }
  } else if (direction === 'backward') {
    for (let i = 1; i < tagged.length; i++) {
      if (tagged[i].selected && !tagged[i - 1].selected) {
        const tmp = tagged[i];
        tagged[i] = tagged[i - 1];
        tagged[i - 1] = tmp;
      }
    }
  }

  const nextSelectedProps: number[] = [];
  const nextProps = tagged.map((item, idx) => {
    if (item.selected) nextSelectedProps.push(idx);
    return item.prop.index === idx ? item.prop : { ...item.prop, index: idx };
  });

  return {
    nextMap: { ...map, props: nextProps },
    nextSelectedProps,
  };
}

/**
 * Moves the selected polygons to the end (drawn last = on top), the start, or one step. Later polygons are drawn
 * over earlier ones in Soldat. The selection follows the polygons.
 */
export function reorderSelectedPolygons(
  map: PmsMapData,
  selected: ReadonlyArray<number>,
  direction: PropDrawOrderDirection
): { nextMap: PmsMapData; nextSelected: number[] } {
  const selSet = new Set(selected.filter((i) => i >= 0 && i < map.polygons.length));
  if (selSet.size === 0 || map.polygons.length <= 1) return { nextMap: map, nextSelected: [...selSet] };
  const tagged = map.polygons.map((poly, i) => ({ poly, selected: selSet.has(i) }));
  if (direction === 'front') {
    tagged.splice(0, tagged.length, ...tagged.filter((x) => !x.selected), ...tagged.filter((x) => x.selected));
  } else if (direction === 'back') {
    tagged.splice(0, tagged.length, ...tagged.filter((x) => x.selected), ...tagged.filter((x) => !x.selected));
  } else if (direction === 'forward') {
    for (let i = tagged.length - 2; i >= 0; i--) {
      if (tagged[i].selected && !tagged[i + 1].selected) [tagged[i], tagged[i + 1]] = [tagged[i + 1], tagged[i]];
    }
  } else {
    for (let i = 1; i < tagged.length; i++) {
      if (tagged[i].selected && !tagged[i - 1].selected) [tagged[i], tagged[i - 1]] = [tagged[i - 1], tagged[i]];
    }
  }
  const nextSelected: number[] = [];
  tagged.forEach((x, i) => x.selected && nextSelected.push(i));
  return { nextMap: { ...map, polygons: tagged.map((x) => x.poly) }, nextSelected };
}

/**
 * Everything of the same kind as the selection: sceneries with the same image, polygons of the same type,
 * spawns of the same type, waypoints of the same path, and all colliders.
 */
/** Which objects a bulk selection may take (visible and unlocked layers); everything when omitted */
export interface SelectableFilter {
  polygon: (index: number) => boolean;
  prop: (index: number) => boolean;
  spawn: (index: number) => boolean;
  collider: (index: number) => boolean;
  waypoint: (index: number) => boolean;
}

export function selectSimilarObjects(
  map: PmsMapData,
  sel: EditorSelection,
  can?: SelectableFilter
): EditorSelection {
  const stem = (name: string) => name.trim().toLowerCase().replace(/\.[^./\\]+$/, '');
  const out = emptySelection();
  if (sel.props.length > 0) {
    const stems = new Set(sel.props.map((i) => map.props[i]).filter(Boolean).map((p) => stem(map.scenery[p.style - 1]?.filename ?? '')));
    map.props.forEach((p, i) => {
      if (isPropRenderable(p, map.scenery.length) && stems.has(stem(map.scenery[p.style - 1].filename)) && (can?.prop(i) ?? true)) {
        out.props.push(i);
      }
    });
  }
  const polyIdx = [...sel.polygons, ...sel.vertices.map((v) => v.polyIndex)];
  if (polyIdx.length > 0) {
    const types = new Set(polyIdx.map((i) => map.polygons[i]?.polyType));
    map.polygons.forEach((p, i) => types.has(p.polyType) && (can?.polygon(i) ?? true) && out.polygons.push(i));
  }
  if (sel.spawns.length > 0) {
    const teams = new Set(sel.spawns.map((i) => map.spawnpoints[i]?.team));
    map.spawnpoints.forEach((s, i) => teams.has(s.team) && (can?.spawn(i) ?? true) && out.spawns.push(i));
  }
  if (sel.colliders.length > 0) out.colliders = map.colliders.map((_, i) => i).filter((i) => can?.collider(i) ?? true);
  if (sel.waypoints.length > 0) {
    const paths = new Set(sel.waypoints.map((i) => map.waypoints[i]?.pathNum));
    map.waypoints.forEach((w, i) => paths.has(w.pathNum) && (can?.waypoint(i) ?? true) && out.waypoints.push(i));
  }
  return out;
}

/** Every object of the kinds present in the selection that is not selected yet (vertices count as polygons) */
export function invertSelection(map: PmsMapData, sel: EditorSelection, can?: SelectableFilter): EditorSelection {
  const flip = (count: number, chosen: ReadonlyArray<number>, allowed?: (i: number) => boolean) => {
    const s = new Set(chosen);
    const out: number[] = [];
    for (let i = 0; i < count; i++) if (!s.has(i) && (allowed?.(i) ?? true)) out.push(i);
    return out;
  };
  const polys = [...sel.polygons, ...sel.vertices.map((v) => v.polyIndex)];
  const all = isSelectionEmpty(sel);
  return {
    polygons: all || polys.length > 0 ? flip(map.polygons.length, polys, can?.polygon) : [],
    vertices: [],
    props: all || sel.props.length > 0 ? flip(map.props.length, sel.props, can?.prop) : [],
    spawns: all || sel.spawns.length > 0 ? flip(map.spawnpoints.length, sel.spawns, can?.spawn) : [],
    colliders: all || sel.colliders.length > 0 ? flip(map.colliders.length, sel.colliders, can?.collider) : [],
    waypoints: all || sel.waypoints.length > 0 ? flip(map.waypoints.length, sel.waypoints, can?.waypoint) : [],
  };
}

export function toggleWaypointConnection(
  map: PmsMapData,
  fromZeroIdx: number,
  toZeroIdx: number,
  bidirectional = false
): PmsMapData {
  if (
    fromZeroIdx < 0 ||
    fromZeroIdx >= map.waypoints.length ||
    toZeroIdx < 0 ||
    toZeroIdx >= map.waypoints.length ||
    fromZeroIdx === toZeroIdx
  ) {
    return map;
  }

  const nextWaypoints = [...map.waypoints];
  const toggleOneWay = (srcIdx: number, dstOneBased: number, forceAdd?: boolean): boolean => {
    const wp = nextWaypoints[srcIdx];
    const has = wp.connections.includes(dstOneBased);
    const shouldHave = forceAdd !== undefined ? forceAdd : !has;
    let nextConns: number[];
    if (shouldHave) {
      if (has) return true;
      if (wp.connections.length >= 20) return false;
      nextConns = [...wp.connections, dstOneBased];
    } else {
      nextConns = wp.connections.filter((c) => c !== dstOneBased);
    }
    const { raw: _raw, ...rest } = wp;
    nextWaypoints[srcIdx] = { ...rest, connections: nextConns };
    return shouldHave;
  };

  const added = toggleOneWay(fromZeroIdx, toZeroIdx + 1);
  if (bidirectional) {
    toggleOneWay(toZeroIdx, fromZeroIdx + 1, added);
  }
  return { ...map, waypoints: nextWaypoints };
}

export function updateMapHeader(
  map: PmsMapData,
  patch: Partial<{
    mapName: string;
    texture: string;
    bgColorTop: RgbaColor;
    bgColorBtm: RgbaColor;
    startJet: number;
    grenadePacks: number;
    medikits: number;
    weather: number;
    steps: number;
  }>
): PmsMapData {
  const nextJet =
    patch.startJet !== undefined ? Math.max(0, Math.round(patch.startJet)) : map.startJet;
  return {
    ...map,
    ...(patch.mapName !== undefined ? { mapName: patch.mapName.slice(0, 38) } : {}),
    ...(patch.texture !== undefined ? { texture: patch.texture.slice(0, 24) } : {}),
    ...(patch.bgColorTop !== undefined ? { bgColorTop: { ...patch.bgColorTop } } : {}),
    ...(patch.bgColorBtm !== undefined ? { bgColorBtm: { ...patch.bgColorBtm } } : {}),
    startJet: nextJet,
    startJetGame: Math.floor((119 * nextJet) / 100),
    ...(patch.grenadePacks !== undefined
      ? { grenadePacks: Math.max(0, Math.min(12, Math.round(patch.grenadePacks))) }
      : {}),
    ...(patch.medikits !== undefined
      ? { medikits: Math.max(0, Math.min(12, Math.round(patch.medikits))) }
      : {}),
    ...(patch.weather !== undefined
      ? { weather: Math.max(0, Math.min(3, Math.round(patch.weather))) }
      : {}),
    ...(patch.steps !== undefined
      ? { steps: Math.max(0, Math.min(2, Math.round(patch.steps))) }
      : {}),
  };
}

/**
 * Pure command-based Map Editor Document with unlimited Undo / Redo, drag coalescing, and History jump.
 */
export class EditorDocument {
  private nextEntryId = 1;
  private state: EditorDocumentSnapshot;

  constructor(opts: {
    map: PmsMapData;
    sourceMapId?: string | null;
    sourceBaseName?: string | null;
    initialBaseName?: string;
    draftId?: string;
    startDirty?: boolean; // a recovered draft holds work that was never saved
  }) {
    const sourceBaseName = opts.sourceBaseName ?? null;
    const suggestedName =
      opts.initialBaseName ??
      (sourceBaseName ? makeEditedMapName(sourceBaseName, 24) : 'dm_untitled');
    const draftId =
      opts.draftId ??
      `draft_${(sourceBaseName || suggestedName).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)}_${Date.now().toString(36)}`;

    this.state = {
      draftId,
      sourceMapId: opts.sourceMapId ?? null,
      sourceBaseName,
      currentBaseName: suggestedName,
      hasSavedOnce: false,
      map: opts.map,
      // A shallow copy differs from `map` (unsaved) but shares its arrays, so geometry and scenery count as untouched
      savedMap: opts.startDirty ? { ...opts.map } : opts.map,
      selection: emptySelection(),
      undoStack: [],
      redoStack: [],
      revision: 0,
    };
  }

  public getSnapshot(): EditorDocumentSnapshot {
    return this.state;
  }

  public isDirty(): boolean {
    return this.state.map !== this.state.savedMap;
  }

  public isGeometryDirty(): boolean {
    return (
      this.state.map.polygons !== this.state.savedMap.polygons ||
      this.state.map.sectorsDivision !== this.state.savedMap.sectorsDivision ||
      this.state.map.sectorsNum !== this.state.savedMap.sectorsNum
    );
  }

  public isSceneryDirty(): boolean {
    return (
      this.state.map.props !== this.state.savedMap.props ||
      this.state.map.scenery !== this.state.savedMap.scenery
    );
  }

  public canUndo(): boolean {
    return this.state.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.state.redoStack.length > 0;
  }

  public setSelection(nextSelection: EditorSelection): EditorDocumentSnapshot {
    const clean = sanitizeSelectionForMap(nextSelection, this.state.map);
    this.state = {
      ...this.state,
      selection: clean,
      revision: this.state.revision + 1,
    };
    return this.state;
  }

  /**
   * Commits a map mutation onto the unlimited Undo stack.
   * Continuous pointer drags pass a shared `transactionId` so intermediate frames coalesce into one Undo step.
   */
  public commit(params: {
    label: string;
    nextMap: PmsMapData;
    nextSelection?: EditorSelection;
    transactionId?: string;
  }): EditorDocumentSnapshot {
    if (params.nextMap === this.state.map) {
      // Nothing changed in the map (e.g. a click that snapped back to the same spot): no history entry
      if (!params.nextSelection || selectionsEqual(params.nextSelection, this.state.selection)) {
        return this.state;
      }
      return this.setSelection(params.nextSelection);
    }

    const afterSelection = sanitizeSelectionForMap(
      params.nextSelection ?? this.state.selection,
      params.nextMap
    );

    const top =
      this.state.undoStack.length > 0
        ? this.state.undoStack[this.state.undoStack.length - 1]
        : null;

    // A drag or slider continues the previous step only if nothing else happened in between: same transaction,
    // the map is still that step's result (no undo, redo or other edit) and the selection did not change
    if (
      params.transactionId &&
      top &&
      top.transactionId === params.transactionId &&
      top.afterMap === this.state.map &&
      top.afterMap !== this.state.savedMap &&
      selectionsEqual(top.afterSelection, this.state.selection) &&
      Date.now() - top.timestamp <= TRANSACTION_MERGE_WINDOW_MS
    ) {
      const updatedTop: EditorHistoryEntry = {
        ...top,
        label: params.label,
        timestamp: Date.now(),
        afterMap: params.nextMap,
        afterSelection,
      };
      const nextUndo = [...this.state.undoStack];
      nextUndo[nextUndo.length - 1] = updatedTop;
      this.state = {
        ...this.state,
        map: params.nextMap,
        selection: afterSelection,
        undoStack: nextUndo,
        redoStack: [],
        revision: this.state.revision + 1,
      };
      return this.state;
    }

    const entry: EditorHistoryEntry = {
      id: this.nextEntryId++,
      label: params.label,
      timestamp: Date.now(),
      transactionId: params.transactionId,
      beforeMap: this.state.map,
      afterMap: params.nextMap,
      beforeSelection: cloneSelection(this.state.selection),
      afterSelection,
    };

    this.state = {
      ...this.state,
      map: params.nextMap,
      selection: afterSelection,
      undoStack: [...this.state.undoStack, entry],
      redoStack: [],
      revision: this.state.revision + 1,
    };
    return this.state;
  }

  public undo(): EditorDocumentSnapshot {
    if (this.state.undoStack.length === 0) return this.state;
    const nextUndo = [...this.state.undoStack];
    const popped = nextUndo.pop()!;
    this.state = {
      ...this.state,
      map: popped.beforeMap,
      selection: sanitizeSelectionForMap(popped.beforeSelection, popped.beforeMap),
      undoStack: nextUndo,
      redoStack: [...this.state.redoStack, popped],
      revision: this.state.revision + 1,
    };
    return this.state;
  }

  public redo(): EditorDocumentSnapshot {
    if (this.state.redoStack.length === 0) return this.state;
    const nextRedo = [...this.state.redoStack];
    const popped = nextRedo.pop()!;
    this.state = {
      ...this.state,
      map: popped.afterMap,
      selection: sanitizeSelectionForMap(popped.afterSelection, popped.afterMap),
      undoStack: [...this.state.undoStack, popped],
      redoStack: nextRedo,
      revision: this.state.revision + 1,
    };
    return this.state;
  }

  /**
   * Jumps to a target undo depth (`0` = initial opened state, `undoStack.length` = current state,
   * up to `undoStack.length + redoStack.length` = end of redo chain).
   */
  public jumpToHistoryDepth(targetUndoCount: number): EditorDocumentSnapshot {
    const timeline = [...this.state.undoStack, ...[...this.state.redoStack].reverse()];
    const clamped = Math.max(0, Math.min(timeline.length, Math.floor(targetUndoCount)));
    if (clamped === this.state.undoStack.length) return this.state;

    const nextMap =
      clamped === 0 ? timeline[0].beforeMap : timeline[clamped - 1].afterMap;
    const nextSel =
      clamped === 0 ? timeline[0].beforeSelection : timeline[clamped - 1].afterSelection;

    const nextUndo = timeline.slice(0, clamped);
    const nextRedo = timeline.slice(clamped).reverse();

    this.state = {
      ...this.state,
      map: nextMap,
      selection: sanitizeSelectionForMap(nextSel, nextMap),
      undoStack: nextUndo,
      redoStack: nextRedo,
      revision: this.state.revision + 1,
    };
    return this.state;
  }

  public markSaved(
    savedMap: PmsMapData,
    savedBaseName: string,
    newMapId?: string | null,
    savedFromMap?: PmsMapData
  ): EditorDocumentSnapshot {
    // Edited while the save request was running: keep the newer work (still unsaved), only remember the file
    if (savedFromMap && savedFromMap !== this.state.map) {
      this.state = {
        ...this.state,
        savedMap,
        currentBaseName: savedBaseName,
        sourceMapId: newMapId ?? this.state.sourceMapId,
        sourceBaseName: savedBaseName,
        hasSavedOnce: true,
        revision: this.state.revision + 1,
      };
      return this.state;
    }
    // Also update the top undo entry's `afterMap` if it was normalized on save so Undo/Redo stays seamless
    let nextUndo = this.state.undoStack;
    if (nextUndo.length > 0) {
      nextUndo = [...nextUndo];
      nextUndo[nextUndo.length - 1] = {
        ...nextUndo[nextUndo.length - 1],
        afterMap: savedMap,
      };
    }

    this.state = {
      ...this.state,
      map: savedMap,
      savedMap,
      currentBaseName: savedBaseName,
      sourceMapId: newMapId ?? this.state.sourceMapId,
      sourceBaseName: savedBaseName,
      hasSavedOnce: true,
      selection: sanitizeSelectionForMap(this.state.selection, savedMap),
      undoStack: nextUndo,
      revision: this.state.revision + 1,
    };
    return this.state;
  }
}
