export type DragShapeMode = 'rect' | 'ramp' | 'spike';
export type ShapeOrientation = 'drag' | 0 | 1 | 2 | 3;

type Point = { x: number; y: number };

/** A preset fits the drag bounds. In drag orientation the start is its base and the end sets its tip. */
export function dragShapeOutline(
  mode: DragShapeMode,
  start: Point,
  end: Point,
  orientation: ShapeOrientation,
): Point[] {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return [];

  const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
  if (mode === 'rect') {
    return [{ x: left, y: top }, { x: left + width, y: top },
      { x: left + width, y: top + height }, { x: left, y: top + height }];
  }
  if (orientation === 'drag') {
    if (mode === 'ramp') return [start, end, { x: end.x, y: start.y }];
    return [start, { x: (start.x + end.x) / 2, y: end.y }, { x: end.x, y: start.y }];
  }
  // Rotate in unit coordinates first so a quarter turn still fits non-square drag bounds.
  const unit = [[0, 1], [mode === 'ramp' ? 1 : 0.5, 0], [1, 1]];
  return unit.map(([u, v]) => {
    for (let turn = 0; turn < orientation; turn++) [u, v] = [1 - v, u];
    return { x: left + u * width, y: top + v * height };
  });
}
