import { type PmsMapData } from '@shared/pmsParser';
import { doesPolyCollideSoldier } from '@shared/soldatConstants';
import { pointInTriInclusive } from '@shared/polygonGeometry';
import { simplifyPolylineRdp } from '@shared/imageTracer';
import { EditorSpatialIndex } from './spatialIndex';
import { runTunnelTrial } from './tunnelTrial';
// A free-space guide supplies the pilot with bends even on a map without an editor tunnel axis.
// Only the continuous movement simulation can mark a run complete.
export function runReferencePilot(map: PmsMapData) {
  const spawn = map.spawnpoints.find(p => p.active && p.team === 1), flag = map.spawnpoints.find(p => p.active && p.team === 6);
  if (!spawn || !flag)
    return null;
  const b = map.polyBounds;
  const left = Math.min(b.left, spawn.x, flag.x) - 36, top = Math.min(b.top, spawn.y, flag.y) - 36;
  const width = Math.max(b.right, spawn.x, flag.x) - left + 36, height = Math.max(b.bottom, spawn.y, flag.y) - top + 36;
  const step = Math.max(10, Math.ceil(Math.sqrt(width * height / 65000)), Math.ceil(Math.max(width, height) / 2000));
  const cols = Math.ceil(width / step) + 1, rows = Math.ceil(height / step) + 1, total = cols * rows;
  const idx = new EditorSpatialIndex(map), cells = new Int8Array(total), prev = new Int32Array(total).fill(-1);
  const xy = (id: number) => ({ x: left + (id % cols) * step, y: top + Math.floor(id / cols) * step });
  const idOf = (p: {
    x: number;
    y: number;
  }) => Math.round((p.y - top) / step) * cols + Math.round((p.x - left) / step);
  const clear = (id: number) => {
    if (cells[id])
      return cells[id] > 0;
    const { x, y } = xy(id);
    const solid = idx.queryPolygonCandidates(x - 3, y - 4, x + 3, y + 4).some(i => {
      const p = map.polygons[i];
      return doesPolyCollideSoldier(p.polyType, 1, false) && (pointInTriInclusive(x, y, ...p.vertices) ||
        pointInTriInclusive(x, y + 4, ...p.vertices) || pointInTriInclusive(x, y - 4, ...p.vertices));
    }) || map.colliders.some(c => c.active && Math.hypot(x - c.x, y - c.y) < Math.abs(c.radius) / 2 + 2);
    cells[id] = solid ? -1 : 1;
    return !solid;
  };
  const start = idOf(spawn), end = idOf(flag);
  // A four-direction shortest path can ask a runner to ascend through empty sky
  // at the spawn. Prefer supported moves and allow diagonal approaches to landings.
  const cost = new Float64Array(total).fill(Infinity), heap: {
    id: number;
    rank: number;
  }[] = [];
  function push(id: number) {
    const pt = xy(id), item = { id, rank: cost[id] + Math.hypot(pt.x - flag!.x, pt.y - flag!.y) / step };
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (heap[p].rank <= item.rank)
        break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  }
  function pop() {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1].rank < heap[child].rank)
          child++;
        if (heap[child].rank >= last.rank)
          break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first.id;
  }
  const closed = new Uint8Array(total), airCost = new Float32Array(total).fill(-1);
  const airborne = (id: number) => {
    if (airCost[id] >= 0)
      return airCost[id];
    let distance = 0;
    for (let cell = id + cols; cell < total && distance < 100 && clear(cell); cell += cols)
      distance += step;
    return airCost[id] = Math.min(1, distance / 90) * (map.startJetGame > 0 ? 0.55 : 2);
  };
  prev[start] = start;
  cost[start] = 0;
  push(start);
  while (heap.length) {
    const id = pop(), col = id % cols;
    if (id === end)
      break;
    if (closed[id])
      continue;
    closed[id] = 1;
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) {
        const next = id + dy * cols + dx;
        if ((!dx && !dy) || col + dx < 0 || col + dx >= cols || next < 0 || next >= total || closed[next] || (next !== end && !clear(next)))
          continue;
        if (dx && dy && (!clear(id + dx) || !clear(id + dy * cols)))
          continue;
        const candidate = cost[id] + Math.hypot(dx, dy) * (1 + airborne(next));
        if (candidate >= cost[next])
          continue;
        cost[next] = candidate;
        prev[next] = id;
        push(next);
      }
  }
  if (prev[end] < 0)
    return null;
  const points = [{ x: flag.x, y: flag.y }];
  for (let id = prev[end]; id !== start; id = prev[id])
    points.push(xy(id));
  points.push({ x: spawn.x, y: spawn.y });
  const guide = simplifyPolylineRdp(points.reverse(), step * 0.8);
  const feet: {
    x: number;
    y: number;
  }[] = [];
  for (const poly of map.polygons) {
    if (!doesPolyCollideSoldier(poly.polyType, 1, false) || [5, 6, 7].includes(poly.polyType))
      continue;
    for (let i = 0; i < 3; i++) {
      const a = poly.vertices[i], b = poly.vertices[(i + 1) % 3], dx = b.x - a.x;
      if (dx < 8 || Math.abs(b.y - a.y) > dx * 0.6)
        continue;
      const samples = Math.min(12, Math.max(1, Math.ceil(dx / 64)));
      for (let j = 0; j < samples; j++) {
        const k = (j + 0.5) / samples, x = a.x + k * dx, y = a.y + k * (b.y - a.y);
        const buried = idx.queryPolygonCandidates(x, y - 2, x, y - 2).some(n => {
          const other = map.polygons[n];
          return doesPolyCollideSoldier(other.polyType, 1, false) && pointInTriInclusive(x, y - 2, ...other.vertices);
        });
        if (!buried)
          feet.push({ x, y });
      }
    }
  }
  return runTunnelTrial(map, guide, feet);
}
