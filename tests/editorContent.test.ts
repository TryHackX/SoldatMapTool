import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactSceneryTable,
  ensureSceneryEntry,
  reindexWaypointsAfterDelete,
} from '../src/shared/pmsCompiler';
import { parsePmsFull, PmsMapData, PmsWaypoint, serializePms } from '../src/shared/pmsParser';
import { SPAWN_TYPES } from '../src/shared/soldatConstants';
import {
  computePropQuadCenter,
  emptySelection,
  extractSelectionBundle,
  insertElementBundle,
  reorderSelectedProps,
  toggleWaypointConnection,
  updateMapHeader,
} from '../src/client/editor/EditorDocument';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { buildSyntheticPms } from './helpers';

test('compactSceneryTable & ensureSceneryEntry prune orphans and merge case-insensitive duplicates', () => {
  const base = parsePmsFull(
    buildSyntheticPms({
      props: 3,
      scenery: ['unused_first.bmp', 'Crate.PNG', 'unused_mid.bmp', 'crate.png', 'fern.bmp'],
    })
  );
  // Prop 0 -> style 2 ('Crate.PNG'), Prop 1 -> style 4 ('crate.png'), Prop 2 -> style 5 ('fern.bmp')
  const customProps = [
    { ...base.props[0], style: 2, raw: undefined },
    { ...base.props[1], style: 4, raw: undefined },
    { ...base.props[2], style: 5, raw: undefined },
  ];

  const compacted = compactSceneryTable(customProps, base.scenery);
  assert.equal(compacted.scenery.length, 2, 'unused entries removed and Crate.PNG / crate.png merged');
  assert.equal(compacted.removedSceneryCount, 3);
  assert.deepEqual(
    compacted.scenery.map((s) => s.filename.toLowerCase()),
    ['crate.png', 'fern.bmp']
  );
  assert.equal(compacted.props[0].style, 1);
  assert.equal(compacted.props[1].style, 1);
  assert.equal(compacted.props[2].style, 2);
  assert.equal(compacted.scenery[0].usedCount, 2);
  assert.equal(compacted.scenery[1].usedCount, 1);

  // ensureSceneryEntry reuses existing entry case-insensitively and appends new ones
  const reuse = ensureSceneryEntry(compacted.scenery, 'CRATE.PNG');
  assert.equal(reuse.style, 1);
  assert.equal(reuse.scenery.length, 2);

  const added = ensureSceneryEntry(compacted.scenery, 'bridge.png', 777777);
  assert.equal(added.style, 3);
  assert.equal(added.scenery.length, 3);
  assert.equal(added.scenery[2].filename, 'bridge.png');
});

test('reorderSelectedProps supports front, back, forward, and backward while preserving relative order', () => {
  const map = parsePmsFull(buildSyntheticPms({ props: 4, scenery: ['a.png'] }));
  const taggedMap = {
    ...map,
    props: map.props.map((p, idx) => ({ ...p, x: (idx + 1) * 100, raw: undefined })),
  };
  const xs = (m: PmsMapData) => m.props.map((p) => p.x);

  // Initial X order: [100, 200, 300, 400]
  // Bring [0, 2] (100, 300) to front -> [200, 400, 100, 300]
  const toFront = reorderSelectedProps(taggedMap, [0, 2], 'front');
  assert.deepEqual(xs(toFront.nextMap), [200, 400, 100, 300]);
  assert.deepEqual(toFront.nextSelectedProps, [2, 3]);
  assert.deepEqual(
    toFront.nextMap.props.map((p) => p.index),
    [0, 1, 2, 3]
  );

  // Send [2, 3] (100, 300) to back -> [100, 300, 200, 400]
  const toBack = reorderSelectedProps(toFront.nextMap, [2, 3], 'back');
  assert.deepEqual(xs(toBack.nextMap), [100, 300, 200, 400]);
  assert.deepEqual(toBack.nextSelectedProps, [0, 1]);

  // Step [1] (200 in original [100, 200, 300, 400]) forward -> [100, 300, 200, 400]
  const fwd = reorderSelectedProps(taggedMap, [1], 'forward');
  assert.deepEqual(xs(fwd.nextMap), [100, 300, 200, 400]);
  assert.deepEqual(fwd.nextSelectedProps, [2]);

  // Step [2] backward -> back to [100, 200, 300, 400]
  const bwd = reorderSelectedProps(fwd.nextMap, [2], 'backward');
  assert.deepEqual(xs(bwd.nextMap), [100, 200, 300, 400]);
  assert.deepEqual(bwd.nextSelectedProps, [1]);
});

