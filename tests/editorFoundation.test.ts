import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  makeEditedMapName,
  parsePmsFull,
  serializePms,
  SOLDAT_MAP_LIMITS,
} from '../src/shared/pmsParser';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import {
  createMapFromTemplate,
  EDITOR_MAP_TEMPLATES,
} from '../src/shared/editorTemplates';
import {
  alignSelection,
  deleteSelection,
  duplicateSelection,
  EditorDocument,
  emptySelection,
  rotateSelection,
  scaleSelection,
  translateSelection,
} from '../src/client/editor/EditorDocument';
import { SoldatMapEditorService } from '../src/server/editorService';
import { GeneratedOutputRegistry, WorkshopError } from '../src/server/safeFileWriter';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { buildSyntheticPms, findSoldatMapsDir } from './helpers';

test('lossless byte-for-byte round-trip on synthetic PMS map (with header padding & all sections)', () => {
  const baseBytes = Buffer.from(
    buildSyntheticPms({
      props: 3,
      scenery: ['bush.bmp', 'crate.png'],
      colliders: 2,
      spawns: 4,
      title: 'Test Map',
    })
  );
  // Inject non-zero Delphi stack garbage bytes inside mapName and texture ShortString padding!
  // Header layout: version(4) + mapName(1 + 38 = 39) + texture(1 + 24 = 25) ...
  baseBytes[4 + 1 + 12] = 0xde;
  baseBytes[4 + 1 + 25] = 0xad;
  baseBytes[4 + 39 + 1 + 16] = 0xbe;
  baseBytes[4 + 39 + 1 + 22] = 0xef;

  const parsed = parsePmsFull(baseBytes);
  const reserialized = Buffer.from(serializePms(parsed));
  assert.equal(reserialized.length, baseBytes.length);
  assert.ok(
    reserialized.equals(baseBytes),
    'unmodified parsePmsFull -> serializePms must be 100% byte-for-byte identical including ShortString padding'
  );
});

test('lossless byte-for-byte round-trip on real Soldat .pms maps (ctf_Ash, ctf_Kampf, and corpus)', (t) => {
  const mapsDir = findSoldatMapsDir();
  if (!mapsDir) {
    t.skip('Soldat maps folder not available');
    return;
  }

  const allFiles = fs.readdirSync(mapsDir).filter((f) => f.toLowerCase().endsWith('.pms'));
  const priority = ['ctf_Ash.pms', 'ctf_Kampf.pms', 'ctf_Laos.pms', 'dm_Arena.pms'];
  const ordered = [
    ...priority.filter((p) => allFiles.some((f) => f.toLowerCase() === p.toLowerCase())),
    ...allFiles.slice(0, 80),
  ];
  const seen = new Set<string>();

  let verifiedCount = 0;
  for (const name of ordered) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const diskName = allFiles.find((f) => f.toLowerCase() === key);
    if (!diskName) continue;
    const rawBytes = fs.readFileSync(path.join(mapsDir, diskName));
    let parsed;
    try {
      parsed = parsePmsFull(rawBytes);
    } catch {
      continue;
    }
    // Truncated files intentionally emit warnings and pad missing tail counts on serialize;
    // every well-formed .pms file with exact length must round-trip byte-for-byte!
    if (parsed.parseWarnings.length > 0) continue;

    // Trailing padding after the waypoints (common in PolyWorks maps) is kept too
    const roundTrip = Buffer.from(serializePms(parsed));
    assert.ok(roundTrip.equals(rawBytes), `${diskName}: full file must round-trip byte-for-byte`);
    verifiedCount++;
  }

  assert.ok(verifiedCount >= 10, `Expected to verify >= 10 real Soldat maps, verified ${verifiedCount}`);
});

