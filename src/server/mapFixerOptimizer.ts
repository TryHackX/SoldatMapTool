import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  BakedSceneryTileUpload,
  BatchScanFixItem,
  DerivedTargetCheck,
  FixMapRequest,
  FixMapResponse,
  MapFixAnalysisResponse,
  MapOptimizePlanResponse,
  OptimizeLayerGroupPlan,
  OptimizeMapOptions,
  OptimizePropFix,
  OptimizePreservedPropInfo,
  OptimizeSaveResponse,
  OverwritePolicy,
  SceneryFixIssueGroup,
  SceneryFixReason,
} from '../shared/apiTypes';
import {
  checkSoldatMapLimits,
  computePropAabb,
  currentDosTimestamp,
  isPropAabbOnMap,
  isPropRenderable,
  makeDerivedMapName,
  makeOptimizeOutputName,
  parsePmsFull,
  patchPmsPropsAndScenery,
  PmsBounds,
  PmsMapData,
  PmsProp,
  PmsSceneryDef,
  soldatCrc32,
} from '../shared/pmsParser';
import { bakeTilesFor, estimateTileCrop, MAX_BAKE_TILES } from '../shared/bakeTiling';
import { decodeBmpToRgba } from './bmpDecoder';
import { t } from './i18n';
import { SoldatMapScanner } from './soldatScanner';

// Explicit canonical Soldat 1.6 dimensions (overrides unreferenced or 1.7.1-remastered official map entries)
const FALLBACK_CANONICAL_16_DIMS: Record<string, { w: number; h: number }> = {
  'amb_fog_ground-sk': { w: 160, h: 52 },
  deagle5_crate: { w: 37, h: 37 },
  blankfade2: { w: 92, h: 92 },
  'jungletree2.1': { w: 34, h: 88 },
  fx_p_cloud1: { w: 640, h: 480 },
  fx_p_cloud2: { w: 640, h: 420 },
  fx_p_cloud4: { w: 640, h: 480 },
};

// Unfinished optimize upload sessions are discarded after this long
const OPTIMIZE_SESSION_TTL_MS = 30 * 60 * 1000;

function isPowerOfTwo(n: number): boolean {
  return n >= 16 && (n & (n - 1)) === 0;
}

export function isBufferBmpMagic(buf: Buffer | Uint8Array): boolean {
  return buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d;
}

/**
 * Error carrying an HTTP status (e.g. 409 when a derived map already exists and overwrite was not confirmed).
 */
export class WorkshopError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

interface GeneratedOutputRecord {
  crc32: number;
  kind: '_f' | '_o';
  sourceMapId: string;
  createdAt: number;
}

interface OptimizeSession {
  id: string;
  mapId: string;
  options: OptimizeMapOptions;
  tempDir: string;
  tiles: Array<BakedSceneryTileUpload & { tempPath: string }>;
  createdAt: number;
  lastActivity: number;
  committing: boolean;
}

export type { OverwritePolicy };

/**
 * Copies files into `data/backups/<timestamp>/` right before they are overwritten or deleted.
 * One instance = one user operation, so all files touched together land in the same folder.
 */
class BackupSession {
  private dir: string | null = null;
  public readonly saved: string[] = [];

  constructor(private readonly backupsRoot: string) {}

  public preserve(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    if (!this.dir) {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
      this.dir = path.join(this.backupsRoot, stamp);
      for (let n = 2; fs.existsSync(this.dir); n++) this.dir = path.join(this.backupsRoot, `${stamp}_${n}`);
      fs.mkdirSync(this.dir, { recursive: true });
    }
    let target = path.join(this.dir, path.basename(filePath));
    for (let n = 2; fs.existsSync(target); n++) {
      const ext = path.extname(filePath);
      target = path.join(this.dir, `${path.basename(filePath, ext)}_${n}${ext}`);
    }
    fs.copyFileSync(filePath, target);
    this.saved.push(target);
  }

  public get directory(): string | null {
    return this.dir;
  }
}

export class SoldatMapWorkshop {
  private scanner: SoldatMapScanner;
  private exportsRoot: string;
  private sessionsRoot: string;
  private registryPath: string;
  private backupsRoot: string;

  private cachedSoldatRoot = '';
  private canonicalVanillaDims = new Map<string, { w: number; h: number }>();
  private imgDimsCache = new Map<string, { w: number; h: number } | null>();
  private optimizeSessions = new Map<string, OptimizeSession>();

  constructor(scanner: SoldatMapScanner, exportsRoot: string, cacheRoot: string, backupsRoot: string) {
    this.scanner = scanner;
    this.exportsRoot = exportsRoot;
    this.backupsRoot = backupsRoot;
    this.sessionsRoot = path.join(cacheRoot, 'optimize-sessions');
    this.registryPath = path.join(cacheRoot, 'generated-outputs.json');
  }

