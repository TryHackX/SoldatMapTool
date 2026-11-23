import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PmsMapData } from '@shared/pmsParser';
import { insertWallProtection, wallScope, wallSourceProblem, wallsFit, type WallPlan, type WallPoint, type WallScope, type WallSettings, type WallStroke } from '@shared/wallProtection';
import { t } from '../i18n';
import { WallResultCanvas } from './WallResultCanvas';

const button='rounded border border-zinc-700 px-2 py-1.5 hover:bg-zinc-800 disabled:opacity-40';
const selected=' border-amber-400/70 bg-amber-400/15 text-amber-200';
const trianglePath=(points:WallPoint[])=>'M'+points.map(p=>p.x+' '+p.y).join('L')+'Z';
const ink={include:'#34d399',exclude:'#f472b6',guide:'#7dd3fc'};
const radii=[4,8,16,32,48,80,128,256,512];
type Tool=WallStroke['mode']|'pan';
type Camera={x:number;y:number;zoom:number};
type BrushEvent=ReactPointerEvent<SVGSVGElement>;

export function WallMaskPreview({map,settings,onStrokes,onExportable,onScope}:{
  map:PmsMapData; settings:WallSettings; onStrokes:(strokes:WallStroke[])=>void;
  onExportable:(settings:WallSettings|null)=>void;
  onScope:(scope:WallScope)=>void;
}) {
  const svg=useRef<SVGSVGElement>(null), ring=useRef<SVGCircleElement>(null);
  const [tool,setTool]=useState<Tool>('guide'), [radius,setRadius]=useState(48);
  const [resultView,setResultView]=useState(false),[showMask,setShowMask]=useState(true),[showStrips,setShowStrips]=useState(true);
  const [undoStack,setUndoStack]=useState<WallStroke[][]>([]);
  const [redoStack,setRedoStack]=useState<WallStroke[][]>([]);
  const [showMesh,setShowMesh]=useState(false);
  const active=useRef<{pointer:number;stroke:WallStroke;straight:boolean}|null>(null);
  const pan=useRef<{pointer:number;start:WallPoint; origin:Camera; scale:number}|null>(null);
  const space=useRef(false);
  const [draft,setDraft]=useState<WallStroke|null>(null);
  const b=map.polyBounds;
  const initial=useMemo(()=>({x:(b.left+b.right)/2,y:(b.top+b.bottom)/2,zoom:1}),[b]);
  const full=map.fullBounds;
  const wholeMap={x:(full.left+full.right)/2,y:(full.top+full.bottom)/2,
    zoom:Math.min((Math.max(64,b.width)+24)/(Math.max(64,full.width)+24),
                  (Math.max(64,b.height)+24)/(Math.max(64,full.height)+24))};
  const [camera,setCamera]=useState(initial);
  const view=useMemo(()=>({x:camera.x,y:camera.y,width:(Math.max(64,b.width)+24)/camera.zoom,
    height:(Math.max(64,b.height)+24)/camera.zoom}),[b,camera]);
  const [result,setResult]=useState<(WallPlan & {error?:string;source:WallSettings})|null>(null);
  const ghost=useMemo(()=>{
    const paths={background:'',terrain:'',deadly:''};
    for(const p of map.polygons){
      const layer=[0,2,4].includes(p.polyType)?'terrain':[5,6].includes(p.polyType)?'deadly':'background';
      paths[layer]+=trianglePath(p.vertices);
    }
    return paths;
  },[map]);
  const issue=useMemo(()=>wallSourceProblem(map),[map]);
  useEffect(()=>{
    const fail=(error:string)=>setResult({polygons:[],sectorRepairs:[],error,source:settings});
    if (issue) {fail(issue);return;}
    const worker=new Worker(new URL('./wallPreview.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=({data}:{data:WallPlan|{error:string}})=>{
      if('error' in data) fail(data.error);
      else setResult({...data,source:settings});
    };
    worker.onerror=e=>fail(e.message);
    worker.postMessage({map:{polygons:map.polygons,sectorsPolys:map.sectorsPolys,sectorsNum:map.sectorsNum,
      sectorsDivision:map.sectorsDivision},settings});
    return ()=>worker.terminate();
  },[map,settings,issue]);
  const ready=result?.source===settings ? result : null;
  const count=ready?.polygons.length??0, fits=!!ready && wallsFit(map,ready.polygons);
  useEffect(()=>{onExportable(ready && !ready.error && fits && count ? settings : null);
    return ()=>onExportable(null);},[ready,fits,count,settings,onExportable]);
  const stripPath=useMemo(()=>ready?.polygons.map(p=>trianglePath(p.vertices)).join('')??'',[ready]);
  const finished=useMemo(()=>resultView && ready && !ready.error && fits ? insertWallProtection(map,ready) : null,
    [map,resultView,ready,fits]);
  const painted=useMemo(()=>[...settings.strokes,...(draft?[draft]:[])]
    .map((s,i)=>{
      const size=s.mode==='guide'?settings.width/2:s.radius;
      return s.points.length===1 ? <circle key={i} cx={s.points[0].x} cy={s.points[0].y} r={size} fill={ink[s.mode]}/> :
        <polyline key={i} points={s.points.map(p=>p.x+','+p.y).join(' ')} fill="none" stroke={ink[s.mode]}
          strokeWidth={size*2} strokeLinejoin="round" strokeLinecap="round"/>;
    }),[settings,draft]);

  function commit(strokes:WallStroke[]) {
    setUndoStack(prev=>[...prev.slice(-40),settings.strokes]);setRedoStack([]);onStrokes(strokes);
  }
  function undo() {
    if (!settings.strokes.length && !undoStack.length) return;
    setRedoStack(prev=>[...prev,settings.strokes]);
    onStrokes(undoStack.at(-1)??settings.strokes.slice(0,-1));
    setUndoStack(undoStack.slice(0,-1));
  }
  function redo() {
    if (!redoStack.length) return;
    setUndoStack(prev=>[...prev,settings.strokes]);onStrokes(redoStack.at(-1)!);setRedoStack(redoStack.slice(0,-1));
  }
  function position(x:number,y:number) {
    const matrix=svg.current?.getScreenCTM();
    if (!matrix) return;
    const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());
    return {x:p.x,y:p.y};
  }
  const magnify=useCallback((factor:number,anchor?:WallPoint)=>{
    setCamera(prev=>{
      const zoom=Math.max(0.5,Math.min(64,prev.zoom*factor));
      const p=anchor??prev, ratio=prev.zoom/zoom;
      return {zoom,x:p.x+(prev.x-p.x)*ratio,y:p.y+(prev.y-p.y)*ratio};
    });
  },[]);
  function brushStep(direction:number) {
    setRadius(prev=>radii[Math.max(0,Math.min(radii.length-1,radii.indexOf(prev)+direction))]);
  }
  useEffect(()=>{
    const el=svg.current!;
    function wheel(e:WheelEvent) {
      e.preventDefault();
      if(active.current||pan.current||!e.deltaY) return;
      if (e.shiftKey) {brushStep(e.deltaY<0?1:-1);return;}
      const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?el.clientHeight:1);
      magnify(Math.exp(Math.max(-1,Math.min(1,-delta*.002))),position(e.clientX,e.clientY));
    }
    el.addEventListener('wheel',wheel,{passive:false});
    function spaceDown(e:KeyboardEvent) {
      if (e.code!=='Space' || !el.matches(':hover') || (e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.matches('input,textarea,select')))) return;
      e.preventDefault();space.current=true;
    }
    function release(e:KeyboardEvent) {if(e.code==='Space') space.current=false;}
    function blur(){space.current=false;}
    window.addEventListener('keydown',spaceDown);
    window.addEventListener('keyup',release);
    window.addEventListener('blur',blur);
    return ()=>{el.removeEventListener('wheel',wheel);window.removeEventListener('keydown',spaceDown);
      window.removeEventListener('keyup',release);window.removeEventListener('blur',blur);};
  },[magnify]);
  function key(e:ReactKeyboardEvent<SVGSVGElement>) {
    if (active.current || pan.current) return;
    const k=e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k==='z' || k==='y') {e.preventDefault();e.stopPropagation();if(k==='y'||e.shiftKey)redo();else undo();}
      return;
    }
    if (k===' ') {e.preventDefault();space.current=true;}
    else if (k==='f') setCamera(resultView?wholeMap:initial);
    else if (k==='[' || k===']') brushStep(k===']'?1:-1);
  }
  function cursor(p:WallPoint,visible:boolean){
    if (!ring.current) return;
    ring.current.style.display=visible?'':'none';
    ring.current.setAttribute('cx',String(p.x));ring.current.setAttribute('cy',String(p.y));
  }
  function down(e:BrushEvent) {
    if (active.current || pan.current || e.button>2) return;
    const p=position(e.clientX,e.clientY);
    if (!p) return;
    e.preventDefault();e.currentTarget.focus({preventScroll:true});
    if (resultView || e.button===1 || space.current || (tool==='pan' && e.button===0)) {
      pan.current={pointer:e.pointerId,start:{x:e.clientX,y:e.clientY},origin:camera,scale:svg.current!.getScreenCTM()!.a};
      cursor(p,false);
    } else {
      const straight=e.shiftKey && e.button===0;
      const mode=e.button===2?'exclude':straight?'guide':tool;
      if(mode==='pan') return;
      const stroke:WallStroke={mode,radius,points:[p]};
      active.current={pointer:e.pointerId,stroke,straight};setDraft(stroke);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:BrushEvent) {
    const drag=pan.current;
    if (drag?.pointer===e.pointerId) {
      setCamera({...drag.origin,x:drag.origin.x-(e.clientX-drag.start.x)/drag.scale,y:drag.origin.y-(e.clientY-drag.start.y)/drag.scale});return;
    }
    const p=position(e.clientX,e.clientY);
    if (!p) return;
    cursor(p,!resultView && tool!=='pan' && !space.current);
    const drawing=active.current;
    if (drawing?.pointer!==e.pointerId) return;
    const stroke=drawing.stroke,last=stroke.points.at(-1)!;
    if(drawing.straight){stroke.points=[stroke.points[0],p];setDraft({...stroke});return;}
    const step=stroke.mode==='guide' ? Math.max(0.5,settings.width/4) : Math.max(1,radius/10);
    if (Math.hypot(p.x-last.x,p.y-last.y)<step) return;
    stroke.points.push(p);setDraft({...stroke});
  }
  function end(e:BrushEvent,save:boolean) {
    if (pan.current?.pointer===e.pointerId) pan.current=null;
    if (active.current?.pointer!==e.pointerId) return;
    const stroke=active.current.stroke;
    if (save) {
      const last=position(e.clientX,e.clientY),prev=stroke.points.at(-1)!;
      if(last && active.current.straight) stroke.points=[stroke.points[0],last];
      else if(last && (last.x!==prev.x || last.y!==prev.y)) stroke.points.push(last);
      commit([...settings.strokes,stroke]);
    }
    active.current=null;setDraft(null);
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={button+(wallScope(settings)==='all'?selected:'')} aria-pressed={wallScope(settings)==='all'}
        onClick={()=>{onScope('all');setCamera(wholeMap);setShowStrips(true);setResultView(true);}}>{t('Auto-protect the whole map')}</button>
      <button type="button" className={button+(wallScope(settings)==='painted'?selected:'')} aria-pressed={wallScope(settings)==='painted'}
        onClick={()=>{onScope('painted');setResultView(false);setTool('include');}}>{t('Only painted areas')}</button>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={button+(!resultView?selected:'')} aria-pressed={!resultView} onClick={()=>setResultView(false)}>{t('Edit mask')}</button>
      <button type="button" className={button+(resultView?selected:'')} aria-pressed={resultView} disabled={!ready || !!ready.error || !fits}
        onClick={()=>setResultView(true)}>{t('Preview finished map')}</button>
      <span className="mx-1 h-5 border-l border-zinc-700"/>
      {!resultView && <>
        {(['include','exclude','guide','pan'] as const).map((mode,i)=><button type="button" key={mode} aria-pressed={mode===tool}
          className={button+(mode===tool?selected:'')} onClick={()=>setTool(mode)}>{t(['Paint included area','Paint excluded area','Draw a strip','Pan'][i])}</button>)}
        {tool!=='guide' && tool!=='pan' && <label>{t('Brush radius')} <select value={radius} onChange={e=>setRadius(Number(e.target.value))} className="bg-zinc-900">
          {radii.map(v=><option key={v} value={v}>{v}</option>)}</select></label>}
        <label><input type="checkbox" checked={showMask} onChange={e=>setShowMask(e.target.checked)}/> {t('Show mask')}</label>
      </>}
      <label><input type="checkbox" checked={showStrips} onChange={e=>setShowStrips(e.target.checked)}/> {t('Highlight strips')}</label>
      <label><input type="checkbox" checked={showMesh} onChange={e=>setShowMesh(e.target.checked)}/> {t('Strip triangles')}</label>
    </div>
    <div className="relative h-[clamp(300px,57dvh,840px)] w-full overflow-hidden rounded border border-zinc-700 bg-zinc-950">
      {finished && <WallResultCanvas map={finished} view={view}/>}
      <svg ref={svg} tabIndex={0} aria-label={t('Wall protection mask')} viewBox={[view.x-view.width/2,view.y-view.height/2,view.width,view.height].join(' ')}
        className="absolute inset-0 h-full w-full touch-none outline-amber-400" style={{cursor:tool==='pan'||resultView?'grab':'crosshair'}}
        onPointerDown={down} onPointerMove={move} onPointerUp={e=>end(e,true)} onPointerCancel={e=>end(e,false)} onLostPointerCapture={e=>end(e,false)}
        onContextMenu={e=>e.preventDefault()} onKeyDown={key} onKeyUp={e=>{if(e.key===' ')space.current=false;}}
        onBlur={()=>{space.current=false;}} onPointerLeave={()=>{if(ring.current)ring.current.style.display='none';}}>
        {!finished && <g><path d={ghost.background} fill="#34333c"/><path d={ghost.terrain} fill="#686b79"/><path d={ghost.deadly} fill="#91434c"/></g>}
        {!resultView && showMask && <g opacity=".26" data-layer="mask">{painted}</g>}
        {showStrips && <path d={stripPath} fill="#fbbf24" data-layer="strips"/>}
        {showMesh && <path d={stripPath} fill="none" stroke={showStrips?'#78350f':'#fbbf24'} strokeWidth="1"
          vectorEffect="non-scaling-stroke" data-layer="wireframe"/>}
        {!resultView && <circle ref={ring} style={{display:'none'}} r={tool==='guide'?settings.width/2:radius} fill="none" stroke="#fff" strokeWidth="1"
          vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
      </svg>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={button} aria-label={t('Zoom in')} onClick={()=>magnify(1.5)}>+</button>
      <span className="min-w-12 text-center tabular-nums">{Math.round(camera.zoom*100)}%</span>
      <button type="button" className={button} aria-label={t('Zoom out')} onClick={()=>magnify(1/1.5)}>−</button>
      <button type="button" className={button} onClick={()=>setCamera(resultView?wholeMap:initial)}>{t('Fit map')}</button>
      {!resultView && <><button type="button" className={button} disabled={!settings.strokes.length && !undoStack.length} onClick={undo}>{t('Undo mask stroke')}</button>
        <button type="button" className={button} disabled={!redoStack.length} onClick={redo}>{t('Redo mask stroke')}</button>
        <button type="button" className={button} disabled={!settings.strokes.length} onClick={()=>commit([])}>{t('Clear mask')}</button></>}
    </div>
    <p className="text-zinc-400">{t(resultView?'Drag to pan. Turn off the strip highlight to see the exported appearance.':'Wheel to zoom here · middle drag or Space + drag to pan · right drag to exclude · Shift + wheel for brush size.')}</p>
    {!resultView && <p>{t('Shift + drag draws a straight strip between two points. Strips bend where clearance requires it.')}</p>}
    <p role="status" className="text-amber-200">{ready ? (ready.error ? t(ready.error) : t('Amber preview: {n} new Deadly polygons · {total}/5000 polygons.',{n:count,total:map.polygons.length+count})) : t('Calculating wall protection…')}</p>
    {!!ready?.sectorRepairs.length && <p>{t('Missing wall collision entries restored along your stroke: {n}.',{n:ready.sectorRepairs.length})}</p>}
    {ready && !fits && <p className="text-rose-300">{t('Polygon limit exceeded. Narrow the included area before export.')}</p>}
    {!resultView && <p className="text-zinc-400">{t(count===0 && ready && !ready.error?'No new strips here. Check the mask or move the stroke deeper into solid terrain.':'Pink excludes an area. Paint it green to include it again. The last brush wins where strokes overlap.')}</p>}
  </div>;
}
