import { useEffect, useRef, useState } from 'react';
import type { PmsMapData } from '@shared/pmsParser';
import type { checkTeamCourse } from '../teamCourseTrials';
import { t } from '../../i18n';
import { CoursePreview } from './CoursePreview';

export function TeamCoursePreview({map,mode}:{map:PmsMapData;mode:'ctf'|'trenchwars'}) {
  const worker=useRef<Worker|null>(null);
  const [state,setState]=useState<'idle'|'busy'|'error'>('idle');
  const [report,setReport]=useState<ReturnType<typeof checkTeamCourse>|null>(null);
  const [selected,setSelected]=useState(0);
  useEffect(()=>{
    setReport(null); setSelected(0); setState('idle');
    return ()=>{worker.current?.terminate();worker.current=null;};
  },[map,mode]);
  function check() {
    if (worker.current) return;
    setState('busy');
    try {
      const job=new Worker(new URL('../teamCourseTrials.worker.ts',import.meta.url),{type:'module'});
      worker.current=job;
      job.onmessage=({data}:MessageEvent<ReturnType<typeof checkTeamCourse>>)=>{
        if(worker.current!==job) return;
        setReport(data);setState('idle');job.terminate();worker.current=null;
      };
      job.onerror=job.onmessageerror=()=>{
        if(worker.current!==job)return;
        setState('error');job.terminate();worker.current=null;
      };
      job.postMessage({map,mode});
    } catch { worker.current?.terminate();worker.current=null;setState('error'); }
  }
  return <div className="space-y-2">
    <CoursePreview map={map} trace={report?.runs[selected]?.trial.trace}/>
    <button type="button" disabled={state==='busy'} onClick={check} className="text-xs text-cyan-300 disabled:text-zinc-400">
      {t(state==='busy'?'Simulating movement…':'Time routes to both flags')}</button>
    <div role="status" className="space-y-1 text-xs text-zinc-400">
      {state==='error' && t('Movement simulation unavailable.')}
      {report && (report.runs.length===0?t('No continuous ground route between flags.'): <>
        {report.minHeadroom!==null && <p>{t('{n} shelters · minimum headroom {h} u',
          {n:report.cover,h:Math.floor(report.minHeadroom)})}</p>}
        <div className="flex flex-wrap gap-1">{report.runs.map((r,i)=><button type="button" key={r.lane+r.team}
          aria-pressed={selected===i} onClick={()=>setSelected(i)} className={'rounded border px-2 py-1 '+
            (selected===i?'border-cyan-400 text-cyan-200':'border-zinc-700 text-zinc-300')}>
          {r.team} · {t(r.lane==='ground'?'Ground route':'Upper route')} · {r.trial.reached?(r.trial.ticks/60).toFixed(2)+' s':t('Stopped')}
        </button>)}</div>
      </>)}
    </div>
  </div>;
}
