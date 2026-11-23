import path from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { inspectArchiveBmp, inspectArchiveTga } from './archiveLegacyImage';
import { encodePascalShortString } from '../shared/pmsParser';
export type ResourceKind = 'scenery' | 'texture' | 'edge' | 'image';
export type AssetFolder = 'scenery-gfx' | 'textures' | 'textures/edges';
export interface CatalogFile {
    kind: ResourceKind | 'map';
    name: string;
    path: string;
    scope: string;
    sha256: string;
    size: number;
    mtimeMs: number;
}
export interface ImageInfo {
    ext: string;
    width: number;
    height: number;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const fold = (name: string) => name.normalize('NFC').toLowerCase();
const ext = (name: string) => path.posix.extname(name).toLowerCase();
const stem = (name: string) => name.slice(0, name.length - path.posix.extname(name).length);
export const preferSource = (a: CatalogFile, b: CatalogFile) => Number(a.scope === '@soldat') - Number(b.scope === '@soldat') || b.mtimeMs - a.mtimeMs || compare(a.path, b.path);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
// Some libpng readers happily return all pixels when IEND is missing. Check the
// critical chunk framing and CRCs as well, without rejecting old ancillary metadata.
function completePng(data: Buffer) {
    let sawPixels = false;
    for (let pos = 8; pos + 12 <= data.length;) {
        const length = data.readUInt32BE(pos), end = pos + 8 + length;
        if (end + 4 > data.length) return false;
        const type = data.toString('ascii', pos + 4, pos + 8);
        if ((data[pos + 4] & 0x20) === 0 && crc32(data.subarray(pos + 4, end)) !== data.readUInt32BE(end)) return false;
        if (type === 'IDAT' && length > 0) sawPixels = true;
        if (type === 'IEND') return length === 0 && sawPixels;
        pos = end + 4;
    }
    return false;
}

// GIF readers may treat a truncated final frame as the end of an animation.
// Read the frame descriptors and length-prefixed blocks before handing data to libvips.
function gifFrames(data: Buffer) {
    if (data.length < 13) return 0;
    const tableBytes = (flags: number) => (flags & 128) ? 3 * (2 << (flags & 7)) : 0;
    let pos = 13 + tableBytes(data[10]), frames = 0;
    while (pos < data.length) {
        const block = data[pos++];
        if (block === 0x3b) return frames;
        if (block === 0x21) {
            pos++; // Extension label followed by zero or more data blocks.
        } else if (block === 0x2c && pos + 9 <= data.length) {
            const flags = data[pos + 8];
            pos += 9 + tableBytes(flags);
            if (pos >= data.length || data[pos] < 2 || data[pos] > 8) return 0;
            pos++;
            frames++;
        } else {
            return 0;
        }
        while (pos < data.length && data[pos] !== 0) pos += 1 + data[pos];
        if (pos === data.length || pos > data.length) return 0;
        pos++;
    }
    return 0;
}

/** Decode every row of each frame before an image can become a live PMS dependency. */
export async function inspectArchiveImage(data: Buffer, name: string): Promise<ImageInfo | null> {
    if (data[0] === 0x42 && data[1] === 0x4d) return inspectArchiveBmp(data);
    const png = data.subarray(0, 8).equals(pngSignature);
    const gif = data.toString('ascii', 0, 3) === 'GIF';
    const jpeg = data[0] === 0xff && data[1] === 0xd8;
    if (!png && !gif && !jpeg) return ext(name) === '.tga' ? inspectArchiveTga(data) : null;
    if (png && !completePng(data)) return null;
    const frames = gif ? gifFrames(data) : 1;
    if (!frames) return null;
    try {
        const limitInputPixels = 64 * 1024 * 1024;
        const pipeline = sharp(data, { limitInputPixels, failOn: 'error', animated: gif });
        const m = await pipeline.metadata(), height = m.pageHeight ?? m.height;
        if (!m.width || !height || m.width > 32767 || height > 32767 || (m.pages ?? 1) !== frames || m.width * height * frames > limitInputPixels) return null;
        // Raw output forces lazy libvips decoders to consume the complete raster.
        // One channel bounds the output buffer to at most one byte per pixel.
        await pipeline.removeAlpha().greyscale().raw({ depth: 'uchar' }).toBuffer();
        return { ext: jpeg ? '.jpg' : gif ? '.gif' : '.png', width: m.width, height };
    } catch {
        return null;
    }
}

/** Require actual surviving image payload before looking for a prefix completion. */
export function recoverableImagePrefix(data: Buffer): { ext: string; expectedSize?: number } | undefined {
    if (data.length < 1024) return;
    if (data[0] === 0x42 && data[1] === 0x4d) {
        const pixels = data.readUInt32LE(10), expectedSize = data.readUInt32LE(2);
        if (pixels >= 26 && data.length - pixels >= 512 && expectedSize > data.length)
            return { ext: '.bmp', expectedSize };
    }
    if (!data.subarray(0, 8).equals(pngSignature)) return;
    for (let pos = 8; pos + 8 <= data.length;) {
        const length = data.readUInt32BE(pos);
        if (data.toString('ascii', pos + 4, pos + 8) === 'IDAT' && Math.min(length, data.length - pos - 8) >= 512)
            return { ext: '.png' };
        pos += length + 12;
    }
}
/** Stem uniqueness matters: Soldat may prefer foo.png even when the PMS requests foo.bmp. */
export class PortableNames {
    private readonly stems = new Set<string>();
    reserveMap(name: string) {
        if (!/^[a-z0-9_-]{1,24}\.pms$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./.test(name)) return false;
        const key = stem(name);
        if (this.stems.has(key)) return false;
        this.stems.add(key);
        return true;
    }
    allocate(source: string, extension: string, digest: string, limit: number, namespaced = false) {
        let base = stem(path.posix.basename(source.replaceAll('\\', '/'))).normalize('NFKD').replace(/\p{M}/gu, '')
            .toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/_+$/, '') || 'unnamed';
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(base))
            base = '_' + base;
        const room = limit - extension.length;
        // 64 bits in 13 base36 characters leave space for a readable hint even in
        // the 24-byte texture field. The input digest includes the associated edge.
        if (namespaced) {
            const hint = base.slice(0,room - 16);
            for (let n=0;;n++) {
                const hex = n<4 ? digest.slice(n*16,(n+1)*16) : digest.slice(0,12)+n.toString(16).padStart(4,'0');
                const suffix = BigInt('0x'+hex).toString(36).padStart(13,'0');
                const candidate = 's_'+hint+'_'+suffix;
                if (!this.stems.has(candidate)) {
                    this.stems.add(candidate);
                    return candidate+extension;
                }
            }
        }
        let result = base.slice(0, room);
        for (let n = 0; this.stems.has(result); n++) {
            const suffix = '_' + digest.slice(0, 8) + (n ? n.toString(36) : '');
            result = base.slice(0, room - suffix.length) + suffix;
        }
        this.stems.add(result);
        return result + extension;
    }
}
type Bucket = Map<string, Map<string, CatalogFile>>;
interface Candidates {
    global: Bucket;
    scopes: Map<string, Bucket>;
}
function addTo(bucket: Bucket, file: CatalogFile) {
    let exact = bucket.get(file.name);
    if (!exact) {
        exact = new Map();
        bucket.set(file.name, exact);
    }
    const old = exact.get(file.sha256);
    if (!old || preferSource(file, old) < 0)
        exact.set(file.sha256, file);
}
type Match = {
    file: CatalogFile;
} | {
    error: 'missing' | 'ambiguous' | 'invalid-reference';
};
const codepages = ['windows-1251', 'windows-1252', 'windows-1257', 'ibm866', 'utf-8'].map(label => new TextDecoder(label, { fatal: true }));
const legacyNames = new Map<string, string[]>();
function originalSpellings(name: string): string[] {
    if (!/[^\x00-\x7f]/.test(name))
        return [];
    const known = legacyNames.get(name);
    if (known)
        return known;
    const pascal = encodePascalShortString(name, 50), bytes = pascal.subarray(1, pascal[0] + 1);
    const aliases = new Set<string>();
    if (new TextDecoder('windows-1250').decode(bytes) === name)
        for (const decoder of codepages) {
            try {
                const value = decoder.decode(bytes);
                if (value !== name && !value.includes('\ufffd'))
                    aliases.add(value);
            }
            catch { /* Invalid UTF-8. */ }
        }
    const result = [...aliases];
    legacyNames.set(name, result);
    return result;
}
/** Maps from different packages can use different bytes behind exactly the same name. */
export class AssetBindings {
    private readonly index = new Map<string, Candidates>();
    private readonly memo = new Map<string, Match>();
    private readonly completions = new Map<string, CatalogFile>();
    *sceneryNames(): IterableIterator<string> {
        for (const key of this.index.keys()) {
            if (key.startsWith('scenery|') || key.startsWith('image|')) yield key.slice(key.indexOf('|')+1);
        }
    }
    setCompletion(file: CatalogFile, complete: CatalogFile) { this.completions.set(file.kind + '|' + file.sha256 + '|' + fold(file.name), complete); }
    completed(file: CatalogFile) { return this.completions.get(file.kind + '|' + file.sha256 + '|' + fold(file.name)); }
    add(file: CatalogFile, shared = true) {
        const key = file.kind + '|' + fold(file.name);
        let group = this.index.get(key);
        if (!group) {
            group = { global: new Map(), scopes: new Map() };
            this.index.set(key, group);
        }
        if (file.scope !== '@soldat' && shared)
            addTo(group.global, file);
        let bucket = group.scopes.get(file.scope);
        if (!bucket) {
            bucket = new Map();
            group.scopes.set(file.scope, bucket);
        }
        addTo(bucket, file);
    }
    resolve(kind: 'scenery' | 'texture' | 'edge', raw: string, scope: string, modern = true, localOnly = false): Match {
        const key = JSON.stringify([kind, raw, scope, modern, localOnly]);
        let answer = this.memo.get(key);
        if (answer)
            return answer;
        answer = this.lookup(kind, raw, scope, modern, localOnly);
        this.memo.set(key, answer);
        return answer;
    }
    completeCandidates(kind: ResourceKind, file: CatalogFile): CatalogFile[] {
        const unique = new Map<string, CatalogFile>();
        for (const k of kind === 'edge' ? [kind] : [kind, 'image']) {
            const found = this.index.get(k + '|' + fold(file.name));
            for (const setting of [found?.global, found?.scopes.get('@soldat')])
                if (setting) {
                    for (const byHash of setting.values())
                        for (const [hash, c] of byHash)
                            unique.set(hash, c);
                }
        }
        return [...unique.values()];
    }
    /** Include every recorded content behind this spelling or a reversible legacy decoding.
     * Used only as exclusion evidence; the actual choice must also have a direct release witness. */
    sceneryCandidates(name: string): CatalogFile[] {
        const seen = new Map<string,CatalogFile>();
        const names = new Set([name,stem(name)+'.png']);
        for (const raw of [...names]) for (const alias of originalSpellings(raw)) names.add(alias);
        for (const n of names) {
            for (const kind of ['scenery','image']) {
                const group = this.index.get(kind+'|'+fold(n));
                for (const bucket of [group?.global,group?.scopes.get('@soldat')]) {
                    if (bucket) for (const bin of bucket.values()) for (const f of bin.values()) {
                        const file=this.completed(f)??f;
                        seen.set(file.sha256,file);
                    }
                }
            }
        }
        return [...seen.values()];
    }
    private lookup(kind: 'scenery' | 'texture' | 'edge', raw: string, scope: string, modern: boolean, localOnly: boolean): Match {
        const name = raw.trim();
        if (!name || name === '.' || name === '..' || /[\\/:\0]/.test(name))
            return { error: 'invalid-reference' };
        const png = stem(name) + '.png';
        const names = modern && fold(name) !== fold(png) ? [png, name] : [name];
        const choices = (names: string[]) => (kind === 'edge' ? [kind] : [kind, 'image']).flatMap(k => names.map(n => ({ name: n, unscoped: k === 'image', group: this.index.get(k + '|' + fold(n)) })));
        const alternatives = choices(names);
        const encoded = choices(names.flatMap(originalSpellings));
        const select = (bucket: Bucket, spelling: string, local: boolean): Match | undefined => {
            if (!bucket.size)
                return;
            const exact = bucket.get(spelling);
            const choices = exact && local ? [exact] : bucket.values();
            let file: CatalogFile | undefined;
            for (const values of choices)
                for (const item of values.values()) {
                    if (file && (this.completed(file) ?? file).sha256 !== (this.completed(item) ?? item).sha256)
                        return { error: 'ambiguous' };
                    if (!file || preferSource(item, file) < 0)
                        file = item;
                }
            return file ? { file } : undefined;
        };
        // Only inherit from actual parent packages, then try globally unique content. An
        // unrelated package's timestamp or matching spelling is not proof of ownership.
        let here = scope;
        while (true) {
            for (const option of alternatives) {
                const bucket = option.group?.scopes.get(here);
                const found = bucket && select(bucket, option.name, true);
                if (found)
                    return found;
            }
            // Historical map strings carry bytes, not a declared language. Accept another
            // decoding only inside this package and only when every local hit agrees.
            let local: CatalogFile | undefined;
            for (const option of encoded) {
                const bucket = option.group?.scopes.get(here), found = bucket && select(bucket, option.name, true);
                if (!found)
                    continue;
                if ('error' in found || local && local.sha256 !== found.file.sha256)
                    return { error: 'ambiguous' };
                local = found.file;
            }
            if (local)
                return { file: local };
            const cut = here.lastIndexOf('/');
            if (cut < 0)
                break;
            here = here.slice(0, cut).replace(/!$/, '');
        }
        if (localOnly)
            return { error: 'missing' };
        // No local file. Check the referenced extension first: an unrelated HD override
        // from another map cannot displace an unambiguous original.
        for (const option of [...alternatives].sort((a, b) => Number(b.name === name) - Number(a.name === name))) {
            if (option.unscoped)
                continue; // An unrelated, unclassified picture could simply be an overview.
            const found = option.group && select(option.group.global, option.name, false);
            if (found)
                return found;
        }
        for (const option of alternatives) {
            const bucket = option.group?.scopes.get('@soldat');
            const found = bucket && select(bucket, option.name, true);
            if (found)
                return found;
        }
        return { error: 'missing' };
    }
}
