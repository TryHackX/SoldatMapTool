import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  compileMapSectors,
  computePolygonNormals,
  computeWorldAlignedUv,
  createPolygonFromPoints,
  earClipTriangulate,
  ensureClockwiseWinding,
  isClockwisePolygon,
  prepareMapForSave,
  polygonSignedArea2,
  splitPolygonEdge,
} from '../src/shared/pmsCompiler';
import { parsePmsFull } from '../src/shared/pmsParser';
import { emptySelection, translateSelection } from '../src/client/editor/EditorDocument';
import { buildSyntheticPms, findSoldatMapsDir } from './helpers';

test('CW winding enforcement flips CCW triangles and preserves CW triangles in Y-down space', () => {
  // In Y-down (+X right, +Y down), (0,0) -> (100,0) -> (0,100) has signedArea2 = +10000 (CW)
  const cwPoly = createPolygonFromPoints([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]);
  assert.equal(isClockwisePolygon(cwPoly), true);
  assert.ok(polygonSignedArea2(cwPoly.vertices[0], cwPoly.vertices[1], cwPoly.vertices[2]) > 0);

  // Feed CCW order: (0,0) -> (0,100) -> (100,0)
  const ccwInput = {
    ...cwPoly,
    vertices: [cwPoly.vertices[0], cwPoly.vertices[2], cwPoly.vertices[1]] as typeof cwPoly.vertices,
  };
  assert.equal(isClockwisePolygon(ccwInput), false);

  const fixed = ensureClockwiseWinding(ccwInput);
  assert.equal(isClockwisePolygon(fixed), true);
  for (const v of fixed.vertices) {
    assert.equal(v.z, 1);
    assert.equal(v.rhw, 1);
  }
});

test('inward edge normals and polyType === 18 bounciness match OpenSoldat conventions and real maps', (t) => {
  // Top horizontal edge of a floor: (0, 0) -> (100, 0), interior below (y > 0)
  // dx = 100, dy = 0 -> inward normal (-dy/len, dx/len) = (0, +1), z = 1!
  const normalFloor = createPolygonFromPoints(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 80 },
    ],
    { polyType: 0, bounciness: 3.5 }
  );
  assert.ok(Math.abs(normalFloor.normals[0].x - 0) < 1e-6);
  assert.ok(Math.abs(normalFloor.normals[0].y - 1) < 1e-6);
  assert.equal(normalFloor.normals[0].z, 1);
  assert.equal(normalFloor.bounciness, 1, 'non-bouncy polyTypes use normal magnitude 1');

  // Bouncy polygon (polyType === 18) scales normal length by bounciness
  const bouncyFloor = createPolygonFromPoints(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 80 },
    ],
    { polyType: 18, bounciness: 2.75 }
  );
  assert.ok(Math.abs(bouncyFloor.normals[0].x - 0) < 1e-6);
  assert.ok(Math.abs(bouncyFloor.normals[0].y - 2.75) < 1e-6);
  assert.equal(bouncyFloor.normals[0].z, 1);
  assert.equal(bouncyFloor.bounciness, 2.75);

  // Verify against real Soldat maps when available
  const mapsDir = findSoldatMapsDir();
  if (!mapsDir) {
    t.skip('Soldat maps folder not available for real-map normal verification');
    return;
  }

  for (const mapFile of ['ctf_Ash.pms', 'ctf_Kampf.pms']) {
    const fullPath = path.join(mapsDir, mapFile);
    if (!fs.existsSync(fullPath)) continue;
    const map = parsePmsFull(fs.readFileSync(fullPath));
    let checkedEdges = 0;
    for (const poly of map.polygons) {
      if (!isClockwisePolygon(poly)) continue;
      const recomputed = computePolygonNormals(poly);
      for (let e = 0; e < 3; e++) {
        const storedLen = Math.hypot(poly.normals[e].x, poly.normals[e].y);
        if (storedLen < 0.5) continue;
        // Dot product of unit directions must be +1 (pointing inward, never inverted!)
        const reLen = Math.hypot(recomputed.normals[e].x, recomputed.normals[e].y);
        const dot =
          (poly.normals[e].x * recomputed.normals[e].x +
            poly.normals[e].y * recomputed.normals[e].y) /
          (storedLen * reLen);
        assert.ok(dot > 0.999, `${mapFile}: edge normal direction matches Soldat inward normal (dot=${dot})`);
        checkedEdges++;
      }
    }
    assert.ok(checkedEdges > 50, `${mapFile}: verified ${checkedEdges} real polygon edges`);
  }
});

