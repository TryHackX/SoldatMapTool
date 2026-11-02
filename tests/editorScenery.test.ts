import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePropAabb, parsePmsFull, PmsMapData } from '../src/shared/pmsParser';
import { adjustColor, hexToRgb, hsvToRgb, parseHexColor, rgbToHex, rgbToHsv } from '../src/client/editor/colorTools';
import { computePropQuadCenter, stretchSinglePropLocal } from '../src/client/editor/EditorDocument';
import type { GizmoHandleKind } from '../src/client/editor/types';
import {
  applyDepthHaze,
  flipProps,
  gradientProps,
  propsUsingScenery,
  randomizeProps,
  replacePropsScenery,
  rotatePropsInPlace,
  scaleProps,
  sceneryUsageCounts,
  setPropsTint,
} from '../src/client/editor/sceneryOps';
import { buildSyntheticPms } from './helpers';

function sceneryMap(): PmsMapData {
  return parsePmsFull(
    buildSyntheticPms({
      props: 3,
      scenery: ['tree.bmp', 'rock.png'],
      propPositions: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ],
    })
  );
}

test('colour helpers: hex parsing, HSV round trip and relative adjustments', () => {
  assert.deepEqual(parseHexColor('#0f8'), { r: 0, g: 255, b: 136 });
  assert.equal(parseHexColor('nope'), null);
  assert.equal(rgbToHex({ r: 255, g: 128, b: 0 }), '#ff8000');
  for (const hex of ['#ff0000', '#12ab34', '#808080', '#ffffff', '#000000', '#3b82f6']) {
    const c = hexToRgb(hex);
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(c))), hex, hex);
  }
  // Hue shift by 120° turns red into green; brightness -1 gives black but keeps alpha
  assert.equal(rgbToHex(adjustColor(hexToRgb('#ff0000'), { hueShift: 120 })), '#00ff00');
  const dark = adjustColor({ r: 200, g: 100, b: 50, a: 77 }, { brightness: -1 });
  assert.deepEqual(dark, { r: 0, g: 0, b: 0, a: 77 });
});

test('scenery tint, gradient and depth haze only touch the intended props', () => {
  const map = sceneryMap();
  const tinted = setPropsTint(map, [1], { r: 10, g: 20, b: 30, a: 255 });
  assert.deepEqual(
    { r: tinted.props[1].color.r, g: tinted.props[1].color.g, b: tinted.props[1].color.b },
    { r: 10, g: 20, b: 30 }
  );
  assert.equal(tinted.props[0], map.props[0], 'unselected props keep their identity (and file record)');
  assert.equal(tinted.props[1].raw, undefined);

  const grad = gradientProps(map, [0, 1, 2], {
    axis: 'x',
    tint: true,
    from: { r: 255, g: 255, b: 255, a: 255 },
    to: { r: 0, g: 0, b: 0, a: 255 },
    alphaFrom: 255,
    alphaTo: 55,
  });
  assert.deepEqual(grad.props.map((p) => p.color.r), [255, 128, 0]);
  assert.deepEqual(grad.props.map((p) => p.alpha), [255, 155, 55]);

  const leveled = { ...map, props: map.props.map((p, i) => ({ ...p, level: i, color: { r: 255, g: 255, b: 255, a: 255 } })) };
  const hazy = applyDepthHaze(leveled, { color: { r: 0, g: 0, b: 255, a: 255 }, back: 0.5, middle: 0.25, front: 0 });
  assert.deepEqual(hazy.props.map((p) => p.color.r), [128, 191, 255]);
  assert.equal(hazy.props[2], leveled.props[2], 'front layer with strength 0 is untouched');
});

test('scaling, rotating and flipping props keep each prop centred', () => {
  const map = sceneryMap();
  const before = computePropQuadCenter(map.props[0]);
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

  const bigger = scaleProps(map, [0], 2, 2);
  assert.equal(bigger.props[0].scaleX, map.props[0].scaleX * 2);
  assert.ok(close(computePropQuadCenter(bigger.props[0]), before));

  const flipped = flipProps(map, [0], 'x');
  assert.equal(flipped.props[0].scaleX, -map.props[0].scaleX);
  assert.ok(close(computePropQuadCenter(flipped.props[0]), before));
  // Scaling a flipped prop keeps the flip
  const absolute = scaleProps(flipped, [0], 1.5, 1.5, 'absolute');
  assert.equal(absolute.props[0].scaleX, -1.5);

  const turned = rotatePropsInPlace(map, [0], 90);
  assert.ok(Math.abs(turned.props[0].rotation - (map.props[0].rotation - Math.PI / 2)) < 1e-9);
  assert.ok(close(computePropQuadCenter(turned.props[0]), before));
});

test('randomize is deterministic per seed and stays within the requested ranges', () => {
  const map = sceneryMap();
  const opts = { seed: 42, scale: 0.2, rotationDeg: 10, hue: 20, brightness: 0.1, alpha: 30 };
  const a = randomizeProps(map, [0, 1, 2], opts);
  const b = randomizeProps(map, [0, 1, 2], opts);
  assert.deepEqual(a.props, b.props);
  for (let i = 0; i < 3; i++) {
    const ratio = Math.abs(a.props[i].scaleX / map.props[i].scaleX);
    assert.ok(ratio >= 0.8 - 1e-9 && ratio <= 1.2 + 1e-9, `scale ratio ${ratio}`);
    assert.ok(Math.abs(a.props[i].rotation - map.props[i].rotation) <= (10 * Math.PI) / 180 + 1e-9);
  }
});

test('scenery usage lookups and image replacement', () => {
  const map = sceneryMap();
  const counts = sceneryUsageCounts(map);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  assert.equal(total, 3);
  const trees = propsUsingScenery(map, 'TREE.BMP');
  const swapped = replacePropsScenery(map, trees, 'bush.png');
  for (const i of trees) assert.equal(swapped.scenery[swapped.props[i].style - 1].filename, 'bush.png');
  assert.deepEqual(propsUsingScenery(swapped, 'tree.bmp'), []);
});

test('every stretch handle scales its own side and keeps the opposite side anchored', () => {
  const base = {
    index: 0,
    active: true,
    style: 1,
    width: 100,
    height: 50,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 255,
    color: { r: 255, g: 255, b: 255, a: 255 },
    level: 1,
  };
  const cases: Array<[GizmoHandleKind, number, number, [number, number, number, number]]> = [
    ['scale_e', 110, 25, [0, 110, 0, 50]],
    ['scale_w', -10, 25, [-10, 100, 0, 50]],
    ['scale_n', 50, -10, [0, 100, -10, 50]],
    ['scale_s', 50, 60, [0, 100, 0, 60]],
    ['scale_se', 110, 60, [0, 110, 0, 60]],
    ['scale_nw', -10, -10, [-10, 100, -10, 50]],
    ['scale_ne', 110, -10, [0, 110, -10, 50]],
    ['scale_sw', -10, 60, [-10, 100, 0, 60]],
  ];
  for (const [handle, wx, wy, [left, right, top, bottom]] of cases) {
    const b = computePropAabb(stretchSinglePropLocal(base, handle, wx, wy));
    const got = [b.left, b.right, b.top, b.bottom].map((v) => Math.round(v * 1000) / 1000);
    assert.deepEqual(got, [left, right, top, bottom], handle);
  }
});
