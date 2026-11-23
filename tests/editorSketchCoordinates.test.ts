import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSketchCoordinates} from '../src/client/editor/components/TunnelSketchCoordinates';
import {createTunnelMap,DEFAULT_TUNNEL,generateClimbTunnel} from '../src/shared/climbTunnel';
import {createTunnelProject} from '../src/shared/tunnelProject';
import {decodeProjectFile,encodeProjectFile} from '../src/client/editor/projectFile';

test('a keyboard-entered path with decimal commas builds and reopens with the original turns',()=>{
  const parsed=parseSketchCoordinates('0 0\n180 -18,5\n350 24\n350 24\n510 -10');
  assert.ok('points' in parsed);
  assert.equal(parsed.points.length,4);
  const tunnel=generateClimbTunnel(DEFAULT_TUNNEL,parsed.points);
  assert.ok(tunnel.validation.ok);
  const map=createTunnelMap(tunnel,DEFAULT_TUNNEL,{title:'Keyboard fixture',texture:'default.bmp'});
  const project=createTunnelProject(tunnel,DEFAULT_TUNNEL,parsed.points);
  const saved=decodeProjectFile(encodeProjectFile('keyboard',map,[project]));
  assert.deepEqual(saved.tunnels[0].sourcePath,parsed.points);
});

test('an unfinished coordinate edit reports its offending line before replacing the sketch',()=>{
  assert.deepEqual(parseSketchCoordinates('12 1\n5 Infinity'),{error:'invalid',line:2});
  assert.deepEqual(parseSketchCoordinates('0 0\n1000001 0'),{error:'invalid',line:2});
  assert.deepEqual(parseSketchCoordinates('0 0\n0 0'),{error:'short'});
  assert.deepEqual(parseSketchCoordinates('0 0\n\n2'),{error:'invalid',line:3});
});

