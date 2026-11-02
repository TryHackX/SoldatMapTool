import { earClipTriangulate } from '@shared/pmsCompiler';
import { computePropCorners, PmsBounds, PmsMapData } from '@shared/pmsParser';
import { SoldierPlaytestState } from './soldierPlaytest';
import {
  EditorBlueprintOverlay,
  EditorSelection,
  EditorToolId,
  GizmoHandleKind,
  SelectionSummary,
  SmartGuideLine,
  SnapIndicator,
} from './types';

export interface EditorOverlayRenderState {
  activeTool: EditorToolId;
  selection: EditorSelection;
  selectionSummary: SelectionSummary;
  gridSize: number;
  showEditorGrid: boolean;
  cursorWorld: { x: number; y: number } | null;
  snapIndicator: SnapIndicator | null;
  smartGuides: SmartGuideLine[];
  marqueeBox: { x1: number; y1: number; x2: number; y2: number } | null;
  lassoPoints: Array<{ x: number; y: number }> | null;
  laserPoints: Array<{ x: number; y: number }> | null;
  laserPreviewContour: Array<{ x: number; y: number }> | null;
  draftPoints: Array<{ x: number; y: number }>;
  brushRadius: number | null;
  symmetryAxisX: number | null;
  validationFocus: { x: number; y: number; radius?: number } | null;
  ghostBounds: PmsBounds | null;
  ghostPropQuad?: [number, number, number, number, number, number, number, number] | null;
  blueprint: EditorBlueprintOverlay | null;
  playtest: SoldierPlaytestState | null;
}

const HANDLE_HALF_PX = 4.5;
const ROTATE_STEM_PX = 26;
const ROTATE_RADIUS_PX = 6;

interface SinglePropObbGizmo {
  corners: [number, number, number, number, number, number, number, number];
  center: { x: number; y: number };
  topMid: { x: number; y: number };
  rot: { x: number; y: number };
  handles: Array<[GizmoHandleKind, number, number]>;
}

function getSinglePropObbGizmo(
  map: PmsMapData,
  selection: EditorSelection,
  summary: SelectionSummary,
  safeZoom: number
): SinglePropObbGizmo | null {
  if (
    selection.props.length !== 1 ||
    summary.totalObjects !== 1 ||
    summary.vertexCount !== 0
  ) {
    return null;
  }
  const prop = map.props[selection.props[0]];
  if (!prop) return null;
  const w = prop.width !== 0 ? prop.width : 64;
  const h = prop.height !== 0 ? prop.height : 64;
  const c = computePropCorners(prop.x, prop.y, w, h, prop.scaleX, prop.scaleY, prop.rotation);

  const nw = { x: c[0], y: c[1] };
  const ne = { x: c[2], y: c[3] };
  const se = { x: c[4], y: c[5] };
  const sw = { x: c[6], y: c[7] };

  const n = { x: (nw.x + ne.x) * 0.5, y: (nw.y + ne.y) * 0.5 };
  const e = { x: (ne.x + se.x) * 0.5, y: (ne.y + se.y) * 0.5 };
  const s = { x: (se.x + sw.x) * 0.5, y: (se.y + sw.y) * 0.5 };
  const wMid = { x: (sw.x + nw.x) * 0.5, y: (sw.y + nw.y) * 0.5 };
  const center = { x: (nw.x + se.x) * 0.5, y: (nw.y + se.y) * 0.5 };

  let ux = n.x - center.x;
  let uy = n.y - center.y;
  const uLen = Math.hypot(ux, uy);
  if (uLen > 1e-4) {
    ux /= uLen;
    uy /= uLen;
  } else {
    ux = Math.sin(-prop.rotation);
    uy = -Math.cos(-prop.rotation);
  }
  const rotDist = ROTATE_STEM_PX / safeZoom;
  const rot = { x: n.x + ux * rotDist, y: n.y + uy * rotDist };

  return {
    corners: c,
    center,
    topMid: n,
    rot,
    handles: [
      ['scale_nw', nw.x, nw.y],
      ['scale_ne', ne.x, ne.y],
      ['scale_se', se.x, se.y],
      ['scale_sw', sw.x, sw.y],
      ['scale_n', n.x, n.y],
      ['scale_e', e.x, e.y],
      ['scale_s', s.x, s.y],
      ['scale_w', wMid.x, wMid.y],
    ],
  };
}

