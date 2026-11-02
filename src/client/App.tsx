import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExtraMapSource,
  IndexMetaResponse,
  MapCompactEntry,
  MapIndexEntry,
  MapQueryRequest,
  MapUserDataPatch,
  ScanProgressStatus,
} from '@shared/apiTypes';
import { PmsMapData } from '@shared/pmsParser';
import { isSameMapFamily, stripDerivedSuffix } from '@shared/mapFamily';
import { CustomPrefixRule } from '@shared/prefixUtils';
import { parseSearchQuery } from '@shared/searchQuery';
import { APP_VERSION } from '@shared/version';
import { ErrorBoundary } from './components/ErrorBoundary';
import { locale, t, tp, tr } from './i18n';
import type { LibraryToolsTab } from './components/LibraryToolsModal';
import { MapBrowserPanel, MapSortField } from './components/MapBrowserPanel';
import { MapInspectorDrawer } from './components/MapInspectorDrawer';
import { MapViewport } from './components/MapViewport';
import {
  ExtraFilterState,
  PrefixSidebar,
  StatusFilterMode,
} from './components/PrefixSidebar';
import { DEFAULT_RENDER_LAYERS, RenderLayerVisibility } from './renderer/types';
import { clearSoldatAssetCache } from './renderer/assetLoader';
import {
  clearClientMapCaches,
  fetchAndParseMap,
  fetchIndexMeta,
  fetchMapDetails,
  fetchScanStatus,
  openPathInExplorer,
  queryMapsPage,
  queryMatchingMapCompacts,
  queryMatchingMapIds,
  saveAppConfig,
  saveCustomPrefixRules,
  updateMapUserData,
} from './utils/mapCache';
import {
  Archive,
  FilePlus2,
  FolderOpen,
  Package,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Settings,
  ShieldCheck,
  Tags,
  Wrench,
} from 'lucide-react';
import { EditorDraftRecoveryBanner } from './editor/components/EditorDraftRecoveryBanner';
import type { EditorValidationIssueUI } from './editor/components/EditorRightDock';
import { isSelectionEmpty } from './editor/EditorDocument';
import { useDeferredValidation } from './editor/useDeferredValidation';
import { useEditorController } from './editor/useEditorController';

// The editor UI loads with the first opened map (the browser alone never needs it)
const EditorCommandPalette = lazy(() =>
  import('./editor/components/EditorCommandPalette').then((m) => ({ default: m.EditorCommandPalette }))
);
const EditorImageTraceModal = lazy(() =>
  import('./editor/components/EditorImageTraceModal').then((m) => ({ default: m.EditorImageTraceModal }))
);
const EditorLeftDock = lazy(() =>
  import('./editor/components/EditorLeftDock').then((m) => ({ default: m.EditorLeftDock }))
);
const EditorNewMapModal = lazy(() =>
  import('./editor/components/EditorNewMapModal').then((m) => ({ default: m.EditorNewMapModal }))
);
const EditorSaveModal = lazy(() =>
  import('./editor/components/EditorSaveModal').then((m) => ({ default: m.EditorSaveModal }))
);
const EditorStatusBar = lazy(() =>
  import('./editor/components/EditorStatusBar').then((m) => ({ default: m.EditorStatusBar }))
);
const EditorSymmetryModal = lazy(() =>
  import('./editor/components/EditorSymmetryModal').then((m) => ({ default: m.EditorSymmetryModal }))
);
const EditorShortcutsModal = lazy(() =>
  import('./editor/components/EditorShortcutsModal').then((m) => ({ default: m.EditorShortcutsModal }))
);
const EditorToasts = lazy(() =>
  import('./editor/components/EditorToasts').then((m) => ({ default: m.EditorToasts }))
);
const EditorToolRail = lazy(() =>
  import('./editor/components/EditorToolRail').then((m) => ({ default: m.EditorToolRail }))
);
const EditorTopBar = lazy(() =>
  import('./editor/components/EditorTopBar').then((m) => ({ default: m.EditorTopBar }))
);
const EditorRightDock = lazy(() =>
  import('./editor/components/EditorRightDock').then((m) => ({ default: m.EditorRightDock }))
);

