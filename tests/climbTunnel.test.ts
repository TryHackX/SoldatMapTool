import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTunnelMap, DEFAULT_TUNNEL, generateClimbTunnel, TUNNEL_PALETTES,
  type TunnelDirection, type TunnelPoint, type TunnelResult,
} from '../src/shared/climbTunnel';
import { validateMapDocument } from '../src/shared/mapValidator';
import { pointInTriInclusive, polygonSignedArea2 } from '../src/shared/polygonGeometry';
import { hasInwardNormals } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms, SOLDAT_MAP_LIMITS } from '../src/shared/pmsParser';

const header = { title: 'Cave study', texture: 'default.bmp' };
const settings = DEFAULT_TUNNEL;

function assertOpenSpine(result: TunnelResult) {
  assert.equal(result.validation.ok, true, result.validation.reason);
  assert.ok(result.validation.minClearance >= 20);
  assert.ok(result.polygons.length <= SOLDAT_MAP_LIMITS.maxPolys);
  // Check the full-resolution PMS triangles independently, at the centre and at
  // the corners of a standing player's box, including between corridor stations.
  for (let i = 1; i < result.centerline.length; i++) {
    const a = result.centerline[i - 1], b = result.centerline[i];
    for (const t of [0, 0.45, 1]) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      for (const [dx, dy] of [[0, 0], [-3.5, -7], [3.5, -7], [-3.5, 7], [3.5, 7]]) {
        assert.ok(!result.polygons.some(p => pointInTriInclusive(x + dx, y + dy, ...p.vertices)));
      }
    }
  }
}

test('each seeded cave direction has continuous editable rock, usable CTF spawns and round-trippable collision sectors', () => {
  for (const direction of ['across', 'winding', 'up', 'down'] as TunnelDirection[]) {
    const options = { ...settings, direction };
    const result = generateClimbTunnel(options);
    assertOpenSpine(result);
    const { centerline } = result;
    const last = centerline.at(-1)!;
    if (direction === 'up') assert.ok(last.y < centerline[0].y - 350);
    if (direction === 'down') assert.ok(last.y > centerline[0].y + 350);
    if (direction === 'winding') assert.ok(centerline.some((p, i) => i > 0 && p.x < centerline[i - 1].x));
    assert.deepEqual(result.spawnpoints.map(p => p.team), [1, 5, 6]);
    const bytes = serializePms(createTunnelMap(result, options, header));
    assert.deepEqual(bytes, serializePms(createTunnelMap(generateClimbTunnel(options), options, header)));
    const restored = parsePmsFull(bytes);
    assert.equal(restored.startJet, 0);
    assert.equal(restored.parseWarnings.length, 0);
    assert.ok(restored.sectorsPolys?.some(sector => sector.length));
    assert.ok(restored.polygons.every(p => hasInwardNormals(p) && polygonSignedArea2(...p.vertices) > 0));
    assert.ok(!validateMapDocument(restored).some(issue => issue.severity === 'error' || issue.id.startsWith('spawn_inside_poly_')));
  }
});

