import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TunnelSettings } from '@shared/climbTunnel';
import type { ClimbGeometryProfile } from '@shared/climbSamples';
import type { StyleCollection, StyleFold } from '@shared/climbLibrary';
import { locale, t } from '../../i18n';
import { ClimbDistributionTable } from './ClimbDistributionTable';
import { ClimbLibraryReview } from './ClimbLibraryReview';
import { ClimbModelExperiment } from './ClimbModelExperiment';

const folds: Record<StyleFold,string> = {all:'All families', reference:'Reference families', holdout:'Held-out families'};
const selectClass = 'block w-full rounded border border-zinc-700 bg-zinc-950 p-1.5 text-zinc-200';
const count = new Intl.NumberFormat(locale);

function displayKey(key: string, name?: string) {
  if (key === 'all') return t('Whole climb library');
  if (key === 'favorites') return t('Favourite climb maps');
  return t(key.startsWith('tag:') ? 'Tag · {name}' : 'Source · {name}', { name: name || key.slice(key.indexOf(':')+1) });
}

export function AppliedLibraryProfile({profile}: {profile?: ClimbGeometryProfile}) {
  if (!profile) return <p>{t('The preview uses the built-in jump profile.')}</p>;
  const snapshot = profile.library;
  return <>
    <p className="text-zinc-200">{snapshot ? t('Active profile · {collection} · {fold}', {
      collection:displayKey(snapshot.collection,snapshot.collectionLabel), fold:t(folds[snapshot.fold]),
    }) : t('Active jump profile from local maps')}</p>
    <p>{snapshot ? t('Families in this collection: {total}. Families with jump pairs in the active profile: {measured}.',{
      total:count.format(snapshot.familyCount),measured:count.format(profile.measuredMaps),
    }) : t('Families with jump pairs: {n}.',{n:count.format(profile.measuredMaps)})}
      {' '}{t('Ledge pairs: {pairs}. Families with bounce samples: {maps}.', {
        pairs:count.format(profile.pairs),maps:count.format(profile.bounceMaps),
      })}</p>
  </>;
}

