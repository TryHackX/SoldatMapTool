import * as fs from 'node:fs/promises';
import { constants as openFlags } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { withZipMembers, type ZipMember } from './archiveZipReader';
import { scanIndexedCollection } from './archiveCollectionIndex';

export type ArchiveInputKind = 'map'|'scenery'|'texture'|'edge'|'image'|'overview'|'waypoint';
export interface ArchiveInputEntry {
  kind: ArchiveInputKind;
  name: string;
  path: string;
  scope: string;
  size: number;
  mtimeMs: number;
  origins?: string[];
  diskPath?: string;
  verifiedSha256?: string;
  materializedPath?: string;
  /** Consume during the awaited callback. Nested archives and the native reader release their buffers afterwards. */
  read(): Promise<Buffer>;
}
export interface ArchiveInputIssue {path:string; reason:string}
export interface ArchiveInputOptions {
  indexedMapPaths?: ReadonlySet<string>;
  onEntry?: (entry:ArchiveInputEntry)=>void|Promise<void>;
  onIssue?: (issue:ArchiveInputIssue)=>void;
  signal?: AbortSignal;
  includeArchives?: boolean;
  includeLoose?: boolean;
  useCollectionIndex?: boolean;
  tempDir?: string;
}
export interface ArchiveInputSummary {entries:number;archives:number;issues:number;bytes:number;indexedPackages:number;ignored:number}

const MAX_MEMBER = 128 * 1024**2;
const MAX_MAP = 32 * 1024**2;
const MAX_DEPTH = 5;
const MAX_RECORDS = 2_500_000;
const MAX_EXPANDED = 512 * 1024**3;
const converter = fileURLToPath(new URL('../../scripts/archive-members.py', import.meta.url));
const lower = (s:string) => s.toLowerCase();

/** Namespace and package scope belong to the original member, irrespective of the materialised filename. */
export function classifyArchivePath(provenance:string): Pick<ArchiveInputEntry,'kind'|'name'|'scope'>|null {
  const cut=provenance.lastIndexOf('!/');
  const prefix=cut<0?'':provenance.slice(0,cut+2);
  const parts=provenance.slice(cut<0?0:cut+2).replaceAll('\\','/').split('/');
  const name=parts.pop()??'', ext=lower(path.posix.extname(name));
  const folders=parts.map(lower);
  const idx=folders.findLastIndex(d=>['maps','map','scenery-gfx','scenery','sceneries','textures','texture','edges','overviews','previews','assets','waypoints'].includes(d));
  const dir=folders[idx];
  let kind:ArchiveInputKind;
  if(ext==='.pms')kind='map';
  else if(ext==='.wpt'||ext==='.way')kind='waypoint';
  else if(!['.bmp','.jpg','.jpeg','.gif','.png','.tga','.dds','.webp'].includes(ext))return null;
  else if(dir==='scenery-gfx'||dir==='scenery'||dir==='sceneries')kind='scenery';
  else if(dir==='textures'||dir==='texture')kind='texture';
  else if(dir==='edges')kind='edge';
  else if(dir==='assets'||dir==='overviews'||dir==='previews')kind='overview';
  else kind='image';
  const boundary=dir==='edges' && ['textures','texture'].includes(folders[idx-1])?idx-1:idx;
  const scope=prefix+parts.slice(0,boundary<0?parts.length:boundary).join('/');
  return {kind,name,scope:scope.endsWith('!/')?scope.slice(0,-2):scope};
}

// Never pass an archive member path to the filesystem. A unique private path is used for each temporary payload.
function cleanMember(s:string) {
  const p=s.replaceAll('\\','/'), parts=p.split('/');
  if(!p||p.startsWith('/')||parts.some(v=>v==='..'||/^[A-Za-z]:/.test(v)||/[\x00-\x1f]/.test(v))||p.includes('!/'))return null;
  return parts.filter(x=>x&&x!=='.').join('/');
}
function volume(name:string) {
  const split=/^(.*)\.part(\d+)\.rar$/i.exec(name)??/^(.*\.7z)\.(\d+)$/i.exec(name);
  if(split)return {group:lower(split[1]),index:Number(split[2]),first:1};
  const old=/^(.*)\.r(\d\d)$/i.exec(name);
  if(old)return {group:lower(old[1])+'.rar',index:Number(old[2])+1,first:0};
  return null;
}
function archiveKind(name:string) {
  if(/\.(zip|smap)$/i.test(name))return 'zip';
  if(/\.(rar|7z)$/i.test(name)||volume(name))return 'native';
  return null;
}
const unsupportedContainer=(name:string)=>/\.(?:z\d\d|ace|lzh|lha|cab|tar|tgz|gz|bz2|xz|pmp)$/i.test(name);
function packageParts<T extends {name:string}>(first:T,siblings:T[]) {
  const v=volume(first.name),group=v?.group??lower(first.name);
  const members=siblings.filter(s=>(volume(s.name)?.group??lower(s.name))===group);
  members.sort((a,b)=>(volume(a.name)?.index??0)-(volume(b.name)?.index??0));
  const start=v?.first??0;
  const complete=members.every((m,i)=>(volume(m.name)?.index??0)===start+i) && (start===1 || /\.rar$/i.test(members[0].name));
  return {members,complete:members.length===1&&!v||complete};
}