  /**
   * Called once the server owns its port: leftovers of a previous run can never be committed anymore.
   * (Doing this in the constructor would let a second, failing launch wipe the running instance's uploads.)
   */
  public cleanupLeftoverSessions(): void {
    try {
      fs.rmSync(this.sessionsRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    const timer = setInterval(() => this.pruneStaleSessions(), 5 * 60 * 1000);
    timer.unref?.();
  }

  public invalidateCaches(): void {
    this.cachedSoldatRoot = '';
    this.canonicalVanillaDims.clear();
    this.imgDimsCache.clear();
  }

  private ensureCanonicalVanillaTable(): void {
    const soldatRoot = this.scanner.getResolver().getRoot();
    if (this.cachedSoldatRoot === soldatRoot && this.canonicalVanillaDims.size > 0) {
      return;
    }

    this.cachedSoldatRoot = soldatRoot;
    this.canonicalVanillaDims.clear();

    for (const [k, v] of Object.entries(FALLBACK_CANONICAL_16_DIMS)) {
      this.canonicalVanillaDims.set(k.toLowerCase(), v);
    }

    const roPath = path.join(soldatRoot, 'readonly.txt');
    const mapsDir = path.join(soldatRoot, 'maps');
    if (!fs.existsSync(roPath) || !fs.existsSync(mapsDir)) return;

    const officialMapNames = new Set<string>();
    try {
      const lines = fs.readFileSync(roPath, 'utf-8').split(/\r?\n/);
      for (const raw of lines) {
        const clean = raw.trim().replace(/\\/g, '/').toLowerCase();
        if (clean.startsWith('maps/') && clean.endsWith('.pms')) {
          officialMapNames.add(path.posix.basename(clean));
        }
      }

      const freqByStem = new Map<string, Map<string, { w: number; h: number; count: number }>>();
      for (const file of fs.readdirSync(mapsDir)) {
        if (!officialMapNames.has(file.toLowerCase())) continue;
        try {
          const buf = fs.readFileSync(path.join(mapsDir, file));
          const pms = parsePmsFull(buf);
          for (const p of pms.props) {
            if (!isPropRenderable(p, pms.scenery.length)) continue;
            if (p.width <= 0 || p.height <= 0) continue;
            const scName = pms.scenery[p.style - 1].filename;
            const stem = scName.toLowerCase().replace(/\.[^.]+$/, '');
            let m = freqByStem.get(stem);
            if (!m) {
              m = new Map();
              freqByStem.set(stem, m);
            }
            const key = `${p.width}x${p.height}`;
            const prev = m.get(key);
            if (prev) prev.count++;
            else m.set(key, { w: p.width, h: p.height, count: 1 });
          }
        } catch {
          // Ignore single unreadable map
        }
      }

      for (const [stem, freq] of freqByStem.entries()) {
        let best: { w: number; h: number; count: number } | null = null;
        for (const item of freq.values()) {
          if (!best || item.count > best.count) best = item;
        }
        if (best) {
          this.canonicalVanillaDims.set(stem, { w: best.w, h: best.h });
        }
      }
    } catch {
      // Ignore readonly scan error
    }

    // Re-apply explicit overrides last so remastered 1.7.1 official maps (e.g. fx_p_cloud1 at 2048x1536) cannot clobber 1.6 dims
    for (const [k, v] of Object.entries(FALLBACK_CANONICAL_16_DIMS)) {
      this.canonicalVanillaDims.set(k.toLowerCase(), v);
    }
  }

  public async getImageDimensionsSafe(fullPath: string): Promise<{ w: number; h: number } | null> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return null;
    }
    // Keyed by mtime + size so regenerated files (e.g. re-baked `_o` tiles) are never served stale dims
    const cacheKey = `${fullPath.toLowerCase()}|${stat.mtimeMs}|${stat.size}`;
    if (this.imgDimsCache.has(cacheKey)) {
      return this.imgDimsCache.get(cacheKey) ?? null;
    }

    let res: { w: number; h: number } | null = null;
    try {
      const buf = fs.readFileSync(fullPath);
      if (isBufferBmpMagic(buf)) {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const dibHeaderSize = view.getUint32(14, true);
        if (dibHeaderSize === 12) {
          const w = view.getUint16(18, true);
          const h = view.getUint16(20, true);
          if (w > 0 && h > 0) res = { w, h };
        } else if (dibHeaderSize >= 40) {
          const w = Math.abs(view.getInt32(18, true));
          const h = Math.abs(view.getInt32(22, true));
          if (w > 0 && h > 0 && w <= 32768 && h <= 32768) res = { w, h };
        }
        if (!res) {
          const decoded = decodeBmpToRgba(buf);
          res = { w: decoded.width, h: decoded.height };
        }
      } else {
        const meta = await sharp(buf).metadata();
        if (meta.width && meta.height) res = { w: meta.width, h: meta.height };
      }
    } catch {
      res = null;
    }

    if (this.imgDimsCache.size > 20000) this.imgDimsCache.clear();
    this.imgDimsCache.set(cacheKey, res);
    return res;
  }

  /**
   * Analyzes a map for Soldat 1.7.1 stretched / enlarged scenery bugs (_f.pms).
   */
  public async analyzeMapFor171Fix(
    mapId: string,
    maxBaseLength = 24
  ): Promise<MapFixAnalysisResponse> {
    const entry = this.scanner.getMapEntry(mapId);
    const fullPath = this.scanner.getMapFilePath(mapId);
    if (!entry || !fullPath || !fs.existsSync(fullPath)) {
      throw new WorkshopError(t('Map file not found: {id}', { id: mapId }), 404);
    }

    const rawBytes = fs.readFileSync(fullPath);
    const pms = parsePmsFull(rawBytes);
    return this.analyzeParsedMap(mapId, entry.baseName, pms, maxBaseLength);
  }

