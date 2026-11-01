import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import AdmZip from 'adm-zip';
import { extractZipSafely, isZipSymlink, ZIP_LIMITS, zipEntryProblem, ZipSafetyError } from './zipSafety';
import sharp from 'sharp';
import { SoldatMapScanner } from './soldatScanner';
import { AssetCategory } from './assetResolver';
import { decodeBmpToRgba } from './bmpDecoder';
import { isBufferBmpMagic, OverwritePolicy, SoldatMapWorkshop, WorkshopError } from './mapFixerOptimizer';
import { buildPackPreview, executePackBuild } from './packBuilder';
import {
  addSessionTile,
  cancelTileSession,
  cleanupOrphanedTileSessions,
  createTileSession,
  finalizeTileSession,
  sanitizeScreenshotSubfolder,
} from './screenshotAssembler';
import {
  ExtraMapSource,
  FixMapRequest,
  IndexMetaResponse,
  MapQueryRequest,
  MapUserDataPatch,
  MapUserDataResponse,
  OptimizeMapOptions,
  PackBuildOptions,
} from '../shared/apiTypes';
import { CustomPrefixRule, sanitizeCustomRules } from '../shared/prefixUtils';
import { makeDerivedMapName, parsePmsSummary } from '../shared/pmsParser';
import { APP_VERSION } from '../shared/version';
import { installFileLogger } from './logger';
import { UserDataStore } from './userDataStore';
import { PackPresetStore } from './packPresets';
import {
  computeUnusedScenery,
  LibraryError,
  listDuplicateGroups,
  moveDuplicateMaps,
  moveUnusedScenery,
  runLibraryOperation,
} from './libraryTools';

const PORT = Number(process.env.PORT || 4321);
const WORKSPACE_ROOT = process.cwd();
const DATA_DIR = path.join(WORKSPACE_ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const THUMB_DIR = path.join(CACHE_DIR, 'thumbnails');
const EXPORTS_PACKS_DIR = path.join(WORKSPACE_ROOT, 'exports', 'packs');
const EXPORTS_SCREENS_DIR = path.join(WORKSPACE_ROOT, 'exports', 'screenshots');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_SOLDAT_PATH = 'G:\\Steam\\steamapps\\common\\Soldat';

installFileLogger(path.join(DATA_DIR, 'logs'));

fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_PACKS_DIR, { recursive: true });
fs.mkdirSync(EXPORTS_SCREENS_DIR, { recursive: true });

interface AppConfig {
  soldatPath: string;
  extraSources: ExtraMapSource[];
  customRules: CustomPrefixRule[];
}

function loadConfig(): AppConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      let extraSources: ExtraMapSource[] = [];

      if (Array.isArray(parsed.extraSources)) {
        extraSources = parsed.extraSources;
      } else if (Array.isArray(parsed.extraMapDirs)) {
        // Migrate v1 extraMapDirs -> v2 ExtraMapSource[]
        extraSources = parsed.extraMapDirs
          .map((d: unknown, idx: number) => {
            const p = String(d || '').trim();
            if (!p) return null;
            return {
              id: `extra_${idx}`,
              path: p,
              label: path.basename(p) || `Archiwum #${idx + 1}`,
              recursive: true,
              enabled: true,
            };
          })
          .filter((x: ExtraMapSource | null): x is ExtraMapSource => Boolean(x));
      }

      return {
        soldatPath: typeof parsed.soldatPath === 'string' && parsed.soldatPath.trim()
          ? parsed.soldatPath.trim()
          : DEFAULT_SOLDAT_PATH,
        extraSources,
        customRules: sanitizeCustomRules(parsed.customRules),
      };
    } catch {
      // Fallback
    }
  }
  return { soldatPath: DEFAULT_SOLDAT_PATH, extraSources: [], customRules: [] };
}

function saveConfig(cfg: AppConfig): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  fs.renameSync(tmp, CONFIG_FILE);
}

let appConfig = loadConfig();
const scanner = new SoldatMapScanner(
  appConfig.soldatPath,
  appConfig.extraSources,
  appConfig.customRules,
  CACHE_DIR,
  THUMB_DIR
);
const userData = new UserDataStore(path.join(DATA_DIR, 'user-data.json'));
const packPresets = new PackPresetStore(path.join(DATA_DIR, 'pack-presets.json'));
scanner.setUserDataStore(userData);
const workshop = new SoldatMapWorkshop(
  scanner,
  path.join(WORKSPACE_ROOT, 'exports'),
  CACHE_DIR,
  path.join(DATA_DIR, 'backups')
);

// The initial scan and temp-folder cleanup start only after app.listen() succeeded (see bottom), so a second
// launch that fails with "port in use" never touches the running instance's files or database.
let initialScanPromise: Promise<IndexMetaResponse> | null = null;

const app = express();

