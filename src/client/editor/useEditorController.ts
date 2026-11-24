import type { MapValidationIssue } from '@shared/mapValidator';
import { uint8ToBase64 } from '../utils/binary';
export { uint8ToBase64 };
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EditorAssetCatalogResponse,
  EditorPrefabItem,
  EditorSaveDestination,
  EditorSaveResponse,
  IndexMetaResponse,
} from '@shared/apiTypes';
import { useToolKeys } from './shortcutBindings';
import { sealPolyJunction } from '@shared/polyJunctions';
import { laserStroke } from './polygonDrawing';
import { createPolygonGestures, isPolygonDrag, type PolygonDrag } from './polygonGestures';
import { createTunnelMap, type TunnelPoint } from '@shared/climbTunnel';
import { createTunnelProject, tunnelSectionGates, tunnelGateAt, tunnelTrialRoute } from '@shared/tunnelProject';
import { useTunnelWorkspace } from './useTunnelWorkspace';
import type { TunnelTrialResult } from './tunnelTrial';
import { downloadProjectFile } from './projectFile';
import { appendTunnel, sketchExample, TunnelStroke } from './tunnelBlueprint';
import {
  computeWorldAlignedUv,
  ensureSceneryEntry,
  prepareMapForSave,
  splitPolygonEdge,
} from '@shared/pmsCompiler';
import {
  computePropCorners,
  PmsBounds,
  PmsMapData,
  SOLDAT_MAP_LIMITS,
  PmsPolygon,
  PmsProp,
  PmsVertex,
  serializePms,
} from '@shared/pmsParser';
import { RgbaColor } from '@shared/soldatConstants';
import {
  applyDirectionalReliefShading,
  generateProceduralIsland,
  generateSurfaceCrust,
  subdividePolygons,
} from '@shared/terrainGenerator';
import { t, tp } from '../i18n';
import type { EditorToast } from './components/EditorToasts';
import { loadSoldatAssetImage } from '../renderer/assetLoader';
import { isAnyModalOpen } from '../utils/useModalDismiss';
import { RenderLayerVisibility } from '../renderer/types';
import {
  cloneSelection,
  computeSelectionSummary,
  countSelectedObjects,
  deleteSelection,
  duplicateSelection,
  EditorDocument,
  EditorDocumentSnapshot,
  emptySelection,
  extractSelectionBundle,
  insertElementBundle,
  invertSelection,
  isSelectionEmpty,
  makePolygonsClockwise,
  repairPolygonNormals,
  reorderSelectedPolygons,
  SelectableFilter,
  selectSimilarObjects,
  PropDrawOrderDirection,
  reorderSelectedProps,
  rotateSelection,
  scaleSelection,
  computePropQuadCenter,
  stretchSinglePropLocal,
  toggleWaypointConnection,
  translateSelection,
  updateMapHeader,
} from './EditorDocument';
import { DraftAutosave } from './draftAutosave';
import { mapAssetOriginId, mapAssetSource } from '../renderer/mapAssetSource';
import { hitTestTransformGizmo, renderEditorOverlay } from './EditorOverlayPainter';
import { replacePropsScenery, rotatePropsInPlace, scaleProps } from './sceneryOps';
import {
  createSoldierPlaytestState,
  SoldierPlaytestInput,
  SoldierPlaytestState,
  stepSoldierPlaytest,
} from './soldierPlaytest';
import { EditorSpatialIndex, isPropVisibleAndUnlocked, isSpawnVisibleAndUnlocked, mergeSelections } from './spatialIndex';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_EDITOR_LOCKS,
  DEFAULT_EDITOR_SNAP,
  DEFAULT_PLACEMENT_SETTINGS,
  EditorBlueprintOverlay,
  EditorBrushSettings,
  EditorLayerLocks,
  EditorPlacementDefaults,
  EditorSelection,
  EditorSnapSettings,
  EditorToolId,
  GizmoHandleKind,
  LeftDockTab,
  RightDockTab,
  SelectionFilterMode,
  SmartGuideLine,
  SnapIndicator,
} from './types';

export interface ViewportEditorBridge {
  active: boolean;
  overlayRevision: number;
  cursorStyle?: string;
  wantsNativeRuler: () => boolean;
  onPointerDown: (info: {
    worldX: number;
    worldY: number;
    clientX: number;
    clientY: number;
    button: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    zoom: number;
  }) => boolean;
  onPointerMove: (info: {
    worldX: number;
    worldY: number;
    clientX: number;
    clientY: number;
    buttons: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    zoom: number;
  }) => void;
  onPointerUp: (info: {
    outsideViewport?: boolean;
    cancelled?: boolean;
    worldX: number;
    worldY: number;
    clientX: number;
    clientY: number;
    button: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    zoom: number;
  }) => void;
  onDoubleClick: (info: { worldX: number; worldY: number; zoom: number }) => boolean;
  onWheel?: (info: { deltaY: number; altKey: boolean; shiftKey: boolean }) => boolean;
  onContextMenu: (info: { worldX: number; worldY: number; zoom: number }) => boolean;
  renderOverlay: (
    ctx: CanvasRenderingContext2D,
    vw: number,
    vh: number,
    bounds: { left: number; right: number; top: number; bottom: number }
  ) => void;
  onViewportStatus: (info: {
    cursorWorld: { x: number; y: number } | null;
    zoom: number;
    viewCenter: { x: number; y: number };
    focusBounds: (b: { left: number; right: number; top: number; bottom: number }) => void;
  }) => void;
}

const LASSO_PREVIEW_INTERVAL_MS = 90;

type ActivePointerDrag =
  | { kind: 'tunnel_stroke'; stroke: TunnelStroke }
  | { kind: 'tunnel_knot'; knot: number; start: TunnelPoint; origin: TunnelPoint; zoom: number }
  | {
      kind: 'move';
      txId: string;
      baseMap: PmsMapData;
      selection: EditorSelection;
      startWorldX: number;
      startWorldY: number;
      moved: boolean;
    }
  | {
      kind: 'rotate';
      txId: string;
      baseMap: PmsMapData;
      selection: EditorSelection;
      pivotX: number;
      pivotY: number;
      startAngle: number;
    }
  | {
      kind: 'scale';
      txId: string;
      handle: GizmoHandleKind;
      baseMap: PmsMapData;
      selection: EditorSelection;
      bounds: PmsBounds;
      pivotX: number;
      pivotY: number;
      startWorldX: number;
      startWorldY: number;
    }
  | {
      kind: 'collider_rim';
      txId: string;
      colliderIndex: number;
      baseMap: PmsMapData;
      // Set for a collider placed by this click: resizing starts only after the pointer moves this far (world units)
      armDistance?: number;
      startWorldX?: number;
      startWorldY?: number;
    }
  | {
      // A scenery just stamped by this press: dragging draws its size (proportional, Shift = free stretch)
      kind: 'prop_stamp_size';
      txId: string;
      propIndex: number;
      baseMap: PmsMapData;
      anchorX: number;
      anchorY: number;
      startClientX: number;
      startClientY: number;
    }
  | {
      kind: 'marquee';
      startX: number;
      startY: number;
      mode: 'replace' | 'add' | 'remove';
      baseSelection: EditorSelection;
    }
  | {
      kind: 'lasso';
      points: Array<{ x: number; y: number }>;
      mode: 'replace' | 'add' | 'remove';
      baseSelection: EditorSelection;
      lastEvalAt?: number; // live preview of the lasso selection is throttled; the release computes it exactly
    }
  | {
      kind: 'brush';
      txId: string;
    }
  | {
      kind: 'uv_drag';
      txId: string;
      baseMap: PmsMapData;
      selection: EditorSelection;
      startWorldX: number;
      startWorldY: number;
      altRotate: boolean;
      shiftScale: boolean;
    }
  | PolygonDrag;

const CLIPBOARD_STORAGE_KEY = 'soldat-map-studio.editor.clipboard.v1';

const RECENT_SCENERIES_KEY = 'soldat-map-studio.editor.recentSceneries.v1';

