import { useEffect, useRef, useState } from 'react';
import { Footprints, Flag, Route } from 'lucide-react';
import type { TunnelPoint, TunnelResult, TunnelSettings } from '@shared/climbTunnel';
import type { TunnelVariantProgress, TunnelVariantResult } from '../tunnelVariant';
import { createDraftTrialMap } from '../tunnelBlueprint';
import type { PmsMapData } from '@shared/pmsParser';
import type { ChamberKind } from '@shared/tunnelChambers';
import type { TunnelTrialResult } from '../tunnelTrial';
import { drawTunnelPreview } from './drawTunnelPreview';
import { describeTrial, startTrial } from './tunnelTrialJob';
import { locale, t } from '../../i18n';

const seconds = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const roomNames: Record<ChamberKind, string> = {
  alcove: 'Alcove', gallery: 'Long gallery', shaft: 'Shaft', ice: 'Ice passage', rest: 'Rest landing',
};

type Trial = TunnelTrialResult;
const issues = {
  short: 'Draw a longer route between start and finish.',
  tight: 'This turn is too tight. Move a knot or reduce the tunnel width.',
  crossing: 'The route crosses itself. Move a knot to separate the passages.',
  limit: 'The tunnel exceeds the PMS geometry limit. Shorten the route.',
};
interface PreviewProps {
  draft: TunnelResult;
  settings: TunnelSettings;
  path?: TunnelPoint[];
  contextMap?: PmsMapData;
  markers?: boolean;
  onChooseSeed: (seed: number) => void;
}

