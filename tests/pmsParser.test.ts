import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  checkSoldatMapLimits,
  encodePascalShortString,
  makeDerivedMapName,
  parsePmsFull,
  parsePmsSummary,
  patchPmsPropsAndScenery,
  SOLDAT_MAP_LIMITS,
} from '../src/shared/pmsParser';
import { buildSyntheticPms, findSoldatMapsDir } from './helpers';

test('parsePmsFull and parsePmsSummary agree on a synthetic map', () => {
  const bytes = buildSyntheticPms({ props: 3, scenery: ['a.png', 'b.bmp'], colliders: 1, spawns: 2 });
  const full = parsePmsFull(bytes);
  const summary = parsePmsSummary(bytes);
  assert.equal(full.props.length, 3);
  assert.equal(summary.propCount, 3);
  assert.equal(full.scenery.length, 2);
  assert.equal(full.colliders.length, 1);
  assert.equal(full.spawnpoints.length, 2);
  assert.equal(summary.crc32, full.crc32);
  assert.deepEqual(full.parseWarnings, []);
  assert.deepEqual(summary.parseWarnings, []);
});

test('invalid props keep their original active flag (lossless re-save)', () => {
  const bytes = buildSyntheticPms({ props: 2, scenery: ['a.png'], invalidLevelOnProp: 1 });
  const map = parsePmsFull(bytes);
  assert.equal(map.props[1].level, 7);
  assert.equal(map.props[1].active, true, 'parser must not flip the flag of an invalid-level prop');
  const patched = patchPmsPropsAndScenery(bytes, map.props, map.scenery);
  const again = parsePmsFull(patched);
  assert.equal(again.props[1].level, 7, 'level byte must be written verbatim, not clamped to 2');
  assert.equal(again.props[1].active, true);
});

test('truncated tail sections produce warnings instead of misaligned data', () => {
  const bytes = buildSyntheticPms({ props: 1, scenery: ['a.png'], colliders: 2, spawns: 3 });
  const truncated = bytes.subarray(0, bytes.length - 20);
  const map = parsePmsFull(truncated);
  assert.ok(map.parseWarnings.length > 0);
  assert.equal(map.colliders.length, 2);
  const summary = parsePmsSummary(truncated);
  assert.ok(summary.parseWarnings.length > 0);
});

test('truncated prop table throws', () => {
  const bytes = buildSyntheticPms({ props: 4, scenery: ['a.png'] });
  // tail = 3 empty sections (12 B), scenery block = 4 + 55 B; cut one prop record more
  const cut = bytes.subarray(0, bytes.length - 12 - (4 + 55) - 44);
  assert.throws(() => parsePmsFull(cut), /Truncated/);
  assert.throws(() => parsePmsSummary(cut), /Truncated/);
});

test('a modified prop is re-encoded while its neighbours stay byte-identical', () => {
  const bytes = buildSyntheticPms({ props: 3, scenery: ['a.png', 'b.png'] });
  const map = parsePmsFull(bytes);
  const props = map.props.map((p, i) => (i === 1 ? { ...p, width: 99 } : p));
  const patched = patchPmsPropsAndScenery(bytes, props, map.scenery);
  const again = parsePmsFull(patched);
  assert.equal(again.props[1].width, 99);
  assert.equal(again.props[0].width, map.props[0].width);
  assert.ok(Buffer.from(again.props[0].raw!).equals(Buffer.from(map.props[0].raw!)));
  assert.ok(Buffer.from(again.props[2].raw!).equals(Buffer.from(map.props[2].raw!)));
});

test('cp1250 short strings round-trip byte-for-byte for every byte value', () => {
  for (let b = 1; b <= 255; b++) {
    const raw = new Uint8Array(1 + 50);
    raw[0] = 1;
    raw[1] = b;
    const decoded = new TextDecoder('windows-1250').decode(raw.subarray(1, 2));
    const encoded = encodePascalShortString(decoded, 50);
    assert.equal(encoded[0], 1);
    assert.equal(encoded[1], b, `byte 0x${b.toString(16)} (${decoded}) must survive decode/encode`);
  }
});

