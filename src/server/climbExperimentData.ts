import {readFile} from 'node:fs/promises';
import {parsePmsFull,soldatCrc32} from '../shared/pmsParser';
import {measureClimbTerrain} from '../shared/climbSamples';
import type {ExperimentDataset} from '../shared/climbModelExperiment';
import {collectionMember,type LibraryFamily} from './climbCollections';

/** Return only linked numeric ledges to the local editor. No source file, map name, author
 * credit or fitted coefficient is written to disk or included in a generated map. */
export async function collectExperimentData(families:LibraryFamily[],collection:string,signal:AbortSignal):Promise<ExperimentDataset> {
  const selected=families.filter(f=>f.keys.has(collection));
  const result:ExperimentDataset={families:[],selected:selected.length,skipped:0,unreadable:0};
  for(const f of selected){
    signal.throwIfAborted();
    const member=collectionMember(f,collection);
    const matches=[member,...f.entries.filter(entry=>entry!==member && entry.fileSize===member.fileSize && entry.crc32===member.crc32)];
    let sequences:ReturnType<typeof measureClimbTerrain>['sequences']|undefined;
    for(const entry of matches){
      try{
        const bytes=await readFile(entry.fullPath,{signal});
        if(bytes.length!==entry.fileSize || soldatCrc32(bytes)!==entry.crc32) continue;
        sequences=measureClimbTerrain(parsePmsFull(bytes).polygons,true).sequences;
        break;
      }catch{signal.throwIfAborted();}
    }
    if(!sequences){result.unreadable++;continue;}
    if(!sequences.length){result.skipped++;continue;}
    const n=Math.min(32,sequences.length), rows=sequences;
    result.families.push({holdout:f.holdout,knownAuthor:f.authors.size>0,
      sequences:Array.from({length:n},(_,i)=>rows[Math.floor((i+0.5)*rows.length/n)])});
  }
  return result;
}

