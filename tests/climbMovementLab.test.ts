import test from 'node:test';
import assert from 'node:assert/strict';
import {CLIMB_MOVES,measureMoveDrill,type ClimbMove} from '../src/client/editor/climbMoveDrills';
import {checkStopRepairs,locateStalledSection,type RepairReport} from '../src/client/editor/climbStopRepair';
import {decodeProjectFile,encodeProjectFile} from '../src/client/editor/projectFile';
import {prepareProjectTrial} from '../src/client/editor/projectTrialRoute';
import {loadTestedTunnel} from '../src/client/editor/testedTunnels';
import {runPmsTunnelTrial} from '../src/client/editor/tunnelTrial';
import {createTunnelMap,generateClimbTunnel} from '../src/shared/climbTunnel';
import {createTunnelProject,isTunnelProject,rebuildTunnelSection} from '../src/shared/tunnelProject';
import {generateSectionVariants} from '../src/shared/tunnelSectionVariants';
import {prepareMapForSave} from '../src/shared/pmsCompiler';

for(const move of Object.keys(CLIMB_MOVES) as ClimbMove[]){
  test('training exercise plays the required contacts in order after PMS export: '+move,()=>{
    const {attempts,total,map}=measureMoveDrill(move);
    assert.ok(attempts.length>1 && attempts.length<=total);
    assert.equal(map.startJetGame,0);
    const pads=CLIMB_MOVES[move].pads, last=pads.at(-1)!;
    for(const run of attempts){
      assert.deepEqual(run.contacts,pads.map((_,i)=>i));
      assert.ok(run.runup>0 && run.launchSpeed>0 && Number.isFinite(run.arrivalSpeed));
      assert.ok(run.landingX>last.left && run.landingX<last.right);
      assert.ok(run.ticks>30 && run.ticks<640);
    }
    if(move==='spring') assert.ok(map.polygons.some(p=>p.polyType===18 && p.bounciness>1));
  });
}

test('stalled spiral can preview a local targeted fix which reaches the flag on a complete model run',()=>{
  const {settings,path}=loadTestedTunnel('spiral');
  const draft=generateClimbTunnel(settings,path);
  const base=createTunnelMap(draft,settings,{title:'Repair lab',texture:'default.bmp'});
  const recipe=createTunnelProject(draft,settings,path);
  const breakStep=generateSectionVariants(base,recipe,40,2026).find(v=>v.style==='step')!.result;
  assert.ok(breakStep.ok);
  const {map,project}=breakStep;
  const {request}=prepareProjectTrial(map,project,undefined,'map');
  const trial=runPmsTunnelTrial(request.map,request.centerline,request.footholds,undefined,request.splitAnchors);
  const stop=locateStalledSection(project,trial);
  assert.ok(stop && stop.knot>40);
  const rows:RepairReport[]=[];
  checkStopRepairs({map,project,trial,sketch:false},row=>rows.push(row));
  assert.ok(rows.length>=3);
  const passing=rows.find(r=>r.trial?.reached);
  assert.ok(passing,rows.map(r=>r.kind+': '+(r.rejected ?? r.trial?.progress)).join(', '));
  const preview=rebuildTunnelSection(map,project,passing.knot,passing.change);
  assert.ok(preview.ok);
  assert.deepEqual(preview.project.sourcePath,project.sourcePath);
  assert.deepEqual(preview.project.knots,project.knots);
  assert.ok(preview.changedIndices.length<map.polygons.length/5);
  const edited=new Set(preview.changedIndices);
  map.polygons.forEach((p,i)=>{if(!edited.has(i))assert.equal(preview.map.polygons[i],p);});
  const saved=decodeProjectFile(encodeProjectFile('ctf_lab',prepareMapForSave(preview.map,{geometryDirty:true}),[preview.project]));
  const r=prepareProjectTrial(saved.map,saved.tunnels[0],undefined,'map').request;
  assert.equal(runPmsTunnelTrial(r.map,r.centerline,r.footholds,undefined,r.splitAnchors).ticks,passing.trial!.ticks);
  assert.ok(!locateStalledSection(project,{...trial,reason:'missing-flag'}));
});

test('local shelf extension survives project round-trip and a fixed-gate reroll',()=>{
  const {settings,path}=loadTestedTunnel('hills');
  const draft=generateClimbTunnel(settings,path);
  const map=createTunnelMap(draft,settings,{title:'Shelf',texture:'default.bmp'});
  const project=createTunnelProject(draft,settings,path);
  const knot=Math.floor(project.knots.length/2);
  const grown=rebuildTunnelSection(map,project,knot,{landingReach:6});
  assert.ok(grown.ok);
  const expected=grown.project.landings[knot-1];
  const across=grown.changedIndices.flatMap(i=>map.polygons[i].vertices.map((before,j)=>{
    const after=grown.map.polygons[i].vertices[j];
    assert.equal(Math.fround(before.y),Math.fround(after.y));
    return (after.x-before.x)*Math.sign(before.x-expected.x);
  }));
  assert.ok(across.some(x=>x>0.2) && across.every(x=>x>=-0.00001));
  const pinned=rebuildTunnelSection(grown.map,grown.project,knot,{pinGates:true,landingReach:9});
  assert.ok(pinned.ok);
  assert.ok(isTunnelProject(pinned.project));
  const saved=decodeProjectFile(encodeProjectFile('ctf_grown',prepareMapForSave(pinned.map,{geometryDirty:true}),[pinned.project]));
  assert.equal(saved.tunnels[0].sections[knot-1].landingReach,9);
  assert.equal(rebuildTunnelSection(map,project,knot,{landingReach:Infinity}).ok,false);
});

