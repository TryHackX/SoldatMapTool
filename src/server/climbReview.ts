import type { MapIndexEntry } from '../shared/apiTypes';
import { REVIEW_MODES, REVIEW_STRATA, type LibraryReview, type ReviewMode } from '../shared/climbReview';
import { auditKey, baselineMode, groupFamilies, inferredMode, loadable, reviewedMode, stableOrder, type AuditLabels } from './climbCollections';
import { readJsonStoreFile } from './jsonStoreFile';

export { auditKey };
export function loadAuditLabels(path: string): AuditLabels {
  const value = readJsonStoreFile(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[0-9a-f]{1,8}\/\d+$/.test(k) && REVIEW_MODES.includes(v as ReviewMode)));
}

export function reviewSample(entries: readonly MapIndexEntry[], audit: AuditLabels = {}, perStratum = 36): LibraryReview {
  const families = groupFamilies(entries.filter(e => loadable(e) && baselineMode(e) !== 'uncertain'));
  const sample: LibraryReview = { items: [], matrix: {
    climb: { climb: 0, tw: 0, ctf: 0, uncertain: 0 },
    tw: { climb: 0, tw: 0, ctf: 0, uncertain: 0 },
    ctf: { climb: 0, tw: 0, ctf: 0, uncertain: 0 },
  } };
  const representatives = families.map(f => f.entries[0]).sort((a, b) => stableOrder(a.baseName) - stableOrder(b.baseName) ||
    a.baseName.localeCompare(b.baseName, 'en'));
  const picked = new Set<string>();
  for (const stratum of [...REVIEW_STRATA, 'ctf-jets'] as const) {
    const baseline = stratum === 'ctf-jets' ? 'ctf' : stratum;
    let candidates = representatives.filter(e => baselineMode(e) === baseline && !picked.has(auditKey(e)));
    if (stratum === 'ctf-jets') candidates = candidates.filter(e => e.startJetGame >= 60 && e.spawnTeamCounts[1] >= 2 &&
      e.spawnTeamCounts[2] >= 2 && e.spawnTeamCounts[5] === 1 && e.spawnTeamCounts[6] === 1)
      .sort((a, b) => stableOrder('ctf/' + a.baseName) - stableOrder('ctf/' + b.baseName));
    for (const e of candidates.slice(0, perStratum + (stratum === 'ctf-jets' ? 12 : 0))) {
      picked.add(auditKey(e));
      const predicted = inferredMode(e);
      if (predicted === 'uncertain') continue;
      const owner = reviewedMode(e), provisional = audit[auditKey(e)];
      const reviewed = owner ?? provisional ?? null;
      if (reviewed) sample.matrix[predicted][reviewed]++;
      const s = e.spawnTeamCounts;
      sample.items.push({ id: e.id, name: e.baseName, title: e.title, crc32: e.crc32, fileSize: e.fileSize, hasThumbnail: e.hasThumbnail,
        stratum, predicted, reviewed, source: owner ? 'owner' : provisional ? 'audit' : null,
        alpha: s[1] || 0, bravo: s[2] || 0, alphaFlag: s[5] || 0, bravoFlag: s[6] || 0, jet: e.startJetGame });
    }
  }
  return sample;
}
