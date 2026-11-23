import type { ClimbDifficulty } from './courseGenerator';
import type { ClimbGeometryProfile } from './climbSamples';
import type { PaceProfile } from './tunnelPace';
import { chamberRadius, chamberWeight, planTunnelChambers, type TunnelChamber } from './tunnelChambers';
import { createMapFromTemplate } from './editorTemplates';
import { simplifyPolylineRdp } from './imageTracer';
import { createPolygonFromPoints, prepareMapForSave } from './pmsCompiler';
import { pointInTriInclusive, polygonSignedArea2, segmentsIntersect } from './polygonGeometry';
import { serializePms, soldatCrc32, SOLDAT_MAP_LIMITS, type PmsPolygon, type PmsSpawnpoint } from './pmsParser';
import type { RgbaColor } from './soldatConstants';

export interface TunnelPoint { x: number; y: number }
export type TunnelDirection = 'winding' | 'up' | 'down' | 'across';
type Point = TunnelPoint;
const rgb = (r: number, g: number, b: number): RgbaColor => ({ r, g, b, a: 255 });

export const TUNNEL_PALETTES = {
  slate: { label: 'Slate', rock: rgb(65, 87, 106), rim: rgb(174, 194, 190), crystal: rgb(225, 172, 94), skyTop: rgb(16, 34, 53), skyBottom: rgb(79, 107, 126) },
  ember: { label: 'Ember', rock: rgb(102, 52, 61), rim: rgb(208, 137, 108), crystal: rgb(250, 183, 94), skyTop: rgb(38, 20, 34), skyBottom: rgb(119, 68, 65) },
  glacier: { label: 'Glacier', rock: rgb(50, 92, 129), rim: rgb(171, 226, 229), crystal: rgb(114, 237, 242), skyTop: rgb(17, 40, 70), skyBottom: rgb(65, 118, 146) },
  moss: { label: 'Moss', rock: rgb(72, 82, 63), rim: rgb(179, 191, 123), crystal: rgb(221, 191, 115), skyTop: rgb(21, 39, 40), skyBottom: rgb(85, 111, 96) },
  amethyst: { label: 'Amethyst', rock: rgb(83, 62, 111), rim: rgb(201, 165, 211), crystal: rgb(239, 157, 207), skyTop: rgb(35, 26, 56), skyBottom: rgb(101, 80, 118) },
} as const;

export interface TunnelSettings {
  seed: number;
  length: 'short' | 'medium' | 'long';
  /** Requested length in world units when a timed automatic course was fitted. */
  automaticLength?: number;
  terrainProgression?: PaceProfile;
  difficulty: ClimbDifficulty;
  direction: TunnelDirection;
  palette: keyof typeof TUNNEL_PALETTES;
  chamberLayout?: 'classic' | 'varied';
  /** Maximum number of additional non-colliding markings. Stone and landings take priority. */
  decorationBudget?: number;
  clearance: number;
  roughness: number;
  deadlyWalls: boolean;
  spikes: boolean;
  lowCeilings: boolean;
  drops: boolean;
  ice: boolean;
  ramps: boolean;
  floatingHazards: boolean;
  deadly: number;
  hurt: number;
  bounce: number;
  profile?: ClimbGeometryProfile;
  profileSource?: 'library' | 'builtin';
}

export const DEFAULT_TUNNEL: TunnelSettings = {
  seed: 123, length: 'medium', difficulty: 'race', direction: 'winding', palette: 'slate',
  clearance: 132, roughness: 52, deadlyWalls: false, spikes: true, lowCeilings: true,
  drops: true, ice: true, ramps: true, floatingHazards: false, deadly: 12, hurt: 7, bounce: 14,
};
export const MAX_TUNNEL_DECORATIONS = 160;
export const NEW_TUNNEL_SETTINGS: TunnelSettings = {
  ...DEFAULT_TUNNEL, chamberLayout: 'varied', decorationBudget: 64,
};

export interface TunnelStation { center: Point; left: Point; right: Point }
type Failure = 'short' | 'crossing' | 'tight' | 'limit';
export interface TunnelResult {
  centerline: Point[];
  stations: TunnelStation[];
  footholds: Point[];
  polygons: PmsPolygon[];
  chamberReport?: { rooms: TunnelChamber[]; decorations: number };
  /** Actual upper shell and shelf faces, used when editing an individual landing. */
  floorFaces: { polygon: number; station: TunnelPoint }[];
  spawnpoints: PmsSpawnpoint[];
  validation: { ok: boolean; reason?: Failure; minClearance: number };
  background: { top: RgbaColor; bottom: RgbaColor };
}

