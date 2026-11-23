import { setImmediate as yieldToServer } from 'node:timers/promises';
import type { MapIndexEntry } from '../shared/apiTypes';
import { isDraftName, matchesDraftFilter, similarityCriteria, type DraftFilter, type LibraryPair, type SimilarityCriterion } from '../shared/librarySimilarity';
import { bitCount, compareSprite, compareTerrain, spriteSignature, terrainMask, type SpriteSignature, type TerrainMask } from './mapVisualSignature';
import { ngrams, intersection, insertCandidate, nearby, type Posting } from './similarityCandidates';

interface Options {
  criteria:Partial<Record<SimilarityCriterion,boolean>>;
  threshold:number;
  draftFilter:DraftFilter;
  anchorId?:string;
  anchorIds?:ReadonlySet<string>;
  signal:AbortSignal;
  onProgress:(done:number,total:number)=>void;
}
const EXACT_LIMIT=480, MAX_RESULTS=500, MAX_MAP_IMAGES=48, MAX_JOB_IMAGES=30000;
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const normal=(s:string)=>s.normalize('NFKC').toLowerCase();
function nameKey(s:string){
  return normal(s).replace(/^(?:(?:ctf|dm|inf|htf|kz|tw|rce|climb)[-_ ])+/,'')
    .replace(/[_. -](?:(?:rev|ver|v|rc)[_. -]?\d+(?:\.\d+)*|alpha|beta|draft|test|wip|backup|copy|kopia)(?:[_. -]?\d+)?(?=$|[_. -])/g,'')
    .replace(/\s*\(\d+\)$/,'').replace(/[^\p{L}\p{N}]+/gu,'');
}
const similarity=(a:number,b:number)=>Math.min(a,b)/Math.max(1,a,b);
interface Picture { group:number; image:SpriteSignature;name:string;draft:boolean }
interface Features {
  map:MapIndexEntry; key:string; grams:Set<string>;names:Map<string,string>;texture:string;
  shape:TerrainMask|null; pictures:Map<number,Picture[]>;counts:number[];draft:boolean;keys:string[];
}

// Nearby sprites share a search bucket; final pair scores compare the actual decoded thumbnails.
// Indexing caps the number of representative comparisons for a new sprite in very large libraries.
class VisualGroups {
  representatives:SpriteSignature[]=[];
  exact=new Map<string,number>();
  buckets=new Map<string,number[]>();
  put(image:SpriteSignature) {
    const exactKey=Math.round(Math.log(image.aspect)*10000)+'/'+image.pixels.toString('base64');
    const hit=this.exact.get(exactKey);if(hit!==undefined)return hit;
    const keys=['c'+image.colour,...image.bands.map((x,i)=>i+'/'+x)];
    const candidates=this.representatives.length<160?this.representatives.keys():
      new Set(keys.flatMap(k=>this.buckets.get(k)??[])).values();
    let score=0.90,id=-1;
    for(const i of candidates){const s=compareSprite(image,this.representatives[i]);if(s>score){score=s;id=i;}}
    if(id<0){
      id=this.representatives.length;this.representatives.push(image);
      for(const k of keys){const bin=this.buckets.get(k)??[];if(bin.length===36)bin.splice(1,1);bin.push(id);this.buckets.set(k,bin);}
    }
    this.exact.set(exactKey,id);return id;
  }
}

function candidateKeys(f:Features,enabled:Set<SimilarityCriterion>){
  const keys=new Set<string>();
  if(enabled.has('names')&&f.key){
    keys.add('n:'+f.key);for(const g of f.grams)keys.add('g:'+g);
  }
  if(enabled.has('texture')&&f.texture)keys.add('t:'+f.texture);
  if(enabled.has('counts'))for(let i=0;i<f.counts.length;i++){
    if(f.counts[i]>0)keys.add('k'+i+'/'+Math.round(Math.log2(f.counts[i]+1)*4));
  }
  if(enabled.has('sceneryNames'))for(const name of f.names.keys())keys.add('s:'+name);
  if(enabled.has('sceneryImages'))for(const group of f.pictures.keys())keys.add('p:'+group);
  if(enabled.has('shape')&&f.shape){
    for(let band=0;band<8;band++){
      let hash=0,density=0;
      for(let i=0;i<4;i++){
        const row=f.shape.rows[band*4+i];density+=bitCount(row);
        for(let x=0;x<4;x++)hash=hash*2+Number((row&(1<<(x*8+i)))!==0);
      }
      keys.add('m'+band+'/'+hash);keys.add('a'+band+'/'+Math.round(density/7));
    }
  }
  return [...keys];
}