export function LibraryStyleControls({ settings, setSettings, onLoading }: {
  settings: TunnelSettings; setSettings: Dispatch<SetStateAction<TunnelSettings>>; onLoading?: (busy: boolean) => void;
}) {
  const profile = settings.profile, snapshot = profile?.library;
  const [options,setOptions] = useState<StyleCollection[] | null>(null);
  const [collection,setCollection] = useState(snapshot?.collection ?? 'all');
  const [fold,setFold] = useState<StyleFold>(snapshot?.fold ?? 'all');
  const [expanded,setExpanded] = useState(false), [busy,setBusy] = useState(false);
  const [status,setStatus] = useState(''), [error,setError] = useState('');
  const [catalogError,setCatalogError] = useState(false), [reviewRevision,setReviewRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  const busyChanged = useRef(onLoading);
  busyChanged.current = onLoading;

  const loadProfile = useCallback(async (key:string, part:StyleFold, manual:boolean) => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setBusy(true); busyChanged.current?.(true); setStatus(''); setError('');
    try {
      const q = new URLSearchParams({collection:key,fold:part});
      const response = await fetch('/api/editor/climb-profile?' + q,{signal:request.signal});
      if (!response.ok) throw Error();
      const data: {geometry:ClimbGeometryProfile;collections:StyleCollection[];skipped:number} = await response.json();
      if (request.signal.aborted) return;
      setOptions(data.collections);
      setCatalogError(false);
      if (!data.geometry.measuredMaps) {
        setError(t('No ledge pairs in this selection. Choose another collection or fold.'));
        return;
      }
      setSettings(s=>({...s,profile:data.geometry,profileSource:'library'}));
      const messages = [];
      if (manual) messages.push(t('Profile applied to the tunnel preview.'));
      if (data.skipped) messages.push(t('Unreadable or changed maps skipped: {n}',{n:data.skipped}));
      setStatus(messages.join(' '));
    } catch { if (!request.signal.aborted) setError(t('Map index unavailable. Try again after scanning.')); }
    finally { if (!request.signal.aborted) { setBusy(false); busyChanged.current?.(false); } }
  },[setSettings]);

  useEffect(()=>{
    setCollection(snapshot?.collection ?? 'all'); setFold(snapshot?.fold ?? 'all');
    setBusy(false); busyChanged.current?.(false);
    if (!profile && settings.profileSource !== 'builtin') void loadProfile('all','all',false);
    return ()=>{ active.current?.abort(); busyChanged.current?.(false); };
  },[profile,snapshot,settings.profileSource,loadProfile]);

  useEffect(()=>{
    if (!expanded || options!==null) return;
    const request = new AbortController();
    fetch('/api/editor/climb-collections',{signal:request.signal}).then(r=>{
      if (!r.ok) throw Error();
      return r.json();
    }).then((items: StyleCollection[])=>{if (!request.signal.aborted) {setOptions(items);setCatalogError(false);}})
      .catch(()=>{if (!request.signal.aborted) setCatalogError(true);});
    return ()=>request.abort();
  },[expanded,options,reviewRevision]);

  function onLabelChange() {
    active.current?.abort(); setBusy(false); busyChanged.current?.(false);
    setOptions(null); setReviewRevision(n=>n+1);
    setStatus(t('Refresh the profile to include the latest map labels.'));
  }
  const keys = new Set(['all',...(options??[]).map(o=>o.key),collection]);
  const matches = snapshot?.collection===collection && snapshot.fold===fold;

  return <section className="space-y-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
    <div role="status"><AppliedLibraryProfile profile={profile}/>
      {busy && <p>{t('Measuring local climb maps…')}</p>}
      {status && <p className="text-cyan-200">{status}</p>}
      {error && <p className="text-amber-300">{error}</p>}
    </div>
    <details onToggle={e=>setExpanded(e.currentTarget.open)}><summary className="cursor-pointer text-cyan-300">{t('Library style and comparison')}</summary>
      {expanded && <div className="mt-2 space-y-2">
        <label className="block">{t('Source collection')}
          <select className={selectClass} value={collection} disabled={busy} onChange={e=>{
            setCollection(e.target.value);setStatus('');setError('');
          }}>
            {[...keys].map(key=>{
              const option=options?.find(o=>o.key===key);
              const name=displayKey(key,option?.label ?? (key===snapshot?.collection ? snapshot.collectionLabel : undefined));
              return <option key={key} value={key}>{option ? t('{name} · families: {n}',{name,n:count.format(option.count)}) : name}</option>;
            })}
          </select></label>
        {catalogError && <p role="status" className="text-amber-300">{t('Could not load the available collections.')}
          {' '}<button type="button" className="text-cyan-300" onClick={()=>setReviewRevision(n=>n+1)}>{t('Try again')}</button></p>}
        <p>{t('Use favourites or add a shared tag to maps in the browser to create a collection.')}</p>
        <label className="block">{t('Sample for generation')}
          <select className={selectClass} value={fold} disabled={busy} onChange={e=>{
            setFold(e.target.value as StyleFold);setStatus('');setError('');
          }}>
            {(Object.keys(folds) as StyleFold[]).map(key=><option key={key} value={key}>{t(folds[key])}</option>)}
          </select></label>
        {!matches && !busy && <p className="text-zinc-300">{t('Apply this selection to update the preview and its measurements.')}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} className="rounded border border-cyan-800 px-2 py-1 text-cyan-200 disabled:opacity-50"
            onClick={()=>void loadProfile(collection,fold,true)}>{t(matches ? 'Refresh active profile' : 'Apply library style')}</button>
          {profile && <button type="button" disabled={busy} className="text-zinc-300" onClick={()=>{
            setError('');setStatus('');setSettings(s=>({...s,profile:undefined,profileSource:'builtin'}));
          }}>{t('Use built-in profile')}</button>}
        </div>
        {snapshot && <ClimbDistributionTable snapshot={snapshot}/>}
        <ClimbLibraryReview onLabelChange={onLabelChange}/>
        <ClimbModelExperiment key={reviewRevision} collection={collection}/>
      </div>}
    </details>
  </section>;
}