// Only this machine may talk to the server: reject foreign Host headers (DNS rebinding) and
// cross-site Origins (a random web page must never read files, write files or open dialogs).
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
app.use((req, res, next) => {
  const hostHeader = String(req.headers.host || '').toLowerCase();
  const hostName = hostHeader.replace(/:\d+$/, '');
  if (!LOOPBACK_HOSTNAMES.has(hostName)) {
    res.status(403).json({ error: 'Dostęp tylko z tego komputera (127.0.0.1 / localhost).' });
    return;
  }
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let originHost = '';
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      originHost = '';
    }
    if (!LOOPBACK_HOSTNAMES.has(originHost)) {
      res.status(403).json({ error: 'Żądanie z obcej strony zostało zablokowane.' });
      return;
    }
  }
  next();
});

app.use(express.json({ limit: '50mb' }));

function sendError(res: express.Response, err: unknown, fallbackStatus = 500): void {
  const status = err instanceof WorkshopError ? err.status : fallbackStatus;
  if (status >= 500) console.error('[Soldat Map Studio] Błąd API:', err);
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}

// 1. Config, Prefix Rules & Scanning Endpoints
app.get('/api/config', (_req, res) => {
  res.json({
    ...appConfig,
    exportsPacksDir: EXPORTS_PACKS_DIR,
    exportsScreensDir: EXPORTS_SCREENS_DIR,
  });
});

