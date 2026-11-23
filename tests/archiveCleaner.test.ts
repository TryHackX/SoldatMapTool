import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { analyzeCleanArchive, exportCleanArchive, nameLatestMapVariants, shortenArchiveMapNames, type ArchiveCleanMap } from '../src/server/archiveCleaner';

test('legacy export reserves short names and keeps duplicate rows and version filenames consistent',()=>{
    const rows=['ctf_jd_alcoholic','ctf_jd_alcoholi_8d4a614e','ctf_jd_alcoholi_8d4a614e',
        'ctf_jd_alcoholic_v2','ctf_jd_alc_8d4a6'].map(name=>({
        output:name+'.pms',source:name,sha256:'',issues:[],status:'ready' as const,
    }));
    shortenArchiveMapNames(rows);
    const names=rows.map(r=>r.output);
    assert.equal(names[0],'ctf_jd_alcoholic.pms');
    assert.equal(names[1],names[2]);
    assert.equal(names[4],'ctf_jd_alc_8d4a6.pms');
    assert.equal(new Set(names).size,4);
    assert.ok(names.every(n=>n.length<=20));
});
import {writeArchiveGameZip} from '../src/server/archiveGameZip';
import {recoverIndexedMapDates} from '../src/server/archiveMapDates';
import {createWriteStream} from 'node:fs';
import {readMissingArtworkText} from '../src/server/missingArtwork';
import { createMapFromTemplate } from '../src/shared/editorTemplates';
import { compileMapSectors } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms, type PmsProp } from '../src/shared/pmsParser';
import { pruneUnusedScenery } from '../src/shared/sceneryDependencies';
import { AssetBindings, inspectArchiveImage } from '../src/server/archiveBindings';
import { PortableNames } from '../src/server/archiveBindings';
import { executePackBuild, buildPackPreview } from '../src/server/packBuilder';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { soldatCrc32 } from '../src/shared/pmsParser';
import type { PackBuildOptions } from '../src/shared/apiTypes';
import { EditorDocument } from '../src/client/editor/EditorDocument';
async function fixture(t: {
    after: (f: () => Promise<unknown>) => void;
}) {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'soldat-clean-test-'));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    const src = path.join(temp, 'src'), work = path.join(temp, 'work'), out = path.join(temp, 'out');
    async function put(name: string, bytes: Uint8Array, stamp = 123456789) {
        const p = path.join(src, name);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, bytes);
        await fs.utimes(p, stamp, stamp);
    }
    return { src, work, out, put };
}
const image = (r: number) => sharp({ create: { width: 3, height: 2, channels: 4, background: { r, g: 60, b: 80, alpha: 1 } } }).png().toBuffer();
test('borrowing a missing texture preserves conflicting source edges for review', async t => {
    const {src,work,put} = await fixture(t);
    const map = sample([],[],'ground.png');
    await put('maps/A.pms',map);
    await put('textures/edges/ground.png',await image(10));
    const other = new AdmZip();
    other.addFile('maps/A.pms',map);
    other.addFile('textures/ground.png',await image(20));
    other.addFile('textures/edges/ground.png',await image(30));
    const pack = path.join(path.dirname(work),'edition.zip');
    other.writeZip(pack);
    const plan = await analyzeCleanArchive(src,work,{artworkRoots:[pack]});
    assert.equal(plan.summary.blockedMaps,1);
    assert.ok(plan.maps[0].issues.includes('edge/ground.png · conflicting package edges'));
});
const prop = (style: number): PmsProp => ({ active: true, index: 0, style, width: 0, height: 0, x: 20, y: 30, rotation: 0, scaleX: 1, scaleY: 1,
    alpha: 200, color: { r: 144, g: 9, b: 40, a: 255 }, level: 2 });
