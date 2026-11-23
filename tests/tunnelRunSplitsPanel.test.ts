import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TunnelRunSplits } from '../src/client/editor/components/TunnelRunSplits';
import { TunnelPaceReport } from '../src/client/editor/components/TunnelPaceReport';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { generateClimbTunnel } from '../src/shared/climbTunnel';
import { createTunnelProject } from '../src/shared/tunnelProject';
import type { PaceResult } from '../src/client/editor/tunnelPacePlanner';
import type { TunnelRunSplit, TunnelTrialResult } from '../src/client/editor/tunnelTrial';

function completed(ticks:number[]):TunnelTrialResult {
  let cumulativeTicks=0;
  const splits:TunnelRunSplit[] = ticks.map((value,i)=>({
    knotIndex:i+1,lastKnotIndex:i+1,status:'complete',ticks:value,cumulativeTicks:cumulativeTicks+=value,
    point:{x:i+1,y:0},
  }));
  return {reached:true,progress:1,ticks:cumulativeTicks,splits,trace:[]};
}

const render = (trial:TunnelTrialResult,reference?:TunnelTrialResult,canEdit=true) => renderToStaticMarkup(
  createElement(TunnelRunSplits,{trial,reference,onChooseVariant:canEdit ? ()=>{} : undefined})
);

test('slowest split and biggest loss are ranked separately against the previous full run',()=>{
  const trial = completed([120,60,30]), previous = completed([126,36,48]);
  const initial = render(trial);
  assert.match(initial,/Longest completed section\. Compare variants for section 1/);
  assert.doesNotMatch(initial,/Largest time loss|Previous full run|Most time lost first/);
  const compared = render(trial,previous);
  assert.match(compared,/Largest time loss\. Compare variants for section 2/);
  assert.match(compared,/Longest completed section\. Compare variants for section 1/);
  assert.match(compared,/\+0\.40 s/);
  assert.match(compared,/Finish time change/);
  assert.match(compared,/0:03\.50/);
  const ties = render(completed([60,60]),completed([30,30]));
  assert.match(ties,/\(2 tied\)/);
});

test('failed and grouped intervals list only observed timings and keep incomparable splits out of the ranking',()=>{
  const trial = completed([40,15,18]);
  trial.splits![0].lastKnotIndex=2;
  trial.splits![1] = {...trial.splits![1],knotIndex:3,lastKnotIndex:3,status:'stopped',ticks:180,cumulativeTicks:220};
  trial.splits![2] = {knotIndex:4,lastKnotIndex:4,status:'unreached',point:{x:80,y:30}};
  Object.assign(trial,{reached:false,progress:0.62,ticks:220,reason:'pilot-stalled'});
  const html = render(trial,completed([1,1,1,1]));
  assert.match(html,/Elapsed before stop/);
  assert.match(html,/Pilot stopped here\. Compare variants for section 3/);
  assert.match(html,/3\.00 s spent/);
  assert.match(html,/Compare variants for section 2/);
  assert.match(html,/Sections sharing a checkpoint/);
  assert.doesNotMatch(html,/Compare variants for section 4|Largest time loss|Finish time change/);
  assert.doesNotMatch(render(trial,undefined,false),/Compare variants for section \d/);
  assert.equal(render({reached:false,ticks:0,progress:0,trace:[],reason:'missing-flag'}),'');
});

test('planning previews allow variant actions only on the source map until a proposal is applied',()=>{
  const {settings,path} = loadTestedTunnel('hills');
  const project = createTunnelProject(generateClimbTunnel(settings,path),settings,path);
  const pace = {targetSeconds:60,profile:'progressive' as const,seed:123};
  const result:PaceResult = {baseline:completed([40,60]),trial:completed([70,25]),changes:[
    {knotIndex:1,style:'chamber',change:{widthOffset:10},localSeconds:1,difficulty:0.4},
  ], checkedSections:2,checkedVariants:4,fullRuns:2,toleranceSeconds:1.8,withinTarget:false,usesSketchEnds:false};
  const report = ()=> renderToStaticMarkup(createElement(TunnelPaceReport,{project,result,settings:pace,onReviewCurrent:()=>{}}));
  const [proposed,source] = report().split('Splits on the current map');
  assert.doesNotMatch(proposed,/aria-label="[^"]*Compare variants for section/);
  assert.match(source,/Longest completed section\. Compare variants for section 2/);
  result.changes=[];
  result.trial=result.baseline;
  assert.match(report(),/Longest completed section\. Compare variants for section 2/);
});
