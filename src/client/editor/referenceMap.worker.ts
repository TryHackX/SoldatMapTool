import { parsePmsFull, serializePms } from '@shared/pmsParser';
import { generateReferenceMap, MAX_STYLE_REFERENCES, type ReferenceOptions, type ReferenceReport } from '@shared/referenceMapGenerator';
import { runReferencePilot } from './referencePilot';
import type { TunnelTrialResult } from './tunnelTrial';
import type { MapAssetSource } from '../renderer/mapAssetSource';
export interface ReferenceInput {
  id: string;
  crc32: number;
  baseName: string;
}
export const REFERENCE_TRIAL_ATTEMPTS = 6;
export type ReferenceJob = {
  kind: 'generate' | 'variants';
  sources: ReferenceInput[];
  options: ReferenceOptions;
} | {
  kind: 'pilot';
  bytes: Uint8Array;
};
export type ReferenceReply = {
  kind: 'progress';
  name: string;
} | {
  kind: 'attempt';
  n: number;
  total: number;
} | {
  kind: 'exhausted';
  total: number;
} | {
  kind: 'map';
  bytes: Uint8Array;
  report: ReferenceReport;
  assetSource?: MapAssetSource;
  mixedSceneryPackages: boolean;
  seed: number;
  trial?: TunnelTrialResult;
} | {
  kind: 'pilot';
  trial: TunnelTrialResult | null;
} | {
  kind: 'error';
  message: string;
  name?: string;
};
self.onmessage = async ({ data }: MessageEvent<ReferenceJob>) => {
  let name: string | undefined;
  try {
    if (data.kind === 'pilot') {
      self.postMessage({ kind: 'pilot', trial: runReferencePilot(parsePmsFull(data.bytes)) } satisfies ReferenceReply);
      return;
    }
    if (!data.sources.length || data.sources.length > MAX_STYLE_REFERENCES)
      throw Error('Invalid reference settings.');
    const maps = [];
    const assetSources: (MapAssetSource | undefined)[] = [];
    for (const source of data.sources) {
      name = source.baseName;
      self.postMessage({ kind: 'progress', name } satisfies ReferenceReply);
      const response = await fetch('/api/maps/' + encodeURIComponent(source.id) + '/raw');
      if (!response.ok)
        throw Error('Could not read the reference.');
      const map = parsePmsFull(await response.arrayBuffer());
      if (map.parseWarnings.length || !map.polygons.length || map.crc32 !== (source.crc32 >>> 0))
        throw Error('The reference changed or could not be read.');
      maps.push(map);
      const key = response.headers.get('X-Soldat-Asset-Scope');
      assetSources.push(key ? { mapId: source.id, key } : undefined);
    }
    name = undefined;
    const total = data.kind === 'variants' ? REFERENCE_TRIAL_ATTEMPTS : 1;
    for (let n = 1; n <= total; n++) {
      const seed = (data.options.seed + (data.kind === 'variants' ? n : 0)) % 0x80000000;
      if (data.kind === 'variants')
        self.postMessage({ kind: 'attempt', n, total } satisfies ReferenceReply);
      let result;
      try {
        result = generateReferenceMap(maps, { ...data.options, seed });
      }
      catch (e) {
        if (data.kind === 'variants' && e instanceof Error && e.message.startsWith('This composition exceeds'))
          continue;
        throw e;
      }
      const bytes = serializePms(result.map);
      const trial = data.kind === 'variants' ? runReferencePilot(parsePmsFull(bytes)) : undefined;
      if (data.kind === 'variants' && !trial?.reached)
        continue;
      const assetSource = assetSources[data.options.look];
      const mixedSceneryPackages = result.scenerySources.some(i => assetSources[i]?.key !== assetSource?.key);
      self.postMessage({ kind: 'map', bytes, report: result.report, assetSource, mixedSceneryPackages,
        seed, trial: trial ?? undefined } satisfies ReferenceReply, { transfer: [bytes.buffer] });
      return;
    }
    self.postMessage({ kind: 'exhausted', total } satisfies ReferenceReply);
  }
  catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Generation failed.', name } satisfies ReferenceReply);
  }
};
