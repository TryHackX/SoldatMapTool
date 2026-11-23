import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Spline } from 'lucide-react';
import { TUNNEL_PALETTES, type TunnelPoint } from '@shared/climbTunnel';
import { TUNNEL_WIDTH_OFFSET_RANGE, type TunnelProject, type TunnelSectionChange, type TunnelSectionResult } from '@shared/tunnelProject';
import { locale, t } from '../../i18n';

export type SectionPreview =
  | { ok: true; changedPolygons: number }
  | Extract<TunnelSectionResult, { ok: false }>;

export interface TunnelProjectPanelProps {
  project: TunnelProject;
  knotIndex: number;
  point: TunnelPoint;
  landingHeight: number;
  landingReach?: number;
  repairing?: boolean;
  bounce: number | null;
  widthOffset: number;
  preview: SectionPreview | null;
  locked: boolean;
  onSelectKnot: (index: number) => void;
  onChange: (patch: TunnelSectionChange) => void;
  onApply: () => void;
  onCancel: () => void;
  onFrame?: () => void;
  comparing: boolean;
  onCompare: (open: boolean) => void;
  variants: ReactNode;
}

const inputStyle = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 focus:border-cyan-400 focus:outline-none disabled:opacity-50';
const iconButton = 'rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-35';
const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
const widthPresets = [
  { offset: -16, label: 'Pinch' },
  { offset: 0, label: 'Original width' },
  { offset: 24, label: 'Chamber' },
] as const;

function widthLabel(offset: number) {
  return t('{n} map units', { n: (offset > 0 ? '+' : '') + numberFormat.format(offset) });
}

