import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ArchiveCleanMap } from './archiveCleaner';
import type { ArchiveRecoverySummary } from '../shared/archiveCleanerTypes';
import { csvCell, indexReviewCandidates } from './archiveReview';

const identity = (m:ArchiveCleanMap) => JSON.stringify([m.source,m.sha256]);

export function missingArtwork(map:ArchiveCleanMap) {
  return map.issues.some(issue=>/^(?:scenery|texture)\/.+ · missing$/u.test(issue));
}

export async function writeRecoveryReport(file:string,baseline:string,previous:readonly ArchiveCleanMap[],current:readonly ArchiveCleanMap[],signal?:AbortSignal, include?:(row:ArchiveCleanMap)=>boolean) {
  const oldOutputs = new Set<string>();
  const entries = new Map<string, ArchiveCleanMap[]>();
  for (const row of previous) if (row.outputSha256 && row.status !== 'blocked') {
    oldOutputs.add(row.outputSha256);
  }
  for (const row of current) {
    const key = identity(row), bucket = entries.get(key);
    if (bucket) bucket.push(row); else entries.set(key,[row]);
  }
  const candidatesFor = indexReviewCandidates(previous);
  const todo = previous.filter(m => m.status === 'blocked' && (!include || include(m)))
    .map(old => ({old,withCandidate: !candidatesFor(old).next().done}))
    .sort((a,b)=>Number(b.withCandidate)-Number(a.withCandidate));
  const added = new Set<string>();
  const summary: ArchiveRecoverySummary = {baseline,reviewed:todo.length,withCandidates:0,recovered:0,recoveredWithCandidates:0,newOutputs:0,matchedPreviousOutputs:0,changedOrAbsent:0};
  signal?.throwIfAborted();
  const temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temporary,'wx');
  let published = false;
  try {
    let text='\ufeff'+['Original package and file','Source SHA-256','Candidate in previous report','Previous reason','Result','Verification or remaining cause','Output file','Output PMS SHA-256'].map(csvCell).join(';')+'\r\n';
    for (const {old,withCandidate} of todo) {
      signal?.throwIfAborted();
      const row=entries.get(identity(old))?.pop();
      if (withCandidate) summary.withCandidates++;
      let result='Still needs review';
      let reason=row ? [...row.issues,...(row.repairs??[])].join(' | ') : 'No occurrence with the same path and SHA-256 in the current collection';
      if (!row) { summary.changedOrAbsent++; result='Changed or missing in the source'; }
      else if (row.status !== 'blocked' && row.outputSha256) {
        summary.recovered++;
        if (withCandidate) summary.recoveredWithCandidates++;
        if (oldOutputs.has(row.outputSha256)) { summary.matchedPreviousOutputs++; result='Confirmed a map that is already present'; }
        else { added.add(row.outputSha256); result='Recovered'; }
        reason=row.repairs?.join(' | ') || 'PMS read again and all required assets verified';
      }
      text += [old.source,old.sha256,withCandidate?'yes':'no',old.issues.join(' | '),result,reason,row?.output,row?.outputSha256].map(csvCell).join(';')+'\r\n';
      if (text.length>=131072) { await handle.writeFile(text,'utf8'); text=''; }
    }
    if (text) await handle.writeFile(text,'utf8');
    signal?.throwIfAborted();
    await handle.close();
    await fs.rename(temporary,file);
    published = true;
  } finally {
    if (!published) {
      await handle.close().catch(()=>{});
      await fs.rm(temporary,{force:true});
    }
  }
  summary.newOutputs=added.size;
  return summary;
}
