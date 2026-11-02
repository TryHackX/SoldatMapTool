import React from 'react';
import { PmsMapData, SOLDAT_MAP_LIMITS } from '@shared/pmsParser';
import { t } from '../../i18n';
import { EDITOR_TOOLS } from './EditorToolRail';
import { EditorToolId, SelectionSummary } from '../types';

const MAX_WAYPOINTS_HINT = 5000;

interface EditorStatusBarProps {
  map: PmsMapData;
  activeTool: EditorToolId;
  cursorWorld: { x: number; y: number } | null;
  zoom: number;
  selectionSummary: SelectionSummary;
  isDirty: boolean;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  map,
  activeTool,
  cursorWorld,
  zoom,
  selectionSummary,
  isDirty,
}) => {
  const toolMeta = EDITOR_TOOLS.find((item) => item.id === activeTool);

  const counterCls = (val: number, max: number) =>
    val > max
      ? 'text-red-300 font-bold'
      : val > max * 0.9
      ? 'text-amber-300 font-semibold'
      : 'text-zinc-300';

  return (
    <footer className="h-7 shrink-0 bg-zinc-950 border-t border-zinc-800/90 px-3 flex items-center justify-between gap-4 text-[11px] text-zinc-400 select-none">
      {/* Tool Hint */}
      <div className="flex items-center gap-2 min-w-0 truncate">
        {toolMeta && (
          <>
            <span className="font-semibold text-cyan-300 shrink-0">
              {t(toolMeta.labelEn)} [{toolMeta.shortcut}]
            </span>
            <span className="text-zinc-600">•</span>
            <span className="truncate text-zinc-400">{t(toolMeta.hintEn)}</span>
          </>
        )}
      </div>

      {/* Right Status Metrics */}
      <div className="flex items-center gap-3 shrink-0 font-mono">
        {selectionSummary.totalObjects > 0 || selectionSummary.vertexCount > 0 ? (
          <span className="text-cyan-300">
            {selectionSummary.vertexCount > 0 && selectionSummary.totalObjects === 0
              ? t('Selected: {count} verts', { count: selectionSummary.vertexCount })
              : t('Selected: {count}', { count: selectionSummary.totalObjects })}
            {selectionSummary.bounds &&
              ` (${Math.round(selectionSummary.bounds.width)}×${Math.round(selectionSummary.bounds.height)})`}
          </span>
        ) : (
          <span className="text-zinc-500">{t('No selection')}</span>
        )}

        <span className="text-zinc-700">|</span>

        <span title={t('Polygons / Soldat limit')}>
          {t('Polys:')}{' '}
          <span className={counterCls(map.polygons.length, SOLDAT_MAP_LIMITS.maxPolys)}>
            {map.polygons.length}/{SOLDAT_MAP_LIMITS.maxPolys}
          </span>
        </span>

        <span className="hidden xl:inline" title={t('Sceneries / Soldat limit')}>
          {t('Scen.:')}{' '}
          <span className={counterCls(map.props.length, SOLDAT_MAP_LIMITS.maxProps)}>
            {map.props.length}/{SOLDAT_MAP_LIMITS.maxProps}
          </span>
        </span>

        <span className="hidden 2xl:inline" title={t('Spawn points / Soldat limit')}>
          {t('Spawns:')}{' '}
          <span className={counterCls(map.spawnpoints.length, SOLDAT_MAP_LIMITS.maxSpawnpoints)}>
            {map.spawnpoints.length}/{SOLDAT_MAP_LIMITS.maxSpawnpoints}
          </span>
        </span>

        <span className="hidden 2xl:inline" title={t('Bot waypoints / Soldat limit')}>
          {t('Bots:')}{' '}
          <span className={counterCls(map.waypoints.length, MAX_WAYPOINTS_HINT)}>
            {map.waypoints.length}/{MAX_WAYPOINTS_HINT}
          </span>
        </span>

        <span className="text-zinc-700">|</span>

        <span className="min-w-28 text-right text-zinc-200">
          {cursorWorld
            ? `X: ${Math.round(cursorWorld.x)}  Y: ${Math.round(cursorWorld.y)}`
            : 'X: —  Y: —'}
        </span>

        <span className="text-zinc-300 min-w-12 text-right">{Math.round(zoom * 100)}%</span>

        <span className={isDirty ? 'text-amber-300' : 'text-emerald-400'}>
          {isDirty ? '●' : '✓'}
        </span>
      </div>
    </footer>
  );
};
