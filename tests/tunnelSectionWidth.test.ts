import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { prepareProjectTrial } from '../src/client/editor/projectTrialRoute';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';
import { createTunnelMap, DEFAULT_TUNNEL, generateClimbTunnel, hasTunnelClearance, type TunnelPoint } from '../src/shared/climbTunnel';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms, type PmsMapData } from '../src/shared/pmsParser';
import { pointInTriInclusive } from '../src/shared/polygonGeometry';
import { doesPolyCollideSoldier } from '../src/shared/soldatConstants';
import { createTunnelProject, isTunnelProject, rebuildTunnelSection } from '../src/shared/tunnelProject';

function straightProject(vertical = false) {
  const path = [{ x: 0, y: 0 }, vertical ? { x: 0, y: 900 } : { x: 900, y: 0 }];
  const settings = { ...DEFAULT_TUNNEL, roughness: 0, spikes: false, lowCeilings: false, ramps: false,
    drops: false, ice: false, floatingHazards: false, bounce: 0, deadly: 0, hurt: 0 };
  const draft = generateClimbTunnel(settings, path);
  assert.ok(draft.validation.ok);
  const map = createTunnelMap(draft, settings, { title: 'Width test', texture: 'default.bmp' });
  const project = createTunnelProject(draft, settings, path);
  return { map, project, k: Math.floor(project.knots.length / 2) };
}

// Measure the free space against exported collision triangles rather than trusting the stored setting.
function wallDistance(map: PmsMapData, origin: TunnelPoint, direction: TunnelPoint) {
  let distance = Infinity;
  for (const p of map.polygons) {
    if (!doesPolyCollideSoldier(p.polyType, 1, false)) continue;
    for (let i = 0; i < 3; i++) {
      const a = p.vertices[i], b = p.vertices[(i + 1) % 3];
      const dx = b.x - a.x, dy = b.y - a.y;
      const denominator = direction.x * dy - direction.y * dx;
      if (Math.abs(denominator) < 1e-8) continue;
      const ax = a.x - origin.x, ay = a.y - origin.y;
      const t = (ax * dy - ay * dx) / denominator;
      const u = (ax * direction.y - ay * direction.x) / denominator;
      if (t >= 0 && u >= 0 && u <= 1) distance = Math.min(distance, t);
    }
  }
  assert.ok(Number.isFinite(distance), 'the passage must have a solid wall');
  return distance;
}

function gameMap(map: PmsMapData) {
  return parsePmsFull(serializePms(prepareMapForSave(map, { geometryDirty: true })));
}

test('local width moves both collision walls perpendicular to horizontal and vertical passages', () => {
  for (const vertical of [false, true]) {
    const { map, project, k } = straightProject(vertical);
    const normal = vertical ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const sides = [normal, { x: -normal.x, y: -normal.y }];
    const origin = project.knots[k];
    const before = gameMap(map);
    for (const offset of [-12, 20]) {
      const edit = rebuildTunnelSection(map, project, k, { widthOffset: offset });
      assert.ok(edit.ok, edit.ok ? '' : edit.reason);
      const after = gameMap(edit.map);
      for (const side of sides) {
        const delta = wallDistance(after, origin, side) - wallDistance(before, origin, side);
        assert.ok(Math.sign(offset) * delta > 1, 'each collision surface must move in the requested direction');
        const remote = project.knots[k + 2];
        assert.equal(wallDistance(after, remote, side), wallDistance(before, remote, side));
      }
      assert.deepEqual(edit.project.knots, project.knots);
      assert.equal(edit.project.settings.clearance, project.settings.clearance);
    }
  }
});

