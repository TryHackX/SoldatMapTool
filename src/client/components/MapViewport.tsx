import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapCompactEntry, MapFixAnalysisResponse, MapIndexEntry, SceneryFixIssueGroup } from '@shared/apiTypes';
import { computePropCorners, isPropRenderable, PmsMapData } from '@shared/pmsParser';
import { POLY_TYPES, SOLDIER_COLLISION, SPAWN_TYPES } from '@shared/soldatConstants';
import type { ViewportEditorBridge } from '../editor/useEditorController';
import {
  loadSoldatAssetImage,
  loadSoldatObjectSprites,
  ObjectSpritesBundle,
  ProcessedImageAsset,
} from '../renderer/assetLoader';
import { renderMapOverlays, RulerMeasurement, spawnTypeName } from '../renderer/OverlayRenderer';
import { SoldatWebGLRenderer } from '../renderer/SoldatWebGLRenderer';
import { RenderLayerVisibility } from '../renderer/types';
import { polyTypeName, t, tText } from '../i18n';
import { findFloorBelow, pointInTriangle } from '../utils/mapGeometry';
import {
  AlertTriangle,
  Bot,
  Camera,
  Columns2,
  CircleDot,
  Eye,
  Flag,
  Gift,
  Grid,
  History,
  LocateFixed,
  MapIcon,
  Maximize2,
  Monitor,
  Pencil,
  PersonStanding,
  Ruler,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface MapViewportProps {
  mapEntry: MapIndexEntry | MapCompactEntry | null;
  mapKey: string | null; // id of the map `mapData` belongs to (decides when the camera is re-fitted)
  mapData: PmsMapData | null;
  actionsEnabled: boolean; // geometry + details of the selected map are loaded and consistent
  loading: boolean;
  error: string | null;
  layers: RenderLayerVisibility;
  onChangeLayers: (next: RenderLayerVisibility) => void;
  onOpenFullSizeModal: () => void;
  onOpenWorkshopModal?: (tab?: 'fix' | 'optimize') => void;
  previewModeBanner?: string | null;
  // Texels per world unit of the previewed `_o` layers (their quality): zooming past it shows their resolution limit
  previewLayerQuality?: number | null;
  onClearPreviewMode?: () => void;
  // B5: second map drawn right of a draggable divider (same camera)
  compare?: { key: string; label: string; data: PmsMapData } | null;
  mainLabel?: string;
  compareCandidates?: Array<{ id: string; baseName: string }>;
  onStartCompare?: (mapId: string) => void;
  onCompareWithOriginal?: (() => void) | null;
  onStopCompare?: () => void;
  editorBridge?: ViewportEditorBridge | null;
  onEditCurrentMap?: () => void;
}

interface ViewTransform {
  centerX: number;
  centerY: number;
  zoom: number; // CSS pixels per 1.0 Soldat world unit (1.0 = 100% native game scale!)
}

// Viewport tools remembered between sessions (per browser)
const VIEWPORT_PREFS_KEY = 'soldat-map-studio.viewport.v1';

// What a click on the map selects in the object inspector
type PickFilter = 'all' | 'sceneries' | 'polygons';
const PICK_FILTERS: PickFilter[] = ['all', 'sceneries', 'polygons'];

interface ViewportPrefs {
  showFixIssues: boolean;
  showPlayerView: boolean;
  playerAspect: number; // width / height of the player's screen
  showSoldier: boolean; // real-size soldier at the cursor
  showMinimap: boolean;
  pickFilter: PickFilter;
}

const DEFAULT_VIEWPORT_PREFS: ViewportPrefs = {
  showFixIssues: false,
  showPlayerView: false,
  playerAspect: 16 / 9,
  showSoldier: false,
  showMinimap: true,
  pickFilter: 'all',
};

// Player view frames and soldiers left on a map (per map, remembered between sessions)
const VIEWPORT_PINS_KEY = 'soldat-map-studio.viewport.pins.v1';
const MAX_PINNED_MAPS = 40;
const MAX_PINS_PER_MAP = 60;

interface MapPin {
  id: string;
  kind: 'view' | 'soldier';
  x: number; // world units: centre of a view frame, point between a soldier's feet
  y: number;
  aspect?: number; // view: the player's screen aspect when it was pinned
}

function readPinStore(): Record<string, MapPin[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWPORT_PINS_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function loadMapPins(mapKey: string | null): MapPin[] {
  if (!mapKey) return [];
  const list = readPinStore()[mapKey];
  return Array.isArray(list)
    ? list.filter(
        (p) => p && (p.kind === 'view' || p.kind === 'soldier') && Number.isFinite(p.x) && Number.isFinite(p.y)
      )
    : [];
}

function saveMapPins(mapKey: string, pins: MapPin[]): void {
  try {
    const store = readPinStore();
    delete store[mapKey]; // written again as the newest entry: the maps unused the longest are dropped first
    if (pins.length > 0) store[mapKey] = pins;
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PINNED_MAPS))) delete store[k];
    localStorage.setItem(VIEWPORT_PINS_KEY, JSON.stringify(store));
  } catch {
    // Ignore (private window / blocked storage)
  }
}

const PLAYER_ASPECTS: Array<[string, number]> = [
  ['16:9', 16 / 9],
  ['16:10', 16 / 10],
  ['4:3', 4 / 3],
  ['21:9', 21 / 9],
];

// Device pixels per world unit in game at 1080p (1080 / 480)
const GAME_PX_PER_UNIT_1080P = 2.25;

// Soldat shows a fixed 480 world units of height; the width follows the screen aspect (640 at 4:3)
const PLAYER_VIEW_HEIGHT = 480;

function loadViewportPrefs(): ViewportPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWPORT_PREFS_KEY) || '{}');
    return {
      showFixIssues: typeof raw.showFixIssues === 'boolean' ? raw.showFixIssues : DEFAULT_VIEWPORT_PREFS.showFixIssues,
      showPlayerView:
        typeof raw.showPlayerView === 'boolean' ? raw.showPlayerView : DEFAULT_VIEWPORT_PREFS.showPlayerView,
      playerAspect:
        typeof raw.playerAspect === 'number' && raw.playerAspect > 1 && raw.playerAspect < 3
          ? raw.playerAspect
          : DEFAULT_VIEWPORT_PREFS.playerAspect,
      showSoldier: typeof raw.showSoldier === 'boolean' ? raw.showSoldier : DEFAULT_VIEWPORT_PREFS.showSoldier,
      showMinimap: typeof raw.showMinimap === 'boolean' ? raw.showMinimap : DEFAULT_VIEWPORT_PREFS.showMinimap,
      pickFilter: PICK_FILTERS.includes(raw.pickFilter) ? raw.pickFilter : DEFAULT_VIEWPORT_PREFS.pickFilter,
    };
  } catch {
    return DEFAULT_VIEWPORT_PREFS;
  }
}

interface MinimapGeometry {
  bounds: { left: number; right: number; top: number; bottom: number };
  w: number; // CSS pixels
  h: number;
}

/** Whole map (polygon bounds + margin) fitted into at most 200 × 150 CSS px */
function computeMinimapGeometry(map: PmsMapData): MinimapGeometry {
  const pb = map.polyBounds;
  const pad = Math.max(32, Math.max(pb.width, pb.height) * 0.03);
  let left = pb.left - pad;
  let right = pb.right + pad;
  let top = pb.top - pad;
  let bottom = pb.bottom + pad;
  const MAX_W = 200;
  const MAX_H = 150;
  const MIN_SIDE = 48;
  const aspect = (right - left) / Math.max(1, bottom - top);
  let w = MAX_W;
  let h = Math.round(MAX_W / aspect);
  if (h > MAX_H) {
    h = MAX_H;
    w = Math.round(MAX_H * aspect);
  }
  // Very long or very tall maps: keep a usable minimum size by widening the world window
  if (h < MIN_SIDE) {
    const extra = ((right - left) * (MIN_SIDE / w) - (bottom - top)) / 2;
    top -= extra;
    bottom += extra;
    h = MIN_SIDE;
  }
  if (w < MIN_SIDE) {
    const extra = ((bottom - top) * (MIN_SIDE / h) - (right - left)) / 2;
    left -= extra;
    right += extra;
    w = MIN_SIDE;
  }
  return { bounds: { left, right, top, bottom }, w, h };
}

const MAX_CAMERA_COORD = 250000;
const MAX_INTERACTIVE_FB_DIM = 4096;

function clampCoord(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-MAX_CAMERA_COORD, Math.min(MAX_CAMERA_COORD, v));
}

