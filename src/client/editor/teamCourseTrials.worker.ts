import type { PmsMapData } from '@shared/pmsParser';
import { checkTeamCourse } from './teamCourseTrials';

self.onmessage=({data}:MessageEvent<{map:PmsMapData;mode:'ctf'|'trenchwars'}>)=>{
  self.postMessage(checkTeamCourse(data.map,data.mode));
};
