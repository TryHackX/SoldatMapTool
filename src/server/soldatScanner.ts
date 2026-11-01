import fs from 'fs';
import path from 'path';
import {
  ExtraMapSource,
  IndexMetaResponse,
  MapCompactEntry,
  MapIndexEntry,
  MapQueryRequest,
  MapQueryResponse,
  ModeGroupCountItem,
  PrefixCountItem,
  ScanProgressStatus,
  SourceCountItem,
  SubprefixCountItem,
  UserTagCount,
} from '../shared/apiTypes';
import { checkSoldatMapLimits, parsePmsSummary, PmsSummaryData, soldatCrc32 } from '../shared/pmsParser';
import {
  BUILTIN_MODE_GROUPS,
  createMapClassifier,
  CustomPrefixRule,
} from '../shared/prefixUtils';
import { compareNumber, parseSearchQuery, SearchNumericField, SearchTerm } from '../shared/searchQuery';
import { SoldatAssetResolver } from './assetResolver';
import { MapSqliteCache } from './mapDatabase';
import { UserDataStore } from './userDataStore';

interface InternalIndexedMap {
  compact: MapCompactEntry;
  full: MapIndexEntry;
  searchHaystack: string; // Pre-lowercased baseName + title + texture + active sceneries for ~3ms search on 50k maps
  // Pre-lowercased fields for the `key:value` search syntax
  nameLower: string;
  titleLower: string;
  textureLower: string;
  sceneryLower: string; // active scenery names joined with newlines
}

interface DiscoveredPmsFile {
  sourceId: string;
  sourceLabel: string;
  rootDir: string;
  fullPath: string;
  relNoExt: string;
  fileName: string;
  baseName: string;
}

// One shared collator: localeCompare(…, options) per comparison is ~25x slower on 50k names
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Placeholder summary for a .pms file that cannot be parsed, so it still shows up in the index
 * (category "Nie wczytają się w grze") instead of silently disappearing.
 */
function unreadableSummary(message: string, crc32: number): PmsSummaryData {
  const bounds = { left: -320, right: 320, top: -240, bottom: 240, width: 640, height: 480 };
  const black = { r: 0, g: 0, b: 0, a: 255 };
  return {
    version: 0,
    mapName: '',
    texture: '',
    bgColorTop: black,
    bgColorBtm: black,
    startJet: 0,
    startJetGame: 0,
    grenadePacks: 0,
    medikits: 0,
    weather: 0,
    steps: 0,
    randomId: 0,
    sectorsDivision: 0,
    sectorsNum: 0,
    polygonCount: 0,
    polyTypeCounts: {},
    propCount: 0,
    activePropCount: 0,
    propLevelCounts: [0, 0, 0],
    scenery: [],
    colliderCount: 0,
    activeColliderCount: 0,
    spawnCount: 0,
    activeSpawnCount: 0,
    spawnTeamCounts: {},
    waypointCount: 0,
    activeWaypointCount: 0,
    polyBounds: bounds,
    fullBounds: bounds,
    crc32,
    parseWarnings: [`Nie można odczytać pliku PMS: ${message}`],
  };
}

/** Identity of a map file for duplicate detection: same OpenSoldat CRC32 and size. CRC 0 = the file could not be read. */
export function duplicateIdentityKey(crc32: number, fileSize: number): string | null {
  const crc = crc32 >>> 0;
  return crc === 0 ? null : `${crc}:${fileSize}`;
}

function toCompact(entry: MapIndexEntry): MapCompactEntry {
  return {
    id: entry.id,
    fileName: entry.fileName,
    baseName: entry.baseName,
    sourceId: entry.sourceId,
    sourceLabel: entry.sourceLabel,
    prefix: entry.prefix,
    subprefix: entry.subprefix,
    modeGroupId: entry.modeGroupId,
    modeGroupName: entry.modeGroupName,
    badgeColor: entry.badgeColor,
    fileSize: entry.fileSize,
    mtimeMs: entry.mtimeMs,
    isVanillaMap: entry.isVanillaMap,
    isPureVanilla: entry.isPureVanilla,
    hasCustomAssets: entry.hasCustomAssets,
    missingAssetsCount: entry.missingAssetsCount,
    caseMismatchCount: entry.caseMismatchCount,
    unusedSceneryCount: entry.unusedSceneryCount,
    customAssetsCount: entry.customAssetsCount,
    duplicateCount: entry.duplicateCount,
    hasThumbnail: entry.hasThumbnail,
    limitViolationCount: entry.limitViolationCount,
    parseWarningCount: entry.parseWarningCount,
    title: entry.title,
    texture: entry.texture,
    bgColorTop: entry.bgColorTop,
    bgColorBtm: entry.bgColorBtm,
    weather: entry.weather,
    steps: entry.steps,
    startJet: entry.startJet,
    startJetGame: entry.startJetGame,
    grenadePacks: entry.grenadePacks,
    medikits: entry.medikits,
    polygonCount: entry.polygonCount,
    activePropCount: entry.activePropCount,
    activeColliderCount: entry.activeColliderCount,
    activeSpawnCount: entry.activeSpawnCount,
    activeWaypointCount: entry.activeWaypointCount,
    polyWidth: entry.polyWidth,
    polyHeight: entry.polyHeight,
    polyBounds: entry.polyBounds,
    fullBounds: entry.fullBounds,
    crc32: entry.crc32,
  };
}

