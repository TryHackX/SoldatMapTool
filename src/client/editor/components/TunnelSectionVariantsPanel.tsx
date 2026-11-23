import { useEffect, useId, useRef, useState } from 'react';
import { Check, CircleHelp, CircleX, Dice5, LoaderCircle, Play } from 'lucide-react';
import type { PmsMapData } from '@shared/pmsParser';
import type { TunnelProject } from '@shared/tunnelProject';
import { locale, t } from '../../i18n';
import { startSectionVariantTrials, type SectionVariantReport } from '../sectionVariantTrials';
import type { TunnelTrialResult } from '../tunnelTrial';

interface Props {
  map: PmsMapData;
  project: TunnelProject;
  knotIndex: number;
  locked: boolean;
  selected: SectionVariantReport | null;
  recheckRoute?: boolean;
  fromSplit?: boolean;
  onPreview: (variant: SectionVariantReport | null) => void;
  onApply: (variant: SectionVariantReport) => void;
  onClose: () => void;
}

interface Batch {
  phase: 'running' | 'complete' | 'stopped' | 'error';
  baseline?: TunnelTrialResult;
  candidates: SectionVariantReport[];
}

const styles = {
  chamber: 'Chamber', pinch: 'Pinch', step: 'Stepped landing', spring: 'Spring landing',
} as const;
const rejections = {
  clearance: 'Too little clearance', manual: 'Manually edited terrain',
  neighbour: 'Would cut into another passage', unchanged: 'Same geometry', invalid: 'Invalid geometry',
  'no-landing': 'No editable landing',
} as const;
const field = 'mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-400 disabled:opacity-50';
const secondary = 'rounded-md border border-zinc-700 px-2 py-1.5 text-zinc-200 hover:bg-zinc-800 disabled:opacity-40';
const time = new Intl.NumberFormat(locale, {minimumFractionDigits:2, maximumFractionDigits:2});
const number = new Intl.NumberFormat(locale, {maximumFractionDigits:2});
const maxSeed = 0x7fffffff;

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0] & maxSeed;
}

function centiseconds(trial?: TunnelTrialResult) {
  if (trial?.reached && typeof trial.sectionTicks === 'number' && trial.sectionTicks > 0) return Math.round(trial.sectionTicks * 100 / 60);
}

function differences(report: SectionVariantReport, project: TunnelProject, knotIndex: number) {
  const change = report.change, original = project.sections[knotIndex - 1];
  const width = (change.widthOffset ?? original.widthOffset ?? 0) - (original.widthOffset ?? 0);
  const lift = (change.landingHeight ?? original.landingHeight) - original.landingHeight;
  const bend = change.point && Math.hypot(change.point.x - project.knots[knotIndex].x, change.point.y - project.knots[knotIndex].y);
  const signed = (v: number) => (v > 0 ? '+' : '') + number.format(v);
  const values: string[] = [];
  if (width) values.push(t('Width {delta}', {delta:signed(width)}));
  if (lift) values.push(t('Landing {delta}', {delta:signed(lift)}));
  if (bend) values.push(t('Bend shift {n}', {n:number.format(bend)}));
  if (change.bounce !== undefined && change.bounce !== original.bounce) {
    values.push(change.bounce ? t('Bounce {n}×',{n:number.format(change.bounce)}) :
      change.bounce === null ? t('Generated material') : t('Normal ground'));
  }
  return values.join(' · ');
}

function trialStatus(trial?: TunnelTrialResult) {
  if (!trial) return t('Awaiting trial');
  if (trial.reached) return t('Model passed');
  if (trial.reason === 'budget') return t('Unconfirmed · search limit');
  if (trial.reason === 'no-run-up') return t('Unconfirmed · no safe start');
  if (trial.reason === 'invalid-route' || trial.reason === 'missing-spawn' || trial.reason === 'missing-flag') return t('No valid trial');
  return t('Unconfirmed · model stopped');
}

interface ResultRowProps {
  name: string;
  group: string;
  current: boolean;
  trial?: TunnelTrialResult;
  rejection?: SectionVariantReport['reason'];
  summary?: string;
  referenceTime?: number;
  fastest?: boolean;
  onSelect: () => void;
}

