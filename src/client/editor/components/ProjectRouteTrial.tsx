import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Footprints } from 'lucide-react';
import type { TunnelPoint } from '@shared/climbTunnel';
import type { PmsMapData } from '@shared/pmsParser';
import type { TunnelProject } from '@shared/tunnelProject';
import { t } from '../../i18n';
import { prepareProjectTrial } from '../projectTrialRoute';
import type { TunnelTrialResult } from '../tunnelTrial';
import type { useTunnelFullRun } from '../useTunnelFullRun';
import { drawTunnelPreview } from './drawTunnelPreview';
import { TunnelRunSplits } from './TunnelRunSplits';
import { PlayerRunPanel } from './PlayerRunPanel';
import { describeSectionTrial, describeTrial, startTrial } from './tunnelTrialJob';

interface Props {
  map: PmsMapData;
  project: TunnelProject;
  knotIndex: number;
  pending?: boolean;
  full: ReturnType<typeof useTunnelFullRun>;
  onLocate: (point: TunnelPoint) => void;
  onChooseVariant?: (knot: number, point?: TunnelPoint) => void;
}
type LocalResult = ReturnType<typeof prepareProjectTrial> & { trial: TunnelTrialResult };

export function ProjectRouteTrial({map,project,knotIndex,pending,full,onLocate,onChooseVariant}: Props) {
  const job = useRef<Worker | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [localState,setLocalState] = useState<'idle'|'busy'|'error'>('idle');
  const [local,setLocal] = useState<LocalResult | null>(null);
  useEffect(() => {
    setLocalState('idle');
    setLocal(null);
    return () => { job.current?.terminate(); job.current=null; };
  },[map,project,knotIndex]);

  const report = full.report;
  const world = useMemo(() => report ? prepareProjectTrial(map,project,undefined,report.sketch ? 'project' : 'map') : null,
    [map,project,report]);
  const display = local?.request ?? world?.request;
  const trial = local?.trial ?? report?.trial;
  useEffect(() => {
    if (!display || !trial || !canvas.current) return;
    const {map:terrain,centerline,section} = display;
    drawTunnelPreview(canvas.current,{
      polygons:terrain.polygons,centerline:section ? centerline.slice(section.approach,section.exit+1) : centerline,
      spawnpoints:section ? [] : terrain.spawnpoints,background:{top:terrain.bgColorTop,bottom:terrain.bgColorBtm},
    },true,trial,{polygons:[],colliders:terrain.colliders},project.settings.clearance);
  },[display,trial,project.settings.clearance,full.busy]);

  const busy = full.busy || localState==='busy';
  function checkSection() {
    if (busy) return;
    setLocal(null); setLocalState('busy');
    try {
      const input=prepareProjectTrial(map,project,knotIndex);
      job.current=startTrial(input.request,(trial,worker)=>{
        if (job.current!==worker) return;
        job.current=null; setLocalState('idle'); setLocal({...input,trial});
      },worker=>{if (job.current===worker) {job.current=null;setLocalState('error');}});
    } catch { setLocalState('error'); }
  }
  function checkAll(sketch = false) {
    setLocal(null); setLocalState('idle');
    // Keep the pre-edit reference on repeated checks of the same geometry.
    full.measure(map,project,report?.sketch===sketch ? report.reference : undefined,sketch);
  }
  const missingMarkers = report && !report.sketch && !report.trial.reached &&
    (report.trial.reason==='missing-spawn' || report.trial.reason==='missing-flag' || report.trial.reason==='invalid-route');
  const stop = trial && !trial.reached ? trial.trace.at(-1) : undefined;
  return <section aria-label={t('Tunnel pilot')} className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-950/60 p-2.5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <button type="button" disabled={busy} onClick={()=>checkAll()}
        className="inline-flex items-center gap-1.5 rounded border border-emerald-800 px-2 py-1.5 font-medium text-emerald-300 disabled:opacity-50">
        <Footprints size={15} aria-hidden="true"/>{t('Check the entire tunnel')}
      </button>
      <button type="button" disabled={busy} onClick={checkSection}
        className="text-zinc-300 hover:text-white disabled:opacity-50">{t('Check this section')}</button>
      {busy && <button type="button" onClick={()=>{
        job.current?.terminate(); job.current=null; setLocalState('idle'); full.cancel();
      }} className="text-zinc-300 hover:text-white">{t('Cancel')}</button>}
    </div>
    {pending && <p className="text-[11px] text-zinc-400">{t('The movement model uses the section preview and the rest of the map.')}</p>}
    <div role="status" className="text-[11px] text-zinc-200">{busy ? t('Simulating movement…') :
      full.error || localState==='error' ? t('Movement simulation unavailable.') :
      local ? describeSectionTrial(local.trial,knotIndex) : report && describeTrial(report.trial,report.sketch)}</div>
    {!busy && trial && <>
      {!local && report?.sketch && <p className="text-[11px] text-amber-200">{t('This trial runs between the ends of your sketch.')}</p>}
      {!!trial.trace.length && <canvas ref={canvas} width={640} height={205} className="block w-full rounded-md"
        aria-label={t('Route axis and simulated movement through the tunnel')}/>}
      {!local && report && <TunnelRunSplits trial={report.trial} reference={report.reference} onChooseVariant={onChooseVariant}/>}
      {!pending && !local && world && report && !report.sketch && <PlayerRunPanel request={world.request} trial={report.trial} seed={project.settings.seed}/>}
      {stop && <button type="button" onClick={()=>onLocate(stop)}
        className="inline-flex items-center gap-1.5 text-xs text-amber-200 hover:underline">
        <Crosshair size={13}/>{t('Show stopping point on the map')}</button>}
      {!local && missingMarkers && project.spawnpoints?.length && prepareProjectTrial(map,project).usesSketchEnds
        ? <button type="button" onClick={()=>checkAll(true)} className="text-xs text-cyan-300">{t('Check between sketch endpoints')}</button> : null}
    </>}
  </section>;
}
