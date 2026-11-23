import { useEffect, useRef, useState } from 'react';
import { Flag, LoaderCircle, Timer } from 'lucide-react';
import type { PmsMapData } from '@shared/pmsParser';
import type { PaceSettings } from '@shared/tunnelPace';
import type { TunnelProject } from '@shared/tunnelProject';
import { locale, t } from '../../i18n';
import { startTunnelPacePlan } from '../tunnelPaceJob';
import type { PaceProgress, PaceResult } from '../tunnelPacePlanner';
import type { TunnelTrialResult } from '../tunnelTrial';
import { formatTargetTime, paceField, parseTargetSeconds, TunnelPaceControls } from './TunnelPaceControls';
import { TunnelPaceReport } from './TunnelPaceReport';

interface Props {
  map: PmsMapData;
  project: TunnelProject;
  locked: boolean;
  onApply: (result: PaceResult, settings: PaceSettings) => void;
  onClose: () => void;
  onReviewCurrent?: (trial:TunnelTrialResult,knotIndex:number,point?:{x:number;y:number}) => void;
}

const primary = 'flex-1 rounded-md bg-cyan-400 px-2.5 py-2 font-semibold text-zinc-950 hover:bg-cyan-300 disabled:bg-zinc-800 disabled:text-zinc-500';
const secondary = 'rounded-md border border-zinc-700 px-2.5 py-2 text-zinc-200 hover:bg-zinc-800';
const maxSeed = 0x7fffffff;
const elapsed = new Intl.NumberFormat(locale, {minimumFractionDigits:2,maximumFractionDigits:2});

function initialSettings(project: TunnelProject): PaceSettings {
  return project.pace ?? {targetSeconds:60,profile:'progressive',seed:project.settings.seed & maxSeed};
}

interface Completed {
  map: PmsMapData;
  project: TunnelProject;
  settings: PaceSettings;
  result: PaceResult;
}

function progressLabel(progress: PaceProgress) {
  if (progress.phase === 'baseline') return t('Timing the current route from spawn to flag…');
  if (progress.phase === 'sections') return t('Testing sections · {n} of {total}',{n:progress.completed,total:progress.total});
  return t('Timing full routes · {n} of {total}',{n:progress.completed,total:progress.total});
}

export function TunnelPacePanel({map,project,locked,onApply,onClose,onReviewCurrent}: Props) {
  const [target,setTarget] = useState(()=>formatTargetTime(initialSettings(project).targetSeconds));
  const [profile,setProfile] = useState(()=>initialSettings(project).profile);
  const [seed,setSeed] = useState(()=>String(initialSettings(project).seed));
  const [progress,setProgress] = useState<PaceProgress | null>(null);
  const [completed,setCompleted] = useState<Completed | null>(null);
  const [error,setError] = useState(false);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const targetSeconds = parseTargetSeconds(target);
  const validSeed = /^\d+$/.test(seed) && Number(seed) <= maxSeed;
  const outcome = completed?.map === map && completed.project === project ? completed : null;

  useEffect(() => {
    const defaults = initialSettings(project);
    setTarget(formatTargetTime(defaults.targetSeconds));
    setProfile(defaults.profile);
    setSeed(String(defaults.seed));
    setProgress(null);
    setCompleted(null);
    setError(false);
    return () => {
      sequence.current++;
      worker.current?.terminate();
      worker.current = null;
    };
  },[map,project]);

  function clearResult() {
    setError(false);
    setCompleted(null);
  }

  function stop() {
    sequence.current++;
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  }

  function run() {
    if (worker.current || targetSeconds === null || !validSeed) return;
    const token = ++sequence.current;
    const settings = {targetSeconds,profile,seed:Number(seed)};
    clearResult();
    setProgress({phase:'baseline',completed:0,total:1});
    const fail = () => {
      if (token !== sequence.current) return;
      worker.current = null;
      setError(true);
      setProgress(null);
    };
    try {
      worker.current = startTunnelPacePlan({map,project,settings},
        event=>{ if (token===sequence.current) setProgress(event); },
        result=>{
          if (token!==sequence.current) return;
          worker.current = null;
          setProgress(null);
          setCompleted({map,project,settings,result});
        },fail);
    } catch { fail(); }
  }

  const reached = outcome?.result.trial.reached && !outcome.result.usesSketchEnds;
  const settingsChanged = outcome && (outcome.settings.targetSeconds !== project.pace?.targetSeconds ||
    outcome.settings.profile !== project.pace?.profile || outcome.settings.seed !== project.pace?.seed);
  const canApply = !!(reached && (outcome?.result.changes.length || settingsChanged) && !locked);
  return <section aria-label={t('Route time planner')} className="space-y-3 text-xs text-zinc-200">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Timer size={16} aria-hidden="true"/>{t('Route time planner')}</h2>
    <p className="text-[11px] leading-relaxed text-zinc-400">{t('Choose a finish time and difficulty curve. The pilot tests the assembled route from spawn to flag.')}</p>
    <form className="space-y-2.5" onSubmit={event=>{event.preventDefault();run();}}>
      <TunnelPaceControls target={target} profile={profile} disabled={!!progress}
        onTargetChange={v=>{setTarget(v);clearResult();}} onProfileChange={v=>{setProfile(v);clearResult();}}/>
      <label className="block space-y-1">
        <span>{t('Seed')}</span>
        <input type="number" min={0} max={maxSeed} step={1} value={seed} disabled={!!progress}
          aria-invalid={!validSeed} onChange={event=>{setSeed(event.target.value);clearResult();}} className={paceField+' font-mono'}/>
      </label>
      <div className="flex gap-1.5">
        <button type="submit" disabled={!!progress || targetSeconds===null || !validSeed}
          className={primary+' inline-flex items-center justify-center gap-1.5'}>
          {progress ? <LoaderCircle aria-hidden="true" size={13} className="animate-spin"/> : <Flag aria-hidden="true" size={13}/>}
          {t('Plan and test route')}
        </button>
        {progress && <button type="button" className={secondary} onClick={stop}>{t('Cancel')}</button>}
      </div>
    </form>
    {progress && <div role="status" className="text-[11px] text-cyan-200">
      {progressLabel(progress)}
      {progress.trialSeconds !== undefined && <div>{t('Last finish: {s} s',{s:elapsed.format(progress.trialSeconds)})}</div>}
      {progress.stoppedAt !== undefined && <div>{t('Model stopped at {n}% of the route.',{n:Math.round(progress.stoppedAt*100)})}</div>}
      {progress.total > 0 && <progress value={progress.completed} max={progress.total}
        aria-label={progressLabel(progress)} className="mt-1 block h-1 w-full accent-cyan-400"/>}
    </div>}
    {error && <p role="alert" className="text-amber-200">{t('The planner stopped before a full result was available. Run it again to retry.')}</p>}
    {outcome && <TunnelPaceReport project={project} settings={outcome.settings} result={outcome.result}
      onReviewCurrent={onReviewCurrent}/>}
    {locked && <p className="text-[11px] text-amber-200">{t('Unlock polygons to apply the route plan.')}</p>}
    <div className="sticky bottom-0 flex gap-1.5 bg-zinc-900 py-1">
      <button type="button" className={secondary} onClick={onClose}>{t('Back to editing')}</button>
      {outcome && <button type="button" className={primary} disabled={!canApply} onClick={()=>{
        if (canApply) onApply(outcome.result,outcome.settings);
      }}>{outcome.result.changes.length ? t('Apply route plan') : t('Save time settings')}</button>}
    </div>
  </section>;
}
