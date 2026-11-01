import fs from 'fs';
import path from 'path';
import { MapUserData, MapUserDataPatch } from '../shared/apiTypes';

const MAX_TAGS_PER_MAP = 20;
const MAX_TAG_LENGTH = 32;

/**
 * Favourites and user tags per map id, kept in `data/user-data.json` (survives browser data clearing and
 * index rebuilds). Every change is written atomically right away: the file is small and changes are rare.
 */
export class UserDataStore {
  private readonly entries = new Map<string, MapUserData>();

  constructor(private readonly filePath: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const maps = raw && typeof raw === 'object' && raw.maps && typeof raw.maps === 'object' ? raw.maps : {};
      for (const [mapId, value] of Object.entries(maps)) {
        const clean = normalizeUserData(value as MapUserDataPatch);
        if (clean) this.entries.set(mapId, clean);
      }
    } catch {
      // Missing or damaged file: start empty (a damaged file is overwritten on the next change)
    }
  }

  public get(mapId: string): MapUserData | undefined {
    return this.entries.get(mapId);
  }

  public update(mapId: string, patch: MapUserDataPatch): MapUserData {
    const current = this.entries.get(mapId) ?? {};
    const next = normalizeUserData({
      favorite: patch.favorite !== undefined ? patch.favorite : current.favorite,
      tags: patch.tags !== undefined ? patch.tags : current.tags,
    });
    if (next) this.entries.set(mapId, next);
    else this.entries.delete(mapId);
    this.save();
    return next ?? {};
  }

  public entriesList(): Array<[string, MapUserData]> {
    return Array.from(this.entries.entries());
  }

  private save(): void {
    const maps: Record<string, MapUserData> = {};
    for (const [id, data] of this.entries) maps[id] = data;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, maps }, null, 1), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }
}

/** Trims tags, collapses spaces, drops duplicates (case-insensitive) and empty entries */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const clean = t.replace(/["\s]+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_TAGS_PER_MAP) break;
  }
  return out;
}

function normalizeUserData(value: MapUserDataPatch | null | undefined): MapUserData | null {
  if (!value || typeof value !== 'object') return null;
  const favorite = value.favorite === true;
  const tags = normalizeTags(value.tags);
  if (!favorite && tags.length === 0) return null;
  const out: MapUserData = {};
  if (favorite) out.favorite = true;
  if (tags.length > 0) out.tags = tags;
  return out;
}
