import type { PaceProgress, PaceRequest, PaceResult } from './tunnelPacePlanner';

export type PaceWorkerMessage = {kind:'progress'; progress:PaceProgress} | {kind:'done'; result:PaceResult};

export function startTunnelPacePlan(request: PaceRequest, onProgress:(progress:PaceProgress)=>void,
  onDone:(result:PaceResult)=>void, onError:()=>void): Worker {
  const worker = new Worker(new URL('./tunnelPace.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage = ({data}:MessageEvent<PaceWorkerMessage>) => {
    if (data.kind === 'progress') onProgress(data.progress);
    else {
      worker.terminate();
      onDone(data.result);
    }
  };
  const fail = () => { worker.terminate(); onError(); };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  try { worker.postMessage(request); }
  catch (error) { worker.terminate(); throw error; }
  return worker;
}
