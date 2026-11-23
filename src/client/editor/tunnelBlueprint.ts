import { computeMapBounds, prepareMapForSave } from '@shared/pmsCompiler';
import { checkSoldatMapLimits, SOLDAT_MAP_LIMITS, type PmsMapData } from '@shared/pmsParser';
import { createTunnelMap, type TunnelSettings, type generateClimbTunnel } from '@shared/climbTunnel';
import { simplifyPolylineRdp, type Point2D } from '@shared/imageTracer';

export type TunnelDraft = ReturnType<typeof generateClimbTunnel>;
export type TunnelMethod = 'draw' | 'auto';

export function tunnelKnots(points: readonly Point2D[]) {
  // Keep endpoints and bends, independently of zoom and the pointer's reporting frequency.
  return simplifyPolylineRdp(points, 5).map(p => ({x:Math.round(p.x), y:Math.round(p.y)}));
}

/** Keep a gesture separate from the committed sketch until a deliberate drag finishes. */
export class TunnelStroke {
  readonly points: Point2D[];
  private dragged = false;
  constructor(previous: readonly Point2D[], private anchor: number, start: Point2D, private client: Point2D) {
    this.points = anchor >= 0 ? [...previous] : [start];
  }

  sample(world: Point2D, client: Point2D, spacing: number, final = false): boolean {
    if (!this.dragged && Math.hypot(client.x - this.client.x, client.y - this.client.y) < 4) return false;
    this.dragged = true;
    if (this.anchor >= 0) {
      this.points[this.anchor] = world;
      return true;
    }
    const last = this.points[this.points.length - 1];
    const distance = Math.hypot(world.x - last.x, world.y - last.y);
    if (distance === 0 || (!final && (distance < spacing || this.points.length >= 10000))) return false;
    this.points.push(world);
    return true;
  }

  finish(cancelled: boolean): Point2D[] | null {
    if (cancelled || !this.dragged || this.points.length < 2) return null;
    if (this.anchor < 0) {
      const knots = tunnelKnots(this.points);
      return knots.some(p => p.x !== knots[0].x || p.y !== knots[0].y) ? knots : null;
    }
    // A single-knot edit must preserve the other knots, including those near a straight line.
    const p = this.points[this.anchor];
    this.points[this.anchor] = { x: Math.round(p.x), y: Math.round(p.y) };
    return this.points;
  }
}

export function sketchExample(kind:'spiral'|'hills', center:Point2D, width:number): Point2D[] {
  const points:Point2D[]=[];
  for(let i=0;i<=110;i++) {
    const u=i/110;
    if(kind==='spiral') {
      const angle=u*Math.PI*4.3, radius=width*(6.7-5.4*u);
      points.push({x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)});
    } else {
      points.push({x:center.x+(u-0.5)*width*14,
        y:center.y+width*(0.92*Math.sin(u*Math.PI*4)+0.34*Math.sin(u*Math.PI*6))});
    }
  }
  return tunnelKnots(points);
}

export function appendTunnel(map:PmsMapData, draft:TunnelDraft, settings:TunnelSettings, markers:boolean):PmsMapData | null {
  if (!draft.validation.ok || map.polygons.length+draft.polygons.length>SOLDAT_MAP_LIMITS.maxPolys) return null;
  if (markers && map.spawnpoints.length+draft.spawnpoints.length>SOLDAT_MAP_LIMITS.maxSpawnpoints) return null;
  const spawnpoints = markers ? [...map.spawnpoints,...draft.spawnpoints.map((s,i)=>({...s,index:map.spawnpoints.length+i}))] : map.spawnpoints;
  const empty = !map.polygons.length && !map.props.length && !map.spawnpoints.length &&
    !map.colliders.length && !map.waypoints.length && !map.scenery.length;
  const next={...map, polygons:[...map.polygons,...draft.polygons], spawnpoints,
    ...(empty ? {bgColorTop:draft.background.top,bgColorBtm:draft.background.bottom,startJet:0,startJetGame:0,randomId:settings.seed>>>0 & 0x7fffffff} : {})};
  return {...next,...computeMapBounds(next)};
}

/** Test the draft endpoints on the same terrain and with the same fuel as the inserted tunnel. */
export function createDraftTrialMap(draft: TunnelDraft, settings: TunnelSettings, context?: PmsMapData, markers?: boolean) {
  if (!context) return createTunnelMap(draft, settings, { title: 'Tunnel trial', texture: 'default.bmp' });
  const merged = appendTunnel(context, draft, settings, markers ?? !context.spawnpoints.length);
  if (!merged || checkSoldatMapLimits({
    polygonCount: merged.polygons.length, sectorsNum: merged.sectorsNum, propCount: merged.props.length,
    sceneryCount: merged.scenery.length, colliderCount: merged.colliders.length, spawnCount: merged.spawnpoints.length,
  }).length) return null;
  return prepareMapForSave({ ...merged, spawnpoints: draft.spawnpoints }, { geometryDirty: true });
}
