import fs from 'fs';
import path from 'path';
import { PmsMapData, PmsProp, serializePms } from '../src/shared/pmsParser';

/**
 * Soldat install configured for the app (data/config.json), used by tests that read real maps.
 * Returns null when it is not available so those tests are skipped instead of failing.
 */
export function findSoldatRoot(): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve('data', 'config.json'), 'utf-8'));
    const root = typeof cfg.soldatPath === 'string' ? cfg.soldatPath : '';
    if (root && fs.existsSync(path.join(root, 'maps'))) return root;
  } catch {
    // Not configured
  }
  return null;
}

export function findSoldatMapsDir(): string | null {
  const root = findSoldatRoot();
  return root ? path.join(root, 'maps') : null;
}

/**
 * Builds a small but complete PMS v11 file in memory.
 */
export function buildSyntheticPms(opts: {
  props?: number;
  scenery?: string[];
  colliders?: number;
  spawns?: number;
  invalidLevelOnProp?: number;
  title?: string;
  propPositions?: Array<{ x: number; y: number }>;
  propSizes?: Array<{ width: number; height: number }>;
}): Uint8Array {
  const scenery = (opts.scenery ?? ['a.png']).map((filename, i) => ({
    index: i + 1,
    filename,
    date: 123456 + i,
    usedCount: 0,
  }));
  const color = { r: 200, g: 100, b: 50, a: 255 };
  const vertex = (x: number, y: number) => ({ x, y, z: 1, rhw: 1, color, u: 0, v: 0 });
  const props: PmsProp[] = [];
  for (let i = 0; i < (opts.props ?? 0); i++) {
    props.push({
      index: i,
      active: true,
      style: (i % Math.max(1, scenery.length)) + 1,
      width: opts.propSizes?.[i]?.width ?? 32,
      height: opts.propSizes?.[i]?.height ?? 16,
      x: opts.propPositions?.[i]?.x ?? i * 40,
      y: opts.propPositions?.[i]?.y ?? -20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 255,
      color: { r: 255, g: 255, b: 255, a: 255 },
      level: opts.invalidLevelOnProp === i ? 7 : i % 3,
    });
  }
  const sectorsNum = 1;
  const map: PmsMapData = {
    version: 11,
    mapName: opts.title ?? 'Synthetic test map',
    texture: 'default.bmp',
    bgColorTop: { r: 10, g: 20, b: 30, a: 255 },
    bgColorBtm: { r: 40, g: 50, b: 60, a: 255 },
    startJet: 100,
    startJetGame: 119,
    grenadePacks: 1,
    medikits: 1,
    weather: 0,
    steps: 0,
    randomId: 42,
    sectorsDivision: 128,
    sectorsNum,
    sectorsPolys: Array.from({ length: (2 * sectorsNum + 1) ** 2 }, () => new Uint16Array(0)),
    polygons: [
      {
        vertices: [vertex(0, 0), vertex(100, 0), vertex(0, 100)],
        normals: [
          { x: 0, y: 1, z: 1 },
          { x: 0, y: 1, z: 1 },
          { x: 0, y: 1, z: 1 },
        ],
        polyType: 0,
        bounciness: 0,
      },
    ],
    props,
    scenery,
    colliders: Array.from({ length: opts.colliders ?? 0 }, (_, i) => ({
      index: i,
      active: true,
      x: i * 10,
      y: 5,
      radius: 20,
    })),
    spawnpoints: Array.from({ length: opts.spawns ?? 0 }, (_, i) => ({
      index: i,
      active: true,
      x: i * 10,
      y: -5,
      team: i % 3,
    })),
    waypoints: [],
    polyBounds: { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 },
    fullBounds: { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 },
    crc32: 0,
    parseWarnings: [],
  };
  return serializePms(map);
}