function ResultRow({name,group,current,trial,rejection,summary,referenceTime,fastest,onSelect}: ResultRowProps) {
  const description = useId();
  const elapsed = centiseconds(trial);
  const delta = elapsed !== undefined && referenceTime !== undefined ? elapsed - referenceTime : undefined;
  const Icon = rejection ? CircleX : trial?.reached ? Check : CircleHelp;
  return <label className={'block rounded-md border px-2.5 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300 ' +
    (rejection ? 'border-zinc-800 text-zinc-400' : current ? 'cursor-pointer border-cyan-500 bg-cyan-950/40' : 'cursor-pointer border-zinc-700 bg-zinc-950/60 hover:border-zinc-500')}>
    <input type="radio" name={group} aria-label={name}
      aria-describedby={[description, elapsed !== undefined ? description+'-time' : '', summary ? description+'-details' : ''].filter(Boolean).join(' ')} checked={current}
      disabled={!!rejection} onChange={onSelect} className="sr-only"/>
    <span className="flex items-start justify-between gap-1.5">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true" className={'h-2 w-2 shrink-0 rounded-full border ' + (current ? 'border-cyan-300 bg-cyan-300' : 'border-zinc-600')}/>
          {name}
        </span>
        <span id={description} className={'mt-0.5 flex items-start gap-1 text-[11px] ' + (rejection || !trial?.reached ? 'text-amber-200' : 'text-emerald-300')}>
          <Icon size={12} className="mt-0.5 shrink-0" aria-hidden="true"/>
          {rejection ? t(rejections[rejection]) : trialStatus(trial)}
        </span>
      </span>
      {elapsed !== undefined && <span id={description+'-time'} className="shrink-0 text-right font-mono tabular-nums">
        {fastest && <span className="block text-[10px] font-sans text-emerald-300">{t('Fastest variant')}</span>}
        <span className="text-zinc-100">{t('{s} s', {s:time.format(elapsed / 100)})}</span>
        {delta !== undefined && <span className="block text-[10px] text-zinc-400" title={t('Difference from current section')}>
          {delta ? t('{s} s', {s:(delta > 0 ? '+' : '−') + time.format(Math.abs(delta) / 100)}) : t('Same time')}
        </span>}
      </span>}
    </span>
    {summary && <span id={description+'-details'} className="mt-1 block text-[11px] leading-snug text-zinc-400">{summary}</span>}
  </label>;
}

