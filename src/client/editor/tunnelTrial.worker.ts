import { runPmsTunnelTrial, type TunnelTrialRequest } from './tunnelTrial';
import { findTunnelVariant, type TunnelVariantRequest } from './tunnelVariant';

self.onmessage = ({ data }: MessageEvent<TunnelTrialRequest | TunnelVariantRequest>) => {
  if ('kind' in data) {
    self.postMessage(findTunnelVariant(data, progress => self.postMessage(progress)));
  } else {
    self.postMessage(runPmsTunnelTrial(data.map, data.centerline, data.footholds, data.section, data.splitAnchors));
  }
};
