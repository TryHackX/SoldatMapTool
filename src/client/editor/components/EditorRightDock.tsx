import { EntityInspector } from './EntityInspector';
import { SceneryInspector } from './SceneryInspector';
import { PolygonInspector,usePolygonColorInspector } from './PolygonInspector';
import { PanelCard } from './EditorPanelCard';
import type { MapValidationIssue } from '@shared/mapValidator';
import React, { useState } from 'react';
import { EditorAssetCatalogResponse } from '@shared/apiTypes';
import { createPolygonFromPoints } from '@shared/pmsCompiler';
import { PmsMapData } from '@shared/pmsParser';
import {
  POLY_TYPES,
  RgbaColor,
  SPAWN_TYPES,
  WAYPOINT_ACTION_NAMES_EN,
} from '@shared/soldatConstants';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  FlipHorizontal,
  FlipVertical,
  Gamepad2,
  History,
  Settings2,
  ShieldAlert,
  Shuffle,
  Sliders,
  Sparkles,
  Sun,
  Wand2,
} from 'lucide-react';
import { locale, polyTypeName, t, tText } from '../../i18n';
import { memoIgnoringCallbacks } from '../memoIgnoringCallbacks';
import { CommitTextInput, EditorColorInput, NumberInput } from './EditorFields';
import {
  SCENERY_TINT_PRESETS,
  SceneryHazeTools,
} from './EditorSceneryTools';
import { hexToRgb, rgbToHex } from '../colorTools';
import { CourseControls } from './CourseControls';
import { EditorChecksPanel } from './EditorChecksPanel';
import { PolyFixerPanel } from './PolyFixerPanel';
import { PolygonShapeControls } from './PolygonShapeControls';
import { spawnTypeName } from '../../renderer/OverlayRenderer';
import {
  AlignmentMode,
  alignSelection,
  EditorDocumentSnapshot,
  emptySelection,
  PropDrawOrderDirection,
  rotateSelection,
  scaleSelection,
  computeSelectionExactBounds,
  translateSelection,
  updateMapHeader,
} from '../EditorDocument';
import { SoldierPlaytestState } from '../soldierPlaytest';
import {
  ColorBlendMode,
  EditorBrushSettings,
  EditorPlacementDefaults,
  EditorSelection,
  EditorToolId,
  RightDockTab,
  SelectionSummary,
} from '../types';

const CRUST_PRESETS: Record<
  'grass' | 'snow' | 'ice' | 'dirt',
  { labelEn: string; top: RgbaColor; bottom: RgbaColor; polyType: number }
> = {
  grass: {
    labelEn: 'Grass',
    top: { r: 92, g: 196, b: 84, a: 255 },
    bottom: { r: 44, g: 98, b: 46, a: 255 },
    polyType: 0,
  },
  snow: {
    labelEn: 'Snow',
    top: { r: 245, g: 250, b: 255, a: 255 },
    bottom: { r: 168, g: 192, b: 218, a: 255 },
    polyType: 0,
  },
  ice: {
    labelEn: 'Ice',
    top: { r: 165, g: 235, b: 255, a: 255 },
    bottom: { r: 82, g: 158, b: 212, a: 255 },
    polyType: 4,
  },
  dirt: {
    labelEn: 'Dirt',
    top: { r: 168, g: 124, b: 82, a: 255 },
    bottom: { r: 92, g: 64, b: 42, a: 255 },
    polyType: 0,
  },
};

export interface EditorValidationIssueUI {
  id: string;
  severity: 'error' | 'warning' | 'hint';
  message: string;
  selection?: EditorSelection;
  focusBounds?: { left: number; right: number; top: number; bottom: number };
  focusPoint?: { x: number; y: number; radius?: number };
  fix?: NonNullable<MapValidationIssue['fix']>;
}

export interface EditorRightDockProps {
  tunnelPanel?: React.ReactNode;
  activeTab: RightDockTab;
  onChangeTab: (tab: RightDockTab) => void;
  snapshot: EditorDocumentSnapshot;
  activeTool: EditorToolId;
  selectionSummary: SelectionSummary;
  brush: EditorBrushSettings;
  onChangeBrush: (next: EditorBrushSettings) => void;
  placement: EditorPlacementDefaults;
  onChangePlacement: (next: EditorPlacementDefaults) => void;
  assetCatalog: EditorAssetCatalogResponse | null;
  texDims: { w: number; h: number };
  sceneryPreviewDims: { w: number; h: number };
  preferClassicBmp: boolean;
  validationIssues: EditorValidationIssueUI[];
  getViewCenter: () => { x: number; y: number } | null;
  weldSharedVertices: boolean;
  validationPending: boolean;
  validationHintsEnabled: boolean;
  onToggleValidationHints: (enabled: boolean) => void;
  onFixValidationIssue: (issue: EditorValidationIssueUI) => void;
  onRemoveUnusedScenery: () => void;
  playtest: SoldierPlaytestState | null;
  playtestTeam: 1 | 2 | 3 | 4;
  onChangePlaytestTeam: (team: 1 | 2 | 3 | 4) => void;
  playtestCarryingFlag: boolean;
  onChangePlaytestCarryingFlag: (v: boolean) => void;
  onRespawnPlaytest: () => void;
  onOpenImageTrace: () => void;
  onApplySurfaceCrust: (opts: {
    thickness: number;
    topColor: RgbaColor;
    bottomColor: RgbaColor;
    polyType: number;
  }) => void;
  onApplyReliefShading: (opts: { lightAngleDeg: number; contrast: number }) => void;
  onSubdividePolygons: () => void;
  onGenerateProceduralIsland: (opts: {
    width: number;
    height: number;
    segments: number;
    roughness: number;
    seed: number;
    flatTop: boolean;
    addGrassCrust: boolean;
  }) => void;
  onCommitMutation: (
    label: string,
    nextMap: PmsMapData,
    nextSelection?: EditorSelection,
    txId?: string
  ) => void;
  onUpdateSelection: (sel: EditorSelection) => void;
  onPropDrawOrder: (dir: PropDrawOrderDirection) => void;
  onPolygonDrawOrder: (dir: PropDrawOrderDirection) => void;
  onResetPolygonUv: () => void;
  onFlipPolygonWinding: () => void;
  onUpdateHeader: (patch: Parameters<typeof updateMapHeader>[1], transactionId?: string) => void;
  onJumpToHistory: (depth: number) => void;
  onFocusBounds: (b: { left: number; right: number; top: number; bottom: number }) => void;
  onSetValidationFocus: (pt: { x: number; y: number; radius?: number } | null) => void;
}

