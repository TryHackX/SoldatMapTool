import test from 'node:test';
import assert from 'node:assert/strict';
import { createTunnelMap, DEFAULT_TUNNEL, generateClimbTunnel } from '../src/shared/climbTunnel';
import { isTunnelProject, createTunnelProject, rebuildTunnelSection, tunnelSectionPolygonIndices, tunnelTrialRoute } from '../src/shared/tunnelProject';
import { parsePmsFull, serializePms, type PmsPolygon } from '../src/shared/pmsParser';
import { prepareMapForSave, hasInwardNormals } from '../src/shared/pmsCompiler';
import { makeQuadPolys } from '../src/shared/editorTemplates';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';

function straight() {
  const path = [{ x: 0, y: 0 }, { x: 720, y: 0 }];
  const draft = generateClimbTunnel(DEFAULT_TUNNEL, path);
  const map = createTunnelMap(draft, DEFAULT_TUNNEL, { title: 'Workshop', texture: 'default.bmp' });
  const project = createTunnelProject(draft, DEFAULT_TUNNEL, path);
  return { map, project };
}

test('a bend rebuild preserves both ends, entity layers and every unchanged PMS record after a save', () => {
  const { map, project } = straight();
  const input = parsePmsFull(serializePms(map));
  assert.ok(isTunnelProject(JSON.parse(JSON.stringify(project))));
  assert.deepEqual(project.sourcePath, [{ x: 0, y: 0 }, { x: 720, y: 0 }]);
  const k = 3, p = project.knots[k], changed = rebuildTunnelSection(input, project, k, { point: { x: p.x + 10, y: p.y - 12 } });
  assert.ok(changed.ok);
  assert.ok(changed.changedPolygons > 1 && changed.changedPolygons < input.polygons.length * 0.6);
  assert.equal(input.spawnpoints, changed.map.spawnpoints);
  assert.equal(input.props, changed.map.props);
  const edited = new Set(changed.changedIndices);
  assert.ok(changed.changedIndices.every(i => hasInwardNormals(changed.map.polygons[i])));
  const after = parsePmsFull(serializePms(prepareMapForSave(changed.map, { geometryDirty: true })));
  for (let i = 0; i < input.polygons.length; i++) {
    if (edited.has(i)) {
      assert.notDeepEqual(after.polygons[i].raw, input.polygons[i].raw);
    } else {
      assert.equal(input.polygons[i], changed.map.polygons[i]);
      assert.deepEqual(after.polygons[i].raw, input.polygons[i].raw);
    }
  }
  assert.deepEqual(changed.project.knots[k - 1], project.knots[k - 1]);
  assert.deepEqual(changed.project.knots[k + 1], project.knots[k + 1]);
  const beforeRoute=tunnelTrialRoute(project), afterRoute=tunnelTrialRoute(changed.project);
  assert.deepEqual(afterRoute.spawnpoints,beforeRoute.spawnpoints);
  assert.notDeepEqual(afterRoute.centerline,beforeRoute.centerline);
  assert.notDeepEqual(afterRoute.footholds,beforeRoute.footholds);
  assert.deepEqual(afterRoute.centerline[0],beforeRoute.centerline[0]);
  assert.deepEqual(afterRoute.centerline.at(-1),beforeRoute.centerline.at(-1));
  // The unaffected vertices of a triangle straddling either boundary still meet its unchanged neighbor exactly.
  const movedVertex = new Map<string, string>();
  for (let i = 0; i < input.polygons.length; i++) for (let j = 0; j < 3; j++) {
    const a = input.polygons[i].vertices[j], b = after.polygons[i].vertices[j];
    const key = a.x + ',' + a.y, position = b.x + ',' + b.y;
    if (movedVertex.has(key)) assert.equal(movedVertex.get(key), position);
    movedVertex.set(key, position);
  }
  const next = rebuildTunnelSection(after, changed.project, k, { landingHeight: 8, bounce: 2.2 });
  assert.ok(next.ok);
  assert.equal(next.project.sections[k - 1].landingHeight, 8);
  assert.ok(next.changedIndices.some(i => next.map.polygons[i].polyType === 18 && next.map.polygons[i].bounciness === 2.2));
});

