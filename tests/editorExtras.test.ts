import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPolygonFromPoints,
  isClockwisePolygon,
  mirrorMapElements,
} from '../src/shared/pmsCompiler';
import { validateMapDocument } from '../src/shared/mapValidator';
import {
  computePropCorners,
  parsePmsFull,
  PmsMapData,
  PmsProp,
  PmsSpawnpoint,
  PmsWaypoint,
} from '../src/shared/pmsParser';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import {
  emptySelection,
  extractSelectionBundle,
  insertElementBundle,
} from '../src/client/editor/EditorDocument';
import { PL } from '../src/client/i18n/pl/index';
import { SoldatMapEditorService } from '../src/server/editorService';
import { GeneratedOutputRegistry } from '../src/server/safeFileWriter';
import { SERVER_PL } from '../src/server/i18nPl';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { buildSyntheticPms } from './helpers';

test('mirrorMapElements: mirror_copy & flip_in_place preserve CW winding, reflect rotated props, swap teams, and remap bot links', () => {
  const base = createMapFromTemplate('empty', { title: 'Mirror Test', texture: 'grass.bmp' });

  // Alpha-bullet polygon (type 10) on the left side of X = 0
  const alphaPoly = createPolygonFromPoints(
    [
      { x: -200, y: 0 },
      { x: -100, y: 0 },
      { x: -100, y: 80 },
    ],
    { polyType: 10 }
  );
  // Charlie-player polygon (type 15)
  const charliePoly = createPolygonFromPoints(
    [
      { x: -240, y: -60 },
      { x: -160, y: -60 },
      { x: -200, y: -10 },
    ],
    { polyType: 15 }
  );

  // Arbitrarily rotated & scaled scenery prop on the left side
  const rotatedProp: PmsProp = {
    index: 0,
    active: true,
    style: 1,
    width: 80,
    height: 40,
    x: -180,
    y: 25,
    rotation: 0.65,
    scaleX: 1.4,
    scaleY: 0.85,
    alpha: 255,
    color: { r: 255, g: 255, b: 255, a: 255 },
    level: 1,
  };

  const spawns: PmsSpawnpoint[] = [
    { index: 0, active: true, x: -150, y: -20, team: 1 }, // Alpha spawn -> Bravo (2)
    { index: 1, active: true, x: -220, y: -20, team: 5 }, // Alpha flag -> Bravo flag (6)
    { index: 2, active: true, x: -190, y: -50, team: 3 }, // Charlie -> Delta (4)
  ];

  const waypoints: PmsWaypoint[] = [
    {
      index: 0,
      active: true,
      id: 1,
      x: -180,
      y: -15,
      left: true,
      right: false,
      up: true,
      down: false,
      jetpack: false,
      pathNum: 1, // Alpha path -> Bravo path (2)
      action: 0,
      connections: [2], // 1-based connection to waypoint #2
    },
    {
      index: 1,
      active: true,
      id: 2,
      x: -90,
      y: -15,
      left: false,
      right: true,
      up: false,
      down: false,
      jetpack: true,
      pathNum: 1,
      action: 1,
      connections: [1],
    },
  ];

  const halfMap: PmsMapData = {
    ...base,
    polygons: [alphaPoly, charliePoly],
    scenery: [{ index: 1, filename: 'crate.png', date: 1, usedCount: 1 }],
    props: [rotatedProp],
    colliders: [{ index: 0, active: true, x: -130, y: 10, radius: 32 }],
    spawnpoints: spawns,
    waypoints,
  };

  // 1. Duplicate & Mirror around X = 0 (CTF Builder workflow)
  const copied = mirrorMapElements(halfMap, {
    mode: 'mirror_copy',
    axisX: 0,
    swapTeams: true,
    mirrorUvs: true,
  });

  assert.equal(copied.nextMap.polygons.length, 4);
  assert.equal(copied.nextMap.props.length, 2);
  assert.equal(copied.nextMap.colliders.length, 2);
  assert.equal(copied.nextMap.spawnpoints.length, 6);
  assert.equal(copied.nextMap.waypoints.length, 4);

  // Every polygon (original + mirrored) must remain strictly clockwise!
  for (const poly of copied.nextMap.polygons) {
    assert.equal(
      isClockwisePolygon(poly),
      true,
      'Mirrored polygon must have clockwise winding'
    );
  }

  // Team polygon swap: 10 -> 12 (Bravo bullets), 15 -> 17 (Delta players)
  assert.equal(copied.nextMap.polygons[2].polyType, 12);
  assert.equal(copied.nextMap.polygons[3].polyType, 17);

  // Horizontal UV mirror check
  const origUs = alphaPoly.vertices.map((v) => -v.u).sort((a, b) => a - b);
  const mirUs = copied.nextMap.polygons[2].vertices.map((v) => v.u).sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(origUs[i] - mirUs[i]) < 1e-6);
  }

  // Exact world-space reflection of rotated scenery prop across X = 0!
  const origCorners = computePropCorners(
    rotatedProp.x,
    rotatedProp.y,
    rotatedProp.width,
    rotatedProp.height,
    rotatedProp.scaleX,
    rotatedProp.scaleY,
    rotatedProp.rotation
  );
  const mirProp = copied.nextMap.props[1];
  const mirCorners = computePropCorners(
    mirProp.x,
    mirProp.y,
    mirProp.width,
    mirProp.height,
    mirProp.scaleX,
    mirProp.scaleY,
    mirProp.rotation
  );
  const origPts = [
    [-origCorners[0], origCorners[1]],
    [-origCorners[2], origCorners[3]],
    [-origCorners[4], origCorners[5]],
    [-origCorners[6], origCorners[7]],
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const mirPts = [
    [mirCorners[0], mirCorners[1]],
    [mirCorners[2], mirCorners[3]],
    [mirCorners[4], mirCorners[5]],
    [mirCorners[6], mirCorners[7]],
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(origPts[i][0] - mirPts[i][0]) < 1e-3, 'Reflected prop corner X matches');
    assert.ok(Math.abs(origPts[i][1] - mirPts[i][1]) < 1e-3, 'Reflected prop corner Y matches');
  }

  // Team spawns & flags swapped on mirrored copies
  assert.equal(copied.nextMap.spawnpoints[3].x, 150);
  assert.equal(copied.nextMap.spawnpoints[3].team, 2); // Bravo spawn
  assert.equal(copied.nextMap.spawnpoints[4].x, 220);
  assert.equal(copied.nextMap.spawnpoints[4].team, 6); // Bravo flag
  assert.equal(copied.nextMap.spawnpoints[5].x, 190);
  assert.equal(copied.nextMap.spawnpoints[5].team, 4); // Delta spawn

  // Mirrored bot waypoints swap left <-> right, path 1 <-> 2, and remap internal connections to #3 <-> #4!
  const wp3 = copied.nextMap.waypoints[2];
  const wp4 = copied.nextMap.waypoints[3];
  assert.equal(wp3.id, 3);
  assert.equal(wp3.x, 180);
  assert.equal(wp3.left, false);
  assert.equal(wp3.right, true);
  assert.equal(wp3.pathNum, 2);
  assert.deepEqual(wp3.connections, [4]);
  assert.equal(wp4.id, 4);
  assert.equal(wp4.left, true);
  assert.equal(wp4.right, false);
  assert.deepEqual(wp4.connections, [3]);

  // 2. Flip in place around custom axis X = 120 without swapping teams
  const flipped = mirrorMapElements(halfMap, {
    mode: 'flip_in_place',
    axisX: 120,
    swapTeams: false,
    mirrorUvs: false,
  });
  assert.equal(flipped.nextMap.polygons.length, 2);
  assert.equal(flipped.nextMap.spawnpoints[0].x, 240 - -150); // 390
  assert.equal(flipped.nextMap.spawnpoints[0].team, 1); // unchanged because swapTeams = false
  assert.equal(flipped.nextMap.colliders[0].x, 240 - -130); // 370
});

