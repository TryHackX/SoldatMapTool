import { APP_PL } from './app';
import { BROWSER_PL } from './browser';
import { PACKS_PL } from './packs';
import { SHARED_PL } from './shared';
import type { PlDictionary } from './types';
import { VIEWPORT_PL } from './viewport';
import { WORKSHOP_PL } from './workshop';

// One fragment per part of the interface, so each can be edited on its own
export const PL: PlDictionary = {
  ...SHARED_PL,
  ...APP_PL,
  ...BROWSER_PL,
  ...VIEWPORT_PL,
  ...PACKS_PL,
  ...WORKSHOP_PL,
};
