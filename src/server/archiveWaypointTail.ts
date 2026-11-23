import type { PmsSummaryData } from '../shared/pmsParser';

/** Recover a short final PMS section only when every field used by the game survived. */
export function completeWaypointTail(source: Buffer, summary: PmsSummaryData): Buffer {
  if (summary.version !== 11 || !summary.gameplayOffsets || summary.parseWarnings.length !== 1) return source;
  if (!/^(Missing|Damaged) section: bot waypoints\b/.test(summary.parseWarnings[0])) return source;
  const start = summary.gameplayOffsets.waypointCount;
  const available = source.length - start;
  // The count is little-endian and at most 5000. After two zero bytes its
  // remaining bytes are necessarily zero for a valid count with no records.
  if ((available === 2 || available === 3) && source.subarray(start).every(byte => byte === 0)) {
    return Buffer.concat([source, Buffer.alloc(4 - available)]);
  }
  if (available < 4) return source;
  const count = source.readInt32LE(start);
  if (count < 1 || count > 5000) return source;
  const last = start + 4 + (count - 1) * 112;
  const kept = source.length - last;
  if (kept < 32 || kept >= 112) return source;
  const connections = source.readInt32LE(last + 28);
  if (connections < 0 || connections > 20 || kept < 32 + connections * 4) return source;
  // The truncated suffix consists solely of slots beyond NumConnections in
  // the last declared record. No earlier row, active target or following row is invented.
  return Buffer.concat([source, Buffer.alloc(112 - kept)]);
}
