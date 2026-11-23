import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeProjectFile, downloadProjectFile, encodeProjectFile, readProjectFile } from '../src/client/editor/projectFile';
import { mapAssetOriginId, mapAssetSource, setMapAssetSource } from '../src/client/renderer/mapAssetSource';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { soldatCrc32, serializePms } from '../src/shared/pmsParser';
import { DEFAULT_TUNNEL } from '../src/shared/climbTunnel';
import { type TunnelSketch } from '../src/shared/tunnelSketch';
import { SoldatMapEditorService } from '../src/server/editorService';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { GeneratedOutputRegistry } from '../src/server/safeFileWriter';

const sketch: TunnelSketch = {
  method: 'draw',
  path: [{ x: -117, y: 30 }, { x: 0, y: -44 }, { x: 83, y: 32 }],
  settings: {
    ...DEFAULT_TUNNEL,
    seed: 741,
    profile: {
      measuredMaps: 1, pairs: 1, bounceMaps: 1,
      jumps: [{ gap: 83.25, rise: 7 }], rebounds: [1.25],
      bounceJumps: [{ gap: 106, rise: 15.75, rebound: 1.25 }],
    },
  },
};

// Independently construct the published v1 envelope to test compatibility and error paths.
function envelope(manifest: unknown, pms: Uint8Array, version = 1) {
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const buffer = new Uint8Array(20 + json.length + pms.length);
  buffer.set([83,77,83,80]);
  const view = new DataView(buffer.buffer);
  view.setUint32(4, version, true);
  view.setUint32(8, json.length, true);
  view.setUint32(12, pms.length, true);
  buffer.set(json, 20);
  buffer.set(pms, 20 + json.length);
  view.setUint32(16, soldatCrc32(buffer.subarray(20)), true);
  return buffer;
}

test('a portable project restores the editable sketch, local measurements and the complete PMS', async () => {
  const map = createMapFromTemplate('ctf_symmetric', { title: 'Próba w Łodzi', texture: 'test.bmp' });
  map.editorSketch = structuredClone(sketch);
  map.rawTail = new Uint8Array([31, 7, 109]);
  const pmsBefore = serializePms(map);
  const encoded = encodeProjectFile('ctf_Łódź', map);
  const doc = await readProjectFile(new File([encoded], 'renamed.smaproj'));
  assert.equal(doc.baseName, 'ctf_Łódź');
  assert.deepEqual(doc.map.editorSketch, sketch);
  assert.equal(doc.sketch, doc.map.editorSketch);
  assert.deepEqual(doc.tunnels, []);
  assert.deepEqual(serializePms(doc.map), pmsBefore);
  assert.deepEqual(encodeProjectFile(doc.baseName, doc.map), encoded);
});

test('the native save picker completes the project write, honours cancel and aborts an interrupted write', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'window');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis,'window',previous);
    else Reflect.deleteProperty(globalThis,'window');
  });
  const map = createMapFromTemplate('empty');
  let cancelled = false, failWrite = false, closed = 0, aborted = 0;
  const files: Blob[] = [];
  const picker = async (options: { suggestedName: string }) => {
    assert.equal(options.suggestedName,'time_trial.smaproj');
    if (cancelled) throw new DOMException('cancelled','AbortError');
    return { createWritable: async () => ({
      async write(file: Blob) { if (failWrite) throw new Error('write interrupted'); files.push(file); },
      async close() { closed++; }, async abort() { aborted++; },
    }) };
  };
  Object.defineProperty(globalThis,'window',{configurable:true,value:{showSaveFilePicker:picker}});
  assert.equal(await downloadProjectFile('time_trial',map,[],sketch),'written');
  assert.equal(closed,1);
  assert.deepEqual(decodeProjectFile(new Uint8Array(await files[0].arrayBuffer())).map.editorSketch,sketch);
  cancelled = true;
  assert.equal(await downloadProjectFile('time_trial',map),false);
  cancelled = false;
  failWrite = true;
  await assert.rejects(downloadProjectFile('time_trial',map), /write interrupted/);
  assert.equal(closed,1);
  assert.equal(aborted,1);
});

