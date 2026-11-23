import { readFile } from 'node:fs/promises';
import type { MapIndexEntry } from '../shared/apiTypes';
import { STYLE_METRICS, type StyleDistribution, type StyleFold, type StyleMetric, type StyleQuantiles } from '../shared/climbLibrary';
import { parsePmsFull, soldatCrc32 } from '../shared/pmsParser';
import { measureClimbTerrain, representatives, type ClimbGeometryProfile } from '../shared/climbSamples';
import { climbFamilies, collectionMember, describeCollections, type LibraryFamily, type AuditLabels } from './climbCollections';

function surfaceMix(selected: readonly MapIndexEntry[]) {
  const samples = selected.length;
  let inferred = 0, deadly = 0, hurt = 0, bounce = 0;
  for (const entry of selected) {
    const counts = entry.polyTypeCounts;
    const sum = [0, 2, 4, 5, 6, 7, 18].reduce((v, type) => v + (counts[type] || 0), 0);
    if (entry.modeGroupId !== 'climb') inferred++;
    if (!sum) continue;
    deadly += ((counts[5] || 0) + (counts[6] || 0)) / sum;
    hurt += (counts[7] || 0) / sum;
    bounce += (counts[18] || 0) / sum;
  }
  const percent = (n: number) => samples ? Math.round(100 * n / samples) : 0;
  return { samples, inferred, deadly: percent(deadly), hurt: percent(hurt), bounce: percent(bounce) };
}

export function climbSurfaceProfile(entries: readonly MapIndexEntry[]) {
  return surfaceMix(climbFamilies(entries).map(f => f.entries[0]));
}

type Measurement = ReturnType<typeof measureClimbTerrain> & { jetFuel: number };
const measuredFiles = new Map<string, Promise<Measurement | null>>();
const fileKey = (e: MapIndexEntry) => JSON.stringify([e.fullPath, e.crc32, e.fileSize, e.mtimeMs]);

async function readMeasurement(entry: MapIndexEntry): Promise<Measurement | null> {
  const bytes = await readFile(entry.fullPath);
  if (bytes.length !== entry.fileSize || soldatCrc32(bytes) !== entry.crc32) return null;
  return { ...measureClimbTerrain(parsePmsFull(bytes).polygons), jetFuel: entry.startJetGame };
}

function measure(entry: MapIndexEntry) {
  const key = fileKey(entry);
  let result = measuredFiles.get(key);
  if (!result) {
    result = readMeasurement(entry).catch(() => null);
    measuredFiles.set(key, result);
    result.then(value => { if (!value && measuredFiles.get(key) === result) measuredFiles.delete(key); });
  }
  return result;
}

async function measureMember(entry: MapIndexEntry, family: LibraryFamily) {
  const result = await measure(entry);
  if (result) return result;
  for (const copy of family.entries) {
    if (copy === entry || copy.crc32 !== entry.crc32 || copy.fileSize !== entry.fileSize) continue;
    const substitute = await measure(copy);
    if (substitute) return substitute;
  }
  return null;
}

function distributions(maps: Measurement[]): StyleDistribution {
  // Within each metric, a family contributes one unit of weight even if its mesh has thousands of ledges.
  function quantiles(metric: StyleMetric): StyleQuantiles | null {
    const all: { value: number; weight: number }[] = [];
    let weight = 0;
    for (const map of maps) {
      const values = metric === 'jetFuel' || metric === 'exposedLength' ? [map[metric]] :
        metric === 'rebound' ? map.rebounds : map.jumps.map(j => j[metric]);
      const valid = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
      if (!valid.length) continue;
      weight++;
      for (const value of valid) all.push({ value, weight: 1 / valid.length });
    }
    if (!all.length) return null;
    all.sort((a, b) => a.value - b.value);
    let i = 0, sum = all[0].weight;
    return [0.1, 0.5, 0.9].map(q => {
      while (i < all.length - 1 && sum + 1e-10 < q * weight) sum += all[++i].weight;
      return all[i].value;
    }) as StyleQuantiles;
  }
  return Object.fromEntries(STYLE_METRICS.map(metric => [metric, quantiles(metric)])) as StyleDistribution;
}