export class SoldatMapScanner {
  private soldatPath: string;
  private extraSources: ExtraMapSource[];
  private customRules: CustomPrefixRule[];
  private thumbDir: string;
  private sqliteCache: MapSqliteCache;
  private resolver: SoldatAssetResolver;

  private memorySummaryCache = new Map<
    string,
    { mtimeMs: number; fileSize: number; summary: PmsSummaryData }
  >();
  private existingThumbs = new Set<string>(); // hex crc32 lowercase

  private indexedById = new Map<string, InternalIndexedMap>();
  private itemsByCrcHex = new Map<string, InternalIndexedMap[]>();
  private defaultSortedList: InternalIndexedMap[] = [];
  private cachedMeta: IndexMetaResponse | null = null;
  private userData: UserDataStore | null = null;
  private duplicateGroups: MapIndexEntry[][] = [];
  private activeScanPromise: Promise<IndexMetaResponse> | null = null;
  private followUpScanPromise: Promise<IndexMetaResponse> | null = null;
  private pendingForceReload = false;

  private scanStatus: ScanProgressStatus = {
    scanning: false,
    phase: 'idle',
    scannedFiles: 0,
    totalFiles: 0,
    cachedHits: 0,
    parsedFiles: 0,
    failedFiles: 0,
    currentFile: '',
    mapsPerSec: 0,
    startedAt: 0,
    durationMs: 0,
  };

  constructor(
    soldatPath: string,
    extraSources: ExtraMapSource[],
    customRules: CustomPrefixRule[],
    cacheDir: string,
    thumbDir: string
  ) {
    this.soldatPath = soldatPath;
    this.extraSources = extraSources;
    this.customRules = customRules;
    this.thumbDir = thumbDir;
    this.sqliteCache = new MapSqliteCache(cacheDir);
    this.resolver = new SoldatAssetResolver(soldatPath, extraSources);
    this.memorySummaryCache = this.sqliteCache.loadAllCachedSummaries();
    this.refreshExistingThumbsSet();
  }

  public getResolver(): SoldatAssetResolver {
    return this.resolver;
  }

  public getSoldatPath(): string {
    return this.soldatPath;
  }

  public getExtraSources(): ExtraMapSource[] {
    return this.extraSources;
  }

  public getCustomRules(): CustomPrefixRule[] {
    return this.customRules;
  }

  public getScanStatus(): ScanProgressStatus {
    return { ...this.scanStatus };
  }

  public markThumbnailCached(hexCrc: string): void {
    const clean = hexCrc.toLowerCase();
    this.existingThumbs.add(clean);
    for (const item of this.itemsByCrcHex.get(clean) ?? []) {
      item.compact.hasThumbnail = true;
      item.full.hasThumbnail = true;
    }
  }

  private refreshExistingThumbsSet(): void {
    this.existingThumbs.clear();
    if (!fs.existsSync(this.thumbDir)) return;
    try {
      const files = fs.readdirSync(this.thumbDir);
      for (const f of files) {
        if (f.toLowerCase().endsWith('.webp')) {
          this.existingThumbs.add(f.slice(0, -5).toLowerCase());
        }
      }
    } catch {
      // Ignore
    }
  }

  public updateConfig(soldatPath: string, extraSources: ExtraMapSource[]): void {
    this.soldatPath = soldatPath;
    this.extraSources = extraSources;
    this.resolver.updateSources(soldatPath, extraSources);
  }

  /**
   * Lowercased root folders (with trailing separator) that a scan walks right now.
   */
  private getScannedRootKeys(): string[] {
    const roots = [path.join(this.soldatPath, 'maps'), path.join(this.soldatPath, 'downloads', 'maps')];
    for (const src of this.extraSources) {
      if (src.enabled && src.path && fs.existsSync(src.path)) roots.push(src.path);
    }
    return roots.map((r) => {
      const abs = path.resolve(r).toLowerCase();
      return abs.endsWith(path.sep) ? abs : abs + path.sep;
    });
  }

  private applyClassification(
    list: InternalIndexedMap[],
    classifier: ReturnType<typeof createMapClassifier>
  ): void {
    for (const item of list) {
      const cls = classifier.classify(item.full.baseName);
      item.full.prefix = cls.prefix;
      item.full.subprefix = cls.subprefix;
      item.full.modeGroupId = cls.modeGroupId;
      item.full.modeGroupName = cls.modeGroupName;
      item.full.badgeColor = cls.badgeColor;

      item.compact.prefix = cls.prefix;
      item.compact.subprefix = cls.subprefix;
      item.compact.modeGroupId = cls.modeGroupId;
      item.compact.modeGroupName = cls.modeGroupName;
      item.compact.badgeColor = cls.badgeColor;
    }
  }

  /**
   * Re-classifies all indexed maps in RAM in ~10ms when user creates/edits custom prefixes!
   * Zero disk I/O required!
   */
  public updateCustomRules(customRules: CustomPrefixRule[]): IndexMetaResponse {
    const classifier = createMapClassifier(customRules);
    this.customRules = customRules;
    this.applyClassification(this.defaultSortedList, classifier);
    this.cachedMeta = this.buildMetaSnapshot(this.scanStatus.durationMs);
    return this.cachedMeta;
  }

  public getMapFilePath(mapId: string): string | null {
    return this.indexedById.get(mapId)?.full.fullPath ?? null;
  }

