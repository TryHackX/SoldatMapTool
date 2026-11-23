import path from 'node:path';

/** Identity of a physical path. Soldat asset references inside a PMS use their own case-folding rules. */
export function diskPathKey(file: string, platform: NodeJS.Platform = process.platform) {
  const resolved = path.resolve(file);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** One portable directory/file component derived from a user-visible label. */
export function portableSegment(name: string, fallback: string) {
  const value = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().replace(/[. ]+$/, '') || fallback;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? '_' + value : value;
}
