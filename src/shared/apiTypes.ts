import { MapLimitViolation, PmsBounds } from './pmsParser';
import { CustomPrefixRule } from './prefixUtils';
import { RgbaColor } from './soldatConstants';

export type AssetStatus =
  | 'vanilla'       // Default Soldat asset listed in readonly.txt
  | 'custom'        // Custom asset present on disk with exact name
  | 'case-mismatch' // Custom asset present on disk, but casing differs from PMS (Linux server warning!)
  | 'png-override'  // Referenced as .bmp in PMS, found as .png on disk
  | 'missing';      // Not found on disk at all!

export interface ResolvedAssetInfo {
  category: 'textures' | 'textures/edges' | 'scenery-gfx';
  referencedName: string;              // Exact string stored inside .pms
  diskName: string | null;             // Actual filename on disk (for primary/render file)
  diskFullPath?: string | null;        // Full source path on disk (supports multi-folder sources!)
  pngOverrideDiskName?: string | null; // Optional .png companion when .bmp also exists
  pngOverrideFullPath?: string | null;
  edgeDiskName?: string | null;        // Optional textures/edges/<name> companion
  edgeFullPath?: string | null;
  isVanilla: boolean;
  status: AssetStatus;
  usedCount: number;                   // For scenery: how many active Props use it; for texture: polygon count
  fileSize: number;                    // Bytes on disk
}

export interface ExtraMapSource {
  id: string;
  path: string;
  label: string;
  recursive: boolean;
  enabled: boolean;
}

/**
 * Compact map record sent in paged `/api/maps/query` responses so 50,000+ maps
 * browse at 60 FPS with minimal memory and bandwidth.
 */
export interface MapCompactEntry {
  id: string;
  fileName: string;
  baseName: string;
  sourceId: string;
  sourceLabel: string;
  prefix: string;
  subprefix: string | null;
  modeGroupId: string;
  modeGroupName: string;
  badgeColor: string;
  fileSize: number;
  mtimeMs: number;
  isVanillaMap: boolean;
  isPureVanilla: boolean;
  hasCustomAssets: boolean;
  missingAssetsCount: number;
  caseMismatchCount: number;
  unusedSceneryCount: number;
  customAssetsCount: number;
  duplicateCount: number; // > 1 if multiple maps share identical OpenSoldat CRC32!
  hasThumbnail: boolean;
  limitViolationCount: number; // > 0 when Soldat refuses to load the map (MAX_PROPS, MAX_POLYS...)
  parseWarningCount: number;   // > 0 when trailing PMS sections are truncated / corrupted

  title: string;
  texture: string;
  bgColorTop: RgbaColor;
  bgColorBtm: RgbaColor;
  weather: number;
  steps: number;
  startJet: number;
  startJetGame: number;
  grenadePacks: number;
  medikits: number;
  polygonCount: number;
  activePropCount: number;
  activeColliderCount: number;
  activeSpawnCount: number;
  activeWaypointCount: number;
  polyWidth: number;
  polyHeight: number;
  polyBounds: PmsBounds;
  fullBounds: PmsBounds;
  crc32: number;

  // User data (attached when the map is returned; not part of the scanned index)
  favorite?: boolean;
  tags?: string[];
}

export interface MapUserData {
  favorite?: boolean;
  tags?: string[];
}

export interface MapUserDataPatch {
  favorite?: boolean;
  tags?: string[];
}

export interface UserTagCount {
  tag: string;
  count: number;
}

export interface MapUserDataResponse {
  mapId: string;
  favorite: boolean;
  tags: string[];
  favoriteMapsCount: number;
  userTags: UserTagCount[];
}

/**
 * Full detailed map entry (used on server and returned by `/api/maps/:id/details` for the Inspector).
 */
export interface MapIndexEntry extends MapCompactEntry {
  fullPath: string;
  version: number;
  textureInfo: ResolvedAssetInfo;
  sceneryAssets: ResolvedAssetInfo[];
  propCount: number;
  propLevelCounts: [number, number, number];
  colliderCount: number;
  spawnCount: number;
  spawnTeamCounts: Record<number, number>;
  waypointCount: number;
  polyTypeCounts: Record<number, number>;
  duplicateMapIds: string[];
  limitViolations: MapLimitViolation[];
  parseWarnings: string[];
}

