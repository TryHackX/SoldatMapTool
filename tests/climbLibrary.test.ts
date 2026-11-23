import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MapIndexEntry } from '../src/shared/apiTypes';
import { createMapFromTemplate, makeQuadPolys } from '../src/shared/editorTemplates';
import { serializePms, soldatCrc32 } from '../src/shared/pmsParser';
import { isLibrarySnapshot } from '../src/shared/climbLibrary';
import { DEFAULT_TUNNEL, NEW_TUNNEL_SETTINGS } from '../src/shared/climbTunnel';
import { buildTimedCourse } from '../src/client/editor/timedTunnelCourse';
import { encodeProjectFile, decodeProjectFile } from '../src/client/editor/projectFile';
import type { ClimbGeometryProfile } from '../src/shared/climbSamples';
import type { StyleDistribution } from '../src/shared/climbLibrary';
import { isTunnelSettings } from '../src/shared/tunnelSketch';
import { auditKey, climbFamilies, creditedAuthors, groupFamilies, inferredMode } from '../src/server/climbCollections';
import { loadClimbProfile } from '../src/server/courseProfile';
import { reviewSample } from '../src/server/climbReview';

function entry(name: string, crc32: number, extra: Partial<MapIndexEntry> = {}): MapIndexEntry {
  return { id: name, baseName: name, fullPath: name + '.pms', sourceId: 'main', sourceLabel: 'Local',
    crc32, fileSize: 900, mtimeMs: 1, title: '', polygonCount: 10, modeGroupId: 'climb',
    startJetGame: 0, polyTypeCounts: {0:8,5:2}, spawnTeamCounts: {1:1,2:1,5:1,6:1}, ...extra } as MapIndexEntry;
}

test('workshop variants, renamed copies and credited coauthors cannot cross the evaluation split', () => {
  const rows = [
    entry('kz_long_example_abcdefghijkl', 1, {title: 'Climb by Ana & Ben'}),
    entry('kz_long_exampl_f', 2, {favorite:true}),
    entry('renamed', 1), entry('kz_river', 3, { title: 'Jump by Ben' }),
    entry('kz_hills',4,{tags:['author:Ana']}), entry('kz_ice',5), entry('kz_fire',6),
    entry('ctf_kz_ice_v2',7), entry('manual-remix',8,{tags:['family:z']}), entry('manual-source',9,{tags:['family:z']}),
  ];
  const groups = groupFamilies(rows);
  const base = groups.find(f => f.entries.some(e => e.crc32 === 1))!;
  assert.equal(base.entries.length,3);
  assert.ok(base.keys.has('favorites'));
  for(const name of ['kz_river','kz_hills']) assert.equal(groups.find(f => f.name === name)!.holdout,base.holdout);
  assert.equal(groups.find(f => f.entries.some(e => e.crc32 === 5))!.entries.length,2);
  assert.equal(groups.find(f => f.entries.some(e => e.crc32 === 8))!.entries.length,2);
  assert.ok(groups.some(f => f.holdout)); assert.ok(groups.some(f => !f.holdout));
  assert.deepEqual(groups.map(f => [f.name,f.holdout]),groupFamilies(rows.toReversed()).map(f => [f.name,f.holdout]));
  assert.deepEqual(creditedAuthors(entry('foo',8,{title:'New Soldat Map'})),[]);
});

test('review labels outrank geometric inference; retrospective matrix does not use its own labels as predictions', () => {
  const ctf=entry('ctf_Field',1,{modeGroupId:'ctf',startJetGame:200});
  const hidden=entry('ctf_Hidden',2,{modeGroupId:'ctf'});
  const tw=entry('tw_Trench',3,{modeGroupId:'trenchwars'});
  const uncertain=entry('kz_unsure',4,{tags:['mode:uncertain']});
  const privateLabel={...ctf,tags:['mode:climb','mode:ctf']};
  assert.equal(inferredMode(hidden),'climb'); assert.equal(inferredMode(ctf),'ctf');
  assert.equal(climbFamilies([ctf,hidden,tw,uncertain],{[auditKey(ctf)]:'climb'}).length,2);
  assert.equal(climbFamilies([privateLabel],{[auditKey(ctf)]:'climb'}).length,0);
  const report=reviewSample([ctf,hidden,tw,uncertain],{[auditKey(ctf)]:'climb',[auditKey(tw)]:'tw'},3);
  assert.equal(report.matrix.ctf.climb,1); assert.equal(report.matrix.tw.tw,1); assert.equal(report.matrix.climb.uncertain,1);
  assert.equal(report.items.find(i=>i.id===hidden.id)!.reviewed,null);
  assert.equal(report.items.find(i=>i.id===uncertain.id)!.source,'owner');
});

