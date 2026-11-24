import express from 'express';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_VERSIONS_REPORT, type ArchiveCleanerJob } from '../shared/archiveCleanerTypes';
import {writeArchiveGameZip} from './archiveGameZip';

/** The map versions report of an exported clean copy. Copies exported by older versions call it wersje-map.csv. */
function mapVersionsReport(exportDir:string):string|undefined {
  return [MAP_VERSIONS_REPORT,'wersje-map.csv'].map(name=>path.join(exportDir,'report',name)).find(file=>fs.existsSync(file));
}

const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const processing = (job:ArchiveCleanerJob) => job.status==='scanning'||job.status==='exporting';
const isInside = (root:string,file:string) => {
  const rel=path.relative(root,file);
  return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);
};
export function createArchiveJobs(cache:string,exportsDir:string,soldatRoot:()=>string,
  addLibrarySource?:(mapsPath:string,job:ArchiveCleanerJob)=>Promise<string>) {
  const router=express.Router();
  let current:ArchiveCleanerJob|null=null, child:ChildProcess|null=null, loaded=false;
  function dir(id:string) { return path.join(cache,id); }
  function persist(job:ArchiveCleanerJob) {
    const file=path.join(dir(job.id),'job.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify(job)); fs.renameSync(file+'.tmp',file);
  }
  function read(id:string) {
    if(!idPattern.test(id))return null;
    if(current?.id===id)return current;
    try {return JSON.parse(fs.readFileSync(path.join(dir(id),'job.json'),'utf8')) as ArchiveCleanerJob;} catch{return null;}
  }
  function initialise(){
    if(loaded)return;
    loaded=true;
    try{current=read(fs.readFileSync(path.join(cache,'current'),'utf8').trim());}catch{/* first use */}
    if(current&&processing(current)){
      // A completed export is atomically published before its worker reports completion.
      const target=path.join(exportsDir,current.id);
      if(current.status==='exporting' && fs.existsSync(path.join(target,'report','plan.json'))){
        current.status='complete';current.outputPath=target;current.versionsReport=mapVersionsReport(target)!==undefined;
      }else{
        current.error='Previous operation was interrupted. You can retry.';
        current.status=current.status==='exporting'?'ready':'failed';
      }
      persist(current);
    }
  }
  async function freeBlobs(job:ArchiveCleanerJob) {
    // Only our UUID-owned staging store, never a path from source metadata.
    if(!idPattern.test(job.id))return;
    try{
      const store=await fs.promises.realpath(cache);
      const expected=path.join(store,job.id,'work','blobs');
      const actual=await fs.promises.realpath(expected);
      if(path.relative(expected,actual)===''){
        await fs.promises.rm(expected,{recursive:true,force:true,maxRetries:3});
      }
    }catch{/* Store absent or still open. Its source files are independent. */}
  }
  function start(job:ArchiveCleanerJob) {
    const exporting=job.status==='exporting';
    const proc=fork(fileURLToPath(new URL('./archiveJobWorker.ts',import.meta.url)),[],{
      execArgv:['--import','tsx'],stdio:['ignore','ignore','inherit','ipc']
    });
    child=proc;
    let ended=false;
    function finish(message:Partial<ArchiveCleanerJob>){
      if(ended)return;
      ended=true;
      if(child===proc)child=null;
      if(exporting && message.status!=='complete'){
        message.status='ready'; // intact verified stage remains usable after a failed/cancelled export
      }
      Object.assign(job,message,{progress:undefined});persist(job);
      if(['complete','cancelled','failed'].includes(job.status))void freeBlobs(job);
    }
    proc.on('message',(message:Partial<ArchiveCleanerJob>)=>{
      if(message.status)finish(message);
      else if(!ended)job.progress=message.progress;
    });
    proc.once('error',e=>finish({status:'failed',error:e.message}));
    proc.once('exit',code=>finish({status:'failed',error:'Archive worker stopped ('+code+')'}));
    proc.send({job,work:path.join(dir(job.id),'work'),target:path.join(exportsDir,job.id),soldatRoot:soldatRoot()});
  }
  router.use((_req,_res,next)=>{initialise();next();});
  router.get('/jobs/current',(_req,res)=>{res.json(current);});
  router.post('/jobs',async(req,res,next)=>{
    try{
      if(typeof req.body?.source!=='string'||!path.isAbsolute(req.body.source)) {res.status(400).json({error:'Choose an absolute archive directory.'});return;}
      const source=await fs.promises.realpath(req.body.source);
      if(!(await fs.promises.stat(source)).isDirectory()){res.status(400).json({error:'Expected a folder.'});return;}
      const includeLoose=req.body.includeLoose!==false,includeArchives=req.body.includeArchives!==false;
      if(!includeLoose&&!includeArchives){res.status(400).json({error:'Select loose files or archives.'});return;}
      if(isInside(source,cache)||isInside(cache,source)||isInside(source,exportsDir)){res.status(400).json({error:'Choose a source separate from the working and output directories.'});return;}
      const selectedRoots:unknown=req.body.artworkRoots??[];
      if (!Array.isArray(selectedRoots) || !selectedRoots.every(p=>typeof p==='string' && path.isAbsolute(p))) {
        res.status(400).json({error:'Choose absolute paths to artwork libraries or packs.'});return;
      }
      const artworkRoots=[...new Set(await Promise.all(selectedRoots.map(p=>fs.promises.realpath(p))))];
      for (const p of artworkRoots) {
        const entry=await fs.promises.stat(p);
        if ((!entry.isDirectory() && !(entry.isFile() && /\.(zip|smap|rar|7z|7z\.001)$/i.test(p))) ||
          isInside(cache,p) || isInside(p,cache) || isInside(exportsDir,p) || isInside(p,exportsDir) ||
          isInside(source,p) || isInside(p,source)) {
          res.status(400).json({error:'Choose separate artwork libraries or map packs.'});return;
        }
      }
      if(child){res.status(409).json({error:'An archive job is running.'});return;}
      if(current?.status==='ready'){
        current.status='cancelled'; persist(current); void freeBlobs(current);
      }
      const job:ArchiveCleanerJob={id:randomUUID(),source,includeLoose,includeArchives,useCollectionIndex:req.body.useCollectionIndex!==false,
        includeMissing:req.body.includeMissing===true,includeInstalledMaps:req.body.includeInstalledMaps===true,
        portableAssetNames:req.body.portableAssetNames!==false,shortMapNames:req.body.shortMapNames===true,artworkRoots,status:'scanning'};
      fs.mkdirSync(dir(job.id),{recursive:true}); persist(job);
      fs.writeFileSync(path.join(cache,'current.tmp'),job.id);fs.renameSync(path.join(cache,'current.tmp'),path.join(cache,'current'));
      current=job; start(job);res.status(202).json(job);
    }catch(e){next(e);}
  });
  router.get('/jobs/:id',(req,res)=>{const j=read(req.params.id);if(j)res.json(j);else res.sendStatus(404);});
  router.get('/jobs/:id/game.zip',async(req,res,next)=>{
    const job=read(req.params.id);
    if (job?.status!=='complete') {res.sendStatus(409);return;}
    try {
      res.attachment('Soldat-Map-Pack-'+job.id.slice(0,8)+'.zip');
      await writeArchiveGameZip(path.join(exportsDir,job.id),res);
    } catch(e) {if (!res.headersSent && !res.destroyed) next(e); else res.destroy();}
  });
  router.get('/jobs/:id/versions.csv',(req,res)=>{
    const job=read(req.params.id);
    if(job?.status!=='complete' || !job.includeInstalledMaps){res.sendStatus(404);return;}
    const report=mapVersionsReport(path.join(exportsDir,job.id));
    if(!report){res.sendStatus(404);return;}
    res.download(report,MAP_VERSIONS_REPORT);
  });
  router.post('/jobs/:id/library',async(req,res,next)=>{
    const job=read(req.params.id);
    if(!job||job.status!=='complete'||!addLibrarySource){res.sendStatus(409);return;}
    const mapsPath=path.join(exportsDir,job.id,'maps');
    try{
      if(!(await fs.promises.stat(mapsPath)).isDirectory()){res.sendStatus(404);return;}
      const sourceId=await addLibrarySource(mapsPath,job);
      res.json({sourceId,path:mapsPath});
    }catch(e){next(e);}
  });
  router.get('/jobs/:id/report',(req,res)=>{
    const j=read(req.params.id);
    if(!j||!j.summary){res.sendStatus(404);return;}
    const file=j.outputPath?path.join(exportsDir,j.id,'report','plan.json'):path.join(dir(j.id),'work','plan.json');
    res.download(file,'archive-report.json');
  });
  router.get('/jobs/:id/review.csv',(req,res)=>{
    const j=read(req.params.id);
    if(!j?.summary){res.sendStatus(404);return;}
    const file=j.outputPath?path.join(exportsDir,j.id,'report','review.csv'):path.join(dir(j.id),'work','review.csv');
    if(!fs.existsSync(file)){res.status(404).json({error:'No review CSV for this analysis. Run a new archive analysis.'});return;}
    res.type('text/csv; charset=utf-8').download(file,'archive-review.csv');
  });
  router.get('/jobs/:id/recovery.csv',(req,res)=>{
    const job=read(req.params.id);
    if (!job?.summary?.recovery) {res.sendStatus(404);return;}
    const file=job.outputPath?path.join(exportsDir,job.id,'report','recovery.csv'):path.join(dir(job.id),'work','recovery.csv');
    res.download(file,'recovery.csv');
  });
  router.get('/jobs/:id/artwork.csv',(req,res)=>{
    const job=read(req.params.id);
    if (!job?.summary?.artworkRecovery) {res.sendStatus(404);return;}
    const root=job.outputPath?path.join(exportsDir,job.id,'report'):path.join(dir(job.id),'work');
    res.download(path.join(root,'artwork.csv'),'artwork.csv');
  });
  router.post('/jobs/:id/export',(req,res)=>{
    if(!current||current.id!==req.params.id||current.status!=='ready'||child){res.sendStatus(409);return;}
    current.status='exporting';delete current.error;persist(current);start(current);res.status(202).json(current);
  });
  router.post('/jobs/:id/cancel',(req,res)=>{
    if(!current||current.id!==req.params.id){res.sendStatus(404);return;}
    if(child?.connected)child.send('cancel');
    else if(current.status==='ready'){current.status='cancelled';persist(current);void freeBlobs(current);}
    res.json(current);
  });
  router.use((e:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:e.message});});
  return router;
}
