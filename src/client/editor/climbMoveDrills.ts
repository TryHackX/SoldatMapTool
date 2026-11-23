import { createMapFromTemplate } from '@shared/editorTemplates';
import { createPolygonFromPoints, prepareMapForSave } from '@shared/pmsCompiler';
import { parsePmsFull, serializePms, type PmsMapData } from '@shared/pmsParser';
import { SOLDIER_COLLISION } from '@shared/soldatConstants';
import type { TunnelPoint } from '@shared/climbTunnel';
import { createSoldierPlaytestState, stepSoldierPlaytest } from './soldierPlaytest';
import { EditorSpatialIndex } from './spatialIndex';

interface Pad { left:number; right:number; top:number; end:number; bounce?:number }
const pad = (left:number,right:number,top:number,end = top,bounce?:number): Pad => ({left,right,top,end,bounce});
export const CLIMB_MOVES = {
  jump:{ label:'Running jump', pads:[pad(-80,0,0),pad(65,142,-16)] },
  drop:{ label:'Controlled drop', pads:[pad(-80,0,0),pad(36,112,56)] },
  ramp:{ label:'Ramp takeoff', pads:[pad(-86,0,15,-15),pad(53,128,-37)] },
  spring:{ label:'Type 18 rebound', pads:[pad(-80,0,0),pad(27,84,43,43,2.7),pad(105,175,-14)] },
  shelves:{ label:'Alternating ledges', pads:[pad(-80,0,0),pad(32,104,-31),pad(-60,5,-62),pad(32,105,-93)] },
} as const;
export type ClimbMove = keyof typeof CLIMB_MOVES;
const mid = (p:Pad) => (p.left+p.right)/2;
const surface = (p:Pad,x:number) => p.top+(p.end-p.top)*(x-p.left)/(p.right-p.left);

export function makeMoveDrill(move:ClimbMove): PmsMapData {
  const {pads} = CLIMB_MOVES[move], first=pads[0], last=pads.at(-1)!;
  const map = createMapFromTemplate('empty',{title:'ctf_kz_drill_'+move});
  const startX = first.right-48;
  map.spawnpoints = [[startX,surface(first,startX)-8,1],[startX,surface(first,startX)-16,5],[mid(last),last.top-12,6]]
    .map(([x,y,team],index)=>({x:Math.round(x),y:Math.round(y),team,active:true,index}));
  map.startJet=0;
  map.randomId=6700+Object.keys(CLIMB_MOVES).indexOf(move);
  map.polygons=pads.flatMap(p=>{
    const a={x:p.left,y:p.top}, b={x:p.right,y:p.end};
    const c={x:p.right,y:p.end+10}, d={x:p.left,y:p.top+10};
    const color=p.bounce ? {r:86,g:187,b:248,a:255} : {r:122,g:180,b:165,a:255};
    const options={color,bounciness:p.bounce ?? 1,polyType:p.bounce ? 18 : 0};
    return [createPolygonFromPoints([a,b,c],options),createPolygonFromPoints([a,c,d],options)];
  });
  return prepareMapForSave(map,{geometryDirty:true});
}

export interface DrillAttempt {
  ticks:number; trace:TunnelPoint[]; runup:number; launchSpeed:number; arrivalSpeed:number; landingX:number;
  /** Ground or rebound contacts in order, including the first surface. */
  contacts:number[];
}

function replay(move:ClimbMove,map:PmsMapData,index:EditorSpatialIndex,offset:number,aimOffset:number): DrillAttempt | null {
  const pads=CLIMB_MOVES[move].pads, spawn=map.spawnpoints[0], flag=map.spawnpoints.find(s=>s.team===6)!;
  let state=createSoldierPlaytestState(spawn.x,spawn.y,map), source=0, airborne=false, settled=false;
  let runup=0, launchSpeed=0, arrivalSpeed=0, landingX=0;
  const contacts=[0], trace:TunnelPoint[]=[{x:state.x,y:state.y}];
  for (let ticks=1;ticks<=640;ticks++) {
    const from=pads[source], to=pads[source+1];
    const direction=to ? Math.sign(mid(to)-mid(from)) : 0;
    const lip=direction>0 ? from.right : from.left;
    const drop=move==='drop' || move==='spring' && source===0;
    let dir=0, jump=false;
    if (to && settled && !airborne) {
      dir=state.vx*direction < 2.8-offset/14 ? direction : 0;
      jump=!drop && state.grounded && (lip-state.x)*direction<=offset;
    } else if (settled) {
      const aim=to ? mid(to)+aimOffset : flag.x;
      // Brake early enough to land on the shelf and turn back on the next leg.
      const error=aim-state.x-state.vx*Math.abs(state.vx)/0.30;
      dir=Math.abs(error)>1 ? Math.sign(error) : 0;
    }
    const next=stepSoldierPlaytest(state,{left:dir<0,right:dir>0,jump,crouch:false,jetpack:false},map,index);
    if (ticks%3===0) trace.push({x:next.x,y:next.y});
    if (!settled && next.grounded) settled=true;
    if (to && settled && !airborne && state.grounded && !next.grounded && (jump || drop && (lip-next.x)*direction<2)) {
      airborne=true;
      if (source===0) { runup=Math.abs(state.x-spawn.x); launchSpeed=Math.hypot(next.vx,next.vy); }
    }
    if (to && airborne) {
      const onTop=next.x>=to.left+SOLDIER_COLLISION.halfWidth && next.x<=to.right-SOLDIER_COLLISION.halfWidth &&
        Math.abs(next.y+SOLDIER_COLLISION.height/2-surface(to,next.x))<5;
      const contact=to.bounce ? state.vy>0 && next.vy<0 : next.grounded;
      if (onTop && contact) {
        source++;
        contacts.push(source);
        airborne=!!to.bounce;
        if (to.bounce) launchSpeed=Math.hypot(next.vx,next.vy);
        if (source===pads.length-1) { arrivalSpeed=Math.abs(next.vx); landingX=next.x; }
      }
    }
    if (source===pads.length-1 && next.grounded && Math.hypot(next.x-flag.x,next.y-flag.y)<14) {
      trace.push({x:next.x,y:next.y});
      return {ticks,trace,runup,launchSpeed,arrivalSpeed,landingX,contacts};
    }
    if (next.y>200) return null;
    state=next;
  }
  return null;
}

/** Only complete control sequences on round-tripped PMS contribute to the displayed envelope.
 * Samples vary the takeoff position and target within the landing surface. */
export function measureMoveDrill(move:ClimbMove) {
  const map=parsePmsFull(serializePms(makeMoveDrill(move))), index=new EditorSpatialIndex(map);
  const attempts:DrillAttempt[]=[];
  for (const offset of [4,10,16]) for (const aim of [-8,0,8]) {
    const result=replay(move,map,index,offset,aim);
    if (result) attempts.push(result);
  }
  attempts.sort((a,b)=>a.ticks-b.ticks);
  return {map,attempts,total:9};
}

