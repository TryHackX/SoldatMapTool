import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { drawCourse, generateCourseMap, DEFAULT_COURSE } from '../src/shared/courseGenerator';
import { measureClimbTerrain, type ClimbGeometryProfile } from '../src/shared/climbSamples';
import { reboundImpulse, verifyClimbRoute } from '../src/shared/climbPhysics';
import { parsePmsFull, serializePms, soldatCrc32 } from '../src/shared/pmsParser';
import { loadClimbProfile } from '../src/server/courseProfile';
import type { MapIndexEntry } from '../src/shared/apiTypes';
import { createSoldierPlaytestState } from '../src/client/editor/soldierPlaytest';

const header = { title: 'Climb QA', texture: 'default.bmp' };
const profile: ClimbGeometryProfile = {
  jumps: [{ gap: 18, rise: 5 }, { gap: 32, rise: 12 }, { gap: 55, rise: -7 }], rebounds: [2.75],
  measuredMaps: 1, pairs: 3, bounceMaps: 1,
};

test('profile measures exposed ledges edge to edge and keeps rise and actual surface rebound', () => {
  const platforms = [
    ...makeQuadPolys(0, 20, 40, 45),
    ...makeQuadPolys(70, 5, 96, 32, { polyType: 18, bounciness: 2.75 }),
    ...makeQuadPolys(71, 7, 95, 9, { polyType: 18, bounciness: 15 }), // fully buried
    ...makeQuadPolys(48, 17, 59, 20, { polyType: 5 }), // deadly, no safe landing
  ];
  const { jumps, rebounds } = measureClimbTerrain(platforms);
  assert.deepEqual(jumps, [{ gap: 30, rise: 15, landingWidth: 26 }]);
  assert.deepEqual(rebounds, [2.75]);
  const extended = measureClimbTerrain([...platforms, ...makeQuadPolys(110, 0, 140, 10)]);
  assert.ok(extended.jumps.some(s => s.rebound === 2.75 && s.gap === 14 && s.rise === 5));
  assert.equal(reboundImpulse(3, 4, 2.75), 13.75);
});

test('server coalesces concurrent reads, deduplicates identical PMS files and invalidates changed geometry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'soldat-climb-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fullPath = join(dir, 'ctf_kz_test.pms');
  const entry = async (gap: number) => {
    const map = createMapFromTemplate('empty', header);
    map.polygons = [...makeQuadPolys(0, 0, 20, 15), ...makeQuadPolys(20 + gap, -4, 50 + gap, 15, { polyType: 18, bounciness: 3 })];
    const bytes = serializePms(map);
    await writeFile(fullPath, bytes);
    return {
      fullPath, crc32: soldatCrc32(bytes), fileSize: bytes.length, mtimeMs: gap, modeGroupId: 'climb',
      polyTypeCounts: { 0: 2, 18: 2 }, polygonCount: 4, spawnTeamCounts: {}
    } as unknown as MapIndexEntry;
  };
  const first = await entry(30);
  const selected = [first, { ...first, fullPath: join(dir, 'copy.pms') }];
  const pending = loadClimbProfile(selected);
  assert.equal(pending, loadClimbProfile(selected));
  const result = await pending;
  assert.equal(result.samples, 1);
  assert.equal(result.geometry.pairs, 1);
  assert.equal(result.geometry.jumps[0].gap, 30);
  assert.equal(result.geometry.rebounds.length, 3);
  assert.ok(result.geometry.rebounds.every(n => Math.abs(n - 3) < 1e-6));
  const second = await entry(55);
  assert.equal((await loadClimbProfile([second])).geometry.jumps[0].gap, 55);
  assert.equal((await loadClimbProfile([first])).skipped, 1);
});

test('all difficulties reach the flag on the serialized PMS without fuel; the trace reaches the finish', () => {
  for (const seed of [0, 42, 958, 9001]) {
    const lengths = [];
    for (const difficulty of ['relaxed', 'race', 'expert'] as const) {
      const settings = { ...DEFAULT_COURSE, seed, difficulty, profile };
      const map = parsePmsFull(serializePms(generateCourseMap('climb', settings, header)));
      const run = verifyClimbRoute(map, true);
      assert.ok(run.reached, JSON.stringify({ seed, difficulty, run }));
      assert.ok(run.ticks > 60 && run.trace!.length > run.jumps);
      assert.equal(createSoldierPlaytestState(0, 0, map).maxJetFuel, 0);
      const flag = map.spawnpoints.find(s => s.team === 6)!;
      assert.ok(Math.abs(run.trace!.at(-1)!.x - flag.x) < 2);
      lengths.push(run.jumps);
    }
    assert.ok(lengths[0] < lengths[1] && lengths[1] < lengths[2]);
  }
});

test('unreachable gaps, hazards, ceilings, buried flags and incomplete meshes do not receive a successful run', () => {
  const map = createMapFromTemplate('empty', header);
  map.spawnpoints = [{ index: 0, x: 14, y: -25, team: 1, active: true }, { index: 1, x: 87, y: -16, team: 6, active: true }];
  const start = makeQuadPolys(0, 0, 36, 18), end = makeQuadPolys(64, 0, 108, 18);
  map.polygons = [...start, ...end];
  assert.ok(verifyClimbRoute(map).reached);
  for (const extra of [
    makeQuadPolys(48, -120, 53, 28, { polyType: 5 }),
    makeQuadPolys(32, -22, 95, -14, { polyType: 7 }),
    makeQuadPolys(79, -40, 100, 0, { polyType: 5 }),
    [start[0]],
  ]) assert.equal(verifyClimbRoute({ ...map, polygons: [...map.polygons, ...extra] }).reached, false);
  map.spawnpoints[1].x += 400;
  map.polygons = [...start, ...makeQuadPolys(464, 0, 508, 18)];
  assert.equal(verifyClimbRoute(map).reached, false);
});

test('drawn routes reuse the library gap and rebound samples regardless of pointer sampling rate', () => {
  const settings = { ...DEFAULT_COURSE, deadly: 0, hurt: 0, bounce: 100, profile: { ...profile, jumps: [{ gap: 16, rise: 4 }] } };
  const path = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
  const dense = Array.from({ length: 101 }, (_, i) => ({ x: i * 10, y: 0 }));
  const near = drawCourse(path, settings);
  const far = drawCourse(path, { ...settings, profile: { ...profile, jumps: [{ gap: 90, rise: 4 }] } });
  assert.deepEqual(near, drawCourse(dense, settings));
  assert.ok(near.length > far.length);
  assert.ok(near.some(p => p.polyType === 18 && p.bounciness === 2.75));
});

test('gap samples affect layout and the solver carries incoming velocity through measured bouncy platforms', () => {
  const make = (gap: number) => generateCourseMap('climb', {
    ...DEFAULT_COURSE, seed: 13, bounce: 100, hurt: 0, deadly: 0,
    profile: { ...profile, rebounds: [1.1], jumps: [{ gap, rise: 0 }], bounceJumps: [{ gap, rise: 0, rebound: 2.75 }] }
  }, header);
  const short = make(14), long = make(45);
  assert.ok(short.fullBounds.width < long.fullBounds.width);
  const pads = long.polygons.filter(p => p.polyType === 18);
  assert.ok(pads.length >= 2);
  assert.ok(pads.every(p => Math.abs(p.bounciness - 2.75) < 0.0001));
  assert.ok(verifyClimbRoute(long).reached);
  const weakened = { ...long, polygons: long.polygons.map(p => p.polyType === 18 ? { ...p, bounciness: 0.1 } : p) };
  assert.equal(verifyClimbRoute(weakened).reached, false);
});
