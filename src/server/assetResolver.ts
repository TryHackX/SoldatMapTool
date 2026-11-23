import { diskPathKey } from './diskPath';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { AssetStatus, ExtraMapSource, ResolvedAssetInfo } from '../shared/apiTypes';

export interface DirFileEntry {
  diskName: string;
  fullPath: string;
  size: number;
  mtimeMs?: number;
  sourcePriority: number; // 0 = main Soldat dir, 1 = Soldat downloads/, 2+ = extra archive roots
}

export type AssetCategory =
  | 'textures'
  | 'textures/edges'
  | 'textures/objects'
  | 'scenery-gfx'
  | 'objects-gfx'
  | 'interface-gfx'
  | 'weapons-gfx';

export class SoldatAssetResolver {
  private soldatRoot: string;
  private extraSources: ExtraMapSource[];
  private readonlyExact = new Set<string>();      // e.g. "textures/ananas.bmp"
  private readonlyPngBmpStem = new Set<string>(); // e.g. "textures/ananas" (for .bmp <-> .png vanilla parity)

  private dirIndexes = new Map<string, Map<string, DirFileEntry>>();
  private packageIndexes = new Map<string, Map<string, Map<string, DirFileEntry>>>();
  private packageKeys = new Map<string,string>();

  constructor(soldatRoot: string, extraSources: ExtraMapSource[] = []) {
    this.soldatRoot = soldatRoot;
    this.extraSources = extraSources;
    this.reload();
  }

  public getRoot(): string {
    return this.soldatRoot;
  }

  public updateSources(soldatRoot: string, extraSources: ExtraMapSource[]): void {
    this.soldatRoot = soldatRoot;
    this.extraSources = extraSources;
    this.reload();
  }

  public reload(): void {
    this.readonlyExact.clear();
    this.readonlyPngBmpStem.clear();
    this.dirIndexes.clear();
    this.packageIndexes.clear();
    this.packageKeys.clear();

    const roPath = path.join(this.soldatRoot, 'readonly.txt');
    if (fs.existsSync(roPath)) {
      const content = fs.readFileSync(roPath, 'utf-8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/\\/g, '/').toLowerCase();
        if (!line) continue;
        this.readonlyExact.add(line);
        const ext = path.posix.extname(line);
        if (ext === '.bmp' || ext === '.png') {
          const stem = line.slice(0, -ext.length);
          this.readonlyPngBmpStem.add(stem);
        }
      }
    }

    const coreCategories = [
      'maps',
      'textures',
      'textures/edges',
      'textures/objects',
      'scenery-gfx',
      'objects-gfx',
      'interface-gfx',
      'weapons-gfx',
      'mods/classic/textures',
      'mods/classic/textures/objects',
      'mods/classic/weapons-gfx',
    ];

    for (const relDir of coreCategories) {
      this.indexDirectoryIntoCategory(
        relDir,
        path.join(this.soldatRoot, ...relDir.split('/')),
        0
      );
    }

    // Also index Soldat 1.7+ downloads/ subfolders as fallback (priority 1)
    for (const dlSub of ['textures', 'textures/edges', 'scenery-gfx']) {
      this.indexDirectoryIntoCategory(
        dlSub,
        path.join(this.soldatRoot, 'downloads', ...dlSub.split('/')),
        1
      );
    }

    // Index sibling/root textures & scenery-gfx from any extra map archive folders (priority 2+)
    // e.g. if user adds D:\SoldatArchive\maps or D:\SoldatArchive, check both D:\SoldatArchive\scenery-gfx and parent!
    const checkedRoots = new Set<string>([diskPathKey(this.soldatRoot)]);
    let prio = 2;
    for (const extra of this.extraSources) {
      if (!extra.enabled || !extra.path) continue;
      const candidateRoots = [path.resolve(extra.path), path.resolve(extra.path, '..')];
      for (const candRoot of candidateRoots) {
        const normKey = diskPathKey(candRoot);
        if (checkedRoots.has(normKey)) continue;
        const hasTex = fs.existsSync(path.join(candRoot, 'textures'));
        const hasScen = fs.existsSync(path.join(candRoot, 'scenery-gfx'));
        if (hasTex || hasScen) {
          checkedRoots.add(normKey);
          this.indexDirectoryIntoCategory('textures', path.join(candRoot, 'textures'), prio);
          this.indexDirectoryIntoCategory(
            'textures/edges',
            path.join(candRoot, 'textures', 'edges'),
            prio
          );
          this.indexDirectoryIntoCategory('scenery-gfx', path.join(candRoot, 'scenery-gfx'), prio);
          prio++;
        }
      }
    }
  }