test('download-only browsers report a transfer without confirming a disk write', async t => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    for (const [name, previous] of [['document', previousDocument], ['window', previousWindow]] as const) {
      if (previous) Object.defineProperty(globalThis,name,previous);
      else Reflect.deleteProperty(globalThis,name);
    }
  });
  let clicked = false, removed = false, attached = false;
  const anchor = { href:'', download:'', click() { clicked = true; }, remove() { removed = true; } };
  Object.defineProperty(globalThis,'window',{
    configurable:true, value:{setTimeout(callback:()=>void) { callback(); }},
  });
  Object.defineProperty(globalThis,'document',{
    configurable:true, value:{createElement:()=>anchor, body:{append() { attached = true; }}},
  });
  assert.equal(await downloadProjectFile('demo',createMapFromTemplate('empty')),'download-started');
  assert.ok(clicked && removed && attached);
  assert.equal(anchor.download,'demo.smaproj');
});

test('projects without a tunnel remain regular editable maps', () => {
  const pms = serializePms(createMapFromTemplate('arena'));
  const bytes = envelope({baseName:'dm_arena'}, pms);
  const padded = new Uint8Array(bytes.length + 8);
  padded.set(bytes, 3);
  const doc = decodeProjectFile(padded.subarray(3, 3 + bytes.length));
  assert.deepEqual(doc.tunnels, []);
  assert.equal(doc.map.editorSketch, undefined);
  assert.equal(doc.map.editorTunnels, undefined);
  assert.deepEqual(serializePms(doc.map), pms);
});

test('reopened projects find current package graphics and retain their origin when moved offline', async t => {
  const map=createMapFromTemplate('arena'),id='archive:subfolder/map';
  setMapAssetSource(map,id,'old-scope');
  const bytes=encodeProjectFile('demo',map);
  const file=new File([bytes],'demo.smaproj');
  let available=true;
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    assert.equal(url,'/api/maps/'+encodeURIComponent(id)+'/raw');
    assert.equal(init.method,'HEAD');
    return available ? new Response(null,{headers:{'X-Soldat-Asset-Scope':'new-scope'}}) : new Response(null,{status:404});
  });
  const opened=await readProjectFile(file);
  assert.deepEqual(mapAssetSource(opened.map),{mapId:id,key:'new-scope'});
  available=false;
  const moved=await readProjectFile(file);
  assert.equal(mapAssetSource(moved.map),undefined);
  const roundTrip=decodeProjectFile(encodeProjectFile('demo',moved.map));
  assert.equal(mapAssetOriginId(roundTrip.map),id);
  assert.deepEqual(serializePms(moved.map),serializePms(map));
});

test('a project stays primary after exporting a plain PMS even with no sketch or tunnel', () => {
  const base = createMapFromTemplate('empty');
  const doc = new EditorDocument({ map: base, initialBaseName: 'ctf_project', projectFile: true });
  const edited = { ...base, mapName: 'Changed' };
  const before = doc.commit({ label: 'Rename', nextMap: edited });
  assert.equal(doc.markSaved({ ...edited }, 'different_export', 'game-id', edited, 'pms'), before);
  assert.equal(doc.getSnapshot().projectFile, true);
  assert.equal(doc.getSnapshot().currentBaseName, 'ctf_project');
  assert.ok(doc.isDirty());

  const ordinary = new EditorDocument({ map: base });
  ordinary.commit({ label: 'Rename', nextMap: edited });
  ordinary.markSaved(edited, 'game_file', 'game-id', edited);
  assert.equal(ordinary.getSnapshot().currentBaseName, 'game_file');
  assert.equal(ordinary.getSnapshot().hasSavedOnce, true);
  assert.equal(ordinary.getSnapshot().projectFile, false);
  assert.equal(ordinary.isDirty(), false);
  ordinary.markSaved(edited, 'portable_copy', null, edited, 'project');
  assert.equal(ordinary.getSnapshot().projectFile, true);
  assert.equal(ordinary.getSnapshot().currentBaseName, 'portable_copy');
});