const STEP = 29;
const MAX_SEGMENTS = Math.floor((SOLDAT_MAP_LIMITS.maxPolys - 100) / 14);
export const MAX_TUNNEL_ROUTE_LENGTH = (MAX_SEGMENTS - 4) * STEP * 2;
const MIN_RADIUS = 10;
const clamp = (n: number, lo: number, hi: number) => Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
const shift = (p: Point, dir: Point, n: number): Point => ({ x: p.x + n * dir.x, y: p.y + n * dir.y });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function unit(a: Point, b: Point): Point {
  const d = distance(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
function colorMix(a: RgbaColor, b: RgbaColor, t: number) {
  return rgb(Math.round(mix(a.r, b.r, t)), Math.round(mix(a.g, b.g, t)), Math.round(mix(a.b, b.b, t)));
}
function shade(c: RgbaColor, gain: number) {
  return rgb(Math.round(clamp(c.r * gain, 0, 255)), Math.round(clamp(c.g * gain, 0, 255)), Math.round(clamp(c.b * gain, 0, 255)));
}

// Index random choices by position. Toggling an obstacle leaves the route and other formations in place.
function hash(seed: number, index: number, channel: number) {
  let x = (seed | 0) ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}
function noise(seed: number, x: number, channel: number) {
  const n = Math.floor(x), frac = x - n;
  return mix(hash(seed, n, channel), hash(seed, n + 1, channel), frac * frac * (3 - 2 * frac));
}

function automaticSpine(s: TunnelSettings): Point[] {
  const stage = { short: 0, medium: 1, long: 2 }[s.length];
  const amplitude = 19 + s.roughness * 0.40;
  const phase = hash(s.seed, 0, 1) * Math.PI * 2;
  const points: Point[] = [];
  if (s.direction === 'across') {
    const extent = s.automaticLength ?? [990, 1730, 2690][stage];
    for (let i = 0, count = Math.ceil(extent / 40); i <= count; i++) {
      const x = extent * (i / count - 0.5);
      const wave = 0.6 * Math.sin(x / 170 + phase) + 0.4 * Math.sin(x / 73 - phase);
      points.push({ x, y: wave * amplitude * 1.5 });
    }
    return points;
  }
  const winding = s.direction === 'winding';
  // Enough stone between two lanes, without turning a change of direction into
  // a several-storey shaft. Larger widths still open the chamber proportionally.
  const turnRadius = Math.max(s.clearance * 0.67 + 5, 76);
  const nominalWidth = (winding ? 650 : 390) + 135 * stage + 130 * hash(s.seed, 1, 1);
  const lanes = s.automaticLength === undefined ? 2 + stage :
    Math.max(1, Math.min(7, Math.round((s.automaticLength + Math.PI * turnRadius) / (1400 + Math.PI * turnRadius))));
  const width = s.automaticLength === undefined ? nominalWidth :
    Math.max(150,(s.automaticLength - (lanes-1)*Math.PI*turnRadius) / lanes);
  const vertical = s.direction === 'up' ? -1 : s.direction === 'down' ? 1 : hash(s.seed, 1, 2) < 0.5 ? -1 : 1;
  const incline = winding ? 0 : vertical * 0.11;
  let y = 0;
  for (let lane = 0; lane < lanes; lane++) {
    const dir = lane % 2 === 0 ? 1 : -1;
    const startX = -dir * width / 2;
    const count = Math.ceil(width / 38);
    for (let i = lane ? 1 : 0; i <= count; i++) {
      const t = i / count;
      const wave = Math.sin(Math.PI * t) ** 2 * (Math.sin(2 * Math.PI * t + phase + lane) + 0.3 * Math.sin(5 * Math.PI * t + phase));
      points.push({ x: startX + dir * t * width, y: y + incline * width * t + amplitude * wave });
    }
    y += incline * width;
    if (lane + 1 === lanes) break;
    for (let i = 1; i <= 14; i++) {
      const theta = Math.PI * i / 14;
      points.push({ x: -startX + dir * turnRadius * Math.sin(theta), y: y + vertical * turnRadius * (1 - Math.cos(theta)) });
    }
    y += 2 * vertical * turnRadius;
  }
  const midY = points.at(-1)!.y / 2;
  return points.map(p => ({ x: p.x, y: p.y - midY }));
}

function arcLengths(path: readonly Point[]) {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + distance(path[i - 1], path[i]));
  return lengths;
}

function resample(path: readonly Point[], step: number): Point[] {
  const lengths = arcLengths(path), total = lengths.at(-1)!;
  if (!(total > 0)) return [];
  const count = Math.ceil(total / step), result: Point[] = [];
  let j = 1;
  for (let i = 0; i <= count; i++) {
    const d = total * i / count;
    while (j < path.length - 1 && lengths[j] < d) j++;
    result.push(lerp(path[j - 1], path[j], (d - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1)));
  }
  return result;
}

function roundCorners(path: Point[], width: number) {
  const result = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1], p = path[i], next = path[i + 1];
    const cut = Math.min(width * 0.65, distance(prev, p) * 0.38, distance(next, p) * 0.38);
    const a = shift(p, unit(p, prev), cut), b = shift(p, unit(p, next), cut);
    result.push(a);
    for (let j = 1; j <= 5; j++) {
      const t = j / 5;
      result.push(lerp(lerp(a, p, t), lerp(p, b, t), t));
    }
  }
  result.push(path.at(-1)!);
  return result;
}

function crossed(path: readonly Point[]) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    for (let j = i + 2; j < path.length; j++) {
      const c = path[j - 1], d = path[j];
      if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return true;
    }
  }
  return false;
}

interface Feature { at: number; width: number; type: number; rebound: number; index: number; rise: number }
function terrainChallenge(profile: PaceProfile | undefined, fraction: number): number {
  if (!profile || profile === 'steady') return 1;
  const progress = profile === 'progressive' ? fraction : 1 - fraction;
  return mix(0.68, 1.24, progress * progress * (3 - 2 * progress));
}