test('validateMapDocument detects limits, geometry flaws, missing assets, CTF rules, buried spawns, and narrow soldier passages', () => {
  const base = createMapFromTemplate('empty', { title: 'Validator Test', texture: 'missing_tex.bmp' });

  // 1. Solid left wall [x: -40..0, y: 0..100] (2 CW triangles)
  const leftWallA = createPolygonFromPoints([
    { x: -40, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ]);
  const leftWallB = createPolygonFromPoints([
    { x: -40, y: 0 },
    { x: 0, y: 100 },
    { x: -40, y: 100 },
  ]);

  // 2. Solid right wall at x = 5..45 -> creates a 5.0-unit horizontal gap (< 7-unit SOLDIER_COLLISION width!)
  const rightWallA = createPolygonFromPoints([
    { x: 5, y: 0 },
    { x: 45, y: 0 },
    { x: 45, y: 100 },
  ]);
  const rightWallB = createPolygonFromPoints([
    { x: 5, y: 0 },
    { x: 45, y: 100 },
    { x: 5, y: 100 },
  ]);

  // 3. Duplicate triangle overlapping leftWallA
  const duplicateTri = createPolygonFromPoints([
    { x: -40, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ]);

  // 4. Degenerate near-collinear sliver (area < 1.0)
  const degenerateTri = {
    ...leftWallA,
    vertices: [
      { ...leftWallA.vertices[0], x: 200, y: 200 },
      { ...leftWallA.vertices[1], x: 210, y: 200 },
      { ...leftWallA.vertices[2], x: 205, y: 200.05 },
    ] as typeof leftWallA.vertices,
  };

  // 5. Inverted (CCW) triangle
  const ccwTri = {
    ...leftWallA,
    vertices: [
      { ...leftWallA.vertices[0], x: 300, y: 0 },
      { ...leftWallA.vertices[2], x: 300, y: 60 },
      { ...leftWallA.vertices[1], x: 360, y: 0 },
    ] as typeof leftWallA.vertices,
  };

  // 6. Giant 2D solid triangle spanning almost the entire [-500..500] x [-500..500] sector grid
  const giantTri = createPolygonFromPoints([
    { x: -500, y: -500 },
    { x: 500, y: -500 },
    { x: 500, y: 500 },
  ]);

  const problemMap: PmsMapData = {
    ...base,
    polygons: [
      leftWallA,
      leftWallB,
      rightWallA,
      rightWallB,
      duplicateTri,
      degenerateTri,
      ccwTri,
      giantTri,
    ],
    scenery: [{ index: 1, filename: 'missing_bush.png', date: 1, usedCount: 1 }],
    props: [
      {
        index: 0,
        active: true,
        style: 1,
        width: 64,
        height: 64,
        x: 100,
        y: 20,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        alpha: 255,
        color: { r: 255, g: 255, b: 255, a: 255 },
        level: 1,
      },
    ],
    spawnpoints: [
      // Alpha spawn standing cleanly in air -> valid
      { index: 0, active: true, x: -120, y: -30, team: 1 },
      // Alpha flag present, Bravo flag & Bravo spawn intentionally missing!
      { index: 1, active: true, x: -150, y: -30, team: 5 },
      // Buried spawn strictly inside leftWallB (-40..0, 0..100)!
      { index: 2, active: true, x: -25, y: 75, team: 1 },
    ],
  };

  const options = {
    knownTexturesLower: new Set(['grass.bmp', 'stone.png']),
    knownSceneriesLower: new Set(['crate.png', 'fern.bmp']),
    mapBaseName: 'ctf_broken',
  };
  const issues = validateMapDocument(problemMap, options);
  const byId = new Map(issues.map((i) => [i.id, i]));

  assert.ok(byId.has('missing_main_texture'), 'Flags missing main texture');
  assert.deepEqual(byId.get('missing_scenery_0')?.selection?.props, [0], 'Flags missing scenery file');
  assert.ok(byId.has('ctf_missing_bravo_flag'), 'Flags missing Bravo flag on CTF map');
  assert.ok(byId.has('ctf_missing_bravo_spawn'), 'Flags missing Bravo spawn on CTF map');
  // Repeating polygon problems are grouped, with a fix that covers all of them
  assert.deepEqual(byId.get('poly_degenerate')?.fix, { kind: 'delete_polygons', polygons: [5] });
  assert.equal(byId.get('poly_degenerate')?.severity, 'hint');
  // Collision is judged by the stored normals (the triangle at #7 carries normals from another triangle)
  assert.deepEqual(byId.get('poly_normals')?.fix, { kind: 'repair_normals', polygons: [6] });
  assert.equal(byId.get('poly_normals')?.severity, 'warning');
  assert.deepEqual(byId.get('poly_dup')?.fix, { kind: 'delete_polygons', polygons: [4] }, 'only the later copy');
  assert.ok(byId.has('poly_giant'), 'Flags giant multi-sector 2D triangle');
  assert.ok(byId.has('spawn_inside_poly_2'), 'Flags spawn #3 buried inside solid polygon while ignoring air spawn #1');
  assert.ok(![...byId.keys()].some((id) => id.startsWith('narrow_passage_')), 'gap hints only on request');
  const withHints = validateMapDocument(problemMap, { ...options, includeHints: true });
  const gaps = withHints.filter((i) => i.id.startsWith('narrow_passage_'));
  assert.ok(gaps.length > 0, 'Flags 5.0-unit narrow horizontal passage (< 7-unit soldier width)');
  assert.ok(gaps.every((i) => i.severity === 'hint'));
  assert.equal(new Set(withHints.map((i) => i.id)).size, withHints.length, 'issue ids are unique (React keys)');

  // A recoloured copy is deliberate layering, not a duplicate
  const layered = {
    ...problemMap,
    polygons: problemMap.polygons.map((p, i) =>
      i === 4 ? { ...p, vertices: p.vertices.map((v) => ({ ...v, color: { ...v.color, r: 10 } })) as typeof p.vertices } : p
    ),
  };
  assert.ok(!validateMapDocument(layered, options).some((i) => i.id === 'poly_dup'));

  // Verify that widening the wall passage to 16 units clears narrow_passage_* and starter CTF template passes 100%!
  const healthyCtf = createMapFromTemplate('ctf_symmetric', {
    title: 'Healthy CTF',
    texture: 'grass.bmp',
  });
  const healthyIssues = validateMapDocument(healthyCtf, {
    knownTexturesLower: new Set(['grass.bmp']),
    knownSceneriesLower: new Set(['crate.png']),
    mapBaseName: 'ctf_healthy',
  });
  assert.deepEqual(healthyIssues, [], 'CTF starter template passes all validation checks with 0 issues');
});

test('SoldatMapEditorService: Prefabs CRUD and cross-map bundle instantiation', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-editor-prefabs-'));
  try {
    const soldatRoot = path.join(baseDir, 'Soldat');
    const mapsDir = path.join(soldatRoot, 'maps');
    const exportsDir = path.join(baseDir, 'exports');
    const dataDir = path.join(baseDir, 'data');
    const cacheDir = path.join(dataDir, 'cache');
    const thumbsDir = path.join(cacheDir, 'thumbnails');
    const backupsDir = path.join(dataDir, 'backups');
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.mkdirSync(thumbsDir, { recursive: true });

    const scanner = new SoldatMapScanner(soldatRoot, [], [], cacheDir, thumbsDir);
    await scanner.scanAsync(true);
    const registry = new GeneratedOutputRegistry(path.join(dataDir, 'generated-outputs.json'));
    const service = new SoldatMapEditorService(scanner, exportsDir, dataDir, backupsDir, registry);

    assert.deepEqual(service.listPrefabs(), []);

    const srcMap = parsePmsFull(
      buildSyntheticPms({ props: 1, scenery: ['bunker.png'], colliders: 1, spawns: 1 })
    );
    const extracted = extractSelectionBundle(srcMap, {
      ...emptySelection(),
      polygons: [0],
      props: [0],
      colliders: [0],
      spawns: [0],
    });
    assert.ok(extracted);

    // Create prefab
    const saved = service.savePrefab({
      name: 'Alpha Bunker',
      bounds: extracted.bounds,
      bundle: extracted.bundle,
    });
    assert.equal(saved.name, 'Alpha Bunker');
    assert.equal(service.listPrefabs().length, 1);

    // Update existing prefab by id
    const updated = service.savePrefab({
      id: saved.id,
      name: 'Alpha Bunker v2',
      bounds: extracted.bounds,
      bundle: extracted.bundle,
    });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.name, 'Alpha Bunker v2');
    assert.equal(service.listPrefabs().length, 1);

    // Stamp prefab onto a blank map
    const targetBlank = createMapFromTemplate('empty', { title: 'Target', texture: 'grass.bmp' });
    const stamped = insertElementBundle(targetBlank, updated.bundle, updated.bounds, 250, -80);
    assert.equal(stamped.nextMap.polygons.length, 1);
    assert.equal(stamped.nextMap.props.length, 1);
    assert.equal(stamped.nextMap.scenery[0].filename, 'bunker.png');
    assert.equal(stamped.nextMap.colliders.length, 1);
    assert.equal(stamped.nextMap.spawnpoints.length, 1);

    // Delete prefab
    service.deletePrefab(saved.id);
    assert.deepEqual(service.listPrefabs(), []);
  } finally {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Ignore Windows temp lock
    }
  }
});

