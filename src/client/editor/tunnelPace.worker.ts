import type { PaceWorkerMessage } from './tunnelPaceJob';
import { runTunnelPacePlan, type PaceRequest } from './tunnelPacePlanner';

self.onmessage = ({data}:MessageEvent<PaceRequest>) => {
  const post = (event:PaceWorkerMessage) => self.postMessage(event);
  const result = runTunnelPacePlan(data, progress=>post({kind:'progress',progress}));
  post({kind:'done',result});
};