test('a project written without per-section widths round-trips a local chamber, undo and a subsequent narrowing', () => {
  const { map, project, k } = straightProject();
  const oldProject = { ...project, sections: project.sections.map(({ landingHeight, bounce }) => ({ landingHeight, bounce })) };
  const encoded = encodeProjectFile('old_tunnel', { ...map, editorTunnels: [oldProject] });
  const opened = decodeProjectFile(encoded);
  assert.ok(isTunnelProject(opened.tunnels[0]));
  const doc = new EditorDocument({ map: opened.map, projectFile: true });
  const change = rebuildTunnelSection(opened.map, opened.tunnels[0], k, { widthOffset: 20 });
  assert.ok(change.ok, change.ok ? '' : change.reason);
  assert.ok(change.changedPolygons > 1 && change.changedPolygons < opened.map.polygons.length / 2);
  const applied = { ...change.map, editorTunnels: [change.project] };
  doc.commit({ label: 'Local width', nextMap: applied });
  assert.equal(doc.undo().map, opened.map);
  assert.equal(doc.redo().map, applied);
  const saved = decodeProjectFile(encodeProjectFile(opened.baseName, prepareMapForSave(applied, { geometryDirty: true })));
  assert.equal(saved.tunnels[0].sections[k - 1].widthOffset, 20);
  const changedIndices = new Set(change.changedIndices);
  for (let i = 0; i < saved.map.polygons.length; i++) {
    if (!changedIndices.has(i)) assert.deepEqual(saved.map.polygons[i].raw, opened.map.polygons[i].raw);
  }
  const again = rebuildTunnelSection(saved.map, saved.tunnels[0], k, { widthOffset: -12 });
  const direct = rebuildTunnelSection(opened.map, opened.tunnels[0], k, { widthOffset: -12 });
  assert.ok(again.ok, again.ok ? '' : again.reason);
  assert.ok(direct.ok, direct.ok ? '' : direct.reason);
  assert.deepEqual(serializePms(gameMap(again.map)), serializePms(gameMap(direct.map)), 'absolute width must not accumulate after reopen');
  const reset = rebuildTunnelSection(again.map, again.project, k, { widthOffset: 0 });
  assert.ok(reset.ok, reset.ok ? '' : reset.reason);
  const restored = gameMap(reset.map);
  for (const [i, poly] of opened.map.polygons.entries()) {
    assert.deepEqual(restored.polygons[i].vertices, poly.vertices);
    assert.equal(restored.polygons[i].polyType, poly.polyType);
    for (let j = 0; j < 3; j++) {
      const a = restored.polygons[i].normals[j], b = poly.normals[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.00002);
    }
  }
});

test('a narrow switchback preserves the opposite passage and refuses an oversized chamber', () => {
  const path: TunnelPoint[] = [{ x: 0, y: 0 }];
  for (let i = 0; i <= 12; i++) {
    const angle = -Math.PI / 2 + Math.PI * i / 12;
    path.push({ x: 550 + 32 * Math.cos(angle), y: 32 + 32 * Math.sin(angle) });
  }
  path.push({ x: -40, y: 64 });
  const settings = { ...DEFAULT_TUNNEL, difficulty: 'relaxed' as const, roughness: 0,
    spikes: false, lowCeilings: false, ramps: false, drops: false, ice: false, bounce: 0, deadly: 0, hurt: 0 };
  const draft = generateClimbTunnel(settings, path);
  assert.ok(draft.validation.ok);
  const project = createTunnelProject(draft, settings, path);
  const map = createTunnelMap(draft, settings, { title: 'Switchback', texture: 'default.bmp' });
  const k = 2, lowerLane = { x: project.knots[k].x, y: 64 }, up = { x: 0, y: -1 };
  const result = rebuildTunnelSection(map, project, k, { widthOffset: 12 });
  assert.ok(result.ok, result.ok ? '' : result.reason);
  assert.equal(wallDistance(result.map, lowerLane, up), wallDistance(map, lowerLane, up));
  const down = { x: 0, y: 1 };
  const barrier = 64 - wallDistance(result.map, lowerLane, up) - wallDistance(result.map, project.knots[k], down);
  assert.ok(barrier >= 8);
  const large = rebuildTunnelSection(result.map, result.project, k, { widthOffset: 120 });
  assert.ok(!large.ok && (large.reason === 'neighbour' || large.reason === 'clearance'), 'excessive chamber must be refused');
  assert.equal(result.project.sections[k - 1].widthOffset, 12);
});

