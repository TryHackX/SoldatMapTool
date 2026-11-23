import { useId, useState } from 'react';
import { ArrowUpRight, Timer } from 'lucide-react';
import { locale, t } from '../../i18n';
import type { TunnelRunSplit, TunnelTrialResult } from '../tunnelTrial';

interface Props {
  trial: TunnelTrialResult;
  reference?: TunnelTrialResult;
  referenceKind?: 'previous' | 'current-route';
  onChooseVariant?: (knotIndex:number, point?:{x:number;y:number}) => void;
}

const seconds = new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
const clockSeconds = new Intl.NumberFormat(locale,{minimumIntegerDigits:2,minimumFractionDigits:2,maximumFractionDigits:2});
const centiseconds = (ticks: number) => Math.round(ticks * 100 / 60);
const duration = (cs:number) => t('{s} s',{s:seconds.format(cs/100)});
const clock = (cs:number) => Math.floor(cs/6000) + ':' + clockSeconds.format(cs%6000/100);
const signed = (cs:number) => (cs>0 ? '+' : cs<0 ? '−' : '') + duration(Math.abs(cs));
const range = (s:TunnelRunSplit) => s.knotIndex === s.lastKnotIndex ? String(s.knotIndex) : s.knotIndex+'–'+s.lastKnotIndex;

function rowsFor(splits:TunnelRunSplit[], previous:TunnelRunSplit[] = []) {
  const prior = new Map(previous.map(s=>[s.knotIndex,s]));
  return splits.map(split=>{
    const before = prior.get(split.knotIndex);
    const time = split.ticks === undefined ? undefined : centiseconds(split.ticks);
    const delta = split.status==='complete' && time!==undefined && before?.status==='complete' &&
      before.lastKnotIndex===split.lastKnotIndex && before.ticks!==undefined ? time-centiseconds(before.ticks) : undefined;
    return {split,time,delta};
  });
}
type Row = ReturnType<typeof rowsFor>[number];
type Sort = 'route' | 'longest' | 'loss';

function SummaryLink({row, label, value, tied, onChooseVariant, warning}:
  {row:Row; label:string; value:string; tied?:number; onChooseVariant?:Props['onChooseVariant']; warning?:boolean}) {
  const {split} = row;
  const content = <>
    <span className={'block text-[11px] '+(warning ? 'text-amber-200' : 'text-zinc-400')}>{label}</span>
    <span className="flex items-center gap-1.5">
      <strong>{t('Section {n}',{n:range(split)})}</strong>
      {tied && tied>1 ? <span className="text-[10px] text-zinc-400">{t('({n} tied)',{n:tied})}</span> : null}
      <span className="ml-auto font-mono tabular-nums">{value}</span>
      {onChooseVariant && <ArrowUpRight size={13} aria-hidden="true" className="text-cyan-300"/>}
    </span>
  </>;
  const style = 'block w-full rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-left';
  return onChooseVariant ? <button type="button" className={style+' hover:border-cyan-500 focus-visible:outline-cyan-300'}
    aria-label={t('{label}. Compare variants for section {n}',{label,n:split.knotIndex})}
    onClick={()=>onChooseVariant(split.knotIndex,split.status==='stopped' ? split.point : undefined)}>{content}</button>
    : <div className={style}>{content}</div>;
}

