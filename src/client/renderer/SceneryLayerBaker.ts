import {
  BakedSceneryTileUpload,
  IndexMetaResponse,
  MapOptimizePlanResponse,
  OptimizeCheckResponse,
  OptimizeMapOptions,
  OptimizeSaveResponse,
  OverwritePolicy,
} from '@shared/apiTypes';
import { cloneMapWithPropFixes, PmsMapData } from '@shared/pmsParser';
import { clearSoldatAssetCache, clearVirtualAssets, registerVirtualAsset } from './assetLoader';
import { SoldatWebGLRenderer } from './SoldatWebGLRenderer';
import { RenderLayerVisibility } from './types';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// World units of cross-fade overlap on each side of a seam between two baked tiles of the same layer.
// Soldat's sprite atlas has transparent padding, so a plain edge-to-edge tile join would show a faint seam
// (both tiles fade by half a texel); the alpha-split cross-fade below makes the join mathematically exact.
const TILE_OVERLAP_WORLD = 2;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function computePngCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const crc = computePngCrc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc, false);
  return out;
}

/**
 * Encodes straight (unpremultiplied) RGBA8888 directly into a lossless binary PNG without touching
 * HTML5 2D Canvas (`putImageData` + `toBlob`), completely eliminating Skia premultiply rounding
 * and monitor ICC profile color shifts!
 */
async function rgbaRectToPng(
  fullRgba: Uint8ClampedArray,
  fullWidth: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number
): Promise<Uint8Array<ArrayBuffer>> {
  const rowBytes = cropW * 4;
  const rawScanlines = new Uint8Array(cropH * (1 + rowBytes));

  for (let y = 0; y < cropH; y++) {
    const srcOffset = ((cropY + y) * fullWidth + cropX) * 4;
    const dstRowStart = y * (1 + rowBytes);
    rawScanlines[dstRowStart] = 0; // Filter type 0 (None) — the server re-encodes with adaptive filters
    rawScanlines.set(fullRgba.subarray(srcOffset, srcOffset + rowBytes), dstRowStart + 1);
  }

  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(rawScanlines);
  writer.close();
  const compressedIdat = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, cropW, false);
  ihdrView.setUint32(4, cropH, false);
  ihdr[8] = 8; // 8-bit per channel
  ihdr[9] = 6; // Color type 6: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', compressedIdat);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const pngBytes = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let offset = 0;
  pngBytes.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  pngBytes.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  pngBytes.set(idatChunk, offset);
  offset += idatChunk.length;
  pngBytes.set(iendChunk, offset);
  return pngBytes;
}

/**
 * Splits the alpha of the overlap bands between neighbouring tiles. A texel with straight alpha `a` and
 * blend weight `w` keeps alpha 1-(1-a)^w; since both tiles store the same color and the weights of all
 * tiles covering a texel sum to 1, drawing them over each other reproduces exactly alpha `a`.
 * Weight is 0 on each tile's outermost band texel, so Soldat's half-texel edge fade has nothing to fade.
 */
export function applySeamCrossFade(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  bandTexels: number,
  sides: { left: boolean; right: boolean; top: boolean; bottom: boolean }
): void {
  if (bandTexels < 2) return;
  const n1 = bandTexels - 1;
  const weightX = new Float32Array(width).fill(1);
  const weightY = new Float32Array(height).fill(1);
  for (let i = 0; i < bandTexels; i++) {
    const rising = i / n1; // 0 at the outer edge -> 1 towards the tile interior
    if (sides.left && i < width) weightX[i] = Math.min(weightX[i], rising);
    if (sides.right && width - 1 - i >= 0) weightX[width - 1 - i] = Math.min(weightX[width - 1 - i], rising);
    if (sides.top && i < height) weightY[i] = Math.min(weightY[i], rising);
    if (sides.bottom && height - 1 - i >= 0) weightY[height - 1 - i] = Math.min(weightY[height - 1 - i], rising);
  }

  for (let y = 0; y < height; y++) {
    const wy = weightY[y];
    for (let x = 0; x < width; x++) {
      const w = wy * weightX[x];
      if (w >= 1) continue;
      const di = (y * width + x) * 4;
      const a = rgba[di + 3];
      if (a === 0) continue;
      const a8 = w <= 0 ? 0 : Math.round((1 - Math.pow(1 - a / 255, w)) * 255);
      if (a8 === 0) {
        rgba[di] = 0;
        rgba[di + 1] = 0;
        rgba[di + 2] = 0;
      }
      rgba[di + 3] = a8;
    }
  }
}

function findNonEmptyBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX >= minX ? { minX, minY, maxX, maxY } : null;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export type SupersampleChoice = 'auto' | 1 | 2 | 3 | 4;

// "Auto" picks the sharpest supersampling whose baked layers stay under this texture budget (~190 MB RGBA)
export const AUTO_SUPERSAMPLE_BUDGET_MP = 48;

export function resolveSupersample(
  choice: SupersampleChoice,
  plan: MapOptimizePlanResponse | null
): 1 | 2 | 3 | 4 {
  if (choice !== 'auto') return choice;
  const mp = plan?.estimatedMegapixelsBySupersample;
  if (!mp) return 2;
  if (mp[2] <= AUTO_SUPERSAMPLE_BUDGET_MP) return 3;
  if (mp[1] <= AUTO_SUPERSAMPLE_BUDGET_MP) return 2;
  return 1;
}

export async function fetchOptimizePlan(
  mapId: string,
  options: OptimizeMapOptions,
  signal?: AbortSignal
): Promise<MapOptimizePlanResponse> {
  try {
    return await postJson<MapOptimizePlanResponse>('/api/workshop/optimize-plan', { mapId, options }, signal);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new Error((err as Error)?.message || 'Błąd przygotowania planu optymalizacji scenerii.');
  }
}

export async function checkOptimizeTarget(
  mapId: string,
  options: OptimizeMapOptions,
  signal?: AbortSignal
): Promise<OptimizeCheckResponse> {
  return postJson<OptimizeCheckResponse>('/api/workshop/optimize-check', { mapId, options }, signal);
}

/**
 * Bakes every planned layer group into lossless PNG tiles in memory (no disk I/O).
 * Rendering matches OpenSoldat (color key, premultiplied blending, atlas edge fade, PMS draw order)
 * and is composited in a float target at `supersample` texels per world unit.
 */
/** The map as the plan sees it: with the 1.7.1 size fixes applied when the plan was made with `fixFirst` */
export function applyPlanPropFixes(mapData: PmsMapData, plan: MapOptimizePlanResponse): PmsMapData {
  if (!plan.appliedPropFixes?.length) return mapData;
  return cloneMapWithPropFixes(
    mapData,
    new Map(plan.appliedPropFixes.map((f) => [f.propIndex, { width: f.width, height: f.height }]))
  );
}

