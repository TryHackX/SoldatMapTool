import React, { useLayoutEffect, useRef } from 'react';

/** Keep event handlers current even when the dock skips a pointer-only update.
 * Install targets after commit so an abandoned React render cannot change a live handler. */
export function memoIgnoringCallbacks<P extends object>(component: React.FC<P>): React.FC<P> {
  const Dock = React.memo(component);
  return function DockWithLiveActions(props: P) {
    const latest = useRef(props);
    useLayoutEffect(() => { latest.current = props; });
    const actions = useRef(new Map<keyof P, (...args: unknown[]) => unknown>());
    const stable = { ...props };
    for (const key of Object.keys(props) as (keyof P)[]) {
      if (typeof props[key] !== 'function') continue;
      let action = actions.current.get(key);
      if (!action) {
        action = (...args: unknown[]) => {
          const handle = latest.current[key];
          if (typeof handle === 'function') return handle(...args);
        };
        actions.current.set(key,action);
      }
      stable[key] = action as P[keyof P];
    }
    return React.createElement(Dock,stable);
  };
}
