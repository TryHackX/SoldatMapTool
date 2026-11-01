import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SubprefixCountItem } from '@shared/apiTypes';
import {
  BUILTIN_MODE_GROUPS,
  createMapClassifier,
  CustomPrefixRule,
  normalizePrefixToken,
  sanitizeCustomRules,
} from '@shared/prefixUtils';
import { useModalDismiss } from '../utils/useModalDismiss';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Plus,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

interface PrefixStudioModalProps {
  open: boolean;
  onClose: () => void;
  customRules: CustomPrefixRule[];
  discoveredSubprefixes: SubprefixCountItem[];
  initialDraftPrefix?: string | null;
  onSaveRules: (rules: CustomPrefixRule[]) => Promise<void>;
}

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#f43f5e',
  '#94a3b8',
];

export const PrefixStudioModal: React.FC<PrefixStudioModalProps> = ({
  open,
  onClose,
  customRules,
  discoveredSubprefixes,
  initialDraftPrefix,
  onSaveRules,
}) => {
  const [rules, setRules] = useState<CustomPrefixRule[]>(customRules);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form fields for new / edited rule
  const [name, setName] = useState('');
  const [prefixesInput, setPrefixesInput] = useState('');
  const [patternInput, setPatternInput] = useState('');
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [badgeColor, setBadgeColor] = useState('#a855f7');

  // Live classifier tester
  const [testMapName, setTestMapName] = useState('ctf_cs_assault');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize only on the opening transition: a background meta refresh (new customRules array identity)
  // must never wipe what the user is typing.
  const initializedForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;
    setRules(customRules);
    setError(null);

    if (initialDraftPrefix) {
      const clean = normalizePrefixToken(initialDraftPrefix);
      const niceTag = clean.replace(/_+$/, '').toUpperCase();
      setEditingId(null);
      setName(`Seria ${niceTag}`);
      setPrefixesInput(clean);
      setPatternInput('');
      setTargetGroupId('');
      setBadgeColor('#a855f7');
      setTestMapName(`${clean}arena`);
    } else {
      resetForm();
    }
  }, [open, customRules, initialDraftPrefix]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setPrefixesInput('');
    setPatternInput('');
    setTargetGroupId('');
    setBadgeColor('#a855f7');
  };

  const liveClassifier = useMemo(() => createMapClassifier(rules), [rules]);
  const liveTestResult = useMemo(
    () => (testMapName.trim() ? liveClassifier.classify(testMapName.trim()) : null),
    [liveClassifier, testMapName]
  );

  const backdropProps = useModalDismiss(open, onClose, saving);

  if (!open) return null;

  const startEditRule = (rule: CustomPrefixRule) => {
    setEditingId(rule.id);
    setName(rule.name);
    setPrefixesInput(rule.prefixes.join(', '));
    setPatternInput(rule.pattern || '');
    setTargetGroupId(rule.targetGroupId || '');
    setBadgeColor(rule.badgeColor || '#a855f7');
  };

  const handleUpsertRule = () => {
    setError(null);
    const parsedPrefixes = prefixesInput
      .split(/[,;\s]+/)
      .map((s) => normalizePrefixToken(s))
      .filter(Boolean);

    const trimmedName = name.trim();
    const trimmedPattern = patternInput.trim();

    if (!trimmedName) {
      setError('Podaj nazwę reguły lub własnej kategorii (np. "Mapy Klanu NS" albo "RSCS Extra").');
      return;
    }
    if (parsedPrefixes.length === 0 && !trimmedPattern) {
      setError('Podaj przynajmniej jeden prefix (np. ctf_ns_) lub wzorzec Wildcard/Regex (np. *_fix).');
      return;
    }

    if (editingId) {
      setRules((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...r,
                name: trimmedName,
                prefixes: parsedPrefixes,
                pattern: trimmedPattern || undefined,
                badgeColor,
                targetGroupId: targetGroupId || undefined,
              }
            : r
        )
      );
    } else {
      const maxPrio = rules.reduce((m, r) => Math.max(m, r.priority || 0), 10);
      const newRule: CustomPrefixRule = {
        id: `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName,
        prefixes: parsedPrefixes,
        pattern: trimmedPattern || undefined,
        badgeColor,
        targetGroupId: targetGroupId || undefined,
        priority: maxPrio + 10,
        enabled: true,
      };
      setRules((prev) => [newRule, ...prev]);
    }
    resetForm();
  };

  const moveRule = (index: number, dir: -1 | 1) => {
    const nextIdx = index + dir;
    if (nextIdx < 0 || nextIdx >= rules.length) return;
    const copy = [...rules];
    const [moved] = copy.splice(index, 1);
    copy.splice(nextIdx, 0, moved);
    // Re-number priorities descending
    const total = copy.length;
    setRules(copy.map((r, idx) => ({ ...r, priority: (total - idx) * 10 })));
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soldat_custom_prefixes.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '[]'));
        if (!Array.isArray(parsed)) throw new Error('Plik JSON musi zawierać tablicę reguł.');
        const valid = sanitizeCustomRules(parsed);
        if (valid.length === 0 && parsed.length > 0) {
          throw new Error('Plik nie zawiera żadnej poprawnej reguły (wymagana nazwa oraz prefix lub wzorzec).');
        }
        setRules(valid);
        setError(
          valid.length < parsed.length
            ? `Zaimportowano ${valid.length} z ${parsed.length} reguł — pominięto niepoprawne wpisy.`
            : null
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nieprawidłowy plik JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveRules(rules);
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
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-5xl h-[86vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Tags className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-zinc-100">
                Studio Prefixów i Trybów Soldat (RSCS / Trenchwars / Custom)
              </h2>
              <p className="text-[11px] text-zinc-400">
                Twórz własne kategorie, prefixy wieloczłonowe (np. <code>ctf_ns_</code>, <code>ctf_ttw_</code>) oraz reguły Wildcard / Regex
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              title="Eksportuj własne prefixy do pliku JSON"
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Eksport JSON
            </button>
            <label className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5" /> Import JSON
              <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
            </label>
            <button
              onClick={onClose}
              aria-label="Zamknij studio prefixów"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-zinc-800">
          {/* Left Column: Rule Editor + Quick Subprefix Promoter */}
          <div className="col-span-5 p-4 overflow-y-auto space-y-4 text-xs">
            <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  {editingId ? 'Edycja reguły prefixu' : 'Dodaj własny prefix / kategorię'}
                </span>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    Anuluj edycję
                  </button>
                )}
              </div>

              <div>
                <label className="block text-zinc-300 font-medium mb-1">
                  Nazwa kategorii lub reguły
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="np. Liga SCTFL, Mapy Klanu NS, Poprawione (_f)"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-medium mb-1">
                  Prefixy (oddzielone przecinkiem lub spacją)
                </label>
                <input
                  type="text"
                  value={prefixesInput}
                  onChange={(e) => setPrefixesInput(e.target.value)}
                  placeholder="np. ctf_ns_, sctfl_, ctf_cup_"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
                <div className="text-[10px] text-zinc-500 mt-1">
                  Dłuższe prefixy (np. <code>ctf_ns_</code>) mają automatycznie wyższy priorytet niż ogólne <code>ctf_</code>.
                </div>
              </div>

              <div>
                <label className="block text-zinc-300 font-medium mb-1">
                  Wzorzec Wildcard lub Regex <span className="text-zinc-500">(opcjonalnie)</span>
                </label>
                <input
                  type="text"
                  value={patternInput}
                  onChange={(e) => setPatternInput(e.target.value)}
                  placeholder="np. *_f, *arena* lub /^ctf_[0-9]+_/i"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-medium mb-1">
                  Przypisz do grupy na pasku bocznym
                </label>
                <select
                  value={targetGroupId}
                  onChange={(e) => setTargetGroupId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">★ Utwórz osobną własną kategorię na liście Trybów</option>
                  {BUILTIN_MODE_GROUPS.filter((g) => g.id !== 'other').map((g) => (
                    <option key={g.id} value={g.id}>
                      Podepnij pod istniejący tryb: {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-300 font-medium mb-1">Kolor plakietki</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBadgeColor(c)}
                      className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                        badgeColor.toLowerCase() === c.toLowerCase()
                          ? 'scale-125 border-white ring-2 ring-white/40'
                          : 'border-zinc-700 hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={badgeColor}
                    onChange={(e) => setBadgeColor(e.target.value)}
                    className="w-6 h-6 bg-transparent border-0 cursor-pointer ml-1"
                    title="Wybierz dowolny kolor HEX"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-950/80 border border-red-700 rounded px-2.5 py-1.5 text-[11px] text-red-200">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleUpsertRule}
                className="w-full py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                {editingId ? 'Zaktualizuj regułę na liście' : 'Dodaj regułę do listy'}
              </button>
            </div>

            {/* Discovered 2-part subprefixes quick promoter */}
            {discoveredSubprefixes.length > 0 && (
              <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Wykryte serie 2-członowe w Twojej kolekcji
                </div>
                <p className="text-[11px] text-zinc-500">
                  Kliknij serię, aby szybko wypełnić formularz i wydzielić ją jako osobny prefix:
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {discoveredSubprefixes.slice(0, 30).map((sub) => (
                    <button
                      key={sub.subprefix}
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setName(`Seria ${sub.subprefix.replace(/_+$/, '').toUpperCase()}`);
                        setPrefixesInput(sub.subprefix);
                        setPatternInput('');
                        setTestMapName(`${sub.subprefix}map`);
                      }}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-emerald-500/20 border border-zinc-800 hover:border-emerald-500/40 font-mono text-[11px] text-zinc-300 hover:text-emerald-200 cursor-pointer"
                    >
                      {sub.subprefix} <span className="text-zinc-500">({sub.count})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Active Custom Rules + Built-in Reference + Live Tester */}
          <div className="col-span-7 p-4 flex flex-col min-h-0 space-y-4 text-xs">
            {/* Live Classifier Tester */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-[11px] text-zinc-400 mb-1">
                  Tester klasyfikatora na żywo (wpisz dowolną nazwę mapy):
                </div>
                <input
                  type="text"
                  value={testMapName}
                  onChange={(e) => setTestMapName(e.target.value)}
                  placeholder="np. ctf_cs_747, ctf_ttw_bunker, tw_cathedral..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
              {liveTestResult && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 shrink-0 min-w-56">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: liveTestResult.badgeColor }}
                    />
                    <span className="font-bold text-zinc-100 truncate">
                      {liveTestResult.modeGroupName}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    Prefix: <span className="text-emerald-300">{liveTestResult.prefix}</span>
                    {liveTestResult.subprefix ? ` • Seria: ${liveTestResult.subprefix}` : ''}
                  </div>
                </div>
              )}
            </div>

            {/* User Custom Rules List */}
            <div className="flex-1 min-h-0 flex flex-col bg-zinc-950/70 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-zinc-900/70 border-b border-zinc-800 flex items-center justify-between">
                <span className="font-semibold text-zinc-200">
                  Twoje Własne Reguły i Prefixy ({rules.length})
                </span>
                <span className="text-[11px] text-zinc-500">
                  Własne reguły mają pierwszeństwo przed wbudowanymi
                </span>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/70">
                {rules.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500">
                    Brak zdefiniowanych własnych reguł. Wbudowane tryby (RSCS, Trenchwars, CTF, Climb, INF, HTF...) działają automatycznie — poniżej możesz dodać własne prefixy klanowe, ligowe lub niestandardowe!
                  </div>
                ) : (
                  rules.map((r, idx) => (
                    <div
                      key={r.id}
                      className={`px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-900/50 ${
                        !r.enabled ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) =>
                            setRules((prev) =>
                              prev.map((item) =>
                                item.id === r.id ? { ...item, enabled: e.target.checked } : item
                              )
                            )
                          }
                          className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                        />
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: r.badgeColor }}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-100 truncate">
                            {r.name}
                            {r.targetGroupId && (
                              <span className="ml-2 text-[10px] font-normal text-zinc-400">
                                → podpięte do: {r.targetGroupId.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-emerald-300/90 truncate">
                            {r.prefixes.length > 0 && r.prefixes.join(', ')}
                            {r.pattern && (
                              <span className="text-amber-300 ml-2">wzór: {r.pattern}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveRule(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 cursor-pointer"
                          title="Wyższy priorytet"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRule(idx, 1)}
                          disabled={idx === rules.length - 1}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 cursor-pointer"
                          title="Niższy priorytet"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditRule(r)}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 cursor-pointer"
                        >
                          Edytuj
                        </button>
                        <button
                          type="button"
                          onClick={() => setRules((prev) => prev.filter((item) => item.id !== r.id))}
                          className="p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 cursor-pointer"
                          title="Usuń regułę"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Built-in Compound Modes Summary Reference */}
            <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-2.5 max-h-36 overflow-y-auto">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Wbudowane Tryby Złożone (aktywne zawsze automatycznie)
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {BUILTIN_MODE_GROUPS.filter((g) => g.defaultPrefixes.length > 0).map((g) => (
                  <div key={g.id} className="bg-zinc-900/60 rounded px-2 py-1 truncate">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5"
                      style={{ backgroundColor: g.badgeColor }}
                    />
                    <strong className="text-zinc-200">{g.shortName}:</strong>{' '}
                    <span className="font-mono text-[10px] text-zinc-400">
                      {g.defaultPrefixes
                        .map((p) => (p === '__none__' ? '(brak)' : p))
                        .join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/70 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            Zapisanie reguł natychmiast przeklasyfikuje wszystkie mapy w pamięci (nawet 50 000+ map bez ponownego czytania dysku).
          </span>
          <div className="flex items-center gap-2">
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
              onClick={handleSaveAll}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              {saving ? 'Zapisywanie...' : 'Zapisz i Zastosuj Prefixy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