function features(s: TunnelSettings, total: number) {
  const result: Feature[] = [];
  const level = { relaxed: 0.7, race: 1, expert: 1.24 }[s.difficulty];
  const weights = [s.deadly, s.hurt, s.bounce].map(w => clamp(w, 0, 100));
  const norm = Math.max(100, weights[0] + weights[1] + weights[2]);
  for (let i = 0, at = 125; at < total - 110; i++) {
    const challenge = level * terrainChallenge(s.terrainProgression, at / total);
    const roll = hash(s.seed, i, 5) * norm;
    const type = roll < weights[0] ? 5 : roll < weights[0] + weights[1] ? 7 : roll < weights[0] + weights[1] + weights[2] ? 18 : s.ice && i % 4 === 1 ? 4 : 0;
    const profile = s.profile;
    const pool = type === 18 && profile?.bounceJumps?.length ? profile.bounceJumps : profile?.jumps;
    const q = hash(s.seed, i, 6);
    const sample = pool?.length ? pool[Math.floor(q * pool.length)] : undefined;
    const gap = clamp(sample?.gap ?? 22 + q * 43, 14, 76);
    const rebound = type === 18 ? sample?.rebound ?? profile?.rebounds[Math.floor(q * profile.rebounds.length)] ?? 2.1 : 1;
    result.push({
      at, width: clamp((gap * 0.63 + 17) * challenge, 22, 53), type, rebound, index: i,
      rise: clamp(Math.abs(sample?.rise ?? 12 + q * 18) * challenge, 8, 32)
    });
    at += (95 + gap + hash(s.seed, i, 7) * 42) / challenge;
  }
  return result;
}

function nearest(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// The perpendicular bisector bounds rock thickness between adjacent turns of a spiral.
// On a tight bend the corridor narrows first, while the shell keeps several units of solid rock.
function sideLimit(path: Point[], lengths: number[], i: number, direction: Point, initial: number) {
  const p = path[i];
  let limit = initial;
  for (let j = 1; j < path.length; j++) {
    if (lengths[j] >= lengths[i] - STEP * 2.5 && lengths[j - 1] <= lengths[i] + STEP * 2.5) continue;
    const q = nearest(p, path[j - 1], path[j]), dx = q.x - p.x, dy = q.y - p.y;
    const facing = dx * direction.x + dy * direction.y;
    if (facing > 0.01) limit = Math.min(limit, 0.98 * (dx * dx + dy * dy) / (2 * facing));
  }
  return limit;
}

type Strip = [Point, Point, Point, Point];
interface Section extends TunnelStation {
  direction: Point; bands: [Strip, Strip]; along: number; feature?: Feature; room?: TunnelChamber;
}
function sections(path: Point[], lengths: number[], rooms: TunnelChamber[], s: TunnelSettings): Section[] {
  const cuts = features(s, lengths.at(-1)!);
  const rough = s.roughness / 100, level = { relaxed: 1.10, race: 1, expert: 0.9 }[s.difficulty];
  return path.map((center, i) => {
    const along = lengths[i];
    const room = rooms.find(r => along >= r.start && along <= r.end);
    const weight = room ? chamberWeight(room, along) : 0;
    const widthFactor = 1 + 0.45 * (1 - terrainChallenge(s.terrainProgression, along / lengths.at(-1)!));
    const direction = unit(path[Math.max(i - 1, 0)], path[Math.min(i + 1, path.length - 1)]);
    const right = { x: -direction.y, y: direction.x };
    const feature = room?.kind === 'rest' && weight > 0 ? undefined :
      cuts.find(f => Math.abs(f.at - along) < f.width * 1.8);
    const bands = ([-1, 1] as const).map((side, sideIndex) => {
      const dir = { x: right.x * side, y: right.y * side }, floor = dir.y > 0.4;
      const grain = noise(s.seed, along / 83, 10 + sideIndex) - 0.5;
      const shoulder = noise(s.seed, along / 260, 13 + sideIndex) - 0.47;
      const max = sideLimit(path, lengths, i, dir, s.clearance * 1.8);
      const chamber = 0.24 * Math.exp(-Math.pow(Math.min(i, path.length - 1 - i) - 1, 2) / 13);
      let inner = s.clearance * 0.5 * level * widthFactor * (0.97 + rough * (grain * 0.49 + shoulder * 0.60) + chamber);
      if (feature) {
        const phase = (along - feature.at) / feature.width;
        if (floor && s.drops && feature.index % 3 === 0) inner += feature.rise * Math.max(0, 1 - Math.abs(phase));
        if (floor && s.ramps && feature.index % 3 === 1) inner -= feature.rise * 0.7 * Math.max(0, 1 - Math.abs(phase + 0.1));
        if (dir.y < -0.38 && s.lowCeilings && feature.index % 3 === 2) inner *= 1 - 0.36 * Math.max(0, 1 - Math.abs(phase * 0.7));
      }
      if (room) inner = chamberRadius(room, weight, inner, s.clearance, center, dir);
      inner = Math.min(Math.max(MIN_RADIUS + 9, inner), max * 0.78);
      const body = 32 + rough * 25 + 29 * noise(s.seed, along / 142, 17 + sideIndex);
      const thickness = Math.min(max - inner, body + 12 + rough * 24 * hash(s.seed, i, 20 + sideIndex));
      const rim = inner + Math.min(thickness * 0.19, 5 + 7 * noise(s.seed, along / 46, 23 + sideIndex));
      const seam = inner + thickness * (0.48 + 0.18 * hash(s.seed, i, 26 + sideIndex));
      return [shift(center, dir, inner), shift(center, dir, rim), shift(center, dir, seam), shift(center, dir, inner + thickness)] as Strip;
    }) as [Strip, Strip];
    return { center, direction, along, bands, left: bands[0][0], right: bands[1][0], feature, room };
  });
}

interface Bounds { left: number; right: number; top: number; bottom: number }
function bounds(points: readonly Point[]): Bounds {
  return {
    left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y))
  };
}
function overlaps(a: Bounds, b: Bounds) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function cutHalfPlane(poly: Point[], a: Point, b: Point, sign: number) {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const u = sign * polygonSignedArea2(a, b, p), v = sign * polygonSignedArea2(a, b, q);
    if (u >= 0) out.push(p);
    if ((u > 0 && v < 0) || (u < 0 && v > 0)) out.push(lerp(p, q, u / (u - v)));
  }
  return out;
}

