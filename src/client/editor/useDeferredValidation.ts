import { useEffect, useMemo, useState } from 'react';
import { MapValidationIssue, validateMapDocument } from '@shared/mapValidator';
import { PmsMapData } from '@shared/pmsParser';

/**
 * Runs the map validator only after the map stopped changing for `delayMs`: a drag changes the map every frame,
 * and validating a 5000-polygon map on each of them would cost the whole frame budget. Selection-only changes
 * keep the same map object, so they never trigger it.
 */
export function useDeferredValidation(
  map: PmsMapData | null,
  options: {
    knownTexturesLower: ReadonlySet<string> | null;
    knownSceneriesLower: ReadonlySet<string> | null;
    mapBaseName: string | null;
    includeHints: boolean;
  },
  delayMs = 350
): { issues: MapValidationIssue[]; pending: boolean } {
  const { knownTexturesLower, knownSceneriesLower, mapBaseName, includeHints } = options;
  const request = useMemo(() => ({map, knownTexturesLower, knownSceneriesLower, mapBaseName, includeHints}),
    [map, knownTexturesLower, knownSceneriesLower, mapBaseName, includeHints]);
  const [checked, setChecked] = useState<{ request: typeof request; issues: MapValidationIssue[] } | null>(null);
  useEffect(() => {
    if (!request.map) { setChecked(null); return; }
    const target = request.map;
    const timer = window.setTimeout(() => {
      setChecked({ request, issues: validateMapDocument(target, request) });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [request, delayMs]);
  // Issue indices are valid only for the revision that produced them, including the render before effects run.
  const pending = Boolean(map && checked?.request !== request);
  return { issues: checked?.request === request ? checked.issues : [], pending };
}
