import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction, type PointerEvent, type RefObject } from 'react';
import { Mountain, RotateCcw, Spline } from 'lucide-react';
import type { TunnelSettings, TunnelResult, TunnelPoint } from '@shared/climbTunnel';
import type { PmsMapData } from '@shared/pmsParser';
import { sketchExample, TunnelStroke, type TunnelMethod } from '../tunnelBlueprint';
import { TunnelChoices, TunnelControls } from './TunnelControls';
import { TunnelPreview } from './TunnelPreview';
import { ClimbMoveLibrary } from './ClimbMoveLibrary';
import { TunnelSketchCoordinates } from './TunnelSketchCoordinates';
import { t } from '../../i18n';

type CancelSketch = RefObject<(() => boolean) | null>;
function Sketchpad({points,onChange,cancelSketch}:{points:TunnelPoint[];onChange:(value:TunnelPoint[])=>void;cancelSketch?:CancelSketch}) {
  const ref=useRef<HTMLCanvasElement>(null);
  const captured=useRef<{stroke:TunnelStroke; id:number}|null>(null);
  const [live,setLive]=useState<TunnelPoint[]|null>(null);
  const cancel = useCallback(() => {
    const active = captured.current;
    if (!active) return false;
    captured.current = null;
    if (ref.current?.hasPointerCapture(active.id)) ref.current.releasePointerCapture(active.id);
    setLive(null);
    return true;
  }, []);
  useEffect(() => {
    if (cancelSketch) cancelSketch.current = cancel;
    window.addEventListener('blur', cancel);
    return () => {
      if (cancelSketch) cancelSketch.current = null;
      window.removeEventListener('blur', cancel);
    };
  }, [cancel, cancelSketch]);
  // Keep the drawing scale stable while drawing or moving a knot.
  const extent=Math.max(1000,...points.flatMap(p=>[Math.abs(p.x)*0.6,Math.abs(p.y)*1.15]));
  const transform=(p:TunnelPoint)=>({x:390+p.x*180/extent,y:190+p.y*180/extent});
  function world(e:PointerEvent<HTMLCanvasElement>) {
    const b=e.currentTarget.getBoundingClientRect();
    return {x:((e.clientX-b.left)*780/b.width-390)*extent/180,
      y:((e.clientY-b.top)*380/b.height-190)*extent/180};
  }
  useEffect(()=>{
    const ctx=ref.current?.getContext('2d');if(!ctx) return;
    ctx.clearRect(0,0,780,380);
    ctx.strokeStyle='#26343c';ctx.lineWidth=1;
    for(let x=0;x<=780;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,380);ctx.stroke();}
    for(let y=0;y<=380;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(780,y);ctx.stroke();}
    const path=live??points;
    ctx.beginPath();ctx.strokeStyle='#67e8f9';ctx.lineWidth=3;
    path.forEach((p,i)=>{const v=transform(p);if(i)ctx.lineTo(v.x,v.y);else ctx.moveTo(v.x,v.y);});
    ctx.stroke();
    if(!live) for(const [i,p] of path.entries()) {
      const v=transform(p);ctx.fillStyle=i===0?'#fda4af':i===path.length-1?'#93c5fd':'#a5f3fc';
      ctx.beginPath();ctx.arc(v.x,v.y,(i===0||i===path.length-1)?5:2.7,0,2*Math.PI);ctx.fill();
    }
  },[points,live,extent]);
  return <canvas ref={ref} width={780} height={380} aria-label={t('Draw tunnel axis')} className="block w-full cursor-crosshair touch-none rounded-md border border-cyan-900 bg-[#101c22]"
    onPointerDown={e=>{
      if(e.button!==0 || captured.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p=world(e);
      const hit=points.findIndex(v=>Math.hypot(v.x-p.x,v.y-p.y)<extent*0.075);
      captured.current={stroke:new TunnelStroke(points,hit,p,{x:e.clientX,y:e.clientY}),id:e.pointerId};
    }}
    onPointerMove={e=>{
      const gesture=captured.current;if(!gesture || gesture.id!==e.pointerId) return;
      if(gesture.stroke.sample(world(e),{x:e.clientX,y:e.clientY},5)) setLive([...gesture.stroke.points]);
    }}
    onPointerUp={e=>{
      const gesture=captured.current;if(!gesture || gesture.id!==e.pointerId) return;
      const b=e.currentTarget.getBoundingClientRect();
      const outside=e.clientX<b.left || e.clientX>b.right || e.clientY<b.top || e.clientY>b.bottom;
      if(!outside) gesture.stroke.sample(world(e),{x:e.clientX,y:e.clientY},0,true);
      const completed=gesture.stroke.finish(outside);
      cancel();
      if(completed) onChange(completed);
    }}
    onPointerCancel={e=>{if(captured.current?.id===e.pointerId) cancel();}}
    onLostPointerCapture={e=>{if(captured.current?.id===e.pointerId) cancel();}}/>;
}

