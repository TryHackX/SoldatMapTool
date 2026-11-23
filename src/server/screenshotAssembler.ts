import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { t } from './i18n';
import { WorkshopError, writeFileAtomic } from './safeFileWriter';

interface TileSession {
  id: string;
  mapName: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  tempDir: string;
  tiles: Array<{ input: string; left: number; top: number }>;
  lastActivity: number;
  finalizing: boolean;
}

const sessions = new Map<string, TileSession>();

// Sessions abandoned by the browser (closed tab, aborted batch) are discarded after this long
const TILE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_OUTPUT_DIM = 65000; // PNG / libvips practical limit per side

export function sanitizeScreenshotSubfolder(rawSubfolder?: string): string {
  if (!rawSubfolder) return '';
  return rawSubfolder
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/^[/\\]+|[/\\]+$/g, '')
    .trim();
}

/**
 * Removes temp folders of sessions from a previous server run (they can never be finalized anymore).
 */
export function cleanupOrphanedTileSessions(cacheRoot: string): void {
  try {
    fs.rmSync(path.join(cacheRoot, 'tile-sessions'), { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (!s.finalizing && now - s.lastActivity > TILE_SESSION_TTL_MS) cancelTileSession(s.id);
  }
}

export function createTileSession(params: {
  mapName: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  quality?: number;
  cacheRoot: string;
}): string {
  pruneExpiredSessions();
  const width = Math.round(Number(params.width));
  const height = Math.round(Number(params.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(t('Invalid image dimensions.'));
  }
  if (width > MAX_OUTPUT_DIM || height > MAX_OUTPUT_DIM) {
    throw new Error(
      t('The {width}×{height} px image exceeds the limit of {limit} px per side — reduce the scale.', {
        width,
        height,
        limit: MAX_OUTPUT_DIM,
      })
    );
  }
  const format = params.format === 'jpeg' || params.format === 'webp' ? params.format : 'png';

  const id = crypto.randomUUID();
  const tempDir = path.join(params.cacheRoot, 'tile-sessions', id);
  fs.mkdirSync(tempDir, { recursive: true });

  sessions.set(id, {
    id,
    mapName: params.mapName,
    width,
    height,
    format,
    quality: Math.max(1, Math.min(100, Math.round(params.quality ?? 92))),
    tempDir,
    tiles: [],
    lastActivity: Date.now(),
    finalizing: false,
  });

  return id;
}

function getOpenSession(id: string): TileSession {
  const session = sessions.get(id);
  if (!session || session.finalizing) {
    throw new WorkshopError(t('Tiled render session not found: {id}', {id}), session ? 409 : 404);
  }
  return session;
}

export function addSessionTile(
  sessionId: string,
  left: number,
  top: number,
  pngBuffer: Buffer
): void {
  const session = getOpenSession(sessionId);
  const x = Math.round(left);
  const y = Math.round(top);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= session.width || y >= session.height) {
    throw new Error(t('Invalid tile position.'));
  }
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
    throw new Error(t('Empty tile.'));
  }
  const tilePath = path.join(session.tempDir, `tile_${x}_${y}.png`);
  writeFileAtomic(tilePath, pngBuffer);
  session.lastActivity = Date.now();
  // A re-sent tile replaces the previous one instead of being composited twice
  session.tiles = session.tiles.filter((tile) => tile.left !== x || tile.top !== y);
  session.tiles.push({ input: tilePath, left: x, top: y });
}

export function cancelTileSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  // Sharp may still have the tiles open on Windows. Its finalizer owns their cleanup.
  if (!session.finalizing) removeTiles(session);
}

function removeTiles(session: TileSession): void {
  try { fs.rmSync(session.tempDir, {recursive:true, force:true}); }
  catch { /* The next startup removes abandoned tile directories. */ }
}

export async function finalizeTileSession(
  sessionId: string,
  outputDir: string,
  customFileName?: string,
  subfolder?: string
): Promise<{ outputPath: string; fileName: string; sizeBytes: number }> {
  const session = getOpenSession(sessionId);
  session.finalizing = true;
  let staged: string | undefined;
  try {
    if (!session.tiles.length) throw new WorkshopError(t('Empty tile.'), 400);
    const cleanSub = sanitizeScreenshotSubfolder(subfolder);
    const finalDir = cleanSub ? path.join(outputDir, cleanSub) : outputDir;
    fs.mkdirSync(finalDir, { recursive: true });

    const ext = session.format === 'jpeg' ? 'jpg' : session.format;
    const base = (customFileName || `${session.mapName}_100pct`).replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      '_'
    );
    const fileName = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
    const outputPath = path.join(finalDir, fileName);

    let pipeline = sharp({
      create: {
        width: session.width,
        height: session.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
      limitInputPixels: false,
      sequentialRead: true,
    }).composite(
      session.tiles.map((t) => ({
        input: t.input,
        left: t.left,
        top: t.top,
      }))
    );

    if (session.format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: session.quality, mozjpeg: true });
    } else if (session.format === 'webp') {
      pipeline = pipeline.webp({ quality: session.quality });
    } else {
      pipeline = pipeline.png({ compressionLevel: 6 });
    }

    staged = path.join(finalDir, '.screenshot-' + crypto.randomUUID() + '.tmp');
    const encoded = await pipeline.toFile(staged);
    // No asynchronous work between checking cancellation and publishing the completed image.
    if (!sessions.has(sessionId)) throw new WorkshopError(t('Tiled render session not found: {id}', {id:sessionId}), 404);
    fs.renameSync(staged, outputPath);
    staged = undefined;

    return {
      outputPath,
      fileName,
      sizeBytes: encoded.size,
    };
  } finally {
    sessions.delete(sessionId);
    try {
      if (staged) fs.rmSync(staged, {force:true});
    } finally {
      removeTiles(session);
    }
  }
}