test('strict binary section isolation when editing individual sections', () => {
  const origBytes = Buffer.from(
    buildSyntheticPms({
      props: 3,
      scenery: ['rock.bmp', 'fern.png'],
      colliders: 2,
      spawns: 3,
      title: 'Isolation Map',
    })
  );
  // Add custom padding bytes in header mapName & texture ShortStrings
  origBytes[4 + 1 + 20] = 0x77;
  origBytes[4 + 39 + 1 + 19] = 0x88;

  const map = parsePmsFull(origBytes);
  assert.equal(origBytes.length, serializePms(map).length);

  // 1. Modify ONLY spawn #1's X coordinate -> every byte before spawns and every other spawn must stay identical!
  const nextSpawns = map.spawnpoints.map((sp, idx) =>
    idx === 1 ? { index: sp.index, active: sp.active, x: sp.x + 50, y: sp.y, team: sp.team } : sp
  );
  const spawnEditedBytes = Buffer.from(serializePms({ ...map, spawnpoints: nextSpawns }));
  assert.equal(spawnEditedBytes.length, origBytes.length);

  // Spawns section sits right before waypoints (last 4 bytes = waypointCount = 0).
  // Each spawn is 16 bytes, 3 spawns = 48 bytes, preceded by 4-byte spawnCount.
  const spawnCountOffset = origBytes.length - 4 - 3 * 16 - 4;
  assert.ok(
    spawnEditedBytes.subarray(0, spawnCountOffset + 4 + 16).equals(origBytes.subarray(0, spawnCountOffset + 4 + 16)),
    'Header, polygons, sectors, props, scenery, colliders, and spawn #0 must stay 100% byte-identical'
  );
  assert.ok(
    spawnEditedBytes.subarray(spawnCountOffset + 4 + 32).equals(origBytes.subarray(spawnCountOffset + 4 + 32)),
    'Spawn #2 and waypoints must stay 100% byte-identical'
  );
  assert.equal(parsePmsFull(spawnEditedBytes).spawnpoints[1].x, map.spawnpoints[1].x + 50);

  // 2. Modify ONLY prop #1's X -> header, polygons, sectors, scenery, colliders, spawns, waypoints stay identical!
  const nextProps = map.props.map((p, idx) => {
    if (idx !== 1) return p;
    const { raw: _raw, ...rest } = p;
    return { ...rest, x: p.x + 125 };
  });
  const propEditedBytes = Buffer.from(serializePms({ ...map, props: nextProps }));
  assert.equal(propEditedBytes.length, origBytes.length);
  assert.ok(propEditedBytes.subarray(0, 88).equals(origBytes.subarray(0, 88)), '88-byte header stays identical');
  assert.ok(
    propEditedBytes.subarray(spawnCountOffset - (4 + 2 * 16)).equals(origBytes.subarray(spawnCountOffset - (4 + 2 * 16))),
    'Colliders, spawns, and waypoints stay identical when editing a prop'
  );

  // 3. Modify ONLY startJet in header -> ShortString garbage padding bytes at [25] and [59] remain preserved!
  const { rawHeader: _rh, ...restMap } = map;
  void _rh;
  // Using updateMapHeader preserves rawHeader when we keep rawHeader or patch selectively; let's test pmsParser patchHeader:
  const headerPatchedBytes = Buffer.from(serializePms({ ...map, startJet: 150, startJetGame: 178 }));
  assert.equal(headerPatchedBytes[4 + 1 + 20], 0x77, 'mapName ShortString padding byte preserved');
  assert.equal(headerPatchedBytes[4 + 39 + 1 + 19], 0x88, 'texture ShortString padding byte preserved');
  assert.ok(
    headerPatchedBytes.subarray(88).equals(origBytes.subarray(88)),
    'Everything after 88-byte header stays byte-identical when changing startJet'
  );
  assert.equal(parsePmsFull(headerPatchedBytes).startJet, 150);
});

test('makeEditedMapName generates safe _e names within 24 characters and never returns source name', () => {
  assert.equal(makeEditedMapName('ctf_Ash'), 'ctf_Ash_e');
  assert.notEqual(makeEditedMapName('ctf_Ash_e'), 'ctf_Ash_e');
  assert.equal(makeEditedMapName('ctf_Ash.pms'), 'ctf_Ash_e');
  const veryLong = 'ctf_abcdefghijklmnopqrstuvwx';
  const derived = makeEditedMapName(veryLong, 24);
  assert.ok(derived.length <= 24);
  assert.ok(derived.endsWith('_e'));
});

test('createMapFromTemplate produces valid, limit-compliant maps for all 4 templates', () => {
  assert.equal(EDITOR_MAP_TEMPLATES.length, 4);
  for (const tpl of EDITOR_MAP_TEMPLATES) {
    const created = createMapFromTemplate(tpl.id, {
      title: `Tpl ${tpl.id}`,
      texture: 'grass.bmp',
    });
    const bytes = serializePms(created);
    const reparsed = parsePmsFull(bytes);
    assert.equal(reparsed.mapName, `Tpl ${tpl.id}`);
    assert.equal(reparsed.texture, 'grass.bmp');
    assert.deepEqual(reparsed.parseWarnings, []);
    if (tpl.id === 'ctf_symmetric') {
      assert.ok(reparsed.spawnpoints.some((s) => s.team === 5), 'CTF template has Alpha flag');
      assert.ok(reparsed.spawnpoints.some((s) => s.team === 6), 'CTF template has Bravo flag');
    }
  }
});

