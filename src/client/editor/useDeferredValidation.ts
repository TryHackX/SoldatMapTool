import { useEffect, useState } from 'react';
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
  const [issues, setIssues] = useState<MapValidationIssue[]>([]);
  const [pending, setPending] = useState(false);
  const { knownTexturesLower, knownSceneriesLower, mapBaseName, includeHints } = options;

  useEffect(() => {
    if (!map) {
      setIssues([]);
      setPending(false);
      return;
    }
    setPending(true);
    const timer = window.setTimeout(() => {
      setIssues(validateMapDocument(map, { knownTexturesLower, knownSceneriesLower, mapBaseName, includeHints }));
      setPending(false);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [map, knownTexturesLower, knownSceneriesLower, mapBaseName, includeHints, delayMs]);

  return { issues, pending };
}
