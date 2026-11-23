import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { createPolygonFromPoints, prepareMapForSave, hasInwardNormals } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { findPolyJunctions, sealAllPolyJunctions, sealPolyJunction } from '../src/shared/polyJunctions';

const triangle = (...v:[number,number,number,number,number,number]) =>
  createPolygonFromPoints([{x:v[0],y:v[1]},{x:v[2],y:v[3]},{x:v[4],y:v[5]}]);
const left = triangle(-40,4,0,0,-40,35);
const right = triangle(0.4,-0.04,40,-4,40,29);
const host = triangle(-40,64.1,40,64.1,0,120);
const spike = triangle(-20,39,20,39,0,63.7);

test('tolerance spans spatial buckets and applies exactly the preview, with a two-unit travel cap', () => {
  const map={...createMapFromTemplate('empty'),polygons:[left,right,host,spike]};
  assert.deepEqual(findPolyJunctions(map.polygons),[]);
  assert.deepEqual(findPolyJunctions(map.polygons,0.39),[]);
  const hits=findPolyJunctions(map.polygons,0.5);
  assert.deepEqual(hits.map(j=>j.kind),['point','edge']);
  assert.ok(hits.every(j=>(j.gap ?? 0)>0.39 && (j.gap ?? 0)<0.41));
  for (const hit of hits) {
    assert.equal(sealPolyJunction(map,hit.x,hit.y),map);
    const applied=sealPolyJunction(map,hit.x,hit.y,0.5);
    for (const {polygon,vertex,next} of hit.moves) {
      assert.deepEqual(applied.polygons[polygon].vertices[vertex],next);
      const before=map.polygons[polygon].vertices[vertex];
      assert.ok(Math.hypot(next.x-before.x,next.y-before.y)<=2.000001);
      assert.ok(Math.abs(next.u-next.x/128)<1e-9 && Math.abs(next.v-next.y/128)<1e-9);
    }
  }
  const fixed=sealAllPolyJunctions(map,0.5);
  assert.equal(fixed.count,2);
  assert.equal(fixed.map.polygons[2],host);
  const restored=parsePmsFull(serializePms(prepareMapForSave(fixed.map,{geometryDirty:true})));
  assert.ok(restored.polygons.every(hasInwardNormals));
  assert.equal(findPolyJunctions(restored.polygons,0.5).length,0);
});

test('near parallel seams, closed fans, mixed materials, overlaps and gaps over one unit are excluded', () => {
  const fan=[triangle(0,0,-20,0,0,-20),triangle(0,0,0,-20,20,0),
    triangle(0,0,20,0,0,20),triangle(0,0,0,20,-20,0)];
  const irregular=[
    fan,
    makeQuadPolys(0,0,40,20),
    [triangle(0,0,20,0,0,20),triangle(0,20.4,20,0.4,20,20.4)],
    [left,{...right,polyType:18}],
    [left,right,triangle(0.15,0,0.15,9,-12,8)],
    [host,{...spike,polyType:7}],
    [host,triangle(-20,39,20,39,0,64.5)],
    [host,triangle(-20,39,20,39,0,62)],
    [left,right,{...triangle(0.4,-0.04,0,-25,12,-20),polyType:5}],
  ];
  for (const polys of irregular) assert.deepEqual(findPolyJunctions(polys,100),[]);
  for (const invalid of [Infinity,NaN,-1]) assert.deepEqual(findPolyJunctions([left,right],invalid),[]);
});