export function hitTestTransformGizmo(
  wx: number,
  wy: number,
  zoom: number,
  summary: SelectionSummary,
  map: PmsMapData,
  selection: EditorSelection
): GizmoHandleKind | null {
  const safeZoom = Math.max(0.02, zoom || 0.5);
  const hitTol = 8 / safeZoom;

  // Single collider rim handle for quick interactive diameter resizing
  if (
    selection.colliders.length === 1 &&
    selection.polygons.length === 0 &&
    selection.props.length === 0 &&
    selection.spawns.length === 0 &&
    selection.waypoints.length === 0
  ) {
    const col = map.colliders[selection.colliders[0]];
    if (col) {
      const rimX = col.x + Math.max(2, Math.abs(col.radius) * 0.5);
      const rimY = col.y;
      if (Math.hypot(wx - rimX, wy - rimY) <= hitTol * 1.2) {
        return 'collider_rim';
      }
    }
  }

  // Oriented quad gizmo when a single scenery prop is selected
  const obb = getSinglePropObbGizmo(map, selection, summary, safeZoom);
  if (obb) {
    if (Math.hypot(wx - obb.rot.x, wy - obb.rot.y) <= (ROTATE_RADIUS_PX + 5) / safeZoom) {
      return 'rotate';
    }
    for (const [kind, hx, hy] of obb.handles) {
      if (Math.hypot(wx - hx, wy - hy) <= hitTol * 1.15) {
        return kind;
      }
    }
    if (Math.hypot(wx - obb.center.x, wy - obb.center.y) <= hitTol * 1.4) {
      return 'move';
    }
    return null;
  }

  const b = summary.bounds;
  if (!b || (summary.totalObjects === 0 && summary.vertexCount === 0)) return null;

  const cx = (b.left + b.right) * 0.5;
  const hasExtent =
    b.width > 1 ||
    b.height > 1 ||
    selection.props.length > 0 ||
    selection.polygons.length > 0 ||
    summary.vertexCount > 1;

  // Rotate handle sits ROTATE_STEM_PX above top-center
  if (hasExtent) {
    const rotX = cx;
    const rotY = b.top - ROTATE_STEM_PX / safeZoom;
    if (Math.hypot(wx - rotX, wy - rotY) <= (ROTATE_RADIUS_PX + 4) / safeZoom) {
      return 'rotate';
    }

    const handles: Array<[GizmoHandleKind, number, number]> = [
      ['scale_nw', b.left, b.top],
      ['scale_ne', b.right, b.top],
      ['scale_se', b.right, b.bottom],
      ['scale_sw', b.left, b.bottom],
      ['scale_n', cx, b.top],
      ['scale_s', cx, b.bottom],
      ['scale_w', b.left, (b.top + b.bottom) * 0.5],
      ['scale_e', b.right, (b.top + b.bottom) * 0.5],
    ];
    for (const [kind, hx, hy] of handles) {
      if (Math.abs(wx - hx) <= hitTol && Math.abs(wy - hy) <= hitTol) {
        return kind;
      }
    }
  }

  // Center move handle or inside gizmo box when already selected
  const cy = (b.top + b.bottom) * 0.5;
  if (Math.hypot(wx - cx, wy - cy) <= hitTol * 1.4) {
    return 'move';
  }
  return null;
}

