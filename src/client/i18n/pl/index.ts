import { APP_PL } from './app';
import { ARCHIVE_CLEANER_PL } from './archiveCleaner';
import { SIMILAR_MAPS_PL } from './similarMaps';
import { BROWSER_PL } from './browser';
import { EDITOR_PL } from './editor';
import { TUNNEL_PL } from './tunnel';
import { TIMED_COURSE_PL } from './timedCourse';
import { REFERENCE_MAPS_PL } from './referenceMaps';
import { TUNNEL_PROJECT_PL } from './tunnelProject';
import { SECTION_VARIANTS_PL } from './sectionVariants';
import { TUNNEL_PACE_PL } from './tunnelPace';
import { TUNNEL_RUN_SPLITS_PL } from './tunnelRunSplits';
import { CLIMB_MOVES_PL } from './climbMoves';
import { PACKS_PL } from './packs';
import { SHARED_PL } from './shared';
import type { PlDictionary } from './types';
import { VIEWPORT_PL } from './viewport';
import { WORKSHOP_PL } from './workshop';

// One fragment per part of the interface, so each can be edited on its own
export const PL: PlDictionary = {
  ...SHARED_PL,
  ...APP_PL,
  ...ARCHIVE_CLEANER_PL,
  ...SIMILAR_MAPS_PL,
  ...BROWSER_PL,
  ...VIEWPORT_PL,
  ...PACKS_PL,
  ...WORKSHOP_PL,
  ...EDITOR_PL,
  ...TUNNEL_PL,
  ...TIMED_COURSE_PL,
  ...REFERENCE_MAPS_PL,
  ...TUNNEL_PROJECT_PL,
  ...SECTION_VARIANTS_PL,
  ...TUNNEL_PACE_PL,
  ...TUNNEL_RUN_SPLITS_PL,
  ...CLIMB_MOVES_PL,
};
