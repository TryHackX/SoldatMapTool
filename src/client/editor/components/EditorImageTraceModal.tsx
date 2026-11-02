import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorAssetCatalogResponse } from '@shared/apiTypes';
import { ImageTraceMode, traceImageToPolygons } from '@shared/imageTracer';
import { PmsMapData, PmsPolygon } from '@shared/pmsParser';
import { POLY_TYPES, RgbaColor } from '@shared/soldatConstants';
import { Eye, FileImage, Layers, Sparkles, Upload, X } from 'lucide-react';
import { polyTypeName, t } from '../../i18n';
import { useModalDismiss } from '../../utils/useModalDismiss';
import { loadSoldatAssetImage } from '../../renderer/assetLoader';
import { EditorBlueprintOverlay } from '../types';
import { NumberInput } from './EditorFields';

interface EditorImageTraceModalProps {
  open: boolean;
  onClose: () => void;
  map: PmsMapData;
  assetCatalog: EditorAssetCatalogResponse | null;
  preferClassicBmp: boolean;
  texDims: { w: number; h: number };
  defaultPolyType: number;
  defaultColor: RgbaColor;
  onInsertPolygons: (polys: PmsPolygon[], label: string) => void;
  getViewCenter?: () => { x: number; y: number } | null;
  onPinBlueprint: (bp: EditorBlueprintOverlay) => void;
}

interface LoadedRasterSource {
  name: string;
  displayCanvas: HTMLCanvasElement;
  origWidth: number;
  origHeight: number;
  traceRgba: Uint8ClampedArray;
  traceWidth: number;
  traceHeight: number;
  downscaleFactor: number;
}

const MAX_TRACE_DIM = 256;

function buildRasterSourceFromImage(
  source: CanvasImageSource,
  origWidth: number,
  origHeight: number,
  name: string
): LoadedRasterSource | null {
  if (origWidth <= 0 || origHeight <= 0) return null;
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = origWidth;
  displayCanvas.height = origHeight;
  const dCtx = displayCanvas.getContext('2d');
  if (!dCtx) return null;
  dCtx.drawImage(source, 0, 0, origWidth, origHeight);

  const scale = Math.min(1, MAX_TRACE_DIM / Math.max(origWidth, origHeight));
  const traceWidth = Math.max(2, Math.round(origWidth * scale));
  const traceHeight = Math.max(2, Math.round(origHeight * scale));

  const traceCanvas = document.createElement('canvas');
  traceCanvas.width = traceWidth;
  traceCanvas.height = traceHeight;
  const tCtx = traceCanvas.getContext('2d', { willReadFrequently: true });
  if (!tCtx) return null;
  tCtx.imageSmoothingEnabled = true;
  tCtx.drawImage(source, 0, 0, traceWidth, traceHeight);
  const imgData = tCtx.getImageData(0, 0, traceWidth, traceHeight);

  return {
    name,
    displayCanvas,
    origWidth,
    origHeight,
    traceRgba: imgData.data,
    traceWidth,
    traceHeight,
    downscaleFactor: origWidth / traceWidth,
  };
}