function projectSample<T>(sorted: T[]): T[] {
  const limit = 50000; // The portable project format accepts up to 50,000 entries per array.
  if (sorted.length <= limit) return sorted;
  return Array.from({ length: limit }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (limit - 1))]);
}

async function readProfile(families: LibraryFamily[], collection: string, fold: StyleFold) {
  const selected = families.filter(f => f.keys.has(collection));
  const active = (f: LibraryFamily) => fold === 'all' || (fold === 'holdout') === f.holdout;
  const whole: Measurement[] = [], reference: Measurement[] = [], holdout: Measurement[] = [], used: Measurement[] = [];
  const geometry: ClimbGeometryProfile = { jumps: [], rebounds: [], bounceJumps: [], measuredMaps: 0, pairs: 0, bounceMaps: 0 };
  let skipped = 0, missingFiles = false;
  for (const f of families) {
    const included = f.keys.has(collection);
    const canonical = f.entries[0], selectedEntry = included ? collectionMember(f, collection) : canonical;
    const canonicalMeasurement = await measureMember(canonical, f);
    if (!canonicalMeasurement) missingFiles = true;
    if (canonicalMeasurement && active(f)) whole.push(canonicalMeasurement);
    if (!included) continue;
    const m = selectedEntry === canonical ? canonicalMeasurement : await measureMember(selectedEntry, f);
    if (!m) { if (active(f)) skipped++; missingFiles = true; continue; }
    (f.holdout ? holdout : reference).push(m);
    if (!active(f)) continue;
    used.push(m);
    geometry.pairs += m.jumps.length;
    if (m.jumps.length) geometry.measuredMaps++;
    if (m.rebounds.length) geometry.bounceMaps++;
    geometry.jumps.push(...representatives(m.jumps));
    geometry.rebounds.push(...representatives(m.rebounds));
    geometry.bounceJumps!.push(...representatives(m.jumps.filter(s => s.rebound !== undefined)));
  }
  geometry.jumps = projectSample(geometry.jumps.sort((a, b) => a.gap - b.gap));
  geometry.rebounds = projectSample(geometry.rebounds.sort((a, b) => a - b));
  geometry.bounceJumps = projectSample(geometry.bounceJumps!.sort((a, b) => a.gap - b.gap));
  const measured = distributions(used);
  const collections = describeCollections(families);
  const collectionLabel = collections.find(option => option.key === collection)?.label.slice(0, 256);
  geometry.library = {
    collection, collectionLabel, fold, familyCount: selected.length, unknownAuthorFamilies: selected.filter(f => !f.authors.size).length,
    measured, wholeLibrary: collection === 'all' ? measured : distributions(whole),
    reference: distributions(reference), holdout: distributions(holdout),
    referenceFamilies: reference.length, holdoutFamilies: holdout.length,
  };
  return { ...surfaceMix(selected.filter(active).map(f => collectionMember(f, collection))), geometry, skipped, missingFiles,
    collections };
}

// Requests for the same selection share one async read. A changed index, tag or favourite invalidates the snapshot.
let cached: { key: string; result: ReturnType<typeof readProfile> } | undefined;
export function loadClimbProfile(entries: readonly MapIndexEntry[], collection = 'all', fold: StyleFold = 'all', audit: AuditLabels = {}) {
  const families = climbFamilies(entries, audit);
  const key = JSON.stringify([collection, fold, families.map(f => f.entries.map(e =>
    [fileKey(e), e.baseName, e.sourceId, e.sourceLabel, e.title, e.modeGroupId, !!e.favorite, e.tags]))]);
  if (cached?.key === key) return cached.result;
  const current = new Set(families.flatMap(f => f.entries.map(fileKey)));
  for (const k of measuredFiles.keys()) if (!current.has(k)) measuredFiles.delete(k);
  const result = readProfile(families, collection, fold);
  cached = { key, result };
  result.then(profile => { if (profile.missingFiles && cached?.result === result) cached = undefined; },
    () => { if (cached?.result === result) cached = undefined; });
  return result;
}