test('selected family distributions and measured geometry survive JSON; empty folds stay empty and a retag changes selection', async t => {
  const dir=await mkdtemp(join(tmpdir(),'style-collection-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const rows=await Promise.all([15,90,130,55].map(async(gap,i)=>{
    const map=createMapFromTemplate('empty',{title:'style',texture:'main.bmp'});
    map.polygons=[...makeQuadPolys(0,0,20,20), ...makeQuadPolys(20+gap,-6,30+gap+i*4,20,{polyType:i===0?18:0,bounciness:3})];
    const bytes=serializePms(map), name='kz_'+i, fullPath=join(dir,name+'.pms');
    await writeFile(fullPath,bytes);
    return entry(name,soldatCrc32(bytes),{fullPath,fileSize:bytes.length,tags:i===0?['Forest']:[],favorite:i===0});
  }));
  const selected=await loadClimbProfile(rows,'tag:forest');
  assert.equal(selected.geometry.measuredMaps,1);
  assert.equal(selected.geometry.jumps[0].landingWidth,10);
  const s=selected.geometry.library!;
  assert.deepEqual(s.measured.gap,[15,15,15]); assert.deepEqual(s.measured.landingWidth,[10,10,10]);
  assert.notDeepEqual(s.wholeLibrary.gap,s.measured.gap); assert.ok(isLibrarySnapshot(s));
  assert.ok(isTunnelSettings(JSON.parse(JSON.stringify({...DEFAULT_TUNNEL,profile:selected.geometry}))));
  assert.equal(isLibrarySnapshot({...s,measured:{...s.measured,gap:[8,NaN,3]}}),false);
  const empty=await loadClimbProfile(rows,'tag:forest',s.holdoutFamilies?'reference':'holdout');
  assert.equal(empty.geometry.measuredMaps,0); assert.equal(empty.geometry.library!.measured.gap,null);
  const changed=await loadClimbProfile(rows.map(e=>({...e,tags:[]})),'tag:forest');
  assert.equal(changed.geometry.measuredMaps,0);
});

test('a timed course with a full-sized four-metric library snapshot writes to disk and reopens with the measured samples intact', async t => {
  const distribution: StyleDistribution = { gap:[16,61,137], rise:[-56,0,57], landingWidth:[11,32,96], rebound:[2,3,6] };
  const profile: ClimbGeometryProfile = {
    jumps:Array.from({length:6456},(_,i)=>({gap:16+i%90,rise:i%23-11,landingWidth:11+i%85})),
    rebounds:Array.from({length:1317},(_,i)=>2+i%6), bounceJumps:[{gap:30,rise:5,rebound:3,landingWidth:32}],
    measuredMaps:2152,pairs:58852,bounceMaps:439,
    library:{collection:'all',fold:'all',familyCount:2368,unknownAuthorFamilies:1216,referenceFamilies:1894,holdoutFamilies:474,
      measured:distribution,wholeLibrary:distribution,reference:distribution,holdout:distribution},
  };
  const course=buildTimedCourse({terrain:{...NEW_TUNNEL_SETTINGS,direction:'across',palette:'glacier',profileSource:'library',profile},
    pace:{targetSeconds:10,profile:'progressive',seed:123}});
  assert.ok(course?.trial.reached);
  const dir=await mkdtemp(join(tmpdir(),'full-style-project-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'ctf_race.smaproj');
  await writeFile(path,encodeProjectFile('ctf_race',course.map));
  const opened=decodeProjectFile(await readFile(path));
  assert.deepEqual(opened.tunnels[0].settings.profile,profile);
  assert.deepEqual(opened.tunnels[0].pace,{targetSeconds:10,profile:'progressive',seed:123});
});
