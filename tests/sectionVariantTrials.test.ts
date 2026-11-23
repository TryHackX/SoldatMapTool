import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSectionVariants, type SectionVariantEvent } from '../src/client/editor/sectionVariantComparison';
import { prepareSectionTiming, runTimedSectionTrial, type TunnelTrialRequest } from '../src/client/editor/tunnelTrial';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import { createTunnelProject } from '../src/shared/tunnelProject';

function straightTrial(approach: number): TunnelTrialRequest {
  const map = createMapFromTemplate('empty');
  map.polygons = makeQuadPolys(-60,0,300,35);
  map.spawnpoints = [];
  return {map, centerline:Array.from({length:15},(_,i)=>({x:i*18.5,y:-30})), section:{approach,entry:7,exit:11}};
}

test('stopwatch interpolates both fixed gates and excludes the run-up in either approach', () => {
  for (const approach of [1,2]) {
    const source = straightTrial(approach);
    const timing = prepareSectionTiming(source);
    assert.ok(timing.ok);
    assert.ok(timing.timing.controls.length >= 40);
    const run = runTimedSectionTrial(source,timing);
    assert.equal(run.reached,true);
    // 74 map units, crossed at the runner's terminal horizontal speed of 2.65 units/tick.
    assert.ok(Math.abs(run.sectionTicks! - 74/2.65) < 1e-7);
    assert.ok(run.ticks > run.sectionTicks! + 40);
    const modifiedLine = source.centerline.map((p,i)=>i===source.section!.exit ? {...p,x:p.x+4} : p);
    const changed = runTimedSectionTrial({...source,centerline:modifiedLine},timing);
    assert.equal(changed.sectionTicks,run.sectionTicks,'the finish line comes from the source section');
  }
});

test('blocked run-up, blocked interior and invalid boundaries never report a completed time', () => {
  const source = straightTrial(1);
  const timing = prepareSectionTiming(source);
  assert.ok(timing.ok);
  for (const [barrier,expected] of [[55,'no-run-up'],[154,'pilot-stalled']] as const) {
    const map = {...source.map,polygons:[...source.map.polygons,...makeQuadPolys(barrier,-260,barrier+12,10)]};
    const trial = runTimedSectionTrial({...source,map},timing);
    assert.equal(trial.reached,false);
    assert.equal(trial.reason,expected);
    assert.equal(trial.sectionTicks,undefined);
  }
  assert.equal(prepareSectionTiming({...source,section:{approach:1,entry:11,exit:4}}).ok,false);
});

test('first and final stretches finish on their fixed planes and require positive movement time', () => {
  const source = straightTrial(1);
  for (const section of [{approach:0,entry:0,exit:4},{approach:6,entry:10,exit:14}]) {
    const request = {...source,section};
    const run = runTimedSectionTrial(request,prepareSectionTiming(request));
    assert.ok(run.reached && run.sectionTicks! > 0);
    assert.ok(run.trace.at(-1)!.x >= source.centerline[section.exit].x);
  }
});

test('seeded comparison streams the original and each measured candidate without storing full meshes', () => {
  const {settings,path} = loadTestedTunnel('spiral');
  const draft = generateClimbTunnel(settings,path);
  const map = createTunnelMap(draft,settings,{title:'Comparison',texture:'default.bmp'});
  const project = createTunnelProject(draft,settings,path);
  const events: SectionVariantEvent[] = [];
  compareSectionVariants({map,project,knotIndex:32,seed:240,count:4},e=>events.push(e));
  assert.deepEqual(events.map(e=>e.kind),['baseline','candidate','candidate','candidate','candidate','done']);
  const source = events[0];
  assert.ok(source.kind==='baseline' && source.trial.reached && source.trial.sectionTicks! < source.trial.ticks);
  const times = new Set<number>();
  for (const event of events) if (event.kind==='candidate') {
    const c = event.candidate;
    assert.equal('map' in c,false);
    assert.equal('project' in c,false);
    assert.ok(c.trial?.reached,c.reason ?? c.trial?.reason);
    assert.ok(c.changedPolygons > 0 && c.trial.sectionTicks! > 0);
    times.add(c.trial.sectionTicks!);
  }
  assert.ok(times.size >= 2);
});
