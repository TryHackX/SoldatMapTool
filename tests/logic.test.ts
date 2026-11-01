import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapClassifier, sanitizeCustomRules } from '../src/shared/prefixUtils';
import { decodeBmpToRgba } from '../src/server/bmpDecoder';
import { applySeamCrossFade, sharpenForDisplay } from '../src/client/renderer/SceneryLayerBaker';

test('built-in classifier: longest prefix wins (RSCS / Trenchwars / CTF)', () => {
  const c = createMapClassifier([]);
  assert.equal(c.classify('ctf_cs_office2').modeGroupId, 'rscs');
  assert.equal(c.classify('ctf_ttw_valley').modeGroupId, 'trenchwars');
  assert.equal(c.classify('ctf_Ash').modeGroupId, 'ctf');
  assert.equal(c.classify('ctf_Ash').prefix, 'ctf_');
  assert.equal(c.classify('Arena').prefix, '__none__');
  assert.equal(c.classify('ctf_ns_arena').subprefix, 'ctf_ns_');
});

test('regex rules with g/y flags classify every map consistently', () => {
  const c = createMapClassifier(
    sanitizeCustomRules([{ id: 'r1', name: 'Fixed', prefixes: [], pattern: '/_f$/gy', badgeColor: '#a855f7', priority: 10, enabled: true }])
  );
  for (let i = 0; i < 6; i++) {
    assert.equal(c.classify('ctf_x_f').matchedRuleId, 'r1', `iteration ${i}`);
  }
});

test('custom prefix rule with higher priority beats a lower-priority pattern rule', () => {
  const c = createMapClassifier(
    sanitizeCustomRules([
      { id: 'ns', name: 'NS', prefixes: ['ctf_ns_'], badgeColor: '#38bdf8', priority: 100, enabled: true },
      { id: 'fixed', name: 'Fixed', prefixes: [], pattern: '*_f', badgeColor: '#a855f7', priority: 1, enabled: true },
    ])
  );
  assert.equal(c.classify('ctf_ns_arena_f').matchedRuleId, 'ns');
  assert.equal(c.classify('ctf_cs_office_f').matchedRuleId, 'fixed', 'pattern still beats built-in prefixes');
});

test('sanitizeCustomRules drops malformed rules and normalizes the rest', () => {
  const rules = sanitizeCustomRules([
    null,
    'garbage',
    { name: '', prefixes: ['abc'] },
    { name: 'No prefixes' },
    { name: 'String prefixes', prefixes: 'ctf_ns_, sctfl', badgeColor: 'red', targetGroupId: 'nope' },
    { name: 'Bad regex', pattern: '/([/' },
    { id: 'dup', name: 'A', prefixes: ['a_'] },
    { id: 'dup', name: 'B', prefixes: ['b_'] },
  ]);
  assert.equal(rules.length, 3);
  assert.deepEqual(rules[0].prefixes, ['ctf_ns_', 'sctfl_']);
  assert.equal(rules[0].badgeColor, '#a855f7');
  assert.equal(rules[0].targetGroupId, undefined);
  assert.notEqual(rules[1].id, rules[2].id);
  // must never throw when compiled
  createMapClassifier(rules).classify('ctf_ns_test');
});

function bmpHeader(width: number, height: number, bpp: number, compression: number, paletteColors: number, pixelBytes: number): Buffer {
  const paletteSize = paletteColors * 4;
  const offset = 14 + 40 + paletteSize;
  const buf = Buffer.alloc(offset + pixelBytes);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(offset, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bpp, 28);
  buf.writeUInt32LE(compression, 30);
  buf.writeUInt32LE(paletteColors, 46);
  return buf;
}

test('BMP decoder: 24-bit bottom-up', () => {
  // 2x2: bottom row stored first; rows padded to 4 bytes (2*3=6 -> 8)
  const buf = bmpHeader(2, 2, 24, 0, 0, 16);
  const px = 54;
  // bottom row: blue, green
  buf.set([255, 0, 0, 0, 255, 0], px);
  // top row: red, white
  buf.set([0, 0, 255, 255, 255, 255], px + 8);
  const d = decodeBmpToRgba(buf);
  assert.equal(d.width, 2);
  assert.deepEqual([...d.rgba.subarray(0, 4)], [255, 0, 0, 255]); // top-left red
  assert.deepEqual([...d.rgba.subarray(4, 8)], [255, 255, 255, 255]); // top-right white
  assert.deepEqual([...d.rgba.subarray(8, 12)], [0, 0, 255, 255]); // bottom-left blue
  assert.deepEqual([...d.rgba.subarray(12, 16)], [0, 255, 0, 255]); // bottom-right green (color key)
});