// Subtract one convex corridor cell from a convex rock face. Pieces stay convex,
// so a small fan can fill each piece without introducing an artificial solid over the air.
function subtract(poly: Point[], cut: Point[]): Point[][] {
  const sign = Math.sign(polygonSignedArea2(cut[0], cut[1], cut[2]));
  if (!sign) return [poly];
  let inner = poly;
  const outside: Point[][] = [];
  for (let i = 0; i < cut.length; i++) {
    const a = cut[i], b = cut[(i + 1) % cut.length];
    const behind = cutHalfPlane(inner, a, b, -sign);
    inner = cutHalfPlane(inner, a, b, sign);
    if (inner.length < 3) return [poly];
    if (behind.length >= 3) outside.push(behind);
  }
  return outside;
}

/**
 * Deep rock joins the neighbouring passages of a switchback into one massif.
 * Carve its faces with the actual sweep (plus a margin behind the visible edge),
 * including on hairpins. A pencil brush fills only ground alongside its stroke.
 */
function bedrock(stations: Section[], s: TunnelSettings, palette: Palette, drawn: boolean, budget: number) {
  const rock: PmsPolygon[] = [];
  if (budget < 90) return rock;
  const collar = (st: Section, side: 0 | 1) => lerp(st.bands[side][1], st.bands[side][2], 0.52);
  const air = stations.map(st => [collar(st, 0), collar(st, 1)] as [Point, Point]);
  for (const [i, dir] of [[0, -1], [stations.length - 1, 1]]) {
    air[i] = air[i].map(p => shift(p, stations[i].direction, dir * 8)) as [Point, Point];
  }
  const cuts: { vertices: Point[]; bounds: Bounds }[] = [];
  for (let i = 1; i < air.length; i++) {
    const [a, b] = air[i - 1], [d, c] = air[i];
    // Convex on both ordinary sections and the rounded bends of the sampled spine.
    const quad = [a, b, c, d];
    const turns = quad.map((p, k) => polygonSignedArea2(p, quad[(k + 1) % 4], quad[(k + 2) % 4]));
    const parts = turns.every(v => v > 0) || turns.every(v => v < 0) ? [quad] : [[a, b, d], [b, c, d]];
    for (const vertices of parts) cuts.push({ vertices, bounds: bounds(vertices) });
  }
  const exterior = stations.flatMap(st => [st.bands[0][3], st.bands[1][3]]);
  const box = bounds(exterior);
  const startX = box.left - 22, extent = box.right - box.left + 44;
  const cols = Math.max(3, Math.ceil(extent / 110)), rows = Math.max(2, Math.ceil((box.bottom - box.top) / 115));
  if (cols * rows > budget) return rock;
  const lattice = Array.from({ length: cols + 1 }, (_, i) => {
    const x = startX + i * extent / cols;
    const near = exterior.filter(p => Math.abs(p.x - x) <= extent / cols * 0.9 + 21);
    const local = near.length ? bounds(near) : box;
    const edge = i === 0 || i === cols;
    const top = local.top - 11 - (edge ? 0 : 29 * hash(s.seed, i, 53));
    const bottom = local.bottom + 13 + (edge ? 0 : 24 * hash(s.seed, i, 54));
    return Array.from({ length: rows + 1 }, (_, j) => ({ x, y: mix(top, bottom, j / rows) }));
  });
  const nearStroke = (p: Point) => stations.some(st => distance(st.center, p) < s.clearance * 0.85 + 86);
  for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) {
    const a = lattice[col][row], b = lattice[col + 1][row], c = lattice[col + 1][row + 1], d = lattice[col][row + 1];
    for (const tile of [[a, b, c], [a, c, d]]) {
      if (drawn && !tile.every(nearStroke)) continue;
      const tileBox = bounds(tile);
      let pieces = [tile];
      for (const cut of cuts) {
        if (!overlaps(tileBox, cut.bounds)) continue;
        pieces = pieces.flatMap(p => overlaps(bounds(p), cut.bounds) ? subtract(p, cut.vertices) : [p]);
        if (!pieces.length) break;
      }
      const tint = shade(palette.rock, 0.37 + 0.075 * noise(s.seed, col * 0.74 + row * 0.85, 56));
      for (const p of pieces) for (let j = 1; j < p.length - 1; j++) {
        const tri: [Point, Point, Point] = [p[0], p[j], p[j + 1]];
        if (Math.abs(polygonSignedArea2(...tri)) < 0.45) continue;
        rock.push(createPolygonFromPoints(tri, { color: tint, texWidth: 190, texHeight: 190 }));
        if (rock.length > budget) return [];
      }
    }
  }
  return rock;
}

type Palette = typeof TUNNEL_PALETTES[keyof typeof TUNNEL_PALETTES];
type Triangle = [Point, Point, Point];
type Colors = [RgbaColor, RgbaColor, RgbaColor];
const MATERIALS: Record<number, RgbaColor> = {
  4: rgb(160, 223, 245), 5: rgb(202, 77, 79), 7: rgb(221, 144, 72), 18: rgb(103, 204, 205),
};

