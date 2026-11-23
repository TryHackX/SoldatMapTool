import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { createArchiveJobs } from '../src/server/archiveJobs';
import type { ArchiveCleanPlan } from '../src/server/archiveCleaner';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import type { ArchiveCleanerJob } from '../src/shared/archiveCleanerTypes';

test('fresh archive service forks analysis and export, publishes scoped PMS resources, review CSV and library source', {timeout:60000}, async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'soldat-archive-job-test-'));
  const source=path.join(root,'source'),cache=path.join(root,'never-created','cache');
  const exportsDir=path.join(root,'never-created','exports','clean-archives');
  const assets=new Map<string,Buffer>();
  const map=createMapFromTemplate('arena',{texture:'Shared.BMP'});
  const original=Buffer.from(serializePms(map));
  for(const [pkg,red] of [['first',15],['second',240]] as const){
    const maps=path.join(source,pkg,'maps'),textures=path.join(source,pkg,'textures');
    await fs.mkdir(maps,{recursive:true});await fs.mkdir(textures,{recursive:true});
    const bytes=await sharp({create:{width:4,height:2,channels:4,background:{r:red,g:42,b:121,alpha:1}}}).png().toBuffer();
    assets.set(pkg,bytes);
    await fs.writeFile(path.join(textures,'shared.png'),bytes);await fs.writeFile(path.join(maps,'Arena.PmS'),original);
  }
  await fs.writeFile(path.join(source,'first','maps','broken.PMS'),Buffer.from('Unreadable'));
  const latePackage = path.join(source,'00-late');
  await fs.mkdir(path.join(latePackage,'maps'),{recursive:true});
  await fs.writeFile(path.join(latePackage,'maps','Arena.PMS'),
    serializePms(createMapFromTemplate('arena',{texture:'late.png'})));
  const linked=new Map<string,string>();
  const app=express();
  app.use(express.json());
  app.use('/api/clean',createArchiveJobs(cache,exportsDir,()=>'',async(dirname,job)=>{
    assert.equal(job.status,'complete');
    const sourceId=linked.get(dirname)??('source-'+linked.size);
    linked.set(dirname,sourceId);return sourceId;
  }));
  const server=app.listen(0,'127.0.0.1');
  t.after(async()=>{
    await new Promise<void>(done=>{server.close(()=>done());server.closeAllConnections();});
    await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  await once(server,'listening');
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/clean/jobs';
  assert.equal(await (await fetch(url+'/current')).json(),null);
  await assert.rejects(fs.access(cache));await assert.rejects(fs.access(exportsDir));
  const post=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,includeArchives:false})});
  assert.equal(post.status,202);
  const first=await post.json() as ArchiveCleanerJob, endpoint=url+'/'+first.id;
  async function waitFor(target:'ready'|'complete', jobEndpoint = endpoint){
    const until=Date.now()+25000;
    do{
      const state=await (await fetch(jobEndpoint)).json() as ArchiveCleanerJob;
      assert.ok(!state.error,'Worker failed: '+state.error);
      if(state.status===target)return state;
      await delay(70);
    }while(Date.now()<until);
    assert.fail('Worker never reached '+target);
  }
  const ready=await waitFor('ready');
  assert.equal(ready.summary?.readyMaps,2);assert.equal(ready.summary?.unresolvedMaps,2);
  assert.equal((await fetch(endpoint+'/library',{method:'POST'})).status,409);
  assert.equal((await (await fetch(endpoint+'/report')).json()).maps.length,4);
  assert.match(await (await fetch(endpoint+'/review.csv')).text(),/broken\.PMS/);
  await assert.rejects(fs.access(exportsDir)); // The exporter must make ALL missing parent directories.
  assert.equal((await fetch(endpoint+'/export',{method:'POST'})).status,202);
  const completed=await waitFor('complete'), output=path.join(exportsDir,first.id);
  assert.equal(completed.outputPath,output);
  const report=await fetch(endpoint+'/report');
  assert.equal(report.status,200);assert.match(report.headers.get('content-disposition')??'',/archive-report.json/);
  const manifest=await report.json() as ArchiveCleanPlan;
  assert.equal(manifest.portableAssetNames,true);
  assert.equal('workDir' in manifest,false);
  for(const row of manifest.maps.filter(m=>m.status==='ready')){
    assert.match(row.output!,/\.pms$/);
    const saved=parsePmsFull(await fs.readFile(path.join(output,'maps',row.output!)));
    assert.match(saved.texture,/^s_.*\.png$/);assert.ok(saved.texture.length<=24);
    assert.deepEqual(await fs.readFile(path.join(output,'textures',saved.texture)),assets.get(row.source.split('/')[0]));
  }
  const csv=await fetch(endpoint+'/review.csv');
  assert.equal(csv.status,200);assert.match(csv.headers.get('content-disposition')??'',/archive-review.csv/);
  assert.match(await csv.text(),/broken\.PMS/);
  for(let i=0;i<2;i++){
    const add=await fetch(endpoint+'/library',{method:'POST'});
    assert.equal(add.status,200);
    assert.deepEqual(await add.json(),{sourceId:'source-0',path:path.join(output,'maps')});
  }
  assert.equal(linked.size,1);
  assert.deepEqual(await fs.readFile(path.join(source,'first','maps','Arena.PmS')),original);
  const otherRelease=path.join(root,'other-edition.zip');
  const edition=new AdmZip();
  edition.addFile('maps/copy.PMS',await fs.readFile(path.join(latePackage,'maps','Arena.PMS')));
  const latePixels=await sharp({create:{width:8,height:2,channels:4,background:'#524'}}).png().toBuffer();
  edition.addFile('textures/late.png',latePixels);
  edition.writeZip(otherRelease);
  const brokenHistory=path.join(cache,randomUUID());
  await fs.mkdir(brokenHistory);
  await fs.writeFile(path.join(brokenHistory,'job.json'),'{');
  const again=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,includeArchives:false,artworkRoots:[otherRelease]})});
  assert.equal(again.status,202);
  const secondEndpoint=url+'/'+(await again.json()).id;
  const secondReady=await waitFor('ready',secondEndpoint);
  assert.deepEqual(secondReady.summary?.recovery,{
    baseline:first.id,reviewed:2,withCandidates:1,recovered:1,recoveredWithCandidates:1,
    newOutputs:1,matchedPreviousOutputs:0,changedOrAbsent:0,
  });
  const recoveryCsv=await (await fetch(secondEndpoint+'/recovery.csv')).text();
  assert.match(recoveryCsv,/00-late\/maps\/Arena.PMS/);
  assert.match(recoveryCsv,/Odzyskano/);
  assert.match(recoveryCsv,/original library PMS SHA-256/i);
  assert.equal(secondReady.summary?.artworkRecovery?.reviewed,1);
  const artworkCsv=await (await fetch(secondEndpoint+'/artwork.csv')).text();
  assert.match(artworkCsv,/00-late\/maps\/Arena.PMS/);
  assert.doesNotMatch(artworkCsv,/broken\.PMS/);
  assert.equal((await fetch(secondEndpoint+'/export',{method:'POST'})).status,202);
  const second=await waitFor('complete',secondEndpoint);
  assert.equal(await fs.readFile(path.join(second.outputPath!,'report','artwork.csv'),'utf8'),'\ufeff'+artworkCsv);
  assert.equal(await fs.readFile(path.join(second.outputPath!,'report','recovery.csv'),'utf8'),
    '\ufeff'+recoveryCsv); // Response.text removes the UTF-8 byte order mark.
  const nextPlan=await (await fetch(secondEndpoint+'/report')).json() as ArchiveCleanPlan;
  for(const old of manifest.maps.filter(row=>row.status==='ready')){
    const next=nextPlan.maps.find(row=>row.source===old.source)!;
    assert.equal(next.output,old.output);
    assert.equal(next.outputSha256,old.outputSha256);
  }
});
