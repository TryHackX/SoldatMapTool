import { useState } from 'react';
import { STYLE_METRICS, type ClimbLibrarySnapshot, type StyleMetric, type StyleQuantiles } from '@shared/climbLibrary';
import { locale, t } from '../../i18n';

const metrics: Record<StyleMetric, string> = {
  gap: 'Horizontal gap', rise: 'Signed rise', landingWidth: 'Landing width', rebound: 'Bounce factor',
  exposedLength: 'Measured ledge length per map', jetFuel: 'Starting jet fuel',
};
const comparisons = { library: 'Profile and whole library', folds: 'Reference and held-out families', profile: 'Active profile only' } as const;
type Comparison = keyof typeof comparisons;
const geometry = new Intl.NumberFormat(locale,{maximumFractionDigits:0});
const coefficient = new Intl.NumberFormat(locale,{maximumFractionDigits:2});

function numbers(values: StyleQuantiles | null | undefined, metric: StyleMetric) {
  const format = metric === 'rebound' ? coefficient : geometry;
  return values?.map(n => format.format(n)).join(' / ') ?? '—';
}

export function ClimbDistributionTable({snapshot}: {snapshot: ClimbLibrarySnapshot}) {
  const [choice,setChoice] = useState<Comparison | null>(null);
  const options: Comparison[] = [];
  if (snapshot.collection !== 'all') options.push('library');
  if (snapshot.referenceFamilies && snapshot.holdoutFamilies) options.push('folds');
  options.push('profile');
  const comparison = choice && options.includes(choice) ? choice : options[0];
  const split = comparison === 'folds';
  const first = split ? snapshot.reference : snapshot.measured;
  const second = split ? snapshot.holdout : comparison === 'library' ? snapshot.wholeLibrary : null;
  const sameValues = second && STYLE_METRICS.every(k => numbers(first[k],k) === numbers(second[k],k));
  const firstLabel = split ? t('Reference families') : t('Active profile');
  const secondLabel = split ? t('Held-out families') : t('Whole library, same fold');
  return <details className="border-t border-zinc-800 pt-2">
    <summary className="cursor-pointer text-cyan-300">{t('Geometry of the active profile')}</summary>
    <div className="mt-2 space-y-2">
      {options.length>1 && <label className="block">{t('Show measurements')}
        <select className="block w-full rounded border border-zinc-700 bg-zinc-950 p-1.5 text-zinc-200"
          value={comparison} onChange={e=>setChoice(e.target.value as Comparison)}>
          {options.map(k=><option key={k} value={k}>{t(comparisons[k])}</option>)}
        </select></label>}
      {split && <p>{t('{a} reference families and {b} separate held-out families in this collection.',{
        a:geometry.format(snapshot.referenceFamilies), b:geometry.format(snapshot.holdoutFamilies),
      })}</p>}
      {sameValues && <p>{t('Both groups have the same displayed percentiles.')}</p>}
      <table className="w-full text-left tabular-nums"><caption className="pb-1 text-left">{t('10th / median / 90th percentile')}</caption>
        <thead><tr><th scope="col">{t('Metric')}</th><th scope="col">{sameValues ? t('Both groups') : firstLabel}</th>
          {second && !sameValues && <th scope="col">{secondLabel}</th>}</tr></thead>
        <tbody>{STYLE_METRICS.map(key=><tr className="border-t border-zinc-800" key={key}>
          <th scope="row" className="pr-1 font-normal">{t(metrics[key])}{key!=='rebound' && key!=='jetFuel' && ' (u)'}</th>
          <td className="pr-1">{numbers(first[key],key)}</td>{second && !sameValues && <td>{numbers(second[key],key)}</td>}
        </tr>)}</tbody>
      </table>
      <p>{t('One vote per map family. Geometry describes possible ledge pairs. Unknown author in {n} families.', {
        n:geometry.format(snapshot.unknownAuthorFamilies),
      })}</p>
    </div>
  </details>;
}
