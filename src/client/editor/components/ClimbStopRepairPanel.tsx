import {useEffect,useRef,useState} from 'react';
import {Wrench} from 'lucide-react';
import {locale,t} from '../../i18n';
import {locateStalledSection,REPAIR_TITLES,type RepairReport,type RepairRequest} from '../climbStopRepair';

const number=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
const button='rounded-md border border-amber-700/80 px-2 py-1.5 text-amber-200 hover:bg-amber-950 disabled:opacity-50';
const failure={
  manual:'Manually edited terrain',clearance:'Too little clearance',neighbour:'Would cut into another passage',
  unchanged:'Same geometry',invalid:'Invalid geometry',
};

export function ClimbStopRepairPanel({source,onPreview}:{source:RepairRequest;onPreview:(candidate:RepairReport)=>void}) {
  const [reports,setReports]=useState<RepairReport[]>([]), [phase,setPhase]=useState<'idle'|'working'|'done'|'error'>('idle');
  const worker=useRef<Worker|null>(null);
  const {map,project,trial,sketch}=source;
  useEffect(()=>{
    setReports([]);setPhase('idle');
    return ()=>{worker.current?.terminate();worker.current=null;};
  },[map,project,trial,sketch]);
  const diagnosis=locateStalledSection(project,trial);
  if(!diagnosis) return null;
  function measure(){
    if(worker.current) return;
    setReports([]);setPhase('working');
    try{
      const job=new Worker(new URL('../climbStopRepair.worker.ts',import.meta.url),{type:'module'});
      worker.current=job;
      const finish=(stage:'done'|'error')=>{
        if(worker.current!==job)return;
        job.terminate();worker.current=null;setPhase(stage);
      };
      const fail=()=>finish('error');
      job.onerror=fail;job.onmessageerror=fail;
      job.onmessage=({data}:MessageEvent<{report?:RepairReport;done?:boolean}>)=>{
        if(worker.current!==job)return;
        if(data.report) { const report=data.report;setReports(prev=>[...prev,report]); }
        if(data.done) finish('done');
      };
      job.postMessage(source);
    }catch{worker.current?.terminate();worker.current=null;setPhase('error');}
  }
  const {knot,rise,span,spring}=diagnosis;
  return <section aria-label={t('Repair a stalled jump')} className="mt-2 space-y-2 rounded-md border border-amber-900 bg-amber-950/20 p-2.5 text-xs">
    <h3 className="flex items-center gap-1.5 font-semibold text-amber-200"><Wrench size={13}/>{t('Repair a stalled jump')}</h3>
    <p>{t('Section {k} · horizontal span {span} u · rise {rise} u',{k:knot,span,rise})}
      {spring && ' · '+t('Bouncy ground')}</p>
    {phase==='idle' ? <button className={button} type="button" onClick={measure}>{t('Test targeted repairs from start')}</button> :
      <div className="space-y-2">
        <p role="status" className="text-zinc-400">{t(phase==='working'?'Checking repairs from spawn…':phase==='error'?'Movement simulation unavailable.':'Full runs finished.')}</p>
        {reports.map(r=><div key={r.kind} className="flex items-center justify-between gap-1 border-t border-zinc-700/70 pt-1">
          <div><span className="font-medium">{t(REPAIR_TITLES[r.kind])}</span>
            <p className={'text-[11px] '+(r.trial?.reached?'text-emerald-300':'text-zinc-400')}>
              {r.trial ? r.trial.reached ? t('Flag in {n} s',{n:number.format(r.trial.ticks/60)}) :
                t('Stopped at {pct}% of route',{pct:Math.round(r.trial.progress*100)}) : r.rejected && t(failure[r.rejected])}
            </p></div>
          {r.trial && <button type="button" className={button} onClick={()=>onPreview(r)}>{t('Preview')}</button>}
        </div>)}
        <button type="button" className="text-zinc-400 underline" onClick={()=>{
          if(phase==='working'){worker.current?.terminate();worker.current=null;setPhase('idle');setReports([]);}
          else measure();
        }}>{t(phase==='working'?'Cancel':'Run again')}</button>
      </div>}
  </section>;
}

