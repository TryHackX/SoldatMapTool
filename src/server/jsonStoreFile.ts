import fs from 'fs';

/**
 * Reads a small JSON store (user data, pack presets). Returns null only when the file does not exist.
 * A file that cannot be parsed (hand edit, UTF-8 BOM is tolerated) or read (locked by antivirus) is moved
 * aside as `<file>.broken-<time>` first, so the next save never silently destroys the user's data.
 */
export function readJsonStoreFile(filePath: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    preserveBrokenFile(filePath);
    return null;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    preserveBrokenFile(filePath);
    return null;
  }
}

function preserveBrokenFile(filePath: string): void {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
  try {
    fs.renameSync(filePath, `${filePath}.broken-${stamp}`);
    console.warn(`[Soldat Map Studio] Nie można odczytać ${filePath} — zachowano kopię jako .broken-${stamp}`);
  } catch {
    try {
      fs.copyFileSync(filePath, `${filePath}.broken-${stamp}`);
    } catch {
      // Nothing more can be done; the store starts empty
    }
  }
}
