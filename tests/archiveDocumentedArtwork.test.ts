import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetBindings, type CatalogFile, type ImageInfo } from '../src/server/archiveBindings';
import { findDocumentedArtwork } from '../src/server/archiveDocumentedArtwork';

const scope='example.zip';
const texture: CatalogFile = {
  kind:'texture', name:'sunnypath.bmp', path:scope+'!/textures/sunnypath.bmp', scope, size:221238, mtimeMs:0,
  sha256:'830c440c99d135aa68cd9222b353fd328a954b6f75d03bebfaf7e416dcfc167c',
};
const map: CatalogFile = {
  kind:'map', name:'SunnyPath.PMS', path:scope+'!/maps/SunnyPath.PMS', scope, size:125316, mtimeMs:0,
  sha256:'a944a0bf09369ed91dde1c2aa4eb5d3fbdc80847156695ebf2327d8e91734eeb',
};
const images = new Map<string,ImageInfo|null>([[texture.sha256,{ext:'.bmp',width:128,height:432}]]);

test('archival correction needs the original PMS and the documented, decoded graphic in its package', () => {
  const bindings = new AssetBindings();
  bindings.add(texture);
  const found=findDocumentedArtwork(map,'texture','lagrange2.bmp',bindings,images);
  assert.equal(found?.file,texture);
  assert.equal(found?.edge,undefined);
  assert.match(found!.evidence,/SunnyPath\/Info\.txt/);
  assert.match(found!.evidence,/download=303/);
  assert.equal(findDocumentedArtwork({...map,sha256:'different'},'texture','lagrange2.bmp',bindings,images),undefined);
  assert.equal(findDocumentedArtwork(map,'texture','lagrange.bmp',bindings,images),undefined);
  assert.equal(findDocumentedArtwork({...map,scope:'another.zip'},'texture','lagrange2.bmp',bindings,images),undefined);
  assert.equal(findDocumentedArtwork(map,'texture','lagrange2.bmp',bindings,new Map()),undefined);
});

test('an original local texture, conflicting graphic or undocumented edge preserves the package for review', () => {
  for (const entries of [
    [{...texture,sha256:'different'}],
    [texture,{...texture,name:'lagrange2.bmp'}],
    [texture,{...texture,kind:'edge' as const}],
    [texture,{...texture,name:'sunnypath.png',sha256:'other-hd-override'}],
  ]) {
    const bindings=new AssetBindings();
    for(const file of entries) bindings.add(file);
    assert.equal(findDocumentedArtwork(map,'texture','lagrange2.bmp',bindings,images),undefined);
  }
});
