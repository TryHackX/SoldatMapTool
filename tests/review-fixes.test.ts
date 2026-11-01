import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { isSameMapFamily } from '../src/shared/mapFamily';
import { makeOptimizeOutputName } from '../src/shared/pmsParser';
import { parseSearchQuery } from '../src/shared/searchQuery';
import { installFileLogger } from '../src/server/logger';
import { LibraryError, listDuplicateGroups, moveDuplicateMaps, runLibraryOperation } from '../src/server/libraryTools';
import { executePackBuild } from '../src/server/packBuilder';
import { PackPresetStore } from '../src/server/packPresets';
import { duplicateIdentityKey, SoldatMapScanner } from '../src/server/soldatScanner';
import { UserDataStore } from '../src/server/userDataStore';
import { extractZipSafely, ZIP_LIMITS, ZipSafetyError } from '../src/server/zipSafety';
import { buildSyntheticPms } from './helpers';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function scannerWith(maps: Record<string, Uint8Array | Buffer>, extra?: { dir: string; label: string }) {
  const base = tempDir('sms-review-');
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  for (const [name, bytes] of Object.entries(maps)) fs.writeFileSync(path.join(root, 'maps', `${name}.pms`), bytes);
  const cache = path.join(base, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const sources = extra ? [{ id: 'arch', path: extra.dir, label: extra.label, recursive: true, enabled: true }] : [];
  const scanner = new SoldatMapScanner(root, sources, [], cache, path.join(cache, 'thumbnails'));
  await scanner.scanAsync(true);
  return { base, root, scanner };
}

// ---------------- duplicates: the disk is checked right before moving ----------------

test('duplicate move refuses when the kept copy disappeared or the moved file changed after the scan', async () => {
  const archive = tempDir('sms-review-arch-');
  const bytes = buildSyntheticPms({ props: 2, title: 'Dup' });
  fs.writeFileSync(path.join(archive, 'ctf_dup.pms'), bytes);
  const env = await scannerWith({ ctf_dup: bytes }, { dir: archive, label: 'Archiwum' });
  const backups = path.join(env.base, 'backups');

  // The copy that should stay was deleted in Explorer, no rescan since
  fs.renameSync(path.join(env.root, 'maps', 'ctf_dup.pms'), path.join(env.base, 'away.pms'));
  await assert.rejects(moveDuplicateMaps(env.scanner, ['arch:ctf_dup'], backups), (e) => e instanceof LibraryError && e.status === 409);
  assert.ok(fs.existsSync(path.join(archive, 'ctf_dup.pms')), 'the last remaining copy is never moved');

  // The file to move was edited after the scan
  fs.renameSync(path.join(env.base, 'away.pms'), path.join(env.root, 'maps', 'ctf_dup.pms'));
  fs.appendFileSync(path.join(archive, 'ctf_dup.pms'), Buffer.from([0]));
  await assert.rejects(moveDuplicateMaps(env.scanner, ['arch:ctf_dup'], backups), (e) => e instanceof LibraryError && e.status === 409);
});

test('duplicate identity: same CRC and size; unreadable files (CRC 0) never form a group', () => {
  assert.equal(duplicateIdentityKey(0, 1234), null);
  assert.equal(duplicateIdentityKey(0xdeadbeef, 100), duplicateIdentityKey(0xdeadbeef, 100));
  assert.notEqual(duplicateIdentityKey(0xdeadbeef, 100), duplicateIdentityKey(0xdeadbeef, 101));
  assert.equal(duplicateIdentityKey(-559038737, 100), duplicateIdentityKey(0xdeadbeef, 100), 'signed and unsigned CRC agree');
});

test('library operations run one at a time', async () => {
  let release: () => void = () => {};
  const first = runLibraryOperation(() => new Promise<void>((r) => (release = r)));
  await assert.rejects(runLibraryOperation(async () => {}), (e) => e instanceof LibraryError && e.status === 409);
  release();
  await first;
  await runLibraryOperation(async () => {}); // free again
});

// ---------------- naming, search parser ----------------

test('_f_o names keep the _f marker for long names and never reproduce the source name', () => {
  for (const name of ['ctf_Abcdefghijklmnopq_o', 'ctf_Laos_Remake_Final_v2', 'ctf_LongMapNameHere', 'ctf_cs_office2']) {
    const plain = makeOptimizeOutputName(name, false, 24);
    const fixed = makeOptimizeOutputName(name, true, 24);
    assert.ok(fixed.toLowerCase().endsWith('_f_o'), fixed);
    assert.notEqual(fixed.toLowerCase(), name.toLowerCase());
    assert.notEqual(fixed.toLowerCase(), plain.toLowerCase());
    assert.ok(fixed.length <= 24);
  }
});

test('search parser: numeric "scen:" and "size:", Polish flag with diacritics', () => {
  assert.deepEqual(parseSearchQuery('scen:300').terms[0], { kind: 'num', field: 'props', op: '=', value: 300, negate: false });
  assert.deepEqual(parseSearchQuery('scen:tree').terms[0], { kind: 'field', field: 'scenery', value: 'tree', negate: false });
  assert.deepEqual(parseSearchQuery('is:domyślne').terms[0], { kind: 'flag', flag: 'vanilla', negate: false });
});

// ---------------- archives ----------------

function zipFile(build: (zip: AdmZip) => void): string {
  const zip = new AdmZip();
  build(zip);
  const file = path.join(tempDir('sms-review-zip-'), 'pack.zip');
  zip.writeZip(file);
  return file;
}

test('archives with unsupported compression are refused before anything is written', () => {
  const archive = zipFile((zip) => {
    zip.addFile('maps/a.pms', Buffer.from('aaaa'));
    const lzma = zip.addFile('maps/b.pms', Buffer.from('bbbb'));
    lzma.header.method = 14; // LZMA (7-Zip)
  });
  const dest = path.join(tempDir('sms-review-x-'), 'out');
  assert.throws(() => extractZipSafely(archive, dest), ZipSafetyError);
  assert.equal(fs.existsSync(dest), false);
});

test('a corrupted entry leaves the destination untouched (decompression happens in a staging folder)', () => {
  const marker = 'SECOND-ENTRY-PAYLOAD-0123456789';
  const archive = zipFile((zip) => {
    const a = zip.addFile('maps/first.pms', Buffer.from('first-entry'));
    a.header.method = 0;
    const b = zip.addFile('maps/second.pms', Buffer.from(marker));
    b.header.method = 0;
  });
  const bytes = fs.readFileSync(archive);
  const at = bytes.indexOf(marker);
  assert.ok(at > 0);
  bytes[at + 3] ^= 0xff; // flip one byte of the stored data -> CRC mismatch
  fs.writeFileSync(archive, bytes);

  const dest = path.join(tempDir('sms-review-crc-'), 'out');
  assert.throws(() => extractZipSafely(archive, dest));
  assert.equal(fs.existsSync(path.join(dest, 'maps', 'first.pms')), false);
  assert.deepEqual(fs.existsSync(dest) ? fs.readdirSync(dest) : [], [], 'no staging folder is left behind');
});

test('extreme compression ratios are treated as a zip bomb', () => {
  const archive = zipFile((zip) => zip.addFile('maps/zeros.pms', Buffer.alloc(200_000)));
  const dest = path.join(tempDir('sms-review-bomb-'), 'out');
  assert.throws(
    () => extractZipSafely(archive, dest, { ...ZIP_LIMITS, maxCompressionRatio: 5, ratioFloorBytes: 0 }),
    ZipSafetyError
  );
  assert.equal(extractZipSafely(archive, dest).files, 1);
});

// ---------------- packs ----------------

test('CRC manifest lists only the map file that was really packed when names collide', async () => {
  const other = tempDir('sms-review-other-');
  fs.writeFileSync(path.join(other, 'ctf_same.pms'), buildSyntheticPms({ props: 3, title: 'Other' }));
  const env = await scannerWith({ ctf_same: buildSyntheticPms({ props: 1, title: 'Main' }) }, { dir: other, label: 'Inne' });
  const result = await executePackBuild(
    {
      packName: 'Kolizja',
      mapIds: ['ctf_same', 'arch:ctf_same'],
      outputFormat: 'zip',
      splitBy: 'none',
      excludeVanillaAssets: true,
      excludeUnusedScenery: true,
      includePngOverrides: true,
      includeEdgeTextures: true,
      fixLinuxCase: true,
      generateMapsListTxt: false,
      generateReadmeManifest: false,
      generateCrcManifest: true,
    },
    env.scanner,
    path.join(env.base, 'exports')
  );
  const zip = new AdmZip(result.outputPath);
  const manifestLines = zip
    .readAsText('maps_crc32_Kolizja.txt')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'));
  assert.equal(manifestLines.length, 1, manifestLines.join(' | '));
  const packedBytes = zip.getEntry('maps/ctf_same.pms')!.getData();
  assert.ok(manifestLines[0].includes(`;${packedBytes.length};maps/ctf_same.pms`));
});

// ---------------- logger, stores, tags ----------------

test('log lines are on disk immediately (a crash right after logging keeps the message)', () => {
  const dir = tempDir('sms-review-log-');
  installFileLogger(dir);
  console.warn('marker-line-for-sync-log-test');
  const [file] = fs.readdirSync(dir);
  assert.ok(fs.readFileSync(path.join(dir, file), 'utf-8').includes('marker-line-for-sync-log-test'));
});

test('stores accept a UTF-8 BOM and keep a damaged file instead of overwriting it', () => {
  const dir = tempDir('sms-review-store-');
  const bomFile = path.join(dir, 'user-data.json');
  fs.writeFileSync(bomFile, '﻿' + JSON.stringify({ version: 1, maps: { m1: { favorite: true } } }), 'utf-8');
  assert.equal(new UserDataStore(bomFile).get('m1')?.favorite, true);

  const broken = path.join(dir, 'pack-presets.json');
  fs.writeFileSync(broken, '{"presets": [ {"name": "Serwer"', 'utf-8');
  const store = new PackPresetStore(broken);
  assert.deepEqual(store.list(), []);
  store.save('Nowy', {});
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('pack-presets.json.broken-'));
  assert.equal(kept.length, 1, 'the unreadable original is preserved');
  assert.ok(fs.readFileSync(path.join(dir, kept[0]), 'utf-8').includes('Serwer'));
});

