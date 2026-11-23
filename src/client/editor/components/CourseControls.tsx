import { useCallback, useEffect, useRef, useState } from 'react';
import type { CourseSettings } from '@shared/courseGenerator';
import { t } from '../../i18n';

export function CourseControls({ value, onChange, materials = true, climb = false, onMeasuring }: {
  value: CourseSettings; onChange: (settings: CourseSettings) => void; materials?: boolean; climb?: boolean;
  onMeasuring?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const controls = [
    ['spacing', 'Platform spacing', 36, 180],
    ['deadly', 'Deadly pits', 0, 100],
    ['hurt', 'Hurt platforms', 0, 100],
    ['bounce', 'Bounce platforms', 0, 100],
  ] as const;
  useEffect(() => {
    onMeasuring?.(busy);
    return () => onMeasuring?.(false);
  }, [busy, onMeasuring]);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const active = useRef<AbortController | undefined>(undefined);
  const fromLibrary = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    try {
      const response = await fetch('/api/editor/climb-profile', { signal: request.signal });
      if (!response.ok) throw new Error();
      const profile = await response.json();
      if (request.signal.aborted) return;
      if (profile.samples) {
        const current = latest.current;
        current.onChange({ ...current.value, deadly: profile.deadly, hurt: profile.hurt, bounce: profile.bounce, profile: profile.geometry });
        setStatus(profile.skipped ? t('Unreadable or changed maps skipped: {n}', { n: profile.skipped }) : '');
      } else setStatus(t('No matching climb maps in the index.'));
    } catch { if (!request.signal.aborted) setStatus(t('Map index unavailable. Try again after scanning.')); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    setBusy(false);
    if (climb && !latest.current.value.profile) void fromLibrary();
    return () => active.current?.abort();
  }, [climb, fromLibrary]);
  return <fieldset disabled={busy} className="space-y-2 text-xs text-zinc-300">
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2">{t('Seed')}
        <input type="number" min="0" max="2147483647" value={value.seed} className="w-28 rounded border border-zinc-700 bg-zinc-950 p-1"
          onChange={e => onChange({ ...value, seed: Math.min(2147483647, Math.max(0, Math.floor(Number(e.target.value)))) })} />
      </label>
      <button type="button" className="text-cyan-300" onClick={() => onChange({ ...value, seed: Math.floor(Math.random() * 2147483647) })}>{t('Random seed')}</button>
    </div>
    {climb && <label className="flex items-center justify-between">
      {t('Climb difficulty')}
      <select className="rounded bg-zinc-950 p-1" value={value.difficulty ?? 'race'}
        onChange={e => onChange({ ...value, difficulty: e.target.value as CourseSettings['difficulty'] })}>
        <option value="relaxed">{t('Relaxed')}</option><option value="race">{t('Time trial')}</option>
        <option value="expert">{t('Expert')}</option>
      </select>
    </label>}
    {controls.filter(([key]) => materials || key === 'spacing').map(([key, label, min, max]) =>
      <label key={key} className="flex items-center gap-2">
        <span className="flex-1">{climb && key === 'spacing' ? t('Jump spacing scale') :
          climb && key === 'hurt' ? t('Hurt pits') : t(label)}</span>
        <input className="w-20 accent-cyan-500" type="range" min={min} max={max} value={value[key]}
          onChange={e => onChange({ ...value, [key]: Number(e.target.value) })} />
        <span className="w-10 text-right font-mono">{climb && key === 'spacing' ? Math.round(value[key] * 100 / 96) + '%' : value[key] + (key === 'spacing' ? ' u' : '%')}</span>
      </label>)}
    {materials && <><button type="button" className="text-cyan-300" onClick={() => {
      const cuts = [0, Math.random(), Math.random(), Math.random(), 1].sort((a, b) => a - b).map(n => Math.round(n * 100));
      onChange({ ...value, deadly: cuts[1], hurt: cuts[2] - cuts[1], bounce: cuts[3] - cuts[2] });
    }}>{t('Randomize surface mix')}</button><p className="text-zinc-400">{t('Weights above 100% are scaled proportionally. Endpoints are safe.')}</p>
      <button type="button" className="text-cyan-300" onClick={fromLibrary}>{t('Read local climb maps')}</button>
      <div role="status" className="text-zinc-400">{busy ? t('Measuring local climb maps…') : <>
        {value.profile && t('{pairs} ledge pairs from {maps} maps. Bounce samples from {bounce} maps.', {
          pairs: value.profile.pairs, maps: value.profile.measuredMaps, bounce: value.profile.bounceMaps
        })}
        {' '}{status}
      </>}</div></>}
  </fieldset>;
}
