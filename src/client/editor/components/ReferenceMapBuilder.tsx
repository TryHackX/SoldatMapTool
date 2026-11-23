import { useEffect, useRef, useState } from 'react';
import { Dice5 } from 'lucide-react';
import type { MapCompactEntry } from '@shared/apiTypes';
import { parsePmsFull, type PmsMapData } from '@shared/pmsParser';
import { MAX_STYLE_REFERENCES, type ReferenceReport } from '@shared/referenceMapGenerator';
import { fetchAndParseMap, queryMapsPage } from '../../utils/mapCache';
import type { ReferenceJob, ReferenceReply, ReferenceInput } from '../referenceMap.worker';
import { ReferenceTerrainView } from './ReferenceTerrainView';
import { describeTrial } from './tunnelTrialJob';
import { t } from '../../i18n';
import { setMapAssetSource } from '../../renderer/mapAssetSource';

const inputClass='rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200';
const action='rounded border border-cyan-800 px-2.5 py-1.5 text-cyan-200 hover:bg-cyan-950 disabled:opacity-50';
const eligible=(s:MapCompactEntry)=>s.polygonCount>0 && !s.limitViolationCount && !s.parseWarningCount;
type Draft={map:PmsMapData;bytes:Uint8Array;report:ReferenceReport;mixedSceneryPackages:boolean};
type Ready=(map:PmsMapData|null, name?:string)=>void;

function ReferencePicker({pool,setPool}:{pool:ReferenceInput[];setPool:(p:ReferenceInput[])=>void}) {
  const [query,setQuery]=useState(''),[favorites,setFavorites]=useState(false);
  const [page,setPage]=useState<{items:MapCompactEntry[];total:number}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const sample=useRef<AbortController|null>(null);
  useEffect(()=>{sample.current?.abort();setBusy(false);},[pool]);
  const request={searchQuery:('polys>0 -is:incompatible '+query).trim(),statusFilter:favorites?'favorites' as const:'all' as const};
  useEffect(()=>{
    const job=new AbortController();
    setPage(null);setError('');setBusy(false);
    const timer=setTimeout(()=>{
      void queryMapsPage({...request,limit:12},job.signal).then(r=>{
        if(!job.signal.aborted)setPage({items:r.items.filter(eligible),total:r.totalFiltered});
      }).catch(()=>{if(!job.signal.aborted)setError(t('Could not load the map list.'));});
    },160);
    return ()=>{clearTimeout(timer);job.abort();sample.current?.abort();};
  },[query,favorites]);
  async function samplePool(){
    if(!page?.total)return;
    sample.current?.abort();
    const job=new AbortController();sample.current=job;setBusy(true);setError('');
    try{
      const size=Math.min(MAX_STYLE_REFERENCES,page.total);
      const groups=await Promise.all(Array.from({length:size},(_,i)=>queryMapsPage({...request,
        offset:Math.floor(i*page.total/size),limit:Math.min(8,Math.max(1,Math.floor(page.total/size)))},job.signal)));
      if(job.signal.aborted)return;
      const choices:MapCompactEntry[]=[];
      for(const group of groups){
        const entry=group.items.find(m=>eligible(m)&&!choices.some(s=>s.id===m.id));
        if(entry)choices.push(entry);
      }
      if(choices.length)setPool(choices);else setError(t('No usable terrain in these results.'));
    }catch{if(!job.signal.aborted)setError(t('Could not load the map list.'));}
    finally{if(!job.signal.aborted)setBusy(false);}
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <input className={inputClass+' min-w-40 flex-1'} aria-label={t('Search reference maps')} value={query}
        placeholder={t('Map name or tag:collection')} onChange={e=>setQuery(e.target.value)}/>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={favorites} onChange={e=>setFavorites(e.target.checked)}/>{t('Favourites only')}</label>
      <button type="button" className={action} onClick={()=>void samplePool()} disabled={busy||!page?.total}>
        {busy?t('Selecting maps…'):t('Use a sample of up to {n} results',{n:MAX_STYLE_REFERENCES})}</button>
    </div>
    <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">{page?.items.map(m=>{
      const selected=pool.some(s=>s.id===m.id);
      return <button key={m.id} type="button" aria-pressed={selected} className={'rounded border px-2 py-1 '+(selected?'border-cyan-700 text-cyan-200':'border-zinc-700 text-zinc-300')}
        disabled={busy||(!selected&&pool.length>=MAX_STYLE_REFERENCES)} onClick={()=>setPool(selected?pool.filter(s=>s.id!==m.id):[...pool,m])}>
        {selected?'✓ ':'+ '}{m.baseName}</button>;
    })}</div>
    {page && !page.items.length && <p>{t('No usable terrain in these results.')}</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}

