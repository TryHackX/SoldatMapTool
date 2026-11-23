import { parsePmsFull, serializePms, type PmsMapData } from '@shared/pmsParser';
import { MAX_TUNNEL_ROUTE_LENGTH } from '@shared/climbTunnel';
import { SOLDIER_COLLISION } from '@shared/soldatConstants';
import { tunnelGateAt } from '@shared/tunnelSectionGates';
import { pointInTriInclusive, segmentsIntersect } from '@shared/polygonGeometry';
import { EditorSpatialIndex } from './spatialIndex';
import { createSoldierPlaytestState, doesPolyCollideSoldier, stepSoldierPlaytest, type SoldierPlaytestState } from './soldierPlaytest';

import { finishRunSplits, planRunSplits, type SplitStamp, type TunnelRunSplit } from './tunnelRunSplits';
export type { TunnelRunSplit } from './tunnelRunSplits';

interface Point { x: number; y: number }
type Failure = 'missing-spawn' | 'missing-flag' | 'invalid-route' | 'no-run-up' | 'pilot-stalled' | 'budget';
export interface TunnelTrialResult {
  reached: boolean; progress: number; ticks: number; trace: Point[]; reason?: Failure;
  /** Fractional 60 Hz ticks between the two fixed section gates, excluding the approach. */
  sectionTicks?: number;
  /** Contiguous pieces of a single flag run, when editable route anchors were supplied. */
  splits?: TunnelRunSplit[];
}
export interface TrialSection { approach: number; entry: number; exit: number }
export interface TunnelTrialRequest { map: PmsMapData; centerline: Point[]; footholds?: Point[]; section?: TrialSection; splitAnchors?: number[] }

/** The game reads single-precision vertices and normals. At a ledge this can change the chosen landing. */
export function runPmsTunnelTrial(map: PmsMapData, centerline: readonly Point[], footholds?: readonly Point[], section?: TrialSection,
  splitAnchors?: readonly number[], followLane = false) {
  const saved = parsePmsFull(serializePms(map));
  return runTunnelTrial(saved, centerline, footholds, section, false, splitAnchors, followLane);
}

/** The planner can cheaply check many sets of terrain against a complete successful input sequence. */
export function recordPmsFlagTrial(map: PmsMapData, line: readonly Point[], footholds: readonly Point[], splitAnchors?: readonly number[]) {
  const saved = parsePmsFull(serializePms(map));
  const {controls,finishFraction: _fraction,...trial}:DriveResult = runTunnelTrial(saved,line,footholds,undefined,true,splitAnchors);
  return {trial,controls};
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const delta = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });
const valid = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
const BRANCH_TICKS = 14;
const MAX_STEPS = 190000;
const GATE_SPACING = 42;
const BEAM_WIDTH = 6;
interface DrivingPolicy { aim: 'gate' | 'shelf' | 'left' | 'right' | 'hold'; jump: boolean; jet?: boolean }
const FLOOR_POLICIES: DrivingPolicy[] = [
  { aim: 'gate', jump: false }, { aim: 'gate', jump: true },
  { aim: 'shelf', jump: false }, { aim: 'shelf', jump: true },
];
const SHAFT_POLICIES: DrivingPolicy[] = [
  ...FLOOR_POLICIES, { aim: 'hold', jump: true }, { aim: 'left', jump: true },
  { aim: 'right', jump: false }, { aim: 'right', jump: true },
];
const RETRY_SHAFT_POLICIES: DrivingPolicy[] = [...SHAFT_POLICIES, { aim: 'left', jump: false }];
const JET_POLICY: DrivingPolicy = {aim:'gate',jump:false,jet:true};
const replayInput = (mask:number) => ({left:!!(mask&1),right:!!(mask&2),jump:!!(mask&4),jetpack:!!(mask&8),crouch:false});