  private indexDirectoryIntoCategory(categoryKey: string, absDir: string, priority: number, indexes=this.dirIndexes): void {
    let map = indexes.get(categoryKey);
    if (!map) {
      map = new Map<string, DirFileEntry>();
      indexes.set(categoryKey, map);
    }
    if (!fs.existsSync(absDir)) return;

    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        const prior = map.get(lower);
        if (prior && prior.sourcePriority < priority) continue;

        const fullPath = path.join(absDir, entry.name);
        let size = 0, mtimeMs = 0;
        try {
          const meta=fs.statSync(fullPath);size=meta.size;mtimeMs=meta.mtimeMs;
        } catch {
          size = 0;
        }
        const record={diskName:entry.name,fullPath,size,mtimeMs,sourcePriority:priority};
        if(!map.has(lower))map.set(lower,record);
        map.set('\0'+entry.name,record);
      }
    } catch {
      // Ignore unreadable dir
    }
  }

  public isVanillaMap(mapFileName: string): boolean {
    const norm = `maps/${mapFileName.toLowerCase()}`;
    return this.readonlyExact.has(norm);
  }

  public packageRootForMap(file:string,sourceId:string) {
    if(sourceId==='soldat')return undefined;
    const folder=path.dirname(file);
    return path.basename(folder).toLowerCase()==='maps'?path.dirname(folder):folder;
  }

  private packageDirectories(root:string) {
    const key=diskPathKey(root);
    let index=this.packageIndexes.get(key);
    if(index)return index;
    index=new Map();
    for(const category of ['scenery-gfx','textures','textures/edges']){
      let folder:string|undefined=root;
      for(const component of category.split('/')){
        try {
          const dirs=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.toLowerCase()===component);
          const name=dirs.find(e=>e.name===component)?.name??(dirs.length===1?dirs[0].name:undefined);
          if(!name){folder=undefined;break;}
          folder=path.join(folder,name);
        }catch{folder=undefined;break;}
      }
      if(folder)this.indexDirectoryIntoCategory(category,folder,2,index);
    }
    this.packageIndexes.set(key,index);
    return index;
  }

  /** Short opaque key for decoded/GPU assets and thumbnails; re-scanning changed package images invalidates it. */
  public packageRenderKey(root:string) {
    const key=diskPathKey(root),cached=this.packageKeys.get(key);if(cached)return cached;
    const hash=createHash('sha256').update(key);
    for(const [cat,files] of this.packageDirectories(root)){
      const metadata=[...files].filter(([k])=>k.startsWith('\0')).map(([,f])=>[cat,f.diskName,f.size,f.mtimeMs]);
      metadata.sort((a,b)=>String(a[1])<String(b[1])?-1:String(a[1])>String(b[1])?1:0);
      hash.update(JSON.stringify(metadata));
    }
    const id=hash.digest('hex').slice(0,24);this.packageKeys.set(key,id);return id;
  }

  public isVanillaAsset(category: 'textures' | 'textures/edges' | 'scenery-gfx', filename: string): boolean {
    const clean = filename.trim().replace(/\\/g, '/').toLowerCase();
    const fullRel = `${category}/${clean}`;
    if (this.readonlyExact.has(fullRel)) return true;

    const ext = path.posix.extname(clean);
    if (ext === '.bmp' || ext === '.png') {
      const stem = `${category}/${clean.slice(0, -ext.length)}`;
      if (this.readonlyPngBmpStem.has(stem)) return true;
    }
    return false;
  }

  /**
   * Resolves a texture or scenery filename referenced inside a .pms file.
   * Implements OpenSoldat's FindImagePath (.png override + case-insensitivity)
   * while preserving exact disk filenames & full multi-source paths for MPA packaging.
   */
  public resolveMapAsset(
    category: 'textures' | 'scenery-gfx',
    rawRefName: string,
    usedCount: number,
    packageRoot?: string
  ): ResolvedAssetInfo {
    const referencedName = rawRefName.trim().replace(/\\/g, '/');
    if (!referencedName) {
      const def = category === 'textures' ? this.findBestRenderFile('textures', 'default.bmp',false,packageRoot) : null;
      return {
        category,
        referencedName: '',
        diskName: def?.diskName ?? null,
        diskFullPath: def?.fullPath ?? null,
        isVanilla: true,
        status: 'vanilla',
        usedCount,
        fileSize: 0,
      };
    }

    const lowerRef = referencedName.toLowerCase();
    const ext = path.posix.extname(lowerRef);
    const stemLower = ext ? lowerRef.slice(0, -ext.length) : lowerRef;
    const pngLower = `${stemLower}.png`;
    const local=packageRoot?this.packageDirectories(packageRoot):undefined;
    const localFiles=local?.get(category);
    const useLocal=localFiles?.has(lowerRef)||localFiles?.has(pngLower);
    const dirMap=(useLocal?localFiles:this.dirIndexes.get(category)) ?? new Map<string,DirFileEntry>();

    const exactOrCaseEntry = dirMap.get('\0'+referencedName)??dirMap.get(lowerRef) ?? null;
    const pngEntry = pngLower !== lowerRef ? (dirMap.get('\0'+referencedName.slice(0,referencedName.length-ext.length)+'.png')??dirMap.get(pngLower) ?? null) : null;

    const isVanilla = !useLocal && (exactOrCaseEntry?.sourcePriority ?? 0) < 2 &&
      (pngEntry?.sourcePriority ?? 0) < 2 && this.isVanillaAsset(category, referencedName);

    let edgeDiskName: string | null = null;
    let edgeFullPath: string | null = null;
    let edgeFileSize = 0;
    let edgeIsVanilla = false;
    if (category === 'textures') {
      const localEdges = local?.get('textures/edges');
      const edgeMap = localEdges?.has(lowerRef) || localEdges?.has(pngLower) ? localEdges : this.dirIndexes.get('textures/edges');
      if (edgeMap) {
        const edgeOrig = edgeMap.get('\0'+referencedName) ?? edgeMap.get(lowerRef);
        const edgePng = pngLower === lowerRef ? edgeOrig :
          edgeMap.get('\0'+path.posix.parse(referencedName).name+'.png') ?? edgeMap.get(pngLower);
        const chosenEdge = edgePng ?? edgeOrig;
        edgeDiskName = chosenEdge?.diskName ?? null;
        edgeFullPath = chosenEdge?.fullPath ?? null;
        edgeFileSize = chosenEdge?.size ?? 0;
        edgeIsVanilla = !!chosenEdge && chosenEdge.sourcePriority < 2 && this.isVanillaAsset('textures/edges', chosenEdge.diskName);
      }
    }

    if (!exactOrCaseEntry && !pngEntry) {
      return {
        category,
        referencedName,
        diskName: null,
        diskFullPath: null,
        pngOverrideDiskName: null,
        pngOverrideFullPath: null,
        edgeDiskName,
        edgeFullPath,
        edgeFileSize,
        edgeIsVanilla,
        isVanilla,
        status: isVanilla ? 'vanilla' : 'missing',
        usedCount,
        fileSize: 0,
      };
    }

    let status: AssetStatus = 'custom';
    let primaryEntry: DirFileEntry;
    let pngCompanion: string | null = null;
    let pngCompanionPath: string | null = null;

    if (exactOrCaseEntry) {
      primaryEntry = exactOrCaseEntry;
      if (pngEntry) {
        pngCompanion = pngEntry.diskName;
        pngCompanionPath = pngEntry.fullPath;
      }
      if (isVanilla) {
        status = 'vanilla';
      } else if (exactOrCaseEntry.diskName !== referencedName) {
        status = 'case-mismatch';
      } else {
        status = 'custom';
      }
    } else {
      primaryEntry = pngEntry!;
      status = isVanilla ? 'vanilla' : 'png-override';
    }

    return {
      category,
      referencedName,
      diskName: primaryEntry.diskName,
      diskFullPath: primaryEntry.fullPath,
      pngOverrideDiskName: pngCompanion,
      pngOverrideFullPath: pngCompanionPath,
      pngOverrideFileSize: pngCompanion ? pngEntry?.size : undefined,
      edgeDiskName,
      edgeFullPath,
      edgeFileSize,
      edgeIsVanilla,
      isVanilla,
      status,
      usedCount,
      fileSize: primaryEntry.size,
    };
  }

  /**
   * Finds the exact file path to serve for rendering in the WebGL2 viewer.
   * Supports both HD (.png override preferred) and Classic 1.6 (.bmp preferred)!
   */
  public findBestRenderFile(
    category: AssetCategory,
    rawFilename: string,
    preferClassicBmp = false,
    packageRoot?:string
  ): DirFileEntry | null {
    const clean = rawFilename.trim().replace(/\\/g, '/');
    if (!clean) return null;

    const lower = clean.toLowerCase();
    const ext = path.posix.extname(lower);
    const stem = ext ? lower.slice(0, -ext.length) : lower;
    const pngCandidate = `${stem}.png`;
    const bmpCandidate = `${stem}.bmp`;
    const originalStem=ext?clean.slice(0,-ext.length):clean;
    const candidates=preferClassicBmp?[originalStem+'.bmp',clean,originalStem+'.png']:[originalStem+'.png',clean,originalStem+'.bmp'];
    const ordered=candidates.map(n=>n.toLowerCase()===lower?clean:n);
    const lookup = (files?: Map<string,DirFileEntry>) => {
      if (files) for (const name of ordered) {
        const hit = files.get('\0'+name) ?? files.get(name.toLowerCase());
        if (hit) return hit;
      }
      return null;
    };
    if(packageRoot){
      const hit = lookup(this.packageDirectories(packageRoot).get(category));
      if (hit) return hit;
      if((category==='textures'||category==='textures/edges')&&stem!=='default'){
        // First try the named game/shared image. A folder-specific default is used only when
        // the name is absent everywhere, so it cannot hide an ordinary game asset.
        const global=this.dirIndexes.get(category);
        const found=[lower,pngCandidate,bmpCandidate].some(n=>global?.has(n));
        if(!found)return this.findBestRenderFile(category,'default.bmp',preferClassicBmp,packageRoot);
      }
    }
    const dirMap = this.dirIndexes.get(category);
    if (!dirMap) return null;

    if (preferClassicBmp) {
      // Check mods/classic first if available, then exact .bmp on disk, then fallback to .png
      const classicDir = this.dirIndexes.get(`mods/classic/${category}`);
      const stockClassic = classicDir?.get('\0'+(bmpCandidate === lower ? clean : originalStem+'.bmp'))
        ?? classicDir?.get(bmpCandidate) ?? classicDir?.get('\0'+clean) ?? classicDir?.get(lower);
      if(stockClassic)return stockClassic;
    }
    const hit = lookup(dirMap);
    if (hit) return hit;

    // Fallback for classic textures/objects or weapons-gfx
    if (category === 'textures/objects') {
      const classicObj = this.dirIndexes.get('mods/classic/textures/objects');
      if (classicObj?.has(lower)) return classicObj.get(lower)!;
    }
    if (category === 'weapons-gfx') {
      const classicWep = this.dirIndexes.get('mods/classic/weapons-gfx');
      if (classicWep?.has(lower)) return classicWep.get(lower)!;
    }

    if (category === 'textures' || category === 'textures/edges') {
      return preferClassicBmp
        ? dirMap.get('default.bmp') ?? dirMap.get('default.png') ?? null
        : dirMap.get('default.png') ?? dirMap.get('default.bmp') ?? null;
    }

    return null;
  }

  public getExactDiskEntry(
    category: 'textures' | 'textures/edges' | 'scenery-gfx',
    diskName: string
  ): DirFileEntry | null {
    const dirMap = this.dirIndexes.get(category);
    if (!dirMap) return null;
    return dirMap.get('\0'+diskName) ?? dirMap.get(diskName.toLowerCase()) ?? null;
  }

  public listCategoryEntries(
    category: 'textures' | 'textures/edges' | 'scenery-gfx',
    packageRoot?: string
  ): DirFileEntry[] {
    const entries = new Map<string, DirFileEntry>();
    const directories = [this.dirIndexes.get(category)];
    if (packageRoot) directories.push(this.packageDirectories(packageRoot).get(category));
    for (const files of directories) {
      if (files) for (const file of files.values()) entries.set(file.diskName, file);
    }
    return [...entries.values()];
  }
}
