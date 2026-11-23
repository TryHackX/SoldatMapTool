import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { createPolygonFromPoints, hasInwardNormals, prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { findPolyJunctions, sealAllPolyJunctions, sealPolyJunction } from '../src/shared/polyJunctions';
import { polygonSignedArea2 } from '../src/shared/polygonGeometry';

const triangle = (...xy: [number,number,number,number,number,number]) =>
  createPolygonFromPoints([{x:xy[0],y:xy[1]},{x:xy[2],y:xy[3]},{x:xy[4],y:xy[5]}]);

test('the two tips under a straight sloping floor overlap while the walkable edge keeps its slope', () => {
  const left = triangle(-40,4,0,0,-40,35);
  const right = triangle(0,0,40,-4,40,29);
  const map = {...createMapFromTemplate('empty'),polygons:[left,right]};
  const [contact] = findPolyJunctions(map.polygons);
  assert.equal(contact.kind,'point');
  assert.equal(contact.moves.length,2);
  assert.deepEqual(contact.polygons,[0,1]);
  const fixed = sealPolyJunction(map,0,0);
  for(const [i,move] of contact.moves.entries()) {
    assert.ok(Math.abs(move.next.y+move.next.x*0.1)<1e-6);
    assert.ok(i === 0 ? move.next.x>1 : move.next.x < -1);
    assert.ok(Math.hypot(move.next.x,move.next.y)<=2.000001);
    assert.ok(polygonSignedArea2(...fixed.polygons[i].vertices)>polygonSignedArea2(...map.polygons[i].vertices));
    assert.ok(Math.abs(move.next.u-move.next.x/128)<1e-12);
    assert.ok(Math.abs(move.next.v-move.next.y/128)<1e-12);
  }
  assert.deepEqual(findPolyJunctions(fixed.polygons),[]);
});

test('tip-to-edge repair moves only the approaching corner and keeps the supporting triangle untouched', () => {
  const host=triangle(-90,0,90,0,0,60), spike=triangle(-20,-26,20,-26,0,0);
  const map={...createMapFromTemplate('empty'),polygons:[host,spike]};
  const [hit] = findPolyJunctions(map.polygons);
  assert.equal(hit.kind,'edge');
  assert.deepEqual(new Set(hit.polygons),new Set([0,1]));
  assert.deepEqual(hit.moves.map(move=>move.polygon),[1]);
  const backdrop = {...triangle(-120,-80,120,-80,0,120),polyType:24};
  assert.equal(findPolyJunctions([...map.polygons,backdrop]).length,1);
  const fixed=sealPolyJunction(map,0,0);
  assert.equal(fixed.polygons[0],host);
  assert.equal(fixed.polygons[1].vertices[hit.moves[0].vertex].y,2);
  assert.equal(findPolyJunctions(fixed.polygons).length,0);
});

test('the scan omits existing overlap, near misses, continuous diagonals and special materials', () => {
  const host=triangle(-90,0,90,0,0,60);
  for(const y of [-0.2,0.2]) {
    assert.equal(findPolyJunctions([host,triangle(-20,-26,20,-26,0,y)]).length,0);
  }
  const source=triangle(-20,-26,20,-26,0,0);
  for(const type of [4,5,7,18]) {
    assert.deepEqual(findPolyJunctions([{...host,polyType:type},source]),[]);
    assert.deepEqual(findPolyJunctions([host,{...source,polyType:type}]),[]);
  }
  assert.deepEqual(findPolyJunctions(makeQuadPolys(0,0,40,20)),[]);
  assert.deepEqual(findPolyJunctions([triangle(0,0,20,0,0,10),triangle(0,0,0,-10,8,0)]),[]);
  assert.deepEqual(findPolyJunctions([host,triangle(0,0,40,0,4,-20)]),[]);
  assert.deepEqual(findPolyJunctions([host,source,triangle(-5,-5,5,-5,1,6)]),[]);
});

test('batch repair rechecks contacts sharing a polygon and commits exactly one undoable change', () => {
  const map={...createMapFromTemplate('empty'),polygons:[
    triangle(-90,0,90,0,0,60),
    triangle(-44,-20,-14,-20,-30,0),
    triangle(10,-20,40,-20,28,0),
    triangle(95,10,140,10,95,42), triangle(140,10,190,10,190,45)
  ]};
  assert.equal(findPolyJunctions(map.polygons).length,3);
  const original=serializePms(prepareMapForSave(map,{geometryDirty:true}));
  const doc=new EditorDocument({map});
  const result=sealAllPolyJunctions(map);
  assert.equal(result.count,3);
  const snapshot=doc.commit({label:'Seal all polygon contacts',nextMap:result.map});
  assert.equal(snapshot.undoStack.length,1);
  const disk=parsePmsFull(serializePms(prepareMapForSave(snapshot.map,{geometryDirty:true})));
  assert.ok(disk.polygons.every(hasInwardNormals));
  assert.deepEqual(findPolyJunctions(disk.polygons),[]);
  assert.deepEqual(serializePms(prepareMapForSave(doc.undo().map,{geometryDirty:true})),original);
  assert.equal(doc.redo().map,result.map);
  assert.equal(sealAllPolyJunctions(result.map).map,result.map);
});
