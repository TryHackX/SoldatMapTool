import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Dices, Palette, RotateCcw, RotateCw, Shuffle, SunDim } from 'lucide-react';
import { PmsMapData } from '@shared/pmsParser';
import { RgbaColor } from '@shared/soldatConstants';
import { t } from '../../i18n';
import { hexToRgb, hsvToRgb, parseHexColor, rgbToHex, rgbToHsv } from '../colorTools';
import {
  adjustPropsTint,
  applyDepthHaze,
  gradientProps,
  PropGradientAxis,
  randomizeProps,
  rotatePropsInPlace,
  scaleProps,
  setPropsTint,
} from '../sceneryOps';
import { CommitTextInput, NumberInput } from './EditorFields';

type CommitFn = (label: string, nextMap: PmsMapData, nextSelection?: undefined, transactionId?: string) => void;

interface SceneryToolsProps {
  map: PmsMapData;
  indices: number[]; // selected props
  onCommit: CommitFn;
}

const RECENT_TINTS_KEY = 'soldat-map-studio.editor.recentTints.v1';
const MAX_RECENT_TINTS = 10;

// Prop colour multiplies the image, so these read as light / atmosphere colours rather than paint
export const SCENERY_TINT_PRESETS: ReadonlyArray<{ labelEn: string; hex: string }> = [
  { labelEn: 'Neutral', hex: '#ffffff' },
  { labelEn: 'Shadow', hex: '#64748b' },
  { labelEn: 'Night', hex: '#3b82f6' },
  { labelEn: 'Dusk', hex: '#a78bfa' },
  { labelEn: 'Sunset', hex: '#fb923c' },
  { labelEn: 'Torch', hex: '#fbbf24' },
  { labelEn: 'Lush', hex: '#4ade80' },
  { labelEn: 'Toxic', hex: '#a3e635' },
  { labelEn: 'Ice', hex: '#67e8f9' },
  { labelEn: 'Fog', hex: '#cbd5e1' },
  { labelEn: 'Crimson', hex: '#f87171' },
  { labelEn: 'Ember', hex: '#b91c1c' },
];

function readRecentTints(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_TINTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string' && parseHexColor(x)).slice(0, MAX_RECENT_TINTS) : [];
  } catch {
    return [];
  }
}

function rememberTint(hex: string): string[] {
  const next = [hex.toLowerCase(), ...readRecentTints().filter((h) => h !== hex.toLowerCase())].slice(0, MAX_RECENT_TINTS);
  try {
    window.localStorage.setItem(RECENT_TINTS_KEY, JSON.stringify(next));
  } catch {
    // Recent colours are a convenience only
  }
  return next;
}

/** One undo step per slider drag: a new id when the pointer (or a key) starts a gesture */
function useGestureId(prefix: string): { start: () => void; id: () => string } {
  const ref = useRef(`${prefix}_0`);
  return {
    start: () => {
      ref.current = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    },
    id: () => ref.current,
  };
}

const Section: React.FC<{ title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  icon,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-zinc-100 cursor-pointer"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {icon}
        <span className="font-medium">{title}</span>
      </button>
      {open && children}
    </div>
  );
};

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  trackStyle?: React.CSSProperties;
  onStart: () => void;
  onChange: (v: number) => void;
  onEnd?: () => void;
}> = ({ label, value, min, max, step = 1, suffix = '', trackStyle, onStart, onChange, onEnd }) => (
  <div className="flex items-center gap-2 text-[10px]">
    <span className="w-16 shrink-0 text-zinc-400 truncate">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={onStart}
      onKeyDown={(e) => {
        if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) onStart();
      }}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onBlur={onEnd}
      onKeyUp={onEnd}
      style={trackStyle}
      className="flex-1 accent-cyan-400 h-1.5 rounded appearance-auto"
    />
    <span className="w-10 text-right font-mono text-zinc-400">
      {Math.round(value)}
      {suffix}
    </span>
  </div>
);

