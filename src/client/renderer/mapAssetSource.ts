import type { PmsMapData } from '../../shared/pmsParser';

export interface MapAssetSource { mapId:string; key:string }
const scope=Symbol('indexed-map-asset-source');
type RenderMap=PmsMapData&{[scope]?:{mapId:string; key?:string}};
// Enumerable symbols survive editor object spreads and are omitted by JSON and the PMS codec.
export function setMapAssetSource(map:PmsMapData,mapId:string,key:string|null) {
  if(key)(map as RenderMap)[scope]={mapId,key};
}
export function mapAssetSource(map:PmsMapData): MapAssetSource | undefined {
  const source=(map as RenderMap)[scope];
  return source?.key ? {mapId:source.mapId,key:source.key} : undefined;
}
export function mapAssetOriginId(map:PmsMapData) { return (map as RenderMap)[scope]?.mapId; }
export function rememberAssetOrigin(map:PmsMapData,mapId:string) { (map as RenderMap)[scope]={mapId}; }
/** A saved project can move to another installation. Bind to the current package only if it is indexed here. */
export async function restoreAssetOrigin(map:PmsMapData,mapId?:string|null,signal?:AbortSignal) {
  if (!mapId) return;
  rememberAssetOrigin(map,mapId);
  try {
    const response=await fetch('/api/maps/'+encodeURIComponent(mapId)+'/raw',{method:'HEAD',signal});
    if (response.ok) setMapAssetSource(map,mapId,response.headers.get('X-Soldat-Asset-Scope'));
  } catch {
    signal?.throwIfAborted();
    // Keep the origin hint for a future reopen. The map can still use the current installation's assets.
  }
}
export function renderNameKey(name:string,source?:MapAssetSource){
  return JSON.stringify(source?[source.key,name]:[name]);
}
export const thumbnailUrls=new Map<string,string>();
export const thumbnailUrl=(crc:number,id?:string,version?:string)=>'/api/thumbnails/'+(crc>>>0).toString(16)+
  (id?'?mapId='+encodeURIComponent(id)+(version?'&scope='+encodeURIComponent(version):''):'');
