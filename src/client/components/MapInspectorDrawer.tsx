import React, { useEffect, useMemo, useState } from 'react';
import { AssetStatus, MapIndexEntry, MapUserDataPatch, ResolvedAssetInfo } from '@shared/apiTypes';
import {
  POLY_TYPES,
  SPAWN_TYPES,
  STEPS_NAMES,
  WEATHER_NAMES,
} from '@shared/soldatConstants';
import { lang, polyTypeName, t, tr, tText } from '../i18n';
import { spawnTypeName } from '../renderer/OverlayRenderer';
import { formatBytes, openPathInExplorer } from '../utils/mapCache';
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  FileImage,
  FolderOpen,
  Info,
  Layers,
  PackagePlus,
  Pencil,
  Star,
  Tag,
  Wrench,
  X,
} from 'lucide-react';

// Weather / footstep names: shared code only has the Polish ones, so the English UI uses these
const WEATHER_NAMES_EN: Record<number, string> = {
  0: 'No weather',
  1: 'Rain',
  2: 'Sandstorm',
  3: 'Snow',
};
const STEPS_NAMES_EN: Record<number, string> = {
  0: 'Hard ground (metal/stone)',
  1: 'Soft ground (dirt/grass)',
  2: 'No footstep sounds',
};
const WEATHER_LABELS = lang === 'pl' ? WEATHER_NAMES : WEATHER_NAMES_EN;
const STEPS_LABELS = lang === 'pl' ? STEPS_NAMES : STEPS_NAMES_EN;

interface MapInspectorDrawerProps {
  map: MapIndexEntry | null;
  loadingDetails?: boolean;
  detailsError?: string | null;
  inPack: boolean;
  onTogglePack: () => void;
  onSelectMapById?: (mapId: string) => void;
  onOpenWorkshop?: (tab: 'fix' | 'optimize') => void;
  onEditMap?: () => void;
  onUpdateUserData: (mapId: string, patch: MapUserDataPatch) => void;
  knownTags: string[];
}

