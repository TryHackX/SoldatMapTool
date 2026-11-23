import { useEffect, useRef } from 'react';
import type { TunnelPoint } from '@shared/climbTunnel';
import type { PaceSettings } from '@shared/tunnelPace';
import type { TunnelProject } from '@shared/tunnelProject';
import { locale, t } from '../../i18n';
import type { PaceResult } from '../tunnelPacePlanner';
import type { TunnelTrialResult } from '../tunnelTrial';
import { describeTrial } from './tunnelTrialJob';
import { formatTargetTime } from './TunnelPaceControls';
import { TunnelRunSplits } from './TunnelRunSplits';

const seconds = new Intl.NumberFormat(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const clockSeconds = new Intl.NumberFormat(locale, {minimumIntegerDigits: 2, minimumFractionDigits: 2, maximumFractionDigits: 2});
const styles = {chamber:'Chamber', pinch:'Pinch', step:'Stepped landing', spring:'Spring landing'} as const;

function runTime(trial: TunnelTrialResult) {
  if (!trial.reached) return t('Unconfirmed');
  const cs = Math.round(trial.ticks * 100 / 60);
  return Math.floor(cs / 6000) + ':' + clockSeconds.format((cs % 6000) / 100);
}

function RunTrace({project,trial}: {project:TunnelProject; trial:TunnelTrialResult}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !canvas.current || !trial.trace.length) return;
    const {width,height} = canvas.current;
    const axis = project.knots;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const p of [...axis,...trial.trace]) {
      left = Math.min(left,p.x); right = Math.max(right,p.x);
      top = Math.min(top,p.y); bottom = Math.max(bottom,p.y);
    }
    const scale = Math.min((width-30)/Math.max(1,right-left), (height-24)/Math.max(1,bottom-top));
    const x = (p: TunnelPoint) => width / 2 + (p.x - (left+right)/2)*scale;
    const y = (p: TunnelPoint) => height / 2 + (p.y - (top+bottom)/2)*scale;
    ctx.clearRect(0,0,width,height);
    ctx.lineJoin = 'round';
    const line = (points: readonly TunnelPoint[], colour: string, size: number) => {
      ctx.strokeStyle = colour; ctx.lineWidth = size; ctx.beginPath();
      points.forEach((p,i)=>i ? ctx.lineTo(x(p),y(p)) : ctx.moveTo(x(p),y(p)));
      ctx.stroke();
    };
    line(axis, '#475569', 5);
    line(trial.trace, trial.reached ? '#6ee7b7' : '#fbbf24', 2.5);
    for (const [p,colour] of [[trial.trace[0], '#fda4af'], [trial.trace.at(-1)!, trial.reached ? '#93c5fd' : '#fbbf24']] as const) {
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x(p),y(p),5,0,Math.PI*2); ctx.fill();
    }
  },[project,trial]);
  if (!trial.trace.length) return null;
  return <figure className="space-y-1">
    <canvas ref={canvas} width={520} height={166} className="block w-full rounded-md bg-zinc-950"
      role="img" aria-label={t('Route axis and simulated movement through the tunnel')}/>
    <figcaption className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
      <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rose-300"/>{t('Start')}</span>
      <span>{t('Pilot trace')}</span>
      <span className="inline-flex items-center gap-1">{trial.reached ? t('Finish') : t('Stopping point')}
        <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full '+(trial.reached?'bg-blue-300':'bg-amber-300')}/></span>
    </figcaption>
  </figure>;
}

export function TunnelPaceReport({project,result,settings,onReviewCurrent}: {project:TunnelProject; result:PaceResult; settings:PaceSettings;
  onReviewCurrent?:(trial:TunnelTrialResult,knotIndex:number,point?:TunnelPoint)=>void}) {
  const {trial,baseline,changes} = result;
  const passed = trial.reached && !result.usesSketchEnds;
  const difference = trial.ticks / 60 - settings.targetSeconds;
  const signed = difference < 0 ? t('{s} s under target',{s:seconds.format(-difference)})
    : difference > 0 ? t('{s} s over target',{s:seconds.format(difference)}) : t('Exact target time');
  return <div className="space-y-2.5">
    <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-2.5">
      <div><div className="text-[11px] text-zinc-400">{t('Current route')}</div>
        <div title={describeTrial(baseline)} className="font-mono text-zinc-200">{runTime(baseline)}</div></div>
      <div><div className="text-[11px] text-zinc-400">{t('Planned route')}</div>
        <div className={'font-mono '+(passed ? 'text-emerald-300' : 'text-amber-200')}>{passed ? runTime(trial) : t('Unconfirmed')}</div></div>
      {passed && <div className="col-span-2 border-t border-zinc-800 pt-1.5 text-[11px]">
        <div className={result.withinTarget ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-200'}>
          {result.withinTarget ? t('Within target range') : t('Outside target range')}
        </div>
        <div>{signed}</div>
        <div className="text-zinc-400">{t('Goal {time} · tolerance ±{s} s',{time:formatTargetTime(settings.targetSeconds),s:seconds.format(result.toleranceSeconds)})}</div>
      </div>}
    </div>
    {!passed && <p role="status" className="text-amber-200">
      {result.usesSketchEnds || trial.reason==='missing-spawn' || trial.reason==='missing-flag'
        ? t('Place an active Alpha spawn and Bravo flag on this route to measure a full run.') : describeTrial(trial)}
    </p>}
    <RunTrace project={project} trial={trial}/>
    <TunnelRunSplits trial={trial} reference={changes.length ? baseline : undefined} referenceKind="current-route"
      onChooseVariant={!changes.length && onReviewCurrent ? (k,p)=>onReviewCurrent(trial,k,p) : undefined}/>
    {changes.length>0 && !!baseline.splits?.length && <details className="rounded-md border border-zinc-700 px-2 py-1.5">
      <summary className="cursor-pointer text-xs font-medium">{t('Splits on the current map')}</summary>
      {passed && <p className="mt-1 text-[11px] text-zinc-400">{t('Apply the plan to edit the proposed sections.')}</p>}
      <TunnelRunSplits trial={baseline}
        onChooseVariant={onReviewCurrent ? (k,p)=>onReviewCurrent(baseline,k,p) : undefined}/>
    </details>}
    <p className="text-[11px] text-zinc-400">{t('Sections tested: {sections} · variants tested: {variants} · full runs: {runs}',
      {sections:result.checkedSections,variants:result.checkedVariants,runs:result.fullRuns})}</p>
    {changes.length ? <details className="rounded-md border border-zinc-700 px-2 py-1.5">
      <summary className="cursor-pointer text-xs font-medium text-zinc-200">{t('Selected sections ({n})',{n:changes.length})}</summary>
      <p className="mt-1 text-[11px] text-zinc-400">{t('Local times are measured between section gates. Difficulty is relative to the alternatives at that point.')}</p>
      <ol className="mt-2 divide-y divide-zinc-800">
        {changes.map(row=><li key={row.knotIndex} className="flex items-baseline justify-between gap-1.5 py-1">
          <div><span className="font-mono text-zinc-400">#{row.knotIndex} </span>{t(styles[row.style])}
            <div className="text-[10px] text-zinc-400">{t('Relative difficulty {n}/100',{n:Math.round(row.difficulty*100)})}</div>
          </div>
          <span className="shrink-0 font-mono text-[11px] text-zinc-300">{t('{s} s',{s:seconds.format(row.localSeconds)})}</span>
        </li>)}
      </ol>
    </details> : passed && <p className="text-[11px] text-zinc-400">{t('The planner kept the existing sections.')}</p>}
  </div>;
}
