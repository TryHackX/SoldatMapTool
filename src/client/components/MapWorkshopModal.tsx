import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BatchScanFixItem,
  DerivedTargetCheck,
  FixMapResponse,
  IndexMetaResponse,
  MapCompactEntry,
  MapFixAnalysisResponse,
  MapIndexEntry,
  MapOptimizePlanResponse,
  OptimizeMapOptions,
  OptimizeSaveResponse,
  SceneryFixIssueGroup,
} from '@shared/apiTypes';
import {
  cloneMapWithPropFixes,
  makeDerivedMapName,
  PmsMapData,
} from '@shared/pmsParser';
import { stripDerivedSuffix } from '@shared/mapFamily';
import { locale, t, tp, tr, tText } from '../i18n';
import {
  buildOptimizePreview,
  checkOptimizeTarget,
  executeSceneryOptimization,
  fetchOptimizePlan,
  FidelityReport,
  OptimizePreview,
  optimizeOptionsKey,
  resolveSupersample,
  SupersampleChoice,
} from '../renderer/SceneryLayerBaker';
import { OptimizeBatchProgress, OptimizeBatchSummary, runOptimizeBatch } from '../renderer/optimizeBatch';
import {
  fetchIndexMeta,
  formatBytes,
  openPathInExplorer,
  pickSystemFolder,
} from '../utils/mapCache';
import { useModalDismiss } from '../utils/useModalDismiss';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FolderOpen,
  Layers,
  Play,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';


interface MapWorkshopModalProps {
  open: boolean;
  initialTab: 'fix' | 'optimize';
  onClose: () => void;
  currentMapEntry: MapIndexEntry | MapCompactEntry | null;
  currentMapData: PmsMapData | null;
  preferClassicBmp: boolean;
  batchCount: number;
  batchSourceLabel: string;
  onResolveBatchCandidates: () => Promise<MapCompactEntry[]>;
  onApplyLivePreviewMap: (previewData: PmsMapData, bannerText: string, layerQuality?: number) => void;
  onMetaUpdated: (meta: IndexMetaResponse) => void;
  onSelectMapById: (mapId: string) => void;
}

