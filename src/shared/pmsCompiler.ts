import {
  computePropCorners,
  currentDosTimestamp,
  isPropRenderable,
  PmsBounds,
  PmsCollider,
  PmsMapData,
  PmsPolygon,
  PmsProp,
  PmsSceneryDef,
  PmsSpawnpoint,
  PmsVec3,
  PmsVertex,
  PmsWaypoint,
  polygonCollisionMatchesRaw,
  PROP_COORD_LIMIT,
  registerSectorTable,
  sectorTablePolygons,
  SOLDAT_MAP_LIMITS,
} from './pmsParser';
import { RgbaColor } from './soldatConstants';

/**
 * Twice the signed area of triangle (v0, v1, v2) in Soldat's Y-down world space (+X right, +Y down).
 * Positive (> 0) means Clockwise (CW), which is what Soldat / OpenSoldat expects for valid collision normals.
 */
export function polygonSignedArea2(
  v0: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number }
): number {
  return (v1.x - v0.x) * (v2.y - v0.y) - (v1.y - v0.y) * (v2.x - v0.x);
}

export function isClockwisePolygon(poly: Pick<PmsPolygon, 'vertices'>): boolean {
  const [v0, v1, v2] = poly.vertices;
  return polygonSignedArea2(v0, v1, v2) > 0;
}

/**
 * Computes the inward unit perpendicular for CW edge (va -> vb) scaled by `mult`, with `z = 1`.
 * Verified across 657,766 real PMS edges: OpenSoldat subtracts `perp` to push colliding entities outward,
 * so the stored normal points inward `(-dy / len, dx / len) * mult` in Y-down CW winding.
 */
export function computeEdgeNormal(
  va: { x: number; y: number },
  vb: { x: number; y: number },
  mult = 1
): PmsVec3 {
  const dx = vb.x - va.x;
  const dy = vb.y - va.y;
  const len = Math.hypot(dx, dy);
  const safeMult = Number.isFinite(mult) ? mult : 1;
  if (!Number.isFinite(len) || len < 1e-7) {
    return { x: 0, y: -safeMult, z: 1 };
  }
  return {
    x: (-dy / len) * safeMult,
    y: (dx / len) * safeMult,
    z: 1,
  };
}

/**
 * Computes the three edge perpendiculars for a polygon.
 * Only `polyType === 18` (BOUNCY) scales normal magnitude by `bounciness`; all other polygon types use magnitude 1.
 */
export function computePolygonNormals(poly: Pick<PmsPolygon, 'vertices' | 'polyType' | 'bounciness'>): {
  normals: [PmsVec3, PmsVec3, PmsVec3];
  bounciness: number;
} {
  const mult =
    poly.polyType === 18
      ? Number.isFinite(poly.bounciness) && poly.bounciness > 0
        ? poly.bounciness
        : 1
      : 1;
  const [v0, v1, v2] = poly.vertices;
  // Normals point into the triangle whatever its winding: the game tests a point against each edge with them
  // (PointInPolyEdges), so a counter-clockwise triangle with inward normals still collides like a clockwise one
  const inward = polygonSignedArea2(v0, v1, v2) < 0 ? -mult : mult;
  return {
    normals: [
      computeEdgeNormal(v0, v1, inward),
      computeEdgeNormal(v1, v2, inward),
      computeEdgeNormal(v2, v0, inward),
    ],
    bounciness: mult,
  };
}

/**
 * True when the stored normals point into the triangle for every edge (what the game's collision test needs).
 * Outward normals make the polygon non-solid in game whatever its type.
 */
export function hasInwardNormals(poly: Pick<PmsPolygon, 'vertices' | 'normals'>): boolean {
  const [a, b, c] = poly.vertices;
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  for (let k = 0; k < 3; k++) {
    const v = poly.vertices[k];
    const n = poly.normals[k];
    if (n.x * (cx - v.x) + n.y * (cy - v.y) < -1e-6) return false;
  }
  return true;
}

function normalizeVertex(v: PmsVertex): PmsVertex {
  return {
    x: Number.isFinite(v.x) ? v.x : 0,
    y: Number.isFinite(v.y) ? v.y : 0,
    z: 1,
    rhw: 1,
    color: {
      r: Math.max(0, Math.min(255, Math.round(v.color?.r ?? 255))),
      g: Math.max(0, Math.min(255, Math.round(v.color?.g ?? 255))),
      b: Math.max(0, Math.min(255, Math.round(v.color?.b ?? 255))),
      a: Math.max(0, Math.min(255, Math.round(v.color?.a ?? 255))),
    },
    u: Number.isFinite(v.u) ? v.u : 0,
    v: Number.isFinite(v.v) ? v.v : 0,
  };
}

/**
 * Ensures vertices have `z = 1, rhw = 1`, optionally flips CCW triangles to CW, and recomputes edge normals.
 * Strips `raw` because the polygon geometry/type was rebuilt.
 */
export function rebuildPolygonGeometry(
  poly: PmsPolygon,
  options?: { enforceCw?: boolean }
): PmsPolygon {
  const enforceCw = options?.enforceCw !== false;
  let v0 = normalizeVertex(poly.vertices[0]);
  let v1 = normalizeVertex(poly.vertices[1]);
  let v2 = normalizeVertex(poly.vertices[2]);

  if (enforceCw && polygonSignedArea2(v0, v1, v2) < 0) {
    const tmp = v1;
    v1 = v2;
    v2 = tmp;
  }

  const vertices: [PmsVertex, PmsVertex, PmsVertex] = [v0, v1, v2];
  const { normals, bounciness } = computePolygonNormals({
    vertices,
    polyType: poly.polyType,
    bounciness: poly.bounciness,
  });

  return {
    vertices,
    normals,
    polyType: poly.polyType,
    bounciness,
  };
}

