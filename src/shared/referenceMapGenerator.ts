import { createMapFromTemplate } from './editorTemplates';
import { polygonSignedArea2, prepareMapForSave, rebuildPolygonGeometry } from './pmsCompiler';
import { checkSoldatMapLimits, serializePms, soldatCrc32, type PmsMapData, type PmsPolygon, type PmsVertex } from './pmsParser';
import { across, boundaryDistance, clipStrip, measureStyleStrips, ownsPoint, registerBoundary, type Axis, type StyleStrip } from './styleSections';
import { collectSeam, joinStyleSeam, type SeamFace } from './styleSeams';
import { reshapeReferenceLayout } from './referenceLayout';
export const MAX_STYLE_REFERENCES = 8;
export interface ReferenceOptions {
  seed: number;
  variation: number;
  look: number;
  layout?: 'compose' | 'reshape';
}
export interface ReferenceReport {
  sections: number;
  fromSources: number[];
  recombined: number;
}
export interface ReferenceResult {
  map: PmsMapData;
  report: ReferenceReport;
  scenerySources: number[];
}
type Slot = {
  guide: StyleStrip;
  keep: boolean;
  extra?: boolean;
};
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
// Estimate a distinct colour centre for each PMS material. The source's local shading survives the transfer.
function materialPalette(map: PmsMapData) {
  const colors = new Map<number, {
    r: number;
    g: number;
    b: number;
    n: number;
  }>();
  for (const poly of map.polygons) {
    const sum = colors.get(poly.polyType) ?? { r: 0, g: 0, b: 0, n: 0 };
    const areaWeight = Math.sqrt(Math.abs(polygonSignedArea2(...poly.vertices))) / 3;
    for (const { color: c } of poly.vertices) {
      // Some maps paint their completely invisible collision mesh bright red or green.
      const weight = areaWeight * c.a / 255;
      sum.r += weight * c.r;
      sum.g += weight * c.g;
      sum.b += weight * c.b;
      sum.n += weight;
    }
    if (sum.n > 0) colors.set(poly.polyType, sum);
  }
  for (const c of colors.values()) {
    const n = c.n || 1;
    c.r /= n;
    c.g /= n;
    c.b /= n;
  }
  return colors;
}
function mapTint(from: ReturnType<typeof materialPalette>, to: ReturnType<typeof materialPalette>) {
  return (v: PmsVertex, kind: number) => {
    const a = from.get(kind), b = to.get(kind);
    if (from === to || !a || !b)
      return { ...v.color };
    const channel = (k: 'r' | 'g' | 'b') => Math.max(0, Math.min(255, Math.round(b[k] + (v.color[k] - a[k]) * 0.65)));
    return { r: channel('r'), g: channel('g'), b: channel('b'), a: v.color.a };
  };
}
function emptyStyledMap(anchor: PmsMapData, look: PmsMapData, seed: number) {
  const map = createMapFromTemplate('empty', { title: 'Map from references', texture: look.texture });
  return { ...map, polygons: [] as PmsPolygon[], randomId: seed, bgColorTop: { ...look.bgColorTop }, bgColorBtm: { ...look.bgColorBtm },
    weather: look.weather, steps: look.steps, startJet: anchor.startJet, medikits: anchor.medikits, grenadePacks: anchor.grenadePacks };
}
function finish(map: PmsMapData, report: ReferenceReport, scenerySources: number[]) {
  const compiled = prepareMapForSave(map, { geometryDirty: true });
  compiled.crc32 = soldatCrc32(serializePms(compiled));
  return { map: compiled, report, scenerySources };
}
function composition(maps: PmsMapData[], strips: StyleStrip[][], axis: Axis, variation: number, rand: () => number, extra: boolean) {
  const guide = strips[0], pool = strips.flat().filter(s => s.polygons.length);
  const keep = new Set([0, guide.length - 1]);
  const teams = new Set<number>();
  for (const point of maps[0].spawnpoints) {
    if (!point.active || point.team > 6 || teams.has(point.team))
      continue;
    teams.add(point.team);
    const i = guide.findIndex(strip => ownsPoint(point, axis, strip, guide.length));
    if (i >= 0)
      keep.add(i);
  }
  const slots: Slot[] = guide.map((g, i) => ({ guide: g, keep: keep.has(i) }));
  const free = slots.filter(s => !s.keep).length;
  const inserts = Math.max(extra ? 1 : 0, maps.length - 1 - free, free ? 0 : 1);
  for (let k = 0; k < inserts; k++) {
    const i = 1 + Math.floor(rand() * (guide.length - 2));
    slots.splice(i, 0, { guide: guide[i], keep: false, extra: true });
  }
  // Reserve the best available location for each reference. A perfect match to the base
  // would otherwise beat every other candidate on maps with distinctive silhouettes.
  const reserved = new Map<number, number>();
  const quota = Math.max(1, Math.round(slots.length / maps.length * (0.35 + variation * 0.45)));
  for (let round = 0; round < quota; round++)
    for (let source = 1; source < maps.length; source++) {
      let best = Infinity, slotIndex = -1;
      for (let i = 0; i < slots.length; i++) {
        const { guide: g, keep: pinned } = slots[i];
        if (pinned || reserved.has(i))
          continue;
        for (const s of strips[source]) {
          if (!s.polygons.length)
            continue;
          const cost = boundaryDistance(g.entrance, s.entrance) + boundaryDistance(g.exit, s.exit)
            + 0.15 * boundaryDistance(g.middle, s.middle) + rand() * 0.025;
          if (cost < best) {
            best = cost;
            slotIndex = i;
          }
        }
      }
      if (slotIndex >= 0)
        reserved.set(slotIndex, source);
    }
  const substitutes = new Set(slots.map((s, i) => ({ s, i, rank: rand() })).filter(({ s }) => !s.keep)
    .sort((a, b) => a.rank - b.rank).slice(0, Math.ceil((free + inserts) * (0.3 + variation * 0.6))).map(({ i }) => i));
  const count = new Map<StyleStrip, number>(), selected: StyleStrip[] = [];
  const sourcesUsed = new Set<number>();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i], target = slot.guide;
    let picked = target, best = Infinity;
    if (!slot.keep && pool.length) {
      const before = selected.at(-1)?.exit ?? target.entrance;
      for (const candidate of pool) {
        if (reserved.has(i) && candidate.source !== reserved.get(i))
          continue;
        if (substitutes.has(i) && candidate === target && pool.length > 1)
          continue;
        const fit = boundaryDistance(before, candidate.entrance) * 1.5 + boundaryDistance(candidate.exit, target.exit)
          + boundaryDistance(candidate.entrance, target.entrance) * 0.35;
        const widthRatio = (candidate.to - candidate.from) / (target.to - target.from);
        const extentMismatch = Math.abs(Math.log(widthRatio)) + Math.abs(Math.log(candidate.crossSize / target.crossSize));
        const position = Math.abs((candidate.index + 0.5) / strips[candidate.source].length - (target.index + 0.5) / guide.length);
        const score = fit + 0.13 * extentMismatch + position * (0.31 - 0.23 * variation)
          + (count.get(candidate) ?? 0) * 0.27 + (candidate === target ? 0.12 + variation * 0.36 : 0)
          + (sourcesUsed.has(candidate.source) ? 0.10 : 0) - rand() * (0.09 + variation * 0.43);
        if (score < best) {
          best = score;
          picked = candidate;
        }
      }
    }
    selected.push(picked);
    sourcesUsed.add(picked.source);
    count.set(picked, (count.get(picked) ?? 0) + 1);
  }
  return { slots, selected };
}
function synthesize(maps: PmsMapData[], options: ReferenceOptions, sections: number, extra: boolean): ReferenceResult | null {
  const anchor = maps[0], look = maps[options.look];
  const axis: Axis = anchor.polyBounds.width >= anchor.polyBounds.height ? 'x' : 'y';
  const cross = across(axis), rand = seeded(options.seed), variation = options.variation / 100;
  const strips = maps.map((m, index) => measureStyleStrips(m, index, axis, sections));
  const { slots, selected } = composition(maps, strips, axis, variation, rand, extra);
  const patterns = strips.flat().filter(s => s.polygons.length);
  const widths = slots.map(s => (s.guide.to - s.guide.from) * (1 + (rand() - 0.5) * (0.10 + variation * 0.23)));
  const crossSize = selected[0].crossSize;
  const shifts = Array.from({ length: slots.length + 1 }, () => (rand() - 0.5) * Math.min(80, crossSize * 0.09) * variation);
  const palette = maps.map(materialPalette), style = palette[options.look];
  const map = emptyStyledMap(anchor, look, options.seed);
  const styles = new Map<string, number>();
  const scenerySources = new Set<number>();
  const report: ReferenceReport = { sections: selected.length, fromSources: maps.map(() => 0), recombined: 0 };
  let start = -widths.reduce((sum, w) => sum + w, 0) / 2;
  let previousExit: SeamFace[] = [];
  let previousEnd = start;
  selected.forEach((s, i) => {
    const source = maps[s.source], slot = slots[i];
    const tint = mapTint(palette[s.source], style);
    const contiguous = (a: StyleStrip, b: StyleStrip) => a.source === b.source && a.index + 1 === b.index;
    const leftJoin = i > 0 && !contiguous(selected[i - 1], s);
    const rightJoin = i + 1 < selected.length && !contiguous(s, selected[i + 1]);
    const margin = Math.min(widths[i] * 0.19, Math.max(12, crossSize * 0.08), 100);
    const coreStart = start + (leftJoin ? margin : 0), coreEnd = start + widths[i] - (rightJoin ? margin : 0);
    const width = coreEnd - coreStart;
    const entrance: SeamFace[] = [], exit: SeamFace[] = [];
    const leftTarget = slot.guide.entrance;
    const rightTarget = slots[i + 1]?.guide.entrance ?? slot.guide.exit;
    const left = registerBoundary(s.entrance, leftTarget), right = registerBoundary(s.exit, rightTarget);
    // Interpolate the interior silhouette towards another measured example with similar
    // openings. Endpoints stay registered to the adjacent terrain, including at a flag.
    let analog = s, best = Infinity;
    for (const candidate of patterns) {
      if (candidate === s)
        continue;
      const distance = boundaryDistance(candidate.entrance, s.entrance) + boundaryDistance(candidate.exit, s.exit)
        + boundaryDistance(candidate.middle, s.middle) * 0.6 + rand() * (0.12 + 0.32 * variation);
      if (distance < best) {
        best = distance;
        analog = candidate;
      }
    }
    const middle = registerBoundary(s.middle, analog.middle);
    const project = (p: {
      x: number;
      y: number;
    }) => {
      const u = (p[axis] - s.from) / (s.to - s.from), v = (p[cross] - s.crossStart) / s.crossSize;
      const k = Math.max(0, Math.min(1, u));
      const a = coreStart + u * width;
      const seam = left(v) * (1 - k) + right(v) * k;
      const blend = 4 * k * (1 - k) * variation * (slot.keep ? 0.22 : 0.7);
      const b = (seam + (middle(v) - seam) * blend - 0.5) * crossSize + shifts[i] * (1 - k) + shifts[i + 1] * k;
      return axis === 'x' ? { x: a, y: b } : { x: b, y: a };
    };
    report.fromSources[s.source]++;
    if (slot.extra || s !== slot.guide)
      report.recombined++;
    for (const idx of s.polygons) {
      const poly = source.polygons[idx];
      const vertices = clipStrip(poly.vertices, axis, s).map((v): PmsVertex => ({ ...v, ...project(v), color: tint(v, poly.polyType) }));
      if (leftJoin)
        collectSeam(entrance, vertices, axis, coreStart, poly);
      if (rightJoin)
        collectSeam(exit, vertices, axis, coreEnd, poly);
      for (let j = 1; j + 1 < vertices.length; j++) {
        const triangle: PmsPolygon['vertices'] = [vertices[0], vertices[j], vertices[j + 1]];
        if (Math.abs(polygonSignedArea2(...triangle)) > 0.015)
          map.polygons.push(rebuildPolygonGeometry({ ...poly, vertices: triangle }));
      }
    }
    const owns = (p: {
      x: number;
      y: number;
    }) => ownsPoint(p, axis, s, strips[s.source].length);
    const scaleAlong = width / (s.to - s.from), scaleAcross = crossSize / s.crossSize;
    for (const prop of source.props) {
      if (!prop.active || !owns(prop))
        continue;
      const def = source.scenery[prop.style - 1];
      if (!def?.filename)
        continue;
      const key = def.filename;
      scenerySources.add(s.source);
      let id = styles.get(key);
      if (id === undefined) {
        id = map.scenery.length + 1;
        styles.set(key, id);
        map.scenery.push({ index: id, filename: def.filename, date: def.date, usedCount: 0 });
      }
      map.scenery[id - 1].usedCount++;
      map.props.push({ ...prop, raw: undefined, ...project(prop), index: map.props.length, style: id,
        scaleX: prop.scaleX * (axis === 'x' ? scaleAlong : scaleAcross), scaleY: prop.scaleY * (axis === 'y' ? scaleAlong : scaleAcross) });
    }
    for (const collider of source.colliders)
      if (collider.active && owns(collider)) {
        map.colliders.push({ ...collider, raw: undefined, ...project(collider), index: map.colliders.length,
          radius: collider.radius * Math.min(scaleAlong, scaleAcross) });
      }
    for (const p of source.spawnpoints) {
      if (!p.active || !owns(p) || (p.team <= 6 && (!slot.keep || s.source !== 0)))
        continue;
      const pt = project(p);
      map.spawnpoints.push({ ...p, raw: undefined, index: map.spawnpoints.length, x: Math.round(pt.x), y: Math.round(pt.y) });
    }
    if (leftJoin)
      map.polygons.push(...joinStyleSeam(previousExit, entrance, axis, previousEnd, coreStart));
    previousExit = exit;
    previousEnd = coreEnd;
    start += widths[i];
  });
  const limits = checkSoldatMapLimits({ polygonCount: map.polygons.length, sectorsNum: map.sectorsNum, propCount: map.props.length,
    sceneryCount: map.scenery.length, colliderCount: map.colliders.length, spawnCount: map.spawnpoints.length });
  if (limits.length || !map.polygons.length)
    return null;
  return finish(map, report, [...scenerySources]);
}
export function generateReferenceMap(maps: PmsMapData[], options: ReferenceOptions): ReferenceResult {
  if (!maps.length || maps.length > MAX_STYLE_REFERENCES || !Number.isInteger(options.look) || !maps[options.look] ||
    !Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0x7fffffff ||
    !Number.isFinite(options.variation) || options.variation < 0 || options.variation > 100 ||
    (options.layout !== undefined && !['compose', 'reshape'].includes(options.layout)))
    throw new Error('Invalid reference settings.');
  for (const map of maps) {
    const violations=checkSoldatMapLimits({ polygonCount:map.polygons.length, sectorsNum:map.sectorsNum,
      propCount:map.props.length, sceneryCount:map.scenery.length, colliderCount:map.colliders.length, spawnCount:map.spawnpoints.length });
    if (violations.length || map.parseWarnings.length) throw new Error('A reference exceeds the PMS limits or has read errors.');
  }
  if (options.layout === 'reshape') {
    const anchor = maps[0], look = maps[options.look], a = materialPalette(anchor);
    const result = reshapeReferenceLayout(maps, options.variation, seeded(options.seed), mapTint(a, look === anchor ? a : materialPalette(look)));
    const map = { ...emptyStyledMap(anchor, look, options.seed), ...result.geometry };
    return finish(map, result.report, map.props.some(p => p.active && map.scenery[p.style - 1]) ? [0] : []);
  }
  for (const [count, extra] of [[9, true], [6, false], [4, false]] as const) {
    const result = synthesize(maps, options, count, extra);
    if (result)
      return result;
  }
  throw new Error('This composition exceeds the PMS limits. Try a different seed or a smaller reference.');
}
