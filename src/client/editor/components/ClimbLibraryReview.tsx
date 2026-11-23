import { useEffect, useRef, useState } from 'react';
import { REVIEW_MODES, REVIEW_STRATA, type LibraryReview, type LibraryReviewItem, type ReviewMode } from '@shared/climbReview';
import { t } from '../../i18n';
import { useMapThumbnail } from '../../utils/useMapThumbnail';

const label = (mode: ReviewMode) => mode==='uncertain' ? t('Uncertain mode') : mode==='climb' ? 'Climb' : mode.toUpperCase();
function ReviewPreview({item}: {item:LibraryReviewItem}) {
  const thumbnail = useMapThumbnail(item.id,item.crc32,item.hasThumbnail,true);
  return <>
    {thumbnail.url ? <img className="max-h-48 w-full rounded bg-black object-contain" src={thumbnail.url} alt={item.name}/>
      : <p>{thumbnail.failed ? t('Preview unavailable') : t('Loading preview…')}</p>}
    <p className="break-words text-zinc-200">{item.name}{item.title && ' · '+item.title}</p>
    <p>{t('Spawns A/B {a}/{b} · flags {red}/{blue} · jet {jet}',{a:item.alpha,b:item.bravo,red:item.alphaFlag,blue:item.bravoFlag,jet:item.jet})}</p>
    <p>{t('Automatic mode')} · {label(item.predicted)}<br/>
      {item.reviewed ? <>{item.source==='owner' ? t('Your label') : t('Visual audit')} · {label(item.reviewed)}</> : t('Awaiting review')}</p>
  </>;
}

export function ReviewSummary({report}: {report:LibraryReview}) {
  const reviewed = report.items.filter(item=>item.reviewed!==null);
  const uncertain = reviewed.filter(item=>item.reviewed==='uncertain').length;
  const matches = reviewed.filter(item=>item.reviewed===item.predicted).length;
  return <details>
    <summary className="cursor-pointer text-zinc-300">{t('Classification results for the whole sample')}</summary>
    <div className="mt-1 space-y-1.5">
      <p>{t('Reviewed {n} of {total} maps. Matches: {same}. Different mode: {other}. Uncertain: {uncertain}.',{
        n:reviewed.length,total:report.items.length,same:matches,other:reviewed.length-uncertain-matches,uncertain,
      })}</p>
      <table className="w-full text-left tabular-nums"><caption className="text-left">{t('Automatic prediction by reviewed mode')}</caption>
        <thead><tr><th scope="col">{t('Automatic mode')}</th>{REVIEW_MODES.map(k=><th scope="col" key={k}>{label(k)}</th>)}</tr></thead>
        <tbody>{REVIEW_STRATA.map(k=><tr key={k}><th scope="row">{label(k)}</th>{REVIEW_MODES.map(r=><td key={r}>{report.matrix[k][r]}</td>)}</tr>)}</tbody>
      </table>
      <p>{t('Sampled by original group, with extra two-team CTF maps with jets. Counts describe this sample.')}</p>
    </div>
  </details>;
}

export function ClimbLibraryReview({onLabelChange}: {onLabelChange:()=>void}) {
  const [open,setOpen] = useState(false), [report,setReport] = useState<LibraryReview | null>(null);
  const [index,setIndex] = useState(0), [filter,setFilter] = useState('all');
  const [error,setError] = useState(''), [status,setStatus] = useState(''), [busy,setBusy] = useState(false);
  const [retry,setRetry] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(()=>{
    if (!open) return;
    const request = new AbortController();
    active.current = request;
    setError('');setStatus('');setBusy(true);
    fetch('/api/editor/climb-review',{signal:request.signal}).then(r=>{
      if (!r.ok) throw Error();
      return r.json();
    }).then((data:LibraryReview)=>{if (!request.signal.aborted) setReport(data);})
      .catch(()=>{if (!request.signal.aborted) setError(t('Map index unavailable. Try again after scanning.'));})
      .finally(()=>{if (!request.signal.aborted) setBusy(false);});
    return ()=>active.current?.abort();
  },[open,retry]);

  const items = report?.items.filter(e=>filter==='all' || filter===e.stratum || (filter==='unreviewed' && !e.reviewed)) ?? [];
  const i = Math.min(index,Math.max(0,items.length-1)), item = items[i];
  async function assign(mode:ReviewMode | null) {
    if (!item || busy) return;
    const request = new AbortController(); active.current=request;
    setBusy(true);setError('');setStatus('');
    try {
      const r = await fetch('/api/editor/climb-review/'+encodeURIComponent(item.id),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({mode,crc32:item.crc32,fileSize:item.fileSize}),signal:request.signal});
      if (!r.ok) throw Error();
      const next:LibraryReview = await r.json();
      if (!request.signal.aborted) {
        setReport(next);
        setStatus(mode ? t('Saved {mode} for {name}.',{mode:label(mode),name:item.name}) :
          t('Removed your label for {name}.',{name:item.name}));
        onLabelChange();
      }
    } catch {if (!request.signal.aborted) setError(t('Label could not be saved. Check the map and its tag limit.'));}
    finally {if (!request.signal.aborted) setBusy(false);}
  }

  return <details className="border-t border-zinc-800 pt-2" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-cyan-300">{t('Review library classification')}</summary>
    {open && <div className="mt-2 space-y-2">
      <p>{t('Label source maps to decide which families can supply climb jumps.')}</p>
      <div role="status">{busy ? t('Loading…') : status}</div>
      {error && <p role="alert" className="text-amber-300">{error} <button type="button" className="text-cyan-300" onClick={()=>setRetry(n=>n+1)}>{t('Reload sample')}</button></p>}
      {report && <>
        <label className="block">{t('Original group in the sample')}
          <select className="w-full rounded bg-zinc-950 p-1.5" value={filter} disabled={busy} onChange={e=>{
            setFilter(e.target.value);setIndex(0);setStatus('');
          }}>
            <option value="all">{t('All sampled maps')}</option><option value="unreviewed">{t('Awaiting review')}</option>
            {REVIEW_STRATA.map(k=><option key={k} value={k}>{label(k)}</option>)}<option value="ctf-jets">{t('Additional CTF with jets')}</option>
          </select></label>
        {item ? <><div className="flex items-center justify-between">
          <button type="button" disabled={busy || !i} className="text-cyan-300 disabled:opacity-40" onClick={()=>{setIndex(i-1);setStatus('');}}>{t('Previous')}</button>
          <span>{i+1} / {items.length}</span>
          <button type="button" disabled={busy || i+1>=items.length} className="text-cyan-300 disabled:opacity-40" onClick={()=>{setIndex(i+1);setStatus('');}}>{t('Next')}</button>
        </div><ReviewPreview key={item.id} item={item}/>
          <fieldset disabled={busy}><legend>{t('Assign your label')}</legend><div className="flex flex-wrap gap-1">
            {REVIEW_MODES.map(k=>{
              const selected=item.source==='owner' && item.reviewed===k;
              return <button type="button" key={k} aria-pressed={selected} disabled={selected} onClick={()=>void assign(k)}
                className={'rounded border px-2 py-1 '+(selected ? 'border-cyan-500 bg-cyan-950 text-cyan-200' : 'border-zinc-700 text-zinc-300 hover:border-cyan-500')}>{label(k)}</button>;
            })}
            {item.source==='owner' && <button type="button" className="text-cyan-300" onClick={()=>void assign(null)}>{t('Remove my label')}</button>}
          </div></fieldset></> : <p>{t('No maps in this group.')}</p>}
        <ReviewSummary report={report}/>
      </>}
    </div>}
  </details>;
}
