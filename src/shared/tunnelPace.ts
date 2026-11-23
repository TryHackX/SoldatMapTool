export const PACE_MIN_SECONDS = 5;
export const PACE_MAX_SECONDS = 300;

export type PaceProfile = 'progressive' | 'steady' | 'hard-start';

export interface PaceSettings {
  targetSeconds: number;
  profile: PaceProfile;
  seed: number;
}

/** Saved targets belong to a tunnel. Trial times depend on all current map geometry. */
export function isPaceSettings(value: unknown): value is PaceSettings {
  if (!value || typeof value !== 'object') return false;
  const {targetSeconds,profile,seed} = value as Partial<PaceSettings>;
  return typeof targetSeconds === 'number' && Number.isInteger(targetSeconds) &&
    targetSeconds >= PACE_MIN_SECONDS && targetSeconds <= PACE_MAX_SECONDS &&
    (profile === 'progressive' || profile === 'steady' || profile === 'hard-start') &&
    typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0x7fffffff;
}