  private async analyzeParsedMap(
    mapId: string,
    baseName: string,
    pms: PmsMapData,
    maxBaseLength: number,
    dimsMemo: Map<string, { w: number; h: number } | null> = new Map()
  ): Promise<MapFixAnalysisResponse> {
    this.ensureCanonicalVanillaTable();
    const resolver = this.scanner.getResolver();
    // Image sizes are looked up once per file (per map, or per whole batch when a memo is shared)
    const dimsOf = async (fullPath: string) => {
      const key = fullPath.toLowerCase();
      if (dimsMemo.has(key)) return dimsMemo.get(key) ?? null;
      const dims = await this.getImageDimensionsSafe(fullPath);
      dimsMemo.set(key, dims);
      return dims;
    };

    const groupsMap = new Map<string, SceneryFixIssueGroup>();
    let totalActiveProps = 0;

    for (let idx = 0; idx < pms.props.length; idx++) {
      const p = pms.props[idx];
      if (!isPropRenderable(p, pms.scenery.length)) continue;
      totalActiveProps++;

      const scDef = pms.scenery[p.style - 1];
      const scName = scDef.filename;
      if (!scName) continue;

      const stem = scName.toLowerCase().replace(/\.[^.]+$/, '');
      const isVanilla = resolver.isVanillaAsset('scenery-gfx', scName);
      const canonical = this.canonicalVanillaDims.get(stem) ?? null;

      const scLower = scName.toLowerCase();
      const refsBmp = scLower.endsWith('.bmp');
      const hdRenderEntry = resolver.findBestRenderFile('scenery-gfx', scName, false);
      const classicRenderEntry = refsBmp
        ? resolver.findBestRenderFile('scenery-gfx', scName, true)
        : hdRenderEntry;

      const diskDims = hdRenderEntry
        ? await dimsOf(hdRenderEntry.fullPath)
        : null;
      const classicDims =
        refsBmp && classicRenderEntry && classicRenderEntry.fullPath !== hdRenderEntry?.fullPath
          ? await dimsOf(classicRenderEntry.fullPath)
          : classicDimsFallback(classicRenderEntry?.diskName, diskDims);

      // Determine true 1x classic dimensions
      let true1x: { w: number; h: number } | null = canonical;
      if (!true1x && !isVanilla) {
        if (refsBmp && classicDims) {
          true1x = classicDims;
        } else if (diskDims) {
          true1x = diskDims;
        }
      }

      if (!true1x && diskDims && isVanilla) {
        // Unreferenced vanilla HD texture -> infer 1x by 4.5x factor
        true1x = {
          w: Math.max(1, Math.round(diskDims.w / 4.5)),
          h: Math.max(1, Math.round(diskDims.h / 4.5)),
        };
      }

      if (!true1x) continue;

      let detectedReason: SceneryFixReason | null = null;
      let reasonLabelPl = '';
      const expectedW = true1x.w;
      const expectedH = true1x.h;
      let recommended = false;

      if (p.width <= 0 || p.height <= 0) {
        detectedReason = 'invalid_zero_dims';
        reasonLabelPl = t('Zero / negative size in the PMS (the scenery is invisible or mirrored in game)');
        recommended = true;
      } else if (p.width !== true1x.w || p.height !== true1x.h) {
        // Check if this is an HD-upscaled vanilla/pack texture stored at HD dimensions in PMS
        const isHdStoredInPms =
          diskDims !== null &&
          diskDims.w >= true1x.w * 1.9 &&
          diskDims.h >= true1x.h * 1.9 &&
          Math.abs(p.width - diskDims.w) <= 1 &&
          Math.abs(p.height - diskDims.h) <= 1;

        if (isHdStoredInPms) {
          const maxAbsScale = Math.max(Math.abs(p.scaleX), Math.abs(p.scaleY));
          // If scale was NOT compensated down (~0.22 for 4.5x, ~0.125 for 8x), it's 4.5x-8x enlarged!
          if (maxAbsScale >= 0.55) {
            detectedReason = 'hd_upscale_enlarged';
            const factor = (diskDims!.w / true1x.w).toFixed(1).replace(/\.0$/, '');
            reasonLabelPl = t('HD scenery enlarged {factor}× after saving in the old PolyWorks', { factor });
            recommended = true;
          }
          // Otherwise maxAbsScale < 0.55 -> mapper intentionally scaled down HD asset in 1.7.1 PolyWorks; leave intact!
        } else {
          // Check if custom disk file is a uniform HD upscale of an already-correct 1x PMS dimension!
          const isUniformCustomHdPack =
            !canonical &&
            !isPowerOfTwo(p.width) &&
            !isPowerOfTwo(p.height) &&
            true1x.w >= p.width * 2 &&
            true1x.h >= p.height * 2 &&
            Math.abs(true1x.w / p.width - true1x.h / p.height) < 0.04;

          if (!isUniformCustomHdPack) {
            const pmsAspect = p.width / p.height;
            const trueAspect = true1x.w / true1x.h;
            const aspectDiffRatio = Math.abs(pmsAspect - trueAspect) / Math.max(pmsAspect, trueAspect);
            const isPotBug = isPowerOfTwo(p.width) && isPowerOfTwo(p.height);

            detectedReason = 'pot_or_stale';
            const sizeChange = { from: `${p.width}×${p.height}`, to: `${true1x.w}×${true1x.h}` };
            if (isPotBug && aspectDiffRatio > 0.03) {
              reasonLabelPl = t('Stretched Power-of-Two texture ({from} → {to})', sizeChange);
              recommended = true;
            } else if (isPotBug) {
              reasonLabelPl = t('Wrong Power-of-Two size from MapMaker ({from} → {to})', sizeChange);
              recommended = true;
            } else if (aspectDiffRatio > 0.03) {
              reasonLabelPl = t('Distorted scenery proportions ({from} → {to})', sizeChange);
              recommended = true;
            } else {
              reasonLabelPl = t('Size differs from the file ({from} → {to})', sizeChange);
              recommended = Math.abs(p.width - true1x.w) > 2 || Math.abs(p.height - true1x.h) > 2;
            }
          }
        }
      }

      if (!detectedReason) continue;

      const groupKey = `${scName.toLowerCase()}::${p.width}x${p.height}->${expectedW}x${expectedH}::${detectedReason}`;
      let grp = groupsMap.get(groupKey);
      if (!grp) {
        grp = {
          key: groupKey,
          sceneryName: scName,
          isVanilla,
          reason: detectedReason,
          reasonLabelPl,
          pmsWidth: p.width,
          pmsHeight: p.height,
          expectedWidth: expectedW,
          expectedHeight: expectedH,
          diskWidth: diskDims?.w ?? null,
          diskHeight: diskDims?.h ?? null,
          sampleScaleX: p.scaleX,
          sampleScaleY: p.scaleY,
          propIndices: [],
          recommended,
        };
        groupsMap.set(groupKey, grp);
      }
      grp.propIndices.push(idx);
    }

    const issues = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return b.propIndices.length - a.propIndices.length;
    });

    const affectedPropCount = issues
      .filter((i) => i.recommended)
      .reduce((acc, i) => acc + i.propIndices.length, 0);

    const unusedSceneryCount = pms.scenery.filter((s) => s.usedCount === 0).length;

    return {
      mapId,
      baseName,
      derivedBaseName: makeDerivedMapName(baseName, '_f', maxBaseLength),
      maxBaseLength,
      totalActiveProps,
      affectedPropCount,
      unusedSceneryCount,
      issues,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Generated-output registry (lets the UI tell "my previous _f/_o output" from an unrelated map)
  // ---------------------------------------------------------------------------------------------

  private registryCache: Record<string, GeneratedOutputRecord> | null = null;
  private registryFlushTimer: NodeJS.Timeout | null = null;

  /**
   * Loaded once and kept in memory; entries whose file disappeared are dropped on load.
   */
  private getRegistry(): Record<string, GeneratedOutputRecord> {
    if (this.registryCache) return this.registryCache;
    let parsed: Record<string, GeneratedOutputRecord> = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
      if (raw && typeof raw === 'object') parsed = raw;
    } catch {
      parsed = {};
    }
    for (const key of Object.keys(parsed)) {
      if (!fs.existsSync(key)) delete parsed[key];
    }
    this.registryCache = parsed;
    return parsed;
  }

  /**
   * Batched, atomic write of the registry (a 10k-map batch writes it once, not 10k times).
   */
  public flushRegistry(): void {
    if (this.registryFlushTimer) {
      clearTimeout(this.registryFlushTimer);
      this.registryFlushTimer = null;
    }
    if (!this.registryCache) return;
    try {
      fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
      writeFileAtomic(this.registryPath, Buffer.from(JSON.stringify(this.registryCache, null, 1), 'utf-8'));
    } catch {
      // Registry is a convenience only
    }
  }

  private recordGeneratedOutput(outputPath: string, bytes: Uint8Array, rec: Omit<GeneratedOutputRecord, 'crc32' | 'createdAt'>): void {
    this.getRegistry()[path.resolve(outputPath).toLowerCase()] = {
      ...rec,
      crc32: soldatCrc32(bytes),
      createdAt: Date.now(),
    };
    if (!this.registryFlushTimer) {
      this.registryFlushTimer = setTimeout(() => this.flushRegistry(), 1500);
      this.registryFlushTimer.unref?.();
    }
  }

  private getGeneratedOutputRecord(outputPath: string): GeneratedOutputRecord | null {
    const rec = this.getRegistry()[path.resolve(outputPath).toLowerCase()];
    if (!rec) return null;
    try {
      return soldatCrc32(fs.readFileSync(outputPath)) === rec.crc32 ? rec : null;
    } catch {
      return null;
    }
  }

  private isGeneratedOutputUnchanged(outputPath: string): boolean {
    return this.getGeneratedOutputRecord(outputPath) !== null;
  }

  private describeTarget(outputMapPath: string, derivedBaseName: string, sceneryDir: string | null): DerivedTargetCheck {
    const mapExists = fs.existsSync(outputMapPath);
    let existingMapTitle: string | null = null;
    let existingPngFiles: string[] = [];
    if (mapExists) {
      try {
        const old = parsePmsFull(fs.readFileSync(outputMapPath));
        existingMapTitle = old.mapName || null;
        if (sceneryDir) {
          existingPngFiles = listOwnTileFiles(old, derivedBaseName).filter((f) =>
            fs.existsSync(path.join(sceneryDir, f))
          );
        }
      } catch {
        existingMapTitle = null;
      }
    }
    return {
      derivedBaseName,
      outputMapPath,
      mapExists,
      existingMapTitle,
      existingWasGeneratedByStudio: mapExists && this.isGeneratedOutputUnchanged(outputMapPath),
      existingPngFiles,
    };
  }

  /**
   * `overwrite`: 'never' (409 if the file exists), 'own' (only replace an unchanged previous output of this
   * tool made from the same source map — used by batch runs), 'always' (explicit user confirmation).
   */
  private assertWritableTarget(
    sourcePath: string,
    outputPath: string,
    overwrite: OverwritePolicy,
    sourceMapId: string
  ): void {
    if (path.resolve(sourcePath).toLowerCase() === path.resolve(outputPath).toLowerCase()) {
      throw new WorkshopError(
        t('The output map would have the same name and folder as the source map — saving stopped so the original is not overwritten.'),
        400
      );
    }
    if (!fs.existsSync(outputPath) || overwrite === 'always') return;
    if (overwrite === 'own') {
      const rec = this.getGeneratedOutputRecord(outputPath);
      if (rec && rec.sourceMapId === sourceMapId) return;
      throw new WorkshopError(
        t('File {file} exists and is not an unchanged Studio output for this map — skipped.', {
          file: path.basename(outputPath),
        }),
        409
      );
    }
    throw new WorkshopError(
      t('File {file} already exists in the target folder. Confirm the overwrite to continue.', {
        file: path.basename(outputPath),
      }),
      409
    );
  }

  public checkFixTarget(
    mapId: string,
    maxBaseLength: number,
    destination: FixMapRequest['destination'],
    customOutputFolder?: string
  ): DerivedTargetCheck {
    const entry = this.scanner.getMapEntry(mapId);
    if (!entry) throw new WorkshopError(t('Map not found: {id}', { id: mapId }), 404);
    const derivedBaseName = makeDerivedMapName(entry.baseName, '_f', maxBaseLength || 24);
    const targetDir = this.resolveTargetMapsDir(destination, customOutputFolder, 'fixed_maps');
    return this.describeTarget(path.join(targetDir, `${derivedBaseName}.pms`), derivedBaseName, null);
  }

  /**
   * Repairs a single map's 1.7.1 stretched/enlarged sceneries and writes `<derived_f>.pms`.
   */
  public async fixMap171(
    req: FixMapRequest,
    skipRescan = false,
    overwritePolicy: OverwritePolicy = req.overwriteExisting ? 'always' : 'never'
  ): Promise<FixMapResponse> {
    const entry = this.scanner.getMapEntry(req.mapId);
    const srcPath = this.scanner.getMapFilePath(req.mapId);
    if (!entry || !srcPath || !fs.existsSync(srcPath)) {
      throw new WorkshopError(t('Source map not found: {id}', { id: req.mapId }), 404);
    }

    const origBytes = fs.readFileSync(srcPath);
    const pms = parsePmsFull(origBytes);
    const analysis = await this.analyzeParsedMap(
      req.mapId,
      entry.baseName,
      pms,
      req.maxBaseLength || 24
    );

    const derivedBaseName = makeDerivedMapName(entry.baseName, '_f', req.maxBaseLength || 24);
    const outputFileName = `${derivedBaseName}.pms`;
    const targetDir = this.resolveTargetMapsDir(req.destination, req.customOutputFolder, 'fixed_maps');
    const outputPath = path.join(targetDir, outputFileName);
    this.assertWritableTarget(srcPath, outputPath, overwritePolicy, req.mapId);

    const selectedSet = req.selectedIssueKeys
      ? new Set(req.selectedIssueKeys)
      : new Set(analysis.issues.filter((i) => i.recommended).map((i) => i.key));

    const propFixes = new Map<number, { w: number; h: number }>();
    for (const issue of analysis.issues) {
      if (!selectedSet.has(issue.key)) continue;
      for (const pIdx of issue.propIndices) {
        propFixes.set(pIdx, { w: issue.expectedWidth, h: issue.expectedHeight });
      }
    }

    let nextProps: PmsProp[] = pms.props.map((p, idx) => {
      const fix = propFixes.get(idx);
      if (!fix) return { ...p };
      return {
        ...p,
        width: fix.w,
        height: fix.h,
      };
    });

    let nextScenery: PmsSceneryDef[] = pms.scenery.map((s) => ({ ...s }));
    let removedUnusedSceneryCount = 0;

    if (req.removeUnusedScenery) {
      const cleaned = compactUnusedScenery(nextProps, nextScenery);
      nextProps = cleaned.props;
      nextScenery = cleaned.scenery;
      removedUnusedSceneryCount = cleaned.removedCount;
    }

    const patchedBytes = patchPmsPropsAndScenery(origBytes, nextProps, nextScenery);
    // Validate binary integrity before writing
    parsePmsFull(patchedBytes);

    fs.mkdirSync(targetDir, { recursive: true });
    const backup = new BackupSession(this.backupsRoot);
    backup.preserve(outputPath);
    writeFileAtomic(outputPath, patchedBytes);
    this.recordGeneratedOutput(outputPath, patchedBytes, { kind: '_f', sourceMapId: req.mapId });

    let newMapId: string | null = null;
    if (!skipRescan && req.destination === 'soldat_maps') {
      await this.scanner.scanAsync(true);
      newMapId = this.scanner.getMapEntry(derivedBaseName) ? derivedBaseName : null;
    }

    return {
      mapId: req.mapId,
      derivedBaseName,
      outputFileName,
      outputPath,
      fixedPropCount: propFixes.size,
      removedUnusedSceneryCount,
      newMapId,
      backupDir: backup.directory,
    };
  }

  /**
   * Scans a batch of candidate mapIds for 1.7.1 scenery stretch/enlargement issues.
   */
  public async scanBatchFor171Issues(
    mapIds: string[],
    maxBaseLength = 24,
    destination: FixMapRequest['destination'] = 'soldat_maps',
    customOutputFolder?: string
  ): Promise<BatchScanFixItem[]> {
    const results: BatchScanFixItem[] = [];
    const targetDir = this.resolveTargetMapsDir(destination, customOutputFolder, 'fixed_maps');

    const dimsMemo = new Map<string, { w: number; h: number } | null>();
    const derivedOwners = new Map<string, string>(); // lowercased derived name -> first map that claims it
    for (let n = 0; n < mapIds.length; n++) {
      const id = mapIds[n];
      // Cached lookups resolve synchronously, so yield regularly to keep the server responsive
      if (n % 10 === 9) await new Promise<void>((r) => setImmediate(r));
      const entry = this.scanner.getMapEntry(id);
      const fullPath = this.scanner.getMapFilePath(id);
      if (!entry || !fullPath || !fs.existsSync(fullPath)) continue;
      // Skip maps that already end with _f unless explicitly the only map
      if (/_f$/i.test(entry.baseName) && mapIds.length > 1) continue;

      try {
        const pms = parsePmsFull(fs.readFileSync(fullPath));
        const analysis = await this.analyzeParsedMap(id, entry.baseName, pms, maxBaseLength, dimsMemo);
        const recIssues = analysis.issues.filter((i) => i.recommended);
        if (recIssues.length === 0) continue;

        const siblingPath = path.join(targetDir, `${analysis.derivedBaseName}.pms`);
        // Two source maps may truncate to the same derived name (e.g. "..._v2" / "..._v3"): only the first wins
        const derivedKey = analysis.derivedBaseName.toLowerCase();
        const owner = derivedOwners.get(derivedKey);
        if (!owner) derivedOwners.set(derivedKey, entry.baseName);
        results.push({
          mapId: id,
          baseName: entry.baseName,
          modeGroupName: entry.modeGroupName,
          derivedBaseName: analysis.derivedBaseName,
          affectedPropCount: analysis.affectedPropCount,
          issueSummary: recIssues
            .slice(0, 5)
            .map((i) => `${i.sceneryName} (${i.pmsWidth}×${i.pmsHeight}→${i.expectedWidth}×${i.expectedHeight})`),
          alreadyHasFixedSibling: fs.existsSync(siblingPath),
          nameCollisionWith: owner,
        });
      } catch {
        // Ignore malformed PMS
      }
    }

    return results;
  }

  /**
   * Plans Z-order safe Scenery Layer Optimization (`Optimize Sceneries` -> `_o.pms`).
   * Preserves animated `.gif` props and optional giant skybox/fog props in exact draw order!
   */
  public async planSceneryOptimization(
    mapId: string,
    options: OptimizeMapOptions
  ): Promise<MapOptimizePlanResponse> {
    const entry = this.scanner.getMapEntry(mapId);
    const fullPath = this.scanner.getMapFilePath(mapId);
    if (!entry || !fullPath || !fs.existsSync(fullPath)) {
      throw new WorkshopError(t('Map file not found: {id}', { id: mapId }), 404);
    }

    const pms = parsePmsFull(fs.readFileSync(fullPath));
    const { fixedPms, fixes } = await this.applyFixFirst(mapId, entry.baseName, pms, options);
    return this.buildOptimizationPlanFromPms(mapId, entry.baseName, fixedPms, options, fixes).planResponse;
  }

  /**
   * `fixFirst`: applies the recommended 1.7.1 size fixes (exactly what a default `_f` repair changes) to a
   * copy of the map, so the merged layers are baked from corrected sceneries.
   */
  private async applyFixFirst(
    mapId: string,
    baseName: string,
    pms: PmsMapData,
    options: OptimizeMapOptions
  ): Promise<{ fixedPms: PmsMapData; fixes: OptimizePropFix[] }> {
    if (!options.fixFirst) return { fixedPms: pms, fixes: [] };
    const analysis = await this.analyzeParsedMap(mapId, baseName, pms, options.maxBaseLength || 24);
    const byIndex = new Map<number, OptimizePropFix>();
    for (const issue of analysis.issues) {
      if (!issue.recommended) continue;
      for (const propIndex of issue.propIndices) {
        byIndex.set(propIndex, { propIndex, width: issue.expectedWidth, height: issue.expectedHeight });
      }
    }
    if (byIndex.size === 0) return { fixedPms: pms, fixes: [] };
    const fixes = Array.from(byIndex.values()).sort((a, b) => a.propIndex - b.propIndex);
    const props = pms.props.map((p, idx) => {
      const fix = byIndex.get(idx);
      return fix ? { ...p, width: fix.width, height: fix.height } : p;
    });
    return { fixedPms: { ...pms, props }, fixes };
  }

  private buildOptimizationPlanFromPms(
    mapId: string,
    baseName: string,
    pms: PmsMapData,
    options: OptimizeMapOptions,
    appliedPropFixes: OptimizePropFix[] = []
  ): {
    planResponse: MapOptimizePlanResponse;
    preservedOrdered: Array<{ level: 0 | 1 | 2; orderKey: number; prop: PmsProp }>;
  } {
    const derivedBaseName = makeOptimizeOutputName(
      baseName,
      appliedPropFixes.length > 0,
      options.maxBaseLength || 24
    );

    const mergeEnabled: [boolean, boolean, boolean] = [
      Boolean(options.mergeBack),
      Boolean(options.mergeMid),
      Boolean(options.mergeFront),
    ];

    const supersample = clampSupersample(options.supersample);
    const maxTilePx = options.maxTilePx === 4096 ? 4096 : 2048;
    const giantLimit = Math.max(400, options.giantPropThresholdPx || 1600);

    const groups: OptimizeLayerGroupPlan[] = [];
    const preserved: OptimizePreservedPropInfo[] = [];
    const preservedOrdered: Array<{ level: 0 | 1 | 2; orderKey: number; prop: PmsProp }> = [];
    const estimatedMegapixelsBySupersample: [number, number, number, number] = [0, 0, 0, 0];

    let totalActivePropsBefore = 0;
    let mergedPropsCount = 0;
    let estimatedBakedTiles = 0;
    let orderCounter = 10;

    for (let level = 0 as 0 | 1 | 2; level <= 2; level = (level + 1) as 0 | 1 | 2) {
      let currentRun: Array<{ propIdx: number; bounds: PmsBounds; scName: string }> = [];
      let runIdxForLevel = 0;

      const flushRun = () => {
        if (currentRun.length === 0) return;
        if (currentRun.length === 1 && options.skipIsolatedSingleProps) {
          const only = currentRun[0];
          preserved.push({
            propIndex: only.propIdx,
            level,
            sceneryName: only.scName,
            reason: 'single_isolated',
          });
          preservedOrdered.push({
            level,
            orderKey: orderCounter,
            prop: { ...pms.props[only.propIdx] },
          });
          orderCounter += 10;
          currentRun = [];
          return;
        }

        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        const propIndices: number[] = [];

        for (const item of currentRun) {
          propIndices.push(item.propIdx);
          if (item.bounds.left < left) left = item.bounds.left;
          if (item.bounds.right > right) right = item.bounds.right;
          if (item.bounds.top < top) top = item.bounds.top;
          if (item.bounds.bottom > bottom) bottom = item.bounds.bottom;
        }

        // Pad by 2 world units so bilinear edge pixels never clip
        left = Math.floor(left) - 2;
        top = Math.floor(top) - 2;
        right = Math.ceil(right) + 2;
        bottom = Math.ceil(bottom) + 2;

        const width = Math.max(4, right - left);
        const height = Math.max(4, bottom - top);
        const worldBounds = { left, right, top, bottom, width, height };
        // Same tiles and cropping as the baker: a run spread over the map costs only the tiles it touches
        const propBounds = currentRun.map((item) => item.bounds);
        let tileCount = 0;
        for (let s = 1; s <= 4; s++) {
          const tiles = bakeTilesFor(worldBounds, s, maxTilePx, propBounds);
          if (!tiles) {
            // Too many tiles to bake at this quality (the baker refuses): plain upper bound
            estimatedMegapixelsBySupersample[s - 1] += (width * s * height * s) / 1e6;
            if (s === supersample) tileCount = MAX_BAKE_TILES + 1;
            continue;
          }
          for (const tile of tiles) {
            const crop = estimateTileCrop(tile, propBounds);
            if (!crop) continue;
            estimatedMegapixelsBySupersample[s - 1] += (crop.width * s * crop.height * s) / 1e6;
            if (s === supersample) tileCount++;
          }
        }

        runIdxForLevel++;
        const levelTag = level === 0 ? 'b' : level === 1 ? 'm' : 'f';
        groups.push({
          groupId: `${levelTag}${runIdxForLevel}`,
          level,
          runIndex: runIdxForLevel,
          insertOrderKey: orderCounter,
          propIndices,
          worldBounds,
          tileCount,
        });

        mergedPropsCount += propIndices.length;
        estimatedBakedTiles += tileCount;
        orderCounter += 10;
        currentRun = [];
      };

      for (let idx = 0; idx < pms.props.length; idx++) {
        const p = pms.props[idx];
        if (!isPropRenderable(p, pms.scenery.length) || p.level !== level) {
          continue;
        }
        totalActivePropsBefore++;

        const scName = pms.scenery[p.style - 1].filename || '';
        if (!mergeEnabled[level]) {
          preserved.push({
            propIndex: idx,
            level,
            sceneryName: scName,
            reason: 'layer_disabled',
          });
          preservedOrdered.push({
            level,
            orderKey: orderCounter,
            prop: { ...p },
          });
          orderCounter += 10;
          continue;
        }

        if (scName.toLowerCase().endsWith('.gif')) {
          flushRun();
          preserved.push({
            propIndex: idx,
            level,
            sceneryName: scName,
            reason: 'animated_gif',
          });
          preservedOrdered.push({
            level,
            orderKey: orderCounter,
            prop: { ...p },
          });
          orderCounter += 10;
          continue;
        }

        // Zero-size props are invisible in-game: keep them untouched (lossless) instead of baking a placeholder.
        // Their position in the draw order is irrelevant, so the current run is not split.
        if (p.width === 0 || p.height === 0) {
          preserved.push({ propIndex: idx, level, sceneryName: scName, reason: 'zero_size' });
          preservedOrdered.push({ level, orderKey: orderCounter, prop: { ...p } });
          orderCounter += 10;
          continue;
        }

        const pBounds = computePropAabb(p);
        // Garbage coordinates are never on screen either: kept untouched, without splitting the run
        if (!isPropAabbOnMap(pBounds)) {
          preserved.push({ propIndex: idx, level, sceneryName: scName, reason: 'off_map' });
          preservedOrdered.push({ level, orderKey: orderCounter, prop: { ...p } });
          orderCounter += 10;
          continue;
        }

        if (
          options.preserveGiantProps &&
          (pBounds.width > giantLimit || pBounds.height > giantLimit)
        ) {
          flushRun();
          preserved.push({
            propIndex: idx,
            level,
            sceneryName: scName,
            reason: 'giant_skybox',
          });
          preservedOrdered.push({
            level,
            orderKey: orderCounter,
            prop: { ...p },
          });
          orderCounter += 10;
          continue;
        }

        currentRun.push({ propIdx: idx, bounds: pBounds, scName });
      }

      flushRun();
    }

    // Same ordering rule as commitOptimizeSession (level, then shared order counter)
    const layout = [
      ...preservedOrdered.map((po) => ({ level: po.level, orderKey: po.orderKey, propIndex: po.prop.index })),
      ...groups.map((g) => ({ level: g.level, orderKey: g.insertOrderKey, groupId: g.groupId })),
    ]
      .sort((a, b) => a.level - b.level || a.orderKey - b.orderKey)
      .map(({ orderKey: _orderKey, ...rest }) => rest);

    return {
      planResponse: {
        mapId,
        baseName,
        derivedBaseName,
        totalActivePropsBefore,
        mergedPropsCount,
        preservedPropsCount: preserved.length,
        estimatedTotalPropsAfter: preserved.length + estimatedBakedTiles,
        groups,
        preservedSample: preserved.slice(0, 60),
        estimatedMegapixelsBySupersample: estimatedMegapixelsBySupersample.map(
          (v) => Math.round(v * 100) / 100
        ) as [number, number, number, number],
        layout,
        appliedPropFixes,
      },
      preservedOrdered,
    };
  }

  public async checkOptimizeTarget(mapId: string, options: OptimizeMapOptions): Promise<DerivedTargetCheck> {
    const entry = this.scanner.getMapEntry(mapId);
    if (!entry) throw new WorkshopError(t('Map not found: {id}', { id: mapId }), 404);
    let fixesApplied = false;
    if (options.fixFirst) {
      const srcPath = this.scanner.getMapFilePath(mapId);
      if (srcPath && fs.existsSync(srcPath)) {
        const pms = parsePmsFull(fs.readFileSync(srcPath));
        fixesApplied = (await this.applyFixFirst(mapId, entry.baseName, pms, options)).fixes.length > 0;
      }
    }
    const derivedBaseName = makeOptimizeOutputName(entry.baseName, fixesApplied, options.maxBaseLength || 24);
    const { mapsDir, sceneryDir } = this.resolveTargetOptimizeDirs(
      options.destination,
      options.customOutputFolder
    );
    return this.describeTarget(path.join(mapsDir, `${derivedBaseName}.pms`), derivedBaseName, sceneryDir);
  }

  // ---------------------------------------------------------------------------------------------
  // Optimize upload sessions: tiles arrive one binary request at a time, then commit writes everything
  // ---------------------------------------------------------------------------------------------

  private pruneStaleSessions(): void {
    const now = Date.now();
    for (const s of this.optimizeSessions.values()) {
      if (!s.committing && now - s.lastActivity > OPTIMIZE_SESSION_TTL_MS) this.cancelOptimizeSession(s.id);
    }
  }

  public startOptimizeSession(mapId: string, options: OptimizeMapOptions): string {
    this.pruneStaleSessions();
    if (!this.scanner.getMapEntry(mapId)) {
      throw new WorkshopError(t('Source map not found: {id}', { id: mapId }), 404);
    }
    const id = crypto.randomUUID();
    const tempDir = path.join(this.sessionsRoot, id);
    fs.mkdirSync(tempDir, { recursive: true });
    const now = Date.now();
    this.optimizeSessions.set(id, { id, mapId, options, tempDir, tiles: [], createdAt: now, lastActivity: now, committing: false });
    return id;
  }

  public async addOptimizeTile(sessionId: string, rawMeta: unknown, png: Buffer): Promise<void> {
    const session = this.optimizeSessions.get(sessionId);
    if (!session || session.committing) {
      throw new WorkshopError(t('The optimization session has expired or does not exist.'), 404);
    }
    session.lastActivity = Date.now();
    if (!Buffer.isBuffer(png) || png.length < 8) throw new WorkshopError(t('Empty tile PNG file.'), 400);

    const meta = rawMeta as Partial<BakedSceneryTileUpload>;
    const level = Number(meta.level);
    const nums = [meta.worldX, meta.worldY, meta.scaleX, meta.scaleY, meta.insertOrderKey].map(Number);
    if (![0, 1, 2].includes(level) || nums.some((n) => !Number.isFinite(n)) || Number(meta.scaleX) <= 0 || Number(meta.scaleY) <= 0) {
      throw new WorkshopError(t('Invalid layer tile metadata.'), 400);
    }

    // Width/height must match the real PNG, otherwise Soldat would stretch the tile
    const pngMeta = await sharp(png).metadata();
    if (pngMeta.format !== 'png' || !pngMeta.width || !pngMeta.height) {
      throw new WorkshopError(t('The uploaded tile is not a valid PNG file.'), 400);
    }

    let fileName = sanitizeSceneryPngName(String(meta.tileFileName || 'layer.png'));
    const taken = new Set(session.tiles.map((t) => t.tileFileName.toLowerCase()));
    for (let n = 2; taken.has(fileName.toLowerCase()); n++) {
      fileName = sanitizeSceneryPngName(`${fileName.replace(/\.png$/i, '').slice(0, 40)}_${n}.png`);
    }

    const tempPath = path.join(session.tempDir, `${session.tiles.length}.png`);
    fs.writeFileSync(tempPath, png);
    session.tiles.push({
      tileFileName: fileName,
      level: level as 0 | 1 | 2,
      insertOrderKey: Number(meta.insertOrderKey),
      worldX: Number(meta.worldX),
      worldY: Number(meta.worldY),
      pngWidth: pngMeta.width,
      pngHeight: pngMeta.height,
      scaleX: Number(meta.scaleX),
      scaleY: Number(meta.scaleY),
      floatPrecision: Boolean(meta.floatPrecision),
      tempPath,
    });
  }

  public cancelOptimizeSession(sessionId: string): void {
    const session = this.optimizeSessions.get(sessionId);
    if (!session) return;
    this.optimizeSessions.delete(sessionId);
    try {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  /**
   * Writes the baked composite scenery PNGs + rewritten `<derived_o>.pms` map.
   */
  public async commitOptimizeSession(
    sessionId: string,
    overwrite: OverwritePolicy,
    skipRescan = false,
    expected?: { derivedBaseName: string; propFixes: OptimizePropFix[] }
  ): Promise<OptimizeSaveResponse> {
    const session = this.optimizeSessions.get(sessionId);
    if (!session || session.committing) {
      throw new WorkshopError(t('The optimization session has expired or does not exist.'), 404);
    }
    session.committing = true;

    try {
      const { mapId, options } = session;
      const entry = this.scanner.getMapEntry(mapId);
      const srcPath = this.scanner.getMapFilePath(mapId);
      if (!entry || !srcPath || !fs.existsSync(srcPath)) {
        throw new WorkshopError(t('Source map not found: {id}', { id: mapId }), 404);
      }

      const origBytes = fs.readFileSync(srcPath);
      const sourcePms = parsePmsFull(origBytes);
      // Same fixes as the plan the client baked from (props keep their corrected sizes in the result)
      const { fixedPms: pms, fixes } = await this.applyFixFirst(mapId, entry.baseName, sourcePms, options);
      const { planResponse: plan, preservedOrdered } = this.buildOptimizationPlanFromPms(
        mapId,
        entry.baseName,
        pms,
        options,
        fixes
      );
      // The tiles were baked (and the overwrite confirmed) for the client's plan: a map or scenery image
      // changed since then would give a different name or different fixes — refuse instead of guessing
      if (
        expected &&
        (expected.derivedBaseName !== plan.derivedBaseName ||
          JSON.stringify(expected.propFixes.map((f) => [f.propIndex, f.width, f.height])) !==
            JSON.stringify(fixes.map((f) => [f.propIndex, f.width, f.height])))
      ) {
        throw new WorkshopError(
          t('The map or its sceneries changed since the plan was prepared — prepare the preview or plan again.'),
          409
        );
      }

      const { mapsDir, sceneryDir } = this.resolveTargetOptimizeDirs(
        options.destination,
        options.customOutputFolder
      );
      const outputMapPath = path.join(mapsDir, `${plan.derivedBaseName}.pms`);
      this.assertWritableTarget(srcPath, outputMapPath, overwrite, mapId);

      // A tile name colliding with a scenery file the source map itself uses would corrupt the source map
      const sourceSceneryLower = new Set(pms.scenery.map((s) => s.filename.toLowerCase()));
      for (const tile of session.tiles) {
        if (sourceSceneryLower.has(tile.tileFileName.toLowerCase())) {
          throw new WorkshopError(
            t('Tile name {name} collides with the sceneries of the source map.', { name: tile.tileFileName }),
            400
          );
        }
      }

      // Tiles of the previous `_o` version that this run does not regenerate become orphans -> remove them
      let previousOwnTiles: string[] = [];
      if (fs.existsSync(outputMapPath)) {
        try {
          previousOwnTiles = listOwnTileFiles(parsePmsFull(fs.readFileSync(outputMapPath)), plan.derivedBaseName);
        } catch {
          previousOwnTiles = [];
        }
      }

      // Phase 1 — prepare everything in memory (nothing on disk changes if any of this fails)
      let nextScenery: PmsSceneryDef[] = pms.scenery.map((s) => ({ ...s }));
      const dosNow = currentDosTimestamp();
      const generatedPngFiles: string[] = [];
      const preparedPngs: Buffer[] = [];
      let totalPngBytes = 0;

      const combinedItems: Array<{ level: number; orderKey: number; subIdx: number; prop: PmsProp }> =
        preservedOrdered.map((po, i) => ({
          level: po.level,
          orderKey: po.orderKey,
          subIdx: i,
          prop: po.prop,
        }));

      for (let tIdx = 0; tIdx < session.tiles.length; tIdx++) {
        const tile = session.tiles[tIdx];
        const optimizedPng = await sharp(fs.readFileSync(tile.tempPath))
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toBuffer();
        preparedPngs.push(optimizedPng);
        generatedPngFiles.push(tile.tileFileName);
        totalPngBytes += optimizedPng.byteLength;

        const styleIndex = nextScenery.length + 1;
        nextScenery.push({
          index: styleIndex,
          filename: tile.tileFileName,
          date: dosNow,
          usedCount: 1,
        });

        combinedItems.push({
          level: tile.level,
          orderKey: tile.insertOrderKey,
          subIdx: 10000 + tIdx,
          prop: {
            index: 0,
            active: true,
            style: styleIndex,
            width: tile.pngWidth,
            height: tile.pngHeight,
            x: tile.worldX,
            y: tile.worldY,
            rotation: 0,
            scaleX: tile.scaleX,
            scaleY: tile.scaleY,
            alpha: 255,
            color: { r: 255, g: 255, b: 255, a: 255 },
            level: tile.level,
          },
        });
      }

      combinedItems.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        if (a.orderKey !== b.orderKey) return a.orderKey - b.orderKey;
        return a.subIdx - b.subIdx;
      });

      let nextProps: PmsProp[] = combinedItems.map((item, i) => ({
        ...item.prop,
        index: i,
      }));

      if (options.removeUnusedScenery) {
        const cleaned = compactUnusedScenery(nextProps, nextScenery);
        nextProps = cleaned.props;
        nextScenery = cleaned.scenery;
      }

      const patchedBytes = patchPmsPropsAndScenery(origBytes, nextProps, nextScenery);
      parsePmsFull(patchedBytes);

      // Refuse a result the game would reject when the source map itself was loadable for that limit
      const sourceViolations = checkSoldatMapLimits({
        polygonCount: pms.polygons.length,
        sectorsNum: pms.sectorsNum,
        propCount: pms.props.length,
        sceneryCount: pms.scenery.length,
        colliderCount: pms.colliders.length,
        spawnCount: pms.spawnpoints.length,
      });
      const limitViolations = checkSoldatMapLimits({
        polygonCount: pms.polygons.length,
        sectorsNum: pms.sectorsNum,
        propCount: nextProps.length,
        sceneryCount: nextScenery.length,
        colliderCount: pms.colliders.length,
        spawnCount: pms.spawnpoints.length,
      });
      const introduced = limitViolations.filter((v) => {
        const before = sourceViolations.find((sv) => sv.key === v.key);
        return !before || v.value > before.value;
      });
      if (introduced.length > 0) {
        throw new WorkshopError(
          t(
            'The result would exceed the Soldat engine limits ({limits}) — the game would not load the map. ' +
              'Enable removal of unused sceneries or reduce the number of tiles (larger tile / lower quality).',
            { limits: introduced.map((v) => `${t(v.label)}: ${v.value} > ${v.limit}`).join(', ') }
          ),
          400
        );
      }

      // Phase 2 — stage tiles next to their final location (same volume, so the final rename is atomic)
      fs.mkdirSync(mapsDir, { recursive: true });
      fs.mkdirSync(sceneryDir, { recursive: true });
      const stagedPaths: string[] = [];
      try {
        for (let i = 0; i < preparedPngs.length; i++) {
          const staged = path.join(sceneryDir, `${generatedPngFiles[i]}.${session.id}.staged`);
          fs.writeFileSync(staged, preparedPngs[i]);
          stagedPaths.push(staged);
        }
      } catch (err) {
        for (const staged of stagedPaths) {
          try {
            fs.rmSync(staged, { force: true });
          } catch {
            // Ignore
          }
        }
        throw err;
      }

      // Phase 3 — back up what gets replaced, then swap tiles and finally the map itself
      const backup = new BackupSession(this.backupsRoot);
      for (let i = 0; i < stagedPaths.length; i++) {
        const finalPath = path.join(sceneryDir, generatedPngFiles[i]);
        backup.preserve(finalPath);
        fs.renameSync(stagedPaths[i], finalPath);
      }
      backup.preserve(outputMapPath);
      writeFileAtomic(outputMapPath, patchedBytes);
      this.recordGeneratedOutput(outputMapPath, patchedBytes, { kind: '_o', sourceMapId: mapId });

      const regenerated = new Set(generatedPngFiles.map((f) => f.toLowerCase()));
      let removedOrphanPngs = 0;
      for (const oldTile of previousOwnTiles) {
        if (regenerated.has(oldTile.toLowerCase())) continue;
        const oldTilePath = path.join(sceneryDir, oldTile);
        if (!fs.existsSync(oldTilePath)) continue;
        try {
          backup.preserve(oldTilePath);
          fs.rmSync(oldTilePath, { force: true });
          removedOrphanPngs++;
        } catch {
          // Ignore
        }
      }

      let newMapId: string | null = null;
      if (!skipRescan && options.destination === 'soldat_maps') {
        await this.scanner.scanAsync(true);
        newMapId = this.scanner.getMapEntry(plan.derivedBaseName) ? plan.derivedBaseName : null;
      }

      return {
        derivedBaseName: plan.derivedBaseName,
        outputMapPath,
        sceneryDirPath: sceneryDir,
        generatedPngFiles,
        propsBefore: plan.totalActivePropsBefore,
        propsAfter: nextProps.length,
        totalPngBytes,
        newMapId,
        removedOrphanPngs,
        floatPrecision: session.tiles.length > 0 && session.tiles.every((t) => t.floatPrecision),
        limitWarnings: limitViolations.map((v) => `${t(v.label)}: ${v.value} > ${v.limit}`),
        backupDir: backup.directory,
      };
    } finally {
      this.cancelOptimizeSession(sessionId);
    }
  }

  private resolveTargetMapsDir(
    destination: 'soldat_maps' | 'exports_fixed' | 'custom',
    customFolder: string | undefined,
    defaultExportSub: string
  ): string {
    if (destination === 'soldat_maps') {
      return path.join(this.scanner.getResolver().getRoot(), 'maps');
    }
    if (destination === 'custom') {
      if (!customFolder?.trim()) {
        throw new WorkshopError(t('Choose a custom target folder or change the save location.'), 400);
      }
      return path.resolve(customFolder.trim());
    }
    return path.join(this.exportsRoot, defaultExportSub, 'maps');
  }

  private resolveTargetOptimizeDirs(
    destination: 'soldat_maps' | 'exports_optimized' | 'custom',
    customFolder: string | undefined
  ): { mapsDir: string; sceneryDir: string } {
    if (destination === 'soldat_maps') {
      const root = this.scanner.getResolver().getRoot();
      return {
        mapsDir: path.join(root, 'maps'),
        sceneryDir: path.join(root, 'scenery-gfx'),
      };
    }
    if (destination === 'custom' && !customFolder?.trim()) {
      throw new WorkshopError(t('Choose a custom target folder or change the save location.'), 400);
    }
    const base =
      destination === 'custom'
        ? path.resolve(customFolder!.trim())
        : path.join(this.exportsRoot, 'optimized_maps');
    return {
      mapsDir: path.join(base, 'maps'),
      sceneryDir: path.join(base, 'scenery-gfx'),
    };
  }
}

