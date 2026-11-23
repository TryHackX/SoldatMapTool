import { surveyTeamCourse } from '@shared/teamCourseSurvey';
import { parsePmsFull, serializePms, type PmsMapData } from '@shared/pmsParser';
import { runTunnelTrial, type TunnelTrialResult } from './tunnelTrial';

export type TeamLane = 'ground' | 'upper';
export interface TeamRun {lane:TeamLane; team:'Alpha'|'Bravo'; trial:TunnelTrialResult}

/** Both teams traverse the exported map. A gate across solid terrain cannot certify the other deck. */
export function checkTeamCourse(source:PmsMapData,mode:'ctf'|'trenchwars') {
  const map=parsePmsFull(serializePms(source)), survey=surveyTeamCourse(map);
  const runs:TeamRun[]=[];
  if (!survey) return {runs,cover:0,minHeadroom:null};
  const lanes:TeamLane[]=mode==='ctf'?['ground','upper']:['ground'];
  const reverseTeams:Record<number,number>={1:2,2:1,5:6,6:5};
  // Generated arenas contain ordinary stone only. The reverse start and finish have the
  // same collision rules; remap their roles for the pilot that follows Alpha to Bravo.
  const reverse={...map,spawnpoints:map.spawnpoints.map(s=>({...s,team:reverseTeams[s.team]??s.team}))};
  for (const lane of lanes) {
    const axis=survey[lane];
    runs.push({lane,team:'Alpha',trial:runTunnelTrial(map,axis,[],undefined,false,undefined,true)});
    runs.push({lane,team:'Bravo',trial:runTunnelTrial(reverse,[...axis].reverse(),[],undefined,false,undefined,true)});
  }
  return {runs,cover:survey.covered.length,minHeadroom:survey.minHeadroom};
}
