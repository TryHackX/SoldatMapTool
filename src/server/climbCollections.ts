import { basename } from 'node:path';
import type { MapIndexEntry } from '../shared/apiTypes';
import type { StyleCollection } from '../shared/climbLibrary';
import { derivedNamesOf, stripDerivedSuffix } from '../shared/mapFamily';

import { REVIEW_MODES, type ReviewMode } from '../shared/climbReview';

const lower = (s: string) => s.trim().toLowerCase();
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const mapName = (e: MapIndexEntry) => lower(e.baseName || basename(e.fullPath, '.pms'));
const tagged = (e: MapIndexEntry, key: string) =>
  (e.tags ?? []).map(lower).filter(t => t.startsWith(key + ':')).map(t => t.slice(key.length + 1).trim()).filter(Boolean);

export function reviewedMode(e: MapIndexEntry): ReviewMode | undefined {
  const labels = tagged(e, 'mode').filter(v => REVIEW_MODES.includes(v as ReviewMode));
  return labels.length > 1 ? 'uncertain' : labels[0] as ReviewMode | undefined;
}
export function baselineMode(e: MapIndexEntry): ReviewMode {
  if (e.modeGroupId === 'climb') return 'climb';
  if (e.modeGroupId === 'trenchwars') return 'tw';
  if (e.modeGroupId !== 'ctf') return 'uncertain';
  const counts = e.polyTypeCounts, spawns = e.spawnTeamCounts;
  return spawns[1] > 0 && !spawns[2] && spawns[6] > 0 &&
    ((counts[5] || 0) + (counts[6] || 0) + (counts[18] || 0)) / e.polygonCount >= 0.08 ? 'climb' : 'ctf';
}
export function inferredMode(e: MapIndexEntry): ReviewMode {
  const base = baselineMode(e);
  if (base !== 'ctf' || e.startJetGame !== 0 || !e.spawnTeamCounts[1] || !e.spawnTeamCounts[6]) return base;
  const counts = e.polyTypeCounts;
  const obstacles = (counts[5] || 0) + (counts[6] || 0) + (counts[18] || 0);
  return obstacles / e.polygonCount >= 0.2 ? 'climb' : base;
}
export type AuditLabels = Readonly<Record<string, ReviewMode>>;
export function auditKey(e: Pick<MapIndexEntry, 'crc32' | 'fileSize'>) { return (e.crc32 >>> 0).toString(16) + '/' + e.fileSize; }

export function loadable(e: MapIndexEntry) {
  return !e.limitViolationCount && !e.parseWarningCount && e.polygonCount > 0;
}

export function creditedAuthors(e: MapIndexEntry): string[] {
  const explicit = tagged(e, 'author');
  if (explicit.length) return explicit;
  // Only explicit credits in the PMS title. Many maps use a generic title, clan prefix or no credit.
  return [...(e.title ?? '').matchAll(/\bby(?:\s*:\s*|\s+)(.+?)(?=\s+-\s+|---|$)/gi)]
    .flatMap(m => m[1].split(/\s+and\s+|\s*&\s*/i))
    .map(s => lower(s).replace(/[.,!\s]+$/, '')).filter(Boolean);
}

function collectionKeys(e: MapIndexEntry): Set<string> {
  const keys = new Set(['all']);
  if (e.favorite) keys.add('favorites');
  if (e.sourceId) keys.add('source:' + e.sourceId);
  for (const tag of e.tags ?? []) if (!/^(author|family|mode):/i.test(tag)) keys.add('tag:' + lower(tag));
  return keys;
}

function familyKey(name: string) {
  return stripDerivedSuffix(name)
    .replace(/^ctf_(?=(?:kz|cl|tw|race|climb)_)/, '')
    .replace(/(?:[_ -](?:v(?:er)?\.?\d+(?:\.\d+)*|rev\d+|fixed|remake))+$/i, '');
}

