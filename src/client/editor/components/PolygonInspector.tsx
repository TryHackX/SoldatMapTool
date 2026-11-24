import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine } from 'lucide-react';
import { useState } from 'react';
import { rebuildPolygonGeometry } from '@shared/pmsCompiler';
import type { PmsMapData, PmsVertex } from '@shared/pmsParser';
import { POLY_TYPES, type RgbaColor } from '@shared/soldatConstants';
import { t,polyTypeName } from '../../i18n';
import { rgbToHex, hexToRgb } from '../colorTools';
import type { EditorSelection, SelectionSummary } from '../types';
import { EditorColorInput, NumberInput } from './EditorFields';
import { PanelCard } from './EditorPanelCard';
import type { EditorRightDockProps } from './EditorRightDock';

export function usePolygonColorInspector(map:PmsMapData, selection:EditorSelection, selectionSummary:SelectionSummary,
  onCommitMutation:EditorRightDockProps['onCommitMutation']) {
  const [gradStartHex, setGradStartHex] = useState('#ffffff');
  const [gradEndHex, setGradEndHex] = useState('#334155');
  const [gradDir, setGradDir] = useState<'tb' | 'bt' | 'lr' | 'rl'>('tb');

  const applyLinearGradient = () => {
    const startCol = hexToRgb(gradStartHex, 255);
    const endCol = hexToRgb(gradEndHex, 255);
    const targetMap = new Map<number, Set<0 | 1 | 2>>();
    for (const pi of selection.polygons) {
      targetMap.set(pi, new Set([0, 1, 2]));
    }
    for (const vr of selection.vertices) {
      const s = targetMap.get(vr.polyIndex) ?? new Set<0 | 1 | 2>();
      s.add(vr.vertexIndex);
      targetMap.set(vr.polyIndex, s);
    }
    if (targetMap.size === 0 || !selectionSummary.bounds) return;

    const b = selectionSummary.bounds;
    const spanX = Math.max(1, b.right - b.left);
    const spanY = Math.max(1, b.bottom - b.top);
    const nextPolygons = [...map.polygons];

    for (const [pi, vSet] of targetMap.entries()) {
      const orig = nextPolygons[pi];
      if (!orig) continue;
      const nextVerts = orig.vertices.map((v, vi) => {
        if (!vSet.has(vi as 0 | 1 | 2)) return v;
        let k = 0;
        if (gradDir === 'tb') k = (v.y - b.top) / spanY;
        else if (gradDir === 'bt') k = 1 - (v.y - b.top) / spanY;
        else if (gradDir === 'lr') k = (v.x - b.left) / spanX;
        else k = 1 - (v.x - b.left) / spanX;
        k = Math.max(0, Math.min(1, k));
        return {
          ...v,
          color: {
            r: Math.round(startCol.r + (endCol.r - startCol.r) * k),
            g: Math.round(startCol.g + (endCol.g - startCol.g) * k),
            b: Math.round(startCol.b + (endCol.b - startCol.b) * k),
            a: v.color.a,
          },
        };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      // Colour / texture-only edit: keeping `raw` keeps the file's collision normals (see prepareMapForSave)
      nextPolygons[pi] = { ...orig, vertices: nextVerts };
    }
    onCommitMutation('Apply vertex color gradient', { ...map, polygons: nextPolygons });
  };

  const applyVertexColorToSelection = (nextColor: Partial<RgbaColor>) => {
    const targetMap = new Map<number, Set<0 | 1 | 2>>();
    for (const pi of selection.polygons) targetMap.set(pi, new Set([0, 1, 2]));
    for (const vr of selection.vertices) {
      const s = targetMap.get(vr.polyIndex) ?? new Set<0 | 1 | 2>();
      s.add(vr.vertexIndex);
      targetMap.set(vr.polyIndex, s);
    }
    if (targetMap.size === 0) return;

    const nextPolygons = [...map.polygons];
    for (const [pi, vSet] of targetMap.entries()) {
      const orig = nextPolygons[pi];
      if (!orig) continue;
      const nextVerts = orig.vertices.map((v, vi) => {
        if (!vSet.has(vi as 0 | 1 | 2)) return v;
        return {
          ...v,
          color: {
            r: nextColor.r ?? v.color.r,
            g: nextColor.g ?? v.color.g,
            b: nextColor.b ?? v.color.b,
            a: nextColor.a ?? v.color.a,
          },
        };
      }) as [PmsVertex, PmsVertex, PmsVertex];
      // Colour / texture-only edit: keeping `raw` keeps the file's collision normals (see prepareMapForSave)
      nextPolygons[pi] = { ...orig, vertices: nextVerts };
    }
    onCommitMutation('Set vertex color', { ...map, polygons: nextPolygons }, undefined, 'prop_vcolor');
  };

  return {gradStartHex,setGradStartHex,gradEndHex,setGradEndHex,gradDir,setGradDir,applyLinearGradient,applyVertexColorToSelection};
}

type Props = Pick<EditorRightDockProps,'snapshot'|'onCommitMutation'|'onPolygonDrawOrder'|'onResetPolygonUv'|'onFlipPolygonWinding'> & {
  colors:ReturnType<typeof usePolygonColorInspector>;
};

export function PolygonInspector({snapshot,colors,onCommitMutation,onPolygonDrawOrder,onResetPolygonUv,onFlipPolygonWinding}:Props) {
  const {map,selection}=snapshot;
  const selectedPolys=selection.polygons.map(i=>map.polygons[i]).filter(Boolean);
  const {gradStartHex,setGradStartHex,gradEndHex,setGradEndHex,gradDir,setGradDir,applyLinearGradient,applyVertexColorToSelection}=colors;
  return <>
    {(selectedPolys.length > 0 || selection.vertices.length > 0) && (
      <PanelCard
        title={
          selectedPolys.length > 0
            ? t('Polygons ({count})', { count: selectedPolys.length })
            : t('Vertices ({count})', { count: selection.vertices.length })
        }
      >
        {selectedPolys.length > 0 && (
          <>
            {/* Draw order: later polygons are drawn over earlier ones */}
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  ['front', t('Bring to front'), <ArrowUpToLine key="f" className="w-3.5 h-3.5" />],
                  ['forward', t('Step forward'), <ArrowUp key="u" className="w-3.5 h-3.5" />],
                  ['backward', t('Step backward'), <ArrowDown key="d" className="w-3.5 h-3.5" />],
                  ['back', t('Send to back'), <ArrowDownToLine key="b" className="w-3.5 h-3.5" />],
                ] as const
              ).map(([dir, title, icon]) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => onPolygonDrawOrder(dir)}
                  title={title}
                  className="py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center cursor-pointer"
                >
                  {icon}
                </button>
              ))}
            </div>
            <label className="space-y-1 block">
              <span className="text-zinc-400 text-[11px]">{t('Polygon type (0–25)')}</span>
              <select
                value={selectedPolys.every((o) => o.polyType === selectedPolys[0].polyType) ? selectedPolys[0].polyType : ''}
                onChange={(e) => {
                  const nextType = Number(e.target.value);
                  const nextPolygons = [...map.polygons];
                  for (const pi of selection.polygons) {
                    const orig = nextPolygons[pi];
                    if (!orig) continue;
                    nextPolygons[pi] = rebuildPolygonGeometry(
                      {
                        ...orig,
                        polyType: nextType,
                        bounciness:
                          nextType === 18 && orig.bounciness <= 0 ? 1.5 : orig.bounciness,
                        raw: undefined,
                      },
                      { enforceCw: false }
                    );
                  }
                  onCommitMutation('Change polygon type', { ...map, polygons: nextPolygons });
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
              >
                {!selectedPolys.every((o) => o.polyType === selectedPolys[0].polyType) && (
                  <option value="" disabled>
                    {t('— mixed —')}
                  </option>
                )}
                {Object.values(POLY_TYPES).map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.id}: {polyTypeName(pt)}
                  </option>
                ))}
              </select>
            </label>

            {selectedPolys.some((p) => p.polyType === 18) && (
              <label className="flex items-center justify-between gap-2">
                <span className="text-zinc-400 text-[11px]">{t('Bounciness')}</span>
                <NumberInput
                  step={0.1}
                  min={0}
                  max={20}
                  value={selectedPolys.find((p) => p.polyType === 18)?.bounciness ?? 1.5}
                  mixed={new Set(selectedPolys.filter((p) => p.polyType === 18).map((p) => p.bounciness)).size > 1}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value));
                    const nextPolygons = [...map.polygons];
                    for (const pi of selection.polygons) {
                      const orig = nextPolygons[pi];
                      if (!orig || orig.polyType !== 18) continue;
                      nextPolygons[pi] = rebuildPolygonGeometry(
                        { ...orig, bounciness: val, raw: undefined },
                        { enforceCw: false }
                      );
                    }
                    onCommitMutation('Set polygon bounciness', {
                      ...map,
                      polygons: nextPolygons,
                    });
                  }}
                  className="w-24 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100"
                />
              </label>
            )}
          </>
        )}

        {/* Vertex Color & Alpha */}
        {(() => {
          const sampleVert =
            selectedPolys[0]?.vertices[0] ??
            (selection.vertices[0]
              ? map.polygons[selection.vertices[0].polyIndex]?.vertices[
                  selection.vertices[0].vertexIndex
                ]
              : null);
          if (!sampleVert) return null;
          return (
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-400 text-[11px]">{t('Vertex color & alpha')}</span>
              <div className="flex items-center gap-1.5">
                <EditorColorInput
                  value={rgbToHex(sampleVert.color)}
                  onChange={(e) => {
                    const rgb = hexToRgb(e.target.value, sampleVert.color.a);
                    applyVertexColorToSelection({ r: rgb.r, g: rgb.g, b: rgb.b });
                  }}
                  className="w-7 h-6 rounded bg-transparent cursor-pointer"
                />
                <NumberInput
                  min={0}
                  max={255}
                  value={sampleVert.color.a}
                  onChange={(e) =>
                    applyVertexColorToSelection({
                      a: Math.max(0, Math.min(255, Number(e.target.value))),
                    })
                  }
                  className="w-16 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 font-mono text-zinc-100"
                />
              </div>
            </div>
          );
        })()}

        {/* Linear Gradient */}
        <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
          <div className="text-[10px] font-semibold text-zinc-400">
            {t('Linear Vertex Gradient')}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={gradStartHex}
              onChange={(e) => setGradStartHex(e.target.value)}
              className="w-6 h-6 rounded bg-transparent cursor-pointer"
            />
            <span className="text-zinc-500">→</span>
            <input
              type="color"
              value={gradEndHex}
              onChange={(e) => setGradEndHex(e.target.value)}
              className="w-6 h-6 rounded bg-transparent cursor-pointer"
            />
            <select
              value={gradDir}
              onChange={(e) => setGradDir(e.target.value as 'tb' | 'bt' | 'lr' | 'rl')}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100"
            >
              <option value="tb">{t('Top → Bottom')}</option>
              <option value="bt">{t('Bottom → Top')}</option>
              <option value="lr">{t('Left → Right')}</option>
              <option value="rl">{t('Right → Left')}</option>
            </select>
            <button
              type="button"
              onClick={applyLinearGradient}
              className="px-2 py-1 rounded bg-cyan-600/25 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-100 font-semibold cursor-pointer"
            >
              {t('Apply')}
            </button>
          </div>
        </div>

        {/* UV & Winding Tools */}
        {selectedPolys.length > 0 && (
          <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onResetPolygonUv}
                className="py-1 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] cursor-pointer"
              >
                {t('World-align UVs')}
              </button>
              <button
                type="button"
                onClick={onFlipPolygonWinding}
                className="py-1 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] cursor-pointer"
              >
                {t('Make clockwise')}
              </button>
            </div>

            {selectedPolys.length === 1 && (
              <div className="space-y-1 pt-1">
                <div className="text-[10px] text-zinc-500">
                  {t('Per-vertex UV coordinates')}
                </div>
                {selectedPolys[0].vertices.map((vert, vi) => (
                  <div key={vi} className="grid grid-cols-5 items-center gap-1 font-mono text-[10px]">
                    <span className="text-zinc-500">V{vi + 1}</span>
                    <NumberInput
                      step={0.05}
                      value={Number(vert.u.toFixed(3))}
                      onChange={(e) => {
                        const pi = selection.polygons[0];
                        const poly = map.polygons[pi];
                        const nextVerts = [...poly.vertices] as [PmsVertex, PmsVertex, PmsVertex];
                        nextVerts[vi] = { ...vert, u: Number(e.target.value) };
                        const nextPolys = [...map.polygons];
                        nextPolys[pi] = { ...poly, vertices: nextVerts }; // keeps the collision record
                        onCommitMutation('Edit vertex UV', { ...map, polygons: nextPolys });
                      }}
                      className="col-span-2 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-100"
                    />
                    <NumberInput
                      step={0.05}
                      value={Number(vert.v.toFixed(3))}
                      onChange={(e) => {
                        const pi = selection.polygons[0];
                        const poly = map.polygons[pi];
                        const nextVerts = [...poly.vertices] as [PmsVertex, PmsVertex, PmsVertex];
                        nextVerts[vi] = { ...vert, v: Number(e.target.value) };
                        const nextPolys = [...map.polygons];
                        nextPolys[pi] = { ...poly, vertices: nextVerts }; // keeps the collision record
                        onCommitMutation('Edit vertex UV', { ...map, polygons: nextPolys });
                      }}
                      className="col-span-2 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-100"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </PanelCard>
    )}

  </>;
}
