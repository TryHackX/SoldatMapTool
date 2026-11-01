import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import {
  MapIndexEntry,
  PackBuildOptions,
  PackMissingWarning,
  PackPreviewFile,
  PackPreviewResponse,
} from '../shared/apiTypes';
import { soldatCrc32 } from '../shared/pmsParser';
import { APP_VERSION } from '../shared/version';
import { t, tp } from './i18n';
import { SoldatMapScanner } from './soldatScanner';

interface InternalPackPlan {
  selectedMaps: MapIndexEntry[];
  allFiles: PackPreviewFile[];
  totalUncompressedBytes: number;
  allMissingWarnings: PackMissingWarning[];
  collisionWarnings: string[];
  skippedVanillaCount: number;
  skippedUnusedSceneryCount: number;
  caseFixedCount: number;
}

/**
 * Name of the generated map list inside a pack. Deliberately NOT "mapslist.txt": extracting the pack into
 * a server root would otherwise silently replace the server's own map rotation.
 */
export function packMapsListName(packName: string): string {
  const stem = packName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'pack';
  return `mapslist_${stem}.txt`;
}

/** Name of the CRC32 manifest (map name, OpenSoldat CRC32, size) generated into a pack */
export function packCrcManifestName(packName: string): string {
  return packMapsListName(packName).replace(/^mapslist_/, 'maps_crc32_');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'Soldat_Map_Pack';
}

