import type { PmsMapData, PmsPolygon } from './pmsParser';
import { doesPolyCollideSoldier, SOLDIER_COLLISION } from './soldatConstants';

type Point={x:number;y:number};

/** Intersect the actual exported mesh, merging the internal diagonals of adjacent faces. */
function surfacesAt(polygons: readonly PmsPolygon[], x: number) {
  const solids: {top:number;bottom:number}[]=[];
  for (const p of polygons) {
    if (!doesPolyCollideSoldier(p.polyType,1,false)) continue;
    const hits:number[]=[];
    for (let i=0;i<3;i++) {
      const a=p.vertices[i],b=p.vertices[(i+1)%3];
      if ((a.x<=x && x<b.x) || (b.x<=x && x<a.x)) hits.push(a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x));
    }
    if (hits.length===2) solids.push({top:Math.min(...hits),bottom:Math.max(...hits)});
  }
  const layers:typeof solids=[];
  for (const cell of solids.sort((a,b)=>a.top-b.top)) {
    const previous=layers.at(-1);
    if (previous && cell.top<=previous.bottom+0.001) previous.bottom=Math.max(previous.bottom,cell.bottom);
    else layers.push({...cell});
  }
  return layers;
}

export function surveyTeamCourse(map:PmsMapData) {
  const alpha=map.spawnpoints.find(s=>s.active && s.team===1), bravo=map.spawnpoints.find(s=>s.active && s.team===2);
  const red=map.spawnpoints.find(s=>s.active && s.team===5), blue=map.spawnpoints.find(s=>s.active && s.team===6);
  if (!alpha || !bravo || !red || !blue || blue.x <= red.x) return null;
  const ground:Point[]=[], upper:Point[]=[];
  const runs:{from:number;to:number}[]=[];
  let covered=false, minHeadroom=Infinity;
  const steps=Math.ceil((blue.x-red.x)/18);
  for (let i=0;i<=steps;i++) {
    const x=red.x+(blue.x-red.x)*i/steps, layers=surfacesAt(map.polygons,x), floor=layers.at(-1);
    if (!floor) return null;
    const ceiling=layers.at(-2);
    if (ceiling) {
      const space=floor.top-ceiling.bottom;
      minHeadroom=Math.min(minHeadroom,space);
      if (space < SOLDIER_COLLISION.height+4) return null;
      if (!covered) runs.push({from:x,to:x});
      runs.at(-1)!.to=x;
    }
    covered=!!ceiling;
    ground.push({x,y:floor.top-SOLDIER_COLLISION.height/2-2});
    if (ceiling) upper.push({x,y:layers[0].top-SOLDIER_COLLISION.height/2-2});
  }
  return {ground,upper:[ground[0],...upper,ground.at(-1)!],covered:runs,
    minHeadroom:Number.isFinite(minHeadroom)?minHeadroom:null};
}
