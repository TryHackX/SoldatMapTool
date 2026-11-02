import {
  computePolygonNormals,
  createPolygonFromPoints,
  earClipTriangulate,
  polygonSignedArea2,
} from './pmsCompiler';
import { PmsMapData, PmsPolygon, PmsVertex, SOLDAT_MAP_LIMITS } from './pmsParser';
import { RgbaColor } from './soldatConstants';

export interface SurfaceCrustOptions {
  /** Thickness of the extruded grass/snow/ice top crust in world units (default 12) */
  thickness?: number;
  /** Minimum upward normal component (0..1) to qualify as a walkable top surface (default 0.35) */
  minUpwardDot?: number;
  /** Polygon type of the generated crust (default 0 = Normal, or 4 = Ice) */
  crustPolyType?: number;
  bounciness?: number;
  /** Top outer edge color (e.g. bright grass green or snow white) */
  topColor?: RgbaColor;
  /** Bottom inner seam color (blends into underlying rock) */
  bottomColor?: RgbaColor;
  /** Offset outward (> 0 sits above surface, < 0 embeds into rock; default 4) */
  outwardOffset?: number;
  texWidth?: number;
  texHeight?: number;
}

/**
 * Finds all exposed upward-facing boundary edges on target polygons and extrudes a
 * Soldat-style grass / snow / ice crust strip with smooth top-to-bottom vertex color blending.
 */