function pointSegmentSquared(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

/** Exact segment/triangle distance for the swept route. The grid only eliminates distant candidates. */
class Corridor {
  private cells = new Map<string, number[]>();
  private limits: Bounds;
  constructor(private path: Point[]) {
    const box = bounds(path);
    this.limits = {left: Math.floor(box.left / 96), right: Math.floor(box.right / 96),
      top: Math.floor(box.top / 96), bottom: Math.floor(box.bottom / 96)};
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      for (let x = Math.floor(Math.min(a.x, b.x) / 96); x <= Math.floor(Math.max(a.x, b.x) / 96); x++) {
        for (let y = Math.floor(Math.min(a.y, b.y) / 96); y <= Math.floor(Math.max(a.y, b.y) / 96); y++) {
          const key = x + ',' + y;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key)!.push(i);
        }
      }
    }
  }
  distance(tri: Triangle, bound: number) {
    const minX = Math.min(tri[0].x, tri[1].x, tri[2].x), maxX = Math.max(tri[0].x, tri[1].x, tri[2].x);
    const minY = Math.min(tri[0].y, tri[1].y, tri[2].y), maxY = Math.max(tri[0].y, tri[1].y, tri[2].y);
    let closest = bound * bound;
    const seen = new Set<number>();
    const left = Math.max(this.limits.left, Math.floor((minX - bound) / 96));
    const right = Math.min(this.limits.right, Math.floor((maxX + bound) / 96));
    const top = Math.max(this.limits.top, Math.floor((minY - bound) / 96));
    const bottom = Math.min(this.limits.bottom, Math.floor((maxY + bound) / 96));
    for (let x = left; x <= right; x++) {
      for (let y = top; y <= bottom; y++) {
        const cell = this.cells.get(x + ',' + y);
        if (!cell) continue;
        for (const i of cell) {
          if (seen.has(i)) continue;
          seen.add(i);
          const a = this.path[i - 1], b = this.path[i];
          if (Math.max(a.x, b.x) < minX - bound || Math.min(a.x, b.x) > maxX + bound ||
            Math.max(a.y, b.y) < minY - bound || Math.min(a.y, b.y) > maxY + bound) continue;
          if (pointInTriInclusive(a.x, a.y, ...tri) || pointInTriInclusive(b.x, b.y, ...tri)) return 0;
          for (let j = 0; j < 3; j++) {
            const p = tri[j], q = tri[(j + 1) % 3];
            if (segmentsIntersect(a.x, a.y, b.x, b.y, p.x, p.y, q.x, q.y)) return 0;
            closest = Math.min(closest, pointSegmentSquared(p, a, b), pointSegmentSquared(a, p, q), pointSegmentSquared(b, p, q));
          }
        }
      }
    }
    return Math.sqrt(closest);
  }
}

/** Measure a continuous player-width tube using the same segment/triangle test as generation. */
export function hasTunnelClearance(path: TunnelPoint[], polygons: readonly PmsPolygon[], radius: number): boolean {
  const corridor = new Corridor(path);
  return polygons.every(poly => corridor.distance(poly.vertices, radius) >= radius);
}

