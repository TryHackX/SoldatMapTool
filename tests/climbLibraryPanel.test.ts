import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppliedLibraryProfile } from '../src/client/editor/components/LibraryStyleControls';
import { ClimbDistributionTable } from '../src/client/editor/components/ClimbDistributionTable';
import { ReviewSummary } from '../src/client/editor/components/ClimbLibraryReview';
import type { ClimbLibrarySnapshot,StyleDistribution } from '../src/shared/climbLibrary';
import type { LibraryReview,LibraryReviewItem } from '../src/shared/climbReview';

const distribution=(n:number):StyleDistribution=>({gap:[n,n+5,n+10],rise:null,landingWidth:null,rebound:null});
function snapshot(): ClimbLibrarySnapshot {
  return {collection:'all',fold:'all',familyCount:11,unknownAuthorFamilies:2,
    referenceFamilies:8,holdoutFamilies:3,measured:distribution(16),wholeLibrary:distribution(16),
    reference:distribution(10),holdout:distribution(22)};
}
const table=(s:ClimbLibrarySnapshot)=>renderToStaticMarkup(createElement(ClimbDistributionTable,{snapshot:s}));

test('whole-library comparisons default to disjoint families and never offer the whole library against itself',()=>{
  const html=table(snapshot());
  assert.match(html,/value="folds" selected/);
  assert.doesNotMatch(html,/value="library"/);
  assert.match(html,/10 \/ 15 \/ 20/); assert.match(html,/22 \/ 27 \/ 32/);
  assert.doesNotMatch(html,/16 \/ 21 \/ 26/);
});

test('a subset compares its saved measurements to the library, with one column for equal values and a usable one-group fallback',()=>{
  const s=snapshot();
  s.collection='favorites';s.measured=distribution(90);
  const subset=table(s);
  assert.match(subset,/value="library" selected/);
  assert.match(subset,/90 \/ 95 \/ 100/); assert.match(subset,/16 \/ 21 \/ 26/);
  s.wholeLibrary=s.measured;
  const same=table(s);
  assert.match(same,/Both groups have the same displayed percentiles/);
  assert.equal(same.split('90 / 95 / 100').length-1,1);
  const only=table({...s,collection:'all',holdoutFamilies:0});
  assert.doesNotMatch(only,/<select/); assert.match(only,/90 \/ 95 \/ 100/);
});

test('profile provenance separates family population from families contributing jumps, supports older saved profiles',()=>{
  const geometry={jumps:[],rebounds:[],pairs:54,measuredMaps:7,bounceMaps:2};
  const s={...snapshot(),collection:'source:old',collectionLabel:'Archived set',fold:'holdout' as const,holdoutFamilies:9};
  const active=renderToStaticMarkup(createElement(AppliedLibraryProfile,{profile:{...geometry,library:s}}));
  assert.match(active,/Archived set/);assert.match(active,/Held-out families/);
  assert.match(active,/collection: 11\./);assert.match(active,/profile: 7\./);
  const legacy=renderToStaticMarkup(createElement(AppliedLibraryProfile,{profile:geometry}));
  assert.match(legacy,/Families with jump pairs: 7/);assert.doesNotMatch(legacy,/Whole climb library/);
  assert.match(renderToStaticMarkup(createElement(AppliedLibraryProfile,{})),/built-in/);
});

test('the classification summary counts uncertain labels separately from mismatches and includes pending reviews only in the total',()=>{
  const item={id:'a',name:'a',title:'',crc32:0,fileSize:1,hasThumbnail:false,stratum:'climb',alpha:1,bravo:0,alphaFlag:1,bravoFlag:1,jet:0,
    predicted:'climb',reviewed:'climb',source:'audit'} as const satisfies LibraryReviewItem;
  const report:LibraryReview={items:[item,{...item,id:'b',reviewed:'ctf'},{...item,id:'c',reviewed:'uncertain'},
    {...item,id:'d',reviewed:null,source:null}], matrix:{climb:{climb:1,ctf:1,tw:0,uncertain:1},
      ctf:{climb:0,ctf:0,tw:0,uncertain:0},tw:{climb:0,ctf:0,tw:0,uncertain:0}}};
  const html=renderToStaticMarkup(createElement(ReviewSummary,{report}));
  assert.match(html,/Reviewed 3 of 4 maps\. Matches: 1\. Different mode: 1\. Uncertain: 1\./);
});
