import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapCompactEntry, MapSortField } from '@shared/apiTypes';
import { describeSearchTerm, parseSearchQuery } from '@shared/searchQuery';
import { formatBytes } from '../utils/mapCache';
import { useMapThumbnail } from '../utils/useMapThumbnail';
import { locale, t, tText } from '../i18n';
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  Copy,
  LayoutGrid,
  List,
  HelpCircle,
  PackagePlus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';

export type { MapSortField };

const LIST_ROW_HEIGHT = 46;
const GRID_ROW_HEIGHT = 154;

interface MapBrowserPanelProps {
  totalFiltered: number;
  queryDurationMs: number;
  getItemAt: (index: number) => MapCompactEntry | undefined;
  onEnsureRange: (startIndex: number, endIndex: number) => void;
  activeMapId: string | null;
  activeIndex: number;
  onSelectMapAt: (index: number, map: MapCompactEntry) => void;
  packMapIds: Set<string>;
  onToggleMapInPack: (mapId: string) => void;
  onRangeAddMapsToPack: (startIndex: number, endIndex: number) => void;
  onAddAllFilteredToPack: () => void;
  onRemoveFilteredFromPack: () => void;
  onOpenBatchScreenshot: () => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  sortField: MapSortField;
  onChangeSortField: (f: MapSortField) => void;
  viewMode: 'list' | 'grid';
  onChangeViewMode: (m: 'list' | 'grid') => void;
  resetScrollToken: number;
  listError?: string | null;
  onRetryList?: () => void;
  onToggleFavorite: (mapId: string, favorite: boolean) => void;
}

const SEARCH_EXAMPLES: Array<[string, string]> = [
  ['props>300', t('more than 300 sceneries (also polys, colliders, spawns, w, h, kb)')],
  ['tex:ananas', t('texture contains “ananas” (scen:, title:, name:, src:, mode:, crc:)')],
  ['prefix:ctf_cs_', t('name starts with ctf_cs_')],
  ['is:fav', t('favorites (is:broken, is:dup, is:vanilla, is:custom, is:bad)')],
  ['tag:turniej', t('maps with your tag')],
  ['pogoda:snieg', t('weather: none, rain, sand, snow')],
  ['-is:dup', t('minus before a filter = exclude')],
];

const FavoriteStar: React.FC<{
  favorite: boolean;
  onToggle: () => void;
  className?: string;
}> = ({ favorite, onToggle, className = '' }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    title={favorite ? t('Remove from favorites') : t('Add to favorites')}
    aria-label={favorite ? t('Remove from favorites') : t('Add to favorites')}
    aria-pressed={favorite}
    className={`shrink-0 cursor-pointer transition-opacity ${
      favorite ? 'text-yellow-400' : 'text-zinc-500 hover:text-yellow-300 opacity-0 group-hover:opacity-100'
    } ${className}`}
  >
    <Star className="w-3.5 h-3.5" fill={favorite ? 'currentColor' : 'none'} />
  </button>
);

