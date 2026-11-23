import path from 'node:path';
import { setImmediate as yieldToServer } from 'node:timers/promises';
import type { MapIndexEntry } from '../shared/apiTypes';
import { isDraftName, matchesDraftFilter, type DraftFilter, type LibraryPair, type SimilarityCriterion } from '../shared/librarySimilarity';
import { compareSprite, spriteSignature, type SpriteSignature } from './mapVisualSignature';
import { insertCandidate, intersection, nearby, ngrams, type Posting } from './similarityCandidates';

interface ScenerySearchOptions {
  criteria:Partial<Record<SimilarityCriterion,boolean>>;
  threshold:number;
  draftFilter:DraftFilter;
  anchorIds?:ReadonlySet<string>;
  signal:AbortSignal;
  onProgress:(done:number,total:number)=>void;
}
interface Scenery {
  owner:MapIndexEntry;
  anchor:boolean;
  name:string;
  file:string|null;
  key:string;
  grams:Set<string>;
  draft:boolean;
  image:SpriteSignature|null;
  buckets:string[];
}
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const MAX_ASSETS=60000,MAX_IMAGES=30000,MAX_RESULTS=500;
const EXACT_LIMIT=540,EXACT_ANCHOR_PAIRS=220000;

function filenameKey(raw:string) {
  const stem=raw.normalize('NFKC').toLowerCase().replaceAll('\\','/').split('/').at(-1)!
    .replace(/\.[a-z0-9]{1,5}$/,'');
  // Keep object numbers ("palm2" and "palm3"). Strip only explicit revision and copy markers.
  const clean=stem.replace(/(?:^|[\s_.()-])(?:rev|ver|v|rc)[_. -]?\d+(?:[_.-]\d+)*(?=$|[\s_.()-])/g,'')
    .replace(/(?:^|[\s_.()-])(?:alpha|beta|draft|test|wip|rough|backup|bak|copy|kopia|szkic|robocza|roboczy)(?:[_. -]?\d+)?(?=$|[\s_.()-])/g,'')
    .replace(/\s*\(\d+\)$/,'').replace(/[^\p{L}\p{N}]+/gu,'');
  return clean||stem.replace(/[^\p{L}\p{N}]+/gu,'');
}

function pairRank(a:LibraryPair,b:LibraryPair) {
  return b.score-a.score || cmp(a.sceneries[0].left,b.sceneries[0].left)
    || cmp(a.sceneries[0].right,b.sceneries[0].right) || cmp(a.leftId,b.leftId) || cmp(a.rightId,b.rightId);
}

