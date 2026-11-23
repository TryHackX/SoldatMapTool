import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatTargetTime, parseTargetSeconds } from '../src/client/editor/components/TunnelPaceControls';
import { TunnelPaceReport } from '../src/client/editor/components/TunnelPaceReport';
import type { PaceResult } from '../src/client/editor/tunnelPacePlanner';
import { loadTestedTunnel } from '../src/client/editor/testedTunnels';
import { generateClimbTunnel } from '../src/shared/climbTunnel';
import { PACE_MAX_SECONDS, PACE_MIN_SECONDS } from '../src/shared/tunnelPace';
import { createTunnelProject } from '../src/shared/tunnelProject';

test('both planner entry points accept seconds or a clock and reject malformed or out-of-range targets', () => {
  for (const s of ['60', ' 60 ', '1:00']) assert.equal(parseTargetSeconds(s), 60);
  for (const s of ['', '0:60', '1:9', '1:09:00', '1.5', '1e2', '5:01', '0:04', '-5']) assert.equal(parseTargetSeconds(s), null, s);
  for (let n=PACE_MIN_SECONDS; n<=PACE_MAX_SECONDS; n++) assert.equal(parseTargetSeconds(formatTargetTime(n)), n);
});

test('the whole route report uses full-run ticks across minute boundaries and omits the time for a missing finish', () => {
  const {settings,path} = loadTestedTunnel('spiral');
  const project = createTunnelProject(generateClimbTunnel(settings,path),settings,path);
  const pace = {targetSeconds:60, profile:'progressive' as const, seed:240};
  const trial = {reached:true,progress:1,ticks:3601,trace:[],sectionTicks:5};
  const result: PaceResult = {baseline:{...trial,ticks:3599},trial,changes:[],checkedSections:1,checkedVariants:4,fullRuns:2,
    toleranceSeconds:1.8,withinTarget:true,usesSketchEnds:false};
  const render = () => renderToStaticMarkup(createElement(TunnelPaceReport,{project,settings:pace,result}));
  const html = render();
  assert.match(html,/0:59\.98/);
  assert.match(html,/1:00\.02/);
  assert.match(html,/0\.02 s over target/);
  result.trial = {...trial,reached:false,reason:'missing-flag'};
  const missing = render();
  assert.match(missing,/active Alpha spawn and Bravo flag/);
  assert.doesNotMatch(missing,/1:00\.02|Within target range/);
});