export function TunnelPreview({ draft, settings, path, contextMap, markers, onChooseSeed }: PreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const job = useRef<Worker | null>(null);
  const [line, setLine] = useState(false);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'searching' | 'error' | 'limit'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [variant, setVariant] = useState<TunnelVariantResult | null>(null);
  const accepted = useRef<{ seed: number; trial: Trial } | null>(null);
  useEffect(() => {
    setTrial(accepted.current?.seed === settings.seed ? accepted.current.trial : null);
    accepted.current = null;
    setVariant(null);
    setState('idle');
    return () => { job.current?.terminate(); job.current = null; };
  }, [draft, contextMap, settings.seed, markers]);
  useEffect(() => { if (canvas.current) drawTunnelPreview(canvas.current, draft, line, trial, contextMap); }, [draft, line, trial, contextMap]);
  function run() {
    job.current?.terminate();
    setTrial(null); setVariant(null); setState('busy');
    try {
      const map = createDraftTrialMap(draft, settings, contextMap, markers);
      if (!map) { setState('limit'); return; }
      job.current = startTrial({ map, centerline: draft.centerline, footholds: draft.footholds }, (trial, worker) => {
        if (job.current !== worker) return;
        job.current = null;
        setTrial(trial); setState('idle');
      }, worker => {
        if (job.current === worker) { job.current = null; setState('error'); }
      });
    } catch { job.current?.terminate(); job.current = null; setState('error'); }
  }
  function findVariant() {
    job.current?.terminate();
    setVariant(null);
    setAttempt(0);
    setState('searching');
    try {
      const worker = new Worker(new URL('../tunnelTrial.worker.ts', import.meta.url), { type: 'module' });
      job.current = worker;
      worker.onmessage = (event: MessageEvent<TunnelVariantProgress | TunnelVariantResult>) => {
        if (job.current !== worker) return;
        if (event.data.kind === 'variant-progress') {
          setAttempt(event.data.attempted);
          return;
        }
        setVariant(event.data);
        setState('idle');
        worker.terminate();
        job.current = null;
      };
      worker.onerror = worker.onmessageerror = () => {
        if (job.current !== worker) return;
        setState('error');
        worker.terminate();
        job.current = null;
      };
      worker.postMessage({ kind: 'find-variant', settings, path, contextMap, markers });
    } catch {
      job.current?.terminate();
      job.current = null;
      setState('error');
    }
  }
  if (!draft.validation.ok) return <p role="status" className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-200">
    {t(issues[draft.validation.reason ?? 'tight'])}</p>;
  return <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
    <canvas ref={canvas} width={900} height={435} className="block h-auto w-full" aria-label={t('Tunnel terrain preview')} />
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px] text-zinc-300">
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-300" /> {t('Start')}
        <Flag size={11} className="ml-2 text-sky-300" />{t('Finish')}</span>
      <button type="button" aria-pressed={line} onClick={() => setLine(!line)} className={line ? 'text-cyan-300' : 'text-zinc-400'}><Route size={13} className="mr-1 inline" />{t('Route axis')}</button>
    </div>
    <div className="border-t border-zinc-800 px-3 py-2 space-y-1.5">
      {contextMap && (contextMap.polygons.length > 0 || contextMap.colliders.length > 0) &&
        <p className="text-[11px] text-stone-300">{t('Beige shows terrain and colliders already on the map.')}</p>}
      <div className="text-[11px] text-zinc-400">{t('{n} polygons · minimum clearance {w} u', { n: draft.polygons.length, w: draft.validation.minClearance })}</div>
      {draft.chamberReport && <details className="text-[11px] text-zinc-400">
        <summary className="cursor-pointer">{t('{n} chambers · {d} marking polygons',
          {n: draft.chamberReport.rooms.length, d: draft.chamberReport.decorations})}</summary>
        <ol className="mt-1 max-h-36 overflow-auto">{draft.chamberReport.rooms.map(r =>
          <li key={r.start} className="flex justify-between gap-2"><span>{t(roomNames[r.kind])}</span>
            <span className="tabular-nums">{Math.round(r.start)}–{Math.round(r.end)} u</span></li>)}</ol>
      </details>}
    </div>
    <section aria-label={t('Pilot run')} className="space-y-2 border-t border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200"><Footprints size={14} />{t('Pilot run')}</h4>
      <p role="status" className={'text-xs ' + (trial?.reached ? 'text-emerald-300' : trial || state === 'error' || state === 'limit' ? 'text-amber-300' : 'text-zinc-300')}>
        {state === 'busy' ? t('Simulating movement…') : state === 'error' ? t('Movement simulation unavailable.') :
          state === 'limit' ? t('The tunnel and the open map exceed the PMS limits.') :
          trial ? describeTrial(trial, !!contextMap && markers === false) : t('The pilot has not checked this route yet.')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={state === 'busy' || state === 'searching'} onClick={run}
          className="rounded border border-emerald-700 bg-emerald-950 px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900 disabled:opacity-50">
          {contextMap && markers === false ? t('Check between sketch endpoints') : t('Check from start to flag')}
        </button>
        {(state === 'busy' || state === 'searching') && <button type="button" onClick={() => {
          job.current?.terminate(); job.current = null; setState('idle');
        }} className="px-2 text-xs text-zinc-300">{t('Cancel')}</button>}
      </div>
      {trial && (trial.reason === 'budget' || trial.reason === 'pilot-stalled') && !variant &&
        <button type="button" onClick={findVariant} disabled={state === 'searching'}
          className="text-left text-xs text-cyan-300 disabled:text-zinc-400">
          {state === 'searching' ? t('Testing variant {n} of 4…', { n: Math.max(1, attempt) }) : t('Find a variant the model can finish')}
        </button>}
      {variant && <div aria-live="polite" className="text-[11px] text-zinc-300">
        {variant.trial && variant.seed !== undefined ?
          <button type="button" className="text-cyan-300 underline" onClick={() => {
            if (!variant.trial || variant.seed === undefined) return;
            accepted.current = { seed: variant.seed, trial: variant.trial };
            onChooseSeed(variant.seed);
          }}>{t('Use tested seed {seed} ({s} s)', { seed: variant.seed, s: seconds.format(variant.trial.ticks / 60) })}</button> :
          t('The model stopped in all {n} variants. Try moving a bend or widening the tunnel.', { n: variant.attempted })}
      </div>}
    </section>
  </div>;
}
