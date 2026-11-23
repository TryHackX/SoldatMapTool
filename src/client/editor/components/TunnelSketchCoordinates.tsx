import {useEffect,useId,useMemo,useState} from 'react';
import type {TunnelPoint} from '@shared/climbTunnel';
import {isTunnelPoint} from '@shared/tunnelSketch';
import {t} from '../../i18n';

export function parseSketchCoordinates(text:string):{points:TunnelPoint[]}|{error:'short'|'limit'|'invalid';line?:number}{
  const points:TunnelPoint[]=[];
  for(const [index,line] of text.split(/\r?\n/).entries()){
    if(!line.trim()) continue;
    const cells=line.trim().split(/[\s;]+/);
    if(cells.length!==2 || !cells.every(cell=>/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(cell)))
      return {error:'invalid',line:index+1};
    const [x,y]=cells.map(cell=>Number(cell.replace(',','.')));
    if(!isTunnelPoint({x,y})) return {error:'invalid',line:index+1};
    if(points.at(-1)?.x===x && points.at(-1)?.y===y) continue;
    points.push({x,y});
    if(points.length>24000) return {error:'limit'};
  }
  return points.length<2 ? {error:'short'} : {points};
}

export function TunnelSketchCoordinates({points,onChange}:{points:TunnelPoint[];onChange:(points:TunnelPoint[])=>void}){
  const id=useId(),text=useMemo(()=>points.map(p=>p.x+' '+p.y).join('\n'),[points]);
  const [input,setInput]=useState(text), [feedback,setFeedback]=useState('');
  useEffect(()=>{setInput(text);},[text]);
  function apply(){
    const result=parseSketchCoordinates(input);
    if('error' in result){
      setFeedback(result.error==='invalid' ? t('Check X and Y on line {n}.',{n:result.line!}) :
        t(result.error==='short'?'Enter at least two different points.':'The sketch exceeds 24,000 points.'));
      return;
    }
    onChange(result.points);setFeedback(t('Sketch updated.'));
  }
  return <details className="rounded border border-zinc-800 px-2 py-1.5 text-xs">
    <summary className="cursor-pointer text-cyan-300">{t('Edit sketch coordinates')}</summary>
    <label className="mt-2 block space-y-1"><span>{t('X and Y in map units, one point per line')}</span>
      <textarea value={input} rows={5} aria-describedby={id} autoCapitalize="off" spellCheck={false}
        placeholder={'0 0\n180 -30\n360 40'} onChange={e=>{setInput(e.target.value);setFeedback('');}}
        className="block w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono"/>
    </label>
    <button type="button" disabled={input===text} onClick={apply} className="mt-2 text-cyan-300 disabled:opacity-40">{t('Apply coordinates')}</button>
    <p id={id} role="status" className="mt-1 text-zinc-300">{feedback}</p>
  </details>;
}

