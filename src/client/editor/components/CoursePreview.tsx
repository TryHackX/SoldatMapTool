import { useEffect, useRef } from 'react';
import type { PmsMapData } from '@shared/pmsParser';
import { t } from '../../i18n';

export function CoursePreview({ map, trace }: { map: PmsMapData; trace?: readonly { x: number; y: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const b = { ...map.fullBounds };
    for (const point of trace ?? []) {
      b.top = Math.min(b.top, point.y); b.bottom = Math.max(b.bottom, point.y);
      b.left = Math.min(b.left, point.x); b.right = Math.max(b.right, point.x);
    }
    b.width = b.right - b.left; b.height = b.bottom - b.top;
    const scale = Math.min(584 / Math.max(1, b.width), 112 / Math.max(1, b.height));
    const x = (n: number) => 300 + (n - (b.left + b.right) / 2) * scale;
    const y = (n: number) => 64 + (n - (b.top + b.bottom) / 2) * scale;
    ctx.clearRect(0, 0, 600, 128);
    for (const poly of map.polygons) {
      const [a,b,c]=poly.vertices.map(v=>v.color);
      ctx.fillStyle = `rgb(${Math.round((a.r+b.r+c.r)/3)} ${Math.round((a.g+b.g+c.g)/3)} ${Math.round((a.b+b.b+c.b)/3)})`;
      ctx.beginPath();
      poly.vertices.forEach((v, i) => i ? ctx.lineTo(x(v.x), y(v.y)) : ctx.moveTo(x(v.x), y(v.y)));
      ctx.fill();
    }
    if (trace?.length) {
      ctx.strokeStyle = '#a7f3d0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      trace.forEach((p, i) => i ? ctx.lineTo(x(p.x), y(p.y)) : ctx.moveTo(x(p.x), y(p.y)));
      ctx.stroke();
    }
    for (const s of map.spawnpoints) {
      ctx.fillStyle = s.team === 2 || s.team === 6 ? '#60a5fa' : '#fb7185';
      ctx.fillRect(x(s.x) - 2, y(s.y) - 2, 4, 4);
    }
  }, [map, trace]);
  return <canvas ref={ref} width={600} height={128} aria-label={t('Terrain preview')} className="w-full bg-zinc-950 rounded border border-zinc-800" />;
}
