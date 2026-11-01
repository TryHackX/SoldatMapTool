import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { executePackBuild } from '../src/server/packBuilder';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { extractZipSafely, ZIP_LIMITS, ZipSafetyError } from '../src/server/zipSafety';
import { buildSyntheticPms } from './helpers';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeZip(build: (zip: AdmZip) => void): string {
  const zip = new AdmZip();
  build(zip);
  const file = path.join(tempDir('sms-zip-'), 'pack.zip');
  zip.writeZip(file);
  return file;
}

test('safe extraction writes regular files and skips symbolic links stored in the archive', () => {
  const archive = writeZip((zip) => {
    zip.addFile('maps/ctf_a.pms', Buffer.from(buildSyntheticPms({ props: 1 })));
    zip.addFile('scenery-gfx/tree.png', Buffer.from('png-bytes'));
    // addFile always stores a regular file; a crafted archive marks the entry as a unix symlink (0o120000)
    const link = zip.addFile('maps/link.pms', Buffer.from('C:/Windows/win.ini'));
    link.attr = (0o120777 << 16) >>> 0;
  });
  const dest = path.join(tempDir('sms-extract-'), 'out');
  const result = extractZipSafely(archive, dest);
  assert.equal(result.files, 2);
  assert.equal(result.skippedLinks, 1);
  assert.ok(fs.existsSync(path.join(dest, 'maps', 'ctf_a.pms')));
  assert.equal(fs.readFileSync(path.join(dest, 'scenery-gfx', 'tree.png'), 'utf-8'), 'png-bytes');
  assert.equal(fs.existsSync(path.join(dest, 'maps', 'link.pms')), false);
});

test('safe extraction refuses zip-slip paths before writing anything', () => {
  const archive = writeZip((zip) => {
    zip.addFile('maps/ok.pms', Buffer.from('ok'));
    const evil = zip.addFile('maps/evil.txt', Buffer.from('evil'));
    evil.entryName = '../../evil.txt';
  });
  const base = tempDir('sms-slip-');
  const dest = path.join(base, 'a', 'b');
  assert.throws(() => extractZipSafely(archive, dest), ZipSafetyError);
  assert.equal(fs.existsSync(path.join(dest, 'maps', 'ok.pms')), false, 'validation happens before any write');
  assert.equal(fs.existsSync(path.join(base, 'evil.txt')), false);
});

test('safe extraction enforces size limits from the archive headers', () => {
  const archive = writeZip((zip) => {
    zip.addFile('maps/big.pms', Buffer.alloc(2048, 1));
  });
  const dest = tempDir('sms-size-');
  assert.throws(() => extractZipSafely(archive, dest, { ...ZIP_LIMITS, maxEntryBytes: 1024 }), ZipSafetyError);
  assert.throws(() => extractZipSafely(archive, dest, { ...ZIP_LIMITS, maxTotalBytes: 1024 }), ZipSafetyError);
  assert.equal(extractZipSafely(archive, dest).files, 1);
});

test('safe extraction never writes through a link that already exists in the destination', (t) => {
  const base = tempDir('sms-junction-');
  const outside = path.join(base, 'outside');
  const dest = path.join(base, 'dest');
  fs.mkdirSync(outside);
  fs.mkdirSync(dest);
  try {
    // A junction needs no admin rights on Windows; on other systems it is a plain directory symlink
    fs.symlinkSync(outside, path.join(dest, 'maps'), 'junction');
  } catch {
    t.skip('cannot create a directory link in this environment');
    return;
  }
  const archive = writeZip((zip) => zip.addFile('maps/evil.pms', Buffer.from('evil')));
  assert.throws(() => extractZipSafely(archive, dest), ZipSafetyError);
  assert.equal(fs.existsSync(path.join(outside, 'evil.pms')), false);
});

test('ZIP pack build (archiver 8) contains the maps and every generated file', async () => {
  const base = tempDir('sms-pack-');
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'ctf_alpha.pms'), buildSyntheticPms({ props: 2, title: 'Alpha' }));
  fs.writeFileSync(path.join(root, 'maps', 'ctf_beta.pms'), buildSyntheticPms({ props: 1, title: 'Beta' }));
  const cache = path.join(base, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const scanner = new SoldatMapScanner(root, [], [], cache, path.join(cache, 'thumbnails'));
  await scanner.scanAsync(true);

  const result = await executePackBuild(
    {
      packName: 'Test Pack',
      mapIds: ['ctf_alpha', 'ctf_beta'],
      outputFormat: 'zip',
      splitBy: 'none',
      excludeVanillaAssets: true,
      excludeUnusedScenery: true,
      includePngOverrides: true,
      includeEdgeTextures: true,
      fixLinuxCase: true,
      generateMapsListTxt: true,
      generateReadmeManifest: true,
      generateCrcManifest: true,
    },
    scanner,
    path.join(base, 'exports')
  );
  assert.ok(fs.existsSync(result.outputPath));
  const names = new AdmZip(result.outputPath).getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(names, [
    'README_PACK.txt',
    'maps/ctf_alpha.pms',
    'maps/ctf_beta.pms',
    'maps_crc32_Test_Pack.txt',
    'mapslist_Test_Pack.txt',
  ]);
  const crc = new AdmZip(result.outputPath).readAsText('maps_crc32_Test_Pack.txt');
  assert.ok(crc.includes('ctf_alpha;') && crc.includes('ctf_beta;'));
});
