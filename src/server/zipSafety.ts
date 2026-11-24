import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { t } from './i18n';
import { withZipMembers, type ZipMember } from './archiveZipReader';
import { ZIP_LIMITS, type ZipLimits } from './zipLimits';

export { ZIP_LIMITS, type ZipLimits };

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

/** The streaming reader marks links and special files; they are skipped, never written */
const LINK_MEMBER = 'Link or special ZIP member';

/** A problem the streaming reader reported for a member, as the message users already know (null = fine) */
function memberProblem(member: ZipMember, limits: ZipLimits): string | null {
  const file = member.name;
  if (member.problem?.startsWith('Encrypted')) {
    return t('File {file} is encrypted — such archives are not supported.', { file });
  }
  const method = /^Unsupported ZIP compression (\d+)/.exec(member.problem ?? '');
  if (method) {
    return t('File {file} uses an unsupported compression method ({method}) — extract the archive with another program.', {
      file,
      method: method[1],
    });
  }
  if (member.problem === 'ZIP member exceeds size limit' || member.size > limits.maxEntryBytes) {
    return t('File {file} in the archive is too large ({size} B).', { file, size: member.size });
  }
  return member.problem ? t('The archive is damaged or unsafe: {reason}', { reason: member.problem }) : null;
}

/** Errors of the reader's own checks (central directory, overlapping records, ZIP64, expanded size) as a 400 */
function readerError(error: unknown): ZipSafetyError {
  return new ZipSafetyError(t('The archive is damaged or unsafe: {reason}', {
    reason: error instanceof Error ? error.message : String(error),
  }));
}

/**
 * Lists the regular members of an archive without extracting it: the central directory is read in place, so the
 * archive is never loaded into memory as a whole (no 2 GiB limit) and other requests keep being served.
 */
export async function withSafeZipMembers(
  archivePath: string,
  visit: (members: ZipMember[]) => Promise<void>,
  limits: ZipLimits = ZIP_LIMITS
): Promise<void> {
  let listed = false;
  try {
    await withZipMembers(archivePath, async (members) => {
      listed = true;
      if (members.length > limits.maxEntries) {
        throw new ZipSafetyError(
          t('The archive has {count} entries (limit {limit}).', { count: members.length, limit: limits.maxEntries })
        );
      }
      await visit(members);
    });
  } catch (error) {
    if (!listed && !(error instanceof ZipSafetyError)) throw readerError(error);
    throw error;
  }
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

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to); // replaces an existing file
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    const sibling = path.join(path.dirname(to), '.sms-copy-' + randomUUID());
    try {
      await fs.promises.copyFile(from, sibling, fs.constants.COPYFILE_EXCL);
      await fs.promises.rename(sibling, to);
    } finally {
      await fs.promises.rm(sibling, { force: true });
    }
  }
}

/**
 * Extracts every regular file of the archive into `destDir`. The archive is read through its central directory
 * and every member is inflated asynchronously, so a large pack neither blocks the server nor has to fit in memory:
 * 1. validates all entries (paths, links, encryption, compression method, overlapping data, sizes, ratio);
 * 2. decompresses everything into a hidden staging folder (CRC and size checked) — the destination is untouched
 *    until the whole archive has proven readable;
 * 3. moves the files into place, refusing to write through an existing link, and restores replaced files when
 *    a later one cannot be written.
 */
export async function extractZipSafely(
  archivePath: string,
  destDir: string,
  limits: ZipLimits = ZIP_LIMITS
): Promise<{ files: number; bytes: number; skippedLinks: number }> {
  const archiveSize = (await fs.promises.stat(archivePath)).size;
  const root = path.resolve(destDir);
  let result: { files: number; bytes: number; skippedLinks: number } | undefined;
  await withSafeZipMembers(archivePath, async (members) => {
    const plan: Array<{ member: ZipMember; rel: string }> = [];
    let totalBytes = 0;
    let skippedLinks = 0;
    for (const member of members) {
      if (member.directory) continue;
      if (member.problem === LINK_MEMBER) {
        skippedLinks++;
        continue;
      }
      const target = path.resolve(root, member.name.replaceAll('\\', '/'));
      const relative = path.relative(root, target);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new ZipSafetyError(t('Unsafe path in the archive: {path}', { path: member.name }));
      }
      const problem = memberProblem(member, limits);
      if (problem) throw new ZipSafetyError(problem);
      totalBytes += member.size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new ZipSafetyError(t('The extracted archive contents would exceed the size limit.'));
      }
      plan.push({ member, rel: relative });
    }
    if (totalBytes > Math.max(limits.ratioFloorBytes, archiveSize * limits.maxCompressionRatio)) {
      throw new ZipSafetyError(
        t('The archive ({archiveSize} B) would extract to {totalBytes} B — this looks like a "zip bomb", extraction stopped.', {
          archiveSize,
          totalBytes,
        })
      );
    }
    result = { ...(await writeExtracted(root, plan)), skippedLinks };
  }, limits);
  return result!;
}

async function writeExtracted(root: string, plan: Array<{ member: ZipMember; rel: string }>) {
  await fs.promises.mkdir(root, { recursive: true });
  const staging = await fs.promises.mkdtemp(path.join(root, '.sms-extract-'));
  const payload = path.join(staging, 'files'), backupDir = path.join(staging, 'originals');
  const distinct: string[] = [];
  let distinctBytes = 0;
  const written: Array<{ target: string; backup?: string }> = [];
  let keepBackups = false;
  try {
    for (const { member, rel } of plan) {
      const staged = path.join(payload, rel);
      await fs.promises.mkdir(path.dirname(staged), { recursive: true });
      let data: Buffer;
      try {
        data = await member.read(); // the reader checks the size and the CRC
      } catch {
        throw new ZipSafetyError(t('Corrupted file in the archive: {file}', { file: member.name }));
      }
      // Test the destination volume's own case/normalization rules in staging.
      // A pack can legitimately include the same artwork under two case spellings.
      try {
        await fs.promises.writeFile(staged, data, { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if ((await fs.promises.stat(staged)).isFile() && data.equals(await fs.promises.readFile(staged))) continue;
        throw new ZipSafetyError(t('Different entries share a destination filename. Use Clean archive to keep both versions: {path}', { path: rel }));
      }
      distinct.push(rel);
      distinctBytes += data.length;
    }
    await fs.promises.mkdir(backupDir);
    for (const rel of distinct) {
      const target = path.join(root, rel);
      assertNoLinkOnPath(root, path.dirname(target));
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      assertNoLinkOnPath(root, target);
      let backup: string | undefined;
      if (fs.existsSync(target)) {
        if (!(await fs.promises.stat(target)).isFile()) throw new ZipSafetyError(t('Unsafe path in the archive: {path}', { path: rel }));
        backup = path.join(backupDir, String(written.length));
        await fs.promises.copyFile(target, backup, fs.constants.COPYFILE_EXCL);
      }
      await moveFile(path.join(payload, rel), target);
      written.push({ target, backup });
    }
  } catch (error) {
    const failed: unknown[] = [];
    for (const row of written.reverse()) {
      try {
        if (row.backup) await moveFile(row.backup, row.target);
        else await fs.promises.unlink(row.target);
      } catch (rollback) {
        failed.push(rollback);
      }
    }
    if (failed.length) {
      keepBackups = true;
      throw new AggregateError([error, ...failed], t('Could not finish restoring the extraction. Previous files are in {path}', { path: backupDir }));
    }
    throw error;
  } finally {
    if (!keepBackups) await fs.promises.rm(staging, { recursive: true, force: true });
  }
  return { files: distinct.length, bytes: distinctBytes };
}
