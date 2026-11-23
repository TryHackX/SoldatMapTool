import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Download, FolderOpen, LoaderCircle } from 'lucide-react';
import type { ArchiveCleanerJob, ArchiveCleanerStatus, ArchiveCleanerSummary } from '@shared/archiveCleanerTypes';
import type { IndexMetaResponse } from '@shared/apiTypes';
import { locale, t, tText } from '../i18n';
import { fetchIndexMeta, openPathInExplorer, pickSystemFolder } from '../utils/mapCache';
import { jobRequest } from '../utils/jobRequest';

const jobsUrl = '/api/archive-cleaner/jobs';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-40';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40';
const statusLabels: Record<ArchiveCleanerStatus, string> = {
  scanning: 'Analysing archive…',
  ready: 'Analysis ready',
  exporting: 'Writing and checking the clean copy…',
  complete: 'Clean copy created',
  cancelled: 'Archive job cancelled',
  failed: 'Archive job failed',
};

const errorText = (error: unknown) => tText(error instanceof Error ? error.message : String(error));
const formatCount = (n: number) => n.toLocaleString(locale);

function ScanSummary({ summary }: { summary: ArchiveCleanerSummary }) {
  const numbers: [string, number][] = [
    ['Input map files', summary.maps],
    ['Maps for export', summary.readyMaps],
    ['Duplicate map copies', summary.duplicateMaps],
    ['Maps requiring review', summary.unresolvedMaps],
    ['Input asset files', summary.assets],
    ['Duplicate asset copies', summary.duplicateAssets],
    ['Names with conflicting content', summary.renamedAssets],
  ];
  if (summary.incompleteMaps) numbers.push(['Exported maps with a missing file report',summary.incompleteMaps]);
  if (summary.repairedProps !== undefined) numbers.push(['Repaired scenery placements', summary.repairedProps]);
  if (summary.repairedSectorMaps) numbers.push(['Maps with repaired collision sectors', summary.repairedSectorMaps]);
  if (summary.recovery) {
    numbers.push(['Previously blocked occurrences recovered',summary.recovery.recovered],['Additional distinct maps',summary.recovery.newOutputs]);
  }
  if (summary.rewrittenReferences !== undefined) numbers.push(['Updated PMS references', summary.rewrittenReferences]);
  if (summary.removedUnusedScenery !== undefined) numbers.push(['Unused PMS scenery entries removed', summary.removedUnusedScenery]);
  return <dl className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3 sm:grid-cols-4">
    {numbers.map(([label, value]) => <div key={label}>
      <dt className="text-[11px] text-zinc-400">{t(label)}</dt>
      <dd className={'mt-0.5 font-mono text-base font-semibold ' + (
        label === 'Maps for export' ? 'text-emerald-300' : label === 'Maps requiring review' && value ? 'text-amber-300' : 'text-zinc-100'
      )}>{formatCount(value)}</dd>
    </div>)}
  </dl>;
}