export function renderEditorOverlay(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  map: PmsMapData,
  bounds: { left: number; right: number; top: number; bottom: number },
  state: EditorOverlayRenderState
): void {
  const worldW = bounds.right - bounds.left;
  const worldH = bounds.bottom - bounds.top;
  if (worldW <= 0 || worldH <= 0) return;

  const pxPerX = canvasWidth / worldW;
  const pxPerY = canvasHeight / worldH;
  const zoom = (pxPerX + pxPerY) * 0.5;
  const sx = (wx: number) => (wx - bounds.left) * pxPerX;
  const sy = (wy: number) => (wy - bounds.top) * pxPerY;

  ctx.save();

  // 1. Fine Editor Snap Grid (when enabled and zoomed close enough so cells >= 9 px)
  if (state.showEditorGrid && state.gridSize > 0) {
    let step = state.gridSize;
    while (step * zoom < 9) step *= 2;
    const startX = Math.floor(bounds.left / step) * step;
    const endX = Math.ceil(bounds.right / step) * step;
    const startY = Math.floor(bounds.top / step) * step;
    const endY = Math.ceil(bounds.bottom / step) * step;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = startX; gx <= endX; gx += step) {
      const px = Math.round(sx(gx)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvasHeight);
    }
    for (let gy = startY; gy <= endY; gy += step) {
      const py = Math.round(sy(gy)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(canvasWidth, py);
    }
    ctx.stroke();
  }

  // 1b. Reference Blueprint Overlay (semi-transparent image guide for tracing)
  if (state.blueprint && state.blueprint.visible && state.blueprint.opacity > 0.01) {
    const bp = state.blueprint;
    const bw = Math.max(1, bp.width || 64) * bp.scale;
    const bh = Math.max(1, bp.height || 64) * bp.scale;
    const bx = sx(bp.x - bw * 0.5);
    const by = sy(bp.y - bh * 0.5);
    const bScreenW = bw * pxPerX;
    const bScreenH = bh * pxPerY;
    ctx.save();
    ctx.globalAlpha = Math.max(0.02, Math.min(1, bp.opacity));
    ctx.drawImage(bp.image, bx, by, bScreenW, bScreenH);
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(bx, by, bScreenW, bScreenH);
    ctx.restore();
  }

  // 2. Symmetry axis preview
  if (state.symmetryAxisX !== null) {
    const ax = sx(state.symmetryAxisX);
    ctx.save();
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, canvasHeight);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Vertex dots in vertex-centric tools (Vertex, Color Brush, UV, Light)
  const showAllVertices =
    state.activeTool === 'vertex' ||
    state.activeTool === 'color_brush' ||
    state.activeTool === 'uv' ||
    state.activeTool === 'light';

  if (showAllVertices) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < map.polygons.length; i++) {
      const [v0, v1, v2] = map.polygons[i].vertices;
      if (
        Math.max(v0.x, v1.x, v2.x) < bounds.left ||
        Math.min(v0.x, v1.x, v2.x) > bounds.right ||
        Math.max(v0.y, v1.y, v2.y) < bounds.top ||
        Math.min(v0.y, v1.y, v2.y) > bounds.bottom
      ) {
        continue;
      }
      ctx.moveTo(sx(v0.x), sy(v0.y));
      ctx.lineTo(sx(v1.x), sy(v1.y));
      ctx.lineTo(sx(v2.x), sy(v2.y));
      ctx.closePath();
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
    for (let i = 0; i < map.polygons.length; i++) {
      const vs = map.polygons[i].vertices;
      for (let vi = 0; vi < 3; vi++) {
        const vx = vs[vi].x;
        const vy = vs[vi].y;
        if (vx < bounds.left || vx > bounds.right || vy < bounds.top || vy > bounds.bottom) continue;
        ctx.fillRect(sx(vx) - 2.5, sy(vy) - 2.5, 5, 5);
      }
    }
  }

  // 4. Selected Polygons
  if (state.selection.polygons.length > 0) {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    for (const idx of state.selection.polygons) {
      const poly = map.polygons[idx];
      if (!poly) continue;
      const [v0, v1, v2] = poly.vertices;
      ctx.beginPath();
      ctx.moveTo(sx(v0.x), sy(v0.y));
      ctx.lineTo(sx(v1.x), sy(v1.y));
      ctx.lineTo(sx(v2.x), sy(v2.y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw edge normal ticks so winding / bounciness direction is unmistakable
      for (let e = 0; e < 3; e++) {
        const va = poly.vertices[e];
        const vb = poly.vertices[(e + 1) % 3];
        const mx = sx((va.x + vb.x) * 0.5);
        const my = sy((va.y + vb.y) * 0.5);
        const n = poly.normals[e];
        const nLen = Math.hypot(n.x, n.y) || 1;
        // Outward direction is -normal
        const ox = (-n.x / nLen) * 9;
        const oy = (-n.y / nLen) * 9;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + ox, my + oy);
        ctx.stroke();
      }
    }
  }

  // 5. Selected Vertices
  if (state.selection.vertices.length > 0) {
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 1.5;
    for (const vr of state.selection.vertices) {
      const v = map.polygons[vr.polyIndex]?.vertices[vr.vertexIndex];
      if (!v) continue;
      const px = sx(v.x);
      const py = sy(v.y);
      ctx.fillRect(px - 4.5, py - 4.5, 9, 9);
      ctx.strokeRect(px - 4.5, py - 4.5, 9, 9);
    }
  }

  // 6. Selected Props
  if (state.selection.props.length > 0) {
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.lineWidth = 2;
    for (const idx of state.selection.props) {
      const p = map.props[idx];
      if (!p) continue;
      const w = p.width !== 0 ? p.width : 64;
      const h = p.height !== 0 ? p.height : 64;
      const c = computePropCorners(p.x, p.y, w, h, p.scaleX, p.scaleY, p.rotation);
      ctx.beginPath();
      ctx.moveTo(sx(c[0]), sy(c[1]));
      ctx.lineTo(sx(c[2]), sy(c[3]));
      ctx.lineTo(sx(c[4]), sy(c[5]));
      ctx.lineTo(sx(c[6]), sy(c[7]));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // 7. Selected Spawns
  if (state.selection.spawns.length > 0) {
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2.5;
    for (const idx of state.selection.spawns) {
      const sp = map.spawnpoints[idx];
      if (!sp) continue;
      ctx.beginPath();
      ctx.arc(sx(sp.x), sy(sp.y), 13, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 8. Selected Colliders (showing player d/2 and bullet d/1.7 circles + rim handle)
  if (state.selection.colliders.length > 0) {
    for (const idx of state.selection.colliders) {
      const col = map.colliders[idx];
      if (!col) continue;
      const cx = sx(col.x);
      const cy = sy(col.y);
      const playerR = Math.max(2, Math.abs(col.radius) * 0.5) * zoom;
      const bulletR = Math.max(2, Math.abs(col.radius) / 1.7) * zoom;

      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, playerR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, bulletR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (state.selection.colliders.length === 1 && state.selectionSummary.totalObjects === 1) {
        ctx.fillStyle = '#fb7185';
        ctx.strokeStyle = '#09090b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx + playerR, cy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 9. Selected Waypoints
  if (state.selection.waypoints.length > 0) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.5;
    for (const idx of state.selection.waypoints) {
      const wp = map.waypoints[idx];
      if (!wp) continue;
      const wxScreen = sx(wp.x);
      const wyScreen = sy(wp.y);
      ctx.beginPath();
      ctx.arc(wxScreen, wyScreen, 11, 0, Math.PI * 2);
      ctx.stroke();

      for (const connOneBased of wp.connections) {
        const target = map.waypoints[connOneBased - 1];
        if (!target) continue;
        ctx.beginPath();
        ctx.moveTo(wxScreen, wyScreen);
        ctx.lineTo(sx(target.x), sy(target.y));
        ctx.stroke();
      }
    }
  }

  // 10. Transform Gizmo (in Select / Lasso / Vertex / Scenery tools)
  const showGizmo =
    (state.activeTool === 'select' ||
      state.activeTool === 'lasso' ||
      state.activeTool === 'vertex' ||
      state.activeTool === 'scenery') &&
    state.selectionSummary.bounds &&
    (state.selectionSummary.totalObjects > 0 || state.selectionSummary.vertexCount > 0);

  if (showGizmo && state.selectionSummary.bounds) {
    const singlePropObb = getSinglePropObbGizmo(
      map,
      state.selection,
      state.selectionSummary,
      Math.max(0.02, zoom || 0.5)
    );

    if (singlePropObb) {
      const c = singlePropObb.corners;
      const cx = sx(singlePropObb.center.x);
      const cy = sy(singlePropObb.center.y);
      const topMidX = sx(singlePropObb.topMid.x);
      const topMidY = sy(singlePropObb.topMid.y);
      const rotX = sx(singlePropObb.rot.x);
      const rotY = sy(singlePropObb.rot.y);

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(c[0]), sy(c[1]));
      ctx.lineTo(sx(c[2]), sy(c[3]));
      ctx.lineTo(sx(c[4]), sy(c[5]));
      ctx.lineTo(sx(c[6]), sy(c[7]));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Rotate stem & handle along local oriented top edge
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.moveTo(topMidX, topMidY);
      ctx.lineTo(rotX, rotY);
      ctx.stroke();

      ctx.fillStyle = '#0ea5e9';
      ctx.strokeStyle = '#09090b';
      ctx.beginPath();
      ctx.arc(rotX, rotY, ROTATE_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 8 Oriented Stretch / Scale handles
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.6;
      for (const [, hxW, hyW] of singlePropObb.handles) {
        const hx = sx(hxW);
        const hy = sy(hyW);
        ctx.fillRect(hx - HANDLE_HALF_PX, hy - HANDLE_HALF_PX, HANDLE_HALF_PX * 2, HANDLE_HALF_PX * 2);
        ctx.strokeRect(hx - HANDLE_HALF_PX, hy - HANDLE_HALF_PX, HANDLE_HALF_PX * 2, HANDLE_HALF_PX * 2);
      }

      // Center move crosshair
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
    } else {
      const b = state.selectionSummary.bounds;
      const x1 = sx(b.left);
      const y1 = sy(b.top);
      const x2 = sx(b.right);
      const y2 = sy(b.bottom);
      const cx = (x1 + x2) * 0.5;
      const cy = (y1 + y2) * 0.5;
      const hasExtent =
        b.width > 1 ||
        b.height > 1 ||
        state.selection.props.length > 0 ||
        state.selection.polygons.length > 0 ||
        state.selectionSummary.vertexCount > 1;

      if (hasExtent) {
        ctx.save();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();

        // Rotate stem & circle
        const rotY = y1 - ROTATE_STEM_PX;
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, y1);
        ctx.lineTo(cx, rotY);
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.strokeStyle = '#09090b';
        ctx.beginPath();
        ctx.arc(cx, rotY, ROTATE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 8 Scale handles
        const pts: Array<[number, number]> = [
          [x1, y1],
          [cx, y1],
          [x2, y1],
          [x2, cy],
          [x2, y2],
          [cx, y2],
          [x1, y2],
          [x1, cy],
        ];
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#09090b';
        ctx.lineWidth = 1.5;
        for (const [hx, hy] of pts) {
          ctx.fillRect(hx - HANDLE_HALF_PX, hy - HANDLE_HALF_PX, HANDLE_HALF_PX * 2, HANDLE_HALF_PX * 2);
          ctx.strokeRect(hx - HANDLE_HALF_PX, hy - HANDLE_HALF_PX, HANDLE_HALF_PX * 2, HANDLE_HALF_PX * 2);
        }
      }

      // Center pivot crosshair
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
    }
  }

  // 11. Smart Alignment Guides
  if (state.smartGuides.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const g of state.smartGuides) {
      if (g.axis === 'x') {
        const px = sx(g.coord);
        ctx.moveTo(px, sy(g.from) - 24);
        ctx.lineTo(px, sy(g.to) + 24);
      } else {
        const py = sy(g.coord);
        ctx.moveTo(sx(g.from) - 24, py);
        ctx.lineTo(sx(g.to) + 24, py);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // 12. Polygon Creation Draft Preview
  if (state.draftPoints.length > 0) {
    const pts = state.cursorWorld
      ? [...state.draftPoints, state.cursorWorld]
      : state.draftPoints;

    ctx.save();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.75;

    if (state.activeTool === 'poly_shape' && pts.length >= 3) {
      const tris = earClipTriangulate(pts);
      for (const [a, b, c] of tris) {
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.lineTo(sx(c.x), sy(c.y));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
        ctx.stroke();
      }
      ctx.strokeStyle = '#34d399';
      ctx.beginPath();
      ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(sx(pts[i].x), sy(pts[i].y));
      ctx.closePath();
      ctx.stroke();
    } else if (
      (state.activeTool === 'poly_tri' ||
        state.activeTool === 'poly_strip' ||
        state.activeTool === 'poly_fan') &&
      pts.length >= 2
    ) {
      if (pts.length >= 3) {
        const a = pts[pts.length - 3];
        const b = pts[pts.length - 2];
        const c = pts[pts.length - 1];
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.lineTo(sx(c.x), sy(c.y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
        ctx.lineTo(sx(pts[1].x), sy(pts[1].y));
        ctx.stroke();
      }
    } else if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
      ctx.lineTo(sx(pts[1].x), sy(pts[1].y));
      ctx.stroke();
    }

    ctx.fillStyle = '#34d399';
    for (const p of state.draftPoints) {
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 13. Brush / Light Radius Circle
  if (state.brushRadius && state.cursorWorld) {
    ctx.save();
    ctx.strokeStyle =
      state.activeTool === 'light' ? 'rgba(250, 204, 21, 0.85)' : 'rgba(56, 189, 248, 0.85)';
    ctx.fillStyle =
      state.activeTool === 'light' ? 'rgba(250, 204, 21, 0.08)' : 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(
      sx(state.cursorWorld.x),
      sy(state.cursorWorld.y),
      Math.max(4, state.brushRadius * zoom),
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 14. Ghost Stamp Bounds / Oriented Scenery Quad (Scenery / Prefab placement preview)
  if (state.ghostPropQuad) {
    const q = state.ghostPropQuad;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(sx(q[0]), sy(q[1]));
    ctx.lineTo(sx(q[2]), sy(q[3]));
    ctx.lineTo(sx(q[4]), sy(q[5]));
    ctx.lineTo(sx(q[6]), sy(q[7]));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (state.ghostBounds) {
    const gb = state.ghostBounds;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    const gx = sx(gb.left);
    const gy = sy(gb.top);
    const gw = gb.width * pxPerX;
    const gh = gb.height * pxPerY;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.restore();
  }

  // 15. Box Marquee Selection
  if (state.marqueeBox) {
    const mx1 = sx(Math.min(state.marqueeBox.x1, state.marqueeBox.x2));
    const my1 = sy(Math.min(state.marqueeBox.y1, state.marqueeBox.y2));
    const mx2 = sx(Math.max(state.marqueeBox.x1, state.marqueeBox.x2));
    const my2 = sy(Math.max(state.marqueeBox.y1, state.marqueeBox.y2));
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.fillRect(mx1, my1, mx2 - mx1, my2 - my1);
    ctx.strokeRect(mx1, my1, mx2 - mx1, my2 - my1);
    ctx.restore();
  }

  // 16. Lasso Selection Contour
  if (state.lassoPoints && state.lassoPoints.length >= 2) {
    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(sx(state.lassoPoints[0].x), sy(state.lassoPoints[0].y));
    for (let i = 1; i < state.lassoPoints.length; i++) {
      ctx.lineTo(sx(state.lassoPoints[i].x), sy(state.lassoPoints[i].y));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 16b. Laser Polygon Drawing Beam & Triangulation Preview
  if (state.laserPoints && state.laserPoints.length >= 2) {
    ctx.save();
    if (state.laserPreviewContour && state.laserPreviewContour.length >= 3) {
      const tris = earClipTriangulate(state.laserPreviewContour);
      ctx.fillStyle = 'rgba(244, 63, 94, 0.18)';
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.45)';
      ctx.lineWidth = 1;
      for (const [a, b, c] of tris) {
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.lineTo(sx(c.x), sy(c.y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#fda4af';
      for (const pt of state.laserPreviewContour) {
        ctx.beginPath();
        ctx.arc(sx(pt.x), sy(pt.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Outer laser glow + core beam
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.38)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(sx(state.laserPoints[0].x), sy(state.laserPoints[0].y));
    for (let i = 1; i < state.laserPoints.length; i++) {
      ctx.lineTo(sx(state.laserPoints[i].x), sy(state.laserPoints[i].y));
    }
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // 16c. Live Soldier Physics & Jetpack Playtest Overlay
  if (state.playtest && state.playtest.active) {
    const pt = state.playtest;
    ctx.save();

    // Trajectory trail (pt.x, pt.y is body center)
    if (pt.trail.length >= 2) {
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.5)';
      ctx.lineWidth = 1.75;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(pt.trail[0].x), sy(pt.trail[0].y));
      for (let i = 1; i < pt.trail.length; i++) {
        ctx.lineTo(sx(pt.trail[i].x), sy(pt.trail[i].y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const halfBodyWorld = pt.crouching ? 4.75 : 7;
    const footX = sx(pt.x);
    const footY = sy(pt.y + halfBodyWorld);
    const bodyH = halfBodyWorld * 2 * pxPerY;
    const halfW = Math.max(3, 3.5 * pxPerX);
    const headR = Math.max(2.5, 2.8 * zoom);

    // Jetpack flame plume
    if (pt.jetpacking && pt.jetFuel > 0) {
      ctx.fillStyle = 'rgba(251, 146, 60, 0.88)';
      ctx.beginPath();
      ctx.moveTo(footX - halfW * 0.7, footY);
      ctx.lineTo(footX + halfW * 0.7, footY);
      ctx.lineTo(footX - pt.facing * halfW * 0.4, footY + Math.max(8, 13 * zoom));
      ctx.closePath();
      ctx.fill();
    }

    // Hazard / Regen aura
    if (pt.hazardState !== 'none') {
      ctx.strokeStyle =
        pt.hazardState === 'regen'
          ? '#34d399'
          : pt.hazardState === 'hurts'
          ? '#fb923c'
          : '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(footX, footY - bodyH * 0.5, Math.max(12, 11 * zoom), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Soldier capsule body (Alpha red / Bravo blue)
    const teamFill =
      pt.team === 1
        ? '#f43f5e'
        : pt.team === 2
        ? '#38bdf8'
        : pt.team === 3
        ? '#facc15'
        : '#34d399';
    ctx.fillStyle = teamFill;
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(footX - halfW, footY - bodyH, halfW * 2, bodyH, Math.min(halfW, 6));
    ctx.fill();
    ctx.stroke();

    // Head & aim direction tick
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(footX, footY - bodyH - headR * 0.75, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Flag banner when carrying flag
    if (pt.carryingFlag) {
      ctx.strokeStyle = '#f8fafc';
      ctx.fillStyle = pt.team === 1 ? '#38bdf8' : '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(footX - pt.facing * halfW, footY - bodyH * 0.6);
      ctx.lineTo(footX - pt.facing * halfW, footY - bodyH - 12);
      ctx.stroke();
      ctx.fillRect(footX - pt.facing * halfW, footY - bodyH - 12, -pt.facing * 9, 6);
    }

    // Overhead Jetpack fuel bar
    if (pt.maxJetFuel > 0) {
      const barW = 28;
      const barH = 4;
      const bx = footX - barW * 0.5;
      const by = footY - bodyH - headR * 2 - 9;
      const pct = Math.max(0, Math.min(1, pt.jetFuel / pt.maxJetFuel));
      ctx.fillStyle = 'rgba(9, 9, 11, 0.8)';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = pct > 0.25 ? '#38bdf8' : '#fb923c';
      ctx.fillRect(bx, by, barW * pct, barH);
    }

    ctx.restore();
  }

  // 17. Snap Indicator
  if (state.snapIndicator) {
    const px = sx(state.snapIndicator.x);
    const py = sy(state.snapIndicator.y);
    ctx.save();
    ctx.lineWidth = 2;
    if (state.snapIndicator.kind === 'vertex') {
      ctx.strokeStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(px, py - 7);
      ctx.lineTo(px + 7, py);
      ctx.lineTo(px, py + 7);
      ctx.lineTo(px - 7, py);
      ctx.closePath();
      ctx.stroke();
    } else if (state.snapIndicator.kind === 'edge') {
      ctx.strokeStyle = '#fb923c';
      ctx.strokeRect(px - 5, py - 5, 10, 10);
    } else if (state.snapIndicator.kind === 'guide') {
      ctx.strokeStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
      ctx.beginPath();
      ctx.moveTo(px - 5, py);
      ctx.lineTo(px + 5, py);
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px, py + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 18. Validation Issue Focus Ring
  if (state.validationFocus) {
    const fx = sx(state.validationFocus.x);
    const fy = sy(state.validationFocus.y);
    const r = Math.max(18, (state.validationFocus.radius ?? 24) * zoom);
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}
