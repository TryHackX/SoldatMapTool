export const REVIEW_MODES = ['climb', 'tw', 'ctf', 'uncertain'] as const;
export type ReviewMode = typeof REVIEW_MODES[number];
export const REVIEW_STRATA = ['climb', 'tw', 'ctf'] as const;
export type ReviewStratum = typeof REVIEW_STRATA[number];

export interface LibraryReviewItem {
  id: string; name: string; title: string; crc32: number; fileSize: number; hasThumbnail: boolean;
  stratum: ReviewStratum | 'ctf-jets'; predicted: ReviewStratum; reviewed: ReviewMode | null; source: 'owner' | 'audit' | null;
  alpha: number; bravo: number; alphaFlag: number; bravoFlag: number; jet: number;
}
export interface LibraryReview {
  items: LibraryReviewItem[];
  matrix: Record<ReviewStratum, Record<ReviewMode, number>>;
}
