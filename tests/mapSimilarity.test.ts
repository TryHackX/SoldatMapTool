import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createLibrarySimilarityRouter } from '../src/server/librarySimilarityJobs';
import type { SoldatMapScanner } from '../src/server/soldatScanner';
import { searchSimilarMaps } from '../src/server/mapSimilarity';
import type { MapIndexEntry, ResolvedAssetInfo } from '../src/shared/apiTypes';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { serializePms } from '../src/shared/pmsParser';

const opts={threshold:80,draftFilter:'all' as const,signal:new AbortController().signal,onProgress:()=>{}};
function entry(id:string,name:string,extras:Partial<MapIndexEntry>={}):MapIndexEntry{
  return {id,baseName:name,fullPath:'missing/'+id,crc32:1,fileSize:100,mtimeMs:1,hasThumbnail:false,
    texture:'',sceneryAssets:[],polygonCount:0,activePropCount:0,activeColliderCount:0,activeSpawnCount:0,activeWaypointCount:0,
    ...extras} as MapIndexEntry;
}
function asset(name:string,full:string):ResolvedAssetInfo {
  return {category:'scenery-gfx',referencedName:name,diskName:path.basename(full),diskFullPath:full,isVanilla:false,status:'custom',usedCount:1,fileSize:100};
}
async function temporary(t:{after(fn:()=>Promise<void>):void}) {
  const folder=await fs.mkdtemp(path.join(tmpdir(),'soldat-similarity-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));return folder;
}
test('similarity jobs respect filter boundaries and allow comparison of a filtered group against the library',async t=>{
  const maps=['a','b','c','d'].map(id=>entry(id,'ctf_Arena'));
  const scanner={isIndexReady:()=>true,getAllEntries:()=>maps,getMapEntry:(id:string)=>maps.find(m=>m.id===id)??null,
    queryMatchingIds:(query:{prefix:string})=>query.prefix==='single'?['a']:['a','b']} as unknown as SoldatMapScanner;
  const app=express();app.use(express.json(),createLibrarySimilarityRouter(scanner));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise<void>(done=>{server.close(()=>done());server.closeAllConnections();}));
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/jobs';
  async function run(scope:object) {
    const start=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...scope,mode:'maps',criteria:{names:true},threshold:90})});
    assert.equal(start.status,202);
    const {id}=await start.json();
    const end=Date.now()+5000;
    while(Date.now()<end){
      const r=await (await fetch(url+'/'+id)).json();
      if(r.status==='complete') return r.results.map((p:{leftId:string;rightId:string})=>[p.leftId,p.rightId].sort().join('')).sort();
      assert.equal(r.status,'running');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.fail('Similarity job did not complete in time');
  }
  assert.deepEqual(await run({query:{prefix:'single'}}),[]);
  assert.deepEqual(await run({ids:['a']}),['ab','ac','ad']);
  assert.deepEqual(await run({query:{prefix:'both'}}),['ab']);
  assert.deepEqual(await run({query:{prefix:'both'},againstLibrary:true}),['ab','ac','ad','bc','bd']);
});
test('name/version match, active criteria, rough cut-off and single anchor work independently',async()=>{
  const maps=[entry('a','ctf_Arena'),entry('b','ctf_Arena_v2'),entry('c','ctf_Wealth')];
  const r=await searchSimilarMaps(maps,{...opts,criteria:{names:true},draftFilter:'only',anchorId:'b'});
  assert.equal(r.results.length,1);assert.equal(r.results[0].score,100);assert.equal(r.results[0].leftId,'b');assert.equal(r.results[0].rightId,'a');
  const none=await searchSimilarMaps(maps,{...opts,criteria:{shape:true,sceneryImages:true},threshold:0});
  assert.deepEqual(none.results,[]);
  const published=await searchSimilarMaps([...maps,entry('d','dm_Arena')],{...opts,criteria:{names:true},draftFilter:'exclude'});
  assert.deepEqual(published.results.map(p=>[p.leftId,p.rightId]),[['a','d']]);
});
test('silhouette reflects actual triangles even with equal bounds, names and polygon counts',async t=>{
  const folder=await temporary(t);
  async function map(id:string,offset:number,bars:boolean) {
    const m=createMapFromTemplate('empty');
    m.polygons=bars?[...makeQuadPolys(offset,0,offset+20,100),...makeQuadPolys(offset+80,0,offset+100,100)]:
      [...makeQuadPolys(offset,0,offset+100,20),...makeQuadPolys(offset,80,offset+100,100)];
    const bytes=serializePms(m),fullPath=path.join(folder,id+'.pms');await fs.writeFile(fullPath,bytes);
    return entry(id,id,{fullPath,fileSize:bytes.length,polygonCount:4,polyWidth:100,polyHeight:100});
  }
  const maps=await Promise.all([map('horizontal',0,false),map('shifted',150,false),map('vertical',0,true)]);
  const r=await searchSimilarMaps(maps,{...opts,criteria:{shape:true},threshold:90});
  assert.deepEqual(r.results.map(x=>[x.leftId,x.rightId,x.score]),[['horizontal','shifted',100]]);
});
function legacyBmp(){
  const w=8,h=8,out=Buffer.alloc(54+w*h*3);out.write('BM');out.writeUInt32LE(out.length,2);out.writeUInt32LE(54,10);
  out.writeUInt32LE(40,14);out.writeInt32LE(w,18);out.writeInt32LE(h,22);out.writeUInt16LE(1,26);out.writeUInt16LE(24,28);
  const rgb=Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const c=(x+y)%3===0?[0,255,0]:[120+x*9,20+y*15,102];const i=(y*w+x)*3,j=54+((h-1-y)*w+x)*3;
    rgb.set(c,i);out.set([c[2],c[1],c[0]],j);
  }
  return {out,rgb};
}
test('perceptual matching links renamed BMP/PNG and a near-colour variant, and rejects unrelated scenery with an identical name',async t=>{
  const folder=await temporary(t),{out,rgb}=legacyBmp();
  const bmp=path.join(folder,'legacy.bmp'),png=path.join(folder,'new.png'),tint=path.join(folder,'bright.png'),other=path.join(folder,'other.png');
  await fs.writeFile(bmp,out);await sharp(rgb,{raw:{width:8,height:8,channels:3}}).png().toFile(png);
  const edited=Buffer.from(rgb);for(let i=0;i<edited.length;i+=3)if(edited[i]!==0)edited[i]+=3;
  await sharp(edited,{raw:{width:8,height:8,channels:3}}).png().toFile(tint);
  await sharp({create:{width:8,height:8,channels:3,background:'#0000ff'}}).png().toFile(other);
  const maps=[entry('a','Hill',{sceneryAssets:[asset('tree.bmp',bmp)]}),entry('b','Beach',{sceneryAssets:[asset('renamed_draft.png',png)]}),
    entry('c','Island',{sceneryAssets:[asset('tree.bmp',other)]}),entry('d','Town',{sceneryAssets:[asset('bush.png',tint)]})];
  const r=await searchSimilarMaps(maps,{...opts,criteria:{sceneryImages:true},threshold:92,anchorId:'a'});
  assert.deepEqual(r.results.map(x=>x.rightId),['b','d']);
  assert.equal(r.results[0].score,100);assert.deepEqual(r.results[0].sceneries,[{left:'tree.bmp',right:'renamed_draft.png'}]);
  assert.ok(r.results[1].score<100);
  const drafts=await searchSimilarMaps(maps,{...opts,criteria:{sceneryImages:true},draftFilter:'only',anchorId:'a'});
  assert.deepEqual(drafts.results.map(x=>x.rightId),['b']);
});
test('empty assets never count as image evidence; large selections use bounded candidate search and results',async()=>{
  const maps=Array.from({length:510},(_,i)=>entry('id'+i,'map'+i,{texture:'earth.bmp'}));
  const r=await searchSimilarMaps(maps,{...opts,criteria:{texture:true},threshold:100});
  assert.equal(r.results.length,500);assert.equal(r.truncated,true);assert.equal(r.approximate,true);
  const controller=new AbortController();controller.abort();
  await assert.rejects(searchSimilarMaps(maps,{...opts,criteria:{shape:true},signal:controller.signal}),/abort/i);
});
test('two selected seeds search the rest of the library and never include an outsider-only match',async()=>{
  const maps=[entry('a','ctf_Amber'),entry('b','ctf_Blue'),entry('c','ctf_Amber_v3'),
    entry('d','ctf_Green'),entry('e','ctf_Green_v2'),entry('f','ctf_Blue_draft')];
  const r=await searchSimilarMaps(maps,{...opts,criteria:{names:true},threshold:100,anchorIds:new Set(['a','b'])});
  assert.deepEqual(r.results.map(p=>[p.leftId,p.rightId]),[['a','c'],['b','f']]);assert.equal(r.approximate,false);
});
test('large selected-vs-library search indexes previous seeds separately from unrelated outsiders',async()=>{
  const maps=Array.from({length:820},(_,i)=>entry(String(i).padStart(4,'0'),'Island'+i,{texture:'terrain_'+i+'.png'}));
  const seeds=new Set(maps.slice(0,220).map(m=>m.id));
  for(const m of maps.slice(220))m.texture='others.png';
  maps[0].texture=maps[819].texture='needle.png';
  const r=await searchSimilarMaps(maps,{...opts,criteria:{texture:true},threshold:100,anchorIds:seeds});
  assert.ok(r.approximate);assert.deepEqual(r.results.map(p=>[p.leftId,p.rightId]),[['0000','0819']]);
});