test('i18n completeness audit: every Map Editor UI string, validator key, template string & server error has a Polish translation', () => {
  function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walkTsFiles(full));
      else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
    }
    return out;
  }

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const clientFiles = [
    ...walkTsFiles(path.join(rootDir, 'src/client/editor')),
    path.join(rootDir, 'src/shared/mapValidator.ts'),
    path.join(rootDir, 'src/shared/pmsCompiler.ts'),
    path.join(rootDir, 'src/shared/editorTemplates.ts'),
  ];

  const missingClient: string[] = [];
  const singlePatterns = [
    /\b(?:t|tr)\(\s*'((?:\\'|[^'])+)'/g,
    /\b(?:messageKey|labelEn|hintEn|nameEn|descriptionEn)\s*:\s*'((?:\\'|[^'])+)'/g,
    /\bcommitMutation\(\s*'((?:\\'|[^'])+)'/g,
    /\blabel\s*:\s*'((?:\\'|[^'])+)'/g,
  ];

  for (const file of clientFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    for (const re of singlePatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const key = m[1]?.replace(/\\'/g, "'");
        if (key && !(key in PL)) {
          missingClient.push(`${rel}: ${JSON.stringify(key)}`);
        }
      }
    }
    // messageKey chosen by a condition (`messageKey: n === 1 ? 'one…' : 'many…'`): every literal up to the next field
    let mk = src.indexOf('messageKey:');
    while (mk >= 0) {
      const end = src.slice(mk).search(/\n\s*(messageParams|selection|fix|focusBounds|focusPoint)\b|\n\s*\}/);
      const chunk = src.slice(mk, end > 0 ? mk + end : mk + 400);
      for (const lit of chunk.matchAll(/'((?:\\'|[^'])+)'/g)) {
        const key = lit[1].replace(/\\'/g, "'");
        if (!(key in PL)) missingClient.push(`${rel}: ${JSON.stringify(key)}`);
      }
      mk = src.indexOf('messageKey:', mk + 11);
    }
    const tpRe = /\btp\(\s*[^,]+,\s*'((?:\\'|[^'])+)'\s*,\s*'((?:\\'|[^'])+)'/g;
    let tm: RegExpExecArray | null;
    while ((tm = tpRe.exec(src)) !== null) {
      const pairKey = `${tm[1].replace(/\\'/g, "'")}|${tm[2].replace(/\\'/g, "'")}`;
      if (!(pairKey in PL)) {
        missingClient.push(`${rel}: tp(${JSON.stringify(pairKey)})`);
      }
    }
  }

  assert.deepEqual(
    missingClient,
    [],
    `Missing client Polish translations:\n${missingClient.join('\n')}`
  );

  const serverFile = path.join(rootDir, 'src/server/editorService.ts');
  const serverSrc = fs.readFileSync(serverFile, 'utf8');
  const missingServer: string[] = [];
  const serverRe = /\bt\(\s*(?:req\s*,\s*)?'((?:\\'|[^'])+)'/g;
  let sm: RegExpExecArray | null;
  while ((sm = serverRe.exec(serverSrc)) !== null) {
    const key = sm[1].replace(/\\'/g, "'");
    if (!(key in SERVER_PL)) {
      missingServer.push(JSON.stringify(key));
    }
  }

  assert.deepEqual(
    missingServer,
    [],
    `Missing server Polish translations in editorService.ts:\n${missingServer.join('\n')}`
  );
});