export function TunnelSectionVariantsPanel({map,project,knotIndex,locked,selected,recheckRoute,fromSplit,onPreview,onApply,onClose}: Props) {
  const [count,setCount] = useState(4);
  const [seed,setSeed] = useState(() => String(randomSeed()));
  const [batch,setBatch] = useState<Batch | null>(null);
  const job = useRef<Worker | null>(null);
  const generation = useRef(0);
  const group = useId();
  const working = batch?.phase === 'running';
  const validSeed = /^\d+$/.test(seed) && Number(seed) <= maxSeed;

  useEffect(() => {
    if (fromSplit) run(Number(seed));
    else setBatch(null);
    return () => { generation.current++; job.current?.terminate(); job.current = null; };
  }, [map,project,knotIndex,fromSplit]);

  function stop() {
    generation.current++;
    job.current?.terminate();
    job.current = null;
    setBatch(prev => prev && {...prev,phase:'stopped'});
  }

  function run(batchSeed: number) {
    if (job.current || !Number.isInteger(batchSeed) || batchSeed < 0 || batchSeed > maxSeed) return;
    const token = ++generation.current;
    onPreview(null);
    setBatch({phase:'running',candidates:[]});
    function fail() {
      if (token !== generation.current) return;
      job.current = null;
      setBatch(prev => prev && {...prev,phase:'error'});
    }
    try {
      job.current = startSectionVariantTrials({map,project,knotIndex,seed:batchSeed,count}, event => {
        if (token !== generation.current) return;
        if (event.kind === 'baseline') setBatch(prev => prev && {...prev,baseline:event.trial});
        else if (event.kind === 'candidate') setBatch(prev => prev && {...prev,candidates:[...prev.candidates,event.candidate]});
        else if (event.kind === 'done') {
          job.current = null;
          setBatch(prev => prev && {...prev,phase:'complete'});
        }
      }, fail);
    } catch { fail(); }
  }

  function clearResults() {
    setBatch(null);
    onPreview(null);
  }

  function reroll() {
    const next = randomSeed();
    const distinct = next === Number(seed) ? (next + 1) & maxSeed : next;
    setSeed(String(distinct));
    run(distinct);
  }

  const selectedResult = selected && batch?.candidates.find(item => item === selected);
  const times = batch?.candidates.map(item => centiseconds(item.trial)).filter((v): v is number => v !== undefined) ?? [];
  const best = batch?.phase === 'complete' && times.length > 1 ? Math.min(...times) : undefined;
  return <section aria-label={t('Compare section variants')} className="space-y-3 text-xs text-zinc-200">
    {fromSplit && <h3 className="text-sm font-semibold text-cyan-200">{t('Variants for section {n}',{n:knotIndex})}</h3>}
    <p className="text-[11px] leading-relaxed text-zinc-400">{t('The model times each section between the same entry and exit. The run-up is excluded.')}</p>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (validSeed) run(Number(seed)); }}>
      <div className="grid grid-cols-[minmax(4rem,0.7fr)_minmax(0,1fr)] gap-2">
        <label>{t('Variant count')}
          <select value={count} className={field} disabled={working} onChange={e=>{setCount(Number(e.target.value)); clearResults();}}>
            {[2,3,4].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>{t('Seed')}
          <input type="number" min={0} max={maxSeed} step={1} value={seed} className={field+' font-mono'} disabled={working}
            onChange={e=>{setSeed(e.target.value); clearResults();}}/>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" disabled={working || !validSeed} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-cyan-400 px-2 py-2 font-semibold text-zinc-950 hover:bg-cyan-300 disabled:bg-zinc-800 disabled:text-zinc-500">
          {working ? <LoaderCircle size={13} aria-hidden="true" className="animate-spin"/> : <Play size={13} aria-hidden="true"/>}
          {working ? t('Testing variants…') : t('Generate and test')}
        </button>
        {working
          ? <button type="button" className={secondary} onClick={stop}>{t('Stop trials')}</button>
          : <button type="button" className={secondary+' inline-flex items-center gap-1'} onClick={reroll}
              title={t('Generate and test with a new seed')}><Dice5 size={14} aria-hidden="true"/>{t('Reroll')}</button>}
      </div>
    </form>
    {batch && <>
      <div role="status" aria-live="polite" className="text-[11px] text-zinc-400">
        {working ? t('Tested {n} of {total} variants.',{n:batch.candidates.length,total:count})
          : batch.phase==='error' ? t('The variant worker stopped. You can rerun these trials.')
          : batch.phase==='stopped' ? t('Trials stopped. Completed results are available below.')
          : t('Choose a result to preview its terrain on the map.')}
      </div>
      {(batch.baseline || batch.candidates.length > 0) && <fieldset className="min-w-0 space-y-1.5">
        <legend className="sr-only">{t('Choose a section preview')}</legend>
        {batch.baseline && <ResultRow name={t('Current section')} group={group} current={!selectedResult} trial={batch.baseline} onSelect={()=>onPreview(null)}/>}
        {batch.candidates.map(item => <ResultRow key={item.style} name={t(styles[item.style])} group={group}
          current={item === selectedResult} trial={item.trial} rejection={item.reason} referenceTime={centiseconds(batch.baseline)}
          fastest={best !== undefined && centiseconds(item.trial) === best}
          summary={differences(item,project,knotIndex)} onSelect={()=>onPreview(item)}/>)}
      </fieldset>}
    </>}
    {locked && <p className="text-[11px] text-amber-200">{t('Unlock polygons to rebuild this section.')}</p>}
    <div className="sticky bottom-0 flex gap-2 bg-zinc-900 py-1">
      <button type="button" className={secondary} onClick={onClose}>{fromSplit ? t('Back to splits') : t('Back to editing')}</button>
      <button type="button" disabled={locked || !selectedResult || !!selectedResult.reason}
        onClick={()=>{if (!locked && selectedResult && !selectedResult.reason) onApply(selectedResult);}}
        className="flex-1 rounded-md bg-cyan-400 px-2 py-2 font-semibold text-zinc-950 hover:bg-cyan-300 disabled:bg-zinc-800 disabled:text-zinc-500">
        {recheckRoute ? t('Apply and recheck the route') : t('Apply selected variant')}
      </button>
    </div>
  </section>;
}