export async function bakeSceneryTiles(
  sourceMap: PmsMapData,
  plan: MapOptimizePlanResponse,
  options: OptimizeMapOptions,
  onProgress?: (progress0to1: number, statusText: string) => void,
  signal?: AbortSignal
): Promise<Array<BakedSceneryTileUpload & { png: Uint8Array<ArrayBuffer> }>> {
  const mapData = applyPlanPropFixes(sourceMap, plan);
  const supersample = Math.max(1, Math.min(4, Math.round(options.supersample || 2)));
  const maxTilePx = options.maxTilePx === 4096 ? 4096 : 2048;
  const overlap = TILE_OVERLAP_WORLD;
  // Integer world units per tile core, so every tile edge and crop lands on whole world coordinates
  const tileWorldSpan = Math.max(64, Math.floor(maxTilePx / supersample) - 2 * overlap);
  const bandTexels = 2 * overlap * supersample;
  const invScale = 1 / supersample;

  const glCanvas = document.createElement('canvas');
  glCanvas.width = 1;
  glCanvas.height = 1;
  const glRenderer = new SoldatWebGLRenderer(glCanvas, { transparentCanvas: true });
  const tiles: Array<BakedSceneryTileUpload & { png: Uint8Array<ArrayBuffer> }> = [];
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Anulowano optymalizację.', 'AbortError');
  };

  try {
    let completedGroups = 0;
    const totalGroups = Math.max(1, plan.groups.length);
    const tileSeqByLevel: [number, number, number] = [0, 0, 0];
    // Clamp stem so "<stem>_<lvl><seq>.png" always fits inside the PMS ShortString[50]
    const stemSafe = plan.derivedBaseName.slice(0, 38);

    for (const grp of plan.groups) {
      throwIfAborted();
      const levelLabel = grp.level === 0 ? 'Tył' : grp.level === 1 ? 'Środek' : 'Przód';
      onProgress?.(
        0.1 + 0.72 * (completedGroups / totalGroups),
        `Sklejanie warstwy ${levelLabel} (#${grp.runIndex}, ${grp.propIndices.length} scenerii, ${supersample}×)...`
      );

      const allowedSet = new Set<number>(grp.propIndices);
      const applied = await glRenderer.loadMap(mapData, {
        preferClassicBmp: options.preferClassicBmp,
        skipGeometry: true,
        propFilter: (_p, idx) => allowedSet.has(idx),
      });
      if (!applied) {
        throw new Error('Nie udało się załadować scenerii na GPU (utracony kontekst WebGL2).');
      }

      const layerVis: RenderLayerVisibility = {
        showBackground: false,
        showPolygons: false,
        showSmoothEdges: false,
        showSceneryBack: grp.level === 0,
        showSceneryMid: grp.level === 1,
        showSceneryFront: grp.level === 2,
        frontSceneryOpacity: 1.0,
        preferClassicBmp: options.preferClassicBmp,
        pixelatedFilter: false,
        showColliders: false,
        showSpawns: false,
        showFlags: false,
        showBonuses: false,
        showWaypoints: false,
        showPolyTypes: false,
        showWireframe: false,
        showGrid: false,
      };

      const wb = grp.worldBounds;
      const cols = Math.max(1, Math.ceil(wb.width / tileWorldSpan));
      const rows = Math.max(1, Math.ceil(wb.height / tileWorldSpan));

      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          throwIfAborted();

          const coreLeft = wb.left + cx * tileWorldSpan;
          const coreRight = Math.min(wb.right, coreLeft + tileWorldSpan);
          const coreTop = wb.top + ry * tileWorldSpan;
          const coreBottom = Math.min(wb.bottom, coreTop + tileWorldSpan);
          if (coreRight <= coreLeft || coreBottom <= coreTop) continue;

          const sides = { left: cx > 0, right: cx < cols - 1, top: ry > 0, bottom: ry < rows - 1 };
          const tLeft = coreLeft - (sides.left ? overlap : 0);
          const tRight = coreRight + (sides.right ? overlap : 0);
          const tTop = coreTop - (sides.top ? overlap : 0);
          const tBottom = coreBottom + (sides.bottom ? overlap : 0);

          const pxW = Math.max(1, Math.round((tRight - tLeft) * supersample));
          const pxH = Math.max(1, Math.round((tBottom - tTop) * supersample));

          const readback = glRenderer.renderOffscreenUnpremultiplied(
            { left: tLeft, right: tRight, top: tTop, bottom: tBottom },
            layerVis,
            pxW,
            pxH
          );
          if (!readback.nonEmptyBounds) continue; // Completely transparent tile — no PNG needed

          applySeamCrossFade(readback.rgba, pxW, pxH, bandTexels, sides);
          const nb = findNonEmptyBounds(readback.rgba, pxW, pxH);
          if (!nb) continue;

          // Snap crop to whole world units; never crop into a shared seam band that holds content
          let cropMinX = Math.max(0, Math.floor(nb.minX / supersample) * supersample);
          let cropMinY = Math.max(0, Math.floor(nb.minY / supersample) * supersample);
          let cropMaxX = Math.min(pxW, Math.ceil((nb.maxX + 1) / supersample) * supersample);
          let cropMaxY = Math.min(pxH, Math.ceil((nb.maxY + 1) / supersample) * supersample);
          if (sides.left && nb.minX < bandTexels) cropMinX = 0;
          if (sides.top && nb.minY < bandTexels) cropMinY = 0;
          if (sides.right && nb.maxX >= pxW - bandTexels) cropMaxX = pxW;
          if (sides.bottom && nb.maxY >= pxH - bandTexels) cropMaxY = pxH;

          const cropW = cropMaxX - cropMinX;
          const cropH = cropMaxY - cropMinY;
          if (cropW <= 0 || cropH <= 0) continue;

          tileSeqByLevel[grp.level]++;
          const lvlShort = grp.level === 0 ? 'b' : grp.level === 1 ? 'm' : 'f';
          const png = await rgbaRectToPng(readback.rgba, pxW, cropMinX, cropMinY, cropW, cropH);

          tiles.push({
            tileFileName: `${stemSafe}_${lvlShort}${tileSeqByLevel[grp.level]}.png`,
            level: grp.level,
            insertOrderKey: grp.insertOrderKey,
            worldX: tLeft + cropMinX / supersample,
            worldY: tTop + cropMinY / supersample,
            pngWidth: cropW,
            pngHeight: cropH,
            scaleX: invScale,
            scaleY: invScale,
            floatPrecision: readback.floatPrecision,
            png,
          });
        }
      }

      completedGroups++;
    }
  } finally {
    glRenderer.destroy(true);
  }

  return tiles;
}

