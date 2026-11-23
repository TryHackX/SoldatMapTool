import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReferenceMap } from '../src/shared/referenceMapGenerator';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { isClockwisePolygon, prepareMapForSave } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { runReferencePilot } from '../src/client/editor/referencePilot';
import type {ReferenceJob,ReferenceReply} from '../src/client/editor/referenceMap.worker';
const options = { seed: 123, variation: 65, look: 0 };
test('composing references preserves both case-sensitive scenery styles and reports their origins', () => {
  const warm=fixture(false),cold=fixture(true);
  warm.scenery[0].filename='Fern.png';
  cold.scenery[0].filename='fern.png';
  const result=generateReferenceMap([warm,cold],options);
  const file=parsePmsFull(serializePms(result.map));
  assert.deepEqual(new Set(file.scenery.map(s=>s.filename)),new Set(['Fern.png','fern.png']));
  assert.deepEqual(new Set(result.scenerySources),new Set([0,1]));
  assert.deepEqual(generateReferenceMap([warm,cold],{...options,look:1,layout:'reshape'}).scenerySources,[0]);
});
test('reference worker carries the visual package to the editor and identifies mixed scenery folders', async t => {
  const messages:ReferenceReply[]=[];
  const worker = {onmessage:undefined as undefined|((e:{data:ReferenceJob})=>Promise<void>),
    postMessage:(message:ReferenceReply)=>messages.push(message)};
  const before = Object.getOwnPropertyDescriptor(globalThis,'self');
  Object.defineProperty(globalThis,'self',{configurable:true,value:worker});
  t.after(()=>{if(before)Object.defineProperty(globalThis,'self',before);else Reflect.deleteProperty(globalThis,'self');});
  const bytes = [fixture(false),fixture(true)].map(serializePms);
  const sources = bytes.map((b,i)=>({id:String(i),baseName:String(i),crc32:parsePmsFull(b).crc32}));
  const keys = ['first','second'];
  t.mock.method(globalThis,'fetch',async (url:string)=>{
    const i=Number(url.split('/')[3]);
    return new Response(Uint8Array.from(bytes[i]),{headers:{'X-Soldat-Asset-Scope':keys[i]}});
  });
  await import('../src/client/editor/referenceMap.worker');
  for(const mixed of [true,false]){
    if(!mixed)keys[0]='second';
    await worker.onmessage!({data:{kind:'generate',sources,options:{...options,look:1}}});
    const reply=messages.at(-1)!;
    assert.equal(reply.kind,'map');
    if(reply.kind==='map'){
      assert.deepEqual(reply.assetSource,{mapId:'1',key:'second'});
      assert.equal(reply.mixedSceneryPackages,mixed);
    }
  }
});
test('invisible collision geometry does not dye visible rock in the reference palette', () => {
  const base = fixture(false);
  function sample(r:number,g:number) {
    const look = fixture(true);
    const hidden = {r,g,b:0,a:0};
    look.polygons = [...look.polygons, ...makeQuadPolys(0,100,1200,150,{topColor:hidden,bottomColor:hidden})];
    return generateReferenceMap([base,look],{...options,layout:'reshape',look:1}).map;
  }
  const colors=(m:typeof base)=>m.polygons.map(p=>p.vertices.map(v=>v.color));
  assert.deepEqual(colors(sample(255,0)),colors(sample(0,255)));
});
function fixture(cold: boolean) {
  const m = createMapFromTemplate('empty');
  const color = cold ? { r: 20, g: 140, b: 240, a: 255 } : { r: 230, g: 110, b: 60, a: 255 };
  m.texture = cold ? 'ice.bmp' : 'earth.bmp';
  m.weather = cold ? 2 : 0;
  m.bgColorTop = { ...color };
  m.startJet = cold ? 0 : 120;
  m.polygons = Array.from({ length: 12 }, (_, i) => makeQuadPolys(i * 100, 100, i * 100 + 100, 150, { topColor: color, bottomColor: color })).flat();
  for (let i = 0; i < 10; i++)
    m.polygons.push(...makeQuadPolys(55 + i * 108, -60 - (i % 3) * 12, 77 + i * 108, -47 - (i % 3) * 12, { topColor: color, bottomColor: color, polyType: cold ? 18 : 4, bounciness: cold ? 1.75 : 1 }));
  m.spawnpoints = [{ index: 0, active: true, team: 1, x: 30, y: 78 }, { index: 1, active: true, team: 6, x: 1170, y: 83 }];
  m.scenery = [{ index: 1, filename: cold ? 'crystal.png' : 'fern.png', date: 0, usedCount: 12 }];
  m.props = Array.from({ length: 12 }, (_, i) => ({ index: i, active: true, style: 1, width: 16, height: 8, x: 20 + i * 100, y: 85,
    rotation: 0, scaleX: 1, scaleY: 1, alpha: 255, color, level: 1 }));
  return prepareMapForSave(m, { geometryDirty: true });
}
test('pool drives terrain, materials and props while the visual reference controls sky, texture and palette', () => {
  const warm = fixture(false), cold = fixture(true), original = serializePms(warm);
  const { map, report } = generateReferenceMap([warm, cold], { ...options, look: 1 });
  const saved = parsePmsFull(serializePms(map));
  assert.deepEqual(serializePms(warm), original);
  assert.ok(report.fromSources.every(n => n > 0));
  assert.ok(report.recombined > 0);
  assert.equal(saved.texture, cold.texture);
  assert.equal(saved.weather, cold.weather);
  assert.deepEqual(saved.bgColorTop, cold.bgColorTop);
  assert.equal(saved.startJet, warm.startJet);
  assert.deepEqual(saved.spawnpoints.map(s => s.team).sort(), [1, 6]);
  assert.deepEqual(new Set(saved.scenery.map(s => s.filename)), new Set(['crystal.png', 'fern.png']));
  assert.ok(saved.props.every(p => p.style > 0 && p.style <= saved.scenery.length));
  assert.ok(saved.polygons.every(isClockwisePolygon));
  assert.ok(saved.polygons.some(p => p.polyType === 18 && Math.abs(p.bounciness - 1.75) < 0.001));
  assert.ok(saved.sectorsPolys?.some(s => s.length > 0));
  assert.deepEqual(saved.parseWarnings, []);
  const warmLook = generateReferenceMap([warm, cold], options).map;
  assert.deepEqual(warmLook.polygons.map(p => p.vertices.map(v => [v.x, v.y])), map.polygons.map(p => p.vertices.map(v => [v.x, v.y])));
  assert.notDeepEqual(warmLook.polygons.map(p => p.vertices[0].color), map.polygons.map(p => p.vertices[0].color));
});
test('one source produces a new reproducible composition and different seeds change the actual mesh', () => {
  const source = fixture(false);
  const first = generateReferenceMap([source], options), repeat = generateReferenceMap([source], options);
  assert.ok(first.report.recombined > 0);
  assert.deepEqual(serializePms(first.map), serializePms(repeat.map));
  const outline = (m: typeof source) => m.polygons.map(p => p.vertices.map(v => [v.x, v.y]));
  assert.notDeepEqual(outline(first.map), outline(source));
  assert.notDeepEqual(outline(first.map), outline(generateReferenceMap([source], { ...options, seed: 124 }).map));
  assert.ok(runReferencePilot(parsePmsFull(serializePms(first.map)))?.reached);
});
test('vertical maps retain their orientation and an impassable wall is not reported as a successful run', () => {
  const src = fixture(false);
  const wall = { ...src, startJet: 0, polygons: [...src.polygons, ...makeQuadPolys(560, -900, 620, 1700),
      ...makeQuadPolys(1100, 0, 1200, 90)] };
  const long = prepareMapForSave(wall, { geometryDirty: true });
  const result = generateReferenceMap([long], options);
  assert.ok(result.map.polyBounds.height > result.map.polyBounds.width);
  assert.ok(!runReferencePilot(long)?.reached);
  assert.throws(() => generateReferenceMap([createMapFromTemplate('empty')], options), /measurable/);
  assert.throws(() => generateReferenceMap([], { ...options, look: 3 }), /settings/);
});
test('preserving passages deforms shared corners together and retains the original waypoint graph', () => {
  const warm = fixture(false), cold = fixture(true);
  const wp = { index: 1, id: 1, x: 20, y: 70, active: true, left: false, right: true, up: false, down: false, jetpack: false, pathNum: 1, action: 0, connections: [2] };
  warm.waypoints = [wp, { ...wp, id: 2, index: 2, x: 300, connections: [] }];
  const { map, report } = generateReferenceMap([warm, cold], { ...options, layout: 'reshape', look: 1 });
  const saved = parsePmsFull(serializePms(map));
  assert.equal(saved.polygons.length, warm.polygons.length);
  assert.equal(saved.props.length, warm.props.length);
  assert.equal(saved.texture, cold.texture);
  assert.deepEqual(saved.waypoints.map(w => w.connections), [[2], []]);
  assert.deepEqual(saved.spawnpoints.map(s => s.team), [1, 6]);
  assert.ok(report.fromSources.every(n => n > 0));
  const corners = new Map<string, string>();
  warm.polygons.forEach((p, i) => p.vertices.forEach((original, j) => {
    const key = original.x + ',' + original.y, v = saved.polygons[i].vertices[j], after = v.x + ',' + v.y;
    if (corners.has(key))
      assert.equal(corners.get(key), after);
    corners.set(key, after);
  }));
  assert.ok([...corners].some(([before, after]) => before !== after));
});
