import React, { useEffect, useMemo, useState } from 'react';
import {
  IndexMetaResponse,
  PackBuildOptions,
  PackPreset,
  PackPreviewResponse,
} from '@shared/apiTypes';
import { locale, t, tp, tr } from '../i18n';
import {
  formatBytes,
  openPathInExplorer,
  pickSystemFile,
  pickSystemFolder,
} from '../utils/mapCache';
import { useModalDismiss } from '../utils/useModalDismiss';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileSearch,
  FolderInput,
  FolderOpen,
  Layers,
  Package,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

interface PackBuilderModalProps {
  open: boolean;
  onClose: () => void;
  packMapIds: string[];
  getMapLabelById: (id: string) => string;
  onRemoveMapFromPack: (id: string) => void;
  onClearPack: () => void;
  onMetaUpdated?: (meta: IndexMetaResponse) => void;
}

interface InspectedArchive {
  archivePath: string;
  fileName: string;
  totalFiles: number;
  maps: Array<{ name: string; title: string; polygons: number; props: number; texture: string }>;
  files: Array<{ path: string; size: number }>;
}

const MAX_RENDERED_CART_ITEMS = 250;

export const PackBuilderModal: React.FC<PackBuilderModalProps> = ({
  open,
  onClose,
  packMapIds,
  getMapLabelById,
  onRemoveMapFromPack,
  onClearPack,
  onMetaUpdated,
}) => {
  const [modeTab, setModeTab] = useState<'build' | 'inspect'>('build');
  const [packName, setPackName] = useState('Soldat_MapPack');
  const [outputFormat, setOutputFormat] = useState<'zip' | 'smap' | 'folder'>('zip');
  const [splitBy, setSplitBy] = useState<'none' | 'mode' | 'prefix'>('none');
  const [excludeVanillaAssets, setExcludeVanillaAssets] = useState(true);
  const [excludeUnusedScenery, setExcludeUnusedScenery] = useState(true);
  const [includePngOverrides, setIncludePngOverrides] = useState(true);
  const [includeEdgeTextures, setIncludeEdgeTextures] = useState(true);
  const [fixLinuxCase, setFixLinuxCase] = useState(true);
  const [generateMapsListTxt, setGenerateMapsListTxt] = useState(true);
  const [generateReadmeManifest, setGenerateReadmeManifest] = useState(true);
  const [generateCrcManifest, setGenerateCrcManifest] = useState(true);

  // Saved option sets (data/pack-presets.json)
  const [presets, setPresets] = useState<PackPreset[]>([]);
  const [selectedPresetName, setSelectedPresetName] = useState('');
  const [newPresetName, setNewPresetName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [customOutputFolder, setCustomOutputFolder] = useState('');

  const [preview, setPreview] = useState<PackPreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [fileTreeFilter, setFileTreeFilter] = useState('');
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildResult, setBuildResult] = useState<{
    outputPath: string;
    fileName: string;
    sizeBytes: number;
    fileCount: number;
    splitArchiveCount?: number;
    downloadUrl: string | null;
    warnings?: string[];
  } | null>(null);

  // External Archive Inspector state
  const [archiveInputPath, setArchiveInputPath] = useState('');
  const [inspectedArchive, setInspectedArchive] = useState<InspectedArchive | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractResultPath, setExtractResultPath] = useState<string | null>(null);

  const options: PackBuildOptions = useMemo(
    () => ({
      packName,
      mapIds: packMapIds,
      outputFormat,
      splitBy: outputFormat === 'zip' ? splitBy : 'none',
      excludeVanillaAssets,
      excludeUnusedScenery,
      includePngOverrides,
      includeEdgeTextures,
      fixLinuxCase,
      generateMapsListTxt,
      generateReadmeManifest,
      generateCrcManifest,
      customOutputFolder: customOutputFolder || undefined,
    }),
    [
      packName,
      packMapIds,
      outputFormat,
      splitBy,
      excludeVanillaAssets,
      excludeUnusedScenery,
      includePngOverrides,
      includeEdgeTextures,
      fixLinuxCase,
      generateMapsListTxt,
      generateReadmeManifest,
      generateCrcManifest,
      customOutputFolder,
    ]
  );

  useEffect(() => {
    if (!open) return;
    fetch('/api/pack-presets')
      .then((r) => (r.ok ? r.json() : { presets: [] }))
      .then((d) => setPresets(Array.isArray(d.presets) ? d.presets : []))
      .catch(() => setPresets([]));
  }, [open]);

  const applyPreset = (name: string) => {
    setSelectedPresetName(name);
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    const o = preset.options;
    setPackName(o.packName);
    setOutputFormat(o.outputFormat);
    setSplitBy(o.splitBy === 'prefix' || o.splitBy === 'mode' ? o.splitBy : 'none');
    setExcludeVanillaAssets(o.excludeVanillaAssets);
    setExcludeUnusedScenery(o.excludeUnusedScenery);
    setIncludePngOverrides(o.includePngOverrides);
    setIncludeEdgeTextures(o.includeEdgeTextures);
    setFixLinuxCase(o.fixLinuxCase);
    setGenerateMapsListTxt(o.generateMapsListTxt);
    setGenerateReadmeManifest(o.generateReadmeManifest);
    setGenerateCrcManifest(o.generateCrcManifest !== false);
    setCustomOutputFolder(o.customOutputFolder ?? '');
    setPresetError(null);
  };

  const presetRequest = async (method: 'POST' | 'DELETE', name: string) => {
    setPresetError(null);
    try {
      const { mapIds: _mapIds, ...presetOptions } = options;
      const res = await fetch(
        method === 'POST' ? '/api/pack-presets' : `/api/pack-presets/${encodeURIComponent(name)}`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({ name, options: presetOptions }) : undefined,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPresets(data.presets ?? []);
      setSelectedPresetName(method === 'POST' ? name.trim() : '');
      if (method === 'POST') setNewPresetName('');
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : String(err));
    }
  };

  // Debounced live preview of pack contents (safe even for 20,000+ map packs)
  useEffect(() => {
    if (!open || modeTab !== 'build') return;
    if (packMapIds.length === 0) {
      setPreview(null);
      return;
    }

    const controller = new AbortController();
    setLoadingPreview(true);
    const timer = setTimeout(() => {
      fetch('/api/packs/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
        signal: controller.signal,
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok || data.error) {
            setBuildError(data.error || t('Pack preview error (HTTP {status}).', { status: r.status }));
            setPreview(null);
            return;
          }
          setPreview(data);
        })
        .catch(() => {})
        .finally(() => {
          // An aborted (superseded) request must not hide the spinner of the request that replaced it
          if (!controller.signal.aborted) setLoadingPreview(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, modeTab, options, packMapIds.length]);

  const backdropProps = useModalDismiss(open, onClose, building || extracting);

  if (!open) return null;

  const filteredPreviewFiles = (preview?.files || []).filter((f) =>
    f.archivePath.toLowerCase().includes(fileTreeFilter.trim().toLowerCase())
  );

  const visibleCartIds = packMapIds.slice(0, MAX_RENDERED_CART_ITEMS);
  const hiddenCartCount = Math.max(0, packMapIds.length - visibleCartIds.length);

  const handleBuildPack = async () => {
    setBuilding(true);
    setBuildError(null);
    setBuildResult(null);
    try {
      const res = await fetch('/api/packs/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('Failed to build the pack.'));
      }
      setBuildResult(data);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  const handleInspectArchive = async (targetPath: string) => {
    setInspectError(null);
    setExtractResultPath(null);
    try {
      const res = await fetch('/api/packs/inspect-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: targetPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Failed to read the archive.'));
      setInspectedArchive(data);
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExtractAndMount = async () => {
    if (!inspectedArchive) return;
    setExtracting(true);
    setInspectError(null);
    try {
      const res = await fetch('/api/packs/extract-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archivePath: inspectedArchive.archivePath,
          registerAsSource: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Failed to extract the archive.'));
      setExtractResultPath(data.outputPath);
      if (data.meta && onMetaUpdated) {
        onMetaUpdated(data.meta);
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-5xl h-[86vh] flex flex-col overflow-hidden">
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-400" />
              <h2 className="text-base font-bold text-zinc-100">
                {t('Soldat MPA Pro v2 — Map Pack Builder')}
              </h2>
            </div>

            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setModeTab('build')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  modeTab === 'build'
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('Build Pack ({count})', { count: packMapIds.length.toLocaleString(locale) })}
              </button>
              <button
                onClick={() => setModeTab('inspect')}
                className={`px-3 py-1 rounded-md font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                  modeTab === 'inspect'
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FileSearch className="w-3.5 h-3.5" />
                {t('Archive Inspector (.zip / .smap)')}
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label={t('Close the Pack Builder')}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {modeTab === 'build' ? (
          <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-zinc-800">
            {/* Left Settings & Selected Maps */}
            <div className="col-span-5 flex flex-col min-h-0 p-4 space-y-3.5 overflow-y-auto">
              {/* Presets */}
              <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400 shrink-0">{t('Preset:')}</span>
                  <select
                    value={selectedPresetName}
                    onChange={(e) => applyPreset(e.target.value)}
                    aria-label={t('Choose a saved preset of pack options')}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">{presets.length ? t('— choose saved options —') : t('— no saved presets —')}</option>
                    {presets.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedPresetName}
                    onClick={() => presetRequest('DELETE', selectedPresetName)}
                    title={t('Delete the selected preset')}
                    aria-label={t('Delete the selected preset')}
                    className="p-1.5 rounded bg-zinc-800 hover:bg-red-500/25 text-zinc-400 hover:text-red-300 disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPresetName.trim()) presetRequest('POST', newPresetName);
                    }}
                    placeholder={t('New preset name (e.g. CTF server)')}
                    aria-label={t('New preset name')}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="button"
                    disabled={!newPresetName.trim()}
                    onClick={() => presetRequest('POST', newPresetName)}
                    title={t('Save the current options (without the map list) under this name')}
                    className="px-2 py-1 rounded bg-violet-600/80 hover:bg-violet-500 text-white flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" /> {t('Save')}
                  </button>
                </div>
                {presetError && <div className="text-[11px] text-red-300">{presetError}</div>}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {t('Pack name')}
                  </label>
                  <input
                    type="text"
                    value={packName}
                    onChange={(e) => setPackName(e.target.value)}
                    placeholder={t('e.g. CTF_Tournament_Pack_2026')}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {t('Output format')}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 text-xs">
                    {[
                      { id: 'zip', label: t('.ZIP (Classic)') },
                      { id: 'smap', label: '.SMAP (1.8)' },
                      { id: 'folder', label: t('Folder') },
                    ].map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setOutputFormat(fmt.id as 'zip' | 'smap' | 'folder')}
                        className={`py-1.5 px-2 rounded-md border font-medium transition-colors cursor-pointer ${
                          outputFormat === fmt.id
                            ? 'bg-violet-500/20 border-violet-500 text-violet-200'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Split-by-prefix / Split-by-mode for massive map collections */}
                {outputFormat === 'zip' && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-violet-400" />
                      {t('Split into separate .ZIP archives')}
                    </label>
                    <select
                      value={splitBy}
                      onChange={(e) => setSplitBy(e.target.value as 'none' | 'mode' | 'prefix')}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
                    >
                      <option value="none">{t('One combined .ZIP pack')}</option>
                      <option value="mode">
                        {t('Separate .ZIP packs by game mode (RSCS, Trenchwars, CTF, Climb...)')}
                      </option>
                      <option value="prefix">
                        {t('Separate .ZIP packs for each prefix (ctf_cs_, ctf_de_, tw_, kz_...)')}
                      </option>
                    </select>
                  </div>
                )}

                {/* Folder docelowy */}
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {tr('Output folder (default: {path})', {
                      path: <code className="text-zinc-400">exports/packs</code>,
                    })}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={customOutputFolder}
                      onChange={(e) => setCustomOutputFolder(e.target.value)}
                      placeholder={t('Default project folder (exports/packs)')}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await pickSystemFolder(t('Choose the folder to save the map pack in'));
                        if (chosen) setCustomOutputFolder(chosen);
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 shrink-0 cursor-pointer"
                    >
                      {t('Choose...')}
                    </button>
                  </div>
                </div>

                {/* Smart Options */}
                <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-lg p-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    {t('Dependency Packing Options')}
                  </div>

                  <PackOptionCheckbox
                    checked={excludeVanillaAssets}
                    onChange={setExcludeVanillaAssets}
                    label={t('Skip default Soldat textures and sceneries (readonly.txt)')}
                    hint={t('Recommended — does not duplicate files every player already has')}
                  />
                  <PackOptionCheckbox
                    checked={excludeUnusedScenery}
                    onChange={setExcludeUnusedScenery}
                    label={t('Skip unused (“dead”) sceneries from the .pms header')}
                    hint={t('Removes junk left behind by PolyWorks / MapMaker')}
                  />
                  <PackOptionCheckbox
                    checked={fixLinuxCase}
                    onChange={setFixLinuxCase}
                    label={t('Fix letter case for Linux servers')}
                    hint={t(
                      'File names in the ZIP exactly as in the .pms; a file that maps spell in several ways goes into the pack under each name'
                    )}
                  />
                  <PackOptionCheckbox
                    checked={includePngOverrides}
                    onChange={setIncludePngOverrides}
                    label={t('Include HD equivalents (.png override)')}
                  />
                  <PackOptionCheckbox
                    checked={includeEdgeTextures}
                    onChange={setIncludeEdgeTextures}
                    label={t('Include custom edges (textures/edges/)')}
                  />
                  <PackOptionCheckbox
                    checked={generateMapsListTxt}
                    onChange={setGenerateMapsListTxt}
                    label={t('Generate a map list for the server (mapslist_<name>.txt)')}
                  />
                  <PackOptionCheckbox
                    checked={generateReadmeManifest}
                    onChange={setGenerateReadmeManifest}
                    label={t('Include a README_PACK.txt report listing the maps')}
                  />
                  <PackOptionCheckbox
                    checked={generateCrcManifest}
                    onChange={setGenerateCrcManifest}
                    label={t('Include a manifest of map CRC32 checksums (maps_crc32_<name>.txt)')}
                  />
                </div>
              </div>

              {/* Selected Maps List (Capped for 50k scale performance) */}
              <div className="flex-1 min-h-32 flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-zinc-300">
                    {t('Selected maps ({count})', { count: packMapIds.length.toLocaleString(locale) })}
                  </span>
                  {packMapIds.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearPack}
                      className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> {t('Clear list')}
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto bg-zinc-950/70 border border-zinc-800 rounded-lg divide-y divide-zinc-800/60 max-h-48">
                  {packMapIds.length === 0 ? (
                    <div className="p-4 text-center text-xs text-zinc-500">
                      {tr(
                        'The pack cart is empty. Select maps in the browser or add a whole mode / prefix with the {button} button.',
                        { button: <code>+Pack</code> }
                      )}
                    </div>
                  ) : (
                    <>
                      {visibleCartIds.map((id) => (
                        <div
                          key={id}
                          className="px-2.5 py-1.5 flex items-center justify-between text-xs"
                        >
                          <span className="font-mono text-zinc-200 truncate">
                            {getMapLabelById(id)}
                          </span>
                          <button
                            onClick={() => onRemoveMapFromPack(id)}
                            className="text-zinc-500 hover:text-red-400 px-1 cursor-pointer"
                            title={t('Remove from pack')}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {hiddenCartCount > 0 && (
                        <div className="px-2.5 py-2 text-center text-[11px] text-zinc-400 bg-zinc-900/50">
                          {tp(hiddenCartCount, '...and {n} more map in the cart', '...and {n} more maps in the cart', {
                            n: hiddenCartCount.toLocaleString(locale),
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Live File Tree Preview, Audit & Build Trigger */}
            <div className="col-span-7 flex flex-col min-h-0 p-4 space-y-3">
              {/* Summary Metrics */}
              <div className="grid grid-cols-4 gap-2">
                <MetricBox
                  label={t('Total files')}
                  value={(preview?.totalFilesCount ?? 0).toLocaleString(locale)}
                />
                <MetricBox
                  label={t('Size (uncompressed)')}
                  value={formatBytes(preview?.totalUncompressedBytes ?? 0)}
                />
                <MetricBox
                  label={t('Skipped vanilla/dead')}
                  value={(
                    (preview?.skippedVanillaCount ?? 0) +
                    (preview?.skippedUnusedSceneryCount ?? 0)
                  ).toLocaleString(locale)}
                />
                <MetricBox
                  label={t('Linux case fixes')}
                  value={String(preview?.caseFixedCount ?? 0)}
                />
              </div>

              {/* Split Packs Preview */}
              {preview?.splitGroupsPreview && preview.splitGroupsPreview.length > 0 && (
                <div className="bg-violet-950/35 border border-violet-500/35 rounded-lg p-2.5 max-h-28 overflow-y-auto">
                  <div className="text-xs font-semibold text-violet-200 mb-1">
                    {tp(
                      preview.splitGroupsPreview.length,
                      '{n} separate .ZIP pack will be created:',
                      '{n} separate .ZIP packs will be created:'
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.splitGroupsPreview.map((g) => (
                      <span
                        key={g.groupKey}
                        className="px-2 py-0.5 rounded bg-zinc-950/80 border border-violet-500/30 font-mono text-[10px] text-violet-200"
                      >
                        {g.packFileName} ({g.mapCount})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Same archive path, different files on disk */}
              {preview && preview.collisionWarnings?.length > 0 && (
                <div className="bg-orange-950/40 border border-orange-600/40 rounded-lg p-2.5 max-h-24 overflow-y-auto">
                  <div className="text-xs font-semibold text-orange-300 mb-1">
                    {t('File name collisions ({count}) — only one version will be packed:', {
                      count: preview.collisionWarnings.length,
                    })}
                  </div>
                  <div className="space-y-0.5 text-[10px] font-mono text-orange-200/90">
                    {preview.collisionWarnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Asset Warnings */}
              {preview && preview.missingWarningsCount > 0 && (
                <div className="bg-amber-950/50 border border-amber-600/40 rounded-lg p-2.5 max-h-28 overflow-y-auto">
                  <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t('Warning: missing files detected on disk ({count})', { count: preview.missingWarningsCount })}
                  </div>
                  <div className="space-y-0.5 text-[11px] font-mono text-amber-200/90">
                    {preview.missingWarnings.map((w, i) => (
                      <div key={i}>
                        • {t('[{map}] missing {file}', { map: w.mapName, file: `${w.category}/${w.referencedName}` })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Searchable Archive File Tree */}
              <div className="flex-1 min-h-0 flex flex-col bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2 bg-zinc-900/50">
                  <span className="text-xs font-semibold text-zinc-300">
                    {t('Archive contents preview ({count})', {
                      count: `${filteredPreviewFiles.length}${preview?.filesTruncated ? '+' : ''}`,
                    })}
                    {loadingPreview ? ` • ${t('recalculating...')}` : ''}
                  </span>
                  <div className="relative w-56">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={fileTreeFilter}
                      onChange={(e) => setFileTreeFilter(e.target.value)}
                      placeholder={t('Filter by path...')}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-zinc-900 font-mono text-[11px]">
                  {filteredPreviewFiles.length === 0 ? (
                    <div className="p-6 text-center text-zinc-500 font-sans text-xs">
                      {t('No files to show.')}
                    </div>
                  ) : (
                    filteredPreviewFiles.map((f) => (
                      <div
                        key={f.archivePath}
                        className="px-3 py-1.5 flex items-center justify-between hover:bg-zinc-900/60"
                      >
                        <div className="min-w-0 pr-3">
                          <div className="text-zinc-200 truncate">{f.archivePath}</div>
                          {f.caseAliasOf ? (
                            <div className="text-[10px] text-orange-300">
                              {t('Second spelling for Linux — same file as {name}', {
                                name: f.caseAliasOf.split('/').pop() ?? '',
                              })}
                            </div>
                          ) : (
                            f.caseRenamedFrom && (
                              <div className="text-[10px] text-orange-300">
                                {t('Linux fix from: {name}', { name: f.caseRenamedFrom })}
                              </div>
                            )
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-zinc-400">
                          <span
                            title={t('Sample maps: {maps}', { maps: (f.sampleMaps || []).join(', ') })}
                            className="text-[10px] bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400"
                          >
                            {tp(f.usedByMapsCount, '{n} map', '{n} maps')}
                          </span>
                          <span className="w-16 text-right">{formatBytes(f.sizeBytes)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Build Result Banner */}
              {buildError && (
                <div className="bg-red-950/80 border border-red-700 rounded-lg px-3 py-2 text-xs text-red-200">
                  {buildError}
                </div>
              )}

              {buildResult && buildResult.warnings && buildResult.warnings.length > 0 && (
                <div className="bg-amber-950/50 border border-amber-600/40 rounded-lg p-2.5 max-h-24 overflow-y-auto text-[10px] font-mono text-amber-200/90">
                  <div className="text-xs font-semibold font-sans text-amber-300 mb-1">
                    {t('Pack build notes ({count}):', { count: buildResult.warnings.length })}
                  </div>
                  {buildResult.warnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}

              {buildResult && (
                <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-emerald-200 truncate">
                        {buildResult.splitArchiveCount
                          ? tp(
                              buildResult.splitArchiveCount,
                              'Created {n} separate .ZIP pack ({size})',
                              'Created {n} separate .ZIP packs ({size})',
                              { size: formatBytes(buildResult.sizeBytes) }
                            )
                          : t('Created: {name} ({size})', {
                              name: buildResult.fileName,
                              size: formatBytes(buildResult.sizeBytes),
                            })}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400 truncate">
                        {buildResult.outputPath}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openPathInExplorer(buildResult.outputPath)}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-100 flex items-center gap-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> {t('Show folder')}
                    </button>
                    {buildResult.downloadUrl && (
                      <a
                        href={buildResult.downloadUrl}
                        download={buildResult.fileName}
                        className="px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1"
                      >
                        <Download className="w-3.5 h-3.5" /> {t('Download')}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Build Action Footer */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleBuildPack}
                  disabled={building || packMapIds.length === 0}
                  className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-violet-950/50 transition-all cursor-pointer"
                >
                  <Archive className="w-4 h-4" />
                  {building
                    ? t('Building the pack...')
                    : splitBy !== 'none' && outputFormat === 'zip'
                    ? tp(packMapIds.length, 'Build Separate Packs ({n} map)', 'Build Separate Packs ({n} maps)', {
                        n: packMapIds.length.toLocaleString(locale),
                      })
                    : tp(packMapIds.length, 'Build Pack ({n} map)', 'Build Pack ({n} maps)', {
                        n: packMapIds.length.toLocaleString(locale),
                      })}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* External Archive Inspector + 1-Click Unpack & Mount Tab */
          <div className="flex-1 min-h-0 p-5 flex flex-col space-y-4 overflow-y-auto">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={archiveInputPath}
                onChange={(e) => setArchiveInputPath(e.target.value)}
                placeholder={t('Path to a .zip or .smap file on disk...')}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-violet-500"
              />
              <button
                type="button"
                onClick={async () => {
                  const chosen = await pickSystemFile();
                  if (chosen) {
                    setArchiveInputPath(chosen);
                    handleInspectArchive(chosen);
                  }
                }}
                className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-100 font-medium cursor-pointer"
              >
                {t('Choose a .zip / .smap file...')}
              </button>
              <button
                type="button"
                onClick={() => handleInspectArchive(archiveInputPath)}
                disabled={!archiveInputPath.trim()}
                className="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer"
              >
                {t('Analyze')}
              </button>
            </div>

            {inspectError && (
              <div className="bg-red-950/80 border border-red-700 rounded-lg px-4 py-2.5 text-xs text-red-200">
                {inspectError}
              </div>
            )}

            {extractResultPath && (
              <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-3 flex items-center justify-between text-xs text-emerald-200">
                <span>
                  {tr('Extracted and added to the map browser: {path}', {
                    path: <code className="font-mono">{extractResultPath}</code>,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => openPathInExplorer(extractResultPath)}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 cursor-pointer"
                >
                  {t('Open folder')}
                </button>
              </div>
            )}

            {inspectedArchive && (
              <>
                <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5">
                  <div className="text-xs text-zinc-300">
                    {tr('Archive: {name}', {
                      name: <strong className="font-mono text-zinc-100">{inspectedArchive.fileName}</strong>,
                    })}{' '}
                    • <strong>{inspectedArchive.maps.length}</strong> {tp(inspectedArchive.maps.length, 'map', 'maps')} •{' '}
                    <strong>{inspectedArchive.totalFiles}</strong>{' '}
                    {tp(inspectedArchive.totalFiles, 'file in total', 'files in total')}
                  </div>
                  <button
                    type="button"
                    disabled={extracting}
                    onClick={handleExtractAndMount}
                    className="px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderInput className="w-4 h-4" />
                    {extracting ? t('Extracting...') : t('Extract and add to the browser')}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-900/60 border-b border-zinc-800 text-xs font-semibold text-zinc-200">
                      {t('Maps in the archive ({count})', { count: inspectedArchive.maps.length })}
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 p-2">
                      {inspectedArchive.maps.map((m) => (
                        <div key={m.name} className="py-2 px-2 text-xs">
                          <div className="font-mono font-bold text-emerald-300">{m.name}</div>
                          <div className="text-[11px] text-zinc-400">
                            {m.title} • {m.polygons} poly • {tp(m.props, '{n} scenery', '{n} sceneries')} •{' '}
                            {t('texture: {name}', { name: m.texture })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-900/60 border-b border-zinc-800 text-xs font-semibold text-zinc-200">
                      {t('All files ({count})', { count: inspectedArchive.totalFiles })}
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-zinc-900 font-mono text-[11px] p-2">
                      {inspectedArchive.files.map((f, i) => (
                        <div key={i} className="py-1 px-2 flex justify-between text-zinc-300">
                          <span className="truncate pr-2">{f.path}</span>
                          <span className="text-zinc-500 shrink-0">{formatBytes(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const PackOptionCheckbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}> = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-violet-500"
    />
    <div>
      <div className="text-xs text-zinc-200 leading-snug">{label}</div>
      {hint && <div className="text-[10px] text-zinc-500 leading-snug">{hint}</div>}
    </div>
  </label>
);

const MetricBox: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
    <div className="text-[10px] text-zinc-500 truncate">{label}</div>
    <div className="font-mono text-sm font-bold text-zinc-100 mt-0.5">{value}</div>
  </div>
);
