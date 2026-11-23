import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { applyTunnelPacePlan } from '../src/client/editor/applyTunnelPacePlan';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { runTunnelPacePlan } from '../src/client/editor/tunnelPacePlanner';
import { runPmsTunnelTrial } from '../src/client/editor/tunnelTrial';
import { createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { isPaceSettings, type PaceSettings } from '../src/shared/tunnelPace';
import { createTunnelProject, isTunnelProject, tunnelTrialRoute } from '../src/shared/tunnelProject';

test('a verified pace plan is applied atomically, survives Save Project and matches the full PMS run', () => {
  const {name,settings,path} = loadTestedTunnel('hills');
  const draft = generateClimbTunnel(settings,path);
  const seedMap = createTunnelMap(draft,settings,{title:name,texture:'default.bmp'});
  const recipe = createTunnelProject(draft,settings,path);
  const {map,tunnels:[project]} = decodeProjectFile(encodeProjectFile(name,seedMap,[recipe]));
  const doc = new EditorDocument({map,initialBaseName:name,projectFile:true});
  const pace: PaceSettings = {targetSeconds:11,profile:'progressive',seed:123};
  const report = runTunnelPacePlan(structuredClone({map,project,settings:pace}));
  assert.ok(report.trial.reached,report.trial.reason);
  assert.equal(doc.canUndo(),false);
  assert.equal(applyTunnelPacePlan(doc,map,project,{...report,usesSketchEnds:true},pace),null);
  assert.equal(applyTunnelPacePlan(doc,map,project,{...report,trial:{...report.trial,reached:false}},pace),null);

  // A completed report may arrive after the user edits the map, even with the same tunnel ID.
  doc.commit({label:'Edit map',nextMap:{...map}});
  assert.equal(applyTunnelPacePlan(doc,map,project,report,pace),null);
  doc.undo();
  const chosen = applyTunnelPacePlan(doc,map,project,report,pace);
  assert.ok(chosen);
  assert.equal(chosen.undoStack.length,1);
  assert.deepEqual(chosen.map.editorTunnels?.[0].pace,pace);
  assert.equal(doc.undo().map,map);
  const final = doc.redo().map;
  const prepared = prepareMapForSave(final,{geometryDirty:doc.isGeometryDirty()});
  const saved = decodeProjectFile(encodeProjectFile(name,prepared));
  assert.deepEqual(saved.tunnels[0].pace,pace);
  assert.deepEqual(saved.tunnels[0].sourcePath,project.sourcePath);
  const route = tunnelTrialRoute(saved.tunnels[0]);
  const run = runPmsTunnelTrial(saved.map,route.centerline,route.footholds);
  assert.ok(run.reached);
  assert.equal(run.ticks,report.trial.ticks);

  // Merely reopening or accepting the already-saved target is not a new terrain edit.
  assert.equal(applyTunnelPacePlan(doc,final,final.editorTunnels![0],{...report,changes:[]},pace),doc.getSnapshot());
  assert.equal(doc.getSnapshot().undoStack.length,1);
  assert.ok(!isTunnelProject({...project,pace:{...pace,targetSeconds:Infinity}}));
  assert.ok(!isPaceSettings({...pace,profile:'unknown'}));
});
