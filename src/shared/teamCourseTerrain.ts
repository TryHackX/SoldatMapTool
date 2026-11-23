import { createPolygonFromPoints } from './pmsCompiler';
import type { PmsPolygon } from './pmsParser';
import type { RgbaColor } from './soldatConstants';

type Point = {x:number;y:number};
type Rgb = [number,number,number];
const tint = ([r,g,b]:Rgb):RgbaColor => ({r,g,b,a:255});

/** Two broad routes through a CTF midfield; low traversable banks and overhead cover for TW. */
export function buildTeamCourse(mode:'ctf'|'trenchwars', spacing:number, random:()=>number) {
  const trench=mode==='trenchwars', count=trench?12:8;
  const step=Math.round(spacing*(trench?1.7:1.35)), end=count*step;
  const polygons:PmsPolygon[]=[];
  function quad(a:Point,b:Point,depthA:number,depthB:number,lit:Rgb,shadow:Rgb) {
    const c={x:b.x,y:b.y+depthB}, d={x:a.x,y:a.y+depthA};
    const faces:[Point,Point,Point][]=a.x+b.x<0 ? [[a,b,c],[a,c,d]] : [[a,b,d],[b,c,d]];
    for (const tri of faces) {
      const p=createPolygonFromPoints(tri,{texWidth:180,texHeight:180});
      p.vertices.forEach(v=>{v.color=tint(v.y===a.y && v.x===a.x || v.y===b.y && v.x===b.x ? lit : shadow);});
      polygons.push(p);
    }
  }
  // Mirrored bases share their route lengths; each seed changes the landforms on both sides.
  const half:Point[]=[{x:0,y:trench ? 0 : Math.round(10+random()*18)}];
  for (let i=1;i<count;i++) {
    const x=i*step, n=random();
    const y=i>=count-1 ? 0 : trench ? (i%3===1 ? 33+Math.round(n*16) : -5+Math.round(n*12)) : Math.round(n*31);
    if (trench && i%3===1 && i<count-1) half.push({x:x-step*0.36,y},{x:x+step*0.36,y});
    else half.push({x,y});
  }
  half.push({x:end,y:0});
  const floor=[...half.slice(1).reverse().map(p=>({...p,x:-p.x})),...half];
  const earth:Rgb=trench?[158,147,111]:[138,168,161];
  for (let i=1;i<floor.length;i++)
    quad(floor[i-1],floor[i],155-floor[i-1].y,155-floor[i].y,earth,trench?[70,72,66]:[55,74,92]);
  function shelf(x0:number,x1:number,y0:number,y1:number,depth:number) {
    const left={x:x0,y:y0}, right={x:x1,y:y1};
    const dark:Rgb=trench?[81,76,62]:[57,83,102], top:Rgb=trench?[172,157,118]:[155,191,194];
    quad(left,right,depth,depth,top,dark);
    quad({x:-x1,y:y1},{x:-x0,y:y0},depth,depth,top,dark);
  }
  if (trench) {
    // Each flat trench has a recessed covered section plus a wider open entry on both sides.
    for (let i=1;i<count-1;i+=3) {
      const p=half.find(p=>Math.abs(p.x-(i-0.36)*step)<0.001)!;
      const roof=p.y-48-Math.round(5*random()), width=step*(0.47+random()*0.16);
      shelf(i*step-width/2,i*step+width/2,roof,roof-2,10);
    }
  } else {
    // Bases feed a middle bridge by two takeoff ledges; the complete ground lane stays open below.
    const deck=-92-Math.round(random()*16), length=step*(3.45+random()*0.45);
    shelf(0,length,deck-6,deck,13);
    shelf(step*4.25,step*5.10,deck+15,deck+22,12);
    shelf(step*5.55,step*6.30,-43,-38,12);
  }
  return {polygons,spawnX:end-step*0.50,flagX:end-step*0.28};
}
