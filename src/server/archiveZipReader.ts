import { open } from 'node:fs/promises';
import { promisify } from 'node:util';
import { crc32, inflateRaw } from 'node:zlib';
import { ZIP_LIMITS } from './zipSafety';

const inflate = promisify(inflateRaw);
export const cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const utf8 = new TextDecoder('utf-8', { fatal: true });
export interface ZipMember {
  name: string;
  size: number;
  mtimeMs: number;
  directory: boolean;
  problem?: string;
  read(): Promise<Buffer>;
}

function safeNumber(n: bigint) {
  const result = Number(n);
  if (!Number.isSafeInteger(result)) throw Error('ZIP64 offset exceeds supported size');
  return result;
}
function extraFields(bytes: Buffer) {
  const result = new Map<number, Buffer>();
  for (let off = 0; off + 4 <= bytes.length;) {
    const len = bytes.readUInt16LE(off + 2);
    if (off + 4 + len > bytes.length) throw Error('Truncated ZIP extra field');
    result.set(bytes.readUInt16LE(off), bytes.subarray(off + 4, off + 4 + len));
    off += 4 + len;
  }
  return result;
}
function filename(raw: Buffer, extra: Map<number, Buffer>, flags: number) {
  const unicode = extra.get(0x7075);
  if (unicode && unicode.length >= 5 && unicode[0] === 1 && unicode.readUInt32LE(1) === crc32(raw))
    return utf8.decode(unicode.subarray(5));
  try { return utf8.decode(raw); } catch (error) { if (flags & 2048) throw error; }
  return Array.from(raw, b => b < 128 ? String.fromCharCode(b) : cp437[b - 128]).join('');
}
function ntfsMtime(bytes?: Buffer) {
  if (!bytes) return;
  for (let pos=4;pos+4<=bytes.length;) {
    const tag=bytes.readUInt16LE(pos),length=bytes.readUInt16LE(pos+2);
    pos+=4;
    if (pos+length>bytes.length) return;
    if (tag===1 && length>=24) {
      const ticks=bytes.readBigUInt64LE(pos)-116444736000000000n;
      if (ticks>0n) return Number(ticks/10000n)+Number(ticks%10000n)/10000;
    }
    pos+=length;
  }
}
// Read only the central directory and requested members. Outer ZIPs can be many GiB.
export async function withZipMembers(source: string | Buffer, visit: (members: ZipMember[]) => Promise<void>) {
  const handle = typeof source === 'string' ? await open(source, 'r') : null;
  try {
    const size = handle ? (await handle.stat()).size : (source as Buffer).length;
    async function range(offset: number, length: number) {
      if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > size) throw Error('ZIP member lies outside archive');
      if (!handle) return (source as Buffer).subarray(offset, offset + length);
      const output = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const n = (await handle.read(output, read, length - read, offset + read)).bytesRead;
        if (!n) throw Error('Unexpected end of ZIP');
        read += n;
      }
      return output;
    }
    const tailAt = Math.max(0, size - 65557);
    const tail = await range(tailAt, size - tailAt);
    let off = tail.length - 22;
    while (off >= 0 && (tail.readUInt32LE(off) !== 0x06054b50 || off + 22 + tail.readUInt16LE(off + 20) !== tail.length)) off--;
    if (off < 0) throw Error('Missing ZIP central directory');
    if (tail.readUInt16LE(off + 4) || tail.readUInt16LE(off + 6)) throw Error('Split ZIP is unsupported');
    let count = tail.readUInt16LE(off + 10), bytes = tail.readUInt32LE(off + 12), at = tail.readUInt32LE(off + 16);
    if (count === 0xffff || bytes === 0xffffffff || at === 0xffffffff) {
      const locator = await range(tailAt + off - 20, 20);
      if (locator.readUInt32LE() !== 0x07064b50 || locator.readUInt32LE(4) || locator.readUInt32LE(16) !== 1) throw Error('Missing ZIP64 directory or split ZIP');
      const end = await range(safeNumber(locator.readBigUInt64LE(8)), 56);
      if (end.readUInt32LE() !== 0x06064b50 || end.readUInt32LE(16) || end.readUInt32LE(20)) throw Error('Invalid ZIP64 directory');
      count = safeNumber(end.readBigUInt64LE(32)); bytes = safeNumber(end.readBigUInt64LE(40)); at = safeNumber(end.readBigUInt64LE(48));
    }
    if (count > ZIP_LIMITS.maxEntries || bytes > 64 * 1024 * 1024) throw Error('ZIP central directory exceeds limit');
    const central = await range(at, bytes), members: ZipMember[] = [];
    const spans: {offset:number;compressed:number;member:ZipMember}[] = [];
    let expanded = 0;
    for (let i = 0, p = 0; i < count; i++) {
      if (p + 46 > bytes || central.readUInt32LE(p) !== 0x02014b50) throw Error('Invalid ZIP central record');
      const flags = central.readUInt16LE(p + 8), method = central.readUInt16LE(p + 10), time = central.readUInt16LE(p + 12), date = central.readUInt16LE(p + 14);
      const crc = central.readUInt32LE(p + 16), nameLen = central.readUInt16LE(p + 28), extraLen = central.readUInt16LE(p + 30), commentLen = central.readUInt16LE(p + 32);
      const raw = central.subarray(p + 46, p + 46 + nameLen);
      if (p + 46 + nameLen + extraLen + commentLen > bytes) throw Error('Truncated ZIP central record');
      const extra = extraFields(central.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen));
      const name = filename(raw, extra, flags), attr = central.readUInt32LE(p + 38);
      const wide = extra.get(1);
      let wideOffset = 0;
      const field = (n: number) => {
        if (n !== 0xffffffff) return n;
        if (!wide || wideOffset + 8 > wide.length) throw Error('Missing ZIP64 member size');
        const val = safeNumber(wide.readBigUInt64LE(wideOffset)); wideOffset += 8; return val;
      };
      const expandedSize = field(central.readUInt32LE(p + 24)), compressed = field(central.readUInt32LE(p + 20)), offset = field(central.readUInt32LE(p + 42));
      const unixKind = (attr >>> 16) & 0o170000;
      const directory = /[\\/]$/.test(name) || unixKind === 0o040000 || !!(attr & 0x10);
      const problem = unixKind && ![0o040000, 0o100000].includes(unixKind) ? 'Link or special ZIP member'
        : (flags & 1) ? 'Encrypted ZIP member' : method !== 0 && method !== 8 ? 'Unsupported ZIP compression ' + method
        : expandedSize > ZIP_LIMITS.maxEntryBytes || compressed > ZIP_LIMITS.maxEntryBytes ? 'ZIP member exceeds size limit' : undefined;
      expanded += expandedSize;
      const mtime = extra.get(0x5455);
      const mtimeMs = ntfsMtime(extra.get(0x000a)) ?? (mtime && mtime.length >= 5 && (mtime[0] & 1) ? mtime.readInt32LE(1) * 1000 :
        Date.UTC(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2));
      const member: ZipMember = { name, size: expandedSize, mtimeMs, directory, problem, async read() {
        if (member.problem) throw Error(member.problem);
        const h = await range(offset, 30);
        if (h.readUInt32LE() !== 0x04034b50 || h.readUInt16LE(8) !== method || h.readUInt16LE(6) !== flags || h.readUInt16LE(26) !== nameLen)
          throw Error('ZIP local header differs from directory');
        const dataAt = offset + 30 + nameLen + h.readUInt16LE(28);
        if (dataAt + compressed > memberEnd.get(offset)!) throw Error('ZIP data overlaps another record');
        if (!(await range(offset + 30, nameLen)).equals(raw)) throw Error('ZIP member names disagree');
        const packed = await range(dataAt, compressed);
        const data = method === 0 ? packed : await inflate(packed, { maxOutputLength: Math.max(1, expandedSize) });
        if (data.length !== expandedSize || crc32(data) !== crc) throw Error('ZIP member size or CRC mismatch');
        return data;
      }};
      members.push(member); spans.push({offset,compressed,member});
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (expanded > ZIP_LIMITS.maxTotalBytes || expanded > Math.max(ZIP_LIMITS.ratioFloorBytes, size * ZIP_LIMITS.maxCompressionRatio))
      throw Error('ZIP exceeds expanded size or compression ratio limit');
    const memberEnd = new Map<number, number>();
    spans.sort((a,b)=>a.offset-b.offset);
    for (let i=0;i<spans.length;i++) {
      const current=spans[i], next=spans[i+1]?.offset ?? at;
      if (current.offset + 30 + current.compressed > next || current.offset === spans[i-1]?.offset)
        throw Error('Overlapping ZIP member records');
      memberEnd.set(current.offset,next);
    }
    await visit(members);
  } finally { await handle?.close(); }
}
