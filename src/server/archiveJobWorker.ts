import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeCleanArchive, exportCleanArchive, type ArchiveCleanPlan } from './archiveCleaner';
import type { ArchiveCleanerJob } from '../shared/archiveCleanerTypes';
import { diskPathKey } from './diskPath';

async function lastExport(job:ArchiveCleanerJob, work:string) {
  const cache=path.resolve(work,'..','..');
  const found: {id:string; time:number}[]=[];
  for (const entry of await fs.readdir(cache,{withFileTypes:true})) {
    if (!entry.isDirectory() || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(entry.name) || entry.name===job.id) continue;
    const file=path.join(cache,entry.name,'job.json');
    let prior:ArchiveCleanerJob;
    try { prior=JSON.parse(await fs.readFile(file,'utf8')); }
    catch(error) { if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code==='ENOENT') continue; throw error; }
    if (prior?.status==='complete' && prior.id===entry.name && typeof prior.source==='string' && diskPathKey(prior.source)===diskPathKey(job.source) &&
      prior.includeLoose===job.includeLoose && prior.includeArchives===job.includeArchives && prior.useCollectionIndex===job.useCollectionIndex &&
      (job.includeMissing || !prior.includeMissing) && (job.includeInstalledMaps || !prior.includeInstalledMaps) &&
      !!prior.portableAssetNames===!!job.portableAssetNames && !!prior.shortMapNames===!!job.shortMapNames)
      found.push({id:prior.id,time:(await fs.stat(file)).mtimeMs});
  }
  for (const prior of found.sort((a,b)=>b.time-a.time)) {
    const file=path.join(cache,prior.id,'work','plan.json');
    try {
      const plan:ArchiveCleanPlan=JSON.parse(await fs.readFile(file,'utf8'));
      if (plan?.version===1 && Array.isArray(plan.maps)) return {previousMaps:plan.maps, previousAssets:plan.assets, previousJobId:prior.id};
    } catch(error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  }
}

const controller = new AbortController();
process.once('disconnect', () => controller.abort());
process.on('message', m => { if (m === 'cancel') controller.abort(); });
type Request = { job: ArchiveCleanerJob; work: string; soldatRoot:string; target:string };
process.once('message', async ({job,work,soldatRoot,target}:Request) => {
  let last = 0;
  const onProgress = ({phase,files,maps}:{phase:string;files:number;maps:number}) => {
    if (Date.now()-last < 300) return;
    last=Date.now();
    if (process.connected) process.send?.({progress:{phase,entries:files,maps}});
  };
  try {
    if (job.status === 'exporting') {
      const plan = JSON.parse(await fs.readFile(path.join(work,'plan.json'),'utf8')) as ArchiveCleanPlan;
      // The plan stores the absolute work folder of the analysis: use the current one, so an export still
      // finds its blobs after the app folder was moved or renamed
      plan.workDir = work;
      await fs.mkdir(path.dirname(target),{recursive:true});
      const result = await exportCleanArchive(plan,target,{signal:controller.signal,onProgress});
      process.send?.({status:'complete',outputPath:result.directory,versionsReport:plan.mapNamesByDate===true});
    } else {
      const baseline = await lastExport(job,work);
      const plan = await analyzeCleanArchive(job.source,work,{...job,...baseline,soldatRoot,signal:controller.signal,onProgress});
      const s = plan.summary;
      const unresolved=plan.maps.filter(m=>m.status==='blocked');
      const ready=plan.maps.filter(m=>m.status==='ready');
      const summary = {maps:s.mapInputs,readyMaps:s.readyMaps,unresolvedMaps:s.blockedMaps,duplicateMaps:s.duplicateMaps,
        incompleteMaps:s.incompleteMaps,
        assets:s.assetInputs,duplicateAssets:s.duplicateAssetFiles,renamedAssets:s.nameConflicts,coverageIssues:s.scanIssues,
        issues:s.scanIssues+unresolved.reduce((n,m)=>n+m.issues.length,0),repairedProps:s.repairedProps,rewrittenReferences:s.rewrittenReferences,
        recovery:plan.recovery, artworkRecovery:plan.artworkRecovery, repairedSectorMaps:ready.filter(m=>(m.repairedSectorReferences??0)>0).length,
        removedUnusedScenery:ready.reduce((n,m)=>n+(m.removedScenery??0),0)};
      const examples=[...plan.issues.slice(0,5),...unresolved.slice(0,8).map(m=>({path:m.source,reason:m.issues.join(' · ')}))];
      process.send?.({status:'ready',summary,examples});
    }
  } catch(e) {
    if (process.connected) process.send?.({status:controller.signal.aborted?'cancelled':'failed',error:e instanceof Error?e.message:String(e)});
  }
  if(process.connected)process.disconnect();
});
