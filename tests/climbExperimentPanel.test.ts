import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExperimentReport } from '../src/shared/climbModelExperiment';
import { ClimbExperimentResult } from '../src/client/editor/components/ClimbModelExperiment';

const counts = { selected: 2369, training: 1458, heldOut: 364, trainPairs: 20518, testPairs: 4547,
  skipped: 547, unknownAuthors: 912, unreadable: 0 };
const scores = {
  baseline: { passed: 20, probes: 32, gap: 39.05, rise: 27.47, landingWidth: 26.06, predictionMs: 0.3 },
  learned: { passed: 20, probes: 32, gap: 35.87, rise: 27.95, landingWidth: 23.27, predictionMs: 2.8 },
};
const render = (report: ExperimentReport) => renderToStaticMarkup(createElement(ClimbExperimentResult, report));

test('equal finish counts are reported as a tie even when dimension errors and timings differ', () => {
  const html = render({ counts, scores });
  assert.match(html, /Comparison complete/);
  assert.match(html, /Tie\. The pilot finished 20 of 32 two-jump trials with each method/);
  assert.match(html, /<details[^>]*><summary[^>]*>Geometry errors and sample sizes/);
  assert.match(html, /35\.87/);
  assert.match(html, /Total prediction time for 4,547 held-out sequences/);
});

test('unequal finish counts and insufficient data have distinct outcomes', () => {
  const scored = render({ counts, scores: { ...scores, learned: { ...scores.learned, passed: 16 } } });
  assert.match(scored, /16\/32 with the learned model and 20\/32 with the median/);
  assert.doesNotMatch(scored, /Tie\./);
  const empty = render({ counts: { ...counts, heldOut: 0, testPairs: 0 }, scores: null });
  assert.match(empty, /Too little data to compare methods/);
  assert.doesNotMatch(empty, /Comparison complete|two-jump trials with each method|Total prediction time/);
});
