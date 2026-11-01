import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { OptimizeMapOptions } from '../src/shared/apiTypes';
import { makeOptimizeOutputName } from '../src/shared/pmsParser';
import { parseSearchQuery } from '../src/shared/searchQuery';
import {
  computeUnusedScenery,
  LibraryError,
  listDuplicateGroups,
  moveDuplicateMaps,
  moveUnusedScenery,
} from '../src/server/libraryTools';
import { SoldatMapWorkshop } from '../src/server/mapFixerOptimizer';
import { generateCrcManifestContent } from '../src/server/packBuilder';
import { PackPresetStore } from '../src/server/packPresets';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { normalizeTags, UserDataStore } from '../src/server/userDataStore';
import { buildSyntheticPms } from './helpers';

function makeEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-features-'));
  const root = path.join(base, 'Soldat');
  for (const dir of ['maps', 'scenery-gfx', 'textures']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const cache = path.join(base, 'cache');
  const thumbs = path.join(cache, 'thumbnails');
  fs.mkdirSync(thumbs, { recursive: true });
  const writeMap = (name: string, bytes: Uint8Array, dir = path.join(root, 'maps')) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.pms`), bytes);
  };
  return { base, root, cache, thumbs, writeMap };
}

const OPT: OptimizeMapOptions = {
  mergeBack: true,
  mergeMid: true,
  mergeFront: true,
  supersample: 2,
  maxTilePx: 2048,
  preserveGiantProps: true,
  giantPropThresholdPx: 1600,
  skipIsolatedSingleProps: false,
  removeUnusedScenery: true,
  preferClassicBmp: false,
  maxBaseLength: 24,
  destination: 'exports_optimized',
};

// ------------------------------------------------------------------------------------------------
// C4: search syntax
// ------------------------------------------------------------------------------------------------

test('search syntax: comparisons, fields, flags, weather, negation and quoting', () => {
  const q = parseSearchQuery('ctf_cs props>300 tex:ananas title:"cs office" -is:dup pogoda:snieg polys<=1000 props:12');
  assert.equal(q.structured, true);
  assert.deepEqual(q.terms, [
    { kind: 'text', value: 'ctf_cs', negate: false },
    { kind: 'num', field: 'props', op: '>', value: 300, negate: false },
    { kind: 'field', field: 'tex', value: 'ananas', negate: false },
    { kind: 'field', field: 'title', value: 'cs office', negate: false },
    { kind: 'flag', flag: 'dup', negate: true },
    { kind: 'weather', value: 3, negate: false },
    { kind: 'num', field: 'polys', op: '<=', value: 1000, negate: false },
    { kind: 'num', field: 'props', op: '=', value: 12, negate: false },
  ]);
});

test('search syntax: "scen" is a scenery name with ":" and a prop count with a comparison', () => {
  assert.deepEqual(parseSearchQuery('scen:tree').terms[0], { kind: 'field', field: 'scenery', value: 'tree', negate: false });
  assert.deepEqual(parseSearchQuery('scen>10').terms[0], { kind: 'num', field: 'props', op: '>', value: 10, negate: false });
});

test('search syntax: unknown keys and invalid values stay plain words', () => {
  const q = parseSearchQuery('foo:bar props>abc is:nonsense');
  assert.equal(q.structured, false);
  assert.deepEqual(
    q.terms.map((t) => (t.kind === 'text' ? t.value : t.kind)),
    ['foo:bar', 'props>abc', 'is:nonsense']
  );
  assert.deepEqual(parseSearchQuery('-').terms, [{ kind: 'text', value: '-', negate: false }]);
});

// ------------------------------------------------------------------------------------------------
// C4 + C5: filtering in the scanner, favourites and tags
// ------------------------------------------------------------------------------------------------

test('scanner filters with the search syntax, favourites and user tags', async () => {
  const env = makeEnv();
  env.writeMap('ctf_alpha', buildSyntheticPms({ props: 5, title: 'Alpha' }));
  env.writeMap('ctf_beta', buildSyntheticPms({ props: 1, title: 'Beta' }));
  env.writeMap('inf_gamma', buildSyntheticPms({ props: 3, title: 'Gamma', scenery: ['tree.png'] }));
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  const store = new UserDataStore(path.join(env.base, 'user-data.json'));
  scanner.setUserDataStore(store);
  await scanner.scanAsync(true);

  const ids = (searchQuery: string, statusFilter?: 'favorites') =>
    scanner.queryMatchingIds({ searchQuery, statusFilter }).sort();

  assert.deepEqual(ids('props>2'), ['ctf_alpha', 'inf_gamma']);
  assert.deepEqual(ids('prefix:ctf_'), ['ctf_alpha', 'ctf_beta']);
  assert.deepEqual(ids('prefix:ctf_ -name:beta'), ['ctf_alpha']);
  assert.deepEqual(ids('scen:tree'), ['inf_gamma']);
  assert.deepEqual(ids('tex:default'), ['ctf_alpha', 'ctf_beta', 'inf_gamma']);
  assert.deepEqual(ids('title:gam'), ['inf_gamma']);

  store.update('ctf_beta', { favorite: true });
  store.update('inf_gamma', { tags: ['Turniej', ' turniej ', 'do testu'] });
  assert.deepEqual(ids('is:fav'), ['ctf_beta']);
  assert.deepEqual(ids('', 'favorites'), ['ctf_beta']);
  assert.deepEqual(ids('tag:turniej'), ['inf_gamma']);
  assert.deepEqual(ids('tag:"do testu"'), ['inf_gamma']);

  const page = scanner.queryMaps({ searchQuery: 'beta' });
  assert.equal(page.items[0].favorite, true);
  const summary = scanner.getUserDataSummary();
  assert.equal(summary.favoriteMapsCount, 1);
  assert.deepEqual(summary.userTags, [
    { tag: 'do testu', count: 1 },
    { tag: 'Turniej', count: 1 },
  ]);
  assert.deepEqual(scanner.getMapEntryWithUserData('inf_gamma')?.tags, ['Turniej', 'do testu']);
});

test('user data store normalizes tags, drops empty entries and survives a reload', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sms-userdata-')), 'user-data.json');
  assert.deepEqual(normalizeTags(['  A  b ', 'a B', '', 42, 'x"y']), ['A b', 'x y']);
  const store = new UserDataStore(file);
  store.update('m1', { favorite: true, tags: ['one'] });
  store.update('m2', { tags: ['two'] });
  store.update('m2', { tags: [] }); // nothing left -> entry removed
  const reloaded = new UserDataStore(file);
  assert.deepEqual(reloaded.get('m1'), { favorite: true, tags: ['one'] });
  assert.equal(reloaded.get('m2'), undefined);
});

// ------------------------------------------------------------------------------------------------
// D1 / D2: pack presets and CRC manifest
// ------------------------------------------------------------------------------------------------

test('pack presets keep only valid options and persist', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sms-presets-')), 'pack-presets.json');
  const store = new PackPresetStore(file);
  store.save('  Serwer   CTF ', { packName: 'CTF', outputFormat: 'smap', splitBy: 'bogus', bogus: 1 });
  const [preset] = new PackPresetStore(file).list();
  assert.equal(preset.name, 'Serwer CTF');
  assert.equal(preset.options.outputFormat, 'smap');
  assert.equal(preset.options.splitBy, 'none');
  assert.equal(preset.options.generateCrcManifest, true);
  assert.equal((preset.options as unknown as Record<string, unknown>).bogus, undefined);
  assert.throws(() => store.save('   ', {}));
  assert.deepEqual(store.remove('serwer ctf'), []);
});

test('CRC32 manifest lists every map with its OpenSoldat checksum and size', async () => {
  const env = makeEnv();
  env.writeMap('ctf_alpha', buildSyntheticPms({ props: 2 }));
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const entry = scanner.getMapEntry('ctf_alpha')!;
  const text = generateCrcManifestContent('Test', [entry]);
  const crc = (entry.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0');
  assert.ok(text.includes(`ctf_alpha;${crc};${entry.fileSize};maps/ctf_alpha.pms`));
});

// ------------------------------------------------------------------------------------------------
// A5: fix 1.7.1 sizes first, then optimize
// ------------------------------------------------------------------------------------------------

test('fixFirst applies the recommended 1.7.1 fixes and names the result _f_o only when something changed', async () => {
  const env = makeEnv();
  // Custom scenery is 37x20 on disk, the props store a stretched power-of-two 32x16 -> recommended fix
  fs.writeFileSync(
    path.join(env.root, 'scenery-gfx', 'a.png'),
    await sharp({ create: { width: 37, height: 20, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer()
  );
  env.writeMap('ctf_fix', buildSyntheticPms({ props: 4, scenery: ['a.png'] }));
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(scanner, path.join(env.base, 'exports'), env.cache, path.join(env.base, 'backups'));

  const plain = await workshop.planSceneryOptimization('ctf_fix', OPT);
  assert.equal(plain.derivedBaseName, 'ctf_fix_o');
  assert.deepEqual(plain.appliedPropFixes, []);

  const fixed = await workshop.planSceneryOptimization('ctf_fix', { ...OPT, fixFirst: true });
  assert.equal(fixed.derivedBaseName, 'ctf_fix_f_o');
  assert.equal(fixed.appliedPropFixes.length, 4);
  assert.deepEqual(fixed.appliedPropFixes[0], { propIndex: 0, width: 37, height: 20 });
  assert.equal((await workshop.checkOptimizeTarget('ctf_fix', { ...OPT, fixFirst: true })).derivedBaseName, 'ctf_fix_f_o');

  assert.equal(makeOptimizeOutputName('ctf_cs_office2', false, 24), 'ctf_cs_office2_o');
  assert.equal(makeOptimizeOutputName('ctf_cs_office2', true, 24), 'ctf_cs_office2_f_o');
});

// ------------------------------------------------------------------------------------------------
// C2 / C3: library tidy-up
// ------------------------------------------------------------------------------------------------

test('duplicate groups: keeper suggestion, last-copy protection and move to backup', async () => {
  const env = makeEnv();
  const archive = path.join(env.base, 'archive');
  const dupBytes = buildSyntheticPms({ props: 2, title: 'Duplicate' });
  env.writeMap('ctf_dup', dupBytes);
  env.writeMap('ctf_dup', dupBytes, archive);
  const pairBytes = buildSyntheticPms({ props: 3, title: 'Pair' });
  env.writeMap('ctf_one', pairBytes);
  env.writeMap('ctf_two', pairBytes);
  const scanner = new SoldatMapScanner(
    env.root,
    [{ id: 'arch', path: archive, label: 'Archiwum', recursive: true, enabled: true }],
    [],
    env.cache,
    env.thumbs
  );
  await scanner.scanAsync(true);

  const { groups, totalRemovable } = listDuplicateGroups(scanner);
  assert.equal(groups.length, 2);
  assert.equal(totalRemovable, 2);
  const same = groups.find((g) => g.sameName)!;
  assert.equal(same.suggestedKeepId, 'ctf_dup', 'the copy in the game folder is kept by default');
  assert.equal(groups.find((g) => !g.sameName)!.files.length, 2);

  const backups = path.join(env.base, 'backups');
  await assert.rejects(moveDuplicateMaps(scanner, ['ctf_one', 'ctf_two'], backups), LibraryError);
  await assert.rejects(moveDuplicateMaps(scanner, ['nope'], backups), LibraryError);

  const result = await moveDuplicateMaps(scanner, ['arch:ctf_dup'], backups);
  assert.equal(result.moved, 1);
  assert.equal(fs.existsSync(path.join(archive, 'ctf_dup.pms')), false);
  assert.ok(fs.existsSync(path.join(result.backupDir!, 'Archiwum', 'ctf_dup.pms')));
  assert.ok(fs.readFileSync(path.join(result.backupDir!, 'PRZYWRACANIE.txt'), 'utf-8').includes('ctf_dup.pms'));
});

test('unused scenery report skips used (also .bmp/.png variants) and default game files', async () => {
  const env = makeEnv();
  fs.writeFileSync(path.join(env.root, 'readonly.txt'), 'scenery-gfx/vanilla.png\r\n');
  for (const name of ['a.png', 'tree.png', 'orphan.png', 'vanilla.png', 'notes.txt']) {
    fs.writeFileSync(path.join(env.root, 'scenery-gfx', name), Buffer.alloc(name === 'orphan.png' ? 300 : 10));
  }
  env.writeMap('ctf_used', buildSyntheticPms({ props: 2, scenery: ['a.png', 'tree.bmp'] }));
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);

  const report = computeUnusedScenery(scanner);
  assert.equal(report.totalFiles, 4);
  assert.equal(report.usedFiles, 2);
  assert.equal(report.vanillaSkipped, 1);
  assert.deepEqual(report.items.map((i) => i.name), ['orphan.png']);
  assert.equal(report.unusedBytes, 300);

  const result = await moveUnusedScenery(scanner, ['orphan.png', 'a.png'], path.join(env.base, 'backups'));
  assert.equal(result.moved, 1);
  assert.equal(result.failed.length, 1, 'a file that is in use is never moved');
  assert.equal(fs.existsSync(path.join(env.root, 'scenery-gfx', 'orphan.png')), false);
  assert.ok(fs.existsSync(path.join(result.backupDir!, 'orphan.png')));
});
