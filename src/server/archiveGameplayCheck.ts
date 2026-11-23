import type { PmsSummaryData } from '../shared/pmsParser';

const transformFields = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;
const maxWaypoints = 5000;
const maxConnections = 20;

/** Read the original records. The editor parser omits nonpositive targets and cannot expose an invalid declared count. */
export function checkArchiveGameplay(bytes: Uint8Array, map: PmsSummaryData) {
  const issues: string[] = [];
  const invalidWaypointTargets: number[] = [];
  const offsets = map.gameplayOffsets;
  if (!offsets) throw new Error('Archive gameplay checks require PMS record offsets');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // MapFile.IsPropActive and MapGraphics use only active placements on layers 0..2 with a valid style.
  const transformExamples: string[] = [];
  let invalidProps = 0;
  for (let row = 0; row < map.propCount; row++) {
    const record = offsets.props + row * 44;
    if (!view.getUint8(record) || view.getUint8(record + 40) > 2) continue;
    const style = view.getUint16(record + 2, true);
    if (style === 0 || style > map.scenery.length) continue;
    for (let field = 0; field < transformFields.length; field++) {
      const value = view.getFloat32(record + 12 + 4 * field, true);
      if (Number.isFinite(value)) continue;
      invalidProps++;
      if (transformExamples.length < 3) transformExamples.push(`#${row + 1} ${transformFields[field]}=${value}`);
      break;
    }
  }
  if (invalidProps) issues.push(`Non-finite active scenery transforms (${invalidProps} placements): ${transformExamples.join(', ')}`);

  if (map.waypointCount > maxWaypoints) {
    issues.push(`Bot waypoints ${map.waypointCount} > ${maxWaypoints}`);
  } else {
    const countExamples: string[] = [];
    let invalidCounts = 0;
    for (let row = 0; row < map.waypointCount; row++) {
      const record = offsets.waypoints + row * 112;
      if (!view.getUint8(record)) continue;
      if (Math.abs(view.getInt32(record + 8, true)) >= 2_000_000
        || Math.abs(view.getInt32(record + 12, true)) >= 2_000_000) continue; // Disabled by PolyMap.LoadData.
      const count = view.getInt32(record + 28, true);
      if (count < 0 || count > maxConnections) {
        invalidCounts++;
        if (countExamples.length < 3) countExamples.push(`#${row + 1}=${count}`);
        continue;
      }
      // AI chooses a physical 1-based slot and skips zero. The stored waypoint id is not used for lookup.
      for (let slot = 0; slot < count; slot++) {
        const at = record + 32 + slot * 4;
        const target = view.getInt32(at, true);
        if (target < 0 || target > map.waypointCount) invalidWaypointTargets.push(at);
      }
    }
    if (invalidCounts) issues.push(`Invalid active bot waypoint connection counts (expected 0..20, ${invalidCounts} records): ${countExamples.join(', ')}`);
  }
  return { issues, invalidWaypointTargets };
}

/** Apply offsets collected from this exact immutable input before any table changes. Preserve choice weights and padding. */
export function clearInvalidWaypointTargets(source: Buffer, offsets: readonly number[]): Buffer {
  if (!offsets.length) return source;
  const output = Buffer.from(source);
  for (const offset of offsets) output.writeInt32LE(0, offset);
  return output;
}
