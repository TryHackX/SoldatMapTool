import type { PmsMapData } from '@shared/pmsParser';
import { isPaceSettings, type PaceSettings } from '@shared/tunnelPace';
import { rebuildTunnelSection, tunnelTrialRoute, type TunnelProject, type TunnelSectionChange } from '@shared/tunnelProject';
import { generateSectionVariants, type SectionVariantStyle } from '@shared/tunnelSectionVariants';
import { prepareProjectTrial, projectMapMarkers, projectSplitAnchors } from './projectTrialRoute';
import { followsFlagControls, prepareSectionTiming, recordPmsFlagTrial, runPmsTunnelTrial, runTimedSectionTrial, type TunnelTrialResult } from './tunnelTrial';

export type { PaceSettings } from '@shared/tunnelPace';
export interface PaceRequest { map: PmsMapData; project: TunnelProject; settings: PaceSettings }
export interface PaceChange {
  knotIndex: number;
  style: SectionVariantStyle;
  change: TunnelSectionChange;
  localSeconds: number;
  difficulty: number;
}
export interface PaceResult {
  baseline: TunnelTrialResult;
  trial: TunnelTrialResult;
  changes: PaceChange[];
  checkedSections: number;
  checkedVariants: number;
  fullRuns: number;
  toleranceSeconds: number;
  withinTarget: boolean;
  usesSketchEnds: boolean;
}
export interface PaceProgress {
  phase:'baseline'|'sections'|'verify'; completed:number; total:number;
  trialSeconds?:number; stoppedAt?:number;
}

// Section clocks predict promising combinations. Only a complete continuous flag run can confirm one.
const MAX_SECTIONS = 12;
const MAX_COMBINATIONS = 4;

/** Reapply in the same order as verification. A stale or hand-edited patch aborts the whole operation. */
export function applyPaceChanges(map: PmsMapData, project: TunnelProject, changes: readonly PaceChange[]) {
  for (const {knotIndex,change} of changes) {
    const r = rebuildTunnelSection(map,project,knotIndex,change);
    if (!r.ok) return null;
    map = r.map;
    project = r.project;
  }
  return {map,project};
}

function fullTrial(map: PmsMapData, project: TunnelProject, spawnpoints: PmsMapData['spawnpoints']) {
  const route = tunnelTrialRoute(project);
  // Saved sketch markers may have been deleted, or the tunnel may have been inserted without flags.
  return runPmsTunnelTrial({...map,spawnpoints},route.centerline,route.footholds,undefined,projectSplitAnchors(project,route.centerline));
}

/** Sample in travelled distance. A one-knot gap keeps the measured intervals from overlapping. */
function sectionStations(project: TunnelProject) {
  const line = project.knots, lengths = [0];
  for (let i=1; i<line.length; i++) {
    lengths.push(lengths[i-1] + Math.hypot(line[i].x-line[i-1].x,line[i].y-line[i-1].y));
  }
  const length = lengths.at(-1)! || 1;
  const count = Math.min(MAX_SECTIONS,Math.ceil((line.length-2)/2));
  const selected: {knot:number;along:number}[] = [];
  let next = 1;
  for (let i=0; i<count; i++) {
    const goal = length*(i+0.5)/count;
    const last = line.length-2 - 2*(count-i-1);
    let knot = next;
    while (knot < last && Math.abs(lengths[knot+1]-goal) < Math.abs(lengths[knot]-goal)) knot++;
    selected.push({knot,along:lengths[knot]/length});
    next = knot+2;
  }
  return selected;
}

interface Option { seconds:number; difficulty:number; patch?:PaceChange }
interface Menu { along:number; original:number; options:Option[] }

