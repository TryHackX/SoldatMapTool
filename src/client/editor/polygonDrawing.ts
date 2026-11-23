import { drawCourse } from '@shared/courseGenerator';
import { freehandLaserToPolygons } from '@shared/imageTracer';
import { createPolygonFromPoints, earClipTriangulate, polygonSignedArea2 } from '@shared/pmsCompiler';
import type { PmsPolygon } from '@shared/pmsParser';
import type { EditorPlacementDefaults } from './types';

type Point = {x:number;y:number};
type Texture = {w:number;h:number};
type TriangleMode = 'poly_tri'|'poly_strip'|'poly_fan';

function material(settings:EditorPlacementDefaults,texture:Texture) {
  return {polyType:settings.polyType,bounciness:settings.bounciness,color:settings.polyColor,texWidth:texture.w,texHeight:texture.h};
}

export function triangleClick(mode:TriangleMode,previous:Point[],point:Point,settings:EditorPlacementDefaults,texture:Texture):
  {draft:Point[];polygon?:PmsPolygon;collinear?:boolean} {
  const next=[...previous,point];
  if(next.length<3) return {draft:next};
  const [a,b,c]=next.slice(-3);
  if(Math.abs(polygonSignedArea2(a,b,c))<=0.5) return {draft:previous,collinear:true};
  const draft=mode==='poly_tri' ? [] : [mode==='poly_strip' ? b : next[0],c];
  return {draft,polygon:createPolygonFromPoints([a,b,c],material(settings,texture))};
}

export function polygonOutline(points:Point[],settings:EditorPlacementDefaults,texture:Texture) {
  const options=material(settings,texture);
  return earClipTriangulate(points).map(triangle=>createPolygonFromPoints(triangle,options));
}

export function laserStroke(points:Point[],settings:EditorPlacementDefaults,texture:Texture) {
  if(settings.strokeMode==='course') return drawCourse(points,settings.course);
  return freehandLaserToPolygons(points,{
    ...material(settings,texture),detailEpsilon:settings.laserDetail,smoothPasses:settings.laserSmoothPasses,
    autoShadeDepth:settings.laserAutoShade,
  });
}