function SectionWidth({ offset, onChange }: { offset: number; onChange: (value: number) => void }) {
  return <div className="space-y-1.5">
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{t('Local width adjustment')}</span>
        <output className="font-mono text-cyan-200">{widthLabel(offset)}</output>
      </span>
      <input type="range" min={TUNNEL_WIDTH_OFFSET_RANGE.min} max={TUNNEL_WIDTH_OFFSET_RANGE.max} step={1}
        value={offset} aria-label={t('Local width adjustment')} aria-valuetext={widthLabel(offset)}
        onChange={event => onChange(event.currentTarget.valueAsNumber)} className="block w-full accent-cyan-400"/>
    </label>
    <div className="grid grid-cols-3 gap-1">
      {widthPresets.map(preset => <button key={preset.offset} type="button" aria-pressed={preset.offset === offset}
        title={`${t(preset.label)} (${widthLabel(preset.offset)})`} onClick={() => onChange(preset.offset)}
        className={'rounded-md border px-1 py-1.5 text-xs ' + (preset.offset === offset
          ? 'border-cyan-400/60 bg-cyan-950 text-cyan-200' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800')}>
        <span>{t(preset.label)}</span>
        <span aria-hidden="true" className="block font-mono text-[10px] opacity-80">{widthLabel(preset.offset)}</span>
      </button>)}
    </div>
    <p className="text-[11px] leading-relaxed text-zinc-400">{t('The adjustment tapers to zero at both neighbouring points.')}</p>
  </div>;
}

function projectOverview(knots: readonly TunnelPoint[], point: TunnelPoint) {
  const left = Math.min(point.x, ...knots.map(p => p.x));
  const right = Math.max(point.x, ...knots.map(p => p.x));
  const top = Math.min(point.y, ...knots.map(p => p.y));
  const bottom = Math.max(point.y, ...knots.map(p => p.y));
  const scale = Math.min(524 / Math.max(1, right - left), 154 / Math.max(1, bottom - top));
  const project = (p: TunnelPoint) => ({
    x: 280 + (p.x - (left + right) / 2) * scale,
    y: 95 + (p.y - (top + bottom) / 2) * scale,
  });
  return { positions: knots.map(project), selected: project(point) };
}

function SectionOverview({ knots, knotIndex, point, pending, onSelect }: {
  knots: readonly TunnelPoint[]; knotIndex: number; point: TunnelPoint;
  pending: boolean; onSelect: (index: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { positions, selected } = useMemo(() => projectOverview(knots, point), [knots, point.x, point.y]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 560, 190);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#657983';
    ctx.beginPath();
    positions.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    const left = positions[knotIndex - 1], right = positions[knotIndex + 1];
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#67e8f9';
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(selected.x, selected.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
    function dot(p: TunnelPoint, color: string, radius: number) {
      if (!ctx) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    dot(positions[0], '#fda4af', 5);
    dot(positions[positions.length - 1], '#93c5fd', 5);
    dot(left, '#cffafe', 4);
    dot(right, '#cffafe', 4);
    dot(selected, '#07191d', 8);
    dot(selected, '#67e8f9', 5);
  }, [positions, selected, knotIndex]);

  // The adjacent native select offers the same navigation from a keyboard.
  return <canvas ref={canvas} width={560} height={190} role="img"
    aria-label={t('Tunnel overview with the selected section highlighted')}
    className={'block w-full rounded-md border border-zinc-700 bg-[#101c22] ' + (pending ? '' : 'cursor-pointer')}
    onClick={event => {
      if (pending) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      let closest = -1, distance = 14;
      for (let i = 1; i < positions.length - 1; i++) {
        const p = positions[i];
        const d = Math.hypot(p.x * rect.width / 560 - x, p.y * rect.height / 190 - y);
        if (d < distance) { distance = d; closest = i; }
      }
      if (closest >= 0 && closest !== knotIndex) onSelect(closest);
    }}/>;
}

function Coordinate({ axis, value, onChange }: { axis: 'X' | 'Y'; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(current => current.trim() && Number(current) === value ? current : String(value));
  }, [value]);
  return <label className="flex items-center gap-1.5">
    <span aria-hidden="true" className="font-mono text-zinc-400">{axis}</span>
    <input type="number" step="any" value={text} aria-label={t('Bend coordinate {axis}', {axis})}
      className={inputStyle + ' min-w-0 font-mono'}
      onChange={e => {
        setText(e.target.value);
        if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
      }}
      onBlur={() => setText(String(value))}/>
  </label>;
}

function GeneratorSettings({ project }: { project: TunnelProject }) {
  const s = project.settings;
  const difficulty = { relaxed: 'Relaxed', race: 'Time trial', expert: 'Expert' } as const;
  const length = { short: 'Short', medium: 'Medium', long: 'Long' } as const;
  const direction = { winding: 'Winding', up: 'Uphill', down: 'Downhill', across: 'Across' } as const;
  const features = [
    [s.ramps, 'Takeoff ramps'], [s.spikes, 'Floor spikes'], [s.lowCeilings, 'Low ceilings'],
    [s.drops, 'Drop-offs'], [s.ice, 'Ice sections'], [s.deadlyWalls, 'Deadly walls'],
    [s.floatingHazards, 'Suspended hazards'],
  ] as const;
  const enabledFeatures = features.filter(([enabled]) => enabled).map(([, label]) => t(label));
  const rows = [
    [t('Seed'), s.seed],
    [t('Tunnel path'), project.method === 'auto' ? t('Automatic route') : t('Drawn route')],
    ...(project.method === 'auto' ? [
      [t('Route length'), t(length[s.length])],
      [t('Route direction'), t(direction[s.direction])],
    ] : []),
    [t('Climb difficulty'), t(difficulty[s.difficulty])],
    [t('Tunnel width'), t('{n} map units', {n: s.clearance})],
    [t('Rock palette'), t(TUNNEL_PALETTES[s.palette].label)],
    [t('Rock roughness'), s.roughness + '%'],
    [t('Deadly terrain'), s.deadly + '%'],
    [t('Hurting terrain'), s.hurt + '%'],
    [t('Bounce surfaces'), s.bounce + '%'],
  ];
  return <details className="rounded-md border border-zinc-800 px-2.5 py-2">
    <summary className="cursor-pointer font-medium text-zinc-300">{t('Saved generator settings')}</summary>
    <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs">
      {rows.map(([label, value]) => <div className="contents" key={label}>
        <dt className="text-zinc-400">{label}</dt><dd className="text-right text-zinc-200">{value}</dd>
      </div>)}
    </dl>
    <p className="mt-2 text-[11px] text-zinc-400">
      <span className="block text-zinc-300">{t('Terrain features')}</span>
      {enabledFeatures.length ? enabledFeatures.join(', ') : t('No additional terrain features')}
    </p>
    <p className="mt-2 text-[11px] text-zinc-400">{s.profile
      ? t('Jump profile from {n} local maps.', { n: s.profile.measuredMaps })
      : t('Built-in jump profile.')}</p>
  </details>;
}

export function TunnelProjectPanel(props: TunnelProjectPanelProps) {
  const { project, knotIndex, point, landingHeight, bounce, widthOffset, locked, preview, onSelectKnot, onChange } = props;
  const { knots } = project;
  const count = knots.length - 2;
  const original = knots[knotIndex], section = project.sections[knotIndex - 1];
  if (!original || !section || knotIndex < 1 || knotIndex > count) {
    return <p role="status" className="text-xs text-zinc-400">{t('Choose an interior bend on the map.')}</p>;
  }
  const widthChanged = widthOffset !== (section.widthOffset ?? 0);
  const pending = !props.comparing && (widthChanged || point.x !== original.x || point.y !== original.y ||
    section.landingHeight !== landingHeight || (props.landingReach ?? 0)!==(section.landingReach ?? 0) || section.bounce !== bounce);
  const canApply = !locked && pending && preview?.ok === true;
  const errors = {
    manual: 'This section contains a manually edited or missing polygon. Undo that edit or choose another section.',
    clearance: widthChanged ? 'The walls would fold or obstruct the passage. Try a smaller width change.' : 'The change leaves too little clearance. Move the bend closer or lower the landing.',
    neighbour: 'This would cut into a neighbouring stretch of tunnel. Reduce the chamber width.',
    invalid: 'The section cannot be rebuilt at this position. Try a smaller change.',
    unchanged: 'This change leaves the section geometry unchanged.',
  } as const;
  const material = bounce === null ? 'original' : bounce === 0 ? 'normal' : 'bounce';

  return <section aria-label={t('Edit tunnel section')} className="space-y-3 text-xs text-zinc-200">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
      <Spline size={16} aria-hidden="true"/>{t('Edit tunnel section')}
    </h2>
    <SectionOverview knots={knots} knotIndex={knotIndex} point={point} pending={pending} onSelect={onSelectKnot}/>
    <div className="flex items-center gap-1.5">
      <button type="button" className={iconButton} aria-label={t('Previous tunnel section')}
        disabled={pending || knotIndex === 1} onClick={() => onSelectKnot(knotIndex - 1)}><ChevronLeft size={14}/></button>
      <select aria-label={t('Tunnel section')} className={inputStyle + ' min-w-0 flex-1'} value={knotIndex}
        disabled={pending} onChange={e => onSelectKnot(Number(e.target.value))}>
        {knots.slice(1, -1).map((_, i) => <option key={i} value={i+1}>{t('Section {n} of {total}', {n:i+1, total:count})}</option>)}
      </select>
      <button type="button" className={iconButton} aria-label={t('Next tunnel section')}
        disabled={pending || knotIndex === count} onClick={() => onSelectKnot(knotIndex + 1)}><ChevronRight size={14}/></button>
      {props.onFrame && <button type="button" className={iconButton} title={t('Frame selected section')}
        aria-label={t('Frame selected section')} onClick={props.onFrame}><Crosshair size={14}/></button>}
    </div>
    <div role="group" aria-label={t('Section tools')} className="grid grid-cols-2 gap-1 rounded-md bg-zinc-950 p-1">
      {[{label:'Edit section', compare:false}, {label:'Compare variants', compare:true}].map(({label, compare}) =>
        <button key={label} type="button" aria-pressed={props.comparing === compare} disabled={compare && pending}
          title={compare && pending ? t('Apply or cancel the current edit to compare variants.') : undefined}
          onClick={() => { if (props.comparing !== compare) props.onCompare(compare); }}
          className={'rounded px-2 py-2 font-medium disabled:opacity-40 ' +
            (props.comparing === compare ? 'bg-cyan-950 text-cyan-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white')}>
          {t(label)}
        </button>)}
    </div>
    {props.comparing ? props.variants : <>
    <p className="leading-relaxed text-zinc-400">{t('Drag the middle point on the map. Its two neighbours anchor the rebuild.')}</p>
    <fieldset disabled={locked || props.repairing} className="space-y-3">
      <SectionWidth offset={widthOffset} onChange={value => onChange({ widthOffset: value })}/>
      <div className="grid grid-cols-2 gap-2">
        <Coordinate axis="X" value={point.x} onChange={x => onChange({ point: {x, y:point.y} })}/>
        <Coordinate axis="Y" value={point.y} onChange={y => onChange({ point: {x:point.x, y} })}/>
      </div>
      <label className="block space-y-1">
        <span className="flex justify-between gap-2"><span>{t('Landing height offset')}</span>
          <output className="font-mono text-cyan-200">{landingHeight > 0 ? '+' : ''}{numberFormat.format(landingHeight)}</output></span>
        <input type="range" min={-30} max={30} step={1} value={landingHeight} aria-label={t('Landing height offset')}
          onChange={e => onChange({landingHeight:e.target.valueAsNumber})} className="block w-full accent-cyan-400"/>
        <span className="block text-[11px] text-zinc-400">{t('Positive values raise the landing in map units.')}</span>
      </label>
      <label className="block space-y-1.5">
        <span className="flex justify-between gap-2">{t('Landing edge extension')}<output className="font-mono text-cyan-200">{props.landingReach ?? 0} u</output></span>
        <input type="range" min={0} max={24} step={1} value={props.landingReach ?? 0} aria-label={t('Landing edge extension')}
          onChange={e=>onChange({landingReach:e.target.valueAsNumber})} className="block w-full accent-cyan-400"/>
      </label>
      <label className="block space-y-1.5">
        <span>{t('Landing material')}</span>
        <select className={inputStyle} value={material}
          onChange={e => onChange({bounce:e.target.value === 'original' ? null : e.target.value === 'normal' ? 0 : 1})}>
          <option value="original">{t('Generated material')}</option>
          <option value="normal">{t('Normal ground')}</option>
          <option value="bounce">{t('Bouncy ground')}</option>
        </select>
      </label>
      {bounce !== null && bounce > 0 && <label className="block space-y-1">
        <span className="flex justify-between gap-2"><span>{t('Bounce strength')}</span>
          <output className="font-mono text-cyan-200">{numberFormat.format(bounce)}×</output></span>
        <input type="range" min={0.1} max={4} step={0.1} aria-label={t('Bounce strength')} value={bounce}
          onChange={e => onChange({bounce:e.target.valueAsNumber})} className="block w-full accent-cyan-400"/>
      </label>}
    </fieldset>
    <GeneratorSettings project={project}/>
    <div aria-live="polite" className="space-y-1 text-xs">
      {locked && <p className="text-amber-200">{t('Unlock polygons to rebuild this section.')}</p>}
      {widthChanged && preview?.ok && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-300">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-cyan-300"/>{t('New open space')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400"/>{t('New solid terrain')}</span>
      </div>}
      {pending && (preview?.ok ? <p className="text-cyan-200">{t('Preview changes {n} polygons.', {n:preview.changedPolygons})}</p> :
        <p className="text-amber-200">{preview ? t(errors[preview.reason]) : t('Preparing section preview…')}</p>)}
    </div>
    <div className="sticky bottom-0 flex gap-2 bg-zinc-900 py-1">
      <button type="button" disabled={!pending} onClick={props.onCancel}
        className="rounded-md border border-zinc-700 px-2.5 py-2 hover:bg-zinc-800 disabled:opacity-40">{t('Cancel')}</button>
      <button type="button" disabled={!canApply} onClick={props.onApply}
        className="flex-1 rounded-md bg-cyan-400 px-2 py-2 font-semibold text-zinc-950 hover:bg-cyan-300 disabled:bg-zinc-800 disabled:text-zinc-500">
        {t(props.repairing ? 'Apply repair and run from start' : 'Rebuild this section')}
      </button>
    </div>
    </>}
  </section>;
}