function measureSection(map: PmsMapData, project: TunnelProject, knot: number, seed: number,
  spawnpoints: PmsMapData['spawnpoints']) {
  const request = (m: PmsMapData, p: TunnelProject) => {
    const r = prepareProjectTrial(m,p,knot).request;
    return {...r,map:{...r.map,spawnpoints}};
  };
  const source = request(map,project);
  const timing = prepareSectionTiming(source);
  if (!timing.ok) return {checked:0};
  const original = runTimedSectionTrial(source,timing).sectionTicks;
  if (!original) return {checked:0};
  const ref = original/60;
  const current = project.sections[knot-1];
  const initialBounce = Math.max(0,...project.faces.filter(f=>f.landing===knot && f.type===18).map(f=>f.rebound));
  // A narrow passage, a raised landing and a strong rebound demand more control. Section time
  // supplies a small additional signal, so a fast technical bounce does not become an easy jump.
  function complexity(change:TunnelSectionChange, seconds:number) {
    const width = change.widthOffset ?? current.widthOffset ?? 0;
    const height = change.landingHeight ?? current.landingHeight;
    const material = change.bounce === undefined ? current.bounce : change.bounce;
    const rebound = Math.min(4,material ?? initialBounce);
    return -width/50 + height/38 + 0.7*Math.log1p(rebound) + 0.35*Math.min(3,seconds/ref);
  }
  const options: Option[] = [{seconds:ref,difficulty:complexity({},ref)}];
  let checked = 0;
  for (const {style,change,result} of generateSectionVariants(map,project,knot,seed)) {
    if (!result.ok) continue;
    checked++;
    const trial = runTimedSectionTrial(request(result.map,result.project),timing);
    if (!trial.reached || !trial.sectionTicks) continue;
    const seconds = trial.sectionTicks/60, difficulty = complexity(change,seconds);
    options.push({seconds,difficulty,patch:{knotIndex:knot,style,change,localSeconds:seconds,difficulty}});
  }
  const values = options.map(o=>o.difficulty);
  const low = Math.min(...values), spread = Math.max(...values)-low;
  for (const option of options) {
    option.difficulty = spread < 0.001 ? 0.5 : (option.difficulty-low)/spread;
    if (option.patch) option.patch.difficulty = option.difficulty;
  }
  return {checked,options,original:ref};
}

interface Combination { choices:Option[]; delta:number; loss:number }

function targetDifficulty(profile: PaceSettings['profile'], along:number) {
  return profile === 'steady' ? 0.5 : profile === 'progressive' ? along : 1-along;
}

// Reserve the best fit for each predicted tenth of a second, including blends of fast and slow
// sections. A bounded frontier keeps planning time independent of the number of possible maps.
function combinations(menus:Menu[], profile:PaceSettings['profile'], desiredDelta:number, blocked:Set<number>) {
  let states: Combination[] = [{choices:[],delta:0,loss:0}];
  for (const [i,menu] of menus.entries()) {
    const wanted = targetDifficulty(profile,menu.along);
    const next = new Map<number,Combination>();
    const available = blocked.has(i) ? menu.options.slice(0,1) : menu.options;
    for (const state of states) for (const choice of available) {
      const delta = state.delta + (choice.seconds-menu.original);
      const bucket = Math.round(delta*10);
      const loss = state.loss + (choice.difficulty-wanted)**2;
      if (loss >= (next.get(bucket)?.loss ?? Infinity)) continue;
      next.set(bucket,{delta,loss,choices:[...state.choices,choice]});
    }
    const interim = desiredDelta*(i+1)/menus.length;
    states = [...next.values()].sort((a,b)=>(Math.abs(a.delta-interim)+a.loss)-(Math.abs(b.delta-interim)+b.loss)).slice(0,180);
  }
  return states;
}

/** A diverse alternative with just the best-matching feature in each half. A full run can fail
 * late because a previously valid landing is approached with different momentum. */
