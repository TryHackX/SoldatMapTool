import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Footprints, LoaderCircle } from 'lucide-react';
import type { TunnelSettings } from '@shared/climbTunnel';
import type { PaceProfile } from '@shared/tunnelPace';
import type { TimedCourseProgress, TimedCourseResult } from '../timedTunnelCourse';
import type { TimedCourseEvent } from '../timedTunnelCourse.worker';
import { locale, t } from '../../i18n';
import { drawTunnelPreview } from './drawTunnelPreview';
import { TunnelControls } from './TunnelControls';
import { TunnelPaceControls, parseTargetSeconds } from './TunnelPaceControls';
import { TunnelRunSplits } from './TunnelRunSplits';

export interface TimedCourseSelection {course:TimedCourseResult; terrain:TunnelSettings}

interface Props {
  terrain: TunnelSettings;
  setTerrain: Dispatch<SetStateAction<TunnelSettings>>;
  course: TimedCourseResult | null;
  onReady: (value: TimedCourseSelection | null)=>void;
}

const formatSeconds = new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2});

function progressLabel(p: TimedCourseProgress) {
  const counts = {n:p.completed,total:p.total};
  switch (p.phase) {
    case 'length': return t('Measuring route length · attempt {n}/{total}',counts);
    case 'blend': return t('Timing a smaller selection of section edits · {n}/{total}',counts);
    case 'baseline': return t('Measuring the starting course');
    case 'sections': return t('Testing section variants · {n}/{total}',counts);
    case 'verify': return t('Testing complete runs · {n}/{total}',counts);
  }
}

export function NewTimedTunnel({terrain,setTerrain,course,onReady}: Props) {
  const [target,setTarget] = useState('1:00');
  const [profile,setProfile] = useState<PaceProfile>('progressive');
  const [profileLoading,setProfileLoading] = useState(!terrain.profile && terrain.profileSource!=='builtin');
  const [progress,setProgress] = useState<TimedCourseProgress|null>(null);
  const [state,setState] = useState<'idle'|'no-course'|'error'>('idle');
  const job = useRef<Worker|null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const targetSeconds = parseTargetSeconds(target);

  useEffect(() => {
    onReady(null);
    setProgress(null); setState('idle');
    return () => { job.current?.terminate(); job.current = null; };
  },[terrain,target,profile,onReady]);

  useEffect(() => {
    if (!canvas.current || !course) return;
    const map = course.map, project = map.editorTunnels![0];
    drawTunnelPreview(canvas.current,{background:{top:map.bgColorTop,bottom:map.bgColorBtm},
      centerline:project.axis,polygons:map.polygons,spawnpoints:map.spawnpoints},false,course.trial);
  },[course]);

  function stop() {
    job.current?.terminate(); job.current = null; setProgress(null);
  }

  function generate() {
    if (targetSeconds===null || profileLoading || job.current) return;
    onReady(null); setState('idle');
    setProgress({phase:'baseline',completed:0,total:1});
    try {
      const worker = new Worker(new URL('../timedTunnelCourse.worker.ts',import.meta.url),{type:'module'});
      job.current = worker;
      worker.onmessage = ({data}:MessageEvent<TimedCourseEvent>) => {
        if (job.current!==worker) return;
        if (data.kind==='progress') { setProgress(data.progress); return; }
        stop();
        if (data.result) onReady({course:data.result,terrain});
        else setState('no-course');
      };
      worker.onerror = worker.onmessageerror = () => {
        if (worker===job.current) { stop(); setState('error'); }
      };
      worker.postMessage({terrain,pace:{targetSeconds,profile,seed:terrain.seed}});
    } catch { stop(); setState('error'); }
  }

  return <section aria-label={t('Timed climb')} className="grid gap-4 md:grid-cols-[1.13fr_1fr]">
    <div className="space-y-3">
      <TunnelPaceControls target={target} profile={profile} onTargetChange={value=>{onReady(null); setTarget(value);}}
        onProfileChange={value=>{onReady(null); setProfile(value);}} disabled={!!progress}/>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!!progress || profileLoading || targetSeconds===null} onClick={generate}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-400 px-3 py-2 font-semibold text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-400">
          {progress ? <LoaderCircle size={14} className="animate-spin"/> : <Footprints size={14}/>}
          {t('Build and time course')}
        </button>
        {progress && <button type="button" className="text-zinc-300 underline" onClick={stop}>{t('Stop trials')}</button>}
      </div>
      <div role="status" aria-live="polite" className="text-xs text-zinc-300">
        {profileLoading && <p>{t('Measuring local climb maps…')}{' '}
          <button type="button" className="text-cyan-300 underline" onClick={()=>setTerrain(s=>({...s,profileSource:'builtin',profile:undefined}))}>
            {t('Use built-in profile')}
          </button></p>}
        {progress && <>{progress.refinement && <p>{t('Refining the full course · pass {n}',{n:progress.refinement})}</p>}{progressLabel(progress)}</>}
        {state==='no-course' && <span className="text-amber-200">{t('The pilot could not finish a generated course. Change the seed, direction or obstacles and try again.')}</span>}
        {state==='error' && <span className="text-amber-200">{t('Movement simulation unavailable.')}</span>}
        {course && <>
          <p className="font-semibold text-emerald-300">{t('Spawn to flag: {time} s',{time:formatSeconds.format(course.trial.ticks/60)})}</p>
          <p>{t('Target {target} s · difference {delta} s',{target:course.targetSeconds,
            delta:new Intl.NumberFormat(locale,{signDisplay:'exceptZero',minimumFractionDigits:2,maximumFractionDigits:2}).format(course.trial.ticks/60-course.targetSeconds)})}</p>
          <p>{t('{tested} section variants tested · {used} applied',{tested:course.checkedVariants,used:course.changes})}</p>
          {terrain.seed!==course.map.editorTunnels![0].settings.seed && <p>{t('Terrain seed selected by the pilot: {seed}',{seed:course.map.editorTunnels![0].settings.seed})}</p>}
          {Math.abs(course.targetSeconds-course.trial.ticks/60)>course.toleranceSeconds &&
            <p className="mt-1 text-amber-200">{t('The closest verified course falls outside the target tolerance.')}</p>}
        </>}
      </div>
      {course && <canvas ref={canvas} width={900} height={435} aria-label={t('Timed course and pilot trace')}
        className="block h-auto w-full rounded-md border border-zinc-700"/>}
      {course?.trial.splits?.length ? <details className="rounded-md border border-zinc-700">
        <summary className="cursor-pointer p-2 text-xs font-medium text-cyan-200">{t('Full run splits')}</summary>
        <div className="p-2 pt-0"><TunnelRunSplits trial={course.trial}/></div>
      </details> : null}
    </div>
    <fieldset className="min-w-0" disabled={!!progress}><TunnelControls settings={terrain} setSettings={setTerrain}
      onProfileLoading={setProfileLoading} drawn={false} timed/></fieldset>
  </section>;
}