function collectPackPlan(
  options: PackBuildOptions,
  selectedMaps: MapIndexEntry[],
  scanner: SoldatMapScanner
): InternalPackPlan {
  const resolver = scanner.getResolver();
  const filesMap = new Map<string, PackPreviewFile>(); // key = lowerCase(archivePath)
  const allMissingWarnings: PackMissingWarning[] = [];
  const collisionWarnings: string[] = [];

  let skippedVanillaCount = 0;
  let skippedUnusedSceneryCount = 0;
  let caseFixedCount = 0;

  const addPackFile = (
    archivePath: string,
    diskPath: string,
    category: PackPreviewFile['category'],
    sizeBytes: number,
    mapBaseName: string,
    caseRenamedFrom?: string
  ) => {
    const key = archivePath.toLowerCase();
    const existing = filesMap.get(key);
    if (existing) {
      const sameDiskFile =
        existing.diskPath === diskPath ||
        path.resolve(existing.diskPath).toLowerCase() === path.resolve(diskPath).toLowerCase();
      // Linux fix: maps spell the same file differently (e.g. "fx_P_cloud5.png" / "fx_p_cloud5.png"), so the file
      // is packed once per spelling — a case-sensitive server finds each one
      if (options.fixLinuxCase && sameDiskFile && existing.archivePath !== archivePath) {
        const aliasKey = `alias:${archivePath}`;
        const alias = filesMap.get(aliasKey);
        if (alias) {
          alias.usedByMapsCount++;
          if (alias.sampleMaps.length < 6 && !alias.sampleMaps.includes(mapBaseName)) alias.sampleMaps.push(mapBaseName);
          return;
        }
        caseFixedCount++;
        filesMap.set(aliasKey, {
          archivePath,
          diskPath,
          category,
          sizeBytes,
          usedByMapsCount: 1,
          sampleMaps: [mapBaseName],
          caseRenamedFrom,
          caseAliasOf: existing.archivePath,
        });
        return;
      }
      // Same archive path but a different file on disk (two sources, or case-only differences):
      // only one can be packed, so report it instead of silently dropping the other
      if (!sameDiskFile && collisionWarnings.length < 500) {
        collisionWarnings.push(
          t('{file}: packed {packed}, skipped {skipped} ({map})', {
            file: archivePath,
            packed: existing.diskPath,
            skipped: diskPath,
            map: mapBaseName,
          })
        );
      }
      existing.usedByMapsCount++;
      if (existing.sampleMaps.length < 6 && !existing.sampleMaps.includes(mapBaseName)) {
        existing.sampleMaps.push(mapBaseName);
      }
      return;
    }
    if (caseRenamedFrom) {
      caseFixedCount++;
    }
    filesMap.set(key, {
      archivePath,
      diskPath,
      category,
      sizeBytes,
      usedByMapsCount: 1,
      sampleMaps: [mapBaseName],
      caseRenamedFrom,
    });
  };

  for (const map of selectedMaps) {
    const mapDiskPath = map.fullPath || scanner.getMapFilePath(map.id);
    if (mapDiskPath && fs.existsSync(mapDiskPath)) {
      addPackFile(`maps/${map.fileName}`, mapDiskPath, 'map', map.fileSize, map.baseName);
    }

    // 1. Main Texture
    const tex = map.textureInfo;
    if (tex.referencedName) {
      if (tex.status === 'missing') {
        allMissingWarnings.push({
          mapName: map.baseName,
          category: 'textures',
          referencedName: tex.referencedName,
        });
      } else if (tex.isVanilla && options.excludeVanillaAssets) {
        skippedVanillaCount++;
      } else if (tex.diskName) {
        const fullTexPath =
          tex.diskFullPath ?? resolver.getExactDiskEntry('textures', tex.diskName)?.fullPath ?? null;
        if (fullTexPath) {
          let targetName = tex.diskName;
          let renamedFrom: string | undefined;

          if (options.fixLinuxCase) {
            if (tex.status === 'case-mismatch') {
              targetName = tex.referencedName;
              renamedFrom = tex.diskName;
            } else if (tex.status === 'png-override') {
              const refExt = path.posix.extname(tex.referencedName);
              const refStem = refExt
                ? tex.referencedName.slice(0, -refExt.length)
                : tex.referencedName;
              const desired = `${refStem}.png`;
              if (desired !== tex.diskName) {
                targetName = desired;
                renamedFrom = tex.diskName;
              }
            }
          }

          addPackFile(
            `textures/${targetName}`,
            fullTexPath,
            'texture',
            tex.fileSize,
            map.baseName,
            renamedFrom
          );
        }

        // Optional PNG override companion when .bmp is primary
        if (options.includePngOverrides && tex.pngOverrideDiskName) {
          const pngEntry = resolver.getExactDiskEntry('textures', tex.pngOverrideDiskName);
          const pngFullPath = tex.pngOverrideFullPath ?? pngEntry?.fullPath ?? null;
          if (pngFullPath) {
            addPackFile(
              `textures/${tex.pngOverrideDiskName}`,
              pngFullPath,
              'texture',
              pngEntry?.size ?? 0,
              map.baseName
            );
          }
        }

        // Optional HD Edge texture
        if (options.includeEdgeTextures && tex.edgeDiskName) {
          const isVanillaEdge = resolver.isVanillaAsset('textures/edges', tex.edgeDiskName);
          if (!isVanillaEdge || !options.excludeVanillaAssets) {
            const edgeEntry = resolver.getExactDiskEntry('textures/edges', tex.edgeDiskName);
            const edgeFullPath = tex.edgeFullPath ?? edgeEntry?.fullPath ?? null;
            if (edgeFullPath) {
              addPackFile(
                `textures/edges/${tex.edgeDiskName}`,
                edgeFullPath,
                'edge',
                edgeEntry?.size ?? 0,
                map.baseName
              );
            }
          }
        }
      }
    }

    // 2. Scenery files
    const seenMapScenery = new Set<string>();
    for (const sc of map.sceneryAssets) {
      if (!sc.referencedName) continue;
      if (sc.usedCount === 0 && options.excludeUnusedScenery) {
        skippedUnusedSceneryCount++;
        continue;
      }

      const scKey = sc.referencedName.toLowerCase();
      if (seenMapScenery.has(scKey)) continue;
      seenMapScenery.add(scKey);

      if (sc.status === 'missing') {
        allMissingWarnings.push({
          mapName: map.baseName,
          category: 'scenery-gfx',
          referencedName: sc.referencedName,
        });
        continue;
      }

      if (sc.isVanilla && options.excludeVanillaAssets) {
        skippedVanillaCount++;
        continue;
      }

      if (sc.diskName) {
        const fullScPath =
          sc.diskFullPath ??
          resolver.getExactDiskEntry('scenery-gfx', sc.diskName)?.fullPath ??
          null;
        if (fullScPath) {
          let targetName = sc.diskName;
          let renamedFrom: string | undefined;

          if (options.fixLinuxCase) {
            if (sc.status === 'case-mismatch') {
              targetName = sc.referencedName;
              renamedFrom = sc.diskName;
            } else if (sc.status === 'png-override') {
              const refExt = path.posix.extname(sc.referencedName);
              const refStem = refExt
                ? sc.referencedName.slice(0, -refExt.length)
                : sc.referencedName;
              const desired = `${refStem}.png`;
              if (desired !== sc.diskName) {
                targetName = desired;
                renamedFrom = sc.diskName;
              }
            }
          }

          addPackFile(
            `scenery-gfx/${targetName}`,
            fullScPath,
            'scenery',
            sc.fileSize,
            map.baseName,
            renamedFrom
          );
        }

        if (options.includePngOverrides && sc.pngOverrideDiskName) {
          const pngEntry = resolver.getExactDiskEntry('scenery-gfx', sc.pngOverrideDiskName);
          const pngFullPath = sc.pngOverrideFullPath ?? pngEntry?.fullPath ?? null;
          if (pngFullPath) {
            addPackFile(
              `scenery-gfx/${sc.pngOverrideDiskName}`,
              pngFullPath,
              'scenery',
              pngEntry?.size ?? 0,
              map.baseName
            );
          }
        }
      }
    }
  }

  if (options.generateMapsListTxt && selectedMaps.length > 0) {
    const content = generateMapsListContent(selectedMaps);
    const listName = packMapsListName(options.packName || 'Soldat_Map_Pack');
    filesMap.set(listName.toLowerCase(), {
      archivePath: listName,
      diskPath: '<generated>',
      category: 'generated',
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      usedByMapsCount: selectedMaps.length,
      sampleMaps: selectedMaps.slice(0, 6).map((m) => m.baseName),
    });
  }

  if (options.generateCrcManifest && selectedMaps.length > 0) {
    const listName = packCrcManifestName(options.packName || 'Soldat_Map_Pack');
    const estimate = generateCrcManifestContent(
      options.packName || 'Soldat_Map_Pack',
      crcManifestEntries(Array.from(filesMap.values()), selectedMaps, false)
    );
    filesMap.set(listName.toLowerCase(), {
      archivePath: listName,
      diskPath: '<generated>',
      category: 'generated',
      sizeBytes: Buffer.byteLength(estimate, 'utf-8'),
      usedByMapsCount: selectedMaps.length,
      sampleMaps: selectedMaps.slice(0, 6).map((m) => m.baseName),
    });
  }

  if (options.generateReadmeManifest && selectedMaps.length > 0) {
    const content = generateManifestContent(
      options.packName || 'Soldat_Map_Pack',
      selectedMaps,
      allMissingWarnings
    );
    filesMap.set('readme_pack.txt', {
      archivePath: 'README_PACK.txt',
      diskPath: '<generated>',
      category: 'generated',
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      usedByMapsCount: selectedMaps.length,
      sampleMaps: selectedMaps.slice(0, 6).map((m) => m.baseName),
    });
  }

  const allFiles = Array.from(filesMap.values()).sort((a, b) =>
    a.archivePath.localeCompare(b.archivePath, undefined, { numeric: true, sensitivity: 'base' })
  );

  const totalUncompressedBytes = allFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  return {
    selectedMaps,
    allFiles,
    totalUncompressedBytes,
    allMissingWarnings,
    collisionWarnings,
    skippedVanillaCount,
    skippedUnusedSceneryCount,
    caseFixedCount,
  };
}

