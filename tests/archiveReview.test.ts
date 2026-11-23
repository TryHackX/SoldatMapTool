import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { analyzeCleanArchive, exportCleanArchive, type ArchiveCleanMap } from '../src/server/archiveCleaner';
import { createArchiveJobs } from '../src/server/archiveJobs';
import { writeArchiveReviewCsv } from '../src/server/archiveReview';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { serializePms } from '../src/shared/pmsParser';

async function temporary(t:{after(fn:()=>Promise<void>):void}){
  const dir=await fs.mkdtemp(path.join(tmpdir(),'soldat-review-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
test('CSV ranks exact source bytes before geometry, name+size and name only; offers unique ready outputs and neutralises Excel formulas',async t=>{
  const dir=await temporary(t),file=path.join(dir,'review.csv');
  const m=(source:string,status:ArchiveCleanMap['status'],sha256:string,sourceSize:number,output?:string,geometrySha256?:string):ArchiveCleanMap=>
    ({source,status,sha256,sourceSize,output,geometrySha256,issues:status==='blocked'?['+reason; "quoted"']:[]});
  const maps=[
    m('\ufeff=evil.zip!/CORAL.PMS','blocked','a',12,undefined,'geo'),
    m('base/other.pms','ready','a',12,'first.pms'),
    m('copy/coral.pms','duplicate','a',12,'first.pms'),
    m('polys/coral.pms','ready','b',15,'shape.pms','geo'),
    m('samebyteslength/CORAL.pms','ready','c',12,'size.pms'),
    m('other/coral.pms','ready','d',18,'name.pms'),
    m('bad/no.pms','blocked','e',8),
  ];
  await writeArchiveReviewCsv(file,maps);
  const body=await fs.readFile(file,'utf8'),rows=body.split('\r\n').filter(Boolean);
  assert.equal(body.charCodeAt(0),0xfeff);assert.equal(rows.length,6);
  assert.match(rows[1],/^"'\ufeff=evil/);assert.match(rows[1],/"'\+reason; ""quoted"""/);
  assert.match(rows[1],/Identical source PMS bytes.*maps\/first.pms/);
  assert.match(rows[2],/filename and polygon data.*maps\/shape.pms/);
  assert.match(rows[3],/filename and byte count.*maps\/size.pms/);
  assert.match(rows[4],/filename only.*maps\/name.pms/);
  assert.match(rows[5],/No ready counterpart found/);
  assert.equal(maps[0].status,'blocked');assert.equal(maps[0].output,undefined);
});
test('analysis supplies review.csv immediately; export reproduces it and the job route serves UTF-8 download',async t=>{
  const root=await temporary(t),source=path.join(root,'input'),cache=path.join(root,'jobs'),exportsDir=path.join(root,'exports'),id=randomUUID();
  const work=path.join(cache,id,'work'),target=path.join(exportsDir,id);
  await fs.mkdir(source);await fs.mkdir(exportsDir);
  await fs.writeFile(path.join(source,'alone.pms'),serializePms(createMapFromTemplate('arena',{texture:'absent.bmp'})));
  const plan=await analyzeCleanArchive(source,work);assert.equal(plan.summary.blockedMaps,1);
  const csv=await fs.readFile(path.join(work,'review.csv'),'utf8');
  assert.match(csv,/absent.bmp/);assert.match(csv,/No ready counterpart found/);
  await fs.writeFile(path.join(cache,id,'job.json'),JSON.stringify({id,source,summary:plan.summary,status:'ready'}));
  const app=express();app.use(createArchiveJobs(cache,exportsDir,()=>''));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())));
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/jobs/'+id+'/review.csv';
  const r=await fetch(url);assert.equal(r.status,200);assert.match(r.headers.get('Content-Disposition')??'',/archive-review\.csv/i);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(csv));
  await exportCleanArchive(plan,target);
  assert.deepEqual(await fs.readFile(path.join(target,'report','review.csv'),'utf8'),csv);
  await fs.writeFile(path.join(cache,id,'job.json'),JSON.stringify({id,source,summary:plan.summary,status:'complete',outputPath:target}));
  assert.equal((await fetch(url)).status,200);
});
