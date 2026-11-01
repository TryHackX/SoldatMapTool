import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bakeTilesFor, estimateTileCrop, MAX_BAKE_TILES, TILE_OVERLAP_WORLD } from '../src/shared/bakeTiling';
import { OptimizeMapOptions } from '../src/shared/apiTypes';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { SoldatMapWorkshop } from '../src/server/mapFixerOptimizer';
import { buildSyntheticPms } from './helpers';

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

test('bake tiles cover a layer group exactly once, overlap only at shared edges and fit the tile size', () => {
  const bounds = box(-1002, -498, 3605, 1403);
  for (const maxTilePx of [2048, 4096]) {
    for (let s = 1; s <= 4; s++) {
      const tiles = bakeTilesFor(bounds, s, maxTilePx, [bounds]);
      assert.ok(tiles);
      let coreArea = 0;
      for (const t of tiles) {
        assert.ok((t.right - t.left) * s <= maxTilePx && (t.bottom - t.top) * s <= maxTilePx, `${s}x fits the tile`);
        for (const v of [t.left, t.right, t.top, t.bottom]) assert.ok(Number.isInteger(v), 'whole world units');
        const ov = TILE_OVERLAP_WORLD;
        coreArea +=
          (t.right - (t.sides.right ? ov : 0) - (t.left + (t.sides.left ? ov : 0))) *
          (t.bottom - (t.sides.bottom ? ov : 0) - (t.top + (t.sides.top ? ov : 0)));
        assert.ok(t.left >= bounds.left && t.right <= bounds.right && t.top >= bounds.top && t.bottom <= bounds.bottom);
      }
      assert.equal(coreArea, bounds.width * bounds.height, `${s}x: tile cores partition the group`);
    }
  }
});

test('only tiles reached by a prop are baked, and an absurdly large layer is refused instead of enumerated', () => {
  const bounds = box(-2, -2, 6040, 6040);
  const props = [box(0, 0, 32, 16), box(6000, 6000, 32, 16)];
  const tiles = bakeTilesFor(bounds, 3, 2048, props);
  assert.equal(tiles?.length, 2);
  // 3x: tile cores are 678 units, the second one starts at 676 and renders from 674 (overlap band)
  assert.equal(bakeTilesFor(bounds, 3, 2048, [box(300, 10, 10, 10)])?.length, 1);
  assert.equal(bakeTilesFor(bounds, 3, 2048, [box(660, 10, 15, 10)])?.length, 2, 'the band is shared');

  const huge = box(-100000, -100000, 200000, 200000);
  assert.equal(bakeTilesFor(huge, 4, 2048, [huge]), null, `more than ${MAX_BAKE_TILES} tiles`);
});

test('crop estimate keeps the seam band when content touches a shared edge', () => {
  const tile = { left: 0, right: 500, top: 0, bottom: 500, sides: { left: true, right: false, top: false, bottom: false } };
  const prop = (left: number, top: number) => box(left, top, 10.5, 10);

  assert.deepEqual(estimateTileCrop(tile, [prop(100.4, 200)]), { width: 13, height: 12 });
  // Inside the cross-fade band of the left neighbour: the crop must reach the tile edge
  assert.deepEqual(estimateTileCrop(tile, [prop(2, 200)]), { width: 14, height: 12 });
  assert.equal(estimateTileCrop(tile, [prop(600, 200)]), null, 'a prop outside the tile adds nothing');
});

async function planFor(name: string, propPositions: Array<{ x: number; y: number }>) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-tiling-test-'));
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'maps', `${name}.pms`),
    buildSyntheticPms({ props: propPositions.length, propPositions })
  );
  const cache = path.join(base, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const scanner = new SoldatMapScanner(root, [], [], cache, path.join(cache, 'thumbnails'));
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(scanner, path.join(base, 'exports'), cache, path.join(base, 'backups'));
  const options: OptimizeMapOptions = {
    mergeBack: true,
    mergeMid: false,
    mergeFront: false,
    supersample: 3,
    maxTilePx: 2048,
    preserveGiantProps: false,
    giantPropThresholdPx: 1600,
    skipIsolatedSingleProps: false,
    removeUnusedScenery: false,
    preferClassicBmp: false,
    maxBaseLength: 24,
    destination: 'exports_optimized',
  };
  return workshop.planSceneryOptimization(name, options);
}

test('texture estimate counts only the tiles the props reach (a run spread over the map stays small)', async () => {
  // Props 0 and 3 share level 0 (levels cycle 0,1,2) and form one run 6000 units apart
  const plan = await planFor('ctf_spread', [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 100 },
    { x: 6000, y: 6000 },
  ]);

  assert.equal(plan.groups.length, 1);
  const [group] = plan.groups;
  assert.ok(group.worldBounds.width > 6000 && group.worldBounds.height > 6000);
  assert.equal(group.tileCount, 2, 'only the two tiles holding a prop are baked');
  assert.equal(plan.estimatedTotalPropsAfter, 2 + 2, 'two preserved props (other levels) + two tiles');
  // The group's bounding box alone would be ~330 MPx at 3x
  assert.ok(plan.estimatedMegapixelsBySupersample[2] < 0.05, `3x estimate ${plan.estimatedMegapixelsBySupersample[2]}`);
  const mp = plan.estimatedMegapixelsBySupersample;
  assert.ok(mp[0] <= mp[1] && mp[1] <= mp[2] && mp[2] <= mp[3]);
});

test('a prop with garbage coordinates is kept untouched and does not blow up the plan', async () => {
  // ctf_LaaF-Run has a prop at x = -2^63; planning it used to exhaust the server's memory
  const plan = await planFor('ctf_garbage', [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 100 },
    { x: -9223372036854775808, y: 0 },
    { x: 200, y: 0 },
    { x: 250, y: 0 },
    { x: 300, y: 0 },
  ]);

  const offMap = plan.preservedSample.filter((p) => p.reason === 'off_map');
  assert.deepEqual(offMap.map((p) => p.propIndex), [3]);
  assert.equal(plan.groups.length, 1, 'the run around it is not split');
  assert.deepEqual(plan.groups[0].propIndices, [0, 6]);
  assert.ok(plan.groups[0].worldBounds.width < 400);
});