// Native formats are optional. The helper accepts regular members only and waits for acknowledgement
// before overwriting its spool, so duplicate or case-colliding names are independent on Windows.
async function visitNative(files:string[],work:string,signal:AbortSignal|undefined,visit:(m:ZipMember)=>Promise<void>) {
  const output=path.join(work,'member.bin');
  const child=spawn(process.platform==='win32'?'python':'python3',['-I',converter,output,...files],
    {windowsHide:true,stdio:['pipe','pipe','pipe'],signal});
  const error=new Promise<never>((_,reject)=>child.once('error',reject)); void error.catch(()=>{});
  const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  child.stdin.on('error',()=>{}); // A helper failure is reported on stdout or by the close event.
  const reader=createInterface({input:child.stdout,crlfDelay:Infinity});
  const lines=reader[Symbol.asyncIterator]();let stderr='';
  child.stderr.on('data',(b:Buffer)=>{if(stderr.length<1500)stderr+=b.toString().slice(0,1500-stderr.length);});
  async function message():Promise<{name?:string;size:number;mtimeMs:number;directory:boolean;problem?:string;end?:boolean;ready?:boolean;error?:string}> {
    const line=await Promise.race([lines.next(),error]);
    if(line.done)throw Error(stderr.trim()||'Native reader stopped. RAR/7z requires Python 3 and system libarchive.');
    const m=JSON.parse(line.value); if(m.error)throw Error(m.error); return m;
  }
  try {
    for(;;) {
      const m=await message(); if(m.end)break;
      if(typeof m.name!=='string')throw Error('Invalid native archive member');
      let ready=false;
      await visit({...m,name:m.name,async read(){
        if(!ready){child.stdin.write('r\n');if(!(await message()).ready)throw Error('Native member read failed');ready=true;}
        return fs.readFile(output);
      }});
      child.stdin.write(ready?'n\n':'s\n');
    }
  } finally { reader.close();child.stdin.end();if(child.exitCode===null)child.kill();await closed; }
}

class ConsumerFailure { constructor(readonly cause:unknown) {} }
class SourceReadError extends Error {}
class ScanLimit extends Error {}
const detail = (e:unknown) => e instanceof Error?e.message:String(e);