  public getMapEntry(mapId: string): MapIndexEntry | null {
    return this.indexedById.get(mapId)?.full ?? null;
  }

  /** Every indexed map (scan order) */
  public getAllEntries(): MapIndexEntry[] {
    return this.defaultSortedList.map((x) => x.full);
  }

  /** Groups of maps with identical content (same OpenSoldat CRC32 and size), two or more files each */
  public getDuplicateEntryGroups(): MapIndexEntry[][] {
    return this.duplicateGroups;
  }

  /** True once the first scan finished and no scan is running (library tools need a current index) */
  public isIndexReady(): boolean {
    return this.cachedMeta !== null && !this.scanStatus.scanning;
  }

  /** Map details for the client: the scanned entry plus favourite / tags */
  public getMapEntryWithUserData(mapId: string): MapIndexEntry | null {
    const entry = this.getMapEntry(mapId);
    return entry ? this.withUserData(entry) : null;
  }

  public setUserDataStore(store: UserDataStore): void {
    this.userData = store;
  }

  /** Favourite count and tag cloud of maps that are currently indexed */
  public getUserDataSummary(): { favoriteMapsCount: number; userTags: UserTagCount[] } {
    let favoriteMapsCount = 0;
    const tagCounts = new Map<string, UserTagCount>();
    for (const [mapId, data] of this.userData?.entriesList() ?? []) {
      if (!this.indexedById.has(mapId)) continue;
      if (data.favorite) favoriteMapsCount++;
      for (const tag of data.tags ?? []) {
        const key = tag.toLowerCase();
        const hit = tagCounts.get(key);
        if (hit) hit.count++;
        else tagCounts.set(key, { tag, count: 1 });
      }
    }
    const userTags = Array.from(tagCounts.values()).sort(
      (a, b) => b.count - a.count || NAME_COLLATOR.compare(a.tag, b.tag)
    );
    return { favoriteMapsCount, userTags };
  }

  private withUserData<T extends MapCompactEntry>(entry: T): T {
    const data = this.userData?.get(entry.id);
    if (!data) return entry;
    return { ...entry, favorite: Boolean(data.favorite), tags: data.tags ?? [] };
  }

  public getMeta(): IndexMetaResponse {
    if (this.cachedMeta) {
      return {
        ...this.cachedMeta,
        ...this.getUserDataSummary(),
        scanStatus: { ...this.scanStatus },
      };
    }
    return this.buildMetaSnapshot(0);
  }

