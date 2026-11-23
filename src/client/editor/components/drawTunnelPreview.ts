import type { TunnelPoint, TunnelResult } from '@shared/climbTunnel';
import type { PmsMapData } from '@shared/pmsParser';
import type { TunnelTrialResult } from '../tunnelTrial';

type TerrainPreview = Pick<TunnelResult, 'background' | 'centerline' | 'polygons' | 'spawnpoints'>;
type Context = Pick<PmsMapData, 'polygons' | 'colliders'>;

export function drawTunnelPreview(canvas: HTMLCanvasElement, draft: TerrainPreview, line: boolean, trial: TunnelTrialResult | null, contextMap?: Context, axisPadding?: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width, height = canvas.height;
  const color = (c: { r: number; g: number; b: number }) => `rgb(${c.r},${c.g},${c.b})`;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, color(draft.background.top)); bg.addColorStop(1, color(draft.background.bottom));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  if (!draft.polygons.length) return;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  function include(v: TunnelPoint) {
    left = Math.min(left, v.x); right = Math.max(right, v.x); top = Math.min(top, v.y); bottom = Math.max(bottom, v.y);
  }
  if (axisPadding !== undefined && draft.centerline.length) {
    draft.centerline.forEach(include);
    left -= axisPadding; right += axisPadding; top -= axisPadding; bottom += axisPadding;
  } else {
    for (const p of draft.polygons) for (const v of p.vertices) include(v);
  }
  const k = Math.min((width - 40) / Math.max(1, right - left), (height - 36) / Math.max(1, bottom - top));
  const x = (n: number) => (n - (left + right) / 2) * k + width / 2, y = (n: number) => (n - (top + bottom) / 2) * k + height / 2;
  for (const { vertices: [a, b, c] } of draft.polygons) {
    if (axisPadding !== undefined && (Math.max(a.x,b.x,c.x) < left || Math.min(a.x,b.x,c.x) > right ||
      Math.max(a.y,b.y,c.y) < top || Math.min(a.y,b.y,c.y) > bottom)) continue;
    ctx.fillStyle = color({
      r: Math.round((a.color.r + b.color.r + c.color.r) / 3),
      g: Math.round((a.color.g + b.color.g + c.color.g) / 3), b: Math.round((a.color.b + b.color.b + c.color.b) / 3)
    });
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.55;
    ctx.beginPath(); ctx.moveTo(x(a.x), y(a.y)); ctx.lineTo(x(b.x), y(b.y)); ctx.lineTo(x(c.x), y(c.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (contextMap) {
    ctx.fillStyle = 'rgba(216,201,166,0.48)';
    for (const { vertices: [a, b, c] } of contextMap.polygons) {
      if (Math.max(a.x, b.x, c.x) < left || Math.min(a.x, b.x, c.x) > right ||
        Math.max(a.y, b.y, c.y) < top || Math.min(a.y, b.y, c.y) > bottom) continue;
      ctx.beginPath();
      ctx.moveTo(x(a.x), y(a.y));
      ctx.lineTo(x(b.x), y(b.y));
      ctx.lineTo(x(c.x), y(c.y));
      ctx.closePath();
      ctx.fill();
    }
    for (const c of contextMap.colliders) {
      if (!c.active || c.radius <= 0) continue;
      ctx.beginPath();
      ctx.arc(x(c.x), y(c.y), c.radius * k / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function stroke(points: readonly TunnelPoint[], color: string, dashed: boolean) {
    if (!ctx || !points.length) return;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.setLineDash(dashed ? [4, 5] : []);
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(x(p.x), y(p.y)) : ctx.moveTo(x(p.x), y(p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (line) stroke(draft.centerline, '#a5f3fc', true);
  if (trial?.trace.length) {
    stroke(trial.trace, trial.reached ? '#a7f3d0' : '#ffcf86', false);
    if (!trial.reached) {
      const stop = trial.trace[trial.trace.length - 1];
      ctx.fillStyle = '#ffcf86';
      ctx.strokeStyle = '#422006';
      ctx.beginPath();
      ctx.arc(x(stop.x), y(stop.y), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  for (const s of draft.spawnpoints.filter(s => s.team === 1 || s.team === 6)) {
    ctx.fillStyle = s.team === 1 ? '#ff9c99' : '#87c9ff'; ctx.strokeStyle = '#11202a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x(s.x), y(s.y), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}