export function ensureClockwiseWinding(poly: PmsPolygon): PmsPolygon {
  return rebuildPolygonGeometry(poly, { enforceCw: true });
}

function pointInTriInclusive(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): boolean {
  const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
  const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function orient2d(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number
): boolean {
  return (
    px >= Math.min(ax, bx) - 1e-6 &&
    px <= Math.max(ax, bx) + 1e-6 &&
    py >= Math.min(ay, by) - 1e-6 &&
    py <= Math.max(ay, by) + 1e-6
  );
}

export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const o1 = orient2d(ax, ay, bx, by, cx, cy);
  const o2 = orient2d(ax, ay, bx, by, dx, dy);
  const o3 = orient2d(cx, cy, dx, dy, ax, ay);
  const o4 = orient2d(cx, cy, dx, dy, bx, by);

  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  if (Math.abs(o1) <= 1e-6 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(o2) <= 1e-6 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (Math.abs(o3) <= 1e-6 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(o4) <= 1e-6 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

export function triangleOverlapsBox(
  v0: { x: number; y: number },
  v1: { x: number; y: number },
  v2: { x: number; y: number },
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  // Fast AABB reject
  const minX = Math.min(v0.x, v1.x, v2.x);
  const maxX = Math.max(v0.x, v1.x, v2.x);
  const minY = Math.min(v0.y, v1.y, v2.y);
  const maxY = Math.max(v0.y, v1.y, v2.y);
  if (maxX < left || minX > right || maxY < top || minY > bottom) return false;

  // 1. Any triangle vertex inside box
  for (const v of [v0, v1, v2]) {
    if (v.x >= left && v.x <= right && v.y >= top && v.y <= bottom) return true;
  }

  // 2. Box centre or corners inside triangle (prevents hollow giant triangles in sectors!)
  const cx = (left + right) * 0.5;
  const cy = (top + bottom) * 0.5;
  if (
    pointInTriInclusive(cx, cy, v0, v1, v2) ||
    pointInTriInclusive(left, top, v0, v1, v2) ||
    pointInTriInclusive(right, top, v0, v1, v2) ||
    pointInTriInclusive(right, bottom, v0, v1, v2) ||
    pointInTriInclusive(left, bottom, v0, v1, v2)
  ) {
    return true;
  }

  // 3. Any triangle edge intersects any of the 4 box edges
  const triEdges: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
    [v0, v1],
    [v1, v2],
    [v2, v0],
  ];
  for (const [a, b] of triEdges) {
    if (
      segmentsIntersect(a.x, a.y, b.x, b.y, left, top, right, top) ||
      segmentsIntersect(a.x, a.y, b.x, b.y, right, top, right, bottom) ||
      segmentsIntersect(a.x, a.y, b.x, b.y, right, bottom, left, bottom) ||
      segmentsIntersect(a.x, a.y, b.x, b.y, left, bottom, left, top)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Compiles the 51x51 (`sectorsNum = 25`) spatial collision grid expected by Soldat / OpenSoldat.
 * Verified against PolyWorks maps:
 * - `sectorsDivision = max(1, floor((maxAbsCoord + 100) / sectorsNum))` (or 128 when empty)
 * - Excludes `polyType === 3` (`DOESNT_COLLIDE`)
 * - Cell `(kx, ky)` spans `[(kx - 0.5) * div - 1, (kx + 0.5) * div + 1]` in both axes
 * - Includes interior cells of large polygons (fixing MapMaker's classic hollow-polygon bug)
 * - Stores 1-based polygon indices (`Uint16Array`) in X-major order `(kx + n) * side + (ky + n)`.
 */
export function compileMapSectors(
  polygons: PmsPolygon[],
  options?: { sectorsNum?: number; fixedDivision?: number }
): {
  sectorsDivision: number;
  sectorsNum: number;
  sectorsPolys: Uint16Array[];
} {
  const sectorsNum = Math.max(
    1,
    Math.min(SOLDAT_MAP_LIMITS.maxSectorsNum, Math.floor(options?.sectorsNum ?? 25))
  );

  let maxAbs = 0;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (Math.abs(v.x) < 1e6 && Math.abs(v.y) < 1e6) {
        const ax = Math.abs(v.x);
        const ay = Math.abs(v.y);
        if (ax > maxAbs) maxAbs = ax;
        if (ay > maxAbs) maxAbs = ay;
      }
    }
  }

  const sectorsDivision =
    options?.fixedDivision && options.fixedDivision > 0
      ? Math.max(1, Math.round(options.fixedDivision))
      : polygons.length === 0
      ? 128
      : Math.max(1, Math.floor((maxAbs + 100) / sectorsNum));

  const side = 2 * sectorsNum + 1;
  const buckets: number[][] = Array.from({ length: side * side }, () => []);
  const half = sectorsDivision * 0.5;
  const pad = 1; // PolyWorks 1-unit cell border padding

  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (poly.polyType === 3) continue; // DOESNT_COLLIDE is never inserted into sectors
    const [v0, v1, v2] = poly.vertices;
    if (
      Math.abs(v0.x) >= 1e6 ||
      Math.abs(v0.y) >= 1e6 ||
      Math.abs(v1.x) >= 1e6 ||
      Math.abs(v1.y) >= 1e6 ||
      Math.abs(v2.x) >= 1e6 ||
      Math.abs(v2.y) >= 1e6
    ) {
      continue;
    }

    const minX = Math.min(v0.x, v1.x, v2.x);
    const maxX = Math.max(v0.x, v1.x, v2.x);
    const minY = Math.min(v0.y, v1.y, v2.y);
    const maxY = Math.max(v0.y, v1.y, v2.y);

    const kxMin = Math.max(-sectorsNum, Math.floor((minX - pad) / sectorsDivision - 0.5));
    const kxMax = Math.min(sectorsNum, Math.ceil((maxX + pad) / sectorsDivision + 0.5));
    const kyMin = Math.max(-sectorsNum, Math.floor((minY - pad) / sectorsDivision - 0.5));
    const kyMax = Math.min(sectorsNum, Math.ceil((maxY + pad) / sectorsDivision + 0.5));

    const polyOneBased = i + 1;
    for (let kx = kxMin; kx <= kxMax; kx++) {
      const left = kx * sectorsDivision - half - pad;
      const right = kx * sectorsDivision + half + pad;
      const colOffset = (kx + sectorsNum) * side;
      for (let ky = kyMin; ky <= kyMax; ky++) {
        const top = ky * sectorsDivision - half - pad;
        const bottom = ky * sectorsDivision + half + pad;
        if (triangleOverlapsBox(v0, v1, v2, left, top, right, bottom)) {
          buckets[colOffset + (ky + sectorsNum)].push(polyOneBased);
        }
      }
    }
  }

  const sectorsPolys = buckets.map((b) => Uint16Array.from(b));
  registerSectorTable(sectorsPolys, polygons);
  return {
    sectorsDivision,
    sectorsNum,
    sectorsPolys,
  };
}

function finalizeBounds(left: number, right: number, top: number, bottom: number): PmsBounds {
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return { left: -320, right: 320, top: -240, bottom: 240, width: 640, height: 480 };
  }
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function computeMapBounds(map: {
  polygons: PmsPolygon[];
  props: PmsProp[];
  scenery: PmsSceneryDef[];
  spawnpoints: PmsSpawnpoint[];
}): { polyBounds: PmsBounds; fullBounds: PmsBounds } {
  let pLeft = Infinity;
  let pRight = -Infinity;
  let pTop = Infinity;
  let pBottom = -Infinity;

  for (const poly of map.polygons) {
    for (const v of poly.vertices) {
      if (Math.abs(v.x) < 1e6 && Math.abs(v.y) < 1e6) {
        if (v.x < pLeft) pLeft = v.x;
        if (v.x > pRight) pRight = v.x;
        if (v.y < pTop) pTop = v.y;
        if (v.y > pBottom) pBottom = v.y;
      }
    }
  }

  let fLeft = pLeft;
  let fRight = pRight;
  let fTop = pTop;
  let fBottom = pBottom;

  const sceneryCount = map.scenery.length;
  for (const p of map.props) {
    if (!isPropRenderable(p, sceneryCount)) continue;
    if (Math.abs(p.x) < PROP_COORD_LIMIT && Math.abs(p.y) < PROP_COORD_LIMIT) {
      const w = p.width > 0 ? p.width : 64;
      const h = p.height > 0 ? p.height : 64;
      const corners = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
      for (let c = 0; c < 8; c += 2) {
        const cx = corners[c];
        const cy = corners[c + 1];
        if (Math.abs(cx) < PROP_COORD_LIMIT && Math.abs(cy) < PROP_COORD_LIMIT) {
          if (cx < fLeft) fLeft = cx;
          if (cx > fRight) fRight = cx;
          if (cy < fTop) fTop = cy;
          if (cy > fBottom) fBottom = cy;
        }
      }
    }
  }

  for (const sp of map.spawnpoints) {
    if (!sp.active || Math.abs(sp.x) >= 2000000 || Math.abs(sp.y) >= 2000000) continue;
    if (sp.x < fLeft) fLeft = sp.x;
    if (sp.x > fRight) fRight = sp.x;
    if (sp.y < fTop) fTop = sp.y;
    if (sp.y > fBottom) fBottom = sp.y;
  }

  return {
    polyBounds: finalizeBounds(pLeft, pRight, pTop, pBottom),
    fullBounds: finalizeBounds(fLeft, fRight, fTop, fBottom),
  };
}

/**
 * Ensures the scenery definition table has no duplicate filenames and no unused entries,
 * remapping every active prop's 1-based `style` index cleanly.
 */
export function compactSceneryTable(
  props: PmsProp[],
  scenery: PmsSceneryDef[],
  options?: { dropInactiveProps?: boolean }
): { props: PmsProp[]; scenery: PmsSceneryDef[]; removedSceneryCount: number } {
  const dropInactive = options?.dropInactiveProps !== false;
  const keptScenery: PmsSceneryDef[] = [];
  const styleByLowerFilename = new Map<string, number>();
  const oldStyleToNewStyle = new Map<number, number>();
  const usedCounts = new Map<number, number>();

  // Walk props in draw order, keeping only scenery definitions actually referenced by valid props
  const nextProps: PmsProp[] = [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const valid = isPropRenderable(p, scenery.length);
    if (!valid) {
      if (!dropInactive) {
        nextProps.push({ ...p, index: nextProps.length });
      }
      continue;
    }

    let mappedStyle = oldStyleToNewStyle.get(p.style);
    if (!mappedStyle) {
      const origDef = scenery[p.style - 1];
      const cleanName = origDef.filename.trim();
      const key = cleanName.toLowerCase();
      const existing = styleByLowerFilename.get(key);
      if (existing) {
        mappedStyle = existing;
      } else {
        mappedStyle = keptScenery.length + 1;
        styleByLowerFilename.set(key, mappedStyle);
        keptScenery.push({
          ...origDef,
          index: mappedStyle,
          filename: cleanName || origDef.filename,
          usedCount: 0,
        });
      }
      oldStyleToNewStyle.set(p.style, mappedStyle);
    }

    usedCounts.set(mappedStyle, (usedCounts.get(mappedStyle) ?? 0) + 1);
    nextProps.push(
      p.style === mappedStyle && p.index === nextProps.length
        ? p
        : { ...p, index: nextProps.length, style: mappedStyle }
    );
  }

  const finalScenery = keptScenery.map((s) => ({
    ...s,
    usedCount: usedCounts.get(s.index) ?? 0,
  }));

  return {
    props: nextProps,
    scenery: finalScenery,
    removedSceneryCount: Math.max(0, scenery.length - finalScenery.length),
  };
}

/**
 * Finds an existing 1-based scenery style by filename (case-insensitive) or appends a new entry.
 */
export function ensureSceneryEntry(
  scenery: PmsSceneryDef[],
  filename: string,
  date?: number
): { scenery: PmsSceneryDef[]; style: number } {
  const clean = filename.trim().replace(/\\/g, '/');
  const lower = clean.toLowerCase();
  for (let i = 0; i < scenery.length; i++) {
    if (scenery[i].filename.trim().replace(/\\/g, '/').toLowerCase() === lower) {
      return { scenery, style: i + 1 };
    }
  }
  const style = scenery.length + 1;
  const nextScenery = [
    ...scenery,
    {
      index: style,
      filename: clean,
      date: date ?? currentDosTimestamp(),
      usedCount: 0,
    },
  ];
  return { scenery: nextScenery, style };
}

/**
 * Deletes waypoints by 0-based array index and remaps all remaining 1-based `index`, `id`, and `connections`.
 */
export function reindexWaypointsAfterDelete(
  waypoints: PmsWaypoint[],
  deletedZeroBasedIndices: Iterable<number>
): PmsWaypoint[] {
  const deleted = new Set<number>(deletedZeroBasedIndices);
  if (deleted.size === 0) return waypoints;

  const oldOneBasedToNew = new Map<number, number>();
  const kept: PmsWaypoint[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    if (deleted.has(i)) continue;
    const oldOneBased = i + 1;
    const newOneBased = kept.length + 1;
    oldOneBasedToNew.set(oldOneBased, newOneBased);
    // Also map `wp.id` in case an older map had non-sequential IDs matching connections
    if (waypoints[i].id > 0 && !oldOneBasedToNew.has(waypoints[i].id)) {
      oldOneBasedToNew.set(waypoints[i].id, newOneBased);
    }
    kept.push(waypoints[i]);
  }

  return kept.map((wp, idx) => {
    const newOneBased = idx + 1;
    const nextConns: number[] = [];
    for (const c of wp.connections) {
      const mapped = oldOneBasedToNew.get(c);
      if (mapped && mapped !== newOneBased && !nextConns.includes(mapped)) {
        nextConns.push(mapped);
      }
    }
    const unchanged =
      wp.index === newOneBased &&
      wp.id === newOneBased &&
      nextConns.length === wp.connections.length &&
      nextConns.every((v, k) => v === wp.connections[k]);

    if (unchanged) return wp;
    const { raw: _raw, ...rest } = wp;
    return {
      ...rest,
      index: newOneBased,
      id: newOneBased,
      connections: nextConns.slice(0, 20),
    };
  });
}

/**
 * Triangulates a simple closed 2D polygon into Clockwise (CW) triangles in Soldat Y-down space.
 * Returns an array of index triples `[i0, i1, i2]` into the cleaned point ring, or directly builds `PmsVertex` triples.
 */
export function earClipTriangulate(points: ReadonlyArray<{ x: number; y: number }>): Array<[
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
]> {
  // 1. Remove consecutive duplicate points
  const ring: Array<{ x: number; y: number }> = [];
  for (const pt of points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    const prev = ring[ring.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.05) {
      ring.push({ x: pt.x, y: pt.y });
    }
  }
  if (ring.length >= 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.05) {
      ring.pop();
    }
  }
  if (ring.length < 3) return [];
  if (ring.length === 3) {
    const [a, b, c] = ring;
    return polygonSignedArea2(a, b, c) >= 0 ? [[a, b, c]] : [[a, c, b]];
  }

  // 2. Ensure CW orientation in Y-down space (shoelace signed double-area > 0)
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  if (area2 < 0) {
    ring.reverse();
  }

  const indices = ring.map((_, i) => i);
  const triangles: Array<[{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]> = [];

  let guard = indices.length * indices.length + 16;
  while (indices.length > 3 && guard-- > 0) {
    let earFound = false;
    const len = indices.length;

    for (let i = 0; i < len; i++) {
      const iPrev = indices[(i + len - 1) % len];
      const iCurr = indices[i];
      const iNext = indices[(i + 1) % len];
      const a = ring[iPrev];
      const b = ring[iCurr];
      const c = ring[iNext];

      if (polygonSignedArea2(a, b, c) <= 1e-5) continue; // reflex or collinear

      let containsPoint = false;
      for (let j = 0; j < len; j++) {
        const idx = indices[j];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        const p = ring[idx];
        if (pointInTriInclusive(p.x, p.y, a, b, c)) {
          containsPoint = true;
          break;
        }
      }

      if (!containsPoint) {
        triangles.push([a, b, c]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }

    if (!earFound) {
      // Degenerate / self-touching fallback: clip the most convex remaining corner
      let bestIdx = 0;
      let bestCross = -Infinity;
      for (let i = 0; i < len; i++) {
        const a = ring[indices[(i + len - 1) % len]];
        const b = ring[indices[i]];
        const c = ring[indices[(i + 1) % len]];
        const cross = polygonSignedArea2(a, b, c);
        if (cross > bestCross) {
          bestCross = cross;
          bestIdx = i;
        }
      }
      const a = ring[indices[(bestIdx + len - 1) % len]];
      const b = ring[indices[bestIdx]];
      const c = ring[indices[(bestIdx + 1) % len]];
      if (polygonSignedArea2(a, b, c) >= 0) {
        triangles.push([a, b, c]);
      } else {
        triangles.push([a, c, b]);
      }
      indices.splice(bestIdx, 1);
    }
  }

  if (indices.length === 3) {
    const a = ring[indices[0]];
    const b = ring[indices[1]];
    const c = ring[indices[2]];
    triangles.push(polygonSignedArea2(a, b, c) >= 0 ? [a, b, c] : [a, c, b]);
  }

  return triangles;
}

export function computeWorldAlignedUv(
  x: number,
  y: number,
  texWidth = 128,
  texHeight = 128,
  options?: {
    scaleX?: number;
    scaleY?: number;
    offsetU?: number;
    offsetV?: number;
    rotationRad?: number;
  }
): { u: number; v: number } {
  const tw = Math.max(1, texWidth);
  const th = Math.max(1, texHeight);
  const sx = options?.scaleX && Math.abs(options.scaleX) > 1e-5 ? options.scaleX : 1;
  const sy = options?.scaleY && Math.abs(options.scaleY) > 1e-5 ? options.scaleY : 1;
  const rot = options?.rotationRad ?? 0;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  return {
    u: rx / (tw * sx) + (options?.offsetU ?? 0),
    v: ry / (th * sy) + (options?.offsetV ?? 0),
  };
}

export function createPolygonFromPoints(
  pts: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  options?: {
    polyType?: number;
    bounciness?: number;
    color?: RgbaColor;
    texWidth?: number;
    texHeight?: number;
  }
): PmsPolygon {
  const color = options?.color ?? { r: 255, g: 255, b: 255, a: 255 };
  const tw = options?.texWidth ?? 128;
  const th = options?.texHeight ?? 128;
  const makeVert = (pt: { x: number; y: number }): PmsVertex => {
    const uv = computeWorldAlignedUv(pt.x, pt.y, tw, th);
    return {
      x: pt.x,
      y: pt.y,
      z: 1,
      rhw: 1,
      color: { ...color },
      u: uv.u,
      v: uv.v,
    };
  };
  return rebuildPolygonGeometry(
    {
      vertices: [makeVert(pts[0]), makeVert(pts[1]), makeVert(pts[2])],
      normals: [
        { x: 0, y: -1, z: 1 },
        { x: 0, y: -1, z: 1 },
        { x: 0, y: -1, z: 1 },
      ],
      polyType: options?.polyType ?? 0,
      bounciness: options?.bounciness ?? 1,
    },
    { enforceCw: true }
  );
}

/**
 * Splits a triangle along edge `edgeIndex` (`0` = v0->v1, `1` = v1->v2, `2` = v2->v0) at `splitPt`,
 * interpolating vertex color & UV. When `splitSharedAdjacents` is true (default), any neighboring
 * triangle sharing the exact same edge endpoints is also split at `splitPt` to avoid T-junction cracks.
 */
export function splitPolygonEdge(
  polygons: ReadonlyArray<PmsPolygon>,
  polyIndex: number,
  edgeIndex: 0 | 1 | 2,
  splitPt: { x: number; y: number },
  options?: { splitSharedAdjacents?: boolean }
): PmsPolygon[] {
  const target = polygons[polyIndex];
  if (!target) return [...polygons];

  const vARef = target.vertices[edgeIndex];
  const vBRef = target.vertices[((edgeIndex + 1) % 3) as 0 | 1 | 2];
  const splitAdjacents = options?.splitSharedAdjacents !== false;
  const eps = 0.08;

  const samePt = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.abs(p.x - q.x) <= eps && Math.abs(p.y - q.y) <= eps;

  const splitSingle = (poly: PmsPolygon, eIdx: 0 | 1 | 2): [PmsPolygon, PmsPolygon] => {
    const i0 = eIdx;
    const i1 = ((eIdx + 1) % 3) as 0 | 1 | 2;
    const i2 = ((eIdx + 2) % 3) as 0 | 1 | 2;
    const va = poly.vertices[i0];
    const vb = poly.vertices[i1];
    const vc = poly.vertices[i2];
    const len = Math.max(1e-6, Math.hypot(vb.x - va.x, vb.y - va.y));
    const rawT =
      ((splitPt.x - va.x) * (vb.x - va.x) + (splitPt.y - va.y) * (vb.y - va.y)) / (len * len);
    const t = Math.max(0.05, Math.min(0.95, rawT));
    const mx = va.x + (vb.x - va.x) * t;
    const my = va.y + (vb.y - va.y) * t;
    const vm: PmsVertex = {
      x: mx,
      y: my,
      z: 1,
      rhw: 1,
      color: {
        r: Math.round(va.color.r + (vb.color.r - va.color.r) * t),
        g: Math.round(va.color.g + (vb.color.g - va.color.g) * t),
        b: Math.round(va.color.b + (vb.color.b - va.color.b) * t),
        a: Math.round(va.color.a + (vb.color.a - va.color.a) * t),
      },
      u: va.u + (vb.u - va.u) * t,
      v: va.v + (vb.v - va.v) * t,
    };
    const p1 = rebuildPolygonGeometry(
      { ...poly, vertices: [va, vm, vc], raw: undefined },
      { enforceCw: true }
    );
    const p2 = rebuildPolygonGeometry(
      { ...poly, vertices: [vm, vb, vc], raw: undefined },
      { enforceCw: true }
    );
    return [p1, p2];
  };

  const out: PmsPolygon[] = [];
  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (i === polyIndex) {
      out.push(...splitSingle(poly, edgeIndex));
      continue;
    }
    if (splitAdjacents) {
      let matchedEdge: (0 | 1 | 2) | null = null;
      for (let e = 0 as 0 | 1 | 2; e < 3; e = (e + 1) as 0 | 1 | 2) {
        const p0 = poly.vertices[e];
        const p1 = poly.vertices[((e + 1) % 3) as 0 | 1 | 2];
        if ((samePt(p0, vARef) && samePt(p1, vBRef)) || (samePt(p0, vBRef) && samePt(p1, vARef))) {
          matchedEdge = e;
          break;
        }
      }
      if (matchedEdge !== null) {
        out.push(...splitSingle(poly, matchedEdge));
        continue;
      }
    }
    out.push(poly);
  }
  return out;
}

/**
 * True when both lists hold the same triangles at the same indices (positions and type), i.e. collision sectors
 * built for `baseline` are still valid for `polygons` (colour / texture edits only).
 */
export function hasSameCollisionGeometry(
  polygons: ReadonlyArray<PmsPolygon>,
  baseline: ReadonlyArray<PmsPolygon>
): boolean {
  if (polygons === baseline) return true;
  if (polygons.length !== baseline.length) return false;
  for (let i = 0; i < polygons.length; i++) {
    const p = polygons[i];
    const q = baseline[i];
    if (p === q) continue;
    if (p.polyType !== q.polyType) return false;
    for (let k = 0; k < 3; k++) {
      if (p.vertices[k].x !== q.vertices[k].x || p.vertices[k].y !== q.vertices[k].y) return false;
    }
  }
  return true;
}

/**
 * Prepares a `PmsMapData` document right before `serializePms`:
 * - When `geometryDirty` is false (polygons & sectors untouched), keeps original polygons and sectors verbatim
 *   so non-geometry edits never change a single byte of polygons or collision sectors.
 * - When `geometryDirty` is true, rebuilds the normals of every polygon whose positions, type or
 *   bounciness differ from its file record, and recompiles the sectors unless the triangles still match the
 *   polygons the stored sector table was read or built for (colour / texture-only edits keep it byte for byte).
 * - When `sceneryDirty` is true, deduplicates & compacts the scenery table so there are zero unused/duplicate entries.
 * - Always refreshes `polyBounds`, `fullBounds`, and `startJetGame`.
 */
export function prepareMapForSave(
  map: PmsMapData,
  options?: {
    geometryDirty?: boolean;
    sceneryDirty?: boolean;
  }
): PmsMapData {
  const geometryDirty = Boolean(options?.geometryDirty);
  const sceneryDirty = Boolean(options?.sceneryDirty);

  // Winding is never changed here: a counter-clockwise polygon of an old map that was only recoloured must keep
  // behaving as before in the game. Tools that move geometry already make it clockwise, and the validator offers
  // "Make clockwise" for the rest.
  const polygons = geometryDirty
    ? map.polygons.map((poly) =>
        polygonCollisionMatchesRaw(poly) ? poly : rebuildPolygonGeometry(poly, { enforceCw: false })
      )
    : map.polygons;

  const sectorOwner = sectorTablePolygons(map.sectorsPolys);
  const sectorsStillValid =
    !geometryDirty || Boolean(sectorOwner && hasSameCollisionGeometry(polygons, sectorOwner));
  const sectorInfo = sectorsStillValid
    ? {
        sectorsDivision: map.sectorsDivision,
        sectorsNum: map.sectorsNum,
        sectorsPolys: map.sectorsPolys,
      }
    : compileMapSectors(polygons, { sectorsNum: map.sectorsNum || 25 });

  const propAndScenery = sceneryDirty
    ? compactSceneryTable(map.props, map.scenery, { dropInactiveProps: true })
    : { props: map.props, scenery: map.scenery };

  const bounds = computeMapBounds({
    polygons,
    props: propAndScenery.props,
    scenery: propAndScenery.scenery,
    spawnpoints: map.spawnpoints,
  });

  return {
    ...map,
    startJetGame: Math.floor((119 * (map.startJet || 0)) / 100),
    polygons,
    sectorsDivision: sectorInfo.sectorsDivision,
    sectorsNum: sectorInfo.sectorsNum,
    sectorsPolys: sectorInfo.sectorsPolys,
    props: propAndScenery.props,
    scenery: propAndScenery.scenery,
    polyBounds: bounds.polyBounds,
    fullBounds: bounds.fullBounds,
  };
}

// ---------------------------------------------------------------------------
// Horizontal Symmetry & Mirroring (CTF / Symmetric Arena Builder)
// ---------------------------------------------------------------------------

export interface MirrorTargetIndices {
  polygons: ReadonlyArray<number>;
  props: ReadonlyArray<number>;
  spawns: ReadonlyArray<number>;
  colliders: ReadonlyArray<number>;
  waypoints: ReadonlyArray<number>;
}

export interface MirrorMapOptions {
  mode: 'mirror_copy' | 'flip_in_place';
  axisX: number;
  swapTeams: boolean;
  mirrorUvs?: boolean;
  targets?: MirrorTargetIndices | null; // null / omitted => whole map
}

export interface MirrorMapResult {
  nextMap: PmsMapData;
  resultIndices: {
    polygons: number[];
    props: number[];
    spawns: number[];
    colliders: number[];
    waypoints: number[];
  };
}

function swapTeamPolyType(polyType: number): number {
  switch (polyType) {
    case 10:
      return 12; // ALPHA_BULLETS -> BRAVO_BULLETS
    case 12:
      return 10;
    case 11:
      return 13; // ALPHA_PLAYER -> BRAVO_PLAYER
    case 13:
      return 11;
    case 14:
      return 16; // CHARLIE_BULLETS -> DELTA_BULLETS
    case 16:
      return 14;
    case 15:
      return 17; // CHARLIE_PLAYER -> DELTA_PLAYER
    case 17:
      return 15;
    default:
      return polyType;
  }
}

function swapTeamSpawnType(team: number): number {
  switch (team) {
    case 1:
      return 2; // Alpha Spawn <-> Bravo Spawn
    case 2:
      return 1;
    case 3:
      return 4; // Charlie Spawn <-> Delta Spawn
    case 4:
      return 3;
    case 5:
      return 6; // Alpha Red Flag <-> Bravo Blue Flag
    case 6:
      return 5;
    default:
      return team;
  }
}

function swapTeamWaypointPath(pathNum: number): number {
  if (pathNum === 1) return 2;
  if (pathNum === 2) return 1;
  return pathNum;
}

/**
 * Mirrors selected map elements (or the entire map) across vertical line `X = axisX`.
 * - Preserves strict Clockwise (CW) polygon winding (`[v0', v2', v1']`) and recomputes inward edge normals.
 * - Reflects scenery prop quads accurately across `X = axisX` (`scaleX' = -scaleX`, `rotation' = -rotation`, center mirrored) even when rotated!
 * - Swaps horizontal bot movement flags (`left <-> right`) and optionally swaps Alpha <-> Bravo / Charlie <-> Delta teams!
 */
export function mirrorMapElements(map: PmsMapData, options: MirrorMapOptions): MirrorMapResult {
  const axisX = Number.isFinite(options.axisX) ? options.axisX : 0;
  const mirrorUvs = options.mirrorUvs !== false;
  const swapTeams = Boolean(options.swapTeams);
  const isCopy = options.mode === 'mirror_copy';

  const polyIndices = options.targets
    ? options.targets.polygons.filter((i) => i >= 0 && i < map.polygons.length)
    : map.polygons.map((_, i) => i);
  const propIndices = options.targets
    ? options.targets.props.filter((i) => i >= 0 && i < map.props.length)
    : map.props.map((_, i) => i);
  const spawnIndices = options.targets
    ? options.targets.spawns.filter((i) => i >= 0 && i < map.spawnpoints.length)
    : map.spawnpoints.map((_, i) => i);
  const colIndices = options.targets
    ? options.targets.colliders.filter((i) => i >= 0 && i < map.colliders.length)
    : map.colliders.map((_, i) => i);
  const wpIndices = options.targets
    ? options.targets.waypoints.filter((i) => i >= 0 && i < map.waypoints.length)
    : map.waypoints.map((_, i) => i);

  const mirrorPoly = (poly: PmsPolygon): PmsPolygon => {
    const mv = (v: PmsVertex): PmsVertex => ({
      ...v,
      x: 2 * axisX - v.x,
      y: v.y,
      u: mirrorUvs ? -v.u : v.u,
      v: v.v,
    });
    // Swap v1 and v2 so CW triangle remains strictly CW after horizontal reflection!
    const reversed: [PmsVertex, PmsVertex, PmsVertex] = [
      mv(poly.vertices[0]),
      mv(poly.vertices[2]),
      mv(poly.vertices[1]),
    ];
    return rebuildPolygonGeometry(
      {
        ...poly,
        vertices: reversed,
        polyType: swapTeams ? swapTeamPolyType(poly.polyType) : poly.polyType,
        raw: undefined,
      },
      { enforceCw: true }
    );
  };

  const mirrorProp = (p: PmsProp, newIndex: number): PmsProp => {
    const w = p.width !== 0 ? p.width : 64;
    const h = p.height !== 0 ? p.height : 64;
    const oldCorners = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
    const oldCx = (oldCorners[0] + oldCorners[4]) * 0.5;
    const oldCy = (oldCorners[1] + oldCorners[5]) * 0.5;
    const targetCx = 2 * axisX - oldCx;
    const targetCy = oldCy;

    const newScaleX = -p.scaleX;
    const newRotation = -p.rotation;
    const tempCorners = computePropCorners(p.x, p.y, w, h, newScaleX, p.scaleY, newRotation);
    const tempCx = (tempCorners[0] + tempCorners[4]) * 0.5;
    const tempCy = (tempCorners[1] + tempCorners[5]) * 0.5;

    const { raw: _raw, ...rest } = p;
    return {
      ...rest,
      index: newIndex,
      x: p.x + (targetCx - tempCx),
      y: p.y + (targetCy - tempCy),
      scaleX: newScaleX,
      rotation: newRotation,
    };
  };

  const mirrorSpawn = (sp: PmsSpawnpoint, newIndex: number): PmsSpawnpoint => {
    const { raw: _raw, ...rest } = sp;
    return {
      ...rest,
      index: newIndex,
      x: Math.round(2 * axisX - sp.x),
      y: sp.y,
      team: swapTeams ? swapTeamSpawnType(sp.team) : sp.team,
    };
  };

  const mirrorCollider = (col: PmsCollider, newIndex: number): PmsCollider => {
    const { raw: _raw, ...rest } = col;
    return {
      ...rest,
      index: newIndex,
      x: 2 * axisX - col.x,
      y: col.y,
    };
  };

  const nextPolygons = [...map.polygons];
  const outPolyIndices: number[] = [];
  if (isCopy) {
    for (const idx of polyIndices) {
      outPolyIndices.push(nextPolygons.length);
      nextPolygons.push(mirrorPoly(map.polygons[idx]));
    }
  } else {
    for (const idx of polyIndices) {
      nextPolygons[idx] = mirrorPoly(map.polygons[idx]);
      outPolyIndices.push(idx);
    }
  }

  const nextProps = [...map.props];
  const outPropIndices: number[] = [];
  if (isCopy) {
    for (const idx of propIndices) {
      const newIdx = nextProps.length;
      outPropIndices.push(newIdx);
      nextProps.push(mirrorProp(map.props[idx], newIdx));
    }
  } else {
    for (const idx of propIndices) {
      nextProps[idx] = mirrorProp(map.props[idx], idx);
      outPropIndices.push(idx);
    }
  }

  const nextSpawns = [...map.spawnpoints];
  const outSpawnIndices: number[] = [];
  if (isCopy) {
    for (const idx of spawnIndices) {
      const newIdx = nextSpawns.length;
      outSpawnIndices.push(newIdx);
      nextSpawns.push(mirrorSpawn(map.spawnpoints[idx], newIdx));
    }
  } else {
    for (const idx of spawnIndices) {
      nextSpawns[idx] = mirrorSpawn(map.spawnpoints[idx], idx);
      outSpawnIndices.push(idx);
    }
  }

  const nextColliders = [...map.colliders];
  const outColIndices: number[] = [];
  if (isCopy) {
    for (const idx of colIndices) {
      const newIdx = nextColliders.length;
      outColIndices.push(newIdx);
      nextColliders.push(mirrorCollider(map.colliders[idx], newIdx));
    }
  } else {
    for (const idx of colIndices) {
      nextColliders[idx] = mirrorCollider(map.colliders[idx], idx);
      outColIndices.push(idx);
    }
  }

  const nextWaypoints = [...map.waypoints];
  const outWpIndices: number[] = [];
  if (isCopy) {
    const oldOneBasedToMirroredOneBased = new Map<number, number>();
    const startOneBased = nextWaypoints.length + 1;
    for (let k = 0; k < wpIndices.length; k++) {
      const srcIdx = wpIndices[k];
      oldOneBasedToMirroredOneBased.set(srcIdx + 1, startOneBased + k);
    }
    for (let k = 0; k < wpIndices.length; k++) {
      const wp = map.waypoints[wpIndices[k]];
      const newZeroIdx = nextWaypoints.length;
      const newOneBased = newZeroIdx + 1;
      const remappedConns: number[] = [];
      for (const c of wp.connections) {
        const mapped = oldOneBasedToMirroredOneBased.get(c);
        if (mapped && mapped !== newOneBased) remappedConns.push(mapped);
      }
      const { raw: _raw, ...rest } = wp;
      outWpIndices.push(newZeroIdx);
      nextWaypoints.push({
        ...rest,
        index: newOneBased,
        id: newOneBased,
        x: Math.round(2 * axisX - wp.x),
        y: wp.y,
        left: wp.right,
        right: wp.left,
        pathNum: swapTeams ? swapTeamWaypointPath(wp.pathNum) : wp.pathNum,
        connections: remappedConns,
      });
    }
  } else {
    for (const idx of wpIndices) {
      const wp = nextWaypoints[idx];
      const { raw: _raw, ...rest } = wp;
      nextWaypoints[idx] = {
        ...rest,
        x: Math.round(2 * axisX - wp.x),
        y: wp.y,
        left: wp.right,
        right: wp.left,
        pathNum: swapTeams ? swapTeamWaypointPath(wp.pathNum) : wp.pathNum,
      };
      outWpIndices.push(idx);
    }
  }

  const bounds = computeMapBounds({
    polygons: nextPolygons,
    props: nextProps,
    scenery: map.scenery,
    spawnpoints: nextSpawns,
  });

  return {
    nextMap: {
      ...map,
      polygons: nextPolygons,
      props: nextProps,
      spawnpoints: nextSpawns,
      colliders: nextColliders,
      waypoints: nextWaypoints,
      polyBounds: bounds.polyBounds,
      fullBounds: bounds.fullBounds,
    },
    resultIndices: {
      polygons: outPolyIndices,
      props: outPropIndices,
      spawns: outSpawnIndices,
      colliders: outColIndices,
      waypoints: outWpIndices,
    },
  };
}
