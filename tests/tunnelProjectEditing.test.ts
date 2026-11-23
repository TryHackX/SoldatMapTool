import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { appendTunnel } from '../src/client/editor/tunnelBlueprint';
import { prepareProjectTrial } from '../src/client/editor/projectTrialRoute';
import { runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';
import { DEFAULT_TUNNEL, createTunnelMap, generateClimbTunnel, type TunnelSettings } from '../src/shared/climbTunnel';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { createTunnelProject, rebuildTunnelSection, tunnelSectionPolygonIndices } from '../src/shared/tunnelProject';

// Same preparation and save baseline as the project's Save command.
function saveProject(doc: EditorDocument) {
  const { map, currentBaseName } = doc.getSnapshot();
  const prepared = prepareMapForSave(map, { geometryDirty: doc.isGeometryDirty(), sceneryDirty: doc.isSceneryDirty() });
  const bytes = encodeProjectFile(currentBaseName, prepared);
  doc.markSaved(prepared, currentBaseName, null, map, 'project');
  return bytes;
}

test('a saved tunnel can be reopened, rebuilt at one bend, undone and exported with the edited jump', () => {
  const settings: TunnelSettings = {
    ...DEFAULT_TUNNEL, palette: 'moss', difficulty: 'relaxed', bounce: 0, deadly: 0, hurt: 0,
    profileSource: 'library',
    profile: { jumps: [{ gap: 48, rise: 8 }], rebounds: [1.4], measuredMaps: 1, pairs: 1, bounceMaps: 1 },
  };
  const path = [{ x:-650, y:16 }, { x:-320, y:5 }, { x:0, y:-30 }, { x:310, y:-12 }, { x:650, y:20 }];
  const draft = generateClimbTunnel(settings, path);
  assert.ok(draft.validation.ok, draft.validation.reason);
  const base = createMapFromTemplate('empty', { title: 'Time trial', texture: 'default.bmp' });
  base.polygons = makeQuadPolys(-1000, 300, 1000, 365, { polyType: 7 });
  const source = new EditorDocument({ map: base, initialBaseName: 'ctf_project_test' });
  const inserted = appendTunnel(base, draft, settings, true);
  assert.ok(inserted);
  const recipe = createTunnelProject(draft, settings, path);
  source.commit({ label: 'Insert climb tunnel', nextMap: { ...inserted, editorTunnels: [recipe] } });

  const firstFile = saveProject(source);
  const opened = decodeProjectFile(firstFile);
  const doc = new EditorDocument({ map: opened.map, initialBaseName: opened.baseName });
  const project = doc.getSnapshot().map.editorTunnels![0];
  assert.deepEqual(project.settings, settings);
  assert.deepEqual(project.sourcePath, path);
  assert.deepEqual(project.knots, recipe.knots);
  assert.equal(project.method, 'draw');
  const middle = Math.floor(project.knots.length / 2);
  const beforePms = serializePms(opened.map);
  const point = { x: project.knots[middle].x + 1, y: project.knots[middle].y - 4 };
  const affected = new Set(tunnelSectionPolygonIndices(opened.map, project, middle));
  assert.ok(affected.size > 0 && affected.size < draft.polygons.length);
  const preview = rebuildTunnelSection(opened.map, project, middle, { point, landingHeight: 4, bounce: 1.75 });
  assert.ok(preview.ok, preview.ok ? '' : preview.reason);
  assert.deepEqual(serializePms(doc.getSnapshot().map), beforePms, 'preview must not edit the document');
  assert.equal(project.sections[middle - 1].bounce, null);
  const startMap = opened.map;
  const editMap = { ...preview.map, editorTunnels: [preview.project] };
  doc.commit({ label: 'Rebuild tunnel section', nextMap: editMap });
  assert.equal(doc.getSnapshot().undoStack.length, 1);
  assert.equal(doc.undo().map, startMap);
  assert.equal(doc.redo().map, editMap);
  const secondFile = saveProject(doc);
  assert.equal(doc.isDirty(), false);

  const final = decodeProjectFile(secondFile);
  assert.deepEqual(final.tunnels[0].knots[middle], point);
  assert.equal(final.tunnels[0].sections[middle - 1].landingHeight, 4);
  assert.equal(final.tunnels[0].sections[middle - 1].bounce, 1.75);
  assert.deepEqual(final.tunnels[0].settings, project.settings);
  for (let i = 0; i < project.knots.length; i++) {
    if (i !== middle) assert.deepEqual(final.tunnels[0].knots[i], project.knots[i], 'other bends retain their exact coordinates');
  }
  const finalPms = serializePms(final.map);
  assert.notDeepEqual(finalPms, beforePms);
  const gameMap = parsePmsFull(finalPms);
  assert.equal(gameMap.editorTunnels, undefined);
  assert.deepEqual(gameMap.parseWarnings, []);
  assert.deepEqual(gameMap.spawnpoints, startMap.spawnpoints);
  assert.ok(gameMap.sectorsPolys?.some(cell => cell.length > 0));
  const bouncy = gameMap.polygons.filter(poly => poly.polyType === 18 && Math.abs(poly.bounciness - 1.75) < 0.0001);
  assert.ok(bouncy.length > 0, 'exported landing has type 18 and the requested physical rebound');
  assert.equal(gameMap.polygons.length, startMap.polygons.length);
  let untouched = 0;
  for (const [i, polygon] of startMap.polygons.entries()) {
    if (!affected.has(i)) {
      assert.deepEqual(gameMap.polygons[i].raw, polygon.raw, 'outside polygon #' + i + ' is byte-identical');
      untouched++;
    }
    const farLeft = polygon.vertices.every(v => v.x < -480);
    const farRight = polygon.vertices.every(v => v.x > 480);
    if (farLeft || farRight) {
      assert.deepEqual(gameMap.polygons[i].raw, polygon.raw, 'terrain at the other end of the tunnel is unchanged');
    }
  }
  assert.ok(untouched > base.polygons.length, 'also compared untouched generated rock');
  assert.deepEqual(gameMap.polygons[0].raw, startMap.polygons[0].raw, 'manual terrain survives both saves');
  assert.deepEqual(encodeProjectFile(final.baseName, final.map), secondFile, 'reopening and resaving is idempotent');
  const reopenedEdit = rebuildTunnelSection(final.map, final.tunnels[0], middle, { bounce: 1.5 });
  assert.ok(reopenedEdit.ok, reopenedEdit.ok ? '' : reopenedEdit.reason);
  assert.equal(reopenedEdit.project.sections[middle - 1].landingHeight, 4);
  assert.deepEqual(reopenedEdit.project.knots[middle], point);
});

test('the route trial follows the edited tunnel and includes surrounding collision geometry', () => {
  const settings = { ...DEFAULT_TUNNEL, direction: 'across' as const };
  const draft = generateClimbTunnel(settings);
  const generatedMap = createTunnelMap(draft, settings, { title: 'Trial', texture: 'default.bmp' });
  const created = createTunnelProject(draft, settings);
  const restored = decodeProjectFile(encodeProjectFile('Trial', { ...generatedMap, editorTunnels: [created] }));
  const recipe = restored.tunnels[0];
  const bend = Math.floor(recipe.knots.length / 2);
  const movement = { x: recipe.knots[bend].x, y: recipe.knots[bend].y - 1 };
  const edit = rebuildTunnelSection(restored.map, recipe, bend, { point: movement, landingHeight: 1 });
  assert.ok(edit.ok, edit.ok ? '' : edit.reason);
  const { request, usesSketchEnds } = prepareProjectTrial(edit.map, edit.project);
  assert.equal(usesSketchEnds, false);
  assert.notDeepEqual(request.centerline, draft.centerline);
  assert.notDeepEqual(request.footholds, draft.footholds);
  assert.equal(request.map.polygons, edit.map.polygons);
  assert.equal(request.map.colliders, edit.map.colliders);
  assert.equal('editorTunnels' in request.map, false);
  const completed = runPmsTunnelTrial(request.map, request.centerline, request.footholds);
  assert.ok(completed.reached, completed.reason);
  const spawn = draft.spawnpoints.find(s => s.team === 1)!;
  const end = draft.spawnpoints.find(s => s.team === 6)!;
  const wallX = (spawn.x + end.x) / 2;
  const blockedMap = {
    ...edit.map,
    polygons: [...edit.map.polygons, ...makeQuadPolys(wallX, -2000, wallX + 24, 2000)],
    spawnpoints: edit.map.spawnpoints.map(s => ({ ...s, x: s.x + 1200 })),
  };
  const originalMarkers = structuredClone(blockedMap.spawnpoints);
  const blockedInput = prepareProjectTrial(blockedMap, edit.project);
  assert.equal(blockedInput.usesSketchEnds, true);
  const r = blockedInput.request;
  const blocked = runPmsTunnelTrial(r.map, r.centerline, r.footholds);
  assert.equal(blocked.reached, false);
  assert.equal(blocked.reason, 'pilot-stalled');
  assert.ok(blocked.progress > 0 && blocked.progress < 1);
  assert.deepEqual(blocked.trace[0], { x: spawn.x, y: spawn.y });
  assert.deepEqual(blockedMap.spawnpoints, originalMarkers);
});
