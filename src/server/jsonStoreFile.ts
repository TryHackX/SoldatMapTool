import fs from 'fs';
import { randomUUID } from 'node:crypto';

/**
 * Reads a small JSON store (user data, pack presets). Returns null only when the file does not exist.
 * Invalid JSON is preserved before falling back to an empty store. Filesystem errors
 * propagate so a temporary lock cannot turn existing preferences into an empty store.
 */
export function readJsonStoreFile(filePath: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    const backup = filePath + '.broken-' + randomUUID();
    fs.renameSync(filePath, backup);
    console.warn(`[Soldat Map Studio] Niepoprawny JSON. Zachowano oryginał w ${backup}`);
    return null;
  }
}
