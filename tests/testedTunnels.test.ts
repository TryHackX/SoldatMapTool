import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTestedTunnel, TESTED_TUNNELS, type TestedTunnel } from '../src/client/editor/testedTunnels';
import { createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { runTunnelTrial } from '../src/client/editor/tunnelTrial';
import { findPolyJunctions } from '../src/shared/polyJunctions';
import { validateMapDocument } from '../src/shared/mapValidator';
import { createTunnelProject } from '../src/shared/tunnelProject';

test('a single-team climb project keeps its intentional flag run while normal CTF warns about a missing Bravo spawn',()=>{
  const {settings,path,name}=loadTestedTunnel('hills');
  const draft=generateClimbTunnel(settings,path);
  const map=createTunnelMap(draft,settings,{title:name,texture:'default.bmp'});
  const recipe=createTunnelProject(draft,settings,path);
  const issues=(target:typeof map)=>validateMapDocument(target,{mapBaseName:name}).map(i=>i.id);
  assert.ok(issues(map).includes('ctf_missing_bravo_spawn'));
  assert.ok(!issues({...map,editorTunnels:[recipe]}).includes('ctf_missing_bravo_spawn'));
  assert.ok(issues({...map,editorTunnels:[recipe],polygons:[...map.polygons,map.polygons[0]]}).includes('ctf_missing_bravo_spawn'));
  assert.ok(issues({...map,editorTunnels:[recipe],spawnpoints:map.spawnpoints.filter(p=>p.team!==6)}).includes('ctf_missing_bravo_flag'));
});

for (const key of Object.keys(TESTED_TUNNELS) as TestedTunnel[]) {
  test('the ' + key + ' starter reaches the flag after PMS export', () => {
    const { settings, method, path, name } = loadTestedTunnel(key);
    assert.equal(settings.profileSource, 'builtin');
    const draft = generateClimbTunnel(settings, method === 'draw' ? path : undefined);
    assert.ok(draft.validation.ok, draft.validation.reason);
    const map = createTunnelMap(draft, settings, { title: name, texture: 'default.bmp' });
    const saved = parsePmsFull(serializePms(map));
    assert.deepEqual(findPolyJunctions(saved.polygons), []);
    const run = runTunnelTrial(saved, draft.centerline, draft.footholds);
    assert.ok(run.reached, run.reason);
  });
}
