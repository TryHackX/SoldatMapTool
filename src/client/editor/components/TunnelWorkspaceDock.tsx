import { useEffect, useRef, type ReactNode } from 'react';
import type { TunnelPoint } from '@shared/climbTunnel';
import type { TunnelTrialResult } from '../tunnelTrial';
import type { PmsBounds, PmsMapData } from '@shared/pmsParser';
import { ProjectRouteTrial } from './ProjectRouteTrial';
import { t } from '../../i18n';
import type { useTunnelWorkspace } from '../useTunnelWorkspace';
import { TunnelProjectPanel } from './TunnelProjectPanel';
import { TunnelSectionVariantsPanel } from './TunnelSectionVariantsPanel';
import { TunnelPacePanel } from './TunnelPacePanel';
import { Timer } from 'lucide-react';
import { ClimbStopRepairPanel } from './ClimbStopRepairPanel';
import { ClimbMoveLibrary } from './ClimbMoveLibrary';

interface Props {
  workspace: ReturnType<typeof useTunnelWorkspace>;
  map: PmsMapData;
  locked: boolean;
  focus: (bounds: Pick<PmsBounds,'left'|'right'|'top'|'bottom'>) => void;
  children: ReactNode;
}

export function TunnelWorkspaceDock({workspace:w,map,locked,focus,children}: Props) {
  const variantPane = useRef<HTMLDivElement>(null);
  const reportPane = useRef<HTMLDivElement>(null);
  const editPane = useRef<HTMLDivElement>(null);
  const scrollTo = useRef<'variants'|'report'|'repair'|null>(null);
  useEffect(() => {
    const target = scrollTo.current === 'variants' && w.comparing ? variantPane.current :
      scrollTo.current === 'repair' && w.repair ? editPane.current :
      scrollTo.current === 'report' && !w.comparing ? reportPane.current : null;
    if (target) {
      scrollTo.current=null;
      target.focus({preventScroll:true});
      target.scrollIntoView({block:'nearest'});
    }
  },[w.comparing,w.planning,w.repair]);
  const tunnels = map.editorTunnels;
  if (!tunnels?.length) return <>{children}</>;
  const {project,point,knotIndex} = w;
  function frame(knot = knotIndex, stop?: TunnelPoint) {
    if (!project || !point) return;
    const local=[project.knots[knot-1],knot===knotIndex ? point : project.knots[knot],project.knots[knot+1]];
    if (stop) local.push(stop);
    const pad=project.settings.clearance;
    focus({left:Math.min(...local.map(p=>p.x))-pad,right:Math.max(...local.map(p=>p.x))+pad,
      top:Math.min(...local.map(p=>p.y))-pad,bottom:Math.max(...local.map(p=>p.y))+pad});
  }
  function inspect(knot:number, stop?:TunnelPoint, trial?:TunnelTrialResult) {
    scrollTo.current='variants';
    w.compareSplit(knot,trial,stop);
    frame(knot,stop);
  }
  function openPlanner() {
    if (!project) return;
    w.openPlanner();
    const pad = project.settings.clearance;
    const xs = project.knots.map(p=>p.x), ys = project.knots.map(p=>p.y);
    focus({left:Math.min(...xs)-pad,right:Math.max(...xs)+pad,top:Math.min(...ys)-pad,bottom:Math.max(...ys)+pad});
  }
  return <div className="space-y-3">
    <label className="block space-y-1 text-xs font-medium text-zinc-300">
      <span>{t('Tunnel on this map')}</span>
      <select className="w-full rounded-md border border-zinc-700 bg-zinc-950 p-2" disabled={w.modified}
        value={w.index ?? 'new'} onChange={e=>w.choose(e.target.value==='new' ? null : Number(e.target.value))}>
        {tunnels.map((v,i)=><option key={v.id} value={i}>{t('Tunnel {n} · seed {seed}',{n:i+1,seed:v.settings.seed})}</option>)}
        <option value="new">{t('Draw another tunnel')}</option>
      </select>
    </label>
    {project && w.planning ? <TunnelPacePanel map={map} project={project} locked={locked} onClose={w.cancel}
      onReviewCurrent={(trial,knot,stop)=>inspect(knot,stop,trial)}
      onApply={(result,settings)=>{if (!locked) {scrollTo.current='report'; w.applyPlan(result,settings);}}}/> :
    project && point ? <>
      <button type="button" disabled={w.modified} onClick={openPlanner}
        title={w.modified ? t('Apply or cancel the section edit before planning this route.') : undefined}
        className="flex w-full items-center gap-2 rounded-md border border-cyan-800/70 bg-cyan-950/50 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-950 disabled:opacity-40">
        <Timer size={15} aria-hidden="true"/>{t('Route time planner')}
      </button>
      {!w.comparing && (!w.modified || w.preview?.ok) && <div ref={reportPane} tabIndex={-1}>
        <ProjectRouteTrial map={w.preview?.ok ? w.preview.map : map}
          project={w.preview?.ok ? w.preview.project : project} knotIndex={knotIndex} pending={w.modified} full={w.fullRun}
          onChooseVariant={w.modified || locked ? undefined : inspect}
          onLocate={({x,y})=>focus({left:x-100,right:x+100,top:y-65,bottom:y+65})}/>
        {!locked && !w.modified && !w.fullRun.busy && w.fullRun.report && !w.fullRun.report.trial.reached &&
          <ClimbStopRepairPanel source={{map,project,trial:w.fullRun.report.trial,sketch:w.fullRun.report.sketch}}
            onPreview={candidate=>{
              const report=w.fullRun.report;
              if(!report || locked) return;
              scrollTo.current='repair';
              w.stageRepair({map,project,trial:report.trial,sketch:report.sketch},candidate);
              frame(candidate.knot);
            }}/>}
      </div>}
      <div ref={editPane} tabIndex={-1}><TunnelProjectPanel project={project} knotIndex={knotIndex} point={point}
      landingHeight={w.landingHeight} landingReach={w.landingReach} repairing={!!w.repair} bounce={w.bounce} widthOffset={w.widthOffset} preview={w.preview} locked={locked}
      onSelectKnot={w.selectKnot} onChange={patch=>w.setSection(knotIndex,patch)} onApply={()=>{
        if (!locked) { if(w.repair) scrollTo.current='report'; w.apply(); }
      }}
      onCancel={w.cancel} onFrame={()=>frame()} comparing={w.comparing} onCompare={open=>{w.setComparing(open); if (open) frame();}}
      variants={w.comparing && <div ref={variantPane} tabIndex={-1}>
        <TunnelSectionVariantsPanel key={project.id + ':' + knotIndex} map={map} project={project}
          knotIndex={knotIndex} locked={locked} selected={w.variant} fromSplit={w.fromSplit} recheckRoute={!!w.fullRun.report} onPreview={w.selectVariant}
          onApply={candidate=>{if (!locked) {if (w.fullRun.report) scrollTo.current='report'; w.apply(candidate);}}}
          onClose={()=>{if (w.fromSplit) scrollTo.current='report'; w.setComparing(false);}}/>
      </div>}/></div>
      <ClimbMoveLibrary/>
    </> : children}
  </div>;
}
