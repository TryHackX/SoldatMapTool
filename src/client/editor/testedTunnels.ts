import { DEFAULT_TUNNEL, type TunnelSettings } from '@shared/climbTunnel';
import { sketchExample } from './tunnelBlueprint';

export const TESTED_TUNNELS = {
  spiral: { label: 'Spiral', name: 'ctf_kz_spirala_240', seed: 240, palette: 'amethyst' },
  winding: { label: 'Switchbacks', name: 'ctf_kz_serpentyna_1617', seed: 1617, palette: 'glacier' },
  hills: { label: 'Rolling hills', name: 'ctf_kz_pagorki_1729', seed: 1729, palette: 'moss' },
} as const;

export type TestedTunnel = keyof typeof TESTED_TUNNELS;

/** Reproducible starting maps. An imported library profile would change their geometry. */
export function loadTestedTunnel(key: TestedTunnel) {
  const example = TESTED_TUNNELS[key];
  const settings: TunnelSettings = {
    ...DEFAULT_TUNNEL,
    seed: example.seed,
    palette: example.palette,
    profileSource: 'builtin',
    length: 'long',
    direction: 'winding',
    clearance: 118,
    roughness: 60,
  };
  if (key !== 'hills') {
    Object.assign(settings, {
      difficulty: 'relaxed', clearance: 96, roughness: key === 'spiral' ? 30 : 24,
      spikes: false, lowCeilings: false, ice: false, deadly: 0, hurt: 0, bounce: 0,
    });
  }
  const path = key === 'winding' ? [] : sketchExample(key, { x: 0, y: 0 }, settings.clearance);
  return { settings, path, name: example.name, method: key === 'winding' ? 'auto' as const : 'draw' as const };
}
