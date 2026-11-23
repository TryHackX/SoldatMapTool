import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type SetStateAction } from 'react';
import { NEW_TUNNEL_SETTINGS, generateClimbTunnel, type TunnelPoint, type TunnelSettings } from '@shared/climbTunnel';
import { SOLDAT_MAP_LIMITS, type PmsMapData } from '@shared/pmsParser';
import { rebuildTunnelSection, tunnelSectionPolygonIndices, type TunnelProject, type TunnelSectionChange } from '@shared/tunnelProject';
import type { TunnelSketch } from '@shared/tunnelSketch';
import { EditorDocument, emptySelection, type EditorDocumentSnapshot } from './EditorDocument';
import type { SectionVariantReport } from './sectionVariantTrials';
import type { PaceSettings } from '@shared/tunnelPace';
import type { PaceResult } from './tunnelPacePlanner';
import { applyTunnelPacePlan } from './applyTunnelPacePlan';
import { useTunnelFullRun } from './useTunnelFullRun';
import type { TunnelTrialResult } from './tunnelTrial';
import type { RepairReport, RepairRequest } from './climbStopRepair';

interface SectionComparison {
  map: PmsMapData;
  project: TunnelProject;
  knot: number;
  selected: SectionVariantReport | null;
  stop?: TunnelPoint;
  fromSplit?: boolean;
}

const NO_PATH: TunnelPoint[] = [];

