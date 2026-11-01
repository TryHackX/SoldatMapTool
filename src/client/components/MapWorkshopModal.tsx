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
  onApplyLivePreviewMap: (previewData: PmsMapData, bannerText: string) => void;
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
    }),
    [
      fixFirst,
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
    : 'mapa_f';
  // The server decides the final name (`_f_o` only when fixFirst really repaired something)
  const derivedOptName =
    optPlan && currentMapEntry && optPlan.mapId === currentMapEntry.id
      ? optPlan.derivedBaseName
      : currentMapEntry
      ? makeDerivedMapName(currentMapEntry.baseName, '_o', maxBaseLength)
      : 'mapa_o';
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
      `Podgląd naprawy 1.7.1 na żywo (${fixesMap.size} naprawionych scenerii → ${derivedFixName}.pms)`
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
        if (!checkRes.ok) throw new Error(check.error || 'Błąd sprawdzania pliku docelowego.');
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
      if (!res.ok) throw new Error(data.error || 'Błąd zapisywania mapy _f.pms');
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
      if (!res.ok) throw new Error(data.error || 'Błąd skanowania wsadowego');
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
      if (!res.ok) throw new Error(data.error || 'Błąd wsadowej naprawy map');
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
    onApplyLivePreviewMap(
      optPreview.previewMap,
      `Podgląd wyniku Optimize (${derivedOptName}.pms, ${supersample}×, bez zapisu)` +
        (f ? ` — ostrość ${f.sharpnessPct}% oryginału, śr. różnica ${f.meanAbsDiff}` : '')
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
      if (candidates.length === 0) throw new Error('Brak map do optymalizacji w koszyku / bieżącym filtrze.');
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
      ? 'Soldat/maps (od razu widoczne w grze)'
      : optDestination === 'exports_optimized'
      ? 'exports/optimized_maps'
      : optCustomFolder.trim() || 'własny folder (nie wybrano)';

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
                Warsztat Map PMS — Naprawa Scenerii 1.7.1 (<code>_f</code>) i Optimize Sceneries (<code>_o</code>)
              </h2>
              <p className="text-[11px] text-zinc-400">
                Bezstratna modyfikacja tabel scenerii z 100% zachowaniem fizyki poligonów, sektorów kolizji, spawnów i waypointów
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={optimizing || fixingSingle || applyingBatch || previewing || optBatchRunning}
            onClick={onClose}
            aria-label="Zamknij warsztat"
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
              1. Naprawa Scenerii Soldat 1.7.1 (_f.pms)
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
              2. Optimize Sceneries — Sklejanie Warstw (_o.pms)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400 text-[11px]">Limit długości nazwy mapy:</span>
            <select
              value={maxBaseLength}
              onChange={(e) => setMaxBaseLength(Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 font-mono text-zinc-200 focus:outline-none focus:border-amber-500"
              title="Jeśli nazwa z dopiskiem _f lub _o przekroczy ten limit, końcowe znaki nazwy bazowej zostaną obcięte przed dodaniem sufiksu"
            >
              <option value={16}>16 znaków (Soldat 1.6)</option>
              <option value={20}>20 znaków</option>
              <option value={24}>24 znaki (Zalecane)</option>
              <option value={32}>32 znaki (OpenSoldat)</option>
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
                  Aktualna mapa ({currentMapEntry?.baseName || '—'} → {derivedFixName}.pms)
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
                  Skaner i Naprawa Wsadowa ({batchCount.toLocaleString('pl-PL')} map — {batchSourceLabel})
                </button>
              </div>

              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={fixRemoveUnused}
                  onChange={(e) => setFixRemoveUnused(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-amber-500"
                />
                Usuń przy okazji martwe (nieużywane) wpisy scenerii z nagłówka .pms
              </label>
            </div>

            {/* Destination Selector */}
            <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 grid grid-cols-12 gap-3 items-center">
              <div className="col-span-5">
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Miejsce zapisu plików <code>*_f.pms</code>:
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
                    Bezpośrednio do Soldat/maps/ (od razu widoczne w grze i Studio)
                  </option>
                  <option value="exports_fixed">
                    Osobny katalog projektu: exports/fixed_maps/maps/
                  </option>
                  <option value="custom">Własny folder na dysku...</option>
                </select>
              </div>

              <div className="col-span-7">
                {fixDestination === 'custom' ? (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Ścieżka docelowego folderu:
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={fixCustomFolder}
                        onChange={(e) => setFixCustomFolder(e.target.value)}
                        placeholder="Wybierz katalog..."
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 font-mono text-zinc-200"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const p = await pickSystemFolder('Wybierz folder zapisu map _f.pms');
                          if (p) setFixCustomFolder(p);
                        }}
                        className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                      >
                        Przeglądaj...
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-400 leading-relaxed">
                    <strong className="text-zinc-200">Jak działa automatyczna naprawa 1.7.1?</strong>{' '}
                    Wykrywa scenerie rozciągnięte przez stary MapMaker do potęg dwójki (np.{' '}
                    <code>64×64</code> zamiast <code>25×17</code> lub <code>41×67</code>) oraz
                    scenerie powiększone <code>4.5×</code> po zapisie w starym PolyWorks na teksturach
                    HD, przywracając im dokładne proporcje 1:1 bez ruszania skali autora.
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
                      Diagnoza scenerii mapy{' '}
                      <code className="text-amber-300">{currentMapEntry?.baseName}</code>
                      {loadingAnalysis ? ' • analizowanie...' : ''}
                    </span>
                    {analysis && (
                      <span className="text-[11px] text-zinc-400">
                        Do naprawy:{' '}
                        <strong className="text-amber-300 font-mono">{selectedPropFixCount}</strong> /{' '}
                        {analysis.totalActiveProps} aktywnych scenerii • Martwe wpisy:{' '}
                        <strong className="font-mono text-zinc-300">
                          {analysis.unusedSceneryCount}
                        </strong>
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-zinc-900">
                    {!currentMapEntry ? (
                      <div className="p-8 text-center text-zinc-500">
                        Wybierz mapę w przeglądarce, aby przeanalizować jej scenerie.
                      </div>
                    ) : !analysis || !analysisMatchesMap || loadingAnalysis ? (
                      <div className="p-8 text-center text-zinc-500">
                        {fixError && !loadingAnalysis
                          ? 'Nie udało się przeanalizować tej mapy (szczegóły poniżej).'
                          : 'Analizowanie wymiarów scenerii względem tabeli Soldat 1.6 oraz plików na dysku...'}
                      </div>
                    ) : analysis.issues.length === 0 ? (
                      <div className="p-8 text-center space-y-1.5">
                        <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto" />
                        <div className="font-semibold text-emerald-300">
                          Wszystkie scenerie na tej mapie mają już prawidłowe wymiary 1.7.1!
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Nie wykryto rozciągniętych tekstur Power-of-Two ani błędnego przeskalowania 4.5× HD.
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
                                    {issue.recommended ? 'Pewny błąd 1.7.1' : 'Opcjonalna różnica'}
                                  </span>
                                  {issue.isVanilla && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/25">
                                      Vanilla 1.6
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-zinc-400 mt-0.5">
                                  {issue.reasonLabelPl} • przykładowa skala autora:{' '}
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
                          Zapisano naprawioną mapę: <code>{fixSingleResult.outputFileName}</code> (naprawiono{' '}
                          {fixSingleResult.fixedPropCount} scenerii, usunięto{' '}
                          {fixSingleResult.removedUnusedSceneryCount} martwych wpisów)
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 truncate">
                          {fixSingleResult.outputPath}
                        </div>
                        {fixSingleResult.backupDir && (
                          <div className="text-[11px] text-sky-300 truncate" title={fixSingleResult.backupDir}>
                            Poprzednia wersja pliku zapisana w kopii: {fixSingleResult.backupDir}
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
                        <FolderOpen className="w-3.5 h-3.5" /> Pokaż folder
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
                          <Play className="w-3.5 h-3.5" /> Otwórz {fixSingleResult.derivedBaseName}
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
                    Podgląd naprawy na żywo w oknie mapy (bez zapisu)
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
                      ? 'Zapisywanie...'
                      : `Napraw i zapisz ${derivedFixName}.pms`}
                  </button>
                </div>
              </>
            ) : (
              /* Batch Collection Scanner & Fixer */
              <div className="flex-1 min-h-48 flex flex-col space-y-3">
                <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5">
                  <div>
                    <div className="font-semibold text-zinc-200">
                      Automatyczny skaner uszkodzonych scenerii 1.7.1 w kolekcji ({batchCount.toLocaleString('pl-PL')} map — {batchSourceLabel})
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Przeszukuje np. wszystkie mapy RSCS (<code>ctf_cs_</code>, <code>ctf_de_</code>) oraz Trenchwars (<code>tw_</code>, <code>ttw_</code>) i wykrywa rozciągnięte scenerie
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={scanningBatch || applyingBatch}
                    onClick={handleScanBatchIssues}
                    className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Search className="w-4 h-4" />
                    {scanningBatch ? 'Skanowanie map...' : 'Skanuj mapy pod kątem błędów 1.7.1'}
                  </button>
                </div>

                <div className="flex-1 min-h-44 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                  {batchItems === null ? (
                    <div className="p-8 text-center text-zinc-500">
                      Kliknij „Skanuj mapy pod kątem błędów 1.7.1”, aby w kilka sekund znaleźć wszystkie mapy z rozciągniętymi sceneriami.
                    </div>
                  ) : batchItems.length === 0 ? (
                    <div className="p-8 text-center text-emerald-300 font-semibold">
                      Nie znaleziono żadnych uszkodzonych map 1.7.1 w wybranym zestawie!
                    </div>
                  ) : (
                    <>
                      <div className="px-3.5 py-2 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between">
                        <span className="font-semibold text-zinc-200">
                          Wykryto map z błędami scenerii: {batchItems.length} (zaznaczono:{' '}
                          {selectedBatchMapIds.size})
                        </span>
                        <div className="flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedBatchMapIds(new Set(batchItems.map((i) => i.mapId)))
                            }
                            className="text-amber-300 hover:underline cursor-pointer"
                          >
                            Zaznacz wszystkie
                          </button>
                          <span className="text-zinc-700">•</span>
                          <button
                            type="button"
                            onClick={() => setSelectedBatchMapIds(new Set())}
                            className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            Odznacz
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
                                      {item.modeGroupName}
                                    </span>
                                    {item.alreadyHasFixedSibling && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                        Posiada już plik _f na dysku
                                      </span>
                                    )}
                                    {item.nameCollisionWith && (
                                      <span
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30"
                                        title="Po skróceniu nazwy obie mapy dałyby ten sam plik _f — zmień limit długości nazwy"
                                      >
                                        Ta sama nazwa wynikowa co {item.nameCollisionWith}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                                    {item.issueSummary.join(' • ')}
                                  </div>
                                </div>
                              </div>
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30 shrink-0">
                                {item.affectedPropCount} scen.
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
                        Utworzono {batchFixDoneSummary.fixedMapsCount} naprawionych map *_f.pms (łącznie poprawiono{' '}
                        {batchFixDoneSummary.totalFixedProps} scenerii)
                      </div>
                      {batchFixDoneSummary.skippedExistingCount > 0 && (
                        <div className="text-[11px] text-sky-300">
                          Pominięto {batchFixDoneSummary.skippedExistingCount} map, których plik _f już istniał
                          (zaznacz „Nadpisuj istniejące”, aby je odtworzyć).
                        </div>
                      )}
                      {batchFixDoneSummary.failed.length > 0 && (
                        <div className="text-[11px] text-red-300 truncate" title={batchFixDoneSummary.failed.map((f) => `${f.mapId}: ${f.error}`).join('\n')}>
                          Błędy: {batchFixDoneSummary.failed.length} (np. {batchFixDoneSummary.failed[0].mapId}: {batchFixDoneSummary.failed[0].error})
                        </div>
                      )}
                    </div>
                    {batchFixDoneSummary.outputDir && (
                      <button
                        type="button"
                        onClick={() => openPathInExplorer(batchFixDoneSummary.outputDir!)}
                        className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> Otwórz folder
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
                    Nadpisuj istniejące pliki <code>_f.pms</code> (domyślnie są pomijane)
                  </label>
                  <button
                    type="button"
                    disabled={applyingBatch || selectedBatchMapIds.size === 0}
                    onClick={handleApplyBatchFix}
                    className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold flex items-center gap-2 shadow-lg shadow-amber-950/50 cursor-pointer"
                  >
                    <Wrench className="w-4 h-4" />
                    {applyingBatch
                      ? 'Naprawianie zaznaczonych map...'
                      : `Napraw zaznaczone mapy (${selectedBatchMapIds.size}) → *_f.pms`}
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
                  Warstwy do sklejenia (jak ręczna optymalizacja w <code>deagle5</code>)
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Łączy dziesiątki/setki nakładających się cegieł, cieni, ścian i krzaków na tej samej
                  warstwie w pojedyncze, idealnie spasowane arkusze PNG — całkowicie eliminując efekt
                  migotania przezroczystości (alpha flickering) i odciążając silnik gry.
                </p>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <LayerMergeCard
                    checked={mergeBack}
                    onChange={setMergeBack}
                    title="Warstwa 0: Tył"
                    subtitle="Za graczem (Back)"
                  />
                  <LayerMergeCard
                    checked={mergeMid}
                    onChange={setMergeMid}
                    title="Warstwa 1: Środek"
                    subtitle="Za poligonami (Mid)"
                  />
                  <LayerMergeCard
                    checked={mergeFront}
                    onChange={setMergeFront}
                    title="Warstwa 2: Przód"
                    subtitle="Kryjówki (Front)"
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
                    Najpierw napraw wymiary scenerii 1.7.1 (jak <code>_f</code>), potem sklej
                  </span>
                  <span className="block text-[11px] text-zinc-400 leading-relaxed">
                    Sklejanie mapy z rozciągniętymi sceneriami utrwaliłoby błąd w warstwach PNG. Zalecane poprawki są
                    stosowane w pamięci (bez pliku pośredniego), a wynik dostaje nazwę <code>_f_o</code>.
                    {fixFirst && optPlan && optPlan.mapId === currentMapEntry?.id && (
                      <span className={planFixCount > 0 ? 'text-amber-300' : 'text-zinc-500'}>
                        {' '}
                        {planFixCount > 0
                          ? `Ta mapa: ${planFixCount} scenerii zostanie poprawionych przed sklejeniem.`
                          : 'Ta mapa nie wymaga poprawek — wynik zostanie zapisany jako zwykłe _o.'}
                      </span>
                    )}
                  </span>
                </span>
              </label>

              {/* Quality & Tile Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Jakość rasteryzacji warstw PNG
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
                      Auto — 3×, przy bardzo dużych warstwach mniej (teraz: {supersample}×)
                    </option>
                    <option value={1}>1× Ekonomiczna — w grze rozmyta (cienkie detale bledną)</option>
                    <option value={2}>2× Średnia — na 1080p nieco miększa (scale 0.5)</option>
                    <option value={3}>3× Ostra — najlepsza dla 1080p (scale 0.333)</option>
                    <option value={4}>4× Maksymalna — 1440p i 4K (duże pliki, scale 0.25)</option>
                  </select>
                  {optPlan && (
                    <div className="text-[10px] text-zinc-500 mt-1">
                      Rozmiar warstw: do {optPlan.estimatedMegapixelsBySupersample[supersample - 1].toFixed(1)} MPx
                      (~{Math.round(optPlan.estimatedMegapixelsBySupersample[supersample - 1] * 4)} MB VRAM, puste
                      obszary są przycinane). Na 1080p gra pokazuje ok. 2.25 px na jednostkę świata: 3× wychodzi
                      najostrzej, 2× nieco miękko, 1× wyraźnie rozmyte; 4× przydaje się od 1440p.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-zinc-300 mb-1">
                    Maksymalny rozmiar kafelka PNG
                  </label>
                  <select
                    value={maxTilePx}
                    onChange={(e) => setMaxTilePx(Number(e.target.value) as 2048 | 4096)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value={2048}>2048 × 2048 px (100% kompatybilności GPU)</option>
                    <option value={4096}>4096 × 4096 px (mniej plików na dużych mapach)</option>
                  </select>
                </div>
              </div>

              {/* Author-Intent Protection Rules */}
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Ochrona Zamysłu Autora (Z-Order Safe)
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
                      Zawsze zachowuj animowane scenerie <code>.gif</code> osobno (ogień, woda, migające lampy)
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Dzieli warstwę przed i za animacją, zachowując w 100% kolejność przykrywania obiektów
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
                      <span>Zachowaj ogromne tła / mgły (np. <code>fade.png</code>) bez wypalania</span>
                      {preserveGiantProps && (
                        <input
                          type="number"
                          min={500}
                          max={8000}
                          step={100}
                          value={giantPropThresholdPx}
                          onChange={(e) => setGiantPropThresholdPx(Number(e.target.value) || 1600)}
                          className="w-20 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-200"
                          title="Próg rozmiaru scenerii w świecie gry (px)"
                        />
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Zapobiega generowaniu gigantycznych pustych tekstur nieba poza obszarem gry
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
                      Nie twórz nowego PNG dla pojedynczej odizolowanej scenerii (np. podpis autora)
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
                      Użyj klasycznych tekstur Soldat 1.6 (<code>.bmp</code>) zamiast HD (<code>.png</code>) podczas sklejania
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optRemoveUnused}
                    onChange={(e) => setOptRemoveUnused(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  <div>
                    <div className="text-zinc-200">
                      Oczyść nagłówek <code>.pms</code> ze starych, zastąpionych wpisów scenerii
                    </div>
                  </div>
                </label>
              </div>

              {/* Destination */}
              <div>
                <label className="block font-medium text-zinc-300 mb-1">
                  Miejsce zapisu mapy <code>{derivedOptName}.pms</code> i wygenerowanych PNG:
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
                    Bezpośrednio do Soldat (maps/ + scenery-gfx/ — gotowe do podglądu i paczki MPA!)
                  </option>
                  <option value="exports_optimized">
                    Osobny katalog: exports/optimized_maps/ (maps/ + scenery-gfx/)
                  </option>
                  <option value="custom">Własny folder na dysku...</option>
                </select>

                {optDestination === 'custom' && (
                  <div className="flex gap-1.5 mt-2">
                    <input
                      type="text"
                      value={optCustomFolder}
                      onChange={(e) => setOptCustomFolder(e.target.value)}
                      placeholder="Wybierz folder docelowy..."
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 font-mono text-zinc-200"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const p = await pickSystemFolder('Wybierz folder dla zoptymalizowanej mapy _o');
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
                  Aktualna mapa ({currentMapEntry?.baseName || '—'})
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
                  Wsadowo ({batchCount.toLocaleString('pl-PL')} map — {batchSourceLabel})
                </button>
              </div>

              {optScope === 'batch' ? (
                <OptimizeBatchPanel
                  batchCount={batchCount}
                  batchSourceLabel={batchSourceLabel}
                  supersampleChoice={supersampleChoice}
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
              {/* Summary Metrics */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="text-[10px] text-zinc-500">Scenerie przed</div>
                  <div className="font-mono text-base font-bold text-zinc-200 mt-0.5">
                    {optPlan?.totalActivePropsBefore ?? '—'}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="text-[10px] text-zinc-500">Szacowane po sklejeniu</div>
                  <div className="font-mono text-base font-bold text-emerald-300 mt-0.5">
                    {optPlan ? `≤ ${optPlan.estimatedTotalPropsAfter}` : '—'}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                  <div className="text-[10px] text-zinc-500">Redukcja obiektów</div>
                  <div className="font-mono text-base font-bold text-amber-300 mt-0.5">
                    {optPlan ? `-${reductionPct}%` : '—'}
                  </div>
                </div>
              </div>

              {/* Planned Layer Groups */}
              <div className="flex-1 min-h-40 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                <div className="px-3.5 py-2 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">
                    Plan sklejania warstw → <code className="text-emerald-300">{derivedOptName}.pms</code>
                    {loadingOptPlan ? ' • przeliczanie...' : ''}
                  </span>
                  {optPlan && (
                    <span className="text-[11px] text-zinc-400">
                      Grupy: {optPlan.groups.length} • Zachowane osobno: {optPlan.preservedPropsCount}
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-zinc-900 p-2 space-y-1">
                  {!currentMapEntry ? (
                    <div className="p-6 text-center text-zinc-500">
                      Wybierz mapę w przeglądarce, aby obliczyć plan łączenia scenerii.
                    </div>
                  ) : !optPlan ? (
                    <div className="p-6 text-center text-zinc-500">
                      {optError && !loadingOptPlan
                        ? 'Nie udało się obliczyć planu dla tej mapy (szczegóły poniżej).'
                        : 'Obliczanie grup warstw i granic kafelków...'}
                    </div>
                  ) : optPlan.groups.length === 0 ? (
                    <div className="p-6 text-center text-zinc-500">
                      Brak grup wieloelementowych do sklejenia przy obecnych ustawieniach.
                    </div>
                  ) : (
                    optPlan.groups.map((grp) => {
                      const lvlName =
                        grp.level === 0
                          ? 'Warstwa 0 (Tył)'
                          : grp.level === 1
                          ? 'Warstwa 1 (Środek)'
                          : 'Warstwa 2 (Przód)';
                      return (
                        <div
                          key={grp.groupId}
                          className="px-2.5 py-2 rounded bg-zinc-900/50 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-semibold text-zinc-200">
                              {lvlName} — przebieg #{grp.runIndex}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400">
                              Obszar: {Math.round(grp.worldBounds.width)} ×{' '}
                              {Math.round(grp.worldBounds.height)} px • maks. {grp.tileCount}{' '}
                              {grp.tileCount === 1 ? 'arkusz PNG' : 'arkusze PNG'} (puste kafelki są pomijane)
                            </div>
                          </div>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                            łączy {grp.propIndices.length} scen.
                          </span>
                        </div>
                      );
                    })
                  )}

                  {optPlan && optPlan.preservedSample.length > 0 && (
                    <div className="pt-2 px-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                        Zachowane osobno bez wypalania ({optPlan.preservedPropsCount}):
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
                              ? 'Tło/Mgła'
                              : pr.reason === 'single_isolated'
                              ? 'Pojedyncza'
                              : pr.reason === 'zero_size'
                              ? 'Rozmiar 0'
                              : pr.reason === 'off_map'
                              ? 'Poza mapą'
                              : 'Wył.'}
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
                        Gotowe! Scenerie zredukowano z {optResult.propsBefore} → {optResult.propsAfter}{' '}
                        ({optResult.generatedPngFiles.length} plików PNG •{' '}
                        {formatBytes(optResult.totalPngBytes)})
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    {optResult.outputMapPath}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Jakość: {supersample}× • kompozycja{' '}
                    {optResult.floatPrecision ? 'zmiennoprzecinkowa (pełna precyzja alfy)' : '8-bit (GPU bez float)'}
                    {optResult.removedOrphanPngs > 0 &&
                      ` • usunięto ${optResult.removedOrphanPngs} nieużywanych PNG z poprzedniej wersji`}
                  </div>
                  {optResult.limitWarnings.length > 0 && (
                    <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Mapa wciąż przekracza limity Soldata: {optResult.limitWarnings.join(', ')}
                    </div>
                  )}
                  {optResult.backupDir && (
                    <div className="text-[11px] text-sky-300 truncate" title={optResult.backupDir}>
                      Poprzednie wersje nadpisanych plików zapisano w kopii: {optResult.backupDir}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openPathInExplorer(optResult.outputMapPath)}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Pokaż folder
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
                        <Play className="w-3.5 h-3.5" /> Otwórz {optResult.derivedBaseName}
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
                    Anuluj
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    optimizing ||
                    previewing ||
                    !currentMapData ||
                    !optPlan ||
                    optPlan.groups.length === 0
                  }
                  onClick={handleBuildPreview}
                  title="Wypala warstwy w pamięci, porównuje z oryginałem w skali ekranu 1080p i pozwala obejrzeć wynik — nic nie jest zapisywane"
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-emerald-200 border border-emerald-500/30 font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-emerald-400" />
                  {previewing ? 'Tworzenie podglądu...' : 'Podgląd i raport wierności (bez zapisu)'}
                </button>
                <button
                  type="button"
                  disabled={
                    optimizing ||
                    previewing ||
                    !currentMapData ||
                    !optPlan ||
                    optPlan.groups.length === 0
                  }
                  onClick={() => handleRunOptimization(false)}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
                >
                  <Layers className="w-4 h-4" />
                  {optimizing
                    ? 'Sklejanie warstw na GPU...'
                    : previewIsCurrent
                    ? `Zapisz ten wynik jako ${derivedOptName}.pms`
                    : `Zoptymalizuj scenerie i zapisz ${derivedOptName}.pms`}
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
    ? 'Przerwano'
    : summary.stoppedEarly
    ? 'Zatrzymano po 5 błędach z rzędu'
    : 'Zakończono';

  return (
    <div className="flex-1 flex flex-col space-y-3.5">
      <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 space-y-1.5 text-[11px] text-zinc-400 leading-relaxed">
        <div className="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-emerald-400" />
          Wsadowa optymalizacja: {batchCount.toLocaleString('pl-PL')} map ({batchSourceLabel})
        </div>
        <p>
          Mapy są sklejane na GPU jedna po drugiej, z ustawieniami z lewej kolumny.{' '}
          {supersampleChoice === 'auto'
            ? 'Jakość Auto jest dobierana osobno dla każdej mapy (najostrzejsza w limicie pamięci).'
            : `Stała jakość ${supersampleChoice}× dla wszystkich map.`}
        </p>
        <p>
          Pomijane są mapy bez scenerii do sklejenia, mapy będące już wynikiem <code>_o</code> oraz mapy, których plik
          wynikowy już istnieje. Zapis: <span className="text-zinc-300">{destinationLabel}</span>.
        </p>
        <p>Raport wierności nie jest liczony dla każdej mapy — przed dużą serią sprawdź podgląd na jednej mapie.</p>
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
          Zastępuj wcześniejsze, niezmienione wyniki Studio dla tych samych map (poprzednia wersja trafia do kopii
          zapasowej). Pliki, których Studio nie utworzyło, nigdy nie są nadpisywane.
        </span>
      </label>

      {running && progress && (
        <div className="space-y-1.5">
          <div className="flex justify-between gap-2 text-[11px] text-zinc-300">
            <span className="truncate">
              Mapa {progress.index + 1} / {progress.total}: <code className="text-emerald-300">{progress.mapName}</code>
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
            {headline}: zoptymalizowano {summary.done} z {summary.total} map
          </div>
          {summary.done > 0 && (
            <div className="text-[11px] text-zinc-300">
              Scenerie: {summary.propsBefore.toLocaleString('pl-PL')} → {summary.propsAfter.toLocaleString('pl-PL')} •
              warstwy PNG: {formatBytes(summary.pngBytes)}
            </div>
          )}
          <div className="text-[11px] text-zinc-400">
            Pominięto: istniejące {summary.skippedExisting} • bez grup do sklejenia {summary.skippedNothingToMerge} •
            wyniki <code>_o</code> {summary.skippedDerived} • błędy {summary.failed}
            {summary.processed < summary.total ? ` • nieprzetworzone ${summary.total - summary.processed}` : ''}
          </div>
          {overLimits.length > 0 && (
            <div className="text-[11px] text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Wciąż ponad limitami Soldata ({overLimits.length}):{' '}
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
                <FolderOpen className="w-3.5 h-3.5" /> Pokaż folder
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
            Anuluj
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
            ? 'Optymalizowanie map na GPU...'
            : `Zoptymalizuj ${batchCount.toLocaleString('pl-PL')} map → *_o.pms`}
        </button>
      </div>
    </div>
  );
};

function rateFidelity(f: FidelityReport): { label: string; cls: string } {
  const sharp = f.sharpnessPct ?? 100;
  if (sharp < 85) {
    return { label: 'Niska — warstwy są wyraźnie miększe niż oryginał', cls: 'text-red-200 border-red-500/40 bg-red-950/40' };
  }
  if (sharp < 94 && f.meanAbsDiff <= 3) {
    return { label: 'Dobra — kolory zgodne, ale warstwy nieco miększe niż oryginał', cls: 'text-amber-200 border-amber-500/40 bg-amber-950/30' };
  }
  if (f.meanAbsDiff <= 1.5 && f.pctPixelsOver8 <= 3) {
    return { label: 'Bardzo wysoka — wynik praktycznie nieodróżnialny od oryginału', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40' };
  }
  if (f.meanAbsDiff <= 3 && f.pctPixelsOver8 <= 8) {
    return { label: 'Dobra — drobne różnice ostrości (rozważ wyższą jakość)', cls: 'text-amber-200 border-amber-500/40 bg-amber-950/30' };
  }
  return { label: 'Niska — widoczne różnice; zwiększ jakość rasteryzacji', cls: 'text-red-200 border-red-500/40 bg-red-950/40' };
}

const FidelityCard: React.FC<{
  preview: OptimizePreview;
  stale: boolean;
  supersample: number;
  onShowInViewport: () => void;
}> = ({ preview, stale, supersample, onShowInViewport }) => {
  const f = preview.fidelity;
  const rating = f ? rateFidelity(f) : null;
  const totalPx = preview.tiles.reduce((acc, t) => acc + t.pngWidth * t.pngHeight, 0);
  return (
    <div className={`rounded-lg p-3 space-y-1.5 border ${rating ? rating.cls : 'border-zinc-800 bg-zinc-950'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold flex items-center gap-1.5">
          <Eye className="w-4 h-4 shrink-0" />
          Podgląd wyniku: {preview.tiles.length} kafelków PNG ({(totalPx / 1e6).toFixed(1)} MPx), jakość {supersample}×
        </div>
        <button
          type="button"
          onClick={onShowInViewport}
          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-semibold shrink-0 cursor-pointer"
        >
          Pokaż w oknie mapy
        </button>
      </div>
      {f && rating ? (
        <>
          <div className="text-[11px]">
            Zgodność z oryginałem (render w skali ekranu 1080p): <strong>{rating.label}</strong>
          </div>
          <div className="text-[10px] font-mono opacity-80">
            ostrość {f.sharpnessPct ?? '—'}% oryginału • śr. różnica {f.meanAbsDiff} / 255 • pikseli z różnicą &gt; 8:{' '}
            {f.pctPixelsOver8}% • maks. {f.maxDiff} • próbka {f.sampledMegapixels} MPx
            {f.worstArea &&
              ` • najgorszy obszar x=${Math.round(f.worstArea.left)}, y=${Math.round(f.worstArea.top)} (śr. ${f.worstArea.meanAbsDiff})`}
          </div>
        </>
      ) : (
        <div className="text-[11px] opacity-80">Brak obszarów do porównania.</div>
      )}
      {stale && (
        <div className="text-[11px] text-amber-300">
          Ustawienia zmieniły się po utworzeniu podglądu — zapis wypali warstwy ponownie z nowymi ustawieniami.
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
      {box(pw, ph, 'teraz', 'border-red-500/50')}
      {box(ew, eh, 'po', 'border-emerald-500/50')}
    </div>
  );
};

function replacedPngFilesText(n: number): string {
  if (n === 1) return ' Zostanie też zastąpiony 1 plik PNG warstw.';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return ` Zostaną też zastąpione ${n} pliki PNG warstw.`;
  }
  return ` Zostanie też zastąpionych ${n} plików PNG warstw.`;
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
          Plik <code>{check.derivedBaseName}.pms</code> już istnieje w folderze docelowym.
        </div>
        <div className="text-[11px] opacity-90">
          {check.existingWasGeneratedByStudio
            ? 'To poprzedni wynik Soldat Map Studio (plik nie był od tego czasu zmieniany).'
            : `UWAGA: ten plik NIE pochodzi z Soldat Map Studio albo był zmieniany${
                check.existingMapTitle ? ` (tytuł mapy: „${check.existingMapTitle}”)` : ''
              } — nadpisanie zastąpi inną mapę!`}
          {check.existingPngFiles.length > 0 && replacedPngFilesText(check.existingPngFiles.length)}
          {' '}Poprzednie wersje trafią do kopii zapasowej w <code>data/backups/</code>.
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
        Anuluj
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
      >
        Nadpisz plik
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