const EditorRightDockPanel: React.FC<EditorRightDockProps> = ({
  tunnelPanel,
  activeTab,
  onChangeTab,
  snapshot,
  activeTool,
  selectionSummary,
  brush,
  onChangeBrush,
  placement,
  onChangePlacement,
  assetCatalog,
  texDims,
  sceneryPreviewDims,
  preferClassicBmp,
  validationIssues,
  getViewCenter,
  weldSharedVertices,
  validationPending,
  validationHintsEnabled,
  onToggleValidationHints,
  onFixValidationIssue,
  onRemoveUnusedScenery,
  playtest,
  playtestTeam,
  onChangePlaytestTeam,
  playtestCarryingFlag,
  onChangePlaytestCarryingFlag,
  onRespawnPlaytest,
  onOpenImageTrace,
  onApplySurfaceCrust,
  onApplyReliefShading,
  onSubdividePolygons,
  onGenerateProceduralIsland,
  onCommitMutation,
  onUpdateSelection,
  onPropDrawOrder,
  onPolygonDrawOrder,
  onResetPolygonUv,
  onFlipPolygonWinding,
  onUpdateHeader,
  onJumpToHistory,
  onFocusBounds,
  onSetValidationFocus,
}) => {
  const { map, selection } = snapshot;

  // Quick numeric delta state
  const [deltaX, setDeltaX] = useState(0);
  const [deltaY, setDeltaY] = useState(0);
  const [rotDegInput, setRotDegInput] = useState(15);
  const colors=usePolygonColorInspector(map,selection,selectionSummary,onCommitMutation);
  const [shapeW, setShapeW] = useState(128);
  const [shapeH, setShapeH] = useState(32);

  // Procedural Terrain & Crust / Relief controls
  const [crustPreset, setCrustPreset] = useState<'grass' | 'snow' | 'ice' | 'dirt'>('grass');
  const [crustThickness, setCrustThickness] = useState(10);
  const [reliefAngle, setReliefAngle] = useState(-55);
  const [reliefContrast, setReliefContrast] = useState(38);
  const [islandW, setIslandW] = useState(220);
  const [islandH, setIslandH] = useState(120);
  const [islandRoughness, setIslandRoughness] = useState(35);
  const [islandSeed, setIslandSeed] = useState(42);
  const [islandFlatTop, setIslandFlatTop] = useState(true);
  const [islandGrass, setIslandGrass] = useState(true);

  const selectedPolys = selection.polygons.map((i) => map.polygons[i]).filter(Boolean);

  const applyAlign = (mode: AlignmentMode) => {
    const nextMap = alignSelection(map, selection, mode);
    onCommitMutation(`Align selection (${mode})`, nextMap);
  };

  const insertRectangleHelper = () => {
    const w = Math.max(4, shapeW);
    const h = Math.max(4, shapeH);
    const view = getViewCenter();
    const cx = selectionSummary.bounds
      ? (selectionSummary.bounds.left + selectionSummary.bounds.right) * 0.5
      : Math.round(view?.x ?? 0);
    const cy = selectionSummary.bounds
      ? (selectionSummary.bounds.top + selectionSummary.bounds.bottom) * 0.5
      : Math.round(view?.y ?? 0);
    const p1 = { x: cx - w * 0.5, y: cy - h * 0.5 };
    const p2 = { x: cx + w * 0.5, y: cy - h * 0.5 };
    const p3 = { x: cx + w * 0.5, y: cy + h * 0.5 };
    const p4 = { x: cx - w * 0.5, y: cy + h * 0.5 };
    const opts = {
      polyType: placement.polyType,
      bounciness: placement.bounciness,
      color: placement.polyColor,
      texWidth: texDims.w,
      texHeight: texDims.h,
    };
    const tA = createPolygonFromPoints([p1, p2, p3], opts);
    const tB = createPolygonFromPoints([p1, p3, p4], opts);
    const startIdx = map.polygons.length;
    onCommitMutation(
      'Insert rectangle polygons',
      { ...map, polygons: [...map.polygons, tA, tB] },
      { ...emptySelection(), polygons: [startIdx, startIdx + 1] }
    );
  };

  const fullTimeline = [
    ...snapshot.undoStack,
    ...[...snapshot.redoStack].reverse(),
  ];

  const problemCount = validationIssues.filter((i) => i.severity !== 'hint').length;

  return (
    <aside className="w-76 2xl:w-84 shrink-0 bg-zinc-900/95 border-l border-zinc-800/90 flex flex-col h-full select-none">
      {/* Dock Tabs */}
      <div className="grid grid-cols-4 border-b border-zinc-800 text-[11px] font-semibold">
        {(
          [
            ['properties', t('Inspector'), <Sliders key="p" className="w-3.5 h-3.5" />],
            ['settings', t('Map'), <Settings2 key="s" className="w-3.5 h-3.5" />],
            ['validation', t('Checks'), <ShieldAlert key="v" className="w-3.5 h-3.5" />],
            ['history', t('History'), <History key="h" className="w-3.5 h-3.5" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChangeTab(id)}
            className={`py-2 px-1 flex flex-col items-center justify-center gap-0.5 border-b-2 transition-colors cursor-pointer ${
              (activeTab === id || (id === 'validation' && activeTab === 'poly_fixer'))
                ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {icon}
            <span className="truncate max-w-full">
              {label}
              {id === 'validation' && problemCount > 0 && ` (${problemCount})`}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 text-xs space-y-4">
        {activeTab === 'properties' && activeTool === 'climb_tunnel' && tunnelPanel}
        {activeTab === 'properties' && activeTool !== 'climb_tunnel' && (
          <>
            {/* 1. Active Tool Placement / Brush Settings */}
            {activeTool === 'poly_shape' && <PanelCard title={t('Polygon shapes')}>
              <PolygonShapeControls value={placement} onChange={onChangePlacement}/>
            </PanelCard>}
            {(activeTool === 'poly_tri' ||
              activeTool === 'poly_strip' ||
              activeTool === 'poly_fan' ||
              activeTool === 'poly_shape' ||
              activeTool === 'poly_laser') && (
              <PanelCard title={t('New Polygon Defaults')}>
                <label className="space-y-1 block">
                  <span className="text-zinc-400 text-[11px]">{t('Polygon physics type')}</span>
                  <select
                    value={placement.polyType}
                    onChange={(e) =>
                      onChangePlacement({ ...placement, polyType: Number(e.target.value) })
                    }
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
                  >
                    {Object.values(POLY_TYPES).map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.id}: {polyTypeName(pt)}
                      </option>
                    ))}
                  </select>
                </label>

                {placement.polyType === 18 && (
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-zinc-400 text-[11px]">{t('Bounce strength')}</span>
                    <NumberInput
                      step={0.1}
                      min={0}
                      max={20}
                      value={placement.bounciness}
                      onChange={(e) =>
                        onChangePlacement({ ...placement, bounciness: Number(e.target.value) })
                      }
                      className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                    />
                  </label>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400 text-[11px]">{t('Vertex color & alpha')}</span>
                  <div className="flex items-center gap-1.5">
                    <EditorColorInput
                      value={rgbToHex(placement.polyColor)}
                      onChange={(e) =>
                        onChangePlacement({
                          ...placement,
                          polyColor: hexToRgb(e.target.value, placement.polyColor.a),
                        })
                      }
                      className="w-7 h-6 rounded bg-transparent cursor-pointer"
                    />
                    <NumberInput
                      min={0}
                      max={255}
                      value={placement.polyColor.a}
                      onChange={(e) =>
                        onChangePlacement({
                          ...placement,
                          polyColor: {
                            ...placement.polyColor,
                            a: Math.max(0, Math.min(255, Number(e.target.value))),
                          },
                        })
                      }
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                    />
                  </div>
                </div>

                {activeTool === 'poly_laser' && (
                  <div className="pt-1.5 border-t border-zinc-800/80 space-y-2">
                    <div className="text-[10px] font-semibold text-rose-300 flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />
                      <label>{t('Stroke mode')} <select className="bg-zinc-900 p-1" value={placement.strokeMode} onChange={e => onChangePlacement({...placement, strokeMode: e.target.value as 'outline' | 'course'})}>
                        <option value="outline">{t('Solid outline')}</option><option value="course">{t('Platform route')}</option>
                      </select></label>
                    </div>
                    {placement.strokeMode === 'course' ? <CourseControls value={placement.course} onChange={course => onChangePlacement({...placement, course})}/> : <>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">
                        {t('Detail tolerance: {d} u', { d: placement.laserDetail })}
                      </span>
                      <input
                        type="range"
                        min={2}
                        max={24}
                        value={placement.laserDetail}
                        onChange={(e) =>
                          onChangePlacement({ ...placement, laserDetail: Number(e.target.value) })
                        }
                        className="w-28 accent-rose-400"
                      />
                    </label>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">{t('Corner smoothing')}</span>
                      <div className="flex items-center gap-1">
                        {[0, 1, 2].map((sp) => (
                          <button
                            key={sp}
                            type="button"
                            onClick={() =>
                              onChangePlacement({ ...placement, laserSmoothPasses: sp })
                            }
                            className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer ${
                              placement.laserSmoothPasses === sp
                                ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
                                : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                            }`}
                          >
                            {sp}×
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={placement.laserAutoShade}
                        onChange={(e) =>
                          onChangePlacement({ ...placement, laserAutoShade: e.target.checked })
                        }
                        className="rounded border-zinc-700 bg-zinc-900 accent-rose-400"
                      />
                      <span>{t('Auto-shade 3D depth on stroke')}</span>
                    </label></>}
                  </div>
                )}

                <div className="pt-1.5 border-t border-zinc-800/80 space-y-1.5">
                  <div className="text-[10px] text-zinc-400">{t('Quick platform / rectangle')}</div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      min={4}
                      value={shapeW}
                      onChange={(e) => setShapeW(Number(e.target.value))}
                      className="w-18 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                    />
                    <span className="text-zinc-500">×</span>
                    <NumberInput
                      min={4}
                      value={shapeH}
                      onChange={(e) => setShapeH(Number(e.target.value))}
                      className="w-18 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={insertRectangleHelper}
                      className="flex-1 py-1 px-2 rounded bg-cyan-600/25 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-100 font-semibold cursor-pointer"
                    >
                      {t('Insert')}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onOpenImageTrace}
                  className="w-full py-1.5 px-2.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-200 text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('Image → Polygons / Blueprint...')}</span>
                </button>
              </PanelCard>
            )}

            {/* Procedural Terrain, Crust & 3D Relief FX */}
            {(activeTool === 'poly_tri' ||
              activeTool === 'poly_strip' ||
              activeTool === 'poly_fan' ||
              activeTool === 'poly_shape' ||
              activeTool === 'poly_laser' ||
              selectedPolys.length > 0) && (
              <PanelCard title={t('Terrain FX & Procedural Generator')}>
                {/* 1-Click Surface Crust */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300 font-medium">{t('Top Surface Crust')}</span>
                    <span className="text-[10px] text-zinc-500">
                      {selectedPolys.length > 0 ? t('Selected') : t('Whole map')}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(['grass', 'snow', 'ice', 'dirt'] as const).map((presetKey) => (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() => setCrustPreset(presetKey)}
                        className={`py-1 rounded text-[10px] border cursor-pointer ${
                          crustPreset === presetKey
                            ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40 font-semibold'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        {t(CRUST_PRESETS[presetKey].labelEn)}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {t('Thickness: {t} u', { t: crustThickness })}
                    </span>
                    <input
                      type="range"
                      min={4}
                      max={28}
                      value={crustThickness}
                      onChange={(e) => setCrustThickness(Number(e.target.value))}
                      className="flex-1 accent-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const preset = CRUST_PRESETS[crustPreset];
                        onApplySurfaceCrust({
                          thickness: crustThickness,
                          topColor: preset.top,
                          bottomColor: preset.bottom,
                          polyType: preset.polyType,
                        });
                      }}
                      className="px-2 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-100 text-[11px] font-semibold cursor-pointer shrink-0"
                    >
                      {t('Extrude')}
                    </button>
                  </div>
                </div>

                {/* 3D Sun Relief Shading & Subdivision */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <div className="text-[11px] text-zinc-300 font-medium flex items-center gap-1">
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t('3D Sun Relief & Subdivide')}</span>
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      {t('Sun angle: {deg}°', { deg: reliefAngle })}
                    </span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={5}
                      value={reliefAngle}
                      onChange={(e) => setReliefAngle(Number(e.target.value))}
                      className="w-28 accent-amber-400"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      {t('Contrast: {c}%', { c: reliefContrast })}
                    </span>
                    <input
                      type="range"
                      min={10}
                      max={85}
                      value={reliefContrast}
                      onChange={(e) => setReliefContrast(Number(e.target.value))}
                      className="w-28 accent-amber-400"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onApplyReliefShading({
                          lightAngleDeg: reliefAngle,
                          contrast: reliefContrast / 100,
                        })
                      }
                      className="py-1 px-2 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/40 text-amber-100 text-[11px] font-semibold cursor-pointer"
                    >
                      {t('Apply 3D Relief')}
                    </button>
                    <button
                      type="button"
                      disabled={selectedPolys.length === 0}
                      onClick={onSubdividePolygons}
                      className="py-1 px-2 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-[11px] cursor-pointer"
                    >
                      {t('Subdivide 1 → 4')}
                    </button>
                  </div>
                </div>

                {/* Procedural Floating Island / Rock */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <div className="text-[11px] text-zinc-300 font-medium">
                    {t('Procedural Island / Rock')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      min={24}
                      max={2000}
                      value={islandW}
                      onChange={(e) => setIslandW(Number(e.target.value))}
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                    />
                    <span className="text-zinc-500">×</span>
                    <NumberInput
                      min={24}
                      max={2000}
                      value={islandH}
                      onChange={(e) => setIslandH(Number(e.target.value))}
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => setIslandSeed((s) => (s * 1664525 + 1013904223) % 99999)}
                      title={t('Randomize rock seed')}
                      className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onGenerateProceduralIsland({
                          width: Math.max(24, islandW),
                          height: Math.max(24, islandH),
                          segments: 14,
                          roughness: islandRoughness / 100,
                          seed: islandSeed,
                          flatTop: islandFlatTop,
                          addGrassCrust: islandGrass,
                        })
                      }
                      className="flex-1 py-1 px-2 rounded bg-cyan-600/25 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-100 font-semibold cursor-pointer"
                    >
                      {t('Spawn')}
                    </button>
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      {t('Jaggedness: {r}%', { r: islandRoughness })}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={75}
                      value={islandRoughness}
                      onChange={(e) => setIslandRoughness(Number(e.target.value))}
                      className="w-28 accent-cyan-400"
                    />
                  </label>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={islandFlatTop}
                        onChange={(e) => setIslandFlatTop(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      <span>{t('Walkable top')}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={islandGrass}
                        onChange={(e) => setIslandGrass(e.target.checked)}
                        className="accent-emerald-400"
                      />
                      <span>{t('Grass cap')}</span>
                    </label>
                  </div>
                </div>
              </PanelCard>
            )}

            {(activeTool === 'color_brush' || activeTool === 'light') && (
              <PanelCard
                title={
                  activeTool === 'light'
                    ? t('Vertex Light Baker')
                    : t('Vertex Color Brush')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400 text-[11px]">{t('Color & Alpha')}</span>
                  <div className="flex items-center gap-1.5">
                    <EditorColorInput
                      value={rgbToHex(brush.color)}
                      onChange={(e) =>
                        onChangeBrush({ ...brush, color: hexToRgb(e.target.value, brush.color.a) })
                      }
                      className="w-7 h-6 rounded bg-transparent cursor-pointer"
                    />
                    <NumberInput
                      min={0}
                      max={255}
                      value={brush.color.a}
                      onChange={(e) =>
                        onChangeBrush({
                          ...brush,
                          color: {
                            ...brush.color,
                            a: Math.max(0, Math.min(255, Number(e.target.value))),
                          },
                        })
                      }
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                    />
                  </div>
                </div>

                {activeTool === 'color_brush' ? (
                  <>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">
                        {t('Brush radius: {r} u', { r: brush.radius })}
                      </span>
                      <input
                        type="range"
                        min={8}
                        max={256}
                        value={brush.radius}
                        onChange={(e) => onChangeBrush({ ...brush, radius: Number(e.target.value) })}
                        className="w-28 accent-cyan-400"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">
                        {t('Strength: {s}%', { s: Math.round(brush.strength * 100) })}
                      </span>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={Math.round(brush.strength * 100)}
                        onChange={(e) =>
                          onChangeBrush({ ...brush, strength: Number(e.target.value) / 100 })
                        }
                        className="w-28 accent-cyan-400"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-zinc-400 text-[11px]">{t('Blend mode')}</span>
                      <select
                        value={brush.blendMode}
                        onChange={(e) =>
                          onChangeBrush({ ...brush, blendMode: e.target.value as ColorBlendMode })
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                      >
                        <option value="replace">{t('Replace (mix RGBA)')}</option>
                        <option value="multiply">{t('Multiply (shadow / darken)')}</option>
                        <option value="screen">{t('Screen (highlight / brighten)')}</option>
                        <option value="alpha_only">{t('Alpha only (transparency)')}</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">
                        {t('Light radius: {r} u', { r: brush.lightRadius })}
                      </span>
                      <input
                        type="range"
                        min={32}
                        max={600}
                        value={brush.lightRadius}
                        onChange={(e) =>
                          onChangeBrush({ ...brush, lightRadius: Number(e.target.value) })
                        }
                        className="w-28 accent-amber-400"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 text-[11px]">
                        {t('Intensity: {s}%', { s: Math.round(brush.lightIntensity * 100) })}
                      </span>
                      <input
                        type="range"
                        min={10}
                        max={150}
                        value={Math.round(brush.lightIntensity * 100)}
                        onChange={(e) =>
                          onChangeBrush({
                            ...brush,
                            lightIntensity: Number(e.target.value) / 100,
                          })
                        }
                        className="w-28 accent-amber-400"
                      />
                    </label>
                  </>
                )}

                <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brush.affectSelectedOnly}
                    onChange={(e) =>
                      onChangeBrush({ ...brush, affectSelectedOnly: e.target.checked })
                    }
                    className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
                  />
                  <span>{t('Paint selected polygons only')}</span>
                </label>

                <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brush.affectSceneries}
                    onChange={(e) =>
                      onChangeBrush({ ...brush, affectSceneries: e.target.checked })
                    }
                    className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
                  />
                  <span>{t('Also tint / light sceneries in radius')}</span>
                </label>
              </PanelCard>
            )}

            {activeTool === 'scenery' && (
              <PanelCard title={t('Scenery Studio')}>
                {/* Edit & Stamp vs Stamp Always */}
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => onChangePlacement({ ...placement, sceneryStampAlways: false })}
                    className={`py-1 rounded text-[11px] border cursor-pointer ${
                      !placement.sceneryStampAlways
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40 font-semibold'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {t('Edit & Stamp')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangePlacement({ ...placement, sceneryStampAlways: true })}
                    className={`py-1 rounded text-[11px] border cursor-pointer ${
                      placement.sceneryStampAlways
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40 font-semibold'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {t('Stamp Always')}
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 leading-snug">
                  {t(
                    'Click scenery to select & stretch handles. Alt+Click samples style. Ctrl+Click always stamps.'
                  )}
                </div>

                {/* Scenery file & base dimensions */}
                <label className="space-y-1 block">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">{t('Scenery file')}</span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {sceneryPreviewDims.w}×{sceneryPreviewDims.h} px
                    </span>
                  </div>
                  <input
                    type="text"
                    list="sms-editor-sceneries"
                    value={placement.sceneryFilename}
                    onChange={(e) =>
                      onChangePlacement({ ...placement, sceneryFilename: e.target.value })
                    }
                    placeholder={t('Pick from Assets tab...')}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                  />
                </label>

                {/* Layer Back / Mid / Front */}
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      [0, t('Back (0)')],
                      [1, t('Mid (1)')],
                      [2, t('Front (2)')],
                    ] as const
                  ).map(([lvl, lbl]) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => onChangePlacement({ ...placement, sceneryLevel: lvl })}
                      className={`py-1 rounded text-[11px] border cursor-pointer ${
                        placement.sceneryLevel === lvl
                          ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {/* Scale & Stretch Defaults */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-300 font-medium">
                      {t('Stamp Scale & Stretch')}
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={placement.sceneryLockAspect}
                        onChange={(e) =>
                          onChangePlacement({ ...placement, sceneryLockAspect: e.target.checked })
                        }
                        className="accent-cyan-400"
                      />
                      <span>{t('Lock aspect')}</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    {[0.5, 1, 1.5, 2].map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() =>
                          onChangePlacement({
                            ...placement,
                            sceneryScaleX: sc,
                            sceneryScaleY: sc,
                          })
                        }
                        className="py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-mono text-zinc-300 cursor-pointer"
                      >
                        {sc}×
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 w-12 shrink-0">{t('Scale X')}</span>
                    <input
                      type="range"
                      min={0.1}
                      max={4}
                      step={0.05}
                      value={Math.min(4, Math.max(0.1, Math.abs(placement.sceneryScaleX)))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const signX = placement.sceneryScaleX < 0 ? -1 : 1;
                        const signY = placement.sceneryScaleY < 0 ? -1 : 1;
                        onChangePlacement({
                          ...placement,
                          sceneryScaleX: v * signX,
                          sceneryScaleY: placement.sceneryLockAspect
                            ? v * signY
                            : placement.sceneryScaleY,
                        });
                      }}
                      className="flex-1 accent-cyan-400"
                    />
                    <NumberInput
                      step={0.05}
                      value={Number(placement.sceneryScaleX.toFixed(2))}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 1;
                        onChangePlacement({
                          ...placement,
                          sceneryScaleX: v,
                          sceneryScaleY: placement.sceneryLockAspect ? v : placement.sceneryScaleY,
                        });
                      }}
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400 w-12 shrink-0">{t('Scale Y')}</span>
                    <input
                      type="range"
                      min={0.1}
                      max={4}
                      step={0.05}
                      value={Math.min(4, Math.max(0.1, Math.abs(placement.sceneryScaleY)))}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const signY = placement.sceneryScaleY < 0 ? -1 : 1;
                        const signX = placement.sceneryScaleX < 0 ? -1 : 1;
                        onChangePlacement({
                          ...placement,
                          sceneryScaleY: v * signY,
                          sceneryScaleX: placement.sceneryLockAspect
                            ? v * signX
                            : placement.sceneryScaleX,
                        });
                      }}
                      className="flex-1 accent-cyan-400"
                    />
                    <NumberInput
                      step={0.05}
                      value={Number(placement.sceneryScaleY.toFixed(2))}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 1;
                        onChangePlacement({
                          ...placement,
                          sceneryScaleY: v,
                          sceneryScaleX: placement.sceneryLockAspect ? v : placement.sceneryScaleX,
                        });
                      }}
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
                    />
                  </div>
                </div>

                {/* Rotation & Opacity */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      {t('Rotation: {deg}°', { deg: Math.round(placement.sceneryRotationDeg) })}
                    </span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={placement.sceneryRotationDeg}
                      onChange={(e) =>
                        onChangePlacement({
                          ...placement,
                          sceneryRotationDeg: Number(e.target.value),
                        })
                      }
                      className="w-32 accent-cyan-400"
                    />
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {[-90, -45, 0, 45, 90].map((deg) => (
                      <button
                        key={deg}
                        type="button"
                        onClick={() =>
                          onChangePlacement({ ...placement, sceneryRotationDeg: deg })
                        }
                        className="py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-mono text-zinc-300 cursor-pointer"
                      >
                        {deg > 0 ? `+${deg}°` : `${deg}°`}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[10px] text-zinc-400">
                      {t('Opacity: {pct}%', {
                        pct: Math.round((placement.sceneryAlpha / 255) * 100),
                      })}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="range"
                        min={0}
                        max={255}
                        value={placement.sceneryAlpha}
                        onChange={(e) =>
                          onChangePlacement({ ...placement, sceneryAlpha: Number(e.target.value) })
                        }
                        className="w-24 accent-cyan-400"
                      />
                      <span className="font-mono text-[10px] text-zinc-400 w-7 text-right">
                        {placement.sceneryAlpha}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Colorize & Atmosphere Presets */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">{t('Colorize & Atmosphere')}</span>
                    <EditorColorInput
                      value={rgbToHex(placement.sceneryTint)}
                      onChange={(e) =>
                        onChangePlacement({
                          ...placement,
                          sceneryTint: hexToRgb(e.target.value, 255),
                        })
                      }
                      className="w-7 h-5 rounded bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {SCENERY_TINT_PRESETS.map((pr) => (
                      <button
                        key={pr.labelEn}
                        type="button"
                        onClick={() =>
                          onChangePlacement({
                            ...placement,
                            sceneryTint: hexToRgb(pr.hex, 255),
                          })
                        }
                        className="py-1 px-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-white/20 shrink-0"
                          style={{ backgroundColor: pr.hex }}
                        />
                        <span className="truncate">{t(pr.labelEn)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scatter Randomizer */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={placement.sceneryRandomize}
                      onChange={(e) =>
                        onChangePlacement({ ...placement, sceneryRandomize: e.target.checked })
                      }
                      className="accent-emerald-400"
                    />
                    <span>{t('Scatter randomizer on stamp')}</span>
                  </label>
                  {placement.sceneryRandomize && (
                    <div className="pl-2 space-y-1.5 border-l border-zinc-800">
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-zinc-400">
                          {t('Scale jitter: ±{p}%', {
                            p: Math.round(placement.sceneryScaleJitter * 100),
                          })}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={60}
                          value={Math.round(placement.sceneryScaleJitter * 100)}
                          onChange={(e) =>
                            onChangePlacement({
                              ...placement,
                              sceneryScaleJitter: Number(e.target.value) / 100,
                            })
                          }
                          className="w-24 accent-emerald-400"
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-zinc-400">
                          {t('Angle jitter: ±{d}°', { d: placement.sceneryRotJitterDeg })}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          value={placement.sceneryRotJitterDeg}
                          onChange={(e) =>
                            onChangePlacement({
                              ...placement,
                              sceneryRotJitterDeg: Number(e.target.value),
                            })
                          }
                          className="w-24 accent-emerald-400"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[10px] text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={placement.sceneryRandomFlipX}
                          onChange={(e) =>
                            onChangePlacement({
                              ...placement,
                              sceneryRandomFlipX: e.target.checked,
                            })
                          }
                          className="accent-emerald-400"
                        />
                        <span>{t('Random horizontal mirror (Flip X)')}</span>
                      </label>
                    </div>
                  )}
                </div>
              </PanelCard>
            )}

            {activeTool === 'playtest' && (
              <PanelCard title={t('Live Soldier Playtest')}>
                <div className="flex items-center gap-2 text-[11px] text-emerald-300">
                  <Gamepad2 className="w-4 h-4 shrink-0" />
                  <span>{t('60 FPS Soldat movement, jetpack & polygon collision sandbox')}</span>
                </div>

                <div className="bg-zinc-900/80 border border-zinc-800 rounded p-2 text-[10px] text-zinc-300 space-y-1">
                  <div>
                    <strong className="text-zinc-100">A / D</strong> • {t('Run left / right')}
                  </div>
                  <div>
                    <strong className="text-zinc-100">W / S</strong> • {t('Jump / Crouch')}
                  </div>
                  <div>
                    <strong className="text-zinc-100">{t('Space / Shift')}</strong> • {t('Jetpack')}
                  </div>
                  <div>
                    <strong className="text-zinc-100">{t('Click canvas')}</strong> •{' '}
                    {t('Teleport soldier here')}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      [1, t('Alpha')],
                      [2, t('Bravo')],
                      [3, t('Charlie')],
                      [4, t('Delta')],
                    ] as const
                  ).map(([tm, name]) => (
                    <button
                      key={tm}
                      type="button"
                      onClick={() => onChangePlaytestTeam(tm)}
                      className={`py-1 rounded text-[10px] border cursor-pointer ${
                        playtestTeam === tm
                          ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40 font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={playtestCarryingFlag}
                    onChange={(e) => onChangePlaytestCarryingFlag(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  <span>{t('Carrying enemy flag (test flagger polys)')}</span>
                </label>

                {playtest && (
                  <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px] bg-zinc-900/70 rounded p-2 text-zinc-300">
                    <div>
                      X: {Math.round(playtest.x)} Y: {Math.round(playtest.y)}
                    </div>
                    <div>
                      |V|: {Math.hypot(playtest.vx, playtest.vy).toFixed(2)}
                    </div>
                    <div>
                      {t('Jet:')} {Math.round(playtest.jetFuel)}/{playtest.maxJetFuel}
                    </div>
                    <div>
                      {playtest.grounded
                        ? playtest.onIce
                          ? t('Ice floor')
                          : t('Grounded')
                        : t('Airborne')}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onRespawnPlaytest}
                  className="w-full py-1.5 rounded bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-100 text-[11px] font-semibold cursor-pointer"
                >
                  {t('Respawn Soldier [R]')}
                </button>
              </PanelCard>
            )}

            {activeTool === 'spawn' && (
              <PanelCard title={t('Spawn / Item Placement')}>
                <label className="space-y-1 block">
                  <span className="text-zinc-400 text-[11px]">{t('Object type (0–16)')}</span>
                  <select
                    value={placement.spawnTeam}
                    onChange={(e) =>
                      onChangePlacement({ ...placement, spawnTeam: Number(e.target.value) })
                    }
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                  >
                    {Object.values(SPAWN_TYPES).map((sp) => (
                      <option key={sp.team} value={sp.team}>
                        {sp.team}: {spawnTypeName(sp)}
                      </option>
                    ))}
                  </select>
                </label>
              </PanelCard>
            )}

            {activeTool === 'collider' && (
              <PanelCard title={t('Collider Placement')}>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400 text-[11px]">{t('Default diameter')}</span>
                  <NumberInput
                    min={4}
                    max={1000}
                    value={placement.colliderDiameter}
                    onChange={(e) =>
                      onChangePlacement({
                        ...placement,
                        colliderDiameter: Math.max(4, Number(e.target.value)),
                      })
                    }
                    className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                  />
                </label>
              </PanelCard>
            )}

            {activeTool === 'waypoint' && (
              <PanelCard title={t('Waypoint Placement')}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 block">
                    <span className="text-zinc-400 text-[11px]">{t('Bot path')}</span>
                    <select
                      value={placement.waypointPathNum}
                      onChange={(e) =>
                        onChangePlacement({
                          ...placement,
                          waypointPathNum: Number(e.target.value),
                        })
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                    >
                      <option value={1}>{t('Path 1 (Alpha)')}</option>
                      <option value={2}>{t('Path 2 (Bravo)')}</option>
                    </select>
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-zinc-400 text-[11px]">{t('Action')}</span>
                    <select
                      value={placement.waypointAction}
                      onChange={(e) =>
                        onChangePlacement({
                          ...placement,
                          waypointAction: Number(e.target.value),
                        })
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                    >
                      {Object.entries(WAYPOINT_ACTION_NAMES_EN).map(([id, name]) => (
                        <option key={id} value={Number(id)}>
                          {id}: {t(name)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </PanelCard>
            )}

            {/* 2. Transform & Alignment Panel when anything is selected */}
            {selectionSummary.bounds && (
              <PanelCard title={t('Transform & Alignment')}>
                {/* Exact position and size of the selection's box: typing moves / scales it (around its top-left) */}
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] text-zinc-300 bg-zinc-900/60 rounded p-2">
                  {(
                    [
                      ['X', selectionSummary.bounds.left, 'x'],
                      ['Y', selectionSummary.bounds.top, 'y'],
                      ['W', selectionSummary.bounds.width, 'w'],
                      ['H', selectionSummary.bounds.height, 'h'],
                    ] as const
                  ).map(([label, , field]) => {
                    const b = computeSelectionExactBounds(map, selection) ?? selectionSummary.bounds!;
                    const value = field === 'x' ? b.left : field === 'y' ? b.top : field === 'w' ? b.width : b.height;
                    const sizeLocked = (field === 'w' && b.width < 0.5) || (field === 'h' && b.height < 0.5);
                    return (
                      <label key={field} className="flex items-center gap-1.5">
                        <span className="w-3 text-zinc-500">{label}</span>
                        <NumberInput
                          value={Math.round(value * 10) / 10}
                          disabled={sizeLocked}
                          min={field === 'w' || field === 'h' ? 1 : undefined}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (field === 'x' || field === 'y') {
                              const dx = field === 'x' ? v - b.left : 0;
                              const dy = field === 'y' ? v - b.top : 0;
                              onCommitMutation(
                                'Move selection',
                                translateSelection(map, selection, dx, dy, {
                                  texWidth: texDims.w,
                                  texHeight: texDims.h,
                                  weldSharedVertices,
                                })
                              );
                            } else {
                              const sx = field === 'w' ? v / b.width : 1;
                              const sy = field === 'h' ? v / b.height : 1;
                              onCommitMutation(
                                'Scale selection',
                                scaleSelection(map, selection, sx, sy, b.left, b.top, { weldSharedVertices })
                              );
                            }
                          }}
                          className="w-full min-w-0 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100 disabled:opacity-40"
                        />
                      </label>
                    );
                  })}
                </div>

                {/* Move by ΔX / ΔY */}
                <div className="flex items-center gap-1.5">
                  <NumberInput
                    value={deltaX}
                    onChange={(e) => setDeltaX(Number(e.target.value))}
                    placeholder="ΔX"
                    className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                  />
                  <NumberInput
                    value={deltaY}
                    onChange={(e) => setDeltaY(Number(e.target.value))}
                    placeholder="ΔY"
                    className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!deltaX && !deltaY) return;
                      onCommitMutation(
                        'Move selection',
                        translateSelection(map, selection, deltaX, deltaY, {
                          texWidth: texDims.w,
                          texHeight: texDims.h,
                        })
                      );
                    }}
                    className="flex-1 py-1 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    {t('Move Δ')}
                  </button>
                </div>

                {/* Rotate & Flip */}
                <div className="flex items-center gap-1.5">
                  <NumberInput
                    value={rotDegInput}
                    onChange={(e) => setRotDegInput(Number(e.target.value))}
                    className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const b = selectionSummary.bounds!;
                      const rad = (rotDegInput * Math.PI) / 180;
                      onCommitMutation(
                        'Rotate selection',
                        rotateSelection(
                          map,
                          selection,
                          rad,
                          (b.left + b.right) * 0.5,
                          (b.top + b.bottom) * 0.5
                        )
                      );
                    }}
                    className="flex-1 py-1 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    {t('Rotate °')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const b = selectionSummary.bounds!;
                      onCommitMutation(
                        'Flip selection X',
                        scaleSelection(
                          map,
                          selection,
                          -1,
                          1,
                          (b.left + b.right) * 0.5,
                          (b.top + b.bottom) * 0.5
                        )
                      );
                    }}
                    title={t('Flip horizontally')}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const b = selectionSummary.bounds!;
                      onCommitMutation(
                        'Flip selection Y',
                        scaleSelection(
                          map,
                          selection,
                          1,
                          -1,
                          (b.left + b.right) * 0.5,
                          (b.top + b.bottom) * 0.5
                        )
                      );
                    }}
                    title={t('Flip vertically')}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    <FlipVertical className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Alignment Buttons (>= 2 objects) */}
                {selectionSummary.totalObjects >= 2 && (
                  <div className="grid grid-cols-6 gap-1 pt-1 border-t border-zinc-800/80">
                    {(
                      [
                        ['left', t('Align left'), <AlignStartVertical key="1" className="w-3.5 h-3.5" />],
                        ['center_x', t('Align center X'), <AlignCenterVertical key="2" className="w-3.5 h-3.5" />],
                        ['right', t('Align right'), <AlignEndVertical key="3" className="w-3.5 h-3.5" />],
                        ['top', t('Align top'), <AlignStartHorizontal key="4" className="w-3.5 h-3.5" />],
                        ['center_y', t('Align middle Y'), <AlignCenterHorizontal key="5" className="w-3.5 h-3.5" />],
                        ['bottom', t('Align bottom'), <AlignEndHorizontal key="6" className="w-3.5 h-3.5" />],
                      ] as const
                    ).map(([mode, title, icon]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => applyAlign(mode)}
                        title={title}
                        className="py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 flex items-center justify-center cursor-pointer"
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                )}
              </PanelCard>
            )}

            <PolygonInspector snapshot={snapshot} colors={colors} onCommitMutation={onCommitMutation}
              onPolygonDrawOrder={onPolygonDrawOrder} onResetPolygonUv={onResetPolygonUv} onFlipPolygonWinding={onFlipPolygonWinding}/>
            <SceneryInspector snapshot={snapshot} placement={placement} onChangePlacement={onChangePlacement}
              preferClassicBmp={preferClassicBmp} onPropDrawOrder={onPropDrawOrder} onCommitMutation={onCommitMutation}/>
            <EntityInspector snapshot={snapshot} onFocusBounds={onFocusBounds} onCommitMutation={onCommitMutation}/>

            {selectionSummary.totalObjects === 0 && selection.vertices.length === 0 && (
              <div className="text-center text-zinc-500 text-[11px] py-6">
                {t('Click or drag on the map to select polygons, vertices, sceneries, spawns, colliders, or waypoints.')}
              </div>
            )}

            <datalist id="sms-editor-sceneries">
              {(assetCatalog?.sceneries ?? []).map((sc) => (
                <option key={sc.name} value={sc.name} />
              ))}
            </datalist>
          </>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3">
            <PanelCard title={t('PMS Header & Environment')}>
              <label className="space-y-1 block">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Map description')}</span>
                  <span className="font-mono text-zinc-500">{map.mapName.length}/38</span>
                </div>
                <CommitTextInput
                  maxLength={38}
                  value={map.mapName}
                  onChange={(e) => onUpdateHeader({ mapName: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
                />
              </label>

              <label className="space-y-1 block">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Main texture')}</span>
                  <span className="font-mono text-zinc-500">{map.texture.length}/24</span>
                </div>
                <CommitTextInput
                  maxLength={24}
                  list="sms-editor-textures"
                  value={map.texture}
                  onChange={(e) => onUpdateHeader({ texture: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 font-mono text-zinc-100"
                />
                <datalist id="sms-editor-textures">
                  {(assetCatalog?.textures ?? []).map((tx) => (
                    <option key={tx.name} value={tx.name} />
                  ))}
                </datalist>
              </label>

              {/* Background Gradient */}
              <div className="space-y-1.5">
                <span className="text-zinc-400 text-[11px] block">{t('Sky background gradient')}</span>
                <div className="flex items-center gap-2">
                  <label className="flex-1 flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded p-1.5">
                    <EditorColorInput
                      value={rgbToHex(map.bgColorTop)}
                      onChange={(e) =>
                        onUpdateHeader({ bgColorTop: hexToRgb(e.target.value, 255) }, 'header_sky_top')
                      }
                      className="w-6 h-6 rounded bg-transparent cursor-pointer"
                    />
                    <span className="text-[11px] text-zinc-300">{t('Top')}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateHeader({ bgColorTop: map.bgColorBtm, bgColorBtm: map.bgColorTop })
                    }
                    title={t('Swap top & bottom colors')}
                    className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                  >
                    ⇄
                  </button>
                  <label className="flex-1 flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded p-1.5">
                    <EditorColorInput
                      value={rgbToHex(map.bgColorBtm)}
                      onChange={(e) =>
                        onUpdateHeader({ bgColorBtm: hexToRgb(e.target.value, 255) }, 'header_sky_bottom')
                      }
                      className="w-6 h-6 rounded bg-transparent cursor-pointer"
                    />
                    <span className="text-[11px] text-zinc-300">{t('Bottom')}</span>
                  </label>
                </div>
              </div>

              {/* Jet Fuel */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Jetpack fuel')}</span>
                  <span className="font-mono text-emerald-300">
                    {t('{jet} ({ticks} ticks)', { jet: map.startJet, ticks: map.startJetGame })}
                  </span>
                </div>
                <NumberInput
                  min={0}
                  max={10000}
                  value={map.startJet}
                  onChange={(e) => onUpdateHeader({ startJet: Number(e.target.value) }, 'header_jet')}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    [0, t('None')],
                    [50, t('Low')],
                    [100, t('Normal')],
                    [200, t('High')],
                    [800, t('Max')],
                  ].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => onUpdateHeader({ startJet: Number(val) })}
                      className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] text-zinc-300 cursor-pointer"
                    >
                      {lbl} ({val})
                    </button>
                  ))}
                </div>
              </div>

              {/* Kits & Weather & Steps */}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 block">
                  <span className="text-zinc-400 text-[11px]">{t('Grenade packs (0–12)')}</span>
                  <NumberInput
                    min={0}
                    max={12}
                    value={map.grenadePacks}
                    onChange={(e) => onUpdateHeader({ grenadePacks: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="text-zinc-400 text-[11px]">{t('Medikit packs (0–12)')}</span>
                  <NumberInput
                    min={0}
                    max={12}
                    value={map.medikits}
                    onChange={(e) => onUpdateHeader({ medikits: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="text-zinc-400 text-[11px]">{t('Weather')}</span>
                  <select
                    value={map.weather}
                    onChange={(e) => onUpdateHeader({ weather: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                  >
                    <option value={0}>0: {t('No weather')}</option>
                    <option value={1}>1: {t('Rain')}</option>
                    <option value={2}>2: {t('Sandstorm')}</option>
                    <option value={3}>3: {t('Snow')}</option>
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="text-zinc-400 text-[11px]">{t('Footsteps')}</span>
                  <select
                    value={map.steps}
                    onChange={(e) => onUpdateHeader({ steps: Number(e.target.value) })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
                  >
                    <option value={0}>0: {t('Hard ground')}</option>
                    <option value={1}>1: {t('Soft ground')}</option>
                    <option value={2}>2: {t('No footsteps')}</option>
                  </select>
                </label>
              </div>
            </PanelCard>
            <PanelCard title={t('Atmosphere')}>
              <SceneryHazeTools map={map} onCommit={onCommitMutation} />
            </PanelCard>
          </div>
        )}

        {activeTab === 'poly_fixer' && (
          <PolyFixerPanel key={snapshot.draftId} map={map} onCommit={onCommitMutation} onSelect={onUpdateSelection}
            onFrame={onFocusBounds} onMark={onSetValidationFocus}/>
        )}
        {activeTab === 'validation' && (
          <EditorChecksPanel
            onOpenPolyFixer={() => onChangeTab('poly_fixer')}
            onRemoveUnusedScenery={onRemoveUnusedScenery}
            issues={validationIssues}
            pending={validationPending}
            hintsEnabled={validationHintsEnabled}
            onToggleHints={onToggleValidationHints}
            onOpenIssue={(issue) => {
              if (issue.selection) onUpdateSelection(issue.selection);
              if (issue.focusBounds) onFocusBounds(issue.focusBounds);
              if (issue.focusPoint) onSetValidationFocus(issue.focusPoint);
            }}
            onFixIssue={onFixValidationIssue}
          />
        )}

        {activeTab === 'history' && (
          <div className="space-y-2">
            <div className="text-[11px] text-zinc-400">
              {t('Click any step to jump backward or forward without losing history.')}
            </div>
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg divide-y divide-zinc-800/70">
              <button
                type="button"
                onClick={() => onJumpToHistory(0)}
                className={`w-full text-left px-3 py-2 flex items-center justify-between cursor-pointer ${
                  snapshot.undoStack.length === 0
                    ? 'bg-cyan-500/15 text-cyan-200 font-semibold'
                    : 'text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                <span>{t('Initial opened state')}</span>
                <span className="font-mono text-[10px] text-zinc-500">#0</span>
              </button>
              {fullTimeline.map((entry, idx) => {
                const depth = idx + 1;
                const isCurrent = depth === snapshot.undoStack.length;
                const isUndone = depth > snapshot.undoStack.length;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onJumpToHistory(depth)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 cursor-pointer ${
                      isCurrent
                        ? 'bg-cyan-500/15 text-cyan-100 font-semibold'
                        : isUndone
                        ? 'text-zinc-500 hover:bg-zinc-900 italic'
                        : 'text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    <span className="truncate">{tText(entry.label)}</span>
                    <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                      {new Date(entry.timestamp).toLocaleTimeString(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

// Skips the many re-renders caused by pointer movement (see memoIgnoringCallbacks)
export const EditorRightDock = memoIgnoringCallbacks(EditorRightDockPanel);
