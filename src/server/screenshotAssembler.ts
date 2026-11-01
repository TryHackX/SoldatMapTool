import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

interface TileSession {
  id: string;
  mapName: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  tempDir: string;
  tiles: Array<{ input: string; left: number; top: number }>;
  createdAt: number;
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
    if (now - s.createdAt > TILE_SESSION_TTL_MS) cancelTileSession(s.id);
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
    throw new Error('Nieprawidłowe wymiary obrazu.');
  }
  if (width > MAX_OUTPUT_DIM || height > MAX_OUTPUT_DIM) {
    throw new Error(`Obraz ${width}×${height} px przekracza limit ${MAX_OUTPUT_DIM} px na bok — zmniejsz skalę.`);
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
    createdAt: Date.now(),
  });

  return id;
}

export function addSessionTile(
  sessionId: string,
  left: number,
  top: number,
  pngBuffer: Buffer
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Nie znaleziono sesji renderowania kafelkowego: ${sessionId}`);
  }
  const l = Math.round(left);
  const t = Math.round(top);
  if (!Number.isFinite(l) || !Number.isFinite(t) || l < 0 || t < 0 || l >= session.width || t >= session.height) {
    throw new Error('Nieprawidłowa pozycja kafelka.');
  }
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
    throw new Error('Pusty kafelek.');
  }
  const tilePath = path.join(session.tempDir, `tile_${l}_${t}.png`);
  fs.writeFileSync(tilePath, pngBuffer);
  // A re-sent tile replaces the previous one instead of being composited twice
  session.tiles = session.tiles.filter((x) => x.left !== l || x.top !== t);
  session.tiles.push({ input: tilePath, left: l, top: t });
}

export function cancelTileSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    fs.rmSync(session.tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}

export async function finalizeTileSession(
  sessionId: string,
  outputDir: string,
  customFileName?: string,
  subfolder?: string
): Promise<{ outputPath: string; fileName: string; sizeBytes: number }> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Nie znaleziono sesji renderowania kafelkowego: ${sessionId}`);
  }

  try {
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

    await pipeline.toFile(outputPath);
    const stat = fs.statSync(outputPath);

    return {
      outputPath,
      fileName,
      sizeBytes: stat.size,
    };
  } finally {
    cancelTileSession(sessionId);
  }
}
