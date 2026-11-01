import { PmsMapData } from '@shared/pmsParser';
import { POLY_TYPES, SPAWN_TYPES } from '@shared/soldatConstants';
import { ObjectSpritesBundle } from './assetLoader';
import { RenderLayerVisibility } from './types';

export interface RulerMeasurement {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OverlayRenderOptions {
  bounds: { left: number; right: number; top: number; bottom: number };
  layers: RenderLayerVisibility;
  sprites: ObjectSpritesBundle | null;
  ruler?: RulerMeasurement | null;
  fixedWorldScale?: boolean; // True when baking 100% tiled screenshots so markers have deterministic world size
  highlightOutline?: number[] | null; // World-space polygon [x0, y0, x1, y1, ...] of the inspected object
}

export function renderMapOverlays(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  map: PmsMapData,
  opts: OverlayRenderOptions
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const { bounds, layers, sprites, ruler, fixedWorldScale } = opts;
  const worldW = bounds.right - bounds.left;
  const worldH = bounds.bottom - bounds.top;
  if (worldW <= 0 || worldH <= 0) return;

  const pxPerWorldX = canvasWidth / worldW;
  const pxPerWorldY = canvasHeight / worldH;
  const zoom = (pxPerWorldX + pxPerWorldY) * 0.5;

  const toScreenX = (wx: number) => (wx - bounds.left) * pxPerWorldX;
  const toScreenY = (wy: number) => (wy - bounds.top) * pxPerWorldY;

  // Marker scale factor: in interactive mode, clamp slightly so icons remain readable when zoomed way out
  const markerScale = fixedWorldScale
    ? Math.max(0.75, zoom)
    : Math.max(0.65, Math.min(1.5, Math.pow(zoom, 0.35)));

  // 1. Sectors Grid & Map Bounds
  if (layers.showGrid) {
    ctx.save();
    const baseDiv = Math.max(32, map.sectorsDivision || 128);
    let div = baseDiv;
    while (worldW / div > 220 || worldH / div > 220) {
      div *= 2;
    }
    const startX = Math.floor(bounds.left / div) * div;
    const endX = Math.ceil(bounds.right / div) * div;
    const startY = Math.floor(bounds.top / div) * div;
    const endY = Math.ceil(bounds.bottom / div) * div;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = startX; gx <= endX; gx += div) {
      const sx = toScreenX(gx);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvasHeight);
    }
    for (let gy = startY; gy <= endY; gy += div) {
      const sy = toScreenY(gy);
      ctx.moveTo(0, sy);
      ctx.lineTo(canvasWidth, sy);
    }
    ctx.stroke();