test('a hand drawn spiral narrows between coils, stays open through turns, and remains reversible', () => {
  const spiral = Array.from({ length: 180 }, (_, i) => {
    const a = i * 4 * Math.PI / 179, r = 80 + a * 15;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  for (const stroke of [spiral, spiral.slice().reverse()]) {
    const result = generateClimbTunnel(settings, stroke);
    assertOpenSpine(result);
    assert.ok(Math.hypot(result.centerline[0].x - stroke[0].x, result.centerline[0].y - stroke[0].y) < 0.0001);
    assert.ok(result.centerline.some((p, i) => i > 0 && p.y > result.centerline[i - 1].y));
    assert.ok(result.centerline.some((p, i) => i > 0 && p.y < result.centerline[i - 1].y));
    assert.ok(result.stations.some(s => Math.hypot(s.left.x - s.right.x, s.left.y - s.right.y) < settings.clearance * 0.82));
  }
});

test('the switchback is excavated from one mountain: every pair of passages is separated by solid rock', () => {
  const result = generateClimbTunnel({ ...settings, direction: 'winding', length: 'medium' });
  const spans: number[][] = [];
  for (const poly of result.polygons) {
    const hits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = poly.vertices[i], b = poly.vertices[(i + 1) % 3];
      if ((a.x < 0) !== (b.x < 0)) hits.push(a.y - a.x * (b.y - a.y) / (b.x - a.x));
    }
    if (hits.length === 2) spans.push([Math.min(...hits), Math.max(...hits)]);
  }
  const solid: number[][] = [];
  for (const [a, b] of spans.sort((p, q) => p[0] - q[0])) {
    const prev = solid.at(-1);
    if (prev && a < prev[1] + 1e-5) prev[1] = Math.max(prev[1], b);
    else solid.push([a, b]);
  }
  assert.equal(solid.length, 4);
  // A ridge between two passages has room for two standing player bodies.
  assert.ok(solid.every(([top, bottom]) => bottom - top > 28));
  assert.ok(solid.slice(1).every(([top], i) => top - solid[i][1] > 50));
});

test('long waves keep their valleys and endpoints and reduce tessellation to fit the PMS limit', () => {
  const wave = Array.from({ length: 480 }, (_, i) => ({ x: 38 * i - 7000, y: 96 * Math.sin(i / 6) }));
  const result = generateClimbTunnel(settings, wave);
  assert.equal(result.validation.ok, true, result.validation.reason);
  assert.ok(result.polygons.length <= SOLDAT_MAP_LIMITS.maxPolys);
  assert.equal(result.centerline[0].x, wave[0].x);
  assert.equal(result.centerline.at(-1)!.x, wave.at(-1)!.x);
  assert.ok(result.centerline.some(p => p.y > 85) && result.centerline.some(p => p.y < -85));
  assert.ok(result.centerline.every(p => Math.abs(p.y - 96 * Math.sin((p.x + 7000) / 228)) < 7));
});

test('a vertical pencil stroke has attached horizontal holds, safe spawn and a reachable-width central shaft', () => {
  const path = [{ x: 45, y: 470 }, { x: 45, y: -410 }];
  const result = generateClimbTunnel(settings, path);
  assertOpenSpine(result);
  assert.ok(result.footholds.filter(p => p.x < 45).length > 4);
  assert.ok(result.footholds.filter(p => p.x > 45).length > 4);
  assert.ok(result.spawnpoints[0].y > result.spawnpoints[2].y);
});

test('palette, route length, width, difficulty, material and obstacle controls change the emitted map', () => {
  const line = [{ x: 0, y: 0 }, { x: 1700, y: 0 }];
  const base = generateClimbTunnel(settings, line);
  const baseColors = base.polygons.map(p => p.vertices[0].color);
  const first = generateClimbTunnel({ ...settings, length: 'short' });
  const long = generateClimbTunnel({ ...settings, length: 'long' });
  assert.ok(long.centerline.length > first.centerline.length * 1.5);
  for (const palette of Object.keys(TUNNEL_PALETTES) as Array<keyof typeof TUNNEL_PALETTES>) {
    if (palette === settings.palette) continue;
    const styled = generateClimbTunnel({ ...settings, palette }, line);
    assert.deepEqual(styled.stations, base.stations);
    assert.notDeepEqual(styled.background, base.background);
    assert.notDeepEqual(styled.polygons.map(p => p.vertices[0].color), baseColors);
  }
  for (const key of ['deadlyWalls', 'spikes', 'lowCeilings', 'drops', 'ice', 'ramps', 'floatingHazards'] as const) {
    const altered = generateClimbTunnel({ ...settings, [key]: !settings[key] }, line);
    assert.ok(altered.validation.ok, key);
    assert.notDeepEqual(altered.polygons, base.polygons, key);
  }
  for (const change of [{ clearance: 215 }, { roughness: 3 }, { difficulty: 'expert' as const }]) {
    assert.notDeepEqual(generateClimbTunnel({ ...settings, ...change }, line).stations, base.stations);
  }
  const measured = generateClimbTunnel({
    ...settings, deadly: 0, hurt: 0, bounce: 100, spikes: false,
    profile: {
      jumps: [{ gap: 24, rise: 11 }], bounceJumps: [{ gap: 36, rise: 14, rebound: 2.75 }], rebounds: [1.34],
      pairs: 1, measuredMaps: 1, bounceMaps: 1
    }
  }, line);
  const pads = measured.polygons.filter(p => p.polyType === 18);
  assert.ok(pads.length > 0 && pads.every(p => p.bounciness === 2.75));
});

test('unusable strokes fail atomically, without partial terrain or misplaced flags', () => {
  const cases: Array<[TunnelPoint[], string]> = [
    [[{ x: 0, y: 0 }, { x: 5, y: 8 }], 'short'],
    [[{ x: 0, y: 0 }, { x: 220, y: 220 }, { x: 0, y: 220 }, { x: 220, y: 0 }], 'crossing'],
    [[{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 250, y: 6 }, { x: 220, y: 12 }, { x: 0, y: 12 }], 'tight'],
    [[{ x: 0, y: 0 }, { x: 30000, y: 0 }], 'limit'],
    [[{ x: 0, y: 0 }, { x: Infinity, y: 0 }], 'limit'],
  ];
  for (const [path, reason] of cases) {
    const result = generateClimbTunnel(settings, path);
    assert.deepEqual(result.validation, { ok: false, reason, minClearance: 0 });
    assert.equal(result.polygons.length, 0);
    assert.equal(result.spawnpoints.length, 0);
  }
});

test('narrow, rough expert tunnels preserve clearance and honor zero material densities', () => {
  for (const seed of [25, 35, 95, 215]) {
    const options = {
      ...settings, seed, clearance: 80, roughness: 100, difficulty: 'expert' as const,
      spikes: true, floatingHazards: true, ice: false, deadlyWalls: false, deadly: 0, hurt: 0, bounce: 0
    };
    const result = generateClimbTunnel(options);
    assert.ok(result.validation.ok, String(seed));
    assert.ok(result.polygons.every(p => p.polyType === 0));
    const dangerous = generateClimbTunnel({ ...options, deadlyWalls: true });
    assert.ok(dangerous.polygons.some(p => p.polyType === 5));
    assert.deepEqual(dangerous.centerline, result.centerline);
  }
});
