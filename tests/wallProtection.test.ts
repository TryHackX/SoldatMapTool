import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { compileMapSectors, createPolygonFromPoints } from '../src/shared/pmsCompiler';
import { pointInTriInclusive } from '../src/shared/polygonGeometry';
import { parsePmsFull, serializePms, type PmsPolygon } from '../src/shared/pmsParser';
import { defaultWallSettings as settings, planWallProtection, insertWallProtection } from '../src/shared/wallProtection';
import { exportGuardedMap } from '../src/server/wallProtectionExport';
import {createSoldierPlaytestState,stepSoldierPlaytest} from '../src/client/editor/soldierPlaytest';
import {EditorSpatialIndex} from '../src/client/editor/spatialIndex';

function stripsFor(...args:Parameters<typeof planWallProtection>) {
  return planWallProtection(...args).polygons;
}
function fixture(polygons:PmsPolygon[]) {
  return {...createMapFromTemplate('empty'),polygons,...compileMapSectors(polygons)};
}
const contains=(mesh:PmsPolygon[],x:number,y:number)=>mesh.some(p=>pointInTriInclusive(x,y,...p.vertices));
const wall=()=>fixture([...makeQuadPolys(-170,-40,0,40),...makeQuadPolys(0,-40,170,40)]);

test('the hidden core spans the joint, stays back from every playable side and survives a PMS round trip',()=>{
  const map=wall(), plan=planWallProtection(map,settings), strips=plan.polygons;
  assert.ok(contains(strips,0,0));
  for(const {vertices,polyType} of strips) {
    assert.equal(polyType,5);
    for(const v of vertices) {assert.equal(v.color.a,0);assert.ok(Math.abs(v.x)<=170-settings.clearance && Math.abs(v.y)<=40-settings.clearance);}
  }
  const saved=parsePmsFull(serializePms(insertWallProtection(map,plan)));
  assert.deepEqual(saved.parseWarnings,[]);
  assert.ok(saved.sectorsPolys?.some(list=>list[0]>map.polygons.length));
  for(const [i,list] of saved.sectorsPolys!.entries())
    assert.deepEqual([...list].filter(id=>id<=map.polygons.length),[...map.sectorsPolys[i]]);
  assert.equal(stripsFor(saved,settings).length,0);
});

test('walls that let bullets or players through get no Deadly strips',()=>{
  // Only Players Collide (type 2) stops players but not bullets: a Deadly strip inside it would start stopping shots
  const bulletsPass=fixture([...makeQuadPolys(-170,-40,0,40,{polyType:2}),...makeQuadPolys(0,-40,170,40,{polyType:2})]);
  assert.equal(stripsFor(bulletsPass,settings).length,0);
  // Stored normals that all point one way make a one-way wall that players can cross
  const oneWay=fixture(wall().polygons.map(p=>({...p,normals:p.normals.map(n=>({...n,x:1,y:0})) as PmsPolygon['normals']})));
  assert.equal(stripsFor(oneWay,settings).length,0);
  assert.ok(stripsFor(wall(),settings).length>0);
});

test('narrow, passable and team-only walls remain open, including missing collision sectors',()=>{
  for(const polys of [makeQuadPolys(-160,0,160,5),... [1,3,11,18,24].map(polyType=>makeQuadPolys(-160,0,160,100,{polyType}))])
    assert.equal(stripsFor(fixture(polys),settings).length,0);
  const map=wall();
  const middle=map.sectorsNum*(2*map.sectorsNum+1)+map.sectorsNum;
  map.sectorsPolys[middle]=new Uint16Array();
  const withHole=stripsFor(map,settings);
  assert.ok(withHole.length);
  assert.ok(!contains(withHole,0,0));
  map.sectorsPolys=map.sectorsPolys.map(()=>new Uint16Array());
  assert.equal(stripsFor(map,settings).length,0);
});

test('fast surface impacts in the editor model match an unprotected wall',()=>{
  const source=wall(), guarded=insertWallProtection(source,planWallProtection(source,settings));
  for (const speed of [6,12,24]) {
    const run=(map:typeof guarded)=>{
      const spatial=new EditorSpatialIndex(map);
      let state={...createSoldierPlaytestState(-195,0,map),vx:speed};
      for(let i=0;i<12;i++) {
        state=stepSoldierPlaytest(state,{left:false,right:true,jump:false,crouch:false,jetpack:false},map,spatial);
        assert.equal(state.hazardState,'none');
        assert.ok(state.x < -170);
      }
      return [state.x,state.y,state.vx,state.vy];
    };
    assert.deepEqual(run(guarded),run(source));
  }
});