function groupMapsForSplit(
  selectedMaps: MapIndexEntry[],
  splitBy: 'none' | 'prefix' | 'mode',
  basePackName: string
): Array<{ groupKey: string; packFileName: string; maps: MapIndexEntry[] }> {
  if (!splitBy || splitBy === 'none') {
    return [{ groupKey: 'all', packFileName: basePackName, maps: selectedMaps }];
  }

  const groups = new Map<string, { label: string; maps: MapIndexEntry[] }>();
  for (const m of selectedMaps) {
    const key = splitBy === 'mode' ? m.modeGroupId : m.prefix;
    const rawLabel =
      splitBy === 'mode'
        ? m.modeGroupName.replace(/\([^)]*\)/g, '').trim()
        : m.prefix === '__none__'
        ? 'DM_NoPrefix'
        : m.prefix.replace(/_+$/, '');

    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { label: sanitizeFileName(rawLabel).replace(/\s+/g, '_'), maps: [] };
      groups.set(key, bucket);
    }
    bucket.maps.push(m);
  }

  // Labels can collide after sanitizing ("Capture the Flag (CTF)" / "Capture the Flag (Liga)"): keep names unique
  const usedNames = new Set<string>();
  return Array.from(groups.entries())
    .map(([groupKey, b]) => {
      let packFileName = `${basePackName}_${b.label}`;
      for (let n = 2; usedNames.has(packFileName.toLowerCase()); n++) {
        packFileName = `${basePackName}_${b.label}_${n}`;
      }
      usedNames.add(packFileName.toLowerCase());
      return { groupKey, packFileName, maps: b.maps };
    })
    .sort((a, b) => b.maps.length - a.maps.length);
}

