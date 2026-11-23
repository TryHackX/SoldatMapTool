import assert from 'node:assert/strict';
import test from 'node:test';
import { createPolygonGestures, isPolygonDrag, type PolygonDrag } from '../src/client/editor/polygonGestures';
import { laserStroke } from '../src/client/editor/polygonDrawing';
import { DEFAULT_PLACEMENT_SETTINGS, type EditorPlacementDefaults } from '../src/client/editor/types';
import type { PmsPolygon } from '../src/shared/pmsParser';

type Point = { x: number; y: number };
const texture = { w: 128, h: 128 };
const pointer = (worldX: number, worldY: number, zoom = 1) => ({ worldX, worldY, zoom });

function fixture(settings: Partial<EditorPlacementDefaults> = {}) {
  const placement = { ...DEFAULT_PLACEMENT_SETTINGS, ...settings };
  const state = {
    draft: [] as Point[], drag: null as PolygonDrag | null,
    laser: null as Point[] | null, preview: null as Point[] | null,
    inserts: [] as { polygons: PmsPolygon[]; label: string }[], messages: [] as string[],
    accept: true, snapCalls: [] as { anchor: Point; showGuides: boolean }[],
    lastPreview: { current: -Infinity },
  };
  const gestures = createPolygonGestures({
    placement, texture, hasDocument: () => true,
    insert: (polygons, label) => {
      if (state.accept) state.inserts.push({ polygons, label });
      return state.accept;
    },
    inform: message => state.messages.push(message),
    startDrag: drag => { state.drag = drag; },
    setDraft: points => { state.draft = points; },
    setLaser: points => { state.laser = points; },
    setLaserPreview: points => { state.preview = points; },
    lastLaserPreview: state.lastPreview,
    snapEndpoint: (info, anchor, showGuides) => {
      state.snapCalls.push({ anchor, showGuides });
      return { x: Math.round(info.worldX / 10) * 10, y: Math.round(info.worldY / 10) * 10 };
    },
  });
  return { state, gestures, placement };
}

test('drawing leaves other tools alone and only advances triangle anchors after a successful insert', () => {
  const { state, gestures } = fixture();
  const click = (x: number, y: number) => gestures.begin('poly_strip', pointer(x, y), { x, y }, state.draft, false);
  for (const tool of ['select', 'playtest', 'climb_tunnel'] as const) {
    assert.equal(gestures.begin(tool, pointer(0, 0), { x: 0, y: 0 }, [], true), false);
  }
  gestures.begin('poly_strip', pointer(0, 0), { x: 0, y: 0 }, [], true);
  assert.deepEqual(state.draft, []);
  click(0, 0);
  click(20, 0);
  click(30, 0);
  assert.equal(state.messages.length, 1);
  state.accept = false;
  click(0, 20);
  assert.deepEqual(state.draft, [{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  state.accept = true;
  click(0, 20);
  assert.deepEqual(state.draft, [{ x: 20, y: 0 }, { x: 0, y: 20 }]);
  assert.equal(state.inserts[0].label, 'Create polygon');
  assert.equal(isPolygonDrag({ kind: 'tunnel_stroke' }), false);
  assert.equal(isPolygonDrag(null), false);
});

test('the free outline closes within ten screen pixels and stays available after a refused insert', () => {
  const { state, gestures } = fixture({ polyShapeMode: 'polygon' });
  for (const [x, y] of [[0, 0], [40, 0], [40, 40], [0, 40]]) {
    gestures.begin('poly_shape', pointer(x, y, 2), { x, y }, state.draft, false);
  }
  state.accept = false;
  gestures.begin('poly_shape', pointer(4, 0, 2), { x: 4, y: 0 }, state.draft, false);
  assert.equal(state.draft.length, 4);
  state.accept = true;
  gestures.begin('poly_shape', pointer(4, 0, 2), { x: 4, y: 0 }, state.draft, false);
  assert.equal(state.inserts[0].polygons.length, 2);
  assert.deepEqual(state.draft, []);
});

test('preset drags snap their endpoints, use the last in-view outline outside, and discard cancellation or layer locks', () => {
  for (const action of ['release', 'outside', 'cancel', 'lock'] as const) {
    const { state, gestures } = fixture({ polyShapeMode: 'rect' });
    gestures.begin('poly_shape', pointer(7, 9), { x: 10, y: 10 }, [], false);
    const drag = state.drag;
    assert.ok(drag && isPolygonDrag(drag));
    gestures.move(drag, pointer(42, 27));
    assert.deepEqual(state.snapCalls[0], { anchor: { x: 10, y: 10 }, showGuides: true });
    gestures.end(drag, { ...pointer(62, 43), outsideViewport: action === 'outside', cancelled: action === 'cancel' }, action === 'lock');
    assert.deepEqual(state.draft, []);
    if (action === 'cancel' || action === 'lock') {
      assert.equal(state.inserts.length, 0);
    } else {
      assert.equal(state.inserts[0].polygons.length, 2);
      const vertices = state.inserts[0].polygons.flatMap(p => p.vertices);
      assert.equal(Math.max(...vertices.map(v => v.x)), action === 'outside' ? 40 : 60);
      assert.equal(state.snapCalls.length, action === 'outside' ? 1 : 2);
    }
  }
});

test('laser samples raw screen-spaced points, throttles the preview, and commits the same geometry', () => {
  for (const action of ['release', 'outside', 'cancel', 'lock', 'course'] as const) {
    const { state, gestures, placement } = fixture(action === 'course' ? { strokeMode: 'course' } : {});
    gestures.begin('poly_laser', pointer(4, 5), { x: 0, y: 0 }, [], false);
    const drag = state.drag;
    assert.ok(drag?.kind === 'poly_laser');
    gestures.move(drag, pointer(5, 5, 2));
    assert.deepEqual(drag.points, [{ x: 4, y: 5 }]);
    gestures.move(drag, pointer(204, 5, 2));
    assert.deepEqual(state.preview, drag.points);
    state.lastPreview.current = Infinity;
    gestures.move(drag, pointer(204, 100));
    gestures.move(drag, pointer(4, 100));
    assert.equal(state.preview?.length, 2);
    assert.equal(state.laser?.length, 4);
    const expected = laserStroke(drag.points, placement, texture);
    gestures.end(drag, { ...pointer(4, 100), cancelled: action === 'cancel', outsideViewport: action === 'outside' }, action === 'lock');
    assert.equal(state.laser, null);
    assert.equal(state.preview, null);
    if (action === 'release' || action === 'course') {
      assert.ok(expected.length);
      assert.deepEqual(state.inserts, [{ polygons: expected, label: action === 'course' ? 'Draw platform route' : 'Draw laser polygons' }]);
    } else {
      assert.equal(state.inserts.length, 0);
    }
  }
});
