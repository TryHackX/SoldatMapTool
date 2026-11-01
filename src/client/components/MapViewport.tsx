import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapCompactEntry, MapFixAnalysisResponse, MapIndexEntry, SceneryFixIssueGroup } from '@shared/apiTypes';
import { computePropCorners, isPropRenderable, PmsMapData } from '@shared/pmsParser';
import { POLY_TYPES, SPAWN_TYPES } from '@shared/soldatConstants';
import {
  loadSoldatAssetImage,
  loadSoldatObjectSprites,
  ObjectSpritesBundle,
} from '../renderer/assetLoader';
import { renderMapOverlays, RulerMeasurement } from '../renderer/OverlayRenderer';
import { SoldatWebGLRenderer } from '../renderer/SoldatWebGLRenderer';
import { RenderLayerVisibility } from '../renderer/types';
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
  Ruler,
  ShieldAlert,
  Sparkles,
  Users,
  Wrench,
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
  onClearPreviewMode?: () => void;
  // B5: second map drawn right of a draggable divider (same camera)
  compare?: { key: string; label: string; data: PmsMapData } | null;
  mainLabel?: string;
  compareCandidates?: Array<{ id: string; baseName: string }>;
  onStartCompare?: (mapId: string) => void;
  onCompareWithOriginal?: (() => void) | null;
  onStopCompare?: () => void;
}

interface ViewTransform {
  centerX: number;
  centerY: number;
  zoom: number; // CSS pixels per 1.0 Soldat world unit (1.0 = 100% native game scale!)
}

// Viewport tools remembered between sessions (per browser)
const VIEWPORT_PREFS_KEY = 'soldat-map-studio.viewport.v1';

interface ViewportPrefs {
  showFixIssues: boolean;
  showPlayerView: boolean;
  playerAspect: number; // width / height of the player's screen
  showMinimap: boolean;
}

const DEFAULT_VIEWPORT_PREFS: ViewportPrefs = {
  showFixIssues: false,
  showPlayerView: false,
  playerAspect: 16 / 9,
  showMinimap: true,
};

