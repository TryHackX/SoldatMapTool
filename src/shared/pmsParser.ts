import { RgbaColor } from './soldatConstants';

export interface PmsBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PmsVertex {
  x: number;
  y: number;
  z: number;
  rhw: number;
  color: RgbaColor;
  u: number;
  v: number;
}

export interface PmsVec3 {
  x: number;
  y: number;
  z: number;
}

export interface PmsPolygon {
  vertices: [PmsVertex, PmsVertex, PmsVertex];
  normals: [PmsVec3, PmsVec3, PmsVec3];
  polyType: number;
  bounciness: number;
  raw?: Uint8Array; // Original 121-byte record (full parser only): re-saved verbatim while unchanged
}

export interface PmsProp {
  index: number;
  active: boolean;
  style: number; // 1-based index into scenery[]
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  color: RgbaColor;
  level: number; // 0 = Back, 1 = Middle, 2 = Front
  raw?: Uint8Array; // Original 44-byte record (full parser only): re-saved verbatim while the fields are unchanged
}

export interface PmsSceneryDef {
  index: number; // 1-based style index
  filename: string;
  date: number;
  usedCount: number;
  raw?: Uint8Array; // Original 55-byte record (full parser only)
}

export interface PmsCollider {
  index: number;
  active: boolean;
  x: number;
  y: number;
  radius: number; // Stored in PMS as diameter (editor radius = radius / 2, bullet radius = radius / 1.7)
  raw?: Uint8Array; // Original 16-byte record (full parser only)
}

export interface PmsSpawnpoint {
  index: number;
  active: boolean;
  x: number;
  y: number;
  team: number;
  raw?: Uint8Array; // Original 16-byte record (full parser only)
}

export interface PmsWaypoint {
  index: number;
  active: boolean;
  id: number;
  x: number;
  y: number;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jetpack: boolean;
  pathNum: number;
  action: number;
  c2?: number;
  c3?: number;
  connections: number[];
  raw?: Uint8Array; // Original 112-byte record (full parser only)
}

export interface PmsMapData {
  version: number;
  mapName: string;
  texture: string;
  bgColorTop: RgbaColor;
  bgColorBtm: RgbaColor;
  startJet: number;
  startJetGame: number;
  grenadePacks: number;
  medikits: number;
  weather: number;
  steps: number;
  randomId: number;
  rawHeader?: Uint8Array; // Original 88-byte PMS header (full parser only)
  rawTail?: Uint8Array; // Bytes after the waypoints (many PolyWorks maps end with padding), written back on save
  sectorsDivision: number;
  sectorsNum: number;
  sectorsPolys?: Uint16Array[];
  polygons: PmsPolygon[];
  props: PmsProp[];
  scenery: PmsSceneryDef[];
  colliders: PmsCollider[];
  spawnpoints: PmsSpawnpoint[];
  waypoints: PmsWaypoint[];
  polyBounds: PmsBounds;
  fullBounds: PmsBounds;
  crc32: number;
  parseWarnings: string[];
}

/**
 * Hard limits enforced by Soldat / OpenSoldat when loading a map (shared/PolyMap.pas, MapFile.pas).
 * A map exceeding any of them is rejected by the game ("map not found / corrupted").
 */
export const SOLDAT_MAP_LIMITS = {
  maxPolys: 5000,
  maxSectorsNum: 25,
  maxProps: 500,
  maxScenery: 500,
  maxColliders: 128,
  maxSpawnpoints: 255,
} as const;

export interface MapLimitViolation {
  key: keyof typeof SOLDAT_MAP_LIMITS;
  value: number;
  limit: number;
  label: string;
}

/**
 * Lists every Soldat engine limit a map exceeds (counts are the raw table sizes, exactly as the game checks them).
 */
export function checkSoldatMapLimits(counts: {
  polygonCount: number;
  sectorsNum: number;
  propCount: number;
  sceneryCount: number;
  colliderCount: number;
  spawnCount: number;
}): MapLimitViolation[] {
  const out: MapLimitViolation[] = [];
  const push = (key: keyof typeof SOLDAT_MAP_LIMITS, value: number, label: string) => {
    const limit = SOLDAT_MAP_LIMITS[key];
    if (value > limit) out.push({ key, value, limit, label });
  };
  // English labels; the UI and the server translate them
  push('maxPolys', counts.polygonCount, 'Polygons');
  push('maxSectorsNum', counts.sectorsNum, 'Sector grid');
  push('maxProps', counts.propCount, 'Sceneries (props)');
  push('maxScenery', counts.sceneryCount, 'Scenery entries');
  push('maxColliders', counts.colliderCount, 'Colliders');
  push('maxSpawnpoints', counts.spawnCount, 'Spawn points');
  return out;
}

export interface PmsSummaryData {
  version: number;
  mapName: string;
  texture: string;
  bgColorTop: RgbaColor;
  bgColorBtm: RgbaColor;
  startJet: number;
  startJetGame: number;
  grenadePacks: number;
  medikits: number;
  weather: number;
  steps: number;
  randomId: number;
  sectorsDivision: number;
  sectorsNum: number;
  polygonCount: number;
  polyTypeCounts: Record<number, number>;
  propCount: number;
  activePropCount: number;
  propLevelCounts: [number, number, number];
  scenery: PmsSceneryDef[];
  colliderCount: number;
  activeColliderCount: number;
  spawnCount: number;
  activeSpawnCount: number;
  spawnTeamCounts: Record<number, number>;
  waypointCount: number;
  activeWaypointCount: number;
  polyBounds: PmsBounds;
  fullBounds: PmsBounds;
  crc32: number;
  parseWarnings: string[];
}

// OpenSoldat custom CRC32 table (polynomial 0x04C11DB7, MSB-first)
const OPEN_SOLDAT_CRC_TABLE = new Uint32Array([
  0x00000000,0x04c11db7,0x09823b6e,0x0d4326d9,0x130476dc,0x17c56b6b,0x1a864db2,0x1e475005,
  0x2608edb8,0x22c9f00f,0x2f8ad6d6,0x2b4bcb61,0x350c9b64,0x31cd86d3,0x3c8ea00a,0x384fbdbd,
  0x4c11db70,0x48d0c6c7,0x4593e01e,0x4152fda9,0x5f15adac,0x5bd4b01b,0x569796c2,0x52568b75,
  0x6a1936c8,0x6ed82b7f,0x639b0da6,0x675a1011,0x791d4014,0x7ddc5da3,0x709f7b7a,0x745e66cd,
  0x9823b6e0,0x9ce2ab57,0x91a18d8e,0x95609039,0x8b27c03c,0x8fe6dd8b,0x82a5fb52,0x8664e6e5,
  0xbe2b5b58,0xbaea46ef,0xb7a96036,0xb3687d81,0xad2f2d84,0xa9ee3033,0xa4ad16ea,0xa06c0b5d,
  0xd4326d90,0xd0f37027,0xddb056fe,0xd9714b49,0xc7361b4c,0xc3f706fb,0xceb42022,0xca753d95,
  0xf23a8028,0xf6fb9d9f,0xfbb8bb46,0xff79a6f1,0xe13ef6f4,0xe5ffeb43,0xe8bccd9a,0xec7dd02d,
  0x34867077,0x30476dc0,0x3d044b19,0x39c556ae,0x278206ab,0x23431b1c,0x2e003dc5,0x2ac12072,
  0x128e9dcf,0x164f8078,0x1b0ca6a1,0x1fcdbb16,0x018aeb13,0x054bf6a4,0x0808d07d,0x0cc9cdca,
  0x7897ab07,0x7c56b6b0,0x71159069,0x75d48dde,0x6b93dddb,0x6f52c06c,0x6211e6b5,0x66d0fb02,
  0x5e9f46bf,0x5a5e5b08,0x571d7dd1,0x53dc6066,0x4d9b3063,0x495a2dd4,0x44190b0d,0x40d816ba,
  0xaca5c697,0xa864db20,0xa527fdf9,0xa1e6e04e,0xbfa1b04b,0xbb60adfc,0xb6238b25,0xb2e29692,
  0x8aad2b2f,0x8e6c3698,0x832f1041,0x87ee0df6,0x99a95df3,0x9d684044,0x902b669d,0x94ea7b2a,
  0xe0b41de7,0xe4750050,0xe9362689,0xedf73b3e,0xf3b06b3b,0xf771768c,0xfa325055,0xfef34de2,
  0xc6bcf05f,0xc27dede8,0xcf3ecb31,0xcbffd686,0xd5b88683,0xd1799b34,0xdc3abded,0xd8fba05a,
  0x690ce0ee,0x6dcdfd59,0x608edb80,0x644fc637,0x7a089632,0x7ec98b85,0x738aad5c,0x774bb0eb,
  0x4f040d56,0x4bc510e1,0x46863638,0x42472b8f,0x5c007b8a,0x58c1663d,0x558240e4,0x51435d53,
  0x251d3b9e,0x21dc2629,0x2c9f00f0,0x285e1d47,0x36194d42,0x32d850f5,0x3f9b762c,0x3b5a6b9b,
  0x0315d626,0x07d4cb91,0x0a97ed48,0x0e56f0ff,0x1011a0fa,0x14d0bd4d,0x19939b94,0x1d528623,
  0xf12f560e,0xf5ee4bb9,0xf8ad6d60,0xfc6c70d7,0xe22b20d2,0xe6ea3d65,0xeba91bbc,0xef68060b,
  0xd727bbb6,0xd3e6a601,0xdea580d8,0xda649d6f,0xc423cd6a,0xc0e2d0dd,0xcda1f604,0xc960ebb3,
  0xbd3e8d7e,0xb9ff90c9,0xb4bcb610,0xb07daba7,0xae3afba2,0xaafbe615,0xa7b8c0cc,0xa379dd7b,
  0x9b3660c6,0x9ff77d71,0x92b45ba8,0x9675461f,0x8832161a,0x8cf30bad,0x81b02d74,0x857130c3,
  0x5d8a9099,0x594b8d2e,0x5408abf7,0x50c9b640,0x4e8ee645,0x4a4ffbf2,0x470cdd2b,0x43cdc09c,
  0x7b827d21,0x7f436096,0x7200464f,0x76c15bf8,0x68860bfd,0x6c47164a,0x61043093,0x65c52d24,
  0x119b4be9,0x155a565e,0x18197087,0x1cd86d30,0x029f3d35,0x065e2082,0x0b1d065b,0x0fdc1bec,
  0x3793a651,0x3352bbe6,0x3e119d3f,0x3ad08088,0x2497d08d,0x2056cd3a,0x2d15ebe3,0x29d4f654,
  0xc5a92679,0xc1683bce,0xcc2b1d17,0xc8ea00a0,0xd6ad50a5,0xd26c4d12,0xdf2f6bcb,0xdbee767c,
  0xe3a1cbc1,0xe760d676,0xea23f0af,0xeee2ed18,0xf0a5bd1d,0xf464a0aa,0xf9278673,0xfde69bc4,
  0x89b8fd09,0x8d79e0be,0x803ac667,0x84fbdbd0,0x9abc8bd5,0x9e7d9662,0x933eb0bb,0x97ffad0c,
  0xafb010b1,0xab710d06,0xa6322bdf,0xa2f33668,0xbcb4666d,0xb8757bda,0xb5365d03,0xb1f740b4,
]);