test('tag add / remove operations never overwrite each other', () => {
  const store = new UserDataStore(path.join(tempDir('sms-review-tags-'), 'user-data.json'));
  store.update('m', { addTags: ['old'] });
  // Two quick edits built from the same stale view: add "turniej", remove "old"
  store.update('m', { addTags: ['turniej'] });
  store.update('m', { removeTags: ['old'] });
  assert.deepEqual(store.get('m')?.tags, ['turniej']);
  store.update('m', { addTags: ['Turniej'] }); // case-insensitive duplicate
  assert.deepEqual(store.get('m')?.tags, ['turniej']);
});

test('compare menu family: plain versions, shortened long names, and no false matches', () => {
  assert.ok(isSameMapFamily('ctf_cs_office2', 'ctf_cs_office2_o'));
  assert.ok(isSameMapFamily('ctf_cs_office2_o', 'ctf_cs_office2_f'));
  // 24-char limit: the derived names keep only the beginning of the original name
  assert.ok(isSameMapFamily('ctf_Laos_Remake_Final_v2', 'ctf_Laos_Remake_Final_f'));
  assert.ok(isSameMapFamily('ctf_Laos_Remake_Final_o', 'ctf_Laos_Remake_Final_v2'));
  assert.ok(isSameMapFamily('ctf_Laos_Remake_Final_v2', 'ctf_Laos_Remake_Fina_f_o'));
  // Different maps that merely share a prefix
  assert.equal(isSameMapFamily('ctf_cs_office', 'ctf_cs_office2'), false);
  assert.equal(isSameMapFamily('ctf_cs_office2', 'ctf_cs_office_f'), false);
  assert.equal(isSameMapFamily('ctf_cs_office2', 'ctf_cs_office2'), false);
});
