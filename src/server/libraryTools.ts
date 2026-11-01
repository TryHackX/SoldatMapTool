import fs from 'fs';
import path from 'path';
import {
  CaseMismatchFile,
  CaseMismatchReport,
  DuplicateGroup,
  DuplicateMapFile,
  DuplicatesResponse,
  LibraryMoveResult,
  MapIndexEntry,
  UnusedSceneryItem,
  UnusedSceneryReport,
} from '../shared/apiTypes';
import { t } from './i18n';
import { SoldatMapScanner } from './soldatScanner';

const MAX_UNUSED_ITEMS = 5000;
const IMAGE_EXT = /\.(png|bmp|jpe?g|gif|tga|webp)$/i;
const COPY_MARKERS = /(\(\d+\)|copy|kopia|_old\b|_bak\b|backup)/i;

/** Thrown for requests that would break the library (e.g. removing every copy of a map) */
export class LibraryError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

let libraryOperationRunning = false;

/** Runs one tidy-up operation (move + rescan) at a time; a second request gets 409 instead of racing */
export async function runLibraryOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (libraryOperationRunning) {
    throw new LibraryError(t('Another clean-up operation is running — wait until it finishes.'), 409);
  }
  libraryOperationRunning = true;
  try {
    return await operation();
  } finally {
    libraryOperationRunning = false;
  }
}

function samePhysicalFile(a: string, b: string): boolean {
  try {
    const x = fs.statSync(a, { bigint: true });
    const y = fs.statSync(b, { bigint: true });
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

function sameBytes(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// C2: duplicate maps (identical OpenSoldat CRC32)
// ---------------------------------------------------------------------------------------------------

function toDuplicateFile(e: MapIndexEntry): DuplicateMapFile {
  return {
    id: e.id,
    baseName: e.baseName,
    fileName: e.fileName,
    fullPath: e.fullPath,
    sourceId: e.sourceId,
    sourceLabel: e.sourceLabel,
    fileSize: e.fileSize,
    mtimeMs: e.mtimeMs,
    title: e.title,
  };
}

/**
 * Which copy to keep by default: the game's own `maps/` folder first, then names without copy markers
 * ("(2)", "kopia", "_old"), then outside `downloads/`, then the shortest name, then the oldest file.
 */
export function suggestKeeper(files: DuplicateMapFile[]): string {
  const rank = (f: DuplicateMapFile) => [
    f.sourceId === 'soldat' ? 0 : 1,
    COPY_MARKERS.test(f.baseName) ? 1 : 0,
    /[\\/]downloads[\\/]/i.test(f.fullPath) ? 1 : 0,
    f.baseName.length,
    f.mtimeMs,
  ];
  const sorted = [...files].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.fullPath.localeCompare(b.fullPath);
  });
  return sorted[0].id;
}

export function listDuplicateGroups(scanner: SoldatMapScanner): DuplicatesResponse {
  const groups: DuplicateGroup[] = [];
  for (const entries of scanner.getDuplicateEntryGroups()) {
    const files = entries.map(toDuplicateFile);
    const firstName = files[0].baseName.toLowerCase();
    groups.push({
      crc32: entries[0].crc32 >>> 0,
      crcHex: (entries[0].crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      files,
      sameName: files.every((f) => f.baseName.toLowerCase() === firstName),
      suggestedKeepId: suggestKeeper(files),
    });
  }
  // Exact copies (same name) first: those are the safe ones to tidy up
  groups.sort((a, b) => Number(b.sameName) - Number(a.sameName) || a.files[0].baseName.localeCompare(b.files[0].baseName));
  return {
    groups,
    totalGroups: groups.length,
    totalRemovable: groups.reduce((acc, g) => acc + g.files.length - 1, 0),
  };
}

/**
 * Moves the chosen duplicate files into `data/backups/duplicates-<time>/` (with a restore list).
 * Refuses the whole request when a group would lose its last copy or an id is not a duplicate at all.
 */
export async function moveDuplicateMaps(
  scanner: SoldatMapScanner,
  mapIds: string[],
  backupsRoot: string
): Promise<LibraryMoveResult> {
  const remove = new Set(mapIds);
  const groupOf = new Map<string, MapIndexEntry[]>();
  for (const entries of scanner.getDuplicateEntryGroups()) {
    for (const e of entries) groupOf.set(e.id, entries);
  }
  for (const id of remove) {
    const group = groupOf.get(id);
    if (!group) throw new LibraryError(t('Map {id} has no duplicates — it cannot be moved with this tool.', { id }));
    if (group.every((e) => remove.has(e.id))) {
      throw new LibraryError(
        t('Group {name} would lose its last copy — keep at least one file.', { name: group[0].baseName })
      );
    }
  }

  // The groups come from the last scan: right before moving, each file must be unchanged on disk and a
  // byte-identical copy that stays (a different physical file, not the same one seen through a link) must exist
  for (const id of remove) {
    const group = groupOf.get(id)!;
    const entry = group.find((e) => e.id === id)!;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry.fullPath);
    } catch {
      throw new LibraryError(t('File {path} no longer exists — refresh the list.', { path: entry.fullPath }), 409);
    }
    if (stat.size !== entry.fileSize || Math.abs(stat.mtimeMs - entry.mtimeMs) > 2) {
      throw new LibraryError(
        t('File {path} has changed since the last scan — refresh the list.', { path: entry.fullPath }),
        409
      );
    }
    const keeper = group.find(
      (e) =>
        !remove.has(e.id) &&
        fs.existsSync(e.fullPath) &&
        !samePhysicalFile(e.fullPath, entry.fullPath) &&
        sameBytes(e.fullPath, entry.fullPath)
    );
    if (!keeper) {
      throw new LibraryError(
        t('{name} no longer has an identical copy that stays — nothing was moved. Refresh the list.', {
          name: entry.fileName,
        }),
        409
      );
    }
  }

  const session = new MoveToBackupSession(backupsRoot, 'duplicates');
  for (const id of remove) {
    const entry = scanner.getMapEntry(id);
    if (!entry) continue;
    await session.move(entry.fullPath, path.join(sanitizeSegment(entry.sourceLabel || entry.sourceId), entry.fileName));
  }
  session.writeRestoreList();
  return session.result();
}