function sceneryPictures(left:Features,right:Features) {
  const pairs:LibraryPair['sceneries']=[];
  let weight=0,matched=0,hasDraft=false;
  function record(l:Picture,r:Picture,score:number){
    const draft=l.draft||r.draft;
    // Keep one visibly marked scenery pair in the preview even if the matching draft is the ninth.
    if(pairs.length<8)pairs.push({left:l.name,right:r.name});
    else if(draft&&!hasDraft)pairs[pairs.length-1]={left:l.name,right:r.name};
    hasDraft||=draft;weight+=score;matched++;
  }
  for(const [group,items] of left.pictures){
    const other=right.pictures.get(group);if(!other)continue;
    if(items.length===1&&other.length===1){
      const s=compareSprite(items[0].image,other[0].image);if(s>=0.89)record(items[0],other[0],s);continue;
    }
    // Same sprite under several aliases is common. Pair identical cached signatures first,
    // leaving only genuinely distinct signatures for the fuzzy one-to-one assignment.
    const usedL=new Set<Picture>(),usedR=new Set<Picture>();
    for(const l of items){const r=other.find(r=>r.image===l.image&&!usedR.has(r));if(r){usedL.add(l);usedR.add(r);record(l,r,1);}}
    const candidates:{l:Picture;r:Picture;score:number}[]=[];
    for(const l of items)if(!usedL.has(l))for(const r of other)if(!usedR.has(r)){
      const score=compareSprite(l.image,r.image);if(score>=0.89)candidates.push({l,r,score});
    }
    candidates.sort((a,b)=>b.score-a.score||cmp(a.l.name,b.l.name)||cmp(a.r.name,b.r.name));
    for(const c of candidates)if(!usedL.has(c.l)&&!usedR.has(c.r)){
      usedL.add(c.l);usedR.add(c.r);record(c.l,c.r,c.score);
    }
  }
  return {score:weight/Math.max(1,left.names.size+right.names.size-matched),pairs,hasDraft};
}
function compare(a:Features,b:Features,enabled:Set<SimilarityCriterion>,opts:Options):LibraryPair|null {
  let sum=0,measurements=0,strongest=0,draft=a.draft||b.draft;
  const reasons:SimilarityCriterion[]=[];let best:SimilarityCriterion|undefined;
  let pairs:LibraryPair['sceneries']=[];
  for(const key of enabled) {
    let s=0;
    switch(key){
      case 'names': if(a.key&&b.key)s=a.key===b.key?1:2*intersection(a.grams,b.grams)/Math.max(1,a.grams.size+b.grams.size);break;
      case 'shape': if(a.shape&&b.shape)s=compareTerrain(a.shape,b.shape);break;
      case 'texture': if(a.texture&&a.texture===b.texture)s=1;break;
      case 'counts': {
        let count=0;for(let i=0;i<a.counts.length;i++)if(a.counts[i]>0||b.counts[i]>0){s+=similarity(a.counts[i],b.counts[i]);count++;}
        s/=Math.max(1,count);break;
      }
      case 'sceneryNames': {
        if(!a.names.size&&!b.names.size)continue;
        let matches=0;
        for(const [name,left] of a.names){
          const right=b.names.get(name);if(right===undefined)continue;
          matches++;draft||=isDraftName(left)||isDraftName(right);
          if(!enabled.has('sceneryImages')&&pairs.length<8)pairs.push({left,right});
        }
        s=matches/Math.max(1,a.names.size+b.names.size-matches);break;
      }
      case 'sceneryImages': {
        if(!a.names.size&&!b.names.size)continue;
        const pictures=sceneryPictures(a,b);s=pictures.score;pairs=pictures.pairs;draft||=pictures.hasDraft;break;
      }
    }
    sum+=s;measurements++;
    if(s>strongest){strongest=s;best=key;}
    if(s>=0.70)reasons.push(key);
  }
  const score=Math.round(100*sum/Math.max(1,measurements));
  if(!best||score<opts.threshold||!matchesDraftFilter(opts.draftFilter,draft))return null;
  if(!reasons.length)reasons.push(best);
  return {leftId:a.map.id,rightId:b.map.id,leftName:a.map.baseName,rightName:b.map.baseName,leftCrc:a.map.crc32,rightCrc:b.map.crc32,
    leftHasThumbnail:a.map.hasThumbnail,rightHasThumbnail:b.map.hasThumbnail,score,reasons,sceneries:pairs};
}