test('saving a normalized revision preserves the clean state through Undo, Redo and concurrent edits', () => {
  const initial = createMapFromTemplate('empty');
  for (const finishWhileAtSavedRevision of [false, true]) {
    const doc = new EditorDocument({ map: initial });
    const intermediate = { ...initial, editorSketch: sketch };
    const latest = { ...intermediate, mapName: 'Newest revision' };
    const prepared = { ...intermediate };
    doc.commit({ label: 'Sketch', nextMap: intermediate });
    doc.commit({ label: 'Rename', nextMap: latest });
    if (finishWhileAtSavedRevision) doc.undo();
    doc.markSaved(prepared, 'ctf_saved', null, intermediate, 'project');
    if (finishWhileAtSavedRevision) {
      assert.equal(doc.isDirty(), false);
      doc.redo();
    }
    assert.equal(doc.getSnapshot().map, latest);
    assert.equal(doc.isDirty(), true);
    assert.equal(doc.undo().map, prepared);
    assert.equal(doc.isDirty(), false);
    assert.equal(doc.undo().map, initial);
    assert.equal(doc.isDirty(), true);
    assert.equal(doc.redo().map, prepared);
    assert.equal(doc.isDirty(), false);
  }
});

test('the loader rejects unsupported, incomplete and inconsistent files before opening a document', async () => {
  const map = createMapFromTemplate('empty');
  const pms = serializePms(map);
  const bytes = encodeProjectFile('kz_test', map);
  const wrongChecksum = bytes.slice();
  wrongChecksum[wrongChecksum.length-1] ^= 1;
  assert.throws(() => decodeProjectFile(pms), /choose.*project/i);
  assert.throws(() => decodeProjectFile(envelope({baseName:'kz_test'},pms,89)), /version/i);
  assert.throws(() => decodeProjectFile(bytes.subarray(0,bytes.length-1)), /incomplete|damaged/i);
  assert.throws(() => decodeProjectFile(wrongChecksum), /incomplete|damaged/i);
  assert.throws(() => decodeProjectFile(envelope({baseName:'kz_test'},pms.subarray(0,50))), /map.*damaged/i);
  assert.throws(() => decodeProjectFile(envelope({baseName:'../../folder'},pms)), /file name/i);
  assert.throws(() => decodeProjectFile(envelope({baseName:'ok', sketch:{...sketch,path:[{x:'100',y:2}]}}, pms)), /tunnel editing/i);
  assert.throws(() => decodeProjectFile(envelope({baseName:'ok', tunnels:[{version:44}]}, pms)), /tunnel editing/i);
  // Size is checked before reading the file contents, including when the OS supplied a misleading extension.
  await assert.rejects(readProjectFile({size:64*1024*1024+1} as File), /size/i);
});

test('recovery retains editable data, can still read earlier PMS-only drafts, and preserves the previous save on an invalid update', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-project-recovery-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.match(path.basename(dir),/^sms-project-recovery-[a-zA-Z0-9]+$/);
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:40});
  });
  const service = () => new SoldatMapEditorService(
    Object.create(SoldatMapScanner.prototype), path.join(dir,'exports'), dir,
    path.join(dir,'backups'), new GeneratedOutputRegistry(path.join(dir,'registry.json'))
  );
  const draft = {baseName: 'ctf_tunel', pmsBase64: Buffer.from(serializePms(createMapFromTemplate('empty'))).toString('base64')};
  const old = service().saveDraft('original', draft);
  const current = service().saveDraft('sketch', {...draft, tunnels:[], sketch, assetMapId:'extra:demo'});
  assert.ok(!('sketch' in old) && !('sketch' in current));
  assert.equal(service().getDraft('original').sketch, undefined);
  assert.equal(service().getDraft('original').projectFile, undefined);
  assert.equal(service().getDraft('sketch').assetMapId,'extra:demo');
  service().saveDraft('blank-project', { ...draft, projectFile: true });
  assert.equal(service().getDraft('blank-project').projectFile, true);
  assert.deepEqual(service().getDraft('sketch').sketch, sketch);
  assert.throws(() => service().saveDraft('sketch', {...draft, sketch:{...sketch,settings:{seed:1}}}));
  assert.deepEqual(service().getDraft('sketch').sketch, sketch);
});