export async function scanArchiveInputs(selected:string, options:ArchiveInputOptions={}):Promise<ArchiveInputSummary> {
  const root=await fs.realpath(selected);
  const summary:ArchiveInputSummary={entries:0,archives:0,issues:0,bytes:0,indexedPackages:0,ignored:0};
  const loose=options.includeLoose!==false,archives=options.includeArchives!==false;
  const signal=options.signal;
  let records=0, expanded=0;
  const issue=(p:string,reason:string)=>{summary.issues++;options.onIssue?.({path:p,reason});};
  const record=()=>{signal?.throwIfAborted();if(++records>MAX_RECORDS)throw new ScanLimit('Archive scan entry budget exceeded');};
  const charge=(n:number)=>{expanded+=n;if(expanded>MAX_EXPANDED)throw new ScanLimit('Archive scan byte budget exceeded');};
  const rethrow=(e:unknown)=>{signal?.throwIfAborted();if(e instanceof ConsumerFailure||e instanceof ScanLimit)throw e;};
  async function emit(entry:ArchiveInputEntry) {
    signal?.throwIfAborted();
    if(entry.size<0 || entry.size>(entry.kind==='map'?MAX_MAP:MAX_MEMBER)){issue(entry.path,'File exceeds per-member scan limit');return;}
    summary.entries++;summary.bytes+=entry.size;
    try {await options.onEntry?.(entry);}catch(e){if(e instanceof SourceReadError)issue(entry.path,e.message);else throw new ConsumerFailure(e);}
  }
  let coveredFiles=new Set<string>(),coveredPackages=new Set<string>();
  const workBase=options.tempDir??tmpdir();
  async function withTemp<T>(fn:(folder:string)=>Promise<T>) {
    await fs.mkdir(workBase,{recursive:true});const dir=await fs.mkdtemp(path.join(workBase,'soldat-members-'));
    try{return await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}
  }
  async function scanPackage(source:string|Buffer,p:string,depth:number,otherPaths:string[]=[]):Promise<void> {
    if(depth>MAX_DEPTH){issue(p,'Nested archive depth limit reached');return;}
    summary.archives++;
    async function visit(m:ZipMember,prefix:string,overview:boolean,original=prefix) {
      if(m.directory)return;
      if(m.problem){issue(prefix,m.problem);return;}
      const info=classifyArchivePath(original) ?? (options.indexedMapPaths?.has(prefix)?classifyArchivePath(original+'.pms'):null);
      if(!info){if(unsupportedContainer(m.name))issue(prefix,'Unsupported archive or legacy map format');else summary.ignored++;return;}
      await emit({...info,kind:overview&&info.kind==='image'?'overview':info.kind,path:prefix,size:m.size,mtimeMs:m.mtimeMs,
        async read(){try{charge(m.size);return await m.read();}catch(e){rethrow(e);throw new SourceReadError(detail(e));}}});
    }
    try {
      if(archiveKind(p)==='zip' || (Buffer.isBuffer(source)&&source.length>=4&&source.readUInt32LE(0)===0x04034b50)) {
        await withZipMembers(source,async members=>{
          const tags=new Set(members.filter(m=>/\.(zip|rar|7z|pms)$/i.test(m.name)).map(m=>lower(m.name).replace(/\.[^./]+$/,'')));
          const seen=new Map<string,number>(),done=new Set<ZipMember>();
          for(const m of members) {
            record();if(done.has(m)||m.directory)continue;
            const clean=cleanMember(m.name);
            if(!clean){issue(p+'!/'+m.name,'Unsafe archive member path');continue;}
            const k=seen.get(clean)??0;seen.set(clean,k+1);
            const parent=k?p+' [entry '+(k+1)+']':p, label=parent+'!/'+clean;
            if(m.problem){issue(label,m.problem);continue;}
            if(archiveKind(clean)) {
              if(depth>=MAX_DEPTH || m.size>MAX_MEMBER){issue(label,'Nested archive depth or size limit reached');continue;}
              const parts=volume(m.name)||/\.rar$/i.test(m.name)?packageParts(m,members):{members:[m],complete:true};
              if(!parts.complete){issue(label,'Missing or duplicate archive volume');for(const v of parts.members)done.add(v);continue;}
              for(const v of parts.members)done.add(v);
              try {
                if(parts.members.some(v=>v.problem||v.size>MAX_MEMBER))throw Error('Unsafe or oversized nested archive volume');
                if(parts.members.length>1) {
                  await withTemp(async folder=>{
                    const files:string[]=[];
                    for(const v of parts.members){
                      charge(v.size);
                      const suffix=/\.part\d+\.rar$|\.7z\.\d+$|\.r\d\d$|\.rar$/i.exec(v.name)?.[0];
                      if(!suffix)throw Error('Unsupported volume numbering');
                      const file=path.join(folder,'volume'+suffix.toLowerCase());
                      await fs.writeFile(file,await v.read(),{flag:'wx'});files.push(file);
                    }
                    await scanPackage(files[0],p+'!/'+cleanMember(parts.members[0].name),depth+1,files.slice(1));
                  });
                }else{charge(m.size);await scanPackage(await m.read(),label,depth+1);}
              } catch(e){rethrow(e);issue(label,detail(e));}
            }else await visit(m,label,tags.has(lower(m.name).replace(/\.[^./]+$/,'')),p+'!/'+clean);
          }
        });
      }else await withTemp(async folder=>{
        let physical=source;
        if(Buffer.isBuffer(physical)){const target=path.join(folder,'native.pack');await fs.writeFile(target,physical);physical=target;}
        const names=new Map<string,number>();
        await visitNative([physical,...otherPaths],folder,signal,async m=>{
          record();if(m.directory)return;
          const clean=cleanMember(m.name);if(!clean){issue(p+'!/'+m.name,'Unsafe archive member path');return;}
          const k=names.get(clean)??0;names.set(clean,k+1);const label=(k?p+' [entry '+(k+1)+']':p)+'!/'+clean;
          if(m.problem){issue(label,m.problem);return;}
          if(archiveKind(clean)){
            if(volume(clean)){issue(label,'Nested multi-volume set inside RAR/7z requires separate unpacking');return;}
            if(m.size>MAX_MEMBER||depth>=MAX_DEPTH){issue(label,'Nested archive depth or size limit reached');return;}
            charge(m.size);await scanPackage(await m.read(),label,depth+1);
          }else await visit(m,label,false,p+'!/'+clean);
        });
      });
    }catch(e){rethrow(e);issue(p,detail(e));}
  }
  async function walk(dir:string,relDir:string) {
    const files=await fs.readdir(dir,{withFileTypes:true});files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    const done=new Set<string>();
    for(const file of files) {
      record();
      const physical=path.join(dir,file.name), label=relDir?relDir+'/'+file.name:file.name;
      if(coveredFiles.has(physical)||coveredPackages.has(physical)||done.has(file.name))continue;
      if(file.isSymbolicLink()){issue(label,'Skipped symbolic link');continue;}
      if(file.isDirectory()){try{await walk(physical,label);}catch(e){rethrow(e);issue(label,detail(e));}continue;}
      if(!file.isFile()){issue(label,'Skipped special filesystem entry');continue;}
      if(archiveKind(file.name)) {
        if(!archives){summary.ignored++;continue;}
        const parts=volume(file.name)||/\.rar$/i.test(file.name)?packageParts(file,files.filter(f=>f.isFile())):{members:[file],complete:true};
        for(const item of parts.members)done.add(item.name);
        if(!parts.complete){issue(label,'Missing or duplicate archive volume');continue;}
        const paths=parts.members.map(v=>path.join(dir,v.name));
        await scanPackage(paths[0],relDir?relDir+'/'+parts.members[0].name:parts.members[0].name,1,paths.slice(1));continue;
      }
      const info=loose?classifyArchivePath(label):null;
      if(!info){if(archives&&unsupportedContainer(file.name))issue(label,'Unsupported archive or legacy map format');else summary.ignored++;continue;}
      try{
        const st=await fs.lstat(physical);if(!st.isFile()){issue(label,'Source changed during scan');continue;}
        await emit({...info,path:label,size:st.size,mtimeMs:st.mtimeMs,diskPath:physical,async read(){
          try{
            const real=await fs.realpath(physical),rel=path.relative(root,real);
            if(rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||real!==physical)throw Error('Source path changed during scan');
            const f=await fs.open(physical,openFlags.O_RDONLY|(openFlags.O_NOFOLLOW??0));
            try{const now=await f.stat();if(!now.isFile()||now.size!==st.size||now.mtimeMs!==st.mtimeMs)throw Error('Source changed during scan');
              charge(st.size);const buf=Buffer.alloc(st.size);
              let offset=0;while(offset<buf.length){const n=(await f.read(buf,offset,buf.length-offset,offset)).bytesRead;if(!n)throw Error('Short read');offset+=n;}
              return buf;
            }finally{await f.close();}
          }catch(e){rethrow(e);throw new SourceReadError(detail(e));}
        }});
      }catch(e){rethrow(e);issue(label,detail(e));}
    }
  }
  try {
    const selectedStat=await fs.stat(root);
    if(selectedStat.isFile()){
      if(!archives || !archiveKind(root))throw Error('Select a directory, ZIP, RAR or 7z archive');
      const dir=path.dirname(root),first={name:path.basename(root)};
      const parts=volume(first.name)||/\.rar$/i.test(first.name)
        ?packageParts(first,(await fs.readdir(dir,{withFileTypes:true})).filter(f=>f.isFile()))
        :{members:[first],complete:true};
      if(!parts.complete){issue(first.name,'Missing or duplicate archive volume');return summary;}
      const files=parts.members.map(v=>path.join(dir,v.name));
      await scanPackage(files[0],parts.members[0].name,1,files.slice(1));
      return summary;
    }
    if(!selectedStat.isDirectory())throw Error('Select a directory or regular archive');
    if(loose&&options.useCollectionIndex!==false){
      const index=await scanIndexedCollection(root,{...options,onEntry:emit,onIssue:i=>issue(i.path,i.reason)});
      if(index){coveredFiles=index.coveredFiles;coveredPackages=index.coveredPackages;summary.indexedPackages=coveredPackages.size;}
    }
    await walk(root,'');
    return summary;
  }catch(e){if(e instanceof ConsumerFailure)throw e.cause;throw e;}
}