const PLAYER_ASPECTS: Array<[string, number]> = [
  ['16:9', 16 / 9],
  ['16:10', 16 / 10],
  ['4:3', 4 / 3],
  ['21:9', 21 / 9],
];

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
      showMinimap: typeof raw.showMinimap === 'boolean' ? raw.showMinimap : DEFAULT_VIEWPORT_PREFS.showMinimap,
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
  onClearPreviewMode,
  compare = null,
  mainLabel,
  compareCandidates = [],
  onStartCompare,
  onCompareWithOriginal = null,
  onStopCompare,
}) => {
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

  // B2: props with 1.7.1 size problems of the current map file
  const [fixAnalysis, setFixAnalysis] = useState<{ mapKey: string; analysis: MapFixAnalysisResponse | null } | null>(
    null
  );
  useEffect(() => {
    if (!prefs.showFixIssues || !mapKey || fixAnalysis?.mapKey === mapKey) return;
    let cancelled = false;
    fetch(`/api/workshop/fix-analyze/${encodeURIComponent(mapKey)}?maxLen=24`)
      .then((r) => (r.ok ? r.json() : null))
      .then((analysis: MapFixAnalysisResponse | null) => {
        if (!cancelled) setFixAnalysis({ mapKey, analysis });
      })
      .catch(() => {
        if (!cancelled) setFixAnalysis({ mapKey, analysis: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.showFixIssues, mapKey]);

  // B4: minimap snapshot of the whole map, taken from the main renderer when the map or layers change
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimapImageRef = useRef<HTMLCanvasElement | null>(null);
  const minimapSourceRef = useRef<{ data: PmsMapData | null; key: string; geo: MinimapGeometry | null }>({
    data: null,
    key: '',
    geo: null,
  });
  const [minimapVersion, setMinimapVersion] = useState(0);
  const minimapDragRef = useRef(false);

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
  } | null>(null);

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
    };
    window.addEventListener('mouseup', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('mouseup', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  // Escape closes the object inspector, then cancels Ruler mode or Live Repair Preview (when no modal is open)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
    }

    rendererRef.current
      .loadMap(mapData, { preferClassicBmp: layers.preferClassicBmp })
      .then((applied) => {
        // `applied` is false when a newer map load superseded this one (fast keyboard navigation)
        if (!cancelled && applied) {
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
    if (fixAnalysis.mapKey !== mapKey) return null;
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
  }, [prefs.showFixIssues, previewModeBanner, mapData, fixAnalysis, mapKey]);

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
      if (prefs.showMinimap) {
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
          // One extra frame of the whole map, copied before the real view is drawn in the same task
          const geo = computeMinimapGeometry(mapData);
          renderer.render(geo.bounds, { ...layers, frontSceneryOpacity: 1 });
          const img = minimapImageRef.current ?? document.createElement('canvas');
          minimapImageRef.current = img;
          img.width = geo.w * 2;
          img.height = geo.h * 2;
          img.getContext('2d')?.drawImage(glCanvas, 0, 0, img.width, img.height);
          minimapSourceRef.current = { data: mapData, key, geo };
          setMinimapVersion((v) => v + 1);
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
          highlightOutline: inspection ? inspection.hits[inspection.selected]?.outline ?? null : null,
          issueOutlines: issueOverlay?.outlines ?? null,
        });
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
  }, [viewportSize, currentWorldBounds, layers, mapData, mapReadyOnGpu, sprites, ruler, inspection, issueOverlay, prefs.showMinimap, compare, compareReady]);

  // Minimap: snapshot + rectangle of the current camera view
  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    const src = minimapSourceRef.current;
    const img = minimapImageRef.current;
    if (!prefs.showMinimap || !canvas || !img || !src.geo || src.data !== mapData) return;
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
  }, [prefs.showMinimap, minimapVersion, currentWorldBounds, mapData]);

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
  const pendingMoveRef = useRef<{ clientX: number; clientY: number } | null>(null);
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
        setHoverHint(`${meta?.namePl || `Spawn Team ${sp.team}`} (${sp.x}, ${sp.y})`);
        return;
      }
    }

    if (layers.showColliders) {
      for (const col of mapData.colliders) {
        if (!col.active) continue;
        if (Math.hypot(col.x - w.x, col.y - w.y) <= Math.max(hitRadius, col.radius * 0.5)) {
          setHoverHint(`Colider #${col.index + 1} • Średnica: ${Math.round(col.radius)} px`);
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
            ? ` [Odbicie: ${poly.bounciness.toFixed(2)}x]`
            : '';
        setHoverHint(`Poligon #${i + 1}: ${pMeta?.namePl || `Typ ${poly.polyType}`}${bounceInfo}`);
        return;
      }
    }

    setHoverHint(null);
  };
  const processPendingMouseMoveRef = useRef(processPendingMouseMove);
  processPendingMouseMoveRef.current = processPendingMouseMove;

  // Mouse moves are coalesced to one state update per animation frame (pan + hover + cursor HUD)
  const handleMouseMove = (e: React.MouseEvent) => {
    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY };
    if (!moveFrameRef.current) {
      moveFrameRef.current = requestAnimationFrame(() => processPendingMouseMoveRef.current());
    }
  };

  useEffect(() => {
    return () => {
      if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current);
    };
  }, []);

  // A left click without dragging opens the object inspector for everything under the cursor
  const handleMouseUp = (e?: React.MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!e || !drag || drag.mode !== 'pan' || e.button !== 0 || !mapData) return;
    if (Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 4) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const hits = collectInspectHits(mapData, w.x, w.y, layers, polyHitGrid);
    if (issueOverlay) {
      for (const hit of hits) {
        const issue = hit.kind === 'prop' ? issueOverlay.byProp.get(hit.index) : undefined;
        if (issue) {
          hit.details.push([
            'Problem 1.7.1',
            `${issue.reasonLabelPl}: ${issue.pmsWidth}×${issue.pmsHeight} → ${issue.expectedWidth}×${issue.expectedHeight}`,
          ]);
        }
      }
    }
    setInspection(hits.length > 0 ? { worldX: w.x, worldY: w.y, hits, selected: 0 } : null);
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

  return (
    <main className="flex-1 min-w-0 relative bg-zinc-950 flex flex-col h-full overflow-hidden select-none">
      {/* Top Floating Layer & Tactical Toolbar */}
      <div className="z-20 bg-zinc-900/95 border-b border-zinc-800 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* Classic Layers Group */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mr-0.5">
            Widok:
          </span>
          <LayerChip
            active={layers.showBackground}
            onClick={() => toggleLayer('showBackground')}
            label="Tło"
            title="Gradient tła mapy"
          />
          <LayerChip
            active={layers.showPolygons}
            onClick={() => toggleLayer('showPolygons')}
            label="Poligony"
            title="Tekstury i geometria terenu"
          />
          <LayerChip
            active={layers.showSmoothEdges}
            onClick={() => toggleLayer('showSmoothEdges')}
            icon={<Sparkles className="w-3 h-3 text-emerald-400" />}
            label="Krawędzie"
            title="Wygładzane krawędzie terenu OpenSoldat (textures/edges/)"
          />
          <LayerChip
            active={layers.showSceneryBack}
            onClick={() => toggleLayer('showSceneryBack')}
            label="Scen. Tył"
            title="Scenerie na warstwie 0 (za graczem)"
          />
          <LayerChip
            active={layers.showSceneryMid}
            onClick={() => toggleLayer('showSceneryMid')}
            label="Scen. Środek"
            title="Scenerie na warstwie 1 (przed graczem, za poligonami)"
          />
          <button
            type="button"
            onClick={cycleFrontSceneryMode}
            title="Kliknij aby przełączyć kryjówki (Scenerie Przód): Pełne 100% -> Prześwit X-Ray 35% -> Ukryte"
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
              ? 'Kryjówki: Wył.'
              : layers.frontSceneryOpacity < 1
              ? 'Kryjówki: X-Ray'
              : 'Scen. Przód'}
          </button>

          <LayerChip
            active={layers.preferClassicBmp}
            onClick={() => toggleLayer('preferClassicBmp')}
            icon={<History className="w-3 h-3 text-amber-400" />}
            label={layers.preferClassicBmp ? 'BMP 1.6' : 'HD PNG'}
            title="Przełącz pomiędzy teksturami HD (.png) z OpenSoldat a klasycznymi teksturami Soldat 1.6 (.bmp)"
            accent="amber"
          />

          <LayerChip
            active={layers.pixelatedFilter}
            onClick={() => toggleLayer('pixelatedFilter')}
            label="Piksele"
            title="Ostre filtrowanie pikseli GL_NEAREST (bez rozmycia przy dużym przybliżeniu)"
          />

          <div className="w-px h-4 bg-zinc-800 mx-0.5" />

          {/* Tactical Overlays */}
          <LayerChip
            active={layers.showFlags}
            onClick={() => toggleLayer('showFlags')}
            icon={<Flag className="w-3.5 h-3.5 text-red-400" />}
            label="Flagi"
            badge={entitySummary.flags}
            accent="rose"
          />
          <LayerChip
            active={layers.showSpawns}
            onClick={() => toggleLayer('showSpawns')}
            icon={<Users className="w-3.5 h-3.5 text-sky-400" />}
            label="Spawny"
            badge={entitySummary.spawns}
            accent="sky"
          />
          <LayerChip
            active={layers.showBonuses}
            onClick={() => toggleLayer('showBonuses')}
            icon={<Gift className="w-3.5 h-3.5 text-emerald-400" />}
            label="Bonusy"
            badge={entitySummary.bonuses}
            accent="emerald"
          />
          <LayerChip
            active={layers.showColliders}
            onClick={() => toggleLayer('showColliders')}
            icon={<CircleDot className="w-3.5 h-3.5 text-cyan-400" />}
            label="Colidery"
            badge={entitySummary.colliders}
            accent="cyan"
          />
          <LayerChip
            active={layers.showPolyTypes}
            onClick={() => toggleLayer('showPolyTypes')}
            icon={<ShieldAlert className="w-3.5 h-3.5 text-amber-400" />}
            label="Fizyka Poly"
            badge={entitySummary.specialPolys}
            accent="amber"
          />
          <LayerChip
            active={layers.showWireframe}
            onClick={() => toggleLayer('showWireframe')}
            label="Siatka"
            title="Siatka trójkątów (Wireframe)"
          />
          <LayerChip
            active={layers.showWaypoints}
            onClick={() => toggleLayer('showWaypoints')}
            icon={<Bot className="w-3.5 h-3.5 text-yellow-400" />}
            label="Boty"
            badge={mapEntry?.activeWaypointCount}
          />
          <LayerChip
            active={layers.showGrid}
            onClick={() => toggleLayer('showGrid')}
            icon={<Grid className="w-3.5 h-3.5 text-zinc-400" />}
            label="Sektory"
          />
          <LayerChip
            active={prefs.showFixIssues}
            onClick={() => setPrefs((p) => ({ ...p, showFixIssues: !p.showFixIssues }))}
            icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
            label="Problemy 1.7.1"
            title={
              previewModeBanner
                ? 'Obrysy problemów 1.7.1 są niedostępne w trybie podglądu'
                : 'Obrysuj scenerie z błędnymi wymiarami po przejściu na Soldat 1.7.1 (to, co naprawia _f)'
            }
            badge={issueOverlay?.byProp.size}
            accent="amber"
          />

          <button
            type="button"
            onClick={toggleAllTactical}
            className="ml-0.5 px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
            title="Włącz / wyłącz wszystkie obiekty (Flagi + Spawny + Bonusy + Colidery)"
          >
            Wszystkie obiekty
          </button>
        </div>

        {/* Primary Actions: Workshop (_f / _o) + 100% Full Size Screenshot */}
        <div className="flex items-center gap-1.5 shrink-0">
          {compare ? (
            <button
              type="button"
              onClick={() => onStopCompare?.()}
              title="Zakończ porównanie dwóch wersji mapy"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer shrink-0"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Zakończ porównanie</span>
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
                  title="Porównaj z inną wersją tej mapy (suwak)"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-sky-500/40 text-sky-100 text-xs font-semibold cursor-pointer shrink-0"
                >
                  <Columns2 className="w-3.5 h-3.5 text-sky-300" />
                  <span className="hidden xl:inline">Porównaj</span>
                </button>
                {compareMenuPos && (
                  <div
                    className="fixed z-50 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 text-xs"
                    style={{ left: compareMenuPos.left, top: compareMenuPos.top }}
                  >
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">Porównaj z (po prawej)</div>
                    {onCompareWithOriginal && (
                      <button
                        type="button"
                        onClick={() => {
                          setCompareMenuOpen(false);
                          onCompareWithOriginal();
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-100 cursor-pointer"
                      >
                        Oryginałem tej mapy (przed zmianami)
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
                  </div>
                )}
              </div>
            )
          )}
          {onOpenWorkshopModal && (
            <button
              type="button"
              onClick={() => onOpenWorkshopModal('fix')}
              disabled={!actionsEnabled}
              title="Napraw rozciągnięte scenerie z Soldat 1.7.1 (_f.pms) lub sklej warstwy scenerii Optimize Sceneries (_o.pms)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-950/50 disabled:opacity-40 transition-all cursor-pointer shrink-0"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span className="hidden 2xl:inline">Napraw 1.7.1 / Optimize (_f / _o)</span>
              <span className="2xl:hidden">_f / _o</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenFullSizeModal}
            disabled={!actionsEnabled}
            title="Pełnowymiarowy zrzut mapy (100% / własna skala)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-950/50 disabled:opacity-40 transition-all cursor-pointer shrink-0"
          >
            <Camera className="w-4 h-4" />
            <span className="hidden 2xl:inline">Full-Size Screen (100%)</span>
            <span className="2xl:hidden">Screen</span>
          </button>
        </div>
      </div>

      {/* Live Preview Mode Banner (when inspecting _f Scenery Repair Before/After) */}
      {previewModeBanner && (
        <div className="z-20 bg-amber-950/90 border-b border-amber-500/50 px-4 py-1.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{previewModeBanner}</span>
          </div>
          {onClearPreviewMode && (
            <button
              type="button"
              onClick={onClearPreviewMode}
              className="px-2.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-amber-100 font-semibold cursor-pointer"
            >
              Wróć do oryginału
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
          if (mapData) fitMapToViewport(mapData);
        }}
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
              Wczytywanie mapy i tekstur na GPU...
            </div>
          </div>
        )}

        {contextLost && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-amber-950/90 border border-amber-700 px-5 py-3 rounded-lg text-xs text-amber-100 max-w-md text-center">
              Karta graficzna zresetowała kontekst WebGL2 — trwa próba odzyskania. Jeśli widok nie wróci, odśwież
              stronę (F5).
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
        {mapEntry && (
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
                {mapEntry.modeGroupName}
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
              Typy Poligonów na Mapie
            </div>
            <div className="space-y-1">
              {presentSpecialPolyTypes.map(({ meta, count }) => (
                <div key={meta.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5 text-zinc-200 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="truncate">{meta.namePl}</span>
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
              aria-label="Przeciągnij, aby przesunąć granicę porównania"
              title="Przeciągnij, aby przesunąć granicę porównania"
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 rounded bg-zinc-100 text-zinc-900 text-xs font-bold shadow-lg cursor-ew-resize flex items-center justify-center"
            >
              ⇔
            </button>
            <span className="absolute top-14 right-3 whitespace-nowrap text-[11px] font-mono bg-zinc-950/85 text-zinc-100 px-1.5 py-0.5 rounded pointer-events-none">
              ◀ {mainLabel ?? mapEntry?.baseName ?? 'bieżąca mapa'}
            </span>
            <span className="absolute top-14 left-3 whitespace-nowrap text-[11px] font-mono bg-sky-950/90 text-sky-100 px-1.5 py-0.5 rounded pointer-events-none">
              {compare.label} ▶{!compareReady && ' (wczytywanie...)'}
            </span>
          </div>
        )}

        {/* Player view: what a player standing at the cursor sees (480 units high, width from aspect) */}
        {prefs.showPlayerView && cursorWorld && mapData && (() => {
          const zoom = Math.max(0.02, transform.zoom || 0.5);
          const vwPx = PLAYER_VIEW_HEIGHT * prefs.playerAspect * zoom;
          const vhPx = PLAYER_VIEW_HEIGHT * zoom;
          const cx = (cursorWorld.x - currentWorldBounds.left) * zoom;
          const cy = (cursorWorld.y - currentWorldBounds.top) * zoom;
          return (
            <div
              className="absolute z-10 pointer-events-none border-2 border-dashed border-sky-300/80 rounded-sm shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
              style={{ left: cx - vwPx / 2, top: cy - vhPx / 2, width: vwPx, height: vhPx }}
            >
              <span className="absolute -top-5 left-0 whitespace-nowrap text-[10px] font-mono bg-zinc-950/85 text-sky-200 px-1 rounded">
                Widok gracza {Math.round(PLAYER_VIEW_HEIGHT * prefs.playerAspect)}×{PLAYER_VIEW_HEIGHT}
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
              aria-label="Minimapa — kliknij, aby przesunąć widok"
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
                Obiekty w punkcie ({Math.round(inspection.worldX)}, {Math.round(inspection.worldY)}) —{' '}
                {inspection.hits.length}
              </span>
              <button
                type="button"
                onClick={() => setInspection(null)}
                title="Zamknij (Esc)"
                className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-zinc-800/70">
              {inspection.hits.map((hit, idx) => {
                const selected = idx === inspection.selected;
                return (
                  <div key={`${hit.kind}-${hit.index}`} className={selected ? 'bg-fuchsia-500/10' : ''}>
                    <button
                      type="button"
                      onClick={() => setInspection((prev) => (prev ? { ...prev, selected: idx } : prev))}
                      className="w-full text-left px-3 py-1.5 hover:bg-zinc-900 cursor-pointer"
                    >
                      <span className="text-[10px] text-zinc-500 mr-1.5">{idx === 0 ? 'na wierzchu' : `#${idx + 1}`}</span>
                      <span className={`font-mono ${selected ? 'text-fuchsia-200' : 'text-zinc-200'}`}>{hit.title}</span>
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
                            <span className="text-zinc-500 shrink-0">Plik graficzny</span>
                            <span className="font-mono text-zinc-200 text-right">
                              {inspectFileDims.w} × {inspectFileDims.h}
                              {(inspectFileDims.w !== Math.abs(hit.pmsSize[0]) ||
                                inspectFileDims.h !== Math.abs(hit.pmsSize[1])) &&
                                ` (×${(inspectFileDims.w / Math.max(1, Math.abs(hit.pmsSize[0]))).toFixed(2)} względem PMS)`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
                : 'Przeciągnij aby przesuwać • Rolka przybliża'}
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
            <button
              type="button"
              onClick={() => {
                setRulerMode((v) => !v);
                if (rulerMode) setRuler(null);
              }}
              title="Miarka odległości (kliknij i przeciągnij na mapie)"
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                rulerMode
                  ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <Ruler className="w-3.5 h-3.5" />
              Miarka
            </button>

            <button
              type="button"
              onClick={() => setPrefs((p) => ({ ...p, showPlayerView: !p.showPlayerView }))}
              title="Ramka widoku gracza przy kursorze (Soldat pokazuje 480 jednostek wysokości)"
              aria-pressed={prefs.showPlayerView}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors cursor-pointer ${
                prefs.showPlayerView
                  ? 'bg-sky-500/25 text-sky-200 border border-sky-500/40'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Widok gracza
            </button>
            {prefs.showPlayerView && (
              <select
                value={String(prefs.playerAspect)}
                onChange={(e) => setPrefs((p) => ({ ...p, playerAspect: Number(e.target.value) }))}
                aria-label="Proporcje ekranu gracza"
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
              title="Minimapa z prostokątem widoku"
              aria-label="Minimapa"
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
              title="Oddal"
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
              title="Przybliż"
              className="p-1 rounded text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setTransform((p) => ({ ...p, zoom: 1.0 }))}
              title="Ustaw natywną skalę gry 100% (1:1 piksel)"
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
              title="Dopasuj całą mapę do okna (Podwójne kliknięcie)"
              className="px-2 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 flex items-center gap-1 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Dopasuj
            </button>

            <button
              type="button"
              onClick={() => setTransform((p) => ({ ...p, centerX: 0, centerY: 0 }))}
              title="Wyśrodkuj na punkcie (0, 0)"
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

interface InspectHit {
  kind: 'prop' | 'polygon';
  index: number;
  title: string;
  details: Array<[string, string]>;
  outline: number[];
  sceneryName?: string;
  pmsSize?: [number, number];
}

const LEVEL_NAMES = ['Tył (0)', 'Środek (1)', 'Przód (2)'];

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
  grid: { lookup: (x: number, y: number) => number[] } | null
): InspectHit[] {
  const levelVisible = [
    layers.showSceneryBack,
    layers.showSceneryMid,
    layers.showSceneryFront && layers.frontSceneryOpacity > 0.01,
  ];
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
      title: `Sceneria #${i + 1}: ${sc.filename.replace(/^__preview_[a-z0-9]+__/, '') || '(bez nazwy)'}${
        sc.filename.startsWith('__preview_') ? ' (podgląd)' : ''
      }`,
      sceneryName: sc.filename,
      pmsSize: [p.width, p.height],
      outline: Array.from(c),
      details: [
        ['Warstwa', LEVEL_NAMES[p.level]],
        ['Wymiar w PMS', `${p.width} × ${p.height}`],
        ['Skala', `${p.scaleX.toFixed(3)} × ${p.scaleY.toFixed(3)}`],
        ['W świecie gry', `${Math.round(Math.abs(p.width * p.scaleX))} × ${Math.round(Math.abs(p.height * p.scaleY))} j.`],
        ['Obrót', `${radiansToSignedDegrees(p.rotation).toFixed(1)}°`],
        ['Krycie (alpha)', `${p.alpha} / 255 (${Math.round(p.alpha / 2.55)}%)`],
        ['Kolor', tinted ? `${toHexColor(p.color)} (barwienie)` : 'biały (bez barwienia)'],
        ['Pozycja', `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`],
        ['Wpis scenerii', `#${p.style}`],
      ],
    });
  }

  const polyFront: InspectHit[] = [];
  const polyBack: InspectHit[] = [];
  if (layers.showPolygons) {
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
        title: `Poligon #${i + 1}: ${meta?.namePl || `Typ ${poly.polyType}`}`,
        outline: [a.x, a.y, b.x, b.y, c.x, c.y],
        details: [
          ['Typ', `${poly.polyType} (${meta?.nameEn || '?'})`],
          ...poly.vertices.map((v, vi): [string, string] => [
            `Wierzchołek ${vi + 1}`,
            `${v.x.toFixed(1)}, ${v.y.toFixed(1)} • ${toHexColor(v.color)} α${v.color.a}`,
          ]),
          ...(poly.polyType === 18 ? [['Odbicie', `${poly.bounciness.toFixed(2)}×`] as [string, string]] : []),
        ],
      };
      (poly.polyType === 24 || poly.polyType === 25 ? polyBack : polyFront).push(hit);
    }
  }

  return [...propHits[2], ...polyFront, ...propHits[1], ...propHits[0], ...polyBack].slice(0, 40);
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

function pointInTriangle(
  px: number,
  py: number,
  v1: { x: number; y: number },
  v2: { x: number; y: number },
  v3: { x: number; y: number }
): boolean {
  const d1 = (px - v2.x) * (v1.y - v2.y) - (v1.x - v2.x) * (py - v2.y);
  const d2 = (px - v3.x) * (v2.y - v3.y) - (v2.x - v3.x) * (py - v3.y);
  const d3 = (px - v1.x) * (v3.y - v1.y) - (v3.x - v1.x) * (py - v1.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