// Candidate lists in the editor's picking grid can include the entire rock wall. Cache a tighter
// bounding-box query per 16-unit tile while preserving polygon order for collision resolution.
class TrialIndex extends EditorSpatialIndex {
  private cache = new Map<string, number[]>();
  private bounds;
  constructor(map: PmsMapData) {
    super(map);
    this.bounds = map.polygons.map(({ vertices }) => ({
      left: Math.min(...vertices.map(v => v.x)), right: Math.max(...vertices.map(v => v.x)),
      top: Math.min(...vertices.map(v => v.y)), bottom: Math.max(...vertices.map(v => v.y)),
    }));
  }
  override queryPolygonCandidates(left: number, top: number, right: number, bottom: number): number[] {
    if (right - left > 32 || bottom - top > 32) return super.queryPolygonCandidates(left, top, right, bottom);
    const gx = Math.floor((left + right) / 32), gy = Math.floor((top + bottom) / 32);
    const key = gx + ',' + gy;
    let hits = this.cache.get(key);
    if (hits) return hits;
    left = (gx - 1) * 16; right = (gx + 2) * 16;
    top = (gy - 1) * 16; bottom = (gy + 2) * 16;
    hits = super.queryPolygonCandidates(left, top, right, bottom).filter(i => {
      const box = this.bounds[i];
      return box.left <= right && box.right >= left && box.top <= bottom && box.bottom >= top;
    });
    this.cache.set(key, hits);
    return hits;
  }
}

interface Gate { center: Point; tangent: Point; left: number; right: number; along: number; boundary?: 'entry' | 'exit'; endsSplit?: boolean }

function routeGates(line: readonly Point[], spawn: Point, flag: Point, section?: TrialSection, finishAtFlag = true, fixedTiming = false) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + dist(line[i - 1], line[i]));
  const total = lengths.at(-1)!;
  if (total < 8 || total > MAX_TUNNEL_ROUTE_LENGTH) return [];

  function sample(along: number) {
    let lo = 0, hi = line.length - 1;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (lengths[m] < along) lo = m;
      else hi = m;
    }
    const t = (along - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
    return { x: line[lo].x + (line[hi].x - line[lo].x) * t, y: line[lo].y + (line[hi].y - line[lo].y) * t };
  }

  // The end pedestals may be displaced from the end of the stroke. Project them onto the
  // respective end only: the two ends can be side by side on a winding map.
  function trim(p: Point, end: boolean) {
    let best = Infinity, result = end ? total : 0;
    const limit = Math.min(total / 4, 120);
    for (let offset = 0; offset <= limit; offset += 4) {
      const along = end ? total - offset : offset;
      const d = dist(sample(along), p);
      if (d < best) { best = d; result = along; }
    }
    return result;
  }
  const start = section?.approach ? lengths[section.approach] : trim(spawn, false);
  const finish = section && !finishAtFlag ? lengths[section.exit] : trim(flag, true);
  const stations: number[] = [];
  for (let along = start + GATE_SPACING; along < finish - 12; along += GATE_SPACING) stations.push(along);
  if (section) {
    const entry = lengths[section.entry];
    // Put the entry and exit on the actual route. Very close gates could otherwise both be crossed in one tick.
    const boundaries = finishAtFlag ? [entry] : [entry, finish];
    for (const required of boundaries) {
      if ((!fixedTiming && required <= start + 1) || (finishAtFlag && required >= finish - 12)) continue;
      for (let i = stations.length - 1; i >= 0; i--) if (Math.abs(stations[i] - required) < 12) stations.splice(i, 1);
      stations.push(required);
    }
    stations.sort((a,b) => a-b);
  }
  const gates: Gate[] = [];
  for (const along of stations) {
    const boundary = section && along === lengths[section.entry] ? 'entry' : section && along === lengths[section.exit] ? 'exit' : undefined;
    const fixedGate = fixedTiming && section && boundary ? tunnelGateAt(line,section[boundary]) : undefined;
    const center = fixedGate?.center ?? sample(along);
    const d = fixedGate?.tangent ?? delta(sample(Math.max(0, along - 4)), sample(Math.min(total, along + 4)));
    const len = Math.hypot(d.x, d.y);
    if (!len) continue;
    const tangent = { x: d.x / len, y: d.y / len };
    const normal = { x: -tangent.y, y: tangent.x };
    let left = 188, right = 188;
    // Bisect the distance to another pass of the route on each side. A nearby turn must
    // never be credited for crossing this gate from the wrong tunnel.
    for (let i = 1; i < line.length; i++) {
      if (lengths[i] > along - 80 && lengths[i - 1] < along + 80) continue;
      const seg = delta(line[i - 1], line[i]);
      const t = Math.max(0, Math.min(1, dot(delta(line[i - 1], center), seg) / (dot(seg, seg) || 1)));
      const q = { x: line[i - 1].x + t * seg.x - center.x, y: line[i - 1].y + t * seg.y - center.y };
      const side = dot(q, normal);
      if (side > 0.01) right = Math.min(right, dot(q, q) / (2 * side));
      if (side < -0.01) left = Math.min(left, dot(q, q) / (-2 * side));
    }
    gates.push({ center, tangent, left, right, along, boundary });
  }
  return gates;
}