const HUE_TRACK: React.CSSProperties = {
  background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
};

/**
 * "Colorize": the prop colour multiplies the image in the game, so white keeps it as drawn and any other colour
 * tints it like coloured light. Absolute colour for the selection, plus relative shifts that keep the
 * differences between several props, gradients and random variation.
 */
export const SceneryColorTools: React.FC<SceneryToolsProps> = ({ map, indices, onCommit }) => {
  const props = indices.map((i) => map.props[i]).filter(Boolean);
  const first = props[0];
  const [recent, setRecent] = useState<string[]>(() => readRecentTints());
  const tint = useGestureId('prop_tint');
  const shiftGesture = useGestureId('prop_tint_shift');
  const shiftBaseRef = useRef<PmsMapData | null>(null);
  const [shift, setShift] = useState({ h: 0, s: 0, v: 0 });
  if (!first) return null;

  const hsv = rgbToHsv(first.color);
  const hex = rgbToHex(first.color);
  const mixed = props.some((p) => p.color.r !== first.color.r || p.color.g !== first.color.g || p.color.b !== first.color.b);

  const applyTint = (color: RgbaColor, label: string, txId?: string) => {
    onCommit(label, setPropsTint(map, indices, color), undefined, txId);
  };
  const finishTint = () => setRecent(rememberTint(rgbToHex(map.props[indices[0]]?.color ?? first.color)));

  const startShift = () => {
    if (!shiftBaseRef.current) {
      shiftBaseRef.current = map;
      shiftGesture.start();
    }
  };
  const applyShift = (next: { h: number; s: number; v: number }) => {
    setShift(next);
    const base = shiftBaseRef.current ?? map;
    onCommit(
      'Shift scenery colours',
      adjustPropsTint(base, indices, { hueShift: next.h, saturation: next.s / 100, brightness: next.v / 100 }),
      undefined,
      shiftGesture.id()
    );
  };
  const endShift = () => {
    // The sliders are relative to the colours at the start of the drag: back to 0 for the next one
    shiftBaseRef.current = null;
    setShift({ h: 0, s: 0, v: 0 });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-300 text-[11px] font-medium flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-cyan-300" />
          {t('Colorize')}
          {mixed && <span className="text-[10px] text-zinc-500">{t('(mixed)')}</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={hex}
            onFocus={tint.start}
            onChange={(e) => applyTint(hexToRgb(e.target.value), 'Tint scenery', tint.id())}
            onBlur={finishTint}
            title={t('Pick a colour')}
            className="w-7 h-6 rounded bg-transparent cursor-pointer"
          />
          <CommitTextInput
            value={hex}
            onChange={(e) => {
              const c = parseHexColor(e.target.value);
              if (!c) return;
              applyTint({ ...c, a: 255 }, 'Tint scenery');
              setRecent(rememberTint(rgbToHex(c)));
            }}
            aria-label={t('Colour as hex (#rrggbb)')}
            className="w-18 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100"
          />
          <button
            type="button"
            onClick={() => applyTint({ r: 255, g: 255, b: 255, a: 255 }, 'Reset scenery tint')}
            title={t('White = the image as drawn')}
            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300 cursor-pointer"
          >
            {t('Reset')}
          </button>
        </div>
      </div>

      <Slider
        label={t('Hue')}
        value={Math.round(hsv.h)}
        min={0}
        max={360}
        suffix="°"
        trackStyle={HUE_TRACK}
        onStart={tint.start}
        onChange={(h) => applyTint(hsvToRgb({ ...hsv, h, s: hsv.s < 0.05 ? 0.6 : hsv.s }), 'Tint scenery', tint.id())}
        onEnd={finishTint}
      />
      <Slider
        label={t('Saturation')}
        value={Math.round(hsv.s * 100)}
        min={0}
        max={100}
        suffix="%"
        onStart={tint.start}
        onChange={(s) => applyTint(hsvToRgb({ ...hsv, s: s / 100 }), 'Tint scenery', tint.id())}
        onEnd={finishTint}
      />
      <Slider
        label={t('Brightness')}
        value={Math.round(hsv.v * 100)}
        min={0}
        max={100}
        suffix="%"
        onStart={tint.start}
        onChange={(v) => applyTint(hsvToRgb({ ...hsv, v: v / 100 }), 'Tint scenery', tint.id())}
        onEnd={finishTint}
      />

      <div className="grid grid-cols-6 gap-1">
        {SCENERY_TINT_PRESETS.map((pr) => (
          <button
            key={pr.labelEn}
            type="button"
            onClick={() => {
              applyTint(hexToRgb(pr.hex), 'Tint scenery');
              setRecent(rememberTint(pr.hex));
            }}
            title={t(pr.labelEn)}
            aria-label={t(pr.labelEn)}
            className={`h-5 rounded border cursor-pointer ${
              hex === pr.hex ? 'border-cyan-300 ring-1 ring-cyan-300/60' : 'border-white/15 hover:border-white/40'
            }`}
            style={{ backgroundColor: pr.hex }}
          />
        ))}
      </div>
      {recent.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-500 shrink-0 w-16">{t('Recent')}</span>
          <div className="flex flex-wrap gap-1">
            {recent.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => applyTint(hexToRgb(h), 'Tint scenery')}
                title={h}
                className="w-4 h-4 rounded-sm border border-white/15 hover:border-white/50 cursor-pointer"
                style={{ backgroundColor: h }}
              />
            ))}
          </div>
        </div>
      )}

      {indices.length > 1 && (
        <div className="space-y-1 pt-1">
          <div className="text-[10px] text-zinc-500">{t('Shift all selected (keeps their differences)')}</div>
          <Slider
            label={t('Hue')}
            value={shift.h}
            min={-180}
            max={180}
            suffix="°"
            onStart={startShift}
            onChange={(h) => applyShift({ ...shift, h })}
            onEnd={endShift}
          />
          <Slider
            label={t('Saturation')}
            value={shift.s}
            min={-100}
            max={100}
            suffix="%"
            onStart={startShift}
            onChange={(s) => applyShift({ ...shift, s })}
            onEnd={endShift}
          />
          <Slider
            label={t('Brightness')}
            value={shift.v}
            min={-100}
            max={100}
            suffix="%"
            onStart={startShift}
            onChange={(v) => applyShift({ ...shift, v })}
            onEnd={endShift}
          />
        </div>
      )}
    </div>
  );
};

