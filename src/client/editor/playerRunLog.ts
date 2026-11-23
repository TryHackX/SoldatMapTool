import { soldatCrc32, type PmsMapData } from '@shared/pmsParser';
import type { TunnelTrialRequest, TunnelTrialResult } from './tunnelTrial';

const checksum = (value: unknown) =>
  (soldatCrc32(new TextEncoder().encode(JSON.stringify(value))) >>> 0).toString(16).padStart(8,'0');
const coordinate = ({x,y}:{x:number;y:number}) => [Math.fround(x), Math.fround(y)];

/** Use the single-precision collision world and the actual gates. A palette change or a
 * PMS round-trip can reuse the measurements. A changed landing or flag cannot. */
export function playerRunRouteKey(request: TunnelTrialRequest): string {
  const map: PmsMapData = request.map;
  const polys = map.polygons.map(p=>[p.polyType,...p.vertices.flatMap(coordinate),...p.normals.flatMap(coordinate)]);
  const entities = [map.startJetGame,map.colliders.filter(p=>p.active).map(p=>[...coordinate(p),Math.fround(p.radius)]),
    map.spawnpoints.filter(p=>p.active).map(p=>[p.team,Math.trunc(p.x),Math.trunc(p.y)])];
  return checksum([polys,entities])+'-'+checksum([request.centerline.map(coordinate),request.splitAnchors?.map(Math.fround)]);
}

export type PlayerMove = 'ordinary'|'bounce';
export interface PlayerSplit { first:number; last:number; seconds:number; move:PlayerMove }
export interface PlayerRun {
  id:string;
  gameVersion:string;
  reached:boolean;
  seconds:number;
  stoppedAt?:number;
  splits:PlayerSplit[];
  notes:string;
}
export const MAX_PLAYER_RUNS = 250;
const obj = (x:unknown):x is Record<string,unknown> => typeof x==='object' && x!==null;
const duration = (x:unknown):x is number => typeof x==='number' && Number.isFinite(x) && x>0 && x<=86400;
const section = (x:unknown,limit:number):x is number => typeof x==='number' && Number.isInteger(x) && x>=1 && x<=limit;

export function validPlayerRun(x:unknown,sectionCount:number):x is PlayerRun {
  if (!obj(x) || typeof x.id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(x.id) || typeof x.gameVersion!=='string' ||
    !x.gameVersion.trim() || x.gameVersion.length>80 || typeof x.notes!=='string' || x.notes.length>500 ||
    typeof x.reached!=='boolean' || !duration(x.seconds) || !Array.isArray(x.splits) || x.splits.length>sectionCount ||
    (x.reached ? x.stoppedAt!==undefined : !section(x.stoppedAt,sectionCount))) return false;
  let total=0, previous=0;
  for(const split of x.splits) {
    if (!obj(split) || !section(split.first,sectionCount) || !section(split.last,sectionCount) ||
      split.first<=previous || split.last<split.first || (!x.reached && split.last >= (x.stoppedAt as number)) ||
      !duration(split.seconds) || (split.move!=='ordinary' && split.move!=='bounce')) return false;
    previous=split.last; total+=split.seconds;
  }
  return total<=x.seconds+0.01;
}

export function readPlayerRuns(json:string,route:string,count:number):PlayerRun[] {
  if (json.length>2_000_000) throw new Error('size');
  const data:unknown = JSON.parse(json);
  if (!obj(data) || data.format!=='soldat-player-runs-v1' || data.route!==route || !Array.isArray(data.runs) ||
    data.runs.length>MAX_PLAYER_RUNS || !data.runs.every(r=>validPlayerRun(r,count)) ||
    new Set(data.runs.map(r=>r.id)).size!==data.runs.length) throw new Error('format');
  return data.runs;
}

export function comparePlayerRuns(runs:readonly PlayerRun[],pilot:TunnelTrialResult) {
  const completed=pilot.splits?.filter(s=>s.status==='complete' && s.ticks!==undefined) ?? [];
  const times=new Map(completed.map(s=>[s.knotIndex+'-'+s.lastKnotIndex,s.ticks!/60]));
  const differences:Record<PlayerMove,number[]> = {ordinary:[],bounce:[]};
  let timeError=0,finishes=0,playerOnly=0,pilotOnly=0;
  for(const run of runs) {
    if (run.reached && pilot.reached) {finishes++;timeError+=Math.abs(run.seconds-pilot.ticks/60);}
    if (!run.reached && pilot.reached) pilotOnly++;
    if (run.reached && !pilot.reached) playerOnly++;
    for(const s of run.splits) {
      const model = times.get(s.first+'-'+s.last);
      if (model!==undefined) differences[s.move].push(Math.abs(s.seconds-model));
    }
  }
  const error = (values:number[]) => values.length ? values.reduce((sum,x)=>sum+x,0)/values.length : null;
  return {finishes,playerOnly,pilotOnly,finishError:finishes ? timeError/finishes : null,
    ordinaryError:error(differences.ordinary),bounceError:error(differences.bounce)};
}

export function playerRunsBackup(route:string,runs:readonly PlayerRun[], seed:number, trial:TunnelTrialResult) {
  return JSON.stringify({format:'soldat-player-runs-v1',route,seed,
    model:{reached:trial.reached,seconds:trial.ticks/60,reason:trial.reason,splits:trial.splits},runs},null,2);
}