test('patching with unchanged props/scenery keeps every section intact (real maps)', (t) => {
  const mapsDir = findSoldatMapsDir();
  if (!mapsDir) {
    t.skip('Soldat maps folder not available');
    return;
  }
  const files = fs.readdirSync(mapsDir).filter((f) => f.toLowerCase().endsWith('.pms')).slice(0, 300);
  let checked = 0;
  for (const f of files) {
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(fs.readFileSync(path.join(mapsDir, f)));
    let map: ReturnType<typeof parsePmsFull>;
    try {
      map = parsePmsFull(bytes);
    } catch {
      continue;
    }
    const patched = patchPmsPropsAndScenery(bytes, map.props, map.scenery);
    const again = parsePmsFull(patched);
    assert.equal(again.polygons.length, map.polygons.length, f);
    assert.equal(again.props.length, map.props.length, f);
    for (let i = 0; i < map.scenery.length; i++) {
      assert.equal(again.scenery[i].filename, map.scenery[i].filename, `${f}: scenery #${i + 1}`);
      assert.equal(again.scenery[i].date, map.scenery[i].date, `${f}: scenery date #${i + 1}`);
    }
    for (let i = 0; i < map.props.length; i++) {
      const a = map.props[i];
      const b = again.props[i];
      assert.equal(b.active, a.active, `${f}: prop ${i} active`);
      assert.equal(b.style, a.style, `${f}: prop ${i} style`);
      assert.equal(b.level, a.level, `${f}: prop ${i} level`);
      assert.equal(b.width, a.width, `${f}: prop ${i} width`);
    }
    assert.equal(again.spawnpoints.length, map.spawnpoints.length, f);
    assert.equal(again.waypoints.length, map.waypoints.length, f);
    assert.equal(patched.length, bytes.length, `${f}: same counts must give the same file size`);

    // Everything outside the props + scenery block (header, polygons, sectors, colliders, spawns,
    // waypoints) must be byte-identical
    let propsStart = 92 + map.polygons.length * 121 + 8;
    for (const s of map.sectorsPolys ?? []) propsStart += 2 + s.length * 2;
    const tailStart = propsStart + 4 + map.props.length * 44 + 4 + map.scenery.length * 55;
    assert.ok(Buffer.from(patched.subarray(0, propsStart)).equals(Buffer.from(bytes.subarray(0, propsStart))), `${f}: head`);
    assert.ok(Buffer.from(patched.subarray(tailStart)).equals(Buffer.from(bytes.subarray(tailStart))), `${f}: tail`);
    // Untouched props/scenery are copied from their original records, so the whole file is identical
    assert.ok(Buffer.from(patched).equals(Buffer.from(bytes)), `${f}: unchanged re-save must be byte-identical`);
    checked++;
  }
  assert.ok(checked > 0);
});

test('makeDerivedMapName never returns the source name and respects the length limit', () => {
  const cases: Array<[string, '_f' | '_o', number]> = [
    ['ctf_cs_office2', '_o', 24],
    ['ctf_cs_office_f', '_f', 24],
    ['ctf_x_f', '_f', 24],
    ['abcd_f', '_f', 6],
    ['abcdefghijklmnopqrstu_f', '_f', 24],
    ['a_very_long_map_name_that_exceeds_limits', '_o', 24],
    ['x', '_f', 6],
    ['ctf_ash.pms', '_f', 16],
  ];
  for (const [name, suffix, max] of cases) {
    const derived = makeDerivedMapName(name, suffix, max);
    const source = name.replace(/\.pms$/i, '');
    assert.notEqual(derived.toLowerCase(), source.toLowerCase(), `${name} -> ${derived}`);
    assert.ok(derived.length <= Math.max(6, max), `${derived} longer than ${max}`);
    assert.ok(derived.endsWith(suffix), `${derived} must end with ${suffix}`);
  }
  assert.equal(makeDerivedMapName('ctf_cs_office2', '_o', 24), 'ctf_cs_office2_o');
});

test('checkSoldatMapLimits flags only values above the engine limits', () => {
  const ok = checkSoldatMapLimits({
    polygonCount: SOLDAT_MAP_LIMITS.maxPolys,
    sectorsNum: 25,
    propCount: 500,
    sceneryCount: 500,
    colliderCount: 128,
    spawnCount: 255,
  });
  assert.deepEqual(ok, []);
  const bad = checkSoldatMapLimits({
    polygonCount: 5001,
    sectorsNum: 26,
    propCount: 501,
    sceneryCount: 10,
    colliderCount: 129,
    spawnCount: 256,
  });
  assert.deepEqual(
    bad.map((v) => v.key).sort(),
    ['maxColliders', 'maxPolys', 'maxProps', 'maxSectorsNum', 'maxSpawnpoints'].sort()
  );
});
