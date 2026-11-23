import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull,serializePms } from '../src/shared/pmsParser';
import { DEFAULT_PLACEMENT_SETTINGS as DEFAULT_PLACEMENT } from '../src/client/editor/types';
import { triangleClick } from '../src/client/editor/polygonDrawing';
import { EditorDocument,emptySelection,translateSelection } from '../src/client/editor/EditorDocument';

test('triangle, strip and fan preserve their next anchors across selection, edits, undo, redo and PMS reload',()=>{
  const points=[{x:0,y:0},{x:20,y:0},{x:1,y:10}], tex={w:128,h:128};
  for(const mode of ['poly_tri','poly_strip','poly_fan'] as const) {
    const doc=new EditorDocument({map:createMapFromTemplate('empty')});
    let anchors:typeof points=[];
    for(const point of points.slice(0,2)) anchors=triangleClick(mode,anchors,point,DEFAULT_PLACEMENT,tex).draft;
    assert.ok(triangleClick(mode,anchors,{x:12,y:0},DEFAULT_PLACEMENT,tex).collinear);
    const drawn=triangleClick(mode,anchors,points[2],DEFAULT_PLACEMENT,tex);
    assert.deepEqual(drawn.draft,mode==='poly_tri' ? [] : [points[mode==='poly_strip' ? 1 : 0],points[2]]);
    const selection={...emptySelection(),polygons:[0]};
    const created={...doc.getSnapshot().map,polygons:[drawn.polygon!]};
    doc.commit({label:'Draw',nextMap:created,nextSelection:selection});
    const edited=translateSelection(created,selection,5,-3);
    doc.commit({label:'Move',nextMap:edited});
    assert.equal(doc.undo().map,created);
    assert.deepEqual(doc.redo().selection,selection);
    const saved=parsePmsFull(serializePms(prepareMapForSave(doc.getSnapshot().map,{geometryDirty:true})));
    assert.equal(saved.polygons[0].vertices[0].x,edited.polygons[0].vertices[0].x);
    assert.equal(saved.parseWarnings.length,0);
  }
});
