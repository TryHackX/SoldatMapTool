import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTeamCourse } from '../src/client/editor/teamCourseTrials';
import { recordPmsFlagTrial, followsFlagControls } from '../src/client/editor/tunnelTrial';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { createPolygonFromPoints } from '../src/shared/pmsCompiler';
import { DEFAULT_COURSE,generateCourseMap } from '../src/shared/courseGenerator';
import { surveyTeamCourse } from '../src/shared/teamCourseSurvey';

test('jet on an edited map reaches a raised, sloped landing and its complete input sequence replays', () => {
  const map=createMapFromTemplate('empty');
  const a={x:120,y:-134}, b={x:260,y:-149}, c={x:260,y:-120}, d={x:120,y:-106};
  map.polygons=[...makeQuadPolys(-100,0,60,48),createPolygonFromPoints([a,b,c]),createPolygonFromPoints([a,c,d])];
  map.spawnpoints=[{x:0,y:-20,index:0,team:1,active:true},{x:235,y:-158,index:1,team:6,active:true}];
  const axis=[{x:0,y:-20},{x:37,y:-54},{x:85,y:-117},{x:129,y:-146},{x:235,y:-158}];
  const {trial,controls}=recordPmsFlagTrial({...map,startJet:120},axis,[b]);
  assert.ok(trial.reached && controls && controls.some(mask=>(mask&8)!==0));
  assert.ok(followsFlagControls({...map,startJet:120},axis,controls));
  assert.equal(followsFlagControls({...map,startJet:120},axis,controls.map(mask=>mask&7)),false);
  assert.equal(recordPmsFlagTrial({...map,startJet:0},axis,[b]).trial.reached,false);
  assert.equal(followsFlagControls({...map,startJet:0},axis,controls),false);
});

test('CTF lane traces stay on opposite sides of the central bridge in both directions', () => {
  const map=generateCourseMap('ctf',DEFAULT_COURSE,{title:'Two routes',texture:'default.bmp'});
  const survey=surveyTeamCourse(map)!;
  const bridge=survey.upper.reduce((best,p)=>Math.abs(p.x)<Math.abs(best.x)?p:best).y+9;
  const {runs,cover}=checkTeamCourse(map,'ctf');
  assert.equal(cover,5);
  assert.equal(runs.length,4);
  for (const {trial,lane} of runs) {
    assert.ok(trial.reached);
    const middle=trial.trace.filter(p=>Math.abs(p.x)<100);
    assert.ok(middle.length>=2 && middle.every(p=>lane==='upper'?p.y<bridge+1:p.y>bridge+14));
  }
});

test('TW measures the lower clearance of actual sheltered trenches and rejects a filled passage', () => {
  const map=generateCourseMap('trenchwars',DEFAULT_COURSE,{title:'Trenches',texture:'default.bmp'});
  const survey=surveyTeamCourse(map)!;
  assert.ok(survey.covered.length===8 && survey.minHeadroom!>25);
  const shelter=survey.covered[0], left=shelter.from;
  const floor=survey.ground.find(p=>p.x===left)!.y+9;
  map.polygons.push(...makeQuadPolys(left-10,floor-16,left+35,floor-4));
  assert.equal(surveyTeamCourse(map),null);
});
