import fs from 'node:fs/promises';
import { constants as fsConstants, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createInterface} from 'node:readline';
import { setTimeout as wait } from 'node:timers/promises';
import { checkSoldatMapLimits, isPropRenderable, parsePmsFull, parsePmsSummary, patchPmsPropsAndScenery, patchPmsSectorLists, patchPmsTexture } from '../shared/pmsParser';
import { compileMapSectors } from '../shared/pmsCompiler';
import { checkArchiveGameplay, clearInvalidWaypointTargets } from './archiveGameplayCheck';
import { completeWaypointTail } from './archiveWaypointTail';
import { normalizeConfirmedDormantRecords } from './archiveDormantRecords';
import { ArchivePackageDonors } from './archivePackageDonors';
import { buildArchiveLibraryEvidence, type ArchiveLibraryEvidence } from './archiveLibraryEvidence';
import { ArchiveLegacyScenery } from './archiveLegacyScenery';
import { findDocumentedArtwork } from './archiveDocumentedArtwork';
import { ArchiveSceneryWitness, sceneryReferences } from './archiveSceneryWitness';
import { pruneUnusedScenery, patchPropFields } from '../shared/sceneryDependencies';
import { scanArchiveInputs, type ArchiveInputEntry, type ArchiveInputIssue } from './archiveInputs';
import { writeArchiveReviewCsv } from './archiveReview';
import { missingArtwork, writeRecoveryReport } from './archiveRecoveryReport';
import {missingArtworkText, type MissingArtwork} from './missingArtwork';
import {scanInstalledMaps} from './archiveInstalledMaps';
import {compareMapEditions,recoverIndexedMapDates,writeMapVersions} from './archiveMapDates';
import type { ArchiveRecoverySummary } from '../shared/archiveCleanerTypes';
import { AssetBindings, PortableNames, fold, inspectArchiveImage, preferSource, recoverableImagePrefix, type AssetFolder, type CatalogFile, type ImageInfo } from './archiveBindings';
export interface ArchiveCleanMap {
    sourceMtimeMs?: number;
    missing?: MissingArtwork[];
    repairs?: string[];
    repairedSectorReferences?: number;
    source: string;
    sha256: string;
    status: 'ready' | 'duplicate' | 'blocked';
    issues: string[];
    output?: string;
    outputSha256?: string;
    polygonCount?: number;
    texture?: string;
    sceneryCount?: number;
    geometrySha256?: string;
    sourceSize?: number;
    repairedProps?: number;
    rewrittenReferences?: number;
    removedScenery?: number;
}
export interface ArchiveCleanAsset {
    folder: AssetFolder;
    name: string;
    sha256: string;
    source: string;
    referenced: boolean;
}
export interface ArchiveCleanPlan {
    version: 1;
    shortMapNames?: boolean;
    mapNamesByDate?: boolean;
    recovery?: ArchiveRecoverySummary;
    artworkRecovery?: ArchiveRecoverySummary;
    portableAssetNames?: boolean;
    sourceRoot: string;
    workDir: string;
    createdAt: string;
    installedRoot?: string;
    summary: {
        files: number;
        mapInputs: number;
        readyMaps: number;
        incompleteMaps?: number;
        duplicateMaps: number;
        blockedMaps: number;
        assetInputs: number;
        uniqueAssetFiles: number;
        duplicateAssetFiles: number;
        nameConflicts: number;
        rewrittenReferences: number;
        repairedProps: number;
        removedUnusedScenery: number;
        scanIssues: number;
    };
    scan: Awaited<ReturnType<typeof scanArchiveInputs>>;
    maps: ArchiveCleanMap[];
    assets: ArchiveCleanAsset[];
    issues: ArchiveInputIssue[];
}
type Progress = {
    phase: string;
    files: number;
    maps: number;
};
interface JobOptions {
    signal?: AbortSignal;
    onProgress?: (p: Progress) => void;
}
export interface ArchiveCleanOptions extends JobOptions {
    shortMapNames?: boolean;
    includeMissing?: boolean;
    includeInstalledMaps?: boolean;
    previousMaps?: readonly ArchiveCleanMap[];
    previousAssets?: readonly ArchiveCleanAsset[];
    previousJobId?: string;
    artworkRoots?: readonly string[];
    portableAssetNames?: boolean;
    includeArchives?: boolean;
    includeLoose?: boolean;
    useCollectionIndex?: boolean;
    soldatRoot?: string;
}
const digest = (bytes: Buffer | Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex');
const folderOf = { scenery: 'scenery-gfx', texture: 'textures', edge: 'textures/edges' } as const;
const isInstalled=(file:CatalogFile)=>file.scope==='@installed' || file.scope==='@installed/downloads';
const unknownMapDate=Date.UTC(1980,0,1); // Earliest ZIP date, earlier than every Soldat release.
export function shortenArchiveMapNames(rows:ArchiveCleanMap[]) {
    const names=[...new Set(rows.flatMap(r=>r.output?[r.output]:[]))].sort();
    const reserved=new Set(names.filter(n=>n.length<=20).map(n=>n.toLowerCase()));
    const renamed=new Map<string,string>();
    for(const name of names) {
        const stem=name.slice(0,-4);
        if(stem.length<=16) continue;
        let candidate=stem.slice(0,16).replace(/_+$/,'')+'.pms';
        const version=/_([\da-f]{8})$/.exec(stem);
        if(version || reserved.has(candidate)) {
            const hint=stem.slice(0,version?.index??stem.length).slice(0,10).replace(/_+$/,'');
            const hash=digest(stem);
            for(let i=0;;i++) {
                const tag=version && i===0 ? version[1].slice(0,5) : i<60 ? hash.slice(i,i+5) : i.toString(36).padStart(5,'0');
                candidate=hint+'_'+tag+'.pms';
                if(!reserved.has(candidate)) break;
            }
        }
        reserved.add(candidate);
        renamed.set(name,candidate);
    }
    for(const row of rows) if(row.output) row.output=renamed.get(row.output)??row.output;
}
export function nameLatestMapVariants(maps:ArchiveCleanMap[]) {
    const preferred=maps.filter(m=>m.outputSha256).sort(compareMapEditions);
    const allocator=new PortableNames(), byContent=new Map<string,string>();
    const families=new Map<string,{winner:ArchiveCleanMap,hashes:Set<string>}>();
    for (const row of preferred) {
        const hash=row.outputSha256!;
        const bare=new PortableNames().allocate(path.posix.basename(row.source),'.pms',hash,28);
        const family=families.get(bare);
        if (family) family.hashes.add(hash);
        else families.set(bare,{winner:row,hashes:new Set([hash])});
    }
    // A newer revision can also ship under an alias. Reserve the original name
    // for its winning content, even when that content already has another name.
    for (const [name,family] of [...families].sort((a,b)=>Number(b[1].hashes.size>1)-Number(a[1].hashes.size>1))) {
        allocator.reserveMap(name);
        const hash=family.winner.outputSha256!;
        if (!byContent.has(hash)) byContent.set(hash,name);
    }
    for (const row of preferred) {
        const hash=row.outputSha256!;
        const name=byContent.get(hash)??allocator.allocate(path.posix.basename(row.source),'.pms',hash,28);
        byContent.set(hash,name);row.output=name;
    }
}
const blob = (dir: string, hash: string) => path.join(dir, 'blobs', hash.slice(0, 2), hash);
const textError = (e: unknown) => e instanceof Error ? e.message : String(e);
const isBelow = (parent: string, child: string) => { const r = path.relative(parent, child); return r === '' || (!path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep)); };
async function existing(file: string) { try {
    await fs.lstat(file);
    return true;
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return false;
    throw e;
} }
interface Header {
    preparedRaw?: string;
    confirmedRepairs?: string[];
    invalidSectorReferences: number;
    invalidWaypointTargets: number[];
    texture: string;
    scenery: ReturnType<typeof sceneryReferences>;
    polygonCount: number;
    geometrySha256: string;
    issues: string[];
}
function inspectMap(bytes: Buffer, m: ReturnType<typeof parsePmsSummary>): Header {
    const issues = m.parseWarnings.slice();
    if (m.version === 0 && bytes.every(value => value === 0))
        issues.push('Entire file contains only zero bytes');
    else if (m.version !== 11)
        issues.push('PMS version ' + m.version + ' (expected 11)');
    if (m.invalidActivePropStyles)
        issues.push('Invalid active prop styles: ' + m.invalidActivePropStyles);
    const over = checkSoldatMapLimits({ ...m, sceneryCount: m.scenery.filter(s => s.usedCount > 0).length });
    for (const v of over)
        issues.push(v.label + ' ' + v.value + ' > ' + v.limit);
    if (m.invalidSectorReferences && m.sectorsDivision <= 0)
        issues.push('Invalid sector references in grid without a positive cell size');
    const gameplay = issues.length ? undefined : checkArchiveGameplay(bytes, m);
    if (gameplay) issues.push(...gameplay.issues);
    return { texture: m.texture, scenery: sceneryReferences(bytes,m),
        invalidSectorReferences: m.invalidSectorReferences ?? 0,
        invalidWaypointTargets: gameplay?.invalidWaypointTargets ?? [],
        polygonCount: m.polygonCount, geometrySha256: digest(bytes.subarray(92, 92 + m.polygonCount * 121)), issues };
}
interface Resource {
    file?: CatalogFile;
    name: string;
    extension: string;
    outputName?: string;
    edge?: CatalogFile;
    image?: ImageInfo;
    edgeImage?: ImageInfo;
    error?: string;
    output?: ArchiveCleanAsset;
    edgeOutput?: ArchiveCleanAsset;
}
interface BoundMap {
    header: Header;
    texture: Resource;
    scenery: (Resource | null)[];
    classic: (ImageInfo | null)[];
    raw: string;
    cooked?: {
        hash: string;
        repaired: number;
        rewritten: number;
        removed: number;
    };
}
async function eachVanilla(root: string, accept: (entry: ArchiveInputEntry) => Promise<void>) {
    const roster = path.join(root, 'readonly.txt');
    if (!await existing(roster))
        return;
    const whitelist = new Set((await fs.readFile(roster, 'utf8')).split(/\r?\n/).map(s => fold(s.trim().replaceAll('\\', '/'))));
    for (const [kind, folder] of Object.entries(folderOf) as [
        keyof typeof folderOf,
        AssetFolder
    ][]) {
        const dir = path.join(root, folder);
        if (!await existing(dir))
            continue;
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
            if (!e.isFile())
                continue;
            const rel = folder + '/' + e.name, key = fold(rel), alternate = key.replace(/\.(bmp|png)$/i, (_m: string, x: string) => x === 'bmp' ? '.png' : '.bmp');
            if (!whitelist.has(key) && !whitelist.has(alternate))
                continue;
            const p = path.join(dir, e.name), s = await fs.stat(p);
            if (s.size > 128 * 1024 * 1024)
                continue;
            await accept({ kind, name: e.name, scope: '@soldat', path: '@soldat/' + rel, size: s.size, mtimeMs: 0, read: () => fs.readFile(p) });
        }
    }
}
/** Analyze from immutable staged content. All occurrences keep their original bundle provenance. */
export async function analyzeCleanArchive(root: string, workDir: string, options: ArchiveCleanOptions = {}): Promise<ArchiveCleanPlan> {
    const issues:ArchiveInputIssue[] = [];
    let library:ArchiveLibraryEvidence|undefined;
    if (options.artworkRoots?.length) {
        options.onProgress?.({phase:'libraries',files:0,maps:0});
        library = await buildArchiveLibraryEvidence(options.artworkRoots,{
            signal:options.signal, onIssue:i=>issues.push(i),
            onProgress:(files,maps)=>options.onProgress?.({phase:'libraries',files,maps}),
        });
    }
    try {
        return await analyzeWithArtwork(root,workDir,options,library,issues);
    } finally {
        await library?.dispose();
    }
}

