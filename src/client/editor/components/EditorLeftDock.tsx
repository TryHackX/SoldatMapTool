import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EditorAssetCatalogResponse,
  EditorAssetItem,
  EditorPrefabItem,
} from '@shared/apiTypes';
import { computePropAabb, PmsBounds, PmsMapData } from '@shared/pmsParser';
import { POLY_TYPES, SPAWN_TYPES } from '@shared/soldatConstants';
import {
  Boxes,
  Eye,
  EyeOff,
  FolderKanban,
  Image as ImageIcon,
  Layers,
  ListTree,
  LocateFixed,
  MousePointerClick,
  Lock,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  Unlock,
} from 'lucide-react';
import { polyTypeName, t, tp } from '../../i18n';
import { spawnTypeName } from '../../renderer/OverlayRenderer';
import { RenderLayerVisibility } from '../../renderer/types';
import {
  emptySelection,
  extractSelectionBundle,
} from '../EditorDocument';
import { propsUsingScenery, sceneryStem, sceneryUsageCounts } from '../sceneryOps';
import { mergeSelections } from '../spatialIndex';
import { memoIgnoringCallbacks } from '../memoIgnoringCallbacks';
import { NumberInput } from './EditorFields';
import {
  EditorBlueprintOverlay,
  EditorLayerLocks,
  EditorPlacementDefaults,
  EditorSelection,
  EditorSnapSettings,
  EditorToolId,
  LeftDockTab,
} from '../types';

interface EditorLeftDockProps {
  activeTab: LeftDockTab;
  onChangeTab: (tab: LeftDockTab) => void;
  map: PmsMapData;
  selection: EditorSelection;
  onUpdateSelection: (sel: EditorSelection) => void;
  onFocusBounds: (b: { left: number; right: number; top: number; bottom: number }) => void;
  layers: RenderLayerVisibility;
  onChangeLayers: (next: RenderLayerVisibility) => void;
  locks: EditorLayerLocks;
  onChangeLocks: (next: EditorLayerLocks) => void;
  snap: EditorSnapSettings;
  onChangeSnap: (next: EditorSnapSettings) => void;
  blueprint: EditorBlueprintOverlay | null;
  onChangeBlueprint: (next: EditorBlueprintOverlay | null) => void;
  onOpenImageTrace: () => void;
  assetCatalog: EditorAssetCatalogResponse | null;
  onRefreshAssets: () => void;
  placement: EditorPlacementDefaults;
  onChangePlacement: (next: EditorPlacementDefaults) => void;
  onSelectTool: (tool: EditorToolId) => void;
  onApplyMapTexture: (textureName: string) => void;
  activePrefab: EditorPrefabItem | null;
  onSelectPrefab: (prefab: EditorPrefabItem | null) => void;
  onReplaceSelectedScenery: (filename: string) => void;
  recentSceneries: string[];
}

const GRID_SIZES = [4, 8, 16, 32, 64, 128];