function sample(scenery: string[], used: number[], texture = 'Ground.BMP') {
    const m = createMapFromTemplate('arena', { texture });
    m.scenery = scenery.map((filename, i) => ({ index: i + 1, filename, date: 0, usedCount: 1 }));
    m.props = used.map((n, i) => ({ ...prop(n), index: i }));
    return Buffer.concat([serializePms(m), Buffer.from('PRESERVE-TAIL')]);
}
test('same PMS bytes retain distinct package graphics, mixed-case map filenames normalize and aliases deduplicate', async (t) => {
    const { src, work, out, put } = await fixture(t);
    const soil = await image(4), a = await image(7), b = await image(77);
    const bytes = sample(['Unused.BMP', 'Flag.BmP'], [2]);
    for (const [pack, map, sprite, time] of [['older', 'a.PMS', a, 100000], ['newer', 'a.pMs', b, 200000], ['copy', 'alias.PMS', a, 90000]] as const) {
        await put(pack + '/maps/' + map, bytes, time);
        await put(pack + '/scenery-gfx/flag.PNG', sprite, time);
        await put(pack + '/textures/Ground.png', soil, time);
    }
    await put('older/scenery-gfx/alternate.PNG', a);
    await put('extra/scenery-gfx/unused.PNG', await image(33));
    const plan = await analyzeCleanArchive(src, work);
    assert.equal(plan.summary.readyMaps, 2);
    assert.equal(plan.summary.duplicateMaps, 1);
    assert.equal(plan.summary.blockedMaps, 0);
    const newer = plan.maps.find(m => m.source.includes('newer/'))!, older = plan.maps.find(m => m.source.includes('older/'))!, copy = plan.maps.find(m => m.source.includes('copy/'))!;
    assert.equal(newer.output, 'a.pms');
    assert.match(older.output!, /^a_[a-f0-9]{8}\.pms$/);
    assert.equal(copy.output, older.output);
    assert.notEqual(newer.outputSha256, older.outputSha256);
    assert.equal(plan.summary.removedUnusedScenery, 2);
    await exportCleanArchive(plan, out);
    await assert.rejects(exportCleanArchive(plan, out), /already exists/);
    for (const [row, asset] of [[older, a], [newer, b]] as const) {
        const content = await fs.readFile(path.join(out, 'maps', row.output!)), m = parsePmsFull(content);
        assert.equal(content.subarray(-13).toString(), 'PRESERVE-TAIL');
        assert.ok(Buffer.from(m.polygons[0].raw!).equals(Buffer.from(parsePmsFull(bytes).polygons[0].raw!)));
        assert.deepEqual(m.scenery.map(d => d.filename), [m.scenery[0].filename.toLowerCase()]);
        assert.equal(m.props[0].style, 1);
        assert.deepEqual([m.props[0].width, m.props[0].height], [3, 2]);
        assert.deepEqual(await fs.readFile(path.join(out, 'scenery-gfx', m.scenery[0].filename)), asset);
        assert.deepEqual(await fs.readFile(path.join(out, 'textures', m.texture)), soil);
    }
    assert.deepEqual(await fs.readdir(path.join(out, 'review', 'unreferenced', 'scenery-gfx')), ['unused.png']);
});
test('exact case distinguishes sibling entries, foreign ambiguity is never settled by timestamps', () => {
    const b = new AssetBindings();
    for (const [name, hash] of [['Tree.bmp', 'one'], ['TREE.BMP', 'two']]) {
        b.add({ name, sha256: hash, path: 'pack!/' + name, scope: 'pack', kind: 'scenery', size: 32, mtimeMs: 1 });
    }
    assert.equal((b.resolve('scenery', 'Tree.bmp', 'pack') as any).file.sha256, 'one');
    assert.deepEqual(b.resolve('scenery', 'tree.bmp', 'pack'), { error: 'ambiguous' });
    assert.deepEqual(b.resolve('scenery', 'Tree.bmp', 'elsewhere'), { error: 'ambiguous' });
});
test('a briefly locked staging folder can publish the same verified export', async t => {
    const { src, work, out, put } = await fixture(t);
    await put('maps/test.pms', sample([], []));
    await put('textures/Ground.png', await image(6));
    const plan = await analyzeCleanArchive(src, work);
    const rename = fs.rename.bind(fs);
    let publishAttempts = 0;
    t.mock.method(fs, 'rename', async (from: string, to: string) => {
        if (to === out && ++publishAttempts === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        return rename(from, to);
    });
    const result = await exportCleanArchive(plan, out);
    assert.equal(publishAttempts, 2);
    assert.equal(result.maps, 1);
    assert.deepEqual(await fs.readdir(path.join(out, 'maps')), ['test.pms']);
});
test('legacy code pages resolve by byte spelling inside a package and never borrow an unrelated spelling', () => {
    const b = new AssetBindings();
    b.add({ name: 'Me-Stьtze.bmp', sha256: 'one', path: 'de/Me-Stьtze.bmp', scope: 'de', kind: 'scenery', size: 32, mtimeMs: 0 });
    assert.ok('file' in b.resolve('scenery', 'Me-Stütze.bmp', 'de'));
    assert.deepEqual(b.resolve('scenery', 'Me-Stütze.bmp', 'foreign'), { error: 'missing' });
});
test('truncated BMP uses a unique complete matching prefix; different possible suffixes stay blocked', async (t) => {
    const { src, work, put } = await fixture(t);
    const bmp = Buffer.alloc(54 + 3 * 32 * 32);
    bmp.write('BM');
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeUInt32LE(32, 18);
    bmp.writeUInt32LE(32, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    const different = Buffer.from(bmp);
    different[different.length - 1] = 255;
    await put('main/maps/certain.PMS', sample(['certain.bmp'], [1]));
    await put('main/maps/maybe.PMS', sample(['maybe.bmp'], [1]));
    await put('main/textures/Ground.png', await image(6));
    for (const name of ['certain', 'maybe']) {
        await put('main/scenery-gfx/' + name + '.bmp', bmp.subarray(0, 1500));
        await put('backup/scenery-gfx/' + name + '.bmp', bmp);
    }
    await put('other/scenery-gfx/maybe.bmp', different);
    const plan = await analyzeCleanArchive(src, work);
    const recovered = plan.maps.find(m => m.source.endsWith('certain.PMS'))!, ambiguous = plan.maps.find(m => m.source.endsWith('maybe.PMS'))!;
    assert.equal(recovered.status, 'ready');
    assert.match(recovered.repairs!.join(','), /truncated BMP/);
    assert.equal(ambiguous.status, 'blocked');
});
test('PNG inspection decodes IDAT and archive repair verifies all surviving bytes across renamed copies', async (t) => {
    const { src, work, out, put } = await fixture(t);
    const pixels = Buffer.concat(Array.from({length: 96 * 3}, (_, i) => createHash('sha256').update(String(i)).digest()));
    const png = await sharp(pixels, { raw: { width: 96, height: 32, channels: 3 } }).png().toBuffer();
    const short = png.subarray(0, 5000);
    assert.equal((await sharp(short).metadata()).width, 96);
    assert.equal(await inspectArchiveImage(short, 'a.png'), null);
    assert.equal(await inspectArchiveImage(png.subarray(0, png.length - 12), 'a.png'), null);
    // Corrupt the Deflate bytes but keep chunk structure, length and CRC intact.
    const corrupt = Buffer.from(png), idat = corrupt.indexOf('IDAT');
    corrupt.writeUInt16BE(0xffff, idat + 4);
    const crcOffset = idat + 4 + corrupt.readUInt32BE(idat - 4);
    corrupt.writeUInt32BE(crc32(corrupt.subarray(idat, crcOffset)), crcOffset);
    assert.equal((await sharp(corrupt).metadata()).width, 96);
    assert.equal(await inspectArchiveImage(corrupt, 'a.png'), null);

    await put('level/maps/repair.pMs', sample(['old.png'], [1]));
    await put('level/maps/invalid.pMs', sample(['bad.png'], [1]));
    await put('level/textures/Ground.png', await image(6));
    await put('level/scenery-gfx/old.png', short);
    await put('level/scenery-gfx/bad.png', corrupt);
    await put('other/scenery-gfx/renamed.png', png);
    const plan = await analyzeCleanArchive(src, work);
    const repaired = plan.maps.find(m => m.source.includes('repair.pMs'))!;
    assert.equal(repaired.status, 'ready');
    assert.match(repaired.repairs!.join(','), /truncated PNG.*renamed.png/);
    assert.ok(plan.maps.find(m => m.source.includes('invalid.pMs'))?.issues.includes('scenery/bad.png · invalid-image'));
    await exportCleanArchive(plan, out);
    const map = parsePmsFull(await fs.readFile(path.join(out, 'maps', repaired.output!)));
    assert.deepEqual(await fs.readFile(path.join(out, 'scenery-gfx', map.scenery[0].filename)), png);

    // A second valid variant with the same prefix makes recovery ambiguous.
    const end = png.length - 12, chunk = Buffer.alloc(16);
    chunk.writeUInt32BE(4); chunk.write('tEXt', 4); chunk.set([97,0,98,98], 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 12)), 12);
    await put('other/scenery-gfx/another.png', Buffer.concat([png.subarray(0, end), chunk, png.subarray(end)]));
    assert.equal((await analyzeCleanArchive(src, path.join(work, 'retry'))).summary.blockedMaps, 2);
});
test('JPEG scan data and every GIF frame must decode, even with a misleading filename', async () => {
    const raw = Buffer.alloc(64 * 128 * 3);
    raw.fill(255, 64 * 64 * 3);
    const jpeg = await sharp(raw, {raw:{width:64,height:128,channels:3}}).jpeg().toBuffer();
    assert.deepEqual(await inspectArchiveImage(jpeg, 'old.bmp'), {ext:'.jpg',width:64,height:128});
    assert.equal(await inspectArchiveImage(jpeg.subarray(0, jpeg.length - 5), 'old.bmp'), null);
    const gif = await sharp(raw, {raw:{width:64,height:128,channels:3,pageHeight:64}}).gif().toBuffer();
    assert.equal((await sharp(gif, {animated:true}).metadata()).pages, 2);
    assert.deepEqual(await inspectArchiveImage(gif, 'old.bmp'), {ext:'.gif',width:64,height:64});
    assert.equal(await inspectArchiveImage(gif.subarray(0, gif.length - 5), 'old.bmp'), null);
});
test('maps without their own edge do not acquire unrelated optional edge images', async (t) => {
    const { src, work, put } = await fixture(t);
    await put('map/maps/ctf_edge.PMS', sample([], []));
    await put('map/textures/Ground.png', await image(1));
    await put('foreign/textures/edges/Ground.png', await image(5));
    await put('other/textures/edges/Ground.png', await image(6));
    const plan = await analyzeCleanArchive(src, work);
    assert.equal(plan.summary.readyMaps, 1);
    assert.ok(!plan.assets.some(a => a.referenced && a.folder === 'textures/edges'));
});
test('only proven broken collision grids are rebuilt from the current polygons, preserving every nonsector byte', async (t) => {
    const { src, work, out, put } = await fixture(t);
    const m = parsePmsFull(sample(['flag.png'], [1], 'ground.png'));
    m.props[0].width = 3;
    m.props[0].height = 2;
    const grid = compileMapSectors(m.polygons, { fixedDivision: 141, sectorsNum: 8 });
    Object.assign(m, grid);
    const expected = Buffer.from(serializePms(m));
    // A legal custom grid is retained byte-for-byte even if the default compiler differs.
    m.sectorsPolys = [...grid.sectorsPolys];
    m.sectorsPolys[0] = Uint16Array.from([1, 1]);
    const custom = Buffer.from(serializePms(m));
    m.sectorsPolys[1] = Uint16Array.from([0, m.polygons.length + 1, 65535]);
    const broken = Buffer.from(serializePms(m));
    assert.notDeepEqual(custom, expected);
    await put('p/maps/good.pms', custom);
    await put('p/maps/broken.pms', broken);
    await put('p/scenery-gfx/flag.png', await image(11));
    await put('p/textures/ground.png', await image(23));
    const plan = await analyzeCleanArchive(src, work);
    assert.equal(plan.summary.readyMaps, 2);
    const repaired = plan.maps.find(row => row.source.endsWith('/broken.pms'))!;
    const unchanged = plan.maps.find(row => row.source.endsWith('/good.pms'))!;
    assert.equal(repaired.repairedSectorReferences, 3);
    assert.match(repaired.repairs!.join(','), /grid rebuilt/);
    assert.equal(unchanged.outputSha256, unchanged.sha256);
    assert.equal(unchanged.repairedSectorReferences, undefined);
    await exportCleanArchive(plan, out);
    const bytes = await fs.readFile(path.join(out, 'maps', repaired.output!));
    const result = parsePmsFull(bytes);
    assert.equal(result.sectorsDivision, 141);
    assert.equal(result.sectorsNum, 8);
    assert.deepEqual(result.sectorsPolys, grid.sectorsPolys);
    assert.deepEqual(bytes, expected);
    assert.deepEqual(await fs.readFile(path.join(out, 'maps', unchanged.output!)), custom);
    assert.deepEqual(await fs.readFile(path.join(src, 'p/maps/broken.pms')), broken);
});
test('inactive-by-engine styles can be disabled; ambiguous assets, malformed maps and unknown versions stay in review', async (t) => {
    const { src, work, out, put } = await fixture(t), soil = await image(5);
    await put('one/scenery-gfx/Palm.png', await image(9));
    await put('two/scenery-gfx/palm.png', await image(10));
    await put('other/textures/ground.png', soil);
    await put('other/maps/question.PMS', sample(['PALM.png'], [1]));
    await put('other/maps/invalid.pMs', sample([], [222]));
    const old = sample([], []);
    old.writeInt32LE(7);
    await put('other/maps/old.PMS', old);
    await put('other/maps/broken.PMS', Buffer.from('broken'));
    const plan = await analyzeCleanArchive(src, work);
    assert.equal(plan.summary.blockedMaps, 3);
    assert.equal(plan.summary.readyMaps, 1);
    assert.ok(plan.maps.some(m => m.issues.some(i => i.includes('ambiguous'))));
    const fixed = plan.maps.find(m => m.status === 'ready')!;
    assert.match(fixed.repairs!.join(' '), /already unrenderable/);
    await exportCleanArchive(plan, out);
    assert.equal((await fs.readdir(path.join(out, 'review', 'maps'))).length, 3);
    assert.equal(parsePmsFull(await fs.readFile(path.join(out, 'maps',fixed.output!))).props[0].active,false);
});

