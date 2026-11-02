import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { SoldatMapEditorService } from '../src/server/editorService';
import { GeneratedOutputRegistry } from '../src/server/safeFileWriter';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { createPolygonFromPoints } from '../src/shared/pmsCompiler';
import { computeSelectionExactBounds, EditorDocument, emptySelection, translateSelection } from '../src/client/editor/EditorDocument';
import { createSoldierPlaytestState, stepSoldierPlaytest } from '../src/client/editor/soldierPlaytest';
import { EditorSpatialIndex } from '../src/client/editor/spatialIndex';
import { buildSyntheticPms } from './helpers';

test('undo history: no entry for a no-op edit, and one gesture only merges while the selection stays the same', () => {
  const map = parsePmsFull(buildSyntheticPms({ spawns: 2 }));
  const doc = new EditorDocument({ map });
  const selA = { ...emptySelection(), spawns: [0] };
  const selB = { ...emptySelection(), spawns: [1] };

  // A drag that snapped back to the start passes the same map: nothing to undo, selection still applied
  doc.commit({ label: 'Move selection', nextMap: map, nextSelection: selA, transactionId: 'drag1' });
  assert.equal(doc.getSnapshot().undoStack.length, 0);
  assert.deepEqual(doc.getSnapshot().selection.spawns, [0]);

  // Nudge A twice (same key transaction) = one step
  const a1 = translateSelection(doc.getSnapshot().map, selA, 1, 0);
  doc.commit({ label: 'Nudge selection', nextMap: a1, transactionId: 'arrow_nudge' });
  const a2 = translateSelection(doc.getSnapshot().map, selA, 1, 0);
  doc.commit({ label: 'Nudge selection', nextMap: a2, transactionId: 'arrow_nudge' });
  assert.equal(doc.getSnapshot().undoStack.length, 1);

  // Select B and nudge it with the same transaction id: a separate step, so one undo only reverts B
  doc.setSelection(selB);
  const b1 = translateSelection(doc.getSnapshot().map, selB, 0, 5);
  doc.commit({ label: 'Nudge selection', nextMap: b1, transactionId: 'arrow_nudge' });
  assert.equal(doc.getSnapshot().undoStack.length, 2);
  doc.undo();
  assert.equal(doc.getSnapshot().map.spawnpoints[0].x, map.spawnpoints[0].x + 2, 'A keeps both nudges');
  assert.equal(doc.getSnapshot().map.spawnpoints[1].y, map.spawnpoints[1].y);
});

test('a recovered draft opens as unsaved, and a save that raced with an edit keeps the newer edit', () => {
  const map = parsePmsFull(buildSyntheticPms({ spawns: 1 }));
  const draft = new EditorDocument({ map, startDirty: true });
  assert.equal(draft.isDirty(), true);
  assert.equal(draft.isGeometryDirty(), false, 'the draft geometry itself is not an edit');

  const doc = new EditorDocument({ map });
  const sel = { ...emptySelection(), spawns: [0] };
  const edited = translateSelection(map, sel, 10, 0);
  doc.commit({ label: 'Move selection', nextMap: edited, nextSelection: sel });
  const savedFrom = doc.getSnapshot().map;
  // The user keeps editing while the save request is on its way
  const later = translateSelection(savedFrom, sel, 10, 0);
  doc.commit({ label: 'Move selection', nextMap: later, nextSelection: sel });
  doc.markSaved(savedFrom, 'x_e', null, savedFrom);
  assert.equal(doc.getSnapshot().map, later, 'the newer edit survives');
  assert.equal(doc.isDirty(), true, 'and is still unsaved');
});

test('playtest soldier lands on the floor instead of sinking into it after long falls', () => {
  // Wide floor slab: top edge at y = 0
  const base = parsePmsFull(buildSyntheticPms({}));
  const floor = [
    createPolygonFromPoints([
      { x: -400, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 60 },
    ]),
    createPolygonFromPoints([
      { x: -400, y: 0 },
      { x: 400, y: 60 },
      { x: -400, y: 60 },
    ]),
  ];
  const map = { ...base, polygons: floor };
  const index = new EditorSpatialIndex(map);
  const noInput = { left: false, right: false, jump: false, crouch: false, jetpack: false };
  let sunk = 0;
  for (let i = 0; i < 60; i++) {
    let st = createSoldierPlaytestState(-300 + i * 10, -600 - i * 7, map, 1);
    for (let tick = 0; tick < 900 && !st.grounded; tick++) st = stepSoldierPlaytest(st, noInput, map, index);
    for (let tick = 0; tick < 30; tick++) st = stepSoldierPlaytest(st, noInput, map, index);
    const feetY = st.y + 3.5; // centre of the feet sphere
    if (!st.grounded || feetY > 0) sunk++;
  }
  assert.equal(sunk, 0);
});

