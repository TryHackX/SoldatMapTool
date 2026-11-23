export const STYLE_METRICS = ['gap', 'rise', 'landingWidth', 'rebound', 'exposedLength', 'jetFuel'] as const;
export type StyleMetric = typeof STYLE_METRICS[number];
export type StyleQuantiles = [number, number, number];
export type StyleDistribution = Record<Exclude<StyleMetric, 'exposedLength' | 'jetFuel'>, StyleQuantiles | null> &
  Partial<Record<'exposedLength' | 'jetFuel', StyleQuantiles | null>>;
export type StyleFold = 'all' | 'reference' | 'holdout';

export interface ClimbLibrarySnapshot {
  collection: string;
  collectionLabel?: string;
  fold: StyleFold;
  familyCount: number;
  unknownAuthorFamilies: number;
  measured: StyleDistribution;
  wholeLibrary: StyleDistribution;
  reference: StyleDistribution;
  holdout: StyleDistribution;
  holdoutFamilies: number;
  referenceFamilies: number;
}
export interface StyleCollection { key: string; label: string; count: number }

export function isLibrarySnapshot(value: unknown): value is ClimbLibrarySnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<ClimbLibrarySnapshot>;
  const validDistribution = (d: StyleDistribution | undefined) => d && STYLE_METRICS.every(k => {
    const q = d[k];
    return (q === undefined && (k === 'jetFuel' || k === 'exposedLength')) || q === null ||
      (Array.isArray(q) && q.length === 3 && q.every(Number.isFinite) && q[0] <= q[1] && q[1] <= q[2]);
  });
  return typeof s.collection === 'string' && s.collection.length <= 256 &&
    (s.collectionLabel === undefined || (typeof s.collectionLabel === 'string' && s.collectionLabel.length <= 256)) &&
    ['all', 'reference', 'holdout'].includes(s.fold ?? '') &&
    [s.familyCount, s.unknownAuthorFamilies, s.holdoutFamilies, s.referenceFamilies].every(n => Number.isSafeInteger(n) && Number(n) >= 0) &&
    !!validDistribution(s.measured) && !!validDistribution(s.wholeLibrary) && !!validDistribution(s.reference) && !!validDistribution(s.holdout);
}
