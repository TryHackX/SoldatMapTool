import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { recordPmsFlagTrial, runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';

const axis = [{x:0,y:-30},{x:280,y:-30}];
const anchors = [25,95,185,260];

function runway() {
  const map = createMapFromTemplate('empty');
  map.polygons = makeQuadPolys(-45,0,335,40);
  map.spawnpoints = [
    {x:0,y:-18,active:true,team:1,index:0},
    {x:280,y:-12,active:true,team:6,index:1},
  ];
  return map;
}

test('full-run splits time exact crossings along the same winning control sequence', () => {
  const map = runway();
  const plain = recordPmsFlagTrial(map,axis,[]);
  const recorded = recordPmsFlagTrial(map,axis,[],anchors);
  assert.deepEqual(recorded.controls,plain.controls);
  const {splits,...trial} = recorded.trial;
  assert.deepEqual(trial,plain.trial);
  assert.deepEqual(splits,runPmsTunnelTrial(map,axis,[],undefined,anchors).splits);
  assert.ok(trial.reached && splits?.length === 4);
  assert.deepEqual(splits.map(s=>[s.knotIndex,s.lastKnotIndex,s.status]),
    [1,2,3,4].map(k=>[k,k,'complete']));
  assert.deepEqual(splits.slice(0,-1).map(s=>s.point.x),[42,126,210]);
  // Terminal horizontal speed is 2.65 units/tick here. Two 84-unit pieces both
  // take exactly that fraction even though the trace only contains every sixth tick.
  for (const s of splits.slice(1,3)) assert.ok(Math.abs(s.ticks!-84/2.65) < 1e-8);
  let cumulative = 0;
  for (const s of splits) {
    assert.ok(s.ticks! > 0);
    cumulative += s.ticks!;
    assert.ok(Math.abs(s.cumulativeTicks!-cumulative)<1e-8);
  }
  assert.equal(splits.at(-1)!.cumulativeTicks,trial.ticks);
  assert.deepEqual(splits.at(-1)!.point,trial.trace.at(-1));
  assert.deepEqual(runPmsTunnelTrial(map,axis,[],undefined,[150]).splits,
    [{knotIndex:1,lastKnotIndex:1,status:'complete',ticks:trial.ticks,cumulativeTicks:trial.ticks,point:trial.trace.at(-1)}]);
});

test('a stopped run keeps its own crossed gates and its measured partial section only', () => {
  const map = runway();
  map.polygons.push(...makeQuadPolys(165,-220,175,10));
  const plain = runPmsTunnelTrial(map,axis);
  const trial = runPmsTunnelTrial(map,axis,[],undefined,anchors);
  const {splits,...original} = trial;
  assert.deepEqual(original,plain);
  assert.ok(!trial.reached && splits);
  assert.deepEqual(splits.map(s=>s.status),['complete','complete','stopped','unreached']);
  assert.equal(splits[2].cumulativeTicks,trial.ticks);
  assert.deepEqual(splits[2].point,trial.trace.at(-1));
  assert.ok(splits[2].point.x >= 126 && splits[2].point.x < 165);
  assert.ok(Math.abs(splits[0].ticks!+splits[1].ticks!+splits[2].ticks!-trial.ticks)<1e-8);
  assert.equal(splits[3].ticks,undefined);
  assert.equal(splits[3].cumulativeTicks,undefined);
  map.spawnpoints[1].active = false;
  assert.equal(runPmsTunnelTrial(map,axis,[],undefined,anchors).splits,undefined);
});

test('clustered handles share an interval and the nearby return leg cannot generate split times', () => {
  const map = runway();
  const dense = runPmsTunnelTrial(map,axis,[],undefined,[20,21,22,25,160,250]);
  const rows = dense.splits!;
  assert.ok(dense.reached && rows.length < 6);
  assert.deepEqual(rows.flatMap(s=>Array.from({length:s.lastKnotIndex-s.knotIndex+1},(_,i)=>s.knotIndex+i)),[1,2,3,4,5,6]);
  assert.ok(rows.every(s=>s.ticks!>0));

  map.spawnpoints[1] = {...map.spawnpoints[1],x:3,y:-25};
  map.polygons.push(...makeQuadPolys(140,-250,154,20));
  const loop = [{x:0,y:-18},{x:240,y:-18},{x:240,y:-75},{x:0,y:-75}];
  const failed = runPmsTunnelTrial(map,loop,[],undefined,[55,120,245,300,430,500]);
  assert.ok(!failed.reached);
  assert.ok(failed.splits!.slice(3).every(s=>s.status==='unreached'));
  assert.equal(failed.splits!.filter(s=>s.status==='stopped').length,1);
});