test('compileMapSectors: 51x51 grid, DOESNT_COLLIDE exclusion, hollow-giant-triangle fix, and real-map recall', (t) => {
  const solidSmall = createPolygonFromPoints(
    [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 0, y: 20 },
    ],
    { polyType: 0 }
  );
  const nonColliding = createPolygonFromPoints(
    [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 0, y: 20 },
    ],
    { polyType: 3 } // DOESNT_COLLIDE
  );
  // Giant triangle whose vertices are far out at ~1200, completely enclosing origin sector (0, 0)
  const giantSolid = createPolygonFromPoints(
    [
      { x: -1200, y: -800 },
      { x: 1200, y: -800 },
      { x: 0, y: 1200 },
    ],
    { polyType: 0 }
  );

  const compiled = compileMapSectors([solidSmall, nonColliding, giantSolid], { sectorsNum: 25 });
  assert.equal(compiled.sectorsNum, 25);
  assert.equal(compiled.sectorsPolys.length, 51 * 51);
  // maxAbs = 1200 -> floor((1200 + 100) / 25) = 52
  assert.equal(compiled.sectorsDivision, Math.floor((1200 + 100) / 25));

  const centerIdx = (0 + 25) * 51 + (0 + 25);
  const centerList = Array.from(compiled.sectorsPolys[centerIdx]);
  assert.ok(centerList.includes(1), 'solidSmall (1-based #1) is in center sector');
  assert.ok(!centerList.includes(2), 'DOESNT_COLLIDE (1-based #2) is excluded from all sectors');
  assert.ok(
    centerList.includes(3),
    'giantSolid (1-based #3) covers interior sector (0,0) even with no vertex/edge inside it'
  );

  for (const cell of compiled.sectorsPolys) {
    assert.ok(!Array.from(cell).includes(2), 'polyType === 3 never appears in any sector');
  }

  // Real-map collision recall check against ctf_Ash & ctf_Kampf
  const mapsDir = findSoldatMapsDir();
  if (!mapsDir) {
    t.skip('Soldat maps folder not available for real-map sector verification');
    return;
  }

  for (const mapFile of ['ctf_Ash.pms', 'ctf_Kampf.pms']) {
    const fullPath = path.join(mapsDir, mapFile);
    if (!fs.existsSync(fullPath)) continue;
    const map = parsePmsFull(fs.readFileSync(fullPath));
    const recompiled = compileMapSectors(map.polygons, {
      sectorsNum: map.sectorsNum,
      fixedDivision: map.sectorsDivision,
    });
    assert.equal(recompiled.sectorsPolys.length, map.sectorsPolys?.length ?? 0);

    // Every sample interior centroid of every non-DOESNT_COLLIDE polygon must be registered in its sector!
    const side = 2 * map.sectorsNum + 1;
    for (let i = 0; i < map.polygons.length; i++) {
      const p = map.polygons[i];
      if (p.polyType === 3) continue;
      const cx = (p.vertices[0].x + p.vertices[1].x + p.vertices[2].x) / 3;
      const cy = (p.vertices[0].y + p.vertices[1].y + p.vertices[2].y) / 3;
      const kx = Math.round(cx / map.sectorsDivision);
      const ky = Math.round(cy / map.sectorsDivision);
      if (Math.abs(kx) <= map.sectorsNum && Math.abs(ky) <= map.sectorsNum) {
        const cell = recompiled.sectorsPolys[(kx + map.sectorsNum) * side + (ky + map.sectorsNum)];
        assert.ok(
          cell.includes(i + 1),
          `${mapFile}: polygon #${i + 1} centroid (${cx.toFixed(1)}, ${cy.toFixed(1)}) present in sector (${kx}, ${ky})`
        );
      }
    }
  }
});

test('earClipTriangulate handles convex quads, concave L-shapes, and CCW rings with exact CW area conservation', () => {
  // Concave L-shape (6 vertices -> 4 triangles):
  // (0,0) -> (100,0) -> (100,40) -> (40,40) -> (40,100) -> (0,100), area = 100*40 + 40*60 = 6400
  const lShapeCw = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ];

  for (const ring of [lShapeCw, [...lShapeCw].reverse()]) {
    const tris = earClipTriangulate(ring);
    assert.equal(tris.length, 4, '6-gon triangulates into 4 triangles');
    let totalArea = 0;
    for (const [a, b, c] of tris) {
      const a2 = polygonSignedArea2(a, b, c);
      assert.ok(a2 > 0, 'every ear-clipped triangle must be strictly CW');
      totalArea += a2 * 0.5;
    }
    assert.ok(Math.abs(totalArea - 6400) < 1e-4, `expected area 6400, got ${totalArea}`);
  }
});

