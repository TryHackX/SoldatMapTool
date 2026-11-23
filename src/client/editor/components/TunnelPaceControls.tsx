import { useId } from 'react';
import { PACE_MIN_SECONDS, PACE_MAX_SECONDS, type PaceSettings } from '@shared/tunnelPace';
import { t } from '../../i18n';

interface Props {
  target: string;
  profile: PaceSettings['profile'];
  onTargetChange: (value: string) => void;
  onProfileChange: (value: PaceSettings['profile']) => void;
  disabled?: boolean;
}

export const formatTargetTime = (seconds: number) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

export function parseTargetSeconds(input: string): number | null {
  const value = input.trim();
  const clock = /^(\d+):([0-5]\d)$/.exec(value);
  const seconds = clock ? Number(clock[1]) * 60 + Number(clock[2]) : /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(seconds) && seconds >= PACE_MIN_SECONDS && seconds <= PACE_MAX_SECONDS ? seconds : null;
}

export const paceField = 'block w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-400 disabled:opacity-50';

export function TunnelPaceControls({target,profile,onTargetChange,onProfileChange,disabled}: Props) {
  const hint = useId();
  const valid = parseTargetSeconds(target) !== null;
  return <div className="space-y-2">
    <label className="block space-y-1">
      <span>{t('Target finish time')}</span>
      <input type="text" inputMode="text" maxLength={10} placeholder="1:00" disabled={disabled}
        value={target} onChange={event=>onTargetChange(event.target.value)} aria-invalid={!valid}
        aria-describedby={hint} className={paceField+' font-mono tabular-nums'}/>
    </label>
    <p id={hint} className={'text-[11px] '+(valid ? 'text-zinc-400' : 'text-amber-200')}>
      {t('Enter seconds or m:ss, from {min} to {max}.',{min:formatTargetTime(PACE_MIN_SECONDS),max:formatTargetTime(PACE_MAX_SECONDS)})}
    </p>
    <label className="block space-y-1">
      <span>{t('Difficulty progression')}</span>
      <select value={profile} onChange={event=>onProfileChange(event.target.value as PaceSettings['profile'])}
        className={paceField} disabled={disabled}>
        <option value="progressive">{t('Easy start, hard finish')}</option>
        <option value="steady">{t('Even difficulty')}</option>
        <option value="hard-start">{t('Hard start, easy finish')}</option>
      </select>
    </label>
  </div>;
}
