import fs from 'fs';
import path from 'path';
import { AssetStatus, ExtraMapSource, ResolvedAssetInfo } from '../shared/apiTypes';

export interface DirFileEntry {
  diskName: string;
  fullPath: string;
  size: number;
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
    const checkedRoots = new Set<string>([path.resolve(this.soldatRoot).toLowerCase()]);
    let prio = 2;
    for (const extra of this.extraSources) {
      if (!extra.enabled || !extra.path) continue;
      const candidateRoots = [path.resolve(extra.path), path.resolve(extra.path, '..')];
      for (const candRoot of candidateRoots) {
        const normKey = candRoot.toLowerCase();
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

  private indexDirectoryIntoCategory(categoryKey: string, absDir: string, priority: number): void {
    let map = this.dirIndexes.get(categoryKey);
    if (!map) {
      map = new Map<string, DirFileEntry>();
      this.dirIndexes.set(categoryKey, map);
    }
    if (!fs.existsSync(absDir)) return;

    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (map.has(lower)) continue; // Higher-priority root already registered this filename

        const fullPath = path.join(absDir, entry.name);
        let size = 0;
        try {
          size = fs.statSync(fullPath).size;
        } catch {
          size = 0;
        }
        map.set(lower, { diskName: entry.name, fullPath, size, sourcePriority: priority });
      }
    } catch {
      // Ignore unreadable dir
    }
  }

  public isVanillaMap(mapFileName: string): boolean {
    const norm = `maps/${mapFileName.toLowerCase()}`;
    return this.readonlyExact.has(norm);
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
    usedCount: number
  ): ResolvedAssetInfo {
    const referencedName = rawRefName.trim().replace(/\\/g, '/');
    if (!referencedName) {
      const def = category === 'textures' ? this.findBestRenderFile('textures', 'default.bmp') : null;
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

    const dirMap = this.dirIndexes.get(category) ?? new Map<string, DirFileEntry>();
    const lowerRef = referencedName.toLowerCase();
    const ext = path.posix.extname(lowerRef);
    const stemLower = ext ? lowerRef.slice(0, -ext.length) : lowerRef;
    const pngLower = `${stemLower}.png`;

    const exactOrCaseEntry = dirMap.get(lowerRef) ?? null;
    const pngEntry = pngLower !== lowerRef ? (dirMap.get(pngLower) ?? null) : null;

    const isVanilla = this.isVanillaAsset(category, referencedName);

    let edgeDiskName: string | null = null;
    let edgeFullPath: string | null = null;
    if (category === 'textures') {
      const edgeMap = this.dirIndexes.get('textures/edges');
      if (edgeMap) {
        const edgeOrig = edgeMap.get(lowerRef);
        const edgePng = edgeMap.get(pngLower);
        const chosenEdge = edgeOrig ?? edgePng ?? null;
        edgeDiskName = chosenEdge?.diskName ?? null;
        edgeFullPath = chosenEdge?.fullPath ?? null;
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
      edgeDiskName,
      edgeFullPath,
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
    preferClassicBmp = false
  ): DirFileEntry | null {
    const clean = rawFilename.trim().replace(/\\/g, '/');
    if (!clean) return null;

    const dirMap = this.dirIndexes.get(category);
    if (!dirMap) return null;

    const lower = clean.toLowerCase();
    const ext = path.posix.extname(lower);
    const stem = ext ? lower.slice(0, -ext.length) : lower;
    const pngCandidate = `${stem}.png`;
    const bmpCandidate = `${stem}.bmp`;

    if (preferClassicBmp) {
      // Check mods/classic first if available, then exact .bmp on disk, then fallback to .png
      const classicDir = this.dirIndexes.get(`mods/classic/${category}`);
      if (classicDir?.has(bmpCandidate)) return classicDir.get(bmpCandidate)!;
      if (classicDir?.has(lower)) return classicDir.get(lower)!;
      if (dirMap.has(bmpCandidate)) return dirMap.get(bmpCandidate)!;
      if (dirMap.has(lower)) return dirMap.get(lower)!;
      if (dirMap.has(pngCandidate)) return dirMap.get(pngCandidate)!;
    } else {
      // Default OpenSoldat / Steam 1.7 HD order: .png override first, then exact extension
      if (dirMap.has(pngCandidate)) return dirMap.get(pngCandidate)!;
      if (dirMap.has(lower)) return dirMap.get(lower)!;
      if (dirMap.has(bmpCandidate)) return dirMap.get(bmpCandidate)!;
    }

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
    return dirMap.get(diskName.toLowerCase()) ?? null;
  }

  public listCategoryEntries(
    category: 'textures' | 'textures/edges' | 'scenery-gfx'
  ): DirFileEntry[] {
    const dirMap = this.dirIndexes.get(category);
    if (!dirMap) return [];
    return Array.from(dirMap.values());
  }
}