export function soldatCrc32(bytes: Uint8Array): number {
  let crc = 5381 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (OPEN_SOLDAT_CRC_TABLE[(bytes[i] ^ ((crc >>> 24) & 0xff)) & 0xff] ^ (crc << 8)) >>> 0;
  }
  return crc >>> 0;
}

const win1250Decoder = (() => {
  try {
    return new TextDecoder('windows-1250');
  } catch {
    return new TextDecoder('iso-8859-1');
  }
})();

// Exact reverse of win1250Decoder for all 256 byte values, so decode -> encode of any
// PMS string (scenery filenames with Czech/German/Polish letters etc.) is byte-for-byte lossless.
const WIN1250_ENCODE_MAP: Map<number, number> = (() => {
  const map = new Map<number, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = win1250Decoder.decode(new Uint8Array([b]));
    if (ch.length === 1) {
      const code = ch.charCodeAt(0);
      if (code !== 0xfffd && !map.has(code)) map.set(code, b);
    }
  }
  return map;
})();

/**
 * Decodes a ShortString[maxSize] stored at `off` (length byte + fixed buffer), stopping at NUL.
 */
function decodeShortString(bytes: Uint8Array, off: number, maxSize: number): string {
  if (off >= bytes.byteLength) return '';
  const n = Math.min(bytes[off], maxSize);
  const start = off + 1;
  if (n <= 0 || start >= bytes.byteLength) return '';
  const end = Math.min(start + n, bytes.byteLength);
  let actualEnd = start;
  while (actualEnd < end && bytes[actualEnd] !== 0) {
    actualEnd++;
  }
  if (actualEnd <= start) return '';
  return win1250Decoder.decode(bytes.subarray(start, actualEnd));
}

function finiteFloat(view: DataView, off: number): number {
  const v = view.getFloat32(off, true);
  return Number.isFinite(v) ? v : 0;
}

/**
 * One 44-byte TMapProp record (MapFile.pas: Active, pad, Style, Width, Height, x, y, Rotation,
 * ScaleX, ScaleY, Alpha, pad[3], Color BGRA, Level, pad[3]).
 */
function decodePropRecord(view: DataView, off: number): Omit<PmsProp, 'index' | 'raw'> {
  return {
    active: view.getUint8(off) !== 0,
    style: view.getUint16(off + 2, true),
    width: view.getInt32(off + 4, true),
    height: view.getInt32(off + 8, true),
    x: finiteFloat(view, off + 12),
    y: finiteFloat(view, off + 16),
    rotation: finiteFloat(view, off + 20),
    scaleX: finiteFloat(view, off + 24),
    scaleY: finiteFloat(view, off + 28),
    alpha: view.getUint8(off + 32),
    color: {
      b: view.getUint8(off + 36),
      g: view.getUint8(off + 37),
      r: view.getUint8(off + 38),
      a: view.getUint8(off + 39),
    },
    level: view.getUint8(off + 40),
  };
}

/**
 * True when `p` still holds exactly the values decoded from its original record, so the original bytes
 * (including padding garbage and non-finite floats read as 0) can be written back verbatim.
 */
function propMatchesRawRecord(p: PmsProp): boolean {
  const raw = p.raw;
  if (!raw || raw.byteLength !== 44) return false;
  const d = decodePropRecord(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), 0);
  return (
    d.active === p.active &&
    d.style === p.style &&
    d.width === p.width &&
    d.height === p.height &&
    d.x === p.x &&
    d.y === p.y &&
    d.rotation === p.rotation &&
    d.scaleX === p.scaleX &&
    d.scaleY === p.scaleY &&
    d.alpha === p.alpha &&
    d.color.r === p.color?.r &&
    d.color.g === p.color?.g &&
    d.color.b === p.color?.b &&
    d.color.a === p.color?.a &&
    d.level === p.level
  );
}

function sceneryMatchesRawRecord(s: PmsSceneryDef): boolean {
  const raw = s.raw;
  if (!raw || raw.byteLength !== 55) return false;
  const date = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(51, true);
  return date === s.date && decodeShortString(raw, 0, 50) === s.filename;
}

function decodeHeaderRecord(raw: Uint8Array): {
  version: number;
  mapName: string;
  texture: string;
  bgColorTop: RgbaColor;
  bgColorBtm: RgbaColor;
  startJet: number;
  grenadePacks: number;
  medikits: number;
  weather: number;
  steps: number;
  randomId: number;
} {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return {
    version: view.getInt32(0, true),
    mapName: decodeShortString(raw, 4, 38),
    texture: decodeShortString(raw, 43, 24),
    bgColorTop: {
      b: view.getUint8(68),
      g: view.getUint8(69),
      r: view.getUint8(70),
      a: view.getUint8(71),
    },
    bgColorBtm: {
      b: view.getUint8(72),
      g: view.getUint8(73),
      r: view.getUint8(74),
      a: view.getUint8(75),
    },
    startJet: view.getInt32(76, true),
    grenadePacks: view.getUint8(80),
    medikits: view.getUint8(81),
    weather: view.getUint8(82),
    steps: view.getUint8(83),
    randomId: view.getInt32(84, true),
  };
}

function decodeVertexAt(view: DataView, off: number): PmsVertex {
  return {
    x: finiteFloat(view, off),
    y: finiteFloat(view, off + 4),
    z: finiteFloat(view, off + 8),
    rhw: finiteFloat(view, off + 12),
    color: {
      b: view.getUint8(off + 16),
      g: view.getUint8(off + 17),
      r: view.getUint8(off + 18),
      a: view.getUint8(off + 19),
    },
    u: finiteFloat(view, off + 20),
    v: finiteFloat(view, off + 24),
  };
}

function decodeVec3At(view: DataView, off: number): PmsVec3 {
  return {
    x: finiteFloat(view, off),
    y: finiteFloat(view, off + 4),
    z: finiteFloat(view, off + 8),
  };
}

