import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns2, X } from 'lucide-react';
import type { MapQueryRequest } from '@shared/apiTypes';
import { similarityCriteria, type DraftFilter, type LibraryPair, type SimilarityCriterion } from '@shared/librarySimilarity';
import { locale, t, tText } from '../i18n';
import { jobRequest } from '../utils/jobRequest';
import { useModalDismiss } from '../utils/useModalDismiss';
import { SimilarityPairPreview } from './SimilarityPairPreview';

const labels: Record<SimilarityCriterion, string> = {
  names: 'Map names',
  shape: 'Terrain shape',
  sceneryNames: 'Scenery filenames',
  sceneryImages: 'Scenery image appearance',
  texture: 'Ground texture',
  counts: 'Object counts',
};
const initialCriteria = { names: true, shape: true, sceneryNames: true, sceneryImages: false, texture: false, counts: false };
const imageCriteria = { names: false, shape: false, sceneryNames: false, sceneryImages: true, texture: false, counts: false };
const spriteKeys: SimilarityCriterion[] = ['sceneryNames', 'sceneryImages'];
type Scope = 'pack' | 'filter' | 'current';
type SearchMode = 'maps' | 'sceneries';
type Job = { id: string; status: 'running' | 'complete' | 'failed' | 'cancelled'; done: number; total: number; error?: string;
  resultCount?: number; truncated?: boolean; approximate?: boolean; results?: LibraryPair[] };
type Props = { open: boolean; onClose: () => void; ids: string[]; query: MapQueryRequest; totalFiltered: number;
  activeId: string | null; activeName?: string; onOpenMap: (id: string) => void };
const jobsUrl = '/api/library/similar/jobs';
const pageSize = 20;
const button = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40';
function pairKey(pair: LibraryPair) {
  const asset = pair.kind === 'scenery' && pair.sceneries[0];
  return JSON.stringify([pair.leftId, pair.rightId, asset && asset.left, asset && asset.right]);
}