export async function searchSimilarMaps(entries:readonly MapIndexEntry[],opts:Options) {
  const enabled=new Set(similarityCriteria.filter(k=>opts.criteria[k]));
  const maps=[...new Map(entries.map(e=>[e.id,e])).values()].sort((a,b)=>cmp(a.id,b.id));
  const results:LibraryPair[]=[];
  let truncated=false,approximate=false;
  const wanted=opts.anchorId?new Set([opts.anchorId,...(opts.anchorIds??[])]):opts.anchorIds;
  const selected=wanted?new Set(maps.filter(m=>wanted.has(m.id)).map(m=>m.id)):undefined;
  if(!enabled.size||maps.length<2||selected?.size===0)return {results,truncated,approximate};
  const total=maps.length*2;
  const visuals=new VisualGroups(),fileCache=new Map<string,{image:SpriteSignature;group:number}|null>();
  const pool:Features[]=[];
  for(const map of maps){
    opts.signal.throwIfAborted();
    const key=nameKey(map.baseName);
    const assets=map.sceneryAssets.filter(a=>a.usedCount>0).sort((a,b)=>b.usedCount-a.usedCount||cmp(a.referencedName,b.referencedName));
    const names=new Map<string,string>();for(const s of assets)names.set(normal(s.referencedName),s.referencedName);
    const f:Features={map,key,grams:ngrams(key),texture:normal(map.texture||''),names,shape:null,pictures:new Map(),
      counts:[map.polygonCount,map.activePropCount,map.activeColliderCount,map.activeSpawnCount,map.activeWaypointCount],draft:isDraftName(map.baseName),keys:[]};
    if(enabled.has('shape'))f.shape=await terrainMask(map);
    if(enabled.has('sceneryImages')){
      const seen=new Set<string>();
      for(const s of assets){
        const canonical=normal(s.referencedName);if(seen.has(canonical))continue;
        if(seen.size>=MAX_MAP_IMAGES){approximate=true;break;}seen.add(canonical);
        const file=s.pngOverrideFullPath||s.diskFullPath;if(!file)continue;
        let visual=fileCache.get(file);
        if(visual===undefined){
          if(fileCache.size>=MAX_JOB_IMAGES){approximate=true;continue;}
          opts.signal.throwIfAborted();const image=await spriteSignature(file);
          visual=image?{image,group:visuals.put(image)}:null;fileCache.set(file,visual);
        }
        if(visual){
          const group=f.pictures.get(visual.group)??[];
          group.push({...visual,name:s.referencedName,draft:isDraftName(s.referencedName)});
          f.pictures.set(visual.group,group);
        }
      }
    }
    f.keys=candidateKeys(f,enabled);pool.push(f);
    if(pool.length%16===0){opts.onProgress(pool.length,total);await yieldToServer();}
  }
  const rank=(a:LibraryPair,b:LibraryPair)=>b.score-a.score||cmp(a.leftName,b.leftName)||cmp(a.rightName,b.rightName)||cmp(a.leftId,b.leftId)||cmp(a.rightId,b.rightId);
  function evaluate(a:Features,b:Features){
    const pair=compare(a,b,enabled,opts);if(!pair)return;
    results.push(pair);
    if(results.length>MAX_RESULTS)truncated=true;
    if(results.length>=MAX_RESULTS*2){results.sort(rank);results.length=MAX_RESULTS;}
  }
  const anchors=selected?pool.filter(f=>selected.has(f.map.id)):[];
  const exactAnchors=selected && (anchors.length<=12||anchors.length*pool.length<=120000);
  const postings:Posting=new Map(),seedPostings:Posting=new Map();
  for(let i=0;i<pool.length;i++){
    opts.signal.throwIfAborted();const current=pool[i];
    const isSeed=selected?.has(current.map.id);
    if(exactAnchors){
      for(const anchor of anchors)if(anchor!==current&&(!isSeed||anchor.map.id<current.map.id))evaluate(anchor,current);
    }
    else if(pool.length<=EXACT_LIMIT){
      for(let j=0;j<i;j++){
        if(isSeed)evaluate(current,pool[j]);
        else if(!selected||selected.has(pool[j].map.id))evaluate(pool[j],current);
      }
    }
    else{
      approximate=true;
      for(const j of nearby(selected&&!isSeed?seedPostings:postings,current.keys)){
        if(isSeed)evaluate(current,pool[j]);else evaluate(pool[j],current);
      }
      insertCandidate(postings,current.keys,i);
      if(isSeed)insertCandidate(seedPostings,current.keys,i);
    }
    if(i%8===0){opts.onProgress(pool.length+i,total);await yieldToServer();}
  }
  results.sort(rank);if(results.length>MAX_RESULTS)results.length=MAX_RESULTS;
  opts.onProgress(total,total);
  return {results,truncated,approximate};
}
