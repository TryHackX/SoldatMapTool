import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectExperimentData} from '../src/server/climbExperimentData';
import type {LibraryFamily} from '../src/server/climbCollections';
import type {MapIndexEntry} from '../src/shared/apiTypes';
import {measureClimbTerrain} from '../src/shared/climbSamples';
import {evaluateSectionExperiment,type NumericFamily,type SectionSequence} from '../src/shared/climbModelExperiment';
import {createMapFromTemplate,makeQuadPolys} from '../src/shared/editorTemplates';
import {prepareMapForSave} from '../src/shared/pmsCompiler';
import {serializePms,soldatCrc32} from '../src/shared/pmsParser';

const platform=(x:number,y:number,w:number)=>makeQuadPolys(x,y,x+w,y+8);
const polys=[...platform(0,0,20),...platform(40,-8,24),...platform(105,0,37),...platform(800,0,31),...platform(850,14,44)];
test('the experimental chain joins the same landing and takeoff; sorted ranks and disconnected pads never form sequences',()=>{
  const measured=measureClimbTerrain(polys,true);
  assert.equal(measured.jumps.length,3);
  assert.deepEqual(measured.sequences,[{previous:{gap:20,rise:8,landingWidth:24},next:{gap:41,rise:-8,landingWidth:37}}]);
  assert.deepEqual(measureClimbTerrain(polys).sequences,[]);
});

function sample(gap:number):SectionSequence{
  return {previous:{gap,rise:gap/2-25,landingWidth:20+gap/3},next:{gap:gap+4,rise:gap/2-10,landingWidth:20+gap/2}};
}
const dataset=(families:NumericFamily[])=>({families,selected:families.length,skipped:0,unreadable:0});
const family=(holdout:boolean,values:number[]):NumericFamily=>({knownAuthor:true,holdout,sequences:values.map(sample)});

test('the held-out geometry benchmark learns from reference families and scores equal controlled movement probes',()=>{
  const families=[family(false,[10,20,80,95]),family(false,[12,25,70,90]),family(true,[15,85])];
  const report=evaluateSectionExperiment(dataset(families));
  assert.ok(report.scores);
  const {baseline,learned}=report.scores;
  assert.ok(learned.gap<baseline.gap && learned.rise<baseline.rise && learned.landingWidth<baseline.landingWidth);
  assert.equal(baseline.probes,1);assert.equal(learned.probes,baseline.probes);
  assert.equal(report.counts.training,2);assert.equal(report.counts.heldOut,1);
  assert.equal(report.counts.trainPairs,8);assert.equal(report.counts.testPairs,2);
  // Duplicating one family's examples leaves its combined training weight unchanged.
  const repeat=[{...families[0],sequences:[...families[0].sequences,...families[0].sequences]},...families.slice(1)];
  const again=evaluateSectionExperiment(dataset(repeat)).scores!;
  assert.ok(Math.abs(again.learned.gap-learned.gap)<1e-9);
  assert.equal(again.baseline.gap,baseline.gap);
  // A holdout made entirely of unrelated targets changes the scores but can't train the fit.
  const shifted={...families[2],sequences:families[2].sequences.map(row=>({...row,next:{...row.next,gap:170}}))};
  const bad=evaluateSectionExperiment(dataset([...families.slice(0,2),shifted]));
  assert.ok(bad.scores!.learned.gap>50);
  assert.equal(bad.scores!.learned.passed,learned.passed);
  assert.equal(evaluateSectionExperiment(dataset(families.slice(0,2))).scores,null);
});

test('the selected experiment collection exports numeric sequences only, with source checksum checks',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'climb-model-fixture-'));
  try{
    const map=createMapFromTemplate('empty');
    map.polygons=polys;
    const bytes=serializePms(prepareMapForSave(map,{geometryDirty:true}));
    const fullPath=path.join(dir,'private-fixture.pms');
    await writeFile(fullPath,bytes);
    const entry={fullPath,fileSize:bytes.length,crc32:soldatCrc32(bytes),favorite:true} as MapIndexEntry;
    const f:LibraryFamily={name:'private family',authors:new Set(['private credit']),entries:[entry],keys:new Set(['favorites']),holdout:true};
    const result=await collectExperimentData([f,{...f,keys:new Set(['tag:other'])}],'favorites',new AbortController().signal);
    assert.equal(result.selected,1);
    assert.equal(result.families[0].holdout,true);
    assert.equal(result.families[0].sequences.length,1);
    assert.doesNotMatch(JSON.stringify(result),/private|fixture/);
    const outdated={...f,entries:[{...entry,crc32:entry.crc32^1}]};
    const unreadable=await collectExperimentData([outdated],'favorites',new AbortController().signal);
    assert.equal(unreadable.unreadable,1);
    assert.deepEqual(unreadable.families,[]);
    const abort=new AbortController();abort.abort();
    await assert.rejects(collectExperimentData([f],'favorites',abort.signal));
  }finally{
    await unlink(path.join(dir,'private-fixture.pms')).catch(()=>{});
    await rmdir(dir);
  }
});