export function MapSimilarityModal({ open, onClose, ids, query, totalFiltered, activeId, activeName, onOpenMap }: Props) {
  const [choice, setChoice] = useState<Scope | null>(null);
  const [mode, setMode] = useState<SearchMode>('maps');
  const [mapCriteria, setMapCriteria] = useState(initialCriteria);
  const [sceneryCriteria, setSceneryCriteria] = useState(imageCriteria);
  const criteria = mode === 'maps' ? mapCriteria : sceneryCriteria;
  const setCriteria = mode === 'maps' ? setMapCriteria : setSceneryCriteria;
  const [threshold, setThreshold] = useState(80);
  const [draftFilter, setDraftFilter] = useState<DraftFilter>('all');
  const [againstLibrary, setAgainstLibrary] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [offset, setOffset] = useState(0);
  const [pairIndex, setPairIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [needsRetry, setNeedsRetry] = useState(false);
  const [retry, setRetry] = useState(0);
  const [runSettings, setRunSettings] = useState('');
  const version = useRef(0);
  const requestLock = useRef(false);
  const jobId = job?.id;
  const running = job?.status === 'running';
  const canUseChoice = choice && (choice !== 'pack' || ids.length > 0) && (choice !== 'current' || !!activeId);
  const scope = canUseChoice ? choice : (ids.length ? 'pack' : 'filter');
  const size = scope === 'filter' ? totalFiltered : scope === 'pack' ? ids.length : Number(!!activeId);
  const soloMap = mode === 'maps' && scope !== 'filter' && size === 1;
  const canSearchOutside = size > 0 && !soloMap;
  const compareOutsidePack = canSearchOutside && againstLibrary;
  const payload = useMemo(() => JSON.stringify({ ids: scope === 'pack' ? ids : scope === 'current' && activeId ? [activeId] : [],
    query: scope === 'filter' ? query : undefined, mode, criteria, threshold, draftFilter, againstLibrary: compareOutsidePack }),
    [scope, ids, activeId, query, mode, criteria, threshold, draftFilter, compareOutsidePack]);
  const changed = !!job && payload !== runSettings;
  const backdrop = useModalDismiss(open, onClose, false);

  useEffect(() => {
    if (!open || !jobId || pending) return;
    const controller = new AbortController();
    const current = version.current;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await jobRequest<Job>(jobsUrl + '/' + encodeURIComponent(jobId!) + '?offset=' + offset + '&limit=' + pageSize,
          { signal: controller.signal });
        if (controller.signal.aborted || current !== version.current) return;
        setJob(next);
        setError('');
        setNeedsRetry(false);
        if (next.status === 'running') timer = setTimeout(poll, 1100);
      } catch (e) {
        if (controller.signal.aborted || current !== version.current) return;
        setError(tText(e instanceof Error ? e.message : String(e)));
        setNeedsRetry(true);
      }
    }
    void poll();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, jobId, pending, offset, retry]);

  async function submit(cancel: boolean) {
    if (requestLock.current) return;
    requestLock.current = true;
    version.current++;
    setPending(true);
    setError('');
    setNeedsRetry(false);
    try {
      const next = await jobRequest<Job>(cancel ? jobsUrl + '/' + encodeURIComponent(job!.id) + '/cancel' : jobsUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cancel ? '{}' : payload,
      });
      if (!cancel) { setRunSettings(payload); setOffset(0); setPairIndex(0); }
      setJob(next);
    } catch (e) { setError(tText(e instanceof Error ? e.message : String(e))); }
    finally { setPending(false); requestLock.current = false; }
  }

  if (!open) return null;
  const pairs = job?.results ?? [];
  const count = job?.resultCount ?? pairs.length;
  const pair = pairs[pairIndex];
  const oneFilteredMap = mode === 'maps' && scope === 'filter' && size === 1 && !compareOutsidePack;
  const canSearch = size > 0 && !oneFilteredMap && Object.values(criteria).some(Boolean) && !pending && !running;
  const selectPage = (next: number) => {
    setPairIndex(0); setOffset(next);
    setJob(j => j && { ...j, results: undefined });
  };

  return <div {...backdrop} aria-labelledby="similar-maps-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-xs text-zinc-300 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/70 px-5 py-3">
        <h2 id="similar-maps-title" className="flex items-center gap-2 text-base font-bold text-zinc-100">
          <Columns2 size={18} className="text-emerald-400"/>{t('Find similar to selected')}
        </h2>
        <button type="button" title={t('Close')} aria-label={t('Close')} onClick={onClose} className="rounded p-1.5 hover:bg-zinc-800"><X size={17}/></button>
      </div>
      <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
        <fieldset disabled={pending || running} className="space-y-3">
          <div role="group" aria-label={t('Find similar items')} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-200">{t('Find similar items')}</span>
            {(['maps', 'sceneries'] as const).map(option => <button type="button" key={option} aria-pressed={mode === option}
              onClick={() => setMode(option)} className={'rounded-md border px-3 py-1.5 font-semibold ' + (mode === option ?
                'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200')}>
              {t(option === 'maps' ? 'Map pairs' : 'Scenery files')}</button>)}
          </div>
          <label className="flex flex-wrap items-center gap-2 font-semibold text-zinc-200">
            {t('Maps to compare')}
            <select value={scope} onChange={e => setChoice(e.target.value as Scope)} className="max-w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5">
              <option value="pack" disabled={!ids.length}>{t('Checked maps ({n})', { n: ids.length.toLocaleString(locale) })}</option>
              <option value="filter">{t('Whole current filter ({n})', { n: totalFiltered.toLocaleString(locale) })}</option>
              <option value="current" disabled={!activeId}>{t('Current map ({name})', { name: activeName ?? '—' })}</option>
            </select>
          </label>
          {canSearchOutside &&
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={againstLibrary} onChange={e => setAgainstLibrary(e.target.checked)}/>
              {t('Also compare with the rest of the library')}</label>}
          <p className="text-zinc-400">{mode === 'sceneries'
            ? t(compareOutsidePack ? 'Compares scenery from these maps with artwork used across the library.' : 'Finds pairs of scenery files used by these maps, including files inside the same map.')
            : t(oneFilteredMap ? 'One map matches this filter. Enable comparison with the rest of the library to find pairs.'
              : compareOutsidePack ? 'Each result includes at least one map from this group.' : soloMap ? 'Compares this map with other maps in the library.'
              : 'Looks for similar pairs within this group. The current filter includes every matching page.')}</p>
          <fieldset className="space-y-2">
            <legend className="font-semibold text-zinc-200">{t('Compare by')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{(mode === 'maps' ? similarityCriteria : spriteKeys).map(key =>
              <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={criteria[key]}
                onChange={e => setCriteria(old => ({ ...old, [key]: e.target.checked }))}/>{t(labels[key])}</label>)}</div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2">{t('Minimum similarity')}
              <input type="range" min={0} max={100} step={1} value={threshold} onChange={e => setThreshold(Number(e.target.value))}
                className="w-24 accent-emerald-500"/><span className="w-12 font-mono">{threshold}/100</span>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              {t(mode === 'sceneries' ? 'Draft markers in scenery filenames' : 'Draft markers in names')}
              <select value={draftFilter} onChange={e => setDraftFilter(e.target.value as DraftFilter)}
                className="max-w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5">
                <option value="all">{t('Show all pairs')}</option>
                <option value="only">{t('Only pairs with a draft marker')}</option>
                <option value="exclude">{t('Hide pairs with a draft marker')}</option>
              </select>
            </label>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!canSearch} className="rounded-md bg-emerald-600 px-3.5 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
            onClick={() => void submit(false)}>{t(mode === 'sceneries' ? 'Compare scenery files' : 'Compare maps')}</button>
          {running && <button type="button" disabled={pending} className={button} onClick={() => void submit(true)}>{t('Cancel search')}</button>}
          {running && <span role="status" className="font-mono text-zinc-400">{t('Processing {done} / {total}', { done: job!.done.toLocaleString(locale), total: job!.total.toLocaleString(locale) })}</span>}
          {job?.status === 'cancelled' && <span role="status">{t('Search cancelled.')}</span>}
          {changed && !running && <span className="text-amber-200">{t('Run again to apply the new selection or settings.')}</span>}
        </div>
        {(error || job?.error) && <p role="alert" className="space-x-2 text-amber-200"><span>{error || tText(job!.error!)}</span>
          {needsRetry && <button type="button" onClick={() => setRetry(v => v + 1)} className={button}>{t('Retry')}</button>}</p>}
        {job?.status === 'complete' && <div className="space-y-3 border-t border-zinc-800 pt-3">
          <h3 role="status" className="font-semibold text-zinc-100">{t('Matching pairs: {n}', { n: count.toLocaleString(locale) })}</h3>
          {job.truncated && <p className="text-amber-200">{t('Showing the highest-ranked matches retained for this search.')}</p>}
          {job.approximate && <p className="text-zinc-400">{t('This large search shortlisted candidate pairs first. Other matches may exist.')}</p>}
          {count === 0 && <p className="text-zinc-400">{t('Try a lower score or different comparison criteria.')}</p>}
          {count > 0 && <div className="grid gap-4 md:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)]">
            <div className="min-w-0 space-y-2">
              <ul className="max-h-64 divide-y divide-zinc-800 overflow-y-auto rounded border border-zinc-800 md:max-h-96">
                {pairs.map((p, i) => <li key={pairKey(p)}>
                  <button type="button" aria-pressed={pairIndex === i} onClick={() => setPairIndex(i)}
                    className={'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-800 ' + (pairIndex === i ? 'bg-emerald-950/70 text-emerald-200' : '')}>
                    <span className="min-w-0"><span className="block break-all">{p.kind === 'scenery' ? p.sceneries[0]?.left : p.leftName}</span>
                      <span className="block break-all text-zinc-400">{p.kind === 'scenery' ? p.sceneries[0]?.right : p.rightName}</span></span>
                    <span className="font-mono">{p.score}</span>
                  </button>
                </li>)}
              </ul>
              {count > pageSize && <div className="flex items-center justify-between gap-2">
                <button type="button" aria-label={t('Previous page')} className={button} disabled={offset === 0}
                  onClick={() => selectPage(Math.max(0, offset - pageSize))}><ChevronLeft size={14}/></button>
                <span>{t('Page {n} of {total}', { n: Math.floor(offset / pageSize) + 1, total: Math.ceil(count / pageSize) })}</span>
                <button type="button" aria-label={t('Next page')} className={button} disabled={offset + pageSize >= count}
                  onClick={() => selectPage(offset + pageSize)}><ChevronRight size={14}/></button>
              </div>}
            </div>
            {pair && <SimilarityPairPreview key={pairKey(pair)} pair={pair} labels={labels} onOpenMap={onOpenMap}/>}
          </div>}
        </div>}
      </div>
    </div>
  </div>;
}
