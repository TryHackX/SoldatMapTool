import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonStoreFile } from '../src/server/jsonStoreFile';
import { PackPresetStore } from '../src/server/packPresets';
import { UserDataStore } from '../src/server/userDataStore';
import { ExportDownloads } from '../src/server/exportDownloads';

test('failed writes keep previous tags and packing presets, including for the next successful save',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sms-settings-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'store');
  const file=path.join(dir,'tags.json'), presets=new PackPresetStore(path.join(dir,'presets.json')), users=new UserDataStore(file);
  users.update('map',{tags:['saved']});
  presets.save('first',{});
  const backup=path.join(root,'backup');
  fs.renameSync(dir,backup);
  fs.writeFileSync(dir,'temporarily unavailable');
  assert.throws(()=>users.update('map',{tags:['failed']}));
  assert.throws(()=>presets.remove('first'));
  assert.throws(()=>presets.save('failed',{}));
  assert.deepEqual(users.get('map')?.tags,['saved']);
  assert.deepEqual(presets.list().map(p=>p.name),['first']);
  fs.unlinkSync(dir);
  fs.renameSync(backup,dir);
  users.update('map',{favorite:true});
  assert.deepEqual(new UserDataStore(file).get('map')?.tags,['saved']);
});
test('an unreadable JSON path propagates the I/O error and leaves the path intact',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sms-read-json-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>readJsonStoreFile(dir));
  assert.ok(fs.statSync(dir).isDirectory());
});

test('published downloads survive restart and a custom export link expires when its file changes', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'sms-export-links-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const packs = path.join(temp,'packs'), key = path.join(temp,'runtime','key');
  fs.mkdirSync(packs);
  const normal = path.join(packs,'normal.zip'), custom = path.join(temp,'chosen.zip');
  fs.writeFileSync(normal,'one');
  fs.writeFileSync(custom,'two');
  const downloads = () => new ExportDownloads([path.join(temp,'screenshots'),packs],key);
  assert.equal(downloads().resolve(normal,undefined),fs.realpathSync(normal));
  assert.equal(downloads().resolve(custom,undefined),undefined);
  const token = new URL(downloads().link(custom),'http://localhost').searchParams.get('token');
  assert.equal(downloads().resolve(custom,token),fs.realpathSync(custom));
  fs.appendFileSync(custom,' updated');
  assert.equal(downloads().resolve(custom,token),undefined);
});