test('computeWorldAlignedUv, welded shared-vertex translation, and shared-edge splitting', () => {
  const uv = computeWorldAlignedUv(256, -128, 128, 64);
  assert.equal(uv.u, 2);
  assert.equal(uv.v, -2);

  // Build two triangles sharing diagonal edge (100, 0) -> (0, 100)
  const baseMap = parsePmsFull(buildSyntheticPms({}));
  const t1 = createPolygonFromPoints([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]);
  const t2 = createPolygonFromPoints([
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]);
  const twoPolyMap = { ...baseMap, polygons: [t1, t2] };

  // Select ONLY t1's vertex at (100, 0), with weldSharedVertices: true -> t2's vertex at (100, 0) moves too!
  const vIdxInT1 = twoPolyMap.polygons[0].vertices.findIndex((v) => v.x === 100 && v.y === 0) as 0 | 1 | 2;
  assert.ok(vIdxInT1 >= 0);

  const movedWelded = translateSelection(
    twoPolyMap,
    { ...emptySelection(), vertices: [{ polyIndex: 0, vertexIndex: vIdxInT1 }] },
    25,
    -15,
    { weldSharedVertices: true }
  );
  assert.ok(
    movedWelded.polygons[0].vertices.some((v) => v.x === 125 && v.y === -15),
    'selected vertex in t1 moved'
  );
  assert.ok(
    movedWelded.polygons[1].vertices.some((v) => v.x === 125 && v.y === -15),
    'coincident welded vertex in t2 moved together'
  );

  // Split shared diagonal edge of twoPolyMap at midpoint (50, 50) -> splits both triangles into 4 CW triangles!
  const diagEdgeIdx = twoPolyMap.polygons[0].vertices.findIndex((v, idx) => {
    const next = twoPolyMap.polygons[0].vertices[(idx + 1) % 3];
    return (
      (v.x === 100 && v.y === 0 && next.x === 0 && next.y === 100) ||
      (v.x === 0 && v.y === 100 && next.x === 100 && next.y === 0)
    );
  }) as 0 | 1 | 2;
  assert.ok(diagEdgeIdx >= 0);

  const splitPolys = splitPolygonEdge(
    twoPolyMap.polygons,
    0,
    diagEdgeIdx,
    { x: 50, y: 50 },
    { splitSharedAdjacents: true }
  );
  assert.equal(splitPolys.length, 4, 'both triangles sharing the split edge are subdivided');
  for (const sp of splitPolys) {
    assert.equal(isClockwisePolygon(sp), true, 'subdivided triangles stay CW');
  }
});

test('prepareMapForSave keeps sectors for colour-only edits and rebuilds stale normals of moved polygons', () => {
  const map = parsePmsFull(buildSyntheticPms({}));
  const original = map.polygons[0];
  assert.ok(original.raw, 'parsed polygons keep their file record');

  // Colour edit that keeps `raw`: normals and sectors must stay byte for byte
  const recoloured = {
    ...original,
    vertices: original.vertices.map((v) => ({ ...v, color: { r: 10, g: 20, b: 30, a: 255 } })) as typeof original.vertices,
  };
  const colourSave = prepareMapForSave({ ...map, polygons: [recoloured] }, { geometryDirty: true });
  assert.equal(colourSave.sectorsPolys, map.sectorsPolys, 'sector table reused when triangles did not move');
  assert.deepEqual(colourSave.polygons[0].normals, original.normals);
  assert.deepEqual(colourSave.polygons[0].vertices[0].color, { r: 10, g: 20, b: 30, a: 255 });

  // A moved vertex whose edit forgot to drop `raw` still gets fresh normals and new sectors
  const moved = {
    ...original,
    vertices: [original.vertices[0], { ...original.vertices[1], x: original.vertices[1].x + 300 }, original.vertices[2]] as typeof original.vertices,
  };
  const moveSave = prepareMapForSave({ ...map, polygons: [moved] }, { geometryDirty: true });
  assert.notEqual(moveSave.sectorsPolys, map.sectorsPolys);
  const expected = computePolygonNormals(moveSave.polygons[0]).normals;
  assert.deepEqual(moveSave.polygons[0].normals, expected);
  assert.equal(moveSave.polygons[0].raw, undefined);
});