const MapGridCard: React.FC<{
  map: MapCompactEntry;
  index: number;
  isActive: boolean;
  inPack: boolean;
  onSelect: (index: number, map: MapCompactEntry) => void;
  onTogglePack: (index: number, mapId: string, shiftKey: boolean) => void;
  onToggleFavorite: (mapId: string, favorite: boolean) => void;
}> = React.memo(({ map, index, isActive, inPack, onSelect, onTogglePack, onToggleFavorite }) => {
  const { url: thumbUrl, failed: thumbFailed } = useMapThumbnail(map.id, map.crc32, map.hasThumbnail, true);

  return (
    <div
      onClick={() => onSelect(index, map)}
      className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-colors h-[146px] flex flex-col ${
        isActive
          ? 'border-emerald-500 ring-1 ring-emerald-500/50 bg-zinc-800/90'
          : 'border-zinc-800/90 bg-zinc-900/70 hover:border-zinc-700 hover:bg-zinc-800/60'
      }`}
    >
      {/* Thumbnail preview */}
      <div
        className="h-24 w-full relative overflow-hidden flex items-center justify-center shrink-0"
        style={{
          background: `linear-gradient(180deg, rgb(${map.bgColorTop.r},${map.bgColorTop.g},${map.bgColorTop.b}) 0%, rgb(${map.bgColorBtm.r},${map.bgColorBtm.g},${map.bgColorBtm.b}) 100%)`,
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={map.baseName}
            className="w-full h-full object-cover"
            decoding="async"
          />
        ) : (
          <span className="text-[10px] font-mono text-white/60 bg-black/40 px-2 py-0.5 rounded">
            {thumbFailed ? t('No preview') : t('GPU rendering...')}
          </span>
        )}

        <FavoriteStar
          favorite={Boolean(map.favorite)}
          onToggle={() => onToggleFavorite(map.id, !map.favorite)}
          className="absolute top-2 right-9 drop-shadow"
        />

        {/* Pack toggle badge */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePack(index, map.id, e.shiftKey);
          }}
          title={inPack ? t('Remove from pack (Shift+click = range)') : t('Add to pack (Shift+click = range)')}
          className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center transition-all cursor-pointer ${
            inPack
              ? 'bg-violet-600 text-white shadow-md'
              : 'bg-zinc-950/75 text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-violet-600 hover:text-white'
          }`}
        >
          {inPack ? <Check className="w-3.5 h-3.5" /> : <PackagePlus className="w-3.5 h-3.5" />}
        </button>

        {map.missingAssetsCount > 0 && (
          <span
            title={t('Missing graphics files: {n}', { n: map.missingAssetsCount })}
            className="absolute top-1.5 left-1.5 bg-amber-500/90 text-zinc-950 px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-0.5"
          >
            <AlertTriangle className="w-3 h-3" />
            {map.missingAssetsCount}
          </span>
        )}

        <span className="absolute bottom-1 right-1.5 bg-black/70 text-zinc-200 font-mono text-[9px] px-1.5 py-0.5 rounded">
          {Math.round(map.polyWidth)}×{Math.round(map.polyHeight)}
        </span>
      </div>

      {/* Info footer */}
      <div className="px-2 py-1.5 flex-1 flex flex-col justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: map.badgeColor }}
          />
          <span className="font-mono text-xs font-medium text-zinc-100 truncate">
            {map.baseName}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>
            {map.isVanillaMap ? (
              <span className="text-sky-400">Vanilla</span>
            ) : (
              <span className="text-emerald-400">Custom ({map.customAssetsCount})</span>
            )}
          </span>
          <span className="font-mono">{map.polygonCount} poly</span>
        </div>
      </div>
    </div>
  );
});

