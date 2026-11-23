import { createMapFromTemplate, makeQuadPolys } from './editorTemplates';
import { verifyClimbRoute } from './climbPhysics';
import { buildTeamCourse } from './teamCourseTerrain';
import type { ClimbGeometryProfile, JumpSample } from './climbSamples';
import { prepareMapForSave, createPolygonFromPoints, rebuildPolygonGeometry } from './pmsCompiler';
import { PmsPolygon, serializePms, soldatCrc32, SOLDAT_MAP_LIMITS } from './pmsParser';

export const COURSE_MODES = ['climb', 'ctf', 'trenchwars', 'symmetric'] as const;
export type CourseMode = typeof COURSE_MODES[number];
export type ClimbDifficulty = 'relaxed' | 'race' | 'expert';
type Point = { x: number; y: number };

export interface CourseSettings {
  seed: number;
  difficulty?: ClimbDifficulty;
  profile?: ClimbGeometryProfile;
  spacing: number;
  deadly: number;
  hurt: number;
  bounce: number;
}
export const DEFAULT_COURSE: CourseSettings = { seed: 42, spacing: 96, deadly: 10, hurt: 8, bounce: 18 };

function randomStream(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function surfaceTile(x: number, y: number, width: number, depth: number, type = 0, rebound = 1.45) {
  const colors: Record<number, [number, number, number]> = {
    0: [155, 170, 165], 5: [206, 72, 65], 7: [217, 154, 83], 18: [128, 174, 214],
  };
  const [r, g, b] = colors[type];
  return makeQuadPolys(x - width / 2, y, x + width / 2, y + depth, {
    polyType: type, bounciness: type === 18 ? rebound : 1,
    topColor: { r, g, b, a: 255 },
    bottomColor: { r: Math.round(r * 0.55), g: Math.round(g * 0.55), b: Math.round(b * 0.55), a: 255 },
  });
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

/** Sample by travelled world distance, independent of pointer-event rate. */
export function sampleCoursePath(path: readonly Point[], spacing: number, nextSpacing?: () => number): Point[] {
  if (!path.length || path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  let step = clamp(nextSpacing?.() ?? spacing, 36, 180);
  const samples = [path[0]];
  let untilNext = step;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    for (; untilNext <= length; untilNext += step) {
      const t = untilNext / length;
      // PMS stores single-precision coordinates, including when mouse sampling splits a straight segment.
      samples.push({ x: Math.fround(a.x + (b.x - a.x) * t), y: Math.fround(a.y + (b.y - a.y) * t) });
      if (samples.length * 2 > SOLDAT_MAP_LIMITS.maxPolys) return [];
      if (nextSpacing) step = clamp(nextSpacing(), 36, 180);
    }
    untilNext -= length;
  }
  const end = path[path.length - 1], last = samples[samples.length - 1];
  if (Math.hypot(end.x - last.x, end.y - last.y) > step * 0.48) samples.push(end);
  return samples.length * 2 <= SOLDAT_MAP_LIMITS.maxPolys ? samples : [];
}

function buildPlatforms(samples: Point[], settings: CourseSettings): PmsPolygon[] {
  const rand = randomStream(settings.seed);
  const weights = [settings.deadly, settings.hurt, settings.bounce].map(n => clamp(n, 0, 100));
  const total = Math.max(100, weights.reduce((a, b) => a + b, 0));
  return samples.flatMap((p, i) => {
    const roll = rand() * total;
    const end = i === 0 || i === samples.length - 1;
    let type = 0;
    if (!end) {
      if (roll < weights[0]) type = 5;
      else if (roll < weights[0] + weights[1]) type = 7;
      else if (roll < weights[0] + weights[1] + weights[2]) type = 18;
    }
    const width = clamp(settings.spacing, 36, 180) * (end ? 0.78 : 0.24 + rand() * 0.38);
    // A deadly tile belongs beneath the jump. Preserve a safe foothold on the course.
    if (type === 5) return [...surfaceTile(p.x, p.y, width, 12), ...surfaceTile(p.x, p.y + 50, width * 1.3, 16, 5)];
    return surfaceTile(p.x, p.y, width, type === 18 ? Math.min(20, width) : 14, type,
      type === 18 && settings.profile?.rebounds.length ? sampleRebound(settings, rand) : 1.45);
  });
}

export function drawCourse(path: readonly Point[], settings: CourseSettings) {
  const jumps = settings.profile?.jumps;
  const rand = randomStream(settings.seed);
  // Measured gaps are edge-to-edge. Add a typical tile width to place centres along the stroke.
  const stride = jumps?.length ? () => {
    const sample = jumps[Math.floor(rand() * jumps.length)];
    return settings.spacing * (0.43 + sample.gap / 96);
  } : undefined;
  const samples = sampleCoursePath(path, settings.spacing, stride);
  return samples.length < 2 ? [] : buildPlatforms(samples, settings);
}

const CLIMB_LEVELS = {
  relaxed: { count: 12, width: 48, gapMin: 8, gapMax: 32, riseMax: 16, quantile: 0 },
  race: { count: 18, width: 35, gapMin: 12, gapMax: 48, riseMax: 25, quantile: 0.22 },
  expert: { count: 23, width: 23, gapMin: 16, gapMax: 65, riseMax: 33, quantile: 0.45 },
} as const;

function sampleRebound(settings: CourseSettings, rand: () => number) {
  const forces = settings.profile?.rebounds;
  return forces?.length ? forces[Math.floor(rand() * forces.length)] : 1.7 + rand() * 0.75;
}

function climbLayout(settings: CourseSettings, rand: () => number) {
  const level = CLIMB_LEVELS[settings.difficulty ?? 'race'];
  const jumps = settings.profile?.jumps;
  const ledges = [{ x: 0, y: 0, width: 60, type: 0, rebound: 1, under: 0 }];
  const weights = [settings.deadly, settings.hurt, settings.bounce].map(n => clamp(n, 0, 100));
  const total = Math.max(100, weights.reduce((a, b) => a + b, 0));
  for (let i = 1; i < level.count; i++) {
    const prev = ledges[i - 1], end = i === level.count - 1;
    const q = level.quantile + rand() * 0.55;
    const bouncyPairs = settings.profile?.bounceJumps;
    const pool = prev.type === 18 && bouncyPairs?.length ? bouncyPairs : jumps;
    const sample: JumpSample = pool?.length ? pool[Math.floor(q * pool.length)] :
      { gap: 12 + q * 54 + rand() * 6, rise: Math.round((rand() - 0.28) * level.riseMax) };
    if (prev.type === 18 && sample.rebound !== undefined) prev.rebound = sample.rebound;
    const gap = Math.round(clamp(sample.gap * clamp(settings.spacing, 36, 180) / 96, level.gapMin, level.gapMax));
    const rise = Math.round(clamp(sample.rise, -level.riseMax, level.riseMax));
    const width = end ? 60 : level.width + Math.round(rand() * 14);
    const x = prev.x + (prev.width + width) / 2 + gap;
    const roll = rand() * total;
    const under = end ? 0 : roll < weights[0] ? 5 : roll < weights[0] + weights[1] ? 7 : 0;
    const bounce = !end && !under && roll < weights[0] + weights[1] + weights[2] && prev.type !== 18;
    ledges.push({ x, y: prev.y - rise, width, type: bounce ? 18 : 0, rebound: bounce ? sampleRebound(settings, rand) : 1, under });
  }
  return ledges;
}

export function generateCourseMap(mode: CourseMode, settings: CourseSettings, header: { title: string; texture: string }) {
  const base = createMapFromTemplate('empty', header);
  // The sector cache retains the template's original polygon array by identity.
  const map = { ...base, polygons: [] as PmsPolygon[] };
  const rand = randomStream(settings.seed);
  map.randomId = settings.seed >>> 0 & 0x7fffffff;
  const spawn = (x: number, y: number, team: number) => map.spawnpoints.push({
    x: Math.round(x), y: Math.round(y), team, index: map.spawnpoints.length, active: true,
  });
  const spacing = clamp(settings.spacing, 36, 180);
  if (mode === 'climb') {
    const ledges = climbLayout(settings, rand), first = ledges[0], last = ledges[ledges.length - 1];
    const origin = Math.round(last.x / 2);
    for (const p of ledges) p.x -= origin;
    spawn(first.x, first.y - 26, 1);
    spawn(first.x, first.y - 12, 5);
    spawn(last.x, last.y - 16, 6);
    map.startJet = 0;
    // Repair the first failed transition, then replay from the actual spawn with the updated geometry.
    for (let attempt = 0; attempt <= ledges.length * 3; attempt++) {
      map.polygons = ledges.flatMap((p, i) => {
        const floor = surfaceTile(p.x, p.y, p.width, 14, p.type, p.rebound);
        if (!p.under || !i) return floor;
        const prev = ledges[i - 1], a = prev.x + prev.width / 2, b = p.x - p.width / 2;
        return floor.concat(surfaceTile((a + b) / 2, Math.max(prev.y, p.y) + 44, b - a, 12, p.under));
      });
      map.spawnpoints[2].x = Math.round(last.x);
      map.spawnpoints[2].y = last.y - 16;
      const run = verifyClimbRoute(map);
      if (run.reached) break;
      const i = run.failedLeg!;
      if (i >= ledges.length) break;
      const prev = ledges[i - 1], next = ledges[i];
      const bouncePad = prev.type === 18 ? prev : next.type === 18 ? next : undefined;
      if (bouncePad) {
        bouncePad.type = 0;
        continue;
      }
      const dx = prev.x + (prev.width + next.width) / 2 + 12 - next.x, dy = prev.y - next.y;
      for (const pad of ledges.slice(i)) {
        pad.x += dx;
        pad.y += dy;
      }
    }
  } else if (mode==='ctf' || mode==='trenchwars') {
    const arena=buildTeamCourse(mode,spacing,rand);
    map.polygons=arena.polygons;
    for (const side of [-1,1]) {
      spawn(side*arena.spawnX,-24,side<0?1:2);
      spawn(side*arena.flagX,-15,side<0?5:6);
    }
    map.startJet=mode==='ctf'?110:15;
  } else {
    const count = 8;
    const step = Math.round(spacing * 1.35);
    const heights = Array.from({ length: count + 1 }, (_, i) => i >= count - 1 ? 0 :
      Math.round(rand() * 46));
    const height = (i: number) => heights[Math.abs(i)];
    for (let i = -count; i < count; i++) {
      const a = { x: i * step, y: height(i) }, b = { x: (i + 1) * step, y: height(i + 1) };
      const c = { x: b.x, y: 144 }, d = { x: a.x, y: 144 };
      // Mirror the diagonal as well as the outside silhouette.
      const triangles: [Point, Point, Point][] = i < 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const tri of triangles) map.polygons.push(createPolygonFromPoints(tri, { color: { r: 132, g: 145, b: 132, a: 255 } }));
    }
    for (let i = 1; i < count - 1; i += 2) {
      const y = -50 - Math.round(rand() * 35);
      const width = step * 0.72;
      const platform = surfaceTile(i * step, y, width, 14);
      map.polygons.push(...platform);
      for (const poly of platform) {
        const mirrored = poly.vertices.map(v => ({ ...v, x: -v.x, u: -v.u })) as typeof poly.vertices;
        map.polygons.push(rebuildPolygonGeometry({ ...poly, vertices: mirrored }));
      }
    }
    for (const side of [-1, 1]) {
      const x = side * (count - 0.5) * step;
      spawn(x, -24, 0);
    }
    map.startJet = 110;
  }
  const prepared = prepareMapForSave(map, { geometryDirty: true });
  prepared.crc32 = soldatCrc32(serializePms(prepared));
  return prepared;
}
