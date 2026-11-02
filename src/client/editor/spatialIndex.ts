import { segmentsIntersect, triangleOverlapsBox } from '@shared/pmsCompiler';
import {
  computePropAabb,
  computePropCorners,
  isPropRenderable,
  PmsBounds,
  PmsMapData,
} from '@shared/pmsParser';
import { SPAWN_TYPES } from '@shared/soldatConstants';
import { RenderLayerVisibility } from '../renderer/types';
import { pointInTriangle } from '../utils/mapGeometry';
import {
  EditorLayerLocks,
  EditorObjectKind,
  EditorSelection,
  EditorSnapSettings,
  EditorVertexRef,
  SelectionFilterMode,
  SmartGuideLine,
  SnapIndicator,
} from './types';

const CELL_SIZE = 128;

export interface EditorPickHit {
  kind: EditorObjectKind;
  index: number;
}

function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function isSpawnVisibleAndUnlocked(
  team: number,
  layers: RenderLayerVisibility,
  locks: EditorLayerLocks
): boolean {
  const cat = SPAWN_TYPES[team]?.category ?? 'spawn';
  if (cat === 'flag') return layers.showFlags && !locks.flags;
  if (cat === 'spawn') return layers.showSpawns && !locks.spawns;
  return layers.showBonuses && !locks.bonuses;
}

export function isPropVisibleAndUnlocked(
  level: number,
  layers: RenderLayerVisibility,
  locks: EditorLayerLocks
): boolean {
  if (level === 0) return layers.showSceneryBack && !locks.sceneryBack;
  if (level === 1) return layers.showSceneryMid && !locks.sceneryMid;
  if (level === 2) {
    return layers.showSceneryFront && layers.frontSceneryOpacity > 0.01 && !locks.sceneryFront;
  }
  return false;
}

