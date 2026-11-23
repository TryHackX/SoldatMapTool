import assert from 'node:assert/strict';
import test from 'node:test';
import { ArchiveLegacyScenery } from '../src/server/archiveLegacyScenery';
import { AssetBindings, type CatalogFile, type ImageInfo } from '../src/server/archiveBindings';

const map=(scope:string,sha256:string):CatalogFile=>({scope,sha256,kind:'map',name:'level.pms',path:scope+'/level.pms',size:100,mtimeMs:0});
const target=map('original','map-bytes');
const copy=map('another edition','map-bytes'), witness=map('different level','other-map-bytes');
const reference={used:true,width:75,height:70,date:896510987,name:'VEG_DE~1.PNG'};

function fixture() {
  const entries:CatalogFile[]=[], images=new Map<string,ImageInfo>();
  function asset(scope:string,name:string,hash:string,width=75,height=70) {
    const file:CatalogFile={kind:'scenery',scope,sha256:hash,name,path:scope+'/scenery-gfx/'+name,size:1,mtimeMs:0};
    entries.push(file);
    images.set(hash,{width,height,ext:'.png'});
    return file;
  }
  const build=(otherName='veg_dead_4.png',otherDate=reference.date)=>{
    const index=new AssetBindings();
    entries.forEach(f=>index.add(f));
    return new ArchiveLegacyScenery([target,copy,witness],index,images,
      sha=>sha===witness.sha256?[{...reference,name:otherName,date:otherDate}]:[reference]);
  };
  return {asset,build};
}

test('DOS codepage alias needs intrinsic dimensions and an original map edition carrying the graphic',()=>{
  const ref={...reference,name:'HBM_cegły.png'};
  const f=fixture();
  f.asset('different level','HBM_cegêy.png','right');
  assert.equal(f.build().find(target,ref),null);
  const owned=f.asset(copy.scope,'HBM_cegêy.png','right');
  assert.equal(f.build().find(target,ref)?.file.path,owned.path);
  assert.equal(f.build().find(target,{...ref,width:10}),null);
  f.asset('unrelated','HBM_cegêy.png','different');
  assert.equal(f.build().find(target,ref),null);
});

test('short name ignores its directory-dependent serial and checks the content and dated long-name witness',()=>{
  const f=fixture();
  f.asset(target.scope,'veg_dead_1.png','narrow',25,75);
  f.asset(copy.scope,'veg_dead_4.png','wide');
  f.asset(witness.scope,'veg_dead_4.png','wide');
  assert.equal(f.build().find(target,reference)?.file.sha256,'wide');
  assert.equal(f.build('veg_dead_4.png',reference.date+1).find(target,reference),null);
  f.asset('another family member','veg_ dead_8.png','alternative');
  assert.equal(f.build().find(target,reference),null);
});

test('the alternative name and its dated witness can exist exclusively in map-library packages',()=>{
  const archive=new AssetBindings(), library=new AssetBindings();
  const images=new Map<string,ImageInfo|null>([['confirmed',{ext:'.png',width:75,height:70}]]);
  const releases=[copy,witness].map(m=>({...m,scope:m.scope+'.zip',path:m.scope+'.zip!/maps/level.pms'}));
  for(const map of releases) library.add({
    kind:'scenery',scope:map.scope,name:'veg_dead_4.png',path:map.scope+'/scenery-gfx/veg_dead_4.png',
    sha256:'confirmed',mtimeMs:0,size:10,
  });
  const external={maps:releases,bindings:library,images,references:(sha:string)=>[
    {...reference,name:sha===copy.sha256 ? reference.name : 'veg_dead_4.png'},
  ]};
  const run=()=>new ArchiveLegacyScenery([target],archive,images,()=>[reference],external).find(target,reference);
  assert.equal(run()?.external,true);
  assert.equal(run()?.file.sha256,'confirmed');
  const installation={...external,maps:releases.map(m=>({...m,path:m.scope+'/maps/loose.pms'}))};
  assert.equal(new ArchiveLegacyScenery([target],archive,images,()=>[reference],installation).find(target,reference),null);
  const otherHash='contradictory pixels';
  images.set(otherHash,{ext:'.png',width:75,height:70});
  archive.add({kind:'scenery',scope:'other',name:'veg_dead_8.png',path:'other/scenery-gfx/veg_dead_8.png',
    sha256:otherHash,size:23,mtimeMs:0});
  assert.equal(run(),null);
});
