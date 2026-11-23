import test from 'node:test';
import assert from 'node:assert/strict';
import { dragShapeOutline, type ShapeOrientation } from '../src/client/editor/dragShapes';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { createPolygonFromPoints, earClipTriangulate, hasInwardNormals, polygonSignedArea2, prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';

const start = { x: -50, y: 10 }, end = { x: 30, y: 40 };
const orientations: ShapeOrientation[] = ['drag', 0, 1, 2, 3];

test('drag shapes preserve their physical bounds and material when triangulated and saved to PMS', () => {
  for (const mode of ['rect', 'ramp', 'spike'] as const) {
    for (const orientation of orientations) {
      const outline = dragShapeOutline(mode, start, end, orientation);
      const tris = earClipTriangulate(outline);
      assert.equal(tris.length, mode === 'rect' ? 2 : 1);
      assert.equal(tris.reduce((sum, tri) => sum + polygonSignedArea2(...tri), 0), mode === 'rect' ? 4800 : 2400);
      const color = { r: 180, g: 95, b: 87, a: 220 };
      const polygons = tris.map(tri => createPolygonFromPoints(tri, { color, polyType: 18, bounciness: 2.3 }));
      const saved = parsePmsFull(serializePms(prepareMapForSave({ ...createMapFromTemplate('empty'), polygons }, { geometryDirty: true })));
      assert.equal(saved.polygons.length, tris.length);
      for (const poly of saved.polygons) {
        assert.ok(hasInwardNormals(poly));
        assert.equal(poly.polyType, 18);
        assert.ok(Math.abs(poly.bounciness - 2.3) < 1e-5);
        assert.ok(poly.vertices.every(v => v.x >= start.x && v.x <= end.x && v.y >= start.y && v.y <= end.y));
        assert.deepEqual(poly.vertices[0].color, color);
      }
      assert.ok(saved.sectorsPolys?.some(s => s.length));
    }
  }
});

test('fixed orientations give identical outlines from either corner; gesture-built ramps and spikes flip', () => {
  for (const mode of ['ramp', 'spike'] as const) {
    for (const orientation of [0, 1, 2, 3] as const) {
      assert.deepEqual(dragShapeOutline(mode, start, end, orientation), dragShapeOutline(mode, end, start, orientation));
    }
    assert.notDeepEqual(dragShapeOutline(mode, start, end, 'drag'), dragShapeOutline(mode, end, start, 'drag'));
  }
  assert.deepEqual(dragShapeOutline('spike', start, end, 'drag')[1], { x: -10, y: 40 });
  assert.deepEqual(dragShapeOutline('spike', end, start, 'drag')[1], { x: -10, y: 10 });
  assert.deepEqual(dragShapeOutline('spike', start, end, 1)[1], { x: 30, y: 25 });
  assert.deepEqual(dragShapeOutline('spike', start, end, 3)[1], { x: -50, y: 25 });
  assert.deepEqual(dragShapeOutline('ramp', start, end, 'drag')[2], { x: 30, y: 10 });
  assert.deepEqual(dragShapeOutline('ramp', end, start, 'drag')[2], { x: -50, y: 40 });
});

test('a click, a line or a non-finite drag cannot create a degenerate polygon', () => {
  for (const mode of ['rect', 'ramp', 'spike'] as const) {
    for (const release of [start, { ...end, x: start.x }, { ...end, y: start.y }, { ...end, x: NaN }]) {
      assert.deepEqual(dragShapeOutline(mode, start, release, 'drag'), []);
    }
  }
});