test('automatic protection makes one long rectangle in each straight wall without any strokes',()=>{
  const map=fixture([...makeQuadPolys(-220,-18,220,18),...makeQuadPolys(-220,72,220,108)]);
  const added=stripsFor(map,{...settings,scope:'all'});
  assert.equal(added.length,4);
  for(const x of [-178,0,178]) for(const y of [0,90]) assert.ok(contains(added,x,y));
  assert.ok(!contains(added,0,45));
});

test('a bridge with less than one sampling cell left after setback still joins two wider walls',()=>{
  const map=fixture([...makeQuadPolys(-120,-20,-18,20),...makeQuadPolys(-18,0,18,5.6),
    ...makeQuadPolys(18,-20,120,20)]);
  const added=stripsFor(map,settings);
  for(let x=-16;x<=16;x++) {
    assert.ok(contains(added,x,2.8),'missing protection at '+x);
    assert.ok(!contains(added,x,1.9) && !contains(added,x,3.7));
  }
});

test('the latest area brush restores or removes just the overlap in both scopes and in the saved PMS',()=>{
  const map=wall();
  const green={mode:'include' as const,radius:10,points:[{x:0,y:0}]};
  const pink={...green,mode:'exclude' as const,radius:24};
  for(const scope of ['all','painted'] as const) {
    const base={...settings,scope};
    const first={...green,radius:48};
    const strokes=[first,pink,green];
    const plan=planWallProtection(map,{...base,strokes}), added=plan.polygons;
    const saved=parsePmsFull(serializePms(insertWallProtection(map,plan))).polygons.slice(map.polygons.length);
    for(const tris of [added,saved]) {
      assert.ok(contains(tris,0,0));
      assert.ok(!contains(tris,17,0));
      assert.ok(contains(tris,35,0));
      assert.equal(contains(tris,85,0),scope==='all');
    }
    assert.ok(!contains(stripsFor(map,{...base,strokes:[...strokes,pink]}),0,0));
  }
  assert.ok(contains(stripsFor(map,{...settings,strokes:[pink,green]}),85,0));
  assert.equal(stripsFor(map,{...settings,strokes:[green,pink]}).length,0);
});

test('painted regions clip a strip; an exclusion inside an inclusion wins',()=>{
  const map=wall();
  const guarded=stripsFor(map,{...settings,strokes:[
    {mode:'include',radius:16,points:[{x:-90,y:0},{x:30,y:0}]},
    {mode:'exclude',radius:10,points:[{x:0,y:0}]}]});
  assert.ok(contains(guarded,-70,0));
  assert.ok(!contains(guarded,0,0) && !contains(guarded,90,0));
  for(const p of guarded) for(const v of p.vertices) assert.ok(v.x>=-106 && v.x<=46);
  const ring=fixture([...makeQuadPolys(-160,-120,160,-55),...makeQuadPolys(-160,55,160,120),
    ...makeQuadPolys(-160,-55,-65,55),...makeQuadPolys(65,-55,160,55)]);
  const shell=stripsFor(ring,settings);
  assert.ok(shell.length);
  for(let x=-65;x<=65;x+=4) for(let y=-55;y<=55;y+=4) assert.ok(!contains(shell,x,y));
});

test('a hand-drawn 2-unit strip follows a narrow wall, respects clearance and never covers the gap',()=>{
  const map=fixture([...makeQuadPolys(-100,-4,-12,4),...makeQuadPolys(12,-4,100,4)]);
  const stroke={mode:'guide' as const,radius:32,points:[{x:-80,y:2.5},{x:80,y:2.5}]};
  const options={width:2,clearance:2,strokes:[stroke]};
  const plan=planWallProtection(map,options), guarded=plan.polygons;
  for(const x of [-75,-50,-25,25,50,75]) assert.ok(contains(guarded,x,0.8));
  for(const poly of guarded) for(const v of poly.vertices) {
    assert.ok(Math.abs(v.x)>=14 && Math.abs(v.y)<=2);
    assert.equal(v.color.a,0);
  }
  const saved=parsePmsFull(serializePms(insertWallProtection(map,plan)));
  assert.equal(stripsFor(saved,options).length,0);
  assert.equal(stripsFor(map,{...options,strokes:[{...stroke,points:[{x:0,y:0}]}]}).length,0);
});

test('overlapping brush strokes do not accumulate geometry and an exclusion cuts a manual strip',()=>{
  const map=wall(), stroke={mode:'guide' as const,radius:48,points:[{x:-60,y:5},{x:60,y:5}]};
  const settings={width:1,clearance:2,strokes:[stroke]};
  const single=stripsFor(map,settings);
  assert.equal(single.length,2);
  const cross={...stroke,points:[{x:0,y:-21},{x:0,y:21}]};
  const crossing=stripsFor(map,{...settings,strokes:[stroke,cross]});
  assert.equal(crossing.length,4);
  assert.ok(contains(crossing,0,5));
  assert.deepEqual(stripsFor(map,{...settings,strokes:Array(12).fill(stroke)}),single);
  const guarded=stripsFor(map,{...settings,scope:'painted',strokes:[{mode:'exclude',radius:8,points:[{x:0,y:5}]},stroke]});
  for(const x of [-40,40]) assert.ok(contains(guarded,x,5));
  assert.ok(!contains(guarded,0,5) && !contains(guarded,120,0));
  assert.throws(()=>stripsFor(map,{...settings,clearance:-0.01}));
  assert.throws(()=>stripsFor(map,{...settings,width:0.99}));
});

