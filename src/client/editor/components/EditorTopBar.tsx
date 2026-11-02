import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Command,
  FilePlus2,
  Filter,
  FlipHorizontal2,
  PanelsLeftRight,
  Redo2,
  Save,
  SaveAll,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { locale, t, tp } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';
import { EditorDocumentSnapshot } from '../EditorDocument';
import { SelectionFilterMode } from '../types';

interface EditorTopBarProps {
  snapshot: EditorDocumentSnapshot;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selectionFilter: SelectionFilterMode;
  onChangeSelectionFilter: (mode: SelectionFilterMode) => void;
  validationErrors: number;
  validationWarnings: number;
  onUndo: () => void;
  onRedo: () => void;
  onOpenNewMap: () => void;
  onOpenSave: () => void;
  onOpenSymmetry: () => void;
  onOpenImageTrace: () => void;
  onOpenValidation: () => void;
  onOpenCommandPalette: () => void;
  onExitEditor: (force: boolean) => void;
  panelsHidden: boolean;
  onTogglePanels: () => void;
  hasSaveTarget: boolean; // saved once in this session: Save writes there again without the dialog
  onQuickSave: () => void;
  lastAutosaveAt: number | null;
}

export const EditorTopBar: React.FC<EditorTopBarProps> = ({
  snapshot,
  isDirty,
  canUndo,
  canRedo,
  selectionFilter,
  onChangeSelectionFilter,
  validationErrors,
  validationWarnings,
  onUndo,
  onRedo,
  onOpenNewMap,
  onOpenSave,
  onOpenSymmetry,
  onOpenImageTrace,
  onOpenValidation,
  onOpenCommandPalette,
  onExitEditor,
  panelsHidden,
  onTogglePanels,
  hasSaveTarget,
  onQuickSave,
  lastAutosaveAt,
}) => {
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const discardBackdrop = useModalDismiss(confirmDiscardOpen, () => setConfirmDiscardOpen(false));

  const handleBackClick = () => {
    if (isDirty) {
      setConfirmDiscardOpen(true);
    } else {
      onExitEditor(true);
    }
  };

  return (
    <>
      <div className="h-11 shrink-0 bg-zinc-900/95 border-b border-zinc-800 px-3 flex items-center justify-between gap-3 select-none">
        {/* Left: Back to Browser & Active Map Identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={handleBackClick}
            title={t('Exit Map Editor and return to Map Browser')}
            className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-zinc-400" />
            <span>{t('Browser')}</span>
          </button>

          <div className="h-4 w-px bg-zinc-800 shrink-0" />

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
              {t('MAP EDITOR')}
            </span>
            <span className="font-mono text-sm font-bold text-zinc-100 truncate">
              {snapshot.currentBaseName}.pms
            </span>
            {isDirty && (
              <span
                title={
                  lastAutosaveAt
                    ? t('Unsaved changes. A recovery draft was saved at {time}.', {
                        time: new Date(lastAutosaveAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
                      })
                    : t('Map has unsaved changes (draft is autosaved in background)')
                }
                className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-semibold text-amber-200 shrink-0"
              >
                {t('Unsaved')}
              </span>
            )}
            {snapshot.map.mapName && (
              <span className="hidden lg:inline text-xs text-zinc-400 truncate max-w-64">
                — {snapshot.map.mapName}
              </span>
            )}
          </div>
        </div>

        {/* Center: Undo / Redo & Workflow Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-zinc-950/80 border border-zinc-800 rounded-md p-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title={`${t('Undo')} (Ctrl+Z)`}
              className="px-2 py-1 rounded text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-35 flex items-center gap-1 cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t('Undo')}</span>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title={`${t('Redo')} (Ctrl+Y / Ctrl+Shift+Z)`}
              className="px-2 py-1 rounded text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-35 flex items-center gap-1 cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{t('Redo')}</span>
            </button>
          </div>

          {/* Selection Filter Pills */}
          <div
            title={t('Selection Filter: restrict click, box & lasso selection to a specific object type')}
            className="hidden lg:flex items-center bg-zinc-950/90 border border-zinc-800 rounded-md p-0.5 gap-0.5"
          >
            <Filter className="w-3 h-3 text-zinc-500 mx-1 shrink-0" />
            {(
              [
                ['all', t('All')],
                ['polygons', t('Polys')],
                ['sceneries', t('Sceneries')],
                ['entities', t('Entities')],
              ] as const
            ).map(([mode, lbl]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChangeSelectionFilter(mode)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                  selectionFilter === mode
                    ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenImageTrace}
            title={t('Convert an image or sprite into clockwise polygons, or pin a reference blueprint underlay')}
            className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden xl:inline">{t('Image → Polys')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenSymmetry}
            title={t('Symmetry & Mirror tool (mirror selection or whole map with team swap)')}
            className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <FlipHorizontal2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">{t('Mirror / Symmetry')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenValidation}
            title={t('Open live map validation report')}
            className={`px-2.5 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              validationErrors > 0
                ? 'bg-red-500/15 hover:bg-red-500/25 border-red-500/40 text-red-200'
                : validationWarnings > 0
                ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-200'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-200'
            }`}
          >
            {validationErrors > 0 || validationWarnings > 0 ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="hidden lg:inline">
              {validationErrors > 0
                ? tp(validationErrors, '{n} error', '{n} errors')
                : validationWarnings > 0
                ? tp(validationWarnings, '{n} warning', '{n} warnings')
                : t('Valid')}
            </span>
          </button>
        </div>

        {/* Right: Panels, Command Palette, New Map, Save */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onTogglePanels}
            aria-pressed={panelsHidden}
            title={panelsHidden ? t('Show the side panels (Tab)') : t('Hide the side panels for a bigger map (Tab)')}
            className={`p-1.5 rounded-md border text-xs cursor-pointer ${
              panelsHidden
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
            }`}
          >
            <PanelsLeftRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title={`${t('Command Palette')} (Ctrl+K)`}
            className="px-2.5 py-1.5 rounded-md bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 flex items-center gap-1.5 cursor-pointer"
          >
            <Command className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden 2xl:inline">{t('Commands')}</span>
            <kbd className="hidden xl:inline font-mono text-[10px] px-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-400">
              Ctrl+K
            </kbd>
          </button>

          <button
            type="button"
            onClick={onOpenNewMap}
            title={t('Create a new map from a template')}
            className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden 2xl:inline">{t('New map')}</span>
          </button>

          <div className="flex items-stretch">
            <button
              type="button"
              onClick={hasSaveTarget ? onQuickSave : onOpenSave}
              title={
                hasSaveTarget
                  ? t('Save again to {name}.pms (Ctrl+S)', { name: snapshot.currentBaseName })
                  : `${t('Save map (.pms)')} (Ctrl+S)`
              }
              className="px-3 py-1.5 rounded-l-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('Save .pms')}</span>
            </button>
            <button
              type="button"
              onClick={onOpenSave}
              title={t('Save as… (Ctrl+Shift+S)')}
              aria-label={t('Save as… (Ctrl+Shift+S)')}
              className="px-1.5 rounded-r-md bg-emerald-700 hover:bg-emerald-600 border-l border-emerald-900/60 text-white cursor-pointer"
            >
              <SaveAll className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Unsaved Changes Exit Guard Modal */}
      {confirmDiscardOpen && (
        <div
          {...discardBackdrop}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-100">{t('Unsaved changes in map')}</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  {t(
                    'Do you want to save your map before returning to the browser, or discard unsaved changes?'
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDiscardOpen(false)}
                className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
              >
                {t('Keep editing')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscardOpen(false);
                  onExitEditor(true);
                }}
                className="px-3 py-1.5 rounded-md bg-red-600/25 hover:bg-red-600/40 border border-red-500/40 text-xs font-semibold text-red-200 cursor-pointer"
              >
                {t('Discard changes')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscardOpen(false);
                  onOpenSave();
                }}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer"
              >
                {t('Save first')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
