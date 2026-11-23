import express from 'express';
import { randomUUID } from 'node:crypto';
import type { SoldatMapScanner } from './soldatScanner';
import { searchSimilarMaps } from './mapSimilarity';
import { searchSimilarSceneries } from './scenerySimilarity';
import { similarityCriteria, type DraftFilter, type LibraryPair } from '../shared/librarySimilarity';

interface SearchJob {
  id:string; status:'running'|'complete'|'cancelled'|'failed'; done:number; total:number;
  results:LibraryPair[]; approximate:boolean; truncated:boolean; error?:string; controller:AbortController;
}
export function createLibrarySimilarityRouter(scanner:SoldatMapScanner){
  const router=express.Router();
  let current:SearchJob|undefined;
  const snapshot=(job:SearchJob)=>({id:job.id,status:job.status,done:job.done,total:job.total,resultCount:job.results.length,
    approximate:job.approximate,truncated:job.truncated,error:job.error});
  router.post('/jobs',(req,res)=>{
    if(!scanner.isIndexReady()){res.status(409).json({error:'The map library is still indexing.'});return;}
    const body=req.body??{};
    // Honor requests made by a Studio tab opened before the three-way filter was added.
    const draftFilter:DraftFilter=body.draftFilter??(body.draftsOnly===true?'only':'all');
    if(!['all','only','exclude'].includes(draftFilter)){
      res.status(400).json({error:'Invalid draft filter.'});return;
    }
    const scenery=body.mode==='sceneries';
    if(body.mode!==undefined && !scenery && body.mode!=='maps'){res.status(400).json({error:'Invalid similarity mode.'});return;}
    const criteria=Object.fromEntries(similarityCriteria.map(k=>[k,body.criteria?.[k]===true]));
    if((scenery ? !criteria.sceneryNames&&!criteria.sceneryImages : !Object.values(criteria).some(Boolean))
      || !Number.isFinite(body.threshold) || body.threshold<0 || body.threshold>100){
      res.status(400).json({error:'Choose at least one criterion and a threshold from 0 to 100.'});return;
    }
    let ids:string[];
    try{
      if(body.ids?.length){
        if(!Array.isArray(body.ids)||body.ids.some((s:unknown)=>typeof s!=='string'))throw Error();
        ids=Array.from(new Set<string>(body.ids));
      }else if(body.query && typeof body.query==='object' && !Array.isArray(body.query))ids=scanner.queryMatchingIds(body.query);
      else {res.status(400).json({error:'Choose maps or the current library filter.'});return;}
    }catch {res.status(400).json({error:'Invalid map selection.'});return;}
    if(!ids.length){res.status(400).json({error:'No maps in this selection.'});return;}
    const selected=ids.map(id=>scanner.getMapEntry(id)).filter(m=>m!==null);
    if(selected.length!==ids.length){res.status(409).json({error:'The selection changed. Refresh the library.'});return;}
    if(current?.status==='running'){res.status(409).json({error:'A similarity search is running.'});return;}
    const single=ids.length===1;
    const soloMap=!scenery && single && (body.ids?.length || body.againstLibrary===true);
    const anchors=!soloMap && body.againstLibrary===true ? new Set(ids) : undefined;
    const entries=soloMap||anchors ? scanner.getAllEntries() : selected;
    const job:SearchJob={id:randomUUID(),status:'running',done:0,total:entries.length,results:[],approximate:false,truncated:false,controller:new AbortController()};
    current=job;
    res.status(202).json(snapshot(job));
    setImmediate(()=>{
      const options={criteria,threshold:body.threshold,draftFilter,anchorIds:anchors,signal:job.controller.signal,
        onProgress:(done:number,total:number)=>{job.done=done;job.total=total;}
      };
      const task=scenery?searchSimilarSceneries(entries,options):searchSimilarMaps(entries,{...options,anchorId:soloMap?ids[0]:undefined});
      void task.then(result=>{
        if(job.controller.signal.aborted)return;
        Object.assign(job,result,{status:'complete',done:job.total});
      }).catch(e=>{
        if(!job.controller.signal.aborted){job.status='failed';job.error=e instanceof Error?e.message:String(e);}
      }).finally(()=>{if(job.controller.signal.aborted)job.status='cancelled';});
    });
  });
  router.get('/jobs/:id',(req,res)=>{
    if(!current||current.id!==req.params.id){res.sendStatus(404);return;}
    const offset=Math.max(0,Math.floor(Number(req.query.offset)||0)),limit=Math.min(100,Math.max(1,Math.floor(Number(req.query.limit)||20)));
    res.json({...snapshot(current),results:current.results.slice(offset,offset+limit)});
  });
  router.post('/jobs/:id/cancel',(req,res)=>{
    if(!current||current.id!==req.params.id){res.sendStatus(404);return;}
    if(current.status==='running')current.controller.abort();
    res.json(snapshot(current));
  });
  return router;
}
