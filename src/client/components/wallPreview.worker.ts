import { insertWallProtection, planWallProtection, wallSourceProblem, type WallSettings } from '@shared/wallProtection';
import {parsePmsFull,serializePms,type PmsMapData} from '@shared/pmsParser';

self.onmessage = ({data}: MessageEvent<({map:PmsMapData}|{bytes:ArrayBuffer;crc:number}) & {settings:WallSettings}>) => {
  try {
    if ('bytes' in data) {
      const map=parsePmsFull(data.bytes);
      if (map.crc32!==data.crc) throw Error('Map changed. Reload the library before exporting.');
      const problem=wallSourceProblem(map);
      if (problem) throw Error(problem);
      const plan=planWallProtection(map,data.settings);
      const bytes=plan.polygons.length ? serializePms(insertWallProtection(map,plan)) : undefined;
      self.postMessage({bytes,added:plan.polygons.length},bytes ? {transfer:[bytes.buffer]} : {});
    } else {
      self.postMessage(planWallProtection(data.map,data.settings));
    }
  } catch (error) { self.postMessage({error:error instanceof Error ? error.message : String(error)}); }
};
