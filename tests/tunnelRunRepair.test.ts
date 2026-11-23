import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { prepareProjectTrial, projectSplitAnchors } from '../src/client/editor/projectTrialRoute';
import { compareSectionVariants, type SectionVariantReport } from '../src/client/editor/sectionVariantComparison';
import { loadTestedTunnel, type TestedTunnel } from '../src/client/editor/testedTunnels';
import { runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';
import { createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import type { PmsMapData } from '../src/shared/pmsParser';
import { createTunnelProject, rebuildTunnelSection } from '../src/shared/tunnelProject';

test('timing anchors move with their original pass when a neighbouring pass becomes closer', () => {
  const axis = [[0,0],[100,0],[200,0],[200,20],[100,20],[0,20]].map(([x,y])=>({x,y,weights:[]}));
  const restKnots = [axis[0],{x:55,y:0},{x:194,y:0},{x:55,y:20},axis[5]];
  const moved = [[0,21],[100,21],[200,21],[220,1],[120,1],[20,1]].map(([x,y])=>({x,y}));
  const anchors = projectSplitAnchors({axis,restKnots},moved);
  const expected = [55,194,345+Math.hypot(20,20)];
  assert.equal(anchors.length,expected.length);
  for (const [i,distance] of anchors.entries()) assert.ok(Math.abs(distance-expected[i]) < 1e-9);
});

function course(key: TestedTunnel) {
  const {settings,path,name} = loadTestedTunnel(key);
  const draft = generateClimbTunnel(settings,path);
  const map = createTunnelMap(draft,settings,{title:name,texture:'default.bmp'});
  map.editorTunnels = [createTunnelProject(draft,settings,path)];
  return new EditorDocument({map,initialBaseName:name});
}

function run(map: PmsMapData) {
  const {request} = prepareProjectTrial(map,map.editorTunnels![0],undefined,'map');
  const r = structuredClone(request);
  return runPmsTunnelTrial(r.map,r.centerline,r.footholds,r.section,r.splitAnchors);
}

function swap(doc: EditorDocument, knotIndex: number, style: SectionVariantReport['style']) {
  const {map} = doc.getSnapshot(), project = map.editorTunnels![0];
  const candidates: SectionVariantReport[] = [];
  compareSectionVariants(structuredClone({map,project,knotIndex,seed:2026}),event=>{
    if (event.kind==='candidate') candidates.push(structuredClone(event.candidate));
  });
  const pick = candidates.find(c=>c.style===style);
  assert.ok(pick?.trial?.reached);
  const preview = rebuildTunnelSection(map,project,knotIndex,pick.change);
  assert.ok(preview.ok);
  doc.commit({label:'Apply section variant',nextMap:{...preview.map,editorTunnels:[preview.project]}});
}

test('changing the longest jump remeasures the complete run, including its downstream time changes', () => {
  const doc = course('hills');
  const before = run(doc.getSnapshot().map), splits = before.splits!;
  assert.ok(before.reached && splits.every(s=>s.status==='complete'));
  const longest = splits.reduce((a,b)=>a.ticks! >= b.ticks! ? a : b);
  swap(doc,longest.knotIndex,'chamber');
  const after = run(doc.getSnapshot().map);
  assert.ok(after.reached && after.ticks<before.ticks);
  const revised = after.splits!.find(s=>s.knotIndex===longest.knotIndex)!;
  assert.ok(revised.ticks!<longest.ticks!);
  const deltas = after.splits!.map((s,i)=>s.ticks!-splits[i].ticks!);
  assert.ok(Math.abs(deltas.reduce((a,b)=>a+b,0) - (after.ticks-before.ticks))<1e-6);
  assert.ok(after.splits!.some((s,i)=>s.knotIndex>longest.knotIndex && Math.abs(deltas[i])>0.5));
  assert.equal(run(doc.undo().map).ticks,before.ticks);
});

test('the stopped full-run interval can open a different jump and repair the continuous run', () => {
  const doc = course('spiral');
  // This locally passable change alters the approach to a later shaft.
  swap(doc,40,'step');
  const failed = run(doc.getSnapshot().map);
  assert.equal(failed.reached,false);
  const stop = failed.splits!.find(s=>s.status==='stopped');
  assert.ok(stop && stop.knotIndex>40);
  assert.deepEqual(stop.point,failed.trace.at(-1));
  assert.equal(stop.cumulativeTicks,failed.ticks);
  assert.ok(failed.splits!.some(s=>s.status==='unreached' && s.ticks===undefined));
  swap(doc,stop.knotIndex,'spring');
  const fixed = run(doc.getSnapshot().map);
  assert.ok(fixed.reached);
  assert.equal(fixed.splits!.at(-1)!.cumulativeTicks,fixed.ticks);
  assert.ok(fixed.splits!.every(s=>s.status==='complete'));
});

test('split repair aimed at real map markers cannot silently measure a deleted flag at the old sketch exit', () => {
  const {map} = course('hills').getSnapshot();
  const noFlag = {...map,spawnpoints:map.spawnpoints.filter(p=>p.team!==6)};
  assert.equal(prepareProjectTrial(noFlag,map.editorTunnels![0]).usesSketchEnds,true);
  const failed = run(noFlag);
  assert.equal(failed.reason,'missing-flag');
  assert.ok(!failed.splits?.length);
});
