import {
  computeWorldAlignedUv,
  createPolygonFromPoints,
  earClipTriangulate,
  polygonSignedArea2,
  segmentsIntersect,
} from './pmsCompiler';
import { PmsPolygon, PmsVertex } from './pmsParser';
import { RgbaColor } from './soldatConstants';

export interface Point2D {
  x: number;
  y: number;
}

function perpDistToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * Ramer–Douglas–Peucker open polyline simplification.
 */
export function simplifyPolylineRdp(points: ReadonlyArray<Point2D>, epsilon: number): Point2D[] {
  if (points.length <= 2 || epsilon <= 0) return points.map((p) => ({ x: p.x, y: p.y }));
  let maxDist = 0;
  let splitIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistToSegment(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }
  if (maxDist > epsilon && splitIdx > 0) {
    const left = simplifyPolylineRdp(points.slice(0, splitIdx + 1), epsilon);
    const right = simplifyPolylineRdp(points.slice(splitIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [
    { x: first.x, y: first.y },
    { x: last.x, y: last.y },
  ];
}

/**
 * Ramer–Douglas–Peucker closed ring simplification.
 * Splits at the two maximally separated vertices so closed loops never collapse prematurely.
 */
export function simplifyClosedContourRdp(ring: ReadonlyArray<Point2D>, epsilon: number): Point2D[] {
  if (ring.length <= 3 || epsilon <= 0) return ring.map((p) => ({ x: p.x, y: p.y }));

  // Find anchor 0 and farthest vertex from anchor 0
  let iA = 0;
  let maxFrom0 = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2;
    if (d > maxFrom0) {
      maxFrom0 = d;
      iA = i;
    }
  }
  // Find farthest vertex from iA
  let iB = (iA + Math.floor(ring.length / 2)) % ring.length;
  let maxFromA = -1;
  for (let i = 0; i < ring.length; i++) {
    if (i === iA) continue;
    const d = (ring[i].x - ring[iA].x) ** 2 + (ring[i].y - ring[iA].y) ** 2;
    if (d > maxFromA) {
      maxFromA = d;
      iB = i;
    }
  }

  const ordered = (from: number, to: number): Point2D[] => {
    const out: Point2D[] = [];
    let cur = from;
    while (cur !== to) {
      out.push(ring[cur]);
      cur = (cur + 1) % ring.length;
    }
    out.push(ring[to]);
    return out;
  };

  const half1 = simplifyPolylineRdp(ordered(iA, iB), epsilon);
  const half2 = simplifyPolylineRdp(ordered(iB, iA), epsilon);
  const combined = [...half1.slice(0, -1), ...half2.slice(0, -1)];
  return combined.length >= 3 ? combined : ring.slice(0, 3).map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Chaikin corner-smoothing on a closed polygon contour.
 */
export function smoothClosedContour(ring: ReadonlyArray<Point2D>, passes: number): Point2D[] {
  let cur = ring.map((p) => ({ x: p.x, y: p.y }));
  const nPasses = Math.max(0, Math.min(3, Math.floor(passes)));
  for (let pass = 0; pass < nPasses; pass++) {
    if (cur.length < 3 || cur.length > 512) break;
    const next: Point2D[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    cur = next;
  }
  return cur;
}

/**
 * Untangles minor self-crossings in freehand loops via 2-opt segment uncrossing.
 */
export function untangleClosedContour(ring: ReadonlyArray<Point2D>): Point2D[] {
  const pts = ring.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  if (n < 4 || n > 240) return pts;

  let maxSwaps = n * 2;
  let changed = true;
  while (changed && maxSwaps-- > 0) {
    changed = false;
    for (let i = 0; i < n; i++) {
      const iNext = (i + 1) % n;
      for (let j = i + 2; j < n; j++) {
        const jNext = (j + 1) % n;
        if (i === jNext) continue;
        // Shrink segment endpoints slightly so shared endpoints don't count as crossings
        const a1 = pts[i];
        const a2 = pts[iNext];
        const b1 = pts[j];
        const b2 = pts[jNext];
        const shrink = (p: Point2D, q: Point2D) => ({
          x: p.x + (q.x - p.x) * 1e-4,
          y: p.y + (q.y - p.y) * 1e-4,
        });
        const sA1 = shrink(a1, a2);
        const sA2 = shrink(a2, a1);
        const sB1 = shrink(b1, b2);
        const sB2 = shrink(b2, b1);
        if (segmentsIntersect(sA1.x, sA1.y, sA2.x, sA2.y, sB1.x, sB1.y, sB2.x, sB2.y)) {
          // Reversepts[iNext..j]
          let l = iNext;
          let r = j;
          while (l < r) {
            const tmp = pts[l];
            pts[l] = pts[r];
            pts[r] = tmp;
            l++;
            r--;
          }
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return pts;
}

export interface LaserPolygonOptions {
  detailEpsilon?: number;
  smoothPasses?: number;
  polyType?: number;
  bounciness?: number;
  color?: RgbaColor;
  autoShadeDepth?: boolean;
  texWidth?: number;
  texHeight?: number;
}

/**
 * Computes the simplified closed contour for live overlay preview while dragging the Laser tool.
 */
export function previewLaserContour(
  rawPoints: ReadonlyArray<Point2D>,
  detailEpsilon = 10,
  smoothPasses = 0
): Point2D[] {
  if (rawPoints.length < 3) return rawPoints.map((p) => ({ x: p.x, y: p.y }));
  const deduped: Point2D[] = [rawPoints[0]];
  for (let i = 1; i < rawPoints.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (Math.hypot(rawPoints[i].x - prev.x, rawPoints[i].y - prev.y) >= 1.5) {
      deduped.push(rawPoints[i]);
    }
  }
  if (deduped.length < 3) return deduped;
  let simplified = simplifyClosedContourRdp(deduped, Math.max(1, detailEpsilon));
  if (smoothPasses > 0) {
    simplified = smoothClosedContour(simplified, smoothPasses);
  }
  return untangleClosedContour(simplified);
}

/**
 * Converts a freehand "Laser" stroke into clean, clockwise Soldat `.pms` triangles.
 */
export function freehandLaserToPolygons(
  rawPoints: ReadonlyArray<Point2D>,
  options?: LaserPolygonOptions
): PmsPolygon[] {
  const contour = previewLaserContour(
    rawPoints,
    options?.detailEpsilon ?? 10,
    options?.smoothPasses ?? 0
  );
  if (contour.length < 3) return [];

  const tris = earClipTriangulate(contour);
  if (tris.length === 0) return [];

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of contour) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanY = Math.max(1, maxY - minY);
  const baseColor = options?.color ?? { r: 255, g: 255, b: 255, a: 255 };
  const tw = options?.texWidth ?? 128;
  const th = options?.texHeight ?? 128;

  const out: PmsPolygon[] = [];
  for (const tri of tris) {
    if (Math.abs(polygonSignedArea2(tri[0], tri[1], tri[2])) < 2.0) continue;
    const poly = createPolygonFromPoints(tri, {
      polyType: options?.polyType ?? 0,
      bounciness: options?.bounciness ?? 1,
      color: baseColor,
      texWidth: tw,
      texHeight: th,
    });

    if (options?.autoShadeDepth) {
      const shadedVerts = poly.vertices.map((v) => {
        const t = Math.max(0, Math.min(1, (v.y - minY) / spanY));
        // Top sunlit rim ~1.08x brighter, bottom rock underside ~0.58x darker
        const mult = 1.06 - t * 0.48;
        return {
          ...v,
          color: {
            r: Math.max(0, Math.min(255, Math.round(baseColor.r * mult))),
            g: Math.max(0, Math.min(255, Math.round(baseColor.g * mult))),
            b: Math.max(0, Math.min(255, Math.round(baseColor.b * mult))),
            a: baseColor.a,
          },
        };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      out.push({ ...poly, vertices: shadedVerts });
    } else {
      out.push(poly);
    }
  }
  return out;
}

export type ImageTraceMode = 'alpha' | 'luminance_dark' | 'luminance_light';

export interface ImageTraceOptions {
  mode?: ImageTraceMode;
  /** 0..255 alpha or luminance cutoff (default 128) */
  threshold?: number;
  /** Treat Soldat pure green #00FF00 as transparent in alpha mode (default true) */
  treatLimeAsTransparent?: boolean;
  /** RDP contour simplification tolerance in working-grid pixels (default 1.5) */
  simplifyEpsilonPx?: number;
  /** Chaikin corner smoothing iterations 0..2 (default 0) */
  smoothPasses?: number;
  /** World units per source image pixel (default 2.0) */
  worldScale?: number;
  /** World X center where traced shape is placed (default 0) */
  centerX?: number;
  /** World Y center where traced shape is placed (default 0) */
  centerY?: number;
  /** Sample RGBA vertex colors directly from image pixels (default true) */
  sampleImageColors?: boolean;
  /** Fallback flat vertex color when sampleImageColors is false */
  flatColor?: RgbaColor;
  polyType?: number;
  bounciness?: number;
  texWidth?: number;
  texHeight?: number;
  /** Max working grid resolution along longest image side (default 220) */
  maxGridSize?: number;
  /** Minimum foreground pixels in an island to keep (default 6) */
  minIslandPixels?: number;
  /** Max islands to vectorize (default 24) */
  maxIslands?: number;
}

export interface ImageTraceResult {
  polygons: PmsPolygon[];
  contoursWorld: Point2D[][];
  islandCount: number;
  gridWidth: number;
  gridHeight: number;
}

/**
 * Vectorizes an RGBA bitmap buffer into clockwise Soldat `.pms` polygons.
 * Uses connected-component filtering + exact directed grid-edge contour chaining + RDP simplification + ear-clipping.
 */
export function traceImageToPolygons(
  rgba: Uint8Array | Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  options?: ImageTraceOptions
): ImageTraceResult {
  if (imgWidth <= 0 || imgHeight <= 0 || rgba.length < imgWidth * imgHeight * 4) {
    return { polygons: [], contoursWorld: [], islandCount: 0, gridWidth: 0, gridHeight: 0 };
  }

  const mode = options?.mode ?? 'alpha';
  const threshold = Math.max(1, Math.min(254, options?.threshold ?? 128));
  const treatLime = options?.treatLimeAsTransparent !== false;
  const maxGrid = Math.max(16, Math.min(512, options?.maxGridSize ?? 220));
  const step = Math.max(1, Math.ceil(Math.max(imgWidth, imgHeight) / maxGrid));
  const gw = Math.max(1, Math.floor(imgWidth / step));
  const gh = Math.max(1, Math.floor(imgHeight / step));

  // 1. Build binary foreground mask on (gw x gh) grid
  const mask = new Uint8Array(gw * gh);
  const isPixelSolid = (px: number, py: number): boolean => {
    const idx = (py * imgWidth + px) * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const a = rgba[idx + 3];
    if (treatLime && r === 0 && g === 255 && b === 0) return false;
    if (mode === 'alpha') {
      return a >= threshold;
    }
    if (a < 32) return false;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return mode === 'luminance_dark' ? lum <= threshold : lum >= threshold;
  };

  for (let gy = 0; gy < gh; gy++) {
    const py = Math.min(imgHeight - 1, gy * step + (step >> 1));
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(imgWidth - 1, gx * step + (step >> 1));
      if (isPixelSolid(px, py)) {
        mask[gy * gw + gx] = 1;
      }
    }
  }

  // 2. 4-connected BFS to extract clean foreground islands sorted by pixel area
  const visited = new Uint8Array(gw * gh);
  const islands: number[][] = [];
  const minIslandPixels = Math.max(1, options?.minIslandPixels ?? 6);
  const queue = new Int32Array(gw * gh);

  for (let start = 0; start < gw * gh; start++) {
    if (!mask[start] || visited[start]) continue;
    visited[start] = 1;
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    const cells: number[] = [];

    while (qHead < qTail) {
      const cur = queue[qHead++];
      cells.push(cur);
      const cx = cur % gw;
      const cy = (cur - cx) / gw;
      if (cx > 0) {
        const n = cur - 1;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
      if (cx + 1 < gw) {
        const n = cur + 1;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
      if (cy > 0) {
        const n = cur - gw;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
      if (cy + 1 < gh) {
        const n = cur + gw;
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
    }

    if (cells.length >= minIslandPixels) {
      islands.push(cells);
    }
  }

  islands.sort((a, b) => b.length - a.length);
  const keptIslands = islands.slice(0, Math.max(1, options?.maxIslands ?? 24));

  const worldScale = options?.worldScale && options.worldScale > 0 ? options.worldScale : 2;
  const centerX = options?.centerX ?? 0;
  const centerY = options?.centerY ?? 0;
  const simplifyEps = Math.max(0.4, options?.simplifyEpsilonPx ?? 1.5);
  const smoothPasses = options?.smoothPasses ?? 0;
  const sampleColors = options?.sampleImageColors !== false;
  const flatColor = options?.flatColor ?? { r: 255, g: 255, b: 255, a: 255 };
  const tw = options?.texWidth ?? 128;
  const th = options?.texHeight ?? 128;

  const gridToWorld = (gx: number, gy: number): Point2D => ({
    x: centerX + (gx * step - imgWidth * 0.5) * worldScale,
    y: centerY + (gy * step - imgHeight * 0.5) * worldScale,
  });

  const sampleColorAtWorld = (wx: number, wy: number): RgbaColor => {
    const px = Math.max(
      0,
      Math.min(imgWidth - 1, Math.round((wx - centerX) / worldScale + imgWidth * 0.5))
    );
    const py = Math.max(
      0,
      Math.min(imgHeight - 1, Math.round((wy - centerY) / worldScale + imgHeight * 0.5))
    );
    // Search tiny 3x3 neighborhood so boundary vertices sample interior foreground color instead of transparent edge
    let bestIdx = (py * imgWidth + px) * 4;
    for (let dy = 0; dy <= 2; dy = dy === 0 ? 1 : dy === 1 ? -1 : 3) {
      for (let dx = 0; dx <= 2; dx = dx === 0 ? 1 : dx === 1 ? -1 : 3) {
        const sx = Math.max(0, Math.min(imgWidth - 1, px + dx));
        const sy = Math.max(0, Math.min(imgHeight - 1, py + dy));
        if (isPixelSolid(sx, sy)) {
          bestIdx = (sy * imgWidth + sx) * 4;
          return {
            r: rgba[bestIdx],
            g: rgba[bestIdx + 1],
            b: rgba[bestIdx + 2],
            a: Math.max(64, rgba[bestIdx + 3]),
          };
        }
      }
    }
    return {
      r: rgba[bestIdx],
      g: rgba[bestIdx + 1],
      b: rgba[bestIdx + 2],
      a: 255,
    };
  };

  const polygons: PmsPolygon[] = [];
  const contoursWorld: Point2D[][] = [];
  const islandStamp = new Int32Array(gw * gh);
  let stampToken = 1;

  for (const cells of keptIslands) {
    const token = stampToken++;
    for (const c of cells) islandStamp[c] = token;

    // Emit directed CW boundary segments on the (gw+1) x (gh+1) corner lattice
    const stride = gw + 1;
    const outgoing = new Map<number, number[]>();
    const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
      const u = y1 * stride + x1;
      const v = y2 * stride + x2;
      let list = outgoing.get(u);
      if (!list) {
        list = [];
        outgoing.set(u, list);
      }
      list.push(v);
    };

    for (const c of cells) {
      const gx = c % gw;
      const gy = (c - gx) / gw;
      // Top edge
      if (gy === 0 || islandStamp[c - gw] !== token) addEdge(gx, gy, gx + 1, gy);
      // Right edge
      if (gx + 1 === gw || islandStamp[c + 1] !== token) addEdge(gx + 1, gy, gx + 1, gy + 1);
      // Bottom edge
      if (gy + 1 === gh || islandStamp[c + gw] !== token) addEdge(gx + 1, gy + 1, gx, gy + 1);
      // Left edge
      if (gx === 0 || islandStamp[c - 1] !== token) addEdge(gx, gy + 1, gx, gy);
    }

    // Chain directed boundary segments into closed loops; pick the outer loop (positive CW shoelace area!)
    const loops: Point2D[][] = [];
    for (const [startVertex, startTargets] of outgoing.entries()) {
      while (startTargets.length > 0) {
        const loop: Point2D[] = [];
        let cur = startVertex;
        let safety = cells.length * 4 + 16;
        while (safety-- > 0) {
          const cx = cur % stride;
          const cy = (cur - cx) / stride;
          loop.push({ x: cx, y: cy });
          const nextList = outgoing.get(cur);
          if (!nextList || nextList.length === 0) break;
          const nxt = nextList.pop()!;
          if (nxt === startVertex) break;
          cur = nxt;
        }
        if (loop.length >= 4) {
          loops.push(loop);
        }
      }
    }

    // Outer boundary of a CW-traced island has positive signed double-area (inner holes have negative area)
    let bestOuter: Point2D[] | null = null;
    let bestArea2 = 0;
    for (const lp of loops) {
      let a2 = 0;
      for (let i = 0; i < lp.length; i++) {
        const p = lp[i];
        const q = lp[(i + 1) % lp.length];
        a2 += p.x * q.y - q.x * p.y;
      }
      if (a2 > bestArea2) {
        bestArea2 = a2;
        bestOuter = lp;
      }
    }
    if (!bestOuter) continue;

    // Remove collinear grid intermediate points before RDP
    const cornersOnly: Point2D[] = [];
    for (let i = 0; i < bestOuter.length; i++) {
      const prev = bestOuter[(i + bestOuter.length - 1) % bestOuter.length];
      const curr = bestOuter[i];
      const next = bestOuter[(i + 1) % bestOuter.length];
      if (Math.abs(polygonSignedArea2(prev, curr, next)) > 1e-5) {
        cornersOnly.push(curr);
      }
    }
    if (cornersOnly.length < 3) continue;

    let simplifiedGrid = simplifyClosedContourRdp(cornersOnly, simplifyEps);
    if (smoothPasses > 0) {
      simplifiedGrid = smoothClosedContour(simplifiedGrid, smoothPasses);
    }
    const worldRing = untangleClosedContour(simplifiedGrid.map((pt) => gridToWorld(pt.x, pt.y)));
    if (worldRing.length < 3) continue;
    contoursWorld.push(worldRing);

    const tris = earClipTriangulate(worldRing);
    for (const tri of tris) {
      if (Math.abs(polygonSignedArea2(tri[0], tri[1], tri[2])) < 1.0) continue;
      if (polygons.length >= 4800) break; // Stay safely under Soldat's 5000 polygon limit!

      const basePoly = createPolygonFromPoints(tri, {
        polyType: options?.polyType ?? 0,
        bounciness: options?.bounciness ?? 1,
        color: flatColor,
        texWidth: tw,
        texHeight: th,
      });

      if (sampleColors) {
        const coloredVerts = basePoly.vertices.map((v) => {
          const uv = computeWorldAlignedUv(v.x, v.y, tw, th);
          return {
            ...v,
            u: uv.u,
            v: uv.v,
            color: sampleColorAtWorld(v.x, v.y),
          };
        }) as [PmsVertex, PmsVertex, PmsVertex];
        polygons.push({ ...basePoly, vertices: coloredVerts });
      } else {
        polygons.push(basePoly);
      }
    }
  }

  return {
    polygons,
    contoursWorld,
    islandCount: contoursWorld.length,
    gridWidth: gw,
    gridHeight: gh,
  };
}