function SplitTable({rows, comparison, onChooseVariant}:{rows:Row[]; comparison:boolean; onChooseVariant?:Props['onChooseVariant']}) {
  const [sort,setSort] = useState<Sort>('route');
  const selectedSort = sort==='loss' && !comparison ? 'route' : sort;
  const ordered = [...rows];
  if (selectedSort!=='route') {
    const score = ({delta,time,split}:Row) => selectedSort==='loss' ? delta ?? -Infinity : split.status==='complete' ? time ?? -Infinity : -Infinity;
    ordered.sort((a,b)=>score(b)-score(a) || a.split.knotIndex-b.split.knotIndex);
  }
  return <details className="rounded-md border border-zinc-700">
    <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-zinc-200">{t('All splits ({n})',{n:rows.length})}</summary>
    <label className="mx-2 mb-2 flex items-center gap-1.5 text-[11px] text-zinc-400">{t('Sort splits')}
      <select className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-zinc-200"
        value={selectedSort} onChange={e=>setSort(e.target.value as Sort)}>
        <option value="route">{t('Route order')}</option>
        <option value="longest">{t('Longest first')}</option>
        {comparison && <option value="loss">{t('Most time lost first')}</option>}
      </select>
    </label>
    {rows.some(r=>r.split.lastKnotIndex!==r.split.knotIndex) &&
      <p className="mx-2 mb-2 text-[10px] text-zinc-400">{t('Sections sharing a checkpoint have one combined time.')}</p>}
    <div className="max-h-72 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-right text-[11px]">
        <thead className="sticky top-0 bg-zinc-900 text-[10px] text-zinc-400"><tr>
          <th scope="col" className="px-2 py-1 text-left">{t('Section')}</th>
          <th scope="col" className="px-1">{t('Split time')}</th><th scope="col" className="px-1">{t('From start')}</th>
          {comparison && <th scope="col" className="pr-2">{t('Change')}</th>}
        </tr></thead>
        <tbody>{ordered.map(({split,time,delta})=><tr key={split.knotIndex} className="even:bg-zinc-950/60">
          <th scope="row" className="px-2 py-1 text-left font-medium">
            {onChooseVariant && split.status!=='unreached' ? <span className="inline-flex flex-wrap gap-x-1">
              {Array.from({length:split.lastKnotIndex-split.knotIndex+1},(_,i)=>split.knotIndex+i).map(knot=>
                <button key={knot} type="button" aria-label={t('Compare variants for section {n}',{n:knot})}
                  onClick={()=>onChooseVariant(knot,split.status==='stopped' ? split.point : undefined)}
                  className="inline-flex items-center gap-1 py-0.5 text-cyan-300 hover:underline">
                  #{knot}<ArrowUpRight size={11} aria-hidden="true"/>
                </button>)}
            </span> : '#'+range(split)}
            {split.status==='stopped' && <span className="block text-[10px] text-amber-200">{t('Stopped here')}</span>}
            {split.status==='unreached' && <span className="sr-only">{t('Unreached section')}</span>}
          </th>
          <td className="whitespace-nowrap px-1 font-mono">{time===undefined ? '—' : duration(time)}</td>
          <td className="whitespace-nowrap px-1 font-mono">{split.cumulativeTicks===undefined ? '—' : clock(centiseconds(split.cumulativeTicks))}</td>
          {comparison && <td className={'whitespace-nowrap pr-2 font-mono '+(delta===undefined || delta===0 ? 'text-zinc-500' :
            delta>0 ? 'text-amber-200' : 'text-emerald-300')}>{delta===undefined ? '—' : signed(delta)}</td>}
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export function TunnelRunSplits({trial,reference,referenceKind='previous',onChooseVariant}:Props) {
  const heading = useId();
  if (!trial.splits?.length) return null;
  const rows = rowsFor(trial.splits,reference?.splits);
  const done = rows.filter(r=>r.split.status==='complete' && r.time!==undefined);
  const stopped = rows.find(r=>r.split.status==='stopped');
  const longest = Math.max(0,...done.map(r=>r.time!));
  const slow = done.filter(r=>r.time===longest);
  const largestLoss = Math.max(0,...done.map(r=>r.delta ?? 0));
  const losses = largestLoss>0 ? done.filter(row=>row.delta===largestLoss) : [];
  const comparison = rows.some(r=>r.delta!==undefined);
  const hasReference = !!reference?.splits?.length;
  const previousTotal = reference?.reached && hasReference ? centiseconds(reference.ticks) : undefined;
  const totalDelta = previousTotal!==undefined && trial.reached ? centiseconds(trial.ticks)-previousTotal : undefined;
  return <section aria-labelledby={heading} className="space-y-2 border-t border-zinc-700 pt-2 text-xs text-zinc-200">
    <h3 id={heading} className="flex items-center gap-1.5 font-semibold"><Timer size={14} aria-hidden="true"/>{t('Full run splits')}</h3>
    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
      <span className="text-[11px] text-zinc-400">{trial.reached ? t('Finish time') : t('Elapsed before stop')}</span>
      <strong className="font-mono tabular-nums">{clock(centiseconds(trial.ticks))}</strong>
    </div>
    {hasReference && reference && <div className="space-y-1 text-[11px] text-zinc-400">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <span>{referenceKind==='previous' ? t('Previous full run') : t('Current route')}</span>
        <span className="font-mono">{previousTotal!==undefined ? clock(previousTotal) :
          t('Stopped at {time}',{time:clock(centiseconds(reference.ticks))})}</span>
      </div>
      {totalDelta!==undefined && <div className="flex items-baseline justify-between gap-1"><span>{t('Finish time change')}</span>
        <span className="font-mono text-zinc-200">{signed(totalDelta)}</span></div>}
    </div>}
    {stopped && <SummaryLink row={stopped} label={trial.reason==='budget' ? t('Pilot reached the search limit here') : t('Pilot stopped here')}
      value={stopped.time===undefined ? '—' : t('{s} s spent',{s:seconds.format(stopped.time/100)})} warning onChooseVariant={onChooseVariant}/>}
    {losses.length>0 && <SummaryLink row={losses[0]} label={t('Largest time loss')} value={signed(largestLoss)}
      tied={losses.length} warning onChooseVariant={onChooseVariant}/>}
    {comparison && !losses.length && <div className="text-[11px] text-zinc-400">{t('No comparable completed section took longer.')}</div>}
    {slow.length>0 && <SummaryLink row={slow[0]} label={t('Longest completed section')} value={duration(longest)}
      tied={slow.length} onChooseVariant={onChooseVariant}/>}
    {onChooseVariant && <p className="text-[11px] text-zinc-400">{t('Select a section to compare its variants on the map.')}</p>}
    <SplitTable rows={rows} comparison={comparison} onChooseVariant={onChooseVariant}/>
  </section>;
}
