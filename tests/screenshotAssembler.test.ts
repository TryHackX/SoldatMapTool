import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {addSessionTile, cancelTileSession, createTileSession, finalizeTileSession} from '../src/server/screenshotAssembler';

async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-screenshot-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^sms-screenshot-[a-zA-Z0-9]+$/);
    fs.rmSync(root, {recursive:true, force:true});
  });
  const outDir = path.join(root, 'output');
  fs.mkdirSync(outDir);
  const target = path.join(outDir, 'map.png');
  const png = (background: string) => sharp({create:{width:2,height:1,channels:4,background}}).png().toBuffer();
  const previous = await png('red');
  fs.writeFileSync(target, previous);
  const id = createTileSession({mapName:'map', width:2, height:1, format:'png', cacheRoot:root});
  addSessionTile(id, 0, 0, await png('blue'));
  const assertClosed = () => {
    assert.deepEqual(fs.readdirSync(outDir), ['map.png']);
    assert.deepEqual(fs.readdirSync(path.join(root, 'tile-sessions')), []);
    assert.throws(() => addSessionTile(id, 0, 0, previous), {status:404});
  };
  return {id,outDir,target,previous,assertClosed};
}

test('existing screenshot survives an encoder failure after the first output bytes', async t => {
  const {id,outDir,target,previous,assertClosed} = await fixture(t);
  t.mock.method(sharp.prototype, 'toFile', async (output: string) => {
    fs.writeFileSync(output, Buffer.from('partial encoded image'));
    throw new Error('encoder failed');
  });
  await assert.rejects(finalizeTileSession(id, outDir, 'map.png'), /encoder failed/);
  assert.deepEqual(fs.readFileSync(target), previous);
  assertClosed();
});

test('cancelling a running composition discards staged output and releases input tiles', async t => {
  const {id,outDir,target,previous,assertClosed} = await fixture(t);
  const pending = finalizeTileSession(id, outDir, 'map.png');
  cancelTileSession(id);
  await assert.rejects(pending, {status:404});
  assert.deepEqual(fs.readFileSync(target), previous);
  assertClosed();
});

test('one finalizer publishes the image and rejects late tiles or concurrent finalization', async t => {
  const {id,outDir,target,previous,assertClosed} = await fixture(t);
  const pending = finalizeTileSession(id, outDir, 'map.png');
  assert.throws(() => addSessionTile(id, 0, 0, previous), {status:409});
  await assert.rejects(finalizeTileSession(id, outDir, 'map.png'), {status:409});
  const result = await pending;
  assert.equal(result.outputPath, target);
  assert.equal(result.sizeBytes, fs.statSync(target).size);
  const pixels = await sharp(target).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...pixels], [0,0,255,255,0,0,255,255]);
  assertClosed();
});
