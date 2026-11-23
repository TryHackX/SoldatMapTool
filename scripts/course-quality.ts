import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { COURSE_MODES,DEFAULT_COURSE,generateCourseMap, type CourseMode } from '../src/shared/courseGenerator';
import { checkTeamCourse } from '../src/client/editor/teamCourseTrials';
import { verifyClimbRoute } from '../src/shared/climbPhysics';
import { validateMapDocument } from '../src/shared/mapValidator';
import { parsePmsFull,serializePms,soldatCrc32 } from '../src/shared/pmsParser';
import { hasInwardNormals } from '../src/shared/pmsCompiler';
import { polygonSignedArea2 } from '../src/shared/polygonGeometry';

const seeds=[0,1,42,123,9876];
function measure(mode:CourseMode,seed:number) {
  const map=generateCourseMap(mode,{...DEFAULT_COURSE,seed},{title:'Offline course test',texture:'default.bmp'});
  const bytes=serializePms(map),disk=parsePmsFull(bytes);
  const errors=validateMapDocument(disk).filter(issue=>issue.severity==='error' || issue.id.startsWith('spawn_inside_poly_')).map(i=>i.id);
  const pms={bytes:bytes.length,checksum:soldatCrc32(bytes)>>>0,byteExact:Buffer.from(bytes).equals(Buffer.from(serializePms(disk))),
    polygons:disk.polygons.length,validFaces:disk.polygons.every(p=>hasInwardNormals(p) && polygonSignedArea2(...p.vertices)>0),
    indexed:new Set(disk.sectorsPolys?.flatMap(s=>Array.from(s))).size,errors};
  const markers=disk.spawnpoints.filter(s=>s.active).map(s=>s.team);
  let passed=pms.byteExact && pms.validFaces && pms.indexed===pms.polygons && !pms.errors.length && !disk.parseWarnings.length;
  if (mode==='ctf' || mode==='trenchwars') {
    const report=checkTeamCourse(disk,mode);
    passed &&= report.runs.length===(mode==='ctf'?4:2) && report.runs.every(r=>r.trial.reached) &&
      report.cover>=(mode==='ctf'?3:6) && (report.minHeadroom??0)>=18;
    return {mode,seed,markers,pms,passed,...report};
  }
  if (mode==='climb') {
    const pilot=verifyClimbRoute(disk,true);
    return {mode,seed,markers,pms,passed:passed && pilot.reached,pilot};
  }
  const faceKey=(vertices:{x:number;y:number}[])=>vertices.map(v=>v.x+','+v.y).sort().join('/');
  const faces=new Set(disk.polygons.map(p=>faceKey(p.vertices)));
  const symmetric=disk.polygons.every(p=>faces.has(faceKey(p.vertices.map(v=>({x:-v.x,y:v.y})))));
  return {mode,seed,markers,pms,symmetric,passed:passed && symmetric && markers.filter(t=>t===0).length>=2};
}
const results=COURSE_MODES.flatMap(mode=>seeds.map(seed=>measure(mode,seed)));
const output=resolve(process.argv[2]??'exports/course-quality.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({version:1,model:'editor',seeds,results},null,2));
console.table(results.map(r=>({mode:r.mode,seed:r.seed,polygons:r.pms.polygons,
  flags:r.runs?.filter(t=>t.trial.reached).length??(r.pilot?.reached?1:undefined),passed:r.passed})));
console.log(output);
if (results.some(r=>!r.passed)) process.exitCode=1;
