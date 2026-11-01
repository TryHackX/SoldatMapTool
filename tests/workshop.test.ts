import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { SoldatMapWorkshop, WorkshopError } from '../src/server/mapFixerOptimizer';
import { buildSyntheticPms } from './helpers';

function makeTempEnv(maps: Record<string, Uint8Array | Buffer>) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-workshop-test-'));
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  for (const [name, bytes] of Object.entries(maps)) {
    fs.writeFileSync(path.join(root, 'maps', `${name}.pms`), bytes);
  }
  const cache = path.join(base, 'cache');
  const thumbs = path.join(cache, 'thumbnails');
  fs.mkdirSync(thumbs, { recursive: true });
  return { base, root, cache, thumbs };
}

const isConflict = (e: unknown) => e instanceof WorkshopError && e.status === 409;

test('unreadable .pms files stay in the index as incompatible entries', async () => {
  const env = makeTempEnv({
    ctf_ok: buildSyntheticPms({ props: 2 }),
    ctf_broken: Buffer.from('definitely not a soldat map'),
  });
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  const meta = await scanner.scanAsync(true);

  assert.equal(meta.totalMaps, 2, 'a broken file must not disappear from the index');
  assert.equal(meta.incompatibleMapsCount, 1);
  assert.equal(scanner.getScanStatus().failedFiles, 1);
  const broken = scanner.getMapEntry('ctf_broken');
  assert.ok(broken);
  assert.ok(broken.parseWarnings.some((w) => w.includes('Cannot read')));
  assert.equal(scanner.getMapEntry('ctf_ok')?.parseWarnings.length, 0);
});

test('overwrite policy: "own" replaces only an unchanged previous output of the same map, with a backup', async () => {
  const env = makeTempEnv({ ctf_policy: buildSyntheticPms({ props: 3, scenery: ['a.png', 'unused.png'] }) });
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(
    scanner,
    path.join(env.base, 'exports'),
    env.cache,
    path.join(env.base, 'backups')
  );
  const req = {
    mapId: 'ctf_policy',
    removeUnusedScenery: true,
    maxBaseLength: 24,
    destination: 'exports_fixed' as const,
  };

  const first = await workshop.fixMap171(req, true, 'never');
  assert.equal(first.derivedBaseName, 'ctf_policy_f');
  assert.ok(fs.existsSync(first.outputPath));
  assert.equal(first.backupDir, null, 'nothing was overwritten, so no backup folder');

  await assert.rejects(workshop.fixMap171(req, true, 'never'), isConflict);

  const second = await workshop.fixMap171(req, true, 'own');
  assert.ok(second.backupDir, 'replacing a file must back it up first');
  assert.ok(fs.existsSync(path.join(second.backupDir!, path.basename(second.outputPath))));

  // Someone edited the output: it is not an unchanged Studio file anymore and must never be replaced
  fs.appendFileSync(second.outputPath, Buffer.from([0]));
  await assert.rejects(workshop.fixMap171(req, true, 'own'), isConflict);

  // Explicit confirmation still works
  const third = await workshop.fixMap171(req, true, 'always');
  assert.ok(third.backupDir);
});

test('a derived map name never targets the source file itself', async () => {
  // A 28-char name shortened to fit 24 chars with "_f" must not collide with the source written next to it
  const env = makeTempEnv({ ctf_abcdefghijklmnopqrstuvwx: buildSyntheticPms({ props: 1 }) });
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(
    scanner,
    path.join(env.base, 'exports'),
    env.cache,
    path.join(env.base, 'backups')
  );
  const out = await workshop.fixMap171(
    { mapId: 'ctf_abcdefghijklmnopqrstuvwx', removeUnusedScenery: false, maxBaseLength: 24, destination: 'soldat_maps' },
    true,
    'never'
  );
  assert.notEqual(out.derivedBaseName.toLowerCase(), 'ctf_abcdefghijklmnopqrstuvwx');
  assert.ok(out.derivedBaseName.length <= 24);
  assert.ok(fs.existsSync(path.join(env.root, 'maps', 'ctf_abcdefghijklmnopqrstuvwx.pms')), 'source untouched');
});
