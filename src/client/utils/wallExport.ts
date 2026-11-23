import type { MapCompactEntry } from '@shared/apiTypes';
import { guardedMapNames } from '@shared/guardedMapNames';
import { uint8ToBase64 } from './binary';
import { WALL_PLAN_VERSION, type WallSettings } from '@shared/wallProtection';

type Entry=Pick<MapCompactEntry,'id'|'baseName'|'crc32'>;
type Result={added:number;folder?:string;filename?:string};
async function post(url:string,body:unknown) {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if (!response.ok) throw Object.assign(Error(data.error||response.statusText),{status:response.status});
  return data;
}

async function buildCopy(entry:Entry,settings:WallSettings):Promise<{bytes?:Uint8Array<ArrayBuffer>;added:number}> {
  const response=await fetch('/api/maps/'+encodeURIComponent(entry.id)+'/raw',{cache:'no-store'});
  if (!response.ok) throw Error(response.statusText);
  const bytes=await response.arrayBuffer();
  const worker=new Worker(new URL('../components/wallPreview.worker.ts',import.meta.url),{type:'module'});
  try {
    return await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>data.error ? reject(Error(data.error)) : resolve(data);
      worker.onerror=e=>reject(Error(e.message));
      worker.postMessage({bytes,crc:entry.crc32,settings},[bytes]);
    });
  } finally {worker.terminate();}
}

export async function wallExporter(run:string,maxLength:number) {
  const version=await fetch('/api/workshop/wall-protection',{cache:'no-store'});
  if (version.ok && (await version.json()).version===WALL_PLAN_VERSION)
    return (entry:Entry,settings:WallSettings):Promise<Result>=>post('/api/workshop/wall-protection/'+encodeURIComponent(entry.id),
      {run,crc:entry.crc32,maxLength,settings});
  if (!version.ok && version.status!==404) throw Error(version.statusText);

  // Older Studio instances can save these same bytes through their editor endpoint.
  const config=await fetch('/api/config');
  if (!config.ok) throw Error(config.statusText);
  const {exportsPacksDir}=await config.json();
  if (typeof exportsPacksDir!=='string' || !/[\\/]packs[\\/]?$/i.test(exportsPacksDir)) throw Error('Export folder unavailable.');
  const folder=exportsPacksDir.replace(/packs[\\/]?$/i,'guarded-maps')+(exportsPacksDir.includes('\\')?'\\':'/')+run;
  return async(entry:Entry,settings:WallSettings):Promise<Result>=>{
    const {bytes,added}=await buildCopy(entry,settings);
    if (!bytes) return {added};
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const digest=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
    const pmsBase64=uint8ToBase64(bytes);
    for (const baseName of guardedMapNames(entry.baseName,maxLength,digest)) {
      try {
        const data=await post('/api/editor/save',{baseName,sourceMapId:entry.id,destination:'custom',customOutputFolder:folder,
          confirmOverwrite:false,pmsBase64});
        return {added,folder,filename:data.fileName};
      } catch(e) {if ((e as {status?:number}).status!==409) throw e;}
    }
    throw Error('Conflicting output map names.');
  };
}