test('EditorDocument: unlimited undo/redo, drag coalescing, history jump, and multi-object transforms', () => {
  const initial = parsePmsFull(
    buildSyntheticPms({ props: 2, scenery: ['a.png'], colliders: 2, spawns: 2 })
  );
  const doc = new EditorDocument({
    map: initial,
    sourceMapId: 'dm_test',
    sourceBaseName: 'dm_test',
  });

  assert.equal(doc.getSnapshot().currentBaseName, 'dm_test_e');
  assert.equal(doc.isDirty(), false);

  // Select polygon 0, prop 0, spawn 0, collider 0
  const sel = {
    ...emptySelection(),
    polygons: [0],
    props: [0],
    spawns: [0],
    colliders: [0],
  };
  doc.setSelection(sel);

  // Simulate 5 continuous drag frames with the same transactionId -> coalesces into 1 undo entry!
  for (let frame = 1; frame <= 5; frame++) {
    const moved = translateSelection(doc.getSnapshot().map, sel, 10, 4);
    doc.commit({ label: 'Move selection', nextMap: moved, transactionId: 'drag_1' });
  }
  assert.equal(doc.getSnapshot().undoStack.length, 1, 'drag frames with shared transactionId coalesce');
  assert.equal(doc.getSnapshot().map.spawnpoints[0].x, initial.spawnpoints[0].x + 50);
  assert.equal(doc.isDirty(), true);

  // Rotate selection 90 degrees around (0, 0)
  const rotated = rotateSelection(doc.getSnapshot().map, sel, Math.PI / 2, 0, 0);
  doc.commit({ label: 'Rotate selection', nextMap: rotated });
  assert.equal(doc.getSnapshot().undoStack.length, 2);

  // Scale selection by 2x
  const scaled = scaleSelection(doc.getSnapshot().map, sel, 2, 2, 0, 0);
  doc.commit({ label: 'Scale selection', nextMap: scaled });
  assert.equal(doc.getSnapshot().undoStack.length, 3);

  // Align two spawns horizontally
  const spawnSel = { ...emptySelection(), spawns: [0, 1] };
  const aligned = alignSelection(doc.getSnapshot().map, spawnSel, 'left');
  doc.commit({ label: 'Align left', nextMap: aligned, nextSelection: spawnSel });
  assert.equal(
    doc.getSnapshot().map.spawnpoints[0].x,
    doc.getSnapshot().map.spawnpoints[1].x,
    'alignSelection(left) aligns selected spawns to common left X'
  );
  assert.equal(doc.getSnapshot().undoStack.length, 4);

  // Duplicate selection
  const dup = duplicateSelection(doc.getSnapshot().map, sel, 32, 32);
  assert.ok(dup);
  doc.commit({ label: 'Duplicate', nextMap: dup.nextMap, nextSelection: dup.nextSelection });
  assert.equal(doc.getSnapshot().map.polygons.length, initial.polygons.length + 1);
  assert.equal(doc.getSnapshot().map.props.length, initial.props.length + 1);
  assert.equal(doc.getSnapshot().undoStack.length, 5);

  // Delete duplicated selection
  const afterDel = deleteSelection(doc.getSnapshot().map, doc.getSnapshot().selection);
  doc.commit({ label: 'Delete', nextMap: afterDel, nextSelection: emptySelection() });
  assert.equal(doc.getSnapshot().map.polygons.length, initial.polygons.length);
  assert.equal(doc.getSnapshot().undoStack.length, 6);

  // Jump directly back to depth 0 (initial opened state) without losing redo stack!
  doc.jumpToHistoryDepth(0);
  assert.equal(doc.isDirty(), false);
  assert.equal(doc.getSnapshot().undoStack.length, 0);
  assert.equal(doc.getSnapshot().redoStack.length, 6);

  // Jump forward to depth 4 and then redo twice to reach depth 6
  doc.jumpToHistoryDepth(4);
  assert.equal(doc.getSnapshot().undoStack.length, 4);
  doc.redo();
  doc.redo();
  assert.equal(doc.getSnapshot().undoStack.length, 6);
  assert.equal(doc.canRedo(), false);
  doc.undo();
  assert.equal(doc.getSnapshot().undoStack.length, 5);
});

