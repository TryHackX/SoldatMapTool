import C from 'clipper-lib';
import earcut from 'earcut';
import { simplifyPolylineRdp } from './imageTracer';
import {joinWallRuns,straightenWallRuns} from './wallRuns';
import {bridgeWallParts,medialWallSegments} from './wallMedialAxis';
import { pointInTriInclusive } from './polygonGeometry';
import { compileMapSectors, createPolygonFromPoints, hasInwardNormals, triangleOverlapsBox } from './pmsCompiler';
import { checkSoldatMapLimits, SOLDAT_MAP_LIMITS, type PmsMapData, type PmsPolygon } from './pmsParser';

export type WallPoint = { x: number; y: number };
export type WallStroke = { mode: 'include' | 'exclude' | 'guide'; radius: number; points: WallPoint[] };
export type WallScope = 'all' | 'painted';
export type WallSettings = { clearance: number; width: number; strokes: WallStroke[]; scope?: WallScope; repairInteriorCells?: boolean };
export type WallPlan = { polygons: PmsPolygon[]; sectorRepairs: {sector:number; polygon:number}[] };
export const defaultWallSettings: WallSettings = { clearance: 2, width: 1, strokes: [] };
export const WALL_PLAN_VERSION=5;
export function wallScope(settings:Pick<WallSettings,'scope'|'strokes'>):WallScope {
  return settings.scope ?? (settings.strokes.length && settings.strokes[0].mode!=='exclude' ? 'painted':'all');
}
const scale = 64;
const finite = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
const validPoint = (p: WallPoint) => p && finite(p.x,-999999,999999) && finite(p.y,-999999,999999);
const scaled = (p: WallPoint): C.IntPoint => ({X: Math.round(p.x*scale), Y: Math.round(p.y*scale)});
const world = (p: C.IntPoint): WallPoint => ({x:p.X/scale,y:p.Y/scale});

export function checkWallSettings(s: WallSettings) {
  if (!s || !Number.isFinite(s.clearance) || s.clearance<0 || !finite(s.width,1,48) ||
      (s.repairInteriorCells!==undefined && typeof s.repairInteriorCells!=='boolean') ||
      (s.scope!==undefined && s.scope!=='all' && s.scope!=='painted') || !Array.isArray(s.strokes) ||
      s.strokes.length > 256 || s.strokes.some(b => !b || !['include','exclude','guide'].includes(b.mode) ||
      !finite(b.radius,4,512) || !Array.isArray(b.points) || !b.points.length || !b.points.every(validPoint)) ||
      s.strokes.reduce((sum,b) => sum+b.points.length,0)>16000) throw Error('Invalid wall mask or settings');
}

export function wallSourceProblem(map:PmsMapData) {
  if (map.version!==11 || map.parseWarnings.length || map.sectorsDivision<1 || map.sectorsNum<1 ||
    map.sectorsNum>25 || map.sectorsPolys?.length!==(map.sectorsNum*2+1)**2 ||
    map.sectorsPolys.some(list=>list.some(id=>id<1 || id>map.polygons.length)))
    return 'Requires a complete version 11 PMS with collision sectors.';
  if (checkSoldatMapLimits({polygonCount:map.polygons.length,sectorsNum:map.sectorsNum,propCount:map.props.length,
    sceneryCount:map.scenery.length,colliderCount:map.colliders.length,spawnCount:map.spawnpoints.length}).length)
    return 'Source exceeds Soldat map limits.';
}

function clip(subject: C.Paths, operation: C.ClipType, clips: C.Paths = []) {
  const tree = new C.PolyTree();
  if (subject.length) {
    const clipper = new C.Clipper();
    clipper.AddPaths(subject,C.PolyType.ptSubject,true);
    clipper.AddPaths(clips,C.PolyType.ptClip,true);
    clipper.Execute(operation,tree,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);
  }
  return tree;
}

function offset(paths: C.Paths, units: number, closed: boolean, tolerance=0.25) {
  const out: C.Paths = [];
  const offsetter = new C.ClipperOffset(2,scale*tolerance);
  offsetter.AddPaths(paths,C.JoinType.jtRound,closed ? C.EndType.etClosedPolygon : C.EndType.etOpenRound);
  offsetter.Execute(out,units*scale);
  return out;
}

function mesh(region: C.ExPolygon) {
  const points = [...region.outer], holes: number[] = [];
  for (const hole of region.holes) {
    holes.push(points.length);
    points.push(...hole);
  }
  const indices = earcut(points.flatMap(p => [p.X,p.Y]),holes);
  const faces: [number,number,number][] = [];
  for (let i=0;i<indices.length;i+=3) faces.push([indices[i],indices[i+1],indices[i+2]]);
  return {points,faces};
}

