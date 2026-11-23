import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTunnel, sketchExample, tunnelKnots, TunnelStroke } from '../src/client/editor/tunnelBlueprint';
import { EditorDocument, emptySelection } from '../src/client/editor/EditorDocument';
import { DEFAULT_TUNNEL, generateClimbTunnel } from '../src/shared/climbTunnel';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms, SOLDAT_MAP_LIMITS } from '../src/shared/pmsParser';
import { findPolyJunctions } from '../src/shared/polyJunctions';

const settings = {...DEFAULT_TUNNEL, seed: 34};
const draft = generateClimbTunnel(settings, [{x:1200,y:0},{x:1530,y:-40},{x:1800,y:50}]);

test('clicks, pointer jitter and cancelled knot or pen gestures preserve the previous tunnel sketch', () => {
  const previous = [{x:0,y:0},{x:80,y:0},{x:160,y:0}];
  const original = structuredClone(previous);
  for (const anchor of [-1, 1]) {
    const press = new TunnelStroke(previous, anchor, {x:390,y:130}, {x:71,y:40});
    assert.equal(press.sample({x:450,y:150}, {x:73,y:41}, 0, true), false);
    assert.equal(press.finish(false), null);
    assert.ok(press.sample({x:500,y:200}, {x:76,y:43}, 0));
    assert.equal(press.finish(true), null);
    assert.deepEqual(previous, original);
  }
  const knot = new TunnelStroke(previous, 1, {x:80,y:0}, {x:250,y:91});
  // A quick release can arrive before the first move event.
  knot.sample({x:83.4,y:-27.6}, {x:250,y:65}, 0, true);
  assert.deepEqual(knot.finish(false), [previous[0], {x:83,y:-28}, previous[2]]);
  const pen = new TunnelStroke(previous,-1,{x:200,y:90},{x:100,y:30});
  pen.sample({x:301,y:100},{x:130,y:32},0,true);
  assert.deepEqual(pen.finish(false), [{x:200,y:90},{x:301,y:100}]);
  const magnified = new TunnelStroke(previous, -1, {x:200,y:90}, {x:100,y:30});
  magnified.sample({x:200.2,y:90.1}, {x:104,y:31}, 0, true);
  assert.equal(magnified.finish(false), null);
  assert.deepEqual(previous, original);
});

test('pointer strokes retain their endpoints and bends when the same segments are sampled more often', () => {
  const sparse = [{x:2.4,y:16.8},{x:100,y:16.8},{x:100,y:140},{x:260.3,y:140}];
  const dense = sparse.slice(1).flatMap((to, i) => {
    const from = sparse[i];
    return Array.from({length:30}, (_, j) => ({
      x:from.x+(to.x-from.x)*j/30,
      y:from.y+(to.y-from.y)*j/30,
    }));
  });
  dense.push(sparse.at(-1)!);
  assert.deepEqual(tunnelKnots(sparse),[{x:2,y:17},{x:100,y:17},{x:100,y:140},{x:260,y:140}]);
  assert.deepEqual(tunnelKnots(dense),tunnelKnots(sparse));
  assert.deepEqual(tunnelKnots([]),[]);
});

test('spiral and rolling hills sketches at the current view centre produce complete tunnel previews', () => {
  const center={x:450,y:-360}, width=118;
  for (const kind of ['spiral','hills'] as const) {
    const points=sketchExample(kind,center,width);
    const origin=sketchExample(kind,{x:0,y:0},width);
    assert.equal(points.length,origin.length);
    assert.deepEqual(points,origin.map(p=>({x:p.x+center.x,y:p.y+center.y})));
    const tunnel=generateClimbTunnel({...settings,clearance:width},points);
    assert.ok(tunnel.validation.ok,tunnel.validation.reason);
    assert.ok(tunnel.polygons.length>50);
    assert.deepEqual(findPolyJunctions(tunnel.polygons),[],kind+' bedrock should have no exposed tip contacts');
    assert.deepEqual(tunnel.spawnpoints.map(s=>s.team),[1,5,6]);
    assert.deepEqual(tunnel.centerline[0],points[0]);
    assert.deepEqual(tunnel.centerline.at(-1),points.at(-1));
    if(kind==='hills') {
      assert.ok(points.every((p,i)=>i===0 || p.x>points[i-1].x));
      assert.ok(Math.min(...points.map(p=>p.y))<center.y-width/2);
      assert.ok(Math.max(...points.map(p=>p.y))>center.y+width/2);
    } else {
      assert.ok(points.some((p,i)=>i>0 && p.x<points[i-1].x));
      const radius=(p:{x:number;y:number})=>Math.hypot(p.x-center.x,p.y-center.y);
      assert.ok(radius(points[0])>4*radius(points.at(-1)!));
    }
  }
});

