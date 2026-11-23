import { MAX_TUNNEL_DECORATIONS, MAX_TUNNEL_ROUTE_LENGTH, TUNNEL_PALETTES, type TunnelPoint, type TunnelSettings } from './climbTunnel';
import type { ClimbGeometryProfile, JumpSample } from './climbSamples';
import { isLibrarySnapshot } from './climbLibrary';

export interface TunnelSketch {
  method: 'auto' | 'draw';
  path: TunnelPoint[];
  settings: TunnelSettings;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberIn(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

export function isTunnelPoint(value: unknown): value is TunnelPoint {
  return record(value) && numberIn(value.x, -1e6, 1e6) && numberIn(value.y, -1e6, 1e6);
}

function isSample(value: unknown): value is JumpSample {
  return record(value) && numberIn(value.gap, 0, 1e6) && numberIn(value.rise, -1e6, 1e6) &&
    (value.landingWidth === undefined || numberIn(value.landingWidth, 0, 1e6)) &&
    (value.rebound === undefined || numberIn(value.rebound, 0, Number.MAX_VALUE));
}

function isProfile(value: unknown): value is ClimbGeometryProfile {
  if (!record(value)) return false;
  return ['measuredMaps', 'pairs', 'bounceMaps'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0) &&
    (value.library === undefined || isLibrarySnapshot(value.library)) &&
    Array.isArray(value.jumps) && value.jumps.length <= 50000 && value.jumps.every(isSample) &&
    Array.isArray(value.rebounds) && value.rebounds.length <= 50000 && value.rebounds.every(v=>numberIn(v,0,Number.MAX_VALUE)) &&
    (value.bounceJumps === undefined || (Array.isArray(value.bounceJumps) && value.bounceJumps.length <= 50000 && value.bounceJumps.every(isSample)));
}

export function isTunnelSettings(value: unknown): value is TunnelSettings {
  if (!record(value)) return false;
  return Number.isInteger(value.seed) && numberIn(value.seed, 0, 2147483647) &&
    typeof value.length === 'string' && ['short','medium','long'].includes(value.length) &&
    (value.automaticLength === undefined || numberIn(value.automaticLength, 150, MAX_TUNNEL_ROUTE_LENGTH)) &&
    (value.terrainProgression === undefined || value.terrainProgression === 'progressive' ||
      value.terrainProgression === 'steady' || value.terrainProgression === 'hard-start') &&
    typeof value.difficulty === 'string' && ['relaxed','race','expert'].includes(value.difficulty) &&
    typeof value.direction === 'string' && ['across','up','down','winding'].includes(value.direction) && typeof value.palette === 'string' &&
    Object.hasOwn(TUNNEL_PALETTES,value.palette) && numberIn(value.clearance,80,220) &&
    (value.chamberLayout === undefined || value.chamberLayout === 'classic' || value.chamberLayout === 'varied') &&
    (value.decorationBudget === undefined || Number.isInteger(value.decorationBudget) && numberIn(value.decorationBudget, 0, MAX_TUNNEL_DECORATIONS)) &&
    ['roughness','deadly','hurt','bounce'].every(key=>numberIn(value[key],0,100)) &&
    ['deadlyWalls','spikes','lowCeilings','drops','ice','ramps','floatingHazards'].every(key=>typeof value[key]==='boolean') &&
    (value.profileSource === undefined || value.profileSource === 'library' || value.profileSource === 'builtin') &&
    (value.profile === undefined || isProfile(value.profile));
}

export function isTunnelSketch(value: unknown): value is TunnelSketch {
  return record(value) && (value.method==='draw' || value.method==='auto') && Array.isArray(value.path) &&
    value.path.length <= 24000 && value.path.every(isTunnelPoint) && isTunnelSettings(value.settings);
}