const MAX_PREVIEW_FILES = 2500;
const MAX_PREVIEW_WARNINGS = 500;

export function buildPackPreview(
  options: PackBuildOptions,
  scanner: SoldatMapScanner
): PackPreviewResponse {
  const selectedMaps: MapIndexEntry[] = [];
  for (const id of options.mapIds) {
    const entry = scanner.getMapEntry(id);
    if (entry) selectedMaps.push(entry);
  }

  const plan = collectPackPlan(options, selectedMaps, scanner);
  const safeBaseName = sanitizeFileName(options.packName || 'Soldat_Map_Pack');
  const splitBy = options.splitBy || 'none';

  const splitGroupsPreview =
    splitBy !== 'none'
      ? groupMapsForSplit(selectedMaps, splitBy, safeBaseName).map((g) => ({
          groupKey: g.groupKey,
          packFileName: `${g.packFileName}.zip`,
          mapCount: g.maps.length,
        }))
      : undefined;

  return {
    mapCount: selectedMaps.length,
    totalFilesCount: plan.allFiles.length,
    files: plan.allFiles.slice(0, MAX_PREVIEW_FILES),
    filesTruncated: plan.allFiles.length > MAX_PREVIEW_FILES,
    splitGroupsPreview,
    totalUncompressedBytes: plan.totalUncompressedBytes,
    missingWarningsCount: plan.allMissingWarnings.length,
    missingWarnings: plan.allMissingWarnings.slice(0, MAX_PREVIEW_WARNINGS),
    collisionWarnings: plan.collisionWarnings.slice(0, MAX_PREVIEW_WARNINGS),
    skippedVanillaCount: plan.skippedVanillaCount,
    skippedUnusedSceneryCount: plan.skippedUnusedSceneryCount,
    caseFixedCount: plan.caseFixedCount,
  };
}

export interface CrcManifestEntry {
  name: string;
  archivePath: string;
  crc32: number;
  size: number;
}

/**
 * One line per map file that is really in the pack (with name collisions only one file is packed).
 * `fromDisk` computes CRC and size from the bytes being packed instead of the last scan.
 */
export function crcManifestEntries(
  files: PackPreviewFile[],
  maps: MapIndexEntry[],
  fromDisk: boolean
): CrcManifestEntry[] {
  const byPath = new Map(maps.map((m) => [path.resolve(m.fullPath).toLowerCase(), m]));
  const entries: CrcManifestEntry[] = [];
  for (const f of files) {
    if (f.category !== 'map') continue;
    const map = byPath.get(path.resolve(f.diskPath).toLowerCase());
    let crc32 = map?.crc32 ?? 0;
    let size = f.sizeBytes;
    if (fromDisk) {
      try {
        const bytes = fs.readFileSync(f.diskPath);
        crc32 = soldatCrc32(bytes);
        size = bytes.length;
      } catch {
        // The archiver reports a missing file separately; keep the indexed values here
      }
    }
    entries.push({
      name: map?.baseName ?? path.basename(f.archivePath, path.extname(f.archivePath)),
      archivePath: f.archivePath,
      crc32,
      size,
    });
  }
  return entries;
}

/**
 * Map list with the OpenSoldat CRC32 of every packed .pms (the checksum client and server compare to decide
 * whether a map has to be downloaded), so a server admin can verify the pack contents.
 */
