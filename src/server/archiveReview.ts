import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ArchiveCleanMap } from './archiveCleaner';

const columns=[
  'Blocked original','Reason for review','Review copy after export','Blocked source SHA-256','Blocked bytes',
  'Candidate basis','Candidate original','Canonical map after export','Candidate source SHA-256','Candidate bytes',
];
type KeyIndex=Map<string,Map<string,ArchiveCleanMap>>;
const filename=(source:string)=>path.posix.basename(source.replaceAll('\\','/')).normalize('NFC').toLowerCase();
function index(group:KeyIndex,key:string,m:ArchiveCleanMap) {
  const outputs=group.get(key)??new Map<string,ArchiveCleanMap>();
  const old=outputs.get(m.output!);
  if(!old || old.status==='duplicate'&&m.status==='ready'||old.status===m.status&&m.source<old.source)outputs.set(m.output!,m);
  group.set(key,outputs);
}
export function csvCell(value:string|number|undefined){
  let s=String(value??'');
  // Quoting by itself does not disable spreadsheet formula evaluation. Some importers skip
  // a leading tab, BOM or zero-width character before considering the first visible symbol.
  if(/^[\s\p{Cc}\p{Cf}]*[=+@\-＝＋＠－]/u.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
  s=s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  return '"'+s.replaceAll('"','""')+'"';
}
/** The CSV and the recovery summary use the same ranked candidates. */
export function indexReviewCandidates(maps:readonly ArchiveCleanMap[]) {
  const hashes:KeyIndex=new Map(),byName:KeyIndex=new Map(),bySize:KeyIndex=new Map(),byGeometry:KeyIndex=new Map();
  for(const m of maps){
    if(m.status==='blocked'||!m.output)continue;
    const name=filename(m.source);index(hashes,m.sha256,m);index(byName,name,m);
    if(m.sourceSize!==undefined)index(bySize,name+'\0'+m.sourceSize,m);
    if(m.geometrySha256)index(byGeometry,name+'\0'+m.geometrySha256,m);
  }
  return function* forMap(m:ArchiveCleanMap) {
    const name=filename(m.source),seen=new Set<string>();
    const groups:[Map<string,ArchiveCleanMap>|undefined,string][]=[
      [hashes.get(m.sha256),'Identical source PMS bytes (SHA-256); package resources may differ'],
      [m.geometrySha256?byGeometry.get(name+'\0'+m.geometrySha256):undefined,'Same original filename and polygon data (SHA-256)'],
      [m.sourceSize!==undefined?bySize.get(name+'\0'+m.sourceSize):undefined,'Same original filename and byte count; compare manually'],
      [byName.get(name),'Same original filename only; compare manually'],
    ];
    for(const [candidates,basis] of groups)for(const [output,candidate] of candidates??[]){
      if(seen.has(output)||candidate.source===m.source)continue;
      seen.add(output);
      yield {basis,output,candidate};
    }
  };
}

/** Spreadsheet suggestions for the author's inspection. Only successful outputs can be candidates. */
export async function writeArchiveReviewCsv(file:string,maps:readonly ArchiveCleanMap[],signal?:AbortSignal) {
  signal?.throwIfAborted();
  const candidatesFor = indexReviewCandidates(maps);
  const temporary=file+'.'+randomUUID()+'.tmp',handle=await open(temporary,'wx');
  let complete=false;
  try{
    let text='\ufeff'+columns.map(csvCell).join(';')+'\r\n';
    for(const m of maps){
      if(m.status!=='blocked')continue;
      signal?.throwIfAborted();
      const head=[m.source,m.issues.join(' | '),'review/maps/'+m.sha256+'.pms',m.sha256,m.sourceSize];
      let hasCandidate=false;
      for(const {basis,output,candidate} of candidatesFor(m)){
        hasCandidate=true;
        text+=[...head,basis,candidate.source,'maps/'+output,candidate.sha256,candidate.sourceSize].map(csvCell).join(';')+'\r\n';
        if(text.length>=131072){await handle.writeFile(text,'utf8');text='';signal?.throwIfAborted();}
      }
      if(!hasCandidate)text+=[...head,'No ready counterpart found','','','',''].map(csvCell).join(';')+'\r\n';
      if(text.length>=131072){await handle.writeFile(text,'utf8');text='';}
    }
    if(text)await handle.writeFile(text,'utf8');
    signal?.throwIfAborted();
    await handle.close();await rename(temporary,file);complete=true;
  }finally{
    if(!complete){await handle.close().catch(()=>{});await rm(temporary,{force:true});}
  }
}