class Groups {
  private parents: number[];
  constructor(n: number) { this.parents = Array.from({ length: n }, (_, i) => i); }
  id(index: number): number {
    let i = index;
    while (this.parents[i] !== i) { this.parents[i] = this.parents[this.parents[i]]; i = this.parents[i]; }
    return i;
  }
  join(a: number, b: number) {
    const x = this.id(a), y = this.id(b);
    this.parents[Math.max(x, y)] = Math.min(x, y);
  }
}
export function stableOrder(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface LibraryFamily { name: string; entries: MapIndexEntry[]; authors: Set<string>; keys: Set<string>; holdout: boolean }

export function groupFamilies(candidates: readonly MapIndexEntry[]): LibraryFamily[] {
  const groups = new Groups(candidates.length);
  const first = new Map<string, number>();
  const names = new Map<string, number>();
  function match(key: string, i: number) {
    const j = first.get(key);
    if (j === undefined) first.set(key, i); else groups.join(i, j);
  }
  candidates.forEach((e, i) => {
    const name = mapName(e);
    names.set(name, i);
    match('name:' + familyKey(name), i);
    match('bytes:' + e.crc32 + '/' + e.fileSize, i);
    for (const tag of tagged(e, 'family')) match('manual:' + tag, i);
  });
  // Recognise workshop names shortened to the 16/20/24/32 character export limits.
  for (const [name, i] of names) {
    for (const version of derivedNamesOf(stripDerivedSuffix(name))) {
      const j = names.get(version);
      if (j !== undefined) groups.join(i, j);
    }
  }
  const bins = new Map<number, MapIndexEntry[]>();
  candidates.forEach((e, i) => {
    const id = groups.id(i), bin = bins.get(id);
    if (bin) bin.push(e); else bins.set(id, [e]);
  });
  const families = [...bins.values()].map(entries => {
    const rank = (e: MapIndexEntry) => Number(stripDerivedSuffix(mapName(e)) !== mapName(e));
    entries.sort((a, b) => rank(a) - rank(b) || cmp(mapName(a), mapName(b)) || cmp(a.fullPath, b.fullPath));
    return { name: mapName(entries[0]), entries, authors: new Set(entries.flatMap(creditedAuthors)),
      keys: new Set(entries.flatMap(e => [...collectionKeys(e)])), holdout: false };
  }).sort((a, b) => cmp(a.name, b.name));

  const authors = new Map<string, number>(), components = new Groups(families.length);
  families.forEach((f, i) => { for (const a of f.authors) {
    const other = authors.get(a);
    if (other === undefined) authors.set(a, i); else components.join(i, other);
  }});
  const blocks = new Map<number, LibraryFamily[]>();
  families.forEach((f, i) => {
    const k = components.id(i), block = blocks.get(k);
    if (block) block.push(f); else blocks.set(k, [f]);
  });
  // Keep coauthors and every variant together. A single connected group cannot be evaluated independently.
  const sorted = [...blocks.values()].sort((a, b) => stableOrder(a[0].name) - stableOrder(b[0].name) || cmp(a[0].name, b[0].name));
  let count = 0;
  const target = Math.max(1, Math.round(families.length / 5));
  if (sorted.length > 1) {
    for (const block of sorted) {
      if (count + block.length >= families.length || Math.abs(target - count - block.length) >= Math.abs(target - count)) continue;
      block.forEach(f => { f.holdout = true; });
      count += block.length;
    }
    if (!count) sorted.reduce((a, b) => a.length <= b.length ? a : b).forEach(f => { f.holdout = true; });
  }
  return families;
}

export function climbFamilies(entries: readonly MapIndexEntry[], audit: AuditLabels = {}) {
  return groupFamilies(entries.filter(e => loadable(e) && (reviewedMode(e) ?? audit[auditKey(e)] ?? inferredMode(e)) === 'climb' &&
    [0, 2, 4, 5, 6, 7, 18].some(type => (e.polyTypeCounts[type] || 0) > 0)));
}

export function describeCollections(families: LibraryFamily[]): StyleCollection[] {
  const labels = new Map<string, string>(), counts = new Map<string, number>();
  for (const f of families) {
    for (const k of f.keys) counts.set(k, 1 + (counts.get(k) ?? 0));
    for (const e of f.entries) {
      if (e.sourceId) labels.set('source:' + e.sourceId, e.sourceLabel || e.sourceId);
      for (const tag of e.tags ?? []) labels.set('tag:' + lower(tag), tag);
    }
  }
  return [...counts].map(([key, count]) => ({ key, label: labels.get(key) ?? key, count }));
}
export function collectionMember(f: LibraryFamily, key: string): MapIndexEntry {
  return f.entries.find(e => collectionKeys(e).has(key)) ?? f.entries[0];
}