function readRecentSceneries(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_SCENERIES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

/** Last stamped sceneries first (shown as a quick-pick row in the asset browser) */
function rememberRecentScenery(filename: string): string[] {
  const lower = filename.toLowerCase();
  const next = [filename, ...readRecentSceneries().filter((f) => f.toLowerCase() !== lower)].slice(0, 12);
  try {
    window.localStorage.setItem(RECENT_SCENERIES_KEY, JSON.stringify(next));
  } catch {
    // Convenience only
  }
  return next;
}

function confirmWholeMap(action: string): boolean {
  return window.confirm(
    t('Nothing is selected. Apply "{action}" to every polygon of the map? (Undo can revert it.)', { action })
  );
}


export function base64ToUint8(b64: string): Uint8Array {
  const bin = window.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function useEditorController(params: {
  layers: RenderLayerVisibility;
  onChangeLayers: (next: RenderLayerVisibility) => void;
  onMetaUpdated: (meta: IndexMetaResponse) => void;
  onSavedToLibrary?: (newMapId: string) => void;
}) {
  const { layers, onChangeLayers, onMetaUpdated, onSavedToLibrary } = params;

  const docRef = useRef<EditorDocument | null>(null);
  const [snapshot, setSnapshot] = useState<EditorDocumentSnapshot | null>(null);
  const [activeTool, setActiveToolState] = useState<EditorToolId>('select');
  const [locks, setLocks] = useState<EditorLayerLocks>(DEFAULT_EDITOR_LOCKS);
  const [snap, setSnap] = useState<EditorSnapSettings>(DEFAULT_EDITOR_SNAP);
  const [brush, setBrush] = useState<EditorBrushSettings>(DEFAULT_BRUSH_SETTINGS);
  const [placement, setPlacement] = useState<EditorPlacementDefaults>(DEFAULT_PLACEMENT_SETTINGS);
  const [leftTab, setLeftTab] = useState<LeftDockTab>('layers');
  const [rightTab, setRightTab] = useState<RightDockTab>('properties');
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilterMode>('all');
  const [panelsHidden, setPanelsHidden] = useState(false);

  const [assetCatalog, setAssetCatalog] = useState<EditorAssetCatalogResponse | null>(null);
  const [activePrefab, setActivePrefab] = useState<EditorPrefabItem | null>(null);
  const [texDims, setTexDims] = useState<{ w: number; h: number }>({ w: 128, h: 128 });
  const [sceneryPreviewDims, setSceneryPreviewDims] = useState<{ w: number; h: number }>({ w: 64, h: 64 });

  // Ephemeral viewport / overlay state
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const focusBoundsRef = useRef<((b: { left: number; right: number; top: number; bottom: number }) => void) | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<SnapIndicator | null>(null);
  const [smartGuides, setSmartGuides] = useState<SmartGuideLine[]>([]);
  const [marqueeBox, setMarqueeBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }> | null>(null);
  const toolKeys = useToolKeys();
  const [laserPoints, setLaserPoints] = useState<Array<{ x: number; y: number }> | null>(null);
  const [laserPreviewPoints, setLaserPreviewPoints] = useState<Array<{ x: number; y: number }> | null>(null);
  const isOpen = snapshot !== null;
  const tunnelWorkspace = useTunnelWorkspace(docRef,snapshot,setSnapshot,activeTool==='climb_tunnel',rightTab==='properties');
  const {settings:tunnelSettings,setSettings:setTunnelSettings,method:tunnelMethod,setMethod:setTunnelMethod,
    path:tunnelPath,setPath:setTunnelPath,draft:tunnelDraft,open:openTunnel,project:activeTunnel,
    selectKnot,setSection,knotIndex,point:sectionPoint,modified:sectionModified,hasPreview:sectionHasPreview,
    comparing:comparingSections,planning:planningPace,variant:sectionVariant,comparisonStop,cancel:cancelSection} = tunnelWorkspace;
  const laserPreviewAtRef = useRef(0);
  const [draftPoints, setDraftPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [symmetryAxisX, setSymmetryAxisX] = useState<number | null>(null);
  const [validationFocus, setValidationFocus] = useState<{ x: number; y: number; radius?: number } | null>(null);
  const [blueprint, setBlueprint] = useState<EditorBlueprintOverlay | null>(null);
  const [playtest, setPlaytest] = useState<SoldierPlaytestState | null>(null);
  const [playtestTeam, setPlaytestTeam] = useState<1 | 2 | 3 | 4>(1);
  const [playtestCarryingFlag, setPlaytestCarryingFlag] = useState(false);
  const [overlayTick, setOverlayTick] = useState(0);

  // Modals
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [newMapModalOpen, setNewMapModalOpen] = useState(false);
  const [symmetryModalOpen, setSymmetryModalOpen] = useState(false);
  const [imageTraceModalOpen, setImageTraceModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const spaceHeldRef = useRef(false);
  const playtestInputRef = useRef<SoldierPlaytestInput>({
    left: false,
    right: false,
    jump: false,
    crouch: false,
    jetpack: false,
  });
  const activeDragRef = useRef<ActivePointerDrag | null>(null);
  useEffect(() => {
    if (activeTool !== 'poly_shape') return;
    if (activeDragRef.current?.kind === 'shape_drag') activeDragRef.current = null;
    setDraftPoints([]);
  }, [activeTool, placement.polyShapeMode]);
  const viewCenterRef = useRef<{ x: number; y: number } | null>(null);
  // Centre of the visible part of the map: where generated or pasted content goes when the cursor is not on it
  const getViewCenter = useCallback(() => viewCenterRef.current, []);
  const savingRef = useRef(false);
  const [draftAutosave] = useState(() => new DraftAutosave());
  // Where the last successful save went: Ctrl+S then saves there again without the dialog
  const lastSaveTargetRef = useRef<{
    baseName: string;
    destination: EditorSaveDestination;
    customOutputFolder?: string;
  } | null>(null);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<number | null>(null);
  const [toasts, setToasts] = useState<EditorToast[]>([]);
  const [recentSceneries, setRecentSceneries] = useState<string[]>(() => readRecentSceneries());
  const toastIdRef = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (kind: EditorToast['kind'], message: string) => {
      const id = ++toastIdRef.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 3200);
    },
    [dismissToast]
  );
  const lastClickPickRef = useRef<{ x: number; y: number; cycle: number } | null>(null);

  const map = snapshot?.map ?? null;
  const assetSource = map ? mapAssetSource(map) : undefined;

  // Rebuild spatial index whenever map polygons or props change
  const spatialIndex = useMemo(() => (map ? new EditorSpatialIndex(map) : null), [map]);

  const selectionSummary = useMemo(
    () =>
      map && snapshot
        ? computeSelectionSummary(map, snapshot.selection)
        : { totalObjects: 0, vertexCount: 0, bounds: null },
    [map, snapshot]
  );

  // Track main texture pixel dimensions for accurate world-aligned UV generation
  useEffect(() => {
    const tex = map?.texture || 'default.bmp';
    if (!map) return;
    let cancelled = false;
    setTexDims({ w: 128, h: 128 });
    void loadSoldatAssetImage('textures', tex, false, layers.preferClassicBmp, false, assetSource).then((img) => {
      if (!cancelled && img && img.width > 0 && img.height > 0) {
        setTexDims({ w: img.width, h: img.height });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [map?.texture, Boolean(map), layers.preferClassicBmp, assetSource?.key, assetSource?.mapId]);

  // Track active placement scenery dimensions for accurate prop placement & ghost preview
  useEffect(() => {
    if (!placement.sceneryFilename) return;
    let cancelled = false;
    setSceneryPreviewDims({ w: 64, h: 64 });
    void loadSoldatAssetImage('scenery-gfx', placement.sceneryFilename, true, layers.preferClassicBmp, false, assetSource).then((img) => {
      if (!cancelled && img && img.width > 0 && img.height > 0) {
        setSceneryPreviewDims({ w: img.width, h: img.height });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [placement.sceneryFilename, layers.preferClassicBmp, assetSource?.key, assetSource?.mapId]);

  // Load editor asset catalog when entering editor mode
  const refreshAssetCatalog = useCallback(async () => {
    try {
      const doc = docRef.current;
      if (!doc) return;
      const source = mapAssetSource(doc.getSnapshot().map);
      const res = await fetch('/api/editor/assets' + (source ? '?mapId=' + encodeURIComponent(source.mapId) : ''));
      if (!res.ok) return;
      const data = (await res.json()) as EditorAssetCatalogResponse;
      if (docRef.current !== doc) return;
      setAssetCatalog(data);
      setPlacement((prev) => {
        if (prev.sceneryFilename || data.sceneries.length === 0) return prev;
        return { ...prev, sceneryFilename: data.sceneries[0].name };
      });
    } catch {
      // Ignore offline/network error
    }
  }, []);

  const openMapInEditor = useCallback(
    (opts: {
      map: PmsMapData;
      sourceMapId?: string | null;
      sourceBaseName?: string | null;
      initialBaseName?: string;
      draftId?: string;
      startDirty?: boolean;
      projectFile?: boolean;
      fullRun?: TunnelTrialResult;
    }) => {
      const previous = docRef.current;
      if (previous) void draftAutosave.clearIfClean(previous.getSnapshot());
      const doc = new EditorDocument(opts);
      docRef.current = doc;
      setAssetCatalog(null);
      openTunnel(opts.map,opts.fullRun);
      setActiveToolState(opts.map.editorTunnels?.length || opts.map.editorSketch ? 'climb_tunnel' : 'select');
      if (opts.map.editorTunnels?.length || opts.map.editorSketch) {
        setRightTab('properties');
        setPanelsHidden(false);
      }
      activeDragRef.current = null;
      // Recovered drafts are already on disk. Newly generated maps need a first autosave.
      if (opts.startDirty && opts.draftId) draftAutosave.rememberRecovered(opts.draftId, opts.map);
      setLastAutosaveAt(null);
      lastSaveTargetRef.current = null;
      setSnapshot(doc.getSnapshot());
      setDraftPoints([]);
      setLaserPoints(null);
      setLaserPreviewPoints(null);
      setActivePrefab(null);
      setValidationFocus(null);
      setPlaytest(null);
      // Enable key tactical entity layers on entry so spawns, flags, colliders & waypoints are visible
      onChangeLayers({
        ...layers,
        showFlags: true,
        showSpawns: true,
        showBonuses: true,
        showColliders: true,
      });
      void refreshAssetCatalog();
    },
    [layers, onChangeLayers, refreshAssetCatalog, draftAutosave, openTunnel]
  );

  const closeEditor = useCallback((force = false): boolean => {
    const doc = docRef.current;
    if (!force && (doc?.isDirty() || sectionModified)) {
      return false; // Caller shows confirmation
    }
    if (doc) void draftAutosave.clear(doc.getSnapshot().draftId);
    docRef.current = null;
    setSnapshot(null);
    setDraftPoints([]);
    setLaserPoints(null);
    setLaserPreviewPoints(null);
    setPlaytest(null);
    setBlueprint(null);
    setActivePrefab(null);
    setValidationFocus(null);
    return true;
  }, [draftAutosave,sectionModified]);

  const spawnPlaytestSoldier = useCallback(
    (customX?: number, customY?: number, teamOverride?: 1 | 2 | 3 | 4, flagOverride?: boolean) => {
      const doc = docRef.current;
      if (!doc) return;
      const curMap = doc.getSnapshot().map;
      const team = teamOverride ?? playtestTeam;
      const carryingFlag = flagOverride ?? playtestCarryingFlag;
      let sx = customX;
      let sy = customY;
      if (sx === undefined || sy === undefined) {
        const sp =
          curMap.spawnpoints.find((s) => s.active && s.team === team) ||
          curMap.spawnpoints.find((s) => s.active && s.team === 0) ||
          curMap.spawnpoints.find((s) => s.active && s.team <= 4);
        if (sp) {
          sx = sp.x;
          sy = sp.y;
        } else {
          sx = (curMap.polyBounds.left + curMap.polyBounds.right) * 0.5;
          sy = curMap.polyBounds.top - 24;
        }
      }
      setPlaytest(createSoldierPlaytestState(sx, sy, curMap, { team, carryingFlag }));
    },
    [playtestTeam, playtestCarryingFlag]
  );

  const setActiveTool = useCallback(
    (tool: EditorToolId) => {
      setActiveToolState(tool);
      if (tool==='climb_tunnel' || tool==='poly_shape') {
        setRightTab('properties');
        setPanelsHidden(false);
      }
      activeDragRef.current=null;
      setMarqueeBox(null);
      setLassoPoints(null);
      setDraftPoints([]);
      setLaserPoints(null);
      setLaserPreviewPoints(null);
      if (tool !== 'scenery') setActivePrefab(null);
      if (tool === 'playtest') {
        spawnPlaytestSoldier();
      } else {
        setPlaytest(null);
        playtestInputRef.current = {
          left: false,
          right: false,
          jump: false,
          crouch: false,
          jetpack: false,
        };
      }
      // Auto-show matching layer when choosing a placement tool so placed items are immediately visible
      if (tool === 'spawn' && (!layers.showSpawns || !layers.showFlags || !layers.showBonuses)) {
        onChangeLayers({ ...layers, showSpawns: true, showFlags: true, showBonuses: true });
      } else if (tool === 'collider' && !layers.showColliders) {
        onChangeLayers({ ...layers, showColliders: true });
      } else if (tool === 'waypoint' && !layers.showWaypoints) {
        onChangeLayers({ ...layers, showWaypoints: true });
      }
      setOverlayTick((n) => n + 1);
    },
    [layers, onChangeLayers, spawnPlaytestSoldier]
  );

  // Live 60 Hz Soldier Physics & Jetpack Playtest loop
  useEffect(() => {
    if (!isOpen || activeTool !== 'playtest' || !playtest?.active || !map || !spatialIndex) return;
    let rafId = 0;
    let lastTime = performance.now();
    let accum = 0;
    const FIXED_DT = 1 / 60;

    const tick = (now: number) => {
      const elapsed = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      accum += elapsed;
      // Steps are counted here, not inside the state updater: React may run an updater twice (StrictMode)
      let steps = 0;
      while (accum >= FIXED_DT && steps < 4) {
        accum -= FIXED_DT;
        steps++;
      }
      if (accum > FIXED_DT) accum = 0; // after a stall, drop the backlog instead of fast-forwarding
      if (steps > 0) {
        const input = { ...playtestInputRef.current };
        setPlaytest((prev) => {
          if (!prev || !prev.active) return prev;
          let cur = prev;
          for (let i = 0; i < steps; i++) {
            cur = stepSoldierPlaytest(cur, input, map, spatialIndex, FIXED_DT);
            // Auto-respawn if fallen far below the map or killed by deadly/lava polygon
            if (cur.y > map.polyBounds.bottom + 900 || cur.hazardState === 'deadly') {
              cur = createSoldierPlaytestState(cur.spawnX, cur.spawnY, map, {
                team: cur.team,
                carryingFlag: cur.carryingFlag,
              });
            }
          }
          return cur;
        });
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isOpen, activeTool, Boolean(playtest?.active), map, spatialIndex]);

  // Warn before closing browser tab with unsaved changes
  useEffect(() => {
    if (!isOpen) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (docRef.current?.isDirty() || sectionModified) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isOpen, sectionModified]);

  // Returning to the saved revision invalidates the previous recovery file immediately.
  useEffect(() => {
    if (!snapshot) return;
    void draftAutosave.clearIfClean(snapshot);
    if (snapshot.map === snapshot.savedMap) setLastAutosaveAt(null);
  }, [snapshot?.draftId, snapshot?.map, snapshot?.savedMap, draftAutosave]);

  // Periodic background draft autosave to data/editor-drafts/ (never into Soldat maps/)
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => {
      const doc = docRef.current;
      if (!doc || savingRef.current) return;
      const snapState = doc.getSnapshot();
      if (!doc.isDirty()) {
        void draftAutosave.clear(snapState.draftId);
        return;
      }
      const geometryDirty = doc.isGeometryDirty(), sceneryDirty = doc.isSceneryDirty();
      void draftAutosave.save(snapState.draftId, snapState.map, async () => {
        const prepared = prepareMapForSave(snapState.map, {
          geometryDirty, sceneryDirty,
        });
        const pmsBase64 = uint8ToBase64(serializePms(prepared));
        const response = await fetch(`/api/editor/drafts/${encodeURIComponent(snapState.draftId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceMapId: snapState.sourceMapId,
            assetMapId: mapAssetOriginId(snapState.map),
            baseName: snapState.currentBaseName,
            pmsBase64,
            tunnels: snapState.map.editorTunnels,
            sketch: snapState.map.editorSketch,
            projectFile: snapState.projectFile,
          }),
        });
        if (!response.ok) throw new Error('Draft autosave failed');
        if (docRef.current === doc && doc.getSnapshot().map === snapState.map) setLastAutosaveAt(Date.now());
      });
    }, 20000);
    return () => window.clearInterval(timer);
  }, [isOpen, draftAutosave]);

  const commitMutation = useCallback(
    (label: string, nextMap: PmsMapData, nextSelection?: EditorSelection, transactionId?: string) => {
      const doc = docRef.current;
      if (!doc) return;
      setSnapshot(doc.commit({ label, nextMap, nextSelection, transactionId }));
    },
    []
  );

  const updateSelection = useCallback((nextSelection: EditorSelection) => {
    const doc = docRef.current;
    if (!doc) return;
    setSnapshot(doc.setSelection(nextSelection));
  }, []);

  const removeUnusedScenery = useCallback(() => {
    const doc=docRef.current;
    if(!doc)return;
    try {
      const {snapshot:next,removedCount}=doc.removeUnusedScenery();
      if(!removedCount){notify('info',t('Every scenery entry is in use.'));return;}
      setSnapshot(next);
      notify('success',t('Unused scenery entries removed: {n}. Undo with Ctrl+Z.',{n:removedCount}));
    } catch {
      notify('error',t('A placed scenery refers to an invalid image number. Repair its image assignment first.'));
    }
  },[notify]);

  const undo = useCallback(() => {
    const doc = docRef.current;
    if (sectionHasPreview) { cancelSection(); return; }
    if (!doc || !doc.canUndo()) return;
    cancelSection();
    setSnapshot(doc.undo());
  }, [sectionHasPreview,cancelSection]);

  const redo = useCallback(() => {
    const doc = docRef.current;
    if (sectionHasPreview || !doc || !doc.canRedo()) return;
    cancelSection();
    setSnapshot(doc.redo());
  }, [sectionHasPreview,cancelSection]);

  const jumpToHistory = useCallback((depth: number) => {
    const doc = docRef.current;
    if (!doc) return;
    cancelSection();
    setSnapshot(doc.jumpToHistoryDepth(depth));
  }, [cancelSection]);

  const handleDeleteSelection = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    if (isSelectionEmpty(st.selection)) return;
    const nextMap = deleteSelection(st.map, st.selection);
    setSnapshot(
      doc.commit({
        label: 'Delete selection',
        nextMap,
        nextSelection: emptySelection(),
      })
    );
  }, []);

  const handleDuplicateSelection = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    const res = duplicateSelection(st.map, st.selection, snap.gridSize || 16, snap.gridSize || 16);
    if (!res) return;
    setSnapshot(
      doc.commit({
        label: 'Duplicate selection',
        nextMap: res.nextMap,
        nextSelection: res.nextSelection,
      })
    );
  }, [snap.gridSize]);

  const handleCopySelection = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return false;
    const st = doc.getSnapshot();
    const extracted = extractSelectionBundle(st.map, st.selection);
    if (!extracted) return false;
    const json = JSON.stringify({ kind: 'soldat-map-studio-clipboard-v1', ...extracted });
    try {
      window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, json);
    } catch {
      // Ignore
    }
    void navigator.clipboard?.writeText?.(json).catch(() => {});
    notify('info', tp(countSelectedObjects(st.selection), 'Copied {count} object', 'Copied {count} objects'));
    return true;
  }, [notify]);

  const handlePasteClipboard = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return false;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.kind !== 'soldat-map-studio-clipboard-v1' || !parsed.bundle || !parsed.bounds) {
        return false;
      }
      const st = doc.getSnapshot();
      // At the cursor when it is on the map, otherwise in the middle of the view (e.g. pasting from another map)
      const view = viewCenterRef.current;
      const targetX = cursorWorld?.x ?? view?.x ?? (parsed.bounds.left + parsed.bounds.right) * 0.5 + 24;
      const targetY = cursorWorld?.y ?? view?.y ?? (parsed.bounds.top + parsed.bounds.bottom) * 0.5 + 24;
      const { nextMap, nextSelection } = insertElementBundle(
        st.map,
        parsed.bundle,
        parsed.bounds,
        targetX,
        targetY
      );
      setSnapshot(
        doc.commit({
          label: 'Paste elements',
          nextMap,
          nextSelection,
        })
      );
      notify('info', tp(countSelectedObjects(nextSelection), 'Pasted {count} object', 'Pasted {count} objects'));
      return true;
    } catch {
      return false;
    }
  }, [cursorWorld, notify]);

  const handleSelectAll = useCallback(() => {
    const doc = docRef.current;
    if (!doc || !spatialIndex) return;
    const st = doc.getSnapshot();
    if (activeTool === 'vertex') {
      const vertices: EditorSelection['vertices'] = [];
      if (layers.showPolygons && !locks.polygons) {
        for (let pi = 0; pi < st.map.polygons.length; pi++) {
          vertices.push(
            { polyIndex: pi, vertexIndex: 0 },
            { polyIndex: pi, vertexIndex: 1 },
            { polyIndex: pi, vertexIndex: 2 }
          );
        }
      }
      updateSelection({ ...emptySelection(), vertices });
      return;
    }
      const sel = spatialIndex.selectInBox(-1e6, -1e6, 1e6, 1e6, layers, locks, false, selectionFilter);
    updateSelection(sel);
  }, [activeTool, layers, locks, selectionFilter, spatialIndex, updateSelection]);

  const handlePropDrawOrder = useCallback(
    (direction: PropDrawOrderDirection) => {
      const doc = docRef.current;
      if (!doc) return;
      const st = doc.getSnapshot();
      if (st.selection.props.length === 0) return;
      const { nextMap, nextSelectedProps } = reorderSelectedProps(
        st.map,
        st.selection.props,
        direction
      );
      setSnapshot(
        doc.commit({
          label: `Scenery order: ${direction}`,
          nextMap,
          nextSelection: { ...st.selection, props: nextSelectedProps },
        })
      );
    },
    []
  );

  const projectSaving = useRef(false);
  const saveProject = useCallback(async () => {
    const doc = docRef.current;
    if (!doc || projectSaving.current) return;
    if (sectionHasPreview) {
      setActiveTool('climb_tunnel');
      notify('info',t('Apply or cancel the section preview before saving the project.'));
      return;
    }
    const st = doc.getSnapshot();
    projectSaving.current = true;
    try {
      const prepared = prepareMapForSave(st.map,{geometryDirty:doc.isGeometryDirty(),sceneryDirty:doc.isSceneryDirty()});
      const result = await downloadProjectFile(st.currentBaseName,prepared);
      if (!result || docRef.current!==doc) return;
      if (result==='download-started') {
        notify('info',t('Project download started. The recovery copy stays available.'));
        return;
      }
      setSnapshot(doc.markSaved(prepared,st.currentBaseName,null,st.map,'project'));
      notify('success',t('Saved the editable project as .smaproj.'));
    } catch (error) {
      notify('error',t('Could not save the project: {error}',{error:error instanceof Error ? error.message : String(error)}));
    } finally {
      projectSaving.current=false;
    }
  },[sectionHasPreview,setActiveTool,notify]);

  // Save map via server safe-save endpoint
  const saveMapToDisk = useCallback(
    async (opts: {
      baseName: string;
      destination: EditorSaveDestination;
      customOutputFolder?: string;
      confirmOverwrite?: boolean;
    }): Promise<EditorSaveResponse> => {
      const doc = docRef.current;
      if (!doc) throw new Error(t('No map is open in the editor.'));
      // One save at a time: a quick save finishing after a Save as would point the document back to the old file
      if (savingRef.current) throw new Error(t('Wait for the current save to finish.'));
      const st = doc.getSnapshot();
      const prepared = prepareMapForSave(st.map, {
        geometryDirty: doc.isGeometryDirty(),
        sceneryDirty: doc.isSceneryDirty(),
      });
      const bytes = serializePms(prepared);
      const pmsBase64 = uint8ToBase64(bytes);

      savingRef.current = true;
      try {
      const res = await fetch('/api/editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseName: opts.baseName,
          destination: opts.destination,
          customOutputFolder: opts.customOutputFolder,
          sourceMapId: st.sourceMapId,
          confirmOverwrite: Boolean(opts.confirmOverwrite),
          documentId: st.draftId,
          pmsBase64,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        const err = new Error(payload?.error || `HTTP ${res.status}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      const saveResult = payload as EditorSaveResponse;
      if (docRef.current === doc) {
        lastSaveTargetRef.current = {
          baseName: saveResult.baseName,
          destination: opts.destination,
          customOutputFolder: opts.customOutputFolder,
        };
      }
      if (docRef.current === doc) {
        setSnapshot(doc.markSaved(prepared, saveResult.baseName, saveResult.newMapId, st.map));
        void draftAutosave.clearIfClean(doc.getSnapshot());
      }
      if (saveResult.meta) onMetaUpdated(saveResult.meta);
      if (saveResult.newMapId && onSavedToLibrary) onSavedToLibrary(saveResult.newMapId);
      return saveResult;
      } finally {
        savingRef.current = false;
      }
    },
    [onMetaUpdated, onSavedToLibrary, draftAutosave]
  );

  // Ctrl+S after the first save: same file, same folder, no dialog (that file is this document's own output)
  const quickSave = useCallback(async () => {
    const target = lastSaveTargetRef.current;
    if (!target || savingRef.current) return;
    try {
      const res = await saveMapToDisk({ ...target, confirmOverwrite: true });
      notify('success', t('Saved {name}.pms', { name: res.baseName }));
    } catch (err) {
      notify('error', t('Could not save the map: {error}', { error: err instanceof Error ? err.message : String(err) }));
    }
  }, [saveMapToDisk, notify]);

  // Brush / Light application at (wx, wy) — affects polygon vertices AND optionally sceneries!
  const applyVertexBrushAt = useCallback(
    (wx: number, wy: number, txId: string, mode: 'brush' | 'light') => {
      const doc = docRef.current;
      if (!doc || !spatialIndex) return;
      const st = doc.getSnapshot();
      const r = mode === 'light' ? Math.max(8, brush.lightRadius) : Math.max(4, brush.radius);
      const candidates = spatialIndex.queryPolygonCandidates(wx - r, wy - r, wx + r, wy + r);
      const propCandidates = brush.affectSceneries
        ? spatialIndex.queryPropCandidates(wx - r, wy - r, wx + r, wy + r)
        : [];
      if (candidates.length === 0 && propCandidates.length === 0) return;

      const selectedPolySet =
        brush.affectSelectedOnly && st.selection.polygons.length > 0
          ? new Set(st.selection.polygons)
          : null;
      const selectedPropSet =
        brush.affectSelectedOnly && st.selection.props.length > 0
          ? new Set(st.selection.props)
          : null;

      const blendColorAtDist = (src: RgbaColor, dist: number, srcAlpha: number): { color: RgbaColor; alpha: number } => {
        const falloff = Math.max(0, 1 - dist / r);
        if (mode === 'light') {
          const k = Math.min(1, falloff * falloff * brush.lightIntensity);
          return {
            color: {
              r: Math.min(255, Math.round(src.r + (brush.color.r - src.r) * k + brush.color.r * 0.25 * k)),
              g: Math.min(255, Math.round(src.g + (brush.color.g - src.g) * k + brush.color.g * 0.25 * k)),
              b: Math.min(255, Math.round(src.b + (brush.color.b - src.b) * k + brush.color.b * 0.25 * k)),
              a: src.a,
            },
            alpha: srcAlpha,
          };
        }

        const tWeight = Math.min(1, brush.strength * (0.4 + 0.6 * falloff));
        let nr = src.r;
        let ng = src.g;
        let nb = src.b;
        let na = src.a;
        let outAlpha = srcAlpha;

        if (brush.blendMode === 'replace') {
          nr = Math.round(src.r + (brush.color.r - src.r) * tWeight);
          ng = Math.round(src.g + (brush.color.g - src.g) * tWeight);
          nb = Math.round(src.b + (brush.color.b - src.b) * tWeight);
          na = Math.round(src.a + (brush.color.a - src.a) * tWeight);
          outAlpha = Math.round(srcAlpha + (brush.color.a - srcAlpha) * tWeight);
        } else if (brush.blendMode === 'multiply') {
          const mr = (src.r * brush.color.r) / 255;
          const mg = (src.g * brush.color.g) / 255;
          const mb = (src.b * brush.color.b) / 255;
          nr = Math.round(src.r + (mr - src.r) * tWeight);
          ng = Math.round(src.g + (mg - src.g) * tWeight);
          nb = Math.round(src.b + (mb - src.b) * tWeight);
        } else if (brush.blendMode === 'screen') {
          const sr = 255 - ((255 - src.r) * (255 - brush.color.r)) / 255;
          const sg = 255 - ((255 - src.g) * (255 - brush.color.g)) / 255;
          const sb = 255 - ((255 - src.b) * (255 - brush.color.b)) / 255;
          nr = Math.round(src.r + (sr - src.r) * tWeight);
          ng = Math.round(src.g + (sg - src.g) * tWeight);
          nb = Math.round(src.b + (sb - src.b) * tWeight);
        } else if (brush.blendMode === 'alpha_only') {
          na = Math.round(src.a + (brush.color.a - src.a) * tWeight);
          outAlpha = Math.round(srcAlpha + (brush.color.a - srcAlpha) * tWeight);
        }

        return {
          color: {
            r: Math.max(0, Math.min(255, nr)),
            g: Math.max(0, Math.min(255, ng)),
            b: Math.max(0, Math.min(255, nb)),
            a: Math.max(0, Math.min(255, na)),
          },
          alpha: Math.max(0, Math.min(255, outAlpha)),
        };
      };

      let changed = false;
      const nextPolygons = [...st.map.polygons];

      for (const pi of candidates) {
        if (selectedPolySet && !selectedPolySet.has(pi)) continue;
        const poly = nextPolygons[pi];
        let polyChanged = false;
        const nextVerts = poly.vertices.map((v) => {
          const dist = Math.hypot(v.x - wx, v.y - wy);
          if (dist > r) return v;
          polyChanged = true;
          changed = true;
          const blended = blendColorAtDist(v.color, dist, v.color.a);
          return { ...v, color: blended.color };
        }) as [PmsVertex, PmsVertex, PmsVertex];

        if (polyChanged) {
          // Colour / texture-only edit: keeping `raw` keeps the file's collision normals (see prepareMapForSave)
          nextPolygons[pi] = { ...poly, vertices: nextVerts };
        }
      }

      let nextProps = st.map.props;
      if (propCandidates.length > 0) {
        nextProps = [...st.map.props];
        for (const pri of propCandidates) {
          if (selectedPropSet && !selectedPropSet.has(pri)) continue;
          const prop = nextProps[pri];
          if (!prop || !prop.active) continue;
          const w = prop.width !== 0 ? prop.width : 64;
          const h = prop.height !== 0 ? prop.height : 64;
          const c = computePropCorners(prop.x, prop.y, w, h, prop.scaleX, prop.scaleY, prop.rotation);
          const qcx = (c[0] + c[4]) * 0.5;
          const qcy = (c[1] + c[5]) * 0.5;
          const dist = Math.hypot(qcx - wx, qcy - wy);
          if (dist > r) continue;
          changed = true;
          const blended = blendColorAtDist(prop.color, dist, prop.alpha);
          const { raw: _raw, ...rest } = prop;
          nextProps[pri] = {
            ...rest,
            color: { ...blended.color, a: blended.alpha },
            alpha: blended.alpha,
          };
        }
      }

      if (changed) {
        setSnapshot(
          doc.commit({
            label: mode === 'light' ? 'Bake vertex light' : 'Paint vertex colors',
            nextMap: { ...st.map, polygons: nextPolygons, props: nextProps },
            transactionId: txId,
          })
        );
      }
    },
    [brush, spatialIndex]
  );

  // Insert arbitrary CW polygons (from Image-to-Polygons Vectorizer or Procedural Island Generator)
  const insertGeneratedPolygons = useCallback(
    (added: PmsPolygon[], label: string) => {
      const doc = docRef.current;
      if (!doc || added.length === 0) return false;
      const st = doc.getSnapshot();
      const startIdx = st.map.polygons.length;
      if (startIdx + added.length > SOLDAT_MAP_LIMITS.maxPolys) {
        notify('error', t('This operation would exceed the 5000 polygon limit.'));
        return false;
      }
      setSnapshot(
        doc.commit({
          label,
          nextMap: { ...st.map, polygons: [...st.map.polygons, ...added] },
          nextSelection: {
            ...emptySelection(),
            polygons: added.map((_, i) => startIdx + i),
          },
        })
      );
      return true;
    },
    [notify]
  );

  const polygonGestures = useMemo(() => createPolygonGestures({
    placement, texture: texDims,
    hasDocument: () => docRef.current !== null,
    insert: insertGeneratedPolygons,
    inform: message => notify('info', message),
    startDrag: drag => { activeDragRef.current = drag; },
    setDraft: setDraftPoints,
    setLaser: setLaserPoints,
    setLaserPreview: setLaserPreviewPoints,
    lastLaserPreview: laserPreviewAtRef,
    snapEndpoint: (pointer, anchor, showGuides) => {
      const end = spatialIndex?.snapPoint(pointer.worldX, pointer.worldY, pointer.zoom, snap, { anchorPoint: anchor });
      if (end && showGuides) {
        setSnapIndicator(end.indicator);
        setSmartGuides(end.guides);
      }
      return end;
    },
  }), [placement, texDims, insertGeneratedPolygons, notify, spatialIndex, snap]);
  const commitDraftShape = polygonGestures.finishOutline;

  // Global keyboard shortcuts while editor is open. The handlers are rebuilt on every render (they read the
  // latest state) but registered only once per editor session through refs.
  const keyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const keyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (!isOpen) return;
    const releaseHeldKeys = () => {
      spaceHeldRef.current = false;
      playtestInputRef.current = { left: false, right: false, jump: false, crouch: false, jetpack: false };
    };
    const onKeyDown = (e: KeyboardEvent) => keyDownRef.current(e);
    const onKeyUp = (e: KeyboardEvent) => keyUpRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseHeldKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseHeldKeys);
      releaseHeldKeys();
    };
  }, [isOpen]);

  {
    // Only fields that take typed text keep the keyboard; checkboxes, sliders, colour pickers and buttons don't
    const isEditableTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
      if (el instanceof HTMLInputElement) {
        return !['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image'].includes(el.type);
      }
      return false;
    };
    const isSliderKey = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement &&
      e.target.type === 'range' &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key);

    keyDownRef.current = (e: KeyboardEvent) => {
      // Dialogs (save, new map, symmetry, screenshots…) own the keyboard while they are open
      if (isAnyModalOpen() || document.querySelector('[aria-modal="true"]')) {
        // …but Ctrl+S must not open the browser's "Save page" over them
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault();
        return;
      }
      // Let focused controls keep native activation, tab navigation and radio/slider movement.
      if (e.key==='Tab' || isSliderKey(e)) return;
      const control=e.target instanceof Element && e.target.closest('button,input,select,textarea,summary,a[href],[role="button"]');
      // A button that only kept focus after a mouse click (no focus ring) must not swallow Space: Space still pans
      const clickedButton=!!control && control.matches('button,summary,[role="button"]') && !control.matches(':focus-visible');
      if (control && ((e.code==='Space' && !clickedButton) || e.key==='Enter' || e.target instanceof HTMLInputElement && e.target.type==='radio' && e.key.startsWith('Arrow'))) return;

      if (e.code === 'Space' && !isEditableTarget(e.target)) {
        // Space must not press the last clicked dock button again or scroll a panel
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
        if (activeTool !== 'playtest') spaceHeldRef.current = true;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // A field still being typed into applies its value first (it does so on blur)
        if (document.activeElement instanceof HTMLElement && isEditableTarget(document.activeElement)) {
          document.activeElement.blur();
        }
        const current = docRef.current?.getSnapshot();
        if (!e.shiftKey && (current?.projectFile || current?.map.editorSketch || current?.map.editorTunnels?.length)) {
          void saveProject();
          return;
        }
        const target = lastSaveTargetRef.current;
        if (e.shiftKey || !target) {
          setSaveModalOpen(true);
        } else if (!savingRef.current) {
          void quickSave();
        } else {
          notify('info', t('Wait for the current save to finish.'));
        }
        return;
      }

      if (isEditableTarget(e.target)) return;

      if (e.key === 'F4' && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setPanelsHidden((v) => !v);
        return;
      }

      // Live Playtest Soldier controls (WASD / Arrows + Space/Shift Jetpack + R Respawn + Esc exit)
      if (activeTool === 'playtest' && !mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'a' || e.key === 'ArrowLeft') {
          playtestInputRef.current.left = true;
          e.preventDefault();
          return;
        }
        if (k === 'd' || e.key === 'ArrowRight') {
          playtestInputRef.current.right = true;
          e.preventDefault();
          return;
        }
        if (k === 'w' || e.key === 'ArrowUp') {
          playtestInputRef.current.jump = true;
          e.preventDefault();
          return;
        }
        if (k === 's' || e.key === 'ArrowDown') {
          playtestInputRef.current.crouch = true;
          e.preventDefault();
          return;
        }
        if (e.code === 'Space' || e.key === 'Shift') {
          playtestInputRef.current.jetpack = true;
          e.preventDefault();
          return;
        }
        if (k === 'r') {
          e.preventDefault();
          spawnPlaytestSoldier();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setActiveTool('select');
          return;
        }
        // Keys without a playtest meaning must not edit the map behind the running soldier
        if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '[' || e.key === ']' || e.key === ';' || e.key === "'") {
          e.preventDefault();
          return;
        }
      }

      // A drag rebuilds the map from the copy taken when it started: undo, paste, duplicate, delete or a nudge made
      // during it would vanish or come back on the next pointer move
      if (activeDragRef.current && (mod || e.key === 'Delete' || e.key === 'Backspace' || e.key.startsWith('Arrow'))) {
        e.preventDefault();
        return;
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        // Selected text on the page (e.g. a validation message) is copied normally
        if (window.getSelection()?.toString()) return;
        if (handleCopySelection()) e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (handlePasteClipboard()) e.preventDefault();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectSimilar();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        invertCurrentSelection();
        return;
      }
      if (!mod && e.key === 'Home') {
        e.preventDefault();
        frameMap();
        return;
      }
      if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        frameSelection();
        return;
      }
      if (!mod && (e.key === '?' || e.key === 'F1')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (!mod && (e.key === 'PageUp' || e.key === 'PageDown')) {
        // Draw order of the selection: PageUp brings forward, Shift+PageUp to the very front
        e.preventDefault();
        const dir: PropDrawOrderDirection =
          e.key === 'PageUp' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward';
        const st = docRef.current?.getSnapshot();
        if (st?.selection.props.length) handlePropDrawOrder(dir);
        else if (st?.selection.polygons.length) handlePolygonDrawOrder(dir);
        return;
      }

      if ((e.key === 'Escape' || e.key === 'Backspace') && activeDragRef.current?.kind === 'shape_drag') {
        e.preventDefault();
        activeDragRef.current = null;
        setDraftPoints([]);
        return;
      }
      if (e.key === 'Backspace' && draftPoints.length) {
        e.preventDefault();
        setDraftPoints(points => points.slice(0, -1));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteSelection();
        return;
      }

      if (e.key === 'Enter' && activeTool === 'poly_shape' && placement.polyShapeMode === 'polygon' && draftPoints.length >= 3) {
        e.preventDefault();
        commitDraftShape(draftPoints);
        return;
      }

      if (e.key === 'Escape') {
        if (activeTool==='climb_tunnel') {
          if (activeTunnel) {
            if (activeDragRef.current?.kind !== 'tunnel_knot') tunnelWorkspace.cancel();
            activeDragRef.current = null;
            setLaserPoints(null);
            return;
          }
          const drawing = activeDragRef.current?.kind === 'tunnel_stroke';
          activeDragRef.current=null;
          setLaserPoints(null);
          if (!drawing) setTunnelPath([]);
          return;
        }
        if (draftPoints.length > 0) {
          setDraftPoints([]);
        } else if (activePrefab) {
          setActivePrefab(null);
        } else {
          updateSelection(emptySelection());
        }
        return;
      }

      // Quick Scale ([ / ]) & Brush Radius ([ / ]) + Quick Rotate (; / ')
      if (!mod && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        if (activeTool === 'color_brush') {
          const step = e.shiftKey ? 24 : 8;
          setBrush((prev) => ({
            ...prev,
            radius: Math.max(4, Math.min(600, prev.radius + (e.key === ']' ? step : -step))),
          }));
          return;
        }
        if (activeTool === 'light') {
          const step = e.shiftKey ? 40 : 16;
          setBrush((prev) => ({
            ...prev,
            lightRadius: Math.max(16, Math.min(1200, prev.lightRadius + (e.key === ']' ? step : -step))),
          }));
          return;
        }
        const doc = docRef.current;
        const st = doc?.getSnapshot();
        const factor = e.key === ']' ? 1.1 : 1 / 1.1;
        if (doc && st && !isSelectionEmpty(st.selection) && selectionSummary.bounds) {
          const b = selectionSummary.bounds;
          const nextMap = scaleSelection(
            st.map,
            st.selection,
            factor,
            factor,
            (b.left + b.right) * 0.5,
            (b.top + b.bottom) * 0.5,
            { weldSharedVertices: snap.weldSharedVertices }
          );
          setSnapshot(doc.commit({ label: 'Scale selection', nextMap, transactionId: 'hotkey_scale' }));
          return;
        }
        if (activeTool === 'scenery') {
          setPlacement((prev) => ({
            ...prev,
            sceneryScaleX: Number(Math.max(0.05, Math.min(10, prev.sceneryScaleX * factor)).toFixed(3)),
            sceneryScaleY: Number(Math.max(0.05, Math.min(10, prev.sceneryScaleY * factor)).toFixed(3)),
          }));
          return;
        }
      }

      if (!mod && !e.altKey && (e.key === ';' || e.key === "'")) {
        e.preventDefault();
        const deg = e.key === "'" ? 15 : -15;
        const doc = docRef.current;
        const st = doc?.getSnapshot();
        if (doc && st && !isSelectionEmpty(st.selection) && selectionSummary.bounds) {
          const b = selectionSummary.bounds;
          const nextMap = rotateSelection(
            st.map,
            st.selection,
            (deg * Math.PI) / 180,
            (b.left + b.right) * 0.5,
            (b.top + b.bottom) * 0.5,
            { weldSharedVertices: snap.weldSharedVertices }
          );
          setSnapshot(doc.commit({ label: 'Rotate selection', nextMap, transactionId: 'hotkey_rotate' }));
          return;
        }
        if (activeTool === 'scenery') {
          setPlacement((prev) => ({
            ...prev,
            sceneryRotationDeg: ((prev.sceneryRotationDeg + deg + 540) % 360) - 180,
          }));
          return;
        }
      }

      // Arrow-key nudge
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        const doc = docRef.current;
        if (!doc) return;
        const st = doc.getSnapshot();
        if (isSelectionEmpty(st.selection)) return;
        e.preventDefault();
        const step = e.shiftKey ? Math.max(8, snap.gridSize || 16) : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const nextMap = translateSelection(st.map, st.selection, dx, dy, {
          weldSharedVertices: snap.weldSharedVertices,
          texWidth: texDims.w,
          texHeight: texDims.h,
        });
        setSnapshot(
          doc.commit({
            label: 'Nudge selection',
            nextMap,
            transactionId: 'arrow_nudge',
          })
        );
        return;
      }

      if (!mod && !e.altKey) {
        const key = e.key.toLowerCase();
        const tool = (Object.keys(toolKeys) as EditorToolId[]).find(id => toolKeys[id] === key.toUpperCase());
        if (tool) {
          e.preventDefault();
          setActiveTool(tool);
        } else if (key === 'g') {
          e.preventDefault();
          setSnap((prev) => ({ ...prev, snapToGrid: !prev.snapToGrid }));
        }
      }
    };

    keyUpRef.current = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        playtestInputRef.current.jetpack = false;
      }
      if (e.key === 'Shift') {
        playtestInputRef.current.jetpack = false;
      }
      const k = e.key.toLowerCase();
      if (k === 'a' || e.key === 'ArrowLeft') playtestInputRef.current.left = false;
      if (k === 'd' || e.key === 'ArrowRight') playtestInputRef.current.right = false;
      if (k === 'w' || e.key === 'ArrowUp') playtestInputRef.current.jump = false;
      if (k === 's' || e.key === 'ArrowDown') playtestInputRef.current.crouch = false;
    };
  }

  // Pointer Down handler invoked by MapViewport
  const handlePointerDown = useCallback(
    (info: {
      worldX: number;
      worldY: number;
      clientX: number;
      clientY: number;
      button: number;
      shiftKey: boolean;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      zoom: number;
    }): boolean => {
      // The document can be one render ahead of React state: a dock field may have saved its value on blur
      // during this very press, and a drag starting now must build on that value
      const snapshot = docRef.current?.getSnapshot() ?? null;
      if (!isOpen || !snapshot || !spatialIndex) return false;
      // Middle mouse or Space+LeftDrag or Ruler tool uses MapViewport's native pan/ruler
      if (info.button === 1 || spaceHeldRef.current || activeTool === 'ruler') {
        return false;
      }
      if (info.button !== 0) return false;

      const anchor = draftPoints.length > 0 ? draftPoints[draftPoints.length - 1] : null;
      const snapped = spatialIndex.snapPoint(info.worldX, info.worldY, info.zoom, snap, {
        anchorPoint: anchor,
      });
      const sx = snapped.x;
      const sy = snapped.y;

      // 0a. Playtest Soldier Mode: Click anywhere on canvas to teleport/spawn soldier there!
      if (activeTool === 'playtest') {
        spawnPlaytestSoldier(info.worldX, info.worldY);
        return true;
      }

      // 0b. Prefab Stamp Mode (activePrefab selected from Prefabs panel)
      if (activePrefab) {
        const { nextMap, nextSelection } = insertElementBundle(
          snapshot.map,
          activePrefab.bundle,
          activePrefab.bounds,
          sx,
          sy
        );
        commitMutation(`Place prefab: ${activePrefab.name}`, nextMap, nextSelection);
        return true;
      }

      // 1. Polygon Creation Tools
      if (activeTool==='climb_tunnel') {
        if (planningPace) return true;
        if (locks.polygons) { notify('info',t('Unlock polygons to draw terrain.')); return true; }
        const clicked={x:info.worldX,y:info.worldY};
        if (activeTunnel) {
          let hit = -1, best = 12;
          activeTunnel.knots.slice(1,-1).forEach((p,i)=>{
            const pos = i+1===knotIndex && sectionPoint ? sectionPoint : p;
            const d = Math.hypot(pos.x-clicked.x,pos.y-clicked.y)*info.zoom;
            if (d<=best) {best=d;hit=i+1;}
          });
          if (hit<0 || (sectionModified && hit!==knotIndex)) return true;
          if (hit!==knotIndex) selectKnot(hit);
          if (comparingSections) return true;
          const origin=hit===knotIndex && sectionPoint ? sectionPoint : activeTunnel.knots[hit];
          activeDragRef.current={kind:'tunnel_knot',knot:hit,start:clicked,origin,zoom:info.zoom};
          return true;
        }
        const near=tunnelMethod==='draw' ? tunnelPath.findIndex(p=>Math.hypot(p.x-clicked.x,p.y-clicked.y)*info.zoom<=8) : -1;
        activeDragRef.current = {kind:'tunnel_stroke', stroke: new TunnelStroke(tunnelPath, near, clicked,
          {x:info.clientX, y:info.clientY})};
        return true;
      }
      if (polygonGestures.begin(activeTool, info, snapped, draftPoints, locks.polygons)) return true;

      // 2. Color Brush & Light Tools (+ Alt Eyedropper on vertices OR sceneries!)
      if (activeTool === 'color_brush' || activeTool === 'light') {
        if (info.altKey) {
          const vHits = spatialIndex.pickVerticesAtPoint(info.worldX, info.worldY, info.zoom * 0.5, layers, locks);
          if (vHits.length > 0) {
            const sampled = snapshot.map.polygons[vHits[0].polyIndex]?.vertices[vHits[0].vertexIndex]?.color;
            if (sampled) setBrush((prev) => ({ ...prev, color: { ...sampled } }));
            return true;
          }
          const propHits = spatialIndex.pickObjectsAtPoint(info.worldX, info.worldY, info.zoom, layers, locks, 'sceneries');
          if (propHits.length > 0) {
            const sp = snapshot.map.props[propHits[0].index];
            if (sp) setBrush((prev) => ({ ...prev, color: { r: sp.color.r, g: sp.color.g, b: sp.color.b, a: sp.alpha } }));
          }
          return true;
        }
        const txId = `brush_${Date.now()}`;
        activeDragRef.current = { kind: 'brush', txId };
        applyVertexBrushAt(
          info.worldX,
          info.worldY,
          txId,
          activeTool === 'light' ? 'light' : 'brush'
        );
        return true;
      }

      // 3. Texture UV Tool
      if (activeTool === 'uv') {
        const hits = spatialIndex
          .pickObjectsAtPoint(info.worldX, info.worldY, info.zoom, layers, locks, 'polygons');
        let targetSel = snapshot.selection;
        if (hits.length > 0 && !snapshot.selection.polygons.includes(hits[0].index)) {
          targetSel = info.shiftKey
            ? mergeSelections(snapshot.selection, { ...emptySelection(), polygons: [hits[0].index] }, 'toggle')
            : { ...emptySelection(), polygons: [hits[0].index] };
          updateSelection(targetSel);
        }
        if (targetSel.polygons.length > 0) {
          activeDragRef.current = {
            kind: 'uv_drag',
            txId: `uv_${Date.now()}`,
            baseMap: snapshot.map,
            selection: targetSel,
            startWorldX: info.worldX,
            startWorldY: info.worldY,
            altRotate: info.altKey,
            shiftScale: info.shiftKey && snapshot.selection.polygons.includes(hits[0]?.index ?? -1),
          };
        }
        return true;
      }

      // 4. Scenery Studio Tool ([E]):
      //    - Drag OBB Gizmo handles on selected scenery to stretch/scale/rotate/move
      //    - Click an existing scenery to select & drag (or Alt+Click to eyedropper its style/scale/tint!)
      //    - Click empty space (or Ctrl+Click / Stamp Always) to stamp a new scenery with defaults + optional randomizer!
      if (activeTool === 'scenery') {
        const sceneryGizmo =
          !info.ctrlKey && !isSelectionEmpty(snapshot.selection)
            ? hitTestTransformGizmo(
                info.worldX,
                info.worldY,
                info.zoom,
                selectionSummary,
                snapshot.map,
                snapshot.selection
              )
            : null;

        if (!sceneryGizmo) {
          if (!info.ctrlKey && !placement.sceneryStampAlways) {
            const propHits = spatialIndex.pickObjectsAtPoint(
              info.worldX,
              info.worldY,
              info.zoom,
              layers,
              locks,
              'sceneries'
            );
            if (propHits.length > 0) {
              if (info.altKey) {
                const picked = snapshot.map.props[propHits[0].index];
                if (picked) {
                  const fname = snapshot.map.scenery[picked.style - 1]?.filename ?? placement.sceneryFilename;
                  const lvl = (picked.level === 0 || picked.level === 1 || picked.level === 2 ? picked.level : 1) as 0 | 1 | 2;
                  setPlacement((prev) => ({
                    ...prev,
                    sceneryFilename: fname,
                    sceneryLevel: lvl,
                    sceneryScaleX: Number(picked.scaleX.toFixed(3)),
                    sceneryScaleY: Number(picked.scaleY.toFixed(3)),
                    sceneryRotationDeg: Number(((-picked.rotation * 180) / Math.PI).toFixed(1)),
                    sceneryAlpha: picked.alpha,
                    sceneryTint: { ...picked.color, a: picked.alpha },
                  }));
                }
                return true;
              }

              let pickIdx = 0;
              const prevClick = lastClickPickRef.current;
              if (
                prevClick &&
                !info.shiftKey &&
                Math.hypot(info.clientX - prevClick.x, info.clientY - prevClick.y) <= 4
              ) {
                pickIdx = (prevClick.cycle + 1) % propHits.length;
              }
              lastClickPickRef.current = { x: info.clientX, y: info.clientY, cycle: pickIdx };
              const chosenIdx = propHits[pickIdx].index;
              const singleSel: EditorSelection = { ...emptySelection(), props: [chosenIdx] };
              const nextSel = info.shiftKey
                ? mergeSelections(snapshot.selection, singleSel, 'toggle')
                : snapshot.selection.props.includes(chosenIdx) && pickIdx === 0
                ? snapshot.selection
                : singleSel;
              updateSelection(nextSel);
              if (nextSel.props.length > 0) {
                activeDragRef.current = {
                  kind: 'move',
                  txId: `prop_move_${Date.now()}`,
                  baseMap: snapshot.map,
                  selection: cloneSelection(nextSel),
                  startWorldX: info.worldX,
                  startWorldY: info.worldY,
                  moved: false,
                };
              }
              return true;
            }
          }

          if (!placement.sceneryFilename) return true;
          const ensured = ensureSceneryEntry(snapshot.map.scenery, placement.sceneryFilename);
          const w = sceneryPreviewDims.w || 64;
          const h = sceneryPreviewDims.h || 64;

          let effScaleX = placement.sceneryScaleX || 1;
          let effScaleY = placement.sceneryScaleY || 1;
          let effDeg = placement.sceneryRotationDeg || 0;
          if (placement.sceneryRandomize) {
            const jScale = 1 + (Math.random() * 2 - 1) * (placement.sceneryScaleJitter || 0);
            effScaleX *= jScale;
            effScaleY *= jScale;
            if (placement.sceneryRandomFlipX && Math.random() < 0.5) {
              effScaleX = -effScaleX;
            }
            effDeg += (Math.random() * 2 - 1) * (placement.sceneryRotJitterDeg || 0);
          }
          const effRot = (-effDeg * Math.PI) / 180;
          const c0 = computePropCorners(0, 0, w, h, effScaleX, effScaleY, effRot);
          const qcx = (c0[0] + c0[4]) * 0.5;
          const qcy = (c0[1] + c0[5]) * 0.5;

          const newProp: PmsProp = {
            index: snapshot.map.props.length,
            active: true,
            style: ensured.style,
            width: w,
            height: h,
            x: sx - qcx,
            y: sy - qcy,
            rotation: effRot,
            scaleX: Number(effScaleX.toFixed(4)),
            scaleY: Number(effScaleY.toFixed(4)),
            alpha: Math.max(0, Math.min(255, Math.round(placement.sceneryAlpha))),
            color: {
              r: placement.sceneryTint.r,
              g: placement.sceneryTint.g,
              b: placement.sceneryTint.b,
              a: Math.max(0, Math.min(255, Math.round(placement.sceneryAlpha))),
            },
            level: placement.sceneryLevel,
          };
          const nextIdx = snapshot.map.props.length;
          const stampedMap: PmsMapData = {
            ...snapshot.map,
            scenery: ensured.scenery,
            props: [...snapshot.map.props, newProp],
          };
          const stampedSel: EditorSelection = { ...emptySelection(), props: [nextIdx] };
          const stampTx = `prop_stamp_${Date.now()}`;
          commitMutation('Place scenery', stampedMap, stampedSel, stampTx);
          setRecentSceneries(rememberRecentScenery(placement.sceneryFilename));
          activeDragRef.current = {
            kind: 'prop_stamp_size',
            txId: stampTx,
            propIndex: nextIdx,
            baseMap: stampedMap,
            anchorX: sx,
            anchorY: sy,
            startClientX: info.clientX,
            startClientY: info.clientY,
          };
          return true;
        }
        // If sceneryGizmo WAS hit, fall straight through to section 8 (Transform Gizmo) below!
      }

      // 5. Spawn Placement Tool
      if (activeTool === 'spawn') {
        const nextIdx = snapshot.map.spawnpoints.length;
        commitMutation(
          'Place spawn point',
          {
            ...snapshot.map,
            spawnpoints: [
              ...snapshot.map.spawnpoints,
              {
                index: nextIdx,
                active: true,
                x: Math.round(sx),
                y: Math.round(sy),
                team: placement.spawnTeam,
              },
            ],
          },
          { ...emptySelection(), spawns: [nextIdx] }
        );
        return true;
      }

      // 6. Collider Placement Tool
      if (activeTool === 'collider') {
        const nextIdx = snapshot.map.colliders.length;
        // Placing and the following size drag share one id, so they are one undo step
        const colliderTx = `col_create_${Date.now()}`;
        commitMutation(
          'Place collider',
          {
            ...snapshot.map,
            colliders: [
              ...snapshot.map.colliders,
              {
                index: nextIdx,
                active: true,
                x: sx,
                y: sy,
                radius: placement.colliderDiameter,
              },
            ],
          },
          { ...emptySelection(), colliders: [nextIdx] },
          colliderTx
        );
        activeDragRef.current = {
          kind: 'collider_rim',
          txId: colliderTx,
          colliderIndex: nextIdx,
          baseMap: docRef.current!.getSnapshot().map,
          armDistance: 6 / Math.max(0.02, info.zoom),
          startWorldX: info.worldX,
          startWorldY: info.worldY,
        };
        return true;
      }

      // 7. Bot Waypoint Tool (click = place or select; Shift+click = connect from selected waypoint!)
      if (activeTool === 'waypoint') {
        const wpHits = spatialIndex
          .pickObjectsAtPoint(info.worldX, info.worldY, info.zoom, { ...layers, showWaypoints: true }, locks)
          .filter((h) => h.kind === 'waypoint');

        if (wpHits.length > 0) {
          const clickedWp = wpHits[0].index;
          if (info.shiftKey && snapshot.selection.waypoints.length === 1) {
            const fromWp = snapshot.selection.waypoints[0];
            if (fromWp !== clickedWp) {
              const nextMap = toggleWaypointConnection(snapshot.map, fromWp, clickedWp, info.altKey);
              commitMutation('Connect waypoints', nextMap, snapshot.selection);
              return true;
            }
          }
          updateSelection({ ...emptySelection(), waypoints: [clickedWp] });
          activeDragRef.current = {
            kind: 'move',
            txId: `wp_move_${Date.now()}`,
            baseMap: snapshot.map,
            selection: { ...emptySelection(), waypoints: [clickedWp] },
            startWorldX: info.worldX,
            startWorldY: info.worldY,
            moved: false,
          };
          return true;
        }

        const newOneBased = snapshot.map.waypoints.length + 1;
        const newZeroIdx = snapshot.map.waypoints.length;
        let nextWaypoints = [
          ...snapshot.map.waypoints,
          {
            index: newOneBased,
            active: true,
            id: newOneBased,
            x: Math.round(sx),
            y: Math.round(sy),
            left: false,
            right: false,
            up: false,
            down: false,
            jetpack: false,
            pathNum: placement.waypointPathNum,
            action: placement.waypointAction,
            connections: [] as number[],
          },
        ];
        let nextMap: PmsMapData = { ...snapshot.map, waypoints: nextWaypoints };
        // Shift+click on empty space places a new waypoint AND connects from the previously selected waypoint
        if (info.shiftKey && snapshot.selection.waypoints.length === 1) {
          nextMap = toggleWaypointConnection(nextMap, snapshot.selection.waypoints[0], newZeroIdx, false);
        }
        commitMutation('Place waypoint', nextMap, { ...emptySelection(), waypoints: [newZeroIdx] });
        return true;
      }

      // 8. Select / Lasso / Vertex Tools — Check Transform Gizmo handles first (in vertex mode a vertex wins)
      const vertexUnderCursor =
        activeTool === 'vertex' &&
        spatialIndex.pickVerticesAtPoint(info.worldX, info.worldY, info.zoom, layers, locks).length > 0;
      const gizmoHit = vertexUnderCursor
        ? null
        : hitTestTransformGizmo(
            info.worldX,
            info.worldY,
            info.zoom,
            selectionSummary,
            snapshot.map,
            snapshot.selection
          );

      if (gizmoHit && selectionSummary.bounds) {
        const b = selectionSummary.bounds;
        const cx = (b.left + b.right) * 0.5;
        const cy = (b.top + b.bottom) * 0.5;
        const txId = `gizmo_${gizmoHit}_${Date.now()}`;

        if (gizmoHit === 'collider_rim') {
          activeDragRef.current = {
            kind: 'collider_rim',
            txId,
            colliderIndex: snapshot.selection.colliders[0],
            baseMap: snapshot.map,
          };
          return true;
        }
        if (gizmoHit === 'move') {
          activeDragRef.current = {
            kind: 'move',
            txId,
            baseMap: snapshot.map,
            selection: cloneSelection(snapshot.selection),
            startWorldX: info.worldX,
            startWorldY: info.worldY,
            moved: false,
          };
          return true;
        }
        if (gizmoHit === 'rotate') {
          activeDragRef.current = {
            kind: 'rotate',
            txId,
            baseMap: snapshot.map,
            selection: cloneSelection(snapshot.selection),
            pivotX: cx,
            pivotY: cy,
            startAngle: Math.atan2(info.worldY - cy, info.worldX - cx),
          };
          return true;
        }
        // Scale handle: pivot is the opposite side/corner of the selection AABB
        const dir = gizmoHit.startsWith('scale_') ? gizmoHit.slice(6) : '';
        const pivotX = dir.includes('w') ? b.right : dir.includes('e') ? b.left : cx;
        const pivotY = dir.includes('n') ? b.bottom : dir.includes('s') ? b.top : cy;
        activeDragRef.current = {
          kind: 'scale',
          txId,
          handle: gizmoHit,
          baseMap: snapshot.map,
          selection: cloneSelection(snapshot.selection),
          bounds: b,
          pivotX,
          pivotY,
          startWorldX: info.worldX,
          startWorldY: info.worldY,
        };
        return true;
      }

      // 9. Vertex Mode Picking & Edge Split (Ctrl/Alt double-click or Shift+Alt click on edge)
      if (activeTool === 'vertex') {
        const vHits = spatialIndex.pickVerticesAtPoint(info.worldX, info.worldY, info.zoom, layers, locks);
        if (vHits.length > 0) {
          const hitSel: EditorSelection = { ...emptySelection(), vertices: vHits };
          const alreadySelected = vHits.some((vh) =>
            snapshot.selection.vertices.some(
              (sv) => sv.polyIndex === vh.polyIndex && sv.vertexIndex === vh.vertexIndex
            )
          );
          let nextSel = snapshot.selection;
          if (info.altKey) {
            nextSel = mergeSelections(snapshot.selection, hitSel, 'remove');
            updateSelection(nextSel);
          } else if (info.shiftKey) {
            nextSel = mergeSelections(snapshot.selection, hitSel, 'toggle');
            updateSelection(nextSel);
          } else if (!alreadySelected) {
            nextSel = hitSel;
            updateSelection(nextSel);
          }

          if (nextSel.vertices.length > 0 && !info.altKey) {
            activeDragRef.current = {
              kind: 'move',
              txId: `vert_move_${Date.now()}`,
              baseMap: snapshot.map,
              selection: cloneSelection(nextSel),
              startWorldX: info.worldX,
              startWorldY: info.worldY,
              moved: false,
            };
          }
          return true;
        }

        // Start vertex marquee / lasso selection on empty space
        const selMode: 'replace' | 'add' | 'remove' = info.altKey
          ? 'remove'
          : info.shiftKey
          ? 'add'
          : 'replace';
        if (selMode === 'replace') updateSelection(emptySelection());
        activeDragRef.current = {
          kind: 'marquee',
          startX: info.worldX,
          startY: info.worldY,
          mode: selMode,
          baseSelection: selMode === 'replace' ? emptySelection() : cloneSelection(snapshot.selection),
        };
        return true;
      }

      // 10. Object Click Picking (with overlap cycling on repeated clicks at the same spot!)
      const objHits = spatialIndex.pickObjectsAtPoint(
        info.worldX,
        info.worldY,
        info.zoom,
        layers,
        locks,
        selectionFilter
      );
      if (objHits.length > 0 && activeTool === 'select') {
        let pickIdx = 0;
        const prevClick = lastClickPickRef.current;
        if (
          prevClick &&
          !info.shiftKey &&
          !info.altKey &&
          Math.hypot(info.clientX - prevClick.x, info.clientY - prevClick.y) <= 4
        ) {
          pickIdx = (prevClick.cycle + 1) % objHits.length;
        }
        lastClickPickRef.current = { x: info.clientX, y: info.clientY, cycle: pickIdx };
        const chosen = objHits[pickIdx];

        const singleSel: EditorSelection = {
          ...emptySelection(),
          ...(chosen.kind === 'polygon' ? { polygons: [chosen.index] } : {}),
          ...(chosen.kind === 'prop' ? { props: [chosen.index] } : {}),
          ...(chosen.kind === 'spawn' ? { spawns: [chosen.index] } : {}),
          ...(chosen.kind === 'collider' ? { colliders: [chosen.index] } : {}),
          ...(chosen.kind === 'waypoint' ? { waypoints: [chosen.index] } : {}),
        };

        const isChosenAlreadySelected =
          (chosen.kind === 'polygon' && snapshot.selection.polygons.includes(chosen.index)) ||
          (chosen.kind === 'prop' && snapshot.selection.props.includes(chosen.index)) ||
          (chosen.kind === 'spawn' && snapshot.selection.spawns.includes(chosen.index)) ||
          (chosen.kind === 'collider' && snapshot.selection.colliders.includes(chosen.index)) ||
          (chosen.kind === 'waypoint' && snapshot.selection.waypoints.includes(chosen.index));

        let nextSel = snapshot.selection;
        if (info.altKey) {
          nextSel = mergeSelections(snapshot.selection, singleSel, 'remove');
          updateSelection(nextSel);
          return true;
        } else if (info.shiftKey) {
          nextSel = mergeSelections(snapshot.selection, singleSel, 'toggle');
          updateSelection(nextSel);
        } else if (!isChosenAlreadySelected || pickIdx > 0) {
          nextSel = singleSel;
          updateSelection(nextSel);
        }

        if (!isSelectionEmpty(nextSel)) {
          activeDragRef.current = {
            kind: 'move',
            txId: `obj_move_${Date.now()}`,
            baseMap: snapshot.map,
            selection: cloneSelection(nextSel),
            startWorldX: info.worldX,
            startWorldY: info.worldY,
            moved: false,
          };
        }
        return true;
      }

      // 11. Empty-space drag -> Box Marquee (in 'select') or Freehand Lasso (in 'lasso')
      const selMode: 'replace' | 'add' | 'remove' = info.altKey
        ? 'remove'
        : info.shiftKey
        ? 'add'
        : 'replace';
      const baseSelection =
        selMode === 'replace' ? emptySelection() : cloneSelection(snapshot.selection);
      if (selMode === 'replace' && !isSelectionEmpty(snapshot.selection)) {
        updateSelection(emptySelection());
      }

      if (activeTool === 'lasso') {
        const pts = [{ x: info.worldX, y: info.worldY }];
        setLassoPoints(pts);
        activeDragRef.current = { kind: 'lasso', points: pts, mode: selMode, baseSelection };
      } else {
        setMarqueeBox({ x1: info.worldX, y1: info.worldY, x2: info.worldX, y2: info.worldY });
        activeDragRef.current = {
          kind: 'marquee',
          startX: info.worldX,
          startY: info.worldY,
          mode: selMode,
          baseSelection,
        };
      }
      return true;
    },
    [
      isOpen,
      snapshot,
      spatialIndex,
      activeTool,
      selectionFilter,
      snap,
      draftPoints,
      activePrefab,
      placement,
      sceneryPreviewDims,
      layers,
      locks,
      selectionSummary,
      commitMutation,
      polygonGestures,
      tunnelMethod, tunnelPath, activeTunnel, sectionPoint, sectionModified, comparingSections, planningPace, knotIndex, selectKnot,
      notify,
      applyVertexBrushAt,
      updateSelection,
      spawnPlaytestSoldier,
    ]
  );

  // Pointer Move handler invoked by MapViewport
  const handlePointerMove = useCallback(
    (info: {
      worldX: number;
      worldY: number;
      clientX: number;
      clientY: number;
      buttons: number;
      shiftKey: boolean;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      zoom: number;
    }) => {
      if (!isOpen || !snapshot || !spatialIndex) return;

      const drag = activeDragRef.current;
      if (!drag) {
        const anchor = draftPoints.length > 0 ? draftPoints[draftPoints.length - 1] : null;
        const needsSnap =
          activeTool === 'poly_tri' ||
          activeTool === 'poly_strip' ||
          activeTool === 'poly_fan' ||
          activeTool === 'poly_shape' ||
          activeTool === 'vertex' ||
          activeTool === 'scenery' ||
          activeTool === 'spawn' ||
          activeTool === 'collider' ||
          activeTool === 'waypoint';

        if (needsSnap) {
          const snapped = spatialIndex.snapPoint(info.worldX, info.worldY, info.zoom, snap, {
            anchorPoint: anchor,
          });
          setCursorWorld({ x: snapped.x, y: snapped.y });
          setSnapIndicator(snapped.indicator);
          setSmartGuides(snapped.guides);
        } else {
          setCursorWorld({ x: info.worldX, y: info.worldY });
          setSnapIndicator(null);
          setSmartGuides([]);
        }
        return;
      }

      if (drag.kind === 'move') {
        const rawDx = info.worldX - drag.startWorldX;
        const rawDy = info.worldY - drag.startWorldY;
        if (!drag.moved && Math.hypot(rawDx, rawDy) * info.zoom < 2.5) return;
        drag.moved = true;

        let dx = rawDx;
        let dy = rawDy;
        const excludePolys = new Set(drag.selection.polygons);
        const excludeVertices = new Set<string>();
        for (const vr of drag.selection.vertices) {
          excludeVertices.add(`${vr.polyIndex}:${vr.vertexIndex}`);
        }

        // Snap single vertex or selection origin cleanly
        if (drag.selection.vertices.length > 0 && drag.selection.polygons.length === 0) {
          const v0 = drag.baseMap.polygons[drag.selection.vertices[0].polyIndex]?.vertices[drag.selection.vertices[0].vertexIndex];
          if (v0) {
            const snapped = spatialIndex.snapPoint(v0.x + rawDx, v0.y + rawDy, info.zoom, snap, {
              excludePolys,
              excludeVertices,
            });
            dx = snapped.x - v0.x;
            dy = snapped.y - v0.y;
            setSnapIndicator(snapped.indicator);
            setSmartGuides(snapped.guides);
          }
        } else if (snap.snapToGrid) {
          const g = Math.max(1, snap.gridSize || 16);
          dx = Math.round(rawDx / g) * g;
          dy = Math.round(rawDy / g) * g;
        }

        const nextMap = translateSelection(drag.baseMap, drag.selection, dx, dy, {
          weldSharedVertices: snap.weldSharedVertices,
          texWidth: texDims.w,
          texHeight: texDims.h,
        });
        commitMutation('Move selection', nextMap, drag.selection, drag.txId);
        return;
      }

      if (drag.kind === 'rotate') {
        let delta = Math.atan2(info.worldY - drag.pivotY, info.worldX - drag.pivotX) - drag.startAngle;
        if (snap.angleSnap || info.shiftKey) {
          const step = ((snap.angleStepDeg || 15) * Math.PI) / 180;
          delta = Math.round(delta / step) * step;
        }
        const nextMap = rotateSelection(
          drag.baseMap,
          drag.selection,
          delta,
          drag.pivotX,
          drag.pivotY,
          { weldSharedVertices: snap.weldSharedVertices }
        );
        commitMutation('Rotate selection', nextMap, drag.selection, drag.txId);
        return;
      }

      if (drag.kind === 'scale') {
        // True local-axis OBB stretching when a single scenery prop is selected!
        if (
          drag.selection.props.length === 1 &&
          drag.selection.polygons.length === 0 &&
          drag.selection.vertices.length === 0 &&
          drag.selection.spawns.length === 0 &&
          drag.selection.colliders.length === 0 &&
          drag.selection.waypoints.length === 0 &&
          drag.handle.startsWith('scale_')
        ) {
          const propIdx = drag.selection.props[0];
          const origProp = drag.baseMap.props[propIdx];
          if (origProp) {
            const stretched = stretchSinglePropLocal(
              origProp,
              drag.handle as
                | 'scale_nw'
                | 'scale_ne'
                | 'scale_se'
                | 'scale_sw'
                | 'scale_n'
                | 'scale_e'
                | 'scale_s'
                | 'scale_w',
              info.worldX,
              info.worldY,
              info.shiftKey
            );
            const nextProps = [...drag.baseMap.props];
            nextProps[propIdx] = stretched;
            commitMutation('Stretch scenery', { ...drag.baseMap, props: nextProps }, drag.selection, drag.txId);
            return;
          }
        }

        const origDx = drag.startWorldX - drag.pivotX;
        const origDy = drag.startWorldY - drag.pivotY;
        const curDx = info.worldX - drag.pivotX;
        const curDy = info.worldY - drag.pivotY;

        let sxFactor = Math.abs(origDx) > 1 ? curDx / origDx : 1;
        let syFactor = Math.abs(origDy) > 1 ? curDy / origDy : 1;

        if (drag.handle === 'scale_n' || drag.handle === 'scale_s') sxFactor = 1;
        if (drag.handle === 'scale_w' || drag.handle === 'scale_e') syFactor = 1;
        if (info.shiftKey && drag.handle.length === 'scale_ne'.length) {
          const uni = Math.abs(sxFactor) >= Math.abs(syFactor) ? sxFactor : syFactor;
          sxFactor = uni;
          syFactor = uni;
        }

        const nextMap = scaleSelection(
          drag.baseMap,
          drag.selection,
          sxFactor,
          syFactor,
          drag.pivotX,
          drag.pivotY,
          { weldSharedVertices: snap.weldSharedVertices }
        );
        commitMutation('Scale selection', nextMap, drag.selection, drag.txId);
        return;
      }

      if (drag.kind === 'prop_stamp_size') {
        const base = drag.baseMap.props[drag.propIndex];
        if (!base) return;
        // A click (or a tiny jitter) keeps the stamp at its preset size, centred on the click
        if (Math.hypot(info.clientX - drag.startClientX, info.clientY - drag.startClientY) < 5) {
          commitMutation('Place scenery', drag.baseMap, { ...emptySelection(), props: [drag.propIndex] }, drag.txId);
          return;
        }
        const w = base.width || 64;
        const h = base.height || 64;
        // The drawn rectangle is measured along the prop's own axes, so rotated stamps work too
        const r = -base.rotation;
        const dx = info.worldX - drag.anchorX;
        const dy = info.worldY - drag.anchorY;
        const localW = Math.max(2, Math.abs(dx * Math.cos(r) + dy * Math.sin(r)));
        const localH = Math.max(2, Math.abs(-dx * Math.sin(r) + dy * Math.cos(r)));
        let magX = localW / w;
        let magY = localH / h;
        if (!info.shiftKey) {
          const k = Math.max(magX, magY);
          magX = k;
          magY = k;
        }
        const sized: PmsProp = {
          ...base,
          scaleX: Number(((base.scaleX < 0 ? -1 : 1) * magX).toFixed(4)),
          scaleY: Number(((base.scaleY < 0 ? -1 : 1) * magY).toFixed(4)),
        };
        // Centre of the drawn rectangle (proportional mode grows from the anchor towards the cursor)
        const ux = Math.cos(r);
        const uy = Math.sin(r);
        const sgnU = dx * ux + dy * uy >= 0 ? 1 : -1;
        const sgnV = -dx * uy + dy * ux >= 0 ? 1 : -1;
        const halfU = (magX * w) / 2;
        const halfV = (magY * h) / 2;
        const cx = drag.anchorX + sgnU * halfU * ux - sgnV * halfV * uy;
        const cy = drag.anchorY + sgnU * halfU * uy + sgnV * halfV * ux;
        const center = computePropQuadCenter(sized);
        const nextProps = [...drag.baseMap.props];
        nextProps[drag.propIndex] = { ...sized, x: sized.x + (cx - center.x), y: sized.y + (cy - center.y) };
        commitMutation(
          'Place scenery',
          { ...drag.baseMap, props: nextProps },
          { ...emptySelection(), props: [drag.propIndex] },
          drag.txId
        );
        return;
      }

      if (drag.kind === 'collider_rim') {
        const col = drag.baseMap.colliders[drag.colliderIndex];
        if (!col) return;
        if (drag.armDistance !== undefined) {
          const moved = Math.hypot(info.worldX - (drag.startWorldX ?? col.x), info.worldY - (drag.startWorldY ?? col.y));
          if (moved < drag.armDistance) return; // a plain click keeps the default diameter
          drag.armDistance = undefined;
        }
        const dist = Math.hypot(info.worldX - col.x, info.worldY - col.y);
        const diameter = Math.max(4, Math.round(dist * 2));
        const nextColliders = [...drag.baseMap.colliders];
        const { raw: _raw, ...rest } = col;
        nextColliders[drag.colliderIndex] = { ...rest, radius: diameter };
        commitMutation(
          'Resize collider',
          { ...drag.baseMap, colliders: nextColliders },
          { ...emptySelection(), colliders: [drag.colliderIndex] },
          drag.txId
        );
        return;
      }

      if (drag.kind === 'marquee') {
        setMarqueeBox({
          x1: drag.startX,
          y1: drag.startY,
          x2: info.worldX,
          y2: info.worldY,
        });
        const boxSel = spatialIndex.selectInBox(
          drag.startX,
          drag.startY,
          info.worldX,
          info.worldY,
          layers,
          locks,
          activeTool === 'vertex',
          selectionFilter
        );
        updateSelection(mergeSelections(drag.baseSelection, boxSel, drag.mode));
        return;
      }

      if (drag.kind === 'lasso') {
        const last = drag.points[drag.points.length - 1];
        if (!last || Math.hypot(info.worldX - last.x, info.worldY - last.y) * info.zoom >= 3) {
          drag.points.push({ x: info.worldX, y: info.worldY });
          setLassoPoints([...drag.points]);
          const now = performance.now();
          if (drag.points.length >= 3 && now - (drag.lastEvalAt ?? 0) >= LASSO_PREVIEW_INTERVAL_MS) {
            drag.lastEvalAt = now;
            const lassoSel = spatialIndex.selectInLasso(
              drag.points,
              layers,
              locks,
              activeTool === 'vertex',
              selectionFilter
            );
            updateSelection(mergeSelections(drag.baseSelection, lassoSel, drag.mode));
          }
        }
        return;
      }

      if (drag.kind === 'tunnel_knot') {
        setLaserPoints([{x:drag.origin.x+info.worldX-drag.start.x,y:drag.origin.y+info.worldY-drag.start.y}]);
        return;
      }
      if (drag.kind === 'tunnel_stroke') {
        const p={x:info.worldX,y:info.worldY};
        if (drag.stroke.sample(p, {x:info.clientX,y:info.clientY}, 3 / info.zoom))
          setLaserPoints([...drag.stroke.points]);
        return;
      }

      if (isPolygonDrag(drag)) {
        polygonGestures.move(drag, info);
        return;
      }

      if (drag.kind === 'brush') {
        applyVertexBrushAt(
          info.worldX,
          info.worldY,
          drag.txId,
          activeTool === 'light' ? 'light' : 'brush'
        );
        return;
      }

      if (drag.kind === 'uv_drag') {
        const dx = info.worldX - drag.startWorldX;
        const dy = info.worldY - drag.startWorldY;
        const tw = Math.max(1, texDims.w);
        const th = Math.max(1, texDims.h);
        const nextPolygons = [...drag.baseMap.polygons];
        for (const pi of drag.selection.polygons) {
          const orig = drag.baseMap.polygons[pi];
          if (!orig) continue;
          const uc = (orig.vertices[0].u + orig.vertices[1].u + orig.vertices[2].u) / 3;
          const vc = (orig.vertices[0].v + orig.vertices[1].v + orig.vertices[2].v) / 3;
          const nextVerts = orig.vertices.map((v) => {
            if (drag.altRotate) {
              const ang = dx * 0.01;
              const cos = Math.cos(ang);
              const sin = Math.sin(ang);
              return {
                ...v,
                u: uc + (v.u - uc) * cos - (v.v - vc) * sin,
                v: vc + (v.u - uc) * sin + (v.v - vc) * cos,
              };
            }
            if (drag.shiftScale) {
              const factor = Math.max(0.1, 1 + dx * 0.005);
              return {
                ...v,
                u: uc + (v.u - uc) / factor,
                v: vc + (v.v - vc) / factor,
              };
            }
            return {
              ...v,
              u: v.u - dx / tw,
              v: v.v - dy / th,
            };
          }) as [PmsVertex, PmsVertex, PmsVertex];
          // Colour / texture-only edit: keeping `raw` keeps the file's collision normals (see prepareMapForSave)
          nextPolygons[pi] = { ...orig, vertices: nextVerts };
        }
        commitMutation('Transform texture UVs', { ...drag.baseMap, polygons: nextPolygons }, drag.selection, drag.txId);
        return;
      }

    },
    [
      isOpen,
      snapshot,
      spatialIndex,
      activeTool,
      selectionFilter,
      draftPoints,
      snap,
      texDims,
      layers,
      locks,
      commitMutation,
      updateSelection,
      applyVertexBrushAt,
      polygonGestures,
    ]
  );

  const handlePointerUp = useCallback((info: Parameters<ViewportEditorBridge['onPointerUp']>[0]) => {
    const drag = activeDragRef.current;
    activeDragRef.current = null;
    if (drag?.kind === 'lasso' && drag.points.length >= 3 && spatialIndex) {
      const lassoSel = spatialIndex.selectInLasso(drag.points, layers, locks, activeTool === 'vertex', selectionFilter);
      updateSelection(mergeSelections(drag.baseSelection, lassoSel, drag.mode));
    }
    if (isPolygonDrag(drag)) {
      polygonGestures.end(drag, info, locks.polygons);
    } else if (drag?.kind==='tunnel_knot') {
      setLaserPoints(null);
      if (!info.cancelled && !info.outsideViewport && !locks.polygons) {
        const dx = info.worldX-drag.start.x, dy=info.worldY-drag.start.y;
        if (Math.hypot(dx,dy)*drag.zoom>=3) setSection(drag.knot,{point:{
          x: Math.round(drag.origin.x+dx), y: Math.round(drag.origin.y+dy),
        }});
      }
    } else if (drag?.kind==='tunnel_stroke') {
      setLaserPoints(null);
      const cancelled = Boolean(info.cancelled || info.outsideViewport);
      if (!cancelled) drag.stroke.sample({x:info.worldX,y:info.worldY}, {x:info.clientX,y:info.clientY}, 0, true);
      const completed = drag.stroke.finish(cancelled);
      if (completed) {
        setTunnelPath(completed);
      }
    }
    setMarqueeBox(null);
    setLassoPoints(null);
    setSnapIndicator(null);
    setSmartGuides((g) => (g.length > 0 ? [] : g));
  }, [polygonGestures, spatialIndex, layers, locks, activeTool, selectionFilter, updateSelection, setSection, setTunnelPath]);

  const handleDoubleClick = useCallback(
    (info: { worldX: number; worldY: number; zoom: number }): boolean => {
      if (!isOpen || !snapshot || !spatialIndex) return false;
      if (activeTool === 'poly_shape' && placement.polyShapeMode === 'polygon' && draftPoints.length >= 3) {
        commitDraftShape(draftPoints);
        return true;
      }
      // In Vertex mode, double-clicking a polygon edge splits that triangle (and welded shared neighbors) into CW triangles!
      if (activeTool === 'vertex') {
        const edgeHit = spatialIndex.pickNearestPolygonEdge(info.worldX, info.worldY, info.zoom);
        if (edgeHit) {
          const nextPolygons = splitPolygonEdge(
            snapshot.map.polygons,
            edgeHit.polyIndex,
            edgeHit.edgeIndex,
            { x: edgeHit.x, y: edgeHit.y },
            { splitSharedAdjacents: snap.weldSharedVertices }
          );
          // Indices after the split shift, so the old selection would point at other triangles: select the new
          // vertex instead (in every triangle that got it), ready to be dragged
          const target = snapshot.map.polygons[edgeHit.polyIndex];
          const va = target.vertices[edgeHit.edgeIndex];
          const vb = target.vertices[(edgeHit.edgeIndex + 1) % 3];
          const len2 = Math.max(1e-12, (vb.x - va.x) ** 2 + (vb.y - va.y) ** 2);
          const tSplit = Math.max(
            0.05,
            Math.min(0.95, ((edgeHit.x - va.x) * (vb.x - va.x) + (edgeHit.y - va.y) * (vb.y - va.y)) / len2)
          );
          const mid = { x: va.x + (vb.x - va.x) * tSplit, y: va.y + (vb.y - va.y) * tSplit };
          const before = new Set(snapshot.map.polygons);
          const vertices: EditorSelection['vertices'] = [];
          nextPolygons.forEach((poly, pi) => {
            if (before.has(poly)) return;
            poly.vertices.forEach((v, vi) => {
              if (Math.abs(v.x - mid.x) < 0.01 && Math.abs(v.y - mid.y) < 0.01) {
                vertices.push({ polyIndex: pi, vertexIndex: vi as 0 | 1 | 2 });
              }
            });
          });
          commitMutation(
            'Split polygon edge',
            { ...snapshot.map, polygons: nextPolygons },
            { ...emptySelection(), vertices }
          );
          return true;
        }
      }
      return false;
    },
    [isOpen, snapshot, spatialIndex, activeTool, placement.polyShapeMode, draftPoints, snap.weldSharedVertices, commitDraftShape, commitMutation]
  );

  const handleWheel = useCallback(
    (info: { deltaY: number; altKey: boolean; shiftKey: boolean }): boolean => {
      if (!isOpen || !info.altKey || info.deltaY === 0) return false;
      const up = info.deltaY < 0;
      const doc = docRef.current;
      const st = doc?.getSnapshot();
      if (doc && st && st.selection.props.length > 0 && activeTool !== 'scenery') {
        const next = info.shiftKey
          ? rotatePropsInPlace(st.map, st.selection.props, up ? -5 : 5)
          : scaleProps(st.map, st.selection.props, up ? 1.05 : 1 / 1.05, up ? 1.05 : 1 / 1.05);
        setSnapshot(
          doc.commit({
            label: info.shiftKey ? 'Rotate sceneries' : 'Scale sceneries',
            nextMap: next,
            transactionId: info.shiftKey ? 'wheel_rotate' : 'wheel_scale',
          })
        );
        return true;
      }
      if (activeTool === 'scenery') {
        if (doc && st && st.selection.props.length > 0) {
          const next = info.shiftKey
            ? rotatePropsInPlace(st.map, st.selection.props, up ? -5 : 5)
            : scaleProps(st.map, st.selection.props, up ? 1.05 : 1 / 1.05, up ? 1.05 : 1 / 1.05);
          setSnapshot(
            doc.commit({
              label: info.shiftKey ? 'Rotate sceneries' : 'Scale sceneries',
              nextMap: next,
              transactionId: info.shiftKey ? 'wheel_rotate' : 'wheel_scale',
            })
          );
          return true;
        }
        // Nothing selected: resize / turn the stamp that follows the cursor
        setPlacement((prev) =>
          info.shiftKey
            ? { ...prev, sceneryRotationDeg: ((prev.sceneryRotationDeg + (up ? -5 : 5) + 540) % 360) - 180 }
            : {
                ...prev,
                sceneryScaleX: Number(Math.max(0.05, Math.min(16, prev.sceneryScaleX * (up ? 1.05 : 1 / 1.05))).toFixed(3)),
                sceneryScaleY: Number(Math.max(0.05, Math.min(16, prev.sceneryScaleY * (up ? 1.05 : 1 / 1.05))).toFixed(3)),
              }
        );
        setOverlayTick((n) => n + 1);
        return true;
      }
      return false;
    },
    [isOpen, activeTool]
  );

  const handleContextMenu = useCallback((): boolean => {
    if (!isOpen) return false;
    if (activeDragRef.current?.kind === 'shape_drag') {
      activeDragRef.current = null;
      setDraftPoints([]);
      return true;
    }
    if (draftPoints.length > 0) {
      if (activeTool === 'poly_shape' && draftPoints.length >= 3) {
        commitDraftShape(draftPoints);
      } else {
        setDraftPoints([]);
      }
      return true;
    }
    if (activePrefab) {
      setActivePrefab(null);
      return true;
    }
    return false;
  }, [isOpen, activeTool, draftPoints, activePrefab, commitDraftShape]);

  const ghostBounds: PmsBounds | null = useMemo(() => {
    if (!cursorWorld) return null;
    if (activePrefab) {
      const w = activePrefab.bounds.width;
      const h = activePrefab.bounds.height;
      return {
        left: cursorWorld.x - w * 0.5,
        right: cursorWorld.x + w * 0.5,
        top: cursorWorld.y - h * 0.5,
        bottom: cursorWorld.y + h * 0.5,
        width: w,
        height: h,
      };
    }
    return null;
  }, [cursorWorld, activePrefab]);

  const ghostPropQuad: [number, number, number, number, number, number, number, number] | null = useMemo(() => {
    if (!cursorWorld || activePrefab || activeTool !== 'scenery' || !placement.sceneryFilename) {
      return null;
    }
    const w = sceneryPreviewDims.w || 64;
    const h = sceneryPreviewDims.h || 64;
    const sxFactor = placement.sceneryScaleX || 1;
    const syFactor = placement.sceneryScaleY || 1;
    const rot = (-(placement.sceneryRotationDeg || 0) * Math.PI) / 180;
    const c0 = computePropCorners(0, 0, w, h, sxFactor, syFactor, rot);
    const qcx = (c0[0] + c0[4]) * 0.5;
    const qcy = (c0[1] + c0[5]) * 0.5;
    return computePropCorners(cursorWorld.x - qcx, cursorWorld.y - qcy, w, h, sxFactor, syFactor, rot);
  }, [
    cursorWorld,
    activePrefab,
    activeTool,
    placement.sceneryFilename,
    placement.sceneryScaleX,
    placement.sceneryScaleY,
    placement.sceneryRotationDeg,
    sceneryPreviewDims,
  ]);

  const laserPreview = useMemo(() => laserPreviewPoints ? laserStroke(laserPreviewPoints, placement, texDims) : [],
    [laserPreviewPoints, placement, texDims]);

  const sectionPreview=tunnelWorkspace.preview;
  const localFaces=tunnelWorkspace.sectionIndices;
  const widthChanged = tunnelWorkspace.widthOffset !== (activeTunnel?.sections[knotIndex-1]?.widthOffset ?? 0);
  const compareTerrain = widthChanged || !!sectionVariant;
  const comparisonGates = useMemo(() => {
    if (!comparingSections || !activeTunnel) return undefined;
    const {entry, exit} = tunnelSectionGates(activeTunnel, knotIndex);
    const {centerline} = tunnelTrialRoute(activeTunnel);
    return [tunnelGateAt(centerline, entry), tunnelGateAt(centerline, exit)];
  }, [comparingSections, activeTunnel, knotIndex]);
  const originalSectionPolygons = useMemo(() => compareTerrain && sectionPreview?.ok && snapshot
    ? sectionPreview.changedIndices.map(i => snapshot.map.polygons[i]) : undefined, [compareTerrain,sectionPreview,snapshot?.map]);
  const sectionPolygons=useMemo(()=>{
    if (activeTool!=='climb_tunnel' || !activeTunnel || !snapshot) return [];
    return sectionPreview?.ok ? sectionPreview.changedIndices.map(i=>sectionPreview.map.polygons[i]) :
      localFaces.map(i=>snapshot.map.polygons[i]);
  },[activeTool,activeTunnel,sectionPreview,localFaces,snapshot?.map]);

  const overlayRevision = useMemo(
    () =>
      overlayTick +
      (snapshot?.revision ?? 0) +
      draftPoints.length +
      (marqueeBox ? 1 : 0) +
      (lassoPoints?.length ?? 0) +
      (laserPoints?.length ?? 0) +
      (blueprint ? (blueprint.visible ? Math.round(blueprint.opacity * 100) + Math.round(blueprint.x + blueprint.y + blueprint.scale * 10) : 1) : 0) +
      (playtest ? Math.round(playtest.x * 10) + Math.round(playtest.y * 10) + Math.round(playtest.jetFuel) : 0),
    [overlayTick, snapshot?.revision, draftPoints.length, marqueeBox, lassoPoints, laserPoints, blueprint, playtest]
  );

  const renderOverlayCallback = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      vw: number,
      vh: number,
      bounds: { left: number; right: number; top: number; bottom: number }
    ) => {
      if (!snapshot) return;
      renderEditorOverlay(ctx, vw, vh, snapshot.map, bounds, {
        activeTool,
        selection: snapshot.selection,
        selectionSummary,
        gridSize: snap.gridSize,
        showEditorGrid: snap.snapToGrid || layers.showGrid,
        cursorWorld,
        snapIndicator,
        smartGuides,
        marqueeBox,
        lassoPoints,
        tunnelSection: activeTool==='climb_tunnel' && !planningPace && activeTunnel && sectionPoint ? {
          knots:activeTunnel.knots, index:knotIndex, handle:laserPoints?.[0] ?? sectionPoint,
          triangles:sectionPolygons, originalTriangles:originalSectionPolygons, preview:!!sectionPreview?.ok, invalid:sectionPreview?.ok===false,
          trial:sectionVariant?.trial, gates:comparisonGates, stop:comparisonStop,
        } : undefined,
        laserPoints: activeTool==='climb_tunnel' ? (activeTunnel ? null : laserPoints ?? (tunnelMethod==='draw' ? tunnelPath : null)) : laserPoints,
        laserPreview: activeTool==='climb_tunnel' ? (laserPoints ? [] : tunnelDraft?.polygons ?? []) : laserPreview,
        closeLaser:placement.strokeMode==='outline',
        draftPoints,
        closedDraft: activeTool === 'poly_shape' && placement.polyShapeMode !== 'polygon',
        brushRadius:
          activeTool === 'color_brush'
            ? brush.radius
            : activeTool === 'light'
            ? brush.lightRadius
            : null,
        symmetryAxisX,
        validationFocus,
        ghostBounds,
        ghostPropQuad,
        blueprint,
        playtest,
      });
    },
    [
      snapshot,
      activeTool,
      selectionSummary,
      snap.gridSize,
      snap.snapToGrid,
      layers.showGrid,
      cursorWorld,
      snapIndicator,
      smartGuides,
      marqueeBox,
      lassoPoints,
      laserPoints,
      laserPreview,
      tunnelDraft, tunnelMethod, tunnelPath, placement.strokeMode, activeTunnel, sectionPoint, knotIndex, sectionPolygons, originalSectionPolygons, sectionPreview, sectionVariant, comparisonGates, comparisonStop, planningPace,
      draftPoints,
      placement.polyShapeMode,
      brush.radius,
      brush.lightRadius,
      symmetryAxisX,
      validationFocus,
      ghostBounds,
      ghostPropQuad,
      blueprint,
      playtest,
    ]
  );

  const onViewportStatus = useCallback(
    (info: {
      cursorWorld: { x: number; y: number } | null;
      zoom: number;
      viewCenter: { x: number; y: number };
      focusBounds: (b: { left: number; right: number; top: number; bottom: number }) => void;
    }) => {
      setZoom(info.zoom);
      viewCenterRef.current = info.viewCenter;
      focusBoundsRef.current = info.focusBounds;
      if (!activeDragRef.current && info.cursorWorld === null) {
        setCursorWorld(null);
      }
    },
    []
  );

  const focusWorldRect = useCallback(
    (b: { left: number; right: number; top: number; bottom: number }) => {
      focusBoundsRef.current?.(b);
    },
    []
  );

  // Shift+F: zoom to the selection; Home: the whole map
  const frameSelection = useCallback(() => {
    const st = docRef.current?.getSnapshot();
    if (!st) return;
    const b = computeSelectionSummary(st.map, st.selection).bounds;
    if (b) focusBoundsRef.current?.(b);
  }, []);
  const frameMap = useCallback(() => {
    const st = docRef.current?.getSnapshot();
    if (st) focusBoundsRef.current?.(st.map.fullBounds);
  }, []);

  // Bulk selections take only what is visible and not locked, like box selection and Select all
  const selectableFilter = useCallback(
    (m: PmsMapData): SelectableFilter => ({
      polygon: () => layers.showPolygons && !locks.polygons,
      prop: (i) => isPropVisibleAndUnlocked(m.props[i]?.level ?? -1, layers, locks),
      spawn: (i) => isSpawnVisibleAndUnlocked(m.spawnpoints[i]?.team ?? -1, layers, locks),
      collider: () => layers.showColliders && !locks.colliders,
      waypoint: () => layers.showWaypoints && !locks.waypoints,
    }),
    [layers, locks]
  );

  const selectSimilar = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    if (isSelectionEmpty(st.selection)) return;
    const next = selectSimilarObjects(st.map, st.selection, selectableFilter(st.map));
    setSnapshot(doc.setSelection(next));
    notify('info', tp(countSelectedObjects(next), 'Selected {count} similar object', 'Selected {count} similar objects'));
  }, [notify, selectableFilter]);

  const invertCurrentSelection = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    setSnapshot(doc.setSelection(invertSelection(st.map, st.selection, selectableFilter(st.map))));
  }, [selectableFilter]);

  const handlePolygonDrawOrder = useCallback((direction: PropDrawOrderDirection) => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    if (st.selection.polygons.length === 0) return;
    const { nextMap, nextSelected } = reorderSelectedPolygons(st.map, st.selection.polygons, direction);
    if (nextMap === st.map) return;
    setSnapshot(
      doc.commit({
        label: 'Polygon draw order',
        nextMap,
        nextSelection: { ...st.selection, polygons: nextSelected, vertices: [] },
      })
    );
  }, []);

  const viewportBridge: ViewportEditorBridge = useMemo(
    () => ({
      active: isOpen,
      overlayRevision,
      cursorStyle:
        activeTool === 'select' || activeTool === 'lasso'
          ? 'default'
          : 'crosshair',
      wantsNativeRuler: () => activeTool === 'ruler' && !spaceHeldRef.current,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onDoubleClick: handleDoubleClick,
      onWheel: handleWheel,
      onContextMenu: handleContextMenu,
      renderOverlay: renderOverlayCallback,
      onViewportStatus,
    }),
    [
      isOpen,
      overlayRevision,
      activeTool,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleDoubleClick,
      handleWheel,
      handleContextMenu,
      renderOverlayCallback,
      onViewportStatus,
    ]
  );

  // World-aligned UV reset helper for selected polygons
  const resetSelectedPolygonsUvWorldAligned = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    if (st.selection.polygons.length === 0) return;
    const nextPolygons = [...st.map.polygons];
    for (const pi of st.selection.polygons) {
      const poly = nextPolygons[pi];
      if (!poly) continue;
      const nextVerts = poly.vertices.map((v) => {
        const uv = computeWorldAlignedUv(v.x, v.y, texDims.w, texDims.h);
        return { ...v, u: uv.u, v: uv.v };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      // Colour / texture-only edit: keeping `raw` keeps the file's collision normals (see prepareMapForSave)
      nextPolygons[pi] = { ...poly, vertices: nextVerts };
    }
    setSnapshot(
      doc.commit({
        label: 'World-align polygon UVs',
        nextMap: { ...st.map, polygons: nextPolygons },
      })
    );
  }, [texDims]);

  const flipSelectedPolygonsWinding = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    // Without a selection every counter-clockwise triangle of the map is fixed
    const targets =
      st.selection.polygons.length > 0 ? st.selection.polygons : st.map.polygons.map((_, i) => i);
    const { nextMap, fixed } = makePolygonsClockwise(st.map, targets);
    if (fixed === 0) return;
    setSnapshot(doc.commit({ label: 'Make polygons clockwise', nextMap }));
  }, []);

  // Asset browser: swap the image of the selected sceneries (positions, sizes and colours stay)
  const replaceSelectedScenery = useCallback(
    (filename: string) => {
      const doc = docRef.current;
      if (!doc) return;
      const st = doc.getSnapshot();
      if (st.selection.props.length === 0) return;
      const next = replacePropsScenery(st.map, st.selection.props, filename);
      if (next === st.map) return;
      setSnapshot(doc.commit({ label: 'Change scenery image', nextMap: next }));
      notify('success', tp(st.selection.props.length, 'Changed the image of {count} scenery', 'Changed the image of {count} sceneries'));
    },
    [notify]
  );

  // "Fix" buttons of the validation panel
  const applyValidationFix = useCallback(
    (fix: NonNullable<MapValidationIssue['fix']>) => {
      const doc = docRef.current;
      if (!doc) return;
      const st = doc.getSnapshot();
      const valid = fix.polygons.filter((i) => i >= 0 && i < st.map.polygons.length);
      if (valid.length === 0) return;
      if (fix.kind === 'seal_junction') {
        const nextMap = sealPolyJunction(st.map, fix.x, fix.y);
        if (nextMap !== st.map) setSnapshot(doc.commit({label: 'Seal polygon junction', nextMap}));
        return;
      }
      if (fix.kind === 'repair_normals') {
        const { nextMap, fixed } = repairPolygonNormals(st.map, valid);
        if (fixed > 0) {
          setSnapshot(doc.commit({ label: 'Repair polygon normals', nextMap }));
          notify('success', tp(fixed, 'Fixed {count} polygon', 'Fixed {count} polygons'));
        }
        return;
      }
      setSnapshot(
        doc.commit({
          label: 'Delete polygons',
          nextMap: deleteSelection(st.map, { ...emptySelection(), polygons: valid }),
          nextSelection: emptySelection(),
        })
      );
      notify('success', tp(valid.length, 'Deleted {count} polygon', 'Deleted {count} polygons'));
    },
    [notify]
  );

  // Extrude 1-click Grass / Snow / Ice Surface Crust along top boundary edges
  const applySurfaceCrust = useCallback(
    (opts: { thickness: number; topColor: RgbaColor; bottomColor: RgbaColor; polyType: number }) => {
      const doc = docRef.current;
      if (!doc) return;
      const st = doc.getSnapshot();
      if (st.selection.polygons.length === 0 && !confirmWholeMap(t('Surface crust'))) return;
      const targetIndices =
        st.selection.polygons.length > 0
          ? st.selection.polygons
          : st.map.polygons.map((_, i) => i);
      const crust = generateSurfaceCrust(st.map, targetIndices, {
        thickness: opts.thickness,
        topColor: opts.topColor,
        bottomColor: opts.bottomColor,
        crustPolyType: opts.polyType,
        texWidth: texDims.w,
        texHeight: texDims.h,
      });
      insertGeneratedPolygons(crust, 'Generate surface crust');
    },
    [texDims, insertGeneratedPolygons]
  );

  // Apply 1-click Directional 3D Sun Relief Shading onto selected (or all) polygons
  const applyReliefShading = useCallback(
    (opts: { lightAngleDeg: number; contrast: number }) => {
      const doc = docRef.current;
      if (!doc) return;
      const st = doc.getSnapshot();
      if (st.selection.polygons.length === 0 && !confirmWholeMap(t('3D relief shading'))) return;
      const targetIndices =
        st.selection.polygons.length > 0
          ? st.selection.polygons
          : st.map.polygons.map((_, i) => i);
      if (targetIndices.length === 0) return;
      const nextMap = applyDirectionalReliefShading(st.map, targetIndices, {
        sunAngleDeg: opts.lightAngleDeg,
        contrast: opts.contrast,
      });
      setSnapshot(
        doc.commit({
          label: 'Auto-shade 3D relief',
          nextMap,
        })
      );
    },
    []
  );

  // Subdivide selected triangles 1 -> 4 for smooth vertex painting & terrain sculpting
  const handleSubdividePolygons = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const st = doc.getSnapshot();
    if (st.selection.polygons.length === 0) return;
    const res = subdividePolygons(st.map, st.selection.polygons);
    setSnapshot(
      doc.commit({
        label: 'Subdivide polygons',
        nextMap: res.nextMap,
        nextSelection: { ...emptySelection(), polygons: res.newIndices },
      })
    );
  }, []);

  // Generate & insert a procedural jagged floating island / rock cluster
  const handleGenerateProceduralIsland = useCallback(
    (opts: {
      width: number;
      height: number;
      segments: number;
      roughness: number;
      seed: number;
      flatTop: boolean;
      addGrassCrust: boolean;
    }) => {
      const doc = docRef.current;
      if (!doc) return;
      const st = doc.getSnapshot();
      const center = getViewCenter();
      const cx = center?.x ?? (st.map.polyBounds.left + st.map.polyBounds.right) * 0.5;
      const cy = center?.y ?? (st.map.polyBounds.top + st.map.polyBounds.bottom) * 0.5;
      const polys = generateProceduralIsland({
        centerX: cx,
        centerY: cy,
        width: opts.width,
        height: opts.height,
        segments: opts.segments,
        roughness: opts.roughness,
        seed: opts.seed,
        flatTop: opts.flatTop,
        polyType: placement.polyType,
        topColor: placement.polyColor,
        bottomColor: {
          r: Math.round(placement.polyColor.r * 0.42),
          g: Math.round(placement.polyColor.g * 0.42),
          b: Math.round(placement.polyColor.b * 0.42),
          a: placement.polyColor.a,
        },
        addGrassCrust: opts.addGrassCrust,
        texWidth: texDims.w,
        texHeight: texDims.h,
      });
      insertGeneratedPolygons(polys, 'Generate procedural island');
    },
    [placement.polyType, placement.polyColor, texDims, insertGeneratedPolygons, getViewCenter]
  );

  return {
    isOpen,
    snapshot,
    isDirty: Boolean(docRef.current?.isDirty()) || sectionModified,
    canUndo: sectionHasPreview || Boolean(docRef.current?.canUndo()),
    canRedo: !sectionHasPreview && Boolean(docRef.current?.canRedo()),
    activeTool,
    setActiveTool,
    selectionFilter,
    setSelectionFilter,
    panelsHidden,
    setPanelsHidden,
    locks,
    setLocks,
    snap,
    setSnap,
    brush,
    setBrush,
    placement,
    setPlacement,
    leftTab,
    setLeftTab,
    rightTab,
    setRightTab,
    assetCatalog,
    refreshAssetCatalog,
    activePrefab,
    setActivePrefab,
    sceneryPreviewDims,
    texDims,
    cursorWorld,
    zoom,
    selectionSummary,
    symmetryAxisX,
    setSymmetryAxisX,
    validationFocus,
    setValidationFocus,
    blueprint,
    setBlueprint,
    playtest,
    playtestTeam,
    setPlaytestTeam,
    playtestCarryingFlag,
    setPlaytestCarryingFlag,
    spawnPlaytestSoldier,
    saveModalOpen,
    setSaveModalOpen,
    newMapModalOpen,
    setNewMapModalOpen,
    tunnelSettings, setTunnelSettings, tunnelMethod, setTunnelMethod, tunnelPath, setTunnelPath, tunnelDraft,
    useTunnelExample: (kind:'spiral'|'hills') => {
      const path=sketchExample(kind,getViewCenter() ?? {x:0,y:0},tunnelSettings.clearance);
      setTunnelPath(path);
      const x=path.map(p=>p.x), y=path.map(p=>p.y), pad=tunnelSettings.clearance;
      focusWorldRect({left:Math.min(...x)-pad,right:Math.max(...x)+pad,top:Math.min(...y)-pad,bottom:Math.max(...y)+pad});
    },
    applyTunnel: (markers:boolean) => {
      const current=docRef.current?.getSnapshot().map;
      if (!current || !tunnelDraft?.validation.ok) return;
      const replace=tunnelMethod==='auto';
      if (locks.polygons || (markers && (locks.spawns || locks.flags)) || (replace && Object.values(locks).some(Boolean))) {
        notify('info',t('Unlock the affected layers before applying the tunnel.'));
        return;
      }
      const next=replace ? createTunnelMap(tunnelDraft,tunnelSettings,{title:current.mapName,texture:current.texture}) :
        appendTunnel(current,tunnelDraft,tunnelSettings,markers);
      if (!next) { notify('error',t('This tunnel would exceed the PMS polygon or spawn limit.')); return; }
      const previous = replace ? [] : current.editorTunnels ?? [];
      const recipe = createTunnelProject(tunnelDraft,tunnelSettings,replace ? undefined : tunnelPath);
      commitMutation(replace?'Rebuild climb tunnel':'Insert climb tunnel',
        {...next, editorSketch:undefined, editorTunnels:[...previous,recipe]},emptySelection());
      tunnelWorkspace.choose(previous.length);
      if (replace) focusWorldRect(next.fullBounds);
      notify('success',t('Tunnel applied. Ctrl+Z restores the previous map.'));
    },
    symmetryModalOpen,
    setSymmetryModalOpen,
    imageTraceModalOpen,
    setImageTraceModalOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsOpen,
    setShortcutsOpen,
    frameSelection,
    frameMap,
    selectSimilar,
    invertSelection: invertCurrentSelection,
    handlePolygonDrawOrder,
    openMapInEditor,
    saveProject,
    tunnelWorkspace,
    closeEditor,
    commitMutation,
    updateSelection,
    undo,
    redo,
    jumpToHistory,
    handleDeleteSelection,
    handleDuplicateSelection,
    handleCopySelection,
    handlePasteClipboard,
    handleSelectAll,
    handlePropDrawOrder,
    resetSelectedPolygonsUvWorldAligned,
    flipSelectedPolygonsWinding,
    applyValidationFix,
    removeUnusedScenery,
    replaceSelectedScenery,
    insertGeneratedPolygons,
    applySurfaceCrust,
    applyReliefShading,
    handleSubdividePolygons,
    handleGenerateProceduralIsland,
    // Colour pickers and sliders pass a transaction id: one drag of the picker is one undo step
    updateHeader: (patch: Parameters<typeof updateMapHeader>[1], transactionId?: string) => {
      if (!snapshot) return;
      commitMutation('Update map settings', updateMapHeader(snapshot.map, patch), undefined, transactionId);
    },
    saveMapToDisk,
    quickSave,
    hasSaveTarget: lastSaveTargetRef.current !== null,
    lastAutosaveAt,
    toasts,
    dismissToast,
    recentSceneries,
    notify,
    focusWorldRect,
    getViewCenter,
    viewportBridge,
  };
}
