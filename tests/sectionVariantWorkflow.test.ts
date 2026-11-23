import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorDocument, emptySelection } from '../src/client/editor/EditorDocument';
import { decodeProjectFile, encodeProjectFile } from '../src/client/editor/projectFile';
import { prepareProjectTrial } from '../src/client/editor/projectTrialRoute';
import { compareSectionVariants, type SectionVariantEvent } from '../src/client/editor/sectionVariantComparison';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { prepareSectionTiming, runTimedSectionTrial } from '../src/client/editor/tunnelTrial';
import { createTunnelMap, generateClimbTunnel } from '../src/shared/climbTunnel';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { createTunnelProject, rebuildTunnelSection } from '../src/shared/tunnelProject';

test('a report from the worker replays the chosen time after apply, undo, redo and reopening a project', () => {
  const {settings,path,name} = loadTestedTunnel('spiral');
  const draft = generateClimbTunnel(settings,path);
  const initial = createTunnelMap(draft,settings,{title:name,texture:'default.bmp'});
  const recipe = createTunnelProject(draft,settings,path);
  const {map,tunnels:[project]} = decodeProjectFile(encodeProjectFile(name,initial,[recipe]));
  const doc = new EditorDocument({map,initialBaseName:name,projectFile:true});
  const knotIndex = 32;
  const events: SectionVariantEvent[] = [];
  // postMessage performs a structured clone in each direction. Only the reported changes cross back.
  compareSectionVariants(structuredClone({map,project,knotIndex,seed:240,count:4}), event=>events.push(structuredClone(event)));
  assert.equal(doc.canUndo(),false);
  const results = events.flatMap(event=>event.kind==='candidate' && event.candidate.trial?.reached ? [event.candidate] : []);
  assert.ok(results.length >= 2);
  const source = events.find(event=>event.kind==='baseline');
  assert.ok(source?.trial.reached);
  const timing = prepareSectionTiming(prepareProjectTrial(map,project,knotIndex).request);
  const selected = results.reduce((fastest,row)=>row.trial!.sectionTicks! < fastest.trial!.sectionTicks! ? row : fastest);
  const preview = rebuildTunnelSection(map,project,knotIndex,selected.change);
  assert.ok(preview.ok);
  assert.equal(preview.changedPolygons,selected.changedPolygons);
  assert.equal(doc.isDirty(),false,'checking independent candidates and previewing the winner leaves history untouched');
  doc.commit({label:'Apply section variant',nextMap:{...preview.map,editorTunnels:[preview.project]},nextSelection:emptySelection()});

  function checkTime(current: typeof map, expected: number) {
    const request = prepareProjectTrial(current,current.editorTunnels![0],knotIndex).request;
    const trial = runTimedSectionTrial(request,timing);
    assert.ok(trial.reached,trial.reason);
    assert.ok(Math.abs(trial.sectionTicks! - expected) < 1e-6);
  }
  assert.equal(doc.getSnapshot().undoStack.length,1);
  checkTime(doc.getSnapshot().map,selected.trial!.sectionTicks!);
  checkTime(doc.undo().map,source.trial.sectionTicks!);
  assert.equal(doc.isDirty(),false);
  const chosen = doc.redo().map;
  checkTime(chosen,selected.trial!.sectionTicks!);
  const prepared = prepareMapForSave(chosen,{geometryDirty:doc.isGeometryDirty(),sceneryDirty:doc.isSceneryDirty()});
  const saved = encodeProjectFile(name,prepared);
  doc.markSaved(prepared,name,null,chosen,'project');
  const reopened = decodeProjectFile(saved);
  checkTime(reopened.map,selected.trial!.sectionTicks!);
  assert.equal(doc.isDirty(),false);
});
