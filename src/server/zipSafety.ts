import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { t } from './i18n';

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
  if (entry.header.encrypted) {
    return t('File {file} is encrypted — such archives are not supported.', { file: entry.entryName });
  }
  if (entry.header.method !== STORED && entry.header.method !== DEFLATED) {
    return t('File {file} uses an unsupported compression method ({method}) — extract the archive with another program.', {
      file: entry.entryName,
      method: entry.header.method,
    });
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new ZipSafetyError(t('Path {path} goes through a symbolic link — extraction stopped.', { path: rel }));
    }
  }
}

function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to); // replaces an existing file
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    const sibling = path.join(path.dirname(to), '.sms-copy-' + randomUUID());
    try {
      fs.copyFileSync(from, sibling, fs.constants.COPYFILE_EXCL);
      fs.renameSync(sibling, to);
    } finally { fs.rmSync(sibling, {force:true}); }
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
    throw new ZipSafetyError(
      t('The archive has {count} entries (limit {limit}).', { count: entries.length, limit: limits.maxEntries })
    );
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
    const target = path.resolve(root, entry.entryName.replaceAll('\\', '/'));
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new ZipSafetyError(t('Unsafe path in the archive: {path}', { path: entry.entryName }));
    }
    const problem = zipEntryProblem(entry);
    if (problem) throw new ZipSafetyError(problem);
    if (seenDataOffsets.has(entry.header.offset)) {
      throw new ZipSafetyError(
        t('The archive contains overlapping entries ({file}) — it looks crafted.', { file: entry.entryName })
      );
    }
    seenDataOffsets.add(entry.header.offset);
    if (entry.header.size > limits.maxEntryBytes) {
      throw new ZipSafetyError(
        t('File {file} in the archive is too large ({size} B).', { file: entry.entryName, size: entry.header.size })
      );
    }
    totalBytes += entry.header.size;
    if (totalBytes > limits.maxTotalBytes) {
      throw new ZipSafetyError(t('The extracted archive contents would exceed the size limit.'));
    }
    plan.push({ entry, rel: path.relative(root, target) });
  }
  if (totalBytes > Math.max(limits.ratioFloorBytes, archiveSize * limits.maxCompressionRatio)) {
    throw new ZipSafetyError(
      t('The archive ({archiveSize} B) would extract to {totalBytes} B — this looks like a "zip bomb", extraction stopped.', {
        archiveSize,
        totalBytes,
      })
    );
  }

  fs.mkdirSync(root, { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, '.sms-extract-'));
  const payload = path.join(staging, 'files'), backupDir = path.join(staging, 'originals');
  const distinct: string[] = [];
  let distinctBytes = 0;
  const written: Array<{target:string; backup?:string}> = [];
  let keepBackups = false;
  try {
    for (const { entry, rel } of plan) {
      const staged = path.join(payload, rel);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      const data = entry.getData(); // throws on a bad CRC
      if (data.length !== entry.header.size) {
        throw new ZipSafetyError(t('Corrupted file in the archive: {file}', { file: entry.entryName }));
      }
      // Test the destination volume's own case/normalization rules in staging.
      // A pack can legitimately include the same artwork under two case spellings.
      try { fs.writeFileSync(staged, data, {flag:'wx'}); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (fs.statSync(staged).isFile() && data.equals(fs.readFileSync(staged))) continue;
        throw new ZipSafetyError(t('Different entries share a destination filename. Use Clean archive to keep both versions: {path}', {path:rel}));
      }
      distinct.push(rel);
      distinctBytes += data.length;
    }
    fs.mkdirSync(backupDir);
    for (const rel of distinct) {
      const target = path.join(root, rel);
      assertNoLinkOnPath(root, path.dirname(target));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertNoLinkOnPath(root, target);
      let backup: string | undefined;
      if (fs.existsSync(target)) {
        if (!fs.statSync(target).isFile()) throw new ZipSafetyError(t('Unsafe path in the archive: {path}', {path:rel}));
        backup = path.join(backupDir,String(written.length));
        fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);
      }
      moveFile(path.join(payload, rel), target);
      written.push({target,backup});
    }
  } catch (error) {
    const failed: unknown[] = [];
    for (const row of written.reverse()) {
      try {
        if (row.backup) moveFile(row.backup,row.target);
        else fs.unlinkSync(row.target);
      } catch (rollback) { failed.push(rollback); }
    }
    if (failed.length) {
      keepBackups = true;
      throw new AggregateError([error,...failed],t('Could not finish restoring the extraction. Previous files are in {path}',{path:backupDir}));
    }
    throw error;
  } finally {
    if (!keepBackups) fs.rmSync(staging, { recursive: true, force: true });
  }
  return { files: distinct.length, bytes: distinctBytes, skippedLinks };
}
