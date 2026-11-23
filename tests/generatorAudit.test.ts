import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_MODES, DEFAULT_COURSE, drawCourse, generateCourseMap, sampleCoursePath } from '../src/shared/courseGenerator';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { createPolygonFromPoints, earClipTriangulate, hasInwardNormals, polygonSignedArea2, prepareMapForSave } from '../src/shared/pmsCompiler';
import { findPolyJunctions, sealPolyJunction } from '../src/shared/polyJunctions';
import { EditorDocument } from '../src/client/editor/EditorDocument';
import { assignKey, defaultKeys, parseBindings } from '../src/client/editor/shortcutBindings';
import { clearClientMapCaches, fetchAndParseMap } from '../src/client/utils/mapCache';
import { validateMapDocument } from '../src/shared/mapValidator';

test('the four generators produce reproducible editable PMS maps with spawns and valid collision sectors', () => {
  for (const mode of COURSE_MODES) for (const seed of [0, 1, 42, 9876]) {
    const make = () => generateCourseMap(mode, {...DEFAULT_COURSE, seed}, {title:'Test map',texture:'ground.bmp'});
    const map = make(), bytes = serializePms(map);
    assert.deepEqual(bytes, serializePms(make()));
    const restored = parsePmsFull(bytes);
    assert.equal(restored.parseWarnings.length, 0);
    assert.ok(restored.polygons.every(p => polygonSignedArea2(...p.vertices) > 0 && hasInwardNormals(p)));
    assert.ok(restored.sectorsPolys?.some(sector => sector.length > 0));
    assert.ok(!validateMapDocument(restored).some(issue => issue.severity === 'error' || issue.id.startsWith('spawn_inside_poly_')));
    for (const team of mode === 'symmetric' ? [0] : mode === 'climb' ? [1,5,6] : [1,2,5,6]) {
      assert.ok(restored.spawnpoints.some(s => s.active && s.team === team));
    }
    if (mode === 'symmetric') {
      const key = (vs: {x:number;y:number}[]) => vs.map(v => [v.x,v.y].join('/')).sort().join(',');
      const faces = new Set(map.polygons.map(p => key(p.vertices)));
      for (const p of map.polygons) assert.ok(faces.has(key(p.vertices.map(v => ({...v,x:-v.x})))));
    }
  }
});

test('drawn course uses world distance independent of mouse event frequency and safe endpoints', () => {
  const line = [{x:0,y:0},{x:600,y:0}];
  const dense = Array.from({length:61}, (_,i) => ({x:i*10,y:0}));
  assert.deepEqual(sampleCoursePath(line,60), sampleCoursePath(dense,60));
  for (const [key, type] of [['deadly',5],['hurt',7],['bounce',18]] as const) {
    const settings = {...DEFAULT_COURSE, deadly:0, hurt:0, bounce:0, [key]:100};
    const polys = drawCourse(dense, settings);
    assert.ok(polys.some(p => p.polyType === type));
    assert.equal(polys[0].polyType,0);
    assert.equal(polys.at(-1)!.polyType,0);
    assert.deepEqual(polys, drawCourse(line, settings));
  }
  assert.deepEqual(sampleCoursePath([{x:0,y:0},{x:1e7,y:0}],36), []);
  assert.deepEqual(drawCourse([{x:1,y:4},{x:1,y:4}],DEFAULT_COURSE),[]);
});

test('long laser outline preserves area and distributes diagonals, ambiguous loops produce no faces', () => {
  const ring = Array.from({length:36}, (_,i) => ({
    x: 270 * Math.cos(2*Math.PI*i/36), y: 50 * Math.sin(2*Math.PI*i/36),
  }));
  const tris = earClipTriangulate(ring);
  assert.equal(tris.length, ring.length-2);
  const incidence = new Map<string, number>();
  for (const tri of tris) for (const v of tri) {
    const k = v.x + '/' + v.y;
    incidence.set(k, (incidence.get(k) ?? 0) + 1);
  }
  assert.ok(Math.max(...incidence.values()) < ring.length / 3);
  const twiceArea = ring.reduce((sum,p,i) => {const q=ring[(i+1)%ring.length];return sum+p.x*q.y-q.x*p.y;},0);
  assert.ok(Math.abs(tris.reduce((sum,tri) => sum+polygonSignedArea2(...tri),0)-twiceArea) < 1e-6);
  assert.deepEqual(earClipTriangulate([{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]),[]);
  assert.deepEqual(earClipTriangulate([{x:0,y:0},{x:4,y:0},{x:10,y:0}]),[]);
});

test('Poly Fixer repairs exposed contacts, preserves an enclosed fan and supports undo', () => {
  const origin={x:0,y:0}, points=[{x:25,y:0},{x:0,y:25},{x:-25,y:0},{x:0,y:-25}];
  const fan = points.map((p,i) => createPolygonFromPoints([origin,p,points[(i+1)%4]]));
  const polygons = [fan[0],fan[2]];
  const map = {...createMapFromTemplate('empty'),polygons};
  assert.equal(findPolyJunctions(polygons).length,1);
  assert.equal(findPolyJunctions(fan).length,0);
  assert.equal(findPolyJunctions(makeQuadPolys(0,0,20,20)).length,0);
  assert.equal(findPolyJunctions([{...polygons[0],polyType:18},...polygons.slice(1)]).length,0);
  const sealed=sealPolyJunction(map,0,0);
  assert.equal(findPolyJunctions(sealed.polygons).length,0);
  assert.ok(sealed.polygons.every((p,i) => polygonSignedArea2(...p.vertices) > polygonSignedArea2(...polygons[i].vertices)));
  assert.equal(sealPolyJunction(sealed,0,0),sealed);
  const doc=new EditorDocument({map});
  doc.commit({label:'Seal polygon junction',nextMap:sealed});
  assert.equal(doc.undo().map,map);
  assert.equal(doc.redo().map,sealed);
  const saved=parsePmsFull(serializePms(prepareMapForSave(sealed,{geometryDirty:true})));
  assert.ok(saved.polygons.every(hasInwardNormals));
});

test('tool key swaps persist and invalid profiles safely restore defaults', () => {
  const swapped = assignKey(defaultKeys,'poly_laser','V');
  assert.equal(swapped.select,'X');
  assert.equal(swapped.poly_laser,'V');
  assert.deepEqual(parseBindings(JSON.stringify(swapped)),swapped);
  assert.equal(assignKey(defaultKeys,'poly_laser','G'),defaultKeys);
  assert.equal(parseBindings(JSON.stringify({...defaultKeys,select:'X'})),defaultKeys);
});

test('a raw map request completing after rescan cannot replace the current cached version', async t => {
  clearClientMapCaches();
  const a=serializePms(createMapFromTemplate('arena',{title:'before'}));
  const b=serializePms(createMapFromTemplate('empty',{title:'after'}));
  let finish!: (value: Response) => void;
  const pending=new Promise<Response>(resolve => {finish=resolve;});
  let requests=0;
  t.mock.method(globalThis,'fetch', () => ++requests === 1 ? pending : Promise.resolve(new Response(new Uint8Array(b))));
  const old=fetchAndParseMap('one');
  clearClientMapCaches();
  assert.equal((await fetchAndParseMap('one')).mapName,'after');
  finish(new Response(new Uint8Array(a)));
  await old;
  assert.equal((await fetchAndParseMap('one')).mapName,'after');
  assert.equal(requests,2);
  clearClientMapCaches();
});
