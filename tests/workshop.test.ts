import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { SoldatMapWorkshop, WorkshopError } from '../src/server/mapFixerOptimizer';
import { parsePmsFull } from '../src/shared/pmsParser';
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

test('archive (_a): the map gets its own copies of the sceneries it still uses and of its texture', async () => {
  const env = makeTempEnv({
    // prop 0 (back) is baked, prop 1 (middle) and prop 2 (front) stay single props; unused.png is not used at all
    ctf_arch: buildSyntheticPms({ props: 3, scenery: ['tree.bmp', 'rock.bmp', 'ghost.png', 'unused.png'] }),
  });
  const write = (rel: string, bytes: Buffer) => {
    fs.mkdirSync(path.dirname(path.join(env.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(env.root, rel), bytes);
  };
  const rockPng = await sharp({ create: { width: 6, height: 4, channels: 4, background: { r: 90, g: 60, b: 30, alpha: 1 } } })
    .png()
    .toBuffer();
  write('scenery-gfx/tree.png', rockPng);
  write('scenery-gfx/rock.png', rockPng); // the map asks for rock.bmp: the game loads the HD .png override
  write('scenery-gfx/unused.png', rockPng);
  write('textures/default.bmp', Buffer.from('BM fake texture bytes'));
  write('textures/edges/default.png', Buffer.from('fake edge bytes'));

  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(scanner, path.join(env.base, 'exports'), env.cache, path.join(env.base, 'backups'));
  const options = {
    mergeBack: true,
    mergeMid: false,
    mergeFront: false,
    supersample: 2 as const,
    maxTilePx: 2048 as const,
    preserveGiantProps: false,
    giantPropThresholdPx: 1600,
    skipIsolatedSingleProps: false,
    removeUnusedScenery: false, // the archive removes unused entries anyway
    preferClassicBmp: false,
    maxBaseLength: 24,
    destination: 'exports_optimized' as const,
    archive: true,
  };

  const plan = await workshop.planSceneryOptimization('ctf_arch', options);
  assert.equal(plan.derivedBaseName, 'ctf_arch_a');
  assert.equal(plan.groups.length, 1);
  const grp = plan.groups[0];
  const sessionId = workshop.startOptimizeSession('ctf_arch', options);
  await workshop.addOptimizeTile(
    sessionId,
    {
      tileFileName: 'ctf_arch_a_b1.png',
      level: 0,
      insertOrderKey: grp.insertOrderKey,
      worldX: grp.worldBounds.left,
      worldY: grp.worldBounds.top,
      scaleX: 0.5,
      scaleY: 0.5,
    },
    rockPng
  );
  const result = await workshop.commitOptimizeSession(sessionId, 'never', true);

  const outDir = path.join(env.base, 'exports', 'archived_maps');
  assert.equal(result.outputMapPath, path.join(outDir, 'maps', 'ctf_arch_a.pms'));
  const out = parsePmsFull(fs.readFileSync(result.outputMapPath));
  assert.deepEqual(
    out.scenery.map((s) => s.filename),
    ['ctf_arch_a_s1.png', 'ghost.png', 'ctf_arch_a_b1.png'],
    'baked and unused sceneries are gone, the kept one is renamed, a missing file keeps its name'
  );
  assert.deepEqual(fs.readdirSync(path.join(outDir, 'scenery-gfx')).sort(), ['ctf_arch_a_b1.png', 'ctf_arch_a_s1.png']);
  assert.deepEqual(fs.readFileSync(path.join(outDir, 'scenery-gfx', 'ctf_arch_a_s1.png')), rockPng, 'byte-for-byte copy');
  assert.equal(out.texture, 'ctf_arch_a.bmp');
  assert.equal(fs.readFileSync(path.join(outDir, 'textures', 'ctf_arch_a.bmp'), 'utf-8'), 'BM fake texture bytes');
  assert.equal(fs.readFileSync(path.join(outDir, 'textures', 'edges', 'ctf_arch_a.png'), 'utf-8'), 'fake edge bytes');
  assert.deepEqual(result.archive, {
    copiedFiles: 1,
    copiedBytes: rockPng.byteLength,
    texture: 'ctf_arch_a.bmp',
    textureEdge: true,
    missing: ['ghost.png'],
  });
  assert.ok(fs.existsSync(path.join(env.root, 'scenery-gfx', 'rock.png')), 'the shared originals stay untouched');
});