test('exact source PMS with a unique direct package recovers missing artwork, including paired texture edges', async t => {
    const {src,work,out,put}=await fixture(t);
    const map=sample(['box.bmp'],[1]), asset=await image(41), soil=await image(67), edge=await image(71);
    await put('incomplete/maps/relabeled.pms',map);
    await put('release/maps/original.PMS',map);
    await put('release/scenery-gfx/box.png',asset);
    await put('release/textures/Ground.png',soil);
    await put('release/textures/edges/Ground.png',edge);
    await put('other/scenery-gfx/box.png',await image(84));
    await put('other/textures/Ground.png',await image(92));
    // The Steam copy of the same PMS uses the player's replacement texture.
    const installed=path.join(path.dirname(src),'Soldat');
    for (const dir of ['maps','scenery-gfx','textures']) await fs.mkdir(path.join(installed,dir),{recursive:true});
    await fs.writeFile(path.join(installed,'maps','local.pms'),map);
    await fs.writeFile(path.join(installed,'textures','Ground.png'),await image(130));
    await fs.writeFile(path.join(installed,'scenery-gfx','box.png'),asset);
    const plan=await analyzeCleanArchive(src,work,{includeInstalledMaps:true,includeMissing:true,soldatRoot:installed});
    const restored=plan.maps.find(m=>m.source.includes('incomplete/'))!;
    const original=plan.maps.find(m=>m.source.includes('release/'))!;
    assert.equal(plan.summary.blockedMaps,0);
    assert.equal(plan.summary.incompleteMaps,0);
    assert.notEqual(plan.maps.find(m=>m.source.startsWith('@installed/'))!.output,original.output);
    assert.equal(restored.output,original.output);
    assert.match(restored.repairs!.join(' '),/matched original PMS SHA-256.*release\/maps\/original.PMS/);
    await exportCleanArchive(plan,out);
    const written=parsePmsFull(await fs.readFile(path.join(out,'maps',restored.output!)));
    assert.deepEqual(await fs.readFile(path.join(out,'scenery-gfx',written.scenery[0].filename)),asset);
    assert.deepEqual(await fs.readFile(path.join(out,'textures','edges',written.texture)),edge);
});

