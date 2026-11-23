import assert from 'node:assert/strict';
import test from 'node:test';
import { findTunnelVariant, type TunnelVariantProgress, type TunnelVariantRequest } from '../src/client/editor/tunnelVariant';
import { runTunnelTrial } from '../src/client/editor/tunnelTrial';
import { createDraftTrialMap } from '../src/client/editor/tunnelBlueprint';
import { createTunnelMap, DEFAULT_TUNNEL, generateClimbTunnel } from '../src/shared/climbTunnel';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { parsePmsFull, serializePms, SOLDAT_MAP_LIMITS } from '../src/shared/pmsParser';

const settings = { ...DEFAULT_TUNNEL, seed: 42 };
const path = [{ x: -170, y: 0 }, { x: 170, y: 0 }];

test('automatic variants stop at the first physical completion, reproducible from the offered seed alone', () => {
  const request: TunnelVariantRequest = { kind: 'find-variant', settings: { ...settings, direction: 'winding' } };
  const progress: TunnelVariantProgress[] = [];
  const result = findTunnelVariant(request, e => progress.push(e));
  assert.ok(result.trial?.reached && result.seed !== undefined);
  assert.equal(result.attempted, progress.length);
  assert.equal(result.seed, progress.at(-1)!.seed);
  for (const [i, event] of progress.entries()) {
    const candidate = { ...request.settings, seed: event.seed };
    const draft = generateClimbTunnel(candidate);
    const exported = serializePms(createTunnelMap(draft, candidate, { title: 'Replay', texture: 'default.bmp' }));
    const replay = runTunnelTrial(parsePmsFull(exported), draft.centerline, draft.footholds);
    assert.equal(replay.reached, i === progress.length - 1);
    if (replay.reached) assert.deepEqual(result.trial, replay);
  }
});

test('drawn variants retain the stroke and options and test the actual existing polygons and colliders', () => {
  const contextMap = createMapFromTemplate('empty');
  const request: TunnelVariantRequest = { kind: 'find-variant', settings, path, contextMap };
  const original = structuredClone(request);
  const offered = findTunnelVariant(request);
  assert.ok(offered.trial?.reached && offered.seed !== undefined);
  const candidate = { ...settings, seed: offered.seed };
  const draft = generateClimbTunnel(candidate, path);
  const map = createTunnelMap(draft, candidate, { title: 'Stroke replay', texture: 'default.bmp' });
  assert.deepEqual(runTunnelTrial(parsePmsFull(serializePms(map)), draft.centerline, draft.footholds), offered.trial);
  assert.deepEqual(original, request);

  const failures = [
    { ...contextMap, polygons: makeQuadPolys(-8, -450, 8, 450) },
    { ...contextMap, colliders: [{ index: 0, x: 0, y: 0, radius: 180, active: true }] },
  ];
  for (const obstacle of failures) {
    const progress: TunnelVariantProgress[] = [];
    const exhausted = findTunnelVariant({ ...request, contextMap: obstacle }, e => progress.push(e));
    assert.deepEqual(exhausted, { kind: 'variant-result', attempted: 4 });
    assert.deepEqual(progress.map(e => e.attempted), [1, 2, 3, 4]);
    assert.ok(progress.every(e => e.total === 4 && e.seed !== settings.seed));
    assert.equal(new Set(progress.map(e => e.seed)).size, 4);
  }
});

test('a sketch trial uses the fuel saved by insertion, existing terrain and its own endpoints', () => {
  const draft = generateClimbTunnel(settings, path);
  const blank = { ...createMapFromTemplate('empty'), startJet: 99 };
  assert.equal(createDraftTrialMap(draft, settings, blank)!.startJet, 0);
  const oldFlags = [{ x: -2400, y: -80, team: 6, active: true, index: 0 }];
  const occupied = { ...blank, spawnpoints: oldFlags, polygons: makeQuadPolys(-1500, 150, -1100, 180) };
  const prepared = createDraftTrialMap(draft, settings, occupied, false)!;
  const saved = parsePmsFull(serializePms(prepared));
  assert.equal(saved.startJet, 99);
  assert.equal(saved.startJetGame, Math.floor(119 * 99 / 100));
  assert.equal(saved.polygons.length, occupied.polygons.length + draft.polygons.length);
  assert.deepEqual(saved.spawnpoints.map(({team,x,y}) => ({team,x,y})),
    draft.spawnpoints.map(({team,x,y}) => ({team,x,y})));
  assert.equal(occupied.spawnpoints, oldFlags);
});

test('candidate limits include the existing map and only count new markers when inserting them', () => {
  const map = createMapFromTemplate('empty');
  const request: TunnelVariantRequest = { kind: 'find-variant', settings, path, contextMap: map };
  const spawn = { x: -1100, y: 20, team: 1, active: true, index: 0 };
  map.spawnpoints = Array(SOLDAT_MAP_LIMITS.maxSpawnpoints).fill(spawn);
  assert.ok(findTunnelVariant({ ...request, markers: false }).trial?.reached);
  assert.equal(findTunnelVariant({ ...request, markers: true }).seed, undefined);
  const [poly] = makeQuadPolys(-1200, 0, -1100, 10);
  map.polygons = Array(SOLDAT_MAP_LIMITS.maxPolys).fill(poly);
  assert.equal(findTunnelVariant({ ...request, markers: false }).seed, undefined);
});

test('an invalid stroke consumes at most four distinct legal seeds without replacing the drawing', () => {
  for (const seed of [0, 2147483647]) {
    const events: TunnelVariantProgress[] = [];
    const request: TunnelVariantRequest = { kind: 'find-variant', settings: { ...settings, seed }, path: [] };
    assert.deepEqual(findTunnelVariant(request, e => events.push(e)), { kind: 'variant-result', attempted: 4 });
    assert.equal(new Set([seed, ...events.map(e => e.seed)]).size, 5);
    assert.ok(events.every(e => Number.isInteger(e.seed) && e.seed >= 0 && e.seed <= 2147483647));
    const replay: TunnelVariantProgress[] = [];
    findTunnelVariant(request, e => replay.push(e));
    assert.deepEqual(events, replay);
  }
});