test('width changes protect manually edited rock, invalid settings and a blocked passage', () => {
  const { map, project, k } = straightProject();
  const preview = rebuildTunnelSection(map, project, k, { widthOffset: 12 });
  assert.ok(preview.ok);
  const index = preview.changedIndices[0];
  const edited = structuredClone(map.polygons[index]);
  edited.vertices[0].color.r ^= 1;
  const paintedMap = { ...map, polygons: map.polygons.map((p, i) => i === index ? edited : p) };
  assert.deepEqual(rebuildTunnelSection(paintedMap, project, k, { widthOffset: 12 }), { ok: false, reason: 'manual' });
  for (const invalid of [150, -100, Infinity, NaN]) {
    assert.deepEqual(rebuildTunnelSection(map, project, k, { widthOffset: invalid }), { ok: false, reason: 'invalid' });
    const sections = project.sections.map((s, i) => i === k - 1 ? { ...s, widthOffset: invalid } : s);
    assert.equal(isTunnelProject({ ...project, sections }), false);
  }
  const collider = { ...project.knots[k], radius: 40, active: true, index: 0 };
  const obstruction = { ...map, colliders: [collider] };
  assert.deepEqual(rebuildTunnelSection(obstruction, project, k, { widthOffset: -12 }), { ok: false, reason: 'clearance' });
  assert.equal(project.sections[k - 1].widthOffset ?? 0, 0);
});

test('widening one tunnel cannot push its outer wall into the path of another editable tunnel', () => {
  const { map, project, k } = straightProject();
  const path = [{ x: 280, y: 178 }, { x: 750, y: 178 }];
  const draft = generateClimbTunnel(project.settings, path);
  const other = createTunnelProject(draft, project.settings, path);
  const world = { ...map, polygons: [...map.polygons, ...draft.polygons], editorTunnels: [project, other] };
  const line = draft.centerline.slice(2, -2);
  const otherRouteIsClear = (m: PmsMapData) => hasTunnelClearance(line, m.polygons.filter(p => doesPolyCollideSoldier(p.polyType, 1, false)), 7);
  assert.ok(otherRouteIsClear(world), 'baseline has room for the other route');
  const small = rebuildTunnelSection(world, project, k, { widthOffset: 12 });
  assert.ok(small.ok, small.ok ? '' : small.reason);
  assert.ok(otherRouteIsClear(small.map));
  const alone = rebuildTunnelSection(map, project, k, { widthOffset: 60 });
  assert.ok(alone.ok, alone.ok ? '' : alone.reason);
  assert.equal(otherRouteIsClear(alone.map), false, 'the same displacement without the other route would reach its corridor');
  assert.deepEqual(rebuildTunnelSection(world, project, k, { widthOffset: 60 }), { ok: false, reason: 'neighbour' });
});

test('a chamber and a pinch on a spiral retain the rock separating the next turn and remain runnable after PMS export', () => {
  const example = loadTestedTunnel('spiral');
  const draft = generateClimbTunnel(example.settings, example.path);
  const original = createTunnelMap(draft, example.settings, { title: 'Spiral', texture: 'default.bmp' });
  const project = createTunnelProject(draft, example.settings, example.path);
  const legacy = { ...project, sections: project.sections.map(({landingHeight, bounce}) => ({landingHeight, bounce})) };
  const opened = decodeProjectFile(encodeProjectFile('Spiral', { ...original, editorTunnels: [legacy] }));
  const k = 32, origin = project.knots[k], otherTurn = project.knots[55];
  const dx = otherTurn.x - origin.x, dy = otherTurn.y - origin.y;
  const separation = Math.hypot(dx, dy);
  const towardOther = { x: dx / separation, y: dy / separation };
  const towardEdited = { x: -towardOther.x, y: -towardOther.y };
  const beforeWall = wallDistance(opened.map, origin, towardOther);
  for (const width of [22, -12]) {
    const change = rebuildTunnelSection(opened.map, opened.tunnels[0], k, { widthOffset: width });
    assert.ok(change.ok, change.ok ? '' : change.reason);
    const after = gameMap(change.map);
    const movedWall = wallDistance(after, origin, towardOther);
    assert.ok((movedWall - beforeWall) * Math.sign(width) > 2);
    assert.equal(wallDistance(after, otherTurn, towardEdited), wallDistance(opened.map, otherTurn, towardEdited));
    const barrier = { x: (origin.x + otherTurn.x) / 2, y: (origin.y + otherTurn.y) / 2 };
    for (const along of [-8, 0, 8]) {
      const x = barrier.x + along * towardOther.x, y = barrier.y + along * towardOther.y;
      assert.ok(after.polygons.some(p => doesPolyCollideSoldier(p.polyType, 1, false) && pointInTriInclusive(x, y, ...p.vertices)),
        'solid rock must still separate these two turns');
    }
    const { request } = prepareProjectTrial(after, change.project);
    assert.ok(runPmsTunnelTrial(request.map, request.centerline, request.footholds).reached);
  }
});
