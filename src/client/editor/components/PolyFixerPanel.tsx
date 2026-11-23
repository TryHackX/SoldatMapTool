import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Crosshair, Loader2, Wrench } from 'lucide-react';
import type { PmsMapData } from '@shared/pmsParser';
import { findPolyJunctions, MAX_JUNCTION_TOLERANCE, sealAllPolyJunctions, sealPolyJunction, type Junction } from '@shared/polyJunctions';
import { emptySelection } from '../EditorDocument';
import type { EditorSelection } from '../types';
import { t } from '../../i18n';

interface Props {
  map: PmsMapData;
  onCommit: (label: string, map: PmsMapData) => void;
  onSelect: (selection: EditorSelection) => void;
  onFrame: (bounds: {left:number; top:number; right:number; bottom:number}) => void;
  onMark: (point: {x:number; y:number; radius?:number} | null) => void;
}

function ContactPreview({ map, junction }: { map:PmsMapData; junction:Junction }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 280, 110);
    const point = (v: {x:number; y:number}) => [140+(v.x-junction.x)*5, 55+(v.y-junction.y)*5] as const;
    for (const polygon of junction.polygons) {
      const vs = map.polygons[polygon].vertices;
      ctx.beginPath();
      vs.forEach((v,i) => i ? ctx.lineTo(...point(v)) : ctx.moveTo(...point(v)));
      ctx.closePath();
      ctx.fillStyle = '#314453';
      ctx.fill();
      ctx.strokeStyle = '#7c909e';
      ctx.stroke();
    }
    for (const move of junction.moves) {
      const vs = map.polygons[move.polygon].vertices, old = vs[move.vertex];
      const a = vs[(move.vertex+1)%3], b = vs[(move.vertex+2)%3];
      // The two slivers are exactly the area added by extending this tip.
      for (const anchor of [a,b]) {
        ctx.beginPath();
        ctx.moveTo(...point(anchor));
        ctx.lineTo(...point(old));
        ctx.lineTo(...point(move.next));
        ctx.closePath();
        ctx.fillStyle = 'rgba(52,211,153,.62)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(...point(old));
      ctx.lineTo(...point(move.next));
      ctx.strokeStyle = '#6ee7b7';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#6ee7b7';
      ctx.fillRect(point(move.next)[0]-2,point(move.next)[1]-2,4,4);
    }
    ctx.beginPath();
    ctx.arc(140,55,3,0,Math.PI*2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
  },[map.polygons,junction]);
  return <canvas ref={canvas} width={280} height={110} aria-label={t('Preview of the overlap at the selected contact')}
    className="w-full rounded border border-zinc-700 bg-zinc-950"/>;
}

