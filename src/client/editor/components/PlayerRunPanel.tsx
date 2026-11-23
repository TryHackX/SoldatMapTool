import { useEffect, useMemo, useRef, useState } from 'react';
import { locale, t } from '../../i18n';
import { downloadBlob } from '../projectFile';
import { comparePlayerRuns, MAX_PLAYER_RUNS, playerRunRouteKey, playerRunsBackup, readPlayerRuns, validPlayerRun,
  type PlayerMove, type PlayerRun, type PlayerSplit } from '../playerRunLog';
import type { TunnelTrialRequest, TunnelTrialResult } from '../tunnelTrial';

interface Props { request:TunnelTrialRequest; trial:TunnelTrialResult; seed:number }
const field='min-w-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-zinc-100';
const action='rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:border-cyan-500 disabled:opacity-40';
const seconds=(n:number)=>n.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})+' s';

function RunForm({route,trial,seed,count}:{route:string;trial:TunnelTrialResult;seed:number;count:number}) {
  const key='sms.player-runs.'+route;
  const [runs,setRuns]=useState<PlayerRun[]>([]);
  const [error,setError]=useState('');
  const [game,setGame]=useState('');
  const [finish,setFinish]=useState(true);
  const [elapsed,setElapsed]=useState('');
  const [stop,setStop]=useState(1);
  const [notes,setNotes]=useState('');
  const [range,setRange]=useState(0);
  const [move,setMove]=useState<PlayerMove>('ordinary');
  const [splitTime,setSplitTime]=useState('');
  const [splits,setSplits]=useState<PlayerSplit[]>([]);
  const file=useRef<HTMLInputElement>(null);
  const ranges=trial.splits ?? [];
  const observation=comparePlayerRuns(runs,trial);
  useEffect(()=>{
    const refresh=()=>{
      try {
        const saved=localStorage.getItem(key);
        setRuns(saved ? readPlayerRuns(saved,route,count) : []);
        setError('');
      } catch {setError(t('The local run log could not be read.'));}
    };
    refresh();
    const sync=(event:StorageEvent)=>{if(event.key===key || event.key===null) refresh();};
    window.addEventListener('storage',sync);
    return ()=>window.removeEventListener('storage',sync);
  },[route,count,key]);
  const decimal=(value:string)=>Number(value.trim().replace(',','.'));
  function merge(additions:PlayerRun[]) {
    const stored=localStorage.getItem(key);
    const previous=stored ? readPlayerRuns(stored,route,count) : [];
    const combined=new Map(previous.map(r=>[r.id,r]));
    for(const r of additions) {
      const old=combined.get(r.id);
      if (old && JSON.stringify(old)!==JSON.stringify(r)) throw new Error('conflict');
      combined.set(r.id,r);
    }
    const next=[...combined.values()];
    if (next.length>MAX_PLAYER_RUNS) throw new Error('capacity');
    localStorage.setItem(key,JSON.stringify({format:'soldat-player-runs-v1',route,runs:next}));
    setRuns(next);setError('');
  }
  function save() {
    const row:PlayerRun={id:crypto.randomUUID(),gameVersion:game.trim(),reached:finish,seconds:decimal(elapsed),
      ...(!finish && {stoppedAt:stop}),notes:notes.trim(),splits};
    if(!validPlayerRun(row,count)) {setError(t('Check the game version, run time, stop and completed splits.'));return;}
    try {merge([row]);setElapsed('');setNotes('');setSplits([]);setSplitTime('');}
    catch {setError(t('Could not save these measurements locally.'));}
  }
  function addSplit() {
    const gate=ranges[range],value=decimal(splitTime);
    if (!gate || !Number.isFinite(value) || value<=0 || value>86400 || (!finish && gate.lastKnotIndex>=stop)) {
      setError(t('Enter a time for a completed section.'));return;
    }
    const row={first:gate.knotIndex,last:gate.lastKnotIndex,seconds:value,move};
    setSplits([...splits.filter(s=>s.first!==row.first),row].sort((a,b)=>a.first-b.first));
    setSplitTime('');setError('');setRange(Math.min(range+1,ranges.length-1));
  }
  return <div className="mt-2 space-y-2 text-xs">
    <p className="text-zinc-400">{t('Record a run you played or timed from a replay on this exact route. Measurements are stored in this browser.')}</p>
    <label className="grid gap-1">{t('Game version')}<input className={field} value={game} maxLength={80} onChange={e=>setGame(e.target.value)} placeholder="Soldat 1.7.1"/></label>
    <div className="flex flex-wrap gap-2"><label className="grid flex-1 gap-1">{t('Player result')}
      <select className={field} value={finish?'flag':'stopped'} onChange={e=>setFinish(e.target.value==='flag')}>
        <option value="flag">{t('Reached the flag')}</option><option value="stopped">{t('Stopped on the route')}</option>
      </select></label>
      <label className="grid flex-1 gap-1">{t('Elapsed seconds')}<input className={field} inputMode="decimal" value={elapsed} onChange={e=>setElapsed(e.target.value)}/></label>
    </div>
    {!finish && <label className="grid gap-1">{t('Stopped at section')}<input type="number" className={field} min={1} max={count} value={stop} onChange={e=>setStop(e.target.valueAsNumber)}/></label>}
    <details><summary className="cursor-pointer text-cyan-300">{t('Measured section times')} ({splits.length})</summary>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <label className="grid gap-1">{t('Section')}<select className={field} value={range} onChange={e=>setRange(+e.target.value)}>
          {ranges.map((s,i)=><option key={s.knotIndex} value={i}>{s.knotIndex===s.lastKnotIndex ? s.knotIndex : s.knotIndex+'–'+s.lastKnotIndex}</option>)}
        </select></label>
        <label className="grid gap-1">{t('Movement used')}<select className={field} value={move} onChange={e=>setMove(e.target.value as PlayerMove)}>
          <option value="ordinary">{t('Ordinary jump')}</option><option value="bounce">{t('Bounce jump')}</option>
        </select></label>
        <label className="grid gap-1">{t('Section seconds')}<input className={field} inputMode="decimal" value={splitTime} onChange={e=>setSplitTime(e.target.value)}/></label>
        <button type="button" className={action+' self-end'} onClick={addSplit} disabled={!ranges.length}>{t('Set split')}</button>
      </div>
      {splits.map(s=><div key={s.first} className="mt-1 flex items-center justify-between">#{s.first}{s.last!==s.first && '–'+s.last} · {seconds(s.seconds)}
        <button type="button" className={action} onClick={()=>setSplits(splits.filter(v=>v.first!==s.first))}>{t('Remove')}</button></div>)}
    </details>
    <label className="grid gap-1">{t('Conditions or replay reference (optional)')}<input className={field} value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)}/></label>
    <button className={action} type="button" onClick={save}>{t('Save player run')}</button>
    <div aria-live="polite" className="space-y-1 border-t border-zinc-800 pt-2">
      <strong>{t('Recorded attempts: {n}',{n:runs.length})}</strong>
      {!!runs.length && <>
        <p>{t('Only the player finished: {p}. Only the pilot finished: {m}.',{p:observation.playerOnly,m:observation.pilotOnly})}</p>
        {observation.finishError!==null && <p>{t('Mean absolute finish-time difference: {time}',{time:seconds(observation.finishError)})}</p>}
        {observation.ordinaryError!==null && <p>{t('Ordinary jump timing difference: {time}',{time:seconds(observation.ordinaryError)})}</p>}
        {observation.bounceError!==null && <p>{t('Bounce timing difference: {time}',{time:seconds(observation.bounceError)})}</p>}
        <details><summary className="cursor-pointer">{t('Recorded attempts')}</summary>
          <ol className="max-h-48 space-y-1 overflow-y-auto py-1">{runs.map(r=><li key={r.id}>{r.gameVersion} · {seconds(r.seconds)} · {r.reached ? t('Reached the flag') : t('Section {n}',{n:r.stoppedAt!})}{r.notes && ' · '+r.notes}</li>)}</ol>
        </details>
      </>}
    </div>
    <div className="flex flex-wrap gap-1">
      <button type="button" className={action} onClick={()=>file.current?.click()}>{t('Import measurements')}</button>
      <button type="button" className={action} disabled={!runs.length} onClick={()=>downloadBlob(new Blob([playerRunsBackup(route,runs,seed,trial)],
        {type:'application/json'}),'climb-'+seed+'-'+route+'.json')}>{t('Export measurements')}</button>
    </div>
    <input ref={file} type="file" hidden accept=".json,application/json" onChange={async e=>{
      const selected=e.target.files?.[0]; e.target.value=''; if(!selected) return;
      try {
        if(selected.size>2_000_000) throw new Error('size');
        merge(readPlayerRuns(await selected.text(),route,count));
      } catch {setError(t('Import a measurement file for this route with valid, unique attempts.'));}
    }}/>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}

function RouteLog({request,trial,seed}:Props) {
  const route=useMemo(()=>playerRunRouteKey(request),[request]);
  return <RunForm key={route} route={route} count={request.splitAnchors?.length ?? 0} trial={trial} seed={seed}/>;
}

export function PlayerRunPanel(props:Props) {
  const [open,setOpen]=useState(false);
  if(!props.trial.splits?.length) return null;
  return <details className="border-t border-zinc-700 pt-2" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-xs font-medium text-cyan-300">{t('Compare with player runs')}</summary>
    {open && <RouteLog {...props}/>}
  </details>;
}
