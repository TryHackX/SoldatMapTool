export type ChamberKind = 'alcove' | 'gallery' | 'shaft' | 'ice' | 'rest';
export interface TunnelChamber {
  kind: ChamberKind;
  start: number;
  end: number;
  /** Height of the central landing in a rest chamber, in world coordinates. */
  floorY?: number;
}
interface Point { x: number; y: number }

/** Distances are measured on the authored line. Never move its centre to fit a chamber. */
export function planTunnelChambers(path: readonly Point[], lengths: readonly number[], seed: number,
  clearance: number, ice: boolean): TunnelChamber[] {
  const rooms: TunnelChamber[] = [];
  const types: ChamberKind[] = ['alcove', 'rest', 'gallery', ice ? 'ice' : 'gallery', 'shaft'];
  const limit = lengths.at(-1)! - 100;
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const first = Math.floor(random() * types.length);
  const nearest = (d: number) => {
    const right = lengths.findIndex(s => s >= d);
    return right < 1 ? 0 : d - lengths[right - 1] < lengths[right] - d ? right - 1 : right;
  };
  for (let start = 105 + random() * 35; start + 82 <= limit;) {
    let kind = types[(first + rooms.length) % types.length];
    const span = { alcove: 110, gallery: 285, shaft: 118, ice: 195, rest: 155 }[kind];
    const end = Math.min(limit, start + span * (0.88 + random() * 0.24));
    const a = nearest(start), b = nearest(end), mid = nearest((start + end) / 2);
    const steep = Math.abs(path[b].y - path[a].y) / (lengths[b] - lengths[a] || 1);
    if (steep > 0.6) kind = 'shaft';
    // A flat landing on a steeply undulating path could close the tunnel.
    else if (kind === 'rest' && path.slice(a, b + 1).some(p => Math.abs(p.y - path[mid].y) > clearance * 0.16))
      kind = 'alcove';
    rooms.push({ kind, start, end, ...(kind === 'rest' ? { floorY: path[mid].y + clearance * 0.49 } : {}) });
    start = end + 52 + random() * 48;
  }
  return rooms;
}

export function chamberWeight(room: TunnelChamber, along: number) {
  const t = Math.max(0, Math.min(1, Math.min(along - room.start, room.end - along) / ((room.end - room.start) * 0.29)));
  return t * t * (3 - 2 * t);
}

export function chamberRadius(room: TunnelChamber, weight: number, radius: number, clearance: number,
  center: Point, normal: Point) {
  if (!weight) return radius;
  if (room.kind === 'rest' && normal.y > 0.55 && room.floorY !== undefined) {
    const flat = Math.max(clearance * 0.30, Math.min(clearance * 0.85, (room.floorY - center.y) / normal.y));
    return radius + weight * (flat - radius);
  }
  const ceiling = normal.y < -0.38, wall = Math.abs(normal.y) <= 0.55;
  // Keep opposing footholds within jumping distance on an already vertical passage.
  const gain = room.kind === 'shaft' ? (ceiling ? 0.49 : wall ? 0.045 : 0) :
    room.kind === 'gallery' ? (ceiling ? 0.33 : 0.03) :
    room.kind === 'alcove' ? (ceiling ? 0.22 : 0.02) : ceiling ? 0.15 : 0;
  return radius + weight * clearance * gain;
}
