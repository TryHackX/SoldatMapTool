import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { MapIndexEntry, ResolvedAssetInfo } from '../src/shared/apiTypes';
import { searchSimilarSceneries } from '../src/server/scenerySimilarity';

function scenery(name:string,file:string|null,usedCount=1):ResolvedAssetInfo{
  return {category:'scenery-gfx',referencedName:name,diskName:file?path.basename(file):null,diskFullPath:file,
    isVanilla:false,status:file?'custom':'missing',usedCount,fileSize:0};
}
function map(id:string,assets:ResolvedAssetInfo[],baseName=id) {
  return {id,baseName,crc32:42,hasThumbnail:false,sceneryAssets:assets} as MapIndexEntry;
}
const opts={criteria:{sceneryNames:true},threshold:100,draftFilter:'all' as const,signal:new AbortController().signal,onProgress:()=>{}};
async function folder(t:{after(fn:()=>Promise<void>):void}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-studio-sprites-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
function bmp(red:number){
  const b=Buffer.alloc(54+3*8*8);
  b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);
  b.writeUInt32LE(8,18);b.writeUInt32LE(8,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);
  for(let i=54;i<b.length;i+=3){b[i]=28;b[i+1]=9;b[i+2]=red;}
  return b;
}
test('one map can directly compare two used images under different names and different encodings',async t=>{
  const dir=await folder(t),a=path.join(dir,'rock.bmp'),b=path.join(dir,'wall.png'),c=path.join(dir,'spare.bmp');
  await fs.writeFile(a,bmp(90));
  await sharp({create:{width:8,height:8,channels:4,background:{r:90,g:9,b:28,alpha:1}}}).png().toFile(b);
  await fs.writeFile(c,bmp(90));
  const inputs=[map('ctf_a',[scenery('rock.bmp',a),scenery('cave_draft.png',b),scenery('rock.png',c,0)])];
  const result=await searchSimilarSceneries(inputs,{...opts,criteria:{sceneryImages:true},draftFilter:'only'});
  assert.equal(result.results.length,1);
  assert.deepEqual(result.results[0],{kind:'scenery',leftId:'ctf_a',rightId:'ctf_a',leftName:'ctf_a',rightName:'ctf_a',
    leftCrc:42,rightCrc:42,leftHasThumbnail:false,rightHasThumbnail:false,score:100,reasons:['sceneryImages'],
    sceneries:[{left:'rock.bmp',right:'cave_draft.png'}]});
});
test('shared references collapse; different files with the same name and aliases of a single file remain candidates',async t=>{
  const dir=await folder(t),left=path.join(dir,'one.png'),right=path.join(dir,'two.png');
  for(const file of [left,right])await sharp({create:{width:4,height:4,channels:4,background:'blue'}}).png().toFile(file);
  const maps=[map('a',[scenery('orb.png',left)]),map('b',[scenery('orb.png',left),scenery('ORB.png',left)]),
    map('c',[scenery('orb.png',right)])];
  const {results}=await searchSimilarSceneries(maps,{...opts,criteria:{sceneryImages:true},anchorIds:new Set(['b'])});
  assert.equal(results.length,3);
  assert.ok(results.every(p=>p.leftId==='b'&&p.score===100));
  assert.ok(results.some(p=>p.sceneries[0].left==='orb.png'&&p.sceneries[0].right==='orb.png'&&p.rightId==='c'));
});
test('map drafts do not mark their images as drafts; missing and unused assets give no visual evidence',async()=>{
  const maps=[map('a',[scenery('fir.png',null),scenery('fir.png',null,0)],'dm_draft'),
    map('b',[scenery('Fir.BMP',null)])];
  assert.equal((await searchSimilarSceneries(maps,{...opts,draftFilter:'only'})).results.length,0);
  assert.deepEqual((await searchSimilarSceneries(maps,{...opts,criteria:{sceneryImages:true},threshold:0})).results,[]);
  assert.deepEqual((await searchSimilarSceneries(maps,opts)).results[0].reasons,['sceneryNames']);
  const draft=await searchSimilarSceneries([map('one',[scenery('fir.png',null),scenery('Fir_rev2.bmp',null)])],{...opts,draftFilter:'only'});
  assert.equal(draft.results.length,1);
});
test('excluding working versions keeps the other sceneries from the same map',async()=>{
  const inputs=[map('one',[scenery('fir.png',null),scenery('Fir.BMP',null),scenery('fir_wip.gif',null)],'ctf_beta')];
  const all=await searchSimilarSceneries(inputs,opts);
  const published=await searchSimilarSceneries(inputs,{...opts,draftFilter:'exclude'});
  assert.equal(all.results.length,3);
  assert.deepEqual(published.results.map(pair=>pair.sceneries),[[{left:'fir.png',right:'Fir.BMP'}]]);
});
test('large selections respect anchors, deterministic result bounds, progress and cancellation',async()=>{
  const maps=Array.from({length:780},(_,i)=>map('m'+i,[scenery(i%5?'tree.png':'tree_v2.bmp','/library/sprites/'+i)]));
  const progress:number[]=[];
  const all=await searchSimilarSceneries(maps,{...opts,onProgress:(done,total)=>progress.push(total?done/total:0)});
  assert.ok(all.truncated);assert.ok(all.approximate);assert.equal(all.results.length,500);
  assert.equal(progress.at(-1),1);
  const anchors=new Set(['m5','m6']),anchored=await searchSimilarSceneries(maps,{...opts,anchorIds:anchors});
  assert.equal(anchored.approximate,false);assert.ok(anchored.results.every(r=>anchors.has(r.leftId)));
  const control=new AbortController();control.abort();
  await assert.rejects(searchSimilarSceneries(maps,{...opts,signal:control.signal}),/abort/i);
});