export function pointInPolygonContour(
  px: number,
  py: number,
  lasso: ReadonlyArray<{ x: number; y: number }>
): boolean {
  if (lasso.length < 3) return false;
  let inside = false;
  for (let i = 0, j = lasso.length - 1; i < lasso.length; j = i++) {
    const xi = lasso[i].x;
    const yi = lasso[i].y;
    const xj = lasso[j].x;
    const yj = lasso[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number; distSq: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    const d2 = (px - ax) * (px - ax) + (py - ay) * (py - ay);
    return { x: ax, y: ay, distSq: d2 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
  return { x: cx, y: cy, distSq: d2 };
}

export class EditorSpatialIndex {
  private readonly polyCells = new Map<string, number[]>();
  // Triangles too large for the grid (huge background or water polygons): always tested by their bounding box
  private readonly oversizedPolys: Array<{ index: number; left: number; top: number; right: number; bottom: number }> =
    [];
  private readonly propCells = new Map<string, number[]>();
  private readonly propAabbs: Array<PmsBounds | null>;

  constructor(public readonly map: PmsMapData) {
    this.propAabbs = new Array(map.props.length).fill(null);

    for (let i = 0; i < map.polygons.length; i++) {
      const [v0, v1, v2] = map.polygons[i].vertices;
      const minGx = Math.floor(Math.min(v0.x, v1.x, v2.x) / CELL_SIZE);
      const maxGx = Math.floor(Math.max(v0.x, v1.x, v2.x) / CELL_SIZE);
      const minGy = Math.floor(Math.min(v0.y, v1.y, v2.y) / CELL_SIZE);
      const maxGy = Math.floor(Math.max(v0.y, v1.y, v2.y) / CELL_SIZE);
      if (!Number.isFinite(minGx + maxGx + minGy + maxGy)) continue;
      if ((maxGx - minGx + 1) * (maxGy - minGy + 1) > 4096) {
        this.oversizedPolys.push({
          index: i,
          left: Math.min(v0.x, v1.x, v2.x),
          top: Math.min(v0.y, v1.y, v2.y),
          right: Math.max(v0.x, v1.x, v2.x),
          bottom: Math.max(v0.y, v1.y, v2.y),
        });
        continue;
      }
      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const key = cellKey(gx, gy);
          let list = this.polyCells.get(key);
          if (!list) {
            list = [];
            this.polyCells.set(key, list);
          }
          list.push(i);
        }
      }
    }

    for (let i = 0; i < map.props.length; i++) {
      const p = map.props[i];
      if (!isPropRenderable(p, map.scenery.length) || p.width === 0 || p.height === 0) continue;
      const aabb = computePropAabb(p);
      this.propAabbs[i] = aabb;
      const minGx = Math.floor(aabb.left / CELL_SIZE);
      const maxGx = Math.floor(aabb.right / CELL_SIZE);
      const minGy = Math.floor(aabb.top / CELL_SIZE);
      const maxGy = Math.floor(aabb.bottom / CELL_SIZE);
      if (
        !Number.isFinite(minGx + maxGx + minGy + maxGy) ||
        (maxGx - minGx + 1) * (maxGy - minGy + 1) > 4096
      ) {
        continue;
      }
      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const key = cellKey(gx, gy);
          let list = this.propCells.get(key);
          if (!list) {
            list = [];
            this.propCells.set(key, list);
          }
          list.push(i);
        }
      }
    }
  }

  public queryPolygonCandidates(left: number, top: number, right: number, bottom: number): number[] {
    const minGx = Math.floor(left / CELL_SIZE);
    const maxGx = Math.floor(right / CELL_SIZE);
    const minGy = Math.floor(top / CELL_SIZE);
    const maxGy = Math.floor(bottom / CELL_SIZE);
    if ((maxGx - minGx + 1) * (maxGy - minGy + 1) > 4096) {
      return this.map.polygons.map((_, i) => i);
    }
    const seen = new Set<number>();
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const bucket = this.polyCells.get(cellKey(gx, gy));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) seen.add(bucket[k]);
      }
    }
    for (const big of this.oversizedPolys) {
      if (big.right >= left && big.left <= right && big.bottom >= top && big.top <= bottom) seen.add(big.index);
    }
    return Array.from(seen).sort((a, b) => a - b);
  }

  public queryPropCandidates(left: number, top: number, right: number, bottom: number): number[] {
    const minGx = Math.floor(left / CELL_SIZE);
    const maxGx = Math.floor(right / CELL_SIZE);
    const minGy = Math.floor(top / CELL_SIZE);
    const maxGy = Math.floor(bottom / CELL_SIZE);
    if ((maxGx - minGx + 1) * (maxGy - minGy + 1) > 4096) {
      return this.map.props.map((_, i) => i);
    }
    const seen = new Set<number>();
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const bucket = this.propCells.get(cellKey(gx, gy));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) seen.add(bucket[k]);
      }
    }
    return Array.from(seen).sort((a, b) => a - b);
  }

  /**
   * Returns all unlocked, visible objects under `(wx, wy)` in top-to-bottom editor picking priority:
   * point markers (waypoints, spawns, colliders) -> front props -> front polygons -> mid props -> back props -> back polygons.
   */
  public pickObjectsAtPoint(
    wx: number,
    wy: number,
    zoom: number,
    layers: RenderLayerVisibility,
    locks: EditorLayerLocks,
    filter: SelectionFilterMode = 'all'
  ): EditorPickHit[] {
    const safeZoom = Math.max(0.02, zoom || 0.5);
    const markerRadius = 11 / safeZoom;
    const hits: EditorPickHit[] = [];

    const wantEntities = filter === 'all' || filter === 'entities';
    const wantProps = filter === 'all' || filter === 'sceneries';
    const wantPolygons = filter === 'all' || filter === 'polygons';

    // 1. Waypoints
    if (wantEntities && layers.showWaypoints && !locks.waypoints) {
      for (let i = this.map.waypoints.length - 1; i >= 0; i--) {
        const wp = this.map.waypoints[i];
        if (!wp.active) continue;
        if (Math.hypot(wp.x - wx, wp.y - wy) <= markerRadius) {
          hits.push({ kind: 'waypoint', index: i });
        }
      }
    }

    // 2. Spawns / Flags / Bonuses
    if (wantEntities) {
      for (let i = this.map.spawnpoints.length - 1; i >= 0; i--) {
        const sp = this.map.spawnpoints[i];
        if (!sp.active || !isSpawnVisibleAndUnlocked(sp.team, layers, locks)) continue;
        if (Math.hypot(sp.x - wx, sp.y - wy) <= markerRadius * 1.15) {
          hits.push({ kind: 'spawn', index: i });
        }
      }
    }

    // 3. Colliders
    if (wantEntities && layers.showColliders && !locks.colliders) {
      for (let i = this.map.colliders.length - 1; i >= 0; i--) {
        const col = this.map.colliders[i];
        if (!col.active) continue;
        const r = Math.max(markerRadius, Math.abs(col.radius) * 0.5);
        if (Math.hypot(col.x - wx, col.y - wy) <= r) {
          hits.push({ kind: 'collider', index: i });
        }
      }
    }

    // 4. Props & Polygons in OpenSoldat visual draw order (top-most first)
    const propHitsByLevel: [EditorPickHit[], EditorPickHit[], EditorPickHit[]] = [[], [], []];
    if (wantProps) {
      const propCandidates = this.queryPropCandidates(wx, wy, wx, wy);
      for (let k = propCandidates.length - 1; k >= 0; k--) {
        const idx = propCandidates[k];
        const p = this.map.props[idx];
        if (!p || !isPropRenderable(p, this.map.scenery.length)) continue;
        if (!isPropVisibleAndUnlocked(p.level, layers, locks)) continue;
        const c = computePropCorners(p.x, p.y, p.width, p.height, p.scaleX, p.scaleY, p.rotation);
        const inside =
          pointInTriangle(wx, wy, { x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }) ||
          pointInTriangle(wx, wy, { x: c[0], y: c[1] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] });
        if (inside && (p.level === 0 || p.level === 1 || p.level === 2)) {
          propHitsByLevel[p.level].push({ kind: 'prop', index: idx });
        }
      }
    }

    const polyFront: EditorPickHit[] = [];
    const polyBack: EditorPickHit[] = [];
    if (wantPolygons && layers.showPolygons && !locks.polygons) {
      const polyCandidates = this.queryPolygonCandidates(wx, wy, wx, wy);
      for (let k = polyCandidates.length - 1; k >= 0; k--) {
        const idx = polyCandidates[k];
        const poly = this.map.polygons[idx];
        const [a, b, c] = poly.vertices;
        if (!pointInTriangle(wx, wy, a, b, c)) continue;
        const hit: EditorPickHit = { kind: 'polygon', index: idx };
        if (poly.polyType === 24 || poly.polyType === 25) polyBack.push(hit);
        else polyFront.push(hit);
      }
    }

    hits.push(
      ...propHitsByLevel[2],
      ...polyFront,
      ...propHitsByLevel[1],
      ...propHitsByLevel[0],
      ...polyBack
    );
    return hits;
  }

  public pickVerticesAtPoint(
    wx: number,
    wy: number,
    zoom: number,
    layers: RenderLayerVisibility,
    locks: EditorLayerLocks
  ): EditorVertexRef[] {
    if (!layers.showPolygons || locks.polygons) return [];
    const radius = 9 / Math.max(0.02, zoom || 0.5);
    const rSq = radius * radius;
    const candidates = this.queryPolygonCandidates(wx - radius, wy - radius, wx + radius, wy + radius);

    let bestDistSq = rSq;
    let bestPt: { x: number; y: number } | null = null;
    for (const pi of candidates) {
      const vs = this.map.polygons[pi].vertices;
      for (let vi = 0 as 0 | 1 | 2; vi < 3; vi = (vi + 1) as 0 | 1 | 2) {
        const d2 = (vs[vi].x - wx) ** 2 + (vs[vi].y - wy) ** 2;
        if (d2 <= bestDistSq) {
          bestDistSq = d2;
          bestPt = { x: vs[vi].x, y: vs[vi].y };
        }
      }
    }
    if (!bestPt) return [];

    // Return all coincident vertices at that point so shared corners move cleanly together
    const out: EditorVertexRef[] = [];
    for (const pi of candidates) {
      const vs = this.map.polygons[pi].vertices;
      for (let vi = 0 as 0 | 1 | 2; vi < 3; vi = (vi + 1) as 0 | 1 | 2) {
        if (Math.hypot(vs[vi].x - bestPt.x, vs[vi].y - bestPt.y) <= 0.1) {
          out.push({ polyIndex: pi, vertexIndex: vi });
        }
      }
    }
    return out;
  }

  public pickNearestPolygonEdge(
    wx: number,
    wy: number,
    zoom: number
  ): { polyIndex: number; edgeIndex: 0 | 1 | 2; x: number; y: number } | null {
    const radius = 8 / Math.max(0.02, zoom || 0.5);
    let bestDistSq = radius * radius;
    let best: { polyIndex: number; edgeIndex: 0 | 1 | 2; x: number; y: number } | null = null;
    const candidates = this.queryPolygonCandidates(wx - radius, wy - radius, wx + radius, wy + radius);
    for (const pi of candidates) {
      const vs = this.map.polygons[pi].vertices;
      for (let ei = 0 as 0 | 1 | 2; ei < 3; ei = (ei + 1) as 0 | 1 | 2) {
        const a = vs[ei];
        const b = vs[(ei + 1) % 3];
        const cp = closestPointOnSegment(wx, wy, a.x, a.y, b.x, b.y);
        if (cp.distSq <= bestDistSq) {
          bestDistSq = cp.distSq;
          best = { polyIndex: pi, edgeIndex: ei, x: cp.x, y: cp.y };
        }
      }
    }
    return best;
  }

  public selectInBox(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    layers: RenderLayerVisibility,
    locks: EditorLayerLocks,
    vertexMode = false,
    filter: SelectionFilterMode = 'all'
  ): EditorSelection {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    if (vertexMode) {
      const vertices: EditorVertexRef[] = [];
      if (layers.showPolygons && !locks.polygons) {
        const candidates = this.queryPolygonCandidates(left, top, right, bottom);
        for (const pi of candidates) {
          const vs = this.map.polygons[pi].vertices;
          for (let vi = 0 as 0 | 1 | 2; vi < 3; vi = (vi + 1) as 0 | 1 | 2) {
            if (vs[vi].x >= left && vs[vi].x <= right && vs[vi].y >= top && vs[vi].y <= bottom) {
              vertices.push({ polyIndex: pi, vertexIndex: vi });
            }
          }
        }
      }
      return { polygons: [], vertices, props: [], spawns: [], colliders: [], waypoints: [] };
    }

    const wantEntities = filter === 'all' || filter === 'entities';
    const wantProps = filter === 'all' || filter === 'sceneries';
    const wantPolygons = filter === 'all' || filter === 'polygons';

    const polygons: number[] = [];
    if (wantPolygons && layers.showPolygons && !locks.polygons) {
      const candidates = this.queryPolygonCandidates(left, top, right, bottom);
      for (const pi of candidates) {
        const [v0, v1, v2] = this.map.polygons[pi].vertices;
        if (triangleOverlapsBox(v0, v1, v2, left, top, right, bottom)) {
          polygons.push(pi);
        }
      }
    }

    const props: number[] = [];
    if (wantProps) {
      const propCandidates = this.queryPropCandidates(left, top, right, bottom);
      for (const idx of propCandidates) {
        const p = this.map.props[idx];
        if (!p || !isPropVisibleAndUnlocked(p.level, layers, locks)) continue;
        const aabb = this.propAabbs[idx];
        if (!aabb) continue;
        if (aabb.right >= left && aabb.left <= right && aabb.bottom >= top && aabb.top <= bottom) {
          const c = computePropCorners(p.x, p.y, p.width, p.height, p.scaleX, p.scaleY, p.rotation);
          if (
            triangleOverlapsBox({ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, left, top, right, bottom) ||
            triangleOverlapsBox({ x: c[0], y: c[1] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }, left, top, right, bottom)
          ) {
            props.push(idx);
          }
        }
      }
    }

    const spawns: number[] = [];
    if (wantEntities) {
      for (let i = 0; i < this.map.spawnpoints.length; i++) {
        const sp = this.map.spawnpoints[i];
        if (!sp.active || !isSpawnVisibleAndUnlocked(sp.team, layers, locks)) continue;
        if (sp.x >= left && sp.x <= right && sp.y >= top && sp.y <= bottom) {
          spawns.push(i);
        }
      }
    }

    const colliders: number[] = [];
    if (wantEntities && layers.showColliders && !locks.colliders) {
      for (let i = 0; i < this.map.colliders.length; i++) {
        const col = this.map.colliders[i];
        if (!col.active) continue;
        const r = Math.abs(col.radius) * 0.5;
        const cx = Math.max(left, Math.min(right, col.x));
        const cy = Math.max(top, Math.min(bottom, col.y));
        if ((col.x - cx) ** 2 + (col.y - cy) ** 2 <= r * r) {
          colliders.push(i);
        }
      }
    }

    const waypoints: number[] = [];
    if (wantEntities && layers.showWaypoints && !locks.waypoints) {
      for (let i = 0; i < this.map.waypoints.length; i++) {
        const wp = this.map.waypoints[i];
        if (!wp.active) continue;
        if (wp.x >= left && wp.x <= right && wp.y >= top && wp.y <= bottom) {
          waypoints.push(i);
        }
      }
    }

    return { polygons, vertices: [], props, spawns, colliders, waypoints };
  }

  public selectInLasso(
    lasso: ReadonlyArray<{ x: number; y: number }>,
    layers: RenderLayerVisibility,
    locks: EditorLayerLocks,
    vertexMode = false,
    filter: SelectionFilterMode = 'all'
  ): EditorSelection {
    if (lasso.length < 3) {
      return { polygons: [], vertices: [], props: [], spawns: [], colliders: [], waypoints: [] };
    }
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const p of lasso) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }

    if (vertexMode) {
      const vertices: EditorVertexRef[] = [];
      if (layers.showPolygons && !locks.polygons) {
        const candidates = this.queryPolygonCandidates(left, top, right, bottom);
        for (const pi of candidates) {
          const vs = this.map.polygons[pi].vertices;
          for (let vi = 0 as 0 | 1 | 2; vi < 3; vi = (vi + 1) as 0 | 1 | 2) {
            if (pointInPolygonContour(vs[vi].x, vs[vi].y, lasso)) {
              vertices.push({ polyIndex: pi, vertexIndex: vi });
            }
          }
        }
      }
      return { polygons: [], vertices, props: [], spawns: [], colliders: [], waypoints: [] };
    }

    const wantEntities = filter === 'all' || filter === 'entities';
    const wantProps = filter === 'all' || filter === 'sceneries';
    const wantPolygons = filter === 'all' || filter === 'polygons';

    const polygons: number[] = [];
    if (wantPolygons && layers.showPolygons && !locks.polygons) {
      const candidates = this.queryPolygonCandidates(left, top, right, bottom);
      for (const pi of candidates) {
        const [v0, v1, v2] = this.map.polygons[pi].vertices;
        const cx = (v0.x + v1.x + v2.x) / 3;
        const cy = (v0.y + v1.y + v2.y) / 3;
        let hit =
          pointInPolygonContour(cx, cy, lasso) ||
          pointInPolygonContour(v0.x, v0.y, lasso) ||
          pointInPolygonContour(v1.x, v1.y, lasso) ||
          pointInPolygonContour(v2.x, v2.y, lasso);
        if (!hit) {
          for (let k = 0; k < lasso.length && !hit; k++) {
            const la = lasso[k];
            const lb = lasso[(k + 1) % lasso.length];
            if (
              segmentsIntersect(la.x, la.y, lb.x, lb.y, v0.x, v0.y, v1.x, v1.y) ||
              segmentsIntersect(la.x, la.y, lb.x, lb.y, v1.x, v1.y, v2.x, v2.y) ||
              segmentsIntersect(la.x, la.y, lb.x, lb.y, v2.x, v2.y, v0.x, v0.y)
            ) {
              hit = true;
            }
          }
        }
        if (hit) polygons.push(pi);
      }
    }

    const props: number[] = [];
    if (wantProps) {
      const propCandidates = this.queryPropCandidates(left, top, right, bottom);
      for (const idx of propCandidates) {
        const p = this.map.props[idx];
        if (!p || !isPropVisibleAndUnlocked(p.level, layers, locks)) continue;
        const c = computePropCorners(p.x, p.y, p.width, p.height, p.scaleX, p.scaleY, p.rotation);
        const qcx = (c[0] + c[4]) * 0.5;
        const qcy = (c[1] + c[5]) * 0.5;
        if (
          pointInPolygonContour(qcx, qcy, lasso) ||
          pointInPolygonContour(c[0], c[1], lasso) ||
          pointInPolygonContour(c[2], c[3], lasso) ||
          pointInPolygonContour(c[4], c[5], lasso) ||
          pointInPolygonContour(c[6], c[7], lasso)
        ) {
          props.push(idx);
        }
      }
    }

    const spawns: number[] = [];
    if (wantEntities) {
      for (let i = 0; i < this.map.spawnpoints.length; i++) {
        const sp = this.map.spawnpoints[i];
        if (!sp.active || !isSpawnVisibleAndUnlocked(sp.team, layers, locks)) continue;
        if (pointInPolygonContour(sp.x, sp.y, lasso)) spawns.push(i);
      }
    }

    const colliders: number[] = [];
    if (wantEntities && layers.showColliders && !locks.colliders) {
      for (let i = 0; i < this.map.colliders.length; i++) {
        const col = this.map.colliders[i];
        if (!col.active) continue;
        if (pointInPolygonContour(col.x, col.y, lasso)) colliders.push(i);
      }
    }

    const waypoints: number[] = [];
    if (wantEntities && layers.showWaypoints && !locks.waypoints) {
      for (let i = 0; i < this.map.waypoints.length; i++) {
        const wp = this.map.waypoints[i];
        if (!wp.active) continue;
        if (pointInPolygonContour(wp.x, wp.y, lasso)) waypoints.push(i);
      }
    }

    return { polygons, vertices: [], props, spawns, colliders, waypoints };
  }

  /**
   * Snaps a world point `(wx, wy)` according to `snap` settings (vertex > edge > smart guides > grid),
   * returning both the snapped point and visual snap / smart-guide indicators.
   */
  public snapPoint(
    wx: number,
    wy: number,
    zoom: number,
    snap: EditorSnapSettings,
    options?: {
      excludePolys?: ReadonlySet<number>;
      excludeVertices?: ReadonlySet<string>;
      anchorPoint?: { x: number; y: number } | null;
    }
  ): { x: number; y: number; indicator: SnapIndicator | null; guides: SmartGuideLine[] } {
    let x = wx;
    let y = wy;
    let indicator: SnapIndicator | null = null;
    const guides: SmartGuideLine[] = [];

    if (snap.angleSnap && options?.anchorPoint) {
      const ax = options.anchorPoint.x;
      const ay = options.anchorPoint.y;
      const dist = Math.hypot(x - ax, y - ay);
      if (dist > 1e-4) {
        const stepRad = (Math.max(1, snap.angleStepDeg || 15) * Math.PI) / 180;
        const rawAngle = Math.atan2(y - ay, x - ax);
        const snappedAngle = Math.round(rawAngle / stepRad) * stepRad;
        x = ax + Math.cos(snappedAngle) * dist;
        y = ay + Math.sin(snappedAngle) * dist;
      }
    }

    const snapRadius = 10 / Math.max(0.02, zoom || 0.5);
    const snapRadiusSq = snapRadius * snapRadius;

    // 1. Snap to polygon vertices (highest priority)
    if (snap.snapToVertices) {
      let bestDistSq = snapRadiusSq;
      const candidates = this.queryPolygonCandidates(
        x - snapRadius,
        y - snapRadius,
        x + snapRadius,
        y + snapRadius
      );
      for (const pi of candidates) {
        if (options?.excludePolys?.has(pi)) continue;
        const vs = this.map.polygons[pi].vertices;
        for (let vi = 0; vi < 3; vi++) {
          if (options?.excludeVertices?.has(`${pi}:${vi}`)) continue;
          const d2 = (vs[vi].x - x) ** 2 + (vs[vi].y - y) ** 2;
          if (d2 <= bestDistSq) {
            bestDistSq = d2;
            x = vs[vi].x;
            y = vs[vi].y;
            indicator = { x, y, kind: 'vertex' };
          }
        }
      }
      if (indicator) return { x, y, indicator, guides };
    }

    // 2. Snap to polygon edges
    if (snap.snapToEdges) {
      let bestDistSq = snapRadiusSq * 0.75;
      const candidates = this.queryPolygonCandidates(
        x - snapRadius,
        y - snapRadius,
        x + snapRadius,
        y + snapRadius
      );
      for (const pi of candidates) {
        if (options?.excludePolys?.has(pi)) continue;
        const vs = this.map.polygons[pi].vertices;
        for (let ei = 0; ei < 3; ei++) {
          if (
            options?.excludeVertices?.has(`${pi}:${ei}`) ||
            options?.excludeVertices?.has(`${pi}:${(ei + 1) % 3}`)
          ) {
            continue;
          }
          const a = vs[ei];
          const b = vs[(ei + 1) % 3];
          const cp = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
          if (cp.distSq <= bestDistSq) {
            bestDistSq = cp.distSq;
            x = cp.x;
            y = cp.y;
            indicator = { x, y, kind: 'edge' };
          }
        }
      }
      if (indicator) return { x, y, indicator, guides };
    }

    // 3. Smart alignment guides to nearby vertices & spawns
    if (snap.smartGuides) {
      const guideTol = 6 / Math.max(0.02, zoom || 0.5);
      const reach = 512;
      let bestDx = guideTol;
      let bestDy = guideTol;
      let guideX: { coord: number; refY: number } | null = null;
      let guideY: { coord: number; refX: number } | null = null;

      // Also align to X = 0 symmetry axis and Y = 0 origin
      if (Math.abs(x) <= bestDx) {
        bestDx = Math.abs(x);
        guideX = { coord: 0, refY: 0 };
      }
      if (Math.abs(y) <= bestDy) {
        bestDy = Math.abs(y);
        guideY = { coord: 0, refX: 0 };
      }

      const candidates = this.queryPolygonCandidates(x - reach, y - reach, x + reach, y + reach);
      for (const pi of candidates) {
        if (options?.excludePolys?.has(pi)) continue;
        for (let vi = 0; vi < 3; vi++) {
          if (options?.excludeVertices?.has(`${pi}:${vi}`)) continue;
          const v = this.map.polygons[pi].vertices[vi];
          const dx = Math.abs(v.x - x);
          if (dx <= bestDx) {
            bestDx = dx;
            guideX = { coord: v.x, refY: v.y };
          }
          const dy = Math.abs(v.y - y);
          if (dy <= bestDy) {
            bestDy = dy;
            guideY = { coord: v.y, refX: v.x };
          }
        }
      }

      if (guideX) {
        x = guideX.coord;
        guides.push({ axis: 'x', coord: guideX.coord, from: Math.min(y, guideX.refY), to: Math.max(y, guideX.refY) });
      }
      if (guideY) {
        y = guideY.coord;
        guides.push({ axis: 'y', coord: guideY.coord, from: Math.min(x, guideY.refX), to: Math.max(x, guideY.refX) });
      }
      if (guideX || guideY) {
        indicator = { x, y, kind: 'guide' };
      }
    }

    // 4. Snap to grid
    if (snap.snapToGrid && !indicator) {
      const g = Math.max(1, snap.gridSize || 16);
      x = Math.round(x / g) * g;
      y = Math.round(y / g) * g;
      indicator = { x, y, kind: 'grid' };
    }

    return { x, y, indicator, guides };
  }
}

