import { createTunnelMap, generateClimbTunnel, MAX_TUNNEL_ROUTE_LENGTH, type TunnelSettings } from '@shared/climbTunnel';
import { prepareMapForSave } from '@shared/pmsCompiler';
import type { PmsMapData } from '@shared/pmsParser';
import { isPaceSettings, type PaceSettings } from '@shared/tunnelPace';
import { createTunnelProject, tunnelTrialRoute } from '@shared/tunnelProject';
import { applyPaceChanges, runTunnelPacePlan, type PaceProgress } from './tunnelPacePlanner';
import { runPmsTunnelTrial, type TunnelTrialResult } from './tunnelTrial';
import { projectSplitAnchors } from './projectTrialRoute';

const LENGTH_TRIALS = 7;
const MAX_REFINEMENTS = 2;
// Leave room for the perpendicular bends, waves and terminal landings inside the format limit.
const longestAxis = Math.floor(MAX_TUNNEL_ROUTE_LENGTH * 0.9);
const fitLength = (value: number) => Math.max(300,Math.min(longestAxis,Math.round(value)));

export type TimedCourseRequest = {terrain: TunnelSettings; pace: PaceSettings};
export type TimedCourseProgress = (PaceProgress | {phase:'length'|'blend';completed:number;total:number}) & {refinement?:number};
export type TimedCourseResult = {map: PmsMapData; trial: TunnelTrialResult; changes:number; lengthTrials:number;
  checkedVariants:number; targetSeconds:number; toleranceSeconds:number};

export function fitAutomaticCourse({terrain,pace}: TimedCourseRequest, onProgress?: (e: TimedCourseProgress)=>void) {
  if (!isPaceSettings(pace)) throw new Error('Invalid time trial settings');
  const {targetSeconds} = pace;
  let seed = pace.seed;
  let length = fitLength(targetSeconds * (terrain.direction === 'across' ? 232 : 220));
  const tried = new Set<string>();
  let best: {map:PmsMapData; draft:ReturnType<typeof generateClimbTunnel>; settings:TunnelSettings;
    trial:TunnelTrialResult; error:number} | null = null;
  for (let i=0; i<LENGTH_TRIALS; i++) {
    const key = seed+':'+length;
    if (tried.has(key)) break;
    tried.add(key);
    onProgress?.({phase:'length',completed:i+1,total:LENGTH_TRIALS});
    const settings = {...terrain,automaticLength:length,terrainProgression:pace.profile,seed};
    const draft = generateClimbTunnel(settings);
    if (draft.validation.ok) {
      const map = createTunnelMap(draft,settings,{title:'Timed climb',texture:'default.bmp'});
      const trial = runPmsTunnelTrial(map,draft.centerline,draft.footholds);
      if (trial.reached) {
        const seconds = trial.ticks / 60;
        const error = Math.abs(targetSeconds-seconds);
        if (!best || error < best.error) best = {map,draft,settings,trial,error};
        if (error <= Math.max(0.35,targetSeconds*0.01)) break;
        const next = fitLength(length * targetSeconds / seconds);
        // No longer or shorter route is available within this map's construction budget.
        if (next === length && (length === longestAxis || length === 300)) break;
        if (!tried.has(seed+':'+next)) { length = next; continue; }
      }
    }
    // A different layout can clear a blocked turn without changing the requested materials or direction.
    seed = (Math.imul(seed,1664525)+1013904223) & 0x7fffffff;
    if (best) {
      length = fitLength(best.settings.automaticLength! * targetSeconds / (best.trial.ticks/60));
    } else if (i % 2 === 1) {
      length = fitLength(length*0.88);
    }
  }
  return {best,attempts:tried.size};
}

type CourseBase = {draft:ReturnType<typeof generateClimbTunnel>;settings:TunnelSettings;map:PmsMapData};
const fitTolerance = (seconds:number) => Math.max(0.25,seconds*0.008);