export type BakedTile = BakedSceneryTileUpload & { png: Uint8Array<ArrayBuffer> };

/**
 * Builds the `_o` map in memory exactly as the server will write it (plan.layout order), with tile
 * scenery names produced by `sceneryNameFor` (virtual preview names or the real file names).
 */
export function composeOptimizedMap(
  sourceMap: PmsMapData,
  plan: MapOptimizePlanResponse,
  tiles: BakedSceneryTileUpload[],
  sceneryNameFor: (tile: BakedSceneryTileUpload) => string
): PmsMapData {
  const mapData = applyPlanPropFixes(sourceMap, plan);
  const scenery = mapData.scenery.map((s) => ({ ...s }));
  const props: PmsMapData['props'] = [];
  const groupsById = new Map(plan.groups.map((g) => [g.groupId, g]));

  for (const entry of plan.layout) {
    if (entry.propIndex !== undefined) {
      const p = mapData.props[entry.propIndex];
      if (p) props.push({ ...p, index: props.length });
      continue;
    }
    const grp = entry.groupId ? groupsById.get(entry.groupId) : undefined;
    if (!grp) continue;
    for (const t of tiles) {
      if (t.level !== grp.level || t.insertOrderKey !== grp.insertOrderKey) continue;
      scenery.push({ index: scenery.length + 1, filename: sceneryNameFor(t), date: 0, usedCount: 1 });
      props.push({
        index: props.length,
        active: true,
        style: scenery.length,
        width: t.pngWidth,
        height: t.pngHeight,
        x: t.worldX,
        y: t.worldY,
        rotation: 0,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        alpha: 255,
        color: { r: 255, g: 255, b: 255, a: 255 },
        level: t.level,
      });
    }
  }
  return { ...mapData, props, scenery };
}

export interface FidelityReport {
  meanAbsDiff: number;     // average per-pixel max channel difference (0..255)
  pctPixelsOver8: number;  // share of pixels differing by more than 8 levels
  maxDiff: number;
  sampledMegapixels: number;
  worstArea: { left: number; top: number; width: number; height: number; meanAbsDiff: number } | null;
}

// In-game scale on a 1080p screen (480 world units tall -> 1080 px)
const FIDELITY_ZOOM = 2.25;
const FIDELITY_WINDOW_PX = 1024;
const FIDELITY_MAX_WINDOWS = 24;

/**
 * Renders original and candidate maps with all layers at in-game 1080p scale over the merged areas and
 * compares them pixel by pixel. Large maps are sampled with evenly spread windows.
 */