test('two releases carrying byte-identical PMS and disagreeing artwork cannot certify a third copy', async t => {
    const {src,work,put}=await fixture(t);
    const map=sample(['box.bmp'],[1]),soil=await image(1);
    for(const pack of ['a','b','c']){
        await put(pack+'/maps/map.pms',map);
        await put(pack+'/textures/ground.png',soil);
    }
    await put('a/scenery-gfx/box.png',await image(2));
    await put('b/scenery-gfx/box.png',await image(3));
    const plan=await analyzeCleanArchive(src,work);
    assert.equal(plan.summary.readyMaps,2);
    assert.deepEqual(plan.maps.find(m=>m.source.startsWith('c/'))!.issues,['scenery/box.bmp · ambiguous']);
});

test('identical original map or matching scenery metadata cannot overwrite an unreadable local variant',async t=>{
    const {src,work,put}=await fixture(t), map=sample(['box.png'],[1]);
    const parsed=parsePmsFull(map);
    parsed.scenery[0].date=0x30b5a1da;
    parsed.props[0]={...parsed.props[0],raw:undefined,width:3,height:2};
    const bytes=serializePms(parsed);
    for(const pack of ['release','damaged']){
        await put(pack+'/maps/map.pms',bytes);
        await put(pack+'/textures/Ground.png',await image(6));
    }
    await put('release/scenery-gfx/box.png',await image(18));
    await put('damaged/scenery-gfx/box.png',Buffer.from('unrecognised local pixels'));
    const plan=await analyzeCleanArchive(src,work);
    assert.deepEqual(plan.maps.find(m=>m.source.startsWith('damaged/'))!.issues,['scenery/box.png · invalid-image']);
});

