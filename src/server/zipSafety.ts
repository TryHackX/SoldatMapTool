import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

/**
 * Limits for archives from the internet (map packs). A crafted ZIP can declare absurd sizes (memory
 * exhaustion), point many entries at the same compressed data ("zip bomb"), escape the target folder
 * (zip-slip) or carry symbolic links that later writes would follow.
 */
export const ZIP_LIMITS = {
  maxEntries: 100_000,
  maxEntryBytes: 512 * 1024 * 1024, // one file inside the archive
  maxTotalBytes: 8 * 1024 * 1024 * 1024, // all files together
  maxCompressionRatio: 200, // unpacked size vs archive size (map packs compress ~3-20x)
  ratioFloorBytes: 64 * 1024 * 1024, // small archives may unpack to this much regardless of the ratio
  maxPmsPreviewBytes: 32 * 1024 * 1024, // one .pms parsed for the archive preview (real maps are < 5 MB)
  maxPreviewTotalBytes: 256 * 1024 * 1024, // all .pms parsed for one preview
};

export type ZipLimits = typeof ZIP_LIMITS;

const STORED = 0;
const DEFLATED = 8;

export class ZipSafetyError extends Error {
  public readonly status = 400;
}

/** Unix mode bits live in the high 16 bits of the external attributes; 0o120000 = symbolic link */
export function isZipSymlink(entry: AdmZip.IZipEntry): boolean {
  return ((entry.header.attr >>> 16) & 0o170000) === 0o120000;
}

/** Reasons an entry cannot be decompressed safely (null = fine) */
export function zipEntryProblem(entry: AdmZip.IZipEntry): string | null {
  if (entry.header.encrypted) return `Plik ${entry.entryName} jest zaszyfrowany — takie archiwa nie są obsługiwane.`;
  if (entry.header.method !== STORED && entry.header.method !== DEFLATED) {
    return `Plik ${entry.entryName} używa nieobsługiwanej metody kompresji (${entry.header.method}) — rozpakuj archiwum innym programem.`;
  }
  return null;
}

function assertNoLinkOnPath(root: string, target: string): void {
  // The chosen destination itself may be a link (e.g. a game folder junction) — only paths below it are checked
  const rel = path.relative(root, target);
  let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return; // the rest of the path does not exist yet
    }
    if (stat.isSymbolicLink()) {
      throw new ZipSafetyError(`Ścieżka ${rel} prowadzi przez dowiązanie symboliczne — wypakowanie przerwane.`);
    }
  }
}

function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to); // replaces an existing file
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

/**
 * Extracts every regular file of the archive into `destDir`:
 * 1. validates all entries (paths, links, encryption, compression method, overlapping data, sizes, ratio);
 * 2. decompresses everything into a hidden staging folder (CRC and size checked) — the destination is untouched
 *    until the whole archive has proven readable;
 * 3. moves the files into place, refusing to write through an existing link.
 */
export function extractZipSafely(
  archivePath: string,
  destDir: string,
  limits: ZipLimits = ZIP_LIMITS
): { files: number; bytes: number; skippedLinks: number } {
  const archiveSize = fs.statSync(archivePath).size;
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  if (entries.length > limits.maxEntries) {
    throw new ZipSafetyError(`Archiwum ma ${entries.length} wpisów (limit ${limits.maxEntries}).`);
  }

  const root = path.resolve(destDir);
  const plan: Array<{ entry: AdmZip.IZipEntry; rel: string }> = [];
  const seenDataOffsets = new Set<number>();
  let totalBytes = 0;
  let skippedLinks = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (isZipSymlink(entry)) {
      skippedLinks++;
      continue;
    }
    const target = path.resolve(root, entry.entryName);
    if (!target.startsWith(root + path.sep)) {
      throw new ZipSafetyError(`Niebezpieczna ścieżka w archiwum: ${entry.entryName}`);
    }
    const problem = zipEntryProblem(entry);
    if (problem) throw new ZipSafetyError(problem);
    if (seenDataOffsets.has(entry.header.offset)) {
      throw new ZipSafetyError(`Archiwum zawiera nakładające się wpisy (${entry.entryName}) — wygląda na spreparowane.`);
    }
    seenDataOffsets.add(entry.header.offset);
    if (entry.header.size > limits.maxEntryBytes) {
      throw new ZipSafetyError(`Plik ${entry.entryName} w archiwum jest za duży (${entry.header.size} B).`);
    }
    totalBytes += entry.header.size;
    if (totalBytes > limits.maxTotalBytes) {
      throw new ZipSafetyError('Zawartość archiwum po rozpakowaniu przekroczyłaby limit rozmiaru.');
    }
    plan.push({ entry, rel: path.relative(root, target) });
  }
  if (totalBytes > Math.max(limits.ratioFloorBytes, archiveSize * limits.maxCompressionRatio)) {
    throw new ZipSafetyError(
      `Archiwum (${archiveSize} B) rozpakowałoby się do ${totalBytes} B — to wygląda na „zip-bombę”, wypakowanie przerwane.`
    );
  }

  fs.mkdirSync(root, { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, '.sms-extract-'));
  try {
    for (const { entry, rel } of plan) {
      const staged = path.join(staging, rel);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      const data = entry.getData(); // throws on a bad CRC
      if (data.length !== entry.header.size) {
        throw new ZipSafetyError(`Uszkodzony plik w archiwum: ${entry.entryName}`);
      }
      fs.writeFileSync(staged, data);
    }
    for (const { rel } of plan) {
      const target = path.join(root, rel);
      assertNoLinkOnPath(root, path.dirname(target));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertNoLinkOnPath(root, target);
      moveFile(path.join(staging, rel), target);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { files: plan.length, bytes: totalBytes, skippedLinks };
}
