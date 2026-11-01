import {
  computePropCorners,
  computeTransformCorners,
  PmsMapData,
  PmsProp,
  PmsVertex,
} from '@shared/pmsParser';
import { loadSoldatAssetImage } from './assetLoader';
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

out vec4 fragColor;

void main() {
  vec4 tex = texture(uTex, vUV);
  float a = vColor.a * uOpacityMul;
  vec4 vc = vec4(vColor.rgb * a, a);
  fragColor = tex * vc;
}
`;

interface PropDrawCall {
  texture: WebGLTexture;
  firstVertex: number;
  vertexCount: number;
}

interface TextureRecord {
  tex: WebGLTexture;
  hasMipmaps: boolean;
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

interface PreparedGpuMap {
  map: PmsMapData;
  preferClassicBmp: boolean;
  pixelatedApplied: boolean;
  whiteTex: WebGLTexture;
  mainTex: WebGLTexture;
  edgeTex: WebGLTexture | null;
  ownedTextures: TextureRecord[];
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;

  bgBackRange: { first: number; count: number };
  edgeBackRange: { first: number; count: number };
  polyBackRange: { first: number; count: number };
  edgeFrontRange: { first: number; count: number };
  polyFrontRange: { first: number; count: number };
  propCalls: [PropDrawCall[], PropDrawCall[], PropDrawCall[]];
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
function createEdgeCoverageTest(map: PmsMapData): (mx: number, my: number, selfIdx: number) => boolean {
  const n = map.sectorsNum;
  const div = map.sectorsDivision;
  const side = 2 * n + 1;
  const sectors = map.sectorsPolys;
  const polys = map.polygons;

  if (sectors && div > 0 && n >= 0 && sectors.length === side * side) {
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
  private whiteTexture: WebGLTexture;
  private fallbackCheckerTexture: WebGLTexture;
  private prepared: PreparedGpuMap | null = null;
  private loadSeq = 0;
  private floatTargetSupported: boolean | null = null;

  constructor(canvas: HTMLCanvasElement, options?: { transparentCanvas?: boolean }) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: Boolean(options?.transparentCanvas),
      antialias: !options?.transparentCanvas,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error('Twoja przeglądarka nie obsługuje WebGL2 wymaganego przez silnik Soldat Map Studio.');
    }
    this.gl = gl;

    this.program = this.createShaderProgram(VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
    this.uBoundsLoc = gl.getUniformLocation(this.program, 'uBounds')!;
    this.uTexLoc = gl.getUniformLocation(this.program, 'uTex')!;
    this.uOpacityMulLoc = gl.getUniformLocation(this.program, 'uOpacityMul')!;

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

    // Load main texture, smooth edge texture, and all used scenery textures in parallel
    const usedSceneryIndices = new Set<number>();
    for (let idx = 0; idx < map.props.length; idx++) {
      const p = map.props[idx];
      if (p.active && p.level <= 2 && p.style > 0 && p.style <= map.scenery.length) {
        if (!propFilter || propFilter(p, idx)) {
          usedSceneryIndices.add(p.style - 1);
        }
      }
    }

    const [mainImg, edgeImg, ...sceneryImgs] = await Promise.all([
      skipGeometry
        ? Promise.resolve(null)
        : loadSoldatAssetImage('textures', texFilename, false, preferClassicBmp).then(
            (img) => img ?? loadSoldatAssetImage('textures', 'default.bmp', false, preferClassicBmp)
          ),
      skipGeometry
        ? Promise.resolve(null)
        : loadSoldatAssetImage('textures/edges', texFilename, true, preferClassicBmp).then(
            (img) =>
              img ?? loadSoldatAssetImage('textures/edges', 'default.bmp', true, preferClassicBmp)
          ),
      ...Array.from(usedSceneryIndices).map(async (scIdx) => {
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

    this.disposeCurrentMap();

    const ownedTextures: TextureRecord[] = [];

    const mainTex = mainImg
      ? this.uploadTexture(mainImg.width, mainImg.height, mainImg.premultipliedData, true, true)
      : this.fallbackCheckerTexture;
    if (mainImg) ownedTextures.push({ tex: mainTex, hasMipmaps: true });

    let edgeTex: WebGLTexture | null = null;
    if (edgeImg) {
      // Edge strips are thin (e.g. 90x4 or 90x1); disable mipmaps to prevent vertical alpha bleed
      edgeTex = this.uploadTexture(edgeImg.width, edgeImg.height, edgeImg.premultipliedData, false, false);
      ownedTextures.push({ tex: edgeTex, hasMipmaps: false });
    }

    const sceneryTexMap = new Map<number, SceneryTextureInfo>();
    for (const { scIdx, asset } of sceneryImgs) {
      if (asset) {
        const pad = SCENERY_ATLAS_PADDING;
        const padded = padTransparent(asset.width, asset.height, asset.premultipliedData, pad);
        const tex = this.uploadTexture(padded.width, padded.height, padded.data, false, true);
        ownedTextures.push({ tex, hasMipmaps: true });
        sceneryTexMap.set(scIdx, {
          tex,
          width: asset.width,
          height: asset.height,
          u0: pad / padded.width,
          v0: pad / padded.height,
          u1: (pad + asset.width) / padded.width,
          v1: (pad + asset.height) / padded.height,
        });
      } else {
        sceneryTexMap.set(scIdx, {
          tex: this.fallbackCheckerTexture,
          width: 32,
          height: 32,
          u0: 0,
          v0: 0,
          u1: 1,
          v1: 1,
        });
      }
    }

    // Build unified float32 vertex buffer:
    // MapGraphics.pas: d := MAX_SECTOR * Max(SectorsDivision, Ceil(0.5 * GameHeight / MAX_SECTOR)), GameHeight = 480
    const d = 25 * Math.max(map.sectorsDivision || 1, 10);
    const HUGE = 500000;

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

    const topC = map.bgColorTop;
    const btmC = map.bgColorBtm;

    // 1. Background gradient (MapGraphics.pas, extended with flat colors above -d / below d)
    const bgFirst = 0;
    pushQuad(
      -HUGE, -HUGE, 0, 0, topC.r, topC.g, topC.b, 255,
       HUGE, -HUGE, 1, 0, topC.r, topC.g, topC.b, 255,
       HUGE, -d,    1, 1, topC.r, topC.g, topC.b, 255,
      -HUGE, -d,    0, 1, topC.r, topC.g, topC.b, 255
    );
    pushQuad(
      -HUGE, -d, 0, 0, topC.r, topC.g, topC.b, 255,
       HUGE, -d, 1, 0, topC.r, topC.g, topC.b, 255,
       HUGE,  d, 1, 1, btmC.r, btmC.g, btmC.b, 255,
      -HUGE,  d, 0, 1, btmC.r, btmC.g, btmC.b, 255
    );
    pushQuad(
      -HUGE,  d,    0, 0, btmC.r, btmC.g, btmC.b, 255,
       HUGE,  d,    1, 0, btmC.r, btmC.g, btmC.b, 255,
       HUGE,  HUGE, 1, 1, btmC.r, btmC.g, btmC.b, 255,
      -HUGE,  HUGE, 0, 1, btmC.r, btmC.g, btmC.b, 255
    );
    const bgCount = verts.length / FLOATS_PER_VERTEX - bgFirst;

    // 2. Smooth Edges (OpenSoldat MapGraphics.pas r_smoothedges + PolyMap.pas sector coverage test)
    let edgeBackFirst = verts.length / FLOATS_PER_VERTEX;
    let edgeBackCount = 0;
    let edgeFrontFirst = edgeBackFirst;
    let edgeFrontCount = 0;

    if (!skipGeometry && edgeImg && edgeTex && map.polygons.length > 0) {
      const isCovered = createEdgeCoverageTest(map);
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
        const ew = edgeImg.width;
        const eh = edgeImg.height;
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

      edgeBackFirst = verts.length / FLOATS_PER_VERTEX;
      emitEdges(backEdges);
      edgeBackCount = verts.length / FLOATS_PER_VERTEX - edgeBackFirst;

      edgeFrontFirst = verts.length / FLOATS_PER_VERTEX;
      emitEdges(frontEdges);
      edgeFrontCount = verts.length / FLOATS_PER_VERTEX - edgeFrontFirst;
    }

    // 3. Background Polygons (PolyType 24 = BACKGROUND, 25 = BACKGROUND_TRANSITION)
    const polyBackFirst = verts.length / FLOATS_PER_VERTEX;
    if (!skipGeometry) {
      for (const poly of map.polygons) {
        if (poly.polyType === 24 || poly.polyType === 25) {
          for (const v of poly.vertices) {
            pushVert(v.x, v.y, v.u, v.v, v.color.r, v.color.g, v.color.b, v.color.a);
          }
        }
      }
    }
    const polyBackCount = verts.length / FLOATS_PER_VERTEX - polyBackFirst;

    // 4. Foreground / Normal Polygons (PolyType != 24 && != 25)
    const polyFrontFirst = verts.length / FLOATS_PER_VERTEX;
    if (!skipGeometry) {
      for (const poly of map.polygons) {
        if (poly.polyType !== 24 && poly.polyType !== 25) {
          for (const v of poly.vertices) {
            pushVert(v.x, v.y, v.u, v.v, v.color.r, v.color.g, v.color.b, v.color.a);
          }
        }
      }
    }
    const polyFrontCount = verts.length / FLOATS_PER_VERTEX - polyFrontFirst;

    // 5. Scenery Props grouped by Level (0 = Back, 1 = Mid, 2 = Front) preserving exact PMS order!
    const propCalls: [PropDrawCall[], PropDrawCall[], PropDrawCall[]] = [[], [], []];

    for (let level = 0 as 0 | 1 | 2; level <= 2; level = (level + 1) as 0 | 1 | 2) {
      for (let pIdx = 0; pIdx < map.props.length; pIdx++) {
        const prop = map.props[pIdx];
        if (!prop.active || prop.level !== level) continue;
        if (propFilter && !propFilter(prop, pIdx)) continue;
        const scIdx = prop.style - 1;
        const scInfo = sceneryTexMap.get(scIdx);
        if (!scInfo) continue;
        // GfxSpriteVertices builds the quad from the PMS Width/Height: 0 is an invisible degenerate quad in-game,
        // negative values mirror the sprite exactly like the game does.
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

        const firstV = verts.length / FLOATS_PER_VERTEX;
        const r = prop.color.r;
        const g = prop.color.g;
        const b = prop.color.b;
        const a = prop.alpha;
        const { u0, v0, u1, v1 } = scInfo;

        pushQuad(
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

    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

    const strideBytes = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, strideBytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, strideBytes, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, strideBytes, 16);

    gl.bindVertexArray(null);

    this.prepared = {
      map,
      preferClassicBmp,
      pixelatedApplied: false,
      whiteTex: this.whiteTexture,
      mainTex,
      edgeTex,
      ownedTextures,
      vao,
      vbo,
      bgBackRange: { first: bgFirst, count: bgCount },
      edgeBackRange: { first: edgeBackFirst, count: edgeBackCount },
      polyBackRange: { first: polyBackFirst, count: polyBackCount },
      edgeFrontRange: { first: edgeFrontFirst, count: edgeFrontCount },
      polyFrontRange: { first: polyFrontFirst, count: polyFrontCount },
      propCalls,
    };
    return true;
  }

  private syncTextureFilter(pixelated: boolean): void {
    if (!this.prepared || this.prepared.pixelatedApplied === pixelated) return;
    const gl = this.gl;
    for (const rec of this.prepared.ownedTextures) {
      gl.bindTexture(gl.TEXTURE_2D, rec.tex);
      if (pixelated) {
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          rec.hasMipmaps ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          rec.hasMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
    }
    this.prepared.pixelatedApplied = pixelated;
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
      throw new Error('Utracono kontekst WebGL2 podczas renderowania warstwy.');
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
        throw new Error(`Nie udało się utworzyć bufora renderowania ${width}×${height} px.`);
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

  public disposeCurrentMap(): void {
    if (!this.prepared) return;
    const gl = this.gl;
    if (!gl.isContextLost() && !this.resourcesLost) {
      for (const rec of this.prepared.ownedTextures) {
        gl.deleteTexture(rec.tex);
      }
      gl.deleteBuffer(this.prepared.vbo);
      gl.deleteVertexArray(this.prepared.vao);
    }
    this.prepared = null;
  }

  public destroy(loseContext = false): void {
    this.loadSeq++; // Invalidate any in-flight loadMap()
    this.disposeCurrentMap();
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
