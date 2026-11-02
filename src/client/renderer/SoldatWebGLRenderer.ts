import { hasSameCollisionGeometry } from '@shared/pmsCompiler';
import {
  computePropCorners,
  computeTransformCorners,
  PmsMapData,
  PmsProp,
  PmsVertex,
  sectorTablePolygons,
} from '@shared/pmsParser';
import { t } from '../i18n';
import { getAssetCacheEpoch, loadSoldatAssetImage } from './assetLoader';
import { RenderLayerVisibility } from './types';

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;

uniform vec4 uBounds; // (left, right, top, bottom)

out vec2 vUV;
out vec4 vColor;

void main() {
  float x = (aPos.x - uBounds.x) / (uBounds.y - uBounds.x) * 2.0 - 1.0;
  float y = 1.0 - (aPos.y - uBounds.z) / (uBounds.w - uBounds.z) * 2.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
in vec4 vColor;

uniform sampler2D uTex;
uniform float uOpacityMul;
uniform float uLodBias;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uTex, vUV, uLodBias);
  float a = vColor.a * uOpacityMul;
  vec4 vc = vec4(vColor.rgb * a, a);
  fragColor = tex * vc;
}
`;

/**
 * OpenSoldat samples mipmapped textures with a global LOD bias (`r_mipmapbias`, default -0.5, applied with
 * glTexEnvf(GL_TEXTURE_FILTER_CONTROL, GL_TEXTURE_LOD_BIAS)): minified sceneries use a sharper mip level than
 * plain trilinear filtering would. Without it the preview, the screenshots and the baked `_o` layers come out
 * softer than the game draws the same sprites.
 */
const GAME_MIPMAP_BIAS = -0.5;

interface PropDrawCall {
  texture: WebGLTexture;
  firstVertex: number;
  vertexCount: number;
}

interface SceneryTextureInfo {
  tex: WebGLTexture;
  width: number;
  height: number;
  // UV rectangle of the real image inside the (transparent-padded) texture
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface CachedGpuTextureEntry {
  tex: WebGLTexture;
  hasMipmaps: boolean;
  isOwned: boolean;
  width: number;
  height: number;
  sceneryInfo?: SceneryTextureInfo;
  pixelatedApplied: boolean;
  bytes: number; // Approximate GPU memory (0 for shared placeholders)
  lastUsed: number; // Use clock value of the last map that drew it (LRU eviction)
  placeholder?: boolean; // The image failed to load: retried on the next full loadMap()
}

interface CachedGeometrySlice {
  polygonsRef: PmsMapData['polygons'];
  sectorsDivision: number;
  floats: Float32Array;
  edgeBackCount: number;
  edgeFrontCount: number;
  polyBackCount: number;
  polyFrontCount: number;
}

interface PreparedGpuMap {
  map: PmsMapData;
  preferClassicBmp: boolean;
  skipGeometry: boolean;
  hasPropFilter: boolean;
  textureNameLower: string;
  whiteTex: WebGLTexture;
  mainTex: WebGLTexture;
  edgeTex: WebGLTexture | null;
  edgeDims: { width: number; height: number } | null;
  activeTextures: CachedGpuTextureEntry[];
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  vboCapacityFloats: number;
  geometryCache: CachedGeometrySlice | null;

  bgBackRange: { first: number; count: number };
  edgeBackRange: { first: number; count: number };
  polyBackRange: { first: number; count: number };
  edgeFrontRange: { first: number; count: number };
  polyFrontRange: { first: number; count: number };
  propCalls: [PropDrawCall[], PropDrawCall[], PropDrawCall[]];
}

// Textures of maps that are no longer shown stay on the GPU up to this budget (and count), so switching back to a
// recent map or editing it costs no re-upload; the least recently used ones go first
const DEFAULT_TEXTURE_CACHE_BUDGET_MB = 192;
const MAX_GPU_TEXTURE_CACHE = 400;

function textureBytes(width: number, height: number, mipmaps: boolean): number {
  return Math.round(width * height * 4 * (mipmaps ? 4 / 3 : 1));
}

/** True when the stored sector table was read or built for exactly these triangles (game-exact smooth edges) */
function sectorTableFitsPolygons(map: PmsMapData): boolean {
  const owner = sectorTablePolygons(map.sectorsPolys);
  return Boolean(owner && hasSameCollisionGeometry(map.polygons, owner));
}

export interface OffscreenReadback {
  width: number;
  height: number;
  rgba: Uint8ClampedArray; // top-down, straight (unpremultiplied) RGBA8
  nonEmptyBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  floatPrecision: boolean; // true when composited in an RGBA16F target (no 8-bit premultiply rounding)
}

// Stride = 8 floats = 32 bytes: x, y, u, v, r, g, b, a
const FLOATS_PER_VERTEX = 8;

// Exact OpenSoldat PolyMap.pas CollisionTestExcept EXCLUDED polygon types
const SMOOTH_EDGE_EXCLUDED_POLY_TYPES = new Set<number>([1, 2, 3, 11, 24, 25]);

// OpenSoldat packs sceneries into a zero-filled atlas with 8 px padding (Gfx.pas TGfxSpritesheet), so bilinear
// filtering fades every prop edge by half a texel into transparency. Emulated with a transparent border per texture.
const SCENERY_ATLAS_PADDING = 8;

// Rows per readPixels() call when reading float targets back, bounds the temporary Float32Array to a few MB
const READBACK_STRIP_ROWS = 256;

/**
 * Exact port of OpenSoldat TPolyMap.PointInPoly (shared/PolyMap.pas)
 */
function pointInPoly(
  px: number,
  py: number,
  a: PmsVertex,
  b: PmsVertex,
  c: PmsVertex
): boolean {
  const apX = px - a.x;
  const apY = py - a.y;
  const pAb = (b.x - a.x) * apY - (b.y - a.y) * apX > 0;
  const pAc = (c.x - a.x) * apY - (c.y - a.y) * apX > 0;
  if (pAc === pAb) return false;
  if (((c.x - b.x) * (py - b.y) - (c.y - b.y) * (px - b.x) > 0) !== pAb) return false;
  return true;
}

/**
 * Pascal Round() — banker's rounding (half to even), used by PolyMap.pas sector lookups.
 */
function pascalRound(v: number): number {
  const f = Math.floor(v);
  const diff = v - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * Returns the smooth-edge "is this edge midpoint covered by another polygon" test.
 * Uses the map's own PMS sector table exactly like TPolyMap.CollisionTestExcept (Round()-based sector,
 * 1-based polygon numbers, EXCLUDED types); falls back to a spatial grid when the table is unusable.
 */
function createEdgeCoverageTest(
  map: PmsMapData,
  forceDynamicSpatialGrid = false
): (mx: number, my: number, selfIdx: number) => boolean {
  const n = map.sectorsNum;
  const div = map.sectorsDivision;
  const side = 2 * n + 1;
  const sectors = map.sectorsPolys;
  const polys = map.polygons;

  if (!forceDynamicSpatialGrid && sectors && div > 0 && n >= 0 && sectors.length === side * side) {
    return (mx, my, selfIdx) => {
      const kx = pascalRound(mx / div);
      const ky = pascalRound(my / div);
      if (!(kx > -n && kx < n && ky > -n && ky < n)) return false;
      const list = sectors[(kx + n) * side + (ky + n)];
      for (let j = 0; j < list.length; j++) {
        const w = list[j] - 1;
        if (w === selfIdx || w < 0 || w >= polys.length) continue;
        const pw = polys[w];
        if (SMOOTH_EDGE_EXCLUDED_POLY_TYPES.has(pw.polyType)) continue;
        if (pointInPoly(mx, my, pw.vertices[0], pw.vertices[1], pw.vertices[2])) return true;
      }
      return false;
    };
  }

  const cellSize = Math.max(64, div || 128);
  const spatialGrid = new Map<number, number[]>();
  const cellKey = (gx: number, gy: number) => ((gx + 32768) << 16) | ((gy + 32768) & 0xffff);
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    if (SMOOTH_EDGE_EXCLUDED_POLY_TYPES.has(poly.polyType)) continue;
    const [v0, v1, v2] = poly.vertices;
    const minGx = Math.floor(Math.min(v0.x, v1.x, v2.x) / cellSize);
    const maxGx = Math.floor(Math.max(v0.x, v1.x, v2.x) / cellSize);
    const minGy = Math.floor(Math.min(v0.y, v1.y, v2.y) / cellSize);
    const maxGy = Math.floor(Math.max(v0.y, v1.y, v2.y) / cellSize);
    if ((maxGx - minGx + 1) * (maxGy - minGy + 1) > 4096) continue; // degenerate giant polygon
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const key = cellKey(gx, gy);
        let bucket = spatialGrid.get(key);
        if (!bucket) {
          bucket = [];
          spatialGrid.set(key, bucket);
        }
        bucket.push(i);
      }
    }
  }
  return (mx, my, selfIdx) => {
    const bucket = spatialGrid.get(cellKey(Math.floor(mx / cellSize), Math.floor(my / cellSize)));
    if (!bucket) return false;
    for (let bIdx = 0; bIdx < bucket.length; bIdx++) {
      const w = bucket[bIdx];
      if (w === selfIdx) continue;
      const pw = polys[w].vertices;
      if (pointInPoly(mx, my, pw[0], pw[1], pw[2])) return true;
    }
    return false;
  };
}

/**
 * Copies premultiplied RGBA into a larger buffer surrounded by `pad` transparent texels.
 */
function padTransparent(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  pad: number
): { width: number; height: number; data: Uint8ClampedArray } {
  const pw = width + pad * 2;
  const ph = height + pad * 2;
  const out = new Uint8ClampedArray(pw * ph * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), ((y + pad) * pw + pad) * 4);
  }
  return { width: pw, height: ph, data: out };
}

export class SoldatWebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uBoundsLoc: WebGLUniformLocation;
  private uTexLoc: WebGLUniformLocation;
  private uOpacityMulLoc: WebGLUniformLocation;
  private uLodBiasLoc: WebGLUniformLocation;
  private whiteTexture: WebGLTexture;
  private fallbackCheckerTexture: WebGLTexture;
  private prepared: PreparedGpuMap | null = null;
  private gpuTextureCache = new Map<string, CachedGpuTextureEntry>();
  private readonly textureCacheBudgetBytes: number;
  private useClock = 0;
  private assetEpochSeen = getAssetCacheEpoch();
  private scratchBuffer = new Float32Array(65536);
  private loadSeq = 0;
  private floatTargetSupported: boolean | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    options?: { transparentCanvas?: boolean; textureCacheBudgetMB?: number }
  ) {
    this.canvas = canvas;
    this.textureCacheBudgetBytes =
      Math.max(0, options?.textureCacheBudgetMB ?? DEFAULT_TEXTURE_CACHE_BUDGET_MB) * 1024 * 1024;
    const gl = canvas.getContext('webgl2', {
      alpha: Boolean(options?.transparentCanvas),
      antialias: !options?.transparentCanvas,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error(t("Your browser doesn't support WebGL2, which the Soldat Map Studio engine requires."));
    }
    this.gl = gl;

    this.program = this.createShaderProgram(VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
    this.uBoundsLoc = gl.getUniformLocation(this.program, 'uBounds')!;
    this.uTexLoc = gl.getUniformLocation(this.program, 'uTex')!;
    this.uOpacityMulLoc = gl.getUniformLocation(this.program, 'uOpacityMul')!;
    this.uLodBiasLoc = gl.getUniformLocation(this.program, 'uLodBias')!;

    this.whiteTexture = this.createSolidTexture(255, 255, 255, 255);
    this.fallbackCheckerTexture = this.createMissingCheckerTexture();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
  }

  // Every GL object of this renderer dies with a lost context. After the context is restored, deleting those
  // stale handles would only produce "object does not belong to this context" errors, so they are forgotten.
  private resourcesLost = false;
  private readonly handleContextLost = (): void => {
    this.resourcesLost = true;
    this.gpuTextureCache.clear();
  };

  public isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getMaxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  public getLoadedPreferClassicBmp(): boolean | null {
    return this.prepared ? this.prepared.preferClassicBmp : null;
  }

  private ensureScratchFloats(minFloats: number): Float32Array {
    if (this.scratchBuffer.length < minFloats) {
      let nextCap = this.scratchBuffer.length || 65536;
      while (nextCap < minFloats) nextCap *= 2;
      this.scratchBuffer = new Float32Array(nextCap);
    }
    return this.scratchBuffer;
  }

  private buildGeometrySlice(
    map: PmsMapData,
    edgeDims: { width: number; height: number } | null,
    forceDynamicSpatialGrid: boolean
  ): CachedGeometrySlice {
    const verts: number[] = [];
    const pushVert = (
      x: number,
      y: number,
      u: number,
      v: number,
      r: number,
      g: number,
      b: number,
      a: number
    ) => {
      verts.push(x, y, u, v, r / 255, g / 255, b / 255, a / 255);
    };
    const pushQuad = (
      x0: number, y0: number, u0: number, v0: number, r0: number, g0: number, b0: number, a0: number,
      x1: number, y1: number, u1: number, v1: number, r1: number, g1: number, b1: number, a1: number,
      x2: number, y2: number, u2: number, v2: number, r2: number, g2: number, b2: number, a2: number,
      x3: number, y3: number, u3: number, v3: number, r3: number, g3: number, b3: number, a3: number
    ) => {
      pushVert(x0, y0, u0, v0, r0, g0, b0, a0);
      pushVert(x1, y1, u1, v1, r1, g1, b1, a1);
      pushVert(x2, y2, u2, v2, r2, g2, b2, a2);
      pushVert(x2, y2, u2, v2, r2, g2, b2, a2);
      pushVert(x3, y3, u3, v3, r3, g3, b3, a3);
      pushVert(x0, y0, u0, v0, r0, g0, b0, a0);
    };

    let edgeBackCount = 0;
    let edgeFrontCount = 0;

    if (edgeDims && map.polygons.length > 0) {
      const isCovered = createEdgeCoverageTest(map, forceDynamicSpatialGrid);
      const backEdges: Array<{ a: PmsVertex; b: PmsVertex }> = [];
      const frontEdges: Array<{ a: PmsVertex; b: PmsVertex }> = [];

      for (let i = 0; i < map.polygons.length; i++) {
        const poly = map.polygons[i];
        const isBack = poly.polyType === 24 || poly.polyType === 25;
        let j = 2;
        for (let k = 0; k < 3; k++) {
          const va = poly.vertices[k];
          const vb = poly.vertices[j];
          j = k;

          if (Math.min(va.color.a, vb.color.a) <= 128) continue;

          const mx = va.x + (vb.x - va.x) * 0.5;
          const my = va.y + (vb.y - va.y) * 0.5;
          if (isCovered(mx, my, i)) continue;

          if (isBack) backEdges.push({ a: va, b: vb });
          else frontEdges.push({ a: va, b: vb });
        }
      }

      const emitEdges = (edgeList: Array<{ a: PmsVertex; b: PmsVertex }>) => {
        const ew = edgeDims.width;
        const eh = edgeDims.height;
        for (const e of edgeList) {
          const dx = e.b.x - e.a.x;
          const dy = e.b.y - e.a.y;
          const len = Math.hypot(dx, dy);
          if (len < 0.001) continue;
          const r = Math.atan2(dy, dx);
          const sx = len / 90;
          const corners = computeTransformCorners(e.a.x, e.a.y, ew, eh, sx, 1, 0, 0.5, r);
          const aAlpha = Math.trunc(e.a.color.a * 0.75);
          const bAlpha = Math.trunc(e.b.color.a * 0.75);
          pushQuad(
            corners[0], corners[1], 0, 0, e.a.color.r, e.a.color.g, e.a.color.b, aAlpha,
            corners[2], corners[3], 1, 0, e.b.color.r, e.b.color.g, e.b.color.b, bAlpha,
            corners[4], corners[5], 1, 1, e.b.color.r, e.b.color.g, e.b.color.b, bAlpha,
            corners[6], corners[7], 0, 1, e.a.color.r, e.a.color.g, e.a.color.b, aAlpha
          );
        }
      };

      const startBack = verts.length / FLOATS_PER_VERTEX;
      emitEdges(backEdges);
      edgeBackCount = verts.length / FLOATS_PER_VERTEX - startBack;

      const startFront = verts.length / FLOATS_PER_VERTEX;
      emitEdges(frontEdges);
      edgeFrontCount = verts.length / FLOATS_PER_VERTEX - startFront;
    }

    const startPolyBack = verts.length / FLOATS_PER_VERTEX;
    for (const poly of map.polygons) {
      if (poly.polyType === 24 || poly.polyType === 25) {
        for (const v of poly.vertices) {
          pushVert(v.x, v.y, v.u, v.v, v.color.r, v.color.g, v.color.b, v.color.a);
        }
      }
    }
    const polyBackCount = verts.length / FLOATS_PER_VERTEX - startPolyBack;

    const startPolyFront = verts.length / FLOATS_PER_VERTEX;
    for (const poly of map.polygons) {
      if (poly.polyType !== 24 && poly.polyType !== 25) {
        for (const v of poly.vertices) {
          pushVert(v.x, v.y, v.u, v.v, v.color.r, v.color.g, v.color.b, v.color.a);
        }
      }
    }
    const polyFrontCount = verts.length / FLOATS_PER_VERTEX - startPolyFront;

    return {
      polygonsRef: map.polygons,
      sectorsDivision: map.sectorsDivision,
      floats: new Float32Array(verts),
      edgeBackCount,
      edgeFrontCount,
      polyBackCount,
      polyFrontCount,
    };
  }

  private packFullVertexBuffer(
    map: PmsMapData,
    geometrySlice: CachedGeometrySlice | null,
    resolveScenery: (scIdx: number) => SceneryTextureInfo | undefined,
    propFilter?: (prop: PmsProp, arrayIdx: number) => boolean
  ): {
    floatSlice: Float32Array;
    bgBackRange: { first: number; count: number };
    edgeBackRange: { first: number; count: number };
    polyBackRange: { first: number; count: number };
    edgeFrontRange: { first: number; count: number };
    polyFrontRange: { first: number; count: number };
    propCalls: [PropDrawCall[], PropDrawCall[], PropDrawCall[]];
  } {
    const geomFloats = geometrySlice ? geometrySlice.floats.length : 0;
    // 18 bg vertices + geometry + up to 6 vertices per prop
    const maxFloats = 18 * FLOATS_PER_VERTEX + geomFloats + map.props.length * 6 * FLOATS_PER_VERTEX;
    const buf = this.ensureScratchFloats(maxFloats);
    let ptr = 0;

    const writeVert = (
      x: number,
      y: number,
      u: number,
      v: number,
      r: number,
      g: number,
      b: number,
      a: number
    ) => {
      buf[ptr++] = x;
      buf[ptr++] = y;
      buf[ptr++] = u;
      buf[ptr++] = v;
      buf[ptr++] = r / 255;
      buf[ptr++] = g / 255;
      buf[ptr++] = b / 255;
      buf[ptr++] = a / 255;
    };

    const writeQuad = (
      x0: number, y0: number, u0: number, v0: number, r0: number, g0: number, b0: number, a0: number,
      x1: number, y1: number, u1: number, v1: number, r1: number, g1: number, b1: number, a1: number,
      x2: number, y2: number, u2: number, v2: number, r2: number, g2: number, b2: number, a2: number,
      x3: number, y3: number, u3: number, v3: number, r3: number, g3: number, b3: number, a3: number
    ) => {
      writeVert(x0, y0, u0, v0, r0, g0, b0, a0);
      writeVert(x1, y1, u1, v1, r1, g1, b1, a1);
      writeVert(x2, y2, u2, v2, r2, g2, b2, a2);
      writeVert(x2, y2, u2, v2, r2, g2, b2, a2);
      writeVert(x3, y3, u3, v3, r3, g3, b3, a3);
      writeVert(x0, y0, u0, v0, r0, g0, b0, a0);
    };

    // 1. Background gradient
    const d = 25 * Math.max(map.sectorsDivision || 1, 10);
    const HUGE = 500000;
    const topC = map.bgColorTop;
    const btmC = map.bgColorBtm;
    const bgFirst = 0;
    writeQuad(
      -HUGE, -HUGE, 0, 0, topC.r, topC.g, topC.b, 255,
       HUGE, -HUGE, 1, 0, topC.r, topC.g, topC.b, 255,
       HUGE, -d,    1, 1, topC.r, topC.g, topC.b, 255,
      -HUGE, -d,    0, 1, topC.r, topC.g, topC.b, 255
    );
    writeQuad(
      -HUGE, -d, 0, 0, topC.r, topC.g, topC.b, 255,
       HUGE, -d, 1, 0, topC.r, topC.g, topC.b, 255,
       HUGE,  d, 1, 1, btmC.r, btmC.g, btmC.b, 255,
      -HUGE,  d, 0, 1, btmC.r, btmC.g, btmC.b, 255
    );
    writeQuad(
      -HUGE,  d,    0, 0, btmC.r, btmC.g, btmC.b, 255,
       HUGE,  d,    1, 0, btmC.r, btmC.g, btmC.b, 255,
       HUGE,  HUGE, 1, 1, btmC.r, btmC.g, btmC.b, 255,
      -HUGE,  HUGE, 0, 1, btmC.r, btmC.g, btmC.b, 255
    );
    const bgCount = ptr / FLOATS_PER_VERTEX - bgFirst;

    // 2–4. Smooth Edges & Polygons
    let edgeBackFirst = ptr / FLOATS_PER_VERTEX;
    let edgeBackCount = 0;
    let edgeFrontFirst = edgeBackFirst;
    let edgeFrontCount = 0;
    let polyBackFirst = edgeBackFirst;
    let polyBackCount = 0;
    let polyFrontFirst = edgeBackFirst;
    let polyFrontCount = 0;

    if (geometrySlice) {
      buf.set(geometrySlice.floats, ptr);
      ptr += geometrySlice.floats.length;

      edgeBackCount = geometrySlice.edgeBackCount;
      edgeFrontFirst = edgeBackFirst + edgeBackCount;
      edgeFrontCount = geometrySlice.edgeFrontCount;
      polyBackFirst = edgeFrontFirst + edgeFrontCount;
      polyBackCount = geometrySlice.polyBackCount;
      polyFrontFirst = polyBackFirst + polyBackCount;
      polyFrontCount = geometrySlice.polyFrontCount;
    }

    // 5. Scenery Props grouped by Level (0 = Back, 1 = Mid, 2 = Front) preserving exact PMS order!
    const propCalls: [PropDrawCall[], PropDrawCall[], PropDrawCall[]] = [[], [], []];
    for (let level = 0 as 0 | 1 | 2; level <= 2; level = (level + 1) as 0 | 1 | 2) {
      for (let pIdx = 0; pIdx < map.props.length; pIdx++) {
        const prop = map.props[pIdx];
        if (!prop.active || prop.level !== level) continue;
        if (propFilter && !propFilter(prop, pIdx)) continue;
        const scIdx = prop.style - 1;
        const scInfo = resolveScenery(scIdx);
        if (!scInfo) continue;
        if (prop.width === 0 || prop.height === 0) continue;

        const corners = computePropCorners(
          prop.x,
          prop.y,
          prop.width,
          prop.height,
          prop.scaleX,
          prop.scaleY,
          prop.rotation
        );

        const firstV = ptr / FLOATS_PER_VERTEX;
        const r = prop.color.r;
        const g = prop.color.g;
        const b = prop.color.b;
        const a = prop.alpha;
        const { u0, v0, u1, v1 } = scInfo;

        writeQuad(
          corners[0], corners[1], u0, v0, r, g, b, a,
          corners[2], corners[3], u1, v0, r, g, b, a,
          corners[4], corners[5], u1, v1, r, g, b, a,
          corners[6], corners[7], u0, v1, r, g, b, a
        );

        const levelCalls = propCalls[level];
        const prev = levelCalls.length > 0 ? levelCalls[levelCalls.length - 1] : null;
        if (prev && prev.texture === scInfo.tex && prev.firstVertex + prev.vertexCount === firstV) {
          prev.vertexCount += 6;
        } else {
          levelCalls.push({
            texture: scInfo.tex,
            firstVertex: firstV,
            vertexCount: 6,
          });
        }
      }
    }

    return {
      floatSlice: buf.subarray(0, ptr),
      bgBackRange: { first: bgFirst, count: bgCount },
      edgeBackRange: { first: edgeBackFirst, count: edgeBackCount },
      polyBackRange: { first: polyBackFirst, count: polyBackCount },
      edgeFrontRange: { first: edgeFrontFirst, count: edgeFrontCount },
      polyFrontRange: { first: polyFrontFirst, count: polyFrontCount },
      propCalls,
    };
  }

  /**
   * Frees the least recently used textures that the current map does not draw, until the unused ones fit the
   * byte budget and the cache fits the entry cap. Must run after disposeCurrentMap() (nothing else holds them).
   */
  private evictExcessCachedTextures(keepSet: Set<CachedGpuTextureEntry>): void {
    const gl = this.gl;
    const candidates: Array<[string, CachedGpuTextureEntry]> = [];
    let unusedBytes = 0;
    for (const item of this.gpuTextureCache.entries()) {
      if (keepSet.has(item[1])) continue;
      candidates.push(item);
      unusedBytes += item[1].bytes;
    }
    candidates.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, entry] of candidates) {
      if (unusedBytes <= this.textureCacheBudgetBytes && this.gpuTextureCache.size <= MAX_GPU_TEXTURE_CACHE) break;
      if (entry.isOwned && !gl.isContextLost() && !this.resourcesLost) {
        gl.deleteTexture(entry.tex);
      }
      unusedBytes -= entry.bytes;
      this.gpuTextureCache.delete(key);
    }
  }

  private touchTextures(entries: Iterable<CachedGpuTextureEntry>): void {
    const now = ++this.useClock;
    for (const entry of entries) entry.lastUsed = now;
  }

  /**
   * Synchronously updates vertex buffers in-place (`gl.bufferSubData` on `gl.DYNAMIC_DRAW`)
   * with zero async asset fetches or texture re-uploads whenever all referenced textures are already cached on the GPU.
   * Returns `false` when a new texture or scenery image must be loaded via `loadMap()`.
   */
  public updateMapFast(
    nextMap: PmsMapData,
    options?: { preferClassicBmp?: boolean }
  ): boolean {
    const gl = this.gl;
    const prev = this.prepared;
    if (gl.isContextLost() || !prev || prev.skipGeometry || prev.hasPropFilter) {
      return false;
    }
    // Images were reloaded from disk (refresh, new Soldat path): only a full loadMap() picks them up
    if (getAssetCacheEpoch() !== this.assetEpochSeen) return false;

    const preferClassicBmp = Boolean(options?.preferClassicBmp);
    if (prev.preferClassicBmp !== preferClassicBmp) return false;

    const nextTexLower = (nextMap.texture || 'default.bmp').toLowerCase();
    if (prev.textureNameLower !== nextTexLower) return false;

    const bmpFlag = preferClassicBmp ? '1' : '0';
    const activeSet = new Set<CachedGpuTextureEntry>();
    for (const t of prev.activeTextures) activeSet.add(t);

    const sceneryByIndex = new Map<number, SceneryTextureInfo>();
    for (let idx = 0; idx < nextMap.props.length; idx++) {
      const p = nextMap.props[idx];
      if (!p.active || p.level > 2 || p.style <= 0 || p.style > nextMap.scenery.length) continue;
      const scIdx = p.style - 1;
      if (sceneryByIndex.has(scIdx)) continue;
      const scKey = `scen:${bmpFlag}:${nextMap.scenery[scIdx].filename.toLowerCase()}`;
      const cached = this.gpuTextureCache.get(scKey);
      if (!cached || !cached.sceneryInfo) {
        return false;
      }
      activeSet.add(cached);
      sceneryByIndex.set(scIdx, cached.sceneryInfo);
    }

    // Invalidate any older async loadMap() that might still be in flight
    this.loadSeq++;

    const geometryUnchanged =
      prev.geometryCache !== null &&
      prev.geometryCache.polygonsRef === nextMap.polygons &&
      prev.geometryCache.sectorsDivision === nextMap.sectorsDivision;

    // Edited triangles no longer match the file's sector table: smooth edges then use the live spatial grid
    const geometrySlice = geometryUnchanged
      ? prev.geometryCache!
      : this.buildGeometrySlice(nextMap, prev.edgeDims, !sectorTableFitsPolygons(nextMap));
    this.touchTextures(activeSet);

    const packed = this.packFullVertexBuffer(
      nextMap,
      geometrySlice,
      (scIdx) => sceneryByIndex.get(scIdx)
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, prev.vbo);
    let capacityFloats = prev.vboCapacityFloats;
    if (packed.floatSlice.length <= capacityFloats) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.floatSlice);
    } else {
      capacityFloats = Math.max(packed.floatSlice.length + 4096, Math.ceil(packed.floatSlice.length * 1.5));
      gl.bufferData(gl.ARRAY_BUFFER, capacityFloats * 4, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.floatSlice);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.prepared = {
      ...prev,
      map: nextMap,
      activeTextures: Array.from(activeSet),
      vboCapacityFloats: capacityFloats,
      geometryCache: geometrySlice,
      bgBackRange: packed.bgBackRange,
      edgeBackRange: packed.edgeBackRange,
      polyBackRange: packed.polyBackRange,
      edgeFrontRange: packed.edgeFrontRange,
      polyFrontRange: packed.polyFrontRange,
      propCalls: packed.propCalls,
    };

    return true;
  }

  /**
   * Uploads a map to the GPU. Returns false when the load was superseded by a newer loadMap() call
   * (rapid map switching) or the context was lost — the previously prepared map is then left untouched.
   */
  public async loadMap(
    map: PmsMapData,
    options?: {
      preferClassicBmp?: boolean;
      skipGeometry?: boolean;
      propFilter?: (prop: PmsProp, arrayIdx: number) => boolean;
    }
  ): Promise<boolean> {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    const seq = ++this.loadSeq;
    const preferClassicBmp = Boolean(options?.preferClassicBmp);
    const skipGeometry = Boolean(options?.skipGeometry);
    const propFilter = options?.propFilter;
    const texFilename = map.texture || 'default.bmp';
    const texLower = texFilename.toLowerCase();
    const bmpFlag = preferClassicBmp ? '1' : '0';

    const mainKey = `main:${bmpFlag}:${texLower}`;
    const edgeKey = `edge:${bmpFlag}:${texLower}`;

    // Identify all used scenery indices and which textures are not yet in the GPU cache
    const usedSceneryIndices = new Set<number>();
    for (let idx = 0; idx < map.props.length; idx++) {
      const p = map.props[idx];
      if (p.active && p.level <= 2 && p.style > 0 && p.style <= map.scenery.length) {
        if (!propFilter || propFilter(p, idx)) {
          usedSceneryIndices.add(p.style - 1);
        }
      }
    }

    // After the images were reloaded from disk, every texture is uploaded again into a fresh cache that replaces
    // the old one once this load is applied (the old textures may still be drawn until then)
    const epoch = getAssetCacheEpoch();
    const freshCache = epoch !== this.assetEpochSeen;
    const cache = freshCache ? new Map<string, CachedGpuTextureEntry>() : this.gpuTextureCache;
    // Failed loads are cached as placeholders so edits stay fast, but each full load tries them again
    const isCached = (key: string) => {
      const entry = cache.get(key);
      return Boolean(entry && !entry.placeholder);
    };

    const needMainFetch = !skipGeometry && !isCached(mainKey);
    const needEdgeFetch = !skipGeometry && !isCached(edgeKey);
    const uncachedSceneryIndices = Array.from(usedSceneryIndices).filter((scIdx) => {
      const scKey = `scen:${bmpFlag}:${map.scenery[scIdx].filename.toLowerCase()}`;
      return !isCached(scKey);
    });

    const [mainImg, edgeImg, ...sceneryImgs] = await Promise.all([
      !needMainFetch
        ? Promise.resolve(null)
        : loadSoldatAssetImage('textures', texFilename, false, preferClassicBmp).then(
            (img) => img ?? loadSoldatAssetImage('textures', 'default.bmp', false, preferClassicBmp)
          ),
      !needEdgeFetch
        ? Promise.resolve(null)
        : loadSoldatAssetImage('textures/edges', texFilename, true, preferClassicBmp).then(
            (img) =>
              img ?? loadSoldatAssetImage('textures/edges', 'default.bmp', true, preferClassicBmp)
          ),
      ...uncachedSceneryIndices.map(async (scIdx) => {
        const asset = await loadSoldatAssetImage(
          'scenery-gfx',
          map.scenery[scIdx].filename,
          true,
          preferClassicBmp
        );
        return { scIdx, asset };
      }),
    ]);

    if (gl.isContextLost() || seq !== this.loadSeq) return false;

    const activeTexturesSet = new Set<CachedGpuTextureEntry>();

    let mainEntry = skipGeometry ? undefined : cache.get(mainKey);
    if (!skipGeometry && (!mainEntry || (mainEntry.placeholder && mainImg))) {
      if (mainImg) {
        const tex = this.uploadTexture(mainImg.width, mainImg.height, mainImg.premultipliedData, true, true);
        mainEntry = {
          tex,
          hasMipmaps: true,
          isOwned: true,
          width: mainImg.width,
          height: mainImg.height,
          pixelatedApplied: false,
          bytes: textureBytes(mainImg.width, mainImg.height, true),
          lastUsed: 0,
        };
      } else {
        mainEntry = {
          tex: this.fallbackCheckerTexture,
          hasMipmaps: true,
          isOwned: false,
          width: 16,
          height: 16,
          pixelatedApplied: false,
          bytes: 0,
          lastUsed: 0,
          placeholder: true,
        };
      }
      cache.set(mainKey, mainEntry);
    }
    if (mainEntry) activeTexturesSet.add(mainEntry);

    let edgeEntry = skipGeometry ? undefined : cache.get(edgeKey);
    if (!skipGeometry && (!edgeEntry || (edgeEntry.placeholder && edgeImg))) {
      if (edgeImg) {
        // Edge strips are thin (e.g. 90x4 or 90x1); disable mipmaps to prevent vertical alpha bleed
        const tex = this.uploadTexture(edgeImg.width, edgeImg.height, edgeImg.premultipliedData, false, false);
        edgeEntry = {
          tex,
          hasMipmaps: false,
          isOwned: true,
          width: edgeImg.width,
          height: edgeImg.height,
          pixelatedApplied: false,
          bytes: textureBytes(edgeImg.width, edgeImg.height, false),
          lastUsed: 0,
        };
      } else {
        edgeEntry = {
          tex: this.whiteTexture,
          hasMipmaps: false,
          isOwned: false,
          width: 0,
          height: 0,
          pixelatedApplied: false,
          bytes: 0,
          lastUsed: 0,
          placeholder: true,
        };
      }
      cache.set(edgeKey, edgeEntry);
    }
    if (edgeEntry && edgeEntry.width > 0) activeTexturesSet.add(edgeEntry);

    for (const { scIdx, asset } of sceneryImgs) {
      const scKey = `scen:${bmpFlag}:${map.scenery[scIdx].filename.toLowerCase()}`;
      const existing = cache.get(scKey);
      if (existing && (!existing.placeholder || !asset)) continue;
      if (asset) {
        const pad = SCENERY_ATLAS_PADDING;
        const padded = padTransparent(asset.width, asset.height, asset.premultipliedData, pad);
        const tex = this.uploadTexture(padded.width, padded.height, padded.data, false, true);
        const sceneryInfo: SceneryTextureInfo = {
          tex,
          width: asset.width,
          height: asset.height,
          u0: pad / padded.width,
          v0: pad / padded.height,
          u1: (pad + asset.width) / padded.width,
          v1: (pad + asset.height) / padded.height,
        };
        cache.set(scKey, {
          tex,
          hasMipmaps: true,
          isOwned: true,
          width: asset.width,
          height: asset.height,
          sceneryInfo,
          pixelatedApplied: false,
          bytes: textureBytes(padded.width, padded.height, true),
          lastUsed: 0,
        });
      } else {
        cache.set(scKey, {
          tex: this.fallbackCheckerTexture,
          hasMipmaps: true,
          isOwned: false,
          width: 32,
          height: 32,
          sceneryInfo: {
            tex: this.fallbackCheckerTexture,
            width: 32,
            height: 32,
            u0: 0,
            v0: 0,
            u1: 1,
            v1: 1,
          },
          pixelatedApplied: false,
          bytes: 0,
          lastUsed: 0,
          placeholder: true,
        });
      }
    }

    const sceneryTexMap = new Map<number, SceneryTextureInfo>();
    for (const scIdx of usedSceneryIndices) {
      const scKey = `scen:${bmpFlag}:${map.scenery[scIdx].filename.toLowerCase()}`;
      const entry = cache.get(scKey);
      if (entry && entry.sceneryInfo) {
        activeTexturesSet.add(entry);
        sceneryTexMap.set(scIdx, entry.sceneryInfo);
      }
    }

    this.disposeCurrentMap();
    if (freshCache) {
      // Nothing draws the textures of the previous epoch any more
      const gl2 = this.gl;
      for (const entry of this.gpuTextureCache.values()) {
        if (entry.isOwned && !gl2.isContextLost() && !this.resourcesLost) gl2.deleteTexture(entry.tex);
      }
      this.gpuTextureCache = cache;
      this.assetEpochSeen = epoch;
    }
    this.touchTextures(activeTexturesSet);
    this.evictExcessCachedTextures(activeTexturesSet);

    const edgeTex = edgeEntry && edgeEntry.width > 0 ? edgeEntry.tex : null;
    const edgeDims =
      edgeEntry && edgeEntry.width > 0 ? { width: edgeEntry.width, height: edgeEntry.height } : null;

    const geometrySlice = skipGeometry
      ? null
      : this.buildGeometrySlice(map, edgeDims, !sectorTableFitsPolygons(map));
    const packed = this.packFullVertexBuffer(
      map,
      geometrySlice,
      (scIdx) => sceneryTexMap.get(scIdx),
      propFilter
    );

    const capacityFloats = Math.max(packed.floatSlice.length + 2048, Math.ceil(packed.floatSlice.length * 1.25));
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, capacityFloats * 4, gl.DYNAMIC_DRAW);
    if (packed.floatSlice.length > 0) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packed.floatSlice);
    }

    const strideBytes = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, strideBytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, strideBytes, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, strideBytes, 16);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.prepared = {
      map,
      preferClassicBmp,
      skipGeometry,
      hasPropFilter: Boolean(propFilter),
      textureNameLower: texLower,
      whiteTex: this.whiteTexture,
      mainTex: mainEntry ? mainEntry.tex : this.fallbackCheckerTexture,
      edgeTex,
      edgeDims,
      activeTextures: Array.from(activeTexturesSet),
      vao,
      vbo,
      vboCapacityFloats: capacityFloats,
      geometryCache: geometrySlice,
      bgBackRange: packed.bgBackRange,
      edgeBackRange: packed.edgeBackRange,
      polyBackRange: packed.polyBackRange,
      edgeFrontRange: packed.edgeFrontRange,
      polyFrontRange: packed.polyFrontRange,
      propCalls: packed.propCalls,
    };
    return true;
  }

  private syncTextureFilter(pixelated: boolean): void {
    if (!this.prepared) return;
    const gl = this.gl;
    for (const entry of this.prepared.activeTextures) {
      if (!entry.isOwned || entry.pixelatedApplied === pixelated) continue;
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      if (pixelated) {
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          entry.hasMipmaps ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          entry.hasMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      entry.pixelatedApplied = pixelated;
    }
  }

  /**
   * Renders the loaded Soldat map for the exact world rectangle [left, right, top, bottom]
   * matching OpenSoldat GameRendering.pas draw order!
   */
  public render(
    bounds: { left: number; right: number; top: number; bottom: number },
    layers: RenderLayerVisibility,
    options?: { transparentClear?: boolean }
  ): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drawScene(bounds, layers, this.canvas.width, this.canvas.height, Boolean(options?.transparentClear));
  }

  private drawScene(
    bounds: { left: number; right: number; top: number; bottom: number },
    layers: RenderLayerVisibility,
    viewportW: number,
    viewportH: number,
    transparentClear: boolean
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, viewportW, viewportH);
    if (transparentClear) {
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
    } else {
      gl.clearColor(0.07, 0.08, 0.1, 1.0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.prepared) return;

    const spanX = bounds.right - bounds.left;
    const spanY = bounds.bottom - bounds.top;
    if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || Math.abs(spanX) < 1e-3 || Math.abs(spanY) < 1e-3) {
      return;
    }

    this.syncTextureFilter(Boolean(layers.pixelatedFilter));

    const p = this.prepared;
    gl.useProgram(this.program);
    gl.bindVertexArray(p.vao);
    gl.uniform4f(this.uBoundsLoc, bounds.left, bounds.right, bounds.top, bounds.bottom);
    gl.uniform1i(this.uTexLoc, 0);
    gl.uniform1f(this.uOpacityMulLoc, 1.0);
    gl.uniform1f(this.uLodBiasLoc, GAME_MIPMAP_BIAS);
    gl.activeTexture(gl.TEXTURE0);

    // 1. Background gradient
    if (layers.showBackground && p.bgBackRange.count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, p.whiteTex);
      gl.drawArrays(gl.TRIANGLES, p.bgBackRange.first, p.bgBackRange.count);
    }

    // 2. Smooth Edges [0] (Background Polygons)
    if (layers.showPolygons && layers.showSmoothEdges && p.edgeTex && p.edgeBackRange.count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, p.edgeTex);
      gl.drawArrays(gl.TRIANGLES, p.edgeBackRange.first, p.edgeBackRange.count);
    }

    // 3. Background Polygons (PolyType 24, 25)
    if (layers.showPolygons && p.polyBackRange.count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, p.mainTex);
      gl.drawArrays(gl.TRIANGLES, p.polyBackRange.first, p.polyBackRange.count);
    }

    // 4. Scenery Level 0 (Back)
    if (layers.showSceneryBack) {
      for (const call of p.propCalls[0]) {
        gl.bindTexture(gl.TEXTURE_2D, call.texture);
        gl.drawArrays(gl.TRIANGLES, call.firstVertex, call.vertexCount);
      }
    }

    // 5. Scenery Level 1 (Middle — in front of players, behind main polygons)
    if (layers.showSceneryMid) {
      for (const call of p.propCalls[1]) {
        gl.bindTexture(gl.TEXTURE_2D, call.texture);
        gl.drawArrays(gl.TRIANGLES, call.firstVertex, call.vertexCount);
      }
    }

    // 6. Smooth Edges [1] (Foreground Polygons)
    if (layers.showPolygons && layers.showSmoothEdges && p.edgeTex && p.edgeFrontRange.count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, p.edgeTex);
      gl.drawArrays(gl.TRIANGLES, p.edgeFrontRange.first, p.edgeFrontRange.count);
    }

    // 7. Main Foreground Polygons (PolyType 0..23)
    if (layers.showPolygons && p.polyFrontRange.count > 0) {
      gl.bindTexture(gl.TEXTURE_2D, p.mainTex);
      gl.drawArrays(gl.TRIANGLES, p.polyFrontRange.first, p.polyFrontRange.count);
    }

    // 8. Scenery Level 2 (Front — hiding spots!)
    if (layers.showSceneryFront && layers.frontSceneryOpacity > 0.01) {
      gl.uniform1f(this.uOpacityMulLoc, layers.frontSceneryOpacity);
      for (const call of p.propCalls[2]) {
        gl.bindTexture(gl.TEXTURE_2D, call.texture);
        gl.drawArrays(gl.TRIANGLES, call.firstVertex, call.vertexCount);
      }
      gl.uniform1f(this.uOpacityMulLoc, 1.0);
    }

    gl.bindVertexArray(null);
  }

  private supportsFloatTarget(): boolean {
    if (this.floatTargetSupported === null) {
      this.floatTargetSupported = Boolean(this.gl.getExtension('EXT_color_buffer_float'));
    }
    return this.floatTargetSupported;
  }

  /**
   * Renders the world rectangle into an offscreen framebuffer of `width` x `height` pixels and reads it back
   * as top-down straight (unpremultiplied) RGBA8. Blending happens in an RGBA16F target when the GPU allows it,
   * so stacking dozens of semi-transparent props never accumulates 8-bit premultiply rounding errors.
   * Fully opaque pure #00FF00 pixels are nudged to #00FE00 so Soldat's color key never punches holes into baked PNGs.
   */
  public renderOffscreenUnpremultiplied(
    bounds: { left: number; right: number; top: number; bottom: number },
    layers: RenderLayerVisibility,
    width: number,
    height: number
  ): OffscreenReadback {
    const gl = this.gl;
    if (gl.isContextLost()) {
      throw new Error(t('WebGL2 context lost while rendering a layer.'));
    }

    let useFloat = this.supportsFloatTarget();
    let tex: WebGLTexture | null = null;
    let fbo: WebGLFramebuffer | null = null;

    const allocate = (asFloat: boolean): boolean => {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (asFloat) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!ok) release();
      return ok;
    };
    const release = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (fbo) gl.deleteFramebuffer(fbo);
      if (tex) gl.deleteTexture(tex);
      fbo = null;
      tex = null;
    };

    if (!allocate(useFloat)) {
      if (!useFloat || !allocate(false)) {
        throw new Error(t('Could not create a {w}×{h} px render buffer.', { w: width, h: height }));
      }
      useFloat = false;
      this.floatTargetSupported = false;
    }

    try {
      this.drawScene(bounds, layers, width, height, true);

      const out = new Uint8ClampedArray(width * height * 4);
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      const stripRows = Math.max(1, Math.min(height, READBACK_STRIP_ROWS));
      const floatBuf = useFloat ? new Float32Array(width * stripRows * 4) : null;
      const byteBuf = useFloat ? null : new Uint8Array(width * stripRows * 4);

      for (let y0 = 0; y0 < height; y0 += stripRows) {
        const rows = Math.min(stripRows, height - y0);
        if (floatBuf) {
          gl.readPixels(0, y0, width, rows, gl.RGBA, gl.FLOAT, floatBuf);
        } else {
          gl.readPixels(0, y0, width, rows, gl.RGBA, gl.UNSIGNED_BYTE, byteBuf!);
        }

        for (let ry = 0; ry < rows; ry++) {
          // WebGL rows are bottom-to-top; flip while unpremultiplying
          const outY = height - 1 - (y0 + ry);
          const srcRow = ry * width * 4;
          const dstRow = outY * width * 4;
          for (let x = 0; x < width; x++) {
            const si = srcRow + x * 4;
            let a8: number;
            let r: number;
            let g: number;
            let b: number;
            if (floatBuf) {
              const af = Math.min(1, floatBuf[si + 3]);
              a8 = Math.round(af * 255);
              if (a8 <= 0) continue;
              const inv = 255 / af;
              r = Math.min(255, Math.max(0, Math.round(floatBuf[si] * inv)));
              g = Math.min(255, Math.max(0, Math.round(floatBuf[si + 1] * inv)));
              b = Math.min(255, Math.max(0, Math.round(floatBuf[si + 2] * inv)));
            } else {
              a8 = byteBuf![si + 3];
              if (a8 === 0) continue;
              if (a8 === 255) {
                r = byteBuf![si];
                g = byteBuf![si + 1];
                b = byteBuf![si + 2];
              } else {
                const inv = 255 / a8;
                r = Math.min(255, Math.round(byteBuf![si] * inv));
                g = Math.min(255, Math.round(byteBuf![si + 1] * inv));
                b = Math.min(255, Math.round(byteBuf![si + 2] * inv));
              }
            }

            // Avoid Soldat #00FF00 lime-green transparency color-key collision (key only matches alpha 255)
            if (a8 === 255 && r === 0 && g === 255 && b === 0) {
              g = 254;
            }

            const di = dstRow + x * 4;
            out[di] = r;
            out[di + 1] = g;
            out[di + 2] = b;
            out[di + 3] = a8;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (outY < minY) minY = outY;
            if (outY > maxY) maxY = outY;
          }
        }
      }

      return {
        width,
        height,
        rgba: out,
        nonEmptyBounds: maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null,
        floatPrecision: useFloat,
      };
    } finally {
      release();
    }
  }

  public clearGpuTextureCache(): void {
    const gl = this.gl;
    if (!gl.isContextLost() && !this.resourcesLost) {
      for (const entry of this.gpuTextureCache.values()) {
        if (entry.isOwned) {
          gl.deleteTexture(entry.tex);
        }
      }
    }
    this.gpuTextureCache.clear();
  }

  public disposeCurrentMap(): void {
    if (!this.prepared) return;
    const gl = this.gl;
    if (!gl.isContextLost() && !this.resourcesLost) {
      gl.deleteBuffer(this.prepared.vbo);
      gl.deleteVertexArray(this.prepared.vao);
    }
    this.prepared = null;
  }

  public destroy(loseContext = false): void {
    this.loadSeq++; // Invalidate any in-flight loadMap()
    this.disposeCurrentMap();
    this.clearGpuTextureCache();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    if (!this.gl.isContextLost()) {
      if (!this.resourcesLost) {
        this.gl.deleteTexture(this.whiteTexture);
        this.gl.deleteTexture(this.fallbackCheckerTexture);
        this.gl.deleteProgram(this.program);
      }
      if (loseContext) {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
  }

  private uploadTexture(
    width: number,
    height: number,
    rgbaData: Uint8ClampedArray,
    repeatWrap: boolean,
    allowMipmaps = true
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgbaData
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatWrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeatWrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);

    if (allowMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return tex;
  }

  private createSolidTexture(r: number, g: number, b: number, a: number): WebGLTexture {
    const data = new Uint8ClampedArray([r, g, b, a]);
    return this.uploadTexture(1, 1, data, true, false);
  }

  private createMissingCheckerTexture(): WebGLTexture {
    const size = 16;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const isMagenta = ((x >> 2) + (y >> 2)) % 2 === 0;
        const idx = (y * size + x) * 4;
        data[idx] = isMagenta ? 220 : 40;
        data[idx + 1] = isMagenta ? 38 : 40;
        data[idx + 2] = isMagenta ? 180 : 45;
        data[idx + 3] = 220;
      }
    }
    return this.uploadTexture(size, size, data, true, true);
  }

  private createShaderProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      throw new Error(`WebGL2 program link error: ${info}`);
    }
    return prog;
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL2 shader compile error: ${info}`);
    }
    return shader;
  }
}
