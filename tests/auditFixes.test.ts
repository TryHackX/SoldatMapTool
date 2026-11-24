import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { decodeBmpToRgba } from '../src/server/bmpDecoder';
import { SoldatMapEditorService } from '../src/server/editorService';
import { executePackBuild } from '../src/server/packBuilder';
import { GeneratedOutputRegistry } from '../src/server/safeFileWriter';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { buildSyntheticPms } from './helpers';

function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('a tiny BMP that claims a huge image is rejected before any pixel buffer is allocated', () => {
  const bmp = Buffer.alloc(60);
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10); // pixel data offset
  bmp.writeUInt32LE(40, 14); // BITMAPINFOHEADER
  bmp.writeInt32LE(32768, 18);
  bmp.writeInt32LE(32768, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  assert.throws(() => decodeBmpToRgba(bmp), /Invalid BMP dimensions/);
});

test('the prefab library is never rewritten from a file that could not be read', async () => {
  const scratch = tempDir('sms-prefab-store-');
  const root = path.join(scratch, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  const cache = path.join(scratch, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const scanner = new SoldatMapScanner(root, [], [], cache, path.join(cache, 'thumbnails'));
  const service = new SoldatMapEditorService(scanner, path.join(scratch, 'exports'), scratch, path.join(scratch, 'backups'),
    new GeneratedOutputRegistry(path.join(scratch, 'registry.json')));
  const prefab = (name: string) => ({
    name,
    bounds: { left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 },
    bundle: { polygons: [], props: [], spawns: [{ x: 1, y: 2, team: 1 }], colliders: [], waypoints: [] },
  }) as unknown as Parameters<SoldatMapEditorService['savePrefab']>[0];
  const store = path.join(scratch, 'editor-prefabs.json');

  // A read error (here: a folder in place of the file) must stop the save, not replace the library
  fs.mkdirSync(store);
  assert.throws(() => service.savePrefab(prefab('first')));
  assert.ok(fs.statSync(store).isDirectory());
  fs.rmdirSync(store);

  // Damaged JSON is kept aside, and saving starts a new library
  fs.writeFileSync(store, '{"not": "a list"');
  assert.deepEqual(service.listPrefabs(), []);
  assert.equal(fs.readdirSync(scratch).filter((f) => f.startsWith('editor-prefabs.json.broken-')).length, 1);
  service.savePrefab(prefab('second'));
  assert.deepEqual(service.listPrefabs().map((p) => p.name), ['second']);
});

test('the map list and README of a pack name each packed map file once', async () => {
  const base = tempDir('sms-pack-list-');
  const root = path.join(base, 'Soldat');
  const extra = path.join(base, 'Extra');
  for (const dir of [path.join(root, 'maps'), path.join(root, 'scenery-gfx'), extra]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'ctf_same.pms'), buildSyntheticPms({}));
  fs.writeFileSync(path.join(root, 'maps', 'ctf_other.pms'), buildSyntheticPms({}));
  fs.writeFileSync(path.join(extra, 'ctf_same.pms'), buildSyntheticPms({ colliders: 1 }));
  const cache = path.join(base, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const scanner = new SoldatMapScanner(root, [{ id: 'extra', path: extra, label: 'Extra', recursive: false, enabled: true }], [],
    cache, path.join(cache, 'thumbnails'));
  await scanner.scanAsync(true);
  const ids = scanner.getAllEntries().map((e) => e.id).sort();
  assert.equal(ids.length, 3);

  const result = await executePackBuild({
    packName: 'Duplicates', mapIds: ids, outputFormat: 'zip', splitBy: 'none', excludeVanillaAssets: true,
    excludeUnusedScenery: true, includePngOverrides: true, includeEdgeTextures: true, fixLinuxCase: false,
    generateMapsListTxt: true, generateReadmeManifest: true, generateCrcManifest: false,
  }, scanner, path.join(base, 'exports'));
  const zip = new AdmZip(result.outputPath);
  const list = zip.getEntries().find((e) => e.entryName.startsWith('mapslist'))!.getData().toString('utf8');
  assert.deepEqual(list.trim().split(/\r?\n/).sort(), ['ctf_other', 'ctf_same']);
  const readme = zip.getEntry('README_PACK.txt')!.getData().toString('utf8');
  const listed = readme.split(/\r?\n/).filter((line) => line.startsWith(' - ')).map((line) => line.slice(3).split('|')[0].trim());
  assert.deepEqual(listed.sort(), ['ctf_other', 'ctf_same']);
});