function decodePolygonRecord(view: DataView, off: number): Omit<PmsPolygon, 'raw'> {
  const v0 = decodeVertexAt(view, off);
  const v1 = decodeVertexAt(view, off + 28);
  const v2 = decodeVertexAt(view, off + 56);
  const n0 = decodeVec3At(view, off + 84);
  const n1 = decodeVec3At(view, off + 96);
  const n2 = decodeVec3At(view, off + 108);
  const polyType = view.getUint8(off + 120);
  return {
    vertices: [v0, v1, v2],
    normals: [n0, n1, n2],
    polyType,
    bounciness: Math.hypot(n2.x, n2.y),
  };
}

function polygonMatchesRawRecord(p: PmsPolygon): boolean {
  const raw = p.raw;
  if (!raw || raw.byteLength !== 121) return false;
  const d = decodePolygonRecord(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), 0);
  if (d.polyType !== p.polyType) return false;
  if (Math.abs(d.bounciness - p.bounciness) > 1e-6) return false;
  for (let k = 0; k < 3; k++) {
    const dv = d.vertices[k];
    const pv = p.vertices[k];
    if (
      dv.x !== pv.x ||
      dv.y !== pv.y ||
      dv.z !== pv.z ||
      dv.rhw !== pv.rhw ||
      dv.u !== pv.u ||
      dv.v !== pv.v ||
      dv.color.r !== pv.color.r ||
      dv.color.g !== pv.color.g ||
      dv.color.b !== pv.color.b ||
      dv.color.a !== pv.color.a
    ) {
      return false;
    }
    const dn = d.normals[k];
    const pn = p.normals[k];
    if (dn.x !== pn.x || dn.y !== pn.y || dn.z !== pn.z) {
      return false;
    }
  }
  return true;
}

// The polygon list each sector table was read or compiled for, so a save can tell whether the table still fits
const sectorTableOwners = new WeakMap<Uint16Array[], ReadonlyArray<PmsPolygon>>();

export function registerSectorTable(
  sectors: Uint16Array[] | undefined,
  polygons: ReadonlyArray<PmsPolygon>
): void {
  if (sectors) sectorTableOwners.set(sectors, polygons);
}

export function sectorTablePolygons(sectors: Uint16Array[] | undefined): ReadonlyArray<PmsPolygon> | null {
  return sectors ? sectorTableOwners.get(sectors) ?? null : null;
}

/**
 * True when the polygon's collision data (vertex positions, type, bounciness, normals) still equals its file
 * record, so its stored normals stay valid even if colours or texture coordinates were edited.
 */
export function polygonCollisionMatchesRaw(p: PmsPolygon): boolean {
  const raw = p.raw;
  if (!raw || raw.byteLength !== 121) return false;
  const d = decodePolygonRecord(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), 0);
  if (d.polyType !== p.polyType || Math.abs(d.bounciness - p.bounciness) > 1e-6) return false;
  for (let k = 0; k < 3; k++) {
    const dv = d.vertices[k];
    const pv = p.vertices[k];
    if (dv.x !== pv.x || dv.y !== pv.y) return false;
    const dn = d.normals[k];
    const pn = p.normals[k];
    if (dn.x !== pn.x || dn.y !== pn.y || dn.z !== pn.z) return false;
  }
  return true;
}

function decodeColliderRecord(view: DataView, off: number): Omit<PmsCollider, 'index' | 'raw'> {
  return {
    active: view.getUint8(off) !== 0,
    x: finiteFloat(view, off + 4),
    y: finiteFloat(view, off + 8),
    radius: finiteFloat(view, off + 12),
  };
}

function colliderMatchesRawRecord(c: PmsCollider): boolean {
  const raw = c.raw;
  if (!raw || raw.byteLength !== 16) return false;
  const d = decodeColliderRecord(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), 0);
  return d.active === c.active && d.x === c.x && d.y === c.y && d.radius === c.radius;
}

function decodeSpawnRecord(view: DataView, off: number): Omit<PmsSpawnpoint, 'index' | 'raw'> {
  let active = view.getUint8(off) !== 0;
  const x = view.getInt32(off + 4, true);
  const y = view.getInt32(off + 8, true);
  const team = view.getInt32(off + 12, true);
  if (Math.abs(x) >= 2000000 || Math.abs(y) >= 2000000) {
    active = false;
  }
  return { active, x, y, team };
}

function spawnMatchesRawRecord(sp: PmsSpawnpoint): boolean {
  const raw = sp.raw;
  if (!raw || raw.byteLength !== 16) return false;
  const d = decodeSpawnRecord(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), 0);
  return d.active === sp.active && d.x === sp.x && d.y === sp.y && d.team === sp.team;
}

function decodeWaypointRecord(view: DataView, off: number): Omit<PmsWaypoint, 'index' | 'raw'> {
  let active = view.getUint8(off) !== 0;
  const id = view.getInt32(off + 4, true);
  const x = view.getInt32(off + 8, true);
  const y = view.getInt32(off + 12, true);
  const left = view.getUint8(off + 16) !== 0;
  const right = view.getUint8(off + 17) !== 0;
  const up = view.getUint8(off + 18) !== 0;
  const down = view.getUint8(off + 19) !== 0;
  const jetpack = view.getUint8(off + 20) !== 0;
  const pathNum = view.getUint8(off + 21);
  const action = view.getUint8(off + 22);
  const c2 = view.getUint8(off + 23);
  const c3 = view.getUint8(off + 24);
  const connectionsNum = view.getInt32(off + 28, true);
  const connections: number[] = [];
  for (let j = 0; j < 20; j++) {
    const conn = view.getInt32(off + 32 + j * 4, true);
    if (j < connectionsNum && conn > 0) {
      connections.push(conn);
    }
  }
  if (Math.abs(x) >= 2000000 || Math.abs(y) >= 2000000) {
    active = false;
  }
  return {
    active,
    id,
    x,
    y,
    left,
    right,
    up,
    down,
    jetpack,
    pathNum,
    action,
    c2,
    c3,
    connections,
  };
}

function waypointMatchesRawRecord(wp: PmsWaypoint): boolean {
  const raw = wp.raw;
  if (!raw || raw.byteLength !== 112) return false;
  const d = decodeWaypointRecord(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), 0);
  if (
    d.active !== wp.active ||
    d.id !== wp.id ||
    d.x !== wp.x ||
    d.y !== wp.y ||
    d.left !== wp.left ||
    d.right !== wp.right ||
    d.up !== wp.up ||
    d.down !== wp.down ||
    d.jetpack !== wp.jetpack ||
    d.pathNum !== wp.pathNum ||
    d.action !== wp.action ||
    (wp.c2 ?? d.c2) !== d.c2 ||
    (wp.c3 ?? d.c3) !== d.c3 ||
    d.connections.length !== wp.connections.length
  ) {
    return false;
  }
  for (let i = 0; i < d.connections.length; i++) {
    if (d.connections[i] !== wp.connections[i]) return false;
  }
  return true;
}