/** A repeated use of the same reference and physical file has one result identity across maps. */
export async function searchSimilarSceneries(entries:readonly MapIndexEntry[],opts:ScenerySearchOptions) {
  const results:LibraryPair[]=[];
  const names=!!(opts.criteria.sceneryNames||opts.criteria.names), images=!!opts.criteria.sceneryImages;
  let approximate=false,truncated=false;
  opts.signal.throwIfAborted();
  if((!names&&!images)||!entries.length||opts.anchorIds?.size===0)return {results,truncated,approximate};
  const maps=[...new Map(entries.map(m=>[m.id,m])).values()].sort((a,b)=>
    Number(opts.anchorIds?.has(b.id)??false)-Number(opts.anchorIds?.has(a.id)??false)||cmp(a.id,b.id));
  const seen=new Set<string>(),assets:Scenery[]=[];
  for(const [i,map] of maps.entries()){
    if(i%32===0){await yieldToServer();opts.signal.throwIfAborted();}
    for(const sc of map.sceneryAssets){
      if(sc.usedCount<=0||!sc.referencedName)continue;
      const file=sc.pngOverrideFullPath||sc.diskFullPath||null;
      const name=sc.referencedName;
      // Case differences in the PMS spelling are meaningful aliases, even on Windows.
      // Without a physical path we can compare the names, but cannot merge unknown files.
      const id=JSON.stringify([file?path.resolve(file):'missing:'+map.id,name]);
      if(seen.has(id))continue;
      if(assets.length===MAX_ASSETS){approximate=true;break;}
      seen.add(id);
      const key=names?filenameKey(name):'';
      assets.push({owner:map,anchor:opts.anchorIds?.has(map.id)??false,name,file,key,grams:ngrams(key),
        draft:isDraftName(name),image:null,buckets:[]});
    }
  }
  const total=assets.length*2,anchors=opts.anchorIds?assets.filter(a=>a.anchor):[];
  if(opts.anchorIds&&!anchors.length || assets.length<2){
    opts.onProgress(total,total);
    return {results,truncated,approximate};
  }
  opts.onProgress(0,total);
  const fileImages=new Map<string,SpriteSignature|null>();
  for(const [i,asset] of assets.entries()){
    if(i%16===0){opts.onProgress(i,total);await yieldToServer();opts.signal.throwIfAborted();}
    if(names&&asset.key)asset.buckets.push('n:'+asset.key,...[...asset.grams].map(g=>'g:'+g));
    if(!images||!asset.file)continue;
    let image=fileImages.get(asset.file);
    if(image===undefined){
      if(fileImages.size>=MAX_IMAGES){approximate=true;continue;}
      image=await spriteSignature(asset.file);
      fileImages.set(asset.file,image);
    }
    asset.image=image;
    if(image){
      asset.buckets.push('exact:'+image.aspect+'/'+image.pixels.toString('base64'),'c:'+image.colour);
      image.bands.forEach((band,j)=>asset.buckets.push('v'+j+':'+band));
    }
  }
  function evaluate(left:Scenery,right:Scenery) {
    if(!matchesDraftFilter(opts.draftFilter,left.draft||right.draft))return;
    const nameScore=names && left.key && right.key ? (left.key===right.key?1:
      2*intersection(left.grams,right.grams)/Math.max(1,left.grams.size+right.grams.size)):0;
    const visualScore=images&&left.image&&right.image?compareSprite(left.image,right.image):0;
    if(!nameScore && !visualScore)return;
    const score=Math.round(100*(nameScore+visualScore)/(Number(names)+Number(images)));
    if(score<opts.threshold)return;
    const reasons:SimilarityCriterion[]=[];
    if(nameScore>=0.70)reasons.push('sceneryNames');
    if(visualScore>=0.70)reasons.push('sceneryImages');
    if(!reasons.length)reasons.push(nameScore>=visualScore?'sceneryNames':'sceneryImages');
    const a=left.owner,b=right.owner;
    results.push({kind:'scenery',leftId:a.id,leftName:a.baseName,leftCrc:a.crc32,leftHasThumbnail:a.hasThumbnail,
      rightId:b.id,rightName:b.baseName,rightCrc:b.crc32,rightHasThumbnail:b.hasThumbnail,
      score,reasons,sceneries:[{left:left.name,right:right.name}]});
    if(results.length>MAX_RESULTS)truncated=true;
    if(results.length===2*MAX_RESULTS){results.sort(pairRank);results.length=MAX_RESULTS;}
  }
  const exactAnchors=!!opts.anchorIds&&anchors.length*assets.length<=EXACT_ANCHOR_PAIRS;
  const full=assets.length<=EXACT_LIMIT;
  approximate||=!exactAnchors&&!full;
  const allPostings:Posting=new Map(),anchorPostings:Posting=new Map();
  for(let i=0;i<assets.length;i++){
    if(i%8===0){opts.onProgress(assets.length+i,total);await yieldToServer();opts.signal.throwIfAborted();}
    const a=assets[i];
    if(exactAnchors){
      // Anchor usages were collected first, so an anchor/anchor pair is scored only once.
      for(let j=0;j<anchors.length && (!a.anchor||j<i);j++)evaluate(anchors[j],a);
    }else if(full){
      for(let j=0;j<i;j++)if(!opts.anchorIds||assets[j].anchor||a.anchor)evaluate(assets[j],a);
    }else{
      for(const j of nearby(opts.anchorIds&&!a.anchor?anchorPostings:allPostings,a.buckets))evaluate(assets[j],a);
      insertCandidate(allPostings,a.buckets,i);
      if(a.anchor)insertCandidate(anchorPostings,a.buckets,i);
    }
  }
  results.sort(pairRank);
  if(results.length>MAX_RESULTS)results.length=MAX_RESULTS;
  opts.onProgress(total,total);
  return {results,truncated,approximate};
}
