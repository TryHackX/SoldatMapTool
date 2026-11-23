import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetBindings, fold, inspectArchiveImage, type CatalogFile, type ImageInfo } from './archiveBindings';
import { classifyArchivePath, scanArchiveInputs, type ArchiveInputIssue } from './archiveInputs';
import { parsePmsSummary } from '../shared/pmsParser';
import { sceneryReferences } from './archiveSceneryWitness';
import { diskPathKey } from './diskPath';

type Options = { signal?:AbortSignal; tempDir?:string; onIssue?:(issue:ArchiveInputIssue)=>void; onProgress?:(files:number,maps:number)=>void };
type Reference = ReturnType<typeof sceneryReferences>[number];
type Authored = Pick<Reference,'date'|'width'|'height'>;
type Donor = {asset:CatalogFile; edge?:CatalogFile; classic:ImageInfo|null; reason:string};
const contentHash = (bytes:Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const keyOf = (name:string,r:Authored) => JSON.stringify([fold(name),r.date,r.width,r.height]);
const supportedImage = /\.(?:bmp|gif|jpe?g|png|tga)$/i;
const supportedPack = /\.(?:zip|smap|7z|rar|7z\.001)$/i;
const ordinaryDir = (name:string) => ['maps','map','scenery-gfx','scenery','sceneries','textures','texture','edges'].includes(fold(name));
function inGameFolder(file:CatalogFile,folder:string) {
  const relative=fold(file.path.slice(file.scope.length));
  const expected='/'+folder+'/'+fold(file.name);
  return file.path.startsWith(file.scope) && (relative===expected || relative==='!'+expected);
}
function validAuthorDate(ref:Authored) {
  const bits=ref.date>>>0, month=(bits>>>21)&15, day=(bits>>>16)&31;
  return month>=1 && month<=12 && day>0 && ((bits>>>11)&31)<24 && ((bits>>>5)&63)<60 && (bits&31)<30;
}
export function dosStamp(ms:number,utc:boolean):number {
  const d=new Date(ms), y=utc?d.getUTCFullYear():d.getFullYear(), m=utc?d.getUTCMonth():d.getMonth();
  const day=utc?d.getUTCDate():d.getDate(), h=utc?d.getUTCHours():d.getHours();
  const min=utc?d.getUTCMinutes():d.getMinutes(), s=utc?d.getUTCSeconds():d.getSeconds();
  return y<1980 || y>2107 ? 0 : (((y-1980)<<25)|((m+1)<<21)|(day<<16)|(h<<11)|(min<<5)|(s>>1))>>>0;
}

/** Evidence from other installations never enters the archive's ordinary name resolver. */
export class ArchiveLibraryEvidence {
  readonly maps:CatalogFile[]=[];
  readonly assets:CatalogFile[]=[];
  readonly images=new Map<string,ImageInfo|null>();
  readonly bindings=new AssetBindings();
  private readonly disk=new Map<string,string>();
  private readonly packages=new Set<string>();
  private readonly selectedPacks=new Set<string>();
  private readonly packagedMaps=new Set<CatalogFile>();
  private readonly releases=new Map<string,Map<string,CatalogFile>>();
  private readonly singleMap=new Map<string,string|null>();
  private readonly references=new Map<string,Map<string,CatalogFile>>();
  private readonly parsed=new Map<string,Reference[]>();
  private scratch?:string;

  constructor(private readonly options:Options) {}

  referencesFor(sha:string):readonly Reference[] { return this.parsed.get(sha)??[]; }

  private async keepBytes(sha:string,bytes:Buffer,physical?:string) {
    if (!physical && !this.disk.has(sha)) {
      const base=this.options.tempDir??os.tmpdir();
      if (!this.scratch) {
        await fs.mkdir(base,{recursive:true});
        this.scratch=await fs.mkdtemp(path.join(base,'soldat-library-'));
      }
      physical=path.join(this.scratch,sha);
      await fs.writeFile(physical,bytes,{flag:'wx'});
    }
    if (physical && !this.disk.has(sha)) this.disk.set(sha,physical);
  }

  async record(file:Omit<CatalogFile,'sha256'>,bytes:Buffer,physical?:string,packaged=false) {
    this.options.signal?.throwIfAborted();
    const completed=this.assets.length+this.maps.length;
    if (completed%256===0) this.options.onProgress?.(completed,this.maps.length);
    const sha=contentHash(bytes), row:CatalogFile={...file,sha256:sha};
    await this.keepBytes(sha,bytes,physical);
    if (row.kind!=='map') {
      this.assets.push(row); this.bindings.add(row);
      if (!this.images.has(sha)) this.images.set(sha,await inspectArchiveImage(bytes,row.name));
      return;
    }
    this.maps.push(row);
    if (packaged) this.packagedMaps.add(row);
    if (!this.singleMap.has(row.scope)) this.singleMap.set(row.scope,sha);
    else if (this.singleMap.get(row.scope)!==sha) this.singleMap.set(row.scope,null);
    const releases=this.releases.get(sha)??new Map<string,CatalogFile>();
    releases.set(row.scope,row); this.releases.set(sha,releases);
    let refs=this.parsed.get(sha);
    if (!refs) {
      try {
        const p=parsePmsSummary(bytes,{inspectSectorReferences:true});
        refs=p.version===11 && !p.parseWarnings.length ? sceneryReferences(bytes,p):[];
      } catch { refs=[]; }
      this.parsed.set(sha,refs);
    }
    for (const ref of refs) if (ref.used && ref.width>0 && ref.height>0 && validAuthorDate(ref)) {
      const key=keyOf(ref.name,ref), group=this.references.get(key)??new Map<string,CatalogFile>();
      if (!group.has(row.scope)) group.set(row.scope,row);
      this.references.set(key,group);
    }
  }

  async read(file:CatalogFile):Promise<Buffer> {
    const p=this.disk.get(file.sha256);
    if (!p) throw Error('Unknown library resource: '+file.path);
    const bytes=await fs.readFile(p);
    if (contentHash(bytes)!==file.sha256) throw Error('Library file changed during recovery: '+file.path);
    return bytes;
  }

  async scanPack(p:string,selected=false) {
    if (selected) this.selectedPacks.add(diskPathKey(p));
    if (this.packages.has(diskPathKey(p))) return;
    this.packages.add(diskPathKey(p));
    const directory=path.dirname(p).replaceAll('\\','/')+'/';
    const pending:CatalogFile[]=[];
    const scan=await scanArchiveInputs(p,{signal:this.options.signal,tempDir:this.options.tempDir,useCollectionIndex:false,
      onIssue:i=>this.options.onIssue?.({path:directory+i.path,reason:i.reason}),
      onEntry:async entry=>{
        if (entry.kind!=='map' && entry.kind!=='scenery' && entry.kind!=='texture' && entry.kind!=='edge' && entry.kind!=='image') return;
        if (entry.kind!=='map' && !supportedImage.test(entry.name)) return;
        const bytes=await entry.read(),sha256=contentHash(bytes);
        await this.keepBytes(sha256,bytes);
        pending.push({kind:entry.kind,name:entry.name,scope:directory+entry.scope,path:directory+entry.path,
          size:entry.size,mtimeMs:entry.mtimeMs,sha256});
      }});
    // A late read failure can conceal a conflicting bitmap later in the same pack.
    if (!scan.issues) for (const row of pending) await this.record(row,await this.read(row),undefined,true);
  }

  async dispose() {
    if (this.scratch) await fs.rm(this.scratch,{recursive:true,force:true});
    this.scratch=undefined;
  }

  find(target:CatalogFile,kind:'texture'|'scenery',name:string,authored?:Authored):Donor|undefined {
    const same=this.releases.get(target.sha256);
    const references=kind==='scenery' && authored && validAuthorDate(authored) && authored.width>0 && authored.height>0
      ? this.references.get(keyOf(name,authored)):undefined;
    const scopes=new Map([...(references??[]),...(same??[])]);
    let winner:Donor|undefined, signature:string|undefined;
    for (const map of scopes.values()) {
      const hit=this.bindings.resolve(kind,name,map.scope,true,true);
      if ('error' in hit) { if (hit.error==='missing') continue; return; }
      const image=this.images.get(hit.file.sha256);
      if (!image) return;
      let classic:ImageInfo|null=null, edge:CatalogFile|undefined;
      if (kind==='scenery' && /\.bmp$/i.test(name)) {
        const old=this.bindings.resolve(kind,name,map.scope,false,true);
        if ('file' in old) {
          const original=this.images.get(old.file.sha256);
          if (original?.ext==='.bmp') classic=original;
          else if (!original) return;
        } else if (old.error!=='missing') return;
      }
      const dimensions=classic??image;
      if (authored && authored.width>0 && authored.height>0 &&
          (authored.width!==dimensions.width || authored.height!==dimensions.height)) return;
      if (kind==='texture') {
        const e=this.bindings.resolve('edge',name,map.scope,true,true);
        if ('file' in e) { if (!this.images.get(e.file.sha256)) return; edge=e.file; }
        else if (e.error!=='missing') return;
      }
      const identity=JSON.stringify([hit.file.sha256,edge?.sha256,classic?.width,classic?.height]);
      if (signature && signature!==identity) return;
      signature=identity;
      const exact=map.sha256===target.sha256;
      const intrinsic=!!authored && authored.width===image.width && authored.height===image.height &&
        fold(hit.file.name)===fold(name) && image.ext===path.extname(name).toLowerCase().replace('.jpeg','.jpg');
      const packaged=this.packagedMaps.has(map) && map.scope===hit.file.scope && this.singleMap.get(map.scope)===map.sha256;
      // A complete distribution selected as an individual file may ship several
      // maps sharing the same game directory. Require the original map bytes
      // and the exact dependency in that layout, including its texture edge.
      const packEnd=map.path.indexOf('!/');
      const groupRelease=exact && this.packagedMaps.has(map) && packEnd>0 &&
        this.selectedPacks.has(diskPathKey(map.path.slice(0,packEnd))) &&
        hit.file.kind===kind && fold(hit.file.name)===fold(name) && map.scope===hit.file.scope &&
        inGameFolder(map,'maps') && inGameFolder(hit.file,kind==='texture'?'textures':'scenery-gfx') &&
        (!edge || (edge.scope===map.scope && inGameFolder(edge,'textures/edges')));
      // An installed PMS can survive a later graphics replacement. A common install
      // supplies positive evidence only for a bitmap bearing the author's own DOS
      // stamp and intrinsic dimensions. Dedicated map releases bind their own files.
      const preservedStamp=intrinsic && validAuthorDate(authored!) && hit.file.mtimeMs>0 &&
        [dosStamp(hit.file.mtimeMs,false),dosStamp(hit.file.mtimeMs,true)].includes(authored!.date>>>0);
      if (!packaged && !groupRelease && !preservedStamp) continue;
      if (!exact && (!references?.has(map.scope) || !intrinsic)) continue;
      if (!winner || exact) winner={asset:hit.file,edge,classic,reason:
        (exact?'Identical original library PMS SHA-256 '+map.sha256:'Matching authored scenery name, DOS stamp '+(authored!.date>>>0)+' and intrinsic size '+dimensions.width+'x'+dimensions.height)+
        (packaged?' · packaged with the same release':groupRelease?' · exact dependency in the selected multi-map release':' · image timestamp and size match the author’s PMS entry')+
        ' · '+map.path+' · '+hit.file.path+' · SHA-256 '+hit.file.sha256};
    }
    return winner;
  }
}

export async function buildArchiveLibraryEvidence(roots:readonly string[],options:Options={}):Promise<ArchiveLibraryEvidence> {
  const catalog=new ArchiveLibraryEvidence(options);
  const visited=new Set<string>();
  async function walk(dir:string,scope:string,selected:boolean,kind?:'map'|'scenery'|'texture'|'edge') {
    options.signal?.throwIfAborted();
    const key=diskPathKey(dir);
    if (visited.has(key)) return;
    visited.add(key);
    const entries=(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    const layout=entries.some(e=>e.isDirectory() && ordinaryDir(e.name));
    for (const e of entries) {
      options.signal?.throwIfAborted();
      const file=path.join(dir,e.name), name=fold(e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (kind==='texture' && name==='edges') await walk(file,scope,false,'edge');
        else if (!kind && ordinaryDir(name)) {
          const k=name==='maps'||name==='map'?'map':name==='textures'||name==='texture'?'texture':name==='edges'?'edge':'scenery';
          await walk(file,scope,false,k);
        } else if (!kind && (name==='downloads' || (!layout && selected))) await walk(file,file.replaceAll('\\','/'),true);
        continue;
      }
      if (!e.isFile()) continue;
      if (supportedPack.test(name) && !/\.part0*(?:[2-9]|\d{2,})\.rar$/i.test(name)) { await catalog.scanPack(file); continue; }
      const k=kind??(selected && name.endsWith('.pms')?'map':undefined);
      if (!k || (k==='map'?!name.endsWith('.pms'):!supportedImage.test(name))) continue;
      const stat=await fs.stat(file);
      if (stat.size>(k==='map'?32:128)*1024**2) { options.onIssue?.({path:file,reason:'File exceeds per-member scan limit'}); continue; }
      await catalog.record({kind:k,name:e.name,path:file.replaceAll('\\','/'),scope,size:stat.size,mtimeMs:stat.mtimeMs},await fs.readFile(file),file);
    }
  }
  try {
    for (const root of roots) {
      options.signal?.throwIfAborted();
      const p=await fs.realpath(root), stat=await fs.stat(p);
      if (stat.isFile()) { if (supportedPack.test(p)) await catalog.scanPack(p,true); continue; }
      if (!stat.isDirectory()) continue;
      const base=path.basename(p);
      if (ordinaryDir(base)) {
        const sample=classifyArchivePath(base+'/sample.'+(/^maps?$/i.test(base)?'pms':'bmp'));
        if (sample && ['map','scenery','texture','edge'].includes(sample.kind)) {
          const parent=path.dirname(p);
          if (sample.kind==='map') await walk(parent,parent.replaceAll('\\','/'),true);
          else await walk(p,parent.replaceAll('\\','/'),false,sample.kind as 'scenery'|'texture'|'edge');
        }
      } else await walk(p,p.replaceAll('\\','/'),true);
    }
    return catalog;
  } catch (error) { await catalog.dispose(); throw error; }
}
