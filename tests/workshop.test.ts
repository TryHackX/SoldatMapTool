import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { SoldatMapScanner } from '../src/server/soldatScanner';
import { SoldatMapWorkshop, WorkshopError } from '../src/server/mapFixerOptimizer';
import { parsePmsFull } from '../src/shared/pmsParser';
import { buildSyntheticPms } from './helpers';
import type { OptimizeMapOptions } from '../src/shared/apiTypes';

function makeTempEnv(maps: Record<string, Uint8Array | Buffer>) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-workshop-test-'));
  const root = path.join(base, 'Soldat');
  fs.mkdirSync(path.join(root, 'maps'), { recursive: true });
  for (const [name, bytes] of Object.entries(maps)) {
    fs.writeFileSync(path.join(root, 'maps', `${name}.pms`), bytes);
  }
  const cache = path.join(base, 'cache');
  const thumbs = path.join(cache, 'thumbnails');
  fs.mkdirSync(thumbs, { recursive: true });
  return { base, root, cache, thumbs };
}

const isConflict = (e: unknown) => e instanceof WorkshopError && e.status === 409;

test('unreadable .pms files stay in the index as incompatible entries', async () => {
  const env = makeTempEnv({
    ctf_ok: buildSyntheticPms({ props: 2 }),
    ctf_broken: Buffer.from('definitely not a soldat map'),
  });
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  const meta = await scanner.scanAsync(true);

  assert.equal(meta.totalMaps, 2, 'a broken file must not disappear from the index');
  assert.equal(meta.incompatibleMapsCount, 1);
  assert.equal(scanner.getScanStatus().failedFiles, 1);
  const broken = scanner.getMapEntry('ctf_broken');
  assert.ok(broken);
  assert.ok(broken.parseWarnings.some((w) => w.includes('Cannot read')));
  assert.equal(scanner.getMapEntry('ctf_ok')?.parseWarnings.length, 0);
});

test('overwrite policy: "own" replaces only an unchanged previous output of the same map, with a backup', async () => {
  const env = makeTempEnv({ ctf_policy: buildSyntheticPms({ props: 3, scenery: ['a.png', 'unused.png'] }) });
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(
    scanner,
    path.join(env.base, 'exports'),
    env.cache,
    path.join(env.base, 'backups')
  );
  const req = {
    mapId: 'ctf_policy',
    removeUnusedScenery: true,
    maxBaseLength: 24,
    destination: 'exports_fixed' as const,
  };

  const first = await workshop.fixMap171(req, true, 'never');
  assert.equal(first.derivedBaseName, 'ctf_policy_f');
  assert.ok(fs.existsSync(first.outputPath));
  assert.equal(first.backupDir, null, 'nothing was overwritten, so no backup folder');

  await assert.rejects(workshop.fixMap171(req, true, 'never'), isConflict);

  const second = await workshop.fixMap171(req, true, 'own');
  assert.ok(second.backupDir, 'replacing a file must back it up first');
  assert.ok(fs.existsSync(path.join(second.backupDir!, path.basename(second.outputPath))));

  // Someone edited the output: it is not an unchanged Studio file anymore and must never be replaced
  fs.appendFileSync(second.outputPath, Buffer.from([0]));
  await assert.rejects(workshop.fixMap171(req, true, 'own'), isConflict);

  // Explicit confirmation still works
  const third = await workshop.fixMap171(req, true, 'always');
  assert.ok(third.backupDir);
});

test('a derived map name never targets the source file itself', async () => {
  // A 28-char name shortened to fit 24 chars with "_f" must not collide with the source written next to it
  const env = makeTempEnv({ ctf_abcdefghijklmnopqrstuvwx: buildSyntheticPms({ props: 1 }) });
  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(
    scanner,
    path.join(env.base, 'exports'),
    env.cache,
    path.join(env.base, 'backups')
  );
  const out = await workshop.fixMap171(
    { mapId: 'ctf_abcdefghijklmnopqrstuvwx', removeUnusedScenery: false, maxBaseLength: 24, destination: 'soldat_maps' },
    true,
    'never'
  );
  assert.notEqual(out.derivedBaseName.toLowerCase(), 'ctf_abcdefghijklmnopqrstuvwx');
  assert.ok(out.derivedBaseName.length <= 24);
  assert.ok(fs.existsSync(path.join(env.root, 'maps', 'ctf_abcdefghijklmnopqrstuvwx.pms')), 'source untouched');
});

