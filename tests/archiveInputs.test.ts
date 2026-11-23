import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { classifyArchivePath, scanArchiveInputs, type ArchiveInputIssue } from '../src/server/archiveInputs';
import { withZipMembers } from '../src/server/archiveZipReader';

function zip(entries:Record<string,string|Buffer>) {
  const z=new AdmZip();
  for(const [name,value] of Object.entries(entries))z.addFile(name,Buffer.from(value));
  return z.toBuffer();
}
async function temporary(t:{after(fn:()=>Promise<void>):void}) {
  const dir=await fs.mkdtemp(path.join(tmpdir(),'soldat-input-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
test('intake retains case collisions, original package scope and independent bytes across nested ZIPs',async t=>{
  const dir=await temporary(t), issues:ArchiveInputIssue[]=[];
  const a=zip({'Maps/One.PMS':'map-a','Scenery-Gfx/TREE.bmp':'tree-a','scenery-gfx/tree.bmp':'tree-b','Textures/Edges/snow.png':'edge'});
  await fs.writeFile(path.join(dir,'bundle.zip'),zip({'p/a.zip':a,'p/a.png':'overview','p/b.zip':zip({'mApS/One.pms':'map-b'})}));
  await fs.writeFile(path.join(dir,'loose.pms'),'loose');
  const found: Array<[string,string,string,string]>=[]; const summary=await scanArchiveInputs(dir,{useCollectionIndex:false,
    onEntry:async e=>{found.push([e.path,e.kind,e.scope,(await e.read()).toString()]);},onIssue:i=>issues.push(i)});
  assert.equal(summary.archives,3);assert.equal(summary.entries,7);assert.deepEqual(issues,[]);
  assert.ok(found.some(([p,k,scope,b])=>p==='bundle.zip!/p/a.zip!/Scenery-Gfx/TREE.bmp'&&k==='scenery'&&scope==='bundle.zip!/p/a.zip'&&b==='tree-a'));
  assert.ok(found.some(([p,k,,b])=>p.endsWith('/tree.bmp')&&k==='scenery'&&b==='tree-b'));
  assert.ok(found.some(([,k,,b])=>k==='overview'&&b==='overview'));
  assert.ok(found.some(([,k,,b])=>k==='edge'&&b==='edge'));
  assert.equal(classifyArchivePath('Maps/assets/variants/myMap.png')?.kind,'overview');
});
test('intake reports corrupt and unsafe members, missing RAR parts, and continues independent archives',async t=>{
  const dir=await temporary(t);
  const source=zip({'valid/evil.pms':'bad','good.pms':'good'});
  for(let i=source.indexOf('valid/evil.pms');i!==-1;i=source.indexOf('valid/evil.pms',i+1))source.write('../xx/evil.pms',i,'ascii');
  await fs.writeFile(path.join(dir,'safe.zip'),source);
  await fs.writeFile(path.join(dir,'bad.zip'),'not a zip');
  await fs.writeFile(path.join(dir,'set.part02.rar'),'missing first volume');
  const issues:ArchiveInputIssue[]=[], names:string[]=[];
  await scanArchiveInputs(dir,{onEntry:async e=>{names.push((await e.read()).toString());},onIssue:i=>issues.push(i),useCollectionIndex:false});
  assert.deepEqual(names,['good']);assert.equal(issues.length,3);
  assert.ok(issues.some(i=>i.reason.includes('Unsafe archive member path')));
  assert.ok(issues.some(i=>i.reason.includes('archive volume')));
});
test('original and case-colliding ZIP entries are located by central record including exact repeated names',async t=>{
  const dir=await temporary(t);
  const source=zip({'fileA.pms':'one','fileB.pms':'two'});
  for(let i=source.indexOf('fileB.pms');i!==-1;i=source.indexOf('fileB.pms',i+1))source.write('fileA.pms',i,'ascii');
  await fs.writeFile(path.join(dir,'dup.zip'),source);const items:{name:string;path:string;value:string}[]=[];
  await scanArchiveInputs(dir,{onEntry:async e=>{items.push({name:e.name,path:e.path,value:(await e.read()).toString()});},useCollectionIndex:false});
  assert.deepEqual(items.map(e=>e.name),['fileA.pms','fileA.pms']);assert.equal(new Set(items.map(e=>e.path)).size,2);
  assert.deepEqual(items.map(e=>e.value),['one','two']);
});
test('corrupt ZIP CRC is attributed to a member and consumer failures abort the scan',async t=>{
  const dir=await temporary(t), source=zip({'good.pms':'map'});
  const central=source.indexOf(Buffer.from([0x50,0x4b,1,2])); source.writeUInt32LE(0,central+16);
  await fs.writeFile(path.join(dir,'broken.zip'),source);
  const issues:ArchiveInputIssue[]=[];await scanArchiveInputs(dir,{onEntry:async e=>{await e.read();},onIssue:i=>issues.push(i),useCollectionIndex:false});
  assert.ok(issues.some(i=>i.path==='broken.zip!/good.pms'&&i.reason.includes('CRC')));
  await assert.rejects(scanArchiveInputs(dir,{onEntry:()=>{throw Error('full output disk');},useCollectionIndex:false}),/full output disk/);
});
test('ZIP reader rejects reused local offsets',async()=>{
  const source=zip({'a.pms':'one','b.pms':'two'}),sig=Buffer.from([0x50,0x4b,1,2]);
  const first=source.indexOf(sig),second=source.indexOf(sig,first+1);source.writeUInt32LE(source.readUInt32LE(first+42),second+42);
  await assert.rejects(withZipMembers(source,async()=>{}),/Overlapping/);
});
test('ZIP edition dates prefer the precise UTC NTFS modification time over the DOS clock',async()=>{
  const z=new AdmZip();
  z.addFile('Race.PMS',Buffer.from('terrain'));
  const e=z.getEntry('Race.PMS')!;
  e.header.time=new Date(2020,7,1,19,32,40);
  const time=Date.UTC(2020,7,1,17,32,40)+877;
  const field=Buffer.alloc(36);
  field.writeUInt16LE(0x000a);field.writeUInt16LE(32,2);
  field.writeUInt16LE(1,8);field.writeUInt16LE(24,10);
  field.writeBigUInt64LE(BigInt(time)*10000n+116444736000000000n,12);
  e.extra=field;
  await withZipMembers(z.toBuffer(),async members=>assert.equal(members[0].mtimeMs,time));
});