export function generateCrcManifestContent(packName: string, entries: CrcManifestEntry[]): string {
  const lines = [
    `# ${t('Soldat Map Studio v{version} — map checksums for pack "{pack}"', { version: APP_VERSION, pack: packName })}`,
    `# ${t('Generated: {date} UTC', { date: new Date().toISOString().replace('T', ' ').slice(0, 19) })}`,
    `# ${t('CRC32 in OpenSoldat format (the same checksum the game uses to compare map versions)')}`,
    `# ${t('map;crc32;size_bytes;file')}`,
  ];
  for (const e of entries) {
    const crc = (e.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0');
    lines.push(`${e.name};${crc};${e.size};${e.archivePath}`);
  }
  lines.push('');
  return lines.join('\r\n');
}

/** Content of a generated pack file, chosen by its archive name */
function generatedFileContent(
  archivePath: string,
  packName: string,
  maps: MapIndexEntry[],
  warnings: PackMissingWarning[],
  files: PackPreviewFile[]
): string {
  const lower = archivePath.toLowerCase();
  if (lower.startsWith('mapslist')) return generateMapsListContent(maps);
  if (lower.startsWith('maps_crc32')) return generateCrcManifestContent(packName, crcManifestEntries(files, maps, true));
  return generateManifestContent(packName, maps, warnings);
}

function generateMapsListContent(maps: MapIndexEntry[]): string {
  return maps.map((m) => m.baseName).join('\r\n') + '\r\n';
}

function generateManifestContent(
  packName: string,
  maps: MapIndexEntry[],
  warnings: PackMissingWarning[]
): string {
  const lines: string[] = [];
  lines.push('================================================================');
  lines.push(` SOLDAT MAP PACK: ${packName}`);
  lines.push(` ${t('Generated by: Soldat Map Studio v{version} (MPA Pro)', { version: APP_VERSION })}`);
  lines.push(` ${t('Date: {date}', { date: new Date().toISOString().replace('T', ' ').slice(0, 19) })}`);
  lines.push(` ${t('Number of maps: {count}', { count: maps.length })}`);
  lines.push('================================================================');
  lines.push('');
  lines.push(t('MAP LIST:'));
  for (const m of maps) {
    const dims = `${Math.round(m.polyBounds.width)}x${Math.round(m.polyBounds.height)}`;
    lines.push(
      ` - ${t('{name} | Mode: {mode} | Poly: {poly} | Scen: {scen} | Size: {size}', {
        name: m.baseName.padEnd(28),
        mode: m.modeGroupName.slice(0, 18).padEnd(18),
        poly: String(m.polygonCount).padStart(4),
        scen: String(m.activePropCount).padStart(3),
        size: dims,
      })}`
    );
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push(t('MISSING FILE WARNINGS ({count}):', { count: warnings.length }));
    for (const w of warnings) {
      lines.push(` [!] ${t('{map}: missing {file}', { map: w.mapName, file: `${w.category}/${w.referencedName}` })}`);
    }
  }
  lines.push('');
  lines.push(t('INSTALLATION:'));
  lines.push(
    ` ${t('Extract the archive contents directly into the main folder of the Soldat / OpenSoldat game or server.')}`
  );
  lines.push(
    ` ${t("The pack's map list is in {file} — copy its contents into the server's mapslist.txt", {
      file: packMapsListName(packName),
    })}`
  );
  lines.push(` ${t("if you want to add these maps to the rotation (the server's mapslist.txt is not overwritten).")}`);
  lines.push('');
  return lines.join('\r\n');
}

export interface BuiltPackResult {
  outputPath: string;
  fileName: string;
  sizeBytes: number;
  fileCount: number;
  format: 'zip' | 'smap' | 'folder';
  splitArchiveCount?: number;
  warnings: string[]; // files that could not be packed (disappeared / locked) and name collisions
}

export async function executePackBuild(
  options: PackBuildOptions,
  scanner: SoldatMapScanner,
  defaultOutputRoot: string
): Promise<BuiltPackResult> {
  const safeName = sanitizeFileName(options.packName || 'Soldat_Map_Pack').replace(/\.zip$/i, '');
  const outRoot = options.customOutputFolder?.trim()
    ? path.resolve(options.customOutputFolder.trim())
    : defaultOutputRoot;

  fs.mkdirSync(outRoot, { recursive: true });

  const selectedMaps = options.mapIds
    .map((id) => scanner.getMapEntry(id))
    .filter((m): m is MapIndexEntry => Boolean(m));

  if (selectedMaps.length === 0) {
    throw new Error(t('No maps selected for packing.'));
  }

  const splitBy = options.splitBy || 'none';

  // Split-by-prefix or Split-by-mode into separate .zip packs!
  if (options.outputFormat === 'zip' && splitBy !== 'none') {
    const groups = groupMapsForSplit(selectedMaps, splitBy, safeName);
    const bundleDirName = `${safeName}_${splitBy === 'mode' ? t('by_mode') : t('by_prefix')}`;
    const bundleDir = path.join(outRoot, bundleDirName);
    fs.mkdirSync(bundleDir, { recursive: true });

    let totalBytes = 0;
    const warnings: string[] = [];
    for (const grp of groups) {
      const grpPlan = collectPackPlan(
        { ...options, packName: grp.packFileName },
        grp.maps,
        scanner
      );
      const zipPath = path.join(bundleDir, `${grp.packFileName}.zip`);
      const zipped = await createZipArchive(
        zipPath,
        grpPlan.allFiles,
        grp.maps,
        grp.packFileName,
        grpPlan.allMissingWarnings
      );
      totalBytes += zipped.bytes;
      warnings.push(...grpPlan.collisionWarnings, ...zipped.warnings);
    }

    return {
      outputPath: bundleDir,
      fileName: tp(groups.length, '{name} ({n} .zip pack)', '{name} ({n} .zip packs)', { name: bundleDirName }),
      sizeBytes: totalBytes,
      fileCount: groups.length,
      format: 'folder',
      splitArchiveCount: groups.length,
      warnings: warnings.slice(0, 500),
    };
  }

  if (options.outputFormat === 'folder') {
    const plan = collectPackPlan(options, selectedMaps, scanner);
    const targetFolder = path.join(outRoot, safeName);
    fs.mkdirSync(targetFolder, { recursive: true });
    const warnings: string[] = [...plan.collisionWarnings];
    let copied = 0;

    // A Windows / macOS folder holds one spelling of a name, so the extra Linux spellings would only overwrite
    // the same file (and race between parallel copies)
    const caseInsensitiveTarget = process.platform === 'win32' || process.platform === 'darwin';
    const aliases = plan.allFiles.filter((f) => f.caseAliasOf);
    if (caseInsensitiveTarget && aliases.length > 0) {
      warnings.push(
        t(
          'Maps spell {files} in a different letter case (e.g. {example}) — this folder holds one name per file; ' +
            'for a Linux server, send the ZIP pack, which contains every spelling.',
          { files: tp(aliases.length, '{n} file', '{n} files'), example: aliases[0].archivePath }
        )
      );
    }

    // Async copies, 8 at a time, so a 20k-file folder export never freezes the server
    const queue = plan.allFiles.filter((f) => !(caseInsensitiveTarget && f.caseAliasOf));
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const destPath = path.join(targetFolder, ...file.archivePath.split('/'));
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        if (file.category === 'generated') {
          const content = generatedFileContent(
            file.archivePath,
            safeName,
            selectedMaps,
            plan.allMissingWarnings,
            plan.allFiles
          );
          await fs.promises.writeFile(destPath, content, 'utf-8');
          copied++;
        } else {
          try {
            await fs.promises.copyFile(file.diskPath, destPath);
            copied++;
          } catch (err) {
            warnings.push(
              t('{file}: not copied ({error})', {
                file: file.archivePath,
                error: err instanceof Error ? err.message : String(err),
              })
            );
          }
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));

    return {
      outputPath: targetFolder,
      fileName: safeName,
      sizeBytes: plan.totalUncompressedBytes,
      fileCount: copied,
      format: 'folder',
      warnings: warnings.slice(0, 500),
    };
  }

  if (options.outputFormat === 'smap') {
    if (selectedMaps.length === 1) {
      const singleMap = selectedMaps[0];
      const singlePlan = collectPackPlan(
        {
          ...options,
          mapIds: [singleMap.id],
          generateMapsListTxt: false,
          generateReadmeManifest: false,
          generateCrcManifest: false,
        },
        [singleMap],
        scanner
      );
      const smapName = `${sanitizeFileName(singleMap.baseName)}.smap`;
      const smapPath = path.join(outRoot, smapName);
      const zipped = await createZipArchive(
        smapPath,
        singlePlan.allFiles,
        [singleMap],
        safeName,
        []
      );
      return {
        outputPath: smapPath,
        fileName: smapName,
        sizeBytes: zipped.bytes,
        fileCount: zipped.fileCount,
        format: 'smap',
        warnings: [...singlePlan.collisionWarnings, ...zipped.warnings],
      };
    } else {
      const smapFolder = path.join(outRoot, `${safeName}_smap`);
      fs.mkdirSync(smapFolder, { recursive: true });
      let totalSize = 0;
      const warnings: string[] = [];
      const usedNames = new Set<string>();
      for (const map of selectedMaps) {
        const singlePlan = collectPackPlan(
          {
            ...options,
            mapIds: [map.id],
            generateMapsListTxt: false,
            generateReadmeManifest: false,
            generateCrcManifest: false,
          },
          [map],
          scanner
        );
        // Two maps with the same name from different sources must not overwrite each other's .smap
        let smapBase = sanitizeFileName(map.baseName);
        for (let n = 2; usedNames.has(smapBase.toLowerCase()); n++) {
          smapBase = `${sanitizeFileName(map.baseName)}_${n}`;
        }
        usedNames.add(smapBase.toLowerCase());
        if (smapBase !== sanitizeFileName(map.baseName)) {
          warnings.push(t('{map}: saved as {file} (duplicate map name)', { map: map.baseName, file: `${smapBase}.smap` }));
        }
        const smapPath = path.join(smapFolder, `${smapBase}.smap`);
        const zipped = await createZipArchive(
          smapPath,
          singlePlan.allFiles,
          [map],
          map.baseName,
          []
        );
        totalSize += zipped.bytes;
        warnings.push(...singlePlan.collisionWarnings, ...zipped.warnings);
      }
      return {
        outputPath: smapFolder,
        fileName: tp(selectedMaps.length, '{name} ({n} .smap file)', '{name} ({n} .smap files)', {
          name: `${safeName}_smap`,
        }),
        sizeBytes: totalSize,
        fileCount: selectedMaps.length,
        format: 'smap',
        warnings: warnings.slice(0, 500),
      };
    }
  }

  // Standard single .zip Soldat Map Pack
  const plan = collectPackPlan(options, selectedMaps, scanner);
  const zipFileName = `${safeName}.zip`;
  const zipPath = path.join(outRoot, zipFileName);

  const zipped = await createZipArchive(
    zipPath,
    plan.allFiles,
    selectedMaps,
    safeName,
    plan.allMissingWarnings
  );

  return {
    outputPath: zipPath,
    fileName: zipFileName,
    sizeBytes: zipped.bytes,
    fileCount: zipped.fileCount,
    format: 'zip',
    warnings: [...plan.collisionWarnings, ...zipped.warnings].slice(0, 500),
  };
}

