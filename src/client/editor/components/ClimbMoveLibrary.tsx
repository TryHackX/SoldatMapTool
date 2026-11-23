import {useEffect,useRef,useState} from 'react';
import {CLIMB_MOVES,type ClimbMove,type DrillAttempt} from '../climbMoveDrills';
import {drawTunnelPreview} from './drawTunnelPreview';
import {locale,t} from '../../i18n';
import {SOLDIER_COLLISION} from '@shared/soldatConstants';

interface DrillView {
  attempts:DrillAttempt[]; total:number; url:string; draft:Parameters<typeof drawTunnelPreview>[1];
}
const format=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
function range(numbers:number[]) {
  const a=format.format(Math.min(...numbers)), b=format.format(Math.max(...numbers));
  return a===b ? a : a+'–'+b;
}

function MovePreview({move}:{move:ClimbMove}) {
  const [result,setResult]=useState<DrillView|null>(null), [error,setError]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let job:Worker|undefined, url:string|undefined;
    const fail=()=>{job?.terminate();setError(true);};
    try {
      job=new Worker(new URL('../climbMoveDrills.worker.ts',import.meta.url),{type:'module'});
      job.onerror=fail; job.onmessageerror=fail;
      job.onmessage=({data}:MessageEvent<Omit<DrillView,'url'>&{bytes:Uint8Array<ArrayBuffer>}>)=>{
        url=URL.createObjectURL(new Blob([data.bytes],{type:'application/octet-stream'}));
        setResult({...data,url}); job?.terminate();
      };
      job.postMessage(move);
    } catch {fail();}
    return ()=>{job?.terminate();if(url) URL.revokeObjectURL(url);};
  },[move]);
  useEffect(()=>{
    if (!canvas.current || !result) return;
    const best=result.attempts[0];
    const trial=best ? {reached:true,progress:1,ticks:best.ticks,trace:best.trace} : null;
    // Include the arc above the platforms in the camera bounds.
    const points=[...result.draft.polygons.flatMap(p=>p.vertices),...(best?.trace ?? [])];
    drawTunnelPreview(canvas.current,{...result.draft,centerline:points},false,trial,undefined,6);
  },[result]);
  if (!result) return <p role="status">{t(error?'Movement simulation unavailable.':'Simulating movement…')}</p>;
  const {attempts}=result;
  const landing=CLIMB_MOVES[move].pads.at(-1)!;
  const speedUnit=t('u/tick');
  return <>
    <canvas ref={canvas} width={600} height={220} className="block w-full rounded" aria-label={t('Training platforms and pilot trajectory')}/>
    <p role="status">{t('{passed}/{total} model runs reached the flag.',{passed:attempts.length,total:result.total})}</p>
    {!!attempts.length && <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs tabular-nums">
      {[
        ['Run-up used',range(attempts.map(a=>a.runup))+' u'],
        [move==='spring'?'Speed after rebound':'Takeoff speed',range(attempts.map(a=>a.launchSpeed))+' '+speedUnit],
        ['Usable landing zone X',range([landing.left+SOLDIER_COLLISION.halfWidth,landing.right-SOLDIER_COLLISION.halfWidth])+' u'],
        ['Landing position X',range(attempts.map(a=>a.landingX))+' u'],
        ['Horizontal landing speed',range(attempts.map(a=>a.arrivalSpeed))+' '+speedUnit],
        ['Time to flag',range(attempts.map(a=>a.ticks/60))+' s'],
      ].map(([label,value])=><div className="contents" key={label}><dt className="text-zinc-400">{t(label)}</dt><dd>{value}</dd></div>)}
    </dl>}
    <p className="text-[11px] text-zinc-400">{t('Ranges cover successful inputs in this exercise at 60 ticks/s.')}</p>
    <a className="inline-block rounded border border-zinc-700 px-2 py-1 hover:border-cyan-700"
      href={result.url} download={'ctf_kz_drill_'+move+'.pms'}>{t('Download training PMS')}</a>
  </>;
}

export function ClimbMoveLibrary() {
  const [open,setOpen]=useState(false), [move,setMove]=useState<ClimbMove>('jump');
  return <details className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200"
    onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold text-cyan-200">{t('Climb movement library')}</summary>
    {open && <div className="mt-2 space-y-2">
      <select aria-label={t('Training move')} value={move} onChange={e=>setMove(e.target.value as ClimbMove)}
        className="w-full rounded border border-zinc-700 bg-zinc-950 p-1.5">
        {(Object.keys(CLIMB_MOVES) as ClimbMove[]).map(key=><option value={key} key={key}>{t(CLIMB_MOVES[key].label)}</option>)}
      </select>
      <MovePreview key={move} move={move}/>
    </div>}
  </details>;
}

