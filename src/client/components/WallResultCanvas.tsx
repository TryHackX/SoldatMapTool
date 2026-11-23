import { useEffect, useRef, useState } from 'react';
import type { PmsMapData } from '@shared/pmsParser';
import { SoldatWebGLRenderer } from '../renderer/SoldatWebGLRenderer';
import { DEFAULT_RENDER_LAYERS } from '../renderer/types';
import { t } from '../i18n';

type View = {x:number;y:number;width:number;height:number};

/** Matches the overlaid mask's SVG viewBox, including its aspect-ratio padding. */
export function WallResultCanvas({map,view}:{map:PmsMapData;view:View}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const currentView=useRef(view), redraw=useRef<()=>void>(()=>{});
  const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  useEffect(()=>{
    const element=canvas.current!;
    let renderer:SoldatWebGLRenderer;
    let active=true, loaded=false;
    setStatus('loading');
    try {renderer=new SoldatWebGLRenderer(element,{textureCacheBudgetMB:48});}
    catch {setStatus('error');return;}
    function draw() {
      if (!active || !loaded) return;
      const {x,y,width,height}=currentView.current;
      const w=element.clientWidth, h=element.clientHeight;
      if (!w || !h) return;
      const factor=Math.min(window.devicePixelRatio||1,2);
      if (element.width!==Math.round(w*factor)) element.width=Math.round(w*factor);
      if (element.height!==Math.round(h*factor)) element.height=Math.round(h*factor);
      const units=Math.max(width/w,height/h);
      renderer.render({left:x-w*units/2,right:x+w*units/2,top:y-h*units/2,bottom:y+h*units/2},DEFAULT_RENDER_LAYERS);
    }
    redraw.current=draw;
    const observer=new ResizeObserver(draw);
    observer.observe(element);
    renderer.loadMap(map).then(ok=>{
      if (!active) return;
      loaded=ok;setStatus(ok?'ready':'error');draw();
    }).catch(()=>{if(active)setStatus('error');});
    return ()=>{active=false;observer.disconnect();redraw.current=()=>{};renderer.destroy(true);};
  },[map]);
  useEffect(()=>{currentView.current=view;redraw.current();},[view]);
  return <><canvas ref={canvas} data-render={status} aria-label={t('Map with textures and scenery')} className="absolute inset-0 h-full w-full"/>
    {status!=='ready' && <span role="status" className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-zinc-900 px-2 py-1">
      {t(status==='loading'?'Loading map textures…':'Could not render the textured map. Switch to the mask view.')}
    </span>}</>;
}