export function ArchiveCleanerPanel({ onMetaUpdated }: { onMetaUpdated: (meta: IndexMetaResponse) => void }) {
  const [source, setSource] = useState('');
  const [includeLoose, setIncludeLoose] = useState(true);
  const [includeMissing,setIncludeMissing]=useState(true);
  const [includeInstalledMaps,setIncludeInstalledMaps]=useState(false);
  const [includeArchives, setIncludeArchives] = useState(true);
  const [useCollectionIndex, setUseCollectionIndex] = useState(true);
  const [portableAssetNames, setPortableAssetNames] = useState(true);
  const [shortMapNames,setShortMapNames]=useState(true);
  const [artworkPaths,setArtworkPaths] = useState('');
  const artworkRoots = artworkPaths.split(/\r?\n/).map(p=>p.trim()).filter(Boolean);
  const [job, setJob] = useState<ArchiveCleanerJob | null>(null);
  const [connected, setConnected] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [librarySource, setLibrarySource] = useState<{ jobId: string; path: string } | null>(null);
  const requestVersion = useRef(0);
  const status = job?.status;
  const working = status === 'scanning' || status === 'exporting';
  const locked = pending || adding || working || !connected;
  const jobUrl = job ? jobsUrl + '/' + encodeURIComponent(job.id) : '';

  useEffect(() => {
    const controller = new AbortController();
    setConnected(false);
    setConnectionError('');
    void jobRequest<ArchiveCleanerJob | null>(jobsUrl + '/current', { signal: controller.signal }).then(current => {
      if (controller.signal.aborted) return;
      setJob(current);
      if (current) {
        setSource(current.source);
        setIncludeMissing(current.includeMissing??true);
        setIncludeInstalledMaps(current.includeInstalledMaps??false);
        setIncludeArchives(current.includeArchives);
        setIncludeLoose(current.includeLoose);
        setUseCollectionIndex(current.useCollectionIndex);
        setPortableAssetNames(current.portableAssetNames === true);
        setShortMapNames(current.shortMapNames===true);
        setArtworkPaths((current.artworkRoots ?? []).join('\n'));
      }
      setConnected(true);
    }).catch(e => { if (!controller.signal.aborted) setConnectionError(errorText(e)); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!working || !connected || pending) return;
    const controller = new AbortController();
    const version = requestVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await jobRequest<ArchiveCleanerJob>(jobUrl, { signal: controller.signal });
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setJob(next);
        setConnectionError('');
        if (next.status !== 'scanning' && next.status !== 'exporting') return;
      } catch (e) {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setConnectionError(errorText(e));
      }
      timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 900);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [jobUrl, working, connected, pending]);

  async function postJob(url: string, body?: object) {
    requestVersion.current++;
    setPending(true);
    setError('');
    setConnectionError('');
    try {
      const next = await jobRequest<ArchiveCleanerJob>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      setJob(next);
      setSource(next.source);
      setIncludeMissing(next.includeMissing??true);
      setIncludeInstalledMaps(next.includeInstalledMaps??false);
      setIncludeArchives(next.includeArchives);
      setIncludeLoose(next.includeLoose);
      setUseCollectionIndex(next.useCollectionIndex);
      setPortableAssetNames(next.portableAssetNames === true);
      setShortMapNames(next.shortMapNames===true);
      setArtworkPaths((next.artworkRoots ?? []).join('\n'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  function startScan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!locked && source.trim() && (includeLoose || includeArchives)) {
      void postJob(jobsUrl, { source: source.trim(), includeLoose, includeArchives, useCollectionIndex, portableAssetNames,shortMapNames, artworkRoots,includeMissing,includeInstalledMaps });
    }
  }

  async function addToLibrary() {
    if (!job || job.status !== 'complete' || pending || adding) return;
    setAdding(true);
    setError('');
    try {
      const response = await jobRequest<{ sourceId: string; path: string }>(jobUrl + '/library', { method: 'POST' });
      setLibrarySource({ jobId: job.id, path: response.path });
      onMetaUpdated(await fetchIndexMeta());
    } catch (e) { setError(errorText(e)); }
    finally { setAdding(false); }
  }

  const matchesForm = job && source.trim() === job.source && includeLoose === job.includeLoose &&
    includeMissing === !!job.includeMissing && includeInstalledMaps === !!job.includeInstalledMaps &&
    includeArchives === job.includeArchives && useCollectionIndex === job.useCollectionIndex && portableAssetNames === (job.portableAssetNames === true) && shortMapNames===!!job.shortMapNames &&
    JSON.stringify(artworkRoots) === JSON.stringify(job.artworkRoots ?? []);
  const reportReady = status === 'ready' || status === 'complete';
  const issues = job?.summary?.issues ?? 0;
  const phase = job?.progress?.phase;
  const progressTitle = phase === 'libraries' ? 'Checking additional artwork libraries…' : phase === 'resolve' ? 'Matching maps and assets…' :
    phase === 'repair' ? 'Preparing compatible map copies…' : status && statusLabels[status];
  const mapCounter = phase === 'export' ? 'Maps written: {n}' :
    phase === 'resolve' || phase === 'repair' ? 'Maps processed in this phase: {n}' : 'Maps found: {n}';

  return <section aria-label={t('Clean archive')} className="space-y-4 text-xs text-zinc-300">
    <p className="max-w-2xl leading-relaxed">{t('Identical assets can share a file. Different graphics with the same name get separate filenames and updated PMS references. Export writes the checked maps to a new folder.')}</p>
    <form className="space-y-3" onSubmit={startScan}>
      <div className="space-y-1.5">
        <label htmlFor="archive-source" className="font-semibold text-zinc-100">{t('Source archive folder')}</label>
        <div className="flex flex-wrap gap-2">
          <input id="archive-source" type="text" autoComplete="off" spellCheck={false} value={source} disabled={locked}
            onChange={e => setSource(e.target.value)}
            placeholder={t('Absolute path on this computer')}
            className="min-w-40 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"/>
          <button type="button" className={button} disabled={locked} onClick={async () => {
            setPending(true);
            try {
              const path = await pickSystemFolder(t('Choose the source archive folder'));
              if (path) setSource(path);
            } catch (e) { setError(errorText(e)); }
            finally { setPending(false); }
          }}><FolderOpen size={15}/>{t('Browse folders')}</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeLoose} disabled={locked}
          onChange={e => setIncludeLoose(e.target.checked)}/>{t('Loose maps and assets')}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeArchives} disabled={locked}
          onChange={e => setIncludeArchives(e.target.checked)}/>{t('Compressed packages')}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={useCollectionIndex && includeLoose} disabled={locked || !includeLoose}
          onChange={e => setUseCollectionIndex(e.target.checked)}/>{t('Use the SMA collection index when available')}</label>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeInstalledMaps} disabled={locked}
          onChange={e=>setIncludeInstalledMaps(e.target.checked)}/>{t('Merge maps from my Soldat installation')}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeMissing} disabled={locked}
          onChange={e=>setIncludeMissing(e.target.checked)}/>{t('Include maps with missing artwork and write missing/<map>.txt')}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={shortMapNames} disabled={locked}
          onChange={e=>setShortMapNames(e.target.checked)}/>{t('Limit map filenames to 16 characters before .pms')}</label>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={portableAssetNames} disabled={locked}
          aria-describedby="portable-asset-names" onChange={e => setPortableAssetNames(e.target.checked)}/>{t('Append a content hash to asset names')}</label>
        <p id="portable-asset-names" className="pl-5 text-[11px] text-zinc-400">
          {t('Recommended when installing alongside existing maps. Unique names keep local HD textures from replacing archived art.')}</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="artwork-libraries" className="font-semibold text-zinc-100">{t('Additional artwork libraries')}</label>
        <textarea id="artwork-libraries" rows={2} disabled={locked} value={artworkPaths} spellCheck={false}
          onChange={e=>setArtworkPaths(e.target.value)} aria-describedby="artwork-help"
          className="block w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"/>
        <p id="artwork-help" className="text-[11px] text-zinc-400">{t('Optional. Enter one game folder or map pack per line to look for missing artwork.')}</p>
      </div>
      <button type="submit" disabled={locked || !source.trim() || !(includeLoose || includeArchives)} className={button}>
        {t('Analyse archive')}
      </button>
    </form>

    {connectionError && <div role="alert" className="flex flex-wrap items-center gap-3 text-amber-200">
      <span>{t('Could not read the archive job.')} {connectionError}</span>
      <button type="button" onClick={() => setRefresh(n => n + 1)} className={button}>{t('Reconnect')}</button>
    </div>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {job && <div className="space-y-3 border-t border-zinc-800 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 role="status" className="flex items-center gap-2 font-semibold text-zinc-100">
            {working && <LoaderCircle size={14} className="animate-spin text-emerald-400"/>}
            {t(progressTitle ?? statusLabels[job.status])}
          </h3>
          <p className="mt-1 break-all font-mono text-[11px] text-zinc-400">{job.source}</p>
        </div>
        {working && <button type="button" onClick={() => void postJob(jobUrl + '/cancel')} disabled={pending} className={button}>
          {t('Cancel archive job')}
        </button>}
      </div>
      {working && <div className="space-y-1 text-zinc-400">
        {job.progress?.entries !== undefined && <p>{t(phase === 'export' ? 'Files written: {n}' : 'Files read: {n}', { n: formatCount(job.progress.entries) })}
          {job.progress.maps !== undefined && ' · ' + t(mapCounter, { n: formatCount(job.progress.maps) })}</p>}
        {job.progress?.current && <p className="break-all font-mono text-[11px]">{job.progress.current}</p>}
        <p>{t('You can close this panel and return to the running job.')}</p>
      </div>}
      {job.error && <p role="alert" className="text-red-300">{tText(job.error)}</p>}
      {job.summary && <ScanSummary summary={job.summary}/>}
      {job.summary?.recovery && <p className="text-zinc-300">{t(
        'Confirmed {count} of {reviewed} previously unresolved entries, including {matched} of {candidates} with comparison candidates.',
        {count: formatCount(job.summary.recovery.recovered), reviewed: formatCount(job.summary.recovery.reviewed),
         matched: formatCount(job.summary.recovery.recoveredWithCandidates), candidates: formatCount(job.summary.recovery.withCandidates)}
      )}</p>}
      {(issues > 0 || !!job.examples?.length) && <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2.5">
        <p className="flex items-center gap-2 font-semibold text-amber-200"><AlertTriangle size={15}/>{t('Review archive issues')}</p>
        {!!job.summary?.coverageIssues && <p>{t('Unreadable or skipped archive entries: {n}', { n: formatCount(job.summary.coverageIssues) })}</p>}
        <p>{t('The report lists missing files and conflicting versions. Check the source paths, supply the matching assets in a working copy, then analyse it again.')}</p>
        {!!job.examples?.length && <details><summary className="cursor-pointer text-amber-200">{t('Show examples')}</summary>
          <ul className="mt-2 max-h-40 space-y-2 overflow-auto">{job.examples.map((item, i) =>
            <li key={i}><code className="block break-all text-zinc-300">{item.path}</code><span className="break-words text-zinc-400">{item.reason.split(' · ').map(tText).join(' · ')}</span></li>)}</ul>
        </details>}
      </div>}
      {reportReady && <div className="space-y-2">
        {status === 'ready' && <p className="leading-relaxed">{matchesForm ?
          t(job.includeMissing?'Maps with incomplete artwork go into maps/. Read their file lists in missing/. Damaged PMS files stay in review/.':'Only maps with resolved assets enter the clean copy. Each map gets a lowercase .pms extension. The export uses a new folder in your configured exports directory.') :
          t('The source or scan options have changed. Analyse again to export this selection.')}</p>}
        {job.outputPath && <p className="break-all font-mono text-emerald-300">{job.outputPath}</p>}
        <div className="flex flex-wrap gap-2">
          {status === 'ready' && <button type="button" disabled={!matchesForm || !job.summary?.readyMaps || pending}
            className={primary} onClick={() => void postJob(jobUrl + '/export')}>{t('Export clean copy')}</button>}
          {job.outputPath && <button type="button" className={primary} onClick={() => void openPathInExplorer(job.outputPath!)}>
            <FolderOpen size={14}/>{t('Open folder')}</button>}
          {job.status==='complete' && <a href={jobUrl+'/game.zip'} download className={button}>
            <Download size={14}/>{t('Download game ZIP')}</a>}
          {job.status==='complete' && job.versionsReport && <a href={jobUrl+'/versions.csv'} download className={button}>
            <Download size={14}/>{t('Map versions and dates (CSV)')}</a>}
          {job.status === 'complete' && <button type="button" className={button} disabled={pending || adding} onClick={() => void addToLibrary()}>
            {t(adding ? 'Adding maps to the library…' : 'Add exported maps to the library')}</button>}
          <a href={jobUrl + '/report'} download className={button}><Download size={14}/>{t('Download archive report (JSON)')}</a>
          {!!job.summary?.unresolvedMaps && <a href={jobUrl + '/review.csv'} download className={button}>
            <Download size={14}/>{t('Maps requiring review (CSV)')}</a>}
          {job.summary?.recovery && <a href={jobUrl + '/recovery.csv'} download className={button}>
            <Download size={14}/>{t('Recovery decisions (CSV)')}</a>}
          {job.summary?.artworkRecovery && <a href={jobUrl + '/artwork.csv'} download className={button}>
            <Download size={14}/>{t('Missing artwork decisions (CSV)')}</a>}
        </div>
        {librarySource?.jobId === job.id && <p role="status" className="break-words text-emerald-300">
          {t('Library source added. Filter the map browser by source or prefix.')} <code className="break-all">{librarySource.path}</code>
        </p>}
      </div>}
    </div>}
  </section>;
}
