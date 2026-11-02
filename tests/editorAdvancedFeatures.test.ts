import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freehandLaserToPolygons,
  previewLaserContour,
  traceImageToPolygons,
  untangleClosedContour,
} from '../src/shared/imageTracer.js';
import { polygonSignedArea2 } from '../src/shared/pmsCompiler.js';
import { computePropCorners, PmsMapData, PmsProp } from '../src/shared/pmsParser.js';
import {
  applyDirectionalReliefShading,
  generateProceduralIsland,
  generateSurfaceCrust,
  subdividePolygons,
} from '../src/shared/terrainGenerator.js';
import { stretchSinglePropLocal } from '../src/client/editor/EditorDocument.js';
import {
  createSoldierPlaytestState,
  doesPolyCollideSoldier,
  stepSoldierPlaytest,
} from '../src/client/editor/soldierPlaytest.js';
import { EditorSpatialIndex } from '../src/client/editor/spatialIndex.js';

test('Laser / Freehand Polygon Drawing: untangles crossings and produces valid CW triangles with depth shading', () => {
  // Figure-8 with intentional crossing
  const figure8 = [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 0 },
    { x: 50, y: 0 },
    { x: 0, y: 50 },
  ];

  const preview = previewLaserContour(figure8, 4, 0);
  assert.ok(preview.length >= 3, 'Preview contour should have at least 3 points');

  const polys = freehandLaserToPolygons(figure8, {
    detailEpsilon: 2,
    polyType: 0,
    color: { r: 200, g: 200, b: 200, a: 255 },
    autoShadeDepth: true,
  });

  assert.ok(polys.length > 0, 'Should triangulate figure-8 into polygons');
  for (const poly of polys) {
    const area = polygonSignedArea2(poly.vertices[0], poly.vertices[1], poly.vertices[2]);
    assert.ok(area > 0, `Each triangle must have positive signed area in Y-down space (was ${area})`);
    // Check that autoShadeDepth produced valid RGBA colors
    for (const v of poly.vertices) {
      assert.ok(v.color.r >= 0 && v.color.r <= 255);
      assert.ok(v.color.g >= 0 && v.color.g <= 255);
      assert.ok(v.color.b >= 0 && v.color.b <= 255);
    }
  }
});

test('Image-to-Polygons Vectorizer: extracts clockwise polygons from bitmap, ignores #00FF00, and samples colors', () => {
  const width = 32;
  const height = 32;
  const rgba = new Uint8ClampedArray(width * height * 4);

  // Fill background with #00FF00 (Soldat color key)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = 0;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 255;
  }

  // Draw a solid blue square in the middle (x: 8..23, y: 8..23)
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      const idx = (y * width + x) * 4;
      rgba[idx + 0] = 30;
      rgba[idx + 1] = 120;
      rgba[idx + 2] = 240;
      rgba[idx + 3] = 255;
    }
  }

  const result = traceImageToPolygons(rgba, width, height, {
    mode: 'alpha',
    threshold: 128,
    treatLimeAsTransparent: true,
    worldScale: 2,
    centerX: 100,
    centerY: 100,
    sampleImageColors: true,
  });

  assert.ok(result.islandCount >= 1, 'Should find at least 1 island');
  assert.ok(result.polygons.length >= 2, 'Square should triangulate into at least 2 triangles');

  for (const poly of result.polygons) {
    const area = polygonSignedArea2(poly.vertices[0], poly.vertices[1], poly.vertices[2]);
    assert.ok(area > 0, `Traced triangle must be clockwise (was ${area})`);
    // Vertex color sampling should sample the blue hue (r < 100, b > 150)
    for (const v of poly.vertices) {
      assert.ok(v.color.b > v.color.r, 'Vertex color should preserve sampled blue tone');
    }
  }
});