test('manual protection restores only brushed, fully enclosed collision cells in a legacy triangle',()=>{
  const polygons=[createPolygonFromPoints([{x:-120,y:-120},{x:220,y:0},{x:-120,y:120}])];
  const map={...fixture(polygons),...compileMapSectors(polygons,{fixedDivision:28})};
  const middle=map.sectorsNum*(map.sectorsNum*2+1)+map.sectorsNum;
  const distant=middle+map.sectorsNum*2+1;
  for(const id of [middle,distant]) map.sectorsPolys[id]=new Uint16Array();
  const points=[{x:-6,y:-22},{x:-3,y:-2},{x:4,y:16},{x:11,y:24}];
  const guide={mode:'guide' as const,radius:8,points};
  const options={...settings,strokes:[guide]};
  const plan=planWallProtection(map,options);
  assert.deepEqual(plan.sectorRepairs,[{sector:middle,polygon:1}]);
  const saved=parsePmsFull(serializePms(insertWallProtection(map,plan)));
  assert.deepEqual(saved.parseWarnings,[]);
  for(let i=1;i<points.length;i++) for(let j=0;j<=40;j++) {
    const a=points[i-1],b=points[i],u=j/40;
    assert.ok(contains(saved.polygons.slice(1),a.x+u*(b.x-a.x),a.y+u*(b.y-a.y)));
  }
  assert.deepEqual([...saved.sectorsPolys![middle]].filter(id=>id===1),[1]);
  assert.ok(!saved.sectorsPolys![distant].includes(1));
  assert.equal(map.sectorsPolys[middle].length,0);
  assert.deepEqual(planWallProtection(saved,options),{polygons:[],sectorRepairs:[]});
  for(const off of [{...options,repairInteriorCells:false},{...options,strokes:[guide,
    {mode:'exclude' as const,radius:32,points:[{x:0,y:0}]}]},settings]) {
    const original=planWallProtection(map,off);
    assert.deepEqual(original.sectorRepairs,[]);
    assert.ok(!contains(original.polygons,0,0));
  }
  // Even a hand-drawn guide must not turn completely unindexed artwork into a wall.
  map.sectorsPolys=map.sectorsPolys.map(()=>new Uint16Array());
  assert.deepEqual(planWallProtection(map,options),{polygons:[],sectorRepairs:[]});
});

test('surface clearance accepts fractional and large distances and handles a wall too thin for the strip',()=>{
  const map=wall();
  for(const clearance of [0,2.01,8,24.5,38]) {
    const plan=planWallProtection(map,{...settings,clearance});
    assert.ok(plan.polygons.length);
    for(const p of plan.polygons) for(const v of p.vertices) {
      assert.ok(40-Math.abs(v.y)>=clearance && 170-Math.abs(v.x)>=clearance);
    }
  }
  for(const clearance of [40,96,Number.MAX_VALUE]) assert.equal(stripsFor(map,{...settings,clearance}).length,0);
  for(const clearance of [-1,NaN,Infinity]) assert.throws(()=>planWallProtection(map,{...settings,clearance}));
});

test('batch writes independent short-name copies, rejects stale input, and safely retries',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wall-conversion-'));
  try {
    const root=path.join(dir,'out'), run=randomUUID(), raw=serializePms(wall());
    const jobs=['ctf_jd_alcoholi_8d4a614e','ctf_jd_alcoholic'];
    for(const name of jobs) await fs.writeFile(path.join(dir,name+'.pms'),raw);
    const request={run,crc:parsePmsFull(raw).crc32,maxLength:16,settings};
    const src=path.join(dir,jobs[0]+'.pms');
    await assert.rejects(exportGuardedMap(root,src,{...request,crc:request.crc+1}));
    const first=await exportGuardedMap(root,src,request);
    const second=await exportGuardedMap(root,path.join(dir,jobs[1]+'.pms'),{...request,settings:{...settings,width:8}});
    assert.ok(first.filename && second.filename && first.filename!==second.filename);
    assert.ok(first.filename.length<=20 && second.filename.length<=20);
    assert.deepEqual(await exportGuardedMap(root,src,request),first);
    assert.deepEqual(await fs.readFile(src),Buffer.from(raw));
    const stored=parsePmsFull(await fs.readFile(path.join(root,run,first.filename)));
    assert.equal(stripsFor(stored,settings).length,0);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
