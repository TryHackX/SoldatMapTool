import { PmsMapData } from '@shared/pmsParser';
import { loadSoldatObjectSprites } from './assetLoader';
import { renderMapOverlays } from './OverlayRenderer';
import { SoldatWebGLRenderer } from './SoldatWebGLRenderer';
import { DEFAULT_RENDER_LAYERS, FullSizeExportSettings } from './types';

export interface ExportResultInfo {
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  outputPath?: string;
  downloadUrl?: string;
  skipped?: boolean;
}

export interface ExportMapContext {
  prefix?: string;
  modeGroupName?: string;
  signal?: AbortSignal;
}

const SINGLE_PASS_LIMIT = 4096;
const TILE_SIZE = 2048;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Nie udało się zakodować obrazu z Canvas.'));
        else resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function hasAnyOverlayEnabled(layers: FullSizeExportSettings['layers']): boolean {
  return (
    layers.showFlags ||
    layers.showSpawns ||
    layers.showBonuses ||
    layers.showColliders ||
    layers.showPolyTypes ||
    layers.showWireframe ||
    layers.showWaypoints ||
    layers.showGrid
  );
}

export function resolveScreenshotSubfolder(
  settings: FullSizeExportSettings,
  ctx?: ExportMapContext
): string | undefined {
  if (settings.subfolderMode === 'prefix' && ctx?.prefix) {
    const clean = ctx.prefix === '__none__' ? 'bez_prefixu' : ctx.prefix.replace(/_+$/, '');
    return clean || 'inne';
  }
  if (settings.subfolderMode === 'mode' && ctx?.modeGroupName) {
    return ctx.modeGroupName.replace(/[<>:"/\\|?*]+/g, '').trim() || 'inne';
  }
  return undefined;
}

export function buildScreenshotFileName(mapBaseName: string, settings: FullSizeExportSettings): string {
  const scaleTag = `${Math.round(settings.scale * 100)}pct`;
  const ext = settings.format === 'jpeg' ? 'jpg' : settings.format;
  return `${mapBaseName}_${scaleTag}.${ext}`;
}

export async function checkScreenshotAlreadyExists(
  fileName: string,
  subfolder?: string,
  customFolder?: string
): Promise<{ exists: boolean; outputPath?: string }> {
  try {
    const resp = await fetch('/api/screenshots/check-exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, subfolder, customFolder }),
    });
    if (!resp.ok) return { exists: false };
    return await resp.json();
  } catch {
    return { exists: false };
  }
}

/**
 * Generates a 100% (or custom-scaled) Full-Size Screenshot of an entire Soldat map.
 * Automatically uses single-pass WebGL2 rendering for standard maps and seamless
 * tiled GPU + server Sharp stitching for massive maps (e.g. 12000x8000 px).
 */
export async function generateFullSizeScreenshot(
  map: PmsMapData,
  mapBaseName: string,
  settings: FullSizeExportSettings,
  onProgress?: (progress0to1: number, statusText: string) => void,
  context?: ExportMapContext
): Promise<ExportResultInfo> {
  if (context?.signal?.aborted) {
    throw new DOMException('Anulowano eksport.', 'AbortError');
  }

  const srcBounds = settings.boundsMode === 'full' ? map.fullBounds : map.polyBounds;
  const pad = Math.max(0, settings.paddingPx);

  const worldLeft = Math.floor(srcBounds.left - pad);
  const worldRight = Math.ceil(srcBounds.right + pad);
  const worldTop = Math.floor(srcBounds.top - pad);
  const worldBottom = Math.ceil(srcBounds.bottom + pad);

  const worldWidth = Math.max(16, worldRight - worldLeft);
  const worldHeight = Math.max(16, worldBottom - worldTop);

  const outWidth = Math.max(16, Math.round(worldWidth * settings.scale));
  const outHeight = Math.max(16, Math.round(worldHeight * settings.scale));

  const fileName = buildScreenshotFileName(mapBaseName, settings);
  const subfolder = resolveScreenshotSubfolder(settings, context);
  const customFolder = settings.customFolder?.trim() || undefined;

  if (settings.skipExisting && settings.saveToServerExports) {
    const existing = await checkScreenshotAlreadyExists(fileName, subfolder, customFolder);
    if (existing.exists) {
      onProgress?.(1.0, `Pominięto (już istnieje): ${fileName}`);
      return {
        fileName,
        width: outWidth,
        height: outHeight,
        sizeBytes: 0,
        outputPath: existing.outputPath,
        skipped: true,
      };
    }
  }

  onProgress?.(0.05, `Ładowanie tekstur i scenerii mapy ${mapBaseName}...`);

  const glCanvas = document.createElement('canvas');
  const glRenderer = new SoldatWebGLRenderer(glCanvas);
  const sprites = hasAnyOverlayEnabled(settings.layers) ? await loadSoldatObjectSprites() : null;

  let tileSessionId: string | null = null;
  try {
    const loaded = await glRenderer.loadMap(map, { preferClassicBmp: settings.layers.preferClassicBmp });
    if (!loaded) {
      throw new Error('Nie udało się załadować mapy na GPU (utracony kontekst WebGL2).');
    }

    if (context?.signal?.aborted) {
      throw new DOMException('Anulowano eksport.', 'AbortError');
    }

    // Case A: Single-pass GPU export (up to 4096 x 4096)
    if (outWidth <= SINGLE_PASS_LIMIT && outHeight <= SINGLE_PASS_LIMIT) {
      onProgress?.(0.45, `Renderowanie pełnego widoku (${outWidth} × ${outHeight} px)...`);

      glCanvas.width = outWidth;
      glCanvas.height = outHeight;
      glRenderer.render(
        { left: worldLeft, right: worldRight, top: worldTop, bottom: worldBottom },
        settings.layers
      );
      if (glRenderer.isContextLost()) {
        throw new Error('Utracono kontekst WebGL2 podczas renderowania — screen nie został zapisany.');
      }

      let finalCanvas = glCanvas;
      if (hasAnyOverlayEnabled(settings.layers) || settings.includeWatermark) {
        const compCanvas = document.createElement('canvas');
        compCanvas.width = outWidth;
        compCanvas.height = outHeight;
        const ctx = compCanvas.getContext('2d')!;
        ctx.drawImage(glCanvas, 0, 0);

        if (hasAnyOverlayEnabled(settings.layers)) {
          const ovCanvas = document.createElement('canvas');
          ovCanvas.width = outWidth;
          ovCanvas.height = outHeight;
          const ovCtx = ovCanvas.getContext('2d')!;
          renderMapOverlays(ovCtx, outWidth, outHeight, map, {
            bounds: { left: worldLeft, right: worldRight, top: worldTop, bottom: worldBottom },
            layers: settings.layers,
            sprites,
            fixedWorldScale: true,
          });
          ctx.drawImage(ovCanvas, 0, 0);
        }

        if (settings.includeWatermark) {
          drawMapWatermark(ctx, outWidth, outHeight, mapBaseName, map.mapName, outWidth, outHeight);
        }
        finalCanvas = compCanvas;
      }

      onProgress?.(0.8, 'Kodowanie pliku graficznego...');
      const mime =
        settings.format === 'jpeg'
          ? 'image/jpeg'
          : settings.format === 'webp'
          ? 'image/webp'
          : 'image/png';
      const blob = await canvasToBlob(finalCanvas, mime, settings.quality / 100);

      let outputPath: string | undefined;
      let downloadUrl: string | undefined;

      if (settings.saveToServerExports) {
        const q = new URLSearchParams({ fileName });
        if (subfolder) q.set('subfolder', subfolder);
        if (customFolder) q.set('customFolder', customFolder);

        const resp = await fetch(`/api/screenshots/save-direct?${q.toString()}`, {
          method: 'POST',
          headers: { 'Content-Type': mime },
          body: blob,
          signal: context?.signal,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(data.error || `Nie udało się zapisać screena na dysku (HTTP ${resp.status}).`);
        }
        outputPath = data.outputPath;
        downloadUrl = data.downloadUrl;
      }

      if (settings.triggerBrowserDownload) {
        triggerBlobDownload(blob, fileName);
      }

      onProgress?.(1.0, 'Gotowe!');
      return {
        fileName,
        width: outWidth,
        height: outHeight,
        sizeBytes: blob.size,
        outputPath,
        downloadUrl,
      };
    }

    // Case B: Huge Map (> 4096px) -> Seamless Tiled GPU Rendering + Server Sharp Stitcher!
    const cols = Math.ceil(outWidth / TILE_SIZE);
    const rows = Math.ceil(outHeight / TILE_SIZE);
    const totalTiles = cols * rows;

    onProgress?.(
      0.1,
      `Inicjalizacja kafelkowego renderowania dużej mapy (${outWidth} × ${outHeight} px, ${totalTiles} kafelków)...`
    );

    const startRes = await fetch('/api/screenshots/tile-session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapName: mapBaseName,
        width: outWidth,
        height: outHeight,
        format: settings.format,
        quality: settings.quality,
        subfolder,
        customFolder,
      }),
      signal: context?.signal,
    });
    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      throw new Error(startData.error || 'Błąd inicjalizacji sesji kafelkowej na serwerze.');
    }
    const sessionId: string = startData.sessionId;
    tileSessionId = sessionId;

    const compCanvas = document.createElement('canvas');
    const ovCanvas = document.createElement('canvas');
    let tileIdx = 0;

    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        if (context?.signal?.aborted) {
          throw new DOMException('Anulowano eksport.', 'AbortError');
        }

        const pxLeft = cx * TILE_SIZE;
        const pxTop = ry * TILE_SIZE;
        const tileW = Math.min(TILE_SIZE, outWidth - pxLeft);
        const tileH = Math.min(TILE_SIZE, outHeight - pxTop);

        const tileWorldLeft = worldLeft + (pxLeft / outWidth) * worldWidth;
        const tileWorldRight = worldLeft + ((pxLeft + tileW) / outWidth) * worldWidth;
        const tileWorldTop = worldTop + (pxTop / outHeight) * worldHeight;
        const tileWorldBottom = worldTop + ((pxTop + tileH) / outHeight) * worldHeight;

        glCanvas.width = tileW;
        glCanvas.height = tileH;
        glRenderer.render(
          {
            left: tileWorldLeft,
            right: tileWorldRight,
            top: tileWorldTop,
            bottom: tileWorldBottom,
          },
          settings.layers
        );
        if (glRenderer.isContextLost()) {
          throw new Error('Utracono kontekst WebGL2 podczas renderowania kafelka — screen nie został zapisany.');
        }

        let tileTargetCanvas = glCanvas;
        const isBottomRightTile = ry === rows - 1 && cx === cols - 1;

        if (hasAnyOverlayEnabled(settings.layers) || (settings.includeWatermark && isBottomRightTile)) {
          compCanvas.width = tileW;
          compCanvas.height = tileH;
          const ctx = compCanvas.getContext('2d')!;
          ctx.drawImage(glCanvas, 0, 0);

          if (hasAnyOverlayEnabled(settings.layers)) {
            ovCanvas.width = tileW;
            ovCanvas.height = tileH;
            const ovCtx = ovCanvas.getContext('2d')!;
            renderMapOverlays(ovCtx, tileW, tileH, map, {
              bounds: {
                left: tileWorldLeft,
                right: tileWorldRight,
                top: tileWorldTop,
                bottom: tileWorldBottom,
              },
              layers: settings.layers,
              sprites,
              fixedWorldScale: true,
            });
            ctx.drawImage(ovCanvas, 0, 0);
          }

          if (settings.includeWatermark && isBottomRightTile && tileW >= 260 && tileH >= 60) {
            drawMapWatermark(ctx, tileW, tileH, mapBaseName, map.mapName, outWidth, outHeight);
          }

          tileTargetCanvas = compCanvas;
        }

        const tileBlob = await canvasToBlob(tileTargetCanvas, 'image/png');
        const tileRes = await fetch(
          `/api/screenshots/tile-session/${encodeURIComponent(sessionId)}/tile?left=${pxLeft}&top=${pxTop}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'image/png' },
            body: tileBlob,
            signal: context?.signal,
          }
        );
        if (!tileRes.ok) {
          throw new Error(`Błąd zapisu kafelka (${cx}, ${ry}).`);
        }

        tileIdx++;
        onProgress?.(
          0.12 + 0.76 * (tileIdx / totalTiles),
          `Renderowanie kafelka ${tileIdx} / ${totalTiles} (${outWidth} × ${outHeight} px)...`
        );
      }
    }

    onProgress?.(0.92, 'Składanie pełnowymiarowego obrazu na dysku (Sharp)...');
    const finRes = await fetch(
      `/api/screenshots/tile-session/${encodeURIComponent(sessionId)}/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, subfolder, customFolder }),
        signal: context?.signal,
      }
    );
    tileSessionId = null; // finalize always consumes the session on the server
    if (!finRes.ok) {
      const errJson = await finRes.json().catch(() => ({}));
      throw new Error(errJson.error || 'Błąd składania finalnego obrazu 100%.');
    }
    const finData = await finRes.json();

    if (settings.triggerBrowserDownload && finData.downloadUrl) {
      const a = document.createElement('a');
      a.href = finData.downloadUrl;
      a.download = finData.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    onProgress?.(1.0, 'Gotowe!');
    return {
      fileName: finData.fileName,
      width: outWidth,
      height: outHeight,
      sizeBytes: finData.sizeBytes,
      outputPath: finData.outputPath,
      downloadUrl: finData.downloadUrl,
    };
  } finally {
    glRenderer.destroy(true);
    if (tileSessionId) {
      // Aborted or failed tiled export: drop the temporary tiles on the server right away
      fetch(`/api/screenshots/tile-session/${encodeURIComponent(tileSessionId)}`, { method: 'DELETE' }).catch(
        () => {}
      );
    }
  }
}