export const MapViewport: React.FC<MapViewportProps> = ({
  mapEntry,
  mapKey,
  mapData,
  actionsEnabled,
  loading,
  error,
  layers,
  onChangeLayers,
  onOpenFullSizeModal,
  onOpenWorkshopModal,
  previewModeBanner,
  previewLayerQuality,
  onClearPreviewMode,
  compare = null,
  mainLabel,
  compareCandidates = [],
  onStartCompare,
  onCompareWithOriginal = null,
  onStopCompare,
  editorBridge = null,
  onEditCurrentMap,
}) => {
  const editorBridgeRef = useRef(editorBridge);
  editorBridgeRef.current = editorBridge;
  // True between an editor pointer-down the bridge handled and its pointer-up (sent exactly once)
  const editorPointerPendingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SoldatWebGLRenderer | null>(null);
  const prevMapIdentityRef = useRef<string | null>(null);
  const viewportSizeRef = useRef({ width: 800, height: 600 });

  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [transform, setTransform] = useState<ViewTransform>({ centerX: 0, centerY: 0, zoom: 0.5 });
  const [sprites, setSprites] = useState<ObjectSpritesBundle | null>(null);
  const [mapReadyOnGpu, setMapReadyOnGpu] = useState(false);
  const [glRestoreTick, setGlRestoreTick] = useState(0);
  const [contextLost, setContextLost] = useState(false);

  // Cursor inspection & Ruler
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  const [hoverHint, setHoverHint] = useState<string | null>(null);
  const [rulerMode, setRulerMode] = useState(false);
  const [ruler, setRuler] = useState<RulerMeasurement | null>(null);
  const [prefs, setPrefs] = useState<ViewportPrefs>(loadViewportPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(VIEWPORT_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore (private window / blocked storage)
    }
  }, [prefs]);

  // B2: props with 1.7.1 size problems of the current map file (keyed by id + CRC, so an edited file is re-analyzed)
  const analysisKey = mapKey ? `${mapKey}:${mapEntry?.crc32 ?? ''}` : null;
  const [fixAnalysis, setFixAnalysis] = useState<{ key: string; analysis: MapFixAnalysisResponse | null } | null>(
    null
  );
  useEffect(() => {
    if (!prefs.showFixIssues || !mapKey || !analysisKey || fixAnalysis?.key === analysisKey) return;
    let cancelled = false;
    fetch(`/api/workshop/fix-analyze/${encodeURIComponent(mapKey)}?maxLen=24`)
      .then((r) => (r.ok ? r.json() : null))
      .then((analysis: MapFixAnalysisResponse | null) => {
        if (!cancelled) setFixAnalysis({ key: analysisKey, analysis });
      })
      .catch(() => {
        if (!cancelled) setFixAnalysis({ key: analysisKey, analysis: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.showFixIssues, analysisKey]);

  // B4: minimap snapshot of the whole map, taken from the main renderer when the map or layers change
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimapImageRef = useRef<HTMLCanvasElement | null>(null);
  const minimapSourceRef = useRef<{
    data: PmsMapData | null;
    key: string;
    geo: MinimapGeometry | null;
    capturedAt: number;
  }>({
    data: null,
    key: '',
    geo: null,
    capturedAt: 0,
  });
  const [minimapVersion, setMinimapVersion] = useState(0);
  const [minimapRefreshTick, setMinimapRefreshTick] = useState(0);
  const minimapTrailingTimerRef = useRef<number | null>(null);
  const minimapDragRef = useRef(false);
  useEffect(() => {
    return () => {
      if (minimapTrailingTimerRef.current !== null) {
        window.clearTimeout(minimapTrailingTimerRef.current);
      }
    };
  }, []);
  // What the main renderer really holds: loadMap() is async and keeps the previous map until it is applied,
  // so the minimap must never be captured from a frame that still shows the old map or old textures
  const gpuMapRef = useRef<PmsMapData | null>(null);

  // B5: compare renderer (own WebGL context on its own canvas, remounted per compared map)
  const compareCanvasRef = useRef<HTMLCanvasElement>(null);
  const compareRendererRef = useRef<SoldatWebGLRenderer | null>(null);
  const [compareReady, setCompareReady] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const splitDragRef = useRef(false);
  // Fixed position (from the button's rect): the viewport clips overflow, and a wrapped toolbar can put the
  // button at either edge of the map area
  const [compareMenuPos, setCompareMenuPos] = useState<{ left: number; top: number } | null>(null);
  const compareMenuOpen = compareMenuPos !== null;
  const setCompareMenuOpen = (open: boolean) => {
    if (!open) setCompareMenuPos(null);
  };
  useEffect(() => {
    if (!compareMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-compare-menu]')) setCompareMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [compareMenuOpen]);

  useEffect(() => {
    const canvas = compareCanvasRef.current;
    if (!compare || !canvas) return;
    const renderer = new SoldatWebGLRenderer(canvas);
    compareRendererRef.current = renderer;
    setCompareReady(false);
    let cancelled = false;
    renderer
      .loadMap(compare.data, { preferClassicBmp: layers.preferClassicBmp })
      .then((applied) => {
        if (!cancelled && applied) setCompareReady(true);
      })
      .catch((err) => console.warn('[MapViewport] Błąd ładowania mapy do porównania:', err));
    return () => {
      cancelled = true;
      renderer.destroy(true);
      if (compareRendererRef.current === renderer) compareRendererRef.current = null;
      setCompareReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare?.key, compare?.data, layers.preferClassicBmp]);

  const [inspection, setInspection] = useState<{
    worldX: number;
    worldY: number;
    hits: InspectHit[];
    selected: number;
    pickedByUser?: boolean; // the selection was changed by hand (kept when the list is reordered)
  } | null>(null);
  // Screen position of the last inspector click (clicking the same spot again selects the next object)
  const lastPickRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const pickTokenRef = useRef(0);

  // Frames and soldiers left on the current map; Shift places a soldier where the cursor is instead of on the floor
  const [pinState, setPinState] = useState<{ key: string | null; pins: MapPin[] }>(() => ({
    key: mapKey,
    pins: loadMapPins(mapKey),
  }));
  useEffect(() => {
    setPinState((prev) => (prev.key === mapKey ? prev : { key: mapKey, pins: loadMapPins(mapKey) }));
  }, [mapKey]);
  const pins = pinState.key === mapKey ? pinState.pins : [];
  const updatePins = (change: (prev: MapPin[]) => MapPin[]) => {
    if (!mapKey) return;
    setPinState((prev) => {
      const next = change(prev.key === mapKey ? prev.pins : loadMapPins(mapKey)).slice(-MAX_PINS_PER_MAP);
      saveMapPins(mapKey, next);
      return { key: mapKey, pins: next };
    });
  };
  const [freePlace, setFreePlace] = useState(false);

  const dragRef = useRef<{
    mode: 'pan' | 'ruler';
    startClientX: number;
    startClientY: number;
    startCenterX: number;
    startCenterY: number;
  } | null>(null);

  // Initialize WebGL2 renderer, handle WebGL context loss/restore & preload Soldat object sprites
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;

    const renderer = new SoldatWebGLRenderer(canvas);
    rendererRef.current = renderer;

    loadSoldatObjectSprites()
      .then((bundle) => setSprites(bundle))
      .catch(() => {});

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setMapReadyOnGpu(false);
      setContextLost(true);
    };

    const onContextRestored = () => {
      setContextLost(false);
      setGlRestoreTick((t) => t + 1);
    };

    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);

    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
      renderer.destroy(false);
      rendererRef.current = null;
    };
  }, [glRestoreTick]);

  // Ensure mouse release outside window never leaves drag state active
  useEffect(() => {
    const clearDrag = () => {
      dragRef.current = null;
      // Only a release outside the viewport (or a lost focus) still owes the editor its pointer-up
      if (editorBridgeRef.current?.active && editorPointerPendingRef.current) {
        editorPointerPendingRef.current = false;
        editorBridgeRef.current.onPointerUp({
          worldX: 0,
          worldY: 0,
          clientX: 0,
          clientY: 0,
          button: 0,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          zoom: Math.max(0.02, transformRef.current.zoom || 0.5),
        });
      }
    };
    window.addEventListener('mouseup', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('mouseup', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  const focusBounds = useCallback((b: { left: number; right: number; top: number; bottom: number }) => {
    const vw = Math.max(1, viewportSizeRef.current.width);
    const vh = Math.max(1, viewportSizeRef.current.height);
    const bw = Math.max(32, b.right - b.left);
    const bh = Math.max(32, b.bottom - b.top);
    const padX = Math.max(64, bw * 0.25);
    const padY = Math.max(64, bh * 0.25);
    const fitZoom = Math.min(vw / (bw + padX * 2), vh / (bh + padY * 2));
    setTransform({
      centerX: clampCoord((b.left + b.right) * 0.5),
      centerY: clampCoord((b.top + b.bottom) * 0.5),
      zoom: Math.max(0.05, Math.min(4.0, fitZoom)),
    });
  }, []);

  useEffect(() => {
    if (!editorBridge?.active) return;
    editorBridge.onViewportStatus({
      cursorWorld,
      zoom: transform.zoom,
      viewCenter: { x: transform.centerX, y: transform.centerY },
      focusBounds,
    });
  }, [editorBridge, cursorWorld, transform.zoom, transform.centerX, transform.centerY, focusBounds]);

  // Escape closes the object inspector, then cancels Ruler mode or Live Repair Preview (when no modal is open)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Up / Down walk through the objects under the cursor (not while typing or using another panel)
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && inspection && inspection.hits.length > 1) {
        const target = e.target as HTMLElement | null;
        if (target && target !== document.body && !containerRef.current?.contains(target)) return;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setInspection((prev) =>
          prev
            ? { ...prev, selected: (prev.selected + step + prev.hits.length) % prev.hits.length, pickedByUser: true }
            : prev
        );
        return;
      }
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      if (inspection) {
        setInspection(null);
      } else if (rulerMode || ruler) {
        setRulerMode(false);
        setRuler(null);
      } else if (previewModeBanner && onClearPreviewMode) {
        onClearPreviewMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rulerMode, ruler, previewModeBanner, onClearPreviewMode, inspection]);

  // The inspected objects belong to one map version
  useEffect(() => {
    setInspection(null);
  }, [mapData]);

  // Real image size of the inspected scenery (HD files are often 4.5x the PMS size, which is normal)
  const [inspectFileDims, setInspectFileDims] = useState<{ name: string; w: number; h: number } | null>(null);
  useEffect(() => {
    const hit = inspection?.hits[inspection.selected];
    const name = hit?.sceneryName;
    if (!name) {
      setInspectFileDims(null);
      return;
    }
    let cancelled = false;
    loadSoldatAssetImage('scenery-gfx', name, true, layers.preferClassicBmp)
      .then((img) => {
        if (!cancelled) setInspectFileDims(img ? { name, w: img.width, h: img.height } : null);
      })
      .catch(() => {
        if (!cancelled) setInspectFileDims(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inspection, layers.preferClassicBmp]);

  // Track container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
        viewportSizeRef.current = next;
        setViewportSize(next);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Non-passive native wheel listener so e.preventDefault() zooms smoothly with zero console warnings!
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      // Floating panels (object inspector) scroll normally instead of zooming the map
      if ((e.target as HTMLElement | null)?.closest?.('[data-map-ui]')) return;
      e.preventDefault();
      // Editor: Alt+wheel scales (Shift: rotates) sceneries instead of zooming
      const bridge = editorBridgeRef.current;
      if (bridge?.active && bridge.onWheel?.({ deltaY: e.deltaY || e.deltaX, altKey: e.altKey, shiftKey: e.shiftKey })) {
        return;
      }
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const vw = viewportSizeRef.current.width || rect.width;
      const vh = viewportSizeRef.current.height || rect.height;
      // Proportional to the scroll distance: a mouse notch (~100 px) ≈ ×1.18, touchpad deltas stay smooth
      const deltaPx = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * vh : e.deltaY;
      const factor = Math.min(1.5, Math.max(1 / 1.5, Math.exp(-deltaPx * 0.00166)));

      setTransform((prev) => {
        const prevZoom = Math.max(0.02, prev.zoom || 0.5);
        const nextZoom = Math.max(0.02, Math.min(16.0, prevZoom * factor));
        const worldXBefore = prev.centerX + (mouseX - vw * 0.5) / prevZoom;
        const worldYBefore = prev.centerY + (mouseY - vh * 0.5) / prevZoom;

        const nextCenterX = clampCoord(worldXBefore - (mouseX - vw * 0.5) / nextZoom);
        const nextCenterY = clampCoord(worldYBefore - (mouseY - vh * 0.5) / nextZoom);
        return { centerX: nextCenterX, centerY: nextCenterY, zoom: nextZoom };
      });
    };

    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelNative);
    };
  }, []);

  const fitMapToViewport = useCallback(
    (target: PmsMapData, vw = viewportSize.width, vh = viewportSize.height) => {
      const b = target.polyBounds;
      const padX = Math.max(80, b.width * 0.08);
      const padY = Math.max(80, b.height * 0.12);
      const totalW = Math.max(16, b.width + padX * 2);
      const totalH = Math.max(16, b.height + padY * 2);
      const fitZoom = Math.min(Math.max(1, vw) / totalW, Math.max(1, vh) / totalH);

      setTransform({
        centerX: clampCoord((b.left + b.right) * 0.5),
        centerY: clampCoord((b.top + b.bottom) * 0.5),
        zoom: Math.max(0.02, Math.min(4.0, fitZoom)),
      });
    },
    [viewportSize.width, viewportSize.height]
  );

  // Load map onto GPU (preserve camera when toggling Classic 1.6 vs HD or toggling Live _f Preview on the same map!)
  useEffect(() => {
    if (!mapData || !rendererRef.current) {
      setMapReadyOnGpu(false);
      prevMapIdentityRef.current = null;
      return;
    }
    let cancelled = false;
    const mapIdentity = mapKey ?? `${mapData.mapName}:${mapData.polygons.length}`;
    const isDifferentMap = prevMapIdentityRef.current !== mapIdentity;
    prevMapIdentityRef.current = mapIdentity;

    if (isDifferentMap) {
      setMapReadyOnGpu(false);
      setRuler(null);
      fitMapToViewport(mapData);
    } else if (
      rendererRef.current.updateMapFast(mapData, { preferClassicBmp: layers.preferClassicBmp })
    ) {
      gpuMapRef.current = mapData;
      setMapReadyOnGpu(true);
      return;
    }

    gpuMapRef.current = null;
    rendererRef.current
      .loadMap(mapData, { preferClassicBmp: layers.preferClassicBmp })
      .then((applied) => {
        // `applied` is false when a newer map load superseded this one (fast keyboard navigation)
        if (!cancelled && applied) {
          gpuMapRef.current = mapData;
          setMapReadyOnGpu(true);
          if (!isDifferentMap && rendererRef.current) {
            setTransform((t) => ({ ...t }));
          }
        }
      })
      .catch((err) => {
        console.warn('[MapViewport] Błąd ładowania mapy na GPU:', err);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData, mapKey, layers.preferClassicBmp, glRestoreTick]);

  // Compute current world camera bounds
  const currentWorldBounds = useMemo(() => {
    const safeZoom = Math.max(0.02, transform.zoom || 0.5);
    const halfW = Math.max(1, viewportSize.width) / (2 * safeZoom);
    const halfH = Math.max(1, viewportSize.height) / (2 * safeZoom);
    const cx = clampCoord(transform.centerX);
    const cy = clampCoord(transform.centerY);
    return {
      left: cx - halfW,
      right: cx + halfW,
      top: cy - halfH,
      bottom: cy + halfH,
    };
  }, [viewportSize.width, viewportSize.height, transform]);

  // Outlines are only meaningful while mapData has the file's prop order (not for an `_o` preview)
  const issueOverlay = useMemo(() => {
    if (!prefs.showFixIssues || previewModeBanner || !mapData || !fixAnalysis?.analysis) return null;
    if (fixAnalysis.key !== analysisKey) return null;
    const outlines: number[][] = [];
    const byProp = new Map<number, SceneryFixIssueGroup>();
    for (const issue of fixAnalysis.analysis.issues) {
      for (const idx of issue.propIndices) {
        const p = mapData.props[idx];
        if (!p || byProp.has(idx)) continue;
        byProp.set(idx, issue);
        outlines.push(Array.from(computePropCorners(p.x, p.y, p.width, p.height, p.scaleX, p.scaleY, p.rotation)));
      }
    }
    return { outlines, byProp };
  }, [prefs.showFixIssues, previewModeBanner, mapData, fixAnalysis, analysisKey]);

  // Render WebGL2 + 2D Tactical Overlay whenever camera, layers, or map changes
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    const ovCanvas = overlayCanvasRef.current;
    const renderer = rendererRef.current;
    if (!glCanvas || !ovCanvas || !renderer) return;

    const vw = Math.max(1, viewportSize.width);
    const vh = Math.max(1, viewportSize.height);
    const dpr = window.devicePixelRatio || 1;
    const safeScale = Math.min(dpr, MAX_INTERACTIVE_FB_DIM / vw, MAX_INTERACTIVE_FB_DIM / vh);
    const pixelW = Math.max(1, Math.round(vw * safeScale));
    const pixelH = Math.max(1, Math.round(vh * safeScale));

    if (glCanvas.width !== pixelW || glCanvas.height !== pixelH) {
      glCanvas.width = pixelW;
      glCanvas.height = pixelH;
    }
    if (ovCanvas.width !== pixelW || ovCanvas.height !== pixelH) {
      ovCanvas.width = pixelW;
      ovCanvas.height = pixelH;
    }

    if (mapData && mapReadyOnGpu) {
      if (prefs.showMinimap && gpuMapRef.current === mapData) {
        const key = [
          layers.showBackground,
          layers.showPolygons,
          layers.showSmoothEdges,
          layers.showSceneryBack,
          layers.showSceneryMid,
          layers.showSceneryFront,
          layers.preferClassicBmp,
          glRestoreTick,
        ].join('|');
        const src = minimapSourceRef.current;
        if (src.data !== mapData || src.key !== key) {
          const now = performance.now();
          const shouldThrottle =
            Boolean(editorBridge?.active) &&
            src.geo !== null &&
            src.key === key &&
            now - src.capturedAt < 250;

          if (shouldThrottle) {
            if (minimapTrailingTimerRef.current === null) {
              minimapTrailingTimerRef.current = window.setTimeout(() => {
                minimapTrailingTimerRef.current = null;
                setMinimapRefreshTick((t) => t + 1);
              }, 260);
            }
          } else {
            if (minimapTrailingTimerRef.current !== null) {
              window.clearTimeout(minimapTrailingTimerRef.current);
              minimapTrailingTimerRef.current = null;
            }
            // One extra frame of the whole map, copied before the real view is drawn in the same task
            const geo = computeMinimapGeometry(mapData);
            renderer.render(geo.bounds, { ...layers, frontSceneryOpacity: 1 });
            const img = minimapImageRef.current ?? document.createElement('canvas');
            minimapImageRef.current = img;
            img.width = geo.w * 2;
            img.height = geo.h * 2;
            img.getContext('2d')?.drawImage(glCanvas, 0, 0, img.width, img.height);
            minimapSourceRef.current = { data: mapData, key, geo, capturedAt: now };
            setMinimapVersion((v) => v + 1);
          }
        }
      }
      renderer.render(currentWorldBounds, layers);
      const ctx = ovCanvas.getContext('2d');
      if (ctx) {
        // Markers and labels are sized in CSS pixels, so they stay readable on 125–200 % display scaling
        ctx.setTransform(pixelW / vw, 0, 0, pixelH / vh, 0, 0);
        renderMapOverlays(ctx, vw, vh, mapData, {
          bounds: currentWorldBounds,
          layers,
          sprites,
          ruler,
          highlightOutline:
            !editorBridge?.active && inspection ? inspection.hits[inspection.selected]?.outline ?? null : null,
          issueOutlines: !editorBridge?.active ? issueOverlay?.outlines ?? null : null,
        });
        if (editorBridge?.active) {
          editorBridge.renderOverlay(ctx, vw, vh, currentWorldBounds);
        }
      }
      const cmpRenderer = compareRendererRef.current;
      const cmpCanvas = compareCanvasRef.current;
      if (compare && compareReady && cmpRenderer && cmpCanvas) {
        if (cmpCanvas.width !== pixelW || cmpCanvas.height !== pixelH) {
          cmpCanvas.width = pixelW;
          cmpCanvas.height = pixelH;
        }
        cmpRenderer.render(currentWorldBounds, layers);
      }
    } else {
      const ctx = ovCanvas.getContext('2d');
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      ctx?.clearRect(0, 0, pixelW, pixelH);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewportSize,
    currentWorldBounds,
    layers,
    mapData,
    mapReadyOnGpu,
    sprites,
    ruler,
    inspection,
    issueOverlay,
    prefs.showMinimap,
    minimapRefreshTick,
    compare,
    compareReady,
    editorBridge?.active,
    editorBridge?.overlayRevision,
    editorBridge?.renderOverlay,
  ]);

  // Minimap: snapshot + rectangle of the current camera view
  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    const src = minimapSourceRef.current;
    const img = minimapImageRef.current;
    if (!prefs.showMinimap || !canvas || !img || !src.geo || (!editorBridge?.active && src.data !== mapData)) return;
    const { bounds: b, w, h } = src.geo;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const sx = w / (b.right - b.left);
    const sy = h / (b.bottom - b.top);
    const x = (currentWorldBounds.left - b.left) * sx;
    const y = (currentWorldBounds.top - b.top) * sy;
    const rw = (currentWorldBounds.right - currentWorldBounds.left) * sx;
    const rh = (currentWorldBounds.bottom - currentWorldBounds.top) * sy;
    ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
    ctx.fillRect(x, y, rw, rh);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#34d399';
    ctx.strokeRect(x, y, rw, rh);
  }, [prefs.showMinimap, minimapVersion, currentWorldBounds, mapData, mapReadyOnGpu]);

  const moveCameraFromMinimap = (clientX: number, clientY: number) => {
    const canvas = minimapCanvasRef.current;
    const geo = minimapSourceRef.current.geo;
    if (!canvas || !geo) return;
    const rect = canvas.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const b = geo.bounds;
    setTransform((t) => ({
      ...t,
      centerX: clampCoord(b.left + fx * (b.right - b.left)),
      centerY: clampCoord(b.top + fy * (b.bottom - b.top)),
    }));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (minimapDragRef.current) moveCameraFromMinimap(e.clientX, e.clientY);
      if (splitDragRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setSplitPct(Math.min(98, Math.max(2, ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100)));
      }
    };
    const onUp = () => {
      minimapDragRef.current = false;
      splitDragRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Convert client mouse event to Soldat world (X, Y)
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const safeZoom = Math.max(0.02, transform.zoom || 0.5);
      return {
        x: currentWorldBounds.left + localX / safeZoom,
        y: currentWorldBounds.top + localY / safeZoom,
      };
    },
    [currentWorldBounds, transform.zoom]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest('[data-map-ui]')) return; // clicks inside floating panels
    if (e.button === 1) e.preventDefault(); // Middle-button pan must not start the browser autoscroll

    if (editorBridgeRef.current?.active) {
      // A dock field that applies its value when it loses focus must do that before this press acts on the map
      // (otherwise the value lands on the next selection, or a drag started now overwrites it)
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches('input, textarea, select, [contenteditable="true"]')) {
        focused.blur();
      }
      // A move queued before the press belongs to the hover, not to the drag this press may start
      pendingMoveRef.current = null;
      const w = clientToWorld(e.clientX, e.clientY);
      const safeZoom = Math.max(0.02, transform.zoom || 0.5);
      const handled = editorBridgeRef.current.onPointerDown({
        worldX: w.x,
        worldY: w.y,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        zoom: safeZoom,
      });
      // Another button pressed during a drag (middle to pan) must not swallow the drag's own release
      if (handled) editorPointerPendingRef.current = true;
      if (handled) return;
      if (e.button === 0 && editorBridgeRef.current.wantsNativeRuler()) {
        setRuler({ x1: w.x, y1: w.y, x2: w.x, y2: w.y });
        dragRef.current = {
          mode: 'ruler',
          startClientX: e.clientX,
          startClientY: e.clientY,
          startCenterX: transform.centerX,
          startCenterY: transform.centerY,
        };
        return;
      }
      dragRef.current = {
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCenterX: transform.centerX,
        startCenterY: transform.centerY,
      };
      return;
    }

    if (rulerMode && e.button === 0) {
      const w = clientToWorld(e.clientX, e.clientY);
      setRuler({ x1: w.x, y1: w.y, x2: w.x, y2: w.y });
      dragRef.current = {
        mode: 'ruler',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCenterX: transform.centerX,
        startCenterY: transform.centerY,
      };
      return;
    }

    dragRef.current = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCenterX: transform.centerX,
      startCenterY: transform.centerY,
    };
  };

  // Latest camera values for the rAF-batched mouse handler (avoids stale closures between frames)
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const clientToWorldRef = useRef(clientToWorld);
  clientToWorldRef.current = clientToWorld;
  const pendingMoveRef = useRef<{
    clientX: number;
    clientY: number;
    buttons: number;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  } | null>(null);
  const moveFrameRef = useRef(0);

  // Coarse spatial grid so polygon hover tests only look at nearby triangles instead of all 5000
  const polyHitGrid = useMemo(() => buildPolygonHitGrid(mapData), [mapData]);

  const processPendingMouseMove = () => {
    moveFrameRef.current = 0;
    const ev = pendingMoveRef.current;
    if (!ev) return;
    pendingMoveRef.current = null;

    const w = clientToWorldRef.current(ev.clientX, ev.clientY);
    setCursorWorld(w);
    setFreePlace(ev.shiftKey);

    const activeDrag = dragRef.current;
    if (activeDrag) {
      if (activeDrag.mode === 'pan') {
        const { startClientX, startClientY, startCenterX, startCenterY } = activeDrag;
        const safeZoom = Math.max(0.02, transformRef.current.zoom || 0.5);
        const dx = (ev.clientX - startClientX) / safeZoom;
        const dy = (ev.clientY - startClientY) / safeZoom;
        const nextCenterX = clampCoord(startCenterX - dx);
        const nextCenterY = clampCoord(startCenterY - dy);
        setTransform((prev) => ({
          ...prev,
          centerX: nextCenterX,
          centerY: nextCenterY,
        }));
      } else if (activeDrag.mode === 'ruler') {
        setRuler((prev) => (prev ? { ...prev, x2: w.x, y2: w.y } : null));
      }
      return;
    }

    if (editorBridgeRef.current?.active) {
      editorBridgeRef.current.onPointerMove({
        worldX: w.x,
        worldY: w.y,
        clientX: ev.clientX,
        clientY: ev.clientY,
        buttons: ev.buttons,
        shiftKey: ev.shiftKey,
        altKey: ev.altKey,
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        zoom: Math.max(0.02, transformRef.current.zoom || 0.5),
      });
      setHoverHint(null);
      return;
    }

    // Hover entity / polygon inspector
    if (!mapData) {
      setHoverHint(null);
      return;
    }

    const hitRadius = 14 / Math.max(0.02, transformRef.current.zoom || 0.5);
    for (const sp of mapData.spawnpoints) {
      if (!sp.active) continue;
      if (Math.hypot(sp.x - w.x, sp.y - w.y) <= hitRadius) {
        const meta = SPAWN_TYPES[sp.team];
        setHoverHint(`${meta ? spawnTypeName(meta) : `Spawn Team ${sp.team}`} (${sp.x}, ${sp.y})`);
        return;
      }
    }

    if (layers.showColliders) {
      for (const col of mapData.colliders) {
        if (!col.active) continue;
        if (Math.hypot(col.x - w.x, col.y - w.y) <= Math.max(hitRadius, col.radius * 0.5)) {
          setHoverHint(t('Collider #{n} • Diameter: {d} px', { n: col.index + 1, d: Math.round(col.radius) }));
          return;
        }
      }
    }

    // Candidates are sorted ascending, so walking backwards finds the top-most (last drawn) polygon first
    const candidates = polyHitGrid?.lookup(w.x, w.y) ?? [];
    for (let c = candidates.length - 1; c >= 0; c--) {
      const i = candidates[c];
      const poly = mapData.polygons[i];
      if (pointInTriangle(w.x, w.y, poly.vertices[0], poly.vertices[1], poly.vertices[2])) {
        const pMeta = POLY_TYPES[poly.polyType];
        const bounceInfo =
          poly.polyType === 18 && poly.bounciness > 0
            ? ` ${t('[Bounce: {factor}x]', { factor: poly.bounciness.toFixed(2) })}`
            : '';
        const typeName = pMeta ? polyTypeName(pMeta) : t('Type {n}', { n: poly.polyType });
        setHoverHint(`${t('Polygon #{n}: {type}', { n: i + 1, type: typeName })}${bounceInfo}`);
        return;
      }
    }

    setHoverHint(null);
  };
  const processPendingMouseMoveRef = useRef(processPendingMouseMove);
  processPendingMouseMoveRef.current = processPendingMouseMove;

  // Mouse moves are coalesced to one state update per animation frame (pan + hover + cursor HUD)
  const handleMouseMove = (e: React.MouseEvent) => {
    pendingMoveRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      buttons: e.buttons,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
    if (!moveFrameRef.current) {
      moveFrameRef.current = requestAnimationFrame(() => processPendingMouseMoveRef.current());
    }
  };

  useEffect(() => {
    return () => {
      if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current);
    };
  }, []);

  /**
   * Where the tools go for a cursor point: the soldier stands on the first floor below it (or exactly there with
   * Shift / without a floor in reach) and the player's view is centred on the soldier, or on the cursor alone.
   */
  const placeTools = (x: number, y: number, free: boolean) => {
    let soldier: { x: number; y: number } | null = null;
    if (prefs.showSoldier) {
      const floor = !free && mapData ? findFloorBelow(mapData, x, y, SOLDIER_MAX_DROP) : null;
      soldier = { x, y: floor ?? y };
    }
    const view = prefs.showPlayerView
      ? soldier
        ? { x: soldier.x, y: soldier.y - SOLDIER_CAMERA_HEIGHT }
        : { x, y }
      : null;
    return { soldier, view };
  };

  /**
   * Fills the object inspector for a world point. Sceneries that are transparent at that point (the empty parts
   * of a large image) are moved below the objects actually visible there once their pixels are checked.
   */
  const runPick = (wx: number, wy: number, filter: PickFilter, keepOpen = false) => {
    if (!mapData) return;
    const hits = collectInspectHits(mapData, wx, wy, layers, polyHitGrid, filter);
    if (issueOverlay) {
      for (const hit of hits) {
        const issue = hit.kind === 'prop' ? issueOverlay.byProp.get(hit.index) : undefined;
        if (issue) {
          hit.details.push([
            t('1.7.1 issue'),
            `${issue.reasonLabelPl}: ${issue.pmsWidth}×${issue.pmsHeight} → ${issue.expectedWidth}×${issue.expectedHeight}`,
          ]);
        }
      }
    }
    const token = ++pickTokenRef.current;
    setInspection(hits.length > 0 || keepOpen ? { worldX: wx, worldY: wy, hits, selected: 0 } : null);
    if (hits.length === 0) return;
    void orderBySeeThrough(mapData, hits, wx, wy, transform.zoom, layers.preferClassicBmp).then((ordered) => {
      if (!ordered || pickTokenRef.current !== token) return;
      setInspection((prev) => {
        if (!prev || prev.hits !== hits) return prev;
        const keep = prev.pickedByUser ? prev.hits[prev.selected] : null;
        const idx = keep ? ordered.findIndex((h) => h.kind === keep.kind && h.index === keep.index) : 0;
        return { ...prev, hits: ordered, selected: Math.max(0, idx) };
      });
    });
  };

  // A left click without dragging opens the object inspector for everything under the cursor
  const handleMouseUp = (e?: React.MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (editorBridgeRef.current?.active) {
      if (!editorPointerPendingRef.current) return;
      editorPointerPendingRef.current = false;
      const w = e ? clientToWorld(e.clientX, e.clientY) : cursorWorld ?? { x: 0, y: 0 };
      editorBridgeRef.current.onPointerUp({
        worldX: w.x,
        worldY: w.y,
        clientX: e?.clientX ?? 0,
        clientY: e?.clientY ?? 0,
        button: e?.button ?? 0,
        shiftKey: Boolean(e?.shiftKey),
        altKey: Boolean(e?.altKey),
        ctrlKey: Boolean(e?.ctrlKey),
        metaKey: Boolean(e?.metaKey),
        zoom: Math.max(0.02, transform.zoom || 0.5),
      });
      return;
    }
    if (!e || !drag || drag.mode !== 'pan' || e.button !== 0 || !mapData) return;
    if (Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 4) return;
    // Player view / soldier tools: a click leaves them on the map instead of opening the inspector
    if (prefs.showPlayerView || prefs.showSoldier) {
      const w = clientToWorld(e.clientX, e.clientY);
      const placed = placeTools(w.x, w.y, e.shiftKey);
      const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      const added: MapPin[] = [];
      if (placed.view) added.push({ id: `${id}v`, kind: 'view', x: placed.view.x, y: placed.view.y, aspect: prefs.playerAspect });
      if (placed.soldier) added.push({ id: `${id}s`, kind: 'soldier', x: placed.soldier.x, y: placed.soldier.y });
      updatePins((prev) => [...prev, ...added]);
      return;
    }
    // Clicking the same spot again walks down through everything under the cursor
    const last = lastPickRef.current;
    lastPickRef.current = { clientX: e.clientX, clientY: e.clientY };
    if (inspection && inspection.hits.length > 1 && last && Math.hypot(e.clientX - last.clientX, e.clientY - last.clientY) <= 5) {
      setInspection((prev) =>
        prev ? { ...prev, selected: (prev.selected + 1) % prev.hits.length, pickedByUser: true } : prev
      );
      return;
    }
    const w = clientToWorld(e.clientX, e.clientY);
    runPick(w.x, w.y, prefs.pickFilter);
  };

  // Compute entity summary & special poly legend directly from parsed PMS mapData
  const { entitySummary, presentSpecialPolyTypes } = useMemo(() => {
    if (!mapData) {
      return {
        entitySummary: { flags: 0, spawns: 0, bonuses: 0, colliders: 0, specialPolys: 0 },
        presentSpecialPolyTypes: [],
      };
    }

    let flags = 0;
    let spawns = 0;
    let bonuses = 0;
    for (const sp of mapData.spawnpoints) {
      if (!sp.active) continue;
      const meta = SPAWN_TYPES[sp.team];
      if (!meta) continue;
      if (meta.category === 'flag') flags++;
      else if (meta.category === 'spawn') spawns++;
      else bonuses++;
    }

    let specialPolys = 0;
    const polyCounts = new Map<number, number>();
    for (const p of mapData.polygons) {
      if (POLY_TYPES[p.polyType]?.isSpecial) {
        specialPolys++;
        polyCounts.set(p.polyType, (polyCounts.get(p.polyType) || 0) + 1);
      }
    }

    const legend = Array.from(polyCounts.entries())
      .map(([pt, count]) => ({ meta: POLY_TYPES[pt], count }))
      .filter((x) => Boolean(x.meta))
      .sort((a, b) => b.count - a.count);

    let activeCols = 0;
    for (const c of mapData.colliders) {
      if (c.active) activeCols++;
    }

    return {
      entitySummary: {
        flags,
        spawns,
        bonuses,
        colliders: activeCols,
        specialPolys,
      },
      presentSpecialPolyTypes: legend,
    };
  }, [mapData]);

  const toggleLayer = (key: keyof RenderLayerVisibility) => {
    onChangeLayers({
      ...layers,
      [key]: !layers[key],
    });
  };

  const cycleFrontSceneryMode = () => {
    if (!layers.showSceneryFront) {
      onChangeLayers({ ...layers, showSceneryFront: true, frontSceneryOpacity: 1.0 });
    } else if (layers.frontSceneryOpacity > 0.6) {
      onChangeLayers({ ...layers, showSceneryFront: true, frontSceneryOpacity: 0.35 });
    } else {
      onChangeLayers({ ...layers, showSceneryFront: false, frontSceneryOpacity: 1.0 });
    }
  };

  const toggleAllTactical = () => {
    const anyOn =
      layers.showFlags || layers.showSpawns || layers.showBonuses || layers.showColliders;
    onChangeLayers({
      ...layers,
      showFlags: !anyOn,
      showSpawns: !anyOn,
      showBonuses: !anyOn,
      showColliders: !anyOn,
    });
  };

  // The canvas renders in device pixels; past `quality` device px per world unit a baked layer is only enlarged
  const devicePxPerUnit = transform.zoom * (window.devicePixelRatio || 1);
  const layerZoomHint =
    previewModeBanner && previewLayerQuality && devicePxPerUnit > previewLayerQuality * 1.15
      ? {
          zoom: Math.round(transform.zoom * 100),
          q: previewLayerQuality,
          game: Math.round((GAME_PX_PER_UNIT_1080P / (window.devicePixelRatio || 1)) * 100),
        }
      : null;

  return (
    <main className="flex-1 min-w-0 relative bg-zinc-950 flex flex-col h-full overflow-hidden select-none">
      {/* Top Floating Layer & Tactical Toolbar */}
      <div className="z-20 bg-zinc-900/95 border-b border-zinc-800 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* Classic Layers Group */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mr-0.5">
            {t('View:')}
          </span>
          <LayerChip
            active={layers.showBackground}
            onClick={() => toggleLayer('showBackground')}
            label={t('Background')}
            title={t('Map background gradient')}
          />
          <LayerChip
            active={layers.showPolygons}
            onClick={() => toggleLayer('showPolygons')}
            label={t('Polygons')}
            title={t('Terrain textures and geometry')}
          />
          <LayerChip
            active={layers.showSmoothEdges}
            onClick={() => toggleLayer('showSmoothEdges')}
            icon={<Sparkles className="w-3 h-3 text-emerald-400" />}
            label={t('Edges')}
            title={t('OpenSoldat smoothed terrain edges (textures/edges/)')}
          />
          <LayerChip
            active={layers.showSceneryBack}
            onClick={() => toggleLayer('showSceneryBack')}
            label={t('Back scenery')}
            title={t('Sceneries on layer 0 (behind the player)')}
          />
          <LayerChip
            active={layers.showSceneryMid}
            onClick={() => toggleLayer('showSceneryMid')}
            label={t('Mid scenery')}
            title={t('Sceneries on layer 1 (in front of the player, behind polygons)')}
          />
          <button
            type="button"
            onClick={cycleFrontSceneryMode}
            title={t('Click to cycle cover (front sceneries): full 100% -> X-ray 35% -> hidden')}
            className={`px-2 py-1 rounded text-xs font-medium border transition-colors flex items-center gap-1 cursor-pointer ${
              !layers.showSceneryFront
                ? 'bg-zinc-900 text-zinc-500 border-zinc-800'
                : layers.frontSceneryOpacity < 1
                ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                : 'bg-emerald-500/15 text-emerald-200 border-emerald-500/35'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            {!layers.showSceneryFront
              ? t('Cover: off')
              : layers.frontSceneryOpacity < 1
              ? t('Cover: X-ray')
              : t('Front scenery')}
          </button>

          <LayerChip
            active={layers.preferClassicBmp}
            onClick={() => toggleLayer('preferClassicBmp')}
            icon={<History className="w-3 h-3 text-amber-400" />}
            label={layers.preferClassicBmp ? 'BMP 1.6' : 'HD PNG'}
            title={t('Switch between OpenSoldat HD textures (.png) and classic Soldat 1.6 textures (.bmp)')}
            accent="amber"
          />

          <LayerChip
            active={layers.pixelatedFilter}
            onClick={() => toggleLayer('pixelatedFilter')}
            label={t('Pixels')}
            title={t('Sharp GL_NEAREST pixel filtering (no blur when zoomed in)')}
          />

          <div className="w-px h-4 bg-zinc-800 mx-0.5" />

          {/* Tactical Overlays */}
          <LayerChip
            active={layers.showFlags}
            onClick={() => toggleLayer('showFlags')}
            icon={<Flag className="w-3.5 h-3.5 text-red-400" />}
            label={t('Flags')}
            badge={entitySummary.flags}
            accent="rose"
          />
          <LayerChip
            active={layers.showSpawns}
            onClick={() => toggleLayer('showSpawns')}
            icon={<Users className="w-3.5 h-3.5 text-sky-400" />}
            label={t('Spawn points')}
            badge={entitySummary.spawns}
            accent="sky"
          />
          <LayerChip
            active={layers.showBonuses}
            onClick={() => toggleLayer('showBonuses')}
            icon={<Gift className="w-3.5 h-3.5 text-emerald-400" />}
            label={t('Bonuses')}
            badge={entitySummary.bonuses}
            accent="emerald"
          />
          <LayerChip
            active={layers.showColliders}
            onClick={() => toggleLayer('showColliders')}
            icon={<CircleDot className="w-3.5 h-3.5 text-cyan-400" />}
            label={t('Colliders')}
            badge={entitySummary.colliders}
            accent="cyan"
          />
          <LayerChip
            active={layers.showPolyTypes}
            onClick={() => toggleLayer('showPolyTypes')}
            icon={<ShieldAlert className="w-3.5 h-3.5 text-amber-400" />}
            label={t('Poly physics')}
            badge={entitySummary.specialPolys}
            accent="amber"
          />
          <LayerChip
            active={layers.showWireframe}
            onClick={() => toggleLayer('showWireframe')}
            label={t('Wireframe')}
            title={t('Triangle mesh (wireframe)')}
          />
          <LayerChip
            active={layers.showWaypoints}
            onClick={() => toggleLayer('showWaypoints')}
            icon={<Bot className="w-3.5 h-3.5 text-yellow-400" />}
            label={t('Bots')}
            badge={mapEntry?.activeWaypointCount}
          />
          <LayerChip
            active={layers.showGrid}
            onClick={() => toggleLayer('showGrid')}
            icon={<Grid className="w-3.5 h-3.5 text-zinc-400" />}
            label={t('Sectors')}
          />
          <LayerChip
            active={prefs.showFixIssues}
            onClick={() => setPrefs((p) => ({ ...p, showFixIssues: !p.showFixIssues }))}
            icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
            label={t('1.7.1 issues')}
            title={
              previewModeBanner
                ? t('1.7.1 issue outlines are not available in preview mode')
                : t('Outline sceneries with wrong sizes after moving to Soldat 1.7.1 (what _f fixes)')
            }
            badge={issueOverlay?.byProp.size}
            accent="amber"
          />

          <button
            type="button"
            onClick={toggleAllTactical}
            className="ml-0.5 px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
            title={t('Toggle all objects (flags + spawn points + bonuses + colliders)')}
          >
            {t('All objects')}
          </button>
        </div>

        {/* Primary Actions: Workshop (_f / _o) + 100% Full Size Screenshot */}
        <div className="flex items-center gap-1.5 shrink-0">
          {compare ? (
            <button
              type="button"
              onClick={() => onStopCompare?.()}
              title={t('End the comparison of two map versions')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer shrink-0"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t('End comparison')}</span>
            </button>
          ) : (
            (compareCandidates.length > 0 || onCompareWithOriginal) &&
            onStartCompare && (
              <div className="relative" data-compare-menu>
                <button
                  type="button"
                  onClick={(e) => {
                    if (compareMenuOpen) {
                      setCompareMenuPos(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const menuWidth = 256;
                    setCompareMenuPos({
                      left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth)),
                      top: rect.bottom + 4,
                    });
                  }}
                  aria-expanded={compareMenuOpen}
                  title={t('Compare with another version of this map (slider)')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-sky-500/40 text-sky-100 text-xs font-semibold cursor-pointer shrink-0"
                >
                  <Columns2 className="w-3.5 h-3.5 text-sky-300" />
                  <span className="hidden xl:inline">{t('Compare')}</span>
                </button>
                {/* In <body>: inside the toolbar's stacking context the preview banner below would cover it */}
                {compareMenuPos &&
                  createPortal(
                  <div
                    data-compare-menu
                    className="fixed z-50 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 text-xs"
                    style={{ left: compareMenuPos.left, top: compareMenuPos.top }}
                  >
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
                      {t('Compare with (on the right)')}
                    </div>
                    {onCompareWithOriginal && (
                      <button
                        type="button"
                        onClick={() => {
                          setCompareMenuOpen(false);
                          onCompareWithOriginal();
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-100 cursor-pointer"
                      >
                        {t("This map's original (before changes)")}
                      </button>
                    )}
                    {compareCandidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCompareMenuOpen(false);
                          onStartCompare(c.id);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 font-mono text-zinc-100 truncate cursor-pointer"
                      >
                        {c.baseName}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
            )
          )}
          {!editorBridge?.active && onEditCurrentMap && (
            <button
              type="button"
              onClick={onEditCurrentMap}
              disabled={!mapData}
              title={t('Open this map in the interactive Map Editor')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-950/50 disabled:opacity-40 transition-all cursor-pointer shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{t('Edit map')}</span>
            </button>
          )}
          {!editorBridge?.active && onOpenWorkshopModal && (
            <button
              type="button"
              onClick={() => onOpenWorkshopModal('fix')}
              disabled={!actionsEnabled}
              title={t(
                'Fix sceneries stretched by Soldat 1.7.1 (_f.pms) or merge scenery layers with Optimize Sceneries (_o.pms)'
              )}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-950/50 disabled:opacity-40 transition-all cursor-pointer shrink-0"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span className="hidden 2xl:inline">{t('Fix 1.7.1 / Optimize (_f / _o)')}</span>
              <span className="2xl:hidden">_f / _o</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenFullSizeModal}
            disabled={!actionsEnabled}
            title={t('Full-size map screenshot (100% / custom scale)')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-950/50 disabled:opacity-40 transition-all cursor-pointer shrink-0"
          >
            <Camera className="w-4 h-4" />
            <span className="hidden 2xl:inline">{t('Full-size screenshot (100%)')}</span>
            <span className="2xl:hidden">{t('Screenshot')}</span>
          </button>
        </div>
      </div>

      {/* Live Preview Mode Banner (when inspecting _f Scenery Repair Before/After) */}
      {previewModeBanner && (
        <div className="z-20 bg-amber-950/90 border-b border-amber-500/50 px-4 py-1.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2 font-medium min-w-0">
            <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              {previewModeBanner}
              {layerZoomHint && (
                <span className="block font-normal text-amber-300/90">
                  {t(
                    'At {zoom}% the {q}× layers are enlarged beyond their resolution and look softer than HD sceneries. In game (about {game}% here) they look as the report says.',
                    layerZoomHint
                  )}{' '}
                  <button
                    type="button"
                    onClick={() => setTransform((p) => ({ ...p, zoom: GAME_PX_PER_UNIT_1080P / (window.devicePixelRatio || 1) }))}
                    title={t('Zoom to the in-game scale at 1080p')}
                    className="underline decoration-dotted hover:text-amber-100 cursor-pointer"
                  >
                    {t('Game scale')}
                  </button>
                </span>
              )}
            </span>
          </div>
          {onClearPreviewMode && (
            <button
              type="button"
              onClick={onClearPreviewMode}
              className="px-2.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-amber-100 font-semibold cursor-pointer"
            >
              {t('Back to original')}
            </button>
          )}
        </div>
      )}

      {/* Canvas Viewport Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp();
          pendingMoveRef.current = null; // a queued frame must not resurrect the HUD after leaving
          setCursorWorld(null);
          setHoverHint(null);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-map-ui]')) return;
          if (editorBridge?.active) {
            const w = clientToWorld(e.clientX, e.clientY);
            editorBridge.onDoubleClick({
              worldX: w.x,
              worldY: w.y,
              zoom: Math.max(0.02, transform.zoom || 0.5),
            });
            return;
          }
          if (mapData) fitMapToViewport(mapData);
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-map-ui]')) return;
          if (editorBridge?.active) {
            const w = clientToWorld(e.clientX, e.clientY);
            if (
              editorBridge.onContextMenu({
                worldX: w.x,
                worldY: w.y,
                zoom: Math.max(0.02, transform.zoom || 0.5),
              })
            ) {
              e.preventDefault();
            }
          }
        }}
        style={
          editorBridge?.active && editorBridge.cursorStyle
            ? { cursor: editorBridge.cursorStyle }
            : undefined
        }
        className={`flex-1 relative overflow-hidden ${
          rulerMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        <canvas ref={glCanvasRef} className="absolute inset-0 w-full h-full block" />
        {compare && (
          <canvas
            key={`${compare.key}|${layers.preferClassicBmp}`}
            ref={compareCanvasRef}
            className="absolute inset-0 w-full h-full block pointer-events-none"
            style={{ clipPath: `inset(0 0 0 ${splitPct}%)` }}
          />
        )}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full block pointer-events-none"
        />

        {/* Loading / Error Overlays */}
        {loading && (
          <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px] flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-zinc-900 border border-zinc-700 px-4 py-2 rounded-lg text-xs text-zinc-200 shadow-xl">
              {t('Loading the map and textures onto the GPU...')}
            </div>
          </div>
        )}

        {contextLost && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-amber-950/90 border border-amber-700 px-5 py-3 rounded-lg text-xs text-amber-100 max-w-md text-center">
              {t(
                'The graphics card reset the WebGL2 context — trying to recover. If the view does not come back, reload the page (F5).'
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-red-950/90 border border-red-700 px-5 py-3 rounded-lg text-xs text-red-200 max-w-md text-center">
              {error}
            </div>
          </div>
        )}

        {/* Active Map Floating Header Badge */}
        {!editorBridge?.active && mapEntry && (
          <div className="absolute top-3 left-3 z-10 pointer-events-none bg-zinc-950/80 backdrop-blur-md border border-zinc-800/90 rounded-lg px-3 py-1.5 shadow-lg">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: mapEntry.badgeColor }}
              />
              <span className="font-mono text-sm font-bold text-zinc-100">
                {mapEntry.baseName}
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                ({Math.round(mapEntry.polyBounds.width)} × {Math.round(mapEntry.polyBounds.height)} px)
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300">
                {tText(mapEntry.modeGroupName)}
              </span>
            </div>
            {mapEntry.title && mapEntry.title.toLowerCase() !== mapEntry.baseName.toLowerCase() && (
              <div className="text-[11px] text-zinc-400 truncate max-w-sm mt-0.5">{mapEntry.title}</div>
            )}
          </div>
        )}

        {/* Special Polygon Types Legend when showPolyTypes is enabled */}
        {layers.showPolyTypes && presentSpecialPolyTypes.length > 0 && (
          <div className="absolute top-3 right-3 z-10 pointer-events-none bg-zinc-950/85 backdrop-blur-md border border-zinc-800 rounded-lg p-2.5 shadow-lg max-w-60">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              {t('Polygon types on the map')}
            </div>
            <div className="space-y-1">
              {presentSpecialPolyTypes.map(({ meta, count }) => (
                <div key={meta.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5 text-zinc-200 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="truncate">{polyTypeName(meta)}</span>
                  </span>
                  <span className="font-mono text-zinc-400 text-[10px]">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compare divider: left = current map, right = compared version */}
        {compare && (
          <div className="absolute top-0 bottom-0 z-10 w-0" style={{ left: `${splitPct}%` }}>
            <div className="absolute inset-y-0 -left-px w-0.5 bg-white/85 shadow-[0_0_6px_rgba(0,0,0,0.8)] pointer-events-none" />
            <button
              type="button"
              data-map-ui
              onMouseDown={(e) => {
                e.preventDefault();
                splitDragRef.current = true;
              }}
              aria-label={t('Drag to move the comparison divider')}
              title={t('Drag to move the comparison divider')}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 rounded bg-zinc-100 text-zinc-900 text-xs font-bold shadow-lg cursor-ew-resize flex items-center justify-center"
            >
              ⇔
            </button>
            <span className="absolute top-14 right-3 whitespace-nowrap text-[11px] font-mono bg-zinc-950/85 text-zinc-100 px-1.5 py-0.5 rounded pointer-events-none">
              ◀ {mainLabel ?? mapEntry?.baseName ?? t('current map')}
            </span>
            <span className="absolute top-14 left-3 whitespace-nowrap text-[11px] font-mono bg-sky-950/90 text-sky-100 px-1.5 py-0.5 rounded pointer-events-none">
              {compare.label} ▶{!compareReady && ` (${t('loading...')})`}
            </span>
          </div>
        )}

        {/* Frames left on the map with the player view tool */}
        {mapData &&
          pins.map((pin) => {
            if (pin.kind !== 'view') return null;
            const zoom = Math.max(0.02, transform.zoom || 0.5);
            const aspect = pin.aspect ?? prefs.playerAspect;
            const vwPx = PLAYER_VIEW_HEIGHT * aspect * zoom;
            const vhPx = PLAYER_VIEW_HEIGHT * zoom;
            const cx = (pin.x - currentWorldBounds.left) * zoom;
            const cy = (pin.y - currentWorldBounds.top) * zoom;
            if (cx + vwPx / 2 < -40 || cy + vhPx / 2 < -40 || cx - vwPx / 2 > viewportSize.width + 40 || cy - vhPx / 2 > viewportSize.height + 40) {
              return null;
            }
            return (
              <div
                key={pin.id}
                className="absolute z-10 pointer-events-none border-2 border-sky-300/70 rounded-sm"
                style={{ left: cx - vwPx / 2, top: cy - vhPx / 2, width: vwPx, height: vhPx }}
              >
                <span
                  data-map-ui
                  className="absolute -top-5 left-0 flex items-center gap-1 whitespace-nowrap text-[10px] font-mono bg-zinc-950/85 text-sky-200 px-1 rounded pointer-events-auto cursor-default"
                >
                  {t('Player view {w}×{h}', { w: Math.round(PLAYER_VIEW_HEIGHT * aspect), h: PLAYER_VIEW_HEIGHT })}
                  <button
                    type="button"
                    onClick={() => updatePins((prev) => prev.filter((p) => p.id !== pin.id))}
                    title={t('Remove from the map')}
                    aria-label={t('Remove from the map')}
                    className="text-zinc-400 hover:text-red-300 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            );
          })}

        {/* Soldiers at real size: the ones left on the map and the one at the cursor */}
        {mapData && (() => {
          const zoom = Math.max(0.02, transform.zoom || 0.5);
          const placedSoldiers = pins.filter((p) => p.kind === 'soldier');
          const cursorSoldier = prefs.showSoldier && cursorWorld ? placeTools(cursorWorld.x, cursorWorld.y, freePlace).soldier : null;
          if (placedSoldiers.length === 0 && !cursorSoldier) return null;
          const toScreen = (p: { x: number; y: number }) => ({
            x: (p.x - currentWorldBounds.left) * zoom,
            y: (p.y - currentWorldBounds.top) * zoom,
          });
          return (
            <>
              <svg
                className="absolute inset-0 z-10 pointer-events-none"
                width={viewportSize.width}
                height={viewportSize.height}
                aria-hidden="true"
              >
                {placedSoldiers.map((pin) => {
                  const s = toScreen(pin);
                  return <SoldierFigure key={pin.id} x={s.x} y={s.y} zoom={zoom} />;
                })}
                {cursorSoldier && <SoldierFigure x={toScreen(cursorSoldier).x} y={toScreen(cursorSoldier).y} zoom={zoom} ghost />}
              </svg>
              {placedSoldiers.map((pin) => {
                const s = toScreen(pin);
                return (
                  <button
                    key={`${pin.id}-x`}
                    type="button"
                    data-map-ui
                    onClick={() => updatePins((prev) => prev.filter((p) => p.id !== pin.id))}
                    title={t('Remove from the map')}
                    aria-label={t('Remove from the map')}
                    className="absolute z-10 w-4 h-4 -translate-x-1/2 rounded-full bg-zinc-950/80 text-zinc-300 opacity-60 hover:opacity-100 hover:text-red-300 flex items-center justify-center cursor-pointer"
                    style={{ left: s.x, top: s.y - SOLDIER_HEIGHT * zoom - 20 }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                );
              })}
              {cursorSoldier && (
                <span
                  className="absolute z-10 pointer-events-none whitespace-nowrap text-[10px] font-mono bg-zinc-950/85 text-emerald-200 px-1 rounded"
                  style={{ left: toScreen(cursorSoldier).x + SOLDIER_RIGHT * zoom + 6, top: toScreen(cursorSoldier).y - SOLDIER_HEIGHT * zoom }}
                >
                  {t('Soldier {w}×{h} units • collides as {cw}×{ch}', {
                    w: 14,
                    h: 24,
                    cw: SOLDIER_COLLISION.halfWidth * 2,
                    ch: SOLDIER_COLLISION.height,
                  })}
                </span>
              )}
            </>
          );
        })()}

        {/* Player view: what a player at the cursor (or at the soldier) sees — 480 units high, width from aspect */}
        {prefs.showPlayerView && cursorWorld && mapData && (() => {
          const zoom = Math.max(0.02, transform.zoom || 0.5);
          const centre = placeTools(cursorWorld.x, cursorWorld.y, freePlace).view ?? cursorWorld;
          const vwPx = PLAYER_VIEW_HEIGHT * prefs.playerAspect * zoom;
          const vhPx = PLAYER_VIEW_HEIGHT * zoom;
          const cx = (centre.x - currentWorldBounds.left) * zoom;
          const cy = (centre.y - currentWorldBounds.top) * zoom;
          return (
            <div
              className="absolute z-10 pointer-events-none border-2 border-dashed border-sky-300/80 rounded-sm shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
              style={{ left: cx - vwPx / 2, top: cy - vhPx / 2, width: vwPx, height: vhPx }}
            >
              <span className="absolute -top-5 left-0 whitespace-nowrap text-[10px] font-mono bg-zinc-950/85 text-sky-200 px-1 rounded">
                {t('Player view {w}×{h}', {
                  w: Math.round(PLAYER_VIEW_HEIGHT * prefs.playerAspect),
                  h: PLAYER_VIEW_HEIGHT,
                })}
              </span>
            </div>
          );
        })()}

        {/* Minimap with the camera rectangle (click or drag to move the view) */}
        {prefs.showMinimap && mapData && mapReadyOnGpu && minimapSourceRef.current.geo && minimapSourceRef.current.data === mapData && (
          <div
            data-map-ui
            className="absolute left-3 bottom-14 z-10 bg-zinc-950/85 border border-zinc-700/80 rounded-md p-1 shadow-lg"
          >
            <canvas
              ref={minimapCanvasRef}
              style={{ width: minimapSourceRef.current.geo.w, height: minimapSourceRef.current.geo.h }}
              className="block cursor-crosshair rounded-sm"
              aria-label={t('Minimap — click to move the view')}
              onMouseDown={(e) => {
                e.preventDefault();
                minimapDragRef.current = true;
                moveCameraFromMinimap(e.clientX, e.clientY);
              }}
            />
          </div>
        )}

        {/* Object Inspector (click on the map without dragging) */}
        {inspection && (
          <div
            data-map-ui
            className="absolute right-3 bottom-14 z-20 w-80 max-h-[55%] flex flex-col bg-zinc-950/95 backdrop-blur-md border border-fuchsia-500/40 rounded-lg shadow-2xl text-xs cursor-default"
          >
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
              <span className="font-semibold text-fuchsia-200">
                {t('Objects at ({x}, {y}) — {count}', {
                  x: Math.round(inspection.worldX),
                  y: Math.round(inspection.worldY),
                  count: inspection.hits.length,
                })}
              </span>
              <button
                type="button"
                onClick={() => setInspection(null)}
                title={t('Close (Esc)')}
                className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center gap-1" title={t('What a click selects')}>
              {PICK_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={prefs.pickFilter === f}
                  onClick={() => {
                    setPrefs((p) => ({ ...p, pickFilter: f }));
                    runPick(inspection.worldX, inspection.worldY, f, true);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer ${
                    prefs.pickFilter === f
                      ? 'bg-fuchsia-500/20 text-fuchsia-100 border-fuchsia-500/40'
                      : 'text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {f === 'all' ? t('All') : f === 'sceneries' ? t('Sceneries') : t('Polygons')}
                </button>
              ))}
            </div>
            <div className="overflow-y-auto divide-y divide-zinc-800/70">
              {inspection.hits.length === 0 && (
                <div className="px-3 py-3 text-zinc-500">{t('Nothing of this kind under the cursor.')}</div>
              )}
              {inspection.hits.map((hit, idx) => {
                const selected = idx === inspection.selected;
                return (
                  <div key={`${hit.kind}-${hit.index}`} className={selected ? 'bg-fuchsia-500/10' : ''}>
                    <button
                      type="button"
                      onClick={() =>
                        setInspection((prev) => (prev ? { ...prev, selected: idx, pickedByUser: true } : prev))
                      }
                      className={`w-full text-left px-3 py-1.5 hover:bg-zinc-900 cursor-pointer ${
                        hit.seeThrough && !selected ? 'opacity-60' : ''
                      }`}
                    >
                      <span className="text-[10px] text-zinc-500 mr-1.5">{idx === 0 ? t('on top') : `#${idx + 1}`}</span>
                      <span className={`font-mono ${selected ? 'text-fuchsia-200' : 'text-zinc-200'}`}>{hit.title}</span>
                      {hit.seeThrough && (
                        <span className="ml-1.5 text-[10px] text-zinc-500">{t('(transparent here)')}</span>
                      )}
                    </button>
                    {selected && (
                      <div className="px-3 pb-2 space-y-0.5">
                        {hit.details.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3">
                            <span className="text-zinc-500 shrink-0">{k}</span>
                            <span className="font-mono text-zinc-200 text-right truncate" title={v}>
                              {v}
                            </span>
                          </div>
                        ))}
                        {hit.sceneryName && inspectFileDims?.name === hit.sceneryName && hit.pmsSize && (
                          <div className="flex justify-between gap-3">
                            <span className="text-zinc-500 shrink-0">{t('Image file')}</span>
                            <span className="font-mono text-zinc-200 text-right">
                              {inspectFileDims.w} × {inspectFileDims.h}
                              {(inspectFileDims.w !== Math.abs(hit.pmsSize[0]) ||
                                inspectFileDims.h !== Math.abs(hit.pmsSize[1])) &&
                                ` ${t('(×{ratio} vs PMS)', {
                                  ratio: (inspectFileDims.w / Math.max(1, Math.abs(hit.pmsSize[0]))).toFixed(2),
                                })}`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-500 leading-snug">
              {t('Click the same spot again or press ↑/↓ to select the object below. Sceneries transparent at this point are listed last.')}
            </div>
          </div>
        )}

        {/* Bottom Floating Camera & Coordinates HUD */}
        <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
          {/* Coordinates & Hover Inspector */}
          <div className="flex items-center gap-2 bg-zinc-950/85 backdrop-blur-md border border-zinc-800 rounded-lg px-3 py-1.5 text-xs shadow-lg">
            <span className="font-mono text-zinc-400">
              {cursorWorld
                ? `X: ${Math.round(cursorWorld.x)}  Y: ${Math.round(cursorWorld.y)}`
                : t('Drag to pan • Scroll to zoom')}
            </span>
            {hoverHint && (
              <>
                <span className="text-zinc-700">|</span>
                <span className="text-emerald-300 font-medium">{hoverHint}</span>
              </>
            )}
          </div>

          {/* Zoom & Ruler Controls */}
          <div
            data-map-ui
            className="flex items-center gap-1 bg-zinc-950/90 backdrop-blur-md border border-zinc-800 rounded-lg p-1 shadow-lg pointer-events-auto shrink-0"
          >
            {/* The editor has its own ruler tool [M]; clicks on the map belong to the editor tools */}
            {!editorBridge?.active && (
              <button
                type="button"
                onClick={() => {
                  setRulerMode((v) => !v);
                  if (rulerMode) setRuler(null);
                }}
                title={t('Distance ruler (click and drag on the map)')}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                  rulerMode
                    ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
                {t('Ruler')}
              </button>
            )}

            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, showPlayerView: !p.showPlayerView }))}
              title={
                editorBridge?.active
                  ? t("Player's view frame at the cursor (Soldat shows 480 units of height)")
                  : t("Player's view frame at the cursor (Soldat shows 480 units of height) — click the map to leave one there")
              }
              aria-pressed={prefs.showPlayerView}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                prefs.showPlayerView
                  ? 'bg-sky-500/25 text-sky-200 border border-sky-500/40'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              {t('Player view')}
            </button>
            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, showSoldier: !p.showSoldier }))}
              title={
                editorBridge?.active
                  ? t('Soldier at real size at the cursor (it stands on the floor below the cursor; hold Shift to see it in the air)')
                  : t('Soldier at real size at the cursor — click the map to leave one (it stands on the floor below the cursor; hold Shift to place it in the air)')
              }
              aria-pressed={prefs.showSoldier}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                prefs.showSoldier
                  ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <PersonStanding className="w-3.5 h-3.5" />
              {t('Soldier')}
            </button>
            {pins.length > 0 && !editorBridge?.active && (
              <button
                type="button"
                onClick={() => updatePins(() => [])}
                title={t('Remove all frames and soldiers left on this map')}
                className="px-1.5 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 hover:text-red-300 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {pins.length}
              </button>
            )}
            {prefs.showPlayerView && (
              <select
                value={String(prefs.playerAspect)}
                onChange={(e) => setPrefs((p) => ({ ...p, playerAspect: Number(e.target.value) }))}
                aria-label={t("Player's screen aspect ratio")}
                className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-200"
              >
                {PLAYER_ASPECTS.map(([label, value]) => (
                  <option key={label} value={String(value)}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, showMinimap: !p.showMinimap }))}
              title={t('Minimap with the view rectangle')}
              aria-label={t('Minimap')}
              aria-pressed={prefs.showMinimap}
              className={`p-1 rounded transition-colors cursor-pointer ${
                prefs.showMinimap ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-800 mx-0.5" />

            <button
              type="button"
              onClick={() =>
                setTransform((p) => ({ ...p, zoom: Math.max(0.02, p.zoom / 1.25) }))
              }
              title={t('Zoom out')}
              className="p-1 rounded text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <span className="font-mono text-xs text-zinc-200 px-1.5 min-w-14 text-center">
              {Math.round(transform.zoom * 100)}%
            </span>

            <button
              type="button"
              onClick={() =>
                setTransform((p) => ({ ...p, zoom: Math.min(16.0, p.zoom * 1.25) }))
              }
              title={t('Zoom in')}
              className="p-1 rounded text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setTransform((p) => ({ ...p, zoom: 1.0 }))}
              title={t('Set the native game scale 100% (1:1 pixel)')}
              className={`px-2 py-1 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                Math.abs(transform.zoom - 1.0) < 0.01
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
              }`}
            >
              100%
            </button>

            <button
              type="button"
              onClick={() => mapData && fitMapToViewport(mapData)}
              title={t('Fit the whole map to the window (double-click)')}
              className="px-2 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 flex items-center gap-1 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {t('Fit')}
            </button>

            <button
              type="button"
              onClick={() => setTransform((p) => ({ ...p, centerX: 0, centerY: 0 }))}
              title={t('Center on point (0, 0)')}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
            >
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};

const LayerChip: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
  icon?: React.ReactNode;
  badge?: number;
  accent?: 'emerald' | 'rose' | 'sky' | 'cyan' | 'amber';
}> = ({ active, onClick, label, title, icon, badge, accent = 'emerald' }) => {
  const activeStyles: Record<string, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
    rose: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
    sky: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
    cyan: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/40',
    amber: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      className={`px-2 py-1 rounded text-xs font-medium border transition-colors flex items-center gap-1 cursor-pointer ${
        active
          ? activeStyles[accent]
          : 'bg-zinc-900/90 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="font-mono text-[10px] px-1 rounded bg-black/35 text-zinc-300">
          {badge}
        </span>
      )}
    </button>
  );
};

/**
 * A standing soldier at real size, as OpenSoldat poses it: the first frame of anims/stoi.poa (file X scaled by
 * -3/1.1, file Z by -3), aimed horizontally to the right, with the +1 unit the game adds when drawing the parts.
 * World units relative to the floor point the soldier stands on (the sprite position is 2 units above it, where
 * its foot probes rest); y grows downwards. The silhouette spans about 14 x 24 units.
 */
const SOLDIER_JOINTS = {
  shoulderR: { x: -2.63, y: -15.66 },
  shoulderL: { x: 2.8, y: -15.06 },
  elbowR: { x: -4.32, y: -14.12 },
  elbowL: { x: 2.38, y: -13.1 },
  handR: { x: -1.69, y: -12.42 },
  handL: { x: 5.31, y: -12.42 },
  hipR: { x: -2.3, y: -9.81 },
  hipL: { x: 1.49, y: -9.39 },
  kneeR: { x: -1.82, y: -4.66 },
  kneeL: { x: 3.95, y: -4.97 },
  ankleR: { x: -4.13, y: -0.94 },
  ankleL: { x: 2.18, y: -0.91 },
  // The foot sprites reach 1.5 units below the floor line, as in the game
  heelR: { x: -4.13, y: 0.26 },
  toeR: { x: -1.4, y: 0.25 },
  heelL: { x: 2.18, y: 0.29 },
  toeL: { x: 4.91, y: 0.22 },
};
const SOLDIER_BONES: Array<[keyof typeof SOLDIER_JOINTS, keyof typeof SOLDIER_JOINTS, number]> = [
  ['hipL', 'kneeL', 3.6],
  ['kneeL', 'ankleL', 3],
  ['heelL', 'toeL', 2.6],
  ['hipR', 'kneeR', 3.6],
  ['kneeR', 'ankleR', 3],
  ['heelR', 'toeR', 2.6],
  ['shoulderL', 'elbowL', 2.6],
  ['elbowL', 'handL', 2.4],
  ['shoulderR', 'elbowR', 2.6],
  ['elbowR', 'handR', 2.4],
];
// Chest (klata) and hip (biodro) sprites as one outline, head (morda) as a circle
const SOLDIER_TORSO = '-3.3,-16.6 3.4,-16 2.4,-8.6 -3,-8.9';
const SOLDIER_HEAD = { x: 0.4, y: -19.6, r: 2.6 };
const SOLDIER_HEIGHT = 22.2; // floor to the top of the head
const SOLDIER_RIGHT = 7.7; // farthest point of the aimed arm
// The camera follows the sprite position (with the cursor in the middle of the screen)
const SOLDIER_CAMERA_HEIGHT = 2;
// A soldier dropped from the cursor lands on a floor at most this far below
const SOLDIER_MAX_DROP = 960;

const SoldierFigure: React.FC<{ x: number; y: number; zoom: number; ghost?: boolean }> = ({ x, y, zoom, ghost }) => {
  const outline = ghost ? 'rgba(6,78,59,0.85)' : 'rgba(9,9,11,0.9)';
  const fill = ghost ? 'rgba(167,243,208,0.9)' : 'rgba(244,244,245,0.95)';
  // Outline about 1.5 screen pixels wide, whatever the zoom
  const rim = 3 / Math.max(0.02, zoom);
  const body = (color: string, extra: number) => (
    <>
      {SOLDIER_BONES.map(([a, b, width]) => (
        <line
          key={`${a}-${b}`}
          x1={SOLDIER_JOINTS[a].x}
          y1={SOLDIER_JOINTS[a].y}
          x2={SOLDIER_JOINTS[b].x}
          y2={SOLDIER_JOINTS[b].y}
          stroke={color}
          strokeWidth={width + extra}
          strokeLinecap="round"
        />
      ))}
      <polygon points={SOLDIER_TORSO} fill={color} stroke={color} strokeWidth={1.6 + extra} strokeLinejoin="round" />
      <circle cx={SOLDIER_HEAD.x} cy={SOLDIER_HEAD.y} r={SOLDIER_HEAD.r + extra / 2} fill={color} />
    </>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${zoom})`}>
      {body(outline, rim)}
      {body(fill, 0)}
      <rect
        x={-SOLDIER_COLLISION.halfWidth}
        y={-SOLDIER_COLLISION.height}
        width={SOLDIER_COLLISION.halfWidth * 2}
        height={SOLDIER_COLLISION.height}
        fill="none"
        stroke={ghost ? 'rgba(251,191,36,0.9)' : 'rgba(251,191,36,0.5)'}
        strokeWidth={1}
        strokeDasharray="3 2"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
};

interface InspectHit {
  kind: 'prop' | 'polygon';
  index: number;
  title: string;
  details: Array<[string, string]>;
  outline: number[];
  sceneryName?: string;
  pmsSize?: [number, number];
  seeThrough?: boolean; // a scenery whose image is transparent at the clicked point
}

const LEVEL_NAMES = [t('Back (0)'), t('Middle (1)'), t('Front (2)')];

// PMS stores radians; shown as degrees in (-180, 180] (e.g. 6.215 rad -> -3.9°)
function radiansToSignedDegrees(rad: number): number {
  const deg = ((((rad * 180) / Math.PI) % 360) + 360) % 360;
  return deg > 180 ? deg - 360 : deg;
}

function toHexColor(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Every visible object under the world point, top-most first, following the game's draw order:
 * front sceneries, front polygons, middle sceneries, back sceneries, background polygons.
 */
function collectInspectHits(
  map: PmsMapData,
  x: number,
  y: number,
  layers: RenderLayerVisibility,
  grid: { lookup: (x: number, y: number) => number[] } | null,
  filter: PickFilter = 'all'
): InspectHit[] {
  const levelVisible = [
    layers.showSceneryBack,
    layers.showSceneryMid,
    layers.showSceneryFront && layers.frontSceneryOpacity > 0.01,
  ].map((visible) => visible && filter !== 'polygons');
  const propHits: InspectHit[][] = [[], [], []];
  for (let i = map.props.length - 1; i >= 0; i--) {
    const p = map.props[i];
    if (!isPropRenderable(p, map.scenery.length) || p.width === 0 || p.height === 0) continue;
    if (!levelVisible[p.level]) continue;
    const c = computePropCorners(p.x, p.y, p.width, p.height, p.scaleX, p.scaleY, p.rotation);
    const inside =
      pointInTriangle(x, y, { x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }) ||
      pointInTriangle(x, y, { x: c[0], y: c[1] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] });
    if (!inside) continue;
    const sc = map.scenery[p.style - 1];
    const tinted = p.color.r !== 255 || p.color.g !== 255 || p.color.b !== 255;
    propHits[p.level].push({
      kind: 'prop',
      index: i,
      // Virtual names of unsaved _o preview tiles are shown without their internal prefix
      title: `${t('Scenery #{n}: {name}', {
        n: i + 1,
        name: sc.filename.replace(/^__preview_[a-z0-9]+__/, '') || t('(unnamed)'),
      })}${sc.filename.startsWith('__preview_') ? ` ${t('(preview)')}` : ''}`,
      sceneryName: sc.filename,
      pmsSize: [p.width, p.height],
      outline: Array.from(c),
      details: [
        [t('Layer'), LEVEL_NAMES[p.level]],
        [t('Size in PMS'), `${p.width} × ${p.height}`],
        [t('Scale'), `${p.scaleX.toFixed(3)} × ${p.scaleY.toFixed(3)}`],
        [
          t('In the game world'),
          t('{w} × {h} units', {
            w: Math.round(Math.abs(p.width * p.scaleX)),
            h: Math.round(Math.abs(p.height * p.scaleY)),
          }),
        ],
        [t('Rotation'), `${radiansToSignedDegrees(p.rotation).toFixed(1)}°`],
        [t('Opacity (alpha)'), `${p.alpha} / 255 (${Math.round(p.alpha / 2.55)}%)`],
        [t('Color'), tinted ? t('{hex} (tint)', { hex: toHexColor(p.color) }) : t('white (no tint)')],
        [t('Position'), `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`],
        [t('Scenery entry'), `#${p.style}`],
      ],
    });
  }

  const polyFront: InspectHit[] = [];
  const polyBack: InspectHit[] = [];
  if (layers.showPolygons && filter !== 'sceneries') {
    const candidates = grid?.lookup(x, y) ?? [];
    for (let k = candidates.length - 1; k >= 0; k--) {
      const i = candidates[k];
      const poly = map.polygons[i];
      const [a, b, c] = poly.vertices;
      if (!pointInTriangle(x, y, a, b, c)) continue;
      const meta = POLY_TYPES[poly.polyType];
      const hit: InspectHit = {
        kind: 'polygon',
        index: i,
        title: t('Polygon #{n}: {type}', {
          n: i + 1,
          type: meta ? polyTypeName(meta) : t('Type {n}', { n: poly.polyType }),
        }),
        outline: [a.x, a.y, b.x, b.y, c.x, c.y],
        details: [
          [t('Type'), `${poly.polyType} (${meta?.nameEn || '?'})`],
          ...poly.vertices.map((v, vi): [string, string] => [
            t('Vertex {n}', { n: vi + 1 }),
            `${v.x.toFixed(1)}, ${v.y.toFixed(1)} • ${toHexColor(v.color)} α${v.color.a}`,
          ]),
          ...(poly.polyType === 18 ? [[t('Bounce'), `${poly.bounciness.toFixed(2)}×`] as [string, string]] : []),
        ],
      };
      (poly.polyType === 24 || poly.polyType === 25 ? polyBack : polyFront).push(hit);
    }
  }

  // Polygons under the point are few: never let a pile of sceneries push them out of the list
  const props = [...propHits[2], ...propHits[1], ...propHits[0]];
  const keptProps = new Set(props.slice(0, Math.max(0, 40 - polyFront.length - polyBack.length)));
  return [...propHits[2], ...polyFront, ...propHits[1], ...propHits[0], ...polyBack].filter(
    (h) => h.kind === 'polygon' || keptProps.has(h)
  );
}

// A scenery counts as visible at a point when its pixel there (times the prop's alpha) reaches this opacity:
// below ~16% a fog or cloud is barely visible and should not hide what is behind it from a click
const SEE_THROUGH_ALPHA = 40;

/**
 * Opacity (0-255) of a prop's image at a world point: the point is mapped into the image through the prop's quad
 * (corner 0 = image top-left, 1 = top-right, 3 = bottom-left) and the most opaque pixel within ~3 screen pixels
 * counts, so thin lines stay clickable.
 */
function propImageAlphaAt(outline: number[], x: number, y: number, img: ProcessedImageAsset, zoom: number): number {
  const ex = outline[2] - outline[0];
  const ey = outline[3] - outline[1];
  const fx = outline[6] - outline[0];
  const fy = outline[7] - outline[1];
  const det = ex * fy - ey * fx;
  if (Math.abs(det) < 1e-9) return 255;
  const dx = x - outline[0];
  const dy = y - outline[1];
  const u = (dx * fy - dy * fx) / det;
  const v = (ex * dy - ey * dx) / det;
  const reach = 3 / Math.max(0.02, zoom);
  const du = reach / Math.max(1e-6, Math.hypot(ex, ey));
  const dv = reach / Math.max(1e-6, Math.hypot(fx, fy));
  let best = 0;
  for (const ou of [-du, 0, du]) {
    for (const ov of [-dv, 0, dv]) {
      const su = Math.min(1, Math.max(0, u + ou));
      const sv = Math.min(1, Math.max(0, v + ov));
      const px = Math.min(img.width - 1, Math.floor(su * img.width));
      const py = Math.min(img.height - 1, Math.floor(sv * img.height));
      const a = img.premultipliedData[(py * img.width + px) * 4 + 3];
      if (a > best) best = a;
    }
  }
  return best;
}

/**
 * The hits with sceneries that are transparent at the point flagged and moved below the visible objects
 * (null when nothing changes). Images come from the renderer's cache, so this normally resolves at once.
 */
async function orderBySeeThrough(
  map: PmsMapData,
  hits: InspectHit[],
  x: number,
  y: number,
  zoom: number,
  preferClassicBmp: boolean
): Promise<InspectHit[] | null> {
  const propHits = hits.filter((h) => h.kind === 'prop' && h.sceneryName);
  if (propHits.length === 0) return null;
  const images = await Promise.all(
    propHits.map((h) => loadSoldatAssetImage('scenery-gfx', h.sceneryName!, true, preferClassicBmp).catch(() => null))
  );
  const seeThrough = new Set<InspectHit>();
  propHits.forEach((h, i) => {
    const img = images[i];
    if (!img) return; // unknown image: keep it where the draw order puts it
    const alpha = (propImageAlphaAt(h.outline, x, y, img, zoom) * map.props[h.index].alpha) / 255;
    if (alpha < SEE_THROUGH_ALPHA) seeThrough.add(h);
  });
  if (seeThrough.size === 0) return null;
  return [
    ...hits.filter((h) => !seeThrough.has(h)),
    ...hits.filter((h) => seeThrough.has(h)).map((h) => ({ ...h, seeThrough: true })),
  ];
}

const HIT_GRID_CELL = 128;

/**
 * Buckets polygon indices by 128-unit cells (each bucket sorted ascending = PMS draw order).
 */
function buildPolygonHitGrid(
  map: PmsMapData | null
): { lookup: (x: number, y: number) => number[] } | null {
  if (!map || map.polygons.length === 0) return null;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < map.polygons.length; i++) {
    const [a, b, c] = map.polygons[i].vertices;
    const minX = Math.floor(Math.min(a.x, b.x, c.x) / HIT_GRID_CELL);
    const maxX = Math.floor(Math.max(a.x, b.x, c.x) / HIT_GRID_CELL);
    const minY = Math.floor(Math.min(a.y, b.y, c.y) / HIT_GRID_CELL);
    const maxY = Math.floor(Math.max(a.y, b.y, c.y) / HIT_GRID_CELL);
    if (!Number.isFinite(minX + maxX + minY + maxY) || (maxX - minX + 1) * (maxY - minY + 1) > 4096) continue;
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const key = `${gx},${gy}`;
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(i);
      }
    }
  }
  return {
    lookup: (x, y) =>
      cells.get(`${Math.floor(x / HIT_GRID_CELL)},${Math.floor(y / HIT_GRID_CELL)}`) ?? [],
  };
}