export const EditorImageTraceModal: React.FC<EditorImageTraceModalProps> = ({
  open,
  onClose,
  map,
  assetCatalog,
  preferClassicBmp,
  texDims,
  defaultPolyType,
  defaultColor,
  onInsertPolygons,
  getViewCenter,
  onPinBlueprint,
}) => {
  const [sourceTab, setSourceTab] = useState<'upload' | 'scenery'>('upload');
  const [sceneryFilter, setSceneryFilter] = useState('');
  const [raster, setRaster] = useState<LoadedRasterSource | null>(null);
  const [mode, setMode] = useState<ImageTraceMode>('alpha');
  const [threshold, setThreshold] = useState(96);
  const [detailEpsilon, setDetailEpsilon] = useState(1.6);
  const [smoothPasses, setSmoothPasses] = useState(1);
  const [minIslandPixels, setMinIslandPixels] = useState(12);
  const [worldScale, setWorldScale] = useState(1.5);
  const [targetX, setTargetX] = useState(0);
  const [targetY, setTargetY] = useState(0);
  const [polyType, setPolyType] = useState(defaultPolyType);
  const [sampleImageColors, setSampleImageColors] = useState(true);
  const [solidHex, setSolidHex] = useState('#dce2ea');

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    // The traced shape lands in the middle of what the user is looking at
    const view = getViewCenter?.();
    const cx = Math.round(view?.x ?? (map.polyBounds.left + map.polyBounds.right) * 0.5);
    const cy = Math.round(view?.y ?? (map.polyBounds.top + map.polyBounds.bottom) * 0.5);
    setTargetX(Number.isFinite(cx) ? cx : 0);
    setTargetY(Number.isFinite(cy) ? cy : 0);
    setPolyType(defaultPolyType);
    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    setSolidHex(`#${toHex(defaultColor.r)}${toHex(defaultColor.g)}${toHex(defaultColor.b)}`);
  }, [open, map.polyBounds.left, map.polyBounds.right, map.polyBounds.top, map.polyBounds.bottom, defaultPolyType, defaultColor]);

  const backdropProps = useModalDismiss(open, onClose);

  const solidRgba = useMemo<RgbaColor>(() => {
    const clean = solidHex.replace('#', '');
    if (clean.length !== 6) return { r: 220, g: 226, b: 234, a: 255 };
    return {
      r: parseInt(clean.slice(0, 2), 16) || 220,
      g: parseInt(clean.slice(2, 4), 16) || 226,
      b: parseInt(clean.slice(4, 6), 16) || 234,
      a: 255,
    };
  }, [solidHex]);

  const traceResult = useMemo(() => {
    if (!raster) return null;
    return traceImageToPolygons(raster.traceRgba, raster.traceWidth, raster.traceHeight, {
      mode,
      threshold,
      simplifyEpsilonPx: detailEpsilon,
      smoothPasses,
      minIslandPixels,
      maxIslands: 24,
      worldScale: worldScale * raster.downscaleFactor,
      centerX: targetX,
      centerY: targetY,
      polyType,
      sampleImageColors,
      flatColor: solidRgba,
      texWidth: texDims.w,
      texHeight: texDims.h,
    });
  }, [
    raster,
    mode,
    threshold,
    detailEpsilon,
    smoothPasses,
    minIslandPixels,
    worldScale,
    targetX,
    targetY,
    polyType,
    sampleImageColors,
    solidRgba,
    texDims.w,
    texDims.h,
  ]);

  // Draw live preview of source image + traced CW triangle mesh
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Checkerboard dark backdrop
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#18181b';
    const tile = 16;
    for (let y = 0; y < ch; y += tile) {
      for (let x = 0; x < cw; x += tile) {
        if (((x / tile + y / tile) & 1) === 0) ctx.fillRect(x, y, tile, tile);
      }
    }

    if (!raster) return;

    const pad = 20;
    const fit = Math.min(
      (cw - pad * 2) / Math.max(1, raster.origWidth),
      (ch - pad * 2) / Math.max(1, raster.origHeight)
    );
    const drawW = raster.origWidth * fit;
    const drawH = raster.origHeight * fit;
    const ox = (cw - drawW) * 0.5;
    const oy = (ch - drawH) * 0.5;

    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.drawImage(raster.displayCanvas, ox, oy, drawW, drawH);
    ctx.restore();

    if (traceResult && traceResult.polygons.length > 0) {
      const effScale = Math.max(1e-4, worldScale);
      const wxToPx = (wx: number) => ox + drawW * 0.5 + ((wx - targetX) / effScale) * fit;
      const wyToPx = (wy: number) => oy + drawH * 0.5 + ((wy - targetY) / effScale) * fit;

      for (const poly of traceResult.polygons) {
        const [v0, v1, v2] = poly.vertices;
        const c = v0.color;
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.55)`;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(wxToPx(v0.x), wyToPx(v0.y));
        ctx.lineTo(wxToPx(v1.x), wyToPx(v1.y));
        ctx.lineTo(wxToPx(v2.x), wyToPx(v2.y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [raster, traceResult, worldScale, targetX, targetY]);

  if (!open) return null;

  const handleFileUpload = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const built = buildRasterSourceFromImage(
        img,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        file.name
      );
      URL.revokeObjectURL(url);
      if (built) setRaster(built);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const handlePickScenerySprite = async (name: string) => {
    const loaded = await loadSoldatAssetImage('scenery-gfx', name, true, preferClassicBmp, true);
    if (!loaded || !loaded.canvas) return;
    const built = buildRasterSourceFromImage(loaded.canvas, loaded.width, loaded.height, name);
    if (built) {
      setMode('alpha');
      setRaster(built);
    }
  };

  const filteredSceneries = (assetCatalog?.sceneries ?? [])
    .filter((s) => !sceneryFilter.trim() || s.name.toLowerCase().includes(sceneryFilter.trim().toLowerCase()))
    .slice(0, 60);

  return (
    <div {...backdropProps} className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="h-11 px-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-100">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            {t('Image → Polygons & Reference Blueprint')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 overflow-y-auto text-xs">
          {/* Left: Source Picker + Live Mesh Preview */}
          <div className="md:col-span-7 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => setSourceTab('upload')}
                className={`py-1.5 px-2 rounded text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  sourceTab === 'upload'
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                {t('Upload Local Image')}
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('scenery')}
                className={`py-1.5 px-2 rounded text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  sourceTab === 'scenery'
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FileImage className="w-3.5 h-3.5" />
                {t('Pick Soldat Scenery')}
              </button>
            </div>

            {sourceTab === 'upload' ? (
              <label className="border border-dashed border-zinc-700 hover:border-emerald-500/60 bg-zinc-950/60 rounded-lg p-3 flex items-center justify-between gap-3 cursor-pointer transition">
                <div className="space-y-0.5">
                  <div className="text-zinc-200 font-semibold">
                    {raster ? raster.name : t('Choose PNG, BMP, JPG, or SVG image...')}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {t('Transparent PNGs, #00FF00 Soldat sprites, or black-and-white sketches')}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-200 text-[11px] font-semibold shrink-0">
                  {t('Browse...')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-2 space-y-2">
                <input
                  type="text"
                  value={sceneryFilter}
                  onChange={(e) => setSceneryFilter(e.target.value)}
                  placeholder={t('Filter scenery-gfx sprites...')}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100"
                />
                <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1">
                  {filteredSceneries.map((sc) => (
                    <button
                      key={sc.name}
                      type="button"
                      onClick={() => void handlePickScenerySprite(sc.name)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer ${
                        raster?.name === sc.name
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {sc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
              <canvas ref={previewCanvasRef} width={520} height={310} className="w-full h-[270px] block" />
              {raster ? (
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2.5 py-1 rounded bg-zinc-950/85 border border-zinc-800 text-[11px]">
                  <span className="text-zinc-300 font-mono truncate">
                    {raster.name} ({raster.origWidth}×{raster.origHeight}px)
                  </span>
                  <span className="text-emerald-300 font-semibold shrink-0">
                    {t('{tris} triangles • {islands} shapes', {
                      tris: traceResult?.polygons.length ?? 0,
                      islands: traceResult?.islandCount ?? 0,
                    })}
                  </span>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs pointer-events-none">
                  {t('Select an image or Soldat scenery sprite above to preview traced polygons')}
                </div>
              )}
            </div>
          </div>

          {/* Right: Vectorizer Parameters */}
          <div className="md:col-span-5 space-y-3">
            <label className="space-y-1 block">
              <span className="text-zinc-400 text-[11px] font-semibold">{t('Detection mode')}</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ImageTraceMode)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
              >
                <option value="alpha">{t('Alpha / Silhouette (PNG & #00FF00)')}</option>
                <option value="luminance_dark">{t('Dark Ink / Sketch on Light BG')}</option>
                <option value="luminance_light">{t('Bright Shape on Dark BG')}</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1 block">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Threshold')}</span>
                  <span className="font-mono text-zinc-200">{threshold}</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={250}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </label>

              <label className="space-y-1 block">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Simplification')}</span>
                  <span className="font-mono text-zinc-200">{detailEpsilon.toFixed(1)}px</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={6}
                  step={0.1}
                  value={detailEpsilon}
                  onChange={(e) => setDetailEpsilon(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </label>

              <label className="space-y-1 block">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Corner smoothing')}</span>
                  <span className="font-mono text-zinc-200">{smoothPasses}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={smoothPasses}
                  onChange={(e) => setSmoothPasses(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </label>

              <label className="space-y-1 block">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{t('Min speck size')}</span>
                  <span className="font-mono text-zinc-200">{minIslandPixels}px</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={120}
                  step={2}
                  value={minIslandPixels}
                  onChange={(e) => setMinIslandPixels(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-zinc-800">
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-zinc-400">{t('Scale (u/px)')}</span>
                <NumberInput
                  step={0.25}
                  min={0.1}
                  max={30}
                  value={worldScale}
                  onChange={(e) => setWorldScale(Math.max(0.1, Number(e.target.value) || 1))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                />
              </label>
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-zinc-400">{t('Center X')}</span>
                <NumberInput
                  value={targetX}
                  onChange={(e) => setTargetX(Number(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                />
              </label>
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-zinc-400">{t('Center Y')}</span>
                <NumberInput
                  value={targetY}
                  onChange={(e) => setTargetY(Number(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                />
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-zinc-400 text-[11px]">{t('Polygon type')}</span>
              <select
                value={polyType}
                onChange={(e) => setPolyType(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
              >
                {Object.values(POLY_TYPES).map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.id}: {polyTypeName(pt)}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sampleImageColors}
                  onChange={(e) => setSampleImageColors(e.target.checked)}
                  className="accent-emerald-500"
                />
                <span>{t('Sample vertex colors from image')}</span>
              </label>
              {!sampleImageColors && (
                <input
                  type="color"
                  value={solidHex}
                  onChange={(e) => setSolidHex(e.target.value)}
                  className="w-7 h-6 rounded bg-transparent cursor-pointer"
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            disabled={!raster}
            onClick={() => {
              if (!raster) return;
              onPinBlueprint({
                image: raster.displayCanvas,
                width: raster.origWidth,
                height: raster.origHeight,
                name: raster.name,
                x: targetX,
                y: targetY,
                scale: worldScale,
                opacity: 0.45,
                visible: true,
              });
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-40 border border-cyan-500/40 text-cyan-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            {t('Pin as Canvas Blueprint Underlay')}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs cursor-pointer"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              disabled={!traceResult || traceResult.polygons.length === 0}
              onClick={() => {
                if (!traceResult || traceResult.polygons.length === 0) return;
                onInsertPolygons(
                  traceResult.polygons,
                  `Trace image to polygons (${traceResult.polygons.length})`
                );
                onClose();
              }}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              {t('Insert Polygons ({count})', { count: traceResult?.polygons.length ?? 0 })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
