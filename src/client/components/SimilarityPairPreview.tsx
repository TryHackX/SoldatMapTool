import { useEffect, useState } from 'react';
import type { MapIndexEntry } from '@shared/apiTypes';
import { isDraftName, type LibraryPair, type SimilarityCriterion } from '@shared/librarySimilarity';
import { t } from '../i18n';
import { fetchMapDetails } from '../utils/mapCache';
import { useMapThumbnail } from '../utils/useMapThumbnail';

function DraftMark() {
  return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">{t('Draft name')}</span>;
}

function MapPreview({ id, name, crc, hasThumb, onOpenMap }: { id: string; name: string; crc: number; hasThumb: boolean; onOpenMap: (id: string) => void }) {
  const [map, setMap] = useState<MapIndexEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const thumb = useMapThumbnail(id, crc, hasThumb, true);
  useEffect(() => {
    let active = true;
    fetchMapDetails(id).then(m => { if (active) setMap(m); }).catch(() => {});
    return () => { active = false; };
  }, [id]);
  return <figure className="min-w-0 space-y-1.5">
    <figcaption className="flex flex-wrap items-center gap-1.5 text-zinc-100">
      <button type="button" className="break-all text-left font-semibold text-emerald-200 hover:underline"
        title={t('Open in map browser')} onClick={() => onOpenMap(id)}>{name}</button>
      {isDraftName(name) && <DraftMark/>}
    </figcaption>
    <div className="grid aspect-video place-items-center overflow-hidden rounded bg-zinc-950 text-xs text-zinc-500">
      {thumb.url && !failed ?
        <img src={thumb.url} onError={() => setFailed(true)} alt={name} className="h-full w-full object-contain"/> :
        t(thumb.failed || failed ? 'Preview unavailable' : 'Loading preview…')}
    </div>
    {map && <div className="text-[11px] text-zinc-400"><p className="break-all">{map.sourceLabel} · {map.texture}</p>
      <p>{t('Polygons {polys} · scenery objects {props}', { polys: map.polygonCount, props: map.activePropCount })}</p></div>}
  </figure>;
}

function SceneryImage({ name, mapId, large = false }: { name: string; mapId: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = '/api/assets?' + new URLSearchParams({ category: 'scenery-gfx', mapId, name, convert: 'png', colorkey: '1' });
  return <figure className="min-w-0 space-y-1.5">
    <div className={'grid place-items-center rounded bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:14px_14px] ' + (large ? 'h-44' : 'h-20')}>
      {failed ? <span className="text-[11px]">{t('Preview unavailable')}</span> :
        <img src={url} loading="lazy" onError={() => setFailed(true)} className={'max-w-full object-contain ' + (large ? 'max-h-44' : 'max-h-20')} alt={name}/>}
    </div>
    <figcaption className="break-all font-mono text-[11px]">{name} {isDraftName(name) && <DraftMark/>}</figcaption>
  </figure>;
}

export function SimilarityPairPreview({ pair, labels, onOpenMap }: {
  pair: LibraryPair; labels: Record<SimilarityCriterion, string>; onOpenMap: (id: string) => void;
}) {
  const reasons = pair.reasons.map(k => t(labels[k]));
  const assets = pair.kind === 'scenery' && pair.sceneries[0];
  return <div className="space-y-3">
    <p className="text-zinc-300"><strong className="mr-2 text-base text-emerald-300">{pair.score}/100</strong>{reasons.join(' · ')}</p>
    {assets ? <div className="grid grid-cols-2 gap-3">
      {([{ name: assets.left, owner:pair.leftName, id:pair.leftId }, { name:assets.right, owner:pair.rightName, id:pair.rightId }]).map((side, i) =>
        <div className="min-w-0 space-y-2" key={i}>
          <SceneryImage name={side.name} mapId={side.id} large/>
          <button type="button" title={t('Open in map browser')} className="break-all text-left text-emerald-200 hover:underline"
            onClick={() => onOpenMap(side.id)}>{t('Source map: {name}', { name: side.owner })}</button>
          {isDraftName(side.owner) && <DraftMark/>}
        </div>)}
    </div> : <div className="grid grid-cols-2 gap-3">
      <MapPreview key={pair.leftId} id={pair.leftId} name={pair.leftName} crc={pair.leftCrc} hasThumb={pair.leftHasThumbnail} onOpenMap={onOpenMap}/>
      <MapPreview key={pair.rightId} id={pair.rightId} name={pair.rightName} crc={pair.rightCrc} hasThumb={pair.rightHasThumbnail} onOpenMap={onOpenMap}/>
    </div>}
    {!assets && pair.sceneries.length > 0 && <div className="space-y-2 border-t border-zinc-800 pt-2">
      <h4 className="font-semibold text-zinc-200">{t('Scenery pairs')}</h4>
      <div className="max-h-56 space-y-3 overflow-auto">
        {pair.sceneries.map((p, index) => <div key={p.left + '/' + p.right + '/' + index} className="grid grid-cols-2 gap-3">
          <SceneryImage name={p.left} mapId={pair.leftId}/><SceneryImage name={p.right} mapId={pair.rightId}/>
        </div>)}
      </div>
    </div>}
  </div>;
}
