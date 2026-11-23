import type { SectionVariantEvent, SectionVariantRequest } from './sectionVariantComparison';
export type { SectionVariantEvent, SectionVariantReport, SectionVariantRequest } from './sectionVariantComparison';

export function startSectionVariantTrials(request: SectionVariantRequest, onEvent: (event: SectionVariantEvent) => void,
  onError: () => void): Worker {
  const worker = new Worker(new URL('./sectionVariantTrials.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage = ({data}: MessageEvent<SectionVariantEvent>) => {
    if (data.kind === 'done') worker.terminate();
    onEvent(data);
  };
  const fail = () => { worker.terminate(); onError(); };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  try { worker.postMessage(request); }
  catch (error) { worker.terminate(); throw error; }
  return worker;
}
