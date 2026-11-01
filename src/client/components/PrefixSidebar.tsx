import React, { useMemo, useState } from 'react';
import {
  ModeGroupCountItem,
  PrefixCountItem,
  SourceCountItem,
  StatusFilterMode,
  SubprefixCountItem,
  UserTagCount,
} from '@shared/apiTypes';
import {
  AlertTriangle,
  Ban,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CloudRain,
  Copy,
  Filter,
  FolderCheck,
  HardDrive,
  Layers,
  Package,
  Plus,
  Search,
  Sparkles,
  Star,
  Tag,
  Tags,
} from 'lucide-react';

export type { StatusFilterMode };

const ROW_FOCUS_CLASS = 'focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/70';

// Selectable rows hold their own buttons (expand, add to pack), so they cannot be <button>s themselves:
// Enter / Space on the focused row toggles it (Ctrl/Cmd = multi-select, like a click)
function rowKeyHandler(onActivate: (multi: boolean) => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate(e.ctrlKey || e.metaKey);
    }
  };
}

export interface ExtraFilterState {
  weather: number | 'any';
  requireColliders: boolean;
  requireWaypoints: boolean;
  requireCaseMismatch: boolean;
}

interface PrefixSidebarProps {
  totalMaps: number;
  customMapsCount: number;
  vanillaMapsCount: number;
  brokenMapsCount: number;
  duplicateMapsCount: number;
  incompatibleMapsCount: number;
  favoriteMapsCount: number;
  userTags: UserTagCount[];
  onSearchTag: (tag: string) => void;
  packCount: number;

  modeGroups: ModeGroupCountItem[];
  prefixes: PrefixCountItem[];
  discoveredSubprefixes: SubprefixCountItem[];
  sources: SourceCountItem[];

  selectedModeGroupIds: string[];
  selectedPrefixes: string[];
  selectedSubprefixes: string[];
  selectedSourceIds: string[];

  onToggleModeGroup: (groupId: string, multi: boolean) => void;
  onTogglePrefix: (prefix: string, multi: boolean) => void;
  onToggleSubprefix: (subprefix: string, multi: boolean) => void;
  onToggleSource: (sourceId: string) => void;
  onClearTaxonomySelection: () => void;

  onAddModeGroupToPack: (groupId: string) => void;
  onAddPrefixToPack: (prefix: string) => void;
  onAddSubprefixToPack: (subprefix: string) => void;
  onOpenPrefixStudio: (draftPrefix?: string) => void;

  statusFilter: StatusFilterMode;
  onChangeStatusFilter: (mode: StatusFilterMode) => void;
  extraFilters: ExtraFilterState;
  onChangeExtraFilters: (next: ExtraFilterState) => void;
  onOpenCaseTools?: () => void;
}