test('inserting a tunnel with markers preserves existing map objects, updates bounds and undoes in one step', () => {
  assert.ok(draft.validation.ok,draft.validation.reason);
  const base=createMapFromTemplate('arena',{title:'Existing arena',texture:'default.bmp'});
  const before=serializePms(prepareMapForSave(base,{geometryDirty:true}));
  const doc=new EditorDocument({map:base});
  const selection={...emptySelection(),polygons:[0]};
  doc.setSelection(selection);
  const inserted=appendTunnel(base,draft,settings,true);
  assert.ok(inserted);
  assert.ok(inserted.polyBounds.right>base.polyBounds.right);
  assert.equal(inserted.mapName,base.mapName);
  assert.equal(inserted.randomId,base.randomId);
  assert.equal(inserted.bgColorBtm,base.bgColorBtm);
  assert.equal(inserted.startJet,base.startJet);
  assert.equal(inserted.polygons.length,base.polygons.length+draft.polygons.length);
  for (const [i,p] of base.polygons.entries()) assert.equal(inserted.polygons[i],p);
  for (const [i,s] of base.spawnpoints.entries()) assert.equal(inserted.spawnpoints[i],s);
  assert.deepEqual(inserted.spawnpoints.slice(base.spawnpoints.length).map(s=>s.index),
    draft.spawnpoints.map((_,i)=>base.spawnpoints.length+i));
  const snapshot=doc.commit({label:'Insert climb tunnel',nextMap:inserted,nextSelection:emptySelection()});
  assert.equal(snapshot.undoStack.length,1);
  const restored=parsePmsFull(serializePms(prepareMapForSave(snapshot.map,{geometryDirty:true})));
  assert.equal(restored.parseWarnings.length,0);
  assert.equal(restored.polygons.length,inserted.polygons.length);
  assert.deepEqual(restored.spawnpoints.map(s=>[s.x,s.y,s.team]),inserted.spawnpoints.map(s=>[s.x,s.y,s.team]));
  const undo=doc.undo();
  assert.equal(undo.map,base);
  assert.deepEqual(undo.selection,selection);
  assert.deepEqual(serializePms(prepareMapForSave(undo.map,{geometryDirty:true})),before);
  assert.equal(doc.redo().map,inserted);
});

test('a blank canvas adopts the tunnel settings; maps with only entities keep their own background and fuel', () => {
  const empty=createMapFromTemplate('empty');
  const blank=appendTunnel(empty,draft,settings,false)!;
  assert.equal(blank.startJet,0);
  assert.equal(blank.bgColorTop,draft.background.top);
  assert.equal(blank.randomId,settings.seed);
  assert.equal(blank.spawnpoints,empty.spawnpoints);
  const markerMap={...empty,spawnpoints:[{x:-400,y:-40,index:0,active:true,team:1}]};
  const colliderMap={...empty,colliders:[{index:0,x:20,y:40,radius:12,active:true}]};
  for(const map of [markerMap,colliderMap]) {
    const inserted=appendTunnel(map,draft,settings,false)!;
    assert.equal(inserted.spawnpoints,map.spawnpoints);
    assert.equal(inserted.colliders,map.colliders);
    assert.equal(inserted.bgColorTop,map.bgColorTop);
    assert.equal(inserted.startJet,map.startJet);
    assert.equal(inserted.randomId,map.randomId);
  }
});

test('capacity checks reject the whole insertion, accept exact limits and count markers only when requested', () => {
  const base=createMapFromTemplate('empty');
  const atLimit={...base,
    polygons:Array.from({length:SOLDAT_MAP_LIMITS.maxPolys-draft.polygons.length},()=>draft.polygons[0]),
    spawnpoints:Array.from({length:SOLDAT_MAP_LIMITS.maxSpawnpoints-draft.spawnpoints.length},
      (_,index)=>({...draft.spawnpoints[0],index})),
  };
  const full=appendTunnel(atLimit,draft,settings,true);
  assert.ok(full);
  assert.equal(full.polygons.length,SOLDAT_MAP_LIMITS.maxPolys);
  assert.equal(full.spawnpoints.length,SOLDAT_MAP_LIMITS.maxSpawnpoints);
  assert.equal(appendTunnel({...atLimit,polygons:[...atLimit.polygons,draft.polygons[0]]},draft,settings,true),null);
  const tooManyMarkers={...atLimit,spawnpoints:[...atLimit.spawnpoints,draft.spawnpoints[0]]};
  assert.equal(appendTunnel(tooManyMarkers,draft,settings,true),null);
  assert.equal(appendTunnel(tooManyMarkers,draft,settings,false)!.spawnpoints,tooManyMarkers.spawnpoints);
  const invalid=generateClimbTunnel(settings,[{x:0,y:0}]);
  assert.equal(appendTunnel(base,invalid,settings,true),null);
  assert.equal(base.polygons.length,0);
  assert.equal(base.spawnpoints.length,0);
});
