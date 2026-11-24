import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { MapIndexEntry } from '../shared/apiTypes';
import type { SoldatAssetResolver } from './assetResolver';
import { diskPathKey } from './diskPath';

/** Digests are keyed by path, size and modification time, so a cache kept between scans never serves a changed file */
async function fileDigest(file: string, cache: Map<string,string>, previous?: ReadonlyMap<string,string>) {
  let key: string;
  try {
    const info = await stat(file);
    key = diskPathKey(file) + '|' + info.size + '|' + info.mtimeMs;
  } catch {
    return null;
  }
  const cached = cache.get(key) ?? previous?.get(key);
  if (cached) {
    cache.set(key, cached);
    return cached;
  }
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  } catch {
    return null;
  }
  const digest = hash.digest('hex');
  cache.set(key, digest);
  return digest;
}

// The same PMS can have a different appearance in two packages. Compare the files that the
// game can render in HD/classic and retain the distinction between a present and a missing file.
function graphics(map: MapIndexEntry, resolver: SoldatAssetResolver, root?: string) {
  const paths: (string | null)[] = [];
  function collect(category: 'textures' | 'textures/edges' | 'scenery-gfx', name: string) {
    for (const classic of [false, true]) {
      paths.push(resolver.findBestRenderFile(category, name, classic, root)?.fullPath ?? null);
    }
  }
  const texture = map.texture || 'default.bmp';
  collect('textures', texture);
  collect('textures/edges', texture);
  for (const sc of map.sceneryAssets) collect('scenery-gfx', sc.referencedName);
  return paths;
}

/** CRC and size shortlist only. Unreadable files never establish identity. */
export async function confirmedDuplicateGroups(entries: MapIndexEntry[], resolver: SoldatAssetResolver,
  digests = new Map<string,string>(), previous?: ReadonlyMap<string,string>): Promise<MapIndexEntry[][]> {
  const byMap = new Map<string, MapIndexEntry[]>();
  for (const entry of entries) {
    const hash = await fileDigest(entry.fullPath, digests, previous);
    if (!hash) continue;
    const group = byMap.get(hash) ?? [];
    group.push(entry);
    byMap.set(hash, group);
  }
  const result: MapIndexEntry[][] = [];
  for (const maps of byMap.values()) {
    if (maps.length < 2) continue;
    const roots = new Map<string | undefined, MapIndexEntry[]>();
    for (const map of maps) {
      const root = resolver.packageRootForMap(map.fullPath, map.sourceId);
      const group = roots.get(root) ?? [];
      group.push(map);
      roots.set(root, group);
    }
    if (roots.size === 1) { result.push(maps); continue; }
    const packages = [...roots].map(([root, group]) => ({ group, files: graphics(group[0], resolver, root) }));
    // Identical paths (including a shared missing reference) require no asset I/O.
    const varyingSlots = packages[0].files.flatMap((f, i) => packages.some(p => p.files[i] !== f) ? [i] : []);
    const byGraphics = new Map<string,MapIndexEntry[]>();
    for (const pack of packages) {
      const hashes: (string | null)[] = [];
      let readable = true;
      for (const i of varyingSlots) {
        const file = pack.files[i];
        const hash = file ? await fileDigest(file, digests, previous) : null;
        if (file && !hash) { readable = false; break; }
        hashes.push(hash);
      }
      if (!readable) {
        if (pack.group.length > 1) result.push(pack.group);
        continue;
      }
      const key = JSON.stringify(hashes);
      const group = byGraphics.get(key) ?? [];
      for (const map of pack.group) group.push(map);
      byGraphics.set(key, group);
    }
    for (const group of byGraphics.values()) if (group.length > 1) result.push(group);
  }
  return result;
}