/**
 * Generates and caches a crisp 320x192 WebP thumbnail for the map browser grid!
 * Returns the persistent server thumbnail URL so no Blob URLs leak in memory across 50,000 maps.
 */
let sharedThumbRenderer: SoldatWebGLRenderer | null = null;

export async function generateAndCacheThumbnail(
  map: PmsMapData,
  crc32: number
): Promise<string | null> {
  try {
    if (!sharedThumbRenderer || sharedThumbRenderer.isContextLost()) {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 192;
      sharedThumbRenderer = new SoldatWebGLRenderer(c);
    }
    const canvas = sharedThumbRenderer.getCanvas();
    canvas.width = 320;
    canvas.height = 192;

    if (!(await sharedThumbRenderer.loadMap(map))) return null;

    const pb = map.polyBounds;
    const padX = Math.max(32, pb.width * 0.04);
    const padY = Math.max(32, pb.height * 0.04);
    let left = pb.left - padX;
    let right = pb.right + padX;
    let top = pb.top - padY;
    let bottom = pb.bottom + padY;

    // Fit aspect ratio 320:192
    const targetAspect = 320 / 192;
    const curW = Math.max(16, right - left);
    const curH = Math.max(16, bottom - top);
    const curAspect = curW / curH;
    if (curAspect > targetAspect) {
      const newH = curW / targetAspect;
      const diff = (newH - curH) * 0.5;
      top -= diff;
      bottom += diff;
    } else {
      const newW = curH * targetAspect;
      const diff = (newW - curW) * 0.5;
      left -= diff;
      right += diff;
    }

    sharedThumbRenderer.render({ left, right, top, bottom }, DEFAULT_RENDER_LAYERS);

    const blob = await canvasToBlob(canvas, 'image/webp', 0.82);
    const hexCrc = (crc32 >>> 0).toString(16);
    const saveRes = await fetch(`/api/thumbnails/${hexCrc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: blob,
    });
    if (saveRes.ok) {
      return `/api/thumbnails/${hexCrc}`;
    }
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function drawMapWatermark(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  mapBaseName: string,
  mapTitle: string,
  fullW: number,
  fullH: number
): void {
  ctx.save();
  const titlePart = mapTitle && mapTitle.toLowerCase() !== mapBaseName.toLowerCase()
    ? `${mapBaseName}  •  ${mapTitle}`
    : mapBaseName;
  const text = `${titlePart}  (${fullW} × ${fullH} px)`;
  ctx.font = '600 13px "Inter", sans-serif';
  const tw = ctx.measureText(text).width + 24;
  const th = 28;
  const x = canvasW - tw - 16;
  const y = canvasH - th - 16;

  ctx.fillStyle = 'rgba(9, 9, 11, 0.78)';
  ctx.beginPath();
  ctx.roundRect(x, y, tw, th, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#f4f4f5';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 12, y + th / 2 + 0.5);
  ctx.restore();
}
