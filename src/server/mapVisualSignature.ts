import { open, stat } from 'node:fs/promises';
import sharp from 'sharp';
import type { MapIndexEntry } from '../shared/apiTypes';
import { parsePmsFull } from '../shared/pmsParser';
import { decodeBmpToRgba } from './bmpDecoder';

export interface TerrainMask { rows:Uint32Array; aspect:number }
export interface SpriteSignature { pixels:Buffer; aspect:number; bands:number[]; colour:number }
const terrainCache=new Map<string,TerrainMask|null>();
const spriteCache=new Map<string,SpriteSignature|null>();
function remember<T>(cache:Map<string,T>,key:string,value:T,limit:number) {
  if(cache.size>=limit&&!cache.has(key))cache.delete(cache.keys().next().value!);
  cache.set(key,value);return value;
}
async function boundedBytes(file:string,max:number) {
  const fd=await open(file,'r');
  try{
    const s=await fd.stat();if(!s.isFile()||s.size<=0||s.size>max)throw Error('File outside comparison limits');
    const out=Buffer.alloc(s.size);let pos=0;
    while(pos<out.length){const n=(await fd.read(out,pos,out.length-pos,pos)).bytesRead;if(!n)throw Error('Unexpected end of file');pos+=n;}
    return out;
  }finally{await fd.close();}
}

// The union of occupied cells is independent of polygon order, tessellation and translation.
// Keep aspect separately so a long course and a square arena do not become the same silhouette.
export async function terrainMask(entry:MapIndexEntry) {
  const key=JSON.stringify([entry.fullPath,entry.fileSize,entry.mtimeMs,entry.crc32]);
  if(terrainCache.has(key))return terrainCache.get(key)!;
  let shape:TerrainMask|null=null;
  try {
    const map=parsePmsFull(await boundedBytes(entry.fullPath,16*1024**2)),b=map.polyBounds;
    if(b.width>0&&b.height>0&&Number.isFinite(b.width+b.height)){
      const rows=new Uint32Array(32);
      for(const poly of map.polygons){
        const corners=poly.vertices.map(v=>({x:(v.x-b.left)*32/b.width,y:(v.y-b.top)*32/b.height}));
        if(!corners.every(v=>Number.isFinite(v.x+v.y)))continue;
        const top=Math.min(...corners.map(v=>v.y)),bottom=Math.max(...corners.map(v=>v.y));
        for(let y=Math.max(0,Math.floor(top));y<=Math.min(31,Math.floor(bottom));y++){
          const line=Math.max(top+1e-8,Math.min(bottom-1e-8,y+0.5));
          let lo=Infinity,hi=-Infinity;
          for(let k=0;k<3;k++){
            const a=corners[k],d=corners[(k+1)%3];
            if((a.y<=line)===(d.y<=line))continue;
            const x=a.x+(line-a.y)/(d.y-a.y)*(d.x-a.x);lo=Math.min(lo,x);hi=Math.max(hi,x);
          }
          if(hi>lo){const l=Math.max(0,Math.min(31,Math.floor(lo))),r=Math.max(0,Math.min(31,Math.ceil(hi)-1));
            rows[y]|=(0xffffffff<<l)&(0xffffffff>>>(31-r));}
        }
      }
      if(rows.some(Boolean))shape={rows,aspect:b.width/b.height};
    }
  }catch{ /* Unreadable geometry contributes no evidence. */ }
  return remember(terrainCache,key,shape,6000);
}
export function bitCount(bits:number){
  bits=bits-((bits>>>1)&0x55555555);
  bits=(bits&0x33333333)+((bits>>>2)&0x33333333);
  return (((bits+(bits>>>4))&0x0f0f0f0f)*0x01010101)>>>24;
}
export function compareTerrain(a:TerrainMask,b:TerrainMask) {
  let intersection=0,union=0;
  for(let i=0;i<32;i++){intersection+=bitCount(a.rows[i]&b.rows[i]);union+=bitCount(a.rows[i]|b.rows[i]);}
  return intersection/union*(0.8+0.2*Math.min(a.aspect/b.aspect,b.aspect/a.aspect));
}

const MAX_PIXELS=4*1024**2;
async function sprite(file:string) {
  const bytes=await boundedBytes(file,16*1024**2);
  let rgba:Buffer,width:number,height:number;
  if(bytes.length>=30&&bytes[0]===66&&bytes[1]===77){
    const os2=bytes.readUInt32LE(14)===12;
    width=os2?bytes.readUInt16LE(18):bytes.readInt32LE(18);height=Math.abs(os2?bytes.readInt16LE(20):bytes.readInt32LE(22));
    if(width<=0||height<=0||width*height>MAX_PIXELS)return null;
    ({rgba,width,height}=decodeBmpToRgba(bytes));
  }else{
    const out=await sharp(bytes,{limitInputPixels:MAX_PIXELS,pages:1}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
    rgba=out.data;width=out.info.width;height=out.info.height;
  }
  for(let i=0;i<rgba.length;i+=4){
    if(rgba[i]===0&&rgba[i+1]===255&&rgba[i+2]===0&&rgba[i+3]===255)rgba[i+3]=0;
  }
  const pixels=await sharp(rgba,{raw:{width,height,channels:4}}).resize(8,8,{fit:'fill',kernel:'lanczos2'}).raw().toBuffer();
  const luma=new Uint16Array(64),rgb=[0,0,0];let visible=0;
  for(let i=0;i<64;i++){
    const at=4*i,alpha=pixels[at+3]/255;visible+=alpha;
    for(let c=0;c<3;c++){pixels[at+c]=Math.round(pixels[at+c]*alpha);rgb[c]+=pixels[at+c];}
    luma[i]=(pixels[at]*2+pixels[at+1]*4+pixels[at+2])/7+pixels[at+3]/2;
  }
  if(visible<0.05)return null;
  const bands=Array<number>(4).fill(0);
  for(let i=0;i<64;i++){
    const next=i%8===7?i-1:i+1;
    if(luma[i]>luma[next]+2)bands[i>>4]|=1<<(i%16);
  }
  const colour=rgb.reduce((acc,v)=>(acc<<3)|Math.min(7,Math.floor(v/visible/32)),0);
  return {pixels,aspect:width/height,bands,colour};
}
export async function spriteSignature(file:string) {
  try{
    const st=await stat(file);const key=JSON.stringify([file,st.size,st.mtimeMs]);
    if(spriteCache.has(key))return spriteCache.get(key)!;
    let image:SpriteSignature|null=null;
    try{image=await sprite(file);}catch{ /* Unsupported/corrupt images cannot match visually. */ }
    return remember(spriteCache,key,image,6000);
  }catch{return null;}
}
export function compareSprite(a:SpriteSignature,b:SpriteSignature) {
  if(a===b)return 1;
  const ratio=Math.min(a.aspect/b.aspect,b.aspect/a.aspect);
  if(ratio<0.65)return 0;
  let coverage=0,error=0;
  for(let i=0;i<256;i+=4){
    const opacity=Math.max(a.pixels[i+3],b.pixels[i+3]);coverage+=opacity;
    const rgb=Math.max(Math.abs(a.pixels[i]-b.pixels[i]),Math.abs(a.pixels[i+1]-b.pixels[i+1]),Math.abs(a.pixels[i+2]-b.pixels[i+2]));
    error+=Math.max(rgb,Math.abs(a.pixels[i+3]-b.pixels[i+3]));
  }
  return Math.max(0,1-error/Math.max(1,coverage)*1.7)*(0.7+0.3*ratio);
}