test('archive (_a): the map gets its own copies of the sceneries it still uses and of its texture', async () => {
  const env = makeTempEnv({
    // prop 0 (back) is baked, prop 1 (middle) and prop 2 (front) stay single props; unused.png is not used at all
    ctf_arch: buildSyntheticPms({ props: 3, scenery: ['tree.bmp', 'rock.bmp', 'ghost.png', 'unused.png'] }),
  });
  const write = (rel: string, bytes: Buffer) => {
    fs.mkdirSync(path.dirname(path.join(env.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(env.root, rel), bytes);
  };
  const rockPng = await sharp({ create: { width: 6, height: 4, channels: 4, background: { r: 90, g: 60, b: 30, alpha: 1 } } })
    .png()
    .toBuffer();
  write('scenery-gfx/tree.png', rockPng);
  write('scenery-gfx/rock.png', rockPng); // the map asks for rock.bmp: the game loads the HD .png override
  write('scenery-gfx/unused.png', rockPng);
  write('textures/default.bmp', Buffer.from('BM fake texture bytes'));
  write('textures/edges/default.png', Buffer.from('fake edge bytes'));

  const scanner = new SoldatMapScanner(env.root, [], [], env.cache, env.thumbs);
  await scanner.scanAsync(true);
  const workshop = new SoldatMapWorkshop(scanner, path.join(env.base, 'exports'), env.cache, path.join(env.base, 'backups'));
  const options = {
    mergeBack: true,
    mergeMid: false,
    mergeFront: false,
    supersample: 2 as const,
    maxTilePx: 2048 as const,
    preserveGiantProps: false,
    giantPropThresholdPx: 1600,
    skipIsolatedSingleProps: false,
    removeUnusedScenery: false, // the archive removes unused entries anyway
    preferClassicBmp: false,
    maxBaseLength: 24,
    destination: 'exports_optimized' as const,
    archive: true,
  };

  const plan = await workshop.planSceneryOptimization('ctf_arch', options);
  assert.equal(plan.derivedBaseName, 'ctf_arch_a');
  assert.equal(plan.groups.length, 1);
  const grp = plan.groups[0];
  const sessionId = workshop.startOptimizeSession('ctf_arch', options);
  await workshop.addOptimizeTile(
    sessionId,
    {
      tileFileName: 'ctf_arch_a_b1.png',
      level: 0,
      insertOrderKey: grp.insertOrderKey,
      worldX: grp.worldBounds.left,
      worldY: grp.worldBounds.top,
      scaleX: 0.5,
      scaleY: 0.5,
    },
    rockPng
  );
  const result = await workshop.commitOptimizeSession(sessionId, 'never', true);

  const outDir = path.join(env.base, 'exports', 'archived_maps');
  assert.equal(result.outputMapPath, path.join(outDir, 'maps', 'ctf_arch_a.pms'));
  const out = parsePmsFull(fs.readFileSync(result.outputMapPath));
  assert.deepEqual(
    out.scenery.map((s) => s.filename),
    ['ctf_arch_a_s1.png', 'ghost.png', 'ctf_arch_a_b1.png'],
    'baked and unused sceneries are gone, the kept one is renamed, a missing file keeps its name'
  );
  assert.deepEqual(fs.readdirSync(path.join(outDir, 'scenery-gfx')).sort(), ['ctf_arch_a_b1.png', 'ctf_arch_a_s1.png']);
  assert.deepEqual(fs.readFileSync(path.join(outDir, 'scenery-gfx', 'ctf_arch_a_s1.png')), rockPng, 'byte-for-byte copy');
  assert.equal(out.texture, 'ctf_arch_a.bmp');
  assert.equal(fs.readFileSync(path.join(outDir, 'textures', 'ctf_arch_a.bmp'), 'utf-8'), 'BM fake texture bytes');
  assert.equal(fs.readFileSync(path.join(outDir, 'textures', 'edges', 'ctf_arch_a.png'), 'utf-8'), 'fake edge bytes');
  assert.deepEqual(result.archive, {
    copiedFiles: 1,
    copiedBytes: rockPng.byteLength,
    texture: 'ctf_arch_a.bmp',
    textureEdge: true,
    missing: ['ghost.png'],
  });
  assert.ok(fs.existsSync(path.join(env.root, 'scenery-gfx', 'rock.png')), 'the shared originals stay untouched');
});

test('package-specific repair and archive reject stale previews and foreign images, and roll back a partial write', async t => {
  const env = makeTempEnv({});
  const pack = path.join(env.base,'archive','first');
  const asset = 'fx_p_cloud1.png';
  const image = async (width: number) => sharp({create:{width,height:6,channels:4,background:'#286090'}}).png().toBuffer();
  const put = (root: string, rel: string, bytes: Uint8Array | string) => {
    const file = path.join(root,rel);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,bytes);
  };
  put(env.root,'scenery-gfx/'+asset,await image(42));
  put(env.root,'readonly.txt','scenery-gfx/'+asset);
  put(env.root,'textures/default.bmp','stock');
  const art = await image(23);
  put(pack,'scenery-gfx/'+asset,art);
  put(pack,'textures/default.bmp','package');
  const source = buildSyntheticPms({props:2,scenery:[asset,'missing.png','unused.png'],propSizes:[{width:0,height:0}]});
  put(pack,'maps/one.pms',source);
  const scanner = new SoldatMapScanner(env.root,[{id:'pack',label:'Pack',path:pack,enabled:true,recursive:true}],[],env.cache,env.thumbs);
  t.after(() => { scanner['sqliteCache'].close(); fs.rmSync(env.base,{recursive:true,force:true}); });
  await scanner.scanAsync(true);
  const id = scanner.getAllEntries()[0].id;
  const workshop = new SoldatMapWorkshop(scanner,path.join(env.base,'exports'),env.cache,path.join(env.base,'backups'));
  const analysis = await workshop.analyzeMapFor171Fix(id);
  assert.deepEqual(analysis.issues.map(i => [i.expectedWidth,i.expectedHeight]),[[23,6]]);
  const options: OptimizeMapOptions = {mergeBack:true,mergeMid:true,mergeFront:true,supersample:1,maxTilePx:2048,
    preserveGiantProps:false,giantPropThresholdPx:1600,skipIsolatedSingleProps:false,removeUnusedScenery:true,
    preferClassicBmp:false,archive:true,maxBaseLength:24,fixFirst:true,destination:'exports_optimized'};
  const plan = await workshop.planSceneryOptimization(id, options);
  assert.equal(plan.preservedSample.find(p => p.propIndex === 1)?.reason,'missing_image');
  const expected = {derivedBaseName:plan.derivedBaseName,propFixes:plan.appliedPropFixes,sourceCrc32:plan.sourceCrc32,
    sourceGraphicsKey:plan.sourceGraphicsKey,tileCount:0};
  const start = (config=options) => workshop.startOptimizeSession(id,config);
  // Touch only scenery bytes, keeping its dimensions and the map filename unchanged.
  put(pack,'scenery-gfx/'+asset,Buffer.concat([art,Buffer.from('updated')]));
  await assert.rejects(workshop.commitOptimizeSession(start(),'never',true,expected),isConflict);
  put(pack,'scenery-gfx/'+asset,art);
  const fresh = await workshop.planSceneryOptimization(id, options);
  const uploading = start();
  const upload = workshop.addOptimizeTile(uploading,{tileFileName:'layer.png',level:0,insertOrderKey:fresh.groups[0].insertOrderKey,
    worldX:0,worldY:0,scaleX:1,scaleY:1},art);
  await assert.rejects(workshop.commitOptimizeSession(uploading,'never',true),isConflict);
  await upload;
  workshop.cancelOptimizeSession(uploading);

  const copyOptions = {...options,mergeBack:false};
  const copyPlan = await workshop.planSceneryOptimization(id,copyOptions);
  const target = path.join(env.base,'exports','archived_maps');
  const graphic = path.join(target,'scenery-gfx',copyPlan.derivedBaseName+'_s1.png');
  const mapFile = path.join(target,'maps',copyPlan.derivedBaseName+'.pms');
  const commit = () => workshop.commitOptimizeSession(start(copyOptions),'always',true);
  put(target,path.relative(target,graphic),'belongs to a different map');
  await assert.rejects(commit(),isConflict);
  assert.equal(fs.readFileSync(graphic,'utf8'),'belongs to a different map');
  assert.equal(fs.existsSync(mapFile),false);
  fs.unlinkSync(graphic);

  const rename = fs.renameSync;
  const failLast = t.mock.method(fs,'renameSync',(from:fs.PathLike,to:fs.PathLike) => {
    if (to === mapFile) throw Error('simulated failure saving map');
    return rename(from,to);
  });
  try { await assert.rejects(commit(),/simulated failure saving map/); }
  finally { failLast.mock.restore(); }
  assert.ok(!fs.existsSync(graphic) && !fs.existsSync(mapFile));
  for (const dir of ['scenery-gfx','maps','textures']) assert.deepEqual(fs.readdirSync(path.join(target,dir)),[]);
  await commit();
  assert.deepEqual(fs.readFileSync(graphic),art);
  const saved = parsePmsFull(fs.readFileSync(mapFile));
  assert.equal(fs.readFileSync(path.join(target,'textures',saved.texture),'utf8'),'package');
  assert.ok(saved.scenery.some(s => s.filename === 'missing.png'));
  put(pack,'maps/one.pms',Buffer.concat([source,Buffer.from([1])]));
  await assert.rejects(workshop.commitOptimizeSession(start(copyOptions),'always',true,{...expected,sourceGraphicsKey:copyPlan.sourceGraphicsKey}),isConflict);
});
