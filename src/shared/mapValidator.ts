import { hasInwardNormals, polygonSignedArea2 } from './pmsCompiler';
import {
  checkSoldatMapLimits,
  computePropAabb,
  isPropRenderable,
  PmsBounds,
  PmsMapData,
  PmsPolygon,
  PmsVertex,
} from './pmsParser';
import { SOLDIER_COLLISION } from './soldatConstants';

/**
 * Polygon types that block every player in OpenSoldat (`PolyMap.pas`).
 * Excluded: 1 (only bullets), 3 (doesn't collide), 10/12/14/16 (team bullets), 23 (only flags), 24/25 (background),
 * and the team / flag-carrier walls 11/13/15/17/21 that only stop some players.
 */
export const PLAYER_SOLID_POLY_TYPES = new Set<number>([0, 2, 4, 5, 6, 7, 8, 9, 18, 19, 20, 22]);

const TEAM_WALL_FOR_TEAM: Record<number, number> = { 1: 11, 2: 13, 3: 15, 4: 17 };
// What a flag (an item) rests on: normal ground plus the "only flags collide" type
const FLAG_SOLID_POLY_TYPES = new Set<number>([0, 4, 5, 6, 7, 8, 9, 18, 19, 20, 23]);

export interface ValidationSelectionTarget {
  polygons: number[];
  vertices: Array<{ polyIndex: number; vertexIndex: 0 | 1 | 2 }>;
  props: number[];
  spawns: number[];
  colliders: number[];
  waypoints: number[];
}

/** error: the game rejects or breaks the map; warning: likely a mistake; hint: worth a look, often intentional */
export type ValidationSeverity = 'error' | 'warning' | 'hint';
export type ValidationFixKind = 'repair_normals' | 'delete_polygons';

export interface MapValidationIssue {
  id: string;
  severity: ValidationSeverity;
  messageKey: string;
  messageParams?: Record<string, string | number>;
  selection?: ValidationSelectionTarget;
  focusBounds?: PmsBounds;
  focusPoint?: { x: number; y: number; radius?: number };
  fix?: { kind: ValidationFixKind; polygons: number[] };
}

const MAX_BURIED_SPAWNS_REPORTED = 12;
const MAX_NARROW_GAPS_REPORTED = 20;

function emptyTarget(): ValidationSelectionTarget {
  return {
    polygons: [],
    vertices: [],
    props: [],
    spawns: [],
    colliders: [],
    waypoints: [],
  };
}

function boundsAroundPoint(x: number, y: number, pad = 90): PmsBounds {
  return {
    left: x - pad,
    right: x + pad,
    top: y - pad,
    bottom: y + pad,
    width: pad * 2,
    height: pad * 2,
  };
}