class CaveMesh {
  readonly polygons: PmsPolygon[] = [];
  readonly floorFaces: TunnelResult['floorFaces'] = [];
  readonly footholds: { along: number; point: Point }[] = [];
  private readonly markings: { tri: Triangle; color: RgbaColor; priority: number }[] = [];
  shellFaces = 0;
  minRadius: number;
  constructor(private corridor: Corridor, private s: TunnelSettings, private palette: Palette) {
    this.minRadius = s.clearance;
  }
  private face(tri: Triangle, colors: Colors, type: number, rebound = 1) {
    const area = polygonSignedArea2(...tri);
    if (Math.abs(area) < 0.05) return;
    if (area < 0) {
      [tri[1], tri[2]] = [tri[2], tri[1]];
      [colors[1], colors[2]] = [colors[2], colors[1]];
    }
    const poly = createPolygonFromPoints(tri, { color: colors[0], polyType: type, bounciness: rebound, texWidth: 138, texHeight: 138 });
    poly.vertices.forEach((v, i) => { v.color = colors[i]; });
    this.polygons.push(poly);
    this.minRadius = this.corridor.distance(tri, this.minRadius);
  }
  private quad(a: Point, b: Point, c: Point, d: Point, outer: RgbaColor, inner: RgbaColor, type = 0, rebound = 1, flip = false) {
    if (flip) {
      this.face([a, b, d], [inner, inner, outer], type, rebound);
      this.face([b, c, d], [inner, outer, outer], type, rebound);
    } else {
      this.face([a, b, c], [inner, inner, outer], type, rebound);
      this.face([a, c, d], [inner, outer, outer], type, rebound);
    }
  }
  private markSurface(pa: Strip, pb: Strip, type: number, room: TunnelChamber | undefined, i: number, floor: boolean) {
    if (!this.s.decorationBudget) return;
    const danger = type === 5 || type === 7;
    const special = type === 4 || type === 18;
    if (!danger && !special && !(floor && room?.kind === 'rest') && !(room && i % 4 === 0 && !floor)) return;
    const color = danger || special ? MATERIALS[type] : floor ? rgb(151, 224, 177) : this.palette.crystal;
    const point = (along: number, depth: number) => lerp(lerp(pa[0], pb[0], along), lerp(pa[2], pb[2], along), depth);
    // Keep the marks *inside* the stone. Ground contacts remain on the exposed coloured rim.
    const tri: Triangle = danger ? [point(0.23, 0.6), point(0.56, 0.16), point(0.77, 0.61)] :
      [point(0.18, 0.43), point(0.82, 0.18), point(0.63, 0.46)];
    if (Math.abs(polygonSignedArea2(...tri)) > 1)
      this.markings.push({ tri, color, priority: danger ? 0 : special || floor ? 1 : 2 });
  }
  decorations(available: number) {
    let remaining = Math.max(0, Math.min(available, MAX_TUNNEL_DECORATIONS, Math.floor(this.s.decorationBudget ?? 0)));
    const polygons: PmsPolygon[] = [];
    for (const priority of [0, 1, 2]) {
      const marks = this.markings.filter(m => m.priority === priority);
      const count = Math.min(remaining, marks.length);
      // Spread a small budget over the whole route, including its last hazards.
      for (let i = 0; i < count; i++) {
        const mark = marks[Math.floor((i + 0.5) * marks.length / count)];
        polygons.push(createPolygonFromPoints(mark.tri, { color: mark.color, polyType: 3, texWidth: 138, texHeight: 138 }));
      }
      remaining -= count;
      if (!remaining) break;
    }
    return polygons;
  }
  wall(a: Section, b: Section, i: number, side: 0 | 1, safe: boolean) {
    const pa = a.bands[side], pb = b.bands[side];
    const floor = unit(a.center, pa[0]).y > 0.38;
    const f = a.feature;
    const onFeature = f && Math.abs((a.along + b.along) / 2 - f.at) < Math.max(17, f.width / 2);
    const mid = (a.along + b.along) / 2;
    const room = [a.room, b.room].find(r => r && mid >= r.start && mid <= r.end);
    const rest = room?.kind === 'rest';
    const type = safe || rest ? 0 : floor ? (room?.kind === 'ice' ? 4 : onFeature ? f.type : 0) : this.s.deadlyWalls ? 5 : 0;
    const rebound = type === 18 && f ? f.rebound : 1;
    const grain = 0.91 + 0.18 * hash(this.s.seed, i, 31 + side);
    const mineral = noise(this.s.seed, a.along / 230, 35 + side);
    const base = colorMix(this.palette.rock, this.palette.crystal, 0.14 * Math.max(0, (mineral - 0.5) * 2));
    const stone = shade(base, (floor ? 1.07 : 0.95) * grain);
    const exposed = colorMix(this.palette.rim, this.palette.crystal, clamp((mineral - 0.64) * 1.75, 0, 0.48));
    const rim = shade(type ? colorMix(this.palette.rim, MATERIALS[type], 0.78) : exposed, grain * (floor ? 1.02 : 0.9));
    const vein = colorMix(stone, rim, 0.25 + 0.18 * mineral);
    const outer = shade(base, 0.48 + 0.16 * mineral);
    const flip = (i + side) % 2 === 0;
    const rimStart = this.polygons.length;
    this.quad(pa[0], pb[0], pb[1], pa[1], vein, rim, type, rebound, flip);
    if (floor) {
      const station = lerp(a.center, b.center, 0.5);
      for (let j = rimStart; j < this.polygons.length; j++) this.floorFaces.push({polygon:j, station});
    }
    this.quad(pa[1], pb[1], pb[2], pa[2], stone, shade(vein, 0.88), 0, 1, !flip);
    this.quad(pa[2], pb[2], pb[3], pa[3], outer, shade(stone, 0.8), 0, 1, flip);
    this.markSurface(pa, pb, type, room, i, floor);
    if (floor && type !== 5 && type !== 7 && (onFeature || i % 3 === 0)) {
      this.footholds.push({ along: (a.along + b.along) / 2, point: lerp(pa[0], pb[0], 0.5) });
    }
  }
  cap(st: Section, sign: -1 | 1) {
    const edges = [...st.bands[0]].reverse().concat(st.bands[1]);
    const depth = Math.min(28, this.s.clearance * 0.18);
    for (let i = 1; i < edges.length; i++) {
      const a = edges[i - 1], b = edges[i];
      const c = shift(b, st.direction, depth * sign), d = shift(a, st.direction, depth * sign);
      this.quad(a, b, c, d, shade(this.palette.rock, 0.53), i === 4 ? this.palette.rim : this.palette.rock);
    }
  }
  // Append only whole optional formations. Never leave half a point or ledge after a clearance rejection.
  private canFit(tris: Triangle[]) {
    return tris.every(t => this.corridor.distance(t, MIN_RADIUS + 1) >= MIN_RADIUS + 1);
  }
  obstacle(a: Section, b: Section, f: Feature) {
    const side = a.left.y > a.right.y ? 0 : 1;
    const floorA = a.bands[side][0], floorB = b.bands[side][0];
    const roof = side === 0 ? 1 : 0;
    // These controls choose the formation; density zero keeps its stone surface harmless.
    // Explicitly lethal walls have their own switch.
    const trap = this.s.deadly > 0 ? 5 : this.s.hurt > 0 ? 7 : 0;
    const trapColor = MATERIALS[trap] ?? this.palette.crystal;
    if (this.s.spikes && f.index % 3 === 0 && Math.abs(a.direction.x) > 0.6) {
      const bottom = lerp(floorA, floorB, 0.52);
      const tip = shift(bottom, unit(bottom, a.center), clamp(f.rise * 0.68, 9, 21));
      const tri: Triangle = [lerp(floorA, floorB, 0.20), lerp(floorA, floorB, 0.83), tip];
      if (this.canFit([tri])) this.face(tri, [shade(this.palette.rock, 0.88), trapColor, shade(trapColor, 1.20)], trap);
    }
    if (this.s.lowCeilings && f.index % 3 === 2 && Math.abs(a.direction.x) > 0.6) {
      const rimA = a.bands[roof][0], rimB = b.bands[roof][0], rim = lerp(rimA, rimB, 0.42);
      const inward = unit(rim, lerp(a.center, b.center, 0.42));
      const depth = clamp(distance(rim, lerp(a.center, b.center, 0.42)) - 24, 0, 11 + f.rise * 0.68);
      const tip = shift(rim, inward, depth), heel = shift(lerp(rimA, rimB, 0.76), inward, depth * 0.47);
      const tri: Triangle[] = [[rimA, rimB, heel], [rimA, heel, tip]];
      if (depth > 3 && this.canFit(tri)) {
        const type = this.s.deadlyWalls ? 5 : 0;
        const rock = type ? colorMix(this.palette.rock, MATERIALS[5], 0.56) : this.palette.rock;
        this.face(tri[0], [rock, rock, shade(rock, 1.15)], type);
        this.face(tri[1], [rock, shade(rock, 1.15), shade(this.palette.rim, 0.80)], type);
      }
    }
    if (this.s.floatingHazards && f.index % 3 === 1) {
      const roofPoint = lerp(a.bands[roof][0], b.bands[roof][0], 0.4);
      const dir = unit(roofPoint, lerp(a.center, b.center, 0.4));
      const p = shift(roofPoint, dir, 12), q = shift(p, dir, 12), tip = shift(q, dir, 10);
      const l = shift(q, a.direction, -5), r = shift(q, a.direction, 6);
      const tris: Triangle[] = [[l, p, r], [l, r, tip]];
      if (this.canFit(tris)) {
        this.face(tris[0], [trapColor, this.palette.crystal, trapColor], trap);
        this.face(tris[1], [shade(trapColor, 0.8), trapColor, this.palette.crystal], trap);
      }
    }
  }
  shelf(st: Section, side: 0 | 1, y: number) {
    const rim = st.bands[side][0], dir = Math.sign(rim.x - st.center.x);
    if (!dir) return;
    const surface = this.hit({ x: st.center.x, y }, 'x', dir, this.shellFaces);
    const lower = this.hit({ x: st.center.x, y: y + 17 }, 'x', dir, this.shellFaces);
    const span = Math.abs(surface - st.center.x);
    if (!Number.isFinite(span) || !Number.isFinite(lower) || span < 30 || span > this.s.clearance * 1.4) return;
    const x = st.center.x + dir * Math.min(span * 0.53, Math.max(13, Math.min(19, span * 0.26)));
    const a = { x, y }, b = { x: surface + dir * 5, y }, c = { x: lower + dir * 5, y: y + 17 }, d = { x: x + dir * 5, y: y + 6 };
    if (!this.canFit([[a, b, c], [a, c, d]])) return;
    const shelfStart = this.polygons.length;
    this.quad(a, b, c, d, this.palette.rock, this.palette.rim);
    for (let j = shelfStart; j < this.polygons.length; j++) this.floorFaces.push({polygon:j, station:st.center});
    const point = { x: x + dir * Math.min(9, (span - Math.abs(x - st.center.x)) * 0.25), y };
    this.footholds.push({ along: st.along, point });
    return point;
  }
  private hit(p: Point, axis: 'x' | 'y', direction: number, count: number) {
    const cross = axis === 'x' ? 'y' : 'x';
    let closest = Infinity;
    for (let i = 0; i < count; i++) {
      const poly = this.polygons[i];
      for (let j = 0; j < 3; j++) {
        const a = poly.vertices[j], b = poly.vertices[(j + 1) % 3];
        if (p[cross] < Math.min(a[cross], b[cross]) || p[cross] > Math.max(a[cross], b[cross]) || a[cross] === b[cross]) continue;
        const hit = mix(a[axis], b[axis], (p[cross] - a[cross]) / (b[cross] - a[cross]));
        const forward = (hit - p[axis]) * direction;
        if (forward > 0 && forward < closest) closest = forward;
      }
    }
    return p[axis] + direction * closest;
  }
  landing(st: Section): Point | undefined {
    if (Math.abs(st.direction.x) < 0.59) {
      const shelf = this.shelf(st, 0, st.center.y + 8) ?? this.shelf(st, 1, st.center.y + 8);
      if (shelf) return shelf;
    }
    for (const fraction of [0, 0.2, -0.2, 0.35, -0.35]) {
      const pt = { x: Math.round(st.center.x + fraction * this.s.clearance), y: st.center.y };
      const top = this.hit(pt, 'y', 1, this.polygons.length);
      if (!Number.isFinite(top) || top - pt.y > this.s.clearance * 1.6) continue;
      if (this.polygons.some(p => pointInTriInclusive(pt.x, top - 16, ...p.vertices))) continue;
      return { x: pt.x, y: top };
    }
  }
}

