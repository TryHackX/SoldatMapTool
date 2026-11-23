import { AssetBindings, type CatalogFile, type ImageInfo } from './archiveBindings';

type Kind = 'scenery' | 'texture';
interface PackageDonor {
  sourceMap: CatalogFile;
  asset: CatalogFile;
  edge?: CatalogFile;
  classic: ImageInfo | null;
}

/** Match the complete original PMS, before cleaning. The same raw map sometimes
 * ships with different artwork. Every package carrying local evidence gets a veto.
 * At least one package dedicated to this map must actually supply the resource.
 */
export class ArchivePackageDonors {
  private readonly byMap = new Map<string, Map<string, CatalogFile>>();
  private readonly scopeMap = new Map<string,string|null>();
  private readonly cache = new Map<string, PackageDonor | null>();

  constructor(files: readonly CatalogFile[], private readonly bindings: AssetBindings,
      private readonly images: ReadonlyMap<string,ImageInfo|null>) {
    for (const file of files) {
      const group = this.byMap.get(file.sha256) ?? new Map<string,CatalogFile>();
      if (!group.has(file.scope)) group.set(file.scope,file);
      this.byMap.set(file.sha256,group);
      if (!this.scopeMap.has(file.scope)) this.scopeMap.set(file.scope,file.sha256);
      else if (this.scopeMap.get(file.scope) !== file.sha256) this.scopeMap.set(file.scope,null);
    }
  }

  find(map: CatalogFile, kind: Kind, name: string): PackageDonor | null {
    const bundles = this.byMap.get(map.sha256);
    if (!bundles || bundles.size < 2) return null;
    // A missing file can be supplied. Damaged or conflicting local bytes are
    // positive evidence of a possible variant and cannot be silently replaced.
    const local = this.bindings.resolve(kind,name,map.scope,true,true);
    if (!('error' in local) || local.error !== 'missing') return null;
    const key = JSON.stringify([map.sha256,kind,name]);
    if (this.cache.has(key)) return this.cache.get(key)!;
    let signature: string | undefined, donor: PackageDonor | null = null;
    for (const other of bundles.values()) {
      const found = this.bindings.resolve(kind,name,other.scope,true,true);
      if ('error' in found) {
        if (found.error === 'missing') continue;
        donor = null; break;
      }
      const asset = this.bindings.completed(found.file) ?? found.file;
      if (!this.images.get(asset.sha256)) { donor = null; break; }
      let edge: CatalogFile | undefined;
      if (kind === 'texture') {
        const e = this.bindings.resolve('edge',name,other.scope,true,true);
        if ('file' in e) edge = this.bindings.completed(e.file) ?? e.file;
        if (('error' in e && e.error !== 'missing') || (edge && !this.images.get(edge.sha256))) {
          donor = null; break;
        }
      }
      let classic: ImageInfo | null = null;
      if (kind === 'scenery' && name.toLowerCase().endsWith('.bmp')) {
        const c = this.bindings.resolve(kind,name,other.scope,false,true);
        if ('file' in c) {
          const image = this.images.get((this.bindings.completed(c.file) ?? c.file).sha256);
          if (image?.ext === '.bmp') classic = image;
        }
      }
      const identity = JSON.stringify([asset.sha256,edge?.sha256,classic?.width,classic?.height]);
      if (signature !== undefined && signature !== identity) { donor = null; break; }
      signature = identity;
      if (other.scope === found.file.scope && this.scopeMap.get(other.scope) === map.sha256 &&
          (!donor || other.path < donor.sourceMap.path)) donor = {sourceMap:other,asset,edge,classic};
    }
    this.cache.set(key,donor);
    return donor;
  }
}