test('SoldatMapEditorService: safe save, limit enforcement, overwrite confirmation + backup, and drafts', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-editor-foundation-'));
  try {
    const soldatRoot = path.join(baseDir, 'Soldat');
    const mapsDir = path.join(soldatRoot, 'maps');
    const exportsDir = path.join(baseDir, 'exports');
    const dataDir = path.join(baseDir, 'data');
    const cacheDir = path.join(dataDir, 'cache');
    const thumbsDir = path.join(cacheDir, 'thumbnails');
    const backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.mkdirSync(thumbsDir, { recursive: true });

    const origBytes = buildSyntheticPms({ props: 2, scenery: ['tree.png'], spawns: 2, title: 'Original' });
    fs.writeFileSync(path.join(mapsDir, 'ctf_sample.pms'), origBytes);

    const scanner = new SoldatMapScanner(soldatRoot, [], [], cacheDir, thumbsDir);
    await scanner.scanAsync(true);
    const registry = new GeneratedOutputRegistry(path.join(dataDir, 'generated-outputs.json'));
    const service = new SoldatMapEditorService(scanner, exportsDir, dataDir, backupsDir, registry);

    // 1. Check safe target name ctf_sample_e -> does not exist yet
    const checkNew = service.checkSaveTarget({
      baseName: 'ctf_sample_e',
      destination: 'soldat_maps',
      sourceMapId: 'ctf_sample',
    });
    assert.equal(checkNew.exists, false);
    assert.equal(checkNew.isSameAsSource, false);

    // 2. Save new edited map ctf_sample_e.pms
    const parsed = parsePmsFull(origBytes);
    const prepared = prepareMapForSave(
      { ...parsed, mapName: 'Edited Title' },
      { geometryDirty: true, sceneryDirty: true }
    );
    const payloadB64 = Buffer.from(serializePms(prepared)).toString('base64');

    const savedNew = await service.saveEditedMap({
      baseName: 'ctf_sample_e',
      destination: 'soldat_maps',
      sourceMapId: 'ctf_sample',
      confirmOverwrite: false,
      pmsBase64: payloadB64,
    });
    assert.equal(savedNew.fileName, 'ctf_sample_e.pms');
    assert.ok(fs.existsSync(savedNew.outputPath));
    assert.equal(savedNew.backupDir, null, 'no backup needed for brand-new file');
    assert.equal(savedNew.newMapId, 'ctf_sample_e', 'library scanner automatically indexed saved map');

    // 3. Refuses unconfirmed overwrite with 409 Conflict
    await assert.rejects(
      () =>
        service.saveEditedMap({
          baseName: 'ctf_sample',
          destination: 'soldat_maps',
          sourceMapId: 'ctf_sample',
          confirmOverwrite: false,
          pmsBase64: payloadB64,
        }),
      (err: unknown) => err instanceof WorkshopError && err.status === 409
    );

    // 4. Confirmed overwrite creates automatic timestamped backup in data/backups/ before atomic replace
    const overwritten = await service.saveEditedMap({
      baseName: 'ctf_sample',
      destination: 'soldat_maps',
      sourceMapId: 'ctf_sample',
      confirmOverwrite: true,
      pmsBase64: payloadB64,
    });
    assert.ok(overwritten.backupDir, 'backup directory created on overwrite');
    assert.ok(fs.existsSync(overwritten.backupDir!));
    assert.equal(parsePmsFull(fs.readFileSync(overwritten.outputPath)).mapName, 'Edited Title');

    // 5. Refuses maps exceeding Soldat engine limits (> 500 props)
    const tooManyProps = Array.from({ length: SOLDAT_MAP_LIMITS.maxProps + 1 }, (_, idx) => ({
      ...parsed.props[0],
      index: idx,
    }));
    const overLimitB64 = Buffer.from(serializePms({ ...parsed, props: tooManyProps })).toString('base64');
    await assert.rejects(
      () =>
        service.saveEditedMap({
          baseName: 'ctf_overlimit',
          destination: 'exports_editor',
          pmsBase64: overLimitB64,
        }),
      (err: unknown) => err instanceof WorkshopError && err.status === 400
    );

    // 6. Drafts CRUD in data/editor-drafts/ (never touches Soldat maps/ folder)
    const mapsFilesBeforeDrafts = fs.readdirSync(mapsDir).sort();
    const draftSummary = service.saveDraft('draft_test_01', {
      sourceMapId: 'ctf_sample',
      baseName: 'ctf_sample_e',
      pmsBase64: payloadB64,
    });
    assert.equal(draftSummary.draftId, 'draft_test_01');
    assert.deepEqual(
      fs.readdirSync(mapsDir).sort(),
      mapsFilesBeforeDrafts,
      'autosave drafts never touch the Soldat maps/ folder'
    );

    const listed = service.listDrafts();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, 'Edited Title');

    const loadedDraft = service.getDraft('draft_test_01');
    assert.equal(loadedDraft.pmsBase64, payloadB64);

    service.deleteDraft('draft_test_01');
    assert.equal(service.listDrafts().length, 0);
  } finally {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Ignore Windows temp EPERM if file handle is releasing
    }
  }
});
