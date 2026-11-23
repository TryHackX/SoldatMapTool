import test from 'node:test';
import assert from 'node:assert/strict';
import { runPmsTunnelTrial, runTunnelTrial } from '../src/client/editor/tunnelTrial';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { DEFAULT_TUNNEL, MAX_TUNNEL_ROUTE_LENGTH, createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';

function straightMap() {
  const map = createMapFromTemplate('empty');
  map.polygons = makeQuadPolys(-40, 0, 240, 35);
  map.spawnpoints = [
    { x: 0, y: -18, team: 1, active: true, index: 0 },
    { x: 200, y: -12, team: 6, active: true, index: 1 },
  ];
  return map;
}
const line = [{ x: 0, y: -30 }, { x: 200, y: -30 }];

test('a local trial uses its approach and exit, and checks obstacles within the section', () => {
  const map = straightMap();
  const axis = Array.from({length:11}, (_,i)=>({x:20*i,y:-30}));
  const section = {approach:3,entry:5,exit:8};
  map.polygons.push(...makeQuadPolys(30,-250,36,10));
  assert.equal(runPmsTunnelTrial(map,axis).reached, false, 'upstream barrier blocks the full run');
  map.spawnpoints = [];
  const local = runPmsTunnelTrial(map,axis,[],section);
  assert.equal(local.reached, true, local.reason);
  assert.equal(local.trace[0].x, 60);
  assert.ok(local.trace.at(-1)!.x >= 160);
  map.polygons.push(...makeQuadPolys(135,-250,142,10));
  const blocked = runPmsTunnelTrial(map,axis,[],section);
  assert.equal(blocked.reached, false);
  assert.ok(blocked.trace.length > 1 && blocked.trace.every(p => p.x < 135));
  assert.equal(blocked.reason,'pilot-stalled');
});

test('a section trial reports an unsafe approach, and rejects reversed or missing boundaries', () => {
  const map = straightMap(), axis = Array.from({length:11}, (_,i)=>({x:20*i,y:-30}));
  map.polygons.push(...makeQuadPolys(55,-55,75,-15));
  assert.equal(runTunnelTrial(map,axis,[],{approach:3,entry:5,exit:8}).reason,'no-run-up');
  for (const window of [{approach:3,entry:5,exit:3}, {approach:1,entry:2,exit:11}]) {
    assert.equal(runTunnelTrial(map,axis,[],window).reason,'invalid-route');
  }
});

test('a long legal route enters physical simulation and a stroke beyond the generator limit is rejected', () => {
  const map = straightMap();
  const end = 12500;
  map.spawnpoints[1].x = end;
  // A known early wall makes this a cheap check of the length limit.
  map.polygons.push(...makeQuadPolys(110,-230,125,3));
  const run = runTunnelTrial(map,[line[0], {x:end,y:-30}]);
  assert.equal(run.reason,'pilot-stalled');
  assert.ok(run.ticks > 0);
  const over = {x:MAX_TUNNEL_ROUTE_LENGTH+1,y:-30};
  map.spawnpoints[1].x = over.x;
  assert.equal(runTunnelTrial(map,[line[0],over]).reason,'invalid-route');
});

for (const direction of ['winding', 'up', 'down', 'across'] as const) {
  test(`tunnel trial reaches the real Bravo flag on the saved ${direction} default`, () => {
    const settings = { ...DEFAULT_TUNNEL, direction };
    const result = generateClimbTunnel(settings);
    const map = parsePmsFull(serializePms(createTunnelMap(result, settings, { title: 'QA', texture: 'default.bmp' })));
    const run = runTunnelTrial(map, result.centerline, result.footholds);
    assert.ok(run.reached, JSON.stringify({ reason: run.reason, progress: run.progress }));
    assert.equal(run.progress, 1);
    const spawn = map.spawnpoints.find(p => p.team === 1)!, flag = map.spawnpoints.find(p => p.team === 6)!;
    assert.deepEqual(run.trace[0], { x: spawn.x, y: spawn.y });
    const end = run.trace.at(-1)!;
    assert.ok(Math.hypot(end.x - flag.x, end.y - flag.y) <= 14);
    assert.ok(run.trace.length > 10 && run.ticks > run.trace.length);
  });
}

test('full-height rock and deadly barriers stop the runner on a previously passable floor', () => {
  const map = straightMap();
  assert.ok(runTunnelTrial(map, line).reached);
  for (const polyType of [0, 5]) {
    const blocked = { ...map, polygons: [...map.polygons, ...makeQuadPolys(110, -230, 125, 3, { polyType })] };
    const failed = runTunnelTrial(blocked, line);
    assert.equal(failed.reached, false);
    assert.equal(failed.reason, 'pilot-stalled');
    assert.ok(failed.progress < 1);
    assert.ok(failed.trace.every(p => p.x < 110));
  }
});

test('a flag on a parallel return leg next to spawn cannot finish a winding route before its turn', () => {
  const map = straightMap();
  map.spawnpoints[1] = { ...map.spawnpoints[1], x: 3, y: -20 };
  map.polygons.push(...makeQuadPolys(135, -200, 144, 10));
  const route = [{ x: 0, y: -20 }, { x: 200, y: -20 }, { x: 200, y: -80 }, { x: 0, y: -80 }];
  const run = runTunnelTrial(map, route);
  assert.equal(run.reached, false);
  assert.ok(run.progress < 0.5);
});

test('the pilot reports missing entities and invalid strokes separately from a failed simulation', () => {
  const map = straightMap();
  assert.equal(runTunnelTrial(map, [{ x: 0, y: 0 }]).reason, 'invalid-route');
  assert.equal(runTunnelTrial(map, [{ x: NaN, y: 2 }, { x: 0, y: 0 }]).reason, 'invalid-route');
  map.spawnpoints[1].active = false;
  assert.equal(runTunnelTrial(map, line).reason, 'missing-flag');
  map.spawnpoints[0].active = false;
  assert.equal(runTunnelTrial(map, line).reason, 'missing-spawn');
});
