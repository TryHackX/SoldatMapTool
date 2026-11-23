import { diskPathKey } from '../src/server/diskPath';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { PackBuildOptions } from '../src/shared/apiTypes';
import { computeCaseMismatches, renameCaseMismatches } from '../src/server/libraryTools';
import { executePackBuild } from '../src/server/packBuilder';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { buildSyntheticPms } from './helpers';

test('physical map identities distinguish case on Linux and fold it on Windows', () => {
  assert.notEqual(diskPathKey('maps/Arena.pms', 'linux'), diskPathKey('maps/arena.pms', 'linux'));
  assert.equal(diskPathKey('maps/Arena.pms', 'win32'), diskPathKey('maps/arena.pms', 'win32'));
});

/** Soldat folder with the given maps and scenery files (scanned) */
async function soldatWith(maps: Record<string, string[]>, sceneryFiles: string[]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-case-test-'));
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scenery-gfx'), { recursive: true });
  for (const [name, scenery] of Object.entries(maps)) {
    fs.writeFileSync(path.join(root, 'maps', `${name}.pms`), buildSyntheticPms({ props: scenery.length, scenery }));
  }
  for (const file of sceneryFiles) fs.writeFileSync(path.join(root, 'scenery-gfx', file), Buffer.from(file));
  const cache = path.join(base, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const scanner = new SoldatMapScanner(root, [], [], cache, path.join(cache, 'thumbnails'));
  await scanner.scanAsync(true);
  return { base, root, scanner };
}

const packOptions = (mapIds: string[], fixLinuxCase: boolean): PackBuildOptions => ({
  packName: 'Linux',
  mapIds,
  outputFormat: 'zip',
  splitBy: 'none',
  excludeVanillaAssets: true,
  excludeUnusedScenery: true,
  includePngOverrides: true,
  includeEdgeTextures: true,
  fixLinuxCase,
  generateMapsListTxt: false,
  generateReadmeManifest: false,
  generateCrcManifest: false,
});

test('Linux fix packs a scenery file under every spelling the maps use', async () => {
  const env = await soldatWith({ ctf_one: ['Palm.png'], ctf_two: ['palm.png'], ctf_three: ['PALM.png'] }, ['palm.png']);
  const ids = ['ctf_one', 'ctf_two', 'ctf_three'];

  const fixed = await executePackBuild(packOptions(ids, true), env.scanner, path.join(env.base, 'exports'));
  const names = new AdmZip(fixed.outputPath)
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => n.startsWith('scenery-gfx/'))
    .sort();
  assert.deepEqual(names, ['scenery-gfx/PALM.png', 'scenery-gfx/Palm.png', 'scenery-gfx/palm.png']);

  // Without the fix the disk name is packed once, as before
  const plain = await executePackBuild(packOptions(ids, false), env.scanner, path.join(env.base, 'exports-plain'));
  const plainNames = new AdmZip(plain.outputPath)
    .getEntries()
    .map((e) => e.entryName)
    .filter((n) => n.startsWith('scenery-gfx/'));
  assert.deepEqual(plainNames, ['scenery-gfx/palm.png']);
});

test('case report: a file every map spells one way is renamed, one spelled several ways is left to packs', async () => {
  const env = await soldatWith(
    { ctf_a: ['Rock.png', 'Palm.png', 'tree.png'], ctf_b: ['Rock.png', 'palm.png'] },
    ['rock.png', 'palm.png', 'tree.png']
  );
  const report = computeCaseMismatches(env.scanner);
  assert.equal(report.affectedMaps, 2);
  assert.deepEqual(
    report.files.map((f) => [f.diskName, f.renameTo, f.spellings.map((s) => `${s.name}:${s.mapCount}`)]),
    [
      ['rock.png', 'Rock.png', ['Rock.png:2']],
      ['palm.png', null, ['palm.png:1', 'Palm.png:1']],
    ]
  );

  const backups = path.join(env.base, 'backups');
  const result = await renameCaseMismatches(
    env.scanner,
    [
      { category: 'scenery-gfx', diskName: 'rock.png' },
      { category: 'scenery-gfx', diskName: 'palm.png' },
    ],
    backups
  );
  assert.equal(result.moved, 1);
  assert.deepEqual(result.failed.map((f) => f.name), ['palm.png']);
  const names = fs.readdirSync(path.join(env.root, 'scenery-gfx'));
  assert.ok(names.includes('Rock.png') && !names.includes('rock.png'), names.join(', '));
  assert.equal(fs.readFileSync(path.join(env.root, 'scenery-gfx', 'Rock.png'), 'utf-8'), 'rock.png', 'content kept');
  const restore = fs.readFileSync(path.join(result.backupDir!, 'RESTORE.txt'), 'utf-8');
  assert.ok(restore.includes(`${path.join(env.root, 'scenery-gfx', 'rock.png')}\t`));

  await env.scanner.scanAsync(true);
  assert.deepEqual(
    computeCaseMismatches(env.scanner).files.map((f) => f.diskName),
    ['palm.png']
  );
});

test('Linux zip keeps two spellings from a single map for both the classic and HD file', async t=>{
  const env=await soldatWith({ctf_palms:['Palm.bmp','palm.bmp']},['palm.bmp','PALM.png']);
  t.after(()=>{env.scanner['sqliteCache'].close();fs.rmSync(env.base,{recursive:true,force:true});});
  const pack=await executePackBuild(packOptions(['ctf_palms'],true),env.scanner,path.join(env.base,'exports'));
  const files=new AdmZip(pack.outputPath).getEntries().map(f=>f.entryName).filter(n=>n.startsWith('scenery-gfx/')).sort();
  assert.deepEqual(files,['scenery-gfx/Palm.bmp','scenery-gfx/Palm.png','scenery-gfx/palm.bmp','scenery-gfx/palm.png']);
  const outRoot=path.join(env.base,'nested','exports');
  const folder=await executePackBuild({...packOptions(['ctf_palms'],false),outputFormat:'folder',packName:'..'},env.scanner,outRoot);
  assert.equal(path.dirname(folder.outputPath),outRoot,'pack name must resolve to a child of the selected output folder');
  const second=await executePackBuild({...packOptions(['ctf_palms'],false),outputFormat:'folder',packName:'...zip'},env.scanner,outRoot);
  assert.equal(path.dirname(second.outputPath),outRoot);
  assert.notEqual(second.outputPath,folder.outputPath,'a repeated export must not inherit stale files');
});
