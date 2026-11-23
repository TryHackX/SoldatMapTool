import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { analyzeCleanArchive, exportCleanArchive } from '../src/server/archiveCleaner';
import { checkArchiveGameplay, clearInvalidWaypointTargets } from '../src/server/archiveGameplayCheck';
import { normalizeConfirmedDormantRecords } from '../src/server/archiveDormantRecords';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { parsePmsSummary, serializePms, type PmsProp, type PmsWaypoint } from '../src/shared/pmsParser';

function waypoint(index: number, extra: Partial<PmsWaypoint> = {}): PmsWaypoint {
  return { index, id: index, x: 140, y: -60, active: true, left: false, right: true, up: false, down: false,
    jetpack: false, pathNum: 1, action: 0, connections: [], ...extra };
}

function fixture(waypoints: PmsWaypoint[], props: Partial<PmsProp>[] = []) {
  const map = createMapFromTemplate('arena', {});
  map.spawnpoints = [];
  map.waypoints = waypoints;
  map.scenery = [{ index: 1, filename: 'box.bmp', date: 0, usedCount: 1 }];
  map.props = props.map((extra, index) => ({ index, style: 1, active: true, level: 0, x: 1, y: -1,
    scaleX: -1, scaleY: 1, rotation: 0, width: 16, height: 16, alpha: 0, color: { r: 20, g: 40, b: 60, a: 0 }, ...extra }));
  map.rawTail = Uint8Array.of(255, 177, 9);
  // Exercise nonzero backing byte offsets too (as with pooled Node buffers).
  const bytes = Buffer.concat([Buffer.alloc(7), serializePms(map)]).subarray(7);
  const summary = parsePmsSummary(bytes, { inspectSectorReferences: true });
  return { bytes, summary, offsets: summary.gameplayOffsets! };
}