export function mergeSelections(
  base: EditorSelection,
  incoming: EditorSelection,
  mode: 'replace' | 'add' | 'remove' | 'toggle'
): EditorSelection {
  if (mode === 'replace') return incoming;

  const mergeList = (a: number[], b: number[]): number[] => {
    const set = new Set(a);
    for (const v of b) {
      if (mode === 'add') set.add(v);
      else if (mode === 'remove') set.delete(v);
      else if (set.has(v)) set.delete(v);
      else set.add(v);
    }
    return Array.from(set).sort((x, y) => x - y);
  };

  const vMap = new Map<string, EditorVertexRef>();
  for (const v of base.vertices) vMap.set(`${v.polyIndex}:${v.vertexIndex}`, v);
  for (const v of incoming.vertices) {
    const key = `${v.polyIndex}:${v.vertexIndex}`;
    if (mode === 'add') vMap.set(key, v);
    else if (mode === 'remove') vMap.delete(key);
    else if (vMap.has(key)) vMap.delete(key);
    else vMap.set(key, v);
  }

  return {
    polygons: mergeList(base.polygons, incoming.polygons),
    vertices: Array.from(vMap.values()),
    props: mergeList(base.props, incoming.props),
    spawns: mergeList(base.spawns, incoming.spawns),
    colliders: mergeList(base.colliders, incoming.colliders),
    waypoints: mergeList(base.waypoints, incoming.waypoints),
  };
}
