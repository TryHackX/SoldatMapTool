import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TUNNEL, createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import { createTunnelProject, tunnelTrialRoute } from '../src/shared/tunnelProject';
import { followsFlagControls, recordPmsFlagTrial, runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';
import { applyPaceChanges, runTunnelPacePlan, type PaceProgress, type PaceSettings } from '../src/client/editor/tunnelPacePlanner';

function straightTunnel() {
  const path = [{x:0,y:0},{x:1900,y:15}];
  const settings = {...DEFAULT_TUNNEL,seed:22,roughness:0,clearance:130,spikes:false,drops:false,deadly:0,
    bounce:0,hurt:0,ramps:false,ice:false,lowCeilings:false};
  const tunnel = generateClimbTunnel(settings,path);
  const project = createTunnelProject(tunnel,settings,path);
  const map = createTunnelMap(tunnel,settings,{title:'Pace test',texture:'default.bmp'});
  return {map,project};
}
const settings:PaceSettings = {targetSeconds:12,profile:'progressive',seed:23};

test('a recorded route replays all the way to the real flag and refuses an interrupted or blocked run', () => {
  const {map,project} = straightTunnel();
  const {centerline,footholds} = tunnelTrialRoute(project);
  const {trial,controls} = recordPmsFlagTrial(map,centerline,footholds);
  assert.ok(trial.reached && controls);
  assert.equal(controls.length,trial.ticks);
  assert.ok(followsFlagControls(map,centerline,controls));
  assert.equal(followsFlagControls(map,centerline,controls.slice(0,-18)),false);
  const stop = trial.trace[Math.floor(trial.trace.length/2)];
  const obstacle = {index:0,active:true,x:stop.x,y:stop.y,radius:65};
  assert.equal(followsFlagControls({...map,colliders:[obstacle]},centerline,controls),false);
});

test('plans a curve with section variants, replays the published run to the actual flag and excludes all search time', () => {
  const {map,project} = straightTunnel(), progress:PaceProgress[] = [];
  const originalTerrain = map.polygons.slice();
  const result = runTunnelPacePlan({map,project,settings},e=>progress.push(e));
  assert.ok(result.baseline.reached && result.trial.reached && result.withinTarget);
  assert.ok(result.checkedVariants > result.changes.length && result.changes.length >= 2);
  assert.ok(result.fullRuns >= 2 && result.fullRuns <= 5);
  assert.ok(result.changes.every(c=>c.localSeconds>0 && c.difficulty>=0 && c.difficulty<=1));
  assert.ok(result.changes.at(-1)!.difficulty > result.changes[0].difficulty);
  assert.deepEqual(progress.filter(e=>e.completed===0).map(e=>e.phase),['baseline','sections','verify']);
  assert.ok(map.polygons.every((p,i)=>p===originalTerrain[i]));
  const verified = applyPaceChanges(map,project,structuredClone(result.changes));
  assert.ok(verified);
  const route = tunnelTrialRoute(verified.project);
  const independent = runPmsTunnelTrial(verified.map,route.centerline,route.footholds);
  assert.equal(independent.ticks,result.trial.ticks);
  assert.deepEqual(independent.trace,result.trial.trace);
  const end = independent.trace.at(-1)!, flag = map.spawnpoints.find(p=>p.team===6)!;
  assert.ok(Math.hypot(end.x-flag.x,end.y-flag.y)<=14);
  assert.ok(Math.abs(independent.ticks/60-settings.targetSeconds)<=result.toleranceSeconds);
  const repeat = runTunnelPacePlan({map,project,settings});
  assert.deepEqual(repeat.changes,result.changes);
  assert.equal(repeat.trial.ticks,result.trial.ticks);
});

test('reports the measured finish outside tolerance rather than relabelling a short map as a one-minute course', () => {
  const {map,project} = straightTunnel();
  const result = runTunnelPacePlan({map,project,settings:{...settings,targetSeconds:60}});
  assert.ok(result.trial.reached);
  assert.ok(result.trial.ticks/60 < 20);
  assert.equal(result.withinTarget,false);
  assert.ok(Math.abs(result.trial.ticks/60-60)<=Math.abs(result.baseline.ticks/60-60));
});

test('reversing the curve puts the technical feature before the easier finish', () => {
  const {map,project} = straightTunnel();
  const result = runTunnelPacePlan({map,project,settings:{...settings,profile:'hard-start'}});
  assert.ok(result.withinTarget && result.trial.reached);
  assert.ok(result.changes.length >= 2);
  assert.ok(result.changes[0].knotIndex < result.changes.at(-1)!.knotIndex);
  assert.ok(result.changes[0].difficulty > result.changes.at(-1)!.difficulty);
});

test('pace trials honour actual map markers and exclude saved sketch endpoints and neighbouring flags', () => {
  const {map,project} = straightTunnel();
  for (const missing of [1,6]) {
    const terrain = {...map,spawnpoints:map.spawnpoints.filter(p=>p.team!==missing)};
    const result = runTunnelPacePlan({map:terrain,project,settings});
    assert.equal(result.trial.reason,missing===1 ? 'missing-spawn' : 'missing-flag');
    assert.equal(result.withinTarget,false);
    assert.equal(result.checkedSections,0);
    assert.deepEqual(result.changes,[]);
  }
  const points = map.spawnpoints.map(p=>p.team===6 ? {...p,x:p.x-30} : p);
  const other = {...project,id:'other',spawnpoints:points};
  const terrain = {...map,spawnpoints:points,editorTunnels:[project,other]};
  assert.equal(runTunnelPacePlan({map:terrain,project,settings}).trial.reason,'missing-flag');
  assert.throws(()=>runTunnelPacePlan({map,project,settings:{...settings,targetSeconds:NaN}}),RangeError);
});