export function generateSurfaceCrust(
  map: PmsMapData,
  targetPolygonIndices: ReadonlyArray<number>,
  options?: SurfaceCrustOptions
): PmsPolygon[] {
  const indices =
    targetPolygonIndices.length > 0
      ? targetPolygonIndices.filter((i) => i >= 0 && i < map.polygons.length)
      : map.polygons.map((_, i) => i);
  if (indices.length === 0) return [];
  const crustTargets = indices.filter((i) => {
    const t = map.polygons[i]?.polyType;
    return t !== undefined && t !== 1 && t !== 3 && t !== 24 && t !== 25;
  });
  if (crustTargets.length === 0) return [];

  const thickness = Math.max(2, Math.min(128, options?.thickness ?? 12));
  const outwardOffset = options?.outwardOffset ?? 4;
  const minUpwardDot = options?.minUpwardDot ?? 0.35;
  const polyType = options?.crustPolyType ?? 0;
  const bounciness = options?.bounciness ?? 1;
  const topColor = options?.topColor ?? { r: 92, g: 196, b: 74, a: 255 };
  const bottomColor = options?.bottomColor ?? { r: 44, g: 98, b: 42, a: 255 };
  const tw = options?.texWidth ?? 128;
  const th = options?.texHeight ?? 128;

  // Identify internal shared seams (opposite directed edges) so crust only forms on exposed air boundaries!
  const edgeKey = (x1: number, y1: number, x2: number, y2: number) =>
    `${Math.round(x1 * 4)},${Math.round(y1 * 4)}->${Math.round(x2 * 4)},${Math.round(y2 * 4)}`;

  const allDirected = new Set<string>();
  for (let i = 0; i < map.polygons.length; i++) {
    const p = map.polygons[i];
    if (p.polyType === 24 || p.polyType === 25) continue;
    const vs = p.vertices;
    for (let e = 0; e < 3; e++) {
      allDirected.add(edgeKey(vs[e].x, vs[e].y, vs[(e + 1) % 3].x, vs[(e + 1) % 3].y));
    }
  }

  interface TopSegment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    outX: number;
    outY: number;
  }

  const segments: TopSegment[] = [];
  for (const pi of crustTargets) {
    const poly = map.polygons[pi];
    if (!poly) continue;
    const vs = poly.vertices;
    if (polygonSignedArea2(vs[0], vs[1], vs[2]) <= 0) continue;

    for (let e = 0; e < 3; e++) {
      const va = vs[e];
      const vb = vs[(e + 1) % 3];
      if (allDirected.has(edgeKey(vb.x, vb.y, va.x, va.y))) continue; // shared interior edge

      const dx = vb.x - va.x;
      const dy = vb.y - va.y;
      const len = Math.hypot(dx, dy);
      if (len < 3) continue;

      // In CW Y-down space, inward normal is (-dy/len, dx/len), so outward normal into air is (dy/len, -dx/len).
      // An upward-facing floor has outward normal pointing toward -Y (outY <= -minUpwardDot).
      const outX = dy / len;
      const outY = -dx / len;
      if (-outY >= minUpwardDot) {
        segments.push({ ax: va.x, ay: va.y, bx: vb.x, by: vb.y, outX, outY });
      }
    }
  }

  if (segments.length === 0) return [];

  // Average outward miter vectors at shared vertices so connected slopes form seamless continuous crusts!
  const vKey = (x: number, y: number) => `${Math.round(x * 4)},${Math.round(y * 4)}`;
  const vertexNormalSum = new Map<string, { x: number; y: number }>();
  const accumNormal = (x: number, y: number, nx: number, ny: number) => {
    const k = vKey(x, y);
    const cur = vertexNormalSum.get(k);
    if (cur) {
      cur.x += nx;
      cur.y += ny;
    } else {
      vertexNormalSum.set(k, { x: nx, y: ny });
    }
  };

  for (const s of segments) {
    accumNormal(s.ax, s.ay, s.outX, s.outY);
    accumNormal(s.bx, s.by, s.outX, s.outY);
  }

  const getMiter = (x: number, y: number, fallbackX: number, fallbackY: number) => {
    const sum = vertexNormalSum.get(vKey(x, y));
    if (!sum) return { x: fallbackX, y: fallbackY };
    const len = Math.hypot(sum.x, sum.y);
    if (len < 1e-4) return { x: fallbackX, y: fallbackY };
    return { x: sum.x / len, y: sum.y / len };
  };

  const innerOffset = outwardOffset - thickness;
  const crustPolys: PmsPolygon[] = [];

  for (const s of segments) {
    const na = getMiter(s.ax, s.ay, s.outX, s.outY);
    const nb = getMiter(s.bx, s.by, s.outX, s.outY);

    const aTop = { x: s.ax + na.x * outwardOffset, y: s.ay + na.y * outwardOffset };
    const bTop = { x: s.bx + nb.x * outwardOffset, y: s.by + nb.y * outwardOffset };
    const bBot = { x: s.bx + nb.x * innerOffset, y: s.by + nb.y * innerOffset };
    const aBot = { x: s.ax + na.x * innerOffset, y: s.ay + na.y * innerOffset };

    const makeTri = (
      p0: { x: number; y: number; top: boolean },
      p1: { x: number; y: number; top: boolean },
      p2: { x: number; y: number; top: boolean }
    ) => {
      if (Math.abs(polygonSignedArea2(p0, p1, p2)) < 0.5) return;
      const base = createPolygonFromPoints([p0, p1, p2], {
        polyType,
        bounciness,
        color: topColor,
        texWidth: tw,
        texHeight: th,
      });
      // Match each created vertex back to top/bottom color (createPolygonFromPoints may reorder to enforce CW)
      const colored = base.vertices.map((v) => {
        const dTop = Math.min(
          Math.hypot(v.x - aTop.x, v.y - aTop.y),
          Math.hypot(v.x - bTop.x, v.y - bTop.y)
        );
        const dBot = Math.min(
          Math.hypot(v.x - aBot.x, v.y - aBot.y),
          Math.hypot(v.x - bBot.x, v.y - bBot.y)
        );
        return {
          ...v,
          color: dTop <= dBot ? { ...topColor } : { ...bottomColor },
        };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      crustPolys.push({ ...base, vertices: colored });
    };

    makeTri({ ...aTop, top: true }, { ...bTop, top: true }, { ...bBot, top: false });
    makeTri({ ...aTop, top: true }, { ...bBot, top: false }, { ...aBot, top: false });
  }

  return crustPolys;
}

export interface ProceduralIslandOptions {
  centerX?: number;
  centerY?: number;
  width?: number;
  height?: number;
  segments?: number;
  roughness?: number;
  flatTop?: boolean;
  seed?: number;
  polyType?: number;
  topColor?: RgbaColor;
  bottomColor?: RgbaColor;
  addGrassCrust?: boolean;
  crustColor?: RgbaColor;
  texWidth?: number;
  texHeight?: number;
}

/**
 * Generates a natural Soldat rock / floating island / bunker slab with deterministic PRNG,
 * optional flat walkable top deck, 3D depth shading, and optional grass crust.
 */
export function generateProceduralIsland(options?: ProceduralIslandOptions): PmsPolygon[] {
  const cx = options?.centerX ?? 0;
  const cy = options?.centerY ?? 0;
  const rx = Math.max(16, (options?.width ?? 280) * 0.5);
  const ry = Math.max(16, (options?.height ?? 140) * 0.5);
  const nSeg = Math.max(6, Math.min(64, Math.round(options?.segments ?? 18)));
  const roughness = Math.max(0, Math.min(0.65, options?.roughness ?? 0.25));
  const flatTop = options?.flatTop !== false;
  let state = (Math.round(options?.seed ?? 1337) | 0) || 1337;

  const rand = () => {
    state = (state * 1664525 + 1013904223) | 0;
    return ((state >>> 0) % 100000) / 100000;
  };

  const ring: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < nSeg; i++) {
    const angle = (i / nSeg) * Math.PI * 2;
    const isTopSide = Math.sin(angle) < -0.15;
    const jitter = flatTop && isTopSide ? 1 + (rand() - 0.5) * roughness * 0.25 : 1 + (rand() - 0.5) * roughness * 1.4;
    let px = cx + Math.cos(angle) * rx * jitter;
    let py = cy + Math.sin(angle) * ry * jitter;
    if (flatTop && py < cy - ry * 0.55) {
      py = cy - ry * 0.55 + (rand() - 0.5) * 4;
    }
    ring.push({ x: Math.round(px), y: Math.round(py) });
  }

  const tris = earClipTriangulate(ring);
  const topColor = options?.topColor ?? { r: 168, g: 158, b: 142, a: 255 };
  const bottomColor = options?.bottomColor ?? { r: 58, g: 52, b: 48, a: 255 };
  const tw = options?.texWidth ?? 128;
  const th = options?.texHeight ?? 128;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanY = Math.max(1, maxY - minY);

  const rockPolys: PmsPolygon[] = tris.map((tri) => {
    const poly = createPolygonFromPoints(tri, {
      polyType: options?.polyType ?? 0,
      color: topColor,
      texWidth: tw,
      texHeight: th,
    });
    const verts = poly.vertices.map((v) => {
      const t = Math.max(0, Math.min(1, (v.y - minY) / spanY));
      return {
        ...v,
        color: {
          r: Math.round(topColor.r + (bottomColor.r - topColor.r) * t),
          g: Math.round(topColor.g + (bottomColor.g - topColor.g) * t),
          b: Math.round(topColor.b + (bottomColor.b - topColor.b) * t),
          a: Math.round(topColor.a + (bottomColor.a - topColor.a) * t),
        },
      };
    }) as [PmsVertex, PmsVertex, PmsVertex];
    return { ...poly, vertices: verts };
  });

  if (options?.addGrassCrust) {
    const dummyMap = { polygons: rockPolys } as PmsMapData;
    const crust = generateSurfaceCrust(
      dummyMap,
      rockPolys.map((_, i) => i),
      {
        thickness: 12,
        outwardOffset: 4,
        topColor: options?.crustColor ?? { r: 96, g: 205, b: 78, a: 255 },
        bottomColor: {
          r: Math.round((options?.crustColor?.r ?? 96) * 0.48),
          g: Math.round((options?.crustColor?.g ?? 205) * 0.48),
          b: Math.round((options?.crustColor?.b ?? 78) * 0.48),
          a: 255,
        },
        texWidth: tw,
        texHeight: th,
      }
    );
    return [...rockPolys, ...crust];
  }

  return rockPolys;
}