export async function measureFidelity(
  original: PmsMapData,
  candidate: PmsMapData,
  plan: MapOptimizePlanResponse,
  preferClassicBmp: boolean,
  signal?: AbortSignal
): Promise<FidelityReport | null> {
  const span = FIDELITY_WINDOW_PX / FIDELITY_ZOOM;
  const windows: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (const g of plan.groups) {
    const wb = g.worldBounds;
    for (let y = wb.top; y < wb.bottom; y += span) {
      for (let x = wb.left; x < wb.right; x += span) {
        windows.push({ left: x, top: y, width: Math.min(span, wb.right - x), height: Math.min(span, wb.bottom - y) });
      }
    }
  }
  if (windows.length === 0) return null;
  const step = Math.max(1, windows.length / FIDELITY_MAX_WINDOWS);
  const sampled = windows.filter((_, i) => Math.floor(i % step) === 0).slice(0, FIDELITY_MAX_WINDOWS);

  const layers: RenderLayerVisibility = {
    showBackground: true,
    showPolygons: true,
    showSmoothEdges: true,
    showSceneryBack: true,
    showSceneryMid: true,
    showSceneryFront: true,
    frontSceneryOpacity: 1,
    preferClassicBmp,
    pixelatedFilter: false,
    showFlags: false,
    showSpawns: false,
    showBonuses: false,
    showColliders: false,
    showPolyTypes: false,
    showWireframe: false,
    showWaypoints: false,
    showGrid: false,
  };

  const makeRenderer = () => {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return new SoldatWebGLRenderer(c, { transparentCanvas: true });
  };
  const rOrig = makeRenderer();
  const rCand = makeRenderer();
  try {
    if (!(await rOrig.loadMap(original, { preferClassicBmp })) || !(await rCand.loadMap(candidate, { preferClassicBmp }))) {
      return null;
    }
    let sum = 0;
    let over8 = 0;
    let maxDiff = 0;
    let pixels = 0;
    let worst: FidelityReport['worstArea'] = null;

    for (const w of sampled) {
      if (signal?.aborted) throw new DOMException('Anulowano.', 'AbortError');
      const pxW = Math.max(1, Math.round(w.width * FIDELITY_ZOOM));
      const pxH = Math.max(1, Math.round(w.height * FIDELITY_ZOOM));
      const bounds = { left: w.left, right: w.left + w.width, top: w.top, bottom: w.top + w.height };
      const a = rOrig.renderOffscreenUnpremultiplied(bounds, layers, pxW, pxH).rgba;
      const b = rCand.renderOffscreenUnpremultiplied(bounds, layers, pxW, pxH).rgba;
      let wSum = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        wSum += d;
        if (d > 8) over8++;
        if (d > maxDiff) maxDiff = d;
      }
      const n = a.length / 4;
      sum += wSum;
      pixels += n;
      const wMean = wSum / n;
      if (!worst || wMean > worst.meanAbsDiff) worst = { ...w, meanAbsDiff: Math.round(wMean * 100) / 100 };
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive between windows
    }

    return {
      meanAbsDiff: Math.round((sum / Math.max(1, pixels)) * 100) / 100,
      pctPixelsOver8: Math.round((1000 * over8) / Math.max(1, pixels)) / 10,
      maxDiff,
      sampledMegapixels: Math.round(pixels / 1e4) / 100,
      worstArea: worst,
    };
  } finally {
    rOrig.destroy(true);
    rCand.destroy(true);
  }
}

export interface OptimizePreview {
  plan: MapOptimizePlanResponse;
  tiles: BakedTile[];
  previewMap: PmsMapData;
  fidelity: FidelityReport | null;
  optionsKey: string; // JSON of the options the preview was baked with (stale detection)
}

let activePreviewPrefix: string | null = null;

export function optimizeOptionsKey(mapId: string, options: OptimizeMapOptions): string {
  const { destination: _d, customOutputFolder: _c, ...renderRelevant } = options;
  return JSON.stringify({ mapId, ...renderRelevant });
}

/**
 * Bakes the layers in memory and returns the resulting map (served through virtual assets) plus a
 * fidelity report — nothing is written to disk. The previous preview's in-memory tiles are released.
 */