// Chordal axis of the connected, inset terrain. Use shared chords of the
// triangulation so adjoining walls and bends meet, including around holes.
function centerlines(region: C.ExPolygon): C.Paths {
  const {points,faces} = mesh(region);
  const key = (a:number,b:number) => Math.min(a,b)*points.length+Math.max(a,b);
  const counts = new Map<number,number>();
  for (const face of faces) face.forEach((a,i) => {
    const id = key(a,face[(i+1)%3]);
    counts.set(id,(counts.get(id) ?? 0)+1);
  });
  const paths: C.Paths = [];
  for (const face of faces) {
    const sides = face.map((id,i) => {
      const end = face[(i+1)%3], a = points[id], b = points[end];
      return {mid:{X:Math.round((a.X+b.X)/2),Y:Math.round((a.Y+b.Y)/2)},
        internal:counts.get(key(id,end))===2, len:Math.hypot(a.X-b.X,a.Y-b.Y),tip:points[face[(i+2)%3]]};
    });
    const internal = sides.filter(s=>s.internal);
    if (internal.length===3) {
      const center = {X:Math.round(face.reduce((n,i)=>n+points[i].X,0)/3),
        Y:Math.round(face.reduce((n,i)=>n+points[i].Y,0)/3)};
      for (const side of internal) paths.push([center,side.mid]);
    } else if (internal.length===2) {
      paths.push(internal.map(s=>s.mid));
    } else {
      const cap = sides.filter(s=>!s.internal).sort((a,b)=>a.len-b.len)[0];
      paths.push([cap.mid,internal[0]?.mid ?? cap.tip]);
    }
  }
  return paths;
}

type Terrain = Pick<PmsMapData,'polygons'> & Partial<Pick<PmsMapData,'sectorsPolys'|'sectorsDivision'|'sectorsNum'>>;

function safeRibbons(paths: C.Paths, inset: C.Paths, radius: number) {
  if (!paths.length) return [];
  const lines = new C.Clipper();
  lines.AddPaths(paths.filter(path=>path.length>1),C.PolyType.ptSubject,false);
  lines.AddPaths(inset,C.PolyType.ptClip,true);
  const trimmed = new C.PolyTree();
  lines.Execute(C.ClipType.ctIntersection,trimmed,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);
  const centers = C.Clipper.OpenPathsFromPolyTree(trimmed);
  for (const path of paths) {
    if (path.length!==1) continue;
    const winding = inset.reduce((n,ring)=>C.Clipper.PointInPolygon(path[0],ring)===1
      ? n+(C.Clipper.Orientation(ring)?1:-1) : n,0);
    if (winding) centers.push(path);
  }
  // Square caps give a straight run two triangles and overlap neighbouring
  // branches at their ends. The final interior clip also covers cap corners.
  const strokes=new C.ClipperOffset(),result:C.Paths=[];
  strokes.AddPaths(centers.filter(p=>p.length>1),C.JoinType.jtMiter,C.EndType.etOpenSquare);
  strokes.Execute(result,radius*scale);
  for(const path of centers) if(path.length===1) result.push(...offset([path],radius,false));
  return result;
}

// A hand drawn line may skim the setback on a bend. Follow the nearest
// eligible interior for up to four units, then let safeRibbons trim the rest.
function followInterior(paths:C.Paths,inset:C.Paths):C.Paths {
  if (!paths.length) return [];
  const rings=inset.map(path=>({path,bounds:C.JS.BoundsOfPath(path),sign:C.Clipper.Orientation(path)?1:-1}));
  const lengths=paths.map(path=>path.slice(1).map((p,i)=>Math.hypot(p.X-path[i].X,p.Y-path[i].Y)));
  const step=Math.max(2*scale,lengths.reduce((n,arr)=>arr.reduce((sum,v)=>sum+v,n),0)/16000);
  const reach=scale*4;
  function snap(p:C.IntPoint) {
    const nearby=rings.filter(({bounds:b})=>p.X>=b.left-reach && p.X<=b.right+reach && p.Y>=b.top-reach && p.Y<=b.bottom+reach);
    if (nearby.reduce((n,r)=>n+(C.Clipper.PointInPolygon(p,r.path)===1?r.sign:0),0)) return p;
    let best=reach*reach, nearest=p;
    for(const {path} of nearby) {
      for(let i=0,j=path.length-1;i<path.length;j=i++) {
        const a=path[j],b=path[i],dx=b.X-a.X,dy=b.Y-a.Y,ds=dx*dx+dy*dy;
        if(!ds) continue;
        const k=Math.max(0,Math.min(1,((p.X-a.X)*dx+(p.Y-a.Y)*dy)/ds));
        const x=a.X+k*dx,y=a.Y+k*dy,d=(p.X-x)**2+(p.Y-y)**2;
        if(d<best) {
          best=d;
          const bias=scale*0.12/Math.sqrt(ds);
          nearest={X:Math.round(x-dy*bias),Y:Math.round(y+dx*bias)};
        }
      }
    }
    return nearest;
  }
  return paths.map((path,index)=>{
    const out=[snap(path[0])];
    lengths[index].forEach((len,i)=>{
      const a=path[i],b=path[i+1],n=Math.ceil(len/step);
      for(let j=1;j<=n;j++) out.push(snap({X:Math.round(a.X+(b.X-a.X)*j/n),Y:Math.round(a.Y+(b.Y-a.Y)*j/n)}));
    });
    return simplifyPolylineRdp(out.map(world),0.035).map(scaled);
  });
}

