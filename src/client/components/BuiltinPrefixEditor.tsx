import { useState } from 'react';
import { BUILTIN_MODE_GROUPS, type BuiltinPrefixOverrides } from '@shared/prefixUtils';
import { t, tText } from '../i18n';

export function BuiltinPrefixEditor({ overrides, onChange }: {
  overrides: BuiltinPrefixOverrides;
  onChange: (value: BuiltinPrefixOverrides) => void;
}) {
  const [groupId, setGroupId] = useState('rscs');
  const group = BUILTIN_MODE_GROUPS.find(g => g.id === groupId)!;
  const changed = Object.keys(overrides);
  const select = 'min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200';
  const reset = 'rounded px-2 py-1 text-emerald-300 hover:bg-zinc-800 disabled:text-zinc-600';

  function assign(prefix: string, target: string | null) {
    const next = { ...overrides };
    if (target === groupId) delete next[prefix];
    else next[prefix] = target;
    onChange(next);
  }

  return <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
    <h3 className="font-semibold text-zinc-100">{t('Built-in prefixes')}</h3>
    <div className="flex flex-wrap items-center gap-2">
      <label>{t('Default group')} <select className={select} value={groupId} onChange={e => setGroupId(e.target.value)}>
        {BUILTIN_MODE_GROUPS.filter(g => g.defaultPrefixes.length).map(g =>
          <option key={g.id} value={g.id}>{tText(g.shortName)}</option>)}
      </select></label>
      <button type="button" className={reset} disabled={!group.defaultPrefixes.some(p => Object.hasOwn(overrides,p))}
        onClick={() => onChange(Object.fromEntries(Object.entries(overrides).filter(([p]) => !group.defaultPrefixes.includes(p))))}>
        {t('Restore this group')}
      </button>
      <button type="button" className={reset} disabled={!changed.length} onClick={() => onChange({})}>{t('Restore all built-in prefixes')}</button>
    </div>
    <div className="grid gap-1.5 sm:grid-cols-2">
      {group.defaultPrefixes.map(prefix => {
        const label = prefix === '__none__' ? t('(no prefix)') : prefix;
        const assignment = overrides[prefix];
        return <div key={prefix} className="flex items-center gap-2 rounded bg-zinc-900/60 px-2 py-1">
          <label className="flex flex-1 items-center gap-1.5 font-mono">
            <input type="checkbox" checked={assignment !== null} onChange={e => assign(prefix, e.target.checked ? groupId : null)}/>
            {label}
          </label>
          <select aria-label={t('Group for {prefix}', {prefix:label})} className={select+' w-24'} value={assignment ?? groupId}
            disabled={assignment === null} onChange={e => assign(prefix,e.target.value)}>
            {BUILTIN_MODE_GROUPS.map(g => <option key={g.id} value={g.id}>{tText(g.shortName)}</option>)}
          </select>
        </div>;
      })}
    </div>
  </section>;
}
