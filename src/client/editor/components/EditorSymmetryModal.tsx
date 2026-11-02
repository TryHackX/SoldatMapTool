import React, { useEffect, useState } from 'react';
import { mirrorMapElements } from '@shared/pmsCompiler';
import { PmsMapData } from '@shared/pmsParser';
import { FlipHorizontal2, X } from 'lucide-react';
import { t } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';
import { EditorDocumentSnapshot } from '../EditorDocument';
import { EditorSelection, SelectionSummary } from '../types';
import { NumberInput } from './EditorFields';

interface EditorSymmetryModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: EditorDocumentSnapshot;
  selectionSummary: SelectionSummary;
  onSetPreviewAxisX: (axisX: number | null) => void;
  onApplyMirror: (label: string, nextMap: PmsMapData, nextSelection: EditorSelection) => void;
}

type AxisPreset = 'origin' | 'selection_center' | 'map_center' | 'custom';

export const EditorSymmetryModal: React.FC<EditorSymmetryModalProps> = ({
  open,
  onClose,
  snapshot,
  selectionSummary,
  onSetPreviewAxisX,
  onApplyMirror,
}) => {
  const hasSelection = selectionSummary.totalObjects > 0;
  const [scope, setScope] = useState<'selection' | 'whole_map'>(
    hasSelection ? 'selection' : 'whole_map'
  );
  const [mode, setMode] = useState<'mirror_copy' | 'flip_in_place'>('mirror_copy');
  const [axisPreset, setAxisPreset] = useState<AxisPreset>('origin');
  const [customAxisX, setCustomAxisX] = useState<number>(0);
  const [swapTeams, setSwapTeams] = useState<boolean>(true);
  const [mirrorUvs, setMirrorUvs] = useState<boolean>(true);

  useEffect(() => {
    if (open) {
      setScope(selectionSummary.totalObjects > 0 ? 'selection' : 'whole_map');
    }
  }, [open, selectionSummary.totalObjects]);

  const effectiveAxisX = (() => {
    if (axisPreset === 'origin') return 0;
    if (axisPreset === 'selection_center' && selectionSummary.bounds) {
      return Math.round((selectionSummary.bounds.left + selectionSummary.bounds.right) * 0.5);
    }
    if (axisPreset === 'map_center') {
      const b = snapshot.map.polyBounds;
      return Math.round((b.left + b.right) * 0.5);
    }
    return Number.isFinite(customAxisX) ? customAxisX : 0;
  })();

  useEffect(() => {
    if (!open) {
      onSetPreviewAxisX(null);
      return;
    }
    onSetPreviewAxisX(effectiveAxisX);
    return () => {
      onSetPreviewAxisX(null);
    };
  }, [open, effectiveAxisX, onSetPreviewAxisX]);

  const backdropProps = useModalDismiss(open, onClose);

  if (!open) return null;

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    const useSel = scope === 'selection' && hasSelection;
    const res = mirrorMapElements(snapshot.map, {
      mode,
      axisX: effectiveAxisX,
      swapTeams,
      mirrorUvs,
      targets: useSel
        ? {
            polygons: snapshot.selection.polygons,
            props: snapshot.selection.props,
            spawns: snapshot.selection.spawns,
            colliders: snapshot.selection.colliders,
            waypoints: snapshot.selection.waypoints,
          }
        : null,
    });
    const label =
      mode === 'mirror_copy' ? 'Mirror copy across axis' : 'Flip across symmetry axis';
    onApplyMirror(label, res.nextMap, {
      polygons: res.resultIndices.polygons,
      vertices: [],
      props: res.resultIndices.props,
      spawns: res.resultIndices.spawns,
      colliders: res.resultIndices.colliders,
      waypoints: res.resultIndices.waypoints,
    });
    onClose();
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleApply}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl overflow-hidden text-xs text-zinc-200"
      >
        <div className="px-5 py-3.5 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-zinc-100">
            <FlipHorizontal2 className="w-4 h-4 text-fuchsia-400" />
            <span>{t('Horizontal Symmetry & Mirror')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Scope */}
          <div className="space-y-1.5">
            <span className="font-semibold text-zinc-300 block">{t('Target elements')}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => setScope('selection')}
                className={`p-2 rounded-lg border text-left transition-colors ${
                  !hasSelection
                    ? 'opacity-40 cursor-not-allowed bg-zinc-950 border-zinc-800'
                    : scope === 'selection'
                    ? 'cursor-pointer bg-fuchsia-500/15 border-fuchsia-400/60 text-fuchsia-100'
                    : 'cursor-pointer bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold">{t('Current selection')}</div>
                <div className="text-[11px] text-zinc-400">
                  {t('{count} selected objects', { count: selectionSummary.totalObjects })}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setScope('whole_map')}
                className={`p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                  scope === 'whole_map'
                    ? 'bg-fuchsia-500/15 border-fuchsia-400/60 text-fuchsia-100'
                    : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold">{t('Entire map')}</div>
                <div className="text-[11px] text-zinc-400">
                  {t('All polygons, sceneries, spawns, colliders & bots')}
                </div>
              </button>
            </div>
          </div>

          {/* Operation mode */}
          <div className="space-y-1.5">
            <span className="font-semibold text-zinc-300 block">{t('Mirror operation')}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('mirror_copy')}
                className={`p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                  mode === 'mirror_copy'
                    ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-100'
                    : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold">{t('Duplicate & Mirror (CTF Builder)')}</div>
                <div className="text-[11px] text-zinc-400">
                  {t('Keep existing side and create mirrored opposite half')}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('flip_in_place')}
                className={`p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                  mode === 'flip_in_place'
                    ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-100'
                    : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold">{t('Flip in place')}</div>
                <div className="text-[11px] text-zinc-400">
                  {t('Mirror target elements directly across axis')}
                </div>
              </button>
            </div>
          </div>

          {/* Mirror Axis X */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-300">{t('Vertical mirror axis (X)')}</span>
              <span className="font-mono text-fuchsia-300">X = {effectiveAxisX}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ['origin', 'X = 0'],
                  ['map_center', t('Map center')],
                  ['selection_center', t('Selection')],
                  ['custom', t('Custom X')],
                ] as const
              ).map(([id, label]) => {
                const disabled = id === 'selection_center' && !selectionSummary.bounds;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setAxisPreset(id)}
                    className={`py-1.5 px-2 rounded border text-[11px] ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed bg-zinc-950 border-zinc-800'
                        : axisPreset === id
                        ? 'cursor-pointer bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/50 font-semibold'
                        : 'cursor-pointer bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {axisPreset === 'custom' && (
              <NumberInput
                value={customAxisX}
                onChange={(e) => setCustomAxisX(Number(e.target.value) || 0)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 font-mono text-zinc-100"
              />
            )}
          </div>

          {/* Options */}
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={swapTeams}
                onChange={(e) => setSwapTeams(e.target.checked)}
                className="mt-0.5 rounded border-zinc-700 bg-zinc-900 accent-fuchsia-400"
              />
              <div>
                <div className="font-semibold text-zinc-100">
                  {t('Swap Alpha ↔ Bravo teams automatically')}
                </div>
                <div className="text-[11px] text-zinc-400">
                  {t(
                    'Swaps Alpha/Bravo spawns (1↔2), flags (5↔6), team polygons (10↔12, 11↔13), and bot paths (1↔2).'
                  )}
                </div>
              </div>
            </label>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={mirrorUvs}
                onChange={(e) => setMirrorUvs(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900 accent-fuchsia-400"
              />
              <span className="text-zinc-200">
                {t('Mirror polygon texture U coordinates horizontally')}
              </span>
            </label>
          </div>
        </div>

        <div className="px-5 py-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
          >
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold cursor-pointer"
          >
            {t('Apply Mirror')}
          </button>
        </div>
      </form>
    </div>
  );
};
