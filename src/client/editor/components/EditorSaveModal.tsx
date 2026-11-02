import React, { useEffect, useState } from 'react';
import {
  EditorSaveCheckResponse,
  EditorSaveDestination,
  EditorSaveResponse,
} from '@shared/apiTypes';
import { makeEditedMapName } from '@shared/pmsParser';
import { AlertTriangle, CheckCircle2, FolderOpen, Save, ShieldCheck, X } from 'lucide-react';
import { t } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';
import { openPathInExplorer } from '../../utils/mapCache';
import { EditorDocumentSnapshot } from '../EditorDocument';

interface EditorSaveModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: EditorDocumentSnapshot;
  onSave: (opts: {
    baseName: string;
    destination: EditorSaveDestination;
    customOutputFolder?: string;
    confirmOverwrite?: boolean;
  }) => Promise<EditorSaveResponse>;
}

export const EditorSaveModal: React.FC<EditorSaveModalProps> = ({
  open,
  onClose,
  snapshot,
  onSave,
}) => {
  const [baseName, setBaseName] = useState(snapshot.currentBaseName);
  const [destination, setDestination] = useState<EditorSaveDestination>('soldat_maps');
  const [customFolder, setCustomFolder] = useState('');
  const [checkResult, setCheckResult] = useState<EditorSaveCheckResponse | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedResult, setSavedResult] = useState<EditorSaveResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setBaseName(snapshot.currentBaseName);
    setConfirmOverwrite(false);
    setSaveError(null);
    setSavedResult(null);
    // Only when the dialog opens: saving renames the document, and that must not wipe the result panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const backdropProps = useModalDismiss(open, onClose, saving);

  // Live check whether target file exists so overwrite is ALWAYS explicit and backed up
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConfirmOverwrite(false);
    const timer = window.setTimeout(async () => {
      if (!baseName.trim()) {
        setCheckResult(null);
        return;
      }
      if (destination === 'custom' && !customFolder.trim()) {
        setCheckResult(null);
        return;
      }
      try {
        const res = await fetch('/api/editor/save-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseName: baseName.trim(),
            destination,
            customOutputFolder: customFolder.trim() || undefined,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as EditorSaveCheckResponse;
        if (!cancelled) setCheckResult(data);
      } catch {
        // Ignore check failure
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, baseName, destination, customFolder]);

  if (!open) return null;

  const needsOverwriteConfirm = Boolean(checkResult?.exists);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsOverwriteConfirm && !confirmOverwrite) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await onSave({
        baseName: baseName.trim(),
        destination,
        customOutputFolder: destination === 'custom' ? customFolder.trim() : undefined,
        confirmOverwrite,
      });
      setSavedResult(res);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Save className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-100">{t('Save Map (.pms)')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t('Close')}
            className="text-zinc-400 hover:text-zinc-100 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* File Name + Safe _e Suggestion */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-zinc-300">
                {t('Output map name (without .pms)')}
              </label>
              {snapshot.sourceBaseName && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBaseName(makeEditedMapName(snapshot.sourceBaseName!, 24))}
                    className="text-emerald-300 hover:underline cursor-pointer"
                  >
                    {t('Use safe {name}', {
                      name: makeEditedMapName(snapshot.sourceBaseName, 24),
                    })}
                  </button>
                  <span className="text-zinc-600">•</span>
                  <button
                    type="button"
                    onClick={() => setBaseName(snapshot.sourceBaseName!)}
                    className="text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer"
                  >
                    {t('Original ({name})', { name: snapshot.sourceBaseName })}
                  </button>
                </div>
              )}
            </div>
            <input
              type="text"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              maxLength={48}
              required
              autoFocus
              className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 font-mono text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Destination Selector */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-300">{t('Destination folder')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['soldat_maps', t('Soldat maps/'), t('Ready to play in game & indexed live')],
                  ['exports_editor', t('exports/edited_maps/'), t('Workspace exports folder')],
                  ['custom', t('Custom folder'), t('Any path on disk')],
                ] as const
              ).map(([id, title, desc]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDestination(id)}
                  className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    destination === id
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-100'
                      : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                  }`}
                >
                  <div className="font-semibold">{title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {destination === 'custom' && (
            <label className="space-y-1 block">
              <span className="font-semibold text-zinc-300">{t('Custom output directory path')}</span>
              <input
                type="text"
                value={customFolder}
                onChange={(e) => setCustomFolder(e.target.value)}
                placeholder="C:\SoldatMaps\MyMaps"
                required
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1.5 font-mono text-zinc-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          )}

          {/* Target Path Preview & Safety Guarantees */}
          {checkResult && (
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-400">{t('Target file:')}</span>
                <span className="font-mono text-[11px] text-zinc-200 truncate" title={checkResult.outputPath}>
                  {checkResult.outputPath}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-300/90">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {t(
                    'Atomic staging write + automatic sector grid & edge normals compilation + engine limit check'
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Explicit Overwrite Confirmation + Automatic Backup Guarantee */}
          {needsOverwriteConfirm && !savedResult && (
            <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-3 space-y-2 text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold">
                    {t('File already exists on disk!')}
                  </div>
                  <div className="text-[11px] text-amber-200/90">
                    {t(
                      'Overwriting will first save an automatic timestamped backup in data/backups/ so the previous file is never lost.'
                    )}
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 pt-1 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmOverwrite}
                  onChange={(e) => setConfirmOverwrite(e.target.checked)}
                  className="rounded border-amber-500/60 bg-zinc-950"
                />
                <span>{t('I want to overwrite {name}.pms (with backup)', { name: checkResult?.baseName || baseName })}</span>
              </label>
            </div>
          )}

          {saveError && (
            <div className="bg-red-500/15 border border-red-500/40 rounded-lg p-3 text-red-200">
              {saveError}
            </div>
          )}

          {savedResult && (
            <div className="bg-emerald-500/15 border border-emerald-500/40 rounded-lg p-3 space-y-1.5 text-emerald-100">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {t('Saved {name}.pms ({bytes} B, CRC32 0x{crc})', {
                    name: savedResult.baseName,
                    bytes: savedResult.fileSize,
                    crc: (savedResult.crc32 >>> 0).toString(16).toUpperCase(),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => openPathInExplorer(savedResult.outputPath)}
                  className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/35 text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3" />
                  {t('Show in folder')}
                </button>
              </div>
              {savedResult.backupDir && (
                <div className="text-[11px] text-emerald-200/80 font-mono truncate">
                  {t('Backup saved in: {dir}', { dir: savedResult.backupDir })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-zinc-950/70 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer disabled:opacity-40"
          >
            {savedResult ? t('Close') : t('Cancel')}
          </button>
          {!savedResult && (
            <button
              type="submit"
              disabled={saving || !baseName.trim() || (needsOverwriteConfirm && !confirmOverwrite)}
              className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold text-white cursor-pointer"
            >
              {saving ? t('Saving...') : needsOverwriteConfirm ? t('Backup & Overwrite .pms') : t('Save .pms')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
