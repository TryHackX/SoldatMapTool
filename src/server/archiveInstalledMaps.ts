import fs from 'node:fs/promises';
import path from 'node:path';
import type {ArchiveInputEntry} from './archiveInputs';
import {diskPathKey} from './diskPath';

/** Only the map and artwork directories used by a Soldat installation. */
export async function scanInstalledMaps(root:string, accept:(entry:ArchiveInputEntry)=>Promise<void>, signal?:AbortSignal) {
  const real=await fs.realpath(root);
  for (const base of ['','downloads']) {
    const scope=base?'@installed/downloads':'@installed';
    for (const [folder,kind] of [['maps','map'],['scenery-gfx','scenery'],['textures','texture'],['textures/edges','edge']] as const) {
      const dir=path.join(real,base,folder);
      let entries;
      try {
        if (diskPathKey(await fs.realpath(dir))!==diskPathKey(dir)) throw Error('Installed map directory points elsewhere: '+dir);
        entries=await fs.readdir(dir,{withFileTypes:true});
      } catch(e) {
        if ((e as NodeJS.ErrnoException).code==='ENOENT' && (base || kind!=='map')) continue;
        throw e;
      }
      for (const e of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
        signal?.throwIfAborted();
        if (!e.isFile() || !(kind==='map'?/\.pms$/i:/\.(?:bmp|png|jpe?g|tga|gif)$/i).test(e.name)) continue;
        const full=path.join(dir,e.name), stat=await fs.stat(full);
        if (stat.size>128*1024**2) throw Error('Oversized game resource: '+full);
        await accept({path:scope+'/'+folder+'/'+e.name,scope,kind,name:e.name,size:stat.size,mtimeMs:stat.mtimeMs,read:async()=>{
          if (diskPathKey(await fs.realpath(full))!==diskPathKey(full)) throw Error('Game resource changed: '+full);
          const bytes=await fs.readFile(full),now=await fs.stat(full);
          if (stat.size!==bytes.length || stat.mtimeMs!==now.mtimeMs) throw Error('Game resource changed: '+full);
          return bytes;
        }});
      }
    }
  }
}
