import type { PmsPolygon } from '@shared/pmsParser';
import { t } from '../i18n';
import { dragShapeOutline, type DragShapeMode, type ShapeOrientation } from './dragShapes';
import { laserStroke, polygonOutline, triangleClick } from './polygonDrawing';
import type { EditorPlacementDefaults, EditorToolId } from './types';

type Point = { x: number; y: number };
type Pointer = { worldX: number; worldY: number; zoom: number };
type Release = Pointer & { outsideViewport?: boolean; cancelled?: boolean };

export type PolygonDrag =
  | { kind: 'shape_drag'; mode: DragShapeMode; orientation: ShapeOrientation; start: Point; outline: Point[] }
  | { kind: 'poly_laser'; points: Point[] };

export function isPolygonDrag(drag: { kind: string } | null): drag is PolygonDrag {
  return drag?.kind === 'shape_drag' || drag?.kind === 'poly_laser';
}

interface GestureContext {
  placement: EditorPlacementDefaults;
  texture: { w: number; h: number };
  hasDocument: () => boolean;
  insert: (polygons: PmsPolygon[], label: string) => boolean;
  inform: (message: string) => void;
  startDrag: (drag: PolygonDrag) => void;
  setDraft: (points: Point[]) => void;
  setLaser: (points: Point[] | null) => void;
  setLaserPreview: (points: Point[] | null) => void;
  lastLaserPreview: { current: number };
  snapEndpoint: (pointer: Pointer, anchor: Point, showGuides: boolean) => Point | undefined;
}

export function createPolygonGestures(context: GestureContext) {
  const { placement, texture, insert, inform, setDraft } = context;

  function finishOutline(points: Point[]) {
    if (!context.hasDocument() || points.length < 3) {
      setDraft([]);
      return;
    }
    const polygons = polygonOutline(points, placement, texture);
    if (!polygons.length) {
      inform(t('Check the outline for crossings or collinear points.'));
      return;
    }
    if (insert(polygons, 'Create triangulated shape')) setDraft([]);
  }

  function begin(tool: EditorToolId, pointer: Pointer, snapped: Point, draft: Point[], locked: boolean) {
    if (locked && tool.startsWith('poly_')) return true;
    switch (tool) {
      case 'poly_laser': {
        const points = [{ x: pointer.worldX, y: pointer.worldY }];
        context.setLaser(points);
        context.startDrag({ kind: 'poly_laser', points });
        return true;
      }
      case 'poly_tri':
      case 'poly_strip':
      case 'poly_fan': {
        const point = { x: snapped.x, y: snapped.y };
        const next = triangleClick(tool, draft, point, placement, texture);
        if (next.collinear) inform(t('Move the third point off the line.'));
        else if (!next.polygon || insert([next.polygon], 'Create polygon')) setDraft(next.draft);
        return true;
      }
      case 'poly_shape': {
        const point = { x: snapped.x, y: snapped.y };
        if (placement.polyShapeMode !== 'polygon') {
          context.startDrag({
            kind: 'shape_drag', mode: placement.polyShapeMode,
            orientation: placement.shapeOrientation, start: point, outline: [],
          });
          setDraft([point]);
          return true;
        }
        const first = draft[0];
        const closeDistance = 10 / Math.max(0.02, pointer.zoom);
        if (draft.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= closeDistance) {
          finishOutline(draft);
        } else {
          setDraft([...draft, point]);
        }
        return true;
      }
      default: return false;
    }
  }

  function move(drag: PolygonDrag, pointer: Pointer) {
    if (drag.kind === 'shape_drag') {
      const end = context.snapEndpoint(pointer, drag.start, true);
      if (!end) return;
      drag.outline = dragShapeOutline(drag.mode, drag.start, end, drag.orientation);
      setDraft(drag.outline.length ? drag.outline : [drag.start]);
      return;
    }
    const last = drag.points[drag.points.length - 1];
    if (last && Math.hypot(pointer.worldX - last.x, pointer.worldY - last.y) * pointer.zoom < 2.5) return;
    drag.points.push({ x: pointer.worldX, y: pointer.worldY });
    context.setLaser([...drag.points]);
    // The line follows each sample. Triangulation only needs a fresh preview every 120 ms.
    const now = performance.now();
    if (now - context.lastLaserPreview.current >= 120) {
      context.lastLaserPreview.current = now;
      context.setLaserPreview([...drag.points]);
    }
  }

  function end(drag: PolygonDrag, pointer: Release, locked: boolean) {
    if (drag.kind === 'shape_drag') {
      const end = pointer.outsideViewport ? undefined : context.snapEndpoint(pointer, drag.start, false);
      const outline = end ? dragShapeOutline(drag.mode, drag.start, end, drag.orientation) : drag.outline;
      if (!pointer.cancelled && !locked && outline.length) finishOutline(outline);
      else setDraft([]);
      return;
    }
    context.setLaser(null);
    context.setLaserPreview(null);
    if (pointer.cancelled || pointer.outsideViewport || locked || drag.points.length < 2) return;
    const polygons = laserStroke(drag.points, placement, texture);
    const course = placement.strokeMode === 'course';
    if (polygons.length) insert(polygons, course ? 'Draw platform route' : 'Draw laser polygons');
    else inform(course ? t('Route too short or longer than the 5000 polygon budget.') : t('Stroke too short or outline invalid.'));
  }

  return { begin, move, end, finishOutline };
}