test('scenery rotated flip preserves visual quad center and all 17 spawn types round-trip cleanly', () => {
  const map = parsePmsFull(buildSyntheticPms({ props: 1, scenery: ['sign.png'] }));
  const rotatedProp = {
    ...map.props[0],
    x: 120,
    y: -80,
    width: 64,
    height: 32,
    scaleX: 1.5,
    scaleY: 1.2,
    rotation: 0.65,
    raw: undefined,
  };
  const beforeCenter = computePropQuadCenter(rotatedProp);
  const flippedTemp = { ...rotatedProp, scaleX: -rotatedProp.scaleX };
  const tempCenter = computePropQuadCenter(flippedTemp);
  const adjusted = {
    ...flippedTemp,
    x: rotatedProp.x + (beforeCenter.x - tempCenter.x),
    y: rotatedProp.y + (beforeCenter.y - tempCenter.y),
  };
  const afterCenter = computePropQuadCenter(adjusted);
  assert.ok(Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y) < 1e-6);

  // Verify all 17 spawn types (0..16) exist and round-trip through PMS binary
  const allTeamIds = Object.values(SPAWN_TYPES).map((s) => s.team).sort((a, b) => a - b);
  assert.equal(allTeamIds.length, 17);
  assert.equal(allTeamIds[0], 0);
  assert.equal(allTeamIds[16], 16);

  const spawns = allTeamIds.map((team, index) => ({
    index,
    active: true,
    x: team * 20,
    y: -30,
    team,
  }));
  const reparsed = parsePmsFull(serializePms({ ...map, spawnpoints: spawns }));
  assert.deepEqual(
    reparsed.spawnpoints.map((s) => s.team),
    allTeamIds
  );
});

test('bot waypoints: 1-way & 2-way connection toggling, 20-link cap, and safe re-indexing on delete', () => {
  const base = createMapFromTemplate('empty');
  const makeWp = (oneBased: number, x: number): PmsWaypoint => ({
    index: oneBased,
    active: true,
    id: oneBased,
    x,
    y: 0,
    left: false,
    right: true,
    up: false,
    down: false,
    jetpack: false,
    pathNum: 1,
    action: 0,
    connections: [],
  });
  let map = {
    ...base,
    waypoints: [makeWp(1, 0), makeWp(2, 50), makeWp(3, 100), makeWp(4, 150)],
  };

  // 1-way link: 0 -> 1 (1-based #1 -> #2)
  map = toggleWaypointConnection(map, 0, 1, false);
  assert.deepEqual(map.waypoints[0].connections, [2]);
  assert.deepEqual(map.waypoints[1].connections, []);

  // Bidirectional link: 1 <-> 2 (1-based #2 <-> #3) and 2 -> 3 (#3 -> #4)
  map = toggleWaypointConnection(map, 1, 2, true);
  map = toggleWaypointConnection(map, 2, 3, false);
  assert.deepEqual(map.waypoints[1].connections, [3]);
  assert.deepEqual(map.waypoints[2].connections, [2, 4]);

  // Also link 0 -> 3 (#1 -> #4)
  map = toggleWaypointConnection(map, 0, 3, false);
  assert.deepEqual(map.waypoints[0].connections, [2, 4]);

  // Delete waypoint index 1 (1-based #2):
  // Remaining old 1-based [1, 3, 4] become new [1, 2, 3]!
  // Old #1 had [2, 4] -> #2 is gone, #4 becomes #3 => [3]!
  // Old #3 (now #2) had [2, 4] -> #2 is gone, #4 becomes #3 => [3]!
  const reindexed = reindexWaypointsAfterDelete(map.waypoints, [1]);
  assert.equal(reindexed.length, 3);
  assert.deepEqual(
    reindexed.map((w) => w.id),
    [1, 2, 3]
  );
  assert.deepEqual(reindexed[0].connections, [3]);
  assert.deepEqual(reindexed[1].connections, [3]);
  assert.deepEqual(reindexed[2].connections, []);

  // Binary round-trip of waypoints with connections & flags
  const roundTripped = parsePmsFull(serializePms({ ...map, waypoints: reindexed }));
  assert.equal(roundTripped.waypoints.length, 3);
  assert.deepEqual(roundTripped.waypoints[0].connections, [3]);
  assert.equal(roundTripped.waypoints[0].right, true);
});