// Some old maps deliberately omit a triangle from particular collision sectors.
// Restrict evidence of solid ground to the cells in which the game tests it.
function indexedTerrain(map: Terrain, ids: number[][], i: number, triangle: C.Path): C.Paths {
  const division = map.sectorsDivision!, n = map.sectorsNum!, side = n*2+1;
  const cell = (v:number) => Math.floor(v/(division*scale)+0.5)+n;
  const xs=triangle.map(p=>cell(p.X)), ys=triangle.map(p=>cell(p.Y));
  const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  const cells = ids[i].filter(k=>{
    const x=Math.floor(k/side), y=k%side;
    return x>=x0 && x<=x1 && y>=y0 && y<=y1;
  });
  if (cells.length===(x1-x0+1)*(y1-y0+1)) return [triangle];
  if (!cells.length) return [];
  // An unlisted cell in the bounding box may be wholly outside the triangle.
  // Keep the original shared edge intact in that case. Splitting it into cell
  // fragments and rounding can create a false crack in an otherwise solid wall.
  if(x0>=0 && x1<side && y0>=0 && y1<side) {
    const indexed=new Set(cells),[a,b,c]=triangle.map(world);
    let complete=true;
    for(let x=x0;x<=x1 && complete;x++) for(let y=y0;y<=y1;y++) {
      if(indexed.has(x*side+y)) continue;
      const left=(x-n-0.5)*division,top=(y-n-0.5)*division;
      if(triangleOverlapsBox(a,b,c,left,top,left+division,top+division)){complete=false;break;}
    }
    if(complete) return [triangle];
  }
  const squares = cells.map(k=>{
    const left=(Math.floor(k/side)-n-0.5)*division*scale, top=(k%side-n-0.5)*division*scale;
    const right=left+division*scale, bottom=top+division*scale;
    return [{X:left,Y:top},{X:right,Y:top},{X:right,Y:bottom},{X:left,Y:bottom}];
  });
  const indexedArea=C.Clipper.ClosedPathsFromPolyTree(clip(squares,C.ClipType.ctUnion));
  return C.Clipper.ClosedPathsFromPolyTree(clip([triangle],C.ClipType.ctIntersection,indexedArea));
}

function wallBrushes(options:WallSettings) {
  let includes:C.Paths=[], excludes:C.Paths=[];
  const handDrawn:C.Paths=[];
  for (const stroke of options.strokes) {
    const points = stroke.points.map(scaled);
    if (stroke.mode==='guide') {handDrawn.push(points);continue;}
    const brush=offset([points],stroke.radius,false);
    if(stroke.mode==='include'){
      includes=C.Clipper.ClosedPathsFromPolyTree(clip([...includes,...brush],C.ClipType.ctUnion));
      excludes=C.Clipper.ClosedPathsFromPolyTree(clip(excludes,C.ClipType.ctDifference,brush));
    } else {
      excludes=C.Clipper.ClosedPathsFromPolyTree(clip([...excludes,...brush],C.ClipType.ctUnion));
      includes=C.Clipper.ClosedPathsFromPolyTree(clip(includes,C.ClipType.ctDifference,brush));
    }
  }
  return {includes,excludes,handDrawn};
}

