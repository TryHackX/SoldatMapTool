import type { TunnelPoint as Point } from './climbTunnel';
import type { PmsPolygon } from './pmsParser';
import { pointInTriInclusive } from './polygonGeometry';
import type { TunnelProject } from './tunnelProject';
import { nearestPoint, position, type BoundVertex } from './tunnelProjectGeometry';

/** Bind both gates in the original stroke: another pass may be close in a spiral. */
export function tunnelSectionGates(project: TunnelProject, k: number) {
  const { restKnots, axis } = project;
  const middle = nearestPoint(restKnots[k], axis);
  return {
    entry: Math.max(0, Math.min(middle - 1, nearestPoint(restKnots[k-1], axis))),
    exit: Math.min(axis.length - 1, Math.max(middle + 1, nearestPoint(restKnots[k+1], axis))),
  };
}

interface Gate { center: Point; tangent: Point }

function unit(a: Point, b: Point): Point {
  const dx = b.x-a.x, dy = b.y-a.y, length = Math.hypot(dx,dy) || 1;
  return {x:dx/length,y:dy/length};
}

export function tunnelGateAt(axis: readonly Point[], i: number): Gate {
  const center = axis[i];
  const a = unit(axis[Math.max(0,i-1)],center), b = unit(center,axis[Math.min(axis.length-1,i+1)]);
  return {center,tangent:{x:a.x+b.x,y:a.y+b.y}};
}

interface PinnedSection { project: TunnelProject; inside: (p: Point) => boolean }

const lastSection = new WeakMap<TunnelProject,{terrain: readonly PmsPolygon[]; k: number; pinned: PinnedSection}>();

/** A face crossing a gate must keep all its vertices, since moving even one interior
 * vertex changes the triangle's intersection with the gate. Welded neighbours share
 * these same vertex IDs. Remember the existing pose, including edits from older files. */
export function pinTunnelSection(project: TunnelProject, k: number, terrain: readonly PmsPolygon[],
  indices: ReadonlyMap<string,number>, savedPosition: (vertex: number) => Point) {
  const cached = lastSection.get(project);
  if (cached?.k === k && cached.terrain === terrain) return cached.pinned;
  const {entry,exit} = tunnelSectionGates(project,k);
  const axis = project.axis.map(p=>position(p,project.restKnots,project.knots,project.sections,project.axis,false));
  const start = tunnelGateAt(axis,entry), end = tunnelGateAt(axis,exit);
  const side = (g: Gate, p: Point) => (Math.fround(p.x)-g.center.x)*g.tangent.x + (Math.fround(p.y)-g.center.y)*g.tangent.y;
  const inside = (p: Point) => side(start,p)>0.05 && side(end,p)<-0.05;
  const protectedVertices = new Set<number>();
  const protectedFaces: [Point,Point,Point][] = [];
  const saved = project.sections[k-1];

  const faces = project.faces.slice();
  for (let i=0; i<faces.length; i++) {
    const f = faces[i];
    if (f.landing !== k && !f.v.some(id=>project.vertices[id].weights.some(w=>w[0]===k))) continue;
    const index = indices.get(f.key);
    // A missing or painted source face on the fixed side can stay exactly as the
    // author left it. Its expected pose still tells us which welded neighbours to pin.
    const missing = index === undefined || index < 0;
    const triangle = missing ? f.v.map(savedPosition) as [Point,Point,Point] : terrain[index].vertices;
    if (triangle.every(inside)) {
      if (missing) return null;
      continue;
    }
    protectedFaces.push(triangle);
    for (const id of f.v) protectedVertices.add(id);
    if (f.landing === k && !f.pinnedLanding) faces[i] = {...f,pinnedLanding:true};
  }
  function freeze(p: BoundVertex): BoundVertex {
    const i = p.weights.findIndex(w=>w[0]===k && w.length===3);
    if (i < 0) return p;
    const weights = p.weights.slice(), [owner,bend,lift] = weights[i];
    weights[i] = saved.landingReach ? [owner,bend,lift,saved.widthOffset ?? 0,saved.landingHeight,saved.landingReach] :
      [owner,bend,lift,saved.widthOffset ?? 0,saved.landingHeight];
    return {...p,weights};
  }
  const vertices = project.vertices.map((p,id)=>protectedVertices.has(id) ? freeze(p) : p);
  const footholds = project.footholds?.map(p=>{
    const foot = position(p,project.restKnots,project.knots,project.sections,project.axis,true,project.landings);
    return !inside(foot) || protectedFaces.some(v=>pointInTriInclusive(foot.x,foot.y,...v)) ? freeze(p) : p;
  });
  const pinned = {project:{...project,vertices,footholds,faces},inside};
  lastSection.set(project,{terrain,k,pinned});
  return pinned;
}
