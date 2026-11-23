import { useCallback, useEffect, useRef, useState } from 'react';
import type { PmsMapData } from '@shared/pmsParser';
import type { TunnelProject } from '@shared/tunnelProject';
import { prepareProjectTrial } from './projectTrialRoute';
import type { TunnelTrialResult } from './tunnelTrial';
import { startTrial } from './components/tunnelTrialJob';

interface Scope { map: PmsMapData; project: TunnelProject }
interface Request extends Scope { reference?: TunnelTrialResult; sketch: boolean }
interface Report { trial: TunnelTrialResult; reference?: TunnelTrialResult; sketch: boolean }

/** An edit, undo or tab change invalidates a running job. Undo can reuse an already measured map. */
export function useTunnelFullRun(map: PmsMapData | undefined, project: TunnelProject | undefined, active: boolean) {
  const cache = useRef(new WeakMap<PmsMapData, Map<TunnelProject, Report>>());
  const latest = useRef<Request | null>(null);
  const [,setVersion] = useState(0);
  const [request,setRequest] = useState<Request | null>(null);
  const [failure,setFailure] = useState<Scope | null>(null);
  const report = map && project ? cache.current.get(map)?.get(project) : undefined;

  const remember = useCallback((source: PmsMapData, tunnel: TunnelProject, trial: TunnelTrialResult,
    reference?: TunnelTrialResult, sketch = false) => {
    const reports = cache.current.get(source) ?? new Map<TunnelProject,Report>();
    reports.set(tunnel,{trial,reference,sketch});
    cache.current.set(source,reports);
    setVersion(version => version+1);
  },[]);

  const measure = useCallback((source: PmsMapData, tunnel: TunnelProject, reference?: TunnelTrialResult, sketch = false) => {
    const previous = latest.current;
    const sameRoute = previous?.map===source && previous.project===tunnel && previous.sketch===sketch;
    const next = {map:source,project:tunnel,reference:reference ?? (sameRoute ? previous.reference : undefined),sketch};
    latest.current = next;
    setFailure(null);
    setRequest(next);
  },[]);
  const cancel = useCallback(() => setRequest(null),[]);
  const reset = useCallback(() => {
    cancel();
    setFailure(null);
    latest.current = null;
    cache.current = new WeakMap();
  },[cancel]);

  useEffect(() => {
    if (!request) return;
    if (!active || request.map !== map || request.project !== project) { setRequest(null); return; }
    let current = true;
    let worker: Worker | undefined;
    const fail = () => {
      if (!current) return;
      setFailure({map:request.map,project:request.project});
      setRequest(null);
    };
    try {
      const input = prepareProjectTrial(request.map,request.project,undefined,request.sketch ? 'project' : 'map');
      worker = startTrial(input.request,trial => {
        if (!current) return;
        remember(request.map,request.project,trial,request.reference,input.usesSketchEnds);
        setRequest(null);
      },fail);
    } catch { fail(); }
    return () => { current=false; worker?.terminate(); };
  },[active,map,project,request,remember]);

  return {report,remember,measure,cancel,reset,
    busy:!!request && request.map===map && request.project===project && active,
    error:!!failure && failure.map===map && failure.project===project};
}

