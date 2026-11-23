import { useEffect, useRef, useState } from 'react';
import type { PmsMapData } from '@shared/pmsParser';
import { SoldatWebGLRenderer } from '../../renderer/SoldatWebGLRenderer';
import { DEFAULT_RENDER_LAYERS } from '../../renderer/types';
import { CoursePreview } from './CoursePreview';
import { t } from '../../i18n';

export function ReferenceTerrainView({map,label}:{map:PmsMapData;label:string}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [fallback,setFallback]=useState(false);
  useEffect(()=>{
    if(!canvas.current)return;
    let renderer:SoldatWebGLRenderer|undefined,active=true;
    async function draw(){
      const c=canvas.current!;
      try{
        renderer=new SoldatWebGLRenderer(c,{textureCacheBudgetMB:32});
        const loaded=await renderer.loadMap(map);
        if(!active)return;
        if(!loaded){setFallback(true);return;}
        const b=map.polyBounds, z=Math.max(1,b.width/c.width,b.height/c.height)*1.08;
        const x=(b.left+b.right)/2,y=(b.top+b.bottom)/2;
        renderer.render({left:x-c.width*z/2,right:x+c.width*z/2,top:y-c.height*z/2,bottom:y+c.height*z/2},DEFAULT_RENDER_LAYERS);
        setFallback(false);
      }catch{if(active)setFallback(true);}
    }
    void draw();
    return ()=>{active=false;renderer?.destroy();};
  },[map]);
  return <><canvas ref={canvas} width={720} height={360} className={fallback?'hidden':'block w-full rounded bg-zinc-950'} aria-label={label}/>
    {fallback && <><CoursePreview map={map}/><p className="mt-1 text-xs text-zinc-400">{t('Geometry preview · textures unavailable')}</p></>}</>;
}

