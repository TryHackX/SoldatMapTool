import { ArrowDown,ArrowDownToLine,ArrowUp,ArrowUpToLine,RotateCcw } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { ensureSceneryEntry } from '@shared/pmsCompiler';
import type { PmsProp } from '@shared/pmsParser';
import { t } from '../../i18n';
import { loadSoldatAssetImage } from '../../renderer/assetLoader';
import { mapAssetSource } from '../../renderer/mapAssetSource';
import { computePropQuadCenter } from '../EditorDocument';
import { NumberInput,CommitTextInput } from './EditorFields';
import { PanelCard } from './EditorPanelCard';
import { SceneryColorTools,SceneryGradientTools,SceneryScaleTools,SceneryVariationTools } from './EditorSceneryTools';
import type { EditorRightDockProps } from './EditorRightDock';

type Props = Pick<EditorRightDockProps,'snapshot'|'onPropDrawOrder'|'onCommitMutation'|'placement'|'onChangePlacement'|'preferClassicBmp'>;
export function SceneryInspector({snapshot,onPropDrawOrder,onCommitMutation,placement,onChangePlacement,preferClassicBmp}:Props) {
  const {map,selection}=snapshot;
  const selectedProps=selection.props.map(i=>map.props[i]).filter(Boolean);
  const current=useRef<typeof snapshot | null>(snapshot);
  useLayoutEffect(()=>{current.current=snapshot; return ()=>{current.current=null;};},[snapshot]);
  return <>
    {selectedProps.length > 0 && (
      <PanelCard title={t('Sceneries ({count})', { count: selectedProps.length })}>
        {/* Draw Order */}
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => onPropDrawOrder('front')}
            title={t('Bring to front')}
            className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center cursor-pointer"
          >
            <ArrowUpToLine className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onPropDrawOrder('forward')}
            title={t('Step forward')}
            className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center cursor-pointer"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onPropDrawOrder('backward')}
            title={t('Step backward')}
            className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onPropDrawOrder('back')}
            title={t('Send to back')}
            className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center cursor-pointer"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scenery File */}
        <label className="space-y-1 block">
          <span className="text-zinc-400 text-[11px]">{t('Image file')}</span>
          <CommitTextInput
            list="sms-editor-sceneries"
            value={map.scenery[selectedProps[0].style - 1]?.filename ?? ''}
            onChange={(e) => {
              const val = e.target.value.trim();
              if (!val) return;
              const ensured = ensureSceneryEntry(map.scenery, val);
              const nextProps = [...map.props];
              for (const idx of selection.props) {
                const orig = nextProps[idx];
                if (!orig) continue;
                const { raw: _raw, ...rest } = orig;
                nextProps[idx] = { ...rest, style: ensured.style };
              }
              onCommitMutation('Change scenery image', {
                ...map,
                scenery: ensured.scenery,
                props: nextProps,
              });
            }}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
          />
        </label>

        {/* Layer Level 0 / 1 / 2 */}
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              [0, t('Back (0)')],
              [1, t('Mid (1)')],
              [2, t('Front (2)')],
            ] as const
          ).map(([lvl, lbl]) => (
            <button
              key={lvl}
              type="button"
              onClick={() => {
                const nextProps = [...map.props];
                for (const idx of selection.props) {
                  const orig = nextProps[idx];
                  if (!orig) continue;
                  const { raw: _raw, ...rest } = orig;
                  nextProps[idx] = { ...rest, level: lvl };
                }
                onCommitMutation('Change scenery layer', { ...map, props: nextProps });
              }}
              className={`py-1 rounded text-[11px] border cursor-pointer ${
                selectedProps[0].level === lvl
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Stretched World Dimensions (Single or Multi Prop) */}
        {selectedProps.length === 1 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span>{t('Stretched size (W × H u)')}</span>
              <span className="font-mono text-zinc-500">
                {selectedProps[0].width}×{selectedProps[0].height} px
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <NumberInput
                min={2}
                step={1}
                value={Math.max(
                  1,
                  Math.round(Math.abs(selectedProps[0].width * selectedProps[0].scaleX))
                )}
                onChange={(e) => {
                  const targetW = Math.max(2, Number(e.target.value) || 2);
                  const idx = selection.props[0];
                  const p = map.props[idx];
                  if (!p) return;
                  const baseW = Math.max(1, p.width);
                  const signX = p.scaleX < 0 ? -1 : 1;
                  const nextSx = (targetW / baseW) * signX;
                  const oldCenter = computePropQuadCenter(p);
                  const { raw: _raw, ...rest } = p;
                  const updated: PmsProp = { ...rest, scaleX: nextSx };
                  const newCenter = computePropQuadCenter(updated);
                  const nextProps = [...map.props];
                  nextProps[idx] = {
                    ...updated,
                    x: p.x + (oldCenter.x - newCenter.x),
                    y: p.y + (oldCenter.y - newCenter.y),
                  };
                  onCommitMutation(
                    'Stretch scenery',
                    { ...map, props: nextProps },
                    undefined,
                    'prop_stretch_w'
                  );
                }}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
              />
              <span className="text-zinc-500">×</span>
              <NumberInput
                min={2}
                step={1}
                value={Math.max(
                  1,
                  Math.round(Math.abs(selectedProps[0].height * selectedProps[0].scaleY))
                )}
                onChange={(e) => {
                  const targetH = Math.max(2, Number(e.target.value) || 2);
                  const idx = selection.props[0];
                  const p = map.props[idx];
                  if (!p) return;
                  const baseH = Math.max(1, p.height);
                  const signY = p.scaleY < 0 ? -1 : 1;
                  const nextSy = (targetH / baseH) * signY;
                  const oldCenter = computePropQuadCenter(p);
                  const { raw: _raw, ...rest } = p;
                  const updated: PmsProp = { ...rest, scaleY: nextSy };
                  const newCenter = computePropQuadCenter(updated);
                  const nextProps = [...map.props];
                  nextProps[idx] = {
                    ...updated,
                    x: p.x + (oldCenter.x - newCenter.x),
                    y: p.y + (oldCenter.y - newCenter.y),
                  };
                  onCommitMutation(
                    'Stretch scenery',
                    { ...map, props: nextProps },
                    undefined,
                    'prop_stretch_h'
                  );
                }}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
              />
            </div>
          </div>
        )}

        <SceneryScaleTools map={map} indices={selection.props} onCommit={onCommitMutation} />

        {/* Rotation & Opacity Sliders */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 w-14 shrink-0">
              {t('Rotation (°)')}
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.max(
                -180,
                Math.min(180, Math.round((-selectedProps[0].rotation * 180) / Math.PI))
              )}
              onChange={(e) => {
                const deg = Number(e.target.value) || 0;
                const rad = (-deg * Math.PI) / 180;
                const nextProps = [...map.props];
                for (const idx of selection.props) {
                  const p = nextProps[idx];
                  if (!p) continue;
                  const oldCenter = computePropQuadCenter(p);
                  const { raw: _raw, ...rest } = p;
                  const updated: PmsProp = { ...rest, rotation: rad };
                  const newCenter = computePropQuadCenter(updated);
                  nextProps[idx] = {
                    ...updated,
                    x: p.x + (oldCenter.x - newCenter.x),
                    y: p.y + (oldCenter.y - newCenter.y),
                  };
                }
                onCommitMutation(
                  'Set scenery rotation',
                  { ...map, props: nextProps },
                  undefined,
                  'prop_rot'
                );
              }}
              className="flex-1 accent-cyan-400"
            />
            <NumberInput
              step={1}
              value={Number(((-selectedProps[0].rotation * 180) / Math.PI).toFixed(1))}
              onChange={(e) => {
                const deg = Number(e.target.value) || 0;
                const rad = (-deg * Math.PI) / 180;
                const nextProps = [...map.props];
                for (const idx of selection.props) {
                  const p = nextProps[idx];
                  if (!p) continue;
                  const oldCenter = computePropQuadCenter(p);
                  const { raw: _raw, ...rest } = p;
                  const updated: PmsProp = { ...rest, rotation: rad };
                  const newCenter = computePropQuadCenter(updated);
                  nextProps[idx] = {
                    ...updated,
                    x: p.x + (oldCenter.x - newCenter.x),
                    y: p.y + (oldCenter.y - newCenter.y),
                  };
                }
                onCommitMutation('Set scenery rotation', { ...map, props: nextProps });
              }}
              className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 w-14 shrink-0">
              {t('Opacity ({pct}%)', {
                pct: Math.round((selectedProps[0].alpha / 255) * 100),
              })}
            </span>
            <input
              type="range"
              min={0}
              max={255}
              value={selectedProps[0].alpha}
              onChange={(e) => {
                const a = Math.max(0, Math.min(255, Math.round(Number(e.target.value))));
                const nextProps = [...map.props];
                for (const idx of selection.props) {
                  const p = nextProps[idx];
                  if (!p) continue;
                  const { raw: _raw, ...rest } = p;
                  nextProps[idx] = { ...rest, alpha: a };
                }
                onCommitMutation(
                  'Set scenery opacity',
                  { ...map, props: nextProps },
                  undefined,
                  'prop_alpha'
                );
              }}
              className="flex-1 accent-cyan-400"
            />
            <NumberInput
              min={0}
              max={255}
              value={selectedProps[0].alpha}
              onChange={(e) => {
                const a = Math.max(0, Math.min(255, Math.round(Number(e.target.value))));
                const nextProps = [...map.props];
                for (const idx of selection.props) {
                  const p = nextProps[idx];
                  if (!p) continue;
                  const { raw: _raw, ...rest } = p;
                  nextProps[idx] = { ...rest, alpha: a };
                }
                onCommitMutation('Set scenery opacity', { ...map, props: nextProps });
              }}
              className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
            />
          </div>
        </div>

        {/* Flip X / Flip Y & Reset Image Size */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const nextProps = [...map.props];
              for (const idx of selection.props) {
                const p = nextProps[idx];
                if (!p) continue;
                const oldCenter = computePropQuadCenter(p);
                const { raw: _raw, ...rest } = p;
                const flipped: PmsProp = { ...rest, scaleX: -p.scaleX };
                const newCenter = computePropQuadCenter(flipped);
                nextProps[idx] = {
                  ...flipped,
                  x: p.x + (oldCenter.x - newCenter.x),
                  y: p.y + (oldCenter.y - newCenter.y),
                };
              }
              onCommitMutation('Flip scenery X', { ...map, props: nextProps });
            }}
            className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] cursor-pointer"
          >
            {t('Flip X')}
          </button>
          <button
            type="button"
            onClick={() => {
              const nextProps = [...map.props];
              for (const idx of selection.props) {
                const p = nextProps[idx];
                if (!p) continue;
                const oldCenter = computePropQuadCenter(p);
                const { raw: _raw, ...rest } = p;
                const flipped: PmsProp = { ...rest, scaleY: -p.scaleY };
                const newCenter = computePropQuadCenter(flipped);
                nextProps[idx] = {
                  ...flipped,
                  x: p.x + (oldCenter.x - newCenter.x),
                  y: p.y + (oldCenter.y - newCenter.y),
                };
              }
              onCommitMutation('Flip scenery Y', { ...map, props: nextProps });
            }}
            className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] cursor-pointer"
          >
            {t('Flip Y')}
          </button>
          <button
            type="button"
            onClick={async () => {
              const nextProps = [...map.props];
              let changed = false;
              for (const idx of selection.props) {
                const p = nextProps[idx];
                const scName = map.scenery[p?.style - 1]?.filename;
                if (!p || !scName) continue;
                const img = await loadSoldatAssetImage(
                  'scenery-gfx',
                  scName,
                  true,
                  preferClassicBmp,
                  false,
                  mapAssetSource(map)
                );
                if (img && img.width > 0 && img.height > 0) {
                  const { raw: _raw, ...rest } = p;
                  nextProps[idx] = { ...rest, width: img.width, height: img.height };
                  changed = true;
                }
              }
              if (changed && current.current===snapshot) {
                onCommitMutation('Reset scenery image size', { ...map, props: nextProps });
              }
            }}
            title={t('Reset PMS width & height to image dimensions')}
            className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Colorize & Atmosphere Presets */}
        <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
          <SceneryColorTools map={map} indices={selection.props} onCommit={onCommitMutation} />
          <SceneryGradientTools map={map} indices={selection.props} onCommit={onCommitMutation} />
          <SceneryVariationTools map={map} indices={selection.props} onCommit={onCommitMutation} />

          <button
            type="button"
            onClick={() => {
              const p = selectedProps[0];
              const scFile = map.scenery[p.style - 1]?.filename ?? placement.sceneryFilename;
              onChangePlacement({
                ...placement,
                sceneryFilename: scFile,
                sceneryLevel: (p.level === 0 || p.level === 1 || p.level === 2
                  ? p.level
                  : 1) as 0 | 1 | 2,
                sceneryScaleX: p.scaleX,
                sceneryScaleY: p.scaleY,
                sceneryRotationDeg: Number(((-p.rotation * 180) / Math.PI).toFixed(1)),
                sceneryAlpha: p.alpha,
                sceneryTint: { ...p.color, a: 255 },
              });
            }}
            className="w-full py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-medium cursor-pointer"
          >
            {t('Copy Style to Scenery Stamp')}
          </button>
        </div>
      </PanelCard>
    )}

  </>;
}