class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  public pos = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.bytes = buffer;
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  get rawBytes(): Uint8Array {
    return this.bytes;
  }

  get dataView(): DataView {
    return this.view;
  }

  skip(count: number): void {
    this.pos += count;
  }

  readUint8(): number {
    if (this.pos + 1 > this.bytes.byteLength) return 0;
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readUint16(): number {
    if (this.pos + 2 > this.bytes.byteLength) {
      this.pos = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt32(): number {
    if (this.pos + 4 > this.bytes.byteLength) {
      this.pos = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readFloat32(): number {
    if (this.pos + 4 > this.bytes.byteLength) {
      this.pos = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return Number.isFinite(v) ? v : 0;
  }

  /**
   * Pascal fixed-buffer ShortString from MapFile.pas:
   * 1 byte length `n`, followed by `maxSize` bytes fixed buffer.
   * A corrupted length larger than the buffer is clamped (like the game), not discarded.
   */
  readString(maxSize: number): string {
    const text = decodeShortString(this.bytes, this.pos, maxSize);
    this.pos += 1 + maxSize;
    return text;
  }

  /**
   * PMS stores D3DCOLOR little-endian: [B, G, R, A]
   */
  readColor(): RgbaColor {
    const b = this.readUint8();
    const g = this.readUint8();
    const r = this.readUint8();
    const a = this.readUint8();
    return { r, g, b, a };
  }
}

/**
 * Generic OpenSoldat GfxMat3Transform quad corners:
 * m = T(tx,ty) * T(cx,cy) * R(r) * T(-cx,-cy) * S(sx,sy)
 */
export function computeTransformCorners(
  tx: number,
  ty: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  r: number
): [number, number, number, number, number, number, number, number] {
  const c = Math.cos(r);
  const s = Math.sin(r);

  const m0 = c * sx;
  const m3 = -s * sy;
  const m6 = tx + cy * s - c * cx + cx;
  const m1 = s * sx;
  const m4 = c * sy;
  const m7 = ty - cx * s - c * cy + cy;

  const x0 = m6;
  const y0 = m7;
  const x1 = m0 * w + m6;
  const y1 = m1 * w + m7;
  const x2 = m0 * w + m3 * h + m6;
  const y2 = m1 * w + m4 * h + m7;
  const x3 = m3 * h + m6;
  const y3 = m4 * h + m7;

  return [x0, y0, x1, y1, x2, y2, x3, y3];
}

/**
 * Computes transformed quad corners of a Soldat prop matching GfxMat3Transform(x, y, sx, sy, 0, 1, -rotation)
 */
export function computePropCorners(
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  rotation: number
): [number, number, number, number, number, number, number, number] {
  return computeTransformCorners(x, y, w, h, sx, sy, 0, 1, -rotation);
}

// Props farther than this from the origin hold garbage coordinates (e.g. x = -2^63 in ctf_LaaF-Run) and are
// never on screen; map bounds and scenery merging ignore them
export const PROP_COORD_LIMIT = 200000;

/** World-space bounding box of a prop's quad (zero width/height counts as 64, as everywhere in the app) */
export function computePropAabb(p: PmsProp): PmsBounds {
  const w = p.width !== 0 ? p.width : 64;
  const h = p.height !== 0 ? p.height : 64;
  const corners = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const cx = corners[i];
    const cy = corners[i + 1];
    if (cx < left) left = cx;
    if (cx > right) right = cx;
    if (cy < top) top = cy;
    if (cy > bottom) bottom = cy;
  }
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function isPropAabbOnMap(b: PmsBounds): boolean {
  return (
    Math.abs(b.left) < PROP_COORD_LIMIT &&
    Math.abs(b.right) < PROP_COORD_LIMIT &&
    Math.abs(b.top) < PROP_COORD_LIMIT &&
    Math.abs(b.bottom) < PROP_COORD_LIMIT
  );
}

function finalizeBounds(left: number, right: number, top: number, bottom: number): PmsBounds {
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return { left: -320, right: 320, top: -240, bottom: 240, width: 640, height: 480 };
  }
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  return { left, right, top, bottom, width: w, height: h };
}

/**
 * Full PMS parser returning complete geometry, props, colliders, spawns & waypoints.
 */
export function parsePmsFull(input: ArrayBuffer | Uint8Array): PmsMapData {
  const br = new BinaryReader(input);

  const version = br.readInt32();
  const mapName = br.readString(38);
  const texture = br.readString(24);
  const bgColorTop = br.readColor();
  const bgColorBtm = br.readColor();
  const startJet = br.readInt32();
  const grenadePacks = br.readUint8();
  const medikits = br.readUint8();
  const weather = br.readUint8();
  const steps = br.readUint8();
  const randomId = br.readInt32();

  const polyCount = br.readInt32();
  if (polyCount < 0 || polyCount > 100000) {
    throw new Error(`Invalid polygon count: ${polyCount}`);
  }
  if (br.pos + polyCount * POLYGON_RECORD_SIZE > br.length) {
    throw new Error(`Truncated PMS file: polygon table needs ${polyCount * POLYGON_RECORD_SIZE} bytes`);
  }

  let pLeft = Infinity;
  let pRight = -Infinity;
  let pTop = Infinity;
  let pBottom = -Infinity;
  const parseWarnings: string[] = [];

  const polygons: PmsPolygon[] = new Array(polyCount);
  for (let i = 0; i < polyCount; i++) {
    const polyOff = br.pos;
    const v1 = readVertex(br);
    const v2 = readVertex(br);
    const v3 = readVertex(br);
    const n1 = readVec3(br);
    const n2 = readVec3(br);
    const n3 = readVec3(br);
    const polyType = br.readUint8();
    const bounciness = Math.hypot(n3.x, n3.y);

    if (Math.abs(v1.x) < 1e6 && Math.abs(v1.y) < 1e6) {
      if (v1.x < pLeft) pLeft = v1.x;
      if (v1.x > pRight) pRight = v1.x;
      if (v1.y < pTop) pTop = v1.y;
      if (v1.y > pBottom) pBottom = v1.y;
    }
    if (Math.abs(v2.x) < 1e6 && Math.abs(v2.y) < 1e6) {
      if (v2.x < pLeft) pLeft = v2.x;
      if (v2.x > pRight) pRight = v2.x;
      if (v2.y < pTop) pTop = v2.y;
      if (v2.y > pBottom) pBottom = v2.y;
    }
    if (Math.abs(v3.x) < 1e6 && Math.abs(v3.y) < 1e6) {
      if (v3.x < pLeft) pLeft = v3.x;
      if (v3.x > pRight) pRight = v3.x;
      if (v3.y < pTop) pTop = v3.y;
      if (v3.y > pBottom) pBottom = v3.y;
    }

    polygons[i] = {
      vertices: [v1, v2, v3],
      normals: [n1, n2, n3],
      polyType,
      bounciness,
      raw: br.rawBytes.subarray(polyOff, polyOff + POLYGON_RECORD_SIZE),
    };
  }

  // Sectors
  const sectorsDivision = br.readInt32();
  const sectorsNum = br.readInt32();
  if (sectorsNum < 0 || sectorsNum > 200) {
    throw new Error(`Invalid sectorsNum: ${sectorsNum}`);
  }
  const totalSectors = (2 * sectorsNum + 1) * (2 * sectorsNum + 1);
  const sectorsPolys: Uint16Array[] = new Array(totalSectors);
  for (let i = 0; i < totalSectors; i++) {
    const m = br.readUint16();
    const arr = new Uint16Array(m);
    for (let s = 0; s < m; s++) {
      arr[s] = br.readUint16();
    }
    sectorsPolys[i] = arr;
  }
  if (br.pos + 4 > br.length) {
    throw new Error('Truncated PMS file: sector table runs past end of file');
  }

  // Props
  const propCount = br.readInt32();
  if (propCount < 0 || propCount > 50000) {
    throw new Error(`Invalid prop count: ${propCount}`);
  }
  if (br.pos + propCount * PROP_RECORD_SIZE + 4 > br.length) {
    throw new Error(`Truncated PMS file: prop table needs ${propCount * PROP_RECORD_SIZE} bytes`);
  }
  const props: PmsProp[] = new Array(propCount);
  for (let i = 0; i < propCount; i++) {
    const off = br.pos;
    props[i] = {
      index: i,
      ...decodePropRecord(br.dataView, off),
      raw: br.rawBytes.subarray(off, off + PROP_RECORD_SIZE),
    };
    br.skip(PROP_RECORD_SIZE);
  }

  // Scenery definitions
  const sceneryCount = br.readInt32();
  if (sceneryCount < 0 || sceneryCount > 50000) {
    throw new Error(`Invalid scenery count: ${sceneryCount}`);
  }
  if (br.pos + sceneryCount * SCENERY_RECORD_SIZE > br.length) {
    throw new Error(`Truncated PMS file: scenery table needs ${sceneryCount * SCENERY_RECORD_SIZE} bytes`);
  }
  const scenery: PmsSceneryDef[] = new Array(sceneryCount);
  for (let i = 0; i < sceneryCount; i++) {
    const off = br.pos;
    const filename = br.readString(50);
    const date = br.readInt32();
    scenery[i] = {
      index: i + 1,
      filename,
      date,
      usedCount: 0,
      raw: br.rawBytes.subarray(off, off + SCENERY_RECORD_SIZE),
    };
  }

  let fLeft = pLeft;
  let fRight = pRight;
  let fTop = pTop;
  let fBottom = pBottom;

  // NOTE: invalid props keep their original `active` flag so a later lossless re-save never alters them;
  // every consumer must check isPropRenderable() instead of relying on `active` alone.
  for (let i = 0; i < propCount; i++) {
    const p = props[i];
    if (!isPropRenderable(p, sceneryCount)) continue;
    scenery[p.style - 1].usedCount++;
    if (Math.abs(p.x) < PROP_COORD_LIMIT && Math.abs(p.y) < PROP_COORD_LIMIT) {
      const w = p.width > 0 ? p.width : 64;
      const h = p.height > 0 ? p.height : 64;
      const corners = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
      for (let c = 0; c < 8; c += 2) {
        const cx = corners[c];
        const cy = corners[c + 1];
        if (Math.abs(cx) < PROP_COORD_LIMIT && Math.abs(cy) < PROP_COORD_LIMIT) {
          if (cx < fLeft) fLeft = cx;
          if (cx > fRight) fRight = cx;
          if (cy < fTop) fTop = cy;
          if (cy > fBottom) fBottom = cy;
        }
      }
    }
  }

  // Colliders
  const colliderCount = readTailSectionCount(br, COLLIDER_RECORD_SIZE, 10000, 'colliders', parseWarnings);
  const colliders: PmsCollider[] = [];
  if (colliderCount > 0) {
    for (let i = 0; i < colliderCount; i++) {
      const colOff = br.pos;
      const active = br.readUint8() !== 0;
      br.skip(3);
      const x = br.readFloat32();
      const y = br.readFloat32();
      const radius = br.readFloat32();
      colliders.push({
        index: i,
        active,
        x,
        y,
        radius,
        raw: br.rawBytes.subarray(colOff, colOff + COLLIDER_RECORD_SIZE),
      });
    }
  }

  // Spawnpoints
  const spawnCount =
    colliderCount < 0 ? -1 : readTailSectionCount(br, SPAWN_RECORD_SIZE, 10000, 'spawn points', parseWarnings);
  const spawnpoints: PmsSpawnpoint[] = [];
  if (spawnCount > 0) {
    for (let i = 0; i < spawnCount; i++) {
      const spOff = br.pos;
      let active = br.readUint8() !== 0;
      br.skip(3);
      const x = br.readInt32();
      const y = br.readInt32();
      const team = br.readInt32();
      if (Math.abs(x) >= 2000000 || Math.abs(y) >= 2000000) {
        active = false;
      }
      if (active) {
        if (x < fLeft) fLeft = x;
        if (x > fRight) fRight = x;
        if (y < fTop) fTop = y;
        if (y > fBottom) fBottom = y;
      }
      spawnpoints.push({
        index: i,
        active,
        x,
        y,
        team,
        raw: br.rawBytes.subarray(spOff, spOff + SPAWN_RECORD_SIZE),
      });
    }
  }

  // Waypoints
  const waypointCount =
    spawnCount < 0 ? -1 : readTailSectionCount(br, WAYPOINT_RECORD_SIZE, 20000, 'bot waypoints', parseWarnings);
  const waypoints: PmsWaypoint[] = [];
  if (waypointCount > 0) {
    for (let i = 0; i < waypointCount; i++) {
      const wpOff = br.pos;
      let active = br.readUint8() !== 0;
      br.skip(3);
      const id = br.readInt32();
      const x = br.readInt32();
      const y = br.readInt32();
      const left = br.readUint8() !== 0;
      const right = br.readUint8() !== 0;
      const up = br.readUint8() !== 0;
      const down = br.readUint8() !== 0;
      const jetpack = br.readUint8() !== 0;
      const pathNum = br.readUint8();
      const action = br.readUint8();
      const c2 = br.readUint8();
      const c3 = br.readUint8();
      br.skip(3);
      const connectionsNum = br.readInt32();
      const connections: number[] = [];
      for (let j = 0; j < 20; j++) {
        const conn = br.readInt32();
        if (j < connectionsNum && conn > 0) {
          connections.push(conn);
        }
      }
      if (Math.abs(x) >= 2000000 || Math.abs(y) >= 2000000) {
        active = false;
      }
      waypoints.push({
        index: i + 1,
        active,
        id,
        x,
        y,
        left,
        right,
        up,
        down,
        jetpack,
        pathNum,
        action,
        c2,
        c3,
        connections,
        raw: br.rawBytes.subarray(wpOff, wpOff + WAYPOINT_RECORD_SIZE),
      });
    }
  }

  const polyBounds = finalizeBounds(pLeft, pRight, pTop, pBottom);
  const fullBounds = finalizeBounds(fLeft, fRight, fTop, fBottom);
  // Only a fully parsed file has a meaningful tail (after a damaged section the rest is unread data)
  const tailBytes = br.length - br.pos;
  const rawTail =
    waypointCount >= 0 && tailBytes > 0 && tailBytes <= MAX_RAW_TAIL_BYTES
      ? br.rawBytes.subarray(br.pos, br.length)
      : undefined;
  registerSectorTable(sectorsPolys, polygons);

  return {
    version,
    mapName,
    texture,
    bgColorTop,
    bgColorBtm,
    startJet,
    startJetGame: Math.floor((119 * startJet) / 100),
    grenadePacks,
    medikits,
    weather,
    steps,
    randomId,
    rawHeader: br.length >= 88 ? br.rawBytes.subarray(0, 88) : undefined,
    rawTail,
    sectorsDivision,
    sectorsNum,
    sectorsPolys,
    polygons,
    props,
    scenery,
    colliders,
    spawnpoints,
    waypoints,
    polyBounds,
    fullBounds,
    crc32: soldatCrc32(br.rawBytes),
    parseWarnings,
  };
}

const POLYGON_RECORD_SIZE = 121;
const PROP_RECORD_SIZE = 44;
const SCENERY_RECORD_SIZE = 55;
const COLLIDER_RECORD_SIZE = 16;
const SPAWN_RECORD_SIZE = 16;
const WAYPOINT_RECORD_SIZE = 112;
const MAX_RAW_TAIL_BYTES = 4 * 1024 * 1024;

/**
 * True when Soldat actually draws the prop (MapGraphics.pas: Active, Level <= 2, valid 1-based Style).
 */
export function isPropRenderable(p: PmsProp, sceneryCount: number): boolean {
  return p.active && p.level <= 2 && p.style > 0 && p.style <= sceneryCount;
}

/**
 * Reads the record count of an optional trailing section (colliders / spawns / waypoints).
 * Returns -1 (and records a warning) when the section is missing or corrupted, which tells the
 * caller to stop parsing: every following section would be misaligned.
 */
function readTailSectionCount(
  br: BinaryReader,
  recordSize: number,
  sanityLimit: number,
  label: string,
  warnings: string[]
): number {
  if (br.pos + 4 > br.length) {
    warnings.push(`Missing section: ${label} (the file ends early)`);
    return -1;
  }
  const n = br.readInt32();
  if (n < 0 || n > sanityLimit || br.pos + n * recordSize > br.length) {
    warnings.push(`Damaged section: ${label} (record count ${n})`);
    return -1;
  }
  return n;
}

/**
 * Fast, low-allocation summary parser for indexing hundreds of PMS maps in milliseconds.
 */
export function parsePmsSummary(input: ArrayBuffer | Uint8Array): PmsSummaryData {
  const br = new BinaryReader(input);

  const version = br.readInt32();
  const mapName = br.readString(38);
  const texture = br.readString(24);
  const bgColorTop = br.readColor();
  const bgColorBtm = br.readColor();
  const startJet = br.readInt32();
  const grenadePacks = br.readUint8();
  const medikits = br.readUint8();
  const weather = br.readUint8();
  const steps = br.readUint8();
  const randomId = br.readInt32();

  const polygonCount = br.readInt32();
  if (polygonCount < 0 || polygonCount > 100000) {
    throw new Error(`Invalid polygon count: ${polygonCount}`);
  }
  if (br.pos + polygonCount * POLYGON_RECORD_SIZE > br.length) {
    throw new Error(`Truncated PMS file: polygon table needs ${polygonCount * POLYGON_RECORD_SIZE} bytes`);
  }

  let pLeft = Infinity;
  let pRight = -Infinity;
  let pTop = Infinity;
  let pBottom = -Infinity;
  const polyTypeCounts: Record<number, number> = {};
  const parseWarnings: string[] = [];

  for (let i = 0; i < polygonCount; i++) {
    for (let v = 0; v < 3; v++) {
      const vx = br.readFloat32();
      const vy = br.readFloat32();
      br.skip(20); // z(4) + rhw(4) + color(4) + u(4) + v(4)
      if (Math.abs(vx) < 1e6 && Math.abs(vy) < 1e6) {
        if (vx < pLeft) pLeft = vx;
        if (vx > pRight) pRight = vx;
        if (vy < pTop) pTop = vy;
        if (vy > pBottom) pBottom = vy;
      }
    }
    br.skip(36); // 3 normals
    const polyType = br.readUint8();
    polyTypeCounts[polyType] = (polyTypeCounts[polyType] || 0) + 1;
  }

  const sectorsDivision = br.readInt32();
  const sectorsNum = br.readInt32();
  if (sectorsNum < 0 || sectorsNum > 200) {
    throw new Error(`Invalid sectorsNum: ${sectorsNum}`);
  }
  const totalSectors = (2 * sectorsNum + 1) * (2 * sectorsNum + 1);
  for (let i = 0; i < totalSectors; i++) {
    const m = br.readUint16();
    br.skip(m * 2);
  }
  if (br.pos + 4 > br.length) {
    throw new Error('Truncated PMS file: sector table runs past end of file');
  }

  const propCount = br.readInt32();
  if (propCount < 0 || propCount > 50000) {
    throw new Error(`Invalid prop count: ${propCount}`);
  }
  if (br.pos + propCount * PROP_RECORD_SIZE + 4 > br.length) {
    throw new Error(`Truncated PMS file: prop table needs ${propCount * PROP_RECORD_SIZE} bytes`);
  }
  // Store lightweight prop tuples temporarily to validate against sceneryCount
  const rawProps: Array<{
    active: boolean;
    style: number;
    width: number;
    height: number;
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    level: number;
  }> = new Array(propCount);

  for (let i = 0; i < propCount; i++) {
    const active = br.readUint8() !== 0;
    br.skip(1);
    const style = br.readUint16();
    const width = br.readInt32();
    const height = br.readInt32();
    const x = br.readFloat32();
    const y = br.readFloat32();
    const rotation = br.readFloat32();
    const scaleX = br.readFloat32();
    const scaleY = br.readFloat32();
    br.skip(8); // alpha(1)+pad(3)+color(4)
    const level = br.readUint8();
    br.skip(3);
    rawProps[i] = { active, style, width, height, x, y, rotation, scaleX, scaleY, level };
  }

  const sceneryCount = br.readInt32();
  if (sceneryCount < 0 || sceneryCount > 50000) {
    throw new Error(`Invalid scenery count: ${sceneryCount}`);
  }
  if (br.pos + sceneryCount * SCENERY_RECORD_SIZE > br.length) {
    throw new Error(`Truncated PMS file: scenery table needs ${sceneryCount * SCENERY_RECORD_SIZE} bytes`);
  }
  const scenery: PmsSceneryDef[] = new Array(sceneryCount);
  for (let i = 0; i < sceneryCount; i++) {
    const filename = br.readString(50);
    const date = br.readInt32();
    scenery[i] = { index: i + 1, filename, date, usedCount: 0 };
  }

  let fLeft = pLeft;
  let fRight = pRight;
  let fTop = pTop;
  let fBottom = pBottom;
  let activePropCount = 0;
  const propLevelCounts: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < propCount; i++) {
    const p = rawProps[i];
    if (p.active && p.level <= 2 && p.style > 0 && p.style <= sceneryCount) {
      activePropCount++;
      propLevelCounts[p.level as 0 | 1 | 2]++;
      scenery[p.style - 1].usedCount++;
      if (Math.abs(p.x) < PROP_COORD_LIMIT && Math.abs(p.y) < PROP_COORD_LIMIT) {
        const w = p.width > 0 ? p.width : 64;
        const h = p.height > 0 ? p.height : 64;
        const corners = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
        for (let c = 0; c < 8; c += 2) {
          const cx = corners[c];
          const cy = corners[c + 1];
          if (Math.abs(cx) < PROP_COORD_LIMIT && Math.abs(cy) < PROP_COORD_LIMIT) {
            if (cx < fLeft) fLeft = cx;
            if (cx > fRight) fRight = cx;
            if (cy < fTop) fTop = cy;
            if (cy > fBottom) fBottom = cy;
          }
        }
      }
    }
  }

  const colliderSection = readTailSectionCount(br, COLLIDER_RECORD_SIZE, 10000, 'colliders', parseWarnings);
  const colliderCount = Math.max(0, colliderSection);
  let activeColliderCount = 0;
  if (colliderCount > 0) {
    for (let i = 0; i < colliderCount; i++) {
      const active = br.readUint8() !== 0;
      br.skip(15); // pad(3) + x(4) + y(4) + radius(4)
      if (active) activeColliderCount++;
    }
  }

  const spawnSection =
    colliderSection < 0 ? -1 : readTailSectionCount(br, SPAWN_RECORD_SIZE, 10000, 'spawn points', parseWarnings);
  const spawnCount = Math.max(0, spawnSection);
  let activeSpawnCount = 0;
  const spawnTeamCounts: Record<number, number> = {};
  if (spawnCount > 0) {
    for (let i = 0; i < spawnCount; i++) {
      let active = br.readUint8() !== 0;
      br.skip(3);
      const x = br.readInt32();
      const y = br.readInt32();
      const team = br.readInt32();
      if (Math.abs(x) >= 2000000 || Math.abs(y) >= 2000000) active = false;
      if (active) {
        activeSpawnCount++;
        spawnTeamCounts[team] = (spawnTeamCounts[team] || 0) + 1;
        if (x < fLeft) fLeft = x;
        if (x > fRight) fRight = x;
        if (y < fTop) fTop = y;
        if (y > fBottom) fBottom = y;
      }
    }
  }

  const waypointSection =
    spawnSection < 0
      ? -1
      : readTailSectionCount(br, WAYPOINT_RECORD_SIZE, 20000, 'bot waypoints', parseWarnings);
  const waypointCount = Math.max(0, waypointSection);
  let activeWaypointCount = 0;
  if (waypointCount > 0) {
    for (let i = 0; i < waypointCount; i++) {
      const active = br.readUint8() !== 0;
      br.skip(7); // pad(3) + id(4)
      const x = br.readInt32();
      const y = br.readInt32();
      br.skip(96); // remaining 112 - 16 bytes
      if (active && Math.abs(x) < 2000000 && Math.abs(y) < 2000000) {
        activeWaypointCount++;
      }
    }
  }

  return {
    version,
    mapName,
    texture,
    bgColorTop,
    bgColorBtm,
    startJet,
    startJetGame: Math.floor((119 * startJet) / 100),
    grenadePacks,
    medikits,
    weather,
    steps,
    randomId,
    sectorsDivision,
    sectorsNum,
    polygonCount,
    polyTypeCounts,
    propCount,
    activePropCount,
    propLevelCounts,
    scenery,
    colliderCount,
    activeColliderCount,
    spawnCount,
    activeSpawnCount,
    spawnTeamCounts,
    waypointCount,
    activeWaypointCount,
    polyBounds: finalizeBounds(pLeft, pRight, pTop, pBottom),
    fullBounds: finalizeBounds(fLeft, fRight, fTop, fBottom),
    crc32: soldatCrc32(br.rawBytes),
    parseWarnings,
  };
}

function readVertex(br: BinaryReader): PmsVertex {
  const x = br.readFloat32();
  const y = br.readFloat32();
  const z = br.readFloat32();
  const rhw = br.readFloat32();
  const color = br.readColor();
  const u = br.readFloat32();
  const v = br.readFloat32();
  return { x, y, z, rhw, color, u, v };
}

function readVec3(br: BinaryReader): PmsVec3 {
  return {
    x: br.readFloat32(),
    y: br.readFloat32(),
    z: br.readFloat32(),
  };
}

/**
 * Encodes a Pascal ShortString[maxSize] using the exact reverse of the windows-1250 decoder,
 * so every string read from a PMS file is written back byte-for-byte (no '?' substitutions).
 */
export function encodePascalShortString(str: string, maxSize: number): Uint8Array {
  const out = new Uint8Array(1 + maxSize);
  const clean = str || '';
  const len = Math.min(maxSize, clean.length);
  out[0] = len;
  for (let i = 0; i < len; i++) {
    const code = clean.charCodeAt(i);
    if (code < 0x80) {
      out[1 + i] = code;
    } else {
      out[1 + i] = WIN1250_ENCODE_MAP.get(code) ?? 0x3f; // '?' only for characters cp1250 cannot represent
    }
  }
  return out;
}

/**
 * Generates a derived map baseName with `_f` (fixed 1.7.1 sceneries), `_o` (optimized merged sceneries) or `_a`
 * (archive: merged sceneries plus the map's own copies of every file it uses).
 * If appending the suffix exceeds `maxBaseLength` (default 24 chars), trailing characters of the base name
 * are truncated before appending the suffix.
 * The result is guaranteed to differ (case-insensitively) from the source name, so a derived map can
 * never overwrite its own source (e.g. "ctf_x_f" -> "ctf_x_f_f" instead of "ctf_x_f").
 */
export type DerivedMapSuffix = '_f' | '_o' | '_f_o' | '_a' | '_f_a' | '_e';

export function makeDerivedMapName(
  baseName: string,
  suffix: DerivedMapSuffix,
  maxBaseLength = 24
): string {
  const safeMax = Math.max(6, Math.min(44, Math.floor(maxBaseLength || 24)));
  const source = baseName.replace(/\.pms$/i, '').trim();
  let stem = source || 'map';

  const maxStemLen = Math.max(1, safeMax - suffix.length);
  if (stem.length > maxStemLen) {
    stem = stem.slice(0, maxStemLen).replace(/_+$/, '');
    if (!stem) stem = source.slice(0, maxStemLen) || 'map';
  }
  let derived = `${stem}${suffix}`;
  if (derived.toLowerCase() === source.toLowerCase()) {
    // Only possible when the truncated stem collapses back onto the source; shorten one more char.
    const shorter = stem.slice(0, Math.max(1, stem.length - 1)).replace(/_+$/, '') || 'm';
    derived = `${shorter}${suffix}`;
  }
  return derived;
}

export function makeEditedMapName(baseName: string, maxBaseLength = 24): string {
  return makeDerivedMapName(baseName, '_e', maxBaseLength);
}

export function currentDosTimestamp(): number {
  const now = new Date();
  const year = Math.max(1980, now.getFullYear()) - 1980;
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = Math.floor(now.getSeconds() / 2);
  return (
    ((year & 0x7f) << 25) |
    ((month & 0x0f) << 21) |
    ((day & 0x1f) << 16) |
    ((hours & 0x1f) << 11) |
    ((minutes & 0x3f) << 5) |
    (seconds & 0x1f)
  );
}

function encodePropsAndSceneryBlock(
  props: PmsProp[],
  scenery: PmsSceneryDef[]
): Uint8Array {
  const byteLen = 4 + props.length * 44 + 4 + scenery.length * 55;
  const buf = new ArrayBuffer(byteLen);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let pos = 0;

  view.setInt32(pos, props.length, true);
  pos += 4;

  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (propMatchesRawRecord(p)) {
      bytes.set(p.raw!, pos); // untouched prop: byte-for-byte identical to the source file
      pos += 44;
      continue;
    }
    view.setUint8(pos, p.active ? 1 : 0);
    view.setUint8(pos + 1, 0);
    view.setUint16(pos + 2, Math.max(0, Math.min(65535, p.style || 0)), true);
    view.setInt32(pos + 4, Math.round(p.width || 0), true);
    view.setInt32(pos + 8, Math.round(p.height || 0), true);
    view.setFloat32(pos + 12, Number.isFinite(p.x) ? p.x : 0, true);
    view.setFloat32(pos + 16, Number.isFinite(p.y) ? p.y : 0, true);
    view.setFloat32(pos + 20, Number.isFinite(p.rotation) ? p.rotation : 0, true);
    view.setFloat32(pos + 24, Number.isFinite(p.scaleX) ? p.scaleX : 1, true);
    view.setFloat32(pos + 28, Number.isFinite(p.scaleY) ? p.scaleY : 1, true);
    const alpha = Math.max(0, Math.min(255, Math.round(p.alpha ?? 255)));
    view.setUint8(pos + 32, alpha);
    view.setUint8(pos + 33, 0);
    view.setUint8(pos + 34, 0);
    view.setUint8(pos + 35, 0);
    // D3DCOLOR little-endian: [B, G, R, A]
    view.setUint8(pos + 36, Math.max(0, Math.min(255, Math.round(p.color?.b ?? 255))));
    view.setUint8(pos + 37, Math.max(0, Math.min(255, Math.round(p.color?.g ?? 255))));
    view.setUint8(pos + 38, Math.max(0, Math.min(255, Math.round(p.color?.r ?? 255))));
    view.setUint8(pos + 39, Math.max(0, Math.min(255, Math.round(p.color?.a ?? alpha))));
    // Level is written verbatim: clamping an invalid level (>2, ignored by Soldat) to 2 would make the prop visible
    view.setUint8(pos + 40, Math.max(0, Math.min(255, Math.round(p.level ?? 0))));
    view.setUint8(pos + 41, 0);
    view.setUint8(pos + 42, 0);
    view.setUint8(pos + 43, 0);
    pos += 44;
  }

  view.setInt32(pos, scenery.length, true);
  pos += 4;

  const fallbackDate = currentDosTimestamp();
  for (let i = 0; i < scenery.length; i++) {
    const s = scenery[i];
    if (sceneryMatchesRawRecord(s)) {
      bytes.set(s.raw!, pos);
      pos += 55;
      continue;
    }
    const strBytes = encodePascalShortString(s.filename, 50);
    bytes.set(strBytes, pos);
    pos += 51;
    // Keep the original date verbatim (including 0); only brand-new entries without a date get "now"
    view.setInt32(pos, Number.isFinite(s.date) ? s.date | 0 : fallbackDate, true);
    pos += 4;
  }

  return bytes;
}

/**
 * Losslessly patches ONLY the Props + Scenery tables of an existing `.pms` binary buffer!
 * Preserves Header, Polygons, Spatial Collision Sectors, Colliders, Spawnpoints, and Bot Waypoints
 * 100% byte-for-byte identical to the original `.pms` file so physics/collisions never drift by 1 bit!
 */
export function patchPmsPropsAndScenery(
  origInput: ArrayBuffer | Uint8Array,
  newProps: PmsProp[],
  newScenery: PmsSceneryDef[],
  options?: { newMapTitle?: string }
): Uint8Array {
  const origBytes =
    origInput instanceof Uint8Array
      ? origInput
      : new Uint8Array(origInput);
  const br = new BinaryReader(origBytes);

  // Header (88 bytes) + polyCount (4 bytes)
  br.skip(4 + 39 + 25 + 4 + 4 + 4 + 4 + 4);
  const polyCount = br.readInt32();
  if (polyCount < 0 || polyCount > 100000) {
    throw new Error(`Invalid polygon count while patching PMS: ${polyCount}`);
  }
  br.skip(polyCount * 121);

  // Spatial Sectors
  br.skip(4); // sectorsDivision
  const sectorsNum = br.readInt32();
  if (sectorsNum < 0 || sectorsNum > 200) {
    throw new Error(`Invalid sectorsNum while patching PMS: ${sectorsNum}`);
  }
  const totalSectors = (2 * sectorsNum + 1) * (2 * sectorsNum + 1);
  for (let i = 0; i < totalSectors; i++) {
    const m = br.readUint16();
    br.skip(m * 2);
  }

  const propsStartOffset = br.pos;

  const origPropCount = br.readInt32();
  if (origPropCount < 0 || origPropCount > 50000) {
    throw new Error(`Invalid prop count while patching PMS: ${origPropCount}`);
  }
  br.skip(origPropCount * 44);

  const origSceneryCount = br.readInt32();
  if (origSceneryCount < 0 || origSceneryCount > 50000) {
    throw new Error(`Invalid scenery count while patching PMS: ${origSceneryCount}`);
  }
  br.skip(origSceneryCount * 55);

  const tailStartOffset = br.pos;

  const headSlice = origBytes.subarray(0, propsStartOffset);
  const middleSlice = encodePropsAndSceneryBlock(newProps, newScenery);
  const tailSlice = origBytes.subarray(tailStartOffset);

  const out = new Uint8Array(headSlice.byteLength + middleSlice.byteLength + tailSlice.byteLength);
  out.set(headSlice, 0);
  if (options?.newMapTitle !== undefined) {
    const encodedTitle = encodePascalShortString(options.newMapTitle, 38);
    out.set(encodedTitle, 4);
  }
  out.set(middleSlice, headSlice.byteLength);
  out.set(tailSlice, headSlice.byteLength + middleSlice.byteLength);

  return out;
}

/**
 * Full standalone `.pms` binary serializer from a parsed `PmsMapData` structure.
 */
export function serializePms(map: PmsMapData): Uint8Array {
  // 0 is a valid sector count / division: only fall back when the value is missing
  const sectorsNum = Number.isFinite(map.sectorsNum) ? Math.max(0, map.sectorsNum) : 25;
  const totalSectors = (2 * sectorsNum + 1) * (2 * sectorsNum + 1);
  let sectorsPayloadBytes = 0;
  for (let i = 0; i < totalSectors; i++) {
    const s = map.sectorsPolys?.[i];
    sectorsPayloadBytes += 2 + (s ? s.length * 2 : 0);
  }

  const headerAndPolysLen = 88 + 4 + map.polygons.length * 121 + 8 + sectorsPayloadBytes;
  const propsAndScenery = encodePropsAndSceneryBlock(map.props, map.scenery);
  const tailLen =
    4 +
    map.colliders.length * 16 +
    4 +
    map.spawnpoints.length * 16 +
    4 +
    map.waypoints.length * 112;

  const extraTail = map.rawTail ?? null;
  const totalLen = headerAndPolysLen + propsAndScenery.byteLength + tailLen + (extraTail?.byteLength ?? 0);
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let pos = 0;

  const writeColor = (c: RgbaColor) => {
    view.setUint8(pos, c.b & 0xff);
    view.setUint8(pos + 1, c.g & 0xff);
    view.setUint8(pos + 2, c.r & 0xff);
    view.setUint8(pos + 3, c.a & 0xff);
    pos += 4;
  };

  if (map.rawHeader && map.rawHeader.byteLength === 88) {
    bytes.set(map.rawHeader, 0);
    const orig = decodeHeaderRecord(map.rawHeader);
    const targetVersion = map.version || 11;
    if (targetVersion !== orig.version) {
      view.setInt32(0, targetVersion, true);
    }
    if (map.mapName !== orig.mapName) {
      bytes.set(encodePascalShortString(map.mapName, 38), 4);
    }
    if (map.texture !== orig.texture) {
      bytes.set(encodePascalShortString(map.texture, 24), 43);
    }
    if (
      map.bgColorTop.r !== orig.bgColorTop.r ||
      map.bgColorTop.g !== orig.bgColorTop.g ||
      map.bgColorTop.b !== orig.bgColorTop.b ||
      map.bgColorTop.a !== orig.bgColorTop.a
    ) {
      pos = 68;
      writeColor(map.bgColorTop);
    }
    if (
      map.bgColorBtm.r !== orig.bgColorBtm.r ||
      map.bgColorBtm.g !== orig.bgColorBtm.g ||
      map.bgColorBtm.b !== orig.bgColorBtm.b ||
      map.bgColorBtm.a !== orig.bgColorBtm.a
    ) {
      pos = 72;
      writeColor(map.bgColorBtm);
    }
    const targetJet = map.startJet || 0;
    if (targetJet !== orig.startJet) {
      view.setInt32(76, targetJet, true);
    }
    if ((map.grenadePacks & 0xff) !== orig.grenadePacks) {
      view.setUint8(80, map.grenadePacks & 0xff);
    }
    if ((map.medikits & 0xff) !== orig.medikits) {
      view.setUint8(81, map.medikits & 0xff);
    }
    if ((map.weather & 0xff) !== orig.weather) {
      view.setUint8(82, map.weather & 0xff);
    }
    if ((map.steps & 0xff) !== orig.steps) {
      view.setUint8(83, map.steps & 0xff);
    }
    const targetRandomId = map.randomId || 0;
    if (targetRandomId !== orig.randomId) {
      view.setInt32(84, targetRandomId, true);
    }
    pos = 88;
  } else {
    view.setInt32(pos, map.version || 11, true);
    pos += 4;
    bytes.set(encodePascalShortString(map.mapName, 38), pos);
    pos += 39;
    bytes.set(encodePascalShortString(map.texture, 24), pos);
    pos += 25;

    writeColor(map.bgColorTop);
    writeColor(map.bgColorBtm);

    view.setInt32(pos, map.startJet || 0, true);
    pos += 4;
    view.setUint8(pos++, map.grenadePacks & 0xff);
    view.setUint8(pos++, map.medikits & 0xff);
    view.setUint8(pos++, map.weather & 0xff);
    view.setUint8(pos++, map.steps & 0xff);
    view.setInt32(pos, map.randomId || 0, true);
    pos += 4;
  }

  view.setInt32(pos, map.polygons.length, true);
  pos += 4;
  for (const poly of map.polygons) {
    if (polygonMatchesRawRecord(poly)) {
      bytes.set(poly.raw!, pos);
      pos += 121;
      continue;
    }
    for (const v of poly.vertices) {
      view.setFloat32(pos, v.x, true);
      view.setFloat32(pos + 4, v.y, true);
      view.setFloat32(pos + 8, v.z, true);
      view.setFloat32(pos + 12, v.rhw, true);
      pos += 16;
      writeColor(v.color);
      view.setFloat32(pos, v.u, true);
      view.setFloat32(pos + 4, v.v, true);
      pos += 8;
    }
    for (const n of poly.normals) {
      view.setFloat32(pos, n.x, true);
      view.setFloat32(pos + 4, n.y, true);
      view.setFloat32(pos + 8, n.z, true);
      pos += 12;
    }
    view.setUint8(pos++, poly.polyType & 0xff);
  }

  view.setInt32(pos, Number.isFinite(map.sectorsDivision) ? map.sectorsDivision : 128, true);
  view.setInt32(pos + 4, sectorsNum, true);
  pos += 8;
  for (let i = 0; i < totalSectors; i++) {
    const s = map.sectorsPolys?.[i];
    const m = s ? s.length : 0;
    view.setUint16(pos, m, true);
    pos += 2;
    if (s) {
      for (let k = 0; k < m; k++) {
        view.setUint16(pos, s[k], true);
        pos += 2;
      }
    }
  }

  bytes.set(propsAndScenery, pos);
  pos += propsAndScenery.byteLength;

  view.setInt32(pos, map.colliders.length, true);
  pos += 4;
  for (const col of map.colliders) {
    if (colliderMatchesRawRecord(col)) {
      bytes.set(col.raw!, pos);
      pos += 16;
      continue;
    }
    view.setUint8(pos, col.active ? 1 : 0);
    view.setFloat32(pos + 4, col.x, true);
    view.setFloat32(pos + 8, col.y, true);
    view.setFloat32(pos + 12, col.radius, true);
    pos += 16;
  }

  view.setInt32(pos, map.spawnpoints.length, true);
  pos += 4;
  for (const sp of map.spawnpoints) {
    if (spawnMatchesRawRecord(sp)) {
      bytes.set(sp.raw!, pos);
      pos += 16;
      continue;
    }
    view.setUint8(pos, sp.active ? 1 : 0);
    view.setInt32(pos + 4, sp.x, true);
    view.setInt32(pos + 8, sp.y, true);
    view.setInt32(pos + 12, sp.team, true);
    pos += 16;
  }

  view.setInt32(pos, map.waypoints.length, true);
  pos += 4;
  for (const wp of map.waypoints) {
    if (waypointMatchesRawRecord(wp)) {
      bytes.set(wp.raw!, pos);
      pos += 112;
      continue;
    }
    view.setUint8(pos, wp.active ? 1 : 0);
    view.setInt32(pos + 4, wp.id, true);
    view.setInt32(pos + 8, wp.x, true);
    view.setInt32(pos + 12, wp.y, true);
    view.setUint8(pos + 16, wp.left ? 1 : 0);
    view.setUint8(pos + 17, wp.right ? 1 : 0);
    view.setUint8(pos + 18, wp.up ? 1 : 0);
    view.setUint8(pos + 19, wp.down ? 1 : 0);
    view.setUint8(pos + 20, wp.jetpack ? 1 : 0);
    view.setUint8(pos + 21, wp.pathNum & 0xff);
    view.setUint8(pos + 22, wp.action & 0xff);
    view.setUint8(pos + 23, (wp.c2 ?? 0) & 0xff);
    view.setUint8(pos + 24, (wp.c3 ?? 0) & 0xff);
    const conns = wp.connections.slice(0, 20);
    view.setInt32(pos + 28, conns.length, true);
    for (let j = 0; j < 20; j++) {
      view.setInt32(pos + 32 + j * 4, j < conns.length ? conns[j] : 0, true);
    }
    pos += 112;
  }
  if (extraTail) bytes.set(extraTail, pos);

  return bytes;
}

/**
 * Clones a `PmsMapData` with updated prop dimensions (for instant 0ms Live Before/After _f repair preview in WebGL2!).
 */
/**
 * Name of an Optimize Sceneries result: `<map>_o`, or `<map>_f_o` when 1.7.1 size fixes were applied first
 * (`_a` / `_f_a` in archive mode). Built in one step, so a long name is shortened once and the result can never
 * fall back onto the source name (two separate `_f` + `_o` truncations could drop the `_f` or reproduce the source).
 */
export function makeOptimizeOutputName(
  baseName: string,
  fixesApplied: boolean,
  maxBaseLength: number,
  archive = false
): string {
  const suffix = archive ? (fixesApplied ? '_f_a' : '_a') : fixesApplied ? '_f_o' : '_o';
  return makeDerivedMapName(baseName, suffix, maxBaseLength);
}

// The texture name follows the 4-byte version and the 39-byte map title ShortString in the PMS header
const PMS_TEXTURE_OFFSET = 4 + 39;

/**
 * Copy of a PMS file with another polygon texture name (ShortString[24] in the header); nothing else changes.
 */
export function patchPmsTexture(input: Uint8Array, texture: string): Uint8Array {
  if (texture.length > 24) throw new Error(`Texture name longer than 24 characters: ${texture}`);
  const out = new Uint8Array(input);
  out.set(encodePascalShortString(texture, 24), PMS_TEXTURE_OFFSET);
  return out;
}

export function cloneMapWithPropFixes(
  map: PmsMapData,
  fixesByPropIndex: Map<number, { width: number; height: number }>
): PmsMapData {
  if (fixesByPropIndex.size === 0) return map;
  const nextProps = map.props.map((p, idx) => {
    const fix = fixesByPropIndex.get(idx);
    if (!fix) return p;
    return { ...p, width: fix.width, height: fix.height };
  });
  return {
    ...map,
    props: nextProps,
  };
}