/**
 * Writes the archive to `<target>.part` and renames it only when complete, so a failed build never leaves
 * a truncated pack behind. Files that vanish or are locked mid-build are reported instead of silently missing.
 */
function createZipArchive(
  targetZipPath: string,
  files: PackPreviewFile[],
  selectedMaps: MapIndexEntry[],
  packName: string,
  warnings: PackMissingWarning[]
): Promise<{ bytes: number; fileCount: number; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    const partPath = `${targetZipPath}.part`;
    const output = fs.createWriteStream(partPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const buildWarnings: string[] = [];
    let fileCount = 0;
    let failed = false;

    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      archive.abort();
      output.destroy();
      try {
        fs.rmSync(partPath, { force: true });
      } catch {
        // Ignore
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    output.on('close', () => {
      if (failed) return;
      try {
        fs.renameSync(partPath, targetZipPath);
      } catch (err) {
        fail(err);
        return;
      }
      resolve({ bytes: archive.pointer(), fileCount, warnings: buildWarnings });
    });
    output.on('error', fail);
    archive.on('error', fail);
    archive.on('warning', (err: Error & { code?: string }) => {
      buildWarnings.push(t('File skipped in the pack: {error}', { error: err.message }));
    });

    archive.pipe(output);

    for (const f of files) {
      if (f.category === 'generated') {
        archive.append(generatedFileContent(f.archivePath, packName, selectedMaps, warnings, files), {
          name: f.archivePath,
        });
        fileCount++;
      } else if (fs.existsSync(f.diskPath)) {
        archive.file(f.diskPath, { name: f.archivePath });
        fileCount++;
      } else {
        buildWarnings.push(t('{file}: the file disappeared from disk before packing', { file: f.archivePath }));
      }
    }

    archive.finalize().catch(fail);
  });
}
