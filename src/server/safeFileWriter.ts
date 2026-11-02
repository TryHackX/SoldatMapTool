import fs from 'fs';
import path from 'path';
import { soldatCrc32 } from '../shared/pmsParser';

/**
 * Error carrying an HTTP status (e.g. 409 when a target map already exists and overwrite was not confirmed).
 */
export class WorkshopError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export type GeneratedOutputKind = '_f' | '_o' | '_a' | 'editor';

export interface GeneratedOutputRecord {
  crc32: number;
  kind: GeneratedOutputKind;
  sourceMapId: string;
  createdAt: number;
  documentId?: string; // editor saves: the document that wrote the file
}

/**
 * Writes via a temporary sibling file + rename so a crash or disk-full error never leaves a half-written map or PNG.
 */
export function writeFileAtomic(targetPath: string, data: Uint8Array): void {
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}

/**
 * Copies files into `data/backups/<timestamp>/` right before they are overwritten or deleted.
 * One instance = one user operation, so all files touched together land in the same folder.
 */
export class BackupSession {
  private dir: string | null = null;
  public readonly saved: string[] = [];

  constructor(private readonly backupsRoot: string) {}

  public preserve(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    if (!this.dir) {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
      this.dir = path.join(this.backupsRoot, stamp);
      for (let n = 2; fs.existsSync(this.dir); n++) {
        this.dir = path.join(this.backupsRoot, `${stamp}_${n}`);
      }
      fs.mkdirSync(this.dir, { recursive: true });
    }
    let target = path.join(this.dir, path.basename(filePath));
    for (let n = 2; fs.existsSync(target); n++) {
      const ext = path.extname(filePath);
      target = path.join(this.dir, `${path.basename(filePath, ext)}_${n}${ext}`);
    }
    fs.copyFileSync(filePath, target);
    this.saved.push(target);
  }

  public get directory(): string | null {
    return this.dir;
  }
}

/**
 * Shared registry of files written by Studio (`_f`, `_o`, `_a`, and Map Editor saves).
 * Lets the UI distinguish an unchanged previous Studio output from an unrelated map file.
 */
export class GeneratedOutputRegistry {
  private cache: Record<string, GeneratedOutputRecord> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly registryPath: string) {}

  private getMap(): Record<string, GeneratedOutputRecord> {
    if (this.cache) return this.cache;
    let parsed: Record<string, GeneratedOutputRecord> = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
      if (raw && typeof raw === 'object') parsed = raw;
    } catch {
      parsed = {};
    }
    for (const key of Object.keys(parsed)) {
      if (!fs.existsSync(key)) delete parsed[key];
    }
    this.cache = parsed;
    return parsed;
  }

  public flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.cache) return;
    try {
      fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
      writeFileAtomic(this.registryPath, Buffer.from(JSON.stringify(this.cache, null, 1), 'utf-8'));
    } catch {
      // Registry is a convenience only
    }
  }

  public record(
    outputPath: string,
    bytes: Uint8Array,
    rec: Omit<GeneratedOutputRecord, 'crc32' | 'createdAt'>
  ): void {
    this.getMap()[path.resolve(outputPath).toLowerCase()] = {
      ...rec,
      crc32: soldatCrc32(bytes),
      createdAt: Date.now(),
    };
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 1500);
      this.flushTimer.unref?.();
    }
  }

  public getRecord(outputPath: string): GeneratedOutputRecord | null {
    const rec = this.getMap()[path.resolve(outputPath).toLowerCase()];
    if (!rec) return null;
    try {
      return soldatCrc32(fs.readFileSync(outputPath)) === rec.crc32 ? rec : null;
    } catch {
      return null;
    }
  }

  public isUnchanged(outputPath: string): boolean {
    return this.getRecord(outputPath) !== null;
  }
}
