import React, { useEffect, useMemo, useState } from 'react';
import {
  DuplicateGroup,
  DuplicatesResponse,
  IndexMetaResponse,
  LibraryMoveResult,
  UnusedSceneryReport,
} from '@shared/apiTypes';
import { formatBytes, openPathInExplorer } from '../utils/mapCache';
import { useModalDismiss } from '../utils/useModalDismiss';
import { AlertTriangle, Archive, CheckCircle2, Copy, FolderOpen, ImageOff, RefreshCw, X } from 'lucide-react';

interface LibraryToolsModalProps {
  open: boolean;
  initialTab: 'duplicates' | 'unused';
  onClose: () => void;
  onMetaUpdated: (meta: IndexMetaResponse) => void;
}

const GROUPS_PAGE = 150;
const UNUSED_PAGE = 400;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('pl-PL');
}

export const LibraryToolsModal: React.FC<LibraryToolsModalProps> = ({ open, initialTab, onClose, onMetaUpdated }) => {
  const [tab, setTab] = useState<'duplicates' | 'unused'>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LibraryMoveResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Duplicates
  const [dups, setDups] = useState<DuplicatesResponse | null>(null);
  const [keepByCrc, setKeepByCrc] = useState<Record<string, string>>({});
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(() => new Set());
  const [groupsShown, setGroupsShown] = useState(GROUPS_PAGE);

  // Unused sceneries
  const [unused, setUnused] = useState<UnusedSceneryReport | null>(null);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());
  const [unusedShown, setUnusedShown] = useState(UNUSED_PAGE);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setResult(null);
      setError(null);
      setConfirming(false);
    }
  }, [open, initialTab]);

  const loadDuplicates = () => {
    setError(null);
    fetch('/api/library/duplicates')
      .then((r) => r.json())
      .then((d: DuplicatesResponse) => {
        setDups(d);
        setKeepByCrc(Object.fromEntries(d.groups.map((g) => [g.crcHex, g.suggestedKeepId])));
        // Exact copies (one name) are pre-selected; groups with different names stay untouched by default
        setSelectedGroups(new Set(d.groups.filter((g) => g.sameName).map((g) => g.crcHex)));
        setGroupsShown(GROUPS_PAGE);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const loadUnused = () => {
    setError(null);
    fetch('/api/library/unused-scenery')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        return d as UnusedSceneryReport;
      })
      .then((d) => {
        setUnused(d);
        setSelectedNames(new Set());
        setUnusedShown(UNUSED_PAGE);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    if (!open) return;
    if (tab === 'duplicates' && !dups) loadDuplicates();
    if (tab === 'unused' && !unused) loadUnused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  const dupMoveIds = useMemo(() => {
    if (!dups) return [];
    const ids: string[] = [];
    for (const g of dups.groups) {
      if (!selectedGroups.has(g.crcHex)) continue;
      const keep = keepByCrc[g.crcHex] ?? g.suggestedKeepId;
      for (const f of g.files) if (f.id !== keep) ids.push(f.id);
    }
    return ids;
  }, [dups, selectedGroups, keepByCrc]);

  const unusedSelectedBytes = useMemo(() => {
    if (!unused) return 0;
    return unused.items.reduce((acc, i) => (selectedNames.has(i.name) ? acc + i.size : acc), 0);
  }, [unused, selectedNames]);

  const backdropProps = useModalDismiss(open, onClose, busy);
  if (!open) return null;

  const runMove = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res =
        tab === 'duplicates'
          ? await postJson<LibraryMoveResult>('/api/library/duplicates/move', { mapIds: dupMoveIds })
          : await postJson<LibraryMoveResult>('/api/library/unused-scenery/move', {
              names: Array.from(selectedNames),
            });
      setResult(res);
      if (res.meta) onMetaUpdated(res.meta);
      if (tab === 'duplicates') loadDuplicates();
      else loadUnused();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const moveCount = tab === 'duplicates' ? dupMoveIds.length : selectedNames.size;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-xs">
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <Archive className="w-5 h-5 text-emerald-400" /> Porządki w kolekcji
            </h2>
            <p className="text-[11px] text-zinc-400">
              Pliki są przenoszone do <code>data/backups/</code> (z listą PRZYWRACANIE.txt) — nic nie jest kasowane.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Zamknij porządki"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-2 border-b border-zinc-800 flex items-center gap-1">
          {(
            [
              ['duplicates', 'Duplikaty CRC32', <Copy key="d" className="w-3.5 h-3.5" />],
              ['unused', 'Nieużywane scenerie', <ImageOff key="u" className="w-3.5 h-3.5" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => {
                setTab(id);
                setConfirming(false);
                setResult(null);
              }}
              className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 cursor-pointer ${
                tab === id ? 'bg-zinc-800 text-emerald-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => (tab === 'duplicates' ? loadDuplicates() : loadUnused())}
            title="Odśwież listę"
            aria-label="Odśwież listę"
            className="ml-auto p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
          {tab === 'duplicates' ? (
            !dups ? (
              <div className="text-zinc-500">Wczytywanie grup duplikatów...</div>
            ) : dups.groups.length === 0 ? (
              <div className="text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> W kolekcji nie ma map o identycznej sumie CRC32.
              </div>
            ) : (
              <>
                <div className="text-zinc-400 leading-relaxed">
                  {dups.totalGroups} grup identycznych map ({dups.totalRemovable} zbędnych kopii). Domyślnie zaznaczone są
                  tylko grupy, w których wszystkie kopie mają <strong>tę samą nazwę</strong>. Kopie o różnych nazwach mogą
                  być wpisane na listach map serwerów — przenieś je świadomie.
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGroups(new Set(dups.groups.map((g) => g.crcHex)))}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    Zaznacz wszystkie grupy
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedGroups(new Set())}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    Odznacz wszystkie
                  </button>
                </div>
                {dups.groups.slice(0, groupsShown).map((g) => (
                  <DuplicateGroupCard
                    key={g.crcHex}
                    group={g}
                    selected={selectedGroups.has(g.crcHex)}
                    keepId={keepByCrc[g.crcHex] ?? g.suggestedKeepId}
                    onToggle={() =>
                      setSelectedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.crcHex)) next.delete(g.crcHex);
                        else next.add(g.crcHex);
                        return next;
                      })
                    }
                    onKeep={(id) => setKeepByCrc((prev) => ({ ...prev, [g.crcHex]: id }))}
                  />
                ))}
                {dups.groups.length > groupsShown && (
                  <button
                    type="button"
                    onClick={() => setGroupsShown((n) => n + GROUPS_PAGE)}
                    className="w-full py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    Pokaż kolejne grupy ({dups.groups.length - groupsShown})
                  </button>
                )}
              </>
            )
          ) : !unused ? (
            <div className="text-zinc-500">Liczenie plików scenerii używanych przez mapy...</div>
          ) : (
            <>
              <div className="text-zinc-400 leading-relaxed">
                Folder <code className="text-zinc-300">{unused.folder}</code>: {unused.totalFiles} plików graficznych,{' '}
                {unused.usedFiles} używanych przez zindeksowane mapy, {unused.vanillaSkipped} domyślnych plików gry
                (pominięte). <strong className="text-amber-200">{unused.unusedCount}</strong> nieużywanych (
                {formatBytes(unused.unusedBytes)}).
              </div>
              <div className="bg-amber-950/40 border border-amber-600/40 rounded-lg px-3 py-2 text-amber-100 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Liczą się tylko mapy z indeksu Studio. Jeśli trzymasz mapy w innych miejscach (np. na serwerze), dodaj je
                  w „Źródłach map” przed porządkami — inaczej ich scenerie też trafią na tę listę.
                </span>
              </div>
              {unused.items.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedNames(new Set(unused.items.map((i) => i.name)))}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    Zaznacz wszystkie ({unused.items.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedNames(new Set())}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                  >
                    Odznacz
                  </button>
                </div>
              )}
              <div className="divide-y divide-zinc-800/70 border border-zinc-800 rounded-lg">
                {unused.items.slice(0, unusedShown).map((item) => (
                  <label
                    key={item.name}
                    className="px-3 py-1.5 flex items-center justify-between gap-3 hover:bg-zinc-800/40 cursor-pointer"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedNames.has(item.name)}
                        onChange={() =>
                          setSelectedNames((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.name)) next.delete(item.name);
                            else next.add(item.name);
                            return next;
                          })
                        }
                        className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                      />
                      <span className="font-mono text-zinc-200 truncate">{item.name}</span>
                    </span>
                    <span className="font-mono text-zinc-500 shrink-0">
                      {formatBytes(item.size)} • {formatDate(item.mtimeMs)}
                    </span>
                  </label>
                ))}
              </div>
              {unused.items.length > unusedShown && (
                <button
                  type="button"
                  onClick={() => setUnusedShown((n) => n + UNUSED_PAGE)}
                  className="w-full py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  Pokaż kolejne ({unused.items.length - unusedShown})
                </button>
              )}
              {unused.truncated && (
                <div className="text-[11px] text-zinc-500">Lista pokazuje 5000 największych plików.</div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 space-y-2">
          {error && (
            <div className="bg-red-950/80 border border-red-700 rounded px-3 py-1.5 text-red-200">{error}</div>
          )}
          {result && (
            <div className="bg-emerald-950/60 border border-emerald-500/40 rounded px-3 py-2 text-emerald-100 flex items-center justify-between gap-3">
              <span>
                Przeniesiono {result.moved} plików
                {result.failed.length > 0 && `, nie udało się: ${result.failed.length} (${result.failed[0].name}: ${result.failed[0].error})`}
                .
              </span>
              {result.backupDir && (
                <button
                  type="button"
                  onClick={() => openPathInExplorer(result.backupDir!)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Kopia
                </button>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-400">
              {tab === 'duplicates'
                ? `Do przeniesienia: ${moveCount} plików map`
                : `Zaznaczone: ${moveCount} plików (${formatBytes(unusedSelectedBytes)})`}
            </span>
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-amber-200">Przenieść {moveCount} plików do kopii zapasowej?</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={runMove}
                  className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Przenoszenie...' : 'Tak, przenieś'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy || moveCount === 0}
                onClick={() => setConfirming(true)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-40 cursor-pointer"
              >
                Przenieś do kopii zapasowej
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const DuplicateGroupCard: React.FC<{
  group: DuplicateGroup;
  selected: boolean;
  keepId: string;
  onToggle: () => void;
  onKeep: (id: string) => void;
}> = ({ group, selected, keepId, onToggle, onKeep }) => (
  <div className={`border rounded-lg ${selected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800'}`}>
    <label className="px-3 py-2 flex items-center justify-between gap-3 cursor-pointer">
      <span className="flex items-center gap-2 min-w-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
        />
        <span className="font-mono font-semibold text-zinc-100 truncate">{group.files[0].baseName}</span>
        <span className="font-mono text-[10px] text-zinc-500">CRC {group.crcHex}</span>
      </span>
      {group.sameName ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/25 shrink-0">
          {group.files.length} identyczne kopie
        </span>
      ) : (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/35 shrink-0">
          różne nazwy — sprawdź listy map serwerów
        </span>
      )}
    </label>
    <div className="px-3 pb-2 space-y-1">
      {group.files.map((f) => (
        <label key={f.id} className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="flex items-center gap-2 min-w-0">
            <input
              type="radio"
              name={`keep-${group.crcHex}`}
              checked={keepId === f.id}
              onChange={() => onKeep(f.id)}
              className="border-zinc-700 bg-zinc-900 text-emerald-500"
            />
            <span className={`text-[10px] w-14 shrink-0 ${keepId === f.id ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {keepId === f.id ? 'zostaje' : selected ? 'do kopii' : '—'}
            </span>
            <span className="font-mono text-zinc-300 truncate" title={f.fullPath}>
              {f.fullPath}
            </span>
          </span>
          <span className="text-zinc-500 shrink-0">
            {f.sourceLabel} • {formatBytes(f.fileSize)} • {formatDate(f.mtimeMs)}
          </span>
        </label>
      ))}
    </div>
  </div>
);