/** Colour / opacity gradient across the selection (fog, light falloff, fading clouds) */
export const SceneryGradientTools: React.FC<SceneryToolsProps> = ({ map, indices, onCommit }) => {
  const [from, setFrom] = useState('#ffffff');
  const [to, setTo] = useState('#475569');
  const [axis, setAxis] = useState<PropGradientAxis>('x');
  const [useColor, setUseColor] = useState(true);
  const [useAlpha, setUseAlpha] = useState(false);
  const [alphaFrom, setAlphaFrom] = useState(255);
  const [alphaTo, setAlphaTo] = useState(80);
  const enough = indices.length >= 2;
  return (
    <Section title={t('Gradient across the selection')} icon={<SunDim className="w-3.5 h-3.5 text-amber-300" />}>
      <div className="grid grid-cols-3 gap-1">
        {(
          [
            ['x', t('Left → right')],
            ['y', t('Top → bottom')],
            ['radial', t('Centre → out')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAxis(id)}
            className={`py-1 rounded text-[10px] border cursor-pointer ${
              axis === id ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[10px] text-zinc-300">
        <input type="checkbox" checked={useColor} onChange={(e) => setUseColor(e.target.checked)} className="accent-cyan-500" />
        <span className="w-14">{t('Colour')}</span>
        <input type="color" value={from} onChange={(e) => setFrom(e.target.value)} className="w-7 h-5 bg-transparent cursor-pointer" />
        <span className="text-zinc-500">→</span>
        <input type="color" value={to} onChange={(e) => setTo(e.target.value)} className="w-7 h-5 bg-transparent cursor-pointer" />
      </label>
      <label className="flex items-center gap-2 text-[10px] text-zinc-300">
        <input type="checkbox" checked={useAlpha} onChange={(e) => setUseAlpha(e.target.checked)} className="accent-cyan-500" />
        <span className="w-14">{t('Opacity')}</span>
        <NumberInput
          min={0}
          max={255}
          value={alphaFrom}
          onChange={(e) => setAlphaFrom(Number(e.target.value))}
          className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 font-mono text-[10px] text-zinc-100"
        />
        <span className="text-zinc-500">→</span>
        <NumberInput
          min={0}
          max={255}
          value={alphaTo}
          onChange={(e) => setAlphaTo(Number(e.target.value))}
          className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 font-mono text-[10px] text-zinc-100"
        />
      </label>
      <button
        type="button"
        disabled={!enough || (!useColor && !useAlpha)}
        onClick={() =>
          onCommit(
            'Scenery gradient',
            gradientProps(map, indices, {
              axis,
              tint: useColor,
              from: hexToRgb(from),
              to: hexToRgb(to),
              ...(useAlpha ? { alphaFrom, alphaTo } : {}),
            })
          )
        }
        title={enough ? undefined : t('Select at least two sceneries')}
        className="w-full py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default"
      >
        {t('Apply gradient')}
      </button>
    </Section>
  );
};

/** Natural variation for many identical props: each gets a slightly different size, angle and colour */
export const SceneryVariationTools: React.FC<SceneryToolsProps> = ({ map, indices, onCommit }) => {
  const [scale, setScale] = useState(15);
  const [rotation, setRotation] = useState(8);
  const [hue, setHue] = useState(0);
  const [brightness, setBrightness] = useState(10);
  const [alpha, setAlpha] = useState(0);
  const [flipX, setFlipX] = useState(false);
  // Re-roll replaces the previous roll (same undo step) as long as nothing else changed the map in between
  const lastRollRef = useRef<{ base: PmsMapData; result: PmsMapData; txId: string } | null>(null);

  const roll = (reroll: boolean) => {
    const last = lastRollRef.current;
    const continuing = reroll && last && last.result === map;
    const base = continuing ? last.base : map;
    const txId = continuing ? last.txId : `prop_variation_${Date.now()}`;
    const result = randomizeProps(base, indices, {
      seed: Math.floor(Math.random() * 2 ** 31),
      scale: scale / 100,
      rotationDeg: rotation,
      hue,
      brightness: brightness / 100,
      alpha,
      flipX,
    });
    lastRollRef.current = { base, result, txId };
    onCommit('Randomize sceneries', result, undefined, txId);
  };

  const row = (label: string, value: number, max: number, set: (v: number) => void, suffix: string) => (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 shrink-0 text-zinc-400 truncate">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="flex-1 accent-cyan-400"
      />
      <span className="w-10 text-right font-mono text-zinc-400">
        ±{value}
        {suffix}
      </span>
    </div>
  );

  return (
    <Section title={t('Random variation')} icon={<Dices className="w-3.5 h-3.5 text-violet-300" />}>
      {row(t('Size'), scale, 50, setScale, '%')}
      {row(t('Angle'), rotation, 45, setRotation, '°')}
      {row(t('Hue'), hue, 60, setHue, '°')}
      {row(t('Brightness'), brightness, 50, setBrightness, '%')}
      {row(t('Opacity'), alpha, 128, setAlpha, '')}
      <label className="flex items-center gap-2 text-[10px] text-zinc-300">
        <input type="checkbox" checked={flipX} onChange={(e) => setFlipX(e.target.checked)} className="accent-cyan-500" />
        <span>{t('Random horizontal mirror (Flip X)')}</span>
      </label>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => roll(false)}
          className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] flex items-center justify-center gap-1 cursor-pointer"
        >
          <Shuffle className="w-3 h-3" />
          {t('Apply')}
        </button>
        <button
          type="button"
          onClick={() => roll(true)}
          title={t('Roll again, replacing the previous result')}
          className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] flex items-center justify-center gap-1 cursor-pointer"
        >
          <Dices className="w-3 h-3" />
          {t('Re-roll')}
        </button>
      </div>
    </Section>
  );
};

/** Size in percent (keeping each prop's flip and aspect), quick sizes and 15° / 90° turns around each prop's centre */
export const SceneryScaleTools: React.FC<SceneryToolsProps> = ({ map, indices, onCommit }) => {
  const [lockAspect, setLockAspect] = useState(true);
  const props = indices.map((i) => map.props[i]).filter(Boolean);
  const first = props[0];
  if (!first) return null;
  const pctX = Math.round(Math.abs(first.scaleX) * 1000) / 10;
  const pctY = Math.round(Math.abs(first.scaleY) * 1000) / 10;

  const setPercent = (axis: 'x' | 'y' | 'both', pct: number) => {
    if (!(pct > 0)) return;
    const v = pct / 100;
    if (axis === 'both') {
      // Keep each prop's own width / height ratio
      let next = map;
      for (const idx of indices) {
        const p = map.props[idx];
        if (!p) continue;
        const ratio = Math.abs(p.scaleX) > 1e-6 ? Math.abs(p.scaleY / p.scaleX) : 1;
        next = scaleProps(next, [idx], v, v * ratio, 'absolute');
      }
      onCommit('Set scenery scale', next);
    } else {
      onCommit(
        'Set scenery scale',
        // The other axis keeps its own value per prop (relative factor 1)
        axis === 'x'
          ? indices.reduce((m, idx) => {
              const p = m.props[idx];
              return p ? scaleProps(m, [idx], v / Math.max(1e-6, Math.abs(p.scaleX)), 1) : m;
            }, map)
          : indices.reduce((m, idx) => {
              const p = m.props[idx];
              return p ? scaleProps(m, [idx], 1, v / Math.max(1e-6, Math.abs(p.scaleY))) : m;
            }, map)
      );
    }
  };

  const fieldCls = 'w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-[11px] text-zinc-100';
  const btnCls =
    'py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-mono text-zinc-300 cursor-pointer';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="w-14 shrink-0 text-zinc-400">{t('Size')}</span>
        {lockAspect ? (
          <NumberInput min={1} max={6400} step={5} value={pctX} onChange={(e) => setPercent('both', Number(e.target.value))} className={fieldCls} />
        ) : (
          <>
            <NumberInput min={1} max={6400} step={5} value={pctX} onChange={(e) => setPercent('x', Number(e.target.value))} className={fieldCls} title={t('Width %')} />
            <NumberInput min={1} max={6400} step={5} value={pctY} onChange={(e) => setPercent('y', Number(e.target.value))} className={fieldCls} title={t('Height %')} />
          </>
        )}
        <span className="text-zinc-500">%</span>
        <label className="flex items-center gap-1 text-zinc-400 ml-auto cursor-pointer" title={t('Keep the width / height ratio')}>
          <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} className="accent-cyan-500" />
          {t('Lock aspect')}
        </label>
      </div>
      <div className="grid grid-cols-6 gap-1">
        <button type="button" className={btnCls} title={t('10% smaller')} onClick={() => onCommit('Scale sceneries', scaleProps(map, indices, 1 / 1.1, 1 / 1.1))}>
          −10%
        </button>
        <button type="button" className={btnCls} title={t('10% larger')} onClick={() => onCommit('Scale sceneries', scaleProps(map, indices, 1.1, 1.1))}>
          +10%
        </button>
        {[50, 100, 150, 200].map((pct) => (
          <button key={pct} type="button" className={btnCls} onClick={() => setPercent('both', pct)}>
            {pct}%
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        <button type="button" className={btnCls} title={t('Turn 90° left')} onClick={() => onCommit('Rotate sceneries', rotatePropsInPlace(map, indices, -90))}>
          ⟲90°
        </button>
        <button type="button" className={btnCls} title={t('Turn 15° left')} onClick={() => onCommit('Rotate sceneries', rotatePropsInPlace(map, indices, -15))}>
          <RotateCcw className="w-3 h-3 inline" /> 15°
        </button>
        <button
          type="button"
          className={btnCls}
          title={t('Straighten (rotation 0°)')}
          onClick={() => {
            let next = map;
            for (const idx of indices) {
              const p = map.props[idx];
              // rotatePropsInPlace subtracts its angle from the PMS rotation, so turning by the rotation itself gives 0
              if (p && p.rotation !== 0) next = rotatePropsInPlace(next, [idx], (p.rotation * 180) / Math.PI);
            }
            onCommit('Rotate sceneries', next);
          }}
        >
          0°
        </button>
        <button type="button" className={btnCls} title={t('Turn 15° right')} onClick={() => onCommit('Rotate sceneries', rotatePropsInPlace(map, indices, 15))}>
          15° <RotateCw className="w-3 h-3 inline" />
        </button>
        <button type="button" className={btnCls} title={t('Turn 90° right')} onClick={() => onCommit('Rotate sceneries', rotatePropsInPlace(map, indices, 90))}>
          90°⟳
        </button>
      </div>
    </div>
  );
};

/**
 * Depth haze for the whole map: blends every scenery's tint towards one colour by layer, strongest for the back
 * layer (far away), weaker for the middle, usually none for the front. One click gives a map a sense of depth.
 */
export const SceneryHazeTools: React.FC<{ map: PmsMapData; onCommit: CommitFn }> = ({ map, onCommit }) => {
  const [color, setColor] = useState('#9fb4d0');
  const [back, setBack] = useState(45);
  const [middle, setMiddle] = useState(15);
  const [front, setFront] = useState(0);
  const count = map.props.filter((p) => p.active && p.level <= 2 && p.style > 0 && p.style <= map.scenery.length).length;
  const row = (label: string, value: number, set: (v: number) => void) => (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 shrink-0 text-zinc-400 truncate">{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(e) => set(Number(e.target.value))} className="flex-1 accent-cyan-400" />
      <span className="w-10 text-right font-mono text-zinc-400">{value}%</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-zinc-500 leading-snug">
        {t('Depth haze tints the sceneries of each layer towards one colour; distant layers fade the most.')}
      </div>
      <label className="flex items-center gap-2 text-[10px] text-zinc-300">
        <span className="w-16 shrink-0 text-zinc-400">{t('Haze colour')}</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-5 bg-transparent cursor-pointer" />
        <div className="flex gap-1 ml-auto">
          {['#9fb4d0', '#f2c18d', '#1e293b', '#c7d2fe'].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setColor(h)}
              className="w-4 h-4 rounded-sm border border-white/15 hover:border-white/50 cursor-pointer"
              style={{ backgroundColor: h }}
            />
          ))}
        </div>
      </label>
      {row(t('Back (0)'), back, setBack)}
      {row(t('Mid (1)'), middle, setMiddle)}
      {row(t('Front (2)'), front, setFront)}
      <button
        type="button"
        disabled={count === 0 || (back === 0 && middle === 0 && front === 0)}
        onClick={() =>
          onCommit(
            'Depth haze',
            applyDepthHaze(map, { color: hexToRgb(color), back: back / 100, middle: middle / 100, front: front / 100 })
          )
        }
        className="w-full py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-default"
      >
        {t('Apply haze to {count} sceneries', { count })}
      </button>
    </div>
  );
};