// Early map makers sometimes indexed a triangle's edges and missed entire
// sector cells inside it. Limit repairs to cells actually brushed by a guide.
function guidedCells(map:Terrain, guides:C.Paths, excludes:C.Paths, width:number) {
  if (!map.sectorsPolys || !guides.length) return [];
  const painted=offset(guides,width/2,false);
  const visible=C.Clipper.ClosedPathsFromPolyTree(clip(painted,C.ClipType.ctDifference,excludes));
  if(!visible.length) return [];
  const div=map.sectorsDivision!, n=map.sectorsNum!, side=2*n+1;
  const cells=new Set<number>();
  for(const path of visible) {
    const b=C.JS.BoundsOfPath(path);
    const cell=(v:number)=>Math.floor(v/(div*scale)+0.5);
    for(let x=Math.max(-n,cell(b.left));x<=Math.min(n,cell(b.right));x++)
      for(let y=Math.max(-n,cell(b.top));y<=Math.min(n,cell(b.bottom));y++) cells.add((x+n)*side+y+n);
  }
  return [...cells].flatMap(sector=>{
    const x=(Math.floor(sector/side)-n)*div, y=(sector%side-n)*div;
    const left=x-div/2, right=x+div/2, top=y-div/2, bottom=y+div/2;
    const corners=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
    return clip([corners.map(scaled)],C.ClipType.ctIntersection,visible).Total() ? [{sector,corners}] : [];
  });
}

export function planWallProtection(map: Terrain, options: WallSettings): WallPlan {
  checkWallSettings(options);
  const empty:WallPlan={polygons:[],sectorRepairs:[]};
  const {includes,excludes,handDrawn}=wallBrushes(options);
  const cells=options.repairInteriorCells===false ? [] : guidedCells(map,handDrawn,excludes,options.width);
  const sectorRepairs:WallPlan['sectorRepairs']=[];
  const terrain: C.Paths = [], existing: C.Paths = [];
  const ids = map.polygons.map(():number[]=>[]);
  map.sectorsPolys?.forEach((list,k)=>{ for (const id of new Set(list)) ids[id-1]?.push(k); });
  for (const [i,p] of map.polygons.entries()) {
    // Walls are only what stops players and bullets alike (OpenSoldat Sprites.pas / Bullets.pas): normal and ice
    // polygons whose stored normals point inwards. Type 2 lets bullets through, so a Deadly strip inside it would
    // start stopping shots. Normals pointing one way make a one-way wall players can cross: such a polygon is kept
    // free of strips like an existing Deadly area, and the clearance is measured from its edge.
    const playerWall = p.polyType===0 || p.polyType===4;
    const solid = playerWall && hasInwardNormals(p);
    if (!playerWall && p.polyType!==5 && p.polyType!==6) continue;
    if (!p.vertices.every(validPoint)) throw Error('Invalid wall coordinates');
    const tri = p.vertices.map(scaled);
    const area = C.Clipper.Area(tri);
    if (!area || (solid && area < 0)) continue;
    if (solid && ids[i].length) {
      for(const {sector,corners} of cells) {
        if (corners.every(v=>pointInTriInclusive(v.x,v.y,...p.vertices)) && !ids[i].includes(sector)) {
          ids[i].push(sector);
          sectorRepairs.push({sector,polygon:i+1});
        }
      }
    }
    const face = area>0 ? tri : tri.reverse();
    const indexed = map.sectorsPolys ? indexedTerrain(map,ids,i,face) : [face];
    (solid ? terrain : existing).push(...indexed);
  }
  const boundary = C.Clipper.ClosedPathsFromPolyTree(clip(terrain,C.ClipType.ctUnion));
  if (!boundary.length) return empty;
  const bounds=C.JS.BoundsOfPaths(boundary);
  const setback=options.clearance+options.width/2+0.15;
  if(setback>=Math.min(bounds.right-bounds.left,bounds.bottom-bounds.top)/(2*scale)) return empty;
  const inset=offset(boundary,-setback,true,0.04);
  if (!inset.length) return empty;
  const interior=offset(boundary,-(options.clearance+0.1),true,0.04);
  const covered = existing.length ? offset(C.Clipper.ClosedPathsFromPolyTree(clip(existing,C.ClipType.ctUnion)),0.25,true) : [];
  const allowed=C.Clipper.ClosedPathsFromPolyTree(clip(interior,C.ClipType.ctDifference,[...covered,...excludes]));
  const paintedArea=wallScope(options)==='all' ? allowed :
    C.Clipper.ClosedPathsFromPolyTree(clip(allowed,C.ClipType.ctIntersection,includes));
  const polygons:PmsPolygon[]=[];
  function nearbyRings(paths:C.Paths) {
    const indexed=paths.map(path=>({path,box:C.JS.BoundsOfPath(path)}));
    return (box:C.IntRect)=>indexed.filter(r=>r.box.left<=box.right && r.box.right>=box.left &&
      r.box.top<=box.bottom && r.box.bottom>=box.top).map(r=>r.path);
  }
  const insetNear=nearbyRings(inset);
  function addRuns(runs:C.Paths,area:C.Paths) {
    if (!runs.length || !area.length) return;
    const areaNear=nearbyRings(area), seen=new Set<string>();
    for(const run of runs) {
      const box=C.JS.BoundsOfPath(run), pad=options.width*scale*2;
      const near={left:box.left-pad,right:box.right+pad,top:box.top-pad,bottom:box.bottom+pad};
      const localArea=areaNear(near);
      if(!localArea.length) continue;
      const inside=safeRibbons([run],insetNear(near),options.width/2);
      for(const region of C.JS.PolyTreeToExPolygons(clip(inside,C.ClipType.ctIntersection,localArea))) {
        const {points,faces}=mesh(region);
        for(const face of faces) {
          const corners=face.map(i=>points[i]);
          const key=corners.map(p=>p.X+','+p.Y).sort().join('|');
          if(seen.has(key)) continue;
          seen.add(key);
          polygons.push(createPolygonFromPoints(corners.map(world) as [WallPoint,WallPoint,WallPoint],
            {polyType:5,color:{r:0,g:0,b:0,a:0}}));
        }
      }
    }
  }
  if (paintedArea.length) {
    const regions=C.JS.PolyTreeToExPolygons(clip(inset,C.ClipType.ctUnion));
    const bounds=regions.map(r=>C.JS.BoundsOfPath(r.outer));
    const area=bounds.reduce((sum,b)=>sum+(b.right-b.left)*(b.bottom-b.top),0);
    const step=Math.max(1.5*scale,Math.sqrt(area/450000));
    for(const [i,region] of regions.entries()) {
      const b=bounds[i];
      // Also cap the longest dimension of unusually thin legacy terrain.
      const localStep=Math.max(step,(b.right-b.left)/1500,(b.bottom-b.top)/1500);
      const {segments,parts}=medialWallSegments(region,localStep);
      let axis=segments;
      if(!axis.length || parts.length>16) axis=centerlines(region);
      else if(parts.length>1) {
        const {points,faces}=mesh(region);
        const bridges=bridgeWallParts(parts,points,faces);
        axis=bridges.length===parts.length-1 ? [...segments,...bridges] : centerlines(region);
      }
      const runs=joinWallRuns(axis,Math.max(15*scale,localStep*5));
      const straight=straightenWallRuns(runs,[region.outer,...region.holes],Math.max(7*scale,localStep*2));
      addRuns(straight,paintedArea);
    }
  }
  // Keep the user's centreline under even a one-unit brush after simplifying.
  const manual=straightenWallRuns(followInterior(handDrawn,inset),inset,scale*Math.min(2,options.width/4),scale*4);
  addRuns(manual,allowed);
  return polygons.length ? {polygons,sectorRepairs} : empty;
}

