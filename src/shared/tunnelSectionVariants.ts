import type { PmsMapData } from './pmsParser';
import { rebuildTunnelSection, TUNNEL_WIDTH_OFFSET_RANGE, type TunnelProject, type TunnelSectionChange, type TunnelSectionResult } from './tunnelProject';

const STYLES = ['chamber', 'pinch', 'step', 'spring'] as const;
export type SectionVariantStyle = typeof STYLES[number];

export interface SectionVariant {
  style: SectionVariantStyle;
  seed: number;
  change: TunnelSectionChange;
  result: TunnelSectionResult | {ok:false; reason:'no-landing'};
}

function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = Math.imul(state ^ state >>> 15, state | 1);
    z ^= z + Math.imul(z ^ z >>> 7, z | 61);
    return ((z ^ z >>> 14) >>> 0) / 4294967296;
  };
}

function design(project: TunnelProject, knot: number, style: SectionVariantStyle, seed: number) {
  const random = randomSource(seed);
  const between = (low: number, high: number) => low + Math.floor(random() * (high-low+1));
  const scale = project.settings.clearance / 132;
  const base = {pinGates:true, bounce:null};
  const currentWidth = project.sections[knot-1].widthOffset ?? 0;
  switch (style) {
    case 'chamber':
      return {...base, widthOffset:Math.min(TUNNEL_WIDTH_OFFSET_RANGE.max, currentWidth + Math.round(scale * between(21,42))), landingHeight:-between(3,13)};
    case 'pinch':
      return {...base, widthOffset:Math.max(TUNNEL_WIDTH_OFFSET_RANGE.min, currentWidth - Math.round(scale * between(12,26))), landingHeight:between(0,5)};
    case 'step': {
      const jumps = project.settings.profile?.jumps;
      const sample = jumps?.[between(0,jumps.length-1)];
      const lift = sample ? Math.min(28, Math.max(10, Math.round(Math.abs(sample.rise)))) : between(12,26);
      return {...base, widthOffset:between(-6,8), landingHeight:lift, bounce:0};
    }
    case 'spring': {
      const rebounds = project.settings.profile?.rebounds;
      const sampled = rebounds?.[between(0,rebounds.length-1)] ?? between(13,24)/10;
      return {...base, widthOffset:Math.round(scale * between(8,23)), landingHeight:-between(1,8),
        bounce:Math.min(4, Math.max(0.1, Math.round(sampled * 100)/100))};
    }
  }
}

/** All candidates use the same immutable base terrain, physical gates and original route axis.
 * On a cramped bend try a milder version of the same shape before reporting the reason it failed. */
export function generateSectionVariants(map: PmsMapData, project: TunnelProject, knotIndex: number, seed: number, count = 4): SectionVariant[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff || !Number.isInteger(count) || count < 2 || count > 4 ||
    !Number.isInteger(knotIndex) || knotIndex < 1 || knotIndex >= project.knots.length-1) throw new RangeError('Invalid section variant request');

  const random = randomSource(seed ^ Math.imul(knotIndex, 0x85ebca6b) ^ project.settings.seed);
  const styles = [...STYLES];
  for (let i=styles.length-1; i>0; i--) {
    const j = Math.floor(random()*(i+1));
    [styles[i],styles[j]] = [styles[j],styles[i]];
  }
  const designs: SectionVariant[] = [];
  const committed = project.sections[knotIndex-1];
  const width = committed.widthOffset ?? 0;
  for (const style of styles.slice(0,count)) {
    const variantSeed = Math.floor(random()*0x80000000);
    const preferred = design(project,knotIndex,style,variantSeed);
    let change = preferred;
    let result: SectionVariant['result'] = rebuildTunnelSection(map,project,knotIndex,change);
    for (const gain of [0.65,0.35,0.2]) {
      if (result.ok || (result.reason !== 'clearance' && result.reason !== 'neighbour')) break;
      // Ease towards the current pose. An already widened chamber can be much closer to
      // its safe upper bound than a fresh section in the original generator settings.
      change = {...preferred,
        widthOffset:Math.round(width+(preferred.widthOffset-width)*gain),
        landingHeight:Math.round(committed.landingHeight+(preferred.landingHeight-committed.landingHeight)*gain)};
      if (gain === 0.2) {
        if (style === 'step' || style === 'spring') change.widthOffset = width;
        else change.landingHeight = committed.landingHeight;
      }
      result = rebuildTunnelSection(map,project,knotIndex,change);
    }
    if (result.ok) {
      const mesh = result.project.faces;
      if (style === 'spring' && !mesh.some(f=>f.landing===knotIndex && !f.pinnedLanding)) result = {ok:false,reason:'no-landing'};
      // Coincident geometry can result on short runs with most vertices on the gate seams.
      if (designs.some(v => v.result.ok && v.result.project.faces.every((f,i)=>f.key === mesh[i].key))) {
        result = {ok:false,reason:'unchanged'};
      }
    }
    designs.push({style,seed:variantSeed,change,result});
  }
  return designs;
}