app.post('/api/config', async (req, res) => {
  try {
    const soldatPath =
      typeof req.body?.soldatPath === 'string'
        ? req.body.soldatPath.trim()
        : appConfig.soldatPath;
    if (!soldatPath) {
      res.status(400).json({ error: 'Podaj ścieżkę do folderu gry Soldat.' });
      return;
    }
    if (!fs.existsSync(soldatPath) || !fs.statSync(soldatPath).isDirectory()) {
      res.status(400).json({ error: `Folder nie istnieje: ${soldatPath}` });
      return;
    }

    let extraSources = appConfig.extraSources;
    if (Array.isArray(req.body?.extraSources)) {
      // Ids end up in map ids ("<sourceId>:<path>"): they must be unique and never "soldat"/"soldat_dl"
      const usedIds = new Set<string>(['soldat', 'soldat_dl']);
      extraSources = req.body.extraSources
        .map((s: Partial<ExtraMapSource>, idx: number) => {
          const p = String(s?.path || '').trim();
          if (!p) return null;
          let id =
            typeof s.id === 'string' && /^[\w-]{1,64}$/.test(s.id)
              ? s.id
              : `extra_${crypto.randomUUID().slice(0, 8)}_${idx}`;
          while (usedIds.has(id)) id = `extra_${crypto.randomUUID().slice(0, 8)}_${idx}`;
          usedIds.add(id);
          const absPath = path.resolve(p);
          return {
            id,
            path: absPath,
            label: String(s.label || path.basename(absPath) || `Folder #${idx + 1}`).trim(),
            recursive: s.recursive !== false,
            enabled: s.enabled !== false,
          };
        })
        .filter((x: ExtraMapSource | null): x is ExtraMapSource => Boolean(x));
    }

    appConfig = { ...appConfig, soldatPath, extraSources };
    saveConfig(appConfig);
    scanner.updateConfig(soldatPath, extraSources);
    workshop.invalidateCaches();

    // Trigger scan; wait up to 1.5s so normal scans return immediately, while 50k scans stream status!
    const scanProm = scanner.scanAsync(true);
    scanProm.catch(() => {});
    await Promise.race([scanProm, new Promise((r) => setTimeout(r, 1500))]);
    res.json(scanner.getMeta());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/prefix-rules', (_req, res) => {
  res.json({ customRules: appConfig.customRules });
});

app.post('/api/prefix-rules', (req, res) => {
  try {
    const rules = sanitizeCustomRules(req.body?.customRules);
    // Classify first: only persist rules that are proven to work
    const meta = scanner.updateCustomRules(rules);
    appConfig = { ...appConfig, customRules: rules };
    saveConfig(appConfig);
    res.json(meta);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/scan/status', (_req, res) => {
  res.json(scanner.getScanStatus());
});

app.get('/api/index/meta', async (req, res) => {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  if (force) {
    const scanProm = scanner.scanAsync(true);
    scanProm.catch(() => {});
    await Promise.race([scanProm, new Promise((r) => setTimeout(r, 1200))]);
  }
  res.json(scanner.getMeta());
});

// 2. Scalable Virtualized Map Queries (50,000+ maps ready!)
app.post('/api/maps/query', (req, res) => {
  try {
    const queryReq = (req.body || {}) as MapQueryRequest;
    const result = scanner.queryMaps(queryReq);
    res.json(result);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/maps/query-ids', (req, res) => {
  try {
    const queryReq = (req.body || {}) as MapQueryRequest;
    const ids = scanner.queryMatchingIds(queryReq);
    res.json({ ids, count: ids.length });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/maps/query-compacts', (req, res) => {
  try {
    const queryReq = (req.body || {}) as MapQueryRequest;
    const items = scanner.queryMatchingCompacts(queryReq);
    res.json({ items, count: items.length });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.get('/api/maps/:mapId/details', (req, res) => {
  const entry = scanner.getMapEntryWithUserData(req.params.mapId);
  if (!entry) {
    res.status(404).json({ error: `Nie znaleziono mapy: ${req.params.mapId}` });
    return;
  }
  res.json(entry);
});

// Favourite flag and user tags of one map (stored in data/user-data.json, independent of the index)
app.post('/api/maps/:mapId/user-data', (req, res) => {
  try {
    const mapId = req.params.mapId;
    if (!scanner.getMapEntry(mapId)) {
      res.status(404).json({ error: `Nie znaleziono mapy: ${mapId}` });
      return;
    }
    const patch: MapUserDataPatch = {};
    if (typeof req.body?.favorite === 'boolean') patch.favorite = req.body.favorite;
    if (Array.isArray(req.body?.tags)) patch.tags = req.body.tags;
    if (Array.isArray(req.body?.addTags)) patch.addTags = req.body.addTags;
    if (Array.isArray(req.body?.removeTags)) patch.removeTags = req.body.removeTags;
    const data = userData.update(mapId, patch);
    const response: MapUserDataResponse = {
      mapId,
      favorite: Boolean(data.favorite),
      tags: data.tags ?? [],
      ...scanner.getUserDataSummary(),
    };
    res.json(response);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/maps/:mapId/raw', (req, res) => {
  const mapId = req.params.mapId;
  const fullPath = scanner.getMapFilePath(mapId);
  if (!fullPath || !fs.existsSync(fullPath)) {
    res.status(404).json({ error: `Map not found: ${mapId}` });
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(fullPath, { dotfiles: 'allow' });
});

// 3. Asset Serving Endpoint (handles HD .png override, Classic .bmp, and native BMP->PNG conversion!)
// Converted PNGs keyed by file path + mtime + size + options, bounded by total bytes
const convertedAssetCache = new Map<string, Buffer>();
let convertedAssetCacheBytes = 0;
const CONVERTED_ASSET_CACHE_MAX_BYTES = 96 * 1024 * 1024;

function rememberConvertedAsset(key: string, png: Buffer): void {
  if (png.length > CONVERTED_ASSET_CACHE_MAX_BYTES / 4) return;
  convertedAssetCache.set(key, png);
  convertedAssetCacheBytes += png.length;
  for (const [oldKey, oldPng] of convertedAssetCache) {
    if (convertedAssetCacheBytes <= CONVERTED_ASSET_CACHE_MAX_BYTES) break;
    convertedAssetCache.delete(oldKey);
    convertedAssetCacheBytes -= oldPng.length;
  }
}

const ALLOWED_ASSET_CATEGORIES = new Set<string>([
  'textures',
  'textures/edges',
  'textures/objects',
  'scenery-gfx',
  'objects-gfx',
  'interface-gfx',
  'weapons-gfx',
]);

app.get('/api/assets', async (req, res) => {
  const category = String(req.query.category || '');
  const name = String(req.query.name || '');
  const forcePng = req.query.convert === 'png';
  const applyColorKey = req.query.colorkey === '1';
  const preferClassicBmp = req.query.classic === '1' || req.query.classic === 'true';

  if (!ALLOWED_ASSET_CATEGORIES.has(category) || !name) {
    res.status(400).json({ error: 'Invalid asset category or name' });
    return;
  }

  const entry = scanner
    .getResolver()
    .findBestRenderFile(category as AssetCategory, name, preferClassicBmp);

  if (!entry || !fs.existsSync(entry.fullPath)) {
    res.status(404).end();
    return;
  }

  const isExtBmp = entry.fullPath.toLowerCase().endsWith('.bmp');

  // Always convert 1-row/tiny RLE edge BMPs, disguised BMPs, or explicit convert=png requests!
  if (forcePng || (isExtBmp && category === 'textures/edges')) {
    let cacheKey = '';
    try {
      const st = fs.statSync(entry.fullPath);
      cacheKey = `${entry.fullPath}|${st.mtimeMs}|${st.size}|${applyColorKey ? 'ck' : 'raw'}`;
    } catch {
      cacheKey = '';
    }
    const cached = cacheKey ? convertedAssetCache.get(cacheKey) : undefined;
    if (cached) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(cached);
      return;
    }
    try {
      const rawBuf = fs.readFileSync(entry.fullPath);
      let rgba: Buffer;
      let width: number;
      let height: number;
      if (isExtBmp || isBufferBmpMagic(rawBuf)) {
        const decoded = decodeBmpToRgba(rawBuf);
        rgba = decoded.rgba;
        width = decoded.width;
        height = decoded.height;
      } else {
        const out = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        rgba = out.data;
        width = out.info.width;
        height = out.info.height;
      }
      if (applyColorKey) {
        // Same rule as OpenSoldat Gfx.pas: only fully opaque pure #00FF00 becomes transparent
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i] === 0 && rgba[i + 1] === 255 && rgba[i + 2] === 0 && rgba[i + 3] === 255) {
            rgba[i + 3] = 0;
          }
        }
      }
      const pngBuf = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
      if (cacheKey) rememberConvertedAsset(cacheKey, pngBuf);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(pngBuf);
      return;
    } catch {
      // Fallback to raw sendFile below
    }
  }

  // no-cache (revalidated by Last-Modified) so regenerated `_o` tiles never show stale in the viewer
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(entry.fullPath, { dotfiles: 'allow' });
});

// 4. Cached Map Thumbnails
app.get('/api/thumbnails/:crc32', (req, res) => {
  const safeCrc = String(req.params.crc32).replace(/[^0-9a-fA-F_-]/g, '');
  const thumbPath = path.join(THUMB_DIR, `${safeCrc}.webp`);
  if (!safeCrc || !fs.existsSync(thumbPath)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(thumbPath, { dotfiles: 'allow' });
});

app.post(
  '/api/thumbnails/:crc32',
  express.raw({ type: ['image/webp', 'image/png', 'application/octet-stream'], limit: '5mb' }),
  async (req, res) => {
    try {
      const safeCrc = String(req.params.crc32).replace(/[^0-9a-fA-F_-]/g, '');
      if (!safeCrc) {
        res.status(400).json({ error: 'Invalid thumbnail id' });
        return;
      }
      const thumbPath = path.join(THUMB_DIR, `${safeCrc}.webp`);
      const buf = req.body as Buffer;
      if (Buffer.isBuffer(buf) && buf.length > 0) {
        if (req.headers['content-type'] === 'image/webp') {
          fs.writeFileSync(thumbPath, buf);
        } else {
          await sharp(buf).webp({ quality: 82 }).toFile(thumbPath);
        }
        scanner.markThumbnailCached(safeCrc);
      }
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// 5. Map Pack Preview, Build & Archive Inspector/Extractor (MPA Pro v2)
// Library tidy-up: duplicates (C2) and unused sceneries (C3). Files are moved into data/backups, never deleted.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

// Library reports and moves always work on an index that matches the disk: a quick (cached) rescan first,
// which also waits for a scan that is still running (e.g. right after start-up or a Soldat path change)
app.get('/api/library/duplicates', async (_req, res) => {
  try {
    await scanner.scanAsync(false);
    res.json(listDuplicateGroups(scanner));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/library/duplicates/move', async (req, res) => {
  try {
    const mapIds = Array.isArray(req.body?.mapIds) ? req.body.mapIds.map(String) : [];
    if (mapIds.length === 0) throw new LibraryError('Nie wybrano żadnych plików.');
    const response = await runLibraryOperation(async () => {
      await scanner.scanAsync(false);
      const result = await moveDuplicateMaps(scanner, mapIds, BACKUPS_DIR);
      console.log(`[Soldat Map Studio] Duplikaty: przeniesiono ${result.moved} plików do ${result.backupDir}`);
      return { ...result, meta: await scanner.scanAsync(true) };
    });
    res.json(response);
  } catch (err) {
    sendError(res, err, err instanceof LibraryError ? err.status : 500);
  }
});

app.get('/api/library/unused-scenery', async (_req, res) => {
  try {
    await scanner.scanAsync(false);
    const { allUnusedNames: _all, ...report } = computeUnusedScenery(scanner);
    res.json(report);
  } catch (err) {
    sendError(res, err, err instanceof LibraryError ? err.status : 500);
  }
});

app.post('/api/library/unused-scenery/move', async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names) ? req.body.names.map(String) : [];
    if (names.length === 0) throw new LibraryError('Nie wybrano żadnych plików.');
    const response = await runLibraryOperation(async () => {
      await scanner.scanAsync(false);
      const result = await moveUnusedScenery(scanner, names, BACKUPS_DIR);
      console.log(`[Soldat Map Studio] Nieużywane scenerie: przeniesiono ${result.moved} plików do ${result.backupDir}`);
      return { ...result, meta: await scanner.scanAsync(true) };
    });
    res.json(response);
  } catch (err) {
    sendError(res, err, err instanceof LibraryError ? err.status : 500);
  }
});

// Saved pack option sets
app.get('/api/pack-presets', (_req, res) => {
  res.json({ presets: packPresets.list() });
});

app.post('/api/pack-presets', (req, res) => {
  try {
    res.json({ presets: packPresets.save(req.body?.name, req.body?.options) });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.delete('/api/pack-presets/:name', (req, res) => {
  try {
    res.json({ presets: packPresets.remove(req.params.name) });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/packs/preview', (req, res) => {
  try {
    const options = req.body as PackBuildOptions;
    const preview = buildPackPreview(options, scanner);
    res.json(preview);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/packs/build', async (req, res) => {
  try {
    const options = req.body as PackBuildOptions;
    const result = await executePackBuild(options, scanner, EXPORTS_PACKS_DIR);
    res.json({
      ...result,
      downloadUrl:
        result.format !== 'folder' &&
        fs.existsSync(result.outputPath) &&
        fs.statSync(result.outputPath).isFile()
          ? `/api/exports/download?path=${encodeURIComponent(result.outputPath)}`
          : null,
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/packs/inspect-archive', (req, res) => {
  try {
    const archivePath = String(req.body?.archivePath || '').trim();
    if (!archivePath || !fs.existsSync(archivePath)) {
      res.status(404).json({ error: 'Nie znaleziono wskazanego pliku archiwum.' });
      return;
    }
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    const maps: Array<{
      name: string;
      title: string;
      polygons: number;
      props: number;
      texture: string;
    }> = [];
    const files: Array<{ path: string; size: number }> = [];

    if (entries.length > ZIP_LIMITS.maxEntries) {
      throw new ZipSafetyError(`Archiwum ma ${entries.length} wpisów (limit ${ZIP_LIMITS.maxEntries}).`);
    }

    // Only plausible map files are decompressed for the preview: a crafted archive may declare gigabytes, point
    // thousands of entries at the same compressed data, or use encryption / unsupported compression
    const seenDataOffsets = new Set<number>();
    let previewBytes = 0;
    for (const e of entries) {
      if (e.isDirectory || isZipSymlink(e)) continue;
      files.push({ path: e.entryName, size: e.header.size });
      if (
        e.entryName.toLowerCase().endsWith('.pms') &&
        e.header.size <= ZIP_LIMITS.maxPmsPreviewBytes &&
        previewBytes + e.header.size <= ZIP_LIMITS.maxPreviewTotalBytes &&
        !seenDataOffsets.has(e.header.offset) &&
        !zipEntryProblem(e)
      ) {
        seenDataOffsets.add(e.header.offset);
        previewBytes += e.header.size;
        try {
          const data = e.getData();
          const summary = parsePmsSummary(data);
          maps.push({
            name: path.basename(e.entryName, path.extname(e.entryName)),
            title: summary.mapName,
            polygons: summary.polygonCount,
            props: summary.activePropCount,
            texture: summary.texture,
          });
        } catch {
          // Ignore malformed PMS inside archive
        }
      }
    }

    res.json({
      archivePath,
      fileName: path.basename(archivePath),
      totalFiles: files.length,
      maps,
      files: files.slice(0, 5000),
    });
  } catch (err) {
    sendError(res, err, err instanceof ZipSafetyError ? err.status : 500);
  }
});

app.post('/api/packs/extract-archive', async (req, res) => {
  try {
    const archivePath = String(req.body?.archivePath || '').trim();
    const targetFolderRaw = String(req.body?.targetFolder || '').trim();
    const registerAsSource = Boolean(req.body?.registerAsSource);

    if (!archivePath || !fs.existsSync(archivePath)) {
      res.status(404).json({ error: 'Nie znaleziono archiwum do wypakowania.' });
      return;
    }

    const baseArchiveName = path.basename(archivePath, path.extname(archivePath));
    const destDir = targetFolderRaw
      ? path.resolve(targetFolderRaw)
      : path.join(EXPORTS_PACKS_DIR, 'extracted', baseArchiveName);

    // Validates every entry first (zip-slip, sizes), skips symbolic links, never writes through a link
    const extracted = extractZipSafely(archivePath, destDir);
    console.log(
      `[Soldat Map Studio] Wypakowano ${extracted.files} plików z ${path.basename(archivePath)} do ${destDir}` +
        (extracted.skippedLinks > 0 ? ` (pominięto dowiązań: ${extracted.skippedLinks})` : '')
    );

    if (registerAsSource) {
      const mapsSub = fs.existsSync(path.join(destDir, 'maps'))
        ? path.join(destDir, 'maps')
        : destDir;
      const already = appConfig.extraSources.some(
        (s) => path.resolve(s.path).toLowerCase() === path.resolve(mapsSub).toLowerCase()
      );
      if (!already) {
        const nextSources: ExtraMapSource[] = [
          ...appConfig.extraSources,
          {
            id: `extra_${crypto.randomUUID().slice(0, 8)}`,
            path: mapsSub,
            label: `Paczka: ${baseArchiveName}`,
            recursive: true,
            enabled: true,
          },
        ];
        appConfig = { ...appConfig, extraSources: nextSources };
        saveConfig(appConfig);
        scanner.updateConfig(appConfig.soldatPath, nextSources);
      }
    }
    await scanner.scanAsync(true);

    res.json({ outputPath: destDir, meta: scanner.getMeta() });
  } catch (err) {
    sendError(res, err, err instanceof ZipSafetyError ? err.status : 500);
  }
});

// 6. Full-Size 100% Screenshot Saving & Tiled Giant Screenshot Assembly
app.post('/api/screenshots/check-exists', (req, res) => {
  const rawName = String(req.body?.fileName || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const subfolder = sanitizeScreenshotSubfolder(req.body?.subfolder);
  const customFolder = req.body?.customFolder ? String(req.body.customFolder).trim() : '';
  const baseDir = customFolder ? path.resolve(customFolder) : EXPORTS_SCREENS_DIR;
  const fullDir = subfolder ? path.join(baseDir, subfolder) : baseDir;
  const outPath = path.join(fullDir, rawName);
  res.json({ exists: Boolean(rawName) && fs.existsSync(outPath), outputPath: outPath });
});

app.post(
  '/api/screenshots/save-direct',
  express.raw({
    type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'],
    limit: '250mb',
  }),
  (req, res) => {
    try {
      const rawName = String(req.query.fileName || 'map_100pct.png');
      const customFolder = String(req.query.customFolder || req.query.folder || '').trim();
      const subfolder = sanitizeScreenshotSubfolder(
        req.query.subfolder ? String(req.query.subfolder) : undefined
      );
      const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
      if (!/\.(png|jpe?g|webp)$/i.test(safeName)) {
        res.status(400).json({ error: 'Dozwolone są tylko pliki .png, .jpg i .webp.' });
        return;
      }
      const baseDir = customFolder ? path.resolve(customFolder) : EXPORTS_SCREENS_DIR;
      const targetDir = subfolder ? path.join(baseDir, subfolder) : baseDir;
      fs.mkdirSync(targetDir, { recursive: true });

      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'Pusty plik obrazu.' });
        return;
      }
      const outPath = path.join(targetDir, safeName);
      fs.writeFileSync(outPath, buf);

      res.json({
        outputPath: outPath,
        fileName: safeName,
        sizeBytes: buf.length,
        downloadUrl: `/api/exports/download?path=${encodeURIComponent(outPath)}`,
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);

app.post('/api/screenshots/tile-session/start', (req, res) => {
  try {
    const { mapName, width, height, format, quality } = req.body;
    const sessionId = createTileSession({
      mapName: String(mapName || 'map'),
      width: Number(width),
      height: Number(height),
      format: format || 'png',
      quality: quality ? Number(quality) : 92,
      cacheRoot: CACHE_DIR,
    });
    res.json({ sessionId });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post(
  '/api/screenshots/tile-session/:sessionId/tile',
  express.raw({ type: ['image/png', 'application/octet-stream'], limit: '100mb' }),
  (req, res) => {
    try {
      const { sessionId } = req.params;
      const left = Number(req.query.left);
      const top = Number(req.query.top);
      addSessionTile(sessionId, left, top, req.body as Buffer);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, 400);
    }
  }
);

app.post('/api/screenshots/tile-session/:sessionId/finalize', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const customFolder = req.body?.customFolder ? String(req.body.customFolder).trim() : '';
    const subfolder = req.body?.subfolder ? String(req.body.subfolder) : undefined;
    const fileName = req.body?.fileName ? String(req.body.fileName).trim() : undefined;
    const targetDir = customFolder ? path.resolve(customFolder) : EXPORTS_SCREENS_DIR;
    const result = await finalizeTileSession(sessionId, targetDir, fileName, subfolder);
    res.json({
      ...result,
      downloadUrl: `/api/exports/download?path=${encodeURIComponent(result.outputPath)}`,
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/screenshots/tile-session/:sessionId', (req, res) => {
  cancelTileSession(req.params.sessionId);
  res.json({ ok: true });
});

// Only finished exports (packs / screenshots) may be downloaded through the browser
const DOWNLOADABLE_EXTENSIONS = new Set(['.zip', '.smap', '.png', '.jpg', '.jpeg', '.webp']);

app.get('/api/exports/download', (req, res) => {
  const filePath = path.resolve(String(req.query.path || ''));
  if (!DOWNLOADABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    res.status(403).json({ error: 'Ten typ pliku nie może być pobrany.' });
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.status(404).json({ error: 'Plik nie istnieje.' });
    return;
  }
  res.download(filePath, path.basename(filePath), { dotfiles: 'allow' });
});

// 7. Map Workshop Endpoints: Soldat 1.7.1 Scenery Fixer (_f.pms) & Layer Optimizer (_o.pms)
app.get('/api/workshop/fix-analyze/:mapId', async (req, res) => {
  try {
    const maxLen = Number(req.query.maxLen || 24);
    const analysis = await workshop.analyzeMapFor171Fix(req.params.mapId, maxLen);
    res.json(analysis);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/workshop/fix-check', (req, res) => {
  try {
    const check = workshop.checkFixTarget(
      String(req.body?.mapId || ''),
      Number(req.body?.maxBaseLength || 24),
      (req.body?.destination || 'soldat_maps') as FixMapRequest['destination'],
      req.body?.customOutputFolder ? String(req.body.customOutputFolder) : undefined
    );
    res.json(check);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/workshop/fix-apply', async (req, res) => {
  try {
    const fixReq = req.body as FixMapRequest;
    const result = await workshop.fixMap171(fixReq, false);
    res.json({ result, meta: scanner.getMeta() });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/workshop/fix-batch-scan', async (req, res) => {
  try {
    const mapIds = Array.isArray(req.body?.mapIds) ? (req.body.mapIds as string[]) : [];
    const maxBaseLength = Number(req.body?.maxBaseLength || 24);
    const destination = (req.body?.destination || 'soldat_maps') as FixMapRequest['destination'];
    const customOutputFolder = req.body?.customOutputFolder
      ? String(req.body.customOutputFolder)
      : undefined;
    const items = await workshop.scanBatchFor171Issues(mapIds, maxBaseLength, destination, customOutputFolder);
    res.json({ items, scannedCount: mapIds.length });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/workshop/fix-batch-apply', async (req, res) => {
  try {
    const mapIds = Array.isArray(req.body?.mapIds) ? (req.body.mapIds as string[]) : [];
    const removeUnusedScenery = Boolean(req.body?.removeUnusedScenery);
    const maxBaseLength = Number(req.body?.maxBaseLength || 24);
    const destination = (req.body?.destination || 'soldat_maps') as FixMapRequest['destination'];
    const overwriteExisting = Boolean(req.body?.overwriteExisting);
    const customOutputFolder = req.body?.customOutputFolder
      ? String(req.body.customOutputFolder)
      : undefined;

    let fixedMapsCount = 0;
    let totalFixedProps = 0;
    let skippedExistingCount = 0;
    const failed: Array<{ mapId: string; error: string }> = [];
    let lastOutputPath = '';
    // Several sources can truncate to the same derived name: the first one wins, the rest are reported
    const claimedNames = new Map<string, string>();

    for (const mapId of mapIds) {
      const entry = scanner.getMapEntry(mapId);
      if (entry) {
        const derivedKey = makeDerivedMapName(entry.baseName, '_f', maxBaseLength).toLowerCase();
        const owner = claimedNames.get(derivedKey);
        if (owner) {
          failed.push({ mapId, error: `Ta sama nazwa wynikowa co ${owner} — pominięto` });
          continue;
        }
        claimedNames.set(derivedKey, entry.baseName);
      }
      try {
        const out = await workshop.fixMap171(
          {
            mapId,
            removeUnusedScenery,
            maxBaseLength,
            destination,
            customOutputFolder,
            overwriteExisting,
          },
          true,
          // Batch runs only ever replace their own unchanged previous outputs, never someone else's map
          overwriteExisting ? 'own' : 'never'
        );
        fixedMapsCount++;
        totalFixedProps += out.fixedPropCount;
        lastOutputPath = out.outputPath;
      } catch (e) {
        if (e instanceof WorkshopError && e.status === 409) {
          skippedExistingCount++;
        } else {
          failed.push({ mapId, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    workshop.flushRegistry();
    if (destination === 'soldat_maps' && fixedMapsCount > 0) {
      await scanner.scanAsync(true);
    }

    res.json({
      fixedMapsCount,
      totalFixedProps,
      skippedExistingCount,
      failed: failed.slice(0, 200),
      outputDir: lastOutputPath ? path.dirname(lastOutputPath) : null,
      meta: scanner.getMeta(),
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/workshop/optimize-plan', async (req, res) => {
  try {
    const mapId = String(req.body?.mapId || '');
    const options = req.body?.options as OptimizeMapOptions;
    const plan = await workshop.planSceneryOptimization(mapId, options);
    res.json(plan);
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/workshop/optimize-check', async (req, res) => {
  try {
    const mapId = String(req.body?.mapId || '');
    const options = req.body?.options as OptimizeMapOptions;
    res.json(await workshop.checkOptimizeTarget(mapId, options));
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post('/api/workshop/optimize-session', (req, res) => {
  try {
    const mapId = String(req.body?.mapId || '');
    const options = req.body?.options as OptimizeMapOptions;
    res.json({ sessionId: workshop.startOptimizeSession(mapId, options) });
  } catch (err) {
    sendError(res, err, 400);
  }
});

app.post(
  '/api/workshop/optimize-session/:sessionId/tile',
  express.raw({ type: ['image/png', 'application/octet-stream'], limit: '256mb' }),
  async (req, res) => {
    try {
      let meta: unknown = {};
      try {
        meta = JSON.parse(String(req.query.meta || '{}'));
      } catch {
        res.status(400).json({ error: 'Nieprawidłowe metadane kafelka.' });
        return;
      }
      await workshop.addOptimizeTile(req.params.sessionId, meta, req.body as Buffer);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err, 400);
    }
  }
);

app.post('/api/workshop/optimize-session/:sessionId/commit', async (req, res) => {
  try {
    const rawPolicy = req.body?.overwritePolicy;
    const policy: OverwritePolicy =
      rawPolicy === 'never' || rawPolicy === 'own' || rawPolicy === 'always'
        ? rawPolicy
        : req.body?.overwrite
        ? 'always'
        : 'never';
    const expected =
      typeof req.body?.expectedDerivedBaseName === 'string'
        ? {
            derivedBaseName: String(req.body.expectedDerivedBaseName),
            propFixes: Array.isArray(req.body?.expectedPropFixes) ? req.body.expectedPropFixes : [],
          }
        : undefined;
    const result = await workshop.commitOptimizeSession(
      req.params.sessionId,
      policy,
      Boolean(req.body?.skipRescan),
      expected
    );
    res.json({ result, meta: scanner.getMeta() });
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/workshop/optimize-session/:sessionId', (req, res) => {
  workshop.cancelOptimizeSession(req.params.sessionId);
  res.json({ ok: true });
});

// 8. Native Windows OS Helpers
app.post('/api/system/open-path', (req, res) => {
  const target = String(req.body?.path || '').trim();
  if (!target || !fs.existsSync(target)) {
    res.status(404).json({ error: 'Ścieżka nie istnieje.' });
    return;
  }
  const resolved = path.resolve(target);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    execFile('explorer.exe', [`/select,${resolved}`]);
  } else {
    execFile('explorer.exe', [resolved]);
  }
  res.json({ ok: true });
});

/**
 * Runs a WinForms dialog script. User-supplied texts travel through environment variables (never spliced
 * into the script, so no quote can inject commands) and stdout is forced to UTF-8 for Polish paths.
 */
function runPowerShellDialog(
  script: string,
  env: Record<string, string>,
  res: express.Response
): void {
  const fullScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', fullScript],
    { timeout: 300000, windowsHide: true, encoding: 'utf8', env: { ...process.env, ...env } },
    (err, stdout) => {
      if (err) {
        res.status(500).json({ error: String(err) });
        return;
      }
      const selected = String(stdout).trim();
      res.json({ path: selected || null });
    }
  );
}

app.post('/api/system/pick-folder', (req, res) => {
  const description = String(req.body?.description || 'Wybierz folder').slice(0, 200);
  runPowerShellDialog(
    `
    Add-Type -AssemblyName System.Windows.Forms
    $f = New-Object System.Windows.Forms.FolderBrowserDialog
    $f.Description = $env:SMS_DIALOG_TEXT
    $f.ShowNewFolderButton = $true
    $top = New-Object System.Windows.Forms.Form
    $top.TopMost = $true
    if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $f.SelectedPath
    }
    $top.Dispose()
  `,
    { SMS_DIALOG_TEXT: description },
    res
  );
});

app.post('/api/system/pick-file', (req, res) => {
  const filter = String(
    req.body?.filter || 'Archiwa Map (*.zip;*.smap)|*.zip;*.smap|Wszystkie pliki (*.*)|*.*'
  ).slice(0, 300);
  runPowerShellDialog(
    `
    Add-Type -AssemblyName System.Windows.Forms
    $f = New-Object System.Windows.Forms.OpenFileDialog
    $f.Filter = $env:SMS_DIALOG_TEXT
    $top = New-Object System.Windows.Forms.Form
    $top.TopMost = $true
    if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $f.FileName
    }
    $top.Dispose()
  `,
    { SMS_DIALOG_TEXT: filter },
    res
  );
});

// Unknown API routes answer JSON (instead of the SPA index.html fallback)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Nieznany endpoint API.' });
});

// Serve built frontend in production
const clientDist = path.join(WORKSPACE_ROOT, 'dist', 'client');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Soldat Map Studio v${APP_VERSION}] Server running on http://127.0.0.1:${PORT}`);
  cleanupOrphanedTileSessions(CACHE_DIR);
  workshop.cleanupLeftoverSessions();
  initialScanPromise = scanner.scanAsync(true);
  initialScanPromise
    .then((meta) => {
      console.log(
        `[Soldat Map Studio] SQLite WAL Index ready: ${meta.totalMaps} maps (${meta.modeGroups.length} mode groups, ${meta.prefixes.length} prefixes) in ${meta.scanDurationMs}ms` +
          (meta.scanStatus.failedFiles > 0 ? `, ${meta.scanStatus.failedFiles} unreadable` : '')
      );
    })
    .catch((err) => {
      console.error('[Soldat Map Studio] Błąd początkowego skanowania map:', err);
    });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[Soldat Map Studio] Port ${PORT} jest już zajęty — aplikacja prawdopodobnie już działa. Otwórz http://127.0.0.1:${PORT} albo zamknij poprzednie okno serwera.`
    );
  } else {
    console.error('[Soldat Map Studio] Błąd serwera:', err);
  }
  process.exit(1);
});
