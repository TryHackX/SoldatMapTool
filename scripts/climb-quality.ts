import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { generateClimbTunnel, createTunnelMap, type TunnelPoint } from '../src/shared/climbTunnel';
import { loadTestedTunnel, type TestedTunnel } from '../src/client/editor/testedTunnels';
import { createTunnelProject } from '../src/shared/tunnelProject';
import { prepareProjectTrial } from '../src/client/editor/projectTrialRoute';
import { runTunnelTrial } from '../src/client/editor/tunnelTrial';
import { hasInwardNormals, polygonSignedArea2 } from '../src/shared/pmsCompiler';
import { parsePmsFull, serializePms, SOLDAT_MAP_LIMITS, soldatCrc32 } from '../src/shared/pmsParser';

interface QualityCase {
  name: string;
  example: TestedTunnel;
  path?: (original: TunnelPoint[]) => TunnelPoint[];
  expected: 'flag' | 'valid' | 'tight';
}

const cases: QualityCase[] = [
  {name:'hills', example:'hills', expected:'flag'},
  {name:'switchbacks', example:'winding', expected:'flag'},
  {name:'spiral-clockwise', example:'spiral', expected:'flag'},
  {name:'spiral-counterclockwise', example:'spiral', path:line=>line.map(p=>({x:-p.x,y:p.y})), expected:'valid'},
  {name:'shaft-up', example:'hills', path:()=>[{x:0,y:400},{x:0,y:-350}], expected:'valid'},
  {name:'nearby-passages', example:'winding', path:()=>[{x:0,y:0},{x:220,y:0},{x:250,y:6},{x:220,y:12},{x:0,y:12}], expected:'tight'},
];

function measure(item: QualityCase) {
  const recipe = loadTestedTunnel(item.example);
  const path = item.path ? item.path(recipe.path) : recipe.method==='draw' ? recipe.path : undefined;
  const start = performance.now();
  const draft = generateClimbTunnel(recipe.settings,path);
  const generationMs = +(performance.now()-start).toFixed(2);
  const base = {shape:item.name, seed:recipe.settings.seed, settings:recipe.settings, path:path ?? null, expected:item.expected,
    generationMs, validation:draft.validation, polygons:draft.polygons.length};
  if (!draft.validation.ok) return {...base, pms:null, pilot:null, passed:item.expected===draft.validation.reason && !draft.polygons.length};
  const map = createTunnelMap(draft,recipe.settings,{title:item.name,texture:'default.bmp'});
  const project = createTunnelProject(draft,recipe.settings,path);
  const bytes = serializePms(map), decoded = parsePmsFull(bytes);
  const invalidFaces = decoded.polygons.filter(p=>polygonSignedArea2(...p.vertices)<=0 || !hasInwardNormals(p)).length;
  const sectors = decoded.sectorsPolys ?? [];
  const pms = {crc32:soldatCrc32(bytes)>>>0, byteExact:Buffer.from(bytes).equals(Buffer.from(serializePms(decoded))),
    warnings:decoded.parseWarnings, invalidFaces, indexedPolygons:new Set(sectors.flatMap(s=>Array.from(s))).size};
  const {request} = prepareProjectTrial(decoded,project,undefined,'map');
  const trialStart = performance.now();
  const trial = runTunnelTrial(request.map,request.centerline,request.footholds,undefined,false,request.splitAnchors);
  const pilot = {reached:trial.reached, reason:trial.reason, elapsedSeconds:trial.ticks/60, progress:trial.progress,
    runtimeMs:+(performance.now()-trialStart).toFixed(2), trace:trial.trace, splits:trial.splits};
  return {...base,pms,pilot,passed:item.expected!=='tight' && (item.expected!=='flag' || pilot.reached) &&
    !invalidFaces && !pms.warnings.length && pms.byteExact && decoded.polygons.length<=SOLDAT_MAP_LIMITS.maxPolys &&
    pms.indexedPolygons===decoded.polygons.length};
}

const results = cases.map(measure);
const output = resolve(process.argv[2] ?? 'exports/climb-quality.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({version:1, runtime:process.version, measuredAt:new Date().toISOString(), results},null,2));
console.table(results.map(({shape,polygons,generationMs,validation,pilot,passed})=>({shape,polygons,generationMs,
  clearance:validation.ok ? +validation.minClearance.toFixed(1) : null, pilot:pilot ? pilot.reached ? 'flag' : pilot.reason : validation.reason,
  seconds:pilot ? +pilot.elapsedSeconds.toFixed(2) : null, passed})));
console.log(output);
if (results.some(r=>!r.passed)) process.exitCode=1;