export const PrefixSidebar: React.FC<PrefixSidebarProps> = ({
  totalMaps,
  customMapsCount,
  vanillaMapsCount,
  brokenMapsCount,
  duplicateMapsCount,
  incompatibleMapsCount,
  favoriteMapsCount,
  userTags,
  onSearchTag,
  packCount,
  modeGroups,
  prefixes,
  discoveredSubprefixes,
  sources,
  selectedModeGroupIds,
  selectedPrefixes,
  selectedSubprefixes,
  selectedSourceIds,
  onToggleModeGroup,
  onTogglePrefix,
  onToggleSubprefix,
  onToggleSource,
  onClearTaxonomySelection,
  onAddModeGroupToPack,
  onAddPrefixToPack,
  onAddSubprefixToPack,
  onOpenPrefixStudio,
  statusFilter,
  onChangeStatusFilter,
  extraFilters,
  onChangeExtraFilters,
  onOpenCaseTools,
}) => {
  const [navTab, setNavTab] = useState<'modes' | 'prefixes' | 'series'>('modes');
  const [prefixQuery, setPrefixQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    rscs: true,
    trenchwars: true,
  });

  const q = prefixQuery.trim().toLowerCase();

  const filteredModeGroups = useMemo(() => {
    if (!q) return modeGroups;
    return modeGroups
      .map((g) => {
        const groupMatches = g.name.toLowerCase().includes(q) || g.shortName.toLowerCase().includes(q);
        const matchingSub = g.prefixes.filter(
          (p) => p.label.toLowerCase().includes(q) || p.prefix.toLowerCase().includes(q)
        );
        if (groupMatches) return g;
        if (matchingSub.length > 0) return { ...g, prefixes: matchingSub };
        return null;
      })
      .filter((x): x is ModeGroupCountItem => Boolean(x));
  }, [modeGroups, q]);

  const filteredPrefixes = useMemo(() => {
    if (!q) return prefixes;
    return prefixes.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.modeName.toLowerCase().includes(q)
    );
  }, [prefixes, q]);

  const filteredSeries = useMemo(() => {
    if (!q) return discoveredSubprefixes;
    return discoveredSubprefixes.filter((s) => s.subprefix.toLowerCase().includes(q));
  }, [discoveredSubprefixes, q]);

  const activeTaxonomyCount =
    selectedModeGroupIds.length + selectedPrefixes.length + selectedSubprefixes.length;

  const statusButtons: Array<{
    mode: StatusFilterMode;
    label: string;
    count: number;
    icon: React.ReactNode;
    accent?: string;
  }> = [
    {
      mode: 'all',
      label: 'Wszystkie mapy',
      count: totalMaps,
      icon: <Layers className="w-3.5 h-3.5 text-zinc-400" />,
    },
    {
      mode: 'custom',
      label: 'Mapy Customowe',
      count: customMapsCount,
      icon: <Sparkles className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      mode: 'vanilla',
      label: 'Domyślne (Vanilla)',
      count: vanillaMapsCount,
      icon: <FolderCheck className="w-3.5 h-3.5 text-sky-400" />,
    },
    {
      mode: 'broken',
      label: 'Brakujące pliki',
      count: brokenMapsCount,
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
      accent: brokenMapsCount > 0 ? 'text-amber-300' : undefined,
    },
    {
      mode: 'duplicates',
      label: 'Duplikaty CRC32',
      count: duplicateMapsCount,
      icon: <Copy className="w-3.5 h-3.5 text-orange-400" />,
      accent: duplicateMapsCount > 0 ? 'text-orange-300' : undefined,
    },
    {
      mode: 'incompatible',
      label: 'Nie wczytają się w grze',
      count: incompatibleMapsCount,
      icon: <Ban className="w-3.5 h-3.5 text-red-400" />,
      accent: incompatibleMapsCount > 0 ? 'text-red-300' : undefined,
    },
    {
      mode: 'favorites',
      label: 'Ulubione',
      count: favoriteMapsCount,
      icon: <Star className="w-3.5 h-3.5 text-yellow-400" />,
      accent: favoriteMapsCount > 0 ? 'text-yellow-200' : undefined,
    },
    {
      mode: 'in_pack',
      label: 'Wybrane do paczki',
      count: packCount,
      icon: <Package className="w-3.5 h-3.5 text-violet-400" />,
      accent: packCount > 0 ? 'text-violet-300' : undefined,
    },
  ];

  const toggleGroupExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="w-64 2xl:w-72 shrink-0 bg-zinc-900/90 border-r border-zinc-800/90 flex flex-col h-full select-none">
      {/* Status Section */}
      <div className="p-2.5 border-b border-zinc-800/80">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 px-1">
          Kategorie Map
        </div>
        <div className="space-y-0.5">
          {statusButtons.map((b) => {
            const active = statusFilter === b.mode;
            return (
              <button
                key={b.mode}
                onClick={() => onChangeStatusFilter(b.mode)}
                className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/35 font-medium'
                    : 'text-zinc-300 hover:bg-zinc-800/70 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  {b.icon}
                  <span className={b.accent || ''}>{b.label}</span>
                </span>
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                    active ? 'bg-emerald-500/25 text-emerald-200' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {b.count.toLocaleString('pl-PL')}
                </span>
              </button>
            );
          })}
        </div>

        {/* User tags: a click adds `tag:<name>` to the map search */}
        {userTags.length > 0 && (
          <div className="mt-2 pt-2 border-t border-zinc-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 px-1 flex items-center gap-1">
              <Tag className="w-3 h-3" /> Twoje tagi ({userTags.length})
            </div>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {userTags.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => onSearchTag(t.tag)}
                  title={`Pokaż mapy z tagiem „${t.tag}” (dodaje tag:${t.tag} do wyszukiwania)`}
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-[10px] text-zinc-200 cursor-pointer"
                >
                  #{t.tag} <span className="font-mono text-zinc-500">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Multi-folder source filter when user attached extra directories */}
        {sources.length > 1 && (
          <div className="mt-2 pt-2 border-t border-zinc-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 px-1 flex items-center gap-1">
              <HardDrive className="w-3 h-3" /> Źródła Map ({sources.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {sources.map((src) => {
                const active = selectedSourceIds.includes(src.id);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => onToggleSource(src.id)}
                    title={src.path}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border truncate max-w-full cursor-pointer ${
                      active
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {src.label} ({src.count})
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Mode Groups & Prefix Explorer */}
      <div className="flex-1 min-h-0 flex flex-col p-2.5 border-b border-zinc-800/80">
        {/* Header + Custom Prefix Studio Trigger */}
        <div className="flex items-center justify-between mb-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Klasyfikacja
            </span>
            {activeTaxonomyCount > 0 && (
              <button
                onClick={onClearTaxonomySelection}
                className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
              >
                Wyczyść ({activeTaxonomyCount})
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => onOpenPrefixStudio()}
            title="Dodaj własne prefixy, kategorie klanowe lub reguły RSCS / Trenchwars"
            className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Tags className="w-3 h-3" />
            + Własny Prefix
          </button>
        </div>

        {/* 3-Tab Switcher: Tryby | Prefixy | Serie 2-czł. */}
        <div className="grid grid-cols-3 gap-0.5 bg-zinc-950 border border-zinc-800 rounded-md p-0.5 mb-2 text-[11px]">
          <button
            type="button"
            onClick={() => setNavTab('modes')}
            className={`py-1 rounded font-medium transition-colors cursor-pointer ${
              navTab === 'modes'
                ? 'bg-zinc-800 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Tryby ({modeGroups.length})
          </button>
          <button
            type="button"
            onClick={() => setNavTab('prefixes')}
            className={`py-1 rounded font-medium transition-colors cursor-pointer ${
              navTab === 'prefixes'
                ? 'bg-zinc-800 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Prefixy ({prefixes.length})
          </button>
          <button
            type="button"
            onClick={() => setNavTab('series')}
            title="Automatycznie wykryte serie dwuczłonowe (np. ctf_ns_, ctf_vir_)"
            className={`py-1 rounded font-medium transition-colors cursor-pointer ${
              navTab === 'series'
                ? 'bg-zinc-800 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Serie ({discoveredSubprefixes.length})
          </button>
        </div>

        {/* Search input */}
        <div className="relative mb-1.5">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={prefixQuery}
            onChange={(e) => setPrefixQuery(e.target.value)}
            placeholder="Szukaj (RSCS, tw_, ctf_cs_, kz_...)"
            className="w-full bg-zinc-950/80 border border-zinc-800 rounded-md pl-8 pr-6 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60"
          />
          {prefixQuery && (
            <button
              onClick={() => setPrefixQuery('')}
              aria-label="Wyczyść wyszukiwanie prefixów"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <div className="text-[10px] text-zinc-500 mb-1.5 px-1">
          Kliknij aby filtrować • <kbd className="text-zinc-400">Ctrl</kbd>+Klik wiele
        </div>

        {/* Scrollable Taxonomy List */}
        <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          {navTab === 'modes' &&
            filteredModeGroups.map((grp) => {
              const isGroupSelected = selectedModeGroupIds.includes(grp.id);
              const isExpanded = Boolean(expandedGroups[grp.id] || q);
              const hasSubList = grp.prefixes.length > 1 || (grp.prefixes.length === 1 && grp.isCustom);

              return (
                <div key={grp.id} className="space-y-0.5">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isGroupSelected}
                    onClick={(e) => onToggleModeGroup(grp.id, e.ctrlKey || e.metaKey)}
                    onKeyDown={rowKeyHandler((multi) => onToggleModeGroup(grp.id, multi))}
                    className={`group flex items-center justify-between px-1.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${ROW_FOCUS_CLASS} ${
                      isGroupSelected
                        ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/40'
                        : 'text-zinc-200 hover:bg-zinc-800/70 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {hasSubList ? (
                        <button
                          type="button"
                          onClick={(e) => toggleGroupExpand(grp.id, e)}
                          aria-label={isExpanded ? `Zwiń ${grp.name}` : `Rozwiń ${grp.name}`}
                          aria-expanded={isExpanded}
                          className="p-0.5 rounded hover:bg-zinc-700/70 text-zinc-400 shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: grp.badgeColor }}
                      />
                      <div className="truncate">
                        <div className="font-medium truncate leading-tight">
                          {grp.name}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500 truncate leading-tight">
                          {grp.prefixes
                            .slice(0, 4)
                            .map((p) => (p.prefix === '__none__' ? 'brak' : p.prefix))
                            .join(', ')}
                          {grp.prefixes.length > 4 ? ` +${grp.prefixes.length - 4}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddModeGroupToPack(grp.id);
                        }}
                        title={`Dodaj wszystkie mapy trybu "${grp.name}" (${grp.count}) do paczki`}
                        className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-violet-500/20 hover:bg-violet-500/40 text-violet-200 text-[10px] font-medium transition-opacity cursor-pointer"
                      >
                        +Pack
                      </button>
                      <span className="font-mono text-[10px] bg-zinc-800/90 text-zinc-300 px-1.5 py-0.5 rounded">
                        {grp.count.toLocaleString('pl-PL')}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Sub-prefixes inside Mode Group */}
                  {isExpanded && hasSubList && (
                    <div className="pl-5 space-y-0.5 border-l border-zinc-800/80 ml-3">
                      {grp.prefixes.map((p) => {
                        const isPfxSelected = selectedPrefixes.includes(p.prefix);
                        return (
                          <div
                            key={p.prefix}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isPfxSelected}
                            onClick={(e) => onTogglePrefix(p.prefix, e.ctrlKey || e.metaKey)}
                            onKeyDown={rowKeyHandler((multi) => onTogglePrefix(p.prefix, multi))}
                            className={`group flex items-center justify-between px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${ROW_FOCUS_CLASS} ${
                              isPfxSelected
                                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/35'
                                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 border border-transparent'
                            }`}
                          >
                            <span className="font-mono truncate">{p.label}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddPrefixToPack(p.prefix);
                                }}
                                className="opacity-0 group-hover:opacity-100 px-1 py-0.2 rounded bg-violet-500/20 hover:bg-violet-500/40 text-violet-200 text-[9px] cursor-pointer"
                              >
                                +Pack
                              </button>
                              <span className="font-mono text-[10px] text-zinc-500">
                                {p.count.toLocaleString('pl-PL')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

          {navTab === 'prefixes' &&
            filteredPrefixes.map((p) => {
              const isSelected = selectedPrefixes.includes(p.prefix);
              return (
                <div
                  key={p.prefix}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={(e) => onTogglePrefix(p.prefix, e.ctrlKey || e.metaKey)}
                  onKeyDown={rowKeyHandler((multi) => onTogglePrefix(p.prefix, multi))}
                  title={`${p.label} — ${p.modeName} (${p.count} map)`}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${ROW_FOCUS_CLASS} ${
                    isSelected
                      ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/40'
                      : 'text-zinc-300 hover:bg-zinc-800/70 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: p.badgeColor }}
                    />
                    <div className="truncate">
                      <div className="font-mono font-medium truncate leading-tight">{p.label}</div>
                      <div className="text-[10px] text-zinc-500 truncate leading-tight">
                        {p.modeName}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddPrefixToPack(p.prefix);
                      }}
                      title={`Dodaj wszystkie mapy "${p.label}" (${p.count}) do paczki`}
                      className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-violet-500/20 hover:bg-violet-500/40 text-violet-200 text-[10px] font-medium transition-opacity cursor-pointer"
                    >
                      +Pack
                    </button>
                    <span className="font-mono text-[10px] bg-zinc-800/90 text-zinc-400 px-1.5 py-0.5 rounded">
                      {p.count.toLocaleString('pl-PL')}
                    </span>
                  </div>
                </div>
              );
            })}

          {navTab === 'series' &&
            (filteredSeries.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-zinc-500">
                Brak wykrytych pod-serii dwuczłonowych dla bieżącego zapytania.
              </div>
            ) : (
              filteredSeries.map((s) => {
                const isSelected = selectedSubprefixes.includes(s.subprefix);
                return (
                  <div
                    key={s.subprefix}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={(e) => onToggleSubprefix(s.subprefix, e.ctrlKey || e.metaKey)}
                    onKeyDown={rowKeyHandler((multi) => onToggleSubprefix(s.subprefix, multi))}
                    className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${ROW_FOCUS_CLASS} ${
                      isSelected
                        ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/40'
                        : 'text-zinc-300 hover:bg-zinc-800/70 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium truncate">{s.subprefix}</div>
                      <div className="text-[10px] text-zinc-500">seria w {s.parentPrefix}</div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPrefixStudio(s.subprefix);
                        }}
                        title="Wydziel tę serię jako stały własny prefix / kategorię"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-200 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddSubprefixToPack(s.subprefix);
                        }}
                        className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded bg-violet-500/20 hover:bg-violet-500/40 text-violet-200 text-[10px] cursor-pointer"
                      >
                        +Pack
                      </button>
                      <span className="font-mono text-[10px] bg-zinc-800/90 text-zinc-400 px-1.5 py-0.5 rounded">
                        {s.count}
                      </span>
                    </div>
                  </div>
                );
              })
            ))}
        </div>
      </div>

      {/* Extra Gameplay / Audit Filters */}
      <div className="p-2.5 space-y-1.5 bg-zinc-950/40">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          <Filter className="w-3 h-3" />
          Filtry Techniczne
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <CloudRain className="w-3.5 h-3.5 text-sky-400" />
            Pogoda:
          </span>
          <select
            value={String(extraFilters.weather)}
            onChange={(e) =>
              onChangeExtraFilters({
                ...extraFilters,
                weather: e.target.value === 'any' ? 'any' : Number(e.target.value),
              })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/60"
          >
            <option value="any">Dowolna</option>
            <option value="0">Brak pogody</option>
            <option value="1">Deszcz</option>
            <option value="2">Burza piaskowa</option>
            <option value="3">Śnieg</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:text-zinc-100">
          <input
            type="checkbox"
            checked={extraFilters.requireColliders}
            onChange={(e) =>
              onChangeExtraFilters({ ...extraFilters, requireColliders: e.target.checked })
            }
            className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
          />
          <CircleDot className="w-3.5 h-3.5 text-cyan-400" />
          Posiada Colidery
        </label>

        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:text-zinc-100">
          <input
            type="checkbox"
            checked={extraFilters.requireWaypoints}
            onChange={(e) =>
              onChangeExtraFilters({ ...extraFilters, requireWaypoints: e.target.checked })
            }
            className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
          />
          <Bot className="w-3.5 h-3.5 text-amber-400" />
          Posiada ścieżki Botów
        </label>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:text-zinc-100">
            <input
              type="checkbox"
              checked={extraFilters.requireCaseMismatch}
              onChange={(e) =>
                onChangeExtraFilters({ ...extraFilters, requireCaseMismatch: e.target.checked })
              }
              className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
            />
            <span className="text-[11px] text-orange-300">Różna wielkość liter (Linux)</span>
          </label>
          {onOpenCaseTools && (
            <button
              type="button"
              onClick={onOpenCaseTools}
              title="Pokaż pliki z inną wielkością liter niż w mapach i popraw ich nazwy"
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-orange-200 cursor-pointer"
            >
              Napraw…
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
