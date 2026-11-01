import React, { useEffect, useRef, useState } from 'react';
import { MapCompactEntry, MapIndexEntry } from '@shared/apiTypes';
import { PmsMapData } from '@shared/pmsParser';
import {
  ExportResultInfo,
  generateFullSizeScreenshot,
} from '../renderer/FullSizeExporter';
import { DEFAULT_RENDER_LAYERS, RenderLayerVisibility } from '../renderer/types';
import {
  fetchAndParseMap,
  formatBytes,
  openPathInExplorer,
  pickSystemFolder,
} from '../utils/mapCache';
import { useModalDismiss } from '../utils/useModalDismiss';
import {
  Camera,
  CheckCircle2,
  Download,
  FolderOpen,
  Layers,
  Square,
  X,
} from 'lucide-react';

interface ScreenshotModalProps {
  open: boolean;
  initialBatchMode: boolean;
  onClose: () => void;
  currentMapEntry: MapIndexEntry | MapCompactEntry | null;
  currentMapData: PmsMapData | null;
  currentLayers: RenderLayerVisibility;
  batchCount: number;
  batchSourceLabel: string;
  onResolveBatchCandidates: () => Promise<MapCompactEntry[]>;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({
  open,
  initialBatchMode,
  onClose,
  currentMapEntry,
  currentMapData,
  currentLayers,
  batchCount,
  batchSourceLabel,
  onResolveBatchCandidates,
}) => {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [scale, setScale] = useState<number>(1.0);
  const [boundsMode, setBoundsMode] = useState<'poly' | 'full'>('poly');
  const [paddingPx, setPaddingPx] = useState<number>(64);
  const [format, setFormat] = useState<'png' | 'webp' | 'jpeg'>('png');
  const [quality, setQuality] = useState<number>(92);
  const [includeWatermark, setIncludeWatermark] = useState(false);
  const [triggerBrowserDownload, setTriggerBrowserDownload] = useState(true);
  const [subfolderMode, setSubfolderMode] = useState<'none' | 'mode' | 'prefix'>('none');
  const [skipExisting, setSkipExisting] = useState(true);
  const [customFolder, setCustomFolder] = useState('');
  const [exportLayers, setExportLayers] = useState<RenderLayerVisibility>(currentLayers);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExportResultInfo | null>(null);
  const [batchStats, setBatchStats] = useState<{
    done: number;
    skipped: number;
    failed: number;
    total: number;
    firstError: string | null;
    stoppedEarly: boolean;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialBatchMode ? 'batch' : 'single');
      setExportLayers(currentLayers);
      setError(null);
      setLastResult(null);
      setBatchStats(null);
      setProgress(0);
      setStatusText('');
    }
  }, [open, initialBatchMode, currentLayers]);

  const backdropProps = useModalDismiss(open, onClose, running);

  if (!open) return null;

  const srcBounds = currentMapEntry
    ? boundsMode === 'full'
      ? currentMapEntry.fullBounds
      : currentMapEntry.polyBounds
    : null;

  const estW = srcBounds ? Math.max(16, Math.round((srcBounds.width + paddingPx * 2) * scale)) : 0;
  const estH = srcBounds ? Math.max(16, Math.round((srcBounds.height + paddingPx * 2) * scale)) : 0;
  const usesTiledMode = estW > 4096 || estH > 4096;

  const toggleExportLayer = (key: keyof RenderLayerVisibility) => {
    setExportLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStopBatch = () => {
    abortRef.current?.abort();
  };

  const handleGenerate = async () => {
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setError(null);
    setLastResult(null);
    setBatchStats(null);

    try {
      if (mode === 'single') {
        if (!currentMapEntry) throw new Error('Brak wybranej mapy.');
        const mapData = currentMapData ?? (await fetchAndParseMap(currentMapEntry.id));
        const res = await generateFullSizeScreenshot(
          mapData,
          currentMapEntry.baseName,
          {
            scale,
            boundsMode,
            paddingPx,
            format,
            quality,
            layers: exportLayers,
            saveToServerExports: true,
            triggerBrowserDownload,
            includeWatermark,
            subfolderMode,
            skipExisting: false,
            customFolder: customFolder || undefined,
          },
          (p, msg) => {
            setProgress(p);
            setStatusText(msg);
          },
          {
            prefix: currentMapEntry.prefix,
            modeGroupName: currentMapEntry.modeGroupName,
            signal: controller.signal,
          }
        );
        setLastResult(res);
      } else {
        setStatusText('Pobieranie listy map do wsadowego renderowania...');
        const candidates = await onResolveBatchCandidates();
        if (candidates.length === 0) {
          throw new Error('Brak map do wsadowego wygenerowania screenów.');
        }

        let completed = 0;
        let skipped = 0;
        let failed = 0;
        let consecutiveFailures = 0;
        let firstError: string | null = null;
        let stoppedEarly = false;
        let lastOut: ExportResultInfo | null = null;

        for (const entry of candidates) {
          if (controller.signal.aborted) break;

          setStatusText(
            `[${completed + 1} / ${candidates.length}] ${entry.baseName} (${Math.round(
              entry.polyWidth * scale
            )}×${Math.round(entry.polyHeight * scale)} px)...`
          );
          setProgress(completed / candidates.length);

          try {
            const parsed = await fetchAndParseMap(entry.id);
            const res = await generateFullSizeScreenshot(
              parsed,
              entry.baseName,
              {
                scale,
                boundsMode,
                paddingPx,
                format,
                quality,
                layers: exportLayers,
                saveToServerExports: true,
                triggerBrowserDownload: false,
                includeWatermark,
                subfolderMode,
                skipExisting,
                customFolder: customFolder || undefined,
              },
              undefined,
              {
                prefix: entry.prefix,
                modeGroupName: entry.modeGroupName,
                signal: controller.signal,
              }
            );
            lastOut = res;
            if (res.skipped) skipped++;
            completed++;
            consecutiveFailures = 0;
          } catch (itemErr) {
            if (controller.signal.aborted) break;
            console.warn(`Błąd renderowania mapy ${entry.baseName}:`, itemErr);
            completed++;
            failed++;
            consecutiveFailures++;
            if (!firstError) {
              firstError = `${entry.baseName}: ${itemErr instanceof Error ? itemErr.message : String(itemErr)}`;
            }
            // 10 failures in a row = systematic problem (unwritable folder, lost GPU): stop instead of grinding on
            if (consecutiveFailures >= 10) {
              stoppedEarly = true;
              break;
            }
          }

          setProgress(completed / candidates.length);
          // Yield event loop so Stop button & progress bar stay responsive across thousands of maps
          await new Promise((r) => setTimeout(r, 8));
        }

        setBatchStats({ done: completed, skipped, failed, total: candidates.length, firstError, stoppedEarly });
        setLastResult(lastOut);
        setStatusText(
          controller.signal.aborted
            ? `Zatrzymano po przetworzeniu ${completed} / ${candidates.length} map.`
            : `Zakończono! Przetworzono ${completed} map (pominięto istniejących: ${skipped}, błędy: ${failed}).`
        );
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Camera className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-zinc-100">
              Generator Full-Size Screen (100% View)
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            aria-label="Zamknij generator screenów"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 overflow-y-auto text-xs">
          {/* Single vs Batch Mode Switch */}
          <div className="grid grid-cols-2 gap-2 bg-zinc-950 border border-zinc-800 p-1 rounded-lg">
            <button
              type="button"
              disabled={running}
              onClick={() => setMode('single')}
              className={`py-2 px-3 rounded-md font-semibold transition-colors cursor-pointer ${
                mode === 'single'
                  ? 'bg-emerald-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Pojedyncza mapa ({currentMapEntry?.baseName || '—'})
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => setMode('batch')}
              className={`py-2 px-3 rounded-md font-semibold transition-colors cursor-pointer ${
                mode === 'batch'
                  ? 'bg-emerald-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Tryb Wsadowy Batch ({batchCount.toLocaleString('pl-PL')} map — {batchSourceLabel})
            </button>
          </div>

          {/* Scale & Framing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-zinc-300 mb-1.5">
                Skala odwzorowania
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { v: 0.25, label: '25%' },
                  { v: 0.5, label: '50%' },
                  { v: 1.0, label: '100% (1:1)' },
                  { v: 2.0, label: '200%' },
                ].map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => setScale(s.v)}
                    className={`py-1.5 px-2 rounded border font-mono font-semibold transition-colors cursor-pointer ${
                      scale === s.v
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1.5">
                Zakres kadrowania
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setBoundsMode('poly')}
                  className={`py-1.5 px-2 rounded border font-medium cursor-pointer ${
                    boundsMode === 'poly'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Granice Poligonów
                </button>
                <button
                  type="button"
                  onClick={() => setBoundsMode('full')}
                  className={`py-1.5 px-2 rounded border font-medium cursor-pointer ${
                    boundsMode === 'full'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  Pełny (+Scenerie)
                </button>
              </div>
            </div>
          </div>

          {/* Padding & Format */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-zinc-300 mb-1.5">
                Margines wokół mapy (Padding)
              </label>
              <div className="grid grid-cols-5 gap-1">
                {[0, 32, 64, 128, 256].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPaddingPx(p)}
                    className={`py-1 rounded border font-mono cursor-pointer ${
                      paddingPx === p
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    {p}px
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1.5">Format pliku</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'png', label: 'PNG (Bezstratny)' },
                  { id: 'webp', label: 'WEBP' },
                  { id: 'jpeg', label: 'JPG' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormat(f.id as 'png' | 'webp' | 'jpeg')}
                    className={`py-1 rounded border font-medium cursor-pointer ${
                      format === f.id
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Output Folder & Subfolder Organization */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-zinc-300 mb-1">
                Folder zapisu (domyślnie: <code>exports/screenshots</code>)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={customFolder}
                  onChange={(e) => setCustomFolder(e.target.value)}
                  placeholder="exports/screenshots"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const chosen = await pickSystemFolder('Wybierz folder zapisu screenów 100%');
                    if (chosen) setCustomFolder(chosen);
                  }}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 shrink-0 cursor-pointer"
                >
                  ...
                </button>
              </div>
            </div>

            <div>
              <label className="block font-medium text-zinc-300 mb-1">
                Grupowanie w podfolderach
              </label>
              <select
                value={subfolderMode}
                onChange={(e) => setSubfolderMode(e.target.value as 'none' | 'mode' | 'prefix')}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="none">Brak (wszystkie w jednym folderze)</option>
                <option value="mode">Wg Trybu Gry (RSCS, Trenchwars, CTF...)</option>
                <option value="prefix">Wg Prefixu (ctf_cs, tw, kz...)</option>
              </select>
            </div>
          </div>

          {/* Output Resolution Preview Banner */}
          {mode === 'single' && currentMapEntry && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 flex items-center justify-between">
              <div>
                <div className="text-zinc-400 text-[11px]">Rozdzielczość wyjściowego screena:</div>
                <div className="font-mono text-sm font-bold text-emerald-300">
                  {estW} × {estH} px
                </div>
              </div>
              <div className="text-right text-[11px] text-zinc-400">
                {usesTiledMode ? (
                  <span className="text-sky-300 font-medium">
                    Tryb Kafelkowy GPU + Sharp (Duża mapa &gt; 4096px)
                  </span>
                ) : (
                  <span className="text-emerald-400">Szybki pojedynczy przebieg WebGL2</span>
                )}
              </div>
            </div>
          )}

          {/* Layer Selection to Bake into Screenshot */}
          <div className="bg-zinc-950/75 border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Warstwy widoczne na wygenerowanym screenie
              </span>
              <button
                type="button"
                onClick={() => setExportLayers(DEFAULT_RENDER_LAYERS)}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                Resetuj do czystego klasycznego
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <LayerToggleBox
                checked={exportLayers.showBackground}
                onChange={() => toggleExportLayer('showBackground')}
                label="Tło (Gradient)"
              />
              <LayerToggleBox
                checked={exportLayers.showPolygons}
                onChange={() => toggleExportLayer('showPolygons')}
                label="Poligony i Tekstury"
              />
              <LayerToggleBox
                checked={exportLayers.showSmoothEdges}
                onChange={() => toggleExportLayer('showSmoothEdges')}
                label="Krawędzie Terenu HD"
              />
              <LayerToggleBox
                checked={exportLayers.showSceneryBack}
                onChange={() => toggleExportLayer('showSceneryBack')}
                label="Scenerie Tył"
              />
              <LayerToggleBox
                checked={exportLayers.showSceneryMid}
                onChange={() => toggleExportLayer('showSceneryMid')}
                label="Scenerie Środek"
              />
              <LayerToggleBox
                checked={exportLayers.showSceneryFront}
                onChange={() => toggleExportLayer('showSceneryFront')}
                label="Scenerie Przód"
              />
              <LayerToggleBox
                checked={exportLayers.preferClassicBmp}
                onChange={() => toggleExportLayer('preferClassicBmp')}
                label="Tekstury Soldat 1.6 (.bmp)"
              />
              <LayerToggleBox
                checked={exportLayers.showFlags}
                onChange={() => toggleExportLayer('showFlags')}
                label="Flagi (Alpha/Bravo)"
              />
              <LayerToggleBox
                checked={exportLayers.showSpawns}
                onChange={() => toggleExportLayer('showSpawns')}
                label="Spawny Graczy"
              />
              <LayerToggleBox
                checked={exportLayers.showBonuses}
                onChange={() => toggleExportLayer('showBonuses')}
                label="Bonusy i Bronie"
              />
              <LayerToggleBox
                checked={exportLayers.showColliders}
                onChange={() => toggleExportLayer('showColliders')}
                label="Colidery"
              />
              <LayerToggleBox
                checked={exportLayers.showPolyTypes}
                onChange={() => toggleExportLayer('showPolyTypes')}
                label="Fizyka Poligonów"
              />
              <LayerToggleBox
                checked={exportLayers.showWaypoints}
                onChange={() => toggleExportLayer('showWaypoints')}
                label="Ścieżki Botów"
              />
              <LayerToggleBox
                checked={exportLayers.showWireframe}
                onChange={() => toggleExportLayer('showWireframe')}
                label="Siatka Trójkątów"
              />
              <LayerToggleBox
                checked={exportLayers.showGrid}
                onChange={() => toggleExportLayer('showGrid')}
                label="Sektory / Osie"
              />
            </div>

            <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWatermark}
                  onChange={(e) => setIncludeWatermark(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                Dodaj etykietę z nazwą mapy i wymiarem w rogu
              </label>

              {mode === 'single' ? (
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={triggerBrowserDownload}
                    onChange={(e) => setTriggerBrowserDownload(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900"
                  />
                  Pobierz również w przeglądarce
                </label>
              ) : (
                <label className="flex items-center gap-2 text-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipExisting}
                    onChange={(e) => setSkipExisting(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                  />
                  Pomiń istniejące pliki (wznawianie Batcha)
                </label>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {running && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-zinc-300">
                <span className="truncate pr-2">{statusText}</span>
                <span className="font-mono shrink-0">{Math.round(progress * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-150"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-950/80 border border-red-700 rounded-lg px-3 py-2 text-red-200">
              {error}
            </div>
          )}

          {batchStats && batchStats.failed > 0 && !running && (
            <div className="bg-red-950/70 border border-red-700 rounded-lg px-3 py-2 text-red-200 space-y-0.5">
              <div className="font-semibold">
                Nie udało się wygenerować {batchStats.failed} screenów
                {batchStats.stoppedEarly ? ' — przerwano po 10 błędach z rzędu.' : '.'}
              </div>
              {batchStats.firstError && <div className="text-[11px] font-mono truncate">{batchStats.firstError}</div>}
            </div>
          )}

          {(lastResult || batchStats) && !running && (
            <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-emerald-200 truncate">
                    {batchStats
                      ? `Przetworzono ${batchStats.done} / ${batchStats.total} map (pominięto: ${batchStats.skipped}, błędy: ${batchStats.failed})`
                      : lastResult
                      ? `${lastResult.fileName} (${lastResult.width}×${lastResult.height} px • ${formatBytes(
                          lastResult.sizeBytes
                        )})`
                      : 'Gotowe!'}
                  </div>
                  {lastResult?.outputPath && (
                    <div className="text-[11px] font-mono text-zinc-400 truncate">
                      {lastResult.outputPath}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {lastResult?.outputPath && (
                  <button
                    type="button"
                    onClick={() => openPathInExplorer(lastResult.outputPath!)}
                    className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 flex items-center gap-1 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" /> Eksplorator
                  </button>
                )}
                {mode === 'single' && lastResult?.downloadUrl && (
                  <a
                    href={lastResult.downloadUrl}
                    download={lastResult.fileName}
                    className="px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> Pobierz
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            Zrzuty zapisywane są na dysku w <code>{customFolder || 'exports/screenshots/'}</code>
          </span>
          <div className="flex items-center gap-2">
            {running && (
              <button
                type="button"
                onClick={handleStopBatch}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                {mode === 'batch' ? 'Zatrzymaj Batch' : 'Anuluj'}
              </button>
            )}
            <button
              type="button"
              disabled={running}
              onClick={handleGenerate}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              {running
                ? 'Renderowanie...'
                : mode === 'single'
                ? `Wygeneruj Screen ${Math.round(scale * 100)}%`
                : `Wygeneruj ${batchCount.toLocaleString('pl-PL')} Screenów`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const LayerToggleBox: React.FC<{
  checked: boolean;
  onChange: () => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer hover:text-zinc-100">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="rounded border-zinc-700 bg-zinc-900 text-emerald-500"
    />
    <span className="truncate">{label}</span>
  </label>
);
