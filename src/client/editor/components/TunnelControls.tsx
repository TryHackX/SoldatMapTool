import { type Dispatch, type SetStateAction } from 'react';
import { Dice5 } from 'lucide-react';
import { LibraryStyleControls } from './LibraryStyleControls';
import { TUNNEL_PALETTES, type TunnelSettings } from '@shared/climbTunnel';
import { t } from '../../i18n';
import { TunnelChamberControls } from './TunnelChamberControls';

type Setter = Dispatch<SetStateAction<TunnelSettings>>;
type Choice<T extends string> = readonly [T, string];

export function TunnelChoices<T extends string>({ label, value, choices, onChange }: {
  label: string; value: T; choices: readonly Choice<T>[]; onChange: (key: T) => void;
}) {
  return <fieldset className="space-y-1.5"><legend className="text-xs font-medium text-zinc-300">{label}</legend>
    <div className="flex flex-wrap gap-1">{choices.map(([key, name]) =>
      <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}
        className={'rounded-md border px-2.5 py-1.5 text-xs transition-colors ' + (key === value
          ? 'border-cyan-400/60 bg-cyan-950 text-cyan-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100')}>
        {t(name)}
      </button>)}</div>
  </fieldset>;
}

const features = [
  ['ramps', 'Takeoff ramps'], ['spikes', 'Floor spikes'], ['lowCeilings', 'Low ceilings'],
  ['drops', 'Drop-offs'], ['ice', 'Ice sections'], ['deadlyWalls', 'Deadly walls'], ['floatingHazards', 'Suspended hazards'],
] as const;
const surfaces = [['deadly', 'Deadly terrain'], ['hurt', 'Hurting terrain'], ['bounce', 'Bounce surfaces']] as const;

export function TunnelControls({ settings, setSettings, drawn, timed = false, onProfileLoading }: {
  settings: TunnelSettings; setSettings: Setter; drawn: boolean; timed?: boolean; onProfileLoading?: (loading:boolean)=>void;
}) {


  function set<K extends keyof TunnelSettings>(key: K, value: TunnelSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }
  function slider(key: 'clearance' | 'roughness' | 'deadly' | 'hurt' | 'bounce', label: string, min: number, max: number, unit: string) {
    return <label key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-xs text-zinc-300">
      <span>{t(label)}</span><span className="font-mono text-zinc-400">{settings[key]}{unit}</span>
      <input className="col-span-2 w-full accent-cyan-400" aria-label={t(label)} type="range" min={min} max={max}
        value={settings[key]} onChange={e => set(key, Number(e.currentTarget.value))} />
    </label>;
  }
  return <div className="space-y-4">
    {!drawn && <>
      {!timed && <TunnelChoices label={t('Route length')} choices={[['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']]} value={settings.length}
        onChange={length => setSettings(old => ({...old,length,automaticLength:undefined}))} />}
      <TunnelChoices label={t('Route direction')} choices={[['winding', 'Winding'], ['up', 'Uphill'], ['down', 'Downhill'], ['across', 'Across']]} value={settings.direction} onChange={v => set('direction', v)} />
    </>}
    <TunnelChoices label={t('Climb difficulty')} choices={[['relaxed', 'Relaxed'], ['race', 'Time trial'], ['expert', 'Expert']]} value={settings.difficulty} onChange={v => set('difficulty', v)} />
    <fieldset className="space-y-2"><legend className="text-xs font-medium text-zinc-300">{t('Rock palette')}</legend>
      <div className="flex flex-wrap items-center gap-2">{(Object.keys(TUNNEL_PALETTES) as (keyof typeof TUNNEL_PALETTES)[]).map(key => {
        const p = TUNNEL_PALETTES[key];
        const css = (c: typeof p.rim) => `rgb(${c.r} ${c.g} ${c.b})`;
        return <button type="button" key={key} title={t(p.label)} aria-label={t(p.label)} aria-pressed={settings.palette === key}
          onClick={() => set('palette', key)}
          className={'h-7 w-9 rounded-md border ' + (key === settings.palette ? 'border-white ring-2 ring-cyan-500 ring-offset-2 ring-offset-zinc-900' : 'border-white/15')}
          style={{ background: `linear-gradient(135deg,${css(p.skyTop)} 37%,${css(p.rock)} 38% 71%,${css(p.rim)} 72%)` }} />;
      })}</div></fieldset>
    {slider('clearance', 'Tunnel width', 80, 220, ' u')}
    {slider('roughness', 'Rock roughness', 0, 100, '%')}
    <TunnelChamberControls settings={settings} setSettings={setSettings} />
    <fieldset className="space-y-1.5"><legend className="font-medium text-zinc-300">{t('Terrain features')}</legend>
      <div className="grid grid-cols-2 gap-1.5">{features.map(([key, label]) => <label key={key}
        className="flex items-center gap-2 rounded-md border border-zinc-800 px-2 py-1.5 text-[11px] text-zinc-300">
        <input type="checkbox" checked={settings[key]} onChange={e => set(key, e.target.checked)} className="accent-cyan-400" />{t(label)}
      </label>)}</div></fieldset>
    <details className="rounded border border-zinc-800 px-2 py-2"><summary className="cursor-pointer text-zinc-300">{t('Surface densities')}</summary>
      <div className="mt-3 space-y-2">{surfaces.map(([key, label]) => slider(key, label, 0, 100, '%'))}</div>
    </details>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2">{t('Seed')} <input type="number" aria-label={t('Seed')} min="0" max="2147483647" value={settings.seed}
        className="w-24 rounded border border-zinc-700 bg-zinc-950 p-1.5 font-mono" onChange={e => set('seed', Math.min(2147483647, Math.max(0, Math.floor(Number(e.target.value)))))} /></label>
      <button type="button" onClick={() => set('seed', Math.floor(Math.random() * 2147483647))} className="inline-flex items-center gap-1 text-cyan-300">
        <Dice5 size={15} />{t('Random seed')}</button>
    </div>
    <LibraryStyleControls settings={settings} setSettings={setSettings} onLoading={onProfileLoading} />
  </div>;
}
