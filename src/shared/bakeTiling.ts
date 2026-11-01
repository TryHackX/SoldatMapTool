import type { PmsBounds } from './pmsParser';

// World units of cross-fade overlap on each side of a seam between two baked tiles of the same layer.
// Soldat's sprite atlas has transparent padding, so a plain edge-to-edge tile join would show a faint seam
// (both tiles fade by half a texel); the baker's alpha-split cross-fade makes the join mathematically exact.
export const TILE_OVERLAP_WORLD = 2;

// A layer needing more tiles is refused: the result could not load anyway (Soldat draws at most 500 props),
// and enumerating them must not exhaust memory on maps with absurd prop extents
export const MAX_BAKE_TILES = 500;

export interface BakeTile {
  // Rendered world area: the tile core plus the overlap on every side shared with a neighbour
  left: number;
  right: number;
  top: number;
  bottom: number;
  sides: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

/**
 * The tiles the baker renders for a layer group: its grid cells that any prop reaches (a run spread over the
 * map skips the empty space between props). The client bakes exactly these tiles and the server estimates the
 * texture size from them, so both use this one function. Null when more than MAX_BAKE_TILES would be needed.
 */
export function bakeTilesFor(
  bounds: PmsBounds,
  supersample: number,
  maxTilePx: number,
  propBounds: readonly PmsBounds[]
): BakeTile[] | null {
  // Integer world units per tile core, so every tile edge and crop lands on whole world coordinates
  const span = Math.max(64, Math.floor(maxTilePx / supersample) - 2 * TILE_OVERLAP_WORLD);
  const cols = Math.max(1, Math.ceil(bounds.width / span));
  const rows = Math.max(1, Math.ceil(bounds.height / span));
  // A tile renders its core plus the overlap, and a sprite edge may spread one texel further
  const reach = TILE_OVERLAP_WORLD + 1;
  const used = new Set<number>();
  for (const b of propBounds) {
    const c0 = Math.max(0, Math.floor((b.left - reach - bounds.left) / span));
    const c1 = Math.min(cols - 1, Math.floor((b.right + reach - bounds.left) / span));
    const r0 = Math.max(0, Math.floor((b.top - reach - bounds.top) / span));
    const r1 = Math.min(rows - 1, Math.floor((b.bottom + reach - bounds.top) / span));
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_BAKE_TILES) return null;
    for (let ry = r0; ry <= r1; ry++) {
      for (let cx = c0; cx <= c1; cx++) used.add(ry * cols + cx);
    }
    if (used.size > MAX_BAKE_TILES) return null;
  }

  const tiles: BakeTile[] = [];
  for (const key of Array.from(used).sort((a, b) => a - b)) {
    const cx = key % cols;
    const ry = (key - cx) / cols;
    const coreLeft = bounds.left + cx * span;
    const coreRight = Math.min(bounds.right, coreLeft + span);
    const coreTop = bounds.top + ry * span;
    const coreBottom = Math.min(bounds.bottom, coreTop + span);
    if (coreRight <= coreLeft || coreBottom <= coreTop) continue;

    const sides = { left: cx > 0, right: cx < cols - 1, top: ry > 0, bottom: ry < rows - 1 };
    tiles.push({
      left: coreLeft - (sides.left ? TILE_OVERLAP_WORLD : 0),
      right: coreRight + (sides.right ? TILE_OVERLAP_WORLD : 0),
      top: coreTop - (sides.top ? TILE_OVERLAP_WORLD : 0),
      bottom: coreBottom + (sides.bottom ? TILE_OVERLAP_WORLD : 0),
      sides,
    });
  }
  return tiles;
}

/**
 * World size of what the baker keeps of one tile, estimated from the bounding boxes of the props drawn in it:
 * the transparent rest is cropped (snapped to whole world units) and content near a shared edge keeps the seam
 * band. Null when no prop reaches the tile — the baker skips empty tiles. Never smaller than the real crop.
 */
export function estimateTileCrop(
  tile: BakeTile,
  propBounds: readonly PmsBounds[]
): { width: number; height: number } | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const b of propBounds) {
    // 1 unit margin for the texel that bilinear filtering spreads past the sprite edge
    const l = Math.max(tile.left, b.left - 1);
    const r = Math.min(tile.right, b.right + 1);
    const t = Math.max(tile.top, b.top - 1);
    const btm = Math.min(tile.bottom, b.bottom + 1);
    if (l >= r || t >= btm) continue;
    if (l < left) left = l;
    if (r > right) right = r;
    if (t < top) top = t;
    if (btm > bottom) bottom = btm;
  }
  if (left >= right || top >= bottom) return null;

  const band = 2 * TILE_OVERLAP_WORLD;
  left = tile.sides.left && left < tile.left + band ? tile.left : Math.floor(left);
  top = tile.sides.top && top < tile.top + band ? tile.top : Math.floor(top);
  right = tile.sides.right && right > tile.right - band ? tile.right : Math.ceil(right);
  bottom = tile.sides.bottom && bottom > tile.bottom - band ? tile.bottom : Math.ceil(bottom);
  return { width: right - left, height: bottom - top };
}