export function useTunnelWorkspace(docRef: RefObject<EditorDocument | null>, snapshot: EditorDocumentSnapshot | null,
  setSnapshot: (state: EditorDocumentSnapshot) => void, active: boolean, inspectorOpen: boolean) {
  const [chosen, setChosen] = useState<number | null>(0);
  const [selectedKnot, setKnot] = useState(1);
  const [pending, setPending] = useState<{project:TunnelProject; knot:number; changes:TunnelSectionChange; repair?:RepairRequest} | null>(null);
  const [comparison, setComparison] = useState<SectionComparison | null>(null);
  const [paceSource, setPaceSource] = useState<{map:PmsMapData; project:TunnelProject} | null>(null);
  const [brush, setBrush] = useState(NEW_TUNNEL_SETTINGS);
  const brushRef = useRef(brush);
  const map = snapshot?.map;
  const tunnels = map?.editorTunnels;
  const index = chosen !== null && tunnels?.length ? Math.min(chosen, tunnels.length-1) : null;
  const project = index === null ? undefined : tunnels?.[index];
  const knotIndex = Math.max(1, Math.min(selectedKnot, (project?.knots.length ?? 3)-2));
  const comparing = active && inspectorOpen && comparison !== null && comparison.map === map &&
    comparison.project === project && comparison.knot === knotIndex;
  const planning = active && inspectorOpen && !!paceSource && paceSource.map === map && paceSource.project === project;
  const variant = comparing ? comparison.selected : null;
  const manualChanges = pending?.project===project && pending?.knot===knotIndex ? pending?.changes : undefined;
  const changes = variant?.change ?? manualChanges;
  const originalPoint = project?.knots[knotIndex];
  const originalSection = project?.sections[knotIndex-1];
  const point = changes?.point ?? originalPoint;
  const landingHeight = changes?.landingHeight ?? originalSection?.landingHeight ?? 0;
  const bounce = changes?.bounce === undefined ? originalSection?.bounce ?? null : changes.bounce;
  const landingReach = changes?.landingReach ?? originalSection?.landingReach ?? 0;
  const savedWidthOffset = originalSection?.widthOffset ?? 0;
  const widthOffset = changes?.widthOffset ?? savedWidthOffset;
  const modified = Boolean(manualChanges && point && originalPoint && (point.x!==originalPoint.x || point.y!==originalPoint.y ||
    landingHeight!==originalSection?.landingHeight || landingReach!==(originalSection?.landingReach ?? 0) || bounce!==(originalSection?.bounce ?? null) || widthOffset!==savedWidthOffset));
  const sketch = map?.editorSketch;
  const settings = sketch?.settings ?? brush;
  const method = sketch?.method ?? 'draw';
  const path = sketch?.path ?? NO_PATH;

  const creatingTunnel = active && !project && !!map;
  const draft = useMemo(() => creatingTunnel && (method==='auto' || path.length>=2)
    ? generateClimbTunnel(settings, method==='draw' ? path : undefined,
      method==='draw' ? SOLDAT_MAP_LIMITS.maxPolys - (map?.polygons.length ?? 0) : undefined) : null,
    [creatingTunnel,method,path,settings,map?.polygons.length]);
  const hasPreview = modified || variant !== null;
  const preview = useMemo(() => active && hasPreview && map && project && changes ?
    rebuildTunnelSection(map, project, knotIndex, changes) : null, [active, hasPreview, map, project, knotIndex, changes]);
  const sectionIndices = useMemo(() => active && map && project ? tunnelSectionPolygonIndices(map,project,knotIndex) : [],
    [active,map,project,knotIndex]);

  const fullRun = useTunnelFullRun(modified && preview?.ok ? preview.map : map,
    modified && preview?.ok ? preview.project : project, active && inspectorOpen);
  const {remember:rememberRun,reset:resetRuns,measure:measureRun} = fullRun;

  // Each comparison belongs to the exact revision the worker received. Revisiting a previous
  // history entry or reopening the inspector must never resurrect an old result.
  useEffect(() => {
    if (comparison && !comparing) setComparison(null);
  }, [comparison, comparing]);

  useEffect(() => {
    if (paceSource && !planning) setPaceSource(null);
  }, [paceSource,planning]);

  const openPlanner = useCallback(() => {
    if (!active || !inspectorOpen || !map || !project || modified || docRef.current?.getSnapshot().map !== map) return;
    setPending(null);
    setComparison(null);
    setPaceSource({map,project});
  },[active,inspectorOpen,map,project,modified,docRef]);

  const setComparing = useCallback((enabled: boolean) => {
    if (!enabled) { setComparison(null); return; }
    if (active && inspectorOpen && map && project && !modified && docRef.current?.getSnapshot().map === map) {
      setPending(null);
      setComparison({map, project, knot:knotIndex, selected:null});
    }
  }, [active,inspectorOpen,map,project,modified,knotIndex,docRef]);

  const compareSplit = useCallback((knot: number, currentRun?: TunnelTrialResult, stop?:TunnelPoint) => {
    if (!active || !inspectorOpen || !map || !project || modified || docRef.current?.getSnapshot().map !== map ||
      !Number.isInteger(knot) || knot < 1 || knot > project.sections.length) return;
    if (currentRun) rememberRun(map,project,currentRun);
    setPaceSource(null);
    setPending(null);
    setKnot(knot);
    setComparison({map,project,knot,selected:null,stop,fromSplit:true});
  },[active,inspectorOpen,map,project,modified,docRef,rememberRun]);

  const selectVariant = useCallback((selected: SectionVariantReport | null) => {
    if (selected?.reason || !comparing || docRef.current?.getSnapshot().map !== map) return;
    setComparison(current => current?.project === project && current?.map === map && current?.knot === knotIndex
      ? {...current, selected} : current);
  }, [comparing,map,project,knotIndex,docRef]);

  const setSection = useCallback((knot: number, patch: TunnelSectionChange) => {
    if (planning || comparing || !project || pending?.repair && pending.project===project || knot < 1 || knot >= project.knots.length-1 || (modified && knot!==knotIndex)) return;
    setKnot(knot);
    setPending(old => ({project,knot,changes:{...(old?.project===project && old.knot===knot ? old.changes : {}),...patch}}));
  },[project,modified,knotIndex,comparing,planning,pending]);

  const stageRepair = useCallback((source:RepairRequest, candidate:RepairReport) => {
    if (!active || !inspectorOpen || planning || comparing || !candidate.trial || modified ||
      source.project!==project || source.map!==map || docRef.current?.getSnapshot().map!==map) return;
    setKnot(candidate.knot);
    setPending({project:source.project,knot:candidate.knot,changes:candidate.change,repair:source});
  },[active,inspectorOpen,planning,comparing,modified,project,map,docRef]);

  const repair=manualChanges ? pending?.repair : undefined;
  const selectKnot = useCallback((knot: number) => {
    if (!project || modified || knot < 1 || knot >= project.knots.length-1) return;
    if (comparing && map) setComparison({map, project, knot, selected:null});
    setKnot(knot);
    setPending(null);
  },[project,map,modified,comparing]);

  const choose = useCallback((i:number | null) => {
    if (modified) return;
    setComparison(null);
    setChosen(i);
    setKnot(1);
    setPending(null);
  },[modified]);

  const open = useCallback((next: PmsMapData, trial?: TunnelTrialResult) => {
    resetRuns();
    if (trial && next.editorTunnels?.length === 1) rememberRun(next,next.editorTunnels[0],trial);
    setComparison(null);
    setChosen(next.editorSketch ? null : 0);
    setKnot(1);
    setPending(null);
    brushRef.current = next.editorSketch?.settings ?? NEW_TUNNEL_SETTINGS;
    setBrush(brushRef.current);
  },[resetRuns,rememberRun]);

  const editSketch = useCallback((change: Partial<TunnelSketch>, label: string, transactionId?: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const current = doc.getSnapshot().map;
    const base = current.editorSketch ?? { method:'draw', path:NO_PATH, settings:brushRef.current };
    const next = {...base,...change};
    if (next.settings===base.settings && next.method===base.method && next.path===base.path) return;
    setSnapshot(doc.commit({label, nextMap:{...current,editorSketch:next},transactionId}));
  },[docRef,setSnapshot]);

  const setSettings = useCallback((action: SetStateAction<TunnelSettings>) => {
    const sketch = docRef.current?.getSnapshot().map.editorSketch;
    const prev = sketch?.settings ?? brushRef.current;
    const value = typeof action==='function' ? action(prev) : action;
    if (value===prev) return;
    // Reading a local profile for an unused brush should not dirty an existing PMS.
    const onlyProfileLoaded = !sketch && value.profile && !prev.profile &&
      (Object.keys(value) as (keyof TunnelSettings)[]).every(k=> k==='profile' || prev[k]===value[k]);
    if (!onlyProfileLoaded) editSketch({settings:value}, 'Tunnel settings', 'tunnel-settings');
    brushRef.current=value;
    setBrush(value);
  },[docRef,editSketch]);

  const setMethod = useCallback((method:TunnelSketch['method'])=>editSketch({method},'Tunnel route mode'),[editSketch]);
  const setPath = useCallback((path:TunnelPoint[]) => {
    if (!path.length && !docRef.current?.getSnapshot().map.editorSketch?.path.length) return;
    editSketch({method:'draw',path},'Edit tunnel sketch');
  },[docRef,editSketch]);
  const cancel = useCallback(()=>{ setPending(null); setComparison(null); setPaceSource(null); },[]);

  const applyPlan = useCallback((result: PaceResult, settings: PaceSettings) => {
    const doc = docRef.current;
    if (!planning || !paceSource || !doc) return;
    const next = applyTunnelPacePlan(doc,paceSource.map,paceSource.project,result,settings);
    if (next) {
      const applied = next.map.editorTunnels?.find(tunnel=>tunnel.id===paceSource.project.id);
      if (applied) rememberRun(next.map,applied,result.trial,result.changes.length ? result.baseline : undefined);
      setSnapshot(next);
      cancel();
    }
  },[docRef,planning,paceSource,setSnapshot,cancel,rememberRun]);

  const apply = useCallback((candidate?: SectionVariantReport) => {
    const doc = docRef.current;
    if (!doc || index===null || !preview?.ok || !map || !project || doc.getSnapshot().map!==map) return;
    if (comparing && (!candidate || candidate !== variant)) return;
    if (candidate && !comparing) return;
    const updatedTunnels = map.editorTunnels!.map((item,i)=>i===index ? preview.project : item);
    const next = doc.commit({label:candidate ? 'Apply section variant' : 'Rebuild tunnel section',
      nextMap:{...preview.map,editorTunnels:updatedTunnels},nextSelection:emptySelection()});
    setSnapshot(next);
    if (repair) measureRun(next.map,updatedTunnels[index],repair.trial,repair.sketch);
    else if (candidate && fullRun.report) {
      measureRun(next.map,updatedTunnels[index],fullRun.report.trial,fullRun.report.sketch);
    }
    cancel();
  },[docRef,map,index,preview,project,setSnapshot,comparing,variant,cancel,fullRun.report,measureRun,repair]);

  return { index, project, knotIndex, point, landingHeight, landingReach, bounce, widthOffset, modified, preview, sectionIndices, setSection, stageRepair, repair,
    selectKnot, choose, open, settings, method, path, draft, setSettings, setMethod, setPath, cancel, apply,
    comparing, setComparing, compareSplit, comparisonStop:comparing ? comparison.stop : undefined,
    fromSplit:comparing && comparison.fromSplit === true,
    variant, selectVariant, hasPreview, planning, openPlanner, applyPlan, fullRun };
}
