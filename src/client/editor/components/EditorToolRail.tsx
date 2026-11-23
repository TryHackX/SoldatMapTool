import { toolGlyphs } from '../toolIcons';
import { useToolKeys } from '../shortcutBindings';
import React from 'react';
import {
  Bot,
  Mountain,
  CircleDot,
  Copy,
  Flag,
  Gamepad2,
  Grid,
  Hexagon,
  Image as ImageIcon,
  LassoSelect,
  Magnet,
  MousePointer2,
  Paintbrush,
  Pentagon,
  Ruler,
  Shapes,
  Sparkles,
  Sun,
  Trash2,
  Triangle,
  Wand2,
  Waypoints,
} from 'lucide-react';
import { t } from '../../i18n';
import { EditorToolId } from '../types';

export interface EditorToolDescriptor {
  id: EditorToolId;
  labelEn: string;
  hintEn: string;
  group: 'select' | 'polygon' | 'appearance' | 'entity' | 'measure';
  icon: React.ReactNode;
}

export const EDITOR_TOOLS: ReadonlyArray<EditorToolDescriptor> = [
  {
    id: 'climb_tunnel',
    labelEn: 'Build climb tunnel',
    hintEn: 'Draw the centre of your tunnel, then adjust its walls and obstacles in Properties.',
    group: 'polygon',
    icon: <Mountain className="w-4 h-4" />,
  },
  {
    id: 'select',
    labelEn: 'Select & Transform',
    hintEn: 'Click or drag box to select • Repeat click to cycle overlapping objects • Drag gizmo handles to move/rotate/scale',
    group: 'select',
    icon: <MousePointer2 className="w-4 h-4" />,
  },
  {
    id: 'lasso',
    labelEn: 'Freehand Lasso',
    hintEn: 'Draw freehand lasso to select • Shift adds • Alt removes',
    group: 'select',
    icon: <LassoSelect className="w-4 h-4" />,
  },
  {
    id: 'vertex',
    labelEn: 'Vertex Edit',
    hintEn: 'Select & drag vertices (welded shared vertices move together) • Double-click an edge to split triangle',
    group: 'select',
    icon: <Waypoints className="w-4 h-4" />,
  },
  {
    id: 'poly_tri',
    labelEn: 'Polygon: Triangle',
    hintEn: 'Click 3 points to create a clockwise triangle • Right-click or Esc cancels draft',
    group: 'polygon',
    icon: <Triangle className="w-4 h-4" />,
  },
  {
    id: 'poly_strip',
    labelEn: 'Polygon: Strip',
    hintEn: 'Click 3 points, then each click extends a connected triangle strip • Right-click or Esc ends strip',
    group: 'polygon',
    icon: <Shapes className="w-4 h-4" />,
  },
  {
    id: 'poly_fan',
    labelEn: 'Polygon: Fan',
    hintEn: 'First click sets hub vertex, subsequent clicks fan triangles around hub • Right-click or Esc ends fan',
    group: 'polygon',
    icon: <Hexagon className="w-4 h-4" />,
  },
  {
    id: 'poly_shape',
    labelEn: 'Polygon shapes',
    hintEn: 'Choose Box, Free, Ramp or Spike in Properties.',
    group: 'polygon',
    icon: <Pentagon className="w-4 h-4" />,
  },
  {
    id: 'poly_laser',
    labelEn: 'Polygon: Laser Draw',
    hintEn: 'Draw a freehand laser stroke just like lasso selection to auto-simplify & triangulate into clockwise polygons',
    group: 'polygon',
    icon: <Wand2 className="w-4 h-4" />,
  },
  {
    id: 'color_brush',
    labelEn: 'Vertex Color Brush',
    hintEn: 'Drag to paint vertex & scenery colors/alpha • Alt+Click to sample color (eyedropper) • [ / ] changes radius',
    group: 'appearance',
    icon: <Paintbrush className="w-4 h-4" />,
  },
  {
    id: 'light',
    labelEn: 'Vertex Light Baker',
    hintEn: 'Click or drag to bake radial falloff lighting onto polygon vertices & sceneries',
    group: 'appearance',
    icon: <Sun className="w-4 h-4" />,
  },
  {
    id: 'uv',
    labelEn: 'Texture UV Tool',
    hintEn: 'Drag polygon to pan texture UV • Shift+Drag to scale UV • Alt+Drag to rotate UV',
    group: 'appearance',
    icon: <Grid className="w-4 h-4" />,
  },
  {
    id: 'scenery',
    labelEn: 'Scenery Studio',
    hintEn: 'Click empty space (or Ctrl+Click) to stamp, drag to draw it at any size (Shift: free stretch) • Alt+Wheel scales, Alt+Shift+Wheel turns • Click a scenery to select & move it • Alt+Click samples',
    group: 'entity',
    icon: <ImageIcon className="w-4 h-4" />,
  },
  {
    id: 'spawn',
    labelEn: 'Place Spawn / Flag / Bonus',
    hintEn: 'Choose spawn or item type in Properties, then click on the map to place',
    group: 'entity',
    icon: <Flag className="w-4 h-4" />,
  },
  {
    id: 'collider',
    labelEn: 'Place Collider',
    hintEn: 'Click to place circular collider and drag to set diameter (player radius = d/2, bullet = d/1.7)',
    group: 'entity',
    icon: <CircleDot className="w-4 h-4" />,
  },
  {
    id: 'waypoint',
    labelEn: 'Bot Waypoints',
    hintEn: 'Click to place or select waypoint • Shift+Click another waypoint to connect/disconnect • Alt+Shift+Click for 2-way link',
    group: 'entity',
    icon: <Bot className="w-4 h-4" />,
  },
  {
    id: 'ruler',
    labelEn: 'Distance Ruler',
    hintEn: 'Click and drag to measure distance & angle in Soldat world units',
    group: 'measure',
    icon: <Ruler className="w-4 h-4" />,
  },
  {
    id: 'playtest',
    labelEn: 'Playtest Soldier',
    hintEn: 'Live 60 FPS Soldat movement & jetpack sandbox • WASD/Arrows move & jump • Space/Shift jetpack • Click anywhere to teleport',
    group: 'measure',
    icon: <Gamepad2 className="w-4 h-4" />,
  },
];