function profileCombination(menus:Menu[], profile:PaceSettings['profile'], blocked:Set<number>, sparse:boolean):Combination {
  const choices = menus.map(m=>m.options[0]);
  const gains = menus.map((m,i) => {
    const cost = (o:Option) => (o.difficulty-targetDifficulty(profile,m.along))**2;
    const best = blocked.has(i) ? choices[i] : m.options.reduce((a,b)=>cost(a)<=cost(b) ? a : b);
    return {i,best,gain:cost(choices[i])-cost(best)};
  }).filter(item=>item.best.patch);
  if (sparse) {
    for (const late of [false,true]) {
      const best = gains.filter(({i})=>(menus[i].along>=0.5) === late).sort((a,b)=>b.gain-a.gain)[0];
      if (best) choices[best.i] = best.best;
    }
  } else {
    for (const {i,best} of gains) choices[i] = best;
  }
  return {choices,delta:choices.reduce((s,c,i)=>s+c.seconds-menus[i].original,0),
    loss:choices.reduce((s,c,i)=>s+(c.difficulty-targetDifficulty(profile,menus[i].along))**2,0)};
}

export function runTunnelPacePlan({map,project,settings}:PaceRequest, progress?:(e:PaceProgress)=>void):PaceResult {
  if (!isPaceSettings(settings)) throw new RangeError('Invalid route pace settings');
  const {targetSeconds,profile,seed} = settings;
  const toleranceSeconds = Math.max(1,targetSeconds*0.03);
  const markers = projectMapMarkers(map,project);
  progress?.({phase:'baseline',completed:0,total:1});
  const originalRoute = tunnelTrialRoute(project);
  const {trial:baseline,controls} = recordPmsFlagTrial({...map,spawnpoints:markers},originalRoute.centerline,
    originalRoute.footholds,projectSplitAnchors(project,originalRoute.centerline));
  const result: PaceResult = {baseline,trial:baseline,changes:[],checkedSections:0,checkedVariants:0,fullRuns:1,
    toleranceSeconds,withinTarget:false,usesSketchEnds:false};
  const error = (trial:TunnelTrialResult) => Math.abs(trial.ticks/60-targetSeconds);
  result.withinTarget = baseline.reached && error(baseline) <= toleranceSeconds;
  progress?.({phase:'baseline',completed:1,total:1});
  if (!baseline.reached && (baseline.reason === 'invalid-route' || baseline.reason === 'missing-spawn' || baseline.reason === 'missing-flag')) return result;

  const stations = sectionStations(project);
  const menus: Menu[] = [];
  for (const {knot,along} of stations) {
    progress?.({phase:'sections',completed:result.checkedSections,total:stations.length});
    const m = measureSection(map,project,knot,seed,markers);
    if (m.options && m.options.length > 1) menus.push({along,options:m.options,original:m.original});
    result.checkedSections++;
    result.checkedVariants += m.checked;
  }
  progress?.({phase:'sections',completed:stations.length,total:stations.length});
  if (!menus.length) return result;

  // Without a complete baseline its time is unknown. First try a combination with the requested
  // profile, then use an actual successful finish to calibrate the next combination.
  const desiredDelta = baseline.reached ? targetSeconds-baseline.ticks/60 : 0;
  const blocked = new Set<number>(), seen = new Set<string>();
  let correction = 0;
  let bestLoss = menus.reduce((sum,m)=>sum+(m.options[0].difficulty-targetDifficulty(profile,m.along))**2,0)/menus.length;
  for (let attempt=0; attempt<MAX_COMBINATIONS; attempt++) {
    progress?.({phase:'verify',completed:attempt,total:MAX_COMBINATIONS});
    const predict = (c:Combination) => Math.abs(c.delta + correction - desiredDelta) +
      Math.max(toleranceSeconds,1)*2*c.loss/menus.length;
    const candidates = combinations(menus,profile,desiredDelta-correction,blocked);
    candidates.sort((a,b)=>predict(a)-predict(b));
    if (attempt === 1 || attempt === MAX_COMBINATIONS-1) {
      candidates.unshift(profileCombination(menus,profile,blocked,attempt === MAX_COMBINATIONS-1));
    }
    const key = (c:Combination) => c.choices.map(o=>o.patch?.style ?? '-').join('/');
    const chosen = candidates.find(c=>c.choices.some(o=>o.patch) && !seen.has(key(c)));
    if (!chosen) continue;
    seen.add(key(chosen));
    const changes = chosen.choices.flatMap(o=>o.patch ? [o.patch] : []);
    const rebuilt = applyPaceChanges(map,project,changes);
    if (!rebuilt) continue;
    result.fullRuns++;
    const trial = fullTrial(rebuilt.map,rebuilt.project,markers);
    progress?.({phase:'verify',completed:attempt+1,total:MAX_COMBINATIONS,
      ...(trial.reached ? {trialSeconds:trial.ticks/60} : {stoppedAt:trial.progress})});
    const loss = chosen.loss/menus.length;
    if (trial.reached) {
      correction = trial.ticks/60 - (baseline.reached ? baseline.ticks/60 : targetSeconds) - chosen.delta;
      const within = error(trial) <= toleranceSeconds;
      // Inside the advertised tolerance prefer the requested terrain curve. Outside it,
      // choose the closest actual finish, using the profile only for equivalent times.
      const wins = !result.trial.reached || (within && !result.withinTarget) ||
        (within === result.withinTarget && (within
          ? loss < bestLoss || (loss === bestLoss && error(trial) < error(result.trial))
          : error(trial) < error(result.trial) || (error(trial) === error(result.trial) && loss < bestLoss)));
      if (wins) { result.trial = trial; result.changes = changes; result.withinTarget = within; bestLoss = loss; }
      if (within && loss < 0.05) break;
    } else {
      // Try the next combination without the changed jump nearest the stopping point, plus
      // its run-up. Other parts of the requested difficulty curve remain available.
      const nearStop = chosen.choices.map((o,i)=>({i,changed:!!o.patch,d:trial.progress-menus[i].along}))
        .filter(x=>x.changed && x.d >= -0.08).sort((a,b)=>Math.abs(a.d)-Math.abs(b.d)).slice(0,2);
      for (const {i} of nearStop) blocked.add(i);
      if (!result.trial.reached && trial.progress > result.trial.progress) {
        // The primary trace and changes must always describe the very same terrain.
        result.trial = trial;
        result.changes = changes;
      }
    }
  }
  if (!result.changes.length && controls?.length) {
    // On a precision route even a locally successful jump can spoil a landing much later.
    // Build a profile incrementally, retaining each change only if one continuous input
    // sequence still clears the entire map. Confirm the assembled result with the normal pilot.
    let current = {map,project};
    const accepted: PaceChange[] = [];
    let first: typeof current | undefined;
    const preferred = profileCombination(menus,profile,new Set(),false).choices.flatMap(o=>o.patch ? [o.patch] : []);
    const maximum = result.fullRuns-1 + preferred.length+2;
    for (const change of preferred) {
      const next = applyPaceChanges(current.map,current.project,[change]);
      if (!next) continue;
      progress?.({phase:'verify',completed:result.fullRuns-1,total:maximum});
      result.fullRuns++;
      if (!followsFlagControls({...next.map,spawnpoints:markers},originalRoute.centerline,controls)) continue;
      current = next;
      accepted.push(change);
      first ??= next;
    }
    // If the regular pilot chooses a different trajectory on the combined changes, also
    // verify the earliest retained section. The published time must be reproducible on reopen.
    const finalists = accepted.length ? [{...current,count:accepted.length}] : [];
    if (first && accepted.length > 1) finalists.push({...first,count:1});
    for (const candidate of finalists) {
      result.fullRuns++;
      const trial = fullTrial(candidate.map,candidate.project,markers);
      const within = trial.reached && error(trial)<=toleranceSeconds;
      progress?.({phase:'verify',completed:result.fullRuns-1,total:maximum,
        ...(trial.reached ? {trialSeconds:trial.ticks/60} : {stoppedAt:trial.progress})});
      if (trial.reached && (within || error(trial)<=error(result.trial))) {
        result.trial = trial; result.changes = accepted.slice(0,candidate.count); result.withinTarget = within;
        break;
      }
    }
  }
  progress?.({phase:'verify',completed:result.fullRuns-1,total:result.fullRuns-1});
  return result;
}
