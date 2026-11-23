import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { computeMapBounds, createPolygonFromPoints } from '../src/shared/pmsCompiler';
export function benchMap(count:number) {
  const map=createMapFromTemplate('empty');
  map.polygons=Array.from({length:count},(_,i)=>{
    const x=i%100*12,y=Math.floor(i/100)*12;
    return createPolygonFromPoints([{x,y},{x:x+11,y:y+2},{x:x+2,y:y+11}]);
  });
  return {...map,...computeMapBounds(map)};
}
export function p95(times:number[]) {
  return [...times].sort((a,b)=>a-b)[Math.ceil(times.length*0.95)-1];
}
