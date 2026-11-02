import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { SoldatMapWorkshop } from '../src/server/mapFixerOptimizer';
import { buildSyntheticPms } from './helpers';

test('1.7.1 analysis recommends only the Power-of-Two bugs, never sizes taken from a different file', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-fix171-test-'));
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scenery-gfx'), { recursive: true });
  const png = (name: string, width: number, height: number) =>
    sharp({ create: { width, height, channels: 4, background: { r: 0, g: 90, b: 160, alpha: 1 } } })
      .png()
      .toFile(path.join(root, 'scenery-gfx', name));
  await png('crate.png', 20, 10); // the map stored 64x64: old MapMaker's power-of-two bug
  await png('water.png', 400, 400); // the map was laid out for its own 350x270 water (ctf_tw_hue)
  await png('missing.png', 1, 1); // a 1x1 placeholder of a lost image

  fs.writeFileSync(
    path.join(root, 'maps', 'ctf_sizes.pms'),
    buildSyntheticPms({
      props: 3,
      scenery: ['crate.png', 'water.png', 'missing.png'],
      propSizes: [
        { width: 64, height: 64 },
        { width: 350, height: 270 },
        { width: 64, height: 64 },
      ],
    })
  );
  const cache = path.join(base, 'cache');
  fs.mkdirSync(path.join(cache, 'thumbnails'), { recursive: true });
  const scanner = new SoldatMapScanner(root, [], [], cache, path.join(cache, 'thumbnails'));
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(scanner, path.join(base, 'exports'), cache, path.join(base, 'backups'));

  const analysis = await workshop.analyzeMapFor171Fix('ctf_sizes');
  const bySc = new Map(analysis.issues.map((i) => [i.sceneryName, i]));
  assert.equal(bySc.get('crate.png')?.recommended, true, 'power-of-two bug is fixed');
  assert.deepEqual([bySc.get('crate.png')?.expectedWidth, bySc.get('crate.png')?.expectedHeight], [20, 10]);
  assert.equal(bySc.get('water.png')?.recommended, false, 'a non power-of-two size is the author\'s own layout');
  assert.match(bySc.get('water.png')!.reasonLabelPl, /probably not the file the map was made with/);
  assert.equal(bySc.get('missing.png')?.recommended, false, 'never shrink a prop to a 1x1 placeholder');
});