/** Carve a closed, editable rock tunnel around the supplied open stroke or a seeded automatic route. */
export function generateClimbTunnel(settings: TunnelSettings, path?: readonly Point[], availablePolygons: number = SOLDAT_MAP_LIMITS.maxPolys): TunnelResult {
  const s = { ...DEFAULT_TUNNEL, ...settings, clearance: clamp(settings.clearance, 80, 220), roughness: clamp(settings.roughness, 0, 100) };
  const palette = TUNNEL_PALETTES[s.palette];
  const background = { top: palette.skyTop, bottom: palette.skyBottom };
  const budget = Math.floor(clamp(availablePolygons, 0, SOLDAT_MAP_LIMITS.maxPolys));
  const fail = (reason: Failure): TunnelResult => ({
    polygons: [], floorFaces: [], spawnpoints: [], centerline: [], stations: [], footholds: [],
    validation: { ok: false, reason, minClearance: 0 }, background
  });
  if (!path && s.automaticLength !== undefined && (!Number.isFinite(s.automaticLength) ||
    s.automaticLength < 150 || s.automaticLength > MAX_TUNNEL_ROUTE_LENGTH)) return fail('limit');
  const raw = path ?? automaticSpine(s);
  if (raw.length < 2) return fail('short');
  if (raw.length > 24000 || raw.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6)) return fail('limit');
  const total = arcLengths(raw).at(-1)!;
  if (total < 72) return fail('short');
  if (total > MAX_TUNNEL_ROUTE_LENGTH) return fail('limit');
  // Uniform arc-length sampling keeps pencil event frequency out of the seed and bounds simplification cost.
  const controls = simplifyPolylineRdp(resample(raw, 8), 2.25);
  if (crossed(controls)) return fail('crossing');
  // For a long pencil stroke spend the PMS mesh budget across the entire line.
  const stationSpacing = Math.max(STEP, total / (MAX_SEGMENTS - 4));
  const centerline = resample(roundCorners(controls, s.clearance), stationSpacing);
  if (centerline.length < 3) return fail('short');
  const start = centerline[0], end = centerline.at(-1)!;
  const geometryPath = [shift(start, unit(centerline[1], start), 38), ...centerline,
  shift(end, unit(centerline.at(-2)!, end), 38)];
  const lengths = arcLengths(geometryPath);
  const rooms = s.chamberLayout === 'varied' ? planTunnelChambers(geometryPath, lengths, s.seed, s.clearance, s.ice) : [];
  const stations = sections(geometryPath, lengths, rooms, s);
  const mesh = new CaveMesh(new Corridor(centerline), s, palette);
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1], safe = i < 3 || i >= stations.length - 4;
    mesh.wall(a, b, i, 0, safe);
    mesh.wall(a, b, i, 1, safe);
  }
  mesh.cap(stations[0], -1);
  mesh.cap(stations.at(-1)!, 1);
  mesh.shellFaces = mesh.polygons.length;
  let lastShelf = -Infinity, shaftSide: 0 | 1 = 0;
  for (let i = 3; i < stations.length - 4; i++) {
    const a = stations[i], b = stations[i + 1], f = a.feature;
    if (f && a.along <= f.at && b.along > f.at && !rooms.some(r =>
      (r.kind === 'rest' || r.kind === 'ice') && a.along < r.end && b.along > r.start)) mesh.obstacle(a, b, f);
    const shelfPitch = a.direction.y < 0 ? 23 : 37;
    // Let the floor carry the player on traversable inclines; a shelf on a
    // shallow ramp can catch the head of a player jumping into the turn.
    if (Math.abs(a.direction.y) > 0.72 && a.along - lastShelf > shelfPitch) {
      if (mesh.shelf(a, shaftSide, a.center.y + 3)) {
        lastShelf = a.along;
        shaftSide = shaftSide === 0 ? 1 : 0;
      }
    }
  }
  if (mesh.minRadius < MIN_RADIUS) return fail('tight');
  const first = mesh.landing(stations[1]), last = mesh.landing(stations.at(-2)!);
  if (!first || !last) return fail('tight');
  if (mesh.polygons.length > budget) return fail('limit');
  const spawnpoints = [{ p: first, team: 1, h: 21 }, { p: first, team: 5, h: 12 }, { p: last, team: 6, h: 14 }]
    .map(({ p, team, h }, index) => ({ index, team, x: Math.round(p.x), y: Math.round(p.y - h), active: true }));
  if (spawnpoints.some(s => mesh.polygons.some(p => pointInTriInclusive(s.x, s.y, ...p.vertices)))) return fail('tight');
  const mass = bedrock(stations, s, palette, !!path, budget - mesh.polygons.length);
  // Near a sharp cusp the two directions at a station need not be parallel.
  // Keep the clearance witness valid for every returned triangle, including the deep rock.
  const corridor = new Corridor(centerline);
  const backing = mass.filter(p => {
    const r = corridor.distance(p.vertices, mesh.minRadius);
    if (r < MIN_RADIUS || spawnpoints.some(s => pointInTriInclusive(s.x, s.y, ...p.vertices))) return false;
    mesh.minRadius = Math.min(mesh.minRadius, r);
    return true;
  });
  const decorations = mesh.decorations(budget - mesh.polygons.length - backing.length);
  return {
    polygons: [...backing, ...mesh.polygons, ...decorations], floorFaces: mesh.floorFaces.map(f=>({polygon:f.polygon+backing.length, station:f.station})),
    ...(s.chamberLayout === 'varied' || s.decorationBudget ? {chamberReport: {
      rooms: rooms.map(r => ({...r, start: r.start - lengths[1], end: r.end - lengths[1]})),
      decorations: decorations.length,
    }} : {}),
    spawnpoints, centerline, background,
    stations: stations.map(({ center, left, right }) => ({ center, left, right })),
    footholds: [first, ...mesh.footholds.sort((a, b) => a.along - b.along).map(f => f.point), last],
    validation: { ok: true, minClearance: Math.floor(mesh.minRadius * 2) }
  };
}

export function createTunnelMap(result: TunnelResult, settings: TunnelSettings, header: { title: string; texture: string }) {
  if (!result.validation.ok) throw new Error('Invalid climb tunnel: ' + result.validation.reason);
  const base = createMapFromTemplate('empty', header);
  const map = prepareMapForSave({
    ...base, randomId: (settings.seed >>> 0) & 0x7fffffff, startJet: 0,
    bgColorTop: result.background.top, bgColorBtm: result.background.bottom,
    polygons: result.polygons, spawnpoints: result.spawnpoints
  }, { geometryDirty: true });
  map.crc32 = soldatCrc32(serializePms(map));
  return map;
}
