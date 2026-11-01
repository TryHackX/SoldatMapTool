import {
  ExtraMapSource,
  IndexMetaResponse,
  MapCompactEntry,
  MapIndexEntry,
  MapQueryRequest,
  MapQueryResponse,
  ScanProgressStatus,
} from '@shared/apiTypes';
import { parsePmsFull, PmsMapData } from '@shared/pmsParser';
import { CustomPrefixRule } from '@shared/prefixUtils';

const parsedMapLru = new Map<string, PmsMapData>();
const inFlight = new Map<string, Promise<PmsMapData>>();
const MAX_CACHED_MAPS = 25;

const mapDetailsLru = new Map<string, MapIndexEntry>();
const MAX_CACHED_DETAILS = 60;

export function clearClientMapCaches(): void {
  parsedMapLru.clear();
  mapDetailsLru.clear();
}

export async function fetchAndParseMap(mapId: string): Promise<PmsMapData> {
  if (parsedMapLru.has(mapId)) {
    const data = parsedMapLru.get(mapId)!;
    parsedMapLru.delete(mapId);
    parsedMapLru.set(mapId, data);
    return data;
  }

  if (inFlight.has(mapId)) {
    return inFlight.get(mapId)!;
  }

  const promise = (async () => {
    const res = await fetch(`/api/maps/${encodeURIComponent(mapId)}/raw`);
    if (!res.ok) {
      throw new Error(`Nie udało się wczytać pliku mapy ${mapId} (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    const parsed = parsePmsFull(buf);

    if (parsedMapLru.size >= MAX_CACHED_MAPS) {
      const oldestKey = parsedMapLru.keys().next().value;
      if (oldestKey !== undefined) {
        parsedMapLru.delete(oldestKey);
      }
    }
    parsedMapLru.set(mapId, parsed);
    return parsed;
  })();

  inFlight.set(mapId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(mapId);
  }
}

export async function fetchMapDetails(mapId: string, force = false): Promise<MapIndexEntry> {
  if (!force && mapDetailsLru.has(mapId)) {
    const hit = mapDetailsLru.get(mapId)!;
    mapDetailsLru.delete(mapId);
    mapDetailsLru.set(mapId, hit);
    return hit;
  }
  const res = await fetch(`/api/maps/${encodeURIComponent(mapId)}/details`);
  if (!res.ok) {
    throw new Error(`Nie udało się pobrać szczegółów mapy ${mapId} (${res.status})`);
  }
  const entry: MapIndexEntry = await res.json();
  if (mapDetailsLru.size >= MAX_CACHED_DETAILS) {
    const oldest = mapDetailsLru.keys().next().value;
    if (oldest !== undefined) mapDetailsLru.delete(oldest);
  }
  mapDetailsLru.set(mapId, entry);
  return entry;
}

export async function fetchIndexMeta(forceRefresh = false): Promise<IndexMetaResponse> {
  const res = await fetch(`/api/index/meta${forceRefresh ? '?refresh=1' : ''}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (forceRefresh) {
    clearClientMapCaches();
  }
  return await res.json();
}

export async function fetchScanStatus(): Promise<ScanProgressStatus> {
  const res = await fetch('/api/scan/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function queryMapsPage(
  req: MapQueryRequest,
  signal?: AbortSignal
): Promise<MapQueryResponse> {
  const res = await fetch('/api/maps/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

export async function queryMatchingMapIds(req: MapQueryRequest): Promise<string[]> {
  const res = await fetch('/api/maps/query-ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Nie udało się pobrać listy map (HTTP ${res.status})`);
  return Array.isArray(data.ids) ? data.ids : [];
}

export async function queryMatchingMapCompacts(
  req: MapQueryRequest
): Promise<MapCompactEntry[]> {
  const res = await fetch('/api/maps/query-compacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Nie udało się pobrać listy map (HTTP ${res.status})`);
  return Array.isArray(data.items) ? data.items : [];
}

export async function saveCustomPrefixRules(
  customRules: CustomPrefixRule[]
): Promise<IndexMetaResponse> {
  const res = await fetch('/api/prefix-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customRules }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  mapDetailsLru.clear();
  return await res.json();
}

export async function saveAppConfig(
  soldatPath: string,
  extraSources: ExtraMapSource[]
): Promise<IndexMetaResponse> {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soldatPath, extraSources }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  clearClientMapCaches();
  return await res.json();
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

export async function openPathInExplorer(targetPath: string): Promise<void> {
  await fetch('/api/system/open-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
}

export async function pickSystemFolder(description: string): Promise<string | null> {
  const res = await fetch('/api/system/pick-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.path || null;
}

export async function pickSystemFile(filter?: string): Promise<string | null> {
  const res = await fetch('/api/system/pick-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.path || null;
}