export async function buildOptimizePreview(
  mapId: string,
  mapData: PmsMapData,
  options: OptimizeMapOptions,
  onProgress?: (progress0to1: number, statusText: string) => void,
  signal?: AbortSignal
): Promise<OptimizePreview> {
  onProgress?.(0.05, 'Analizowanie warstw i kolejności rysowania scenerii...');
  const plan = await fetchOptimizePlan(mapId, options, signal);
  const tiles = await bakeSceneryTiles(mapData, plan, options, onProgress, signal);

  if (activePreviewPrefix) clearVirtualAssets(activePreviewPrefix);
  const prefix = `__preview_${Date.now().toString(36)}__`;
  activePreviewPrefix = prefix;
  for (const t of tiles) registerVirtualAsset('scenery-gfx', `${prefix}${t.tileFileName}`, t.png);
  const previewMap = composeOptimizedMap(mapData, plan, tiles, (t) => `${prefix}${t.tileFileName}`);

  onProgress?.(0.9, 'Porównywanie wyniku z oryginałem (skala ekranu 1080p)...');
  // With fixFirst the reference is the repaired map: the size fixes are intended, not a baking error
  const fidelity = await measureFidelity(
    applyPlanPropFixes(mapData, plan),
    previewMap,
    plan,
    options.preferClassicBmp,
    signal
  );
  onProgress?.(1, 'Podgląd gotowy.');
  return { plan, tiles, previewMap, fidelity, optionsKey: optimizeOptionsKey(mapId, options) };
}

/**
 * Bakes static scenery layers on the GPU and writes `<map>_o.pms` + PNG tiles through a server session
 * (each tile is uploaded as its own binary request, so huge maps never hit a request size limit).
 * Pass `prebaked` (from a preview made with identical options) to skip baking again.
 */
export async function executeSceneryOptimization(
  mapId: string,
  mapData: PmsMapData,
  options: OptimizeMapOptions,
  overwrite: boolean,
  onProgress?: (progress0to1: number, statusText: string) => void,
  signal?: AbortSignal,
  prebaked?: { plan: MapOptimizePlanResponse; tiles: BakedTile[] },
  // Batch runs replace only their own previous outputs and rescan once at the end
  commit?: { overwritePolicy?: OverwritePolicy; skipRescan?: boolean }
): Promise<{ result: OptimizeSaveResponse; meta: IndexMetaResponse }> {
  if (signal?.aborted) {
    throw new DOMException('Anulowano optymalizację.', 'AbortError');
  }

  let plan: MapOptimizePlanResponse;
  let tiles: BakedTile[];
  if (prebaked) {
    ({ plan, tiles } = prebaked);
  } else {
    onProgress?.(0.05, 'Analizowanie warstw i kolejności rysowania scenerii...');
    plan = await fetchOptimizePlan(mapId, options, signal);
    tiles = await bakeSceneryTiles(mapData, plan, options, onProgress, signal);
  }

  const { sessionId } = await postJson<{ sessionId: string }>(
    '/api/workshop/optimize-session',
    { mapId, options },
    signal
  );

  try {
    for (let i = 0; i < tiles.length; i++) {
      if (signal?.aborted) throw new DOMException('Anulowano optymalizację.', 'AbortError');
      const { png, ...meta } = tiles[i];
      onProgress?.(
        0.84 + 0.1 * (i / Math.max(1, tiles.length)),
        `Wysyłanie warstwy ${i + 1} / ${tiles.length} (${meta.tileFileName})...`
      );
      const q = new URLSearchParams({ meta: JSON.stringify(meta) });
      const res = await fetch(
        `/api/workshop/optimize-session/${encodeURIComponent(sessionId)}/tile?${q.toString()}`,
        { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png, signal }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Błąd wysyłania warstwy ${meta.tileFileName}.`);
      }
    }

    onProgress?.(0.95, `Zapisywanie ${plan.derivedBaseName}.pms oraz ${tiles.length} warstw PNG...`);
    const saveData = await postJson<{ result: OptimizeSaveResponse; meta: IndexMetaResponse }>(
      `/api/workshop/optimize-session/${encodeURIComponent(sessionId)}/commit`,
      { overwrite, overwritePolicy: commit?.overwritePolicy, skipRescan: commit?.skipRescan },
      signal
    );

    if (options.destination === 'soldat_maps') {
      clearSoldatAssetCache();
    }
    onProgress?.(1.0, 'Zakończono optymalizację scenerii!');
    return saveData;
  } catch (err) {
    fetch(`/api/workshop/optimize-session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(
      () => {}
    );
    throw err;
  }
}
