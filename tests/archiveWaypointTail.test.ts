import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { parsePmsSummary, serializePms } from '../src/shared/pmsParser';
import { completeWaypointTail } from '../src/server/archiveWaypointTail';

const complete = (bytes: Buffer) => completeWaypointTail(bytes, parsePmsSummary(bytes, {inspectSectorReferences:true}));
test('a uniquely determined empty waypoint section can be completed from its two low bytes', () => {
  const map = createMapFromTemplate('arena');
  map.waypoints = [];
  const original = Buffer.from(serializePms(map));
  assert.deepEqual(complete(original.subarray(0,-2)),original);
  const noEvidence = original.subarray(0,-4);
  assert.equal(complete(noEvidence),noEvidence);
  const nonempty = Buffer.from(original.subarray(0,-2));
  nonempty.writeUInt16LE(1,nonempty.length-2);
  assert.equal(complete(nonempty),nonempty);
});
test('only unused slots in the last waypoint can be padded; missing active links and whole rows remain blocked', () => {
  const map = createMapFromTemplate('arena');
  map.waypoints = [];
  const empty = Buffer.from(serializePms(map));
  const bytes = Buffer.concat([empty,Buffer.alloc(112)]);
  bytes.writeInt32LE(1,empty.length-4);
  bytes[empty.length] = 1;
  bytes.writeInt32LE(2,empty.length+28);
  bytes.writeInt32LE(1,empty.length+32);
  bytes.writeInt32LE(1,empty.length+36);
  const truncated=bytes.subarray(0,empty.length+40);
  assert.deepEqual(complete(truncated),bytes);
  const missingLink=bytes.subarray(0,empty.length+39);
  assert.equal(complete(missingLink),missingLink);
  truncated.writeInt32LE(2,empty.length-4);
  assert.equal(complete(truncated),truncated);
});