export const MapWorkshopModal: React.FC<MapWorkshopModalProps> = ({
  open,
  initialTab,
  onClose,
  currentMapEntry,
  currentMapData,
  preferClassicBmp,
  batchCount,
  batchSourceLabel,
  onResolveBatchCandidates,
  onApplyLivePreviewMap,
  onMetaUpdated,
  onSelectMapById,
}) => {
  const [tab, setTab] = useState<'fix' | 'optimize'>(initialTab);
  const [maxBaseLength, setMaxBaseLength] = useState<number>(24);

  // --- Tab 1: 1.7.1 Scenery Fixer (_f.pms) state ---
  const [fixScope, setFixScope] = useState<'single' | 'batch'>('single');
  const [fixDestination, setFixDestination] = useState<
    'soldat_maps' | 'exports_fixed' | 'custom'
  >('soldat_maps');
  const [fixCustomFolder, setFixCustomFolder] = useState('');
  const [fixRemoveUnused, setFixRemoveUnused] = useState(true);

  const [analysis, setAnalysis] = useState<MapFixAnalysisResponse | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [selectedIssueKeys, setSelectedIssueKeys] = useState<Set<string>>(() => new Set());
  const [fixingSingle, setFixingSingle] = useState(false);
  const [fixSingleResult, setFixSingleResult] = useState<FixMapResponse | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [pendingFixOverwrite, setPendingFixOverwrite] = useState<DerivedTargetCheck | null>(null);
  const [fixOverwriteExisting, setFixOverwriteExisting] = useState(false);

  // Batch _f scanner & fixer state
  const [scanningBatch, setScanningBatch] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchScanFixItem[] | null>(null);
  const [selectedBatchMapIds, setSelectedBatchMapIds] = useState<Set<string>>(() => new Set());
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [batchFixDoneSummary, setBatchFixDoneSummary] = useState<{
    fixedMapsCount: number;
    totalFixedProps: number;
    skippedExistingCount: number;
    failed: Array<{ mapId: string; error: string }>;
    outputDir: string | null;
  } | null>(null);

  // --- Tab 2: Optimize Sceneries (_o.pms) state ---
  const [mergeBack, setMergeBack] = useState(true);
  const [mergeMid, setMergeMid] = useState(true);
  const [mergeFront, setMergeFront] = useState(true);
  const [supersampleChoice, setSupersampleChoice] = useState<SupersampleChoice>('auto');
  const [pendingOptOverwrite, setPendingOptOverwrite] = useState<DerivedTargetCheck | null>(null);
  const [maxTilePx, setMaxTilePx] = useState<2048 | 4096>(2048);
  const [preserveGiantProps, setPreserveGiantProps] = useState(true);
  const [giantPropThresholdPx, setGiantPropThresholdPx] = useState(1600);
  const [skipIsolatedSingleProps, setSkipIsolatedSingleProps] = useState(true);
  const [optRemoveUnused, setOptRemoveUnused] = useState(true);
  const [fixFirst, setFixFirst] = useState(false);
  // Archive (`_a`): merged layers plus the map's own copies of every file it still uses
  const [archiveMode, setArchiveMode] = useState(false);
  const [optClassicBmp, setOptClassicBmp] = useState(preferClassicBmp);
  const [optDestination, setOptDestination] = useState<
    'soldat_maps' | 'exports_optimized' | 'custom'
  >('soldat_maps');
  const [optCustomFolder, setOptCustomFolder] = useState('');

  const [optPlan, setOptPlan] = useState<MapOptimizePlanResponse | null>(null);
  const [loadingOptPlan, setLoadingOptPlan] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optProgress, setOptProgress] = useState(0);
  const [optStatus, setOptStatus] = useState('');
  const [optResult, setOptResult] = useState<OptimizeSaveResponse | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [optPreview, setOptPreview] = useState<OptimizePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const abortOptRef = useRef<AbortController | null>(null);

  // Batch Optimize Sceneries (`_o`) for the pack / current filter
  const [optScope, setOptScope] = useState<'single' | 'batch'>('single');
  const [optBatchOverwriteOwn, setOptBatchOverwriteOwn] = useState(false);
  const [optBatchRunning, setOptBatchRunning] = useState(false);
  const [optBatchProgress, setOptBatchProgress] = useState<OptimizeBatchProgress | null>(null);
  const [optBatchSummary, setOptBatchSummary] = useState<OptimizeBatchSummary | null>(null);
  const [optBatchError, setOptBatchError] = useState<string | null>(null);

  // Layout effects run before paint, so reopening never flashes the previous tab or results
  useLayoutEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setOptClassicBmp(preferClassicBmp);
  }, [open, initialTab, preferClassicBmp]);

  useLayoutEffect(() => {
    if (!open) return;
    setFixError(null);
    setFixSingleResult(null);
    setOptError(null);
    setOptResult(null);
    setPendingFixOverwrite(null);
    setPendingOptOverwrite(null);
  }, [open, currentMapEntry?.id]);

  // A preview / plan belongs to one map; switching maps discards them
  useEffect(() => {
    setOptPreview(null);
    setOptPlan(null);
  }, [currentMapEntry?.id]);

  const supersample = resolveSupersample(supersampleChoice, optPlan);

  // Load 1.7.1 scenery analysis when modal opens on `fix` tab
  useEffect(() => {
    if (!open || tab !== 'fix' || fixScope !== 'single' || !currentMapEntry) return;
    let cancelled = false;
    setLoadingAnalysis(true);
    setFixError(null);
    // Never show (or apply!) the previous map's issues while this map is being analyzed
    setAnalysis(null);
    setSelectedIssueKeys(new Set());

    fetch(
      `/api/workshop/fix-analyze/${encodeURIComponent(
        currentMapEntry.id
      )}?maxLen=${maxBaseLength}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        const parsed = data as MapFixAnalysisResponse;
        setAnalysis(parsed);
        setSelectedIssueKeys(
          new Set(parsed.issues.filter((i) => i.recommended).map((i) => i.key))
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setAnalysis(null);
        setSelectedIssueKeys(new Set());
        setFixError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingAnalysis(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, tab, fixScope, currentMapEntry?.id, maxBaseLength]);

  const optOptions: OptimizeMapOptions = useMemo(
    () => ({
      mergeBack,
      mergeMid,
      mergeFront,
      supersample,
      maxTilePx,
      preserveGiantProps,
      giantPropThresholdPx,
      skipIsolatedSingleProps,
      removeUnusedScenery: optRemoveUnused,
      preferClassicBmp: optClassicBmp,
      maxBaseLength,
      destination: optDestination,
      customOutputFolder: optCustomFolder || undefined,
      fixFirst,
      archive: archiveMode,
    }),
    [
      fixFirst,
      archiveMode,
      mergeBack,
      mergeMid,
      mergeFront,
      supersample,
      maxTilePx,
      preserveGiantProps,
      giantPropThresholdPx,
      skipIsolatedSingleProps,
      optRemoveUnused,
      optClassicBmp,
      maxBaseLength,
      optDestination,
      optCustomFolder,
    ]
  );

  // Load live Optimize Sceneries plan when modal is on `optimize` tab (destination is irrelevant for the plan)
  const planOptionsKey = currentMapEntry ? optimizeOptionsKey(currentMapEntry.id, optOptions) : '';
  useEffect(() => {
    if (!open || tab !== 'optimize' || !currentMapEntry) return;
    const controller = new AbortController();
    setLoadingOptPlan(true);
    const timer = setTimeout(() => {
      fetchOptimizePlan(currentMapEntry.id, optOptions, controller.signal)
        .then((plan) => {
          setOptPlan(plan);
          setOptError(null);
        })
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') {
            setOptError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          // A superseded request must not hide the spinner of the request that replaced it
          if (!controller.signal.aborted) setLoadingOptPlan(false);
        });
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, planOptionsKey]);

  const backdropProps = useModalDismiss(
    open,
    onClose,
    fixingSingle || applyingBatch || optimizing || previewing || optBatchRunning
  );

  if (!open) return null;

  const derivedFixName = currentMapEntry
    ? makeDerivedMapName(currentMapEntry.baseName, '_f', maxBaseLength)
    : t('map_f');
  // A map that already is an Optimize result holds baked layers: baking them again only blurs them (the batch skips
  // such maps too); the original map should be optimized instead
  const isOptimizeResult = currentMapEntry ? /_(o|a)$/i.test(currentMapEntry.baseName) : false;
  // The server decides the final name (`_f_o` only when fixFirst really repaired something)
  const derivedOptName =
    optPlan && currentMapEntry && optPlan.mapId === currentMapEntry.id
      ? optPlan.derivedBaseName
      : currentMapEntry
      ? makeDerivedMapName(currentMapEntry.baseName, archiveMode ? '_a' : '_o', maxBaseLength)
      : archiveMode
      ? t('map_a')
      : t('map_o');
  const batchMapsLabel = tp(batchCount, '{n} map', '{n} maps', { n: batchCount.toLocaleString(locale) });
  const planFixCount =
    optPlan && currentMapEntry && optPlan.mapId === currentMapEntry.id ? optPlan.appliedPropFixes?.length ?? 0 : 0;

  const analysisMatchesMap = Boolean(analysis && currentMapEntry && analysis.mapId === currentMapEntry.id);
  const selectedPropFixCount = (analysisMatchesMap ? analysis?.issues || [] : [])
    .filter((i) => selectedIssueKeys.has(i.key))
    .reduce((acc, i) => acc + i.propIndices.length, 0);

  const handleToggleIssueKey = (key: string) => {
    setSelectedIssueKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleLivePreviewFix = () => {
    if (!currentMapData || !analysis || !analysisMatchesMap) return;
    const fixesMap = new Map<number, { width: number; height: number }>();
    for (const issue of analysis.issues) {
      if (!selectedIssueKeys.has(issue.key)) continue;
      for (const pIdx of issue.propIndices) {
        fixesMap.set(pIdx, { width: issue.expectedWidth, height: issue.expectedHeight });
      }
    }
    const previewPms = cloneMapWithPropFixes(currentMapData, fixesMap);
    onApplyLivePreviewMap(
      previewPms,
      tp(
        fixesMap.size,
        'Live 1.7.1 fix preview ({n} scenery fixed → {name}.pms)',
        'Live 1.7.1 fix preview ({n} sceneries fixed → {name}.pms)',
        { name: derivedFixName }
      )
    );
    onClose();
  };

  const handleApplySingleFix = async (confirmedOverwrite = false) => {
    if (!currentMapEntry || !analysisMatchesMap) return;
    setFixingSingle(true);
    setFixError(null);
    setFixSingleResult(null);
    setPendingFixOverwrite(null);

    try {
      if (!confirmedOverwrite) {
        const checkRes = await fetch('/api/workshop/fix-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mapId: currentMapEntry.id,
            maxBaseLength,
            destination: fixDestination,
            customOutputFolder: fixCustomFolder || undefined,
          }),
        });
        const check = await checkRes.json();
        if (!checkRes.ok) throw new Error(check.error || t('Could not check the target file.'));
        if ((check as DerivedTargetCheck).mapExists) {
          setPendingFixOverwrite(check as DerivedTargetCheck);
          return;
        }
      }

      const res = await fetch('/api/workshop/fix-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapId: currentMapEntry.id,
          selectedIssueKeys: Array.from(selectedIssueKeys),
          removeUnusedScenery: fixRemoveUnused,
          maxBaseLength,
          destination: fixDestination,
          customOutputFolder: fixCustomFolder || undefined,
          overwriteExisting: confirmedOverwrite,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Could not save the _f.pms map'));
      setFixSingleResult(data.result);
      if (data.meta) onMetaUpdated(data.meta);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : String(err));
    } finally {
      setFixingSingle(false);
    }
  };

  const handleScanBatchIssues = async () => {
    setScanningBatch(true);
    setFixError(null);
    setBatchFixDoneSummary(null);
    try {
      const candidates = await onResolveBatchCandidates();
      const mapIds = candidates.map((c) => c.id);
      const res = await fetch('/api/workshop/fix-batch-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapIds,
          maxBaseLength,
          destination: fixDestination,
          customOutputFolder: fixCustomFolder || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Batch scan failed'));
      const found = data.items as BatchScanFixItem[];
      setBatchItems(found);
      // Select maps that don't already have a _f sibling (and don't collide with another map's name) by default
      setSelectedBatchMapIds(
        new Set(found.filter((i) => !i.alreadyHasFixedSibling && !i.nameCollisionWith).map((i) => i.mapId))
      );
    } catch (err) {
      setFixError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanningBatch(false);
    }
  };

  const handleApplyBatchFix = async () => {
    if (selectedBatchMapIds.size === 0) return;
    setApplyingBatch(true);
    setFixError(null);
    try {
      const res = await fetch('/api/workshop/fix-batch-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapIds: Array.from(selectedBatchMapIds),
          removeUnusedScenery: fixRemoveUnused,
          maxBaseLength,
          destination: fixDestination,
          customOutputFolder: fixCustomFolder || undefined,
          overwriteExisting: fixOverwriteExisting,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Batch fix failed'));
      setBatchFixDoneSummary({
        fixedMapsCount: data.fixedMapsCount,
        totalFixedProps: data.totalFixedProps,
        skippedExistingCount: data.skippedExistingCount ?? 0,
        failed: Array.isArray(data.failed) ? data.failed : [],
        outputDir: data.outputDir,
      });
      if (data.meta) onMetaUpdated(data.meta);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingBatch(false);
    }
  };

  const previewIsCurrent =
    optPreview !== null &&
    currentMapEntry !== null &&
    optPreview.optionsKey === optimizeOptionsKey(currentMapEntry.id, optOptions);

  const handleBuildPreview = async () => {
    if (!currentMapEntry || !currentMapData) return;
    const controller = new AbortController();
    abortOptRef.current = controller;
    setPreviewing(true);
    setOptError(null);
    setOptProgress(0);
    try {
      const preview = await buildOptimizePreview(
        currentMapEntry.id,
        currentMapData,
        optOptions,
        (p, msg) => {
          setOptProgress(p);
          setOptStatus(msg);
        },
        controller.signal
      );
      setOptPreview(preview);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setOptError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPreviewing(false);
      abortOptRef.current = null;
    }
  };

  const handleShowPreviewInViewport = () => {
    if (!optPreview || !currentMapEntry) return;
    const f = optPreview.fidelity;
    // The quality the preview was baked with (the select may have changed since)
    const quality = Number(JSON.parse(optPreview.optionsKey).supersample) || supersample;
    const banner = t('Optimize result preview ({name}.pms, {ss}×, not saved)', { name: derivedOptName, ss: quality });
    onApplyLivePreviewMap(
      optPreview.previewMap,
      f
        ? `${banner} — ${t('sharpness {pct}% of the original, avg. difference {diff}', {
            pct: f.sharpnessPct,
            diff: f.meanAbsDiff,
          })}`
        : banner,
      quality
    );
    onClose();
  };

  const handleRunOptimization = async (confirmedOverwrite = false) => {
    if (!currentMapEntry || !currentMapData) return;
    const controller = new AbortController();
    abortOptRef.current = controller;
    setOptimizing(true);
    setOptError(null);
    setOptResult(null);
    setOptProgress(0);
    setPendingOptOverwrite(null);

    try {
      if (!confirmedOverwrite) {
        const check = await checkOptimizeTarget(currentMapEntry.id, optOptions);
        if (check.mapExists) {
          setPendingOptOverwrite(check);
          return;
        }
      }
      const { result, meta } = await executeSceneryOptimization(
        currentMapEntry.id,
        currentMapData,
        optOptions,
        confirmedOverwrite,
        (p, msg) => {
          setOptProgress(p);
          setOptStatus(msg);
        },
        controller.signal,
        // Reuse the tiles of an up-to-date preview instead of baking everything again
        previewIsCurrent && optPreview ? { plan: optPreview.plan, tiles: optPreview.tiles } : undefined
      );
      setOptResult(result);
      onMetaUpdated(meta);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setOptError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setOptimizing(false);
      abortOptRef.current = null;
    }
  };

  const handleRunOptimizeBatch = async () => {
    const controller = new AbortController();
    abortOptRef.current = controller;
    setOptBatchRunning(true);
    setOptBatchError(null);
    setOptBatchSummary(null);
    setOptBatchProgress(null);
    try {
      const candidates = await onResolveBatchCandidates();
      if (candidates.length === 0) throw new Error(t('No maps to optimize in the pack selection / current filter.'));
      const summary = await runOptimizeBatch(
        candidates,
        optOptions,
        supersampleChoice,
        optBatchOverwriteOwn,
        setOptBatchProgress,
        controller.signal
      );
      setOptBatchSummary(summary);
      if (summary.done > 0 && optDestination === 'soldat_maps') {
        // Commits skipped the per-map rescan; pick up all new `_o` maps at once
        try {
          onMetaUpdated(await fetchIndexMeta(true));
        } catch {
          // The index catches up on the next scan
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setOptBatchError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setOptBatchRunning(false);
      setOptBatchProgress(null);
      abortOptRef.current = null;
    }
  };

  const optDestinationLabel =
    optDestination === 'soldat_maps'
      ? t('Soldat/maps (visible in the game right away)')
      : optDestination === 'exports_optimized'
      ? archiveMode
        ? 'exports/archived_maps'
        : 'exports/optimized_maps'
      : optCustomFolder.trim() || t('custom folder (none chosen)');

  const reductionPct =
    optPlan && optPlan.totalActivePropsBefore > 0
      ? Math.max(
          0,
          Math.round(
            ((optPlan.totalActivePropsBefore - optPlan.estimatedTotalPropsAfter) /
              optPlan.totalActivePropsBefore) *
              100
          )
        )
      : 0;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Wrench className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">
                {tr('PMS Map Workshop — 1.7.1 Scenery Fix ({f}) and Optimize Sceneries ({o})', {
                  f: <code>_f</code>,
                  o: <code>_o</code>,
                })}
              </h2>
              <p className="text-[11px] text-zinc-400">
                {t('Lossless editing of the scenery tables that keeps polygon physics, collision sectors, spawn points and bot waypoints 100% intact')}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={optimizing || fixingSingle || applyingBatch || previewing || optBatchRunning}
            onClick={onClose}
            aria-label={t('Close workshop')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Feature Tabs + Max Filename Length Setting */}
        <div className="px-5 py-2.5 bg-zinc-950/50 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-1 gap-1">
            <button
              type="button"
              onClick={() => setTab('fix')}
              className={`px-3.5 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'fix'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              {t('1. Soldat 1.7.1 Scenery Fix (_f.pms)')}
            </button>
            <button
              type="button"
              onClick={() => setTab('optimize')}
              className={`px-3.5 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                tab === 'optimize'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              {t('2. Optimize Sceneries — Layer Merging (_o.pms)')}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400 text-[11px]">{t('Map name length limit:')}</span>
            <select
              value={maxBaseLength}
              onChange={(e) => setMaxBaseLength(Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
              title={t('If the name with the _f or _o suffix exceeds this limit, the end of the base name is cut off before the suffix is added')}
            >
              <option value={16}>{t('16 characters (Soldat 1.6)')}</option>
              <option value={20}>{t('20 characters')}</option>
              <option value={24}>{t('24 characters (recommended)')}</option>
              <option value={32}>{t('32 characters (OpenSoldat)')}</option>
            </select>
          </div>
        </div>

        {/* Body */}
        {tab === 'fix' ? (
          <div className="flex-1 min-h-0 flex flex-col p-5 space-y-4 overflow-y-auto text-xs">
            {/* Scope Switch: Current Map vs Collection Batch */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid grid-cols-2 gap-1.5 bg-zinc-950 border border-zinc-800 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setFixScope('single')}
                  className={`px-3 py-1.5 rounded font-semibold cursor-pointer ${
                    fixScope === 'single'
                      ? 'bg-zinc-800 text-amber-300 border border-amber-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t('Current map ({name} → {derived}.pms)', {
                    name: currentMapEntry?.baseName || '—',
                    derived: derivedFixName,
                  })}
                </button>
                <button
                  type="button"
                  onClick={() => setFixScope('batch')}
                  className={`px-3 py-1.5 rounded font-semibold cursor-pointer ${
                    fixScope === 'batch'
                      ? 'bg-zinc-800 text-amber-300 border border-amber-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t('Batch Scan & Fix ({count} — {source})', { count: batchMapsLabel, source: batchSourceLabel })}
                </button>
              </div>

              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fixRemoveUnused}
                  onChange={(e) => setFixRemoveUnused(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-amber-500"
                />
                {t('Also remove dead (unused) scenery entries from the .pms header')}
              </label>
            </div>

            {/* Destination Selector */}
            <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 grid grid-cols-12 gap-3 items-center">
              <div className="col-span-5">
                <label className="block text-[11px] text-zinc-400 mb-1">
                  {tr('Where to save the {files} files:', { files: <code>*_f.pms</code> })}
                </label>
                <select
                  value={fixDestination}
                  onChange={(e) =>
                    setFixDestination(
                      e.target.value as 'soldat_maps' | 'exports_fixed' | 'custom'
                    )
                  }
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="soldat_maps">
                    {t('Straight into Soldat/maps/ (visible in the game and Studio right away)')}
                  </option>
                  <option value="exports_fixed">
                    {t('Separate project folder: exports/fixed_maps/maps/')}
                  </option>
                  <option value="custom">{t('Custom folder on disk...')}</option>
                </select>
              </div>

              <div className="col-span-7">
                {fixDestination === 'custom' ? (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      {t('Target folder path:')}
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={fixCustomFolder}
                        onChange={(e) => setFixCustomFolder(e.target.value)}
                        placeholder={t('Choose a folder...')}
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 font-mono text-zinc-200"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const p = await pickSystemFolder(t('Choose where to save the _f.pms maps'));
                          if (p) setFixCustomFolder(p);
                        }}
                        className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                      >
                        {t('Browse...')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-400 leading-relaxed">
                    <strong className="text-zinc-200">{t('How does the automatic 1.7.1 fix work?')}</strong>{' '}
                    {tr(
                      "It finds sceneries the old MapMaker stretched to powers of two (e.g. {pot} instead of {a} or {b}) and sceneries enlarged {hd} after saving with HD textures in the old PolyWorks, and restores their exact 1:1 proportions without touching the author's scale.",
                      {
                        pot: <code>64×64</code>,
                        a: <code>25×17</code>,
                        b: <code>41×67</code>,
                        hd: <code>4.5×</code>,
                      }
                    )}
                  </div>
                )}
              </div>
            </div>

            {fixScope === 'single' ? (
              <>
                {/* Single Map Diagnostic Table */}
                <div className="flex-1 min-h-48 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                  <div className="px-3.5 py-2 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between">
                    <span className="font-semibold text-zinc-200">
                      {tr('Scenery check of map {name}', {
                        name: <code className="text-amber-300">{currentMapEntry?.baseName}</code>,
                      })}
                      {loadingAnalysis ? ` • ${t('analyzing...')}` : ''}
                    </span>
                    {analysis && (
                      <span className="text-[11px] text-zinc-400">
                        {tr('Sceneries to fix: {selected} / {total} active • Dead entries: {dead}', {
                          selected: <strong className="text-amber-300 font-mono">{selectedPropFixCount}</strong>,
                          total: analysis.totalActiveProps,
                          dead: (
                            <strong className="font-mono text-zinc-300">
                              {analysis.unusedSceneryCount}
                            </strong>
                          ),
                        })}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-zinc-900">
                    {!currentMapEntry ? (
                      <div className="p-8 text-center text-zinc-500">
                        {t('Select a map in the browser to analyze its sceneries.')}
                      </div>
                    ) : !analysis || !analysisMatchesMap || loadingAnalysis ? (
                      <div className="p-8 text-center text-zinc-500">
                        {fixError && !loadingAnalysis
                          ? t('Could not analyze this map (details below).')
                          : t('Checking scenery sizes against the Soldat 1.6 table and the files on disk...')}
                      </div>
                    ) : analysis.issues.length === 0 ? (
                      <div className="p-8 text-center space-y-1.5">
                        <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto" />
                        <div className="font-semibold text-emerald-300">
                          {t('All sceneries on this map already have correct 1.7.1 sizes!')}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {t('No stretched Power-of-Two textures or wrong 4.5× HD scaling found.')}
                        </div>
                      </div>
                    ) : (
                      analysis.issues.map((issue) => {
                        const checked = selectedIssueKeys.has(issue.key);
                        return (
                          <label
                            key={issue.key}
                            className={`px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-zinc-900/60 ${
                              checked ? 'bg-amber-500/5' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleIssueKey(issue.key)}
                                className="rounded border-zinc-700 bg-zinc-900 text-amber-500"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-zinc-100">
                                    {issue.sceneryName}
                                  </span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                      issue.recommended
                                        ? 'bg-amber-500/15 text-amber-200 border-amber-500/35'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                                    }`}
                                  >
                                    {issue.recommended ? t('Definite 1.7.1 error') : t('Optional difference')}
                                  </span>
                                  {issue.isVanilla && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/25">
                                      Vanilla 1.6
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-zinc-400 mt-0.5">
                                  {tText(issue.reasonLabelPl)} • {t("author's scale (sample):")}{' '}
                                  <code className="font-mono text-zinc-300">
                                    {issue.sampleScaleX.toFixed(2)} × {issue.sampleScaleY.toFixed(2)}
                                  </code>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 font-mono">
                              <SceneryFixThumbs issue={issue} />
                              <div className="text-right">
                                <span className="text-red-300 line-through">
                                  {issue.pmsWidth}×{issue.pmsHeight}
                                </span>{' '}
                                <span className="text-zinc-500">→</span>{' '}
                                <span className="text-emerald-300 font-bold">
                                  {issue.expectedWidth}×{issue.expectedHeight}
                                </span>
                              </div>
                              <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px]">
                                ×{issue.propIndices.length}
                              </span>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {fixError && (
                  <div className="bg-red-950/80 border border-red-700 rounded-lg px-3.5 py-2 text-red-200">
                    {fixError}
                  </div>
                )}

                {pendingFixOverwrite && (
                  <OverwriteConfirmPanel
                    check={pendingFixOverwrite}
                    onConfirm={() => handleApplySingleFix(true)}
                    onCancel={() => setPendingFixOverwrite(null)}
                  />
                )}

                {fixSingleResult && (
                  <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-emerald-200">
                          {tr('Saved the fixed map: {file} (sceneries fixed: {fixed}, dead entries removed: {removed})', {
                            file: <code>{fixSingleResult.outputFileName}</code>,
                            fixed: fixSingleResult.fixedPropCount,
                            removed: fixSingleResult.removedUnusedSceneryCount,
                          })}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 truncate">
                          {fixSingleResult.outputPath}
                        </div>
                        {fixSingleResult.backupDir && (
                          <div className="text-[11px] text-sky-300 truncate" title={fixSingleResult.backupDir}>
                            {t('Previous version of the file saved in a backup: {dir}', { dir: fixSingleResult.backupDir })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openPathInExplorer(fixSingleResult.outputPath)}
                        className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> {t('Show folder')}
                      </button>
                      {fixSingleResult.newMapId && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectMapById(fixSingleResult.newMapId!);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" /> {t('Open {name}', { name: fixSingleResult.derivedBaseName })}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Single Fix Footer */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    disabled={selectedPropFixCount === 0 || !currentMapData}
                    onClick={handleLivePreviewFix}
                    className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-amber-200 border border-amber-500/30 font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-4 h-4 text-amber-400" />
                    {t('Live fix preview in the map view (not saved)')}
                  </button>

                  <button
                    type="button"
                    disabled={
                      fixingSingle ||
                      loadingAnalysis ||
                      !analysisMatchesMap ||
                      (selectedPropFixCount === 0 &&
                        (!fixRemoveUnused || (analysis?.unusedSceneryCount ?? 0) === 0))
                    }
                    onClick={() => handleApplySingleFix(false)}
                    className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold flex items-center gap-2 shadow-lg shadow-amber-950/50 cursor-pointer"
                  >
                    <Wrench className="w-4 h-4" />
                    {fixingSingle
                      ? t('Saving...')
                      : t('Fix and save {name}.pms', { name: derivedFixName })}
                  </button>
                </div>
              </>
            ) : (
              /* Batch Collection Scanner & Fixer */
              <div className="flex-1 min-h-48 flex flex-col space-y-3">
                <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5">
                  <div>
                    <div className="font-semibold text-zinc-200">
                      {t('Automatic scanner for broken 1.7.1 sceneries in the collection ({count} — {source})', {
                        count: batchMapsLabel,
                        source: batchSourceLabel,
                      })}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {tr('Searches e.g. all RSCS maps ({cs}, {de}) and Trenchwars ({tw}, {ttw}) and finds stretched sceneries', {
                        cs: <code>ctf_cs_</code>,
                        de: <code>ctf_de_</code>,
                        tw: <code>tw_</code>,
                        ttw: <code>ttw_</code>,
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={scanningBatch || applyingBatch}
                    onClick={handleScanBatchIssues}
                    className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Search className="w-4 h-4" />
                    {scanningBatch ? t('Scanning maps...') : t('Scan maps for 1.7.1 errors')}
                  </button>
                </div>

                <div className="flex-1 min-h-44 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                  {batchItems === null ? (
                    <div className="p-8 text-center text-zinc-500">
                      {t('Click “{button}” to find every map with stretched sceneries in a few seconds.', {
                        button: t('Scan maps for 1.7.1 errors'),
                      })}
                    </div>
                  ) : batchItems.length === 0 ? (
                    <div className="p-8 text-center text-emerald-300 font-semibold">
                      {t('No broken 1.7.1 maps found in the selected set!')}
                    </div>
                  ) : (
                    <>
                      <div className="px-3.5 py-2 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between">
                        <span className="font-semibold text-zinc-200">
                          {t('Maps with scenery errors: {count} (selected: {selected})', {
                            count: batchItems.length,
                            selected: selectedBatchMapIds.size,
                          })}
                        </span>
                        <div className="flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedBatchMapIds(new Set(batchItems.map((i) => i.mapId)))
                            }
                            className="text-amber-300 hover:underline cursor-pointer"
                          >
                            {t('Select all')}
                          </button>
                          <span className="text-zinc-700">•</span>
                          <button
                            type="button"
                            onClick={() => setSelectedBatchMapIds(new Set())}
                            className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            {t('Select none')}
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto divide-y divide-zinc-900">
                        {batchItems.map((item) => {
                          const checked = selectedBatchMapIds.has(item.mapId);
                          return (
                            <label
                              key={item.mapId}
                              className="px-3.5 py-2 flex items-center justify-between gap-3 cursor-pointer hover:bg-zinc-900/60"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedBatchMapIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(item.mapId)) next.delete(item.mapId);
                                      else next.add(item.mapId);
                                      return next;
                                    });
                                  }}
                                  className="rounded border-zinc-700 bg-zinc-900 text-amber-500"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-zinc-100">
                                      {item.baseName}
                                    </span>
                                    <span className="text-zinc-500">→</span>
                                    <span className="font-mono text-amber-300 font-semibold">
                                      {item.derivedBaseName}.pms
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                      {tText(item.modeGroupName)}
                                    </span>
                                    {item.alreadyHasFixedSibling && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                        {t('Already has an _f file on disk')}
                                      </span>
                                    )}
                                    {item.nameCollisionWith && (
                                      <span
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30"
                                        title={t('Once the names are shortened, both maps would produce the same _f file — change the name length limit')}
                                      >
                                        {t('Same output name as {name}', { name: item.nameCollisionWith })}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                                    {item.issueSummary.join(' • ')}
                                  </div>
                                </div>
                              </div>
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30 shrink-0">
                                {tp(item.affectedPropCount, '{n} scenery to fix', '{n} sceneries to fix')}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {fixError && (
                  <div className="bg-red-950/80 border border-red-700 rounded-lg px-3.5 py-2 text-red-200">
                    {fixError}
                  </div>
                )}

                {batchFixDoneSummary && (
                  <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-emerald-200 font-semibold">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        {tp(
                          batchFixDoneSummary.fixedMapsCount,
                          'Created {n} fixed *_f.pms map (sceneries corrected in total: {props})',
                          'Created {n} fixed *_f.pms maps (sceneries corrected in total: {props})',
                          { props: batchFixDoneSummary.totalFixedProps }
                        )}
                      </div>
                      {batchFixDoneSummary.skippedExistingCount > 0 && (
                        <div className="text-[11px] text-sky-300">
                          {tp(
                            batchFixDoneSummary.skippedExistingCount,
                            'Skipped {n} map whose _f file already existed (tick “Overwrite existing” to recreate it).',
                            'Skipped {n} maps whose _f file already existed (tick “Overwrite existing” to recreate them).'
                          )}
                        </div>
                      )}
                      {batchFixDoneSummary.failed.length > 0 && (
                        <div className="text-[11px] text-red-300 truncate" title={batchFixDoneSummary.failed.map((f) => `${f.mapId}: ${f.error}`).join('\n')}>
                          {t('Errors: {count} (e.g. {map}: {error})', {
                            count: batchFixDoneSummary.failed.length,
                            map: batchFixDoneSummary.failed[0].mapId,
                            error: batchFixDoneSummary.failed[0].error,
                          })}
                        </div>
                      )}
                    </div>
                    {batchFixDoneSummary.outputDir && (
                      <button
                        type="button"
                        onClick={() => openPathInExplorer(batchFixDoneSummary.outputDir!)}
                        className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> {t('Open folder')}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fixOverwriteExisting}
                      onChange={(e) => setFixOverwriteExisting(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900 text-amber-500"
                    />
                    {tr('Overwrite existing {file} files (skipped by default)', { file: <code>_f.pms</code> })}
                  </label>
                  <button
                    type="button"
                    disabled={applyingBatch || selectedBatchMapIds.size === 0}
                    onClick={handleApplyBatchFix}
                    className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold flex items-center gap-2 shadow-lg shadow-amber-950/50 cursor-pointer"
                  >
                    <Wrench className="w-4 h-4" />
                    {applyingBatch
                      ? t('Fixing the selected maps...')
                      : t('Fix selected maps ({count}) → *_f.pms', { count: selectedBatchMapIds.size })}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* TAB 2: OPTIMIZE SCENERIES — LAYER MERGER (_o.pms) */
          <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-zinc-800 text-xs overflow-hidden">
            {/* Left Settings Column */}
            <div className="col-span-6 p-5 space-y-3.5 overflow-y-auto">
              <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  {tr('Layers to merge (like the manual optimization in {map})', { map: <code>deagle5</code> })}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {t('Merges dozens or hundreds of overlapping bricks, shadows, walls and bushes on the same layer into single, perfectly aligned PNG sheets — completely removing alpha flickering and taking load off the game engine.')}
                </p>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <LayerMergeCard
                    checked={mergeBack}
                    onChange={setMergeBack}
                    title={t('Layer 0: Back')}
                    subtitle={t('Behind the player')}
                  />
                  <LayerMergeCard
                    checked={mergeMid}
                    onChange={setMergeMid}
                    title={t('Layer 1: Middle')}
                    subtitle={t('Behind the polygons')}
                  />
                  <LayerMergeCard
                    checked={mergeFront}
                    onChange={setMergeFront}
                    title={t('Layer 2: Front')}
                    subtitle={t('Hiding spots')}
                  />
                </div>
              </div>

              {/* Fix 1.7.1 sizes first (A5): one click instead of _f followed by _o */}
              <label className="flex items-start gap-2.5 bg-zinc-950/80 border border-amber-500/25 rounded-lg p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fixFirst}
                  onChange={(e) => setFixFirst(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold text-zinc-200">
                    {tr('Fix the 1.7.1 scenery sizes first (like {f}), then merge', { f: <code>_f</code> })}
                  </span>
                  <span className="block text-[11px] text-zinc-400 leading-relaxed">
                    {tr(
                      'Merging a map with stretched sceneries would bake the error into the PNG layers. The recommended fixes are applied in memory (no intermediate file) and the result is named {name}.',
                      { name: <code>_f_o</code> }
                    )}
                    {fixFirst && optPlan && optPlan.mapId === currentMapEntry?.id && (
                      <span className={planFixCount > 0 ? 'text-amber-300' : 'text-zinc-500'}>
                        {' '}
                        {planFixCount > 0
                          ? tp(
                              planFixCount,
                              'This map: {n} scenery will be fixed before merging.',
                              'This map: {n} sceneries will be fixed before merging.'
                            )
                          : t('This map needs no fixes — the result will be saved as a plain _o.')}
                      </span>
                    )}
                  </span>
                </span>
              </label>

              {/* Archive (_a): the map keeps working when shared files are replaced by other packs or a game update */}
              <label className="flex items-start gap-2.5 bg-zinc-950/80 border border-sky-500/30 rounded-lg p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={archiveMode}
                  onChange={(e) => setArchiveMode(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-sky-500"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold text-zinc-200">
                    {tr('Archive the map ({a}): its own copy of every file it uses', { a: <code>_a</code> })}
                  </span>
                  <span className="block text-[11px] text-zinc-400 leading-relaxed">
                    {t('Merges the layers like Optimize, default sceneries included, then gives every scenery that stays a single prop and the polygon texture a copy named after the map. Another pack or a game update can no longer replace them. Unused entries are removed.')}
                    {archiveMode && (
                      <span className="text-sky-300">
                        {' '}
                        {tr('Result: {name}. Turn off all three layers to only copy the files, without baking.', {
                          name: <code>{derivedOptName}.pms</code>,
                        })}
                      </span>
                    )}
                  </span>
                </span>
              </label>

              {/* Quality & Tile Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    {t('PNG layer quality')}
                  </label>
                  <select
                    value={String(supersampleChoice)}
                    onChange={(e) =>
                      setSupersampleChoice(
                        e.target.value === 'auto'
                          ? 'auto'
                          : (Number(e.target.value) as 1 | 2 | 3 | 4)
                      )
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="auto">
                      {t('Auto — the sharpest that fits the memory limit (now: {ss}×)', { ss: supersample })}
                    </option>
                    <option value={1}>{t('1× Economy — blurry in game (thin details fade)')}</option>
                    <option value={2}>{t('2× Medium — slightly soft at 1080p (scale 0.5)')}</option>
                    <option value={3}>{t('3× Sharp — good for 1080p (scale 0.333)')}</option>
                    <option value={4}>{t('4× Maximum — sharpest: HD sceneries, 1440p and 4K (large files, scale 0.25)')}</option>
                  </select>
                  {optPlan && (
                    <div className="text-[10px] text-zinc-500 mt-1">
                      {t(
                        'Layer size: up to {mp} MPx (~{mb} MB VRAM, empty areas are cropped). At 1080p the game shows about 2.25 px per world unit: 1× is clearly blurry, 2× a little soft, 3× sharp; 4× keeps the most detail of HD sceneries and pays off from 1440p up.',
                        {
                          mp: optPlan.estimatedMegapixelsBySupersample[supersample - 1].toFixed(1),
                          mb: Math.round(optPlan.estimatedMegapixelsBySupersample[supersample - 1] * 4),
                        }
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    {t('Maximum PNG tile size')}
                  </label>
                  <select
                    value={maxTilePx}
                    onChange={(e) => setMaxTilePx(Number(e.target.value) as 2048 | 4096)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value={2048}>{t('2048 × 2048 px (100% GPU compatibility)')}</option>
                    <option value={4096}>{t('4096 × 4096 px (fewer files, more texture memory)')}</option>
                  </select>
                </div>
              </div>

              {/* Author-Intent Protection Rules */}
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {t("Author's Intent Protection (Z-Order Safe)")}
                </div>

                <label className="flex items-start gap-2 opacity-90">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  <div>
                    <div className="text-zinc-200">
                      {tr('Always keep animated {gif} sceneries separate (fire, water, blinking lamps)', {
                        gif: <code>.gif</code>,
                      })}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {t('Splits the layer before and after the animation, keeping the order in which objects cover each other 100% intact')}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveGiantProps}
                    onChange={(e) => setPreserveGiantProps(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  <div className="flex-1">
                    <div className="text-zinc-200 flex items-center justify-between gap-2">
                      <span>{tr('Keep huge backgrounds / fog (e.g. {file}) without baking', { file: <code>fade.png</code> })}</span>
                      {preserveGiantProps && (
                        <input
                          type="number"
                          min={500}
                          max={8000}
                          step={100}
                          value={giantPropThresholdPx}
                          onChange={(e) => setGiantPropThresholdPx(Number(e.target.value) || 1600)}
                          className="w-20 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-200"
                          title={t('Scenery size threshold in the game world (px)')}
                        />
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {t('Prevents giant empty sky textures from being generated outside the play area')}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipIsolatedSingleProps}
                    onChange={(e) => setSkipIsolatedSingleProps(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  <div>
                    <div className="text-zinc-200">
                      {t("Don't create a new PNG for a single isolated scenery (e.g. the author's signature)")}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optClassicBmp}
                    onChange={(e) => setOptClassicBmp(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  <div>
                    <div className="text-zinc-200">
                      {tr('Use the classic Soldat 1.6 textures ({bmp}) instead of HD ({png}) when merging', {
                        bmp: <code>.bmp</code>,
                        png: <code>.png</code>,
                      })}
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optRemoveUnused || archiveMode}
                    disabled={archiveMode}
                    onChange={(e) => setOptRemoveUnused(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  <div>
                    <div className="text-zinc-200">
                      {tr('Clear old, replaced scenery entries from the {pms} header', { pms: <code>.pms</code> })}
                    </div>
                  </div>
                </label>
              </div>

              {/* Destination */}
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  {tr('Where to save the map {map} and the generated PNGs:', { map: <code>{derivedOptName}.pms</code> })}
                </label>
                <select
                  value={optDestination}
                  onChange={(e) =>
                    setOptDestination(
                      e.target.value as 'soldat_maps' | 'exports_optimized' | 'custom'
                    )
                  }
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="soldat_maps">
                    {t('Straight into Soldat (maps/ + scenery-gfx/ — ready for preview and an MPA pack!)')}
                  </option>
                  <option value="exports_optimized">
                    {archiveMode
                      ? t('Separate folder: exports/archived_maps/ (maps/ + scenery-gfx/ + textures/)')
                      : t('Separate folder: exports/optimized_maps/ (maps/ + scenery-gfx/)')}
                  </option>
                  <option value="custom">{t('Custom folder on disk...')}</option>
                </select>

                {optDestination === 'custom' && (
                  <div className="flex gap-1.5 mt-2">
                    <input
                      type="text"
                      value={optCustomFolder}
                      onChange={(e) => setOptCustomFolder(e.target.value)}
                      placeholder={t('Choose the target folder...')}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 font-mono text-zinc-200"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const p = await pickSystemFolder(t('Choose a folder for the optimized _o map'));
                        if (p) setOptCustomFolder(p);
                      }}
                      className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                    >
                      ...
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Plan Preview & Execution Column */}
            <div className="col-span-6 p-5 flex flex-col space-y-3.5 overflow-y-auto">
              {/* Scope Switch: Current Map vs Collection Batch */}
              <div className="grid grid-cols-2 gap-1.5 bg-zinc-950 border border-zinc-800 p-1 rounded-lg shrink-0">
                <button
                  type="button"
                  disabled={optBatchRunning}
                  onClick={() => setOptScope('single')}
                  className={`px-3 py-1.5 rounded font-semibold truncate cursor-pointer disabled:cursor-not-allowed ${
                    optScope === 'single'
                      ? 'bg-zinc-800 text-emerald-300 border border-emerald-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t('Current map ({name})', { name: currentMapEntry?.baseName || '—' })}
                </button>
                <button
                  type="button"
                  disabled={optimizing || previewing}
                  onClick={() => setOptScope('batch')}
                  className={`px-3 py-1.5 rounded font-semibold truncate cursor-pointer disabled:cursor-not-allowed ${
                    optScope === 'batch'
                      ? 'bg-zinc-800 text-emerald-300 border border-emerald-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t('Batch ({count} — {source})', { count: batchMapsLabel, source: batchSourceLabel })}
                </button>
              </div>

              {optScope === 'batch' ? (
                <OptimizeBatchPanel
                  batchCount={batchCount}
                  batchSourceLabel={batchSourceLabel}
                  supersampleChoice={supersampleChoice}
                  archive={archiveMode}
                  destinationLabel={optDestinationLabel}
                  canStart={batchCount > 0 && (optDestination !== 'custom' || optCustomFolder.trim().length > 0)}
                  overwriteOwn={optBatchOverwriteOwn}
                  onChangeOverwriteOwn={setOptBatchOverwriteOwn}
                  running={optBatchRunning}
                  progress={optBatchProgress}
                  summary={optBatchSummary}
                  error={optBatchError}
                  onStart={handleRunOptimizeBatch}
                  onCancel={() => abortOptRef.current?.abort()}
                />
              ) : (
              <>
              {isOptimizeResult && currentMapEntry && (
                <div className="bg-amber-950/40 border border-amber-600/50 rounded-lg px-3 py-2 text-amber-100 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    {t(
                      '{name} is already an Optimize Sceneries result: its sceneries are baked layers. Baking them again only blurs them, so optimize the original map ({original}) instead.',
                      { name: currentMapEntry.baseName, original: stripDerivedSuffix(currentMapEntry.baseName) }
                    )}
                  </span>
                </div>
              )}
              {/* Summary Metrics */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="text-[10px] text-zinc-500">{t('Sceneries before')}</div>
                  <div className="font-mono text-base font-bold text-zinc-200 mt-0.5">
                    {optPlan?.totalActivePropsBefore ?? '—'}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="text-[10px] text-zinc-500">{t('Estimated after merging')}</div>
                  <div className="font-mono text-base font-bold text-emerald-300 mt-0.5">
                    {optPlan ? `≤ ${optPlan.estimatedTotalPropsAfter}` : '—'}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="text-[10px] text-zinc-500">{t('Object reduction')}</div>
                  <div className="font-mono text-base font-bold text-amber-300 mt-0.5">
                    {optPlan ? `-${reductionPct}%` : '—'}
                  </div>
                </div>
              </div>

              {/* Planned Layer Groups */}
              <div className="flex-1 min-h-40 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                <div className="px-3.5 py-2 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">
                    {tr('Layer merging plan → {map}', {
                      map: <code className="text-emerald-300">{derivedOptName}.pms</code>,
                    })}
                    {loadingOptPlan ? ` • ${t('recalculating...')}` : ''}
                  </span>
                  {optPlan && (
                    <span className="text-[11px] text-zinc-400">
                      {t('Groups: {groups} • Kept separate: {kept}', {
                        groups: optPlan.groups.length,
                        kept: optPlan.preservedPropsCount,
                      })}
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-zinc-900 p-2 space-y-1">
                  {!currentMapEntry ? (
                    <div className="p-6 text-center text-zinc-500">
                      {t('Select a map in the browser to compute the scenery merging plan.')}
                    </div>
                  ) : !optPlan ? (
                    <div className="p-6 text-center text-zinc-500">
                      {optError && !loadingOptPlan
                        ? t('Could not compute the plan for this map (details below).')
                        : t('Computing layer groups and tile bounds...')}
                    </div>
                  ) : optPlan.groups.length === 0 ? (
                    <div className="p-6 text-center text-zinc-500">
                      {t('No multi-scenery groups to merge with the current settings.')}
                    </div>
                  ) : (
                    optPlan.groups.map((grp) => {
                      const lvlName =
                        grp.level === 0
                          ? t('Layer 0 (Back)')
                          : grp.level === 1
                          ? t('Layer 1 (Middle)')
                          : t('Layer 2 (Front)');
                      return (
                        <div
                          key={grp.groupId}
                          className="px-2.5 py-2 rounded bg-zinc-900/50 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-semibold text-zinc-200">
                              {t('{layer} — run #{run}', { layer: lvlName, run: grp.runIndex })}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400">
                              {tp(
                                grp.tileCount,
                                'Area: {w} × {h} px • up to {n} PNG sheet (empty tiles are skipped)',
                                'Area: {w} × {h} px • up to {n} PNG sheets (empty tiles are skipped)',
                                { w: Math.round(grp.worldBounds.width), h: Math.round(grp.worldBounds.height) }
                              )}
                            </div>
                          </div>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                            {tp(grp.propIndices.length, 'merges {n} scenery', 'merges {n} sceneries')}
                          </span>
                        </div>
                      );
                    })
                  )}

                  {optPlan && optPlan.preservedSample.length > 0 && (
                    <div className="pt-2 px-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                        {t('Kept separate without baking ({count}):', { count: optPlan.preservedPropsCount })}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {optPlan.preservedSample.slice(0, 16).map((pr) => (
                          <span
                            key={pr.propIndex}
                            className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-400"
                            title={pr.reason}
                          >
                            {pr.sceneryName} (
                            {pr.reason === 'animated_gif'
                              ? 'GIF'
                              : pr.reason === 'giant_skybox'
                              ? t('Background/Fog')
                              : pr.reason === 'single_isolated'
                              ? t('Isolated')
                              : pr.reason === 'zero_size'
                              ? t('Size 0')
                              : pr.reason === 'off_map'
                              ? t('Off map')
                              : t('Layer off')}
                            )
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {(optimizing || previewing) && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-zinc-300">
                    <span className="truncate pr-2">{optStatus}</span>
                    <span className="font-mono">{Math.round(optProgress * 100)}%</span>
                  </div>
                  <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-150"
                      style={{ width: `${Math.round(optProgress * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {optPreview && !previewing && (
                <FidelityCard
                  preview={optPreview}
                  stale={!previewIsCurrent}
                  supersample={supersample}
                  onShowInViewport={handleShowPreviewInViewport}
                />
              )}

              {optError && (
                <div className="bg-red-950/80 border border-red-700 rounded-lg px-3.5 py-2 text-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{optError}</span>
                </div>
              )}

              {pendingOptOverwrite && !optimizing && (
                <OverwriteConfirmPanel
                  check={pendingOptOverwrite}
                  onConfirm={() => handleRunOptimization(true)}
                  onCancel={() => setPendingOptOverwrite(null)}
                />
              )}

              {optResult && !optimizing && (
                <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div className="font-semibold text-emerald-200 truncate">
                        {t(
                          optResult.archive
                            ? 'Done! Archive saved: sceneries {before} → {after} ({files} • {size})'
                            : 'Done! Sceneries reduced: {before} → {after} ({files} • {size})',
                          {
                            before: optResult.propsBefore,
                            after: optResult.propsAfter,
                            files: tp(optResult.generatedPngFiles.length, '{n} PNG file', '{n} PNG files'),
                            size: formatBytes(optResult.totalPngBytes),
                          }
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    {optResult.outputMapPath}
                  </div>
                  {/* Quality only means something when layers were baked (an archive may only copy files) */}
                  {(optResult.generatedPngFiles.length > 0 || optResult.removedOrphanPngs > 0) && (
                    <div className="text-[11px] text-zinc-400">
                      {optResult.generatedPngFiles.length > 0 &&
                        t('Quality: {ss}× • compositing: {mode}', {
                          ss: supersample,
                          mode: optResult.floatPrecision
                            ? t('floating point (full alpha precision)')
                            : t('8-bit (GPU without float)'),
                        })}
                      {optResult.removedOrphanPngs > 0 &&
                        `${optResult.generatedPngFiles.length > 0 ? ' • ' : ''}${tp(
                          optResult.removedOrphanPngs,
                          'removed {n} unused PNG left from the previous version',
                          'removed {n} unused PNGs left from the previous version'
                        )}`}
                    </div>
                  )}
                  {optResult.limitWarnings.length > 0 && (
                    <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {t('The map still exceeds Soldat limits: {list}', {
                        list: optResult.limitWarnings.map(limitWarningText).join(', '),
                      })}
                    </div>
                  )}
                  {optResult.archive && (
                    <div className="text-[11px] text-sky-200 space-y-0.5">
                      <div>
                        {t('Archive: own copies of {files} ({size}) • texture: {texture}', {
                          files: tp(optResult.archive.copiedFiles, '{n} scenery file', '{n} scenery files'),
                          size: formatBytes(optResult.archive.copiedBytes),
                          texture: optResult.archive.texture
                            ? `${optResult.archive.texture}${optResult.archive.textureEdge ? ` ${t('(with smooth edges)')}` : ''}`
                            : t('not found'),
                        })}
                      </div>
                      {optResult.archive.missing.length > 0 && (
                        <div className="text-amber-300 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            {t('Not found, so still shared: {files}', { files: optResult.archive.missing.join(', ') })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {optResult.backupDir && (
                    <div className="text-[11px] text-sky-300 truncate" title={optResult.backupDir}>
                      {t('Previous versions of the overwritten files were saved in a backup: {dir}', {
                        dir: optResult.backupDir,
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openPathInExplorer(optResult.outputMapPath)}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> {t('Show folder')}
                    </button>
                    {optResult.newMapId && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectMapById(optResult.newMapId!);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" /> {t('Open {name}', { name: optResult.derivedBaseName })}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {(optimizing || previewing) && (
                  <button
                    type="button"
                    onClick={() => abortOptRef.current?.abort()}
                    className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
                  >
                    {t('Cancel')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    optimizing ||
                    previewing ||
                    isOptimizeResult ||
                    !currentMapData ||
                    !optPlan ||
                    optPlan.groups.length === 0
                  }
                  onClick={handleBuildPreview}
                  title={t('Bakes the layers in memory, compares them with the original at 1080p screen scale and lets you view the result — nothing is saved')}
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-emerald-200 border border-emerald-500/30 font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-emerald-400" />
                  {previewing ? t('Building the preview...') : t('Preview and fidelity report (not saved)')}
                </button>
                <button
                  type="button"
                  disabled={
                    optimizing ||
                    previewing ||
                    isOptimizeResult ||
                    !currentMapData ||
                    !optPlan ||
                    // An archive is useful without merging too: it still copies the files
                    (optPlan.groups.length === 0 && !archiveMode)
                  }
                  onClick={() => handleRunOptimization(false)}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
                >
                  <Layers className="w-4 h-4" />
                  {optimizing
                    ? t('Merging layers on the GPU...')
                    : previewIsCurrent
                    ? t('Save this result as {name}.pms', { name: derivedOptName })
                    : archiveMode
                    ? t('Archive and save {name}.pms', { name: derivedOptName })
                    : t('Optimize sceneries and save {name}.pms', { name: derivedOptName })}
                </button>
              </div>
              </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const OptimizeBatchPanel: React.FC<{
  batchCount: number;
  batchSourceLabel: string;
  supersampleChoice: SupersampleChoice;
  archive: boolean;
  destinationLabel: string;
  canStart: boolean;
  overwriteOwn: boolean;
  onChangeOverwriteOwn: (value: boolean) => void;
  running: boolean;
  progress: OptimizeBatchProgress | null;
  summary: OptimizeBatchSummary | null;
  error: string | null;
  onStart: () => void;
  onCancel: () => void;
}> = ({
  batchCount,
  batchSourceLabel,
  supersampleChoice,
  archive,
  destinationLabel,
  canStart,
  overwriteOwn,
  onChangeOverwriteOwn,
  running,
  progress,
  summary,
  error,
  onStart,
  onCancel,
}) => {
  const overall = progress ? (progress.index + progress.mapProgress) / Math.max(1, progress.total) : 0;
  const failures = summary ? summary.items.filter((i) => i.status === 'failed') : [];
  const overLimits = summary
    ? summary.items.filter((i) => i.status === 'done' && (i.limitWarnings?.length ?? 0) > 0)
    : [];
  const headline = !summary
    ? ''
    : summary.cancelled
    ? t('Batch cancelled')
    : summary.stoppedEarly
    ? t('Batch stopped after 5 errors in a row')
    : t('Batch finished');
  const formattedCount = batchCount.toLocaleString(locale);

  return (
    <div className="flex-1 flex flex-col space-y-3.5">
      <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 space-y-1.5 text-[11px] text-zinc-400 leading-relaxed">
        <div className="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-emerald-400" />
          {t('Batch optimization: {count} ({source})', {
            count: tp(batchCount, '{n} map', '{n} maps', { n: formattedCount }),
            source: batchSourceLabel,
          })}
        </div>
        <p>
          {t('Maps are merged on the GPU one after another, using the settings from the left column.')}{' '}
          {supersampleChoice === 'auto'
            ? t('Auto quality is chosen separately for each map (the sharpest that fits the memory limit).')
            : t('Fixed {ss}× quality for all maps.', { ss: supersampleChoice })}
        </p>
        <p>
          {archive
            ? tr(
                'Skipped: maps that already are an {o} or {a} result and maps whose output file already exists. Saving to: {dest}.',
                { o: <code>_o</code>, a: <code>_a</code>, dest: <span className="text-zinc-300">{destinationLabel}</span> }
              )
            : tr(
                'Skipped: maps with no sceneries to merge, maps that already are an {o} result and maps whose output file already exists. Saving to: {dest}.',
                { o: <code>_o</code>, dest: <span className="text-zinc-300">{destinationLabel}</span> }
              )}
        </p>
        {archive && (
          <p className="text-sky-300">
            {t('Archive: every map gets its own copies of its sceneries and texture. Then build a pack from the *_a maps in the Map Pack Builder.')}
          </p>
        )}
        <p>{t('The fidelity report is not computed for every map — check the preview on one map before a large batch.')}</p>
      </div>

      <label className="flex items-start gap-2 text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={overwriteOwn}
          disabled={running}
          onChange={(e) => onChangeOverwriteOwn(e.target.checked)}
          className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
        />
        <span>
          {t('Replace earlier, unchanged Studio results for the same maps (the previous version goes to a backup). Files that Studio did not create are never overwritten.')}
        </span>
      </label>

      {running && progress && (
        <div className="space-y-1.5">
          <div className="flex justify-between gap-2 text-[11px] text-zinc-300">
            <span className="truncate">
              {tr('Map {index} / {total}: {name}', {
                index: progress.index + 1,
                total: progress.total,
                name: <code className="text-emerald-300">{progress.mapName}</code>,
              })}
            </span>
            <span className="font-mono">{Math.round(overall * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
            <div className="h-full bg-emerald-500 transition-all duration-150" style={{ width: `${Math.round(overall * 100)}%` }} />
          </div>
          <div className="text-[10px] text-zinc-500 truncate">{progress.status}</div>
        </div>
      )}

      {error && (
        <div className="bg-red-950/80 border border-red-700 rounded-lg px-3.5 py-2 text-red-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && !running && (
        <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-lg p-3 space-y-1.5">
          <div className="font-semibold text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            {archive
              ? tp(summary.total, '{status}: archived {done} of {n} map', '{status}: archived {done} of {n} maps', {
                  status: headline,
                  done: summary.done,
                })
              : tp(summary.total, '{status}: optimized {done} of {n} map', '{status}: optimized {done} of {n} maps', {
                  status: headline,
                  done: summary.done,
                })}
          </div>
          {summary.done > 0 && (
            <div className="text-[11px] text-zinc-300">
              {t('Sceneries: {before} → {after} • PNG layers: {size}', {
                before: summary.propsBefore.toLocaleString(locale),
                after: summary.propsAfter.toLocaleString(locale),
                size: formatBytes(summary.pngBytes),
              })}
            </div>
          )}
          {summary.archiveFiles > 0 && (
            <div className="text-[11px] text-sky-200">
              {t('Own copies: {files} • not found: {missing}', {
                files: summary.archiveFiles.toLocaleString(locale),
                missing: summary.archiveMissing.toLocaleString(locale),
              })}
            </div>
          )}
          <div className="text-[11px] text-zinc-400">
            {tr('Skipped: existing {existing} • nothing to merge {nothing} • {o} results {derived} • errors {failed}', {
              existing: summary.skippedExisting,
              nothing: summary.skippedNothingToMerge,
              o: <code>_o / _a</code>,
              derived: summary.skippedDerived,
              failed: summary.failed,
            })}
            {summary.processed < summary.total
              ? ` • ${t('not processed {n}', { n: summary.total - summary.processed })}`
              : ''}
          </div>
          {overLimits.length > 0 && (
            <div className="text-[11px] text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {t('Still over the Soldat limits ({count}):', { count: overLimits.length })}{' '}
                {overLimits
                  .slice(0, 8)
                  .map((i) => i.derivedBaseName)
                  .join(', ')}
                {overLimits.length > 8 ? '…' : ''}
              </span>
            </div>
          )}
          {failures.length > 0 && (
            <div className="max-h-28 overflow-y-auto text-[10px] font-mono text-red-200/90 space-y-0.5">
              {failures.slice(0, 100).map((f) => (
                <div key={f.mapId}>
                  • {f.baseName}: {f.detail}
                </div>
              ))}
            </div>
          )}
          {summary.outputDir && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => openPathInExplorer(summary.outputDir!)}
                className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" /> {t('Show folder')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1 mt-auto">
        {running && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
          >
            {t('Cancel')}
          </button>
        )}
        <button
          type="button"
          disabled={running || !canStart}
          onClick={onStart}
          className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
        >
          <Layers className="w-4 h-4" />
          {running
            ? archive
              ? t('Archiving maps on the GPU...')
              : t('Optimizing maps on the GPU...')
            : archive
            ? tp(batchCount, 'Archive {n} map → *_a.pms', 'Archive {n} maps → *_a.pms', { n: formattedCount })
            : tp(batchCount, 'Optimize {n} map → *_o.pms', 'Optimize {n} maps → *_o.pms', { n: formattedCount })}
        </button>
      </div>
    </div>
  );
};

function rateFidelity(f: FidelityReport): { label: string; cls: string } {
  const sharp = f.sharpnessPct ?? 100;
  if (sharp < 85) {
    return { label: t('Low — the layers are clearly softer than the original'), cls: 'text-red-200 border-red-500/40 bg-red-950/40' };
  }
  if (sharp < 94 && f.meanAbsDiff <= 3) {
    return { label: t('Good — colors match, but the layers are slightly softer than the original'), cls: 'text-amber-200 border-amber-500/40 bg-amber-950/30' };
  }
  if (f.meanAbsDiff <= 1.5 && f.pctPixelsOver8 <= 3) {
    return { label: t('Very high — the result is practically indistinguishable from the original'), cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40' };
  }
  if (f.meanAbsDiff <= 3 && f.pctPixelsOver8 <= 8) {
    return { label: t('Good — small sharpness differences (consider a higher quality)'), cls: 'text-amber-200 border-amber-500/40 bg-amber-950/30' };
  }
  return { label: t('Low — visible differences; raise the layer quality'), cls: 'text-red-200 border-red-500/40 bg-red-950/40' };
}

// The server joins each exceeded limit as "<label>: <value> > <limit>"; the label is translated here
function limitWarningText(warning: string): string {
  const m = /^(.+): (\S+) > (\S+)$/.exec(warning);
  return m ? `${tText(m[1])}: ${m[2]} > ${m[3]}` : tText(warning);
}

const FidelityCard: React.FC<{
  preview: OptimizePreview;
  stale: boolean;
  supersample: number;
  onShowInViewport: () => void;
}> = ({ preview, stale, supersample, onShowInViewport }) => {
  const f = preview.fidelity;
  const rating = f ? rateFidelity(f) : null;
  const totalPx = preview.tiles.reduce((acc, tile) => acc + tile.pngWidth * tile.pngHeight, 0);
  return (
    <div className={`rounded-lg p-3 space-y-1.5 border ${rating ? rating.cls : 'border-zinc-800 bg-zinc-950'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold flex items-center gap-1.5">
          <Eye className="w-4 h-4 shrink-0" />
          {tp(
            preview.tiles.length,
            'Result preview: {n} PNG tile ({mpx} MPx), quality {ss}×',
            'Result preview: {n} PNG tiles ({mpx} MPx), quality {ss}×',
            { mpx: (totalPx / 1e6).toFixed(1), ss: supersample }
          )}
        </div>
        <button
          type="button"
          onClick={onShowInViewport}
          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-semibold shrink-0 cursor-pointer"
        >
          {t('Show in map view')}
        </button>
      </div>
      {f && rating ? (
        <>
          <div className="text-[11px]">
            {tr('Match with the original (rendered at 1080p screen scale): {rating}', {
              rating: <strong>{rating.label}</strong>,
            })}
          </div>
          <div className="text-[10px] font-mono opacity-80">
            {t(
              'sharpness {sharp}% of the original • avg. difference {mean} / 255 • pixels differing by > 8: {over8}% • max {max} • sample {mp} MPx',
              {
                sharp: f.sharpnessPct ?? '—',
                mean: f.meanAbsDiff,
                over8: f.pctPixelsOver8,
                max: f.maxDiff,
                mp: f.sampledMegapixels,
              }
            )}
            {f.worstArea &&
              ` • ${t('worst area x={x}, y={y} (avg. {mean})', {
                x: Math.round(f.worstArea.left),
                y: Math.round(f.worstArea.top),
                mean: f.worstArea.meanAbsDiff,
              })}`}
          </div>
        </>
      ) : (
        <div className="text-[11px] opacity-80">{t('No areas to compare.')}</div>
      )}
      {stale && (
        <div className="text-[11px] text-amber-300">
          {t('The settings changed after the preview was made — saving will bake the layers again with the new settings.')}
        </div>
      )}
    </div>
  );
};

/**
 * The scenery image drawn at its current PMS size and at the corrected size, on the same scale, so the
 * stretch (or enlargement) the fix removes is visible at a glance.
 */
const SceneryFixThumbs: React.FC<{ issue: SceneryFixIssueGroup }> = ({ issue }) => {
  const [failed, setFailed] = useState(false);
  const pw = Math.max(1, Math.abs(issue.pmsWidth));
  const ph = Math.max(1, Math.abs(issue.pmsHeight));
  const ew = Math.max(1, Math.abs(issue.expectedWidth));
  const eh = Math.max(1, Math.abs(issue.expectedHeight));
  const scale = Math.min(64 / Math.max(pw, ew), 34 / Math.max(ph, eh));
  const url = `/api/assets?category=scenery-gfx&name=${encodeURIComponent(issue.sceneryName)}&convert=png&colorkey=1`;
  if (failed) return null;
  const box = (w: number, h: number, label: string, cls: string) => (
    <div className="flex flex-col items-center gap-0.5" title={`${label}: ${w}×${h}`}>
      <div className="h-[34px] flex items-end">
        <img
          src={url}
          alt=""
          onError={() => setFailed(true)}
          style={{ width: Math.max(2, Math.round(w * scale)), height: Math.max(2, Math.round(h * scale)) }}
          className={`object-fill rounded-sm border ${cls} bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:8px_8px]`}
        />
      </div>
      <span className="text-[9px] text-zinc-500 font-sans">{label}</span>
    </div>
  );
  return (
    <div className="flex items-end gap-1.5">
      {box(pw, ph, t('now'), 'border-red-500/50')}
      {box(ew, eh, t('after'), 'border-emerald-500/50')}
    </div>
  );
};

function replacedPngFilesText(n: number): string {
  return ` ${tp(n, '{n} layer PNG file will be replaced as well.', '{n} layer PNG files will be replaced as well.')}`;
}

const OverwriteConfirmPanel: React.FC<{
  check: DerivedTargetCheck;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ check, onConfirm, onCancel }) => (
  <div
    className={`rounded-lg p-3 space-y-2 border ${
      check.existingWasGeneratedByStudio
        ? 'bg-sky-950/50 border-sky-500/40 text-sky-100'
        : 'bg-red-950/60 border-red-500/50 text-red-100'
    }`}
  >
    <div className="flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        <div className="font-semibold">
          {tr('The file {file} already exists in the target folder.', { file: <code>{check.derivedBaseName}.pms</code> })}
        </div>
        <div className="text-[11px] opacity-90">
          {check.existingWasGeneratedByStudio
            ? t('This is a previous Soldat Map Studio result (the file has not been changed since).')
            : check.existingMapTitle
            ? t(
                'WARNING: this file did NOT come from Soldat Map Studio or has been changed (map title: “{title}”) — overwriting it will replace a different map!',
                { title: check.existingMapTitle }
              )
            : t('WARNING: this file did NOT come from Soldat Map Studio or has been changed — overwriting it will replace a different map!')}
          {check.existingPngFiles.length > 0 && replacedPngFilesText(check.existingPngFiles.length)}
          {' '}{tr('The previous versions will go to a backup in {dir}.', { dir: <code>data/backups/</code> })}
        </div>
        <div className="text-[10px] font-mono opacity-70 truncate">{check.outputMapPath}</div>
      </div>
    </div>
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 cursor-pointer"
      >
        {t('Cancel')}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
      >
        {t('Overwrite file')}
      </button>
    </div>
  </div>
);

const LayerMergeCard: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle: string;
}> = ({ checked, onChange, title, subtitle }) => (
  <label
    className={`p-2 rounded-lg border cursor-pointer transition-colors flex items-start gap-2 ${
      checked
        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100'
        : 'bg-zinc-900 border-zinc-800 text-zinc-400'
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 rounded border-zinc-700 bg-zinc-950 text-emerald-500"
    />
    <div className="min-w-0">
      <div className="font-semibold text-[11px] truncate">{title}</div>
      <div className="text-[10px] opacity-75 truncate">{subtitle}</div>
    </div>
  </label>
);
