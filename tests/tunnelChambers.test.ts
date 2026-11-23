import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';
import { createTunnelMap, DEFAULT_TUNNEL, generateClimbTunnel, NEW_TUNNEL_SETTINGS } from '../src/shared/climbTunnel';
import { doesPolyCollideSoldier } from '../src/shared/soldatConstants';
import { createTunnelProject, rebuildTunnelSection } from '../src/shared/tunnelProject';
import { isTunnelSettings } from '../src/shared/tunnelSketch';

const path = [{x:0, y:0}, {x:2500, y:0}];
const header = {title:'Chamber sprint', texture:'default.bmp'};
const settings = NEW_TUNNEL_SETTINGS;

test('authored line gains real safe landings, ice passages and different roof heights', () => {
  const varied = generateClimbTunnel({...settings, deadlyWalls:true, deadly:100}, path);
  const classic = generateClimbTunnel({...settings, chamberLayout:'classic'}, path);
  assert.ok(varied.validation.ok);
  assert.deepEqual(varied.centerline, classic.centerline);
  const rooms = varied.chamberReport!.rooms;
  assert.equal(new Set(rooms.map(r => r.kind)).size, 5);
  for (const room of rooms) {
    const mid = (room.start + room.end) / 2;
    const i = varied.stations.findIndex(st => st.center.x >= mid - 10);
    const station = varied.stations[i];
    if (room.kind === 'rest') {
      const central = varied.stations.filter(st => Math.abs(st.center.x - mid) < 0.18 * (room.end - room.start));
      assert.ok(central.length >= 1 && central.every(st => st.right.y === room.floorY));
      const inside = varied.polygons.filter(p => p.vertices.every(v => v.x > room.start + 10 && v.x < room.end - 10));
      assert.ok(inside.length > 3 && inside.every(p => p.polyType === 0 || p.polyType === 3));
    }
    if (room.kind === 'shaft' || room.kind === 'gallery') assert.ok(station.left.y < classic.stations[i].left.y - 25);
    if (room.kind === 'ice') {
      const faces = varied.floorFaces.filter(f => Math.abs(f.station.x - mid) < (room.end - room.start) / 4);
      assert.ok(faces.length >= 4 && faces.every(f => varied.polygons[f.polygon].polyType === 4));
    }
  }
  assert.ok(generateClimbTunnel({...settings, ice:false},path).chamberReport!.rooms.every(r => r.kind !== 'ice'));
});

test('the marking cap only spends spare polygons; changing the palette or cap preserves the physical terrain', () => {
  const plain = generateClimbTunnel({...settings, decorationBudget:0},path);
  const marked = generateClimbTunnel({...settings, decorationBudget:3},path);
  const tighter = generateClimbTunnel(settings,path,plain.polygons.length + 1);
  assert.equal(marked.chamberReport?.decorations, 3);
  assert.equal(tighter.chamberReport?.decorations, 1);
  assert.deepEqual(marked.polygons.slice(0,-3), plain.polygons);
  assert.ok(marked.polygons.slice(-3).every(p => !doesPolyCollideSoldier(p.polyType,1,false)));
  const other = generateClimbTunnel({...settings,decorationBudget:3,palette:'ember'},path);
  const surfaces = (draft: typeof plain) => draft.polygons.map(p => [p.polyType,p.bounciness,p.normals,p.vertices.map(v=>[v.x,v.y])]);
  assert.deepEqual(surfaces(marked), surfaces(other));
  assert.notDeepEqual(marked.polygons[0].vertices[0].color, other.polygons[0].vertices[0].color);
  assert.equal(generateClimbTunnel(settings,path,30).validation.reason,'limit');
});

test('chambers reopen as editable terrain and legacy projects retain the original corridor', () => {
  const draft = generateClimbTunnel(settings,path);
  const map = createTunnelMap(draft,settings,header);
  const project = createTunnelProject(draft,settings,path);
  const reopened = decodeProjectFile(encodeProjectFile('ctf_chamber_sprint',map,[project]));
  assert.deepEqual(reopened.tunnels[0].settings,settings);
  assert.deepEqual(generateClimbTunnel(reopened.tunnels[0].settings,path).polygons,draft.polygons);
  const result = rebuildTunnelSection(reopened.map,reopened.tunnels[0],3,{widthOffset:10});
  assert.ok(result.ok);
  assert.ok(result.changedPolygons > 1 && result.changedPolygons < draft.polygons.length/2);
  assert.ok(isTunnelSettings(DEFAULT_TUNNEL));
  assert.equal(isTunnelSettings({...settings,decorationBudget:161}),false);
  assert.equal(isTunnelSettings({...settings,chamberLayout:'unknown'}),false);
  const legacy = generateClimbTunnel(DEFAULT_TUNNEL,path);
  const classic = generateClimbTunnel({...settings,chamberLayout:'classic',decorationBudget:0},path);
  assert.deepEqual(classic.polygons,legacy.polygons);
});

test('new chamber defaults reach the flag in all four directions after PMS round-trip', () => {
  for (const direction of ['across','up','down','winding'] as const) {
    const options = {...settings,direction};
    const draft = generateClimbTunnel(options);
    const trial = runPmsTunnelTrial(createTunnelMap(draft,options,header),draft.centerline,draft.footholds);
    assert.ok(trial.reached, direction + ': ' + trial.reason);
  }
});
