import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapCompactEntry } from '@shared/apiTypes';
import type { PmsMapData } from '@shared/pmsParser';
import { defaultWallSettings, type WallScope, type WallStroke } from '@shared/wallProtection';
import { t } from '../i18n';
import { fetchAndParseMap, openPathInExplorer } from '../utils/mapCache';
import { WallMaskPreview } from './WallMaskPreview';
import {wallExporter} from '../utils/wallExport';

type Entry = Pick<MapCompactEntry,'id'|'baseName'|'crc32'>;
type Row = {name:string; added?:number; error?:string; filename?:string};
const keyOf=(entry:Entry)=>entry.id+'@'+entry.crc32;
const control='rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 disabled:opacity-40';
const empty:WallStroke[]=[];

export function WallProtectionPanel({current,batchCount,batchLabel,resolve,busy,setBusy,maxLength}:{
  current:Entry|null; batchCount:number; batchLabel:string; resolve:()=>Promise<MapCompactEntry[]>;
  busy:boolean; setBusy:(value:boolean)=>void; maxLength:number;
}) {
  const [batch,setBatch]=useState<Entry[]|null>(null);
  const [index,setIndex]=useState(0), [search,setSearch]=useState('');
  const [width,setWidth]=useState(defaultWallSettings.width), [clearance,setClearance]=useState(defaultWallSettings.clearance);
  const [clearanceText,setClearanceText]=useState(String(defaultWallSettings.clearance));
  const [repairInteriorCells,setRepairInteriorCells]=useState(true);
  const requestedClearance=clearanceText.trim()==='' ? NaN : Number(clearanceText);
  const validClearance=Number.isFinite(requestedClearance) && requestedClearance>=0;
  useEffect(()=>{
    if(!validClearance || requestedClearance===clearance) return;
    const timer=window.setTimeout(()=>setClearance(requestedClearance),180);
    return ()=>window.clearTimeout(timer);
  },[clearance,requestedClearance,validClearance]);
  const [masks,setMasks]=useState<Record<string,WallStroke[]>>({});
  const [scopes,setScopes]=useState<Record<string,WallScope>>({});
  const [loaded,setLoaded]=useState<{key:string;map:PmsMapData}|null>(null);
  const [problem,setProblem]=useState(''), [folder,setFolder]=useState('');
  const [rows,setRows]=useState<Row[]>([]), [progress,setProgress]=useState('');
  const stop=useRef(false);
  const selection=useMemo(()=>batch ?? (current?[current]:[]),[batch,current]);
  const entry=selection[index], key=entry?keyOf(entry):'';
  const strokes=masks[key]??empty;
  const scope=scopes[key];
  const settings=useMemo(()=>({width,clearance,repairInteriorCells,strokes,scope}),[width,clearance,repairInteriorCells,strokes,scope]);
  const [exportable,setExportable]=useState<typeof defaultWallSettings|null>(null);
  const options=useMemo(()=>selection.map((e,i)=>({e,i})).filter(({e})=>
    e.baseName.toLowerCase().includes(search.toLowerCase())).slice(0,160),[selection,search]);
  useEffect(()=>{
    let live=true;
    setProblem('');setLoaded(null);
    if (entry) fetchAndParseMap(entry.id).then(map=>{
      if (live && map.crc32!==entry.crc32) throw Error(t('Map changed. Refresh the library.'));
      if (live) setLoaded({key,map});
    }).catch(e=>{if(live)setProblem(String(e));});
    return ()=>{live=false;};
  },[entry?.id,key]);
  async function selectBatch() {
    setBusy(true);
    try {setBatch(await resolve());setIndex(0);setSearch('');}
    catch(e){setProblem(String(e));}
    finally{setBusy(false);}
  }
  async function convert() {
    if (!selection.length || busy || !validClearance || requestedClearance!==clearance) return;
    const run=crypto.randomUUID(), results:Row[]=[];
    stop.current=false;setBusy(true);setRows([]);setProblem('');setFolder('');
    try {
      const exportMap=await wallExporter(run,maxLength);
      for (const [i,e] of selection.entries()) {
        if (stop.current) break;
        setProgress(t('Processing {i}/{n}: {name}',{i:i+1,n:selection.length,name:e.baseName}));
        try {
          const data=await exportMap(e,{width,clearance,repairInteriorCells,strokes:masks[keyOf(e)]??empty,scope:scopes[keyOf(e)]});
          if (data.folder) setFolder(data.folder);
          results.push({name:e.baseName,added:data.added,filename:data.filename});
        } catch(e2){results.push({name:e.baseName,error:t(e2 instanceof Error ? e2.message : String(e2))});}
      }
    } catch(e){setProblem(t(e instanceof Error?e.message:String(e)));} finally {
      setRows(results);setBusy(false);setProgress('');
    }
  }
  return <div className="min-h-0 space-y-3 overflow-y-auto p-5 text-xs text-zinc-200">
    <p>{t('Insert transparent Deadly strips inside thick walls. Clearance is measured from the playable surface.')}</p>
    <fieldset disabled={busy} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={control} aria-pressed={!batch} onClick={()=>{setBatch(null);setIndex(0);setSearch('');}}>{t('Current map')}</button>
        <button type="button" className={control} aria-pressed={!!batch} onClick={selectBatch}>{t('Map list ({n})',{n:batchCount})} · {batchLabel}</button>
      </div>
      {batch && <div className="flex flex-wrap items-center gap-2">
        <input type="search" className={control} placeholder={t('Find map in list')} value={search} onChange={e=>setSearch(e.target.value)}/>
        <select className={control} aria-label={t('Map to paint')} value={index} onChange={e=>setIndex(Number(e.target.value))}>
          {entry && !options.some(v=>v.i===index) && <option value={index}>{entry.baseName}</option>}
          {options.map(({e,i})=><option key={e.id} value={i}>{e.baseName}</option>)}
        </select>
        <button type="button" className={control} disabled={index===0} onClick={()=>setIndex(index-1)}>←</button>
        <button type="button" className={control} disabled={index+1>=batch.length} onClick={()=>setIndex(index+1)}>→</button>
      </div>}
      <div className="flex flex-wrap items-center gap-4">
        <strong>{entry?.baseName??t('No map selected')}</strong>
        <label>{t('Surface clearance')} <input type="number" min="0" step="any" className={control+' w-20'}
          value={clearanceText} onChange={e=>setClearanceText(e.currentTarget.value)} aria-invalid={!validClearance}/> u</label>
        <label>{t('Strip width')} <select className={control} value={width} onChange={e=>setWidth(+e.target.value)}>
          {[1,2,4,6,8,12,16,24,32,48].map(v=><option key={v} value={v}>{v} u</option>)}</select></label>
      </div>
      {!validClearance && <p role="alert" className="text-rose-300">{t('Enter a clearance of zero or more.')}</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={repairInteriorCells}
        onChange={e=>setRepairInteriorCells(e.target.checked)}/>{t('Repair missing collision cells inside walls along manual strips')}</label>
      <div inert={busy}>{loaded?.key===key && loaded && <WallMaskPreview key={key} map={loaded.map} settings={settings} onExportable={setExportable}
        onScope={value=>setScopes(prev=>({...prev,[key]:value}))} onStrokes={next=>setMasks(prev=>({...prev,[key]:next}))}/>}</div>
      <button type="button" className="rounded bg-amber-500 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-40"
        disabled={!selection.length || !validClearance || requestedClearance!==clearance ||
          (selection.length===1 && (loaded?.key!==key || exportable!==settings))} onClick={convert}>{t('Export protected copies ({n})',{n:selection.length})}</button>
    </fieldset>
    {busy && progress && <div role="status">{progress} <button type="button" className={control} onClick={()=>{stop.current=true;}}>{t('Stop after this map')}</button></div>}
    {problem && <p role="alert" className="text-rose-300">{problem}</p>}
    {rows.length>0 && <details open><summary>{t('Saved: {ok} · No new strips: {skip} · Errors: {fail}',{
      ok:rows.filter(r=>r.filename).length,skip:rows.filter(r=>r.added===0).length,fail:rows.filter(r=>r.error).length})}</summary>
      <div className="max-h-36 overflow-y-auto whitespace-pre-wrap">{rows.map(r=>r.name+' → '+(r.error??r.filename??t('No new strips'))).join('\n')}</div>
    </details>}
    {folder && <button type="button" className={control} onClick={()=>openPathInExplorer(folder).catch(e=>setProblem(String(e)))}>{t('Open output folder')} · {folder}</button>}
  </div>;
}
