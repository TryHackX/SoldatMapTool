import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search, X } from 'lucide-react';
import { t } from '../../i18n';
import { RenderLayerVisibility } from '../../renderer/types';
import { EDITOR_TOOLS } from './EditorToolRail';
import { EditorSnapSettings, EditorToolId, RightDockTab } from '../types';

export interface CommandPaletteAction {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

interface EditorCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  layers: RenderLayerVisibility;
  onChangeLayers: (next: RenderLayerVisibility) => void;
  snap: EditorSnapSettings;
  onChangeSnap: (next: EditorSnapSettings) => void;
  onSelectTool: (tool: EditorToolId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onWorldAlignUvs: () => void;
  onFlipWinding: () => void;
  onOpenSymmetry: () => void;
  onOpenImageTrace: () => void;
  onApplyGrassCrust: () => void;
  onApplyReliefShading: () => void;
  onSubdividePolygons: () => void;
  onGenerateIsland: () => void;
  onOpenSave: () => void;
  onOpenNewMap: () => void;
  onSelectRightTab: (tab: RightDockTab) => void;
  extraActions?: CommandPaletteAction[];
}

export const EditorCommandPalette: React.FC<EditorCommandPaletteProps> = ({
  open,
  onClose,
  layers,
  onChangeLayers,
  snap,
  onChangeSnap,
  onSelectTool,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onSelectAll,
  onWorldAlignUvs,
  onFlipWinding,
  onOpenSymmetry,
  onOpenImageTrace,
  onApplyGrassCrust,
  onApplyReliefShading,
  onSubdividePolygons,
  onGenerateIsland,
  onOpenSave,
  onOpenNewMap,
  onSelectRightTab,
  extraActions,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions: CommandPaletteAction[] = useMemo(() => {
    const toolActions: CommandPaletteAction[] = EDITOR_TOOLS.map((tool) => ({
      id: `tool_${tool.id}`,
      label: t(tool.labelEn),
      category: t('Tools'),
      shortcut: tool.shortcut,
      run: () => onSelectTool(tool.id),
    }));

    const coreActions: CommandPaletteAction[] = [
      {
        id: 'act_save',
        label: t('Save map (.pms)'),
        category: t('File'),
        shortcut: 'Ctrl+S',
        run: onOpenSave,
      },
      {
        id: 'act_new_map',
        label: t('Create a new map from a template'),
        category: t('File'),
        run: onOpenNewMap,
      },
      {
        id: 'act_image_trace',
        label: t('Image → Polygons Vectorizer & Blueprint Underlay'),
        category: t('Transform & Geometry'),
        run: onOpenImageTrace,
      },
      {
        id: 'act_grass_crust',
        label: t('Generate Grass Surface Crust on Top Edges'),
        category: t('Transform & Geometry'),
        run: onApplyGrassCrust,
      },
      {
        id: 'act_relief_shade',
        label: t('Auto-Shade 3D Sun Relief on Polygons'),
        category: t('Transform & Geometry'),
        run: onApplyReliefShading,
      },
      {
        id: 'act_subdivide',
        label: t('Subdivide Selected Polygons (1 → 4)'),
        category: t('Transform & Geometry'),
        run: onSubdividePolygons,
      },
      {
        id: 'act_proc_island',
        label: t('Generate Procedural Floating Island / Rock'),
        category: t('Transform & Geometry'),
        run: onGenerateIsland,
      },
      {
        id: 'act_symmetry',
        label: t('Horizontal Symmetry & Mirror'),
        category: t('Transform & Geometry'),
        run: onOpenSymmetry,
      },
      {
        id: 'act_world_uv',
        label: t('World-align UVs'),
        category: t('Transform & Geometry'),
        run: onWorldAlignUvs,
      },
      {
        id: 'act_flip_winding',
        label: t('Make polygons clockwise'),
        category: t('Transform & Geometry'),
        run: onFlipWinding,
      },
      {
        id: 'act_undo',
        label: t('Undo'),
        category: t('Edit'),
        shortcut: 'Ctrl+Z',
        run: onUndo,
      },
      {
        id: 'act_redo',
        label: t('Redo'),
        category: t('Edit'),
        shortcut: 'Ctrl+Y',
        run: onRedo,
      },
      {
        id: 'act_dup',
        label: t('Duplicate selection'),
        category: t('Edit'),
        shortcut: 'Ctrl+D',
        run: onDuplicate,
      },
      {
        id: 'act_del',
        label: t('Delete selection'),
        category: t('Edit'),
        shortcut: 'Del',
        run: onDelete,
      },
      {
        id: 'act_sel_all',
        label: t('Select all unlocked objects'),
        category: t('Edit'),
        shortcut: 'Ctrl+A',
        run: onSelectAll,
      },
      {
        id: 'act_toggle_grid_snap',
        label: t('Toggle Grid Snap'),
        category: t('Snapping'),
        shortcut: 'G',
        run: () => onChangeSnap({ ...snap, snapToGrid: !snap.snapToGrid }),
      },
      ...[4, 8, 16, 32, 64, 128].map((gs) => ({
        id: `snap_grid_${gs}`,
        label: t('Set grid size to {size} units', { size: gs }),
        category: t('Snapping'),
        run: () => onChangeSnap({ ...snap, snapToGrid: true, gridSize: gs }),
      })),
      {
        id: 'view_wireframe',
        label: t('Toggle Polygon Wireframe'),
        category: t('Layers'),
        run: () => onChangeLayers({ ...layers, showWireframe: !layers.showWireframe }),
      },
      {
        id: 'view_polytypes',
        label: t('Toggle Polygon Physics Overlay'),
        category: t('Layers'),
        run: () => onChangeLayers({ ...layers, showPolyTypes: !layers.showPolyTypes }),
      },
      {
        id: 'view_waypoints',
        label: t('Toggle Bot Waypoints Overlay'),
        category: t('Layers'),
        run: () => onChangeLayers({ ...layers, showWaypoints: !layers.showWaypoints }),
      },
      {
        id: 'panel_validation',
        label: t('Open live map validation report'),
        category: t('Panels'),
        run: () => onSelectRightTab('validation'),
      },
      {
        id: 'panel_history',
        label: t('Open Undo / Redo History timeline'),
        category: t('Panels'),
        run: () => onSelectRightTab('history'),
      },
    ];

    return [...toolActions, ...coreActions, ...(extraActions ?? [])];
  }, [
    extraActions,
    layers,
    onChangeLayers,
    snap,
    onChangeSnap,
    onSelectTool,
    onUndo,
    onRedo,
    onDuplicate,
    onDelete,
    onSelectAll,
    onWorldAlignUvs,
    onFlipWinding,
    onOpenSymmetry,
    onOpenImageTrace,
    onApplyGrassCrust,
    onApplyReliefShading,
    onSubdividePolygons,
    onGenerateIsland,
    onOpenSave,
    onOpenNewMap,
    onSelectRightTab,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.shortcut && a.shortcut.toLowerCase().includes(q))
    );
  }, [actions, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const executeItem = (item: CommandPaletteAction | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) =>
              filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0
            );
          } else if (e.key === 'Enter') {
            e.preventDefault();
            executeItem(filtered[activeIndex]);
          }
        }}
        className="w-full max-w-xl bg-zinc-900 border border-zinc-700/90 rounded-xl shadow-2xl overflow-hidden text-xs text-zinc-200"
      >
        <div className="px-3.5 py-2.5 bg-zinc-950 border-b border-zinc-800 flex items-center gap-2.5">
          <Command className="w-4 h-4 text-cyan-400 shrink-0" />
          <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Type a command, tool, or shortcut...')}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800/50">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-zinc-500">
              {t('No matching editor commands.')}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => executeItem(item)}
                className={`w-full px-4 py-2 flex items-center justify-between gap-3 text-left cursor-pointer ${
                  idx === activeIndex ? 'bg-cyan-500/15 text-cyan-100' : 'text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                    {item.category}
                  </span>
                  <span className="truncate font-medium">{item.label}</span>
                </div>
                {item.shortcut && (
                  <kbd className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 font-mono text-[10px] text-zinc-300 shrink-0">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