function clampSupersample(raw: unknown): number {
  const n = Math.round(Number(raw) || 2);
  return Math.max(1, Math.min(4, n));
}

function classicDimsFallback(
  diskName: string | undefined,
  diskDims: { w: number; h: number } | null
): { w: number; h: number } | null {
  if (diskName && diskName.toLowerCase().endsWith('.bmp')) {
    return diskDims;
  }
  return null;
}

/**
 * Scenery entries of a previously generated `_o` map that follow this tool's tile naming
 * (`<derived>_b1.png`, `<derived>_m3.png`, ...). Only those files are ever considered for cleanup.
 */
function listOwnTileFiles(map: PmsMapData, derivedBaseName: string): string[] {
  const stem = derivedBaseName.slice(0, 38).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${stem}_[bmf]\\d+(_\\d+)?\\.png$`, 'i');
  return map.scenery.map((s) => s.filename).filter((f) => pattern.test(f));
}

function compactUnusedScenery(
  props: PmsProp[],
  scenery: PmsSceneryDef[]
): { props: PmsProp[]; scenery: PmsSceneryDef[]; removedCount: number } {
  const usedOldIndices = new Set<number>();
  for (const p of props) {
    if (isPropRenderable(p, scenery.length)) {
      usedOldIndices.add(p.style);
    }
  }

  const oldToNewStyle = new Map<number, number>();
  const keptScenery: PmsSceneryDef[] = [];

  for (let i = 0; i < scenery.length; i++) {
    const oldStyle = i + 1;
    if (usedOldIndices.has(oldStyle)) {
      const newStyle = keptScenery.length + 1;
      oldToNewStyle.set(oldStyle, newStyle);
      keptScenery.push({
        ...scenery[i],
        index: newStyle,
      });
    }
  }

  // Inactive / invalid-level props are invisible in-game and would point at removed entries -> dropped too
  const remappedProps: PmsProp[] = [];
  for (const p of props) {
    if (!p.active || p.level > 2) continue;
    const mapped = oldToNewStyle.get(p.style);
    if (!mapped) continue;
    remappedProps.push({
      ...p,
      index: remappedProps.length,
      style: mapped,
    });
  }

  return {
    props: remappedProps,
    scenery: keptScenery,
    removedCount: Math.max(0, scenery.length - keptScenery.length),
  };
}

function sanitizeSceneryPngName(raw: string): string {
  const base = path
    .basename(raw || 'layer.png')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const withoutExt = base.replace(/\.png$/i, '');
  const clamped = withoutExt.slice(0, 45) || 'layer';
  return `${clamped}.png`;
}

/**
 * Writes via a temporary sibling file + rename so a crash never leaves a half-written map or PNG.
 */
function writeFileAtomic(targetPath: string, data: Uint8Array): void {
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, data); // inside the try: a failed write (disk full) must not leave the .tmp behind
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Ignore
    }
    throw err;
  }
}
