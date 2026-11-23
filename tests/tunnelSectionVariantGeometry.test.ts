import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { createTunnelMap, generateClimbTunnel, type TunnelPoint } from '../src/shared/climbTunnel';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms, type PmsPolygon } from '../src/shared/pmsParser';
import { createTunnelProject, isTunnelProject, rebuildTunnelSection, tunnelGateAt, tunnelSectionGates, tunnelSectionPolygonIndices, tunnelTrialRoute } from '../src/shared/tunnelProject';
import { generateSectionVariants } from '../src/shared/tunnelSectionVariants';

function spiral() {
  const {settings,path} = loadTestedTunnel('spiral');
  const draft = generateClimbTunnel(settings,path);
  const map = createTunnelMap(draft,settings,{title:'Portal test',texture:'default.bmp'});
  const project = createTunnelProject(draft,settings,path);
  return decodeProjectFile(encodeProjectFile('spiral',map,[project]));
}

test('seeded section designs differ in PMS and keep the incoming and outgoing physical gates of an edited spiral', () => {
  const original = spiral(), k = 32;
  // The older, freely deformed project already has a chamber, so a gate can be
  // somewhere other than the location you would get by regenerating the initial map.
  const widened = rebuildTunnelSection(original.map,original.tunnels[0],k,{widthOffset:22});
  assert.ok(widened.ok);
  const before = widened.project.knots[k-1];
  const movedEntry = rebuildTunnelSection(widened.map,widened.project,k-1,{point:{x:before.x+2,y:before.y-2}});
  assert.ok(movedEntry.ok);
  const file = encodeProjectFile('widened',prepareMapForSave(movedEntry.map,{geometryDirty:true}),[movedEntry.project]);
  const {map,tunnels:[project]} = decodeProjectFile(file);
  const candidates = generateSectionVariants(map,project,k,240);
  assert.equal(new Set(candidates.map(v=>v.style)).size,4);
  assert.deepEqual(generateSectionVariants(map,project,k,240,2).map(v=>v.change), candidates.slice(0,2).map(v=>v.change));
  assert.notDeepEqual(generateSectionVariants(map,project,k,241).map(v=>v.change),candidates.map(v=>v.change));
  const axis = tunnelTrialRoute(project).centerline;
  const {entry,exit} = tunnelSectionGates(project,k);
  const start = tunnelGateAt(axis,entry), finish = tunnelGateAt(axis,exit);
  function side(p: TunnelPoint, gate: typeof start) {
    return (p.x-gate.center.x)*gate.tangent.x + (p.y-gate.center.y)*gate.tangent.y;
  }
  function inSection(poly: PmsPolygon) {
    return poly.vertices.every(v=>side(v,start)>0 && side(v,finish)<0);
  }

  const gateFace = tunnelSectionPolygonIndices(map,project,k).find(i=>!inSection(map.polygons[i]));
  assert.ok(gateFace !== undefined);
  const painted = structuredClone(map.polygons[gateFace]);
  painted.vertices[0].color.g ^= 1;
  const withManualGate = {...map,polygons:map.polygons.map((p,i)=>i===gateFace ? painted : p)};
  const alternatives = generateSectionVariants(withManualGate,project,k,240);
  for (const choice of alternatives) {
    assert.ok(choice.result.ok);
    assert.equal(choice.result.map.polygons[gateFace],painted,'manual finish at a fixed gate is preserved');
  }

  const meshes = new Set<string>();
  for (const variant of candidates) {
    const edit = variant.result;
    assert.ok(edit.ok, variant.style);
    assert.deepEqual(tunnelTrialRoute(edit.project).centerline,axis);
    for (const i of edit.changedIndices) {
      assert.ok(inSection(map.polygons[i]) && inSection(edit.map.polygons[i]), 'both the old and new triangle lie strictly inside the gates');
    }
    assert.ok(edit.changedPolygons > 0 && edit.changedPolygons < map.polygons.length/5);
    meshes.add(edit.project.faces.map(f=>f.key).join(''));
    const encoded = encodeProjectFile('chosen',prepareMapForSave(edit.map,{geometryDirty:true}),[edit.project]);
    const chosen = decodeProjectFile(encoded);
    assert.ok(isTunnelProject(chosen.tunnels[0]));
    for (let i=0;i<map.polygons.length;i++) {
      if (!inSection(map.polygons[i])) assert.deepEqual(chosen.map.polygons[i].raw, map.polygons[i].raw, 'unchanged PMS gate and outside faces');
    }
    assert.deepEqual(chosen.map.spawnpoints,map.spawnpoints);
    const next = generateSectionVariants(chosen.map,chosen.tunnels[0],k,242)[0];
    assert.equal(next.result.ok,true, 'new choices are available after saving and reopening');
    assert.deepEqual(serializePms(prepareMapForSave(chosen.map,{})),serializePms(parsePmsFull(serializePms(chosen.map))));
  }
  assert.equal(meshes.size,4, 'different candidates have genuinely different terrain or collision materials');
  assert.deepEqual(encodeProjectFile('widened',map,[project]),file,'sampling leaves the editor document untouched');
});

test('rerolls detect edits to owned interior terrain and reject malformed requests', () => {
  const {map,tunnels:[project]} = spiral(), k = 32;
  const proposed = generateSectionVariants(map,project,k,240).find(v=>v.result.ok);
  assert.ok(proposed?.result.ok);
  const i = proposed.result.changedIndices[0], replacement = structuredClone(map.polygons[i]);
  replacement.vertices[0].color.b ^= 1;
  const painted = {...map,polygons:map.polygons.map((p,j)=>i===j ? replacement : p)};
  const decisions = generateSectionVariants(painted,project,k,240);
  assert.ok(decisions.every(v=>!v.result.ok && v.result.reason==='manual'));
  for (const [knot,seed,count] of [[0,1,3],[k,-1,2],[k,240,5],[k,0,2.5]]) {
    assert.throws(()=>generateSectionVariants(map,project,knot,seed,count),RangeError);
  }
});
