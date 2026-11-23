import type {PmsMapData} from '@shared/pmsParser';
import {rebuildTunnelSection,type TunnelProject,type TunnelSectionChange} from '@shared/tunnelProject';
import {prepareProjectTrial} from './projectTrialRoute';
import {runPmsTunnelTrial,type TunnelTrialResult} from './tunnelTrial';

export interface RepairRequest {map:PmsMapData;project:TunnelProject;trial:TunnelTrialResult;sketch:boolean}
const TITLES={
  lower:'Lower the landing', shelf:'Extend the landing edges', spring:'Add lift at takeoff',
  tame:'Soften the rebound', roof:'Open headroom', step:'Ease the rise and extend the landing',
} as const;
export type RepairKind=keyof typeof TITLES;
export const REPAIR_TITLES=TITLES;

export function locateStalledSection(project:TunnelProject,trial:TunnelTrialResult) {
  const row=trial.splits?.find(s=>s.status==='stopped');
  if (trial.reached || !row || trial.reason!=='pilot-stalled' && trial.reason!=='budget') return;
  const first=Math.max(1,row.knotIndex), last=Math.min(project.sections.length,row.lastKnotIndex);
  if (first>last) return;
  let knot=first, distance=Infinity;
  for(let i=first;i<=last;i++){
    const p=project.knots[i], d=Math.hypot(p.x-row.point.x,p.y-row.point.y);
    if(d<distance) {knot=i;distance=d;}
  }
  const entrance=project.knots[Math.max(0,knot-1)],exit=project.knots[knot+1];
  const rise=Math.round(entrance.y-exit.y), span=Math.round(Math.abs(exit.x-entrance.x));
  const landing=project.sections[knot-1];
  const ground=project.faces.filter(f=>f.landing===knot && !f.pinnedLanding);
  const spring=ground.some(f=>(landing.bounce ?? (f.type===18 ? f.rebound : 0))>0);
  return {knot,point:row.point,rise,span,spring};
}

export interface RepairReport {
  kind:RepairKind; knot:number; change:TunnelSectionChange; changedPolygons:number;
  trial?:TunnelTrialResult; rejected?:'manual'|'clearance'|'neighbour'|'unchanged'|'invalid';
}

export function checkStopRepairs({map,project,trial,sketch}:RepairRequest,onResult:(r:RepairReport)=>void) {
  const diagnosis=locateStalledSection(project,trial);
  if (!diagnosis) return;
  const {knot,rise,spring}=diagnosis, original=project.sections[knot-1];
  const lower=Math.max(-30,original.landingHeight-12);
  const reach=Math.min(24,(original.landingReach ?? 0)+14);
  const widen=Math.min(120,(original.widthOffset ?? 0)+18);
  const coefficients=project.settings.profile?.rebounds;
  const impulse=coefficients?.length ? coefficients[Math.floor(coefficients.length/2)] : 1.55;
  const samples:Record<RepairKind,TunnelSectionChange>={
    lower:{landingHeight:lower}, shelf:{landingReach:reach}, roof:{widthOffset:widen},
    spring:{bounce:Math.min(4,Math.max(1.2,impulse)),landingHeight:Math.max(-30,original.landingHeight-4)},
    tame:{bounce:0}, step:{landingHeight:lower,landingReach:reach},
  };
  const styles:RepairKind[]=[spring ? 'tame' : 'spring',rise>0 ? 'lower' : 'roof','shelf','step',rise>0 ? 'roof' : 'lower'];
  for (const kind of styles) {
    const change={...samples[kind],pinGates:true};
    const result=rebuildTunnelSection(map,project,knot,change);
    const report:RepairReport={kind,knot,change,changedPolygons:0};
    if(result.ok){
      if((kind==='spring' || kind==='tame') && !result.project.faces.some(f=>f.landing===knot && !f.pinnedLanding)){
        onResult({...report,rejected:'unchanged'});continue;
      }
      const {request}=prepareProjectTrial(result.map,result.project,undefined,sketch ? 'project':'map');
      report.changedPolygons=result.changedPolygons;
      report.trial=runPmsTunnelTrial(request.map,request.centerline,request.footholds,undefined,request.splitAnchors);
    }else report.rejected=result.reason;
    onResult(report);
  }
}

