import React, { useEffect, useRef, useState } from 'react';
import { ExtraMapSource } from '@shared/apiTypes';
import { lang, LANGUAGES, setLanguage, t, tr } from '../i18n';
import { pickSystemFolder } from '../utils/mapCache';
import { useModalDismiss } from '../utils/useModalDismiss';
import { FolderPlus, FolderTree, HardDrive, Languages, Settings, Trash2, X } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  soldatPath: string;
  extraSources: ExtraMapSource[];
  onSaveConfig: (soldatPath: string, extraSources: ExtraMapSource[]) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  soldatPath,
  extraSources,
  onSaveConfig,
}) => {
  const [localSoldatPath, setLocalSoldatPath] = useState(soldatPath);
  const [localSources, setLocalSources] = useState<ExtraMapSource[]>(extraSources);
  const [newPathInput, setNewPathInput] = useState('');
  const [newLabelInput, setNewLabelInput] = useState('');
  const [newRecursive, setNewRecursive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize only when the modal opens, so a background meta refresh never discards unsaved edits
  const initializedForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;
    setLocalSoldatPath(soldatPath);
    setLocalSources(extraSources);
    setNewPathInput('');
    setNewLabelInput('');
    setNewRecursive(true);
    setError(null);
  }, [open, soldatPath, extraSources]);

  const backdropProps = useModalDismiss(open, onClose, saving);

  if (!open) return null;

  const addSourceFolder = (rawPath: string) => {
    const clean = rawPath.trim();
    if (!clean) return;
    if (localSources.some((s) => s.path.toLowerCase() === clean.toLowerCase())) return;
    const baseLabel =
      newLabelInput.trim() ||
      clean.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ||
      t('Archive #{n}', { n: localSources.length + 1 });

    setLocalSources([
      ...localSources,
      {
        id: `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        path: clean,
        label: baseLabel,
        recursive: newRecursive,
        enabled: true,
      },
    ]);
    setNewPathInput('');
    setNewLabelInput('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveConfig(localSoldatPath, localSources);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-zinc-100">{t('Settings — language, Soldat folders and map sources')}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close settings')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          <div>
            {/* Always bilingual, so the setting is easy to find whatever language is active */}
            <label className="flex items-center gap-1.5 font-semibold text-zinc-200 mb-1.5">
              <Languages className="w-4 h-4 text-emerald-400" />
              Language / Język
            </label>
            <div className="flex items-center gap-2">
              {LANGUAGES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={saving}
                  aria-pressed={lang === option.id}
                  onClick={() => setLanguage(option.id)}
                  className={`px-3 py-1.5 rounded-md border font-medium cursor-pointer disabled:opacity-50 ${
                    lang === option.id
                      ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <span className="text-[11px] text-zinc-500">{t('Changing the language reloads the app.')}</span>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800">
            <label className="flex items-center gap-1.5 font-semibold text-zinc-200 mb-1.5">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              {t('Main Soldat / OpenSoldat installation folder')}
            </label>
            <p className="text-[11px] text-zinc-400 mb-2">
              {tr(
                'This folder provides the maps ({maps}, {downloads}), textures ({textures}, {edges}), sceneries ({scenery}) and the list of default game files ({readonly}).',
                {
                  maps: <code>maps/</code>,
                  downloads: <code>downloads/maps/</code>,
                  textures: <code>textures/</code>,
                  edges: <code>textures/edges/</code>,
                  scenery: <code>scenery-gfx/</code>,
                  readonly: <code>readonly.txt</code>,
                }
              )}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={localSoldatPath}
                onChange={(e) => setLocalSoldatPath(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={async () => {
                  const chosen = await pickSystemFolder(t('Choose the main Soldat game folder'));
                  if (chosen) setLocalSoldatPath(chosen);
                }}
                className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium cursor-pointer"
              >
                {t('Browse...')}
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 space-y-2.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <FolderTree className="w-4 h-4 text-sky-400" />
              {t('Extra map archives and collections (.pms)')}
            </label>
            <p className="text-[11px] text-zinc-400">
              {tr(
                'You can attach huge collections (e.g. 50,000+ maps from servers, Gather or old backups). If {textures} and {scenery} folders sit next to the {maps} folder, they are detected automatically!',
                { textures: <code>textures/</code>, scenery: <code>scenery-gfx/</code>, maps: <code>maps</code> }
              )}
            </p>

            <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPathInput}
                  onChange={(e) => setNewPathInput(e.target.value)}
                  placeholder={t('Path to a folder with .pms files...')}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  value={newLabelInput}
                  onChange={(e) => setNewLabelInput(e.target.value)}
                  placeholder={t('Label (optional)')}
                  className="w-36 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRecursive}
                    onChange={(e) => setNewRecursive(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  {t('Scan subfolders recursively')}
                </label>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const chosen = await pickSystemFolder(t('Choose an extra folder with .pms maps'));
                      if (chosen) addSourceFolder(chosen);
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1 cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5" /> {t('Pick from disk...')}
                  </button>
                  <button
                    type="button"
                    onClick={() => addSourceFolder(newPathInput)}
                    disabled={!newPathInput.trim()}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
                  >
                    {t('Add folder')}
                  </button>
                </div>
              </div>
            </div>

            {localSources.length > 0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg divide-y divide-zinc-800/70">
                {localSources.map((src) => (
                  <div
                    key={src.id}
                    className="px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={src.enabled}
                        onChange={(e) =>
                          setLocalSources((prev) =>
                            prev.map((s) =>
                              s.id === src.id ? { ...s, enabled: e.target.checked } : s
                            )
                          )
                        }
                        className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={src.label}
                            onChange={(e) =>
                              setLocalSources((prev) =>
                                prev.map((s) =>
                                  s.id === src.id ? { ...s, label: e.target.value } : s
                                )
                              )
                            }
                            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-xs font-medium text-zinc-200 w-44"
                          />
                          <label className="flex items-center gap-1 text-[11px] text-zinc-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={src.recursive}
                              onChange={(e) =>
                                setLocalSources((prev) =>
                                  prev.map((s) =>
                                    s.id === src.id ? { ...s, recursive: e.target.checked } : s
                                  )
                                )
                              }
                              className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                            />
                            {t('Recursive')}
                          </label>
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500 truncate mt-0.5">
                          {src.path}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setLocalSources((prev) => prev.filter((s) => s.id !== src.id))
                      }
                      className="text-zinc-500 hover:text-red-400 p-1 cursor-pointer shrink-0"
                      title={t('Remove the folder from the sources')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3">
          {error ? (
            <span className="text-[11px] text-red-300">{error}</span>
          ) : (
            <span className="text-[11px] text-zinc-500">
              {t('The SQLite WAL index remembers map headers — later starts take a fraction of a second.')}
            </span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer"
            >
              {saving ? t('Scanning...') : t('Save and Scan Maps')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
