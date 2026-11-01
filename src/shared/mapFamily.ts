import { makeDerivedMapName } from './pmsParser';

// Versions of one map made by the workshop: X, X_f, X_o, X_f_o (used by the compare menu)
const DERIVED_SUFFIXES = ['_f', '_o', '_f_o'] as const;
const NAME_LENGTH_LIMITS = [16, 20, 24, 32];

export function stripDerivedSuffix(name: string): string {
  return name.replace(/(_f_o|_f|_o)$/i, '');
}

/** Every name the workshop could have given a version of `base` (all name-length limits, old two-step `_f_o`) */
function derivedNamesOf(base: string): Set<string> {
  const names = new Set<string>();
  for (const max of NAME_LENGTH_LIMITS) {
    for (const suffix of DERIVED_SUFFIXES) names.add(makeDerivedMapName(base, suffix, max).toLowerCase());
    names.add(makeDerivedMapName(makeDerivedMapName(base, '_f', max), '_o', max).toLowerCase());
  }
  return names;
}

/** True for two different versions of the same map — also when a long name was shortened to fit the limit */
export function isSameMapFamily(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return false;
  if (stripDerivedSuffix(al) === stripDerivedSuffix(bl)) return true;
  return (
    derivedNamesOf(a).has(bl) ||
    derivedNamesOf(b).has(al) ||
    derivedNamesOf(stripDerivedSuffix(a)).has(bl) ||
    derivedNamesOf(stripDerivedSuffix(b)).has(al)
  );
}