async function analyzeWithArtwork(root:string, workDir:string, options:ArchiveCleanOptions, library:ArchiveLibraryEvidence|undefined, issues:ArchiveInputIssue[]):Promise<ArchiveCleanPlan> {
    const sourceRoot = await fs.realpath(root);
    const installedRoot=options.includeInstalledMaps && options.soldatRoot ? await fs.realpath(options.soldatRoot) : undefined;
    if (options.includeInstalledMaps && !installedRoot) throw Error('Configure the Soldat installation first.');
    if (installedRoot && (isBelow(sourceRoot,installedRoot) || isBelow(installedRoot,sourceRoot))) throw Error('Select an archive separate from the Soldat installation.');
    workDir = path.resolve(workDir);
    if (isBelow(sourceRoot, workDir))
        throw Error('Working directory must be outside the archive.');
    await fs.mkdir(workDir, { recursive: true });
    if (isBelow(sourceRoot, await fs.realpath(workDir)))
        throw Error('Working directory points into the archive.');
    const audit = await fs.open(path.join(workDir, 'inputs.jsonl'), 'wx');
    const stored = new Set<string>(), parsed = new Map<string, Header | Error>(), images = new Map<string, ImageInfo | null>();
    const physical = new Map<string, string>(), files: CatalogFile[] = [], assetBytes = new Set<string>();
    const index = new AssetBindings(), representatives = new Map<string, CatalogFile>();
    const damaged = new Map<string, CatalogFile>();
    const prefixSize = 4096;
    const byPrefix = new Map<string, CatalogFile[]>();
    const damagedFormat = new Map<string, NonNullable<ReturnType<typeof recoverableImagePrefix>>>();
    const foldedNames = new Map<string, Set<string>>();
    let assetInputs = 0, totalFiles = 0, auditChunk = '';
    const progress = (phase: string, maps: number) => { options.signal?.throwIfAborted(); options.onProgress?.({ phase, files: totalFiles, maps }); };
    async function stage(hash: string, bytes: Uint8Array) {
        if (stored.has(hash))
            return;
        const p = blob(workDir, hash);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, bytes, { flag: 'wx' });
        stored.add(hash);
    }
    async function accept(entry: ArchiveInputEntry) {
        options.signal?.throwIfAborted();
        if (!['map', 'texture', 'scenery', 'edge', 'image'].includes(entry.kind))
            return;
        const cached = entry.materializedPath ? physical.get(entry.materializedPath) : undefined;
        let hash = cached;
        let newValidPrefix: string | undefined;
        if (!hash || (entry.kind === 'map' ? !parsed.has(hash) : !images.has(hash))) {
            const bytes = await entry.read();
            hash = digest(bytes);
            if (entry.verifiedSha256 && entry.verifiedSha256 !== hash)
                throw Error('Changed indexed file: ' + entry.path);
            await stage(hash, bytes);
            if (entry.materializedPath)
                physical.set(entry.materializedPath, hash);
            if (entry.kind === 'map' && !parsed.has(hash)) {
                let prepared: Buffer = bytes;
                let header: Header | undefined;
                try {
                    const inspect = (input: Buffer) => parsePmsSummary(input, { inspectSectorReferences: true });
                    let summary = inspect(bytes);
                    prepared = completeWaypointTail(bytes, summary);
                    const notes: string[] = [];
                    if (prepared !== bytes) {
                        notes.push('Completed ' + (prepared.length - bytes.length) + ' bytes of the final waypoint count or unused connection slots');
                        summary = inspect(prepared);
                    }
                    const dormant = normalizeConfirmedDormantRecords(prepared, summary);
                    if (dormant.bytes !== prepared) {
                        prepared = dormant.bytes;
                        summary = inspect(prepared);
                        notes.push(...dormant.repairs);
                    }
                    header = inspectMap(prepared, summary);
                    if (notes.length) header.confirmedRepairs = notes;
                }
                catch (e) {
                    parsed.set(hash, new Error(textError(e)));
                }
                if (header) {
                    if (prepared !== bytes) {
                        header.preparedRaw = digest(prepared);
                        await stage(header.preparedRaw, prepared);
                    }
                    parsed.set(hash, header);
                }
            }
            else if (entry.kind !== 'map' && !images.has(hash)) {
                const info = await inspectArchiveImage(bytes, entry.name);
                images.set(hash, info);
                if (info && (info.ext === '.png' || info.ext === '.bmp') && bytes.length >= prefixSize)
                    newValidPrefix = digest(bytes.subarray(0, prefixSize));
                if (!info) {
                    const format = recoverableImagePrefix(bytes);
                    if (format) damagedFormat.set(hash, format);
                }
            }
        }
        else if (entry.verifiedSha256 && entry.verifiedSha256 !== hash)
            throw Error('Conflicting indexed digest: ' + entry.path);
        // One materialized path may represent many original archive member names and scopes.
        const file: CatalogFile = { kind: entry.kind as CatalogFile['kind'], name: entry.name, path: entry.path, scope: entry.scope,
            mtimeMs: Number.isFinite(entry.mtimeMs) ? entry.mtimeMs : 0, size: entry.size, sha256: hash };
        totalFiles++;
        if (file.kind === 'map')
            files.push(file);
        else {
            index.add(file,!isInstalled(file));
            if (damagedFormat.has(hash))
                damaged.set(file.kind + '|' + fold(file.name) + '|' + hash, file);
            if (newValidPrefix) {
                const group = byPrefix.get(newValidPrefix) ?? [];
                group.push(file);
                byPrefix.set(newValidPrefix, group);
            }
            if (file.scope !== '@soldat') {
                assetInputs++;
                assetBytes.add(hash);
                const key = file.kind + '|' + fold(file.name), versions = foldedNames.get(key) ?? new Set<string>();
                versions.add(hash);
                foldedNames.set(key, versions);
            }
            if (file.kind !== 'image' && file.scope !== '@soldat') {
                const key = file.kind + '|' + hash, old = representatives.get(key);
                if (!old || preferSource(file, old) < 0)
                    representatives.set(key, file);
            }
        }
        auditChunk += JSON.stringify(file) + '\n';
        if (auditChunk.length >= 256 * 1024) {
            await audit.writeFile(auditChunk);
            auditChunk = '';
        }
        if (totalFiles % 256 === 0)
            progress('scan', files.length);
    }
    let scan: ArchiveCleanPlan['scan'];
    try {
        scan = await scanArchiveInputs(sourceRoot, { includeArchives: options.includeArchives, includeLoose: options.includeLoose,
            useCollectionIndex: options.useCollectionIndex, signal: options.signal, tempDir: workDir, onIssue: i => issues.push(i), onEntry: accept });
        if (installedRoot) await scanInstalledMaps(installedRoot,accept,options.signal);
        if (options.soldatRoot)
            await eachVanilla(options.soldatRoot, accept);
        if (auditChunk)
            await audit.writeFile(auditChunk);
    }
    finally {
        await audit.close();
    }
    progress('resolve', 0);
    // Every surviving byte must match a single fully decoded payload. An index
    // of long prefixes also finds copies stored under unrelated filenames.
    for (const file of damaged.values()) {
        if (file.kind === 'map') continue;
        const format = damagedFormat.get(file.sha256)!;
        const short = await fs.readFile(blob(workDir, file.sha256));
        const contenders = short.length >= prefixSize
            ? byPrefix.get(digest(short.subarray(0, prefixSize))) ?? []
            : index.completeCandidates(file.kind, file);
        const matches: CatalogFile[] = [];
        for (const c of contenders) {
            if (c.size <= short.length || (format.expectedSize && c.size !== format.expectedSize) || images.get(c.sha256)?.ext !== format.ext)
                continue;
            const complete = await fs.readFile(blob(workDir, c.sha256));
            if (short.equals(complete.subarray(0, short.length)))
                matches.push(c);
        }
        if (matches.length === 1)
            index.setCompletion(file, matches[0]);
    }
    // An installation is a shared asset pool. Co-location there does not establish
    // which artwork the author shipped with another copy of the map.
    const packageMaps = installedRoot ? files.filter(file=>!isInstalled(file)) : files;
    const donors = new ArchivePackageDonors(packageMaps,index,images);
    const references = (sha:string)=>{
        const h=parsed.get(sha);
        return h && !(h instanceof Error) && !h.issues.length ? h.scenery : [];
    };
    const witnesses = new ArchiveSceneryWitness(packageMaps,references,index,images);
    const legacy = new ArchiveLegacyScenery(packageMaps,index,images,references,library && {
        maps:library.maps,bindings:library.bindings,images:library.images,references:sha=>library.referencesFor(sha),
    });
    const libraryFiles = new Map<string,CatalogFile>();
    const historicalSources = new Set((options.previousAssets??[]).filter(a=>a.referenced).map(a=>a.source));
    const maps: ArchiveCleanMap[] = [], bound = new Map<string, BoundMap>(), resources = new Map<string, Resource>();
    const pending: {
        map: ArchiveCleanMap;
        job: BoundMap;
        file: CatalogFile;
    }[] = [];
    function register(kind: 'texture' | 'scenery', file: CatalogFile | undefined, name:string, fallbackKey:string, edge?: CatalogFile, edgeIssue='') {
        const key = kind + '|' + (file?.sha256 ?? 'missing:'+fallbackKey) + '|' + (edge?.sha256 ?? '') + edgeIssue, old = resources.get(key);
        if (old) {
            if (file && old.file) {
                const rank = Number(historicalSources.has(old.file.path))-Number(historicalSources.has(file.path));
                if ((rank || preferSource(file, old.file)) < 0) { old.file = file; old.name=file.name; }
            }
            return old;
        }
        const image=file?images.get(file.sha256)??undefined:undefined;
        const ext=path.posix.extname(name).toLowerCase();
        const resource: Resource = { file,name:file?.name??name,extension:image?.ext??(/^\.(png|bmp|jpg|jpeg|gif|tga)$/.test(ext)?ext:'.png'),image,edge,edgeImage:edge?images.get(edge.sha256)!:undefined };
        resources.set(key, resource);
        return resource;
    }
    for (const file of files.sort(preferSource)) {
        if (maps.length % 256 === 0)
            progress('resolve', maps.length);
        const map: ArchiveCleanMap = { source: file.path, sourceMtimeMs:file.mtimeMs>unknownMapDate?file.mtimeMs:0, status: 'blocked', sha256: file.sha256, sourceSize: file.size, issues: [] };
        maps.push(map);
        const h = parsed.get(file.sha256);
        if (!h || h instanceof Error) {
            map.issues.push(h?.message ?? 'Could not read PMS');
            continue;
        }
        Object.assign(map, { polygonCount: h.polygonCount, texture: h.texture, sceneryCount: h.scenery.length, geometrySha256: h.geometrySha256 });
        if (h.issues.length) {
            map.issues = h.issues;
            continue;
        }
        let donorEdge: CatalogFile | undefined;
        const donorClassic = new Map<string,ImageInfo|null>();
        const missing:MissingArtwork[]=[];
        const problem=(category:MissingArtwork['category'],original:string,reason:string)=>{
            map.issues.push(category+'/'+original+' · '+reason);
            missing.push({category,original,expected:original,reason});
        };
        function lookup(kind:'texture'|'scenery'|'edge',name:string,scope:string,modern:boolean,localOnly:boolean) {
            if (isInstalled(file) && scope===file.scope) {
                for (const local of [file.scope,'@installed','@installed/downloads']) {
                    const hit=index.resolve(kind,name,local,modern,true);
                    if ('file' in hit || hit.error!=='missing') return hit;
                }
            }
            return index.resolve(kind,name,scope,modern,localOnly);
        }
        function find(kind: 'texture' | 'edge' | 'scenery', name: string, required: boolean, scope = file.scope, authored?:Header['scenery'][number]) {
            const hit = lookup(kind, name, scope, true, kind === 'edge');
            if ('file' in hit) {
                const recovered = index.completed(hit.file);
                if (recovered) {
                    const format = images.get(recovered.sha256)!.ext.slice(1).toUpperCase();
                    (map.repairs ??= []).push(kind + '/' + name + ' · truncated ' + format + ' ' + hit.file.sha256 + ' matched ' + recovered.sha256 + ' · ' + recovered.path);
                    return recovered;
                }
                if (images.get(hit.file.sha256))
                    return hit.file;
            }
            if (kind !== 'edge') {
                const donor = donors.find(file,kind,name);
                if (donor) {
                    const evidence = kind + '/' + name + ' · matched original PMS SHA-256 ' + file.sha256 +
                        ' in ' + donor.sourceMap.path + ' · asset ' + donor.asset.path + ' (SHA-256 ' + donor.asset.sha256 + ')';
                    if (!map.repairs?.includes(evidence)) (map.repairs ??= []).push(evidence);
                    if (kind === 'texture') donorEdge = donor.edge;
                    else donorClassic.set(name,donor.classic);
                    return donor.asset;
                }
            }
            if (kind === 'scenery' && authored) {
                const witness=witnesses.find(file,authored);
                if (witness) {
                    const evidence='scenery/'+name+' · identical authored reference, DOS stamp '+(authored.date>>>0)+
                        ', intrinsic dimensions '+authored.width+'x'+authored.height+' · witness '+witness.map.path+
                        ' · asset '+witness.file.path+' (SHA-256 '+witness.file.sha256+')';
                    if (!map.repairs?.includes(evidence)) (map.repairs??=[]).push(evidence);
                    donorClassic.set(name,images.get(witness.file.sha256)??null);
                    return witness.file;
                }
            }
            const reason = 'file' in hit ? 'invalid-image' : hit.error;
            if (reason==='missing' && kind!=='edge') {
                const documented = findDocumentedArtwork(file,kind,name,index,images);
                const legacyAlias = kind==='scenery' && authored ? legacy.find(file,authored) : undefined;
                const alias = documented ?? legacyAlias;
                const other = library?.find(file,kind,name,authored);
                if ((other && alias && other.asset.sha256!==alias.file.sha256) ||
                    (other && documented && kind==='texture' && documented.edge?.sha256!==other.edge?.sha256)) {
                    problem(kind,name,'conflicting artwork evidence');
                    return undefined;
                }
                if (alias || other) {
                    const matched=alias?.file??other!.asset;
                    if (legacyAlias?.external) {
                        libraryFiles.set(matched.sha256,matched);
                        images.set(matched.sha256,library!.images.get(matched.sha256)!);
                    }
                    if (other) {
                        for (const found of [other.asset,other.edge]) if (found) {
                            libraryFiles.set(found.sha256,found);
                            images.set(found.sha256,library!.images.get(found.sha256)!);
                        }
                    }
                    if (kind==='texture') donorEdge=documented?.edge??other?.edge;
                    if (kind==='scenery') donorClassic.set(name,other?.classic??null);
                    const proof=alias?.evidence??kind+'/'+name+' · '+other!.reason;
                    if (!map.repairs?.includes(proof)) (map.repairs??=[]).push(proof);
                    return matched;
                }
            }
            if (required || kind === 'edge' && reason !== 'missing')
                problem(kind,name,reason);
            return undefined;
        }
        const rawTexture = h.texture || 'default.bmp', tex = find('texture', rawTexture, true);
        const suppliedEdge = find('edge', rawTexture, false);
        if (suppliedEdge && donorEdge && suppliedEdge.sha256 !== donorEdge.sha256)
            problem('edge',rawTexture,'conflicting package edges');
        let edge = suppliedEdge ?? donorEdge;
        if (tex && !edge) {
            const vanilla = index.resolve('texture', rawTexture, '@soldat', true, true);
            if ('file' in vanilla && vanilla.file.sha256 === tex.sha256)
                edge = find('edge', rawTexture, false, '@soldat');
        }
        const sc = h.scenery.map(s => s.used ? find('scenery',s.name,true,file.scope,s) : undefined);
        if ((!tex || map.issues.length) && !options.includeMissing)
            continue;
        if (missing.length) map.missing=missing;
        const edgeIssue=missing.find(x=>x.category==='edge');
        const texture = register('texture',tex,rawTexture,JSON.stringify([file.sha256,rawTexture]),edgeIssue?undefined:edge,edgeIssue?'|unresolved-edge:'+file.sha256:'');
        const scenery = sc.map((s,i) => h.scenery[i].used ? register('scenery',s,h.scenery[i].name,JSON.stringify([file.sha256,i])) : null);
        const classic = h.scenery.map((s, i) => {
            if (!sc[i] || !s.name.toLowerCase().endsWith('.bmp'))
                return null;
            if (donorClassic.has(s.name)) return donorClassic.get(s.name) ?? null;
            const original = lookup('scenery', s.name, file.scope, false,false);
            if (!('file' in original))
                return null;
            const info = images.get(original.file.sha256);
            return info?.ext === '.bmp' ? info : null;
        });
        const signature = [file.sha256, tex?.sha256??'-', edge?.sha256 ?? '',JSON.stringify(missing), ...sc.map((f, i) => (f?.sha256 ?? '-') + ':' + (classic[i] ? classic[i]!.width + 'x' + classic[i]!.height : ''))].join('|');
        let job = bound.get(signature);
        if (!job) {
            job = { header: h, texture, scenery, classic, raw: h.preparedRaw ?? file.sha256 };
            bound.set(signature, job);
        }
        pending.push({ map, job, file });
    }
    // Only stage verified evidence selected for a complete map. Re-hash library bytes on read.
    if (library) for (const res of resources.values()) {
        for (const f of [res.file,res.edge]) if (f && libraryFiles.has(f.sha256) && !stored.has(f.sha256))
            await stage(f.sha256,await library.read(f));
    }
    const assets: ArchiveCleanAsset[] = [];
    const used = new Set<string>(), allocators = new Map<AssetFolder, PortableNames>();
    const allocator = (folder: AssetFolder) => { let a = allocators.get(folder); if (!a) {
        a = new PortableNames();
        allocators.set(folder, a);
    } return a; };
    for (const [key, res] of [...resources.entries()].sort(([ak,a],[bk,b])=>(a.file && b.file ? preferSource(a.file,b.file) : Number(!a.file)-Number(!b.file)) || ak.localeCompare(bk,'en'))) {
        const kind = key.startsWith('texture|') ? 'texture' : 'scenery', folder = folderOf[kind];
        const name = allocator(folder).allocate(res.name,res.extension,digest(key),kind==='texture'?24:50,options.portableAssetNames);
        res.outputName=name;
        if (res.file) {
            res.output = { name, folder, sha256: res.file.sha256, source: res.file.path, referenced: true };
            assets.push(res.output);
            used.add(kind + '|' + res.file.sha256);
        }
        if (res.edge && res.edgeImage) {
            let edgeHash = res.edge.sha256, edgeExt = res.edgeImage.ext;
            try {
                if (edgeExt !== res.extension && edgeExt !== '.png') {
                    const bytes = await fs.readFile(blob(workDir, edgeHash));
                    if (edgeExt === '.bmp') {
                        if (res.edgeImage.width * res.edgeImage.height > 32 * 1024 * 1024)
                            throw Error('Texture edge exceeds conversion pixel limit: ' + res.edge.path);
                        const { decodeBmpToRgba } = await import('./bmpDecoder');
                        const { rgba, width, height } = decodeBmpToRgba(bytes);
                        const converted = await (await import('sharp')).default(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
                        edgeHash = digest(converted);
                        await stage(edgeHash, converted);
                    }
                    else {
                        const converted = await (await import('sharp')).default(bytes, { limitInputPixels: 32 * 1024 * 1024 }).png().toBuffer();
                        edgeHash = digest(converted);
                        await stage(edgeHash, converted);
                    }
                    edgeExt = '.png';
                }
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code)
                    throw e;
                res.error = 'edge/' + res.edge.name + ' · ' + textError(e);
                continue;
            }
            res.edgeOutput = { name: name.slice(0, -res.extension.length) + edgeExt, folder: 'textures/edges', sha256: edgeHash, source: res.edge.path, referenced: true };
            assets.push(res.edgeOutput);
            used.add('edge|' + res.edge.sha256);
        }
    }
    const outputNames = new PortableNames(), uniqueMaps = new Map<string, string>();
    const previousNames = new Map<string,string>();
    for (const row of options.previousMaps ?? []) {
        if (row.status === 'ready' && row.output && row.outputSha256 && outputNames.reserveMap(row.output))
            previousNames.set(row.outputSha256,row.output);
    }
    for (const [i, { map, job, file }] of pending.entries()) {
        if (i % 64 === 0)
            progress('repair', i);
        if (job.texture.error) {
            map.issues.push(job.texture.error);
            if (!options.includeMissing) continue;
            (map.missing ??= []).push({category:'edge',original:job.texture.edge!.name,
                expected:job.texture.outputName!,reason:'edge-conversion-failed'});
        }
        if (!job.cooked) {
            const original = await fs.readFile(blob(workDir, job.raw));
            const m = parsePmsFull(original), tex = job.texture.outputName!;
            let trimmed;
            try {
                trimmed = pruneUnusedScenery(m);
            }
            catch (e) {
                map.issues.push(textError(e));
                continue;
            }
            const usedResources = job.scenery.filter(r => r !== null);
            const scenery = trimmed.scenery.map((s, idx) => ({ ...s, filename: usedResources[idx].outputName! }));
            let repaired = 0;
            const removed = m.scenery.length - scenery.length;
            const props = m.props.map((p, idx) => {
                const r = job.scenery[p.style - 1];
                let prop = trimmed.props[idx];
                if (r?.image && isPropRenderable(p, m.scenery.length)) {
                    const originalDims = job.classic[p.style - 1], dims = originalDims ?? r.image;
                    const differs = prop.width !== dims.width || prop.height !== dims.height;
                    const storedHD = originalDims && (r.image.width >= dims.width * 1.9 && r.image.height >= dims.height * 1.9) &&
                        Math.abs(prop.width - r.image.width) <= 1 && Math.abs(prop.height - r.image.height) <= 1 && Math.max(Math.abs(prop.scaleX), Math.abs(prop.scaleY)) >= 0.55;
                    if (differs && (prop.width <= 0 || prop.height <= 0 || storedHD)) {
                        prop = patchPropFields(prop, { width: dims.width, height: dims.height });
                        repaired++;
                    }
                }
                return prop;
            });
            const rewritten = Number(m.texture !== tex) + job.header.scenery.reduce((n, s, i) => n + Number(!!job.scenery[i] && s.name !== job.scenery[i]!.outputName), 0);
            let bytes: Uint8Array = clearInvalidWaypointTargets(original, job.header.invalidWaypointTargets);
            if (job.header.invalidSectorReferences) {
                // A deleted polygon can shift otherwise in-range indices in other cells too.
                // Keep the original coordinate grid and rebuild its references from geometry.
                const grid = compileMapSectors(m.polygons, { sectorsNum: m.sectorsNum, fixedDivision: m.sectorsDivision });
                const lists = m.sectorsNum === 0 ? [grid.sectorsPolys[4]] : grid.sectorsPolys;
                bytes = patchPmsSectorLists(bytes, m, lists);
            }
            if (removed || repaired || props.some((p, i) => p !== m.props[i]) || scenery.some((s, i) => s.filename !== m.scenery[i]?.filename))
                bytes = patchPmsPropsAndScenery(bytes, props, scenery);
            if (m.texture !== tex)
                bytes = patchPmsTexture(bytes, tex);
            const checkGameplay = !!job.header.invalidSectorReferences || job.header.invalidWaypointTargets.length > 0;
            const verify = parsePmsSummary(bytes, { inspectSectorReferences: checkGameplay });
            if (verify.invalidSectorReferences || verify.parseWarnings.length || verify.texture !== tex || verify.scenery.length !== scenery.length || verify.scenery.some((s, i) => s.filename !== scenery[i].filename))
                throw Error('PMS reference verification failed: ' + file.path);
            if (checkGameplay) {
                const gameplay = checkArchiveGameplay(bytes, verify);
                if (gameplay.issues.length || gameplay.invalidWaypointTargets.length) throw Error('PMS gameplay verification failed: ' + file.path);
            }
            const hash = bytes === original ? job.raw : digest(bytes);
            if (bytes !== original)
                await stage(hash, bytes);
            job.cooked = { hash, repaired, rewritten, removed };
        }
        const { hash, repaired, rewritten, removed } = job.cooked;
        if (map.missing) {
            const usedNames=job.header.scenery.flatMap((ref,i)=>ref.used && !job.scenery[i]?.file ? [{original:ref.name,expected:job.scenery[i]!.outputName!}]:[]);
            map.missing=map.missing.flatMap(item=>item.category==='scenery'
                ? usedNames.filter(s=>s.original===item.original).map(s=>({...item,expected:s.expected}))
                : [{...item,expected:job.texture.outputName!}]);
        }
        const prev = uniqueMaps.get(hash);
        map.outputSha256 = hash;
        map.output = prev ?? previousNames.get(hash) ?? outputNames.allocate(file.name, '.pms', hash, 28);
        map.status = prev ? 'duplicate' : 'ready';
        map.repairedProps = repaired;
        map.rewrittenReferences = rewritten;
        map.removedScenery = removed;
        if (job.header.confirmedRepairs) (map.repairs ??= []).push(...job.header.confirmedRepairs);
        if (job.header.invalidSectorReferences) {
            map.repairedSectorReferences = job.header.invalidSectorReferences;
            (map.repairs ??= []).push('Collision sector grid rebuilt from original polygons at original cell size · invalid polygon references: ' + job.header.invalidSectorReferences);
        }
        if (job.header.invalidWaypointTargets.length)
            (map.repairs ??= []).push('Invalid waypoint targets cleared in original slots: ' + job.header.invalidWaypointTargets.length);
        if (!prev)
            uniqueMaps.set(hash, map.output);
    }
    // Keep orphaned typed resources away from the playable tree, once per byte identity and namespace.
    for (const [key, file] of [...representatives.entries()].sort((a, b) => preferSource(a[1], b[1]))) {
        if (used.has(key))
            continue;
        const folder = folderOf[file.kind as keyof typeof folderOf];
        const extension = images.get(file.sha256)?.ext ?? '.bin';
        assets.push({ folder, name: allocator(folder).allocate(file.name, extension, file.sha256, folder === 'textures' ? 24 : 50), sha256: file.sha256, source: file.path, referenced: false });
    }
    const ready = maps.filter(m => m.status === 'ready'), duplicateMaps = maps.filter(m => m.status === 'duplicate').length;
    if (installedRoot) {
        await recoverIndexedMapDates(sourceRoot,maps,options.signal);
        nameLatestMapVariants(maps);
    }
    if(options.shortMapNames) shortenArchiveMapNames(maps);
    const plan: ArchiveCleanPlan = { version: 1, shortMapNames:options.shortMapNames, mapNamesByDate:!!installedRoot, portableAssetNames: options.portableAssetNames===true, createdAt: new Date().toISOString(), sourceRoot, installedRoot, workDir, scan, issues, maps, assets,
        summary: { files: totalFiles, mapInputs: maps.length, readyMaps: ready.length, incompleteMaps:ready.filter(m=>m.missing?.length).length, duplicateMaps, blockedMaps: maps.length - ready.length - duplicateMaps,
            assetInputs, uniqueAssetFiles: assetBytes.size, duplicateAssetFiles: assetInputs - assetBytes.size,
            nameConflicts: [...foldedNames.values()].filter(h => h.size > 1).length, scanIssues: issues.length,
            rewrittenReferences: ready.reduce((v, m) => v + (m.rewrittenReferences ?? 0), 0), repairedProps: ready.reduce((v, m) => v + (m.repairedProps ?? 0), 0),
            removedUnusedScenery: ready.reduce((v, m) => v + (m.removedScenery ?? 0), 0) } };
    options.signal?.throwIfAborted();
    if (options.previousJobId && options.previousMaps && !options.includeMissing) {
        plan.recovery = await writeRecoveryReport(path.join(workDir,'recovery.csv'),options.previousJobId,options.previousMaps,maps,options.signal);
        if (options.artworkRoots?.length && options.previousMaps.some(m=>m.status==='blocked' && missingArtwork(m)))
            plan.artworkRecovery = await writeRecoveryReport(path.join(workDir,'artwork.csv'),options.previousJobId,options.previousMaps,maps,options.signal,missingArtwork);
    }
    await writeArchiveReviewCsv(path.join(workDir, 'review.csv'), maps, options.signal);
    await fs.writeFile(path.join(workDir, 'plan.json'), JSON.stringify(plan), { flag: 'wx' });
    return plan;
}
/** Publish only after re-reading all dependencies and patched PMS files from the new tree. */
export async function exportCleanArchive(plan: ArchiveCleanPlan, destination: string, options: JobOptions = {}) {
    // Resume an in-flight combined analysis produced before map dates were persisted.
    if (plan.installedRoot && !plan.mapNamesByDate) {
        const bySource=new Map(plan.maps.map(row=>[row.source,row]));
        const input=createReadStream(path.join(plan.workDir,'inputs.jsonl'),{signal:options.signal});
        try {
            for await (const line of createInterface({input,crlfDelay:Infinity})) {
                const entry=JSON.parse(line) as CatalogFile;
                const row=entry.kind==='map' && bySource.get(entry.path);
                if (row) row.sourceMtimeMs=entry.mtimeMs;
            }
        } finally { input.destroy(); }
        await recoverIndexedMapDates(plan.sourceRoot,plan.maps,options.signal);
        nameLatestMapVariants(plan.maps);
        plan.mapNamesByDate=true;
    }
    options.signal?.throwIfAborted();
    destination = path.resolve(destination);
    const parent = path.dirname(destination);
    const destReal = path.join(await fs.realpath(parent), path.basename(destination));
    if (isBelow(plan.sourceRoot, destReal) || isBelow(plan.workDir, destReal) || (plan.installedRoot && isBelow(plan.installedRoot,destReal)))
        throw Error('Export must be outside the source and working directory.');
    if (await existing(destination))
        throw Error('Destination already exists: ' + destination);
    const stageDir = await fs.mkdtemp(path.join(parent, '.soldat-clean-'));
    const dirs = new Set<string>(), files = new Set<string>();
    const mapDates=new Map<string,number>();
    for (const row of plan.maps) if (row.output && row.sourceMtimeMs)
        mapDates.set(row.output,Math.max(mapDates.get(row.output)??0,row.sourceMtimeMs));
    let outputs = 0, total = 0;
    async function copyChecked(folder: string, name: string, hash: string) {
        options.signal?.throwIfAborted();
        if (!/^[a-z0-9_-]+\.[a-z0-9]+$/.test(name) || !/^[a-f0-9]{64}$/.test(hash) || !['maps', 'review/maps', ...Object.values(folderOf), ...Object.values(folderOf).map(f => 'review/unreferenced/' + f)].includes(folder))
            throw Error('Invalid plan path.');
        const rel = folder + '/' + name;
        if (files.has(rel))
            throw Error('Plan output collision: ' + rel);
        files.add(rel);
        const dir = path.join(stageDir, folder);
        if (!dirs.has(dir)) {
            await fs.mkdir(dir, { recursive: true });
            dirs.add(dir);
        }
        const out = path.join(dir, name);
        await fs.copyFile(blob(plan.workDir, hash), out, fsConstants.COPYFILE_EXCL);
        const verifier = crypto.createHash('sha256');
        for await (const chunk of createReadStream(out, { signal: options.signal }))
            verifier.update(chunk);
        if (verifier.digest('hex') !== hash)
            throw Error('Export checksum mismatch: ' + rel);
        total++;
        if (total % 64 === 0)
            options.onProgress?.({ phase: 'export', files: total, maps: outputs });
        return out;
    }
    try {
        for (const a of plan.assets)
            await copyChecked((a.referenced ? '' : 'review/unreferenced/') + a.folder, a.name, a.sha256);
        const blocked = new Set<string>();
        for (const m of plan.maps) {
            if (m.status === 'blocked') {
                if (!blocked.has(m.sha256)) {
                    await copyChecked('review/maps', m.sha256 + '.pms', m.sha256);
                    blocked.add(m.sha256);
                }
            }
            else if (m.status === 'ready') {
                const out = await copyChecked('maps', m.output!, m.outputSha256!);
                const date=new Date(mapDates.get(m.output!)??unknownMapDate);
                await fs.utimes(out,date,date);
                const bytes = await fs.readFile(out);
                const p = parsePmsSummary(bytes, { inspectSectorReferences: true });
                const missing=new Set((m.missing??[]).map(x=>folderOf[x.category]+'/'+x.expected));
                const refs=['textures/'+p.texture,...p.scenery.map(s=>'scenery-gfx/'+s.filename)];
                if (p.invalidSectorReferences || p.parseWarnings.length || p.version !== 11 || refs.some(ref=>!files.has(ref) && !missing.has(ref)) ||
                    [...missing].some(ref=>files.has(ref) || (!ref.startsWith('textures/edges/') && !refs.includes(ref))))
                    throw Error('Exported PMS dependency mismatch: ' + m.output);
                const gameplay = checkArchiveGameplay(bytes, p);
                if (gameplay.issues.length || gameplay.invalidWaypointTargets.length) throw Error('Exported PMS gameplay mismatch: ' + m.output);
                if (m.missing?.length) {
                    await fs.mkdir(path.join(stageDir,'missing'),{recursive:true});
                    await fs.writeFile(path.join(stageDir,'missing',m.output!.slice(0,-4)+'.txt'),missingArtworkText(m.missing),{flag:'wx'});
                }
                outputs++;
            }
        }
        await fs.mkdir(path.join(stageDir, 'report'), { recursive: true });
        const { workDir, sourceRoot, ...manifest } = plan;
        await fs.writeFile(path.join(stageDir, 'report', 'plan.json'), JSON.stringify(manifest));
        await writeArchiveReviewCsv(path.join(stageDir, 'report', 'review.csv'), plan.maps, options.signal);
        if (plan.mapNamesByDate) await writeMapVersions(path.join(stageDir,'report','wersje-map.csv'),plan.maps);
        if (plan.recovery) await fs.copyFile(path.join(workDir,'recovery.csv'),path.join(stageDir,'report','recovery.csv'));
        if (plan.artworkRecovery) await fs.copyFile(path.join(workDir,'artwork.csv'),path.join(stageDir,'report','artwork.csv'));
        await fs.copyFile(path.join(workDir, 'inputs.jsonl'), path.join(stageDir, 'report', 'inputs.jsonl'));
        await fs.writeFile(path.join(stageDir, 'report', 'source.txt'), path.basename(sourceRoot) + '\n');
        // Windows scanners can briefly hold newly written files open without delete sharing.
        // Keep the verified staging tree intact while retrying the atomic directory rename.
        for (let attempt = 0; ; attempt++) {
            options.signal?.throwIfAborted();
            if (await existing(destination))
                throw Error('Destination already exists: ' + destination);
            try {
                await fs.rename(stageDir, destination);
                break;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                const busy = code === 'EBUSY' || (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES'));
                if (!busy || attempt >= 12) throw error;
                await wait(Math.min(2000, 150 * 2 ** attempt), undefined, { signal: options.signal });
            }
        }
        return { directory: destination, maps: outputs, assets: plan.assets.filter(a => a.referenced).length };
    }
    catch (e) {
        await fs.rm(stageDir, { force: true, recursive: true });
        throw e;
    }
}