test('scenery evidence requires a directly packaged map, matching author stamp and intrinsic size, and exclusion of conflicting bytes',async t=>{
    const {src,work,put}=await fixture(t);
    const date=0x30b5a1da;
    function authored(title:string,stamp:number) {
        const m=parsePmsFull(sample(['box.png'],[1]));
        m.mapName=title;
        m.scenery[0].date=stamp;
        m.props[0]={...m.props[0],raw:undefined,width:3,height:2};
        return serializePms(m);
    }
    await put('a/maps/original.pms',authored('Author edition',date));
    await put('a/scenery-gfx/box.png',await image(31));
    await put('b/maps/reuse.pms',authored('Different map',date));
    await put('c/maps/unknown.pms',authored('Wrong date',date+1));
    await put('orphan/scenery-gfx/box.png',await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer());
    await put('common/textures/ground.png',await image(5));
    const plan=await analyzeCleanArchive(src,work);
    const reuse=plan.maps.find(m=>m.source.includes('reuse.pms'))!;
    assert.equal(reuse.status,'ready');
    assert.match(reuse.repairs!.join(' '),/identical authored reference.*3x2.*a\/maps\/original.pms/);
    assert.equal(plan.maps.find(m=>m.source.includes('unknown.pms'))!.status,'blocked');
    await put('another/scenery-gfx/box.png',await image(32));
    const conflicting=await analyzeCleanArchive(src,work+'-conflict');
    assert.equal(conflicting.maps.find(m=>m.source.includes('reuse.pms'))!.status,'blocked');
});
test('equal texture bytes with different edge graphics keep distinct names so each map gets its own edge', async (t) => {
    const { src, work, out, put } = await fixture(t), soil = await image(0);
    for (const [dir, color] of [['a', 1], ['b', 2]] as const) {
        await put(dir + '/maps/Rock.PMS', sample([], []));
        await put(dir + '/textures/Ground.png', soil);
        await put(dir + '/textures/edges/Ground.png', await image(color));
    }
    const plan = await analyzeCleanArchive(src, work);
    assert.equal(plan.summary.readyMaps, 2);
    await exportCleanArchive(plan, out);
    for (const m of plan.maps) {
        const { texture } = parsePmsFull(await fs.readFile(path.join(out, 'maps', m.output!)));
        assert.deepEqual(await fs.readFile(path.join(out, 'textures', 'edges', texture)), await image(m.source.startsWith('a/') ? 1 : 2));
    }
});
test('compaction preserves inactive props and unrelated original bytes when changing a style number', () => {
    const bytes = sample(['never.png', 'kept.png'], [2, 1]), parsed = parsePmsFull(bytes);
    parsed.props[0].raw![33] = 99;
    parsed.props[1].active = false;
    const result = pruneUnusedScenery(parsed);
    assert.equal(result.removedCount, 1);
    assert.deepEqual(result.props.map(p => p.style), [1, 0]);
    assert.equal(result.props[0].raw![33], 99);
    assert.equal(result.props[0].raw![2], 1);
    assert.deepEqual(result.scenery.map(d => d.filename), ['kept.png']);
});
test('portable game assets use fingerprinted names within PMS limits and a different edge changes the texture identity', async t=>{
    const {src,work,out,put}=await fixture(t);
    const tex=await image(2),sc=await image(3);
    for(const [pack,e] of [['green',11],['brown',22]] as const){
        await put(pack+'/maps/a.PmS',sample(['barrel.png'],[1]));
        await put(pack+'/scenery-gfx/barrel.png',sc);
        await put(pack+'/textures/Ground.png',tex);
        await put(pack+'/textures/edges/Ground.png',await image(e));
    }
    const plan=await analyzeCleanArchive(src,work,{portableAssetNames:true});
    assert.equal(plan.portableAssetNames,true);
    assert.equal(plan.summary.readyMaps,2);
    assert.ok(plan.maps.every(m=>m.output!.endsWith('.pms')));
    const texNames=plan.assets.filter(a=>a.referenced&&a.folder==='textures').map(a=>a.name).sort();
    assert.equal(texNames.length,2);assert.equal(new Set(texNames).size,2);
    assert.ok(texNames.every(n=>n.length<=24&&/^s_[a-z0-9_]+_[a-z0-9]{13}\.png$/.test(n)));
    assert.deepEqual(plan.assets.filter(a=>a.referenced&&a.folder==='textures/edges').map(a=>a.name).sort(),texNames);
    assert.equal(plan.assets.filter(a=>a.referenced&&a.folder==='scenery-gfx').length,1);
    await exportCleanArchive(plan,out);
    for(const m of plan.maps){
        const bytes=parsePmsFull(await fs.readFile(path.join(out,'maps',m.output!)));
        assert.ok(texNames.includes(bytes.texture));assert.match(bytes.scenery[0].filename,/^s_barrel_/);
    }
    const allocator=new PortableNames(),h='0123456789abcdef'.repeat(4);
    const a=allocator.allocate('tree.bmp','.bmp',h,24,true);
    const b=allocator.allocate('tree.bmp','.bmp',h.slice(0,16)+'f'.repeat(48),24,true);
    assert.notEqual(a,b);assert.ok(b.length<=24);
});
test('editor scenery cleanup creates one reversible history entry and a repeat is a no-op', () => {
    const map = parsePmsFull(sample(['old.png', 'up.png'], [2]));
    const doc = new EditorDocument({ map, initialBaseName: 'cleanup' });
    const { snapshot, removedCount } = doc.removeUnusedScenery();
    assert.equal(removedCount, 1);
    assert.equal(snapshot.undoStack.length, 1);
    assert.equal(snapshot.map.props[0].style, 1);
    assert.equal(snapshot.map.scenery[0].filename, 'up.png');
    assert.equal(doc.removeUnusedScenery().snapshot, snapshot);
    assert.equal(doc.undo().map, map);
    assert.deepEqual(doc.redo().map.scenery.map(x => x.filename), ['up.png']);
});
test('combined archive keeps valid incomplete maps, available graphics and per-map repair names in the game ZIP',async t=>{
    const {src,work,out,put}=await fixture(t);
    const installed=path.join(path.dirname(src),'Soldat');
    await fs.mkdir(path.join(installed,'maps'),{recursive:true});
    await fs.mkdir(path.join(installed,'textures'),{recursive:true});
    await fs.writeFile(path.join(installed,'maps','Local.PMS'),sample([],[],'live.png'));
    await fs.writeFile(path.join(installed,'textures','LIVE.PNG'),await image(42));
    const source=sample(['orphan.bmp','Lost.PNG','Present.png'],[2,3],'Old.BMP');
    await put('maps/BrokenArt.PMS',source);await put('maps/Twin.pms',source);
    await put('maps/Unreadable.pms',Buffer.alloc(16));
    await put('scenery-gfx/PRESENT.PNG',await image(27));
    await put('textures/edges/Old.png',await image(99));
    const plan=await analyzeCleanArchive(src,work,{includeMissing:true,includeInstalledMaps:true,soldatRoot:installed,portableAssetNames:true});
    assert.equal(plan.summary.readyMaps,2);
    assert.equal(plan.summary.incompleteMaps,1);
    assert.equal(plan.summary.duplicateMaps,1);
    assert.equal(plan.summary.blockedMaps,1);
    await exportCleanArchive(plan,out);
    const result=plan.maps.find(r=>r.status==='ready' && r.missing?.length)!;
    assert.equal(result.sourceMtimeMs,0);
    assert.equal((await fs.stat(path.join(out,'maps',result.output!))).mtimeMs,Date.UTC(1980,0,1));
    const map=parsePmsFull(await fs.readFile(path.join(out,'maps',result.output!)));
    const report='missing/'+result.output!.slice(0,-4)+'.txt';
    const checklist=await fs.readFile(path.join(out,report),'utf8');
    assert.match(checklist,/Scenery:/);assert.match(checklist,/Textures:/);assert.match(checklist,/Edges:/);
    assert.deepEqual(readMissingArtworkText(checklist).map(r=>[r.original,r.expected]),[['Lost.PNG',map.scenery[0].filename],['Old.BMP',map.texture]]);
    assert.equal(map.scenery.length,2);
    assert.equal(map.props[0].style,1);
    assert.deepEqual(await fs.readFile(path.join(out,'scenery-gfx',map.scenery[1].filename)),await image(27));
    assert.deepEqual(await fs.readFile(path.join(out,'textures','edges',path.parse(map.texture).name+'.png')),await image(99));
    const zipfile=path.join(path.dirname(src),'game.zip');
    await writeArchiveGameZip(out,createWriteStream(zipfile));
    const zip=new AdmZip(zipfile);
    assert.equal(zip.readAsText(report),checklist);
    assert.ok(zip.getEntry('maps/'+result.output));
    assert.ok(zip.getEntries().every(e=>!e.entryName.startsWith('review/')&&!e.entryName.startsWith('report/')));
});
test('merged names follow the newest map even when a previous export gave that name to another revision',async t=>{
    const {src,work,put}=await fixture(t);
    const installed=path.join(path.dirname(src),'Soldat'),mapsDir=path.join(installed,'maps');
    await fs.mkdir(mapsDir,{recursive:true});
    const before=sample([],[],'old.png'),after=sample([],[],'new.png');
    await put('RSCS/maps/Race.PMS',before,1_000_000_000);
    await put('textures/old.png',await image(1));await put('textures/new.png',await image(2));
    const previous=await analyzeCleanArchive(src,work+'-prior');
    const active=path.join(mapsDir,'Race.PMS');
    await fs.writeFile(active,after);await fs.utimes(active,1_100_000_000,1_100_000_000);
    const merged=await analyzeCleanArchive(src,work,{soldatRoot:installed,includeInstalledMaps:true,previousMaps:previous.maps});
    assert.equal(merged.maps.find(m=>m.source.startsWith('@installed/'))!.output,'race.pms');
    assert.match(merged.maps.find(m=>m.source.startsWith('RSCS/'))!.output!,/^race_[a-f0-9]+\.pms$/);
    const nested=new AdmZip();nested.addFile('maps/Race.PMS',before);
    nested.getEntry('maps/Race.PMS')!.header.time=new Date(2020,4,12,9,30);
    const outer=new AdmZip();outer.addFile('Race!/pack!.zip',nested.toBuffer());outer.writeZip(path.join(src,'dates.zip'));
    const record={...merged.maps.find(m=>m.source.startsWith('RSCS/'))!,source:'dates.zip!/Race!/pack!.zip!/maps/Race.PMS',sourceMtimeMs:0};
    const unrelated={...record,sha256:'0'.repeat(64)};
    await recoverIndexedMapDates(src,[record,unrelated]);
    assert.equal(new Date(record.sourceMtimeMs).getUTCFullYear(),2020);
    assert.equal(unrelated.sourceMtimeMs,0);
});
test('a newer alias cannot give the original map name to an obsolete revision',()=>{
    const records:ArchiveCleanMap[]=[
      ['Local/Other.pms','a',30],['RSCS/Race.pms','a',20],['Old/Race.pms','b',10]
    ].map(([name,hash,time])=>({source:String(name),sha256:String(hash).repeat(64),outputSha256:String(hash).repeat(64),
        status:'ready',issues:[],sourceMtimeMs:Number(time)}));
    nameLatestMapVariants(records);
    assert.equal(records[0].output,'race.pms');
    assert.equal(records[1].output,'race.pms');
    assert.match(records[2].output!,/^race_b+/);
});
test('ZIP, split ZIP, SMAP and folder packs prune the actual map; preview and CRC manifest match exported bytes', async (t) => {
    const { src, work, out, put } = await fixture(t);
    const bytes = sample(['dead.png', 'used.png'], [2]);
    const originalDate=Date.UTC(2010,6,1,12)/1000;
    await put('maps/ctf_foo.PMS', bytes,originalDate);
    await put('scenery-gfx/used.png', await image(7));
    await put('scenery-gfx/dead.png', await image(8));
    await put('textures/edges/Ground.png',await image(93));
    await put('missing/ctf_foo.txt',Buffer.from('Scenery:\r\nunused-old.png -> dead.png\r\n\r\nTextures:\r\nold-terrain.bmp -> Ground.BMP\r\n\r\nEdges:\r\n'));
    const thumbnails = path.join(work, 'thumbnails');
    await fs.mkdir(thumbnails, { recursive: true });
    const scanner = new SoldatMapScanner(src, [], [], work, thumbnails);
    try {
        await scanner.scanAsync(true);
        for (const mode of ['folder', 'smap', 'zip', 'split'] as const) {
            const options: PackBuildOptions = { mapIds: ['ctf_foo'], packName: 'Prune', outputFormat: mode === 'split' ? 'zip' : mode,
                splitBy: mode === 'split' ? 'prefix' : 'none', excludeUnusedScenery: true, excludeVanillaAssets: false, includePngOverrides: true,
                includeEdgeTextures: true, fixLinuxCase: true, generateMapsListTxt: true, generateReadmeManifest: false, generateCrcManifest: true };
            const preview = buildPackPreview(options, scanner);
            assert.equal(preview.files.find(f => f.category === 'map')?.sizeBytes, bytes.length - 55);
            assert.ok(preview.files.some(f=>f.archivePath==='textures/edges/Ground.png'));
            assert.doesNotMatch(preview.files.find(f=>f.archivePath==='missing/ctf_foo.txt')!.generatedText!,/unused-old/);
            const built = await executePackBuild(options, scanner, path.join(out, mode));
            let data: Buffer, manifest: string | undefined;
            if (mode === 'folder') {
                assert.equal((await fs.stat(path.join(built.outputPath,'maps','ctf_foo.pms'))).mtimeMs,originalDate*1000);
                assert.match(await fs.readFile(path.join(built.outputPath,'missing','ctf_foo.txt'),'utf8'),/Textures:\r\nold-terrain.bmp -> Ground.BMP/);
                data = await fs.readFile(path.join(built.outputPath, 'maps', 'ctf_foo.pms'));
                manifest = await fs.readFile(path.join(built.outputPath, 'maps_crc32_Prune.txt'), 'utf8');
            }
            else {
                const p = mode === 'split' ? path.join(built.outputPath, (await fs.readdir(built.outputPath))[0]) : built.outputPath;
                const zip = new AdmZip(p);
                assert.equal(zip.getEntry('maps/ctf_foo.pms')!.header.time.getFullYear(),2010);
                assert.match(zip.readAsText('missing/ctf_foo.txt'),/Textures:\r\nold-terrain.bmp -> Ground.BMP/);
                data = zip.readFile('maps/ctf_foo.pms')!;
                const name = zip.getEntries().find(e => e.entryName.startsWith('maps_crc32_'))?.entryName;
                if (name)
                    manifest = zip.readAsText(name);
                assert.equal(zip.getEntry('scenery-gfx/dead.png'), null);
            }
            const parsed = parsePmsFull(data);
            assert.deepEqual(parsed.scenery.map(s => s.filename), ['used.png']);
            assert.equal(parsed.props[0].style, 1);
            assert.equal(data.length, bytes.length - 55);
            if (mode !== 'smap')
                assert.ok(manifest?.includes(';' + soldatCrc32(data).toString(16).toUpperCase().padStart(8, '0') + ';' + data.length + ';'));
        }
        assert.deepEqual(await fs.readFile(path.join(src, 'maps', 'ctf_foo.PMS')), bytes);
    }
    finally {
        scanner['sqliteCache'].close();
    }
});