export interface ReliefShadeOptions {
  /** Sun angle in degrees (-90 = straight from top, -135 = top-left, -45 = top-right) */
  sunAngleDeg?: number;
  /** Contrast strength 0..1 (default 0.45) */
  contrast?: number;
  /** Ambient darkness applied to deep interior vertices away from air edges (default 0.3) */
  interiorDarken?: number;
}

/**
 * Applies automatic Soldat 3D directional sun + interior ambient-occlusion shading to polygon vertices.
 */
export function applyDirectionalReliefShading(
  map: PmsMapData,
  targetPolygonIndices: ReadonlyArray<number>,
  options?: ReliefShadeOptions
): PmsMapData {
  const targetSet =
    targetPolygonIndices.length > 0
      ? new Set(targetPolygonIndices)
      : new Set(map.polygons.map((_, i) => i));
  if (targetSet.size === 0) return map;

  const sunRad = ((options?.sunAngleDeg ?? -110) * Math.PI) / 180;
  // Direction FROM surface TOWARD sun
  const sunDirX = Math.cos(sunRad);
  const sunDirY = Math.sin(sunRad);
  const contrast = Math.max(0.05, Math.min(1, options?.contrast ?? 0.45));
  const interiorDarken = Math.max(0, Math.min(0.85, options?.interiorDarken ?? 0.28));

  const edgeKey = (x1: number, y1: number, x2: number, y2: number) =>
    `${Math.round(x1 * 4)},${Math.round(y1 * 4)}->${Math.round(x2 * 4)},${Math.round(y2 * 4)}`;
  const vKey = (x: number, y: number) => `${Math.round(x * 4)},${Math.round(y * 4)}`;

  const allDirected = new Set<string>();
  for (const p of map.polygons) {
    if (p.polyType === 24 || p.polyType === 25) continue;
    const vs = p.vertices;
    for (let e = 0; e < 3; e++) {
      allDirected.add(edgeKey(vs[e].x, vs[e].y, vs[(e + 1) % 3].x, vs[(e + 1) % 3].y));
    }
  }

  // Accumulate outward boundary normals per quantized vertex
  const boundaryNormals = new Map<string, { x: number; y: number }>();
  const addOutNormal = (x: number, y: number, ox: number, oy: number) => {
    const k = vKey(x, y);
    const cur = boundaryNormals.get(k);
    if (cur) {
      cur.x += ox;
      cur.y += oy;
    } else {
      boundaryNormals.set(k, { x: ox, y: oy });
    }
  };

  for (const p of map.polygons) {
    if (p.polyType === 24 || p.polyType === 25) continue;
    const vs = p.vertices;
    if (polygonSignedArea2(vs[0], vs[1], vs[2]) <= 0) continue;
    for (let e = 0; e < 3; e++) {
      const va = vs[e];
      const vb = vs[(e + 1) % 3];
      if (allDirected.has(edgeKey(vb.x, vb.y, va.x, va.y))) continue;
      const dx = vb.x - va.x;
      const dy = vb.y - va.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ox = dy / len;
      const oy = -dx / len;
      addOutNormal(va.x, va.y, ox, oy);
      addOutNormal(vb.x, vb.y, ox, oy);
    }
  }

  const nextPolygons = map.polygons.map((poly, pi) => {
    if (!targetSet.has(pi)) return poly;
    const nextVerts = poly.vertices.map((v) => {
      const bn = boundaryNormals.get(vKey(v.x, v.y));
      let mult = 1 - interiorDarken; // Deep interior vertex away from exposed air
      if (bn) {
        const len = Math.hypot(bn.x, bn.y);
        if (len > 1e-4) {
          const dot = (bn.x / len) * sunDirX + (bn.y / len) * sunDirY;
          // dot in [-1..+1] -> sunlit exposed edge brightens up to (1 + contrast * 0.4), shadowed underside darkens
          mult = 1 + dot * contrast * 0.65;
        }
      }
      const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
      return {
        ...v,
        color: {
          r: clamp(v.color.r * mult),
          g: clamp(v.color.g * mult),
          b: clamp(v.color.b * mult),
          a: v.color.a,
        },
      };
    }) as [PmsVertex, PmsVertex, PmsVertex];
    // Colour / texture-only edit: keeping `raw` keeps the file's collision normals (see prepareMapForSave)
    return { ...poly, vertices: nextVerts };
  });

  return { ...map, polygons: nextPolygons };
}