function verifyCourse(base:CourseBase, pace:PaceSettings, trySubsets:boolean, onProgress?: (e:TimedCourseProgress)=>void) {
  const project = createTunnelProject(base.draft,base.settings);
  const plan = runTunnelPacePlan({map:base.map,project,settings:pace},onProgress);
  if (!plan.trial.reached || plan.usesSketchEnds) return {checked:plan.checkedVariants,course:null};
  let selected = applyPaceChanges(base.map,project,plan.changes);
  if (!selected) throw new Error('Cannot rebuild timed course');
  let trial = plan.trial, changes = plan.changes;
  const error = (run:TunnelTrialResult) => Math.abs(pace.targetSeconds-run.ticks/60);
  if (trySubsets && changes.length>1 && error(trial)>fitTolerance(pace.targetSeconds)) {
    // The entire new axis already has the requested clearance and obstacle progression.
    // Preserve edits from across it while giving some landings their previous momentum.
    const sparse = [changes.filter((_,i)=>i%2===0 || i===changes.length-1), changes.filter((_,i)=>i%2===1)];
    for (const [i,subset] of sparse.entries()) {
      if (subset.length===plan.changes.length) continue;
      onProgress?.({phase:'blend',completed:i+1,total:sparse.length});
      const alternate = applyPaceChanges(base.map,project,subset);
      if (!alternate) continue;
      const route = tunnelTrialRoute(alternate.project);
      const run = runPmsTunnelTrial(alternate.map,route.centerline,route.footholds,undefined,
        projectSplitAnchors(alternate.project,route.centerline));
      if (run.reached && error(run)<error(trial)) {
        selected = alternate; trial = run; changes = subset;
        if (error(run)<=fitTolerance(pace.targetSeconds)) break;
      }
    }
  }
  const map = prepareMapForSave({...selected.map,editorTunnels:[{...selected.project,pace}]},
    {geometryDirty:changes.length>0});
  return {checked:plan.checkedVariants,course:{map,trial,changes:changes.length,
    targetSeconds:pace.targetSeconds,toleranceSeconds:plan.toleranceSeconds}};
}

/** A new map is free to change its axis length. Existing hand-drawn routes never enter this search. */
export function buildTimedCourse(request: TimedCourseRequest,onProgress?: (e: TimedCourseProgress)=>void): TimedCourseResult | null {
  const {best,attempts} = fitAutomaticCourse(request,onProgress);
  if (!best) return null;
  const {pace} = request;
  const initial = verifyCourse(best,pace,true,onProgress);
  if (!initial.course) return null;
  let chosen = initial.course, checked = initial.checked, lengthTrials = attempts;
  let chosenLength = best.settings.automaticLength!;
  let nextLength = fitLength(chosenLength * pace.targetSeconds / (chosen.trial.ticks/60));
  const tried = new Set([chosenLength]);
  const secondsError = (course:typeof chosen) => Math.abs(pace.targetSeconds - course.trial.ticks/60);
  // Section edits can shift a course that was on time before assembly. Refit to the actual flag
  // time. If a full length correction overshoots or stalls, try halfway back to the best finish.
  for (let pass=1; pass<=MAX_REFINEMENTS && secondsError(chosen)>fitTolerance(pace.targetSeconds); pass++) {
    if (tried.has(nextLength)) break;
    tried.add(nextLength);
    const length = nextLength;
    lengthTrials++;
    const settings = {...best.settings,automaticLength:length};
    const draft = generateClimbTunnel(settings);
    if (draft.validation.ok) {
      const map = createTunnelMap(draft,settings,{title:'Timed climb',texture:'default.bmp'});
      const verified = verifyCourse({map,settings,draft},pace,false,e=>onProgress?.({...e,refinement:pass}));
      checked += verified.checked;
      const candidate = verified.course;
      if (candidate && secondsError(candidate)<secondsError(chosen)) {
        const previous = chosenLength;
        const crossed = (candidate.trial.ticks/60-pace.targetSeconds)*(chosen.trial.ticks/60-pace.targetSeconds)<0;
        chosen = candidate;
        chosenLength = length;
        nextLength = fitLength(crossed ? (previous+length)/2 : length*pace.targetSeconds/(candidate.trial.ticks/60));
        continue;
      }
    }
    nextLength = fitLength((length + chosenLength)/2);
  }
  return {...chosen,lengthTrials,checkedVariants:checked};
}
