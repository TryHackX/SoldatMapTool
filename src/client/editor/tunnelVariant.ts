import { generateClimbTunnel, type TunnelPoint, type TunnelSettings } from '@shared/climbTunnel';
import { SOLDAT_MAP_LIMITS, type PmsMapData } from '@shared/pmsParser';
import { createDraftTrialMap } from './tunnelBlueprint';
import { runPmsTunnelTrial, type TunnelTrialResult } from './tunnelTrial';

export interface TunnelVariantRequest {
  kind: 'find-variant';
  settings: TunnelSettings;
  path?: readonly TunnelPoint[];
  contextMap?: PmsMapData;
  markers?: boolean;
}

const MAX_ATTEMPTS = 4;

export interface TunnelVariantProgress {
  kind: 'variant-progress';
  attempted: number;
  total: typeof MAX_ATTEMPTS;
  seed: number;
}

export interface TunnelVariantResult {
  kind: 'variant-result';
  attempted: number;
  seed?: number;
  trial?: TunnelTrialResult;
}

export function findTunnelVariant(
  { settings, path, contextMap, markers }: TunnelVariantRequest,
  onProgress?: (event: TunnelVariantProgress) => void,
): TunnelVariantResult {
  const context = path ? contextMap : undefined;
  let seed = settings.seed;
  for (let attempted = 1; attempted <= MAX_ATTEMPTS; attempted++) {
    // This full-period sequence visits each legal 31-bit seed once, even at 0 or 2^31-1.
    seed = (Math.imul(seed, 1664525) + 1013904223) & 0x7fffffff;
    onProgress?.({ kind: 'variant-progress', attempted, total: MAX_ATTEMPTS, seed });
    const candidate = { ...settings, seed };
    const draft = generateClimbTunnel(candidate, path, SOLDAT_MAP_LIMITS.maxPolys - (context?.polygons.length ?? 0));
    if (!draft.validation.ok) continue;
    const map = createDraftTrialMap(draft, candidate, context, markers);
    if (!map) continue;
    const trial = runPmsTunnelTrial(map, draft.centerline, draft.footholds);
    if (trial.reached) return { kind: 'variant-result', attempted, seed, trial };
  }
  return { kind: 'variant-result', attempted: MAX_ATTEMPTS };
}