test('only provably empty branches recover from an impossible connection count', () => {
  const {bytes,summary,offsets}=fixture([waypoint(1),waypoint(2)]);
  bytes.writeInt32LE(-1,offsets.waypoints+28);
  bytes.writeInt32LE(99,offsets.waypoints+112+28);
  bytes.writeInt32LE(1,offsets.waypoints+112+32+19*4);
  const checked=normalizeConfirmedDormantRecords(bytes,summary);
  const expected=Buffer.from(bytes);
  expected.writeInt32LE(0,offsets.waypoints+28);
  assert.deepEqual(checked.bytes,expected);
  assert.equal(bytes.readInt32LE(offsets.waypoints+28),-1);
  assert.equal(checked.repairs.length,1);
  assert.match(checkArchiveGameplay(checked.bytes,summary).issues.join(' '),/#2=99/);
});

test('repairs only impossible nonzero targets, preserving the original, declared slots, weights, inactive slots and trailing data', () => {
  const { bytes, summary, offsets } = fixture([
    waypoint(1, { id: 99, connections: [2, 0, 99, -1, 2] }),
    waypoint(2, { id: 27, active: false, connections: [-88, 3] }),
  ]);
  const firstSlot = offsets.waypoints + 32;
  bytes.writeInt32LE(0x12345678, firstSlot + 20); // Undeclared slot with author bytes.
  const original = Buffer.from(bytes);
  const { issues, invalidWaypointTargets } = checkArchiveGameplay(bytes, summary);
  assert.deepEqual(issues, []);
  assert.deepEqual(invalidWaypointTargets, [firstSlot + 8, firstSlot + 12]);
  const fixed = clearInvalidWaypointTargets(bytes, invalidWaypointTargets);
  const expected = Buffer.from(original);
  expected.fill(0, firstSlot + 8, firstSlot + 16);
  assert.deepEqual(fixed, expected);
  assert.deepEqual(bytes, original);
  assert.deepEqual(checkArchiveGameplay(fixed, summary), { issues: [], invalidWaypointTargets: [] });
  assert.equal(clearInvalidWaypointTargets(fixed, []), fixed);
});

test('reports invalid counts on active reachable rows, accepts 0 and 20 and ignores inactive and coordinate-disabled rows', () => {
  const { bytes, summary, offsets } = fixture([
    waypoint(1), waypoint(2), waypoint(3, { connections: Array(20).fill(1) }), waypoint(4),
    waypoint(5, { active: false }), waypoint(6, { y: -2_000_000 }),
  ]);
  for (const [row, badCount] of [[0, -1], [1, 2147483419], [4, -12], [5, 98765]]) {
    bytes.writeInt32LE(badCount, offsets.waypoints + row * 112 + 28);
  }
  const result = checkArchiveGameplay(bytes, summary);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /expected 0\.\.20, 2 records.*#1=-1, #2=2147483419/);
  assert.deepEqual(result.invalidWaypointTargets, []);
});

test('only renderable scenery with non-finite transforms needs review, including transparent placements', () => {
  const { bytes, summary, offsets } = fixture([], [{}, {}, {}, {}, {}, { active: false }, { level: 3 }, { style: 0 }, { style: 2 }, {}]);
  for (let row = 0; row < 9; row++) {
    bytes.writeFloatLE(row === 0 ? -Infinity : NaN, offsets.props + row * 44 + 12 + (row % 5) * 4);
  }
  const original = Buffer.from(bytes);
  const result = checkArchiveGameplay(bytes, summary);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /Non-finite active scenery transforms \(5 placements\).*#1 x=-Infinity/);
  assert.deepEqual(bytes, original);
});

test('the engine waypoint limit applies even to a table of entirely inactive rows', () => {
  const { bytes, summary } = fixture(Array(5001).fill(waypoint(1, { active: false })));
  assert.deepEqual(checkArchiveGameplay(bytes, summary).issues, ['Bot waypoints 5001 > 5000']);
});

test('archive export repairs a waypoint before pruning scenery shifts its byte offset, and lists structurally ambiguous maps for review', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'soldat-gameplay-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  await fs.mkdir(path.join(source, 'maps'), { recursive: true });
  await fs.mkdir(path.join(source, 'textures'));
  const validLayout = fixture([waypoint(1, { connections: [1, 13, 0] })]);
  const damagedCount = Buffer.from(validLayout.bytes);
  damagedCount.writeInt32LE(21, validLayout.offsets.waypoints + 28);
  const damagedTransform = fixture([], [{}]);
  damagedTransform.bytes.writeFloatLE(Infinity, damagedTransform.offsets.props + 28);
  await fs.writeFile(path.join(source, 'maps', 'repair.pms'), validLayout.bytes);
  await fs.writeFile(path.join(source, 'maps', 'count.pms'), damagedCount);
  await fs.writeFile(path.join(source, 'maps', 'transform.pms'), damagedTransform.bytes);
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png()
    .toFile(path.join(source, 'textures', path.parse(validLayout.summary.texture).name + '.png'));
  const plan = await analyzeCleanArchive(source, path.join(temp, 'work'));
  assert.equal(plan.summary.readyMaps, 1);
  assert.equal(plan.summary.blockedMaps, 2);
  const ready = plan.maps.find(m => m.status === 'ready')!;
  assert.equal(ready.removedScenery, 1);
  assert.match(ready.repairs!.join(' '), /waypoint targets.*1/i);
  assert.ok(plan.maps.some(m => m.issues.some(i => i.includes('waypoint connection counts'))));
  assert.ok(plan.maps.some(m => m.issues.some(i => i.includes('Non-finite active scenery'))));
  const out = path.join(temp, 'output');
  await exportCleanArchive(plan, out);
  const written = await fs.readFile(path.join(out, 'maps', ready.output!));
  const cleaned = parsePmsSummary(written, { inspectSectorReferences: true });
  const base = cleaned.gameplayOffsets!.waypoints;
  assert.equal(base, validLayout.offsets.waypoints - 55);
  const originalWaypoint = validLayout.bytes.subarray(validLayout.offsets.waypoints);
  const expectedWaypoint = Buffer.from(originalWaypoint);
  expectedWaypoint.writeInt32LE(0, 36);
  assert.deepEqual(written.subarray(base), expectedWaypoint);
  assert.deepEqual(await fs.readFile(path.join(source, 'maps', 'repair.pms')), validLayout.bytes);
});
