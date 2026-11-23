import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { scanArchiveInputs } from '../src/server/archiveInputs';
import { SoldatAssetResolver } from '../src/server/assetResolver';
import { parseSearchQuery } from '../src/shared/searchQuery';
import { isDraftName } from '../src/shared/librarySimilarity';

test('SMA index recovers original archive spelling and scope, verifies the materialised file and finds extras',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-sma-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const collection=path.join(root,'Maps'), indexDir=path.join(collection,'txt & other','_collection');
  await fs.mkdir(indexDir,{recursive:true});
  await fs.mkdir(path.join(collection,'maps'));
  const bytes=Buffer.from('map fixture'),sha=createHash('sha256').update(bytes).digest('hex');
  const materialised=path.join(collection,'maps','stored.pms');
  await fs.writeFile(materialised,bytes);
  await fs.writeFile(path.join(collection,'maps','extra.pMs'),bytes);
  await fs.writeFile(path.join(root,'old.zip'),Buffer.from('index snapshot'));
  const db=new DatabaseSync(path.join(indexDir,'index.sqlite'));
  db.exec("CREATE TABLE archives(source TEXT,volumes TEXT);CREATE TABLE files(path TEXT PRIMARY KEY,sha256 TEXT,size INTEGER);CREATE TABLE entries(source TEXT,destination TEXT)");
  db.prepare('INSERT INTO archives VALUES(?,?)').run('old.zip','["old.zip"]');
  db.prepare('INSERT INTO files VALUES(?,?,?)').run('maps/stored.pms',sha,bytes.length);
  for(const original of ['old.zip!/A.zip!/maps/Climb.PMS','old.zip!/B.zip!/maps/CLIMB.pMs']){
    db.prepare('INSERT INTO entries VALUES(?,?)').run(original,'maps/stored.pms');
  }
  db.close();
  await fs.utimes(path.join(root,'old.zip'),new Date(0),new Date(0));
  const seen:{name:string;scope:string}[]=[];
  const verify=()=>scanArchiveInputs(root,{onEntry:async e=>{seen.push(e);assert.deepEqual(await e.read(),bytes);}});
  const report=await verify();
  assert.equal(report.issues,0);
  assert.equal(report.indexedPackages,1);
  assert.deepEqual(seen.map(s=>s.name).sort(),['CLIMB.pMs','Climb.PMS','extra.pMs']);
  assert.notEqual(seen[0].scope,seen[1].scope);
  await fs.writeFile(materialised,Buffer.alloc(bytes.length,9));
  await assert.rejects(verify(),/SHA-256/);
  const replacement=new AdmZip();
  replacement.addFile('maps/Updated.PMS',Buffer.from('current bytes'));
  replacement.writeZip(path.join(root,'old.zip'));
  const newer=new Date(Date.now()+60000);
  await fs.utimes(path.join(root,'old.zip'),newer,newer);
  const current:string[]=[];
  await scanArchiveInputs(root,{onEntry:async e=>{await e.read();current.push(e.name);}});
  assert.deepEqual(current.sort(),['Updated.PMS','extra.pMs']);
});

test('map-scoped scenery in an external pack wins over same-name game graphics',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-scope-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const packaged=path.join(root,'pack');
  for(const p of [root,packaged])await fs.mkdir(path.join(p,'scenery-gfx'),{recursive:true});
  await fs.writeFile(path.join(root,'scenery-gfx','tree.png'),'stock');
  await fs.writeFile(path.join(packaged,'scenery-gfx','Tree.bmp'),'custom');
  const resolver=new SoldatAssetResolver(root,[]);
  const scoped=resolver.resolveMapAsset('scenery-gfx','Tree.bmp',1,packaged);
  assert.equal(scoped.diskFullPath,path.join(packaged,'scenery-gfx','Tree.bmp'));
  assert.equal(scoped.pngOverrideFullPath,null);
  assert.equal(resolver.resolveMapAsset('scenery-gfx','Tree.bmp',1).diskFullPath,path.join(root,'scenery-gfx','tree.png'));
});

test('draft filters support inclusion/exclusion and version labels without matching words like Contest',()=>{
  const query=parseSearchQuery('is:draft -is:draft-scenery');
  assert.deepEqual(query.terms,[{kind:'flag',flag:'draft',negate:false},{kind:'flag',flag:'draft-scenery',negate:true}]);
  assert.ok(isDraftName('ctf_garden_beta02.PMS'));assert.ok(isDraftName('tree_rc2.png'));
  assert.equal(isDraftName('ctf_Contest'),false);
});