// ---------------------------------------------------------------------------------------------------
// C3: scenery files no indexed map references
// ---------------------------------------------------------------------------------------------------

function stemOf(name: string): string {
  return name.toLowerCase().replace(/\.[^.\\/]+$/, '');
}

/**
 * Files in the game's `scenery-gfx/` that no indexed map references (as .bmp or its .png variant, used by a
 * prop or only listed in the map header). Default game files (readonly.txt) are never reported.
 */
export function computeUnusedScenery(scanner: SoldatMapScanner): UnusedSceneryReport & { allUnusedNames: string[] } {
  const folder = path.join(scanner.getSoldatPath(), 'scenery-gfx');
  const usedStems = new Set<string>();
  for (const entry of scanner.getAllEntries()) {
    for (const sc of entry.sceneryAssets) {
      for (const n of [sc.referencedName, sc.diskName, sc.pngOverrideDiskName]) {
        if (n) usedStems.add(stemOf(n));
      }
    }
  }

  const resolver = scanner.getResolver();
  let totalFiles = 0;
  let usedFiles = 0;
  let vanillaSkipped = 0;
  const unused: UnusedSceneryItem[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    throw new LibraryError(t('Cannot read the folder {folder}.', { folder }), 404);
  }
  for (const name of names) {
    if (!IMAGE_EXT.test(name)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(folder, name));
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    totalFiles++;
    if (usedStems.has(stemOf(name))) {
      usedFiles++;
      continue;
    }
    if (resolver.isVanillaAsset('scenery-gfx', name)) {
      vanillaSkipped++;
      continue;
    }
    unused.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  unused.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  return {
    folder,
    totalFiles,
    usedFiles,
    vanillaSkipped,
    unusedCount: unused.length,
    unusedBytes: unused.reduce((acc, i) => acc + i.size, 0),
    items: unused.slice(0, MAX_UNUSED_ITEMS),
    truncated: unused.length > MAX_UNUSED_ITEMS,
    allUnusedNames: unused.map((i) => i.name),
  };
}

/** Moves the chosen unused sceneries into `data/backups/unused-scenery-<time>/`, re-checking each one first */
export async function moveUnusedScenery(
  scanner: SoldatMapScanner,
  names: string[],
  backupsRoot: string
): Promise<LibraryMoveResult> {
  const report = computeUnusedScenery(scanner);
  const stillUnused = new Set(report.allUnusedNames.map((n) => n.toLowerCase()));
  const session = new MoveToBackupSession(backupsRoot, 'unused-scenery');
  for (const raw of names) {
    const name = path.basename(String(raw));
    if (!stillUnused.has(name.toLowerCase())) {
      session.fail(name, t('the file is now used by a map or no longer exists'));
      continue;
    }
    await session.move(path.join(report.folder, name), name);
  }
  session.writeRestoreList();
  return session.result();
}

// ---------------------------------------------------------------------------------------------------
// C4: letter case of scenery / texture names (Linux)
// ---------------------------------------------------------------------------------------------------

/**
 * Custom scenery and texture files whose name differs in letter case from what maps write. Windows and the
 * OpenSoldat client ignore the difference; a case-sensitive Linux server serving map downloads does not.
 */
export function computeCaseMismatches(scanner: SoldatMapScanner): CaseMismatchReport {
  const root = path.resolve(scanner.getSoldatPath()).toLowerCase();
  const byFile = new Map<
    string,
    { category: CaseMismatchFile['category']; diskName: string; fullPath: string; spellings: Map<string, string[]> }
  >();
  let affectedMaps = 0;
  for (const entry of scanner.getAllEntries()) {
    if (entry.caseMismatchCount > 0) affectedMaps++;
    for (const a of [entry.textureInfo, ...entry.sceneryAssets]) {
      if (!a.diskName || !a.diskFullPath || !a.referencedName || a.isVanilla || a.usedCount === 0) continue;
      if (a.status !== 'case-mismatch' && a.status !== 'custom') continue;
      if (a.category !== 'textures' && a.category !== 'scenery-gfx') continue;
      const key = path.resolve(a.diskFullPath).toLowerCase();
      let file = byFile.get(key);
      if (!file) {
        file = { category: a.category, diskName: a.diskName, fullPath: a.diskFullPath, spellings: new Map() };
        byFile.set(key, file);
      }
      const maps = file.spellings.get(a.referencedName) ?? [];
      if (!maps.includes(entry.baseName)) maps.push(entry.baseName);
      file.spellings.set(a.referencedName, maps);
    }
  }

  const files: CaseMismatchFile[] = [];
  for (const f of byFile.values()) {
    if (Array.from(f.spellings.keys()).every((name) => name === f.diskName)) continue;
    const spellings = Array.from(f.spellings.entries())
      .map(([name, maps]) => ({ name, mapCount: maps.length, sampleMaps: maps.slice(0, 5) }))
      .sort((a, b) => b.mapCount - a.mapCount || a.name.localeCompare(b.name));
    const folder = path.dirname(f.fullPath);
    const inGameFolder = path.resolve(folder).toLowerCase() === path.join(root, f.category);
    const only = spellings.length === 1 ? spellings[0].name : null;
    const renameTo =
      only && inGameFolder && path.basename(only) === only && only.toLowerCase() === f.diskName.toLowerCase()
        ? only
        : null;
    files.push({ category: f.category, diskName: f.diskName, folder, spellings, renameTo });
  }
  const mapsUsing = (f: CaseMismatchFile) => f.spellings.reduce((acc, s) => acc + s.mapCount, 0);
  files.sort(
    (a, b) => Number(!a.renameTo) - Number(!b.renameTo) || mapsUsing(b) - mapsUsing(a) || a.diskName.localeCompare(b.diskName)
  );
  return {
    files,
    renamableCount: files.filter((f) => f.renameTo).length,
    severalSpellingsCount: files.filter((f) => f.spellings.length > 1).length,
    affectedMaps,
  };
}

/**
 * Renames the chosen files to the one spelling their maps use (letter case only, content untouched). Each file
 * is re-checked first; the old and new names go to a restore list in `data/backups/case-renames-<time>/`.
 */
export async function renameCaseMismatches(
  scanner: SoldatMapScanner,
  requested: Array<{ category: string; diskName: string }>,
  backupsRoot: string
): Promise<LibraryMoveResult> {
  const report = computeCaseMismatches(scanner);
  const byKey = new Map(report.files.map((f) => [`${f.category}/${f.diskName}`.toLowerCase(), f]));
  const renamed: Array<{ from: string; to: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const req of requested) {
    const name = path.basename(req.diskName);
    const file = byKey.get(`${req.category}/${name}`.toLowerCase());
    if (!file) {
      failed.push({ name, error: t('the name already matches the maps or the file is missing') });
      continue;
    }
    if (!file.renameTo) {
      failed.push({
        name,
        error:
          file.spellings.length > 1 ? t('maps spell this name in several ways') : t('the file is outside the game folder'),
      });
      continue;
    }
    const from = path.join(file.folder, file.diskName);
    const to = path.join(file.folder, file.renameTo);
    try {
      // On a case-sensitive disk another file may already have the target name
      if ((await fs.promises.readdir(file.folder)).includes(file.renameTo)) {
        throw new Error(t('a file with this name already exists in the folder'));
      }
      // A case-only rename through a temporary name works on every file system (NTFS, APFS, ext4)
      const tmp = `${from}.sms-case-${process.pid}-${Date.now()}`;
      await fs.promises.rename(from, tmp);
      try {
        await fs.promises.rename(tmp, to);
      } catch (err) {
        await fs.promises.rename(tmp, from).catch(() => undefined);
        throw err;
      }
      renamed.push({ from, to });
    } catch (err) {
      failed.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  let backupDir: string | null = null;
  if (renamed.length > 0) {
    backupDir = createStampedDir(backupsRoot, 'case-renames');
    const lines = [
      `# ${t('Names changed by Soldat Map Studio (letter case only, content unchanged).')}`,
      `# ${t('To undo, rename the file back to its previous name.')}`,
      `# ${t('previous_path<TAB>new_path')}`,
      ...renamed.map((r) => `${r.from}\t${r.to}`),
      '',
    ];
    fs.writeFileSync(path.join(backupDir, t('RESTORE.txt')), lines.join('\r\n'), 'utf-8');
  }
  return { moved: renamed.length, failed: failed.slice(0, 200), backupDir };
}

// ---------------------------------------------------------------------------------------------------

/** New `<label>-<time>` folder under the backups root (suffixed when that name is taken) */
function createStampedDir(backupsRoot: string, label: string): string {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
  let dir = path.join(backupsRoot, `${label}-${stamp}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(backupsRoot, `${label}-${stamp}_${n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeSegment(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').trim() || 'source';
}

/** Moves files (rename, or copy + delete across drives) into one timestamped backup folder */
class MoveToBackupSession {
  private dir: string | null = null;
  private moved: Array<{ from: string; to: string }> = [];
  private failed: Array<{ name: string; error: string }> = [];

  constructor(private readonly backupsRoot: string, private readonly label: string) {}

  private ensureDir(): string {
    if (!this.dir) this.dir = createStampedDir(this.backupsRoot, this.label);
    return this.dir;
  }

  public fail(name: string, error: string): void {
    this.failed.push({ name, error });
  }

  public async move(from: string, relTarget: string): Promise<void> {
    const name = path.basename(from);
    try {
      let target = path.join(this.ensureDir(), relTarget);
      const ext = path.extname(target);
      for (let n = 2; fs.existsSync(target); n++) target = `${target.slice(0, target.length - ext.length)}_${n}${ext}`;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.promises.rename(from, target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        // Different drive (e.g. game on G:, project on C:): copy, verify, then delete the original
        await fs.promises.copyFile(from, target);
        const [a, b] = await Promise.all([fs.promises.stat(from), fs.promises.stat(target)]);
        if (a.size !== b.size) throw new Error(t('the copy has a different size than the original'));
        await fs.promises.unlink(from);
      }
      this.moved.push({ from, to: target });
    } catch (err) {
      this.failed.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  public writeRestoreList(): void {
    if (!this.dir || this.moved.length === 0) return;
    const lines = [
      `# ${t('Files moved by Soldat Map Studio. To restore a file, copy it back to its original path.')}`,
      `# ${t('original_path<TAB>copy')}`,
      ...this.moved.map((m) => `${m.from}\t${m.to}`),
      '',
    ];
    fs.writeFileSync(path.join(this.dir, t('RESTORE.txt')), lines.join('\r\n'), 'utf-8');
  }

  public result(): LibraryMoveResult {
    return { moved: this.moved.length, failed: this.failed.slice(0, 200), backupDir: this.dir };
  }
}
