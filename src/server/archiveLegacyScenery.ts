import path from 'node:path';
import { AssetBindings, fold, type CatalogFile, type ImageInfo } from './archiveBindings';
import { cp437 } from './archiveZipReader';
import { hasAuthoredSceneryIdentity, type sceneryReferences } from './archiveSceneryWitness';
import { dosStamp } from './archiveLibraryEvidence';

type Reference = ReturnType<typeof sceneryReferences>[number];
type Proof = {file: CatalogFile; evidence: string; external: boolean};
interface Catalog {
  maps: readonly CatalogFile[];
  bindings: AssetBindings;
  images: ReadonlyMap<string,ImageInfo|null>;
  references(sha:string): readonly Reference[];
}
type Occurrence = {map: CatalogFile; catalog: Catalog};
// Bytes 80..FF of the DOS Latin-2 character set used by Central European archives.
const cp852 = 'ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´­˝˛ˇ˘§÷¸°¨˙űŘř■ ';

function oemSpelling(name:string): string | undefined {
  let result='';
  for (const ch of name) {
    if (ch.charCodeAt(0)<128) result+=ch;
    else {
      const offset=cp852.indexOf(ch);
      if (offset<0) return;
      result+=cp437[offset];
    }
  }
  return result===name ? undefined : result;
}

/** An 8.3 serial depends on directory creation order and cannot establish identity.
 * Require one compatible payload within the entire name family, a directly bundled
 * copy and an independent, dated long-name reference to that very payload. */
export class ArchiveLegacyScenery {
  private readonly catalogs: Catalog[];
  private readonly packages = new Map<string,Occurrence[]>();
  private readonly externalScopes = new Map<string,string|null>();
  private readonly memo = new Map<string,Proof|null>();

  constructor(maps: readonly CatalogFile[], bindings:AssetBindings,
      images:ReadonlyMap<string,ImageInfo|null>, references:(sha:string)=>readonly Reference[], external?:Catalog) {
    this.catalogs=[{maps,bindings,images,references}];
    if(external) this.catalogs.push(external);
    for(const catalog of this.catalogs) for(const map of catalog.maps) {
      const family=this.packages.get(map.sha256);
      if(family) family.push({map,catalog}); else this.packages.set(map.sha256,[{map,catalog}]);
      if(catalog===external) {
        if(!this.externalScopes.has(map.scope)) this.externalScopes.set(map.scope,map.sha256);
        else if(this.externalScopes.get(map.scope)!==map.sha256) this.externalScopes.set(map.scope,null);
      }
    }
  }

  find(target:CatalogFile,ref:Reference): Proof|null {
    if(!ref.used || ref.width<=0 || ref.height<=0 || !ref.name || /[\\/:\0]/.test(ref.name)) return null;
    const short=/^([A-Z0-9_]{1,6})~[1-9][0-9]*\.(PNG|BMP|JPG|GIF|TGA)$/i.exec(ref.name);
    const oem=oemSpelling(ref.name);
    if(!short && !oem) return null;
    const key=JSON.stringify([target.sha256,ref.name,ref.date,ref.width,ref.height]);
    if(this.memo.has(key)) return this.memo.get(key)!;
    const extension=fold(path.extname(ref.name));
    const prefix=short?.[1].toLowerCase();
    const names=new Set<string>(oem ? [fold(oem)] : []);
    if(prefix) {
      for(const catalog of this.catalogs) for(const name of catalog.bindings.sceneryNames()) {
        const stem=path.basename(name,extension);
        if(name.endsWith(extension) && !/~\d+$/.test(stem) && stem.replace(/[ .]/g,'').startsWith(prefix)) names.add(name);
      }
    }
    const answer=this.confirm(target,ref,names,extension,!!short);
    this.memo.set(key,answer);
    return answer;
  }

  private confirm(target:CatalogFile,ref:Reference,names:Set<string>,extension:string,short:boolean): Proof|null {
    let hash:string|undefined;
    // An external release can carry the literal name or another long spelling.
    // Check it for contradictions even when the winning file lives in the first catalog.
    const checks=new Set([...names,ref.name]);
    for(const catalog of this.catalogs) for(const name of checks) for(const candidate of catalog.bindings.sceneryCandidates(name)) {
      const info=catalog.images.get(candidate.sha256);
      if(!info) return null;
      if(info.width!==ref.width || info.height!==ref.height) {
        if(!short) return null;
        continue;
      }
      if(info.ext!==extension || (hash && hash!==candidate.sha256)) return null;
      hash=candidate.sha256;
    }
    if(!hash) return null;
    const direct=(map:CatalogFile,catalog:Catalog,name:string) => {
      const local=catalog.bindings.resolve('scenery',name,map.scope,false,true);
      if(!('file' in local) || local.file.kind!=='scenery' || local.file.scope!==map.scope || fold(local.file.name)!==fold(name)) return;
      const file=catalog.bindings.completed(local.file)??local.file;
      if(file.sha256!==hash) return;
      if(catalog!==this.catalogs[0]) {
        const release=map.path.includes('!/') && this.externalScopes.get(map.scope)===map.sha256;
        const stamped=file.mtimeMs>0 && hasAuthoredSceneryIdentity(ref) &&
          [dosStamp(file.mtimeMs,true),dosStamp(file.mtimeMs,false)].includes(ref.date>>>0);
        if(!release && !stamped) return;
      }
      return file;
    };
    let owner:{map:CatalogFile;file:CatalogFile;external:boolean}|undefined;
    for(const {map,catalog} of this.packages.get(target.sha256)??[]) for(const name of names) {
      const file=direct(map,catalog,name), external=catalog!==this.catalogs[0];
      if(file && (!owner || (!external && owner.external) || (external===owner.external && file.path<owner.file.path))) owner={map,file,external};
    }
    if(!owner) return null;
    let witness:string|undefined;
    if(short) {
      if(!hasAuthoredSceneryIdentity(ref)) return null;
      search: for(const catalog of this.catalogs) for(const other of catalog.maps) {
        if(other.sha256===target.sha256) continue;
        const verified=catalog.references(other.sha256).some(r=>r.used && r.date===ref.date &&
          r.width===ref.width && r.height===ref.height && names.has(fold(r.name)) && direct(other,catalog,r.name));
        if(verified) { witness=other.path; break search; }
      }
      if(!witness) return null;
    }
    const method=short?'DOS 8.3 name family with dated long-name reference in '+witness:'reversible DOS CP852/CP437 filename';
    return {file:owner.file,external:owner.external,evidence:'scenery/'+ref.name+' · '+method+' · '+ref.width+'x'+ref.height+
      ' · original PMS '+target.sha256+' in '+owner.map.path+' · '+owner.file.path+' (SHA-256 '+hash+')'};
  }
}