test('updateMapHeader enforces PMS ShortString lengths, startJetGame formula, and range clamps', () => {
  const base = createMapFromTemplate('empty');
  const updated = updateMapHeader(base, {
    mapName: 'A'.repeat(60),
    texture: 'very_long_texture_filename_over_24_chars.bmp',
    startJet: 200,
    grenadePacks: 99,
    medikits: -5,
    weather: 9,
    steps: 8,
  });

  assert.equal(updated.mapName.length, 38);
  assert.equal(updated.texture.length, 24);
  assert.equal(updated.startJet, 200);
  assert.equal(updated.startJetGame, Math.floor((119 * 200) / 100));
  assert.equal(updated.grenadePacks, 12);
  assert.equal(updated.medikits, 0);
  assert.equal(updated.weather, 3);
  assert.equal(updated.steps, 2);
});

test('extractSelectionBundle & insertElementBundle support cross-map prefab/clipboard insertion', () => {
  const mapA = parsePmsFull(
    buildSyntheticPms({ props: 2, scenery: ['palm.png', 'bunker.bmp'], colliders: 1, spawns: 1 })
  );
  const wp1: PmsWaypoint = {
    index: 1,
    active: true,
    id: 1,
    x: 10,
    y: 10,
    left: false,
    right: true,
    up: false,
    down: false,
    jetpack: false,
    pathNum: 1,
    action: 0,
    connections: [2],
  };
  const wp2: PmsWaypoint = { ...wp1, index: 2, id: 2, x: 40, y: 10, connections: [1] };
  const sourceMap = { ...mapA, waypoints: [wp1, wp2] };

  const extracted = extractSelectionBundle(sourceMap, {
    ...emptySelection(),
    polygons: [0],
    props: [0, 1],
    spawns: [0],
    colliders: [0],
    waypoints: [0, 1],
  });
  assert.ok(extracted);

  // Target map already has 1 existing waypoint and 0 sceneries
  const emptyTarget = {
    ...createMapFromTemplate('empty'),
    waypoints: [{ ...wp1, x: -200, y: -200, connections: [] }],
  };

  const inserted = insertElementBundle(emptyTarget, extracted.bundle, extracted.bounds, 300, -100);
  assert.equal(inserted.nextMap.polygons.length, 1);
  assert.equal(inserted.nextMap.props.length, 2);
  assert.equal(inserted.nextMap.scenery.length, 2, 'missing sceneries automatically registered on target map');
  assert.equal(inserted.nextMap.spawnpoints.length, 1);
  assert.equal(inserted.nextMap.colliders.length, 1);
  assert.equal(inserted.nextMap.waypoints.length, 3);
  // Newly pasted waypoints are 1-based #2 and #3 and link to each other (#2 <-> #3)!
  assert.deepEqual(inserted.nextMap.waypoints[1].connections, [3]);
  assert.deepEqual(inserted.nextMap.waypoints[2].connections, [2]);
});