test('BMP decoder: 8-bit RLE8 with palette', () => {
  const pixelData = [3, 1, 0, 0, 0, 1]; // run of 3 x index1, end of line, end of bitmap
  const buf = bmpHeader(3, 1, 8, 1, 2, pixelData.length);
  buf.set([0, 0, 0, 0, 0, 255, 0, 0], 54); // palette: 0 black, 1 green (BGRA)
  buf.set(pixelData, 54 + 8);
  const d = decodeBmpToRgba(buf);
  for (let x = 0; x < 3; x++) {
    assert.deepEqual([...d.rgba.subarray(x * 4, x * 4 + 4)], [0, 255, 0, 255]);
  }
});

/**
 * Two tiles overlap in a band; after the cross-fade, drawing tile A then tile B ("over", same color)
 * must reproduce the original alpha in the band, and both outermost band texels must be transparent.
 */
test('seam cross-fade reproduces the original alpha exactly when tiles are composited', () => {
  const band = 6;
  const width = 10;
  const alphas = [255, 200, 128, 64, 10, 1];
  for (const a0 of alphas) {
    const tileA = new Uint8ClampedArray(width * 1 * 4);
    const tileB = new Uint8ClampedArray(width * 1 * 4);
    for (let x = 0; x < width; x++) {
      tileA.set([200, 100, 50, a0], x * 4);
      tileB.set([200, 100, 50, a0], x * 4);
    }
    // A is the left tile (band on its right edge), B the right tile (band on its left edge)
    applySeamCrossFade(tileA, width, 1, band, { left: false, right: true, top: false, bottom: false });
    applySeamCrossFade(tileB, width, 1, band, { left: true, right: false, top: false, bottom: false });
    assert.equal(tileA[(width - 1) * 4 + 3], 0, 'outermost texel of A must be transparent');
    assert.equal(tileB[3], 0, 'outermost texel of B must be transparent');
    for (let i = 0; i < band; i++) {
      const aA = tileA[(width - band + i) * 4 + 3] / 255;
      const aB = tileB[i * 4 + 3] / 255;
      const combined = aB + aA * (1 - aB);
      assert.ok(Math.abs(combined * 255 - a0) <= 1.5, `alpha ${a0}: band texel ${i} gives ${(combined * 255).toFixed(2)}`);
    }
  }
});

test('pre-sharpening raises edge contrast, keeps flat areas and transparency, and avoids the color key', () => {
  const w = 6;
  const h = 5;
  const img = new Uint8ClampedArray(w * h * 4);
  const px = (x: number, y: number) => (y * w + x) * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Left: dark grey, right: light grey, last column fully transparent
      if (x === w - 1) img.set([0, 0, 0, 0], px(x, y));
      else img.set(x < 2 ? [50, 50, 50, 255] : [200, 200, 200, 255], px(x, y));
    }
  }
  sharpenForDisplay(img, w, h, 0.1);
  assert.equal(img[px(0, 2)], 50, 'flat area away from the edge is unchanged');
  assert.ok(img[px(1, 2)] < 50 && img[px(2, 2)] > 200, 'both sides of the edge move apart');
  assert.equal(img[px(w - 2, 2)], 200, 'no bright rim where the content meets transparency');
  for (let y = 0; y < h; y++) assert.deepEqual([...img.slice(px(w - 1, y), px(w - 1, y) + 4)], [0, 0, 0, 0]);

  // A bright green pixel among darker greens would clip to exactly #00FF00, which Soldat keys out
  const green = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < 9; i++) green.set([0, i === 4 ? 250 : 200, 0, 255], i * 4);
  sharpenForDisplay(green, 3, 3, 0.1);
  assert.deepEqual([...green.slice(16, 20)], [0, 254, 0, 255]);
});
