import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePlayerRuns, playerRunRouteKey, playerRunsBackup, readPlayerRuns, validPlayerRun, type PlayerRun } from '../src/client/editor/playerRunLog';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { createTunnelMap,generateClimbTunnel } from '../src/shared/climbTunnel';
import { parsePmsFull,serializePms } from '../src/shared/pmsParser';
import type { TunnelTrialResult } from '../src/client/editor/tunnelTrial';

const pilot:TunnelTrialResult={reached:true,ticks:600,progress:1,trace:[],splits:[
  {knotIndex:1,lastKnotIndex:2,status:'complete',ticks:360,point:{x:1,y:0}},
  {knotIndex:3,lastKnotIndex:3,status:'complete',ticks:240,point:{x:2,y:0}},
]};
const human:PlayerRun={id:'a',notes:'',gameVersion:'1.7.1',reached:true,seconds:11,splits:[
  {first:1,last:2,seconds:5,move:'ordinary'},{first:3,last:3,seconds:6,move:'bounce'}]};

test('measurements are bound to the played collision world and route, including after PMS round-trip',()=>{
  const {settings,path}=loadTestedTunnel('hills'), draft=generateClimbTunnel(settings,path);
  const map=createTunnelMap(draft,settings,{title:'test',texture:'default.bmp'});
  const world={map,centerline:draft.centerline,splitAnchors:[11,28]};
  const key=playerRunRouteKey(world);
  assert.equal(playerRunRouteKey({...world,map:parsePmsFull(serializePms(map))}),key);
  assert.equal(playerRunRouteKey({...world,map:{...map,bgColorTop:{r:0,b:0,g:1,a:255}}}),key);
  assert.notEqual(playerRunRouteKey({...world,splitAnchors:[11,29]}),key);
  assert.notEqual(playerRunRouteKey({...world,map:{...map,polygons:map.polygons.slice(1)}}),key);
  const text=playerRunsBackup(key,[human],123,pilot);
  assert.deepEqual(readPlayerRuns(text,key,3),[human]);
  assert.throws(()=>readPlayerRuns(text,'another-route',3));
});

test('calibration compares only common completed intervals, separates bounces and keeps failed attempts',()=>{
  const stopped={...human,id:'b',reached:false,stoppedAt:2,splits:[],seconds:4};
  assert.deepEqual(comparePlayerRuns([human,stopped],pilot),{finishes:1,pilotOnly:1,playerOnly:0,finishError:1,ordinaryError:1,bounceError:2});
  assert.equal(comparePlayerRuns([human],{...pilot,reached:false}).playerOnly,1);
  assert.ok(validPlayerRun(stopped,3));
  assert.ok(!validPlayerRun({...stopped,splits:human.splits},3));
  assert.ok(!validPlayerRun({...human,seconds:3},3));
  assert.ok(!validPlayerRun({...human,splits:[human.splits[0],human.splits[0]]},3));
  assert.throws(()=>readPlayerRuns(playerRunsBackup('k',[human,human],123,pilot),'k',3));
});