test('saving the same document again skips the backup copy; overwriting anything else still backs it up', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-editor-review-'));
  try {
    const soldatRoot = path.join(baseDir, 'Soldat');
    const mapsDir = path.join(soldatRoot, 'maps');
    const dataDir = path.join(baseDir, 'data');
    const cacheDir = path.join(dataDir, 'cache');
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.mkdirSync(path.join(cacheDir, 'thumbnails'), { recursive: true });
    const bytes = buildSyntheticPms({ title: 'Original' });
    fs.writeFileSync(path.join(mapsDir, 'ctf_doc.pms'), bytes);
    const scanner = new SoldatMapScanner(soldatRoot, [], [], cacheDir, path.join(cacheDir, 'thumbnails'));
    await scanner.scanAsync(true);
    const registry = new GeneratedOutputRegistry(path.join(dataDir, 'generated-outputs.json'));
    const service = new SoldatMapEditorService(scanner, path.join(baseDir, 'exports'), dataDir, path.join(dataDir, 'backups'), registry);
    const payload = (title: string) =>
      Buffer.from(serializePms({ ...parsePmsFull(bytes), mapName: title, rawHeader: undefined })).toString('base64');

    const first = await service.saveEditedMap({
      baseName: 'ctf_doc_e',
      destination: 'soldat_maps',
      sourceMapId: 'ctf_doc',
      pmsBase64: payload('v1'),
      documentId: 'draft_a',
    });
    assert.equal(first.backupDir, null);
    // Ctrl+S again from the same document (its source is now the saved file itself)
    const again = await service.saveEditedMap({
      baseName: 'ctf_doc_e',
      destination: 'soldat_maps',
      sourceMapId: first.newMapId,
      confirmOverwrite: true,
      pmsBase64: payload('v2'),
      documentId: 'draft_a',
    });
    assert.equal(again.backupDir, null, 'own previous save is replaced without a backup');
    // Another editing session of the same map saving over that file keeps a copy of the first session's work
    const otherSession = await service.saveEditedMap({
      baseName: 'ctf_doc_e',
      destination: 'soldat_maps',
      sourceMapId: 'ctf_doc',
      confirmOverwrite: true,
      pmsBase64: payload('other'),
      documentId: 'draft_b',
    });
    assert.ok(otherSession.backupDir, 'a different document is backed up first');

    // Someone edits the file outside the editor: the next overwrite keeps a copy
    fs.writeFileSync(again.outputPath, buildSyntheticPms({ title: 'Hand edited' }));
    const afterEdit = await service.saveEditedMap({
      baseName: 'ctf_doc_e',
      destination: 'soldat_maps',
      sourceMapId: first.newMapId,
      confirmOverwrite: true,
      pmsBase64: payload('v3'),
      documentId: 'draft_b',
    });
    assert.ok(afterEdit.backupDir && fs.existsSync(afterEdit.backupDir));

    // Overwriting the original map (not the editor's own output) always backs it up
    const original = await service.saveEditedMap({ baseName: 'ctf_doc', destination: 'soldat_maps', sourceMapId: 'ctf_doc', confirmOverwrite: true, pmsBase64: payload('v4') });
    assert.ok(original.backupDir);
  } finally {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows may still hold a handle for a moment; the temp folder is cleaned up later
    }
  }
});

test('exact selection box: a single spawn is a point, polygons and sceneries use their real extent', () => {
  const map = parsePmsFull(buildSyntheticPms({ spawns: 2, props: 1 }));
  const one = computeSelectionExactBounds(map, { ...emptySelection(), spawns: [0] })!;
  assert.equal(one.width, 0);
  assert.equal(one.height, 0);
  assert.equal(one.left, map.spawnpoints[0].x);
  assert.equal(one.top, map.spawnpoints[0].y);
  const poly = computeSelectionExactBounds(map, { ...emptySelection(), polygons: [0] })!;
  const xs = map.polygons[0].vertices.map((v) => v.x);
  assert.equal(poly.left, Math.min(...xs));
  assert.equal(poly.width, Math.max(...xs) - Math.min(...xs));
  assert.equal(computeSelectionExactBounds(map, emptySelection()), null);
});
