import path from 'node:path';
import type { PmsSummaryData } from '../shared/pmsParser';
import { AssetBindings, fold, type CatalogFile, type ImageInfo } from './archiveBindings';

interface Reference {
  name: string; used: boolean; date: number; width: number; height: number;
}

export function sceneryReferences(bytes: Buffer, m: PmsSummaryData): Reference[] {
  const refs = m.scenery.map(s => ({name:s.filename,used:s.usedCount>0,date:s.date,width:0,height:0}));
  if (m.gameplayOffsets) for (let i=0;i<m.propCount;i++) {
    const at=m.gameplayOffsets.props+44*i;
    const ref=refs[bytes.readUInt16LE(at+2)-1];
    if (!ref || !ref.used || !bytes[at] || bytes[at+40]>2) continue;
    const width=bytes.readInt32LE(at+4),height=bytes.readInt32LE(at+8);
    if (width<=0 || height<=0 || (ref.width!==0 && (ref.width!==width || ref.height!==height))) {
      ref.width=ref.height=-1; // Cropped, absent or conflicting dimensions cannot identify a bitmap.
    } else { ref.width=width;ref.height=height; }
  }
  return refs;
}

const keyOf = (ref:Reference) => JSON.stringify([fold(ref.name),ref.date,ref.width,ref.height]);
export function hasAuthoredSceneryIdentity(ref:Reference) {
  const stamp=ref.date;
  const month=(stamp>>>21)&15, day=(stamp>>>16)&31;
  const hours=(stamp>>>11)&31, minutes=(stamp>>>5)&63, seconds=(stamp&31)*2;
  return ref.used && ref.width>0 && ref.height>0 && stamp!==0 &&
    month>=1 && month<=12 && day>=1 && hours<24 && minutes<60 && seconds<60;
}

/** Recover only when a directly packaged original depicts the exact named/timestamped
 * scenery at its intrinsic size, and every other known byte candidate can be excluded. */
export class ArchiveSceneryWitness {
  private readonly sources = new Map<string, CatalogFile[]>();
  private readonly single = new Map<string, string|null>();
  private readonly evidence = new Map<string,{file:CatalogFile,map:CatalogFile}|null>();

  constructor(files: readonly CatalogFile[], refs: (sha:string)=>readonly Reference[],
      private readonly index:AssetBindings, private readonly images:ReadonlyMap<string,ImageInfo|null>) {
    for (const f of files) {
      if (!this.single.has(f.scope)) this.single.set(f.scope,f.sha256);
      else if (this.single.get(f.scope)!==f.sha256) this.single.set(f.scope,null);
    }
    for (const f of files) {
      const seen=new Set<string>();
      for (const r of refs(f.sha256)) {
        if (!hasAuthoredSceneryIdentity(r)) continue;
        const key=keyOf(r);
        if (seen.has(key)) continue;
        seen.add(key);
        const group=this.sources.get(key);
        if (group) group.push(f); else this.sources.set(key,[f]);
      }
    }
  }

  find(target: CatalogFile, ref:Reference) {
    if (!hasAuthoredSceneryIdentity(ref)) return null;
    const local=this.index.resolve('scenery',ref.name,target.scope,true,true);
    if (!('error' in local) || local.error!=='missing') return null;
    const key=keyOf(ref);
    if (this.evidence.has(key)) return this.evidence.get(key)!;
    const source=this.match(key,ref);
    this.evidence.set(key,source);
    return source;
  }

  private match(key:string,ref:Reference) {
    const ext=path.posix.extname(ref.name).toLowerCase().replace(/^\.jpeg$/,'.jpg');
    let hash:string|undefined;
    for (const data of this.index.sceneryCandidates(ref.name)) {
      const info=this.images.get(data.sha256);
      if (!info) return null;
      if (info.width!==ref.width || info.height!==ref.height) continue;
      if (info.ext!==ext || (hash && hash!==data.sha256)) return null;
      hash=data.sha256;
    }
    if (!hash) return null;
    let winner:{file:CatalogFile,map:CatalogFile}|null=null;
    for (const map of this.sources.get(key)??[]) {
      const local=this.index.resolve('scenery',ref.name,map.scope,true,true);
      if ('error' in local) { if (local.error!=='missing') return null; continue; }
      const file=this.index.completed(local.file)??local.file;
      if (file.sha256!==hash) return null;
      if (map.scope===local.file.scope && this.single.get(map.scope)===map.sha256 &&
          (!winner || map.path<winner.map.path)) winner={file,map};
    }
    return winner;
  }
}