export const MapBrowserPanel: React.FC<MapBrowserPanelProps> = ({
  totalFiltered,
  queryDurationMs,
  getItemAt,
  onEnsureRange,
  activeMapId,
  activeIndex,
  onSelectMapAt,
  packMapIds,
  onToggleMapInPack,
  onRangeAddMapsToPack,
  onAddAllFilteredToPack,
  onRemoveFilteredFromPack,
  onOpenBatchScreenshot,
  searchQuery,
  onChangeSearchQuery,
  sortField,
  onChangeSortField,
  viewMode,
  onChangeViewMode,
  resetScrollToken,
  listError,
  onRetryList,
  onToggleFavorite,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(700);
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  const parsedSearch = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);
  const lastPackClickIdxRef = useRef<number | null>(null);

  // Measure virtual scroll viewport height
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setViewportH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll to top (and the Shift+click range anchor, whose row index is no longer valid)
  // when filters/search/sort change
  useEffect(() => {
    lastPackClickIdxRef.current = null;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [resetScrollToken]);

  // Calculate visible virtual slice
  const itemsPerRow = viewMode === 'grid' ? 2 : 1;
  const rowHeight = viewMode === 'grid' ? GRID_ROW_HEIGHT : LIST_ROW_HEIGHT;
  const totalRows = Math.ceil(totalFiltered / itemsPerRow);
  const totalHeightPx = totalRows * rowHeight;

  const overscanRows = viewMode === 'grid' ? 5 : 10;
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const endRow = Math.min(
    Math.max(0, totalRows - 1),
    Math.ceil((scrollTop + viewportH) / rowHeight) + overscanRows
  );

  const startItemIdx = startRow * itemsPerRow;
  const endItemIdx = Math.min(Math.max(0, totalFiltered - 1), (endRow + 1) * itemsPerRow - 1);

  // Ensure paged slices covering visible rows are loaded
  useEffect(() => {
    if (totalFiltered > 0 && endItemIdx >= startItemIdx) {
      onEnsureRange(startItemIdx, endItemIdx);
    }
  }, [totalFiltered, startItemIdx, endItemIdx, onEnsureRange]);

  const scrollIndexIntoView = useCallback(
    (itemIdx: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const targetRow = Math.floor(itemIdx / itemsPerRow);
      const rowTop = targetRow * rowHeight;
      const rowBottom = rowTop + rowHeight;
      if (rowTop < el.scrollTop) {
        el.scrollTop = rowTop;
      } else if (rowBottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = rowBottom - el.clientHeight;
      }
    },
    [itemsPerRow, rowHeight]
  );

  // Keyboard navigation: Up / Down / PageUp / PageDown / Space (toggle pack)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      // Keys typed into fields or used to activate a focused control are not list shortcuts
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) {
        return;
      }
      if (totalFiltered === 0) return;

      if (e.key === ' ' && activeMapId) {
        e.preventDefault();
        onToggleMapInPack(activeMapId);
        return;
      }

      if (
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'PageDown' &&
        e.key !== 'PageUp'
      ) {
        return;
      }

      e.preventDefault();
      const curIdx = activeIndex >= 0 ? activeIndex : 0;
      const step =
        e.key === 'PageDown'
          ? 15 * itemsPerRow
          : e.key === 'PageUp'
          ? -15 * itemsPerRow
          : e.key === 'ArrowDown'
          ? 1
          : -1;

      const nextIdx = Math.max(0, Math.min(totalFiltered - 1, curIdx + step));
      scrollIndexIntoView(nextIdx);
      onEnsureRange(Math.max(0, nextIdx - 5), Math.min(totalFiltered - 1, nextIdx + 20));
      const entry = getItemAt(nextIdx);
      if (entry) {
        onSelectMapAt(nextIdx, entry);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    totalFiltered,
    activeIndex,
    activeMapId,
    itemsPerRow,
    getItemAt,
    onEnsureRange,
    onSelectMapAt,
    onToggleMapInPack,
    scrollIndexIntoView,
  ]);

  // Stable identity so memoized grid cards do not all re-render on every scroll event
  const handlePackCheckboxClick = useCallback(
    (idx: number, mapId: string, shiftKey: boolean) => {
      if (shiftKey && lastPackClickIdxRef.current !== null && lastPackClickIdxRef.current !== idx) {
        const a = Math.min(lastPackClickIdxRef.current, idx);
        const b = Math.max(lastPackClickIdxRef.current, idx);
        onRangeAddMapsToPack(a, b);
      } else {
        onToggleMapInPack(mapId);
      }
      lastPackClickIdxRef.current = idx;
    },
    [onRangeAddMapsToPack, onToggleMapInPack]
  );

  const renderedRows: React.ReactNode[] = [];
  if (totalFiltered > 0) {
    for (let r = startRow; r <= endRow; r++) {
      const topPx = r * rowHeight;

      if (viewMode === 'grid') {
        const idx0 = r * 2;
        const idx1 = idx0 + 1;
        const m0 = getItemAt(idx0);
        const m1 = idx1 < totalFiltered ? getItemAt(idx1) : undefined;

        renderedRows.push(
          <div
            key={r}
            style={{ position: 'absolute', top: topPx, left: 0, right: 0, height: rowHeight }}
            className="grid grid-cols-2 gap-2 px-2"
          >
            {m0 ? (
              <MapGridCard
                map={m0}
                index={idx0}
                isActive={m0.id === activeMapId}
                inPack={packMapIds.has(m0.id)}
                onSelect={onSelectMapAt}
                onTogglePack={handlePackCheckboxClick}
                onToggleFavorite={onToggleFavorite}
              />
            ) : (
              <div className="h-[146px] rounded-lg bg-zinc-900/40 border border-zinc-800/50 animate-pulse" />
            )}

            {idx1 < totalFiltered ? (
              m1 ? (
                <MapGridCard
                  map={m1}
                  index={idx1}
                  isActive={m1.id === activeMapId}
                  inPack={packMapIds.has(m1.id)}
                  onSelect={onSelectMapAt}
                  onTogglePack={handlePackCheckboxClick}
                  onToggleFavorite={onToggleFavorite}
                />
              ) : (
                <div className="h-[146px] rounded-lg bg-zinc-900/40 border border-zinc-800/50 animate-pulse" />
              )
            ) : null}
          </div>
        );
      } else {
        const idx = r;
        const m = getItemAt(idx);
        renderedRows.push(
          <div
            key={r}
            style={{ position: 'absolute', top: topPx, left: 0, right: 0, height: rowHeight }}
            className="px-2"
          >
            {m ? (
              <div
                onClick={() => onSelectMapAt(idx, m)}
                className={`group h-[42px] flex items-center justify-between px-2 rounded-md cursor-pointer transition-colors ${
                  m.id === activeMapId
                    ? 'bg-emerald-500/15 border border-emerald-500/45 text-emerald-100'
                    : 'hover:bg-zinc-800/70 border border-transparent text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Pack Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePackCheckboxClick(idx, m.id, e.shiftKey);
                    }}
                    title={
                      packMapIds.has(m.id)
                        ? t('Remove from pack (Shift+click = range)')
                        : t('Add to pack (Shift+click = range)')
                    }
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors cursor-pointer ${
                      packMapIds.has(m.id)
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'border-zinc-700 bg-zinc-950/60 text-transparent group-hover:border-zinc-500'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                  </button>

                  {/* Mode Color dot */}
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    title={tText(m.modeGroupName)}
                    style={{ backgroundColor: m.badgeColor }}
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium truncate">
                        {m.baseName}
                      </span>
                      <FavoriteStar favorite={Boolean(m.favorite)} onToggle={() => onToggleFavorite(m.id, !m.favorite)} />
                      {m.missingAssetsCount > 0 && (
                        <span title={t('Missing assets: {n}', { n: m.missingAssetsCount })}>
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        </span>
                      )}
                      {m.duplicateCount > 1 && (
                        <span
                          title={t('Found {n} maps with an identical CRC32 checksum', { n: m.duplicateCount })}
                          className="text-orange-400 shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                        </span>
                      )}
                      {(m.limitViolationCount > 0 || m.parseWarningCount > 0) && (
                        <span
                          title={
                            m.limitViolationCount > 0
                              ? t("The map exceeds Soldat engine limits (e.g. > 500 sceneries) and won't load in game")
                              : t('The PMS file is partially damaged')
                          }
                          className="text-red-400 shrink-0"
                        >
                          <Ban className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
                      <span>
                        {Math.round(m.polyWidth)}×{Math.round(m.polyHeight)}
                      </span>
                      <span>•</span>
                      <span>{m.polygonCount}p</span>
                      <span>•</span>
                      <span>{formatBytes(m.fileSize)}</span>
                    </div>
                  </div>
                </div>

                {/* Right badge */}
                <div className="shrink-0 ml-1">
                  {m.isVanillaMap ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25">
                      Std
                    </span>
                  ) : m.customAssetsCount > 0 ? (
                    <span
                      title={t('Custom files to pack: {n}', { n: m.customAssetsCount })}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                    >
                      +{m.customAssetsCount}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="h-[42px] rounded-md bg-zinc-900/35 animate-pulse" />
            )}
          </div>
        );
      }
    }
  }

  return (
    <section className="w-72 2xl:w-84 shrink-0 bg-zinc-900/60 border-r border-zinc-800/90 flex flex-col h-full select-none">
      {/* Search & Controls */}
      <div className="p-3 border-b border-zinc-800/80 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onChangeSearchQuery(e.target.value)}
            placeholder={t('Search (e.g. ctf_cs props>300 tex:ananas)')}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8.5 pr-12 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/70"
          />
          <button
            type="button"
            onClick={() => setShowSearchHelp((v) => !v)}
            aria-label={t('Search syntax')}
            aria-expanded={showSearchHelp}
            title={t('Search syntax (filters props>300, tex:, is:fav…)')}
            className={`absolute right-7 top-1/2 -translate-y-1/2 cursor-pointer ${
              showSearchHelp ? 'text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          {searchQuery && (
            <button
              onClick={() => onChangeSearchQuery('')}
              aria-label={t('Clear search')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {parsedSearch.structured && (
          <div className="flex flex-wrap gap-1" aria-label={t('Recognized search filters')}>
            {parsedSearch.terms.map((term, i) => (
              <span
                key={i}
                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                  term.kind === 'text'
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                }`}
              >
                {describeSearchTerm(term, t)}
              </span>
            ))}
          </div>
        )}

        {showSearchHelp && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-2 space-y-1 text-[10px] text-zinc-400">
            <div className="text-zinc-300 font-semibold">{t('Filters (click to add):')}</div>
            {SEARCH_EXAMPLES.map(([example, hint]) => (
              <button
                key={example}
                type="button"
                onClick={() => onChangeSearchQuery(`${searchQuery.trim()} ${example}`.trim())}
                className="w-full text-left flex gap-2 hover:bg-zinc-900 rounded px-1 py-0.5 cursor-pointer"
              >
                <code className="text-emerald-300 shrink-0">{example}</code>
                <span className="truncate">{hint}</span>
              </button>
            ))}
            <div>{t('Words without a colon search the name, title, texture and scenery names.')}</div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500 text-[11px]">{t('Sort:')}</span>
            <select
              value={sortField}
              onChange={(e) => onChangeSortField(e.target.value as MapSortField)}
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/60"
            >
              <option value="name">{t('Name (A–Z)')}</option>
              <option value="polys">{t('Polygons (descending)')}</option>
              <option value="props">{t('Sceneries (descending)')}</option>
              <option value="width">{t('Width (descending)')}</option>
              <option value="height">{t('Height (descending)')}</option>
              <option value="size">{t('File size')}</option>
              <option value="mtime">{t('Recently modified')}</option>
            </select>
          </div>

          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
            <button
              onClick={() => onChangeViewMode('list')}
              title={t('Virtual list view (60 FPS for 50k+ maps)')}
              className={`p-1 rounded cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-zinc-800 text-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onChangeViewMode('grid')}
              title={t('Virtual grid with GPU thumbnails')}
              className={`p-1 rounded cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-zinc-800 text-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bulk Actions */}
        <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[11px]">
          <span className="text-zinc-400" title={t('Index query time: {ms} ms', { ms: queryDurationMs })}>
            {t('Results:')}{' '}
            <strong className="text-zinc-200 font-mono">
              {totalFiltered.toLocaleString(locale)}
            </strong>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onAddAllFilteredToPack}
              disabled={totalFiltered === 0}
              title={t('Add all currently filtered maps to the pack')}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/15 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <PackagePlus className="w-3 h-3" />
              {t('+All')}
            </button>
            <button
              onClick={onRemoveFilteredFromPack}
              disabled={packMapIds.size === 0}
              title={t('Remove the filtered maps from the pack')}
              className="p-1 rounded bg-zinc-800/80 hover:bg-red-500/20 text-zinc-400 hover:text-red-300 disabled:opacity-30 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              onClick={onOpenBatchScreenshot}
              disabled={totalFiltered === 0 && packMapIds.size === 0}
              title={t('Generate 100% screenshots in bulk (Batch)')}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Camera className="w-3 h-3" />
              Batch
            </button>
          </div>
        </div>
      </div>

      {/* Virtualized Results Container */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto py-2 relative"
      >
        {listError ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2 text-center px-4 text-red-300 text-xs">
            <span>{t('Could not load the map list: {error}', { error: listError })}</span>
            {onRetryList && (
              <button
                type="button"
                onClick={onRetryList}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 cursor-pointer"
              >
                {t('Try again')}
              </button>
            )}
          </div>
        ) : totalFiltered === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center px-4 text-zinc-500 text-xs">
            {t('No maps match the selected filters.')}
          </div>
        ) : (
          <div style={{ height: totalHeightPx, position: 'relative', width: '100%' }}>
            {renderedRows}
          </div>
        )}
      </div>
    </section>
  );
};
