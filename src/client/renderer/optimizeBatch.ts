/**
 * Batch Optimize Sceneries (`_o`) for the pack / current filter.
 *
 * Maps are processed one at a time on the GPU (one WebGL context per bake, released afterwards).
 * Existing outputs are skipped unless they are unchanged previous Studio outputs of the same map and the
 * user allowed replacing those; the server re-checks that ('own' policy), so a race can only skip, never
 * overwrite someone else's file. No fidelity report per map (too expensive) — only a summary.
 */
import { MapCompactEntry, OptimizeMapOptions, OverwritePolicy } from '@shared/apiTypes';
import { t } from '../i18n';
import { fetchAndParseMap } from '../utils/mapCache';
import {
  checkOptimizeTarget,
  executeSceneryOptimization,
  fetchOptimizePlan,
  resolveSupersample,
  SupersampleChoice,
} from './SceneryLayerBaker';

export type OptimizeBatchItemStatus =
  | 'done'
  | 'skipped_exists'
  | 'skipped_nothing'
  | 'skipped_derived'
  | 'failed';

export interface OptimizeBatchItemResult {
  mapId: string;
  baseName: string;
  status: OptimizeBatchItemStatus;
  detail?: string;
  derivedBaseName?: string;
  propsBefore?: number;
  propsAfter?: number;
  pngBytes?: number;
  supersample?: number;
  limitWarnings?: string[];
}

export interface OptimizeBatchProgress {
  index: number; // 0-based index of the map being processed
  total: number;
  mapName: string;
  mapProgress: number; // 0..1 within the current map
  status: string;
}

export interface OptimizeBatchSummary {
  total: number;
  processed: number;
  done: number;
  skippedExisting: number;
  skippedNothingToMerge: number;
  skippedDerived: number;
  failed: number;
  propsBefore: number;
  propsAfter: number;
  pngBytes: number;
  cancelled: boolean;
  stoppedEarly: boolean; // too many failures in a row (lost GPU, unwritable folder...)
  outputDir: string | null;
  items: OptimizeBatchItemResult[];
}

const MAX_CONSECUTIVE_FAILURES = 5;

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err as Error)?.name === 'AbortError';
}

function parentDir(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return cut > 0 ? filePath.slice(0, cut) : filePath;
}

export async function runOptimizeBatch(
  candidates: Array<Pick<MapCompactEntry, 'id' | 'baseName'>>,
  baseOptions: OptimizeMapOptions,
  supersampleChoice: SupersampleChoice,
  overwriteOwnOutputs: boolean,
  onProgress: (progress: OptimizeBatchProgress) => void,
  signal: AbortSignal
): Promise<OptimizeBatchSummary> {
  const summary: OptimizeBatchSummary = {
    total: candidates.length,
    processed: 0,
    done: 0,
    skippedExisting: 0,
    skippedNothingToMerge: 0,
    skippedDerived: 0,
    failed: 0,
    propsBefore: 0,
    propsAfter: 0,
    pngBytes: 0,
    cancelled: false,
    stoppedEarly: false,
    outputDir: null,
    items: [],
  };
  // Long names truncated to the same `_o` name: the first map wins, the others are reported
  const claimedNames = new Map<string, string>();
  let consecutiveFailures = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (signal.aborted) {
      summary.cancelled = true;
      break;
    }
    const c = candidates[i];
    const report = (mapProgress: number, status: string) =>
      onProgress({ index: i, total: candidates.length, mapName: c.baseName, mapProgress, status });
    const record = (item: Omit<OptimizeBatchItemResult, 'mapId' | 'baseName'>) => {
      summary.items.push({ mapId: c.id, baseName: c.baseName, ...item });
      summary.processed++;
    };

    report(0, t('Preparing the merging plan...'));
    try {
      if (/_o$/i.test(c.baseName)) {
        summary.skippedDerived++;
        record({ status: 'skipped_derived', detail: t('Already an optimization result') });
        continue;
      }

      const probeSupersample = supersampleChoice === 'auto' ? 2 : supersampleChoice;
      const plan = await fetchOptimizePlan(c.id, { ...baseOptions, supersample: probeSupersample }, signal);
      if (plan.groups.length === 0) {
        summary.skippedNothingToMerge++;
        record({ status: 'skipped_nothing', detail: t('No scenery groups to merge') });
        continue;
      }

      const derivedKey = plan.derivedBaseName.toLowerCase();
      const owner = claimedNames.get(derivedKey);
      if (owner) {
        summary.failed++;
        record({ status: 'failed', detail: t('Same output name as {name} — skipped', { name: owner }) });
        continue;
      }
      claimedNames.set(derivedKey, c.baseName);

      const supersample = resolveSupersample(supersampleChoice, plan);
      const options: OptimizeMapOptions = { ...baseOptions, supersample };

      let policy: OverwritePolicy = 'never';
      const check = await checkOptimizeTarget(c.id, options, signal);
      if (check.mapExists) {
        if (overwriteOwnOutputs && check.existingWasGeneratedByStudio) {
          policy = 'own';
        } else {
          summary.skippedExisting++;
          record({ status: 'skipped_exists', derivedBaseName: plan.derivedBaseName, detail: t('The output file already exists') });
          continue;
        }
      }

      const mapData = await fetchAndParseMap(c.id);
      const { result } = await executeSceneryOptimization(
        c.id,
        mapData,
        options,
        false,
        report,
        signal,
        undefined,
        { overwritePolicy: policy, skipRescan: true }
      );

      summary.done++;
      summary.propsBefore += result.propsBefore;
      summary.propsAfter += result.propsAfter;
      summary.pngBytes += result.totalPngBytes;
      summary.outputDir = parentDir(result.outputMapPath);
      record({
        status: 'done',
        derivedBaseName: result.derivedBaseName,
        propsBefore: result.propsBefore,
        propsAfter: result.propsAfter,
        pngBytes: result.totalPngBytes,
        supersample,
        limitWarnings: result.limitWarnings,
      });
      consecutiveFailures = 0;
    } catch (err) {
      if (isAbort(err, signal)) {
        summary.cancelled = true;
        break;
      }
      if ((err as { status?: number })?.status === 409) {
        // The target appeared meanwhile or is not an unchanged Studio output of this map
        summary.skippedExisting++;
        record({ status: 'skipped_exists', detail: (err as Error).message });
        continue;
      }
      summary.failed++;
      record({ status: 'failed', detail: err instanceof Error ? err.message : String(err) });
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.stoppedEarly = true;
        break;
      }
    }
  }

  return summary;
}
