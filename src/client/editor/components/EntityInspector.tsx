import { X } from 'lucide-react';
import { SPAWN_TYPES,WAYPOINT_ACTION_NAMES_EN } from '@shared/soldatConstants';
import { t } from '../../i18n';
import { spawnTypeName } from '../../renderer/OverlayRenderer';
import { toggleWaypointConnection } from '../EditorDocument';
import { PanelCard } from './EditorPanelCard';
import { NumberInput } from './EditorFields';
import type { EditorRightDockProps } from './EditorRightDock';

type Props=Pick<EditorRightDockProps,'snapshot'|'onCommitMutation'|'onFocusBounds'>;
export function EntityInspector({snapshot,onCommitMutation,onFocusBounds}:Props) {
  const {map,selection}=snapshot;
  const selectedSpawns = selection.spawns.map((i) => map.spawnpoints[i]).filter(Boolean);
  const selectedColliders = selection.colliders.map((i) => map.colliders[i]).filter(Boolean);
  const selectedWaypoints = selection.waypoints.map((i) => map.waypoints[i]).filter(Boolean);
  return <>
    {selectedSpawns.length > 0 && (
      <PanelCard title={t('Spawn Points ({count})', { count: selectedSpawns.length })}>
        <label className="space-y-1 block">
          <span className="text-zinc-400 text-[11px]">{t('Spawn / Item type (0–16)')}</span>
          <select
            value={selectedSpawns.every((o) => o.team === selectedSpawns[0].team) ? selectedSpawns[0].team : ''}
            onChange={(e) => {
              const nextTeam = Number(e.target.value);
              const nextSpawns = [...map.spawnpoints];
              for (const idx of selection.spawns) {
                const sp = nextSpawns[idx];
                if (!sp) continue;
                const { raw: _raw, ...rest } = sp;
                nextSpawns[idx] = { ...rest, team: nextTeam };
              }
              onCommitMutation('Change spawn type', { ...map, spawnpoints: nextSpawns });
            }}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
          >
            {!selectedSpawns.every((o) => o.team === selectedSpawns[0].team) && (
              <option value="" disabled>
                {t('— mixed —')}
              </option>
            )}
            {Object.values(SPAWN_TYPES).map((sp) => (
              <option key={sp.team} value={sp.team}>
                {sp.team}: {spawnTypeName(sp)}
              </option>
            ))}
          </select>
        </label>

        {selectedSpawns.length === 1 && (
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5 block">
              <span className="text-[10px] text-zinc-400">X</span>
              <NumberInput
                value={selectedSpawns[0].x}
                onChange={(e) => {
                  const idx = selection.spawns[0];
                  const nextSpawns = [...map.spawnpoints];
                  const { raw: _raw, ...rest } = nextSpawns[idx];
                  nextSpawns[idx] = { ...rest, x: Math.round(Number(e.target.value)) };
                  onCommitMutation('Move spawn point', { ...map, spawnpoints: nextSpawns });
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
              />
            </label>
            <label className="space-y-0.5 block">
              <span className="text-[10px] text-zinc-400">Y</span>
              <NumberInput
                value={selectedSpawns[0].y}
                onChange={(e) => {
                  const idx = selection.spawns[0];
                  const nextSpawns = [...map.spawnpoints];
                  const { raw: _raw, ...rest } = nextSpawns[idx];
                  nextSpawns[idx] = { ...rest, y: Math.round(Number(e.target.value)) };
                  onCommitMutation('Move spawn point', { ...map, spawnpoints: nextSpawns });
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
              />
            </label>
          </div>
        )}
      </PanelCard>
    )}

    {/* 6. Selected Colliders Inspector */}
    {selectedColliders.length > 0 && (
      <PanelCard title={t('Colliders ({count})', { count: selectedColliders.length })}>
        <label className="flex items-center justify-between gap-2">
          <span className="text-zinc-400 text-[11px]">{t('Diameter (PMS radius)')}</span>
          <NumberInput
            min={2}
            max={2000}
            value={Math.round(selectedColliders[0].radius)}
            onChange={(e) => {
              const d = Math.max(2, Number(e.target.value));
              const nextCols = [...map.colliders];
              for (const idx of selection.colliders) {
                const col = nextCols[idx];
                if (!col) continue;
                const { raw: _raw, ...rest } = col;
                nextCols[idx] = { ...rest, radius: d };
              }
              onCommitMutation('Resize collider', { ...map, colliders: nextCols });
            }}
            className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
          />
        </label>
        <div className="bg-zinc-900/70 rounded p-2 text-[10px] font-mono text-zinc-400 space-y-0.5">
          <div>
            {t('Player collision radius (d/2):')}{' '}
            <span className="text-cyan-300">
              {(selectedColliders[0].radius * 0.5).toFixed(1)} u
            </span>
          </div>
          <div>
            {t('Bullet collision radius (d/1.7):')}{' '}
            <span className="text-amber-300">
              {(selectedColliders[0].radius / 1.7).toFixed(1)} u
            </span>
          </div>
        </div>
      </PanelCard>
    )}

    {/* 7. Selected Waypoints Inspector */}
    {selectedWaypoints.length > 0 && (
      <PanelCard title={t('Bot Waypoints ({count})', { count: selectedWaypoints.length })}>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-0.5 block">
            <span className="text-[10px] text-zinc-400">{t('Bot path')}</span>
            <select
              value={selectedWaypoints.every((o) => o.pathNum === selectedWaypoints[0].pathNum) ? selectedWaypoints[0].pathNum : ''}
              onChange={(e) => {
                const pn = Number(e.target.value);
                const nextWps = [...map.waypoints];
                for (const idx of selection.waypoints) {
                  const wp = nextWps[idx];
                  if (!wp) continue;
                  const { raw: _raw, ...rest } = wp;
                  nextWps[idx] = { ...rest, pathNum: pn };
                }
                onCommitMutation('Change waypoint path', { ...map, waypoints: nextWps });
              }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
            >
              {!selectedWaypoints.every((o) => o.pathNum === selectedWaypoints[0].pathNum) && (
                <option value="" disabled>
                  {t('— mixed —')}
                </option>
              )}
              <option value={1}>{t('Path 1 (Alpha)')}</option>
              <option value={2}>{t('Path 2 (Bravo)')}</option>
            </select>
          </label>
          <label className="space-y-0.5 block">
            <span className="text-[10px] text-zinc-400">{t('Special action')}</span>
            <select
              value={selectedWaypoints.every((o) => o.action === selectedWaypoints[0].action) ? selectedWaypoints[0].action : ''}
              onChange={(e) => {
                const act = Number(e.target.value);
                const nextWps = [...map.waypoints];
                for (const idx of selection.waypoints) {
                  const wp = nextWps[idx];
                  if (!wp) continue;
                  const { raw: _raw, ...rest } = wp;
                  nextWps[idx] = { ...rest, action: act };
                }
                onCommitMutation('Change waypoint action', { ...map, waypoints: nextWps });
              }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
            >
              {!selectedWaypoints.every((o) => o.action === selectedWaypoints[0].action) && (
                <option value="" disabled>
                  {t('— mixed —')}
                </option>
              )}
              {Object.entries(WAYPOINT_ACTION_NAMES_EN).map(([id, name]) => (
                <option key={id} value={Number(id)}>
                  {id}: {t(name)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Movement Flags */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          {(
            [
              ['left', t('Left')],
              ['right', t('Right')],
              ['up', t('Jump / Up')],
              ['down', t('Crouch')],
              ['jetpack', t('Jetpack')],
            ] as const
          ).map(([flag, label]) => (
            <label
              key={flag}
              className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(selectedWaypoints[0][flag])}
                onChange={(e) => {
                  const val = e.target.checked;
                  const nextWps = [...map.waypoints];
                  for (const idx of selection.waypoints) {
                    const wp = nextWps[idx];
                    if (!wp) continue;
                    const { raw: _raw, ...rest } = wp;
                    nextWps[idx] = { ...rest, [flag]: val };
                  }
                  onCommitMutation(`Set waypoint ${flag}`, { ...map, waypoints: nextWps });
                }}
                className="rounded border-zinc-700 bg-zinc-900 accent-cyan-400"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {/* Outgoing Connections */}
        {selectedWaypoints.length === 1 && (
          <div className="pt-1.5 border-t border-zinc-800/80 space-y-1">
            <div className="text-[10px] text-zinc-400">
              {t('Connections ({count}/20) — Shift+Click with the waypoint tool to link', {
                count: selectedWaypoints[0].connections.length,
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedWaypoints[0].connections.map((connOneBased) => (
                <span
                  key={connOneBased}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 font-mono text-[10px] text-amber-200"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const targetWp = map.waypoints[connOneBased - 1];
                      if (targetWp) {
                        onFocusBounds({
                          left: targetWp.x - 60,
                          right: targetWp.x + 60,
                          top: targetWp.y - 60,
                          bottom: targetWp.y + 60,
                        });
                      }
                    }}
                    className="hover:underline cursor-pointer"
                  >
                    → #{connOneBased}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextMap = toggleWaypointConnection(
                        map,
                        selection.waypoints[0],
                        connOneBased - 1,
                        false
                      );
                      onCommitMutation('Disconnect waypoint', nextMap);
                    }}
                    className="text-zinc-500 hover:text-red-300 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </PanelCard>
    )}

  </>;
}
