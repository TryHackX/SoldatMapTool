import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePmsFull } from '../src/shared/pmsParser';
import { findFloorBelow } from '../src/client/utils/mapGeometry';
import { buildSyntheticPms } from './helpers';

test('a soldier dropped above a floor lands on the first player-solid surface below', () => {
  // The synthetic map has one Normal triangle (0,0) (100,0) (0,100): its top edge is a floor at y = 0
  const map = parsePmsFull(buildSyntheticPms({}));
  assert.equal(findFloorBelow(map, 20, -50, 960), 0);
  assert.equal(findFloorBelow(map, 20, -2000, 960), null, 'too far above the floor');
  assert.equal(findFloorBelow(map, 20, 20, 960), null, 'inside the polygon: no floor to drop to');
  assert.equal(findFloorBelow(map, 150, -50, 960), null, 'nothing below');

  // Players fall through bullet-only, non-colliding and background polygons
  for (const polyType of [1, 3, 24]) {
    const pass = { ...map, polygons: map.polygons.map((p) => ({ ...p, polyType })) };
    assert.equal(findFloorBelow(pass, 20, -50, 960), null, `type ${polyType}`);
  }
});