interface EditorToolRailProps {
  activeTool: EditorToolId;
  onSelectTool: (tool: EditorToolId) => void;
  onOpenImageTrace: () => void;
  snapToGrid: boolean;
  onToggleGridSnap: () => void;
  hasSelection: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const EditorToolRail: React.FC<EditorToolRailProps> = ({
  activeTool,
  onSelectTool,
  onOpenImageTrace,
  snapToGrid,
  onToggleGridSnap,
  hasSelection,
  onDuplicate,
  onDelete,
}) => {
  const keys = useToolKeys();
  let prevGroup: string | null = null;

  return (
    <aside className="w-[52px] shrink-0 bg-zinc-950 border-r border-zinc-800/90 py-2 flex flex-col items-center justify-between select-none overflow-y-auto">
      <div className="flex flex-col items-center gap-1">
        {EDITOR_TOOLS.map((tool) => {
          const showSep = prevGroup !== null && prevGroup !== tool.group;
          prevGroup = tool.group;
          const active = activeTool === tool.id;
          return (
            <React.Fragment key={tool.id}>
              {showSep && <div className="w-6 h-px bg-zinc-800 my-0.5" />}
              <button
                type="button"
                onClick={() => onSelectTool(tool.id)}
                aria-label={`${t(tool.labelEn)} (${keys[tool.id]})`}
                aria-pressed={active}
                title={`${t(tool.labelEn)} [${keys[tool.id]}]\n${t(tool.hintEn)}`}
                className={`relative rounded-lg flex flex-col items-center justify-center transition-colors cursor-pointer ${tool.id === 'climb_tunnel' || tool.id === 'poly_shape' ? 'w-11 h-10 gap-0.5' : 'w-8 h-8'} ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 shadow-sm shadow-cyan-950'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 border border-transparent'
                }`}
              >
                <span aria-hidden="true" className="studio-icon">
                  {tool.icon}<i>{String.fromCodePoint(toolGlyphs[tool.id])}</i>
                </span>
                {tool.id === 'climb_tunnel' || tool.id === 'poly_shape' ? (
                  <span className="text-[9px] font-semibold leading-none">{t(tool.id === 'climb_tunnel' ? 'Tunnel' : 'Shapes')}</span>
                ) : <span className="absolute right-0.5 bottom-0 text-[8px] font-mono opacity-65">{keys[tool.id]}</span>}
              </button>
            </React.Fragment>
          );
        })}

        <div className="w-6 h-px bg-zinc-800 my-0.5" />
        <button
          type="button"
          onClick={onOpenImageTrace}
          title={t('Image → Polygons Vectorizer & Blueprint Underlay')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-emerald-400 hover:text-emerald-200 hover:bg-emerald-500/15 border border-transparent transition-colors cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom Quick Toggles */}
      <div className="flex flex-col items-center gap-1 pt-2 border-t border-zinc-800/80 mt-2">
        <button
          type="button"
          onClick={onToggleGridSnap}
          aria-pressed={snapToGrid}
          title={`${t('Toggle Grid Snap')} [G]`}
          className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            snapToGrid
              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/50'
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 border border-transparent'
          }`}
        >
          <Magnet className="w-4 h-4" />
          <span className="absolute right-0.5 bottom-0 text-[8px] font-mono opacity-65">G</span>
        </button>

        <button
          type="button"
          onClick={onDuplicate}
          disabled={!hasSelection}
          title={`${t('Duplicate selection')} (Ctrl+D)`}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 disabled:opacity-30 cursor-pointer"
        >
          <Copy className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={!hasSelection}
          title={`${t('Delete selection')} (Delete)`}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-300 hover:bg-red-500/15 disabled:opacity-30 cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
