import fs from 'fs';
import path from 'path';
import {
  DuplicateGroup,
  DuplicateMapFile,
  DuplicatesResponse,
  LibraryMoveResult,
  MapIndexEntry,
  UnusedSceneryItem,
  UnusedSceneryReport,
} from '../shared/apiTypes';
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
    if (!group) throw new LibraryError(`Mapa ${id} nie ma duplikatów — nie można jej przenieść tym narzędziem.`);
    if (group.every((e) => remove.has(e.id))) {
      throw new LibraryError(`Grupa ${group[0].baseName} straciłaby ostatnią kopię — zostaw przynajmniej jeden plik.`);
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
    throw new LibraryError(`Nie można odczytać folderu ${folder}.`, 404);
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
      session.fail(name, 'plik jest teraz używany przez mapę albo już go nie ma');
      continue;
    }
    await session.move(path.join(report.folder, name), name);
  }
  session.writeRestoreList();
  return session.result();
}

// ---------------------------------------------------------------------------------------------------

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
    if (!this.dir) {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
      let dir = path.join(this.backupsRoot, `${this.label}-${stamp}`);
      for (let n = 2; fs.existsSync(dir); n++) dir = path.join(this.backupsRoot, `${this.label}-${stamp}_${n}`);
      fs.mkdirSync(dir, { recursive: true });
      this.dir = dir;
    }
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
        if (a.size !== b.size) throw new Error('kopia ma inny rozmiar niż oryginał');
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
      '# Pliki przeniesione przez Soldat Map Studio. Aby przywrócić plik, skopiuj go z powrotem pod pierwotną ścieżkę.',
      '# pierwotna_sciezka<TAB>kopia',
      ...this.moved.map((m) => `${m.from}\t${m.to}`),
      '',
    ];
    fs.writeFileSync(path.join(this.dir, 'PRZYWRACANIE.txt'), lines.join('\r\n'), 'utf-8');
  }

  public result(): LibraryMoveResult {
    return { moved: this.moved.length, failed: this.failed.slice(0, 200), backupDir: this.dir };
  }
}