export function wallsFit(map: Pick<PmsMapData,'polygons'>, addition: readonly PmsPolygon[]) {
  return map.polygons.length+addition.length<=SOLDAT_MAP_LIMITS.maxPolys;
}

export function insertWallProtection(map: PmsMapData, {polygons:addition,sectorRepairs}: WallPlan): PmsMapData {
  if (!addition.length) return map;
  if (!wallsFit(map,addition)) throw Error('PMS polygon limit exceeded (5000)');
  if (!map.sectorsPolys || map.sectorsNum<1 || map.sectorsNum>25 || map.sectorsDivision<1 ||
      map.sectorsPolys.length!==(map.sectorsNum*2+1)**2) throw Error('Invalid PMS collision grid');
  const extra = compileMapSectors(addition,{sectorsNum:map.sectorsNum,fixedDivision:map.sectorsDivision}).sectorsPolys;
  const repaired=new Map<number,number[]>();
  for(const {sector,polygon} of sectorRepairs) {
    const list=repaired.get(sector)??[];
    list.push(polygon);repaired.set(sector,list);
  }
  const sectorsPolys = map.sectorsPolys.map((original,i)=>{
    const restored=repaired.get(i)??[];
    if (!extra[i].length && !restored.length) return original;
    const combined = new Uint16Array(original.length+extra[i].length+restored.length);
    combined.set(extra[i].map(id=>id+map.polygons.length));
    combined.set(original,extra[i].length);
    combined.set(restored,extra[i].length+original.length);
    return combined;
  });
  return {...map,polygons:[...map.polygons,...addition],sectorsPolys};
}