export interface ComposerProps {
  settings:TunnelSettings;
  setSettings:Dispatch<SetStateAction<TunnelSettings>>;
  method:TunnelMethod;
  setMethod:(v:TunnelMethod)=>void;
  path:TunnelPoint[];
  setPath:(v:TunnelPoint[])=>void;
  draft:TunnelResult|null;
  modal?:boolean;
  onExample?:(kind:'spiral'|'hills')=>void;
  contextMap?:PmsMapData;
  markers?:boolean;
  cancelSketch?:CancelSketch;
  onProfileLoading?:(loading:boolean)=>void;
}

export function TunnelComposer({settings,setSettings,method,setMethod,path,setPath,draft,modal,onExample,contextMap,markers,cancelSketch,onProfileLoading}:ComposerProps) {
  const drawn=method==='draw';
  function example(kind:'spiral'|'hills') {
    if(onExample) onExample(kind);else setPath(sketchExample(kind,{x:0,y:0},settings.clearance));
  }
  return <section aria-label={t('Climb tunnel builder')} className="space-y-3 text-xs text-zinc-200">
    <TunnelChoices label={t('Tunnel path')} value={method} onChange={setMethod}
      choices={[['draw','Draw my route'],['auto','Automatic route']]}/>
    <div className={modal?'grid items-start gap-5 md:grid-cols-[1.13fr_1fr]':'space-y-4'}>
      <div className={modal?'space-y-3 md:sticky md:top-0':'space-y-2'}>
        {drawn && <>
          <p className="leading-relaxed text-zinc-300">{modal?t('Draw from start to flag in the grid. Drag a knot to reshape the route.'):
            t('Drag on the map from start to flag. Drag a knot to move the bend.')}</p>
          {modal && <Sketchpad points={path} onChange={setPath} cancelSketch={cancelSketch}/>}
          <TunnelSketchCoordinates points={path} onChange={setPath}/>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="text-cyan-300" onClick={()=>example('spiral')}><Spline className="mr-1 inline" size={13}/>{t('Spiral')}</button>
            <button type="button" className="text-cyan-300" onClick={()=>example('hills')}><Mountain className="mr-1 inline" size={13}/>{t('Rolling hills')}</button>
            {!!path.length && <button type="button" className="text-zinc-400" onClick={()=>setPath([])}><RotateCcw size={12} className="mr-1 inline"/>{t('Clear sketch')}</button>}
          </div>
        </>}
        {draft && <TunnelPreview draft={draft} settings={settings} path={drawn ? path : undefined}
          contextMap={drawn ? contextMap : undefined} markers={markers} onChooseSeed={seed=>setSettings(s=>({...s,seed}))}/>}
        <ClimbMoveLibrary/>
      </div>
      <TunnelControls settings={settings} setSettings={setSettings} drawn={drawn} onProfileLoading={onProfileLoading}/>
    </div>
  </section>;
}

export function TunnelDock(props:ComposerProps & {onApply:(markers:boolean)=>void;locked:boolean}) {
  const [wantMarkers,setWantMarkers]=useState<boolean|null>(null);
  const [profileLoading,setProfileLoading]=useState(false);
  const markers=wantMarkers??(!props.contextMap?.spawnpoints.length);
  const drawn=props.method==='draw';
  return <div className="space-y-3">
    <h2 className="flex items-center gap-2 text-sm font-bold text-cyan-200"><Mountain size={17}/>{t('Build climb tunnel')}</h2>
    <TunnelComposer {...props} markers={markers} onProfileLoading={setProfileLoading}/>
    {drawn && <label className="flex items-center gap-2 text-zinc-300"><input type="checkbox" checked={markers} onChange={e=>setWantMarkers(e.target.checked)} className="accent-cyan-400"/>{t('Add spawn and flags')}</label>}
    {!drawn && <p className="text-[11px] text-amber-200">{t('Rebuild replaces the open map. Ctrl+Z restores it.')}</p>}
    {props.locked && <p className="text-amber-200">{t('Unlock polygons to draw terrain.')}</p>}
    <button type="button" disabled={profileLoading || !props.draft?.validation.ok || props.locked} onClick={()=>props.onApply(markers)}
      className="sticky bottom-0 w-full rounded-md bg-cyan-400 py-2 font-bold text-zinc-950 shadow-lg hover:bg-cyan-300 disabled:bg-zinc-800 disabled:text-zinc-500">
      {profileLoading ? t('Measuring local climb maps…') : drawn?t('Insert tunnel'):t('Rebuild current map')}
    </button>
  </div>;
}
