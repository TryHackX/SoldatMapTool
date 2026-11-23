import type { PmsSummaryData } from '../shared/pmsParser';

/** Keep every table slot. Change only fields whose effective state is already known. */
export function normalizeConfirmedDormantRecords(source: Buffer, map: PmsSummaryData) {
  const repairs: string[] = [];
  const offsets = map.gameplayOffsets;
  if (!offsets || map.version !== 11 || map.parseWarnings.length) return { bytes: source, repairs };
  let bytes = source;
  function writable() {
    if (bytes === source) bytes = Buffer.from(source);
    return bytes;
  }

  // MapFile.IsPropActive requires 1 <= Style <= scenery count. These placements
  // cannot render, even when an obsolete editor left their active flag set.
  let disabled = 0;
  if (map.invalidActivePropStyles) {
    for (let i = 0; i < map.propCount; i++) {
      const at = offsets.props + i * 44;
      const style = source.readUInt16LE(at + 2);
      if (source[at] && source[at + 40] <= 2 && (style === 0 || style > map.scenery.length)) {
        writable()[at] = 0;
        disabled++;
      }
    }
  }
  if (disabled) repairs.push('Disabled already unrenderable scenery placements with out-of-table styles: ' + disabled);

  // Even if the original count is unknown, no choice of prefix of the twenty
  // physical slots can lead to a waypoint if every slot is empty or out of range.
  let empty = 0;
  for (let row = 0; row < map.waypointCount; row++) {
    const at = offsets.waypoints + row * 112;
    if (!source[at] || Math.abs(source.readInt32LE(at + 8)) >= 2_000_000 ||
        Math.abs(source.readInt32LE(at + 12)) >= 2_000_000) continue;
    const count = source.readInt32LE(at + 28);
    if (count >= 0 && count <= 20) continue;
    let hasPossibleTarget = false;
    for (let slot = 0; slot < 20; slot++) {
      const target = source.readInt32LE(at + 32 + slot * 4);
      if (target >= 1 && target <= map.waypointCount) { hasPossibleTarget = true; break; }
    }
    if (!hasPossibleTarget) {
      writable().writeInt32LE(0, at + 28);
      empty++;
    }
  }
  if (empty) repairs.push('Reset invalid counts on waypoint rows with no possible outgoing target: ' + empty);
  return { bytes, repairs };
}
