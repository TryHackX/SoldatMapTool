import React, { useEffect, useRef, useState } from 'react';
import { ExtraMapSource } from '@shared/apiTypes';
import { pickSystemFolder } from '../utils/mapCache';
import { useModalDismiss } from '../utils/useModalDismiss';
import { FolderPlus, FolderTree, HardDrive, Settings, Trash2, X } from 'lucide-react';

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
      `Archiwum #${localSources.length + 1}`;

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
            <h2 className="text-base font-bold text-zinc-100">
              Źródła Map i Katalogi Soldat (Obsługa 50 000+ Map)
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Zamknij ustawienia źródeł"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          <div>
            <label className="flex items-center gap-1.5 font-semibold text-zinc-200 mb-1.5">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              Główny folder instalacji Soldat / OpenSoldat
            </label>
            <p className="text-[11px] text-zinc-400 mb-2">
              Z tego katalogu pobierane są mapy (<code>maps/</code>, <code>downloads/maps/</code>),
              tekstury (<code>textures/</code>, <code>textures/edges/</code>), scenerie (
              <code>scenery-gfx/</code>) oraz baza plików domyślnych (<code>readonly.txt</code>).
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
                  const chosen = await pickSystemFolder('Wybierz główny katalog gry Soldat');
                  if (chosen) setLocalSoldatPath(chosen);
                }}
                className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium cursor-pointer"
              >
                Przeglądaj...
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 space-y-2.5">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <FolderTree className="w-4 h-4 text-sky-400" />
              Dodatkowe archiwa i kolekcje map (.pms)
            </label>
            <p className="text-[11px] text-zinc-400">
              Możesz podpiąć wielkie kolekcje (np. 50 000+ map z serwerów, Gathera lub starych kopii).
              Jeśli obok folderu <code>maps</code> znajdują się sąsiednie katalogi{' '}
              <code>textures/</code> i <code>scenery-gfx/</code>, zostaną wykryte automatycznie!
            </p>

            <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPathInput}
                  onChange={(e) => setNewPathInput(e.target.value)}
                  placeholder="Ścieżka do folderu z plikami .pms..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  value={newLabelInput}
                  onChange={(e) => setNewLabelInput(e.target.value)}
                  placeholder="Etykieta (opcj.)"
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
                  Skanuj podfoldery rekurencyjnie
                </label>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      const chosen = await pickSystemFolder('Wybierz dodatkowy folder z mapami .pms');
                      if (chosen) addSourceFolder(chosen);
                    }}
                    className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1 cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5" /> Wybierz z dysku...
                  </button>
                  <button
                    type="button"
                    onClick={() => addSourceFolder(newPathInput)}
                    disabled={!newPathInput.trim()}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
                  >
                    Dodaj folder
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
                            Rekurencyjnie
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
                      title="Usuń folder ze źródeł"
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
              Indeks SQLite WAL zapamiętuje nagłówki map — kolejne uruchomienia trwają ułamek sekundy.
            </span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
            >
              Anuluj
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer"
            >
              {saving ? 'Skanowanie...' : 'Zapisz i Skanuj Mapy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