    // Origin (0,0) axes
    const ox = toScreenX(0);
    const oy = toScreenY(0);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, canvasHeight);
    ctx.moveTo(0, oy);
    ctx.lineTo(canvasWidth, oy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Polygon bounds box
    const pb = map.polyBounds;
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      toScreenX(pb.left),
      toScreenY(pb.top),
      pb.width * pxPerWorldX,
      pb.height * pxPerWorldY
    );
    ctx.restore();
  }

  // 2. Wireframe
  if (layers.showWireframe) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const poly of map.polygons) {
      const [v1, v2, v3] = poly.vertices;
      ctx.moveTo(toScreenX(v1.x), toScreenY(v1.y));
      ctx.lineTo(toScreenX(v2.x), toScreenY(v2.y));
      ctx.lineTo(toScreenX(v3.x), toScreenY(v3.y));
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  // 3. Special Polygon Physics Types
  if (layers.showPolyTypes) {
    ctx.save();
    for (const poly of map.polygons) {
      const meta = POLY_TYPES[poly.polyType];
      if (!meta || !meta.isSpecial) continue;

      const [v1, v2, v3] = poly.vertices;
      const sx1 = toScreenX(v1.x);
      const sy1 = toScreenY(v1.y);
      const sx2 = toScreenX(v2.x);
      const sy2 = toScreenY(v2.y);
      const sx3 = toScreenX(v3.x);
      const sy3 = toScreenY(v3.y);

      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.lineTo(sx3, sy3);
      ctx.closePath();

      ctx.fillStyle = hexToRgba(meta.color, 0.36);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(meta.color, 0.92);
      ctx.lineWidth = Math.max(1.2, 1.6 * markerScale);
      ctx.stroke();

      // Show bouncy multiplier when reasonably zoomed in
      if (poly.polyType === 18 && zoom >= 0.45 && poly.bounciness > 0.05) {
        const cx = (sx1 + sx2 + sx3) / 3;
        const cy = (sy1 + sy2 + sy3) / 3;
        ctx.font = `600 ${Math.round(10 * markerScale)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const txt = `${poly.bounciness.toFixed(1)}x`;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillText(txt, cx + 1, cy + 1);
        ctx.fillStyle = '#fdf2f8';
        ctx.fillText(txt, cx, cy);
      }
    }
    ctx.restore();
  }

  // 4. Colliders
  if (layers.showColliders) {
    ctx.save();
    for (const col of map.colliders) {
      if (!col.active) continue;
      const sx = toScreenX(col.x);
      const sy = toScreenY(col.y);
      // Editor / player radius = diameter / 2; bullet collision radius = diameter / 1.7
      const editorR = Math.max(2, (col.radius * 0.5) * zoom);
      const bulletR = Math.max(2, (col.radius / 1.7) * zoom);

      // Fill editor circle
      ctx.beginPath();
      ctx.arc(sx, sy, editorR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.92)';
      ctx.lineWidth = Math.max(1.5, 1.8 * markerScale);
      ctx.stroke();

      // Outer bullet collision ring
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.arc(sx, sy, bulletR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Center crosshair
      const ch = Math.max(3, 4 * markerScale);
      ctx.beginPath();
      ctx.moveTo(sx - ch, sy);
      ctx.lineTo(sx + ch, sy);
      ctx.moveTo(sx, sy - ch);
      ctx.lineTo(sx, sy + ch);
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. Bot Waypoints & Connections
  if (layers.showWaypoints && map.waypoints.length > 0) {
    ctx.save();
    // Soldat copies waypoints into BotPath.Waypoint[1..N] and connections address that 1-based array index
    const byId = new Map<number, (typeof map.waypoints)[0]>();
    for (const wp of map.waypoints) {
      if (wp.active) byId.set(wp.index, wp);
    }

    // Connections first
    ctx.lineWidth = Math.max(1, 1.2 * markerScale);
    for (const wp of map.waypoints) {
      if (!wp.active) continue;
      const x1 = toScreenX(wp.x);
      const y1 = toScreenY(wp.y);

      for (const targetId of wp.connections) {
        const target = byId.get(targetId);
        if (!target || !target.active) continue;
        const x2 = toScreenX(target.x);
        const y2 = toScreenY(target.y);

        ctx.strokeStyle =
          wp.pathNum === 1
            ? 'rgba(248, 113, 113, 0.55)'
            : wp.pathNum === 2
            ? 'rgba(96, 165, 250, 0.55)'
            : 'rgba(250, 204, 21, 0.45)';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Arrowhead at 70% along segment
        const dist = Math.hypot(x2 - x1, y2 - y1);
        if (dist > 14) {
          const mx = x1 + (x2 - x1) * 0.7;
          const my = y1 + (y2 - y1) * 0.7;
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const ah = Math.max(3.5, 4.5 * markerScale);
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx - ah * Math.cos(ang - 0.5), my - ah * Math.sin(ang - 0.5));
          ctx.moveTo(mx, my);
          ctx.lineTo(mx - ah * Math.cos(ang + 0.5), my - ah * Math.sin(ang + 0.5));
          ctx.stroke();
        }
      }
    }

    // Waypoint nodes
    const r = Math.max(2.5, 3.5 * markerScale);
    for (const wp of map.waypoints) {
      if (!wp.active) continue;
      const sx = toScreenX(wp.x);
      const sy = toScreenY(wp.y);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle =
        wp.jetpack
          ? '#38bdf8'
          : wp.pathNum === 1
          ? '#ef4444'
          : wp.pathNum === 2
          ? '#3b82f6'
          : '#facc15';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. Player Spawns (Teams 0..4)
  if (layers.showSpawns) {
    ctx.save();
    for (const sp of map.spawnpoints) {
      if (!sp.active || sp.team < 0 || sp.team > 4) continue;
      const meta = SPAWN_TYPES[sp.team];
      if (!meta) continue;

      const sx = toScreenX(sp.x);
      const sy = toScreenY(sp.y);
      const rad = 9.5 * markerScale;

      // Outer dark halo
      ctx.beginPath();
      ctx.arc(sx, sy, rad + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.82)';
      ctx.fill();

      // Team ring
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(meta.color, 0.28);
      ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = Math.max(1.5, 2 * markerScale);
      ctx.stroke();

      // Label
      ctx.font = `700 ${Math.max(8, Math.round(9 * markerScale))}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(meta.shortLabel, sx, sy + 0.5);
    }
    ctx.restore();
  }

  // 7. Bonuses, Medikits, Grenades & Special Weapons (Teams 7..13, 15, 16)
  if (layers.showBonuses) {
    ctx.save();
    for (const sp of map.spawnpoints) {
      if (!sp.active) continue;
      const meta = SPAWN_TYPES[sp.team];
      if (!meta || (meta.category !== 'bonus' && meta.category !== 'weapon')) continue;

      const sx = toScreenX(sp.x);
      const sy = toScreenY(sp.y);
      const boxSize = Math.round(20 * markerScale);
      const half = boxSize / 2;

      // Rounded tactical backdrop pill
      drawRoundedRect(ctx, sx - half - 2, sy - half - 2, boxSize + 4, boxSize + 4, 5 * markerScale);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.82)';
      ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = Math.max(1.3, 1.7 * markerScale);
      ctx.stroke();

      const sprite = getBonusSprite(sprites, sp.team);
      if (sprite) {
        // Preserve aspect ratio for wide weapon sprites (Rambo Bow / Stationary Gun M2)
        const sw = sprite.width || boxSize;
        const sh = sprite.height || boxSize;
        const aspect = sw / sh;
        let dw = boxSize;
        let dh = boxSize;
        if (aspect > 1.35) {
          dw = Math.round(boxSize * Math.min(1.65, aspect * 0.7));
          dh = Math.max(8, Math.round(dw / aspect));
        } else if (aspect < 0.75) {
          dh = boxSize;
          dw = Math.max(8, Math.round(dh * aspect));
        }
        ctx.drawImage(sprite, sx - dw / 2, sy - dh / 2, dw, dh);
      } else {
        ctx.font = `700 ${Math.max(8, Math.round(8.5 * markerScale))}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = meta.color;
        ctx.fillText(meta.shortLabel, sx, sy + 0.5);
      }

      // Label tag underneath when zoomed in
      if (zoom >= 0.55) {
        const tagFont = Math.max(8, Math.round(8.5 * markerScale));
        ctx.font = `600 ${tagFont}px "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelY = sy + half + 4;
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillText(meta.shortLabel, sx + 1, labelY + 1);
        ctx.fillStyle = meta.color;
        ctx.fillText(meta.shortLabel, sx, labelY);
      }
    }
    ctx.restore();
  }

  // 8. Flags (Alpha = 5, Bravo = 6, Yellow PM/HTF = 14)
  if (layers.showFlags) {
    ctx.save();
    for (const sp of map.spawnpoints) {
      if (!sp.active) continue;
      if (sp.team !== 5 && sp.team !== 6 && sp.team !== 14) continue;
      const meta = SPAWN_TYPES[sp.team];
      if (!meta) continue;

      const sx = toScreenX(sp.x);
      const sy = toScreenY(sp.y);
      const poleH = 30 * markerScale;
      const flagW = 22 * markerScale;
      const flagH = 14 * markerScale;

      // Glowing base ring at exact spawn coordinate
      ctx.beginPath();
      ctx.arc(sx, sy, 6 * markerScale, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(meta.color, 0.35);
      ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 2 * markerScale;
      ctx.stroke();

      // Flagpole shadow & pole
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - poleH);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3.5 * markerScale;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - poleH);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.8 * markerScale;
      ctx.stroke();

      // Draw Soldat flag sprite or crisp vector banner
      const flagSprite =
        sp.team === 5
          ? sprites?.alphaFlag
          : sp.team === 6
          ? sprites?.bravoFlag
          : sprites?.yellowFlag;

      if (flagSprite) {
        ctx.drawImage(flagSprite, sx + 1, sy - poleH, flagW, flagH * 1.25);
      } else {
        ctx.beginPath();
        ctx.moveTo(sx, sy - poleH);
        ctx.lineTo(sx + flagW, sy - poleH + flagH * 0.5);
        ctx.lineTo(sx, sy - poleH + flagH);
        ctx.closePath();
        ctx.fillStyle = meta.color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Badge label above pole
      const badgeText = sp.team === 5 ? 'ALPHA' : sp.team === 6 ? 'BRAVO' : 'FLAGA';
      ctx.font = `700 ${Math.max(9, Math.round(9.5 * markerScale))}px "Inter", sans-serif`;
      const tw = ctx.measureText(badgeText).width + 10 * markerScale;
      const th = 15 * markerScale;
      const bx = sx - tw / 2;
      const by = sy - poleH - th - 4 * markerScale;

      drawRoundedRect(ctx, bx, by, tw, th, 4 * markerScale);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.88)';
      ctx.fill();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.4 * markerScale;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = meta.color;
      ctx.fillText(badgeText, sx, by + th / 2 + 0.5);
    }
    ctx.restore();
  }

  // 9. Inspected object outline (prop quad or polygon triangle)
  const outline = opts.highlightOutline;
  if (outline && outline.length >= 6) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(toScreenX(outline[0]), toScreenY(outline[1]));
    for (let i = 2; i < outline.length; i += 2) {
      ctx.lineTo(toScreenX(outline[i]), toScreenY(outline[i + 1]));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(217, 70, 239, 0.12)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = '#e879f9';
    ctx.stroke();
    ctx.restore();
  }

  // 10. Interactive Ruler Measurement
  if (ruler) {
    ctx.save();
    const sx1 = toScreenX(ruler.x1);
    const sy1 = toScreenY(ruler.y1);
    const sx2 = toScreenX(ruler.x2);
    const sy2 = toScreenY(ruler.y2);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const [px, py] of [
      [sx1, sy1],
      [sx2, sy2],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const dx = Math.round(ruler.x2 - ruler.x1);
    const dy = Math.round(ruler.y2 - ruler.y1);
    const dist = Math.round(Math.hypot(dx, dy));
    const label = `${dist} px  (ΔX: ${dx}, ΔY: ${dy})`;

    const mx = (sx1 + sx2) * 0.5;
    const my = (sy1 + sy2) * 0.5 - 14;
    ctx.font = '600 11px "JetBrains Mono", monospace';
    const w = ctx.measureText(label).width + 14;
    drawRoundedRect(ctx, mx - w / 2, my - 11, w, 22, 5);
    ctx.fillStyle = 'rgba(9, 9, 11, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = '#ecfdf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, mx, my);
    ctx.restore();
  }
}

function getBonusSprite(sprites: ObjectSpritesBundle | null, team: number): HTMLCanvasElement | null {
  if (!sprites) return null;
  switch (team) {
    case 7:
      return sprites.grenadekit;
    case 8:
      return sprites.medikit;
    case 9:
      return sprites.clusterkit;
    case 10:
      return sprites.vestkit;
    case 11:
      return sprites.flamerkit;
    case 12:
      return sprites.berserkerkit;
    case 13:
      return sprites.predatorkit;
    case 15:
      return sprites.bow;
    case 16:
      return sprites.stationaryGun;
    default:
      return null;
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
