import type { TunnelPoint } from '@shared/climbTunnel';
import type { PmsMapData } from '@shared/pmsParser';
import { tunnelSectionGates, tunnelTrialRoute, type TunnelProject } from '@shared/tunnelProject';
import type { TrialSection } from './tunnelTrial';

/** Locate each editable section in stroke order on the original control mesh. Carry that
 * segment and its fraction onto the deformed axis so an edit near another pass of a spiral
 * never moves the timing marker to that other pass. */
export function projectSplitAnchors(project: Pick<TunnelProject,'axis'|'restKnots'>, centerline: readonly TunnelPoint[]): number[] {
  const axis = project.axis;
  const lengths = [0];
  for (let i=1; i<centerline.length; i++) {
    lengths.push(lengths[i-1] + Math.hypot(centerline[i].x-centerline[i-1].x,centerline[i].y-centerline[i-1].y));
  }
  let previous = 0;
  return project.restKnots.slice(1,-1).map(knot => {
    let station = previous, best = Infinity;
    for (let i=Math.floor(previous); i<axis.length-1; i++) {
      const a = axis[i], b = axis[i+1];
      const dx = b.x-a.x, dy = b.y-a.y;
      const projection = ((knot.x-a.x)*dx + (knot.y-a.y)*dy) / (dx*dx + dy*dy || 1);
      const t = Math.max(0,previous-i,Math.min(1,projection));
      const error = (knot.x-a.x-t*dx)**2 + (knot.y-a.y-t*dy)**2;
      if (error < best) { best = error; station = i+t; }
    }
    previous = station;
    const i = Math.min(axis.length-2,Math.floor(station));
    return lengths[i] + (station-i)*(lengths[i+1]-lengths[i]);
  });
}

export function projectMapMarkers(map: PmsMapData, project: TunnelProject) {
  const others = (map.editorTunnels ?? []).filter(p=>p.id !== project.id);
  const same = (a: {team:number;x:number;y:number}, b: {team:number;x:number;y:number}) =>
    a.team === b.team && a.x === b.x && a.y === b.y;
  return map.spawnpoints.filter(s => (s.team === 1 || s.team === 6) && s.active &&
    (project.spawnpoints?.some(p=>same(p,s)) || !others.some(other=>other.spawnpoints?.some(p=>same(p,s)))));
}

/** The model runs on all current collision geometry but follows only this tunnel's endpoints. */
export function prepareProjectTrial(map: PmsMapData, project: TunnelProject, knotIndex?: number, endpoints: 'project'|'map' = 'project') {
  const route = tunnelTrialRoute(project);
  let section: TrialSection | undefined;
  if (knotIndex !== undefined) {
    if (!Number.isInteger(knotIndex) || knotIndex < 1 || knotIndex >= project.knots.length - 1) throw new RangeError('Invalid tunnel section');
    // Bind the two anchors in the original stroke. Moving a bend towards another turn must
    // never move its trial to that turn. Positions at these indices follow the edited terrain.
    const {entry,exit} = tunnelSectionGates(project,knotIndex);
    let approach = entry, runUp = 0;
    while (approach > 0 && runUp < 84) {
      const a = route.centerline[approach], b = route.centerline[--approach];
      runUp += Math.hypot(a.x - b.x, a.y - b.y);
    }
    section = { approach, entry, exit };
  }
  const spawnpoints = endpoints === 'map' ? projectMapMarkers(map,project) : route.spawnpoints ?? map.spawnpoints;
  const usesSketchEnds = endpoints === 'project' && !!route.spawnpoints && !route.spawnpoints
    .filter(s => s.team === 1 || s.team === 6)
    .every(s => map.spawnpoints.some(m => m.active && m.team === s.team && m.x === s.x && m.y === s.y));
  const {editorTunnels: _recipes, editorSketch: _sketch, ...world} = map;
  return {
    usesSketchEnds,
    request: { map: { ...world, spawnpoints }, centerline: route.centerline, footholds: route.footholds, section,
      ...(!section && {splitAnchors:projectSplitAnchors(project,route.centerline)}) },
  };
}
