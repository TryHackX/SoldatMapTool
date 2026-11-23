import { benchMap, p95 } from './bench-map';
import { EditorSpatialIndex } from '../src/client/editor/spatialIndex';
import { computeSelectionSummary,emptySelection } from '../src/client/editor/EditorDocument';
import { renderEditorOverlay, type EditorOverlayRenderState } from '../src/client/editor/EditorOverlayPainter';
import { SoldatWebGLRenderer } from '../src/client/renderer/SoldatWebGLRenderer';
import { renderMapOverlays } from '../src/client/renderer/OverlayRenderer';
import { DEFAULT_RENDER_LAYERS as layers } from '../src/client/renderer/types';

const output=document.querySelector<HTMLPreElement>('#results')!;
const button=document.querySelector<HTMLButtonElement>('#run')!;
const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const ctx=document.querySelector<HTMLCanvasElement>('#overlay')!.getContext('2d')!;
async function measure() {
  const renderer=new SoldatWebGLRenderer(canvas);
  try {
    for(const size of [500,2500,5000]) {
      const map=benchMap(size);
      if(!await renderer.loadMap(map)) throw new Error('WebGL context lost');
      const selection={...emptySelection(),polygons:[Math.floor(size/2)]};
      const state:EditorOverlayRenderState={activeTool:'select',selection,selectionSummary:computeSelectionSummary(map,selection),
        gridSize:16,showEditorGrid:true,cursorWorld:null,snapIndicator:null,smartGuides:[],marqueeBox:null,lassoPoints:null,
        laserPoints:null,laserPreview:[],draftPoints:[],brushRadius:null,symmetryAxisX:null,validationFocus:null,ghostBounds:null,blueprint:null,playtest:null};
      const index=new EditorSpatialIndex(map), paint:number[]=[],compute:number[]=[],intervals:number[]=[];
      let prior=0;
      for(let i=0;i<72;i++) {
        const stamp=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
        const x=400+150*Math.sin(i/9),y=200+50*Math.cos(i/9),start=performance.now();
        index.queryPolygonCandidates(x-4,y-4,x+4,y+4);
        const bounds={left:x-480,right:x+480,top:y-270,bottom:y+270};
        state.cursorWorld={x,y};
        const computed=performance.now();
        renderer.render(bounds,layers);
        renderMapOverlays(ctx,960,540,map,{bounds,layers,sprites:null});
        renderEditorOverlay(ctx,960,540,map,bounds,state);
        if(i>=12) {compute.push(computed-start);paint.push(performance.now()-computed);intervals.push(stamp-prior);}
        prior=stamp;
      }
      output.textContent+=JSON.stringify({polygons:size,frames:intervals.length,frameP95ms:+p95(intervals).toFixed(2),
        queryP95ms:+p95(compute).toFixed(2),drawSubmissionP95ms:+p95(paint).toFixed(2)})+'\n';
    }
  } finally {renderer.destroy();}
}
button.onclick=async()=>{
  button.disabled=true;output.textContent='';
  try {await measure();output.textContent+='Complete';} catch(e) {output.textContent+=String(e);}
  finally {button.disabled=false;}
};
