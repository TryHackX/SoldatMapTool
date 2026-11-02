import React from 'react';

/**
 * `React.memo` that re-renders only when a non-function prop changes. The docks get many inline callbacks from App,
 * and App re-renders on every mouse move while editing (cursor, snapping and guide state live in the editor hook),
 * so a plain memo would never skip anything. Every callback the docks receive either never changes or depends only
 * on state that is also passed to them as data, so they always pick up current callbacks with the next data change.
 */
export function memoIgnoringCallbacks<P extends object>(component: React.FC<P>): React.FC<P> {
  return React.memo(component, (prev, next) => {
    const a = prev as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (typeof a[key] === 'function' && typeof b[key] === 'function') continue;
      if (!Object.is(a[key], b[key])) return false;
    }
    return true;
  }) as unknown as React.FC<P>;
}