export function ReferenceMapBuilder({initial,onReady,onBusy}:{initial?:MapCompactEntry|null;onReady:Ready;onBusy:(busy:boolean)=>void}) {
  const [pool,setPool]=useState<ReferenceInput[]>(()=>initial&&eligible(initial)?[initial]:[]);
  const [lookId,setLookId]=useState(initial?.id??'');
  const [previewId,setPreviewId]=useState(initial?.id??'');
  const [seed,setSeed]=useState(123),[variation,setVariation]=useState(65);
  const [layout,setLayout]=useState<'compose'|'reshape'>('compose');
  const [refMap,setRefMap]=useState<PmsMapData|null>(null);
  const [referenceError,setReferenceError]=useState(false);
  const [draft,setDraft]=useState<Draft|null>(null),[message,setMessage]=useState('');
  const [stalled,setStalled]=useState(false);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const worker=useRef<Worker|null>(null);
  const look=Math.max(0,pool.findIndex(m=>m.id===lookId)), shown=pool.find(m=>m.id===previewId)??pool[0];
  useEffect(()=>{
    let current=true;setRefMap(null);setReferenceError(false);
    if(shown)void fetchAndParseMap(shown.id).then(m=>{if(current)setRefMap(m);}).catch(()=>{if(current)setReferenceError(true);});
    return ()=>{current=false;};
  },[shown?.id]);
  useEffect(()=>()=>{worker.current?.terminate();},[]);
  useEffect(()=>{onBusy(busy);return ()=>onBusy(false);},[busy,onBusy]);
  function reset(){
    worker.current?.terminate();worker.current=null;
    setBusy(false);setDraft(null);onReady(null);setError('');setMessage('');setStalled(false);
  }
  function run(req:ReferenceJob){
    worker.current?.terminate();
    if(req.kind==='generate'){setDraft(null);onReady(null);setStalled(false);}
    setBusy(true);setError('');setMessage(req.kind==='pilot'?t('Simulating movement…'):t('Reading reference maps…'));
    let job:Worker|undefined;
    function finish(){job?.terminate();worker.current=null;setBusy(false);}
    function fail(detail:string){finish();setMessage('');setError(detail);}
    try{
      job=new Worker(new URL('../referenceMap.worker.ts',import.meta.url),{type:'module'});
      worker.current=job;
      job.onerror=job.onmessageerror=()=>{if(worker.current===job)fail(t('Generation or simulation failed.'));};
      job.onmessage=({data}:MessageEvent<ReferenceReply>)=>{
        if(worker.current!==job)return;
        if(data.kind==='progress'){setMessage(t('Reading {name}…',{name:data.name}));return;}
        if(data.kind==='attempt'){setMessage(t('Testing layout {n} of {total}…',{n:data.n,total:data.total}));return;}
        if(data.kind==='exhausted'){finish();setMessage(t('The pilot finished none of the {n} variants. Your preview still shows the original seed.',{n:data.total}));return;}
        if(data.kind==='error'){fail((data.name?data.name+' · ':'')+t(data.message));return;}
        finish();
        if(data.kind==='pilot'){setStalled(!data.trial?.reached);setMessage(data.trial?describeTrial(data.trial):t('The pilot could not find a route to the flag.'));return;}
        try{
          const map=parsePmsFull(data.bytes);
          if(data.assetSource)setMapAssetSource(map,data.assetSource.mapId,data.assetSource.key);
          setDraft({map,bytes:data.bytes,report:data.report,mixedSceneryPackages:data.mixedSceneryPackages});
          const prefix=pool[0].baseName.match(/^(ctf|tw|kz|dm|htf|inf|rce)[_-]/i)?.[1].toLowerCase()
            ?? (map.spawnpoints.some(p=>p.active&&p.team===6)?'ctf':'dm');
          onReady(map,prefix+'_style_'+data.seed);
          setSeed(data.seed);setStalled(false);
          const flags=map.spawnpoints.some(p=>p.active&&p.team===1)&&map.spawnpoints.some(p=>p.active&&p.team===6);
          setMessage(data.trial?describeTrial(data.trial):flags?t('The pilot has not checked this route yet.'):t('This map has no Alpha-to-Bravo flag run.'));
        }catch{fail(t('Could not read the generated PMS.'));}
      };
      job.postMessage(req);
    }catch{fail(t('Generation or simulation failed.'));}
  }
  function generate(kind:'generate'|'variants'){
    run({kind,sources:pool.map(({id,baseName,crc32})=>({id,baseName,crc32})),options:{seed,look,variation,layout}});
  }
  return <section aria-label={t('Map from examples')} className="space-y-3 text-xs text-zinc-300">
    <p>{t('Choose maps with the look and layout you want. The first map sets the scale, starts and flags.')}</p>
    <ReferencePicker pool={pool} setPool={p=>{reset();setPool(p);}}/>
    {!!pool.length && <div className="flex flex-wrap items-center gap-1.5"><span>{t('Reference pool')}</span>
      {pool.map((m,i)=><button key={m.id} type="button" aria-label={t('Remove {name}',{name:m.baseName})}
        className="rounded bg-zinc-800 px-2 py-1" onClick={()=>{reset();setPool(pool.filter(s=>s.id!==m.id));}}>{i+1}. {m.baseName} ×</button>)}</div>}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label>{t('Terrain layout')}{' '}<select value={layout} className={inputClass}
        onChange={e=>{reset();setLayout(e.target.value as typeof layout);}}>
        <option value="compose">{t('Compose a new layout')}</option><option value="reshape">{t('Reshape the first map')}</option></select></label>
      <label>{t('Palette, sky and texture')}{' '}<select className={inputClass} value={pool[look]?.id??''} disabled={!pool.length}
        onChange={e=>{reset();setLookId(e.target.value);}}>{pool.map(m=><option key={m.id} value={m.id}>{m.baseName}</option>)}</select></label>
      <label>{t('Layout variation')}{' '}<input type="range" min={0} max={100} value={variation} onChange={e=>{reset();setVariation(Number(e.target.value));}}/> {variation}%</label>
      <label>{t('Seed')}{' '}<input className={inputClass+' w-24'} type="number" value={seed} min="0" max="2147483647"
        onChange={e=>{reset();setSeed(Math.max(0,Math.min(0x7fffffff,Math.floor(Number(e.target.value)||0))));}}/></label>
      <button type="button" className="inline-flex items-center gap-1 text-cyan-300" onClick={()=>{reset();setSeed(Math.floor(Math.random()*0x80000000));}}>
        <Dice5 size={14}/>{t('Random seed')}</button>
    </div>
    <p className="text-zinc-400">{layout==='compose'
      ?t('Matches terrain sections by their openings and builds slopes between them. Bot waypoints can be added in the editor.')
      :t('Keeps the passages, scenery and waypoint links. The examples influence bends, widths and the height of the terrain.')}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <figure className="space-y-1"><figcaption className="flex min-h-7 items-center gap-1.5">{t('Visual reference')}
        {pool.length>1?<select className="max-w-48 rounded bg-zinc-800 px-1.5 py-1" aria-label={t('Visual reference')}
          value={shown?.id} onChange={e=>setPreviewId(e.target.value)}>{pool.map(m=><option key={m.id} value={m.id}>{m.baseName}</option>)}</select>:shown?' · '+shown.baseName:''}</figcaption>
        {refMap?<ReferenceTerrainView map={refMap} label={t('Visual reference')}/>:<div className="grid aspect-[2/1] place-items-center rounded bg-zinc-950 text-zinc-400">{referenceError?t('Could not read the reference.'):shown?t('Reading reference maps…'):t('Select a reference map.')}</div>}</figure>
      <figure className="space-y-1"><figcaption className="flex min-h-7 items-center">{t('Generated layout')}</figcaption>
        {draft?<ReferenceTerrainView map={draft.map} label={t('Generated layout')}/>:<div className="grid aspect-[2/1] place-items-center rounded bg-zinc-950 text-zinc-400">{t('Generate a layout to preview it here.')}</div>}</figure>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={action} disabled={!pool.length||busy} onClick={()=>generate('generate')}>{t('Generate from references')}</button>
      {draft && draft.map.spawnpoints.some(p=>p.team===1&&p.active)&&draft.map.spawnpoints.some(p=>p.team===6&&p.active) &&
        <button type="button" className={action} disabled={busy} onClick={()=>run({kind:'pilot',bytes:draft.bytes})}>{t('Check from start to flag')}</button>}
      {stalled&&draft&&<button type="button" className={action} disabled={busy} onClick={()=>generate('variants')}>{t('Find a playable layout in this pool')}</button>}
      {busy&&<button type="button" onClick={()=>{worker.current?.terminate();worker.current=null;setBusy(false);setMessage(t('Cancelled.'));}}>{t('Cancel')}</button>}
    </div>
    {draft&&<p>{t(layout==='compose'?'Sections by reference':'Shape samples by reference')}{' · '}{pool.map((m,i)=>m.baseName+' ('+draft.report.fromSources[i]+')').join(', ')}{' · '}{t('{n} polygons',{n:draft.map.polygons.length})}</p>}
    <p role="status" className={error?'text-amber-300':'text-zinc-300'}>{error||message}</p>
    {draft?.mixedSceneryPackages && <p className="text-amber-300">{t('Scenery comes from several asset folders. The preview uses the visual reference folder. For consistent artwork, clean these maps into one archive and select those copies.')}</p>}
  </section>;
}

