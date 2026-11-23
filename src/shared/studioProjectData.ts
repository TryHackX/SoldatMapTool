import { isTunnelProject, type TunnelProject } from './tunnelProject';
import { isTunnelSketch, type TunnelSketch } from './tunnelSketch';

export interface StudioProjectData {
  tunnels?: TunnelProject[];
  sketch?: TunnelSketch;
  /** Optional library lookup for projects using package-local graphics. Contains no filesystem path. */
  assetMapId?: string;
}

/** Both the portable file and recovery storage use this schema. Missing fields are valid for older drafts. */
export function readStudioProjectData(tunnels: unknown, sketch: unknown, assetMapId?: unknown): StudioProjectData | null {
  if (tunnels !== undefined) {
    if (!Array.isArray(tunnels) || !tunnels.every(isTunnelProject)) return null;
    if (new Set(tunnels.map(tunnel => tunnel.id)).size !== tunnels.length) return null;
  }
  if (sketch !== undefined && !isTunnelSketch(sketch)) return null;
  if (assetMapId !== undefined && (typeof assetMapId !== 'string' || !assetMapId || assetMapId.length > 4096 || /[\u0000-\u001f]/u.test(assetMapId))) return null;
  return {
    ...(tunnels !== undefined ? { tunnels: tunnels as TunnelProject[] } : {}),
    ...(sketch !== undefined ? { sketch } : {}),
    ...(typeof assetMapId === 'string' ? {assetMapId} : {}),
  };
}