/** Union of the polygons' boxes (the first 200), padded */
function boundsAroundPolygons(polys: ReadonlyArray<PmsPolygon>, pad = 60): PmsBounds {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of polys.slice(0, 200)) {
    for (const v of p.vertices) {
      if (v.x < left) left = v.x;
      if (v.x > right) right = v.x;
      if (v.y < top) top = v.y;
      if (v.y > bottom) bottom = v.y;
    }
  }
  left -= pad;
  right += pad;
  top -= pad;
  bottom += pad;
  return { left, right, top, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function centroid(p: PmsPolygon): { x: number; y: number } {
  const [a, b, c] = p.vertices;
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

/** Grouped issue for many polygons of one kind: selects them all and focuses the first */
function polygonGroupIssue(
  map: PmsMapData,
  indices: number[],
  base: Omit<MapValidationIssue, 'selection' | 'focusBounds' | 'focusPoint'>
): MapValidationIssue {
  const first = map.polygons[indices[0]];
  const c = centroid(first);
  return {
    ...base,
    selection: { ...emptyTarget(), polygons: indices },
    focusBounds: boundsAroundPolygons(indices.length > 1 ? [first] : indices.map((i) => map.polygons[i]), 80),
    focusPoint: { x: c.x, y: c.y, radius: 22 },
  };
}

function pointInTriangleInclusive(
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

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; cx: number; cy: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { dist: Math.hypot(px - ax, py - ay), cx: ax, cy: ay, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy, t };
}

/** Coarse uniform grid of triangles for point queries (numeric keys, no string building per lookup) */
class TriangleGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly big: number[] = [];
  constructor(
    private readonly polys: ReadonlyArray<PmsPolygon>,
    indices: ReadonlyArray<number>,
    private readonly cell = 64
  ) {
    for (const i of indices) {
      const [a, b, c] = polys[i].vertices;
      const gx0 = Math.floor(Math.min(a.x, b.x, c.x) / cell);
      const gx1 = Math.floor(Math.max(a.x, b.x, c.x) / cell);
      const gy0 = Math.floor(Math.min(a.y, b.y, c.y) / cell);
      const gy1 = Math.floor(Math.max(a.y, b.y, c.y) / cell);
      if (!Number.isFinite(gx0 + gx1 + gy0 + gy1)) continue;
      if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 1024) {
        this.big.push(i);
        continue;
      }
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = gx * 1_000_003 + gy;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  /** First triangle of the grid containing the point (edges included), or -1 */
  public findContaining(x: number, y: number): number {
    const key = Math.floor(x / this.cell) * 1_000_003 + Math.floor(y / this.cell);
    for (const list of [this.cells.get(key), this.big]) {
      if (!list) continue;
      for (const i of list) {
        const [a, b, c] = this.polys[i].vertices;
        if (pointInTriangleInclusive(x, y, a, b, c)) return i;
      }
    }
    return -1;
  }
}

/**
 * Runs validation checks on an editor map document:
 * - Engine limits and string lengths (errors)
 * - Counter-clockwise triangles (the game's collision misses them) and missing files (warnings)
 * - CTF rules for `ctf_` maps or maps with both flags, spawns buried inside walls (warnings / errors)
 * - Degenerate, duplicate and huge triangles (hints, grouped; often harmless in real maps)
 * - Narrow gaps between walls (hints, only with `includeHints`: costly and mostly intentional)
 */
export function validateMapDocument(
  map: PmsMapData,
  options?: {
    knownTexturesLower?: ReadonlySet<string> | null;
    knownSceneriesLower?: ReadonlySet<string> | null;
    mapBaseName?: string | null;
    includeHints?: boolean;
  }
): MapValidationIssue[] {
  const issues: MapValidationIssue[] = [];
  const includeHints = Boolean(options?.includeHints);

  // 1. Soldat Engine Limits
  const limitViolations = checkSoldatMapLimits({
    polygonCount: map.polygons.length,
    sectorsNum: map.sectorsNum,
    propCount: map.props.length,
    sceneryCount: map.scenery.length,
    colliderCount: map.colliders.length,
    spawnCount: map.spawnpoints.length,
  });
  for (const v of limitViolations) {
    issues.push({
      id: `limit_${v.key}`,
      severity: 'error',
      messageKey: 'Engine limit exceeded — {label}: {value} / {limit}',
      messageParams: { label: v.label, value: v.value, limit: v.limit },
    });
  }
  if (map.waypoints.length > 5000) {
    issues.push({
      id: 'limit_waypoints',
      severity: 'error',
      messageKey: 'Engine limit exceeded — Bot waypoints: {value} / {limit}',
      messageParams: { value: map.waypoints.length, limit: 5000 },
    });
  }
  if (map.texture.length > 24) {
    issues.push({
      id: 'limit_texture_len',
      severity: 'error',
      messageKey: 'Main texture name "{name}" exceeds 24 characters.',
      messageParams: { name: map.texture },
    });
  }

  // 2. Polygon geometry health: grouped per kind, so a map with many old quirks shows one line each
  let maxAbs = 0;
  for (const poly of map.polygons) {
    for (const v of poly.vertices) {
      if (Math.abs(v.x) < 1e6 && Math.abs(v.y) < 1e6) {
        maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
      }
    }
  }
  const estDiv = map.polygons.length === 0 ? 128 : Math.max(1, Math.floor((maxAbs + 100) / 25));

  const outwardNormals: number[] = [];
  const degenerate: number[] = [];
  const duplicates: number[] = [];
  const giant: number[] = [];
  const seenTriangles = new Map<string, number>();

  for (let i = 0; i < map.polygons.length; i++) {
    const poly = map.polygons[i];
    const [v0, v1, v2] = poly.vertices;
    const area2 = polygonSignedArea2(v0, v1, v2);
    if (Math.abs(area2) * 0.5 < 1.0) {
      degenerate.push(i);
      continue;
    }
    // The game tests points against the stored normals (either winding works if they point inward)
    if (poly.polyType !== 3 && poly.polyType !== 24 && poly.polyType !== 25 && !hasInwardNormals(poly)) {
      outwardNormals.push(i);
    }

    // A true duplicate repeats the same corners with the same type, colours and texture coordinates;
    // copies that differ in any of these are deliberate layering
    const corners = [v0, v1, v2]
      .map(
        (v: PmsVertex) =>
          `${Math.round(v.x * 4)},${Math.round(v.y * 4)},${v.color.r},${v.color.g},${v.color.b},${v.color.a},${Math.round(v.u * 1000)},${Math.round(v.v * 1000)}`
      )
      .sort()
      .join('|');
    const key = `${poly.polyType}|${corners}`;
    if (seenTriangles.has(key)) duplicates.push(i);
    else seenTriangles.set(key, i);

    if (poly.polyType !== 3) {
      const spanX = Math.ceil((Math.max(v0.x, v1.x, v2.x) - Math.min(v0.x, v1.x, v2.x)) / estDiv) + 1;
      const spanY = Math.ceil((Math.max(v0.y, v1.y, v2.y) - Math.min(v0.y, v1.y, v2.y)) / estDiv) + 1;
      if (spanX >= 6 && spanY >= 6 && spanX * spanY > 225) giant.push(i);
    }
  }

  if (outwardNormals.length > 0) {
    issues.push(
      polygonGroupIssue(map, outwardNormals, {
        id: 'poly_normals',
        severity: 'warning',
        messageKey:
          outwardNormals.length === 1
            ? 'Polygon #{num} has collision normals pointing outward: players pass through it in the game. "Fix" recomputes them.'
            : '{count} polygons have collision normals pointing outward: players pass through them in the game. "Fix" recomputes them.',
        messageParams: { num: outwardNormals[0] + 1, count: outwardNormals.length },
        fix: { kind: 'repair_normals', polygons: outwardNormals },
      })
    );
  }
  if (degenerate.length > 0) {
    issues.push(
      polygonGroupIssue(map, degenerate, {
        id: 'poly_degenerate',
        severity: 'hint',
        messageKey:
          degenerate.length === 1
            ? 'Polygon #{num} has almost no area (invisible, no collision).'
            : '{count} polygons have almost no area (invisible, no collision).',
        messageParams: { num: degenerate[0] + 1, count: degenerate.length },
        fix: { kind: 'delete_polygons', polygons: degenerate },
      })
    );
  }
  if (duplicates.length > 0) {
    issues.push(
      polygonGroupIssue(map, duplicates, {
        id: 'poly_dup',
        severity: 'hint',
        messageKey:
          duplicates.length === 1
            ? 'Polygon #{num} is an exact copy of another triangle (same place, type and colours).'
            : '{count} polygons are exact copies of other triangles (same place, type and colours).',
        messageParams: { num: duplicates[0] + 1, count: duplicates.length },
        fix: { kind: 'delete_polygons', polygons: duplicates },
      })
    );
  }
  if (giant.length > 0) {
    issues.push(
      polygonGroupIssue(map, giant, {
        id: 'poly_giant',
        severity: 'hint',
        messageKey:
          giant.length === 1
            ? 'Polygon #{num} covers a very large area of collision sectors; splitting it can make collisions cheaper.'
            : '{count} polygons cover very large areas of collision sectors; splitting them can make collisions cheaper.',
        messageParams: { num: giant[0] + 1, count: giant.length },
      })
    );
  }

  // 3. Missing Assets (Main texture & Scenery files)
  if (options?.knownTexturesLower && options.knownTexturesLower.size > 0 && map.texture.trim()) {
    const texLower = map.texture.trim().toLowerCase();
    const stem = texLower.replace(/\.[^.]+$/, '');
    const found =
      options.knownTexturesLower.has(texLower) ||
      options.knownTexturesLower.has(`${stem}.bmp`) ||
      options.knownTexturesLower.has(`${stem}.png`);
    if (!found) {
      issues.push({
        id: 'missing_main_texture',
        severity: 'warning',
        messageKey: 'Main texture "{name}" was not found in textures/.',
        messageParams: { name: map.texture },
      });
    }
  }

  if (options?.knownSceneriesLower && options.knownSceneriesLower.size > 0) {
    const propsByMissingScenery = new Map<string, { name: string; props: number[] }>();
    for (let pi = 0; pi < map.props.length; pi++) {
      const p = map.props[pi];
      if (!isPropRenderable(p, map.scenery.length)) continue;
      const scName = map.scenery[p.style - 1]?.filename?.trim();
      if (!scName) continue;
      const lower = scName.toLowerCase();
      const stem = lower.replace(/\.[^.]+$/, '');
      const exists =
        options.knownSceneriesLower.has(lower) ||
        options.knownSceneriesLower.has(`${stem}.bmp`) ||
        options.knownSceneriesLower.has(`${stem}.png`);
      if (!exists) {
        let entry = propsByMissingScenery.get(lower);
        if (!entry) propsByMissingScenery.set(lower, (entry = { name: scName, props: [] }));
        entry.props.push(pi);
      }
    }

    for (const { name, props: propIndices } of propsByMissingScenery.values()) {
      const aabb = computePropAabb(map.props[propIndices[0]]);
      issues.push({
        id: `missing_scenery_${propIndices[0]}`,
        severity: 'warning',
        messageKey: 'Missing scenery "{name}" (used by {count} props).',
        messageParams: { name, count: propIndices.length },
        selection: { ...emptyTarget(), props: propIndices },
        focusBounds: {
          left: aabb.left - 80,
          right: aabb.right + 80,
          top: aabb.top - 80,
          bottom: aabb.bottom + 80,
          width: aabb.width + 160,
          height: aabb.height + 160,
        },
        focusPoint: {
          x: (aabb.left + aabb.right) * 0.5,
          y: (aabb.top + aabb.bottom) * 0.5,
          radius: 28,
        },
      });
    }
  }

  // 4. Gameplay & Mode Checks (Spawns & Flags)
  const activeSpawns = map.spawnpoints.filter((s) => s.active);
  const playerSpawns = activeSpawns.filter((s) => s.team >= 0 && s.team <= 4);
  const hasAlphaFlag = activeSpawns.some((s) => s.team === 5);
  const hasBravoFlag = activeSpawns.some((s) => s.team === 6);
  const hasAlphaSpawn = activeSpawns.some((s) => s.team === 1);
  const hasBravoSpawn = activeSpawns.some((s) => s.team === 2);

  // A single flag alone is common outside CTF (e.g. the finish of a climb map), so it does not make a CTF map
  const baseLower = (options?.mapBaseName ?? '').toLowerCase();
  const isCtfContext = baseLower.startsWith('ctf_') || (hasAlphaFlag && hasBravoFlag);

  if (map.polygons.length > 0 && playerSpawns.length === 0) {
    issues.push({
      id: 'gameplay_no_spawns',
      severity: 'warning',
      messageKey: 'Map has no player spawn points (types 0–4).',
    });
  }

  if (isCtfContext) {
    if (!hasAlphaFlag) {
      issues.push({
        id: 'ctf_missing_alpha_flag',
        severity: 'error',
        messageKey: 'CTF map is missing the Alpha (Red) Flag (spawn type 5).',
      });
    }
    if (!hasBravoFlag) {
      issues.push({
        id: 'ctf_missing_bravo_flag',
        severity: 'error',
        messageKey: 'CTF map is missing the Bravo (Blue) Flag (spawn type 6).',
      });
    }
    if (!hasAlphaSpawn) {
      issues.push({
        id: 'ctf_missing_alpha_spawn',
        severity: 'warning',
        messageKey: 'CTF map has no Alpha team spawn points (type 1).',
      });
    }
    if (!hasBravoSpawn) {
      issues.push({
        id: 'ctf_missing_bravo_spawn',
        severity: 'warning',
        messageKey: 'CTF map has no Bravo team spawn points (type 2).',
      });
    }
  }

  // 5. Spawns buried inside walls. Solidity depends on who spawns there (team walls stop only their own team,
  // flag-carrier walls nobody who just spawned), and the spawn counts as buried only when small steps around it
  // in every direction are solid too: a spawn resting on a floor or sitting on a seam between two triangles is fine
  const polygonsSolidFor = (isSolid: (polyType: number) => boolean): number[] => {
    const out: number[] = [];
    map.polygons.forEach((p, i) => {
      if (isSolid(p.polyType) && Math.abs(polygonSignedArea2(p.vertices[0], p.vertices[1], p.vertices[2])) >= 2) {
        out.push(i);
      }
    });
    return out;
  };
  const gridCache = new Map<string, TriangleGrid>();
  const gridFor = (spawnType: number): TriangleGrid => {
    const key = spawnType >= 1 && spawnType <= 4 ? `team${spawnType}` : spawnType <= 4 ? 'general' : 'flag';
    let grid = gridCache.get(key);
    if (!grid) {
      const teamWall = TEAM_WALL_FOR_TEAM[spawnType];
      const isSolid =
        key === 'flag'
          ? (t: number) => FLAG_SOLID_POLY_TYPES.has(t)
          : (t: number) => PLAYER_SOLID_POLY_TYPES.has(t) || (teamWall !== undefined && t === teamWall);
      grid = new TriangleGrid(map.polygons, polygonsSolidFor(isSolid));
      gridCache.set(key, grid);
    }
    return grid;
  };

  const PROBE = 3;
  let buriedSpawnsReported = 0;
  for (let si = 0; si < map.spawnpoints.length && buriedSpawnsReported < MAX_BURIED_SPAWNS_REPORTED; si++) {
    const sp = map.spawnpoints[si];
    if (!sp.active) continue;
    // Player spawns (0..4) and flags (5, 6 and the yellow HTF flag 14)
    if (!(sp.team <= 6 || sp.team === 14)) continue;
    const grid = gridFor(sp.team);
    const hit = grid.findContaining(sp.x, sp.y);
    if (hit < 0) continue;
    const enclosed =
      grid.findContaining(sp.x - PROBE, sp.y) >= 0 &&
      grid.findContaining(sp.x + PROBE, sp.y) >= 0 &&
      grid.findContaining(sp.x, sp.y - PROBE) >= 0 &&
      grid.findContaining(sp.x, sp.y + PROBE) >= 0;
    if (!enclosed) continue;
    issues.push({
      id: `spawn_inside_poly_${si}`,
      severity: 'warning',
      messageKey: 'Spawn #{num} is buried inside solid polygon #{poly}.',
      messageParams: { num: si + 1, poly: hit + 1 },
      selection: { ...emptyTarget(), spawns: [si], polygons: [hit] },
      focusBounds: boundsAroundPoint(sp.x, sp.y, 100),
      focusPoint: { x: sp.x, y: sp.y, radius: 22 },
    });
    buriedSpawnsReported++;
  }

  // 6. Narrow gaps between walls facing each other across open air (hints, on request)
  if (includeHints) issues.push(...findNarrowGaps(map));

  return issues;
}

/**
 * Gaps narrower than the soldier's collision box (7 wide, 14 high) between two solid walls that face each other.
 * Walls touching at a shared corner (notches inside one shape) are ignored.
 */
function findNarrowGaps(map: PmsMapData): MapValidationIssue[] {
  interface SolidEdge {
    polyIdx: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    inwardX: number;
    inwardY: number;
  }
  const solid: number[] = [];
  map.polygons.forEach((p, i) => {
    if (PLAYER_SOLID_POLY_TYPES.has(p.polyType) && polygonSignedArea2(p.vertices[0], p.vertices[1], p.vertices[2]) > 0) {
      solid.push(i);
    }
  });
  if (solid.length === 0 || solid.length > 5000) return [];

  const directedEdgeKey = (x1: number, y1: number, x2: number, y2: number) =>
    `${Math.round(x1 * 2)},${Math.round(y1 * 2)}->${Math.round(x2 * 2)},${Math.round(y2 * 2)}`;
  const directedEdges = new Set<string>();
  for (const pi of solid) {
    const vs = map.polygons[pi].vertices;
    for (let e = 0; e < 3; e++) {
      directedEdges.add(directedEdgeKey(vs[e].x, vs[e].y, vs[(e + 1) % 3].x, vs[(e + 1) % 3].y));
    }
  }

  const edges: SolidEdge[] = [];
  const cellSize = 32;
  const grid = new Map<number, number[]>();
  const cellKey = (gx: number, gy: number) => gx * 1_000_003 + gy;
  for (const pi of solid) {
    const vs = map.polygons[pi].vertices;
    for (let e = 0; e < 3; e++) {
      const va = vs[e];
      const vb = vs[(e + 1) % 3];
      if (directedEdges.has(directedEdgeKey(vb.x, vb.y, va.x, va.y))) continue; // seam inside a mesh
      const dx = vb.x - va.x;
      const dy = vb.y - va.y;
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;
      const idx = edges.length;
      edges.push({ polyIdx: pi, ax: va.x, ay: va.y, bx: vb.x, by: vb.y, inwardX: -dy / len, inwardY: dx / len });
      // Long edges are registered along their length only (not their whole bounding box)
      const steps = Math.max(1, Math.ceil(len / cellSize));
      const seen = new Set<number>();
      for (let s = 0; s <= steps; s++) {
        const x = va.x + (dx * s) / steps;
        const y = va.y + (dy * s) / steps;
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const key = cellKey(Math.floor(x / cellSize) + ox, Math.floor(y / cellSize) + oy);
            if (seen.has(key)) continue;
            seen.add(key);
            let bucket = grid.get(key);
            if (!bucket) grid.set(key, (bucket = []));
            bucket.push(idx);
          }
        }
      }
    }
  }

  const sharesCorner = (p: number, q: number) => {
    const a = map.polygons[p].vertices;
    const b = map.polygons[q].vertices;
    for (const u of a) for (const v of b) if (Math.abs(u.x - v.x) < 0.5 && Math.abs(u.y - v.y) < 0.5) return true;
    return false;
  };

  const out: MapValidationIssue[] = [];
  const reportedCells = new Set<string>();
  // Probe both ends' neighbourhood and the middle of every boundary edge, so the result does not depend on order
  for (let i = 0; i < edges.length && out.length < MAX_NARROW_GAPS_REPORTED; i++) {
    const e1 = edges[i];
    const outX = -e1.inwardX;
    const outY = -e1.inwardY;
    for (const t of [0.2, 0.5, 0.8]) {
      const mx = e1.ax + (e1.bx - e1.ax) * t;
      const my = e1.ay + (e1.by - e1.ay) * t;
      const bucket = grid.get(cellKey(Math.floor(mx / cellSize), Math.floor(my / cellSize)));
      if (!bucket) continue;
      let reported = false;
      for (const j of bucket) {
        if (j === i) continue;
        const e2 = edges[j];
        if (e2.polyIdx === e1.polyIdx) continue;
        if (e1.inwardX * e2.inwardX + e1.inwardY * e2.inwardY > -0.55) continue; // must face each other
        const proj = pointToSegmentDist(mx, my, e2.ax, e2.ay, e2.bx, e2.by);
        if (proj.t <= 0.05 || proj.t >= 0.95) continue;
        const dirX = proj.cx - mx;
        const dirY = proj.cy - my;
        if (dirX * outX + dirY * outY <= 0.5) continue; // the gap must be open air, not through a wall
        const horizontalGap = Math.abs(outX) >= Math.abs(outY);
        const minClearance = horizontalGap ? SOLDIER_COLLISION.width : SOLDIER_COLLISION.height;
        if (proj.dist <= 1.0 || proj.dist >= minClearance - 0.15) continue;
        if (sharesCorner(e1.polyIdx, e2.polyIdx)) continue;
        const gapMidX = (mx + proj.cx) * 0.5;
        const gapMidY = (my + proj.cy) * 0.5;
        const dedupe = `${Math.round(gapMidX / 24)},${Math.round(gapMidY / 24)}`;
        if (reportedCells.has(dedupe)) continue;
        reportedCells.add(dedupe);
        const [p1, p2] = e1.polyIdx < e2.polyIdx ? [e1.polyIdx, e2.polyIdx] : [e2.polyIdx, e1.polyIdx];
        out.push({
          id: `narrow_passage_${p1}_${p2}_${out.length}`,
          severity: 'hint',
          messageKey:
            'Narrow {gap} u passage between polygons #{p1} & #{p2} blocks soldier collision ({req} u needed).',
          messageParams: { gap: proj.dist.toFixed(1), p1: p1 + 1, p2: p2 + 1, req: minClearance },
          selection: { ...emptyTarget(), polygons: [p1, p2] },
          focusBounds: boundsAroundPoint(gapMidX, gapMidY, 90),
          focusPoint: { x: gapMidX, y: gapMidY, radius: 18 },
        });
        reported = true;
        break;
      }
      if (reported) break;
    }
  }
  return out;
}