test('changing the material targets a single landing and restoring the material is reversible', () => {
  const { map, project } = straight();
  const k = 2, update = rebuildTunnelSection(map, project, k, { bounce: 2.45 });
  assert.ok(update.ok);
  assert.ok(update.changedPolygons > 0 && update.changedPolygons < 14);
  for (const i of update.changedIndices) {
    const poly: PmsPolygon = update.map.polygons[i];
    assert.deepEqual(poly.vertices, map.polygons[i].vertices);
    assert.equal(poly.polyType, 18);
    assert.ok(Math.abs(Math.hypot(poly.normals[2].x, poly.normals[2].y) - 2.45) < 1e-5);
  }
  const reset = rebuildTunnelSection(update.map, update.project, k, { bounce: null });
  assert.ok(reset.ok);
  assert.deepEqual(serializePms(reset.map), serializePms(map));
});

test('reordered, inserted and removed unrelated triangles coexist with the edited section; a changed owner refuses atomically', () => {
  const { map, project } = straight();
  const k = 3;
  const touched = tunnelSectionPolygonIndices(map, project, k);
  const target = rebuildTunnelSection(map, project, k, { bounce: 2.25 });
  assert.ok(target.ok);
  const foreign = makeQuadPolys(-400, -500, -100, -400);
  const behind = map.polygons.findIndex((_p, i) => !touched.includes(i));
  const rest = map.polygons.filter((_p, i) => i !== behind).reverse();
  const withOther = { ...map, polygons: [...foreign, ...rest] };
  const apply = rebuildTunnelSection(withOther, project, k, { bounce: 2.25 });
  assert.ok(apply.ok);
  assert.equal(apply.changedPolygons, target.changedPolygons);
  assert.equal(apply.map.polygons[0], foreign[0]);
  const owner = map.polygons[target.changedIndices[0]];
  const altered = structuredClone(owner);
  altered.vertices[0].color.r = (altered.vertices[0].color.r + 35) % 255;
  const conflicts: PmsPolygon[][] = [
    map.polygons.filter(p => p !== owner),
    map.polygons.map(p => p === owner ? altered : p),
    [...map.polygons, owner],
  ];
  for (const polygons of conflicts) {
    assert.deepEqual(rebuildTunnelSection({ ...map, polygons }, project, k, { bounce: 2.25 }), { ok: false, reason: 'manual' });
    assert.equal(project.sections[k - 1].bounce, null);
  }
});

test('validates metadata and refuses edits that collapse a bend or push its axis through another obstacle', () => {
  const { map, project } = straight();
  assert.equal(isTunnelProject({ ...project, faces: [{ ...project.faces[0], v: [0, 1, 999999] }] }), false);
  assert.equal(isTunnelProject({ ...project, sections: [] }), false);
  const k = 2, p = project.knots[k];
  assert.deepEqual(rebuildTunnelSection(map, project, k, { point: project.knots[k - 1] }), { ok: false, reason: 'clearance' });
  assert.deepEqual(rebuildTunnelSection(map, project, k, { bounce: 4.5 }), { ok: false, reason: 'invalid' });
  assert.deepEqual(rebuildTunnelSection(map, project, k, {}), { ok: false, reason: 'unchanged' });
  const mapWithCollider = { ...map, colliders: [{ x: p.x, y: p.y - 11, radius: 22, active: true, index: 0 }] };
  assert.deepEqual(rebuildTunnelSection(mapWithCollider, project, k, { point: { x: p.x, y: -12 } }), { ok: false, reason: 'clearance' });
  const nonSolid = makeQuadPolys(p.x - 4, -110, p.x + 2, 110, { polyType: 3 });
  assert.ok(rebuildTunnelSection({ ...map, polygons: [...map.polygons, ...nonSolid] }, project, k, { point: { x: p.x, y: -12 } }).ok);
});

test('a spiral edit remains on its own pass and preserves the saved local geometry profile', () => {
  const example = loadTestedTunnel('spiral');
  const draft = generateClimbTunnel(example.settings, example.path);
  const map = createTunnelMap(draft, example.settings, { title: 'Spiral', texture: 'default.bmp' });
  const project = createTunnelProject(draft, example.settings, example.path);
  const k = 8, p = project.knots[k];
  const result = rebuildTunnelSection(map, project, k, { point: { x: p.x + 6, y: p.y - 8 } });
  assert.ok(result.ok);
  assert.ok(result.changedPolygons < 0.10 * map.polygons.length);
  assert.deepEqual(result.project.settings, example.settings);
  assert.deepEqual(result.project.sourcePath, example.path);
  assert.ok(isTunnelProject(result.project));
});
