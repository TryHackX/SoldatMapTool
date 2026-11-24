import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { buildSyntheticPms } from './helpers';

function makeTempSoldat(mapNames: string[]): { root: string; cache: string; thumbs: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-scan-test-'));
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  for (const name of mapNames) {
    fs.writeFileSync(path.join(root, 'maps', `${name}.pms`), buildSyntheticPms({ props: 2, title: name }));
  }
  const cache = path.join(base, 'cache');
  const thumbs = path.join(cache, 'thumbnails');
  fs.mkdirSync(thumbs, { recursive: true });
  return { root, cache, thumbs };
}

test('rescans keep working on small collections (no stuck scan promise)', async () => {
  const env = makeTempSoldat(['ctf_a', 'ctf_b']);
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  const first = await scanner.scanAsync(true);
  assert.equal(first.totalMaps, 2);

  fs.writeFileSync(path.join(env.root, 'maps', 'ctf_c.pms'), buildSyntheticPms({ props: 1 }));
  const second = await scanner.scanAsync(false);
  assert.equal(second.totalMaps, 3, 'a later scan must see files written after the previous scan');
  assert.ok(scanner.getMapEntry('ctf_c'));
});

test('a scan requested while another runs is queued and sees the newly written map', async () => {
  const names = Array.from({ length: 650 }, (_, i) => `map_${i}`); // > CHUNK_SIZE so the scan really yields
  const env = makeTempSoldat(names);
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);

  const running = scanner.scanAsync(true);
  // Simulate the workshop writing a derived map while the initial scan is still in progress
  fs.writeFileSync(path.join(env.root, 'maps', 'ctf_new_o.pms'), buildSyntheticPms({ props: 1 }));
  const queued = scanner.scanAsync(true);

  const [a, b] = await Promise.all([running, queued]);
  assert.ok(a.totalMaps >= 650);
  assert.equal(b.totalMaps, 651);
  assert.ok(scanner.getMapEntry('ctf_new_o'), 'queued scan must index the map written during the first scan');
});

test('summaries of deleted maps are pruned from the cache', async () => {
  const env = makeTempSoldat(['ctf_keep', 'ctf_gone']);
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  fs.rmSync(path.join(env.root, 'maps', 'ctf_gone.pms'));
  const meta = await scanner.scanAsync(true);
  assert.equal(meta.totalMaps, 1);
  assert.equal(scanner.getMapEntry('ctf_gone'), null);
});

test('sidebar selections on different levels add up instead of excluding each other', async () => {
  const env = makeTempSoldat(['ctf_cs_alpha', 'tw_bravo', 'kz_charlie']);
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);

  // RSCS group (Ctrl+click) + the tw_ prefix of another group: used to match nothing (AND)
  const ids = scanner.queryMatchingIds({ modeGroupIds: ['rscs'], prefixes: ['tw_'] }).sort();
  assert.deepEqual(ids, ['ctf_cs_alpha', 'tw_bravo']);
  assert.deepEqual(scanner.queryMatchingIds({ prefixes: ['kz_'] }), ['kz_charlie']);
});

test('built-in prefix edits update the sidebar, search and startup classification and can be reset', async () => {
  const env = makeTempSoldat(['awp_demo','ka_arena','ctf_cs_alpha','Arena']);
  const rules = [{id:'clan',name:'Clan',prefixes:['zz_'],priority:15,enabled:true,badgeColor:'#334455'}];
  const scanner = new SoldatMapScanner(env.root, [], rules, env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const changes = {awp_:null,ka_:'weapon_arena',ctf_cs_:null,__none__:null};
  const meta = scanner.updateCustomRules(rules,changes);
  assert.deepEqual(meta.builtinPrefixOverrides,changes);
  assert.deepEqual(scanner.queryMatchingIds({modeGroupIds:['rscs']}),[]);
  assert.deepEqual(scanner.queryMatchingIds({modeGroupIds:['weapon_arena']}),['ka_arena']);
  assert.equal(scanner.getMapEntry('ctf_cs_alpha')?.prefix,'ctf_');
  assert.equal(scanner.getMapEntry('awp_demo')?.modeGroupId,'other');
  assert.equal(scanner.getMapEntry('Arena')?.modeGroupId,'other');
  assert.equal(meta.prefixes.find(p=>p.prefix==='ka_')?.modeGroupId,'weapon_arena');
  const restarted = new SoldatMapScanner(env.root, [], rules, env.cache, env.thumbs,changes);
  await restarted.scanAsync(true);
  assert.equal(restarted.getMapEntry('ka_arena')?.modeGroupId,'weapon_arena');
  const reset = restarted.updateCustomRules(rules,{});
  assert.deepEqual(reset.customRules,rules);
  assert.equal(restarted.queryMatchingIds({modeGroupIds:['rscs']}).length,3);
  assert.equal(restarted.getMapEntry('Arena')?.modeGroupId,'dm');
});
