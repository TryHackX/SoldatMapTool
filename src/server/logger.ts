import fs from 'fs';
import path from 'path';
import { format } from 'util';

const KEEP_LOG_DAYS = 14;

/**
 * Mirrors console output into `data/logs/server-YYYY-MM-DD.log` (one file per day, last 14 days kept), so a
 * problem on the user's machine can be diagnosed after the console window was closed.
 * Console behaviour itself is unchanged; a failing log write never breaks the server.
 */
export function installFileLogger(logDir: string): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    pruneOldLogs(logDir);
  } catch {
    return; // read-only folder: keep logging to the console only
  }

  let currentDay = '';
  let stream: fs.WriteStream | null = null;

  const write = (level: string, args: unknown[]) => {
    const now = new Date();
    const day = localDay(now);
    try {
      if (day !== currentDay || !stream) {
        stream?.end();
        currentDay = day;
        stream = fs.createWriteStream(path.join(logDir, `server-${day}.log`), { flags: 'a' });
        stream.on('error', () => {
          stream = null; // e.g. disk full: stop writing until the next day / restart
        });
      }
      const time = now.toTimeString().slice(0, 8);
      stream.write(`${time} ${level} ${format(...args)}\n`);
    } catch {
      // Logging must never take the server down
    }
  };

  const wrap = (level: string, original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };

  console.log = wrap('INFO ', console.log.bind(console));
  console.info = wrap('INFO ', console.info.bind(console));
  console.warn = wrap('WARN ', console.warn.bind(console));
  console.error = wrap('ERROR', console.error.bind(console));

  // Observes fatal errors without changing Node's default crash behaviour
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    write('FATAL', [`${origin}:`, err instanceof Error ? err.stack ?? err.message : err]);
  });
}

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pruneOldLogs(logDir: string): void {
  const cutoff = Date.now() - KEEP_LOG_DAYS * 24 * 3600 * 1000;
  for (const name of fs.readdirSync(logDir)) {
    if (!/^server-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const full = path.join(logDir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    } catch {
      // Ignore a log file locked by another instance
    }
  }
}
