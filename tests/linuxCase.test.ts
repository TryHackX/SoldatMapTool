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
  const restore = fs.readFileSync(path.join(result.backupDir!, 'PRZYWRACANIE.txt'), 'utf-8');
  assert.ok(restore.includes(`${path.join(env.root, 'scenery-gfx', 'rock.png')}\t`));

  await env.scanner.scanAsync(true);
  assert.deepEqual(
    computeCaseMismatches(env.scanner).files.map((f) => f.diskName),
    ['palm.png']
  );
});