// Library tidy-up: duplicate maps (C2) and unused scenery files (C3)
export interface DuplicateMapFile {
  id: string;
  baseName: string;
  fileName: string;
  fullPath: string;
  sourceId: string;
  sourceLabel: string;
  fileSize: number;
  mtimeMs: number;
  title: string;
}

export interface DuplicateGroup {
  crc32: number;
  crcHex: string;
  files: DuplicateMapFile[];
  sameName: boolean; // all copies share one name (safe to tidy); different names may be referenced by servers
  suggestedKeepId: string;
}

export interface DuplicatesResponse {
  groups: DuplicateGroup[];
  totalGroups: number;
  totalRemovable: number;
}

export interface UnusedSceneryItem {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface UnusedSceneryReport {
  folder: string;
  totalFiles: number;
  usedFiles: number;
  vanillaSkipped: number;
  unusedCount: number;
  unusedBytes: number;
  items: UnusedSceneryItem[]; // largest first, capped at 5000
  truncated: boolean;
}

export interface LibraryMoveResult {
  moved: number;
  failed: Array<{ name: string; error: string }>;
  backupDir: string | null;
  meta?: IndexMetaResponse;
}

export interface PrefixCountItem {
  prefix: string;
  label: string;
  modeGroupId: string;
  modeName: string;
  badgeColor: string;
  count: number;
}

export interface ModeGroupCountItem {
  id: string;
  name: string;
  shortName: string;
  badgeColor: string;
  isCustom: boolean;
  count: number;
  prefixes: PrefixCountItem[];
}

export interface SubprefixCountItem {
  subprefix: string;
  parentPrefix: string;
  count: number;
}

export interface SourceCountItem {
  id: string;
  label: string;
  path: string;
  count: number;
}

export interface ScanProgressStatus {
  scanning: boolean;
  phase: 'idle' | 'discovering' | 'indexing' | 'finalizing';
  scannedFiles: number;
  totalFiles: number;
  cachedHits: number;
  parsedFiles: number;
  failedFiles: number; // .pms files that could not be parsed (indexed as "unreadable" entries)
  currentFile: string;
  mapsPerSec: number;
  startedAt: number;
  durationMs: number;
}

export interface IndexMetaResponse {
  soldatPath: string;
  extraSources: ExtraMapSource[];
  customRules: CustomPrefixRule[];
  validSoldatDir: boolean;
  scanStatus: ScanProgressStatus;
  scanDurationMs: number;
  totalMaps: number;
  vanillaMapsCount: number;
  customMapsCount: number;
  brokenMapsCount: number;
  caseMismatchMapsCount: number;
  duplicateMapsCount: number;
  incompatibleMapsCount: number;
  favoriteMapsCount: number;
  userTags: UserTagCount[];
  modeGroups: ModeGroupCountItem[];
  prefixes: PrefixCountItem[];
  discoveredSubprefixes: SubprefixCountItem[];
  sources: SourceCountItem[];
  defaultMapId: string | null;
}

export type StatusFilterMode =
  | 'all'
  | 'custom'
  | 'vanilla'
  | 'broken'
  | 'duplicates'
  | 'incompatible'
  | 'favorites'
  | 'in_pack';

export type MapSortField =
  | 'name'
  | 'size'
  | 'width'
  | 'height'
  | 'polys'
  | 'props'
  | 'mtime';

export interface MapQueryRequest {
  statusFilter?: StatusFilterMode;
  modeGroupIds?: string[];
  prefixes?: string[];
  subprefixes?: string[];
  sourceIds?: string[];
  searchQuery?: string;
  weather?: number | 'any';
  requireColliders?: boolean;
  requireWaypoints?: boolean;
  requireCaseMismatch?: boolean;
  packMapIds?: string[]; // Only passed when statusFilter === 'in_pack'
  sortField?: MapSortField;
  sortDir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface MapQueryResponse {
  totalFiltered: number;
  offset: number;
  limit: number;
  items: MapCompactEntry[];
  queryDurationMs: number;
}

export interface PackBuildOptions {
  packName: string;
  mapIds: string[];
  outputFormat: 'zip' | 'smap' | 'folder';
  splitBy?: 'none' | 'prefix' | 'mode'; // Split thousands of maps into clean per-prefix or per-mode packs!
  excludeVanillaAssets: boolean;        // Default: true (like Soldat MPA!)
  excludeUnusedScenery: boolean;        // Default: true (skip dead scenery entries with 0 active props)
  includePngOverrides: boolean;         // Default: true
  includeEdgeTextures: boolean;         // Default: true
  fixLinuxCase: boolean;                // Default: true (rename archive entry to match exact PMS string!)
  generateMapsListTxt: boolean;         // Default: true (creates mapslist.txt)
  generateReadmeManifest: boolean;      // Default: true (creates README_PACK.txt with full report)
  generateCrcManifest?: boolean;        // Default: true (maps_crc32_<pack>.txt: map name, OpenSoldat CRC32, size)
  customOutputFolder?: string;          // Optional target directory when saving on server disk
}

/** Saved set of pack options (everything except the map list), stored in data/pack-presets.json */
export interface PackPreset {
  name: string;
  options: Omit<PackBuildOptions, 'mapIds'>;
  updatedAt: number;
}

export interface PackPreviewFile {
  archivePath: string;                  // e.g. "maps/ctf_Ash.pms", "scenery-gfx/tree.png"
  diskPath: string;
  category: 'map' | 'texture' | 'edge' | 'scenery' | 'generated';
  sizeBytes: number;
  usedByMapsCount: number;
  sampleMaps: string[];
  caseRenamedFrom?: string;
}

export interface PackMissingWarning {
  mapName: string; // base name of the map that references the missing file
  category: 'textures' | 'scenery-gfx';
  referencedName: string;
}

export interface PackPreviewResponse {
  mapCount: number;
  totalFilesCount: number;
  files: PackPreviewFile[];             // Capped to 2500 rows for instant UI rendering even on 20k-map packs
  filesTruncated: boolean;
  splitGroupsPreview?: Array<{ groupKey: string; packFileName: string; mapCount: number }>;
  totalUncompressedBytes: number;
  missingWarningsCount: number;
  missingWarnings: PackMissingWarning[];
  collisionWarnings: string[]; // same archive path, different files on disk (only one can be packed)
  skippedVanillaCount: number;
  skippedUnusedSceneryCount: number;
  caseFixedCount: number;
}

// ============================================================================
// Map Workshop: Soldat 1.7.1 Scenery Auto-Fixer (_f) & Scenery Layer Optimizer (_o)
// ============================================================================

export type SceneryFixReason =
  | 'pot_or_stale'
  | 'hd_upscale_enlarged'
  | 'invalid_zero_dims';

export interface SceneryFixIssueGroup {
  key: string;
  sceneryName: string;
  isVanilla: boolean;
  reason: SceneryFixReason;
  reasonLabelPl: string;
  pmsWidth: number;
  pmsHeight: number;
  expectedWidth: number;
  expectedHeight: number;
  diskWidth: number | null;
  diskHeight: number | null;
  sampleScaleX: number;
  sampleScaleY: number;
  propIndices: number[];
  recommended: boolean;
}

export interface MapFixAnalysisResponse {
  mapId: string;
  baseName: string;
  derivedBaseName: string;
  maxBaseLength: number;
  totalActiveProps: number;
  affectedPropCount: number;
  unusedSceneryCount: number;
  issues: SceneryFixIssueGroup[];
}

export interface FixMapRequest {
  mapId: string;
  selectedIssueKeys?: string[];
  removeUnusedScenery: boolean;
  maxBaseLength: number;
  destination: 'soldat_maps' | 'exports_fixed' | 'custom';
  customOutputFolder?: string;
  overwriteExisting?: boolean;
}

/**
 * Pre-flight check of where a derived `_f` / `_o` map would be written and what it would replace.
 */
export interface DerivedTargetCheck {
  derivedBaseName: string;
  outputMapPath: string;
  mapExists: boolean;
  existingMapTitle: string | null;
  existingWasGeneratedByStudio: boolean; // true when the existing file is a previous output of this tool
  existingPngFiles: string[];            // `_o` only: tile PNGs that would be overwritten
}

export type OptimizeCheckResponse = DerivedTargetCheck;

export interface FixMapResponse {
  mapId: string;
  derivedBaseName: string;
  outputFileName: string;
  outputPath: string;
  fixedPropCount: number;
  removedUnusedSceneryCount: number;
  newMapId?: string | null;
  backupDir?: string | null; // copy of the overwritten file (data/backups/<timestamp>)
}

export interface BatchScanFixItem {
  mapId: string;
  baseName: string;
  modeGroupName: string;
  derivedBaseName: string;
  affectedPropCount: number;
  issueSummary: string[];
  alreadyHasFixedSibling: boolean;
  nameCollisionWith?: string; // another map in this batch already produces the same derived file name
}

export interface OptimizeMapOptions {
  mergeBack: boolean;
  mergeMid: boolean;
  mergeFront: boolean;
  supersample: 1 | 2 | 3 | 4; // texels per world unit of baked PNG layers (in-game 1080p shows ~2.25 px per unit)
  maxTilePx: 2048 | 4096;
  preserveGiantProps: boolean;
  giantPropThresholdPx: number;
  skipIsolatedSingleProps: boolean;
  removeUnusedScenery: boolean;
  preferClassicBmp: boolean;
  maxBaseLength: number;
  destination: 'soldat_maps' | 'exports_optimized' | 'custom';
  customOutputFolder?: string;
  // Apply the recommended 1.7.1 scenery size fixes (`_f`) before merging; the result is then named `<map>_f_o`
  fixFirst?: boolean;
}

export interface OptimizePropFix {
  propIndex: number;
  width: number;
  height: number;
}

export interface OptimizeLayerGroupPlan {
  groupId: string;
  level: 0 | 1 | 2;
  runIndex: number;
  insertOrderKey: number;
  propIndices: number[];
  worldBounds: PmsBounds;
  tileCount: number;
}

export interface OptimizePreservedPropInfo {
  propIndex: number;
  level: 0 | 1 | 2;
  sceneryName: string;
  reason: 'animated_gif' | 'giant_skybox' | 'layer_disabled' | 'single_isolated' | 'zero_size';
}

export interface MapOptimizePlanResponse {
  mapId: string;
  baseName: string;
  derivedBaseName: string;
  totalActivePropsBefore: number;
  mergedPropsCount: number;
  preservedPropsCount: number;
  estimatedTotalPropsAfter: number;
  groups: OptimizeLayerGroupPlan[];
  preservedSample: OptimizePreservedPropInfo[];
  // Upper bound of baked texture area (sum of group bounds) in megapixels at 1x..4x supersampling
  estimatedMegapixelsBySupersample: [number, number, number, number];
  // Exact draw order of the resulting `_o` map: preserved original props and baked groups, per level
  layout: Array<{ level: 0 | 1 | 2; propIndex?: number; groupId?: string }>;
  // 1.7.1 size fixes applied before planning (`fixFirst`); the client bakes from the same corrected props
  appliedPropFixes: OptimizePropFix[];
}

export interface BakedSceneryTileUpload {
  tileFileName: string;
  level: 0 | 1 | 2;
  insertOrderKey: number;
  worldX: number;
  worldY: number;
  pngWidth: number;
  pngHeight: number;
  scaleX: number;
  scaleY: number;
  floatPrecision?: boolean;
}

// How an existing output file may be replaced: never, only an unchanged previous Studio output of the same
// source map ('own', used by batch runs), or always (explicit user confirmation)
export type OverwritePolicy = 'never' | 'own' | 'always';

export interface OptimizeSaveResponse {
  derivedBaseName: string;
  outputMapPath: string;
  sceneryDirPath: string;
  generatedPngFiles: string[];
  propsBefore: number;
  propsAfter: number;
  totalPngBytes: number;
  newMapId?: string | null;
  removedOrphanPngs: number;  // stale tiles of the previous `_o` version that were deleted
  floatPrecision: boolean;    // all tiles were composited in a float (RGBA16F) target
  limitWarnings: string[];    // Soldat engine limits the result still exceeds (e.g. > 500 props)
  backupDir?: string | null;  // copies of every overwritten / removed file (data/backups/<timestamp>)
}
