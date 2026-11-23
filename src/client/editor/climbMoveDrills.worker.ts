import {measureMoveDrill,type ClimbMove} from './climbMoveDrills';
import {serializePms} from '@shared/pmsParser';

self.onmessage=({data}:MessageEvent<ClimbMove>)=>{
  const {map,attempts,total}=measureMoveDrill(data);
  const {bgColorTop:top,bgColorBtm:bottom,spawnpoints,polygons}=map;
  const bytes=serializePms(map);
  self.postMessage({draft:{background:{top,bottom},polygons,spawnpoints,centerline:[]},attempts,total,bytes});
};