export const MapInspectorDrawer: React.FC<MapInspectorDrawerProps> = ({
  map,
  loadingDetails,
  detailsError,
  inPack,
  onTogglePack,
  onSelectMapById,
  onOpenWorkshop,
  onEditMap,
  onUpdateUserData,
  knownTags,
}) => {
  const [tab, setTab] = useState<'stats' | 'assets'>('stats');
  const [hideUnusedScenery, setHideUnusedScenery] = useState(true);
  const [tagInput, setTagInput] = useState('');
  useEffect(() => setTagInput(''), [map?.id]);

  const mapTags = map?.tags ?? [];
  const addTag = (raw: string) => {
    const tag = raw.replace(/[",]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!map || !tag) return;
    if (!mapTags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      onUpdateUserData(map.id, { addTags: [tag] });
    }
    setTagInput('');
  };

  const uniqueSceneryAssets = useMemo(() => {
    if (!map) return [];
    const byName = new Map<string, ResolvedAssetInfo>();
    for (const sc of map.sceneryAssets) {
      if (hideUnusedScenery && sc.usedCount === 0) continue;
      const key = sc.referencedName.toLowerCase();
      const prev = byName.get(key);
      if (prev) {
        byName.set(key, { ...prev, usedCount: prev.usedCount + sc.usedCount });
      } else {
        byName.set(key, sc);
      }
    }
    return Array.from(byName.values()).sort((a, b) => {
      if (a.status === 'missing' && b.status !== 'missing') return -1;
      if (b.status === 'missing' && a.status !== 'missing') return 1;
      if (!a.isVanilla && b.isVanilla) return -1;
      if (a.isVanilla && !b.isVanilla) return 1;
      return b.usedCount - a.usedCount;
    });
  }, [map, hideUnusedScenery]);

  if (!map) {
    return (
      <aside className="w-72 2xl:w-80 shrink-0 bg-zinc-900/90 border-l border-zinc-800/90 flex items-center justify-center p-6 text-center text-xs text-zinc-500">
        {detailsError ? (
          <span className="text-red-300">{t('Could not load map details: {error}', { error: detailsError })}</span>
        ) : loadingDetails ? (
          t('Loading map details...')
        ) : (
          t('Select a map from the list on the left to see its details and dependencies.')
        )}
      </aside>
    );
  }

  const spawnEntries = Object.entries(map.spawnTeamCounts)
    .map(([k, count]) => ({ meta: SPAWN_TYPES[Number(k)], team: Number(k), count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => a.team - b.team);

  const polyEntries = Object.entries(map.polyTypeCounts)
    .map(([k, count]) => ({ meta: POLY_TYPES[Number(k)], id: Number(k), count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <aside className="w-72 2xl:w-80 shrink-0 bg-zinc-900/90 border-l border-zinc-800/90 flex flex-col h-full select-none">
      {/* Map Header & Quick Pack Button */}
      <div className="p-3 border-b border-zinc-800/80 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-mono text-sm font-bold text-zinc-100 truncate">
                {map.baseName}
              </h2>
              <button
                type="button"
                onClick={() => onUpdateUserData(map.id, { favorite: !map.favorite })}
                title={map.favorite ? t('Remove from favorites') : t('Add to favorites')}
                aria-label={map.favorite ? t('Remove from favorites') : t('Add to favorites')}
                aria-pressed={Boolean(map.favorite)}
                className={`p-1 rounded hover:bg-zinc-800 shrink-0 cursor-pointer ${
                  map.favorite ? 'text-yellow-400' : 'text-zinc-500 hover:text-yellow-300'
                }`}
              >
                <Star className="w-3.5 h-3.5" fill={map.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() => openPathInExplorer(map.fullPath)}
                title={t('Show in folder: {path}', { path: map.fullPath })}
                aria-label={t('Show the map file in its folder')}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 shrink-0 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 truncate">
              {map.title || t('No description in the PMS header')}
            </p>
            <div className="flex items-center gap-1.5 mt-1 text-[10px]">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: map.badgeColor }}
              />
              <span className="text-zinc-300 font-medium truncate">{tText(map.modeGroupName)}</span>
              <span className="text-zinc-600">•</span>
              <span className="font-mono text-zinc-400">
                {map.prefix === '__none__' ? t('without prefix') : map.prefix}
              </span>
            </div>
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 border ${
              map.isVanillaMap
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            }`}
          >
            {map.isVanillaMap ? 'Vanilla' : 'Custom'}
          </span>
        </div>

        <button
          type="button"
          onClick={onTogglePack}
          className={`w-full py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            inPack
              ? 'bg-violet-600 hover:bg-violet-500 text-white'
              : 'bg-zinc-800 hover:bg-violet-600/80 text-zinc-200 hover:text-white border border-zinc-700'
          }`}
        >
          {inPack ? (
            <>
              <Check className="w-4 h-4" /> {t('In the pack (remove)')}
            </>
          ) : (
            <>
              <PackagePlus className="w-4 h-4" /> {t('Add map to pack')}
            </>
          )}
        </button>

        {/* User tags (stored in data/user-data.json, searchable with tag:name) */}
        <div className="flex flex-wrap items-center gap-1">
          <Tag className="w-3 h-3 text-zinc-500 shrink-0" />
          {mapTags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/70 text-[10px] text-zinc-200"
            >
              #{tag}
              <button
                type="button"
                onClick={() => onUpdateUserData(map.id, { removeTags: [tag] })}
                aria-label={t('Remove tag {tag}', { tag })}
                className="text-zinc-500 hover:text-red-300 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            list="sms-known-tags"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            onBlur={() => tagInput.trim() && addTag(tagInput)}
            placeholder={mapTags.length ? '+ tag' : t('Add tag (Enter)…')}
            aria-label={t('Add a tag to the map')}
            className="flex-1 min-w-16 bg-transparent border-b border-zinc-800 focus:border-emerald-500/60 px-1 py-0.5 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <datalist id="sms-known-tags">
            {knownTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>

        {onEditMap && (
          <button
            type="button"
            onClick={onEditMap}
            title={t('Open this map in the interactive Map Editor')}
            className="w-full py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 bg-cyan-600/20 hover:bg-cyan-600/35 text-cyan-100 border border-cyan-500/40 transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>{t('Edit map')}</span>
          </button>
        )}

        {onOpenWorkshop && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onOpenWorkshop('fix')}
              title={t('Fix stretched / enlarged sceneries after moving to Soldat 1.7.1 (saves an _f.pms version)')}
              className="py-1.5 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 bg-amber-600/15 hover:bg-amber-600/30 text-amber-200 border border-amber-500/35 transition-colors cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{t('Fix 1.7.1 (_f)')}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenWorkshop('optimize')}
              title={t(
                'Merge overlapping sceneries on the Back/Mid/Front layers into clean PNG sheets without flicker (saves an _o.pms version)'
              )}
              className="py-1.5 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 bg-teal-600/15 hover:bg-teal-600/30 text-teal-200 border border-teal-500/35 transition-colors cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>Optimize Scen. (_o)</span>
            </button>
          </div>
        )}

        {map.missingAssetsCount > 0 && (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-md px-2.5 py-1.5 text-[11px] text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              {tr(
                map.missingAssetsCount === 1
                  ? '{count} image file is missing on disk!'
                  : '{count} image files are missing on disk!',
                { count: <strong>{map.missingAssetsCount}</strong> }
              )}
            </span>
          </div>
        )}

        {(map.limitViolations?.length > 0 || map.parseWarnings?.length > 0) && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-md p-2 text-[11px] text-red-200 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <Ban className="w-3.5 h-3.5 text-red-400 shrink-0" />
              {map.limitViolations?.length > 0
                ? t("Soldat won't load this map — engine limits exceeded:")
                : t('Damaged PMS file:')}
            </div>
            {map.limitViolations?.map((v) => (
              <div key={v.key} className="font-mono text-[10px]">
                •{' '}
                {t('{label}: {value} (game limit: {limit})', {
                  label: tText(v.label),
                  value: v.value,
                  limit: v.limit,
                })}
                {v.key === 'maxProps' && ` — ${t('Optimize Scen. (_o) will help')}`}
              </div>
            ))}
            {map.parseWarnings?.map((w, i) => (
              <div key={i} className="font-mono text-[10px] text-amber-200">
                • {tText(w)}
              </div>
            ))}
          </div>
        )}

        {map.duplicateMapIds && map.duplicateMapIds.length > 0 && (
          <div className="bg-orange-500/10 border border-orange-500/35 rounded-md p-2 text-[11px] text-orange-200 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <Copy className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              {t('Identical CRC32 duplicates ({count}):', { count: map.duplicateMapIds.length })}
            </div>
            <div className="flex flex-wrap gap-1">
              {map.duplicateMapIds.map((dupId) => (
                <button
                  key={dupId}
                  type="button"
                  onClick={() => onSelectMapById?.(dupId)}
                  className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-orange-500/30 font-mono text-[10px] text-orange-200 cursor-pointer truncate max-w-full"
                >
                  {dupId}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 border-b border-zinc-800/80 text-xs font-medium">
        <button
          onClick={() => setTab('stats')}
          className={`py-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            tab === 'stats'
              ? 'border-emerald-500 text-emerald-300 bg-emerald-500/5'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          {t('Parameters')}
        </button>
        <button
          onClick={() => setTab('assets')}
          className={`py-2 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            tab === 'assets'
              ? 'border-emerald-500 text-emerald-300 bg-emerald-500/5'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FileImage className="w-3.5 h-3.5" />
          {t('Files ({count})', { count: 1 + uniqueSceneryAssets.length })}
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {tab === 'stats' ? (
          <>
            {/* Dimensions & Core */}
            <div className="space-y-1.5">
              <SectionTitle title={t('Geometry & environment')} />
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-2.5 space-y-1.5">
                <StatRow label={t('Source')} value={tText(map.sourceLabel)} />
                <StatRow
                  label={t('Polygon size')}
                  value={`${Math.round(map.polyBounds.width)} × ${Math.round(map.polyBounds.height)} px`}
                  mono
                />
                <StatRow
                  label={t('Full frame (with scen.)')}
                  value={`${Math.round(map.fullBounds.width)} × ${Math.round(map.fullBounds.height)} px`}
                  mono
                />
                <StatRow label={t('.pms size')} value={formatBytes(map.fileSize)} mono />
                <StatRow
                  label="CRC32 (OpenSoldat)"
                  value={`0x${(map.crc32 >>> 0).toString(16).toUpperCase()}`}
                  mono
                />
                <StatRow
                  label={t('Weather')}
                  value={WEATHER_LABELS[map.weather] || t('Type {n}', { n: map.weather })}
                />
                <StatRow
                  label={t('Ground (footsteps)')}
                  value={STEPS_LABELS[map.steps] || t('Type {n}', { n: map.steps })}
                />
                <StatRow
                  label={t('Jet fuel')}
                  value={map.startJet > 0 ? `${map.startJetGame} (${map.startJet})` : t('None (0)')}
                  mono
                />
                <StatRow
                  label={t('Packs: grenades / medikits')}
                  value={`${map.grenadePacks} / ${map.medikits}`}
                  mono
                />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-zinc-400">{t('Background colors:')}</span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-5 h-4 rounded border border-zinc-700"
                      title={t('Top: RGB({r}, {g}, {b})', {
                        r: map.bgColorTop.r,
                        g: map.bgColorTop.g,
                        b: map.bgColorTop.b,
                      })}
                      style={{
                        backgroundColor: `rgb(${map.bgColorTop.r}, ${map.bgColorTop.g}, ${map.bgColorTop.b})`,
                      }}
                    />
                    <span className="text-zinc-600">→</span>
                    <span
                      className="w-5 h-4 rounded border border-zinc-700"
                      title={t('Bottom: RGB({r}, {g}, {b})', {
                        r: map.bgColorBtm.r,
                        g: map.bgColorBtm.g,
                        b: map.bgColorBtm.b,
                      })}
                      style={{
                        backgroundColor: `rgb(${map.bgColorBtm.r}, ${map.bgColorBtm.g}, ${map.bgColorBtm.b})`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Object / Layer Counts */}
            <div className="space-y-1.5">
              <SectionTitle title={t('Layer structure')} />
              <div className="grid grid-cols-2 gap-1.5">
                <MiniCounter label={t('Polygons')} value={map.polygonCount} />
                <MiniCounter label={t('Active sceneries')} value={map.activePropCount} />
                <MiniCounter label={t('Colliders')} value={map.activeColliderCount} />
                <MiniCounter label={t('Bot waypoints')} value={map.activeWaypointCount} />
              </div>
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-2 text-[11px] flex items-center justify-between text-zinc-400">
                <span>{t('Back:')} <strong className="text-zinc-200 font-mono">{map.propLevelCounts[0]}</strong></span>
                <span>{t('Middle:')} <strong className="text-zinc-200 font-mono">{map.propLevelCounts[1]}</strong></span>
                <span>{t('Front:')} <strong className="text-zinc-200 font-mono">{map.propLevelCounts[2]}</strong></span>
              </div>
            </div>

            {/* Spawns, Flags & Bonuses */}
            <div className="space-y-1.5">
              <SectionTitle title={t('Spawn points, flags & bonuses ({count})', { count: map.activeSpawnCount })} />
              {spawnEntries.length === 0 ? (
                <div className="text-zinc-500 text-[11px]">{t('No spawn points on the map.')}</div>
              ) : (
                <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg divide-y divide-zinc-800/60">
                  {spawnEntries.map(({ meta, team, count }) => (
                    <div key={team} className="px-2.5 py-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-2 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: meta?.color || '#94a3b8' }}
                        />
                        <span className="text-zinc-200 truncate">
                          {meta ? spawnTypeName(meta) : t('Type {n}', { n: team })}
                        </span>
                      </span>
                      <span className="font-mono text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-[11px]">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Polygon Types Breakdown */}
            <div className="space-y-1.5">
              <SectionTitle title={t('Polygon types')} />
              <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg divide-y divide-zinc-800/60">
                {polyEntries.map(({ meta, id, count }) => (
                  <div key={id} className="px-2.5 py-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: meta?.color || '#64748b' }}
                      />
                      <span className="text-zinc-300 truncate">
                        {meta ? polyTypeName(meta) : t('Type #{n}', { n: id })}
                      </span>
                    </span>
                    <span className="font-mono text-zinc-400 text-[11px]">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* Assets / Dependencies Auditor Tab */
          <div className="space-y-3">
            <div>
              <SectionTitle title={t('Main texture')} />
              <div className="mt-1 space-y-1">
                <AssetRowCard asset={map.textureInfo} />
                {map.textureInfo.edgeDiskName && (
                  <div className="text-[10px] font-mono text-emerald-300/80 px-2">
                    {t('+ edges: textures/edges/{name}', { name: map.textureInfo.edgeDiskName })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <SectionTitle title={t('Sceneries ({count})', { count: uniqueSceneryAssets.length })} />
                {map.unusedSceneryCount > 0 && (
                  <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideUnusedScenery}
                      onChange={(e) => setHideUnusedScenery(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900"
                    />
                    {t('Hide unused ({count})', { count: map.unusedSceneryCount })}
                  </label>
                )}
              </div>

              {uniqueSceneryAssets.length === 0 ? (
                <div className="text-zinc-500 text-[11px]">{t('The map uses no sceneries.')}</div>
              ) : (
                <div className="space-y-1.5">
                  {uniqueSceneryAssets.map((sc) => (
                    <AssetRowCard key={sc.referencedName} asset={sc} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

const AssetRowCard: React.FC<{ asset: ResolvedAssetInfo }> = ({ asset }) => {
  // Sceneries are shown with the in-game #00FF00 color key applied (transparent instead of a green box)
  const previewUrl =
    asset.status !== 'missing' && asset.referencedName
      ? `/api/assets?category=${encodeURIComponent(asset.category)}&name=${encodeURIComponent(
          asset.referencedName
        )}&convert=png${asset.category === 'scenery-gfx' ? '&colorkey=1' : ''}`
      : null;

  const badge = getStatusBadge(asset.status);

  return (
    <div className="bg-zinc-950/75 border border-zinc-800/80 rounded-lg p-2 flex items-center gap-2.5">
      <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={asset.referencedName}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
          />
        ) : (
          <AlertTriangle className="w-4 h-4 text-red-400" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] font-medium text-zinc-100 truncate" title={asset.referencedName}>
          {asset.referencedName || t('(default)')}
        </div>
        {asset.diskName && asset.diskName !== asset.referencedName && (
          <div
            className="text-[10px] font-mono text-zinc-400 truncate"
            title={t('File on disk: {name}', { name: asset.diskName })}
          >
            → {asset.diskName}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${badge.cls}`}>
            {badge.label}
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {asset.usedCount > 0 ? `×${asset.usedCount}` : t('0 (unused)')}{' '}
            {asset.fileSize > 0 ? `• ${formatBytes(asset.fileSize)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
};

function getStatusBadge(status: AssetStatus): { label: string; cls: string } {
  switch (status) {
    case 'vanilla':
      return {
        label: t('Vanilla (Soldat)'),
        cls: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
      };
    case 'custom':
      return {
        label: t('Custom (for the pack)'),
        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    case 'png-override':
      return {
        label: t('Custom (.PNG HD)'),
        cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
      };
    case 'case-mismatch':
      return {
        label: t('Letter case (Linux)'),
        cls: 'bg-orange-500/15 text-orange-300 border-orange-500/35',
      };
    case 'missing':
      return {
        label: t('MISSING FILE!'),
        cls: 'bg-red-500/20 text-red-300 border-red-500/40',
      };
  }
}

const SectionTitle: React.FC<{ title: string }> = ({ title }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
    {title}
  </div>
);

const StatRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-zinc-400">{label}:</span>
    <span className={`text-zinc-200 truncate ${mono ? 'font-mono text-[11px]' : ''}`}>
      {value}
    </span>
  </div>
);

const MiniCounter: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
    <span className="text-zinc-400 text-[11px]">{label}</span>
    <span className="font-mono font-bold text-zinc-100 text-xs">{value}</span>
  </div>
);
