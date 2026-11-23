import type { Dispatch, SetStateAction } from 'react';
import { MAX_TUNNEL_DECORATIONS, type TunnelSettings } from '@shared/climbTunnel';
import { t } from '../../i18n';

export function TunnelChamberControls({ settings, setSettings }: {
  settings: TunnelSettings; setSettings: Dispatch<SetStateAction<TunnelSettings>>;
}) {
  return <div className="space-y-3 rounded-md border border-zinc-800 p-2.5 text-xs text-zinc-300">
    <label className="flex flex-wrap items-center justify-between gap-1">
      {t('Cave chambers')}
      <select className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5"
        value={settings.chamberLayout ?? 'classic'}
        onChange={e => {
          const chamberLayout = e.currentTarget.value === 'varied' ? 'varied' : 'classic';
          setSettings(s => ({ ...s, chamberLayout }));
        }}>
        <option value="varied">{t('Alternate chambers and shafts')}</option>
        <option value="classic">{t('Continuous corridor')}</option>
      </select>
    </label>
    <label className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
      <span>{t('Rock and hazard markings')}</span>
      <span className="font-mono text-zinc-400">{settings.decorationBudget ?? 0}</span>
      <input className="col-span-2 w-full accent-cyan-400" type="range" min={0} max={MAX_TUNNEL_DECORATIONS}
        value={settings.decorationBudget ?? 0} aria-label={t('Maximum marking polygons')}
        onChange={e => {
          const decorationBudget = e.currentTarget.valueAsNumber;
          setSettings(s => ({ ...s, decorationBudget }));
        }} />
    </label>
  </div>;
}