export function PolyFixerPanel({ map, onCommit, onSelect, onFrame, onMark }: Props) {
  const [tolerance, setTolerance] = useState(0);
  const [scan, setScan] = useState<{polygons:PmsMapData['polygons']; tolerance:number; hits:Junction[]} | null>(null);
  const [cursor, setCursor] = useState(0);
  const [repaired, setRepaired] = useState<{ polygons: PmsMapData['polygons']; count: number } | null>(null);
  const source = map.polygons;

  useEffect(() => {
    const timer = window.setTimeout(() => setScan({polygons:source,tolerance,hits:findPolyJunctions(source,tolerance)}),120);
    return () => window.clearTimeout(timer);
  },[source,tolerance]);
  const hits = scan?.polygons === source && scan.tolerance === tolerance ? scan.hits : undefined;
  const index = Math.min(cursor, Math.max(0,(hits?.length ?? 0)-1));
  const current = hits?.[index];

  const locate = useCallback((j:Junction) => {
    onFrame({left:j.x-46,right:j.x+46,top:j.y-46,bottom:j.y+46});
    onMark({x:j.x,y:j.y,radius:5});
    onSelect({...emptySelection(),polygons:j.polygons});
  },[onFrame,onMark,onSelect]);
  useEffect(() => {
    if (current) locate(current);
    else onMark(null);
    return () => onMark(null);
  },[current,locate,onMark]);

  function fix(all:boolean) {
    if (!current) return;
    const next = all ? sealAllPolyJunctions(map,tolerance) : {map:sealPolyJunction(map,current.x,current.y,tolerance),count:1};
    if (next.map === map) return;
    onCommit(all ? 'Seal all polygon contacts' : 'Seal polygon junction',next.map);
    setRepaired({polygons:next.map.polygons,count:next.count});
    if (all) setCursor(0);
  }

  return <section aria-label={t('Poly Fixer')} className="space-y-3">
    <div className="flex items-center gap-2"><Wrench size={16} className="text-amber-300"/>
      <h2 className="text-sm font-semibold text-zinc-100">{t('Poly Fixer')}</h2></div>
    <p className="leading-relaxed text-zinc-400">{t('Find touching corners in normal terrain and extend them into the neighbouring ground by up to 2 map units.')}</p>
    <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-zinc-300">
      {t('Maximum gap to repair')}<span className="font-mono">{tolerance ? tolerance + ' u' : t('Exact contacts')}</span>
      <input className="col-span-2 w-full accent-amber-400" type="range" min={0} max={MAX_JUNCTION_TOLERANCE} step={0.1}
        value={tolerance} aria-label={t('Maximum gap to repair')} onChange={e => {
          setTolerance(e.currentTarget.valueAsNumber); setCursor(0); setRepaired(null);
        }}/>
    </label>
    <div role="status" className="text-xs text-zinc-300">
      {hits ? t('Polygons scanned: {polygons}. Repairable contacts: {contacts}.',{polygons:source.length,contacts:hits.length})
        : <span className="flex gap-1.5 items-center"><Loader2 size={13} className="animate-spin"/>{t('Scanning polygon contacts…')}</span>}
    </div>
    {current && hits && <>
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label={t('Previous contact')} disabled={index===0} onClick={()=>setCursor(index-1)}
          className="rounded border border-zinc-700 p-1.5 hover:bg-zinc-800 disabled:opacity-35"><ArrowLeft size={14}/></button>
        <span className="font-mono text-zinc-300">{index+1} / {hits.length}</span>
        <button type="button" aria-label={t('Next contact')} disabled={index===hits.length-1} onClick={()=>setCursor(index+1)}
          className="rounded border border-zinc-700 p-1.5 hover:bg-zinc-800 disabled:opacity-35"><ArrowRight size={14}/></button>
      </div>
      <div className="flex items-baseline justify-between gap-1 text-zinc-300">
        <strong>{t(current.kind==='edge' ? 'Corner on edge' : 'Corner to corner')}</strong>
        <button type="button" title={t('Show contact on map')} onClick={()=>locate(current)} className="flex items-center gap-1 font-mono text-cyan-300">
          <Crosshair size={12}/>{Math.round(current.x)}, {Math.round(current.y)}</button>
      </div>
      <ContactPreview map={map} junction={current}/>
      {current.gap !== undefined && <p className="text-xs text-amber-200">{t('Measured gap: {n} u',{n:Number(current.gap.toFixed(3))})}</p>}
      <div className="flex items-center gap-3 text-[10px] text-zinc-400">
        <span className="flex gap-1.5 items-center"><i className="w-2 h-2 rounded-full bg-amber-400"/>{t('Original contact')}</span>
        <span className="flex gap-1.5 items-center"><i className="w-2 h-2 bg-emerald-400"/>{t('Proposed overlap')}</span>
      </div>
      <button type="button" onClick={()=>fix(false)} className="w-full rounded border border-emerald-500/40 bg-emerald-500/15 py-2 text-emerald-200 hover:bg-emerald-500/25">{t('Repair this contact')}</button>
      {hits.length>1 && <button type="button" onClick={()=>fix(true)} className="w-full rounded border border-zinc-700 py-2 text-zinc-300 hover:bg-zinc-800">
        {t('Repair all contacts ({n})',{n:hits.length})}</button>}
    </>}
    {repaired?.polygons === source && <p role="status" className="text-xs text-emerald-300">
      {t('Repaired contacts: {n}. Undo with Ctrl+Z.', {n:repaired.count})}
    </p>}
  </section>;
}
