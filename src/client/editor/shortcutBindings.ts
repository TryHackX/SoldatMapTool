import { useSyncExternalStore } from 'react';
import type { EditorToolId } from './types';

export const defaultKeys: Record<EditorToolId, string> = {
  select: 'V',
  lasso: 'Q',
  vertex: 'A',
  poly_tri: 'P',
  poly_strip: 'S',
  poly_fan: 'F',
  poly_shape: 'B',
  poly_laser: 'X',
  climb_tunnel: 'T',
  color_brush: 'C',
  light: 'L',
  uv: 'U',
  scenery: 'E',
  spawn: 'O',
  collider: 'K',
  waypoint: 'W',
  ruler: 'M',
  playtest: 'J',
};
export const allowedKeys = Array.from('ABCDEFHIJKLMNOPQRSTUVWXYZ');
const storeKey = 'sms.editor.toolKeys.v1';
type Bindings = typeof defaultKeys;

export function parseBindings(json: string | null): Bindings {
  try {
    const data = JSON.parse(json ?? '{}');
    const keys = Object.keys(defaultKeys) as EditorToolId[];
    // Preserve existing assignments when a release adds a tool, even if its default key was reassigned.
    if (data.climb_tunnel === undefined && keys.filter(id => id !== 'climb_tunnel').every(id => data[id])) {
      const taken = Object.values(data);
      data.climb_tunnel = [defaultKeys.climb_tunnel, ...allowedKeys].find(key => !taken.includes(key));
    }
    const values = keys.map(id => data[id]);
    if (values.every(key => allowedKeys.includes(key)) && new Set(values).size === keys.length) {
      return Object.fromEntries(keys.map(id => [id, data[id]])) as Bindings;
    }
  } catch { /* Defaults also apply when an older profile cannot be read. */ }
  return defaultKeys;
}

function readKeys() {
  try { return parseBindings(window.localStorage.getItem(storeKey)); } catch { return defaultKeys; }
}
let current = readKeys();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key === storeKey || e.key === null) { current = readKeys(); emit(); }
});
export function useToolKeys() { return useSyncExternalStore(subscribe, () => current); }
export function assignKey(keys: Bindings, id: EditorToolId, key: string): Bindings {
  if (!allowedKeys.includes(key)) return keys;
  const other = (Object.keys(keys) as EditorToolId[]).find(tool => keys[tool] === key);
  return { ...keys, ...(other ? { [other]: keys[id] } : {}), [id]: key };
}
export function saveToolKeys(keys: Bindings) {
  current = keys;
  try { localStorage.setItem(storeKey, JSON.stringify(keys)); } catch { /* Session-only when storage is disabled. */ }
  emit();
}
