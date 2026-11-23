import { t } from '../../i18n';
import { dragShapeOutline, type ShapeOrientation } from '../dragShapes';
import type { EditorPlacementDefaults } from '../types';

type Mode = EditorPlacementDefaults['polyShapeMode'];
const shapes = [
  ['rect', 'Box'], ['polygon', 'Free'], ['ramp', 'Ramp'], ['spike', 'Spike'],
] as const;
const turns = [0, 1, 2, 3] as const;
const rampTurns = ['Floor rising right', 'Floor rising left', 'Ceiling rising right', 'Ceiling rising left'];
const spikeTurns = ['Tip up', 'Tip right', 'Tip down', 'Tip left'];
const button = 'rounded border cursor-pointer focus-visible:outline focus-visible:outline-cyan-300';
const selected = ' bg-cyan-500/15 border-cyan-400/60 text-cyan-200';
const idle = ' bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500';

function ShapeGlyph({ mode, turn = 0 }: { mode: Mode; turn?: ShapeOrientation }) {
  const points = mode === 'polygon' ? '0 76%, 20% 7%, 55% 33%, 80% 4%, 100% 76%, 42% 100%' :
    dragShapeOutline(mode, { x: 0, y: 0 }, { x: 100, y: 100 }, turn)
      .map(p => `${p.x}% ${p.y}%`).join(', ');
  return <span aria-hidden="true" className="block w-4 h-3 bg-current" style={{ clipPath: `polygon(${points})` }}/>;
}

export function PolygonShapeControls({ value, onChange }: {
  value: EditorPlacementDefaults; onChange: (next: EditorPlacementDefaults) => void;
}) {
  const mode = value.polyShapeMode;
  const orientable = mode === 'ramp' || mode === 'spike';
  return <div className="space-y-2">
    <div role="group" aria-label={t('Polygon shapes')} className="grid grid-cols-2 gap-1.5">
      {shapes.map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id}
        className={button + (mode === id ? selected : idle) + ' flex items-center gap-2 px-2 py-1.5'}
        onClick={() => onChange({ ...value, polyShapeMode: id })}>
        <ShapeGlyph mode={id}/>{t(label)}
      </button>)}
    </div>
    {orientable && <fieldset className="space-y-1">
      <legend className="text-[11px] text-zinc-400">{t('Shape direction')}</legend>
      <div className="flex items-stretch gap-1">
        <button type="button" aria-pressed={value.shapeOrientation === 'drag'}
          className={button + (value.shapeOrientation === 'drag' ? selected : idle) + ' px-1.5 text-[11px]'}
          onClick={() => onChange({ ...value, shapeOrientation: 'drag' })}>{t('From drag')}</button>
        {turns.map(turn => {
          const name = t((mode === 'ramp' ? rampTurns : spikeTurns)[turn]);
          return <button key={turn} type="button" aria-label={name} title={name}
            aria-pressed={value.shapeOrientation === turn}
            className={button + (value.shapeOrientation === turn ? selected : idle) + ' flex-1 grid place-items-center min-h-7'}
            onClick={() => onChange({ ...value, shapeOrientation: turn })}><ShapeGlyph mode={mode} turn={turn}/></button>;
        })}
      </div>
    </fieldset>}
    <p className="text-[11px] leading-relaxed text-zinc-400">{mode === 'polygon'
      ? t('Click to add corners. Close at the first point or press Enter. Backspace removes a corner.')
      : orientable && value.shapeOrientation === 'drag'
        ? t('Drag from the base towards the tip. Release to place the shape.')
        : t('Drag between opposite corners. Release to place the shape.')}</p>
  </div>;
}