function gateCrossing(g: Gate, prev: Point, next: Point): number | undefined {
  const a = dot(delta(g.center, prev), g.tangent), b = dot(delta(g.center, next), g.tangent);
  if (a > 0.001 || b < 0 || b <= a) return undefined;
  const t = Math.max(0, -a / (b - a));
  const x = prev.x + t * (next.x - prev.x) - g.center.x, y = prev.y + t * (next.y - prev.y) - g.center.y;
  const side = y * g.tangent.x - x * g.tangent.y;
  return side >= -g.left && side <= g.right ? t : undefined;
}

function clearSegment(a: Point, b: Point, index: TrialIndex) {
  for (const col of index.map.colliders) {
    if (!col.active) continue;
    const seg = delta(a, b);
    const t = Math.max(0, Math.min(1, dot(delta(a, col), seg) / (dot(seg, seg) || 1)));
    if (Math.hypot(a.x + t * seg.x - col.x, a.y + t * seg.y - col.y) < Math.max(1, Math.abs(col.radius) / 2)) return false;
  }
  const hits = index.queryPolygonCandidates(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  for (const i of hits) {
    const poly = index.map.polygons[i];
    if (!doesPolyCollideSoldier(poly.polyType, 1, false)) continue;
    const v = poly.vertices;
    if (pointInTriInclusive(b.x, b.y, ...v)) return false;
    for (let j = 0; j < 3; j++) {
      if (segmentsIntersect(a.x, a.y, b.x, b.y, v[j].x, v[j].y, v[(j + 1) % 3].x, v[(j + 1) % 3].y)) return false;
    }
  }
  return true;
}

function aimForShelf(s: SoldierPlaytestState, options: Point[], jump: boolean) {
  const vy = jump && s.grounded ? -2.85 : s.vy;
  let cost = Infinity, target: Point | undefined;
  for (const p of options) {
    const rise = s.y + 7 - p.y, dx = p.x - s.x;
    // Time at which the playtest body descends onto this surface. The shelf must be
    // reachable before that tick, and jumping under a same-side overhang hits its base.
    const disc = vy * vy - 2 * 0.068 * rise;
    if (disc < 0 || rise < -55 || Math.abs(dx) > 140) continue;
    const ticks = (-vy + Math.sqrt(disc)) / 0.068;
    if (ticks < 1 || Math.abs(dx) > ticks * Math.max(2.65, Math.abs(s.vx)) + 8) continue;
    if (s.grounded && (rise < 3 || Math.abs(dx) < 26)) continue;
    const d = Math.abs(dx - s.vx * Math.min(14, ticks)) * 0.15 + Math.abs(rise - 28);
    if (d < cost) { target = p; cost = d; }
  }
  return target;
}

interface Branch {
  soldier: SoldierPlaytestState;
  gate: number;
  ticks: number;
  score: number;
  parent?: Branch;
  steps: Point[];
  controls?: number[];
  latestSplit?: SplitStamp;
}

function trace(branch: Branch) {
  const blocks: Point[][] = [];
  for (let p: Branch | undefined = branch; p; p = p.parent) blocks.push(p.steps);
  const points = blocks.reverse().flat();
  const last = branch.soldier;
  if (!points.length || dist(points.at(-1)!, last) > 0.01) points.push({ x: last.x, y: last.y });
  return points;
}

/** Find a resting position in the approach gallery without consuming any of the trial gates. */
function sectionRunUp(map: PmsMapData, index: TrialIndex, axis: readonly Point[], approach: number,
  footholds: readonly Point[], firstGate: Gate | undefined) {
  const start = axis[approach];
  const idle = { left:false, right:false, jump:false, crouch:false, jetpack:false };
  function settle(origin: Point) {
    if (!clearSegment(start, origin, index)) return;
    let soldier = createSoldierPlaytestState(origin.x, origin.y, map);
    for (let tick = 0; tick < 120; tick++) {
      const next = stepSoldierPlaytest(soldier, idle, map, index);
      if (next.hazardState === 'deadly' || next.hazardState === 'hurts' || !clearSegment(soldier,next,index) ||
        dist(next,start) > 150 || (firstGate && dot(delta(firstGate.center,next),firstGate.tangent) >= 0)) return;
      if (next.grounded) return next;
      soldier = next;
    }
  }
  const onFloor = settle(start);
  if (onFloor) return onFloor;
  // In a shaft the axis can hang between two shelves. Try actual footholds in the
  // approach gallery. A ledge across a rock wall or beyond the first gate is ineligible.
  const nearby = footholds.filter(p => valid(p) && dist(p,start) <= 110).sort((a,b)=>dist(a,start)-dist(b,start));
  for (const foot of nearby) {
    const origin = {x:foot.x, y:foot.y - SOLDIER_COLLISION.height / 2 - 0.25};
    let nearest = approach;
    for (let i=0; i<axis.length; i++) if (dist(origin,axis[i]) < dist(origin,axis[nearest])) nearest = i;
    if (Math.abs(nearest-approach) > 1) continue;
    const onShelf = settle(origin);
    if (onShelf) return onShelf;
  }
}

export interface SectionTiming {
  section: TrialSection;
  entryGate: Gate;
  exitGate: Gate;
  start: SoldierPlaytestState;
  controls: number[];
  approachTrace: Point[];
  entryState: SoldierPlaytestState;
  entryFraction: number;
}
export type PreparedSectionTiming = { ok:true; timing:SectionTiming } | { ok:false; trial:TunnelTrialResult };

function noSectionTime(reason: Failure, trace: Point[] = []): TunnelTrialResult {
  return {reached:false, ticks:0, progress:0, trace, reason};
}

/** Record one physical approach on the source map. Its controls and both gate planes
 * are shared by every candidate, including the source used as the comparison time. */
export function prepareSectionTiming(request: TunnelTrialRequest): PreparedSectionTiming {
  const {centerline, section, footholds = []} = request;
  if (!section || !centerline.every(valid) || centerline.length < 2 || centerline.length > 2048 ||
      ![section.entry, section.exit, section.approach].every(Number.isInteger) || section.approach < 0 ||
      section.approach > section.entry || section.entry >= section.exit || section.exit >= centerline.length) {
    return {ok:false, trial:noSectionTime('invalid-route')};
  }
  const map = parsePmsFull(serializePms(request.map));
  const index = new TrialIndex(map);
  const approach = centerline[section.approach], exit = centerline[section.exit];
  const gates = routeGates(centerline,approach,exit,section,false,true);
  const entryIndex = gates.findIndex(g => g.boundary === 'entry');
  const exitGate = gates.find(g => g.boundary === 'exit');
  if (entryIndex < 0 || !exitGate || exitGate.along - gates[entryIndex].along < 8) {
    return {ok:false, trial:noSectionTime('invalid-route')};
  }
  const entryGate = gates[entryIndex];
  if (section.approach === section.entry) {
    // The first stretch starts at the opening itself. All variants start on that plane with zero velocity.
    if (!clearSegment(entryGate.center, entryGate.center, index)) return {ok:false,trial:noSectionTime('no-run-up')};
    const start = createSoldierPlaytestState(entryGate.center.x, entryGate.center.y, map);
    return {ok:true, timing:{section,entryGate,exitGate,start,controls:[],entryState:start,entryFraction:1,approachTrace:[]}};
  }
  const approachGates = gates.slice(0,entryIndex+1);
  const marker = section.approach === 0 ? map.spawnpoints.find(s => s.active && s.team === 1 && dist(s,approach) < 120 &&
    dot(delta(approachGates[0].center,s),approachGates[0].tangent) < 0) : undefined;
  const start = marker ? createSoldierPlaytestState(marker.x,marker.y,map) :
    sectionRunUp(map,index,centerline,section.approach,footholds,approachGates[0]);
  if (!start || !clearSegment(start,start,index)) return {ok:false,trial:noSectionTime('no-run-up')};
  const run = driveGates(map,index,start,approachGates,entryGate.center,false,footholds,true,'record');
  if (!run.reached || !run.controls || run.finishFraction === undefined) {
    return {ok:false,trial:noSectionTime(run.reason === 'budget' ? 'budget' : 'no-run-up',run.trace)};
  }
  const entryState = replayApproach(map,index,start,run.controls,entryGate);
  if (!entryState) return {ok:false,trial:noSectionTime('no-run-up')};
  return {ok:true, timing:{section,entryGate,exitGate,start,controls:run.controls,entryState,entryFraction:run.finishFraction,approachTrace:run.trace}};
}

function replayApproach(map: PmsMapData, index: TrialIndex, start: SoldierPlaytestState, controls: number[], entry: Gate) {
  let soldier = start;
  for (let i=0; i<controls.length; i++) {
    const mask = controls[i];
    const next = stepSoldierPlaytest(soldier,replayInput(mask),map,index);
    if (next.hazardState === 'hurts' || next.hazardState === 'deadly' || dist(soldier,next)>17 || !clearSegment(soldier,next,index)) return;
    if (i === controls.length-1 && (gateCrossing(entry,soldier,next) === undefined || !clearSegment(next,entry.center,index))) return;
    soldier = next;
  }
  return soldier;
}

/** Re-run the same controls on the candidate's PMS terrain, then drive its own intermediate
 * gates. The clock includes only the fractional entry-to-exit interval of the winning branch. */
export function runTimedSectionTrial(request: TunnelTrialRequest, prepared: PreparedSectionTiming): TunnelTrialResult {
  if (!prepared.ok) return prepared.trial;
  const {section,entryGate,exitGate,start,entryState,controls,entryFraction,approachTrace} = prepared.timing;
  const {centerline, footholds=[]} = request;
  if (section.exit >= centerline.length || !centerline.every(valid)) return noSectionTime('invalid-route');
  const map = parsePmsFull(serializePms(request.map));
  const index = new TrialIndex(map);
  if (!clearSegment(start,start,index)) return noSectionTime('no-run-up');
  const runner = replayApproach(map,index,start,controls,entryGate);
  if (!runner || dist(runner,entryState)>0.00001 || Math.hypot(runner.vx-entryState.vx,runner.vy-entryState.vy)>0.00001 ||
    runner.grounded !== entryState.grounded || runner.onIce !== entryState.onIce ||
    Math.abs(runner.jetFuel-entryState.jetFuel)>0.00001 || runner.maxJetFuel!==entryState.maxJetFuel ||
    runner.maxJetFuel!==map.startJetGame) return noSectionTime('no-run-up');
  const gates = routeGates(centerline,centerline[section.approach],centerline[section.exit],section,false,true);
  const first = gates.findIndex(g => g.boundary === 'entry'), last = gates.findIndex(g => g.boundary === 'exit');
  if (first < 0 || last <= first) return noSectionTime('invalid-route');
  const timedGates = [...gates.slice(first+1,last), exitGate];
  const {finishFraction,...result} = driveGates(map,index,runner,timedGates,exitGate.center,false,footholds,true,'measure');
  if (result.reached) {
    const elapsed = result.ticks - 1 + (finishFraction ?? NaN) + (1-entryFraction);
    if (!(elapsed>0)) return noSectionTime('invalid-route',result.trace);
    result.sectionTicks = elapsed;
  }
  result.ticks += controls.length;
  result.trace = [...approachTrace.slice(0,-1),...result.trace];
  return result;
}

function nearestMarker(map:PmsMapData, team:number, near:Point) {
  return map.spawnpoints.filter(p=>p.active && p.team===team && valid(p)).sort((a,b)=>dist(a,near)-dist(b,near))[0];
}

function reachesFlag(s:Point, flag:Point, index:TrialIndex) {
  return dist(s,flag)<=14 && clearSegment(s,flag,index);
}

function safePilotStep(prev:Point, next:SoldierPlaytestState, aim:Point, index:TrialIndex) {
  return next.hazardState !== 'deadly' && next.hazardState !== 'hurts' && valid(next) && dist(next,prev)<=17 &&
    dist(next,aim)<=270 && clearSegment(prev,next,index);
}

export function followsFlagControls(source:PmsMapData, line:readonly Point[], controls:readonly number[]) {
  if (line.length < 2 || line.length > 2048 || !line.every(valid)) return false;
  const map = parsePmsFull(serializePms(source));
  const spawn = nearestMarker(map,1,line[0]), flag = nearestMarker(map,6,line.at(-1)!);
  if (!spawn || !flag || dist(spawn,line[0]) > 240 || dist(flag,line.at(-1)!) > 240) return false;
  const gates = routeGates(line,spawn,flag);
  const index = new TrialIndex(map);
  if (!clearSegment(spawn,spawn,index)) return false;
  let s = createSoldierPlaytestState(spawn.x,spawn.y,map), passed = 0;
  for (const mask of controls) {
    const g = gates[passed];
    const next = stepSoldierPlaytest(s,replayInput(mask),map,index);
    if (!safePilotStep(s,next,g?.center ?? flag,index)) return false;
    if (g && gateCrossing(g,s,next) !== undefined) passed++;
    if (passed===gates.length && reachesFlag(next,flag,index)) return true;
    s = next;
  }
  return false;
}

/** A bounded input search for the editor's capsule playtest. Every successful branch is one
 * continuous sequence of controls, with no teleporting between checkpoints and no respawns. */
export function runTunnelTrial(map: PmsMapData, centerline: readonly Point[], footholds: readonly Point[] = [], section?: TrialSection,
  recordFlagInputs = false, splitAnchors?: readonly number[], followLane = false): TunnelTrialResult {
  const fail = (reason: Failure): TunnelTrialResult => ({ reached: false, ticks: 0, progress: 0, trace: [], reason });
  if (centerline.length < 2 || centerline.length > 2048 || !centerline.every(valid)) return fail('invalid-route');
  if (section && (![section.approach, section.entry, section.exit].every(Number.isInteger) || section.approach < 0 ||
    section.approach > section.entry || section.entry >= section.exit || section.exit >= centerline.length)) return fail('invalid-route');
  const startMarker = nearestMarker(map,1,centerline[0]);
  const finishMarker = nearestMarker(map,6,centerline.at(-1)!);
  const useStartMarker = !section || (section.approach === 0 && startMarker && dist(startMarker, centerline[0]) <= 240);
  const finishAtFlag = !section || !!(section.exit === centerline.length - 1 && finishMarker && dist(finishMarker, centerline.at(-1)!) <= 240);
  const spawn = section && !useStartMarker ? centerline[section.approach] : startMarker;
  const flag = section && !finishAtFlag ? centerline[section.exit] : finishMarker;
  if (!spawn) return fail('missing-spawn');
  if (!flag) return fail('missing-flag');
  const total = centerline.reduce((n, p, i) => i ? n + dist(centerline[i - 1], p) : 0, 0);
  if (total < 8 || total > MAX_TUNNEL_ROUTE_LENGTH || (!section && (dist(spawn, centerline[0]) > 240 || dist(flag, centerline.at(-1)!) > 240))) return fail('invalid-route');
  const gates = routeGates(centerline, spawn, flag, section, finishAtFlag);
  if (!finishAtFlag && !gates.length) return fail('invalid-route');
  const index = new TrialIndex(map);
  if (!clearSegment(spawn, spawn, index)) return fail(section ? 'no-run-up' : 'invalid-route');
  const runner = section && !useStartMarker ? sectionRunUp(map, index, centerline, section.approach, footholds, gates[0]) :
    createSoldierPlaytestState(spawn.x, spawn.y, map);
  if (!runner) return fail('no-run-up');
  const splits = !section && splitAnchors ? planRunSplits(splitAnchors,gates,flag) : [];
  for (const range of splits) if (range.gate !== undefined) gates[range.gate].endsSplit = true;
  return driveGates(map, index, runner, gates, flag, finishAtFlag, footholds, !!section || followLane,
    recordFlagInputs ? 'record' : undefined,splits,followLane);
}

interface DriveResult extends TunnelTrialResult {
  finishFraction?: number;
  controls?: number[];
}

function driveGates(map: PmsMapData, index: TrialIndex, runner: SoldierPlaytestState, gates: Gate[],
  flag: Point, finishAtFlag: boolean, footholds: readonly Point[], checkGateSight: boolean,
  timing?: 'record' | 'measure', splits: ReturnType<typeof planRunSplits> = [], followLane = false): DriveResult {
  const initial: Branch = { soldier: runner, gate: 0, ticks: 0, score: -Infinity, steps: [{ x: runner.x, y: runner.y }] };
  let beam = [initial], best = initial, passBest = initial.score, noGain = 0, explored = 0, retried = false;
  const usableFeet = footholds.filter(valid);
  const footTargets = gates.map(g => usableFeet.filter(p => Math.abs(dot(delta(g.center, p), g.tangent)) < 75 && dist(p, g.center) < 175));

  while (explored < MAX_STEPS) {
    if (!beam.length || noGain >= 15) {
      if (retried || !gates.slice(Math.max(0, best.gate - 3), best.gate + 3).some(g => Math.abs(g.tangent.y) > 0.45)) break;
      // Explore a different takeoff sequence from an earlier point on the same physical run.
      // Keep the original parent chain, so time, velocities and the displayed path remain continuous.
      let restart = best;
      while (restart.parent && restart.gate > best.gate - 4) restart = restart.parent;
      beam = [restart];
      passBest = restart.score;
      noGain = 0;
      retried = true;
    }
    const nextBeam: Branch[] = [];
    for (const start of beam) {
      // The first policies walk or jump towards the next gate. Shaft policies steer towards
      // a shelf, brake, or move away from its underside to permit the next jump.
      const gate = gates[start.gate];
      const nearShaft = gate && Math.abs(gate.tangent.y) > 0.45;
      const groundPolicies = nearShaft ? (retried ? RETRY_SHAFT_POLICIES : SHAFT_POLICIES) : FLOOR_POLICIES;
      // Flat run-ups keep their ground timing. Use fuel when the next gate is uphill or above reach.
      const needsLift = followLane || (gate?.tangent.y ?? 0) < -0.15 || start.soldier.y - (gate?.center.y ?? flag.y) > 34;
      const policies = start.soldier.jetFuel >= 1 && needsLift ? [...groundPolicies,JET_POLICY] : groundPolicies;
      for (const policy of policies) {
        let s = start.soldier, passed = start.gate, ticks = start.ticks, latestSplit = start.latestSplit;
        const steps: Point[] = [];
        const controls = timing === 'record' ? [] as number[] : undefined;
        let validBranch = true;
        const shelf = gate && policy.aim === 'shelf' ? aimForShelf(s, footTargets[passed], policy.jump) : undefined;
        if (policy.aim === 'shelf' && !shelf) continue; // Same inputs as the gate policy.
        for (let i = 0; i < BRANCH_TICKS; i++) {
          const g = gates[passed];
          const aim = g ?? { center: flag, tangent: { x: 0, y: 0 } };
          let targetX = aim.center.x + aim.tangent.x * 24;
          if (!g && s.maxJetFuel>0) targetX -= s.vx * (s.grounded ? 3 : 8);
          if (shelf) targetX = shelf.x - s.vx * 5;
          let dir = Math.sign(targetX - s.x);
          if (Math.abs(targetX - s.x) < 2 || policy.aim === 'hold') dir = 0;
          if (policy.aim === 'left') dir = -1;
          if (policy.aim === 'right') dir = 1;
          const jet = policy.jet === true && s.jetFuel >= 1 && s.y + s.vy*6 > aim.center.y + Math.min(0,aim.tangent.y*18);
          const next = stepSoldierPlaytest(s, { left: dir < 0, right: dir > 0, jump: policy.jump, crouch: false, jetpack: jet }, map, index);
          controls?.push((dir < 0 ? 1 : dir > 0 ? 2 : 0) | (policy.jump ? 4 : 0) | (jet ? 8 : 0));
          explored++;
          if (!safePilotStep(s,next,aim.center,index)) {
            validBranch = false;
            break;
          }
          const fraction = g && gateCrossing(g, s, next);
          if (fraction !== undefined && (!checkGateSight || clearSegment(next, g.center, index))) {
            if (g.endsSplit) {
              latestSplit = {tick:ticks+fraction,point:{x:s.x+(next.x-s.x)*fraction,y:s.y+(next.y-s.y)*fraction},previous:latestSplit};
            }
            passed++;
          }
          s = next;
          ticks++;
          if (ticks % 6 === 0) steps.push({ x: s.x, y: s.y });
          if (passed === gates.length && (!finishAtFlag || reachesFlag(s,flag,index))) {
            const end = {parent:start, soldier:s, ticks, steps, controls, gate:passed, score:0};
            const result: DriveResult = { reached: true, progress: 1, ticks, trace: trace(end) };
            if (splits.length) result.splits = finishRunSplits(splits,latestSplit,ticks,true,s);
            if (timing) result.finishFraction = fraction;
            if (controls) {
              const chunks: number[][] = [];
              for (let b: Branch | undefined = end; b; b = b.parent) if (b.controls) chunks.push(b.controls);
              result.controls = chunks.reverse().flat();
            }
            return result;
          }
        }
        if (!validBranch) continue;
        const g = gates[passed];
        const distanceAhead = g ? Math.max(0, -dot(delta(g.center, s), g.tangent)) : dist(s, flag);
        const score = passed * GATE_SPACING - distanceAhead - (g ? (followLane ? 0.65 : 0.035) * dist(s, g.center) : 0);
        nextBeam.push({ soldier: s, gate: passed, ticks, score, steps, controls, latestSplit, parent: start });
      }
    }
    nextBeam.sort((a, b) => b.score - a.score);
    beam = [];
    const cells = new Set<string>();
    const onShaft = Math.abs(gates[nextBeam[0]?.gate]?.tangent.y ?? 0) > 0.45;
    if (onShaft) {
      // Preserve both walls of an ascending shaft. Ranking by height alone drops the branch
      // setting up a slightly lower but usable launch from the opposite shelf.
      const sides = new Set<string>();
      for (const b of nextBeam) {
        const g = gates[b.gate];
        if (!g) continue;
        const offset = delta(g.center, b.soldier);
        const side = Math.round((offset.y * g.tangent.x - offset.x * g.tangent.y) / 26);
        const key = [side, b.soldier.grounded ? 'landed' : Math.sign(b.soldier.vy)].join('/');
        if (sides.has(key)) continue;
        sides.add(key);
        beam.push(b);
        if (beam.length >= BEAM_WIDTH) break;
      }
    }
    for (const b of nextBeam) {
      const { x, y, vx, vy, grounded } = b.soldier;
      const cell = [b.gate, Math.round(x / 10), Math.round(y / 8), Math.round(vx / 1.5), Math.round(vy), grounded,
        Math.floor(b.soldier.jetFuel / 12)].join('/');
      if (cells.has(cell) || beam.includes(b)) continue;
      cells.add(cell);
      beam.push(b);
      if (beam.length >= (onShaft ? BEAM_WIDTH * (retried ? 3 : 2) : BEAM_WIDTH)) break;
    }
    if (beam.length && beam[0].score > best.score) best = beam[0];
    if (beam.length && beam[0].score > passBest + 0.25) { passBest = beam[0].score; noGain = 0; }
    else noGain++;
  }
  return {
    reached: false, progress: best.gate / (gates.length + 1), ticks: best.ticks,
    trace: trace(best), reason: explored >= MAX_STEPS ? 'budget' : 'pilot-stalled',
    ...(splits.length ? {splits:finishRunSplits(splits,best.latestSplit,best.ticks,false,best.soldier)} : {})
  };
}