test('Procedural Surface Crust: extrudes top walkable surface crust on polygons', () => {
  // Create a simple floor rectangle (2 triangles)
  // (0, 100) -> (200, 100) -> (200, 150) -> (0, 150)
  const map: PmsMapData = {
    version: 1,
    mapName: 'Test',
    texture: 'grass.bmp',
    bgColorTop: { r: 0, g: 0, b: 0, a: 255 },
    bgColorBtm: { r: 0, g: 0, b: 0, a: 255 },
    startJet: 100,
    startJetGame: 120,
    grenadePacks: 1,
    medikits: 1,
    weather: 0,
    steps: 0,
    randomId: 1,
    polygons: [
      {
        vertices: [
          { x: 0, y: 100, z: 1, rhw: 1, u: 0, v: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
          { x: 200, y: 100, z: 1, rhw: 1, u: 1, v: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
          { x: 200, y: 150, z: 1, rhw: 1, u: 1, v: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
        ],
        normals: [
          { x: 0, y: -1, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: -0.707, y: 0.707, z: 0 },
        ],
        polyType: 0,
        bounciness: 1,
      },
      {
        vertices: [
          { x: 0, y: 100, z: 1, rhw: 1, u: 0, v: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
          { x: 200, y: 150, z: 1, rhw: 1, u: 1, v: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
          { x: 0, y: 150, z: 1, rhw: 1, u: 0, v: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
        ],
        normals: [
          { x: 0.707, y: -0.707, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: -1, y: 0, z: 0 },
        ],
        polyType: 0,
        bounciness: 1,
      },
    ],
    sectorsDivision: 128,
    sectorsNum: 25,
    props: [],
    scenery: [],
    colliders: [],
    spawnpoints: [],
    waypoints: [],
    polyBounds: { left: 0, right: 200, top: 100, bottom: 150, width: 200, height: 50 },
    fullBounds: { left: 0, right: 200, top: 100, bottom: 150, width: 200, height: 50 },
    crc32: 0,
    parseWarnings: [],
  };

  const crust = generateSurfaceCrust(map, [0, 1], {
    thickness: 10,
    outwardOffset: 3,
    topColor: { r: 90, g: 200, b: 70, a: 255 },
    bottomColor: { r: 40, g: 100, b: 30, a: 255 },
  });

  assert.ok(crust.length >= 2, 'Should extrude crust along the top edge (0,100)->(200,100)');
  for (const tri of crust) {
    const area = polygonSignedArea2(tri.vertices[0], tri.vertices[1], tri.vertices[2]);
    assert.ok(area > 0, `Crust triangle must be clockwise (was ${area})`);
    // Check that vertices sit above the floor (y < 100 since outwardOffset = 3 in Y-down space)
    const hasTopVert = tri.vertices.some((v) => v.y < 100);
    assert.ok(hasTopVert, 'Top edge of crust should extend upward into air');
  }
});

test('Procedural Island Generator & Directional Relief: generates deterministic CW rock cluster and shades vertices', () => {
  const island = generateProceduralIsland({
    centerX: 300,
    centerY: 200,
    width: 250,
    height: 120,
    segments: 16,
    roughness: 0.3,
    seed: 42,
    flatTop: true,
    addGrassCrust: true,
  });

  assert.ok(island.length >= 14, 'Island with crust should contain multiple triangles');
  for (const tri of island) {
    const area = polygonSignedArea2(tri.vertices[0], tri.vertices[1], tri.vertices[2]);
    assert.ok(area > 0, `Island triangle must be clockwise (was ${area})`);
  }

  // Test relief shading on the island
  const dummyMap: PmsMapData = {
    version: 1,
    mapName: 'Test',
    texture: 'grass.bmp',
    bgColorTop: { r: 0, g: 0, b: 0, a: 255 },
    bgColorBtm: { r: 0, g: 0, b: 0, a: 255 },
    startJet: 100,
    startJetGame: 120,
    grenadePacks: 1,
    medikits: 1,
    weather: 0,
    steps: 0,
    randomId: 1,
    polygons: island,
    sectorsDivision: 128,
    sectorsNum: 25,
    props: [],
    scenery: [],
    colliders: [],
    spawnpoints: [],
    waypoints: [],
    polyBounds: { left: 100, right: 500, top: 100, bottom: 400, width: 400, height: 300 },
    fullBounds: { left: 100, right: 500, top: 100, bottom: 400, width: 400, height: 300 },
    crc32: 0,
    parseWarnings: [],
  };

  const shaded = applyDirectionalReliefShading(dummyMap, island.map((_, i) => i), {
    sunAngleDeg: -60,
    contrast: 0.5,
  });

  assert.equal(shaded.polygons.length, island.length);
  // Vertices should remain within valid 0..255 bounds
  for (const tri of shaded.polygons) {
    for (const v of tri.vertices) {
      assert.ok(v.color.r >= 0 && v.color.r <= 255);
      assert.ok(v.color.g >= 0 && v.color.g <= 255);
      assert.ok(v.color.b >= 0 && v.color.b <= 255);
    }
  }
});

test('Polygon Subdivision: 1 -> 4 subdivision preserves total area and clockwise winding', () => {
  const v0 = { x: 0, y: 0, z: 1, rhw: 1, u: 0, v: 0, color: { r: 255, g: 0, b: 0, a: 255 } };
  const v1 = { x: 100, y: 0, z: 1, rhw: 1, u: 1, v: 0, color: { r: 0, g: 255, b: 0, a: 255 } };
  const v2 = { x: 50, y: 80, z: 1, rhw: 1, u: 0.5, v: 1, color: { r: 0, g: 0, b: 255, a: 255 } };

  const map: PmsMapData = {
    version: 1,
    mapName: 'Test',
    texture: 'grass.bmp',
    bgColorTop: { r: 0, g: 0, b: 0, a: 255 },
    bgColorBtm: { r: 0, g: 0, b: 0, a: 255 },
    startJet: 100,
    startJetGame: 120,
    grenadePacks: 1,
    medikits: 1,
    weather: 0,
    steps: 0,
    randomId: 1,
    polygons: [
      {
        vertices: [v0, v1, v2],
        normals: [{ x: 0, y: -1, z: 0 }, { x: 0.8, y: 0.6, z: 0 }, { x: -0.8, y: 0.6, z: 0 }],
        polyType: 0,
        bounciness: 1,
      },
    ],
    sectorsDivision: 128,
    sectorsNum: 25,
    props: [],
    scenery: [],
    colliders: [],
    spawnpoints: [],
    waypoints: [],
    polyBounds: { left: 0, right: 100, top: 0, bottom: 80, width: 100, height: 80 },
    fullBounds: { left: 0, right: 100, top: 0, bottom: 80, width: 100, height: 80 },
    crc32: 0,
    parseWarnings: [],
  };

  const origArea = polygonSignedArea2(v0, v1, v2);
  const { nextMap, newIndices } = subdividePolygons(map, [0]);

  assert.equal(nextMap.polygons.length, 4);
  assert.equal(newIndices.length, 4);

  let subAreaSum = 0;
  for (const tri of nextMap.polygons) {
    const area = polygonSignedArea2(tri.vertices[0], tri.vertices[1], tri.vertices[2]);
    assert.ok(area > 0, `Subdivided triangle must be CW (was ${area})`);
    subAreaSum += area;
  }

  assert.ok(
    Math.abs(subAreaSum - origArea) < 1e-4,
    `Sum of subdivided triangles (${subAreaSum}) must equal original triangle area (${origArea})`
  );
});

test('Interactive Scenery Studio: stretchSinglePropLocal keeps opposite anchor fixed on rotated props', () => {
  const origProp: PmsProp = {
    index: 0,
    active: true,
    style: 1,
    width: 100,
    height: 60,
    x: 200,
    y: 150,
    rotation: 0.65, // ~37 degrees
    scaleX: 1.5,
    scaleY: 1.2,
    alpha: 255,
    color: { r: 255, g: 255, b: 255, a: 255 },
    level: 1,
  };

  const origCorners = computePropCorners(
    origProp.x,
    origProp.y,
    origProp.width,
    origProp.height,
    origProp.scaleX,
    origProp.scaleY,
    origProp.rotation
  );
  // origCorners order: top-left (0,1), top-right (2,3), bottom-right (4,5), bottom-left (6,7)
  const origTopLeft = { x: origCorners[0], y: origCorners[1] };
  const origBottomRight = { x: origCorners[4], y: origCorners[5] };

  // Dragging 'scale_se' (bottom-right) handle outward should anchor the opposite 'nw' (top-left) corner
  const stretched = stretchSinglePropLocal(
    origProp,
    'scale_se',
    origBottomRight.x + 30,
    origBottomRight.y + 20,
    false
  );

  const newCorners = computePropCorners(
    stretched.x,
    stretched.y,
    stretched.width,
    stretched.height,
    stretched.scaleX,
    stretched.scaleY,
    stretched.rotation
  );
  const newTopLeft = { x: newCorners[0], y: newCorners[1] };

  const anchorDrift = Math.hypot(newTopLeft.x - origTopLeft.x, newTopLeft.y - origTopLeft.y);
  assert.ok(
    anchorDrift < 1e-4,
    `Opposite anchor corner must not move during local stretch (drifted by ${anchorDrift})`
  );
  assert.ok(stretched.scaleX > origProp.scaleX, 'scaleX should have increased');
  assert.ok(stretched.scaleY > origProp.scaleY, 'scaleY should have increased');
});

test('Soldier Playtest Physics: gravity, solid floor landing, jump, and jetpack thrust', () => {
  // Flat floor at y = 100
  const floorPoly = {
    vertices: [
      { x: -200, y: 100, z: 1, rhw: 1, u: 0, v: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
      { x: 200, y: 100, z: 1, rhw: 1, u: 1, v: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
      { x: 200, y: 120, z: 1, rhw: 1, u: 1, v: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ] as [any, any, any],
    normals: [{ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: -0.707, y: 0.707, z: 0 }] as [any, any, any],
    polyType: 0,
    bounciness: 1,
  };

  const map: PmsMapData = {
    version: 1,
    mapName: 'PlaytestTest',
    texture: 'grass.bmp',
    bgColorTop: { r: 0, g: 0, b: 0, a: 255 },
    bgColorBtm: { r: 0, g: 0, b: 0, a: 255 },
    startJet: 100,
    startJetGame: 120,
    grenadePacks: 1,
    medikits: 1,
    weather: 0,
    steps: 0,
    randomId: 1,
    polygons: [floorPoly],
    sectorsDivision: 128,
    sectorsNum: 25,
    props: [],
    scenery: [],
    colliders: [],
    spawnpoints: [],
    waypoints: [],
    polyBounds: { left: -200, right: 200, top: 100, bottom: 120, width: 400, height: 20 },
    fullBounds: { left: -200, right: 200, top: 100, bottom: 120, width: 400, height: 20 },
    crc32: 0,
    parseWarnings: [],
  };

  const spatialIndex = new EditorSpatialIndex(map);

  // Spawn soldier in air at (0, 70)
  let soldier = createSoldierPlaytestState(0, 70, map, 1, false);
  assert.equal(soldier.grounded, false);
  assert.equal(soldier.jetFuel, 120);

  const noInput = { left: false, right: false, jump: false, crouch: false, jetpack: false };

  // Step 40 ticks with gravity to fall onto floor
  for (let i = 0; i < 40; i++) {
    soldier = stepSoldierPlaytest(soldier, noInput, map, spatialIndex);
  }

  assert.equal(soldier.grounded, true, 'Soldier should have landed on the floor');
  // Capsule height is 14 (spineHalf = 3.5, radius = 3.5), feet sphere touches y = 100, so center y is ~93
  assert.ok(soldier.y > 88 && soldier.y < 98, `Soldier center Y should be near ~93 (was ${soldier.y})`);

  // Jump
  const jumpInput = { ...noInput, jump: true };
  soldier = stepSoldierPlaytest(soldier, jumpInput, map, spatialIndex);
  assert.ok(soldier.vy < -1, 'Jump should give upward negative vertical velocity');
  assert.equal(soldier.grounded, false, 'Soldier should become airborne after jumping');

  // Jetpack
  const jetInput = { ...noInput, jetpack: true };
  const prevFuel = soldier.jetFuel;
  soldier = stepSoldierPlaytest(soldier, jetInput, map, spatialIndex);
  assert.ok(soldier.jetFuel < prevFuel, 'Jetpack should consume fuel');
  assert.equal(soldier.jetpacking, true, 'Jetpack flag should be active');
});

test('Soldier Playtest Team Collision: filters team-only and flag-only barrier polygons', () => {
  // Team 1 (Alpha) barrier polyType 11 collides only for team 1
  assert.equal(doesPolyCollideSoldier(11, 1, false), true);
  assert.equal(doesPolyCollideSoldier(11, 2, false), false);

  // Team 2 (Bravo) barrier polyType 13 collides only for team 2
  assert.equal(doesPolyCollideSoldier(13, 2, false), true);
  assert.equal(doesPolyCollideSoldier(13, 1, false), false);

  // Flagger barrier polyType 21 collides only when carryingFlag is true
  assert.equal(doesPolyCollideSoldier(21, 1, true), true);
  assert.equal(doesPolyCollideSoldier(21, 1, false), false);

  // Non-flagger barrier polyType 22 collides only when carryingFlag is false
  assert.equal(doesPolyCollideSoldier(22, 1, false), true);
  assert.equal(doesPolyCollideSoldier(22, 1, true), false);

  // Non-solid polygon types (1, 3, 23, 24, 25) do not collide
  assert.equal(doesPolyCollideSoldier(1, 1, false), false);
  assert.equal(doesPolyCollideSoldier(3, 1, false), false);
  assert.equal(doesPolyCollideSoldier(24, 1, false), false);
});