  /**
   * Discovers .pms files across Soldat maps/, Soldat downloads/maps/, and all extra sources
   * (with optional subfolder recursion up to depth 8 for massive 50,000+ map archives).
   */
  private discoverAllPmsFiles(): DiscoveredPmsFile[] {
    const discovered: DiscoveredPmsFile[] = [];
    const seenPaths = new Set<string>();

    const walkDir = (
      sourceId: string,
      sourceLabel: string,
      rootDir: string,
      currentDir: string,
      recursive: boolean,
      depth: number
    ) => {
      if (depth > 8) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isFile()) {
          if (!entry.name.toLowerCase().endsWith('.pms')) continue;
          const fullPath = path.join(currentDir, entry.name);
          const normKey = fullPath.toLowerCase();
          if (seenPaths.has(normKey)) continue;
          seenPaths.add(normKey);

          const baseName = entry.name.slice(0, -4);
          const relFromRoot = path.relative(rootDir, fullPath).replace(/\\/g, '/').slice(0, -4);
          discovered.push({
            sourceId,
            sourceLabel,
            rootDir,
            fullPath,
            relNoExt: relFromRoot,
            fileName: entry.name,
            baseName,
          });
        } else if (recursive && entry.isDirectory()) {
          const lowerDir = entry.name.toLowerCase();
          if (
            lowerDir === 'node_modules' ||
            lowerDir === '.git' ||
            lowerDir === 'scenery-gfx' ||
            lowerDir === 'textures' ||
            lowerDir === 'sfx' ||
            lowerDir === 'anims' ||
            lowerDir === 'bots'
          ) {
            continue;
          }
          walkDir(
            sourceId,
            sourceLabel,
            rootDir,
            path.join(currentDir, entry.name),
            true,
            depth + 1
          );
        }
      }
    };

    const mainMapsDir = path.join(this.soldatPath, 'maps');
    if (fs.existsSync(mainMapsDir)) {
      walkDir('soldat', 'Soldat (Główny)', mainMapsDir, mainMapsDir, false, 0);
    }

    const dlMapsDir = path.join(this.soldatPath, 'downloads', 'maps');
    if (fs.existsSync(dlMapsDir)) {
      walkDir('soldat_dl', 'Soldat (Downloads)', dlMapsDir, dlMapsDir, true, 0);
    }

    for (const src of this.extraSources) {
      if (!src.enabled || !src.path || !fs.existsSync(src.path)) continue;
      // If user pointed at a parent Soldat root that contains maps/, scan from its root if recursive or maps/
      walkDir(
        src.id,
        src.label || path.basename(src.path) || src.path,
        src.path,
        src.path,
        src.recursive !== false,
        0
      );
    }

    return discovered;
  }

  /**
   * Asynchronous, non-blocking chunked scanner capable of indexing 50,000+ maps
   * with live progress reporting and transactional SQLite WAL persistence.
   *
   * When a scan is already running, exactly one follow-up scan is queued and its promise returned,
   * so a caller that just wrote a new map (e.g. `_f` / `_o`) always gets an index that contains it.
   */
  public scanAsync(forceReloadAssets = false): Promise<IndexMetaResponse> {
    if (this.followUpScanPromise) {
      this.pendingForceReload ||= forceReloadAssets;
      return this.followUpScanPromise;
    }
    if (this.activeScanPromise) {
      this.pendingForceReload ||= forceReloadAssets;
      this.followUpScanPromise = this.activeScanPromise
        .catch(() => undefined)
        .then(() => {
          const force = this.pendingForceReload;
          this.pendingForceReload = false;
          this.followUpScanPromise = null;
          return this.startScan(force);
        });
      return this.followUpScanPromise;
    }
    return this.startScan(forceReloadAssets);
  }

  private startScan(forceReloadAssets: boolean): Promise<IndexMetaResponse> {
    const promise: Promise<IndexMetaResponse> = this.runScan(forceReloadAssets).finally(() => {
      if (this.activeScanPromise === promise) this.activeScanPromise = null;
    });
    this.activeScanPromise = promise;
    return promise;
  }

  private async runScan(forceReloadAssets: boolean): Promise<IndexMetaResponse> {
    {
      const t0 = performance.now();
      this.scanStatus = {
        scanning: true,
        phase: 'discovering',
        scannedFiles: 0,
        totalFiles: 0,
        cachedHits: 0,
        parsedFiles: 0,
        failedFiles: 0,
        currentFile: '',
        mapsPerSec: 0,
        startedAt: Date.now(),
        durationMs: 0,
      };

      try {
        if (forceReloadAssets) {
          this.resolver.reload();
          this.refreshExistingThumbsSet();
        }

        const discovered = this.discoverAllPmsFiles();
        this.scanStatus.phase = 'indexing';
        this.scanStatus.totalFiles = discovered.length;

        const rulesAtScanStart = this.customRules;
        const classifier = createMapClassifier(rulesAtScanStart);
        const nextIndexed = new Map<string, InternalIndexedMap>();
        const pendingDbUpserts: Array<{
          pathKey: string;
          mtimeMs: number;
          fileSize: number;
          summary: PmsSummaryData;
        }> = [];

        const CHUNK_SIZE = 300;
        const DB_FLUSH_SIZE = 600;
        const discoveredPathKeys = new Set<string>();

        for (let i = 0; i < discovered.length; i++) {
          const d = discovered[i];
          const pathKey = d.fullPath.toLowerCase();
          discoveredPathKeys.add(pathKey);

          let stat: fs.Stats;
          try {
            stat = fs.statSync(d.fullPath);
          } catch {
            continue;
          }

          let summary: PmsSummaryData;
          const cached = this.memorySummaryCache.get(pathKey);
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.fileSize === stat.size) {
            summary = cached.summary;
            this.scanStatus.cachedHits++;
          } else {
            let buf: Buffer | null = null;
            try {
              buf = fs.readFileSync(d.fullPath);
              summary = parsePmsSummary(buf);
              this.memorySummaryCache.set(pathKey, {
                mtimeMs: stat.mtimeMs,
                fileSize: stat.size,
                summary,
              });
              pendingDbUpserts.push({
                pathKey,
                mtimeMs: stat.mtimeMs,
                fileSize: stat.size,
                summary,
              });
              this.scanStatus.parsedFiles++;
            } catch (err) {
              this.scanStatus.failedFiles++;
              summary = unreadableSummary(
                err instanceof Error ? err.message : String(err),
                buf ? soldatCrc32(buf) : 0
              );
            }
          }

          if (pendingDbUpserts.length >= DB_FLUSH_SIZE) {
            this.sqliteCache.upsertBatch(pendingDbUpserts);
            pendingDbUpserts.length = 0;
          }

          let mapId = d.sourceId === 'soldat' ? d.relNoExt : `${d.sourceId}:${d.relNoExt}`;
          if (nextIndexed.has(mapId)) {
            mapId = `${mapId}#${i}`;
          }

          const internal = this.buildInternalMapRecord(
            mapId,
            d,
            stat.size,
            stat.mtimeMs,
            summary,
            classifier
          );
          nextIndexed.set(mapId, internal);

          this.scanStatus.scannedFiles = i + 1;
          this.scanStatus.currentFile = d.fileName;
          const elapsedSec = Math.max(0.001, (performance.now() - t0) / 1000);
          this.scanStatus.mapsPerSec = Math.round((i + 1) / elapsedSec);

          // Yield event loop every CHUNK_SIZE maps so HTTP status/UI stays responsive on 50k maps
          if ((i + 1) % CHUNK_SIZE === 0) {
            await new Promise<void>((r) => setImmediate(r));
          }
        }

        if (pendingDbUpserts.length > 0) {
          this.sqliteCache.upsertBatch(pendingDbUpserts);
          pendingDbUpserts.length = 0;
        }

        this.scanStatus.phase = 'finalizing';

        // Compute CRC32 duplicates across the entire collection in O(N)
        const byCrc = new Map<number, InternalIndexedMap[]>();
        for (const item of nextIndexed.values()) {
          let arr = byCrc.get(item.full.crc32);
          if (!arr) {
            arr = [];
            byCrc.set(item.full.crc32, arr);
          }
          arr.push(item);
        }
        const nextByCrcHex = new Map<string, InternalIndexedMap[]>();
        for (const [crc, group] of byCrc.entries()) {
          nextByCrcHex.set((crc >>> 0).toString(16), group);
        }

        // Duplicates = same CRC32 and same size. CRC 0 marks files that could not be read at all.
        const byIdentity = new Map<string, InternalIndexedMap[]>();
        for (const item of nextIndexed.values()) {
          item.full.duplicateCount = 1;
          item.compact.duplicateCount = 1;
          item.full.duplicateMapIds = [];
          const key = duplicateIdentityKey(item.full.crc32, item.full.fileSize);
          if (!key) continue;
          let arr = byIdentity.get(key);
          if (!arr) {
            arr = [];
            byIdentity.set(key, arr);
          }
          arr.push(item);
        }
        const nextDuplicateGroups: MapIndexEntry[][] = [];
        for (const group of byIdentity.values()) {
          if (group.length < 2) continue;
          const ids = group.map((g) => g.full.id);
          for (const g of group) {
            g.full.duplicateCount = group.length;
            g.compact.duplicateCount = group.length;
            g.full.duplicateMapIds = ids.filter((id) => id !== g.full.id);
          }
          nextDuplicateGroups.push(group.map((g) => g.full));
        }
        this.duplicateGroups = nextDuplicateGroups;

        // Default natural A-Z sort
        const sorted = Array.from(nextIndexed.values()).sort((a, b) =>
          NAME_COLLATOR.compare(a.compact.baseName, b.compact.baseName)
        );

        // Prefix rules edited while this scan ran must win over the classifier captured at its start
        if (this.customRules !== rulesAtScanStart) {
          this.applyClassification(sorted, createMapClassifier(this.customRules));
        }

        this.indexedById = nextIndexed;
        this.itemsByCrcHex = nextByCrcHex;
        this.defaultSortedList = sorted;

        // Forget cached summaries of files that no longer exist (renamed / deleted maps)
        // (only inside folders that were actually scanned: a disabled or unplugged archive keeps its cache)
        const scannedRoots = this.getScannedRootKeys();
        const stalePathKeys: string[] = [];
        for (const key of this.memorySummaryCache.keys()) {
          if (!discoveredPathKeys.has(key) && scannedRoots.some((root) => key.startsWith(root))) {
            stalePathKeys.push(key);
          }
        }
        if (stalePathKeys.length > 0) {
          for (const key of stalePathKeys) this.memorySummaryCache.delete(key);
          this.sqliteCache.deleteKeys(stalePathKeys);
        }

        const durationMs = Math.round((performance.now() - t0) * 10) / 10;
        this.scanStatus.scanning = false;
        this.scanStatus.phase = 'idle';
        this.scanStatus.durationMs = durationMs;

        this.cachedMeta = this.buildMetaSnapshot(durationMs);
        return this.cachedMeta;
      } finally {
        this.scanStatus.scanning = false;
        this.scanStatus.phase = 'idle';
      }
    }
  }

  private buildInternalMapRecord(
    mapId: string,
    d: DiscoveredPmsFile,
    fileSize: number,
    mtimeMs: number,
    summary: PmsSummaryData,
    classifier: ReturnType<typeof createMapClassifier>
  ): InternalIndexedMap {
    const textureInfo = this.resolver.resolveMapAsset(
      'textures',
      summary.texture,
      summary.polygonCount
    );

    const sceneryAssets = summary.scenery.map((sc) =>
      this.resolver.resolveMapAsset('scenery-gfx', sc.filename, sc.usedCount)
    );

    const isVanillaMap = d.sourceId === 'soldat' && this.resolver.isVanillaMap(d.fileName);

    let missingAssetsCount = 0;
    let caseMismatchCount = 0;
    let unusedSceneryCount = 0;
    let customAssetsCount = 0;

    if (textureInfo.status === 'missing') missingAssetsCount++;
    if (textureInfo.status === 'case-mismatch') caseMismatchCount++;
    if (!textureInfo.isVanilla && textureInfo.status !== 'missing') customAssetsCount++;

    const seenSceneryLower = new Set<string>();
    const activeSceneryNames: string[] = [];

    for (const sc of sceneryAssets) {
      if (sc.usedCount === 0) {
        unusedSceneryCount++;
        continue;
      }
      const key = sc.referencedName.toLowerCase();
      if (seenSceneryLower.has(key)) continue;
      seenSceneryLower.add(key);
      if (key) activeSceneryNames.push(key);

      if (sc.status === 'missing') missingAssetsCount++;
      if (sc.status === 'case-mismatch') caseMismatchCount++;
      if (!sc.isVanilla && sc.status !== 'missing') customAssetsCount++;
    }

    const hasCustomAssets = customAssetsCount > 0;
    const isPureVanilla = isVanillaMap && !hasCustomAssets;
    const cls = classifier.classify(d.baseName);
    const hexCrc = summary.crc32.toString(16).toLowerCase();
    const hasThumbnail = this.existingThumbs.has(hexCrc);

    const polyWidth = Math.round(summary.polyBounds.width);
    const polyHeight = Math.round(summary.polyBounds.height);

    const limitViolations = checkSoldatMapLimits({
      polygonCount: summary.polygonCount,
      sectorsNum: summary.sectorsNum,
      propCount: summary.propCount,
      sceneryCount: summary.scenery.length,
      colliderCount: summary.colliderCount,
      spawnCount: summary.spawnCount,
    });
    const parseWarnings = summary.parseWarnings ?? [];

    const full: MapIndexEntry = {
      id: mapId,
      fullPath: d.fullPath,
      fileName: d.fileName,
      baseName: d.baseName,
      sourceId: d.sourceId,
      sourceLabel: d.sourceLabel,
      prefix: cls.prefix,
      subprefix: cls.subprefix,
      modeGroupId: cls.modeGroupId,
      modeGroupName: cls.modeGroupName,
      badgeColor: cls.badgeColor,
      fileSize,
      mtimeMs,
      isVanillaMap,
      isPureVanilla,
      hasCustomAssets,
      missingAssetsCount,
      caseMismatchCount,
      unusedSceneryCount,
      customAssetsCount,
      duplicateCount: 1,
      duplicateMapIds: [],
      hasThumbnail,
      limitViolationCount: limitViolations.length,
      parseWarningCount: parseWarnings.length,
      limitViolations,
      parseWarnings,
      version: summary.version,
      title: summary.mapName,
      texture: summary.texture,
      textureInfo,
      sceneryAssets,
      bgColorTop: summary.bgColorTop,
      bgColorBtm: summary.bgColorBtm,
      startJet: summary.startJet,
      startJetGame: summary.startJetGame,
      grenadePacks: summary.grenadePacks,
      medikits: summary.medikits,
      weather: summary.weather,
      steps: summary.steps,
      polygonCount: summary.polygonCount,
      polyTypeCounts: summary.polyTypeCounts,
      propCount: summary.propCount,
      activePropCount: summary.activePropCount,
      propLevelCounts: summary.propLevelCounts,
      colliderCount: summary.colliderCount,
      activeColliderCount: summary.activeColliderCount,
      spawnCount: summary.spawnCount,
      activeSpawnCount: summary.activeSpawnCount,
      spawnTeamCounts: summary.spawnTeamCounts,
      waypointCount: summary.waypointCount,
      activeWaypointCount: summary.activeWaypointCount,
      polyWidth,
      polyHeight,
      polyBounds: summary.polyBounds,
      fullBounds: summary.fullBounds,
      crc32: summary.crc32,
    };

    const searchHaystack = `${d.baseName}\n${summary.mapName}\n${summary.texture}\n${activeSceneryNames.join(
      '\n'
    )}`.toLowerCase();

    return {
      compact: toCompact(full),
      full,
      searchHaystack,
      nameLower: d.baseName.toLowerCase(),
      titleLower: summary.mapName.toLowerCase(),
      textureLower: summary.texture.toLowerCase(),
      sceneryLower: activeSceneryNames.join('\n'),
    };
  }

  private buildMetaSnapshot(scanDurationMs: number): IndexMetaResponse {
    const validSoldatDir =
      fs.existsSync(this.soldatPath) && fs.existsSync(path.join(this.soldatPath, 'maps'));

    const classifier = createMapClassifier(this.customRules);
    const prefixCounts = new Map<string, number>();
    const groupPrefixCounts = new Map<string, Map<string, number>>();
    const subprefixCounts = new Map<string, { parentPrefix: string; count: number }>();
    const sourceCounts = new Map<string, { label: string; path: string; count: number }>();

    let vanillaMapsCount = 0;
    let customMapsCount = 0;
    let brokenMapsCount = 0;
    let caseMismatchMapsCount = 0;
    let duplicateMapsCount = 0;
    let incompatibleMapsCount = 0;

    for (const item of this.defaultSortedList) {
      const m = item.compact;
      prefixCounts.set(m.prefix, (prefixCounts.get(m.prefix) ?? 0) + 1);

      let gMap = groupPrefixCounts.get(m.modeGroupId);
      if (!gMap) {
        gMap = new Map<string, number>();
        groupPrefixCounts.set(m.modeGroupId, gMap);
      }
      gMap.set(m.prefix, (gMap.get(m.prefix) ?? 0) + 1);

      if (m.subprefix) {
        const prev = subprefixCounts.get(m.subprefix);
        if (prev) prev.count++;
        else subprefixCounts.set(m.subprefix, { parentPrefix: m.prefix, count: 1 });
      }

      const prevSrc = sourceCounts.get(m.sourceId);
      if (prevSrc) {
        prevSrc.count++;
      } else {
        const extraMatch = this.extraSources.find((s) => s.id === m.sourceId);
        const srcPath =
          m.sourceId === 'soldat'
            ? path.join(this.soldatPath, 'maps')
            : m.sourceId === 'soldat_dl'
            ? path.join(this.soldatPath, 'downloads', 'maps')
            : extraMatch?.path ?? '';
        sourceCounts.set(m.sourceId, { label: m.sourceLabel, path: srcPath, count: 1 });
      }

      if (m.isVanillaMap) vanillaMapsCount++;
      else customMapsCount++;
      if (m.missingAssetsCount > 0) brokenMapsCount++;
      if (m.caseMismatchCount > 0) caseMismatchMapsCount++;
      if (m.duplicateCount > 1) duplicateMapsCount++;
      if (m.limitViolationCount > 0 || m.parseWarningCount > 0) incompatibleMapsCount++;
    }

    const prefixes: PrefixCountItem[] = Array.from(prefixCounts.entries())
      .map(([prefix, count]) => ({
        ...classifier.getPrefixMeta(prefix),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // Build ordered ModeGroups (including custom groups + built-in groups with >=1 map or top built-ins)
    const allGroupIds = new Set<string>([
      ...this.customRules
        .filter((r) => r.enabled && !r.targetGroupId)
        .map((r) => `custom:${r.id}`),
      ...BUILTIN_MODE_GROUPS.map((g) => g.id),
      ...groupPrefixCounts.keys(),
    ]);

    const modeGroups: ModeGroupCountItem[] = [];
    for (const gid of allGroupIds) {
      const gMeta = classifier.getGroupMeta(gid);
      const pMap = groupPrefixCounts.get(gid) ?? new Map<string, number>();
      const groupPrefixes: PrefixCountItem[] = Array.from(pMap.entries())
        .map(([pfx, cnt]) => ({
          ...classifier.getPrefixMeta(pfx),
          count: cnt,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      const totalGroupCount = groupPrefixes.reduce((acc, p) => acc + p.count, 0);
      if (totalGroupCount > 0 || gMeta.isCustom) {
        modeGroups.push({
          id: gid,
          name: gMeta.name,
          shortName: gMeta.shortName,
          badgeColor: gMeta.badgeColor,
          isCustom: gMeta.isCustom,
          count: totalGroupCount,
          prefixes: groupPrefixes,
        });
      }
    }

    modeGroups.sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
      if (a.id === 'other' && b.id !== 'other') return 1;
      if (b.id === 'other' && a.id !== 'other') return -1;
      return b.count - a.count || a.name.localeCompare(b.name);
    });

    const discoveredSubprefixes: SubprefixCountItem[] = Array.from(subprefixCounts.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([subprefix, v]) => ({
        subprefix,
        parentPrefix: v.parentPrefix,
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count || a.subprefix.localeCompare(b.subprefix))
      .slice(0, 200);

    const sources: SourceCountItem[] = Array.from(sourceCounts.entries()).map(([id, v]) => ({
      id,
      label: v.label,
      path: v.path,
      count: v.count,
    }));

    const ctfAsh = this.defaultSortedList.find(
      (x) => x.compact.baseName.toLowerCase() === 'ctf_ash'
    );
    const defaultMapId = ctfAsh?.compact.id ?? this.defaultSortedList[0]?.compact.id ?? null;

    return {
      soldatPath: this.soldatPath,
      extraSources: this.extraSources,
      customRules: this.customRules,
      validSoldatDir,
      scanStatus: { ...this.scanStatus },
      scanDurationMs,
      totalMaps: this.defaultSortedList.length,
      vanillaMapsCount,
      customMapsCount,
      brokenMapsCount,
      caseMismatchMapsCount,
      duplicateMapsCount,
      incompatibleMapsCount,
      ...this.getUserDataSummary(),
      modeGroups,
      prefixes,
      discoveredSubprefixes,
      sources,
      defaultMapId,
    };
  }

  /**
   * Filters & sorts up to 100,000 maps in ~4ms and returns the requested virtual window.
   */
  private filterAndSortInternal(req: MapQueryRequest): InternalIndexedMap[] {
    const statusFilter = req.statusFilter || 'all';
    const modeSet =
      req.modeGroupIds && req.modeGroupIds.length > 0 ? new Set(req.modeGroupIds) : null;
    const prefixSet = req.prefixes && req.prefixes.length > 0 ? new Set(req.prefixes) : null;
    const subprefixSet =
      req.subprefixes && req.subprefixes.length > 0 ? new Set(req.subprefixes) : null;
    const sourceSet = req.sourceIds && req.sourceIds.length > 0 ? new Set(req.sourceIds) : null;
    const packSet =
      statusFilter === 'in_pack' && req.packMapIds ? new Set(req.packMapIds) : null;

    const searchTerms = parseSearchQuery(req.searchQuery || '').terms;

    const weather = req.weather !== undefined && req.weather !== 'any' ? Number(req.weather) : null;
    const reqCol = Boolean(req.requireColliders);
    const reqWp = Boolean(req.requireWaypoints);
    const reqCase = Boolean(req.requireCaseMismatch);

    const matched: InternalIndexedMap[] = [];

    for (let i = 0; i < this.defaultSortedList.length; i++) {
      const item = this.defaultSortedList[i];
      const m = item.compact;

      if (statusFilter === 'custom' && m.isVanillaMap) continue;
      if (statusFilter === 'vanilla' && !m.isVanillaMap) continue;
      if (statusFilter === 'broken' && m.missingAssetsCount === 0) continue;
      if (statusFilter === 'duplicates' && m.duplicateCount <= 1) continue;
      if (statusFilter === 'incompatible' && m.limitViolationCount === 0 && m.parseWarningCount === 0) {
        continue;
      }
      if (statusFilter === 'in_pack' && (!packSet || !packSet.has(m.id))) continue;
      if (statusFilter === 'favorites' && !this.userData?.get(m.id)?.favorite) continue;

      if (modeSet && !modeSet.has(m.modeGroupId)) continue;
      if (prefixSet && !prefixSet.has(m.prefix)) continue;
      if (subprefixSet && (!m.subprefix || !subprefixSet.has(m.subprefix))) continue;
      if (sourceSet && !sourceSet.has(m.sourceId)) continue;

      if (weather !== null && m.weather !== weather) continue;
      if (reqCol && m.activeColliderCount === 0) continue;
      if (reqWp && m.activeWaypointCount === 0) continue;
      if (reqCase && m.caseMismatchCount === 0) continue;

      if (searchTerms.length > 0) {
        let allHit = true;
        for (let t = 0; t < searchTerms.length; t++) {
          if (!this.matchesSearchTerm(item, searchTerms[t])) {
            allHit = false;
            break;
          }
        }
        if (!allHit) continue;
      }

      matched.push(item);
    }

    const sortField = req.sortField || 'name';
    const sortDir = req.sortDir || (sortField === 'name' ? 'asc' : 'desc');
    const dirMul = sortDir === 'asc' ? 1 : -1;

    if (sortField === 'name') {
      if (sortDir === 'desc') {
        matched.reverse();
      }
    } else {
      matched.sort((a, b) => {
        const ma = a.compact;
        const mb = b.compact;
        switch (sortField) {
          case 'polys':
            return (ma.polygonCount - mb.polygonCount) * dirMul;
          case 'props':
            return (ma.activePropCount - mb.activePropCount) * dirMul;
          case 'width':
            return (ma.polyWidth - mb.polyWidth) * dirMul;
          case 'height':
            return (ma.polyHeight - mb.polyHeight) * dirMul;
          case 'size':
            return (ma.fileSize - mb.fileSize) * dirMul;
          case 'mtime':
            return (ma.mtimeMs - mb.mtimeMs) * dirMul;
          default:
            return 0;
        }
      });
    }

    return matched;
  }

  private numericFieldValue(m: MapCompactEntry, field: SearchNumericField): number {
    switch (field) {
      case 'props':
        return m.activePropCount;
      case 'polys':
        return m.polygonCount;
      case 'colliders':
        return m.activeColliderCount;
      case 'spawns':
        return m.activeSpawnCount;
      case 'waypoints':
        return m.activeWaypointCount;
      case 'width':
        return m.polyWidth;
      case 'height':
        return m.polyHeight;
      case 'sizeKb':
        return Math.round(m.fileSize / 1024); // whole KB, so size:120 / kb=120 can match
      case 'missing':
        return m.missingAssetsCount;
      case 'medikits':
        return m.medikits;
      case 'grenades':
        return m.grenadePacks;
      default:
        return m.startJet;
    }
  }

  private matchesSearchTerm(item: InternalIndexedMap, term: SearchTerm): boolean {
    const m = item.compact;
    let hit: boolean;
    switch (term.kind) {
      case 'text':
        hit = item.searchHaystack.includes(term.value);
        break;
      case 'weather':
        hit = m.weather === term.value;
        break;
      case 'num':
        hit = compareNumber(this.numericFieldValue(m, term.field), term.op, term.value);
        break;
      case 'flag':
        switch (term.flag) {
          case 'fav':
            hit = Boolean(this.userData?.get(m.id)?.favorite);
            break;
          case 'vanilla':
            hit = m.isVanillaMap;
            break;
          case 'custom':
            hit = !m.isVanillaMap;
            break;
          case 'broken':
            hit = m.missingAssetsCount > 0;
            break;
          case 'dup':
            hit = m.duplicateCount > 1;
            break;
          case 'incompatible':
            hit = m.limitViolationCount > 0 || m.parseWarningCount > 0;
            break;
          default:
            hit = m.caseMismatchCount > 0;
        }
        break;
      case 'field': {
        const v = term.value;
        switch (term.field) {
          case 'name':
            hit = item.nameLower.includes(v);
            break;
          case 'title':
            hit = item.titleLower.includes(v);
            break;
          case 'tex':
            hit = item.textureLower.includes(v);
            break;
          case 'scenery':
            hit = item.sceneryLower.includes(v);
            break;
          case 'prefix':
            hit = item.nameLower.startsWith(v);
            break;
          case 'mode':
            hit = m.modeGroupName.toLowerCase().includes(v) || m.modeGroupId.toLowerCase() === v;
            break;
          case 'source':
            hit = m.sourceLabel.toLowerCase().includes(v) || m.sourceId.toLowerCase() === v;
            break;
          case 'crc':
            hit = (m.crc32 >>> 0).toString(16).padStart(8, '0').startsWith(v.replace(/^0x/, ''));
            break;
          default: {
            const tags = this.userData?.get(m.id)?.tags;
            hit = Boolean(tags?.some((t) => t.toLowerCase() === v));
          }
        }
        break;
      }
    }
    return term.negate ? !hit : hit;
  }

  public queryMaps(req: MapQueryRequest): MapQueryResponse {
    const t0 = performance.now();
    const matched = this.filterAndSortInternal(req);
    const offset = Math.max(0, Math.floor(req.offset ?? 0));
    const limit = Math.max(1, Math.min(2000, Math.floor(req.limit ?? 300)));

    const items = matched.slice(offset, offset + limit).map((x) => this.withUserData(x.compact));
    const queryDurationMs = Math.round((performance.now() - t0) * 100) / 100;

    return {
      totalFiltered: matched.length,
      offset,
      limit,
      items,
      queryDurationMs,
    };
  }

  public queryMatchingIds(req: MapQueryRequest): string[] {
    return this.filterAndSortInternal(req).map((x) => x.compact.id);
  }

  public queryMatchingCompacts(req: MapQueryRequest): MapCompactEntry[] {
    return this.filterAndSortInternal(req).map((x) => this.withUserData(x.compact));
  }
}
