import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { SoldatMapEditorService } from '../src/server/editorService';
import { GeneratedOutputRegistry } from '../src/server/safeFileWriter';
import { moveDuplicateMaps } from '../src/server/libraryTools';
import { parsePmsFull, serializePms } from '../src/shared/pmsParser';
import { buildSyntheticPms } from './helpers';
import { clearSoldatAssetCache, loadSoldatAssetImage } from '../src/client/renderer/assetLoader';
import { mapAssetSource, renderNameKey, setMapAssetSource, thumbnailUrl } from '../src/client/renderer/mapAssetSource';
import { clearClientMapCaches, fetchAndParseMap } from '../src/client/utils/mapCache';

test('same PMS bytes from two packages resolve their own HD/classic, edge, new scenery and thumbnail',async t=>{
  const base=await fs.mkdtemp(path.join(tmpdir(),'soldat-scoped-render-'));
  const game=path.join(base,'game'),external=path.join(base,'external'),cache=path.join(base,'cache'),thumbs=path.join(cache,'thumbnails');
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const sample=parsePmsFull(buildSyntheticPms({props:1,scenery:['leaf.bmp']}));
  sample.texture='stone.bmp';
  const bytes=serializePms(sample);
  for(const pack of [game,path.join(external,'alpha'),path.join(external,'beta')]){
    for(const f of ['maps/one.pms','scenery-gfx/leaf.bmp','scenery-gfx/leaf.png','scenery-gfx/new.png','textures/stone.bmp','textures/stone.png','textures/edges/stone.bmp','textures/edges/stone.png','textures/default.bmp']){
      const file=path.join(pack,f);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,f==='maps/one.pms'?bytes:Buffer.from(pack));
    }
  }
  await fs.mkdir(thumbs,{recursive:true});
  await fs.writeFile(path.join(external,'alpha','scenery-gfx','only-alpha.png'),'local only');
  const scanner=new SoldatMapScanner(game,[{id:'s',label:'Extra',path:external,enabled:true,recursive:true}],[],cache,thumbs);
  try{
    await scanner.scanAsync(true);
    const maps=scanner.getAllEntries(),resolver=scanner.getResolver(),stock=maps.find(m=>m.sourceId==='soldat')!;
    const service = new SoldatMapEditorService(scanner,base,cache,base,new GeneratedOutputRegistry(path.join(cache,'outputs.json')));
    const alpha = maps.find(m=>m.fullPath===path.join(external,'alpha','maps','one.pms'))!;
    assert.ok(service.listAssets(alpha.id).sceneries.some(s=>s.name==='only-alpha.png' && !s.isVanilla));
    assert.equal(service.listAssets(stock.id).sceneries.some(s=>s.name==='only-alpha.png'),false);
    assert.equal(service.listAssets(alpha.id).sceneries.find(s=>s.name==='leaf.png')!.sizeBytes,Buffer.byteLength(path.join(external,'alpha')));
    assert.equal(maps.length,3);assert.equal(new Set(maps.map(m=>m.crc32)).size,1);
    assert.deepEqual(scanner.getDuplicateEntryGroups(),[], 'a different package artwork is a different version');
    const crc=stock.crc32.toString(16),keys=maps.map(m=>scanner.thumbnailKey(crc,m.id)!);
    assert.equal(new Set(keys).size,3);assert.equal(scanner.thumbnailKey(crc,stock.id),crc);
    for(const m of maps){
      const root=resolver.packageRootForMap(m.fullPath,m.sourceId),expected=path.dirname(path.dirname(m.fullPath));
      for(const category of ['textures','textures/edges','scenery-gfx'] as const){
        const n=category==='scenery-gfx'?'leaf':'stone';
        assert.equal(resolver.findBestRenderFile(category,n+'.bmp',false,root)?.fullPath,path.join(expected,category,n+'.png'));
        assert.equal(resolver.findBestRenderFile(category,n+'.bmp',true,root)?.fullPath,path.join(expected,category,n+'.bmp'));
      }
      assert.equal(resolver.findBestRenderFile('scenery-gfx','new.png',false,root)?.fullPath,path.join(expected,'scenery-gfx','new.png'));
      assert.equal(resolver.findBestRenderFile('textures','absent.png',true,root)?.fullPath,path.join(expected,'textures','default.bmp'));
    }
    const chosen=maps.find(m=>m.sourceId!=='soldat')!,key=scanner.thumbnailKey(crc,chosen.id)!;
    scanner.markThumbnailCached(key);
    assert.deepEqual(maps.filter(m=>m.hasThumbnail).map(m=>m.id),[chosen.id]);
    await fs.writeFile(path.join(thumbs,key+'.webp'),'thumb');
    await scanner.scanAsync(true);assert.equal(scanner.getMapEntry(chosen.id)?.hasThumbnail,true);
    await fs.writeFile(path.join(path.dirname(path.dirname(chosen.fullPath)),'textures','stone.png'),'updated asset with another size');
    await scanner.scanAsync(true);assert.notEqual(scanner.thumbnailKey(crc,chosen.id),key);assert.equal(scanner.getMapEntry(chosen.id)?.hasThumbnail,false);
    const sampleRoot=path.join(external,'alpha'), twinRoot=path.join(external,'twin');
    await fs.cp(sampleRoot,twinRoot,{recursive:true});
    await scanner.scanAsync(true);
    const groups=scanner.getDuplicateEntryGroups();assert.equal(groups.length,1);
    assert.deepEqual(groups[0].map(e=>path.basename(path.dirname(path.dirname(e.fullPath)))).sort(),['alpha','twin']);
    const twin=groups[0].find(e=>e.fullPath.startsWith(twinRoot+path.sep))!;
    await fs.writeFile(path.join(twinRoot,'textures','edges','stone.png'),'different edge after scan');
    await assert.rejects(moveDuplicateMaps(scanner,[twin.id],path.join(base,'backups')),{status:409});
    assert.deepEqual(await fs.readFile(twin.fullPath),Buffer.from(bytes));
  }finally{scanner['sqliteCache'].close();}
});
test('client scoped assets survive editor copies, stay out of PMS/JSON and cannot cross decoded image caches',async t=>{
  clearClientMapCaches();clearSoldatAssetCache();const bytes=buildSyntheticPms({props:1});
  const urls:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:string)=>{
    urls.push(url);
    return url.includes('/raw')?new Response(Uint8Array.from(bytes),{headers:{'X-Soldat-Asset-Scope':'package-a'}}):new Response(null,{status:404});
  });
  try{
    const a=await fetchAndParseMap('external:alpha:one'),b=parsePmsFull(bytes);
    setMapAssetSource(b,'external:beta:one','package-b');
    const sa=mapAssetSource({...a})!,sb=mapAssetSource(b)!;assert.equal(sa.key,'package-a');
    assert.equal(JSON.stringify(a).includes('package-a'),false);
    assert.deepEqual(serializePms(a),serializePms(b));
    assert.notEqual(renderNameKey('Tile.bmp',sa),renderNameKey('Tile.bmp',sb));
    assert.notEqual(renderNameKey('Tile.bmp',sa),renderNameKey('tile.bmp',sa));
    assert.notEqual(renderNameKey('Tile.bmp'),renderNameKey('tile.bmp'));
    await loadSoldatAssetImage('textures','Tile.bmp',false,false,false,sa);
    await loadSoldatAssetImage('textures','Tile.bmp',false,false,false,{...sa,mapId:'other map in alpha'});
    await loadSoldatAssetImage('textures','Tile.bmp',false,false,false,sb);
    assert.equal(urls.filter(u=>u.includes('/api/assets')).length,4);
    assert.equal(urls.filter(u=>u.includes('mapId=external%3Aalpha%3Aone')).length,2);
    assert.equal(urls.filter(u=>u.includes('mapId=external%3Abeta%3Aone')).length,2);
    assert.notEqual(thumbnailUrl(123,sa.mapId),thumbnailUrl(123,sb.mapId));
  }finally{clearSoldatAssetCache();clearClientMapCaches();}
});
test('a temporary artwork failure can retry without purging the entire library cache', async t=>{
  clearSoldatAssetCache();
  let calls=0,now=100;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:503});});
  try {
    await loadSoldatAssetImage('textures','unavailable.bmp',false);
    assert.equal(calls,2); // native format and PNG fallback
    await loadSoldatAssetImage('textures','unavailable.bmp',false);
    assert.equal(calls,2);
    now+=6000;
    await loadSoldatAssetImage('textures','unavailable.bmp',false);
    assert.equal(calls,4);
  } finally {clearSoldatAssetCache();}
});