// Modals are code-split: their chunks load on first opening, so the start-up bundle stays small
const MapWorkshopModal = lazy(() =>
  import('./components/MapWorkshopModal').then((m) => ({ default: m.MapWorkshopModal }))
);
const PackBuilderModal = lazy(() =>
  import('./components/PackBuilderModal').then((m) => ({ default: m.PackBuilderModal }))
);
const PrefixStudioModal = lazy(() =>
  import('./components/PrefixStudioModal').then((m) => ({ default: m.PrefixStudioModal }))
);
const ScreenshotModal = lazy(() =>
  import('./components/ScreenshotModal').then((m) => ({ default: m.ScreenshotModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const LibraryToolsModal = lazy(() =>
  import('./components/LibraryToolsModal').then((m) => ({ default: m.LibraryToolsModal }))
);

/**
 * True from the first time `open` is set: a lazy modal is mounted on first use and then stays mounted,
 * so its form state survives closing exactly like before code splitting.
 */
function useMountedAfterFirstOpen(open: boolean): boolean {
  const openedRef = useRef(open);
  if (open) openedRef.current = true;
  return openedRef.current;
}

const PAGE_SIZE = 400;
const UI_STATE_KEY = 'soldat-map-studio.ui.v1';
const PACK_STATE_KEY = 'soldat-map-studio.pack.v1';

interface PersistedUiState {
  statusFilter?: StatusFilterMode;
  selectedModeGroupIds?: string[];
  selectedPrefixes?: string[];
  selectedSubprefixes?: string[];
  selectedSourceIds?: string[];
  extraFilters?: ExtraFilterState;
  searchQuery?: string;
  sortField?: MapSortField;
  viewMode?: 'list' | 'grid';
  layers?: Partial<RenderLayerVisibility>;
  packMapIds?: string[]; // legacy location of the pack cart (now PACK_STATE_KEY)
  activeMapId?: string | null;
  panels?: { sidebar?: boolean; inspector?: boolean };
}

/**
 * Preferences survive restarts; storage may be unavailable (private mode, blocked site data), in which
 * case the app silently starts with defaults.
 */
function loadPersistedUiState(): PersistedUiState {
  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as PersistedUiState) : {};
  } catch {
    return {};
  }
}

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

function loadPersistedPack(legacy: PersistedUiState): string[] {
  try {
    const raw = window.localStorage.getItem(PACK_STATE_KEY);
    if (raw) return strArray(JSON.parse(raw));
  } catch {
    // Fall back to the legacy combined state
  }
  return strArray(legacy.packMapIds);
}

const scanPhaseLabel = (phase: ScanProgressStatus['phase']): string =>
  phase === 'discovering'
    ? t('finding files')
    : phase === 'indexing'
    ? t('indexing')
    : phase === 'finalizing'
    ? t('finishing')
    : t('idle');

export const App: React.FC = () => {
  const [persisted] = useState(loadPersistedUiState);
  const [meta, setMeta] = useState<IndexMetaResponse | null>(null);
  const [liveScanStatus, setLiveScanStatus] = useState<ScanProgressStatus | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);

  // Browser filters & taxonomy state
  const [statusFilter, setStatusFilter] = useState<StatusFilterMode>(persisted.statusFilter ?? 'all');
  const [selectedModeGroupIds, setSelectedModeGroupIds] = useState<string[]>(() =>
    strArray(persisted.selectedModeGroupIds)
  );
  const [selectedPrefixes, setSelectedPrefixes] = useState<string[]>(() => strArray(persisted.selectedPrefixes));
  const [selectedSubprefixes, setSelectedSubprefixes] = useState<string[]>(() =>
    strArray(persisted.selectedSubprefixes)
  );
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => strArray(persisted.selectedSourceIds));
  const [extraFilters, setExtraFilters] = useState<ExtraFilterState>(() => ({
    weather: 'any',
    requireColliders: false,
    requireWaypoints: false,
    requireCaseMismatch: false,
    ...(persisted.extraFilters ?? {}),
  }));
  const [searchQuery, setSearchQuery] = useState(
    typeof persisted.searchQuery === 'string' ? persisted.searchQuery : ''
  );
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [sortField, setSortField] = useState<MapSortField>(persisted.sortField ?? 'name');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(persisted.viewMode === 'grid' ? 'grid' : 'list');

  // Virtualized paged results state (handles 50,000+ maps effortlessly)
  const [totalFiltered, setTotalFiltered] = useState(0);
  const [queryDurationMs, setQueryDurationMs] = useState(0);
  const [, setCacheTick] = useState(0);
  const [resetScrollToken, setResetScrollToken] = useState(0);
  const [metaRevision, setMetaRevision] = useState(0);
  // Re-runs only the list query (favourites / tags changed) without reloading the active map
  const [listRevision, setListRevision] = useState(0);
  const lastEnsureRangeRef = useRef<[number, number] | null>(null);

  const itemsByIndexRef = useRef<Map<number, MapCompactEntry>>(new Map());
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const inFlightPagesRef = useRef<Set<number>>(new Set());
  const knownNamesByIdRef = useRef<Map<string, string>>(new Map());
  const queryGenRef = useRef(0);

  // Selected map & WebGL2 data
  const [activeMapId, setActiveMapId] = useState<string | null>(
    typeof persisted.activeMapId === 'string' ? persisted.activeMapId : null
  );
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const activeMapIdRef = useRef<string | null>(null);
  activeMapIdRef.current = activeMapId;
  // Geometry and details load independently; both are tagged with their map id so the viewport,
  // exporter and workshop never pair map A's data with map B's name.
  const [loadedDetails, setLoadedDetails] = useState<MapIndexEntry | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [loadedMap, setLoadedMap] = useState<{ id: string; data: PmsMapData } | null>(null);
  // B5: second version of the active map shown right of the viewport divider
  const [compareTarget, setCompareTarget] = useState<{
    forMapId: string;
    key: string;
    label: string;
    data: PmsMapData;
  } | null>(null);
  const [compareCandidates, setCompareCandidates] = useState<Array<{ id: string; baseName: string }>>([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const compactsByIdRef = useRef<Map<string, MapCompactEntry>>(new Map());
  const rememberCompact = (item: MapCompactEntry) => {
    knownNamesByIdRef.current.set(item.id, item.baseName);
    compactsByIdRef.current.set(item.id, item);
  };
  // Consistent pairs for actions (screenshot, workshop, inspector): null until both match the selection
  const activeMapData = loadedMap && loadedMap.id === activeMapId ? loadedMap.data : null;
  const activeMapDetails = loadedDetails && loadedDetails.id === activeMapId ? loadedDetails : null;
  // The viewport keeps showing the previously loaded map (with ITS own name) until the new one is ready
  const viewportEntry: MapIndexEntry | MapCompactEntry | null = loadedMap
    ? loadedDetails && loadedDetails.id === loadedMap.id
      ? loadedDetails
      : compactsByIdRef.current.get(loadedMap.id) ?? null
    : null;
  const [layers, setLayers] = useState<RenderLayerVisibility>(() => ({
    ...DEFAULT_RENDER_LAYERS,
    ...(persisted.layers ?? {}),
  }));

  // Map Pack Cart
  const [packMapIds, setPackMapIds] = useState<Set<string>>(() => new Set(loadPersistedPack(persisted)));
  const [panels, setPanels] = useState<{ sidebar: boolean; inspector: boolean }>(() => ({
    sidebar: persisted.panels?.sidebar !== false,
    inspector: persisted.panels?.inspector !== false,
  }));
  const packListArray = useMemo(() => Array.from(packMapIds), [packMapIds]);

  // Persist preferences (debounced; the pack cart can hold tens of thousands of ids)
  useEffect(() => {
    const t = setTimeout(() => {
      const state: PersistedUiState = {
        statusFilter,
        selectedModeGroupIds,
        selectedPrefixes,
        selectedSubprefixes,
        selectedSourceIds,
        extraFilters,
        searchQuery,
        sortField,
        viewMode,
        layers,
        activeMapId,
        panels,
      };
      try {
        window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
      } catch {
        // Storage full or unavailable: preferences are a convenience only
      }
    }, 600);
    return () => clearTimeout(t);
  }, [
    statusFilter,
    selectedModeGroupIds,
    selectedPrefixes,
    selectedSubprefixes,
    selectedSourceIds,
    extraFilters,
    searchQuery,
    sortField,
    viewMode,
    layers,
    activeMapId,
    panels,
  ]);

  // The pack cart can hold tens of thousands of ids: stored under its own key, only when it changes
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(PACK_STATE_KEY, JSON.stringify(packListArray));
      } catch {
        // Storage full or unavailable
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [packListArray]);

  // Modals & Live Repair Preview
  const [packModalOpen, setPackModalOpen] = useState(false);
  const [prefixStudioState, setPrefixStudioState] = useState<{
    open: boolean;
    draftPrefix: string | null;
  }>({ open: false, draftPrefix: null });
  const [screenshotModalState, setScreenshotModalState] = useState<{
    open: boolean;
    batch: boolean;
  }>({ open: false, batch: false });
  const [workshopModalState, setWorkshopModalState] = useState<{
    open: boolean;
    tab: 'fix' | 'optimize';
  }>({ open: false, tab: 'fix' });
  const [livePreviewMap, setLivePreviewMap] = useState<{
    forMapId: string;
    data: PmsMapData;
    banner: string;
    layerQuality?: number;
  } | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [libraryToolsState, setLibraryToolsState] = useState<{ open: boolean; tab: LibraryToolsTab }>({
    open: false,
    tab: 'duplicates',
  });

  // Debounce search text
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 110);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const applyMetaUpdate = useCallback((nextMeta: IndexMetaResponse) => {
    // Files may have changed on disk (new/overwritten _f/_o maps): never serve stale parsed maps or details
    clearClientMapCaches();
    setMeta(nextMeta);
    setLiveScanStatus(nextMeta.scanStatus);
    setMetaRevision((r) => r + 1);
    if (!nextMeta.scanStatus.scanning) {
      setScanning(false);
    }
    setActiveMapId((prev) => prev ?? nextMeta.defaultMapId);
  }, []);

  const triggerLoadMeta = useCallback(
    async (forceRefresh = false) => {
      setScanning(true);
      setScanError(null);
      if (forceRefresh) clearSoldatAssetCache(); // textures / sceneries may have been edited on disk
      try {
        const nextMeta = await fetchIndexMeta(forceRefresh);
        applyMetaUpdate(nextMeta);
        if (nextMeta.scanStatus.scanning) {
          setScanning(true);
        }
      } catch (err) {
        setScanError(err instanceof Error ? err.message : String(err));
        setScanning(false);
      }
    },
    [applyMetaUpdate]
  );

  useEffect(() => {
    triggerLoadMeta(false);
  }, [triggerLoadMeta]);

  // Poll background scan progress when indexing massive 50k+ map collections.
  // Self-rescheduling (no overlapping polls). When the scan ends, the finished index is fetched BEFORE
  // liveScanStatus changes — changing it ends this effect, which used to drop the final index update.
  useEffect(() => {
    if (!liveScanStatus?.scanning) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const st = await fetchScanStatus();
        if (stopped) return;
        if (!st.scanning) {
          const freshMeta = await fetchIndexMeta(false);
          applyMetaUpdate(freshMeta);
          if (!freshMeta.scanStatus.scanning) return; // a queued follow-up scan keeps us polling
        } else {
          setLiveScanStatus(st);
        }
      } catch {
        // Ignore transient poll error
      }
      if (!stopped) timer = setTimeout(poll, 350);
    };
    timer = setTimeout(poll, 350);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [liveScanStatus?.scanning, applyMetaUpdate]);

  // Build current query request object
  const baseQueryRequest: MapQueryRequest = useMemo(
    () => ({
      statusFilter,
      modeGroupIds: selectedModeGroupIds.length > 0 ? selectedModeGroupIds : undefined,
      prefixes: selectedPrefixes.length > 0 ? selectedPrefixes : undefined,
      subprefixes: selectedSubprefixes.length > 0 ? selectedSubprefixes : undefined,
      sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
      searchQuery: debouncedSearch || undefined,
      weather: extraFilters.weather,
      requireColliders: extraFilters.requireColliders || undefined,
      requireWaypoints: extraFilters.requireWaypoints || undefined,
      requireCaseMismatch: extraFilters.requireCaseMismatch || undefined,
      packMapIds: statusFilter === 'in_pack' ? packListArray : undefined,
      sortField,
    }),
    [
      statusFilter,
      selectedModeGroupIds,
      selectedPrefixes,
      selectedSubprefixes,
      selectedSourceIds,
      debouncedSearch,
      extraFilters,
      packListArray,
      sortField,
    ]
  );

  // Reset paged cache & fetch page 0 whenever query filters/sort or index revision change
  const lastScrollQueryRef = useRef<MapQueryRequest | null>(null);
  useEffect(() => {
    if (!meta) return;
    const gen = ++queryGenRef.current;
    // Only a filter/sort change jumps back to the top; an index refresh keeps the scroll position
    const filtersChanged = lastScrollQueryRef.current !== baseQueryRequest;
    lastScrollQueryRef.current = baseQueryRequest;
    itemsByIndexRef.current.clear();
    loadedPagesRef.current.clear();
    inFlightPagesRef.current.clear();

    const controller = new AbortController();
    inFlightPagesRef.current.add(0);

    queryMapsPage({ ...baseQueryRequest, offset: 0, limit: PAGE_SIZE }, controller.signal)
      .then((res) => {
        if (gen !== queryGenRef.current) return;
        inFlightPagesRef.current.delete(0);
        loadedPagesRef.current.add(0);

        // The active map may not be on the first page of the new result set: keyboard navigation must
        // then not continue from a stale row index belonging to the previous filter.
        let foundActive = -1;
        const currentActiveId = activeMapIdRef.current; // a click made while the query ran must win
        for (let i = 0; i < res.items.length; i++) {
          const item = res.items[i];
          itemsByIndexRef.current.set(i, item);
          rememberCompact(item);
          if (item.id === currentActiveId) foundActive = i;
        }
        setActiveIndex(foundActive);
        setListError(null);

        setTotalFiltered(res.totalFiltered);
        setQueryDurationMs(res.queryDurationMs);
        if (filtersChanged) setResetScrollToken((t) => t + 1);
        setCacheTick((t) => t + 1);
        // A refresh that keeps the scroll position must refill the rows on screen, not only page 0
        const range = lastEnsureRangeRef.current;
        if (!filtersChanged && range) handleEnsureRange(range[0], range[1]);

        if (!currentActiveId && res.items.length > 0) {
          setActiveMapId(res.items[0].id);
          setActiveIndex(0);
        }
      })
      .catch((err) => {
        inFlightPagesRef.current.delete(0);
        if ((err as Error)?.name !== 'AbortError' && gen === queryGenRef.current) {
          setListError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseQueryRequest, metaRevision, listRevision]);

  const handleEnsureRange = useCallback(
    (startIdx: number, endIdx: number) => {
      lastEnsureRangeRef.current = [startIdx, endIdx];
      const startPage = Math.max(0, Math.floor(startIdx / PAGE_SIZE));
      const endPage = Math.max(0, Math.floor(endIdx / PAGE_SIZE));
      const gen = queryGenRef.current;

      for (let p = startPage; p <= endPage; p++) {
        if (loadedPagesRef.current.has(p) || inFlightPagesRef.current.has(p)) continue;
        inFlightPagesRef.current.add(p);
        const offset = p * PAGE_SIZE;

        queryMapsPage({ ...baseQueryRequest, offset, limit: PAGE_SIZE })
          .then((res) => {
            if (gen !== queryGenRef.current) return;
            inFlightPagesRef.current.delete(p);
            loadedPagesRef.current.add(p);
            for (let i = 0; i < res.items.length; i++) {
              const item = res.items[i];
              itemsByIndexRef.current.set(offset + i, item);
              rememberCompact(item);
              if (item.id === activeMapIdRef.current) setActiveIndex(offset + i);
            }
            setCacheTick((t) => t + 1);
          })
          .catch((err) => {
            inFlightPagesRef.current.delete(p);
            if (gen === queryGenRef.current) setListError(err instanceof Error ? err.message : String(err));
          });
      }
    },
    [baseQueryRequest]
  );

  const getItemAt = useCallback((index: number): MapCompactEntry | undefined => {
    return itemsByIndexRef.current.get(index);
  }, []);

  const handleSelectMapAt = useCallback((idx: number, item: MapCompactEntry) => {
    setActiveIndex(idx);
    setActiveMapId(item.id);
  }, []);

  // Load full PMS geometry + detailed asset audit when activeMapId changes
  useEffect(() => {
    setLivePreviewMap((prev) => (prev && prev.forMapId === activeMapId ? prev : null));
    if (!activeMapId) {
      setLoadedMap(null);
      setLoadedDetails(null);
      return;
    }
    let cancelled = false;
    setLoadingMap(true);
    setLoadingDetails(true);
    setMapLoadError(null);
    setDetailsError(null);

    const requestedId = activeMapId;
    fetchAndParseMap(requestedId)
      .then((parsed) => {
        if (!cancelled) setLoadedMap({ id: requestedId, data: parsed });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // A remembered map that no longer exists (renamed/deleted) falls back to the default map
        if (message.includes('(404)') && meta?.defaultMapId && meta.defaultMapId !== activeMapId) {
          setActiveMapId(meta.defaultMapId);
          return;
        }
        setMapLoadError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingMap(false);
      });

    fetchMapDetails(requestedId)
      .then((details) => {
        if (!cancelled) {
          knownNamesByIdRef.current.set(details.id, details.baseName);
          setLoadedDetails(details);
        }
      })
      .catch((err) => {
        if (!cancelled) setDetailsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeMapId, metaRevision]);

  // Taxonomy & Filter Handlers
  // Plain click: the entry becomes the only selection on every level (clicking the sole selection clears it).
  // Ctrl+click adds or removes it; the server shows maps matching any selected entry.
  const handleToggleTaxonomy = (level: 'group' | 'prefix' | 'subprefix', value: string, multi: boolean) => {
    const current = { group: selectedModeGroupIds, prefix: selectedPrefixes, subprefix: selectedSubprefixes };
    if (multi) {
      const setter = { group: setSelectedModeGroupIds, prefix: setSelectedPrefixes, subprefix: setSelectedSubprefixes }[level];
      setter((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
      return;
    }
    const isSoleSelection =
      current[level].length === 1 &&
      current[level][0] === value &&
      selectedModeGroupIds.length + selectedPrefixes.length + selectedSubprefixes.length === 1;
    const pick = (l: typeof level) => (l === level && !isSoleSelection ? [value] : []);
    setSelectedModeGroupIds(pick('group'));
    setSelectedPrefixes(pick('prefix'));
    setSelectedSubprefixes(pick('subprefix'));
  };
  const handleToggleModeGroup = (groupId: string, multi: boolean) => handleToggleTaxonomy('group', groupId, multi);
  const handleTogglePrefix = (prefix: string, multi: boolean) => handleToggleTaxonomy('prefix', prefix, multi);
  const handleToggleSubprefix = (subprefix: string, multi: boolean) =>
    handleToggleTaxonomy('subprefix', subprefix, multi);

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((s) => s !== sourceId) : [...prev, sourceId]
    );
  };

  const handleClearTaxonomySelection = () => {
    setSelectedModeGroupIds([]);
    setSelectedPrefixes([]);
    setSelectedSubprefixes([]);
  };

  // Pack Cart Handlers (Scalable to 50,000+ maps!)
  const handleToggleMapInPack = useCallback((mapId: string) => {
    setPackMapIds((prev) => {
      const next = new Set(prev);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });
  }, []);

  const addIdsToPack = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setPackMapIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const handleRangeAddMapsToPack = useCallback(
    async (startIdx: number, endIdx: number) => {
      const count = endIdx - startIdx + 1;
      if (count <= 0) return;
      const localIds: string[] = [];
      let allCached = true;
      for (let i = startIdx; i <= endIdx; i++) {
        const hit = itemsByIndexRef.current.get(i);
        if (hit) localIds.push(hit.id);
        else {
          allCached = false;
          break;
        }
      }
      if (allCached) {
        addIdsToPack(localIds);
        return;
      }
      // The server caps a page at 2000 rows, so long Shift+click ranges are fetched in chunks
      const ids: string[] = [];
      try {
        for (let offset = startIdx; offset <= endIdx; offset += 2000) {
          const limit = Math.min(2000, endIdx - offset + 1);
          const res = await queryMapsPage({ ...baseQueryRequest, offset, limit });
          for (const m of res.items) ids.push(m.id);
          if (res.items.length < limit) break;
        }
      } catch (err) {
        setScanError(err instanceof Error ? err.message : String(err));
        return;
      }
      addIdsToPack(ids);
    },
    [baseQueryRequest, addIdsToPack]
  );

  const addQueryResultToPack = (req: MapQueryRequest) => {
    queryMatchingMapIds(req)
      .then(addIdsToPack)
      .catch((err) => setScanError(err instanceof Error ? err.message : String(err)));
  };

  const handleAddModeGroupToPack = (groupId: string) => addQueryResultToPack({ modeGroupIds: [groupId] });
  const handleAddPrefixToPack = (prefix: string) => addQueryResultToPack({ prefixes: [prefix] });
  const handleAddSubprefixToPack = (subprefix: string) =>
    addQueryResultToPack({ subprefixes: [subprefix] });
  const handleAddAllFilteredToPack = () => addQueryResultToPack(baseQueryRequest);

  const handleRemoveFilteredFromPack = async () => {
    // In the "in pack" view the query already intersects with the pack, so this removes exactly the
    // currently visible maps (other active filters are respected instead of clearing the whole pack).
    let ids: string[];
    try {
      ids = await queryMatchingMapIds(baseQueryRequest);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
      return;
    }
    setPackMapIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const selectMapById = useCallback((mapId: string) => {
    setLivePreviewMap(null);
    setActiveMapId(mapId);
    let foundIdx = -1;
    for (const [idx, item] of itemsByIndexRef.current) {
      if (item.id === mapId) {
        foundIdx = idx;
        break;
      }
    }
    setActiveIndex(foundIdx);
  }, []);

  const handleSaveConfig = async (soldatPath: string, extraSources: ExtraMapSource[]) => {
    setScanning(true);
    try {
      const nextMeta = await saveAppConfig(soldatPath, extraSources);
      clearSoldatAssetCache();
      applyMetaUpdate(nextMeta);
    } finally {
      setScanning(false);
    }
  };

  const handleSaveCustomRules = async (rules: CustomPrefixRule[]) => {
    const nextMeta = await saveCustomPrefixRules(rules);
    applyMetaUpdate(nextMeta);
  };

  const handleResolveBatchCandidates = useCallback(async () => {
    if (packMapIds.size > 0) {
      return await queryMatchingMapCompacts({
        statusFilter: 'in_pack',
        packMapIds: Array.from(packMapIds),
        sortField,
      });
    }
    return await queryMatchingMapCompacts(baseQueryRequest);
  }, [packMapIds, sortField, baseQueryRequest]);

  const getMapLabelById = useCallback((id: string) => {
    return knownNamesByIdRef.current.get(id) || id;
  }, []);

  const isBgScanning = Boolean(liveScanStatus?.scanning || scanning);
  const scanPct =
    liveScanStatus && liveScanStatus.totalFiles > 0
      ? Math.round((liveScanStatus.scannedFiles / liveScanStatus.totalFiles) * 100)
      : 0;

  // Favourite / tags: saved on the server, then patched into every cached copy of that map (no list reload)
  const userDataQueryRef = useRef({ statusFilter, search: debouncedSearch });
  userDataQueryRef.current = { statusFilter, search: debouncedSearch };
  const handleUpdateUserData = useCallback(async (mapId: string, patch: MapUserDataPatch) => {
    try {
      const res = await updateMapUserData(mapId, patch);
      const apply = <T extends MapCompactEntry>(entry: T): T => ({ ...entry, favorite: res.favorite, tags: res.tags });
      for (const [idx, item] of itemsByIndexRef.current) {
        if (item.id === mapId) itemsByIndexRef.current.set(idx, apply(item));
      }
      const known = compactsByIdRef.current.get(mapId);
      if (known) compactsByIdRef.current.set(mapId, apply(known));
      setLoadedDetails((d) => (d && d.id === mapId ? apply(d) : d));
      setMeta((prev) => (prev ? { ...prev, favoriteMapsCount: res.favoriteMapsCount, userTags: res.userTags } : prev));
      setCacheTick((t) => t + 1);
      // Only a list that depends on favourites / tags re-runs its query (and the active map is not reloaded)
      const q = userDataQueryRef.current;
      const dependsOnUserData =
        q.statusFilter === 'favorites' ||
        parseSearchQuery(q.search).terms.some(
          (t) => (t.kind === 'flag' && t.flag === 'fav') || (t.kind === 'field' && t.field === 'tag')
        );
      if (dependsOnUserData) setListRevision((r) => r + 1);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  const handleToggleFavorite = useCallback(
    (mapId: string, favorite: boolean) => handleUpdateUserData(mapId, { favorite }),
    [handleUpdateUserData]
  );
  const handleSearchTag = useCallback((tag: string) => {
    setSearchQuery((q) => {
      const present = parseSearchQuery(q).terms.some(
        (t) => t.kind === 'field' && t.field === 'tag' && !t.negate && t.value === tag.toLowerCase()
      );
      if (present) return q;
      const token = /\s/.test(tag) ? `tag:"${tag}"` : `tag:${tag}`;
      return `${q.trim()} ${token}`.trim();
    });
  }, []);
  const knownTags = useMemo(() => (meta?.userTags ?? []).map((t) => t.tag), [meta?.userTags]);

  // Related versions of the active map (X, X_f, X_o, X_f_o) for the compare menu
  const activeBaseName = activeMapDetails?.baseName ?? null;
  useEffect(() => {
    if (!activeBaseName || !activeMapId) {
      setCompareCandidates([]);
      return;
    }
    const root = stripDerivedSuffix(activeBaseName);
    let cancelled = false;
    const timer = setTimeout(() => {
      // Long names are shortened when `_f` / `_o` is added, so the query uses only the beginning of the name
      queryMatchingMapCompacts({ searchQuery: `name:${root.slice(0, 12).toLowerCase()}` })
        .then((items) => {
          if (cancelled) return;
          setCompareCandidates(
            items
              .filter((m) => m.id !== activeMapId && isSameMapFamily(activeBaseName, m.baseName))
              .map((m) => ({ id: m.id, baseName: m.baseName }))
          );
        })
        .catch(() => {
          if (!cancelled) setCompareCandidates([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeBaseName, activeMapId, metaRevision]);

  // A comparison belongs to the map it was started for
  useEffect(() => {
    if (compareTarget && compareTarget.forMapId !== activeMapId) setCompareTarget(null);
  }, [activeMapId, compareTarget]);
  useEffect(() => {
    if (!livePreviewMap && compareTarget?.key.startsWith('original:')) setCompareTarget(null);
  }, [livePreviewMap, compareTarget]);

  const handleStartCompare = useCallback(
    (mapId: string) => {
      const forMapId = activeMapId;
      if (!forMapId) return;
      const label = compareCandidates.find((c) => c.id === mapId)?.baseName ?? mapId;
      fetchAndParseMap(mapId)
        .then((data) => {
          if (activeMapIdRef.current === forMapId) setCompareTarget({ forMapId, key: mapId, label, data });
        })
        .catch((err) => setScanError(err instanceof Error ? err.message : String(err)));
    },
    [activeMapId, compareCandidates]
  );

  const previewActive = Boolean(livePreviewMap && livePreviewMap.forMapId === activeMapId);
  const handleCompareWithOriginal =
    previewActive && activeMapId && activeMapData
      ? () =>
          setCompareTarget({
            forMapId: activeMapId,
            key: `original:${activeMapId}`,
            label: t('{name} (original)', { name: activeMapDetails?.baseName ?? t('map') }),
            data: activeMapData,
          })
      : null;

  const workshopMounted = useMountedAfterFirstOpen(workshopModalState.open);
  const prefixStudioMounted = useMountedAfterFirstOpen(prefixStudioState.open);
  const packModalMounted = useMountedAfterFirstOpen(packModalOpen);
  const screenshotMounted = useMountedAfterFirstOpen(screenshotModalState.open);
  const settingsMounted = useMountedAfterFirstOpen(settingsModalOpen);
  const libraryToolsMounted = useMountedAfterFirstOpen(libraryToolsState.open);

  const editor = useEditorController({
    layers,
    onChangeLayers: setLayers,
    onMetaUpdated: applyMetaUpdate,
    onSavedToLibrary: selectMapById,
  });

  const handleEditCurrentMap = useCallback(() => {
    const targetData = loadedMap?.data;
    if (!targetData) return;
    const baseName =
      (loadedDetails && loadedDetails.id === loadedMap.id
        ? loadedDetails.baseName
        : compactsByIdRef.current.get(loadedMap.id)?.baseName) ?? null;
    editor.openMapInEditor({
      map: targetData,
      sourceMapId: loadedMap.id,
      sourceBaseName: baseName,
    });
  }, [loadedMap, loadedDetails, editor]);

  const knownEditorAssetSets = useMemo(() => {
    if (!editor.assetCatalog) return { textures: null, sceneries: null };
    return {
      textures: new Set(editor.assetCatalog.textures.map((item) => item.name.toLowerCase())),
      sceneries: new Set(editor.assetCatalog.sceneries.map((item) => item.name.toLowerCase())),
    };
  }, [editor.assetCatalog]);

  const [validationHints, setValidationHints] = useState(false);
  const deferredValidation = useDeferredValidation(editor.snapshot?.map ?? null, {
    knownTexturesLower: knownEditorAssetSets.textures,
    knownSceneriesLower: knownEditorAssetSets.sceneries,
    mapBaseName: editor.snapshot ? editor.snapshot.currentBaseName || editor.snapshot.sourceBaseName : null,
    includeHints: validationHints,
  });
  const editorValidationIssues: EditorValidationIssueUI[] = useMemo(() => {
    return deferredValidation.issues.map((issue) => {
      const params =
        issue.messageParams && typeof issue.messageParams.label === 'string'
          ? { ...issue.messageParams, label: t(issue.messageParams.label) }
          : issue.messageParams;
      return {
        id: issue.id,
        severity: issue.severity,
        message: t(issue.messageKey, params),
        selection: issue.selection,
        focusBounds: issue.focusBounds,
        focusPoint: issue.focusPoint,
        fix: issue.fix,
      };
    });
  }, [deferredValidation.issues]);
  const editorErrorCount = editorValidationIssues.filter((i) => i.severity === 'error').length;
  const editorWarningCount = editorValidationIssues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top Application Header Bar (or Editor Top Bar when editing) */}
      {editor.isOpen && editor.snapshot ? (
        <Suspense fallback={<div className="h-11 shrink-0 bg-zinc-900/95 border-b border-zinc-800" />}>
        <EditorTopBar
          snapshot={editor.snapshot}
          isDirty={editor.isDirty}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          selectionFilter={editor.selectionFilter}
          onChangeSelectionFilter={editor.setSelectionFilter}
          validationErrors={editorErrorCount}
          validationWarnings={editorWarningCount}
          onUndo={editor.undo}
          onRedo={editor.redo}
          onOpenNewMap={() => editor.setNewMapModalOpen(true)}
          onOpenSave={() => editor.setSaveModalOpen(true)}
          onOpenSymmetry={() => editor.setSymmetryModalOpen(true)}
          onOpenImageTrace={() => editor.setImageTraceModalOpen(true)}
          onOpenValidation={() => editor.setRightTab('validation')}
          onOpenCommandPalette={() => editor.setCommandPaletteOpen(true)}
          onExitEditor={(force) => {
            editor.closeEditor(force);
          }}
          panelsHidden={editor.panelsHidden}
          onTogglePanels={() => editor.setPanelsHidden((v) => !v)}
          hasSaveTarget={editor.hasSaveTarget}
          onQuickSave={() => void editor.quickSave()}
          lastAutosaveAt={editor.lastAutosaveAt}
        />
        </Suspense>
      ) : (
      <header className="h-12 shrink-0 bg-zinc-950 border-b border-zinc-800/90 px-4 flex items-center justify-between select-none">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-md shadow-emerald-950 shrink-0">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <div className="shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-zinc-100">
                SOLDAT MAP STUDIO
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                v{APP_VERSION}<span className="hidden 2xl:inline"> • MPA PRO + 100% VIEW + _f/_o WORKSHOP</span>
              </span>
            </div>
          </div>

          {meta && (
            <div className="hidden xl:flex items-center gap-2 ml-3 pl-3 border-l border-zinc-800 text-xs text-zinc-400 min-w-0 overflow-hidden">
              <span className="font-mono text-[11px] text-zinc-300 truncate max-w-64">
                {meta.soldatPath}
              </span>
              <button
                type="button"
                onClick={() => openPathInExplorer(meta.soldatPath)}
                title={t('Open the Soldat folder in the file manager')}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
              <span className="text-zinc-600">•</span>
              <span className="shrink-0">
                <strong className="text-zinc-200 font-mono">
                  {meta.totalMaps.toLocaleString(locale)}
                </strong>{' '}
                {tp(meta.totalMaps, 'map', 'maps')} ({meta.scanDurationMs} ms)
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPanels((p) => ({ ...p, sidebar: !p.sidebar }))}
            title={panels.sidebar ? t('Hide the categories and prefixes panel') : t('Show the categories and prefixes panel')}
            aria-label={t('Toggle the categories panel')}
            aria-pressed={panels.sidebar}
            className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
              panels.sidebar
                ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPanels((p) => ({ ...p, inspector: !p.inspector }))}
            title={panels.inspector ? t('Hide the map details panel') : t('Show the map details panel')}
            aria-label={t('Toggle the details panel')}
            aria-pressed={panels.inspector}
            className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
              panels.inspector
                ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => editor.setNewMapModalOpen(true)}
            title={t('Create a new .pms map from a starter template')}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-emerald-500/35 text-xs font-semibold text-emerald-200 flex items-center gap-1.5 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline">{t('New map')}</span>
          </button>

          <button
            type="button"
            onClick={handleEditCurrentMap}
            disabled={!loadedMap}
            title={t('Open this map in the interactive Map Editor')}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-xs font-semibold text-cyan-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Pencil className="w-3.5 h-3.5 text-cyan-300" />
            <span className="hidden lg:inline">{t('Edit map')}</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkshopModalState({ open: true, tab: 'fix' })}
            disabled={!activeMapDetails}
            title={t(
              'Soldat Map Workshop: automatic scenery repair after the move to 1.7.1 (_f.pms) and Optimize Sceneries layer merging (_o.pms)'
            )}
            className="px-2.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-xs font-semibold text-amber-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden lg:inline">{t('Workshop _f / _o')}</span>
          </button>

          <button
            type="button"
            onClick={() => setPrefixStudioState({ open: true, draftPrefix: null })}
            disabled={!meta}
            title={t('Manage custom prefixes, clan categories and RSCS / Trenchwars rules')}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Tags className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline">{t('Custom Prefixes')}</span>
            {meta && meta.customRules.length > 0 && (
              <span className="font-mono text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-300">
                {meta.customRules.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setLibraryToolsState({ open: true, tab: 'duplicates' })}
            disabled={!meta || isBgScanning}
            title={t(
              'Clean-up: duplicate maps (identical CRC32), unused scenery files and letter case in file names (Linux)'
            )}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Archive className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline">{t('Clean-up')}</span>
            {meta && meta.duplicateMapsCount > 0 && (
              <span className="font-mono text-[10px] px-1 rounded bg-orange-500/20 text-orange-300">
                {meta.duplicateMapsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => triggerLoadMeta(true)}
            disabled={isBgScanning}
            title={t('Refresh the index of maps and files on disk (SQLite WAL)')}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isBgScanning ? 'animate-spin text-emerald-400' : ''}`}
            />
            <span className="hidden lg:inline">{t('Refresh')}</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsModalOpen(true)}
            disabled={!meta}
            title={t('Settings: language, Soldat game folder and extra map sources')}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{t('Settings')}</span>
          </button>

          <button
            type="button"
            onClick={() => setPackModalOpen(true)}
            title={t('Map pack builder')}
            className="px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-violet-950/60 transition-colors cursor-pointer"
          >
            <Package className="w-4 h-4" />
            <span className="hidden xl:inline">{t('Map Pack Builder')}</span>
            <span className="font-mono bg-black/30 px-1.5 py-0.5 rounded text-[11px]">
              {packMapIds.size.toLocaleString(locale)}
            </span>
          </button>
        </div>
      </header>
      )}

      {/* Crash-Recovery Banner for Unsaved Map Editor Drafts */}
      <EditorDraftRecoveryBanner
        isEditorOpen={editor.isOpen}
        onRecoverDraft={(opts) => editor.openMapInEditor({ ...opts, startDirty: true })}
      />

      {/* Live Background Indexing Progress Banner (for huge 50,000+ map scans) */}
      {liveScanStatus?.scanning && (
        <div className="bg-emerald-950/80 border-b border-emerald-700/50 px-4 py-1.5 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-emerald-200 truncate">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
            <span>
              {t('Indexing the map collection ({phase}):', { phase: scanPhaseLabel(liveScanStatus.phase) })}{' '}
              <strong className="font-mono">
                {liveScanStatus.scannedFiles.toLocaleString(locale)} /{' '}
                {liveScanStatus.totalFiles.toLocaleString(locale)}
              </strong>{' '}
              {liveScanStatus.mapsPerSec > 0 && `• ${t('{n} maps/s', { n: liveScanStatus.mapsPerSec })}`}{' '}
              {liveScanStatus.currentFile && `• ${liveScanStatus.currentFile}`}
            </span>
          </div>
          <div className="w-48 h-1.5 bg-zinc-950 rounded-full overflow-hidden shrink-0">
            <div
              className="h-full bg-emerald-400 transition-all duration-200"
              style={{ width: `${scanPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Scan Error Banner */}
      {scanError && (
        <div className="bg-red-950 border-b border-red-800 px-4 py-2 text-xs text-red-200 flex items-center justify-between gap-3">
          <span>{t('Cannot reach the indexing server: {error}', { error: scanError })}</span>
          <button
            type="button"
            onClick={() => setScanError(null)}
            className="text-red-300 hover:text-red-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Invalid Soldat folder warning (nothing can be rendered or packed without it) */}
      {meta && !meta.validSoldatDir && !liveScanStatus?.scanning && (
        <div className="bg-amber-950/90 border-b border-amber-700/60 px-4 py-2 text-xs text-amber-100 flex items-center justify-between gap-3">
          <span>
            {tr(
              'The Soldat game folder {path} does not exist or has no {maps} folder — textures, sceneries and maps will not be visible.',
              { path: <code className="font-mono">{meta.soldatPath}</code>, maps: <code>maps/</code> }
            )}
          </span>
          <button
            type="button"
            onClick={() => setSettingsModalOpen(true)}
            className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer shrink-0"
          >
            {t('Set the Soldat folder')}
          </button>
        </div>
      )}

      {/* Main Workspace (WebGL2 MapViewport stays mounted in slot 1 across Browser <-> Editor switches!) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {editor.isOpen && editor.snapshot ? (
          <Suspense fallback={null}>
            <EditorToolRail
              activeTool={editor.activeTool}
              onSelectTool={editor.setActiveTool}
              onOpenImageTrace={() => editor.setImageTraceModalOpen(true)}
              snapToGrid={editor.snap.snapToGrid}
              onToggleGridSnap={() =>
                editor.setSnap((prev) => ({ ...prev, snapToGrid: !prev.snapToGrid }))
              }
              hasSelection={!isSelectionEmpty(editor.snapshot.selection)}
              onDuplicate={editor.handleDuplicateSelection}
              onDelete={editor.handleDeleteSelection}
            />
            <div className={editor.panelsHidden ? 'hidden' : 'contents'}>
            <EditorLeftDock
              activeTab={editor.leftTab}
              onChangeTab={editor.setLeftTab}
              map={editor.snapshot.map}
              selection={editor.snapshot.selection}
              onUpdateSelection={editor.updateSelection}
              onFocusBounds={editor.focusWorldRect}
              layers={layers}
              onChangeLayers={setLayers}
              locks={editor.locks}
              onChangeLocks={editor.setLocks}
              snap={editor.snap}
              onChangeSnap={editor.setSnap}
              blueprint={editor.blueprint}
              onChangeBlueprint={editor.setBlueprint}
              onOpenImageTrace={() => editor.setImageTraceModalOpen(true)}
              assetCatalog={editor.assetCatalog}
              onRefreshAssets={editor.refreshAssetCatalog}
              placement={editor.placement}
              onChangePlacement={editor.setPlacement}
              onSelectTool={editor.setActiveTool}
              onApplyMapTexture={(texName) => editor.updateHeader({ texture: texName })}
              activePrefab={editor.activePrefab}
              onSelectPrefab={editor.setActivePrefab}
              onReplaceSelectedScenery={editor.replaceSelectedScenery}
              recentSceneries={editor.recentSceneries}
            />
            </div>
          </Suspense>
        ) : (
          <>
            {panels.sidebar && (
              <PrefixSidebar
                totalMaps={meta?.totalMaps ?? 0}
                customMapsCount={meta?.customMapsCount ?? 0}
                vanillaMapsCount={meta?.vanillaMapsCount ?? 0}
                brokenMapsCount={meta?.brokenMapsCount ?? 0}
                duplicateMapsCount={meta?.duplicateMapsCount ?? 0}
                incompatibleMapsCount={meta?.incompatibleMapsCount ?? 0}
                favoriteMapsCount={meta?.favoriteMapsCount ?? 0}
                userTags={meta?.userTags ?? []}
                onSearchTag={handleSearchTag}
                packCount={packMapIds.size}
                modeGroups={meta?.modeGroups ?? []}
                prefixes={meta?.prefixes ?? []}
                discoveredSubprefixes={meta?.discoveredSubprefixes ?? []}
                sources={meta?.sources ?? []}
                selectedModeGroupIds={selectedModeGroupIds}
                selectedPrefixes={selectedPrefixes}
                selectedSubprefixes={selectedSubprefixes}
                selectedSourceIds={selectedSourceIds}
                onToggleModeGroup={handleToggleModeGroup}
                onTogglePrefix={handleTogglePrefix}
                onToggleSubprefix={handleToggleSubprefix}
                onToggleSource={handleToggleSource}
                onClearTaxonomySelection={handleClearTaxonomySelection}
                onAddModeGroupToPack={handleAddModeGroupToPack}
                onAddPrefixToPack={handleAddPrefixToPack}
                onAddSubprefixToPack={handleAddSubprefixToPack}
                onOpenPrefixStudio={(draft) =>
                  setPrefixStudioState({ open: true, draftPrefix: draft ?? null })
                }
                statusFilter={statusFilter}
                onChangeStatusFilter={setStatusFilter}
                extraFilters={extraFilters}
                onChangeExtraFilters={setExtraFilters}
                onOpenCaseTools={() => setLibraryToolsState({ open: true, tab: 'case' })}
              />
            )}

            <MapBrowserPanel
              totalFiltered={totalFiltered}
              queryDurationMs={queryDurationMs}
              getItemAt={getItemAt}
              onEnsureRange={handleEnsureRange}
              activeMapId={activeMapId}
              activeIndex={activeIndex}
              onSelectMapAt={handleSelectMapAt}
              packMapIds={packMapIds}
              onToggleMapInPack={handleToggleMapInPack}
              onRangeAddMapsToPack={handleRangeAddMapsToPack}
              onAddAllFilteredToPack={handleAddAllFilteredToPack}
              onRemoveFilteredFromPack={handleRemoveFilteredFromPack}
              onOpenBatchScreenshot={() => setScreenshotModalState({ open: true, batch: true })}
              searchQuery={searchQuery}
              onChangeSearchQuery={setSearchQuery}
              sortField={sortField}
              onChangeSortField={setSortField}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              resetScrollToken={resetScrollToken}
              listError={listError}
              onRetryList={() => setMetaRevision((r) => r + 1)}
              onToggleFavorite={handleToggleFavorite}
            />
          </>
        )}

        <ErrorBoundary key="main-map-viewport" fallbackTitle={t('WebGL2 map view rendering error')}>
          <MapViewport
            mapEntry={
              editor.isOpen
                ? null
                : livePreviewMap && livePreviewMap.forMapId === activeMapId
                ? activeMapDetails
                : viewportEntry
            }
            mapKey={
              editor.isOpen && editor.snapshot
                ? `editor:${editor.snapshot.draftId}`
                : livePreviewMap && livePreviewMap.forMapId === activeMapId
                ? activeMapId
                : loadedMap?.id ?? null
            }
            mapData={
              editor.isOpen && editor.snapshot
                ? editor.snapshot.map
                : livePreviewMap && livePreviewMap.forMapId === activeMapId
                ? livePreviewMap.data
                : loadedMap?.data ?? null
            }
            actionsEnabled={
              editor.isOpen ? Boolean(editor.snapshot?.map) : Boolean(activeMapData && activeMapDetails)
            }
            loading={!editor.isOpen && loadingMap}
            error={!editor.isOpen ? mapLoadError : null}
            layers={layers}
            onChangeLayers={setLayers}
            onOpenFullSizeModal={() => setScreenshotModalState({ open: true, batch: false })}
            onOpenWorkshopModal={(tab) =>
              setWorkshopModalState({ open: true, tab: tab ?? 'fix' })
            }
            previewModeBanner={
              !editor.isOpen && livePreviewMap && livePreviewMap.forMapId === activeMapId
                ? livePreviewMap.banner
                : null
            }
            previewLayerQuality={
              !editor.isOpen && livePreviewMap && livePreviewMap.forMapId === activeMapId
                ? livePreviewMap.layerQuality ?? null
                : null
            }
            onClearPreviewMode={() => setLivePreviewMap(null)}
            compare={
              !editor.isOpen && compareTarget && compareTarget.forMapId === activeMapId
                ? compareTarget
                : null
            }
            mainLabel={previewActive ? t('preview of changes') : activeMapDetails?.baseName}
            compareCandidates={compareCandidates}
            onStartCompare={handleStartCompare}
            onCompareWithOriginal={handleCompareWithOriginal}
            onStopCompare={() => setCompareTarget(null)}
            editorBridge={editor.viewportBridge}
            onEditCurrentMap={handleEditCurrentMap}
          />
        </ErrorBoundary>

        {editor.isOpen && editor.snapshot ? (
          <div className={editor.panelsHidden ? 'hidden' : 'contents'}>
          <Suspense fallback={null}>
          <EditorRightDock
            activeTab={editor.rightTab}
            onChangeTab={editor.setRightTab}
            snapshot={editor.snapshot}
            activeTool={editor.activeTool}
            selectionSummary={editor.selectionSummary}
            brush={editor.brush}
            onChangeBrush={editor.setBrush}
            placement={editor.placement}
            onChangePlacement={editor.setPlacement}
            assetCatalog={editor.assetCatalog}
            texDims={editor.texDims}
            sceneryPreviewDims={editor.sceneryPreviewDims}
            preferClassicBmp={layers.preferClassicBmp}
            validationIssues={editorValidationIssues}
            getViewCenter={editor.getViewCenter}
            weldSharedVertices={editor.snap.weldSharedVertices}
            validationPending={deferredValidation.pending}
            validationHintsEnabled={validationHints}
            onToggleValidationHints={setValidationHints}
            onFixValidationIssue={(issue) => issue.fix && editor.applyValidationFix(issue.fix)}
            playtest={editor.playtest}
            playtestTeam={editor.playtestTeam}
            onChangePlaytestTeam={(tm) => {
              editor.setPlaytestTeam(tm);
              if (editor.playtest?.active) {
                editor.spawnPlaytestSoldier(
                  editor.playtest.x,
                  editor.playtest.y,
                  tm,
                  editor.playtestCarryingFlag
                );
              }
            }}
            playtestCarryingFlag={editor.playtestCarryingFlag}
            onChangePlaytestCarryingFlag={(cf) => {
              editor.setPlaytestCarryingFlag(cf);
              if (editor.playtest?.active) {
                editor.spawnPlaytestSoldier(
                  editor.playtest.x,
                  editor.playtest.y,
                  editor.playtestTeam,
                  cf
                );
              }
            }}
            onRespawnPlaytest={() => editor.spawnPlaytestSoldier()}
            onOpenImageTrace={() => editor.setImageTraceModalOpen(true)}
            onApplySurfaceCrust={editor.applySurfaceCrust}
            onApplyReliefShading={editor.applyReliefShading}
            onSubdividePolygons={editor.handleSubdividePolygons}
            onGenerateProceduralIsland={editor.handleGenerateProceduralIsland}
            onCommitMutation={editor.commitMutation}
            onUpdateSelection={editor.updateSelection}
            onPropDrawOrder={editor.handlePropDrawOrder}
            onPolygonDrawOrder={editor.handlePolygonDrawOrder}
            onResetPolygonUv={editor.resetSelectedPolygonsUvWorldAligned}
            onFlipPolygonWinding={editor.flipSelectedPolygonsWinding}
            onUpdateHeader={editor.updateHeader}
            onJumpToHistory={editor.jumpToHistory}
            onFocusBounds={editor.focusWorldRect}
            onSetValidationFocus={editor.setValidationFocus}
          />
          </Suspense>
          </div>
        ) : (
          panels.inspector && (
            <MapInspectorDrawer
              map={activeMapDetails}
              loadingDetails={loadingDetails}
              detailsError={detailsError}
              inPack={activeMapId ? packMapIds.has(activeMapId) : false}
              onTogglePack={() => activeMapId && handleToggleMapInPack(activeMapId)}
              onSelectMapById={selectMapById}
              onOpenWorkshop={(tab) => setWorkshopModalState({ open: true, tab })}
              onEditMap={handleEditCurrentMap}
              onUpdateUserData={handleUpdateUserData}
              knownTags={knownTags}
            />
          )
        )}
      </div>

      {editor.isOpen && (
        <Suspense fallback={null}>
          <EditorToasts toasts={editor.toasts} onDismiss={editor.dismissToast} />
          <EditorShortcutsModal open={editor.shortcutsOpen} onClose={() => editor.setShortcutsOpen(false)} />
        </Suspense>
      )}

      {/* Editor Status Bar */}
      {editor.isOpen && editor.snapshot && (
        <Suspense fallback={<div className="h-7 shrink-0 bg-zinc-950 border-t border-zinc-800/90" />}>
        <EditorStatusBar
          map={editor.snapshot.map}
          activeTool={editor.activeTool}
          cursorWorld={editor.cursorWorld}
          zoom={editor.zoom}
          selectionSummary={editor.selectionSummary}
          isDirty={editor.isDirty}
        />
        </Suspense>
      )}

      {/* Modals */}
      <ErrorBoundary overlay fallbackTitle={t('Could not load the application window (e.g. after an update) — refresh the page')}>
      <Suspense fallback={null}>
      {workshopMounted && (
      <MapWorkshopModal
        open={workshopModalState.open}
        initialTab={workshopModalState.tab}
        onClose={() => setWorkshopModalState((s) => ({ ...s, open: false }))}
        currentMapEntry={activeMapDetails}
        currentMapData={activeMapData}
        preferClassicBmp={layers.preferClassicBmp}
        batchCount={packMapIds.size > 0 ? packMapIds.size : totalFiltered}
        batchSourceLabel={packMapIds.size > 0 ? t('from the pack selection') : t('from the current filter')}
        onResolveBatchCandidates={handleResolveBatchCandidates}
        onApplyLivePreviewMap={(previewData, bannerText, layerQuality) => {
          if (activeMapId) {
            setLivePreviewMap({
              forMapId: activeMapId,
              data: previewData,
              banner: bannerText,
              layerQuality,
            });
          }
        }}
        onMetaUpdated={applyMetaUpdate}
        onSelectMapById={selectMapById}
      />
      )}

      {prefixStudioMounted && (
      <PrefixStudioModal
        open={prefixStudioState.open}
        onClose={() => setPrefixStudioState({ open: false, draftPrefix: null })}
        customRules={meta?.customRules ?? []}
        discoveredSubprefixes={meta?.discoveredSubprefixes ?? []}
        initialDraftPrefix={prefixStudioState.draftPrefix}
        onSaveRules={handleSaveCustomRules}
      />
      )}

      {packModalMounted && (
      <PackBuilderModal
        open={packModalOpen}
        onClose={() => setPackModalOpen(false)}
        packMapIds={packListArray}
        getMapLabelById={getMapLabelById}
        onRemoveMapFromPack={handleToggleMapInPack}
        onClearPack={() => setPackMapIds(new Set())}
        onMetaUpdated={applyMetaUpdate}
      />
      )}

      {screenshotMounted && (
      <ScreenshotModal
        open={screenshotModalState.open}
        initialBatchMode={screenshotModalState.batch}
        onClose={() => setScreenshotModalState((s) => ({ ...s, open: false }))}
        currentMapEntry={activeMapDetails}
        currentMapData={editor.isOpen && editor.snapshot ? editor.snapshot.map : activeMapData}
        currentLayers={layers}
        batchCount={packMapIds.size > 0 ? packMapIds.size : totalFiltered}
        batchSourceLabel={packMapIds.size > 0 ? t('from the pack selection') : t('from the current filter')}
        onResolveBatchCandidates={handleResolveBatchCandidates}
      />
      )}

      {settingsMounted && (
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        soldatPath={meta?.soldatPath ?? ''}
        extraSources={meta?.extraSources ?? []}
        onSaveConfig={handleSaveConfig}
      />
      )}

      {libraryToolsMounted && (
      <LibraryToolsModal
        open={libraryToolsState.open}
        initialTab={libraryToolsState.tab}
        onClose={() => setLibraryToolsState((st) => ({ ...st, open: false }))}
        onMetaUpdated={applyMetaUpdate}
      />
      )}
      </Suspense>

      <Suspense fallback={null}>
      {editor.newMapModalOpen && (
      <EditorNewMapModal
        open={editor.newMapModalOpen}
        onClose={() => editor.setNewMapModalOpen(false)}
        availableTextures={(editor.assetCatalog?.textures ?? []).map((tx) => tx.name)}
        hasUnsavedChanges={editor.isOpen && editor.isDirty}
        onCreateMap={({ map, initialBaseName }) => {
          // The user confirmed in the dialog: close the old document (its draft goes too) before the new one
          if (editor.isOpen) editor.closeEditor(true);
          editor.openMapInEditor({
            map,
            initialBaseName,
          });
        }}
      />
      )}

      {editor.snapshot && (
        <EditorSaveModal
          open={editor.saveModalOpen}
          onClose={() => editor.setSaveModalOpen(false)}
          snapshot={editor.snapshot}
          onSave={editor.saveMapToDisk}
        />
      )}

      {editor.snapshot && (
        <EditorSymmetryModal
          open={editor.symmetryModalOpen}
          onClose={() => editor.setSymmetryModalOpen(false)}
          snapshot={editor.snapshot}
          selectionSummary={editor.selectionSummary}
          onSetPreviewAxisX={editor.setSymmetryAxisX}
          onApplyMirror={(label, nextMap, nextSel) =>
            editor.commitMutation(label, nextMap, nextSel)
          }
        />
      )}

      {editor.snapshot && (
        <EditorImageTraceModal
          open={editor.imageTraceModalOpen}
          onClose={() => editor.setImageTraceModalOpen(false)}
          map={editor.snapshot.map}
          assetCatalog={editor.assetCatalog}
          preferClassicBmp={layers.preferClassicBmp}
          texDims={editor.texDims}
          defaultPolyType={editor.placement.polyType}
          defaultColor={editor.placement.polyColor}
          onInsertPolygons={editor.insertGeneratedPolygons}
          getViewCenter={editor.getViewCenter}
          onPinBlueprint={editor.setBlueprint}
        />
      )}

      {editor.isOpen && (
      <EditorCommandPalette
        open={editor.commandPaletteOpen}
        onClose={() => editor.setCommandPaletteOpen(false)}
        layers={layers}
        onChangeLayers={setLayers}
        snap={editor.snap}
        onChangeSnap={editor.setSnap}
        onSelectTool={editor.setActiveTool}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onDuplicate={editor.handleDuplicateSelection}
        onDelete={editor.handleDeleteSelection}
        onSelectAll={editor.handleSelectAll}
        onWorldAlignUvs={editor.resetSelectedPolygonsUvWorldAligned}
        onFlipWinding={editor.flipSelectedPolygonsWinding}
        onOpenSymmetry={() => editor.setSymmetryModalOpen(true)}
        onOpenImageTrace={() => editor.setImageTraceModalOpen(true)}
        onApplyGrassCrust={() =>
          editor.applySurfaceCrust({
            thickness: 10,
            topColor: { r: 92, g: 196, b: 84, a: 255 },
            bottomColor: { r: 44, g: 98, b: 46, a: 255 },
            polyType: 0,
          })
        }
        onApplyReliefShading={() =>
          editor.applyReliefShading({ lightAngleDeg: -55, contrast: 0.38 })
        }
        onSubdividePolygons={editor.handleSubdividePolygons}
        onGenerateIsland={() =>
          editor.handleGenerateProceduralIsland({
            width: 220,
            height: 120,
            segments: 14,
            roughness: 0.35,
            seed: Math.floor(Math.random() * 99999),
            flatTop: true,
            addGrassCrust: true,
          })
        }
        onOpenSave={() => editor.setSaveModalOpen(true)}
        onOpenNewMap={() => editor.setNewMapModalOpen(true)}
        onSelectRightTab={editor.setRightTab}
        extraActions={[
          { id: 'sel_similar', label: t('Select similar objects'), category: t('Edit'), shortcut: 'Ctrl+Shift+A', run: editor.selectSimilar },
          { id: 'sel_invert', label: t('Invert selection'), category: t('Edit'), shortcut: 'Ctrl+I', run: editor.invertSelection },
          { id: 'view_frame_sel', label: t('Zoom to the selection'), category: t('View'), shortcut: 'Shift+F', run: editor.frameSelection },
          { id: 'view_frame_map', label: t('Zoom to the whole map'), category: t('View'), shortcut: 'Home', run: editor.frameMap },
          { id: 'view_panels', label: t('Hide / show the side panels'), category: t('View'), shortcut: 'Tab', run: () => editor.setPanelsHidden((v) => !v) },
          { id: 'help_shortcuts', label: t('Keyboard shortcuts'), category: t('Help'), shortcut: '?', run: () => editor.setShortcutsOpen(true) },
          { id: 'order_poly_front', label: t('Polygons to the front'), category: t('Edit'), shortcut: 'Shift+PgUp', run: () => editor.handlePolygonDrawOrder('front') },
          { id: 'order_poly_back', label: t('Polygons to the back'), category: t('Edit'), shortcut: 'Shift+PgDn', run: () => editor.handlePolygonDrawOrder('back') },
          { id: 'act_quick_save', label: t('Save again (same file)'), category: t('File'), shortcut: 'Ctrl+S', run: () => void editor.quickSave() },
        ]}
      />
      )}
      </Suspense>
      </ErrorBoundary>
    </div>
  );
};
