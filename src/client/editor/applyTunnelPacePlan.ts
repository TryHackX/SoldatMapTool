import type { PmsMapData } from '@shared/pmsParser';
import { isPaceSettings, type PaceSettings } from '@shared/tunnelPace';
import type { TunnelProject } from '@shared/tunnelProject';
import { EditorDocument } from './EditorDocument';
import { applyPaceChanges, type PaceResult } from './tunnelPacePlanner';

/** A worker report is valid only for the original document revision, including surrounding terrain. */
export function applyTunnelPacePlan(doc: EditorDocument, source: PmsMapData, project: TunnelProject,
  result: PaceResult, settings: PaceSettings) {
  const snapshot = doc.getSnapshot();
  const tunnels = source.editorTunnels;
  if (snapshot.map !== source || !tunnels?.includes(project) || !result.trial.reached ||
    result.usesSketchEnds || !isPaceSettings(settings)) return null;
  if (!result.changes.length && project.pace?.targetSeconds === settings.targetSeconds &&
    project.pace.profile === settings.profile && project.pace.seed === settings.seed) return snapshot;
  const rebuilt = result.changes.length ? applyPaceChanges(source,project,result.changes) : {map:source,project};
  if (!rebuilt) return null;
  const updated = {...rebuilt.project, pace:{...settings}};
  const nextMap = {...rebuilt.map, editorTunnels:tunnels.map(t => t === project ? updated : t)};
  return doc.commit({label:'Apply route time plan',nextMap});
}
