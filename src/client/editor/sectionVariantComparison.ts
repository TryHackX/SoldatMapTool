import type { PmsMapData } from '@shared/pmsParser';
import { generateSectionVariants, type SectionVariant } from '@shared/tunnelSectionVariants';
import type { TunnelProject, TunnelSectionChange } from '@shared/tunnelProject';
import { prepareProjectTrial } from './projectTrialRoute';
import { prepareSectionTiming, runTimedSectionTrial, type TunnelTrialResult } from './tunnelTrial';

export interface SectionVariantRequest {
  map: PmsMapData;
  project: TunnelProject;
  knotIndex: number;
  seed: number;
  count?: number;
}

export interface SectionVariantReport {
  style: SectionVariant['style'];
  seed: number;
  change: TunnelSectionChange;
  changedPolygons: number;
  reason?: Extract<SectionVariant['result'],{ok:false}>['reason'];
  trial?: TunnelTrialResult;
}

export type SectionVariantEvent =
  | {kind:'baseline'; trial:TunnelTrialResult}
  | {kind:'candidate'; candidate:SectionVariantReport}
  | {kind:'done'};

export function compareSectionVariants({map,project,knotIndex,seed,count}: SectionVariantRequest,
  emit: (event: SectionVariantEvent) => void) {
  const source = prepareProjectTrial(map,project,knotIndex).request;
  const timing = prepareSectionTiming(source);
  emit({kind:'baseline', trial:runTimedSectionTrial(source,timing)});
  for (const {style,seed:variantSeed,change,result} of generateSectionVariants(map,project,knotIndex,seed,count)) {
    const candidate: SectionVariantReport = {style,seed:variantSeed,change,changedPolygons:0};
    if (result.ok) {
      candidate.changedPolygons = result.changedPolygons;
      const input = prepareProjectTrial(result.map,result.project,knotIndex).request;
      candidate.trial = runTimedSectionTrial(input,timing);
    } else {
      candidate.reason = result.reason;
    }
    // The UI can reproduce the selected geometry from its source document and this small patch.
    emit({kind:'candidate',candidate});
  }
  emit({kind:'done'});
}