const EditorLeftDockPanel: React.FC<EditorLeftDockProps> = ({
  activeTab,
  onChangeTab,
  map,
  selection,
  onUpdateSelection,
  onFocusBounds,
  layers,
  onChangeLayers,
  locks,
  onChangeLocks,
  snap,
  onChangeSnap,
  blueprint,
  onChangeBlueprint,
  onOpenImageTrace,
  assetCatalog,
  onRefreshAssets,
  placement,
  onChangePlacement,
  onSelectTool,
  onApplyMapTexture,
  activePrefab,
  onSelectPrefab,
  onReplaceSelectedScenery,
  recentSceneries,
}) => {
  // Outliner state
  const [outlinerQuery, setOutlinerQuery] = useState('');
  const [outlinerCategory, setOutlinerCategory] = useState<
    'all' | 'polygon' | 'prop' | 'spawn' | 'collider' | 'waypoint'
  >('all');
  const [outlinerLimit, setOutlinerLimit] = useState(250);

  // Asset browser state
  const [assetCategory, setAssetCategory] = useState<'scenery-gfx' | 'textures'>('scenery-gfx');
  const [assetQuery, setAssetQuery] = useState('');
  const [assetSourceFilter, setAssetSourceFilter] = useState<'all' | 'vanilla' | 'custom'>('all');
  const [assetLimit, setAssetLimit] = useState(120);
  const [assetUsedOnly, setAssetUsedOnly] = useState(false);
  const [loadedDims, setLoadedDims] = useState<Record<string, string>>({});

  // Prefabs state
  const [prefabs, setPrefabs] = useState<EditorPrefabItem[]>([]);
  const [prefabName, setPrefabName] = useState('');
  const [savingPrefab, setSavingPrefab] = useState(false);

  const loadPrefabs = useCallback(async () => {
    try {
      const res = await fetch('/api/editor/prefabs');
      if (!res.ok) return;
      const data = (await res.json()) as { prefabs: EditorPrefabItem[] };
      setPrefabs(data.prefabs ?? []);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'prefabs') {
      void loadPrefabs();
    }
  }, [activeTab, loadPrefabs]);

  const handleSaveSelectionAsPrefab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefabName.trim()) return;
    const extracted = extractSelectionBundle(map, selection);
    if (!extracted) return;
    setSavingPrefab(true);
    try {
      const res = await fetch('/api/editor/prefabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: prefabName.trim(),
          bounds: extracted.bounds,
          bundle: extracted.bundle,
        }),
      });
      if (res.ok) {
        setPrefabName('');
        await loadPrefabs();
      }
    } finally {
      setSavingPrefab(false);
    }
  };

  const handleDeletePrefab = async (id: string) => {
    try {
      await fetch(`/api/editor/prefabs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (activePrefab?.id === id) onSelectPrefab(null);
      await loadPrefabs();
    } catch {
      // Ignore
    }
  };

  // Build Outliner items
  const outlinerItems = useMemo(() => {
    const q = outlinerQuery.trim().toLowerCase();
    const list: Array<{
      kind: 'polygon' | 'prop' | 'spawn' | 'collider' | 'waypoint';
      index: number;
      label: string;
      sub: string;
      color: string;
      selected: boolean;
      bounds: { left: number; right: number; top: number; bottom: number };
    }> = [];

    if (outlinerCategory === 'all' || outlinerCategory === 'polygon') {
      const selSet = new Set(selection.polygons);
      for (let i = 0; i < map.polygons.length; i++) {
        const p = map.polygons[i];
        const meta = POLY_TYPES[p.polyType];
        const typeLabel = meta ? polyTypeName(meta) : t('Type {n}', { n: p.polyType });
        const label = `${t('Polygon')} #${i + 1}`;
        if (q && !label.toLowerCase().includes(q) && !typeLabel.toLowerCase().includes(q)) continue;
        const xs = p.vertices.map((v) => v.x);
        const ys = p.vertices.map((v) => v.y);
        list.push({
          kind: 'polygon',
          index: i,
          label,
          sub: typeLabel,
          color: meta?.color || '#64748b',
          selected: selSet.has(i),
          bounds: {
            left: Math.min(...xs),
            right: Math.max(...xs),
            top: Math.min(...ys),
            bottom: Math.max(...ys),
          },
        });
      }
    }

    if (outlinerCategory === 'all' || outlinerCategory === 'prop') {
      const selSet = new Set(selection.props);
      for (let i = 0; i < map.props.length; i++) {
        const p = map.props[i];
        if (!p.active) continue;
        const scName = map.scenery[p.style - 1]?.filename || t('(missing)');
        const label = `${t('Scenery')} #${i + 1}`;
        if (q && !label.toLowerCase().includes(q) && !scName.toLowerCase().includes(q)) continue;
        const aabb: PmsBounds = computePropAabb(p);
        list.push({
          kind: 'prop',
          index: i,
          label,
          sub: `${scName} (L${p.level})`,
          color: p.level === 2 ? '#fbbf24' : p.level === 1 ? '#34d399' : '#38bdf8',
          selected: selSet.has(i),
          bounds: aabb,
        });
      }
    }

    if (outlinerCategory === 'all' || outlinerCategory === 'spawn') {
      const selSet = new Set(selection.spawns);
      for (let i = 0; i < map.spawnpoints.length; i++) {
        const sp = map.spawnpoints[i];
        if (!sp.active) continue;
        const meta = SPAWN_TYPES[sp.team];
        const sName = meta ? spawnTypeName(meta) : t('Type {n}', { n: sp.team });
        const label = `${t('Spawn')} #${i + 1}`;
        if (q && !label.toLowerCase().includes(q) && !sName.toLowerCase().includes(q)) continue;
        list.push({
          kind: 'spawn',
          index: i,
          label,
          sub: `${sName} (${sp.x}, ${sp.y})`,
          color: meta?.color || '#38bdf8',
          selected: selSet.has(i),
          bounds: { left: sp.x - 40, right: sp.x + 40, top: sp.y - 40, bottom: sp.y + 40 },
        });
      }
    }

    if (outlinerCategory === 'all' || outlinerCategory === 'collider') {
      const selSet = new Set(selection.colliders);
      for (let i = 0; i < map.colliders.length; i++) {
        const col = map.colliders[i];
        if (!col.active) continue;
        const label = `${t('Collider')} #${i + 1}`;
        const sub = `Ø ${Math.round(col.radius)} (${Math.round(col.x)}, ${Math.round(col.y)})`;
        if (q && !label.toLowerCase().includes(q) && !sub.toLowerCase().includes(q)) continue;
        const r = Math.max(24, Math.abs(col.radius));
        list.push({
          kind: 'collider',
          index: i,
          label,
          sub,
          color: '#22d3ee',
          selected: selSet.has(i),
          bounds: { left: col.x - r, right: col.x + r, top: col.y - r, bottom: col.y + r },
        });
      }
    }

    if (outlinerCategory === 'all' || outlinerCategory === 'waypoint') {
      const selSet = new Set(selection.waypoints);
      for (let i = 0; i < map.waypoints.length; i++) {
        const wp = map.waypoints[i];
        if (!wp.active) continue;
        const label = `${t('Waypoint')} #${i + 1}`;
        const sub = `${t('Path {n}', { n: wp.pathNum })} • ${tp(wp.connections.length, '{count} link', '{count} links')}`;
        if (q && !label.toLowerCase().includes(q) && !sub.toLowerCase().includes(q)) continue;
        list.push({
          kind: 'waypoint',
          index: i,
          label,
          sub,
          color: wp.pathNum === 2 ? '#60a5fa' : '#facc15',
          selected: selSet.has(i),
          bounds: { left: wp.x - 40, right: wp.x + 40, top: wp.y - 40, bottom: wp.y + 40 },
        });
      }
    }

    return list;
  }, [map, selection, outlinerQuery, outlinerCategory]);

  // Filtered Asset Browser items
  // Distinct scenery images (a .bmp and its .png twin are one image) for the tab label
  const sceneryImageCount = useMemo(
    () => new Set((assetCatalog?.sceneries ?? []).map((item) => sceneryStem(item.name))).size,
    [assetCatalog]
  );

  // How many props of the open map draw each scenery (by stem: "x.bmp" and its "x.png" are one image in game)
  const sceneryUsage = useMemo(() => sceneryUsageCounts(map), [map.props, map.scenery]);

  const filteredAssets = useMemo(() => {
    let rawList: Array<EditorAssetItem & { hdTwin?: boolean }> =
      assetCategory === 'scenery-gfx'
        ? assetCatalog?.sceneries ?? []
        : assetCatalog?.textures ?? [];
    if (assetCategory === 'scenery-gfx') {
      // One card per image: the .bmp name (what maps store; 1.7.1 then loads its .png twin), marked HD
      const byStem = new Map<string, EditorAssetItem & { hdTwin?: boolean }>();
      for (const item of rawList) {
        const stem = sceneryStem(item.name);
        const prev = byStem.get(stem);
        if (!prev) {
          byStem.set(stem, item);
          continue;
        }
        const itemIsBmp = item.name.toLowerCase().endsWith('.bmp');
        const keep = itemIsBmp ? item : prev;
        byStem.set(stem, { ...keep, hdTwin: true });
      }
      rawList = Array.from(byStem.values());
    }
    const q = assetQuery.trim().toLowerCase();
    return rawList.filter((item) => {
      if (assetSourceFilter === 'vanilla' && !item.isVanilla) return false;
      if (assetSourceFilter === 'custom' && item.isVanilla) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (assetUsedOnly && assetCategory === 'scenery-gfx' && !sceneryUsage.has(sceneryStem(item.name))) return false;
      return true;
    });
  }, [assetCatalog, assetCategory, assetQuery, assetSourceFilter, assetUsedOnly, sceneryUsage]);

  const canSavePrefab =
    selection.polygons.length +
      selection.props.length +
      selection.spawns.length +
      selection.colliders.length +
      selection.waypoints.length >
    0;

  return (
    <aside className="w-68 2xl:w-76 shrink-0 bg-zinc-900/95 border-r border-zinc-800/90 flex flex-col h-full select-none">
      {/* Dock Tabs */}
      <div className="grid grid-cols-4 border-b border-zinc-800 text-[11px] font-semibold">
        {(
          [
            ['layers', t('Layers'), <Layers key="l" className="w-3.5 h-3.5" />],
            ['outliner', t('Outliner'), <ListTree key="o" className="w-3.5 h-3.5" />],
            ['assets', t('Assets'), <ImageIcon key="a" className="w-3.5 h-3.5" />],
            ['prefabs', t('Prefabs'), <Boxes key="p" className="w-3.5 h-3.5" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChangeTab(id)}
            className={`py-2 px-1 flex flex-col items-center justify-center gap-0.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === id
                ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {icon}
            <span className="truncate max-w-full">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 text-xs space-y-4">
        {activeTab === 'layers' && (
          <>
            {/* Object Layers: Show/Hide + Lock */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {t('Object Layers (Visibility & Lock)')}
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg divide-y divide-zinc-800/70">
                <LayerControlRow
                  label={t('Polygons')}
                  count={map.polygons.length}
                  visible={layers.showPolygons}
                  locked={locks.polygons}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showPolygons: !layers.showPolygons })
                  }
                  onToggleLocked={() => onChangeLocks({ ...locks, polygons: !locks.polygons })}
                />
                <LayerControlRow
                  label={t('Back Scenery (0)')}
                  count={map.props.filter((p) => p.active && p.level === 0).length}
                  visible={layers.showSceneryBack}
                  locked={locks.sceneryBack}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showSceneryBack: !layers.showSceneryBack })
                  }
                  onToggleLocked={() =>
                    onChangeLocks({ ...locks, sceneryBack: !locks.sceneryBack })
                  }
                />
                <LayerControlRow
                  label={t('Middle Scenery (1)')}
                  count={map.props.filter((p) => p.active && p.level === 1).length}
                  visible={layers.showSceneryMid}
                  locked={locks.sceneryMid}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showSceneryMid: !layers.showSceneryMid })
                  }
                  onToggleLocked={() => onChangeLocks({ ...locks, sceneryMid: !locks.sceneryMid })}
                />
                <LayerControlRow
                  label={t('Front Scenery (2)')}
                  count={map.props.filter((p) => p.active && p.level === 2).length}
                  visible={layers.showSceneryFront}
                  locked={locks.sceneryFront}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showSceneryFront: !layers.showSceneryFront })
                  }
                  onToggleLocked={() =>
                    onChangeLocks({ ...locks, sceneryFront: !locks.sceneryFront })
                  }
                />
                {layers.showSceneryFront && (
                  <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 bg-zinc-900/40">
                    <span className="text-[11px] text-zinc-400">{t('Front cover opacity')}</span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={Math.round(layers.frontSceneryOpacity * 100)}
                      onChange={(e) =>
                        onChangeLayers({
                          ...layers,
                          frontSceneryOpacity: Number(e.target.value) / 100,
                        })
                      }
                      className="w-24 accent-cyan-400"
                    />
                  </div>
                )}
                <LayerControlRow
                  label={t('Flags')}
                  visible={layers.showFlags}
                  locked={locks.flags}
                  onToggleVisible={() => onChangeLayers({ ...layers, showFlags: !layers.showFlags })}
                  onToggleLocked={() => onChangeLocks({ ...locks, flags: !locks.flags })}
                />
                <LayerControlRow
                  label={t('Spawn points')}
                  visible={layers.showSpawns}
                  locked={locks.spawns}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showSpawns: !layers.showSpawns })
                  }
                  onToggleLocked={() => onChangeLocks({ ...locks, spawns: !locks.spawns })}
                />
                <LayerControlRow
                  label={t('Bonuses')}
                  visible={layers.showBonuses}
                  locked={locks.bonuses}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showBonuses: !layers.showBonuses })
                  }
                  onToggleLocked={() => onChangeLocks({ ...locks, bonuses: !locks.bonuses })}
                />
                <LayerControlRow
                  label={t('Colliders')}
                  count={map.colliders.filter((c) => c.active).length}
                  visible={layers.showColliders}
                  locked={locks.colliders}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showColliders: !layers.showColliders })
                  }
                  onToggleLocked={() => onChangeLocks({ ...locks, colliders: !locks.colliders })}
                />
                <LayerControlRow
                  label={t('Bot waypoints')}
                  count={map.waypoints.filter((w) => w.active).length}
                  visible={layers.showWaypoints}
                  locked={locks.waypoints}
                  onToggleVisible={() =>
                    onChangeLayers({ ...layers, showWaypoints: !layers.showWaypoints })
                  }
                  onToggleLocked={() => onChangeLocks({ ...locks, waypoints: !locks.waypoints })}
                />
              </div>
            </div>

            {/* Snap & Grid Settings */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {t('Snapping & Welding')}
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-2.5 space-y-2">
                <CheckboxRow
                  checked={snap.snapToGrid}
                  onChange={(v) => onChangeSnap({ ...snap, snapToGrid: v })}
                  label={`${t('Snap to grid')} [G]`}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400 text-[11px]">{t('Grid size (units)')}</span>
                  <div className="flex items-center gap-1">
                    {GRID_SIZES.map((gs) => (
                      <button
                        key={gs}
                        type="button"
                        onClick={() => onChangeSnap({ ...snap, gridSize: gs })}
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] cursor-pointer ${
                          snap.gridSize === gs
                            ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40'
                            : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {gs}
                      </button>
                    ))}
                  </div>
                </div>
                <CheckboxRow
                  checked={snap.snapToVertices}
                  onChange={(v) => onChangeSnap({ ...snap, snapToVertices: v })}
                  label={t('Snap to polygon vertices')}
                />
                <CheckboxRow
                  checked={snap.snapToEdges}
                  onChange={(v) => onChangeSnap({ ...snap, snapToEdges: v })}
                  label={t('Snap to polygon edges')}
                />
                <CheckboxRow
                  checked={snap.angleSnap}
                  onChange={(v) => onChangeSnap({ ...snap, angleSnap: v })}
                  label={t('Snap angles to 15° steps')}
                />
                <CheckboxRow
                  checked={snap.smartGuides}
                  onChange={(v) => onChangeSnap({ ...snap, smartGuides: v })}
                  label={t('Smart alignment guides')}
                />
                <CheckboxRow
                  checked={snap.weldSharedVertices}
                  onChange={(v) => onChangeSnap({ ...snap, weldSharedVertices: v })}
                  label={t('Move welded shared vertices together')}
                />
              </div>
            </div>

            {/* Reference Blueprint Underlay */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {t('Reference Blueprint')}
                </div>
                <button
                  type="button"
                  onClick={onOpenImageTrace}
                  className="text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold cursor-pointer"
                >
                  {blueprint ? t('Change...') : t('Load Image...')}
                </button>
              </div>
              {blueprint ? (
                <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-cyan-200 truncate">
                      {blueprint.name}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onChangeBlueprint({ ...blueprint, visible: !blueprint.visible })
                        }
                        title={blueprint.visible ? t('Hide blueprint') : t('Show blueprint')}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-300 cursor-pointer"
                      >
                        {blueprint.visible ? (
                          <Eye className="w-3.5 h-3.5 text-cyan-300" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-zinc-500" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeBlueprint(null)}
                        title={t('Remove blueprint')}
                        className="p-1 rounded hover:bg-red-500/20 text-zinc-400 hover:text-red-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <label className="space-y-0.5 block">
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>{t('Blueprint opacity')}</span>
                      <span className="font-mono text-zinc-200">
                        {Math.round(blueprint.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={95}
                      value={Math.round(blueprint.opacity * 100)}
                      onChange={(e) =>
                        onChangeBlueprint({
                          ...blueprint,
                          opacity: Number(e.target.value) / 100,
                        })
                      }
                      className="w-full accent-cyan-400"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-zinc-500">{t('Scale')}</span>
                      <NumberInput
                        step={0.25}
                        min={0.05}
                        value={blueprint.scale}
                        onChange={(e) =>
                          onChangeBlueprint({
                            ...blueprint,
                            scale: Math.max(0.05, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
                      />
                    </label>
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-zinc-500">X</span>
                      <NumberInput
                        value={Math.round(blueprint.x)}
                        onChange={(e) =>
                          onChangeBlueprint({ ...blueprint, x: Number(e.target.value) || 0 })
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
                      />
                    </label>
                    <label className="space-y-0.5 block">
                      <span className="text-[10px] text-zinc-500">Y</span>
                      <NumberInput
                        value={Math.round(blueprint.y)}
                        onChange={(e) =>
                          onChangeBlueprint({ ...blueprint, y: Number(e.target.value) || 0 })
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onOpenImageTrace}
                  className="w-full py-2 px-2.5 rounded-lg bg-zinc-950/60 hover:bg-zinc-900 border border-dashed border-zinc-800 hover:border-emerald-500/40 text-[11px] text-zinc-400 hover:text-zinc-200 text-left cursor-pointer transition"
                >
                  {t('Pin a sketch or convert an image into Soldat polygons...')}
                </button>
              )}
            </div>
          </>
        )}

        {activeTab === 'outliner' && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
              <input
                type="text"
                value={outlinerQuery}
                onChange={(e) => {
                  setOutlinerQuery(e.target.value);
                  setOutlinerLimit(250);
                }}
                placeholder={t('Filter objects...')}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8 pr-2.5 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['all', t('All')],
                  ['polygon', t('Polys')],
                  ['prop', t('Scen.')],
                  ['spawn', t('Spawns')],
                  ['collider', t('Cols')],
                  ['waypoint', t('Bots')],
                ] as const
              ).map(([cat, label]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setOutlinerCategory(cat);
                    setOutlinerLimit(250);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                    outlinerCategory === cat
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-[10px] text-zinc-500">
              {t('Showing {shown} of {total} objects', {
                shown: Math.min(outlinerItems.length, outlinerLimit),
                total: outlinerItems.length,
              })}
            </div>

            <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg divide-y divide-zinc-800/60">
              {outlinerItems.slice(0, outlinerLimit).map((item) => {
                const singleSel: EditorSelection = {
                  ...emptySelection(),
                  ...(item.kind === 'polygon' ? { polygons: [item.index] } : {}),
                  ...(item.kind === 'prop' ? { props: [item.index] } : {}),
                  ...(item.kind === 'spawn' ? { spawns: [item.index] } : {}),
                  ...(item.kind === 'collider' ? { colliders: [item.index] } : {}),
                  ...(item.kind === 'waypoint' ? { waypoints: [item.index] } : {}),
                };
                return (
                  <div
                    key={`${item.kind}-${item.index}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        onUpdateSelection(mergeSelections(selection, singleSel, 'toggle'));
                      } else {
                        onUpdateSelection(singleSel);
                      }
                    }}
                    onDoubleClick={() => onFocusBounds(item.bounds)}
                    className={`px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer ${
                      item.selected ? 'bg-cyan-500/15 text-cyan-100' : 'hover:bg-zinc-900'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] truncate">{item.label}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{item.sub}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateSelection(singleSel);
                        onFocusBounds(item.bounds);
                      }}
                      title={t('Focus camera on object')}
                      className="p-1 rounded text-zinc-500 hover:text-cyan-300 hover:bg-zinc-800 shrink-0 cursor-pointer"
                    >
                      <LocateFixed className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {outlinerItems.length === 0 && (
                <div className="p-3 text-center text-zinc-500 text-[11px]">
                  {t('No matching objects.')}
                </div>
              )}
            </div>

            {outlinerItems.length > outlinerLimit && (
              <button
                type="button"
                onClick={() => setOutlinerLimit((n) => n + 300)}
                className="w-full py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 cursor-pointer"
              >
                {t('Show more ({remaining} left)', {
                  remaining: outlinerItems.length - outlinerLimit,
                })}
              </button>
            )}
          </div>
        )}

        {activeTab === 'assets' && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setAssetCategory('scenery-gfx');
                  setAssetLimit(120);
                }}
                className={`py-1 rounded text-[11px] font-semibold cursor-pointer ${
                  assetCategory === 'scenery-gfx'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('Sceneries ({count})', { count: sceneryImageCount })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssetCategory('textures');
                  setAssetLimit(120);
                }}
                className={`py-1 rounded text-[11px] font-semibold cursor-pointer ${
                  assetCategory === 'textures'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('Textures ({count})', { count: assetCatalog?.textures.length ?? 0 })}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={assetQuery}
                  onChange={(e) => {
                    setAssetQuery(e.target.value);
                    setAssetLimit(120);
                  }}
                  placeholder={t('Search files...')}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8 pr-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={onRefreshAssets}
                title={t('Reload asset catalog from disk')}
                className="p-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              {(
                [
                  ['all', t('All')],
                  ['vanilla', t('Stock')],
                  ['custom', t('Custom')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAssetSourceFilter(id)}
                  className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                    assetSourceFilter === id
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              {assetCategory === 'scenery-gfx' && (
                <button
                  type="button"
                  onClick={() => setAssetUsedOnly((v) => !v)}
                  aria-pressed={assetUsedOnly}
                  title={t('Show only the sceneries this map uses')}
                  className={`ml-auto px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                    assetUsedOnly
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {t('In this map')}
                </button>
              )}
            </div>

            {assetCategory === 'scenery-gfx' && recentSceneries.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-zinc-500">{t('Recently stamped')}</div>
                <div className="flex flex-wrap gap-1">
                  {recentSceneries.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        onChangePlacement({ ...placement, sceneryFilename: name });
                        onSelectTool('scenery');
                      }}
                      title={name}
                      className={`w-9 h-9 rounded border flex items-center justify-center overflow-hidden cursor-pointer ${
                        placement.sceneryFilename.toLowerCase() === name.toLowerCase()
                          ? 'border-cyan-400/70 bg-cyan-500/10'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                      }`}
                    >
                      <img
                        src={`/api/assets?category=scenery-gfx&name=${encodeURIComponent(name)}&convert=png&colorkey=1`}
                        alt={name}
                        loading="lazy"
                        className="max-w-full max-h-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {filteredAssets.slice(0, assetLimit).map((item) => {
                const isSelected =
                  assetCategory === 'scenery-gfx'
                    ? placement.sceneryFilename.toLowerCase() === item.name.toLowerCase()
                    : map.texture.toLowerCase() === item.name.toLowerCase();
                const thumbUrl = `/api/assets?category=${encodeURIComponent(
                  assetCategory
                )}&name=${encodeURIComponent(item.name)}&convert=png${
                  assetCategory === 'scenery-gfx' ? '&colorkey=1' : ''
                }`;
                const dimKey = `${assetCategory}:${item.name}`;
                const tooLongForPms = assetCategory === 'textures' && item.name.length > 24;
                const usedCount = assetCategory === 'scenery-gfx' ? sceneryUsage.get(sceneryStem(item.name)) ?? 0 : 0;
                return (
                  <div key={item.name} className="relative group">
                  <button
                    type="button"
                    disabled={tooLongForPms}
                    onClick={() => {
                      if (assetCategory === 'scenery-gfx') {
                        onChangePlacement({ ...placement, sceneryFilename: item.name });
                        onSelectTool('scenery');
                      } else if (!tooLongForPms) {
                        onApplyMapTexture(item.name);
                      }
                    }}
                    title={
                      assetCategory === 'scenery-gfx'
                        ? t('Select {name} for Scenery tool [E]', { name: item.name })
                        : tooLongForPms
                        ? t('Texture file name exceeds PMS 24-character limit ({name})', { name: item.name })
                        : t('Set map main texture to {name}', { name: item.name })
                    }
                    className={`p-1.5 rounded-lg border text-left transition-colors flex flex-col gap-1 ${
                      tooLongForPms
                        ? 'opacity-45 cursor-not-allowed bg-zinc-950/60 border-red-900/40 text-zinc-500'
                        : isSelected
                        ? 'cursor-pointer bg-cyan-500/15 border-cyan-400/60 text-cyan-100'
                        : 'cursor-pointer bg-zinc-950/80 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                    }`}
                  >
                    <div className="h-16 rounded bg-zinc-900/90 flex items-center justify-center overflow-hidden">
                      <img
                        src={thumbUrl}
                        alt={item.name}
                        loading="lazy"
                        onLoad={(e) => {
                          const el = e.currentTarget;
                          if (el.naturalWidth > 0 && !loadedDims[dimKey]) {
                            setLoadedDims((prev) => ({
                              ...prev,
                              [dimKey]: `${el.naturalWidth}×${el.naturalHeight}`,
                            }));
                          }
                        }}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="font-mono text-[10px] truncate w-full">{item.name}</div>
                    <div className="flex items-center justify-between gap-1 text-[9px] text-zinc-500 w-full">
                      <span className="truncate">
                        {loadedDims[dimKey] || (item.name.toLowerCase().endsWith('.png') ? 'PNG' : 'BMP')}
                        {'hdTwin' in item && item.hdTwin && (
                          <span className="ml-1 text-amber-300" title={t('An HD .png version is loaded instead in Soldat 1.7.1')}>
                            HD
                          </span>
                        )}
                      </span>
                      {usedCount > 0 && (
                        <span className="px-1 rounded bg-cyan-500/20 text-cyan-200 font-semibold" title={t('Used {count}× in this map', { count: usedCount })}>
                          ×{usedCount}
                        </span>
                      )}
                      <span
                        className={item.isVanilla ? 'text-sky-400' : 'text-emerald-400'}
                        title={item.isVanilla ? t('Comes with Soldat') : t('Custom file')}
                      >
                        {item.isVanilla ? t('stock') : t('custom')}
                      </span>
                    </div>
                  </button>
                  {assetCategory === 'scenery-gfx' && (usedCount > 0 || selection.props.length > 0) && (
                    <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                      {usedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => onUpdateSelection({ ...emptySelection(), props: propsUsingScenery(map, item.name) })}
                          title={t('Select all {count} in the map', { count: usedCount })}
                          className="p-1 rounded bg-zinc-950/90 border border-zinc-700 text-zinc-300 hover:text-cyan-200 cursor-pointer"
                        >
                          <MousePointerClick className="w-3 h-3" />
                        </button>
                      )}
                      {selection.props.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onReplaceSelectedScenery(item.name)}
                          title={t('Use this image for the {count} selected sceneries', { count: selection.props.length })}
                          className="p-1 rounded bg-zinc-950/90 border border-zinc-700 text-zinc-300 hover:text-amber-200 cursor-pointer"
                        >
                          <Replace className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                  </div>
                );
              })}
            </div>

            {filteredAssets.length > assetLimit && (
              <button
                type="button"
                onClick={() => setAssetLimit((n) => n + 120)}
                className="w-full py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 cursor-pointer"
              >
                {t('Show more ({remaining} left)', {
                  remaining: filteredAssets.length - assetLimit,
                })}
              </button>
            )}
          </div>
        )}

        {activeTab === 'prefabs' && (
          <div className="space-y-3">
            <form
              onSubmit={handleSaveSelectionAsPrefab}
              className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-2.5 space-y-2"
            >
              <div className="text-[11px] font-semibold text-zinc-200 flex items-center gap-1.5">
                <FolderKanban className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t('Save Selection as Prefab')}</span>
              </div>
              <input
                type="text"
                value={prefabName}
                onChange={(e) => setPrefabName(e.target.value)}
                placeholder={t('Prefab name (e.g. Bunker, Flag Base)...')}
                maxLength={60}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!canSavePrefab || !prefabName.trim() || savingPrefab}
                className="w-full py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-35 text-xs font-semibold text-white flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('Save Prefab')}</span>
              </button>
            </form>

            {activePrefab && (
              <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-lg p-2.5 flex items-center justify-between gap-2 text-[11px] text-emerald-100">
                <span className="truncate">
                  {t('Stamping: {name} (click map)', { name: activePrefab.name })}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectPrefab(null)}
                  className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-200 cursor-pointer shrink-0"
                >
                  {t('Stop')}
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              {prefabs.map((pf) => {
                const selected = activePrefab?.id === pf.id;
                return (
                  <div
                    key={pf.id}
                    className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                      selected
                        ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-100'
                        : 'bg-zinc-950/70 border-zinc-800 text-zinc-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectPrefab(selected ? null : pf)}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="font-semibold text-xs truncate">{pf.name}</div>
                      <div className="text-[10px] text-zinc-400 font-mono">
                        {t('{polys} polygons • {props} sceneries', {
                          polys: pf.bundle.polygons.length,
                          props: pf.bundle.props.length,
                        })}{' '}
                        •{' '}
                        {Math.round(pf.bounds.width)}×{Math.round(pf.bounds.height)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePrefab(pf.id)}
                      title={t('Delete prefab')}
                      className="p-1 rounded text-zinc-500 hover:text-red-300 hover:bg-zinc-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {prefabs.length === 0 && (
                <div className="text-center text-zinc-500 text-[11px] py-4">
                  {t('Select any map elements and save them here for 1-click reuse across maps.')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

const LayerControlRow: React.FC<{
  label: string;
  count?: number;
  visible: boolean;
  locked: boolean;
  onToggleVisible: () => void;
  onToggleLocked: () => void;
}> = ({ label, count, visible, locked, onToggleVisible, onToggleLocked }) => (
  <div className="px-2.5 py-1.5 flex items-center justify-between gap-2">
    <span className={`truncate text-xs ${visible ? 'text-zinc-200' : 'text-zinc-500'}`}>
      {label}
      {count !== undefined && (
        <span className="ml-1.5 font-mono text-[10px] text-zinc-500">({count})</span>
      )}
    </span>
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onToggleVisible}
        title={visible ? t('Hide layer') : t('Show layer')}
        className={`p-1 rounded cursor-pointer ${
          visible ? 'text-emerald-400 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-300'
        }`}
      >
        {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>
      <button
        type="button"
        onClick={onToggleLocked}
        title={locked ? t('Unlock layer') : t('Lock layer from selection')}
        className={`p-1 rounded cursor-pointer ${
          locked ? 'text-amber-400 bg-amber-500/15' : 'text-zinc-600 hover:text-zinc-300'
        }`}
      >
        {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
      </button>
    </div>
  </div>
);

const CheckboxRow: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
    />
    <span>{label}</span>
  </label>
);

// Skips the many re-renders caused by pointer movement (see memoIgnoringCallbacks)
export const EditorLeftDock = memoIgnoringCallbacks(EditorLeftDockPanel);
