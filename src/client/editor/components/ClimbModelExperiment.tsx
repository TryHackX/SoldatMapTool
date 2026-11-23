import { useEffect, useRef, useState } from 'react';
import type { ExperimentDataset, ExperimentReport } from '@shared/climbModelExperiment';
import { locale, t } from '../../i18n';

const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
const action = 'rounded border border-cyan-800 px-2 py-1 font-medium text-cyan-200 hover:bg-cyan-950 focus-visible:outline-cyan-300';

export function ClimbExperimentResult({ counts, scores }: ExperimentReport) {
  const { training, trainPairs, heldOut, testPairs, skipped, unreadable, unknownAuthors } = counts;
  return <div className="space-y-2 text-zinc-300">
    <div role="status" className="space-y-1.5">
      <h4 className="font-semibold text-zinc-100">{scores ? t('Comparison complete') : t('Too little data to compare methods')}</h4>
      {scores ? <>
        <p>{scores.learned.passed === scores.baseline.passed
          ? t('Tie. The pilot finished {passed} of {total} two-jump trials with each method.', {
            passed: scores.learned.passed, total: scores.learned.probes,
          })
          : t('Completed two-jump trials: {learned}/{total} with the learned model and {baseline}/{total} with the median.', {
            learned: scores.learned.passed, total: scores.learned.probes, baseline: scores.baseline.passed,
          })}</p>
        <p className="text-zinc-400">{t('Each trial starts with the same measured jump for both methods. Each method then proposes the next landing on ordinary ground.')}</p>
      </> : <p>{t('Choose a collection with two reference families, six linked sequences and at least one held-out family.')}</p>}
    </div>
    <details className="border-t border-zinc-800 pt-1.5">
      <summary className="cursor-pointer text-cyan-300">{scores ? t('Geometry errors and sample sizes') : t('Sample sizes')}</summary>
      <div className="mt-2 space-y-2">
        {scores && <>
          <p>{t('The median always proposes the same dimensions from the training maps. The learned model adjusts them using the previous jump.')}</p>
          <table className="w-full text-left tabular-nums">
            <caption className="pb-1 text-left">{t('Mean absolute error against landings on held-out maps, in map units. Smaller is closer.')}</caption>
            <thead><tr><th scope="col">{t('Metric')}</th><th scope="col">{t('Median')}</th><th scope="col">{t('Learned model')}</th></tr></thead>
            <tbody>{([
              ['Horizontal gap','gap'], ['Signed rise','rise'], ['Landing width','landingWidth'],
            ] as const).map(([label,key]) =>
              <tr key={key} className="border-t border-zinc-800">
                <th scope="row" className="font-normal">{t(label)}</th>
                <td>{number.format(scores.baseline[key])}</td><td>{number.format(scores.learned[key])}</td>
              </tr>
            )}</tbody>
          </table>
          <p>{t('Total prediction time for {n} held-out sequences: median {median} ms, learned model {model} ms.', {
            n: number.format(testPairs), median: number.format(scores.baseline.predictionMs), model: number.format(scores.learned.predictionMs),
          })}</p>
        </>}
        <p>{t('Training: {train} map families ({a} jump pairs). Evaluation: {test} other families ({b} jump pairs).', {
          train: number.format(training), a: number.format(trainPairs), test: number.format(heldOut), b: number.format(testPairs),
        })}</p>
        <p className="text-zinc-400">{t('Each family has equal weight in the geometry scores. Unknown author in the measured set: {authors}. Families without connected jumps: {empty}. Unreadable families: {bad}.', {
          authors: number.format(unknownAuthors), empty: number.format(skipped), bad: number.format(unreadable),
        })}</p>
      </div>
    </details>
  </div>;
}

type Run = { phase: 'idle' | 'loading' | 'testing' | 'cancelled' | 'error' } |
  { phase: 'complete'; report: ExperimentReport };

function CollectionExperiment({ collection }: { collection: string }) {
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const job = useRef<Worker | null>(null);
  const request = useRef<AbortController | null>(null);

  function stop() {
    request.current?.abort();
    request.current = null;
    job.current?.terminate();
    job.current = null;
  }
  useEffect(() => stop, []);

  async function evaluate() {
    stop();
    setRun({ phase: 'loading' });
    const controller = new AbortController();
    request.current = controller;
    function fail() {
      if (controller.signal.aborted) return;
      stop();
      setRun({ phase: 'error' });
    }
    try {
      const response = await fetch('/api/editor/climb-experiment', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection }),
      });
      if (!response.ok) throw new Error('Dataset unavailable');
      const dataset: ExperimentDataset = await response.json();
      if (controller.signal.aborted) return;
      const worker = new Worker(new URL('../climbModelExperiment.worker.ts', import.meta.url), { type: 'module' });
      job.current = worker;
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = ({ data }: MessageEvent<ExperimentReport>) => {
        if (controller.signal.aborted) return;
        stop();
        setRun({ phase: 'complete', report: data });
      };
      setRun({ phase: 'testing' });
      worker.postMessage(dataset);
    } catch { fail(); }
  }

  const busy = run.phase === 'loading' || run.phase === 'testing';
  return <div className="mt-2 space-y-2">
    <p>{t('Compare two ways to choose a landing on practice jumps from this collection. To check your tunnel, run its pilot from start to flag.')}</p>
    {run.phase === 'complete' && <ClimbExperimentResult {...run.report}/>}
    {run.phase === 'loading' && <p role="status">{t('Reading jump pairs from the selected collection…')}</p>}
    {run.phase === 'testing' && <p role="status">{t('Comparing landings and running the two-jump trials…')}</p>}
    {run.phase === 'error' && <p role="alert" className="text-amber-200">{t('Could not evaluate this collection.')}</p>}
    {run.phase === 'cancelled' && <p role="status">{t('Comparison cancelled.')}</p>}
    {busy
      ? <button type="button" className={action} onClick={() => { stop(); setRun({ phase: 'cancelled' }); }}>{t('Cancel experiment')}</button>
      : <button type="button" className={action} onClick={() => void evaluate()}>
        {run.phase === 'complete' ? t('Run comparison again') : t('Compare landing methods')}
      </button>}
  </div>;
}

export function ClimbModelExperiment({ collection }: { collection: string }) {
  return <details className="rounded border border-zinc-800 px-2 py-1.5">
    <summary className="cursor-pointer text-cyan-300">{t('Experimental section predictor')}</summary>
    <CollectionExperiment key={collection} collection={collection}/>
  </details>;
}

