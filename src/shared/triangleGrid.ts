import type { PmsPolygon } from './pmsParser';
import { pointInTriInclusive } from './polygonGeometry';

/** Coarse uniform grid of triangles for point queries (numeric keys, no string building per lookup) */
export class TriangleGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly big: number[] = [];
  constructor(
    private readonly polys: ReadonlyArray<PmsPolygon>,
    indices: ReadonlyArray<number>,
    private readonly cell = 64
  ) {
    for (const i of indices) {
      const [a, b, c] = polys[i].vertices;
      const gx0 = Math.floor(Math.min(a.x, b.x, c.x) / cell);
      const gx1 = Math.floor(Math.max(a.x, b.x, c.x) / cell);
      const gy0 = Math.floor(Math.min(a.y, b.y, c.y) / cell);
      const gy1 = Math.floor(Math.max(a.y, b.y, c.y) / cell);
      if (![gx0, gx1, gy0, gy1].every(Number.isSafeInteger)) continue;
      if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 1024) {
        this.big.push(i);
        continue;
      }
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = gx * 1_000_003 + gy;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  public *candidates(x: number, y: number): Generator<number> {
    const key = Math.floor(x / this.cell) * 1_000_003 + Math.floor(y / this.cell);
    yield* this.cells.get(key) ?? [];
    yield* this.big;
  }

  /** First triangle of the grid containing the point (edges included), or -1 */
  public findContaining(x: number, y: number): number {
    for (const i of this.candidates(x,y)) {
      const [a, b, c] = this.polys[i].vertices;
      if (pointInTriInclusive(x, y, a, b, c)) return i;
    }
    return -1;
  }
}
