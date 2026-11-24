export interface ArchiveCleanerIssue {
  path: string;
  reason: string;
}

export interface ArchiveCleanerProgress {
  phase?: string;
  entries?: number;
  maps?: number;
  current?: string;
}

export interface ArchiveCleanerSummary {
  maps: number;
  readyMaps: number;
  incompleteMaps?: number;
  unresolvedMaps: number;
  duplicateMaps: number;
  assets: number;
  duplicateAssets: number;
  renamedAssets: number;
  issues: number;
  coverageIssues?: number;
  repairedProps?: number;
  repairedSectorMaps?: number;
  rewrittenReferences?: number;
  removedUnusedScenery?: number;
  recovery?: ArchiveRecoverySummary;
  artworkRecovery?: ArchiveRecoverySummary;
}

export interface ArchiveRecoverySummary {
  baseline: string;
  reviewed: number;
  withCandidates: number;
  recovered: number;
  recoveredWithCandidates: number;
  newOutputs: number;
  matchedPreviousOutputs: number;
  changedOrAbsent: number;
}

export type ArchiveCleanerStatus = 'scanning' | 'ready' | 'exporting' | 'complete' | 'cancelled' | 'failed';

export interface ArchiveCleanerJob {
  id: string;
  source: string;
  includeMissing?: boolean;
  includeInstalledMaps?: boolean;
  versionsReport?: boolean;
  includeLoose: boolean;
  includeArchives: boolean;
  useCollectionIndex: boolean;
  portableAssetNames?: boolean;
  shortMapNames?: boolean;
  artworkRoots?: string[];
  status: ArchiveCleanerStatus;
  progress?: ArchiveCleanerProgress;
  summary?: ArchiveCleanerSummary;
  examples?: ArchiveCleanerIssue[];
  outputPath?: string;
  error?: string;
}

/** File name of the map versions report in the report/ folder of an exported clean copy */
export const MAP_VERSIONS_REPORT = 'map-versions.csv';
