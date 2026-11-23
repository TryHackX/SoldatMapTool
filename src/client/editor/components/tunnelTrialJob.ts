import type { TunnelTrialRequest, TunnelTrialResult } from '../tunnelTrial';
import { locale, t } from '../../i18n';

const seconds = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function describeSectionTrial(trial: TunnelTrialResult, section: number) {
  if (trial.reached) return t('Model passed section {section} with a run-up in {s} s.', {section, s:seconds.format(trial.ticks / 60)});
  if (trial.reason === 'no-run-up') return t('The model could not start safely on the approach. Check the entire tunnel to try from spawn.');
  if (trial.reason === 'invalid-route') return t('The model could not follow this route axis.');
  return trial.reason === 'budget'
    ? t('Section {section} unconfirmed. The simulation ran out of search steps.', {section})
    : t('Section {section} unconfirmed. The model stopped before the exit.', {section});
}

export function describeTrial(trial: TunnelTrialResult, sketchEnds = false) {
  if (trial.reached) {
    const s = seconds.format(trial.ticks / 60);
    return sketchEnds ? t('Model reached the end of the sketch in {s} s.', { s }) : t('Model reached the flag in {s} s.', { s });
  }
  if (trial.reason === 'missing-spawn' || trial.reason === 'missing-flag') return t('The model needs a start and a finish.');
  if (trial.reason === 'invalid-route') return t('The model could not follow this route axis.');
  const n = Math.round(trial.progress * 100);
  return trial.reason === 'budget'
    ? t('Simulation limit reached after {n}% of the route.', { n })
    : t('Model stopped at {n}% of the route.', { n });
}

export function startTrial(request: TunnelTrialRequest, complete: (result: TunnelTrialResult, worker: Worker) => void, fail: (worker: Worker) => void) {
  const worker = new Worker(new URL('../tunnelTrial.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<TunnelTrialResult>) => {
    worker.terminate();
    complete(event.data, worker);
  };
  const onFailure = () => { worker.terminate(); fail(worker); };
  worker.onerror = onFailure;
  worker.onmessageerror = onFailure;
  try { worker.postMessage(request); }
  catch (error) { worker.terminate(); throw error; }
  return worker;
}
