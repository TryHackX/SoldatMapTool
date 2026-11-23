import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DraftAutosave } from '../src/client/editor/draftAutosave';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { appendTunnel } from '../src/client/editor/tunnelBlueprint';
import { DEFAULT_TUNNEL, generateClimbTunnel } from '../src/shared/climbTunnel';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { serializePms } from '../src/shared/pmsParser';
import { SoldatMapEditorService } from '../src/server/editorService';
import { GeneratedOutputRegistry } from '../src/server/safeFileWriter';
import { SoldatMapScanner } from '../src/server/soldatScanner';

function pausedRequest() {
  let finishAndRespond!: () => void;
  const response = new Promise<void>(resolve => { finishAndRespond = resolve; });
  return {response, finishAndRespond};
}

test('undoing the tunnel and closing the clean map removes only its recovery file, after its in-flight write', async t => {
  const base=createMapFromTemplate('empty');
  const doc=new EditorDocument({map:base,initialBaseName:'ctf_trial',draftId:'draft_a'});
  const sibling=new EditorDocument({map:base,initialBaseName:'ctf_trial',draftId:'draft_b',startDirty:true});
  const tunnel=generateClimbTunnel(DEFAULT_TUNNEL,[{x:0,y:0},{x:450,y:10}]);
  const inserted=appendTunnel(base,tunnel,DEFAULT_TUNNEL,true)!;
  assert.ok(inserted);
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'sms-recovery-'));
  t.after(()=>{
    const dir=path.resolve(scratch);
    assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));
    assert.match(path.basename(dir),/^sms-recovery-[a-zA-Z0-9]+$/);
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:40});
  });
  // Draft storage is independent of the library scanner. Do not open SQLite handles for this fixture.
  const scanner:SoldatMapScanner=Object.create(SoldatMapScanner.prototype);
  const freshService=()=>new SoldatMapEditorService(
    scanner,
    path.join(scratch,'exports'),scratch,path.join(scratch,'backups'),new GeneratedOutputRegistry(path.join(scratch,'registry.json'))
  );
  const service=freshService(), sync=new DraftAutosave();
  const otherPayload={baseName:'ctf_trial',pmsBase64:Buffer.from(serializePms(base)).toString('base64')};
  service.saveDraft('draft_b',otherPayload);
  const removed:string[]=[];
  t.mock.method(globalThis,'fetch',async (url:string,init:RequestInit) => {
    assert.equal(init.method,'DELETE');
    assert.equal(init.keepalive,true);
    const id=url.split('/').at(-1)!;
    removed.push(id);
    service.deleteDraft(id);
    return new Response(null,{status:204});
  });
  sync.rememberRecovered('draft_b',base);
  const {response,finishAndRespond}=pausedRequest();
  const edit=doc.commit({label:'Insert tunnel',nextMap:inserted});
  const post=sync.save(edit.draftId,edit.map,async () => {
    await response;
    service.saveDraft(edit.draftId,{baseName:edit.currentBaseName,pmsBase64:Buffer.from(serializePms(edit.map)).toString('base64')});
  });
  const clean=doc.undo();
  assert.equal(clean.map,clean.savedMap);
  const undo=sync.clearIfClean(clean),close=sync.clear(clean.draftId);
  await sync.clearIfClean(sibling.getSnapshot());
  await Promise.resolve();
  assert.deepEqual(removed,[]);
  finishAndRespond();
  await Promise.all([post,undo,close]);
  assert.deepEqual(removed,['draft_a']);
  const restarted=freshService();
  assert.deepEqual(restarted.listDrafts().map(d=>d.draftId),['draft_b']);
  assert.equal(restarted.getDraft('draft_b').pmsBase64,otherPayload.pmsBase64);
  await sync.clear(clean.draftId);
  assert.deepEqual(removed,['draft_a']);
});

test('redo autosaves the restored revision after a pending delete, and a failed delete can be retried', async t => {
  const base=createMapFromTemplate('empty'), edited={...base,mapName:'New edits'};
  const sync=new DraftAutosave(), calls:string[]=[];
  const {response,finishAndRespond}=pausedRequest();
  let failOnce=true;
  t.mock.method(globalThis,'fetch',async () => {
    calls.push('DELETE');
    if (failOnce) {
      failOnce=false;
      return new Response(null,{status:503});
    }
    await response;
    return new Response(null,{status:204});
  });
  sync.rememberRecovered('same_id',edited);
  await sync.save('same_id',edited,async () => { calls.push('unexpected duplicate'); });
  await sync.clear('same_id');
  const second=sync.clear('same_id');
  const redone=sync.save('same_id',edited,async () => { calls.push('POST edited'); });
  await Promise.resolve();
  assert.deepEqual(calls,['DELETE','DELETE']);
  finishAndRespond();
  await Promise.all([second,redone]);
  assert.deepEqual(calls,['DELETE','DELETE','POST edited']);
  await sync.save('same_id',edited,async () => { calls.push('unexpected duplicate'); });
  await sync.clear('never-autosaved');
  assert.deepEqual(calls,['DELETE','DELETE','POST edited']);
});