/**
 * Subdivides each target triangle into 4 smaller CW triangles via edge midpoints
 * (interpolating X, Y, U, V, and RGBA smoothly) so vertex brushes & light bakers have 4x finer resolution.
 */
export function subdividePolygons(
  map: PmsMapData,
  targetPolygonIndices: ReadonlyArray<number>
): { nextMap: PmsMapData; newIndices: number[] } {
  const targetSet = new Set(targetPolygonIndices);
  if (targetSet.size === 0) return { nextMap: map, newIndices: [] };

  const lerpVert = (a: PmsVertex, b: PmsVertex): PmsVertex => ({
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: 1,
    rhw: 1,
    u: (a.u + b.u) * 0.5,
    v: (a.v + b.v) * 0.5,
    color: {
      r: Math.round((a.color.r + b.color.r) * 0.5),
      g: Math.round((a.color.g + b.color.g) * 0.5),
      b: Math.round((a.color.b + b.color.b) * 0.5),
      a: Math.round((a.color.a + b.color.a) * 0.5),
    },
  });

  const makeSub = (
    verts: [PmsVertex, PmsVertex, PmsVertex],
    polyType: number,
    bounciness: number
  ): PmsPolygon => {
    const ordered: [PmsVertex, PmsVertex, PmsVertex] =
      polygonSignedArea2(verts[0], verts[1], verts[2]) >= 0
        ? verts
        : [verts[0], verts[2], verts[1]];
    const { normals, bounciness: b } = computePolygonNormals({
      vertices: ordered,
      polyType,
      bounciness,
    });
    return { vertices: ordered, normals, polyType, bounciness: b };
  };

  const nextPolygons: PmsPolygon[] = [];
  const newIndices: number[] = [];
  let total = map.polygons.length;

  for (let i = 0; i < map.polygons.length; i++) {
    const poly = map.polygons[i];
    if (!targetSet.has(i) || total + 3 > SOLDAT_MAP_LIMITS.maxPolys) {
      nextPolygons.push(poly);
      continue;
    }
    total += 3;
    const [v0, v1, v2] = poly.vertices;
    const m01 = lerpVert(v0, v1);
    const m12 = lerpVert(v1, v2);
    const m20 = lerpVert(v2, v0);
    const subs: Array<[PmsVertex, PmsVertex, PmsVertex]> = [
      [v0, m01, m20],
      [m01, v1, m12],
      [m20, m12, v2],
      [m01, m12, m20],
    ];
    for (const s of subs) {
      newIndices.push(nextPolygons.length);
      nextPolygons.push(makeSub(s, poly.polyType, poly.bounciness));
    }
  }

  return {
    nextMap: { ...map, polygons: nextPolygons },
    newIndices,
  };
}
