import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { PmsSummaryData } from '../shared/pmsParser';

export interface SqliteCachedSummary {
  fullPath: string;
  mtimeMs: number;
  fileSize: number;
  summary: PmsSummaryData;
}

// v3: summaries carry `parseWarnings` and the parser clamps over-long strings -> re-parse everything once
const SCHEMA_VERSION = 3;

/**
 * Persistent SQLite WAL summary cache built on Node's native `node:sqlite`.
 * Scales effortlessly to 50,000 - 200,000 maps without hitting V8 JSON.stringify
 * string size limits or blocking on monolithic file rewrites.
 */
export class MapSqliteCache {
  private db: DatabaseSync;

  constructor(cacheDir: string) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const dbPath = path.join(cacheDir, 'soldat-index-v2.sqlite');
    this.db = new DatabaseSync(dbPath);

    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -32000;

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pms_cache (
        path_key TEXT PRIMARY KEY,
        mtime_ms REAL NOT NULL,
        file_size INTEGER NOT NULL,
        summary_json TEXT NOT NULL
      );
    `);

    const verRow = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value?: string } | undefined;

    if (!verRow || Number(verRow.value) !== SCHEMA_VERSION) {
      this.db.exec('DELETE FROM pms_cache;');
      this.db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(SCHEMA_VERSION));
    }
  }

  /**
   * Loads all cached file metadata headers into a lightweight Map<pathKey, { mtimeMs, fileSize, summary }>
   * or fetches individual entries. Using a streaming SELECT avoids any giant JSON buffer!
   */
  public loadAllCachedSummaries(): Map<string, { mtimeMs: number; fileSize: number; summary: PmsSummaryData }> {
    const out = new Map<string, { mtimeMs: number; fileSize: number; summary: PmsSummaryData }>();
    // iterate() streams rows one by one instead of materializing every JSON string at once
    const rows = this.db
      .prepare('SELECT path_key, mtime_ms, file_size, summary_json FROM pms_cache')
      .iterate() as Iterable<{
      path_key: string;
      mtime_ms: number;
      file_size: number;
      summary_json: string;
    }>;

    for (const r of rows) {
      try {
        out.set(r.path_key, {
          mtimeMs: r.mtime_ms,
          fileSize: r.file_size,
          summary: JSON.parse(r.summary_json) as PmsSummaryData,
        });
      } catch {
        // Skip corrupted row
      }
    }
    return out;
  }

  /**
   * Commits a batch of newly parsed PMS summaries inside a single fast WAL transaction.
   */
  public upsertBatch(
    items: Array<{ pathKey: string; mtimeMs: number; fileSize: number; summary: PmsSummaryData }>
  ): void {
    if (items.length === 0) return;
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO pms_cache (path_key, mtime_ms, file_size, summary_json) VALUES (?, ?, ?, ?)'
    );

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const item of items) {
        stmt.run(
          item.pathKey,
          item.mtimeMs,
          item.fileSize,
          JSON.stringify(item.summary)
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Removes cached summaries of files that disappeared from disk (keeps the cache from growing forever).
   */
  public deleteKeys(pathKeys: string[]): void {
    if (pathKeys.length === 0) return;
    const stmt = this.db.prepare('DELETE FROM pms_cache WHERE path_key = ?');
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const key of pathKeys) stmt.run(key);
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public close(): void {
    this.db.close();
  }
}
